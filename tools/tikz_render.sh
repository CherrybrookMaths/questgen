#!/bin/bash
# usage: tikz_render.sh <id>   (reads tikz/tex/<id>.tex = body of a tikzpicture document, standalone)
set -e; id=$1; cd /home/claude/pilot/tikz
mkdir -p build && cp tex/$id.tex build/$id.tex
cd build && extra_mem_bot=30000000 pdflatex -interaction=nonstopmode -halt-on-error $id.tex > $id.log 2>&1 || { grep -m5 -A3 '^!' $id.log; exit 1; }
pdftocairo -svg $id.pdf ../svg/$id.svg
python3 /home/claude/pilot/tools/svg_compact.py ../svg/$id.svg
pdftoppm -png -r 200 -singlefile $id.pdf ../png/$id
python3 - "$id" <<'PY'
import sys; from PIL import Image, ImageDraw
i=sys.argv[1]; a=Image.open(f'/home/claude/pilot/figures/{i}.png').convert('RGB'); b=Image.open(f'/home/claude/pilot/tikz/png/{i}.png').convert('RGB')
h=max(a.height,b.height); s=Image.new('RGB',(a.width+b.width+30,h+30),'white'); s.paste(a,(0,30)); s.paste(b,(a.width+30,30))
d=ImageDraw.Draw(s); d.text((5,5),'ORIGINAL',fill='red'); d.text((a.width+35,5),'REDRAWN',fill='blue'); d.line([(a.width+15,0),(a.width+15,h+30)],fill='gray')
s.save(f'/home/claude/pilot/tikz/cmp/{i}.png')
PY
echo "ok $id"
