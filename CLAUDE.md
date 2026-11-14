# Questgen: HSC Maths question bank (read this first)

Claude Code loads this file at the start of every session. It says who you work for, the rules, where everything lives, how to
start in a fresh session, how to publish, and what is open. History and detail: RESUME.md, IMPORT_PLAYBOOK.md, UI_SPEC.md,
CODE_HEALTH.md (read all four before changing anything).

## The owner
Steve Yeung, CMC Education (NSW HSC Maths tutoring). The bank is built from NSW HSC and trial exam papers (Year 12 Mathematics
Advanced so far; Standard, Extension 1 and 2 later). He never runs git or the tools himself; he works in the review page.

His standing instructions, verbatim (his account preferences; follow them in every reply and report):

> You are my advisor, not my assistant. Your job is accuracy, not agreement. Follow these rules in every reply:
>
> **1.** Do not open with agreement or praise. If my idea has a flaw, gap, or risky assumption, state it in your first sentence. If my idea is solid, say so plainly in one line and move on. Never invent objections just to disagree
>
> **2.** Rate your confidence on key claims: [Certain] for hard evidence, [Likely] for strong inference, [Guessing] when filling gaps. If most of your reply is guesswork, say so upfront
>
> **3.** Never use filler praise: "Great question," "You're absolutely right," "That makes sense," "Absolutely," "Definitely."

In short: flaws first, [Certain]/[Likely]/[Guessing], no filler praise.

## Standing rules
- **Never trash Drive files.** Upload the new copy, then rename the old one "(superseded <date>, safe to delete)".
- **Never move, rename or reorganise anything in the school shared drive** (the exams folder below). Read only. Our record
  of it lives on our side (documents table, site/data/inventory.json).
- **Keep the bank private** (school trial papers are copyright; the GitHub repo must stay private). Never send the owner's
  email address to an outside service.
- **Record owner rulings verbatim**: quote him in the matching spec (UI_SPEC, IMPORT_PLAYBOOK, DIAGRAM_SPEC, TAG_SPEC ...) and
  in a `// owner <date>: "..."` comment (or `#` in Python) next to the code that implements it. Never undo a recorded ruling
  without asking him (UI_SPEC "Rule for every future change").
- **Import is paused** (owner 14 Nov: "no more importing for a while until we iron these out"). Do not import papers until he
  resumes it; the index split (Open items) must land first anyway.
- **src/ holds the exam PDFs**: never move, publish or delete them (untracked; absent in a fresh clone).
- **Page code only in page_src/**, then `python3 tools/build_page.py`. Never edit site/review.html.
- **CODE_HEALTH.md every round**: follow its rules, list exceptions in the report, reviewers check the diff against it.
- **Parallel work in git worktrees** (CODE_HEALTH "Parallel work"); only the publish is sequential.
- **Read the clock before stamping a time**: `TZ=Australia/Sydney date -Iminutes`. Never type times from memory.
- **Processes tab stays current**: when a job starts or ends, update the page db docs `progress/queue`
  ({items:[{id,title,detail,status:'queued'|'running'|'done',order,asked}],updated}) and `progress/jobs` with ArtifactData.
- Copy questions.db into archive/ (or next to it) before any tool writes to it for the first time in a session.
- No machine paths in tools/: locations come from tools/paths.py (batch_check blocks a hard-coded one).

## Where everything lives
| What | Where |
|---|---|
| Code + state | This GitHub repo (private). `state/` = tracked state no tool can rebuild (see below). |
| Database `questions.db` | Not in git. Backups: Google Drive folder "HSC Advanced Question Bank", id `1mD-XIPf4vrrtJSFybjsjXgl_ezPq2F8S`, file `questions.db.zip` (newest one without "superseded" in its name). Tools find it via `$QG_DB` (tools/paths.py). |
| Live review page | https://claude.ai/artifact/MSd3GSrwsAqwzmBX8wSC8f : the page (index.html = site/review.html), its published files (data/bank/, data/img/, data/svg/, data/cmp/, project/ copies of specs and tools), and the page database (collections reviews, difficulty, exams, reports, notes, progress, queue, batches, runs, scans, importq, paperfix). |
| Exam PDFs (source) | School shared drive "CMC Resources", id `1RtOEps_I-vXw0s3fi_VNMaZRHu6d3ldVei8`, folder "Exams › External Exams Stage 6", id `1yItEV6bFpGyrJDpDrAle0RgPKqsfjTOZ`. Read only. Drive file ids per paper: site/project/drive_ids.csv, state/work/import/papers.json, site/data/inventory_files.json. Local copies go to src/<doc id>.pdf (untracked). |
| Owner's to-do list | Page db collection `notes` ("Next up" on Processes): ArtifactData `list` on `notes`. |

**tools/paths.py** (`python3 tools/paths.py` prints them): ROOT = this checkout; DB = `$QG_DB`, else the first sandbox's
`/mnt/user-data/outputs/questions.db` if it exists, else `<ROOT>/../questions.db`; OUT (bundles) = `$QG_OUT`, else that
outputs folder if it exists, else `<ROOT>/../outputs`; STATE = `<ROOT>/state`; WORK = `<ROOT>/work` (untracked scratch);
SRC = `<ROOT>/src`; SCRATCH = `$QG_SCRATCH`, else `<tmp>/questgen`.

**state/** mirrors the old paths: a spec or docstring that says `work/triage.json`, `tikz/tex/`, `tikz/all_results.json`,
`out/<doc>.json` or `site/data/bank_v1.json` means `state/work/triage.json`, `state/tikz/tex/` and so on. It holds: work/import/
(import state, papers.json, batches.json run log), triage.json + sample_locked.json + triage_inputs.json, the verifier outputs
(work/b*/verify_out_*.json, work/verify/render.json), crop flags/fixes, published_manifest.json, tag disagreements and gates,
work/skills (dotpoints, skill_prereqs), restructure/merge_map.json, decide_* and pending_rulings.md / overnight_report.md,
work/batches.json (lanes), importq_seed.json, keys_migration/ (batches + report), tikz/tex + examstyle.tex + tree_style.tex
(the only correct diagram sources; 0.6 pt style), all_results.json, overlay_scores.json, user_feedback_*.json,
site/data/bank_v1.json (build_bank.py input) and out/ (parse outputs). About 11 MB. Tools write it in place; it is committed
at every publish.

**Not anywhere you can fetch:** the original figure crops (`figures/`, 60 MB) and the exam PDFs' page renders. The data/img
packs hold processed copies of the crops (see "Fresh session" step 5).

## Fresh session: start here
Run from the repo root (e.g. /home/user/questgen). Shell variables do not survive between Bash calls: either restore the DB to
the default path `<repo>/../questions.db`, or put `export QG_DB=...` in ~/.bashrc.
1. `npm ci` (katex + mathjax for tools/check_latex.js and vendor checks).
2. `pip install pymupdf pillow numpy scipy` (if `python3 -c "import pymupdf,PIL,numpy,scipy"` fails).
3. Playwright for the page test: `node -e "require('playwright')"`. If that fails: `npm i --no-save playwright@1.63.0 &&
   npx playwright install --with-deps chromium`. Other tools, only when needed: pdflatex (TeX Live with standalone, pgfplots,
   txfonts, pdfrender), pdftoppm/pdftocairo, tesseract.
4. Database: download the newest `questions.db.zip` from the Drive folder above (Google Drive connector `download_file_content`;
   read only), unzip it to `$QG_DB` (or `<repo>/../questions.db`), then `python3 tools/paths.py` must show DB without "(missing)".
5. Image packs from the published page: `python3 tools/fetch_published.py` prints the missing published files (data/img/*,
   data/svg/g0..g7, data/cmp/g0, about 140 MB) in batches. For each batch: Artifact tool `action: "read"`,
   `url` = the review page, `paths` = the batch, `out_dir` = `<repo>/site` (asks once), or no out_dir and then
   `python3 tools/fetch_published.py --place <the folder the result names>`. Then `python3 tools/fetch_published.py --verify`
   (must say every published file is present; a note that the 8 svg packs differ in bytes is expected: same content, older
   key order, resent at the next publish). Tested 14 Nov: 4 read calls, 66 files, 138 MB, a few seconds each.
   Only for diagram work (tikz_render.sh, overlay.py): `python3 tools/fetch_published.py --figures-from-packs` rebuilds 988 of
   the 992 crops in figures/ from the packs: approximations (ink from alpha, at most 900 px wide), not the originals.
6. `bash tools/prepublish.sh` (about 3 min): build, page test (162 checks), batch_check. It must exit 0 before any publish.
   In a fresh clone expect 0 blockers and these warnings: 979 redraws have no compiled SVG/PNG (tikz/ is rebuilt only for
   diagram work: tools/tikz_render.sh per id), the database changed since triage, bank.json older than the database (file
   dates), 8 svg packs changed since the last publish, and the page-db mirror age (export the collections, then
   tools/sync_pagedb.py; IMPORT_PLAYBOOK "Database integrity").
7. Before any page-db write, check the live page: Artifact `list` with `scope: "files"` on the review page also shows the
   stored capabilities.

## Publish procedure
1. `bash tools/prepublish.sh` exits 0.
2. `python3 tools/publish_set.py --json > work/publish_set.json`: the `files` map (published path -> path relative to the repo
   root, null = remove). Pass it unchanged.
3. Artifact publish: `url` = the review page, `file_path` = `site/review.html`, `files` = the map. **Omit `capabilities`** to
   keep what the page has. If a change needs new capabilities, send the whole object; a non-empty one replaces everything. Live
   since 14 Nov (v214):
   ```json
   {"db": {"rules": [
      {"path": "reviews",  "read": "view",  "write": "interact"},
      {"path": "scans",    "read": "admin", "write": "admin"},
      {"path": "runs",     "read": "admin", "write": "admin"},
      {"path": "importq",  "read": "admin", "write": "admin"},
      {"path": "queue",    "read": "admin", "write": "admin"},
      {"path": "batches",  "read": "admin", "write": "admin"},
      {"path": "paperfix", "read": "admin", "write": "admin"}]},
    "downloads": {}, "user": {},
    "mcp": {"servers": [{"server": "Google Drive", "tools": ["search_files"]}]}}
   ```
   Packs in the asset store (when data/assets.json lists any) need `"assets": {}` added.
4. `python3 tools/batch_check.py --mark-published`: records the manifest (state/work/published_manifest.json), commits
   everything as "publish vNNN <date>", tags publish-vNNN locally, writes `<OUT>/questgen_repo.bundle`.
5. `git push` the branch to GitHub. Tags cannot be pushed through the session's GitHub proxy, so the version lives in the
   commit message ("publish vNNN ...").
6. Drive sync after major changes: zip questions.db, upload to the Drive folder, rename the old copy "(superseded <date>, safe
   to delete)". Export `reviews` to project/reviews_backup.json (IMPORT_PLAYBOOK "Standing rules").

## Open items (14 Nov)
- **Index size budget.** data/bank/advanced/index.json is 1.8 MB of its 2.2 MB start-load budget and grows about 1.1 KB per
  question: it blocks after roughly 10 more papers. Split the index per course/topic (or trim it) before imports resume.
- **Image packs to the asset store: redesign first.** The plan (IMPORT_PLAYBOOK "Asset store") needs 66 one-file-per-call
  uploads and the store's quota is unknown (only visible at runtime). data/assets.json is empty; every pack is still a
  published file.
- **Reviews migration to key docs not applied.** 22 ArtifactData batches (1,052 writes: k_<key> and p_<paper key> docs) are
  ready in state/work/keys_migration/ (report.txt: 1,615 approvals kept). Until applied, the page reads the old q<id> /
  paper_<doc> docs as a fallback. Re-export reviews and regenerate the batches first if reviews changed since 14 Nov.
- **Nightly import scheduled task**: set up after the move (IMPORT_PLAYBOOK "Queue": import_next.py loop, stop-early rules).
- **API decision** (run imports through the API or in-session): decide after 1-2 weeks of measured nightly runs (tokens,
  minutes and failures per paper; inventory.py COST_PER_PAPER is a placeholder).
- **Review grouped by batch**: a Next up note in the page (db `notes`).
- **Two open paper calls** (site/project/open_decisions.json): paper_644 (2025 Cherrybrook, cover "AP3", filed AT3) and
  paper_377 (2024 North Sydney Boys, cover "Assessment Task 3", a trial). Plus Q302: flagged without a note.
- **Publish manifest vs live (review 14 Nov)**: state/work/published_manifest.json lists 429 files, the live page holds 427.
  The manifest lists project/brand/*.svg (5 files) that the live page does not hold, so publish_set will not send them until
  they change; the live page holds stale project copies (e.g. proc.py.txt, load.py.txt, schema.sql.txt) that publish_set
  offers as optional nulls. Compare with Artifact `list` `scope: "files"` before trusting the manifest.
- **What a fresh session still cannot do**: re-crop or add papers without the source PDFs (download them by Drive id to src/;
  add_to_bank.py, crop_check.py, prep_verify.py and triage.py open src/<doc>.pdf, and triage.py crashes without it); rebuild
  data/img packs exactly or compare redraws against the original crops (figures/ originals are not stored anywhere); run the
  render audit offline (it installs MathJax 4.1.3 from npm into SCRATCH).
