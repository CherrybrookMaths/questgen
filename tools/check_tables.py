"""Automatic table check for Review > Check (owner 12 Nov: "yeah" to auto-clearing what does not need him).
Every number in a bank table must appear among the PDF's words on the question's pages (searching one page either side),
and most of its words too. Digital papers only; scanned papers have no text layer and stay with the owner."""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import json, re, glob, os, sqlite3, pymupdf, collections
P = paths.P; S = str(paths.scratch('check_tables')) + '/'
B = json.load(open(P + 'site/data/bank.json')); db = sqlite3.connect(paths.DBS)
R = {os.path.basename(f)[:-5]: json.load(open(f)) for f in glob.glob(S + 'rv6/reviews/*.json')}
def frac(s): return re.sub(r'\\d?frac\{([^{}]*)\}\{([^{}]*)\}', r' \1 \2 ', s)
def nums(s): s = frac(re.sub(r'\\(?:text|textit|textbf|mathrm)\{([^}]*)\}', r'\1', str(s))); s = s.replace('\\,', '').replace('{,}', ''); return re.findall(r'\d+(?:\.\d+)?', s)
def wrds(s): s = re.sub(r'\\[a-zA-Z]+', ' ', str(s)); return [w.lower() for w in re.findall(r'[A-Za-z]{3,}', s)]
out = {}
for q in B['questions']:
    if q.get('dup_of') or (q.get('tri') or {}).get('tier') != 'check' or R.get('q%d' % q['id'], {}).get('status'): continue
    look = ' '.join(q['tri']['look']).lower()
    text = ' '.join([q['stem'] or ''] + [p['latex'] or '' for p in q['parts']])
    tids = re.findall(r'\\extable\{(\w+)\}', text) + [B['figs'][k]['table'] for k in B['figs'] if B['figs'][k].get('table') and any(f['src'].endswith('/' + k + '.png') for f in q['figures'])]
    res = {'tables': {}, 'scan': 'scanned' in look}
    row = db.execute('select page_start,page_end from questions where id=?', (q['id'],)).fetchone()
    f = P + 'src/%s.pdf' % q['doc']
    ptext = ''
    if row and row[0] and os.path.exists(f):
        d = pymupdf.open(f); ptext = ' '.join(d[i].get_text() for i in range(max(0, row[0] - 2), min(d.page_count, (row[1] or row[0]) + 1)))
    pn = collections.Counter(re.findall(r'\d+(?:\.\d+)?', ptext.replace('−', '-'))); pw = set(w.lower() for w in re.findall(r'[A-Za-z]{3,}', ptext))
    for tid in dict.fromkeys(tids):
        t = B['tables'].get(tid)
        if not t: continue
        cells = [c for r in t['rows'] for c in r]
        N = collections.Counter(x for c in cells for x in nums(c)); W = [w for c in cells for w in wrds(c)]
        miss_n = [x for x, k in N.items() if pn[x] < k]; miss_w = [w for w in W if w not in pw]
        ok = bool(ptext.strip()) and not miss_n and (not W or len(miss_w) <= max(1, len(W) // 5))
        res['tables'][tid] = dict(ok=ok, missing_numbers=miss_n[:8], missing_words=miss_w[:8], cells=len(cells), text_layer=bool(ptext.strip()))
    out[q['id']] = res
json.dump(out, open(P + 'work/checkpass/tables.json', 'w'), indent=1)
tb = [v for v in out.values() if v['tables']]
print('check questions open', len(out), 'with tables', len(tb), 'all tables match', sum(1 for v in tb if all(t['ok'] for t in v['tables'].values())))
for k, v in list(out.items())[:400]:
    for tid, t in v['tables'].items():
        if not t['ok']: print(' MISMATCH', k, tid, t['missing_numbers'], t['missing_words'][:4], 'text' if t['text_layer'] else 'NO TEXT')
