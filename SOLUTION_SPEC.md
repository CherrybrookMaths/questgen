# Worked-solution and marking-criteria house style (solution-v1, 11 Nov 2026)

Every solution in the bank is shown on screen (MathJax/KaTeX) and printed in marking guides (LaTeX). It must read like a
clean NESA marking guideline. **Formatting only: never change the mathematics, numbers, method, answer or the meaning
of a criterion.** If the source itself looks wrong, keep it and report it in `content_flags`.

## Text format (same as everywhere in the bank)
Prose with LaTeX maths: inline `$...$`, display `$$...$$`. Blank line = new paragraph. No markdown at all (no `**bold**`,
no `- ` lists, no `#`). No literal `\n` text, no `\=`.

## Layout of working
1. One idea per line. Short statements in prose; each step of algebra on its own line.
2. A chain of equalities is ONE display block, aligned on the relation:
   `$$\begin{aligned} A &= \dfrac{1}{2}\times 6\times 4 \\ &= 12 \text{ units}^2 \end{aligned}$$`
   Never several separate `$$...$$` lines for one chain, and never a chain run together inline.
3. Separate facts or deductions: a new line (paragraph or new display), led by a word or `$\therefore$`.
4. **No arrows for reasoning (owner).** Never `\Rightarrow`, `\implies`, `\rightarrow`, `\to`, `->`, `→`, `⇒`, `⟹` to mean
   "so/hence/gives". Use "so", "hence", "therefore" in words, or `$\therefore$` at the start of the line. `\to` is allowed
   only as mathematical notation inside limits or "tends to": `$x \to \infty$`, `$\lim_{h \to 0}$`.
5. Integrals, sums, limits and products written inline use `\displaystyle` so they are full size like the papers
   (owner): `$\displaystyle \int_0^1 f(x)\,dx$`. This applies to question text, options and criteria too.
   **Fractions are always `\dfrac` (owner)**, inline or display, in questions, options, solutions, criteria and tables.
   Only a fraction inside another fraction (composite) or inside an exponent/limit (`e^{\frac{x}{2}}`,
   `\int_{\frac{\pi}{6}}`) is `\frac`. `tools/fracstyle.py` applies this automatically. Approximations `\approx` (not `\doteq`, `≑`, `\doteqdot`).
   Units upright: `$12 \text{ cm}^2$`, `$\$1250.40$` (money as `\$` inside maths or `\textdollar` in prose).
6. End with the answer clearly: the last line states the result (e.g. `$$\therefore\ x = 2 \text{ or } x = -\dfrac{5}{2}$$`).
   **MCQ (owner):** never write an `Answer: B` line. The answer letter lives in the marking table's **Answer** column
   (Marks | Answer | Criterion), filled from the option key; the working ends with the reasoning that picks it.
   The MCQ criterion is always exactly one row: `[marks, "Correct answer"]` (owner), whatever the source wrote.
7. Keep the source's own words for explanations (e.g. "Strong positive correlation"), tidied for grammar/punctuation only.

## Multiplication dot (owner: "dot looks too low")
A multiplication dot is `\cdot` (centred): `$\sec x \cdot \operatorname{cosec} x$`, never a full stop `.` between factors.
Applied automatically by `tools/dotstyle.py`.
**Decimal points sit on the baseline (owner: "the decimal points are floating").** Write $0.4$, never $0\cdot 4$, even when the paper prints a raised decimal point; `dotstyle.py` converts digit `\cdot` digit.

## Errors in source marking guidelines (owner, 11 Nov: "correct them with a note")
Fix the error in the solution/criteria, keep the source text in `meta.source_original`, and write a one-line `meta.corrected` ("Corrected from source: …"). The note shows to teachers in the Bank and as a callout in Review. If the question itself is flawed, don't rewrite it: add an entry to `site/project/open_decisions.json` for the owner (`"<question id>": {"text", "raised"}`, IMPORT_PLAYBOOK "Owner calls are Your calls"). Script: `tools/source_corrections.py`.

## Paragraph breaks (owner: "make sure all paragraph breaks are preserved")
Question text keeps every paragraph break of the paper, as a blank line. Checked against the page images by `tools/para_detect.py`; `parastyle.py` (in `house_style.py`) stops single newlines from collapsing into spaces.

## Marking criteria are always top-down (owner, 11 Nov: "make them ALL top down")
HSC style: the top row is the full mark, "Correct answer"; each lower row describes the furthest step reached, ending "or equivalent merit" (e.g. 3 Correct answer / 2 Finds the gradient of the normal, or equivalent merit / 1 Finds $f'(1)$, or equivalent merit). Never one mark per line. Source rubrics written one-mark-per-step are rewritten by `tools/topdown.py`, keeping the original in `meta.criteria_original`. Rubrics Claude writes use this form from the start.

## Every question has a solution (owner, 11 Nov: "all questions must have one")
Every question, MCQ included, has an answer-and-solution box. When the source has only an answer key (NESA HSC MCQs) or nothing, write a short worked solution (`source=generated`, confidence and self-check) that ends with the reasoning that picks the keyed option; a copy of the same paper reuses it (`reused_from`).
**MCQs need working too (owner, 11 Nov: "why no working out, ensure mcq has working out too").** An answer key alone is not a solution. Write it like the approved MCQ solutions: 1–5 lines that show why the keyed option is right (the condition, the calculation, or the feature of the graph), naming the rejected options only when that is the quickest argument. `tools/coverage_check.py` lists every MCQ and leaf part without working; it must report 0 before a paper goes to review.

## Every rubric is shown (owner, 11 Nov: "why doesn't this have a marking criteria?")
Show the Marks | Criterion table for every written part, even when it is a single "1 | Correct answer" row. Only MCQs use the Marks | Answer | Criterion form.

## Explain the set-up (owner, 11 Nov: "the first section needs an explanation")
Each line that brings in a new relationship says, in a short sentence before it, where it comes from: the given formula, Pythagoras' theorem in a named triangle, a trig ratio, a rule of differentiation. A nature test says which factor decides the sign and tests only that factor (keeps lines short). Example: Sydney Grammar 2024 trial Q31 (lamp).
**Keep it brief** (owner: "this is a little too overkill"): one short sentence naming the reason, the way a good worked solution would, not a step-by-step walkthrough. Good: "In the cross-section, the triangle above the prism (height $H-h$, base $\dfrac{x}{2}$) is similar to the whole right-angled triangle (height $H$, base $R$): common angle at the apex, both right-angled (equiangular)." Too much: a paragraph per triangle plus "multiply both sides by $2R$".

## Diagrams in solutions (owner, 11 Nov: "diagram will be helpful here")
When the working depends on a figure the student has to picture (bearings, triangles solved with the sine/cosine rule, ambiguous-case angles), put a labelled diagram at the top of the solution, in house style (`DIAGRAM_SPEC.md`), drawn on the question's own figure: the given and found angles and sides, and north lines where bearings are used. Key `<paper>_q<n>_s<k>`; it goes through diagram approval like any redraw.
Never leave a bracketed description such as "[Diagram: …]" in a solution (owner): when the guideline shows or describes a diagram, draw it with every label it mentions.

## Sketch questions: draw it, don't describe it (owner, 11 Nov)
A part that asks to sketch, draw or plot is answered with the drawing: a solution diagram (`\exfigure{<paper>_q<n>_s1}`) in house style, on the question's own axes or grid when it gives them, with every feature the question asks for labelled (intercepts, stationary points, inflections, end points, asymptotes, intersections). Working that finds those features stays; a sentence describing the shape does not. It goes through diagram approval like any redraw.
**Don't list what the sketch already shows (owner, 11 Nov).** No lines restating points that are labelled and obvious on the graph (intercepts, start and end points, maxima, minima, vertices) and no sentence describing the shape. Keep calculations that find features, and state only what is hard to read off a sketch: points of inflection (with the concavity change), asymptotes and limiting behaviour, symmetry.

## Show where every parameter comes from (owner, 11 Nov: "explain why h = pi/6")
A method's parameters are derived on the page, never just stated: the strip width $h=\dfrac{b-a}{n}$ and the $x$ values for the trapezoidal rule, the formula being used, $a$ and $r$ for a series, $n$ for a number of periods. Example: 2021 Independent trial Q23.

## Tables: every cell centred, nothing protrudes (owner, 11 Nov)
Data-table cells are centred horizontally, including the row-label column ($x$, $f(x)$, $P(X=x)$). No cell content may stick out of its cell: on the page, column widths are measured after the maths is typeset (`fitTables`), label column to its widest entry, value columns kept equal at the widest value. Applies on the page, in the worksheet builder and in any frontend.

## Table layout (owner, 11 Nov: 2021 HSC Q25, Q32; 2022 HSC Q2, Q12)
- A header that spans two header rows on the paper is merged down (`rowspan`), e.g. "Number of periods" over both rows of an interest-factor table.
- A long header wraps where the paper wraps it: `\\` in the cell, each line on its own row with clear spacing. Word tables size each column to its longest line (Height and Gender narrow, the long header wide); number tables keep equal value columns.
- Empty cells are for students to fill in: never shaded.
- MCQ answer tables: the correct row is never bold. In review mode it gets a green tint and an "answer" badge outside the table, so nothing in the question itself changes.
- Worksheets: never wider than the page (columns scaled to fit).
- A corner cell split by a diagonal on the paper is stored `\diag{row label}{column label}` and drawn with the diagonal (owner: "table needs to look identical with that split down the cell").
- A table wider than the page column shrinks to fit rather than scrolling (owner: "the table seems too long, will it scale itself?").
- Piecewise (`cases`) rows containing `\dfrac` get extra row space (owner: "the piecewise pieces are a bit too close"); `house_style.py` adds it.

## Product and quotient rule set-out (owner, 11 Nov: 2020 HSC Q18 "a) should say applying product rule and showing u u' v v' in a grid")
Name the rule and its formula, then list the four pieces in a 2×2 grid before substituting:
`Using the product rule, $\dfrac{d}{dx}(uv)=u'v+uv'$, with` then `$$\begin{aligned} u&=e^{2x} & v&=2x+1\\ u'&=2e^{2x} & v'&=2\end{aligned}$$`.
Same for the quotient rule with $\dfrac{d}{dx}\left(\dfrac{u}{v}\right)=\dfrac{u'v-uv'}{v^2}$. Applied to every product/quotient-rule solution (`tools/uv_grid.py`).

## Angle notation (owner, 11 Nov: "why does B have a hat on it?")
Write angles as $\angle ABC$, never $A\hat{B}C$ (an older NESA notation the questions don't use). `house_style.py` converts automatically.

## Draw it: never describe a curve (owner, 11 Nov, third time: "when asked to draw, do NOT describe the curve in the answer, it must have the actual graph"; "darw it, don't just describe curves"; "answer has to have the GRAPH in it"; "should draw this instead of describing it")
Any solution that relies on a sketch has the sketch as a real diagram (`\exfigure{<paper>_q<n>_s<k>}`), never a sentence like "Sketch of … with …" or "Normal curve sketch with …". When the question gives axes or a grid, draw on those axes (choose and label the scale). If the reasoning doesn't need a picture (e.g. reading features off a given $f'$ graph), give the reasoning instead and don't mention a sketch. Swept the bank: 2025 James Ruse Q21, Q31; 2024 Sydney Grammar Q7 drawn; Q5, Q9 (Sydney Grammar) rewritten as reasoning; 2023 HSC Q11(b) shows the graph from part (a).

## Make each step's reason explicit (owner, 11 Nov: James Ruse 2025 "solutions unclear", "solutions not good")
- Domains: state each condition first, then solve ("$\ln(x-1)$ needs $x-1>0$; the square root needs $\ln(x-1)\ge0$; …").
- When an equation has two roots, say why one is chosen ("$a>1$, so the larger root").
- Name the rule being used ("Applying the change of base rule, $\log_a b=\dfrac{\ln b}{\ln a}$") and write logs as $\ln$.
- Establish the structure before using it ("each term is a whole number plus a fraction: two GPs").
- Test, then conclude: never state a point of inflection or the nature of a stationary point before the test that proves it.
- MCQ: show why the keyed option is true (calculation or condition), and briefly why the others fail when that's quick.
- Fractions are always `\dfrac`, never a slash (`\pi/2`). Units like km/h are the only slashes allowed.

## Automatic rules
`python3 tools/house_style.py` applies every mechanical rule (fractions, multiplication dots, paragraph breaks) to the whole database.
Run it after loading or editing any paper.

## No long inline maths (owner)
Inline maths is for short things ($x = 2$, $f'(x)$, $0 \le x \le 1$). Anything long, and every integral, sum or limit
that is part of the working, goes on its own display line:
`so the area is` then `$$\int_0^1\big((x-1)^2-(2x-2)\big)\,dx$$`. Rough limit: more than ~35 characters of maths.

## One operation per line for inequalities (owner, 11 Nov: "adjust the domain in two steps")
When an inequality is transformed (finding a range from $-1\le\cos\theta\le 1$, solving $a<f(x)<b$), do one operation per line, aligned on the first $\le$/$<$, with the operation noted at the right:
`$$\begin{aligned} -1&\le \cos 3x\le 1\\ -2&\le 2\cos 3x\le 2 &&(\text{multiply by } 2)\\ 3&\le 5+2\cos 3x\le 7 &&(\text{add } 5)\end{aligned}$$`
Never jump from the starting bound to the answer in one line.

## Sign analysis and case lists (owner: "the sign of v is hard to follow")
Never run several conditions together in one sentence. Put one interval/case per line in an aligned display, with
what it means beside it:
`$$\begin{aligned} v &< 0 &&\text{for } 0 \le t < 1 &&\text{decreasing}\\ v &> 0 &&\text{for } 1 < t < 2 &&\text{increasing} \end{aligned}$$`
Same for nature-of-stationary-point tests and for lists of conditions.

## Spacing (owner: "lots of white space between lines")
Display maths is its own line: no blank line before or after `$$...$$`. Paragraph breaks are small. Never stack empty
paragraphs.

## Marking criteria (rubric rows)
- **The full-marks row always reads "Correct answer" (owner)**: the top-mark row of a NESA-style rubric (3, 2, 1), or the last
  row of a step-mark rubric (1, 1, 1). The source wording is kept in `meta.top_criterion_original`.
- Each row is `[marks, criterion]`. **All maths in a criterion is typeset** (`$...$`): variables, equations, numbers that are
  values (`$x = 12$`, `$f'(x) = 3x^2$`, `$\dfrac{32}{3}$ m$^3$`), never `x=12`, `x^2`, `dV/dt`, `32/3`.
- Wording stays as the guideline wrote it; fix spelling/capitalisation only. Standard phrases: "Provides correct solution",
  "or equivalent merit" (keep when present).
- A marker's note to students is not a criterion: put it in `marker_note`.

## Output per solution
`{"id": <solution id>, "latex": "...", "criteria": [[marks, "text"], ...], "marker_note": "..." | null,
  "changed": "short summary of formatting changes", "content_flags": "anything that looks mathematically wrong in the source" | null,
  "format_note": "everything else worth knowing: sketch still to draw, rubric written by us, working completed, values checked" | null}`
**`content_flags` is only for a possible error in the source** (16 Nov, Batch 6: 65 of 71 flags were layout and provenance notes,
and triage sends every content flag to Decide, the owner's own queue). Put everything else in `format_note`.
