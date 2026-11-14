"""Where everything lives, for every tool (move to a fresh cloud session, 14 Nov).

The repo must run from any clone path (e.g. /home/user/questgen), not only /home/claude/pilot. Every tool takes its
locations from here; batch_check.py blocks hard-coded machine paths anywhere else in tools/ (this file is the one exception).

  ROOT     the repo root of THIS checkout (from this file's own location, so a git worktree checks itself)
  DB       questions.db: $QG_DB, else the old sandbox outputs copy if it exists, else <ROOT>/../questions.db
  OUT      bundles and exports: $QG_OUT, else the old sandbox outputs folder if it exists, else <ROOT>/../outputs
  STATE    <ROOT>/state: tracked state no tool can rebuild (import state, triage, verifier results, tikz sources, out/, ...).
           It mirrors the old paths: work/triage.json is now state/work/triage.json, tikz/tex/ is state/tikz/tex/.
  WORK     <ROOT>/work: untracked scratch (page test results, batch agent I/O, page renders), rebuilt as needed
  SRC      <ROOT>/src: exam PDFs (untracked; absent in a fresh clone until fetched from Drive)
  TIKZ     <ROOT>/tikz: untracked TikZ build outputs (build/, svg/, png/, cmp/, overlay/, hi/); sources are in STATE/tikz
  SCRATCH  $QG_SCRATCH, else <system temp>/questgen: throwaway files (e.g. the MathJax install for the render audit)

String forms with a trailing slash (P, S, W) keep the old `P + 'work/...'` style working.
"""
import os, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_SANDBOX_OUT = Path('/mnt/user-data/outputs')   # the first sandbox's outputs folder; only used when it exists


def _db():
    if os.environ.get('QG_DB'): return Path(os.environ['QG_DB'])
    if (_SANDBOX_OUT / 'questions.db').exists(): return _SANDBOX_OUT / 'questions.db'
    return ROOT.parent / 'questions.db'


def _out():
    if os.environ.get('QG_OUT'): return Path(os.environ['QG_OUT'])
    if _SANDBOX_OUT.is_dir(): return _SANDBOX_OUT
    return ROOT.parent / 'outputs'


DB = _db()
OUT = _out()
STATE = ROOT / 'state'
WORK = ROOT / 'work'
SRC = ROOT / 'src'
TIKZ = ROOT / 'tikz'
SCRATCH = Path(os.environ.get('QG_SCRATCH') or (Path(tempfile.gettempdir()) / 'questgen'))

P = str(ROOT) + '/'      # repo root, old style: P + 'site/data/bank.json'
S = str(STATE) + '/'     # state root:          S + 'work/triage.json', S + 'tikz/tex/'
W = str(WORK) + '/'
DBS = str(DB)


def state(rel):
    """Path of a state file by its old repo-relative path: state('work/triage.json') -> <ROOT>/state/work/triage.json."""
    return STATE / rel


def scratch(*parts):
    d = SCRATCH.joinpath(*parts); d.mkdir(parents=True, exist_ok=True); return d


def db(readonly=False):
    import sqlite3
    con = sqlite3.connect(f'file:{DB}?mode=ro', uri=True) if readonly else sqlite3.connect(str(DB))
    con.row_factory = sqlite3.Row
    return con


if __name__ == '__main__':
    import sys
    if '--sh' in sys.argv:   # for shell scripts: eval "$(python3 tools/paths.py --sh)"
        for k, v in dict(QG_ROOT=ROOT, QG_DB=DB, QG_OUT=OUT, QG_STATE=STATE, QG_WORK=WORK, QG_SRC=SRC, QG_TIKZ=TIKZ, QG_SCRATCH=SCRATCH).items():
            print(f"export {k}='{v}'")
    else:
        for k in ('ROOT', 'DB', 'OUT', 'STATE', 'WORK', 'SRC', 'TIKZ', 'SCRATCH'):
            v = globals()[k]; print(f'{k:8} {v}{"" if v.exists() else "   (missing)"}')
