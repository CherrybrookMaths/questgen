"""Stage 3 loader: out/<id>.json -> questions.db. Idempotent per document (deletes that doc's rows first)."""
import json, sqlite3, glob, os, datetime
DB = '/mnt/user-data/outputs/questions.db'
db = sqlite3.connect(DB); db.execute('PRAGMA foreign_keys=ON')
# measured sub-agent token totals per document (from Agent tool usage), parse stage
TOK = {296:164111,568:119512,34:144401,222:163613,268:152874,408:163933,642:142754,33:127516,226:144853,
       267:144652,295:151746,409:216618,510:193832,1346:295958,1308:219601,1365:203353}
TOOLS = {296:28,568:29,34:34,222:52,268:42,408:37,642:34,33:31,226:36,267:47,295:28,409:59,510:43,1346:87,1308:55,1365:71}
# ASSUMPTION, not a price quote: blended $ per 1M tokens for in-session agent work (mostly cached input)
RATE_PER_M = 3.0
now = datetime.datetime.now().isoformat(timespec='seconds')

def wipe(doc):
    qids = [r[0] for r in db.execute('select id from questions where document_id=?', (doc,))]
    for q in qids:
        pids = [r[0] for r in db.execute('select id from parts where question_id=?', (q,))]
        for p in pids:
            db.execute('delete from tags where part_id=?', (p,)); db.execute('delete from solutions where part_id=?', (p,)); db.execute('delete from figures where part_id=?', (p,))
        db.execute('update parts set parent_part_id=null where question_id=?', (q,))
        db.execute('delete from parts where question_id=?', (q,))
        for t in ('mcq_options','tags','solutions','figures'): db.execute(f'delete from {t} where question_id=?', (q,))
    db.execute('delete from questions where document_id=?', (doc,))
    db.execute('delete from solutions where source_document_id=?', (doc,))

def leaf_key(p, parts):
    # path like "b.ii" from label + parent chain
    chain = [p['label']]; par = p.get('parent_label')
    while par:
        chain.insert(0, par); par = next((x.get('parent_label') for x in parts if x['label'] == par and x is not p), None)
    return '.'.join(c for c in chain if c)

for f in sorted(glob.glob('/home/claude/pilot/out/*.json')):
    d = json.load(open(f)); doc = d['document_id']
    wipe(doc)
    target = d.get('links_to_document_id') or doc
    partmap = {}  # (qnum, path) -> part_id for target doc
    for q in d.get('questions', []):
        nr = int(bool(q.get('needs_review'))) or (1 if d.get('parse_path') == 'scan' else 0)
        cur = db.execute('insert into questions(document_id,number,section,question_type,stem_latex,marks_total,page_start,page_end,needs_review,review_note) values (?,?,?,?,?,?,?,?,?,?)',
            (doc, str(q['number']), q.get('section'), q.get('question_type','short'), q.get('stem_latex'), q.get('marks_total'), q.get('page_start'), q.get('page_end'), nr,
             '; '.join(q.get('review_reasons') or []) + ('; MARKS_MISMATCH' if q.get('marks_mismatch') else '') or None))
        qid = cur.lastrowid; label_to_id = {}
        for p in sorted(q['parts'], key=lambda x: x.get('ordinal', 0)):
            par = label_to_id.get(p.get('parent_label'))
            pid = db.execute('insert into parts(question_id,label,parent_part_id,ordinal,latex,marks,needs_review) values (?,?,?,?,?,?,?)',
                (qid, p.get('label'), par, p.get('ordinal', 0), p.get('latex') or '', p.get('marks'), int(bool(p.get('needs_review'))) or nr)).lastrowid
            label_to_id[p.get('label')] = pid
            partmap[(str(q['number']), leaf_key(p, q['parts']) or None)] = pid
        partmap.setdefault((str(q['number']), None), None)
        partmap[('Q', str(q['number']))] = qid
        key = (d.get('mcq_key') or {}).get(str(q['number']))
        for o in q.get('mcq_options', []):
            ic = o.get('is_correct')
            if ic is None and key: ic = int(o['label'] == key)
            db.execute('insert into mcq_options(question_id,label,latex,is_correct,key_source) values (?,?,?,?,?)', (qid, o['label'], o.get('latex') or '', ic, 'extracted' if ic is not None else None))
        for fig in q.get('figures', []):
            att = fig.get('attach') or 'question'
            pid = None if att == 'question' or att.startswith('option') else partmap.get((str(q['number']), att))
            db.execute('insert into figures(question_id,part_id,page,bbox,png_path,tikz_path,caption) values (?,?,?,?,?,?,?)',
                (qid, pid, fig.get('page', 0), json.dumps(fig.get('bbox')), f"figures/{fig.get('id')}.png", None, ((att + ': ') if att.startswith('option') else '') + (fig.get('caption') or '')))
    db.commit()

# second pass: solutions (need target doc parts loaded)
stats = {}
for f in sorted(glob.glob('/home/claude/pilot/out/*.json')):
    d = json.load(open(f)); doc = d['document_id']; target = d.get('links_to_document_id') or doc
    qrows = {r[1]: r[0] for r in db.execute('select id,number from questions where document_id=?', (target,))}
    matched = unmatched = 0
    for s in d.get('solutions', []):
        qn = str(s.get('question')); qid = qrows.get(qn); part = s.get('part')
        pid = None
        if qid and part:
            # resolve "b.ii" by walking labels
            labels = part.split('.'); parent = None
            for lab in labels:
                r = db.execute('select id from parts where question_id=? and label=? and ' + ('parent_part_id is null' if parent is None else 'parent_part_id=?'),
                               (qid, lab) if parent is None else (qid, lab, parent)).fetchone()
                if not r:
                    r = db.execute('select id from parts where question_id=? and label=?', (qid, lab)).fetchone()
                parent = r[0] if r else None
            pid = parent
        if qid is None: unmatched += 1; continue
        matched += 1
        db.execute('insert into solutions(part_id,question_id,source,latex,marks_breakdown,source_document_id,model,prompt_version,verified_by,verified_at) values (?,?,?,?,?,?,?,?,?,?)',
                   (pid, None if pid else qid, 'extracted', s.get('latex') or '', s.get('marks_breakdown'), doc, None, 'parse-v1', None, None))
    # MCQ key from a linked solutions doc
    if d.get('links_to_document_id') and d.get('mcq_key'):
        for qn, k in d['mcq_key'].items():
            qid = qrows.get(str(qn))
            if qid: db.execute("update mcq_options set is_correct=(label=?), key_source='extracted' where question_id=?", (k, qid))
    stats[doc] = (matched, unmatched)
    t = TOK.get(doc)
    db.execute('delete from runs where document_id=? and stage=?', (doc, 'parse'))
    db.execute('insert into runs(document_id,stage,started_at,finished_at,model,prompt_version,input_tokens,output_tokens,est_cost_usd,outcome,error) values (?,?,?,?,?,?,?,?,?,?,?)',
               (doc, 'parse', now, now, 'claude-opus-5-5 (subagent)', 'parse-v1', t, None, round(t / 1e6 * RATE_PER_M, 3) if t else None, 'ok' if d.get('status') != 'partial' else 'failed',
                f'tool_calls={TOOLS.get(doc)}; tokens are subagent totals (input+output combined)'))
    db.execute("update documents set status='parsed' where id=?", (doc,))
db.commit()
print('solutions matched/unmatched per doc:', stats)
for r in db.execute("select d.id, d.task_type, d.parse_path, count(distinct q.id), count(p.id), sum(p.needs_review) from documents d left join questions q on q.document_id=d.id left join parts p on p.question_id=q.id where d.status='parsed' group by d.id"):
    print(r)
