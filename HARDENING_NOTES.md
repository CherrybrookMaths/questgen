## Action 2: the page code split into page_src/ (14 Nov)

**Rule:** edit `page_src/`, then run `python3 tools/build_page.py`. Never edit `site/review.html` directly. Before you publish, also run `python3 tools/export_src.py`. The rule is written in UI_SPEC.md (header), RESUME.md and IMPORT_PLAYBOOK.md.

### What was done
- Pristine copies of the page before the change: `work/hardening/review.before.html` and `archive/pre_src_1114/review.before.html`.
- The sources were cut from the live page, not from the `*.js.txt` files. Three of those files were already older than the page: exam.js.txt, levels.js.txt and guide2.css.txt.
- The folder is `page_src/`, not `src/`, because `src/` holds the staged exam PDFs (`src/<id>.pdf`, `src/hsc/`). The rename happened at 12:37, part-way through this task.
  - `page_src/page.html`: the head tags and markup, with `<!-- build:styles -->` and `<!-- build:scripts -->` markers.
  - `page_src/css/01_base … 18_schema.css`: 18 files, each a contiguous slice in the original cascade order (base, bank, question, papers, review, import/jobs/tags, logo, exam, levels, phone, exam_auto, exams, mine, import_batches, guide, reports, theme2, schema).
  - `page_src/js/00_mathjax_config.js`, then the MathJax CDN `<script src>`, then the main script, then one block per later feature: 20_exam, 21_levels, 22_phone_menu, 23_exam_auto, 24_exams, 25_mine, 26_guide, 27_reports, 28_schema, 29_pdf, 30_word.
  - The main script is split into 01_core, 02_text, 03_tags, 04_solutions, 05_figures, 06_question, 07_bank, 08_review, 09_router, 11_papers, 12_import, 13_shell and 14_start. These files are still emitted as ONE `<script>` block, so hoisting and the order of event listeners are unchanged.
  - `page_src/build.json`: the order of the CSS and JS files, and which files share a script block.
- `tools/build_page.py` is deterministic and prints a size summary.
  - It refuses a css/js file that build.json doesn't list, and a literal `</script` or `</style`.
  - `--check` exits 1 if site/review.html is out of date. Use it in the pre-publish test.
  - Output: 475,534 bytes (was 487,432). CSS is 143,699 bytes in 1 `<style>` block; JS is 313,274 bytes in 13 `<script>` blocks.
- `tools/export_src.py` mirrors `page_src/` into `site/project/page_src/` (.js → .js.txt, .css → .css.txt).
- Archived to `archive/pre_src_1114/` (see its README):
  - `site/*.js.txt` and `site/*.css.txt` (16 files);
  - `site/project/*.js.txt` and `site/project/*.css.txt` (16 files);
  - `tools/patch_exam_auto.py`, `tools/patch_exams.py`, `tools/patch_reports.py` and `tools/patch_theme2.py`.

### Patch layers folded (each function now has ONE definition)
- **xCount** (20_exam): the refresh of the Exams page head, result and labels is inlined. It was wrapped twice, by exams and by mine, and the second exHead call was redundant. `typeof EXV` guards the call made at load, because 24_exams.js loads later.
- **xPanel** (20_exam): the "This exam" heading, the band note, the Swap and Lock buttons and the locked class are now drawn in the row template, not patched into the DOM afterwards. The pick-list count refresh is at the end. The stage-2 drawer wrapper in exam_auto was dead code, because exams replaced it, so it is removed.
- **xQ** (20_exam): one function now does three things:
  - editable answer lines through `exLines(q,p)`, in 24_exams, in place of the old xLines-then-regex;
  - the dot-point / Report source line, drawn directly;
  - figure-size wrappers. These are still applied to the finished HTML, because tex() also writes inline `\exfigure` slots.
- **xSaveDb** (20_exam): the full save, then the My exams / Saved-marker refresh. As before, the refresh runs even when there is no database.
- **xDownload** (20_exam): the clean clone of the pages, then the file, in try/finally.
- **xPreview** and **xCover** (24_exams): the exams versions replaced the stage-1 ones, so the stage-1 code is deleted. The Download PDF and Download Word buttons are added at the end of xPreview, once the pages are laid out, as the pdf.js and word.js wrappers did.
- **exHead, exRefresh, renderExams** (24_exams): the My exams parts are folded in. The "My exams" button and `#exMine` are now in the template. In My exams view, the setup view is still drawn underneath and hidden, as before.
- **renderGuide** (26_guide): guide v2 is now a plain function declaration. The old v1 renderGuide and guideTagTable were dead and are removed. GUIDE_EX moved into 26_guide.js.
- All `// owner <date>` comments stay with the code they explain. The comments of deleted code are still in review.before.html.
- The `typeof X==='function'` guards between modules are left as they were.

### Proof of equivalence
Command: `node equiv.js <before|after> <page>`, then `python3 compare.py`. Both are in the scratchpad at hardening/refactor/.
- Setup:
  - site/ is served on port 8842.
  - CDN URLs are routed to the local npm copies.
  - The page is wrapped in a doctype skeleton.
  - Math.random is seeded and the clock is fixed.
  - The page database, user and downloads are faked, with one seeded saved exam.
- Coverage: 1280 and 390 px, light and dark. Views visited:
  - bank: home, a subtopic, show-everything plus cards;
  - exams: setup, pick and mine;
  - review, reports, papers, import and levels;
  - guide: For users and For developers;
  - the generator: Generate exam, then exam preview and guide preview;
  - save, then My exams.
- Results:
  - **72 of 72 views:** identical visible text, identical counts (19 selectors plus the total element count), identical toolbar buttons and exam items, and no page errors. The only console errors are the Google Fonts requests the test blocks, in both runs.
  - **Exports:**
    - Word (exam and guide): the docx parts are byte-identical.
    - PDF: 13 pages, byte-identical apart from dates and IDs.
    - HTML (exam and guide): identical apart from the 2 removed theme2 marker comments (50 bytes).
  - **Byte check before folding:** the mechanical split rebuilt the original page byte for byte, apart from the banner line and the 2 theme2 marker comments. So the CSS and markup are unchanged. The only JS differences are the folds listed above.
- Screenshots: hardening/refactor/shots/ in the scratchpad. Note: another agent began rerunning equiv.js into the same folder at 12:37, so the files there may come from its run.

### Left undone / for later
- 23_exam_auto.js still holds the stage-2 drawer helpers (xaHTML, xaSummaryHTML and others). Nothing calls them since the Exams page replaced the drawer. Remove them in a later pass and re-run equiv.js.
- 06_import_jobs_tags.css is a grab-bag: import, the jobs pill, paper filters, the tag review and the old guide's `.g*` rules. To split it further you would need to reorder CSS, so do that only with a computed-style check.
- The CDN URLs (00_mathjax_config.js, build.json, 29_pdf.js, 30_word.js) are unchanged. Action 3 should edit them in page_src/.
- Nothing was published.

### Action 2 addendum (12:55)
- After the page_src/ move, the equivalence run was repeated against the built site/review.html (475,534 bytes, before action 3 touched page_src/): 72/72 views identical, no page errors, exports identical as above.
- tools/export_src.py now copies an explicit whitelist only (page.html, build.json, css/*.css, js/*.js from page_src/) and asserts no .pdf; src/ (231 PDFs + src/hsc/) was never moved or copied.
- From 12:51 the action-3 agent edits page_src/ (vendor paths); `build_page.py --check` passes on its build (476,063 bytes). Those changes are not covered by my equivalence run; re-run equiv.js after action 3.
- UI_SPEC Guide lines now name page_src/js/26_guide.js, 28_schema.js.

## Action 3: outside code bundled into site/vendor/ (14 Nov)
Nothing was published. The page now loads nothing from a public CDN. Pristine copies: work/hardening/review.before.html (before action 2) and work/hardening/review.before_vendor.html (the action 2 page this step started from).

### What the page requested (measured, not guessed)
A Playwright run of the old page served every `cdn.jsdelivr.net/npm/...` URL from the local npm copies and logged it. The run exercised the bank (with Show everything and cards, scrolled), Review, Levels and Guide; a sweep that typesets **every** maths string in bank.json and dotpoints.json (8,567 strings, 25,810 expressions, including \boldsymbol, cases, array, aligned, gathered and integrals); and the exam and marking-guide preview with HTML, PDF and Word downloads. The complete set of outside requests:
- mathjax 4.1.3: tex-svg-nofont.js, a11y/assistive-mml.js, input/tex/extensions/boldsymbol.js
- @mathjax/mathjax-termes-font 4.1.3: svg.js, svg/dynamic/script.js, svg/dynamic/double-struck.js
- html-to-image 1.11.11 dist/html-to-image.js; jspdf 2.5.1 dist/jspdf.umd.min.js; docx 9.0.2 build/index.umd.js; mathml2omml 0.5.0 dist/index.js (ES module, dynamic import)
- the two Google Fonts stylesheets (and their woff2 files)

### What is vendored (site/vendor/, 155 files, 5,853,314 bytes): the measured set plus a margin
| folder | files | bytes | contents |
|---|---|---|---|
| mathjax-4.1.3/ | 48 | 1.3 MB | tex-svg-nofont.js; a11y/assistive-mml.js; **all 41** input/tex/extensions/*.js (any \require or autoload, e.g. cancel, mhchem); ui/*.js; LICENSE.txt |
| mathjax-termes-font-4.1.3/ | 21 | 2.0 MB | svg.js + **all 19** svg/dynamic/*.js chunks (1.4 MB), so any new symbol range works; LICENSE.txt (MathJax's Apache-2.0: the font package ships none) |
| html-to-image-1.11.11/, jspdf-2.5.1/, docx-9.0.2/, mathml2omml-0.5.0/ | 2 each | 1.2 MB | the one file each that the page loads + LICENSE.txt (MIT; mathml2omml is LGPL-3.0, published unmodified) |
| fonts/ | 78 | 1.6 MB | fonts.css + 73 woff2 + 4 OFL licences: Inter 400/500/600/700, Fraunces (opsz axis) 500–600, IBM Plex Mono 400/500, Tinos 400/700 roman + italic; every unicode-range subset Google serves. Files from the fontsource npm packages (5.3.0), fetched from the npm registry. |
Not vendored: MathJax's speech/SRE files (the config turns speech off) and source maps (only devtools asks for them).
Artifact limits: 155 files and 5.9 MB, well under 255 files / 64 MB, and only .js, .css, .woff2 and .txt.

### Page changes (page_src/ only, then tools/build_page.py)
- `js/00_mathjax_config.js`: `const VENDOR=new URL('vendor/',document.baseURI).href`; MathJax loader paths `mathjax`, `fonts` and `mathjax-termes` point into it.
- `build.json`: the MathJax `<script src>` is `vendor/mathjax-4.1.3/tex-svg-nofont.js`.
- `js/29_pdf.js` PDF_LIBS and `js/30_word.js` WORD_LIBS use `VENDOR+...`. (The load-failure message now cuts the name at `/vendor/`.)
- `page.html`: the preconnect and two Google Fonts links are replaced by `<link rel="stylesheet" href="vendor/fonts/fonts.css">`.
- `js/20_exam.js`: **Download HTML** used to copy the page's `<link rel=stylesheet>` tags into the file. A relative vendor link would not resolve in a downloaded file, so the file keeps the exact Google Fonts links it always had (`EXPORT_FONT_LINKS`). The HTML downloads are byte-identical to before.
- Page: 476,063 bytes (was 475,534).

### Tools
- `tools/vendor.py --check`: every manifest file present with matching size and sha256, no extra files, plain web types only, within limits. Exit 1 on a problem. `--fetch [--nm DIR] [--fonts DIR]` rebuilds site/vendor/ and the manifest from npm copies (only needed to change a version; the vendored files are the source of truth now).
- `tools/vendor_manifest.json`: `files` is the ready publish map (`"vendor/...": "site/vendor/..."`, paths relative to /home/claude/pilot), and `detail` has bytes, sha256 and origin per file.
- `tools/build_page.py` (build and `--check`) now fails if the vendor check fails, if the page names a `vendor/...` file that is not in the manifest, or if it names cdn.jsdelivr.net / unpkg.com / cdnjs or has a `<script src>` on another host. Tested: a stray file in site/vendor/ made `--check` exit 1.
- `tools/batch_check.py`: a vendor problem is a BLOCKER; site/vendor/** is now part of the published manifest, so changed vendor files show up in the "changed since the last publish" warning (right now it lists review.html + the 155 new vendor files).
- Copied to site/project/: vendor.py.txt, build_page.py.txt, batch_check.py.txt, vendor_manifest.json, and the updated UI_SPEC.md, RESUME.md and IMPORT_PLAYBOOK.md.

### Verification, ALL outside requests aborted (script: scratchpad hardening/vendor/vtest.js)
`node vtest.js blocked site/review.html blocked_after` routes every request that isn't to 127.0.0.1 to abort (jsDelivr, Google Fonts, anything):
- 0 outside requests made, 0 aborted, **0 page errors, 0 console errors**.
- Maths sweep: 8,567 strings → 25,810 expressions, 0 MathJax errors. The hash of the typeset output is **identical** to the old page run against the local CDN copies (ab985856c3f9c91de4d28f48).
- Views: MathJax counts in every view are identical to the old page's (bank 79/172, review 200, levels 201, guide 203, exam preview 295, guide preview 407).
- Exports, exam and marking guide:
  - HTML downloads: byte-identical to the old page's.
  - Word: every part inside the .docx is identical.
  - PDF: 14 and 20 pages. With the vendored fonts also blocked (`NOFONTS=1`, which matches the old runs where Google Fonts could never load in the sandbox), both PDFs are identical apart from dates and IDs. With the fonts loaded, the sizes differ by a few hundred bytes, because the real Tinos web font now loads and lays out the text. That is what the published page did with Google Fonts.
- Fonts: with everything outside blocked, Inter 400/500/600, Fraunces and Tinos load from vendor/fonts/ and the headings render in Fraunces (screenshots in hardening/vendor/shots/). Only the latin subsets were fetched for this content.

### For the main session (publish)
- Publish review.html together with every file in `tools/vendor_manifest.json` → `files`: 155 files, 5.9 MB, one call, under the limits. Data files that changed can go in the same call while the total stays ≤ 255 files and 64 MB; otherwise send them in a second publish to the same URL. Files left out of a later publish are kept.
- The page's references are relative (`vendor/...`, resolved from document.baseURI), so the vendor files must sit next to review.html at exactly the manifest paths.
- After publishing, open the live page once and check the browser's network list: nothing should come from jsdelivr or Google. The artifact CSP has never been tested with a same-origin `import()` of `vendor/mathml2omml-0.5.0/dist/index.js`. If Word export fails live, that is the first place to look.

### Left undone
- The live artifact cannot be tested from the sandbox. All tests ran against a local http.server copy.
- Font files are from fontsource 5.3.0, not byte-for-byte the files Google serves. They are the same typefaces and subsets, so check a screenshot of the live page once.

## Action 1: automated test before every publish (14 Nov)
Nothing was published. Pristine copy of the page this step started from: `work/hardening/review.before_pagetest.html` (476,063 bytes, the action-3 build). `review.before.html` and `review.before_vendor.html` are untouched.

### How to run
`bash tools/prepublish.sh` runs five steps and stops at the first failure: `build_page.py`, `export_src.py`, `page_test_fixture.py`, `node tools/page_test.js`, `batch_check.py`. It takes about 1 minute. Exit 0 means it is safe to publish. The full guide is IMPORT_PLAYBOOK "Pre-publish page test".

### Files
- `tools/page_test.js`: Node + Playwright, fully offline.
  - It serves `site/` itself on a free port, with review.html wrapped in the publish skeleton.
  - It aborts and lists every non-localhost request. A CDN request fails the run; Google Fonts is tolerated.
  - It fakes `window.claude.use`:
    - `db`: in memory, with `collection().onSnapshot` and `doc().set/get/delete/onSnapshot`; writes are logged.
    - `user`: `id()` and `profiles()`.
    - `downloads`: the filename, size and bytes go to `work/page_test/downloads/`.
  - `Math.random` is seeded, so runs repeat exactly.
  - Output: 64 named checks, with a screenshot of each failure in `work/page_test/shots/`. The result goes to `work/page_test/last_result.json`, with the sha256 of review.html, bank.json and dotpoints.json.
  - Options: `--quick`, `--headed`, and `--page FILE` (test another build into `*_other`).
  - A built-in zip reader (Node zlib) checks the .docx, so there is no JSZip dependency.
- `tools/page_test_fixture.py`: seeds the fake database from the questions.db mirror (`page_reviews` / `page_difficulty` / `page_exams` / `page_reports`; today 1,066 reviews, 99 difficulty, 1 exam). The Bank therefore shows the real approved set, and Review and Difficulty show the real queues. It is read-only.
- `tools/prepublish.sh`: the five steps above.
- `tools/batch_check.py`: a new BLOCKER when the page test is missing, failed, a `--quick` run, tested different page or data bytes (sha256), or is older than review.html. A passing run shows as `info`. All five cases were tried by editing a copy of the result file, and each one blocked.
- `tools/build_page.py`: an unchanged build no longer rewrites review.html ("unchanged: …"), so a passed test is not made stale by its date alone.
- Copied to `site/project/`: page_test.js.txt, prepublish.sh.txt, page_test_fixture.py.txt, batch_check.py.txt, build_page.py.txt, UI_SPEC.md, RESUME.md and IMPORT_PLAYBOOK.md. `export_src.py` was re-run.

### Checks (all pass on the current build, 56 s)
| Area | Checks |
|---|---|
| Every tab | 11 views (bank subtopic, exams setup/pick/mine, review, reports, papers, import, levels, guide users/developers) × 1280/390 × light/dark = 44 checks. Each fails on a page or console error, horizontal page scroll, a hidden or empty container, missing maths where expected, or a MathJax error. Review and Difficulty have empty queues with the real data, so the check opens "Every question" or "All" to have a question on screen. |
| Bank | open a subtopic (55 cards, 73 maths); search "annuity" (29); + Add to exam |
| Exams | generate 60 marks / 6 MC (asserted, plus the preview header); exam and guide sheets ≤ 297 mm and none empty; Swap, Lock, Regenerate keeps the lock (and is not the same exam); Save → My exams; rename; delete |
| Exports | PDF `%PDF-`…`%%EOF`, 17 pages = 17 sheets; Word exam (77 m:oMath) and guide (282), no fallback; HTML: no contenteditable, no .scr-only, same sheet count |
| Review / Difficulty | Approve writes `reviews/q202` status approved and moves to 203; Agree writes `difficulty/160` agreed and moves on |
| Reports | report from the paper → one `reports/` doc (difficulty, band 5, open), the link reads "Reported"; the Reports tab lists it and the badge matches |
| Phone menu | 8 links, goes to Papers, closes, no horizontal scroll |
| Offline | no request left localhost (none were made) |
A mutation test (a page with an error thrown in renderPapers) failed the 3 checks that touch Papers, as it should.

### Page bugs the test found, fixed in page_src/ and rebuilt (480,635 bytes, sha256 e285c3141074)
1. **The cover ran past A4.** A 60-mark paper over all topics has 12 "Marks by topic" rows, which made the cover sheet 1,322 px against 1,123 px (≈350 mm). The PDF and print crop each sheet to 297 mm, so the table's last rows and the Total row were cut off. Fix (`24_exams.js`, xPreview): only when the cover is taller than the page, `.extopictbl` moves to its own `xblk cover cvcont` page straight after the cover. `30_word.js` still reads it onto the Word cover and skips the `cvcont` block.
2. **One part taller than a page stayed whole.** Marking-guide sheet 28 was 1,225 px (≈324 mm): QID 1100's worked solution (two methods) was one part, so the between-parts cut could not split it, and the rubric and marker's note were cropped off the PDF. Fix (`24_exams.js`): new `exCutTall` / `exCont` cut such a piece inside the part, at the deepest stacked container, into a "(continued)" piece.
   - Shallow copies of the wrappers keep the layout: the part's grid keeps empty label and marks columns, and the solution rule continues.
   - Maths, images and tables are never cut.
   - Shells are marked `data-cut`. The Word export puts the question back together first (`exRejoin`), and the .docx is byte-identical to before.

The owner's comments stay with their code; the new code carries "hardening 14 Nov (page test)" comments.

### Equivalence
- Exams that fit: on the old build (`review.before_pagetest.html`) and the new build, two seeded exams (40 marks over 8 topics; 30 marks over 3 topics) gave **byte-identical** Download HTML for the exam and the guide, with the same page counts. The script is in the scratchpad (hardening/pagetest/eq.js).
- The 60-mark test exam:
  - **Word** (exam and guide): identical to the old page in every part except docProps/core.xml (the timestamps).
  - **HTML and PDF**: they differ only by the fixes. The exam now has 17 pages instead of 16 (the topic table's own page), and the guide has 29 sheets with nothing cropped.
- On the old page, the test fails exactly the two "sheets fit A4" checks (`work/page_test/other_result.json`).

### Left undone / notes
- The fixture is only as fresh as the questions.db mirror (synced 13 Nov 11:52). Run `sync_pagedb.py` on a new page export first if the queues matter.
- The live artifact itself is not tested; every run uses the local copy and the fake capabilities.
- The tab sweep checks layout and errors, not the look. Screenshots are kept only for failures.
- `site/project/` still holds `patch_*.py.txt` copies of the archived patch scripts. Action 2 archived the tools but not these published copies. They are harmless, but they could be deleted with `null` in the next publish.
- The page itself was not published: it changed (review.html and site/project/), so batch_check lists it among the changed files.

## Reviewer pass (14 Nov, after actions 1-3)
- `bash tools/prepublish.sh` from scratch: exit 0, page test 64/64 in 57 s, batch_check 0 blockers / 2 warnings (triage re-run; 156 files changed since the 12:09 publish). Re-run after the fixes below: same result.
- Deterministic build: removed site/review.html and built twice; both sha256 e285c3141074..., same as before; `build_page.py --check` up to date.
- Behaviour vs work/hardening/review.before.html (sha256 0f298ebd15dc, identical to archive/pre_src_1114/review.before.html): refactor's equiv suite re-run (bundled fonts blocked so both pages lay out alike), 72 views: visible text and every counted element identical; the only difference is 2 fewer `<link>` elements in the head (3 Google Fonts links -> 1 vendor/fonts/fonts.css). 40-mark exam: PDF 13 pages identical apart from dates/ids, both .docx identical inside, both HTML downloads identical apart from the two theme2 marker comments.
- Owner rulings spot-checked on both pages (scripted, outputs identical): nav pill sits exactly on the open tab and slides (transition transform, width); phone header names the open tab with no count, menu lists the 8 tabs with counts + Theme, closes on Esc and on an outside tap, navigates; guide For users | For developers switch, remembered across reload; Difficulty tab (#levels) header 53 px on a phone; My exams shows the "not been saved" banner after Generate and lists the saved exam.
- Archive: archive/pre_src_1114/ holds the 16 site/*.txt, their 16 project copies, the 4 patch scripts and the old page.
- Fixes: `export_src.py` now exports page_src/page.html as `page.html.txt` (an .html under project/ would be served as a second page on the artifact). Refreshed stale project copies dotstyle/house_style/tables.py.txt (stale since 12 Nov). Moved site/project/patch_*.py.txt to archive/pre_src_1114/site_project_tools/. New `tools/publish_set.py` prints the exact publish set incl. project/ (batch_check's warning ignores project/) with limit checks, `--json` for the files map; prepublish.sh prints it last. `batch_check.py --mark-published` now records project/ too.
- Publish set now: review.html + 155 vendor + 60 project = 216 files, 7.0 MB (limit 255 / 64 MB). Whole artifact after publish: 461 local publishable files, 186 MB (+ up to 20 archived project files still live unless nulled) vs the 511-file / 256 MB version limit.

## Stage 1: version control (15 Nov)
Owner: "would I have to manage version control? I don't want to have to do that." So git is fully automatic: `.gitignore` (allow-list), `tools/snapshot.py` (publish snapshot + tag, `--bundle`, `--rollback TAG [--yes]`, `--status`), called from `batch_check.py --mark-published` (warn-only, never blocks). batch_check adds an info line with the last tag, or a warning if the repo is missing. Baseline commit tagged `baseline-v199`. Tested on a scratch clone: commit + tag, no-change publish (tag only), `--version`, duplicate tag (warns), rollback dry-run and `--yes` (file added after the tag removed, edit reverted, pre-rollback tag kept), unknown tag, missing repo (WARN, exit 0). No page change, so no new page_test check. Details: RESUME.md "Version control".

## Stage 2 (15 Nov): unused data cut, per-paper packs merged
- Checked every page_src/ reference: `data/focus/` is fetched only by `focusPack()` inside `FOCUS_STEPS` branches, and `FOCUS_STEPS=[]` (owner 12 Nov rollback), so it is dead: archived to `archive/data_unused_1115/focus/`, excluded from the publish set. `data/cmp/` is live (Review "Overlay" / "Before → now", `cmps()` in 05_figures.js), so it was merged, not dropped.
- `tools/packs.py` merges per-paper svg/cmp packs into group files `data/<kind>/g<n>.json` (svg 8 groups by paper id % 8, 2.6-6.8 MB each; cmp 1 group, 5 MB). Contents are verified key-for-key before the originals move to `archive/packs_perpaper_1115/`. Loading is still lazy (fetched on first use, cached per group file); a first redraw now waits for its group (avg 4.5 MB) instead of its paper (avg 0.6 MB), and later papers in the same group are instant.
- page_test check "figures: every redraw and overlay loads from the grouped packs" (all 979 redraws resolve, overlays load, `hydrate()` sets data URIs, no per-paper or focus request). batch_check blocks leftover per-paper files, a missing group, or PACK_G ≠ GROUPS, and warns while published paths still await their null.

## Stage 3 (15 Nov): Teach | Curate split
- Router (09_router.js) maps hashes to views through one table; internal views `levels` and `reports` are kept, so 21_levels.js and 27_reports.js need only small changes (step counts), but they are reached as `#review/difficulty` and `#review/reports` and drawn under the Review step row (`renderSteps` in 08_review.js, `.rbar.xstep` hides the paper picker and ← →).
- `EDITOR` is null until `claude.use('user')` answers (isOwner || canEdit), then true/false. While null a Curate hash shows the Bank without rewriting the address; once false it is rewritten to `#bank`.
- page_test: `fakeClaude` takes `{seed, role}`; `boot()` also waits for `EDITOR !== null`. 9 new checks (editor 4, viewer 3, no user capability 2; see IMPORT_PLAYBOOK).

- 13 Nov, v201: owner confirmed the Teach | Curate switch shows on the live artifact ("I do see that switch"), so isOwner()/canEdit() resolve live.
