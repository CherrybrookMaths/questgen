#!/usr/bin/env python3
"""Dot points of every course in one lookup (owner 23 Nov: "we need to start working on the standard course"; STANDARD_SPEC.md).
Advanced ids are Y11-nnn / Y12-nnn (state/work/skills/dotpoints.json); Standard ids are S11-nnn (Year 11, both Standard courses),
S2-12-nnn (Year 12 Standard 2) and S1-12-nnn (Year 12 Standard 1) (state/work/skills/standard/dotpoints.json). The ids never clash,
so a tool that meets a dot point id needs no course to look it up. Each entry: {id, course, focus_area, sub, text, year_level}.
  coverage(id): the tags.coverage value a 2024 tag row gets: Advanced keeps its rule (a Year 11 dot point is 'moved_to_year_11',
  owner 11 Nov); every Standard dot point in the course is 'examinable'."""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import functools, json, os


@functools.lru_cache(None)
def dotpoints():
    out = {}
    for x in json.load(open(paths.S + 'work/skills/dotpoints.json')):
        out[x['id']] = {'id': x['id'], 'course': 'advanced', 'focus_area': x['focus_area'], 'sub': x.get('sub'), 'text': x['text'],
                        'year_level': int(x['id'][1:3])}
    f = paths.S + 'work/skills/standard/dotpoints.json'
    if os.path.exists(f):
        for x in json.load(open(f)):
            out[x['id']] = {'id': x['id'], 'course': 'standard', 'focus_area': x['fa'], 'sub': x['sub'], 'text': x['text'], 'year_level': x['yl']}
    return out


def coverage(dp_id):
    d = dotpoints().get(dp_id)
    if not d: return None
    if d['course'] == 'standard': return 'examinable'
    return 'examinable' if d['year_level'] == 12 else 'moved_to_year_11'
