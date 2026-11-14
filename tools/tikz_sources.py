"""site/project/tikz_sources.json (published under project/) = every diagram source + both style files, rebuilt from state/tikz.

The tracked source of truth is state/tikz/ (tex/<id>.tex, examstyle.tex, tree_style.tex). The JSON is the published copy, so a
session with only the artifact can still rebuild the diagrams. Until 14 Nov it was only patched body by body (apply_diagrams.py)
and went stale: `_examstyle` was the 0.4pt v3 style (the owner chose 0.6pt on 12 Nov: "0.6 would be best"; DIAGRAM_SPEC rule 3),
tree_style.tex (24 tree diagrams \\input it) was missing, and 373_q25_s1 was the pre-fix version. Now it is regenerated whole.
site/project/examstyle.tex.txt (also published) is refreshed with it.

  python3 tools/tikz_sources.py           rewrite site/project/tikz_sources.json + examstyle.tex.txt from state/tikz
  python3 tools/tikz_sources.py --check   exit 1 and list what differs (batch_check.py blocks on it)
  python3 tools/tikz_sources.py --unpack DIR   write DIR/tex/<id>.tex + DIR/examstyle.tex + DIR/tree_style.tex from the JSON
                                          (recovery only: state/tikz in git is the normal source)
Keys: one per figure id (the full .tex file), plus `_examstyle` and `_tree_style`.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)

JSON = paths.ROOT / 'site/project/tikz_sources.json'
STYLE_TXT = paths.ROOT / 'site/project/examstyle.tex.txt'
TIKZ = paths.STATE / 'tikz'
STYLES = {'_examstyle': 'examstyle.tex', '_tree_style': 'tree_style.tex'}


def build():
    d = {f[:-4]: open(TIKZ / 'tex' / f).read() for f in sorted(os.listdir(TIKZ / 'tex')) if f.endswith('.tex')}
    for k, f in STYLES.items(): d[k] = open(TIKZ / f).read()
    return d


def check():
    want = build()
    have = json.load(open(JSON)) if JSON.exists() else {}
    bad = sorted(k for k in set(want) | set(have) if want.get(k) != have.get(k))
    if not STYLE_TXT.exists() or open(STYLE_TXT).read() != want['_examstyle']: bad.append('examstyle.tex.txt')
    return bad


if __name__ == '__main__':
    if '--check' in sys.argv:
        bad = check()
        print(f'tikz_sources: {len(bad)} entr{"y" if len(bad) == 1 else "ies"} differ from state/tikz' + (': ' + ', '.join(bad[:10]) if bad else ''))
        sys.exit(1 if bad else 0)
    if '--unpack' in sys.argv:
        out = sys.argv[sys.argv.index('--unpack') + 1]; d = json.load(open(JSON)); os.makedirs(os.path.join(out, 'tex'), exist_ok=True)
        for k, v in d.items():
            open(os.path.join(out, STYLES[k]) if k in STYLES else os.path.join(out, 'tex', k + '.tex'), 'w').write(v)
        print('unpacked', len(d), 'files to', out); sys.exit(0)
    d = build()
    old = json.load(open(JSON)) if JSON.exists() else {}
    changed = sorted(k for k in set(d) | set(old) if d.get(k) != old.get(k))
    json.dump(d, open(JSON, 'w'))
    open(STYLE_TXT, 'w').write(d['_examstyle'])
    print(f'tikz_sources.json: {len(d) - len(STYLES)} figures + {len(STYLES)} styles; {len(changed)} entries changed' + (': ' + ', '.join(changed[:10]) if changed else ''))
