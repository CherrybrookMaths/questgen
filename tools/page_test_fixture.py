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
    return {
        'progress/jobs': {'jobs': [
            {'name': 'Redrawing diagrams, batch 6', 'detail': '41 of 120 figures', 'affects': 'diagrams', 'started': iso(12)},
            {'name': 'Queued: 5 tasks', 'detail': 'interim entry, replaced by progress/queue', 'affects': '', 'started': iso(30)}]},
        'progress/queue': {'updated': iso(3), 'items': [
            {'id': 'q2', 'title': 'Figure resize by the corner', 'detail': 'Drag the bottom-right corner, 30% to 200%.',
             'status': 'queued', 'order': 2, 'asked': 'resizing is really unintuitive, it should just be drag the corner in and out diagonally'},
            {'id': 'q1', 'title': 'Overlap in the availability table', 'detail': 'Labels get their own column.',
             'status': 'running', 'order': 1, 'asked': 'overlap'},
            {'id': 'q3', 'title': 'Fluency / Problem solving in Wrong difficulty', 'detail': 'Optional choice, stored as suggested_wm.',
             'status': 'queued', 'order': 3, 'asked': 'Should let you pick UF and PS in the wrong diff'},
            {'id': 'q4', 'title': 'Dot points behind an info button', 'detail': 'An ⓘ on the source line; dot points in the grading panel.',
             'status': 'queued', 'order': 4, 'asked': 'The dot point home looks stupid in a question'},
            {'id': 'q0', 'title': 'Processes page', 'detail': 'Running and queued pills, and this page.',
             'status': 'done', 'order': 0, 'asked': 'Can make that page processes'}]},
    }


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
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({'made': time.strftime('%Y-%m-%dT%H:%M:%S'), 'synced': synced, 'docs': docs}, open(OUT, 'w'))
    counts = {}
    for k in docs:
        counts[k.split('/')[0]] = counts.get(k.split('/')[0], 0) + 1
    print(f'page_test fixture: {OUT} ({", ".join(f"{c} {n}" for c, n in sorted(counts.items())) or "empty: no page_* tables"})')


if __name__ == '__main__':
    main()
