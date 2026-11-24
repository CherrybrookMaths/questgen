"""Figure and table names the page can read (owner 24 Nov, Review screenshot of 2021 Fort Street AT4 Q3(b): "the question on the
left is different to the one on the right"; the solution printed the raw `\\exfigure{1305_q3(b)_s1}`).
A figure name is <doc>_q<number>_<k> or <doc>_q<number>_s<k>; a table name <doc>_q<number>_t<k>. Question numbers of split papers
("3(b)", "11(a)") lost their brackets in the name: 1305_q3b_s1. Names with any other character (brackets, spaces, ...) broke the
page's \\exfigure pattern and the asset lookups, so they are renamed to that form everywhere and batch_check blocks a new one.

  python3 tools/fig_ids.py            list the names outside the normal form (database and bank), exit 1 if any
  python3 tools/fig_ids.py --fix      rename them: database (figures, question / part / option / solution text and notes, the page-db
                                      mirror), files named after them (figures/, tikz/, state/tikz/) and every state / site JSON that
                                      names them; then rebuild (build_bank, bank_split, tikz_sources) as after any diagram change
  python3 tools/fig_ids.py --reviews <export dir>   the page-db `reviews` writes that move fig / fig_notes / fig_done keys to the
                                      new names (ArtifactData batch file, printed path), from an export of the reviews collection
Copy questions.db into archive/ before --fix (CLAUDE.md)."""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import glob, json, os, re, sqlite3, sys

OK = re.compile(r'[A-Za-z0-9_.-]+')
REF = re.compile(r'\\(exfigure|extable)\{([^}]*)\}')


def norm(k):
    """The page's form of a figure / table name: only letters, digits, _ . - (1305_q3(b)_s1 -> 1305_q3b_s1)."""
    return re.sub(r'[^A-Za-z0-9_.-]', '', k)


# text columns that may name a figure or table (\exfigure{..}, \extable{..}, notes that quote the name)
TEXT = {'questions': ['stem_latex', 'options_table_json'], 'parts': ['latex'], 'mcq_options': ['latex', 'figure_key'],
        'solutions': ['latex', 'meta_json', 'criteria_json'], 'data_tables': ['source_latex'],
        'figures': ['png_path', 'tikz_path', 'redraw_table_id'], 'page_reviews': ['fig_json', 'data_json']}


def _no_notes(v):
    """A review doc's JSON without its note texts: a note may quote an old name (Claude's 23 Nov fix note on 2021 Fort Street AT4
    Q1(c) quotes \\exfigure{1305_q1(c)_s1}); notes print as plain text, so only the doc's figure fields and solution edits count."""
    try: d = json.loads(v)
    except ValueError: return v
    strip = lambda o: {k: strip(x) for k, x in o.items() if k != 'note'} if isinstance(o, dict) else [strip(x) for x in o] if isinstance(o, list) else o
    return json.dumps(strip(d))


def bad_names(db):
    """{name: [where, ...]} for every figure / table name outside the normal form."""
    out = {}
    have = {r[0] for r in db.execute("select name from sqlite_master where type='table'")}
    for (p, t) in db.execute('select png_path, tikz_path from figures'):
        for v in (p, t):
            if v:
                k = os.path.splitext(os.path.basename(v))[0]
                if not OK.fullmatch(k): out.setdefault(k, []).append('figures')
    for (i,) in db.execute('select id from data_tables'):
        if not OK.fullmatch(i): out.setdefault(i, []).append('data_tables')
    for tab, cols in TEXT.items():
        if tab not in have or tab == 'figures': continue
        cs = [c for c in cols if c in {r[1] for r in db.execute(f'pragma table_info({tab})')}]
        for row in db.execute(f'select {", ".join(cs)} from {tab}'):
            for v in row:
                if tab == 'page_reviews' and v: v = _no_notes(v)
                for m in REF.finditer(v or ''):
                    if not OK.fullmatch(m.group(2)): out.setdefault(m.group(2), []).append(tab)
    return out


def bank_bad(path):
    """Names outside the normal form in a built bank file (bank.json / bank_v1.json)."""
    if not os.path.exists(path): return set()
    t = open(path).read()
    return {m.group(2) for m in REF.finditer(t.replace('\\\\', '\\')) if not OK.fullmatch(m.group(2))} | \
           {k for k in re.findall(r'figures/([^"/]+)\.png', t) if not OK.fullmatch(k)}


def fix(db):
    names = bad_names(db)
    ren = {k: norm(k) for k in names}
    known = {os.path.splitext(os.path.basename(p))[0] for (p,) in db.execute('select png_path from figures')}
    clash = [f'{a} -> {b}' for a, b in ren.items() if b in known or list(ren.values()).count(b) > 1]
    if clash: sys.exit('the new name is taken: ' + '; '.join(clash))
    if not ren: print('nothing to rename'); return {}
    have = {r[0] for r in db.execute("select name from sqlite_master where type='table'")}
    n = 0
    for tab, cols in TEXT.items():
        if tab not in have: continue
        cs = [c for c in cols if c in {r[1] for r in db.execute(f'pragma table_info({tab})')}]
        for row in db.execute(f'select rowid, {", ".join(cs)} from {tab}').fetchall():
            new = list(row[1:])
            for i, v in enumerate(new):
                if not v: continue
                for a, b in ren.items(): v = v.replace(a, b)
                new[i] = v
            if new != list(row[1:]):
                db.execute(f'update {tab} set {", ".join(c + "=?" for c in cs)} where rowid=?', (*new, row[0])); n += 1
    for a, b in ren.items():   # a table's own id (none so far)
        db.execute('update data_tables set id=? where id=?', (b, a))
    db.commit()
    print(f'database: {n} rows rewritten')
    # files named after a figure: crops, tikz sources and build outputs (pdf / svg / png / overlays / comparisons)
    moved = 0
    for root in (paths.P + 'figures', paths.P + 'tikz', paths.S + 'tikz'):
        for f in glob.glob(root + '/**/*', recursive=True):
            stem, ext = os.path.splitext(os.path.basename(f))
            for a, b in ren.items():
                if stem == a or stem.startswith(a + '.') or stem.startswith(a + '_'):
                    dst = os.path.join(os.path.dirname(f), b + stem[len(a):] + ext)
                    if os.path.exists(dst): sys.exit(f'{dst} exists')
                    os.rename(f, dst); moved += 1
    print(f'files renamed: {moved}')
    # every JSON / TeX file that names them (state, site data packs and bank, site/project, tikz results); logs are history, left as is
    edited = 0
    pats = [paths.S + '**/*.json', paths.S + '**/*.tex', paths.P + 'site/data/**/*.json', paths.P + 'site/project/*.json',
            paths.P + 'tikz/*.json']
    for f in {g for p in pats for g in glob.glob(p, recursive=True)}:
        try: t = open(f, encoding='utf-8').read()
        except (UnicodeDecodeError, OSError): continue
        u = t
        for a, b in ren.items(): u = u.replace(a, b)
        if u != t: open(f, 'w', encoding='utf-8').write(u); edited += 1
    print(f'json / tex files rewritten: {edited}')
    json.dump(ren, open(paths.S + 'work/fig_renames.json', 'w'), indent=1)
    print('renames recorded in state/work/fig_renames.json:', ', '.join(f'{a} -> {b}' for a, b in ren.items()))
    return ren


def review_writes(export):
    """ArtifactData batch ops that move review fig / fig_notes / fig_done keys to the new names (from state/work/fig_renames.json)."""
    ren = json.load(open(paths.S + 'work/fig_renames.json'))
    ops = []
    for f in glob.glob(os.path.join(export, '**/*.json'), recursive=True):
        try: d = json.load(open(f))
        except Exception: continue
        # an ArtifactData out_dir export: one file per document, named <doc id>.json ('~' spelt '@'), the fields at the top level
        docs = d if isinstance(d, list) else [dict(d, id=os.path.basename(f)[:-5].replace('@', '~'))]
        for x in docs:
            data = x.get('data', x); did = x.get('id') or x.get('doc_id')
            if not did: continue
            upd = {}
            for fld in ('fig', 'fig_notes', 'fig_done'):
                v = data.get(fld)
                if isinstance(v, dict) and any(k in ren for k in v):   # an update merges maps: write the new key, delete the old one
                    upd[fld] = {**{ren[k]: w for k, w in v.items() if k in ren}, **{k: {'__delete__': True} for k in v if k in ren}}
            if upd:
                op = {'op': 'update', 'collection': 'reviews', 'doc_id': did, 'data': upd}
                if x.get('version') is not None: op['if_version'] = x['version']
                ops.append(op)
    out = paths.P + 'work/fig_rename_reviews.json'
    json.dump(ops, open(out, 'w'), indent=1, ensure_ascii=False)
    print(f'{len(ops)} review writes -> {out}')


if __name__ == '__main__':
    con = sqlite3.connect(paths.DBS)
    if '--fix' in sys.argv: fix(con)
    elif '--reviews' in sys.argv: review_writes(sys.argv[sys.argv.index('--reviews') + 1])
    else:
        b = bad_names(con)
        for k, w in sorted(b.items()): print(f'{k}  ({", ".join(sorted(set(w)))}) -> {norm(k)}')
        sys.exit(1 if b else 0)
