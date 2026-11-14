"""Owner rule (11 Nov): every question has working, MCQs included ("why no working out, ensure mcq has working out too").
Lists every MCQ with no solution text, and every leaf part of a written question with no solution text (its own,
its parent's, or the whole question's). Run after loading a paper; the list must be empty before the paper is reviewed.
Exit code 1 if anything is missing."""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import sqlite3, sys
db = sqlite3.connect(sys.argv[1] if len(sys.argv) > 1 else paths.DBS)
has = lambda where, args: any((l or '').strip() for l, in db.execute(f'select latex from solutions where {where}', args))
miss = []
for qid, typ, num, doc in db.execute('select id, question_type, number, document_id from questions'):
    if typ == 'mcq':
        if not has('question_id=? or part_id in (select id from parts where question_id=?)', (qid, qid)): miss.append((doc, num, 'MCQ'))
        continue
    parts = db.execute('select id, label, parent_part_id from parts where question_id=?', (qid,)).fetchall()
    kids = {p for _, _, p in parts if p}
    for pid, lab, par in parts:
        if pid in kids: continue                      # not a leaf
        if not (has('part_id=?', (pid,)) or (par and has('part_id=?', (par,))) or has('question_id=?', (qid,))):
            miss.append((doc, num, f'part {lab or "(whole)"}'))
for m in miss: print('no working:', *m)
print(len(miss), 'missing'); sys.exit(1 if miss else 0)
