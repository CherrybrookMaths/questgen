#!/usr/bin/env python3
"""Run one import batch through the API, step by step, stopping at the first step that fails.

Replaces the 23 Nov night's work/imp_1123n/run_batch.sh (untracked), which carried on silently after its split step crashed
(FileNotFoundError: work/b16/split_in.json, because work/b16 did not exist). Same order as IMPORT_PLAYBOOK "Import through the API",
with the copy check first (owner 23 Nov: "yes I do want c as well."): a paper that is a copy of a bank paper is recorded as a copy
and left out before any API spend (tools/copy_check.py).

  TZ=Australia/Sydney python3 tools/run_batch.py <batch> <doc id> [...] [--from STEP] [--to STEP] [--difficulty-export DIR] [--workers N]
  python3 tools/run_batch.py --steps        list the steps

Every step's output goes to work/<batch>/logs/<step>.log and its start and end to work/<batch>/logs/times.txt. A step that exits
non-zero (or a parallel step of the three text steps) stops the run with "STOP at <step>" and the end of its log; fix it, then
resume with --from <step> (the copy check is not repeated on a resume: its KEEP list is in state/work/import/copy_check/<batch>.json).
--difficulty-export: the page db `difficulty` export for tools/apply_difficulty_reviews.py (without it, the page_difficulty mirror).
The Processes tab (page db progress/queue, progress/jobs) is still updated by the session (CLAUDE.md), not by this driver.
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import argparse, datetime, glob, json, os, subprocess, sys

PY = sys.executable
T = 'tools/'


def steps(b, ids, a):
    """[(name, [commands])]: commands in one step run in parallel; each command is an argv list (or a callable for globbed args)."""
    D = ','.join(map(str, ids))
    W = ['--workers', str(a.workers)]
    diag = lambda: sorted(glob.glob(str(paths.ROOT / 'tikz' / f'result_{b}_*.json')))
    return [
        ('hold', [[PY, T + 'import_hold.py', 'hold', b, *map(str, ids)]]),
        ('parse', [[PY, T + 'api_import.py', 'parse', b, *map(str, ids), *W]]),
        ('load', [[PY, T + 'load.py', *map(str, ids)], ]),
        ('post_load', [[PY, T + 'post_load.py', *map(str, ids)]]),
        ('exam_name', [[PY, T + 'exam_name.py']]),
        ('split_prep', [[PY, T + 'split_batch.py', 'prep', b, *map(str, ids)]]),
        ('split', [[PY, T + 'api_import.py', 'split', b, *W]]),
        ('split_apply', [[PY, T + 'split_batch.py', 'apply', b]]),
        ('relabel', [[PY, T + 'relabel_split.py']]),
        ('prep_batch', [[PY, T + 'prep_batch.py', b, *map(str, ids)]]),
        ('text', [[PY, T + 'api_import.py', s, b, *W] for s in ('tag', 'solfmt', 'gen')]),   # tag + solutions in parallel
        ('apply_text', [[PY, T + 'apply_text.py', b]]),
        ('add_to_bank', [[PY, T + 'add_to_bank.py', *map(str, ids)]]),
        ('build_held', [[PY, T + 'build_bank.py']]),            # QG_WITH_HELD=1 (IMPORT_PLAYBOOK "import hold"): the later steps read the bank
        ('difficulty', [[PY, T + 'api_import.py', 'difficulty', b, '--docs', D, *W]]),
        ('difficulty_apply', [[PY, T + 'api_import.py', 'difficulty-apply', b]]),
        ('difficulty_reviews', [[PY, T + 'apply_difficulty_reviews.py', *([a.difficulty_export] if a.difficulty_export else [])]]),
        ('diagrams', [[PY, T + 'api_import.py', 'diagrams', b, *W]]),
        ('apply_diagrams', [lambda: [PY, T + 'apply_diagrams.py', *diag()] if diag() else None]),
        ('prep_verify', [[PY, T + 'prep_verify.py', b, *map(str, ids)]]),
        ('verify', [[PY, T + 'api_import.py', 'verify', b, *W]]),
        ('cost', [[PY, T + 'api_import.py', 'cost', b]]),
    ]


STEP_NAMES = ['copy_check'] + [n for n, _ in steps('b', [0], argparse.Namespace(workers=1, difficulty_export=None))]


def stamp():
    from zoneinfo import ZoneInfo   # CLAUDE.md: times from the clock, Sydney time
    return datetime.datetime.now(ZoneInfo('Australia/Sydney')).isoformat(timespec='seconds')


def stop(step, code, logs):
    print(f'\nSTOP at {step} (exit {code}). Nothing after it ran. End of the log:')
    for lg in logs:
        lines = open(lg, errors='replace').read().splitlines()
        print(f'--- {os.path.relpath(lg, paths.ROOT)} (last 15 lines)'); print('\n'.join(lines[-15:]))
    print(f'\nFix it, then resume: python3 tools/run_batch.py {A.batch} {" ".join(map(str, A.ids))} --from {step}')
    sys.exit(code or 1)


def run_step(name, cmds, L):
    env = {**os.environ, 'TZ': 'Australia/Sydney', **({'QG_WITH_HELD': '1'} if name == 'build_held' else {})}
    procs, logs = [], []
    for k, cmd in enumerate(cmds):
        if callable(cmd): cmd = cmd()
        if cmd is None: print(f'  {name}: nothing to do'); continue
        lg = L + (f'{name}.log' if len(cmds) == 1 else f'{name}_{cmd[3]}.log')
        logs.append(lg)
        f = open(lg, 'a'); f.write(f'### {stamp()} {" ".join(cmd)}\n'); f.flush()
        procs.append((subprocess.Popen(cmd, cwd=paths.ROOT, env=env, stdout=f, stderr=subprocess.STDOUT), lg, f))
    bad = []
    for p, lg, f in procs:
        p.wait(); f.close()
        if p.returncode: bad.append((p.returncode, lg))
    if bad: stop(name, bad[0][0], [lg for _, lg in bad])


def copy_check(L):
    """Copy check first; returns the doc ids to import."""
    lg = L + 'copy_check.log'
    with open(lg, 'a') as f:
        r = subprocess.run([PY, T + 'copy_check.py', 'check', A.batch, *map(str, A.ids), '--apply'], cwd=paths.ROOT,
                           env={**os.environ, 'TZ': 'Australia/Sydney'}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        f.write(r.stdout)
    print(r.stdout.rstrip())
    if r.returncode: stop('copy_check', r.returncode, [lg])
    keep = next((l.split()[1:] for l in r.stdout.splitlines() if l.startswith('KEEP:')), None)
    if keep is None: stop('copy_check', 1, [lg])
    if 'copies recorded' in r.stdout:   # takes them out of their lane batch and lists them under Copies (tools/batches.py)
        run_step('inventory', [[PY, T + 'inventory.py']], L)
    return [int(x) for x in keep]


def kept_ids():
    f = paths.S + f'work/import/copy_check/{A.batch}.json'
    if not os.path.exists(f): sys.exit(f'STOP: no copy check for {A.batch} ({f}): run without --from first')
    rep = json.load(open(f))
    return [r['doc'] for r in rep['papers'] if r['doc'] in A.ids and r['verdict'] != 'copy']


def main():
    global A
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('batch', nargs='?'); ap.add_argument('ids', nargs='*', type=int)
    ap.add_argument('--from', dest='frm', choices=STEP_NAMES); ap.add_argument('--to', choices=STEP_NAMES)
    ap.add_argument('--difficulty-export'); ap.add_argument('--workers', type=int, default=9); ap.add_argument('--steps', action='store_true')
    A = ap.parse_args()
    if A.steps: print('\n'.join(STEP_NAMES)); return
    if not A.batch or not A.ids: ap.error('batch and doc ids are required')
    os.makedirs(paths.WORK / A.batch, exist_ok=True)     # 23 Nov: split_batch.py prep crashed because work/<batch> did not exist
    L = str(paths.WORK / A.batch / 'logs') + '/'; os.makedirs(L, exist_ok=True)
    tl = open(L + 'times.txt', 'a')
    first = STEP_NAMES.index(A.frm) if A.frm else 0
    last = STEP_NAMES.index(A.to) if A.to else len(STEP_NAMES) - 1
    if first == 0:
        tl.write(f'copy_check_start {stamp()}\n'); tl.flush()
        ids = copy_check(L)
        tl.write(f'copy_check_end {stamp()}\n'); tl.flush()
    else:
        ids = kept_ids()
    if not ids: print('no paper left to import after the copy check'); return
    print(f'{A.batch}: importing {len(ids)} papers: {" ".join(map(str, ids))}')
    for n, (name, cmds) in enumerate(steps(A.batch, ids, A), start=1):
        if n < first or n > last: continue
        print(f'[{stamp()}] {name} ...', flush=True)
        tl.write(f'{name}_start {stamp()}\n'); tl.flush()
        run_step(name, cmds, L)
        tl.write(f'{name}_end {stamp()}\n'); tl.flush()
    print(f'[{stamp()}] done up to {STEP_NAMES[last]}. Next (in the session): fix the verifier findings (source_corrections.py), '
          'triage.py, add_to_bank.py, build_bank.py, render audit, recrop --check, prepublish (IMPORT_PLAYBOOK "Import through the API").')


if __name__ == '__main__':
    main()
