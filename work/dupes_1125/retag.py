"""Retag QID 6163 (2024 Cherrybrook Technology High School AP3 Q23, radial survey; areas by 1/2 ab sin C), 25 Nov.
Owner 25 Nov: "Also a trig question was also pulled into a measurement Y11 exam? how is that possible" / (to the plan) "Yes do that."
It was tagged only S11-060 (Year 11, areas of irregular blocks of land), so qYear was 11 and its home Year 11 Measurement.
Now: S2-12-070 (compass radial surveys) primary, S2-12-068 (A = 1/2 ab sin C) also, S11-060 kept as also (the land is still
dissected into triangles); skills Compass radial surveys + Area of a triangle (1/2 ab sin C) added. Year 12 by TAG_SPEC "Year of a part".
Idempotent.  QG_DB=... python3 work/dupes_1125/retag.py
"""
import json, os, sqlite3, sys
sys.path.insert(0, 'tools'); import paths
db = sqlite3.connect(paths.DBS)
Q, PARTS = 6163, (9861, 9862)
dp = {d['id']: d for d in json.load(open('site/data/dotpoints-standard.json'))}
NOTE = ('Owner 25 Nov: "Also a trig question was also pulled into a measurement Y11 exam? how is that possible": radial survey with '
        'A = 1/2 ab sin C is Year 12 Trigonometry (S2-12-070 main, S2-12-068), not Year 11 measurement only')
for pid in PARTS:
    assert db.execute('select question_id from parts where id=?', (pid,)).fetchone()[0] == Q
    db.execute("delete from tags where part_id=? and tag_source='owner' and prompt_version='tag-v2.3-1125'", (pid,))   # re-run
    db.execute("update tags set is_primary=0 where part_id=? and scheme='2024' and code='S11-060'", (pid,))
    for code, prim in (('S2-12-070', 1), ('S2-12-068', 0)):
        d = dp[code]
        db.execute("insert into tags(part_id, question_id, scheme, focus_area, dot_point, code, year_level, coverage, is_primary, confidence, tag_source, mapping_version, prompt_version) "
                   "values (?,?,?,?,?,?,?,?,?,?,?,?,?)", (pid, Q, '2024', d['fa'], d['text'], code, 12, 'examinable', prim, 1.0, 'owner', 'v2', 'tag-v2.3-1125'))
    have = {r[0] for r in db.execute("select dot_point from tags where part_id=? and scheme='skill'", (pid,))}
    for sk in ('Compass radial surveys', 'Area of a triangle (1/2 ab sin C)'):
        if sk not in have:
            db.execute("insert into tags(part_id, question_id, scheme, dot_point, coverage, is_primary, tag_source, prompt_version) values (?,?,?,?,?,?,?,?)",
                       (pid, Q, 'skill', sk, 'required', 1, 'owner', 'tag-v2.3-1125'))
db.execute("insert into tags(part_id, question_id, scheme, dot_point, code, is_primary, tag_source, prompt_version) values (?,?,?,?,?,?,?,?)",
           (PARTS[0], Q, 'note', NOTE, 'S2-12-070', 0, 'owner', 'tag-v2.3-1125'))
db.commit()
for r in db.execute("select part_id, scheme, code, dot_point, year_level, is_primary, tag_source from tags where question_id=? order by part_id, scheme, is_primary desc", (Q,)):
    print(r[0], r[1], r[2], (r[3] or '')[:50], r[4], r[5], r[6])
