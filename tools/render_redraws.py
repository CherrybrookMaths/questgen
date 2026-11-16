#!/usr/bin/env python3
"""Render every redrawn diagram (status ok / approx in state/tikz/all_results.json) from its TikZ source, in parallel.

Job 3 (owner 14 Nov: "What if we dropped them and rerendered them in the new location?"): the images are re-rendered from
their sources, not copied. A fresh clone has no tikz/ build outputs, and tools/build_bank.py builds the redraw packs from
tikz/svg/, so this also restores the ability to rebuild the bank in a cloud session.

Same steps as tools/tikz_render.sh (pdflatex -> pdftocairo -svg -> svg_compact.py -> 200 dpi PNG), without its side-by-side
comparison picture, which needs the figure crop originals (figures/, a Drive backup; CLAUDE.md "Figure crop originals").

  python3 tools/render_redraws.py            render every ok/approx redraw whose SVG is missing (tikz/svg, tikz/build, tikz/png)
  python3 tools/render_redraws.py --all      render all of them again
  python3 tools/render_redraws.py ID ...     render these
Writes work/render/render_redraws.json: {id: "ok" | "error: <first TeX error>"}.
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import json, os, shutil, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

P = paths.P
ST = P + 'state/tikz/'
T = P + 'tikz/'
OUT = P + 'work/render/render_redraws.json'


def todo():
    res = json.load(open(ST + 'all_results.json'))
    return [r['id'] for r in res if r['status'] in ('ok', 'approx') and os.path.exists(ST + 'tex/%s.tex' % r['id'])]


def render(i):
    b = T + 'build/'
    shutil.copy(ST + 'tex/%s.tex' % i, b + i + '.tex')
    env = dict(os.environ, extra_mem_bot='30000000')
    r = subprocess.run(['pdflatex', '-interaction=nonstopmode', '-halt-on-error', i + '.tex'], cwd=b, env=env,
                       capture_output=True, text=True, timeout=300)
    if r.returncode or not os.path.exists(b + i + '.pdf'):
        log = open(b + i + '.log', errors='replace').read() if os.path.exists(b + i + '.log') else r.stdout
        err = next((l for l in log.splitlines() if l.startswith('!')), 'pdflatex failed')
        return i, 'error: ' + err[:200]
    subprocess.run(['pdftocairo', '-svg', b + i + '.pdf', T + 'svg/%s.svg' % i], check=True, timeout=120)
    subprocess.run([sys.executable, P + 'tools/svg_compact.py', T + 'svg/%s.svg' % i], check=True, timeout=120)
    subprocess.run(['pdftoppm', '-png', '-r', '200', '-singlefile', b + i + '.pdf', T + 'png/' + i], check=True, timeout=120)
    return i, 'ok'


def main():
    for d in ('build', 'svg', 'png', 'cmp'): os.makedirs(T + d, exist_ok=True)
    for f in ('examstyle', 'tree_style'):   # every .tex does \input{../examstyle.tex} relative to tikz/build
        if not os.path.exists(T + f + '.tex'): os.symlink(ST + f + '.tex', T + f + '.tex')
    ids = [a for a in sys.argv[1:] if not a.startswith('--')] or todo()
    if '--all' not in sys.argv and not sys.argv[1:]: ids = [i for i in ids if not os.path.exists(T + 'svg/%s.svg' % i)]
    t0 = time.time(); out = json.load(open(OUT)) if os.path.exists(OUT) else {}
    with ThreadPoolExecutor(max(1, (os.cpu_count() or 2))) as ex:
        for n, (i, st) in enumerate(ex.map(render, ids), 1):
            out[i] = st
            if n % 100 == 0: print(f'  {n}/{len(ids)} in {time.time() - t0:.0f} s', flush=True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True); json.dump(out, open(OUT, 'w'), indent=0, sort_keys=True)
    bad = {i: s for i, s in out.items() if s != 'ok' and i in ids}
    print(f'render_redraws: {len(ids) - len(bad)} of {len(ids)} rendered in {time.time() - t0:.0f} s' + (f'; {len(bad)} failed:' if bad else ''))
    for i, s in list(bad.items())[:20]: print(' ', i, s)
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
