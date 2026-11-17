#!/usr/bin/env python3
"""Rebuild the Review "Before" picture (data/cmp/g0.json "v1:<key>") of a redrawn diagram from its TikZ source in git.

Owner 17 Nov: "For the fixed and back to you, the page image is gone and also we need to know what the original flag is so
the reviewer can compare". A diagram Claude redrew from a change request (reviews fig_done) opens in "Before -> now" mode,
which shows the original crop, the version the checker reviewed (v1) and the redraw now. Nothing wrote v1 for the 17 Nov
fixes, so the middle picture said "Not available". This renders the TikZ source as it was at REV (the commit before the fix)
to a PNG data URI, the same format as the older v1 entries.

  python3 tools/redraw_before.py KEY=REV ...     e.g. 369_q4_1=71ca3c1^  (REV = any git revision holding state/tikz/tex/KEY.tex)
  python3 tools/redraw_before.py --auto KEY ...  REV = the parent of the newest commit that changed KEY's source; when the
                                                 source has no earlier version, nothing is written for KEY (reported)
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import base64, json, os, subprocess, sys, tempfile

P = paths.P
PACK = P + 'site/data/cmp/g0.json'


def git(*a):
    return subprocess.run(['git', *a], cwd=P, capture_output=True, text=True)


def before_rev(key):
    c = git('log', '-1', '--format=%H', '--', f'state/tikz/tex/{key}.tex').stdout.strip()
    return c + '^' if c and git('cat-file', '-e', f'{c}^:state/tikz/tex/{key}.tex').returncode == 0 else None


def render(key, rev):
    src = git('show', f'{rev}:state/tikz/tex/{key}.tex')
    if src.returncode: return None, f'no source at {rev}'
    with tempfile.TemporaryDirectory(dir=paths.SCRATCH if os.path.isdir(paths.SCRATCH) else None) as d:
        b = os.path.join(d, 'build'); os.makedirs(b)
        for f in ('examstyle', 'tree_style'):   # each .tex does \input{../examstyle.tex}
            os.symlink(P + f'state/tikz/{f}.tex', os.path.join(d, f + '.tex'))
        open(os.path.join(b, key + '.tex'), 'w').write(src.stdout)
        r = subprocess.run(['pdflatex', '-interaction=nonstopmode', '-halt-on-error', key + '.tex'], cwd=b,
                           capture_output=True, text=True, timeout=300, env=dict(os.environ, extra_mem_bot='30000000'))
        if r.returncode: return None, 'pdflatex failed'
        subprocess.run(['pdftoppm', '-png', '-r', '150', '-singlefile', key + '.pdf', key], cwd=b, check=True, timeout=120)
        return 'data:image/png;base64,' + base64.b64encode(open(os.path.join(b, key + '.png'), 'rb').read()).decode(), 'ok'


def main():
    os.makedirs(paths.SCRATCH, exist_ok=True)
    args = [a for a in sys.argv[1:] if a != '--auto']
    jobs = [(a, before_rev(a)) for a in args] if '--auto' in sys.argv else [tuple(a.split('=', 1)) for a in args]
    pack = json.load(open(PACK)); n = 0
    for key, rev in jobs:
        if not rev: print(f'  {key}: no earlier version in git, skipped'); continue
        uri, st = render(key, rev)
        print(f'  {key} @ {rev}: {st}')
        if uri: pack['v1:' + key] = uri; n += 1
    json.dump(pack, open(PACK, 'w'), separators=(',', ':'), sort_keys=True)
    print(f'redraw_before: {n} "Before" pictures written to {PACK[len(P):]}')


if __name__ == '__main__':
    main()
