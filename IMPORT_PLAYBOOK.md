# Import playbook: from a paper PDF to approved questions in the bank

Owner: Steve Yeung (CMC Education). Written 12 Nov 2026, after the full Year 12 Advanced import and review. Steve asked: "have you learnt lots about importing and tagging questions now? Is that logged somewhere?" and then said "yeah".

This file covers **how** to run an import. **What** the owner wants is in the specs, which have the final say:

- PARSE_SPEC: transcription and old syllabus.
- TAG_SPEC: tags and home topic.
- SOLUTION_SPEC: solutions and criteria.
- DIAGRAM_SPEC and DIAGRAM_FEEDBACK_LOG: redraws.
- VERIFY_SPEC: the independent checker.

Page/UI decisions: UI_SPEC.md. **Page code: edit `page_src/`, then run `python3 tools/build_page.py`; never edit `site/review.html` directly** (it is generated). Run `python3 tools/export_src.py` before you publish. A new Claude session has no memory of earlier ones. Read this file, RESUME.md and the specs before touching a batch.

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
| 12 | Homes and sync | export home topics from the page (homes.js) into the DB; Drive sync (rename old copies "superseded", never trash) | Drive is current |

Whenever a background job starts or ends, update the jobs pill (db doc `progress/jobs`). Keep the owner's queued requests in db doc `progress/queue` too (`{items:[{id,title,detail,status:'queued'|'running'|'done',order,asked}],updated}`): it feeds the "N queued" pill and the Processes page (14 Nov).

## Mistakes we have made, and the rule each one taught

Each of these happened. `batch_check.py` catches the ones a script can catch.

### Pipeline

- **Redraws produced but never merged** (12 Nov). Batch 5's last redraw file was never run through `apply_diagrams.py`, so 9 questions sat as triage "pending". No review queue shows pending questions, so they were invisible. Rule: merge every `result_*.json`. *Checked: unmerged redraws, figures with no redraw, pending questions.*
- **Republished `bank.json` but not the SVG packs** (12 Nov). The page showed "Redraw missing". Rule: publish every changed file under `site/data/` in the same call. *Checked: the manifest diff.*
- **Re-triage reshuffled the spot-check sample** (12 Nov). It would have thrown away samples the owner had already reviewed. Rule: samples are locked in `work/sample_locked.json` once picked. *Checked.*
- **Moving a figure to another question drops the owner's approval.** Decisions are stored per question. Rule: when a figure moves, copy its `fig` decision to the new question's review doc.
- **Stale triage after DB edits.** *Checked: triage older than its inputs.*
- **Wrong workflow script launched** (12 Nov). It would have overwritten the main gate outputs. Rule: before starting a workflow, check which files it writes; pilot work writes to `work/*_pilot`.

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
- **Check what the auto-clear agents found.** On 12 Nov the owner approved 4 questions the agents had flagged (1384 "sea" for "tea", 1272 speed versus velocity, 1504 k ≠ -1, 1020 intercepts). Fix such findings before the owner reaches them, or put the finding at the top of the question.

## Standing rules

- Never trash Drive files. Rename old copies "(superseded <date>, safe to delete)".
- Keep the bank private. Get copyright advice before sharing.
- Never send the owner's email to external services.
- Record every owner ruling in the matching spec, quoting him.
- Sync to Drive after major changes (include `questgen_repo.bundle`, see "Version control").
- Import is paused. Knox AT1 waits for the owner's PC.
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
2. `python3 tools/export_src.py`: copies `page_src/` to `site/project/page_src/`.
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
| Papers (13 Nov) | the fixture's small inventory (page_test_fixture.py `sample_papers`, served in place of `data/inventory.json`) and one seeded importq doc: Papers sits between the queue and Next up with the pause note; the grid counts (In folder / Imported / Waiting / New) match the fixture; Extension 1 / Standard rows say "needs course setup (topics, dot points, difficulty references)"; Standard / Extension / unknown / Year 11 groups have no checkboxes and `PQ.add` refuses their papers; a school tick + one paper tick + Add writes 3 importq docs `{doc_id, label, course, year_level, order, added_by, at}` in order; ↑ ↓, drag and × reach the db; 390 px touch phone fits and works by tap; a viewer gets no section, no inventory fetch and no write. |
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

The loop:
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
   `copy?` = the recorded file is still there; never merged, not inserted), `missing` (recorded but not listed; the 5 owner
   uploads under `HSC 2024-2026/` are always here) and `cover_check` (new files whose course the name does not tell). Then
   `--apply`: it copies questions.db to `archive/questions_before_scan_<time>.db`, inserts the new rows (status `discovered` for
   Advanced or not-yet-known, `excluded` with course and year level for the rest, as stage 0 did) and logs the scan in table
   `folder_scans`. Running it again inserts nothing (and never overwrites an earlier backup, even within the same second). A cover-page check of the `cover_check` files needs their PDFs (Drive
   connector or the PC); that is a later, separate step.
4. **Inventory.** `python3 tools/inventory.py` writes `site/data/inventory.json` (every paper, course x year level, state,
   "new" = added by the latest scan). `batch_check.py` warns when it is stale. Files whose names carry different years are never
   one paper, even when documents.year gives them the same key (review 13 Nov: "H1 Adv 2023 (for 2024 HSC)" + "H1 Adv 2024",
   "2020 (for 2021 HSC)" + "2021 (for 2021 HSC)", CTHS 2022 + 2023 AT1, and "2024 Y12 MA AT1 solns", recorded as 2023, which had
   joined Knox 2023 AT1 instead of 2024). A split-off file moves to the paper of the year its name gives (the "for 20xx HSC"
   rule), else it is its own paper labelled by its file name. documents rows are not changed.
5. **Publish** (normal rules: `bash tools/prepublish.sh`, then the `publish_set.py --json` map, which includes
   `data/inventory.json`). The owner opens Curate > Processes > Papers, ticks Advanced papers (or a school, or a whole group) and
   presses "Add to import queue"; he reorders or removes them there. The page stores the order in db collection `importq`
   (one doc per paper, `d<doc_id>`: `{doc_id, label, course, year_level, order, added_by, at}`). Standard, Extension 1 and
   Extension 2 are listed but cannot be queued until their course is set up (topics, dot points, difficulty references).
6. **Import next** (only once import resumes). Export the queue with ArtifactData `list` on `importq` with `out_dir`, then
   `python3 tools/import_next.py <export_dir>` (or run `tools/sync_pagedb.py <export_dir>`, which now mirrors `importq` into
   `page_importq`, and then `import_next.py` with no argument). It prints the next batch (default 9 papers) in the owner's
   order with every file and its Drive id, lists anything it skips (already imported, no longer importable) with the reason,
   and writes `work/import/next.json`. Stage those papers into `work/import/papers.json` and run the pipeline above. This
   replaces picking rows by hand from `import_manifest.csv`.

Cost per paper: none is recorded in this playbook or RESUME.md yet, so the page shows none. When one is measured (agent token
totals for a batch / papers in it), write it here and set `COST_PER_PAPER` in tools/inventory.py.

