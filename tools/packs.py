#!/usr/bin/env python3
"""Grouped data packs (stage 2, 15 Nov; owner 15 Nov, via the workflow brief: "Lets do ... 4"): fewer published files.

The artifact allows 511 files per version and held 462. Redrawn-diagram packs (data/svg) and the Review overlay /
first-redraw packs (data/cmp) used to be one file per paper (57 + 15 files). They are now merged into a few GROUP files:

    data/svg/g<doc % 8>.json    {figure_key: data URI}            written by tools/build_bank.py
    data/cmp/g0.json            {"ov:<key>" | "v1:<key>": data URI}

The page picks the group from the paper id alone (page_src/js/05_figures.js, PACK_G), so no index file is needed and
a new paper lands in its group automatically. PACK_G in the page and GROUPS here MUST match (batch_check checks it).
Figure keys start with the paper id, so keys never collide inside a group (asserted on write).
The page-image packs (data/img/<doc>.json, 0.1-3 MB each) stay one per paper: Review loads them one paper at a time.

  python3 tools/packs.py            merge any per-paper files left in site/data/svg|cmp into their groups, move the
                                     per-paper originals to archive/packs_perpaper_1115/, write
                                     work/restructure/merge_map.json (old path -> new path). Idempotent.
  python3 tools/packs.py --check    exit 1 if per-paper files are left or a group is missing
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import json, os, re, shutil, sys

P = paths.P
# Job 3, 16 Nov (owner 14 Nov: "What if we dropped them and rerendered them in the new location?"): svg 8 -> 32 groups, so each
# group stays well under the asset store's 20 MiB per file at 538 papers (~11 MB each); crop = figure crops kept after a paper
# is cleared in Review (tools/image_lifecycle.py).
GROUPS = {'svg': 32, 'cmp': 1, 'crop': 8}   # must match PACK_G in page_src/js/05_figures.js
ARCH = P + 'archive/packs_perpaper_1115/'
MAP = paths.S + 'work/restructure/merge_map.json'
PER_PAPER = re.compile(r'^(\d+)\.json$')
GROUP_FILE = re.compile(r'^g(\d+)\.json$')


def group_of(kind, doc):
    return 'g%d' % (int(doc) % GROUPS[kind])


def rel(kind, name):
    return f'data/{kind}/{name}.json'


def write_groups(kind, by_doc):
    """by_doc = {doc: {key: value}} -> site/data/<kind>/g<n>.json (every group of `kind`, complete). Returns {group: n keys}."""
    d = P + f'site/data/{kind}/'
    os.makedirs(d, exist_ok=True)
    out = {('g%d' % i): {} for i in range(GROUPS[kind])}
    for doc, m in by_doc.items():
        g = out[group_of(kind, doc)]
        for k, v in m.items():
            assert k not in g, f'{kind}: key {k} appears in two papers'
            g[k] = v
    for g, m in out.items():
        json.dump(m, open(d + g + '.json', 'w'))
    return {g: len(m) for g, m in out.items()}


def leftovers(kind):
    d = P + f'site/data/{kind}/'
    return sorted(f for f in os.listdir(d) if PER_PAPER.match(f)) if os.path.isdir(d) else []


def merge(kind):
    """Fold per-paper files of `kind` into the existing groups, archive the originals. Returns {old rel: new rel}."""
    d = P + f'site/data/{kind}/'
    per = leftovers(kind)
    if not per: return {}
    by_doc = {}
    for i in range(GROUPS[kind]):   # start from what the groups already hold, split back by paper
        f = d + 'g%d.json' % i
        if os.path.exists(f):
            for k, v in json.load(open(f)).items():
                by_doc.setdefault(re.match(r'(?:ov:|v1:)?(\d+)_', k).group(1), {})[k] = v
    mapping = {}
    for f in per:
        doc = PER_PAPER.match(f).group(1)
        by_doc[doc] = json.load(open(d + f))   # the per-paper file is the newer copy of that paper
        mapping[rel(kind, doc)] = rel(kind, group_of(kind, doc))
    write_groups(kind, by_doc)
    # verify before moving anything: every per-paper key/value is in its group, byte for byte
    groups = {g: json.load(open(d + g + '.json')) for g in {group_of(kind, PER_PAPER.match(f).group(1)) for f in per}}
    for f in per:
        doc = PER_PAPER.match(f).group(1)
        m, g = json.load(open(d + f)), groups[group_of(kind, doc)]
        assert all(g.get(k) == v for k, v in m.items()), f'{kind}/{f}: not all keys made it into {group_of(kind, doc)}'
    os.makedirs(ARCH + kind, exist_ok=True)
    for f in per:
        shutil.move(d + f, ARCH + kind + '/' + f)
    return mapping


def check():
    bad = []
    for kind, n in GROUPS.items():
        if leftovers(kind): bad.append(f'{len(leftovers(kind))} per-paper files left in site/data/{kind}/ (run tools/packs.py)')
        for i in range(n):
            if not os.path.exists(P + f'site/data/{kind}/g{i}.json'): bad.append(f'missing site/data/{kind}/g{i}.json')
        if not os.path.isdir(P + f'site/data/{kind}/'): continue
        extra = [f for f in os.listdir(P + f'site/data/{kind}/') if GROUP_FILE.match(f) and int(GROUP_FILE.match(f).group(1)) >= n]
        if extra: bad.append(f'site/data/{kind}/ has group files beyond g{n - 1}: {extra} (GROUPS changed? archive them)')
    js = open(P + 'page_src/js/05_figures.js').read()
    m = re.search(r'const PACK_G=\{([^}]*)\}', js)
    pg = {k: int(v) for k, v in re.findall(r'(\w+):(\d+)', m.group(1))} if m else None
    if pg != GROUPS:
        bad.append(f'PACK_G in page_src/js/05_figures.js does not match tools/packs.py GROUPS {GROUPS}')
    return bad


if __name__ == '__main__':
    if '--check' in sys.argv:
        b = check(); [print('  ' + x) for x in b]; print('packs:', 'OK' if not b else 'PROBLEM'); sys.exit(1 if b else 0)
    mapping = {}
    for kind in GROUPS: mapping.update(merge(kind))
    if mapping:
        os.makedirs(os.path.dirname(MAP), exist_ok=True)
        old = json.load(open(MAP)) if os.path.exists(MAP) else {}
        old.update(mapping); json.dump(dict(sorted(old.items())), open(MAP, 'w'), indent=1)
    print(f'packs: merged {len(mapping)} per-paper files; groups', {k: sorted(f for f in os.listdir(P + f'site/data/{k}/')) for k in GROUPS})
