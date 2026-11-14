#!/usr/bin/env python3
"""Move the page's review decisions from question ids to permanent question keys (Fix 2; owner 14 Nov: "Ok we should run
Fix 1 and 2").

Reads an export of the page collection `reviews` (ArtifactData `list` with `out_dir`, or the backup folder: one JSON file per
doc, `q<id>.json` / `paper_<doc>.json`, raw or wrapped in {"data": ...}). Writes, and never sends anything:
  <out>/batch_NNN.json   ArtifactData `batch` writes, at most 50 each: {"writes": [{op: "set", collection: "reviews",
                         doc_id: "k_<key>" | "p_<paper key>", data}]}. All are creations (no if_version needed).
  <out>/report.json, <out>/report.txt   the dry-run report.
Merging copies (every q<id> of one key -> one k_<key>): an approval wins, then the newest decision; the newest note is kept;
maps (fig, sol, fig_notes, fig_done, tagres, tag_edits, home) merge key by key, newest wins. Same for paper_<doc> -> p_<key>.
A key whose k_/p_ doc is already in the export is left alone (the page already decided it).

Check (exit 1 if it fails): every question that was approved before (its own q<id> doc, the doc of the copy it is hidden
behind, or an approved paper with the question in the auto tier: the page's qState) is approved after, reading ONLY the new
k_/p_ docs. The count must match exactly. Questions approved only after (other copies of an approved question, e.g. CSSA
2022 Q10-Q11: 44/45 behind 274/275) are listed.

Usage: python3 tools/migrate_reviews_to_keys.py EXPORT_DIR --out work/keys_migration [--db DB] [--bank site/data/bank.json]
DB must hold question_keys (tools/qkeys.py --assign); defaults to $QG_DB or /mnt/user-data/outputs/questions.db (read only).
Old q<id> / paper_<doc> docs are not deleted: the page reads them as a fallback, and they are the history.
"""
import argparse, collections, datetime, glob, json, os, sqlite3, sys

DB = os.environ.get('QG_DB', '/mnt/user-data/outputs/questions.db')
P = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BATCH = 50


def load_export(d):
    if os.path.isdir(os.path.join(d, 'reviews')): d = os.path.join(d, 'reviews')
    out = {}
    for f in sorted(glob.glob(os.path.join(d, '*.json'))):
        x = json.load(open(f))
        if isinstance(x, dict) and isinstance(x.get('data'), dict) and 'version' in x: x = x['data']
        out[os.path.basename(f)[:-5]] = x
    return out


def rank(r):
    s = (r or {}).get('status')
    return (3 if s == 'approved' else 2 if s == 'flagged' else 1 if s else 0, str((r or {}).get('at') or ''))


def merge(docs):
    """Same rule as RKEY.merge in page_src/js/08_review.js."""
    if len(docs) == 1: return dict(docs[0])
    obj = lambda k, v: isinstance(v, dict) and k != 'call'
    asc = sorted(docs, key=lambda r: str(r.get('at') or ''))
    top = sorted(asc, key=rank)[-1]
    out = {}
    for r in asc:
        for k, v in r.items():
            if obj(k, v): out[k] = {**out.get(k, {}), **v}
    for k, v in top.items():
        if not obj(k, v): out[k] = v
    notes = [r for r in asc if r.get('note')]; calls = [r for r in asc if r.get('call')]
    if notes: out['note'] = notes[-1]['note']
    if calls: out['call'] = calls[-1]['call']
    return out


def main():
    a = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    a.add_argument('export'); a.add_argument('--out', default=os.path.join(P, 'work', 'keys_migration'))
    a.add_argument('--db', default=DB); a.add_argument('--bank', default=os.path.join(P, 'site', 'data', 'bank.json'))
    o = a.parse_args()
    sys.path.insert(0, os.path.join(P, 'tools')); import qkeys
    db = sqlite3.connect('file:%s?mode=ro' % o.db, uri=True)
    if not qkeys.table_exists(db): sys.exit(f'{o.db} has no question_keys table: run tools/qkeys.py --assign first')
    keys = qkeys.live_keys(db)
    qdoc = dict(db.execute('select id, document_id from questions'))
    pkeys = qkeys.paper_keys(keys, qdoc)
    bank = json.load(open(o.bank)); B = {q['id']: q for q in bank['questions']}
    raw = load_export(o.export)
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')

    groups, pgroups, orphans, kept_new = collections.defaultdict(list), collections.defaultdict(list), [], []
    for k, v in raw.items():
        if k.startswith('k_') or k.startswith('p_'): kept_new.append(k); continue
        if k.startswith('paper_'):
            d = int(k[6:]) if k[6:].isdigit() else None
            if d in pkeys: pgroups[pkeys[d]].append((k, v))
            else: orphans.append(k)
        elif k.startswith('q') and k[1:].isdigit():
            q = int(k[1:])
            if q in keys: groups[keys[q]].append((k, v))
            else: orphans.append(k)
        else: orphans.append(k)
    new, writes = {}, []
    for key, L in sorted(groups.items()):
        if 'k_' + key in raw: continue
        d = merge([v for _, v in L]); qids = sorted(q for q, k in keys.items() if k == key)
        d.update(key=key, question_ids=qids, migrated_from=[k for k, _ in L], migrated_at=now)
        new['k_' + key] = d
    for pk, L in sorted(pgroups.items()):
        if 'p_' + pk in raw: continue
        d = merge([v for _, v in L])
        d.update(key=pk, docs=sorted(x for x, y in pkeys.items() if y == pk), migrated_from=[k for k, _ in L], migrated_at=now)
        new['p_' + pk] = d
    for i, v in new.items(): writes.append({'op': 'set', 'collection': 'reviews', 'doc_id': i, 'data': v})

    # ---- dry-run check: approved before vs approved after (after = the new docs only, plus key docs already there) ----
    st = lambda r: (r or {}).get('status')
    def before(q):
        own = raw.get('q%d' % q['id']); show = raw.get('q%d' % (q.get('dup_of') or q['id']))
        if st(own) == 'approved': return True
        if st(show): return st(show) == 'approved'
        return (q.get('tri') or {}).get('tier') == 'auto' and st(raw.get('paper_%d' % q['doc'])) == 'approved'
    after_docs = {**{k: raw[k] for k in kept_new}, **new}
    def after(q):
        k = keys.get(q['id']); r = after_docs.get('k_%s' % k) if k else None
        if st(r): return st(r) == 'approved'
        pk = pkeys.get(q['doc'])
        return (q.get('tri') or {}).get('tier') == 'auto' and st(after_docs.get('p_%s' % pk)) == 'approved'
    was = [q['id'] for q in bank['questions'] if before(q)]
    now_ok = {q['id'] for q in bank['questions'] if after(q)}
    lost = [i for i in was if i not in now_ok]
    gained = sorted(now_ok - set(was))
    papers_before = sorted(int(k[6:]) for k, v in raw.items() if k.startswith('paper_') and st(v) == 'approved')
    papers_lost = [d for d in papers_before if st(after_docs.get('p_%s' % pkeys.get(d))) != 'approved']

    os.makedirs(o.out, exist_ok=True)
    for f in glob.glob(os.path.join(o.out, 'batch_*.json')): os.remove(f)
    files = []
    for i in range(0, len(writes), BATCH):
        f = os.path.join(o.out, 'batch_%03d.json' % (i // BATCH + 1)); json.dump({'writes': writes[i:i + BATCH]}, open(f, 'w'), ensure_ascii=False)
        assert os.path.getsize(f) < 900_000, f'{f} is too big for one batch'
        files.append(os.path.basename(f))
    rep = dict(made=now, export=os.path.abspath(o.export), db=o.db, docs_in=len(raw),
               question_docs=sum(len(v) for v in groups.values()), key_docs=sum(1 for k in new if k.startswith('k_')),
               paper_docs=sum(len(v) for v in pgroups.values()), paper_key_docs=sum(1 for k in new if k.startswith('p_')),
               merged=[dict(doc=k, from_=v['migrated_from']) for k, v in new.items() if len(v['migrated_from']) > 1],
               already_by_key=kept_new, orphans=orphans, approved_before=len(was), approved_before_still_approved=len(was) - len(lost),
               lost=lost, newly_approved=gained, papers_approved_before=len(papers_before), papers_lost=papers_lost, batches=files, writes=len(writes))
    json.dump(rep, open(os.path.join(o.out, 'report.json'), 'w'), indent=1)
    txt = [f'reviews export: {len(raw)} docs ({rep["question_docs"]} question docs, {rep["paper_docs"]} paper docs, {len(orphans)} not mapped, {len(kept_new)} already by key)',
           f'new docs: {rep["key_docs"]} k_<key> + {rep["paper_key_docs"]} p_<paper key> = {len(writes)} writes in {len(files)} batch file(s) of at most {BATCH}',
           f'merged copies: {len(rep["merged"])} ' + ', '.join(f'{m["doc"]} <- {"+".join(m["from_"])}' for m in rep['merged'][:12]) + (' ...' if len(rep['merged']) > 12 else ''),
           f'approved before: {len(was)}; still approved after: {len(was) - len(lost)}' + (f'  LOST: {lost[:30]}' if lost else '  (match)'),
           f'papers approved before: {len(papers_before)}; lost: {papers_lost or "none"}',
           f'approved only after (copies of an approved question): {len(gained)} {gained[:40]}',
           f'not mapped (question or paper no longer exists; left as they are): {orphans[:30]}']
    open(os.path.join(o.out, 'report.txt'), 'w').write('\n'.join(txt) + '\n'); print('\n'.join(txt)); print('->', o.out)
    if lost or papers_lost: print('FAIL: approvals would be lost'); sys.exit(1)


if __name__ == '__main__':
    main()
