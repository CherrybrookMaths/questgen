#!/usr/bin/env python3
"""Mirror the page database into questions.db (owner 14 Nov: "ok fix these issues": decisions made on the page lived only in
the page database and reached SQLite by hand).

Input: a folder exported with ArtifactData `list` + `out_dir` (one sub-folder per collection: reviews, difficulty, exams,
reports; one JSON file per document). Each run REPLACES the mirror tables with the export, so it always equals the page.
Usage: python3 tools/sync_pagedb.py <export_dir>
Tables: page_reviews, page_difficulty, page_exams, page_exam_items, page_reports (incl. suggested_wm 'UF'|'PR', 14 Nov),
page_importq (13 Nov: the owner's import order; since 14 Nov only the seed of tools/batches.py), page_runs (run requests: the
queue's Start and the cover-page check, 14 Nov), page_queue, page_batches, page_paperfix (14 Nov, Processes › Papers lanes:
the queue, Swap and the owner's answers in Needs a check), page_sync. A scans/rules.json in the export (the owner's Accept of
the proposed path rules) is written to work/rules_accepted.json, which tools/classify_paths.py reads.
QG_DB=<path> runs it against another database file (a copy, for tests).
The full document is kept in data_json, so nothing on the page is lost even if a field is not split out yet."""
import json, glob, os, sqlite3, sys, datetime
DB = os.environ.get('QG_DB', '/mnt/user-data/outputs/questions.db')   # QG_DB: run against a copy (tests)
SCHEMA = """
CREATE TABLE IF NOT EXISTS page_reviews(doc_key TEXT PRIMARY KEY, question_id INTEGER REFERENCES questions(id), document_id INTEGER REFERENCES documents(id),
  status TEXT, note TEXT, home_json TEXT, fig_json TEXT, sol_json TEXT, by TEXT, at TEXT, data_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS page_difficulty(part_id INTEGER PRIMARY KEY REFERENCES parts(id), question_id INTEGER REFERENCES questions(id),
  band INTEGER, wm TEXT, status TEXT, orig_band INTEGER, orig_wm TEXT, is_anchor INTEGER, by TEXT, at TEXT, data_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS page_exams(id TEXT PRIMARY KEY, title TEXT, sub TEXT, school TEXT, by TEXT, at TEXT, data_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS page_exam_items(exam_id TEXT REFERENCES page_exams(id), ordinal INTEGER, question_id INTEGER REFERENCES questions(id),
  PRIMARY KEY(exam_id, ordinal));
CREATE TABLE IF NOT EXISTS page_reports(id TEXT PRIMARY KEY, question_id INTEGER REFERENCES questions(id), part_id INTEGER REFERENCES parts(id),
  reason TEXT, suggested_band INTEGER, suggested_dot TEXT, note TEXT, status TEXT, reply TEXT, exam_id TEXT, by TEXT, at TEXT, data_json TEXT NOT NULL,
  suggested_wm TEXT);
CREATE TABLE IF NOT EXISTS page_importq(doc_key TEXT PRIMARY KEY, doc_id INTEGER REFERENCES documents(id), label TEXT, course TEXT,
  year_level INTEGER, ord REAL, added_by TEXT, at TEXT, data_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS page_runs(doc_key TEXT PRIMARY KEY, year INTEGER, course TEXT, status TEXT, papers_json TEXT, batch_size INTEGER,
  by TEXT, at TEXT, data_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS page_queue(doc_key TEXT PRIMARY KEY, course TEXT, yl TEXT, batch INTEGER, ord REAL, by TEXT, at TEXT, data_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS page_batches(doc_key TEXT PRIMARY KEY, course TEXT, yl TEXT, swaps_json TEXT, data_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS page_paperfix(doc_key TEXT PRIMARY KEY, paper_id INTEGER REFERENCES documents(id), files_json TEXT, yl INTEGER,
  course TEXT, out INTEGER, by TEXT, at TEXT, data_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS page_sync(collection TEXT PRIMARY KEY, docs INTEGER, synced_at TEXT, unmatched INTEGER);
"""
def docs(d, coll):
    out = []
    for f in sorted(glob.glob(os.path.join(d, coll, '*.json'))):
        x = json.load(open(f)); data = x.get('data', x) if isinstance(x, dict) and 'data' in x and isinstance(x['data'], dict) else x
        out.append((os.path.basename(f)[:-5], data))
    return out
J = lambda v: json.dumps(v, ensure_ascii=False) if v is not None else None

# owner 14 Nov: "Should let you pick UF and PS in the wrong diff". A difficulty report can carry suggested_wm ('UF' fluency,
# 'PR' problem solving). Tables made before that have no such column: add it once (ALTER TABLE), so running this again is a no-op.
# Columns are named in the INSERT, so the added column's position (last) does not matter.
def migrate(db):
    cols = {r[1] for r in db.execute('PRAGMA table_info(page_reports)')}
    if 'suggested_wm' not in cols:
        db.execute('ALTER TABLE page_reports ADD COLUMN suggested_wm TEXT')
        print('page_reports: added column suggested_wm')

def main(d):
    db = sqlite3.connect(DB); db.executescript(SCHEMA); migrate(db); now = datetime.datetime.now().isoformat(timespec='seconds')
    have = lambda t, i: i is not None and db.execute(f'SELECT 1 FROM {t} WHERE id=?', (i,)).fetchone() is not None
    rep = []
    if os.path.isdir(os.path.join(d, 'reviews')):
        db.execute('DELETE FROM page_reviews'); L = docs(d, 'reviews'); bad = 0
        for k, v in L:
            # owner 14 Nov (Fix 2, "Ok we should run Fix 1 and 2"): k_<question key> / p_<paper key> docs too (tools/qkeys.py)
            qid = v.get('question_id') if k[:1] == 'q' or k.startswith('k_') else None; did = v.get('doc') if k.startswith(('paper_', 'p_')) else None
            if (qid and not have('questions', qid)) or (did and not have('documents', did)): bad += 1
            db.execute('INSERT INTO page_reviews VALUES(?,?,?,?,?,?,?,?,?,?,?)', (k, qid, did, v.get('status'), v.get('note') or v.get('flag_note'),
                       J(v.get('home')), J(v.get('fig')), J(v.get('sol')), v.get('by'), v.get('at'), J(v)))
        rep.append(('reviews', len(L), bad))
    if os.path.isdir(os.path.join(d, 'difficulty')):
        db.execute('DELETE FROM page_difficulty'); L = docs(d, 'difficulty'); bad = 0
        for k, v in L:
            pid = int(v.get('part_id') or k)
            if not have('parts', pid): bad += 1
            db.execute('INSERT INTO page_difficulty VALUES(?,?,?,?,?,?,?,?,?,?,?)', (pid, v.get('question_id'), v.get('band'), v.get('wm'), v.get('status'),
                       v.get('orig_band'), v.get('orig_wm'), 1 if v.get('anchor') else 0, v.get('by'), v.get('at'), J(v)))
        rep.append(('difficulty', len(L), bad))
    if os.path.isdir(os.path.join(d, 'exams')):
        db.execute('DELETE FROM page_exam_items'); db.execute('DELETE FROM page_exams'); L = docs(d, 'exams'); bad = 0
        for k, v in L:
            db.execute('INSERT INTO page_exams VALUES(?,?,?,?,?,?,?)', (k, v.get('title'), v.get('sub'), v.get('school'), v.get('by'), v.get('at'), J(v)))
            for i, q in enumerate(v.get('items') or []):
                if not have('questions', q): bad += 1
                db.execute('INSERT INTO page_exam_items VALUES(?,?,?)', (k, i + 1, q))
        rep.append(('exams', len(L), bad))
    if os.path.isdir(os.path.join(d, 'reports')) or True:
        db.execute('DELETE FROM page_reports'); L = docs(d, 'reports'); bad = 0
        for k, v in L:
            if not have('questions', v.get('question_id')): bad += 1
            wm = v.get('suggested_wm') if v.get('suggested_wm') in ('UF', 'PR') else None
            db.execute('INSERT INTO page_reports(id, question_id, part_id, reason, suggested_band, suggested_dot, note, status, reply, exam_id, by, at, data_json, suggested_wm) '
                       'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (k, v.get('question_id'), v.get('part_id'), v.get('reason'),
                       v.get('suggested_band'), v.get('suggested_dot'), v.get('note'), v.get('status'), v.get('reply'), v.get('exam_id'), v.get('by'), v.get('at'), J(v), wm))
        rep.append(('reports', len(L), bad))
    # owner 13 Nov: "Can the import queue be dynamic, me choosing which set of papers to import next?" The Processes page's
    # Papers section writes collection importq (one doc per paper, d<doc_id>); tools/import_next.py reads this mirror.
    if os.path.isdir(os.path.join(d, 'importq')):
        db.execute('DELETE FROM page_importq'); L = docs(d, 'importq'); bad = 0
        for k, v in L:
            if not have('documents', v.get('doc_id')): bad += 1
            db.execute('INSERT INTO page_importq VALUES(?,?,?,?,?,?,?,?,?)', (k, v.get('doc_id'), v.get('label'), v.get('course'), v.get('year_level'),
                       v.get('order'), v.get('added_by'), v.get('at'), J(v)))
        rep.append(('importq', len(L), bad))
    # owner 13 Nov: "... choose a grade 11 or 12 and course ... and hit Go" -> "Yes, with batch pauses": the Papers tab's Go writes
    # one run request per doc to collection runs; tools/import_next.py reads this mirror (an active run beats the import order).
    if os.path.isdir(os.path.join(d, 'runs')):
        db.execute('DELETE FROM page_runs'); L = docs(d, 'runs'); bad = 0
        for k, v in L:
            ps = v.get('papers') if isinstance(v.get('papers'), list) else []
            bad += sum(not have('documents', x) for x in ps)
            db.execute('INSERT INTO page_runs VALUES(?,?,?,?,?,?,?,?,?)', (k, v.get('year'), v.get('course'), v.get('status'), J(ps), v.get('batch_size'),
                       v.get('by'), v.get('at'), J(v)))
        rep.append(('runs', len(L), bad))
    # owner 14 Nov (mockup A, "I like A's design much more"): Processes › Papers lanes. queue: one doc per queued batch
    # ('<course>_<yl>_<n>'); batches: Swap, one doc per lane; paperfix: the owner's answers in Needs a check (tools/inventory.py
    # applies them, so a rescan never asks again). tools/import_next.py and tools/inventory.py read these mirrors.
    if os.path.isdir(os.path.join(d, 'queue')):
        db.execute('DELETE FROM page_queue'); L = docs(d, 'queue')
        for k, v in L:
            db.execute('INSERT INTO page_queue VALUES(?,?,?,?,?,?,?,?)', (k, v.get('course'), str(v.get('yl')), v.get('batch'), v.get('order'), v.get('by'), v.get('at'), J(v)))
        rep.append(('queue', len(L), 0))
    if os.path.isdir(os.path.join(d, 'batches')):
        db.execute('DELETE FROM page_batches'); L = docs(d, 'batches'); bad = 0
        for k, v in L:
            sw = v.get('swaps') if isinstance(v.get('swaps'), list) else []
            bad += sum(not have('documents', x.get('id') if isinstance(x, dict) else x) for x in sw)
            db.execute('INSERT INTO page_batches VALUES(?,?,?,?,?)', (k, v.get('course'), str(v.get('yl')), J(sw), J(v)))
        rep.append(('batches', len(L), bad))
    if os.path.isdir(os.path.join(d, 'paperfix')):
        db.execute('DELETE FROM page_paperfix'); L = docs(d, 'paperfix'); bad = 0
        for k, v in L:
            if not have('documents', v.get('id')): bad += 1
            db.execute('INSERT INTO page_paperfix VALUES(?,?,?,?,?,?,?,?,?)', (k, v.get('id'), J(v.get('files')), v.get('yl'), v.get('course'),
                       1 if v.get('out') else 0, v.get('by'), v.get('at'), J(v)))
        rep.append(('paperfix', len(L), bad))
    rules = os.path.join(d, 'scans', 'rules.json')
    if os.path.exists(rules):   # the owner's Accept of RULES_PROPOSED (page db scans/rules) -> work/rules_accepted.json
        x = json.load(open(rules)); v = x['data'] if isinstance(x, dict) and isinstance(x.get('data'), dict) else x
        out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'work', 'rules_accepted.json')
        json.dump({'version': v.get('version'), 'accepted': bool(v.get('accepted')), 'by': v.get('by'), 'at': v.get('at')}, open(out, 'w'), indent=1)
        print(f'rules      accepted={bool(v.get("accepted"))} version {v.get("version")} -> work/rules_accepted.json (run tools/inventory.py)')
    for c, n, bad in rep:
        db.execute('INSERT OR REPLACE INTO page_sync VALUES(?,?,?,?)', (c, n, now, bad))
        print(f'{c:11s} {n:5d} docs mirrored' + (f'  ({bad} point at rows not in the database)' if bad else ''))
    db.commit()

if __name__ == '__main__':
    main(sys.argv[1])
