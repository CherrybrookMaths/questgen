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
2. 2017 vs 2024 comparison: which 2017 content left Standard 2 (questions on it are old syllabus) and which 2024 content is new.
3. Skills and tagging rules for Standard (TAG_SPEC equivalent; Advanced has 159 skills with prerequisites).
4. The course in the page: QG.courses.standard (name, bank files, dot points, MST reference sheet), the header course switch, Review
   and exams per course.
5. Import: a standard|12 lane in the inventory (Standard 2 Year 12 papers only), a cover check that tells Standard 1 from Standard 2
   (27 of 357 file names say which), and course-aware import prompts (parse, tag, difficulty).
6. Pilot batch: the NESA HSC Standard 2 papers (2020-2024 are in the folder) first, so they become the difficulty references.
