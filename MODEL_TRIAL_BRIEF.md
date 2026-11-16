# Model trial: scoring brief (for a session with this repo)

Owner 16 Nov: "Do it without the API", then "the test brief is done in a completely different claude session, assume it has
drive access and that's all". So the test itself runs OUTSIDE this repo, and this repo only scores it.

## How the test runs (owner's side, no repo)
- Drive folder **"Model trial 16 Nov"** (id `1KGcTGlSvzv_wTo9LkIkoQzvcmkkt6dJG`, inside "HSC Advanced Question Bank") holds:
  - **"Model trial brief (read first)"**: a Google Doc, the brief for a Drive-only Claude session;
  - **questgen_model_trial_pack.json** (id `1ZomC6r-DSTrJsRIIkyHhdq8iQjsqDLGb`): PARSE_SPEC, TAG_SPEC and SOLUTION_SPEC text,
    the dot points, the two papers' Drive ids, 48 parts of paper 296 to tag, 12 parts of paper 1356 to solve (approved text,
    no tags or solutions: the answer key is NOT in the pack, so the test is blind). Part ids are kept in
    state/work/model_trial_inputs_1116.json.
- The owner runs that brief three times, in three new sessions set to Opus, Sonnet and Haiku, starting each with e.g.
  "Model: sonnet. Read the doc 'Model trial brief (read first)' in my Drive folder 'Model trial 16 Nov' and do it", ideally
  attaching the two exam PDFs.
- Each run writes into the folder: `<model>_parse_296.json`, `<model>_parse_1356.json`, `<model>_tag_296.json`,
  `<model>_solutions_1356.json`, `<model>_notes.txt` (possibly split as `_part1`, `_part2`).
- Papers: 296 = 2023 NESA HSC Mathematics Advanced (Drive `19I4TYlMnqnaQIs60-hucLrwVnQzaux3p`); 1356 = Baulkham Hills 2025
  Advanced Trial with solutions (Drive `1MVI707eHOuNMC0BhSr_QqfVjzJqtGLUD`). Both fully approved in Review: the database
  holds the owner's approved version of every question, which is the answer key.

## Scoring (this repo; when the owner says the outputs are ready)
Read-only on the bank: work on a copy of questions.db (`work/model_trial/trial.db`); no publish, no page-database writes; on
Drive only read the trial folder. Download every output file of the folder into work/model_trial/out/, merge `_partN` files.
Write `tools/model_trial.py` (deterministic, keeps the raw outputs) and score:
- **Parse** (per model, per paper): match each parsed question to the approved one by number:
  - found / missing / extra questions;
  - marks: exact match per question and per part;
  - parts: same labels;
  - text: similarity of stem+parts LaTeX after removing whitespace and `\,` style spacing (difflib ratio): the median and the
    share of questions at 0.95 or above;
  - MCQ: same four options.
  Report each run's `read_as` ("attached" = saw the pages; "drive-text" = text only, an easier test): never compare the two as
  equals.
- **Tag**: share of the 48 parts whose primary dot point equals the approved primary (`tags.is_primary = 1`), and share in
  the same subheading (the dot point's `sub` in site/data/dotpoints.json).
- **Solutions**: for each of the 12 parts per model, is the final answer the same as the approved solution's? Judge with one
  sub-agent (Agent tool, `model` "opus") given the part text, the approved solution and the three answers with the model names
  removed and the order shuffled; it returns {item, same_final_answer, reason}; map back afterwards.
- **Time**: from each run's notes (start and finish per step), marked [Likely] (self-reported). No token counts are
  available from a Drive-only session: say so rather than estimating them.

## What to hand back
1. `MODEL_TRIAL_RESULTS.md` (commit and push on a branch `model-trial`): one table per step (model × score), the times,
   and 3–5 concrete examples of each model's typical mistakes (question number, what it got wrong).
2. A plain recommendation: which model for which step, marked [Certain] (measured) / [Likely] / [Guessing].
3. A two-line message to the owner with the recommendation and the link to the results file on GitHub.
