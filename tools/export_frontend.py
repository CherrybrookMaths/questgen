"""Export a self-contained seed bundle for a frontend developer: /home/claude/pilot/export/hsc-advanced-seed/
Usage: python3 export_frontend.py <reviews_export_dir>"""
import json, os, glob, shutil, sqlite3, sys, re, base64, datetime
P = '/home/claude/pilot/'
OUT = P + 'export/hsc-advanced-seed/'
shutil.rmtree(OUT, ignore_errors=True)
for d in ('data', 'figures/crop', 'figures/crop_300dpi', 'figures/redraw', 'figures/redraw_pdf', 'figures/tikz', 'reference', 'pages', 'database', 'tools', 'samples'):
    os.makedirs(OUT + d, exist_ok=True)

B = json.load(open(P + 'site/data/bank.json'))
DOTS = json.load(open(P + 'site/data/dotpoints.json'))
db = sqlite3.connect('/mnt/user-data/outputs/questions.db'); db.row_factory = sqlite3.Row

# owner's review decisions (from the review page database)
rev = {}
MASKS = json.load(open(P + 'tools/figure_letter_masks.json'))
for f in glob.glob(sys.argv[1] + '/*.json'):
    o = json.load(open(f)); d = o.get('data', o); rev[d['question_id']] = d

docs = {}
for r in db.execute('select * from documents where id in (select distinct document_id from questions)'):
    label = B['docs'][str(r['id'])]['label'].replace('NESA NESA', 'NESA')
    docs[r['id']] = dict(id=r['id'], label=label, school_formal=r['school_formal'], task_code=r['task_code'], year=r['year'], school=r['school'] or 'NESA',
                         paper_type=r['task_type'], course=r['course'], source=r['parse_path'])

def fig_keys(q):
    s = ' '.join([q['stem'] or ''] + [p['latex'] for p in q['parts']] + [x['latex'] for x in q['solutions']] + [o['latex'] for o in q['options']])
    inl = re.findall(r'\\exfigure\{([\w.-]+)\}', s)
    lst = [f['src'].split('/')[-1][:-4] for f in q['figures']] + [o['fig'] for o in q['options'] if o.get('fig')]
    return list(dict.fromkeys(lst + inl))

questions, figures, used_tables = [], {}, set()
# owner 11 Nov: hidden duplicate copies (the same paper filed twice) are not exported; the kept copy lists the other papers in also_in
ALSO = {}
for q in B['questions']:
    if q.get('dup_of'): ALSO.setdefault(q['dup_of'], []).append(q['doc'])
DUPS = {q['id']: q['dup_of'] for q in B['questions'] if q.get('dup_of')}
for q in B['questions']:
    if q.get('dup_of'): continue
    r = rev.get(q['id'], {})
    fdec = r.get('fig', {}); sdec = r.get('sol', {}); tedit = r.get('tag_edits', {})
    parts = []
    for p in q['parts']:
        ed = tedit.get(str(p['id'])) or tedit.get(p['id'])
        if ed:
            tags = [{'dot_point': None, 'coverage': ed['cov'], 'primary': True, 'confidence': 1.0, 'source': 'human'}] if ed.get('cov') else \
                   [{'dot_point': ed['id'], 'coverage': 'examinable' if ed['id'].startswith('Y12') else 'year_11', 'primary': True, 'confidence': 1.0, 'source': 'human'}]
        else:
            tags = [{'dot_point': t.get('id'), 'coverage': {'moved_to_year_11': 'year_11'}.get(t.get('cov'), t.get('cov')),
                     'primary': bool(t.get('primary')), 'confidence': t.get('conf'), 'source': 'model'} for t in p.get('t24', [])]
        parts.append(dict(id=p['id'], label=p['label'], parent_id=p['parent'], marks=p['marks'], latex=p['latex'],
                          is_leaf=not any(c['parent'] == p['id'] for c in q['parts']),
                          syllabus_2024=tags, code_2017=(p.get('c17') or {}).get('code'), keywords=p.get('free') or []))
    sols = []
    for s in q['solutions']:
        gen = s['source'] == 'generated'
        st = sdec.get(str(s['id'])) or sdec.get(s['id'])
        sols.append(dict(id=s['id'], part_id=s['part_id'], source='model_generated' if gen else 'marking_guidelines',
                         approved=(st == 'approved') if gen else True, rejected=(st == 'rejected'),
                         latex=s['latex'], criteria=[{'marks': c[0], 'criterion': c[1]} for c in s['criteria']],
                         meta=s['meta']))
    keys = fig_keys(q)
    for k in keys:
        f = B['figs'].get(k, {})
        dec = fdec.get(k)
        red = None
        if f.get('status') in ('ok', 'approx'):
            svg = P + f'tikz/svg/{k}.svg'
            if os.path.getsize(svg) > 3_000_000:
                shutil.copy(P + f'tikz/hi/{k}.png', OUT + f'figures/redraw/{k}.png'); red = f'figures/redraw/{k}.png'
            else:
                shutil.copy(svg, OUT + f'figures/redraw/{k}.svg'); red = f'figures/redraw/{k}.svg'
            shutil.copy(P + f'tikz/tex/{k}.tex', OUT + f'figures/tikz/{k}.tex')
        sys.path.insert(0, P + 'tools'); from transparent import to_alpha
        to_alpha(P + f'figures/{k}.png', OUT + f'figures/crop/{k}.png')   # transparent background (works on any page colour)
        crop_print = f'figures/crop/{k}.png'
        row = db.execute('select page, bbox from figures where png_path=?', (f'figures/{k}.png',)).fetchone()
        src = P + f'src/{q["doc"]}.pdf'
        if row and row['bbox'] and json.loads(row['bbox']) and os.path.exists(src):   # Claude-drawn solution diagrams have no crop on the page
            import pymupdf
            pymupdf.open(src)[row['page']].get_pixmap(dpi=300, clip=pymupdf.Rect(*json.loads(row['bbox']))).save(OUT + f'figures/crop_300dpi/{k}.png')
            crop_print = f'figures/crop_300dpi/{k}.png'
            mk = MASKS.get(k)
            if mk:   # option letters are added by the layout (MCQ_SPEC.md): blank the printed letter, as in the 200 dpi crop
                from PIL import Image as _I, ImageDraw as _D
                im = _I.open(OUT + crop_print).convert('RGB'); _D.Draw(im).rectangle([v * 1.5 for v in mk], fill='white'); im.save(OUT + crop_print)
            to_alpha(OUT + crop_print, OUT + crop_print)
        rpdf = None
        if red and os.path.exists(P + f'tikz/build/{k}.pdf'):
            shutil.copy(P + f'tikz/build/{k}.pdf', OUT + f'figures/redraw_pdf/{k}.pdf'); rpdf = f'figures/redraw_pdf/{k}.pdf'
        from PIL import Image
        w, h = Image.open(P + f'figures/{k}.png').size
        figures[k] = dict(key=k, question_id=q['id'], crop=f'figures/crop/{k}.png', crop_dpi=200, crop_print=crop_print, redraw_pdf=rpdf,
                          print_width_mm=round(w / 200 * 25.4, 1), print_height_mm=round(h / 200 * 25.4, 1),
                          redraw=red, redraw_tikz=f'figures/tikz/{k}.tex' if red else None,
                          redraw_status={'approved': 'approved', 'rejected': 'rejected', 'changes': 'changes_requested'}.get(dec, 'pending_review') if red else None,
                          use=('redraw' if dec == 'approved' and red else 'crop'),
                          estimated_shape=f.get('status') == 'approx', kind=f.get('cls'),
                          overlap_with_crop=f.get('ov'))
    s_all = ' '.join([q['stem'] or ''] + [p['latex'] for p in q['parts']] + [x['latex'] for x in q['solutions']] + [o['latex'] for o in q['options']])
    used_tables.update(re.findall(r'\\extable\{(\w+)\}', s_all))
    questions.append(dict(
        id=q['id'], qid='QID %04d' % q['id'], source='%s Q%s' % (docs[q['doc']]['label'], q['number']), paper_id=q['doc'], number=q['number'], section=q['section'],
        type='multiple_choice' if q['type'] == 'mcq' else 'short_answer', marks=q['marks'],   # owner: "Written questions are known as short answer"
        stem=q['stem'], parts=parts,
        options_layout=q.get('layout'),
        options=[dict(label=o['label'], latex=o['latex'], correct=bool(o['is_correct']), key_source=o['key_source'], figure=o.get('fig')) for o in q['options']],
        options_table=q.get('opt_table'), solutions=sols, figures=keys,
        old_syllabus=q.get('old'), standard_course=q.get('std'),
        also_in=sorted(set(ALSO.get(q['id'], []))), related=[dict(question_id=DUPS.get(x['q'], x['q']), similarity=x['sim'], relation=x['rel']) for x in q['related'] if DUPS.get(x['q'], x['q']) != q['id']],
        source_pages=[int(p.split('_')[-1].split('.')[0]) + 1 for p in q['pages']],
        review=dict(status=r.get('status') or 'unreviewed', parse_flagged='review' in q['queues'],
                    from_scan='scan' in q['queues'], self_audited='audited' in q['queues'], note=q['review_note'])))

tables = {k: dict(id=k, caption=v['cap'], header_rows=v['hr'], label_column=bool(v['lc']), rows=v['rows'],
                  colspans=[dict(row=x[0], col=x[1], span=x[2] if len(x) > 2 else 1, rowspan=x[3] if len(x) > 3 else 1) for x in v['spans']]) for k, v in B['tables'].items() if k in used_tables}
syl = [dict(id=d['id'], year=d['yl'], focus_area=d['fa'], subheading=d['sub'] or d['fa'], text=d['text'], latex=d['tex']) for d in DOTS]

J = lambda name, obj: json.dump(obj, open(OUT + 'data/' + name, 'w'), ensure_ascii=False, indent=1)
J('questions.json', questions); J('papers.json', list(docs.values())); J('figures.json', figures)
J('tables.json', tables); J('syllabus_2024.json', syl); J('codes_2017.json', B['codes17'])
shutil.copy(P + 'tikz/examstyle.tex', OUT + 'figures/tikz/examstyle.tex')
shutil.copy(P + 'site/review.html', OUT + 'reference/review_page.html')
shutil.copy(P + 'DIAGRAM_SPEC.md', OUT + 'reference/DIAGRAM_SPEC.md')
shutil.copy(P + 'DIAGRAM_FEEDBACK_LOG.md', OUT + 'reference/DIAGRAM_FEEDBACK_LOG.md')
stats = dict(exported=datetime.date.today().isoformat(), questions=len(questions),
             duplicate_copies_dropped=len(DUPS), papers=len(docs),
             parts=sum(len(q['parts']) for q in questions), figures=len(figures),
             figures_redraw_approved=sum(1 for f in figures.values() if f['use'] == 'redraw'),
             solutions=sum(len(q['solutions']) for q in questions),
             generated_solutions=sum(1 for q in questions for s in q['solutions'] if s['source'] == 'model_generated'),
             generated_approved=sum(1 for q in questions for s in q['solutions'] if s['source'] == 'model_generated' and s['approved']),
             tables=len(tables), dot_points=len(syl))
for f in ('README.md', 'types.ts'): shutil.copy(P + 'tools/seed_static/' + f, OUT + f)
# full page images (for a "view original page" button), database dump
for f in glob.glob(P + 'site/data/img/*.json'):
    for path, uri in json.load(open(f)).items():
        if path.startswith('pages/'):
            open(OUT + path, 'wb').write(base64.b64decode(uri.split(',', 1)[1]))
shutil.copy('/mnt/user-data/outputs/questions.db', OUT + 'database/questions.db')
_e = sqlite3.connect(OUT + 'database/questions.db')   # the exported database leaves out the duplicate copies too
for _q in DUPS:
    _p = [r[0] for r in _e.execute('select id from parts where question_id=?', (_q,))]
    for _t, _c in (('solutions', 'part_id'), ('tags', 'part_id')):
        _e.executemany(f'delete from {_t} where {_c}=?', [(x,) for x in _p])
    for _t in ('solutions', 'tags', 'mcq_options', 'figures', 'parts'):
        _e.execute(f'delete from {_t} where question_id=?', (_q,))
    _e.execute("delete from data_tables where (owner_table='questions' and owner_id=?)", (_q,))
    _e.executemany("delete from data_tables where owner_table='parts' and owner_id=?", [(x,) for x in _p])
    _e.execute('delete from related_questions where question_id=? or related_id=?', (_q, _q))
    _e.execute('delete from questions where id=?', (_q,))
_e.commit(); _e.execute('vacuum'); _e.close()
open(OUT + 'database/questions.sql', 'w').write('\n'.join(sqlite3.connect(OUT + 'database/questions.db').iterdump()))
shutil.copy(P + 'site/project/schema.sql', OUT + 'database/schema.sql') if os.path.exists(P + 'site/project/schema.sql') else None
shutil.copy(P + 'tools/seed_static/tools/make_worksheet.py', OUT + 'tools/make_worksheet.py')
shutil.copy(P + 'tools/seed_static/tools/make_revision.py', OUT + 'tools/make_revision.py')
shutil.copy(P + 'tools/export_frontend.py', OUT + 'tools/export_seed.py')
J('stats.json', stats); print(json.dumps(stats))
