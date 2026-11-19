# Checker flag sweep (hourly, owner 17 Nov)

Owner, 17 Nov: "no he can check it live after flagging a bit" (the checker flags in Review and checks the fix on the live page
a little later; he does not use GitHub). Run on request (owner 17 Nov: "just fix it and put it back in the review list, drop the
sweep": no scheduled task).
Follow CLAUDE.md's standing rules exactly. Stamp times with `TZ=Australia/Sydney date -Iminutes`.

## Scheduled check (owner 19 Nov)
Owner 19 Nov: "I need a way for the reviewer to run flags, he couldn't do it all of his last shift" -> "Button + checks in shift",
"monday, tuesday, wednesday, friday 9-5 all those days". The checker presses "Fix my flags now" on Review, which writes
`runs/flags_<ms>` {kind: 'flags', status: 'requested', by, at}. The scheduled task "Questgen flag check" (trig_01J5E9pn3VHBVu8zf2wFg5Jh, fresh session,
hourly 9:00-16:00 Sydney, Mon Tue Wed Fri; 30 minutes is under the platform's 1-hour minimum) runs this section; the night run (NIGHT.md step 1) clears any request still waiting.
1. **Cheap check first, before any setup.** ArtifactData `query` on `runs` (where `kind == 'flags'`), on the review page. No doc with
   `status: 'requested'`: stop here (no repo, no database, no reply beyond "No flag request."). A doc with `status: 'running'`
   whose `started` is under 2 hours old: another session has it; stop.
2. Set every requested flags run to `status: 'running'`, `started: <now>` (pinned with `if_version`). Then the repo and setup:
   NIGHT.md step 0.1 (attach and clone the repo if missing; CLAUDE.md "Fresh session: start here" 0-5 and 7, image packs included).
   Write `progress/jobs` {jobs: [{name: "Flag fixes", started}]}.
3. Steps 1-5 below. If step 1 finds nothing open: no publish.
4. Each run doc: `status: 'done'`, `done_at: <now>`, `result: "<n> fixed, <m> wait for Steve"` (or "Nothing open", or
   "Not published: <first failure>" with `status: 'failed'`). Clear `progress/jobs`. Never leave a run `running`.

1. **Anything to do?** ArtifactData `query` on `reviews` (where `at >= <yesterday>`, limit 1000, `out_dir` work/pagedb_flags_<date>/).
   Open items = a doc with `status: 'flagged'` and no `fixed`, or a `fig` value `'changes'`. None: stop here (no publish, no note).
   If `progress/jobs` shows a running job from another session, stop and say so.
2. **Fix each open item**, as on 17 Nov (UI_SPEC "Flags hold back the paper"):
   - Diagram change request: one Opus agent edits the existing `state/tikz/tex/<id>.tex` to do exactly what the request says (DIAGRAM_SPEC),
     renders, writes `tikz/result_<date>_flags<n>.json`; `python3 tools/apply_diagrams.py` on it; once the edited sources are committed,
     `python3 tools/redraw_before.py --auto <ids>` renders the version the checker reviewed for Review's "Before" picture (owner 18 Nov:
     the middle box said "Not kept" for that morning's fixes because this step was missing); when work-in-progress commits hold half-done edits, pass `<id>=<last publish commit>` instead of `--auto` (18 Nov:
     --auto picked a WIP commit and would have shown a half-fixed "Before") (and `asset_upload_plan.py` / upload /
     `asset_manifest.py` for changed svg packs, as in the publish procedure).
   - Text or solution flag: edit the database (copy questions.db into archive/ first). Mistakes in the paper are fixed (PARSE_SPEC
     "Mistakes in the paper are fixed"); record the change in the solution meta (`edited_from_original` / `overwritten_from_source`).
   - A flag that needs the owner's judgement (it would undo a recorded ruling, or the request is unclear): do not guess. Leave it
     flagged and write `fixed: {note: 'Claude <time>: needs the owner: <why>'}` so the checker sees why it is still open.
3. **Publish** (CLAUDE.md "Publish procedure"): build_bank, bank_split, prepublish (0 blockers), publish_set, publish, mark-published, push.
4. **Hand back** (only after the publish is live): for each fixed diagram, delete its `fig` entry and add `fig_done[<id>] = "<request> -> Claude <time>: <what changed>"`;
   for each fixed text flag keep `status: 'flagged'` and add `fixed: {note: 'Claude <time>: <what changed>. Approve if right.', at}`.
   ArtifactData `batch`, each write pinned with `if_version` from the export (re-read and redo a write that hits a newer version: the checker may be working).
5. Commit and push. Reply in 3 lines: what was fixed, what waits on the owner, the version published.
