"""Duplicate sweep, 25 Nov (owner: "I found two trapezoidal rule questions which are duplicates. I thought we were checking for dupes
upon import? Or at least after import?" ... "Yes do that."). Every pair the built bank relates as numbers_changed/variant at
sim >= 0.75 where neither is a hidden copy, compared number by number with tools/dedup.py same_numbers().
  QG_DB=... python3 work/dupes_1125/sweep.py [--apply]      writes work/dupes_1125/sweep.json + sweep.txt; --apply records duplicates
"""
import json, os, sqlite3, sys
sys.path.insert(0, 'tools')
import dedup, paths

db = sqlite3.connect(paths.DBS)
bank = json.load(open('site/data/bank.json'))
qs = {q['id']: q for q in bank['questions']}
docs = bank['docs']
pairs = {}
for q in qs.values():
    for r in q.get('related') or []:
        o = qs.get(r['q'])
        if r['rel'] in ('numbers_changed', 'variant') and r['sim'] >= dedup.NEAR and o and not q.get('dup_of') and not o.get('dup_of'):
            pairs[(min(q['id'], o['id']), max(q['id'], o['id']))] = r['sim']
lab = lambda i: f"{docs[str(qs[i]['doc'])]['label']} Q{qs[i]['number']}"
out, lines = [], []
for (a, b), sim in sorted(pairs.items(), key=lambda x: -x[1]):
    row = db.execute('select question_id, related_id, relation from related_questions where (question_id=? and related_id=?) or (question_id=? and related_id=?)', (a, b, b, a)).fetchone()
    v, d = dedup.same_numbers(db, a, b)
    verdict = {'same': 'duplicate', 'differ': 'numbers_changed', 'unknown': 'look (crop)'}[v]
    out.append(dict(a=a, b=b, sim=sim, a_label=lab(a), b_label=lab(b), db_relation=row[2] if row else None, verdict=verdict, detail=d))
    diff = []
    if d['text_only_a'] or d['text_only_b']: diff.append('text %s vs %s' % (','.join(d['text_only_a']) or '-', ','.join(d['text_only_b']) or '-'))
    if d.get('words'): diff.append('words %s vs %s' % tuple(','.join(x) for x in d['words']))
    if d.get('shape'): diff.append('type/course/parts %s vs %s' % tuple('/'.join(map(str, x)) for x in d['shape']))
    if d.get('figs_count'): diff.append('figures %d vs %d' % tuple(d['figs_count']))
    if d['labels_only_a'] or d['labels_only_b']: diff.append('diagram %s vs %s' % (','.join(d['labels_only_a']) or '-', ','.join(d['labels_only_b']) or '-'))
    if d.get('crops'): diff.append('no TikZ source (crop): ' + ','.join(d['crops']))
    if d['maths_only_a'] or d['maths_only_b']: diff.append('formulas %s vs %s' % (' '.join(d['maths_only_a'])[:120] or '-', ' '.join(d['maths_only_b'])[:120] or '-'))
    wd = 'wording only in each: %s | %s' % (' '.join(d['wording'][0])[:100] or '-', ' '.join(d['wording'][1])[:100] or '-')
    lines.append(f"{a} ~ {b}  sim {sim:.2f}  {verdict.upper()}\n    {lab(a)}  |  {lab(b)}\n    {'; '.join(diff) or 'all numbers, formulas and diagram labels the same'}\n    {wd}")
apply = '--apply' in sys.argv
n = 0
for r in out:
    if r['verdict'] == 'duplicate' and apply:
        n += db.execute("update related_questions set relation='duplicate' where ((question_id=? and related_id=?) or (question_id=? and related_id=?)) and relation in ('numbers_changed','variant')",
                        (r['a'], r['b'], r['b'], r['a'])).rowcount
db.commit()
import collections
cnt = collections.Counter(r['verdict'] for r in out)
head = f"Duplicate sweep 25 Nov: {len(out)} pairs (bank numbers_changed/variant, sim >= {dedup.NEAR}, neither a hidden copy). " + \
       ', '.join(f'{k} {v}' for k, v in sorted(cnt.items())) + (f'. Recorded as duplicate in related_questions: {n}.' if apply else '.')
json.dump(dict(summary=head, pairs=out), open('work/dupes_1125/sweep.json', 'w'), indent=1, default=list)
open('work/dupes_1125/sweep.txt', 'w').write(head + '\nNumbers compared: stem, parts, MCQ options, option tables, data tables, diagram labels (TikZ node text).\n\n' +
                                             '\n'.join(l for l, r in zip(lines, out) if r['verdict'] == 'duplicate') + '\n\n--- kept as numbers_changed / look ---\n' +
                                             '\n'.join(l for l, r in zip(lines, out) if r['verdict'] != 'duplicate') + '\n')
print(head)
