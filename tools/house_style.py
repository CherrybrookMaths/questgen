"""Run every automatic house-style rule over the whole database (safe to re-run; run after loading new papers):
  fracstyle.py  - \\dfrac everywhere except nested fractions / exponents / limits
  dotstyle.py   - multiplication dots are \\cdot, never a baseline full stop
  (inline)      - angle written A\\hat{B}C becomes \\angle ABC
  (inline)      - piecewise (cases) rows containing \\dfrac get 6pt extra space between rows
  (inline)      - markdown bold **x** removed: the bank is LaTeX-in-prose, never markdown
  liststyle.py  - dot points become \\begin{itemize} \\item ... \\end{itemize} (rendered as a bulleted list)
  parastyle.py  - every line break in the source is a paragraph break (single newline -> blank line)
Rules that need judgement (layout of working, long inline maths, sign analysis) are in SOLUTION_SPEC.md."""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import sqlite3, json, sys, os, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fracstyle, dotstyle, parastyle, liststyle
MDBOLD = re.compile(r'\*\*([^*\n]+?)\*\*')   # owner: no markdown in the bank ("no need for **right**"): **x** -> x
HAT = re.compile(r'([A-Z])\s*\\hat\{\s*([A-Z])\s*\}\s*([A-Z])')   # owner: "why does B have a hat on it?" A\hat{B}C -> \angle ABC (the notation the questions use)
CASES = re.compile(r'\\begin\{cases\}(.*?)\\end\{cases\}', re.S)
def _cases(m):   # owner: "the piecewise pieces are a bit too close since the middle has a dfrac": rows with \dfrac get extra space
    body = m.group(1)
    if '\\dfrac' not in body: return m.group(0)
    return '\\begin{cases}' + re.sub(r'\\\\(?!\s*\[)', r'\\\\[6pt]', body) + '\\end{cases}'
def style(s, bare=False, decimals=True):
    if s and '\\begin{cases}' in s: s = CASES.sub(_cases, s)
    if s and '\\hat' in s: s = HAT.sub(r'\\angle \1\2\3', s)
    if s and '**' in s: s = MDBOLD.sub(r'\1', s)
    if s and '\\\\,' in s:   # checker 12 Nov (Sydney Boys 2025 Q3, Q6): "\\," (line break + comma) typed for the thin space "\," inside inline maths
        s = re.sub(r'(?<!\$)\$(?!\$)([^$]*)\$', lambda m: '$' + re.sub(r'(?<!\\)\\\\,', r'\\,', m.group(1)) + '$', s)
    s = fracstyle.restyle('$' + s + '$')[1:-1] if bare and s else fracstyle.restyle(s)
    s = dotstyle.restyle(s, bare=bare, decimals=decimals)
    return s if bare else liststyle.restyle(parastyle.restyle(s))
db = sqlite3.connect(sys.argv[1] if len(sys.argv) > 1 else paths.DBS); n = 0
for tbl, col in (('questions', 'stem_latex'), ('parts', 'latex'), ('mcq_options', 'latex'), ('solutions', 'latex')):
    for rid, s in db.execute(f'select id,{col} from {tbl}').fetchall():
        t = style(s, decimals=tbl != 'solutions')
        if t != s: db.execute(f'update {tbl} set {col}=? where id=?', (t, rid)); n += 1
for sid, cj in db.execute('select id,criteria_json from solutions').fetchall():
    c = json.loads(cj or '[]'); c2 = [[m, style(t, decimals=False)] for m, t in c]
    if c2 != c: db.execute('update solutions set criteria_json=? where id=?', (json.dumps(c2, ensure_ascii=False), sid)); n += 1
for qid, ot in db.execute('select id,options_table_json from questions where options_table_json is not null').fetchall():
    o = json.loads(ot); o2 = {'headers': [style(h) for h in o['headers']], 'rows': {k: [style(x) for x in v] for k, v in o['rows'].items()}}
    if o2 != o: db.execute('update questions set options_table_json=? where id=?', (json.dumps(o2, ensure_ascii=False), qid)); n += 1
for tid, rj in db.execute('select id,rows_json from data_tables').fetchall():
    r = json.loads(rj); r2 = [[style(x, bare=True) if x else x for x in row] for row in r]
    if r2 != r: db.execute('update data_tables set rows_json=? where id=?', (json.dumps(r2, ensure_ascii=False), tid)); n += 1
db.commit(); print('house style: changed', n, 'fields')
