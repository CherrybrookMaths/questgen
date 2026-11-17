#!/usr/bin/env python3
"""Map each skill to the syllabus topic (dot-point subheading) it belongs to, for skill gating in the exam builders.

Owner 17 Nov: "learn means ticked." (TAG_SPEC "Gating by what has been learnt"): the topics ticked when building an exam are the
learnt set, and a question qualifies only when every REQUIRED skill of its parts (plus their prerequisites) belongs to a ticked
topic. That needs skill -> topic, which no file held. This derives it from the bank: a skill's topic is the subheading of the main
dot points of the parts that need it, weighted by marks (a skill is mostly needed where it is taught). Low agreement is listed for
the owner to check.

  python3 tools/skill_topics.py          write work/skill_usage.json (evidence for the taught-topic map, not the map itself) {skill: {sub, key, share, n, alt}}
  python3 tools/skill_topics.py --list   print the skills whose top topic has under 60% of the weight
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import collections, json, sys

S = paths.S
OUT = paths.P + 'work/skill_usage.json'   # evidence only (where skills are USED); the gate map is assigned by where they are TAUGHT
WEAK = 0.6


def main():
    dp = {d['id']: d for d in json.load(open(S + 'work/skills/dotpoints.json'))}
    skills = [x['skill'] for x in json.load(open(S + 'work/skills/skill_prereqs.json'))]
    bank = json.load(open(paths.P + 'site/data/bank.json'))
    w = collections.defaultdict(collections.Counter)
    for q in bank['questions']:
        if q.get('dup_of') or q.get('old') or q.get('std'): continue
        for p in q['parts']:
            prim = [t['id'] for t in (p.get('t24') or []) if t.get('primary') and t['id'] in dp]
            for s in p.get('skills') or []:
                for i in prim:
                    d = dp[i]; yl = 'Y12' if i.startswith('Y12') else 'Y11'
                    w[s][(yl, d['focus_area'], d.get('sub') or '')] += (p.get('marks') or 1) / len(prim)
    out = {}
    for s in skills:
        c = w.get(s)
        if not c: out[s] = {'sub': None, 'key': None, 'share': 0, 'n': 0, 'alt': []}; continue
        tot = sum(c.values()); (top, v), *rest = c.most_common(3)
        out[s] = {'sub': top[2] or top[1], 'key': 'sub:%s|%s|%s' % top, 'share': round(v / tot, 2), 'n': round(tot, 1),
                  'alt': [{'sub': k[2] or k[1], 'share': round(x / tot, 2)} for k, x in rest]}
    json.dump(out, open(OUT, 'w'), indent=1, sort_keys=True)
    weak = {s: v for s, v in out.items() if v['share'] < WEAK}
    print(f'skill_topics: {len(out)} skills -> {OUT[len(paths.P):]}; {len(weak)} below {WEAK:.0%} agreement '
          f'({sum(1 for v in out.values() if not v["n"])} never used)')
    if '--list' in sys.argv:
        for s, v in sorted(weak.items(), key=lambda x: x[1]['share']):
            print(f'  {v["share"]:.0%}  {s}  -> {v["sub"]}  | ' + '; '.join(f'{a["sub"]} {a["share"]:.0%}' for a in v['alt']))


if __name__ == '__main__':
    main()
