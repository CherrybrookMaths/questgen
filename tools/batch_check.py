"""End-of-batch checks (owner 12 Nov: "have you learnt lots about importing ... is that logged somewhere?" -> "yeah").
Run after every import batch and before every publish:   python3 tools/batch_check.py
After publishing, record what went out:                  python3 tools/batch_check.py --mark-published
Each check exists because the mistake really happened; IMPORT_PLAYBOOK.md says when.
Exit code 1 if any BLOCKER, so it can gate a publish."""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import json, glob, os, re, sqlite3, hashlib, sys, time
# 13 Nov: the repo root this copy of the tools lives in, so a check run in a git worktree checks that worktree, not the main
# checkout (it used to be hard-coded to the first sandbox's path, and worktree gates silently reported the main page's test result).
P = paths.P
DB = paths.DBS
MAN = paths.S + 'work/published_manifest.json'
db = sqlite3.connect(DB); db.row_factory = sqlite3.Row
blockers, warns, infos = [], [], []
def B(m): blockers.append(m)
def W(m): warns.append(m)
def I(m): infos.append(m)
def mt(p): return os.path.getmtime(p) if os.path.exists(p) else 0
sys.path.insert(0, P + 'tools')
def sha(p):   # one copy, in publish_set.py (job 2: it also reads the gzip bank index and details)
    import publish_set; return publish_set.sha(p)

if '--mark-published' in sys.argv:
    # project/ too, so tools/publish_set.py can list exactly what changed (reviewer 14 Nov). Stage 2, 15 Nov: the same file
    # list as publish_set.publishable() (excludes data/focus/), so a path removed with null drops out of the manifest.
    sys.path.insert(0, P + 'tools'); import publish_set as _ps
    files = {r: sha(P + 'site/' + r) for r in _ps.publishable()}
    json.dump(dict(at=time.strftime('%Y-%m-%d %H:%M'), files=files), open(MAN, 'w'), indent=0)
    print('recorded', len(files), 'published files')
    open(P + 'work/synced_publish.txt', 'w').write(json.load(open(MAN))['at'])   # this checkout is the live page now (fetch_published.SYNC)
    # version control (stage 1, 15 Nov; owner: "I don't want to have to do that"): commit everything, tag publish-vNNN,
    # refresh the Drive bundle. tools/snapshot.py only warns on a git problem; this guard keeps a crash from blocking too.
    try:
        import subprocess
        subprocess.run([sys.executable, P + 'tools/snapshot.py'] + [a for a in sys.argv[1:] if a.startswith('--version') or a.isdigit()], timeout=600)
    except Exception as e: print('  WARN    snapshot not taken:', e)
    sys.exit(0)

allr = {r['id'] for r in json.load(open(paths.S + 'tikz/all_results.json'))}

# 1. Redraws made but never merged (12 Nov: 17 Knox AT2 / Normanhurst redraws sat in result_b5_*.json; 9 questions vanished)
recrop = {x['id'] for x in json.load(open(paths.S + 'work/crop_fixes.json'))} if os.path.exists(paths.S + 'work/crop_fixes.json') else set()
unmerged = {}
import import_hold as _hold0; _HELD0 = {str(d) for d in _hold0.held_docs()}   # papers mid-import: their redraws merge before the release
for f in glob.glob(P + 'tikz/result_*.json'):
    try: d = json.load(open(f))
    except Exception: W(f'unreadable redraw result file {os.path.basename(f)}'); continue
    for r in (d.get('results') or d.get('figures') or []) if isinstance(d, dict) else d:
        if r.get('id') and r['id'] not in allr and not str(r['id']).split('_')[0] in _HELD0: unmerged.setdefault(os.path.basename(f), []).append(r['id'])
for f, ids in unmerged.items():
    B(f'{len(ids)} redraws in tikz/{f} never merged (apply_diagrams.py): {", ".join(ids[:8])}{" ..." if len(ids) > 8 else ""}')

# 1z. owner 18 Nov ("is the auto attach z score table working?"): a question that points to a z-score / probability table it does not print
# must be listed in state/work/ztable.json, or the exam maker never attaches the table (2 Batch 10 questions and 1 older one were missed)
try:
    _zt = json.load(open(paths.S + 'work/ztable.json'))
    _zre = re.compile(r'(z\W{0,3}scores? table|probability table|table of z|standard normal table)[^.]{0,80}(back of|provided|on page|attached|end of)', re.I)
    _zmiss = []
    for _q in json.load(open(P + 'site/data/bank.json'))['questions']:
        _t = json.dumps([_q.get('stem')] + [p.get('text') or p.get('latex') for p in _q.get('parts', [])])
        if _zre.search(_t) and '\\extable' not in _t and _q.get('key') not in _zt: _zmiss.append(_q.get('key'))
    if _zmiss: B(f'{len(_zmiss)} question(s) point to a z-score table at the back but are not in state/work/ztable.json, so the exam maker never attaches it: {", ".join(_zmiss[:8])}')
except Exception as _e: W(f'z-table reference check failed: {_e}')
# 2. Figures with no redraw at all -> question stays 'pending', invisible in every queue
import import_hold as _hold   # owner 18 Nov: papers mid-import (tools/import_hold.py) are skipped; their import is not finished
_HELD = _hold.held_docs()
nofig = [(r['question_id'], os.path.basename(r['png_path'])[:-4]) for r in db.execute('select f.question_id, f.png_path, q.document_id from figures f join questions q on q.id=f.question_id where f.png_path is not null')
         if os.path.basename(r['png_path'])[:-4] not in allr and r['document_id'] not in _HELD]
# a bank built with QG_WITH_HELD=1 (the import's own steps: homes, difficulty) must never be published
try: _hb = sorted({int(q['doc']) for q in json.load(open(P + 'site/data/bank.json'))['questions']} & set(_HELD))
except Exception as _e: _hb = []; W(f'held-paper check could not read site/data/bank.json: {_e}')
if _hb: B(f'the bank holds {len(_hb)} paper(s) that are still held mid-import ({_hb}): it was built with QG_WITH_HELD=1; run python3 tools/build_bank.py again (or release the batch)')
if _HELD: I(f'import hold: {len(_HELD)} paper(s) mid-import are left out of the bank and the publish: {sorted(_HELD)}')
if nofig: B(f'{len(nofig)} figures have no redraw result, so their questions are hidden: ' + ', '.join(f'Q{q}:{k}' for q, k in nofig[:10]))
# 2b. merged redraw without a compiled SVG -> "Redraw missing" on the page
_st = {r['id']: r.get('status') for r in json.load(open(paths.S + 'tikz/all_results.json'))}
nosvg = [k for k in allr if _st.get(k) in ('ok', 'approx') and not os.path.exists(P + f'tikz/svg/{k}.svg') and not os.path.exists(P + f'tikz/png/{k}.png')]
if nosvg: W(f'{len(nosvg)} redraws have no compiled SVG/PNG (tikz_render.sh): {", ".join(sorted(nosvg)[:8])}')

# 3. Triage state
tri = json.load(open(paths.S + 'work/triage.json'))
pend = [k for k, v in tri.items() if v['tier'] == 'pending']
if pend: B(f'{len(pend)} questions are triage "pending" (no queue shows them): {", ".join(pend[:12])}')
ti = json.load(open(paths.S + 'work/triage_inputs.json')) if os.path.exists(paths.S + 'work/triage_inputs.json') else {}
if ti.get('db_sha') != sha(DB): W('the database changed since triage.py last ran: re-run tools/triage.py')
inputs = [paths.S + 'tikz/all_results.json'] + glob.glob(paths.S + 'work/*/verify_out_*.json')
newest = max(inputs, key=mt)
if mt(newest) > mt(paths.S + 'work/triage.json') + 1: W(f'triage.json is older than {os.path.relpath(newest, P) if newest.startswith(P) else newest}: re-run tools/triage.py')
if not os.path.exists(paths.S + 'work/sample_locked.json'): W('work/sample_locked.json missing: a re-triage could reshuffle spot-checks the owner already reviewed')
qids = {r['id'] for r in db.execute('select id from questions')}
untri = [q for q in qids if str(q) not in tri]
if untri: I(f'{len(untri)} questions have no triage entry (pilot questions predate triage; new imports must have one)')

# 4. Bank build freshness
if max(mt(paths.S + 'work/triage.json'), mt(DB), mt(paths.S + 'tikz/all_results.json')) > mt(P + 'site/data/bank.json') + 1:
    W('site/data/bank.json is older than the database / triage / redraws: run tools/build_bank.py')

# 4z. owner 19 Nov ("fix the second problem you just raised"): the live page was last published by ANOTHER session (the manifest in git is
# newer than this checkout's last publish or sync), so files here may be older copies of what it changed; publishing would undo its work
if os.path.exists(MAN):
    _at = json.load(open(MAN))['at']
    _sy = open(P + 'work/synced_publish.txt').read().strip() if os.path.exists(P + 'work/synced_publish.txt') else ''
    if _sy != _at: B(f'the live page was last published at {_at} from another session; this checkout last published or synced at {_sy or "never"}: '
                     'run python3 tools/fetch_published.py --verify (and the Artifact reads it asks for; --archive-removed for packs the live page dropped)')
# 5. Unpublished local changes (12 Nov: bank.json republished but svg packs not -> "Redraw missing")
if os.path.exists(MAN):
    man = json.load(open(MAN))
    cur = {os.path.relpath(f, P + 'site'): f for f in glob.glob(P + 'site/data/**/*.json', recursive=True) + [P + 'site/review.html'] + [f for f in glob.glob(P + 'site/vendor/**/*', recursive=True) if os.path.isfile(f)]}
    sys.path.insert(0, P + 'tools'); import publish_set as _ps
    cur = {k: f for k, f in cur.items() if not k.startswith(_ps.EXCLUDE)}
    # a pack served from the asset store (data/assets.json) is current when its bytes match the uploaded copy (16 Nov: 43 packs
    # were reported "changed" because the manifest does not list them; asset_upload_plan.py re-uploads one that differs)
    try: _as = json.load(open(P + 'site/data/assets.json')).get('assets') or {}
    except (OSError, ValueError): _as = {}
    stale_assets = sorted(k for k, f in cur.items() if k in _as and _as[k].get('sha256') != sha(f))
    if stale_assets: W(f'{len(stale_assets)} asset-store pack(s) differ from the uploaded copy: re-upload (tools/asset_upload_plan.py, then tools/asset_manifest.py): ' + ', '.join(stale_assets[:8]))
    cur = {k: f for k, f in cur.items() if k not in _as}
    changed = sorted(k for k, f in cur.items() if man['files'].get(k) != sha(f))
    gone = _ps.removals(man)   # stage 2, 15 Nov: published before, gone now -> the next publish must send them as null
    # 17 Nov: image files are not in git, so a fresh session (every night run) starts without them and the publish would delete
    # them from the live page. A removal of a page-image, overlay, cover-picture or redraw pack is only allowed when it was
    # archived on purpose (tools/image_lifecycle.py: archive/img_cleared/); anything else blocks until it is fetched back
    # (python3 tools/fetch_published.py, CLAUDE.md "Fresh session" step 5).
    unexplained = [g for g in gone if g.startswith(('data/img/', 'data/cmp/', 'data/check/', 'data/svg/', 'data/crop/'))
                   and not os.path.exists(P + 'archive/img_cleared/' + os.path.basename(g))]
    if unexplained: B(f'{len(unexplained)} published image file(s) are missing here and the next publish would DELETE them from the live page: '
                      + ', '.join(unexplained[:5]) + ' ... fetch them first: python3 tools/fetch_published.py (then the Artifact read it prints)')
    gone = [g for g in gone if g not in unexplained]
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
    _db = _sq.connect(paths.DBS)
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
    # job 3: the asset store takes at most 20 MiB per file; warn early so GROUPS in tools/packs.py is raised in time
    # (tools/image_lifecycle.py regroups automatically when the number changes)
    for _k in ('svg', 'crop'):
        _big = [(f, os.path.getsize(P + f'site/data/{_k}/' + f)) for f in os.listdir(P + f'site/data/{_k}/') if f.endswith('.json')] if os.path.isdir(P + f'site/data/{_k}/') else []
        _big = [x for x in _big if x[1] > 15 * 2**20]
        if _big: W(f'packs: {_k} group(s) over 15 MiB of the asset store\'s 20 MiB per file: {_big[:3]}: raise GROUPS[{_k!r}] in tools/packs.py')
    # night runs 19-20 Nov: a build in a fresh clone wrote the diagram packs as {} (fixed in build_bank.py 21 Nov); never publish or
    # upload a pack that lost redraws: every redraw the bank lists (status ok/approx) must have its picture in its group
    _bk = json.load(open(P + 'site/data/bank.json'))
    _want = {k for k, f in (_bk.get('figs') or {}).items() if f.get('status') in ('ok', 'approx')}
    _have = set()
    for _f in glob.glob(P + 'site/data/svg/g*.json'):
        _have |= set(json.load(open(_f)))
    _lost = sorted(_want - _have)
    if _lost: B(f'packs: {len(_lost)} redrawn diagram(s) missing from the data/svg packs (e.g. {_lost[:3]}): rebuild with the live packs in place (tools/fetch_published.py --place-assets), never upload these')
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
        # Fix 1 (14 Nov): the page loads the split bank (data/bank/<course>/): same digest as page_test.js `tested.index`
        _bf = sorted(os.path.join(d, f) for d, _, fs in os.walk(P + 'site/data/bank') for f in fs)
        _now['index'] = hashlib.sha256('\n'.join(os.path.relpath(f, P + 'site') + ':' + hashlib.sha256(open(f, 'rb').read()).hexdigest() for f in _bf).encode()).hexdigest()
        _stale = [k for k in _now if _t.get(k) != _now[k]]
        if not _r.get('ok'):
            _f = [c['name'] for c in _r.get('checks', []) if not c.get('ok')]
            B(f'page test FAILED {_r.get("at", "")[:16]}: {len(_f)} check(s): {"; ".join(_f[:6])}{" ..." if len(_f) > 6 else ""}'
              + (f' (stopped early: {str(_r.get("fatal"))[:120]})' if _r.get('fatal') else '') + ' (work/page_test/last_result.json, screenshots in work/page_test/shots/)')
        elif _r.get('quick'):
            B('page test: the last run was --quick (no exports, no dark theme): run the full test: node tools/page_test.js')
        elif _stale:
            B(f'page test is stale: {", ".join("site/review.html" if k == "page" else "site/data/bank/" if k == "index" else f"site/data/{k}.json" for k in _stale)} changed since it ran: run node tools/page_test.js')
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
    sys.path.insert(0, P + 'tools'); from classify_paths import active_rules as _ar; _rules = _ar()   # 14 Nov lanes block below: RULES + RULES_PROPOSED once accepted
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
        I(f'inventory: {_iv["totals"]["papers"]} papers ({_iv["totals"]["imported"]} imported, {_iv["totals"].get("ready_current", 0) + _iv["totals"].get("ready_old", 0)} ready); last folder scan {(_iv.get("last_scan") or {}).get("at", "none yet")}')
except FileNotFoundError: W('site/data/inventory.json missing: run python3 tools/inventory.py (Processes > Papers)')
except Exception as e: W(f'inventory check failed: {e}')
# ======== Processes › Papers lanes (14 Nov, import-lanes round; owner: "there seems to be some inconsistencies in paper numbers") ========
# One status per paper: the statuses add up to the folder total (per group and overall); the lanes' batches hold every ready
# paper exactly once, and the papers ready in the lanes equal the summary's "ready to import" (tools/inventory.py, tools/batches.py).
try:
    _iv = json.load(open(P + 'site/data/inventory.json'))
    sys.path.insert(0, P + 'tools'); from inventory import STATUSES as _ST
    _bad = [f'{g["course"]}|{g["yl"]}' for g in _iv['groups'] if sum(g['counts'].get(k, 0) for k in _ST) != g['counts']['papers'] or len(g['papers']) != g['counts']['papers']]
    _sum = sum(_iv['totals'].get(k, 0) for k in _ST)
    if _bad or _sum != _iv['totals']['papers']:
        B(f'inventory statuses do not add up: {_sum} papers by status vs {_iv["totals"]["papers"]} in the folder; groups {", ".join(_bad) or "ok"}: run python3 tools/inventory.py')
    _st = {p['id']: (g['course'], g['yl'], p['st']) for g in _iv['groups'] for p in g['papers']}
    _ready = {i for i, (c, y, s) in _st.items() if s in ('ready_current', 'ready_old')}
    _inl = [i for L in _iv.get('lanes') or [] for b in L['batches'] for i in b if _st.get(i, ('', '', ''))[2] in ('ready_current', 'ready_old') and _st[i][:2] == (L['course'], L['yl'])]
    if len(_inl) != len(set(_inl)): B('a ready paper sits in two lane batches (tools/batches.py): rebuild work/batches.json')
    # owner 18 Nov: big PDFs (inventory big, over 10 MB) are ready but kept out of the batches; Processes shows them apart
    _big = {p['id'] for g in _iv['groups'] for p in g['papers'] if p.get('big')}
    if set(_inl) & _big: B(f'{len(set(_inl) & _big)} big PDF(s) sit in a lane batch: run python3 tools/inventory.py (tools/batches.py moves them out)')
    _ready -= _big
    if set(_inl) != _ready:
        B(f'lane counts differ from the summary: {len(set(_inl))} ready papers in lane batches, {len(_ready)} ready in the summary: run python3 tools/inventory.py (it assigns new ready papers to batches)')
    else: I(f'lanes: {len(_ready)} ready papers (+{len(_big)} big PDFs for later) in {sum(len(L["batches"]) for L in _iv.get("lanes") or [])} batches; statuses add up to {_iv["totals"]["papers"]} papers')
except Exception as e: W(f'lanes check failed: {e}')
# ======== end of the lanes block ========
# owner 16 Nov: "duplicate exams will never be batched and imported right?" A recorded copy (duplicate_file, "copy of document <id>")
# is in no paper's files and no lane batch: tools/inventory.py keeps it out; this blocks a build where one got back in.
try:
    import inventory as _INV
    _cp = {r[0] for r in db.execute("SELECT id FROM documents WHERE status='duplicate_file' AND failure_reason LIKE '%copy of document %'")}
    _fi = _INV.build(sqlite3.connect('file:%s?mode=ro' % os.environ.get('QG_DB', DB), uri=True), files=True)
    _in = sorted({i for g in _fi['groups'] for p in g['papers'] for i in p['f']} & _cp)
    _lb = sorted({i for L in json.load(open(P + 'site/data/inventory.json')).get('lanes') or [] for b in L['batches'] for i in b} & _cp)
    _ss = _INV.same_size_copies(sqlite3.connect('file:%s?mode=ro' % os.environ.get('QG_DB', DB), uri=True), _fi)
    if _ss: B(f'{len(_ss)} file(s) share a paper with an identical file (same size): record them as copies (scan_folder.py --apply does; first: {_ss[:3]})')
    if _in or _lb: B(f'recorded copies sit in a paper ({_in[:5]}) or a lane batch ({_lb[:5]}): a copy must never be imported (tools/inventory.py copy_of)')
    else: I(f'copies: {len(_cp)} recorded, none in a paper or a batch')
except Exception as e: W(f'copies check failed: {e}')
# owner 14 Nov: Needs a check page pictures (tools/check_pages.py): every pack data/check_pages.json lists exists at its sha256
try:
    _cm = json.load(open(P + 'site/data/check_pages.json')).get('papers') or {}
    _bad = [k for k, e in _cm.items() if not os.path.exists(P + 'site/' + e['path']) or hashlib.sha256(open(P + 'site/' + e['path'], 'rb').read()).hexdigest() != e.get('sha256')]
    if _bad: B(f'data/check_pages.json lists {len(_bad)} page-picture pack(s) missing or changed ({", ".join(_bad[:5])}): rerun python3 tools/check_pages.py for them')
    else: I(f'check pages: {len(_cm)} papers have cover + question page pictures')
except FileNotFoundError: W('site/data/check_pages.json missing (the Needs a check page-picture manifest): write {"v": 1, "papers": {}}')
except Exception as e: W(f'check pages check failed: {e}')
# size budget (CODE_HEALTH rule 6; health pass 13 Nov, owner: "keep the code proper and [lean]"). Since Fix 1 (owner 14 Nov:
# "Ok we should run Fix 1 and 2"; plan: keep the published page small; fetch data only when needed) the budget is what the page
# loads at start: review.html + the course index + data/assets.json, each and together ("start load"). Over budget BLOCKS until
# owner 18 Nov: "If i'ts not a HARD limit, you're allowed to exceed AS LONG as all the code and comments we've built so far is
# necessary and efficient, not bloated." (CODE_HEALTH rule 3: raise after a bloat pass, recorded in "agreed")
# the owner agrees and the budget is raised in tools/size_budget.json with his words in "agreed". Everything fetched only when
# needed (topic files, image packs, the old bank.json) and the whole published set are reported as info, never blocking.
try:
    _sbj = json.load(open(P + 'tools/size_budget.json')); _sb = _sbj['budgets']
    sys.path.insert(0, P + 'tools'); import publish_set as _ps
    _mb = lambda n: f'{n / 2**20:.1f} MB' if n >= 2**20 else f'{n / 1024:.0f} KB'
    _sz = {k: os.path.getsize(P + 'site/' + k) for k in _sb if 'parts' not in _sb[k] and os.path.exists(P + 'site/' + k)}
    for k in _sb:
        if 'parts' in _sb[k]: _sz[k] = sum(os.path.getsize(P + 'site/' + x) for x in _sb[k]['parts'] if os.path.exists(P + 'site/' + x))
    for k in _sb:
        if 'parts' not in _sb[k] and k not in _sz: B(f'size budget: site/{k} is missing (python3 tools/bank_split.py / tools/asset_manifest.py --init)')
    _over = [k for k in _sb if _sz.get(k, 0) > _sb[k]['bytes']]
    # owner 19 Nov: "We can go past the limit if its not hard, that was just a giuode before, if features are optimal and not bloat, we can
    # go past the limit": over budget is a warning; the round's report says why the growth is needed (hard platform limits stay blockers)
    for k in _over: W(f'size budget: {k} is {_mb(_sz[k])}, over its {_mb(_sb[k]["bytes"])} guide (CODE_HEALTH rule 6): fine if the new code is needed and lean; say so in the report')
    I('size budget (start load): ' + ', '.join(f'{k} {_mb(_sz.get(k, 0))} of {_mb(_sb[k]["bytes"])} ({100 * _sz.get(k, 0) / _sb[k]["bytes"]:.0f}%)' for k in _sb))
    # job 2 (owner 16 Nov: "Yeah build it"): the target is 538 papers (tools/asset_upload_plan.py TARGET_PAPERS). Straight-line
    # projection from today's papers; the details file is not in the start load but must stay under the platform's 16 MB per file.
    try:
        import bank_split as _bs0
        _np = len({q['doc'] for q in _bs0.read_gz(_bs0.INDEX)['questions']}) or 1
        _ix, _dt = os.path.getsize(_bs0.INDEX), os.path.getsize(_bs0.DETAILS)
        _k = next(k for k in _sb if k.endswith('/index.gz.json'))
        _p538 = _ix / _np * 538
        (I if _p538 <= _sb[_k]['bytes'] else W)(f'bank index at 538 papers (from {_np} today): about {_mb(_p538)} of its {_mb(_sb[_k]["bytes"])} budget; details file about {_mb(_dt / _np * 538)} (platform limit 16 MB per file)')
    except Exception as e: W(f'bank index projection could not run: {e}')
    _pub = _ps.publishable(); _tf = [r for r in _pub if r.startswith('data/bank/') and not r.endswith('.gz.json')]   # topic files (not the index and details)
    I(f'size (info, loaded only when needed): published total {_mb(sum(os.path.getsize(P + "site/" + r) for r in _pub))} in {len(_pub)} files '
      f'(limit per version 256 MB, 511 files); {len(_tf)} topic files {_mb(sum(os.path.getsize(P + "site/" + r) for r in _tf))}'
      + (f', largest {_mb(max(os.path.getsize(P + "site/" + r) for r in _tf))}' if _tf else '')
      + (f'; data/bank.json {_mb(os.path.getsize(P + "site/data/bank.json"))} (no longer read by the page)' if 'data/bank.json' in _pub else ''))
    import bank_split as _bs, asset_manifest as _am
    if _bs.stale():
        B('the split bank (site/data/bank/) is missing or was split from a different site/data/bank.json: run python3 tools/bank_split.py')
    if not os.path.exists(_am.MAN): B('site/data/assets.json is missing (the page reads it at start): run python3 tools/asset_manifest.py --init')
    else:
        _st = _am.stale(_am.load())
        for _p, _why in _st[:5]: B(f'asset store: {_p} {_why} (or python3 tools/asset_manifest.py --prune to fall back to the published file)')
        _n = len(_am.load()['assets'])
        I(f'asset store: {_n} image pack(s) served from data/assets.json addresses' + (' (the page must be published with capabilities {"assets": {}})' if _n else ', none yet: every image pack is a published file'))
except Exception as e: B(f'size budget check could not run: {e}')
# published diagram sources (14 Nov): site/project/tikz_sources.json + examstyle.tex.txt must equal state/tikz (tools/tikz_sources.py)
try:
    import tikz_sources as _tz
    _bad = _tz.check()
    if _bad: B(f'site/project/tikz_sources.json differs from state/tikz in {len(_bad)} entr{"y" if len(_bad) == 1 else "ies"} ({", ".join(_bad[:5])}): run python3 tools/tikz_sources.py')
except Exception as e: B(f'tikz sources check could not run: {e}')
# portable checkout (14 Nov, move to a fresh cloud session at another path): no tool may hard-code a machine path. Locations come
# from tools/paths.py (ROOT from the file's own location, $QG_DB, $QG_OUT, $QG_SCRATCH); JS/sh derive the root from their own
# location. paths.py is the one file allowed to name the old sandbox outputs folder (as a fallback when it exists).
try:
    _abs = re.compile('|'.join(re.escape(x) for x in ('/home/' + 'claude', '/mnt/' + 'user-data', '/tmp/' + 'claude-', '/root/' + '.claude')))
    _hits = []
    for _d in ('tools', 'page_src'):
        for _dp, _dn, _fn in os.walk(P + _d):
            _dn[:] = [x for x in _dn if x not in ('__pycache__', 'node_modules')]
            for _f in _fn:
                _fp = os.path.join(_dp, _f)
                if os.path.relpath(_fp, P) == 'tools/paths.py' or not _f.endswith(('.py', '.js', '.sh', '.json', '.css', '.html', '.txt')): continue
                for _i, _l in enumerate(open(_fp, encoding='utf-8', errors='replace'), 1):
                    if _abs.search(_l): _hits.append(f'{os.path.relpath(_fp, P)}:{_i}')
    if _hits: B(f'{len(_hits)} hard-coded machine path(s) in tools/ or page_src/ (use tools/paths.py, or derive the root from the file\'s location): {", ".join(_hits[:8])}{" ..." if len(_hits) > 8 else ""}')
except Exception as e: B(f'machine-path check could not run: {e}')
# z-score table at the back (checker 18 Nov: "No z-table at the back"): every key in state/work/ztable.json must reach the bank as q.zt
try:
    _zt = json.load(open(paths.S + 'work/ztable.json')) if os.path.exists(paths.S + 'work/ztable.json') else {}
    _bq = json.load(open(P + 'site/data/bank.json'))['questions']
    _have = {q.get('key') for q in _bq if q.get('zt')}
    _miss = [k for k in _zt if k not in _have and any(q.get('key') == k for q in _bq)]
    if _miss: B(f'{len(_miss)} question(s) marked for the z-score table at the back are not marked in bank.json (rebuild with tools/build_bank.py): {", ".join(_miss[:5])}')
    else: I(f'z-score table: {len(_have)} question(s) get the table at the back of an exam')
except Exception as e: W(f'z-score table check could not run: {e}')
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
