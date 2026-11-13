"""Owner: "the graph looks bumpy". Curves traced from crop pixels carry pixel noise; a TikZ `smooth` through every traced
point turns that noise into wobbles. Each traced coordinate list (>= 12 points, not marks) is refitted with a parametric
smoothing spline: the smoothest fit whose max distance from every traced point stays within `tol` (fraction of the
curve's size), so peaks, ends and steep parts keep their position. It is written back as ~60 points placed densely where
the curve bends, drawn with `smooth`.  usage: desmooth.py <file.tex> [tol=0.0025]"""
import re, sys, numpy as np
from scipy.interpolate import splprep, splev
NUM = r'-?\d*\.?\d+(?:[eE]-?\d+)?'
PT = re.compile(r'\(\s*(' + NUM + r')\s*,\s*(' + NUM + r')\s*\)')
BLOCK = re.compile(r'(\\addplot\s*(\[[^\]]*\])?|plot\s*(\[[^\]]*\])?)(\s*coordinates\s*\{)([^}]*)\}')
def fit(Q, s):
    w = np.ones(len(Q)); w[0] = w[-1] = 30
    tck, u = splprep([Q[:, 0], Q[:, 1]], w=w, s=s, k=3)
    uu = np.linspace(0, 1, 4000); C = np.array(splev(uu, tck)).T
    d = np.min(np.hypot(Q[:, None, 0] - C[None, :, 0], Q[:, None, 1] - C[None, :, 1]), axis=1)
    return tck, C, uu, d.max()
def refit(pts, tol):
    P = np.array(pts, float)
    P = P[np.r_[True, np.hypot(*np.diff(P, axis=0).T) > 1e-9]]
    sc = np.ptp(P, axis=0).max() or 1; Q = (P - P.min(0)) / sc
    best = None
    for s in [len(Q) * f ** 2 for f in (0.006, 0.004, 0.003, 0.002, 0.0015, 0.001, 0.0006, 0.0003, 0)]:
        tck, C, uu, dev = fit(Q, s)
        if dev <= tol: best = (tck, C, uu, dev); break
    if best is None: best = (tck, C, uu, dev)
    tck, C, uu, dev = best
    # place points by arc length + bending, so tight turns get more points
    seg = np.hypot(*np.diff(C, axis=0).T)
    ang = np.abs(np.diff(np.unwrap(np.arctan2(*np.diff(C, axis=0).T[::-1]))))
    w = np.r_[0, np.cumsum(seg[1:] + 0.08 * ang)]; w = np.r_[w, w[-1]]
    m = 60; idx = np.searchsorted(w, np.linspace(0, w[-1], m)).clip(0, len(C) - 1)
    R = C[np.unique(idx)] * sc + P.min(0); R[0], R[-1] = P[0], P[-1]
    return R, dev
def opt_with_smooth(o):
    if not o: return '[smooth]'
    body = re.sub(r',?\s*tension\s*=\s*[\d.]+', '', o[1:-1]).strip(' ,')
    return '[' + body + ']' if re.search(r'\bsmooth\b', body) else '[' + body + (', ' if body else '') + 'smooth]'
def process(s, tol=0.0025):
    out, last, n, devs = [], 0, 0, []
    for m in BLOCK.finditer(s):
        head, o1, o2, mid, body = m.groups(); opts = o1 or o2 or ''
        if re.search(r'only marks|mark=(?!none)', opts): continue
        pts = [(float(a), float(b)) for a, b in PT.findall(body)]
        if len(pts) < 12: continue
        R, dev = refit(pts, tol); n += 1; devs.append(round(dev, 4))
        kw = '\\addplot' if head.startswith('\\addplot') else 'plot'
        out.append(s[last:m.start()] + kw + opt_with_smooth(opts) + mid + ' '.join('(%.4g,%.4g)' % tuple(r) for r in R) + '}'); last = m.end()
    out.append(s[last:]); return ''.join(out), n, devs
if __name__ == '__main__':
    f = sys.argv[1]; tol = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0025
    s, n, devs = process(open(f).read(), tol); open(f, 'w').write(s); print(f, 'curves refitted:', n, 'max dev', devs)
