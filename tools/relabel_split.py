"""Relabel questions that were one part of a larger question on the paper (owner 12 Nov:
"questions which were a part of a larger unrelated question should have their old lettering removed. If that question has
layers, they should be shifted one level up, from i, ii to a,b,c").
A question whose only top-level part carries a label (e.g. Q13(d), Q9(b) with (i)(ii)(iii)) loses that label; its sub-parts
move up one level: i, ii, iii -> a, b, c (their own sub-parts -> i, ii, iii). Cross-references in the question, options and
solutions ("part (ii)", "from (i)") follow. The paper's label is kept in parts.src_label; the source line (Q9(b)) is unchanged.
Idempotent: a part with src_label set is never relabelled again."""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import sqlite3, re, string, sys
DB = paths.DBS
db = sqlite3.connect(DB); db.row_factory = sqlite3.Row
if 'src_label' not in [c[1] for c in db.execute('pragma table_info(parts)')]:
    db.execute('alter table parts add column src_label text')
ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x']
changed = []
for q in db.execute('select id, number from questions').fetchall():
    parts = db.execute('select * from parts where question_id=? order by ordinal, id', (q['id'],)).fetchall()
    tops = [p for p in parts if p['parent_part_id'] is None]
    if len(tops) != 1 or not tops[0]['label'] or tops[0]['src_label'] is not None: continue
    top = tops[0]; mapping = {}
    db.execute('update parts set src_label=label, label=NULL where id=?', (top['id'],))
    kids = [p for p in parts if p['parent_part_id'] == top['id']]
    for i, k in enumerate(kids):
        new = string.ascii_lowercase[i]
        if k['label']: mapping[k['label']] = new
        db.execute('update parts set src_label=label, label=? where id=?', (new, k['id']))
        for j, g in enumerate([p for p in parts if p['parent_part_id'] == k['id']]):
            db.execute('update parts set src_label=label, label=? where id=?', (ROMAN[j], g['id']))
    if mapping:   # cross-references: (ii) -> (b), only for labels that moved, never inside \command or after a letter/digit
        pat = re.compile(r'(?<![A-Za-z0-9_\\])\((' + '|'.join(sorted(map(re.escape, mapping), key=len, reverse=True)) + r')\)')
        fix = lambda s: pat.sub(lambda m: '(' + mapping[m.group(1)] + ')', s) if s else s
        for p in parts: db.execute('update parts set latex=? where id=?', (fix(p['latex']), p['id']))
        st = db.execute('select stem_latex from questions where id=?', (q['id'],)).fetchone()[0]
        db.execute('update questions set stem_latex=? where id=?', (fix(st), q['id']))
        for s in db.execute('select id, latex from solutions where question_id=? or part_id in (select id from parts where question_id=?)', (q['id'], q['id'])).fetchall():
            db.execute('update solutions set latex=? where id=?', (fix(s['latex']), s['id']))
        for o in db.execute('select id, latex from mcq_options where question_id=?', (q['id'],)).fetchall():
            db.execute('update mcq_options set latex=? where id=?', (fix(o['latex']), o['id']))
    changed.append((q['id'], q['number'], top['label'], mapping))
if '--dry' in sys.argv: db.rollback()
else: db.commit()
print(len(changed), 'questions relabelled;', sum(1 for c in changed if c[3]), 'with sub-parts moved up')
for c in changed[:8]: print(' ', c)
