#!/usr/bin/env python3
"""The Standard course's page files, before any Standard question is imported (owner 23 Nov: "we need to start working on the
standard course", "Standard 2 first", pilot "once setup is done"; STANDARD_SPEC.md setup step 4).

Writes, from state/work/skills/standard/dotpoints.json (tools/standard_syllabus.py):
  site/data/dotpoints-standard.json         the page's dot points for Standard 2: Year 11 common + Year 12 Standard 2 (never the S1 ids),
                                            in the Advanced format {id, fa, yl, sub, text, tex, short}
  site/data/bank/standard/index.gz.json     an EMPTY bank index in tools/bank_split.py's format (same fields, no questions), so every
  site/data/bank/standard/details.gz.json   view works for the course with zero questions; the pilot's import replaces both
The course is listed in QG.courses (page_src/js/01_core.js) as 'standard'.
`short` labels: tools/standard_short.py by hand (162, where the first clause ran past 60 characters), else the first clause.
  python3 tools/standard_course.py
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import hashlib, json, os, re
from bank_split import write_gz
from standard_short import SHORT   # hand-written where the first clause is too long

SRC = paths.S + 'work/skills/standard/dotpoints.json'
DOTS = paths.P + 'site/data/dotpoints-standard.json'
BANK = paths.P + 'site/data/bank/standard/'


def short(t):
    s = re.split(r',| in a variety| to solve| with and without| using a | in practical| in the context', t)[0].strip()
    if len(s) > 60: s = s[:60].rsplit(' ', 1)[0].rstrip(':;') + '…'
    return s


def main():
    src = [x for x in json.load(open(SRC)) if x['part'] in ('common', 'S2')]
    dots = [{'id': x['id'], 'fa': x['fa'], 'yl': x['yl'], 'sub': x['sub'], 'text': x['text'], 'tex': x['tex'], 'short': SHORT.get(x['id']) or short(x['text'])} for x in src]
    json.dump(dots, open(DOTS, 'w'), ensure_ascii=False, indent=0)
    os.makedirs(BANK, exist_ok=True)
    sig = hashlib.sha256(json.dumps(dots, sort_keys=True).encode()).hexdigest()[:16]
    # 24 Nov: rerun to refresh short labels, this wiped the built Standard bank (405 questions); the empty bank is a first-time placeholder only
    if os.path.exists(BANK + 'index.gz.json'):
        print(f'standard: {len(dots)} dot points -> {DOTS}; bank left as built'); return
    write_gz(BANK + 'index.gz.json', {'v': 3, 'built': '', 'counts': {}, 'src': sig, 'course': 'standard', 'docs': {}, 'tables': {},
                                      'figs': {}, 'codes17': {}, 'files': [], 'questions': []})
    write_gz(BANK + 'details.gz.json', {'v': 1, 'src': sig, 'q': {}, 'sk': {}})
    print(f'standard: {len(dots)} dot points -> {DOTS}; empty bank -> {BANK}')


if __name__ == '__main__':
    main()
