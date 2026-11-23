# Tag spec, Mathematics Standard (prompt_version = tag-std-v1), 23 Nov 2026

Tag NSW HSC Mathematics Standard question PARTS from Year 12 Standard 2 papers (owner 23 Nov: "Standard 2 first"). Same shape as
TAG_SPEC.md (Advanced); where this file is silent, TAG_SPEC's clarifications apply. The "Owner rulings" at the end override anything
above them. Background, syllabus comparison and every ruling: STANDARD_SPEC.md.
Inputs: state/work/skills/standard/dotpoints.json (use ONLY part "common" (ids S11-nnn, Year 11) and "S2" (ids S2-12-nnn, Year 12);
never the S1-12 ids), state/work/skills/standard/skills.json (135 approved skills: skill, year, topic, counts_when, not_when, requires,
basic, dot_points), state/work/skills/standard/compare_2017_2024.json (what left the course).

For each part give:
1. **dot_points**: every 2024 dot point the marks assess, role "primary" (exactly one: what most of the marks are for) or "also".
   Test: "would a student lose marks without this?". Primary rules, in order: (a) marks decide; (b) a "hence" part belongs to what it
   asks for; (c) an application beats a technique (a loan, annuity, depreciation, network, rates or measurement context is primary;
   the formula work inside it is "also"); (d) on a tie, the final answer decides.
   If the content is not in the 2024 Year 11 + Standard 2 course (see "Old syllabus" below): dot_points = [], removed_reason (one
   line) and topic_2017 (the 2017 code, e.g. "MS-M1.1").
2. **required_skills**: every skill (exact names from skills.json) whose counts_when is met; follow not_when. Prerequisites are added
   automatically: do not add a skill only because another tagged skill requires it.
3. **can_use_skills**: another skill that is a valid alternative method for the same marks, only when the question leaves the method
   free (e.g. a graph read OR simultaneous equations solved). Usually empty.
4. **confidence** 0-1 and **note** for anything you were unsure about.
Output per part: {"part_id", "dot_points":[{"id","role"}], "required_skills":[...], "can_use_skills":[...], "removed_reason":"",
"topic_2017":"", "confidence", "note"}.

## Clarifications
- **Lead-in parts** (no marks; the sub-parts carry them): tag nothing.
- **Assumed skills** (`basic: true`: Substitution into formulas, Solving linear equations, Percentage increase and decrease, Units of
  measurement): tag them ONLY when the marks are for that skill itself, never as a side step. They never hold a question back.
- **Year of a part**: Year 12 if any dot point or skill is Year 12 (S2-12 / "Year 12 Standard 2"), else Year 11.
- **Spreadsheets**: owner 23 Nov: "we don't care about spreadsheet formulas. remove it." There is no spreadsheet skill. Tag the
  spreadsheet dot point as "also" only when the question shows or asks for a spreadsheet; tag the maths it does as usual.
- **Shapes**: owner 23 Nov on surface area: "should be able to filter between shapes". Tag one surface-area skill per shape the
  marks need (a composite solid of a cylinder and a hemisphere: Surface area of cylinders + Surface area of spheres). Volume likewise
  (Volume of prisms and cylinders / Volume of pyramids, cones and spheres).
- **Holiday pay**: owner 23 Nov: "this section should contain all holiday loading and pay questions". Any leave loading or holiday pay.
- **Income tax**: one skill for taxable income, tax tables, PAYG, the Medicare levy, net pay and refunds (owner 23 Nov: "wrap into one
  tax section").
- **Annuities**: Future value of an annuity / Present value of an annuity by which value the question works with (owner 23 Nov: "this
  should be split into future and prsent value, fold it into each"); contributions and decisions go with the value they use.
- **Flow networks**: a question that increases or reduces an edge's capacity takes Changing edge capacities (owner 23 Nov:
  "increase / decrease questions need a separate skill").
- **Survey design** (S11-082..084): owner 23 Nov: "not relevant in tests". No skill; tag the dot point only if a question is about it.
- **Mixed triangle problems** (S2-12-071): tag it "also" beside the specific trigonometry skills the marks need.
- **MCQ with picture options**: decide the method from the stem, the solution and the correct answer.

## Old syllabus (questions on content not in the 2024 Year 11 + Standard 2 course)
Owner 23 Nov: "keep them out but don't drop yet"; on the borderline calls: "If they're out then flag them as such. 4 is fine."
The part gets dot_points [], removed_reason and topic_2017; the question is kept, marked old syllabus, out of topic lists and exams.
- Measurement error: absolute error, limits of accuracy, percentage error (MS-M1.1).
- Percentiles and deciles (MS-S1.2); the sample standard deviation s (only sigma is in the course); outliers judged by distance from
  the mean or median (only Q1 - 1.5 IQR and Q3 + 1.5 IQR remain).
- Pareto charts (MS-S1.1).
- Food energy: calories and kilojoules (MS-M1.3). Electricity (W, kW, kWh) is IN.
- Normal probabilities from z-tables or technology (MS-S5); the empirical rule is IN.
- The International Date Line (MS-M2); timetables, except a plain elapsed-time question (that is IN).
- Similar figures and scale factors outside map scales and plans (MS-M5 / M7); map scales and scale drawings are IN.
- Forming a quadratic model from a description (MS-A4.2); a given quadratic model (equation, table or graph) is IN.
- Simulation of experiments (MS-S2); navigation methods of other cultures; council energy-efficiency rules.
- Rearranging formulas beyond linear and y = ax^2 + c (cube or square roots) (MS-A1).
Moved content is IN at its 2024 year: probability (Year 11 -> Year 12), networks / MST / shortest paths (Year 12 -> Year 11), simple
interest, straight-line depreciation and electricity costs (Year 11 -> Year 12).
