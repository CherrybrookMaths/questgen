# Checker flag sweep (hourly, owner 17 Nov)

Owner, 17 Nov: "no he can check it live after flagging a bit" (the checker flags in Review and checks the fix on the live page
a little later; he does not use GitHub). A scheduled task runs this in the owner's working session every hour on weekdays.
Follow CLAUDE.md's standing rules exactly. Stamp times with `TZ=Australia/Sydney date -Iminutes`.

1. **Anything to do?** ArtifactData `query` on `reviews` (where `at >= <yesterday>`, limit 1000, `out_dir` work/pagedb_flags_<date>/).
   Open items = a doc with `status: 'flagged'` and no `fixed`, or a `fig` value `'changes'`. None: stop here (no publish, no note).
   If `progress/jobs` shows a running job from another session, stop and say so.
2. **Fix each open item**, as on 17 Nov (UI_SPEC "Flags hold back the paper"):
   - Diagram change request: one Opus agent edits the existing `state/tikz/tex/<id>.tex` to do exactly what the request says (DIAGRAM_SPEC),
     renders, writes `tikz/result_<date>_flags<n>.json`; `python3 tools/apply_diagrams.py` on it (and `asset_upload_plan.py` / upload /
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
