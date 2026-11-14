#!/usr/bin/env python3
"""The next batch to import: the head of the owner's queue on Processes › Papers, and whether the queue must stop first.

  python3 tools/import_next.py [EXPORT_DIR]

Owner 14 Nov (mockup A: "I like A's design much more"): every ready paper sits in a fixed numbered batch of 9 per course + year
lane (tools/batches.py; site/data/inventory.json "lanes"); the owner puts whole batches in ONE ordered queue across courses
(db collection `queue`, one doc per batch: '<course>_<yl>_<n>' {course, yl, batch, order, by, at}) and presses Start the queue,
which writes a request to db collection `runs` ({kind: 'queue', status: 'requested', limit: 3, stop_early, by, at}).
Swap (db collection `batches`, one doc per lane: {course, yl, swaps: [{id, by, at}]}) is applied on top (batches.apply_swaps).

Owner 14 Nov: "we might want to run multiple batches over the night", then "Let's do 3 batches before the lock". This REPLACES
the 13 Nov per-batch pause ("Yes, with batch pauses"): the queue runs batch after batch and STOPS when
  - LIMIT (3) imported batches are waiting for review (imported, not yet cleared in Review), or
  - the batch that just finished came back with unusual problems (STOP_EARLY): a paper that loaded no questions, FAILED_PAGES
    or more pages the parser could not read, or more than YOUR_CALLS Your calls (progress.json batch fields failed_papers,
    failed_pages, your_calls, written by Claude when a batch finishes; IMPORT_PLAYBOOK "Queue").
"Cleared in Review" here: every paper of the batch has reviews/paper_<doc> approved, or every one of its questions approved
(page_reviews mirror); the Review Inbox is the authority when in doubt.

EXPORT_DIR: one folder holding the ArtifactData `list` exports (out_dir) of queue/, runs/, batches/ and reviews/ (one JSON file per
doc). Without it, the page_* mirrors in questions.db are read (tools/sync_pagedb.py <export_dir> first). Writes
work/import/next.json: the batch (lane, number, papers with every file and Drive id), the queue after it, what was skipped and
why, the run and the stop decision. Read-only on the database and the page.
Import is PAUSED (owner 14 Nov: "no more importing for a while until we iron these out") until the owner resumes it.
"""
import csv, glob, json, os, sqlite3, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import inventory, batches as BT

P = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + '/'
DB = os.environ.get('QG_DB', '/mnt/user-data/outputs/questions.db')
OUT = P + 'work/import/next.json'
PROGRESS = P + 'site/data/progress.json'
# owner 14 Nov: "Let's do 3 batches before the lock"
LIMIT = 3
# unusual problems that stop the queue early (chosen 14 Nov while the owner was away; b1, the very first batch, had 11 Your
# calls for 8 papers, later batches far fewer): any paper with no questions loaded, 3+ unreadable pages, or more than 12 Your calls
STOP_EARLY = {'failed_papers': 1, 'failed_pages': 3, 'your_calls': 13}
ACTIVE = ('requested', 'running')


def read(src, coll, db, table):
    """[(key, doc)] from the export folder (src/<coll>/*.json), else (no such folder in it) the page_<coll> mirror."""
    if src and os.path.isdir(os.path.join(src, coll)):
        out = []
        for f in sorted(glob.glob(os.path.join(src, coll, '*.json'))):
            x = json.load(open(f)); v = x['data'] if isinstance(x, dict) and isinstance(x.get('data'), dict) else x
            out.append((os.path.basename(f)[:-5], v))
        return out
    if not db.execute('SELECT 1 FROM sqlite_master WHERE name=?', (table,)).fetchone(): return []
    return [(k, json.loads(d)) for k, d in db.execute(f'SELECT doc_key, data_json FROM {table}')]


def cleared(doc_ids, reviews, qs_of):
    """Every paper approved in Review (paper doc approved, or all its questions approved). doc_ids: every file of the batch's
    papers; only files that hold questions count (Review keys a paper by the file its questions came from)."""
    for d in doc_ids:
        if not qs_of.get(d): continue
        if (reviews.get(f'paper_{d}') or {}).get('status') == 'approved': continue
        qs = qs_of.get(d) or []
        if qs and all((reviews.get(f'q{q}') or {}).get('status') == 'approved' for q in qs): continue
        return False
    return True


def stop_reason(fin, reviews, qs_of, lab):
    """(waiting batch ids, why the queue must stop or '')."""
    waiting = [b for b in fin if not cleared([f for x in b.get('papers') or [] if x in lab for f in lab[x]] + list(b.get('ids') or []), reviews, qs_of)]
    if len(waiting) >= LIMIT:
        return [b['id'] for b in waiting], f'{len(waiting)} imported batches are waiting for review ({", ".join(b["id"] for b in waiting)}); the limit is {LIMIT}: stop until the owner clears one in Review'
    last = fin[-1] if fin else None
    if last:
        bad = [f'{k.replace("_", " ")} {last.get(k)}' for k, lim in STOP_EARLY.items() if (last.get(k) or 0) >= lim]
        if bad and last.get('stop_ack') is not True:
            return [b['id'] for b in waiting], f'batch {last["id"]} came back with unusual problems ({", ".join(bad)}): stop and tell the owner (set stop_ack: true on that batch in progress.json once he has seen it)'
    return [b['id'] for b in waiting], ''


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    src = args[0] if args else None
    db = sqlite3.connect('file:' + DB + '?mode=ro', uri=True)
    queue = sorted((v for _, v in read(src, 'queue', db, 'page_queue')), key=lambda v: (float(v.get('order') or 0), str(v.get('at') or '')))
    runs = [dict(v, key=k) for k, v in read(src, 'runs', db, 'page_runs')]
    run = max((r for r in runs if r.get('kind') == 'queue' and r.get('status') in ACTIVE), key=lambda r: str(r.get('at') or ''), default=None)
    swaps = {(v.get('course'), str(v.get('yl'))): v.get('swaps') or [] for _, v in read(src, 'batches', db, 'page_batches')}
    reviews = dict(read(src, 'reviews', db, 'page_reviews'))
    inv = inventory.build(db, files=True)
    db.row_factory = sqlite3.Row
    qs_of = {}
    for r in db.execute('SELECT id, document_id FROM questions'): qs_of.setdefault(r['document_id'], []).append(r['id'])
    papers = {p['id']: (p, g) for g in inv['groups'] for p in g['papers']}
    lab = {l: papers[i][0]['f'] for l, i in BT.label_map(inv).items() if papers[i][0]['st'] == 'imported'}   # finished batches name their papers by label
    lanes = {(L['course'], L['yl']): L for L in BT.lanes(inv, write=False)}
    try: fin = [b for b in json.load(open(PROGRESS)).get('batches') or [] if (b.get('stages') or {}) and all(v in ('done', 'n/a') for v in b['stages'].values())]
    except (OSError, ValueError): fin = []
    waiting, why = stop_reason(fin, reviews, qs_of, lab)
    paths = {r['id']: dict(r) for r in db.execute('SELECT id, source_path, status, parse_path, page_count, drive_file_id FROM documents')}
    drive = {}
    if os.path.exists(P + 'drive_ids.csv'):
        drive = {int(r['doc_id']): r['drive_file_id'] for r in csv.DictReader(open(P + 'drive_ids.csv')) if r.get('doc_id', '').isdigit()}
    items, skipped = [], []
    for pos, x in enumerate(queue, 1):
        L = lanes.get((x.get('course'), str(x.get('yl'))))
        if not L: skipped.append({'pos': pos, 'item': x, 'why': 'no such lane in the inventory'}); continue
        bs = BT.apply_swaps(L['batches'], swaps.get((L['course'], L['yl']), []), {i for i, (p, g) in papers.items() if p['st'] == 'imported'})
        k = int(x.get('batch') or 0) - L['first']
        if not 0 <= k < len(bs): skipped.append({'pos': pos, 'item': x, 'why': 'no such batch'}); continue
        ready = [i for i in bs[k] if i in papers and papers[i][0]['st'] in BT.READY]
        if not ready: skipped.append({'pos': pos, 'item': x, 'why': 'nothing left to import in it (imported, or no longer ready)'}); continue
        items.append({'pos': pos, 'course': L['course'], 'yl': L['yl'], 'batch': x['batch'], 'papers': ready,
                      'left_out': [i for i in bs[k] if i not in ready]})
    nxt = items[0] if items else None
    if nxt:
        nxt['files'] = [{'doc_id': i, 'label': BT.label(papers[i][0]), **({'syllabus_version': 'pre2017'} if papers[i][0]['st'] == 'ready_old' else {}),
                         'files': [{'doc_id': f, 'path': paths[f]['source_path'], 'status': paths[f]['status'], 'scan': paths[f]['parse_path'] == 'scan',
                                    'pages': paths[f]['page_count'], 'drive_file_id': drive.get(f) or paths[f]['drive_file_id']} for f in papers[i][0]['f']]}
                        for i in nxt['papers']]
    res = {'source': f'export {src}' if src else 'page_* mirrors in questions.db', 'run': run and {k: run.get(k) for k in ('key', 'status', 'by', 'at', 'limit')},
           'limit': LIMIT, 'stop_early': STOP_EARLY, 'waiting_for_review': waiting, 'stop': why,
           'next': None if (why or not run) else nxt, 'queue': [{k: v for k, v in it.items() if k != 'files'} for it in items], 'skipped': skipped,
           'paused': 'Import is paused (owner 14 Nov: "no more importing for a while until we iron these out"). Do not start an import until the owner resumes it.'}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(res, open(OUT, 'w'), indent=1, ensure_ascii=False)
    print(f'queue: {len(items)} batches ({res["source"]}); ' + (f'run {run["key"]} {run["status"]}' if run else 'not started (no queue run requested)'))
    print('  ' + res['paused'])
    print(f'  waiting for review: {len(waiting)} of {LIMIT}' + (f' ({", ".join(waiting)})' if waiting else ''))
    if why: print('  STOP: ' + why)
    for it in items[:6]:
        print(f'  {it["pos"]:3d}. {it["course"]} Year {it["yl"]} · Batch {it["batch"]}: {len(it["papers"])} papers' + (f' ({len(it["left_out"])} left out)' if it['left_out'] else ''))
    if nxt and res['next']:
        print(f'  NEXT: {nxt["course"]} Year {nxt["yl"]} · Batch {nxt["batch"]}')
        for t in nxt['files']:
            print(f'    {t["label"]}{" (old syllabus)" if t.get("syllabus_version") else ""}: ' + ', '.join(f'{f["path"]}{"" if f["drive_file_id"] else " (no Drive id)"}' for f in t['files']))
    for s in skipped: print(f'  skip {s["pos"]}: {s["item"].get("course")} {s["item"].get("yl")} Batch {s["item"].get("batch")}: {s["why"]}')
    print(f'  -> {os.path.relpath(OUT, P)}')


if __name__ == '__main__':
    main()
