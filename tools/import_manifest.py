"""Build the import list for the remaining Year 12 Advanced papers (owner, 11 Nov: "get ready to import the rest").

Groups every discovered Year 12 Advanced / unknown-course PDF into papers: one question file plus its solutions
(bundled or a separate file), with the naming fields the owner requires (year, formal school name or approved setter,
task AT1-AT4 with Trials = AT4, or HSC). Marks what is already loaded, duplicated, out of scope, or needs a decision.
Output: work/import/import_manifest.csv and a printed summary.
"""
import csv, re, os, sqlite3, collections, json

P = '/home/claude/pilot/'
OUT = P + 'work/import/'
os.makedirs(OUT, exist_ok=True)
rows = [r for r in csv.DictReader(open(P + 'site/project/stage0_manifest.csv'))
        if r['status'] == 'discovered' and r['year_level'] == '12' and r['course'] in ('advanced', 'unknown')]
db = sqlite3.connect('/mnt/user-data/outputs/questions.db')
loaded = {r[0] for r in db.execute('select source_path from documents where id in (select distinct document_id from questions)')}

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

papers = collections.OrderedDict()
for r in rows:
    key = (year_of(r), school_of(r), task_of(r))
    papers.setdefault(key, []).append(r)

out = []
for (y, s, t), files in papers.items():
    kinds = collections.Counter(kind_of(f) for f in files)
    qfiles = [f for f in files if kind_of(f) in ('questions', 'combined')]
    sfiles = [f for f in files if kind_of(f) in ('solutions', 'combined')]
    pages = sum(int(f['page_count'] or 0) for f in qfiles[:1] + [x for x in sfiles if kind_of(x) == 'solutions'][:1])
    scans = any(f['parse_path'] == 'scan' for f in qfiles[:1])
    status, note = 'import', ''
    if any(f['source_path'] in loaded for f in files): status, note = 'already loaded', ''
    elif y and y < 2019: status, note = 'excluded', 'before 2019 (old 2 Unit syllabus): excluded for now'
    elif re.search(r'12ME|\bExt(ension)? ?1\b|\bMX1\b', ' '.join(os.path.basename(f['source_path']) for f in files)): status, note = 'excluded', 'Extension 1 paper'
    elif not qfiles: status, note = 'no question paper', 'solutions only: question paper not found'
    elif len(qfiles) > 1 and len({f['sha256'] for f in qfiles if f['sha256']}) == 1: note = 'identical copies: one kept'
    elif len(qfiles) > 1: note = f'{len(qfiles)} question files: check they are the same paper'
    if status == 'import':
        if s in SETTER_ASK or s.endswith('?') or s == '?': status = 'needs decision'; note = (note + '; ' if note else '') + f'setter/school "{s}" not approved yet'
        elif t == '?': status = 'needs decision'; note = (note + '; ' if note else '') + 'task number not found'
    label = f'{y} NESA HSC' if t == 'HSC' else f'{y} {s} {t}'
    out.append(dict(label=label, year=y, school=s, task=t, status=status, note=note, scan='scan' if scans else 'digital',
                    has_solutions='yes' if sfiles else 'no', pages=pages, files=' | '.join(f['source_path'] for f in files)))

for y, mg in ((2026, None), (2025, 'src/hsc/2025-hsc-maths-adv-mg.pdf'), (2024, 'src/hsc/2024-hsc-maths-adv-mg.pdf')):
    q = {2024: 'src/hsc/2024-hsc-maths-adv.pdf', 2025: 'src/hsc/2025-hsc-maths-advanced.pdf', 2026: 'src/hsc/2026-hsc-maths-advanced.pdf'}[y]
    out.append(dict(label=f'{y} NESA HSC', year=y, school='NESA', task='HSC', status='import',
                    note='uploaded by owner 11 Nov' + ('' if mg else '; marking guidelines not released yet: solutions to be written and approved'),
                    scan='digital', has_solutions='yes' if mg else 'no', pages={2024: 68, 2025: 74, 2026: 48}[y], files=' | '.join(x for x in (q, mg) if x)))
out.sort(key=lambda r: (r['status'] != 'import', r['status'], r['task'] != 'HSC', -(r['year'] or 0), r['label']))   # HSC papers first, then newest
with open(OUT + 'import_manifest.csv', 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(out[0])); w.writeheader(); w.writerows(out)
c = collections.Counter(r['status'] for r in out)
imp = [r for r in out if r['status'] == 'import']
print(json.dumps(dict(papers=len(out), by_status=c, import_pages=sum(r['pages'] for r in imp),
                      import_scans=sum(r['scan'] == 'scan' for r in imp), import_without_solutions=sum(r['has_solutions'] == 'no' for r in imp),
                      by_task=collections.Counter(r['task'] for r in imp), by_year=collections.Counter(r['year'] for r in imp)), indent=1))
