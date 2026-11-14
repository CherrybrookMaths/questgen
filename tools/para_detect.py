"""Find paragraph breaks in the source pages that the transcription lost.
Source paragraphs: digital PDFs from the text layer (PyMuPDF lines), scans via tesseract lines; a paragraph starts
where the vertical gap to the previous line is clearly larger than normal line spacing.
Each paragraph's first words are located in our text; if our text runs straight on there (no blank line), propose a break."""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import pymupdf, sqlite3, re, json, subprocess, statistics, sys, os, io
db = sqlite3.connect(paths.DBS)
W = re.compile(r"[A-Za-z]{3,}")
def src_lines(doc, pno, digital):
    # OCR the same page image the review page shows (work/<doc>/pNN.png, NN = page_start), so page numbering always agrees
    png = paths.W + f'{doc}/p{pno:02d}.png'
    cache = paths.W + f'paras/{doc}_{pno}.tsv'
    if not os.path.exists(cache):
        open(cache, 'w').write(subprocess.run(['tesseract', png, '-', '--psm', '4', 'tsv'], capture_output=True, text=True).stdout)
    lines = {}
    for r in open(cache).read().splitlines()[1:]:
        f = r.split('\t')
        if len(f) < 12 or not f[11].strip() or f[0] != '5': continue
        k = (f[2], f[3], f[4]); x, y, w, h = map(int, f[6:10])
        a = lines.setdefault(k, [1e9, 0, 1e9, [], 0]); a[0] = min(a[0], y); a[1] = max(a[1], y + h); a[2] = min(a[2], x); a[3].append(f[11]); a[4] = max(a[4], x + w)
    L = [(a[0], a[1], a[2], ' '.join(a[3]), a[4]) for a in lines.values()]
    L.sort(); return L
def paragraphs(L):
    # a paragraph starts where the top-to-top distance from the previous line is well over a normal line pitch
    L = [l for l in L if len(l[3]) > 3]
    if len(L) < 2: return []
    h = statistics.median([l[1] - l[0] for l in L])
    right = sorted(l[4] for l in L)[int(len(L) * 0.8)]          # typical right margin of full lines
    out = []
    for i in range(1, len(L)):
        gap = L[i][0] - L[i - 1][0] > 1.8 * h
        # forced line break: previous line ends a sentence well short of the margin, next starts a new sentence at the same indent
        short = (re.search(r'[.?:]$', L[i - 1][3]) and L[i - 1][4] < right - 4 * h and L[i][3][:1].isupper() and abs(L[i][2] - L[i - 1][2]) < h)
        if gap or short: out.append(L[i][3])
    return out
def tokens(s):
    # words of our text outside maths and commands, with positions
    out = []; mask = re.sub(r'\$\$.*?\$\$|\$[^$]*\$|\\[A-Za-z]+(\{[^{}]*\})?', lambda m: ' ' * len(m.group()), s, flags=re.S)
    for m in W.finditer(mask): out.append((m.group().lower(), m.start()))
    return out
props = []
docs = {d: (dig == 'digital') for d, dig in db.execute('select id,parse_path from documents where id in (select distinct document_id from questions)')}
for doc, digital in docs.items():
    qs = db.execute('select id,page_start,page_end from questions where document_id=?', (doc,)).fetchall()
    starts = {}
    for pno in sorted({p for _, a, b in qs for p in range(a, (b or a) + 1)}):
        try: starts[pno] = paragraphs(src_lines(doc, pno, digital))
        except Exception as e: print('ERR', doc, pno, e)
    for qid, a, b in qs:
        heads = [h for p in range(a, (b or a) + 1) for h in starts.get(p, [])]
        fields = [('questions', 'stem_latex', qid, db.execute('select stem_latex from questions where id=?', (qid,)).fetchone()[0])] + \
                 [('parts', 'latex', pid, l) for pid, l in db.execute('select id,latex from parts where question_id=?', (qid,))]
        for tbl, col, rid, s in fields:
            if not s: continue
            tk = tokens(s); seq = [t for t, _ in tk]
            for h in heads:
                hw = [w.lower() for w in W.findall(re.sub(r'^\(?[a-z]{1,3}\)\s*', '', h))][:4]
                if len(hw) < 3: continue
                for i in range(len(seq) - len(hw) + 1):
                    if seq[i:i + len(hw)] == hw:
                        pos = tk[i][1]
                        m2 = re.search(r'(?:\b[A-Za-z]{1,2}\s+)+$', s[:pos])   # paragraph may open with short words ("A shoe shop", "If a ...") that are not tokens
                        if m2: pos = m2.start()
                        before = s[:pos].rstrip(' ')
                        if not before or before.endswith('\n') or before.endswith('$$') or before.endswith('}'): break
                        if not re.search(r'[.?!:)]$|\$$', before): break
                        props.append(dict(tbl=tbl, col=col, id=rid, qid=qid, doc=doc, pos=pos, ctx=s[max(0, pos - 50):pos] + ' ¶ ' + s[pos:pos + 50], head=h[:60]))
                        break
json.dump(props, open(paths.W + 'paras/proposals.json', 'w'), indent=1, ensure_ascii=False)
print(len(props), 'proposed breaks in', len({p['qid'] for p in props}), 'questions')
import collections; print(collections.Counter(p['doc'] for p in props))
