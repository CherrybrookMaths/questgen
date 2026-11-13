#!/usr/bin/env python3
"""Build a listing of the shared exam folder from Google Drive connector results, for tools/scan_folder.py. No PC needed.

Owner, 13 Nov: "Where is the button to rescan the drive?" The page cannot read the school's shared drive, so a rescan is a
Claude task: walk the folder with the Drive connector (read-only: search_files only), then run scan_folder.py on the
listing. IMPORT_PLAYBOOK.md "Scan via Google Drive (no PC)" has the steps. Nothing here writes to Drive.

  python3 tools/drive_listing.py add PAGE.json [PAGE.json ...]   add saved search_files results (JSON {files: [...]})
  python3 tools/drive_listing.py next [N]                       print the next query: up to N (default 40) folders not yet listed
  python3 tools/drive_listing.py done                           mark the folders of the last `next` as listed (after its last page)
  python3 tools/drive_listing.py build [OUT]                    write work/scan/drive_listing_<date>.json (default OUT)

State lives in work/scan/drive_walk_<date>/state.json (items by Drive id, folders listed), so each day's walk starts fresh. Lessons from the first walk (13 Nov):
  - Always pass orderBy "modifiedTime desc". Without it, a query over many parents is ranked by relevance and its pages
    repeat and drop items (the first walk missed 56 Kings files that way until every folder was re-listed with orderBy).
  - A result over ~50 KB is saved to a file by the tool; a smaller one comes back inline: save it to a file and `add` it.
  - A "/" or "\\" inside a Drive name becomes a space in the path (Drive for desktop shows "w/ Solutions" as "w  Solutions"
    on the PC); the original name is kept as driveName.
"""
import datetime, json, os, re, sys

P = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + '/'
ROOT_ID = '1yItEV6bFpGyrJDpDrAle0RgPKqsfjTOZ'          # "External Exams Stage 6"
SHARED_DRIVE = '1RtOEps_I-vXw0s3fi_VNMaZRHu6d3ldVei8'  # "CMC Resources"
ROOT_WIN = r'G:\Shared drives\CMC Resources\Exams\External Exams Stage 6'
STATE = os.environ.get('QG_WALK') or P + f'work/scan/drive_walk_{datetime.date.today():%Y-%m-%d}/state.json'   # one walk per day
FOLDER = 'application/vnd.google-apps.folder'


def load():
    if os.path.exists(STATE): return json.load(open(STATE))
    return {'items': {}, 'listed': [], 'last_next': []}


def save(st):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    json.dump(st, open(STATE, 'w'))


def add(st, fns):
    for fn in fns:
        d = json.load(open(fn))
        fs = d.get('files', [])
        for f in fs:
            st['items'][f['id']] = {k: f.get(k) for k in ('id', 'title', 'mimeType', 'parentId', 'fileSize', 'modifiedTime', 'createdTime')}
        print(f'{fn}: {len(fs)} item(s)' + ('; more pages: pass nextPageToken with the same query' if d.get('nextPageToken') else '; last page'))


def pending(st):
    listed = set(st['listed'])
    return [i for i in [ROOT_ID] + [i for i, f in st['items'].items() if f['mimeType'] == FOLDER] if i not in listed]


def seg(t): return re.sub(r'[/\\]', ' ', t)


def path(st, i):
    it, t = st['items'], []
    while i in it: t.append(seg(it[i]['title'])); i = it[i]['parentId']
    return '/'.join(reversed(t)) if i == ROOT_ID else None


def ms(t): return int(datetime.datetime.fromisoformat(t.replace('Z', '+00:00')).timestamp() * 1000) if t else None


def build(st, out):
    left = pending(st)
    if left: sys.exit(f'{len(left)} folder(s) not listed yet: run `next` and add their pages first')
    ents = []
    for i, f in st['items'].items():
        p = path(st, i)
        if p is None: continue                                   # not under the folder (a stray result)
        d = f['mimeType'] == FOLDER
        e = {'path': p, 'type': 'directory' if d else 'file', 'size': None if d or not f.get('fileSize') else int(f['fileSize']),
             'mtimeMs': ms(f.get('modifiedTime')), 'modifiedTime': f.get('modifiedTime'), 'createdTime': f.get('createdTime'),
             'driveId': i, 'mimeType': f['mimeType']}
        if seg(f['title']) != f['title']: e['driveName'] = f['title']
        ents.append(e)
    ents.sort(key=lambda e: e['path'].lower())
    doc = {'source': 'google_drive', 'root': ROOT_WIN, 'rootFolderId': ROOT_ID, 'sharedDriveId': SHARED_DRIVE,
           'listedAt': datetime.datetime.now().astimezone().isoformat(timespec='minutes'), 'separator': '/', 'entries': ents}
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(doc, open(out, 'w'), indent=0, ensure_ascii=False)
    n = sum(e['type'] == 'file' for e in ents)
    print(f'wrote {os.path.relpath(out, P)}: {n} files ({sum(e["path"].lower().endswith(".pdf") for e in ents)} PDFs), {len(ents) - n} folders')


def main(a):
    st = load()
    if not a or a[0] not in ('add', 'next', 'done', 'build'): sys.exit(__doc__)
    if a[0] == 'add': add(st, a[1:]); save(st)
    elif a[0] == 'next':
        ids = pending(st)[:int(a[1]) if len(a) > 1 else 40]
        st['last_next'] = ids; save(st)
        if not ids: print('every folder is listed: run `build`'); return
        print(f'{len(pending(st))} folder(s) left. search_files with excludeContentSnippets true, pageSize 100, orderBy "modifiedTime desc", query:')
        print(' or '.join(f"parentId = '{i}'" for i in ids))
    elif a[0] == 'done':
        st['listed'] += st['last_next']; n = len(st['last_next']); st['last_next'] = []; save(st)
        print(f'marked {n} folder(s) listed; {len(pending(st))} left (new subfolders included)')
    else:
        build(st, a[1] if len(a) > 1 else P + f'work/scan/drive_listing_{datetime.date.today():%Y-%m-%d}.json')


if __name__ == '__main__':
    main(sys.argv[1:])
