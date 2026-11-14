#!/usr/bin/env python3
"""Turn the asset-store upload results into site/data/assets.json, the small manifest the page reads at start.

Fix 1 (owner 14 Nov: "Ok we should run Fix 1 and 2"; plan: keep the published page small; fetch data only when needed).
tools/asset_upload_plan.py lists what to upload; the main session uploads each file with the Artifact tool (asset: true) and
saves the results; this writes the manifest. The page (QG.url, page_src/js/01_core.js) fetches a pack from its "url" when the
manifest has the path, else from the published file. tools/publish_set.py stops publishing a path once the manifest holds it at
the file's current sha256 (and sends null once, so the artifact drops the old copy).

  python3 tools/asset_manifest.py [results.json]   merge results (default work/assets/upload_results.json) into the manifest
  python3 tools/asset_manifest.py --init           write an empty manifest if there is none (the page always finds the file)
  python3 tools/asset_manifest.py --check          exit 1 when an entry is stale (the local file changed after its upload)
  python3 tools/asset_manifest.py --prune          drop stale entries, so the page falls back to the published file

Results file: a JSON list of {"path": "data/img/1308.json", "url": "/_blob/<id>", "id": "<id>", "sizeBytes": n}, or a map
{path: url}. The sha256 recorded is the one in work/assets/upload_plan.json for that path (what was uploaded); an entry whose
local file no longer has that sha256 is refused (re-plan and re-upload it).
Manifest: {"v": 1, "made": ..., "assets": {path: {"url", "sha256", "bytes"}}}.
"""
import hashlib, json, os, re, sys, time

P = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + '/'
S = P + 'site/'
MAN = S + 'data/assets.json'
PLAN = P + 'work/assets/upload_plan.json'
RES = P + 'work/assets/upload_results.json'


def sha256(f):
    h = hashlib.sha256()
    with open(f, 'rb') as fh:
        for b in iter(lambda: fh.read(1 << 20), b''): h.update(b)
    return h.hexdigest()


def load():
    return json.load(open(MAN)) if os.path.exists(MAN) else {'v': 1, 'assets': {}}


def write(m):
    m['v'] = 1; m['made'] = time.strftime('%Y-%m-%d %H:%M')
    m['assets'] = dict(sorted(m['assets'].items()))
    open(MAN, 'w').write(json.dumps(m, separators=(',', ':')) + '\n')


def stale(m):
    """[(path, why)] for entries the page must not use: the local file changed since the upload, or it is gone."""
    out = []
    for p, a in m['assets'].items():
        f = S + p
        if not os.path.exists(f): out.append((p, 'no local file'))
        elif sha256(f) != a.get('sha256'): out.append((p, 'local file changed after the upload: re-upload it'))
    return out


def fresh_paths():
    """Published paths the asset store serves at the file's current sha256 (publish_set.py leaves these out)."""
    if not os.path.exists(MAN): return set()
    m = load(); bad = {p for p, _ in stale(m)}
    return {p for p in m['assets'] if p not in bad}


def main():
    a = sys.argv[1:]
    if '--init' in a:
        if not os.path.exists(MAN): write({'assets': {}}); print('wrote an empty', os.path.relpath(MAN, P))
        else: print(os.path.relpath(MAN, P), 'exists:', len(load()['assets']), 'entries')
        return
    m = load()
    if '--check' in a or '--prune' in a:
        st = stale(m)
        for p, why in st: print(f'  STALE {p}: {why}')
        if '--prune' in a and st:
            for p, _ in st: m['assets'].pop(p)
            write(m); print(f'pruned {len(st)} stale entries; the page reads those from the published files again')
            return
        print(f'asset manifest: {len(m["assets"])} entries, {len(st)} stale')
        sys.exit(1 if st else 0)
    src = a[0] if a else RES
    res = json.load(open(src))
    if isinstance(res, dict): res = [{'path': k, 'url': v} for k, v in res.items()]
    plan = {r['path']: r for r in json.load(open(PLAN))['files']} if os.path.exists(PLAN) else {}
    added, bad = 0, []
    for r in res:
        p, u = r.get('path'), r.get('url') or (('/_blob/' + r['id']) if r.get('id') else None)
        if not p or not u: bad.append((p, 'no path or url')); continue
        if not (re.fullmatch(r'/_blob/[0-9a-f]{32}', u) or u.startswith('https://')): bad.append((p, f'unexpected url {u}')); continue
        f = S + p
        if not os.path.exists(f): bad.append((p, 'no local file')); continue
        h, n = sha256(f), os.path.getsize(f)
        want = (plan.get(p) or {}).get('sha256', h)
        if h != want: bad.append((p, 'local file changed since the plan: re-plan and re-upload')); continue
        if r.get('sizeBytes') not in (None, n): bad.append((p, f'uploaded {r["sizeBytes"]} bytes, local file is {n}')); continue
        m['assets'][p] = {'url': u, 'sha256': h, 'bytes': n}; added += 1
    write(m)
    for p, why in bad: print(f'  REFUSED {p}: {why}')
    print(f'asset manifest: {added} entries added or updated, {len(bad)} refused, {len(m["assets"])} in {os.path.relpath(MAN, P)}')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
