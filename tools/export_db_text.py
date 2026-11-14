#!/usr/bin/env python3
"""Plain-text copy of questions.db, one file per paper, so git keeps the database's history line by line (Fix 2 of the plan
"Questgen architecture plan: before imports resume"; owner 14 Nov: "Ok we should run Fix 1 and 2").

Writes <out>/papers/<paper key>.d<doc id>.txt: the document row, then every question in paper order (number, then id) with
its key, columns, MCQ options, related questions, parts (by ordinal) with their tags, solutions, difficulty, figures and data
tables. <out>/_keys.txt lists every question key (also those of deleted questions: keys are never reissued), and
<out>/_page/<collection>.txt the page-decision mirror (page_* tables, tools/sync_pagedb.py) by doc key. Ordering and
formatting are fixed and there is no timestamp of the export itself, so an unchanged database gives byte-identical files
and `git diff` shows exactly what changed. Files of papers that left the database are removed.

When: on every publish. `python3 tools/batch_check.py --mark-published` -> tools/snapshot.py publish() runs this into
<repo>/dbtext/ just before `git add -A`, so each publish-vNNN tag holds the database as text. By hand:
  python3 tools/export_db_text.py [--db DB] [--out dbtext]
DB defaults to tools/paths.py DB ($QG_DB, ...) (opened read only).
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import argparse, json, os, re, sqlite3, sys

P = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = paths.DBS
SKIP = {'sha256', 'text_fingerprint', 'cover_excerpt'}   # bulky or machine-only document columns


def val(v):
    if isinstance(v, str) and v[:1] in '[{':
        try: v = json.loads(v)
        except ValueError: pass
    if isinstance(v, (dict, list)): v = json.dumps(v, ensure_ascii=False, sort_keys=True)
    return '' if v is None else str(v)


def block(out, ind, row, skip=()):
    for k in row.keys():
        if k in skip or row[k] is None: continue
        s = val(row[k])
        if '\n' in s: out.append(f'{ind}{k}: |'); out.extend(f'{ind}  {l}'.rstrip() for l in s.split('\n'))
        else: out.append(f'{ind}{k}: {s}')


def has(db, t):
    return db.execute("select 1 from sqlite_master where type='table' and name=?", (t,)).fetchone() is not None


def numkey(n):
    m = re.match(r'(\d+)(.*)', str(n or '')); return (int(m.group(1)), m.group(2)) if m else (9999, str(n))


def export(db, out):
    db.row_factory = sqlite3.Row
    sys.path.insert(0, os.path.join(P, 'tools')); import qkeys
    keys = qkeys.live_keys(db)
    qdoc = dict(db.execute('select id, document_id from questions'))
    pk = qkeys.paper_keys(keys, qdoc)
    docs = {r['id']: r for r in db.execute('select * from documents where id in (select document_id from questions)')}
    tables = {}
    for t in db.execute('select * from data_tables order by id'): tables.setdefault((t['owner_table'], t['owner_id']), []).append(t)
    def dtab(lines, ind, owner, oid):
        for t in tables.get((owner, oid), []): lines.append(f'{ind}data_table {t["id"]}'); block(lines, ind + '  ', t, ('id', 'owner_table', 'owner_id'))
    dif = has(db, 'part_difficulty')
    written = set()
    os.makedirs(os.path.join(out, 'papers'), exist_ok=True)
    for d, doc in sorted(docs.items()):
        name = f'{pk.get(d) or qkeys.paper_key(doc)}.d{d}.txt'; written.add(name)
        L = [f'# paper {pk.get(d) or qkeys.paper_key(doc)} (document {d})', 'document']; block(L, '  ', doc, SKIP)
        qs = sorted(db.execute('select * from questions where document_id=?', (d,)), key=lambda q: (numkey(q['number']), q['id']))
        for q in qs:
            L += ['', f'## Q{q["number"]}  key {keys.get(q["id"], "-")}  id {q["id"]}']; block(L, '  ', q, ('id', 'document_id', 'number'))
            for o in db.execute('select * from mcq_options where question_id=? order by label, id', (q['id'],)):
                L.append(f'  option {o["label"]}'); block(L, '    ', o, ('id', 'question_id', 'label'))
            for r in db.execute('select * from related_questions where question_id=? order by related_id', (q['id'],)):
                L.append(f'  related {r["related_id"]} ({keys.get(r["related_id"], "-")}) {r["relation"]} {r["similarity"]}')
            dtab(L, '  ', 'questions', q['id'])
            for s in db.execute('select * from solutions where question_id=? and part_id is null order by id', (q['id'],)):
                L.append(f'  solution {s["id"]}'); block(L, '    ', s, ('id', 'question_id', 'part_id')); dtab(L, '    ', 'solutions', s['id'])
            for f in db.execute('select * from figures where question_id=? and part_id is null order by png_path, id', (q['id'],)):
                L.append(f'  figure {os.path.basename(f["png_path"] or "")}'); block(L, '    ', f, ('id', 'question_id', 'part_id'))
            for p in db.execute('select * from parts where question_id=? order by ordinal, id', (q['id'],)):
                L.append(f'  part {p["label"] or "-"}  id {p["id"]}'); block(L, '    ', p, ('id', 'question_id', 'label'))
                dtab(L, '    ', 'parts', p['id'])
                for t in db.execute('select * from tags where part_id=? order by scheme, code, dot_point, id', (p['id'],)):
                    L.append(f'    tag {t["scheme"]} {t["code"] or ""}'.rstrip()); block(L, '      ', t, ('id', 'part_id', 'question_id', 'scheme', 'code'))
                for s in db.execute('select * from solutions where part_id=? order by id', (p['id'],)):
                    L.append(f'    solution {s["id"]}'); block(L, '      ', s, ('id', 'question_id', 'part_id')); dtab(L, '      ', 'solutions', s['id'])
                for f in db.execute('select * from figures where part_id=? order by png_path, id', (p['id'],)):
                    L.append(f'    figure {os.path.basename(f["png_path"] or "")}'); block(L, '      ', f, ('id', 'question_id', 'part_id'))
                if dif:
                    for r in db.execute('select * from part_difficulty where part_id=?', (p['id'],)):
                        L.append('    difficulty'); block(L, '      ', r, ('part_id', 'question_id'))
        txt = '\n'.join(L) + '\n'
        f = os.path.join(out, 'papers', name)
        if not os.path.exists(f) or open(f, encoding='utf-8').read() != txt: open(f, 'w', encoding='utf-8').write(txt)
    gone = [f for f in os.listdir(os.path.join(out, 'papers')) if f.endswith('.txt') and f not in written]
    for f in gone: os.remove(os.path.join(out, 'papers', f))
    side = {}
    if qkeys.table_exists(db):
        side['_keys.txt'] = ''.join(f'{r["key"]}\t{r["question_id"]}\t{r["document_id"]}\t{r["assigned_at"]}\t{"live" if r["question_id"] in qdoc else "deleted"}\n'
                                    for r in db.execute('select * from question_keys order by key, question_id'))
    for t, k in (('page_reviews', 'doc_key'), ('page_difficulty', 'part_id'), ('page_exams', 'id'), ('page_reports', 'id'), ('page_importq', 'doc_key')):
        if not has(db, t): continue
        L = []
        for r in db.execute(f'select {k}, data_json from {t} order by {k}'): L.append(f'{r[0]}\t{val(r[1])}')
        side[f'_page/{t[5:]}.txt'] = '\n'.join(L) + '\n'
    for n, txt in side.items():
        f = os.path.join(out, n); os.makedirs(os.path.dirname(f), exist_ok=True)
        if not os.path.exists(f) or open(f, encoding='utf-8').read() != txt: open(f, 'w', encoding='utf-8').write(txt)
    return len(written), len(gone)


def main():
    a = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    a.add_argument('--db', default=DB); a.add_argument('--out', default=os.path.join(P, 'dbtext'))
    o = a.parse_args()
    db = sqlite3.connect('file:%s?mode=ro' % o.db, uri=True)
    n, g = export(db, o.out)
    size = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(o.out) for f in fs)
    print(f'export_db_text: {n} papers in {o.out} ({size // 1024} KB){f", {g} removed" if g else ""}')


if __name__ == '__main__':
    main()
