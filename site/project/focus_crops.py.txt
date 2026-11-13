"""Focus crops for Review > Check (owner 12 Nov: "its taking too long looking at the question, just show side by side the
part I actually need to check"). For every Check question: a crop of the source page around each table, and a crop of the
question itself, found by matching the question's words/numbers against the PDF's word positions.
Writes site/data/focus/<doc>.json = {qid: {"q": [png...], "t": {table_id: png}}}."""
import json, re, sqlite3, base64, collections, pymupdf, os
P = '/home/claude/pilot/'
db = sqlite3.connect('/mnt/user-data/outputs/questions.db'); db.row_factory = sqlite3.Row
B = json.load(open(P + 'site/data/bank.json'))
STOP = set('that this with from have their what which when where then than there these those find show each will been into your give value values using use correct nearest answer'.split())
def toks(s):
    s = re.sub(r'\\(?:text|textit|textbf|mathrm)\{([^}]*)\}', r'\1', s or '')
    s = re.sub(r'\\[a-zA-Z]+', ' ', s)
    return [w.lower() for w in re.findall(r'[A-Za-z]{4,}|\d+(?:\.\d+)?', s)]
def block(hits, gap=40):
    """largest vertical cluster of matched words (gap < 40pt)"""
    if not hits: return None
    hits.sort(key=lambda w: w[1]); groups = [[hits[0]]]
    for w in hits[1:]:
        (groups[-1].append(w) if w[1] - max(x[3] for x in groups[-1]) < gap else groups.append([w]))
    g = max(groups, key=len)
    return (min(w[0] for w in g), min(w[1] for w in g), max(w[2] for w in g), max(w[3] for w in g), len(g))
def crop(page, r, full_width=True, pad=10):
    W = page.rect.width
    x0, x1 = (28, W - 28) if full_width else (max(0, r[0] - pad), min(W, r[2] + pad))
    rect = pymupdf.Rect(x0, max(0, r[1] - pad), x1, min(page.rect.height, r[3] + pad + 16))
    pm = page.get_pixmap(clip=rect, matrix=pymupdf.Matrix(2, 2))
    return 'data:image/png;base64,' + base64.b64encode(pm.tobytes('png')).decode()
out = collections.defaultdict(dict); n = 0; miss = []
for q in B['questions']:
    if q.get('dup_of') or (q.get('tri') or {}).get('tier') not in ('check', 'decide'): continue
    row = db.execute('select page_start,page_end from questions where id=?', (q['id'],)).fetchone()
    f = P + 'src/%s.pdf' % q['doc']
    if not row or not row[0] or not os.path.exists(f): miss.append(q['id']); continue
    pdf = pymupdf.open(f); pages = [pdf[i] for i in range(max(0, row[0] - 2), min(pdf.page_count, (row[1] or row[0]) + 1))]   # page numbers are not always 1-based: search one page either side
    if not pages: miss.append(q['id']); continue
    text = ' '.join([q['stem'] or ''] + [p['latex'] or '' for p in q['parts']])
    qt = set(t for t in toks(text) if t not in STOP)
    rec = {'q': [], 't': {}}
    cands = []
    for pg in pages:
        ws = [(w[0], w[1], w[2], w[3]) for w in pg.get_text('words') if w[4].lower().strip('.,:;()?') in qt]
        bb = block(ws, 150)
        if bb: cands.append((bb, pg))
    top = max([c[0][4] for c in cands] or [0])
    for bb, pg in cands:
        if bb[4] >= max(4, 0.5 * top): rec['q'].append(crop(pg, bb))
    for tid in []:   # table crops dropped: the question crop already shows the table in place
        t = B['tables'].get(tid)
        if not t: continue
        cells = set(x for r in t['rows'] for c in r for x in toks(str(c)))
        best = None
        for pg in pages:
            ws = [(w[0], w[1], w[2], w[3]) for w in pg.get_text('words') if w[4].lower().strip('.,:;()$') in cells]
            bb = block(ws)
            if bb and (not best or bb[4] > best[0][4]): best = (bb, pg)
        if best and best[0][4] >= 3:
            bb, pg = best; r = pymupdf.Rect(bb[:4])
            # grow to the table's ruled lines (header rows often hold only symbols the text match misses)
            for _ in range(3):
                near = pymupdf.Rect(r.x0 - 30, r.y0 - 45, r.x1 + 30, r.y1 + 30)
                for d in pg.get_drawings():
                    dr = d['rect']
                    if dr.intersects(near) and dr.width < pg.rect.width * 0.95 and dr.height < 400: r |= dr
            rec['t'][tid] = crop(pg, (r.x0, r.y0, r.x1, r.y1), full_width=False, pad=8)
    if rec['q'] or rec['t']: out[str(q['doc'])][str(q['id'])] = rec; n += 1
    else: miss.append(q['id'])
for doc, m in out.items(): json.dump(m, open(P + 'site/data/focus/%s.json' % doc, 'w'))
print('questions with crops', n, 'missing', len(miss), miss[:20])
print('MB', round(sum(os.path.getsize(P + 'site/data/focus/' + f) for f in os.listdir(P + 'site/data/focus')) / 1e6, 1))
