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
# Checker flags, 23 Nov (owner: "run open flags too pls"; FLAGS.md)
# 2022 Normanhurst Boys AT4 Q9 (QID 3350), "Change the solution: add the equation of the addition of the probabilities equal 1":
# the sum of the table's probabilities written out and solved (the old working had no table values)
_l = db.execute('select latex, meta_json from solutions where id=5166').fetchone()
if _l and '0.54' not in _l[0]:
    _m = json.loads(_l[1] or '{}'); _m.pop('generated_note', None); _m.pop('self_check', None)
    _m['edited_from_original'] = 'Claude 23 Nov (checker flag): the sum of the probabilities written out with the table values'
    db.execute('update solutions set latex=?, meta_json=? where id=5166', ("""The probabilities of a discrete probability distribution sum to $1$:
$$0.12+\\dfrac{a}{2}+a+0.35+0.07+a=1$$
$$0.54+\\dfrac{5a}{2}=1$$
$$\\dfrac{5a}{2}=0.46$$
$$a=0.184$$
Hence the correct option is C.""", json.dumps(_m, ensure_ascii=False)))
# 2022 Sydney Boys AT4 Q29 (QID 3622), "Change so that the total marks is 6 rather than 5": the paper's heading says 5 marks but its
# parts are 3 + 3 (PARSE_SPEC "Mistakes in the paper are fixed")
db.execute("update questions set marks_total=6 where id=3622 and marks_total=5")
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
# Batch 11 (18 Nov, API verifier, VERIFY_SPEC): slips copied from the schools' solutions and parse mix-ups; owner 12 Nov "if you are certain
# the source is wrong and your maths is right, just overwrite it". Left for the owner / checker, not guessed: 2022 Knox AT4 Q7 (QID 3284,
# the paper's probability table sums to 1.2), the duplicated "D." inside 2022 Hornsby AT4 Q10's option crop (3070), and the extra
# ticks on 2022 James Ruse AT4 Q3's redrawn options (3200).
_ANS_4655 = db.execute('select latex from solutions where id=4655').fetchone()[0]
def _swap_coin(l, c):   # 2022 Knox AT1 Q4: part 4(c)(i)'s coin-game working was stored under 4(b)(i); 4(c)(i) held a broken fragment
    return _ANS_4655, [[2, 'Correct answer'], [1, r'$P(LLW)=\dfrac{9}{64}$, or equivalent merit']]
def _defective(l, c):
    return (r"Each item is defective with probability $0.05$, independently, so" + "\n" +
            r"$$P(\text{all three defective})=0.05^3=\dfrac{1}{8000}=0.000125$$"), [[1, 'Correct answer']]
def _crit5(l, c):       # 5-mark question, the guideline stopped at 3
    return l, [[5, 'Correct answer'],
               [4, 'Finds the stationary points, their nature, the point of inflexion and the global minimum, with a sketch that has one error, or equivalent merit'],
               [3, 'Finds the stationary points and their nature, and the point of inflexion, or equivalent merit'],
               [2, 'Finds the stationary points and their nature, or equivalent merit'],
               [1, r'Finds $x=-2$ and $x=1$, or equivalent merit']]
C11 = [
 (4450 + 1, [(r'The $x$-intercept (other than $x=0$) is at $x = 4$.', r'The $x$-intercept (other than $x=0$) is at $x = 2$, since $f(x) = 2x^2(2-x)$.')], [],
  r'the working said the other $x$-intercept is $x=4$; $f(x)=2x^2(2-x)$ gives $x=2$, as the sketch shows', None),
 (4462, [(r'For $595$ mL, $z = -1$, so $P(595 < X < 600) = 0.34$.', r'For $595$ mL, $z = -1$. From the table, $P(z < 1) = 0.841$, so by symmetry $P(595 < X < 600) = P(0 < z < 1) = 0.841 - 0.5 = 0.341$.'),
         (r'&= 0.34 + 0.155 \\ &= 0.495', r'&= 0.341 + 0.155 \\ &= 0.496'), (r'\text{about } 49.5\% \text{ of bottles}', r'\text{about } 49.6\% \text{ of bottles}')], [],
  r'the working used $0.34$ from the empirical rule; the given table gives $0.841-0.5=0.341$, so $49.6\%$', None),
 (4474, [(r'The bars of a Pareto chart show the percentage for each reason, and the cumulative line adds them.', r'The bars of a Pareto chart show the number of students for each reason (left axis); the cumulative line shows the running percentage (right axis).')], [],
  r'the working said the bars show percentages; they show counts, and only the cumulative line is in percent', None),
 (4494, [(r'&= \dfrac{1}{26}\left[(x-1)^3 - 1\right] \end{aligned}$$', r'&= \dfrac{1}{26}\left[(x-1)^3 - 1\right] \end{aligned}$$' + '\n' + r'$$F(x) = \begin{cases} 0 & x < 2 \\ \dfrac{1}{26}\left[(x-1)^3 - 1\right] & 2 \le x \le 4 \\ 1 & x > 4 \end{cases}$$')], [],
  r'the cumulative distribution function was given only for $2\le x\le4$', None),
 (4495, [(r'x &= 3.736851\ldots \end{aligned}$$', r'x &= 3.736851\ldots \\ &\approx 3.737 \end{aligned}$$' + '\n' + r'(The paper printed $3.748$, a misprint: $F(3.748)\approx0.760$, not $0.75$.)')], [],
  r'the paper asks to show the upper quartile is about $3.748$; it is $3.737$ ($F(3.748)\approx0.760$), and the working stopped without saying so. The part now reads $3.737$', None),
 (4508, [(r'A strong positive correlation ($r=0.9$) means that profit will increase as the money spent on advertising increases.', r'There is a strong positive linear association ($r=0.9$): profit tends to be higher when more is spent on advertising. Correlation alone does not show that the advertising causes the higher profit.')], [],
  r'the answer said profit "will increase" with advertising, which claims certainty and causation', None),
 (4566, [(r'\therefore\ \text{the required year is } 2026', r'\text{Year } n \text{ is the calendar year } 1999+n \text{ (year 1 is 2000), so } n=26 \text{ is } 2025.$$' + '\n' + r'$$\therefore\ \text{the required year is } 2025')], [],
  r'the answer was 2026; $P_0$ is the start of 2000, so year $n$ is $1999+n$ and $n=26$ is 2025 (the school answer had the same slip)', None),
 (4580, [(r'The same number of added scores lie above and below $25$ (three at most... see below), so the median stays the same.', r'Three of the added scores lie below $25$ ($16, 16, 21$) and three lie above it ($26, 30, 30$), so the median stays $25$.')], [],
  r'the first line was garbled', None),
 (4654, [(r'From the Venn diagram, $P(A)=\dfrac27$ and $P(A\mid B)=\dfrac{x+2}{x+12}$, so', r'From the Venn diagram, $P(A)=\dfrac{x+2}{x+12}$ and $P(A\mid B)=\dfrac27$, so')], [],
  r'the two probabilities were swapped in the first line', None),
 (4655, [], [], r'part (a) held the coin-game working of the next question; it is $0.05^3=\dfrac{1}{8000}$', _defective),
 (4657, [], [], r'part (a) held a broken fragment; the coin-game working (answer $\dfrac{25}{64}$) had been stored under the previous question', _swap_coin),
 (4659, [(r'The shaded region lies below the $x$-axis on $[b,0]$ (where $f(x)<0$) and above... the area is the integral of the upper curve minus the lower curve in each part, so',
          r'On $[b,0]$ the shaded region lies above the $x$-axis ($f(x)>0$), and on $[0,a]$ it lies below it ($f(x)<0$), so the integral over $[0,a]$ is negative and is subtracted:')], [],
  r'the first line had the regions the wrong way round and was cut off', None),
 (4726, [(r't \approx 4.433,\ 5.851,\ 12.43,\ 15.57', r't \approx 4.433,\ 7.567,\ 12.43,\ 15.57')], [],
  r'the second solution read $5.851$; $\dfrac{4}{\pi}(2\pi-0.3398)\approx7.567$', None),
 (4745, [(r'&\approx 9.86 \end{aligned}$$', r'&= 9.8657\ldots \\ &\approx 9.87 \end{aligned}$$'), (r'the longest possible length is } 9.86 \text{ metres', r'the longest possible length is } 9.87 \text{ metres')], [],
  r'the answer $9.86$ was truncated; $L=9.8657\ldots\approx9.87$ m', None),
 (4402, [], [], r'the marking criteria stopped at 3 marks for a 5-mark question', _crit5),
]
for sid, lat, crit, note, extra in C11:
    if db.execute("select 1 from solutions where id=? and meta_json like '%\"corrected\"%'", (sid,)).fetchone(): continue
    apply(sid, lat, crit, note, extra)
    m = json.loads(db.execute('select meta_json from solutions where id=?', (sid,)).fetchone()[0]); m['overwritten_from_source'] = m['corrected']
    db.execute('update solutions set meta_json=? where id=?', (json.dumps(m, ensure_ascii=False), sid))
# 2022 Hurlstone AT4 Q13(c) (part 5118): the paper's "approximately 3.748" is a misprint for 3.737 (PARSE_SPEC "Mistakes in the paper are fixed")
db.execute("update parts set latex=replace(latex, 'approximately 3.748', 'approximately 3.737') where id=5118 and latex like '%3.748%'")
db.commit(); print('done')

# Batch 12 (23 Nov; owner: "I NEED you to run 2 advanced batches in the background for our checker"): the verifier's findings on 2022
# NEAP/Normanhurst/North Sydney Boys and Girls/Manly/Oakhill/PEM/Penrith/St George Girls. Two owner calls (North Sydney Girls Q35(c),
# Penrith Q30(b)) went to Your calls (site/project/open_decisions.json), not here.
def _add_line(text):
    return lambda l, c: (l + '\n\n' + text, c)
C12 = [
 (4870, [(r'$$\angle LBY=360^\circ-332^\circ+(300^\circ-300^\circ)=32^\circ$$', r'$$\angle LBY=332^\circ-300^\circ=32^\circ$$')], [],
  r'the line for $\angle LBY$ read $360^\circ-332^\circ+(300^\circ-300^\circ)$, which is $28^\circ$; it is $332^\circ-300^\circ=32^\circ$', None),
 (4914, [(r'&=21.806\text{ cm}^2', r'&=21.769\text{ cm}^2'), (r'&=37.672-21.806\\', r'&=37.672-21.769\\')], [],
  r'the triangle was $21.806$ (from the unrounded $OA$) while the sector used $OA=13.7$; with $13.7$ throughout it is $21.769$, and $37.672-21.769=15.903$', None),
 (5089, [(r'P_0&=4\\ P_1&=4+7=11\\ P_2&=11+7=18', r'P_1&=4\\ P_2&=4+7=11\\ P_3&=11+7=18')], [],
  r'the terms were numbered $P_0,P_1,P_2$; $P_n$ is the total after the $n$th weekend, so $P_1=4$, $P_2=11$, $P_3=18$', None),
 (5102, [(r'&\approx 371.5976 \end{aligned}$$' + '\n' + r'$$D\approx 19.28\text{ km (2 d.p.)}$$', r'&\approx 376.923 \end{aligned}$$' + '\n' + r'$$D\approx 19.41\text{ km (2 d.p.)}$$')], [],
  r'the working gave $D^2\approx371.60$ and $D\approx19.28$; at $t=\dfrac{10}{13}$, $D^2=400-\dfrac{3600}{156}\approx376.92$ and $D\approx19.41$ (the answer, about $19$ km, is unchanged)', None),
 (5134, [(r'$$f(-2)=0,\quad f(1)=3\times27\div 3\ \text{, that is } f(1)=1\times27=27$$', r'$$f(-2)=0,\quad f(1)=(2-1)(1+2)^3=27$$')], [],
  r'the line for $f(1)$ was garbled', None),
 (4782, [(r'&\approx 5137.5 \text{ m}^2 \end{aligned}$$', r'&= 5137.5 \\ &\approx 5138 \text{ m}^2 \end{aligned}$$')], [],
  r'the answer was left as $5137.5$ m$^2$; the question asks for the nearest whole number, $5138$ m$^2$', None),
 (4784, [(r'$\triangle XPQ$ is right-angled at $X$, since $PX \perp QX$ (the paths run NW and NE).', r'$\triangle XPQ$ is right-angled at $P$, since $PX \perp PQ$ (the paths run NW and NE), so $XQ$ is the hypotenuse.')], [],
  r'the right angle was placed at $X$; $PX$ runs NW and $PQ$ NE, so it is at $P$ and $XQ$ is the hypotenuse', None),
 (4804, [(r'&\approx 9.86 \end{aligned}$$', r'&= 9.8657\ldots \\ &\approx 9.87 \end{aligned}$$'), (r'whiteboard is } 9.86 \text{ metres', r'whiteboard is } 9.87 \text{ metres')], [],
  r'the answer $9.86$ was truncated; $L=9.8657\ldots\approx9.87$ m', None),
 (4968, [], [], r'the sketch did not state the $y$-intercept the question asks for; the intercepts and the inflexion are now listed under it',
  _add_line(r'Intercepts: $x$-intercept $(-1,0)$, $y$-intercept $(0,3)$. Point of inflexion $\left(-\dfrac{1}{3},\dfrac{56}{27}\right)$.')),
]
for sid, lat, crit, note, extra in C12:
    if db.execute("select 1 from solutions where id=? and meta_json like '%\"corrected\"%'", (sid,)).fetchone(): continue
    apply(sid, lat, crit, note, extra)
    m = json.loads(db.execute('select meta_json from solutions where id=?', (sid,)).fetchone()[0]); m['overwritten_from_source'] = m['corrected']
    db.execute('update solutions set meta_json=? where id=?', (json.dumps(m, ensure_ascii=False), sid))
# 2022 Manly AT4 Q32(c) sign-test table (solution 4987): dA/dtheta at 50 degrees is 4cos100 + 4cos50 = 1.877, not 0.719
db.execute("""update data_tables set rows_json=replace(rows_json, '"0.719"', '"1.877"') where id='Ts4987_1' and rows_json like '%"0.719"%'""")
# 2022 NEAP AT4 Q26 (question 3336): the paper printed "as x -> -inf = y -> inf"; y = 2x/e^x -> -inf (PARSE_SPEC "Mistakes in the paper are fixed")
db.execute(r"""update questions set stem_latex=replace(stem_latex, 'and as $x \to -\infty = y \to \infty$', 'and as $x \to -\infty$, $y \to -\infty$') where id=3336""")
db.commit(); print('done C12')

# Batch 13 (23 Nov; owner: "I NEED you to run 2 advanced batches in the background for our checker", then "for batch 13 can we
# multithread it so its faster?"): the verifier's findings on 2022 Sydney Boys/Girls/Grammar/Tech, King's AT2/AT4, Western Mathematics
# and 2021 ACE. 2022 Western Mathematics Q19 (the triangle named LPS) is left for the checker.
def _sol3733(l, c):   # 2022 Sydney Tech AT4 Q29: the stored solution stopped after one line and had no criteria
    return (r"""The curves meet where $\sqrt{x+9}=\dfrac{x}{3}+3=\dfrac{x+9}{3}$, so $x+9=\dfrac{(x+9)^2}{9}$, giving $x=-9$ or $x=0$: $A(-9,0)$ and $B(0,3)$.

Between them the curve is above the line (at $x=-5$: $\sqrt{4}=2>\dfrac{4}{3}$).
$$\begin{aligned} A &= \int_{-9}^{0}\left(\sqrt{x+9}-\dfrac{x}{3}-3\right)dx \\ &= \Big[\dfrac{2}{3}(x+9)^{\frac{3}{2}}\Big]_{-9}^{0}-\Big[\dfrac{x^2}{6}+3x\Big]_{-9}^{0} \\ &= \dfrac{2}{3}\times 27-\big(0-(13.5-27)\big) \\ &= 18-13.5 \\ &= 4.5 \text{ units}^2 \end{aligned}$$""",
            [[4, 'Correct answer'], [3, 'Correct integral with correct limits, evaluated with one error, or equivalent merit'],
             [2, 'Correct integral of the difference with correct limits, or equivalent merit'], [1, 'Finds the points of intersection, or equivalent merit']])
C13 = [
 (5409, [(r'The worked solution printed the final line as' + '\n' + r'$$g'"'"r'(x)=\dfrac{-e^{x}}{e^{-x}-1}$$', r'$$\therefore\ g'"'"r'(x)=\dfrac{-e^{-x}}{e^{-x}-1}=\dfrac{1}{e^{x}-1}$$')], [],
  r'the last line repeated the guideline'"'"'s typo $g'"'"r'(x)=\dfrac{-e^{x}}{e^{-x}-1}$; the answer is $\dfrac{-e^{-x}}{e^{-x}-1}=\dfrac{1}{e^x-1}$', None),
 (5494, [(r'The required year is 2026.', r'Year $n$ is the calendar year $1999+n$ ($P_0$ is the start of 2000), so $n=26$ is 2025.' + '\n\n' + r'The required year is 2025.')], [],
  r'the answer was 2026; $P_0$ is the start of 2000, so year $n$ is $1999+n$ and $n=26$ is 2025 (as in 2022 Hurlstone AT4)', None),
 (5575, [(r'so the distance is the difference in displacement.', r'so the distance is the size of the change in displacement.'),
         (r'\text{Distance} &= \left(\dfrac{20\pi}{3}-8\sqrt{3}-16\right)-\left(\dfrac{4\pi}{3}+8\sqrt{3}-16\right) \\ &= \dfrac{16\pi}{3}-16\sqrt{3} \end{aligned}$$',
          r'\text{Distance} &= \left|\left(\dfrac{20\pi}{3}-8\sqrt{3}-16\right)-\left(\dfrac{4\pi}{3}+8\sqrt{3}-16\right)\right| \\ &= \left|\dfrac{16\pi}{3}-16\sqrt{3}\right| \\ &= 16\sqrt{3}-\dfrac{16\pi}{3} \ (\approx 10.96) \end{aligned}$$')], [],
  r'the distance was given as $\dfrac{16\pi}{3}-16\sqrt3\approx-10.96$, a negative number; it is $16\sqrt3-\dfrac{16\pi}{3}$', None),
 (5588, [(r'the line segment from $(-4,0)$ to $(0,2)$', r'the line segment from $(-4,0)$ to $(0,-2)$')], [],
  r'the line segment was said to end at $(0,2)$; the graph has it at $(0,-2)$', None),
 (5592, [(r'The source reads $3.25$ at $5\%$ and 4 years but then uses $4.3746$ in the working.' + '\n\n', ''),
         (r'&\approx 21\,030 \end{aligned}$$', r'\end{aligned}$$' + '\n' + r'To reach at least $\$92\,000$ the contribution is rounded up: $\$21\,031$.'),
         (r'\$21\,030 \text{ is invested e', r'\$21\,031 \text{ is invested e')], [],
  r'an editing note was left in the working, and $\$21\,030$ gives $\$91\,997.84$, short of "at least $\$92\,000$"; it is $\$21\,031$', None),
 (5230, [(r'P(\text{Minor, survival}) &= 0.7 \\ P(\text{Major, combat}) &= 0.6 \\ P(\text{Major, survival}) &= 0.4',
          r'P(\text{survival}\mid\text{minor}) &= 0.7 \\ P(\text{combat}\mid\text{major}) &= 0.6 \\ P(\text{survival}\mid\text{major}) &= 0.4')], [],
  r'the branch values were written as joint probabilities; they are conditional ($P(\text{survival}\mid\text{minor})=0.7$, ...)', None),
 (5270, [(r'z=\dfrac{300-308}{3}\approx-2.6$$', r'z=\dfrac{300-308}{3}\approx-2.67$$'),
         (r'P(Z<-2.6)&=1-P(Z<2.6) \\ &=1-0.99534 \\ &\approx 0.004 \ (0.4\%)', r'P(Z<-2.67)&=1-P(Z<2.67) \\ &=1-0.99621 \\ &\approx 0.0038 \ (0.38\%)'),
         (r'=0.004\times4000=16<20', r'=0.0038\times4000\approx15.2<20')], [],
  r'$z$ was rounded to $-2.6$ and $1-0.99534$ to $0.004$; $z=-2.67$ gives $P\approx0.0038$ and about $15.2$ packets (still under 20)', None),
 (5273, [(r'&=0.5099\ldots \\ &\approx0.51', r'&=0.50497\ldots \\ &\approx0.50')], [],
  r'$\sqrt{0.255}$ was given as $0.5099\ldots$ (that is $\sqrt{0.26}$); it is $0.50497\ldots\approx0.50$', None),
 (5356, [(r'&\approx \$3047.10 \end{aligned}$$', r'&\approx \$3047 \text{ (nearest dollar)} \end{aligned}$$')], [],
  r'the answer was $\$3047.10$; the question asks for the nearest dollar', None),
 (5357, [(r'\tan\dfrac{7\pi}{6}&=-\tan\dfrac{\pi}{6} \\ &=-\dfrac{1}{\sqrt{3}}', r'\tan\dfrac{7\pi}{6}&=\tan\dfrac{\pi}{6} \quad (\text{third quadrant: } \tan>0) \\ &=\dfrac{1}{\sqrt{3}}')], [],
  r'the school solution gave $-\dfrac{1}{\sqrt3}$; $\dfrac{7\pi}{6}$ is in the third quadrant, where $\tan$ is positive, so it is $\dfrac{1}{\sqrt3}$', None),
 (5396, [(r'A probability cannot be negative, so $k>0$.' + '\n' + r'$$\therefore\ k=\dfrac{1}{4}$$', r'Both values give non-negative probabilities ($2k^2$ and $6k^2$).' + '\n' + r'$$\therefore\ k=\pm\dfrac{1}{4}$$')], [],
  r'$k=-\dfrac14$ was rejected as "a negative probability", but the probabilities are $2k^2$ and $6k^2$; $k=\pm\dfrac14$', None),
 (5541, [(r'$$\therefore\ x\le-1.9 \text{ or } x\ge1.1$$' + '\n' + r'(also accept $x\le-2.0$ or $x\ge1.1$)', r'$$\therefore\ x\le-2.0 \text{ or } x\ge1.1$$' + '\n' + r'(the roots are $x\approx-1.952$ and $x\approx1.087$)')], [],
  r'the answer was $x\le-1.9$; the left root is $-1.952$, which is $-2.0$ to the nearest tenth', None),
 (5513, [(r'namely $0\le x\le e-2$ (as given by the source).', r'namely $0\le x\le e-2$.')], [],
  r'the paper asked for $P(f(x)<e-2)$ and meant $P(X<e-2)$; the question now reads $P(X<e-2)$', None),
 (5336, [(r'&= -\dfrac{\sqrt{2+\sqrt2}}{2}-\dfrac{(\sqrt2-1)\sqrt{2+\sqrt2}}{2} \\', r'&= -\dfrac{(\sqrt2-1)\sqrt{2+\sqrt2}}{2}-\dfrac{\sqrt{2+\sqrt2}}{2} \\')], [],
  r'the paper swapped the values of $\sin\dfrac{\pi}{8}$ and $\cos\dfrac{\pi}{8}$; the question and this line now use the right ones', None),
 (5388, [], [], r'the solution stopped after its first line (and said the line is above the curve); written in full: $4.5$ units$^2$', _sol3733),
]
for sid, lat, crit, note, extra in C13:
    if db.execute("select 1 from solutions where id=? and meta_json like '%\"corrected\"%'", (sid,)).fetchone(): continue
    apply(sid, lat, crit, note, extra)
    m = json.loads(db.execute('select meta_json from solutions where id=?', (sid,)).fetchone()[0]); m['overwritten_from_source'] = m['corrected']
    db.execute('update solutions set meta_json=? where id=?', (json.dumps(m, ensure_ascii=False), sid))
# 2022 Western Mathematics AT4 Q7 (part 6153): the paper asked for P(f(x) < e-2) and means P(X < e-2) (PARSE_SPEC "Mistakes in the paper are fixed")
db.execute("update parts set latex=replace(latex, 'Find the probability that $f(x)<e-2$.', 'Find the probability that $X<e-2$.') where id=6153")
# 2022 Sydney Grammar AT4 Q29 (part 5961): the paper swapped the exact values of sin(pi/8) and cos(pi/8)
db.execute(r"""update parts set latex=replace(latex, '$\sin\dfrac{\pi}{8}=\dfrac{\sqrt{2+\sqrt{2}}}{2}$ and $\cos\dfrac{\pi}{8}=\dfrac{\left(\sqrt{2}-1\right)\sqrt{2+\sqrt{2}}}{2}$', '$\sin\dfrac{\pi}{8}=\dfrac{\left(\sqrt{2}-1\right)\sqrt{2+\sqrt{2}}}{2}$ and $\cos\dfrac{\pi}{8}=\dfrac{\sqrt{2+\sqrt{2}}}{2}$') where id=5961""")
# Batch 14 (23 Nov; owner: "run another two batches in the background"): the verifier's findings on 2021 Abbotsleigh AT2/AT3/AT4,
# Baulkham Hills AT1/AT2, Caringbah AT4, Cherrybrook AT1/AT3. 2021 Abbotsleigh AT2 Q9(c)(i) (school answer before the $5 fee) is a Your call.
C14 = [
 (5760, [(r'Between these times the cosine is above $\dfrac12$, so $h<13.5$ is not the case; checking the middle, at $t=6$, $h=18>13.5$, so the ship can sail for $2\le t\le10$.',
          r'Between these times $\dfrac{\pi t}{6}$ lies between $\dfrac{\pi}{3}$ and $\dfrac{5\pi}{3}$, so the cosine is below $\dfrac12$ and $h>13.5$ (check: at $t=6$, $h=18$), so the ship can sail for $2\le t\le10$.'),
         (r'$$\therefore\ \text{the ship can sail between 9 am and 5 pm}$$', r'$$\therefore\ \text{the ship can sail between 9 am and 5 pm}$$' + '\n\n' + r'(The next window opens at 9 pm, $t=14$, as the cycle repeats.)')], [],
  r'the working said the cosine is above $\dfrac12$ between $t=2$ and $t=10$; it is below $\dfrac12$ there, so $h>13.5$. The answer is unchanged; a note gives the 9 pm window', None),
]
for sid, lat, crit, note, extra in C14:
    if db.execute("select 1 from solutions where id=? and meta_json like '%\"corrected\"%'", (sid,)).fetchone(): continue
    apply(sid, lat, crit, note, extra)
    m = json.loads(db.execute('select meta_json from solutions where id=?', (sid,)).fetchone()[0]); m['overwritten_from_source'] = m['corrected']
    db.execute('update solutions set meta_json=? where id=?', (json.dumps(m, ensure_ascii=False), sid))
# Batch 15 (23 Nov; owner: "run another two batches in the background", then "budget is now 600 monthly"): the verifier's findings on 2021
# Fort Street, Hornsby Girls, Hurlstone, Killara, Knox AT1-AT4 and NEAP, each checked by hand. 2021 Knox AT4 Q8 (options B and D both
# correct) is a Your call.
def _sol6101(l, c):   # 2021 Killara AT4 Q8: the working only estimated with triangles (13 3/8) and never reached the key's 13 1/6
    return (r"""The curve $y=x(x-3)$ is below the $x$-axis for $0<x<3$ and above it for $3<x<5$, so the two areas are found separately.
$$\begin{aligned} A_1&=\left|\int_0^3\left(x^2-3x\right)dx\right| =\left|\left[\dfrac{x^3}{3}-\dfrac{3x^2}{2}\right]_0^3\right| =\left|9-\dfrac{27}{2}\right| =\dfrac{9}{2}\\ A_2&=\int_3^5\left(x^2-3x\right)dx =\left[\dfrac{x^3}{3}-\dfrac{3x^2}{2}\right]_3^5 =\left(\dfrac{125}{3}-\dfrac{75}{2}\right)-\left(-\dfrac{9}{2}\right) =\dfrac{26}{3}\end{aligned}$$
$$\text{Total area}=\dfrac{9}{2}+\dfrac{26}{3}=\dfrac{79}{6}=13\dfrac16$$
This is option D.""", c)
def _sol6130(l, c):   # 2021 Killara AT4 Q23: 1200e^{-0.299x3} is 489.349, not 489.898; use the exact k
    return (l.replace(r"""So $N=1200e^{-0.299t}$.""", r"""So $N=1200e^{-kt}$ with $k=\dfrac{\ln 6}{6}$ (keep $k$ exact: the rounded $0.299$ gives $489.3$).""")
             .replace(r"""$$\begin{aligned} N &= 1200e^{-0.299\times 3} \\ &= 489.898 \text{ (3 d.p.)} \end{aligned}$$""",
                      r"""$$\begin{aligned} N &= 1200e^{-\frac{\ln 6}{6}\times 3} = 1200e^{-\frac12\ln 6} = \dfrac{1200}{\sqrt6} \\ &= 489.898\ldots \approx 490 \text{ bacteria} \end{aligned}$$"""), c)
C15 = [
 (5957, [(r'In 2010 there were 625 children aged 12-18, and this represented half of the population.',
          r'In 2010 the children aged 12-18 are those from the upper quartile to the maximum: a quarter of the 2500 children, which is 625.'),
         (r'In 2000 there is the same number of children aged 12-18, and this represents half of the data.',
          r'In 2000 the median is 12, so the 625 children aged 12-18 are half of the data.')], [],
  r'the working said the 625 children aged 12-18 were half of the 2010 population; in 2010 they are a quarter (upper quartile to maximum), and half only in 2000. The answer 1250 is unchanged', None),
 (5960, [(r'Reading the ogive at a cumulative frequency of $50\%$, the median mark is $75$.',
          r'The ogive joins the upper class boundaries. Half of the 50 students is a cumulative frequency of 25, which lies on the segment from $(70,24)$ to $(80,44)$:' + '\n' + r'$$\text{median}\approx70+\dfrac{25-24}{44-24}\times10=70.5$$' + '\n' + r'$$\therefore\ \text{median}\approx70.5$$')], [],
  r'the school answer was $75$, the centre of the median class; read from the ogive (as part (b) is) the median is about $70.5$', None),
 (5962, [(r'The 6th and 7th deciles are the $60\%$ and $70\%$ points, so a mark in the 70s is possible.', r'The 6th and 7th deciles are at cumulative frequencies 30 and 35, which the ogive gives as about $73$ and $75.5$.'),
         (r'Anything in the 70s is acceptable.', r'Any mark from about $73$ to $75.5$ is acceptable.')], [],
  r'the guideline said "anything in the 70s"; the 6th and 7th deciles read from the ogive are about $73$ and $75.5$', None),
 (5981, [(r'\approx 1.8757>0', r'\approx 1.8745>0')], [], r'$PQ^{\prime\prime}$ was given as $1.8757$; it is $1.8745\ldots$ (still positive, so the conclusion stands)', None),
 (5990, [(r'\dfrac{1}{2}\pi\times 4^2-\dfrac{1}{2}(4+2)\times 1 \\ &=8\pi-3', r'\dfrac{1}{2}\pi\times 2^2-\dfrac{1}{2}(4+2)\times 1 \\ &=2\pi-3')], [],
  r'the working used radius $4$ and reached $8\pi-3$, contradicting the key; the semicircle has radius $2$, giving $2\pi-3$ (option A)', None),
 (6032, [(r'\text{Var}(X)&=E\left(X^2\right)-5.24^2', r'\text{Var}(X)&=E\left(X^2\right)-\left(\dfrac{6797}{1296}\right)^2'),
         (r'+\dfrac{24156}{1296}-5.24^2\\&\approx 0.96\text{ (2 dp)}', r'+\dfrac{24156}{1296}-\left(\dfrac{6797}{1296}\right)^2\\&=\dfrac{36827}{1296}-\left(\dfrac{6797}{1296}\right)^2\\&\approx 0.91\text{ (2 dp)}')], [],
  r'the school used $E(X)$ rounded to $5.24$ before squaring and got $0.96$; with the exact $E(X)=\dfrac{6797}{1296}$ the variance is $0.91$ (2 dp)', None),
 (6101, [], [], r'the working only estimated the area with triangles ($13\dfrac38$) and never showed the key; integrated exactly it is $\dfrac{79}{6}=13\dfrac16$ (option D)', _sol6101),
 (6130, [], [], r'the line $1200e^{-0.299\times3}=489.898$ is false ($489.349$ with the rounded $k$); with the exact $k=\dfrac{\ln6}{6}$, $N=\dfrac{1200}{\sqrt6}\approx490$', _sol6130),
]
for sid, lat, crit, note, extra in C15:
    if db.execute("select 1 from solutions where id=? and meta_json like '%\"corrected\"%'", (sid,)).fetchone(): continue
    apply(sid, lat, crit, note, extra)
    m = json.loads(db.execute('select meta_json from solutions where id=?', (sid,)).fetchone()[0]); m['overwritten_from_source'] = m['corrected']
    db.execute('update solutions set meta_json=? where id=?', (json.dumps(m, ensure_ascii=False), sid))
# Batch 16 (23 Nov night; owner: "Can u please import 5 batches of advanced I won't be able to give any permissions until tomorrow morning"):
# the verifier's 16 findings on 2021 Northern Beaches, North Sydney Boys, PEM, Sydney Girls, Sydney Tech and Oakhill AT1, checked by hand.
# Your calls (site/project/open_decisions.json), not here: Oakhill AT1 Q4 and PEM Q10 (two correct options), North Sydney Boys Q13(b)
# (the result cannot be shown as written), Sydney Girls Q13(a)(ii) (maximum displacement: t=0 and 8, or t=4) and Q13(d) (the integral
# crosses the asymptote at pi/2), Sydney Tech Q18(a) ("either vaccine": both, 1/5, or at least one, 19/25).
_NOTE16 = r'(Over the whole day the cycle repeats every 12 hours, so the channel is also deep enough from midnight to 6am and from 10pm to midnight; the answer above is the window inside the first cycle.)'
C16 = [
 (7000, [(r'&= \dfrac{2}{7} \end{aligned}$$', r'&= \dfrac{2}{7} \end{aligned}$$' + '\n\n' + r'$P(B)=0.55$, so $P(B\mid A)=\dfrac27\approx0.286\ne P(B)$ (equivalently $P(A\cap B)=0.1\ne P(A)P(B)=0.1925$).' + '\n' + r'$$\therefore\ A \text{ and } B \text{ are not independent}$$')], [],
  r'the guideline found $P(B\mid A)$ but never answered whether $A$ and $B$ are independent; they are not', None),
 (7310, [(r'$$\therefore\ \text{the ship can sail between 10am and 6pm.}$$', r'$$\therefore\ \text{the ship can sail between 10am and 6pm.}$$' + '\n\n' + _NOTE16)], [],
  r'the working looked only at the first cycle; a note gives the other Tuesday windows (midnight to 6am, 10pm to midnight)', None),
 (7061, [(r'$$\therefore\ \text{between 10am and 6pm}$$', r'$$\therefore\ \text{between 10am and 6pm}$$' + '\n\n' + r'(The next window opens at 10pm, $t=14$, as the cycle repeats.)')], [],
  r'the guideline gave only the 10am to 6pm window; a note gives the 10pm window later the same day', None),
 (7030, [(r'$$9+15+9+6=39\text{ m}$$' + '\n' + r'Cost:' + '\n' + r'$$\begin{aligned}39\times\$75&=\$2925\end{aligned}$$' + '\n' + r'$$\therefore\ \text{the cost is } \$2925$$',
          r'$$9+15+9+6.316\ldots=39.316\ldots\text{ m}$$' + '\n' + r'Fencing is sold in whole metres, so John must buy $40$ m ($39$ m would leave the fence about $0.3$ m short).' + '\n' + r'Cost:' + '\n' + r'$$\begin{aligned}40\times\$75&=\$3000\end{aligned}$$' + '\n' + r'$$\therefore\ \text{the cost is } \$3000$$')], [],
  r'the guideline used $CD$ rounded down to $6$ m and bought $39$ m ($\$2925$), which leaves the fence short; $39.32$ m needs $40$ m, $\$3000$', None),
 (7064, [(r'So the payments last 60 quarters.' + '\n\n' + r'$$\therefore\ 60 \text{ quarters}=15 \text{ years}$$',
          r'So there are $59$ full quarterly payments, and about $\$990$ is left for a smaller 60th payment.' + '\n\n' + r'$$\therefore\ 60 \text{ quarters}=15 \text{ years (the last payment is partial; } 59 \text{ full payments is about } 14.75 \text{ years)}$$')], [],
  r'the working rounded $n=59.06$ up to 60 quarters without saying the 60th payment is only partial', None),
 (7070, [(r'$$\therefore\ \text{the triangle } XYZ \text{ is isosceles when the area is a maximum}$$',
          r'$$\begin{aligned}A^2&=-33(7)^2+462(7)-1089=528\\ A&=\sqrt{528}=4\sqrt{33}\approx22.98\text{ units}^2\end{aligned}$$' + '\n' + r'$$\therefore\ \text{the maximum area is } 4\sqrt{33}\text{ units}^2\text{, when triangle } XYZ \text{ is isosceles}$$')], [],
  r'the guideline stopped at $x=7$ and never gave the maximum area, $4\sqrt{33}\approx22.98$', None),
 (7134, [(r'&= \left|-\dfrac{25}{12}\right| \\', r'&= \left|0-\left(-\dfrac{25}{12}\right)\right| \\')], [],
  r'the line $\left|0-\left(\dfrac14+\dfrac23-3\right)\right|$ was written $\left|-\dfrac{25}{12}\right|$; the value is unchanged', None),
 (7271, [(r'&= 0.483\ldots \end{aligned}$$', r'&= 0.4343\ldots \end{aligned}$$'), (r'=63.994\ldots^\circ \approx 64^\circ', r'=64.257\ldots^\circ \approx 64^\circ')], [],
  r'the cosine-rule line gave $0.483\ldots$ and $63.994^\circ$ (the school used 2200 in the denominator); it is $0.4343\ldots$, $64.26^\circ$. The bearing $244^\circ$T is unchanged', None),
]
for sid, lat, crit, note, extra in C16:
    if db.execute("select 1 from solutions where id=? and meta_json like '%\"corrected\"%'", (sid,)).fetchone(): continue
    apply(sid, lat, crit, note, extra)
    m = json.loads(db.execute('select meta_json from solutions where id=?', (sid,)).fetchone()[0]); m['overwritten_from_source'] = m['corrected']
    db.execute('update solutions set meta_json=? where id=?', (json.dumps(m, ensure_ascii=False), sid))
# Two parts the guideline left without working (2021 Northern Beaches AT4 Q23(b), Q34(b)): written here, marked generated.
_GEN16 = [
 (7505, r"""The claim is not supported. The data only show that fires with more firefighters had more damage: the two variables are strongly correlated ($r\approx0.998$), but correlation does not imply causation.
The more likely explanation is the reverse, or a third factor: larger fires do more damage and also need more firefighters to be sent, so the size of the fire drives both variables.""",
  [[1, "Rejects the claim, explaining that the size of the fire (or the reverse direction) accounts for the correlation"]]),
 (7529, r"""Using $F(x)=\displaystyle\int_0^x\dfrac{\pi}{2}\cos\left(\dfrac{\pi t}{2}\right)dt=\sin\left(\dfrac{\pi x}{2}\right)$ for $0\le x\le1$:
$$\begin{aligned} P\left(X<\tfrac12 \,\middle|\, X<\tfrac23\right) &= \dfrac{P\left(X<\frac12\right)}{P\left(X<\frac23\right)} \\ &= \dfrac{\sin\frac{\pi}{4}}{\sin\frac{\pi}{3}} \\ &= \dfrac{\frac{\sqrt2}{2}}{\frac{\sqrt3}{2}} \\ &= \dfrac{\sqrt6}{3}\ (\approx0.816) \end{aligned}$$""",
  [[3, "Correct answer"], [2, "Finds $P\\left(X<\\frac12\\right)$ and $P\\left(X<\\frac23\\right)$, or equivalent merit"], [1, "Uses the conditional probability formula, or equivalent merit"]]),
]
for pid, lat, crit in _GEN16:
    if db.execute('select 1 from solutions where part_id=?', (pid,)).fetchone(): continue
    db.execute('insert into solutions (part_id, source, latex, model, prompt_version, criteria_json, meta_json) values (?,?,?,?,?,?,?)',
               (pid, 'generated', lat, 'claude (session)', 'b16-fix', json.dumps(crit), json.dumps({'generated_note': 'The guideline has no working for this part; written while checking the verifier findings (23 Nov).'})))
# 2021 Hornsby Girls AT4 Q27(c) sign table (Ts6035_1): dr/dk at k=2 is (4-8)/13^{3/2} = -0.085..., not -0.85...
db.execute(r"""update data_tables set rows_json=replace(rows_json, '"-0.85\\ldots"', '"-0.085\\ldots"') where id='Ts6035_1'""")
# Batch 16 tables: words outside \text{} render italic (batch_check)
db.execute(r"""update data_tables set rows_json=replace(rows_json, '"Mt \\cdot Isa"', '"\\text{Mt Isa}"') where id='1318_q25_t1'""")
db.execute(r"""update data_tables set rows_json=replace(rows_json, '["IQR",', '["\\text{IQR}",') where id='Ts7014_1'""")
# Batch 17 (24 Nov, same night): the verifier's 14 findings on 2021 King's AT2-AT4, 2020 Blacktown Boys, Caringbah and CSSA, checked by
# hand. 2021 King's AT4 is the PEM 2021 trial (its copies are hidden as duplicates of PEM's). Your calls: 2020 CSSA Q11 (struck through
# on the paper) and 2021 King's AT3 Q16 (the stem's 1.29 m at midnight does not fit its own model).
def _sol7408(l, c):   # 2021 King's AT3 Q16(d): the guideline stopped mid-sentence and gave no value
    return (r"""High tide is a maximum of $h=A\sin[n(t+\varepsilon)]+C$, which happens when $n(t+\varepsilon)=\dfrac{\pi}{2}$.
High tide is at 2:54 am, $t=2.9$, and $n=\dfrac{60\pi}{409}$:
$$\begin{aligned} \dfrac{60\pi}{409}(2.9+\varepsilon)&=\dfrac{\pi}{2} \\ 2.9+\varepsilon&=\dfrac{409}{120} \\ \varepsilon&=\dfrac{409}{120}-2.9=\dfrac{61}{120}\approx0.508 \end{aligned}$$""", c)
def _sol7409(l, c):   # 2021 King's AT3 Q16(e): used the guideline's wrong epsilon (-3.916)
    return (r"""With $h=0.615\sin\left[\dfrac{60\pi}{409}(t+0.508)\right]+1.075$, set $h=1.25$:
$$\begin{aligned} \sin\left[\dfrac{60\pi}{409}(t+0.508)\right]&=\dfrac{1.25-1.075}{0.615}\approx0.28455 \\ \dfrac{60\pi}{409}(t+0.508)&=\sin^{-1}(0.28455)\approx0.28860 \\ t+0.508&\approx0.6262 \\ t&\approx0.118\text{ h}\approx7\text{ min} \end{aligned}$$
This is the first time after midnight, on the rising tide before the 2:54 am high.
$$\therefore\ \text{the tide is first at }1.25\text{ m at about 12:07 am}$$
(The model gives $h(0)\approx1.22$ m, not the $1.29$ m the question states at midnight; the guideline's $\varepsilon=-3.91\dot6$ and answer 4:33 am do not fit the high tide at 2:54 am.)""", c)
def _sol5135(l, c):   # 2020 Caringbah AT4 Q37(a): only dV/dt was given, no loss
    return (l + "\n" + r"""The third year runs from $t=2$ to $t=3$, so the loss is $V(2)-V(3)$:
$$\begin{aligned} V(2)-V(3)&=25\,000e^{-1}-25\,000e^{-1.5} \\ &=25\,000\left(e^{-1}-e^{-1.5}\right) \\ &\approx\$3618.73 \end{aligned}$$
$$\therefore\ \text{the car loses about }\$3618.73\text{ in the third year}$$""", c)
def _sol5041(l, c):   # 2020 Blacktown Boys AT4 Q13(a): used b=-5 before finding it; a=-2, b=5 is the same graph
    return (r"""The $y$-intercept is $5$:
$$|0\cdot a+b|=5 \quad\Rightarrow\quad b=\pm5$$
The $x$-intercept is $2.5$, so $2.5a+b=0$:
$$\begin{aligned} b=-5:&\quad 2.5a=5,\ a=2 \\ b=5:&\quad 2.5a=-5,\ a=-2 \end{aligned}$$
Both give the same graph, since $|-2x+5|=|2x-5|$ (check the point $(2,1)$: $|2\times2-5|=1$).
$$\therefore\ a=2,\ b=-5\ \ (\text{or } a=-2,\ b=5)$$""", c)
def _sol7749(l, c):   # 2021 King's AT3 Q5: the school's answer sheet keys A
    return (l + "\n\n" + r"(The school's answer sheet gives A; the transformations in the order given lead to C.)", c)
C17 = [
 (7361, [(r'The gradient at $x = 1$ is a steeper negative number than $f(1)$ is, so', r'The gradient at $x = 1$ is a small negative number, closer to zero than $f(1)$ (about $-0.4$ against about $-1.1$), so')], [],
  r'the line said the gradient is a steeper negative number than $f(1)$, which contradicts $f(1)<f^{\prime}(1)$', None),
 (7749, [], [], r'the school keyed A, $f\left(\dfrac{x+2}{3}\right)-4$; translating left 2 and then dilating horizontally by 3 gives $f\left(\dfrac{x}{3}+2\right)-4$, option C', _sol7749),
 (7396, [(r'x_1&=0.8 \\ x_2&=2.7 \\ x_3&=3.6', r'x_1&\approx0.9 \\ x_2&\approx2.8 \\ x_3&\approx5.8')], [],
  r'the guideline gave $0.8$, $2.7$ and $3.6$; the solutions are $0.89$, $2.85$ and $5.81$ ($\sin 3.6<0$, so $3.6$ cannot be one)', None),
 (7408, [], [], r'the guideline stopped mid-sentence with no value of $\varepsilon$; from the high tide at 2:54 am, $\varepsilon=\dfrac{61}{120}\approx0.508$', _sol7408),
 (7409, [], [], r'the guideline used $\varepsilon=-3.91\dot6$, which does not put the high tide at 2:54 am; with $\varepsilon\approx0.508$ the tide is first at $1.25$ m at about 12:07 am, not 4:33 am', _sol7409),
 (7429, [(r'$\angle CBD=24^\circ$ and $\angle CDB$ is $75^\circ$ as given in the diagram.', r'$\angle CBD=24^\circ$ and $\angle BCD=75^\circ$ as given in the diagram (so $\angle CDB=81^\circ$).')], [],
  r'the working called the $75^\circ$ angle $\angle CDB$; it is $\angle BCD$', None),
 (7430, [(r'\text{Total length} &= 9+15+9+6 \\ &= 39 \text{ m}', r'\text{Total length} &= 9+15+9+6.316\ldots \\ &= 39.316\ldots \text{ m}'),
         (r'\text{Cost} &= 39\times\$75 \\ &= \$2925', r'\text{Cost} &= 40\times\$75 \\ &= \$3000'),
         (r'\text{the fencing costs } \$2925', r'\text{the fencing costs } \$3000 \text{ (40 m: fencing is sold in whole metres, and 39 m would be short)}')], [],
  r'the guideline used $CD$ rounded down to $6$ m and bought $39$ m ($\$2925$); $39.32$ m needs $40$ m, $\$3000$ (the marker also gave the marks to $\$3000$)', None),
 (7443, [(r'So the funds last 60 quarters.', r'So there are $59$ full quarterly payments, and about $\$990$ is left for a smaller 60th payment: the funds last 60 quarters, the last one partial ($59$ full payments is about $14.75$ years).')], [],
  r'the working rounded $n=59.06$ up to 60 quarters without saying the 60th payment is only partial', None),
 (7575, [], [], r'the working used $b=-5$ before finding it, and missed that $a=-2$, $b=5$ gives the same graph', _sol5041),
 (7595, [('\nOr, using a line through two points of the scatterplot:\n' + r'$$m=\dfrac{5.5-4}{2-1}=1.5$$' + '\n' + r'$$\begin{aligned} y-4&=1.5(x-1)\\ y&=1.5x+2.5\end{aligned}$$', '')], [],
  r'the guideline also offered $y=1.5x+2.5$, a line through two points, which is not the least-squares line the question asks for', None),
 (7596, [('\nOr, using the second line:\n' + r'$$\begin{aligned} y&=1.5\times2.2+2.5\\ &=5.8\text{ kg}\end{aligned}$$', '')], [],
  r'the second prediction ($5.8$ kg) used the two-point line, not the least-squares line', None),
 (7714, [], [], r'the guideline gave only $\dfrac{dV}{dt}$ and never found the loss in the third year, $V(2)-V(3)\approx\$3618.73$', _sol5135),
 (7721, [(r'$$\therefore\ k=\ln\left(e\pm\sqrt{e^2-1}\right)$$', r'Since $k>0$, $e^k>1$, and $e-\sqrt{e^2-1}\approx0.19<1$ is rejected.' + '\n' + r'$$\therefore\ k=\ln\left(e+\sqrt{e^2-1}\right)\ (\approx1.657)$$')], [],
  r'the answer kept both roots; $k>0$ needs $e^k>1$, so only $e+\sqrt{e^2-1}$ is valid', None),
 (7637, [(r'&\approx 8771.14\text{ m}', r'&\approx 8771.41\text{ m}'), (r'8771.14^2-2\times 24000\times 8771.14', r'8771.41^2-2\times 24000\times 8771.41')], [],
  r'$b$ was written $8771.14$ (digits swapped); it is $8771.41$. The answer $30\,390$ m is unchanged', None),
 (7647, [(r"At $x=3$, $y''=12>0$, so a local minimum.", r"At $x=3$, $y''=12>0$, so a local minimum." + '\n\n' + r'$y(-1)=0$ and $y(3)=4^2\times(-2)=-32$.' + '\n' + r'$$\therefore\ \text{local maximum at } (-1,0),\ \text{local minimum at } (3,-32)$$')], [],
  r'the guideline gave only $x=-1$ and $x=3$, not the stationary points $(-1,0)$ and $(3,-32)$', None),
]
for sid, lat, crit, note, extra in C17:
    if db.execute("select 1 from solutions where id=? and meta_json like '%\"corrected\"%'", (sid,)).fetchone(): continue
    apply(sid, lat, crit, note, extra)
    m = json.loads(db.execute('select meta_json from solutions where id=?', (sid,)).fetchone()[0]); m['overwritten_from_source'] = m['corrected']
    db.execute('update solutions set meta_json=? where id=?', (json.dumps(m, ensure_ascii=False), sid))
if db.execute("select is_correct from mcq_options where question_id=4916 and label='A'").fetchone()[0]:   # 2021 King's AT3 Q5: key A -> C
    db.execute("update mcq_options set is_correct=(label='C') where question_id=4916")
# Batch 18 (24 Nov, same night): the verifier's 34 findings on 2020 Fort Street, Girraween, Gosford, Grafton, Hunters Hill, Hurlstone,
# James Ruse, Killara and Cherrybrook AT3, checked by hand. Your calls: Gosford Q30 ($60 or $50), Grafton Q10 (monthly deposits, no option
# fits), Hurlstone Q27 (f is not a density: it integrates to 3.75).
# Fort Street AT4: the school's multiple-choice workings for Q1-10 were stored on the written-response questions Q1-10 (the parse merged
# the two numberings); the multiple-choice questions already have their own worked solutions, so the misplaced copies are removed.
def _sol8054(l, c):   # 2020 Hunters Hill AT4 Q14: asks for the SAMPLE standard deviation; the working gave the population one
    return (r"""Total number of points $= 14$.

\extable{Ts8054_1}

Mean:
$$\begin{aligned} \bar{x} &= \dfrac{0\times3+1\times2+2\times4+3\times2+4\times2+5\times1}{14} \\ &= \dfrac{29}{14}=2\dfrac{1}{14} \\ &\approx 2.1 \end{aligned}$$
Sample standard deviation (calculator, $s_x$):
$$\begin{aligned} s &= \sqrt{\dfrac{\sum x^2-n\bar{x}^2}{n-1}} = \sqrt{\dfrac{93-14\left(\frac{29}{14}\right)^2}{13}} \\ &\approx 1.59 \\ &\approx 1.6 \end{aligned}$$
(The population standard deviation, $\sigma\approx1.5$, is not what the question asks for.)""", c)
C18 = [
 (7865, [(r'The graph has endpoints $(1,20)$ and $(12,20)$', r'The graph has endpoints $(1,19.3)$ and $(12,20)$ (from $T(1)=7\sin\left(\frac{\pi}{6}+1.5\right)+13\approx19.3$ and $T(12)\approx20.0$)')], [],
  r'the left endpoint was given as $(1,20)$; $T(1)\approx19.3$', None),
 (7918, [(r'The shaded region is triangle $ACD$ less the area under the curve from $0$ to $2$.',
          r'The shaded region is triangle $ACD$ less the area under the curve from $5$ to $7$. The parabola is symmetric about $x=\dfrac72$, so that area equals the area from $0$ to $2$, found in part (c).')], [],
  r'the working said the area subtracted is the area under the curve from 0 to 2; it is the area from 5 to 7, equal to it by symmetry about $x=\dfrac72$', None),
 (7979, [(r'\dfrac{dV}{dr}=13.46>0', r'\dfrac{dV}{dr}\approx64.1>0')], [], r'$\dfrac{dV}{dr}$ at $r=\sqrt{\dfrac{240}{\pi}}$ was given as $13.46$; it is about $64.1$ (still positive)', None),
 (8022, [(r'e^{0.3t} &\approx 24.9001 \\ 0.3t &= \ln 24.9001 \\ t &\approx 10.7162', r'4000e^{0.3t} &= 100\,000+399.435 \\ e^{0.3t} &\approx 25.0999 \\ 0.3t &= \ln 25.0999 \\ t &\approx 10.7429')], [],
  r'$C$ is negative, so $e^{0.3t}=\dfrac{100\,000+399.435}{4000}\approx25.0999$, $t\approx10.743$; the working had $24.9001$ and $10.7162$. The answer, 11 months, is unchanged', None),
 (8230, [(r'25.0998\ldots &= e^{0.3t}', r'25.0999\ldots &= e^{0.3t}'), (r'\ln(25.0998\ldots) &= 0.3t', r'\ln(25.0999\ldots) &= 0.3t'), (r't &= \dfrac{\ln(25.0998\ldots)}{0.3} \\ &= 10.7482\ldots', r't &= \dfrac{\ln(25.0999\ldots)}{0.3} \\ &= 10.7429\ldots')], [],
  r'$\dfrac{\ln 25.0999}{0.3}$ was given as $10.7482$; it is $10.7429$. The answer, 11 months, is unchanged', None),
 (8045, [(r'The guideline circles A.', r'This is the open interval $\left(-\dfrac32,\infty\right)$, option C. (The guideline circles A, which wrongly includes $x=-\dfrac32$.)')], [],
  r'the guideline keyed A, $\left[-\dfrac32,\infty\right)$, but $\ln(2x+3)$ is undefined at $x=-\dfrac32$; the answer is C', None),
 (8052, [(r'Equation of the normal through $(2, 0)$:' + '\n' + r'$$\begin{aligned} y - 0 &= -1(x - 2) \\ y &= -x + 2 \end{aligned}$$',
          r'At $x=2$, $f(2)=\ln 1+2=2$, so the point on the curve is $(2,2)$ (the paper printed $(2,0)$).' + '\n' + r'Equation of the normal through $(2, 2)$:' + '\n' + r'$$\begin{aligned} y - 2 &= -1(x - 2) \\ y &= -x + 4 \end{aligned}$$')], [],
  r'the paper gave the point as $(2,0)$, which is not on the curve; $f(2)=2$, so the normal is $y=-x+4$, not $y=-x+2$', None),
 (8054, [], [], r'the question asks for the sample standard deviation, $s\approx1.6$; the working gave the population value $1.5$ (from the rounded mean), and wrote the mean as $2\dfrac{3}{14}$ instead of $2\dfrac{1}{14}$', _sol8054),
 (8078, [(r'\dfrac{\sin\angle BCA}{14} = \dfrac{\sin 106^\circ}{18}', r'\dfrac{\sin\angle BCA}{14} = \dfrac{\sin 106^\circ}{18.27}'),
         (r'The north line at $C$ makes an angle of $136^\circ - 90^\circ = 46^\circ$ with the line $CB$ direction.', r'The bearing of $B$ from $C$ is $136^\circ+180^\circ=316^\circ$, which is $46^\circ$ north of west.')], [],
  r'the sine rule needs the unrounded $AC=18.27$ to give $47.437^\circ$ (with $18$ it gives $48.4^\circ$), and the $46^\circ$ is measured from the west line, not the north line. The bearing $269^\circ$ is unchanged', None),
 (8083, [(r'$\therefore$ the life expectancy is about 74 years.', r'$\therefore$ the life expectancy is about 73 years (readings from the graph of 72 to 74 are accepted).')], [],
  r'the working found $73.1$ but concluded "about 74 years"', None),
 (8086, [(r'$$\dfrac{d^2A}{dx^2} = -\dfrac{1}{5}e^{-\frac{x}{5}} - \dfrac{1}{5}e^{-\frac{x}{5}} - \dfrac{x}{25}e^{-\frac{x}{5}}$$' + '\n' + r'At $x = 5$ every term is negative, so $\dfrac{d^2A}{dx^2} < 0$ and this is a maximum.',
          r'$$\dfrac{d^2A}{dx^2} = -\dfrac{1}{5}e^{-\frac{x}{5}} - \dfrac{1}{5}e^{-\frac{x}{5}} + \dfrac{x}{25}e^{-\frac{x}{5}} = e^{-\frac{x}{5}}\left(\dfrac{x}{25}-\dfrac{2}{5}\right)$$' + '\n' + r'At $x = 5$, $\dfrac{d^2A}{dx^2} = e^{-1}\left(\dfrac15-\dfrac25\right) = -\dfrac{1}{5e} < 0$, so this is a maximum.')], [],
  r'the second derivative had $-\dfrac{x}{25}e^{-\frac{x}{5}}$ instead of $+\dfrac{x}{25}e^{-\frac{x}{5}}$, so "every term is negative" was false; $A^{\prime\prime}(5)=-\dfrac{1}{5e}<0$ still gives a maximum', None),
 (8089, [(r'&\approx 2449.49 \end{aligned}$$' + '\n' + r'$$\therefore\ P \approx 2450 \text{ white-ants}$$', r'&= 1000\times1.5^2 \\ &= 2250 \end{aligned}$$' + '\n' + r'$$\therefore\ P = 2250 \text{ white-ants}$$')], [],
  r'$1000e^{2\ln1.5}=1000\times1.5^2=2250$; the guideline gave $2449.49$', None),
 (8123, [(r'\cos\angle CBP&=\dfrac{BC}{PB}=\dfrac{7.4}{7.76}\\ \angle CBP&\approx 0.2967', r'\cos\angle CBP&=\dfrac{BC}{PB}=\dfrac{7.422}{7.76}\\ \angle CBP&\approx 0.296')], [],
  r'the working used the rounded $BC=7.4$ but gave $0.2967$ ($\cos^{-1}\dfrac{7.4}{7.76}=0.306$); with $BC=7.422$ it is $0.296$. The answer $0.3$ is unchanged', None),
 (8254, [(r'common ratio $r=\dfrac{-1}{2}\div 1\cdot$ so $r=-\dfrac{1}{2}$', r'common ratio $r=\dfrac{T_2}{T_1}=\dfrac{-1}{2}=-\dfrac{1}{2}$')], [], r'the ratio line was garbled', None),
 (8177, [(r'-1.87^2 \\ &=5.267-3.497 \\ &=1.77', r'-\left(\dfrac{28}{15}\right)^2 \\ &=5.2667-3.4844 \\ &\approx1.78')], [],
  r'the variance subtracted the rounded mean squared ($1.87^2$) and gave $1.77$; with $E(X)=\dfrac{28}{15}$ it is $1.78$', None),
 (8241, [(r'x=6:\ \dfrac{dA}{dx} &= -41.5\ldots<0', r'x=6:\ \dfrac{dA}{dx} &= -4<0')], [], r'$\dfrac{dA}{dx}$ at $x=6$ was given as $-41.5$; it is $\dfrac{100-60-72}{8}=-4$', None),
 (7787, [(r'a median of approximately $73$ km/h (about $72.5$ km/h).', r'a median of approximately $73.6$ km/h ($72.5+5\times\dfrac{20}{90}$; readings of $73$ to $74$ km/h are accepted).')], [],
  r'the parenthesis "about 72.5 km/h" read the boundary where the cumulative frequency is 130, not 150', None),
 (7794, [(r'This is not a valid estimate, as there are numerous outliers in the top right of the graph representing students who are high achievers in both subjects.',
          r'A Maths score of 90 lies inside the range of the data, so this is interpolation, but the estimate is not very reliable: the correlation is only moderate ($r=-0.5$) and the points are widely scattered.')], [],
  r'the reason given (outliers in the top right) does not make an estimate inside the data range invalid; the real limit is the moderate correlation and wide scatter', None),
 (7795, [(r'Students tend to do more poorly in English when they excel in Mathematics, and vice versa.' + '\n\n' + r'This suggests that most students split their time and effort between these subjects, and investing more in one subject means investing less in the other.',
          r'Students with higher Mathematics scores tend to have lower English scores: on average, English is $0.2$ marks lower for each extra Mathematics mark. The correlation is only moderate, and it does not show that one score causes the other.')], [],
  r'the answer read the correlation as causal and never interpreted the gradient ($-0.2$ English marks per Mathematics mark)', None),
]
for sid, lat, crit, note, extra in C18:
    if db.execute("select 1 from solutions where id=? and meta_json like '%\"corrected\"%'", (sid,)).fetchone(): continue
    apply(sid, lat, crit, note, extra)
    m = json.loads(db.execute('select meta_json from solutions where id=?', (sid,)).fetchone()[0]); m['overwritten_from_source'] = m['corrected']
    db.execute('update solutions set meta_json=? where id=?', (json.dumps(m, ensure_ascii=False), sid))
db.execute("update data_tables set rows_json=replace(rows_json, '\"-6\", \"0\", \"12\"]', '\"-6\", \"0\", \"6\"]') where id='Ts7880_1'")   # 2020 Girraween Q14: f''(2)=6
db.execute(r"""update parts set latex=replace(latex, 'at the point $(2, 0)$', 'at the point $(2, 2)$') where id=8529""")   # 2020 Hunters Hill Q12: (2,0) is not on the curve
if db.execute("select is_correct from mcq_options where question_id=5325 and label='A'").fetchone()[0]:   # 2020 Hunters Hill Q5: key A -> C
    db.execute("update mcq_options set is_correct=(label='C') where question_id=5325")
db.execute('delete from solutions where id between 7811 and 7820 and question_id between 5193 and 5202 and part_id is null')   # Fort Street MCQ workings on the wrong questions
_GEN18 = [
 (8548, r"""A horizontal point of inflection needs $y'=0$ as well as a change of concavity.
$$\begin{aligned} y'\left(-\dfrac{\pi}{4}\right)&=\cos\left(-\dfrac{\pi}{4}\right)-\sin\left(-\dfrac{\pi}{4}\right)=\dfrac{1}{\sqrt2}+\dfrac{1}{\sqrt2}=\sqrt2\ne0 \\ y'\left(\dfrac{3\pi}{4}\right)&=-\dfrac{1}{\sqrt2}-\dfrac{1}{\sqrt2}=-\sqrt2\ne0 \end{aligned}$$
The gradient is not zero at either point, so they are not horizontal points of inflection.""",
  [[1, "Shows $y'\\ne0$ at both points of inflection"]]),
 (8657, r"""Standardise both values with $\mu=100$, $\sigma=10$:
$$z_1=\dfrac{90-100}{10}=-1,\qquad z_2=\dfrac{120-100}{10}=2$$
$$\begin{aligned} P(90<X<120)&=P(-1<Z<2) \\ &=P(Z<2)-P(Z<-1) \\ &=0.9772-0.1587 \\ &=0.8185 \end{aligned}$$""",
  [[1, "Correct answer"]]),
]
for pid, lat, crit in _GEN18:
    if db.execute('select 1 from solutions where part_id=?', (pid,)).fetchone(): continue
    db.execute('insert into solutions (part_id, source, latex, model, prompt_version, criteria_json, meta_json) values (?,?,?,?,?,?,?)',
               (pid, 'generated', lat, 'claude (session)', 'b18-fix', json.dumps(crit), json.dumps({'generated_note': 'The guideline has no working for this part; written while checking the verifier findings (24 Nov).'})))
# Batch 19 (24 Nov, same night): the verifier's 7 findings on 2020 Knox AT2, Northern Beaches, Moorebank and Oakhill AT1, checked by hand.
# 2020 Knox AT2: the parse left the multiple-choice option texts empty; filled from the paper (Q3(a)'s options are sketches).
def _sol8553(l, c):   # 2020 Northern Beaches AT4 Q17: the working contradicted itself and carried parse debris
    return (r"""By the empirical rule, about $68\%$ of times lie within one standard deviation of the mean, so $16\%$ lie above $65$ minutes and $16\%$ below $55$ minutes.
To finish ahead of $84\%$ of competitors, Ozzie's time must be faster (lower) than $84\%$ of the times, so only $16\%$ are faster than him. That is one standard deviation below the mean:
$$60-5=55\text{ minutes}$$
$$\therefore\ \text{Ozzie's completion time is } 55 \text{ minutes}$$""", c)
def _sol8615(l, c):   # 2020 Oakhill AT1 Q12(iv): the working broke off with "(wait)" and never answered
    return (r"""Set $T = 26$:
$$\begin{aligned} 25 + 2\cos\left(\dfrac{\pi}{8}t\right) &= 26 \\ \cos\left(\dfrac{\pi}{8}t\right) &= \dfrac{1}{2} \end{aligned}$$
The first solution after midnight is in the first quadrant:
$$\begin{aligned} \dfrac{\pi}{8}t &= \dfrac{\pi}{3} \\ t &= \dfrac{8}{3} = 2\text{ h }40\text{ min} \end{aligned}$$
$$\therefore\ \text{the temperature is first } 26^\circ\text{C at 2:40 am}$$""", c)
C19 = [
 (8553, [], [], r'the working said finishing ahead of $84\%$ puts Ozzie one standard deviation above the mean and carried parse debris; he is one standard deviation below, $55$ minutes', _sol8553),
 (8386, [(r'&=0.9162097319\ldots', r'&=0.9162907318\ldots')], [], r'$-\ln 0.4$ was written $0.9162097319$ (digits swapped, as in the guideline); it is $0.9162907318\ldots$', None),
 (8615, [], [], r'the working broke off with "(wait)" and never gave the time; it is $t=\dfrac83$, 2:40 am', _sol8615),
]
for sid, lat, crit, note, extra in C19:
    if db.execute("select 1 from solutions where id=? and meta_json like '%\"corrected\"%'", (sid,)).fetchone(): continue
    apply(sid, lat, crit, note, extra)
    m = json.loads(db.execute('select meta_json from solutions where id=?', (sid,)).fetchone()[0]); m['overwritten_from_source'] = m['corrected']
    db.execute('update solutions set meta_json=? where id=?', (json.dumps(m, ensure_ascii=False), sid))
for qid, opts in [(5471, ['$0$', '$1$', '$2$', '$3$']), (5476, ['$3x^2$', r'$\dfrac{x^4}{4}$', r'$\dfrac{t^4}{4}$', '$x^3$']),
                  (5483, ['$y=f(x-3)$ and $y-2=f(x)$', '$y-3=f(x)$ and $y=f(x-2)$', '$y=f(x-3)$ and $y+2=f(x)$', '$y+3=f(x)$ and $y=f(x-2)$']),
                  (5487, ['$y=x^2-6x+15$', '$y=3+6x-x^2$', '$y=6+6x-x^2$', '$y=x^2+6x+9$'])]:
    for lab, t in zip('ABCD', opts):
        db.execute("update mcq_options set latex=? where question_id=? and label=? and trim(coalesce(latex,''))=''", (t, qid, lab))
for lab, n in zip('ABCD', range(1, 5)):   # 2020 Knox AT2 Q3(a): the options are the four sketches (figures 1591_q3a_1..4)
    db.execute("update mcq_options set latex=? where question_id=5481 and label=? and trim(coalesce(latex,''))=''", (r'\exfigure{1591_q3a_%d}' % n, lab))
# Batch 20 (24 Nov, morning): the verifier's 13 findings on 2020 Sydney Boys, Sydney Girls, Sydney Grammar, and the 2026 Baulkham Hills and
# Blacktown Boys AT4, checked by hand. Your calls: 2020 Sydney Girls Q30 (f is not a density) and 2026 Baulkham Hills Q5 (two options fail).
# The two 2026 papers had no school name or task in documents; set to Baulkham Hills High School AT4 and Blacktown Boys High School AT4.
# Their 65 question keys had been assigned as 2026-<school>-TRIAL-Q..; never published or used by the page, so they were removed and
# re-assigned by tools/qkeys.py --assign as 2026-<school>-AT4-Q.. (24 Nov, before the batch's first publish).
db.execute("update documents set school_formal='Baulkham Hills High School', task_code='AT4' where id=1763 and school_formal is null")
db.execute("update documents set school_formal='Blacktown Boys High School', task_code='AT4' where id=1772 and school_formal is null")
def _crit8744(l, c): return (l, [[2, "Correct answer"], [1, "Finds $e^{4k}=\\dfrac32$, or equivalent merit"]])
def _crit8745(l, c): return (l, [[3, "Correct answer"], [2, "Finds $t\\approx6.84$, or equivalent merit"], [1, "Sets up $600=300e^{kt}$, or equivalent merit"]])
def _sol8993(l, c):   # 2026 Baulkham Hills AT4 Q26(e): wrong concavity and no conclusion
    return (r"""$f''(x)=\dfrac{2(1-x^2)}{(x^2+1)^2}<0$ for $|x|>1$, so on $1<x<3$ the curve is concave down (it is concave up only for $-1<x<1$).
The chords used by the Trapezoidal Rule therefore lie below the curve, so the approximation is less than the exact value ($T\approx3.1335<3.1419\ldots$).
$$\therefore\ \text{the approximation is less than the exact value}$$""", c)
def _crit8991(l, c): return (l, [[2, "Correct answer"], [1, "Shows the curve concave up for $-1<x<1$ and concave down for $|x|>1$, or equivalent merit"]])
def _sol9020(l, c):   # 2026 Blacktown Boys AT4 Q16: the guideline worked at x=0; the question asks at x=1
    return (r"""Using the quotient rule, $\dfrac{d}{dx}\left(\dfrac{u}{v}\right)=\dfrac{u'v-uv'}{v^2}$, with
$$\begin{aligned} u&=5e^{2x} & v&=5-x^2\\ u'&=10e^{2x} & v'&=-2x\end{aligned}$$
$$\begin{aligned} \dfrac{dy}{dx}&=\dfrac{(5-x^2)\times 10e^{2x}-5e^{2x}(-2x)}{(5-x^2)^2} \\ &=\dfrac{10e^{2x}(5-x^2+x)}{(5-x^2)^2} \end{aligned}$$
At $x=1$: $y=\dfrac{5e^2}{4}$, so the point is $\left(1,\dfrac{5e^2}{4}\right)$.
$$m_T=\dfrac{10e^2(5-1+1)}{16}=\dfrac{25e^2}{8},\qquad m_N=-\dfrac{8}{25e^2}$$
The normal is
$$y-\dfrac{5e^2}{4}=-\dfrac{8}{25e^2}(x-1)$$
(The school's working found the normal at $x=0$, $x+2y-2=0$, not at the $x=1$ the question asks for.)""", c)
C20 = [
 (8744, [], [], r'the 2-mark part had a single 1-mark criterion (the guideline mislabelled the marks)', _crit8744),
 (8745, [], [], r'the 3-mark part had a single 2-mark criterion (the guideline mislabelled the marks)', _crit8745),
 (8759, [(r'\approx 40.106 \text{ (thousands)}$$' + '\n\n' + r'The source then rounds this to $40.12$ thousand.', r'\approx 40.107 \text{ thousand}$$' + '\n\n' + r'$$\therefore\ \text{about } 40.11 \text{ thousand (2 d.p.)}$$')], [],
  r'the working gave $40.106$ and then $40.12$; $P\left(\dfrac56\right)=40.107\ldots\approx40.11$ thousand', None),
 (8762, [(r'\approx\dfrac{48.78-40.12}{\frac{19}{6}}\\ &\approx2.73', r'\approx\dfrac{48.780-40.107}{\frac{19}{6}}\\ &\approx2.74')], [],
  r'the average rate used the wrong $40.12$ and gave $2.73$; it is $2.74$ thousand per year', None),
 (8797, [(r'\tan\theta &= 2 \\ \theta &\approx 63^\circ', r'\tan\theta &= 2 \\ \theta &\approx 63.43^\circ'),
         (r'AB &= \dfrac{8}{\sin 63^\circ}+\dfrac{1}{\cos 63^\circ} \\ &\approx 11.18 \text{ m}', r'AB &= \dfrac{8}{\frac{2}{\sqrt5}}+\dfrac{1}{\frac{1}{\sqrt5}} = 4\sqrt5+\sqrt5=5\sqrt5 \\ &\approx 11.18 \text{ m}')], [],
  r'the sign-test values were wrong ($-1.6$, $0$ at $63^\circ$, $0.93$); they are $-1.87$ at $60^\circ$, $0$ at $63.43^\circ$ and $0.96$ at $65^\circ$. The minimum $5\sqrt5\approx11.18$ m is unchanged', None),
 (8819, [(r'Jocelyn needs to pay } \$877 \text{ more', r'Jocelyn needs to pay } \$887 \text{ more')], [], r'$5887-5000$ was given as $\$877$; it is $\$887$', None),
 (8946, [(r'is $8.28567$.' + '\n' + r'$$\begin{aligned} FV&=2500\times 8.28567\\ &=\$20\,714.18\end{aligned}$$' + '\n' + r'This is closest to option C.',
          r'is $8.2857$.' + '\n' + r'$$\begin{aligned} FV&=2500\times 8.2857\\ &=\$20\,714.25\end{aligned}$$' + '\n' + r'This is option C.')], [],
  r'the table factor was quoted as $8.28567$ (giving $\$20\,714.18$); the table gives $8.2857$, so $\$20\,714.25$, exactly option C', None),
 (8948, [(r'Using $\cot(270^\circ+x)=-\tan(x)\cdot(-1)$ is not needed; follow the source reduction:', r'Using $\cot(270^\circ+x)=-\cot(90^\circ-x)=-\tan x$ and $\cos(-x)=\cos x$:')], [],
  r'the first line quoted a false identity and leftover notes', None),
 (8991, [], [], r'the criterion said "concave down between $-1<x<1$"; the curve is concave up there and concave down for $|x|>1$', _crit8991),
 (8993, [], [], r'the working said the curve is concave down only for $-1<x<1$ and never concluded; it is concave down on $1<x<3$, so the estimate $3.1335$ is less than the exact $3.1419$', _sol8993),
 (9005, [(r'$$90-80=13\%$$', r'$$93\%-80\%=13\%$$')], [], r'the working read $90-80=13\%$; it is $93\%-80\%=13\%$', None),
 (9020, [], [], r'the guideline found the normal at $x=0$; the question asks at $x=1$: $y-\dfrac{5e^2}{4}=-\dfrac{8}{25e^2}(x-1)$', _sol9020),
 (9046, [(r'\sin S&=\dfrac{LB\sin 46^\circ}{LS} \\ &=0.9964 \\ S&\approx 85^\circ', r'\sin S&=\dfrac{LB\sin 46^\circ}{LS} \\ &=0.9964'),
         (r'The bearing of Liam from Sophie is' + '\n' + r'$$118^\circ+85^\circ=203^\circ$$', r'$LB$ is the longest side and $LB^2\approx30.69\times10^6>LS^2+SB^2\approx28.46\times10^6$, so $S$ is obtuse (the ambiguous case): $S\approx180^\circ-85.5^\circ=94.5^\circ$.' + '\n' + r'The bearing of Liam from Sophie is' + '\n' + r'$$118^\circ+94.5^\circ\approx213^\circ$$'),
         (r'the bearing of Liam from Sophie is } 203^\circ', r'the bearing of Liam from Sophie is } 213^\circ')], [],
  r'the sine rule gave $S\approx85^\circ$, but $S$ is obtuse (ambiguous case): $S\approx94.5^\circ$, so the bearing is $213^\circ$, not $203^\circ$', None),
]
for sid, lat, crit, note, extra in C20:
    if db.execute("select 1 from solutions where id=? and meta_json like '%\"corrected\"%'", (sid,)).fetchone(): continue
    apply(sid, lat, crit, note, extra)
    m = json.loads(db.execute('select meta_json from solutions where id=?', (sid,)).fetchone()[0]); m['overwritten_from_source'] = m['corrected']
    db.execute('update solutions set meta_json=? where id=?', (json.dumps(m, ensure_ascii=False), sid))
db.execute("""update data_tables set rows_json=? where id='Ts8797_1'""", (json.dumps([["\\theta", "60^\\circ", "63.43^\\circ", "65^\\circ"], ["\\dfrac{d\\,AB}{d\\theta}", "-1.87", "0", "0.96"]]),))
db.execute("""update data_tables set rows_json=? where id='Ts9001_1'""", (json.dumps([["a", "0.5", "\\dfrac{2}{\\sqrt{15}}", "0.6"], ["\\dfrac{dT}{da}", "-0.0019", "0", "0.0093"], ["\\text{slope}", "\\backslash", "\\_", "/"]]),))
# Standard batch 2 (run s2, 24 Nov; owner: "go on one"): the verifier's 2 findings on the 2019, 2025 and 2026 NESA HSC Standard 2 papers,
# checked by hand. 2019 Q22: NESA's working names no triangle; our formatted copy named them the wrong way round. 2025 Q35: NESA's
# guideline rounds theta to 60 degrees before the second sine rule and gives 35.29 m; unrounded it is 35.03 m (the cosine rule agrees).
# Owner 12 Nov: "if you are certain the source is wrong and your maths is right, just overwrite it".
def _sol9145(l, c):   # 2025 NESA HSC Standard 2 Q35: no rounding before the second sine rule
    return (l.replace(r'$$\theta = 59.81\ldots^\circ \approx 60^\circ$$', r'$$\theta = 59.813\ldots^\circ$$')
             .replace(r'$$\angle PTA = 180^\circ - 60^\circ = 120^\circ$$', r'$$\angle PTA = 180^\circ - 59.813\ldots^\circ = 120.186\ldots^\circ$$')
             .replace(r'&= 180^\circ - 120^\circ - 36^\circ \\ &= 24^\circ', r'&= 180^\circ - 120.186\ldots^\circ - 36^\circ \\ &= 23.813\ldots^\circ')
             .replace(r'\dfrac{TA}{\sin 24^\circ}', r'\dfrac{TA}{\sin 23.813\ldots^\circ}')
             .replace(r'\times \sin 24^\circ \\ &\approx 35.29 \text{ m}', r'\times \sin 23.813\ldots^\circ \\ &= 35.032\ldots \\ &\approx 35.03 \text{ m}'), c)
C21 = [
 (9083, [(r'In right-angled triangle $ABC$, by Pythagoras', r'In right-angled triangle $ADC$, by Pythagoras'), ('In triangle $ADC$,\n', 'In right-angled triangle $ABC$,\n')], [],
  r'the working found $AC$ "in triangle $ABC$" and $\theta$ "in triangle $ADC$"; it is the other way round ($AC$ from triangle $ADC$, $\cos\theta=\dfrac{4.9}{6.5}$ in triangle $ABC$)', None),
 (9145, [], [], r'the guideline rounded $\theta=59.81^\circ$ to $60^\circ$ before the second sine rule and gave $TA\approx35.29$ m; unrounded, $\angle TPA=23.81^\circ$ and $TA\approx35.03$ m (the cosine rule agrees)', _sol9145),
]
for sid, lat, crit, note, extra in C21:
    if db.execute("select 1 from solutions where id=? and meta_json like '%\"corrected\"%'", (sid,)).fetchone(): continue
    apply(sid, lat, crit, note, extra)
    m = json.loads(db.execute('select meta_json from solutions where id=?', (sid,)).fetchone()[0]); m['overwritten_from_source'] = m['corrected']
    db.execute('update solutions set meta_json=? where id=?', (json.dumps(m, ensure_ascii=False), sid))
# Checker flags 24 Nov late morning (Steve: "yes do that"), fixed in Steve's session:
# 2020 Blacktown Boys AT4 Q29: "ake it os that the total marks is 4" (parts are 1 + 3)
db.execute("update questions set marks_total=4 where id=5057 and marks_total=3")
# 2021 King's AT2 Q2: "Make the table into not a table but a series of equations"
_eq = "$$\\begin{aligned} g'(3)&=0\\\\ g''(3)&=0\\\\ g''(2.99)&=0.02\\\\ g''(3.01)&=0.11 \\end{aligned}$$"
_l = db.execute("select latex from parts where id=7831").fetchone()[0]
if "\\extable{Tp7831_1}" in _l: db.execute("update parts set latex=? where id=7831", (_l.replace("\\extable{Tp7831_1}", _eq),))
# 2021 King's AT3 Q1: "Make the table the actual choices": the options are the table's rows
_l = db.execute("select latex from parts where id=7855").fetchone()[0]
if "\\extable{1035_q1_t1}" in _l: db.execute("update parts set latex=? where id=7855", (_l.replace("\n\n\\extable{1035_q1_t1}", "").replace("\\extable{1035_q1_t1}", ""),))
db.execute("update questions set options_layout='table', options_table_json=? where id=4912", (json.dumps({"headers": ["Horizontal translation of 2 units", "Vertical translation of 5 units"],
           "rows": {"A": ["Left", "Up"], "B": ["Right", "Up"], "C": ["Left", "Down"], "D": ["Right", "Down"]}}),))
# 2021 Ryde AT4 Q12(a) solution: "make the table in the solution for a look like the one that is given to the student except filled in"
db.execute("update data_tables set header_rows=1, label_col=1, rows_json=? where id='Ts7457_1'", (json.dumps(
    [["\\diag{\\text{Jacob}}{\\text{Noel}}", "1", "2", "3", "4", "5", "6"]] + [[str(j)] + [f"{j},{n}" for n in range(1, 7)] for j in range(1, 7)]),))
db.commit(); print('done C13, C14, C15, C16, C17, C18, C19, C20, C21')
