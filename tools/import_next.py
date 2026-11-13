#!/usr/bin/env python3
"""The next papers to import, in the order the owner chose on the Processes page (owner 13 Nov: "Can the import queue be
dynamic, me choosing which set of papers to import next?").

  python3 tools/import_next.py [EXPORT_DIR] [--n 9]

EXPORT_DIR: a folder exported with ArtifactData `list` on collection importq (out_dir; one JSON file per doc, importq/d<id>.json),
the same export tools/sync_pagedb.py takes. Without it, the page_importq mirror in questions.db is read (run sync_pagedb.py first).
Prints the owner's order, then the next N importable papers (default 9, one batch, cut from the top) with every file and its Drive id
(drive_ids.csv), and writes work/import/next.json. Papers that are already imported, or that can no longer be imported
(their state changed since they were queued), are listed as skipped with the reason; nothing is ever dropped silently.

One list (owner 13 Nov: "but we already have 15 waiting batches?"): the planned batches b6-b20 were folded into this order,
so progress.json holds only finished batches; the next batch is numbered after the last one there ("Batch 6", ...), as the page's
dividers show. Old-syllabus papers (inventory "old", before 2020) are marked syllabus_version 'pre2017' (IMPORT_PLAYBOOK
"Old-syllabus papers").

Read-only: it changes nothing in the database or on the page. Import is PAUSED (owner 14 Nov: "no more importing for a while
until we iron these out"); when it resumes, this list replaces picking rows by hand from import_manifest.csv (IMPORT_PLAYBOOK
"Choosing what to import next"). Remove a paper from the page's queue once it is imported (ArtifactData delete importq/d<id>),
or leave it: it then shows as "already imported" here and on the page.
"""
import csv, glob, json, os, sqlite3, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import inventory

P = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + '/'
DB = os.environ.get('QG_DB', '/mnt/user-data/outputs/questions.db')
OUT = P + 'work/import/next.json'
PROGRESS = P + 'site/data/progress.json'


def next_batch_no():
    """Last finished batch in progress.json + 1 (b1..b5 done -> 6). The page's import-order dividers use the same rule."""
    try: bs = json.load(open(PROGRESS)).get('batches') or []
    except (OSError, ValueError): bs = []
    done = [int(b['id'][1:]) for b in bs if str(b.get('id', ''))[1:].isdigit() and (b.get('stages') or {})
            and all(v in ('done', 'n/a') for v in b['stages'].values())]
    return max(done, default=0) + 1


def read_queue(src, db):
    if src:
        out = []
        for f in sorted(glob.glob(os.path.join(src, 'importq', '*.json')) or glob.glob(os.path.join(src, '*.json'))):
            x = json.load(open(f)); v = x['data'] if isinstance(x, dict) and isinstance(x.get('data'), dict) else x
            out.append({'key': os.path.basename(f)[:-5], **v})
        return out, f'export {src}'
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='page_importq'").fetchone():
        return [], 'no page_importq mirror yet (export importq and run tools/sync_pagedb.py, or pass the export folder)'
    at = db.execute("SELECT synced_at FROM page_sync WHERE collection='importq'").fetchone()
    rows = db.execute('SELECT doc_key, data_json FROM page_importq').fetchall()
    return [{'key': k, **json.loads(d)} for k, d in rows], f'mirror page_importq (synced {at[0] if at else "?"})'


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    n = int(sys.argv[sys.argv.index('--n') + 1]) if '--n' in sys.argv else 9
    if '--n' in sys.argv and str(n) in args: args.remove(str(n))
    db = sqlite3.connect('file:' + DB + '?mode=ro', uri=True)
    q, src = read_queue(args[0] if args else None, db)
    q.sort(key=lambda x: (float(x.get('order') or 0), str(x.get('at') or '')))
    inv = inventory.build(db, files=True)
    db.row_factory = sqlite3.Row
    papers = {}
    for g in inv['groups']:
        for p in g['papers']:
            for f in p['f']: papers.setdefault(f, (p, g))     # any file of the paper finds it, if the paper's lead file changed
            papers[p['id']] = (p, g)
    paths = {r['id']: dict(r) for r in db.execute('SELECT id, source_path, status, parse_path, page_count, drive_file_id FROM documents')}
    drive = {}
    dp = P + 'drive_ids.csv'
    if os.path.exists(dp):
        drive = {int(r['doc_id']): r['drive_file_id'] for r in csv.DictReader(open(dp)) if r.get('doc_id', '').isdigit()}
    take, skipped = [], []
    for i, x in enumerate(q, 1):
        hit = papers.get(int(x.get('doc_id') or 0))
        if not hit:
            skipped.append({'pos': i, 'doc_id': x.get('doc_id'), 'label': x.get('label'), 'why': 'not in the inventory (documents row gone?)'}); continue
        p, g = hit
        if p['st'] == 'imported' or not p.get('pick'):
            skipped.append({'pos': i, 'doc_id': p['id'], 'label': x.get('label'), 'why': 'already imported' if p['st'] == 'imported' else (p.get('why') or p['st'])}); continue
        take.append({'pos': i, 'doc_id': p['id'], 'label': x.get('label'), 'course': g['course'], 'year_level': g['yl'],
                     **({'syllabus_version': 'pre2017'} if p.get('old') else {}),
                     'added_by': x.get('added_by'), 'at': x.get('at'),
                     'files': [{'doc_id': f, 'path': paths[f]['source_path'], 'status': paths[f]['status'], 'scan': paths[f]['parse_path'] == 'scan',
                                'pages': paths[f]['page_count'], 'drive_file_id': drive.get(f) or paths[f]['drive_file_id']} for f in p['f']]})
    res = {'source': src, 'queued': len(q), 'batch': f'b{next_batch_no()}', 'next': take[:n], 'later': len(take[n:]), 'skipped': skipped,
           'paused': 'Import is paused (owner 14 Nov: "no more importing for a while until we iron these out"). Do not start an import from this list until the owner resumes it.'}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(res, open(OUT, 'w'), indent=1, ensure_ascii=False)
    print(f'owner\'s import order: {len(q)} queued ({src})')
    print('  ' + res['paused'])
    print(f'  next batch: {res["batch"]} ({len(take[:n])} papers)')
    for t in take[:n]:
        print(f'  {t["pos"]:3d}. {t["label"]}  [{t["course"]} Y{t["year_level"]}{", old syllabus" if t.get("syllabus_version") else ""}]  ' + ', '.join(
            f'{f["path"]}{" (scan)" if f["scan"] else ""}{"" if f["drive_file_id"] else " (no Drive id)"}' for f in t['files']))
    if res['later']: print(f'  ... and {res["later"]} more after this batch')
    for s in skipped: print(f'  skip {s["pos"]:3d}. {s["label"]}: {s["why"]}')
    print(f'  -> {os.path.relpath(OUT, P)}')


if __name__ == '__main__':
    main()
