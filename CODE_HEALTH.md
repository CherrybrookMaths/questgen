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
6. **Watch size.** The pre-publish check reports page size and bank size against a budget; growth past it is a blocker
   until the owner agrees.

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
3. **Size budget** in batch_check: `tools/size_budget.json` (size on 13 Nov + 25%). Over budget blocks until the owner agrees.
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
- The whole 5 MB bank loads at start (split by topic/course when import resumes; bank.json is at 80% of its budget).
- Course outside the page: build_bank.py, add_to_bank.py, inventory.py, the tag/difficulty specs and dotpoints.json are
  Advanced-only. The Guide's worked examples are facts about Advanced; "2024 syllabus" wording is shared by all courses.
- Local variables named `B` in 24_exams.js, 28_schema.js and 34_papers_run.js shadow the bank alias: rename when touched.
- `XA_DEF` still carries the old drawer fields (`open`, `topen`); saved exams hold them. Harmless.
- `data/bank_v1.json` (3.3 MB) is published but only build tools read it. Kept because it is not in git and the artifact is
  its only off-sandbox copy.

## Job times on Processes (owner 13 Nov: "Are you times right? It said the recent task started 6:05")
Times in progress/queue were typed from memory and drifted (the inventory round showed 6:05; it started 7:06).
Always stamp started/finished/eta from the clock (`TZ=Australia/Sydney date -Iminutes`), never from memory.

## Parallel work (owner 13 Nov: "there has to be a way for the importer to not block the bank page right? They don't seem related.")
Unrelated changes run in parallel, each in its own git worktree (e.g. /home/claude/wt_<name>, branch <name>), with ignored
data folders symlinked in but its OWN work/ folder (page_test writes there). Merge into main when the running round has
committed, rebuild, run prepublish, publish once. Only the publish itself is sequential.
Worktree setup: symlink node_modules, site/data/{cmp,img,svg}, site/figures, site/pages, tikz; real work/ with copies of
pilot/work/*.json. A publish made from a worktree is not recorded in main's manifest until the branch is merged and
--mark-published runs in main.

## Framework (owner 13 Nov)
Asked "is react better if we are going to deploy?", then "ok great, lets not switch then". Stay on plain JS in page_src/.
Revisit the framework choice only when moving to real servers (that move rebuilds the data layer anyway). Until then the
health rules above keep the code shaped so a later move is cheap: state in one module, styles scoped per view, course as data.
