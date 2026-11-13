// Types for the HSC Mathematics Advanced question bank seed (export of 11 Nov 2026).
// All text fields are "LaTeX-in-prose": plain text with inline math $...$ and display math $$...$$,
// plus two placeholders that are NOT LaTeX: \exfigure{<figure key>} and \extable{<table id>}, and dot-point lists as
// \begin{itemize} \item … \end{itemize} (render as <ul>). See README §4.

export type PaperType = 'hsc' | 'trial' | 'internal_exam' | 'internal_other';

export interface Paper {            // data/papers.json
  id: number;
  label: string;                    // e.g. "2023 NESA HSC", "2022 CSSA Trial"
  year: number;
  school: string;                   // "NESA" for HSC papers
  paper_type: PaperType;
  course: 'advanced';
  source: 'digital' | 'scan';       // how it was transcribed
}

export interface SyllabusTag {
  dot_point: string | null;         // e.g. "Y12-279" (key into syllabus_2024.json); null when coverage is removed/no_match
  coverage: 'examinable' | 'year_11' | 'removed' | 'no_match';
  primary: boolean;                 // place the question under primary tags; show secondary tags as extra chips
  confidence: number | null;        // model confidence 0..1 (1.0 for human-set tags)
  source: 'model' | 'human';
}

export interface Part {
  id: number;
  label: string | null;             // "a", "i", ... ; null for single-part questions
  parent_id: number | null;         // sub-parts (i), (ii) point at their part (a)
  marks: number | null;
  latex: string;
  is_leaf: boolean;                 // tags are attached to leaf parts
  syllabus_2024: SyllabusTag[];
  code_2017: string | null;         // e.g. "MA-C4.2" (key into codes_2017.json)
  keywords: string[];
}

export interface Criterion { marks: number | null; criterion: string; }   // one rubric row

export interface Solution {
  id: number;
  part_id: number | null;           // null = whole-question solution (e.g. MCQ answer)
  source: 'marking_guidelines' | 'model_generated';
  approved: boolean;                // always true for marking_guidelines; model_generated needs owner approval
  rejected: boolean;
  latex: string;
  criteria: Criterion[];            // render as a Marks | Criterion table
  meta: {                           // render as small badges / callouts, never inline in the text
    confidence?: number; check?: string; concern?: string; reused_from?: number; marker_note?: string;
  };
}

export interface Option { label: 'A' | 'B' | 'C' | 'D'; latex: string; correct: boolean; key_source: string; }

export interface OptionsTable {     // MCQ whose answers are a table: one table, rows A-D
  headers: string[];
  rows: Record<'A' | 'B' | 'C' | 'D', string[]>;
}

export interface Question {         // data/questions.json
  id: number;
  paper_id: number;
  number: string;                   // printed question number
  section: string | null;
  type: 'multiple_choice' | 'short_answer';   // NSW naming: Section I multiple choice, Section II short answer
  marks: number | null;
  stem: string | null;              // shared text before the parts
  parts: Part[];                    // in printed order
  options: Option[];                // MCQ only; if options_table is set render that instead of options
  options_table: OptionsTable | null;
  solutions: Solution[];
  figures: string[];                // figure keys used by this question (inline via \exfigure, or listed)
  old_syllabus: string | null;      // non-null: assesses content with no 2024 dot point (reason). Badge "Old syllabus"; leave out of new worksheets by default
  qid: string;                      // stable question ID shown as the title, "QID 0316" (= id, zero-padded)
  source: string;                   // "2023 Cherrybrook Technology High School AT1 Q7": paper label + question number
  standard_course: string | null;   // non-null: Mathematics Standard (2024) content, not Advanced: show in a separate Standard section
  also_in: number[];                // other paper ids with the same question (only one copy is exported)
  related: { question_id: number; similarity: number; relation: 'duplicate' | 'numbers_changed' | 'variant' }[];
  source_pages: number[];           // 1-based page numbers in the source PDF
  review: { status: 'unreviewed' | 'approved' | 'flagged'; parse_flagged: boolean; from_scan: boolean; self_audited: boolean; note: string | null };
}

export interface Figure {           // data/figures.json, keyed by figure key
  key: string;                      // "<paper id>_q<number>_<n>"
  question_id: number;
  crop: string;                     // path to the original crop PNG (200 dpi)
  crop_dpi: 200;
  print_width_mm: number;           // printed size on the paper; display at this size (max 100% width), centred
  print_height_mm: number;
  redraw: string | null;            // path to the TikZ redraw (SVG, or 300 dpi PNG for heavy stipple)
  redraw_tikz: string | null;       // TikZ source (compile with figures/tikz/examstyle.tex)
  redraw_status: 'approved' | 'pending_review' | 'changes_requested' | 'rejected' | null;
  use: 'redraw' | 'crop';           // what to show today: the redraw only once the owner approved it
  estimated_shape: boolean;
  kind: string | null;
  overlap_with_crop: [number, number] | null;  // automated check (0..1), for internal QA only
}

export interface DataTable {        // data/tables.json, keyed by table id
  id: string;
  caption: string | null;           // LaTeX-in-prose
  header_rows: number;              // first N rows are header rows
  label_column: boolean;            // first column is a row-label column (e.g. x / P(X=x))
  rows: string[][];                 // each cell is LaTeX MATH (wrap in $...$ to render); "" = empty cell
  colspans: { row: number; col: number; span: number; rowspan: number }[];   // merged cells: span = columns, rowspan = rows (e.g. a label header over two header rows)
                                    // a cell may contain \\ = line break where the paper wraps it (render as separate lines)
}

export interface DotPoint {         // data/syllabus_2024.json
  id: string;                       // "Y11-001" .. "Y12-359"
  year: 11 | 12;
  focus_area: string;
  subheading: string;
  text: string;                     // plain text (maths flattened) - use for search only
  latex: string;                    // same wording with maths in $...$ - use for display
}
