#!/usr/bin/env python3
"""Re-cut figure crops (figures/<id>.png) from the exam PDFs: the crops are build output, not something to back up.

Owner 17 Nov ("What is realistic coding best practice in this case?" -> "yeah build it and run the test"): the inputs are the
exam PDFs (src/<doc>.pdf, downloaded from the school drive by Drive id) and each crop's page and bbox in the database
(figures.page, figures.bbox, kept current by tools/crop_check.py); the recipe is this tool; the PNGs can be thrown away.
A solution figure cut from a separate solutions file names that file in its parse output (state/out/<doc>.json
solution_figures[].source_pdf); everything else comes from the paper's own PDF. Cut exactly as the parser and crop_check
do: page.get_pixmap(dpi=200, clip=bbox).

  python3 tools/recrop.py --check DOC [DOC ...]   re-cut into SCRATCH and compare pixel by pixel with figures/ (nothing written)
  python3 tools/recrop.py --check --fix-bbox DOC  ... and where a crop differs, find where it really sits (page + bbox) and
                                                   correct the database when the re-cut then matches exactly
  python3 tools/recrop.py DOC [DOC ...]           write figures/<id>.png (a missing crop, or after a bbox change)

A crop edited after cutting (masked, or cut from another rendering) cannot come from a recipe: its original is kept as
source in state/figures_kept/<id>.png (tracked in git) and this tool copies it back instead of cutting (17 Nov: 382_q23_s1
masked strip, 416_q13_1 cut in greyscale from the draft page). Figures with no bbox ("[]": a new solution sketch drawn on a copy of the question's grid) have no recipe here: they are
listed as such. Exit code 1 in --check mode when any crop differs or cannot be cut.
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import json, os, sqlite3, sys
import numpy as np
import pymupdf
from PIL import Image

P = paths.P
DPI = 200


def source_pdfs(doc):
    """{figure id: pdf doc id} for solution figures cut from another file (parse output), else {}."""
    f = paths.S + f'out/{doc}.json'
    if not os.path.exists(f): return {}
    return {s['id']: int(s['source_pdf']) for s in json.load(open(f)).get('solution_figures', []) if s.get('source_pdf')}


def cut(pdf_path, page, bbox, out):
    with pymupdf.open(pdf_path) as pdf:
        pdf[page].get_pixmap(dpi=DPI, clip=pymupdf.Rect(bbox)).save(out)


def compare(a, b):
    """(same size, share of pixels that differ, largest channel difference)."""
    x = np.asarray(Image.open(a).convert('RGB'), dtype=np.int16); y = np.asarray(Image.open(b).convert('RGB'), dtype=np.int16)
    if x.shape != y.shape: return False, 1.0, 255
    d = np.abs(x - y).max(axis=2)
    return True, float((d > 0).mean()), int(d.max())


def locate(pdf_path, png, page_hint):
    """Where the crop really came from: (page, bbox in points, exact) by matching the original PNG against each page rendered at
    200 dpi (the hinted page first). Used by --fix-bbox when a parser padded its cut or cut from another page than it recorded."""
    from scipy.signal import fftconvolve
    t = np.asarray(Image.open(png).convert('L'), dtype=np.float32)
    best = None
    with pymupdf.open(pdf_path) as pdf:
        for pg in [page_hint] + [i for i in range(len(pdf)) if i != page_hint]:
            pix = pdf[pg].get_pixmap(dpi=DPI, colorspace=pymupdf.csGRAY)
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width).astype(np.float32)
            if img.shape[0] < t.shape[0] or img.shape[1] < t.shape[1]: continue
            # sum of squared differences via FFT: |I|^2 window sums - 2 I*T + |T|^2
            ones = np.ones_like(t)
            ssd = fftconvolve(img ** 2, ones[::-1, ::-1], mode='valid') - 2 * fftconvolve(img, t[::-1, ::-1], mode='valid') + (t ** 2).sum()
            y, x = np.unravel_index(np.argmin(ssd), ssd.shape)
            err = float(np.abs(img[y:y + t.shape[0], x:x + t.shape[1]] - t).mean())
            if best is None or err < best[2]: best = (pg, (x, y), err)
            if err < 0.5: break
    pg, (x, y), err = best
    k = 72 / DPI
    return pg, [float(x * k), float(y * k), float((x + t.shape[1]) * k), float((y + t.shape[0]) * k)], err


def main():
    check = '--check' in sys.argv
    docs = [int(a) for a in sys.argv[1:] if a.isdigit()]
    db = sqlite3.connect(paths.DBS)
    tmp = os.path.join(paths.SCRATCH, 'recrop'); os.makedirs(tmp, exist_ok=True)
    stats = {'same': 0, 'differs': 0, 'no_recipe': 0, 'no_pdf': 0, 'no_original': 0}; bad = []
    for doc in docs:
        srcs = source_pdfs(doc)
        for page, bbox, png in db.execute('select f.page, f.bbox, f.png_path from figures f join questions q on q.id=f.question_id '
                                          'where q.document_id=? order by f.png_path', (doc,)):
            k = os.path.basename(png)[:-4]
            kept = paths.S + f'figures_kept/{k}.png'
            if os.path.exists(kept):   # edited after cutting: the kept original is the source
                if check:
                    same, share, _ = compare(P + png, kept) if os.path.exists(P + png) else (False, 1, 0)
                    stats['kept' if same and share == 0 else 'differs'] = stats.get('kept' if same and share == 0 else 'differs', 0) + 1
                else:
                    import shutil; shutil.copyfile(kept, P + png)
                continue
            b = json.loads(bbox) if bbox else []
            if len(b) != 4: stats['no_recipe'] += 1; continue
            pdf = str(paths.SRC / f'{srcs.get(k, doc)}.pdf')
            if not os.path.exists(pdf): stats['no_pdf'] += 1; bad.append((k, 'no PDF ' + os.path.basename(pdf))); continue
            if not check:
                cut(pdf, page, b, P + png); continue
            if not os.path.exists(P + png): stats['no_original'] += 1; continue
            out = os.path.join(tmp, k + '.png'); cut(pdf, page, b, out)
            same, share, mx = compare(P + png, out)
            if same and share == 0: stats['same'] += 1
            else:
                stats['differs'] += 1; why = 'size differs' if not same else f'{share:.1%} of pixels differ (max {mx})'
                if '--fix-bbox' in sys.argv:
                    pg, nb, err = locate(pdf, P + png, page)
                    cut(pdf, pg, nb, out); same2, share2, _ = compare(P + png, out)
                    if same2 and share2 == 0:
                        db.execute('update figures set page=?, bbox=? where png_path=?', (pg, json.dumps(nb), png)); stats['fixed'] = stats.get('fixed', 0) + 1
                        why += f' -> fixed: page {page}->{pg}, bbox {b}->{nb}'
                    else: why += f' -> best match page {pg} (mean error {err:.1f}): the crop was edited after cutting'
                bad.append((k, why))
    db.commit()
    print('recrop' + (' --check' if check else '') + ':', stats)
    for k, why in bad[:40]: print('  ', k, why)
    if check and (stats['differs'] or stats['no_pdf']): sys.exit(1)


if __name__ == '__main__':
    main()
