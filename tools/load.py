"""Stage 3 loader: out/<id>.json -> questions.db. Idempotent per document (deletes that doc's rows first)."""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import json, sqlite3, glob, os, datetime
DB = paths.DBS
db = sqlite3.connect(DB); db.execute('PRAGMA foreign_keys=ON')
# measured sub-agent token totals per document (from Agent tool usage), parse stage
TOK = {296:164111,568:119512,34:144401,222:163613,268:152874,408:163933,642:142754,33:127516,226:144853,
       267:144652,295:151746,409:216618,510:193832,1346:295958,1308:219601,1365:203353}
TOOLS = {296:28,568:29,34:34,222:52,268:42,408:37,642:34,33:31,226:36,267:47,295:28,409:59,510:43,1346:87,1308:55,1365:71}
# ASSUMPTION, not a price quote: blended $ per 1M tokens for in-session agent work (mostly cached input)
RATE_PER_M = 3.0
now = datetime.datetime.now().isoformat(timespec='seconds')
import sys
# Usage: python3 load.py <doc_id> [<doc_id> ...]   (import batches, 11 Nov). Loads ONLY the named out/<id>.json files.
# A paper that already has questions in the database is never wiped (owner edits live there) unless --force is given.
IDS = [a for a in sys.argv[1:] if a.isdigit()]
FORCE = '--force' in sys.argv
if not IDS: sys.exit('name the document ids to load, e.g. python3 load.py 1628 1630')
FILES = [paths.S + f'out/{i}.json' for i in IDS]   # state/out/ (tracked parse outputs)
for i in IDS:
    if not FORCE and db.execute('select count(*) from questions where document_id=?', (int(i),)).fetchone()[0]:
        sys.exit(f'document {i} already has questions: refusing to wipe it (use --force only if you mean to discard its edits)')

import re
def norm_topic(v):
    # house format, e.g. "Standard, Year 11: Data analysis (MST-11-08)"; parts or "(borderline)" kept at the end
    if isinstance(v, dict):
        return f"Standard, Year {v.get('year')}: {v.get('topic')} ({v.get('outcome')})"
    m = re.match(r'(?:Mathematics )?Standard, Year (\d+), (.*?),? (MST-[\w/ -]+?)(\s*\(borderline\))?(:.*)?$', v)
    if m: return f"Standard, Year {m.group(1)}: {m.group(2)} ({m.group(3).strip()})" + (m.group(4) or '') + (m.group(5) or '')
    return v

def norm_cell(c):
    # the page renders table cells as maths: $...$ segments become maths, other text \text{} (owner 12 Nov: broken tables)
    if not isinstance(c, str): return c
    c = c.strip()
    if c.startswith('\\diag'): return c.replace('$', '')
    if '$' in c.replace('\\$', ''):
        segs = re.split(r'(?<!\\)\$', c); out = ''
        for i, sg in enumerate(segs):
            if i % 2: out += sg
            elif sg.strip(): out += sg if re.fullmatch(r'\s*\\(text|textit|textbf)\{[^{}]*\}\s*', sg) else '\\text{' + sg + '}'
        return out
    if re.fullmatch(r"[A-Za-z][A-Za-z '\-]{2,}[A-Za-z]", c): return '\\text{' + c + '}'
    return c

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

for f in FILES:
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
        for col in ('standard_topic', 'old_syllabus'):
            v = q.get(col)
            if v: db.execute(f'update questions set {col}=? where id=?', (norm_topic(v) if col == 'standard_topic' else v, qid))
        if q.get('options_layout'):
            db.execute('update questions set options_layout=?, options_table_json=? where id=?', (q['options_layout'], json.dumps(q['options_table']) if q.get('options_table') else None, qid))
        mk = d.get('mcq_key') or {}; key = mk.get(str(q.get('section') or '') + str(q['number'])) or mk.get(str(q['number']))   # 25 Nov: a key per section ("A2", "B2") when numbers repeat
        for o in [o for o in q.get('mcq_options', []) if isinstance(o, dict)]:
            ic = o.get('is_correct')
            if ic is None and key: ic = int(o['label'] == key)
            fk = None
            for fig in q.get('figures', []):
                if (fig.get('attach') or '').lower() == 'option ' + o['label'].lower(): fk = fig.get('id')
            db.execute('insert into mcq_options(question_id,label,latex,is_correct,key_source,figure_key) values (?,?,?,?,?,?)', (qid, o['label'], o.get('latex') or '', ic, 'extracted' if ic is not None else None, fk))
        for fig in q.get('figures', []):
            att = fig.get('attach') or 'question'
            pid = None if att == 'question' or att.startswith('option') else partmap.get((str(q['number']), att))
            db.execute('insert into figures(question_id,part_id,page,bbox,png_path,tikz_path,caption) values (?,?,?,?,?,?,?)',
                (qid, pid, fig.get('page', 0), json.dumps(fig.get('bbox')), f"figures/{fig.get('id')}.png", None, ((att + ': ') if att.startswith('option') else '') + (fig.get('caption') or '')))
    db.commit()

# second pass: solutions (need target doc parts loaded)
stats = {}
for f in FILES:
    d = json.load(open(f)); doc = d['document_id']; target = d.get('links_to_document_id') or doc
    # 25 Nov (owner: "WCC 2022 std paper, consistent errors on solutions not matching"): 2022 William Clarke AT1 numbers Part A and Part B
    # both from Q2; looking questions up by number alone sent every Part A solution to the Part B question of the same number. A number
    # that repeats across sections is looked up with the solution's section (or its seq); a unique number still works without one.
    qall = db.execute('select id,number,section from questions where document_id=? order by id', (target,)).fetchall()
    qrows, qsec, qseq = {}, {}, {}
    for i, (qid0, num0, sec0) in enumerate(qall, 1):
        qrows.setdefault(num0, []).append(qid0); qsec[(sec0 or '', num0)] = qid0; qseq[i] = qid0
    matched = unmatched = 0
    for s in d.get('solutions', []):
        qn = str(s.get('question')); part = s.get('part'); cand = qrows.get(qn) or []
        qid = cand[0] if len(cand) == 1 else qsec.get((s.get('section') or '', qn)) or (qseq.get(s.get('seq')) if s.get('seq') else None)
        if len(cand) > 1 and not qid: print(f'load: doc {doc} solution for Q{qn} names no section/seq and Q{qn} repeats: not loaded'); unmatched += 1; continue
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
        meta = dict(s.get('meta') or {})
        if s.get('needs_review') and s.get('review_reasons'): meta['concern'] = '; '.join(s['review_reasons'])
        src = s.get('source') or 'extracted'
        db.execute('insert into solutions(part_id,question_id,source,latex,marks_breakdown,source_document_id,model,prompt_version,verified_by,verified_at,meta_json) values (?,?,?,?,?,?,?,?,?,?,?)',
                   (pid, None if pid else qid, src, s.get('latex') or '', s.get('marks_breakdown'), doc, 'claude-opus-5-5' if src == 'generated' else None, 'parse-v1', None, None, json.dumps(meta) if meta else None))
    # tables the parser stored as data (\extable{id} in the text)
    for t in d.get('tables', []):
        t['rows'] = [[norm_cell(c) for c in r] for r in t['rows']]
        for r in t['rows']:   # a line break inside \text{} breaks the page's line split (Hornsby 2024 Q29): close/reopen \text around it
            for j, c in enumerate(r):
                if isinstance(c, str):
                    for m in re.finditer(r'\\text\{([^{}]*)\}', c):
                        if '\\\\' in m.group(1): r[j] = r[j].replace(m.group(0), '\\\\'.join('\\text{' + x + '}' for x in m.group(1).split('\\\\')))
        own = None
        for tab, col in (('parts', 'latex'), ('questions', 'stem_latex')):
            r = db.execute(f'select x.id from {tab} x' + (' join questions q on q.id=x.question_id where q.document_id=?' if tab == 'parts' else ' where x.document_id=?') + f' and x.{col} like ?', (target, '%\\extable{' + t['id'] + '}%')).fetchone()
            if r: own = (tab, r[0]); break
        if not own:   # 17 Nov (Batch 7, Ascham 2023 Q30): a table inside a worked solution belongs to that solution
            r = db.execute('select s.id from solutions s left join parts p on p.id=s.part_id join questions q on q.id=coalesce(s.question_id,p.question_id) '
                           'where q.document_id=? and s.latex like ?', (target, '%\\extable{' + t['id'] + '}%')).fetchone()
            if r: own = ('solutions', r[0])
        db.execute('insert or replace into data_tables(id,owner_table,owner_id,caption,header_rows,label_col,rows_json,source_latex,spans_json) values (?,?,?,?,?,?,?,?,?)',
                   (t['id'], own[0] if own else None, own[1] if own else None, t.get('caption'), t.get('header_rows', 0), int(bool(t.get('label_column', t.get('label_col')))), json.dumps(t['rows']), None, json.dumps(t.get('spans') or [])))
        if not own: print('table not referenced in text:', t['id'])
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
