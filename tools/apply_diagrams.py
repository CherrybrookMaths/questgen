"""Merge TikZ redraw results of an import batch into the bank (import batches, 11 Nov 2026).
Usage: python3 apply_diagrams.py tikz/result_b1_*.json [work/b1/gen2026_out_*.json]
- appends/replaces entries in tikz/all_results.json and site/project/diagram_results.json
- stores the .tex source in site/project/tikz_sources.json
- updates the figures row (adds one for a solution figure that has none); tables -> data_tables 'Tf<figure id>'
Same field rules as ui_v2_data.py section 3, but only for the given ids (never re-parses other data)."""
import json, sys, os, sqlite3, re
P = '/home/claude/pilot/'
db = sqlite3.connect('/mnt/user-data/outputs/questions.db')
allr = json.load(open(P + 'tikz/all_results.json')); byid = {r['id']: i for i, r in enumerate(allr)}
dres = json.load(open(P + 'site/project/diagram_results.json')); dby = {r['id']: i for i, r in enumerate(dres)}
srcs = json.load(open(P + 'site/project/tikz_sources.json'))
n = nt = miss = 0
recrop = {x['id'] for x in json.load(open(P + 'work/crop_fixes.json'))} if os.path.exists(P + 'work/crop_fixes.json') else set()
for f in sys.argv[1:]:
    d = json.load(open(f))
    for r in d.get('results') or d.get('figures') or []:
        k = r['id']
        if k in recrop and 'fix' not in os.path.basename(f): continue   # re-cropped since: only the redraw made from the new crop counts
        rec = dict(id=k, **{x: r.get(x) for x in ('class', 'status', 'rounds', 'notes', 'table')}, version=1, overlay=r.get('overlay'))
        if k in byid: allr[byid[k]] = rec
        else: byid[k] = len(allr); allr.append(rec)
        if k in dby: dres[dby[k]] = rec
        else: dby[k] = len(dres); dres.append(rec)
        tex = P + f'tikz/tex/{k}.tex'
        if os.path.exists(tex): srcs[k] = open(tex).read()
        png = f'figures/{k}.png'
        row = db.execute('select id from figures where png_path=?', (png,)).fetchone()
        if not row:
            m = re.match(r'(\d+)_q([^_]+)_s\d+$', k)
            q = db.execute('select id from questions where document_id=? and number=?', (int(m.group(1)), m.group(2))).fetchone() if m else None
            if not q: print('no question for', k); miss += 1; continue
            row = (db.execute('insert into figures(question_id,page,bbox,png_path,caption) values (?,?,?,?,?)', (q[0], 0, '[]', png, 'solution diagram (drawn by Claude)')).lastrowid,)
        fid = row[0]; tid = None
        if r['status'] == 'table' and r.get('table'):
            tb = r['table']; tid = 'Tf' + str(fid); nt += 1
            db.execute('insert or replace into data_tables(id, owner_table, owner_id, caption, header_rows, label_col, rows_json, source_latex, spans_json) values (?,?,?,?,?,?,?,?,?)',
                       (tid, 'figures', fid, tb.get('caption'), tb.get('header_rows', 0), tb.get('label_col', 0), json.dumps(tb['rows'], ensure_ascii=False), None, json.dumps(tb.get('spans') or [])))
        db.execute('update figures set tikz_path=?, redraw_status=?, redraw_class=?, redraw_notes=?, redraw_table_id=? where id=?',
                   (f'tikz/tex/{k}.tex' if r['status'] in ('ok', 'approx') else None, r['status'], r.get('class'), r.get('notes'), tid, fid))
        n += 1
db.commit()
json.dump(allr, open(P + 'tikz/all_results.json', 'w'), indent=1)
json.dump(dres, open(P + 'site/project/diagram_results.json', 'w'), indent=1)
json.dump(srcs, open(P + 'site/project/tikz_sources.json', 'w'))
print('applied', n, 'tables', nt, 'unmatched', miss)
