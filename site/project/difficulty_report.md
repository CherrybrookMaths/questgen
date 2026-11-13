# Difficulty ratings: full run report

## Totals and checks
- **2292 leaf parts expected, 2292 rated.** That is 14 areas plus the Unhomed batch, in 1445 questions.
- **No problems found.** Nothing is missing, nothing is duplicated and nothing is extra. Every band is 2-6, every wm is UF or PR, every qid matches, and every non-anchor's `nearest_anchor` points at a real anchor.
- **307 anchors** (HSC parts) and **1985 ratings** (everything else, including the 3 Unhomed HSC questions).
- **Confidence:** 1342 high, 927 medium, 23 low.
- **Overall bands:** B2 726 · B3 1046 · B4 411 · B5 97 · B6 12. That is 1763 UF (77%) and 529 PR (23%).
- **Merged file:** `work/difficulty/ratings_all.json`

## Per area (all leaf parts)
| Area | Parts | Anchors | B2 | B3 | B4 | B5 | B6 | UF | PR | Low conf |
|---|---|---|---|---|---|---|---|---|---|---|
| Y11 Exponential & log | 38 | 3 | 14 | 18 | 6 | 0 | 0 | 32 | 6 | 0 |
| Y11 Graph transformations | 81 | 14 | 17 | 47 | 15 | 2 | 0 | 73 | 8 | 1 |
| Y11 Intro to differentiation | 88 | 13 | 23 | 50 | 9 | 6 | 0 | 75 | 13 | 0 |
| Y11 Probability & data | 124 | 22 | 41 | 56 | 25 | 2 | 0 | 95 | 29 | 0 |
| Y11 Trig identities & equations | 46 | 3 | 10 | 24 | 12 | 0 | 0 | 23 | 23 | 0 |
| Y11 Trig & measure of angles | 102 | 13 | 30 | 44 | 25 | 3 | 0 | 66 | 36 | 1 |
| Y11 Working with functions | 225 | 32 | 106 | 80 | 29 | 9 | 1 | 181 | 44 | 3 |
| Y12 Applications of calculus | 455 | 40 | 147 | 214 | 83 | 10 | 1 | 335 | 120 | 1 |
| Y12 Differential calculus | 97 | 14 | 22 | 62 | 10 | 3 | 0 | 81 | 16 | 1 |
| Y12 Financial mathematics | 55 | 17 | 4 | 17 | 18 | 12 | 4 | 29 | 26 | 0 |
| Y12 Further graph transf. & modelling | 171 | 30 | 72 | 65 | 28 | 5 | 1 | 136 | 35 | 1 |
| Y12 Integral calculus | 370 | 50 | 124 | 151 | 70 | 24 | 1 | 299 | 71 | 4 |
| Y12 Random variables | 249 | 43 | 74 | 133 | 34 | 6 | 2 | 196 | 53 | 4 |
| Y12 Sequences & series | 180 | 13 | 42 | 78 | 45 | 13 | 2 | 133 | 47 | 7 |
| Unhomed | 11 | 0 | 0 | 7 | 2 | 2 | 0 | 9 | 2 | 0 |

## Question level (UF if all parts are UF, PR if all parts are PR, otherwise Mixed)
| Area | UF | PR | Mixed |
|---|---|---|---|
| Y11 Exponential & log | 30 | 4 | 2 |
| Y11 Graph transformations | 64 | 4 | 3 |
| Y11 Intro to differentiation | 56 | 8 | 5 |
| Y11 Probability & data | 52 | 13 | 12 |
| Y11 Trig identities & equations | 20 | 19 | 3 |
| Y11 Trig & measure of angles | 36 | 13 | 18 |
| Y11 Working with functions | 135 | 24 | 13 |
| Y12 Applications of calculus | 121 | 32 | 62 |
| Y12 Differential calculus | 54 | 8 | 5 |
| Y12 Financial mathematics | 4 | 3 | 13 |
| Y12 Further graph transf. & modelling | 66 | 8 | 23 |
| Y12 Integral calculus | 180 | 32 | 33 |
| Y12 Random variables | 86 | 22 | 24 |
| Y12 Sequences & series | 86 | 24 | 15 |
| Unhomed | 8 | 2 | 0 |
| **All** | **998** | **216** | **231** |

## Things to notice
- **The bank leans easy.** Only 12 parts are band 6 and 97 are band 5, so a "hard" exam will have few distinct band 6 parts to choose from.
- **Financial mathematics is the hardest area.** It has the fewest band 2 parts, and most of its questions are Mixed.
- **Trig identities and equations is the most PR-heavy area**, split 50/50.
- **Sequences and series has the most low-confidence ratings (7).** Some of its parts are about graphing or geometry rather than series (2303, 2817, 1311). Part 1587, a limit, also looks out of place in Working with functions. These may be homing problems, not rating problems.
- **Several low-confidence parts were rated without seeing the diagram or table:** 1137, 2209, 2547, 2625. Worth a look.

## Cross-area consistency check (2 random parts per band, from different areas)
| Band | Part A | Part B | Equally hard? |
|---|---|---|---|
| 2 | 2244 Apps of calc: differentiate trig terms for dV/dt (1 mark) | 802 Working w/ functions, HSC: turning point of a quadratic (2 marks) | Yes |
| 3 | 2460 Integral: MCQ, ∫|x-1| from -2 to 2 using triangles | 2334 Further graphs: solve tan(x+5π/6)=1/√3 on [-π,π] (2 marks) | Yes |
| 4 | 294 Intro diff, HSC Q28: parallel tangent, then integrate (4 marks, PR) | 1500 Probability: total-probability win chance (2 marks, PR) | Mostly. 294 is longer but the step difficulty is similar. |
| 5 | 2066 Integral: area under f′ from f values via FTC (2 marks) | 77 Trig: three-town bearings, sine rule twice (5 marks) | **Flag.** 77 is clearly band 5. 2066 has only 2 marks and might be band 4. |
| 6 | 893 Financial, HSC Q33: final partial payment | 304 Working w/ functions, HSC Q32: k for two intersections (quadratic in e^-x) | Yes |

The bands look consistent across areas. Only one of the ten sampled parts (2066) looks out of place, and only by one band.

## Anchors: review these first (count per band)
| Area | Anchors | B2 | B3 | B4 | B5 | B6 | UF | PR |
|---|---|---|---|---|---|---|---|---|
| Y11 Exponential & log | 3 | 2 | 1 | 0 | 0 | 0 | 3 | 0 |
| Y11 Graph transformations | 14 | 2 | 7 | 4 | 1 | 0 | 12 | 2 |
| Y11 Intro to differentiation | 13 | 1 | 6 | 3 | 3 | 0 | 8 | 5 |
| Y11 Probability & data | 22 | 5 | 11 | 6 | 0 | 0 | 15 | 7 |
| Y11 Trig identities & equations | 3 | 1 | 1 | 1 | 0 | 0 | 1 | 2 |
| Y11 Trig & measure of angles | 13 | 3 | 3 | 6 | 1 | 0 | 7 | 6 |
| Y11 Working with functions | 32 | 14 | 11 | 3 | 3 | 1 | 24 | 8 |
| Y12 Applications of calculus | 40 | 8 | 16 | 12 | 3 | 1 | 24 | 16 |
| Y12 Differential calculus | 14 | 0 | 7 | 5 | 2 | 0 | 6 | 8 |
| Y12 Financial mathematics | 17 | 0 | 3 | 4 | 7 | 3 | 6 | 11 |
| Y12 Further graph transf. & modelling | 30 | 14 | 8 | 6 | 1 | 1 | 23 | 7 |
| Y12 Integral calculus | 50 | 11 | 23 | 7 | 8 | 1 | 37 | 13 |
| Y12 Random variables | 43 | 10 | 19 | 9 | 4 | 1 | 26 | 17 |
| Y12 Sequences & series | 13 | 2 | 7 | 3 | 0 | 1 | 12 | 1 |
| **All** | **307** | **73** | **123** | **69** | **33** | **9** | **204** | **103** |

Three areas have thin anchor sets: Exponential & log (3), Trig identities (3) and Sequences & series (no band 5 anchor). Ratings in those areas lean more on anchors borrowed from other areas, so review them first.
