"""Automatic version control for Questgen (stage 1, 15 Nov).
Owner: "would I have to manage version control? I don't want to have to do that." -> the owner never runs git; this does.

  python3 tools/snapshot.py                     commit everything + tag publish-vNNN (called by batch_check.py --mark-published)
  python3 tools/snapshot.py --version 205       same, with an explicit version number (default: highest vNNN tag + 1)
  python3 tools/snapshot.py --bundle            write <OUT>/questgen_repo.bundle (git bundle --all) for the Drive sync (OUT: tools/paths.py)
  python3 tools/snapshot.py --rollback TAG      print the rollback plan only (changes nothing)
  python3 tools/snapshot.py --rollback TAG --yes   snapshot the current state, then restore every tracked file to TAG and commit
  python3 tools/snapshot.py --status            last tags, uncommitted changes
  --repo DIR  /  --out FILE                     act on another checkout (tests; its bundle goes next to it) / bundle path

Publish mode never blocks a publish: any git problem prints a WARN and exits 0.
What is tracked is decided by .gitignore (an allow-list); see RESUME.md "Version control"."""
import os, re, subprocess, sys
from datetime import datetime
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)

P = str(paths.ROOT)   # this checkout (a worktree snapshots its own branch)
BUNDLE = str(paths.OUT / 'questgen_repo.bundle')
# owner 16 Nov: "Commit from Claude" (GitHub showed the bot's commits as Unverified); still never the owner's address
NAME, EMAIL = 'Claude', 'noreply@anthropic.com'


def arg(flag, default=None):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv and sys.argv.index(flag) + 1 < len(sys.argv) else default


REPO = arg('--repo', P)
if REPO != P: BUNDLE = os.path.join(os.path.dirname(os.path.abspath(REPO)), 'questgen_repo.bundle')   # tests never touch the real bundle
BUNDLE = arg('--out', BUNDLE)


def git(*a, check=True):
    r = subprocess.run(['git', '-C', REPO, '-c', f'user.name={NAME}', '-c', f'user.email={EMAIL}', *a],
                       capture_output=True, text=True, timeout=300)
    if check and r.returncode:
        raise RuntimeError(f'git {" ".join(a)}: {(r.stderr or r.stdout).strip()[:300]}')
    return r.stdout.strip()


def sydney(fmt='%Y-%m-%d %H:%M'):
    # Sydney time whatever the machine's zone: a cloud container runs on UTC (CLAUDE.md "Read the clock before stamping")
    return datetime.now(ZoneInfo('Australia/Sydney')).strftime(fmt)


def versions():
    # Tags cannot be pushed through the cloud session's GitHub proxy, so a fresh clone lacks the newest ones. Read the
    # "publish vNNN" commit messages too, or the next publish reuses a number (v214 nearly repeated, 16 Nov).
    out = []
    for t in git('tag', '--list').split():
        m = re.fullmatch(r'(?:publish|baseline)-v(\d+)', t)
        if m: out.append(int(m.group(1)))
    for subj in git('log', '--format=%s', '--grep=^publish v[0-9]', check=False).splitlines():
        m = re.match(r'publish v(\d+)\b', subj)
        if m: out.append(int(m.group(1)))
    return out


def ensure_repo():
    if not os.path.isdir(os.path.join(REPO, '.git')):
        raise RuntimeError(f'{REPO} is not a git repository (see RESUME.md "Version control" to set it up again)')
    git('config', 'user.name', NAME); git('config', 'user.email', EMAIL)


def commit_all(msg):
    """git add -A; commit if anything changed. Returns the short sha of HEAD and whether a commit was made."""
    git('add', '-A')
    changed = bool(git('status', '--porcelain'))
    if changed: git('commit', '-q', '-m', msg)
    return git('rev-parse', '--short', 'HEAD'), changed


def publish():
    try:
        ensure_repo()
        v = int(arg('--version') or (max(versions() or [0]) + 1))
        tag = f'publish-v{v:03d}'
        if tag in git('tag', '--list').split():
            print(f'  WARN    snapshot: tag {tag} already exists; not re-tagging (pass --version N)'); return
        subprocess.run([sys.executable, os.path.join(REPO, 'tools', 'export_db_text.py'), '--out', os.path.join(REPO, 'dbtext')], timeout=600)   # owner 14 Nov (Fix 2): questions.db as text, so git keeps its history
        sha, made = commit_all(f'publish v{v:03d} {sydney("%Y-%m-%d %H:%M")}')
        git('tag', '-a', tag, '-m', f'published {sydney("%Y-%m-%d %H:%M")}')
        print(f'snapshot: {"committed" if made else "no file changes;"} {sha}, tagged {tag}')
        try: bundle(quiet=True)
        except Exception as e: print(f'  WARN    snapshot: bundle not written: {e}')
    except Exception as e:   # never block a publish
        print(f'  WARN    snapshot failed (the publish itself is fine; fix git later): {e}')


def bundle(quiet=False):
    ensure_repo()
    os.makedirs(os.path.dirname(BUNDLE), exist_ok=True)
    tmp = BUNDLE + '.tmp'
    git('bundle', 'create', tmp, '--all')
    git('bundle', 'verify', tmp)
    os.replace(tmp, BUNDLE)
    msg = f'bundle: {BUNDLE} ({os.path.getsize(BUNDLE) / 1e6:.1f} MB, {len(git("tag", "--list").split())} tags)'
    print(msg if not quiet else 'snapshot ' + msg)


def rollback(tag):
    ensure_repo()
    if not git('tag', '--list', tag):
        sys.exit(f'no such tag: {tag}. Tags: {" ".join(git("tag", "--list").split()[-10:])}')
    dirty = git('status', '--porcelain')
    stat = git('diff', '--stat', tag, 'HEAD') or '(HEAD is identical to ' + tag + ')'
    print(f'Rollback plan: restore every tracked file to {tag} ({git("log", "-1", "--format=%h %s", tag)})')
    print(f'Current HEAD: {git("log", "-1", "--format=%h %s")}{"  + uncommitted changes" if dirty else ""}')
    print('Files that change (HEAD vs tag):\n' + '\n'.join('  ' + l for l in stat.splitlines()[-25:]))
    print('Steps (nothing is lost: the current state is committed first and stays in history):')
    print(f'  1. git add -A && git commit -m "pre-rollback snapshot"     (tag pre-rollback-<time>)')
    print(f'  2. git restore --source={tag} --staged --worktree -- :/')
    print(f'  3. git commit -m "rollback to {tag}"')
    print('  4. python3 tools/build_page.py && bash tools/prepublish.sh, then publish as usual')
    print('Not rolled back: questions.db, work/, src/, page images (untracked). The database is restored from its Drive backup (questions.db.xz; questions.db.zip before 18 Nov); dbtext/ at the tag holds its text of that time.')
    if '--yes' not in sys.argv:
        print('\nDry run. Add --yes to do it.'); return
    stamp = sydney('%Y%m%d-%H%M%S')
    sha, made = commit_all(f'pre-rollback snapshot {sydney("%Y-%m-%d %H:%M")}')
    git('tag', f'pre-rollback-{stamp}', sha)
    git('restore', f'--source={tag}', '--staged', '--worktree', '--', ':/')
    sha2, made2 = commit_all(f'rollback to {tag}')
    print(f'done: previous state tagged pre-rollback-{stamp} ({sha}); now {sha2}{"" if made2 else " (no changes)"}. Rebuild and run prepublish next.')


def status():
    ensure_repo()
    print('HEAD:', git('log', '-1', '--format=%h %ci %s'))
    print('tags:', ' '.join(git('tag', '--list', '--sort=-creatordate').split()[:8]))
    d = git('status', '--porcelain')
    print(f'uncommitted: {len(d.splitlines())} file(s)' if d else 'uncommitted: none')


if __name__ == '__main__':
    if '--rollback' in sys.argv:
        t = arg('--rollback')
        if not t or t.startswith('--'): sys.exit('usage: snapshot.py --rollback TAG [--yes]')
        rollback(t)
    elif '--bundle' in sys.argv: bundle()
    elif '--status' in sys.argv: status()
    else: publish()
