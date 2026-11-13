"""Apply review decisions exported from the review artifact into questions.db.
Usage: ArtifactData list reviews with out_dir=/home/claude/pilot/reviews_export, then: python3 reconcile.py /home/claude/pilot/reviews_export/reviews"""
import json,glob,sqlite3,sys,datetime
db=sqlite3.connect('/mnt/user-data/outputs/questions.db')
dps={d['id']:d for d in json.load(open('/home/claude/pilot/syllabus_dotpoints.json'))}
n=t=fa=sa=0
if 'redraw_request' not in [c[1] for c in db.execute('pragma table_info(figures)')]: db.execute('alter table figures add column redraw_request text')
figid={}
import os
for i,png in db.execute('select id,png_path from figures'): figid[os.path.basename(png)[:-4]]=i
for f in glob.glob(sys.argv[1]+'/*.json'):
    r=json.load(open(f)); r=r.get('data',r); qid=r['question_id']
    if r.get('status'): db.execute('update questions set review_status=?,review_note=coalesce(?,review_note) where id=?',(r['status'],r.get('note'),qid)); n+=1
    for pid,e in (r.get('tag_edits') or {}).items():
        db.execute("delete from tags where part_id=? and scheme='2024'",(int(pid),))
        if e.get('cov'):
            db.execute("insert into tags(part_id,scheme,coverage,is_primary,tag_source,mapping_version) values (?,?,?,?,?,?)",(int(pid),'2024',e['cov'],1,'human','v1'))
        else:
            d=dps[e['id']]
            db.execute("insert into tags(part_id,scheme,focus_area,dot_point,code,year_level,coverage,is_primary,confidence,tag_source,mapping_version) values (?,?,?,?,?,?,?,?,?,?,?)",
              (int(pid),'2024',d['focus_area'],d['text'],d['id'],d['year_level'],'examinable' if d['year_level']==12 else 'moved_to_year_11',1,1.0,'human','v1'))
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
