#!/usr/bin/env python3
"""API costs, per paper and per batch, for Processes › Papers › Costs (owner 21 Nov: "I want to see somewhere the costs logged
properly, per paper, per batch total", then "Yeah build it").

Reads every call the importer logged (state/work/api_import/<run>/calls.jsonl: one line per API call with step, doc, model,
tokens and usd; tools/api_import.py) and writes site/data/costs.json, which the page reads. Nothing here is typed in by hand:
batch totals, per-paper costs, steps, months and the cost per paper the queue estimate uses all come from the logs.
  - run b<N>: import batch N; b<N>r (a re-verify of batch N) counts in batch N.
  - any other run (e.g. diff1, the 70-paper difficulty rating): "other API spend", outside the batch averages.
  - batches 1-7 ran inside Claude sessions, not through the API: they have no calls and appear as "not metered".
Run after every batch (tools/api_import.py cost does it) and at every publish (tools/prepublish.sh).
  python3 tools/costs.py
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import collections, glob, json, os, re, sqlite3

# owner 18 Nov: "the monthly limit is $300 right now. I can change it later." (the one number kept here: it is a setting, not data)
MONTHLY_LIMIT_USD = 300
OUT = paths.P + 'site/data/costs.json'
FIRST_API_BATCH = 8     # Batch 8 was the first through the API (owner 17 Nov: "I want to do batch 8 via the api so we can get a cost estimate")


def build():
    db = sqlite3.connect(f'file:{paths.DBS}?mode=ro', uri=True)
    label = dict(db.execute('SELECT id, display_label FROM documents'))
    nq = collections.Counter(d for (d,) in db.execute('SELECT document_id FROM questions'))
    runs = collections.defaultdict(list)
    for f in sorted(glob.glob(paths.S + 'work/api_import/*/calls.jsonl')):
        name = os.path.basename(os.path.dirname(f))
        rows = [json.loads(l) for l in open(f) if l.strip()]
        m = re.fullmatch(r'b(\d+)r?', name)
        runs[('batch', int(m.group(1))) if m else ('other', name)] += rows
    batches, other, months = [], [], collections.Counter()
    for (kind, k), rows in sorted(runs.items(), key=lambda x: (x[0][0], str(x[0][1]).zfill(4))):
        for r in rows: months[r['t'][:7]] += r.get('usd', 0)
        usd = sum(r.get('usd', 0) for r in rows)
        dates = sorted(r['t'] for r in rows)
        if kind == 'other':
            other.append({'name': k, 'usd': round(usd, 2), 'calls': len(rows), 'from': dates[0][:10], 'to': dates[-1][:10],
                          'steps': sorted({r.get('step') for r in rows if r.get('step')}),
                          'papers': len({r['doc'] for r in rows if r.get('doc')})})
            continue
        per = collections.defaultdict(lambda: collections.Counter())
        for r in rows:
            per[r.get('doc')][r.get('step') or '?'] += r.get('usd', 0)
        shared = sum(per.pop(None, collections.Counter()).values())   # calls not tied to one paper (e.g. split checks)
        papers = [{'doc': d, 'label': label.get(d) or f'paper {d}', 'questions': nq.get(d, 0), 'usd': round(sum(s.values()), 2),
                   'steps': {st: round(v, 3) for st, v in sorted(s.items(), key=lambda x: -x[1])}}
                  for d, s in per.items()]
        papers.sort(key=lambda p: -p['usd'])
        steps = collections.Counter()
        for r in rows: steps[r.get('step') or '?'] += r.get('usd', 0)
        q = sum(p['questions'] for p in papers)
        batches.append({'n': k, 'date': dates[0][:10], 'usd': round(usd, 2), 'calls': len(rows), 'papers': papers,
                        'shared_usd': round(shared, 2), 'questions': q,
                        'per_paper': round(usd / max(len(papers), 1), 2), 'per_question': round(usd / q, 3) if q else None,
                        'steps': {st: round(v, 2) for st, v in sorted(steps.items(), key=lambda x: -x[1])},
                        'models': sorted({r.get('model') for r in rows if r.get('model')})})
    pp = [b['per_paper'] for b in batches]
    np_ = sum(len(b['papers']) for b in batches)
    return {'made': __import__('time').strftime('%Y-%m-%dT%H:%M'), 'limit_usd': MONTHLY_LIMIT_USD, 'first_api_batch': FIRST_API_BATCH,
            'batches': sorted(batches, key=lambda b: -b['n']), 'other': other,
            'months': {m: round(v, 2) for m, v in sorted(months.items())},
            'total_usd': round(sum(months.values()), 2), 'batch_usd': round(sum(b['usd'] for b in batches), 2),
            # what the queue's estimate uses: the range of the measured batch averages, and the overall mean per paper
            'per_paper': {'lo': min(pp), 'hi': max(pp), 'mean': round(sum(b['usd'] for b in batches) / np_, 2)} if pp else None}


if __name__ == '__main__':
    c = build()
    json.dump(c, open(OUT, 'w'), indent=1)
    print(f"costs: {len(c['batches'])} batches US${c['batch_usd']} (per paper {c['per_paper']}), other US${sum(o['usd'] for o in c['other'])}, "
          f"months {c['months']} -> site/data/costs.json")
