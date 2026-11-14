"""Load tag outputs for an import batch without touching earlier papers' tags (import batches, 11 Nov 2026).
Usage: python3 load_tags_batch.py tag/out_b1_*.json
Replaces tags only for the part_ids in the given files. Same rules as load_tags.py, except area between two curves
is examinable (decision: tagged Y12-279), so no two-curve override."""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import json, sqlite3, sys, collections
P = paths.P
db = sqlite3.connect(paths.DBS)
dps = {d['id']: d for d in json.load(open(P + 'site/project/syllabus_dotpoints.json'))}
stats = collections.Counter(); bad = []
for f in sys.argv[1:]:
    for r in json.load(open(f))['results']:
        pid = r['part_id']; st = r['status']
        db.execute('delete from tags where part_id=?', (pid,))
        if st == 'tagged':
            ok_any = False
            for t in r['tags']:
                dp = dps.get(t['dot_point_id'])
                if dp is None or dp['text'] != t['dot_point_text']: bad.append((pid, t['dot_point_id'])); continue
                ok_any = True
                db.execute("insert into tags(part_id,scheme,focus_area,dot_point,code,year_level,coverage,is_primary,confidence,tag_source,mapping_version,prompt_version) values (?,?,?,?,?,?,?,?,?,?,?,?)",
                           (pid, '2024', dp['focus_area'], dp['text'], dp['id'], dp['year_level'], 'examinable' if dp['year_level'] == 12 else 'moved_to_year_11',
                            int(bool(t.get('is_primary'))), t.get('confidence'), 'model', 'v1', 'tag-v1'))
            stats['tagged' if ok_any else 'tag_failed'] += 1
        else:
            db.execute("insert into tags(part_id,scheme,coverage,is_primary,tag_source,mapping_version,prompt_version) values (?,?,?,?,?,?,?)",
                       (pid, '2024', 'removed' if st == 'removed' else 'no_match', 1, 'model', 'v1', 'tag-v1'))
            stats[st] += 1
            if st == 'no_match': db.execute('update parts set needs_review=1 where id=?', (pid,))
        db.execute("insert into tags(part_id,scheme,code,confidence,tag_source,mapping_version,prompt_version) values (?,?,?,?,?,?,?)",
                   (pid, '2017', r.get('code_2017'), r.get('code_2017_confidence'), 'model', 'v1', 'tag-v1'))
        for ft in r.get('free_tags') or []:
            db.execute("insert into tags(part_id,scheme,dot_point,tag_source,prompt_version) values (?,?,?,?,?)", (pid, 'free', ft, 'model', 'tag-v1'))
        if r.get('reason') and st != 'tagged':
            db.execute("insert into tags(part_id,scheme,dot_point,tag_source,prompt_version) values (?,?,?,?,?)", (pid, 'note', r['reason'], 'model', 'tag-v1'))
db.commit()
print(dict(stats), 'verbatim failures:', bad[:10], len(bad))
