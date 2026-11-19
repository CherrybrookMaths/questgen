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
   deletes them from the live page (17 Nov; batch_check now blocks that). It includes the 40 asset-store packs (data/svg g*,
   data/crop g*): fetch_published.py lists their ids; read each with its own Artifact call (`path` = the id, out_dir
   work/assets_dl), then `--place-assets work/assets_dl`; `--verify` must exit 0 (owner 18 Nov: "go and fix it.", after the 17 Nov
   run wrote empty packs without them). Without them step 3 is skipped (image_lifecycle.py refuses, exit 2).
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
- `kind: "flags"` (the checker's "Fix my flags now", owner 19 Nov): FLAGS.md "Scheduled check" steps 2-4 (this session is already
  set up). Its publish is this run's step 4 publish when both change things: publish once.
- Any other kind: leave it, result "Not handled at night yet".

## 2. Rescan the exam folder (read-only)
Walk the shared folder with tools/drive_listing.py (its docstring has the loop; always orderBy "modifiedTime desc"), then
`python3 tools/scan_folder.py <listing>` (dry run). If it reports new files, `--apply` (it backs up the database itself) and
`python3 tools/inventory.py`. --apply records copies (never imported) and follows moved files; they show on Processes > Papers >
Copies and missing files. Result: "<n> new files recorded, <c> copies set aside, <m> moved, <k> missing". Never touch the folder.

## 3. Images (job 3)
Export `reviews` (ArtifactData `list`, limit 1000 + cursor, out_dir work/pagedb_export_<date>/), then
`python3 tools/image_lifecycle.py <export>` and `python3 tools/bank_split.py`: papers cleared in Review since last night lose
their page scans. If image_lifecycle refuses (exit 2: asset-store packs missing or empty), mark the step failed with its message
and skip steps 3 and 4. Do NOT upload anything here: changed asset-store packs go up in step 4, only after the page test has
passed on them. Result: "<n> papers cleared, <x> MB removed".

## 4. Publish if anything changed
If steps 1–3 changed anything the page shows: the CLAUDE.md "Publish procedure" (prepublish must exit 0 with 0 blockers;
publish only the review page; then --mark-published). Changed asset-store packs (18 Nov): run prepublish first; when the page
test passed ("0 failed") and the only blockers are "asset store: ... re-upload it", upload them (tools/asset_upload_plan.py, which
refuses an empty, missing or halved pack; one Artifact call per file; tools/asset_manifest.py), then prepublish again: 0 blockers
before the publish. Never upload a pack the page test has not passed with. If prepublish fails, do NOT publish: result "Not published:
<first failure>", and stop changing things.

## 5. Back up and push
If questions.db changed: compress it into work/ with `xz -9e -k -c <DB> > work/questions.db.xz` (18 Nov: the zip, 3.15 MB, outgrew the
Drive connector's ~3.1 MB upload limit; xz gives about 2 MB; a file reference works only for a file inside the repo: 16 Nov, a zip in
../outputs was refused), upload it with `base64Content` = `sha256:<hash>:<absolute path>` and `contentMimeType` application/x-xz to the
Drive folder "HSC Advanced Question Bank" as questions.db.xz, rename the previous backup (.xz, or the old questions.db.zip)
"questions.db (superseded <date>, safe to delete).xz" / ".zip" (never trash). If even the .xz nears 3 MB, say so in the result: the
backup then needs splitting into parts (like the figures backup). Commit anything left and
`git -c push.negotiate=true push origin main`.

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
