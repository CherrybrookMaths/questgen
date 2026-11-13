"""Owner decision 11 Nov: errors in source marking guidelines are corrected, with a note.
Each correction: (solution id, [(old, new) in latex], [(old,new) in criteria text], note). Original kept in meta.source_original.
Duplicate copies with identical source text get the same correction."""
import sqlite3, json, re, sys
db = sqlite3.connect('/mnt/user-data/outputs/questions.db')
C = [
 (25, [(r'\dfrac{1+\cos}{\sin x}', r'\dfrac{1+\cos x}{\sin x}')], [], r'integrand was missing the $x$ after $\cos$'),
 (49, [(r'\int_e^{e^2}\dfrac{1-x}{x\ln x}', r'\int_e^{e^2}\dfrac{1-\ln x}{x\ln x}')], [], r'integrand in the evaluation line read $\dfrac{1-x}{x\ln x}$'),
 (60, [], [('$E(X)=2.8$', '$E(X)=2.08$')], 'the 2-mark criterion said $E(X)=2.8$'),
 (61, [], [('size 5 and size 8', 'size 5 and size 10')], 'the 1-mark criterion said sizes 5 and 8'),
 (67, [(r'2\times 91.181\times 68.335\times\cos', r'2\times 91.181\times 95.800\times\cos')], [], r'the cosine-rule line used $68.335$ in place of $95.800$'),
 (77, [(r'S'"'"r'(2) &= |-10010\ln 3\times 3^{-0.182\times 2}| \\ &= -7372.3576\ldots \\ &\approx 7372', r'S'"'"r'(2) &= -10010\ln 3\times 3^{-0.182\times 2} \\ &= -7372.3576\ldots \\ \text{speed} &= |S'"'"r'(2)| \approx 7372')], [], 'an absolute value was set equal to a negative number'),
 (80, [(r'first term $a=H$ and common ratio', r'first term $a=\dfrac{qH}{100}$ (the first rebound) and common ratio'),
       (r'h_2 &= H\times\left(\dfrac{q}{100}\right)^2', r'h_2 &= \dfrac{qH}{100}\times\dfrac{q}{100}')], [], r'the first term was given as $H$, which would make $h_2=\dfrac{qH}{100}$'),
 (84, [], [('surface area of tent', 'area of the cross-section of the tent')], 'the 1-mark criterion said "surface area"; the working finds the cross-sectional area'),
 (88, [(r'\,dx=\ln x+c', r'\,dx=\ln|f(x)|+c')], [], r'the standard result was written $\ln x+c$'),
 (94, [(r'r &= 5.6\ldots \quad', r'r &= 5.686\ldots \quad'), (r'$$P=6\times5.6\ldots=34.11$$', r'$$P=6\times5.686\ldots=34.11\ldots\approx 34\text{ cm}$$')], [], r'$r$ was shown as $5.6\ldots$ and the final rounding to the nearest centimetre was missing'),
 (102, [(r'&= 0.9772-0.843 \\', r'&= 0.9772-0.8413 \\'), (r'$$\therefore\ (0.1587-0.0228)\times26\times10^6$$', r'$$\therefore\ (0.1587-0.0228)\times26\times10^6\approx3.53\times10^6$$')], [], r'$0.8413$ was written $0.843$, and Method 3 had no final value'),
 (104, [('0.615,\\ 2.5262', '0.615,\\ 2.526')], [], 'the second solution was given to 4 decimal places ($2.5262$)'),
 (122, [(r'= -(e+1)^3x+(e+1)^2 \\', r'= -(e+1)^3x+(e+1)^3 \\')], [], r'one line ended $+(e+1)^2$ instead of $+(e+1)^3$'),
 (127, [(r'\displaystyle\lim_{x\to\infty}\int_0^x e^{-\frac12x}\,dx', r'\displaystyle\int_0^x e^{-\frac12t}\,dt'), (r'-2\left(1-e^{-\frac12x}\right), & 0', r'2\left(1-e^{-\frac12x}\right), & 0')], [], r'the middle piece of $F(x)$ had a wrong minus sign, and a spurious limit stood in front of the integral'),
 (128, [(r'-2\left(1-e^{-\frac{x}{2}}\right) &= \dfrac12', r'2\left(1-e^{-\frac{x}{2}}\right) &= \dfrac12')], [], 'the sign error from part (b) was carried into this line'),
 (145, [(r'These are $20^{\text{th}}$ Feb and $4^{\text{th}}$ Oct.', r'These are $20^{\text{th}}$ Feb and $5^{\text{th}}$ Oct.')], [], r'$t=10.1474$ was called 4th Oct but the answer used 5th Oct'),
 (350, [(r'\dfrac{50^2 + 58^2 - 97^2}{2(50)(58)}\ldots$$', r'\dfrac{50^2 + 58^2 - 97^2}{2(50)(58)}=-0.611\ldots$$' + '\n' + r'$$\angle MTC \approx 127.7^\circ,\qquad 247^\circ - 127.7^\circ \approx 119^\circ\text{T}$$')], [], 'Method 2 stopped part-way in the source; completed'),
 (392, [(r'\dfrac{1000}{9990}', r'\dfrac{1000}{999}'), (r'\dfrac{109}{33300}', r'\dfrac{109}{3330}')], [], r'two intermediate steps read $\dfrac{1000}{9990}$ and $\dfrac{109}{33300}$'),
 (395, [('$$12, 9, 6.75, 5.0625, \\ldots$$', '$$12, 9.6, 7.68, 6.144, \\ldots$$')], [], r'the listed terms used ratio $\dfrac34$ instead of $\dfrac45$'),
]
A = re.compile(r'(?<![A-Za-z\\])a(?![A-Za-z])')
def apply(sid, lat, crit, note, extra=None):
    l0, c0, m0 = db.execute('select latex, criteria_json, meta_json from solutions where id=?', (sid,)).fetchone()
    l, c = l0, json.loads(c0 or '[]')
    for o, n in lat:
        assert o in l, (sid, o); l = l.replace(o, n)
    for o, n in crit:
        hit = False
        for row in c:
            if o in row[1]: row[1] = row[1].replace(o, n); hit = True
        assert hit, (sid, o)
    if extra: l, c = extra(l, c)
    m = json.loads(m0 or '{}'); m.setdefault('source_original', {'latex': l0, 'criteria': json.loads(c0 or '[]')})
    m.pop('source_flag', None); m['corrected'] = 'Corrected from source: ' + note + '.'
    db.execute('update solutions set latex=?, criteria_json=?, meta_json=? where id=?', (l, json.dumps(c, ensure_ascii=False), json.dumps(m, ensure_ascii=False), sid))
    # identical copies (duplicate papers)
    for sid2, in db.execute('select id from solutions where latex=? and id!=?', (l0, sid)).fetchall():
        print('  also duplicate solution', sid2); db.execute('update solutions set latex=?, criteria_json=?, meta_json=? where id=?', (l, json.dumps(c, ensure_ascii=False), json.dumps(m, ensure_ascii=False), sid2))
TWINS = {60: 407, 61: 408, 67: 414, 77: 424, 84: 431, 88: 435}  # same question in a second copy of the paper
for sid, lat, crit, note in list(C) + [(TWINS[x[0]],) + tuple(x[1:]) for x in C if x[0] in TWINS]:
    if db.execute("select 1 from solutions where id=? and meta_json like '%\"corrected\"%'", (sid,)).fetchone(): continue
    apply(sid, lat, crit, note)
# 133: stem names the radius r, part (a) and the solution use R -> stem corrected to R
if db.execute("select 1 from questions where id=99 and stem_latex like '%radius $r$%'").fetchone():
    db.execute("update questions set stem_latex=replace(stem_latex,'radius $r$','radius $R$') where id=99")
    apply(133, [], [], 'the question named the radius $r$ but part (a) and this working use $R$; the question now says $R$')
# 372: question defines OA = d, source solution used a throughout
if db.execute("select 1 from solutions where id=372 and meta_json not like '%\"corrected\"%'").fetchone():
    apply(372, [], [], 'the question calls the distance $OA$ $d$, but the source solution used $a$; changed to $d$ throughout',
          extra=lambda l, c: (A.sub('d', l), [[m, A.sub('d', t)] for m, t in c]))
# 394: no criteria in the source
if db.execute("select 1 from solutions where id=394 and meta_json not like '%\"corrected\"%'").fetchone():
    l0, c0, m0 = db.execute('select latex, criteria_json, meta_json from solutions where id=394').fetchone()
    m = json.loads(m0 or '{}'); m.pop('source_flag', None); m['corrected'] = 'The source had no marking criteria; these were written by Claude.'
    crit = [[2, 'Correct answer'], [1, r'Uses $|r|<1$ with $r=\dfrac{x-2}{2}$, or equivalent merit']]
    db.execute('update solutions set criteria_json=?, meta_json=? where id=394', (json.dumps(crit), json.dumps(m)))
# 312(b): 'minut' is cut off in the source too
db.execute("update parts set latex=replace(latex,'cubic metres/minut\n','cubic metres/minute.\n') where id=488")
db.commit(); print('done')
