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
  One exception, owner 23 Nov: "You can addfiles to exam folder." Claude may ADD new files (and a year folder named like the
  others, e.g. "HSC 2019") to the exams folder; never move, rename, overwrite or delete anything there. Check first that the file
  is not already in the drive (by name and size).
- **Keep the bank private** (school trial papers are copyright; the GitHub repo must stay private). Never send the owner's
  email address to an outside service.
- **Record owner rulings verbatim**: quote him in the matching spec (UI_SPEC, IMPORT_PLAYBOOK, DIAGRAM_SPEC, TAG_SPEC ...) and
  in a `// owner <date>: "..."` comment (or `#` in Python) next to the code that implements it. Never undo a recorded ruling
  without asking him (UI_SPEC "Rule for every future change").
- **Import resumed 16 Nov** (owner: "I want improt to run tonight with teh optimal model layout so that my checker human can do that
  tmrw", then "go"), supervised in a session, one batch at a time. **Model per step** (IMPORT_PLAYBOOK "Models per step", from the
  16 Nov trials): parse and solutions Sonnet, tagging Opus, diagrams and verify Opus, no Haiku. The night run still skips imports
  until the owner says otherwise.
- **Imports resumed 18 Nov, through the API** (owner: "Run batch 9, keep track of cost", then "use the api yeah"; this lifts the 17 Nov
  hold "not yet. no importing until i escelate this new prediction."). Supervised in a session, one batch at a time, through
  tools/api_import.py, cost logged per step and paper (IMPORT_PLAYBOOK "Import through the API"). API key `QG_ANTHROPIC_API_KEY`; owner:
  "the monthly limit is $300 right now. I can change it later." (reminded 18 Nov before Batch 9); raised 23 Nov:
  "budget is now 600 monthly"; raised 24 Nov for 8 Standard batches (about US$320): "Just go and run 8 batches, its fine." -> US$900 (tools/costs.py MONTHLY_LIMIT_USD; a batch stops itself before the month passes the cap less US$20, now US$880). The night run still skips imports.
- **Imports paused 25 Nov** (owner: "no more imports at the moment"): no import batches, supervised or night, until he says otherwise.
- **src/ holds the exam PDFs**: never move, publish or delete them (untracked; absent in a fresh clone).
- **Page code only in page_src/**, then `python3 tools/build_page.py`. Never edit site/review.html.
- **CODE_HEALTH.md every round**: follow its rules, list exceptions in the report, reviewers check the diff against it.
- **Parallel work in git worktrees** (CODE_HEALTH "Parallel work"); only the publish is sequential.
- **Read the clock before stamping a time**: `TZ=Australia/Sydney date -Iminutes`. Never type times from memory.
- **Processes tab stays current**: when a job starts or ends, update the page db docs `progress/queue`
  ({items:[{id,title,detail,status:'queued'|'running'|'done',order,asked}],updated}) and `progress/jobs` with ArtifactData.
- **Next up stays current** (owner 17 Nov: "can u keep track of the up next while we work so no dead tasks"): page db `notes`.
  Add a note when work is promised or deferred, tick it (done, doneAt from the clock) the moment it lands, rewrite one whose
  condition or wording went stale, and before the final reply of every request list `notes` and fix anything dead. A note
  another session wrote is checked against the live state before it is acted on (17 Nov: two 13:12 notes from another
  session were already done here).
- Copy questions.db into archive/ (or next to it) before any tool writes to it for the first time in a session.
- No machine paths in tools/: locations come from tools/paths.py (batch_check blocks a hard-coded one).
- **Unattended sessions (16 Nov)**: .claude/settings.json pre-approves every tool this project uses (owner 16 Nov: "So can u stop
  asking me FOR PERMISSION? I GIVE ALL PERMISSION"; earlier "yes night can push", "yes publishing rule"): shell, files, the
  Artifact tools, the page database and Google Drive. Nothing stops to ask, so the standing rules above are the only guard:
  follow them exactly. Publish only the review page, and only
  after `prepublish.sh` exits 0 (0 blockers). Since 25 Nov prepublish runs the CORE page test (core groups + those for page code changed
  since the last publish; owner: "Do you want the core-set-per-publish plus full-suite-at-night setup? yes i want this"); the night run
  runs the full suite (NIGHT.md 4b); `prepublish.sh --full` runs it by hand. The night task holds the Google Drive connector (owner: "yes Drive for the night
  task"): read the exam folder and the DB backup, upload the new backup; never trash, move or rename. Imports stay paused
  (owner 16 Nov: "no imports yet"); the owner resumed imports for supervised sessions on 16 Nov ("go"), not for the night run.

## Where everything lives
| What | Where |
|---|---|
| Code + state | This GitHub repo (private). `state/` = tracked state no tool can rebuild (see below). |
| Database `questions.db` | Not in git. Backups: Google Drive folder "HSC Advanced Question Bank", id `1mD-XIPf4vrrtJSFybjsjXgl_ezPq2F8S`, files `questions_<date>.db.xz.part00` (`<date>` = Sydney `YYYYMMDD-HHMM` since 25 Nov), `.part01` + `.SHA256SUMS.txt` since 23 Nov (owner: "Lets split the db backup as well"; tools/db_backup.py), one `questions.db.xz` 18-23 Nov (`questions.db.zip` before: the zip outgrew the Drive connector's ~3.1 MB upload limit; owner: "I'm happy for the db run") (newest one without "superseded" in its name). Tools find it via `$QG_DB` (tools/paths.py). |
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

**Figure crop originals** (`figures/`, 992 PNGs, 60 MB): not in git and not published. Backed up 14 Nov to Drive, in the
folder above, subfolder "Figure crops backup 14 Nov (tar in 21 parts)", id `1iW16viNoAenpGwbxbYZSsUbVrgoGsMnB`: download
`figures_20261114.tar.part00` … `part20` and `SHA256SUMS.txt`, check with `sha256sum -c SHA256SUMS.txt`, then
`cat figures_20261114.tar.part* | tar -x` in the repo root (gives `figures/`). Since 17 Nov crops are build output:
`python3 tools/recrop.py <doc ids>` re-cuts them from the PDFs (page + bbox in the database; hand-edited ones are kept in
state/figures_kept/), proven identical on Batch 6 (IMPORT_PLAYBOOK "Figure crops are build output"). The exam PDFs' page renders are rebuilt from the PDFs (pdftoppm).

## Fresh session: start here
Run from the repo root (e.g. /home/user/questgen). Shell variables do not survive between Bash calls: either restore the DB to
the default path `<repo>/../questions.db`, or put `export QG_DB=...` in ~/.bashrc.
0. **Time zone:** a cloud container runs on UTC and most tools stamp local time (batch_check, page_test). Prefix tool runs
   with `TZ=Australia/Sydney` (e.g. `TZ=Australia/Sydney bash tools/prepublish.sh`). snapshot.py stamps Sydney time itself,
   and takes the next version from the "publish vNNN" commit messages as well as the tags (tags do not reach GitHub, so a
   fresh clone lacks the newest ones).
1. `npm ci` (katex + mathjax for tools/check_latex.js and vendor checks).
2. `pip install pymupdf pillow numpy scipy` (if `python3 -c "import pymupdf,PIL,numpy,scipy"` fails).
3. Playwright for the page test: `node -e "require('playwright')"`. If that fails: `npm i --no-save playwright@1.63.0 &&
   npx playwright install --with-deps chromium`. Other tools, only when needed: pdflatex (TeX Live with standalone, pgfplots,
   txfonts, pdfrender), pdftoppm/pdftocairo, tesseract.
4. Database: download the newest set of `questions_<date>.db.xz.part*` + its `SHA256SUMS.txt` (before 23 Nov one `questions.db.xz`, before 18 Nov `questions.db.zip`) from the Drive folder above (Google Drive connector `download_file_content`;
   read only) into one folder and `python3 tools/db_backup.py join <folder>` (checks and decompresses to the DB path); a single .xz: decompress it (`xz -dc questions.db.xz > <dest>`, or `python3 -c "import lzma,shutil,sys;shutil.copyfileobj(lzma.open(sys.argv[1]),open(sys.argv[2],'wb'))" questions.db.xz <dest>`; a .zip: unzip) to `$QG_DB` (or `<repo>/../questions.db`), then `python3 tools/paths.py` must show DB without "(missing)".
5. **Required before any publish** (17 Nov: image files are not in git; a publish from a session without them deletes them from
   the live page, and batch_check blocks it). Image packs from the published page: `python3 tools/fetch_published.py` prints the missing published files (data/img/*,
   data/svg/g0..g7, data/cmp/g0, about 140 MB) in batches. For each batch: Artifact tool `action: "read"`,
   `url` = the review page, `paths` = the batch, NO out_dir (it saves under the scratchpad), then
   `python3 tools/fetch_published.py --place <the folder the result names>`. Never `out_dir` = `<repo>/site`: it stops on a
   permission prompt only a person can answer (24 Nov: the 2:43 pm flag check sat blocked on it until Steve's session stepped in). Then `python3 tools/fetch_published.py --verify`
   (must say every published file is present; a note that the 8 svg packs differ in bytes is expected: same content, older
   key order, resent at the next publish). It also records the live version this checkout is synced to (work/synced_publish.txt):
   batch_check BLOCKS while another session (e.g. the night run) has published since this checkout last published or synced
   (owner 19 Nov, after the night run's v266 re-uploaded crop packs this session still held old copies of), and prepublish stops
   while GitHub has commits this checkout lacks. To resync: `git merge origin/main`, then `--verify`; it names any asset pack held
   here in an older copy (re-read its id, then `--place-assets`) and any page-scan pack the live page dropped (`--archive-removed`). It also lists the 40 asset-store packs (data/svg g*, data/crop g*; 18 Nov, owner
   "go and fix it."): read each id in its own Artifact call (`path` = the id; a `paths` list is refused), then
   `--place-assets <dir>`. image_lifecycle.py and asset_upload_plan.py refuse to run without them. Tested 14 Nov: 4 read calls, 66 files, 138 MB, a few seconds each.
   Only for diagram work (tikz_render.sh, overlay.py): `python3 tools/fetch_published.py --figures-from-packs` rebuilds 988 of
   the 992 crops in figures/ from the packs: approximations (ink from alpha, at most 900 px wide), not the originals.
6. `bash tools/prepublish.sh` (about 4 min): build, core page test, batch_check. It must exit 0 before any publish.
   In a fresh clone expect 0 blockers and these warnings: 979 redraws have no compiled SVG/PNG (tikz/ is rebuilt only for
   diagram work: tools/tikz_render.sh per id), the database changed since triage, bank.json older than the database (file
   dates), 8 svg packs changed since the last publish, and the page-db mirror age (export the collections, then
   tools/sync_pagedb.py; IMPORT_PLAYBOOK "Database integrity").
7. Before any page-db write, check the live page: Artifact `list` with `scope: "files"` on the review page also shows the
   stored capabilities.

## Publish procedure
0. Export `reviews` (ArtifactData `list`, out_dir work/pagedb_export_<date>/) and run `python3 tools/image_lifecycle.py <export>`:
   papers cleared in Review lose their page scans; crops the page can still show go to data/crop/ (job 3). Then
   `python3 tools/bank_split.py` (the index marks which papers still have scans, docs[doc].ip).
1. `bash tools/prepublish.sh` exits 0.
2. `python3 tools/publish_set.py --json > work/publish_set.json`: the `files` map (published path -> path relative to the repo
   root, null = remove). Pass it unchanged.
3. Artifact publish: `url` = the review page, `file_path` = `site/review.html`, `files` = the map. **Omit `capabilities`** to
   keep what the page has. If a change needs new capabilities, send the whole object; a non-empty one replaces everything. Live
   since 14 Nov (v214); 17 Nov roles (UI_SPEC "Roles (17 Nov)"): reviews and difficulty writes raised to admin, notes admin,
   progress written by admin only (read stays view: the page reads progress/import at start for everyone):
   ```json
   {"db": {"rules": [
      {"path": "reviews",  "read": "view",  "write": "admin"},
      {"path": "difficulty", "read": "view", "write": "admin"},
      {"path": "notes",    "read": "admin", "write": "admin"},
      {"path": "progress", "read": "view",  "write": "admin"},
      {"path": "scans",    "read": "admin", "write": "admin"},
      {"path": "runs",     "read": "admin", "write": "admin"},
      {"path": "importq",  "read": "admin", "write": "admin"},
      {"path": "queue",    "read": "admin", "write": "admin"},
      {"path": "batches",  "read": "admin", "write": "admin"},
      {"path": "paperfix", "read": "admin", "write": "admin"}]},
    "downloads": {}, "user": {}, "assets": {}, "comments": {},
    "mcp": {"servers": [{"server": "Google Drive", "tools": ["search_files"]}]}}
   ```
   `"assets": {}` serves the packs in the asset store (data/assets.json). After a publish that carries a re-uploaded pack, delete each
   blob `asset_manifest.py` printed as "superseded: <id>" (Artifact `delete`, `path` = the id; owner 25 Nov: "fix the image store issue as
   well": old copies had filled the 1 GB store); `tools/asset_prune.py <listing>` lists any left behind. `"comments": {}` since v309 (owner 23 Nov: "get a way for claude
   to instantly run flags when checker needs them done"): "Fix my flags now" sends the request to Claude (FLAGS.md "Instant runs").
4. **Every publish, even a capabilities-only one, is followed by** `python3 tools/batch_check.py --mark-published` (16 Nov: an
   unrecorded settings-only publish made the next record one version behind the live page): records the manifest (state/work/published_manifest.json), commits
   everything as "publish vNNN <date>", tags publish-vNNN locally, writes `<OUT>/questgen_repo.bundle`.
5. `git push` the branch to GitHub. Tags cannot be pushed through the session's GitHub proxy, so the version lives in the
   commit message ("publish vNNN ...").
6. Drive sync after major changes: zip questions.db, upload to the Drive folder, rename the old copy "(superseded <date>, safe
   to delete)". Export `reviews` to project/reviews_backup.json (IMPORT_PLAYBOOK "Standing rules").

## First jobs in this session (in order; owner agreed 14 Nov)
Imports stay paused until 1-4 are done. Tick each off in the page's Next up list (db `notes`) as it lands.
1. **Prove the move.** Restore the database, fetch the published packs, `bash tools/prepublish.sh` (0 blockers), publish once
   from here, push to GitHub. Done when: a publish from this session is live and its commit is on GitHub.
2. **Split the start-up index**: done 16 Nov (owner: "Yeah build it"). Slim gzip index + details file read after start;
   ~103 KB today, ~1.0 MB projected at 538 papers of the 2.35 MB budget (CODE_HEALTH "Job 2").
3. **Images: re-render into the asset store, don't move them** (owner 14 Nov: "What if we dropped them and rerendered them in
   the new location?"). Progress 16 Nov:
   - Done: asset store on (v218; 1 GB, 5,000 files). TeX installed; all 979 redraws re-rendered from state/tikz
     (tools/render_redraws.py) and byte-identical to the published approved versions (tools/redraw_compare.js): nothing to
     list for the owner. tools/image_lifecycle.py (v219): 55 cleared papers' scan packs archived (archive/img_cleared/), 117
     crops the page can still show kept in data/crop/g<doc%8>.json, overlays of cleared papers dropped, svg regrouped 8 -> 32
     (asset store limit 20 MiB per file; batch_check warns at 15 MiB). Published files ~147 MB -> ~45 MB.
   - DONE 16 Nov (v220): the 40 permanent packs (data/svg g0..g31, data/crop g0..g7) are served from the asset store
     (data/assets.json); the page holds 15.4 MB in 221 files. A changed pack is re-uploaded by the night run (NIGHT.md step 3).
     Left: compare the hand-fixed crops (state crop_fixes) with the figures/ backup on Drive.
4. **Remove published files the page no longer uses**: done 16 Nov (v217). data/bank.json and project/ are no longer published
   (publish_set EXCLUDE / PROJECT_KEEP; project/open_decisions.json stays, Review reads it). The local site/project/ stays: tools
   read their inputs there. Live: 146.9 MB in 284 files.
5. **Reviews to key docs**: DONE 16 Nov: all 1,052 k_/p_ docs on the page; triage re-run (no tier changes). PDFs over 10 MB
   cannot come through the Drive connector: triage keeps their last wording result (6 papers).
6. **Night run (job 6)**: built 16 Nov. Scheduled task "Questgen night run" (trig_01XTpjAYHRvxyRWAgqZdxnZb), every night 10:11 pm
   Sydney, fresh session, prompt "read NIGHT.md and run it". NIGHT.md is the runbook; the Tonight card on Processes › Work shows
   its list (page db progress/night + runs requested). Imports are skipped while paused. The owner added the Google Drive
   connector in claude.ai/code/routines (16 Nov; a session cannot attach connectors to a task in this organisation: edit the
   task there, Advanced settings > Connectors).

7. **Checker flags**: owner 17 Nov: "No, just fix it and put it back in the review list, drop the sweep". The hourly sweep task was
   deleted the same day. When the owner (or a comment sent to Claude) asks, fix the checker's open flags and diagram change requests
   by FLAGS.md steps 1-5 and hand each back for approval.
   Since 19 Nov (owner: "I need a way for the reviewer to run flags" -> "Button + checks in shift", "monday, tuesday, wednesday,
   friday 9-5 all those days"): the checker's "Fix my flags now" on Review writes runs/flags_*; scheduled task "Questgen flag check"
   (trig_01J5E9pn3VHBVu8zf2wFg5Jh, fresh session, hourly 9 am-4 pm Sydney Mon Tue Wed Fri) runs FLAGS.md "Scheduled check"; the night
   run clears requests still waiting. It needs the Google Drive connector added in claude.ai/code/routines (as the night task).
   Every 15 minutes since 24 Nov (owner: "Lets make it a 15 minute thing, it sends flags every 15"): three copies at :19, :34, :49
   (trig_01RNM5jiDb9XPHYLGumuLFRx, trig_01Kc57bbNUQ9MvEe1jaQeE1W, trig_01DBkja1MFEfUo3KJH4zZk8G) beside the original at :04 (one task may not
   fire more than hourly). Each needs Drive added the same way. Instant runs do not work: no session can register a watch on the page
   ("mint_failed", 24 Nov, sessions started by Claude and by Steve); only the session that registered on 23 Nov still hears comments.

## Open items (14 Nov)
- Details for jobs 2, 3, 5 and 6 above: the reviews migration has 22 ArtifactData batches (1,052 writes: k_<key> and
  p_<paper key> docs) in state/work/keys_migration/ (report.txt: 1,615 approvals kept); until applied, the page reads the old
  q<id> / paper_<doc> docs as a fallback. The old asset-store plan (IMPORT_PLAYBOOK "Asset store") is superseded by job 3.
- **Model trial (16 Nov)**: owner: "skip the trial, I'm getting someone to do it externally". Do not run it here. The Drive
  folder "Model trial 16 Nov" (brief + data pack, no answer key) and MODEL_TRIAL_BRIEF.md (scoring half) stay for whoever does it.
- **API decision** (run imports through the API or in-session): decide after 1-2 weeks of measured nightly runs (tokens,
  minutes and failures per paper; measured costs per paper and batch: tools/costs.py -> Processes › Papers › Costs, 21 Nov).
- **Review grouped by batch**: a Next up note in the page (db `notes`).
- **Paper calls 644 and 377 and Q302**: resolved: all three approved in Review (checked 16 Nov); nothing is waiting there.
- **Publish manifest vs live**: resolved 16 Nov (v217): the stale project/ copies are gone. publish_set `--live FILE` (one published
  path per line, from Artifact `list` scope "files") also nulls anything the live page holds outside the publish set.
- **What a fresh session still cannot do**: re-crop or add papers without the source PDFs (download them by Drive id to src/;
  add_to_bank.py, crop_check.py, prep_verify.py and triage.py open src/<doc>.pdf, and triage.py crashes without it); rebuild
  data/img packs exactly without the figures/ backup from Drive; run the
  render audit offline (it installs MathJax 4.1.3 from npm into SCRATCH).
