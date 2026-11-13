#!/usr/bin/env python3
"""Compare a listing of the shared exam folder with the documents table: what is new, what may have moved, what is gone.

Owner, 13 Nov: "New exams are gonna be added to this folder periodically we need a way to ... see what we actually haven't
ingested yet", and "Should we also order what's in standard and also extension one and extension two while we're scanning
anyways?" The folder is G:\\Shared drives\\CMC Resources\\Exams\\External Exams Stage 6, a school shared drive other staff
use: NEVER move, rename or reorganise anything there (the owner agreed we keep the record on our side instead). This tool only
reads a listing; it never touches the folder or the PDFs.

  python3 tools/scan_folder.py LISTING [LISTING ...]            dry run: report only (work/scan/scan_<date>_dry.json)
  python3 tools/scan_folder.py LISTING [LISTING ...] --apply    also insert the new files into documents (backup first)

LISTING is a Google Drive listing (preferred, no PC needed: JSON {"source": "google_drive", "entries": [{path, type, size,
mtimeMs, driveId, ...}]} built with the Drive connector, see IMPORT_PLAYBOOK.md "Scan via Google Drive"), a file saved from
the device `list_dir` tool (JSON: entries with name/type/size/mtimeMs/depth, or with relative paths), or a tab-separated
text file (relative path, size, mtimeMs per line). A Drive listing's file ids go into documents.drive_file_id: on new rows,
and (--apply) on recorded rows that match by path and have none yet; an existing id is never overwritten. Append @Sub/Folder when the listing was taken
of a subfolder rather than the root: `work/scan/listing_Kings.json@Kings`. How the main session produces the listing:
IMPORT_PLAYBOOK.md "New papers in the shared folder".

For each PDF in the listing:
  matched   its path (case-insensitive, as Windows is) is a documents.source_path. Nothing to do.
  new       no row has its path, and nothing looks like it: classified by tools/classify_paths.py (the stage-0 path and
            file-name rules) and, with --apply, inserted as status 'discovered' (Advanced or not yet known, as stage 0 did)
            or 'excluded' (another course, Year 10/11, or not a question paper), course / year level set, provenance
            'filename' or 'folder', ingested_at = this scan's time.
  moved?    same size and a similar file name (stem similarity >= 0.6) as a row whose own path is NOT in the listing:
            probably renamed or moved by a colleague. Reported, never merged, not inserted (--insert-held inserts it as new).
  copy?     same, but the row's own file is still there: probably a second copy. Reported, not inserted (--insert-held).
Rows whose path is under a listed folder but not in the listing are reported as missing (never changed). A listing that hit
the tool's 2,000-entry cap skips the missing check for that listing (list subfolders separately).
New files of unknown course are listed under cover_check: their cover page must be read (needs the PDF) before import.

Idempotent: a second --apply with the same listing inserts nothing (the paths now match). Every --apply copies the database
to archive/questions_before_scan_<time>.db first and records the scan in table folder_scans (id, at, listings, counts,
report path), which tools/inventory.py reads for "last scan" and "new since last scan".
QG_DB=<path> runs against another database file (tests).
"""
import argparse, datetime, difflib, json, os, re, shutil, sqlite3, sys, unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classify_paths import classify_path

P = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + '/'
DB = os.environ.get('QG_DB', '/mnt/user-data/outputs/questions.db')
OUT = P + 'work/scan/'
ROOT_WIN = r'G:\Shared drives\CMC Resources\Exams\External Exams Stage 6'
CAP = 2000          # the device list_dir tool returns at most 2,000 entries
SIM = 0.6           # file-name stem similarity for moved? / copy?
SCHEMA = """CREATE TABLE IF NOT EXISTS folder_scans(id INTEGER PRIMARY KEY, at TEXT NOT NULL, listings TEXT, files INTEGER, pdfs INTEGER,
  matched INTEGER, new INTEGER, inserted INTEGER, moved INTEGER, copies INTEGER, missing INTEGER, report TEXT)"""


# ---------------------------------------------------------------- listing adapter

def _key(p):
    """Comparison key for a relative path: '/' separators, NFC, case-folded, single spaces (Windows paths are case-insensitive).
    Characters Windows cannot hold (: * ? " < > |) count as a space: Drive for desktop shows the Drive name
    "...w: Solutions.pdf" on the PC as "...w  Solutions.pdf" (13 Nov, first Drive scan: 12 such rows)."""
    p = unicodedata.normalize('NFC', p.replace('\\', '/')).strip('/')
    p = re.sub(r'[:*?"<>|]', ' ', p)
    return re.sub(r'\s+', ' ', p).casefold()


def _entries(obj):
    """Find the entry list inside whatever the tool returned (a list, {entries: [...]}, an MCP {content: [{text}]} wrapper)."""
    if isinstance(obj, list):
        if obj and all(isinstance(x, dict) and x.get('type') == 'text' and 'text' in x for x in obj):
            return _entries(json.loads(''.join(x['text'] for x in obj)))
        return obj, {}
    if isinstance(obj, dict):
        for k in ('entries', 'items', 'files', 'children', 'result'):
            if k in obj and isinstance(obj[k], (list, dict)):
                inner, meta = _entries(obj[k])
                return inner, {**{m: obj[m] for m in obj if m != k and not isinstance(obj[m], (list, dict))}, **meta}
        if 'content' in obj:
            return _entries(obj['content'])
    raise ValueError('no list of entries found in the listing')


def _flatten(entries, base=''):
    """Nested {name, type, children} trees become a flat list with relative paths."""
    out = []
    for e in entries:
        nm = e.get('path') or e.get('relativePath') or e.get('name') or ''
        rel = (base + '/' + nm) if base and '/' not in nm.replace('\\', '/') else nm
        out.append({**e, 'path': rel})
        if isinstance(e.get('children'), list):
            out += _flatten(e['children'], rel)
    return out


def load_listing(spec, root=ROOT_WIN):
    """-> (files, meta). files: [{path, size, mtime_ms, dir}] with paths relative to the shared folder root."""
    fn, _, prefix = spec.partition('@')
    prefix = prefix.replace('\\', '/').strip('/')
    raw = open(fn, encoding='utf-8-sig').read()
    meta = {'listing': spec, 'prefix': prefix, 'format': None, 'warnings': []}
    rows = []
    try:
        obj = json.loads(raw)
    except ValueError:
        obj = None
    if obj is None:                                    # tab-separated text: path, size, mtimeMs (e.g. from `find -printf`)
        meta['format'] = 'tsv'
        for ln in raw.splitlines():
            if not ln.strip(): continue
            c = ln.split('\t')
            rows.append({'path': c[0], 'type': 'directory' if c[0].endswith(('/', '\\')) else 'file',
                         'size': int(c[1]) if len(c) > 1 and c[1].strip().isdigit() else None,
                         'mtimeMs': float(c[2]) if len(c) > 2 and re.match(r'^[\d.]+$', c[2].strip()) else None})
    else:
        ents, m = _entries(obj)
        meta['format'] = 'google_drive' if isinstance(obj, dict) and obj.get('source') == 'google_drive' else 'json'
        meta['truncated'] = bool(m.get('truncated'))
        rows = _flatten(ents)
    # absolute paths: strip the listed folder (the tool's own path field, --root, or the known shared-folder root)
    roots = [r for r in (meta.get('path'), root, ROOT_WIN) if r]
    def rel(p):
        q = p.replace('\\', '/')
        for r in roots:
            r2 = r.replace('\\', '/').rstrip('/') + '/'   # a subfolder listing's absolute paths still start at the shared root
            if _key(q).startswith(_key(r2)): return q[len(r2):]
        return q
    has_sep = any('/' in (r.get('path') or '').replace('\\', '/') for r in rows)
    if not has_sep and any('depth' in r for r in rows):
        # names only, in depth-first order with a depth per entry: rebuild the paths from a stack of folder names
        d0 = min(int(r.get('depth') or 0) for r in rows); stack = []
        for r in rows:
            d = int(r.get('depth') or 0) - d0
            if d > len(stack):
                raise ValueError(f'{fn}: entry "{r.get("name")}" at depth {d + d0} has no parent folder before it; the listing is not '
                                 'depth-first. Save a listing with relative paths instead.')
            stack = stack[:d]
            r['path'] = '/'.join(stack + [r['path']])
            if _isdir(r): stack.append(r['path'].split('/')[-1])
    files = []
    for r in rows:
        p = rel(r.get('path') or '').strip('/')
        if not p: continue
        if prefix and not _key(p).startswith(_key(prefix) + '/'): p = prefix + '/' + p
        files.append({'path': p, 'size': _int(r.get('size', r.get('sizeBytes'))), 'mtime_ms': r.get('mtimeMs', r.get('mtime')), 'dir': _isdir(r),
                      'drive_id': r.get('driveId')})
    if meta['format'] != 'google_drive' and (len(rows) >= CAP or meta.get('truncated')):   # the Drive walk has no cap
        meta['warnings'].append(f'{fn}: {len(rows)} entries, at the tool\'s {CAP}-entry cap: some files may be missing. List subfolders '
                                'separately (file@Subfolder); the missing-file check is skipped for this listing.')
        meta['capped'] = True
    dirs = {_key(f['path']) for f in files if f['dir']}
    parents = {_key(f['path']).rsplit('/', 1)[0] for f in files if '/' in f['path']}
    empty = sorted(f['path'] for f in files if f['dir'] and _key(f['path']) not in parents)
    if empty:
        meta['warnings'].append(f'{fn}: {len(empty)} empty folder(s): ' + ', '.join(empty[:5]) + (' ...' if len(empty) > 5 else '')
                                if meta['format'] == 'google_drive' else
                                f'{fn}: {len(empty)} folder(s) with nothing listed under them (empty, or below the tool\'s depth limit: '
                                'list them separately): ' + ', '.join(empty[:5]) + (' ...' if len(empty) > 5 else ''))
    meta['entries'] = len(rows)
    meta['dirs'] = len(dirs)
    return [f for f in files if not f['dir']], meta


def _isdir(r):
    t = str(r.get('type') or '').lower()
    return t in ('directory', 'dir', 'd', 'folder') or bool(r.get('isDirectory')) or (not t and str(r.get('path', '')).endswith(('/', '\\')))


def _int(v):
    try: return int(v)
    except (TypeError, ValueError): return None


# ---------------------------------------------------------------- compare

def stem(p):
    s = os.path.splitext(p.replace('\\', '/').split('/')[-1])[0].lower()
    s = re.sub(r'\s*\(\d+\)$|\s*-\s*copy$|\bcopy of\b', '', s)          # "x (1).pdf", "x - Copy.pdf"
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def compare(files, metas, docs):
    """docs: [{id, source_path, size_bytes, status, course, year_level, provenance_method, drive_file_id}] -> report dict (no writes)."""
    bykey = {_key(d['source_path']): d for d in docs}
    listed = {_key(f['path']) for f in files}
    pdfs = [f for f in files if f['path'].lower().endswith('.pdf')]
    other = [f['path'] for f in files if not f['path'].lower().endswith('.pdf')]
    # folders this run covers completely (for the missing check): each uncapped listing's prefix ('' = the whole root)
    covered = [_key(m['prefix']) for m in metas if not m.get('capped')]
    under = lambda k: any(c == '' or k.startswith(c + '/') for c in covered)
    missing = [d for k, d in bykey.items() if k not in listed and under(k)]
    miss_keys = {_key(d['source_path']) for d in missing}
    by_size = {}
    for d in docs:
        if d.get('size_bytes'): by_size.setdefault(int(d['size_bytes']), []).append(d)
    by_name = {}
    for d in docs: by_name.setdefault(stem(d['source_path']), []).append(d)
    # two recorded files can share a key (Knox "2023  Y11 MA AT1.pdf" and "2023 Y11 MA AT1.pdf" differ by one space and are
    # different files): the exact path wins over the key (13 Nov: a Drive id had gone to the wrong one of such a pair)
    exact = {unicodedata.normalize('NFC', d['source_path']).casefold(): d for d in docs}
    matched, new, held = [], [], []
    for f in sorted(pdfs, key=lambda f: f['path'].lower()):
        k = _key(f['path'])
        if k in bykey:
            matched.append({**f, 'doc': exact.get(unicodedata.normalize('NFC', f['path']).casefold(), bykey[k])}); continue
        best = None
        st = stem(f['path'])
        cands = (by_size.get(f['size']) or []) if f['size'] else []
        for d in cands + by_name.get(st, []):
            if _key(d['source_path']) == k: continue
            same_size = bool(f['size'] and d.get('size_bytes') and int(d['size_bytes']) == f['size'])
            sim = difflib.SequenceMatcher(None, st, stem(d['source_path'])).ratio()
            # size + similar name; or the identical file name when the row has no recorded size (owner uploads)
            if (same_size and sim >= SIM) or (sim == 1.0 and not d.get('size_bytes')):
                score = sim + (1 if same_size else 0)
                if not best or score > best[0]: best = (score, d, sim, same_size)
        row = {'path': f['path'], 'size': f['size'], 'mtime_ms': f['mtime_ms'], **({'drive_id': f['drive_id']} if f.get('drive_id') else {})}
        if best:
            _, d, sim, same_size = best
            gone = _key(d['source_path']) in miss_keys
            held.append({**row, 'kind': 'moved?' if gone else 'copy?', 'doc_id': d['id'], 'doc_path': d['source_path'], 'doc_status': d['status'],
                         'similarity': round(sim, 2), 'same_size': same_size,
                         'note': ('the row\'s own file is not in the listing: probably renamed or moved' if gone else
                                  'the row\'s own file is still there: probably a second copy')})
        else:
            new.append({**row, **classify_path(f['path'])})
    # Drive ids for recorded rows that have none yet (filled by --apply); a different recorded id is only reported
    same = lambda m: not (m.get('size') and m['doc'].get('size_bytes')) or int(m['doc']['size_bytes']) == m['size']   # size must agree when both known
    ids_fill = [{'doc_id': m['doc']['id'], 'drive_id': m['drive_id']} for m in matched if m.get('drive_id') and not m['doc'].get('drive_file_id') and same(m)]
    ids_differ = [{'doc_id': m['doc']['id'], 'path': m['path'], 'recorded': m['doc']['drive_file_id'], 'listed': m['drive_id']}
                  for m in matched if m.get('drive_id') and m['doc'].get('drive_file_id') and m['doc']['drive_file_id'] != m['drive_id']]
    return {
        'totals': {'entries': sum(m.get('entries', 0) for m in metas), 'files': len(files), 'pdfs': len(pdfs), 'not_pdf': len(other),
                   'matched': len(matched), 'new': len(new), 'moved': sum(h['kind'] == 'moved?' for h in held),
                   'copies': sum(h['kind'] == 'copy?' for h in held), 'missing': len(missing),
                   'new_by_status': _count(new, 'status'), 'new_by_course': _count(new, 'course'),
                   'drive_ids_to_fill': len(ids_fill), 'drive_ids_differ': len(ids_differ)},
        'new': new, 'held': held, 'drive_ids_to_fill': ids_fill, 'drive_ids_differ': ids_differ,
        'missing': [{'doc_id': d['id'], 'path': d['source_path'], 'status': d['status'], 'maybe_moved_to': next((h['path'] for h in held if h['doc_id'] == d['id']), None),
                     'note': 'owner upload, may never have been in the shared folder' if str(d.get('provenance_method') or '').startswith('owner upload') else ''}
                    for d in sorted(missing, key=lambda d: d['source_path'])],
        'cover_check': [n['path'] for n in new if n['course'] == 'unknown'],
        'not_pdf': other[:200],
        'covered': [m['prefix'] or '(whole folder)' for m in metas if not m.get('capped')],
    }


def _count(rows, k):
    c = {}
    for r in rows: c[str(r[k])] = c.get(str(r[k]), 0) + 1
    return dict(sorted(c.items()))


COLS = ['source_path', 'drive_file_id', 'size_bytes', 'task_type', 'course', 'classification_method', 'year_level', 'school', 'year', 'natural_key',
        'provenance_method', 'bundled_solutions', 'syllabus_version', 'status', 'failure_reason', 'ingested_at']


def apply(db, rep, at, insert_held=False):
    """Insert the new rows (and, with insert_held, the held ones) and log the scan. Returns the number inserted."""
    rows = list(rep['new'])
    if insert_held:
        for h in rep['held']:
            r = {**h, **classify_path(h['path'])}
            r['failure_reason'] = ((r.get('failure_reason') or '') + f'; {h["kind"]} doc {h["doc_id"]} ({h["doc_path"]})').lstrip('; ')
            rows.append(r)
    n = 0
    for r in rows:
        v = {**r, 'source_path': r['path'], 'drive_file_id': r.get('drive_id'), 'size_bytes': r['size'], 'ingested_at': at}
        # UNIQUE(source_path) plus the case-insensitive check above: a re-run inserts nothing
        if db.execute('SELECT 1 FROM documents WHERE source_path=? COLLATE NOCASE', (v['source_path'],)).fetchone(): continue
        db.execute(f'INSERT INTO documents ({",".join(COLS)}) VALUES ({",".join("?" * len(COLS))})', [v.get(c) for c in COLS])
        n += 1
    for x in rep.get('drive_ids_to_fill', []):          # never overwrites a recorded id
        db.execute('UPDATE documents SET drive_file_id=? WHERE id=? AND drive_file_id IS NULL', (x['drive_id'], x['doc_id']))
    return n


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('listings', nargs='+', help='listing file(s), optionally file@Subfolder')
    ap.add_argument('--apply', action='store_true', help='insert new files into documents (default: dry run)')
    ap.add_argument('--insert-held', action='store_true', help='also insert moved? / copy? files as new rows')
    ap.add_argument('--root', default=ROOT_WIN, help='absolute path of the shared folder as the listing writes it')
    ap.add_argument('--out', default=OUT)
    a = ap.parse_args(argv)
    files, metas = [], []
    for spec in a.listings:
        f, m = load_listing(spec, a.root); files += f; metas.append(m)
    seen, uniq = set(), []
    for f in files:                                   # overlapping listings (root + a subfolder) list a file twice
        k = f.get('drive_id') or _key(f['path'])      # a Drive id is unique: two files whose names differ by a space stay two
        if k not in seen: seen.add(k); uniq.append(f)
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    docs = [dict(r) for r in db.execute('SELECT id, source_path, size_bytes, status, course, year_level, provenance_method, drive_file_id FROM documents')]
    rep = compare(uniq, metas, docs)
    now = datetime.datetime.now().astimezone()
    at = now.isoformat(timespec='seconds')
    rep = {'at': at, 'db': DB, 'applied': bool(a.apply), 'root': a.root,
           'listings': [{k: m.get(k) for k in ('listing', 'prefix', 'format', 'entries', 'dirs', 'capped')} for m in metas],
           'warnings': [w for m in metas for w in m['warnings']], **rep}
    os.makedirs(a.out, exist_ok=True)
    name = f'scan_{now:%Y-%m-%d}' + ('' if a.apply else '_dry')
    out = os.path.join(a.out, name + '.json')
    if a.apply and os.path.exists(out): out = os.path.join(a.out, f'{name}_{now:%H%M%S}.json')
    if a.apply:
        bdir = P + 'archive/' if 'QG_DB' not in os.environ else os.path.dirname(os.path.abspath(DB)) + '/'   # tests back up beside their copy
        os.makedirs(bdir, exist_ok=True)
        bak = bdir + f'questions_before_scan_{now:%Y%m%d_%H%M%S}.db'
        k = 1
        while os.path.exists(bak):                    # review 13 Nov: two runs in one second must not overwrite the first backup
            k += 1; bak = bdir + f'questions_before_scan_{now:%Y%m%d_%H%M%S}_{k}.db'
        src = sqlite3.connect(DB); dst = sqlite3.connect(bak); src.backup(dst); dst.close(); src.close()
        rep['backup'] = bak
        db.execute(SCHEMA)
        rep['inserted'] = apply(db, rep, at, a.insert_held)
        t = rep['totals']
        db.execute('INSERT INTO folder_scans(at, listings, files, pdfs, matched, new, inserted, moved, copies, missing, report) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                   (at, json.dumps([m['listing'] for m in rep['listings']]), t['files'], t['pdfs'], t['matched'], t['new'], rep['inserted'],
                    t['moved'], t['copies'], t['missing'], os.path.relpath(out, P)))
        db.commit()
    json.dump(rep, open(out, 'w'), indent=1, ensure_ascii=False)
    t = rep['totals']
    print(f'scan {"APPLIED" if a.apply else "dry run"}: {t["pdfs"]} PDFs listed ({t["not_pdf"]} other files) · {t["matched"]} already recorded · '
          f'{t["new"]} new · {t["moved"]} moved? · {t["copies"]} copy? · {t["missing"]} recorded but not listed')
    if t['new']: print(f'  new by status {t["new_by_status"]}, by course {t["new_by_course"]}')
    if t['drive_ids_to_fill'] or t['drive_ids_differ']:
        print(f'  Drive ids: {t["drive_ids_to_fill"]} recorded row(s) get one{" with --apply" if not a.apply else ""}; {t["drive_ids_differ"]} differ from the recorded id (reported, not changed)')
    if rep['cover_check']: print(f'  {len(rep["cover_check"])} new file(s) of unknown course need a cover-page check (cover_check in the report)')
    for h in rep['held'][:10]: print(f'  {h["kind"]:7s} {h["path"]}  ~ doc {h["doc_id"]} {h["doc_path"]} (similarity {h["similarity"]})')
    for w in rep['warnings']: print('  WARN', w)
    if a.apply: print(f'  inserted {rep["inserted"]} row(s); backup {rep["backup"]}')
    print(f'  report: {os.path.relpath(out, P)}')
    return rep


if __name__ == '__main__':
    main()
