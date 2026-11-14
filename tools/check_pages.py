#!/usr/bin/env python3
"""Page pictures for Processes › Papers › Needs a check: the cover and 3 question pages of a paper, at thumbnail and full size.

Owner 14 Nov: "Needs a check rows show the cover + 3 pages picked at random from the question pages (enlarge on click) and an
'Open the whole PDF in Drive' link ... The cover-page check renders the 4 images and stores them in the asset store (needs Fix 1)."

  python3 tools/check_pages.py --pdf PATH --paper ID [--out DIR] [--manifest FILE|none]
  python3 tools/check_pages.py --pdf A.pdf --paper 101 --pdf B.pdf --paper 102 --out work/check_pages_test --manifest none

Read-only on the PDF (opened read-only, never written). For each paper it writes ONE small JSON pack:
  <out>/<paper id>.json  {v, id, made, seed, pdf_pages, pages: [{n, role: 'cover'|'question', w, h, thumb, full}]}
thumb / full are data: URLs (WebP), THUMB_W and FULL_W pixels wide. And it lists the pack in the manifest:
  site/data/check_pages.json  {v, made, papers: {"<paper id>": {path: 'data/check/<id>.json', sha256, bytes, pages: [n, ...]}}}
The page (35_papers_check.js) reads the manifest when Needs a check opens and fetches each row's pack through QG.url(path, sha256),
so a pack listed in data/assets.json (tools/asset_upload_plan.py includes data/check/*.json) comes from the asset store, else from
the published file (Fix 1's mechanism). A paper with no pack shows a placeholder per page.

Which pages: page 1 is the cover. The 3 others are drawn at random from the QUESTION pages: every later page that is not blank
("intentionally left blank", almost no text and almost no ink), not an instructions page (general instructions, reading time,
attempt questions, without a question number on it), not a reference / formula sheet and not a writing booklet / extra space
page. A scanned page (no text layer) counts as a question page when it has ink. The draw uses a FIXED seed per paper
('qg-check-<paper id>'), so the pages never reshuffle between runs. Fewer than 3 question pages: the ones there are.

Who runs it: the cover-page check run (IMPORT_PLAYBOOK "Queue": Run the cover-page check writes runs {kind: 'cover_check'}),
with each paper's PDF downloaded from Drive to a local path first. Never on src/ in place of the check (src/ is read-only).
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import argparse, base64, hashlib, io, json, os, random, re, sys, time

import pymupdf as fitz
from PIL import Image

P = paths.P
OUT = P + 'site/data/check'
MANIFEST = P + 'site/data/check_pages.json'
THUMB_W, FULL_W = 180, 1100          # px: the row's strip, the viewer
THUMB_Q, FULL_Q = 55, 62             # WebP quality: a pack is about 0.2-0.4 MB
PICK = 3
BLANK = re.compile(r'(intentionally\s+)?(left\s+)?blank(\s+page)?\b|this\s+page\s+(is\s+)?(left\s+)?blank', re.I)
INSTR = re.compile(r'general\s+instructions|reading\s+time|working\s+time|instructions\s+to\s+candidates|attempt\s+(all\s+)?questions|'
                   r'write\s+using\s+black\s+pen|approved\s+calculators|total\s+marks\s*:?\s*\d+\s*$', re.I | re.M)
REF = re.compile(r'reference\s+sheet|formula(e)?\s+sheet|standard\s+integrals|data\s+sheet', re.I)
EXTRA = re.compile(r'writing\s+booklet|extra\s+writing\s+space|additional\s+writing\s+space|end\s+of\s+(paper|examination|exam|test)\s*$', re.I | re.M)
QMARK = re.compile(r'\bquestion\s+\d+|\(\s*[a-h]\s*\)|\b\d+\s+marks?\b|\[\s*\d\s*\]', re.I)


def seed_of(paper):
    return f'qg-check-{paper}'


def ink(page):
    """Share of non-white pixels on a small render (a blank scan has almost none)."""
    pm = page.get_pixmap(matrix=fitz.Matrix(0.25, 0.25), colorspace=fitz.csGRAY)
    px = pm.samples
    return sum(1 for b in px if b < 200) / max(1, len(px))


def kind(page):
    """'question', 'blank', 'instructions', 'reference' or 'extra' for a page after the cover."""
    t = page.get_text('text') or ''
    s = re.sub(r'\s+', ' ', t).strip()
    if len(s) < 40:
        if BLANK.search(s) or ink(page) < 0.004: return 'blank'
        return 'question' if not s else ('blank' if BLANK.search(s) else 'question')   # a scan: no text layer, but ink
    if BLANK.search(s) and len(s) < 200: return 'blank'
    if REF.search(s) and not re.search(r'\bquestion\s+\d+', s, re.I): return 'reference'
    if INSTR.search(t) and not re.search(r'\bquestion\s+\d+', s, re.I): return 'instructions'
    if EXTRA.search(t) and not QMARK.search(s): return 'extra'
    return 'question'


def pick(doc, paper):
    """[cover page number, 3 question pages] (1-based, ascending after the cover), drawn with the paper's fixed seed."""
    qs = [i + 1 for i in range(1, doc.page_count) if kind(doc[i]) == 'question']
    rng = random.Random(seed_of(paper))
    return [1] + sorted(rng.sample(qs, min(PICK, len(qs)))), qs


def webp(page, width, q):
    z = width / page.rect.width
    pm = page.get_pixmap(matrix=fitz.Matrix(z, z), alpha=False)
    im = Image.frombytes('RGB', (pm.width, pm.height), pm.samples)
    b = io.BytesIO(); im.save(b, 'WEBP', quality=q, method=6)
    return 'data:image/webp;base64,' + base64.b64encode(b.getvalue()).decode(), pm.width, pm.height


def pack(pdf, paper):
    doc = fitz.open(pdf)    # read-only: nothing is saved back
    try:
        ns, qs = pick(doc, paper)
        pages = []
        for n in ns:
            pg = doc[n - 1]
            th, _, _ = webp(pg, THUMB_W, THUMB_Q)
            fu, w, h = webp(pg, FULL_W, FULL_Q)
            pages.append({'n': n, 'role': 'cover' if n == 1 else 'question', 'w': w, 'h': h, 'thumb': th, 'full': fu})
        return {'v': 1, 'id': paper, 'made': time.strftime('%Y-%m-%dT%H:%M:%S'), 'seed': seed_of(paper), 'pdf_pages': doc.page_count,
                'question_pages': len(qs), 'pages': pages}
    finally:
        doc.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--pdf', action='append', required=True, help='local PDF path (read-only); repeat with --paper')
    ap.add_argument('--paper', action='append', type=int, required=True, help='the paper id (inventory id) of each --pdf')
    ap.add_argument('--out', default=OUT, help='folder for the packs (default site/data/check)')
    ap.add_argument('--manifest', default=MANIFEST, help="manifest to update (default site/data/check_pages.json), or 'none'")
    a = ap.parse_args()
    if len(a.pdf) != len(a.paper): sys.exit('give one --paper for each --pdf')
    os.makedirs(a.out, exist_ok=True)
    man = None
    if a.manifest != 'none':
        man = json.load(open(a.manifest)) if os.path.exists(a.manifest) else {'v': 1, 'papers': {}}
    for pdf, paper in zip(a.pdf, a.paper):
        x = pack(pdf, paper)
        body = json.dumps(x, separators=(',', ':')).encode()
        f = os.path.join(a.out, f'{paper}.json')
        open(f, 'wb').write(body)
        print(f'{paper}: pages {[p["n"] for p in x["pages"]]} of {x["pdf_pages"]} ({x["question_pages"]} question pages) -> {os.path.relpath(f, P)} ({len(body) / 1024:.0f} KB)')
        if man is not None:
            rel = os.path.relpath(f, P + 'site')
            man['papers'][str(paper)] = {'path': rel, 'sha256': hashlib.sha256(body).hexdigest(), 'bytes': len(body), 'pages': [p['n'] for p in x['pages']]}
    if man is not None:
        man['made'] = time.strftime('%Y-%m-%d %H:%M')
        json.dump(man, open(a.manifest, 'w'), indent=1)
        print(f'manifest: {os.path.relpath(a.manifest, P)} ({len(man["papers"])} papers)')


if __name__ == '__main__':
    main()
