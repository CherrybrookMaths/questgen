"""Topic revision sets (owner, 11 Nov): one PDF per topic, writing space for students, solutions at the back,
space-efficient, and NO question split across pages.

How it keeps questions whole and pages full:
  1. every question (and every solution) is typeset as one unbreakable box and measured by a first LaTeX pass;
  2. boxes are packed onto pages in order, looking a few questions ahead to fill a gap (first fit within a window);
  3. the real document places each box on its packed page with an explicit page break.
A question taller than a whole page (rare) is split between its parts, never inside a part, and reported.

Usage (from the seed folder):
  python3 tools/make_revision.py --title "Sequences and series" --subheadings "Arithmetic sequences and series;Geometric sequences and series" --out out/sequences
  python3 tools/make_revision.py --title "Probability" --ids 109,146,215 --out out/probability
Options: --min-share 0.5 (a question joins a set when at least this share of its parts are on the topic), --exclude 158,166, --window 6
"""
import argparse, json, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_worksheet as W

LINE_FACTOR = {'*': 2.0}
LINES = lambda m, f=2.0: int(f * m + 1) if m else 0   # space-conscious answer space: 1 mark 3 lines, 2 -> 5, 3 -> 7, 4 -> 9 ...
PAGE_SLACK = 6.0                                    # pt kept free at the foot of every page
GAP = 14.4                                          # pt between questions: 7pt + 0.4pt rule + 7pt

PRE = W.PREAMBLE.replace(r'\newcommand{\answerlines}[1]{\par\vspace{4pt}\alcount=#1\loop\ifnum\alcount>0\noindent\rule{\linewidth}{0.3pt}\par\vspace{6.5mm}\advance\alcount by -1\repeat}',
                         r'\newcommand{\answerlines}[1]{\par\noindent\vbox{\hsize\linewidth\alcount=#1\loop\ifnum\alcount>0\vskip7.5mm\hrule width\linewidth height0.3pt\advance\alcount by -1\repeat}\par}') + r"""   % answer lines exactly 7.5 mm apart (no extra baselineskip)
\usepackage{fancyhdr}\pagestyle{fancy}\fancyhf{}\renewcommand{\headrulewidth}{0pt}
\newcommand{\settitle}{}\cfoot{\footnotesize\color{black!55}\settitle\quad\textperiodcentered\quad Page \thepage}
\newsavebox{\qbox}\usepackage{multicol}\setlength{\columnsep}{7mm}\setlength{\columnseprule}{0.2pt}
"""

BOX = lambda c: '\\begin{lrbox}{\\qbox}\\begin{minipage}[t]{\\linewidth}\\setlength{\\parskip}{4pt}' + c + '\\end{minipage}\\end{lrbox}'

def answer_space(marks, enabled):
    return '\n\\answerlines{%d}\n' % LINES(marks, LINE_FACTOR['*']) if enabled and marks else ''
W.answer_space = answer_space

def plain(s): return re.sub(r'\\[a-zA-Z]+|[{}$\\^_]', '', s or '')

def mcq_tex(q):
    """Short options in one row or a 2 x 2 grid to save space; long, table and graph options as in the worksheet builder."""
    opts = q['options']
    if (q.get('options_layout') or 'text') == 'text' and opts and not any(o.get('figure') for o in opts):
        n = max(len(plain(o['latex'])) for o in opts)
        cell = lambda o: f'\\textbf{{{o["label"]}.}}\\ {W.conv(o["latex"])}'
        if n <= 16:
            return '\n\\par\\smallskip\\noindent' + '\\hfill'.join(f'\\makebox[0.24\\linewidth][l]{{{cell(o)}}}' for o in opts) + '\n'
        if n <= 38:
            rows = [opts[i:i + 2] for i in range(0, len(opts), 2)]
            return '\n\\par\\smallskip' + '\\par\\smallskip'.join('\\noindent' + ''.join(f'\\begin{{minipage}}[t]{{0.49\\linewidth}}{cell(o)}\\end{{minipage}}' for o in r) for r in rows) + '\n'
    return W.mcq_tex(q)

def head(n, q, sol=False):
    tag = f'{q["source"]}, {q["qid"]}'
    return f'\\qhead{{{n}}}{{{q["marks"] or ""}}}{{{tag}}}\n'

def question_chunks(n, q):
    """Whole question as one chunk; plus a per-part split (stem with the first part) used only if the whole is taller than a page."""
    stem = W.conv(q['stem']) + '\n' if q['stem'] else ''
    mcq = mcq_tex(q) if q['type'] == 'multiple_choice' else ''
    if len(q['parts']) == 1 and not q['parts'][0]['label']:
        body = W.conv(q['parts'][0]['latex']) + '\n' + ('' if q['type'] == 'multiple_choice' else answer_space(q['marks'], True))
        return [head(n, q) + stem + body + mcq], None
    tops = [p for p in q['parts'] if p['parent_id'] is None]
    def part(p):
        one = dict(q, parts=[x for x in q['parts'] if x['id'] == p['id'] or x['parent_id'] == p['id'] or any(y['id'] == x['parent_id'] and y['parent_id'] == p['id'] for y in q['parts'])])
        sub = W.parts_tex(one, None, True)
        return '\\begin{enumerate}[leftmargin=2.2em,itemsep=8pt]\n' + sub + '\\end{enumerate}\n'
    whole = head(n, q) + stem + '\\begin{enumerate}[leftmargin=2.2em,itemsep=8pt]\n' + W.parts_tex(q, None, True) + '\\end{enumerate}\n' + mcq
    split = [head(n, q) + stem + part(tops[0])] + [f'\\noindent\\textbf{{Question {n} (continued)}}\n' + part(p) for p in tops[1:]]
    return [whole], split

def solution_chunk(n, q):
    W.TABLE_CM = 7.6
    s = W.solution_tex(n, q, False)
    W.TABLE_CM = 16.2
    s = re.sub(r'width=([\d.]+)mm', lambda m: 'width=%.1fmm' % min(float(m.group(1)), 78), s)   # diagrams fit a column
    s = s.replace('0.92\\linewidth', '\\linewidth')
    s = s.replace('\\begin{qblock}\n', '').replace('\\end{qblock}\n', '')
    return re.sub(r'\\qhead\{\d+\}\{[^}]*\}\{[^}]*\}', lambda m: head(n, q, True).strip(), s, count=1)

def measure(chunks, outdir):
    body = [PRE, '\\begin{document}\n']
    for i, c in enumerate(chunks):
        body.append(BOX(c) + f'\\typeout{{HGT:{i}:\\the\\ht\\qbox:\\the\\dp\\qbox}}\n')
    body.append('\\typeout{PAGE:\\the\\textheight}\\end{document}\n')
    tex = os.path.join(outdir, '_measure.tex'); open(tex, 'w').write(''.join(body))
    r = subprocess.run(['pdflatex', '-interaction=nonstopmode', '-halt-on-error', '_measure.tex'], cwd=outdir, capture_output=True, text=True)
    if r.returncode: print([l for l in r.stdout.splitlines() if l.startswith('!') or l.startswith('l.')][:6]); sys.exit(1)
    log = open(os.path.join(outdir, '_measure.log')).read()
    h = {int(a): float(b) + float(c) for a, b, c in re.findall(r'HGT:(\d+):([\d.]+)pt:([\d.]+)pt', log)}
    page = float(re.search(r'PAGE:([\d.]+)pt', log).group(1))
    return [h[i] for i in range(len(chunks))], page

def pack(heights, groups, first_page_used, page):
    """Best fit: on each page keep adding the tallest box that still fits (space-efficient), so questions are not in paper order.
    groups[i] = (question index, part chunk number); a question's later chunks are only placed after its earlier ones."""
    pages, cur, used, todo = [], [], first_page_used, list(range(len(heights)))
    ready = lambda i: groups[i][1] == 0 or all(j not in todo for j in todo if False) and not any(groups[j][0] == groups[i][0] and groups[j][1] < groups[i][1] for j in todo)
    while todo:
        cap = page - PAGE_SLACK - used - (GAP if cur else 0)
        pending = [i for i in todo if groups[i][1] > 0 and not any(groups[j][0] == groups[i][0] and groups[j][1] < groups[i][1] for j in todo)]
        if pending and not cur:   # a split question continues at the top of the next page, never pages later
            fits = [min(pending, key=lambda i: groups[i][1])]
        else:
            fits = [i for i in todo if ready(i) and heights[i] <= cap and not (pending and i not in pending)]
        if not fits:
            if not cur:   # taller than an empty page and could not be split: place it alone
                fits = [next(i for i in todo if ready(i))]
            else:
                pages.append(cur); cur, used = [], 0; continue
        pick = max(fits, key=lambda i: (heights[i], -i))
        used += heights[pick] + (GAP if cur else 0); cur.append(pick); todo.remove(pick)
    if cur: pages.append(cur)
    return pages

INTEG = re.compile(r'\\int\b|\\int_|integra|primitive|anti-?derivative|area (under|between|bounded|enclosed)|trapezoidal', re.I)

def is_integration(q, p):
    """A part is integration if its primary syllabus tag is in Integral calculus, or its text asks for an integral / primitive / area."""
    fa = lambda t: W.DOTS.get(t.get('dot_point'), {}).get('focus_area')
    return any(t.get('primary') and fa(t) == 'Integral calculus' for t in p['syllabus_2024']) or bool(INTEG.search(p['latex'] or ''))

def drop_integration(q):
    """Owner (11 Nov): "NO integration in ANY OF THE SETS". Integration parts are removed with their solutions and marks.
    If an integration part comes before a part that is kept (later parts may build on it), or the stem itself is about
    integration, or nothing is left, the whole question is left out. Returns (question or None, removed part labels)."""
    if q['type'] == 'multiple_choice':
        txt = (q['stem'] or '') + ' '.join(p['latex'] or '' for p in q['parts']) + ' '.join(o['latex'] or '' for o in q['options'])
        return (None, ['all']) if INTEG.search(txt) or any(is_integration(q, p) for p in q['parts']) else (q, [])
    if INTEG.search(q['stem'] or ''): return None, ['all']
    leaf = [p for p in q['parts'] if p['is_leaf']]
    bad = [p for p in leaf if is_integration(q, p)]
    if not bad: return q, []
    first_bad = min(leaf.index(p) for p in bad)
    if any(p not in bad for p in leaf[first_bad:]) or len(bad) == len(leaf): return None, ['all']
    gone = {p['id'] for p in bad}
    # remove empty parents too
    keep = [p for p in q['parts'] if p['id'] not in gone]
    keep = [p for p in keep if p['is_leaf'] or any(c['parent_id'] == p['id'] for c in keep)]
    ids = {p['id'] for p in keep}
    q2 = dict(q, parts=keep, solutions=[x for x in q['solutions'] if x['part_id'] is None or x['part_id'] in ids],
              marks=sum(p['marks'] or 0 for p in keep if p['is_leaf']) or q['marks'])
    return q2, [p['label'] for p in bad]

def build(qs, title, out, window=None):
    kept, report = [], []
    for q in qs:
        q2, gone = drop_integration(q)
        if gone: report.append((q['qid'], q['source'], 'whole question' if gone == ['all'] else 'parts ' + ', '.join('(%s)' % g for g in gone)))
        if q2: kept.append(q2)
    qs = kept
    for r in report: print('no integration:', *r)
    outdir = os.path.dirname(os.path.abspath(out)); os.makedirs(outdir, exist_ok=True); W.OUTDIR = outdir
    wholes = [question_chunks(0, q) for q in qs]
    hs, page = measure([w[0][0] for w in wholes], outdir)
    # a question taller than a page: first try its diagrams smaller (down to 60%) so it stays whole; split between parts only if that fails
    tall = [k for k, h in enumerate(hs) if h > page - PAGE_SLACK]
    if tall:
        keys = {k: re.findall(r'\\includegraphics\[width=[\d.]+mm\]\{[^}]*/([\w.-]+)\.(?:pdf|png)\}', wholes[k][0][0]) for k in tall}
        for k in tall:
            for f in keys[k]: W.FIG_SCALE[f] = 0.6
        hs2, _ = measure([question_chunks(0, qs[k])[0][0] for k in tall], outdir)
        for k, h2 in zip(tall, hs2):
            if h2 <= page - PAGE_SLACK: wholes[k] = question_chunks(0, qs[k]); hs[k] = h2
            else:   # still too tall: also 1.5 lines per mark instead of 2 for this question only
                LINE_FACTOR['*'] = 1.5; c3 = question_chunks(0, qs[k]); h3, _ = measure([c3[0][0]], outdir); LINE_FACTOR['*'] = 2.0
                if h3[0] <= page - PAGE_SLACK: wholes[k] = ('LF', c3); hs[k] = h3[0]
                else:
                    for f in keys[k]: W.FIG_SCALE.pop(f, None)
    plan, split_report = [], []          # (question index, chunk number, use split?)
    tight = {k for k, w in enumerate(wholes) if w[0] == 'LF'}
    wholes = [w[1] if w[0] == 'LF' else w for w in wholes]
    for k, ((whole, split), h) in enumerate(zip(wholes, hs)):
        if h > page - PAGE_SLACK and split:
            split_report.append(qs[k]['qid']); plan += [(k, c, True) for c in range(len(split))]
        else:
            plan.append((k, 0, False))
    def text(k, c, sp, n):
        if k in tight: LINE_FACTOR['*'] = 1.5
        t = question_chunks(n, qs[k])[1][c] if sp else question_chunks(n, qs[k])[0][0]
        LINE_FACTOR['*'] = 2.0
        return t
    title_tex = (f'{{\\Large\\textbf{{{title}}}}}\\hfill {sum(q["marks"] or 0 for q in qs)} marks\\par\\smallskip\n'
                 f'{{\\footnotesize {len(qs)} questions from NSW HSC, trial and school assessment papers. Solutions from page \\pageref{{sol}}.}}\\par\n'
                 '\\rule{\\linewidth}{0.6pt}\\par\\smallskip Name: \\rule{60mm}{0.3pt}\\qquad Date: \\rule{30mm}{0.3pt}\\par\\medskip\n')
    sol_title = f'{{\\Large\\textbf{{{title}: solutions}}}}\\label{{sol}}\\par\\smallskip\\rule{{\\linewidth}}{{0.6pt}}\\par\\medskip\n'
    allh, _ = measure([text(k, c, sp, 0) for k, c, sp in plan] + [f'\\noindent{title_tex}'], outdir)
    qh, t1 = allh[:-1], allh[-1]
    qpages = pack(qh, [(k, c) for k, c, sp in plan], t1 + GAP, page)
    # number questions in the order they now appear; solutions follow the same numbering
    num = {}
    for pg in qpages:
        for i in pg: num.setdefault(plan[i][0], len(num) + 1)
    body = [PRE.replace('\\newcommand{\\settitle}{}', f'\\newcommand{{\\settitle}}{{{title}}}'), '\\begin{document}\n']
    # each page is one box exactly \\textheight tall built from the measured boxes, so TeX breaks pages exactly where the packer did
    put = lambda c: '\\begin{lrbox}{\\qbox}\\begin{minipage}[t]{\\linewidth}\\setlength{\\parskip}{4pt}' + c + '\\end{minipage}\\end{lrbox}\\hbox{\\usebox{\\qbox}}\n'
    sep = '\\vskip7pt{\\color{black!15}\\hrule height0.4pt}\\vskip7pt\n'
    for pi, pg in enumerate(qpages):
        body.append('\\vbox to\\textheight{\\offinterlineskip\n')
        items = ([put('\\noindent' + title_tex)] if pi == 0 else []) + [put(text(plan[i][0], plan[i][1], plan[i][2], num[plan[i][0]])) for i in pg]
        body.append(sep.join(items) + '\\vfil}\n\\newpage\n')
    # solutions are reference pages: they flow (a long solution may continue overleaf) so the answers take as few pages as possible;
    # rubric tables never split
    body.append(f'\\noindent{sol_title}\n\\begin{{multicols}}{{2}}\\small\\sloppy\n')   # two narrow columns: worked solutions are narrow, so this roughly halves the pages
    for n, k in enumerate(sorted(num, key=num.get), 1):
        if n > 1: body.append(f'\\par\\vspace{{{GAP}pt}}\\noindent\\textcolor{{black!15}}{{\\rule{{\\linewidth}}{{0.4pt}}}}\\par\n')
        body.append(solution_chunk(n, qs[k]) + '\n')
    body.append('\\end{multicols}\n\\end{document}\n')
    tex = out + '.tex'; open(tex, 'w').write(''.join(body))
    for _ in range(2):
        r = subprocess.run(['pdflatex', '-interaction=nonstopmode', '-halt-on-error', os.path.basename(tex)], cwd=outdir, capture_output=True, text=True)
    if r.returncode: print([l for l in r.stdout.splitlines() if l.startswith('!') or l.startswith('l.')][:6]); sys.exit(1)
    log = open(out + '.log').read()
    pages_total = int(re.search(r'Output written on .*?\((\d+) page', log).group(1))
    print(json.dumps(dict(pdf=out + '.pdf', questions=len(qs), marks=sum(q['marks'] or 0 for q in qs), question_pages=len(qpages), total_pages=pages_total,
                          fill=round(sum(qh) / (len(qpages) * page), 2), split_over_pages=split_report, overfull=len(re.findall(r'Overfull \\vbox', log)))))

if __name__ == '__main__':
    a = argparse.ArgumentParser()
    a.add_argument('--title', required=True); a.add_argument('--out', required=True)
    a.add_argument('--ids'); a.add_argument('--subheadings'); a.add_argument('--min-share', type=float, default=0.5)
    a.add_argument('--exclude', default=''); a.add_argument('--window', type=int, default=6)
    o = a.parse_args()
    if o.ids: qs = [W.Q[int(i)] for i in o.ids.split(',')]
    else:
        subs = set(o.subheadings.split(';')); ex = {int(x) for x in o.exclude.split(',') if x}
        sub = lambda t: W.DOTS.get(t.get('dot_point'), {}).get('subheading')
        qs = []
        for q in W.Q.values():
            if q['id'] in ex or q.get('old_syllabus') or q.get('standard_course'): continue
            leaf = [p for p in q['parts'] if p['is_leaf']]
            hit = [p for p in leaf if any(t.get('primary') and sub(t) in subs for t in p['syllabus_2024'])]
            if leaf and len(hit) / len(leaf) >= o.min_share: qs.append(q)
        # multiple choice first, then short answer by marks (easier first); within each, by paper year
        yr = lambda q: int(q['source'][:4])
        qs.sort(key=lambda q: (q['type'] != 'multiple_choice', q['marks'] or 0, yr(q), q['id']))
    build(qs, o.title, o.out)
