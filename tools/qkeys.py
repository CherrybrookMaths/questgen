#!/usr/bin/env python3
"""Permanent question keys (Fix 2 of the plan "Questgen architecture plan: before imports resume").
Owner 14 Nov: "Ok we should run Fix 1 and 2". He ticked the readable format.

Why: page decisions (reviews, difficulty checks, saved exams, reports) were addressed by question id. Ids are not stable:
on 14 Nov hiding the CSSA 2022 paper filed twice (docs 510 / 1346) moved Q10-Q11 behind unapproved copies, and the
approvals on 274 / 275 stopped counting. A key names the question the way the paper does, so it survives a re-parse,
a re-file or a change of which copy the Bank keeps.

Key format:  <year>-<School>-<task>[-<course/year tag>]-Q<number><split letter>
    2022-CSSA-AT4-Q10     2023-NESA-HSC-Q16     2020-BaulkhamHills-AT2-Q11b (a split question, the paper's 11(b))
  School = documents.school (short name; school_formal when empty, e.g. NESA), letters and digits only.
  task   = documents.task_code (HSC, AT1-AT4), else task_type.
  tag    = COURSE_TAG[course] (empty for Advanced, the course the owner ticked the format on) plus 'Y11' for Year 11 papers,
           so a Year 11 AT1 or an Extension 1 paper never collides with the Year 12 Advanced paper of the same school/year.
  Paper key = the key without '-Q...' (used for paper approvals, reviews/p_<paper key>).

Rules:
  * A key is stored once in questions.db table question_keys(question_id, key, assigned_at, document_id) and never changed
    or given to a different question afterwards. (document_id guards against SQLite reusing a deleted question's id.)
  * Copies share one key: questions linked by related_questions relation='duplicate', and the same question number in a
    paper filed twice (two documents with the same paper key). The group takes the key of the copy the Bank keeps
    (no dup_of in bank.json); without a bank, the approved copy, then the lowest id.
  * A re-parsed question (new id, same paper + number) re-attaches to the key of the question it replaces when no live
    question holds that key any more. Rows of deleted questions stay as history.
  * Two live, different questions that would get the same key (a mis-numbered paper, e.g. 2020 Baulkham Hills AT2 has two
    Q4s) are told apart by a suffix: the later one is ...-Q4~2.

Usage:
  python3 tools/qkeys.py --db DB --assign [--bank site/data/bank.json]   assign missing keys (writes question_keys)
  python3 tools/qkeys.py --db DB --assign --dry-run [--bank ...]          print what would be assigned, write nothing
  python3 tools/qkeys.py --db DB --show 274 44                            key of these question ids
DB defaults to tools/paths.py DB ($QG_DB, ...). Copy it into archive/ before the first --assign on the live file.
build_bank.py calls attach() once per build (one block), so new imports get their keys there.
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import argparse, collections, datetime, json, os, re, sqlite3, sys

DB = paths.DBS
COURSE_TAG = {'advanced': '', 'standard': 'STD', 'ext1': 'X1', 'ext2': 'X2'}
SCHEMA = """CREATE TABLE IF NOT EXISTS question_keys(question_id INTEGER PRIMARY KEY, key TEXT NOT NULL, assigned_at TEXT NOT NULL,
  document_id INTEGER);
CREATE INDEX IF NOT EXISTS question_keys_key ON question_keys(key);"""
_tok = lambda s: re.sub(r'[^A-Za-z0-9]', '', str(s or ''))


def paper_key(d):
    """d: documents row (mapping). '2022-CSSA-AT4'; a document with no year or school falls back to 'doc<id>'."""
    school = _tok(d['school'] or d['school_formal']); task = _tok(d['task_code'] or d['task_type']).upper()
    if not d['year'] or not school: return 'doc%d' % d['id']
    tag = COURSE_TAG.get(d['course'] or 'advanced', _tok(d['course']).upper()) + ('Y11' if d['year_level'] == 11 else '')
    return '-'.join(x for x in (str(d['year']), school, task or 'X', tag) if x)


def number_token(n):
    """'10' -> 'Q10', '11(b)' -> 'Q11b' (a split question keeps the paper's letter)."""
    return 'Q' + (_tok(str(n).lower()) or 'X')


def ensure(db):
    db.executescript(SCHEMA)


def table_exists(db):
    return db.execute("select 1 from sqlite_master where name='question_keys'").fetchone() is not None


def live_keys(db):
    """{question_id: key} for questions that exist now (empty if the table is not there yet)."""
    if not table_exists(db): return {}
    return {q: k for q, k in db.execute('select k.question_id, k.key from question_keys k join questions q on q.id=k.question_id')}


def plan(db, kept=None):
    """Work out keys for every question that has none. Returns (new {qid: key}, problems [str]). Writes nothing.
    kept: {qid: True} for the copies the Bank keeps (no dup_of); optional."""
    db.row_factory = sqlite3.Row
    docs = {r['id']: r for r in db.execute('select * from documents')}
    qs = {r['id']: r for r in db.execute('select id, document_id, number, review_status from questions')}
    rows = {r['question_id']: r for r in db.execute('select * from question_keys')} if table_exists(db) else {}
    have, problems = {}, []
    for qid, r in rows.items():
        if qid in qs and (r['document_id'] is None or r['document_id'] == qs[qid]['document_id']): have[qid] = r['key']
        elif qid in qs: problems.append(f'question {qid}: stored key {r["key"]} belongs to another paper (id reused): reassigned')
    pk = {d: paper_key(docs[d]) for d in {q['document_id'] for q in qs.values()}}
    nat = {qid: pk[q['document_id']] + '-' + number_token(q['number']) for qid, q in qs.items()}
    # union-find over copies
    par = {q: q for q in qs}
    def f(x):
        while par[x] != x: par[x] = par[par[x]]; x = par[x]
        return x
    def u(a, b):
        if a in par and b in par: par[f(a)] = f(b)
    for a, b in db.execute("select question_id, related_id from related_questions where relation='duplicate'"): u(a, b)
    per_doc = collections.Counter((q['document_id'], nat[qid]) for qid, q in qs.items())
    same = collections.defaultdict(list)   # a paper filed twice: same natural key in two documents, once in each
    for qid, q in qs.items():
        if per_doc[(q['document_id'], nat[qid])] == 1: same[nat[qid]].append(qid)
    for ids in same.values():
        for x in ids[1:]: u(ids[0], x)
    groups = collections.defaultdict(list)
    for q in qs: groups[f(q)].append(q)
    held = collections.defaultdict(set)   # key -> live question ids holding it
    for qid, k in have.items(): held[k].add(qid)
    issued = set(r['key'] for r in rows.values())
    new = {}
    order = lambda q: (not (kept or {}).get(q, False) if kept else False, qs[q]['review_status'] != 'approved', q)
    for g in sorted(groups.values(), key=lambda g: min(g)):
        g = sorted(g, key=order); todo = [q for q in g if q not in have]
        if not todo:
            if len({have[q] for q in g}) > 1: problems.append('copies with different keys (kept as they are): ' + ', '.join(f'{q}={have[q]}' for q in g))
            continue
        ks = [have[q] for q in g if q in have]
        if ks: key = ks[0]   # the group already has a key: the newcomers join it (first = the kept copy's, when it has one)
        else:
            base = nat[g[0]]; key = base; n = 1
            while held[key] - set(g):   # a different live question holds it: tell them apart
                n += 1; key = f'{base}~{n}'
            if key in issued and not held[key]: problems.append(f'{key}: re-attached to {g} (its earlier question is gone)')
        for q in todo: new[q] = key; held[key].add(q)
    return new, problems


def assign(db, kept=None, dry=False, quiet=False):
    """Store keys for questions without one. Returns {qid: key} for every live question."""
    if not dry: ensure(db)
    new, problems = plan(db, kept)
    if not quiet:
        for p in problems: print('qkeys:', p)
        print(f'qkeys: {len(new)} new key(s){" (dry run, nothing written)" if dry else ""}')
    if not dry and new:
        now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
        doc = dict(db.execute('select id, document_id from questions'))
        db.execute('delete from question_keys where question_id in (%s)' % ','.join('?' * len(new)), list(new))   # reused ids only
        db.executemany('insert into question_keys(question_id, key, assigned_at, document_id) values (?,?,?,?)',
                       [(q, k, now, doc[q]) for q, k in sorted(new.items())])
        db.commit()
    out = live_keys(db) if not dry else {}
    out.update(new)
    return out


def paper_keys(keys, qdoc):
    """{doc_id: paper key} from the question keys (the most common prefix of its questions' keys), so a paper's key is as
    permanent as its questions'. qdoc: {qid: doc_id}."""
    c = collections.defaultdict(collections.Counter)
    for q, k in keys.items():
        if q in qdoc: c[qdoc[q]][k.rsplit('-Q', 1)[0]] += 1
    return {d: n.most_common(1)[0][0] for d, n in c.items()}


def attach(db, questions, docs):
    """build_bank hook: assign missing keys (the Bank's kept copy wins), then set q['key'] and docs[doc]['key']."""
    keys = assign(db, kept={q['id']: not q.get('dup_of') for q in questions})
    for q in questions: q['key'] = keys.get(q['id'])
    # 23 Nov (Batch 12): count only the paper's own questions. Copies carry the original's key, and 2022 NEAP (23 of its 32 questions
    # copies of 2022 Knox AT4) took Knox's paper key, so Knox's paper decision showed on NEAP. A paper made only of copies (one filed
    # twice, e.g. CSSA 2022 doc 510) keeps the key from all its questions.
    pk = paper_keys(keys, {q['id']: q['doc'] for q in questions})
    pk.update(paper_keys(keys, {q['id']: q['doc'] for q in questions if not q.get('dup_of')}))
    for d, k in pk.items():
        if str(d) in docs: docs[str(d)]['key'] = k
    miss = [q['id'] for q in questions if not q.get('key')]
    if miss: print('WARN qkeys: questions without a key', miss[:20])
    return keys


def check(db, bank=None):
    """batch_check (Fix 2): [(level, message)]. Blocks when a stored decision (page_* mirror of the page database: a review,
    difficulty check, saved exam or report) points at a key no live question has, or bank.json disagrees with question_keys."""
    out = []
    if not table_exists(db):
        return [('warn', 'question_keys missing: questions have no permanent keys yet (python3 tools/qkeys.py --assign --bank site/data/bank.json, after an archive/ copy of questions.db)')]
    keys = live_keys(db); live = set(keys.values())
    pk = set(paper_keys(keys, dict(db.execute('select id, document_id from questions'))).values())
    if bank:
        bad = [q['id'] for q in bank['questions'] if q.get('key') != keys.get(q['id'])]
        if bad: out.append(('blocker', f'bank.json keys differ from question_keys for {len(bad)} question(s) {bad[:10]}: run tools/build_bank.py'))
    has = lambda t: db.execute("select 1 from sqlite_master where name=?", (t,)).fetchone() is not None
    J = lambda s: json.loads(s) if s else {}
    lost = []
    if has('page_reviews'):
        for k, d in db.execute('select doc_key, data_json from page_reviews'):
            if k.startswith('k_') and k[2:] not in live: lost.append('reviews/' + k)
            if k.startswith('p_') and k[2:] not in pk: lost.append('reviews/' + k)
    if has('page_difficulty'):
        for i, d in db.execute('select part_id, data_json from page_difficulty'):
            k = J(d).get('key')
            if k and k not in live: lost.append(f'difficulty/{i} ({k})')
    if has('page_exams'):
        for i, d in db.execute('select id, data_json from page_exams'):
            for k in J(d).get('keys') or []:
                if k and k not in live: lost.append(f'exams/{i} ({k})')
    if has('page_reports'):
        for i, d in db.execute('select id, data_json from page_reports'):
            k = J(d).get('key')
            if k and k not in live: lost.append(f'reports/{i} ({k})')
    if lost: out.append(('blocker', f'{len(lost)} page decision(s) point at a question key that no longer exists: {lost[:8]} (re-attach them, or restore the question)'))
    else: out.append(('info', f'question keys: {len(keys)} questions, {len(live)} keys; every stored decision points at a live key'))
    return out


def main():
    a = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    a.add_argument('--db', default=DB); a.add_argument('--assign', action='store_true'); a.add_argument('--dry-run', action='store_true')
    a.add_argument('--bank', help='bank.json: its dup_of decides which copy is kept'); a.add_argument('--show', nargs='*', type=int)
    o = a.parse_args()
    db = sqlite3.connect(o.db)
    kept = None
    if o.bank: kept = {q['id']: not q.get('dup_of') for q in json.load(open(o.bank))['questions']}
    if o.assign:
        keys = assign(db, kept, dry=o.dry_run)
        print(f'qkeys: {len(keys)} questions keyed, {len(set(keys.values()))} distinct keys')
    if o.show:
        keys = live_keys(db) if not o.dry_run else assign(db, kept, dry=True, quiet=True)
        for q in o.show: print(q, keys.get(q))


if __name__ == '__main__':
    main()
