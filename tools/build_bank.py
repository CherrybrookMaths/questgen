"""Build site/data/bank.json (v2) + site/data/svg/g<doc % 8>.json (grouped redraw packs, tools/packs.py) from questions.db and the TikZ redraws.
Keeps per-part tag data, queues, related, pages and figure lists from the previous bank.json (built by the v1
inline builder), and refreshes all text, solutions, tables and figure redraw data from the database."""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import sqlite3, json, csv, glob, os, base64, collections, subprocess
P = paths.P
db = sqlite3.connect(paths.DBS); db.row_factory = sqlite3.Row
old = json.load(open(P + 'site/data/bank.json'))
if 'v' in old and old['v'] == 2 and os.path.exists(paths.S + 'site/data/bank_v1.json'):
    old = json.load(open(paths.S + 'site/data/bank_v1.json'))
elif not os.path.exists(paths.S + 'site/data/bank_v1.json'):
    json.dump(old, open(paths.S + 'site/data/bank_v1.json', 'w'))

J = lambda s, d=None: json.loads(s) if s else d
_dis = {}
for _f in ('work/tag_full/disagreements.json', 'work/tag_pilot/disagreements.json'):   # main re-tag + pilot re-tag (12 Nov)
    if os.path.exists(paths.S + _f): _dis.update(json.load(open(paths.S + _f)))   # state/ (tracked)
_slim = lambda x: dict(dp=[[d['id'], d.get('role')] for d in x.get('dot_points') or []], req=x.get('required_skills') or [], can=x.get('can_use_skills') or [], removed=x.get('removed_reason') or '', note=(x.get('note') or '')[:200], conf=x.get('confidence'))
TAGD = {k: dict(A=_slim(v['A']), B=_slim(v['B'])) for k, v in _dis.items()}
# owner 12 Nov: gates settled automatically with quoted evidence (work/gates); shown read-only in Review > Tags
GATES = {}
for _f in ('work/gates/gates_applied.json', 'work/gates_pilot/gates_applied.json'):
    if os.path.exists(paths.S + _f): GATES.update(json.load(open(paths.S + _f)))
# owner 17 Nov: "We need a way to append a z score table at the back of exams which ahve those questions tho" (tools/ztable.py)
ZT = json.load(open(paths.S + 'work/ztable.json')) if os.path.exists(paths.S + 'work/ztable.json') else {}
for q in old['questions']:
    r = db.execute('select * from questions where id=?', (q['id'],)).fetchone()
    q['stem'] = r['stem_latex']; q['number'] = r['number']
    if r['marks_total'] is not None: q['marks'] = r['marks_total']   # 17 Nov: a mark change in the database reaches the page (was frozen at import: Penrith 2024 Q27, Ascham 2023 Q11)
    q['section'] = r['section'] if 'section' in r.keys() else q.get('section')
    q['opt_table'] = J(r['options_table_json'])
    q['layout'] = r['options_layout'] if 'options_layout' in r.keys() else None
    # owner 11 Nov: "they should be marked old syllabus": content with no 2024 dot point (questions.old_syllabus = reason)
    q['old'] = r['old_syllabus'] if 'old_syllabus' in r.keys() else None
    # owner 11 Nov: content that left Advanced but is in the 2024 Mathematics Standard syllabus goes to a Standard section
    q['std'] = r['standard_topic'] if 'standard_topic' in r.keys() else None
    q['queues'] = [x for x in q['queues'] if x not in ('removed', 'standard')] + (['removed'] if q['old'] else []) + (['standard'] if q['std'] else [])
    dbfigs = {f['png_path'] for f in db.execute('select png_path from figures where question_id=?', (q['id'],))}
    q['figures'] = [f for f in q['figures'] if f['src'] in dbfigs]
    for p in q['parts']:
        pr = db.execute('select * from parts where id=?', (p['id'],)).fetchone()
        p['latex'] = pr['latex']; p['marks'] = pr['marks']; p['label'] = pr['label']   # owner 12 Nov: split questions relabelled (tools/relabel_split.py)
        if 'src_label' in pr.keys() and pr['src_label']: p['src_label'] = pr['src_label']
        # difficulty + working mathematically (diff-v1, owner 13 Nov): band 2-6, wm UF/PR, anchor flag, nearest anchor, confidence, reason
        dr = db.execute('select * from part_difficulty where part_id=?', (p['id'],)).fetchone() if db.execute("select 1 from sqlite_master where name='part_difficulty'").fetchone() else None
        if dr: p['dif'] = dict(b=dr['band'], wm=dr['wm'], a=dr['is_anchor'], na=dr['nearest_anchor'], c=(dr['confidence'] or '')[:1], r=dr['reason'], ar=dr['area'])
        else: p.pop('dif', None)
        if dr and 'band_ai' in dr.keys() and dr['band_ai'] is not None and (dr['band_ai']!=dr['band'] or dr['wm_ai']!=dr['wm']): p['dif'].update(m=dr['band_ai'], mw=dr['wm_ai'], s=dr['source'])   # owner 14 Nov: model's original rating kept for the Difficulty tab
        # tags live from the DB (tag-v2.2, owner 12 Nov). Slim: dot point text/focus area come from dotpoints.json on the page.
        tg = db.execute("select * from tags where part_id=? and scheme in ('2024','skill','note','2017')", (p['id'],)).fetchall()
        if any((t['prompt_version'] or '').startswith('tag-v2') for t in tg):
            p['t24'] = [dict(id=t['code'], primary=t['is_primary'], cov=t['coverage'], conf=t['confidence']) for t in tg if t['scheme'] == '2024']
            p['skills'] = [t['dot_point'] for t in tg if t['scheme'] == 'skill' and t['coverage'] == 'required']
            p['can_use'] = [t['dot_point'] for t in tg if t['scheme'] == 'skill' and t['coverage'] == 'can_use']
            p['note'] = next((t['dot_point'] for t in tg if t['scheme'] == 'note'), None)
            p.pop('free', None)
            if str(p['id']) in TAGD: p['tagd'] = TAGD[str(p['id'])]
            if str(p['id']) in GATES: p['gates'] = GATES[str(p['id'])]
        else:
            p['t24'] = [{k: v for k, v in t.items() if k in ('id', 'primary', 'cov', 'conf', 'edited')} for t in (p.get('t24') or [])]
    q['options'] = [dict(label=o['label'], latex=o['latex'], is_correct=o['is_correct'], key_source=o['key_source'], fig=o['figure_key'] if 'figure_key' in o.keys() else None)
                    for o in db.execute('select * from mcq_options where question_id=? order by label', (q['id'],))]
    pids = [p['id'] for p in q['parts']]
    sols = db.execute('select * from solutions where question_id=? or part_id in (%s) order by id' % ','.join('?' * len(pids)),
                      [q['id']] + pids).fetchall() if pids else db.execute('select * from solutions where question_id=? order by id', (q['id'],)).fetchall()
    q['solutions'] = [dict(id=s['id'], part_id=s['part_id'], source=s['source'], latex=s['latex'],
                           criteria=J(s['criteria_json'], []), meta={k: v for k, v in J(s['meta_json'], {}).items() if k not in ('source_original', 'criteria_original')}) for s in sols]

tables = {}
for t in db.execute('select * from data_tables'):
    tables[t['id']] = dict(cap=t['caption'], hr=t['header_rows'] or 0, lc=t['label_col'] or 0,
                           rows=J(t['rows_json'], []), spans=J(t['spans_json'], []))

res = {r['id']: r for r in json.load(open(paths.S + 'tikz/all_results.json'))}
chk = {}
for f in glob.glob(P + 'tikz/check_*.json'):
    for r in json.load(open(f))['results']: chk[r['id']] = r
figtab = {os.path.basename(r['png_path'])[:-4]: r['redraw_table_id'] for r in db.execute('select png_path, redraw_table_id from figures')}
ovs = json.load(open(paths.S + 'tikz/overlay_scores.json')) if os.path.exists(paths.S + 'tikz/overlay_scores.json') else {}
figs, packs = {}, collections.defaultdict(dict)
for k, r in res.items():
    c = chk.get(k, {})
    tid = figtab.get(k)
    if r['status'] == 'table' and not tid:   # solution-document table not in figures table: store it here
        tb = r['table']; tid = 'Tx_' + k
        tables[tid] = dict(cap=None, hr=tb.get('header_rows', 0), lc=tb.get('label_col', 0), rows=tb['rows'], spans=[])
    figs[k] = dict(status=r['status'], cls=r.get('class'), notes=r.get('notes'),
                   check=c.get('verdict'), check_notes=c.get('notes'), table=tid,
                   ov=[ovs[k]['orig_covered'], ovs[k]['redraw_covered']] if k in ovs and 'orig_covered' in ovs[k] else None, v=r.get('version', 1))
    svg = P + 'tikz/svg/%s.svg' % k
    if r['status'] in ('ok', 'approx') and os.path.exists(svg):
        if os.path.getsize(svg) > 3_000_000:   # (stipple is now real dots, so SVGs stay small)   # pattern fills explode into thousands of SVG paths: ship a 300 dpi PNG instead
            pdf = P + 'tikz/build/%s.pdf' % k; hi = P + 'tikz/hi/%s' % k
            os.makedirs(P + 'tikz/hi', exist_ok=True)
            subprocess.run(['pdftoppm', '-png', '-r', '300', '-singlefile', pdf, hi], check=True)
            packs[k.split('_')[0]][k] = 'data:image/png;base64,' + base64.b64encode(open(hi + '.png', 'rb').read()).decode()
        else:
            packs[k.split('_')[0]][k] = 'data:image/svg+xml;base64,' + base64.b64encode(open(svg, 'rb').read()).decode()
dbkeys = {os.path.basename(r['png_path'])[:-4] for r in db.execute('select png_path from figures')}
figs = {k: v for k, v in figs.items() if k in dbkeys or v['status'] != 'keep_crop'}   # photos removed from the database leave the bank too (solution-document figures are not in the figures table, so keep those)
# owner 15 Nov (via workflow brief): "Lets do ... 4" -> fewer published files: the redraw packs are written as 8 group
# files data/svg/g<doc % 8>.json, not one per paper (tools/packs.py; the page picks the group in 05_figures.js PACK_G)
import sys; sys.path.insert(0, P + 'tools'); import packs as _packs
_packs.write_groups('svg', packs)
for _f in _packs.leftovers('svg'):   # a per-paper file from an older build would be published for nothing: archive it
    os.makedirs(_packs.ARCH + 'svg', exist_ok=True); os.replace(P + 'site/data/svg/' + _f, _packs.ARCH + 'svg/' + _f)

codes17 = {}
for row in csv.DictReader(open(P + 'site/project/mapping_v1.csv')):
    codes17.setdefault(row['code_2017'], row['title_2017'])

# exact/near-exact duplicates (same paper filed twice etc.): keep one copy in the Bank, hide the other there
byid = {q['id']: q for q in old['questions']}
for q in old['questions']: q.pop('dup_of', None)
for a, b, sim, rel in db.execute("select question_id, related_id, similarity, relation from related_questions where relation='duplicate' and question_id<related_id"):
    qa, qb = byid.get(a), byid.get(b)
    if not qa or not qb or qa.get('dup_of') or qb.get('dup_of'): continue
    _st = lambda q: (db.execute('select review_status from questions where id=?', (q['id'],)).fetchone() or [None])[0]
    score = lambda q: (_st(q) != 'approved', q.get('layout') == 'graph' and not all(o.get('fig') for o in q['options']), ('review' in q['queues']), len(q['solutions']) == 0, q['doc'] != 1346, q['id'])
    keep, drop = sorted([qa, qb], key=score)
    drop['dup_of'] = keep['id']
# owner 13 Nov: "so can we sync the number on the bank and the processes pls". A paper filed twice (CSSA 2022: docs 510 and
# 1346) must be hidden as a whole, or the Bank counts both files as papers. Where most of one doc's copies are hidden in favour
# of another doc, hide the rest of that pair the same way round (one copy of the paper stays, the other disappears entirely).
_pair = collections.Counter((q['doc'], byid[q['dup_of']]['doc']) for q in old['questions'] if q.get('dup_of'))
for q in old['questions']:
    k = q.get('dup_of') and byid[q['dup_of']]
    if k and _pair[(k['doc'], q['doc'])] > _pair[(q['doc'], k['doc'])]:   # this pair mostly runs the other way: flip it
        q.pop('dup_of'); k['dup_of'] = q['id']
print('hidden duplicates', sum(1 for q in old['questions'] if q.get('dup_of')))
# owner 12 Nov: "I don't have time to check 6000 questions" -> triage.py decides what the owner looks at (q.tri)
TRI = json.load(open(paths.S + 'work/triage.json')) if os.path.exists(paths.S + 'work/triage.json') else {}
for q in old['questions']:
    q.pop('tri', None)
    t = TRI.get(str(q['id']))
    if t: q['tri'] = {k: t[k] for k in ('tier', 'why', 'look', 'ok_figs', 'chk_figs', 'ok_sols')}
# Your calls raised by Claude (owner 13 Nov: "isn't that the point of your calls?"): site/project/open_decisions.json,
# "<question id>" -> q.decide (+ q.decide_at), "paper_<doc>" -> docs[doc].call. {text, raised}: raised (UTC ISO) re-opens a
# question or paper the owner had already approved before the call was raised. Remove the entry once the owner has decided.
dec = json.load(open(P + 'site/project/open_decisions.json'))
for q in old['questions']:
    q.pop('decide', None); q.pop('decide_at', None)
    e = dec.get(str(q['id']))
    if e:
        q['decide'] = e['text']
        if e.get('raised'): q['decide_at'] = e['raised']
for _k, _d in old['docs'].items():
    _d.pop('call', None)
    e = dec.get('paper_' + _k)
    if e: _d['call'] = {'text': e['text'], 'raised': e.get('raised')}
_have = {'paper_' + k for k in old['docs']} | {str(q['id']) for q in old['questions']}
_lost = [k for k in dec if k not in _have]
if _lost: print('WARN open_decisions entries with no question/paper in the bank:', _lost)
import re as _re
_docpos = {}
for _q in old['questions']: _docpos.setdefault(_q['doc'], len(_docpos))
# owner 17 Nov: "Keep the native numbering": a paper whose sections each restart at Question 1 (2024 Abbotsleigh AT1) keeps the
# printed numbers; the page shows them with their section (nlabel "1 (Section II)") and the paper is ordered as printed (by id)
_dupnum = {d for d, n in __import__('collections').Counter((q['doc'], str(q['number'])) for q in old['questions']).items() if n > 1 and len({x.get('section') for x in old['questions'] if x['doc'] == d[0] and str(x['number']) == d[1]}) > 1}
_restart = {d for d, _ in _dupnum}
for q in old['questions']:
    if q['doc'] in _restart and q.get('section'): q['nlabel'] = f"{q['number']} (Section {q['section']})"
    else: q.pop('nlabel', None)
def _qkey(q):   # natural question order within a paper: 10, 10(a), 10(b), 11 ... (split questions sit with their number)
    if q['doc'] in _restart: return (_docpos[q['doc']], 0, '', q['id'])
    m = _re.match(r'(\d+)(.*)', str(q['number'] or '')); return (_docpos[q['doc']], int(m.group(1)) if m else 9999, m.group(2) if m else str(q['number']), q['id'])
old['questions'].sort(key=_qkey)
import sys as _s; _s.path.insert(0, P + 'tools'); import exam_name; exam_name.main()   # owner: firm exam naming, labels rebuilt from year / school / task
# owner 11 Nov: source = full school name + task ("2023 Cherrybrook Technology High School AT1"); stored in documents.display_label
for _id, _lab in db.execute('select id, display_label from documents where display_label is not null'):
    if str(_id) in old['docs']: old['docs'][str(_id)]['label'] = _lab
# --- Fix 2: permanent question keys (owner 14 Nov: "Ok we should run Fix 1 and 2"; tools/qkeys.py) -------------------------
# Sets q['key'] ('2022-CSSA-AT4-Q10'; copies share one) and docs[doc]['key'] (paper key); new questions get a key stored in
# questions.db table question_keys. The page addresses reviews, difficulty, exams and reports by these keys. Keep on its own.
import qkeys as _qkeys; _qkeys.attach(db, old['questions'], old['docs'])
# z-score table at the back (tools/ztable.py): matched by key, so only after the keys are attached. Checker 18 Nov: "No z-table at
# the back": this ran before qkeys.attach (no key yet), so no question was ever marked and no exam got the table.
for q in old['questions']:
    if q.get('key') in ZT: q['zt'] = 1
    else: q.pop('zt', None)
# retired questions (state/work/retired.json {key: {question_id, at, by, why}}): out of the bank and new exams, kept in the database so
# a retirement can be undone by deleting its entry. Checker 18 Nov on 2022 Baulkham Hills AT4 Q22: "delete this question"
RETIRED = json.load(open(paths.S + 'work/retired.json')) if os.path.exists(paths.S + 'work/retired.json') else {}
old['questions'] = [q for q in old['questions'] if q.get('key') not in RETIRED]
# --- end Fix 2 ---------------------------------------------------------------------------------------------------------------
out = dict(v=2, built=__import__('datetime').datetime.now().strftime('%Y%m%d%H%M%S'), docs=old['docs'], questions=old['questions'], tables=tables, figs=figs, codes17=codes17)
json.dump(out, open(P + 'site/data/bank.json', 'w'), ensure_ascii=False)
print('questions', len(out['questions']), 'tables', len(tables), 'figs', len(figs), 'svg packs', {k: len(v) for k, v in packs.items()},
      'bank KB', os.path.getsize(P + 'site/data/bank.json') // 1024)
# Fix 1 (owner 14 Nov: "Ok we should run Fix 1 and 2"): the page loads a small index at start and each topic's question text on
# demand: split what was just written (site/data/bank/<course>/, tools/bank_split.py). bank.json itself is still written above.
import bank_split as _split; _split.main()
