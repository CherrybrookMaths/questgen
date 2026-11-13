#!/usr/bin/env python3
"""Copy the page sources (page_src/) to site/project/page_src/ so they publish with the page for resume.

.js, .css and .html files become .js.txt, .css.txt and .html.txt, so the artifact serves them as text and never runs
them (an .html file would be served as a second page on the artifact; reviewer 14 Nov). build.json is copied as it is. Anything under site/project/page_src/ that no longer exists in
page_src/ is removed, so the copy always mirrors the source. Deterministic; prints what it wrote.

Usage: python3 tools/export_src.py      (run after tools/build_page.py, before publishing)
To restore from a published copy: download project/page_src/*, drop the .txt suffixes, put the files in page_src/.
"""
import pathlib, shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'page_src'
DST = ROOT / 'site' / 'project' / 'page_src'

# ONLY these are copied: page.html, build.json, css/*.css, js/*.js. Never a .pdf, and never anything from src/ (src/ holds
# the staged exam PDFs of the import: publishing them would try to upload ~900 MB).
wanted = {}
for p in [SRC / 'page.html', SRC / 'build.json'] + sorted((SRC / 'css').glob('*.css')) + sorted((SRC / 'js').glob('*.js')):
    assert p.is_file() and p.resolve().is_relative_to(SRC.resolve()) and p.suffix != '.pdf', p
    rel = p.relative_to(SRC)
    name = rel.name + '.txt' if p.suffix in ('.js', '.css', '.html') else rel.name
    wanted[rel.parent / name] = p

DST.mkdir(parents=True, exist_ok=True)
for q in sorted(DST.rglob('*'), reverse=True):
    rel = q.relative_to(DST)
    if q.is_file() and rel not in wanted:
        q.unlink(); print('removed', rel)
    elif q.is_dir() and not any(q.iterdir()):
        q.rmdir()
n = 0
for rel, p in wanted.items():
    out = DST / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    data = p.read_bytes()
    if not out.exists() or out.read_bytes() != data:
        out.write_bytes(data); n += 1
assert not any(str(r).endswith('.pdf') for r in wanted)
print(f'export_src: {len(wanted)} files in {DST.relative_to(ROOT)} ({n} updated)')
