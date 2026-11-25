"""Layers 2-3: text fingerprint per document and near-duplicate questions (Jaccard on word 3-shingles; exact, not MinHash, at pilot scale).

  python3 tools/dedup.py [<doc id> ...]           recompute related_questions (only pairs touching these papers; none = all)
  python3 tools/dedup.py --numbers <doc id> ...    re-check this batch's 'numbers_changed' pairs once its diagrams exist
  python3 tools/dedup.py --numbers --all           the same for every pair in the bank; add --dry-run to only print
  python3 tools/dedup.py --self-check              read-only test: 6620 ~ 6972 -> duplicate, real numbers-changed pairs stay

Relations: 'duplicate' (Jaccard >= 0.85, or >= NEAR with every number the same), 'numbers_changed' (>= 0.65), 'variant' (>= 0.5).
Owner 25 Nov: "I found two trapezoidal rule questions which are duplicates. I thought we were checking for dupes upon import? Or at
least after import?" (2022 Caringbah AT4 Q24 = 2022 NEAP AT4 Q29: Jaccard 0.82, so 'numbers_changed', and both showed in the Bank).
So a pair whose text is nearly the same (>= NEAR) AND whose numbers are all the same (text, MCQ options, tables and the diagram's
labels: same_numbers below) is a 'duplicate'. At load the diagrams are not redrawn yet, so a pair with a figure is re-checked by
--numbers after apply_diagrams (tools/run_batch.py step 'dupes').
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import sqlite3, re, hashlib, itertools, collections, os, sys

NEAR = 0.75   # owner 25 Nov: "Yes do that." (text nearly the same + every number the same -> duplicate)


def norm(s): return re.sub(r'[^a-z0-9]+', ' ', (s or '').lower().replace('\\dfrac', '\\frac')).split()
def sh(w): return {' '.join(w[i:i+3]) for i in range(max(1, len(w) - 2))}


# ---- numbers of a question (owner 25 Nov, above) ---------------------------------------------------------------------------
_NUMWORDS = set('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen '
                'nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million half quarter twice double triple '
                'second third fourth fifth sixth seventh eighth ninth tenth'.split())
_LAYOUT = re.compile(r'\\(?:exfigure|extable|label|ref|includegraphics|hspace\*?|vspace\*?|fontsize|scalebox|raisebox|resizebox|color|textcolor)'
                     r'(?:\[[^\]]*\])?\{[^{}]*\}(?:\{[^{}]*\})?|\\rule(?:\[[^\]]*\])?\{[^{}]*\}\{[^{}]*\}|\\\\\[[^\]]*\]'
                     r'|\\(?:makebox|parbox)\[[^\]]*\]|\\begin\{(?:array|tabular)\}\{[^{}]*\}|\\[a-zA-Z]+\*?')
_LAYOUT_KEEP = re.compile(r'\\(?:exfigure|extable)\{[^{}]*\}')
_NUM = re.compile(r'(?<![A-Za-z_\d.])(-?)(\d+(?:\.\d+)?)')


def numbers_in(text):
    """(set of numbers as strings, Counter of number words) in a piece of LaTeX or label text. Layout commands, figure keys and
    thousands separators are ignored; '-2' keeps its sign only where it is not a subtraction (after a bracket, '=', ',' or the start)."""
    t = _LAYOUT.sub(' ', (text or '').replace('\\dfrac', '\\frac'))
    t = re.sub(r'(\d)(?:\\,|\{,\}|\\ |~)(?=\d{3}\b)', r'\1', t)   # 10\,000 / 10{,}000 -> 10000
    t = re.sub(r'(\d),(?=\d{3}\b)', r'\1', t)
    t = re.sub(r'([=(\[,{$]|^)\s*-\s*(?=\d)', r'\1 -', t)
    t = re.sub(r'(?<=[\w)}])\s*-\s*(?=\d)', ' ', t)                 # subtraction: drop the sign
    nums = set()
    for m in _NUM.finditer(t):
        v = m.group(2).lstrip('0') or '0'
        if '.' in v: v = v.rstrip('0').rstrip('.') or '0'
        if v.startswith('.'): v = '0' + v
        nums.add(m.group(1) + v)
    words = collections.Counter(w for w in re.findall(r'[a-z]+', t.lower()) if w in _NUMWORDS)
    return nums, words


_MATH = re.compile(r'\$\$(.+?)\$\$|\$(.+?)\$|\\\[(.+?)\\\]|\\\((.+?)\\\)', re.S)


def maths_in(text):
    """Set of the formulas in a piece of LaTeX (spaces, sizing and brace style normalised), without formulas that are only a number
    ('$2$ metres' = '2 metres'). Two questions with the same numbers but sin x against cos x differ here."""
    out = set()
    for m in _MATH.finditer(_LAYOUT_KEEP.sub(' ', (text or '').replace('\\$', 'USD'))):
        f = next(g for g in m.groups() if g is not None)
        f = re.sub(r'\\(?:left|right|displaystyle|[,;!: ]|quad|qquad)|\s+', '', f.replace('\\dfrac', '\\frac').replace('\\tfrac', '\\frac'))
        f = re.sub(r'\\(?:text|mathrm|textrm|mbox)\{\s*(?:m|cm|mm|km|kg|g|L|mL|kL|s|h|min|m/s|km/h|units?)\s*\}(?:\^[23])?', '', f)   # units
        f = re.sub(r'\\(?:cdots|ldots|dots)', '...', f.replace('\\equiv', '=').replace('\\operatorname', '')).strip(',.;:')
        f = re.sub(r'\{(\\?[A-Za-z0-9])\}', r'\1', f)
        u = re.sub(r'\\(?:text|mathrm|textrm|mbox)\{[^{}]*\}|\^\\circ|\\%|USD', '', f)   # a number with its unit is a number
        if f and not re.fullmatch(r'-?[\d.,{}]*(\^[23])?', u): out.add(f)
    return out


def _balanced(s, i, o='{', c='}'):
    """s[i] == o: return (inner text, index after the closing bracket)."""
    d = 0
    for j in range(i, len(s)):
        if s[j] == o: d += 1
        elif s[j] == c:
            d -= 1
            if d == 0: return s[i + 1:j], j + 1
    return s[i + 1:], len(s)


def _foreach_values(lst):
    out = []
    items = [x.strip() for x in lst.split(',')]
    for k, x in enumerate(items):
        if x == '...' and 0 < k < len(items) - 1:
            try:
                a = float(items[k - 1]); b = float(items[k + 1]); st = (a - float(items[k - 2])) if k >= 2 else (1 if b >= a else -1)
                v = a + st; n = 0
                while st and (v < b if st > 0 else v > b) and n < 500: out.append(('%g' % v)); v += st; n += 1
            except ValueError: pass
        else: out.append(x)
    return out


def tikz_labels(src):
    """Text a TikZ / pgfplots source prints: node text (\\node, '... node[...] {..}', label=, pin=), \\foreach lists whose
    values a node prints, and pgfplots tick lists. Coordinates are drawing, not labels (two redraws of one diagram differ there)."""
    s = re.sub(r'(?<!\\)%.*', '', src)
    m = re.search(r'\\begin\{tikzpicture\}', s); s = s[m.start():] if m else s
    texts = []
    for m in re.finditer(r'(?<![A-Za-z])node(?![A-Za-z/])', s):
        i = m.end()
        while i < len(s):
            while i < len(s) and s[i].isspace(): i += 1
            if s.startswith('[', i): i = _balanced(s, i, '[', ']')[1]
            elif s.startswith('(', i): i = _balanced(s, i, '(', ')')[1]
            elif s.startswith('at', i) and not s[i + 2:i + 3].isalpha(): i += 2
            elif s.startswith('{', i): texts.append(_balanced(s, i)[0]); break
            else: break
    for m in re.finditer(r'\b(?:label|pin)\s*=\s*', s):
        i = m.end()
        v = _balanced(s, i)[0] if s.startswith('{', i) else re.match(r'[^,\]]*', s[i:]).group()
        texts.append(v.split(':', 1)[1] if ':' in v else v)
    for m in re.finditer(r'\b[xyz](?:tick|ticklabels)\s*=\s*\{', s):
        texts.append(_balanced(s, m.end() - 1)[0])
    for m in re.finditer(r'\\foreach\s*((?:\\[A-Za-z]+\s*/?\s*)+)(?:\[[^\]]*\])?\s*in\s*\{', s):
        vs = re.findall(r'\\[A-Za-z]+', m.group(1)); lst, j = _balanced(s, m.end() - 1)
        while j < len(s) and s[j].isspace(): j += 1
        body = _balanced(s, j)[0] if s.startswith('{', j) else s[j:s.find(';', j) + 1 if ';' in s[j:] else len(s)]
        shown = [t for t in texts if any(v in t for v in vs) and t in body]
        if not shown: continue
        for item in _foreach_values(lst):
            vals = item.split('/')
            for t in shown:
                for v, x in sorted(zip(vs, vals), key=lambda p: -len(p[0])): t = t.replace(v, x)
                texts.append(t)
    fv = set(re.findall(r'\\foreach\s*((?:\\[A-Za-z]+\s*/?\s*)+)', s)); fv = {v for g in fv for v in re.findall(r'\\[A-Za-z]+', g)}
    return [t for t in texts if not any(re.search(re.escape(v) + r'(?![A-Za-z])', t) for v in fv)]   # loop text is kept substituted


_MATHCMD = set('alpha beta gamma delta epsilon varepsilon theta vartheta lambda mu pi rho sigma tau phi varphi omega Delta Theta Omega '
               'sin cos tan sec csc cot log ln sqrt frac angle int infty'.split())


def label_words(texts):
    """Letters a diagram prints ($A$, $\\theta$, y=f(x)): single letters as printed, words in lower case, Greek letters and functions;
    not font, size or style commands, nor NOT TO SCALE."""
    out = set()
    for x in texts:
        for t in re.findall(r'\\\\|\\[A-Za-z]+|[A-Za-z]+', x):
            if t.startswith('\\'):
                if t[1:] in _MATHCMD: out.add(t)
            elif len(t) == 1: out.add(t)
            elif t.lower() not in ('not', 'to', 'scale'): out.add(t.lower())
    return out


def question_numbers(db, qid):
    """{'text': set, 'words': Counter, 'figs': {figure key: set of label numbers | None (no TikZ source: a crop)}} for a question:
    stem + parts + MCQ options + option table + data tables + each figure's TikZ labels."""
    txt = [db.execute('select stem_latex, options_table_json from questions where id=?', (qid,)).fetchone() or ('', '')]
    txt = [txt[0][0] or '', txt[0][1] or '']
    parts = db.execute('select id, latex from parts where question_id=?', (qid,)).fetchall()
    opts = db.execute('select id, latex, figure_key from mcq_options where question_id=?', (qid,)).fetchall()
    txt += [p[1] or '' for p in parts] + [o[1] or '' for o in opts]
    keys = []
    for t in txt + [o[2] or '' for o in opts]:
        keys += re.findall(r'\\exfigure\{([^}]*)\}', t) + ([t] if re.fullmatch(r'\d+_[\w]+', t) else [])
    figrows = {os.path.basename(r[1])[:-4]: r for r in db.execute('select id, png_path, tikz_path, redraw_table_id from figures where question_id=?', (qid,))}
    owners = [('questions', qid)] + [('parts', p[0]) for p in parts] + [('mcq_options', o[0]) for o in opts] + [('figures', r[0]) for r in figrows.values()]
    for ot, oid in owners:
        for rows, cap in db.execute('select rows_json, caption from data_tables where owner_table=? and owner_id=?', (ot, oid)): txt += [rows or '', cap or '']
    maths = set().union(*[maths_in(t) for t in txt[:1] + [p[1] or '' for p in parts] + [o[1] or '' for o in opts]])
    plain = set(re.findall(r'[a-z]+', ' '.join(re.sub(r'\$[^$]*\$|\\[A-Za-z]+', ' ', t) for t in txt[:1] + [p[1] or '' for p in parts]).lower()))
    nums, words = set(), collections.Counter()
    for t in txt:
        n, w = numbers_in(t); nums |= n; words += w
    figs = {}
    for k in dict.fromkeys(keys):
        r = figrows.get(k)
        tex = paths.S + (r[2] if r and r[2] else 'tikz/tex/%s.tex' % k)
        if r and r[3]: figs[k] = set()            # a figure redrawn as a data table: its cells are in the text numbers
        elif os.path.exists(tex):
            lab = tikz_labels(open(tex).read())
            figs[k] = set().union(*[numbers_in(x)[0] for x in lab] or [set()]) | {'w:' + w for w in label_words(lab)}
        else: figs[k] = None
    shape = db.execute("select q.question_type='mcq', d.course, (select count(*) from parts where question_id=q.id) from questions q "
                       "join documents d on d.id=q.document_id where q.id=?", (qid,)).fetchone()
    return {'text': nums, 'words': words, 'figs': figs, 'maths': maths, 'plain': plain, 'shape': list(shape or [])}


def same_numbers(db, a, b):
    """('same' | 'differ' | 'unknown', detail). 'same': every number and formula of the text and every diagram label agree, and no number word
    conflicts (one side's extra "four applications" is not a conflict; "three" against "four" is). Also needed: the same question type,
    course and number of parts (one paper's extra part, e.g. "Complete the table", is a variant, not a copy; a question set in both the
    Standard and the Advanced HSC stays in both courses' banks). MCQ or not counts, short vs extended does not (a parser call). 'unknown': a figure has no TikZ source to read labels from (a crop),
    so the pair stays as it is."""
    A, B = question_numbers(db, a), question_numbers(db, b)
    det = {'text_only_a': sorted(A['text'] - B['text']), 'text_only_b': sorted(B['text'] - A['text'])}
    wa, wb = set(A['words']) - set(B['words']), set(B['words']) - set(A['words'])
    if wa and wb: det['words'] = [sorted(wa), sorted(wb)]
    if A['shape'][:2] != B['shape'][:2] or A['shape'][2] != B['shape'][2]: det['shape'] = [A['shape'], B['shape']]
    det['maths_only_a'] = sorted(A['maths'] - B['maths']); det['maths_only_b'] = sorted(B['maths'] - A['maths'])
    det['wording'] = [sorted(A['plain'] - B['plain']), sorted(B['plain'] - A['plain'])]   # shown in reports, not a verdict
    fa = [v for v in A['figs'].values()]; fb = [v for v in B['figs'].values()]
    det['figs'] = [list(A['figs']), list(B['figs'])]
    if len(fa) != len(fb): det['figs_count'] = [len(fa), len(fb)]
    crops = [k for k, v in list(A['figs'].items()) + list(B['figs'].items()) if v is None]
    if crops: det['crops'] = crops
    la = set().union(*[v for v in fa if v] or [set()]); lb = set().union(*[v for v in fb if v] or [set()])
    det['labels_only_a'] = sorted(la - lb); det['labels_only_b'] = sorted(lb - la)   # numbers, and 'w:<letters>' a diagram prints
    if det.get('shape') or det['text_only_a'] or det['text_only_b'] or det['maths_only_a'] or det['maths_only_b'] or det.get('words') or det.get('figs_count') or det['labels_only_a'] or det['labels_only_b']:
        return 'differ', det
    if crops: return 'unknown', det
    return 'same', det


def relation(db, a, b, j):
    """The relation dedup records for a pair with Jaccard j (None below 0.5)."""
    if j >= 0.85: return 'duplicate'
    if j >= NEAR and same_numbers(db, a, b)[0] == 'same': return 'duplicate'
    return 'numbers_changed' if j >= 0.65 else ('variant' if j >= 0.5 else None)


def recheck(db, docs=None, dry=False, quiet=False):
    """--numbers: pairs recorded 'numbers_changed'/'variant' at >= NEAR (touching these papers; None = all) become 'duplicate' when
    same_numbers says 'same'. Returns [(a, b, sim, verdict, detail)]."""
    out = []
    for a, b, sim, rel in db.execute("select question_id, related_id, similarity, relation from related_questions where relation in "
                                     "('numbers_changed','variant') and similarity>=?", (NEAR,)).fetchall():
        if docs:
            da, db_ = (db.execute('select document_id from questions where id=?', (x,)).fetchone() for x in (a, b))
            if not ((da and da[0] in docs) or (db_ and db_[0] in docs)): continue
        v, d = same_numbers(db, a, b); out.append((a, b, sim, v, d))
        if v == 'same' and not dry:
            db.execute("update related_questions set relation='duplicate' where question_id=? and related_id=?", (a, b))
    if not dry: db.commit()
    if not quiet:
        n = sum(1 for x in out if x[3] == 'same')
        print(f'dedup --numbers: {len(out)} pair(s) >= {NEAR} checked, {n} now duplicate{" (dry run)" if dry else ""}',
              *[f'  {a} ~ {b} ({s})' for a, b, s, v, _ in out if v == 'same'], sep='\n')
    return out


def self_check(db):
    """--self-check (read only): the comparison on fixed strings, then on real bank pairs. Exit 1 on a failure."""
    fails = []
    def ok(c, m):
        print(('ok   ' if c else 'FAIL ') + m)
        if not c: fails.append(m)
    ok(numbers_in(r'Area $10\,000$ m$^2$, point $(-2, 3)$, $x-4$, 0.50, \exfigure{823_q24_1}')[0] == {'10000', '2', '-2', '3', '4', '0.5'},
       'numbers_in: thousands, signs, figure keys')
    ok(maths_in(r'$\dfrac{1}{2}ab\sin C$ and $2$ metres and $5\text{ cm}^2$') == {r'\frac12ab\sinC'}, 'maths_in: a number alone is not a formula')
    lab = tikz_labels(r'\begin{tikzpicture}\node at (1,2) {5 m}; \draw (0,0) -- node[above] {$3$} (1,0); '
                      r'\foreach \x in {10,20,...,40} \node at (\x,0) {\x}; \end{tikzpicture}')
    ok(set().union(*[numbers_in(t)[0] for t in lab]) == {'5', '3', '10', '20', '30', '40'}, 'tikz_labels: node text, path nodes, \\foreach lists')
    have = {r[0] for r in db.execute('select id from questions where id in (6620, 6972, 1313, 3419, 2272, 2545, 3129, 5287)')}
    if len(have) < 8: print('skip the bank pairs: not in this database')
    else:
        # owner 25 Nov: the two trapezoidal rule questions (2022 Caringbah AT4 Q24, 2022 NEAP AT4 Q29): same numbers in text and diagram
        ok(same_numbers(db, 6620, 6972)[0] == 'same' and relation(db, 6620, 6972, 0.819) == 'duplicate', '6620 ~ 6972 -> duplicate')
        ok(relation(db, 1313, 3419, 0.83) == 'numbers_changed', '1313 ~ 3419 (x < 6 against x < -6) -> numbers_changed')
        ok(relation(db, 2272, 2545, 0.84) == 'numbers_changed', '2272 ~ 2545 (x/(x^2+1) against x/(x^2-1)) -> numbers_changed')
        ok(relation(db, 3129, 5287, 0.85) == 'duplicate', '3129 ~ 5287 at 0.85 -> duplicate (the old rule, unchanged)')
        ok(same_numbers(db, 3129, 5287)[0] == 'differ', '3129 ~ 5287 diagram ticks 15..75 against 10..80 -> differ')
    print('self-check:', 'FAILED' if fails else 'all ok')
    if fails: sys.exit(1)


def main(argv):
    db = sqlite3.connect(paths.DBS)
    if '--self-check' in argv: self_check(db); return
    if '--numbers' in argv:
        docs = {int(a) for a in argv if a.isdigit()}
        if not docs and '--all' not in argv: sys.exit('name the document ids, or --all')
        recheck(db, docs or None, dry='--dry-run' in argv); return
    qs = {}
    for qid, doc, num, stem in db.execute("select id,document_id,number,stem_latex from questions"):
        txt = ' '.join([stem or ''] + [r[0] for r in db.execute('select latex from parts where question_id=? order by ordinal', (qid,))] + [r[0] for r in db.execute('select latex from mcq_options where question_id=? order by label', (qid,))])
        qs[qid] = (doc, num, norm(txt))
    # layer 2: document fingerprint
    bydoc = collections.defaultdict(list)
    for qid, (doc, num, w) in sorted(qs.items()): bydoc[doc].append(' '.join(w))
    for doc, ts in bydoc.items():
        db.execute('update documents set text_fingerprint=? where id=?', (hashlib.sha256(''.join(ts).replace(' ', '').encode()).hexdigest(), doc))
    S = {k: sh(v[2]) for k, v in qs.items() if len(v[2]) >= 6}
    NEW = {int(a) for a in argv if a.isdigit()}   # import batches (11 Nov): only pairs touching these papers are recomputed; earlier pairs stay as reviewed
    if NEW:
        newq = {k for k, v in qs.items() if v[0] in NEW}
        _ids = ','.join(map(str, newq)) or '0'
        db.execute(f'delete from related_questions where question_id in ({_ids}) or related_id in ({_ids})')
    else:
        db.execute('delete from related_questions')
    pairs = []
    for a, b in itertools.combinations(S, 2):
        if qs[a][0] == qs[b][0]: continue
        if NEW and qs[a][0] not in NEW and qs[b][0] not in NEW: continue
        j = len(S[a] & S[b]) / len(S[a] | S[b])
        if j >= 0.5:
            rel = relation(db, a, b, j)
            db.execute('insert into related_questions values (?,?,?,?)', (a, b, round(j, 3), rel)); pairs.append((j, a, b, rel))
    db.commit()
    print('pairs >=0.5:', len(pairs), '>=0.85:', sum(p[0] >= 0.85 for p in pairs), 'duplicate by numbers:', sum(p[3] == 'duplicate' and p[0] < 0.85 for p in pairs))
    c = collections.Counter((min(qs[a][0], qs[b][0]), max(qs[a][0], qs[b][0]), rel) for j, a, b, rel in pairs)
    for k, v in sorted(c.items(), key=lambda x: -x[1])[:15]: print(k, v)
    fp = collections.Counter(r[0] for r in db.execute("select text_fingerprint from documents where text_fingerprint is not null"))
    print('identical doc fingerprints:', sum(v - 1 for v in fp.values() if v > 1))


if __name__ == '__main__':
    main(sys.argv[1:])
