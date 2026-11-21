#!/usr/bin/env python3
"""Reference worksheet / exam builder for the HSC Advanced question bank seed.

Turns a list of question ids into a print-ready exam (LaTeX -> PDF) and a matching marking guide.
It is a reference implementation of the rendering rules in README.md, not a product: a real exam maker would call the
same conversion logic from its backend.

  python3 tools/make_worksheet.py --ids 205,231,262 --title "Integration practice" --out out/integration
  python3 tools/make_worksheet.py --topic "Areas and the definite integral" --max 8 --out out/areas
  python3 tools/make_worksheet.py --all --out out/everything          # every unique question (stress test)

Options: --fig-scale 0.8 (all diagrams), --fig-scales scales.json (per diagram), --no-space (no answer lines), --include-pending (also print model solutions not yet approved, marked as such)
Needs: pdflatex (TeX Live 2022+), packages amsmath, txfonts, graphicx, tabularx, array, enumitem, geometry, xcolor.
Run from the seed folder (the one with data/ and figures/)."""
import argparse, json, os, re, subprocess, shutil, sys

OUTDIR = '.'
TABLE_CM = 16.2          # widest a data table may be (cm); make_revision sets it to the column width for two-column solutions
FIG_SCALE = {'*': 1.0}   # per-figure scale factors, e.g. {'*': 0.9, '34_q30_1': 1.3}; labels scale with the figure
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
L = lambda f: json.load(open(os.path.join(ROOT, 'data', f)))
Q = {q['id']: q for q in L('questions.json')}
PAPERS = {p['id']: p for p in L('papers.json')}
FIGS, TABLES, DOTS = L('figures.json'), L('tables.json'), {d['id']: d for d in L('syllabus_2024.json')}

UNI = {'−': '-', '–': '--', '—': '---', '‘': '`', '’': "'", '“': '``', '”': "''", '…': '\\ldots{}', '×': '$\\times$',
       '÷': '$\\div$', '≤': '$\\le$', '≥': '$\\ge$', '≠': '$\\ne$', '°': '$^\\circ$', 'π': '$\\pi$', '√': '$\\surd$',
       '±': '$\\pm$', '²': '$^2$', '³': '$^3$', 'θ': '$\\theta$', 'µ': '$\\mu$', 'μ': '$\\mu$', 'σ': '$\\sigma$',
       '∴': '$\\therefore$', '→': '$\\to$', '⇒': '$\\Rightarrow$', '∞': '$\\infty$', '\u00a0': '~', '·': '$\\cdot$', '′': "$'$", '•': '\\textbullet{}'}

def fig_tex(key):
    f = FIGS.get(key)
    if not f: return f'\\fbox{{missing figure {key}}}'
    path = f['crop_print'] if f.get('use') != 'redraw' else (f.get('redraw_pdf') or f['redraw'])
    w = min(f['print_width_mm'] * FIG_SCALE.get(key, FIG_SCALE.get('*', 1.0)), 170)
    return f'\n\n\\begin{{center}}\\includegraphics[width={w}mm]{{{os.path.relpath(os.path.join(ROOT, path), OUTDIR)}}}\\end{{center}}\n\n'

def table_tex(tid):
    t = TABLES.get(tid)
    if not t: return f'\\fbox{{missing table {tid}}}'
    rows, n = t['rows'], max(len(r) for r in t['rows'])
    lc = 1 if t['label_column'] else 0
    span, rspan, covered = {}, {}, set()
    for s in t['colspans']:
        span[(s['row'], s['col'])] = s.get('span', 1)
        rs = s.get('rowspan', 1)
        if rs > 1:
            rspan[(s['row'], s['col'])] = rs
            for i in range(1, rs):
                for j in range(s.get('span', 1)): covered.add((s['row'] + i, s['col'] + j))
    plain = lambda c: re.sub(r'\\[a-zA-Z]+|[{}$\\]', '', c)
    lines = lambda c: [x.strip() for x in re.split(r'\\\\', c)]          # a cell wraps where the paper wraps it (\\)
    ll = lambda c: max([len(plain(x)) for x in lines(c)] + [0])
    hr = t['header_rows']; hdr = rows[max(0, hr - 1)] if rows else []
    uniform = (not hr) or all(ll(c) <= 8 for c in hdr[lc:])               # number tables: equal columns; word tables: sized per column
    vw = min(max([ll(c) for i, r in enumerate(rows) for j, c in enumerate(r) if j >= lc and span.get((i, j), 1) == 1] + [3]) * 0.21 + 0.5, 3.8)   # a header spanning several columns does not widen each one
    def colw(j): return min(max([ll(r[j]) for i, r in enumerate(rows) if j < len(r) and (i, j) not in covered and span.get((i, j), 1) == 1] + [3]) * 0.2 + 0.5, 7.5)
    widths = [vw if uniform else colw(j) for j in range(lc, n)]
    avail = TABLE_CM - (1.2 if lc else 0) - 0.45 * (n - lc)                   # text width less label column and cell padding: never wider than the page
    if sum(widths) > avail: widths = [w * avail / sum(widths) for w in widths]
    spec = '|' + ('c|' if lc else '') + '|'.join(['>{\\centering\\arraybackslash}p{%.2fcm}' % w for w in widths]) + '|'
    def fmt(c):
        if not c.strip(): return ''
        ls = lines(c)
        return f'${ls[0]}$' if len(ls) == 1 else '{\\renewcommand{\\arraystretch}{1.1}\\begin{tabular}[c]{@{}c@{}}' + '\\\\'.join(f'${x}$' for x in ls) + '\\end{tabular}}'   # each paper line its own row, properly spaced
    out = []
    for i, r in enumerate(rows):
        r = r + [''] * (n - len(r)); cells, skip = [], 0
        for j, c in enumerate(r):
            if skip: skip -= 1; continue
            if (i, j) in covered: cells.append(''); continue
            dg = re.match(r'^\\diag\{(.*)\}\{(.*)\}$', c.strip())          # corner cell split by a diagonal (row label bottom-left, column label top-right)
            if dg:
                rs = rspan.get((i, j), 1)
                v = '\\diagbox[height=%.2f\\baselineskip]{%s}{%s}' % (1.35 * rs, fmt(dg.group(1)), fmt(dg.group(2)))
                if rs > 1: v = f'\\multirow{{{rs}}}{{*}}{{{v}}}'
            else:
                v = fmt(c)
                if (i, j) in rspan: v = f'\\multirow{{{rspan[(i, j)]}}}{{*}}{{{v}}}'
            if span.get((i, j), 1) > 1:
                k = span[(i, j)]; skip = k - 1
                v = f'\\multicolumn{{{k}}}{{c|}}{{{v}}}'
            cells.append(v)
        below = {j for (a, j) in covered if a == i + 1}                     # columns still merged into the next row: no rule under them
        rule = '\\hline' if not below else ''.join(f'\\cline{{{j + 1}-{j + 1}}}' for j in range(n) if j not in below)
        out.append(' & '.join(cells) + ' \\\\ ' + rule + ('\\hline' if i == hr - 1 else ''))
    cap = f'\\textbf{{{conv(t["caption"])}}}\\\\[2pt]\n' if t['caption'] else ''
    return f'\n\n\\begin{{center}}{cap}\\renewcommand{{\\arraystretch}}{{1.35}}\\begin{{tabular}}{{{spec}}}\\hline\n' + '\n'.join(out) + '\n\\end{tabular}\\end{center}\n\n'

def conv(s):
    """LaTeX-in-prose (README section 4) -> LaTeX body."""
    if not s: return ''
    s = s.replace('\\text{\\textdollar}', '\\$').replace('\\textdollar', '\\$')
    s = re.sub(r'\*\*(.+?)\*\*', r'\\textbf{\1}', s)                     # stray markdown bold in model solutions
    s = re.sub(r'\\exfigure\{([\w.-]+)\}', lambda m: fig_tex(m.group(1)), s)
    s = re.sub(r'\\extable\{(\w+)\}', lambda m: table_tex(m.group(1)), s)
    # escape text-mode specials outside math
    parts = re.split(r'(\$\$.*?\$\$|\$.*?\$|\\begin\{center\}.*?\\end\{center\})', s, flags=re.S)
    for i in range(0, len(parts), 2):
        t = parts[i]
        t = re.sub(r'(?<!\\)([%&#_])', r'\\\1', t)
        t = t.replace('^', '\\textasciicircum{}')   # plain-text maths in some criteria (to be fixed in the data)
        for a, b in UNI.items(): t = t.replace(a, b)
        parts[i] = t
    s = ''.join(parts)
    s = s.replace('′', "'").replace('−', '-')
    s = re.sub(r'\$\$(.*?)\$\$', r'\\[\1\\]', s, flags=re.S)
    return s.replace('\n\n', '\n\n\\par ').replace('\r', '')

def answer_space(marks, enabled):
    if not enabled or not marks: return ''
    n = {1: 3, 2: 6, 3: 9, 4: 12}.get(marks, 3 * marks)
    return '\n\\answerlines{%d}\n' % n

def mcq_tex(q):
    """MCQ_SPEC.md: one layout per question. text = vertical list; table = one table, A-D outside left, italic headers;
    graph = 2x2 grid, letter outside each drawing (top-left)."""
    layout = q.get('options_layout') or ('table' if q.get('options_table') else 'text')
    opts = q['options']
    if layout == 'table' and q.get('options_table'):
        ot = q['options_table']; k = len(ot['headers'])
        spec = 'r|' + '|'.join(['>{\\centering\\arraybackslash}p{%.1fcm}' % (12 / k)] * k) + '|'
        hcell = lambda h: '\\itshape\\begin{tabular}{@{}c@{}}' + ' \\\\ '.join(conv(x) for x in h.split('\\\\')) + '\\end{tabular}'
        head = ' & ' + ' & '.join(hcell(h) for h in ot['headers']) + ' \\\\ \\cline{2-%d}' % (k + 1)
        body = '\n'.join(f'{l}. & ' + ' & '.join(conv(c) for c in ot['rows'][l]) + ' \\\\ \\cline{2-%d}' % (k + 1) for l in 'ABCD' if l in ot['rows'])
        return f'\n\\begin{{center}}\\renewcommand{{\\arraystretch}}{{1.4}}\\begin{{tabular}}{{{spec}}}\\cline{{2-{k+1}}}\n{head}\n{body}\n\\end{{tabular}}\\end{{center}}\n'
    if layout == 'graph':
        def cell(o):
            f = o.get('figure')
            inner = fig_tex(f).replace('\\begin{center}', '').replace('\\end{center}', '').strip() if f else conv(o['latex'])
            inner = re.sub(r'width=([\d.]+)mm', lambda m: 'width=%.1fmm' % min(float(m.group(1)), 78), inner)
            return f'\\begin{{minipage}}[t]{{0.48\\linewidth}}\\textbf{{{o["label"]}.}}\\par\\centering {inner}\\end{{minipage}}'
        rows = [opts[i:i + 2] for i in range(0, len(opts), 2)]
        return '\n\n' + '\n\n\\medskip\n'.join('\\noindent' + '\\hfill'.join(cell(o) for o in r) for r in rows) + '\n\n'
    return '\n\\begin{enumerate}[label=\\Alph*.,leftmargin=2em,itemsep=4pt]\n' + ''.join(f'\\item {conv(o["latex"])}\n' for o in opts) + '\\end{enumerate}\n'

def parts_tex(q, parent, space):
    kids = [p for p in q['parts'] if p['parent_id'] == parent]
    out = ''
    for p in kids:
        sub = parts_tex(q, p['id'], space)
        mk = f'\\qmarks{{{p["marks"]}}}' if p['marks'] and not (len(q['parts']) == 1) else ''
        body = conv(p['latex']) + mk + ('' if sub else answer_space(p['marks'], space and q['type'] != 'multiple_choice'))
        if p['label']:
            out += f'\\item[({p["label"]})] {body}\n'
            if sub: out += '\\begin{enumerate}[leftmargin=2.2em,itemsep=6pt]\n' + sub + '\\end{enumerate}\n'
        else:
            out += f'\\item[] {body}\n' + (('\\begin{enumerate}[leftmargin=2.2em]\n' + sub + '\\end{enumerate}\n') if sub else '')
    return out

def question_tex(n, q, space):
    paper = PAPERS[q['paper_id']]['label']
    head = f'\\qhead{{{n}}}{{{q["marks"] or ""}}}{{{paper}, Q{q["number"]}, QID {q["id"]:04d}{", old syllabus" if q.get("old_syllabus") else ", Standard course" if q.get("standard_course") else ""}}}\n'
    stem = conv(q['stem']) + '\n' if q['stem'] else ''
    parts = parts_tex(q, None, space)
    body = '\\begin{enumerate}[leftmargin=2.2em,itemsep=8pt]\n' + parts + '\\end{enumerate}\n' if parts.strip() else ''
    mcq = mcq_tex(q) if q['type'] == 'multiple_choice' else ''
    # single unlabelled part: print its text without the list indent
    if len(q['parts']) == 1 and not q['parts'][0]['label']:
        body = conv(q['parts'][0]['latex']) + '\n' + ('' if q['type'] == 'multiple_choice' else answer_space(q['marks'], space))
    inner = head + stem + body + mcq
    if q['type'] == 'multiple_choice':   # an MCQ is short: keep question and options on one page
        inner = '\\begin{minipage}{\\linewidth}\n' + inner + '\\end{minipage}\n'
    return '\\begin{qblock}\n' + inner + '\\end{qblock}\n'

def solution_tex(n, q, pending):
    out = f'\\qhead{{{n}}}{{{q["marks"] or ""}}}{{{PAPERS[q["paper_id"]]["label"]}, Q{q["number"]}}}\n'
    mcq = q['type'] == 'multiple_choice'
    key = next((o['label'] for o in q['options'] if o['correct']), '?') if mcq else None
    labels = {p['id']: p['label'] for p in q['parts']}
    shown = 0
    for s in q['solutions']:
        gen = s['source'] == 'model_generated'
        if gen and not s['approved'] and not pending: continue
        if s['rejected']: continue
        lab = labels.get(s['part_id'])
        out += (f'\\textbf{{({lab})}}\\quad ' if lab else '') + ('\\textit{[Model-generated, not yet approved]}\\quad ' if gen and not s['approved'] else '')
        if s['latex'].strip(): out += conv(s['latex']) + '\n\n'
        crit = [c for c in s['criteria'] if c['criterion']]   # owner: every short-answer solution shows its full rubric, including a lone "Correct answer" row
        if mcq:   # SOLUTION_SPEC: the MCQ answer sits in the rubric's Answer column, never as an "Answer:" line
            rows = [{'marks': sum((c['marks'] or 0) for c in s['criteria']) or q['marks'] or 1, 'criterion': ''}]   # always just "Correct answer"
            out += '\\begin{center}\\renewcommand{\\arraystretch}{1.3}\\begin{tabularx}{0.92\\linewidth}{|c|c|X|}\\hline\n\\textbf{Marks} & \\textbf{Answer} & \\textbf{Criteria} \\\\ \\hline\n'
            out += ''.join(f'{c["marks"] if c["marks"] is not None else ""} & {key if i == 0 else ""} & {conv(c["criterion"]) or "Correct answer"} \\\\ \\hline\n' for i, c in enumerate(rows))
            out += '\\end{tabularx}\\end{center}\n'
            crit = []
        if crit:
            out += '\\begin{center}\\renewcommand{\\arraystretch}{1.3}\\begin{tabularx}{0.92\\linewidth}{|c|X|}\\hline\n\\textbf{Marks} & \\textbf{Criteria} \\\\ \\hline\n'
            out += ''.join(f'{c["marks"] if c["marks"] is not None else ""} & {conv(c["criterion"])} \\\\ \\hline\n' for c in crit)
            out += '\\end{tabularx}\\end{center}\n'
        if s['meta'].get('marker_note'): out += f'\\textit{{Marker\'s note: {conv(s["meta"]["marker_note"])}}}\n\n'
        shown += 1
    if not shown and mcq:
        out += '\\begin{center}\\renewcommand{\\arraystretch}{1.3}\\begin{tabularx}{0.92\\linewidth}{|c|c|X|}\\hline\n\\textbf{Marks} & \\textbf{Answer} & \\textbf{Criteria} \\\\ \\hline\n' + f'{q["marks"] or 1} & {key} & Correct answer \\\\ \\hline\n' + '\\end{tabularx}\\end{center}\n'
    if not shown and q['type'] != 'multiple_choice': out += '\\textit{No approved solution yet.}\n\n'
    return '\\begin{qblock}\n' + out + '\\end{qblock}\n'

PREAMBLE = r"""\documentclass[11pt,a4paper]{article}
\usepackage[margin=20mm]{geometry}
\usepackage[T1]{fontenc}\usepackage[utf8]{inputenc}
\usepackage{amsmath,amssymb,txfonts,graphicx,array,tabularx,enumitem,xcolor,multirow,framed,diagbox}
\setlength{\parindent}{0pt}\setlength{\parskip}{4pt}
\newcommand{\qmarks}[1]{\hfill\mbox{\textbf{#1}}}
\newcount\alcount
\newcommand{\answerlines}[1]{\par\vspace{4pt}\alcount=#1\loop\ifnum\alcount>0\noindent\rule{\linewidth}{0.3pt}\par\vspace{6.5mm}\advance\alcount by -1\repeat}
\newcommand{\qhead}[3]{\par\noindent\textbf{Question #1}\ \ {\footnotesize\color{black!55}(#3)}\hfill\textbf{#2\ifx&#2&\else\ mark\ifnum#2=1\else s\fi\fi}\par\smallskip}
\usepackage{needspace}
\newenvironment{qblock}{\par\medskip\Needspace{14\baselineskip}}{\par\medskip}% questions may break between parts/answer lines, never leave a blank page
\allowdisplaybreaks
"""

def build(ids, title, out, space, pending):
    global OUTDIR; OUTDIR = os.path.dirname(os.path.abspath(out))
    os.makedirs(os.path.dirname(os.path.abspath(out)) or '.', exist_ok=True)
    qs = [Q[i] for i in ids]
    total = sum(q['marks'] or 0 for q in qs)
    for kind in ('exam', 'solutions'):
        body = [PREAMBLE, '\\begin{document}\n', f'{{\\Large\\textbf{{{title}}}}}\\hfill {total} marks\n\n',
                '\\rule{\\linewidth}{0.6pt}\n\n' + ('Name: \\rule{60mm}{0.3pt}\\qquad Date: \\rule{30mm}{0.3pt}\n\n' if kind == 'exam' else '\\textbf{Marking guidelines}\n\n')]
        for n, q in enumerate(qs, 1):
            body.append(question_tex(n, q, space) if kind == 'exam' else solution_tex(n, q, pending))
        body.append('\\end{document}\n')
        tex = f'{out}_{kind}.tex'; open(tex, 'w').write(''.join(body))
        d = os.path.dirname(os.path.abspath(tex))
        for _ in range(2):
            r = subprocess.run(['pdflatex', '-interaction=nonstopmode', '-halt-on-error', os.path.basename(tex)], cwd=d, capture_output=True, text=True)
        if r.returncode:
            err = [l for l in r.stdout.splitlines() if l.startswith('!') or l.startswith('l.')]
            print('LaTeX error in', tex, err[:6]); sys.exit(1)
        print('wrote', tex[:-4] + '.pdf')

if __name__ == '__main__':
    a = argparse.ArgumentParser()
    a.add_argument('--ids'); a.add_argument('--topic'); a.add_argument('--all', action='store_true')
    a.add_argument('--max', type=int, default=0); a.add_argument('--title', default='Worksheet')
    a.add_argument('--out', default='out/worksheet'); a.add_argument('--no-space', action='store_true')
    a.add_argument('--include-pending', action='store_true')
    a.add_argument('--include-standard', action='store_true', help='also pick Mathematics Standard questions (bivariate data, data analysis, finance)')
    a.add_argument('--include-old', action='store_true', help='also pick old-syllabus questions (2017-only content); --ids always uses exactly the ids given')
    a.add_argument('--fig-scale', type=float, default=1.0, help='scale every diagram (e.g. 0.8 for a compact worksheet)')
    a.add_argument('--fig-scales', help='JSON file {figure_key: scale} for individual diagrams')
    o = a.parse_args()
    FIG_SCALE['*'] = o.fig_scale
    if o.fig_scales: FIG_SCALE.update(json.load(open(o.fig_scales)))
    if o.ids: ids = [int(x) for x in o.ids.split(',')]
    else:
        pool = [q for q in Q.values() if (o.include_old or not q.get('old_syllabus')) and (o.include_standard or not q.get('standard_course'))]   # owner: old-syllabus questions are marked; leave them out unless asked
        if o.topic:
            pool = [q for q in pool if any(DOTS.get(t['dot_point'], {}).get('subheading') == o.topic and t['primary'] for p in q['parts'] for t in p['syllabus_2024'])]
        ids = [q['id'] for q in sorted(pool, key=lambda q: (q['paper_id'], int(re.sub(r'\D', '', q['number']) or 0)))]
    if o.max: ids = ids[:o.max]
    if not ids: sys.exit('no questions matched')
    build(ids, o.title, o.out, not o.no_space, o.include_pending)
