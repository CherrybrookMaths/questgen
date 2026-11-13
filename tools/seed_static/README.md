# HSC Mathematics Advanced question bank: seed for an exam / worksheet maker

Export date: 11 Nov 2026. Owner: Steve Yeung, CMC Education. **Private material, see §9 before deploying anything public.**

This folder is everything needed to build an exam / worksheet maker on top of the question bank: questions with LaTeX text, solutions with marking
rubrics, syllabus tags, figures (original crops and approved house-style redraws), data tables, and the 2024 syllabus
taxonomy. `types.ts` has TypeScript types for every file. `data/stats.json` has the counts.

## 1. What's in it

| Path | What |
| --- | --- |
| `data/questions.json` | 301 questions (every one approved), 479 parts, 475 solutions; duplicate copies of papers filed twice are not included (see `also_in`) |
| `data/papers.json` | 11 source papers (NESA HSC 2020–2023, trials, school tasks) |
| `data/syllabus_2024.json` | 359 dot points of the NESA Mathematics Advanced 11–12 syllabus (2024), with LaTeX wording |
| `data/codes_2017.json` | 2017 syllabus codes → titles (each part also keeps its 2017 code) |
| `data/figures.json` | 180 figures, keyed by figure key |
| `data/tables.json` | data tables referenced from text with `\extable{id}` |
| `data/stats.json` | counts |
| `figures/crop/<key>.png` | original figure crops from the papers, 200 dpi |
| `figures/redraw/<key>.svg` (or `.png`) | TikZ redraws in one house style (PNG at 300 dpi for a few heavy-stipple figures) |
| `figures/tikz/<key>.tex` + `examstyle.tex` | TikZ sources, compile with `pdflatex` (TeX Live 2022+, pgfplots 1.18) |
| `figures/crop_300dpi/<key>.png` | the same crops re-rendered from the source PDFs at 300 dpi, for print (question figures; solution-sketch figures only at 200 dpi) |
| `figures/redraw_pdf/<key>.pdf` | redraws as vector PDF: use these in printed exams (sharp at any size) |
| `pages/<paper>_<page>.jpg` | every source page image (for a "view original" button or human checking) |
| `database/questions.db`, `questions.sql`, `schema.sql` | the full SQLite database the export is made from (more fields than the JSON, e.g. runs, raw tags) |
| `tools/make_worksheet.py` | reference exam/worksheet builder: question ids or a topic → print-ready exam PDF + marking guide PDF (LaTeX) |
| `tools/export_seed.py` | the script that produced this folder |
| `samples/*.pdf` / `.tex` | worksheets built by the tool: Discrete random variables, Areas and the definite integral, MCQ sample |
| `reference/review_page.html` | the working review/browse page this data came from: a complete reference renderer (vanilla JS + MathJax) |
| `reference/DIAGRAM_SPEC.md`, `DIAGRAM_FEEDBACK_LOG.md` | the owner's rules for diagrams, for anyone making new ones |
| `types.ts` | data contract |

## 2. Data model in one paragraph

A **paper** has **questions**. A question has an optional `stem`, one or more **parts** (`parent_id` makes (a)(i)
nesting), MCQ `options` (or an `options_table`), and **solutions** (attached to a part via `part_id`, or to the whole
question). **Tags live on leaf parts**: `syllabus_2024` is a list of dot-point tags (one `primary`), plus the 2017 code and
keywords. Figures and tables are separate lookups referenced from text.

## 3. Taxonomy for browsing

`syllabus_2024.json` gives the hierarchy **Year (12, 11) → focus area → subheading → dot point**. To place a question,
take each leaf part's `primary` tags (all tags if none is primary) and put the question under that dot point's subheading.
A question can appear under several subheadings.

- `coverage: "removed"`: content in past papers that the 2024 syllabus dropped. Show it in its own "Removed content"
  section, never mixed into current topics.
- `coverage: "no_match"`: no 2024 dot point fits (2 parts).
- Subheadings with no questions should still show, with "No questions yet" (several 2024 topics are new).
- **Tag chips**: show the subheading name as the chip text, e.g. "Y12-279 Areas and the definite integral". On hover or tap,
  show a card with the full dot point (`latex`, typeset), year, focus area › subheading, and the 2017 code with its title.
  The owner asked for this specifically: bare codes like Y12-355 mean nothing to a teacher.

## 4. Text format (the part most likely to trip you up)

Every text field (`stem`, `parts[].latex`, `options[].latex`, `solutions[].latex`, `criteria[].criterion`, captions)
is **prose with LaTeX math**, not a full LaTeX document:

- Inline math `$...$`, display math `$$...$$`. Blank line (`\n\n`) = paragraph break; single `\n` = space.
- `\textdollar` (or `\text{\textdollar}`) means a literal **dollar sign** (money), not math. Replace it with `\$` before typesetting.
- `\exfigure{<key>}` (outside math): put figure `<key>` here as a centred block. Look the key up in `figures.json`.
- `\extable{<id>}` (outside math): put data table `<id>` here as a centred block (see §6).
- Multi-line working uses `$$\begin{aligned} ... \end{aligned}$$`.
- Dot points (outside math): `\begin{itemize}` then one `\item …` per point, then `\end{itemize}`. Render as a bulleted list (`<ul>`); in LaTeX it prints as-is. An item may contain `\exfigure{…}`.

**Fonts: make it look like the paper.** NSW HSC papers are set in Times Roman/Italic for both the text and the maths, so
render exam content the same way. Text (stems, parts, options, solutions, criteria, data and answer tables, dot points):
`font-family: "Tinos", "Times New Roman", Times, serif` (Tinos is on Google Fonts and is metric-compatible with Times New Roman;
about 16px reads like the paper's 12pt). Keep your own UI font for chrome such as navigation, buttons and badges.
Maths: **MathJax 4 with the TeX Gyre Termes font** (`mathjax@4.1.3` + `@mathjax/mathjax-termes-font@4.1.3`). Load
`tex-svg-nofont.js`, set `output:{font:'mathjax-termes'}`, and set `loader.paths` for `mathjax` and `mathjax-termes` to pinned
URLs so the font data is fetched from a host you control. SVG output keeps the font data as JavaScript, so it works where
web-font files are blocked. MathJax 4 loads its font data asynchronously, so call `typesetPromise` only after
`MathJax.startup.promise` resolves. If you turn off speech (`options.menuOptions.settings.{enrich,speech,braille}:false`), set
`assistiveMml:true` so screen readers still get MathML. The previous MathJax 3.2 config also works, but its maths is in Computer
Modern and doesn't match Times text. **KaTeX can't do this:** it ships only Computer Modern (KaTeX_* fonts) and has no Times
option. If you use KaTeX, the maths will look different from the paper. Use MathJax 4 + Termes for this bank. If you have to keep
KaTeX, still set the text in Tinos and accept that the maths won't match.

Typesetting: **MathJax 3.2** (the reference page uses `tex-svg`, config:
`{tex:{inlineMath:[['$','$']],displayMath:[['$$','$$']],processEscapes:true}}`), or **KaTeX** with auto-render. Every math
string in this export renders in KaTeX with **0 errors** (checked). Commands used are standard: `\dfrac`, `\left/\right`,
`\sqrt`, `\int`, trig/log, `\therefore`, `aligned`, `\text`, `\operatorname`, `\overline`, `\boldsymbol`, `\mathbb`.
The owner requires **typeset maths everywhere**, including hover cards and dot-point lists. Never show raw LaTeX or flattened text.

## 5. Figures

`figures.json[key].use` says what to show **today**: `"redraw"` only when the owner approved the house-style redraw,
otherwise `"crop"`. 133 of 180 redraws are approved, and the rest are still awaiting his re-check after his latest notes.
Re-export to pick up new approvals.

- Display at the printed size (`print_width_mm`, so the crop at 200 dpi ≈ px × 0.48 CSS px), capped at 100% width,
  **always horizontally centred**.
- MCQ option graphs of one question come as separate figures (`..._1` … `_4`) and should be laid out as a 2×2 grid like
  the paper, labelled A–D.
- **Transparent, no background.** Redraws (SVG/PDF) and crops (PNG with alpha) are black ink on a transparent
  background, so they sit on any page colour. For a dark theme flip the ink: `filter: invert(1) hue-rotate(180deg)` on the
  image (that is what the review page does). Never put diagrams on a white card.
- **Shading is real dots and lines**, not SVG/PDF pattern fills, so it shows in every browser, in print and at any zoom.
- **Scaling for teachers.** Redraws are vector: scale them freely on screen and in print. Labels scale with the drawing,
  so keep scale roughly 60–150% of `print_width_mm` (labels stay about 7–18 pt); for bigger changes, or to keep labels at
  a fixed size, recompile `redraw_tikz` (see `DIAGRAM_SPEC.md`). Crops are raster (300 dpi in `crop_300dpi`): fine up to
  about 150%. The worksheet builder takes `--fig-scale 0.8` (all) or `--fig-scales file.json` (per diagram), and an exam
  maker should store a per-question scale chosen by the teacher.
- `redraw_tikz` + `examstyle.tex` let you re-render at any size (e.g. print/PDF worksheets).

## 6. Tables

`tables.json` cells are **LaTeX math**: wrap each non-empty cell in `$...$`. Rules the owner set:

- First `header_rows` rows are headers (`<thead>`). If `label_column` is true, column 0 is a row-label column (`<th scope=row>`). **Every cell is centred, including the label column, and nothing may protrude from a cell** (owner rules): size columns from the typeset maths, not from character counts (the reference page measures after MathJax runs: `fitTables`).
- A cell may contain `\\` = a line break where the paper wraps it: split there and render each line (each as its own `$...$`).
- `colspans` entries also carry `rowspan` (merged down, e.g. "Number of periods" over both header rows). Empty cells are for students to fill in: never shade them.
- MCQ answer tables: never bold the correct row; show the key outside the table (review mode only).
- Column widths: if every value header in the last header row is short (≤ 8 characters: numbers, x-values, rates), **all value columns are the same width**; otherwise (tables of words: "Height | Gender | Percentage of females…") size each column to its longest line.
- **All value columns must be the same width** (e.g. discrete random-variable tables `x | P(X=x)`): use
  `table-layout: fixed` with a separate label column. Apply `colspans`.
- Centre the table. Empty cells render empty.
- **MCQ answer tables** (`options_table`): one table with header row `headers` and rows A–D, the letters outside the
  table on the left as in HSC papers. When revealing the answer, highlight the correct row (`options[].correct`).

## 7. Solutions and marking criteria

- `source: "marking_guidelines"` came from the official or school marking guidelines. `source: "model_generated"` was
  written by a model. **Show a model-generated solution only when `approved` is true** (none are approved yet, 37 exist).
- `criteria` is the rubric: render a two-column table **Marks | Criterion**. Don't show the raw string.
- `meta` holds badges/callouts: `confidence`, `check` (self-check result), `concern` (a "check this" box),
  `reused_from` (copied from a duplicate question id), `marker_note` (a marker's note to students). Keep these out of
  the solution text.
- For MCQs, hide the answer until the user reveals it.

## 8. Quality flags you can use or ignore

`review.status` (owner's decision), `review.parse_flagged` (transcription confidence low), `review.from_scan`
(transcribed from a scanned PDF), `review.self_audited` (spot-checked against the page image). A self-audit of 80
questions found 0 major transcription errors (95% upper bound about 4.5%). Scanned papers deserve a visible "from scan"
marker if you show quality to users.

`old_syllabus` set (owner, 11 Nov: "they should be marked old syllabus"): the question (or the parts it names) assesses 2017 content in neither 2024 course (currently only types of relations: one-to-one, many-to-one, …). Show an **Old syllabus** badge with the reason; exclude from new worksheets unless the teacher asks for them.

**Naming (owner, 11 Nov).** Title every question by its `qid` ("QID 0316"), never "Question 7"; show `source` under or beside it ("2023 Cherrybrook Technology High School AT1 Q7"). Paper labels are always "<year> <formal school name> AT<n>" (Trials are AT4) or "<year> NESA HSC"; `papers.json` also has the fields separately. Question `type` is `multiple_choice` or `short_answer`.

`also_in`: other papers this exact question also appears in (a paper filed twice). Only one copy is exported (owner, 11 Nov: "delete those from the export"); show "also in …" on it.

`standard_course` set (owner, 11 Nov): the question (or the parts it names) assesses content that left Mathematics Advanced in 2024 but is in the 2024 **Mathematics Standard** syllabus (bivariate data analysis, data analysis, investment and loans). Show it in a separate **Standard** section, not in Advanced topics, and leave it out of Advanced worksheets unless asked. `old_syllabus` is now only for content in neither course.

`related` with `numbers_changed`: same question, different numbers (keep both).

## 9. Building exams and worksheets

`tools/make_worksheet.py` is a working reference for the print pipeline. It turns question ids (or a syllabus
subheading) into an exam PDF and a marking-guide PDF with pdflatex. It has been run over **all 296 unique questions** and
both documents compile, so the conversion rules below cover the whole bank.

```
python3 tools/make_worksheet.py --topic "Areas and the definite integral" --max 6 --title "Areas" --out out/areas
python3 tools/make_worksheet.py --ids 204,173,206 --title "MCQ practice" --out out/mcq --no-space
```

What it does, and what a production exam maker needs to keep doing:

- **Text:** LaTeX-in-prose goes into LaTeX almost unchanged. `$$..$$` becomes `\[..\]`, `\textdollar` becomes `\$`,
  text-mode specials (`% & # _`) are escaped outside math, and a few Unicode characters are mapped.
- **Figures:** use the vector `redraw_pdf` when `use == "redraw"`, else `crop_print`. Width = `print_width_mm`
  (max 160 mm), centred.
- **Tables:** `tabular` with a separate label column and **one shared width for every value column**; header rule
  under the header rows; `\multicolumn` for colspans, `\multirow` for rowspans, a nested `tabular` for `\\` line breaks; scaled to fit the page; centred.
- **MCQ:** short options in a 2×2 grid, long ones as a list, graph options as a 2×2 grid labelled A–D, answer tables
  as one table with A–D outside on the left.
- **Marks:** total in the header; per-part marks right-aligned; answer lines scale with marks (3 lines per mark).
- **Marking guide:** MCQ answer letter; solution; rubric table Marks | Criteria; marker's notes. Model-generated
  solutions are left out unless approved (`--include-pending` prints them marked "not yet approved").
- **Source line:** each question shows its paper and number (e.g. "2020 NESA HSC, Q20") so teachers can trace it.
  Remove it for student-facing papers if you prefer.
- **Layout:** a question starts on a new page only if less than ~14 lines remain; long questions then break between parts or answer lines (never mid-figure), so there are no blank pages.

Features an exam maker will want that the data already supports: filter by topic or dot point, by paper or year, by
marks, multiple choice vs short answer, exclude removed content; no duplicates to remove (only one copy is exported); keep `standard_course` questions in their own section; difficulty is **not** in the data
yet; answer-space sizing could use marks (as here) or a per-question override.

Known data issues to handle or fix before production:

- About 50 rubric criteria (mostly model-generated and a few school guidelines) contain maths as plain text
  (`y=x^2`) instead of `$...$`. The builder escapes `^` so it compiles, but it prints unformatted. These are being
  reformatted in the next round.
- A few question texts still carry transcription notes in brackets, e.g. "(Columns: Equation, Value of b, Value of c.)".

## 10. Copyright and use (read before deploying)

The questions come from NESA HSC papers and marking guidelines (© NSW Education Standards Authority) and from trial
papers and school assessment tasks owned by their authors (CSSA, schools). NESA's licence for HSC material does not
automatically cover commercial tutoring use. This export is for **private, internal** development. Get permission or
legal advice before putting it on a public or paid site. Figures redrawn in TikZ are still derived works of the
originals.

## 11. Keeping it current

The live source of truth is the review page artifact (Claude) and `questions.db` in the owner's Google Drive folder
"HSC Advanced Question Bank". Approvals keep changing, so ask Claude to "re-export the frontend seed" to regenerate this
folder with the latest approvals (script `export_frontend.py`).


## Topic revision sets (`tools/make_revision.py`)
One PDF per topic: questions with answer lines (2 per mark + 1), solutions at the back in two columns. Every question is one unbreakable box, measured first and packed best-fit onto pages, so no question is split across pages; a question taller than a page first gets smaller diagrams, then 1.5 lines per mark, and only then splits between parts (continuing on the very next page). Example: `python3 tools/make_revision.py --title "Optimisation" --subheadings "Optimisation" --out out/optimisation`.
