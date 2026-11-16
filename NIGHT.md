# Night run (job 6)

The nightly scheduled task ("Questgen night run") starts a fresh Claude Code session at 10:11 pm Sydney with the prompt "read
NIGHT.md and run it". Follow this file top to bottom. Nobody is watching: never ask a question; when something needs
the owner, write it into the results (step 6) and carry on with the next item.

Owner rulings this follows (CLAUDE.md "Standing rules"): "yes night can push", "yes publishing rule", "yes Drive for the night
task", "I GIVE ALL PERMISSION"; imports stay paused ("no imports yet", 16 Nov) until he resumes them.

## What tonight does = the Tonight card
The Tonight card on Processes › Work shows exactly what this run does, from two places in the page database:
- `progress/night` `steps`: the fixed steps below (keep them in sync with this file when it changes) and `skipped`;
- `runs` with `status: "requested"`: what the owner asked for from page buttons (cover-page check, import queue). He can
  remove one before the run (it becomes `cancelled`): never run a cancelled request.

## 0. Start
1. The repo: if /home/user/questgen is missing, attach CherrybrookMaths/questgen with the add_repo tool (push access) and
   clone it there. Read CLAUDE.md (it loads automatically) and follow "Fresh session: start here" steps 0–5 and 7. Step 5 (fetch the published image files with
   tools/fetch_published.py) is required, not optional: image files are not in git, and a publish from a session that lacks them
   deletes them from the live page (17 Nov; batch_check now blocks that).
2. `TZ=Australia/Sydney date -Iminutes` → write `progress/jobs` {jobs: [{name: "Night run", started: <now>}], updated} and
   `progress/night` `last: {at: <now>, items: [], running: true}` (ArtifactData; read the doc first, pass its version).

## 1. Requests (from `runs`, status "requested", oldest first)
- `kind: "queue"` (import queue): while imports are paused, do not import. Leave it `requested`; result "Skipped: imports are
  paused (owner 16 Nov)". When the owner resumes imports, this item follows IMPORT_PLAYBOOK "Queue" (tools/import_next.py).
- `kind: "cover_check"` (Needs a check: course or year not known from the file name): set the run `status: "running"`. For each
  paper id in `papers`: download its PDF read-only (documents.drive_file_id, Google Drive `download_file_content`) to
  `src/<id>.pdf`, render page 1 (`pdftoppm -png -r 110 -f 1 -l 1`) and look at it. Decide course (advanced, standard, ext1,
  ext2) and year level (11, 12) only when the cover states them plainly; otherwise leave the paper for the owner with a
  one-line reason. Copy questions.db to archive/ first, then record the settled ones in `documents` (course, year_level) and
  write all answers to `state/work/cover_check_<date>.json` ({paper id: {course, year_level, how, or reason}}). Run
  `python3 tools/inventory.py` so settled papers move into their lanes. Set the run `status: "done"` with
  `result: "<n> sorted into lanes, <m> need you"`.
- Any other kind: leave it, result "Not handled at night yet".

## 2. Rescan the exam folder (read-only)
Walk the shared folder with tools/drive_listing.py (its docstring has the loop; always orderBy "modifiedTime desc"), then
`python3 tools/scan_folder.py <listing>` (dry run). If it reports new files, `--apply` (it backs up the database itself) and
`python3 tools/inventory.py`. --apply records copies (never imported) and follows moved files; they show on Processes > Papers >
Copies and missing files. Result: "<n> new files recorded, <c> copies set aside, <m> moved, <k> missing". Never touch the folder.

## 3. Images (job 3)
Export `reviews` (ArtifactData `list`, limit 1000 + cursor, out_dir work/pagedb_export_<date>/), then
`python3 tools/image_lifecycle.py <export>` and `python3 tools/bank_split.py`: papers cleared in Review since last night lose
their page scans. If any changed pack is in the asset store, re-upload it (tools/asset_upload_plan.py, then
tools/asset_manifest.py). Result: "<n> papers cleared, <x> MB removed".

## 4. Publish if anything changed
If steps 1–3 changed anything the page shows: the CLAUDE.md "Publish procedure" (prepublish must exit 0 with 0 blockers;
publish only the review page; then --mark-published). If prepublish fails, do NOT publish: result "Not published:
<first failure>", and stop changing things.

## 5. Back up and push
If questions.db changed: zip it into work/ (a file reference works only for a file inside the repo: 16 Nov, a zip in
../outputs was refused), upload it with `base64Content` = `sha256:<hash>:<absolute path>` to the Drive folder "HSC Advanced Question Bank" as questions.db.zip, rename the
previous one "questions.db (superseded <date>, safe to delete).zip" (never trash). Commit anything left and
`git -c push.negotiate=true push origin main`.

## 5b. Back up new figure crops (owner 17 Nov: "Can you also do it without asking for permission?")
The original crops in `figures/` are not in git and not published. After a batch (any `figures/*.png` not in the newest
"Figure crops backup" folder's SHA256SUMS.txt in the Drive folder "HSC Advanced Question Bank"): tar the new crops, split into
**3 MB parts** (`split -b 3M -d -a 2`; the Drive connector refuses a call carrying more than about 3.1 MB), write SHA256SUMS.txt,
create a subfolder "Figure crops backup <date> (tar in N parts)" and upload each part (base64Content as a file reference
`sha256:<hash>:<absolute path>` from inside the repo). Never trash or rename older backups. Result: "<n> new crops backed up
in <k> parts" or "No new crops". If tonight's session has no figures/ (a fresh container), say "Crops not in this session:
backup needs the session that made them" and carry on.

## 6. Results (always, even after a failure)
Write `progress/night`:
- `last: {at: <start time>, finished: <now>, items: [{title, status: "done"|"failed"|"skipped", result}]}`, one item per
  step and request above, in order, each result one plain sentence the owner can act on;
- `steps` and `skipped` unchanged unless this file changed;
then `progress/jobs` {jobs: [], updated}. Record minutes per step and the session's own sense of effort in
`state/work/night_log.json` (append), for the API decision (CLAUDE.md "Open items").

## Stop rules
- The database cannot be restored from Drive: write the result "Night run stopped: database backup not found" and stop.
- A step fails twice: mark it failed with the error in one sentence and go on to the next step; never publish after a failed
  prepublish.
