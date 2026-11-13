"""UI v2 data integration (11 Nov 2026).
1  marks_breakdown -> solutions.criteria_json [[marks, text]] + solutions.meta_json {confidence, check, concern, reused_from}
4  mcq_tables.json -> questions.options_table_json {headers, rows{A:[..]}}
5  tables_checked.json -> data_tables (+spans_json); figure-tables -> data_tables owner 'figures'
3  tikz results + checks -> figures.tikz_path / redraw_* columns
Idempotent: safe to re-run."""
import sqlite3, json, re, glob, os
P = '/home/claude/pilot/'
db = sqlite3.connect('/mnt/user-data/outputs/questions.db')

def addcol(t, c, typ='text'):
    if c not in [r[1] for r in db.execute(f'pragma table_info({t})')]:
        db.execute(f'alter table {t} add column {c} {typ}')

for t, c in [('solutions', 'criteria_json'), ('solutions', 'meta_json'), ('questions', 'options_table_json'),
             ('data_tables', 'spans_json'), ('figures', 'redraw_status'), ('figures', 'redraw_class'),
             ('figures', 'redraw_notes'), ('figures', 'redraw_check'), ('figures', 'redraw_table_id')]:
    addcol(t, c)

# ---- 1. marking criteria
def parse_criteria(mb):
    meta = {}
    s = mb or ''
    m = re.search(r'\s*CONCERN:\s*(.*)$', s, re.S)
    if m: meta['concern'] = m.group(1).strip(); s = s[:m.start()]
    m = re.search(r'\s*\[confidence\s*([\d.]+);\s*check:\s*([^\]]*)\]', s)
    if m: meta['confidence'] = float(m.group(1)); meta['check'] = m.group(2).strip(); s = s[:m.start()] + s[m.end():]
    m = re.search(r'\s*\[reused from duplicate(?: question)?\s*(\d+)(?:,\s*similarity\s*([\d.]+))?\]', s)
    if m: meta['reused_from'] = int(m.group(1)); s = s[:m.start()] + s[m.end():]
    s = s.strip()
    # split on "; N:" boundaries (not inside $...$)
    pieces, cur, inmath, i = [], '', False, 0
    while i < len(s):
        ch = s[i]
        if ch == '$' and (i == 0 or s[i-1] != '\\'): inmath = not inmath
        if ch == ';' and not inmath and re.match(r';\s*\d+\s*:', s[i:]):
            pieces.append(cur); cur = ''; i += 1; continue
        cur += ch; i += 1
    pieces.append(cur)
    crit = []
    for p in pieces:
        p = p.strip()
        m = re.match(r'(\d+)\s*:\s*(.*)$', p, re.S)
        if m: crit.append([int(m.group(1)), m.group(2).strip()])
        elif p:
            if crit: crit[-1][1] += ' ' + p
            else: crit.append([None, p])
    # trailing advice sentence after last criterion e.g. "... incorrect. Students need to ..."
    if crit:
        m = re.match(r'(.*?[.])\s+(Students .*|Note.*|Markers .*)$', crit[-1][1], re.S)
        if m: crit[-1][1] = m.group(1); meta['marker_note'] = m.group(2)
    return crit, meta

n = 0
for sid, mb in db.execute('select id, marks_breakdown from solutions').fetchall():
    crit, meta = parse_criteria(mb)
    db.execute('update solutions set criteria_json=?, meta_json=? where id=?',
               (json.dumps(crit, ensure_ascii=False), json.dumps(meta, ensure_ascii=False), sid)); n += 1
print('criteria parsed', n)

# ---- 4. MCQ option tables
mt = json.load(open(P + 'mcq_tables.json'))
for t in mt['tables']:
    db.execute('update questions set options_table_json=? where id=?',
               (json.dumps({'headers': t['headers'], 'rows': t['rows']}, ensure_ascii=False), t['question_id']))
print('mcq tables', len(mt['tables']))

# ---- 5. checked data tables
tc = json.load(open(P + 'tables_checked.json'))['tables']
for t in tc:
    db.execute('update data_tables set caption=?, header_rows=?, label_col=?, rows_json=?, spans_json=? where id=?',
               (t['caption'], t['header_rows'], t['label_col'], json.dumps(t['rows'], ensure_ascii=False),
                json.dumps(t.get('spans') or []), t['table_id']))
print('checked tables applied', len(tc))

# ---- 3. diagrams
res = {r['id']: r for r in json.load(open(P + 'tikz/all_results.json'))}
chk = {}
for f in glob.glob(P + 'tikz/check_*.json'):
    for r in json.load(open(f))['results']: chk[r['id']] = r
figs = db.execute('select id, png_path from figures').fetchall()
matched = 0
for fid, png in figs:
    key = os.path.basename(png)[:-4]
    r = res.get(key)
    if not r: continue
    matched += 1
    c = chk.get(key)
    tid = None
    if r['status'] == 'table' and r.get('table'):
        tb = r['table']; rows = tb['rows']; hr = tb.get('header_rows', 0); cap = None
        if rows and sum(1 for x in rows[0] if x.strip()) == 1 and hr >= 1 and len(rows[0]) > 2:
            cap = re.sub(r'^\\text\{(.*)\}$', r'\1', rows[0][0]); rows = rows[1:]; hr -= 1
        # drop header rows that are empty apart from the label (e.g. a bare "n" row)
        while hr >= 1 and len(rows) > hr and all(not x.strip() for x in rows[hr-1][1:]) and hr > 1:
            rows[hr-2][0] = (rows[hr-1][0] + r' \backslash ' + rows[hr-2][0]).strip() if rows[hr-1][0].strip() else rows[hr-2][0]
            del rows[hr-1]; hr -= 1
        tid = 'Tf' + str(fid)
        db.execute('insert or replace into data_tables(id, owner_table, owner_id, caption, header_rows, label_col, rows_json, source_latex, spans_json) values (?,?,?,?,?,?,?,?,?)',
                   (tid, 'figures', fid, cap, hr, tb.get('label_col', 0), json.dumps(rows, ensure_ascii=False), None, '[]'))
    db.execute('update figures set tikz_path=?, redraw_status=?, redraw_class=?, redraw_notes=?, redraw_check=?, redraw_table_id=? where id=?',
               ('tikz/tex/%s.tex' % key if r['status'] in ('ok', 'approx') else None, r['status'], r.get('class'),
                r.get('notes'), json.dumps({'verdict': c['verdict'], 'notes': c.get('notes')}) if c else None, tid, fid))
print('figures matched', matched, 'of', len(figs))
db.commit()

# ---- 4b. an MCQ answer table now lives on the question (options_table_json); drop the duplicate copy from the text
LAB = re.compile(r'^\\text\{\(?[A-D]\.?\)?\}$')
for (qid,) in db.execute('select id from questions where options_table_json is not null').fetchall():
    for tbl, col, key in (('parts', 'latex', 'question_id'), ('questions', 'stem_latex', 'id')):
        for rid, s in db.execute(f'select id, {col} from {tbl} where {key}=?', (qid,)).fetchall():
            new = s
            for tid in re.findall(r'\\extable\{(\w+)\}', s or ''):
                rows = json.loads(db.execute('select rows_json from data_tables where id=?', (tid,)).fetchone()[0])
                if sum(1 for r in rows if LAB.match(r[0].strip())) >= 4:
                    new = re.sub(r'\s*\\extable\{' + tid + r'\}\s*', '\n\n', new).strip()
            if new != s:
                db.execute(f'update {tbl} set {col}=? where id=?', (new, rid)); print('removed answer-table copy from', tbl, rid)
db.commit()
