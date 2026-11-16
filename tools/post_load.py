"""After load.py for an import batch: register solution sketches as figures rows, parse marking criteria for the
batch's solutions only, then house style, tables, dedup (batch pairs only) and naming check.
Usage: python3 post_load.py <doc_id> [...]"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import json, sqlite3, re, sys, subprocess
P = paths.P
IDS = [int(a) for a in sys.argv[1:]]
db = sqlite3.connect(paths.DBS)
n = 0
for d in IDS:
    j = json.load(open(paths.S + f'out/{d}.json'))
    for sf in j.get('solution_figures', []):
        png = f"figures/{sf['id']}.png"
        if db.execute('select 1 from figures where png_path=?', (png,)).fetchone(): continue
        m = re.match(r'\d+_q(.+)_s\d+$', sf['id']); num = str(sf.get('question') or (m.group(1) if m else ''))
        q = db.execute('select id from questions where document_id=? and number=?', (d, num)).fetchone()
        if not q: print('no question for', sf['id']); continue
        pid = None
        if sf.get('part'):
            r = db.execute('select id from parts where question_id=? and label=?', (q[0], str(sf['part']).split('.')[-1])).fetchone(); pid = r[0] if r else None
        db.execute('insert into figures(question_id,part_id,page,bbox,png_path,caption) values (?,?,?,?,?,?)',
                   (q[0], pid, sf.get('page'), json.dumps(sf.get('bbox')), png, 'solution sketch' + (': ' + sf['caption'] if sf.get('caption') else ''))); n += 1
# marking criteria for this batch's solutions only (ui_v2_data.parse_criteria; never re-run ui_v2_data.py itself)
src = open(P + 'tools/ui_v2_data.py').read(); exec(src[src.index('def parse_criteria'):src.index('n = 0')])
IN = '(%s)' % ','.join(map(str, IDS)); c = 0
for sid, mb, mj in db.execute(f"select s.id,s.marks_breakdown,s.meta_json from solutions s left join parts p on p.id=s.part_id where coalesce(s.question_id,p.question_id) in (select id from questions where document_id in {IN}) and s.criteria_json is null").fetchall():
    crit, meta = parse_criteria(mb); meta = {**meta, **json.loads(mj or '{}')}
    db.execute('update solutions set criteria_json=?, meta_json=? where id=?', (json.dumps(crit, ensure_ascii=False), json.dumps(meta, ensure_ascii=False), sid)); c += 1
db.commit(); print('solution figures', n, 'criteria parsed', c)
for cmd in (['crop_check.py'] + [str(i) for i in IDS] + ['--apply'], ['house_style.py'], ['tables.py'] + [str(i) for i in IDS],   # 17 Nov: the batch's papers only (IMPORT_PLAYBOOK lessons)
                 ['dedup.py'] + [str(i) for i in IDS], ['exam_name.py']):
    r = subprocess.run(['python3', P + 'tools/' + cmd[0]] + cmd[1:], capture_output=True, text=True); print(cmd[0], (r.stdout.strip().splitlines() or [''])[-1], r.stderr[-300:])
