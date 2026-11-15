#!/usr/bin/env python3
"""Split site/data/bank.json into a small index the page loads at start and one content file per topic home, loaded on demand.

Fix 1 of the plan "Questgen architecture plan: before imports resume" (owner 14 Nov: "Ok we should run Fix 1 and 2"):
keep the published page small; fetch data only when needed. The whole 5 MB bank.json used to load at start, and import
(about 3 MB per new paper of images and diagrams, ~90 KB of bank text per paper, target 538 papers) would only grow it.

  python3 tools/bank_split.py          read site/data/bank.json (written by build_bank.py), write the split files
  python3 tools/bank_split.py --check  exit 1 when the split files are missing or were split from a different bank.json
                                       (by content: index.json records bank.json's sha256 as src; batch_check uses stale())

Output, per course (only Advanced has data; CODE_HEALTH rule 5: the course is a folder, never typed into the page).
Job 2, 16 Nov (owner: "Yeah build it", agreeing to the split and to the start-load budget counting compressed bytes): the
index that loads at start holds only what the Bank needs; everything else waits in a details file the page reads right after
start. At 538 papers the old index would have been ~18 MB (budget 2.35 MB; the platform refuses any file over 16 MB).
  site/data/bank/<course>/index.json.gz   (gzip; the page unpacks it, 01_core.js QG.get) docs, tables, figs, codes17, files,
      and every question as the Bank needs it, no text: id, doc, number, type, marks, key, dup_of, decide, old, std, h, hx, fk,
      tri {tier} (the approved-only filter, 08_review.js qState), parts [{id, label, parent, marks, t24: primary tags only
      [{id, primary, cov when removed/no_match}], tagd: primary dot points only per side {A|B: {dp, removed}}, dif {b, wm}}]:
      exactly what topic homes (07_bank.js homeOf/partPri), counts, bankStats and the Bank filters (bfOK, qDifOK) read.
      h  = index into files (the question's content file = its topic home in the database, questions.home_topic),
      hx = 1 when the "show the derivative, hence integrate" rule applies (owner 12 Nov; needs the part text, so it is
           computed here, once, instead of in the page: 07_bank.js homeOf reads it),
      fk = figure keys {a: all, i: inline \\exfigure, o: option figures} (05_figures.js figKeys reads it; Review counts need
           it for every question, and it comes from the question text).
  site/data/bank/<course>/details.json.gz   (gzip) {v, src, q: {id: {every other field (section, review_note, pages, related, queues, decide_at ...), solutions
      [{id, part_id, source, meta}], tri (full), parts: {part id: {t24, tagd, dif, skills} in full}}}}: what Review, Exams,
      Reports, Difficulty and the Guide read. The page merges it into the same question objects (01_core.js QG.det) and
      those views wait for it (09_router.js route); a question card waits for it too (QG.has).
  site/data/bank/<course>/<topic slug>.json   {v, topic, q: {id: {stem, options, opt_table, layout, figures, solutions (full),
      parts [{id, latex, c17, can_use, note, free, gates, ...}], fn: {figure key: {notes, check_notes}}}}}: what only a
      rendered question needs. The page merges it
      into the same question objects (01_core.js QG.need), so every view keeps reading q.stem, p.latex, s.latex as before.
Both .gz files are written byte-for-byte reproducibly (gzip mtime 0): an unchanged bank gives unchanged files.
The page groups loads by file, so a question whose home the owner later changes (Review > Topics) still loads from the file
it was built into. site/data/bank.json stays as it is (build tools, page_test_fixture, render_audit read it) until the main
session removes it from the publish set.
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import gzip, hashlib, json, os, re, sqlite3, sys, time

P = paths.P
DB = paths.DBS
COURSE = 'advanced'   # QG.courses key in page_src/js/01_core.js
OUT = P + 'site/data/bank/' + COURSE + '/'
INDEX = OUT + 'index.json.gz'
DETAILS = OUT + 'details.json.gz'

Q_CONTENT = ('stem', 'options', 'opt_table', 'layout', 'figures')            # whole fields that move to the topic file
P_INDEX = ('id', 'label', 'parent', 'marks', 't24', 'dif', 'skills', 'tagd')   # part fields every list needs; the rest is content
# job 2 (owner 16 Nov: "Yeah build it"): of those, what the start index keeps; the rest goes to details.json.gz
Q_START = ('id', 'doc', 'number', 'type', 'marks', 'key', 'dup_of', 'decide', 'old', 'std')
# details: every other question field (section, review_note, pages, related, queues, decide_at, ...) + solutions, tri (full)
P_START = ('id', 'label', 'parent', 'marks')                                  # + slim t24 / tagd / dif below
P_DETAIL = ('t24', 'tagd', 'dif', 'skills')                                   # in full
S_INDEX = ('id', 'part_id', 'source')
S_META = ('source_flag', 'corrected')
F_CONTENT = ('notes', 'check_notes')   # figs[k] text fields: in the content file of the question that shows figure k (c.fn)   # 08_review.js needsDecision reads these for questions with no triage

# owner 12 Nov: "show the derivative, hence integrate" -> integration, whatever the marks. Same tests the page used to run on
# the part text (07_bank.js homeOf); re.ASCII so \b and \w mean what they mean in JavaScript.
_HENCE = re.compile(r'\bhence\b', re.I | re.A)
_INT = re.compile(r'\\int')
_DERIV = re.compile(r"\\dfrac\{d\}\{dx\}|\\frac\{d\}\{dx\}|differentiate|derivative|f'|\\prime", re.I | re.A)
_EXFIG = re.compile(r'\\exfigure\{([A-Za-z0-9_.-]+)\}')


def leaves(q):
    par = {p.get('parent') for p in q['parts']}
    return [p for p in q['parts'] if p['id'] not in par]


def hence(q):
    lv = leaves(q)
    if len(lv) < 2: return False
    lp = lv[-1]['latex'] or ''
    return bool(_HENCE.search(lp) and _INT.search(lp) and any(_DERIV.search(p['latex'] or '') for p in lv[:-1]))


def fig_keys(q):
    """The page's old figKeys(q), once, here: figure list, inline \\exfigure{} keys in any text, option figures."""
    s = ' '.join(x or '' for x in [q.get('stem')] + [p.get('latex') for p in q['parts']] + [x.get('latex') for x in q['solutions']]
                 + [o.get('latex') for o in q['options']])
    inl = _EXFIG.findall(s)
    lst = [f['src'].split('/')[-1].replace('.png', '', 1) for f in q['figures']]
    of = [o['fig'] for o in q['options'] if o.get('fig')]
    a = list(dict.fromkeys(lst + inl + of))
    if not a: return None
    fk = {'a': a}
    if inl: fk['i'] = list(dict.fromkeys(inl))
    if of: fk['o'] = list(dict.fromkeys(of))
    return fk


def slug(k):
    s = re.sub(r'[^a-z0-9]+', '-', (k or 'other').lower().replace('sub:', '').replace('special:', '')).strip('-')
    return s[:80] or 'other'


def homes():
    """questions.home_topic (the page's computed home, exported into the database at every import; owner picks included)."""
    try:
        db = sqlite3.connect('file:' + DB + '?mode=ro', uri=True)
        return {r[0]: r[1] for r in db.execute('select id, home_topic from questions')}
    except Exception as e:
        print('WARN bank_split: no home topics from the database (%s): every question goes to other.json' % e)
        return {}


def dump(o):
    return json.dumps(o, ensure_ascii=False, separators=(',', ':'))


def write_gz(path, o):
    """gzip, reproducible (mtime 0, no file name): the same content always gives the same bytes, so publish_set sees no change."""
    raw = dump(o).encode()
    with open(path, 'wb') as f, gzip.GzipFile(filename='', mode='wb', fileobj=f, mtime=0, compresslevel=9) as g: g.write(raw)
    return len(raw)


def read_gz(path):
    return json.loads(gzip.decompress(open(path, 'rb').read()).decode('utf-8'))


def slim_part(p):
    """A part as the Bank needs it: main tags only (topic homes), difficulty band and kind (Bank filters)."""
    x = {k: p[k] for k in P_START if p.get(k) is not None}
    t = [{'id': t.get('id'), 'primary': t['primary'], **({'cov': t['cov']} if t.get('cov') in ('removed', 'no_match') else {})}
         for t in (p.get('t24') or []) if t.get('primary')]
    if t: x['t24'] = t
    if p.get('tagd'):
        x['tagd'] = {sd: {'dp': [d for d in v.get('dp', []) if d[1] == 'primary'], **({'removed': v['removed']} if v.get('removed') else {})}
                     for sd, v in p['tagd'].items()}
    if p.get('dif'): x['dif'] = {k: p['dif'][k] for k in ('b', 'wm') if k in p['dif']}
    return x


def src_hash(path=None):
    """sha256 (16 hex) of site/data/bank.json: the index records the bank.json it was split from (idx['src'])."""
    return hashlib.sha256(open(path or P + 'site/data/bank.json', 'rb').read()).hexdigest()[:16]


def stale():
    """True when the index is missing or was split from a different bank.json. By content, not file times: a git merge or
    checkout rewrites both files with arbitrary times (e.g. merging Fix 2's bank.json, which adds question keys)."""
    if not (os.path.exists(INDEX) and os.path.exists(DETAILS)): return True
    try: return read_gz(INDEX).get('src') != src_hash()
    except Exception: return True


def split(bank, home, src=None):
    files, slugs, content = [], {}, {}
    idx_q, figs, moved, details = [], bank['figs'], set(), {}
    for q in bank['questions']:
        k = home.get(q['id']) or 'other'
        sl = slug(k)
        if sl not in slugs:
            if any(f['f'].endswith('/' + sl + '.json') for f in files): sl += '-' + hashlib.sha1(k.encode()).hexdigest()[:6]
            slugs[sl] = len(files); files.append({'k': k, 'f': 'data/bank/%s/%s.json' % (COURSE, sl)}); content[sl] = {}
        h = slugs[sl]
        x = {kk: q[kk] for kk in Q_START if q.get(kk) not in (None, '', [])}
        if q.get('tri', {}).get('tier'): x['tri'] = {'tier': q['tri']['tier']}
        x['parts'] = [slim_part(p) for p in q['parts']]
        # every other question field goes to the details, listed or not (review 16 Nov: a fixed list dropped decide_at, which
        # build_bank.py writes for a call raised after approval; a field added to build_bank later must not vanish either)
        dt = {kk: v for kk, v in q.items() if kk not in Q_START and kk not in Q_CONTENT and kk not in ('parts', 'solutions', 'tri', 'h')
              and v not in (None, '', [])}
        if q.get('tri'): dt['tri'] = q['tri']
        sols = []
        for s_ in q['solutions']:
            st = {kk: s_.get(kk) for kk in S_INDEX}
            m = {kk: s_['meta'][kk] for kk in S_META if (s_.get('meta') or {}).get(kk)}
            if m: st['meta'] = m
            sols.append(st)
        if sols: dt['solutions'] = sols
        pd = {str(p['id']): {kk: p[kk] for kk in P_DETAIL if p.get(kk) is not None} for p in q['parts']}
        pd = {k: v for k, v in pd.items() if v}
        if pd: dt['parts'] = pd
        if dt: details[str(q['id'])] = dt
        x['h'] = h
        if hence(q): x['hx'] = 1
        fk = fig_keys(q)
        if fk: x['fk'] = fk
        idx_q.append(x)
        c = {kk: q[kk] for kk in Q_CONTENT if kk in q}
        c['parts'] = [{kk: v for kk, v in p.items() if kk == 'id' or kk not in P_INDEX} for p in q['parts']]
        c['solutions'] = q['solutions']
        # the redraw notes ("What was changed") are only read next to a rendered question (Review > Diagrams): they travel with it
        fn = {f: {kk: figs[f][kk] for kk in F_CONTENT if figs.get(f, {}).get(kk)} for f in (fk or {}).get('a', []) if f in figs and f not in moved}
        fn = {f: v for f, v in fn.items() if v}
        if fn: c['fn'] = fn; moved.update(fn)
        content[sl][str(q['id'])] = c
    os.makedirs(OUT, exist_ok=True)
    for sl, qs in content.items():
        body = dump({'v': 3, 'topic': files[slugs[sl]]['k'], 'q': qs})
        files[slugs[sl]]['s'] = hashlib.sha256(body.encode()).hexdigest()[:12]   # the page fetches f?v=s: a changed file is a new address
        files[slugs[sl]]['n'] = len(qs)
        old = open(OUT + sl + '.json', encoding='utf-8').read() if os.path.exists(OUT + sl + '.json') else None
        if old != body: open(OUT + sl + '.json', 'w', encoding='utf-8').write(body)
    # CODE_HEALTH rule 4: a topic file no question uses any more is archived, and publish_set sends null for it once
    keep = {sl + '.json' for sl in content}   # index.json (before job 2) is archived here and sent as null once
    for f in sorted(os.listdir(OUT)):
        if f.endswith('.json') and f not in keep:
            arch = P + 'archive/bank_split_unused/' + COURSE + '/'
            os.makedirs(arch, exist_ok=True); os.replace(OUT + f, arch + time.strftime('%Y%m%d%H%M%S_') + f)
            print('archived unused topic file', f)
    idx = {'v': 3, 'built': bank.get('built'), 'src': src, 'course': COURSE, 'docs': bank['docs'], 'tables': bank['tables'], 'figs': {k: {kk: v for kk, v in f.items() if not (k in moved and kk in F_CONTENT)} for k, f in figs.items()},
           'codes17': bank.get('codes17', {}), 'files': files, 'questions': idx_q}
    idx['raw'] = write_gz(INDEX, idx)
    idx['raw_details'] = write_gz(DETAILS, {'v': 1, 'src': src, 'q': details})
    return idx


def main():
    src = P + 'site/data/bank.json'
    if '--check' in sys.argv:
        bad = stale()
        print('bank split ' + ('STALE or missing: run python3 tools/bank_split.py' if bad else 'ok'))
        sys.exit(1 if bad else 0)
    bank = json.load(open(src, encoding='utf-8'))
    idx = split(bank, homes(), src_hash(src))
    tot = sum(os.path.getsize(P + 'site/' + f['f']) for f in idx['files'])
    print('bank split: index %d KB gzip (%d KB unpacked, %d questions), details %d KB gzip (%d KB unpacked), %d topic files %d KB (largest %d KB), bank.json %d KB' % (
        os.path.getsize(INDEX) // 1024, idx['raw'] // 1024, len(idx['questions']), os.path.getsize(DETAILS) // 1024, idx['raw_details'] // 1024, len(idx['files']), tot // 1024,
        max(os.path.getsize(P + 'site/' + f['f']) for f in idx['files']) // 1024, os.path.getsize(src) // 1024))


if __name__ == '__main__':
    main()
