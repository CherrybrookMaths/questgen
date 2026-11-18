#!/usr/bin/env python3
"""Papers being imported stay out of every publish until their import is finished (state/work/import/hold.json).

Owner 18 Nov: "We have to find a way for imports to be independent of flag checking, it shouldn't stall flagging and checking".
An import writes into the shared questions.db step by step, and every publish rebuilds the bank from the whole database, so a
half-imported batch used to go live with any flag fix published meanwhile, or the fix had to wait for the import. Held papers are
left out of the bank (build_bank.py), their page-scan packs are not published (publish_set.py) and the checks skip them
(batch_check.py), so flag fixes and page changes publish at any time. Releasing the batch, after its checks, puts it in the next publish.

  python3 tools/import_hold.py hold <batch> <doc_id> [...]   at the start of an import (before parse)
  python3 tools/import_hold.py release <batch>              when the batch is ready to go live (before its publish)
  python3 tools/import_hold.py show                         list held papers
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import datetime, json, os, sys

FILE = paths.S + 'work/import/hold.json'


def load():
    return json.load(open(FILE)) if os.path.exists(FILE) else {}


def held_docs():
    """Every held document id (ints), across batches."""
    return {int(d) for b in load().values() for d in b.get('docs', [])}


def _now():
    from zoneinfo import ZoneInfo
    return datetime.datetime.now(ZoneInfo('Australia/Sydney')).isoformat(timespec='minutes')


def main():
    a = sys.argv[1:]
    h = load()
    if a[:1] == ['hold'] and len(a) >= 3:
        h[a[1]] = {'docs': sorted({int(x) for x in a[2:]} | set(h.get(a[1], {}).get('docs', []))), 'since': h.get(a[1], {}).get('since') or _now()}
    elif a[:1] == ['release'] and len(a) == 2:
        if a[1] not in h: sys.exit(f'{a[1]} is not held')
        h.pop(a[1])
    elif a[:1] != ['show']:
        sys.exit(__doc__)
    if a[:1] != ['show']:
        os.makedirs(os.path.dirname(FILE), exist_ok=True)
        json.dump(h, open(FILE, 'w'), indent=1)
    for b, v in h.items(): print(f'{b}: held since {v["since"]}: {v["docs"]}')
    if not h: print('nothing held')


if __name__ == '__main__':
    main()
