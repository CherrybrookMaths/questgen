import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import json,glob,sqlite3,re,collections
db=sqlite3.connect(paths.DBS)
dps={d['id']:d for d in json.load(open(paths.P + 'site/project/syllabus_dotpoints.json'))}
db.execute("delete from tags")
AREA_PAT=re.compile(r'area (enclosed )?between|between the (two )?curves|bounded by the (two )?curves|region bounded by .* and the (curve|line) y',re.I)
stats=collections.Counter(); verbatim_fail=0; flags=[]
parts={json.loads(l)['part_id']:json.loads(l) for l in open('tag/parts.jsonl')}
for f in glob.glob('tag/out_*.json'):
    for r in json.load(open(f))['results']:
        pid=r['part_id']; st=r['status']; txt=parts[pid]['context']+' '+parts[pid]['text']
        # hand-checked list: area enclosed between two curves (no 2024 dot point under a strict reading)
        two_curve = pid in {350,223,303,392,463,96,44}
        if two_curve:
            st='removed'; r['reason']='area between two curves: no 2024 dot point (strict reading of Areas and the definite integral) - DECISION NEEDED'
            flags.append(pid)
        if st=='tagged':
            for t in r['tags']:
                dp=dps.get(t['dot_point_id'])
                ok = dp is not None and dp['text']==t['dot_point_text']
                if not ok: verbatim_fail+=1; continue
                cov='examinable' if dp['year_level']==12 else 'moved_to_year_11'
                db.execute("insert into tags(part_id,scheme,focus_area,dot_point,code,year_level,coverage,is_primary,confidence,tag_source,mapping_version,prompt_version) values (?,?,?,?,?,?,?,?,?,?,?,?)",
                   (pid,'2024',dp['focus_area'],dp['text'],dp['id'],dp['year_level'],cov,int(bool(t.get('is_primary'))),t.get('confidence'),'model','v1','tag-v1'))
            prim=[t for t in r['tags'] if t.get('is_primary')]
            stats[('examinable' if prim and dps[prim[0]['dot_point_id']]['year_level']==12 else 'moved_to_year_11')]+=1
        else:
            cov='removed' if st=='removed' else 'no_match'
            db.execute("insert into tags(part_id,scheme,focus_area,dot_point,code,year_level,coverage,is_primary,confidence,tag_source,mapping_version,prompt_version) values (?,?,?,?,?,?,?,?,?,?,?,?)",
               (pid,'2024',None,None,None,None,cov,1,None,'model','v1','tag-v1'))
            stats[cov]+=1
        db.execute("insert into tags(part_id,scheme,code,confidence,tag_source,mapping_version,prompt_version,coverage) values (?,?,?,?,?,?,?,?)",
           (pid,'2017',r.get('code_2017'),r.get('code_2017_confidence'),'model','v1','tag-v1',None))
        for ft in r.get('free_tags') or []:
            db.execute("insert into tags(part_id,scheme,dot_point,tag_source,prompt_version) values (?,?,?,?,?)",(pid,'free',ft,'model','tag-v1'))
        if r.get('reason') and st!='tagged':
            db.execute("update parts set needs_review=1 where id=?",(pid,)) if st=='no_match' else None
            db.execute("insert into tags(part_id,scheme,dot_point,tag_source,prompt_version) values (?,?,?,?,?)",(pid,'note',r['reason'],'model','tag-v1'))
db.execute("update documents set status='tagged' where status='parsed' and id in (select distinct q.document_id from questions q)")
db.commit()
print(dict(stats),'verbatim failures:',verbatim_fail,'two-curve flags:',len(flags))
# removed by 2017 code
print(list(db.execute("select t2.code,count(*) from tags t join tags t2 on t2.part_id=t.part_id and t2.scheme='2017' where t.scheme='2024' and t.coverage='removed' group by 1")))
print('parts without 2024 tag:',db.execute("select count(*) from parts p where not exists(select 1 from parts c where c.parent_part_id=p.id) and not exists(select 1 from tags t where t.part_id=p.id and t.scheme='2024')").fetchone())
