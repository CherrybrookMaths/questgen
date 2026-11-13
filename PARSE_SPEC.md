# Parse spec v1 (prompt_version = parse-v1)

You are parsing ONE NSW Year 12 Mathematics Advanced exam PDF into structured JSON. Accuracy over speed: the
LaTeX must match the page exactly. Do not solve questions, do not invent content, do not fix the exam's typos
(note them in `notes` instead).

## Inputs
- PDF: `/home/claude/pilot/src/<ID>.pdf`
- Your prompt gives: document id, task_type, parse_path (digital|scan), whether solutions are bundled in the same file.
- Tools available in Bash: python3 with `pymupdf` (import pymupdf), pdftotext, pdftoppm, PIL. Read tool renders PNG images so you can look at pages.
- Write scratch files only under `/home/claude/pilot/work/<ID>/`.

## Method
1. `pymupdf` open the PDF, note page count. Identify page ranges: cover/instructions, Section I (MCQ), Section II, solutions/marking guidelines (if bundled), reference sheet (skip), blank/writing pages (skip).
2. **digital path**: use `page.get_text("dict")` / `get_text("text")` for wording, but ALWAYS render each question page to PNG (`page.get_pixmap(dpi=110)`) and look at it, because extracted text mangles fractions, integrals, superscripts and matrices. Write LaTeX from what you SEE, using the text layer only to get wording exactly right.
   **scan path**: render pages at 150 dpi and transcribe from the images. Set `needs_review: true` on every question (brief rule: scan path defaults to review).
3. Per question produce one record. Parts nest: (a), (b) → (i), (ii) uses `parent_label`. A question with no lettered parts still gets exactly ONE part with `label: null` holding the whole question text, and `stem_latex` null.
4. `stem_latex` = shared stimulus text that precedes all parts (e.g. "A particle moves so that…"). Part-specific text goes in the part.
5. Marks: read the margin mark for each part. `marks_total` = what the paper states for the whole question if stated, else the sum of parts. MCQ = 1 mark each unless stated.
6. MCQ: `question_type: "mcq"`, options A–D in `mcq_options`. `is_correct` only if an answer key is in THIS document (bundled solutions / marking guidelines); then `key_source: "extracted"`. Otherwise null.
7. `question_type`: mcq | short (≤3 marks total and no sub-parts deeper than one level) | extended (otherwise).
8. **Figures** (graphs, diagrams, tables drawn as images, tree diagrams): record page index (0-based), bbox in PDF points `[x0,y0,x1,y1]` (pymupdf coordinates, origin top-left), and whether it belongs to the question stem (`attach: "question"`) or a specific part (`attach: "<part label path>"`, e.g. "a" or "b.ii"). Crop each to PNG at 200 dpi: `page.get_pixmap(dpi=200, clip=pymupdf.Rect(bbox))`, save to `/home/claude/pilot/figures/<ID>_q<number>_<k>.png`. In the LaTeX put `\exfigure{<ID>_q<number>_<k>}` at the point the figure appears. Do NOT produce TikZ. Tables that are plain text may be written as LaTeX `\begin{array}` inside math instead of cropping — if unsure, crop.
   For digital PDFs, `page.get_images()` / `page.get_drawings()` help locate figure regions; still verify the crop by viewing the PNG.
9. **LaTeX conventions**: running text is plain text; math is inline `$...$` or display `$$...$$`. KaTeX-compatible only (no `\begin{tikzpicture}`, no `\includegraphics`, no custom packages). Use `\dfrac` for displayed fractions, `\,dx` in integrals, `\text{}` for words inside math. Escape a literal dollar sign as `\$`.
10. **Bundled solutions / marking guidelines**: extract them into `solutions` with `question` number and `part` label path (null = whole question), `latex` of the worked solution, and `marks_breakdown` (criteria text, e.g. "2: correct answer; 1: correct derivative"). Also fill MCQ keys. If this document IS a solutions/marking-guidelines file (task_type solutions), output only `solutions` + `mcq_key` and an empty `questions` list.
11. Set `needs_review: true` on a question or part when: you could not read something clearly, marks don't add up, a figure crop is doubtful, or the text layer and the image disagree. Say why in `review_reasons`.

## Self-checks before finishing (do them, report results)
- Run `node /home/claude/pilot/tools/check_latex.js /home/claude/pilot/out/<ID>.json` and fix every error it reports.
- No part has empty `latex`.
- For each question, `marks_total` == sum of leaf part marks; if not, keep both and add `marks_mismatch: true`.
- Question count and section totals match the cover (e.g. "Section I 10 marks, Section II 90 marks").
- Every figure PNG exists and you have looked at at least a sample of them.

## Output: `/home/claude/pilot/out/<ID>.json`
```json
{
  "document_id": 296, "prompt_version": "parse-v1", "parse_path": "digital",
  "page_ranges": {"questions": [2, 33], "solutions": null, "skipped": [[0,1],[34,40]]},
  "cover_totals": {"section_I_marks": 10, "section_II_marks": 90, "total": 100},
  "questions": [
    {"number": "11", "section": "II", "question_type": "extended", "stem_latex": "…", "marks_total": 3,
     "page_start": 5, "page_end": 5, "needs_review": false, "review_reasons": [], "marks_mismatch": false,
     "parts": [{"label": "a", "parent_label": null, "ordinal": 1, "latex": "…", "marks": 2, "needs_review": false},
               {"label": "i", "parent_label": "b", "ordinal": 3, "latex": "…", "marks": 1, "needs_review": false}],
     "mcq_options": [],
     "figures": [{"id": "296_q11_1", "page": 5, "bbox": [72, 300, 400, 520], "attach": "question", "caption": "graph of y=f(x)"}],
     "free_tags": ["related rates"]}
  ],
  "solutions": [{"question": "11", "part": "a", "latex": "…", "marks_breakdown": "…"}],
  "mcq_key": {"1": "B"},
  "checks": {"latex_errors": 0, "empty_parts": 0, "marks_mismatches": 0, "question_count": 32, "section_totals_ok": true},
  "notes": "anything odd: typos in paper, ambiguous marks, pages you could not read"
}
```
`free_tags`: 1–3 short question-type labels a student would search for ('trapezoidal rule', 'limiting sum', 'z-score comparison'). Optional.

## Numbering
Keep `number` exactly as printed, even if the paper misnumbers (e.g. two Q4s). Add `"seq": <1-based order in paper>` to every question, and note misnumbering in `notes`. Never renumber.

## Hard stop
If you have used more than ~150 tool calls, or the document is not an exam at all, stop: write what you have with `"status": "partial"` and explain in `notes`. A clean partial is better than a guessed full.

## Final reply
Reply in ≤8 lines: question count, parts count, figures count, needs_review count, marks mismatches, latex errors after fixing, anything a human must look at. Do not paste the JSON.


## Paragraph breaks (owner, 11 Nov)
Every paragraph break or forced line break in the paper is kept as a blank line (`\n\n`) in the text. A single newline renders as a space, so never use one between paragraphs. After loading, `tools/para_detect.py` compares the text with the page images and lists breaks that were lost; `tools/para_sync_dups.py` makes duplicate copies of a paper agree, and `tools/house_style.py` turns any stray single newline into a paragraph break.

## Unrelated parts are separate questions (owner, 11 Nov)
Older school papers group unrelated items under one number (Question 13 (a) sketch a derivative, (b) pool volume). Store each unrelated part as its own question numbered `13(a)`, `13(b)`. Keep parts together when they share a stem or data, or one says "hence" / "use part (a)". Tool: `tools/split_questions.py`.

## Every question has working (owner, 11 Nov)
After loading a paper and its marking guidelines, run `tools/coverage_check.py`. Any MCQ or leaf part it lists gets a worked solution written to SOLUTION_SPEC (source `generated`, shown once approved). An answer key alone does not count.

## No transcription notes (owner, 11 Nov: 2021 HSC Q17, "(Part (a) has sub-parts (i) and (ii).)")
Text in the question is only what the paper prints. Never leave notes to yourself in the question ("(Part (a) has sub-parts…)", "(column heading: …)", "Table shows the following"): the structure goes in the data (parts, tables, spans), not in prose. Two were found and removed (2021 HSC Q17, Q25).

## Naming (owner, 11 Nov: "every question needs a qid and then the source can be 2023 Cherrybrook Technology High School AT# Q7"; "we should be very firm on naming, every exam has to have the year, the task number (Trials are AT4), formal school name")
- Every question is titled by its QID: "QID " + the database id padded to 4 digits ("QID 0322"). The id never changes or gets reused.
- Every paper has three required fields in `documents`: `year`, `school_formal` (the school's official name exactly as in the NSW school list, `project/nsw_schools.csv`, from ACARA's School Location file), `task_code` (AT1–AT4; **Trials are AT4**; HSC papers are `HSC`). Read them off the cover when the paper is loaded.
- The label is built from those fields, never typed: "<year> <school> AT<n>" ("2023 Cherrybrook Technology High School AT1"), or "<year> NESA HSC". The source line is label + question number ("… AT1 Q7").
- **Year = the year the students graduate** (owner, 11 Nov: "Task 1s should be the year they graduate. If they grad 2024, the term 4 task from last year should be 2024 AT1"). A Year 12 AT1 sat in Term 4 of Year 11 (cover "2023 – 2024", file "2020 (for 2021 HSC)") takes the later year. Check the cover of every AT1.
- Commercial trial papers are labelled by their setter (owner: "Commercial trial papers are fine"): NEAP, Western Mathematics, PEM, ACE, MathsBank, Bookminders, QATS, TEC, Trialmaths, e.g. "2022 NEAP AT4". The "2021 12MATAd Catholic Trial" file is the CSSA trial (confirm on its cover).
- Papers not set by a school use an approved setter name in place of the school: `NESA` (HSC), `CSSA` (owner: "CSSA papers should be labelled CSSA"), e.g. "2022 CSSA AT4", and `Independent` (owner: "Independent"; trial papers whose cover names no school), e.g. "2021 Independent AT4". Any other setter needs the owner's decision before loading.
- `tools/exam_name.py` rebuilds every label and lists any paper missing a field or whose school name is not in the official list; `build_bank.py` runs it. A paper that fails is fixed before it goes to review.
- Question types: multiple choice and **short answer** (owner: "Written questions are known as short answer"); never "written".

## Old syllabus (owner, 11 Nov: "they should be marked old syllabus")
A question that assesses 2017 content with no 2024 dot point gets `questions.old_syllabus` = a one-line reason (naming the parts if only some are affected): bivariate data, statistics of a data set (mean, quartiles, outliers, box plots), flat or effective interest rates, types of relations (one-to-one etc.), **3D trigonometry** (owner, 12 Nov: "3D trig is now Y11 extension 1"; reason text "3D trigonometry: now Year 11 Extension 1 (2024 syllabus), not Advanced"). It shows an **Old syllabus** badge and is left out of new worksheets unless asked for.
**Standard course (owner, 11 Nov: "Move some of the removed content to a standard section because technically still in std").** If the content is in the 2024 Mathematics Standard syllabus (`project/standard_syllabus_2024.txt`: Year 11 Data analysis MST-11-08; Year 12 Bivariate data analysis MST-12-S1-06 / MST-12-S2-08; Investment, loans, annuities MST-12-S2-02/03), set `questions.standard_topic` (course, year, topic, outcome code; parts named if only some) instead of `old_syllabus`. It shows a **Standard course** badge, has its own filter, is exported as `standard_course`, and is left out of Advanced worksheets unless `--include-standard`. `old_syllabus` is only for content in neither course. Set it when tagging finds `removed` content; check the question text too (the tagger missed James Ruse Q1). Borderline cases say "(borderline)".

## Boxed text and split cells (owner, 11 Nov: 2022 HSC Q21 "option 1 and 2 should go in a box just like the question"; 2023 HSC Q15 "split down the cell")
Text printed in a box is stored `\begin{framed} … \end{framed}` (one box per printed box). A table corner cell split by a diagonal is `\diag{row label}{column label}`; if it spans two header rows, give it a rowspan.

## Dot points (owner, 11 Nov: "this should render as dot points")
A list printed with bullets is stored as `\begin{itemize}` / `\item …` / `\end{itemize}` (one `\item` per point, a figure that belongs to a point stays inside it). Never as "- " lines or one run-on paragraph. `tools/liststyle.py` (in `house_style.py`) converts any "- " / "•" lines that slip through.

## Split questions lose the paper's outer label (owner 12 Nov)
"questions which were a part of a larger unrelated question should have their old lettering removed. If that question has layers, they should be shifted one level up, from i, ii to a,b,c"
- After loading, `tools/relabel_split.py` runs. A question whose only top-level part has a label loses that label, and its sub-parts become (a), (b), (c), with their own sub-parts becoming (i), (ii).
- Cross-references follow: "part (ii)" becomes "part (b)".
- The paper's label is kept in `parts.src_label`. The source line (Q9(b)) is unchanged.
