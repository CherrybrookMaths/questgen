#!/usr/bin/env python3
"""Copy check before an import: is a new paper the same exam as a paper already in the bank? Runs BEFORE any API spend.

Owner 23 Nov (Next up "copy-check-before-import"), verbatim: "yes I do want c as well." The API import paid for papers that were
copies of papers already in the bank: 2022 NEAP AT4 (doc 277, Batch 12, US$6.44) is 2022 Knox AT4 (doc 1612, Batch 11), and 2021
King's AT4 (doc 1051, Batch 17, US$3.07) is the 2021 PEM trial (doc 1315, Batch 16): schools sit commercial trials under their own name.

Measure (the kind tools/dedup.py uses: word 3-shingles): the new paper exists only as a PDF, so its text is `pdftotext -raw` of every
file of the paper in src/ (question paper and solutions). Each bank question (stem + parts + options, LaTeX commands dropped) is
FOUND in the new paper when at least half of its 3-shingles occur in the paper's text (containment, not Jaccard: the PDF also holds
cover pages, instructions and solutions). For every bank paper:
  found  = questions found / its questions (with 4+ shingles; papers with fewer than 5 such questions are skipped)
  share  = all its question shingles that occur in the new paper / all its question shingles
A paper is a COPY of the bank paper with the highest `found` when found >= FOUND_MIN and share >= SHARE_MIN.
Papers earlier in the same batch are not in the database yet: they are compared PDF to PDF (shingles shared / the smaller paper's
shingles >= PDF_MIN), and the earlier one counts as the original.

Thresholds (24 Nov, from every bank paper with its PDF in src/, 121 papers, each against the whole bank but itself):
  known copies   found 0.67-1.00, share 0.58-0.80 (1051 vs 1315 lowest: King's left out 7 of PEM's 33 questions)
  everything else found <= 0.53, share <= 0.42 (2020 Grafton / Hurlstone / Moorebank share 14-15 questions: real overlap, not copies;
                 tools/dedup.py links those questions one by one)
  so FOUND_MIN 0.6 and SHARE_MIN 0.5 sit in both gaps. PDF to PDF: copies 0.71-1.00, other papers <= 0.47: PDF_MIN 0.6.
  `python3 tools/copy_check.py evidence b16 b17 ...` re-runs the evidence over imported batches (each paper against the bank as it was
  before its batch). Anything between the "look" lines and the copy lines is printed as "look" (imported as normal).
A scanned paper with no text layer cannot be checked (no OCR here): it is reported "unchecked" and imported as normal.

  python3 tools/copy_check.py check <batch> <doc id> [...]           report only; exit 3 when a copy is found
  python3 tools/copy_check.py check <batch> <doc id> [...] --apply   record each copy (below); prints KEEP: <ids> for the driver
  python3 tools/copy_check.py evidence <batch> [...]                   evidence over imported batches (read only)

--apply records a copy the way the repo already does (owner 16 Nov: "duplicate exams will never be batched and imported right?"; doc 177,
owner 18 Nov: "yes mark it as a copy"): every file of the paper gets documents.status 'duplicate_file' and failure_reason "copy of
document <original>: ..." (questions.db is first copied to archive/). Then `python3 tools/inventory.py` takes it out of its lane batch
(tools/batches.py logs "recorded as copies of another file (never imported)") and lists it under Processes > Papers > Copies; the import
run log (state/work/import/batches.json) loses it from the batch's ids. Every check writes state/work/import/copy_check/<batch>.json,
which tools/api_import.py parse requires: it refuses a paper with no check, or one recorded as a copy.
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import argparse, collections, datetime, json, os, re, sqlite3, subprocess, sys

FOUND_MIN, SHARE_MIN, PDF_MIN = 0.6, 0.5, 0.6
LOOK_FOUND, LOOK_SHARE, LOOK_PDF = 0.45, 0.4, 0.5
MIN_QSH, MIN_QS, MIN_TEXT = 4, 5, 200          # shingles for a question to count; questions for a bank paper to count; text shingles
OUT = paths.S + 'work/import/copy_check/'
RUNLOG = paths.S + 'work/import/batches.json'


def words(s):
    s = re.sub(r'\\[a-z]+', ' ', (s or '').lower())
    return re.findall(r'[a-z]{2,}|[0-9]+', s)


def shingles(w):
    return {' '.join(w[i:i + 3]) for i in range(len(w) - 2)}


def con():
    return sqlite3.connect('file:%s?mode=ro' % paths.DBS, uri=True)


def bank_questions(c):
    """{doc id: [question shingle sets]} for every paper with questions in the database."""
    txt = collections.defaultdict(list)
    for qid, t in c.execute('SELECT id, stem_latex FROM questions'): txt[qid].append(t or '')
    for qid, t in c.execute('SELECT question_id, latex FROM parts ORDER BY question_id, ordinal'): txt[qid].append(t or '')
    for qid, t in c.execute('SELECT question_id, latex FROM mcq_options ORDER BY question_id, label'): txt[qid].append(t or '')
    out = collections.defaultdict(list)
    for qid, doc in c.execute("SELECT q.id, q.document_id FROM questions q JOIN documents d ON d.id = q.document_id WHERE d.status != 'duplicate_file'"):
        s = shingles(words(' '.join(txt[qid])))
        if len(s) >= MIN_QSH: out[doc].append(s)
    return {d: qs for d, qs in out.items() if len(qs) >= MIN_QS}


def paper_files(inv, doc):
    return next((p['f'] for g in inv['groups'] for p in g['papers'] if p['id'] == doc), [doc])


def pdf_text(files):
    """Shingles of every file of the paper that is in src/; (shingles, missing files)."""
    sh, missing = set(), []
    for f in files:
        p = paths.SRC / f'{f}.pdf'
        if not p.exists(): missing.append(f); continue
        r = subprocess.run(['pdftotext', '-raw', str(p), '-'], capture_output=True, text=True)
        sh |= shingles(words(r.stdout))
    return sh, missing


def compare(P, bank):
    """Best bank paper for the text P: (found, share, n found, n questions, doc)."""
    best = (0, 0, 0, 0, None)
    for b, qs in bank.items():
        hit = [len(s & P) / len(s) for s in qs]
        n = sum(h >= 0.5 for h in hit)
        found = n / len(qs)
        if found > best[0]:
            best = (round(found, 2), round(sum(len(s & P) for s in qs) / sum(len(s) for s in qs), 2), n, len(qs), b)
    return best


def check(docs, bank, inv, c, before=None):
    """One result per paper, in order. bank: {doc: question shingles} to compare with (the paper's own files are left out);
    papers earlier in `docs` are compared PDF to PDF. before: {doc: bank docs it may be compared with} (evidence)."""
    task = dict(c.execute('SELECT id, task_type FROM documents'))
    label = dict(c.execute('SELECT id, display_label FROM documents'))
    res, seen = [], []
    for d in docs:
        files = paper_files(inv, d)
        r = {'doc': d, 'label': label.get(d), 'files': files}
        if task.get(d) == 'solutions':   # a guidelines file parsed for a paper already in the bank (api_import linked_note) matches its own paper
            res.append({**r, 'verdict': 'unchecked', 'why': 'guidelines file for a paper in the bank'}); continue
        P, missing = pdf_text(files)
        if d in missing:
            res.append({**r, 'verdict': 'missing', 'why': f'src/{d}.pdf is not on disk: stage the PDFs first'}); continue
        if len(P) < MIN_TEXT:
            res.append({**r, 'verdict': 'unchecked', 'why': 'no text layer (scan): cannot be compared without OCR'}); seen.append((d, P)); continue
        mine = set(files)
        b = {k: v for k, v in bank.items() if k not in mine and (before is None or k in before[d])}
        found, share, n, nq, orig = compare(P, b)
        r.update(found=found, share=share, matched=f'{n} of {nq}', of=orig, of_label=label.get(orig))
        pdf = max(((round(len(P & Q) / min(len(P), len(Q)), 2), e) for e, Q in seen if len(Q) >= MIN_TEXT), default=(0, None))
        r['pdf'], r['pdf_of'] = pdf
        if found >= FOUND_MIN and share >= SHARE_MIN:
            r.update(verdict='copy', why=f'{n} of {nq} questions of {label.get(orig)} (doc {orig}) are in it (found {found}, share {share})')
        elif pdf[0] >= PDF_MIN:
            r.update(verdict='copy', of=pdf[1], of_label=label.get(pdf[1]),
                     why=f'same text as {label.get(pdf[1])} (doc {pdf[1]}) earlier in this batch ({pdf[0]} of the smaller PDF\'s 3-shingles)')
        elif found >= LOOK_FOUND or share >= LOOK_SHARE or pdf[0] >= LOOK_PDF:
            r.update(verdict='look', why=f'partial overlap with {label.get(orig)} (doc {orig}): imported as normal; dedup links the shared questions')
        else:
            r['verdict'] = 'new'
        res.append(r)
        if r['verdict'] != 'copy': seen.append((d, P))
    return res


def show(res):
    for r in res:
        extra = f"found {r['found']:.2f} share {r['share']:.2f} pdf {r['pdf']:.2f}  best: {r['of_label']} ({r['of']})" if 'found' in r else ''
        print(f"  {r['verdict']:9} {r['doc']:>5} {str(r['label'])[:44]:44} {extra}")
        if r['verdict'] in ('copy', 'missing', 'unchecked'): print(f"            {r['why']}")


def now():
    from zoneinfo import ZoneInfo
    return datetime.datetime.now(ZoneInfo('Australia/Sydney'))


def record(batch, res):
    """Record each copy in the database (after a backup) and take it out of the import run log's batch."""
    cps = [r for r in res if r['verdict'] == 'copy']
    if not cps: return
    c = con()
    done = [r['doc'] for r in cps if c.execute('SELECT 1 FROM questions WHERE document_id=?', (r['doc'],)).fetchone()]
    if done: sys.exit(f"STOP: {done} already have questions in the database: not recorded (a copy found after import is the owner's call)")
    t = now()
    bdir = paths.P + 'archive/' if 'QG_DB' not in os.environ else os.path.dirname(os.path.abspath(paths.DBS)) + '/'   # tests back up beside their copy
    os.makedirs(bdir, exist_ok=True)
    bak, k = bdir + f'questions_before_copycheck_{t:%Y%m%d_%H%M%S}.db', 1
    while os.path.exists(bak): k += 1; bak = bdir + f'questions_before_copycheck_{t:%Y%m%d_%H%M%S}_{k}.db'
    src = sqlite3.connect(paths.DBS); dst = sqlite3.connect(bak); src.backup(dst); dst.close()
    print('backup:', bak)
    for r in cps:
        for f in r['files']:
            src.execute("UPDATE documents SET status='duplicate_file', failure_reason=? WHERE id=?",
                        (f"copy of document {r['of']}: same questions as {r['of_label']} (copy check {t:%d %b}, {r['why']}); "
                         f'owner 23 Nov "yes I do want c as well."', f))
    src.commit(); src.close()
    L = json.load(open(RUNLOG)) if os.path.exists(RUNLOG) else {'batches': []}
    if any(b['id'] == batch for b in L['batches']):
        for b in L['batches']:
            if b['id'] != batch: continue
            out = {r['doc'] for r in cps}
            keep = [(i, p) for i, p in zip(b['ids'], b.get('papers') or [None] * len(b['ids'])) if i not in out]
            b['ids'] = [i for i, _ in keep]
            if b.get('papers'): b['papers'] = [p for _, p in keep]
            b.setdefault('copies', []).extend({'doc': r['doc'], 'label': r['label'], 'of': r['of'], 'of_label': r['of_label']} for r in cps)
        json.dump(L, open(RUNLOG, 'w'), indent=1, ensure_ascii=False)


def run_check(a):
    import inventory
    c = con()
    inv = inventory.build(con(), files=True)
    res = check(a.ids, bank_questions(c), inv, c)
    os.makedirs(OUT, exist_ok=True)
    rep = {'at': now().isoformat(timespec='seconds'), 'batch': a.batch, 'applied': a.apply,
           'thresholds': {'found': FOUND_MIN, 'share': SHARE_MIN, 'pdf': PDF_MIN}, 'papers': res}
    print(f'copy check {a.batch}: {len(res)} papers')
    show(res)
    miss = [r['doc'] for r in res if r['verdict'] == 'missing']
    cps = [r['doc'] for r in res if r['verdict'] == 'copy']
    if miss:
        json.dump(rep, open(OUT + f'{a.batch}.json', 'w'), indent=1)
        sys.exit(f'STOP: {len(miss)} paper(s) without their PDF in src/ ({miss}): stage them, then run the check again')
    if a.apply: record(a.batch, res)
    json.dump(rep, open(OUT + f'{a.batch}.json', 'w'), indent=1)
    keep = [r['doc'] for r in res if r['verdict'] != 'copy']
    if cps and a.apply:
        print(f'{len(cps)} copies recorded ({cps}); run python3 tools/inventory.py to take them out of their lane batch')
    print('KEEP:', ' '.join(map(str, keep)))
    if cps and not a.apply: sys.exit(3)


def run_evidence(a):
    """Every paper of the named batches against the bank as it was before its batch (run log order; papers in no logged batch
    count as earlier, the pilot), and PDF to PDF against the papers before it in its own batch."""
    import inventory
    c = con()
    inv = inventory.build(con(), files=True)
    L = json.load(open(RUNLOG))['batches']
    pos = {i: n for n, b in enumerate(L) for i in b['ids']}
    bank = bank_questions(c)
    allres = []
    for name in a.batches:
        b = next(x for x in L if x['id'] == name)
        k = pos[b['ids'][0]]
        before = {d: {e for e in bank if pos.get(e, -1) < k} for d in b['ids']}
        print(f'{name}:')
        res = check(b['ids'], bank, inv, c, before)
        show(res); allres += res
    n = collections.Counter(r['verdict'] for r in allres)
    print('verdicts:', dict(n), '| copies:', [(r['doc'], r['of']) for r in allres if r['verdict'] == 'copy'])


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('check'); p.add_argument('batch'); p.add_argument('ids', nargs='+', type=int); p.add_argument('--apply', action='store_true')
    p = sub.add_parser('evidence'); p.add_argument('batches', nargs='+')
    a = ap.parse_args()
    run_check(a) if a.cmd == 'check' else run_evidence(a)


if __name__ == '__main__':
    main()
