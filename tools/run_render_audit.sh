#!/bin/bash
# Render audit with its own short-lived web server (background servers do not survive between turns).
# MathJax 4.1.3 is installed once into $QG_MJ (default: <scratch>/mj, scratch = $QG_SCRATCH or <system temp>/questgen).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCR="${QG_SCRATCH:-$(python3 -c 'import tempfile;print(tempfile.gettempdir())')/questgen}"; export QG_MJ="${QG_MJ:-$SCR/mj}"
cd "$ROOT/site" && python3 -m http.server 8765 >/dev/null 2>&1 & SRV=$!
sleep 1; cd "$ROOT"
[ -f "$QG_MJ/node_modules/mathjax/tex-svg-nofont.js" ] || (mkdir -p "$QG_MJ" && cd "$QG_MJ" && npm init -y >/dev/null && npm install mathjax@4.1.3 @mathjax/mathjax-termes-font@4.1.3 --silent)
mkdir -p state/work/verify
timeout 900 node tools/render_audit.js "$@" > state/work/verify/render.json.tmp && mv state/work/verify/render.json.tmp state/work/verify/render.json
kill $SRV
python3 -c "import json;d=json.load(open('state/work/verify/render.json'));print('render audit:',d['checked'],'checked,',len(d['problems']),'problems');[print(' ',x['doc'],x['number'],x['err'][:2]) for x in d['problems']]"
