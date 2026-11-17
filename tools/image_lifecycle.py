#!/usr/bin/env python3
"""Image lifecycle: keep page scans only while a paper is in review; keep figure crops only where the page can still show one.

Job 3, 16 Nov. Owner 14 Nov: "What if we dropped them and rerendered them in the new location?" CLAUDE.md job 3: "What is
permanent: redrawn diagrams ... plus figure crops only where a diagram has no approved redraw. Page scans and comparison
overlays exist only while a paper is in review; drop them once it is cleared."

  python3 tools/image_lifecycle.py [EXPORT_DIR]          plan + apply (EXPORT_DIR: ArtifactData export with reviews/; without
                                                         it the page_reviews mirror in questions.db is read, tools/sync_pagedb.py)
  python3 tools/image_lifecycle.py [EXPORT_DIR] --dry    plan only

What it does, every run (idempotent):
  - A paper still in review keeps its per-paper pack site/data/img/<doc>.json (page scans + all crops), as add_to_bank.py
    wrote it. The index marks it (docs[doc].ip, tools/bank_split.py) and the page reads crops from it (05_figures.js pack).
  - A cleared paper ("cleared" = tools/import_next.py cleared(): paper approval, or every question approved) loses its
    per-paper pack: it is moved to archive/img_cleared/<doc>.json (local; the page's earlier versions still hold it, and
    scans can be re-rendered from the exam PDF). Its crops that the page may still show go into the crop groups
    site/data/crop/g<doc % 8>.json. A crop is dropped only when its redraw is approved for certain: reviews fig[k] ==
    'approved' or the triage cleared it (tri.ok_figs). Anything else (no redraw, not approved, a spot-check inference) keeps
    its crop, so the page never loses an image it would show.
  - Review overlays (data/cmp/g0.json "ov:<key>" / "v1:<key>") of cleared papers are dropped (kept in archive/img_cleared/cmp/).
  - The redraw packs are regrouped when tools/packs.py GROUPS['svg'] changed (8 -> 32 on 16 Nov), content unchanged.
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import glob, json, os, re, sqlite3, sys
import packs, bank_split
import import_next as IN

P = paths.P
S = P + 'site/data/'
ARCH = P + 'archive/img_cleared/'
KEY_DOC = re.compile(r'(?:ov:|v1:|figures/)?(\d+)_')


def load(f):
    return json.load(open(f)) if os.path.exists(f) else {}


def ov_png(f, width=700):
    """A Review overlay image as a small data URI: at most `width` px wide, 4-colour palette PNG (about 15 KB)."""
    import base64, io
    from PIL import Image
    im = Image.open(f).convert('RGB')
    if im.width > width: im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    b = io.BytesIO(); im.quantize(colors=4).save(b, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()


def groups(kind):
    """Every existing group file of `kind`, whatever its count, merged: {key: value}."""
    out = {}
    for f in sorted(glob.glob(S + kind + '/g*.json')): out.update(load(f))
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dry = '--dry' in sys.argv
    db = sqlite3.connect(paths.DBS)
    reviews = dict(IN.read(args[0] if args else None, 'reviews', db, 'page_reviews'))
    key_of = IN.question_keys(db)
    qs_of = {}
    for q, d in db.execute('select id, document_id from questions'): qs_of.setdefault(d, []).append(q)
    # redraws approved for certain (the page's figDec also infers some from spot-checks: those keep their crop, to be safe)
    det = bank_split.read_gz(bank_split.DETAILS)['q'] if os.path.exists(bank_split.DETAILS) else {}
    rv = lambda q: (reviews.get('k_' + key_of[q]) if key_of.get(q) else None) or reviews.get('q%d' % q) or {}
    approved = set()
    for q in [q for qs in qs_of.values() for q in qs]:
        approved |= {k for k, v in (rv(q).get('fig') or {}).items() if v == 'approved'}
        approved |= set(((det.get(str(q)) or {}).get('tri') or {}).get('ok_figs') or [])

    img = {int(os.path.basename(f)[:-5]): f for f in glob.glob(S + 'img/*.json')}
    # a pack is used by every question whose page scans or figures it holds (a solutions file's pages serve the questions of
    # another file): it is cleared only when every paper using it is cleared; a pack no question uses is not shown anywhere
    idx = bank_split.read_gz(bank_split.INDEX)
    users = {}
    for q in idx['questions']:
        packs_of_q = {int(p.split('/')[-1].split('_')[0]) for p in ((det.get(str(q['id'])) or {}).get('pages') or [])}
        packs_of_q |= {int(k.split('_')[0]) for k in ((q.get('fk') or {}).get('a') or [])}
        for d in packs_of_q: users.setdefault(d, set()).add(q['doc'])
    # owner 17 Nov: "For the fixed and back to you, the page image is gone": a paper with anything open (a flag, a diagram change
    # request, or a redraw waiting for its second check: the page's openFix) is in review again, so it keeps its page scans, and a
    # pack archived earlier comes back from archive/img_cleared/
    def _open(r):
        r = r or {}; fig = r.get('fig') or {}
        return r.get('status') == 'flagged' or 'changes' in fig.values() or any(not fig.get(k) for k in (r.get('fig_done') or {}))
    open_doc = {d for d in {u for us in users.values() for u in us}
                if any(_open(reviews.get('k_' + key_of[q]) if key_of.get(q) else None) or _open(reviews.get('q%d' % q)) for q in qs_of.get(d, []))}
    for d in sorted(open_doc):
        a = P + f'archive/img_cleared/{d}.json'
        if d not in img and os.path.exists(a):
            os.replace(a, S + f'img/{d}.json'); img[d] = S + f'img/{d}.json'; print('image_lifecycle: page scans back for paper', d, '(open flags or redraws)')
    ok_doc = {d: IN.cleared([d], reviews, qs_of, key_of) and d not in open_doc for d in {u for us in users.values() for u in us}}
    cleared = {d for d in img if all(ok_doc[u] for u in users.get(d, ()))}
    crops = groups('crop')
    by_doc = {}
    for k, v in crops.items(): by_doc.setdefault(KEY_DOC.match(k).group(1), {})[k] = v
    moved, kept, dropped = [], 0, 0
    for d in sorted(cleared):
        m = load(img[d])
        for p, v in m.items():
            if not p.startswith('figures/'): continue
            k = p[len('figures/'):-len('.png')]
            if k in approved: dropped += 1; continue
            by_doc.setdefault(str(d), {})[p] = v; kept += 1
        moved.append(d)
    cmp = groups('cmp'); n_cmp = len(cmp)
    # 16 Nov (Batch 6): papers still in review get their Review overlay images ("ov:<key>": red only in the original, blue only
    # in the redraw, black both) packed from the diagram run's tikz/overlay/<key>.png, as the old pipeline did (4-colour PNG)
    in_review = {d for d in img if d not in cleared}
    for f in sorted(glob.glob(P + 'tikz/overlay/*.png')):
        k = os.path.basename(f)[:-4]
        if int(KEY_DOC.match(k).group(1)) in in_review and 'ov:' + k not in cmp: cmp['ov:' + k] = ov_png(f)
    cmp_drop = {k: v for k, v in cmp.items() if int(KEY_DOC.match(k).group(1)) in cleared}
    svg = groups('svg')
    svg_files = sorted(glob.glob(S + 'svg/g*.json'))
    regroup = len(svg_files) != packs.GROUPS['svg']
    print(f'image_lifecycle: {len(img)} paper packs, {len(cleared)} cleared -> archive; crops kept {kept}, dropped {dropped} '
          f'(redraw approved); overlays added {len(cmp) - n_cmp}, dropped {len(cmp_drop)} of {len(cmp)}; svg groups {len(svg_files)} -> {packs.GROUPS["svg"]}'
          + (' (regroup)' if regroup else ''))
    if dry: return
    os.makedirs(ARCH + 'cmp', exist_ok=True)
    packs.write_groups('crop', by_doc)
    if cmp_drop or len(cmp) != n_cmp:
        old = load(ARCH + 'cmp/dropped.json'); old.update(cmp_drop); json.dump(old, open(ARCH + 'cmp/dropped.json', 'w'))
        keep = {k: v for k, v in cmp.items() if k not in cmp_drop}
        packs.write_groups('cmp', {d: {k: v for k, v in keep.items() if KEY_DOC.match(k).group(1) == d} for d in {KEY_DOC.match(k).group(1) for k in keep}})
    if regroup:
        n0 = len(svg)
        sb = {}
        for k, v in svg.items(): sb.setdefault(KEY_DOC.match(k).group(1), {})[k] = v
        for f in svg_files: os.remove(f)
        packs.write_groups('svg', sb)
        assert len(groups('svg')) == n0, 'svg regroup lost keys'
    for d in moved: os.replace(img[d], ARCH + '%d.json' % d)
    print(f'image_lifecycle: archived {len(moved)} paper packs to {os.path.relpath(ARCH, P)}/; crop groups', {g: n for g, n in
          sorted((os.path.basename(f)[:-5], len(load(f))) for f in glob.glob(S + 'crop/g*.json'))})


if __name__ == '__main__':
    main()
