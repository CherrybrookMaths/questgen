"""Unrelated parts become separate questions (PARSE_SPEC "Unrelated parts are separate questions", owner 11 Nov).
  python3 split_batch.py prep <batch> <doc_id> [...]   -> work/<batch>/split_in.json (questions with 2+ lettered parts)
  python3 split_batch.py apply <batch>                  -> applies work/<batch>/split_out.json
split_out.json: {"splits":[{"question_id":123,"groups":[["a"],["b","c"]],"reason":"…"}]}   (top-level part labels)
Each group becomes its own question numbered "<n>(<first label>)" (e.g. 13(a), 13(b)); parts keep their labels; part
solutions, figures and tags move with their parts; question-level solutions/figures stay with the first group.
Run BEFORE tagging/verify where possible (question ids of the later groups are new)."""
import sys, json, sqlite3
P = '/home/claude/pilot/'
db = sqlite3.connect('/mnt/user-data/outputs/questions.db'); db.row_factory = sqlite3.Row
mode, B = sys.argv[1], sys.argv[2]
if mode == 'prep':
    out = []
    for d in [int(a) for a in sys.argv[3:]]:
        lab = db.execute('select display_label from documents where id=?', (d,)).fetchone()[0]
        for q in db.execute('select * from questions where document_id=? order by id', (d,)):
            if '(' in (q['number'] or ''): continue
            tops = db.execute('select * from parts where question_id=? and parent_part_id is null and label is not null order by ordinal,id', (q['id'],)).fetchall()
            if len(tops) < 2: continue
            allp = db.execute('select label, parent_part_id, latex from parts where question_id=? order by ordinal,id', (q['id'],)).fetchall()
            out.append(dict(question_id=q['id'], paper=lab, number=q['number'], stem=q['stem_latex'], top_labels=[t['label'] for t in tops],
                            parts=[dict(label=p['label'], sub=bool(p['parent_part_id']), latex=p['latex'][:600]) for p in allp]))
    json.dump(out, open(P + f'work/{B}/split_in.json', 'w'), ensure_ascii=False, indent=1); print(len(out), 'questions with 2+ parts')
else:
    plan = json.load(open(P + f'work/{B}/split_out.json'))['splits']; n = 0
    def family(pid):
        ids = [pid]
        for (c,) in db.execute('select id from parts where parent_part_id=?', (pid,)).fetchall(): ids += family(c)
        return ids
    def marks(pid):
        m = db.execute('select marks from parts where id=?', (pid,)).fetchone()[0]
        return m if m is not None else sum(marks(c) for (c,) in db.execute('select id from parts where parent_part_id=?', (pid,)).fetchall())
    cols = [c[1] for c in db.execute('pragma table_info(questions)') if c[1] != 'id']
    for s in plan:
        qid, groups = s['question_id'], s['groups']
        if len(groups) < 2: continue
        q = db.execute('select * from questions where id=?', (qid,)).fetchone()
        if not q or '(' in (q['number'] or ''): continue
        tops = {r['label']: r['id'] for r in db.execute('select id,label from parts where question_id=? and parent_part_id is null', (qid,))}
        if sorted(l for g in groups for l in g) != sorted(tops): print('skip (labels do not match)', qid, groups, list(tops)); continue
        num = q['number']
        for k, g in enumerate(groups):
            pids = [x for l in g for x in family(tops[l])]
            tid = qid if k == 0 else db.execute(f"insert into questions({','.join(cols)}) select {','.join(cols)} from questions where id=?", (qid,)).lastrowid
            m = sum(marks(tops[l]) for l in g)
            db.execute('update questions set number=?, marks_total=?, stem_latex=? where id=?', (f'{num}({g[0]})', m, q['stem_latex'] if k == 0 else None, tid))
            if k:
                ph = ','.join('?' * len(pids))
                db.execute(f'update parts set question_id=? where id in ({ph})', [tid] + pids)
                db.execute(f'update figures set question_id=? where part_id in ({ph})', [tid] + pids)
        n += 1
    db.commit(); print('split', n, 'questions')
