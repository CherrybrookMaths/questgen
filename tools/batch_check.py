"""End-of-batch checks (owner 12 Nov: "have you learnt lots about importing ... is that logged somewhere?" -> "yeah").
Run after every import batch and before every publish:   python3 tools/batch_check.py
After publishing, record what went out:                  python3 tools/batch_check.py --mark-published
Each check exists because the mistake really happened; IMPORT_PLAYBOOK.md says when.
Exit code 1 if any BLOCKER, so it can gate a publish."""
import json, glob, os, re, sqlite3, hashlib, sys, time
# 13 Nov: the repo root this copy of the tools lives in, so a check run in a git worktree checks that worktree, not the main
# checkout (it used to be hard-coded to /home/claude/pilot/, and worktree gates silently reported the main page's test result).
P = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + '/'
DB = '/mnt/user-data/outputs/questions.db'
MAN = P + 'work/published_manifest.json'
db = sqlite3.connect(DB); db.row_factory = sqlite3.Row
blockers, warns, infos = [], [], []
def B(m): blockers.append(m)
def W(m): warns.append(m)
def I(m): infos.append(m)
def mt(p): return os.path.getmtime(p) if os.path.exists(p) else 0
def sha(p):
    if p.endswith('data/bank.json'):   # ignore the build timestamp: only content changes need a publish
        d = json.load(open(p)); d.pop('built', None); return hashlib.sha256(json.dumps(d, sort_keys=True).encode()).hexdigest()
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()

if '--mark-published' in sys.argv:
    # project/ too, so tools/publish_set.py can list exactly what changed (reviewer 14 Nov). Stage 2, 15 Nov: the same file
    # list as publish_set.publishable() (excludes data/focus/), so a path removed with null drops out of the manifest.
    sys.path.insert(0, P + 'tools'); import publish_set as _ps
    files = {r: sha(P + 'site/' + r) for r in _ps.publishable()}
    json.dump(dict(at=time.strftime('%Y-%m-%d %H:%M'), files=files), open(MAN, 'w'), indent=0)
    print('recorded', len(files), 'published files')
    # version control (stage 1, 15 Nov; owner: "I don't want to have to do that"): commit everything, tag publish-vNNN,
    # refresh the Drive bundle. tools/snapshot.py only warns on a git problem; this guard keeps a crash from blocking too.
    try:
        import subprocess
        subprocess.run([sys.executable, P + 'tools/snapshot.py'] + [a for a in sys.argv[1:] if a.startswith('--version') or a.isdigit()], timeout=600)
    except Exception as e: print('  WARN    snapshot not taken:', e)
    sys.exit(0)

allr = {r['id'] for r in json.load(open(P + 'tikz/all_results.json'))}

# 1. Redraws made but never merged (12 Nov: 17 Knox AT2 / Normanhurst redraws sat in result_b5_*.json; 9 questions vanished)
recrop = {x['id'] for x in json.load(open(P + 'work/crop_fixes.json'))} if os.path.exists(P + 'work/crop_fixes.json') else set()
unmerged = {}
for f in glob.glob(P + 'tikz/result_*.json'):
    try: d = json.load(open(f))
    except Exception: W(f'unreadable redraw result file {os.path.basename(f)}'); continue
    for r in (d.get('results') or d.get('figures') or []) if isinstance(d, dict) else d:
        if r.get('id') and r['id'] not in allr: unmerged.setdefault(os.path.basename(f), []).append(r['id'])
for f, ids in unmerged.items():
    B(f'{len(ids)} redraws in tikz/{f} never merged (apply_diagrams.py): {", ".join(ids[:8])}{" ..." if len(ids) > 8 else ""}')

# 2. Figures with no redraw at all -> question stays 'pending', invisible in every queue
nofig = [(r['question_id'], os.path.basename(r['png_path'])[:-4]) for r in db.execute('select question_id, png_path from figures where png_path is not null')
         if os.path.basename(r['png_path'])[:-4] not in allr]
if nofig: B(f'{len(nofig)} figures have no redraw result, so their questions are hidden: ' + ', '.join(f'Q{q}:{k}' for q, k in nofig[:10]))
# 2b. merged redraw without a compiled SVG -> "Redraw missing" on the page
_st = {r['id']: r.get('status') for r in json.load(open(P + 'tikz/all_results.json'))}
nosvg = [k for k in allr if _st.get(k) in ('ok', 'approx') and not os.path.exists(P + f'tikz/svg/{k}.svg') and not os.path.exists(P + f'tikz/png/{k}.png')]
if nosvg: W(f'{len(nosvg)} redraws have no compiled SVG/PNG (tikz_render.sh): {", ".join(sorted(nosvg)[:8])}')

# 3. Triage state
tri = json.load(open(P + 'work/triage.json'))
pend = [k for k, v in tri.items() if v['tier'] == 'pending']
if pend: B(f'{len(pend)} questions are triage "pending" (no queue shows them): {", ".join(pend[:12])}')
ti = json.load(open(P + 'work/triage_inputs.json')) if os.path.exists(P + 'work/triage_inputs.json') else {}
if ti.get('db_sha') != sha(DB): W('the database changed since triage.py last ran: re-run tools/triage.py')
inputs = [P + 'tikz/all_results.json'] + glob.glob(P + 'work/*/verify_out_*.json')
newest = max(inputs, key=mt)
if mt(newest) > mt(P + 'work/triage.json') + 1: W(f'triage.json is older than {os.path.relpath(newest, P) if newest.startswith(P) else newest}: re-run tools/triage.py')
if not os.path.exists(P + 'work/sample_locked.json'): W('work/sample_locked.json missing: a re-triage could reshuffle spot-checks the owner already reviewed')
qids = {r['id'] for r in db.execute('select id from questions')}
untri = [q for q in qids if str(q) not in tri]
if untri: I(f'{len(untri)} questions have no triage entry (pilot questions predate triage; new imports must have one)')

# 4. Bank build freshness
if max(mt(P + 'work/triage.json'), mt(DB), mt(P + 'tikz/all_results.json')) > mt(P + 'site/data/bank.json') + 1:
    W('site/data/bank.json is older than the database / triage / redraws: run tools/build_bank.py')

# 5. Unpublished local changes (12 Nov: bank.json republished but svg packs not -> "Redraw missing")
if os.path.exists(MAN):
    man = json.load(open(MAN))
    cur = {os.path.relpath(f, P + 'site'): f for f in glob.glob(P + 'site/data/**/*.json', recursive=True) + [P + 'site/review.html'] + [f for f in glob.glob(P + 'site/vendor/**/*', recursive=True) if os.path.isfile(f)]}
    sys.path.insert(0, P + 'tools'); import publish_set as _ps
    cur = {k: f for k, f in cur.items() if not k.startswith(_ps.EXCLUDE)}
    changed = sorted(k for k, f in cur.items() if man['files'].get(k) != sha(f))
    gone = _ps.removals(man)   # stage 2, 15 Nov: published before, gone now -> the next publish must send them as null
    if gone: W(f'{len(gone)} published files no longer exist locally; the next publish removes them (null in python3 tools/publish_set.py --json): ' + ', '.join(gone[:5]) + (' ...' if len(gone) > 5 else ''))
    if changed: W(f'{len(changed)} files changed since the last publish ({man["at"]}); publish ALL of them in one call: ' + ', '.join(changed[:15]))
else: I('no published manifest yet: run with --mark-published after the next publish')

# 6. Tables: words in maths italics (12 Nov "why are some words in the table italicised randomly?")
FN = {'sin', 'cos', 'tan', 'log', 'exp', 'sec', 'cot', 'frac', 'dfrac', 'text', 'textit', 'textbf', 'mathrm', 'sqrt', 'left', 'right', 'int', 'displaystyle',
      'pi', 'theta', 'alpha', 'times', 'cdot', 'approx', 'infty', 'quad', 'qquad', 'diag', 'overline', 'mathbf', 'dots', 'ldots', 'leq', 'geq', 'neq'}
ital, stray, caps = [], [], 0
for t in db.execute('select id, rows_json, caption from data_tables'):
    for row in json.loads(t['rows_json'] or '[]'):
        for c in row:
            s = re.sub(r'\\(text|textit|textbf|mathrm)\{[^}]*\}', '', str(c)); s2 = re.sub(r'\\[a-zA-Z]+', '', s)
            if any(w.lower() not in FN for w in re.findall(r'[A-Za-z]{3,}', s2)): ital.append(t['id'])
            if re.search(r'\[\d+(\.\d+)?(ex|em|pt)\]', str(c)): stray.append(t['id'])   # 12 Nov: "there is a [2ex] in one of the cells"
            if re.search(r'(?<!\\)%', str(c)): stray.append(t['id'])   # % starts a TeX comment inside $..$
    if t['caption'] and not re.match(r'stem-and-leaf', t['caption'], re.I): caps += 1
if ital: B(f'{len(set(ital))} tables have words outside \\text{{}} (render italic): {", ".join(sorted(set(ital))[:10])}')
if stray: B(f'{len(set(stray))} tables have stray TeX spacing or bare % in a cell: {", ".join(sorted(set(stray))[:10])}')
if caps: I(f'{caps} tables show a caption: keep only captions printed on the paper (owner check pending)')

# 7. Tags and home topic
nohome = db.execute("select count(*) from questions where home_topic is null or home_topic=''").fetchone()[0] if 'home_topic' in [c[1] for c in db.execute('pragma table_info(questions)')] else None
if nohome: W(f'{nohome} questions have no home topic in the database: export homes from the page (homes.js) after tagging')
notag = db.execute("select count(*) from parts p where not exists (select 1 from tags t where t.part_id = p.id) and not exists (select 1 from parts c where c.parent_part_id = p.id)").fetchone()[0]
if notag: W(f'{notag} answerable parts have no tag (lead-in parts are fine): run the tagger on them')

# --- database integrity and page-database mirror (owner 14 Nov: "ok fix these issues") ---
try:
    import importlib.util, sqlite3 as _sq, datetime as _dt
    _sp = importlib.util.spec_from_file_location('integrity', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'integrity.py'))
    _ig = importlib.util.module_from_spec(_sp); _sp.loader.exec_module(_ig)
    _db = _sq.connect('/mnt/user-data/outputs/questions.db')
    for lv, m in _ig.check(_db): (B if lv == 'blocker' else W)('integrity: ' + m)
    _ps = dict(_db.execute('SELECT collection, synced_at FROM page_sync').fetchall()) if _db.execute("SELECT 1 FROM sqlite_master WHERE name='page_sync'").fetchone() else {}
    for c in ['reviews', 'difficulty', 'exams', 'reports']:
        t = _ps.get(c)
        if not t: W(f'page database: {c} never mirrored into questions.db: export it and run tools/sync_pagedb.py')
        elif (_dt.datetime.now() - _dt.datetime.fromisoformat(t)).total_seconds() > 86400: W(f'page database: {c} last mirrored {t}: export and run tools/sync_pagedb.py')
except Exception as e:
    W(f'integrity check could not run: {e}')
# --- question keys (Fix 2; owner 14 Nov: "Ok we should run Fix 1 and 2"): every review / difficulty / exam / report key in the
# page mirror (page_* tables, tools/sync_pagedb.py) must name a live question; bank.json keys must equal question_keys ---
try:
    sys.path.insert(0, P + "tools"); import qkeys as _qk
    _kdb = sqlite3.connect('file:%s?mode=ro' % os.environ.get('QG_DB', DB), uri=True)
    for lv, m in _qk.check(_kdb, json.load(open(P + 'site/data/bank.json'))): {'blocker': B, 'warn': W}.get(lv, I)('keys: ' + m)
except Exception as e:
    B(f'question key check could not run: {e}')
# --- self-hosted libraries and fonts (hardening action 3, 14 Nov): site/vendor/ must match tools/vendor_manifest.json ---
try:
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
    import vendor as _vendor
    for m in _vendor.check(quiet=True)[:10]: B('vendor: ' + m + ' (python3 tools/vendor.py --check)')
except Exception as e:
    B(f'vendor check could not run: {e}')
# --- grouped data packs (stage 2, 15 Nov): no per-paper svg/cmp files left, every group present, page PACK_G = tools/packs.py ---
try:
    import packs as _packs
    for m in _packs.check(): B('packs: ' + m)
except Exception as e:
    B(f'packs check could not run: {e}')
# --- automated page test (hardening action 1, 14 Nov): tools/page_test.js must have passed on THIS build of the page ---
# Run it with: bash tools/prepublish.sh (build, page test, this check) or node tools/page_test.js. Its result file records the
# sha256 of the page and data it tested; a failed, partial (--quick), missing or stale result blocks the publish.
try:
    _pt = P + 'work/page_test/last_result.json'
    _page = P + 'site/review.html'
    if not os.path.exists(_pt):
        B('page test: never run (bash tools/prepublish.sh, or node tools/page_test.js)')
    else:
        _r = json.load(open(_pt)); _t = _r.get('tested', {})
        _now = {'page': sha(_page), 'bank': hashlib.sha256(open(P + 'site/data/bank.json', 'rb').read()).hexdigest(),
                'dotpoints': hashlib.sha256(open(P + 'site/data/dotpoints.json', 'rb').read()).hexdigest()}
        _stale = [k for k in _now if _t.get(k) != _now[k]]
        if not _r.get('ok'):
            _f = [c['name'] for c in _r.get('checks', []) if not c.get('ok')]
            B(f'page test FAILED {_r.get("at", "")[:16]}: {len(_f)} check(s): {"; ".join(_f[:6])}{" ..." if len(_f) > 6 else ""}'
              + (f' (stopped early: {str(_r.get("fatal"))[:120]})' if _r.get('fatal') else '') + ' (work/page_test/last_result.json, screenshots in work/page_test/shots/)')
        elif _r.get('quick'):
            B('page test: the last run was --quick (no exports, no dark theme): run the full test: node tools/page_test.js')
        elif _stale:
            B(f'page test is stale: {", ".join("site/review.html" if k == "page" else f"site/data/{k}.json" for k in _stale)} changed since it ran: run node tools/page_test.js')
        elif mt(_pt) < mt(_page):
            B('page test is older than site/review.html: run node tools/page_test.js')
        else:
            I(f'page test passed {_r.get("at", "")[:16]}: {_r.get("passed")} checks in {_r.get("seconds")} s')
except Exception as e:
    B(f'page test result could not be read: {e}')
# folder inventory (owner 13 Nov: "see what we actually haven't ingested yet"): site/data/inventory.json must match documents
try:
    _iv = json.load(open(P + 'site/data/inventory.json'))
    _nd = db.execute('select count(*) from documents').fetchone()[0]
    _nq = db.execute('select count(distinct document_id) from questions').fetchone()[0]
    sys.path.insert(0, P + 'tools'); from classify_paths import RULES as _rules
    if (_iv.get('docs'), _iv.get('docs_with_questions')) != (_nd, _nq):
        W(f'site/data/inventory.json is stale ({_iv.get("docs")} files, {_iv.get("docs_with_questions")} with questions; the database has {_nd}, {_nq}): run python3 tools/inventory.py')
    # the page's Rescan drive classifies new Drive files with the rules copied into the inventory (CODE_HEALTH rule 3)
    elif _iv.get('rules') != json.loads(json.dumps(_rules)):
        B('site/data/inventory.json carries other path rules than tools/classify_paths.py RULES: run python3 tools/inventory.py')
    # 13 Nov: the recorded files live in a separate file the page fetches for Rescan drive only (CODE_HEALTH rule 6)
    elif 'files' in _iv or not os.path.exists(P + 'site/' + str(_iv.get('files_url'))):
        B('site/data/inventory.json must name data/inventory_files.json (files_url) and not carry the files itself: run python3 tools/inventory.py')
    elif len(json.load(open(P + 'site/' + _iv['files_url'])).get('f', [])) != _nd:
        W(f'{_iv["files_url"]} is stale (not one entry per documents row): run python3 tools/inventory.py')
    else:
        # owner 13 Nov: "so can we sync the number on the bank and the processes pls": Processes › Papers says N imported,
        # the Bank says N papers. They must agree (a paper filed twice is hidden whole by build_bank.py).
        _bq = json.load(open(P + 'site/data/bank.json'))['questions']
        _bp = len({q['doc'] for q in _bq if not q.get('dup_of')})
        if _bp != _iv['totals']['imported']:
            W(f'the Bank shows {_bp} papers but Processes › Papers says {_iv["totals"]["imported"]} imported: check for a paper filed twice (build_bank.py) or run python3 tools/inventory.py')
        I(f'inventory: {_iv["totals"]["papers"]} papers ({_iv["totals"]["imported"]} imported, {_iv["totals"]["waiting"]} waiting); last folder scan {(_iv.get("last_scan") or {}).get("at", "none yet")}')
except FileNotFoundError: W('site/data/inventory.json missing: run python3 tools/inventory.py (Processes > Papers)')
except Exception as e: W(f'inventory check failed: {e}')
# size budget (CODE_HEALTH rule 6; health pass 13 Nov, owner: "keep the code proper and [lean]"): page, bank, inventory and
# the whole published set against tools/size_budget.json (set at size + 25%). Over budget BLOCKS until the owner agrees and
# the budget is raised there with his words in "agreed".
try:
    _sb = json.load(open(P + 'tools/size_budget.json'))['budgets']
    sys.path.insert(0, P + 'tools'); import publish_set as _ps
    _sz = {k: os.path.getsize(P + 'site/' + k) for k in _sb if k != 'published total' and os.path.exists(P + 'site/' + k)}
    _sz['published total'] = sum(os.path.getsize(P + 'site/' + r) for r in _ps.publishable())
    _mb = lambda n: f'{n / 2**20:.1f} MB' if n >= 2**20 else f'{n / 1024:.0f} KB'
    _over = [k for k in _sb if _sz.get(k, 0) > _sb[k]['bytes']]
    for k in _over: B(f'size budget: {k} is {_mb(_sz[k])}, over its {_mb(_sb[k]["bytes"])} budget (CODE_HEALTH rule 6): shrink it, or ask the owner and raise the budget in tools/size_budget.json')
    I('size budget: ' + ', '.join(f'{k} {_mb(_sz.get(k, 0))} of {_mb(_sb[k]["bytes"])} ({100 * _sz.get(k, 0) / _sb[k]["bytes"]:.0f}%)' for k in _sb))
except Exception as e: B(f'size budget check could not run: {e}')
# version control (stage 1, 15 Nov): never a blocker; --mark-published commits and tags automatically (tools/snapshot.py)
try:
    import subprocess
    if not os.path.isdir(P + '.git'): W('no git repository: version snapshots are off (RESUME.md "Version control")')
    else:
        _tags = subprocess.run(['git', '-C', P, 'tag', '--list', '--sort=-creatordate'], capture_output=True, text=True, timeout=60).stdout.split()
        I(f'version control: last tag {_tags[0] if _tags else "none"}; the next --mark-published commits and tags automatically')
except Exception as e: W(f'git state could not be read: {e}')
print(f'batch_check {time.strftime("%Y-%m-%d %H:%M")}: {len(blockers)} blocker(s), {len(warns)} warning(s)')
for m in blockers: print('  BLOCKER', m)
for m in warns: print('  WARN   ', m)
for m in infos: print('  info   ', m)
sys.exit(1 if blockers else 0)
