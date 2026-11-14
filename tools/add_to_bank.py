"""Add newly imported papers to the review page data (import batches, 11 Nov 2026).

build_bank.py refreshes text, solutions, tables and redraws from the database but takes each question's skeleton
(parts with tags, pages, figures, queues, related) from site/data/bank_v1.json. This script writes that skeleton for
the named papers (replacing any earlier entry for them) and packs their page images and figure crops into
site/data/img/<doc>.json. Idempotent: re-run after tagging or dedup to refresh tags, queues and related.

Usage: python3 add_to_bank.py <doc_id> [<doc_id> ...]
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import sys, json, sqlite3, base64, io, os
import pymupdf
from PIL import Image
P = paths.P
db = sqlite3.connect(paths.DBS); db.row_factory = sqlite3.Row
IDS = [int(a) for a in sys.argv[1:] if a.isdigit()]
if not IDS: sys.exit('name the document ids')
B = json.load(open(paths.S + 'site/data/bank_v1.json'))
B['questions'] = [q for q in B['questions'] if q['doc'] not in IDS]
dps = {d['id']: d for d in json.load(open(P + 'site/project/syllabus_dotpoints.json'))}

def jpg(page):
    pix = page.get_pixmap(dpi=85); im = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
    b = io.BytesIO(); im.save(b, 'JPEG', quality=60, optimize=True)
    return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()

def png(path):
    # transparent black ink like the earlier crops (tools/transparent.py): the page inverts figures in dark mode, so an
    # opaque white crop showed as a black box (owner 12 Nov screenshot, 2024 HSC Q1)
    import numpy as np
    im = Image.open(path).convert('L')
    if im.width > 900: im = im.resize((900, round(im.height * 900 / im.width)))
    g = np.asarray(im, dtype=np.float32); a = np.clip((255 - g) * 1.08, 0, 255); a[a < 10] = 0
    out = np.zeros(g.shape + (2,), dtype=np.uint8); out[..., 1] = a.astype(np.uint8)
    b = io.BytesIO(); Image.fromarray(out, 'LA').save(b, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()

dup = {}
for a, b2, sim, rel in db.execute("select question_id, related_id, similarity, relation from related_questions"):
    dup.setdefault(a, []).append((b2, sim, rel)); dup.setdefault(b2, []).append((a, sim, rel))

for doc in IDS:
    d = db.execute('select * from documents where id=?', (doc,)).fetchone()
    B['docs'][str(doc)] = dict(id=doc, label=d['display_label'] or '', path=d['source_path'], parse_path=d['parse_path'], task_type=d['task_type'])
    pdf = pymupdf.open(str(paths.SRC / f'{doc}.pdf')); img = {}
    for q in db.execute('select * from questions where document_id=? order by id', (doc,)).fetchall():
        parts = []
        for p in db.execute('select * from parts where question_id=? order by ordinal, id', (q['id'],)).fetchall():
            t = db.execute('select * from tags where part_id=?', (p['id'],)).fetchall()
            t24 = [dict(id=x['code'], text=x['dot_point'], fa=x['focus_area'], yl=x['year_level'], cov=x['coverage'], primary=x['is_primary'], conf=x['confidence'])
                   for x in t if x['scheme'] == '2024']
            c17 = next((dict(code=x['code'], conf=x['confidence']) for x in t if x['scheme'] == '2017'), None)
            parts.append(dict(id=p['id'], label=p['label'], parent=p['parent_part_id'], latex=p['latex'], marks=p['marks'], needs_review=p['needs_review'],
                              t24=t24, c17=c17, free=[x['dot_point'] for x in t if x['scheme'] == 'free'],
                              note=next((x['dot_point'] for x in t if x['scheme'] == 'note'), None)))
        figs = [dict(src=f['png_path'], part=f['part_id'], cap=f['caption']) for f in db.execute('select * from figures where question_id=? order by id', (q['id'],))]
        ps, pe = q['page_start'], q['page_end'] if q['page_end'] is not None else q['page_start']
        pages = [f'pages/{doc}_{i}.jpg' for i in range(ps, pe + 1)] if ps is not None else []
        for k in pages:
            i = int(k.split('_')[-1][:-4])
            if k not in img and i < pdf.page_count: img[k] = jpg(pdf[i])
        for f in figs:
            if os.path.exists(P + f['src']): img[f['src']] = png(P + f['src'])
        rel = dup.get(q['id'], [])
        queues = (['review'] if q['needs_review'] else []) + (['scan'] if d['parse_path'] == 'scan' else []) + (['duplicate'] if any(r == 'duplicate' for _, _s, r in rel) else [])
        B['questions'].append(dict(id=q['id'], doc=doc, number=q['number'], section=q['section'], type=q['question_type'], marks=q['marks_total'], stem=q['stem_latex'],
                                   review_note=q['review_note'], pages=pages, parts=parts, options=[], figures=figs, solutions=[],
                                   related=[dict(q=r, sim=sm, rel=rel_) for r, sm, rel_ in rel], queues=queues, opt_table=None, layout=q['options_layout']))
    import glob as _g   # every crop of this paper (solution sketches are referenced from solution text)
    for f in _g.glob(P + f'figures/{doc}_*.png'):
        k = 'figures/' + os.path.basename(f)
        if k not in img: img[k] = png(f)
    json.dump(img, open(P + f'site/data/img/{doc}.json', 'w'))
    print(doc, B['docs'][str(doc)]['label'], sum(1 for q in B['questions'] if q['doc'] == doc), 'questions,', len(img), 'images,', round(os.path.getsize(P + f'site/data/img/{doc}.json') / 1e6, 2), 'MB')
json.dump(B, open(paths.S + 'site/data/bank_v1.json', 'w'))
