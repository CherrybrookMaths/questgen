"""Automatic version control for Questgen (stage 1, 15 Nov).
Owner: "would I have to manage version control? I don't want to have to do that." -> the owner never runs git; this does.

  python3 tools/snapshot.py                     commit everything + tag publish-vNNN (called by batch_check.py --mark-published)
  python3 tools/snapshot.py --version 205       same, with an explicit version number (default: highest vNNN tag + 1)
  python3 tools/snapshot.py --bundle            write /mnt/user-data/outputs/questgen_repo.bundle (git bundle --all) for the Drive sync
  python3 tools/snapshot.py --rollback TAG      print the rollback plan only (changes nothing)
  python3 tools/snapshot.py --rollback TAG --yes   snapshot the current state, then restore every tracked file to TAG and commit
  python3 tools/snapshot.py --status            last tags, uncommitted changes
  --repo DIR                                    act on another checkout (tests)

Publish mode never blocks a publish: any git problem prints a WARN and exits 0.
What is tracked is decided by .gitignore (an allow-list); see RESUME.md "Version control"."""
import os, re, subprocess, sys, time

P = '/home/claude/pilot'
BUNDLE = '/mnt/user-data/outputs/questgen_repo.bundle'
NAME, EMAIL = 'Questgen bot', 'questgen@localhost'   # never a real address


def arg(flag, default=None):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv and sys.argv.index(flag) + 1 < len(sys.argv) else default


REPO = arg('--repo', P)


def git(*a, check=True):
    r = subprocess.run(['git', '-C', REPO, '-c', f'user.name={NAME}', '-c', f'user.email={EMAIL}', *a],
                       capture_output=True, text=True, timeout=300)
    if check and r.returncode:
        raise RuntimeError(f'git {" ".join(a)}: {(r.stderr or r.stdout).strip()[:300]}')
    return r.stdout.strip()


def versions():
    out = []
    for t in git('tag', '--list').split():
        m = re.fullmatch(r'(?:publish|baseline)-v(\d+)', t)
        if m: out.append(int(m.group(1)))
    return out


def ensure_repo():
    if not os.path.isdir(os.path.join(REPO, '.git')):
        raise RuntimeError(f'{REPO} is not a git repository (stage 1 setup: git init + tools/snapshot.py --init)')
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
        sha, made = commit_all(f'publish v{v:03d} {time.strftime("%Y-%m-%d %H:%M")}')
        git('tag', '-a', tag, '-m', f'published {time.strftime("%Y-%m-%d %H:%M")}')
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
    print('Not rolled back: questions.db, work/, src/, page images (untracked). site/project/questions.sql at the tag is the DB dump of that time.')
    if '--yes' not in sys.argv:
        print('\nDry run. Add --yes to do it.'); return
    stamp = time.strftime('%Y%m%d-%H%M%S')
    sha, made = commit_all(f'pre-rollback snapshot {time.strftime("%Y-%m-%d %H:%M")}')
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
