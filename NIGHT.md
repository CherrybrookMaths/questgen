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

## While an import is running (owner 23 Nov)
Owner 23 Nov: "please take actions to ensure that the batches are ready for checking by the morning" (an overnight import of Advanced
batches through tools/api_import.py, run from the owner's session). Before anything else, read `progress/jobs`. If it lists a job
whose name starts with "Import" and whose `started` is under 12 hours old, an import owns the database, the batch lists and the
publishes tonight:
- do NOT overwrite `progress/jobs`: add "Night run" to its list and remove only that entry at the end;
- requests (step 1): leave every `runs` doc as it is (flag requests too: the import session publishes; the shift check or the next
  night run takes them);
- skip steps 2 (rescan: it writes the database and the lanes), 3, 3b and 3c, 4 (publish) and 5 (backup: the importing session backs
  the database up when it finishes);
- step 6: results as usual, each skipped step "Skipped: import running (<job name>)".
Never stop or change the import.

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

## 3b. Your difficulty ratings into the database (owner 19 Nov)
Owner 19 Nov: "yeah apply suggestion or tweak it yourself in the page. It shouldn't need to be sent to claude every time". Ratings
set in the page (Reports › Apply suggestion, Review › Difficulty) are `difficulty/<part_id>` docs; the page uses them at once. Here
they reach the database: export `difficulty` (ArtifactData `list`, limit 1000 + cursor, out_dir work/pagedb_difficulty_<date>/),
copy questions.db to archive/, `python3 tools/apply_difficulty_reviews.py work/pagedb_difficulty_<date>/difficulty`, then
`python3 tools/build_bank.py` and `python3 tools/bank_split.py`. Result: "<n> of your ratings in the database".
Fixed 21 Nov: build_bank.py keeps a redraw's existing picture when there is no local SVG (a fresh clone has no tikz/svg), so the
packs stay as fetched; do NOT run `fetch_published.py --place-assets` here (on 20 Nov it also restored the crop packs and undid
step 3's crop changes). batch_check blocks a build whose svg packs lost any redraw the bank lists.

## 3c. Keep the code lean (owner 21 Nov: "This should really be done every night so it stays lean")
1. `python3 tools/lean_check.py --fix-css`, then `python3 tools/build_page.py`. It removes only CSS declarations a later identical
   selector always replaces (provably no visible change); step 4's page test gates the publish as usual. Everything else it finds
   (CSS classes or page functions nothing uses, size growth) is reported, never changed at night.
2. If page_src/ or tools/ changed since the last night run (`git log --since=<last night> -- page_src tools`), one read-only
   reviewer agent reads only that diff against CODE_HEALTH.md (dead code, duplicated logic, slow loops) and lists proven findings.
3. Findings from 1 (report part) and 2 go to Next up as one note "Lean check <date>" (skip when there are none). Nothing found:
   result "Lean: nothing to clean". The fixes themselves are done in a supervised session, not at night.

## 4. Publish if anything changed
If steps 1–3 changed anything the page shows: the CLAUDE.md "Publish procedure" (prepublish must exit 0 with 0 blockers;
publish only the review page; then --mark-published). Changed asset-store packs (18 Nov): run prepublish first; when the page
test passed ("0 failed") and the only blockers are "asset store: ... re-upload it", upload them (tools/asset_upload_plan.py, which
refuses an empty, missing or halved pack; one Artifact call per file; tools/asset_manifest.py), then prepublish again: 0 blockers
before the publish. After the publish, delete each blob asset_manifest.py printed as "superseded: <id>" (Artifact `delete`, `path` = the
id; owner 25 Nov: "fix the image store issue as well"; `tools/asset_prune.py` lists any left behind). Never upload a pack the page test has not passed with. If prepublish fails, do NOT publish: result "Not published:
<first failure>", and stop changing things.

## 5. Back up and push
If questions.db changed: `TZ=Australia/Sydney python3 tools/db_backup.py split` (owner 23 Nov: "Lets split the db backup as well": the
xz reached 2.93 MB against the Drive connector's ~3.1 MB upload limit), then upload each file it lists to the Drive folder "HSC Advanced
Question Bank" with `base64Content` = the printed `sha256:<hash>:<absolute path>`, `contentMimeType` application/octet-stream (text/plain for
the SHA256SUMS file), `disableConversionToGoogleType` true. Then rename the previous set (and any older questions.db.xz / .zip)
"<name> (superseded <date>, safe to delete)" (never trash). Commit anything left and
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
