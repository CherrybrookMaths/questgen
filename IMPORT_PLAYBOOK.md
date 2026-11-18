# Import playbook: from a paper PDF to approved questions in the bank

> 14 Nov: start from CLAUDE.md. State files named below by their old paths (`work/import/`, `work/triage.json`, `tikz/tex/`,
> `tikz/all_results.json`, `out/`, `site/data/bank_v1.json`, ...) now live under `state/` at the same relative path; the database
> is `$QG_DB` (tools/paths.py).

Owner: Steve Yeung (CMC Education). Written 12 Nov 2026, after the full Year 12 Advanced import and review. Steve asked: "have you learnt lots about importing and tagging questions now? Is that logged somewhere?" and then said "yeah".

This file covers **how** to run an import. **What** the owner wants is in the specs, which have the final say:

- PARSE_SPEC: transcription and old syllabus.
- TAG_SPEC: tags and home topic.
- SOLUTION_SPEC: solutions and criteria.
- DIAGRAM_SPEC and DIAGRAM_FEEDBACK_LOG: redraws.
- VERIFY_SPEC: the independent checker.

Page/UI decisions: UI_SPEC.md. **Page code: edit `page_src/`, then run `python3 tools/build_page.py`; never edit `site/review.html` directly** (it is generated). A new Claude session has no memory of earlier ones. Read this file, RESUME.md and the specs before touching a batch.

## The pipeline, in order

Run one batch at a time, about 9 papers per batch.

| # | Step | Tool | Done when |
|---|------|------|-----------|
| 1 | Stage PDFs | `work/import/papers.json`, `src/<id>.pdf` | Every paper and its solutions PDF are on disk |
| 2 | Parse | workflow `parse-batch` (PARSE_SPEC), one agent per paper | Each paper has a parse output |
| 3 | Load | `load.py <ids>`, then `house_style.py`, `tables.py`, `dedup.py <ids>`, `relabel_split.py` (split questions lose the outer letter) | Questions are in the DB, with duplicate copies hidden |
| 4 | Tag | TAG_SPEC agents, then `load_tags_batch.py` | Every answerable part is tagged and lead-in parts have no tags |
| 5 | Solutions | solution formatting (SOLUTION_SPEC), missing solutions, inferred criteria | Every part has a solution and criteria |
| 6 | Redraw diagrams | DIAGRAM_SPEC agents → `tikz/result_<batch>_*.json` → **`apply_diagrams.py` on every result file** → `tikz_render.sh` | `batch_check` shows no unmerged redraws |
| 7 | Verify | `prep_verify.py`, workflow `batch-verify` (VERIFY_SPEC), `render_audit.js` | `verify_out_*.json` for every question |
| 8 | Triage | `triage.py` | No `pending` questions |
| 9 | Build | `build_bank.py` | `bank.json` and every `svg/<doc>.json` are rebuilt |
| 10 | Check | **`bash tools/prepublish.sh`**: build, export sources, page test, `batch_check.py` (see "Pre-publish page test" below) | It exits 0: every page check passed and 0 blockers. Publish exactly what `python3 tools/publish_set.py` lists (`--json` for the `files` map; its null entries delete files the artifact no longer needs, keep them), then `batch_check.py --mark-published` |
| 11 | Publish | Artifact publish of review.html plus **every** changed data file in one call (and any changed `site/vendor/` file: the map is `files` in tools/vendor_manifest.json), then `batch_check.py --mark-published` | The manifest is recorded |
| 12 | Homes and sync | the page's own home topic per new question into the DB (`node tools/homes.js <doc ids>` with site/ served on port 8766, 16 Nov: the page's own qHome, headless), then `python3 tools/home_rules.py <reviews export> --write` (owner filing rules, e.g. compound interest -> Financial mathematics, 17 Nov) and apply its ArtifactData batch; Drive sync (rename old copies "superseded", never trash) | Drive is current |

Whenever a background job starts or ends, update the jobs pill (db doc `progress/jobs`). Keep the owner's queued requests in db doc `progress/queue` too (`{items:[{id,title,detail,status:'queued'|'running'|'done',order,asked}],updated}`): it feeds the "N queued" pill and the Processes page (14 Nov).

## Models per step (16 Nov; owner: "I want improt to run tonight with teh optimal model layout", then "go")
Agents are started with the Agent tool's `model`; no API needed (owner: "I can't get the API working by tmrw. Does that mean we
are stuck using opus?"). Evidence: the owner's external trial (3 papers, 94 questions, blind-marked 16 Nov: Opus 129 / Sonnet 130 /
Haiku 123 of 131 written parts correct; Haiku left out or leaked diagrams in ~12 places) and the tagging test (paper 296, 42 parts:
main dot point exact Opus 34, Sonnet 27, Haiku 27).
| Step | Model |
|---|---|
| Parse (PARSE_SPEC) | sonnet |
| Solutions: formatting, missing solutions, criteria (SOLUTION_SPEC) | sonnet |
| Tag (TAG_SPEC) | opus |
| Diagrams (DIAGRAM_SPEC), verify (VERIFY_SPEC) | opus |
Haiku is not used. Files over 10 MB cannot come through the Drive connector: use a smaller copy of the same paper (a combined
"w Solutions" file) when there is one; otherwise import the questions and generate solutions (marked in the solution note).

## Import through the API (17 Nov, Batch 8)
Owner 17 Nov: "I want to do batch 8 via the api so we can get a cost estimate"; "we'll need API for usage limits too right? Lets just
set it up?"; on the key: "yes yes use qg anthropic key" (environment variable `QG_ANTHROPIC_API_KEY`; never printed or stored).
`tools/api_import.py <step> <batch>` runs the model steps (parse, split, tag, solfmt, gen, diagrams, verify) through the Messages API with
the same specs and the models above (Sonnet: parse, split, solutions; Opus: tagging, diagrams, verify), one run per paper (or chunk), so
each paper's cost is exact. The local steps between them are unchanged (load.py, post_load.py, split_batch.py, relabel_split.py,
prep_batch.py, apply_text.py, apply_diagrams.py, prep_verify.py, triage.py, add_to_bank.py, build_bank.py). Every call is logged with its
tokens and US$ (state/work/api_import/<batch>/calls.jsonl); `api_import.py cost <batch>` prints the table and writes cost.json.
Order used for Batch 8: parse → load.py → post_load.py → split_batch.py prep → split → split_batch.py apply → relabel_split.py →
prep_batch.py → tag + solfmt + gen (parallel) → apply_text.py → difficulty → difficulty-apply → apply_difficulty_reviews.py <difficulty export> → diagrams → apply_diagrams.py → prep_verify.py → verify → fix the
verifier's findings (source_corrections.py) → triage.py → add_to_bank.py → build_bank.py → render audit, recrop --check, prepublish.
Batch 8 result: 8 papers, 150 questions, US$22.65 (parse 3.54, split 0.04, tag 3.80, solutions 1.20, diagrams 9.48, verify 4.61),
about 35 minutes of model time with papers in parallel. Diagrams (Opus, with renders and overlays fed back) are 42% of the cost.
Lessons (each fixed in the tool):
- A writer closure picked up the last paper's part ids, so 7 of 8 tag files were written empty (recovered from the transcripts).
- The API refuses images over 2,000 px a side in requests with many images: images are scaled to 1,900 px.
- The split step proposed splitting "Find the first derivative of the following" lists; the bank keeps all 22 such lists together,
  so the 2 splits were not applied and the rule is in the split prompt.
- The formatter put "the source is consistent" notes in content_flags (12 Decide items for 8 papers, the 16 Nov Batch 6 lesson
  again) and invented a sketch key "2023kings_q15_s1": the solfmt prompt now says both, and its check rejects unknown figure keys;
  a sketch it asks for is queued for the diagrams step.

Difficulty (18 Nov). Owner: "Yeah can u do that to the API tool please? Also we need to assign difficulty to the questions in the bank
which aren't assigned." (to adding a difficulty step, on Opus). No import step rated difficulty after the 13 Nov pass: batches 6-8
and 288 later-added parts (1,337 leaf parts) had none. `api_import.py difficulty <batch>` rates every unrated leaf part the Bank
shows (DIFFICULTY_SPEC) against the HSC reference parts at their ORIGINAL ratings; `difficulty-apply` writes them to part_difficulty
(prompt_version diff-v1-api, source model), then `tools/apply_difficulty_reviews.py <export of difficulty>` carries the owner's
reference corrections onto them. New parts are never references. Run it after tagging (the area comes from the primary dot point).

Owner after Batch 8 (17 Nov): "not yet. no importing until i escelate this new prediction." and "the monthly limit is $300 right now.
I can change it later. remind me when we resume imports." The key's limit is US$300 a month: about 6-12 batches of 9 at the measured
US$25-45 a batch. Remind him of it before the first import after the hold.
Resumed 18 Nov: owner "Run batch 9, keep track of cost", then "use the api yeah" (reminded of the US$300 limit first; about US$32 spent
this month by then). Batch 9 left out 1053 (King's AT4, 12.5 MB PDF, over the Drive connector's 10 MB) and 177 + its solutions 176 (labelled
"2022 Arden AT4" in the inventory but the same paper as 175, Arden 2022 Task 2: identical text page for page).
Batch 10 (18 Nov), verify lesson: the verifier was shown the school's crop of each solution sketch, not the bank's redraw, so it reported
4 sketches as wrong that the diagram step had already redrawn correctly (and missed checking the redraw itself). api_import.py now sends
tikz/png/<id>.png when a redraw exists; re-run on those 5 questions, all passed. The one real sketch error (2022 Baulkham Hills AT4 Q3,
triangle sides swapped in our redraw) was fixed.
Caching fix (18 Nov). Owner: "Lets try one more batch with NO batching but with the caching fixed and lets compare costs". Batches 9 and 10
paid more for cache writes than for output (B9 US$15.63 writes / US$1.39 reads / US$12.47 output; B10 US$20.18 / US$1.95 / US$18.89):
every run of a step started at once, so each wrote the same shared instructions and none read them, and single-turn steps marked the
whole one-off request for caching. api_import.py now runs one paper first until its first reply is back (the rest then read the
instructions at 0.1x) and marks the whole request only in multi-turn steps (parse, diagrams, verify). `cost` prints the split by kind.
Batch 11 is the comparison run (no Message Batches).

## Figure crops are build output, not backed up (17 Nov)
Owner 17 Nov: "What is realistic coding best practice in this case?" then "yeah build it and run the test". The crops
(`figures/<id>.png`) are cut from the exam PDFs at each figure's recorded page and bbox, so they are regenerated, not archived:
`python3 tools/recrop.py <doc ids>` re-cuts them (a solution figure from the file its parse output names). Before a batch is
published, with its PDFs in src/: `python3 tools/recrop.py --check --fix-bbox <batch doc ids>` must exit 0. It re-cuts every crop,
compares pixel by pixel, and where a parser padded its cut or cut from another page it finds where the crop really sits and
corrects the database. A crop edited after cutting (masked, greyscale, another rendering) is kept as source in
`state/figures_kept/` (git). Batch 6 test, 17 Nov: 173 of 175 identical after 28 bbox corrections (Manly and St George parsers
padded their cuts by 2-4 pt), 2 kept (382_q23_s1 masked strip, 416_q13_1 greyscale from the draft page), 5 blank grids under
new solution sketches (no recipe needed). The 992 older crops stay in the 14 Nov Drive tar until they are checked the same way.

## Mistakes we have made, and the rule each one taught

Each of these happened. `batch_check.py` catches the ones a script can catch.

### Pipeline

- **Redraws produced but never merged** (12 Nov). Batch 5's last redraw file was never run through `apply_diagrams.py`, so 9 questions sat as triage "pending". No review queue shows pending questions, so they were invisible. Rule: merge every `result_*.json`. *Checked: unmerged redraws, figures with no redraw, pending questions.*
- **Republished `bank.json` but not the SVG packs** (12 Nov). The page showed "Redraw missing". Rule: publish every changed file under `site/data/` in the same call. *Checked: the manifest diff.*
- **Re-triage reshuffled the spot-check sample** (12 Nov). It would have thrown away samples the owner had already reviewed. Rule: samples are locked in `work/sample_locked.json` once picked. *Checked.*
- **Moving a figure to another question drops the owner's approval.** Decisions are stored per question. Rule: when a figure moves, copy its `fig` decision to the new question's review doc.
- **Stale triage after DB edits.** *Checked: triage older than its inputs.*
- **Wrong workflow script launched** (12 Nov). It would have overwritten the main gate outputs. Rule: before starting a workflow, check which files it writes; pilot work writes to `work/*_pilot`.

- **Formatter notes flooded Decide** (16 Nov, Batch 6). The solution formatters put "needs drawn solution", "rubric written by us" and "working completed" in `content_flags`, which triage reads as a possible source error, so Batch 6 showed 63 Decide items for 8 real ones. Rule: `content_flags` only for a possible error in the source; everything else in `format_note` (SOLUTION_SPEC output). *Check: count Decide per batch after triage; more than ~1 per paper means look at the reasons.*
- **Solution figures recorded but never cut** (16 Nov, Batch 6). Two parsers listed solution figures by bbox without writing the PNG, so prep_batch left them out of every diagram group. Rule: after load, every `solution_figures` entry has its crop in `figures/` (crop any missing from its `source_pdf` page and bbox) before prep_batch.
- **Solution sketches cut but never attached** (17 Nov, Batch 7, Abbotsleigh AT1: 7 of the school's sketches were in solution_figures with no `\exfigure` in any solution; the formatter then flagged "needs drawn solution" and Write missing solutions asked for a new drawing of one that existed). Rule: after load, list every `<doc>_q*_s*` figure no solution references and attach it before the text step.
- **tables.py ran over the whole database** (16 Nov, Batch 6, via post_load.py): it re-converted the owner's display array in 2025 HSC Q8 ("the four integrals are a 2x2 layout ... not a table") and an approved solution's sign tables (reverted). Rule: after post_load, diff the older papers' text against the pre-batch backup; anything changed outside the batch is reverted unless the owner asked for it. **It happened again on 17 Nov (Batch 7: the same 2025 HSC Q8 and sign tables, plus a Batch 6 solution): fixed at the source; tables.py now takes doc ids and post_load.py passes the batch.**
- **Parallel diagram groups corrupted overlay_scores.json** (16 Nov). overlay.py rewrites one shared file; seven groups at once left trailing data. Rule: groups score into their own work/ file, or run overlay.py after the groups finish.

### Tables (owner flags, 12 Nov)

Table cells are typeset as maths. That causes:

- Words in italics ("why are some words in the table italicised randomly?"). Wrap words in `\text{}`.
- A bare `%` starts a TeX comment and silently deletes the percent signs (found 12 Nov in 6 rate tables). Write `\%`.
- A stray `[2ex]` printed literally ("there is a [2ex] in one of the cells").

*All three are checked.*

Layout must match the paper:

- Merged cells: spans `[row, col, colspan, rowspan]`. "Interest rate needs to span all columns", "time period should be a merged cell".
- A two-line header is one cell with `\\` ("Delivery Time X (days) should be one cell but across two lines").
- No header shading when the paper has none.

Not every grid is a table:

- A stem-and-leaf plot renders as a plot when its caption starts "stem-and-leaf" ("the stem and leaf is not a table").
- Display maths laid out on a grid (e.g. four integrals) is an `array`, not a table.

Captions show above tables. Keep only captions printed on the paper. 70 still need a sweep.

### Diagrams

- Every diagram is checked by the owner. Nothing is cleared automatically ("I need to check every diagram and table").
- Redraw what the sketch means, not the sketch ("meant to be a prism ... don't be too wonky"). The full rules are in DIAGRAM_SPEC and the feedback log.

### Tagging

- **Tag the question, not the parts.** Each question has one home topic (the most marks across its parts' main dot points). A tie goes to the later part. The "hence integrate" rule puts it under integration, and the owner's pick wins ("shouldn't we be tagging questions as a whole instead of parts?").
- **"Also" dot points stay**, collapsed in review. Can-use dot points never gate.
- **Spec gaps cause disagreements, not tagger error.** When two taggers disagree, look for a missing rule, ask the owner, and write the ruling into TAG_SPEC with his words (the CDF skill, the product/quotient/chain rule split, reciprocal trig graphs, the 8 gap rulings).
- **Course boundaries:**
  - 3D trigonometry is removed whole (Extension 1).
  - The first new-syllabus HSC is 2027, so every paper is old-syllabus.
  - Limits are kept, under Y11-122.
  - Percentiles from cumulative frequency go to Y11 Data.

### Review workload

Owner, 12 Nov: "I don't have time to check 6000 questions".

- **Triage tiers.** Decide is for calls only the owner can make. Check is what a script can't clear. Spot-check covers 10% of each paper, with a minimum of 3. Auto is approved when the paper's sample is clean.
- **Approving papers.** The Review header shows "N papers ready" with "Approve all". The per-question banner only appears inside spot-check.
- **Auto-clear before the owner looks.** Table cells are matched against the PDF text (`check_tables.py`). An agent then checks wording and solutions (strict; any hedged "ok" is held back). Auto-approvals are logged with `auto_clear:true`.
- **Fix the source without asking** when you are certain (`overwritten_from_source`). Infer missing criteria from similar questions (`criteria_inferred`). Make the smallest edit to fix a flawed question (`edited_from_original`; it goes to Check).
- **Don't bring back the cropped side-by-side Check view.** The owner said "so much worse and unusable", and it was rolled back.
- **Flagging:** F opens a one-line box, Enter sends. When the owner says "check my flags", fix them, record the rule, then clear the flag so it comes back for approval.
- **Owner calls are Your calls, never loose notes** (owner 13 Nov, about the 11 "Needs your decision" notes on the import dashboard: "isn't that the point of your calls? or is your decision different"). Anything only the owner can decide is raised in `site/project/open_decisions.json`, nowhere else (no `issues` list in `work/import/batches.json` / `progress.json`, no notes in the log or a report):
  - a question: key `"<question id>"`, `{"text": "<the call, one or two sentences, ending in what he can answer>", "raised": "<UTC ISO time>"}`. It shows at the top of that question in Review › the paper › **Your calls** ("Needs your decision: …") and counts in the paper's track, the papers list and the Inbox. `raised` re-opens a question he had already approved (until he answers it: `reviews/q<id>.call_at`).
  - a whole paper (its label, task, course, what file it really is): key `"paper_<doc>"`, same fields. It shows as a card at the top of the paper's Your calls step ("Keep as is" or a typed answer, stored in `reviews/paper_<doc>.call`) and counts there too.
  - a tagging rule: write it into TAG_SPEC as an open owner question, and raise one Your call on a question it affects if it blocks anything.
  - Before raising one, check it is not settled already: the owner's rulings in the specs, and the page database (export `reviews`, `tools/sync_pagedb.py`): an approved question whose edit or solution note answers the point is settled.
  - When he answers: apply it, delete the entry, `build_bank.py`. A duplicate note is one call.
  - The 13 Nov move (11 notes → 2 paper calls, 9 already settled): `archive/import_issues_moved_20261113.json` holds the old list.
- **Check what the auto-clear agents found.** On 12 Nov the owner approved 4 questions the agents had flagged (1384 "sea" for "tea", 1272 speed versus velocity, 1504 k ≠ -1, 1020 intercepts). Fix such findings before the owner reaches them, or put the finding at the top of the question.

## Standing rules

- Never trash Drive files. Rename old copies "(superseded <date>, safe to delete)".
- Keep the bank private. Get copyright advice before sharing.
- Never send the owner's email to external services.
- Record every owner ruling in the matching spec, quoting him.
- Sync to Drive after major changes (include `questgen_repo.bundle`, see "Version control").
- Import resumed 16 Nov for supervised sessions (owner: "go"); the night run still skips it. Knox AT1 waits for the owner's PC.
- Your review decisions (approvals, flags, home picks) are stored **only** in the page's database. On every Drive sync, export them to `project/reviews_backup.json` inside project_files.zip. The first backup was made on 12 Nov and holds 1,065 docs.

## Database integrity and the page mirror (14 Nov)
The owner said "ok fix these issues" after the data-model diagram showed three weak points. The fixes:
- **Page decisions now live in SQLite too.**
  - Before every rebuild, export the page collections reviews, difficulty, exams and reports (ArtifactData `list` with `out_dir`; page through `next_cursor`), then run `python3 tools/sync_pagedb.py <export_dir>`.
  - This replaces the `page_*` tables with an exact copy and records the time in `page_sync`.
  - `apply_difficulty_reviews.py` with no argument reads `page_difficulty`.
  - batch_check warns when a collection has not been copied in the last 24 h.
- **Integrity rules are enforced by triggers.** `tools/integrity.py` installs them and re-running it is safe:
  - a tag, solution, figure or difficulty row with a part always carries that part's question, filled in automatically;
  - a row whose question differs from its part's question is refused;
  - moving a part to another question carries its rows with it;
  - data_tables must have a real owner, and an owner can't be deleted while it owns a table;
  - nearest_anchor must be an HSC reference part.
- **One-off repairs, 14 Nov.**
  - 5 owner-less solution tables were given their solution.
  - 4 figure-tables got an explicit `redraw_table_id`.
  - 4 MCQ tables superseded by `options_table_json` were moved to `data_tables_retired`, not deleted.
  - question_id was filled on 14,270 tag and solution rows.
- **Before any publish,** batch_check runs `integrity.check()`; any violation is a blocker.
- **Tools that split or move questions must update parts first.** The triggers then move the tags, solutions, figures and difficulty rows. Writing a child row with a different question is refused, so a wrong order fails loudly instead of corrupting data.

## Pre-publish page test (14 Nov, hardening)
The owner said "no more importing for a while until we iron these out". Every publish of the review page now goes through an automated test of the built page.

**Run it before every publish:**

```
bash tools/prepublish.sh
```

It runs, and stops at the first failure:
1. `python3 tools/build_page.py`: builds `site/review.html` from `page_src/` and checks `site/vendor/`. An unchanged build leaves the file and its date alone.
2. (removed 16 Nov: `export_src.py` copied `page_src/` to `site/project/page_src/` for publishing; nothing publishes it since 14 Nov)
3. `python3 tools/page_test_fixture.py`: refreshes `work/page_test/fixture.json`, the seed for the fake page database, from the `page_*` mirror tables in questions.db (run `sync_pagedb.py` first if the mirror is old).
4. `node tools/page_test.js`: the test, about 1 minute.
5. `python3 tools/batch_check.py`: it BLOCKS if the page test failed, was a `--quick` run, never ran, or tested a different `review.html`, `bank.json` or `dotpoints.json` (it compares the sha256 recorded in the result, and the result must be newer than `review.html`).

**What `tools/page_test.js` does.** It runs headless Chromium through Playwright, fully offline:
- It serves `site/` itself on a free localhost port, wrapping `review.html` in the doctype skeleton the artifact publish adds.
- Every request that leaves localhost is aborted and listed. Any request to a CDN fails the run. Google Fonts would only be tolerated (it is linked on purpose from Download HTML).
- `window.claude.use()` is faked. `db` is in memory and seeded from the fixture; every write is logged. `user` returns `u_pagetest` (and `isOwner` / `canEdit` by role, 15 Nov). `downloads` captures the filename, size and bytes.

These are the named checks; each passes or fails:

| Area | What it checks |
|---|---|
| Every tab | Bank (a subtopic), Exams setup / pick / mine, Review, Reports, Papers, Processes, Difficulty, Guide users / developers, at 1280 and 390 px, light and dark: no page or console errors, no horizontal page scroll, the view's container is visible and not empty, maths typeset where expected (Bank, Pick, Review, Difficulty, Guide users), no MathJax errors. |
| Bank | open a subtopic; search "annuity"; "+ Add to exam" puts the question in the exam. |
| Exams | generate 60 marks with 6 multiple choice (asserts both); the exam paper and the marking guide preview have sheets, none taller than 297 mm and none empty; Swap replaces the question; Lock sticks; Regenerate keeps the locked question; Save, then My exams lists it; rename and delete in My exams reach the database. |
| Exports | PDF: `%PDF-` … `%%EOF`, with one page per preview sheet. Word, for the exam and the guide: a valid .docx whose `word/document.xml` has `<m:oMath>` and no maths fallback (no "kept as pictures"). Download HTML: no `contenteditable`, no `.scr-only`, the same number of sheets. |
| Review and Difficulty | Approve (Review; under "Every question" when the queues are empty) and Agree (Difficulty) write to the database and move to the next item. |
| Reports | report a question from the paper, starting from its ⓘ card (Wrong difficulty, band 5, Problem solving, note): one `reports/` doc is written with `suggested_wm: 'PR'` and the ⓘ is marked "1 open report"; the Reports tab lists it with "Problem solving", and the tab badge matches. |
| Phone menu | at 390 px it opens with 6 links under Teach (Bank, Exams, Guide) and Curate (Review, Papers, Processes) and goes to Papers. |
| Teach / Curate (15 Nov) | the fake `user` takes a role (`editor` by default, `viewer`, `none` = no user capability). Editor: the switch shows, Teach and Curate each show their 3 tabs, the switch highlight sits on the chosen area, each area returns to its last page; Difficulty and Reports are Review steps after Tags with their counts and open `#review/difficulty` / `#review/reports`; `#levels`, `#difficulty`, `#reports`, `#import` land on their page; a bare reload reopens the last Curate page. Viewer and none: no switch, only Bank/Exams/Guide, no jobs pills, no review bar, "Open in Review" hidden on bank cards; 9 Curate hashes go to `#bank`; a viewer opening `#review/difficulty` lands on the Bank and the phone menu has only Teach. |
| Processes (14 Nov) | `#import` lands on `#processes`; the header shows "2 running" and "3 queued" from the seeded progress/jobs and progress/queue (the "Queued: …" pseudo-job is ignored); the hover list names every queued item and a click goes to Processes; the page shows Running now, Queued (in order, quotes in italics), Recently done (collapsed), then Import; with both docs emptied the pills hide and the empty states show; on a touch phone the first tap shows the list and "Open Processes" goes there. |
| Availability table (14 Nov) | Exam setup at 1280, 1000 and 390 px, all topics chosen: the drawn text of each row label ends at least 4 px before the B2 cell, never overlaps it, and wraps onto at most 2 lines. |
| Diagram resize (14 Nov) | on a generated paper: no − / + pill; hovering shows the handle on the diagram's corner; a mouse drag out changes `EX.figscale` and the image width in proportion, shows a live % only while dragging, and lays the paper out once, after the drag; a drag in shrinks it; far out / far in clamp to 200% / 30%; double-click resets to 100%; → → on the focused handle gives 110%; a 150% diagram keeps `--fs:1.5` in the HTML download. At 390 px on a touch phone, a finger drag resizes it. |
| ⓘ card (14 Nov) | no dot-point line or Report link left in any question; every source line ends with an ⓘ (`.scr-only`); the ⓘ opens a card with a dot point, band, kind and Report, one row per part, inside the window, without selecting the question; outside click closes it; Enter opens, Tab reaches Report, Esc closes and refocuses the ⓘ with the preview still open; Report opens the form; the grading panel's question detail lists the dot points. At 390 px on a touch phone the tapped card fits the screen and the ⓘ stays 20 px. Download HTML has no handle, live % or ⓘ. |
| Papers: lanes (14 Nov) | the fixture's small inventory (page_test_fixture.py `sample_papers`, served in place of `data/inventory.json`): the four summary numbers equal a recount of the statuses and add up to the folder total (and the live inventory's statuses add up); one lane "Year 12 Advanced" with its line, squares (cleared b4, waiting b5, batches 6-8) and buttons; Needs a check lane; "Locked · 3 courses, 8 papers"; the legend; cleared vs waiting (owner 14 Nov: "I would like to see how many of the batches have cleared checks on the import page too, its good to know."): the fixture's imported papers are real bank papers (`LANE_REVIEW`), 1601 cleared only through `k_`/`p_` key docs and 323 with its decisions taken off; Review's own track decides; the batch panels' chips and "N of M cleared review"; a key doc deleted and restored flips the square, the lane line and the queue's waiting count live; a square opens Batch 6 with 9 papers, Swap writes `batches/advanced_12` and the page's batches equal tools/batches.py `apply_swaps` (fixture `swap_expect`); +1 / +2 batches write `queue/advanced_12_6..8` in order, ↓ and × reach the db, no lock text (owner 14 Nov: "Maybe remove the lock for now since I'm in charge of import"): "Runs top to bottom until the queue is empty. Stops early only if a batch comes back with unusual problems.", "1 batch is waiting for review" as plain text beside an enabled Start, the API line, the estimate; Start the queue writes one `runs` doc {kind:'queue', stop_early} with no `limit`, Cancel; a queued "Batch 10" stays on one line at 1280 px; Run the cover-page check writes {kind:'cover_check'}; #processes/papers/check: Accept writes `scans/rules`, the rules' course guess (Advanced) is pre-picked and not saved, Year 12 and Not in scope write `paperfix`, the summary follows and still adds up; the cover + 3 pages (fixture pack for 9140, served in place of `data/check_pages.json` / `data/check/9140.json`) and 4 placeholders for 9601; the viewer opens on a click, ← / → step through the 4 (wrapping), Esc and × close it and focus returns to the page clicked; "Open the whole PDF in Drive" → https://drive.google.com/file/d/<id>/view in a new tab; Import history collapsed; 390 px phone (fits, panel one column, queue under the lanes, +1 by tap); a viewer: nothing shown, fetched, subscribed or written. `node tools/page_test.js --only papersLanes` while you work (recorded as quick). |
| Rescan drive (13 Nov) | a fake Google Drive connector (`use('mcp')`, a 6-folder tree from page_test_fixture.py `sample_drive`, 2 items a page): the button sits on the Papers first line; progress "N of M folders" and Cancel (nothing saved); a full scan finds the 5 new files and 1 same-size file, groups them by course x year as tools/classify_paths.py does, makes only read-only `search_files` parentId queries with pageToken, skips "Claude outputs", and writes one `scans/s<time>` doc with the right fields and counts; the page's classifier equals classify_path on every recorded path; a rate limit is retried once then stops; 7 error codes each give their own message; the last scan shows after a reload; no connector → "Ask Claude to rescan"; 390 px touch phone fits; a viewer gets no button, no `use('mcp')`, no write. |
| Question keys (14 Nov, Fix 2) | the CSSA 2022 copies 44/274 and 45/275 share keys and the approvals on 274/275 make 44/45 approved; old q<id>/paper_<doc> docs merge as a fallback and a k_ doc wins; an approval is written to `reviews/k_<key>` and every copy follows; an old-format saved exam (ids only) loads, a keyed one finds the copy the Bank shows, every fixture exam loads, Save writes `keys`. |
| Offline | no request left localhost. |

**Results:**
- `work/page_test/last_result.json`: ok, the time, the sha256 of the files tested, and each check with its detail and duration.
- `work/page_test/shots/<check>.png`: a screenshot for each failed check.
- `work/page_test/downloads/`: the PDF, .docx and HTML files from the last run.

**Options:**
- `--quick`: no exports and no dark theme, for while you work; batch_check will not accept it.
- `--headed`: watch it run (needs a display).
- `--page FILE`: test another build, for example `work/hardening/review.before.html`, to compare. Its result goes to `other_result.json`, `shots_other/` and `downloads_other/`, and batch_check ignores it.

Exit codes: 0 means all passed, 1 means a check failed, and 2 means the test could not run.

**When a check fails.** Look at its screenshot and detail. Fix the page in `page_src/` (never in `site/review.html`), rebuild, and run `prepublish.sh` again. If the page is right and the check is out of date (an owner ruling changed what the page should do), change the check in `tools/page_test.js` and say why in a comment. Add a check for every new page feature the owner asks for.

**Size budget (13 Nov health pass; CODE_HEALTH rule 6, owner: "keep the code proper and [lean] as we develop").** Since 14 Nov
(Fix 1, owner: "Ok we should run Fix 1 and 2"; plan: keep the published page small; fetch data only when needed) the budget in
`tools/size_budget.json` is what the page loads at start: `review.html`, the course index `data/bank/<course>/index.json` and
`data/assets.json`, each and together ("start load"), plus `data/inventory.json`. Anything over its budget is a BLOCKER. Shrink it,
or ask the owner; when he agrees, raise that budget in the file and add his words and the date under `agreed`. Topic files,
image packs, the old `bank.json` and the whole published set are printed as info. batch_check also blocks a split bank older than
`bank.json` (run `python3 tools/bank_split.py`; `build_bank.py` runs it) and a stale `data/assets.json` entry.

**Asset store (14 Nov, Fix 1).** Image packs move out of the published files into the review page's asset store, step by step:
1. `python3 tools/asset_upload_plan.py`: lists every `data/img`, `data/svg`, `data/cmp` pack not yet in `data/assets.json` at its
   current sha256 (path, size, sha256; anything over the 20 MiB per-file limit is flagged) into `work/assets/upload_plan.json`.
2. Upload each with the Artifact tool: `url` = the review page, `asset: true`, `file_path` = the plan's `local` path, one JSON file
   per call (the tool takes JSON only singly). Append each result `{path, id, url, sizeBytes}` to `work/assets/upload_results.json`.
3. `python3 tools/asset_manifest.py` writes `site/data/assets.json` (path → url, sha256, bytes). Publish the page with
   `capabilities` including `"assets": {}` (with db and its rules, user, downloads, mcp as now). `publish_set.py` then leaves the
   uploaded packs out and sends null for each once.
4. After a rebuild changes a pack, batch_check blocks: re-plan and re-upload it, or `python3 tools/asset_manifest.py --prune` (the
   page then reads the published file again; publish it).
The store's total quota and file count are not in the capability contract (only `usage.maxBytes` / `maxFiles` at runtime): check
them before uploading the full set (UI_SPEC "Data on demand").

**Needs:** `node` with `playwright` and its Chromium (preinstalled in the sandbox; elsewhere run `npm i playwright` and `npx playwright install chromium`), and `python3`. No network is needed.

## Version control (15 Nov)
Nothing to do by hand. `batch_check.py --mark-published` (after every publish) commits everything and tags `publish-vNNN` via `tools/snapshot.py`; on a Drive sync also upload `/mnt/user-data/outputs/questgen_repo.bundle`. Never `git add -f` anything under src/, work/ or site/data/img: `.gitignore` is an allow-list on purpose. To undo a bad publish: `python3 tools/snapshot.py --rollback publish-vNNN` (plan only), then `--yes`. Details: RESUME.md "Version control".

## New papers in the shared folder, and choosing what to import next (13 Nov)
Owner, 13 Nov (dictated): "New exams are gonna be added to this folder periodically we need a way to ... see what we actually
haven't ingested yet", "Should we also order what's in standard and also extension one and extension two while we're scanning
anyways?" and "Can the import queue be dynamic, me choosing which set of papers to import next? We can always [build the]
framework for the courses standard extension and extension two [later] right?"

**The folder is not ours.** G:\Shared drives\CMC Resources\Exams\External Exams Stage 6 is a school shared drive other staff
use. NEVER move, rename or reorganise anything there; the owner agreed we keep the record on our side instead (documents table,
`work/scan/`, `site/data/inventory.json`). Nothing below writes to the folder.

**Import is still paused** (owner 14 Nov: "no more importing for a while until we iron these out"). Steps 1-5 are safe now;
step 6 waits until the owner resumes import.

**Two ways to rescan (no PC needed for either)** (owner 13 Nov: "Where is the button to rescan the drive?"):
- **The page's Rescan drive button** (Curate > Processes > Papers, next to "last folder scan"). It walks the folder read-only
  with the owner's own Google Drive connector, FINDS and LISTS the new files (classified with the same rules as the tools) and
  saves the scan to db collection `scans`. It does not change the record: Claude adds those files to it at the next import
  step (step 3 "Or from the page" below).
- **Ask Claude ("rescan the drive").** Claude lists the folder with the Google Drive connector (read-only: `search_files`
  only, never move / rename / copy / trash / share) and ADDS the new files to the record directly: the steps below, then 3-4.
1. `python3 tools/drive_listing.py next` prints a query for the folders not listed yet (the first one is the root, folder id
   `1yItEV6bFpGyrJDpDrAle0RgPKqsfjTOZ`). Run it with `search_files`, `excludeContentSnippets: true`, `pageSize: 100` and
   **`orderBy: "modifiedTime desc"`** (without it, a query over many parents is ranked by relevance and its pages repeat and
   drop files: the first walk missed 56 Kings files that way until every folder was re-listed). Save every page (the tool saves a big result to a file; write
   a small inline one to a file yourself), `python3 tools/drive_listing.py add <page.json>...`, follow `nextPageToken` with the
   same query, then `done`. Repeat `next` until it says every folder is listed (about 40 folders per query; the 13 Nov walk
   took about 70 queries for 385 folders and 3,818 files).
2. `python3 tools/drive_listing.py build` writes `work/scan/drive_listing_<date>.json` (relative paths with `/` like
   documents.source_path; size, modifiedTime, createdTime, Drive id). A `/` inside a Drive name becomes a space, as Drive for
   desktop shows it on the PC ("w/ Solutions" is "w  Solutions" there); `scan_folder.py` also treats `: * ? " < > |` as spaces.
3. `python3 tools/scan_folder.py work/scan/drive_listing_<date>.json` (dry run), read the report, then `--apply`, then
   `python3 tools/inventory.py` (steps 3-4 below). With a Drive listing, `--apply` also stores each new file's Drive id in
   documents.drive_file_id and fills it on recorded rows that match by path and size and have none yet (never overwrites one),
   so any paper can be fetched with the Drive connector. The Drive walk has no 2,000-entry cap, so the missing check covers
   the whole folder.
First Drive scan (13 Nov): 3,352 PDFs; 1,684 new rows (843 uploaded that day, mostly "<School> Yr12 MA 2026 AT4 w
Solutions.pdf"; the rest older files the stage-0 PC listing never reached, mostly deep Knox, Oakhill and Kings folders);
36 copies held; 2 Hornsby Girls files moved into "Yr 11 Adv"; every recorded row except those 2 now has its Drive id.
`classify_paths.py` learnt the "MA" course code, the school at the start of that file name, and 1980s-90s years, as
fallbacks only where the stage-0 rules find nothing (`RULES['fallback']`, plain data, so the page's Rescan drive applies them
too; the page test checks the page's port against the Python on every recorded path) (`--selftest`: 0 of the 1,632 stage-0 paths change status; 26 only gain a field the old rules left empty).

The PC route (when the Drive connector is not available):
1. **Connect the PC.** The owner opens Claude on his PC with the shared drive mounted, so the session has the remote-device tools.
2. **List the folder.** `device_list_dir` with `path` = the folder above and `recursive: true`. Save the result exactly as
   returned with Write to `work/scan/listing_<date>.json` (entries with name / type / size / mtimeMs / depth; names only is fine,
   `scan_folder.py` rebuilds the paths from the depth order). The tool returns at most 2,000 entries and walks 5 levels: the
   folder has about 1,630 PDFs plus folders, so it will usually hit the cap. Then list each top-level folder separately
   (`.../External Exams Stage 6\Kings`, `...\Trial Exams`, ...) and save each as `work/scan/listing_<date>_<folder>.json`, plus a
   non-recursive listing of the root for loose files. A listing of a subfolder is passed as `file@Subfolder`. If
   `device_bash` works on the PC, a tab-separated list (relative path, size, mtimeMs per line) is accepted too.
3. **Scan.** `python3 tools/scan_folder.py work/scan/listing_<date>.json [work/scan/listing_<date>_Kings.json@Kings ...]`
   is a dry run (report `work/scan/scan_<date>_dry.json`). Read it: `new` (classified by the stage-0 path and file-name rules in
   `tools/classify_paths.py`), `held` (`moved?` = same size and similar name as a recorded file that is no longer listed,
   `copy?` = the recorded file is still there; with `--apply` a copy is recorded as status `duplicate_file`, "copy of document
   <original>", and a moved row follows its file (old path kept in failure_reason); owner 16 Nov: "duplicate exams will never be
   batched and imported right?": tools/inventory.py keeps copies out of every paper's files and batch, batch_check blocks one
   that got back in, and Processes > Papers > "Copies and missing files" lists each copy beside its original with both Drive
   links. "Same file" = same size in bytes + similar name; the Drive connector gives no checksum, so it is not a byte
   comparison), `missing` (recorded but not listed; the 5 owner
   uploads under `HSC 2024-2026/` are always here) and `cover_check` (new files whose course the name does not tell). Then
   `--apply`: it copies questions.db to `archive/questions_before_scan_<time>.db`, inserts the new rows (status `discovered` for
   Advanced or not-yet-known, `excluded` with course and year level for the rest, as stage 0 did) and logs the scan in table
   `folder_scans`, and writes `state/work/scan/held.json` (tracked: the copies, moved files and missing rows of that scan; the
   full report stays in work/scan/, untracked). Running it again inserts nothing (and never overwrites an earlier backup, even within the same second). A cover-page check of the `cover_check` files needs their PDFs (Drive
   connector or the PC); that is a later, separate step.
   **Or from the page (13 Nov, owner: "Where is the button to rescan the drive?").** Curate > Processes > Papers has
   **Rescan drive**: it walks the folder read-only with the owner's Google Drive connector and saves each scan to db collection
   `scans` (UI_SPEC "Rescan drive"). At the next import step: export the latest doc (ArtifactData `get` on `scans/<id>`, or `list`
   with `out_dir`), save it as JSON, and run `python3 tools/scan_folder.py <that file>` (dry run, then `--apply`). scan_folder
   reads a scans doc as a PARTIAL listing (new files only: no missing check), re-classifies with the same rules, makes the
   moved?/copy? calls, and records each file's Drive id in documents.drive_file_id. Then step 4 rebuilds the inventory, so the
   page's "Found in the last scan, not yet in the record" drops to 0.
4. **Inventory.** `python3 tools/inventory.py` writes `site/data/inventory.json` (every paper, course x year level, state,
   "new" = added by the latest scan). `batch_check.py` warns when it is stale. Files whose names carry different years are never
   one paper, even when documents.year gives them the same key (review 13 Nov: "H1 Adv 2023 (for 2024 HSC)" + "H1 Adv 2024",
   "2020 (for 2021 HSC)" + "2021 (for 2021 HSC)", CTHS 2022 + 2023 AT1, and "2024 Y12 MA AT1 solns", recorded as 2023, which had
   joined Knox 2023 AT1 instead of 2024). A split-off file moves to the paper of the year its name gives (the "for 20xx HSC"
   rule), else it is its own paper labelled by its file name. documents rows are not changed.
5. **Publish** (normal rules: `bash tools/prepublish.sh`, then the `publish_set.py --json` map, which includes
   `data/inventory.json`). The owner opens Curate > Processes > Papers, ticks Year 12 Advanced papers, old-syllabus ones included (Year 11 cannot be ticked: owner ruling below) (or a school, or a whole group) and
   presses "Add to import queue"; he reorders or removes them there. The page stores the order in db collection `importq`
   (one doc per paper, `d<doc_id>`: `{doc_id, label, course, year_level, order, added_by, at}`). Standard, Extension 1 and
   Extension 2 are listed but cannot be queued until their course is set up (topics, dot points, difficulty references).
6. **Import next** (only once import resumes). **Since 14 Nov: see "Queue" below** (fixed batches, one queue, the 3-batch
   limit); the rest of this step describes the 13 Nov import order and is kept for history. Export the queue with ArtifactData `list` on `importq` with `out_dir`, then
   `python3 tools/import_next.py <export_dir>` (or run `tools/sync_pagedb.py <export_dir>`, which now mirrors `importq` into
   `page_importq`, and then `import_next.py` with no argument). It prints the next batch (default 9 papers) in the owner's
   order with every file and its Drive id, lists anything it skips (already imported, no longer importable) with the reason,
   and writes `work/import/next.json`. Stage those papers into `work/import/papers.json` and run the pipeline above. This
   replaces picking rows by hand from `import_manifest.csv`. An active Go run request (db `runs`, 13 Nov) comes first: see "Go" below.

Cost per paper: measured 17 Nov on Batch 8 through the API (see "Import through the API" below): US$0.88–5.19 a paper, mean
US$2.83; `COST_PER_PAPER` in tools/inventory.py is [0.9, 5.2].


- **Year 11 stays out of the import queue (owner 13 Nov).** Asked whether to let the 177 (now ~700 after the Drive rescan) Year 11 Advanced papers into the queue: "Year 11 papers leave alone for now, would like to finalise Y12 first." Keep inventory.py's queueable set to Year 12 Advanced until he says otherwise.

## Go: import a whole year and course, with batch pauses (13 Nov; SUPERSEDED 14 Nov by "Queue" below: no Go button, no per-batch pause)
Owner, 13 Nov: "We need a general summary at the top of the Paper's tab of processes as well. How many papers found, how many imported, a brief breakdown and stuff. Set it up so that once the API is set up, we can choose a grade 11 or 12 and course Adv / std/ extension 1 and extesnion 2 and hit Go and the API would get called to import all papers which are on file but not imported from that level and grade. Is that the best way ? I'm getting CONFUSED with our current papers page". Chosen: "Yes, with batch pauses".
- **On the page** (Processes › Papers › Import a course): the owner picks Year and Course and presses Go, then Confirm. That
  writes one **run request** to db collection `runs` (`r<ms>`: `{year, course, papers:[doc ids in order], batch_size:9,
  pause_after_each_batch:true, status:'requested', by, at}`). One active run at a time; Cancel request sets `cancelled`.
- **Who starts it.** Today Claude, when importing resumes (import is still paused: owner 14 Nov). Later, once a model API is set
  up, the API will start it directly from the doc; the doc shape is the hand-off, so keep it stable.
- **Claude's loop** (when import resumes):
  1. Export `runs` and `importq` (ArtifactData `list` with `out_dir`, both into one folder) and run
     `python3 tools/import_next.py <folder>` (or `tools/sync_pagedb.py <folder>`, which mirrors `runs` into `page_runs`, then
     `import_next.py` with no argument). An active run (requested / running / paused, newest) **takes precedence over the import
     order**: the next batch is the next `batch_size` papers of the run in its order, skipping imported ones. No active run → the
     import order, as before.
  2. Set the run doc's status to `running` (ArtifactData update) and run the pipeline above on the batch.
  3. **Batch pause.** When the batch is published, set status `paused`. The run waits until the owner has **cleared that batch's
     Review track** (every paper of the batch approved: no Your calls, Flagged, Topics, Diagrams or Spot-check left; check with the
     `reviews` export / Review Inbox). `import_next.py` cuts nothing while the run is `paused`. When it is clear, set `running` and
     cut the next batch.
  4. When no paper of the run is left, set status `done`. Finished batches go into progress.json as before.
- **Cost.** The page shows US$12–17 a paper as an estimate until a real figure is recorded (`COST_PER_PAPER` in
  tools/inventory.py, written to inventory `cost_per_paper`: a number or [lo, hi]).
- **db rule:** `runs` is editors only (read admin, write admin).

## Old-syllabus papers, one import list, and what the Papers words mean (13 Nov)
Owner, 13 Nov: "I can't tell. So does not imported and new mean not in scope? We should take questions too, we'll just have to
disretard out of scope things", then "but we already have 15 waiting batches?"
- **Old-syllabus Year 12 Advanced papers are imported.** Advanced papers from before the 2017 syllabus took effect (old 2 Unit,
  last HSC 2019; 245 pre-2019 Year 12 papers were "Not in scope", plus 11 from 2019 that were already waiting) are WAITING and can
  be queued; tools/inventory.py marks them `old: 1` and the page labels them "old syllabus". The other 13 Year 12 Advanced "Not in
  scope" papers stay out (not a question paper, solutions only, other course). Course-not-known papers before 2019 stay out until a
  cover-page check. Year 11 is still never queueable (owner: "Year 11 papers leave alone for now, would like to finalise Y12 first").
- **Import rule for them.** Old-syllabus papers carry `syllabus_version 'pre2017'` (documents; tools/import_next.py writes it on
  each paper in work/import/next.json). Parse and load the whole paper as usual. At tagging (TAG_SPEC), a part with no matching
  current dot point is **dropped (not loaded into the bank)**; a question that mixes current and removed content becomes a **Your
  call** for the owner (Review step 1) instead of being trimmed silently. Content that is in the Standard course still follows
  PARSE_SPEC's standard_topic rule.
- **One list.** The 15 pre-planned waiting batches (b6-b20, 133 papers in progress.json) were folded into the page's import order
  (db `importq`, seeded in batch order from work/importq_seed.json by work/importq_seed.py; 132 papers, since 2020 Knox AT3 is a
  research project, not a question paper). progress.json now holds finished batches only (b1-b5). `tools/import_next.py` cuts the
  next 9 importable papers from the top and numbers the batch after the last finished one (b6, b7, ...); the page shows the same
  "Batch 6", "Batch 7", ... dividers every 9 rows. Import history shows finished batches only. When a batch finishes, add it to
  progress.json (and db progress/import) as done and remove its papers from `importq`.
- **Words on the Papers grid** (one legend line): Imported: in the bank · Waiting: will be imported · Not in scope: set aside ·
  New: found by the latest scan (a "+N new" badge on the number, not a column).

## Question keys and the database's text history (14 Nov, Fix 2)
Owner 14 Nov, approving the plan "Questgen architecture plan: before imports resume": "Ok we should run Fix 1 and 2". Page decisions now follow a question by a permanent key, not its id (UI_SPEC "Question keys").
- **Keys:** `tools/qkeys.py` (format and rules in its header). `build_bank.py` calls `qkeys.attach()` in one block, so new imports get keys at step 9 and a re-parsed question re-attaches to its old key by paper + number. Never edit `question_keys` by hand; a key is never given to a different question.
- **First time (migration):** copy questions.db into archive/ first, then `python3 tools/qkeys.py --assign --bank site/data/bank.json` (the Bank's kept copy gives a group its key). Export the `reviews` collection (ArtifactData `list` with `out_dir`), then `python3 tools/migrate_reviews_to_keys.py <export dir> --out work/keys_migration`: it writes `batch_NNN.json` files (≤50 writes each) and a dry-run report, and exits 1 if any question approved before would not be approved after. Apply each batch file with ArtifactData `batch` (its `writes`). Old q<id>/paper_<doc> docs stay (fallback and history).
- **Reconcile / mirror:** `reconcile.py` applies a `k_<key>` doc to every question with that key; `sync_pagedb.py` mirrors k_/p_ docs.
- **batch_check** blocks when any review, difficulty, exam or report in the page mirror points at a key no live question has, or bank.json keys differ from question_keys (warns while question_keys does not exist yet).
- **Text history:** `tools/export_db_text.py` writes questions.db as text, one file per paper, to `dbtext/` (tracked in git). `batch_check.py --mark-published` → `snapshot.py` runs it before every publish commit, so `git diff publish-vA publish-vB -- dbtext/` shows what changed in the database.

## Queue: fixed batches, one queue, runs until empty (14 Nov)
Owner, 14 Nov: "I like A's design much more" (mockup A: course lanes, batch panel, queue, Needs a check), "there seems to be
some inconsistencies in paper numbers", then "we might want to run multiple batches over the night" and **"Let's do 3 batches
before the lock"**. This replaces the 13 Nov per-batch pause ("Yes, with batch pauses") and the Go button. Page: UI_SPEC
"Papers: course lanes".
**Owner, 14 Nov, later (supersedes the 3-batch lock): "Maybe remove the lock for now since I'm in charge of import".** The queue runs every batch in it, top to
bottom, until it is empty. There is no waiting-for-review limit; the early stop on unusual problems stays. The page shows
"N batches are waiting for review" beside Start the queue as information only.
- **One status per paper.** `tools/inventory.py` gives every paper exactly one of imported / ready_current / ready_old /
  needs_check / held_y11 / held_course / not_in_scope / duplicate, with one reason; batch_check blocks when the statuses do not
  add up to the folder total or the lanes' ready papers differ from the summary.
- **Fixed batches.** `tools/batches.py` (called by inventory.py) puts each ready paper of a course + year lane in a numbered
  batch of 9 ONCE (`work/batches.json`, and `lanes` in site/data/inventory.json, which restores the store in a new sandbox).
  Year 12 Advanced: 1-5 = finished b1-b5; 6 on = the owner's import order (page_importq mirror if it has rows, else
  work/importq_seed.json: 132 papers), then current syllabus newest first, then old syllabus. New papers start new batches at
  the end; numbering never reshuffles. `--reset <lane>` only before any of its batches is queued, and tell the owner.
- **Swap** (page, db `batches/<lane>`): the paper goes to the end of the lane and every later batch passes its first paper back
  one; batches holding an imported paper are fixed. `batches.apply_swaps` = the page's `swapsApply` (page test).
- **The queue** (db `queue/<lane>_<n>`, ordered) and **Start the queue** (db `runs` {kind:'queue', status:'requested', stop_early,
  ...}; no `limit` since the owner's 14 Nov ruling; run docs written before it may still carry `limit: 3`: ignore it). Claude's loop, once import resumes:
  1. Export `queue`, `runs`, `batches`, `reviews` (ArtifactData `list` with `out_dir`, one folder) and run
     `python3 tools/import_next.py <folder>` (or `tools/sync_pagedb.py <folder>`, then import_next.py with no argument).
  2. It prints how many imported batches wait for review (information only) and whether to STOP, and writes work/import/next.json with the next
     batch (lane, number, papers with files and Drive ids). Set the run doc to `running` and run the pipeline on that batch.
  3. When the batch is published: add it to progress.json as done with `ids` (every file's doc id) and `failed_papers`,
     `failed_pages`, `your_calls`; delete its `queue` doc; run import_next.py again.
  4. **Carry on** with the next batch: no review lock (owner 14 Nov: "Maybe remove the lock for now since I'm in charge of import"). **Stop early** only when
     the batch that just finished had unusual problems: **a paper that loaded no questions, 3 or more pages the parser could
     not read, or more than 12 Your calls** (`STOP_EARLY`; chosen 14 Nov while the owner was away; b1, the first batch, had 11
     Your calls for 8 papers, later batches far fewer). Set the run doc to `paused` and tell the owner; after an early stop he
     has seen, set `stop_ack: true` on that progress.json batch and carry on.
  5. When the queue is empty set the run doc `done`.
- **Review state on the lanes** (owner 14 Nov: "I would like to see how many of the batches have cleared checks on the import page too, its good to know."). An imported batch's
  square is solid green once every paper in it has cleared Review (Review's own per-paper track: every step done, no open Your
  calls; key docs `k_`/`p_` count), pale green with a green border while any paper waits. Nothing to run: the page works it out
  from the reviews collection, live. import_next.py prints its own approval-based count, as information.
- **Cost.** US$12–17 a paper until a real figure is recorded (`COST_PER_PAPER` in tools/inventory.py).
- **Needs a check.** Run the cover-page check writes `runs` {kind:'cover_check', papers}: Claude reads each front page (Drive
  connector) and records course / year level; what it can't settle stays for the owner. His answers are db `paperfix/p<id>`
  {id, files, yl, course, out}; `tools/sync_pagedb.py` mirrors them (page_paperfix) and inventory.py applies them.
- **Page pictures for Needs a check** (owner 14 Nov: Needs a check rows show "the cover + 3 pages picked at random from the
  question pages (enlarge on click) and an 'Open the whole PDF in Drive' link"; "The cover-page check renders the 4 images and
  stores them in the asset store"). During the cover-page check, for each paper: download its PDF from Drive to a local path
  (never src/ in place of Drive), then `python3 tools/check_pages.py --pdf <local.pdf> --paper <paper id>` (repeat the pair for
  several). It writes `site/data/check/<id>.json` (cover + 3 question pages, WebP, 180 px and 1100 px wide; blank,
  instructions, reference-sheet and writing-booklet pages skipped; seed `qg-check-<id>`, so the pages never reshuffle) and lists
  it in `site/data/check_pages.json` {papers: {id: {path, sha256, bytes, pages}}}. To serve them from the asset store, run the
  "Asset store" steps (asset_upload_plan.py includes `data/check/*.json`). batch_check blocks a listed pack that is missing or
  changed. The Drive link needs no step: inventory.py writes each Needs a check paper's Drive ids (`g`).
- **CSSA 2023 AT4 from its marked copy (17 Nov).** The paper (doc 515, 14 MB scan) is over the Drive connector's 10 MB limit; the "Solutions" file (doc 514, 9 MB) is the whole printed paper with the teacher's red-ink working on it. Owner: "CSSA 2023 find a work around". The questions and solutions are parsed from 514 and loaded under doc 515; locally `src/515.pdf` is a link to `src/514.pdf`, so page numbers, crops and page images refer to the marked copy. A fresh session restores it the same way (download 514 by Drive id, link 515 to it).
- **Abbotsleigh AT1 years (17 Nov).** Abbotsleigh sets Year 12 AT1 in Term 4 of Year 11 and files it under that calendar year ("2023 AT_Task1 ...", cover "2023 Term 4 Higher School Certificate Assessment Task 1"). By the graduation-year rule it belongs to the next year. Owner: "rename both papers": doc 159 is 2024 Abbotsleigh AT1, doc 163 (filed 2024) is 2025 Abbotsleigh AT1. Their question keys keep the first names (2023-/2024-Abbotsleigh-AT1-*; keys never change). A future "<year> AT_Task1" Abbotsleigh file is <year>+1: check the cover before parsing.
- **Paper 5 left out (17 Nov).** "Adv Math - Graphing Techniques and Trig Functions and Graphs.pdf" (top of the folder; cover: only "Practice Assessment Task 2" and topics, no year or school). Owner: "yeah leave that paper out then" (db paperfix/p5 out: true).
- **Proposed rule fixes** (`RULES_PROPOSED` in tools/classify_paths.py: "EXT1" without a space / "Y12 Ext1" → Extension 1; a
  folder named "11" → Year 11; "Std"/"Standard" folder → Standard; "Ext 2"/"Ext2" folder → Extension 2) apply only after the
  owner presses Accept (db `scans/rules`); `tools/sync_pagedb.py` writes it to `work/rules_accepted.json`, then run
  `tools/inventory.py`. `python3 tools/classify_paths.py --selftest` checks the fixes only fill what the stage-0 rules left
  empty (one known exception: "Baulkham Hills/11/Ext1/P1 Adv 2020 Yearly Exams solutions.pdf", Advanced → Extension 1, held
  either way).
- **db rules at publish:** `queue`, `batches`, `paperfix`: read admin, write admin. (`runs`, `scans`, `importq` already are.)
  The 14 Nov follow-ups add no collection (the review state reads `reviews`, which every viewer already reads).


## Z-score table at the back of an exam (17 Nov)
Owner 17 Nov, verbatim: "Some questions say refer to the z score table at the back of the exam. For THOSE specifically, we
arenot adding the z score table in (I've already told the reviewer this run). We need a way to append a z score table at the
back of exams which ahve those questions tho. Ok? Also add a rule for future imports. Questions which have a pportion of the
ztable in there arleady we will keep. Makes sense?"
- **Rule for every import** (after load, before the bank build): run `python3 tools/ztable.py`. It marks a question when its
  text points to a normal / z-score table printed elsewhere in the paper ("table on page 33", "table provided", "at the back",
  "z-score table", "probability table") and the question prints no table of its own (no `\extable`, no figure classed as a
  table). Do NOT transcribe or crop the paper's z-table into such a question. A question that prints its own portion of the
  table keeps it and is not marked. Change a page reference in the wording ("the table on page 33") to "the table at the back
  of this exam" (the page number is wrong in any exam built from the bank). `python3 tools/ztable.py --check` exits 1 while a
  candidate is unmarked.
- The marks live in state/work/ztable.json {question key: reason}; build_bank.py sets q.zt. Review has a "Z-score table at the
  back" button (reviews zt, wins over the file) for anything the detector misses.
- The exam builder appends one computed table (P(Z <= z), z = 0.00 to 3.49, 4 dp; page_src/js/19_ztable.js) on its own last
  page of any exam paper holding a marked question; never in the marking guide.
- 17 Nov first run: 2 marked (Baulkham Hills 2024 AT4 Q19, Sydney Tech 2025 AT4 Q27; wording changed to "at the back of this
  exam"). Kept with their own table: Q798, Q865, Q1099, Q1954.
- 17 Nov, checker flags under the same ruling: Sydney Girls 2024 AT4 Q30 ("remove the z-table") and Sydney Tech 2024 AT4 Q30
  ("Remove this table") printed the whole z-table inside the question. Both tables retired (data_tables_retired; the Sydney
  Tech figure row is in archive/removed_figures_1117.json), the wording now points to "the table at the back of this exam", and
  both are marked in state/work/ztable.json. A whole table printed with the question goes the same way when the checker asks.
- Owner 17 Nov 13:45: "QID 1099 2025 Sydney Girls High School AT4 Q28 still has the table in the question". So the rule is: a
  question that prints the WHOLE z-table (30+ rows, e.g. "the table on page 25" printed as a full Phi(z) table) loses it like
  Q1954/Q1991; a PORTION (a few rows: Q865 21 rows of selected z, Q798 2 rows) stays. tools/ztable.py lists any whole table
  left ("WHOLE TABLE") and `--check` fails on it. Q1099: table Tf652 retired, figure 1373_q28_1 row archived, wording "(The
  table at the back of this exam can be used for this question)", marked.
