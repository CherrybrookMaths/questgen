"""Build the Import dashboard data (review page #import) from work/import/batches.json + the database.
Usage: python3 progress.py ["log message"] -> writes site/data/progress.json (also the payload written to the page db doc progress/import).
batches.json holds per-batch stage states (done/running/waiting/failed/n/a), running workflows and the log;
owner calls are never kept here: they are raised as Your calls in site/project/open_decisions.json (IMPORT_PLAYBOOK, owner 13 Nov);
counts (parsed, published, questions, diagrams) are computed here so they never drift."""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import json, sqlite3, sys, os, glob, datetime
P = paths.P
S = json.load(open(paths.S + 'work/import/batches.json'))
now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
if len(sys.argv) > 1: S['log'].append(dict(t=now, msg=sys.argv[1])); S['log'] = S['log'][-60:]
json.dump(S, open(paths.S + 'work/import/batches.json', 'w'), indent=1)
db = sqlite3.connect(paths.DBS)
allids = [i for b in S['batches'] for i in b['ids']]
bank = json.load(open(P + 'site/data/bank.json'))
pub = {q['doc'] for q in bank['questions']} & set(allids)
done_figs = {r['id'] for r in json.load(open(paths.S + 'tikz/all_results.json'))}
figs_total = figs_done = 0
for b in S['batches']:
    IN = ','.join(map(str, b['ids']))
    b['questions'] = db.execute(f'select count(*) from questions where document_id in ({IN})').fetchone()[0] or None
    for (png,) in db.execute(f'select f.png_path from figures f join questions q on q.id=f.question_id where q.document_id in ({IN})'):
        figs_total += 1; figs_done += os.path.basename(png)[:-4] in done_figs
parsed = sum(os.path.exists(paths.S + f'out/{i}.json') for i in allids)
gen = db.execute("select count(*) from solutions s left join parts p on p.id=s.part_id join questions q on q.id=coalesce(s.question_id,p.question_id) where s.source='generated' and q.document_id in (%s)" % ','.join(map(str, allids))).fetchone()[0]
out = dict(updated=now, eta=S.get('eta'), totals=dict(papers_total=len(allids), parsed=parsed, published=len(pub),
           questions=db.execute('select count(*) from questions where document_id in (%s)' % ','.join(map(str, allids))).fetchone()[0],
           figures_total=figs_total, figures_redrawn=figs_done, solutions_written=gen),
           running=S['running'], batches=[{k: b.get(k) for k in ('id', 'papers', 'stages', 'note', 'questions')} for b in S['batches']],
           log=S['log'][-15:])
json.dump(out, open(P + 'site/data/progress.json', 'w'), ensure_ascii=False)
print(json.dumps(out['totals']))
