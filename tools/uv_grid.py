"""Owner (11 Nov, 2020 HSC Q18(a)): "should say applying product rule and showing u u' v v' in a grid".
Every product- or quotient-rule solution names the rule, states it, and lists u, v, u', v' as a 2x2 grid before the working.
Applied to all such solutions in the bank; text and other notes kept. Safe to re-run (skips solutions already done)."""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import sqlite3, json
db = sqlite3.connect(paths.DBS)
G = lambda u, v, du, dv: "$$\\begin{aligned} u&=%s & v&=%s\\\\ u'&=%s & v'&=%s\\end{aligned}$$" % (u, v, du, dv)
PR = "Using the product rule, $\\dfrac{d}{dx}(uv)=u'v+uv'$, with\n"
QR = "Using the quotient rule, $\\dfrac{d}{dx}\\left(\\dfrac{u}{v}\\right)=\\dfrac{u'v-uv'}{v^2}$, with\n"
E = {}   # solution id -> (old text to replace, new text)
E[287] = ("$$\\begin{aligned} &2e^{2x}(2x+1) + 2e^{2x} \\\\ &= 2e^{2x}(2x + 1 + 1) \\\\ &= 2e^{2x}(2x + 2) \\\\ &= 4e^{2x}(x + 1) \\end{aligned}$$",
  PR + G("e^{2x}", "2x+1", "2e^{2x}", "2") + "\n$$\\begin{aligned} \\dfrac{d}{dx}\\left[e^{2x}(2x+1)\\right] &= 2e^{2x}(2x+1) + 2e^{2x} \\\\ &= 2e^{2x}(2x + 2) \\\\ &= 4e^{2x}(x + 1) \\end{aligned}$$")
E[109] = ("$$\\begin{aligned} g'(x) &= \\sin x\\cdot e^x",
  "Using the product rule, $\\dfrac{d}{dx}(uv)=u'v+uv'$, on each term. For $e^x\\sin x$:\n" + G("e^x", "\\sin x", "e^x", "\\cos x") +
  "\nFor $e^x\\cos x$:\n" + G("e^x", "\\cos x", "e^x", "-\\sin x") + "\n$$\\begin{aligned} g'(x) &= \\sin x\\cdot e^x")
for sid in (71, 418):
    E[sid] = ("By the quotient rule:", QR + G("4x", "\\sqrt{x-2}", "4", "\\dfrac{1}{2\\sqrt{x-2}}"))
E[48] = ("$$\\begin{aligned}\\dfrac{d}{dx}\\left(\\dfrac{\\ln x}{x}\\right)&=", QR + G("\\ln x", "x", "\\dfrac{1}{x}", "1") + "\n$$\\begin{aligned}\\dfrac{d}{dx}\\left(\\dfrac{\\ln x}{x}\\right)&=")
E[365] = ("Let $f(x) = uv$ with $u = x$, $u' = 1$, $v = e^{-x^2}$, $v' = -2xe^{-x^2}$.", PR.rstrip('\n').rstrip(', with') + ", with\n" + G("x", "e^{-x^2}", "1", "-2xe^{-x^2}"))
E[449] = ("Use the quotient rule with $u = x$, $v = \\sin^2 x$: $u' = 1$, $v' = 2\\sin x\\cos x$.", QR + G("x", "\\sin^2 x", "1", "2\\sin x\\cos x"))
E[459] = ("Product rule with $u = 2x$, $v = e^{-x}$: $u' = 2$, $v' = -e^{-x}$.", PR + G("2x", "e^{-x}", "2", "-e^{-x}"))
E[472] = ("Product rule:", "Using the product rule, $\\dfrac{d}{dx}(uv)=u'v+uv'$, on $(x+20)\\sqrt{400-x^2}$, with\n" + G("x+20", "\\sqrt{400-x^2}", "1", "\\dfrac{-x}{\\sqrt{400-x^2}}"))
n = 0
for sid, (old, new) in E.items():
    l, m = db.execute('select latex, meta_json from solutions where id=?', (sid,)).fetchone()
    if "u'&=" in l: continue
    assert old in l, (sid, old[:40])
    m = json.loads(m or '{}'); m.setdefault('source_original', {'latex': l})
    db.execute('update solutions set latex=?, meta_json=? where id=?', (l.replace(old, new, 1), json.dumps(m, ensure_ascii=False), sid)); n += 1
db.commit(); print('u/v grids added:', n)
