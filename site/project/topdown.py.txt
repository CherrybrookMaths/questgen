"""Owner rule (11 Nov): every marking rubric is top-down (HSC style): N marks = Correct answer, then each lower
mark describes the furthest step reached, 'or equivalent merit'. One-mark-per-step rubrics (source or generated) are
rewritten; the original stays in meta.criteria_original. Safe to re-run."""
import sqlite3, json, re
db = sqlite3.connect('/mnt/user-data/outputs/questions.db')
# step wording where the source line is only a noun or a value (solution id -> phrases for marks 1..N-1)
P = {
 99: ['Recognises the cancelling pattern'], 100: ['Finds the centre'], 101: [r'Forms the discriminant equation $(6m-4)^2-4(m^2+1)(4)=0$'],
 102: ['Finds the correct probability using a calculator or table'], 103: ['Recognises conditional probability and writes the probability correctly'],
 105: ['Finds $x$'], 107: [r'Draws the graph of $f(x)=|2x-4|$'], 111: ['Recognises two separate geometric progressions'],
 114: [r'Obtains $93.9794$', 'Finds $I$'], 115: ['Factorises the derivative', r"Tests the nature with $f'(x)$ or $f''(x)$ (must show numbers)"],
 117: ['Shows the stationary points and point of inflexion correctly'], 121: ['Writes a correct trapezoidal rule expression'],
 122: [r"Finds $f'(1)$", 'Finds the gradient of the normal'], 125: ['Differentiates correctly', 'Uses a relevant trigonometric identity'],
 126: [r'Forms $\displaystyle \int_0^k e^{-\frac12x}\,dx=1$'], 130: [r'Shows $P(x<c)=0.4$ or $40\%$'], 131: ['Writes a correct integral'],
 132: ['Forms the $S_n$ equation', 'Obtains $n=25$'], 134: ['Finds $V$ in terms of $h$', r'Finds $\dfrac{dV}{dh}$', r'Obtains $h=\dfrac{H}{3}$'],
 135: ['Draws the correct shape'], 136: ['Gives a partial explanation'], 140: ['Shows the endpoint at $(1,3)$'],
 142: ['Writes a correct integral expression', 'Finds the correct primitive'], 145: [r'Obtains $\sin(\ldots)=0.3616$', 'Finds the values of $t$'],
 333: [r'Finds the area of the sector, $\dfrac{9}{2}\pi$'], 339: [r'Obtains $\dfrac{1}{2}(2x^2-5)^{-\frac{1}{2}}$'], 344: ['Integrates correctly'],
 349: ['Substitutes correctly into the cosine rule'], 351: ['Writes a correct expression for the area', 'Finds the primitive'],
 357: [r'Draws one of the graphs $y=|2x-4|$ and $y=3-x$ correctly', 'Draws both graphs correctly'],
 366: ['Draws the correct asymptote and shape'], 368: ['Forms the equation $A_{360}=0$'], 370: ['Forms the equation $A_n=0$ with $350000$ and $2998$'],
 371: [r'Finds the amount owing after $175$ repayments ($2144.74$) or $A_{176}\approx-842.54$'],
 372: [r'Makes a suitable substitution, $\sin\phi=\dfrac{h}{\sqrt{h^2+d^2}}$'], 374: ['Finds the intercepts'], 375: ['Finds the primitive'],
 381: ['Identifies a similarity (same median)'], 384: ['Identifies chocolate and carrot'], 385: [r'Finds the gradient, $\dfrac{1}{2}$'],
 388: ['Finds the values of $A$ and $B$'], 389: ['Calculates $136.83$ years'], 390: ['Substitutes correctly into $S_n$ with $n=51$'],
 392: [r'Uses an infinite geometric series with $r=\dfrac{1}{1000}$ and its limiting sum'], 393: ['Forms both equations $x+y=8$ and $xy=9$'],
 395: [r'Identifies $a=12$ and $r=\dfrac{4}{5}$'], 396: ['Writes a correct expression'],
 437: ['Sets up $4x+1=9$ or $4x+1=-9$'], 448: [r'Simplifies to $4\ln(2x-1)$, or uses the chain rule'],
 449: [r"Finds the correct $u$, $v$, $u'$, $v'$ (with the chain rule for $\sin^2 x$)"], 452: [r'Finds the primitive $\dfrac{1}{2}\tan 2x$'],
 454: ['Finds the inner derivative $9x^2$'], 455: [r'Uses part (i) and adjusts the constant factor $-\dfrac{1}{9}$'],
 456: ['Uses a log law to obtain $x^2=3-2x$', 'Solves the quadratic: $x=1$ or $x=-3$'], 457: ['Finds the $x$-intercepts at $-a$, $0$, $a$'],
 458: [r'Forms $\dfrac{dV}{dt}=-(4t-t^2)$ and integrates', r'Finds the volume lost, $\dfrac{32}{3}\text{ m}^3$'],
 460: [r'Finds $x=1$ and the stationary point $\left(1,\dfrac{2}{e}\right)$'], 462: [r"Shows $f''(x)=2e^{-x}(x-2)=0$ at $x=2$"],
 463: [r'Draws the correct shape through the origin with maximum $\left(1,\dfrac{2}{e}\right)$ and asymptote $y=0$ as $x\to\infty$'],
 464: [r'Integrates to $-2\cos\left(t-\dfrac{\pi}{3}\right)+C$'],
 468: [r'Draws the correct shape (shifted sine, amplitude $2$) over $[0,2\pi]$', r'Shows the intercepts $(0,-\sqrt{3})$, $\dfrac{\pi}{3}$, $\dfrac{4\pi}{3}$'],
 469: [r'Splits at $t=\dfrac{\pi}{3}$ (change of direction) and finds the displacements'], 470: ['Uses $OB=10$ (radius) and Pythagoras in triangle $BEO$'],
 471: ['Uses $BC=x$ and finds the height $BE$'], 472: [r'Finds and simplifies $\dfrac{dA}{dx}$', r'Shows $\dfrac{dA}{dx}=0$ gives $x=10$'],
}
def phrase(t):
    t = t.strip().rstrip('.')
    if t.startswith('$'): t = 'Obtains ' + t
    return t
n = 0
for sid, cj, mj in db.execute('select id, criteria_json, meta_json from solutions').fetchall():
    cr = json.loads(cj or '[]'); m = [r[0] for r in cr]
    if len(cr) < 2 or not all(isinstance(x, (int, float)) for x in m): continue
    if m == sorted(m, reverse=True) and len(set(m)) == len(m): continue          # already top-down
    assert set(m) == {1} and cr[-1][1].strip().lower().startswith('correct answer'), (sid, cr)
    auto = [phrase(r[1]) for r in cr[:-1]]; given = P.get(sid, [])
    steps = given + auto[len(given):]                      # hand wording for the first steps, the rest from the source
    assert len(steps) == len(cr) - 1, sid
    N = len(cr)
    new = [[N, 'Correct answer']] + [[j, s if 'equivalent merit' in s else s + ', or equivalent merit'] for j, s in reversed(list(enumerate(steps, 1)))]
    meta = json.loads(mj or '{}'); meta.setdefault('criteria_original', cr)
    meta['rubric_note'] = 'Rewritten top-down from a one-mark-per-step rubric (owner rule, 11 Nov).'
    db.execute('update solutions set criteria_json=?, meta_json=? where id=?', (json.dumps(new, ensure_ascii=False), json.dumps(meta, ensure_ascii=False), sid)); n += 1
db.commit(); print('rewrote', n, 'rubrics top-down')
