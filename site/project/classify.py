"""Stage 0 classifier: cover text first, then filename, then folder. Writes questions.db documents table."""
import json, re, sqlite3, os, datetime
S = '/tmp/claude-0/-home-claude/800fc37d-9da1-531b-8789-51723586bf26/scratchpad/'
OUT = '/mnt/user-data/outputs/'

def norm(t): return ' '.join((t or '').split())

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

recs = [json.loads(l) for l in open(S + 'records.jsonl')]
allf = json.load(open(S + 'allfiles.json'))
pdfs = [f for f in allf if f['path'].lower().endswith('.pdf')]
excl1 = {f['path'] for f in json.load(open(S + 'excluded_path.json'))}
excl2 = set(json.load(open(S + 'excluded_name2.json')))
byp = {r['path']: r for r in recs}

os.makedirs(OUT, exist_ok=True)
db = sqlite3.connect(OUT + 'questions.db')
db.executescript(open(S + 'schema.sql').read())
now = datetime.datetime.now().isoformat(timespec='seconds')
rows = []
for f in pdfs:
    p = f['path']; name = p.split('/')[-1]; r = byp.get(p)
    row = dict(source_path=p, size_bytes=f['size'], sha256=None, page_count=None, has_text_layer=None,
               parse_path=None, course='unknown', year_level=None, task_type='unknown', school=None, year=None,
               classification_method=None, provenance_method=None, status='discovered', bundled_solutions=0,
               syllabus_version=None, natural_key=None, failure_reason=None, cover_excerpt=None)
    if r is None:
        # filtered by explicit path/filename course or year signal before any cover read
        c = course_from(p) or 'unknown'; yl = year_level_from(p)
        row.update(course=c, year_level=yl, classification_method='inferred', status='excluded',
                   failure_reason='path/filename names a non-target course or year (not cover-checked)')
    else:
        cover = norm(r.get('p1'))
        common = {'the','and','of','to','a','in','for','is','on','be','marks','questions','question','time','section','minutes','answer','use','all','write','student','number','mathematics','examination','working','reading','general','instructions','total','attempt','pen','calculators','approved','may','used','provided','sheet','this','paper','school','trial','higher','certificate','year','task','assessment','solutions','name','teacher','allow','about','show','relevant','reference','black','blue','multiple','choice'}
        toks = re.findall(r'[a-z]+', cover.lower())
        hit = sum(t in common for t in toks) / max(1, len(toks))
        garbled = bool(r.get('has_text_layer')) and len(toks) > 20 and hit < 0.08
        has_text = int(bool(r.get('has_text_layer')) and not garbled)
        row.update(sha256=r.get('sha256'), page_count=r.get('pages'), has_text_layer=has_text,
                   parse_path='digital' if has_text else 'scan', cover_excerpt=cover[:400])
        row['garbled'] = garbled
        cc = course_from(cover[:900]) if cover else None
        cn = course_from(name + ' ' + p)
        yl_c = year_level_from(cover[:900]) if cover else None
        yl_n = year_level_from(name + ' ' + p)
        if cc:
            row['course'] = cc; row['classification_method'] = 'explicit_cover'
        else:
            row['course'] = 'unknown'; row['classification_method'] = 'inferred'
            row['inferred_course'] = cn
        row['year_level'] = yl_c or yl_n
        row['task_type'] = task_type_from(cover, name)
        row['bundled_solutions'] = int(bool(re.search(r'\bw\.?\s*solu|with solu|w\s+solns|and sol|& solu|and solutions|w/ ?solu', name, re.I)))
        y, ym = year_from(cover, name, p); row['year'] = y
        s, sm = school_from(cover, name, p); row['school'] = s
        row['provenance_method'] = ym or sm
        if y and y < 2020 and row['course'] in ('advanced', 'unknown'):
            row['syllabus_version'] = 'pre2017'   # old 2 Unit course, last HSC 2019
        elif y:
            row['syllabus_version'] = '2017'
        # status
        target = row['course'] == 'advanced' and row['year_level'] == 12
        if row['task_type'] in ('other',):
            row['status'] = 'excluded'; row['failure_reason'] = 'not a question paper'
        elif row['course'] in ('ext1', 'ext2', 'standard') or row['year_level'] in (10, 11):
            row['status'] = 'excluded'; row['failure_reason'] = 'non-target course/year (cover)' if cc or yl_c else 'non-target course/year (name)'
        elif row['course'] == 'unknown' or row['year_level'] is None or row['task_type'] == 'unknown':
            row['status'] = 'discovered'; row['failure_reason'] = 'review queue: ' + ', '.join(
                k for k, v in (('course', row['course'] == 'unknown'), ('year_level', row['year_level'] is None), ('task_type', row['task_type'] == 'unknown')) if v)
        else:
            row['status'] = 'discovered'
        if row['task_type'] == 'hsc' and row['year']:
            row['natural_key'] = f"hsc|{row['year']}|{row['course']}"
        elif row['school'] and row['year']:
            row['natural_key'] = f"{row['task_type']}|{row['year']}|{row['school'].lower()}|{row['course']}"
    rows.append(row)

cols = ['source_path','size_bytes','sha256','page_count','has_text_layer','parse_path','course','year_level','task_type','school','year',
        'classification_method','provenance_method','status','bundled_solutions','syllabus_version','natural_key','failure_reason','cover_excerpt']
db.execute('DELETE FROM documents')
for r in rows:
    db.execute(f"INSERT INTO documents ({','.join(cols)}, ingested_at) VALUES ({','.join('?'*len(cols))}, ?)", [r.get(c) for c in cols] + [now])
db.commit()
json.dump(rows, open(S + 'classified.json', 'w'))
print('rows', len(rows))
