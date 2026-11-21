# Code health: standing rule for every feature

Owner, 13 Nov: "keep this in the front of your mind as we build more features? It's important to keep the code proper and
[lean] as we develop, always come back to this ... [as] we develop new features."

This applies to every round, big or quick. Every builder prompt includes it, and every reviewer checks it.

## Rules for new code
1. **No new page-wide names.** New state goes through the shared state module (see the refactor round), or stays inside its
   own feature's scope. Count of top-level declarations must not grow without a reason written in the commit message.
2. **Styles are scoped.** Every view's CSS is prefixed by its view (e.g. `.procs .x`, `.rv-…`). No bare generic class names
   (`.pdone`, `.row`, `.card`) at the top level. The 13 Nov `.pdone` clash is the example of why.
3. **Reshape, don't bolt on.** If a feature overlaps existing code, change the existing code instead of adding a parallel
   copy. Duplicated logic is a review finding.
4. **Delete what's dead.** Code or data a change makes unused is removed in the same round (archived locally if it's data).
5. **Course is a dimension.** Never hard-code "Advanced"; topics/dot points/references come from the course's data.
6. **Watch size.** The pre-publish check reports page size and bank size against a budget. Since 19 Nov the budget is a guide, not
   a blocker (owner: "We can go past the limit if its not hard, that was just a giuode before, if features are optimal and not bloat, we
   can go past the limit"): going past it is a warning; the round's report says what grew and why it is needed, and reviewers check the
   growth is not bloat (dead code, duplicate features). Hard platform limits (16 MB per file, files per publish) stay blockers.

## Every night (owner 21 Nov: "This should really be done every night so it stays lean")
The night run (NIGHT.md step 3c) runs `tools/lean_check.py --fix-css`: it removes only CSS declarations a later identical selector
always replaces (provably invisible; the page test still gates the publish), and reports, without changing, CSS classes and page
functions nothing uses and size growth since the last run. When page_src/ or tools/ changed that day, one read-only reviewer reads
only that diff against these rules. Findings go to Next up ("Lean check <date>"); the fixes are made in a supervised session.
batch_check shows the same findings as warnings before every publish. Unattended refactoring is deliberately not done at night.

## Every round
- Builder: follow the rules; list any exceptions in the report.
- Reviewer: check the diff against rules 1–6, not only "does it work".
- After every 3–4 feature rounds, or before a big feature, run a short health pass (dead code, duplication, size).

## Health pass (13 Nov night; owner: "run the refactor overnight", "Let's do the publishing then")
No visible change; checked by page_test and by a computed-style and text snapshot of every view (1280/390 light, 1280 dark,
an exam preview). Six commits, "Health pass 1/6" to "6/6".
1. **Dead code and files removed.** FOCUS_STEPS/focusPack and the cropped Check branch; the stage-2 exam-auto drawer and its
   generator (23_exam_auto.js keeps qDiff, topic homes/tree, xaRng, Swap/Lock); 8 orphaned Tags-step helpers in 08_review.js;
   qPlacesOld; CSS for 30 classes nothing renders. `data/bank_v1_before_split.json` and `tools/focus_crops.py` are in
   `archive/data_unused_1113/`; publish_set EXCLUDEs the json and sends null for both once. renderBank's swallowed enter
   animation was **not** restored: bankGo's view transition already slides `#list`, so a second animation would double it;
   the dead `#list.enter` rule and `@keyframes listin` were deleted instead.
2. **Clashing class names scoped** (same name, different meaning in two views, like `.pdone`): Processes `.bar` → `.pr-bar`,
   `.st` → `.pr-st`; Review `.pempty` → `.rv-pempty`; Exams tile `.part` → `.ex-part`, `.tb/.exln .empty` → `.ex-empty`. Where
   another view had silently inherited a property from the old rule, it is now written out in that view's own rule.
   Prefixes from now on: `pr-` Processes, `rv-` Review, `ex-` Exams (or scope under the view: `.procs .x`).
2b. **Counts link to what they count** (owner 18 Nov, UI_SPEC): a number on the page links or clicks through to the list it counts,
   or carries a title saying what it counts; reviewers check new counts against this.
3. **Size budget** in batch_check: `tools/size_budget.json` (size on 13 Nov + 25%). Over budget blocks until the owner agrees.
   Owner 18 Nov (the budget is ours, not a platform limit): "If i'ts not a HARD limit, you're allowed to exceed AS LONG as all the
   code and comments we've built so far is necessary and efficient, not bloated." So a page over budget may be raised without asking
   again, but only after a bloat pass: dead code removed, duplicates merged, nothing in the built page that the page does not run
   (rulings and comments stay in page_src/, the build may strip them). The pass and the new figure go in "agreed".
4. **Shared state**: `QG` in 01_core.js (bank, dots, dm, reviews, db, me, editor, view, course). B, DOTS, DM, reviews, db, me,
   EDITOR and view are window accessors onto QG, not declarations; every write goes through QG. New shared state = a QG field.
5. **Course**: `QG.course` ('advanced') → `QG.courseData` (name, short, bank and dot-point files). The page no longer types
   "Advanced" in the Bank, Review, Exams, Processes or the Guide's syllabus caption.
Numbers: top-level declared names 498 → 463 (declaration statements 475 → 443); review.html 632,923 → 597,889 bytes.

## Known debt (after the 13 Nov health pass)
- 463 top-level names across 25 files. Most are feature-local (08_review 96, 24_exams 77, 01_core 31). Next: give each view
  one object like `PQ` (Papers) and move its globals into it, starting with Review and Exams.
- Generic utility classes are still bare: `.row`, `.card`, `.empty`, `.help`, `.muted`, `.act`, `.badge`, `.grid`, and the
  modifiers `.on`, `.open`, `.done`, `.none`. They mean the same thing everywhere, so they are not clashes, but they are the
  names a new view is most likely to reuse by accident. Older views' own CSS is mostly unprefixed.
- Exams: an empty answer-lines block (`.exln.ex-empty`) has 72 px of padding, inherited by accident from the shared `.empty`.
  Kept so no exam paper reflows; probably unintended. Owner to decide.
- ~~The whole 5 MB bank loads at start~~ Fix 1, 14 Nov (owner: "Ok we should run Fix 1 and 2"): the page loads a 1.8 MB index and
  each topic's text on demand (tools/bank_split.py, QG.need). The index still grows with every paper (~1.1 KB a question: tags,
  difficulty, triage); before ~150 papers it needs trimming (per-course or derived counts) or the start-load budget blocks.
  Job 2, 16 Nov (owner: "Yeah build it"): done. The start index is slim and gzip (as base64: ~103 KB today, ~1.0 MB projected
  at 538 papers, budget 2.35 MB); the rest is in details.gz.json (~2.4 MB at 538, read after start). See "Job 2" below.
- Course outside the page: build_bank.py, add_to_bank.py, inventory.py, the tag/difficulty specs and dotpoints.json are
  Advanced-only. The Guide's worked examples are facts about Advanced; "2024 syllabus" wording is shared by all courses.
- Local variables named `B` in 24_exams.js, 28_schema.js and 34_papers_run.js shadow the bank alias: rename when touched.
- `XA_DEF` still carries the old drawer fields (`open`, `topen`); saved exams hold them. Harmless.
- ~~`data/bank_v1.json` is published only as an off-sandbox copy~~ 14 Nov: it is tracked at state/site/data/bank_v1.json (and is
  no longer among the live published files).

## Job times on Processes (owner 13 Nov: "Are you times right? It said the recent task started 6:05")
Times in progress/queue were typed from memory and drifted (the inventory round showed 6:05; it started 7:06).
Always stamp started/finished/eta from the clock (`TZ=Australia/Sydney date -Iminutes`), never from memory.

## Parallel work (owner 13 Nov: "there has to be a way for the importer to not block the bank page right? They don't seem related.")
Unrelated changes run in parallel, each in its own git worktree (e.g. /home/claude/wt_<name>, branch <name>), with ignored
data folders symlinked in but its OWN work/ folder (page_test writes there). Merge into main when the running round has
committed, rebuild, run prepublish, publish once. Only the publish itself is sequential.
Worktree setup: symlink node_modules, site/data/{cmp,img,svg}, figures, tikz (build outputs only); real work/ (page_test writes
there). Since 14 Nov the state files come with the checkout (state/, tracked), so nothing needs copying; a worktree commits its
own state/ changes and they merge like code. A publish made from a worktree is not recorded in main's manifest until the branch is merged and
--mark-published runs in main.

## Framework (owner 13 Nov)
Asked "is react better if we are going to deploy?", then "ok great, lets not switch then". Stay on plain JS in page_src/.
Revisit the framework choice only when moving to real servers (that move rebuilds the data layer anyway). Until then the
health rules above keep the code shaped so a later move is cheap: state in one module, styles scoped per view, course as data.

## Portable checkout (14 Nov; move to a fresh Claude Code cloud session)
Brief: the repo must run from a fresh clone at another path, with the database restored from Drive to `$QG_DB` and the image
packs read back from the published page.
- **One place for locations:** tools/paths.py (ROOT from its own location, DB, OUT, STATE, WORK, SRC, TIKZ, SCRATCH). Every
  Python tool imports it; tikz_render.sh, run_render_audit.sh, render_audit.js and check_latex.js derive the root from their own
  location. batch_check blocks any hard-coded /home/<user>, /mnt/<outputs> or session scratch path in tools/ or page_src/
  (paths.py is the one exception, for its fallback).
- **state/** (tracked, about 11 MB): the MUST MOVE items of the move inventory, at their old relative paths. The old locations in
  the first sandbox are symlinks into state/, so nothing reads a stale copy there.
- **Diagram sources:** site/project/tikz_sources.json is regenerated whole from state/tikz by tools/tikz_sources.py (apply_diagrams
  calls it; batch_check blocks a difference). It had been stale (0.4 pt style, no tree_style, pre-fix 373_q25_s1).
- Exceptions to the rules above: none. Debt left: specs and docstrings still name the old relative paths (`work/triage.json`);
  CLAUDE.md and paths.py explain the mirror instead of rewriting ~40 docstrings.

## Job 2: split the start-up index (16 Nov; owner: "Yeah build it")
Problem: the start index grew ~32 KB a paper (1.9 MB at 52 papers); at the 538-paper target it would have been ~18 MB, over
the 2.35 MB start budget and over the platform's hard 16 MB limit per published file. All 538 papers are Advanced, so a
per-course split would not have helped. The owner chose the split after asking whether the limit was hard and what best
practice is (a real database and server is the long-term answer; deferred: "Let's not move over now").
- **Files** (tools/bank_split.py): `index.gz.json` (slim: what the Bank needs: main tags only, difficulty band and kind,
  triage tier, figure keys, key) and `details.gz.json` (every other index field). Both gzip, reproducible (mtime 0), carried
  as base64 text in JSON `{v, gz}`: the first publish was refused because the artifact host serves no .gz files (+33% size).
- **Budget**: the owner agreed that the start-load budget counts the index at its compressed size (what the browser downloads);
  budget numbers unchanged (tools/size_budget.json "agreed"). batch_check prints the projection at 538 papers.
- **Page**: QG.json unpacks the base64 gzip (DecompressionStream; browsers from 2023 on); other files are plain JSON. QG.det merges the details into the same objects; QG.ready(view) is false for every view but the Bank until
  they land, and route() renames the view 'wait:<view>' meanwhile so live redraws (snapshots, timers) that check view==='x'
  skip. renderSteps, updateCounts and Papers' reviewState also wait. QG.onDet clears the caches built from the slim index.
- **Rule for new code**: a field read in the Bank (list, nav, filters, bankStats, cards before QG.has) must be in the slim
  index (bank_split.py Q_START / slim_part); anything else may live in the details. page_test "data:" checks cover it,
  including a tour of every view while the details are held back.
- **Tools**: the manifest digest has one copy, publish_set.sha (batch_check and fetch_published call it; it unpacks the .gz
  files).
- Exceptions to the rules above: none. New page-wide names: none (QG fields only). New CSS: `#detWait` (an id, scoped).
- Debt: the details file still holds every question; past ~538 papers or with other courses, split it per topic too (and
  give Review/Exams counts from a summary) or move to a real database.


## Health pass 21 Nov (owner: "check for code bloating, inefficienies, repeats in logic and functions and clean them all up")
Four read-only reviewers (page JS in two halves, CSS, Python tools), then fixes in batches, each gated by the page test (205/205) and,
for CSS, by pixel-identical screenshots (Bank, a topic, Guide, Exams; 1280 light and dark, 390). Published v289.
- **Speed:** database indexes on the child tables (tools/integrity.py INDEXES; export_db_text 16 s -> 0.9 s, build_bank about 12 s ->
  2.3 s); school/alias regexes compiled once (inventory 3 s -> 1.1 s); batch_check builds the inventory once (3.2 s total); page:
  question lookups by the id index (xq and 8 other scans), cached `escalated` (it made chkFigs quadratic) and duplicates map.
- **Dead code removed:** the old exam drawer and header pill handlers, the saved-exam loader nothing rendered, the Bank skill-filter
  leftovers, an unreachable `#home` branch; CSS: the theme-1 palette (theme 2 redefines it), `.steps/.filters/.dots/.more/.ovl`,
  and 279 declarations a later identical selector always replaces (CSS 190 -> 182 KB; page 748 -> 744 KB).
- **One copy instead of many:** QG.val/QG.docs (page-db documents, 15 copies), load()/save() for browser storage (22), one image-pack
  fetch, one fix-note prefix helper (one of three patterns kept "Claude <date> <time>:" visible), tools/criteria.py instead of exec
  of ui_v2_data.py's source, asset_manifest.sha256.
- **Bugs fixed on the way:** a crash on Processes when progress arrived before the bank (B null); export readers missed '~' doc ids
  spelt '@' (import_next.read).
- **Archived** (archive/tools_1121/, kept in git): 8 one-off tools nothing runs (merge_tags_pilot, load_tags, ui_v2_data,
  split_questions, import_manifest, syllabus, migrate_reviews_to_keys, export_frontend + seed_static).
- **Left for later (medium value or needs a visual check):** shared dbPut/saveRev save helpers (wording must stay identical), one modal
  helper for the report form and swap chooser, the three exporters' shared setup, Processes lanes cache, exam-setup pool cache,
  qDiff via exEst (rounding at band boundaries), unused data-attributes/classes, Python: batch_check parsing bank.json once,
  paths.db() everywhere, paper_label/sydney-time/unpack helpers.
