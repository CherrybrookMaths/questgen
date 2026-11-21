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
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import glob, hashlib, json, os, sys, time

P = paths.P
S = P + 'site/'
# Job 3, 16 Nov (CLAUDE.md: "What is permanent: redrawn diagrams ... plus figure crops only where a diagram has no approved
# redraw. Page scans and comparison overlays exist only while a paper is in review"): only the permanent packs go to the asset
# store; per-paper scan packs (data/img), overlays (data/cmp) and Needs a check pictures stay published files while they exist.
KINDS = ('data/svg/*.json', 'data/crop/*.json')
MAN = S + 'data/assets.json'
OUT = P + 'work/assets/upload_plan.json'
MAX_FILE = 20 * 2**20   # assets.d.ts: 20 MiB for JSON (and every type but SVG 2 MiB and CSS/JS 16 MiB)
TARGET_PAPERS = 538     # the import target in the plan


from asset_manifest import sha256   # one copy (health pass 21 Nov)


def candidates():
    return sorted(os.path.relpath(f, S) for k in KINDS for f in glob.glob(S + k))


def main():
    man = json.load(open(MAN)).get('assets', {}) if os.path.exists(MAN) else {}
    rows, skip = [], []
    for rel in candidates():
        f = S + rel; n = os.path.getsize(f); h = sha256(f)
        if '--all' not in sys.argv and (man.get(rel) or {}).get('sha256') == h: skip.append(rel); continue
        rows.append({'path': rel, 'local': 'site/' + rel, 'bytes': n, 'sha256': h, 'content_type': 'application/json', 'over_limit': n > MAX_FILE})
    # 18 Nov (owner: "go and fix it."): never plan an upload that would blank or gut a live pack. A pack the asset store holds must be
    # here, not empty, and at least half its uploaded size (a big drop means it was rebuilt without its sources: the 17 Nov night
    # run wrote empty packs). A real shrink (many crops dropped at once) passes with --allow-shrink, after a look.
    refuse = [f'{k} is in the asset store but missing here' for k in man if not os.path.exists(S + k)]
    for r in rows:
        old = (man.get(r['path']) or {}).get('bytes') or 0
        if not json.load(open(S + r['path'])): refuse.append(f'{r["path"]} is empty')
        elif old and r['bytes'] < old / 2 and '--allow-shrink' not in sys.argv: refuse.append(f'{r["path"]} shrank from {old} to {r["bytes"]} bytes')
    if refuse:
        if os.path.exists(OUT): os.remove(OUT)   # no stale plan left to upload from
        print('asset upload plan REFUSED, no plan written: ' + '; '.join(refuse[:8])
              + '. Fetch the packs (python3 tools/fetch_published.py) and rebuild; --allow-shrink only for a shrink you have checked.')
        sys.exit(2)
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
    # job 3: group files do not multiply with papers, they grow: project bytes per imported paper, and the largest group
    nb = len(json.load(open(P + 'site/data/bank.json'))['docs']) if os.path.exists(P + 'site/data/bank.json') else 1
    g = TARGET_PAPERS / max(nb, 1)
    print(f'  projection at {TARGET_PAPERS} papers (today {nb}): about {allb * g / 2**20:.0f} MB in {len(candidates())} group files '
          f'(asset store 1 GB); largest group about {(big["bytes"] if big else 0) * g / 2**20:.1f} MB of the 20 MiB per-file limit')
    print(f'plan written to {os.path.relpath(OUT, P)}; one Artifact call per file (asset: true, file_path = "local"), results '
          f'into work/assets/upload_results.json, then python3 tools/asset_manifest.py')
    sys.exit(1 if over else 0)


if __name__ == '__main__':
    main()
