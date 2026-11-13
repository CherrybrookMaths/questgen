"""Path and file-name rules for exam PDFs in the shared folder, in ONE place (owner 13 Nov: "New exams are gonna be added to
this folder periodically we need a way to ... see what we actually haven't ingested yet").

Two rule sets, both copied verbatim from the scripts that first used them, so a new file is judged exactly as the first
1,627 were:
  1. Stage-0 discovery (site/project/classify.py, 10 Nov): course_from, year_level_from, task_type_from, year_from,
     school_from, SCHOOLS, PROVIDERS. classify.py also read cover text; a file found by tools/scan_folder.py has no cover
     read yet, so classify_path() uses only the path and file name: the same calls classify.py made for the files it
     filtered by name before any cover read (course_from(path), year_level_from(path)) and its name-based fallbacks
     (task_type_from('', name), year_from('', name, path), school_from('', name, path)). Status follows classify.py's
     cover branch, with "(name)" reasons.
  2. Paper naming (tools/import_manifest.py, 11 Nov): SCHOOL, SETTER_OK, SETTER_ASK, ALIASES, school_of, year_of, task_of,
     kind_of. import_manifest.py now imports them from here (its output is unchanged: checked 13 Nov).
classify.py itself is kept as the historical record (it points at a scratchpad that no longer exists); do not edit it.

Self-test against the database: python3 tools/classify_paths.py --selftest
  every row stage 0 excluded by path/file name (1,184) must get the same course and year level from these rules.
"""
import os, re, sqlite3, sys

# ---------------------------------------------------------------- 1. stage-0 rules (verbatim from site/project/classify.py)

def course_from(text):
    t = text.lower()
    if re.search(r'ext(ension)?-2|maths-ext-2|extension\s*2|ext(ension)?\.?\s*ii\b|\b4\s?u(nit)?\b|\bx2\b', t): return 'ext2'
    if re.search(r'ext(ension)?-1|extension\s*1|ext(ension)?\.?\s*i\b|\b3\s?u(nit)?\b|\bx1\b', t): return 'ext1'
    if re.search(r'std-?2|standard-2|mathematics\s+standard|standard\s*2|standard\s*1|\bmathematics general\b|general mathematics|\bmst-?12\b', t): return 'standard'
    if re.search(r'mathematics\s+advanced|advanced\s+mathematics|maths\s+advanced|\bmath(s|ematics)?\s*adv\b|12matad|\badv\b|\b2\s?u(nit)?\b|2\s*unit', t): return 'advanced'
    return None

def year_level_from(text):
    t = text.lower()
    if re.search(r'year\s*10|\by10\b|stage\s*5', t): return 10
    if re.search(r'year\s*11|\by11\b|\byr\s*11\b|preliminary|prelim|\bp[13] adv\b', t): return 11
    if re.search(r'year\s*12|\by12\b|\byr\s*12\b|higher school certificate|\bhsc\b|trial', t): return 12
    return None

def task_type_from(cover, name):
    c, n = cover.lower(), name.lower()
    both = c[:600] + ' ' + n
    if re.search(r'research project|investigation|assignment|portfolio', both): return 'internal_other'
    # 'other' judged from filename only: NESA covers say "A reference sheet is provided", which must not trigger this
    if re.search(r'notification|marking[ +_-]+feedback|marker[ +_-]+feedback|mapping grid|\bmap\.pdf|answer sheet|mc sheet|reference sheet|information sheet|scope and sequence|revision|exam style|critical path problems|\bcrs-|^y12 (differentiation|integration|optimisation)', n): return 'other'
    if re.search(r'scope and sequence|assessment notification', c[:300]): return 'other'
    sol_name = re.search(r'solns?\b|solutions?|marking (guideline|criteria)|\bmg\b|_mg|-mg|sols\b|suggested solutions', n)
    with_sol = re.search(r'\bw\.?\s*solu|with solu|w\s+solns|and sol|& solu|exam w solu|and solutions', n)
    if sol_name and not with_sol: return 'solutions'
    if re.search(r'marking guidelines|marking criteria|suggested solutions|worked solutions', c[:400]) and not re.search(r'section i\b|general instructions', c[:800]): return 'solutions'
    if (re.search(r'nsw education standards authority|board of studies', c) and 'trial' not in c
            and not re.search(r'school|college|grammar|academy', c[:300])) or re.match(r'20\d\d-hsc-', n):
        return 'hsc'
    if re.search(r'trial', both) or re.search(r'\bat4\b|task 4|\bap4\b', both): return 'trial'
    if re.search(r'task|assessment|\bat\d|\bap\d|\bt\d\b|\bh\d\b|half.?yearly|yearly|exam|test|\bpt\d', both): return 'internal_exam'
    return 'unknown'

def year_from(cover, name, path):
    for src, meth in ((cover[:500], 'coverpage'), (name, 'filename'), (path, 'folder')):
        m = re.findall(r'\b(20[0-2]\d)\b', src)
        if m: return int(m[0]), meth
    return None, None

SCHOOLS = ['Abbotsleigh','Arden','Ascham','Baulkham Hills','Blacktown Boys','Caringbah','Cherrybrook','Epping Boys','Fort Street','Fort St','Girraween','Gosford','Grafton','Hornsby Girls','Hunters Hill','Hurlstone','James Ruse','Killara','Kings','Knox','Manly','Moorebank','Normanhurst','North Sydney Boys','North Sydney Girls','Oakhill','Penrith','Riverview','Ryde','St George','Sydney Boys','Sydney Girls','Sydney Grammar','Sydney Tech','Syd Girls','William Clarke','CTHS','CHHS','Castle Hill','MSB','Baulko']
PROVIDERS = ['CSSA','NEAP','WME','Western Mathematics','PEM','QATS','TEC','Trialmaths','Bookminders','ACE','MathsBank','TTA','Independent','Catholic','SmarterMaths']
def school_from(cover, name, path):
    for src, meth in ((cover[:600], 'coverpage'), (name, 'filename'), (path, 'folder')):
        for s in SCHOOLS + PROVIDERS:
            if re.search(r'\b' + re.escape(s) + r'\b', src, re.I): return s, meth
    return None, None

BUNDLED = r'\bw\.?\s*solu|with solu|w\s+solns|and sol|& solu|and solutions|w/ ?solu'

# 13 Nov (first Drive scan): ~900 PDFs uploaded that day follow one naming pattern, "<School> Yr12 MA 2026 AT4 w Solutions.pdf"
# ("MA" = Mathematics Advanced, the NESA course code), mostly in school folders the stage-0 lists do not name (Trinity Grammar,
# Pymble, Barker, ...). These fallbacks apply ONLY where the stage-0 rules above find nothing, so every path they already
# decide keeps its result (checked against all 1,631 recorded paths: tools/classify_paths.py --selftest).
MA_NAME = re.compile(r'(?:^|[\s_-])MA(?=[\s_-]|$)')              # the course code as its own word, upper case only
NEW_NAME = re.compile(r'^(?P<school>[A-Z][A-Za-z\'. -]*?) (?:Yr|Year) ?1[12] (?:MA|Adv)\b')
OLD_YEAR = re.compile(r'(?<!\d)(19[89]\d)(?!\d)')                # 1980s-1990s papers: the stage-0 year rule reads 2000-2029 only


def classify_path(p):
    """A documents row (without id) for a PDF found by name only. p = path relative to the shared folder root, '/' separators.
    Same decisions as stage 0 made without a cover: classification_method 'inferred', provenance 'filename' or 'folder'."""
    name = p.split('/')[-1]
    course = course_from(p) or 'unknown'
    yl = year_level_from(p)
    task = task_type_from('', name)
    y, ym = year_from('', name, p)
    s, sm = school_from('', name, p)
    # fallbacks for the 13 Nov naming pattern (see MA_NAME): only where the stage-0 rules found nothing
    if course == 'unknown' and MA_NAME.search(name): course = 'advanced'
    if not s:
        m = NEW_NAME.match(name)
        if m: s, sm = m.group('school').strip(), 'filename'
    if not y:
        m = OLD_YEAR.search(name)
        if m: y, ym = int(m.group(1)), 'filename'
    row = dict(source_path=p, course=course, year_level=yl, task_type=task, school=s, year=y,
               classification_method='inferred', provenance_method=ym or sm,
               bundled_solutions=int(bool(re.search(BUNDLED, name, re.I))), syllabus_version=None,
               natural_key=None, status='discovered', failure_reason=None)
    if y and y < 2020 and course in ('advanced', 'unknown'): row['syllabus_version'] = 'pre2017'   # old 2 Unit course, last HSC 2019
    elif y: row['syllabus_version'] = '2017'
    if task == 'other':
        row.update(status='excluded', failure_reason='not a question paper (name)')
    elif course in ('ext1', 'ext2', 'standard') or yl in (10, 11):
        row.update(status='excluded', failure_reason='non-target course/year (name)')
    elif course == 'unknown' or yl is None or task == 'unknown':
        row['failure_reason'] = 'review queue: ' + ', '.join(k for k, v in (('course', course == 'unknown'), ('year_level', yl is None), ('task_type', task == 'unknown')) if v)
    if task == 'hsc' and y: row['natural_key'] = f'hsc|{y}|{course}'
    elif s and y: row['natural_key'] = f'{task}|{y}|{s.lower()}|{course}'
    return row


# ---------------------------------------------------------------- 2. paper naming (verbatim from tools/import_manifest.py)

# formal names from the official NSW school list (project/nsw_schools.csv), keyed by the short names used in folders and file names
SCHOOL = {
    'Abbotsleigh': 'Abbotsleigh', 'Arden': 'Arden Anglican School, Epping campus', 'Baulkham Hills': 'Baulkham Hills High School',
    'CHHS': 'Castle Hill High School', 'CTHS': 'Cherrybrook Technology High School', 'Cherrybrook': 'Cherrybrook Technology High School',
    'Gosford': 'Gosford High School', 'Hornsby Girls': 'Hornsby Girls High School', 'Hunters Hill': 'Hunters Hill High School',
    'Hurlstone': 'Hurlstone Agricultural High School', 'James Ruse': 'James Ruse Agricultural High School', 'Kings': "The King's School",
    'Manly': 'Northern Beaches Secondary College Manly Campus', 'Normanhurst': 'Normanhurst Boys High School',
    'North Sydney Boys': 'North Sydney Boys High School', 'North Sydney Girls': 'North Sydney Girls High School', 'Penrith': 'Penrith High School',
    'St George': 'St George Girls High School', 'Sydney Boys': 'Sydney Boys High School', 'Sydney Girls': 'Sydney Girls High School',
    'Sydney Grammar': 'Sydney Grammar School', 'Ascham': 'Ascham School', 'Blacktown Boys': 'Blacktown Boys High School',
    'Caringbah': 'Caringbah High School', 'Killara': 'Killara High School', 'Knox': 'Knox Grammar School', 'Oakhill': 'Oakhill College',
    'Fort Street': 'Fort Street High School', 'Girraween': 'Girraween High School', 'Grafton': 'Grafton High School',
    'Moorebank': 'Moorebank High School', 'Ryde': 'Ryde Secondary College', 'Sydney Tech': 'Sydney Technical High School',
}
SETTER_OK = {'NESA', 'CSSA', 'Independent', 'NEAP', 'Western Mathematics', 'MathsBank', 'ACE', 'Bookminders', 'PEM', 'QATS', 'TEC', 'Trialmaths'}   # owner: "Commercial trial papers are fine"
SETTER_ASK = set()

ALIASES = dict(SCHOOL, **{'Sydney Technical': 'Sydney Technical High School', 'Sydney Technology': 'Sydney Technical High School',
    'Manly Selective': 'Northern Beaches Secondary College Manly Campus', 'Hornsby Girls': 'Hornsby Girls High School',
    'St George Girls': 'St George Girls High School', 'The Kings School': "The King's School", 'Fort Street': 'Fort Street High School'})
def school_of(r):
    s, p = r['school'], r['source_path']
    f = os.path.basename(p)
    for k in sorted(ALIASES, key=len, reverse=True):          # the file name is more reliable than the folder or old metadata
        if len(k) > 4 and re.search(r'\b' + re.escape(k), f): return ALIASES[k]
    if p.startswith('HSC 20') and not s and re.search(r'hsc-math|hsc-maths', p, re.I): return 'NESA'
    if s == 'Catholic': return 'CSSA'                               # "2021 12MATAd Catholic Trial": the Catholic Schools NSW (CSSA) trial; confirm on the cover at import
    if s in SETTER_OK or s in SETTER_ASK: return s
    if s in SCHOOL: return SCHOOL[s]
    if 'SSC' in p.split('/'): return '?'
    return s or '?'

def year_of(r):
    m = re.search(r'for (20\d\d) HSC', r['source_path'], re.I)   # owner: label by graduation year (a Term 4 AT1 belongs to the next year)
    if m: return int(m.group(1))
    if r['year'].isdigit(): return int(r['year'])
    m = re.search(r'(20\d\d|19\d\d)', r['source_path']); return int(m.group(1)) if m else None

def task_of(r):
    p = r['source_path']; f = p.lower()
    if r['task_type'] == 'hsc' or re.search(r'hsc-math', f): return 'HSC'
    if re.search(r'trial|at4|task ?4|ap4|_task4', f): return 'AT4'
    m = re.search(r'(?:at|task|ap)[ _]?([1-4])(?![0-9])', f) or re.search(r'/at([1-4])/', f) or re.search(r'\bh([1-4]) adv', f) or re.search(r'\bt([1-4])\b', f)
    if m: return 'AT' + m.group(1)
    if r['task_type'] == 'trial' or school_of(r) in SETTER_OK | SETTER_ASK | {'CSSA?'}: return 'AT4'   # commercial and association papers are trials
    return '?'

def kind_of(r):
    f = os.path.basename(r['source_path']).lower()
    if re.search(r'with solutions|w solutions|w solns|& solutions|and solutions', f): return 'combined'
    if r['task_type'] == 'solutions' or re.search(r'solution|solns|_mg\b|\bmg\b|marking|answers', f): return 'solutions'
    return 'questions'


def as_manifest_row(d):
    """A documents row (dict) in the string form the paper-naming rules expect (they were written for stage0_manifest.csv)."""
    return {'source_path': d['source_path'], 'school': d.get('school') or '', 'year': '' if d.get('year') is None else str(d['year']),
            'task_type': d.get('task_type') or ''}


# ---------------------------------------------------------------- self-test

def selftest(db_path='/mnt/user-data/outputs/questions.db'):
    db = sqlite3.connect('file:' + db_path + '?mode=ro', uri=True)
    # rows inserted by tools/scan_folder.py were classified by THESE rules (fallbacks included); test against stage-0 rows only
    stage0 = (" AND (ingested_at IS NULL OR ingested_at NOT IN (SELECT at FROM folder_scans))"
              if db.execute("SELECT 1 FROM sqlite_master WHERE name='folder_scans'").fetchone() else '')
    rows = db.execute("SELECT source_path, course, year_level FROM documents WHERE failure_reason LIKE 'path/filename names a non-target%'" + stage0).fetchall()
    bad = [(p, c, y, course_from(p) or 'unknown', year_level_from(p)) for p, c, y in rows if (course_from(p) or 'unknown', year_level_from(p)) != (c, y)]
    print(f'stage-0 path rules: {len(rows) - len(bad)} of {len(rows)} name-excluded rows reproduced')
    for b in bad[:10]: print('  differs:', b)
    # the name-based fallbacks: rows whose year/school came from the file name or folder (provenance filename|folder)
    rows = db.execute("SELECT source_path, year, provenance_method FROM documents WHERE provenance_method IN ('filename','folder') AND classification_method='inferred'" + stage0).fetchall()
    yb = [r for r in rows if r[1] is not None and year_from('', r[0].split('/')[-1], r[0])[0] != r[1]]
    print(f'stage-0 year rule (no cover): {len(rows) - len(yb)} of {len(rows)} reproduced' + (f'; {len(yb)} differ (year came from the cover text)' if yb else ''))
    # the 13 Nov fallbacks must not change any path the stage-0 rules already decide: for every recorded path, classify_path
    # with and without them must agree on every field the stage-0 rules set
    allp = [r[0] for r in db.execute('SELECT source_path FROM documents WHERE 1' + stage0)]
    changed = {p: d for p in allp if (d := _changed_by_fallbacks(p))}
    status = [p for p, d in changed.items() if set(d) & {'status', 'failure_reason'}]
    print(f'13 Nov fallbacks: {len(allp) - len(changed)} of {len(allp)} recorded paths classified exactly as before'
          + (f'; {len(changed)} only get a field the old rules left empty ({", ".join(sorted({k for d in changed.values() for k in d}))})' if changed else '')
          + f'; status changed for {len(status)}')
    for p in status[:10]: print('  status differs:', p)
    return not bad and not status


def _changed_by_fallbacks(p):
    """The fields the fallbacks change in classify_path(p), {} when none (they may only fill what the stage-0 rules left empty)."""
    global MA_NAME, NEW_NAME, OLD_YEAR
    keep = MA_NAME, NEW_NAME, OLD_YEAR
    never = re.compile(r'(?!x)x')
    MA_NAME = NEW_NAME = OLD_YEAR = never
    try: old = classify_path(p)
    finally: MA_NAME, NEW_NAME, OLD_YEAR = keep
    new = classify_path(p)
    return {k for k in new if new[k] != old[k]}


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(0 if selftest() else 1)
    for p in sys.argv[1:]:
        print(p, classify_path(p))
