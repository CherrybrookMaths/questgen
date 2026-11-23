#!/usr/bin/env python3
"""Mark questions that need the z-score table at the back of an exam (state/work/ztable.json -> bank q.zt).

Owner 17 Nov: "Some questions say refer to the z score table at the back of the exam. For THOSE specifically, we arenot adding
the z score table in ... We need a way to append a z score table at the back of exams which ahve those questions tho. ... Also
add a rule for future imports. Questions which have a pportion of the ztable in there arleady we will keep."

A question is marked when its text (stem or any part) points to a normal-distribution / z-score table printed elsewhere in the
paper ("the table on page 33", "at the back", "z-score table", "probability table" ...) AND the question carries no table of its
own (no \\extable, no figure classed as a table). Questions that print their own portion keep it and are not marked. The page
appends the computed table (page_src/js/19_ztable.js) to any exam holding a marked question; Review's "Z-score table at the
back" button adds or removes a mark by hand (reviews zt), which wins over this file.

  python3 tools/ztable.py           list candidates, write state/work/ztable.json {key: reason}
  python3 tools/ztable.py --check   exit 1 if a candidate is not in the file (run after an import: IMPORT_PLAYBOOK "Z-score table")
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import json, re, sqlite3, sys

OUT = paths.S + 'work/ztable.json'
NORMAL = re.compile(r'normal(ly)? distribut|z[- ]?scores?|standard normal|\$?z\$?-score', re.I)
ELSEWHERE = re.compile(r'table (on|at) page \d+|table (provided|given|supplied|attached)|(provided|attached|given) table|'
                       r'(back|end) of (the|this) (paper|exam|booklet)|appendix|z[- ]?(score )?tables?|probability tables?|'
                       r'normal (distribution )?tables?|table of (z|standard|normal|probabilit)', re.I)


def candidates():
    db = sqlite3.connect(paths.DB)
    figs = {}
    rp = paths.S + 'tikz/all_results.json'
    if os.path.exists(rp): figs = {r['id']: r for r in json.load(open(rp))}
    out = {}
    for qid, key, stem in db.execute('select q.id, coalesce(k.key, ""), q.stem_latex from questions q left join question_keys k on k.question_id=q.id'):
        text = (stem or '') + ' ' + ' '.join(t or '' for (t,) in db.execute('select latex from parts where question_id=?', (qid,)))
        if not (NORMAL.search(text) and (m := ELSEWHERE.search(text))): continue
        own = '\\extable' in text or any((figs.get(k) or {}).get('status') == 'table' or (figs.get(k) or {}).get('cls') == 'table'
                                         for k in re.findall(r'\\exfigure\{([\w.()-]+)\}', text))
        if not own: out[key or 'q%d' % qid] = 'refers to "%s", prints no table' % m.group(0)
    return out


WHOLE_ROWS = 30   # a full standard normal table has 30-40 rows; the portions questions keep (Q865: 21, Q798: 2) are shorter


def whole_tables():
    """Questions that print a WHOLE z-table (owner 17 Nov: "QID 1099 ... still has the table in the question"): a table of 30+
    rows, linked to the question (its own table, or the table of one of its figures), whose question is about the normal
    distribution. These lose the table (data_tables_retired) and point to "the table at the back of this exam"."""
    db = sqlite3.connect(paths.DB); out = {}
    keys = dict(db.execute('select question_id, key from question_keys'))
    rows = [(oid, tid, rj) for tid, oid, rj in db.execute("select id, owner_id, rows_json from data_tables where owner_table='questions'")]
    rows += [(q, tid, rj) for tid, q, rj in db.execute("select t.id, f.question_id, t.rows_json from data_tables t join figures f on t.id = f.redraw_table_id")]
    for qid, tid, rj in rows:
        stem = db.execute('select stem_latex from questions where id=?', (qid,)).fetchone()
        if stem and NORMAL.search(stem[0] or '') and len(json.loads(rj or '[]')) >= WHOLE_ROWS:
            out[keys.get(qid, 'q%d' % qid)] = 'prints a whole z-table (%s, %d rows): remove it' % (tid, len(json.loads(rj)))
    return out


def main():
    found = candidates(); have = json.load(open(OUT)) if os.path.exists(OUT) else {}
    new = {k: v for k, v in found.items() if k not in have}
    whole = whole_tables()
    for k, v in whole.items(): print('  WHOLE TABLE:', k, v)
    if '--check' in sys.argv:
        for k, v in new.items(): print('  not marked:', k, v)
        print(f'ztable: {len(have)} marked, {len(new)} new candidate(s), {len(whole)} whole table(s) to remove'); sys.exit(1 if new or whole else 0)
    have.update(new); json.dump(have, open(OUT, 'w'), indent=1, sort_keys=True)
    for k, v in have.items(): print(' ', k, v)
    print(f'ztable: {len(have)} marked ({len(new)} new) -> {OUT[len(paths.P):]}')


import os
if __name__ == '__main__':
    main()
