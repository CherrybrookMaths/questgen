# Checker flag sweep (hourly, owner 17 Nov)

Owner, 17 Nov: "no he can check it live after flagging a bit" (the checker flags in Review and checks the fix on the live page
a little later; he does not use GitHub). Run on request (owner 17 Nov: "just fix it and put it back in the review list, drop the
sweep": no scheduled task).
Follow CLAUDE.md's standing rules exactly. Stamp times with `TZ=Australia/Sydney date -Iminutes`.

## Scheduled check (owner 19 Nov)
Owner 19 Nov: "I need a way for the reviewer to run flags, he couldn't do it all of his last shift" -> "Button + checks in shift",
"monday, tuesday, wednesday, friday 9-5 all those days". The checker presses "Fix my flags now" on Review, which writes
`runs/flags_<ms>` {kind: 'flags', status: 'requested', by, at}. The scheduled task "Questgen flag check" (trig_01J5E9pn3VHBVu8zf2wFg5Jh, fresh session,
hourly 9:00-16:00 Sydney, Mon Tue Wed Fri; since 24 Nov every 15 minutes (owner: "Lets make it a 15 minute thing, it sends flags every 15"):
three copies "Questgen flag check (:19)", "(:34)", "(:49)" beside the original at :04, because one task may not fire more than hourly; when the schedule changes, update page db progress/night
flagcheck, which Review's "Fix my flags now" line shows) runs this section; the night run (NIGHT.md step 1) clears any request still waiting.
1. **Cheap check first, before any setup.** ArtifactData `query` on `runs` (where `kind == 'flags'`), on the review page. No doc with
   `status: 'requested'`: stop here (no repo, no database, no reply beyond "No flag request."). A doc with `status: 'running'`
   whose `started` is under 2 hours old: another session has it; stop.
2. Set every requested flags run to `status: 'running'`, `started: <now>` (pinned with `if_version`). Then the repo and setup:
   NIGHT.md step 0.1 (attach and clone the repo if missing; CLAUDE.md "Fresh session: start here" 0-5 and 7, image packs included).
   Write `progress/jobs` {jobs: [{name: "Flag fixes", started}]}.
3. Steps 1-5 below. If step 1 finds nothing open: no publish.
4. Each run doc: `status: 'done'`, `done_at: <now>`, `result: "<n> fixed, <m> wait for Steve"` (or "Nothing open", or
   "Not published: <first failure>" with `status: 'failed'`). Clear `progress/jobs`. Never leave a run `running`.

## Instant runs (23 Nov)
Owner 23 Nov: "I need the checker approving fixed tonight. That is priority number 1" -> "get a way for claude to instantly run flags
when checker needs them done". "Fix my flags now" (page_src/js/08_review.js FLR.ask) still writes `runs/flags_<ms>`, and, when the page's
comments capability says a Claude session can take it (`canSendToClaude` = "available"), first posts a comment on the page and sends it
to Claude: "Fix my flags now: N flags in M questions waiting (request runs/flags_<ms>). ..."; the runs doc then has `instant: true`.
That wakes every Claude session watching the review page at once. The standing session "Questgen flag watcher" watches it for this
(ArtifactComments watch; a watch survives restarts). On a comment that starts "Fix my flags now":
1. Reply in that thread "On it." (ArtifactComments reply), then run "Scheduled check" above from step 1 (the claim in step 2 stops a
   second session from doing the same run; a session that finds the run already `running` replies nothing and stops).
2. When the run ends, reply with the result line (the version published and what came back for approval) and resolve the thread.
Any other comment sent to Claude is not for the watcher: leave it for the owner's session (no reply). With no watching session,
the button falls back to the hourly shift check and the night run, as before.

## Concurrent with imports (23 Nov)
Owner 23 Nov (verbatim): "we cannot be pinned down by imports. We should be able to run flags concurrently with imports".
- A flag fix never waits for an import. The import's papers stay off the published page while they are mid-import
  (tools/import_hold.py, state/work/import/hold.json; owner 18 Nov: imports "shouldn't stall flagging and checking"), so a flag fix can
  build, test and publish while an import runs.
- Work in a separate git worktree (`git worktree add ../qg-flags -b flags-<date> main`; copy, do not link, the untracked site/data packs:
  the tools write them). Database writes go to the shared questions.db (copy it to archive/ first; on "database is locked" wait a few
  seconds and retry; never delete or move the import's rows).
- Before publishing: `fetch_published.py --verify` (batch_check blocks when another session published since this checkout synced);
  prepublish exits 0. If the Artifact tool refuses because a newer version is live (the import published first), merge main into the
  branch, rebuild, re-run prepublish and publish again.
- After the publish: merge the branch into main without touching the running import's uncommitted files (commit through the branch and
  push it to main after merging origin/main), check the commit's version is the live one, push main and the session branch.
- Only another FLAG-FIX job stops a flag fix (step 1 below); a running import in `progress/jobs` does not. The page's "Fix my flags now"
  toast shows the database's error code when the request cannot be written (23 Nov: the checker reported the button "not working").

1. **Anything to do?** ArtifactData `query` on `reviews` (where `at >= <yesterday>`, limit 1000, `out_dir` work/pagedb_flags_<date>/).
   Open items = a doc with `status: 'flagged'` and no `fixed`, or a `fig` value `'changes'`. None: stop here (no publish, no note).
   If another FLAG-FIX job is running (a `runs/flags_*` doc with `status: 'running'` and `started` under 2 hours old), stop and say so;
   an import job in `progress/jobs` never blocks a flag fix (see "Concurrent with imports").
2. **Fix each open item**, as on 17 Nov (UI_SPEC "Flags hold back the paper"):
   - Diagram change request: one Opus agent edits the existing `state/tikz/tex/<id>.tex` to do exactly what the request says (DIAGRAM_SPEC),
     renders, writes `tikz/result_<date>_flags<n>.json`; `python3 tools/apply_diagrams.py` on it; once the edited sources are committed,
     `python3 tools/redraw_before.py --auto <ids>` renders the version the checker reviewed for Review's "Before" picture (owner 18 Nov:
     the middle box said "Not kept" for that morning's fixes because this step was missing); when work-in-progress commits hold half-done edits, pass `<id>=<last publish commit>` instead of `--auto` (18 Nov:
     --auto picked a WIP commit and would have shown a half-fixed "Before") (and `asset_upload_plan.py` / upload /
     `asset_manifest.py` for changed svg packs, as in the publish procedure; after that publish, delete each "superseded: <id>" blob it printed).
   - Text or solution flag: edit the database (copy questions.db into archive/ first). Mistakes in the paper are fixed (PARSE_SPEC
     "Mistakes in the paper are fixed"); record the change in the solution meta (`edited_from_original` / `overwritten_from_source`).
   - A flag that needs the owner's judgement (it would undo a recorded ruling, or the request is unclear): do not guess. Leave it
     flagged and write `fixed: {note: 'Claude <time>: needs the owner: <why>'}` so the checker sees why it is still open.
3. **Publish** (CLAUDE.md "Publish procedure"): build_bank, bank_split, prepublish (0 blockers), publish_set, publish, mark-published, push.
4. **Hand back** (only after the publish is live): for each fixed diagram, delete its `fig` entry and add `fig_done[<id>] = "<request> -> Claude <time>: <what changed>"`;
   for each fixed text flag keep `status: 'flagged'` and add `fixed: {note: 'Claude <time>: <what changed>. Approve if right.', at}`.
   ArtifactData `batch`, each write pinned with `if_version` from the export (re-read and redo a write that hits a newer version: the checker may be working).
5. Commit and push. Reply in 3 lines: what was fixed, what waits on the owner, the version published.

## Flags that answer a Your call (24 Nov)
The checker's flags of 24 Nov fixed four questions that were open Your calls (2021 North Sydney Boys AT4 Q13(b) reworded, 2021 Oakhill AT1
Q4 and 2021 PEM AT4 Q10 option B changed so one option is correct, 2021 Sydney Girls AT4 Q13(d) retired). Owner 24 Nov: "keep his fixes";
the four calls are closed (site/project/open_decisions.json). Owner 24 Nov, on the open Your calls: "3. is for the reviewer": the checker decides Your calls; a flag of his that answers one closes it
(as "Trust his call on the gosford paper" did for 2020 Gosford AT4 Q30), and Claude closes the call when the fix goes live.
