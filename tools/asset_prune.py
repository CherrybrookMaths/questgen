#!/usr/bin/env python3
"""List the review page's asset-store blobs nothing references any more, i.e. safe to delete.

Owner 25 Nov: "fix the image store issue as well". The asset store (1 GB) had filled to 1,045,753,171 bytes in 402 files: every
re-upload of a changed pack (tools/asset_upload_plan.py -> upload -> tools/asset_manifest.py) left the old blob behind, while the
page reads only the ~40 named in data/assets.json. 362 old copies were deleted on 25 Nov (169 MB left). Since then
asset_manifest.py prints "superseded: <id>" for each pack it repoints; delete those after the publish that carries the new
manifest (until then the live page still reads the old blob). This tool catches anything missed.

  python3 tools/asset_prune.py LISTING [--manifest FILE ...]

LISTING: the JSON written from an Artifact `list` (scope "assets") of the review page, {"assets": [{"id", "bytes", ...}]} or a
plain list, or the listing's text pasted into a file (lines "- /_blob/<id>  <type>  <n> bytes ..."). Every page of the listing
(follow `after`) must be in it, or the totals undercount.
Keep set: every "/_blob/<id>" in site/data/assets.json, plus each --manifest (e.g. the live data/assets.json read with the
Artifact tool, when this checkout's copy may differ from the live page). Prints one deletable id per line (Artifact `delete`,
`path` = the id, one call each), then a summary on stderr. Exit 1 when a kept id is missing from the listing (the page would
fail to load that pack: re-upload it, do not delete anything until that is understood).
"""
# owner 25 Nov: "fix the image store issue as well"
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import json, re, sys

MAN = paths.P + 'site/data/assets.json'
BLOB = re.compile(r'/_blob/([0-9a-f]{32})')
LINE = re.compile(r'/_blob/([0-9a-f]{32})\s+\S+\s+(\d+) bytes')


def kept(files):
    """Blob ids the given manifests reference."""
    out = set()
    for f in files:
        out |= set(BLOB.findall(open(f).read()))
    return out


def listing(f):
    """[(id, bytes)] from a saved listing: JSON (dict with "assets", or a list) or pasted Artifact list text."""
    txt = open(f).read()
    try:
        d = json.loads(txt)
    except ValueError:
        return [(i, int(n)) for i, n in LINE.findall(txt)]
    rows = d.get('assets', []) if isinstance(d, dict) else d
    return [(r['id'], int(r.get('bytes') or r.get('sizeBytes') or 0)) for r in rows]


def main():
    a = sys.argv[1:]
    if not a or a[0].startswith('-'): sys.exit(__doc__)
    mans = [MAN] + [a[i + 1] for i, x in enumerate(a) if x == '--manifest']
    keep, rows = kept(mans), listing(a[0])
    ids = {i for i, _ in rows}
    drop = [(i, n) for i, n in rows if i not in keep]
    for i, _ in drop: print(i)
    missing = sorted(keep - ids)
    total = sum(n for _, n in rows)
    print(f'{len(rows)} assets, {total:,} bytes; keep {len(keep)}; deletable {len(drop)} ({sum(n for _, n in drop):,} bytes)',
          file=sys.stderr)
    for i in missing: print(f'  MISSING kept blob {i}: the page cannot load it', file=sys.stderr)
    sys.exit(1 if missing else 0)


if __name__ == '__main__':
    main()
