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

# The naming rules (SCHOOL, SETTER_OK, SETTER_ASK, ALIASES, school_of, year_of, task_of, kind_of) moved verbatim to
# tools/classify_paths.py on 13 Nov, so tools/scan_folder.py and tools/inventory.py name papers the same way.
import sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classify_paths import SCHOOL, SETTER_OK, SETTER_ASK, ALIASES, school_of, year_of, task_of, kind_of

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
