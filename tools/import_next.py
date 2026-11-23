#!/usr/bin/env python3
"""The next batch to import: the head of the owner's queue on Processes › Papers, and whether the queue must stop first.

  python3 tools/import_next.py [EXPORT_DIR]

Owner 14 Nov (mockup A: "I like A's design much more"): every ready paper sits in a fixed numbered batch of 9 per course + year
lane (tools/batches.py; site/data/inventory.json "lanes"); the owner puts whole batches in ONE ordered queue across courses
(db collection `queue`, one doc per batch: '<course>_<yl>_<n>' {course, yl, batch, order, by, at}) and presses Start the queue,
which writes a request to db collection `runs` ({kind: 'queue', status: 'requested', stop_early, by, at}).
Swap (db collection `batches`, one doc per lane: {course, yl, swaps: [{id, by, at}]}) is applied on top (batches.apply_swaps).

Owner 14 Nov: "we might want to run multiple batches over the night"; then, superseding "Let's do 3 batches before the lock":
owner 14 Nov: "Maybe remove the lock for now since I'm in charge of import". The queue runs every batch in it until it is
EMPTY; there is no waiting-for-review limit. It STOPS early only when the batch that just finished came back with unusual
problems (STOP_EARLY): a paper that loaded no questions, 3 or more pages the parser could not read, or more than 12 Your calls
(progress.json batch fields failed_papers, failed_pages, your_calls, written by Claude when a batch finishes; IMPORT_PLAYBOOK "Queue").
How many imported batches wait for review is printed as information only (the page shows the same count next to Start the
queue). "Cleared in Review" here: every paper of the batch has its paper approval, or every one of its questions approved
(page_reviews mirror, by key too); the page's own count follows Review's per-paper track and is the authority when in doubt.

EXPORT_DIR: one folder holding the ArtifactData `list` exports (out_dir) of queue/, runs/, batches/ and reviews/ (one JSON file per
doc). Without it, the page_* mirrors in questions.db are read (tools/sync_pagedb.py <export_dir> first). Writes
work/import/next.json: the batch (lane, number, papers with every file and Drive id), the queue after it, what was skipped and
why, the run and the stop decision. Read-only on the database and the page.
Import is PAUSED (owner 14 Nov: "no more importing for a while until we iron these out") until the owner resumes it.
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import collections, csv, glob, json, os, sqlite3, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import inventory, batches as BT

P = paths.P
DB = paths.DBS
OUT = paths.S + 'work/import/next.json'
PROGRESS = P + 'site/data/progress.json'
# unusual problems that stop the queue early (chosen 14 Nov while the owner was away; b1, the very first batch, had 11 Your
# calls for 8 papers, later batches far fewer): any paper with no questions loaded, 3+ unreadable pages, or more than 12 Your calls
# owner 14 Nov: "Maybe remove the lock for now since I'm in charge of import": no waiting-for-review limit, only the early stop
STOP_EARLY = {'failed_papers': 1, 'failed_pages': 3, 'your_calls': 13}
ACTIVE = ('requested', 'running')


def read(src, coll, db, table):
    """[(key, doc)] from the export folder (src/<coll>/*.json), else (no such folder in it) the page_<coll> mirror."""
    if src and os.path.isdir(os.path.join(src, coll)):
        out = []
        for f in sorted(glob.glob(os.path.join(src, coll, '*.json'))):
            x = json.load(open(f)); v = x['data'] if isinstance(x, dict) and isinstance(x.get('data'), dict) else x
            out.append((os.path.basename(f)[:-5].replace('@', '~'), v))   # 21 Nov: the export spells '~' as '@' (as tools/sync_pagedb.py docs())
        return out
    if not db.execute('SELECT 1 FROM sqlite_master WHERE name=?', (table,)).fetchone(): return []
    return [(k, json.loads(d)) for k, d in db.execute(f'SELECT doc_key, data_json FROM {table}')]


def cleared(doc_ids, reviews, qs_of, key_of=None, pkey_of=None):
    """Every paper approved in Review (paper doc approved, or all its questions approved). doc_ids: every file of the batch's
    papers; only files that hold questions count (Review keys a paper by the file its questions came from).
    key_of: question id -> permanent key (questions.db question_keys, Fix 2 branch fix2-keys): once Review writes reviews/k_<key>
    and reviews/p_<paper key> (the paper key is the question key without '-Q...'), those count too (review 14 Nov: without this
    the queue would never see a batch cleared after Fix 2 lands and would stay stopped at the limit)."""
    key_of = key_of or {}
    ok = lambda k: (reviews.get(k) or {}).get('status') == 'approved'
    for d in doc_ids:
        qs = qs_of.get(d) or []
        if not qs: continue
        # the paper's OWN key: the one most of its questions carry. A question that is a copy of another paper's question shares
        # that paper's key (17 Nov, Batch 8: MathsBank 2023 has one 2023 Abbotsleigh AT4 key), and that paper's approval is not this one's
        pk = collections.Counter(key_of[q].rsplit('-Q', 1)[0] for q in qs if key_of.get(q)).most_common(1)
        # 23 Nov (Batch 12): a paper made mostly of copies (2022 NEAP: 23 of 32 questions copied from 2022 Knox AT4) has the other
        # paper's key as its most common one; pkey_of (the bank's docs[doc].key, from the paper's own questions: tools/qkeys.py) wins
        if pkey_of and pkey_of.get(d): pk = [(pkey_of[d], 0)]
        if ok(f'paper_{d}') or (pk and ok(f'p_{pk[0][0]}')): continue
        if all(ok(f'q{q}') or (key_of.get(q) and ok(f'k_{key_of[q]}')) for q in qs): continue
        return False
    return True


def question_keys(db):
    """question id -> key, if the Fix 2 table exists (else {})."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='question_keys'").fetchone(): return {}
    return {q: k for q, k in db.execute('SELECT question_id, key FROM question_keys')}


def stop_reason(fin, reviews, qs_of, lab, key_of=None):
    """(waiting batch ids, why the queue must stop or ''). The waiting batches are information only: no limit (owner 14 Nov:
    "Maybe remove the lock for now since I'm in charge of import")."""
    waiting = [b for b in fin if not cleared([f for x in b.get('papers') or [] if x in lab for f in lab[x]] + list(b.get('ids') or []), reviews, qs_of, key_of)]
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
    waiting, why = stop_reason(fin, reviews, qs_of, lab, question_keys(db))
    # a finished batch whose paper labels match no imported paper and that has no `ids` cannot be checked: say so
    unmatched = [(b['id'], x) for b in fin if not b.get('ids') for x in b.get('papers') or [] if x not in lab and not str(x).startswith('(')]
    paths = {r['id']: dict(r) for r in db.execute('SELECT id, source_path, status, parse_path, page_count, drive_file_id FROM documents')}
    drive = {}
    if os.path.exists(P + 'site/project/drive_ids.csv'):   # tracked copy (the old top-level drive_ids.csv was identical)
        drive = {int(r['doc_id']): r['drive_file_id'] for r in csv.DictReader(open(P + 'site/project/drive_ids.csv')) if r.get('doc_id', '').isdigit()}
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
    res = {'source': f'export {src}' if src else 'page_* mirrors in questions.db', 'run': run and {k: run.get(k) for k in ('key', 'status', 'by', 'at')},
           'stop_early': STOP_EARLY, 'waiting_for_review': waiting, 'stop': why,
           'next': None if (why or not run) else nxt, 'queue': [{k: v for k, v in it.items() if k != 'files'} for it in items], 'skipped': skipped,
           'paused': 'Import is paused (owner 14 Nov: "no more importing for a while until we iron these out"). Do not start an import until the owner resumes it.'}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(res, open(OUT, 'w'), indent=1, ensure_ascii=False)
    print(f'queue: {len(items)} batches ({res["source"]}); ' + (f'run {run["key"]} {run["status"]}' if run else 'not started (no queue run requested)'))
    print('  ' + res['paused'])
    print(f'  waiting for review (information only, no limit): {len(waiting)}' + (f' ({", ".join(waiting)})' if waiting else ''))
    if why: print('  STOP: ' + why)
    if unmatched: print('  note: not matched to an imported paper, so not checked for review: ' + '; '.join(f'{b} "{x}"' for b, x in unmatched) + ' (add `ids` to that batch in progress.json)')
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
