"""Second paragraph-break check: two copies of the same paper (duplicate questions) must have the same breaks.
Where the words are identical but one copy has more paragraph breaks, the other copy is lost breaks -> copy them over."""
import sqlite3, re
db = sqlite3.connect('/mnt/user-data/outputs/questions.db'); norm = lambda s: re.sub(r'\s+', ' ', s).strip(); m = 0
for a, b in db.execute("select question_id,related_id from related_questions where relation='duplicate'").fetchall():
    pa = db.execute('select id,latex from parts where question_id=? order by ordinal', (a,)).fetchall()
    pb = db.execute('select id,latex from parts where question_id=? order by ordinal', (b,)).fetchall()
    sa, = db.execute('select stem_latex from questions where id=?', (a,)).fetchone(); sb, = db.execute('select stem_latex from questions where id=?', (b,)).fetchone()
    for t, c, ia, ta, ib, tb in [('questions', 'stem_latex', a, sa, b, sb)] + [('parts', 'latex', x[0], x[1], y[0], y[1]) for x, y in zip(pa, pb)]:
        if not ta or not tb or ta == tb or norm(ta) != norm(tb): continue
        best, other = (ta, ib) if ta.count('\n\n') > tb.count('\n\n') else (tb, ia)
        db.execute(f'update {t} set {c}=? where id=?', (best, other)); m += 1
db.commit(); print('synced', m)
