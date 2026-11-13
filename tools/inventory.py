#!/usr/bin/env python3
"""Every paper in the shared folder, grouped for the Processes page's "Papers" section (owner 13 Nov: "Should we also order
what's in standard and also extension one and extension two while we're scanning anyways?" and "Can the import queue be
dynamic, me choosing which set of papers to import next? We can always [build the] framework for the courses standard
extension and extension two [later] right?").

  python3 tools/inventory.py            write site/data/inventory.json and print the counts
  python3 tools/inventory.py --print    counts only, write nothing

Read-only on the database. Groups: course (advanced / ext1 / ext2 / standard / unknown) x year level (12 / 11 / ?), and in
each group one entry per PAPER (a question file plus its solutions file, or one combined file), sorted by school then year.
Each paper: id (its question file's documents.id), l (label, only when it is not "<y> <s> <t>" or "<y> NESA HSC"), s school,
y year, t task, st state, n files, and flags sol (solutions present), scan, new, pick (can be queued), why (reason it can't).
Papers are formed with the same naming rules as tools/import_manifest.py (tools/classify_paths.py: school_of, year_of,
task_of, kind_of); the Year 12 Advanced import list work/import/papers.json (id + separate solutions id) wins where it applies.
State of a paper:
  imported       a file has questions in the bank
  waiting        a file is discovered / pending (or parsed / tagged with no questions yet), and nothing below blocks it
  out_of_course  every file is excluded and the course is Extension 1, Extension 2 or Standard
  out_of_scope   excluded for another reason (Year 11, not a question paper, before 2019: old 2 Unit syllabus "excluded for
                 now", solutions only), course Advanced or not known
  other          duplicate_file / skipped / failed
Only waiting Advanced papers outside Year 11 can be ticked on the page ("pick": 1). Standard / Ext 1 / Ext 2 show their counts but need
course setup (topics, dot points, difficulty references) before they can be imported.
"new" = inserted by the latest folder scan (table folder_scans, written by tools/scan_folder.py --apply).
For the page's "Rescan drive" (owner 13 Nov: "Where is the button to rescan the drive?") the json also carries root_drive_id
(the shared folder in Google Drive), scan_skip (folders not walked), files_url and rules (tools/classify_paths.py RULES, so the
page classifies a new Drive file exactly as the tools do). Every recorded file (folder, name, size, Drive id) goes to a separate
site/data/inventory_files.json (files_url), which the page fetches only for Rescan drive: with the 13 Nov Drive rescan's 1,684
more files it would have taken inventory.json past 600 KB on every Processes load (CODE_HEALTH rule 6).
Cost: IMPORT_PLAYBOOK.md and RESUME.md record no per-paper import cost yet (13 Nov), so COST_PER_PAPER is None and the page
shows none. Set it (e.g. '≈ 0.4M tokens') when one is recorded there.
"""
import collections, datetime, json, os, re, sqlite3, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classify_paths import school_of, year_of, task_of, kind_of, as_manifest_row, RULES

P = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + '/'
DB = os.environ.get('QG_DB', '/mnt/user-data/outputs/questions.db')
OUT = P + 'site/data/inventory.json'
FILES_URL = 'data/inventory_files.json'     # beside OUT; the page fetches it only for Rescan drive
PAPERS = P + 'work/import/papers.json'
COST_PER_PAPER = None
# The shared folder in Google Drive (G:\\Shared drives\\CMC Resources\\Exams\\External Exams Stage 6; drive_ids.csv lists it as
# the parent of the loose files at its root). The page's "Rescan drive" button (owner 13 Nov: "Where is the button to rescan
# the drive?") walks it READ-ONLY with the viewer's Google Drive connector; the id lives here, never in the page.
ROOT_DRIVE_ID = '1yItEV6bFpGyrJDpDrAle0RgPKqsfjTOZ'
SCAN_SKIP = ['Claude outputs']      # our own folder inside it (csv/png exports, not exam papers): not walked
# (key, name, short name, ready). ready = the bank has this course's topics, dot points and difficulty references, so its
# papers can be queued. Only Advanced so far (owner 13 Nov: "We can always [build the] framework for the courses standard
# extension and extension two [later] right?"). The page takes names and readiness from here, never hard-codes a course.
COURSES = [('advanced', 'Mathematics Advanced', 'Advanced', True), ('ext1', 'Mathematics Extension 1', 'Extension 1', False),
           ('ext2', 'Mathematics Extension 2', 'Extension 2', False), ('standard', 'Mathematics Standard', 'Standard', False),
           ('unknown', 'Course not known yet', 'Course not known', False)]
SETUP = 'needs course setup (topics, dot points, difficulty references)'
UNKNOWN = 'course not known from the file name: a cover-page check sorts these'
YLS = ['12', '11', '?']
STATES = ['imported', 'waiting', 'out_of_course', 'out_of_scope', 'other']


def name_year(path):
    """The first year written in the file name itself ("H1 Adv 2023 (for 2024 HSC)" -> 2023), or None."""
    m = re.search(r'(?<!\d)(20\d\d)(?!\d)', os.path.basename(path.replace('\\', '/')))
    return int(m.group(1)) if m else None


def yl_of(d):
    return str(d['year_level']) if d['year_level'] in (11, 12) else '?'


def build(db, files=False):
    """files=True adds 'f' (every documents.id in the paper) to each paper, for tools/import_next.py; never written to the json."""
    db.row_factory = sqlite3.Row
    docs = {r['id']: dict(r) for r in db.execute('SELECT id, source_path, status, course, year_level, task_type, school, year, display_label, '
                                                   'school_formal, task_code, failure_reason, page_count, parse_path, ingested_at, '
                                                   'size_bytes, drive_file_id FROM documents')}
    has_q = {r[0] for r in db.execute('SELECT DISTINCT document_id FROM questions')}
    last = None
    if db.execute("SELECT 1 FROM sqlite_master WHERE name='folder_scans'").fetchone():
        r = db.execute('SELECT at, pdfs, new, inserted, moved, copies, missing, report FROM folder_scans ORDER BY id DESC LIMIT 1').fetchone()
        if r: last = dict(r)
    new_ids = {i for i, d in docs.items() if last and d['ingested_at'] == last['at']}

    # 1. papers fixed by the import list (Year 12 Advanced): question doc + its separate solutions doc
    papers, taken = [], set()
    bypath = {d['source_path']: i for i, d in docs.items()}
    if os.path.exists(PAPERS):
        for x in json.load(open(PAPERS)):
            ids = [x['id']] + ([x['sol']] if x.get('sol') else []) + [bypath[f] for f in x.get('files', []) if f in bypath]
            ids = [i for i in dict.fromkeys(ids) if i in docs and i not in taken]
            if ids:
                papers.append({'ids': ids, 'label': x.get('label')}); taken.update(ids)
    # 2. everything else: by (course, year level, year, school, task) with the import_manifest naming rules
    groups = collections.OrderedDict()
    loose, split_off = [], set()
    for i, d in sorted(docs.items()):
        if i in taken: continue
        m = as_manifest_row(d)
        y, s, t = year_of(m), d['school_formal'] or school_of(m), d['task_code'] or task_of(m)
        d['_y'], d['_s'], d['_t'], d['_k'] = y, s, t, kind_of(m)
        if y and s != '?' and t != '?':
            groups.setdefault((d['course'], yl_of(d), y, s, t), []).append(i)
        else:
            loose.append(i)
    # Review 13 Nov: documents.year can put two different exams under one key ("H1 Adv 2023 (for 2024 HSC)" and "H1 Adv 2024",
    # or "2024 Y12 MA AT1 solns" recorded as 2023, which then joined the 2023 paper). Files whose names carry different years
    # are different papers: split them, and move a split-off piece to the year its name gives (the "for 20xx HSC" rule).
    for k in list(groups):
        parts = collections.OrderedDict()
        for i in groups[k]: parts.setdefault(name_year(docs[i]['source_path']), []).append(i)
        named = [y for y in parts if y]
        if len(named) < 2: continue
        home = k[2] if k[2] in named else named[0]
        if None in parts: parts[home] = parts.pop(None) + parts.get(home, [])
        groups[k] = parts.pop(home)
        for ry, ids in parts.items():
            ny = {year_of(as_manifest_row({**docs[i], 'year': ''})) for i in ids}
            k2 = (k[0], k[1], ny.pop() if len(ny) == 1 and None not in ny else k[2], k[3], k[4])
            if k2 != k and k2 in groups and {name_year(docs[i]['source_path']) for i in groups[k2]} <= {ry, None}: groups[k2] += ids
            else: groups[k2 + (ry,)] = ids; split_off.update(ids)
    # a file with no year level joins the one paper of the same course / year / school / task, if there is exactly one
    for k in [k for k in groups if k[1] == '?']:
        same = [g for g in groups if g[1] != '?' and (g[0], g[2], g[3], g[4]) == (k[0], k[2], k[3], k[4])]
        if len(same) == 1: groups[same[0]] += groups.pop(k)
    # loose files (school, year or task unknown): one paper per question file; a solutions file joins the question file
    # with the same name once solution words are removed, in the same folder
    def base(p): return re.sub(r'\b(with |w |and |& )?(solutions?|solns?|sols|marking (guidelines?|criteria)|mg|answers)\b', '', os.path.splitext(p)[0].lower()).strip(' -_')
    lg = collections.OrderedDict()
    for i in loose: lg.setdefault((docs[i]['course'], base(docs[i]['source_path'])), []).append(i)
    # a file filed twice (e.g. under "HSC 2022/External Schools" and "Trial Exams") joins the import-list paper with its key
    def key_of(i):
        d = docs[i]; m = as_manifest_row(d)
        return (d['course'], yl_of(d), year_of(m), d['school_formal'] or school_of(m), d['task_code'] or task_of(m))
    fixed = {}
    for p in papers:
        for i in p['ids']: fixed.setdefault(key_of(i), p)
    def nys(ids): return {name_year(docs[i]['source_path']) for i in ids} - {None}
    for k in list(groups):
        if k not in fixed: continue
        if len(nys(fixed[k]['ids']) | nys(groups[k])) <= 1: fixed[k]['ids'] += groups.pop(k); continue
        # names give another year (review 13 Nov: "2024 Y12 MA AT1 solns" recorded as 2023): the paper of that year, else its own
        ny = {year_of(as_manifest_row({**docs[i], 'year': ''})) for i in groups[k]}
        k2 = (*k[:2], ny.pop() if len(ny) == 1 and None not in ny else None, *k[3:])
        if k2 in fixed and len(nys(fixed[k2]['ids']) | nys(groups[k])) <= 1: fixed[k2]['ids'] += groups.pop(k)
        else: split_off.update(groups[k])
    papers += [{'ids': ids} for ids in list(groups.values()) + list(lg.values())]

    out = {(c, y): {'course': c, 'yl': y, 'counts': dict.fromkeys(STATES + ['new', 'papers', 'files'], 0), 'papers': []} for c, *_ in COURSES for y in YLS}
    for p in papers:
        fs = [docs[i] for i in p['ids']]
        q = [f for f in fs if f.get('_k', kind_of(as_manifest_row(f))) != 'solutions']
        prim = (q or fs)[0]
        for f in fs:
            if '_y' not in f:
                m = as_manifest_row(f); f['_y'], f['_s'], f['_t'] = year_of(m), f['school_formal'] or school_of(m), f['task_code'] or task_of(m)
        course = prim['course'] if prim['course'] != 'unknown' else next((f['course'] for f in fs if f['course'] != 'unknown'), 'unknown')
        yl = next((yl_of(f) for f in [prim] + fs if yl_of(f) != '?'), '?')
        y, s, t = prim['_y'], prim['_s'], prim['_t']
        sts = {f['status'] for f in fs}
        why = ''
        if any(f['id'] in has_q for f in fs):
            st = 'imported'
        elif sts & {'discovered', 'pending', 'parsed', 'tagged'}:
            st = 'waiting'
            if course in ('ext1', 'ext2', 'standard'): st, why = 'out_of_course', ''
            elif y and y < 2019: st, why = 'out_of_scope', 'before 2019 (old 2 Unit syllabus): excluded for now'
            elif not q: st, why = 'out_of_scope', 'solutions only: question paper not found'
            elif re.search(r'12ME|\bExt(ension)? ?1\b|\bMX1\b', ' '.join(os.path.basename(f['source_path']) for f in fs)):
                st, why = 'out_of_scope', 'Extension 1 paper (file name)'      # the same rule as tools/import_manifest.py
        elif sts <= {'excluded'}:
            if course in ('ext1', 'ext2', 'standard'): st = 'out_of_course'
            else:
                st = 'out_of_scope'
                fr = ' '.join(f['failure_reason'] or '' for f in fs).lower()
                why = ('not a question paper' if 'not a question paper' in fr else
                       f'Year {yl}: outside the import scope (Year 12)' if yl in ('11',) else
                       (fs[0]['failure_reason'] or 'excluded'))
        else:
            st = 'other'
            why = '; '.join(sorted({f['status'] + (': ' + f['failure_reason'] if f['failure_reason'] else '') for f in fs if f['status'] not in ('discovered', 'excluded')}))[:120]
        label = prim['display_label'] or p.get('label')
        if not label and split_off & set(p['ids']):     # split from a paper of the same name: its file name tells them apart
            label = os.path.splitext(os.path.basename(prim['source_path']))[0][:70]
        if not label:
            if t == 'HSC' and y: label = f'{y} NESA HSC'
            elif y and s != '?' and t != '?': label = f'{y} {s} {t}'
            else: label = os.path.splitext(os.path.basename(prim['source_path']))[0][:70]
        new = int(any(f['id'] in new_ids for f in fs))
        dflt = (f'{y} NESA HSC' if t == 'HSC' else f'{y} {s} {t}') if y and s != '?' and t != '?' else None
        e = {'id': prim['id'], **({} if label == dflt else {'l': label}), 's': s if s != '?' else '', 'y': y, 't': t if t != '?' else '', 'st': st, 'n': len(fs)}
        if any(f.get('_k') in ('solutions', 'combined') or kind_of(as_manifest_row(f)) in ('solutions', 'combined') for f in fs): e['sol'] = 1
        if prim['parse_path'] == 'scan': e['scan'] = 1
        if new: e['new'] = 1
        if why: e['why'] = why
        if files: e['f'] = [f['id'] for f in fs]
        # Year 11 stays out of the queue (owner 13 Nov: "Year 11 papers leave alone for now, would like to finalise Y12 first")
        if st == 'waiting' and course == 'advanced' and yl != '11': e['pick'] = 1
        if st == 'waiting' and course == 'unknown': e['why'] = 'course not known: cover page to check'
        g = out[(course if course in dict((c, 1) for c, *_ in COURSES) else 'unknown', yl)]
        g['papers'].append(e)
        g['counts'][st] += 1; g['counts']['new'] += new; g['counts']['papers'] += 1; g['counts']['files'] += len(fs)
    for g in out.values():
        g['papers'].sort(key=lambda e: (e['s'] or '~', -(e['y'] or 0), e['t'], e.get('l', '')))
    total = collections.Counter()
    for g in out.values():
        for k, v in g['counts'].items(): total[k] += v
    assert total['files'] == len(docs), (total['files'], len(docs))
    return {
        'built': datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
        'last_scan': last, 'docs': len(docs), 'docs_with_questions': len(has_q & set(docs)), 'totals': dict(total),
        'courses': [{'key': c, 'name': n, 'short': sh, 'ready': r, **({} if r else {'note': UNKNOWN if c == 'unknown' else SETUP})} for c, n, sh, r in COURSES],
        'cost_per_paper': COST_PER_PAPER,
        'groups': [g for g in out.values() if g['counts']['papers']],
        'root_drive_id': ROOT_DRIVE_ID, 'scan_skip': SCAN_SKIP,
        'files_url': FILES_URL, 'files': known_files(docs.values()),     # main() writes 'files' to FILES_URL, not into OUT
        'rules': RULES,
    }


def known_files(docs):
    """Every recorded file, for the page's Drive rescan to tell new files from known ones: {dirs: [folder paths],
    f: [[dir index, file name, size in bytes or null, Drive file id or ""], ...]}. Folders are stored once (the paths share them)."""
    dirs, f = {}, []
    for d in sorted(docs, key=lambda d: d['source_path'].lower()):
        p = d['source_path'].replace('\\', '/')
        folder, _, name = p.rpartition('/')
        f.append([dirs.setdefault(folder, len(dirs)), name, d.get('size_bytes'), d.get('drive_file_id') or ''])
    return {'dirs': list(dirs), 'f': f}


def table(inv):
    rows = [f'{"course":9s} {"yl":3s} {"papers":>6s} {"imported":>8s} {"waiting":>7s} {"new":>4s} {"out_crs":>7s} {"out_scope":>9s} {"other":>5s} {"files":>5s}']
    for g in inv['groups']:
        c = g['counts']
        rows.append(f'{g["course"]:9s} {g["yl"]:3s} {c["papers"]:6d} {c["imported"]:8d} {c["waiting"]:7d} {c["new"]:4d} {c["out_of_course"]:7d} {c["out_of_scope"]:9d} {c["other"]:5d} {c["files"]:5d}')
    t = inv['totals']
    rows.append(f'{"total":9s} {"":3s} {t["papers"]:6d} {t["imported"]:8d} {t["waiting"]:7d} {t["new"]:4d} {t["out_of_course"]:7d} {t["out_of_scope"]:9d} {t["other"]:5d} {t["files"]:5d}')
    return '\n'.join(rows)


def main():
    db = sqlite3.connect('file:' + DB + '?mode=ro', uri=True)
    inv = build(db)
    print(table(inv))
    ls = inv['last_scan']
    print('last folder scan: ' + (f'{ls["at"]} ({ls["inserted"]} new)' if ls else 'none yet'))
    if '--print' in sys.argv: return
    out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else OUT
    files = {'built': inv['built'], **inv.pop('files')}
    fout = os.path.join(os.path.dirname(out), os.path.basename(FILES_URL))
    for path, obj in ((out, inv), (fout, files)):
        s = json.dumps(obj, ensure_ascii=False, separators=(',', ':'))
        old = open(path).read() if os.path.exists(path) else None
        if old:   # unchanged apart from the build time: leave the file alone (so the publish set does not list it)
            o = json.loads(old); o.pop('built', None); n = json.loads(s); n.pop('built', None)
            if o == n: print(f'{os.path.relpath(path, P)} unchanged'); continue
        open(path, 'w').write(s)
        print(f'wrote {os.path.relpath(path, P)} ({len(s):,} bytes)')


if __name__ == '__main__':
    main()
