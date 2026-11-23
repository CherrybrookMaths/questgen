"""Stale labels and notes (owner 24 Nov: "Can u also make sure there aren't any more stale numbers or tags hanging"; and the
"CONFIDENCE 0%" badge on a correct, corrected MCQ solution he sent as a bug). Idempotent; run after tools/source_corrections.py.

  python3 tools/stale_fixes.py                   apply the fixes below to the database
  python3 tools/stale_fixes.py --calls <export>  drop the Your calls (site/project/open_decisions.json) the owner has answered
                                                 "keep as is", from an export of the page-db reviews collection

confirm(db, sid, verify_file, note): the rule for every later fix. A solution corrected to the independent checker's own answer
(tools/api_import.py verify, state/work/<batch>/verify_out_*.json) records meta.checker_confirms; for a solution Claude wrote, the
generation-time confidence, self_check and generated_note described the old text (a placeholder written without the question's
table), so they move to meta.before_checker and the badge says the checker confirmed the answer (04_solutions.js). tools/triage.py
reads checker_confirms: such a correction needs no call from the owner, and the reason says the solution was corrected."""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import glob, json, os, re, sqlite3, sys

GEN_STALE = ('confidence', 'self_check', 'generated_note', 'check')


def verdict(verify_file, qid):
    for r in json.load(open(paths.S + verify_file))['results']:
        if r['question_id'] == qid: return r
    raise SystemExit(f'{verify_file}: no result for question {qid}')


def confirm(db, sid, verify_file, note=None):
    """Record that solution sid now gives the checker's own answer (verify_file is relative to state/)."""
    src, m, qid = db.execute('select s.source, s.meta_json, coalesce(s.question_id, p.question_id) from solutions s left join parts p on p.id=s.part_id where s.id=?', (sid,)).fetchone()
    m = json.loads(m or '{}')
    if m.get('checker_confirms'): return False
    r = verdict(verify_file, qid)
    m['checker_confirms'] = f'{verify_file}: the checker\'s answer is {r.get("my_answers")}' + (f'; {note}' if note else '')
    if src == 'generated':
        old = {k: m.pop(k) for k in GEN_STALE if k in m}
        if old: m['before_checker'] = old
    db.execute('update solutions set meta_json=? where id=?', (json.dumps(m, ensure_ascii=False), sid))
    return True


# 24 Nov, 5(c): MCQ working Claude wrote without the question's table (the gen step never sent \extable data, fixed in
# tools/api_import.py tables_in): the key was right (the checker agrees) but the working stopped at the formula. Written out in full.
REWRITE = {
 5629: r"""The mean is $\bar{x}=\dfrac{\sum xf}{\sum f}$. From the table:
$$\begin{aligned} \sum f &= 2+k+2+8 = 12+k \\ \sum xf &= 2(2)+4k+6(2)+8(8) = 80+4k \end{aligned}$$
$$\begin{aligned} \dfrac{80+4k}{12+k} &= 5.6 \\ 80+4k &= 67.2+5.6k \\ 12.8 &= 1.6k \\ k &= 8 \end{aligned}$$
$$\therefore\ k=8 \quad\text{(D)}$$""",
 6562: r"""The relative frequencies add to $1$, so the entry for one tyre is
$$\begin{aligned} x &= 1-(0.65+0.05+0.05+0.05) \\ &= 0.2 \end{aligned}$$
$$\therefore\ 0.2 \quad\text{(B)}$$""",
 6692: r"""Only the over 30-year-olds count, so use the "Over 30 years old" row of the table: $34$ of the $157$ watch Anime.
$$\begin{aligned} \dfrac{34}{157}\times 100\% &\approx 21.7\% \\ &\approx 22\% \end{aligned}$$
(Dividing by the survey total of $370$ would give a percentage of everyone surveyed, which is not what is asked.)
$$\therefore\ 22\% \quad\text{(C)}$$""",
 7345: r"""Compare the marks with $z$-scores, $z=\dfrac{x-\mu}{\sigma}$:
$$\begin{aligned} \text{Economics: } z &= \dfrac{64-60}{3} \approx 1.33 \\ \text{Maths: } z &= \dfrac{71-60}{10} = 1.1 \\ \text{Art: } z &= \dfrac{82-60}{18} \approx 1.22 \\ \text{Chemistry: } z &= \dfrac{69-60}{5} = 1.8 \end{aligned}$$
Chemistry has the highest $z$-score.
$$\therefore\ \text{Chemistry} \quad\text{(D)}$$""",
 8250: r"""The probabilities add to $1$:
$$\begin{aligned} a+3a+5a+7a &= 1 \\ 16a &= 1 \\ a &= \dfrac{1}{16} \end{aligned}$$
$$\begin{aligned} E(X) &= 0(a)+1(3a)+2(5a)+3(7a) \\ &= 34a \\ &= \dfrac{34}{16} = \dfrac{17}{8} \end{aligned}$$
$$\therefore\ E(X)=\dfrac{17}{8} \quad\text{(D)}$$""",
 8259: r"""The probabilities add to $1$:
$$\begin{aligned} 2q+6q+3q+4q &= 1 \\ 15q &= 1 \\ q &= \dfrac{1}{15} \end{aligned}$$
$$\begin{aligned} E(X) &= 0(2q)+1(6q)+2(3q)+3(4q) \\ &= 24q \\ &= \dfrac{24}{15} = \dfrac{8}{5} \end{aligned}$$
$$\therefore\ E(X)=\dfrac{8}{5} \quad\text{(B)}$$""",
}
REWRITE[7760] = REWRITE[7345]   # the same question in a second copy of the paper (2021 King's AT2 / doc 1051)
# solution -> the verify result whose answer it now gives (the verify_fixes 23 Nov rewrites, the C17-C19 key corrections, the
# REWRITE workings above, and the corrected guideline solutions whose "Why this is here" still repeated the checker's report)
CONFIRM = {
 6570: 'work/s1/verify_out_15_1.json', 6573: 'work/s1/verify_out_15_2.json', 6628: 'work/s1/verify_out_38_1.json',
 6685: 'work/s1/verify_out_40_1.json', 6579: 'work/s1/verify_out_16_1.json', 7310: 'work/b16/verify_out_1311_2.json',
 7749: 'work/b17/verify_out_1035_1.json',
 5629: 'work/b13/verify_out_1344_1.json', 6562: 'work/s1/verify_out_15_1.json', 6692: 'work/s1/verify_out_40_1.json',
 7345: 'work/b16/verify_out_1315_1.json', 7760: 'work/b17/verify_out_1051_1.json', 8250: 'work/b18/verify_out_1273_1.json',
 8259: 'work/b18/verify_out_1281_1.json',
 6522: 'work/s1/verify_out_15_2.json', 6545: 'work/s1/verify_out_15_3.json', 2730: 'work/b6/verify_out_2.json',
 2797: 'work/b6/verify_out_3.json', 2798: 'work/b6/verify_out_3.json', 6476: 'work/s1/verify_out_722_2.json',
 6519: 'work/s1/verify_out_16_1.json',
}
NOTE = {sid: 'working written out from the table (Claude 24 Nov)' for sid in REWRITE}


def apply(db):
    n = {'rewritten': 0, 'confirmed': 0, 'sketch_notes': 0}
    for sid, lat in REWRITE.items():
        l, m = db.execute('select latex, meta_json from solutions where id=?', (sid,)).fetchone()
        if l == lat: continue
        m = json.loads(m or '{}'); m.setdefault('source_original', l)
        m['correction_note'] = 'Claude 24 Nov: the working was written without the question\'s table and stopped at the formula; written out from the table (key unchanged)'
        db.execute('update solutions set latex=?, meta_json=? where id=?', (lat, json.dumps(m, ensure_ascii=False), sid)); n['rewritten'] += 1
    for sid, f in CONFIRM.items(): n['confirmed'] += confirm(db, sid, f, NOTE.get(sid))
    # format_note "Sketch still to draw: ..." on solutions whose sketch the diagram step has since drawn (internal note; 124 of 131)
    allr = {r['id']: r for r in json.load(open(paths.S + 'tikz/all_results.json'))}
    figs = {os.path.basename(p)[:-4] for (p,) in db.execute('select png_path from figures')}
    for sid, m, l in db.execute("select id, meta_json, latex from solutions where meta_json like '%Sketch still to draw%'").fetchall():
        m = json.loads(m); fn = m.get('format_note') or ''
        ks = re.findall(r'\\exfigure\{([^}]+)\}', l)
        if re.match(r'Sketch still to draw: none (needed|required)', fn): new = re.sub(r'^Sketch still to draw: none (needed|required)[^;.]*[;.]?\s*', 'No sketch needed. ', fn)
        elif ks and all(k in figs and allr.get(k, {}).get('status') in ('ok', 'approx', 'table', 'keep_crop') for k in ks):
            new = fn.replace('Sketch still to draw:', 'Sketch drawn (' + ', '.join(ks) + '); it was to show:', 1)
        else: continue
        if new != fn:
            m['format_note'] = new; db.execute('update solutions set meta_json=? where id=?', (json.dumps(m, ensure_ascii=False), sid)); n['sketch_notes'] += 1
    db.commit()
    print('stale_fixes:', n)


def calls(export):
    """Remove Your calls the owner answered "keep as is" (an approval at or after the call was raised); answers with a change
    ("Label it AT4") stay listed until the change is made."""
    f = paths.P + 'site/project/open_decisions.json'; dec = json.load(open(f))
    docs = {}
    for p in glob.glob(os.path.join(export, 'reviews', '*.json')):
        d = json.load(open(p)); docs[os.path.basename(p)[:-5].replace('@', '~')] = d
    byq = {}
    for d in docs.values():
        if d.get('question_id'): byq.setdefault(str(d['question_id']), []).append(d)
    gone = []
    for k, e in list(dec.items()):
        raised = e.get('raised') or ''
        if k.startswith('paper_'):
            ans = [d.get('call') for d in docs.values() if str(d.get('doc')) == k[6:] and d.get('call')]
            if any(a.get('status') == 'approved' and str(a.get('at', '')) >= raised[:19] for a in ans): gone.append(k)
        else:
            rs = byq.get(k, []) + ([docs['q' + k]] if 'q' + k in docs else [])
            if any(d.get('status') == 'approved' and str(d.get('call_at') or (d.get('at') if not raised else '')) >= raised[:19] for d in rs): gone.append(k)
    for k in gone: dec.pop(k)
    json.dump(dec, open(f, 'w'), ensure_ascii=False, indent=1)
    print(f'Your calls answered "keep as is", removed: {gone}; still open: {len(dec)}')


if __name__ == '__main__':
    if '--calls' in sys.argv: calls(sys.argv[sys.argv.index('--calls') + 1])
    else: apply(sqlite3.connect(paths.DBS))
