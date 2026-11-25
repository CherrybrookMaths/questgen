# Diagram redraw spec (diagram-v5, 11 Nov 2026)

You redraw NSW HSC Mathematics Advanced exam diagrams in TikZ/pgfplots so every diagram in the bank has one consistent
look. **The goal is a redraw that looks the same as the original crop**, cleaned up into house style. Nothing is used
until the owner approves it in Review, so aim to make approval a formality. Rules marked (owner) came from his review
notes, quoted. `DIAGRAM_FEEDBACK_LOG.md` is the history behind them: do NOT read it; everything you need is here.

## Inputs
- Group/batch file in your prompt: `{id, context, caption, kind}`. Original crop: `/home/claude/pilot/figures/<id>.png`
  (200 dpi). `context` is the question/solution text: use it to understand the figure, NOT to change its geometry.
- House style: `/home/claude/pilot/tikz/examstyle.tex` (v4). Use it; never edit it; never define your own patterns.
- Renderer: `/home/claude/pilot/tools/tikz_render.sh <id>` compiles `tikz/tex/<id>.tex` and writes `tikz/svg/<id>.svg`,
  `tikz/png/<id>.png` (200 dpi) and `tikz/cmp/<id>.png` (ORIGINAL left, REDRAWN right, same physical scale).
- Objective check: `python3 /home/claude/pilot/tools/overlay.py <id>` → `tikz/overlay/<id>.png` (RED only original,
  BLUE only redraw, BLACK both) and two scores (share of each side's ink within 2 px of the other's).

## File template (`tikz/tex/<id>.tex`)
```
\documentclass[border=4pt,12pt]{standalone}
\input{../examstyle.tex}
\begin{document}
\begin{tikzpicture}
  ...
\end{tikzpicture}
\end{document}
```
Working in the crop's own pixel units is easiest: `x=0.0127cm, y=-0.0127cm` makes 1 unit = 1 crop pixel (y downwards).

## Rules (grouped by topic; numbers kept so older notes still match)

**Line weights (owner 12 Nov: "The original was gray because it was a scan, it should be black"; "0.6 would be best").** 0.4pt read as grey on screen. Every line 0.6pt; graphs, box plots and tree branches that must stand out 0.9pt; grid lines stay light grey.

### Faithful to the paper, cleaned up
1. **Match the crop, not the mathematics (owner).** Same proportions, positions, aspect ratio, curve shape, label
   placement and printed size. Never draw to true scale when the crop is a sketch or NOT TO SCALE; never move a turning
   point, intercept, angle or length to its "true" position. An equation may be used only to get a smooth curve that is
   then fitted to the positions the crop shows. Draw level: a scan's slight tilt is straightened, never
   copied (owner 17 Nov: "Draw level.", after the checker's "Make the whole graph not tilted to the left."; this replaces
   the earlier "follow a scan's slight tilt").
10. **Don't copy hand wobble (owner: "it's wonky but it shouldn't be, the teacher just drew it not perfectly"; "the normal dist, its wonky at the start").** Rule 1 is about layout and proportions, not drawing faults. Curves with a known equation or shape (normal curves, parabolas, exponentials, trig) are drawn from the mathematics at the crop's size and position — smooth and symmetric where the curve is — never traced from an uneven pen or scan line.
16. **Marked points sit at their true coordinates (owner: "the 6,6 point doesn't look like the actual intersection of the graphs"; "associate the (4,31) and max TP with the actual point").** Any labelled point (intersection, turning point, intercept) is plotted at its computed position on the drawn curves, and its label is attached to that dot. Compute it; never copy its position from the sketch.
17. **Leave out the teacher's working marks (owner: "remove the 308 degrees, that was a reference for 30 degrees"; "JANKY teaching drawing"; "uneven and ticks bad because of teacher, make it much more organised").** Solution sketches are redrawn as clean exam diagrams: drop scribbles, reference numbers, crossed-out marks and uneven ticks; ticks evenly spaced on a true scale.
18. **The diagram must agree with the solution (owner: "x should be the angle, the diagram is just wrong in that case").** If the sketch labels something differently from the worked solution, follow the solution.
25. **Show the whole graph the question shows (owner: "no cutting off the graph, don't have to make it one to one").** Never trim a curve to a restricted domain unless the question itself restricts it.
2. **Same size and label size as the paper.** The redraw in `cmp`/overlay should be the same width and height as the
   original; labels the same size (adjust with `font=\large` etc.).

### Lines, curves, arrows, axes
3. **Thin lines everywhere (owner).** House weight is 0.6pt (examstyle). No local `line width` above 0.6pt except the 0.9pt emphasis in rule 9, no `thick`/`semithick`/`very thick`, even when the scan's strokes look heavier.
   Dashed lines use the house `aux` style (short fine dashes: on 2pt off 1.5pt); never long or heavy dashes.
9. **Curves stand out from axes (owner: "the graph needs to be a bit thicker ... to show which is graph, which is axis"; "make the box plots a bit thicker").** Rule 3 stays for axes, grids and construction lines (0.6pt). A plotted graph that runs along or touches an axis, and every box plot (box, median, whiskers), is drawn at 0.9pt so it reads as the graph.
   Exception (owner 24 Nov: "allow this one exception"): 2019 HSC Standard 2 Q31 (5832_q31_1), the bolded section of the curve is 1.6pt
   (checker: "Make the bolded section bolder"). No other drawing goes above 0.9pt.
3a. **Smooth curves (owner: "looks fuzzy").** Plot functions with `smooth` and about 90 samples, not hundreds of straight
   segments, and stop an asymptotic tail before it runs into the axis arrowhead. A curve traced from the crop is never drawn through every traced pixel point (owner: "bumpy"):
   run `python3 tools/desmooth.py tikz/tex/<id>.tex` to refit it as one smooth spline within 0.25% of the trace.
4. **Arrows: filled `-latex` heads everywhere (owner).** Axes, curve ends, dimension arrows, bearings: always
   `Latex[length=2mm,width=1.3mm]` (the house default `>`; `open arrow` is now the same head). Never Straight Barb,
   Stealth, To or open chevrons, even where the crop has them. Match which ends have arrows.
4a. **Each tick drawn once (owner: minor ticks showing behind major ticks).** Minor tick lists skip the major
   positions, and `extra ticks` positions are left out of `xtick`/`ytick`. Check with `python3 tools/tickdup.py '<id>.svg'`.
12. **Things that meet must meet (owner: "the x and the dotted line must meet at the graph"; "the first part of the piecewise is not connected"; "the line with bearing 56 should line up with OA").** Guide/dotted lines end exactly on the curve at the marked point; pieces of a continuous piecewise function join; a line drawn along a named segment lies exactly on it.
13. **Axes run past the graph (owner: "extend the axis and axis arrows a bit past the graph's intercept").** Each axis extends a little beyond the furthest intercept, label or plotted point, then the arrowhead.

### Labels and text
6a. **Labels never touch lines (owner).** Every label, point annotation and equation sits clear of curves, axes and
   arrowheads (≥ 2 px gap at 200 dpi), centred on what it labels (e.g. a side length centred on its side). Rotate a label
   if the crop rotates it (e.g. an angle written along a line).
11. **Labels never touch lines (owner: "the 30 degrees is touching the hypotenuse"; "the dotted line shouldn't exactly overlap with the theta").** Every label (angle values, θ, point names, tick numbers) sits clear of every line, curve, dashed line and arc, with a visible gap; move the label, not the geometry.
14. **Angle marks big enough to read (owner: "the W angle marking is too small, W is touching the north line").** Angle arcs have a radius large enough that the arc and its value sit clear of both arms; tree-diagram probabilities sit beside their branch, never on it ("a bunch of the fractions are overlapping the branches").
19. **One font for labels (owner: "R not using the correct font").** Every label uses the house maths font: variables, points and region names (R, A, B) in maths italic, exactly like the question text; no upright or sans-serif labels.
20. **Titles are centred (owner: "the heading of graphs should always be centered").** A table caption or a graph/chart title sits centred over the table or plot area, never left-aligned.
23. **Fractions in labels are stacked (owner: "not pi/3 but \dfrac{\pi}{3}").** Any fraction in a diagram label is written \dfrac{a}{b}, never a/b.
24. **Tick labels stay on the side the original uses (and negative x-tick labels sit below the axis, never inside the curve region: owner "-8 and -2 go under and outside the axes here") (owner: "the 0.5 is on the wrong side of the diagram").** When moving a label off a curve (rule 11), move it along its own side of the axis, never across to the other side.
26. **Percentages and areas in normal curves sit inside the region (owner: "write the percentage inside the bell curve, make sure it fits").** Area/probability labels go inside their region at the normal label size; where a region is too thin (tails), keep the same size and use a short arrow from outside (owner: "don't decrease the font size for 2.35 and 0.15 just use arrows for both"). Never shrink a label to make it fit.

### Shading and colour
5. **Shading copies the crop's pattern (owner).** Dotted stipple → `shade dots` (house stipple, visible at small size);
   diagonal lines → `shade hatch`; solid black → `shade solid`; flat grey → `shade`. Never replace a pattern with grey,
   never use crosshatch for dots, never define your own pattern. A region the crop shades must be visibly shaded.
   When the crop's shading is very dark (solid black or heavy grey), use a lighter tone instead (owner: "too overkill"):
   `shade` grey or `fill=black!30`, never solid black for large areas.
5a. **Stipple and hatching are drawn, not patterned (owner: shading invisible).** `shade dots` / `shade hatch` in
   examstyle v4 draw real dots/lines clipped to the region; they replace PDF/SVG pattern fills, which vanish when a
   browser scales the image. Use them with `\fill` or `\path`; `stipple color=black!NN` lightens the dots.
5b. **Labels on shading: no box of any kind (owner: "looks janky", "still a BOX … I don't want that").** Shade the whole
   region, then write the label with `\halo{...}` (examstyle v4): the dots stop in a thin knock-out that follows each
   letter's outline, like the papers. Never `fill=white` nodes and never rectangular holes.
   Exception (owner 24 Nov, on the checker's flags "remove the white outline on the labels"): "yes remove the halos, hand them back":
   2020 Grafton AT4 Q26 (1277_q26_1) and 2020 Hunters Hill AT4 Q26 (1279_q26_1) write their labels on the grey without `\halo`.
   Also 2026 Baulkham Hills AT4 Q5 (1763_q5_1, the -a label), owner 24 Nov on the same request: "yes to this".
5c. **Transparent background.** Diagrams never carry a white background, so they work on dark pages and any paper.
27. **Shading matches the region the question defines (owner: "shading seems wrong").** Compute the bounded region from the question before shading; shade exactly that region.
6. **Black and white only.** Draw coloured originals (blue bars, red lines) in black/grey.

### Tree diagrams
21. **Tree diagrams follow one template (owner: "janky tree, inconsistent position of all elements"; "tree looks diagonal"; "the position of the fractions look weird and inconsistent, same for the lines themselves"; "the probability should be written above / on the line"; "need more space between the third level, 0.4 and 0.7 very close to each other").** Horizontal, left to right; every level the same horizontal distance; branches from one node fan symmetrically with equal vertical gaps, and deeper levels get proportionally more vertical room so no two labels come within a label-height of each other; each probability sits centred at the branch midpoint, ABOVE a branch that goes up or across and BELOW a branch that goes down (owner: "the Cassie W' prob should be below, like Bala W' and so on"), horizontal (not rotated), the same size everywhere; outcome labels at branch ends aligned in one column per level; all branches straight, same line weight.

### Geometry solution diagrams
22. **Geometry solution diagrams have room (owner: "triangle I think is too small, angles and letters and length marking look janky"; "looks cramped"; "this looks so bad, angle marking is wonky"; "the 20 degree angles are not clear here"; "the reflex bearing angle is a little over, it should end when alpha starts"; "missing the marking of the bearing at R. look carefully").** Draw at a size where every label, angle value and tick mark has clear space; angle marks are true circular arcs centred on the vertex that start and end exactly on the two arms (a reflex or bearing arc ends where the next angle begins); small angles get a larger radius or a leader so the value is readable; keep every marking the source or solution shows (bearings at every point).

### Tables and option sets
6b. **Tables drawn as figures must look identical to the crop (owner).** Same header text and line breaks (a symbol
   like (M) under its word), same column order, same empty rows, grey cells shaded grey, same rules/borders. Draw them
   in TikZ (`\matrix` or explicit nodes and lines) at the crop's size, not as an HTML table.
15. **Annuity / interest-factor tables keep the paper's merged cells (owner: "interest rate per period is meant to span the next two cells"; "the number of periods box is meant to merge with the one below it"; "the hollow rows are meant to be the same height"; "period and rate box too tall and wide").** The rate header spans every rate column; the "number of periods" header spans both header rows; body rows are equal height including blank (hollow) rows; the split corner cell is no bigger than its text. Check every span against the source page.
7. **Option sets** (same question, `_1.._4`) are identical in frame, size and style to each other.
8. **Classes:** `photo` → status `keep_crop` (do not draw). `table` → do not draw; transcribe
   `{"rows":[[...]], "header_rows":n, "label_col":0|1}` (cells LaTeX math, words in `\text{}`), status `table`.

Check every redraw against all rules before finishing; say in notes which applied.

## Procedure per figure
1. Read the crop. Classify (graph, geometry, tree, statistical, blank_axes, table, photo, other).
2. Draw it, measuring positions from the crop's pixels.
3. Render, then LOOK at `cmp` AND run overlay.py and LOOK at the overlay. Fix every red/blue pair (misplaced
   line/label) and re-render. At most 2 rounds (owner 12 Nov: usage; he checks every diagram himself): draw, render + overlay, one round of fixes. Target both overlay scores ≥ 0.85; below that is acceptable only
   when the remaining colour is stipple-dot placement, scan stroke thickness, a faint grey grid, or scan noise — say so.
3a. **Label overlap check (25 Nov; owner, relaying the checker: "MOST of the issues in diagrams come from the label overlapping with the graph or with anotehr label. this SHOULD NOT happen on initial draw, check for this specifically.")** After every render run `python3 tools/label_overlap.py <id>`; it must exit 0 (no label within 1 pt of a line, curve, axis, tick, arrowhead or point, or within 1 pt of another label; shading is ignored). Move each label it names (rules 6a/11), never the geometry, and re-run. The import's diagrams step runs it on every new drawing. Existing drawings are not swept (owner 25 Nov, after the --all audit flagged 713 of 4,328: "Nah leave them for the checker to find, that's fine. AS long as we're doing this for futur eimports its fine."): the checker flags old ones as she meets them; fix those through FLAGS.md.
4. Record `status`: `ok`, `approx` (shape could only be estimated: say what), `keep_crop`, `table`.

## Output `/home/claude/pilot/tikz/result_<GROUP>.json`
`{"group":G,"results":[{"id":..,"class":..,"status":..,"rounds":n,"overlay":[orig,redraw],"notes":"…","table":null}]}`
— save after every figure. Final reply ≤6 lines: counts by status and what a human should look at first.

## Scratch
Keep helpers under `/home/claude/pilot/work/diag_<GROUP>/`. Never write to another group's files.

## 12 Nov: table rulings from Decide flags
- "the stem and leaf is not a table, do it as a stem and leaf plot". Any table whose caption starts with "stem-and-leaf" now renders with no grid and one rule between stem and leaves (dtHTML, table.slp).
- "Delivery Time X (days) should be one cell but across two lines". Header cells wrap with \\ where the paper wraps them.
- "interest rate needs to span all columns to the right, time period should be a merged cell". Use spans [r,c,colspan,rowspan].
- "why are some words in the table italicised randomly?". Words in table cells must be wrapped in \text{} (cells are maths mode).
- Q535: the four integrals are a 2x2 layout on the paper, not a table. They are now a display array.
- 25 Nov, checker (2023 William Clarke AT3 Q9): "move hte dollar signs to the left rather than in the center". A body cell whose
  text starts with `\lcell ` is left-aligned (page_src/js/02_text.js dtHTML, class `lft`); use it only where the paper left-aligns.
  Every other cell stays centred.

- **Hand-drawn 3D solids** (owner 12 Nov: "meant to be a prism ... don't be too wonky"). Redraw the solid the sketch means, not the sketch itself. Use oblique view with parallel depth edges and vertical uprights. Keep the sketch's labels and shading.

## 21 Nov: axis labels that would sit on the curve
Owner 21 Nov, on 2022 James Ruse AT4 Q36 (checker, twice: "Try to keep all the xaxis labels on hte same line"; on the true curve the
point (-π/2, -1) and the curve pass where two labels would go): "you decide for the diagram to be usable". Rule from now on: put all
tick labels on one common line (below, or above the axis) when that line is clear of the curve and marked points; otherwise keep the
usual side and move only the labels that would touch the curve or a point to the mirror position above the axis, centred on the tick.
A label never touches the curve, a point or a line.
