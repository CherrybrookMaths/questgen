# Dot point LaTeX spec (dptex-v1)

The 2024 NESA Mathematics Advanced dot points in `/home/claude/pilot/site/data/dotpoints.json` were extracted as plain
text, so their maths is mangled (lost superscripts, fractions flattened, "―" for minus, subscripts run together:
"x = ―b± b2―4ac 2a", "(x1,y1)"). Your job: for each id in your batch, write the dot point as it is PRINTED in the
syllabus, with all mathematics in LaTeX.

Syllabus PDF: `/root/.claude/uploads/800fc37d-9da1-531b-8789-51723586bf26/28ea702e-NESA_-_mathematics_advanced_11_12_2024_S6.pdf`

For each id:
1. Find the dot point in the PDF (pymupdf `page.search_for` on a distinctive phrase of the text, or pdftotext per page).
   Render that page region at 150 dpi under `/home/claude/pilot/work/dptex_<BATCH>/` and LOOK at it with Read whenever the
   dot point has any maths (formulas, exponents, fractions, subscripts, Greek letters, integrals, function notation).
   Plain-prose dot points need no image check.
2. Write `tex`: the same words, verbatim (keep NESA spelling and punctuation), with every mathematical expression in
   `$...$` — single letters used as variables too (`$x$`, `$f$`, `$a, b$ and $c$`). Use `\dfrac` for displayed-style
   fractions, `\sqrt{}`, `\le`, `\ge`, `\ne`, `\Delta`, `\pi`, `\sin`, `\log_a`, `\ln`, `\int_a^b f(x)\,dx`, `{}^nC_r` etc. as printed.
   No markdown, no line breaks. Units/words stay outside math.
3. Check it renders: write `[{"id":..,"latex":..}]` to a file and run `node /home/claude/pilot/tools/check_latex.js <file>`; fix any errors.

Output `/home/claude/pilot/work/dptex_<BATCH>.json`: `{"<id>": "<tex>", ...}` — save every ~15 ids.
Final reply ≤5 lines: count done, and any id where the PDF and the extracted text disagree in wording (not just maths).
