# HSC Advanced Question Bank: how to resume

Owner: Steve Yeung (CMC Education). Last updated 11 Nov 2026 (UI v2, diagram redraws).

## Where things live
- **Review page (the hub):** https://claude.ai/artifact/MSd3GSrwsAqwzmBX8wSC8f
  - Published files: `review.html`, `data/bank.json` (all parsed questions, tags and solutions shown in the tool), `data/dotpoints.json`, `data/img/<doc>.json` (page images and figure crops), `project/*` (everything below).
  - Review decisions are kept in the page's database, collection `reviews` (one doc per question, `q<question_id>`).
- **Pilot report (Claude Doc):** https://claude.ai/artifact/5S6LcYaFK4h8ot2yA4WihH
- **Drive copy:** "HSC Advanced Question Bank" folder in Steve's My Drive, id `1mD-XIPf4vrrtJSFybjsjXgl_ezPq2F8S` (https://drive.google.com/drive/folders/1mD-XIPf4vrrtJSFybjsjXgl_ezPq2F8S): `questions.db.zip` (the database zipped, since 12 Nov), `project_files.zip` (same files as `project/`), `review_page_and_data.zip` (review.html, bank.json, dotpoints.json), `RESUME.md`. Page images and figure crops are NOT in Drive (upload size limit); they are stored in the review page (`data/img/*.json`) and can be re-rendered from the source PDFs. Sync after every major change: upload new copies, then rename the old ones "(superseded <date>, safe to delete)"; never trash.
- **Source PDFs:** Google shared drive "CMC Resources" › Exams › External Exams Stage 6. `stage0_manifest.csv` lists every PDF; `drive_ids.csv` (when present) maps each Year 12 Advanced paper to its Drive file id so it can be fetched with the Drive connector, no PC needed.

## Files in project/
| File | What it is |
| --- | --- |
| `questions.sql` | Full SQLite dump of questions.db (documents, questions, parts, mcq_options, tags, solutions, figures, related_questions, runs). Rebuild: `sqlite3 questions.db < questions.sql` or python `executescript`. |
| `schema.sql` | Table definitions (brief schema + agreed changes) |
| `mapping_v1.csv` | 2017 -> 2024 mapping (v1.1 rows include pilot findings). Every row still unverified against the 2017 PDF. |
| `syllabus_dotpoints.json` | 359 dot points extracted from the 2024 syllabus, ids Y11-001 … Y12-359. Tags must quote these verbatim. |
| `PARSE_SPEC.md`, `TAG_SPEC.md` | Instructions given to the parse and tag agents (prompt versions parse-v1, tag-v1) |
| `parse_outputs.json`, `tag_and_gen_outputs.json` | Raw agent outputs for the 16 pilot documents, tagging passes and generated solutions |
| `stage0_manifest.csv`, `audit_*.csv` | Inventory of all 1,627 PDFs and the audit of name-based exclusions |
| `classify.py`, `proc.py`, `syllabus.py`, `load.py`, `load_tags.py`, `dedup.py`, `reconcile.py`, `check_latex.js` | Pipeline scripts. Paths inside assume `/home/claude/pilot/`; adjust when rebuilding. |

## Resume in a new Claude session
0. Read `IMPORT_PLAYBOOK.md` and `UI_SPEC.md` first (pipeline order + every mistake made so far); run `python3 tools/batch_check.py` before any publish.
1. Give Claude the review page link and say "resume the HSC question bank". Claude reads `project/RESUME.md` and `project/questions.sql` from the artifact (Artifact tool, `read` with `path`) and rebuilds the database.
2. Pull review decisions: ArtifactData `list` on collection `reviews`, then `reconcile.py` applies them.
3. To add papers: pick rows from `stage0_manifest.csv` (status discovered), fetch each PDF by Drive id, parse with PARSE_SPEC (one agent per paper), load, tag with TAG_SPEC, dedup, then rebuild `data/bank.json` + `data/img/*.json` and republish the review page to the same link.
4. After any change, republish `project/questions.sql` and copy to Drive so the hub stays current.

## Decisions so far
- Area between two curves: examinable (tagged Y12-279).
- Old 2 Unit papers (pre-2020 King's): excluded for now.
- MA-C2.2 is a split (Y12 "Using derivatives" vs Y11 "Calculations with the derivative").
- Review write-back: the review page's database.
- Model calls run in-session (cost is estimated from agent token totals).

## Self-audit (11 Nov 2026)
80 questions (40 scan, 40 digital, stratified by paper) checked against page images by an independent agent (AUDIT_SPEC.md): 78 ok, 2 minor, 0 major. A seeded test (10 deliberate errors hidden among 20 questions) was caught 10/10 with 0 false alarms. 95% upper bound on the major-error rate: about 4.5%. Results: audit_results.json; review page queue "Self-audited".

## UI v2 + diagram redraw (11 Nov 2026, overnight)
- Page now has three views: **Papers** (`#papers`: every exam ingested, questions / marks / approved per paper; a paper filed as two PDFs is one row), **Bank** (`#bank`: topics → subheadings → question cards, search, removed content, "No questions yet" for empty subheadings) and **Review** (`#review`: filter chips, side-by-side source page, keys J/K/A/F/D).
- Review decisions doc `reviews/q<id>` now also holds `fig` {figure_key: approved|rejected} and `sol` {solution_id: approved|rejected}. Bank shows a TikZ redraw only once approved, and a generated solution only once approved. `reconcile.py` applies both.
- Diagrams: 180 figures (152 question + 28 solution) redrawn in TikZ house style (`examstyle.tex`, DIAGRAM_SPEC.md): 148 ok, 26 approx, 4 tables, 2 photos kept as crops. Independent check (CHECK_SPEC.md): 7 fixed, 1 concern. Sources: `tikz_sources.zip`; SVGs in `data/svg/<doc>.json`; results `diagram_results.json`, `diagram_checks.json`.
- Tables: LaTeX arrays converted to `data_tables` (`\extable{id}` in text), rendered as HTML with a separate label column and equal-width value columns (`tables.py`, `ui_v2_data.py`). MCQ answer tables: `questions.options_table_json`.
- Marking criteria parsed to `solutions.criteria_json` (rubric rows) and `solutions.meta_json` (confidence, self-check, concern, reused_from, marker_note).
- Rebuild the page data: `python3 build_bank.py`. Do NOT re-run `ui_v2_data.py`: it re-parses every marks_breakdown and would overwrite reviewed criteria and solution notes (found 11 Nov at import). New papers: `add_to_bank.py <doc ids>` then `build_bank.py`.

## Diagram rules
New or revised diagrams follow `DIAGRAM_SPEC.md` (rules grouped by topic, numbers 1–27 kept). Every owner correction is logged in `DIAGRAM_FEEDBACK_LOG.md`: when a Review note leads to a change, add a row there and, if it is a general lesson, a rule in the spec under its topic. Agents read only the spec, never the log (owner 12 Nov, bloat cleanup).

Tagging follows `TAG_SPEC.md` (one file since 12 Nov; v1 and v2 are in archive/specs/). Tag disagreements (tagger vs checker, 169 parts in work/tag_full/disagreements.json) are settled in Review step 5 Tags: reviews/q<id>.tagres = {partId: 'A' | 'B' | {note}}; apply 'A' choices and notes back into the DB with a small script before the next bank build.

Stale specs and one-off files live in `archive/` (not published): AUDIT/CHECK/MCQ/NOTES_FIX/OVERLAY_FIX/REVISE specs, ui_v2_data.py, questions.sql, audit_* files.

## Multiple-choice layout
Every MCQ has one `options_layout` (text / table / graph); see `MCQ_SPEC.md`. New papers: set it when parsing.

## What the owner checks (11 Nov)
Steve reviews **questions and solutions only, not syllabus tags**. Approving a question means stem, parts, options and solutions are right; tags stay model-assigned (`tag_source='model'`) and are unverified unless a tag was changed in review. In Review, tags are folded away. If tags ever need checking, that is a separate pass.

## Decisions waiting for the owner
Review queue **Needs your decision** = questions with an entry in `open_decisions.json` (answer-key doubts, flags without a note, shown as a callout at the top), a `source_flag` on a solution (possible error in the source marking guideline), or status `flagged`. When Steve decides, apply it and remove the entry.

## House style
After loading or editing papers run `house_style.py` (fractions, multiplication dots, paragraph breaks) `para_detect.py` (lost paragraph breaks vs page images) and `coverage_check.py` (every MCQ and part has working; must report 0). house_style also converts $A\hat{B}C$ to $\angle ABC$. Product/quotient-rule solutions use the u/v grid (`uv_grid.py`). Tables: `rowspan` for merged header cells, `\\` for line breaks where the paper wraps, never shade empty cells, answer-table key shown as a badge (never bold). No transcription notes in question text (PARSE_SPEC). Judgement rules are in `SOLUTION_SPEC.md`, `MCQ_SPEC.md`, `DIAGRAM_SPEC.md`; every owner correction is in `DIAGRAM_FEEDBACK_LOG.md`.

## Open
Human spot-check of ~20 audited questions to confirm the self-audit (it shares the parser's model, so shared blind spots are possible); real pricing or API key; verify mapping against 2017 PDF; solution-generation scope; old 2U papers; copyright advice before any sharing.

## Full Year 12 Advanced import (started 11 Nov, owner: "run the rest of the papers as well")
- All 169 remaining papers' PDFs are staged (no PC needed): `work/import/papers.json` lists id, separate solutions doc id, label, scan, has_sol; PDFs at `src/<id>.pdf`.
- Parse: workflow script `parse-batch` (args = slice of papers.json, 9 per batch). Batch 1 (8 papers: 2024–2026 HSC + five 2025 trials) parsed and loaded; batch 2 = papers.json[0:9] parsing.
- After parse, per batch: `load.py <ids> [--force for never-loaded]` → `house_style.py` → `tables.py` → `dedup.py <ids>` → tag (TAG_SPEC, tag/in_<g>.json, `load_tags_batch.py`) → solution formatting (SOL_FMT_TASK) → missing solutions → TikZ redraws (DIAGRAM_SPEC, tikz/group_<g>.json) → `add_to_bank.py <ids>` → `build_bank.py` → publish.

## Triage and the four-step review (12 Nov, owner: "I don't have time to check 6000 questions")
- Per batch after the text stage: `prep_verify.py <b> <ids>` → workflow `batch-verify` {batch, groups} (VERIFY_SPEC.md) → `node tools/render_audit.js > work/verify/render.json` (needs `python3 -m http.server 8765` in site/ and MathJax 4.1.3 in /tmp/claude-0/mj via npm) → `triage.py` → `build_bank.py` (attaches q.tri) → publish.
- Review page: 1 Decide · 2 Check · 3 Spot-check (clean sample → reviews/paper_<doc> approves the paper's cleared questions) · 4 Diagrams grid. figDec/solDec fall back to q.tri.ok_figs / ok_sols.
- Running-jobs bar (owner 12 Nov): whenever a background workflow starts or finishes, update db doc progress/jobs ({jobs:[{name,detail,affects,started}]}) with ArtifactData; affects = the review step it changes ('diagrams', 'decide', 'check', 'sample', 'tags' or ''). Clear finished jobs.
- Diagram flag hand-off (owner 12 Nov): the Diagrams step shows "N flags waiting for Claude"; it turns amber at 15. When Steve says "check my diagram flags": pull reviews, redraw every fig marked 'changes' from its note, add any new rule to DIAGRAM_SPEC/feedback log, sweep the matching diagram type for that rule, then clear the flags (delete fig[k], set fig_done[k]) so the counter resets.
- Source errors (owner 12 Nov: "if you are certain the source is wrong and your maths is right, just overwrite it"): when independent working + a numerical check agree the source solution/key is wrong, overwrite it and set meta "overwritten_from_source" (one line: what it was, what it is now); no owner decision. Only genuine judgement calls (flawed/ambiguous questions, criteria wording, syllabus) go to Decide.
- Missing marking criteria (owner 12 Nov: "If source is missing one marking criteria row, infer from other questions in the bank of similar type what it should be"; extended to whole rubrics: "yeah do that"): fill missing/cut-off/inconsistent rows, or the whole rubric when the source has none, from 3-6 similar questions (same skill and marks), keep every source row word for word, note meta "criteria_inferred". Not a Decide item.
- Flawed or ambiguous source questions (owner 12 Nov: "fix it"): make the smallest edit so the question has one clear answer, following the setter's evident intent (the guideline's answer where consistent); set meta "edited_from_original" so the owner approves it in Check. Not a Decide item.

**12 Nov pm (tags settled).** Every question has ONE home topic: `questions.home_topic` ("sub:<year>|<focus area>|<subheading>"), `home_source` = computed | owner:<pick> | owner-parts. Computed in the review page (qHome: most marks across the parts' main dot points, tie -> later part, owner pick wins) and exported with Playwright. Gates for the 144 disputed parts settled with quoted evidence (work/gates). Review > Tags is empty. Guide tab on the page explains the tagging model with live examples. Pending: product/quotient/chain-rule rule (proposed), "hence" rule (owner unsure), the 4 tagger gaps, pilot questions not re-tagged.

**12 Nov night.** Rule-fix re-tag (244 parts, work/retag3) and pilot re-tag (554 parts, work/tag_pilot, tools/merge_tags_pilot.py; gates work/gates_pilot) applied. Every part is now on tag-v2.x. build_bank reads both disagreement files and both gate files. 18 pilot questions wait in Review > Tags. First new-syllabus HSC is 2027 (owner), so all papers are old-syllabus. Pending owner calls: standalone limits (keep under Y11-122 or remove), borderline 3D parts (proposed: 863(c), 525(c) back in course), 8 spec gaps from the pilot taggers (area between curves mapping, T_n from S_n, bouncing ball overlap, transformed trig equations year, CDF vs variable-limit skill, hence-or-otherwise integrals, univariate statistics, mode of discrete distribution).

## 12 Nov — Check queue auto-clear (owner: "yeah")
- tools/check_tables.py: every table number must appear in the PDF text on the question's pages, and most of its words. Results are in work/checkpass/tables.json.
- An agent pass checked wording and solutions on 52 questions. 43 came back ok, and caveated oks were held. Results are in work/checkpass/agent.json.
- 95 questions were approved with auto_clear:true and the note "Auto-cleared by Claude 12 Nov". 74 questions stay in Check.
- Agent issues for the owner:
  - 1020: intercepts missing in the solution.
  - 1272: the answer gives maximum velocity, but the question asks for maximum speed.
  - 1384: page mismatch, and "sea" should be "tea".
  - 1504: k ≠ -1 is ignored.
  - 1678: the function can't be verified.
- 1033: f(3) was deliberately corrected from the paper's -20.0537 to -20.0357. It stays in Check for the owner.

## 12 Nov — 9 "pending" questions (Knox AT2 x6, Normanhurst AT4 x3)
- Cause: the diagram redraws in tikz/result_b5_5.json (and 2 in b5_4) were never merged into all_results.json. Batch 5 was the last import batch before import was paused. Triage marks any question with an unmerged diagram as 'pending', and no queue shows pending questions.
- Fix: merged them with apply_diagrams.py (result_b5_missed.json). 373_q28_1 went through result_fixb5_q28.json; it was re-cropped by 6 px, and the owner will review it.
- Re-ran triage. Samples are now locked (work/sample_locked.json), so new questions never reshuffle a sample the owner already reviewed.
- Carried the owner's approvals over to 6 solution sketches that had moved between questions (1392, 1393, 1395, 1398, 1425).
- Still to do: progress.py / prep_batch should alert when a result_*.json has ids missing from all_results.json.

## 13 Nov — difficulty pilot and exam builder
- **Difficulty.** NESA's 2020–2025 mapping grids have no targeted-performance-band column, so there are no official bands. The pilot rated the 182 Sequences and series parts against 34 HSC anchor parts whose bands Claude judged (work/difficulty/pilot_report.md; ratings in pilot_ratings.json, with nearest_anchor kept so they can be re-rated). The owner must approve the anchor table before the full run. The full run adds fluency/problem-solving per part. The pilot cost about 0.25M tokens.
- **Exam builder stage 1** is live (see UI_SPEC "Exam builder"). Code: page_src/js/20_exam.js (was site/exam.js.txt). Capabilities are now db, user and downloads.
- **13 Nov night: full difficulty run launched** (workflow difficulty-full, run wf_a4ec6628-5b2). It covers 2,292 leaf parts: 312 HSC anchors across 14 areas, then 1,985 others in 24 batches, then a merge. It follows DIFFICULTY_SPEC.md (diff-v1). Outputs: work/difficulty/full/anchors_*.json and ratings_*.json, and work/difficulty/ratings_all.json plus full_report.md. Old-syllabus and Standard-course questions (131) were skipped. Nothing goes into the page until the owner has reviewed the anchors.
- **14 Nov early: difficulty run finished.** 2,292/2,292 parts were rated (307 anchors), using about 3.9M tokens in 26 min. The results are loaded into the new DB table `part_difficulty` (diff-v1), but nothing is shown on the page yet. Report: project/difficulty_report.md. The owner reviews anchors first; the thin areas are Exponential & log (3 anchors), Trig identities (3) and Sequences (no band-5 anchor). Flags to check: 2066 (maybe band 4); 1137, 2209, 2547 and 2625 were rated without their figure; 2303, 2817, 1311 and 1587 look like homing errors.

- **14 Nov: integrity.** Page decisions are mirrored into SQLite with `tools/sync_pagedb.py` (`page_*` tables), and integrity triggers are installed with `tools/integrity.py`. See IMPORT_PLAYBOOK "Database integrity". `project/questions.sql` and `schema.sql` were re-dumped.
- **14 Nov: import paused for hardening.** The owner said: "no more importing for a while until we iron these out." Running now, in order:
  1. Done: the page is split into page_src/ modules (src/ holds the exam PDFs) and built by tools/build_page.py. **Edit page_src/, then run `python3 tools/build_page.py`; never edit site/review.html directly.** Then `python3 tools/export_src.py` (copies page_src/ to site/project/page_src/ as .txt). The old *.js.txt / *.css.txt files and tools/patch_*.py are in archive/pre_src_1114/. Equivalence proof: HARDENING_NOTES.md.
  2. Done: no public CDNs. MathJax + Termes font data, html-to-image, jsPDF, docx, mathml2omml and the web fonts are in site/vendor/ (155 files, 5.9 MB), listed in tools/vendor_manifest.json (`files` = the publish map). `python3 tools/vendor.py --check` verifies them; build_page.py and batch_check.py run that check. Publish the vendor files with the next review.html publish (once; they stay). Details: HARDENING_NOTES.md.
  3. Done: an automated pre-publish test. **Run `bash tools/prepublish.sh` before every publish**: it builds, exports page_src/, runs `node tools/page_test.js` (headless, offline, about 1 min: every tab at 1280/390 px in light and dark, Bank, exam generate/preview/swap/lock/regenerate/save/rename/delete, PDF/Word/HTML exports, Review and Difficulty writes, reports, the phone menu), then batch_check.py. batch_check blocks a failed, partial or stale test. How to run it and read the results: IMPORT_PLAYBOOK "Pre-publish page test". It found 2 page bugs, now fixed (UI_SPEC "Paper pages never run past A4"). Its last step prints the publish set: `python3 tools/publish_set.py` (changed files incl. project/, counts vs the 255-file / 64 MB limits; `--json` = the `files` map). After a publish run `python3 tools/batch_check.py --mark-published` (it now records project/ too).
  - Workflow wf_cf11c339-6ee; notes go to HARDENING_NOTES.md.
- **14 Nov: queued owner requests** for after the hardening workflow are in QUEUE.md: overlap, figure resize, UF/PS in reports, dot-point line.
