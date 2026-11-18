"""Owner decision 11 Nov: errors in source marking guidelines are corrected, with a note.
Each correction: (solution id, [(old, new) in latex], [(old,new) in criteria text], note). Original kept in meta.source_original.
Duplicate copies with identical source text get the same correction."""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import sqlite3, json, re, sys
db = sqlite3.connect(paths.DBS)
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
# Batch 8 (17 Nov, found by the API verifier, VERIFY_SPEC): working lines that contradict the source's own final answer
C += [
 (3503, [(r'D_{\text{Moon}} &= \dfrac{2}{1-0.95}-2', r'D_{\text{Moon}} &= \dfrac{2\times2}{1-0.95}-2'), (r'D_{\text{Earth}} &= \dfrac{2}{1-0.5}-2', r'D_{\text{Earth}} &= \dfrac{2\times2}{1-0.5}-2')], [],
  r'each limiting-sum line was missing the factor 2 (up and down): $\dfrac{2}{1-0.95}-2=38$, not $78$; the final answer $72$ m was right'),
 (3627, [(r'\ln\left(1-e^{2x}\right)+C', r'\ln\left|1-e^{2x}\right|+C')], [], r'the primitive needs an absolute value: $1-e^{2x}<0$ for $x>0$'),
 (3628, [(r'From the graph, the line passes through $(0,0)$ and has gradient', r'From the graph, the line passes through $(4,0)$ and $(0,-2)$, so it has gradient')], [],
  r'the working said the line passes through $(0,0)$; the graph shows $(4,0)$ and $(0,-2)$'),
]
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
# Batch 8 (17 Nov), 2023 Knox AT4 Q14(d) (QID 2522): the answer 2 holds only for x >= 1 and the paper gives no domain (API verifier).
# Smallest edit so the question has one answer (owner 12 Nov on flawed questions: "fix it"); goes to Check as edited_from_original.
if db.execute("select 1 from parts where id=4105 and latex not like '%x \\ge 1%'").fetchone():
    db.execute(r"update parts set latex=replace(latex, 'Simplify $\sqrt{x^2+2x+1}-\sqrt{x^2-2x+1}$.', 'Simplify $\sqrt{x^2+2x+1}-\sqrt{x^2-2x+1}$ for $x \ge 1$.') where id=4105")
    m = json.loads(db.execute('select meta_json from solutions where id=3499').fetchone()[0] or '{}')
    m['edited_from_original'] = r'The paper printed "Simplify $\sqrt{x^2+2x+1}-\sqrt{x^2-2x+1}$." with no domain; the answer $2$ needs $x\ge1$ (it is $2x$ for $-1\le x\le1$ and $-2$ for $x\le-1$), so "for $x \ge 1$" was added.'
    db.execute('update solutions set meta_json=? where id=3499', (json.dumps(m, ensure_ascii=False),))
# Batch 8 (17 Nov): formatter flags on slips in the source that the stored solution already fixes, with the independent checker
# agreeing on the answer, are not owner calls (owner 12 Nov: "if you are certain the source is wrong and your maths is right, just
# overwrite it"): the flag becomes overwritten_from_source. Notes that only say the source is consistent go to format_note (SOLUTION_SPEC).
B8_OVERWRITTEN = {3439: None, 3459: None, 3506: None, 3550: None, 3470: None, 3571: None, 3503: 'corrected', 3627: 'corrected', 3628: 'corrected'}
B8_NOTE_ONLY = (3488, 3572)
for sid in list(B8_OVERWRITTEN) + list(B8_NOTE_ONLY):
    r = db.execute('select meta_json from solutions where id=?', (sid,)).fetchone()
    if not r: continue
    m = json.loads(r[0] or '{}')
    if m.get('overwritten_from_source') or m.get('b8_flag_settled'): continue
    if sid in B8_OVERWRITTEN:
        m['overwritten_from_source'] = (m.get(B8_OVERWRITTEN[sid]) if B8_OVERWRITTEN[sid] else m.pop('source_flag', None)) or ''
    else:
        m['format_note'] = ((m.get('format_note') or '') + ' Source check: ' + (m.pop('source_flag', None) or '')).strip()
    m['b8_flag_settled'] = True
    db.execute('update solutions set meta_json=? where id=?', (json.dumps(m, ensure_ascii=False), sid))
# Batch 9 (18 Nov, API verifier, VERIFY_SPEC): mistakes copied from the schools' solutions; owner 12 Nov: "if you are certain the source
# is wrong and your maths is right, just overwrite it". Mark mismatches between a paper and its guideline (2637(b), 2765(b), 2766(b) and
# 570 Q23) are left for the checker: they are a call on the paper, not maths.
C9 = [
 (3716, [(r'&=12.004384\ldots', r'&=12.004834\ldots')], [], r'the intermediate value read $12.004384\ldots$; the bracket sum is $12.004834\ldots$ (the answer $12.0$ was right)'),
 (3676, [(r'The monthly amount $M$ must satisfy $65.6316M=17\,176$.', r'The monthly amount $M$ must satisfy $65.6316M=17\,176.18$.'),
         (r'M&=\dfrac{17\,176}{65.6316} \\ &\approx 261.70320394 \\ &\approx \$261.71', r'M&=\dfrac{17\,176.18}{65.6316} \\ &\approx 261.70595 \\ &\approx \$261.71')], [],
  r'the working divided $17\,176$ (giving $261.7032\ldots$, which rounds to $\$261.70$); Julia\'s full amount $17\,176.18$ gives $261.706\ldots\approx\$261.71$'),
 (3888, [(r'\sin x &= \dfrac{-1 \pm \sqrt{5}}{2} \end{aligned}$$' + '\nHence', r'\sin x &= \dfrac{-1 \pm \sqrt{5}}{2} \end{aligned}$$' + '\n' + r'$\dfrac{-1-\sqrt{5}}{2}<-1$ has no solution, so $\sin x=\dfrac{\sqrt{5}-1}{2}$.' + '\n\nHence'),
         (r'points of inflexion at about $(0.7, 1.9)$ and $(2.5, 1.8)$.', r'points of inflexion at about $(0.7, 1.9)$ and $(2.5, 1.9)$ (both have $y=e^{\sin x}=e^{0.618\ldots}\approx1.86$).')], [],
  r'the second point read $(2.5, 1.8)$; both points have $y=e^{0.618\ldots}\approx1.86$, and the root $\dfrac{-1-\sqrt5}{2}$ is now rejected'),
 (3905, [(r'so they would be advertising to the smallest share of the profit.' + '\n\nOne of these two reasons is sufficient.',
          r'so they would be advertising to the smallest share of the profit.' + '\n\nOr: fish and birds are the smallest percentages of customers, so the store may be trying to grow those parts of the business.' + '\n\nOne of these two reasons is sufficient.')], [],
  r'the solution said "one of these two reasons" but gave only one; the guideline\'s second reason is added'),
 (3648, [(r'So $x+\pi$ becomes $\dfrac{x+\pi}{3}$.', r'Then $x$ is replaced by $\dfrac{x}{3}$ in $\ln(x+\pi)$, so $x+\pi$ becomes $\dfrac{x}{3}+\pi$.'),
         (r'$$y=\ln\left(\dfrac{x+\pi}{3}\right)$$' + '\nThis is option D.', r'$$y=\ln\left(\dfrac{x}{3}+\pi\right)$$' + '\n' + r'This is option A. (Option D, $\ln\left(\dfrac{x+\pi}{3}\right)$, is the result of dilating first and then translating.)')], [],
  r'the key was D; translating left by $\pi$ then dilating horizontally by 3 gives $\ln\left(\dfrac{x}{3}+\pi\right)$, option A'),
]
for sid, lat, crit, note in C9:
    if db.execute("select 1 from solutions where id=? and meta_json like '%\"corrected\"%'", (sid,)).fetchone(): continue
    apply(sid, lat, crit, note)
    m = json.loads(db.execute('select meta_json from solutions where id=?', (sid,)).fetchone()[0]); m['overwritten_from_source'] = m['corrected']
    db.execute('update solutions set meta_json=? where id=?', (json.dumps(m, ensure_ascii=False), sid))
if db.execute("select is_correct from mcq_options where question_id=2610 and label='D'").fetchone()[0]:
    db.execute("update mcq_options set is_correct=(label='A') where question_id=2610")
# Batch 9: typos printed in 2022 Baulkham Hills AT2 (doc 570), fixed (PARSE_SPEC "Mistakes in the paper are fixed")
for pid, o, n in [
    (4466, 'For what values of $x$ the function', 'For what values of $x$ is the function'),
    (4470, 'express you answer', 'expressing your answer'),
    (4471, 'GiventThe shaded area', 'Given the shaded area'),
    (4479, 'On the axes givenbelow,', 'On the axes given below,'),
    (4490, 'thevpoint of inflexion', 'the point of inflexion'),
    (4493, '$y = cox(2x)$ .', '$y = \\cos(2x)$.'),
    (4497, 'Sketch thegiven axex, draw the graph of $y = e^{\\sin x}$ , showing all the information obtained .in parts a) to c).',
           'On the given axes, draw the graph of $y = e^{\\sin x}$, showing all the information obtained in parts (a) to (c).')]:
    db.execute('update parts set latex=replace(latex, ?, ?) where id=?', (o, n, pid))
# 570 Q24: the third part is printed (f) after (a), (b); the solutions call it (c)
db.execute("update parts set label='c' where id=4490 and label='f'")
# Checker flags, 18 Nov (Batch 9; FLAGS.md): owner 17 Nov "just fix it and put it back in the review list"
# 2022 Ascham AT4 Q32(i) (QID 2735), "add the tree diagram to part (i)": the branch list becomes a drawn tree (1320_q32_s1)
_l = db.execute('select latex from solutions where id=3837').fetchone()[0]
_old = r"""Let $S$ be the event that Sam plays. The tree has these branches:
$$\begin{aligned} S\ (80\%):&\quad W\ 73\%,\ L\ 7\%,\ D\ 20\% \\ \bar S\ (20\%):&\quad W\ 55\%,\ L\ 20\%,\ D\ 25\% \end{aligned}$$"""
if '1320_q32_s1' not in _l and _old in _l:
    db.execute('update solutions set latex=? where id=3837', (_l.replace(_old, "Let $S$ be the event that Sam plays, and $W$, $L$, $D$ a win, loss or draw.\n\n\\exfigure{1320_q32_s1}"),))
# 2022 Baulkham Hills AT2 Q23 (QID 2763), "Make the total marks to 6": the parts are 1 + 2 + 3
db.execute("update questions set marks_total=6 where id=2763 and marks_total=5")
# 2022 Baulkham Hills AT2 Q25 (QID 2765), "Make part b a 2mark question and edit the total marks": (b) 1 -> 2, total 6 -> 7
db.execute("update parts set marks=2 where id=4492 and marks=1")
db.execute("update questions set marks_total=7 where id=2765 and marks_total=6")
# 2023 Western Mathematics AT4 Q31(b) (QID 2637), "Add a third criterion to part b": the part is worth 3, the guideline marked out of 2
_c = json.loads(db.execute('select criteria_json from solutions where id=3695').fetchone()[0] or '[]')
if _c and _c[0][0] == 2:
    db.execute('update solutions set criteria_json=? where id=3695', (json.dumps([
        [3, 'Correct answer'],
        [2, r'Obtains $M_n=A(1.003)^n-9\,000\left[1+1.003+\cdots+1.003^{n-1}\right]$, or equivalent merit'],
        [1, r'Writes $M_1=A(1.003)-9\,000$ and $M_2$ correctly, or equivalent merit']], ensure_ascii=False),))
# Batch 10 (18 Nov, API verifier, VERIFY_SPEC): slips copied from the schools' solutions; owner 12 Nov "if you are certain the source is
# wrong and your maths is right, just overwrite it". 2022 Baulkham Hills AT4 Q22 (QID 2803, tan^2 x integrated across its asymptote) is a
# flawed question with no knowable intended limits: left for the owner, not guessed.
C10 = [
 (4330, [(r'&\approx 66.43\end{aligned}$$', r'&\approx 66.44\end{aligned}$$'), (r'\text{More years}&=66.43-20\\ &=40.43', r'\text{More years}&=66.44-20\\ &=46.44'),
         (r'\text{about } 40.43 \text{ more years}', r'\text{about } 46.44 \text{ more years}')], [],
  r'the subtraction read $66.43-20=40.43$; $t=\dfrac{20\ln10}{\ln2}\approx66.44$, so about $46.44$ more years (the school solution had the same slip)'),
 (4291, [(r'&= 330\dfrac{11}{27} \text{ cm}^3 \end{aligned}', r'&= \dfrac{8192}{27} = 303\dfrac{11}{27} \text{ cm}^3 \end{aligned}'),
         (r'\text{maximum volume } 330\dfrac{11}{27}\text{ cm}^3', r'\text{maximum volume } 303\dfrac{11}{27}\text{ cm}^3')], [],
  r'the volume read $330\dfrac{11}{27}$ (digits swapped in the school answer); $V\left(\dfrac83\right)=\dfrac{8192}{27}=303\dfrac{11}{27}$ cm$^3$'),
 (4149, [(r'$$2.03\times 365 \approx 740 \text{ days}$$', r'$$2.0279\ldots\times 365 \approx 740 \text{ days}$$')], [],
  r'the conversion used the rounded $2.03$ ($2.03\times365=740.95$); the unrounded $t=2.0279\ldots$ gives $740$ days'),
 (4203, [(r'The inequality reverses when dividing by $-0.1186$. Rounding to the nearest minute as asked:',
          r'The inequality reverses when dividing by $-0.1186$. Rounding $24.37$ to the nearest minute gives $24$, but $N(24)\approx105>100$, so round up to the next whole minute:')], [],
  r'the working said the answer came from rounding to the nearest minute; $24.37$ rounds to $24$, which is too early ($N(24)\approx105$), so it must be rounded up to $25$'),
]
for sid, lat, crit, note in C10:
    if db.execute("select 1 from solutions where id=? and meta_json like '%\"corrected\"%'", (sid,)).fetchone(): continue
    apply(sid, lat, crit, note)
    m = json.loads(db.execute('select meta_json from solutions where id=?', (sid,)).fetchone()[0]); m['overwritten_from_source'] = m['corrected']
    db.execute('update solutions set meta_json=? where id=?', (json.dumps(m, ensure_ascii=False), sid))
# 2022 Gosford AT4 Q15(ii) sign table: f'(-1) = 8(-1)^3 - 5(-1)^4 = -13, not -12 (the sign, and so the conclusion, was right)
_r = db.execute("select rows_json from data_tables where id='Ts4321_1'").fetchone()
if _r and '"-12"' in _r[0]: db.execute("update data_tables set rows_json=? where id='Ts4321_1'", (_r[0].replace('"-12"', '"-13"'),))
# Batch 10: a formatter flag that only says the source working is consistent is a note, not an owner call (as B8_NOTE_ONLY)
for sid in (4083,):
    m = json.loads(db.execute('select meta_json from solutions where id=?', (sid,)).fetchone()[0] or '{}')
    if m.get('source_flag'):
        m['format_note'] = ((m.get('format_note') or '') + ' Source check: ' + m.pop('source_flag')).strip()
        db.execute('update solutions set meta_json=? where id=?', (json.dumps(m, ensure_ascii=False), sid))
db.commit(); print('done')
