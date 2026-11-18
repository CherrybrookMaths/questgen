#!/usr/bin/env python3
"""Print the files to send with the next publish of the review page, and check them against the artifact limits.

Reviewer, 14 Nov (hardening). batch_check.py's "changed since the last publish" warning covers review.html, site/data/
and site/vendor/ only; this also covers site/project/ (the published resume copy: specs, tools as .txt, page_src/).

  python3 tools/publish_set.py            summary + the publish `files` map as JSON (paths relative to the repo root)
  python3 tools/publish_set.py --all      every publishable file, not only the changed ones
  python3 tools/publish_set.py --json     only the JSON map (for the publish call)

Changed = sha256 differs from work/published_manifest.json (written by `batch_check.py --mark-published`). Files under
project/ that the manifest does not list yet (manifests before 14 Nov did not record project/) count as changed when
modified after the manifest's time. review.html is the page itself (file_path), so it is not in the `files` map.
Limits per publish: 255 files, 64 MB. Per version: 511 files, 256 MB.

Removals (stage 2, 15 Nov): a path the manifest records as published that no longer exists locally (archived, merged
into a group pack, or excluded below) is sent as null, so the publish deletes it from the artifact. The --json map
includes those nulls; pass it as `files` unchanged. After the publish, `batch_check.py --mark-published` records only
the files that exist, so the nulls appear once. Paths under EXCLUDE are never published (data/focus/: unused since the
owner's 12 Nov rollback of the cropped Check view; data/bank_v1_before_split.json: unused, health pass 13 Nov).

Asset store (Fix 1, 14 Nov): image packs listed in site/data/assets.json at their current sha256 are served from the artifact's
asset store and left out of the publish set (tools/asset_upload_plan.py, tools/asset_manifest.py). The split bank
(data/bank/<course>/index.json + one file per topic, tools/bank_split.py) is published like any data file; data/bank.json is
still built locally but no longer published (job 4, 16 Nov), nor is project/ apart from open_decisions.json.
  python3 tools/publish_set.py --json --live FILE   also null every path the live page holds outside the publish set
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import base64, glob, gzip, hashlib, json, os, sys, time

P = paths.P
S = P + 'site/'
MAN = paths.S + 'work/published_manifest.json'
# never publish these, even if a tool writes them again. data/focus/: stage 2, 15 Nov. data/bank_v1_before_split.json: health
# pass 13 Nov (a pre-split snapshot nothing reads; archived in archive/data_unused_1113/, sent once as null to delete it)
# data/bank_v1.json: 14 Nov, tracked in git at state/site/data/bank_v1.json (a build input the page never reads; the live
# artifact does not hold it, so it was dropped from the manifest instead of being sent as null)
# Job 4 (first jobs in CLAUDE.md, owner agreed 14 Nov: "Remove published files the page no longer uses"): data/bank.json (the
# page reads the split bank since Fix 1; build tools read the local copy) and project/ (specs and tools are on GitHub; the
# local site/project/ stays, tools read their inputs there). The page still reads project/open_decisions.json (08_review.js).
EXCLUDE = ('data/focus/', 'data/bank_v1_before_split.json', 'data/bank_v1.json', 'data/bank.json')
PROJECT_KEEP = ('project/open_decisions.json',)


def sha(p):
    """The digest the manifest records. The ONE copy (batch_check.py and fetch_published.py call this one; CODE_HEALTH rule 3).
    bank.json and the bank index ignore their build timestamp: only content changes need a publish (Fix 1). Job 2, 16 Nov: the
    index and the details file are gzip as base64 text {v, gz} (tools/bank_split.py): digest the unpacked content."""
    p = str(p)
    if p.endswith('data/bank.json') or ('data/bank/' in p and p.endswith(('/index.json', '/index.gz.json', '/details.gz.json'))):
        d = json.load(open(p))
        if isinstance(d.get('gz'), str): d = json.loads(gzip.decompress(base64.b64decode(d['gz'])))
        d.pop('built', None); return hashlib.sha256(json.dumps(d, sort_keys=True).encode()).hexdigest()
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()


def publishable():
    fs = [S + 'review.html'] + glob.glob(S + 'data/**/*.json', recursive=True)
    fs += [f for f in glob.glob(S + 'vendor/**/*', recursive=True) if os.path.isfile(f)]
    fs += [f for f in glob.glob(S + 'project/**/*', recursive=True) if os.path.isfile(f)]
    # Fix 1 (owner 14 Nov: "Ok we should run Fix 1 and 2"): an image pack the asset store serves at its current sha256
    # (site/data/assets.json, tools/asset_manifest.py) is no longer published; removals() then sends null for it once
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import asset_manifest
    instore = asset_manifest.fresh_paths()
    import import_hold   # owner 18 Nov: papers mid-import stay off the page (tools/import_hold.py): their scan packs wait for the release
    held = tuple(f'data/img/{d}.json' for d in import_hold.held_docs())
    return sorted(r for r in (os.path.relpath(f, S) for f in fs) if not r.startswith(EXCLUDE) and r not in held and r not in instore
                  and (not r.startswith('project/') or r in PROJECT_KEEP))


def arg(flag):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv and sys.argv.index(flag) + 1 < len(sys.argv) else None


def removals(man, live=()):
    """Paths the last publish sent that are gone from the publish set now: send them as null to delete them. With --live FILE
    (one published path per line, from an Artifact `list` with scope "files"), also every path the live page holds that is
    not in the publish set: the manifest and the live page had drifted apart (CLAUDE.md "Publish manifest vs live")."""
    cur = set(publishable())
    return sorted({r for r in list(man['files']) + list(live) if r not in cur and r not in ('review.html', 'index.html')})


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
    live = [l.strip() for l in open(arg('--live'))] if arg('--live') else []
    nulls = removals(man, [l for l in live if l])
    files.update({r: None for r in nulls})
    n = len(files) + ('review.html' in out)
    size = sum(os.path.getsize(S + r) for r in out)
    if '--json' in sys.argv:
        print(json.dumps(files, indent=0)); return
    groups = {}
    for r in out: groups.setdefault(r.split('/')[0] if '/' in r else r, []).append(r)
    print(f'publish set vs {os.path.relpath(MAN, P)} ({man["at"]}){" [--all]" if allf else ""}:')
    for g, rs in sorted(groups.items()):
        print(f'  {g:12s} {len(rs):4d} files {sum(os.path.getsize(S + r) for r in rs):>12,} bytes')
    if nulls:
        ng = {}
        for r in nulls: ng.setdefault('/'.join(r.split('/')[:2]), 0); ng['/'.join(r.split('/')[:2])] += 1
        print(f'  remove       {len(nulls):4d} paths (null in the files map): ' + ', '.join(f'{k} {v}' for k, v in sorted(ng.items())))
    cur = publishable()
    print(f'  after this publish the artifact holds {len(cur)} files, {sum(os.path.getsize(S + r) for r in cur) / 2**20:.1f} MB (limit per version: 511 files, 256 MB)')
    print(f'  total        {n:4d} files {size:>12,} bytes   (limit per publish: 255 files, 64 MB)  '
          + ('OK' if n <= 255 and size <= 64 * 2**20 else 'OVER LIMIT: split into several publishes to the same url'))
    print(f'  page: file_path site/review.html{" (changed)" if "review.html" in out else " (unchanged)"}')
    print('files map (paths relative to the repo root):')
    print(json.dumps(files, indent=0))


if __name__ == '__main__':
    main()
