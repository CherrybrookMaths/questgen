#!/usr/bin/env python3
"""One-off (13 Nov): fold the 15 pre-planned waiting batches (progress.json b6-b20, saved in work/importq_planned_b6_b20.json)
into the owner's import order. Owner: "but we already have 15 waiting batches?" -> ONE list.
Writes work/importq_seed.json: ArtifactData batch writes (<= 50 per chunk) for collection importq, doc ids d<doc_id>, doc shape
as page_src/js/32_papers_q.js invAdd: {doc_id, label, course, year_level, order, added_by, at}. Read-only on the database."""
import datetime, json, os, sqlite3, sys
W = os.path.dirname(os.path.abspath(__file__)); P = os.path.dirname(W)
sys.path.insert(0, P + '/tools'); import inventory
db = sqlite3.connect('file:' + inventory.DB + '?mode=ro', uri=True)
inv = inventory.build(db, files=True)
byfile, bylabel = {}, {}
for g in inv['groups']:
    if g['course'] != 'advanced' or g['yl'] != '12': continue
    for p in g['papers']:
        for f in p['f']: byfile[f] = (p, g)
        bylabel.setdefault(p.get('l') or (f"{p['y']} NESA HSC" if p['t'] == 'HSC' else f"{p['y']} {p['s']} {p['t']}"), []).append((p, g))
pj = {x['label']: x['id'] for x in json.load(open(P + '/work/import/papers.json'))}
at = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
docs, unmapped, notq, seen = [], [], [], set()
for b in json.load(open(W + '/importq_planned_b6_b20.json')):
    for name in b['papers']:
        hit = byfile.get(pj.get(name)) or (bylabel[name][0] if len(bylabel.get(name, [])) == 1 else None)
        if not hit: unmapped.append({'batch': b['id'], 'name': name}); continue
        p, g = hit
        if not p.get('pick'): notq.append({'batch': b['id'], 'name': name, 'doc_id': p['id'], 'state': p['st'], 'why': p.get('why', '')}); continue
        if p['id'] in seen: continue
        seen.add(p['id'])
        docs.append({'doc_id': p['id'], 'label': name, 'course': g['course'], 'year_level': int(g['yl']), 'order': len(docs) + 1, 'added_by': None, 'at': at})
writes = [{'op': 'set', 'collection': 'importq', 'doc_id': f"d{d['doc_id']}", 'data': d} for d in docs]
out = {'collection': 'importq', 'count': len(docs), 'planned': sum(len(b['papers']) for b in json.load(open(W + '/importq_planned_b6_b20.json'))),
       'unmapped': unmapped, 'not_queueable': notq,
       'note': 'ArtifactData batch, one call per chunk (max 50 writes). If importq already has docs, list it first and add their count to every order.',
       'chunks': [writes[i:i + 50] for i in range(0, len(writes), 50)]}
json.dump(out, open(W + '/importq_seed.json', 'w'), indent=1, ensure_ascii=False)
print(f"seed {len(docs)} of {out['planned']} planned; unmapped {unmapped}; not queueable {notq}")
