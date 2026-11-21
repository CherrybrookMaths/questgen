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
y year, t task, st status (STATUSES), n files, and flags sol (solutions present), scan, new, old, placed (by the owner), why
(a reason of its own, else STATUS_TEXT[st]); a needs_check paper also has f (file ids) and p (paths).
Papers are formed with the same naming rules as tools/import_manifest.py (tools/classify_paths.py: school_of, year_of,
task_of, kind_of); the Year 12 Advanced import list work/import/papers.json (id + separate solutions id) wins where it applies.
Status of a paper: exactly one of STATUSES below, with one reason (STATUS_TEXT, or a 'why' of its own), owner 14 Nov ("there
seems to be some inconsistencies in paper numbers"): imported / ready_current / ready_old (Advanced Year 12; old = before 2020,
old 2 Unit, syllabus_version 'pre2017') / needs_check (course, year level or year not known) / held_y11 (owner 13 Nov: "Year 11
papers leave alone for now") / held_course (Standard, Extension 1, Extension 2: course setup first) / not_in_scope / duplicate.
Rules: the active path rules (tools/classify_paths.py RULES, plus RULES_PROPOSED once the owner pressed Accept in Needs a check,
work/rules_accepted.json). Owner answers in Needs a check (page db paperfix, mirror page_paperfix) win over every rule.
Lanes: tools/batches.py assigns every ready paper to a fixed numbered batch of 9 once (work/batches.json); the json carries them.
"new" = first seen after the baseline scan (BASELINE_SCAN, 13 Nov 8:42 pm).
For the page's "Rescan drive" (owner 13 Nov: "Where is the button to rescan the drive?") the json also carries root_drive_id
(the shared folder in Google Drive), scan_skip (folders not walked), files_url and rules (tools/classify_paths.py RULES, so the
page classifies a new Drive file exactly as the tools do). Every recorded file (folder, name, size, Drive id) goes to a separate
site/data/inventory_files.json (files_url), which the page fetches only for Rescan drive: with the 13 Nov Drive rescan's 1,684
more files it would have taken inventory.json past 600 KB on every Processes load (CODE_HEALTH rule 6).
Cost: measured 17 Nov on Batch 8 through the Anthropic API (tools/api_import.py; IMPORT_PLAYBOOK "Import through the API"):
US$0.88-5.19 a paper, mean US$2.83 (school tasks of 30-35 marks about US$1-3.6, 100-mark trials US$4.2-5.2). The page shows the
range; a number, or [lo, hi] in US$.
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import collections, datetime, json, os, re, sqlite3, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classify_paths import school_of, year_of, task_of, kind_of, as_manifest_row, classify_path, RULES, RULES_PROPOSED, with_proposed, active_rules

P = paths.P
DB = paths.DBS
OUT = P + 'site/data/inventory.json'
FILES_URL = 'data/inventory_files.json'     # beside OUT; the page fetches it only for Rescan drive
PAPERS = paths.S + 'work/import/papers.json'
HELD = paths.S + 'work/scan/held.json'      # tools/scan_folder.py --apply writes it
def cost_per_paper():
    """[lo, hi] US$ per paper from the measured batches (tools/costs.py -> site/data/costs.json), not a typed-in number (owner 21 Nov:
    "make sure there's no hanging numbers anywhere which can go stale"). Batch 8 (owner 17 Nov: "I want to do batch 8 via the api so we
    can get a cost estimate") was the first measured; every batch since adds to it. None until a batch has run through the API."""
    import costs
    pp = costs.build().get('per_paper')
    return [pp['lo'], pp['hi']] if pp else None
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
COURSE_KEYS = [c for c, *_ in COURSES]
READY = [c for c, _, _, r in COURSES if r]
OFF_COURSES = [c for c in COURSE_KEYS if c not in READY and c != 'unknown']
# ONE status per paper (owner 14 Nov: "there seems to be some inconsistencies in paper numbers"). Every count on the page is a
# count of these, in papers (files only as a secondary figure); the summary's four numbers add up to the folder total.
STATUSES = ['imported', 'ready_current', 'ready_old', 'needs_check', 'held_y11', 'held_course', 'not_in_scope', 'duplicate']
STATUS_TEXT = {
    'imported': 'in the bank',
    'ready_current': 'ready to import, current syllabus',
    'ready_old': 'ready to import, old syllabus (2 Unit, before 2020)',
    'needs_check': 'year or course not known yet',
    # owner 13 Nov: "Year 11 papers leave alone for now, would like to finalise Y12 first"
    'held_y11': 'held until Year 12 is finished (your 13 Nov ruling)',
    'held_course': 'needs course setup (topics, dot points, difficulty references)',
    'not_in_scope': 'not in scope',
    'duplicate': 'a copy of another paper',
}
# 'New' = first seen after this scan (the first full Drive scan, 13 Nov 8:42 pm): papers a later scan adds (0 on 14 Nov)
BIG = 10 * 1024 * 1024    # the Drive connector's download limit (16 Nov)
import import_hold as _hold; HOLD = _hold.held_docs()   # papers mid-import
BASELINE_SCAN = '2026-11-13T20:42:46+11:00'


def name_year(path):
    """The first year written in the file name itself ("H1 Adv 2023 (for 2024 HSC)" -> 2023), or None."""
    m = re.search(r'(?<!\d)(20\d\d)(?!\d)', os.path.basename(path.replace('\\', '/')))
    return int(m.group(1)) if m else None


def yl_of(d):
    return str(d['year_level']) if d['year_level'] in (11, 12) else '?'


def read_overrides(db):
    """The owner's answers in Needs a check (page db collection paperfix, mirrored into page_paperfix by tools/sync_pagedb.py):
    {doc id: {'yl': 11|12|None, 'course': key|None, 'out': bool, 'paper': id}} for every file of an answered paper. A paper is
    answered when it has both a year and a course, or is set aside (Not in scope); a half answer changes nothing."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='page_paperfix'").fetchone(): return {}
    out = {}
    for (d,) in db.execute('SELECT data_json FROM page_paperfix'):
        try: v = json.loads(d)
        except ValueError: continue
        yl, c, x = v.get('yl'), v.get('course'), bool(v.get('out'))
        if not (x or (yl in (11, 12) and c in COURSE_KEYS)): continue
        for i in [v.get('id')] + list(v.get('files') or []):
            # owner 17 Nov: "I don't get why I couldn't choose from the resolve page what to do as well": a paper with no year in
            # its name or cover takes the year he types in Needs a check ('y', the year the class graduates)
            y = v.get('y') if isinstance(v.get('y'), int) and 1990 <= v.get('y') <= 2040 else None
            if isinstance(i, int): out[i] = {'yl': yl, 'course': c, 'out': x, 'paper': v.get('id'), 'y': y}
    return out


def is_new(d):
    """First seen after the baseline scan (13 Nov, 8:42 pm): 'New' counts only what later scans add."""
    t = d.get('ingested_at')
    if not t: return False
    try: return datetime.datetime.fromisoformat(t).astimezone() > datetime.datetime.fromisoformat(BASELINE_SCAN)
    except ValueError: return False


def build(db, files=False, rules=None, overrides=None):
    """files=True adds 'f' (every documents.id in the paper) to each paper, for tools/import_next.py and tools/batches.py; the
    json carries 'f' only on needs_check papers (the page stores them with an owner's answer).
    rules: the path rules to apply (default: active_rules(): RULES, plus RULES_PROPOSED once the owner accepted it). A file whose
    recorded course / year level is exactly what the stage-0 RULES give for its path (it was decided by name, not by a cover)
    takes what `rules` give instead. overrides: read_overrides(db) by default."""
    db.row_factory = sqlite3.Row
    rules = rules or active_rules()
    overrides = read_overrides(db) if overrides is None else overrides
    docs = {r['id']: dict(r) for r in db.execute('SELECT id, source_path, status, course, year_level, task_type, school, year, display_label, '
                                                   'school_formal, task_code, failure_reason, page_count, parse_path, ingested_at, '
                                                   'size_bytes, drive_file_id FROM documents')}
    if rules is not RULES:      # proposed fixes: only files the stage-0 rules decided by name, and only where the result differs
        for d in docs.values():
            a, b = classify_path(d['source_path'], RULES), classify_path(d['source_path'], rules)
            if (a['course'], a['year_level']) != (b['course'], b['year_level']) and (d['course'], d['year_level']) == (a['course'], a['year_level']):
                d['course'], d['year_level'], d['_rule'] = b['course'], b['year_level'], (('yl%s' % b['year_level']) if b['year_level'] != a['year_level'] and b['course'] == a['course'] else b['course'])
    for i, o in overrides.items():   # the owner placed it (or set it aside): that wins over every rule
        if i in docs:
            d = docs[i]
            if o['out']: d['_out'] = True
            else:
                d['course'], d['year_level'], d['_placed'] = o['course'], o['yl'], True
                if o.get('y'): d['year'] = o['y']
    has_q = {r[0] for r in db.execute('SELECT DISTINCT document_id FROM questions')}
    # owner 16 Nov: "duplicate exams will never be batched and imported right?" A copy (status duplicate_file, "copy of document
    # <id>", tools/scan_folder.py) is in no paper's files: it is counted on its original's paper (cp) and listed in 'held'.
    copy_of = {}
    for i, d in docs.items():
        m = d['status'] == 'duplicate_file' and re.search(r'copy of document (\d+)', d['failure_reason'] or '')
        if m and int(m.group(1)) in docs and int(m.group(1)) != i: copy_of[i] = int(m.group(1))
    for i in list(copy_of):                          # a copy of a copy counts on the first original
        seen = {i}
        while copy_of[i] in copy_of and copy_of[i] not in seen: seen.add(copy_of[i]); copy_of[i] = copy_of[copy_of[i]]
    copies = collections.Counter(copy_of.values())
    last = None
    if db.execute("SELECT 1 FROM sqlite_master WHERE name='folder_scans'").fetchone():
        r = db.execute('SELECT at, pdfs, new, inserted, moved, copies, missing, report FROM folder_scans ORDER BY id DESC LIMIT 1').fetchone()
        if r: last = dict(r)
    new_ids = {i for i, d in docs.items() if is_new(d)}
    # 1. papers fixed by the import list (Year 12 Advanced): question doc + its separate solutions doc
    papers, taken = [], set()
    bypath = {d['source_path']: i for i, d in docs.items()}
    if os.path.exists(PAPERS):
        for x in json.load(open(PAPERS)):
            ids = [x['id']] + ([x['sol']] if x.get('sol') else []) + [bypath[f] for f in x.get('files', []) if f in bypath]
            ids = [i for i in dict.fromkeys(ids) if i in docs and i not in taken and i not in copy_of]
            if ids:
                papers.append({'ids': ids, 'label': x.get('label')}); taken.update(ids)
    # 2. everything else: by (course, year level, year, school, task) with the import_manifest naming rules
    groups = collections.OrderedDict()
    loose, split_off = [], set()
    for i, d in sorted(docs.items()):
        if i in taken or i in copy_of: continue
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

    out = {(c, y): {'course': c, 'yl': y, 'counts': dict.fromkeys(STATUSES + ['new', 'papers', 'files'], 0), 'papers': []} for c, *_ in COURSES for y in YLS}
    keys = set(COURSE_KEYS)
    paper_of = {}
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
        names = ' '.join(os.path.basename(f['source_path']) for f in fs)
        if course == 'advanced' and re.search(r'12ME|\bExt(ension)? ?1\b|\bMX1\b', names): course = 'ext1'   # the same rule as tools/import_manifest.py
        st, why = status_of(fs, course, yl, y, bool(q), has_q)
        label = prim['display_label'] or p.get('label')
        if not label and split_off & set(p['ids']):     # split from a paper of the same name: its file name tells them apart
            label = os.path.splitext(os.path.basename(prim['source_path']))[0][:70]
        if not label:
            if t == 'HSC' and y: label = f'{y} NESA HSC'
            elif y and s != '?' and t != '?': label = f'{y} {s} {t}'
            else: label = os.path.splitext(os.path.basename(prim['source_path']))[0][:70]
        new = int(any(f['id'] in new_ids for f in fs))
        cp = sum(copies[f['id']] for f in fs)
        dflt = (f'{y} NESA HSC' if t == 'HSC' else f'{y} {s} {t}') if y and s != '?' and t != '?' else None
        e = {'id': prim['id'], **({} if label == dflt else {'l': label}), 's': s if s != '?' else '', 'y': y, 't': t if t != '?' else '', 'st': st, 'n': len(fs)}
        if any(f.get('_k') in ('solutions', 'combined') or kind_of(as_manifest_row(f)) in ('solutions', 'combined') for f in fs): e['sol'] = 1
        if prim['parse_path'] == 'scan': e['scan'] = 1
        if new: e['new'] = 1
        if cp: e['cp'] = cp
        if why: e['why'] = why
        if files or st == 'needs_check': e['f'] = [f['id'] for f in fs]
        if st == 'needs_check': e['p'] = [f['source_path'] for f in fs][:4]      # the paths, for the Needs a check view
        # owner 14 Nov: Needs a check rows have an "Open the whole PDF in Drive" link (https://drive.google.com/file/d/<id>/view)
        if st == 'needs_check' and any(f.get('drive_file_id') for f in fs): e['g'] = [f.get('drive_file_id') or '' for f in fs][:4]
        if any(f.get('_placed') for f in fs): e['placed'] = 1
        # owner 18 Nov: "if the pdf is too big, just move it somewhere else for later (big pdfs)": a ready paper whose question file
        # (every one, if it has several) is over the Drive connector's 10 MB download limit cannot be fetched by an import session, so
        # it is marked big (MB) and tools/batches.py keeps it out of the batches; Processes lists it under "Big PDFs, for later"
        if st in ('ready_current', 'ready_old') and q and all((f.get('size_bytes') or 0) > BIG for f in q):
            e['big'] = round(min(f['size_bytes'] for f in q) / 1048576, 1)
        # owner 18 Nov: "imports ... shouldn't stall flagging and checking": a paper mid-import (tools/import_hold.py) is not in the
        # published bank yet, so the page shows it as importing, not as cleared review
        if any(f['id'] in HOLD for f in fs): e['imp'] = 1
        if course == 'advanced' and y and y < RULES['old_syllabus_before']: e['old'] = 1     # old syllabus: syllabus_version 'pre2017'
        g = out[(course if course in keys else 'unknown', yl)]
        g['papers'].append(e)
        for f in fs: paper_of[f['id']] = e['id']
        g['counts'][st] += 1; g['counts']['new'] += new; g['counts']['papers'] += 1; g['counts']['files'] += len(fs) + cp
    for g in out.values():
        g['papers'].sort(key=lambda e: (e['s'] or '~', -(e['y'] or 0), e['t'], e.get('l', '')))
    total = collections.Counter()
    for g in out.values():
        for k, v in g['counts'].items(): total[k] += v
    assert total['files'] == len(docs), (total['files'], len(docs))
    assert sum(total[k] for k in STATUSES) == total['papers'], 'every paper has exactly one status'
    return {
        'built': datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
        'last_scan': last, 'baseline_scan': BASELINE_SCAN, 'docs': len(docs), 'docs_with_questions': len(has_q & set(docs)), 'totals': dict(total),
        'statuses': STATUS_TEXT,
        'courses': [{'key': c, 'name': n, 'short': sh, 'ready': r, **({} if r else {'note': UNKNOWN if c == 'unknown' else SETUP})} for c, n, sh, r in COURSES],
        'cost_per_paper': cost_per_paper(),
        'groups': [g for g in out.values() if g['counts']['papers']],
        'root_drive_id': ROOT_DRIVE_ID, 'scan_skip': SCAN_SKIP,
        'files_url': FILES_URL, 'files': known_files(docs.values()),     # main() writes 'files' to FILES_URL, not into OUT
        'rules': rules,
        'held': held_list(docs, copy_of, paper_of),
    }


def same_size_copies(db, inv=None):
    """[(copy id, original id)]: two files of ONE paper with the same size in bytes are the same file (owner 16 Nov: "duplicate exams
    will never be batched and imported right?"; Manly 2024 was filed twice under names too different for the scan's name match).
    The original is the file with questions loaded, else the lower id. tools/scan_folder.py --apply records them as copies."""
    sz = {r[0]: r[1] for r in db.execute('SELECT id, size_bytes FROM documents')}
    hq = {r[0] for r in db.execute('SELECT DISTINCT document_id FROM questions')}
    out = []
    for g in (inv or build(db, files=True))['groups']:   # inv: a build(files=True) the caller already has (batch_check, 21 Nov)
        for p in g['papers']:
            by = collections.defaultdict(list)
            for f in p['f']:
                if sz.get(f): by[sz[f]].append(f)
            for fs in by.values():
                if len(fs) > 1:
                    keep = max(fs, key=lambda f: (f in hq, -f))
                    out += [(f, keep) for f in fs if f != keep and f not in hq]
    return out


def held_list(docs, copy_of, paper_of):
    """For Processes > Papers > Copies and missing files: every recorded copy beside its original (path, Drive id, the paper
    it belongs to), and the latest applied scan's moved files and missing rows (tools/scan_folder.py HELD)."""
    def f(i): d = docs[i]; return [i, d['source_path'], d.get('drive_file_id') or '']
    h = json.load(open(HELD)) if os.path.exists(HELD) else {}
    return {'at': h.get('at'),
            # the original's path only when its paper cannot be named (the page shows the paper's label): CODE_HEALTH rule 6, 16 Nov
            'copies': [f(i) + [o, '' if paper_of.get(o) else docs[o]['source_path'], docs[o].get('drive_file_id') or '', paper_of.get(o)]
                       for i, o in sorted(copy_of.items(), key=lambda x: docs[x[0]]['source_path'].lower())],
            'moved': [[m['id'], m['path'], m['from']] for m in h.get('moved', [])],
            'missing': [[m['doc_id'], m['path'], m['status']] for m in h.get('missing', [])]}


def status_of(fs, course, yl, y, has_question_file, has_q):
    """ONE status and one reason per paper (owner 14 Nov: "there seems to be some inconsistencies in paper numbers"). The reason is
    '' when the status says it all (STATUS_TEXT); the page derives every number from these statuses."""
    sts = {f['status'] for f in fs}
    if any(f['id'] in has_q for f in fs): return 'imported', ''
    if sts == {'duplicate_file'}: return 'duplicate', 'a copy of a recorded file'
    if all(f.get('_out') for f in fs): return 'not_in_scope', 'you set it aside (Needs a check)'
    placed = any(f.get('_placed') for f in fs)
    if placed or sts & {'discovered', 'pending', 'parsed', 'tagged'}:
        if course in OFF_COURSES: return 'held_course', ''
        if yl == '11': return 'held_y11', ''
        if not has_question_file: return 'not_in_scope', 'solutions only: question paper not found'
        if course == 'unknown': return 'needs_check', 'course not known from the folder or file name'
        if yl == '?': return 'needs_check', 'year level not known from the folder or file name'
        if not y: return 'needs_check', 'year not known from the folder or file name'
        # owner 13 Nov: "We should take questions too, we'll just have to disretard out of scope things": old 2 Unit papers are
        # imported; at tagging, parts with no current dot point are dropped (IMPORT_PLAYBOOK "Old-syllabus papers")
        if course in READY: return ('ready_old' if y < RULES['old_syllabus_before'] else 'ready_current'), ''
        return 'held_course', ''
    if sts <= {'excluded', 'duplicate_file'}:
        if course in OFF_COURSES: return 'held_course', ''
        fr = ' '.join(f['failure_reason'] or '' for f in fs).lower()
        if 'not a question paper' in fr: return 'not_in_scope', 'not a question paper'
        # owner 13 Nov: "Year 11 papers leave alone for now, would like to finalise Y12 first"
        if yl == '11': return 'held_y11', ''
        return 'not_in_scope', (next((f['failure_reason'] for f in fs if f['failure_reason']), '') or 'excluded at the first stock-take')
    return 'not_in_scope', '; '.join(sorted({f['status'] + (': ' + f['failure_reason'] if f['failure_reason'] else '') for f in fs if f['status'] not in ('discovered', 'excluded')}))[:120]


def proposed(db, inv, overrides=None):
    """What RULES_PROPOSED would change, for the Needs a check view (owner presses Accept there). Built from two full builds,
    so the page can show the result at once: replace = ids of papers that change, papers = the new entries by group
    ("course|yl"), rules = one row per fix with the papers it places (out of Needs a check), an example and their ids.
    changed_other = papers outside Needs a check that change too (reported; the counts it moves stay in Held or not in scope)."""
    rp = with_proposed()
    if inv['rules'] == rp:
        return {'accepted': True, 'version': RULES_PROPOSED['version'], 'show': RULES_PROPOSED['show']}
    db.row_factory = sqlite3.Row
    after = build(db, files=True, rules=rp, overrides=overrides)
    flat = lambda v: {p['id']: (g['course'] + '|' + g['yl'], p) for g in v['groups'] for p in g['papers']}
    A, Bf = flat(inv), flat(after)
    def same(a, b): return a and b and a[0] == b[0] and {k: v for k, v in a[1].items() if k not in ('f', 'p')} == {k: v for k, v in b[1].items() if k not in ('f', 'p')}
    gone = [i for i in A if not same(A[i], Bf.get(i))]
    add = [i for i in Bf if not same(Bf[i], A.get(i))]
    docs = {r['id']: r['source_path'] for r in db.execute('SELECT id, source_path FROM documents')}
    # which fix placed each Needs a check paper: where the paper with its id lands (a merged paper whose files the fixes split
    # counts once, under the course its lead file gets)
    rows = {r['key']: {**r, 'n': 0, 'ids': [], 'example': ''} for r in RULES_PROPOSED['show']}
    other = []
    for i in gone:
        k, p = A[i]
        if p['st'] != 'needs_check': other.append(i); continue
        b = Bf.get(i)
        if not b or b[1]['st'] == 'needs_check': continue
        c, yl = b[0].split('|')
        key = ('yl' + yl) if yl in ('11', '12') and k.split('|')[1] != yl and c == k.split('|')[0] else c   # 21 Nov: yl12 too (v3)
        if key in rows:
            r = rows[key]; r['n'] += 1; r['ids'].append(i)
            if not r['example']: r['example'] = docs.get(i, '')
    new_papers = {}
    for i in add:
        k, p = Bf[i]
        e = {kk: v for kk, v in p.items() if kk != 'f' or p['st'] == 'needs_check'}
        new_papers.setdefault(k, []).append(e)
    return {'accepted': False, 'version': RULES_PROPOSED['version'], 'rules_after': rp,
            'rules': [rows[r['key']] for r in RULES_PROPOSED['show']], 'replace': gone, 'papers': new_papers,
            'changed_other': len(other), 'totals_after': after['totals'],
            # the papers outside Needs a check that the fixes move, by (status before, status after): all inside Held or not in scope
            'other_moves': [[a, b, n] for (a, b), n in collections.Counter((A[i][1]['st'], Bf[i][1]['st'] if i in Bf else 'merged') for i in other).most_common()]}


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
    cols = STATUSES + ['papers', 'files']
    rows = [f'{"course":9s} {"yl":3s} ' + ' '.join(f'{c[:9]:>9s}' for c in cols)]
    for g in inv['groups'] + [{'course': 'total', 'yl': '', 'counts': inv['totals']}]:
        rows.append(f'{g["course"]:9s} {g["yl"]:3s} ' + ' '.join(f'{g["counts"].get(c, 0):9d}' for c in cols))
    return '\n'.join(rows)


def main():
    db = sqlite3.connect('file:' + DB + '?mode=ro', uri=True)
    inv = build(db)
    print(table(inv))
    inv['proposed'] = proposed(db, inv)
    pr = inv['proposed']
    if not pr['accepted']:
        print('proposed rule fixes (not accepted yet): ' + ', '.join(f'{r["key"]} {r["n"]}' for r in pr['rules'])
              + f'; {len(pr["replace"])} papers change, {pr["changed_other"]} of them outside Needs a check')
    import batches       # fixed numbered batches of 9 per ready lane (work/batches.json; assigned once)
    inv['lanes'] = batches.lanes(inv, write='--print' not in sys.argv)
    for L in inv['lanes']: print(f'lane {L["course"]}|{L["yl"]}: batches {L["first"]}-{L["first"] + len(L["batches"]) - 1} ({sum(map(len, L["batches"]))} papers), {len(L["done"])} finished')
    ls = inv['last_scan']
    print('last folder scan: ' + (f'{ls["at"]} ({ls["inserted"]} files added)' if ls else 'none yet') + f'; new since the baseline scan: {inv["totals"]["new"]}')
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
