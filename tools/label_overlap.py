"""Labels that touch lines, curves or other labels in redrawn diagrams (owner 25 Nov).

# owner 25 Nov, relaying the checker: "MOST of the issues in diagrams come from the label overlapping with the graph or with
#   anotehr label. this SHOULD NOT happen on initial draw, check for this specifically."  (DIAGRAM_SPEC rules 6a/11)

usage: python3 tools/label_overlap.py <id | path/to/file.tex> ... [--all] [--json] [--report FILE]
                                     [--clear PT] [--clear-labels PT] [--min-px N] [--dpi N] [--jobs N] [--keep DIR]

For each drawing it compiles a temporary copy of state/tikz/tex/<id>.tex (the source is never touched) with a small check
preamble (qg_labelcheck below), rasterises it without anti-aliasing and measures:
  * every node's text is drawn in its own code colour (so each label's ink is known exactly, glyph by glyph);
  * \\halo is drawn as plain text (its white knock-out would hide a line running through the label);
  * stipple and hatching (shade dots / shade hatch) are drawn in a marker colour and ignored: labels on shading are rule 5b's
    business (\\halo), not an overlap;
  * every other dark pixel (lines, curves, axes, ticks, arrowheads, point dots, dashed lines; black down to black!60) is
    "stroke"; lighter greys (fills, grid lines, a black!30 frame) are ignored.
A label fails when stroke ink lies within --clear pt of its glyphs (default 1.0 pt, about 3 px at 200 dpi; DIAGRAM_SPEC 6a asks
for >= 2 px at 200 dpi), or another label's glyphs lie within --clear-labels pt (default 1.0 pt), counting at least --min-px pixels
(default 10) at --dpi (default 300). Calibrated 25 Nov on the 92 drawings the checker flagged for overlaps 17-24 Nov that were then
fixed: it flags 86 of the 92 versions he flagged and passes 73 of the 92 fixed ones (the 19 it still flags mostly have another
label touching that he did not mention). DIAGRAM_SPEC "Procedure per figure" 3a.

Output: one line per problem: id, label text (from the PDF, when it can be read), what it touches, pixels within the clearance and
the smallest gap in pt. Exit 1 when any problem is found (2 when a drawing does not compile). --json prints a list instead;
--report FILE also writes the full per-drawing result (problems and compile failures) as JSON.
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import STATE, scratch  # noqa: E402

TEX = STATE / 'tikz' / 'tex'
SHADE = (40, 200, 40)
CODE_B = 171
DARK = 100   # luminance below which a pixel is a stroke (black .. black!60); lighter greys are fills and grid lines

CHECK_TEX = r"""% qg_labelcheck: inserted by tools/label_overlap.py into a temporary copy only
\makeatletter
\let\qg@realcolor\color
\newcount\qg@n \newcount\qg@q
\def\qg@nocolor{\@ifnextchar[\qg@nocolor@o\qg@nocolor@p}
\def\qg@nocolor@o[#1]#2{}\def\qg@nocolor@p#1{}
% node n gets colour RGB(n mod 250 + 3, n div 250 + 10, 171); colours written inside the node are ignored
\def\qg@mark{\global\advance\qg@n by 1\relax\qg@q=\numexpr(\qg@n-125)/250\relax
  \edef\qg@rgb{\the\numexpr\qg@n-250*\qg@q+3\relax,\the\numexpr\qg@q+10\relax,171}%
  \expandafter\qg@realcolor\expandafter[\expandafter R\expandafter G\expandafter B\expandafter]\expandafter{\qg@rgb}%
  \let\color\qg@nocolor\let\tikz@textcolor\pgfutil@empty}
% "every text node part" runs inside every node's text box, and no drawing sets it (an "every node/.style" in a picture would
% replace an appended every-node style); emptying \tikz@textcolor stops a node's text= colour replacing the code
\tikzset{every text node part/.code={\qg@mark}}
\renewcommand{\halo}[1]{#1}
\definecolor{qgshade}{RGB}{40,200,40}
\def\exam@stipplecolor{qgshade}\def\examsetstipplecolor#1{}
\def\exam@hatch#1{%
  \pgftransformreset
  \pgfpointanchor{path picture bounding box}{south west}\ex@xa=\pgf@x \ex@ya=\pgf@y
  \pgfpointanchor{path picture bounding box}{north east}\ex@xb=\pgf@x \ex@yb=\pgf@y
  \ex@d=\dimexpr\ex@yb-\ex@ya\relax \ex@x=\dimexpr\ex@xa-\ex@d\relax
  \loop\ifdim\ex@x<\ex@xb
    \ifnum#1>0 \pgfpathmoveto{\pgfqpoint{\ex@x}{\ex@ya}}\pgfpathlineto{\pgfqpoint{\dimexpr\ex@x+\ex@d\relax}{\ex@yb}}%
    \else \pgfpathmoveto{\pgfqpoint{\ex@x}{\ex@yb}}\pgfpathlineto{\pgfqpoint{\dimexpr\ex@x+\ex@d\relax}{\ex@ya}}\fi
    \advance\ex@x by 4.24pt
  \repeat
  \pgfsetlinewidth{0.4pt}\pgfsetstrokecolor{qgshade}\pgfusepath{stroke}}
\makeatother
"""


def source(arg):
    """(id, path) for an id in state/tikz/tex or a .tex path (e.g. an older version from git show)."""
    p = Path(arg)
    if arg.endswith('.tex') and p.exists(): return p.stem, p
    return arg, TEX / f'{arg}.tex'


def compile_check(name, path, dpi, keep=None):
    """Compile the check copy; returns (rgb array, pdf path, workdir) or raises RuntimeError with the LaTeX error."""
    base = Path(tempfile.mkdtemp(prefix='lo_', dir=scratch('label_overlap')))
    for st in ('examstyle', 'tree_style'): shutil.copy(STATE / 'tikz' / f'{st}.tex', base / f'{st}.tex')
    (base / 'qg_labelcheck.tex').write_text(CHECK_TEX)
    b = base / 'build'; b.mkdir()
    src = path.read_text()
    if '\\begin{document}' not in src: raise RuntimeError('no \\begin{document}')
    src = src.replace('\\begin{document}', '\\input{../qg_labelcheck.tex}\n\\begin{document}', 1)
    (b / 'c.tex').write_text(src)
    r = subprocess.run(['pdflatex', '-interaction=nonstopmode', '-halt-on-error', 'c.tex'], cwd=b, capture_output=True, text=True,
                       timeout=300, env={**os.environ, 'extra_mem_bot': '30000000'})
    if r.returncode or not (b / 'c.pdf').exists():
        log = (b / 'c.log').read_text(errors='replace') if (b / 'c.log').exists() else r.stdout
        shutil.rmtree(base, ignore_errors=True)
        raise RuntimeError(' | '.join(re.findall(r'^!.*', log, re.M)[:2]) or 'pdflatex failed')
    subprocess.run(['pdftoppm', '-png', '-r', str(dpi), '-aa', 'no', '-aaVector', 'no', '-singlefile', 'c.pdf', 'c'], cwd=b, check=True)
    img = np.asarray(Image.open(b / 'c.png').convert('RGB')).astype(np.int32)
    if keep:
        Path(keep).mkdir(parents=True, exist_ok=True)
        shutil.copy(b / 'c.png', Path(keep) / f'{name}.check.png'); shutil.copy(b / 'c.pdf', Path(keep) / f'{name}.check.pdf')
    return img, b / 'c.pdf', base


def label_texts(pdf, boxes, dpi):
    """Text inside each label's ink box, read from the PDF (best effort: maths fonts may give odd characters)."""
    out = {}
    try:
        import pymupdf
        page = pymupdf.open(str(pdf))[0]
        chars = []
        for blk in page.get_text('rawdict')['blocks']:
            for ln in blk.get('lines', []):
                for sp in ln['spans']:
                    for ch in sp['chars']:
                        x0, y0, x1, y1 = ch['bbox']; chars.append(((x0 + x1) / 2, (y0 + y1) / 2, ch['c']))
        s = 72.0 / dpi
        for code, (x0, y0, x1, y1) in boxes.items():
            # characters in the PDF's own order (the order TeX set them)
            t = ''.join(c for cx, cy, c in chars if x0 * s - 1 <= cx <= (x1 + 1) * s + 1 and y0 * s - 1 <= cy <= (y1 + 1) * s + 1).strip()
            out[code] = t.replace('\u2212', '-').replace('\u25e6', '°')
    except Exception:
        pass
    return out


def analyse(img, clear_pt, clear_ll_pt, min_px, dpi):
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    is_code = (b == CODE_B) & (g >= 10) & (r >= 3) & (r <= 252) & ~((r == g) & (g == b))
    shade = (r == SHADE[0]) & (g == SHADE[1]) & (b == SHADE[2])
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    stroke = (lum < DARK) & ~is_code & ~shade
    codes = np.where(is_code, (g - 10) * 250 + (r - 3), -1)
    px = dpi / 72.0
    cs, cl = clear_pt * px, clear_ll_pt * px
    pad = int(np.ceil(max(cs, cl))) + 2
    H, W = codes.shape
    labels = {}
    for code in np.unique(codes[codes >= 0]):
        ys, xs = np.nonzero(codes == code)
        labels[int(code)] = (xs.min(), ys.min(), xs.max(), ys.max())
    probs = []
    for code, (x0, y0, x1, y1) in labels.items():
        X0, Y0, X1, Y1 = max(0, x0 - pad), max(0, y0 - pad), min(W, x1 + pad + 1), min(H, y1 + pad + 1)
        win = codes[Y0:Y1, X0:X1]
        me = win == code
        d = ndimage.distance_transform_edt(~me)
        st = stroke[Y0:Y1, X0:X1]
        hit = st & (d <= cs)
        n = int(hit.sum())
        if n >= min_px:
            yy, xx = np.nonzero(hit)
            probs.append({'label': code, 'touches': 'line', 'px': n, 'gap_pt': round(float(d[st].min()) / px, 2),
                          'at_pt': [round((X0 + xx.mean()) / px, 1), round((Y0 + yy.mean()) / px, 1)]})
        other = (win >= 0) & ~me & (d <= cl)
        for oc in np.unique(win[other]):
            if oc < code and int(oc) in labels: continue   # each pair once (the lower code reports it)
            m = other & (win == oc)
            if int(m.sum()) >= min_px:
                yy, xx = np.nonzero(m)
                probs.append({'label': code, 'touches': 'label', 'other': int(oc), 'px': int(m.sum()),
                              'gap_pt': round(float(d[win == oc].min()) / px, 2),
                              'at_pt': [round((X0 + xx.mean()) / px, 1), round((Y0 + yy.mean()) / px, 1)]})
    return labels, probs


def check_one(arg, opt):
    name, path = source(arg)
    res = {'id': name, 'source': str(path)}
    if not path.exists(): res['error'] = 'no source'; return res
    try:
        img, pdf, base = compile_check(name, path, opt['dpi'], opt.get('keep'))
    except Exception as e:
        res['error'] = str(e)[:300]; return res
    try:
        labels, probs = analyse(img, opt['clear'], opt['clear_labels'], opt['min_px'], opt['dpi'])
        texts = label_texts(pdf, {c: labels[c] for c in {p['label'] for p in probs} | {p.get('other') for p in probs if p.get('other') is not None}}, opt['dpi'])
        for p in probs:
            p['text'] = texts.get(p['label'], '')
            if 'other' in p: p['other_text'] = texts.get(p['other'], '')
        res['labels'] = len(labels); res['problems'] = probs
        res['score'] = sum(p['px'] for p in probs)
    finally:
        shutil.rmtree(base, ignore_errors=True)
    return res


DEFAULTS = dict(dpi=300, clear=1.0, clear_labels=1.0, min_px=10)


def problems(arg, **opt):
    """For other tools (the import's diagrams step, flag fixes): the problem lines for one drawing ([] = clean)."""
    r = check_one(arg, {**DEFAULTS, **opt})
    if r.get('error'): return [f"{r['id']}: NOT CHECKED: {r['error']}"]
    return [line(r, p) for p in r['problems']]


def line(res, p):
    what = 'a line/curve/axis/point' if p['touches'] == 'line' else f"label '{p.get('other_text', '')}'"
    return (f"{res['id']}: '{p.get('text', '')}' touches {what}: {p['px']} px within clearance, gap {p['gap_pt']} pt"
            f" (at {p['at_pt'][0]},{p['at_pt'][1]} pt from top left)")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('ids', nargs='*')
    ap.add_argument('--all', action='store_true', help='every drawing in state/tikz/tex')
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--report', help='also write the full result as JSON to this file')
    ap.add_argument('--clear', type=float, default=DEFAULTS['clear'], help='clearance label-to-stroke in pt (default 1.0)')
    ap.add_argument('--clear-labels', type=float, default=DEFAULTS['clear_labels'], help='clearance label-to-label in pt (default 1.0)')
    ap.add_argument('--min-px', type=int, default=DEFAULTS['min_px'], help='pixels (at --dpi) inside the clearance before it counts (default 10)')
    ap.add_argument('--dpi', type=int, default=DEFAULTS['dpi'])
    ap.add_argument('--jobs', type=int, default=os.cpu_count() or 2)
    ap.add_argument('--keep', help='keep each check render (png + pdf) in this folder')
    a = ap.parse_args()
    ids = sorted(p.stem for p in TEX.glob('*.tex')) if a.all else a.ids
    if not ids: ap.error('give ids or --all')
    opt = dict(dpi=a.dpi, clear=a.clear, clear_labels=a.clear_labels, min_px=a.min_px, keep=a.keep)
    if len(ids) == 1 or a.jobs == 1:
        results = [check_one(i, opt) for i in ids]
    else:
        with ProcessPoolExecutor(a.jobs) as ex: results = list(ex.map(check_one, ids, [opt] * len(ids), chunksize=4))
    bad = [r for r in results if r.get('problems')]
    errs = [r for r in results if r.get('error')]
    if a.report:
        Path(a.report).write_text(json.dumps({'settings': {k: v for k, v in opt.items() if k != 'keep'}, 'checked': len(results),
                                              'with_problems': len(bad), 'compile_errors': len(errs), 'results': results},
                                             ensure_ascii=False, indent=1))
    if a.json:
        print(json.dumps([r for r in results if r.get('problems') or r.get('error')], ensure_ascii=False, indent=1))
    else:
        for r in results:
            if r.get('error'): print(f"{r['id']}: NOT CHECKED: {r['error']}")
            for p in r.get('problems', []): print(line(r, p))
        if len(results) > 1: print(f'{len(results)} checked, {len(bad)} with label problems, {len(errs)} not checked')
    sys.exit(2 if errs and not bad else (1 if bad else 0))


if __name__ == '__main__':
    main()
