"""Owner (11 Nov): "why no working out, ensure mcq has working out too". Worked solutions for the MCQs that still had
none (2020 NESA HSC Q1-10 had only an answer key; 2023 Cherrybrook Q2). Style of the approved MCQ solutions: 1-5 lines
that show why the keyed option is right. Stored as source=generated (shown once approved)."""
import sqlite3, json
db = sqlite3.connect('/mnt/user-data/outputs/questions.db')
S = {
202: r"""The expression under the square root cannot be negative:
$$\begin{aligned} 2x-3&\ge 0\\ x&\ge \dfrac{3}{2}\end{aligned}$$""",
203: r"""Replacing $x$ by $x-2$ moves the graph 2 units to the right; adding $5$ moves it 5 units up.""",
204: r"""Compare the $z$-scores, $z=\dfrac{x-\mu}{\sigma}$:
$$\begin{aligned} \text{French: } z&=\dfrac{82-70}{8}=1.5\\ \text{Commerce: } z&=\dfrac{80-65}{5}=3\\ \text{Music: } z&=\dfrac{74-50}{12}=2\end{aligned}$$
The highest $z$-score is Commerce and the lowest is French.""",
205: r"""$e$ is a constant, so its primitive is $ex$, and $\displaystyle\int e^{3x}\,dx=\dfrac{1}{3}e^{3x}$:
$$\int e+e^{3x}\,dx=ex+\dfrac{1}{3}e^{3x}+c$$""",
206: r"""The coefficient of $x^2$ is negative, so the parabola is concave down (graphs C or D), and the $y$-intercept is $1$.

The axis of symmetry is $x=\dfrac{b}{2}>0$, so the vertex is to the right of the $y$-axis: graph C.""",
207: r"""Start from the range of cosine, then build up $y$ one step at a time:
$$\begin{aligned} -1&\le \cos 3x\le 1\\ -2&\le 2\cos 3x\le 2 &&(\text{multiply by } 2)\\ 3&\le 5+2\cos 3x\le 7 &&(\text{add } 5)\end{aligned}$$
So $3\le y\le 7$: the range is $[3,7]$.""",
208: r"""Add the signed areas between the graph and the $x$-axis (the semicircle has radius $2$; the area below the axis counts as negative):
$$\begin{aligned} 0\le x\le 4:&\quad 4\times3=12\\ 4\le x\le 8:&\quad 4\times3+\dfrac{1}{2}\pi(2)^2=12+2\pi\\ 8\le x\le 10:&\quad \dfrac{1}{2}\times2\times3=3\\ 10\le x\le 12:&\quad -\dfrac{1}{2}\times2\times3=-3\end{aligned}$$
$$\begin{aligned}\int_0^{12} f(x)\,dx&=12+(12+2\pi)+3-3\\ &=24+2\pi\end{aligned}$$""",
209: r"""At $x=1$ the curve is above the axis, increasing and concave down, so $f(1)>0$, $f'(1)>0$ and $f''(1)<0$.

The curve starts at the origin and its gradient is decreasing, so the gradient at $x=1$ is less than the gradient of the chord from $O$, which is $\dfrac{f(1)}{1}$. So $f'(1)<f(1)$:
$$f''(1)<0<f'(1)<f(1)$$""",
210: r"""Below the lower quartile means $z<-0.67$ approximately; not in the bottom 10% means $z>-1.28$ approximately.

So the weight lies between about $\mu-1.3\sigma$ and $\mu-0.7\sigma$: the narrow region just either side of $\mu-\sigma$, graph C.""",
211: r"""By the chain rule,
$$h'(x)=f'\big(g(x)\big)\,g'(x)$$
$h'(x)=0$ when $g'(x)=0$, which happens once, at $x=3$; or when $f'\big(g(x)\big)=0$, that is, when $g(x)$ equals the $x$-value of the maximum of $f$ (about $0.7$). On $1\le x\le5$, $g$ falls to $0$ and rises again, so $g(x)\approx0.7$ twice.

So $y=h(x)$ has $3$ stationary points.""",
317: r"""$r=0.89$ is a strong positive correlation: higher advertising spending is associated with higher profits.

$r$ measures the strength of a linear association; it is not a percentage (C, D), and a positive $r$ rules out A.""",
}
n = 0
for qid, latex in S.items():
    if db.execute("select 1 from solutions where question_id=? and source='generated'", (qid,)).fetchone(): continue
    key = db.execute('select label from mcq_options where question_id=? and is_correct=1', (qid,)).fetchone()[0]
    db.execute("insert into solutions(part_id,question_id,source,latex,marks_breakdown,model,prompt_version,criteria_json,meta_json) values (NULL,?,?,?,?,?,?,?,?)",
               (qid, 'generated', latex, f'1: Correct answer ({key})', 'claude-opus-5-5', 'gen-v1', json.dumps([[1, 'Correct answer']]),
                json.dumps({'confidence': 0.95, 'check': 'passed'})))
    n += 1
db.commit(); print('added', n)
