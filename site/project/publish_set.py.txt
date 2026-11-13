#!/usr/bin/env python3
"""Print the files to send with the next publish of the review page, and check them against the artifact limits.

Reviewer, 14 Nov (hardening). batch_check.py's "changed since the last publish" warning covers review.html, site/data/
and site/vendor/ only; this also covers site/project/ (the published resume copy: specs, tools as .txt, page_src/).

  python3 tools/publish_set.py            summary + the publish `files` map as JSON (paths relative to /home/claude/pilot)
  python3 tools/publish_set.py --all      every publishable file, not only the changed ones
  python3 tools/publish_set.py --json     only the JSON map (for the publish call)

Changed = sha256 differs from work/published_manifest.json (written by `batch_check.py --mark-published`). Files under
project/ that the manifest does not list yet (manifests before 14 Nov did not record project/) count as changed when
modified after the manifest's time. review.html is the page itself (file_path), so it is not in the `files` map.
Paths in REMOVE are files that were published under project/ before the 14 Nov page_src/ split and now live in
archive/pre_src_1114/: pass them as null to drop them from the artifact (only if the live artifact still has them).
Limits per publish: 255 files, 64 MB. Per version: 511 files, 256 MB.
"""
import glob, hashlib, json, os, sys, time

P = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + '/'
S = P + 'site/'
MAN = P + 'work/published_manifest.json'
REMOVE = [f'project/{n}' for n in (
    'exam.js.txt exam_auto.css.txt exam_auto.js.txt exams.css.txt exams.js.txt guide2.css.txt guide2.js.txt levels.js.txt '
    'mine.css.txt mine.js.txt pdf.js.txt reports.css.txt reports.js.txt schema.js.txt theme2.css.txt word.js.txt '
    'patch_exam_auto.py.txt patch_exams.py.txt patch_reports.py.txt patch_theme2.py.txt').split()]


def sha(p):
    if p.endswith('data/bank.json'):   # same rule as batch_check.py: ignore the build timestamp
        d = json.load(open(p)); d.pop('built', None); return hashlib.sha256(json.dumps(d, sort_keys=True).encode()).hexdigest()
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()


def publishable():
    fs = [S + 'review.html'] + glob.glob(S + 'data/**/*.json', recursive=True)
    fs += [f for f in glob.glob(S + 'vendor/**/*', recursive=True) if os.path.isfile(f)]
    fs += [f for f in glob.glob(S + 'project/**/*', recursive=True) if os.path.isfile(f)]
    return sorted(os.path.relpath(f, S) for f in fs)


def main():
    allf = '--all' in sys.argv
    man = json.load(open(MAN)) if os.path.exists(MAN) else {'at': '1970-01-01 00:00', 'files': {}}
    t0 = time.mktime(time.strptime(man['at'], '%Y-%m-%d %H:%M'))
    out = []
    for rel in publishable():
        f = S + rel
        if allf: out.append(rel); continue
        old = man['files'].get(rel)
        if old is not None: changed = old != sha(f)
        elif rel.startswith('project/'): changed = os.path.getmtime(f) > t0
        else: changed = True
        if changed: out.append(rel)
    files = {r: 'site/' + r for r in out if r != 'review.html'}
    removes = [r for r in REMOVE if not os.path.exists(S + r)]
    n = len(files) + ('review.html' in out)
    size = sum(os.path.getsize(S + r) for r in out)
    if '--json' in sys.argv:
        print(json.dumps(files, indent=0)); return
    groups = {}
    for r in out: groups.setdefault(r.split('/')[0] if '/' in r else r, []).append(r)
    print(f'publish set vs {os.path.relpath(MAN, P)} ({man["at"]}){" [--all]" if allf else ""}:')
    for g, rs in sorted(groups.items()):
        print(f'  {g:12s} {len(rs):4d} files {sum(os.path.getsize(S + r) for r in rs):>12,} bytes')
    print(f'  total        {n:4d} files {size:>12,} bytes   (limit per publish: 255 files, 64 MB)  '
          + ('OK' if n <= 255 and size <= 64 * 2**20 else 'OVER LIMIT: split into several publishes to the same url'))
    print(f'  page: file_path site/review.html{" (changed)" if "review.html" in out else " (unchanged)"}; '
          f'optional nulls for {len(removes)} archived project files: ' + ', '.join(removes[:3]) + (' ...' if len(removes) > 3 else ''))
    print('files map (paths relative to /home/claude/pilot):')
    print(json.dumps(files, indent=0))


if __name__ == '__main__':
    main()
