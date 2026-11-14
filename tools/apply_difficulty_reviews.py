#!/usr/bin/env python3
"""Apply the owner's difficulty decisions (page database, collection `difficulty`) to part_difficulty.

Owner 13 Nov: references are HSC parts rated by us and checked by him; every other part points at the reference it was
compared with (nearest_anchor), "so a corrected anchor can be pushed through mechanically".

Rules (idempotent: always recomputed from the model's original rating, kept in band_ai / wm_ai):
  * a part the owner decided -> his band and wm (owner_band / owner_wm stored, source='owner')
  * a part whose nearest_anchor the owner changed -> band_ai + (owner band - anchor's band_ai), clamped to 2..6;
    its wm is untouched (wm is a property of the part itself), source='shifted'
  * everything else -> band_ai / wm_ai, source='model'
Usage: apply_difficulty_reviews.py [dir of difficulty/*.json]   (no dir: use the page_difficulty mirror from tools/sync_pagedb.py)
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import json, glob, os, sqlite3, sys, collections
DB = paths.DBS
src = sys.argv[1] if len(sys.argv) > 1 else None
dec = {}
if src:
    for f in glob.glob(os.path.join(src, '*.json')):
        r = json.load(open(f)); r = r.get('data', r)
        if r.get('status') in ('agreed', 'changed'): dec[int(r['part_id'])] = r
else:   # default (14 Nov): read the mirror written by tools/sync_pagedb.py
    _m = sqlite3.connect(DB)
    for pid, band, wm, st in _m.execute("SELECT part_id, band, wm, status FROM page_difficulty WHERE status IN ('agreed','changed')"):
        dec[pid] = {'part_id': pid, 'band': band, 'wm': wm, 'status': st}
db = sqlite3.connect(DB); db.row_factory = sqlite3.Row
cols = [c[1] for c in db.execute('pragma table_info(part_difficulty)')]
for c, t in [('band_ai', 'integer'), ('wm_ai', 'text'), ('owner_band', 'integer'), ('owner_wm', 'text'), ('source', 'text')]:
    if c not in cols:
        db.execute(f'alter table part_difficulty add column {c} {t}')
        if c in ('band_ai', 'wm_ai'): db.execute(f"update part_difficulty set {c}={c[:-3] if c!='wm_ai' else 'wm'}")
rows = {r['part_id']: r for r in db.execute('select * from part_difficulty')}
delta = {pid: d['band'] - rows[pid]['band_ai'] for pid, d in dec.items() if pid in rows}
cnt = collections.Counter()
for pid, r in rows.items():
    if pid in dec:
        b, w, s = dec[pid]['band'], dec[pid]['wm'], 'owner'
        db.execute('update part_difficulty set owner_band=?, owner_wm=? where part_id=?', (b, w, pid))
    elif r['nearest_anchor'] in delta and delta[r['nearest_anchor']]:
        b, w, s = max(2, min(6, r['band_ai'] + delta[r['nearest_anchor']])), r['wm_ai'], 'shifted'
    else:
        b, w, s = r['band_ai'], r['wm_ai'], 'model'
    if (b != r['band_ai']) or (w != r['wm_ai']): cnt[s + ' (moved)'] += 1
    cnt[s] += 1
    db.execute('update part_difficulty set band=?, wm=?, source=? where part_id=?', (b, w, s, pid))
db.commit()
print(f'{len(dec)} owner decisions; {sum(1 for v in delta.values() if v)} references moved')
for k in sorted(cnt): print(f'  {k}: {cnt[k]}')
print('bands now:', dict(sorted(collections.Counter(r[0] for r in db.execute('select band from part_difficulty')).items())))
