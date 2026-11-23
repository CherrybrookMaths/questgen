# Mathematics Standard: course setup (started 23 Nov)

Owner rulings, verbatim (record new ones here and next to the code, `// owner <date>: "..."`):
- 23 Nov: "we need to start working on the standard course".
- 23 Nov, which Year 12 course first (asked: Standard 2 first / both / Standard 1 first): "Standard 2 first (Recommended)". Standard 1
  dot points are extracted too (same document, no cost) but nothing else is built for Standard 1 yet.
- 23 Nov, pacing (Advanced averaged US$3.86 a paper; about 210 Year 12 Standard papers; US$300 monthly API limit): "Pilot batch first
  (Recommended)": set the course up (no API cost), then import one batch of 9 and measure the real Standard cost before the rest.
- 23 Nov, Year 11 Standard papers (127 in the folder): "yes finalise Y12 first, it'll contain decent Y11 questions anyways". Year 11
  Standard papers stay out of the import queue, as Year 11 Advanced (owner 13 Nov).
- 23 Nov, questions on content that is not in the 2024 syllabus: "keep them out but don't drop yet". Imported, marked old syllabus,
  kept out of topic lists and exams; never deleted.
- 23 Nov, reviewer: "same checker". Standard is reviewed by the same checker in the same Review page (per course).
- 23 Nov, pilot timing: "once setup is done". The pilot runs when the setup list below is finished, not before.

## Syllabus
- 2024: "NSW Syllabus - Mathematics Standard (11-12).pdf", CMC Resources shared drive, id 1DDmgXTTwM3owUqKH-45eqCKx1ukqnSdt (read only).
  Implemented from 2026 (Year 11), Year 12 from Term 4 2026, first HSC exam 2027. One Year 11 course for both; Year 12 splits into
  Standard 1 (MST-12-S1-01..07) and Standard 2 (MST-12-S2-01..10).
- 2017 (what every paper in the folder was written for): "mathematics-standard-stage-6-syllabus-2017.pdf", id
  1AikOE4rMBGqOnQ4FDtdkjN6Y8WtRZzVr.
- Dot points: `python3 tools/standard_syllabus.py <2024 syllabus pdf>` -> state/work/skills/standard/dotpoints.json: 333 (119 Year 11
  common S11-nnn, 143 Standard 2 S2-12-nnn, 71 Standard 1 S1-12-nnn). 47 formulas corrected by hand (the PDF text layer garbles
  fractions and powers); all 127 formulas render in KaTeX.

## Setup list (the pilot waits for all of it)
1. Dot points from the 2024 syllabus. DONE 23 Nov.
2. 2017 vs 2024 comparison. DONE 23 Nov: state/work/skills/standard/compare_2017_2024.json, every 2017 Year 11 and Standard 2
   content point (sub-bullets separately): 164 kept, 29 moved, 12 changed, 13 removed; 38 new 2024 points. Removed terms checked by
   search (absent from the 2024 text, present in 2017): measurement error and limits of accuracy, percentiles/deciles, calories and
   kilojoules, the International Date Line, timetables, Pareto charts, statistical (z-) tables, simulation. Questions on removed
   content are old syllabus (owner: "keep them out but don't drop yet"). Moved: Year 11 probability -> Year 12; networks, MSTs and
   shortest paths Year 12 -> Year 11; simple interest, straight-line depreciation and electricity costs Year 11 -> Year 12.
   Borderline calls, owner 23 Nov: "If they're out then flag them as such. 4 is fine.": questions needing z-tables, pure similar
   figures (scale factor outside maps and plans), the International Date Line, timetables beyond plain elapsed time, and forming a
   quadratic model from a description are old syllabus (flagged, kept out, not dropped); a given quadratic model is in.
3. Skills. Owner 23 Nov on the first draft (83 skills): "we don't care about spreadsheet formulas. remove it. Finer skills is
   important for money and also others." Draft v2 had 149. Owner signed them off on the Standard Skill Sign-off page (owner: "can u
   make the list view a little easier to approve?"; page https://claude.ai/artifact/6Qu8emuAEiJp3brfp9f63W, its db `decisions`; source in
   state/work/skills/standard/signoff/), 23 Nov: 121 approved, 28 changes, verbatim:
   - annuities-in-a-table: "this should be split into future and prsent value, fold it into each"
   - annuity-contributions: "fold this into FV or PV annuities"
   - annuity-decisions: "fold this into FV or PV annuities"
   - bivariate-data-and-causation: "fold this into scatter plots"
   - brokerage: "fold this into share prices"
   - changing-loan-repayments: "fold into loan repayments"
   - compounding-periods-and-rates: "collapse this into compound interest"
   - converting-pay-periods: "wrap this into wages"
   - elapsed-time-and-time-conversions: rename "Practical Applications of Time"
   - equation-of-a-straight-line: rename "Finding the equation of a straight line"
   - flow-networks-and-cuts: "increase / decrease questions need a separate skill"
   - gradient-and-intercept: rename "Determining the gradient and the y-intercept"
   - interpolation-and-extrapolation-from-a-linear-model: "wrap ths into linear modelling"
   - leave-loading: rename "Holiday Pay"; "this section should contain all holiday loading and pay questions"
   - median-and-mode: "split into median and mode"
   - medicare-levy: "wrap into one tax section"
   - net-pay: "wrap into one tax section"
   - payg-withholding: "wrap into one tax section"
   - piecework-and-royalties: "split into royalities and piecework"
   - statistical-investigations-and-surveys: "not relevant in tests"
   - surface-area: "should be able to filter between shapes"
   - tax-payable-from-tax-tables: "wrap into one tax section"
   - tax-refunds-and-amounts-owing: "wrap into one tax section"
   - taxable-income-and-deductions: "wrap into one tax section"
   - time-differences-from-longitude: "fold into latitude and longitude"
   - time-to-reach-zero-bac: "This can be folded into Blood alcohol content"
   - time-zones-and-daylight-saving: "fold into Practical Applications of Time"
   - utc: "fold into Practical Applications of Time"
   Then, asked whether critical path "duration changed" questions get their own skill like flow: owner 23 Nov: "Yes for the croitical
   path one." -> Changing activity durations (S2-12-106).
   Applied: state/work/skills/standard/skills.json, 136 skills (APPROVED). Names chosen by Claude where the note gave none: "Income tax"
   (the one tax section), "Piecework" / "Royalties", "Median" / "Mode", "Surface area of prisms / cylinders / spheres", "Changing edge
   capacities" (flow increase/decrease). Dot points with no skill: the 14 spreadsheet ones, survey design (S11-082..084, "not relevant
   in tests") and S2-12-132 (media use of statistics). Tagging rules: TAG_SPEC_STANDARD.md (tag-std-v1, 23 Nov).
4. The course in the page: QG.courses.standard (name, bank files, dot points, MST reference sheet), the header course switch, Review
   and exams per course.
   23 Nov (branch std-page, merged after the Advanced batches publish): QG.courses.standard "Standard 2" (01_core.js), a header course
   switch (#courseSel, remembered per viewer, reloads the page), site/data/dotpoints-standard.json (262 dot points: Year 11 + Standard 2)
   and an empty Standard bank (tools/standard_course.py), the MST reference sheet rendered to data/ref/standard-1/2.png (pdftoppm -r 200
   -gray, as Advanced; not in git, published from the session). Page test "course switch" (every view opens on Standard, back to
   Advanced). Left: per-course Review and Processes lists, and dot point short labels written by hand (now the first clause).
5. Import. 23 Nov, the paper list (tools/inventory.py, batches.py): Standard is a target course ("Mathematics Standard 2"); files the
   first stock-take excluded only as "non-target course" are candidates again; a file or folder naming Standard 1 is held (owner:
   "Standard 2 first"); papers before 2019 are old syllabus (General Mathematics; Standard 1 and 2 first examined 2019). Year 12
   lane: 173 papers (107 current, 66 old) in 19 batches; 12 Standard 1 held; Year 11 held (owner: "yes finalise Y12 first").
   Batch 1 (the pilot) starts with the 5 NESA HSC Standard 2 papers 2020-2024, so they become the references. Advanced's list
   unchanged (checked count for count). Owner 23 Nov on the 66 General Maths papers: "Yes import them later." (after the current-syllabus papers; their
   questions on content outside the 2024 course are old syllabus, as Advanced's old 2 Unit papers).
   Still to do: Import: a standard|12 lane in the inventory (Standard 2 Year 12 papers only), a cover check that tells Standard 1 from Standard 2
   (27 of 357 file names say which), and course-aware import prompts (parse, tag, difficulty).
6. Pilot batch: the NESA HSC Standard 2 papers (2020-2024 are in the folder) first, so they become the difficulty references.
