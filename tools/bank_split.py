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
  site/data/bank/<course>/index.gz.json   (gzip as base64 text: {v, gz}; the page unpacks it, 01_core.js QG.json) docs, tables, figs, codes17, files,
      and every question as the Bank needs it, no text: id, doc, number, type, marks, key, dup_of, decide, old, std, h, hx, fk,
      tri {tier} (the approved-only filter, 08_review.js qState), parts [{id, label, parent, marks, t24: primary tags only
      [{id, primary, cov when removed/no_match}], tagd: primary dot points only per side {A|B: {dp, removed}}, dif {b, wm}}]:
      exactly what topic homes (07_bank.js homeOf/partPri), counts, bankStats and the Bank filters (bfOK, qDifOK) read.
      h  = index into files (the question's content file = its topic home in the database, questions.home_topic),
      hx = 1 when the "show the derivative, hence integrate" rule applies (owner 12 Nov; needs the part text, so it is
           computed here, once, instead of in the page: 07_bank.js homeOf reads it),
      fk = figure keys {a: all, i: inline \\exfigure, o: option figures} (05_figures.js figKeys reads it; Review counts need
           it for every question, and it comes from the question text).
  site/data/bank/<course>/details.gz.json   (gzip as base64 text) {v, src, q: {id: {every other field (section, review_note, pages, related, queues, decide_at ...), solutions
      [{id, part_id, source, meta}], tri (full), parts: {part id: {t24, tagd, dif, skills} in full}}}}: what Review, Exams,
      Reports, Difficulty and the Guide read. The page merges it into the same question objects (01_core.js QG.det) and
      those views wait for it (09_router.js route); a question card waits for it too (QG.has).
      Skill gates (owner 17 Nov: "lets do skill gates, that's important"): the details also carry sk = {skill: [topic keys]},
      the taught topics a REQUIRED skill needs learnt before a question that uses it can go into an exam: the skill's own
      topic plus every prerequisite's (transitive), basic skills left out (they never gate); a skill whose list is empty is
      not listed. From state/work/skills/skill_topics.json (key, basic) and skill_prereqs.json (skill_gates below); the page
      reads it as QG.skills (24_exams.js / 23_exam_auto.js XG).
  site/data/bank/<course>/search.gz.json   (gzip as base64 text) {v, src, q: {id: stem + part text + free tags + can-use skills}}: the
      words the Bank's search reads, so a search no longer downloads every topic file (owner 25 Nov; 07_bank.js bankHay).
  site/data/bank/<course>/<topic slug>.json   {v, topic, q: {id: {stem, options, opt_table, layout, figures, solutions (full),
      parts [{id, latex, c17, can_use, note, free, gates, ...}], fn: {figure key: {notes, check_notes}}}}}: what only a
      rendered question needs. The page merges it
      into the same question objects (01_core.js QG.need), so every view keeps reading q.stem, p.latex, s.latex as before.
Both are written reproducibly (gzip mtime 0): an unchanged bank gives unchanged files. The host serves no .gz files
(publish refused 16 Nov), hence the base64 wrapper (+33%; the budget counts the file as published).
The page groups loads by file, so a question whose home the owner later changes (Review > Topics) still loads from the file
it was built into. site/data/bank.json stays as it is (build tools, page_test_fixture, render_audit read it) until the main
session removes it from the publish set.
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import base64, gzip, hashlib, io, json, os, re, sqlite3, sys, time

P = paths.P
DB = paths.DBS
COURSE = 'advanced'   # QG.courses key in page_src/js/01_core.js
OUT = P + 'site/data/bank/' + COURSE + '/'
INDEX = OUT + 'index.gz.json'
DETAILS = OUT + 'details.gz.json'
SEARCH = OUT + 'search.gz.json'


def set_course(c):
    """Point the split at one course's folder (owner 23 Nov: "we need to start working on the standard course"): each course's
    questions go to site/data/bank/<course>/ only (documents.course); Advanced keeps every question that is not Standard."""
    global COURSE, OUT, INDEX, DETAILS, SEARCH
    COURSE = c; OUT = P + 'site/data/bank/' + c + '/'; INDEX = OUT + 'index.gz.json'; DETAILS = OUT + 'details.gz.json'; SEARCH = OUT + 'search.gz.json'


def doc_courses():
    try:
        db = sqlite3.connect('file:' + DB + '?mode=ro', uri=True)
        return {str(r[0]): r[1] for r in db.execute('select id, course from documents')}
    except Exception: return {}


import course_dots   # every course's dot points (Standard ids S11- / S2-12- carry their year in the file, not in the id)
def is_y12(i):
    d = course_dots.dotpoints().get(i)
    return d['year_level'] == 12 if d else (i or '').startswith('Y12')

Q_CONTENT = ('stem', 'options', 'opt_table', 'layout', 'figures')            # whole fields that move to the topic file
P_INDEX = ('id', 'label', 'parent', 'marks', 't24', 'dif', 'skills', 'tagd')   # part fields every list needs; the rest is content
# job 2 (owner 16 Nov: "Yeah build it"): of those, what the start index keeps; the rest goes to details.gz.json
Q_START = ('id', 'doc', 'number', 'type', 'marks', 'key', 'dup_of', 'decide', 'old', 'std', 'zt')   # zt: owner 17 Nov z-score table at the back (tools/ztable.py)
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
_EXFIG = re.compile(r'\\exfigure\{([A-Za-z0-9_.()-]+)\}')


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
    """gzip, reproducible (mtime 0, no file name), as base64 text in a JSON file {"v": 1, "gz": "..."}: the artifact host serves
    no .gz files (publish refused 16 Nov), so the bytes travel as text (+33%) and the page unpacks them (01_core.js QG.json).
    The same content always gives the same file, so publish_set sees no change."""
    raw = dump(o).encode()
    buf = io.BytesIO()
    with gzip.GzipFile(filename='', mode='wb', fileobj=buf, mtime=0, compresslevel=9) as g: g.write(raw)
    open(path, 'w', encoding='ascii').write(json.dumps({'v': 1, 'gz': base64.b64encode(buf.getvalue()).decode('ascii')}, separators=(',', ':')))
    return len(raw)


def read_gz(path):
    return json.loads(gzip.decompress(base64.b64decode(json.load(open(path, encoding='ascii'))['gz'])).decode('utf-8'))


SKILL_TOPICS = paths.S + 'work/skills/skill_topics.json'
SKILL_PREREQS = paths.S + 'work/skills/skill_prereqs.json'


def skill_gates_standard():
    """Standard's gates (STANDARD_SPEC.md "Skills", 136 approved skills): a skill's taught topic is its first dot point's subheading
    (sub:<year>|<focus area>|<subheading>, the page's key), plus its `requires`, transitively; `basic` skills never gate."""
    f = paths.S + 'work/skills/standard/skills.json'
    if not os.path.exists(f): return {}
    sk = {x['skill']: x for x in json.load(open(f, encoding='utf-8'))['skills']}
    dp = course_dots.dotpoints()
    key = lambda x: (lambda d: f"sub:{d['year_level']}|{d['focus_area']}|{d['sub'] or ''}")(dp[x['dot_points'][0]]) if x['dot_points'] and x['dot_points'][0] in dp else None
    out = {}
    for s_ in sorted(sk):
        seen, todo = set(), [s_]
        while todo:
            x = todo.pop()
            if x in seen: continue
            seen.add(x); todo += (sk.get(x) or {}).get('requires', [])
        keys = sorted({key(sk[x]) for x in seen if x in sk and not sk[x].get('basic') and key(sk[x])})
        if keys: out[s_] = keys
    return out


def skill_gates():
    """{skill: [topic keys]} for the exam builders' skill gates (TAG_SPEC "Gating by what has been learnt"; owner 12 Nov: "skills
    need to be gated like that", 17 Nov: "lets do skill gates, that's important"). A skill gates on its taught topic (key, same
    format as the page's topic keys: sub:<year>|<focus area>|<subheading>) and on its prerequisites' topics, transitively;
    basic skills never gate (owner: foundational algebra a Year 12 student always has). Empty lists are dropped."""
    if not os.path.exists(SKILL_TOPICS): print('WARN bank_split: no skill topic map: the exam builders do not gate'); return {}
    top = json.load(open(SKILL_TOPICS, encoding='utf-8'))
    req = {x['skill']: x.get('requires') or [] for x in json.load(open(SKILL_PREREQS, encoding='utf-8'))} if os.path.exists(SKILL_PREREQS) else {}
    out = {}
    for s in sorted(top):
        seen, todo = set(), [s]
        while todo:
            x = todo.pop()
            if x in seen: continue
            seen.add(x); todo += req.get(x, [])
        keys = sorted({top[x]['key'] for x in seen if x in top and not top[x].get('basic') and top[x].get('key')})
        if keys: out[s] = keys
    return out


def slim_part(p):
    """A part as the Bank needs it: main tags only (topic homes), difficulty band and kind (Bank filters)."""
    x = {k: p[k] for k in P_START if p.get(k) is not None}
    t = [{'id': t.get('id'), 'primary': t['primary'], **({'cov': t['cov']} if t.get('cov') in ('removed', 'no_match') else {})}
         for t in (p.get('t24') or []) if t.get('primary')]
    if t: x['t24'] = t
    # owner 17 Nov ("If it has ANY y12 parts, it goes straight to Y12"): a question whose only Year 12 tags are "also" tags is filed by
    # them, so those few ids are kept here (the home must not change when the details file lands)
    ya = [t['id'] for t in (p.get('t24') or []) if not t.get('primary') and is_y12(t.get('id'))]
    if ya: x['y12a'] = ya
    if p.get('tagd'):
        x['tagd'] = {sd: {'dp': [d for d in v.get('dp', []) if d[1] == 'primary'], **({'removed': v['removed']} if v.get('removed') else {}),
                          **({'y12a': [d[0] for d in v.get('dp', []) if d[1] != 'primary' and is_y12(d[0])]}
                             if any(d[1] != 'primary' and is_y12(d[0]) for d in v.get('dp', [])) else {})}
                     for sd, v in p['tagd'].items()}
    if p.get('dif'): x['dif'] = {k: p['dif'][k] for k in ('b', 'wm') if k in p['dif']}
    return x


def img_packs():
    """Papers that still have a per-paper image pack (site/data/img/<doc>.json: page scans + crops, while in review). Job 3
    (tools/image_lifecycle.py): a cleared paper's crops are in site/data/crop/ instead; the index marks docs[doc].ip = 1."""
    return sorted(int(f[:-5]) for f in os.listdir(P + 'site/data/img') if f[:-5].isdigit()) if os.path.isdir(P + 'site/data/img') else []


def src_hash(path=None):
    """sha256 (16 hex) of site/data/bank.json and the list of per-paper image packs: the index records what it was split
    from (idx['src']), so a paper cleared in Review (its pack archived) makes the index stale too (job 3)."""
    h = hashlib.sha256(open(path or P + 'site/data/bank.json', 'rb').read())
    h.update(json.dumps(img_packs()).encode())
    h.update(json.dumps(skill_gates(), sort_keys=True).encode())   # a changed skill map (skill gates, 17 Nov) is a new split too
    return h.hexdigest()[:16]


def stale():
    """True when the index is missing or was split from a different bank.json. By content, not file times: a git merge or
    checkout rewrites both files with arbitrary times (e.g. merging Fix 2's bank.json, which adds question keys)."""
    if not (os.path.exists(INDEX) and os.path.exists(DETAILS) and os.path.exists(SEARCH)): return True
    try: return read_gz(INDEX).get('src') != src_hash()
    except Exception: return True


PV_RE = re.compile(r'present\s+value', re.I)
# owner 25 Nov: "For area of a triangle, finding area is one choice, findin the angle or something else should be other choices."
# A question on Standard 2's area dot point (S2-12-068) whose words give the triangle's area ("the area of triangle AOB is 150 km^2", "has an
# area of", "given the area", "by considering the area"; not "show that the area of ... is") uses it to find a side or angle; every other one finds the area (07_bank.js SUB_SPLIT,
# the Bank's pills read q.ch). Checked by eye on all 43 such questions, 25 Nov.
AREA_GIVEN_RE = re.compile(r'(?<!show that the )area\s+of\s+[^.?]{0,80}?\s+is\s+\$?\s*\d|has\s+an\s+area\s+of|given\s+(?:that\s+)?the\s+area|by\s+considering\s+the\s+area', re.I)


def q_text(q, bank):
    """A question's own words: stem, parts, options and the captions and first rows of the tables it shows."""
    t = ' '.join([q.get('stem') or ''] + [p.get('latex') or '' for p in q['parts']] + [json.dumps(q.get('options') or '')])
    for tid in re.findall(r'\\extable\{([\w.()-]+)\}', t):
        tb = (bank.get('tables') or {}).get(tid) or {}
        t += ' ' + json.dumps(tb.get('cap') or '') + ' ' + json.dumps((tb.get('rows') or [])[:2])
    return t


def split(bank, home, src=None):
    files, slugs, content = [], {}, {}
    idx_q, figs, moved, details, srch = [], bank['figs'], set(), {}, {}
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
        # owner 17 Nov: "If it has ANY y12 parts, it goes straight to Y12." Year 12 by ANY tag (main or also, either tagger side);
        # the slim index keeps main tags only, so the year is decided here once (07_bank.js homeOf reads q.y12)
        ids = [t.get('id') or '' for p in q['parts'] for t in (p.get('t24') or [])] + \
              [d[0] for p in q['parts'] for v in (p.get('tagd') or {}).values() for d in v.get('dp', [])]
        if any(is_y12(i) for i in ids): x['y12'] = 1
        # owner 24 Nov: "For ANnuities it should be Future value and present value. Since PV is taught after, any question which has both
        # goes into PV." An annuity question (Standard 2 dot points S2-12-055..061) whose text or tables mention present value is filed
        # under Present value, every other one under Future value (07_bank.js SUB_SPLIT, qHome reads q.st)
        if any(re.fullmatch(r'S2-12-0(5[5-9]|6[01])', i or '') for i in ids):
            x['st'] = 'Present value' if PV_RE.search(q_text(q, bank)) else 'Future value'
        if 'S2-12-068' in ids:   # the stem and the parts on the area dot point (a sibling part's words do not count)
            on = [p for p in q['parts'] if 'S2-12-068' in [t.get('id') for t in (p.get('t24') or [])] + [d[0] for v in (p.get('tagd') or {}).values() for d in v.get('dp', [])]]
            x['ch'] = 'Finding a side or angle' if AREA_GIVEN_RE.search(' '.join([q.get('stem') or ''] + [p.get('latex') or '' for p in on])) else 'Finding the area'
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
        # owner 25 Nov, relaying the checker: "Question search is slow and capped. It took about 6-8 seconds ..." The first search used to
        # download every topic file (11 MB) to read the question text; the words it searches are written here once, in one small file
        t = ' '.join([q.get('stem') or ''] + [x for p in q['parts'] for x in [p.get('latex') or ''] + list(p.get('free') or []) + list(p.get('can_use') or [])])
        if t.strip(): srch[str(q['id'])] = t
    os.makedirs(OUT, exist_ok=True)
    for sl, qs in content.items():
        body = dump({'v': 3, 'topic': files[slugs[sl]]['k'], 'q': qs})
        files[slugs[sl]]['s'] = hashlib.sha256(body.encode()).hexdigest()[:12]   # the page fetches f?v=s: a changed file is a new address
        files[slugs[sl]]['n'] = len(qs)
        old = open(OUT + sl + '.json', encoding='utf-8').read() if os.path.exists(OUT + sl + '.json') else None
        if old != body: open(OUT + sl + '.json', 'w', encoding='utf-8').write(body)
    # CODE_HEALTH rule 4: a topic file no question uses any more is archived, and publish_set sends null for it once
    keep = {sl + '.json' for sl in content} | {os.path.basename(INDEX), os.path.basename(DETAILS), os.path.basename(SEARCH)}   # index.json (before job 2) is archived here and sent as null once
    for f in sorted(os.listdir(OUT)):
        if f.endswith('.json') and f not in keep:
            arch = P + 'archive/bank_split_unused/' + COURSE + '/'
            os.makedirs(arch, exist_ok=True); os.replace(OUT + f, arch + time.strftime('%Y%m%d%H%M%S_') + f)
            print('archived unused topic file', f)
    ip = set(img_packs())
    docs = {k: ({**d, 'ip': 1} if int(k) in ip else d) for k, d in bank['docs'].items()}
    idx = {'v': 3, 'built': bank.get('built'), 'counts': bank.get('counts'), 'src': src, 'course': COURSE, 'docs': docs, 'tables': bank['tables'], 'figs': {k: {kk: v for kk, v in f.items() if not (k in moved and kk in F_CONTENT)} for k, f in figs.items()},
           'codes17': bank.get('codes17', {}), 'files': files, 'questions': idx_q}
    idx['raw'] = write_gz(INDEX, idx)
    # search.gz.json {v, src, q: {id: the question's own words: stem, part text, free tags, can-use skills}}: read by the Bank's search
    # (07_bank.js bankHay); the index and the details add the QID, paper and dot-point words
    write_gz(SEARCH, {'v': 1, 'src': src, 'q': srch})
    idx['raw_details'] = write_gz(DETAILS, {'v': 1, 'src': src, 'q': details, 'sk': skill_gates_standard() if COURSE == 'standard' else skill_gates()})
    return idx


def main():
    src = P + 'site/data/bank.json'
    if '--check' in sys.argv:
        bad = stale()
        print('bank split ' + ('STALE or missing: run python3 tools/bank_split.py' if bad else 'ok'))
        sys.exit(1 if bad else 0)
    full = json.load(open(src, encoding='utf-8'))
    dc = doc_courses()
    # owner 23 Nov (Standard): a Standard paper's questions go to the Standard bank only; Advanced keeps the rest, as before
    def own(keep):   # the papers and the text of one side
        qs = [q for q in full['questions'] if keep(dc.get(str(q['doc'])))]
        return qs, {str(q['doc']) for q in qs}, dump(qs)
    def sub(keep):   # one course's questions and papers; figures and tables that clearly belong to the OTHER course are left out
        qs, ds, txt = own(keep)   # (23 Nov: the pilot's ~100 KB of figure entries had leaked into the Advanced start-up index)
        _, ods, otxt = own(lambda c: not keep(c))
        theirs = lambda k: (k.split('_')[0] in ods or (k in otxt and k not in txt)) and k.split('_')[0] not in ds
        return {**full, 'questions': qs, 'docs': {k: d for k, d in full['docs'].items() if keep(dc.get(str(k)))},
                'figs': {k: v for k, v in full['figs'].items() if not theirs(k)},
                'tables': {k: v for k, v in full['tables'].items() if not theirs(k)}}
    std = sub(lambda c: c == 'standard')
    if std['questions']:
        set_course('standard')
        si = split(std, homes(), hashlib.sha256(dump(std).encode()).hexdigest()[:16])
        print('bank split standard: %d questions, %d topic files' % (len(si['questions']), len(si['files'])))
        set_course('advanced')
    bank = sub(lambda c: c != 'standard') if std['questions'] else full
    idx = split(bank, homes(), src_hash(src))
    tot = sum(os.path.getsize(P + 'site/' + f['f']) for f in idx['files'])
    print('skill gates: %d skills gate on taught topics' % len(skill_gates()))
    print('bank split: index %d KB gzip (%d KB unpacked, %d questions), details %d KB gzip (%d KB unpacked), %d topic files %d KB (largest %d KB), bank.json %d KB' % (
        os.path.getsize(INDEX) // 1024, idx['raw'] // 1024, len(idx['questions']), os.path.getsize(DETAILS) // 1024, idx['raw_details'] // 1024, len(idx['files']), tot // 1024,
        max(os.path.getsize(P + 'site/' + f['f']) for f in idx['files']) // 1024, os.path.getsize(src) // 1024))


if __name__ == '__main__':
    main()
