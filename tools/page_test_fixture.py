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
    json.dump({'made': time.strftime('%Y-%m-%dT%H:%M:%S'), 'synced': synced, 'workload': {'papers': WORKLOAD, 'drop': drop}, 'docs': docs}, open(OUT, 'w'))
    counts = {}
    for k in docs:
        counts[k.split('/')[0]] = counts.get(k.split('/')[0], 0) + 1
    print(f'page_test fixture: {OUT} ({", ".join(f"{c} {n}" for c, n in sorted(counts.items())) or "empty: no page_* tables"}; {len(drop)} review docs left out on the Review test pages)')


if __name__ == '__main__':
    main()
