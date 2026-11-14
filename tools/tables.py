"""Item 5: convert LaTeX array tables in question/part/option/solution text into structured tables.
Each converted block becomes \\extable{<id>} in the text; rows live in table data_tables.
Renderer draws an HTML table: optional label column + equal-width value columns."""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import sqlite3, re, json, sys
DB = paths.DBS
db = sqlite3.connect(DB)
db.execute("""create table if not exists data_tables(id text primary key, owner_table text, owner_id integer,
  caption text, header_rows integer, label_col integer, rows_json text, source_latex text)""")

def split_top(s, sep):
    out, depth, cur, i = [], 0, '', 0
    while i < len(s):
        c = s[i]
        if c == '{': depth += 1
        elif c == '}': depth -= 1
        if depth == 0 and s.startswith(sep, i) and not (sep == '&' and i > 0 and s[i-1] == '\\'):
            out.append(cur); cur = ''; i += len(sep); continue
        cur += c; i += 1
    out.append(cur); return out

NUM = re.compile(r'^[\s\-−+]*[\d.,\s]+%?$|^\\dfrac|^\\frac|^-?\s*\\dfrac|^0\.|^\d')
def is_label(cell):
    t = cell.strip()
    if not t: return False
    return not NUM.match(t)

BLOCK = re.compile(r'(\$\$|\\\[)\s*((?:(?!\$\$)[^$])*?)\\begin\{array\}\{([^}]*)\}(.*?)\\end\{array\}\s*(\$\$|\\\])', re.S)

INNER = re.compile(r'\\begin\{array\}\{[^}]*\}((?:(?!\\begin\{array\}).)*?)\\end\{array\}', re.S)
def collapse_nested(text):
    # a cell holding its own small array (a header wrapped over two lines) becomes one cell with a \\ line break
    # (owner 12 Nov: the Pia's-marks header broke the table). Only arrays nested inside another array are collapsed.
    while True:
        changed = False
        for m in INNER.finditer(text):
            before = text[:m.start()]
            if before.count('\\begin{array}') - before.count('\\end{array}') > 0:
                text = text[:m.start()] + m.group(1).replace('\\\\', '\x01').strip() + text[m.end():]; changed = True; break
        if not changed: return text

def convert(text, owner_table, owner_id, counter):
    made = []
    text = collapse_nested(text)
    def rep(m):
        body = m.group(4)
        if re.search(r'\\end\{array\}.*\\begin\{array\}', body, re.S): return m.group(0)   # two arrays side by side in one display (sign tables): leave as LaTeX
        rows_raw = [r for r in re.split(r'\\\\', body)]
        rows, header_rows, caption = [], 0, None
        hline_after = []
        for r in rows_raw:
            r2 = r.replace('\\hline', '').strip()
            if not r2:
                if rows: hline_after.append(len(rows))
                continue
            cells = [c.strip() for c in split_top(r2, '&')]
            # \rlap{...} caption-style header spanning columns
            if sum(1 for c in cells if c) == 1 and '\\rlap' in r2:
                caption = re.sub(r'\\rlap\{(.*)\}', r'\1', [c for c in cells if c][0]).strip(); continue
            cells = [re.sub(r'^\\rlap\{(.*)\}$', r'\1', c).replace('\x01', '\\\\') for c in cells]
            rows.append(cells)
            if '\\hline' in r and len(rows) == 1: pass
        if len(rows) < 2: return m.group(0)
        n = max(len(r) for r in rows); rows = [r + [''] * (n - len(r)) for r in rows]
        # header: first row is all non-numeric while some later row has numbers
        first_textual = all(is_label(c) or not c for c in rows[0])
        later_numeric = any(not is_label(c) for r in rows[1:] for c in r[1:] if c)
        header_rows = 1 if first_textual and later_numeric else 0
        # label column: first column non-numeric in every row (e.g. x, P(X=x), or row names)
        label_col = 1 if all(is_label(r[0]) or not r[0] for r in rows) and n > 2 else 0
        # transposed DRV table (rows: x / P(X=x)) is the common case: label_col=1, header_rows=0
        counter[0] += 1
        tid = f'T{owner_table[0]}{owner_id}_{counter[0]}'
        db.execute('insert or replace into data_tables(id,owner_table,owner_id,caption,header_rows,label_col,rows_json,source_latex) values (?,?,?,?,?,?,?,?)',
                   (tid, owner_table, owner_id, caption, header_rows, label_col, json.dumps(rows, ensure_ascii=False), m.group(0)))
        made.append(tid)
        lead = m.group(2).strip()
        if lead:
            cap = re.sub(r'\\(text|textbf|textit)\{([^}]*)\}', r'\2', lead); cap = re.sub(r'\\q?quad|\\\\|\\,', ' ', cap).strip()
            db.execute('update data_tables set caption=coalesce(caption,?) where id=?', (cap, tid))
        return '\\extable{' + tid + '}'
    return BLOCK.sub(rep, text), made

if __name__ == '__main__':
    total = 0
    for tbl, col in (('parts', 'latex'), ('questions', 'stem_latex'), ('mcq_options', 'latex'), ('solutions', 'latex')):
        for rid, s in db.execute(f"select id,{col} from {tbl} where {col} like '%begin{{array}}%'").fetchall():
            new, made = convert(s, tbl, rid, [0])
            if made:
                db.execute(f'update {tbl} set {col}=? where id=?', (new, rid)); total += len(made)
    db.commit()
    left = sum(s.count('\\begin{array}') for tbl, col in (('parts','latex'),('questions','stem_latex'),('mcq_options','latex'),('solutions','latex')) for (s,) in db.execute(f"select {col} from {tbl} where {col} like '%begin{{array}}%'"))
    print('converted', total, 'arrays left in place (inline/matrix):', left)
