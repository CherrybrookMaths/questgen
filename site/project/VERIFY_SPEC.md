# Independent verification spec (verify-v1, 12 Nov 2026)

Owner (12 Nov): "Just build it in, I don't have time to check 6000 questions." You are an independent checker. Someone
else transcribed these questions and extracted or wrote the solutions; assume nothing. Your verdicts decide what the
owner must look at: a wrong "ok" sends an error to students, a needless "problem" wastes the owner's time. Be exact.

## Input (`work/<batch>/verify_in_<g>.json`)
Per question: `question_id`, `paper`, `pdf` + `pages` (0-based), `scan`, `type`, `stem`, `parts`, `options` (with `key`=1 on
the keyed option), `tables` (rows of each `\extable{id}`), `figures` (crops in /home/claude/pilot/figures/),
`solutions` (latex + criteria; `source` extracted = from the school/NESA guideline, generated = written by Claude).

## For every question
1. **Question text vs the paper.** Render the page(s) with pymupdf (`page.get_pixmap(dpi=110)`), Read the PNG and compare
   with the stored text, options, tables and marks: every number, sign, variable, exponent, unit, bound, condition,
   option and table cell. For digital papers you may also diff against `page.get_text()`. Wording differences that
   do not change meaning (line breaks, "the following") are fine. Record `question_ok` true/false and, if false,
   exactly what differs ("(b): paper has $x^2-4$, stored $x^2+4$").
2. **Answer.** Solve the question yourself first, without reading the stored solution (python/sympy/numeric checks
   welcome). Then compare with the stored final answer(s) for every part and the MCQ key. `answer_ok` true/false/null
   (null only when the question cannot be checked, e.g. "explain", a sketch with no checkable feature — then say so).
   If the stored answer differs from yours, re-check both before deciding; give both values in `answer_issue`.
   A stored solution can be right with different-looking form (equivalent expressions, rounding as the question asks).
3. **Working.** Glance at the solution's working: a wrong intermediate line, a wrong criterion, or an answer that
   contradicts its working counts as `answer_ok:false` with the line named.
4. **Diagram sanity** (only if a solution contains `\exfigure`): does the described sketch match the answer? Note
   problems in `answer_issue`.

## Output `work/<batch>/verify_out_<g>.json`, saved every ~5 questions
`{"group":"<batch>_<g>","results":[{"question_id","question_ok":true|false,"question_issue":null|"…",
"answer_ok":true|false|null,"answer_issue":null|"…","my_answers":"short list of your final answers","confidence":0-1}]}`
One result per input question. Keep issues to one or two sentences each, with the exact values.

## Final reply
≤5 lines: counts of question_ok false, answer_ok false, null; the most serious problems.
