"""Apply review decisions exported from the review artifact into questions.db.
Usage: ArtifactData list reviews with out_dir=<repo>/reviews_export, then: python3 tools/reconcile.py <repo>/reviews_export/reviews"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import json,glob,sqlite3,sys,datetime
db=sqlite3.connect(paths.DBS)
import course_dots   # 23 Nov (Standard): every course's dot points in one lookup (ids never clash)
dps=course_dots.dotpoints()
n=t=fa=sa=0
if 'redraw_request' not in [c[1] for c in db.execute('pragma table_info(figures)')]: db.execute('alter table figures add column redraw_request text')
figid={}
import os
for i,png in db.execute('select id,png_path from figures'): figid[os.path.basename(png)[:-4]]=i
# owner 14 Nov (Fix 2, "Ok we should run Fix 1 and 2"): reviews/k_<key> holds the decision for every copy with that key
# (tools/qkeys.py); a k_ doc wins over the old q<id> docs of the same key. Paper docs (paper_<doc>, p_<key>) carry no question.
keyed={k:[q for (q,) in db.execute('select question_id from question_keys where key=?',(k,))] for (k,) in db.execute('select distinct key from question_keys')} if db.execute("select 1 from sqlite_master where name='question_keys'").fetchone() else {}
_files=sorted(glob.glob(sys.argv[1]+'/*.json'),key=lambda f:os.path.basename(f).startswith('k_'))   # k_ docs last, so they win
for f in _files:
    r=json.load(open(f)); r=r.get('data',r); name=os.path.basename(f)[:-5]
    if name.startswith(('paper_','p_')) or not r.get('question_id'): continue
    qids=keyed.get(r.get('key'),[r['question_id']]) if name.startswith('k_') else [r['question_id']]
    for qid in qids:
        if r.get('status'): db.execute('update questions set review_status=?,review_note=coalesce(?,review_note) where id=?',(r['status'],r.get('note'),qid)); n+=1
    for pid,e in (r.get('tag_edits') or {}).items():
        db.execute("delete from tags where part_id=? and scheme='2024'",(int(pid),))
        if e.get('cov'):
            db.execute("insert into tags(part_id,scheme,coverage,is_primary,tag_source,mapping_version) values (?,?,?,?,?,?)",(int(pid),'2024',e['cov'],1,'human','v1'))
        else:
            d=dps[e['id']]
            db.execute("insert into tags(part_id,scheme,focus_area,dot_point,code,year_level,coverage,is_primary,confidence,tag_source,mapping_version) values (?,?,?,?,?,?,?,?,?,?,?)",
              (int(pid),'2024',d['focus_area'],d['text'],d['id'],d['year_level'],course_dots.coverage(d['id']),1,1.0,'human','v1'))
        t+=1
    # diagram redraw decisions (approved -> use TikZ redraw; rejected -> keep the crop)
    for k,v in (r.get('fig') or {}).items():
        st={'approved':'approved','changes':'changes_requested'}.get(v,'rejected')
        note=(r.get('fig_notes') or {}).get(k)
        if k in figid: db.execute('update figures set redraw_status=?,redraw_request=? where id=?',(st,note if st=='changes_requested' else None,figid[k]))
        fa+=1  # solution-document figures have no figures row: their requests are read straight from the export
    # generated-solution decisions
    for sid,v in (r.get('sol') or {}).items():
        db.execute('update solutions set verified_by=?,verified_at=? where id=?',('human:'+v,r.get('at'),int(sid))); sa+=1
db.commit(); print(f'{n} decisions, {t} tag corrections, {fa} diagram decisions, {sa} solution decisions applied')
