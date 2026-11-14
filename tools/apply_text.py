"""Apply an import batch's text-stage outputs: tags, formatted solutions, generated solutions.
Usage: python3 apply_text.py <batch>
Reads tag/out_<batch>_*.json, work/solfmt_<batch>_*.json, work/<batch>/gen_out_*.json (whatever exists).
Then: removed parts without a syllabus flag get one (annuity/interest tables -> Standard MST-12-S2-03; Pareto -> old
syllabus; others listed for a manual call), house_style, coverage report."""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import json, sqlite3, glob, sys, subprocess, re
P = paths.P; B = sys.argv[1]
db = sqlite3.connect(paths.DBS)
tags = sorted(glob.glob(P + f'tag/out_{B}_*.json'))
if tags: print(subprocess.run(['python3', P + 'tools/load_tags_batch.py'] + tags, capture_output=True, text=True).stdout.strip())
n = 0
for f in sorted(glob.glob(P + f'work/solfmt_{B}_*.json')):
    for r in json.load(open(f))['results']:
        meta = dict(r.get('meta') or {})
        if r.get('marker_note'): meta['marker_note'] = r['marker_note']
        if r.get('content_flags') and 'corrected' not in meta: meta.setdefault('source_flag', r['content_flags'])
        db.execute('update solutions set latex=?, criteria_json=?, meta_json=? where id=?', (r['latex'], json.dumps(r['criteria'], ensure_ascii=False), json.dumps(meta, ensure_ascii=False), r['id'])); n += 1
g = 0; figs = []
for f in sorted(glob.glob(P + f'work/{B}/gen_out_*.json')):
    d = json.load(open(f))
    for s in d['solutions']:
        qid, pid = s['question_id'], s.get('part_id')
        doc = db.execute('select document_id from questions where id=?', (qid,)).fetchone()[0]
        if pid: db.execute("delete from solutions where source='generated' and part_id=?", (pid,))
        else: db.execute("delete from solutions where source='generated' and question_id=?", (qid,))
        db.execute('insert into solutions(part_id,question_id,source,latex,source_document_id,model,prompt_version,criteria_json,meta_json) values (?,?,?,?,?,?,?,?,?)',
                   (pid, None if pid else qid, 'generated', s['latex'], doc, 'claude-opus-5-5', 'gen-v2', json.dumps(s['criteria'], ensure_ascii=False), json.dumps(s.get('meta') or {}, ensure_ascii=False))); g += 1
    for q, k in (d.get('mcq_keys') or {}).items():
        if not db.execute('select 1 from mcq_options where question_id=? and is_correct=1', (int(q),)).fetchone():
            db.execute("update mcq_options set is_correct=(label=?), key_source='generated' where question_id=?", (k, int(q)))
    figs += d.get('figures') or []
if figs:
    json.dump({'results': figs}, open(P + f'tikz/result_{B}_gen.json', 'w'))
db.commit(); print('formatted', n, 'generated', g, 'gen figures', len(figs))
# syllabus flags for removed parts
ids = set()
for f in tags:
    for r in json.load(open(f))['results']:
        if r['status'] == 'removed': ids.add((r['part_id'], r.get('reason') or ''))
manual = []
for pid, why in ids:
    q = db.execute('select q.id, q.standard_topic, q.old_syllabus, q.document_id, q.number from parts p join questions q on q.id=p.question_id where p.id=?', (pid,)).fetchone()
    if q[1] or q[2]: continue
    w = why.lower()
    if re.search(r'annuit|interest factor|future value|present value', w):
        db.execute("update questions set standard_topic='Standard, Year 12: Investment, loans and annuities (annuity table lookup) (MST-12-S2-03)' where id=?", (q[0],))
    elif re.search(r'3d|three.dimension', w):
        db.execute("update questions set old_syllabus='3D trigonometry: now Year 11 Extension 1 (2024 syllabus), not Advanced' where id=?", (q[0],))
    elif 'pareto' in w:
        db.execute("update questions set old_syllabus='Pareto chart (statistics of a data set); in neither 2024 syllabus' where id=?", (q[0],))
    elif re.search(r'bivariate|correlat|regression|scatter|least.squares', w):
        db.execute("update questions set standard_topic='Standard, Year 12: Bivariate data analysis (MST-12-S1-06)' where id=?", (q[0],))
    elif re.search(r'box ?plot|quartile|outlier|skew|median|mean|standard deviation of (a|the) (data|sample)|histogram|five.number', w):
        db.execute("update questions set standard_topic='Standard, Year 11: Data analysis (MST-11-08)' where id=?", (q[0],))
    elif re.search(r'flat rate|effective|simple interest|relation', w):
        db.execute('update questions set old_syllabus=? where id=?', (why[:200], q[0]))
    else: manual.append((q[0], q[3], q[4], why[:100]))
db.commit()
print('removed parts needing a manual syllabus call:', manual)
print(subprocess.run(['python3', P + 'tools/house_style.py'], capture_output=True, text=True).stdout.strip().splitlines()[-1])
print(subprocess.run(['python3', P + 'tools/coverage_check.py'], capture_output=True, text=True).stdout.strip().splitlines()[-1])
