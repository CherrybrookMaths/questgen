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
db.commit(); print('done C13, C14')
