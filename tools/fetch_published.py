"""What a fresh clone must read back from the published review page, and a check that it arrived (14 Nov, cloud move).

Git holds code + state (state/); questions.db comes from Drive ($QG_DB). The image packs are too big for git (about 140 MB)
and live only as published files of the review page (https://claude.ai/artifact/MSd3GSrwsAqwzmBX8wSC8f):
data/img/<doc>.json (page images + figure crops), data/svg/g0..g7.json (redraws), data/cmp/g0.json (Review overlay /
first-redraw images), data/check/<id>.json (Needs a check pages, when any). The list is every path in
state/work/published_manifest.json (what the last publish sent) that is missing locally under site/.

  python3 tools/fetch_published.py              print the missing paths as JSON batches for the Artifact tool (read, `paths`)
  python3 tools/fetch_published.py --place DIR  copy DIR/<published path> (where the Artifact tool saved them) into site/
  python3 tools/fetch_published.py --verify     every manifest path exists under site/ with the published sha256, and every
                                                asset-store pack in data/assets.json exists; exit 1 if not
  python3 tools/fetch_published.py --place-assets DIR   copy DIR/<asset id>.json to site/<path> (sha256 checked against data/assets.json)
  python3 tools/fetch_published.py --figures-from-packs   rebuild figures/<id>.png from the data/img packs (APPROXIMATE, see below)

Artifact tool call (one per batch printed): action "read", url = the review page, paths = the batch, and either
out_dir = <repo>/site (files land in place; the person is asked once) or no out_dir (files land in the artifact's scratch
folder; then run --place on that folder).

figures/: the original figure crops (60 MB, 992 PNGs; the DB's figures.png_path) are NOT published anywhere. The data/img packs
hold a processed copy of each (ink as alpha, at most 900 px wide). --figures-from-packs turns those back into black-on-white
PNGs: good enough for tikz_render.sh's side-by-side and overlay.py, NOT identical to the originals (re-cropping or
add_to_bank.py on an existing paper would pack the approximation). The originals can only be re-cropped from the source PDFs.
"""
import base64, hashlib, io, json, os, shutil, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)

ARTIFACT = 'https://claude.ai/artifact/MSd3GSrwsAqwzmBX8wSC8f'
MAN = paths.state('work/published_manifest.json')
SITE = paths.ROOT / 'site'
BATCH_BYTES = 60 * 2**20   # keep each read call well under the tool's per-call transfer


def manifest():
    return json.load(open(MAN))['files']


def sha(p):   # the manifest's digest: one copy, in publish_set.py
    sys.path.insert(0, str(paths.ROOT / 'tools')); import publish_set; return publish_set.sha(p)


def missing():
    return sorted(k for k in manifest() if not (SITE / k).exists())


# 18 Nov (owner: "go and fix it."): the 40 permanent packs (data/svg g*, data/crop g*) live in the page's asset store, not among the
# published files, so missing() never listed them. A night session without them let image_lifecycle.py write EMPTY packs (17 Nov night
# run); uploaded, the page would have lost its diagrams. They are fetched here, one Artifact read per asset id.
ASSETS = SITE / 'data/assets.json'


def assets():
    return json.load(open(ASSETS)).get('assets', {}) if ASSETS.exists() else {}


def asset_missing():
    return sorted((k, v['url'].rsplit('/', 1)[-1]) for k, v in assets().items() if not (SITE / k).exists())


def batches(ks, sizes=None):
    out, cur, n = [], [], 0
    for k in ks:
        s = (sizes or {}).get(k, 3 * 2**20)
        if cur and (n + s > BATCH_BYTES or len(cur) >= 25): out.append(cur); cur, n = [], 0
        cur.append(k); n += s
    if cur: out.append(cur)
    return out


def figures_from_packs():
    import numpy as np
    from PIL import Image
    dst = paths.ROOT / 'figures'; dst.mkdir(exist_ok=True); n = 0
    for f in sorted((SITE / 'data/img').glob('*.json')):
        for k, v in json.load(open(f)).items():
            if not k.startswith('figures/') or (dst / os.path.basename(k)).exists(): continue
            im = Image.open(io.BytesIO(base64.b64decode(v.split(',', 1)[1])))
            a = np.asarray(im.convert('LA'), dtype=np.float32)[..., 1]
            g = np.clip(255 - a / 1.08, 0, 255).astype(np.uint8)   # inverse of add_to_bank.png(): alpha = (255 - grey) * 1.08
            Image.fromarray(g, 'L').save(dst / os.path.basename(k)); n += 1
    print(f'figures/: wrote {n} approximate crops from the data/img packs (not the originals; see this file\'s docstring)')


if __name__ == '__main__':
    if '--place' in sys.argv:
        src = sys.argv[sys.argv.index('--place') + 1]; n = 0
        for k in manifest():
            a = os.path.join(src, k)
            if os.path.exists(a) and not (SITE / k).exists():
                (SITE / k).parent.mkdir(parents=True, exist_ok=True); shutil.copy2(a, SITE / k); n += 1
        print(f'placed {n} files under site/'); sys.exit(0)
    if '--place-assets' in sys.argv:   # DIR holds <asset id>.json files saved by the Artifact read calls
        src = sys.argv[sys.argv.index('--place-assets') + 1]; n = 0; bad = []
        for k, v in assets().items():
            a = os.path.join(src, v['url'].rsplit('/', 1)[-1] + '.json')
            if (SITE / k).exists() or not os.path.exists(a): continue
            import hashlib
            if hashlib.sha256(open(a, 'rb').read()).hexdigest() != v.get('sha256'): bad.append(k); continue
            (SITE / k).parent.mkdir(parents=True, exist_ok=True); shutil.copy2(a, SITE / k); n += 1
        left = asset_missing()
        print(f'placed {n} asset-store packs under site/' + (f'; sha256 differs from data/assets.json, not placed: {bad}' if bad else '')
              + (f'; still missing: {[k for k, _ in left]}' if left else ''))
        sys.exit(1 if bad or left else 0)
    if '--verify' in sys.argv:
        # Missing = error. A different sha256 is only a note: --mark-published records the LOCAL bytes of every publishable file,
        # including packs it did not resend, so the artifact can hold an older byte order of the same content (14 Nov: all 8
        # svg groups were JSON-equal to the local ones with a different key order). The next publish then resends them.
        man = manifest(); bad, diff = [], []
        for k, h in man.items():
            p = SITE / k
            if not p.exists(): bad.append(f'{k} missing')
            elif k.startswith(('data/img/', 'data/svg/', 'data/cmp/', 'data/check/')) and sha(p) != h: diff.append(k)
        am = asset_missing(); bad += [f'{k} (asset store) missing' for k, _ in am]
        print(f'fetch_published --verify: {len(man) - len(bad) + len(am)} of {len(man)} published files present, '
              f'{len(assets()) - len(am)} of {len(assets())} asset-store packs present' + ('' if not bad else f'; {len(bad)} missing: ' + '; '.join(bad[:10])))
        if diff: print(f'  note: {len(diff)} pack(s) differ in bytes from the manifest\'s sha256 (expected when the artifact holds an older byte order; batch_check will list them as changed and the next publish resends them): ' + ', '.join(diff[:10]))
        sys.exit(1 if bad else 0)
    if '--figures-from-packs' in sys.argv:
        figures_from_packs(); sys.exit(0)
    ks = missing()
    print(f'{len(ks)} published file(s) missing locally (artifact {ARTIFACT}); one Artifact read call per batch:')
    print(json.dumps(batches(ks), indent=1))
    am = asset_missing()
    print(f'{len(am)} asset-store pack(s) missing locally: one Artifact read call PER ID (action "read", url = the page, path = the id, '
          f'out_dir = work/assets_dl; a `paths` list of ids is refused), then python3 tools/fetch_published.py --place-assets work/assets_dl:')
    print(json.dumps([i for _, i in am]))
