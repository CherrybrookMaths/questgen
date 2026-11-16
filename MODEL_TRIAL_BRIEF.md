# Model trial brief: which Claude model should do which import step?

Written 16 Nov for a fresh Claude Code session with this repo attached. Run it start to finish without asking the owner
anything, unless a STOP rule below says to stop. The owner is Steve (see CLAUDE.md "The owner"; follow his reply rules:
flaws first, [Certain]/[Likely]/[Guessing], no filler praise).

## Goal
Measure, on papers the owner has already approved, how well **Claude Opus 5.5**, **Claude Sonnet 5.5** and **Claude Haiku 5.5**
do three import steps through the **Anthropic API**, and what each costs. The answers feed the open "API decision"
(CLAUDE.md "Open items") and the import-cost question. This is a measurement only.

## Hard rules (read before anything else)
1. **Write nothing to the bank.** Work on a COPY of questions.db (`work/model_trial/trial.db`), never `$QG_DB` itself. No
   publish of the review page, no page-database writes, no Drive writes. Imports stay paused (CLAUDE.md standing rule).
2. **Anthropic only.** Exam pages go to the Anthropic API and nowhere else (no other AI provider; the bank is private).
3. **Budget: stop at US$25 of API spend**, counted from each response's `usage` with the prices below. The owner sets a hard
   US$30 limit in the API console as a backstop.
4. **Read-only Drive**: download the two PDFs below with the Google Drive connector (`download_file_content`), nothing else.
5. Commit only your own files on a branch `model-trial` and push that branch (pushing is allowed). Never touch `main`.

## STOP rules (stop and report to the owner in one short message)
- `ANTHROPIC_API_KEY` is not set, or a free `GET /v1/models` call with it fails: tell the owner the key is missing or
  wrong and that it goes in the environment settings (cloud environment menu in the title bar, then Edit), under Network
  secrets or as an environment variable named `ANTHROPIC_API_KEY`, then a new session. Never ask for the key in chat.
- Spend reaches US$25.
- A model returns a `refusal` stop reason twice in a row on the same step (report which model and step).

## Setup (about 10 minutes)
1. Follow CLAUDE.md "Fresh session: start here" steps 0, 1, 2 and 4 only (time zone, npm ci, pip, restore the database).
   Do NOT fetch the image packs or run prepublish: not needed here.
2. `pip install anthropic` (the official Python SDK). Read the `claude-api` skill before writing any API code; use only
   the exact model IDs `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`.
3. Check the key: list models (free). Apply the STOP rule if it fails.
4. `mkdir -p work/model_trial && cp "$(python3 tools/paths.py | awk '/^DB/{print $2}')" work/model_trial/trial.db`
5. Download the two papers (read-only) into `work/model_trial/pdf/<doc id>.pdf`:

| Doc id | Paper | Drive file id | Why |
|---|---|---|---|
| 296 | 2023 NESA HSC Mathematics Advanced | `19I4TYlMnqnaQIs60-hucLrwVnQzaux3p` | Public, typeset, 32 questions, 17 figures |
| 1356 | Baulkham Hills 2025 Advanced Trial, with solutions | `1MVI707eHOuNMC0BhSr_QqfVjzJqtGLUD` | School trial, 33 questions, 20 figures, worked solutions in the file |

Both are fully approved in Review, so the database holds the owner's approved version of every question: that is the
answer key. Read it from `trial.db`: `questions` (number, question_type, stem_latex, marks_total, options_table_json),
`parts` (label, parent_part_id, latex, marks), `tags` (part_id, code = dot point id, is_primary), `solutions`
(part_id, latex, source).

## The three steps to test (same input and instructions for every model)
Send the PDF itself as a `document` content block (base64, `application/pdf`): this tests the API path a real import
would use. Use `output_config.effort: "high"` for every model (set it explicitly; defaults differ), adaptive thinking
(omit the `thinking` parameter on these models), streaming with `get_final_message()`, and structured output
(`output_config.format` with a JSON schema) so answers parse without guessing. Cache the long spec text
(`cache_control` on the system prompt) so the repeated instructions cost less.

**Step A: Parse** (the hardest and most expensive step). System prompt: the full text of PARSE_SPEC.md. User: the PDF
and "Parse every question of this paper as PARSE_SPEC describes." Schema: list of questions {number, type ("mcq"|"written"),
stem_latex, marks_total, options [{label, latex}], parts [{label, parent_label, latex, marks}]}. Run it on both papers with
all three models: 6 calls.

**Step B: Tag.** For each leaf part of paper 296 (from the APPROVED text in trial.db, not a model's parse, so tagging is
tested alone): system prompt = TAG_SPEC.md plus the dot-point list (`site/data/dotpoints.json`: id, text). User: the
question text and the part. Schema: {primary: dot point id, also: [ids]}. Batch all parts of one question in one call.
All three models.

**Step C: Solutions.** Pick 12 written parts of paper 1356 that have an approved solution, spread over the paper (every
third written leaf part, by question order). Give each model the approved part text (no solution) with SOLUTION_SPEC.md as
the system prompt. Schema: {solution_latex, final_answer}. All three models.

Not tested here: diagram redraws and verification (redraws need a TeX install and a judge of drawings; do them in a
second trial only if the owner asks after reading this one).

## Scoring (write it as `tools/model_trial.py`, deterministic; keep the raw outputs)
- **Parse**: match each parsed question to the approved one by number.
  - found / missing / extra questions;
  - marks: exact match per question and per part;
  - parts: same labels;
  - text: similarity of stem+parts LaTeX after removing whitespace and `\,` style spacing (difflib ratio), reported as the
    median and the share of questions at 0.95 or above;
  - MCQ: same four options.
- **Tag**: share of leaf parts whose primary dot point equals the approved primary (`tags.is_primary = 1`), and share in
  the same subheading (the dot point's `sub` in dotpoints.json).
- **Solutions**: final answer correct? Judge each of the 36 answers against the approved solution with ONE call per answer
  to `claude-opus-5-5` at effort "low", schema {same_final_answer: bool, reason}. The judge's cost counts toward the budget.
- **Cost and time**: tokens in/out (and cache reads) per call from `usage`, dollars with the prices below, seconds per call.
  Report per paper and per step, and a projection per average paper (both papers' mean) and for 538 papers, with and
  without the 50% Batch API discount.

Prices per million tokens (Anthropic, cached 2026-11-03; re-check with the claude-api skill):

| Model | Input | Output | Cache read |
|---|---|---|---|
| claude-opus-5-5 | $4.00 | $20.00 | $0.20 |
| claude-sonnet-5-5 | $2.00 | $10.00 | $0.10 |
| claude-haiku-5-5 | $0.10 (prompts under 100K tokens; $0.50 above) | $0.50 ($2.50 above 100K) | check the skill |

## What to hand back
1. `MODEL_TRIAL_RESULTS.md` on the `model-trial` branch, pushed: one table per step (model × score), the cost table, the
   538-paper projection, and 3–5 concrete examples of each model's typical mistakes (question number, what it got wrong).
2. A recommendation in plain words: which model for which step, and the expected cost per paper for that mix. Mark every
   claim [Certain] (measured here), [Likely] or [Guessing].
3. A short message to the owner: the recommendation, total spent, and the link to the results file on GitHub.

## Done when
All 3 steps ran for all 3 models (or a STOP rule fired and was reported), the results file is pushed on `model-trial`, and
the owner has the message. Nothing in the bank, the page or Drive changed.
