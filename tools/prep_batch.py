"""Prepare downstream inputs for an import batch (after load.py).
Usage: python3 prep_batch.py <batch> <doc_id> [...]
Writes: tag/in_<batch>_<g>.json (~150 parts each), work/<batch>/solfmt_in_<g>.json (~100 each),
work/<batch>/gen_in_<g>.json (questions with leaf parts / MCQs lacking any working, ~16 questions each),
tikz/group_<batch>_<g>.json (~26 figures each, a question's figures kept together).
Prints JSON counts {tag, solfmt, gen, diag} = number of groups of each kind."""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import sqlite3, json, glob, os, re, sys
from itertools import groupby
P = paths.P
B = sys.argv[1]; NEW = tuple(int(a) for a in sys.argv[2:])
os.makedirs(P + f'work/{B}', exist_ok=True)
db = sqlite3.connect(paths.DBS); db.row_factory = sqlite3.Row
dps = json.load(open(P + 'site/project/syllabus_dotpoints.json'))
IN = '(%s)' % ','.join(map(str, NEW))
lab = {r['id']: r['display_label'] for r in db.execute(f'select id,display_label from documents where id in {IN}')}
def ctx_of(q):
    parts = db.execute('select * from parts where question_id=? order by ordinal,id', (q['id'],)).fetchall()
    opts = ' | '.join(f"{o['label']}: {o['latex']}" for o in db.execute('select * from mcq_options where question_id=? order by label', (q['id'],)))
    return parts, opts
def split(items, size):
    k = max(1, round(len(items) / size)) if items else 0
    return [items[g * len(items) // k:(g + 1) * len(items) // k] for g in range(k)]
out = {}
# tagging
items = []
for q in db.execute(f'select * from questions where document_id in {IN} order by document_id,id'):
    parts, opts = ctx_of(q); byid = {p['id']: p for p in parts}
    for p in parts:
        chain = []; par = p['parent_part_id']
        while par: chain.insert(0, byid[par]['latex']); par = byid[par]['parent_part_id']
        items.append(dict(part_id=p['id'], doc=q['document_id'], q=q['number'], label=p['label'], marks=p['marks'], type=q['question_type'],
                          context=' '.join(x for x in [q['stem_latex'] or ''] + chain if x), text=p['latex'], options=opts, areas=[]))
gs = split(items, 150)
for g, it in enumerate(gs): json.dump({'dotpoints': dps, 'parts': it}, open(P + f'tag/in_{B}_{g+1}.json', 'w'), ensure_ascii=False)
out['tag'] = len(gs)
# solution formatting
sols = []
for s in db.execute(f"select s.*, coalesce(s.question_id,p.question_id) qid, p.label plabel from solutions s left join parts p on p.id=s.part_id where coalesce(s.question_id,p.question_id) in (select id from questions where document_id in {IN}) order by s.id"):
    q = db.execute('select * from questions where id=?', (s['qid'],)).fetchone(); parts, opts = ctx_of(q)
    qc = f"{lab[q['document_id']]} Q{q['number']} ({q['question_type']}). " + (q['stem_latex'] or '') + '\n' + '\n'.join(f"({p['label']}) [{p['marks']}] {p['latex']}" for p in parts) + ('\nOptions: ' + opts if opts else '')
    key = [o['label'] for o in db.execute('select * from mcq_options where question_id=? and is_correct=1', (q['id'],))]
    sols.append(dict(id=s['id'], question_id=q['id'], part=s['plabel'], source=s['source'], mcq=q['question_type'] == 'mcq', mcq_key=key[0] if key else None,
                     question_context=qc, latex=s['latex'], criteria=json.loads(s['criteria_json'] or '[]'), meta=json.loads(s['meta_json'] or '{}')))
gs = split(sols, 100)
for g, it in enumerate(gs): json.dump(it, open(P + f'work/{B}/solfmt_in_{g+1}.json', 'w'), ensure_ascii=False, indent=1)
out['solfmt'] = len(gs)
# questions needing generated working (same test as coverage_check.py)
has = lambda where, args: any((l or '').strip() for l, in db.execute(f'select latex from solutions where {where}', args))
gen = []
for q in db.execute(f'select * from questions where document_id in {IN} order by document_id,id'):
    parts, opts = ctx_of(q); kids = {p['parent_part_id'] for p in parts}
    if q['question_type'] == 'mcq':
        need = not has('question_id=? or part_id in (select id from parts where question_id=?)', (q['id'], q['id']))
    else:
        need = any(p['id'] not in kids and not (has('part_id=?', (p['id'],)) or (p['parent_part_id'] and has('part_id=?', (p['parent_part_id'],))) or has('question_id=?', (q['id'],))) for p in parts)
    if not need: continue
    gen.append(dict(question_id=q['id'], doc=q['document_id'], paper=lab[q['document_id']], number=q['number'], type=q['question_type'], marks=q['marks_total'], stem=q['stem_latex'],
                    parts=[dict(part_id=p['id'], label=p['label'], parent=p['parent_part_id'], leaf=p['id'] not in kids, marks=p['marks'], latex=p['latex'],
                                has_solution=has('part_id=?', (p['id'],))) for p in parts],
                    options=[dict(label=o['label'], latex=o['latex'], fig=o['figure_key'], key=o['is_correct']) for o in db.execute('select * from mcq_options where question_id=? order by label', (q['id'],))],
                    figures=[f['png_path'] for f in db.execute('select png_path from figures where question_id=?', (q['id'],))], pages=[q['page_start'], q['page_end']]))
gs = split(gen, 16)
for g, it in enumerate(gs): json.dump(it, open(P + f'work/{B}/gen_in_{g+1}.json', 'w'), ensure_ascii=False, indent=1)
out['gen'] = len(gs)
# diagrams (question figures + solution sketches); skip ones already redrawn
done = {r['id'] for r in json.load(open(paths.S + 'tikz/all_results.json'))}
figs = []
for f in db.execute(f'select f.*, q.document_id doc, q.number, q.stem_latex from figures f join questions q on q.id=f.question_id where q.document_id in {IN} order by q.document_id, q.id, f.id'):
    k = os.path.basename(f['png_path'])[:-4]
    if k in done or not os.path.exists(P + f['png_path']): continue
    q = db.execute('select * from questions where id=?', (f['question_id'],)).fetchone(); parts, opts = ctx_of(q)
    issol = bool(re.search(r'_s\d+$', k))
    if issol:
        sl = ' '.join(r[0] for r in db.execute('select s.latex from solutions s left join parts p on p.id=s.part_id where coalesce(s.question_id,p.question_id)=?', (q['id'],)))
        ctx = f"{lab[f['doc']]} Q{f['number']} SOLUTION figure. Question: " + (q['stem_latex'] or '') + ' ' + ' '.join(f"({p['label']}) {p['latex']}" for p in parts) + ' Solution text: ' + sl
    else:
        ctx = f"{lab[f['doc']]} Q{f['number']}: " + (f['stem_latex'] or '') + ' ' + ' '.join(f"({p['label']}) {p['latex']}" for p in parts) + (' Options: ' + opts if opts else '')
    figs.append(dict(id=k, context=ctx[:2500], caption=f['caption'], kind='solution' if issol else ('option' if (f['caption'] or '').startswith('option') else 'question'), doc=f['doc']))
groups = [[]]
for key, it in groupby(figs, key=lambda f: '_'.join(f['id'].split('_')[:2])):
    it = list(it)
    if groups[-1] and len(groups[-1]) + len(it) > 26: groups.append([])
    groups[-1] += it
groups = [g for g in groups if g]
for g, it in enumerate(groups): json.dump(it, open(P + f'tikz/group_{B}_{g+1}.json', 'w'), ensure_ascii=False, indent=1)
out['diag'] = len(groups); out['counts'] = dict(parts=len(items), solutions=len(sols), gen_questions=len(gen), figures=len(figs))
print(json.dumps(out))
