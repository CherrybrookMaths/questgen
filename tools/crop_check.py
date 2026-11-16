"""Find figure crops that cut a drawing off (owner 12 Nov, 2024 HSC Q1: "it only cropped the right side of the full
cartesian plane") and widen them.
For each figure with a page bbox: render the page, and while ink touches a crop edge AND continues outside it, move
that edge outward (2 pt steps) until the edge is clear, stopping at a line of question text (a word of 4+ letters
from the PDF text layer) or 90 pt. Re-crops figures/<id>.png at 200 dpi and updates figures.bbox.
Usage: python3 crop_check.py <doc_id> [...] [--apply]   -> lists widened crops (ids) in work/crop_fixes.json"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import sys, json, sqlite3, os
import pymupdf, numpy as np
P = paths.P
APPLY = '--apply' in sys.argv; IDS = [int(a) for a in sys.argv[1:] if a.isdigit()]
db = sqlite3.connect(paths.DBS)
DPI = 150; Z = DPI / 72
fixed = []
for doc in IDS:
    pdf = pymupdf.open(P + f'src/{doc}.pdf'); cache = {}
    rows = db.execute("select f.id, f.page, f.bbox, f.png_path from figures f join questions q on q.id=f.question_id where q.document_id=? and f.png_path not like '%\\_s%' escape '\\'", (doc,)).fetchall()
    scan = db.execute('select parse_path from documents where id=?', (doc,)).fetchone()[0] == 'scan'
    for fid, page, bbox, png in rows:
        try: b = json.loads(bbox)
        except Exception: continue
        if not b or len(b) != 4 or page is None or page >= pdf.page_count: continue
        if page not in cache:
            pg = pdf[page]; pix = pg.get_pixmap(dpi=DPI, colorspace=pymupdf.csGRAY)
            ink = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width) < 200
            words = [pymupdf.Rect(w[:4]) for w in pg.get_text('words') if sum(ch.isalpha() for ch in w[4]) >= 3]
            cache[page] = (ink, words, pg.rect)
        ink, words, R = cache[page]
        x0, y0, x1, y1 = b; orig = (x0, y0, x1, y1); LIM = 30 if scan else 90   # scans: handwriting and noise touch everything, so only small fixes
        def px(v): return int(round(v * Z))
        def col_ink(x, a, c): return ink[max(0, px(a)):px(c), min(ink.shape[1] - 1, max(0, px(x)))].any()
        def row_ink(y, a, c): return ink[min(ink.shape[0] - 1, max(0, px(y))), max(0, px(a)):px(c)].any()
        others = [pymupdf.Rect(json.loads(o[0])) for o in db.execute("select f.bbox from figures f join questions q on q.id=f.question_id where q.document_id=? and f.page=? and f.id!=? and f.png_path not like '%\\_s%' escape '\\'", (doc, page, fid)) if o[0] and o[0] != '[]']
        def blocked(r): return any(r.intersects(w) and not pymupdf.Rect(orig).contains(w) for w in words) or any(r.intersects(o) for o in others)   # never grow into a neighbouring figure (640 Q7 option graphs)
        for _ in range(45):
            moved = False
            if x0 > R.x0 + 2 and col_ink(x0, y0, y1) and col_ink(x0 - 2, y0, y1) and not blocked(pymupdf.Rect(x0 - 2, y0, x0, y1)) and orig[0] - x0 < LIM: x0 -= 2; moved = True
            if x1 < R.x1 - 2 and col_ink(x1, y0, y1) and col_ink(x1 + 2, y0, y1) and not blocked(pymupdf.Rect(x1, y0, x1 + 2, y1)) and x1 - orig[2] < LIM: x1 += 2; moved = True
            if y0 > R.y0 + 2 and row_ink(y0, x0, x1) and row_ink(y0 - 2, x0, x1) and not blocked(pymupdf.Rect(x0, y0 - 2, x1, y0)) and orig[1] - y0 < LIM: y0 -= 2; moved = True
            if y1 < R.y1 - 2 and row_ink(y1, x0, x1) and row_ink(y1 + 2, x0, x1) and not blocked(pymupdf.Rect(x0, y1, x1, y1 + 2)) and y1 - orig[3] < LIM: y1 += 2; moved = True
            if not moved: break
        grow = max(orig[0] - x0, x1 - orig[2], orig[1] - y0, y1 - orig[3])
        if grow >= 6:   # a few points is anti-aliasing; more is a cut-off drawing
            nb = [round(x0 - 3, 1), round(y0 - 3, 1), round(x1 + 3, 1), round(y1 + 3, 1)]
            key = os.path.basename(png)[:-4]; fixed.append(dict(id=key, doc=doc, old=list(orig), new=nb, grow=round(grow)))
            if APPLY and not scan:
                pdf[page].get_pixmap(dpi=200, clip=pymupdf.Rect(nb)).save(P + png)
                db.execute('update figures set bbox=? where id=?', (json.dumps(nb), fid))
db.commit()
old = json.load(open(paths.S + 'work/crop_fixes.json')) if os.path.exists(paths.S + 'work/crop_fixes.json') else []
json.dump(old + [f for f in fixed if APPLY], open(paths.S + 'work/crop_fixes.json', 'w'), indent=1)
flags = [f for f in fixed if db.execute('select parse_path from documents where id=?', (f['doc'],)).fetchone()[0] == 'scan']
old_flags = json.load(open(paths.S + 'work/crop_flags.json')) if os.path.exists(paths.S + 'work/crop_flags.json') else []
json.dump(old_flags + flags, open(paths.S + 'work/crop_flags.json', 'w'), indent=1)   # scans: not re-cropped automatically (handwriting); triage asks for a look
print(len(fixed), 'crops cut a drawing off' + (' (re-cropped)' if APPLY else ''))
json.dump(fixed, open(paths.S + "work/crop_candidates.json", "w"))
for f in fixed: print(f['id'], 'widened by', f['grow'], 'pt')
