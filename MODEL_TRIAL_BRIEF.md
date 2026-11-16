# Model trial brief: which Claude model should do which import step?

Written 16 Nov for a fresh Claude Code session with this repo attached. Run it start to finish without asking the owner
anything, unless a STOP rule below says to stop. The owner is Steve (see CLAUDE.md "The owner"; follow his reply rules:
flaws first, [Certain]/[Likely]/[Guessing], no filler praise).

Owner 16 Nov: "Do it without the API, change the brief to do it with the session model." No API key, no API calls: every
model runs as a sub-agent of this session (the Agent tool's `model` option: "opus", "sonnet", "haiku"), the way imports
already run (IMPORT_PLAYBOOK "The pipeline": "one agent per paper").

## Goal
Measure, on papers the owner has already approved, how well **Opus**, **Sonnet** and **Haiku** do three import steps as
sub-agents, and how many tokens and minutes each uses. The answers feed the open "API decision" and the import-cost
question (CLAUDE.md "Open items"). This is a measurement only.

## Hard rules (read before anything else)
1. **Write nothing to the bank.** Work on a COPY of questions.db (`work/model_trial/trial.db`), never `$QG_DB` itself. No
   publish of the review page, no page-database writes, no Drive writes. Imports stay paused (CLAUDE.md standing rule).
2. **No API, no other provider.** Do not call the Anthropic API or any other AI service; sub-agents only.
3. **Usage cap: stop at 8 million sub-agent tokens in total** (each sub-agent's completion notice gives its token count;
   keep a running total in `work/model_trial/usage.json`). The trial uses the owner's plan allowance.
4. **Read-only Drive**: download the two PDFs below with the Google Drive connector (`download_file_content`), nothing else.
5. Commit only your own files on a branch `model-trial` and push that branch (pushing is allowed). Never touch `main`.
6. Sub-agents get exactly the brief written for them below, with file paths; they write their answer to a JSON file and
   return only "done" and a one-line summary. They must not read trial.db, the answer key or other agents' outputs.

## STOP rules (stop and report to the owner in one short message)
- The usage cap is reached, or the session hits a usage limit: report what finished and what did not.
- A sub-agent cannot use the model asked for (the Agent tool refuses the `model` value): report which.
- The same step fails twice for the same model (no output file, or output that does not parse): report which.

## Setup (about 10 minutes)
1. Follow CLAUDE.md "Fresh session: start here" steps 0, 1, 2 and 4 only (time zone, npm ci, pip, restore the database).
   Do NOT fetch the image packs or run prepublish: not needed here.
2. `mkdir -p work/model_trial/pdf work/model_trial/out && cp "$(python3 tools/paths.py | awk '/^DB/{print $2}')" work/model_trial/trial.db`
3. Download the two papers (read-only) into `work/model_trial/pdf/<doc id>.pdf`:

| Doc id | Paper | Drive file id | Why |
|---|---|---|---|
| 296 | 2023 NESA HSC Mathematics Advanced | `19I4TYlMnqnaQIs60-hucLrwVnQzaux3p` | Public, typeset, 32 questions, 17 figures |
| 1356 | Baulkham Hills 2025 Advanced Trial, with solutions | `1MVI707eHOuNMC0BhSr_QqfVjzJqtGLUD` | School trial, 33 questions, 20 figures, worked solutions in the file |

Both are fully approved in Review, so the database holds the owner's approved version of every question: that is the
answer key. Read it from `trial.db`: `questions` (number, question_type, stem_latex, marks_total, options_table_json),
`parts` (label, parent_part_id, latex, marks), `tags` (part_id, code = dot point id, is_primary), `solutions`
(part_id, latex, source).

4. Prepare the inputs the sub-agents need (from trial.db, by a small script `tools/model_trial.py prepare`):
   - `work/model_trial/in/tag_296.json`: every leaf part of paper 296 with its question's approved stem and the part's
     approved text (no tags).
   - `work/model_trial/in/sol_1356.json`: 12 written leaf parts of paper 1356 that have an approved solution, spread over
     the paper (every third written leaf part, in question order), with approved text only (no solutions).

## The sub-agents (same instructions for every model; run the three models of one step in parallel)
Start each with the Agent tool: `subagent_type` "general-purpose", `model` "opus" | "sonnet" | "haiku", background. Record
from each completion notice: model, step, paper, `subagent_tokens`, `duration_ms`, `tool_uses` into usage.json.

**Step A: Parse** (the hardest step). 6 agents (3 models × 2 papers). Brief: "Read PARSE_SPEC.md in /home/user/questgen.
Then read the exam paper PDF at work/model_trial/pdf/<doc>.pdf (all pages; use the Read tool's pages parameter, at most 20
pages per call). Parse every question as PARSE_SPEC describes. Write ONE JSON file work/model_trial/out/parse_<model>_<doc>.json:
{questions: [{number, type: "mcq"|"written", stem_latex, marks_total, options: [{label, latex}], parts: [{label,
parent_label, latex, marks}]}]}. Do not read any other file in the repo besides PARSE_SPEC.md and the PDF. Reply 'done'
and the number of questions."

**Step B: Tag.** 3 agents. Brief: "Read TAG_SPEC.md and site/data/dotpoints.json in /home/user/questgen, then
work/model_trial/in/tag_296.json. For every part, choose the primary dot point (id from dotpoints.json) and any secondary
ones as TAG_SPEC describes. Write work/model_trial/out/tag_<model>.json: {parts: [{part_id, primary, also: []}]}. Read no
other file. Reply 'done' and the count."

**Step C: Solutions.** 3 agents. Brief: "Read SOLUTION_SPEC.md in /home/user/questgen, then
work/model_trial/in/sol_1356.json. Write a full worked solution for each part as SOLUTION_SPEC describes, and its final
answer. Write work/model_trial/out/sol_<model>.json: {parts: [{part_id, solution_latex, final_answer}]}. Read no other
file. Reply 'done' and the count."

**Judge** (after step C). 1 agent, `model` "opus". Brief: give it work/model_trial/in/judge.json (prepared by
`tools/model_trial.py judge-input`: for each of the 36 answers, the part text, the approved solution and the model's answer,
with the model's name REMOVED and the order shuffled). It writes work/model_trial/out/judge.json: [{item, same_final_answer:
bool, reason}]. The script maps items back to models.

Not tested here: diagram redraws and verification (redraws need a TeX install and a judge of drawings; do them in a
second trial only if the owner asks after reading this one).

## Scoring (`tools/model_trial.py score`, deterministic; keep every raw output)
- **Parse**: match each parsed question to the approved one by number.
  - found / missing / extra questions;
  - marks: exact match per question and per part;
  - parts: same labels;
  - text: similarity of stem+parts LaTeX after removing whitespace and `\,` style spacing (difflib ratio), reported as the
    median and the share of questions at 0.95 or above;
  - MCQ: same four options.
- **Tag**: share of leaf parts whose primary dot point equals the approved primary (`tags.is_primary = 1`), and share in
  the same subheading (the dot point's `sub` in dotpoints.json).
- **Solutions**: share of final answers the judge marks correct, per model.
- **Usage**: tokens and minutes per agent from usage.json; per paper and per step, a projection per average paper and for
  538 papers. Add an API-equivalent estimate marked [Guessing]: tokens × the model's input price, assuming most tokens are
  input (sub-agent totals do not split input and output). Prices per million tokens: Opus 5.5 $4 in / $20 out, Sonnet 5.5
  $2 / $10, Haiku 5.5 $0.10 / $0.50 (re-check with the claude-api skill).

## What to hand back
1. `MODEL_TRIAL_RESULTS.md` on the `model-trial` branch, pushed: one table per step (model × score), the usage table, the
   538-paper projection, and 3–5 concrete examples of each model's typical mistakes (question number, what it got wrong).
2. A recommendation in plain words: which model for which step, and the expected usage per paper for that mix. Mark every
   claim [Certain] (measured here), [Likely] or [Guessing].
3. A short message to the owner: the recommendation, total tokens used, and the link to the results file on GitHub.

## Done when
All 3 steps ran for all 3 models (or a STOP rule fired and was reported), the results file is pushed on `model-trial`, and
the owner has the message. Nothing in the bank, the page or Drive changed.
