# Difficulty and working-mathematically spec (diff-v1, 13 Nov 2026)

Owner: Steve Yeung. This is for rating every answerable (leaf) part in the bank. The ratings will be used for worksheets, exams and showing the spread (owner, 13 Nov).

## Why there is no official baseline
The owner wanted to "use HSC as a baseline and reference the rest". NESA's 2020–2025 mapping grids list question, marks, content and outcomes, but **no targeted performance band** (checked 13 Nov). So the baseline is HSC parts rated by us. The owner reviews those anchor ratings, and every other part points to the anchor it was compared with, so a corrected anchor can be pushed through mechanically.

## Field 1: band (integer 2–6)
This is the HSC band of a typical student who gets the part fully right. Rate the part on its own; earlier parts may give a result that makes it easier ("hence").

| Band | What it looks like | Typical HSC place |
|---|---|---|
| 2 | One routine step: direct recall, read a graph, substitute into a given formula | Easy MCQ, first part of Q11–Q15 |
| 3 | Two steps, or a standard technique applied cleanly, or a formula used in reverse | Most 2-mark parts |
| 4 | Several steps, two ideas combined, careful algebra, or interpreting a result | 3-mark parts, middle of later questions |
| 5 | Non-routine set-up, an abstract or general "show that", or extended reasoning | Later parts of the last questions |
| 6 | Needs real insight: a novel model, a multi-stage argument taken to the end, or the hardest final parts | The final parts of the hardest questions |

The Sequences and series pilot anchors (work/difficulty/pilot_report.md) show the calibration in one topic. Keep other topics on the same scale: a band 4 integration part should be as hard for a student as a band 4 sequences part.

Rate from the question and its solution, not from the paper's position. Position is only a weak hint: school trials often put easy topics late.

## Field 2: wm, working mathematically (one per leaf part)
The 2024 Mathematics Advanced syllabus has one overarching Working Mathematically outcome. Its elements are communicating, reasoning, **understanding and fluency**, and **problem solving**. We use two labels:
- **UF (understanding and fluency).** Once the student recognises what is asked, a standard method gets the answer: routine differentiation or integration, a standard formula, a familiar graph, a direct probability calculation.
- **PR (problem solving and reasoning).** The student has to choose or build a method: model a situation, set up an unfamiliar equation, prove or justify ("show that", "explain why"), interpret in context, or combine ideas in a way the question doesn't spell out.

A question that has both kinds of part is "Mixed" at question level. That is computed later; never store it on a part.

## Output (one record per leaf part)
`{part_id, qid, band, wm, nearest_anchor, confidence, reason}`
- **nearest_anchor:** the part_id of the HSC anchor part it most resembles in difficulty. For an anchor itself, null.
- **confidence:** high, medium or low.
- **reason:** at most 15 words, naming what makes it that hard.

## Owner review and how it is applied (14 Nov)
- **How the review was done.** He checked the reference parts on the Difficulty tab: the thin topics in full (19 parts, all agreed), then a spot-check. The spot-check covered the 9 parts the audit flagged and, in each of the other 11 topics, the 3 references that the most other parts were rated against. That makes 61 decisions: 50 agreed, 11 changed.
- **What changed.** 7 references changed band, 6 of them upward by one band, all in Year 12 except one Probability part. Of the 9 flagged parts, 3 were raised (1587: 3→5; 1311 and 2625: 4→5) and one was relabelled (2547: PR→UF).
- **How a decision is applied.** `tools/apply_difficulty_reviews.py` runs on an export of the `difficulty` collection.
  - Each part he decided takes his band and label.
  - Each part rated against a reference he changed moves by the same number of bands, clamped to 2–6; its label stays.
  - The model's original rating is kept in `band_ai`/`wm_ai`, so re-running the tool is safe. `source` is owner, shifted or model.
  - First run: 119 parts shifted.
- **Rule for full checks.** A topic with two or more changed references is checked in full: Further graph transformations and modelling (Y12) and Differential calculus (Y12).
- **Full checks done (14 Nov).** Both topics were checked in full, giving 99 decisions in all.
  - Further graph transformations: 6 of 30 references changed, all up one band.
  - Differential calculus: 12 of 14 changed, all up. Five went up two bands, and three moved from fluency to problem solving.
  - Across all references, 20 of 21 band changes were upward. The model underrates harder Year 12 work, calculus above all.
  - 157 dependent parts were shifted.
  - Open: Integral calculus and Applications of calculus (one upward change each in the spot-check) are likely underrated too, so a wider check is needed.
