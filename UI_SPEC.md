# Questgen page spec: how the review page and bank look and behave

Owner: Steve Yeung. This file holds the owner's decisions about the page (review.html, published at the Questgen artifact). Quotes are his words.

It was started on 12 Nov 2026, after he asked: "are we documenting carefully to ensure nothing gets lost as we continue to develop?". Until then these decisions were only in code comments.

**Rule for every future change:** when the owner asks for a change to the page, add a line here and leave a short `// owner <date>: "<quote>"` comment at the code. Never undo anything listed here without asking him.

**Counts link to what they count (18 Nov).** Owner: "Also it says 9 batches imported (8 cleared review, 1 waiting) · 1,075 papers to go
· 122 batches · 661 new. do these numbers line up? Avoid in this entire app writing hard numbers like this, good practice is to link
it somewhere right?" Every count the page shows must be checkable where it stands: a link (or a click) to the list it counts, or, when
there is no list, a hover title saying exactly what is counted. Counts on one line must add up or say why not. Done first on
Processes › Papers' lane line (waiting → Review; papers to go + big PDFs = the summary's ready; "found after the first scan" titled);
the rest of the page is swept against this rule (Next up note "counts-link").

**Where the page code lives (14 Nov, hardening).** Edit `page_src/`, then run `python3 tools/build_page.py`. Never edit `site/review.html` directly, because it is generated and the next build overwrites it. `page_src/page.html` is the markup, `page_src/css/NN_*.css` is the stylesheet, and `page_src/js/NN_*.js` are the scripts, in load order. `page_src/build.json` lists the order. Each function has one definition: change the function itself, never wrap or redefine it in a later file. The old `site/*.js.txt` / `*.css.txt` files and `tools/patch_*.py` are in `archive/pre_src_1114/` and are not used. The file names below that end in `.js.txt` / `.css.txt` map to these files: exam → 20_exam.js / 08_exam.css, exam_auto → 23_exam_auto.js / 11_exam_auto.css, exams → 24_exams.js / 12_exams.css, mine → 25_mine.js / 13_mine.css, levels → 21_levels.js / 09_levels.css, guide2 → 26_guide.js / 15_guide.css, reports → 27_reports.js / 16_reports.css, schema → 28_schema.js / 18_schema.css, pdf → 29_pdf.js, word → 30_word.js, theme2 → 17_theme2.css.

**No public CDNs (14 Nov, hardening).** MathJax 4.1.3 and its Termes font data, html-to-image, jsPDF, docx, mathml2omml and the web fonts (Inter, Fraunces, IBM Plex Mono, Tinos) are self-hosted in `site/vendor/` and published next to the page. The exact file list is `tools/vendor_manifest.json`, made and checked by `tools/vendor.py`; `tools/build_page.py` refuses a page that names a CDN or a vendor file missing from the manifest. Publish the vendor files once (their `files` map is in the manifest); later publishes keep them. Exception, on purpose: the **Download HTML** file still links the Google Fonts stylesheets, because a relative vendor link would not resolve in a downloaded file.

## Look

- **Name.** The page is "Questgen", not "HSC Advanced Question Bank".
- **Style.** Warm editorial: serif headings and one accent colour per year. He asked: "the fonts I don't really like and it looks really dead".
- **Theme toggle.** Auto follows the device; the choice is stored per viewer. He asked for "a way to change between dark and light mode".
- **Nav.** The tab pill slides between tabs. The side list has no visible scrollbar, and the sidebar stays exactly where it starts so it never shifts.
- **Jobs pill.** A small pill shows running jobs, with details on hover (14 Nov: now two pills, "N running" and "N queued"; see "Processes page" below). He asked: "show somewhere on the artifact things which are running so I know", then "the running now is taking up too much space ... should be a simple pill". Source: db doc `progress/jobs`, written by Claude whenever a job starts or ends.
- **No bar under the header.** He said "is it possible to not have this bar, it looks dumb".

## Bank

- **Approved only.** The bank shows approved questions only, with a switch to show everything. He asked: "Questions aren't showing in the bank until approved right?", then "yeah do that".
- **Home layout.** Year, then focus-area cards, then subheadings with counts, then questions.
- **Topic list motion (13 Nov).** He asked for "smoother animations ... opening/closing should be smooth, clicking between subtopics should be a smooth pill movement".
  - The list is drawn once and updated in place, and areas fold open and closed smoothly.
  - One highlight pill glides to the current subtopic. Its end position is worked out first, so it moves straight away, even while the folds are still moving.
  - If the current subtopic's area is closed, the pill rests on that area's title.
  - The question list fades in. With the device's reduced-motion setting on, all of this is switched off.
- **No arrows; areas never close by themselves (13 Nov).**
  - He asked: "are the arrows really necessary? isn't it obvious if its open or closed?" They're gone.
  - He said: "when moving to another subtopic in another topic, it closes the current one, makes it look forced". Moving to a subtopic only opens its own area. An area closes only when you close it, and areas you opened stay open after a reload of the list.
- **Speed (13 Nov).** He said: "there's some lag when clicking between subtopics".
  - The cause was the maths typesetting: hundreds of milliseconds per batch, which froze the page.
  - Now the topic list moves first and the question list builds a frame later: the first 8 cards at once, the rest in small batches.
  - Maths is typeset only for cards near the screen. Opening the 140-question list went from twelve freezes of 0.3 to 0.8 s to one of about 0.1 s.
  - A loading spinner was considered and rejected: it wouldn't remove the freeze, only decorate it.
- **Expand all / Collapse all (13 Nov).** He asked for "a nice open and close all somewhere for efficiency". Two small buttons sit at the top of the topic list.
- **Highlight fixes (13 Nov).**
  - When the current subtopic's area is closed, hovering its title no longer shows a second highlight ("weird interaction when I close the topic ... and i mouse hover over").
  - The pill no longer lands a row off ("under certain conditions, the sidebar does this"). Its predicted position is measured at the list's real width, and it is corrected once the folds settle.
  - Coming from the home page, the pill appears in place.
- **Dot-point list on a subtopic page (13 Nov).**
  - Its maths renders again; it had broken when cards started being typeset as they scroll into view.
  - The summary says the counts are "questions that use each one (a question can use several)". A question counts under every dot point it uses, so the counts add up to more than the subtopic total. That is intended: filtering by a dot point finds every question that tests it.
  - Dot points with no questions are dimmed.
- **No focus-area pages (13 Nov).** He said "there's almost no point in being able to click on a topic ... should go straight to subtopic?". A card's title is plain text when the area has several subheadings, and it opens the subheading directly when there is only one. The breadcrumb names the area without linking to it.
- **Bank home (settled 13 Nov).** He said: "what I really want I think is an overview of the courses, how many questions in each topic and subtopics and be able to click in, most similar to the original design, just holes everywhere tho". So it stays the original cards: area, count, subheadings with bars and counts, all clickable. They are packed without holes, with each card spanning its own height in the grid (packCards) and short cards filling the gaps. Rejected: masonry with smaller type and one bar scale per year, an index of one row per area, and a tile landing with a permanent sidebar.
- **No tag pills on bank cards.** "I see pills everywhere". The card footer reads "Needs: <skills> · Year N".
- **Skill bubbles removed.** "i dont feel like the skill bubbles work": a question needs several skills, so skills are searchable but don't split a topic.
- **One home per question.** Each question appears under a single subheading (see TAG_SPEC).
- **Same exam filed twice:** the "also in" line is hidden when the copy is the same paper and question number ("the also prose is redundant ... they're literally the same exam twice"). It still shows for a genuine reuse in a different paper.
- **Labels.** Every question shows its QID. The source line is the paper plus the question number.
- **Split questions** (12 Nov). When a question was one part of a larger, unrelated question on the paper, its old letter is removed and its sub-parts move up a level: (i), (ii) become (a), (b), and cross-references follow. The source line keeps the paper's number (Q9(b)). The tool is `tools/relabel_split.py`, and the paper's label is kept in `parts.src_label`.

## Data on demand (14 Nov, Fix 1)
Owner, 14 Nov, approving the plan "Questgen architecture plan: before imports resume": "Ok we should run Fix 1 and 2". Fix 1:
keep the published page small; fetch data only when needed. Imports stay paused.
- **At start** the page loads only the course index (`data/bank/<course>/index.json`: every question without its text), the dot
  points and `data/assets.json`. Never `data/bank.json` (still built for the tools until it is dropped from the publish set).
  Counts, `bankStats()`, the Bank home, Review's tracks and counts, the exam generator, Difficulty and the Guide's numbers run on
  the index alone.
- **Question text** (stem, parts, options, solutions, figure lists, redraw notes) is in one file per topic home
  (`data/bank/<course>/<topic>.json`). It loads when a view shows the question: opening a Bank topic, a Review paper (all its
  questions as the paper opens), an exam preview (its questions), the Exams list (the cards shown). The first search, in the Bank or
  the Exams list, loads every topic file once, because search reads the text.
- **While it loads** the Bank shows "Loading questions…" under the topic heading, and any other question shows "Loading
  question…" in place; it fills itself in. A file that fails after 3 tries shows "This question did not load" with **Try again**.
  Review redraws the whole question when its text lands (its buttons are bound when it draws).
- **Images** (page images and figure crops `data/img/<paper>.json`, redraws `data/svg/g<n>.json`, overlays `data/cmp/g0.json`) are
  fetched from the address `data/assets.json` gives (the artifact's asset store), else from the published file as before.
- Code: `QG.need / QG.pending / QG.fill / QG.url` in 01_core.js; build: tools/bank_split.py (called by build_bank.py); upload:
  tools/asset_upload_plan.py and tools/asset_manifest.py (IMPORT_PLAYBOOK "Asset store"). Page test: the `data:` checks.

## Review

- **Four steps, in order:** Decide, Check, Spot-check, Diagrams, plus Tags when there are any. He said "way too many pills, not sure what I'm meant to check and in what order". *(Order and names superseded by the 13 Nov answers: Your calls → Flagged → Topics → Diagrams → Spot-check, walked one paper at a time. See "Review: Inbox and one paper at a time".)*
- **Keys.**
  - One question per page.
  - K goes to the next question.
  - A approves and moves on at once, without waiting for the save ("why doesn't approving auto next").
  - Number keys switch steps ("let me press the numbers on my keyboard"). (In the code the numbers pick a diagram in Diagrams and 1 / 2 in Topics; since 13 Nov the steps are switched on the paper's track.)
- **Flagging.** F opens a one-line box; type the reason and press Enter to send, or Esc to cancel. An empty reason is refused. This matches the diagrams step.
- **Check and Decide show the full page,** with the question as it will appear next to the source page. The cropped side-by-side view was tried and rolled back: "so much worse and unusable". Don't bring it back.
- **Recently approved.** Newest approvals first, and F re-flags from there. He said "I need a list of recently approved in case".
- **Approving whole papers.** "Papers ready" in the Review header approves every paper whose spot-check is clean. He asked: "where do i go and batch approve the rest?". (13 Nov: the banner sits in the Inbox's Papers card; each paper's Spot-check step also ends with "Approve the other N questions in this paper".)
- **Diagrams.**
  - Riskiest types come first.
  - The counter names its unit ("why does my diagram review say 468").
  - Flag one diagram, and flagging some approves the rest on the page.
  - High-confidence types are spot-checked, one per paper.
  - "N flags waiting for Claude" turns amber at 15.
- **Hidden duplicates** never count in any queue ("they are misleading").
- **Tags step.**
  - Only the question, its tags and collapsed solutions.
  - The owner picks the topic, not the gates ("I don't feel like I can accurately choose the gates").
  - A Y11/Y12 picker for when both suggestions are wrong ("If its both wrong, I should be able to pick from a Y11 and Y12 list").
- **Solutions** are always visible somewhere for checking ("u need to show solutions somewhere so I can verify it").
- **Papers page.** It has filters, and there is one compact row per import batch ("each batch takes so much vspace ... find a way to collapse"). *(13 Nov: the Papers tab is superseded, "Merge into Review": the list is Review's papers section, `#review/papers`, with the same filters and columns plus a review track.)*
- **Guide tab.** It explains how questions are tagged, with live examples.

## Rendering text and tables

See also the table rules in IMPORT_PLAYBOOK.

**Text**

- **Tall integrals** (owner 13 Nov, QID 1205): "integrals which contain dfracs or are tall should use \displaystyle \int". The Termes maths font's display integral is barely taller than the inline one. So in display maths, and in inline maths with \dfrac, \left or an array, \int is drawn with an enlarged sign that spans the fraction (a MathJax preFilter in the page). Plain inline integrals are untouched. Source text is not changed, so worksheet exports keep real LaTeX.

- Text formatting outside maths renders properly: `\textbf`, `\textit`, `\underline`, `\text`, `\%`, `\&` (QID 889, 933).
- Dot-point lists render as lists. Boxed text renders as a box ("option 1 and 2 should go in a box just like the question").

**Multiple choice**

- The MCQ answer gets a badge, never bold ("why is D randomly bolded").
- The option letter and its full stop never split.
- The criterion is always just "Correct answer".

**Tables**

- Nothing protrudes from a cell, and no word is split ("make it so that the word is not split up").
- A wide table shrinks (down to 62%) instead of scrolling.
- The label column is centred.
- Empty cells are never shaded.
- Headers wrap only where the paper wraps them.
- Columns are equal width only in number tables.
- Split corner cells look like the paper ("table needs to look identical with that split down the cell"). Keep the period/rate box small.
- A stem-and-leaf plot renders as a plot ("the stem and leaf is not a table").
- Captions use LaTeX text mode ("I can see \textbf in the table heading").
- Solution diagrams Claude drew have no original to compare against, so they are shown alone ("I cannot see the x-axis").

## Exam builder (stage 1, 13 Nov)
He showed his own HSC exam maker and asked "can we implement something like this on this artifact?", then said "yeah do that".
- **Adding questions.** Every bank card has "+ Add to exam". The header has an **Exam · N** pill that opens a side panel with:
  - title, subtitle, school, working time and reading time;
  - the questions in Section I (multiple choice) and Section II, with ↑ ↓ × to reorder and remove;
  - Preview paper, Marking guide, Save exam (stored in the page database, collection `exams`, so the team can reopen it) and New exam.
- **The paper.**
  - A4 sheets, laid out automatically.
  - A cover page with the school, title, name/teacher/class/date lines, mark boxes, and HSC-style general and section instructions.
  - Section II starts on a new page. Questions are never split unless a question is taller than a page; then it breaks between parts and later pieces say "(continued)".
  - Answer lines: 3 per mark, between 3 and 24.
  - Diagrams are at print size, capped at 70 mm high, and never inverted for dark mode.
  - Each question carries a small source line (paper, number, QID).
- **The marking guide.**
  - A Section I answer key, then the worked solution under every part.
  - For multiple choice, the correct option is highlighted and the solution follows the options.
  - Internal notes ("Check this", "Corrected from source") are left out.
- **Printing.** The artifact cannot print, so **Download to print** saves a stand-alone .html (downloads capability). Open it, then print or save as PDF; each sheet prints as one A4 page.
- **Logo (13 Nov).** He asked for "a clean and classy questgen logo". The wordmark is Questgen in Fraunces 600 with a custom Q whose tail is an integral sign; the Q is in the accent colour and "uestgen" in ink. Files are in brand/ (SVG, light, dark and ink versions, plus a square icon).
- **Next.**
  - Stage 2: auto-generate from topics, marks and difficulty, with fluency/problem-solving split. This needs the difficulty run.
  - Stage 3: worksheets.

## Difficulty check (14 Nov)
He said: "Make it both desktop and mobile friendly, I might want to approve on the go today". This is the review screen for the HSC reference ratings (DIFFICULTY_SPEC.md).
- **Where.** A **Difficulty** tab (`#levels`). On a phone the tab row scrolls, and the open tab is scrolled into view. (15 Nov: now the Difficulty step inside Review, `#review/difficulty`; see "Teach | Curate split".)
- **Order.** Thin topics first (Exponential and logarithmic functions, Trig identities and equations, Sequences and series), then one topic at a time from a dropdown, then the 9 parts flagged by the audit.
- **One part at a time.** The whole question shows, with the rated part highlighted and the other parts dimmed. Solutions start collapsed. Each card also shows:
  - our band, label and reason;
  - how many other parts were rated against this one.
- **Action bar.** Sticky at the bottom and clear of the phone's home bar, with 44–48 px targets:
  - band buttons 2–6;
  - Fluency / Problem solving;
  - one big button that reads **Agree**, or **Save change** once something differs;
  - previous and next.
  - Saving moves on at once, without waiting for the save, just like approving in Review.
- **Keys.** 2–6 set the band, F and P set the label, Enter or A saves, J/K and the arrow keys move between parts.
- **Storage.** Decisions are stored in the page database, collection `difficulty`, one doc per part id: `{band, wm, status: agreed|changed, orig_band, orig_wm, by, at}`. "To check" hides the parts already decided; "All" lets him revisit them.
- **Spot-check (14 Nov).** He finished the thin topics with 19 of 19 agreed. I advised spot-checking instead of all 288 remaining references, and he said "Yeah let's do that". The dropdown option **Spot-check** holds 42 parts:
  - the 9 parts the audit flagged, shown first;
  - in each of the other 11 topics, the 3 references that the most other parts were rated against.
  - When it is finished, the page names any topic with two or more changes, to be checked in full. If there are none, the ratings stand.
- **Next (Claude).** Read the `difficulty` collection. A changed reference shifts the parts that point at it (nearest_anchor) by the same amount, then the bank is rebuilt.

## Phone layout (14 Nov)
He said: "Currently on mobile, more than half the screen is just the top bar, make it more space efficient, it'll have to be some pop up or side bar right?" This applies at 640 px wide and below; the desktop is unchanged.
- **Header.** One row: the logo, a menu button that names the open tab (Review ▾), and the Exam pill. The menu drops down with every tab, with its count, plus the theme. It closes on a tap outside or Esc. The question count beside the logo is hidden.
- **Review bar.** One row of steps that scrolls sideways, without the step numbers. Under it, one row with the paper picker, the position and ← →. The step explanation is hidden on phones.
- **Effect.** On the Review tab the top bar went from about 525 px of an 844 px screen to 146 px; on the Difficulty tab it is 53 px. The Bank keeps its search box on a second row (98 px).

## Exam builder stage 2: auto-generate (14 Nov)
He said: "can you begin building stage 2 of the exam builder in the background please? The one where it's an automatic one." The code is in page_src/js/23_exam_auto.js and page_src/css/11_exam_auto.css (was site/exam_auto.js.txt / .css.txt plus tools/patch_exam_auto.py).

**Auto-generate block** (top of the Exam drawer, folds away)
- **Topics.** A Year 12 / Year 11 list of focus areas, each one opening to its subheadings, with checkboxes and question counts. There are All, Select all and Clear buttons.
- **Settings:**
  - total marks: 50, 70 or 100, or any other number;
  - multiple-choice count: defaults to a tenth of the total (10 of 100, HSC style) until he sets it himself;
  - difficulty: Easier, HSC-like or Harder;
  - a fluency / problem-solving slider, by marks (default 70/30);
  - Approved questions only (on by default);
  - Skip questions used in my other saved exams.
- **What the bank has.** A strip shows how many questions and marks match, and how many multiple choice, with a small chart by band. It updates as topics change.

**How it picks**
- HSC-like means the band mix, by marks, of the HSC questions in the chosen topics; if those topics have too few, it uses all HSC questions. Easier and Harder tilt that mix down or up.
- Each focus area's share of the marks follows its share of the matching questions (proportional to the bank, not even).
- The generator is seeded: it fills greedily, then makes about 900 improvement swaps. Exact total marks and the multiple-choice count are hard targets; band mix, problem-solving share and topic spread are soft. It takes about 30 ms.
- Never duplicates, never the same question twice, no old-syllabus or Standard-course questions.
- Each section is ordered easier to harder.

**After generating**
- It fills the exam list, so Preview, Marking guide, Save and Download work unchanged.
- **Regenerate** uses a new seed and the same settings. Generating over a hand-built exam asks for a second press.
- Each question row has:
  - **⇄ Swap:** the closest alternative not already in the exam. It prefers the same subheading, then the same marks and band, and won't swap back to a question it just swapped out.
  - **Lock:** Regenerate keeps the question.
  - Its band added to the row's details.
- **This exam:** bars of the band mix against the target, the marks and the fluency / problem-solving split, plus plain-English notes when the bank can't meet the target ("Fewer hard marks than targeted … Only 2 band 5+ questions in …").

**Bank cards**
- The footer reads "… · Year 12 · Band 4 · Fluency" (plain text, no pills). A half band shows as "3–4".
- The Bank filter row gains **Band** (2–3 / 4 / 5–6) and **Kind** (Fluency / Problem solving / Mixed).

**Not done in stage 2**
- The auto settings are kept per browser (inside the qg_exam local copy). Saving an exam to the database stores its questions, not the settings.

## Exams page (14 Nov)

The owner said: "Making the exam should be on another page, and it should operate similar to the html file I gave you" (his HSC Advanced Exam Maker). He chose a new tab in Questgen, with all of: Setup page, Preview + grading panel, Edit on the paper, and Pick by hand. **This page replaces the exam drawer** from stages 1 and 2. The header pill "Exam · N" now opens the page, and "+ Add to exam" on bank cards still adds to the same exam.

- **Tab.** **Exams** (`#exams`) sits after Bank, in the header and in the phone menu. Two views: **Exam setup** and **Pick by hand**, plus a full-screen preview.
- **Exam setup** (as in his exam maker):
  - Topic tiles for Year 12 and Year 11. Each tile has a tri-state box; open it to pick subheadings. There is Select all / Clear per year and in the selection bar ("N subtopics chosen · M questions match").
  - Settings column:
    - title, which defaults to an automatic title such as "Integral calculus";
    - total marks, 10–100;
    - multiple choice, 0–10;
    - papers to draw from: NESA HSC / Trials / School exams;
    - approved questions only;
    - skip questions used in my other saved exams.
  - Difficulty:
    - an overall slider that moves both of the sliders below;
    - the fluency / problem-solving split, with a split bar;
    - separate fluency and problem-solving difficulty sliders on the band scale 2–6.
  - "What these topics can supply": a table of the marks available by kind × band. The target cell is outlined, and warnings say when the bank is short.
  - **Generate exam** opens the paper. The result line has Open exam and Swap questions.
  - The generator is stage 2's seeded greedy fill plus improvement moves. Its cost function now aims at separate fluency and problem-solving difficulties.
- **Pick by hand:**
  - Topics on the left.
  - Search and filters in the middle: paper, type, marks, band, kind, sort (including easiest/hardest first), has a diagram, and hide questions already in the exam. The question cards are the Bank's cards. "Add 5 at random" and "Add all shown" are there too.
  - The exam panel on the right: fields, Section I/II, Swap ⇄, Lock, ↑ ↓ ×, preview, guide, save, new and saved exams.
  - On narrow screens the side columns are drawers (Topics, Exam · N).
- **Preview:**
  - Toolbar: Exam paper / Marking guide, Grading, Back to setup, Fit pages, Regenerate, Swap questions, Download to print and Close.
  - Grading panel:
    - fluency and problem-solving mark totals with their average bands;
    - one row per question with its kind, a band meter and its marks; reorder by dragging or ▲ ▼;
    - a row opens to show its parts (marks, kind, band), the rating reasons and Swap.
    - Clicking a question on the paper selects it. On phones the panel slides over the paper and starts closed.
  - **Fit pages** works as in his exam maker. Nearby questions (up to 3 places, within a section) move forward so that a page isn't left mostly empty. It runs once after Generate and whenever pressed.
  - On phones the sheets are scaled to fit the screen.
- **Edit on the paper:**
  - The cover's school, course, title, reading and working time, and each general instruction are editable; click to type, then Enter or click away to save. There is also "+ Add an instruction".
  - Every written part has − / + answer lines (0–40, default 3 per mark).
  - Every diagram has − / + / reset and a corner handle to drag (30–200%). (14 Nov, QUEUE #2: the − / + / reset pill is gone; drag the corner, see "Diagram resize by the corner".)
  - Edits are kept in the exam (`EX.instr`, `EX.lines`, `EX.figscale`). They are in the download, without the on-screen controls.
- **Cover:** a "Marks by topic" table, with each focus area's question numbers, Section I/II marks, total and a score column.
- **Saving:** a saved exam now keeps the settings, answer lines, diagram sizes, instructions and locks. Opening a saved exam restores all of them.
- **Not carried over:** his "Flag a wrong grade" form. Ratings are changed on the Difficulty tab.

## My exams (14 Nov)
He asked "Is there a place to manage created exams?", then said "Yeah do that".
- **Where.** A third view on the Exams page, beside Exam setup and Pick by hand, listing every saved exam (collection `exams`; everyone with access sees the same list).
- **Each row shows:**
  - the name, title and school;
  - marks, number of questions with the multiple-choice count, and the fluency / problem-solving split;
  - when it was saved and by whom;
  - a warning if some of its questions have left the bank.
  - The exam that is open now is marked.
- **Actions:** Open, Preview, Duplicate (saved as "… (copy)"), Rename (inline; Enter saves, Esc cancels) and Delete (asks "Delete for everyone?" first). Search by title; sort by newest, oldest or title.
- **Unsaved work is never lost silently.**
  - The Exams page head shows ✓ Saved, Not saved or Unsaved changes, with a Save button.
  - My exams shows a banner when the open exam isn't saved.
  - Opening another exam or starting a new one while there are unsaved changes needs a second press.
  - Generating an exam does not save it.
- **Phone menu button.** It no longer shows the Review count beside the tab name ("Exams 935" read as a number of exams). Counts stay inside the menu.

## Header: Exam button removed (14 Nov)
He asked "Is there a point in having the exam button on the right and also the exams pill on the left?". There isn't: since the Exams tab arrived, the button only opened that tab. The button is gone, and its count is shown on the Exams page head ("This exam: N questions · M marks"). Adding a question from the Bank still shows a toast.

## Import batches as a stage grid (14 Nov)
He said "I don't like the Parse -> Load -> Tag prose... It's not very clear and requires too much reading". The sentence is gone.
- Each batch group shows column headings once: Parse, Load, Tag, Format, Write, Diagrams, Check, Live. Hovering a heading shows the full name.
- Each batch row has a mark under each heading: ✓ done, – not needed, dashed circle waiting, spinner running, ! problem.
- One short line remains: "Tap a batch to see its papers. – means the stage wasn't needed."
- On phones the grid scrolls sideways inside its box.

## Guide rewritten (14 Nov)
He said: "We need to rewrite the guide tab... 1. How questions are categorised. This will cover difficulty and topic. Use visuals and avoid heavy prose and voice. and 2. an explanation of how the system stands and how to migrate it to live servers."
- **Part 1: categorising.**
  - **Topic:** the syllabus hierarchy with live counts; the three tag types; a filing diagram (parts → marks per subheading → home, tie → later part); the filing rules in one line; questions per focus area as bars. The full rules are folded away.
  - **Difficulty:** the band 2–6 scale, the anchoring chain (HSC references → other parts → your checks → shifted parts, with live numbers), the question-band calculation, and marks by band.
  - **Fluency / problem solving:** two columns of signals plus the bank's live split.
  - **Examples:** each with a part table (marks, dot point, band, kind).
- **Part 2: the system.**
  - **Today:** the pipeline as a flow, four stores (questions.db, page files, page database, Drive backup), and the limits.
  - **Going live:**
    - copyright as the blocker;
    - a target architecture diagram;
    - a Today → Live table;
    - 7 steps;
    - managed vs own-cloud hosting.
- **Examples (14 Nov).** He said: "show the question first. then explain how it was tagged." Each example opens to the question (solution folded), then "How it was tagged", then the part table and where it is filed. The first example starts open.
- **Two subpages (14 Nov).** He said: "Split the guide into two subpages, one for the first 4, and the second for the last two for developers". A switch at the top: **For users** (renamed from Categorising, owner 14 Nov: "Change the categorising to For users") (Topic, Difficulty, Fluency / problem solving, Examples) | **For developers** (The system today, Going live; numbered 1–2). The choice is remembered per browser.
- **Data model (14 Nov).** He asked to "Show a visual of our db schema and how everything connects". The developer page gains "2 · Data model": an SVG diagram (page_src/js/28_schema.js, was schema.js.txt) with the 11 SQLite tables and their key columns and counts. Solid lines are foreign keys; dashed lines are links outside SQLite (the page database, dotpoints.json). bank.json is shown as built from all tables. Only the main links are drawn; secondary links are written beside the column. "Going live" is now section 3.
- **Style.** No "we" or "you" voice: labels, numbers and diagrams. Code: `page_src/js/26_guide.js` / `page_src/css/15_guide.css` (was guide2.js.txt / guide2.css.txt; the old v1 renderGuide is gone).

## Exams page, paper and reports polish (14 Nov)

Owner, 14 Nov: "Questgen is buns, make it more sophisticated. ALSO remove Skip questions used in my other saved exams for now. the side bar UI also looks a bit cartoonish. It should all feel clean and sophisticated. The cover page TOPIC is too wide, the questions are far too cramped. Also the cover page does not look super professional. Additionally, the year (HSC or Preliminary) and the course Mathematics Advanced should be on separate lines. Also in marking guidelines, MCQ highlights are often too close and touching the answer. Also why are there two vertical lines next to every worked solution? Also since this is currently in alpha, it would be good to see each question's dot point somewhere in the exam paper page and an ability to report this question for wrong difficulty, wrong dot point and have it come up in a new review tab."

When this is merged into UI_SPEC.md, these lines replace or amend the matching ones in "Exam builder", "Exams page" and "My exams". Nothing listed in UI_SPEC is undone.

## Exam setup ("the side bar UI also looks a bit cartoonish")
- **Settings column.** One panel with hairline dividers between Exam, Difficulty and Supply. It replaces the filled, rounded cards. Radii are 6 to 8 px, and section labels are small and quiet.
- **Sliders.** A 4 px track and a 14 px knob with a soft ring. The fluency and problem-solving sliders keep their colours and have a small swatch beside the label.
- **Split.** The split slider is neutral. Under it, a thin two-colour bar with the legend "Fluency 70% · Problem solving 30%" replaces the fat labelled bar.
- **Difficulty labels.** These read plainly, "Band 4.2", and the slider ends read "Band 2" and "Band 6". "Foundation / Developing / Solid / Strong / Band 6 challenge" are gone everywhere on this page.
- **Papers to draw from.** A hairline segmented multi-select: NESA HSC | Trials | School exams. It replaces the mint pills.
- **Skip questions used in my other saved exams: removed for now.** The checkbox is gone, and `exA()` forces `A.avoid=false`, which also covers Swap and old saved exams. Opening a saved exam also sets avoid to false.
- **"What these topics can supply".** A small-multiples grid with hairline cells, tabular numbers and a light tint by size. The target cell is outlined in the accent. The caption reads "Marks available at each band" and, on the right, "Your target" with an outlined swatch. This fixes the run-together "bandOutlined".
- **Generate.** A modest button with "or pick questions by hand" beside it. It always reads "Generate exam" (or "Generate a new exam"). With no topics it is disabled, and a hint says "Choose at least one subtopic to generate". The old full-width "Choose topics to generate" is gone.
- **Topic tiles.** 1 px borders, 8 px radius and a real 16 px checkbox. The chevron is a thin caret with no circle. Subtopics are a quiet checklist with right-aligned counts instead of mint pills.
- **Exam setup / Pick by hand / My exams.** A hairline segmented control; the selected view uses accent-soft.

## Cover ("does not look super professional"; certificate and course on separate lines)
- **Order, left-aligned under a heavy top rule:**
  - the school, in small spaced capitals;
  - the certificate: "Higher School Certificate", or "Preliminary" when every question is Year 11 (`qYear`). It is editable (`EX.cert`). Clearing it, or typing back the automatic value, returns it to automatic.
  - the course, "Mathematics Advanced", large serif;
  - the exam title, smaller serif.
- **Below the title:**
  - a hairline rule, then Student name / Teacher / Class / Date as small-caps labels on hairlines;
  - a stats row between two rules, with hairline dividers: Total marks · Section I (marks, n questions) · Section II · Working time.
- **18 Nov changes (owner).** "Also here, the 100 marks, section I and II and working time is redundent because its below. Also remove
  the student name, teacher name, class and date. Just put in the top right in a sensible spot the Name: and Tutor: and also find the CMC
  education logo in our drive and add it in instead of saying CMC education": the stats row and the four name lines are gone; the top
  row is the CMC logo ("CMC Logo Black.svg", CMC Resources drive, read only; shown while School is "CMC Education", any other school
  shows its name) on the left and Name: / Tutor: lines on the right. The two bullets above are superseded.
- **Exam maker, 18 Nov (owner, verbatim):** "attach an advanced reference sheet at the end for students. This should be an extension 1
  or 2 one or a standard one when we do more courses later so plan for that." / "is the auto attach z score table working?" / "it's very
  important marks by topic is on the cover page and the back of the first page is intentionally blank. add a note in the centre of the
  page." / "In the PDF output, remove the school name, just the qid for each question." / "Also why does the question text not line up
  with the 1. ? this is for ALL MCQ" / "Can u use this font for all parts of the exam? its the same one as the questions".
  - Reference sheet: each course lists its NESA sheet pages (`QG.courses[course].ref`, images in data/ref/; Drive ids for MA, ME1, ME2
    and MST in state/work/ref_sheets.json); they are the last pages of the paper, after the z-score table.
  - Marks by topic never leaves the cover: its type steps down to 6.5 pt, then the cover scales to fit. Page 2 is blank with "This page
    is intentionally left blank." in the centre; Section I starts on page 3.
  - The paper's source line is the QID only (preview, PDF, Word, HTML); the marking guide keeps the source.
  - MCQ: the stem's first line sits on the number's line. Every part of the paper (cover, headings, option letters, marks, footer, Word)
    uses the question font.
  - z-score table: 4 questions pointing to it had never been marked (2 from Batch 10); batch_check now blocks such a question.
- **Cover and paper, 18 Nov evening (owner, verbatim):** "remove the top black line, remove the footer on the cover page, bottom align the
  table (put it towards the bottom of the page) and remove marks by topic text, that's pretty intuitive. Give an option to toggle that
  table on and off. instead of 1/28 write Page 1 of 28. I think the i on each question is useless. Remove it. just put the report button
  as a text which changes on hover next to the qid. much more intuitive right?" Done: no top rule; the cover has no footer (Word: a blank
  first-page footer); the table sits at the foot of the cover with no heading; "Topic table" in the preview toolbar turns it on and off
  (saved with the exam as `bytopic`); footers read "Page n of N"; the ⓘ card is gone (supersedes the 14 Nov "the i is fine"): the source
  line ends "QID 0202  Report", grey, accent and underlined on hover, "Reported (n)" when reports are open, opening the report form.
  Dot points, band and kind stay in the grading panel.
  Owner 18 Nov: "can u actually put the report on the right bar as well? the grading bar as well": the grading panel's question detail
  has Report (or "Reported (n)") beside "Swap for a similar question", opening the same form.
- **Question layout, 18 Nov (owner, with a sample paper: "can u make the format of questions like this").** Written questions: "QUESTION 4
  (4 marks)" in bold capitals with the marks beside it and no rule under it; "(a)" in plain type; each part's marks "[1]" at the right;
  dotted answer lines (Word the same). Multiple-choice keep their bold number. The font stays the question font (Tinos/Times, 18 Nov
  ruling); the sample is set in Computer Modern (LaTeX).
- **Section headings, 18 Nov (owner, NESA sample: "Header for section 1 and 2 above", then "Also put a little more space between the
  dotted lines of a part and the prose of the next part").** Each section starts "**Section I**" (large, bold), then "15 marks",
  "Attempt Questions 1–15", "Allow about 25 minutes for this section" on their own lines and a rule under them (the marking guide leaves
  out the time). Answer lines are followed by 5 mm before the next part (1 mm margin + 4 mm padding, so page measuring counts it; Word: 14 pt).
- **Exam maker, 19 Nov (owner, verbatim):** "It is very easy to override a current exam, too many outs and ways to replace the questions
  accidentally" / "There is no way to see if a question has been used by a previous exam, might lead to duplicate exams" / "I have no idea
  what fit pages does, back to setup seems like it serves the same function as close." / "HSC Adv averages 1.8 minutes per mark. Should be
  a place to change that too or custom set time like the coer page already does which is good" / "Can't tell when the exam is actually
  saved." / "General confusion navigating between setup, pick by hand and my exams, can't tell which exam we're inside or if we're making
  a new one etc." Asked: saving "Save by itself"; Fit pages "Remove it"; used questions "avoid them but if used, should show WHERE in the
  past they were used". Done:
  - Every Exams view shows "Editing: <name> · ✓ Saved 8:36 am" (or "New exam", "Saving…") with Save as a copy and New exam. Any change
    saves itself about a second later (EXAS, 25_mine.js); New exam and Save as a copy are the only ways to start another exam.
  - Generate and Regenerate on a saved exam ask first: "Make a new exam instead" / "Replace them" / "Cancel". The exam panel's own list
    of saved exams (one click replaced the open exam) is gone: exams open from My exams. Deleting the open exam leaves an empty new exam.
  - "Skip questions already in my saved exams" is back in Setup and ticked by default (supersedes 14 Nov "remove Skip questions used in
    my other saved exams for now"). A question that is in another saved exam says where: "Used in Mia Advanced Mock Exam (17 Nov) and 1
    more" on Pick by hand cards, the exam panel and the grading panel.
  - Working time = marks × minutes per mark (1.8 by default; "Minutes per mark" in the exam panel), to 5 minutes, until a time is typed
    (then "Work it out from the marks" goes back). Exams saved before 19 Nov keep their time.
  - The preview toolbar lost Fit pages (and the automatic reordering after Generate) and Back to setup; Close stays.
- **19 Nov (owner): "Dot points don't line up"**: the section headings in the cover's marks block start at the column edge and their bullets
  line up with the general instructions' bullets. **"The exam should always have an odd number of pages so no nothing is printing on the
  back page, add an intentional blank marked page where needed"**: an exam paper with an even page count gets "This page is intentionally
  left blank." after its last question page (the z-score table and reference sheet stay last). The Word file paginates itself, so this
  holds for the preview, PDF and HTML download only.
- **19 Nov (owner): "math should render properly in the grading tab"**: the grading panel's "Why it was rated this way" lines (plain text
  from the rater) show powers as superscripts, sqrt as √, Greek names and ≤ ≥ ≠ as symbols (exMathText). **"Also swap for a similar
  question is just INSTANTLY replacing it. shouldn't it give options? ... Or they can choose anotehr and the hand pick questions can pop
  up with teh chosen exam topics?"**: Swap (⇄ in the exam panel, "Swap for a similar question…" in the grading panel) opens a chooser
  with the 6 closest questions in full (same dot point first, then same topic, marks, band, kind; "Used in" tags), "Use this", "Show 6
  more", and "Browse <subtopic> in Pick by hand". No vector database: for an exam, similar means the same skill, size and difficulty.
  Owner 19 Nov, after the first fix: "Are you sure the math renders properly? I'm still seeing incorrect in dot points and why it was rated
  this way": the grading panel's dot points use their official LaTeX wording (dotpoints.json "tex"), and each maths-looking word of a
  reason is converted to LaTeX (exMathTeX) and typeset by MathJax. "why is ti always 628 questions?": the chooser's count was every
  question of the type that fits the settings; it now says "N with the same dot point · M in "<subtopic>" · K in this exam's topics".
- **19 Nov (owner): "don't you think that questions which contain PS and UF should just be PS?" -> "yeah that's fine go for it"**: a question
  with any problem-solving part is labelled Problem solving (badges, grading list, report form) and found by the Problem solving filter
  in Bank and Pick by hand; "Mixed" is gone. Marks still count part by part (generator targets, grading totals, the Guide's split).
- **19 Nov (owner): "do u think its valid for band 3 fluiency to come after band 3 problem solving?"**: Generate / Regenerate order each
  section by the band the meter shows (rounded), then fluency before problem solving, then fewer marks first (before: the exact band, so
  a 3.4 fluency question followed a 2.6 problem-solving one although both showed band 3). Hand-made orders are kept.
  Owner 19 Nov: "it's still like this in TRIAL EXMINATION test sy" (an exam made before): the grading panel has "Sort easiest first",
  which puts the exam's own questions in that order without regenerating.
- **Picker, 19 Nov (owner, verbatim):** "the pick by hand page feels initially redundant since the questions are auto chosen and you can't
  really see the question list, only its source there. it feels more like a worksheet feature" / "you might want to replace a question with
  another which isn't similar but is from the same topics as the exam. Need that somewhere too." Then: "for 1. worksheet yes but gray it,
  lets build it later, the picker should be the primary interface for that, for the exam builder, it shouldn't be. It should just generate
  the exam and land you in teh page preview. from there, in the grading list you should be able to add a new question to the exam which
  pull up a reduced list question picker. for 2. Use B". Done:
  - The Pick by hand tab is a greyed "Worksheets (later)" tab; Generate lands on the paper; an exam opened from My exams opens on its paper.
  - The picker (EXPK) opens only from the paper: "+ Add a question" (the Questions panel; since 19 Nov no longer in the paper bar or Setup's result card) or "Replace…"
    on a question (grading detail; also "Pick any question from this exam's topics instead" in the Swap chooser). It lists only the
    exam's topics (all topics while the exam has none), hides questions already in it, and gives each card one action: "Add to the exam"
    or "Replace Q14 with this". Replacing returns to the paper with the new question in the old one's place; adding stays until "Back to
    the paper". Lock moved into the grading detail beside Swap and Replace. Asked whether to keep Lock, owner 19 Nov: "keep lock".
  Owner 19 Nov: "in the replacing page, its good to show to show the question you're replacing, even if its a click to expand. Also the top
  bar looks jank with the replace Q1 with this. Also should be able to report a question you see here / from the bank": the banner has
  "Show Q1" (the question in full, on click); "Replace Q1 with this" sits in each card's header row; every question card (Bank, picker)
  has Report, opening the report form.
- **Exams structure, 19 Nov (owner, verbatim):** "isn't it a bit awkward to have a worksheet builder integrated into the exam one? maybe we
  should split it? thoughts? because the only time they're using the pick list is really for workehet or replacement question. Also when you
  press add a question, isn't preview paper and return to paper the same?" To the three proposals (Worksheets its own top-bar item; no
  "+ Add to exam" on Bank cards; worksheet use counts as "used before"): "1. yes 2. yes 3. hm they should see that its been used for now
  yes." Then: "Also should we really be able to go back to exam setup once the exam has been set up? It feels counter intuitive and you
  canot really tell if you're in an exam or not already. do u know what i mean", and "yes, remove redunant features. However, tutors should
  be able to make similar exams if studnts need another one. Find a way to work that in intuitively." Done:
  - Worksheets is a greyed top-bar item ("Worksheets later"), not a tab inside Exams. Bank cards have no "+ Add to exam" (Report stays).
    Worksheet use counting as "used before" waits for the Worksheets build (Next up note).
  - Exams has no tabs. It opens on My exams; "New exam" opens Setup (titled "New exam", with Cancel); Generate lands on the paper; Close
    (or Escape) returns to My exams. There is no way back to a blank Setup from inside an exam.
  - On the paper, "Settings" reopens the setup form for this exam (titled "Settings for “name”", with "Back to the paper"); its button says
    "Regenerate with these settings" and asks before replacing the questions. The separate "Preview paper" button is gone (the picker's
    "Back to the paper" is the one way back). "Save as a copy" and the identity bar's "New exam" are gone (Duplicate in My exams covers a copy).
  - **Make a similar exam** (paper toolbar, and "Make similar" on each My exams row): a new saved exam with the same settings (topics, marks,
    multiple choice, difficulty, papers; topics from its questions when it has none), none of the questions in any saved exam (the
    original included), named "<name> (version 2)" (3, 4 ... when taken), opened on its paper. The original is untouched.
- **Paper bar, 19 Nov (owner):** "this is a really heavy top bar" (ten buttons), then "lets go 5 controls": Grading; **Exam ▾** (Settings…,
  Regenerate, Topic table on the cover as a tick); **Make a similar exam** (kept visible: the tutor-facing one); **Download ▾** (PDF, Word
  (beta), HTML); Close. "Add a question" left the bar: it is at the top of the grading list. A menu closes on a pick or a click outside,
  except Regenerate (its "replaces the questions" question opens inside the menu) and the Topic table tick.
- **Questions panel, 19 Nov (owner, verbatim):** "I need a button to delete a question from an exam in the question grading. Also can we
  call it something else, its just a list of questions right? Should it even be togglable? It seems like it should always be there". Done:
  the panel is titled "Questions" (it still carries the fluency / problem-solving marks, bands and dot points). On a wide screen (over
  1000 px) it is always beside the paper: no toggle button and no Hide. On a phone the paper needs the full width, so there it stays a
  slide-over opened by the "Questions" button. Each question's detail has "Remove from exam"; the panel then offers "Undo: put Qn back"
  (same place) until the paper is regenerated or reopened. Setup's result card lost its "Open exam" / "Add a question" buttons
  (Generate lands on the paper; Settings has "Back to the paper").
- **My exams cards, 19 Nov (owner, verbatim):** "does open and preview go to the same thing? Can we just make the block clickable to enter
  the exam. Also the blocks are so tall vertically is there a way to rearrange the content to be more effient and more design oriented".
  Open and Preview did the same thing; both are gone. A click anywhere on the card (not on its buttons) opens the exam on its paper (the
  title stays a button for the keyboard). Two lines: the name with an "Open now" pill, then course · school (left out when it is CMC
  Education, as it is on every exam) · saved when and by whom, with any warning (questions gone from the bank, reported). On the right:
  marks, questions (MC), % problem solving, "Make similar", and a ⋯ menu with Duplicate, Rename, Delete.
  Owner 19 Nov: "Is there a wya to make the reported one not drop to a new row?": warnings are short pills on line 1 after the name
  ("⚠ 1 reported", "⚠ 2 gone"; the full sentence on hover), and the three figures sit in fixed columns so they line up card to card.
- **Fix my flags now, 19 Nov (owner, verbatim):** "I need a way for the reviewer to run flags, he couldn't do it all of his last shift",
  then chose "Button + checks in shift" and "monday, tuesday, wednesday, friday 9-5 all those days". The flags line on Review (below the
  cards) has "Fix my flags now" while flags wait; it writes runs/flags_<ms> {kind:'flags', status:'requested', by, at} and the line then
  says "Sent to Claude <time>" and when it is picked up (hourly 9 am-4 pm on those days, else the 10:11 pm night run), then "Claude is
  fixing them", then "Last run <time>: <result>" for a day. It replaces the old "tell Claude 'check my diagram flags'" hint. Runbook:
  FLAGS.md "Scheduled check".
- **Apply a difficulty report, 19 Nov (owner, verbatim):** "how to apply suggestion?" -> "yeah apply suggestion or tweak it yourself in
  the page. It shouldn't need to be sent to claude every time", then "there should be an option for an editor to CHANGE the difficulty.
  No one should be able to do it in the exam builder" (confirmed "yep thats right" for: editors change it in Reports; the exam builder
  only reads it). A difficulty report has "Apply suggestion": one row per part (the reported part, or every part for a whole-question
  report) with band 2-6 and Fluency / Problem solving, prefilled with the suggestion and editable; "Apply and resolve" saves each part as
  difficulty/<part_id> (as a Difficulty check, from_report) and resolves the report with what was applied. Reports sit in Curate
  (editors only) and difficulty writes need admin. The exam maker's estimates and generator use a saved change at once (lvDif); the
  night run folds them into the database (NIGHT.md 3b, tools/apply_difficulty_reviews.py).
- **No original for a sketch Claude drew (20 Nov).** The checker flagged "original image missing" (2022 Girraween AT4 Q3, twice, after
  the 18 Nov hand-back explained it) and "original image is missing. Find and put it there" (2022 Hornsby AT4 Q18 s2; the paper's
  solutions have one graph, shown with s1). 31 solution sketches have no source picture (figures row page 0, no box). build_bank marks
  them (fig.no) and Review's Original box says: "No original: the paper has no diagram here. Claude drew this sketch for the worked
  solution, so check it against the solution's working." instead of an empty picture.
- **Multiple-choice option diagrams resize (19 Nov):** an option's corner drag never grew the diagram (its size limit was measured from
  a wrapper only as wide as the diagram); it is measured from the option's cell now. Found when the page test's exam opened on one.
- **Marks block (18 Nov).** Owner, with a NESA cover screenshot: "in terms of the cover page format, the marks part should like something
  like this in terms of layout. implement this as well": left "Total marks: N"; right, per section "Section I – n marks (pages a–b)" in
  bold, then "Attempt Questions …" and "Allow about <time> for this section" (the working time shared by marks, to 5 minutes; Section II
  takes the rest). Pages are the page footers' numbers (the cover is page 1), filled in after layout.
- **Instructions.** A two-column NESA-style block: General instructions | bullets, Section I (marks) | bullets, Section II (marks) | bullets, with hairlines between the rows.
- **"+ Add an instruction".** It is now the last item of the General instructions list, after the Section II reasoning line. It is still removed from the download and hidden in print.
- **Saving.** `cert` is saved with the exam (`exams/<id>`), restored on open, and part of the "unsaved changes" check.

## Marks by topic ("TOPIC is too wide, the questions are far too cramped")
- Topic takes 30%. Section I, Section II and Total take 16 mm each, and Score takes 15 mm. Questions takes the rest (about 58 mm).
- Question numbers are 8.2 pt and a run such as "8–10" never breaks. In the test exam (41 to 45 questions, 2 topics) every list fits in 2 lines; before, one wrapped over 6.
- **Bug fixed.** The Score cell used the class `.sc`, which belongs to the Import page's status dot and drew circles in the cell. It is now `.xsc`.

## Marking guide
- **MCQ highlight ("too close and touching the answer").** The correct option is a box hugging the option: padding of about 2 × 3.3 mm (7.5 to 12.8 px), a soft accent background, a 0.75 pt border and a 2 pt accent marker on the left. Option tables use the same tint.
- **Two vertical lines.** The paper's `.xsol` border (2 px, black) sat outside the bank's own `.sol` border (3 px, teal). On the paper, `.sol` now has no border, background or padding. `.xsol` keeps one subtle 0.75 pt grey rule.

## Alpha: dot points and Report on the paper
- **Dot-point line.** (14 Nov, QUEUE #4: moved off the question into an ⓘ card and the grading panel; see "Dot points behind an ⓘ".) On screen, each question's source line (exam paper and marking guide) starts with a small grey line of its main dot points: the code in bold, then the short text. It comes from `effTags` primary tags and `DM`, as the Bank files it. Part labels are added when parts differ, for example "(a)(c) Y11-040 … · (b) Y11-042 …".
- **Report link.** It reads "Report", or "Reported · N open". (14 Nov, QUEUE #4: now a Report button inside the ⓘ card; an open report puts a small dot on the ⓘ.)
- **Report form.** A small dialog; on phones it is a bottom sheet. It shows:
  - what the question is filed under and its rated band;
  - a part picker for multi-part questions;
  - What is wrong: Wrong difficulty (optional band 2–6, and from 14 Nov an optional Fluency / Problem solving), Wrong dot point (optional dot-point picker, or free text), or Other (a note is required);
  - a note.
- **Keys.** Esc closes only the form, not the preview. Ctrl/⌘+Enter sends.
- **Storage.** Collection `reports`, one doc per report: `{question_id, part_id?, reason: difficulty|dot_point|other, suggested_band?, suggested_wm?, suggested_dot?, note, exam_id?, by, at, status:'open'}` (`suggested_wm` 'UF' | 'PR', 14 Nov). Resolving adds `reply, done_by, done_at`. 17 Nov: status also `sent`; every action adds `action`, `done_by`, `done_at` and a `log` entry (see "Acting on a report").
- **Screen only.** Both the line and the link carry `.scr-only`: they are removed from the download (with `.lnctl`, `.figctl` and the others) and hidden in print.

## Reports tab
- **Tab.** **Reports** (`#reports`) sits after Review, with a count badge of open reports. It also appears in the phone menu. (15 Nov: now the Reports step inside Review, `#review/reports`, its count on the step; see "Teach | Curate split".)
- **Why a tab, not a Review step.** Review's steps are one-question-per-page queues of bank questions. Reports are a list of their own, so a tab was the least invasive choice.
- **Filters.** Open / Resolved / Dismissed / All, with counts.
- **Each report shows:**
  - the reason, QID, part, when, who, and which saved exam it came from;
  - the suggestion (for example "Band 3 → suggests band 5", or the dot point);
  - the note;
  - the question rendered as in the Bank, with its dot points (folded away once handled).
- **Actions.** Resolve (an optional reply; Enter saves) and Dismiss. A handled report can be reopened.
- **Code.** page_src/js/27_reports.js and page_src/css/16_reports.css; the tab wiring is in 09_router.js and page.html (was site/reports.*.txt + tools/patch_reports.py).

### Acting on a report; a reported question leaves the bank (17 Nov)
Owner 17 Nov: "So how do we actually change the reported questions?" then, on the proposal below, "yes build it in the background. When a
question is reported, it needs to be logged somewhere right? and disappear from the bank."
- **Actions on an open report** (besides Resolve and Dismiss):
  - **Open in Review**: the question in Review's "All questions" list (#review/list/all), as the Bank card's Open in Review.
  - **Apply suggestion** (a wrong dot point with a suggested dot point from the list; free text cannot be applied): files the
    question under it with the same change as Review's tag picker (reviews `tag_edits`), then resolves the report with the reply
    "Applied: <code> <short text>". Parts: the reported part; with no part, the only part, or the parts not already under the
    suggestion when they share one main dot point; otherwise a small part picker asks which parts.
  - **Send to Claude**: the report becomes the question's flag (reviews status flagged, note "Report (<reason>[, part (x)]): <note>
    <suggestion>", fixed null), so it joins "Flags waiting for Claude"; a flag already waiting keeps its words and gets the report
    added. The report gets status `sent` and stays under **Open** marked "Sent to Claude" (with "waiting for Claude" or "fixed, back
    in Review for approval"). Once the question is approved again after it was sent, the report shows as **Resolved**, "Fixed and
    approved" (worked out on the page; nothing is written). Difficulty and other reports go this way.
  - Handled reports keep Reopen; every report has Open in Review while its question exists.
- **Logged on the report** (collection `reports`): every action writes `action` (applied | sent | resolved | dismissed),
  `done_by`, `done_at`, and adds `{action, by, at}` to `log` (Reopen adds `reopened` to the log only). Apply also writes
  `applied: {dot, parts}`; Send writes `flag` (the flag's words) and `sent_at`. The action is recorded only after the review write
  saved (a viewer who may not write reviews gets the usual "You can view but not save" and the report stays as it was).
- **Out of the bank while a report is live** (open, or sent and not yet approved again): hidden from the Bank (topics, counts,
  search, whatever the approved-only switch says) and from everything that puts questions into a new exam: the Exams pick list and
  its topic counts, Add 5 at random / Add all shown, the generator and Regenerate, the availability table and topic counts, and Swap.
  It is the same path as other hidden questions (`inBank`, and `exBase` / `xaSwap` for the generator), through `repHidden`.
- **Safeguards (Claude's, agreed in the proposal):** a saved exam that already holds the question keeps it, with the existing
  "reported by a teacher" warning (exam panel and My exams); Review and Reports still show it; Resolve or Dismiss brings it back
  at once. A sent report keeps it out until the fix is approved (it is flagged, so it would be out of the approved bank anyway).
- The Inbox's Reports count is still the open reports that need someone (sent ones wait on Claude, in "Flags waiting for Claude").
- **The card's dot points are the ones that count** (17 Nov fix, raised in the same round): the Reports card, the report form's
  "Filed under" and the paper's ⓘ showed each part's raw current tags, so a part whose tagger disagreement Review settled showed the
  losing tagger's dot point (QID 559, 2026 NESA HSC Q32: tagres {"890": "B"}, the card said "(b) Y12-257", tagger A's, instead of
  Y12-240). They now show `partMain` (07_bank.js): the dot points qHome counts (Review's home side A/B, else the per-part picks once
  all are made, else the current tags), and a part's own tag change (Review's Change tag or Apply suggestion, `tag_edits`) wins over
  the side settled before, so the home follows an applied suggestion. The Reports card also shows the question's **Home topic**.

## Not done / open
- The certificate word for all-Year-11 exams is "Preliminary", the owner's word. NESA now says "Year 11". It is editable either way.
- ~~Nothing yet reads the `reports` collection on Claude's side to apply fixes.~~ 17 Nov: a report is applied on the page (Apply suggestion) or sent to Claude as a flag (Send to Claude), which Claude fixes like any checker flag. See "Acting on a report".

## Critic pass (14 Nov)
Owner: "It should all feel clean and sophisticated", "not cartoonish".
- **Preview toolbar.** The Exam paper / Marking guide switch used the global pill `.xseg` with a solid accent fill. On the Exams preview (`.expv .xseg`, in exams.css.txt) it is now the same hairline segmented control as Exam setup / Pick by hand / My exams: 7 px radius, with accent-soft for the selected view. The global `.xseg` is untouched.
- **MCQ highlight.** The 2 pt accent bar inside the box's left edge is gone. It read as a second vertical line next to the border (owner: "why are there two vertical lines"). The box is now one 0.75 pt teal-grey border on a soft tint, and its padding is unchanged.
- **Grading panel.** The summary tiles and question rows now have a 6 px radius instead of 12 px. The Fluency / Problem / Mixed tags have a 4 px radius instead of full pills.
- **Papers to draw from.** The columns size to their content, so "School exams" stays on one line at 320 and 390 px. Before, it wrapped onto 2 lines and the checkmark sat misaligned. The checkmark no longer shrinks.
- **Radii.** Below 980 px the summary bar has an 8 px radius instead of 14 px. The empty states are 8 px.
- **My exams (mine.css.txt).** Rows and empty states have an 8 px radius instead of 12 px. The unsaved banner is 8 px with a softer warn border. The open exam shows a 1 px accent ring instead of a 3 px inset bar.

## Site-wide look refresh (14 Nov)

The owner said (14 Nov): "Questgen is buns, make it more sophisticated ... the side bar UI also looks a bit cartoonish. It should all feel clean and sophisticated."

**Files**
- theme2 (now `page_src/css/17_theme2.css`) comes after every feature stylesheet except the schema diagram, so it overrides earlier rules. Keep it in that place in build.json.
- (Until 14 Nov, `tools/patch_theme2.py` inlined it between marker comments; now build_page.py assembles it, and the patch script is archived.)
- No markup or JS changed.

**Scope.** Tokens, header, buttons and inputs, Bank (home, sidebar, subtopic page, question cards), Review, Papers and Import, Difficulty, Guide, and the phone menu. The Exams page internals (exams.*, mine.*, exam_auto.*) and the A4 paper (.sheet, .x*) are not styled here. They only pick up the new tokens and the shared `button.act` system.

## Look (proposed lines for UI_SPEC "Look")

- **Palette.**
  - Light: a calmer paper ground (#f6f4ef), crisper ink (#16181d), one teal accent (#1a5a53) and hairline borders (#e9e5dd).
  - Dark: deep neutral greys (#111113 / #18181b) with no purple cast, and a light teal accent (#7fc3b9).
  - Year colours are kept (one accent per year, from 12 Nov).
  - Every text pair passes WCAG AA in both themes. The lowest pair is Y11 orange on its tint, at 4.7.
- **Type.**
  - Inter at 14px for the UI. Fraunces 500 only for page titles: Question bank, a subtopic title, Difficulty check, Papers, Guide, Import.
  - Card titles, the year headings and QIDs moved from Fraunces to Inter 600.
  - Labels are 11px uppercase with 0.08em tracking. Counts use tabular figures.
- **Header.**
  - A slimmer bar (about 52px, down from 66px). It is full-bleed now: the body's default 8px margin is gone.
  - It is translucent, with a blur behind it.
  - The tabs have no box. The sliding pill is kept (12 Nov ruling) and is now a quiet tint behind the open tab.
  - The Exam button is a plain secondary button, and its count sits after a hairline divider instead of in a filled pill.
  - The theme button is muted.
- **Buttons and inputs.**
  - One system, 6px radius, 32px tall on desktop and 40px on phones:
    - secondary `button.act`;
    - primary `.act.primary` and a pressed "+ Add to exam";
    - ok and warn as soft tints;
    - ghost.
  - Inputs show a soft accent focus ring.
- **Cards.**
  - 8px radius instead of 12–14px, hairline borders and no resting shadow; a faint shadow appears on hover.
  - The year rail on the focus-area cards is 2px, not 4px.
  - The home grid has 3 columns at desktop width.
- **No pills on bank cards (12 Nov ruling, extended).**
  - The marks on a question card are now plain text, not a filled chip.
  - The home stats line is plain figures.
  - The subtopic filters are a quiet segmented style instead of rounded pills.
  - The jobs pill stays a pill (12 Nov ruling).
- **Sidebar.**
  - Rows are 6px radius with a subtle hover tint, and the indent rule is a hairline.
  - Motion, pill logic, folding and Expand / Collapse all are untouched (13 Nov rulings).
- **Review.**
  - The open step is ink on paper instead of a teal block.
  - Panes, sections and segmented controls are 6–8px radius.
- **Difficulty.**
  - Same layout and targets: 48px bands on desktop and 44px on phones. The look is refined only.
  - The To check / All switch is now a segmented control.
- **Phone menu.**
  - 44px rows and a 10px radius sheet.
  - The search field is full width at 40px, with a 16px font so iOS doesn't zoom into it.

## Tested

- Playwright at 1280 and 390, light and dark: Bank home, a subtopic (cards), Review, Difficulty, Papers, Guide and the phone menu, plus Exams as a sanity check.
- No page errors and no horizontal scroll anywhere.
- Before and after screenshots: /tmp/claude-0/-home-claude/800fc37d-9da1-531b-8789-51723586bf26/scratchpad/polish_look/{before,after}/

## Open

- The Exams page still uses Fraunces for "Set up your exam" and "Year 12" headings, and pill toggles. Its owner (the Exams pass) may want to align with these rules.
- `packCards()` adds a hard-coded 14px row gap, so the card gap stays 14px.

## Critic pass (14 Nov), added at the end of theme2.css.txt
- **Desktop gutter is 28px.** Removing the body margin had put the page 16px from the window edge. Phones keep 16px.
- **Year headings are serif again.** They use Fraunces 500 at 21px. UI_SPEC Look says "Warm editorial: serif headings", and the pass had moved them to Inter. Card titles stay in Inter as labels; ask the owner if he wants them serif too.
- **Sidebar counts line up.** They sit on the first line of a wrapped name for both areas and subheadings. Before, they were centred on one kind of row and top-aligned on the other.
- **Review bar.** "Other lists" now lines up with the step buttons.
- **Review progress track hidden.** Its empty grey track sat on the header hairline and read as a thick double rule ("No bar under the header"). Only the filled part shows now.

## PDF export (14 Nov)
He said "make it so we can export pdfs from here. Find a way". The artifact can't open the print dialog, so the paper preview now has **Download PDF**.
- **How it works.** It draws each A4 sheet to an image in the browser (html-to-image 1.11.11), puts one per page in a PDF (jsPDF 2.5.1), and saves it through the downloads capability.
  - The libraries load only when the button is pressed, from the page's own `vendor/` copies (they came from jsDelivr until the 14 Nov hardening).
  - The page copy has no controls, dot-point lines or Report links.
- **Trade-off.** The pages are pictures at about 190 dpi: they print sharply, but the text can't be selected or searched. **Download HTML**, renamed from "Download to print", stays for a text PDF via the browser's print dialog.
- **Tested:** a 13-page paper took about 10 s and made 1.8 MB, with maths, diagrams and the cover intact.
- **Fix found along the way.** The HTML download's clean-up had a line swallowed by a comment, so editable fields kept their edit attributes. Fixed.

**Tables in the PDF (18 Nov).** Owner: "Q0979 exam name Mia's advanced exam. The PDF shows side scroll bars, its a persistent issue
across many tables. fix it please, its urgent". Cause: the picture maker copies each box's on-screen height, and a table's height
includes its caption, so every table with a caption was drawn that much taller and overflowed its scrolling box (scroll bars,
last row cut off). Now: in the PDF copy a caption is a centred line above its table; nothing on an exam sheet scrolls; tables are
fitted to their real column after the sheets are laid out (only ever smaller); maths in a table cell never breaks mid-formula;
the page's own fonts are embedded in the PDF. Page test "exams: no scroll bar on any sheet" covers it.

**Flag counts and the Spot-check "1" (18 Nov).** Owner: "Why does it say both 11 and 20?" The "Flags waiting for Claude" card
counted bank questions (11: 9 with diagram change requests, 2 text flags); the "N flags waiting for Claude (M questions)" note
walked the raw review docs, where each question sits under its k_ key and again under q<id>, so it counted every diagram request
twice (20 in 18) and left out text flags. Now the note counts per bank question with the card's rule: flags = diagram requests +
open text flags, questions = the card's number. Page test "the flags banner counts each waiting question once".
Owner: "why does it say 1 on spot check but there's nothing there". The 1 is the "Approve the other N questions" click that is
left once the sample is clean; the empty step now says "Spot-check is done: one click left, approve the rest of the paper below"
instead of "Nothing left".
**Enlarge a comparison picture (18 Nov).** Owner: "Can u make it so when you click on the original and now, they enlarge". In
Review's diagram comparisons (side by side, overlay, before -> now) a click or Enter on a picture opens it large in a dialog, with
its caption; ‹ › or the arrow keys step through the other pictures of the same comparison; Esc or a click outside closes it.
Page test "a click on a comparison picture opens it large". Same day: a "Before" picture that was never kept now shows a plain
note instead of a broken-image icon, and the flag fixes render their "Before" picture (tools/redraw_before.py, FLAGS.md step 2).
**Checker feedback, 18 Nov (v253).** Owner on the checker's list: "for the undon button, can undo recently approed questions. Maybe a
queue on the same page on the right side? or anywhere convenient really." and "The last dot point is for it to be more obvious on the
page when questions have been done by you and have been returned. Maybe a different place to the flagged waiting for claude ones, I
think they use the same real estate right now." then "implement those alongside 5,6,7".
- Undo (36_undo.js): a "Recently approved" column on the right of Review (under the question below 1180 px) lists your last 10
  approvals, questions and papers ("approve the rest"), each with Undo. An approval made in this browser session is put back exactly
  (the record before it is kept); an older one is undone by clearing "approved", which returns it to its queue.
- "Fixed and back for you" is the first thing on Review, highlighted, listing up to 6 returned items with what Claude changed.
  "Flags waiting for Claude" moved below Reports and Difficulty, dashed and quieter ("Nothing to do here").
- 5 (scroll bars, cut-off tables in the downloaded paper): the screenshots were taken before v249; tables, including tables drawn as
  diagrams (2024 Abbotsleigh AT4 Q9's z-table), now print whole. The page test covers diagram tables too.
- 6 (no z-table at the back): build_bank.py matched the z-table list by question key before the keys were attached, so no question
  was marked and no exam got the table. Fixed; batch_check blocks if a listed question is not marked.
- 7 (marking guide, a worked solution one letter wide): the "(continued)" piece of a multiple-choice question has no number, so its
  body fell into the 8 mm number column. The body always takes the wide column now.
**Diagram drag on the next page, maths line breaks (18 Nov).** Checker report (v245 review): "Dragging a diagram onto the next page doesn't
work. On an exam where a diagram has been pushed to the next page, dragging it to shrink it does nothing." and "Maths breaks across
lines. In 2024 Sydney Girls Q33(a), '¼ ln 2 − ⅛' breaks in the middle: '− ⅛.' starts the next line at the left margin." Owner: "lets
do 2,3,4,6".
- Drag: not reproducible in the current build (three diagrams grown onto the next sheet all shrank on the next drag; the 13 Nov and
  17 Nov drag fixes). Page test "a diagram grown onto the next page can be shrunk there by dragging" keeps it that way.
- Maths: the expression is 2023 HSC Q32(a) (QID 201), not Sydney Girls. MathJax 4 breaks inline maths at operators, and its own
  stylesheet beat the page's rule. Inline maths now moves to the next line whole; an expression wider than its whole column is marked
  .mjx-wrap after typesetting and may break at MathJax's break points, so nothing runs past the edge. Page tests "inline maths moves to
  the next line whole" (300-720 px sweep) and "phone: inline maths on Bank cards splits only when wider than its column".

## Word export (14 Nov)
He said "Word too pls". The preview has **Download Word** beside Download PDF, for both the exam and the marking guide.
- **What is built.** A real .docx is built in the browser (docx 9.0.2) from the laid-out paper:
  - the cover (school, certificate, course and title on separate lines, name lines, a stats row, instructions, marks by topic);
  - section and question headings with the marks right-aligned;
  - parts with labels and right-aligned marks;
  - answer lines (a table of ruled rows, because stacked bordered paragraphs merge into one box);
  - MCQ options, with the correct one tinted in the guide;
  - tables;
  - diagrams as pictures;
  - solutions with a left rule.
- **Maths becomes editable Word equations.** TeX (MathJax's data-latex) → MathML → Office Math (mathml2omml 0.5.0). Two converter faults are worked around:
  - unescaped < and > inside Office Math text;
  - an integral's body being left empty.
  - An expression that still fails becomes a picture of itself, and the toast says how many.
- **Tested.** Three random 60-mark papers and a marking guide had every equation editable. They were checked by opening in LibreOffice and reading back with pandoc.
- **Not checked.** Microsoft Word itself wasn't available. LibreOffice draws some delimiters oddly, but pandoc reads the maths back correctly.

## Paper pages never run past A4 (14 Nov, hardening)
The automated page test (`tools/page_test.js`) found two ways a sheet grew taller than 297 mm. The PDF and the printed HTML crop each sheet to A4, so the bottom was silently lost. Both were found in a 60-mark paper over all topics.
- **Cover.** With many topics (12 in the test), "Marks by topic" pushed the cover to about 350 mm, and the table's last rows and Total were cut off. Now, only when the cover would run past the page, the table moves to a page of its own straight after the cover, still titled "Marks by topic". A cover that fits is unchanged. The Word file still puts the table on its cover page, as before (`cvcont` block in `xPreview`; `30_word.js` reads it from there).
- **One long part.** A question taller than a page was already cut between its parts, but one part (or one part's worked solution) taller than a page stayed whole. In the test, a marking-guide page was 324 mm and the rubric and marker's note were lost. Such a piece is now also cut inside the part, between lines, and the next page starts "Question N (continued)". The part keeps its layout: an empty label column, and the solution's left rule continues. Maths, images and tables are never cut. Questions that fit are laid out exactly as before (`exCutTall` / `exCont` in 24_exams.js). The Word file puts each such question back together (`exRejoin`), so the .docx is unchanged.
- **Other question pools (13 Nov fix).** With a different pool of approved questions (the Review workload's 1,499 instead of 1,576), a marking-guide page was 1,350 px (about 357 mm). Two causes, both fixed in `exCutTall` (24_exams.js):
  - A part is a grid of three columns (label, body, marks) that are all stretched to the part's height, so "cut inside the tallest column" picked the empty label column and gave up. It now picks the column whose content runs furthest down.
  - A worked solution's text is often one inline run of words, inline maths, display maths and line breaks, which had no place to cut. It is now cut at the start of the last line that begins above the page end (`exFlowCut`), splitting the text between words if need be. Maths, images and tables are still never cut. The Word file joins the text back into one piece (`exRejoin`).
  - Papers and guides that already fitted are laid out exactly as before: on 16 generated exams (two pools, 8 seeds, 30 to 100 marks) every sheet that fitted on the old page is identical on the new one; the 7 guides with a sheet past A4 now fit.

## Processes page and the running / queued pills (14 Nov, QUEUE #0)
He asked: "Can u show this list of tasks on the artifact somewhere, need a pill for current jobs and queued jobs. Can be on the same as import. Can make that page processes".
- **Tab.** The Import tab is now **Processes** (`#processes`), in the header and the phone menu. Old `#import` links still land on it (the address is rewritten to `#processes`).
- **Header pills.** The single jobs pill (12 Nov ruling, "should be a simple pill") is now two quiet pills: **N running** (accent tint, slow pulsing dot) and **N queued** (outline, muted). A pill with a count of 0 is hidden. Hover or focus shows the list, with "Open Processes →"; on a touch screen the first tap shows the list and the link goes there. Clicking a pill on a desktop goes straight to Processes. The "Wait" warning for a job that changes the open Review step is kept on the running pill.
- **Data.** Running = db doc `progress/jobs` (`{jobs:[{name,detail,affects,started}]}`) plus any queue item marked `running` that has no job of the same name. Queue = db doc `progress/queue` (`{items:[{id,title,detail,status:'queued'|'running'|'done',order,asked}],updated}`), sorted by `order`. Once the queue doc is loaded, a job whose name starts with "Queued" (the interim "Queued: 5 tasks" entry) is ignored. `started` may be an ISO time or "HH:MM" and shows as "12 min ago".
- **The page, top to bottom:** *(13 Nov: split into Work | Papers, see "Processes in two tabs".)* Running now (cards: name, detail, started time); Queued (numbered list: title, detail, and the owner's own words in muted italics); Recently done (collapsed); then the import dashboard under its **Import** heading (content unchanged; its sub-headings restyled in the review pass, see "Review pass on QUEUE #0–#4"). Empty states are one short line.
- Code: `renderJobs` / `runningNow` / `queueItems` in 13_shell.js, `renderProcesses` in 12_import.js, styles in 06_import_jobs_tags.css. Tested by the `processes:` checks in tools/page_test.js.

## Exam setup: availability table labels (14 Nov, QUEUE #1)
He said: "overlap" (work/queue/1_overlap_avail_table.png): in "What these topics can supply", "Fluency" and "Problem solving" ran into the B2 cells.
- Cause: the table has a fixed layout, which takes its column widths from the first row, and that row's label cell is empty, so all six columns were equal and the labels had about 50 px.
- Fix: a `<colgroup>` gives the label column its own width (7.8em) and a 12 px gap before B2. Labels wrap between words ("Problem / solving") inside that column and never touch the cells. Checked at 1280 (380 px settings panel), 1000 and 390 px; the page test `exams: availability labels clear of the cells` measures the drawn text against the B2 cell at all three.

## Diagram resize by the corner (14 Nov, QUEUE #2)
He said: "resizing is really unintuitive, it should just be drag the corner in and out diagonally" (work/queue/2_figure_resize.png).
- **No − 100% + pill.** The pill and its reset button are gone from the paper preview.
- **Drag the corner.** Each diagram sits in a box the size of the drawn diagram, and a small square handle sits on its bottom-right corner. Dragging it in or out along the diagonal resizes the diagram in proportion, from 30% to 200%. The diagram is centred, so the scale is fitted to keep that corner under the pointer. Pointer events: mouse, pen and touch all work.
- **While dragging** a small "132%" shows at the corner; it is hidden otherwise. Hovering a diagram shows a faint outline and the handle. On a touch screen (no hover) the handle always shows, a little faded.
- **Reset.** Double-click the handle (double-tap on a touch screen) to go back to 100%.
- **Keyboard.** The handle is a focusable slider: ← → ↑ ↓ step 5%, Home resets.
- **Layout.** Only the diagram changes while dragging; the paper is laid out again once, when the drag ends.
- **Storage and exports.** The size is still `EX.figscale[k]` (100% removes the key). The download, PDF and Word use it as before; the handle and the live % are removed from all three and hidden in print.
- On a phone-sized (scaled) paper, the handle and the ⓘ keep their real size.
- Code: `exFigWrap` and the pointer handlers in 24_exams.js, styles in 12_exams.css. Tests: `exams: diagram resize …` (drag, clamp and reset, touch phone) and `export: a resized diagram keeps its size in the HTML download`.
- **13 Nov fix: a drag that did nothing.** Found with the Review workload's question pool (a drag in left the diagram at 132%). Three causes, all fixed in 24_exams.js / 12_exams.css:
  - When a resized diagram's question moved to the next page, the paper re-laid out and the diagram jumped off screen, so the next drag found nothing under the pointer. Now the paper scrolls so the diagram's top edge stays where it was on screen (`exFigKeep`); when the diagram stays on its page nothing moves, as before.
  - A diagram is never drawn wider than the column, so a scale past that point changed nothing on the paper, and dragging in from there changed nothing visible either. The largest scale is now the one that fills the column (still at most 200%), measured from the diagram's size at 100% (`exFigBase`). The keyboard steps use the same limit.
  - A question's text box clipped its overflow, so on a diagram as wide as the column the handle (which sits 7 px outside the corner) was cut off and could not be grabbed. On the paper, a text box holding a diagram no longer clips; it stays a block formatting context (flow-root), so its height and the layout are unchanged.

## Report form: Fluency / Problem solving (14 Nov, QUEUE #3)
He said: "Should let you pick UF and PS in the wrong diff" (work/queue/3_report_form.png).
- Under **Wrong difficulty**, a **Kind** segmented choice, Fluency | Problem solving, sits beside **Suggested band** (below it on a phone). Both are optional; a second press clears either.
- Stored as `suggested_wm: 'UF' | 'PR'` on the `reports` doc. `tools/sync_pagedb.py` mirrors it into `page_reports.suggested_wm` (added with ALTER TABLE when missing; running it again changes nothing).
- **Reports tab:** the suggestion reads, for example, "Band 3 · Fluency → suggests **band 5 · Problem solving**".
- Not done: no tool reads `reports` yet, so nothing applies `suggested_wm` when a report is resolved (see "Not done / open" above).

## Dot points behind an ⓘ (14 Nov, QUEUE #4)
He said: "The dot point home looks stupid in a question" (work/queue/4_dotpoint_line.png). Offered an ⓘ on the source line, he said: "Yeah that's fine, the i is fine".
- **Gone from the question:** the grey dot-point line and the Report link, on the exam paper and the marking guide.
- **The ⓘ** ends each source line ("2025 Sydney Girls High School AT4 Q13 · QID 1084 ⓘ"). It is muted grey, teal on hover, and shows a small amber dot when the question has open reports.
- **The card.** Clicking or tapping it opens a small card:
  - the question number and QID;
  - per part: the dot point(s), code in bold and short text, then "Band 4 · Fluency";
  - Report, which opens the existing report form.
- **Closing.** A click outside or Esc closes the card and returns focus to the ⓘ; the preview stays open. Enter opens it from the keyboard, and Tab reaches Report.
- **Grading panel.** A question's open detail now has a **Dot points** list (per part) above the part table.
- **Screen only.** The ⓘ carries `.scr-only`, so the download, PDF and Word leave it out, as they did the old line, and print hides it.
- Its 20 px target adds no height to the source line, so pagination is unchanged.
- Code: `qiButton`, `qiParts`, `qiOpen` in 27_reports.js (drawn by `xQ` in 20_exam.js); styles in 16_reports.css. Tests: `paper: the dot-point line is gone …`, `paper: the ⓘ card …`, `exams: the grading panel lists the dot points`, and the touch-phone check. The existing report check now starts from the ⓘ and also sends a kind.

## Review pass on QUEUE #0–#4 (14 Nov)
Small fixes from the review of the five queued requests, keeping every ruling above:
- **Processes, one "Running now".** He asked for the Import page to become Processes ("Can be on the same as import. Can make that page processes"). The import dashboard sits under its **Import** heading (now 21 px, below the 24 px page title), and its sub-headings (Batches, Needs your decision, Log) use the same small uppercase labels as Running now / Queued above. Its own stage list is now **Import stages running**, shown only when a stage is running, so the page no longer has two "Running now" headings or a second "Nothing running." line. The dashboard's content is otherwise unchanged.
- **Grading panel dot points.** Parts filed under the same dot point(s) share one row, "(a)(b) Y12-285 …", as the old line did, instead of the same line under each part. The ⓘ card still lists every part, since each has its own band and kind.
- **Phone toolbar.** On the exam preview, the paper's "− N lines +" controls and the diagram corner handle now scroll under the sticky toolbar instead of being drawn over it.
- Tested in tools/page_test.js: `processes: page sections and order` (one Running now, small Import sub-headings), `exams: the grading panel lists the dot points` (no repeated row), `exams: diagram resize and ⓘ on a touch phone` (controls stay under the toolbar).

## Teach | Curate split (15 Nov, stage 3)
Owner, 15 Nov: "Lets do 2 as well" (the Teach / Curate split; quoted via the workflow brief) and, in his own message, "curate should be hidden to peope except editors."
- **Two areas.** **Teach**: Bank · Exams · Guide (Worksheets will join later; no placeholder tab). **Curate**: Review · Papers · Processes. *(13 Nov: Curate is Review · Processes; Papers merged into Review.)*
- **Switch.** A small segmented **Teach | Curate** control sits before the tabs in the header: hairline frame, theme2 tokens, and a highlight that slides like the tab pill (12 Nov ruling). Only the open area's tabs show, and the tab pill still slides between them. Choosing an area returns to the last page used in it (first time: Bank / Review).
- **Difficulty and Reports are Review steps.** *(Superseded 13 Nov: the step row is gone; Difficulty and Reports are Inbox sections at the same addresses, with "← Inbox".)* The Review step row is Decide, Check, Spot-check, Diagrams, Tags, **Difficulty**, **Reports**, each with its count (Difficulty: parts still to check in the chosen list; Reports: open reports). Difficulty and Reports open their own pages under the same step row (`#review/difficulty`, `#review/reports`), without the paper picker and ← →. Old links `#levels`, `#difficulty` and `#reports` land on those steps; `#import` still lands on Processes. This replaces the "Difficulty tab" and "Reports tab" rulings below as to *where* they sit; their pages are unchanged.
- **Who sees Curate.** Only the artifact's owner and editors (`user.isOwner()` or `user.canEdit()`). Everyone else, and any view where the user capability gives no answer, sees no switch, no Curate tab, no Curate group in the phone menu, no running / queued pills (they lead to Processes) and no "Open in Review" on bank cards; a Curate link sends them to `#bank`. While the capability has not answered yet, a Curate link shows the Bank and keeps the address, so an editor's link still opens once the answer arrives. This hides the UI only: what the database lets a viewer write is set by its rules.
- **Roles (17 Nov).** He asked: "I need you to work on some permissions now for who can see wha[t]". Who: "Checker (reviewer), Tutors". What to control: "Hide Curate parts, Who can approve". Built as three roles on the platform's share levels (the page cannot hold a role list that the database would enforce; share levels and db rules are the only real locks):
  - **Owner**: everything, as before.
  - **Checker** = shared as **Editor** (`canEdit()`, not the owner): Curate shows **Review only** (Inbox, papers, lists, Difficulty, Reports). Processes, the Next up list and the running / queued pills are hidden, and a `#processes` or `#import` link lands on `#review`. Can approve.
  - **Tutor** = shared as **Contributor**: Teach only (Bank, Exams, Guide), approved questions only; can save exams and send reports. Cannot approve: the db rules set `reviews` and `difficulty` writes to `admin` (Editor and up), so a Contributor's write is refused by the server, not just hidden. A tutor shared as Viewer can browse but cannot save exams or send reports.
  - He asked "none of them can access chat ad change the page right?"; told: tutors cannot; the checker (Editor) can republish the page, e.g. through their own Claude. Offered a separate Teach-only page for tutors so the checker could drop to Contributor. His ruling: "nah its fine the way it is" (17 Nov): the checker stays Editor; do not build the second page unless he asks.
  - Limits, said to him: an Editor can technically publish a new page version and read the admin collections (runs, queue, costs); hiding Processes from the checker is UI only. Published files (question text, scans) are readable by anyone who can open the page, whatever the role.
- **Remembered.** For the owner and editors the last area (and page in it) is kept per browser (`qg_area`, `qg_last_teach`, `qg_last_curate`, localStorage in try/catch); opening the page with no address returns to that area.
- **Phone.** No switch; the menu lists **Teach** (Bank, Exams, Guide) then **Curate** (Review, Papers, Processes; 13 Nov: Review, Processes) under small headings, the Curate group only for editors. The Review step row scrolls so the open step is in sight. The Difficulty page now has the step row above it, so its phone header is taller than the 53 px measured on 14 Nov.
- **Wording.** The Reports toast says "listed in Review › Reports" for editors and "Thank you" for others; the marking-guide note says ratings are checked in Curate › Review › Difficulty and questioned with Report in the ⓘ card. The Guide's developer page names the two areas in its "Web app" box. Stage 4 review (15 Nov): on the Guide's user page a non-editor reads "References checked by an editor" (no "in Review › Difficulty") and "a home dispute goes to an editor" (not "comes to Review › Tags"); checked by `areas (viewer|none): the Guide names no Curate page`.
- Code: areas, routing and redirects in `page_src/js/09_router.js`; the step row (`renderSteps`, `XSTEPS`, `goStep`) in `08_review.js`; `lvTodoN` in `21_levels.js`; the phone menu in `22_phone_menu.js`; styles in `css/19_areas.css`. Tests: the `areas (editor|viewer|none): …` checks in `tools/page_test.js` (the fake user takes a role).

## Pills, job times, Approved-only chip, Next up (13 Nov, quick lane)
- **Pill hover.** He said: "the stuff should show over the pill on hover instead. Also remove the open processes button there because clicking on the pill already takes you there". Hovering (or focusing) a running / queued pill shows a small popover with those jobs: title, step, Started / Est. finish. The "Open Processes →" link is gone; a click on the pill goes to `#processes`, and so does a click on the popover. Touch (no hover): the first tap shows the popover; a tap on the popover or a second tap on the pill opens Processes; a tap elsewhere (or Esc) closes it. It stays inside a 390 px screen (16 px gutters). This replaces the "Open Processes →" part of the 14 Nov pill ruling; the rest of it stands.
- **Job times.** He asked: "Is there a way to see how far long the running process is, start and finish time as well? Would be helpful". The queue doc's items may carry `step` ("Stage 2 of 4"), `started`, `eta`, `finished` (ISO, Claude writes +11:00). On Processes and in the pill popover each job shows its step (with a small bar when it reads "N of M"), **Started 2:05 pm**, then **Est. finish 3:10 pm** while not done (if `eta`), or **Finished 3:17 pm · took 1 h 12 min** once done. Times are in the viewer's local time; the date shows only when it is not today ("11 Nov, 9:05 am"). The "12 min ago" on running cards is kept.
- **Approved-only chip.** He asked: "is there a point in this showing if all questions are approvied?" The Bank's "Approved only (x of y) · include unapproved" chip shows only when some questions are unapproved **and** the viewer is an editor (`isEditor()`, the Teach | Curate check). A non-editor never sees unapproved questions, even with `bankall=1` saved in the browser (`bankAll()` = BANKALL and editor). The exam pick list's "· approved only" note follows the same rule. Not changed: the exam generator's own "Approved questions only" box (on by default) still lets anyone turn it off.
- **Next up.** He said: "add a place somewhere for me to write down what to flesh out next". A **Next up** card on Processes (Curate, editors only), between the queue and the Import dashboard: a text input + Add, the notes in order with drag (desktop) or ↑ ↓ to reorder, a tick moves a note to a collapsed **Done** list (unticking puts it back at the end), × asks "Delete? Delete / Keep" inline (no confirm()). Empty state: "Ideas for what to build next. Claude reads this list." Stored in db collection `notes`, one doc per note `{text, order, done, by, at}` (plus `doneAt` when ticked); only editors write (every handler checks `isEditor()`). Claude reads it with ArtifactData `list` on `notes` when asked what to build next.
- Code: `parseT`, `clockT`, `durT`, `jobTimes`, `stepBar`, `renderJobs` and the pill handlers in `13_shell.js`; `renderProcesses` in `12_import.js`; `bankAll` / `bankSwitch` in `07_bank.js`; the notes in `31_notes.js` (own script block) and `css/20_notes.css`; `#notesBox` in page.html. Tests: `processes: running and queued pills`, `processes: pills on a touch phone`, `processes: job step, start, est. finish and duration`, `bank: approved-only chip for an editor`, `bank (viewer|none): no approved-only chip, no unapproved questions`, `next up: …` (add, reorder, tick/delete, phone 390 px, viewer).

## Review: Inbox and one paper at a time (13 Nov)
Owner, 13 Nov: "I think the next thing I want to do is refine the review process. It is just 7 tabs at the top and its not really clear the order / process. Let's clear that up together". His answers, verbatim choices:
- Paper flow: "One paper at a time": open a paper and walk it top to bottom with a progress track.
- Upkeep: "An 'Inbox' beside papers": Review opens on a summary: Papers to review · Reports · Difficulty, each with a count and a one-line 'what this is'; empty ones collapse to a tick.
- Order: "Calls → Check → Topics → Diagrams → Spot-check": spot-check last, because it approves the rest of the paper.
- Papers tab: "Merge into Review": Curate becomes Review · Processes, and `#papers` lands in Review's papers section.
- Names: "Your calls · Flagged · Topics · Diagrams · Spot-check" ('Decide'→'Your calls', 'Check'→'Flagged', 'Tags'→'Topics'), each step with a one-line 'what to do here' under the track.

These answers supersede, as to order, names and where things sit: "Four steps, in order" (Review), the Papers tab and "Papers page", "Difficulty and Reports are Review steps" and the Curate tab list (Teach | Curate split). Everything else in those rulings stands (keys, flagging, full-page Check, diagram rules, hidden duplicates, the Difficulty and Reports pages themselves).

- **Inbox (`#review`).** Three cards:
  - **Papers to review**: the number of papers with any review work left, then one row per paper (name, a 5-dot track, "N left · at <step>"); a row opens that paper. Up to 8 rows, then "N more · Show all papers →" *(17 Nov: grouped by batch; see "Review: Papers to review grouped by batch")*. The "Papers ready" banner (approve every paper whose spot-check is clean) sits in this card. With nothing left it collapses to "✓ Papers to review · all approved · Show all papers →".
  - **Reports**: open reports; "✓ nothing open" when 0.
  - **Difficulty**: `lvTodoN()`; "✓ check plan finished" when 0, still openable.
  - The foot has **Recently approved** and **Other lists** (`#review/list/<filter>`), and the "N flags waiting for Claude" note when there are any.
- **Papers (`#review/papers`).** The old Papers tab, unchanged in what it offers (search, year, task, source and progress filters, sortable columns, a paper filed as two PDFs counted once, totals), plus a **Review** column: the 5-dot track and "N left · at <step>" (or "✓ approved"), a "Review work left" progress filter, and a row (or its Open / Review link) opens the paper.
- **A paper (`#review/paper/<doc>/<step>`).** The bar under the header is: **← Inbox**, the paper's name and "N left", the position and ← →; then the **track**: 5 numbered steps joined by hairlines, a tick when a step is done, a dashed circle when the paper has nothing in it, the open step in the accent with its count; then the step's **what to do here** line (shown on phones too). Below it, the existing question views for that step, filtered to the paper (both PDFs of a paper filed twice).
  - Opening a paper without a step goes to its first step with work. When a step hits 0 it moves on to the next step with work, with a small toast ("Flagged done → Topics"). The background "Saved" toast does not cover it.
  - **Spot-check** keeps "approve the rest of the paper in one click": once the sample is approved, the step shows "Approve the other N questions in this paper" (that click counts as the step's last item). When every step is clear the paper says "<paper> is done", with **Next paper →** and **← Inbox**.
  - Keys are unchanged: A approves, F flags, K / J move, D uses all redraws, 1 / 2 in Topics, numbers pick a diagram.
- **Reports and Difficulty** are Inbox sections at `#review/reports` and `#review/difficulty` (their pages unchanged) with **← Inbox** above them. Old `#reports`, `#difficulty`, `#levels`, `#papers` and `#import` still land on the right page.
- **Gone:** the 7-button step row. **Recently approved** and **Other lists** are reached from the Inbox foot; a list (`#review/list/<filter>`) has ← Inbox, a list picker, the paper picker and ← →. "Open in Review" on a bank card opens `#review/list/all` on that question.
- **Counts.** The Review tab and the Curate switch label show the Inbox total: papers to review + open reports.
- **Phone (390 px).** The phone menu's Curate group is Review · Processes. The track shows the number circles, with the label only on the open step, and scrolls sideways if it must, keeping the open step in view. Checked at 390 px in light and dark.
- **Independent review (13 Nov).** Fixed after a check of the build: the 5 dots now show a step with nothing in the paper as a faint small dot (as the big track's dashed circle), not as a green "done" dot; a finished paper's panel has **See its questions** (All questions for that paper, as the old Papers tab's Review link did); **Other lists** also offers "Needs your decision" and "Diagrams to approve" across every paper (the old step row's "All papers" picker did that); an unknown `#review/list/<name>` settles on `#review/list/recent`; a list no longer keeps the last paper's track in the DOM. Test: `review: done paper browse, mini-track dots, Other lists across papers`.
- **Calls Claude raises (13 Nov).** Owner, about the import dashboard's "Needs your decision" notes: "isn't that the point of your calls? or is your decision different". So there is one place for calls: `site/project/open_decisions.json`, built into the bank by `build_bank.py`. A question call (`q.decide`, `q.decide_at`) puts the question in its paper's Your calls with the "Needs your decision" callout, even an imported question and even one approved before the call was raised (A stamps `call_at`). A paper call (`docs[doc].call`) is a card at the top of the paper's Your calls step, "Call on this paper · <paper>": the call, **Keep as is**, and **Change…** (a one-line answer, Enter sends, Esc cancels); the answer is kept in `reviews/paper_<doc>.call` beside the paper approval (approving a paper keeps it) and shows as "✓ Your answer: … · change". Each open call counts 1 in Your calls, so the track, the papers list and the Inbox show the paper as having work. Import history has no "Needs your decision" block any more. Code: `needsDecision`, `callOpen`, `workOf`, `PCALL` in `08_review.js`; `.why.pcall` in `css/21_review_flow.css`. Test: `review: calls raised after approval (paper and question) …`.
- **Test data.** Every live paper is approved, so `tools/page_test_fixture.py` lists a workload (`WORKLOAD`): the page test leaves those review docs out on its Review pages only, giving 1346 (+510) Your calls / Topics / Diagrams, 323 Flagged / Topics / Diagrams / Spot-check, and 1601 Spot-check only. Bank and Exams checks keep the live approved set.
- Code: `STEPS`, `SLUG`, `paperWork`, `allWork`, `trackHTML`, `miniTrack`, `renderInbox`, `renderSteps`, `openReview`, `refreshReview` (auto-advance), `paperNextHTML` in `08_review.js`; `parseHash`, `HASH_ALIAS`, `todoCount` in `09_router.js`; the papers list in `11_papers.js`; markup in `page.html`; styles in `css/21_review_flow.css`. Tests: `review: …` checks in `tools/page_test.js` (Inbox summary; papers list; the track; auto-advance with keys; spot-check approve and paper done; 390 px light and dark), plus the updated `areas (editor): …` and phone menu checks.

## Review: Papers to review grouped by batch (17 Nov)
- His Next up note, asked for on 17 Nov ("Can u do the review one in the background?"): "Review: group 'Papers to review' by batch, oldest first ('Batch 4 · 7 of 9 cleared'); papers waiting on a Your call marked as such. Ordered, not locked."
- **Inbox, Papers to review card.** The rows are grouped by import batch, oldest first: **Before batches** (papers imported before numbered batches, or in no batch) at the top, then Batch 1, 2, … Each group has a header line "Batch 4 · 7 of 9 cleared": cleared = no Review work left in the paper (the per-paper track, `paperWork` n 0; the same test as "Cleared review" on Processes › Papers). Within a group the order is unchanged (newest year first, then name). Once there is more than one course lane, the header names the lane ("Year 12 Standard · Batch 2").
- **Ordered, not locked.** Batches only order and group the list: every group opens and every row opens its paper. Groups open in order until 8 rows are out (a group always opens whole); later groups show only their header (▸, a click opens them) and are counted in "N more · Show all papers →". A batch with nothing left is its header line only, with a tick ("✓ Batch 1 · 8 of 8 cleared"). This replaces "Up to 8 rows" in the Inbox ruling above.
- **Your calls.** A paper with an open call (Your calls step count > 0: a question call or a call on the paper) shows a small "waiting on your call" marker beside its name (under the name on a phone).
- **Where the batches come from.** data/inventory.json (tools/inventory.py lanes: finished batches pinned to doc ids, and the lane batches whose papers are imported). Until it has loaded (or if it cannot load) the card shows the plain list as before. The checker (Editor) fetches it too, for this card only; Processes stays hidden for the checker, and a viewer never fetches it.
- Not changed: the full papers list (#review/papers) keeps its sortable table.
- Code: `inboxGroups`, `renderInbox` in `08_review.js`; `PQ.batchOf` (and `allLanes`) in `32_papers_q.js`; `.rv-bg*`, `.rv-call` in `css/21_review_flow.css`. Tests: `review: Papers to review grouped by batch, oldest first, "N of M cleared", your-call marker` and `review (checker): Papers to review grouped by batch` in `tools/page_test.js`.

## Papers and the import order on Processes (13 Nov; superseded 14 Nov by "Papers: course lanes")
Owner, 13 Nov (dictated): "New exams are gonna be added to this folder periodically we need a way to ... see what we actually
haven't ingested yet", "Should we also order what's in standard and also extension one and extension two while we're scanning
anyways?" and "Can the import queue be dynamic, me choosing which set of papers to import next? We can always [build the]
framework for the courses standard extension and extension two [later] right?"
- **Where.** A **Papers** section on Processes, under the Queued / Recently done list and above Next up. Curate, so editors only
  (`isEditor()`); a viewer gets no section, no `data/inventory.json` fetch and no write.
- **Rescanning: two routes** (owner 13 Nov: "Where is the button to rescan the drive?"). (1) The **Rescan drive** button here
  (Processes › Papers; see "Rescan drive on Processes › Papers" below) walks the shared folder read-only with the viewer's own
  Google Drive connector, finds and lists the new files, and saves the scan for Claude; Claude adds them to the record at the
  next import step. (2) Or ask Claude ("rescan the drive"): Claude lists the folder with the Google Drive connector and adds the
  new files to the record directly (IMPORT_PLAYBOOK "Two ways to rescan"). The "last folder scan" line shows when the record
  was last updated from the folder.
- **Pause note.** Always shown at the top: "Import is paused. This only sets the order for when it resumes." (owner 14 Nov:
  "no more importing for a while until we iron these out").
- **Grid.** One row per course x year level from `data/inventory.json` (tools/inventory.py): columns **In folder**, **Imported**,
  **Waiting**, **New** (added by the latest folder scan; "–" before the first scan). On phones the headings shorten to Total,
  Done, Wait, New. Under the title: "N papers in the shared folder (M files) · last folder scan <time>, K new".
- **Courses.** Course names and whether a course can be queued come from the inventory (`courses[].ready`), never from the page
  (CODE_HEALTH rule 5). Today only Advanced is ready. Standard, Extension 1 and Extension 2 rows are muted, show "needs course
  setup (topics, dot points, difficulty references)", show "–" for Imported / Waiting, and have no checkboxes; "Course not known"
  rows say a cover-page check sorts them.
- **A group.** Clicking a row opens its papers, grouped by school, newest year first: a checkbox (only for papers that can be
  queued: Year 12 Advanced, waiting, not already queued; Year 11 never, owner 13 Nov: "Year 11 papers leave alone for now, would like to finalise Y12 first"), the paper's name, a state chip (Imported, Waiting, In queue · #n, Not imported,
  Other course), and New / Scan / No solutions / "N files" chips; a muted line says why a paper is not importable. A school line
  and "Select all N waiting" tick every queueable paper under them (half-ticked when some are).
- **Adding.** Ticking shows a bar at the foot of the section ("N papers selected · Clear · Add to import queue"). Add writes one
  db doc per paper to collection `importq`, id `d<doc_id>`: `{doc_id, label, course, year_level, order, added_by, at}`, after the
  ones already there, in the order shown.
- **Import order.** Above the grid: the queued papers in order (number, name, course and year, a warning if a paper has since
  been imported or can no longer be imported), with drag (desktop) or ↑ ↓ to reorder and × to remove (no confirm: it can be
  re-added). Empty state: "Nothing queued. Tick Advanced papers under By course and press Add to import queue." (13 Nov: the grid moved under By course ▸) A cost estimate per paper
  shows only if one is recorded (`cost_per_paper` in the inventory; none yet).
- Claude reads the order with `tools/import_next.py` (IMPORT_PLAYBOOK "New papers in the shared folder, and choosing what to
  import next").
- Code: `page_src/js/32_papers_q.js` (one page-wide name, `PQ`: `render`, `add`, `remove`, `state`), the shared order writer and
  drag-to-reorder (`writeOrder`, `sortableList`) now in `31_notes.js` and used by Next up too, `#invBox` in page.html,
  `css/22_papers_q.css` (all under `.procs`). Tests: the `papers: …` checks in tools/page_test.js.

## Rescan drive on Processes › Papers (13 Nov)
Owner, 13 Nov: "Where is the button to rescan the drive?" (earlier: "New exams are gonna be added to this folder periodically we
need a way to ... see what we actually haven't ingested yet").
- **Where.** A **Rescan drive** button on the Papers section's first line, right of "N papers in the shared folder · last folder
  scan <time>, K new". Curate, so editors only; a viewer gets nothing (no button, no connector request, no write).
- **How.** It walks the shared exam folder in Google Drive with the viewer's own **Google Drive** connector (runtime capability
  `mcp`, tool `search_files` only: one query per folder, `parentId = '<id>' and (mimeType = folder or PDF) and trashed = false`,
  `pageToken`, `excludeContentSnippets`). Read-only: it never moves, renames or changes anything in the shared drive (other staff
  use it). The folder id is `root_drive_id` in data/inventory.json (tools/inventory.py); `scan_skip` lists folders not walked
  ("Claude outputs").
- **Progress.** "Scanning Google Drive · N of M folders · K PDFs" with a bar (M grows as folders are found) and **Cancel**. A
  cancelled or failed scan saves nothing.
- **Known or new.** A Drive file is known when its Drive id (documents.drive_file_id, 303 files so far) or its path
  (case-insensitive) is in inventory `files`. A file with the same size as a recorded one is listed with "Same size as a recorded
  file" (probably moved or copied) and not counted as new; tools/scan_folder.py makes the real moved?/copy? call when Claude records it.
- **Copies and missing files (16 Nov).** Owner: "Where does point 13 exist?", "I want it now. How are we dealing with the dupes?",
  "duplicate exams will never be batched and imported right?" A folded row under Locked on Processes > Papers ("Copies and
  missing files · N copies, M moved, K missing"): each copy with its Copy and Original Drive links and the paper it belongs to,
  the last applied scan's moved files and the recorded files no longer in the folder. A copy is never batched or imported
  (tools/inventory.py held_list / copy_of; batch_check blocks otherwise). Read-only: a wrong match is reported to Claude.
  Owner 16 Nov (screenshot of the first version): "fix this blockers UI, can't tell anything from it just looks like a SUPER long
  list". Now: the row's summary is the verdict ("nothing needs you" / "N files need you"); inside, three folded parts (Copies set
  aside, Moved, No longer in the folder), each with its count and one line on what it means; one line per file: the paper's name
  (not the file name) and status, "copy in <folder>", and the Copy / Original links; long parts scroll inside their box.
- **Result.** "N new files since <the later of the last rescan and the last folder scan>", plus "M found in an earlier scan, still
  not in the record" and the same-size count. The list is grouped by course x year level (open for courses that are ready), each
  file with its folder, year, school and "Not a question paper" / "Not imported" where the rules exclude it. New files are
  classified with the SAME rules as tools/classify_paths.py: its `RULES` are written into the inventory (`rules`) and the page
  runs them (CODE_HEALTH rule 3), including the 13 Nov name fallbacks (`RULES.fallback`: "MA" = Advanced, the school at
  the start of "<School> Yr12 MA 2026 AT4 w Solutions", 1980s-90s years). The page test checks the page's port against the Python on every recorded path, and
  batch_check blocks an inventory whose rules differ from `RULES`.
- **Recorded files load on demand (13 Nov merge).** The list of recorded files the scan compares against (~3,300 after the
  Drive rescan) is `data/inventory_files.json` (inventory `files_url`), fetched only when Rescan drive is pressed or a saved
  scan is listed, so opening Processes stays at the ~360 KB inventory (CODE_HEALTH rule 6). The page test checks Papers opens
  without fetching it; batch_check blocks an inventory.json that carries the files itself.
- **Saved for Claude.** Each finished scan is one doc in db collection `scans`: `{at, by, root, new:[{id, name, path, size, course,
  year, yl, task, school, status, why, like?}], counts:{folders, pdfs, matched, new, like, since_last, groups}}` (at most 500 files;
  `counts.truncated` beyond). The section then shows "Found in the last scan, not yet in the record: N" with the note "Claude
  adds these to the record at the next import step." The sub line's "last scan" becomes the rescan when it is later.
- **No connector in this view** (`claude.use('mcp')` null, or the inventory has no Drive id): no button, a muted "Ask Claude to
  rescan".
- **Errors, one message per code** (never a generic banner): not allowed / declined (`not_in_manifest`, `approval_required`,
  `consent_required`), reconnect (`needs_reauth`), add the connector (`server_not_connected`), choose one (`selection_required`),
  organisation policy (`blocked_by_policy`), Drive's own error (`tool_error`), busy (`server_unavailable`, `rate_limited`). A
  retryable error waits (`retryAfterMs`, else 1.5-4 s) and is tried ONCE more, then the scan stops; it never loops. Limits: 3
  folders at a time, 60 pages per folder, 3,000 folders.
- Code: `page_src/js/33_drive_scan.js` (`PQ.scan`: render, last, start, stop, classify, state; no new page-wide name), the
  first line and hooks in `32_papers_q.js`, styles at the end of `css/22_papers_q.css` (all under `.procs`). Tools:
  `tools/classify_paths.py` (RULES), `tools/inventory.py` (root_drive_id, scan_skip, files, rules), `tools/scan_folder.py` (reads
  a scans doc). Tests: the `rescan: …` checks in tools/page_test.js (fake Google Drive connector with a small folder tree).

## Processes in two tabs: Work | Papers (13 Nov)
Owner, 13 Nov: "The process page feels a bit bloated now". Chosen: "Two tabs: Work | Papers".
- **Switch.** A small segmented **Work | Papers** beside the Processes title, the same control as Teach | Curate (`.areasw`, its
  sliding highlight; shown on phones too). Addresses `#processes/work` and `#processes/papers`; bare `#processes` opens the tab
  used last (`qg_proc_tab`, per browser), Work the first time, and the address then names it. Old `#import` lands on Papers.
  The header's running / queued pills link to Work.
- **Work:** Running now, Queued, Recently done (collapsed), Next up. Nothing else; sections 14 px apart (were 20).
- **Papers, top to bottom:** the top line (N papers in the shared folder · last scan, K new · **Rescan drive**, with its progress
  and results under it); **Import order** with the pause note as ONE quiet muted line under its label (no banner); the
  **course grid**; then **Import history ▸** (collapsed): the old import dashboard (tiles, batches, Needs your decision, log),
  with no heading of its own; its log shows the last 5 entries and "Show all N".
- **Course grid.** One row per course in the inventory's order (Advanced, Extension 1, Extension 2, Standard, Course not known),
  columns **Year 12 / Year 11 / Year ?**. A ready course's cell reads "imported / waiting waiting" (e.g. "52 / 139 waiting");
  any other cell (and a ready one with nothing importable) the papers in the folder; "–" when the folder has none. "N new" chip
  after a folder scan. The full counts are the cell's tooltip. A course that is not ready shows its note once, short ("needs
  course setup"; the full note is the tooltip). This replaces the 15 course x year rows and their In folder / Imported / Waiting /
  New columns.
- **Expanding.** Clicking a cell opens that group's papers under its course row ("Advanced Year 12 · 8 papers", then the same
  list, chips and ticks as before; one group open at a time; a second click closes it). Ticks are kept across groups. A
  not-ready group says "Listed so you can see what is there; these can't be queued yet."
- **Phone (390 px).** The grid stacks per course: the name on its own line, then three cells each labelled Year 12 / 11 / ?; no
  header row, no sideways scroll.
- Supersedes, as to layout: "Processes page" (the page, top to bottom), "Papers and the import order on Processes" (Where, Pause
  note, Grid, A group) and Rescan drive's "Where" (the button now heads the Papers tab). Everything else in them stands.
- Code: switch in page.html (`#procSw`), tab routing in `route()` / `parseHash` (09_router.js; `moveAreaSlider` now moves every
  `.areasw`), `renderProcesses` (tabs) and `renderImport` (log) in 12_import.js, the grid (`invGrid`, `invOpen`) in
  32_papers_q.js, styles in 06_import_jobs_tags.css, 19_areas.css (phone hide is now `header .areasw`) and 22_papers_q.css.
  Tests: `processes: Work | Papers switch and hashes`, `processes: Work sections and order`, `papers: top line, import order,
  quiet pause note`, `papers: compact grid counts equal the inventory`, `papers: … one group open at a time`, `papers: Import
  history collapsed; …`, `papers: phone 390px` (stacked grid), `papers (viewer): …` (no Curate on any Processes hash).

## Papers: one import list, old syllabus, New badge (13 Nov; list and grid superseded 14 Nov by "Papers: course lanes")
Owner, 13 Nov: "I can't tell. So does not imported and new mean not in scope? We should take questions too, we'll just have to
disretard out of scope things" and "but we already have 15 waiting batches?"
- **Old syllabus.** Pre-2019 (old 2 Unit) Year 12 Advanced papers are Waiting and tickable, with an "old syllabus" chip in their
  group and "· old syllabus" in the import order (inventory `old: 1`). Year 11 stays not tickable. The out-of-scope chip reads
  **Not in scope** (was "Not imported").
- **One list.** The planned batches are in the Import order (seeded from progress.json b6-b20). A faint divider ("Batch 6",
  "Batch 7", ..., small caps, muted, dashed rule; `role="separator"`, not draggable) sits before every 9th importable row; rows
  with a warning (already imported, can no longer be imported) are not counted, as tools/import_next.py skips them. The first
  number is the last finished batch in the import history + 1 (`batchState`), so it moves on by itself after each batch.
- **Import history** shows finished batches only (one "Finished" group, open inside the collapsed history); "No finished batches
  yet." when none.
- **New** is a small "+N new" badge on the cell's waiting number (or its papers number), not a chip of its own and never a column.
  Under the grid one legend line: "Imported: in the bank · Waiting: will be imported · Not in scope: set aside · New: found by the
  latest scan".
- Code: `invNextBatch`, `IVBATCH`, `IVLEGEND` inside PQ (32_papers_q.js; `PQ.queue` redraws the order when progress arrives),
  `batchesHTML` in 12_import.js, styles `.ivdiv`, `.ivnew`, `.ivlegend` in 22_papers_q.css. Tests: `papers: Batch N dividers every
  9 rows; history shows finished batches only`, the legend / badge asserts in `papers: compact grid counts equal the inventory`,
  the old-syllabus paper 9105 (tickable) and Year 11 9303 (waiting, not tickable) in page_test_fixture.py.

## Papers: summary, Import a course (Go), Running / next (13 Nov; superseded 14 Nov by "Papers: course lanes")
Owner, 13 Nov: "We need a general summary at the top of the Paper's tab of processes as well. How many papers found, how many imported, a brief breakdown and stuff. Set it up so that once the API is set up, we can choose a grade 11 or 12 and course Adv / std/ extension 1 and extesnion 2 and hit Go and the API would get called to import all papers which are on file but not imported from that level and grade. Is that the best way ? I'm getting CONFUSED with our current papers page". Chosen: "Yes, with batch pauses".
- **Top to bottom** (Processes › Papers, editors only): **summary card** · **Import a course** · **Running / next** · **Choose
  papers ▸** (the import order, collapsed) · **By course ▸** (the course grid with its ticks, collapsed) · **Import history ▸**
  (collapsed). (Review 13 Nov night: Running / next moved above Choose papers, as the build report and code comments described;
  it had been built below, where an open import order of 132 rows pushed the run out of sight.) Section labels are small caps h4, no h2/h3. Supersedes the order in "Processes in two tabs" (Papers); the rest stands.
- **Summary card.** First line unchanged: "N papers in the shared folder (M files) · last folder scan …, K new" + **Rescan drive**
  (its progress and results under the card). Three numbers: **imported** (in the bank); **can be imported** (current syllabus ·
  old syllabus); **set aside**, one line each: in other courses that need setup · Year 11, held until Year 12 is finished · course
  not known yet (cover check) · not in scope (zero lines hidden). Every paper is in exactly one bucket (`kind()` in
  34_papers_run.js: imported; pick → old / current; out_of_course; Year 11 waiting or "Year 11: …" → held; other waiting → course
  not known; the rest → not in scope). Live, 13 Nov: 52 / 513 (232 current, 281 old) / 2,093 (1,002 · 801 · 49 · 241).
- **Import a course.** Year select (12, 11) and Course select (the inventory's courses, not "Course not known"; inventory order:
  Advanced, Extension 1, Extension 2, Standard), **Go**. Shows "N not imported", "a current syllabus · b old syllabus", "K batches
  of 9, pausing after each one until you've cleared it in Review" and "Estimated cost US$lo–hi (estimate, US$12–17 a paper)"; a
  recorded inventory `cost_per_paper` (number, [lo, hi] or {lo, hi}) replaces the estimate ("Cost US$… (US$x a paper)").
  Disabled, with the reason in place of the counts: a course that is not ready → its inventory note ("needs course setup
  (topics, dot points, difficulty references)"); a ready course whose year has nothing pickable but held papers → "held until
  Year 12 is finished (your 13 Nov ruling)" (Year 11); nothing left → "nothing left to import in …"; an active run → "a run is
  already requested: cancel it under Running / next to start another".
- **Go → inline confirm** (never `confirm()`): "Start importing 486 papers, ~US$5,832–8,262?" **Confirm** / **Cancel**. Confirm
  writes ONE doc to db collection **`runs`**, id `r<ms>`: `{year, course, papers:[doc ids], batch_size:9,
  pause_after_each_batch:true, status:'requested', by, at}`. Paper order: those already in the import order first (in its
  order), then current syllabus before old, newest year first.
- **One active run** (status requested / running / paused) at a time. **Cancel request** rewrites the doc with
  `status:'cancelled', cancelled_by, cancelled_at` (kept, not deleted).
- **Running / next.** The active run as a card: "Year 12 Advanced · 486 papers", a status chip, and for `requested`: "Requested —
  Claude starts it when importing resumes; later the import API will start it directly." (`running`: "Claude is importing it
  now."; `paused`: "Waiting for you to clear the last batch in Review before the next one starts."), batches and request time,
  Cancel request. Then "Next from this run:" (or "Next from your import order:" when there is no run) with the next two batches
  under faint "Batch N" dividers (N counts on from the last finished batch, as the import order does) and "… and K more batches".
  Empty: "Nothing requested yet. Pick a year and course above and press Go, or choose papers one by one below."
- **Choose papers ▸** holds the import order exactly as before (drag, ↑ ↓, ×, Batch dividers, the pause note) and a hint with a
  link that opens **By course**. Add to import queue opens Choose papers.
- **db rule needed at publish:** `runs` editors only (read admin, write admin), like `importq` and `scans`.
- Code: `page_src/js/34_papers_run.js` (`PQ.run`: render, draw, request, cancel, choice, tally, kind; no new page-wide name), the
  layout and the shared `invRows` / `invCost` / `invUsd` in 32_papers_q.js, styles at the end of 22_papers_q.css (all under
  `.procs`; the folds reuse the `.phist` summary style in 06_import_jobs_tags.css; Go and Confirm use `button.act.primary`).
  Claude's side: tools/import_next.py (a run beats the import order), tools/sync_pagedb.py (`page_runs`), IMPORT_PLAYBOOK "Go".
  Tests: `run: …` checks (papersRun in tools/page_test.js) and the updated `papers: top line …` order check.

## Papers: course lanes, batches, one queue, Needs a check (14 Nov)
Owner, 14 Nov, choosing between three mockups: "I like A's design much more" (mockup A: Main + NeedsCheck), after "there seems
to be some inconsistencies in paper numbers". Then, about running the queue: "we might want to run multiple batches over the
night" and "Let's do 3 batches before the lock". **Supersedes** "Papers: summary, Import a course (Go), Running / next", the
import order and course grid of "Papers and the import order on Processes" / "Processes in two tabs" / "Papers: one import
list", and the 13 Nov per-batch pause. Import history (collapsed, at the bottom) and Rescan drive stand.
- **One status per paper** (tools/inventory.py `STATUSES`): imported · ready_current · ready_old · needs_check · held_y11 ·
  held_course · not_in_scope · duplicate, each with one reason (`statuses` text, or the paper's own `why`). Every number on the
  tab is a count of that one list, in papers; files appear only in the top line.
- **Top line:** "N papers in the shared folder (M files) · last scan <time> · K new since" + Rescan drive. New = first seen after
  the baseline scan (13 Nov, 8:42 pm; inventory `baseline_scan`), so 0 on 14 Nov.
- **Summary, four numbers that add up to the folder total:** imported · ready to import · <ready lanes> · need a check (year or
  course unknown) · held or not in scope (held_y11 + held_course + not_in_scope + duplicate).
- **Courses panel.** One lane per course + year level with ready papers (today: Year 12 Advanced). "5 batches imported (X cleared
  review, Y waiting) · 485 papers to go · 54 batches"; +1 batch, +2 batches, Queue all N (the lane's next batches not queued yet). A square per batch: cleared review (ok
  green) or imported, waiting for review (pale green, green border; "Follow-up rulings" below), in the queue (accent), ready
  current syllabus (accent soft), ready old syllabus (page background). Batches are fixed
  (tools/batches.py, inventory `lanes`): batch 1-5 = the finished b1-b5; batch 6 on = the owner's import order (132 papers, the
  planned b6-b20), then current syllabus newest year first, then old syllabus; papers found later start new batches at the end;
  numbering never reshuffles. A click opens the **batch panel**: "Batch 10 · 9 papers · current syllabus · 2022 · in the queue,
  5th", Add to the queue, ×, its papers (3 columns, 1 on a phone) each with **Swap** ("Swap moves the paper to the end of the
  course and pulls the next one in": every later batch passes its first paper back one, sizes and numbers stay; a batch with an
  imported paper is fixed). Swap is db `batches/<lane>` {course, yl, swaps:[{id, by, at}]}.
- **Needs a check lane:** "N papers: year or course not read yet. Sorted into lanes once checked." **Run the cover-page check**
  (writes a `runs` request {kind:'cover_check', papers}; Claude does the check later) and **Resolve** (#processes/papers/check).
- **Locked · N courses, M papers** (one folded row; N = Year 11 held + each course that needs setup, as the mockup's 4): one
  line per course + year of held papers with its reason (Year 11:
  "Held until Year 12 is finished (your 13 Nov ruling)"; other courses: "Needs course setup"). Then the legend.
- **Queue panel** (right; under the lanes when narrow): one ordered list across courses, db `queue/<lane>_<n>` {course, yl,
  batch, order, by, at}; ↑ ↓ and ×; "N batches · M papers", "Est. US$lo–hi" (US$12–17 a paper, or the recorded
  `cost_per_paper`); **Start the queue** writes `runs` {kind:'queue', status:'requested', stop_early, queue, papers, est, by,
  at} (Cancel sets cancelled); "Until the import API is connected, this sends the queue to Claude." (The 3-batch lock, "Let's do
  3 batches before the lock", was removed the same day: see "Follow-up rulings" below.)
- **Needs a check view** (#processes/papers/check, "← Import papers"): "N placed by better rules" (tools/classify_paths.py
  RULES_PROPOSED: rule, example path, result, papers, See all; **Accept all** writes db `scans/rules` {version, accepted, by,
  at} and the page applies the fixes at once from inventory `proposed`), then "N for you to place": paths, the rules' guess, a
  the cover + 3 question pages and the Drive link (below), Year 11 / 12 and course pills, Not in scope. Answers: db
  `paperfix/p<id>` {id, files, yl, course, out, by, at}; tools/inventory.py applies them (a rescan never asks again).
- **db rules at publish:** `queue`, `batches`, `paperfix`: read admin, write admin (like `importq`, `scans`, `runs`).
- Code: `page_src/js/32_papers_q.js` (PQ: model, summary, lanes, batch panel, Swap), `34_papers_run.js` (PQ.run: queue, Start,
  cover-page check), `35_papers_check.js` (PQ.check), `33_drive_scan.js` (PQ.scan, classifies with `PQ.rules()`), router
  `psub` in 09_router.js, styles `css/22_papers_q.css` (pr- prefix, under .procs). Tests: the papersLanes block in
  tools/page_test.js.

### Follow-up rulings (14 Nov, applied when import-lanes was merged onto Fix 1 + Fix 2)
- **No review lock.** Owner: "Maybe remove the lock for now since I'm in charge of import" (supersedes "Let's do 3 batches before the lock"). The queue runs every
  batch in it, top to bottom, until it is empty; no `limit` in the runs doc. The early stop stays (`STOP_EARLY`: a paper that
  loaded no questions, 3 or more unreadable pages, 13 or more Your calls). Queue text: "Runs top to bottom until the queue is
  empty. Stops early only if a batch comes back with unusual problems." Beside Start the queue, as plain text (information only,
  Start stays enabled): "N batches are waiting for review" ("1 batch is …", "No batches are …"). Below: "Estimate US$12–17 a
  paper" (or the recorded cost).
- **Review state on the lanes.** Owner: "I would like to see how many of the batches have cleared checks on the import page too, its good to know." Imported batch squares split in two:
  **cleared review** (solid green) and **imported, waiting for review** (pale green fill, 2px green border); legend (mockup wording): Imported,
  cleared review · Imported, waiting for review · In the queue · Ready, current syllabus · Ready, old syllabus. Lane line: "N batches
  imported (X cleared review, Y waiting) · M papers to go · K batches". The batch panel says "imported (b5) · X of N cleared
  review" and gives each paper a chip: "Cleared review", or "Waiting for review" linking to #review/paper/<doc>. **Cleared** = the
  paper's Review flow is complete: Review's own per-paper track (08_review.js `paperWork(doc).n === 0`: every step done, no open
  Your calls), which reads decisions through `RKEY` so the key docs `k_<key>` / `p_<paper key>` of Fix 2 count. Nothing is
  re-implemented (CODE_HEALTH rule 3): PQ.reviewState() calls it per file with questions and memoises on the reviews map. The
  reviews subscription (14_start.js) redraws the tab, so a decision in Review changes the square live.
- **Flags hold back the paper (17 Nov).** Owner: "if questions have been flagged but the spot check is done, the questions CANNOT be approved until all flagged questions are approved". A paper's one-click approval of its remaining questions is offered, and counts, only while no question in the paper is flagged or has a diagram with changes requested. When Claude fixes a flag the question stays flagged with a note of the fix (reviews doc `fixed: {note, at}`, shown as "Fixed: ..." above the decision buttons) until the checker approves it; a fixed diagram loses its 'changes' mark and keeps the request and the fix in `fig_done`, so it is back in Diagrams to approve; then the paper's approval counts again.
- **Nothing gets through with an open flag (17 Nov).** Owner: "exams should never get throug[h] until all flags are fixed right?" A question with a diagram change request counts as flagged (out of the tutors' Bank and the exam builder) until the redraw is approved, even if it was approved before; its paper is not "Cleared review" while any diagram in it waits on a change (that used to count as decided). Already-saved exams are not changed.
- **Exams show reported and flagged questions (17 Nov).** Owner: "that needs a way for it to be shown in the exam if it has been reported by teachers or put back in review by [the checker]". In the exam panel each such question says "⚠ reported by a teacher" / "⚠ sent back to review: swap it (⇄) or remove it before printing", with a notice at the top ("N questions in this exam have been reported or sent back to review since they were added"); My exams shows the count on the exam's card. It clears when the report is resolved or the flag approved.
- **Renames, case by case (17 Nov).** The checker asked to change names in 2024 Sydney Tech Q5 ("Change the names"), Q27 ("Change the name of the Department of Education") and Q29 ("turn basket ball into baseball"). Owner: "all ok, just for these": Q5's suburbs are Hillview and Riverside (text, solution, diagram), Q27 says "a government department", Q29 was a misprint fixed under "if the paper has a mistake, we should fix it". Not a standing rule: other rename requests still go to the owner.
- **A redraw needs its second check (17 Nov).** Owner: "are the 5 papers in auto approve really ready? what about the flagged checks". A diagram Claude redrew from a change request counts as open (like a flag) until the checker approves it again: its question is out of the Bank, its paper is not offered for one-click approval and is not cleared. (For a few minutes on 17 Nov a handed-back redraw counted as decided, so Kings AT1 and Abbotsleigh 2023 AT3/AT4 showed as ready.)
- **Fixed and back for you (17 Nov).** Owner: "is it easy for the checker to find questiosn coming back again?" The Review inbox shows a card "Fixed and back for you (N)" when any question's flag was fixed by Claude or a diagram was redrawn from a change request and not yet decided; it opens the list #review/list/back (also first in Other lists). Approving or re-flagging takes a question off it.
- **Scan tilt (17 Nov, checker).** On 2024 Oakhill AT2 Q25 the checker asked: "Make the whole graph not tilted to the left." That redraw is level, against DIAGRAM_SPEC rule 1 ("Follow a scan's slight tilt"); owner 17 Nov: "Draw level." (DIAGRAM_SPEC rule 1 now straightens a scan's tilt).
- **The HSC year, and Leave out (17 Nov).** Owner: "I don't get why I couldn't choose from the resolve page what to do as well. That was weird" (paper 5: he picked Year 12 and Advanced, the row said "Placed", but the paper had no year in its name or cover, so it stayed in Needs a check with nothing more to pick). Now a row whose paper has no year shows an **HSC year** field (the year the class graduates, saved as `y` in its paperfix doc; tools/inventory.py applies it); until it is filled the row says "Almost: type the year the class graduates (the HSC year), or leave it out." The set-aside button reads **Leave out** (his words: "yeah leave that paper out then"), and a left-out row says "Left out: it will not be imported."
- **Needs a check rows: the cover + 3 pages, a viewer and Drive.** Owner: "Needs a check rows show the cover + 3 pages picked at
  random from the question pages (enlarge on click) and an 'Open the whole PDF in Drive' link (Drive file id from
  inventory_files.json). The cover-page check renders the 4 images and stores them in the asset store (needs Fix 1)."
  - The card says (mockup): "... what it can't settle waits here with its cover and 3 pages picked at random from the questions.
    Click a page to enlarge it. Your answer is kept, so a rescan never asks again."
  - A strip of 4: Cover, Page n, Page n, Page n (thumbnails, 54 px wide). Until the paper has pictures, 4 dashed placeholders
    ("Cover", "Page"), not clickable.
  - Click a page: an in-page viewer (a modal `<dialog>`, real buttons: × Close, ‹ Previous page, › Next page) shows it full size
    with "<paper>: Page n" and "2 of 4"; ← / → step through the 4 (wrapping), Esc or × closes, a click on the backdrop closes,
    focus goes to Close on opening and back to the page clicked on closing.
  - "Open the whole PDF in Drive ↗" (the arrow, as in the mockup, marks the new tab): https://drive.google.com/file/d/<id>/view, new tab, from the paper's first file with a Drive
    id (inventory paper `g`, written by tools/inventory.py from documents.drive_file_id, the same ids as inventory_files.json).
  - Where the pictures live: one JSON pack per paper, `data/check/<paper id>.json` {v, id, seed, pdf_pages, pages: [{n, role,
    w, h, thumb, full}]} (WebP data URLs, 180 / 1100 px), listed in `data/check_pages.json` {papers: {id: {path, sha256, bytes,
    pages}}}. The page reads the manifest when Needs a check opens and fetches a row's pack when the row nears the screen, through
    `QG.url(path, sha256)` (Fix 1): from the asset store once data/assets.json lists the pack, else the published file. Made by
    tools/check_pages.py during the cover-page check (cover + 3 random question pages: blank, instructions, reference-sheet and
    writing-booklet pages skipped; fixed seed per paper, so they never reshuffle).
  - The rules' course guess is pre-picked (as the mockup shows), and the year when the rules read one: the pill shows pressed,
    nothing is saved until the owner picks; one tap on Year 12 then saves {yl: 12, course: <the guess>}. Tapping a pre-picked
    pill clears it. "Placed" only ever reflects what is saved.
- **Queue line at 1280 px.** "Year 12 Advanced · Batch 10" wrapped. The queue's basis is now 430 px (lanes 500 px), so a lane
  name, "Batch 10", Waiting and ↑ ↓ × fit on one line, and "Batch N" never splits (`.pr-nw`). Side by side from about 1000 px.
- **Code health.** All new styles are `.procs .pr-…`; no new page-wide name (PQ.reviewState / imported / waiting, PQ.check's
  viewer); removed: the run doc's `limit`, `PQ.run.LIMIT`, `.pr-limit`, `.pr-cover`, the `done` square state.

## Where else things are recorded

| What | File |
|---|---|
| Transcription and import rules | PARSE_SPEC.md |
| Tagging and home topic | TAG_SPEC.md |
| Solutions and criteria | SOLUTION_SPEC.md |
| Diagram rules (with history in DIAGRAM_FEEDBACK_LOG.md) | DIAGRAM_SPEC.md |
| Checker | VERIFY_SPEC.md |
| How to run an import, and the mistakes made so far | IMPORT_PLAYBOOK.md |
| Where everything lives, and how to resume | RESUME.md |

Copies: every spec is published with the page under `project/` and synced to the Drive folder.

- **Bank topic transitions (13 Nov).** Owner: "animation going between all topics and a subtopic. It's currently just snapping to it". Opening a topic slides the list forward and the clicked card grows into the heading; All topics slides back. View transitions (bankGo in 07_bank.js, css/23_bank_motion.css); snaps where unsupported; fades under reduced motion.
- **Logo v2 (13 Nov).** Owner: "Can the questgen logo be more sophisticated and elegant as well", chose option A, "top is fine": Fraunces at weight 480, optical size 72, the integral-tail Q kept in the accent colour. Header height 23px (21px on phones). Supersedes the 600-weight wordmark.
- **Bank filter pills slide (13 Nov).** Owner: "in the bank, the pills at the top, make them animated". Each filter group has one highlight that slides to the chosen option (bfPills in 07_bank.js; position kept across redraws in BFPOS). Appears without sliding under reduced motion.
- **Code health pass (13 Nov night).** Owner: "keep the code proper and [lean] as we develop", "run the refactor overnight". No visible change. The Bank list keeps one animation, bankGo's view transition: the list's own enter animation (swallowed by a comment in renderBank) was not restored, because it would run inside the transition and double the slide. Class names a view owns use its prefix (`pr-` Processes, `rv-` Review, `ex-` Exams) or sit under the view's root (`.procs .x`). The course name shown in the Bank, Review and Exams comes from `QG.courseData` (CODE_HEALTH.md "Health pass").

## Question keys: approvals follow the question (14 Nov, Fix 2)
The owner approved the plan doc "Questgen architecture plan: before imports resume" and said: "Ok we should run Fix 1 and 2". He ticked the readable key format.
- **Why.** Hiding the CSSA 2022 paper filed twice (docs 510 / 1346) put Q10-Q11 (274, 275, approved) behind unapproved copies 44, 45, so teachers lost them. Decisions were stored by question id, and the id the Bank shows can change.
- **Keys.** Every question has a permanent key named like the paper: `2022-CSSA-AT4-Q10`, a split question `...-Q11b`; a paper key is `2022-CSSA-AT4`. Copies (a duplicate, or the same paper filed twice) share one key. Made by tools/qkeys.py, stored in questions.db `question_keys`, shipped as bank `q.key` and `docs[d].key`.
- **Reviews** are written to `reviews/k_<key>` (questions) and `reviews/p_<paper key>` (paper approvals and paper calls). An approval on any copy counts for every copy. The page still reads the old `reviews/q<id>` and `reviews/paper_<doc>` docs as a fallback (copies merged: an approval wins, the newest note is kept) until a key doc exists; then the key doc decides. Code: `RKEY` in page_src/js/08_review.js; 14_start.js indexes the collection through it.
- **Saved exams** also store `keys` (parallel to `items`); opening one finds each question by key, as the copy the Bank shows, and falls back to the id. **Difficulty checks** store `key` and the part `part`, **reports** store `key`, so tools can re-attach them after a re-parse.
- Tests: page_test "keys: …" (the CSSA case, the fallback and the key write, saved exams load).

## Rescan drive: no cap, fixed order, folded list (16 Nov)
Owner 16 Nov: "So the rescan drive does not do a perfect job right?" then "Yeah can you fix it all?", and "once the scan
finishes, should't it just add it to the record? Instead of sitting in a massive list?"
- Every unrecorded file is saved (the 500-file cap is gone): rows go in parts of at most 200,000 characters, scans/<id> plus
  scans/<id>-p<k> {of, part, new}; the page and tools/scan_folder.py merge them.
- Each folder is listed in a fixed order (orderBy "modifiedTime desc"), as tools/drive_listing.py does.
- A note says how many PDFs were uploaded in the last hour: on 16 Nov a scan 35 minutes after a large upload missed 43 of the
  newest files (Google Drive's search had not caught up); rescan later to be sure.
- The page cannot write the record (questions.db); the night run records new files every night (NIGHT.md step 2), so the
  course groups start folded with their counts, and the note says the night run records them.


## Z-score table at the back (17 Nov)
Owner 17 Nov: "We need a way to append a z score table at the back of exams which ahve those questions tho" and "Questions
which have a pportion of the ztable in there arleady we will keep." Exam paper (not the marking guide): when any question
needs the table (bank q.zt from tools/ztable.py, or Review's "Z-score table at the back" toggle, reviews zt, which wins), the
last page is the standard normal table, computed by the page. Details: IMPORT_PLAYBOOK "Z-score table at the back of an exam".

## Fixed and back: the original flag beside the fix (17 Nov)
Owner 17 Nov: "For the fixed and back to you, the page image is gone and also we need to know what the original flag is so the
reviewer can compare". A returned item shows "Your original flag / request" and "What Claude changed" separately. Diagrams
open in Before -> now: original crop, the version the checker reviewed (data/cmp "v1:", rebuilt from git by
tools/redraw_before.py) and now; redraws from before 17 Nov have no kept earlier version and say so. Papers with an item back
in review keep (or get back) their page scans (tools/image_lifecycle.py).

## Flags waiting for Claude (17 Nov)
Owner 17 Nov: "Also in fixed and back to you, two of them had to get RE flagged, they should dissappear and be added to flags
waiting for claude. Make the flags waiting a drop down too so we can see". A question with a flag Claude has not fixed (status
flagged, no fixed) or a diagram change request (fig 'changes') is "waiting for Claude": it is never in "Fixed and back for you",
it has its own list (Review dropdown and Inbox card "Flags waiting for Claude"), and its top box shows the checker's flag.
Flagging again clears the old fix (fixed: null).

## Word export disclaimer (17 Nov)
Owner 17 Nov: "Add a disclaimer the word one is not tested on the user side." The exam preview's button reads "Download Word
(beta)" and a line beside it says the Word export is not yet tested by users: check the file before you print or send it.
Owner 19 Nov: "remove Word export is not yet tested by users: check the file before you print or send it." The line beside the button is
gone; the button keeps "(beta)" and the same words as its tooltip.
Remove both once the owner's "check pdf and word output" Next up item is ticked.

## One source of truth for tags (17 Nov)
Owner 17 Nov (QID 559 landed in a differential calculus exam while its tags read integration): "so which ones are meant to be
right? Screen or hiddeN?" then "yes clear the hidden choices and yes make sure it doesn't happen agai". A topic decision made in
Review (reviews.home for the whole question, reviews.tagres per part, reviews.tag_edits) is the part's tags everywhere:
effTags (03_tags.js) folds it in, so the chips in Review and the Bank, the year line, Reports and the exam builder's home all
agree. Changing a decision means writing the new pick, never deleting it (deleting reopened three questions in Review, 17 Nov).
The three 12 Nov picks that disagreed with the screen (2026 HSC Q32, 2025 HSC Q10, 2026 HSC Q29) now point at the screen's
tags; the old values are kept in reviews tagres_cleared.

## Year of a question's home (17 Nov)
Owner 17 Nov, on 2023 HSC Q32 (an areas question filed under Y11 Algebraic techniques because its two 3-mark parts tied and
the later part won): "change the tie rule. Y12 questions can NEVER show in Y11 bank, likewise vice versa. If it has ANY y12
parts, it goes straight to Y12." A question with any Year 12 tag (main or also, any part) is filed only under a Year 12 topic
(marks, then "the final answer decides", among its Year 12 topics; if its only Year 12 tags are "also" tags, those decide); a
question with none is filed under Year 11. A home picked by hand in Review that breaks this is ignored. Code: 07_bank.js homeOf
/ qHome; test "bank: a question with any Year 12 tag files under Year 12 only".

## Mathematics Standard questions leave the Advanced topics (17 Nov)
Owner 17 Nov, on QID 1633 (2024 James Ruse AT4 Q26, Standard bivariate data, filed under Y11 Constructing and using
functions): "Also found an out of course question in Y11". A question marked Mathematics Standard (q.std, from
questions.standard_topic) is filed in the Bank's "Mathematics Standard" group under "Outside the 2024 syllabus", never under
an Advanced topic, whatever its tags; the exam builders already leave it out. Kept for the future Standard bank.

## Skill gates in the exam builders (17 Nov)
Owner 17 Nov: "lets do skill gates, that's important"; earlier (12 Nov) "skills need to be gated like that" and "if theyve done diff
they can't do a diff question which contains int until they do int". On who sets "learnt": "we cann't assume that learnt is ticked.
for example a test might only have AP GP finance but AP GP by itself was learnt earlier."; his choice: "Learnt list, Y11 pre-ticked";
on the line counting the questions left out: "Include it yep." Rule in TAG_SPEC "Gating by what has been learnt".
- **Rule.** A question goes into an exam only when every topic its REQUIRED skills need (each skill's taught topic plus its
  prerequisites' topics; basic skills never gate; can-use skills never gate) is learnt. Learnt = the exam's own topics + the
  teacher's **Already learnt** list. When any Year 12 topic is in the exam, all of Year 11 counts as learnt (pre-ticked in the list;
  the teacher can untick any of it).
- **The exam's own topics.** Exam setup: the ticked subtopics. Pick by hand: the subtopics ticked in Exam setup, the homes of the
  questions already in the exam, and the topic being browsed (a focus area counts all its subtopics); "All questions" adds none.
- **Already learnt** (both builders; Exam setup: a group in the settings column, open; Pick by hand: a box above the list, folded).
  A compact tick list, Year 12 then Year 11, subtopics grouped by focus area, with "All Year 11" / "Untick all Year 11". The exam's
  own topics show ticked and greyed (they always count). Remembered per teacher across devices: page database
  `data/users/<user id>/learnt` (private to that person; this browser's copy when the database is not available).
- **Switch** "Show questions that need topics not yet learnt", off by default (not remembered). On, the builders work as before
  the gates; in Pick by hand each such card says "needs: Integral calculus › Primitive functions" under its header.
- **Line** "N questions left out: they need topics not yet learnt (mostly <focus area> and <focus area>)" whenever N > 0 (with the
  switch on: "N questions shown need topics not yet learnt ...: marked "needs""). Exam setup counts the ticked subtopics' pool;
  Pick by hand counts the list after its other filters.
- **What is gated.** Exam setup: the pool (selection bar count, What these topics can supply, Generate, Regenerate, Swap); each
  subtopic's count is what ticking it would bring in (a subtopic whose questions all need other topics shows 0 but stays clickable).
  Pick by hand: the list, the topic counts, Add 5 at random, Add all shown. **Not gated:** the Bank; saved exams (opening one keeps
  every question).
- Code: `XG` in page_src/js/23_exam_auto.js (one new page-wide name); exPool / exTopics / exLearnt / exFiltered / exSideNav in
  24_exams.js; QG.skills from the details file (tools/bank_split.py skill_gates); CSS at the end of css/12_exams.css (`xl-`).
  Tests: the `exams: skill gates …`, `exams: Already learnt …`, `exams: Year 11 starts ticked …`, `exams: basic skills never gate`,
  `exams: Pick by hand leaves gated questions out …`, `exams: the left-out line …` and `bank: skill gates do not touch the Bank`
  checks in tools/page_test.js.
- **No gate with nothing to judge against (17 Nov).** In Pick by hand, while the exam has no topics and no questions, the browse
  is "All questions" and the Already learnt list is empty, nothing is gated: a tutor's first view is the whole bank. As soon as
  a topic is ticked, browsed or added, or the learnt list has a topic, the gate applies.

## Costs and no hanging numbers (21 Nov)
- **Costs, owner 21 Nov (verbatim):** "I want to see somewhere the costs logged properly, per paper, per batch total. where should that go?",
  then "Yeah build it". Processes › Papers › **Costs** (collapsed, under Import history): one row per API batch (date, papers, questions,
  total, per paper, per question), a batch opens to its papers (cost, questions, per question) and its split by step; all batches' total,
  this month against the monthly limit, other API spend (e.g. the difficulty rating) listed apart, and batches 1-7 named as not metered
  (they ran inside sessions). Source: site/data/costs.json from tools/costs.py, built from every logged API call (state/work/api_import/
  */calls.jsonl) at every publish and after every batch. The queue's cost now uses the measured range (inventory cost_per_paper from
  costs.json); the 13 Nov typed-in "US$12-17 a paper" estimate is gone (with no measured batch the page says so).
- **No hanging numbers, owner 21 Nov (verbatim):** "make sure there's no hanging numbers anywhere which can go stale either. bad practice"
  (and 18 Nov: "Avoid in this entire app writing hard numbers like this, good practice is to link it somewhere right?"). Numbers about
  the data are computed, not typed: the Guide's database card and data-model diagram read row counts taken at each bank build
  (bank counts, tools/build_bank.py) with the build date; the diagram-confidence tooltips count "n of m reviewed were flagged" live from
  Review (the levels stay as set on 12 Nov); the flag-check hours and night-run time come from page db progress/night (flagcheck, time);
  batch size, pages per cover check and the baseline-scan date come from their settings or the inventory; file sizes and the script count
  were dropped. Settings stay named in one place (e.g. MONTHLY_LIMIT_USD in tools/costs.py, owner 18 Nov).
  Rest of the sweep, owner 21 Nov (verbatim): "can u clean the rest of the hanging numbers". The Big PDFs size limit comes from the
  inventory (big_mb = tools/inventory.py BIG); the Difficulty check's audit-flagged parts come from the bank (dif.f, from
  state/work/difficulty/audit_flags.json) and its thin topics are worked out (fewer than 5 HSC references, or a Year 12 topic with no
  band-5 reference, by the model's own ratings: the same three topics as the 14 Nov list); each Guide worked example checks its
  question still has the shape its text describes and is left out if not; the Import line's year level is the course's `years` setting.
