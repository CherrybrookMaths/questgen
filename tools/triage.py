"""Decide what the owner must look at (owner 12 Nov: "I don't have time to check 6000 questions").
Every imported question gets q.tri in bank.json (merged by build_bank.py):
  tier  'decide'  only the owner can decide (source corrections, possible source errors, borderline syllabus calls)
        'check'   an automatic check or the independent verifier could not clear it
        'sample'  random spot-check (10% of a paper's cleared questions, at least 3); a clean sample approves the paper
        'auto'    cleared by every check (used in the Bank straight away)
        'pending' checks still running (not shown in the owner's queue yet)
  why   plain-English reasons; look: what to check; ok_figs / ok_sols: redraws and Claude-written solutions cleared
  automatically; chk_figs: redraws that need a look.
Inputs: database, work/verify/render.json (render_audit.js), work/*/verify_out_*.json, tikz/all_results.json.
Usage: python3 triage.py  -> work/triage.json and a summary."""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import sqlite3, json, glob, re, os, hashlib, collections
import pymupdf
P = paths.P
db = sqlite3.connect(paths.DBS); db.row_factory = sqlite3.Row
S = json.load(open(paths.S + 'work/import/batches.json'))
DOCS = [i for b in S['batches'] for i in b['ids']]
# 23 Nov (owner: "why are there no spot checks in the std papers?"): Standard batches run through tools/api_import.py and are not
# in work/import/batches.json, so 8 of the pilot's 9 papers were never triaged (no Spot-check step). Add every other lane's papers
# that are in the database (work/batches.json, tools/batches.py).
_L = json.load(open(paths.S + 'work/batches.json'))['lanes'] if os.path.exists(paths.S + 'work/batches.json') else {}
_have = {r[0] for r in db.execute('select distinct document_id from questions')}
DOCS += [i for ln, v in _L.items() if not ln.startswith('advanced|') for b in v.get('batches', []) for i in b if i in _have and i not in DOCS]
render = {x['id']: x['err'] for x in json.load(open(paths.S + 'work/verify/render.json'))['problems']} if os.path.exists(paths.S + 'work/verify/render.json') else {}
render_done = os.path.exists(paths.S + 'work/verify/render.json')
ver = {}
for f in glob.glob(paths.S + 'work/*/verify_out_*.json'):
    try:
        for r in json.load(open(f))['results']: ver[r['question_id']] = r
    except Exception: pass
figres = {r['id']: r for r in json.load(open(paths.S + 'tikz/all_results.json'))}
cropflag = {f['id'] for f in json.load(open(paths.S + 'work/crop_flags.json'))} if os.path.exists(paths.S + 'work/crop_flags.json') else set()
pdfs = {}
def pagewords(doc, a, b):
    if doc not in pdfs: pdfs[doc] = pymupdf.open(P + f'src/{doc}.pdf')
    d = pdfs[doc]; t = ' '.join(d[i].get_text() for i in range(max(0, a), min(d.page_count, b + 1)))
    return set(w.lower() for w in re.findall(r'[A-Za-z]{4,}', t))
def words(s):
    s = re.sub(r'\\[a-zA-Z]+', ' ', s or ''); return [w.lower() for w in re.findall(r'[A-Za-z]{4,}', s)]

out = {}; stats = collections.Counter(); nopdf = set()
OLD = json.load(open(paths.S + 'work/triage.json')) if os.path.exists(paths.S + 'work/triage.json') else {}   # the last run (16 Nov: missing PDFs)
for doc in DOCS:
    drow = db.execute('select * from documents where id=?', (doc,)).fetchone()
    for q in db.execute('select * from questions where document_id=? order by id', (doc,)).fetchall():
        qid = q['id']; why, look, decide = [], [], []
        parts = db.execute('select * from parts where question_id=? order by ordinal,id', (qid,)).fetchall()
        kids = {p['parent_part_id'] for p in parts}
        sols = db.execute('select s.* from solutions s left join parts p on p.id=s.part_id where coalesce(s.question_id,p.question_id)=?', (qid,)).fetchall()
        opts = db.execute('select * from mcq_options where question_id=?', (qid,)).fetchall()
        # --- automatic checks
        if qid in render: why.append('Does not display correctly: ' + '; '.join(render[qid][:2])); look.append('Fix the display error shown in red')
        # 16 Nov: the Drive connector cannot download PDFs over 10 MB, so a cloud session may lack some papers in src/: their
        # wording check keeps the result of the last run that had the PDF (state triage.json), so no question changes tier
        # just because a file is missing here
        if drow['parse_path'] == 'digital' and q['page_start'] is not None and not os.path.exists(P + f'src/{doc}.pdf'):
            nopdf.add(doc)
            for w in (OLD.get(str(qid)) or {}).get('why') or []:
                if w.startswith('Wording differs from the PDF text'):
                    why.append(w); look.append('Compare the wording with the source page')
        elif drow['parse_path'] == 'digital' and q['page_start'] is not None:
            ws = words(' '.join([q['stem_latex'] or ''] + [p['latex'] for p in parts] + [o['latex'] for o in opts]))
            if len(ws) >= 6:
                pw = pagewords(doc, q['page_start'], q['page_end'] if q['page_end'] is not None else q['page_start'])
                cov = sum(w in pw for w in ws) / len(ws)
                if cov < 0.8: why.append(f'Wording differs from the PDF text ({round(cov*100)}% of words match)'); look.append('Compare the wording with the source page')
        leafm = [p['marks'] for p in parts if p['id'] not in kids]
        if q['marks_total'] is not None and all(m is not None for m in leafm) and leafm and sum(leafm) != q['marks_total'] and q['question_type'] != 'mcq':
            why.append(f"Part marks add to {sum(leafm)} but the question is worth {q['marks_total']}"); look.append('Check the marks')
        if q['question_type'] == 'mcq':
            k = sum(1 for o in opts if o['is_correct'] == 1)
            if k != 1: why.append('Multiple-choice key missing or not unique'); look.append('Set the correct option')
            if any(o['key_source'] == 'generated' for o in opts if o['is_correct'] == 1): why.append('Answer key written by Claude (no official key)')
        if drow['parse_path'] == 'scan': look.append('Scanned paper: compare the question with the source page')
        # --- solutions
        ok_sols = []
        for s in sols:
            m = json.loads(s['meta_json'] or '{}')
            if m.get('corrected'):
                vv = ver.get(qid)
                if not (vv and vv.get('answer_ok') is True): decide.append(m['corrected'][:220])   # a correction the independent checker confirms needs no call from the owner (note stays on the solution)
            elif m.get('edited_from_original'): why.append('Question edited from the original to fix an error: ' + m['edited_from_original'][:200]); look.append('Check the edited question and solution')   # owner 12 Nov: "Fix it"
            elif m.get('source_flag') and not m.get('criteria_inferred'): decide.append('Possible error in the source solution: ' + m['source_flag'][:200])
            cn = re.sub(r'^\s*transcribed from handwritten[^;]*;?\s*', '', m.get('concern') or '', flags=re.I).strip()   # "typed from handwriting" alone is not a reason: the checker re-solves every answer
            info_only = re.search(r'circled answer|no (mark(ing)? )?criteria|no breakdown|breakdown of the|marks? (split|breakdown)|shows [\d +]+marks|sketch cropped|cropped from|rubric', cn, re.I) \
                        or (s['source'] == 'generated' and (m.get('confidence') or 0) >= 0.9)   # shown on the card, not a reason to check
            if cn and not info_only: why.append('Solution note: ' + cn[:200]); look.append('Read the solution')
            if s['source'] == 'generated':
                c = m.get('confidence')
                if c is not None and c < 0.9: why.append(f'Claude-written solution, confidence {c}'); look.append('Check the solution')
                else: ok_sols.append(s['id'])
        # owner 12 Nov: "I don't need to check if its just a syllabus change one" -> syllabus calls (incl. borderline) are never a reason to look
        alltext = ' '.join([q['stem_latex'] or ''] + [p['latex'] for p in parts] + [o['latex'] for o in opts] + [s['latex'] for s in sols])
        if '\\extable{' in alltext or (q['options_table_json'] or ''):
            why.append('Contains a table: compare every cell with the source page'); look.append('Check the table against the source page')
        # --- independent verifier
        v = ver.get(qid)
        if v:
            if v.get('question_ok') is False: why.append('Checker: question may differ from the paper — ' + (v.get('question_issue') or '')[:220]); look.append('Compare with the source page')
            resolved = any(json.loads(x['meta_json'] or '{}').get('overwritten_from_source') or json.loads(x['meta_json'] or '{}').get('checked_source_ok') or json.loads(x['meta_json'] or '{}').get('edited_from_original') for x in sols)   # owner 12 Nov: "if you are certain the source is wrong ... just overwrite it"
            if v.get('answer_ok') is False and not resolved:
                src = {s['source'] for s in sols}
                msg = 'Checker got a different answer — ' + (v.get('answer_issue') or '')[:240]
                (decide if 'extracted' in src and 'generated' not in src else why).append(msg); look.append('Check the answer')
        # --- diagrams
        ok_figs, chk_figs, pend_figs = [], [], []
        for f in db.execute('select * from figures where question_id=?', (qid,)):
            k = os.path.basename(f['png_path'])[:-4]; r = figres.get(k)
            if not r: pend_figs.append(k); continue
            if r['status'] == 'keep_crop': continue
            ov = r.get('overlay') or [1, 1]
            try: ovmin = min(float(x) for x in ov)
            except Exception: ovmin = 1
            notes = (r.get('notes') or '').lower()
            if k in cropflag: why.append('The crop of the original may cut off part of the diagram')
            chk_figs.append(k); continue   # owner 12 Nov: "I need to check every diagram and table" -> no redraw is cleared automatically
            if r['status'] in ('approx', 'table') or ovmin < 0.8 or re.search(r'wrong|incorrect|corrected|should be|mismatch|could not|unsure', notes):
                chk_figs.append(k)
            else: ok_figs.append(k)
        if chk_figs: look.append('Look at the redrawn diagram' + ('s' if len(chk_figs) > 1 else ''))
        # --- tier
        pending = (not render_done) or v is None or bool(pend_figs)
        tier = 'decide' if decide else 'check' if why and any(not w.startswith('Answer key written') for w in why) else 'pending' if pending else 'auto'
        out[qid] = dict(tier=tier, doc=doc, why=decide + why, look=list(dict.fromkeys(look)), ok_figs=ok_figs, chk_figs=chk_figs, ok_sols=ok_sols)
# random spot-check per paper among cleared questions (stable: hash of the question id)
by = collections.defaultdict(list)
for qid, t in out.items():
    if t['tier'] == 'auto': by[t['doc']].append(qid)
# owner 12 Nov (Knox AT2 re-triage): a sample the owner already reviewed stays the sample; new cleared questions never reshuffle it
LOCK = paths.S + 'work/sample_locked.json'
locked = set(json.load(open(LOCK))) if os.path.exists(LOCK) else {k for k, v in json.load(open(P + 'work/triage_before_b5merge.json')).items() if v['tier'] == 'sample'}
for doc, ids in by.items():
    n = len(ids); k = min(n, max(3, -(-n // 10)))
    keep = [i for i in ids if str(i) in locked]
    for qid in (keep + [i for i in sorted(ids, key=lambda i: hashlib.md5(str(i).encode()).hexdigest()) if str(i) not in locked])[:max(k, len(keep))]:
        out[qid]['tier'] = 'sample'; out[qid]['why'] = ['Random spot-check: passed every automatic check'] + out[qid]['why']
        out[qid]['look'] = ['Read the question and solution against the source page'] + out[qid]['look']
json.dump(out, open(paths.S + 'work/triage.json', 'w'))
json.dump(sorted(str(k) for k, v in out.items() if v["tier"] == "sample"), open(LOCK, "w"))
# batch_check: triage is stale when the database content has changed since this run
import hashlib as _h; json.dump(dict(db_sha=_h.sha256(open(paths.DBS, "rb").read()).hexdigest()), open(paths.S + "work/triage_inputs.json", "w"))
c = collections.Counter(t['tier'] for t in out.values())
print(json.dumps(dict(questions=len(out), **c, diagrams_to_check=sum(len(t['chk_figs']) for t in out.values() if t['tier'] != 'pending'),
                      diagrams_cleared=sum(len(t['ok_figs']) for t in out.values()))))
