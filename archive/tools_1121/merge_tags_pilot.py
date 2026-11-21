# copy of merge_tags_v2.py for the 554 pilot parts (owner 12 Nov: "run the pilot retag"); writes work/tag_pilot/disagreements.json
"""Merge the tag-v2.2 re-tag (tagger A = sonnet, checker B = stronger model) into questions.db (owner 12 Nov).
Agreed or small differences -> B's answer. Real disagreements (topic differs, gate differs by 2+ skills, or removed vs not)
-> B's answer provisionally + both answers in work/tag_full/disagreements.json for the owner's Tags review step.
Writes, per part: scheme '2024' rows (is_primary 1 = primary, 0 = also assessed; coverage 'removed' when no dot point),
scheme 'skill' rows (dot_point = skill name, coverage 'required' | 'can_use'), scheme 'note' (removed_reason),
replacing the old '2024', 'free', 'note' rows. 2017 rows are kept."""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import json, sqlite3, glob
P = paths.P; W = P + 'work/tag_pilot/'
db = sqlite3.connect(paths.DBS)
DP = {x['id']: x for x in json.load(open(paths.S + 'work/skills/dotpoints.json'))}
PRE = {x['skill']: x['requires'] for x in json.load(open(paths.S + 'work/skills/skill_prereqs.json'))}
def clos(sk):
    out = set(sk); st = list(sk)
    while st:
        for r in PRE.get(st.pop(), []):
            if r not in out: out.add(r); st.append(r)
    return out
A, B = {}, {}
for g in range(1, 5):
    for x in json.load(open(W + f'A_{g}.json')): A[x['part_id']] = x
    for x in json.load(open(W + f'B_{g}.json')): B[x['part_id']] = x
prim = lambda x: next((d['id'] for d in x.get('dot_points') or [] if d.get('role') == 'primary'), None)
rs = lambda x: set(x.get('required_skills') or [])
dis = {}; n = 0
for pid, b in B.items():
    a = A.get(pid, b)
    big = DP.get(prim(a), {}).get('focus_area') != DP.get(prim(b), {}).get('focus_area') or len(clos(rs(a)) ^ clos(rs(b))) >= 2 or bool(a.get('dot_points')) != bool(b.get('dot_points'))
    if big: dis[pid] = dict(A=a, B=b)
    db.execute("delete from tags where part_id=? and scheme in ('2024','free','note','skill')", (pid,))
    ins = lambda *v: db.execute("insert into tags(part_id,scheme,focus_area,dot_point,code,year_level,coverage,is_primary,confidence,tag_source,mapping_version,prompt_version) values (?,?,?,?,?,?,?,?,?,?,?,?)", v)
    src = 'checker' if big else ('agreed' if a is b or (prim(a) == prim(b) and clos(rs(a)) == clos(rs(b))) else 'checker')
    for d in b.get('dot_points') or []:
        x = DP.get(d['id'])
        if not x: continue
        yl = int(d['id'][1:3]); ins(pid, '2024', x['focus_area'], x['text'], d['id'], yl, 'examinable' if yl == 12 else 'moved_to_year_11', 1 if d.get('role') == 'primary' else 0, b.get('confidence'), src, 'v2', 'tag-v2.3')
    if not b.get('dot_points') and not b.get('lead_in'):
        if b.get('removed_reason') or b.get('topic_2017'):
            ins(pid, '2024', None, None, None, None, 'removed', 1, b.get('confidence'), src, 'v2', 'tag-v2.3')
            ins(pid, 'note', None, (b.get('removed_reason') or '')[:300], b.get('topic_2017') or None, None, None, 0, None, src, None, 'tag-v2.3')
    for s in b.get('required_skills') or []: ins(pid, 'skill', None, s, None, None, 'required', 1, None, src, None, 'tag-v2.3')
    for s in b.get('can_use_skills') or []: ins(pid, 'skill', None, s, None, None, 'can_use', 0, None, src, None, 'tag-v2.3')
    n += 1
db.commit()
json.dump(dis, open(paths.S + W[len(P):] + 'disagreements.json', 'w'), ensure_ascii=False)
print('merged', n, 'parts;', len(dis), 'disagreements for the owner')
