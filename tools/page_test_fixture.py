#!/usr/bin/env python3
"""Seed data for tools/page_test.js (hardening action 1, 14 Nov).

The page test runs the page against a FAKE page database. To make it behave like the live page (approved questions in the
Bank, review decisions, difficulty checks, saved exams), the fake database is seeded from the mirror of the real page
database that tools/sync_pagedb.py keeps in questions.db (tables page_reviews, page_difficulty, page_exams, page_reports).

Writes work/page_test/fixture.json: {"made": ..., "synced": {...}, "docs": {"reviews/q123": {...}, "difficulty/456": {...}, ...}}
Nothing is written to the database. Read-only.
Usage: python3 tools/page_test_fixture.py [out.json]
"""
import json, os, sqlite3, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classify_paths import RULES, classify_path

P = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = '/mnt/user-data/outputs/questions.db'
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(P, 'work', 'page_test', 'fixture.json')
TABLES = [('reviews', 'page_reviews', 'doc_key'), ('difficulty', 'page_difficulty', 'part_id'),
          ('exams', 'page_exams', 'id'), ('reports', 'page_reports', 'id')]


def sample_progress():
    iso = lambda m: time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - m * 60))
    # owner 13 Nov ("start and finish time as well"): Claude writes queue times as ISO strings with +11:00
    iso11 = lambda m: time.strftime('%Y-%m-%dT%H:%M:%S+11:00', time.gmtime(time.time() - m * 60 + 11 * 3600))
    return {
        'progress/jobs': {'jobs': [
            {'name': 'Redrawing diagrams, batch 6', 'detail': '41 of 120 figures', 'affects': 'diagrams', 'started': iso(12)},
            {'name': 'Queued: 5 tasks', 'detail': 'interim entry, replaced by progress/queue', 'affects': '', 'started': iso(30)}]},
        'progress/queue': {'updated': iso(3), 'items': [
            {'id': 'q2', 'title': 'Figure resize by the corner', 'detail': 'Drag the bottom-right corner, 30% to 200%.',
             'status': 'queued', 'order': 2, 'asked': 'resizing is really unintuitive, it should just be drag the corner in and out diagonally'},
            {'id': 'q1', 'title': 'Overlap in the availability table', 'detail': 'Labels get their own column.',
             'status': 'running', 'order': 1, 'asked': 'overlap', 'step': 'Stage 2 of 4', 'started': iso11(25), 'eta': iso11(-20)},
            {'id': 'q3', 'title': 'Fluency / Problem solving in Wrong difficulty', 'detail': 'Optional choice, stored as suggested_wm.',
             'status': 'queued', 'order': 3, 'asked': 'Should let you pick UF and PS in the wrong diff'},
            {'id': 'q4', 'title': 'Dot points behind an info button', 'detail': 'An ⓘ on the source line; dot points in the grading panel.',
             'status': 'queued', 'order': 4, 'asked': 'The dot point home looks stupid in a question'},
            {'id': 'q0', 'title': 'Processes page', 'detail': 'Running and queued pills, and this page.',
             'status': 'done', 'order': 0, 'asked': 'Can make that page processes', 'step': 'Stage 4 of 4',
             'started': iso11(102), 'finished': iso11(30)}]},
    }


# owner 13 Nov: "I think the next thing I want to do is refine the review process. It is just 7 tabs at the top and its not
# really clear the order / process." Review is now an Inbox plus one paper at a time (Your calls, Flagged, Topics, Diagrams,
# Spot-check). Every paper in the live database is approved, so the page test would only ever see empty tracks. This overlay
# lists review decisions to take off a few papers in the FAKE database (never the real one), so every step has work:
#   1346 (+ its second PDF 510) 2022 CSSA AT4: everything undone -> Your calls, Topics, Diagrams
#   323 2024 Caringbah AT4: everything undone, paper approval removed -> Flagged, Topics, Diagrams, Spot-check
#   1601 2024 Knox AT2: only the spot-check sample and the paper approval undone -> Spot-check, then "approve the rest"
# The page test leaves these docs (fixture["workload"]["drop"]) out only on the pages that test Review; the Bank and Exams checks
# keep the live approved set, so the generated test exams stay the ones those checks were written against.
WORKLOAD = {'all': [1346, 510, 323], 'paper': [323, 1601], 'sample': [1601]}


def workload(docs):
    bank = os.path.join(P, 'site', 'data', 'bank.json')
    if not os.path.exists(bank):
        return []
    qs = json.load(open(bank))['questions']
    drop = set()
    for q in qs:
        tier = (q.get('tri') or {}).get('tier')
        if q['doc'] in WORKLOAD['all'] or (q['doc'] in WORKLOAD['sample'] and tier == 'sample'):
            drop.add(f"reviews/q{q['id']}")
    drop |= {f'reviews/paper_{d}' for d in WORKLOAD['paper']}
    return sorted(k for k in drop if k in docs)


# owner 13 Nov: "Can the import queue be dynamic, me choosing which set of papers to import next? We can always [build the]
# framework for the courses standard extension and extension two [later] right?" The Papers section on Processes reads
# data/inventory.json (tools/inventory.py) and db collection importq. The page test serves THIS small inventory instead of the
# live one (route data/inventory.json), so the grid counts are known, and seeds one importq doc (paper 9103) on its own pages only.
def sample_papers():
    P_ = lambda i, s, y, t, st, **k: {'id': i, 's': s, 'y': y, 't': t, 'st': st, 'n': k.pop('n', 1), **k}
    adv12 = [P_(9001, 'Abbotsleigh', 2024, 'AT4', 'imported', sol=1), P_(9002, 'Knox Grammar School', 2025, 'AT2', 'imported', sol=1),
             P_(9003, 'NESA', 2025, 'HSC', 'imported', sol=1),
             P_(9101, 'Abbotsleigh', 2025, 'AT4', 'waiting', sol=1, pick=1), P_(9102, 'Abbotsleigh', 2023, 'AT2', 'waiting', pick=1, scan=1),
             P_(9103, 'Knox Grammar School', 2024, 'AT1', 'waiting', sol=1, pick=1), P_(9104, 'Knox Grammar School', 2026, 'AT4', 'waiting', sol=1, pick=1, new=1, n=2),
             P_(9201, 'TEC', 2022, 'AT4', 'out_of_scope', sol=1, why='solutions only: question paper not found'),
             # owner 13 Nov: "We should take questions too, we'll just have to disretard out of scope things": an old-syllabus
             # (pre-2019, old 2 Unit) Year 12 paper is waiting and can be ticked, as tools/inventory.py marks it
             P_(9105, 'Knox Grammar School', 2017, 'AT4', 'waiting', sol=1, pick=1, old=1)]
    adv11 = [P_(9301, 'Knox Grammar School', 2024, 'AT2', 'out_of_scope', why='Year 11: outside the import scope (Year 12)'),
             P_(9302, "The King's School", 2023, 'AT1', 'out_of_scope', why='Year 11: outside the import scope (Year 12)'),
             # owner 13 Nov: "Year 11 papers leave alone for now": even a waiting old-syllabus Year 11 paper has no pick
             P_(9303, 'Knox Grammar School', 2017, 'AT1', 'waiting', old=1)]
    ext1 = [P_(9401, 'Knox Grammar School', 2025, 'AT4', 'out_of_course', sol=1), P_(9402, 'Abbotsleigh', 2024, 'AT4', 'out_of_course'),
            P_(9403, 'CSSA', 2026, 'AT4', 'out_of_course', new=1)]
    std = [P_(9501, 'Hornsby Girls High School', 2025, 'AT4', 'out_of_course'), P_(9502, 'Penrith High School', 2024, 'AT3', 'out_of_course')]
    unk = [P_(9601, '', None, '', 'out_of_scope', l='Adv Math - Graphing Techniques', why='path/filename names a non-target course or year (not cover-checked)')]
    def grp(c, yl, ps):
        ps = sorted(ps, key=lambda e: (e['s'] or '~', -(e['y'] or 0), e['t'], e.get('l', '')))   # as tools/inventory.py sorts them
        k = {s: sum(p['st'] == s for p in ps) for s in ('imported', 'waiting', 'out_of_course', 'out_of_scope', 'other')}
        return {'course': c, 'yl': yl, 'counts': {**k, 'new': sum(p.get('new', 0) for p in ps), 'papers': len(ps), 'files': sum(p['n'] for p in ps)}, 'papers': ps}
    groups = [grp('advanced', '12', adv12), grp('advanced', '11', adv11), grp('ext1', '12', ext1), grp('standard', '12', std), grp('unknown', '?', unk)]
    setup = 'needs course setup (topics, dot points, difficulty references)'
    inv = {'built': '2026-11-13T19:00:00+11:00', 'docs': sum(g['counts']['files'] for g in groups),
           'last_scan': {'at': '2026-11-13T18:30:00+11:00', 'pdfs': 1634, 'new': 2, 'inserted': 2, 'moved': 0, 'copies': 0, 'missing': 0, 'report': 'work/scan/scan_2026-11-13.json'},
           'totals': {k: sum(g['counts'][k] for g in groups) for k in groups[0]['counts']},
           'courses': [{'key': 'advanced', 'name': 'Mathematics Advanced', 'short': 'Advanced', 'ready': True},
                       {'key': 'ext1', 'name': 'Mathematics Extension 1', 'short': 'Extension 1', 'ready': False, 'note': setup},
                       {'key': 'ext2', 'name': 'Mathematics Extension 2', 'short': 'Extension 2', 'ready': False, 'note': setup},
                       {'key': 'standard', 'name': 'Mathematics Standard', 'short': 'Standard', 'ready': False, 'note': setup},
                       {'key': 'unknown', 'name': 'Course not known yet', 'short': 'Course not known', 'ready': False, 'note': 'course not known from the file name: a cover-page check sorts these'}],
           'cost_per_paper': None, 'groups': groups, **sample_drive_known()}
    importq = {'importq/d9103': {'doc_id': 9103, 'label': '2024 Knox Grammar School AT1', 'course': 'advanced', 'year_level': 12, 'order': 1,
                                 'added_by': 'u_owner', 'at': '2026-11-13T18:40:00+11:00'}}
    files = inv.pop('files')      # as tools/inventory.py writes it: the recorded files are data/inventory_files.json, fetched for Rescan drive only
    return {'inventory': inv, 'inventory_files': {'built': inv['built'], **files}, 'importq': importq}


# owner 13 Nov: "Where is the button to rescan the drive?" The page's Rescan drive walks a Drive folder with the viewer's
# Google Drive connector. The page test fakes that connector (tools/page_test.js fakeClaude, mcp) with THIS small tree, and the
# fixture inventory above carries the matching record (root_drive_id, scan_skip, files) and the real rules (RULES).
# Known: dK1 by Drive id, '2024 knox ...' by path (other case), 2025 HSC by id. New: n1, n2, n4, n5, n6. n3 has the size of a
# recorded file (probably moved). 'Claude outputs' is skipped. per=2: the fake answers 2 items a page, so pageToken is used.
DRIVE_KNOWN = [('Knox/Y12', '2025 Knox Year 12 Mathematics Advanced Trial.pdf', 1000, 'dK1'), ('Knox/Y12', '2024 Knox Year 12 Adv AT1.pdf', 2000, ''),
               ('HSC 2025', '2025-hsc-maths-advanced.pdf', 3000, 'dH1'), ('', 'Loose Adv notes.pdf', 4000, '')]
def sample_drive_known():
    dirs = list(dict.fromkeys(d for d, *_ in DRIVE_KNOWN))
    return {'root_drive_id': 'ROOTFAKE', 'scan_skip': ['Claude outputs'], 'rules': RULES, 'files_url': 'data/inventory_files.json',
            'files': {'dirs': dirs, 'f': [[dirs.index(d), n, sz, i] for d, n, sz, i in DRIVE_KNOWN]}}


def sample_drive():
    F = lambda i, t: {'id': i, 'title': t, 'mimeType': 'application/vnd.google-apps.folder'}
    D = lambda i, t, sz: {'id': i, 'title': t, 'mimeType': 'application/pdf', 'fileSize': str(sz)}
    folders = {
        'ROOTFAKE': [F('fK', 'Knox'), F('fH25', 'HSC 2025'), F('fH27', 'HSC 2027'), F('fCO', 'Claude outputs')],
        'fK': [F('fKY12', 'Y12'), F('fKY11', 'Y11')],
        'fKY12': [D('dK1', '2025 Knox Year 12 Mathematics Advanced Trial.pdf', 1000), D('x2', '2024 knox year 12 adv at1.pdf', 2000),
                  D('n1', '2026 Knox Year 12 Mathematics Advanced Trial.pdf', 5001), D('n2', '2026 Knox Year 12 Mathematics Extension 1 Trial.pdf', 5002),
                  D('n3', 'Knox Adv notes copy.pdf', 4000)],
        'fKY11': [D('n4', '2026 Knox Year 11 Mathematics Advanced Yearly.pdf', 5004)],
        'fH25': [D('dH1', '2025-hsc-maths-advanced.pdf', 3000)],
        'fH27': [D('n5', '2027-hsc-maths-advanced.pdf', 5005), D('n6', '2027-hsc-maths-advanced-mg.pdf', 5006)],
        'fCO': [D('n7', 'export.pdf', 5007)],
    }
    path = {'n1': 'Knox/Y12/', 'n2': 'Knox/Y12/', 'n3': 'Knox/Y12/', 'n4': 'Knox/Y11/', 'n5': 'HSC 2027/', 'n6': 'HSC 2027/'}
    names = {x['id']: x['title'] for xs in folders.values() for x in xs}
    expect = {}
    for i, d in path.items():
        c = classify_path(d + names[i])
        expect[i] = {'path': d + names[i], 'course': c['course'], 'yl': c['year_level'], 'year': c['year'], 'status': c['status']}
    return {'folders': folders, 'per': 2, 'folder_count': 6, 'expect': expect, 'like': {'n3': 'Loose Adv notes.pdf'}}


def classify_cases():
    """Every recorded path with what tools/classify_paths.py says about it: the page's port must agree (page_test)."""
    if not os.path.exists(DB):
        return []
    db = sqlite3.connect('file:' + DB + '?mode=ro', uri=True)
    out = []
    for (p,) in db.execute('SELECT source_path FROM documents ORDER BY id'):
        c = classify_path(p)
        out.append([p, c['course'], c['year_level'], c['task_type'], c['year'], c['school'], c['status'], c['failure_reason']])
    return out


def main():
    docs, synced = {}, {}
    if os.path.exists(DB):
        db = sqlite3.connect('file:' + DB + '?mode=ro', uri=True)
        have = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for coll, table, key in TABLES:
            if table not in have:
                continue
            for k, data in db.execute(f'SELECT {key}, data_json FROM {table}'):
                try:
                    docs[f'{coll}/{k}'] = json.loads(data)
                except Exception:
                    pass
        if 'page_sync' in have:
            synced = dict(db.execute('SELECT collection, synced_at FROM page_sync').fetchall())
    # owner 14 Nov ("need a pill for current jobs and queued jobs"): sample progress/jobs and progress/queue docs, so the
    # header pills and the Processes page are exercised. The jobs doc keeps the interim "Queued: ..." pseudo-job on purpose:
    # the page must ignore it once the queue doc is there.
    docs.update(sample_progress())
    drop = workload(docs)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({'made': time.strftime('%Y-%m-%dT%H:%M:%S'), 'synced': synced, 'workload': {'papers': WORKLOAD, 'drop': drop}, 'docs': docs,
               'papers': sample_papers(), 'drive': sample_drive(), 'classify': classify_cases()}, open(OUT, 'w'))
    counts = {}
    for k in docs:
        counts[k.split('/')[0]] = counts.get(k.split('/')[0], 0) + 1
    print(f'page_test fixture: {OUT} ({", ".join(f"{c} {n}" for c, n in sorted(counts.items())) or "empty: no page_* tables"}; {len(drop)} review docs left out on the Review test pages)')


if __name__ == '__main__':
    main()
