#!/usr/bin/env python3
"""List exactly which local image files to upload to the review page's asset store, with path, size and sha256.

Fix 1 of "Questgen architecture plan: before imports resume" (owner 14 Nov: "Ok we should run Fix 1 and 2"): keep the published
page small; fetch data only when needed. Page images and figure crops (data/img/<paper>.json), redrawn diagrams
(data/svg/g<n>.json) and Review's overlays (data/cmp/g<n>.json) move out of the published files into the artifact's asset store.
The page reads each one from the address in data/assets.json, and from the published file when there is none (QG.url in
page_src/js/01_core.js), so it works before, during and after the upload.

  python3 tools/asset_upload_plan.py          print the plan and write work/assets/upload_plan.json
  python3 tools/asset_upload_plan.py --all    plan every pack, even ones data/assets.json already holds at the same sha256

Who uploads: the main session, with the Artifact tool: action publish, url = the review page, asset: true, file_path = the
"local" path below. The tool takes a JSON file only in a call of its own (file_paths batches of 25 are for images, fonts,
CSS/JS). Save every result as one entry {"path": <published path>, "id": ..., "url": ..., "sizeBytes": ...} in
work/assets/upload_results.json (a JSON list), then run tools/asset_manifest.py. The page must declare the capability
{"assets": {}} (with db, user, downloads, mcp as now) when it is published with data/assets.json entries.

Limits (artifact-capabilities skill, runtime contract 0.2.96, assets.d.ts): per file 20 MiB (JSON and other types), 2 MiB for
SVG, 16 MiB for CSS/JS; accepted JSON type is exactly application/json, valid UTF-8. The per-artifact byte quota and file count
are NOT published in the contract: they are runtime values (usage.maxBytes, usage.maxFiles from assets.list()). This tool
flags any file over 20 MiB; it cannot check the total.
"""
import glob, hashlib, json, os, sys, time

P = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + '/'
S = P + 'site/'
KINDS = ('data/img/*.json', 'data/svg/*.json', 'data/cmp/*.json',   # the image packs the page fetches (05_figures.js pack/svgs/cmps)
         'data/check/*.json')   # owner 14 Nov: Needs a check page pictures (tools/check_pages.py; 35_papers_check.js)
MAN = S + 'data/assets.json'
OUT = P + 'work/assets/upload_plan.json'
MAX_FILE = 20 * 2**20   # assets.d.ts: 20 MiB for JSON (and every type but SVG 2 MiB and CSS/JS 16 MiB)
TARGET_PAPERS = 538     # the import target in the plan


def sha256(f):
    h = hashlib.sha256()
    with open(f, 'rb') as fh:
        for b in iter(lambda: fh.read(1 << 20), b''): h.update(b)
    return h.hexdigest()


def candidates():
    return sorted(os.path.relpath(f, S) for k in KINDS for f in glob.glob(S + k))


def main():
    man = json.load(open(MAN)).get('assets', {}) if os.path.exists(MAN) else {}
    rows, skip = [], []
    for rel in candidates():
        f = S + rel; n = os.path.getsize(f); h = sha256(f)
        if '--all' not in sys.argv and (man.get(rel) or {}).get('sha256') == h: skip.append(rel); continue
        rows.append({'path': rel, 'local': 'site/' + rel, 'bytes': n, 'sha256': h, 'content_type': 'application/json', 'over_limit': n > MAX_FILE})
    tot = sum(r['bytes'] for r in rows)
    papers = len(glob.glob(S + 'data/img/*.json')) or 1
    allb = sum(os.path.getsize(S + r) for r in candidates())
    plan = {'made': time.strftime('%Y-%m-%d %H:%M'), 'limits': {'per_file_bytes': MAX_FILE, 'content_type': 'application/json',
            'quota': 'not in the contract: read usage.maxBytes / maxFiles at runtime'},
            'count': len(rows), 'bytes': tot, 'already_uploaded': len(skip), 'files': rows}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(plan, open(OUT, 'w'), indent=1)
    by = {}
    for r in rows: k = r['path'].split('/')[1]; by.setdefault(k, [0, 0]); by[k][0] += 1; by[k][1] += r['bytes']
    print(f'asset upload plan ({plan["made"]}): {len(rows)} files, {tot / 2**20:.1f} MB to upload; {len(skip)} already in data/assets.json at the same sha256')
    for k, (c, b) in sorted(by.items()): print(f'  data/{k:4s} {c:4d} files {b / 2**20:8.1f} MB')
    over = [r for r in rows if r['over_limit']]
    for r in over: print(f'  OVER the 20 MiB per-file limit: {r["path"]} {r["bytes"] / 2**20:.1f} MB (split it: more groups in tools/packs.py)')
    big = max(rows, key=lambda r: r['bytes']) if rows else None
    if big: print(f'  largest: {big["path"]} {big["bytes"] / 2**20:.1f} MB of the 20 MiB limit')
    print(f'  projection at {TARGET_PAPERS} papers: about {allb / papers * TARGET_PAPERS / 2**30:.2f} GB in about '
          f'{int(len(candidates()) / papers * TARGET_PAPERS)} files at today\'s {papers} papers (svg/cmp groups grow per group: '
          f'keep each under 20 MiB)')
    print(f'plan written to {os.path.relpath(OUT, P)}; one Artifact call per file (asset: true, file_path = "local"), results '
          f'into work/assets/upload_results.json, then python3 tools/asset_manifest.py')
    sys.exit(1 if over else 0)


if __name__ == '__main__':
    main()
