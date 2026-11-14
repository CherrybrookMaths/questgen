"""Exam naming rule (owner, 11 Nov): "every exam has to have the year, the task number (Trials are AT4), formal school name".

Label = "<year> <formal school name> AT<n>"   e.g. "2023 Cherrybrook Technology High School AT1"
        "<year> NESA HSC"                      for HSC papers
Stored per paper in documents: year, school_formal, task_code (AT1..AT4 or HSC), display_label (built here, never typed by hand).
School names must match the official NSW school list (ACARA School Location file, NSW rows) in
project/nsw_schools.csv (ACARA School Location 2025, NSW rows: 3,433 schools, all sectors), column "School Name".

Year = the year the students graduate (sit the HSC), owner 11 Nov: "Task 1s should be the year they graduate. If they grad 2024, the term 4 task
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
from last year should be 2024 AT1". A Year 12 AT1 sat in Term 4 of Year 11 (cover "2023 - 2024", or "2020 (for 2021 HSC)") takes the later year.

Usage: python3 exam_name.py            # rebuild labels and report any paper that breaks the rule
"""
import sqlite3, csv, os, re, sys, difflib
DB = paths.DBS
LIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'site', 'project', 'nsw_schools.csv')
KNOWN = {'NESA', 'CSSA', 'Independent', 'NEAP', 'Western Mathematics', 'PEM', 'ACE', 'MathsBank', 'Bookminders', 'QATS', 'TEC', 'Trialmaths'}   # owner 11 Nov: "Commercial trial papers are fine" (labelled by setter, e.g. "2022 NEAP AT4")
_OLD_KNOWN_NOTE = None   # approved non-school setters; owner 11 Nov: "CSSA papers should be labelled CSSA" ("2022 CSSA AT4"); "Independent" (commercial trial with no school on the cover: "2021 Independent AT4")
TASK = re.compile(r'^(AT[1-4]|HSC)$')

def schools():
    if os.path.exists(LIST):
        with open(LIST, newline='', encoding='utf-8') as f:
            return {r['School Name'].strip() for r in csv.DictReader(f)} | KNOWN, True
    return KNOWN, False

def label(year, school, task):
    return f'{year} NESA HSC' if task == 'HSC' else f'{year} {school} {task}'

def main():
    db = sqlite3.connect(DB)
    names, have_list = schools()
    used = {r[0] for r in db.execute('select distinct document_id from questions')}
    bad = []
    for i, y, s, t in db.execute('select id, year, school_formal, task_code from documents where id in (%s)' % ','.join(map(str, used))):
        probs = []
        if not (y and re.fullmatch(r'20\d\d', str(y))): probs.append('year missing')
        if not (t and TASK.match(t)): probs.append('task must be AT1-AT4 (Trials are AT4) or HSC')
        if not s: probs.append('school missing')
        elif s not in names:
            near = difflib.get_close_matches(s, list(names), n=3, cutoff=0.6)
            probs.append((f'"{s}" is not in the official NSW school list' + (f' (closest: {"; ".join(near)})' if near else '')) if have_list else f'"{s}" not yet checked (no school list loaded)')
        if y and s and t: db.execute('update documents set display_label=? where id=?', (label(y, s, t), i))
        if probs: bad.append((i, label(y, s, t) if y and s and t else '?', probs))
    db.commit()
    for b in bad: print('paper', b[0], b[1], '->', '; '.join(b[2]))
    print('naming: %d papers, %d need attention%s' % (len(used), len(bad), '' if have_list else ' (official school list not loaded yet)'))

if __name__ == '__main__':
    main()
