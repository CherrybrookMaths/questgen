#!/bin/bash
# Render audit with its own short-lived web server (background servers do not survive between turns).
cd /home/claude/pilot/site && python3 -m http.server 8765 >/dev/null 2>&1 & SRV=$!
sleep 1; cd /home/claude/pilot
[ -f /tmp/claude-0/mj/node_modules/mathjax/tex-svg-nofont.js ] || (mkdir -p /tmp/claude-0/mj && cd /tmp/claude-0/mj && npm init -y >/dev/null && npm install mathjax@4.1.3 @mathjax/mathjax-termes-font@4.1.3 --silent)
timeout 900 node tools/render_audit.js "$@" > work/verify/render.json.tmp && mv work/verify/render.json.tmp work/verify/render.json
kill $SRV
python3 -c "import json;d=json.load(open('work/verify/render.json'));print('render audit:',d['checked'],'checked,',len(d['problems']),'problems');[print(' ',x['doc'],x['number'],x['err'][:2]) for x in d['problems']]"
