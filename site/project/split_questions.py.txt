"""Owner rule (11 Nov): parts that are unrelated questions (old-style school papers: Question 13 (a) graph sketch,
(b) pool volume) become separate questions numbered 13(a), 13(b). Related parts (shared stem, 'hence', 'use part (a)') stay together.
Moves parts (with sub-parts), solutions follow their parts, figures follow their parts, tags follow parts.
Updates questions.db and site/data/bank_v1.json (the per-question shell build_bank.py starts from)."""
import sqlite3, json, copy
P = '/home/claude/pilot/'
SPLIT = {310: None, 311: None, 312: {'a': ['pages/568_10.jpg'], 'b': ['pages/568_11.jpg']}, 325: None}
db = sqlite3.connect('/mnt/user-data/outputs/questions.db')
bank = json.load(open(P + 'site/data/bank_v1.json')); BQ = {q['id']: q for q in bank['questions']}
dec = json.load(open(P + 'site/project/open_decisions.json'))
for qid, pages in SPLIT.items():
    num, = db.execute('select number from questions where id=?', (qid,)).fetchone()
    if '(' in num: continue                                   # already split
    tops = db.execute('select id,label from parts where question_id=? and parent_part_id is null order by ordinal', (qid,)).fetchall()
    def family(pid):
        ids = [pid]
        for c, in db.execute('select id from parts where parent_part_id=?', (pid,)): ids += family(c)
        return ids
    def marks(pid):
        m, = db.execute('select marks from parts where id=?', (pid,)).fetchone()
        return m if m is not None else sum(marks(c) for c, in db.execute('select id from parts where parent_part_id=?', (pid,)))
    bq = BQ[qid]
    for k, (pid, lab) in enumerate(tops):
        fam = family(pid)
        if k == 0:
            newid = qid
        else:
            newid = db.execute('select max(id)+1 from questions').fetchone()[0]
            cols = [c[1] for c in db.execute('pragma table_info(questions)') if c[1] not in ('id',)]
            db.execute(f"insert into questions(id,{','.join(cols)}) select ?,{','.join(cols)} from questions where id=?", (newid, qid))
            db.execute('update questions set review_status=?, review_note=null, stem_latex=null where id=?', ('unreviewed', newid))
            db.execute('update parts set question_id=? where id in (%s)' % ','.join('?' * len(fam)), [newid] + fam)
            db.execute('update figures set question_id=? where part_id in (%s)' % ','.join('?' * len(fam)), [newid] + fam)
            db.execute('update tags set question_id=? where question_id is not null and part_id in (%s)' % ','.join('?' * len(fam)), [newid] + fam)
        db.execute('update questions set number=?, marks_total=? where id=?', (f'{num}({lab})', marks(pid), newid))
        db.execute('update parts set label=null where id=?', (pid,))
        if db.execute('select latex from parts where id=?', (pid,)).fetchone()[0].strip() in ('(%s)' % lab, ''):
            db.execute("update parts set latex='' where id=?", (pid,))
        # bank shell
        nq = bq if k == 0 else copy.deepcopy(bq)
        nq['id'] = newid; nq['number'] = f'{num}({lab})'; nq['marks'] = marks(pid)
        nq['parts'] = [copy.deepcopy(p) for p in bq['parts'] if p['id'] in fam] if k else nq['parts']
        nq['figures'] = [f for f in bq['figures'] if f.get('part') in fam] if k else nq['figures']
        if pages: nq['pages'] = pages[lab]
        if k: nq['related'] = []; nq['stem'] = None; nq['review_note'] = None; bank['questions'].append(nq); BQ[newid] = nq
        print(qid, '->', newid, nq['number'], 'parts', fam)
        if str(qid) in dec and k == 1 and qid == 312: dec[str(newid)] = dec.pop(str(qid))   # the pool decision belongs to part (b)
    first = BQ[qid]; fam0 = family(tops[0][0])
    first['parts'] = [p for p in first['parts'] if p['id'] in fam0]; first['figures'] = [f for f in first['figures'] if f.get('part') in fam0 or f.get('part') is None]
    for p in first['parts']:
        if p['id'] == tops[0][0]: p['label'] = None
for q in bank['questions']:
    for p in q['parts']:
        r = db.execute('select label from parts where id=?', (p['id'],)).fetchone()
        if r: p['label'] = r[0]
db.commit(); json.dump(bank, open(P + 'site/data/bank_v1.json', 'w')); json.dump(dec, open(P + 'site/project/open_decisions.json', 'w'), ensure_ascii=False, indent=1)
