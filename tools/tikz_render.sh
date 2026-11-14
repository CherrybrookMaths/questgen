#!/bin/bash
# usage: tikz_render.sh <id>   (reads state/tikz/tex/<id>.tex = body of a tikzpicture document, standalone)
# Sources are tracked in state/tikz/ (tex/, examstyle.tex, tree_style.tex); build outputs go to the untracked tikz/
# (build/, svg/, png/, cmp/). Every .tex does \input{../examstyle.tex} (24 also ../tree_style.tex), relative to tikz/build,
# so the two style files are linked into tikz/ when missing. The repo root comes from this script's own location.
set -e; id=$1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; T="$ROOT/tikz"; ST="$ROOT/state/tikz"
mkdir -p "$T/build" "$T/svg" "$T/png" "$T/cmp"
for f in examstyle tree_style; do [ -e "$T/$f.tex" ] || ln -s "$ST/$f.tex" "$T/$f.tex"; done
cd "$T"; cp "$ST/tex/$id.tex" build/$id.tex
cd build && extra_mem_bot=30000000 pdflatex -interaction=nonstopmode -halt-on-error $id.tex > $id.log 2>&1 || { grep -m5 -A3 '^!' $id.log; exit 1; }
pdftocairo -svg $id.pdf ../svg/$id.svg
python3 "$ROOT/tools/svg_compact.py" ../svg/$id.svg
pdftoppm -png -r 200 -singlefile $id.pdf ../png/$id
python3 - "$id" "$ROOT" <<'PY'
import sys; from PIL import Image, ImageDraw
i, R = sys.argv[1], sys.argv[2]; a=Image.open(f'{R}/figures/{i}.png').convert('RGB'); b=Image.open(f'{R}/tikz/png/{i}.png').convert('RGB')
h=max(a.height,b.height); s=Image.new('RGB',(a.width+b.width+30,h+30),'white'); s.paste(a,(0,30)); s.paste(b,(a.width+30,30))
d=ImageDraw.Draw(s); d.text((5,5),'ORIGINAL',fill='red'); d.text((a.width+35,5),'REDRAWN',fill='blue'); d.line([(a.width+15,0),(a.width+15,h+30)],fill='gray')
s.save(f'{R}/tikz/cmp/{i}.png')
PY
echo "ok $id"
