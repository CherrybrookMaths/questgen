#!/usr/bin/env python3
"""Owner filing rules for a question's main topic (home), applied after tagging (IMPORT_PLAYBOOK pipeline step 12 "Homes").

Owner 17 Nov: "I can file them under financial math please do that": a single sum earning compound interest keeps its dot
point (Y12-228, geometric sequences: the 2024 syllabus has no compound-interest dot point of its own, and it is not Standard
content) but is filed under Financial mathematics > Annuities (subheading of Y12-356). TAG_SPEC "Owner rulings" records it.

The page reads a home pick from the question's review doc (reviews/k_<key>.home = {id: <dot point>, note}; page_src/js/07_bank.js
qHome: an owner pick wins over the computed home). This tool finds every question a rule covers that has no pick yet:

  python3 tools/home_rules.py EXPORT_DIR           list them (EXPORT_DIR: ArtifactData export holding reviews/)
  python3 tools/home_rules.py EXPORT_DIR --write   also set questions.home_topic / home_source in the database and write
                                                   work/home_rules_batch.json: the ArtifactData "batch" writes to apply
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import json, os, re, sqlite3, sys
import import_next as IN

NOTE = 'Owner 17 Nov: "I can file them under financial math please do that" (single-sum compound interest; dot point stays Y12-228)'
RULES = [   # (name, primary dot point, text pattern, home dot point)
    ('compound interest -> Financial mathematics', 'Y12-228', re.compile(r'compound|interest', re.I), 'Y12-356'),
]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    db = sqlite3.connect(paths.DBS)
    reviews = dict(IN.read(args[0] if args else None, 'reviews', db, 'page_reviews'))
    key_of = IN.question_keys(db)
    dp = {d['id']: d for d in json.load(open(paths.S + 'work/skills/dotpoints.json'))}
    hits = []
    for name, prim, pat, home in RULES:
        for (qid,) in db.execute("""select distinct q.id from questions q join parts p on p.question_id=q.id join tags t on t.part_id=p.id
                                    where t.scheme='2024' and t.is_primary=1 and t.code=?""", (prim,)):
            text = ' '.join([db.execute('select coalesce(stem_latex,"") from questions where id=?', (qid,)).fetchone()[0]]
                            + [r[0] for r in db.execute('select latex from parts where question_id=?', (qid,))])
            if not pat.search(text): continue
            k = key_of.get(qid)
            r = reviews.get('k_' + k) if k else None
            if (r or {}).get('home') or (reviews.get('q%d' % qid) or {}).get('home'): continue   # an owner pick already stands
            hits.append((qid, k, home, r))
    for qid, k, home, r in hits: print(qid, k, '->', home, dp[home]['sub'])
    print(len(hits), 'question(s) to file')
    if '--write' not in sys.argv or not hits: return
    writes = []
    for qid, k, home, r in hits:
        d = dp[home]
        db.execute("update questions set home_topic=?, home_source=? where id=?", (f"sub:{int(home[1:3])}|{d['focus_area']}|{d['sub']}", 'owner:' + home, qid))
        pick = {'home': {'id': home, 'note': NOTE}}
        if r: writes.append({'op': 'update', 'collection': 'reviews', 'doc_id': 'k_' + k, 'if_version': r.get('_version'), 'data': pick})
        else: writes.append({'op': 'set', 'collection': 'reviews', 'doc_id': 'k_' + k, 'data': {'key': k, 'question_id': qid, 'question_ids': [qid], **pick, 'by': 'claude (home rule)'}})
    db.commit()
    json.dump(writes, open(paths.P + 'work/home_rules_batch.json', 'w'), indent=1, ensure_ascii=False)
    print('database updated; ArtifactData batch in work/home_rules_batch.json (update writes need the doc version as if_version)')


if __name__ == '__main__':
    main()
