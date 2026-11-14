# Import progress (papers.json order, 9 per parse batch)
Per batch: load.py <ids> --force → post_load.py <ids> → prep_batch.py <b> <ids> → workflows batch-text {batch,tag,solfmt,gen} + batch-diagrams {batch,groups}
→ apply_text.py <b> → apply_diagrams.py tikz/result_<b>_*.json → add_to_bank.py <ids> → build_bank.py → publish review page (files: data/bank.json, data/img/<ids>.json, data/svg/*.json)
Workflow scripts: parse-batch-wf_64c923cf-82a.js, batch-text-wf_008dca19-c7b.js, batch-diagrams-wf_9452a6e2-53b.js (in session workflows/scripts)

- b1 (1628 1630 1632 1374 1369 1356 1370 1363): text applied, published; diagrams running (wpsxfsvww)
- b2 = papers[0:9] (1357 644 1358 1359 1361 1362 1364 1366 1367): loaded; text (wspsyaes2) + diagrams (wq2697d3i) running
- b3 = papers[9:18]: parsing (wr3w3y26v)
- next: b4 = papers[18:27] when b3 parse finishes
- DASHBOARD: after every stage change edit work/import/batches.json (stages/running/issues), run `python3 tools/progress.py "log msg"`, cp site/data/progress.json work/import/progress_doc.json, then ArtifactData set progress/import (file_path, if_version = last version; v2 at 12 Nov 00:10). No republish needed for dashboard-only updates.
- BACKUP: each heartbeat re-run the tar into "/mnt/user-data/outputs/_working state (Claude backup)/import_state.tgz" (persistent; the container's /home/claude can be reclaimed when idle). Restore: tar xzf into /home/claude; PDFs in src/ must be re-staged from the PC (work/import/need.json + papers.json).
- 12 Nov 01:20: per-batch pipeline now also: prep_verify.py <b> <ids> + batch-verify {batch,groups} (after text stage) → render_audit → triage.py → build_bank → publish. b1/b2 verify running; b3 text+diagrams running; b4 parsing.
- TODO: school papers with unrelated parts under one number (Abbotsleigh 163/165/166 etc.) need splitting (PARSE_SPEC "Unrelated parts"); add a split pass before tagging for school (non-trial) papers.
- OWNER PLAN for 12 Nov morning (his words): "we'll begin by verifying diagrams first, then approving the questions. Then we can talk tagging while parsing continues." → open the review page on step 4 Diagrams first; tagging discussion = structure draft D1–D6 (site/structure/structure.html) + re-tag plan.
- Wake-ups: heartbeat 01:34, restart checks 03:00 and 05:00, morning update 07:30 (Sydney).
- 05:00 12 Nov: limit hit ~2am (reset 3:50). Restarted: b2 diag resume, b3 diag resume, b3 text resume (done, applied), b4 parse resume (641, 335), b4 text + diag, split-decide (b1s,b2s,b3,b4 → work/<b>/split_out.json; then `split_batch.py apply <b>`, re-run add_to_bank+triage; for b3/b4 apply BEFORE prep_verify). doc 15 excluded (CSSA Standard 2 trial).
- Render audit: use tools/run_render_audit.sh (starts its own server).
- 05:20: b4 all loaded (641 = 2024 CSSA AT4). b4b text+diag running. New parse batches PAUSED until owner session (protect usage limit). Next: b5 = papers[27:36]
- ~05:50: b2 diag done & applied; b3 verify done; b4 text applied, on page; b4 verify inputs ready (work/b4/verify_in_1..4) — launch batch-verify {batch:b4,groups:4} in morning; b4/b4b diagrams + b3 diag resume still running. Next parse b5=papers[27:36] in morning.
- ~06:10 b4 diagrams done; all idle. Morning: launch b4 verify, b5 parse.
- 07:12 b4 verify + b5 parse (8; Knox 2024 AT1 1589 held: solns 1588 not staged, PC offline)
- 12 Nov owner: tag/solfmt/split on sonnet; diagrams max 2 rounds. (3: crop-only handwritten sketches, 4: API — deferred)
- STOP (owner 12 Nov ~07:18): finish batch 5 (parse → text → diagrams → check → publish), then launch NOTHING further. No b6. Owner wants usage for improving current questions.
- b5 loaded 7 (377 re-parse running, split prep work/b5/split_in.json — run split-decide b5 before verify). Then STOP.
- b5 text applied; split-decide b5 running; then split apply b5 → prep_verify b5 (339 347 351 355 361 1601 373 377) → verify → triage/publish → STOP. Tagging issue: rational functions removed by sonnet tagger vs tagged earlier.
- b5 DONE, import STOPPED 07:57
