"""Inputs for the independent verifier (owner 12 Nov: "Just build it in, I don't have time to check 6000 questions").
Usage: python3 prep_verify.py <batch> <doc_id> [...]  -> work/<batch>/verify_in_<g>.json (~55 questions each); prints group count.
Each item: question text (stem, parts, options, key), every solution (latex + criteria), the paper's PDF and pages, scan flag."""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import sqlite3, json, sys, os
P = paths.P; B = sys.argv[1]; IDS = [int(a) for a in sys.argv[2:]]
os.makedirs(P + f'work/{B}', exist_ok=True)
db = sqlite3.connect(paths.DBS); db.row_factory = sqlite3.Row
items = []
for d in IDS:
    doc = db.execute('select * from documents where id=?', (d,)).fetchone()
    for q in db.execute('select * from questions where document_id=? order by id', (d,)):
        parts = db.execute('select * from parts where question_id=? order by ordinal,id', (q['id'],)).fetchall()
        sols = db.execute('select s.*, p.label plabel from solutions s left join parts p on p.id=s.part_id where coalesce(s.question_id,p.question_id)=? order by s.id', (q['id'],)).fetchall()
        tabs = {}
        import re
        for t in re.findall(r'\\extable\{(\w+)\}', ' '.join([q['stem_latex'] or ''] + [p['latex'] for p in parts] + [s['latex'] for s in sols])):
            r = db.execute('select rows_json from data_tables where id=?', (t,)).fetchone()
            if r: tabs[t] = json.loads(r[0])
        items.append(dict(question_id=q['id'], paper=doc['display_label'], pdf=str(paths.SRC / f'{d}.pdf'), pages=[q['page_start'], q['page_end']],
                          scan=doc['parse_path'] == 'scan', type=q['question_type'], number=q['number'], marks=q['marks_total'], stem=q['stem_latex'],
                          parts=[dict(part_id=p['id'], label=p['label'], marks=p['marks'], latex=p['latex']) for p in parts],
                          options=[dict(label=o['label'], latex=o['latex'], key=o['is_correct'], fig=o['figure_key']) for o in db.execute('select * from mcq_options where question_id=? order by label', (q['id'],))],
                          tables=tabs, figures=[f['png_path'] for f in db.execute('select png_path from figures where question_id=?', (q['id'],))],
                          solutions=[dict(solution_id=s['id'], part=s['plabel'], source=s['source'], latex=s['latex'], criteria=json.loads(s['criteria_json'] or '[]')) for s in sols]))
k = max(1, round(len(items) / 55))
for g in range(k): json.dump(items[g * len(items) // k:(g + 1) * len(items) // k], open(P + f'work/{B}/verify_in_{g+1}.json', 'w'), ensure_ascii=False, indent=1)
print(k)
