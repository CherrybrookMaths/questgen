#!/usr/bin/env python3
"""Fixed import batches, one lane per course + year level (owner 14 Nov, mockup A: "I like A's design much more"; Processes ›
Papers shows each lane as a row of squares, one square per batch of 9).

  python3 tools/batches.py            assign new ready papers, write work/batches.json, print the lanes (tools/inventory.py
                                      calls lanes() too and writes them into site/data/inventory.json as "lanes")
  python3 tools/batches.py --print    print only, write nothing

Each ready paper (inventory status ready_current / ready_old) of a lane is put in a numbered batch of 9 ONCE and keeps it:
  - Year 12 Advanced: batches 1-5 are the finished import batches b1-b5 (site/data/progress.json). Batch 6 onward start with the
    owner's import order (db importq: the planned batches b6-b20, 132 papers; the page_importq mirror if it has rows, else
    work/importq_seed.json), in that order, then every other ready paper: current syllabus first, newest year first, then old
    syllabus (newest first).
  - any other lane (once its course is set up): batch 1 onward, the same order.
  - papers a later scan finds start NEW batches after the last one; numbering never reshuffles. A batch can end short (the last
    one of an assignment). A paper that stops being ready (imported, or a rule / owner answer moves it) simply drops out of its
    batch on the page and here (lanes() keeps it in the store; the page and tools/import_next.py skip it).
  - Swap (page, editors only) is NOT stored here: it is db collection `batches`, one doc per lane ('advanced_12'): {course, yl,
    swaps: [{id, by, at}]}, applied on top of these batches by apply_swaps() (and by the page's port, 32_papers_q.js swapsApply):
    the swapped paper leaves its batch for the end of the lane, and every later batch passes its first paper back one batch, so
    each batch keeps its size and number. tools/sync_pagedb.py mirrors the collection into page_batches.
work/batches.json: {version, made, updated, lanes: {"advanced|12": {first, batches: [[paper ids]], log: [{at, from, to, papers,
why}]}}}. If it is missing (a new sandbox) it is rebuilt from site/data/inventory.json "lanes" (tracked in git), so the numbering
survives. --reset starts a lane over (only before any of its batches is queued: say so to the owner first).
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import datetime, glob, json, os, sqlite3, sys

P = paths.P
STORE = paths.S + 'work/batches.json'
INV = P + 'site/data/inventory.json'
PROGRESS = P + 'site/data/progress.json'
SEED = paths.S + 'work/importq_seed.json'
SIZE = 9
READY = ('ready_current', 'ready_old')
FIRST_LANE = 'advanced|12'      # the lane the finished batches b1-b5 belong to (every import so far was Year 12 Advanced)


def label(p):
    """The page's label for a paper (32_papers_q.js label)."""
    return p.get('l') or (f"{p['y']} NESA HSC" if p.get('t') == 'HSC' else f"{p.get('y')} {p.get('s')} {p.get('t')}")


def order_key(p):
    """current syllabus first, newest year first, then old syllabus newest first; ties by school, task, id"""
    return (1 if p['st'] == 'ready_old' else 0, -(p.get('y') or 0), p.get('s') or '~', p.get('t') or '', p['id'])


def label_map(inv):
    """label -> paper id, imported papers first (progress.json names finished papers by label; a twice-filed paper's other copy
    or a paper of another course can share it)."""
    out = {}
    for imp in (True, False):
        for g in inv['groups']:
            for p in g['papers']:
                if (p['st'] == 'imported') == imp: out.setdefault(label(p), p['id'])
    return out


def finished():
    """The finished import batches in progress.json: [(number, id, [paper labels])]."""
    try: bs = json.load(open(PROGRESS)).get('batches') or []
    except (OSError, ValueError): bs = []
    out = []
    for b in bs:
        st = (b.get('stages') or {}).values()
        if str(b.get('id', ''))[1:].isdigit() and st and all(v in ('done', 'n/a') for v in st):
            out.append((int(b['id'][1:]), b['id'], b.get('papers') or [], b.get('ids')))
    return sorted(out)


def seed_order():
    """The owner's import order (doc ids): the page_importq mirror if it has rows, else the 13 Nov seed file."""
    db_path = paths.DBS
    try:
        db = sqlite3.connect('file:' + db_path + '?mode=ro', uri=True)
        if db.execute("SELECT 1 FROM sqlite_master WHERE name='page_importq'").fetchone():
            rows = db.execute('SELECT doc_id FROM page_importq ORDER BY ord, at').fetchall()
            if rows: return [r[0] for r in rows], 'page_importq mirror'
    except sqlite3.Error:
        pass
    if os.path.exists(SEED):
        s = json.load(open(SEED))
        xs = [w['data'] for ch in s.get('chunks', []) for w in ch if isinstance(w.get('data'), dict)]
        return [x['doc_id'] for x in sorted(xs, key=lambda x: x.get('order') or 0)], 'work/importq_seed.json'
    return [], 'none'


def load_store():
    if os.path.exists(STORE):
        return json.load(open(STORE))
    st = {'version': 1, 'made': None, 'lanes': {}}
    try:   # a new sandbox: the numbering lives on in the published inventory
        for L in json.load(open(INV)).get('lanes') or []:
            st['lanes'][L['course'] + '|' + L['yl']] = {'first': L['first'], 'batches': L['batches'], 'log': [{'at': None, 'why': 'restored from site/data/inventory.json'}]}
    except (OSError, ValueError):
        pass
    return st


def apply_swaps(batches, swaps, fixed=()):
    """Swap (page): each swapped paper leaves its batch for the END of the lane; every later batch passes its first paper back
    one batch, so sizes and numbers stay. A batch holding a paper in `fixed` (imported) is never touched: a swap inside it is
    ignored and the shifting passes over it. The page's swapsApply (32_papers_q.js) is the same; page_test checks both on the
    fixture. Returns new lists."""
    B = [list(b) for b in batches]
    sizes = [len(b) for b in B]
    fixed = set(fixed)
    frozen = lambda b: any(i in fixed for i in b)
    for s in swaps:
        i = s['id'] if isinstance(s, dict) else s
        k = next((n for n, b in enumerate(B) if i in b), None)
        if k is None or frozen(B[k]): continue
        idx = [j for j in range(k, len(B)) if not frozen(B[j])]
        flat = [x for j in idx for x in B[j] if x != i] + [i]
        o = 0
        for j in idx: B[j] = flat[o:o + sizes[j]]; o += sizes[j]
    return B


def lanes(inv, write=True, reset=()):
    """Assign new ready papers to batches (once), save the store, and return the lanes for the inventory json:
    [{course, yl, first, batches: [[ids]], done: [{n, id, ids, labels}]}] for every lane that has (or had) ready papers."""
    st = load_store()
    now = datetime.datetime.now().astimezone().isoformat(timespec='seconds')
    st['made'] = st.get('made') or now
    by = {}
    for g in inv['groups']:
        by[g['course'] + '|' + g['yl']] = g
    fin = finished()
    changed = False
    # owner 18 Nov ("yes mark it as a copy", doc 177 = 2022 Arden AT2): a paper recorded as a copy later (inventory held.copies) leaves
    # every stored batch, so it is never imported; batch_check blocks a copy in a batch (owner 16 Nov "duplicate exams will never be batched")
    cps = {c[0] for c in (inv.get('held') or {}).get('copies') or []}
    for key, L in st['lanes'].items():
        out = sorted({i for b in L.get('batches', []) for i in b} & cps)
        if out:
            L['batches'] = [[i for i in b if i not in cps] for b in L['batches']]
            L.setdefault('log', []).append({'at': now, 'removed': out, 'why': 'recorded as copies of another file (never imported)'})
            changed = True
    for key, g in by.items():
        ready = [p for p in g['papers'] if p['st'] in READY]
        if key in reset: st['lanes'].pop(key, None)
        L = st['lanes'].get(key)
        if not ready and not L: continue
        have = {i for b in (L or {}).get('batches', []) for i in b}
        new = sorted([p for p in ready if p['id'] not in have], key=order_key)
        if not new: continue
        why = 'new papers from a scan'
        if not L:
            first = max([n for n, *_ in fin], default=0) + 1 if key == FIRST_LANE else 1
            L = st['lanes'][key] = {'first': first, 'batches': [], 'log': []}
            why = 'first assignment: current syllabus first, newest year first, then old syllabus'
            if key == FIRST_LANE:
                seed, src = seed_order()
                pos = {d: n for n, d in enumerate(seed)}
                ids = {p['id']: p for p in new}
                head = [ids[d] for d in seed if d in ids]
                new = head + [p for p in new if p['id'] not in pos]
                why = f'first assignment: the owner\'s import order ({len(head)} papers, {src}), then current syllabus first, newest year first, then old syllabus'
        n0 = len(L['batches'])
        L['batches'] += [[p['id'] for p in new[i:i + SIZE]] for i in range(0, len(new), SIZE)]
        L['log'].append({'at': now, 'from': L['first'] + n0, 'to': L['first'] + len(L['batches']) - 1, 'papers': len(new), 'why': why})
        changed = True
    if changed:
        st['updated'] = now
        if write:
            os.makedirs(os.path.dirname(STORE), exist_ok=True)
            json.dump(st, open(STORE, 'w'), indent=1)
    # finished batches name their papers by label: map only to IMPORTED papers (review 14 Nov: b5's "2024 Knox Grammar School
    # AT1" was never loaded and fell back to the ready doc 1589, which then sat in done Batch 5 and in a ready batch at once)
    stat = {p['id']: p['st'] for g in inv['groups'] for p in g['papers']}
    labels = {l: i for l, i in label_map(inv).items() if stat.get(i) == 'imported'}
    out = []
    for key, L in st['lanes'].items():
        c, yl = key.split('|')
        # 17 Nov: renaming 2024 Abbotsleigh AT1 to 2025 moved Batch 3's slot onto the new paper that took the old name. A finished
        # batch's 'ids' in progress.json (pinned that day) win over its labels; labels only for a batch without them.
        done = [{'n': n, 'id': bid, 'ids': list(ids) if ids else [labels[x] for x in ps if x in labels], 'labels': ps} for n, bid, ps, ids in fin if key == FIRST_LANE and n < L['first']]
        out.append({'course': c, 'yl': yl, 'first': L['first'], 'batches': L['batches'], 'done': done})
    return out


def main():
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import inventory
    db = sqlite3.connect('file:' + inventory.DB + '?mode=ro', uri=True)
    inv = inventory.build(db)
    reset = [a for a in sys.argv[sys.argv.index('--reset') + 1:sys.argv.index('--reset') + 2]] if '--reset' in sys.argv else []
    st = {p['id']: p['st'] for g in inv['groups'] for p in g['papers']}
    for L in lanes(inv, write='--print' not in sys.argv, reset=reset):
        bs = L['batches']
        ready = sum(1 for b in bs for i in b if st.get(i) in READY)
        print(f'{L["course"]} Year {L["yl"]}: finished {", ".join(d["id"] for d in L["done"]) or "none"}; batches {L["first"]}-{L["first"] + len(bs) - 1}, '
              f'{sum(map(len, bs))} papers assigned, {ready} still ready')
        for n, b in enumerate(bs[:3]):
            print(f'  Batch {L["first"] + n}: {b}')
    if '--print' not in sys.argv: print(f'-> {os.path.relpath(STORE, P)}')


if __name__ == '__main__':
    main()
