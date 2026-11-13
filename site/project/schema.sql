CREATE TRIGGER qg_anchor_insert BEFORE INSERT ON part_difficulty
  WHEN NEW.nearest_anchor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM part_difficulty WHERE part_id=NEW.nearest_anchor AND is_anchor=1)
  BEGIN SELECT RAISE(ABORT,'nearest_anchor must be a rated HSC reference part'); END;

CREATE TRIGGER qg_anchor_update BEFORE UPDATE ON part_difficulty
  WHEN NEW.nearest_anchor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM part_difficulty WHERE part_id=NEW.nearest_anchor AND is_anchor=1)
  BEGIN SELECT RAISE(ABORT,'nearest_anchor must be a rated HSC reference part'); END;

CREATE TRIGGER qg_data_tables_owner_insert BEFORE INSERT ON data_tables
  WHEN NOT ((NEW.owner_table='questions' AND EXISTS(SELECT 1 FROM questions WHERE id=NEW.owner_id)) OR (NEW.owner_table='parts' AND EXISTS(SELECT 1 FROM parts WHERE id=NEW.owner_id)) OR (NEW.owner_table='solutions' AND EXISTS(SELECT 1 FROM solutions WHERE id=NEW.owner_id)) OR (NEW.owner_table='mcq_options' AND EXISTS(SELECT 1 FROM mcq_options WHERE id=NEW.owner_id)) OR (NEW.owner_table='figures' AND EXISTS(SELECT 1 FROM figures WHERE id=NEW.owner_id)))
  BEGIN SELECT RAISE(ABORT,'data_tables owner must be an existing questions/parts/solutions/mcq_options/figures row'); END;

CREATE TRIGGER qg_data_tables_owner_update BEFORE UPDATE ON data_tables
  WHEN NOT ((NEW.owner_table='questions' AND EXISTS(SELECT 1 FROM questions WHERE id=NEW.owner_id)) OR (NEW.owner_table='parts' AND EXISTS(SELECT 1 FROM parts WHERE id=NEW.owner_id)) OR (NEW.owner_table='solutions' AND EXISTS(SELECT 1 FROM solutions WHERE id=NEW.owner_id)) OR (NEW.owner_table='mcq_options' AND EXISTS(SELECT 1 FROM mcq_options WHERE id=NEW.owner_id)) OR (NEW.owner_table='figures' AND EXISTS(SELECT 1 FROM figures WHERE id=NEW.owner_id)))
  BEGIN SELECT RAISE(ABORT,'data_tables owner must be an existing questions/parts/solutions/mcq_options/figures row'); END;

CREATE TRIGGER qg_figures_owns_table BEFORE DELETE ON figures
  WHEN EXISTS(SELECT 1 FROM data_tables WHERE owner_table='figures' AND owner_id=OLD.id)
  BEGIN SELECT RAISE(ABORT,'figures row owns a data table: move or retire the table first'); END;

CREATE TRIGGER qg_figures_qid_fill AFTER INSERT ON figures
  WHEN NEW.part_id IS NOT NULL AND NEW.question_id IS NULL
  BEGIN UPDATE figures SET question_id=(SELECT question_id FROM parts WHERE id=NEW.part_id) WHERE rowid=NEW.rowid; END;

CREATE TRIGGER qg_figures_qid_insert BEFORE INSERT ON figures
  WHEN NEW.part_id IS NOT NULL AND NEW.question_id IS NOT NULL AND NEW.question_id != (SELECT question_id FROM parts WHERE id=NEW.part_id)
  BEGIN SELECT RAISE(ABORT,'figures.question_id must match its part''s question'); END;

CREATE TRIGGER qg_figures_qid_update BEFORE UPDATE ON figures
  WHEN NEW.part_id IS NOT NULL AND NEW.question_id IS NOT NULL AND NEW.question_id != (SELECT question_id FROM parts WHERE id=NEW.part_id)
  BEGIN SELECT RAISE(ABORT,'figures.question_id must match its part''s question'); END;

CREATE TRIGGER qg_mcq_options_owns_table BEFORE DELETE ON mcq_options
  WHEN EXISTS(SELECT 1 FROM data_tables WHERE owner_table='mcq_options' AND owner_id=OLD.id)
  BEGIN SELECT RAISE(ABORT,'mcq_options row owns a data table: move or retire the table first'); END;

CREATE TRIGGER qg_part_difficulty_qid_fill AFTER INSERT ON part_difficulty
  WHEN NEW.part_id IS NOT NULL AND NEW.question_id IS NULL
  BEGIN UPDATE part_difficulty SET question_id=(SELECT question_id FROM parts WHERE id=NEW.part_id) WHERE rowid=NEW.rowid; END;

CREATE TRIGGER qg_part_difficulty_qid_insert BEFORE INSERT ON part_difficulty
  WHEN NEW.part_id IS NOT NULL AND NEW.question_id IS NOT NULL AND NEW.question_id != (SELECT question_id FROM parts WHERE id=NEW.part_id)
  BEGIN SELECT RAISE(ABORT,'part_difficulty.question_id must match its part''s question'); END;

CREATE TRIGGER qg_part_difficulty_qid_update BEFORE UPDATE ON part_difficulty
  WHEN NEW.part_id IS NOT NULL AND NEW.question_id IS NOT NULL AND NEW.question_id != (SELECT question_id FROM parts WHERE id=NEW.part_id)
  BEGIN SELECT RAISE(ABORT,'part_difficulty.question_id must match its part''s question'); END;

CREATE TRIGGER qg_parts_move AFTER UPDATE OF question_id ON parts
  WHEN NEW.question_id IS NOT OLD.question_id
  BEGIN UPDATE tags SET question_id=NEW.question_id WHERE part_id=NEW.id; UPDATE solutions SET question_id=NEW.question_id WHERE part_id=NEW.id; UPDATE figures SET question_id=NEW.question_id WHERE part_id=NEW.id; UPDATE part_difficulty SET question_id=NEW.question_id WHERE part_id=NEW.id; END;

CREATE TRIGGER qg_parts_owns_table BEFORE DELETE ON parts
  WHEN EXISTS(SELECT 1 FROM data_tables WHERE owner_table='parts' AND owner_id=OLD.id)
  BEGIN SELECT RAISE(ABORT,'parts row owns a data table: move or retire the table first'); END;

CREATE TRIGGER qg_questions_owns_table BEFORE DELETE ON questions
  WHEN EXISTS(SELECT 1 FROM data_tables WHERE owner_table='questions' AND owner_id=OLD.id)
  BEGIN SELECT RAISE(ABORT,'questions row owns a data table: move or retire the table first'); END;

CREATE TRIGGER qg_solutions_owns_table BEFORE DELETE ON solutions
  WHEN EXISTS(SELECT 1 FROM data_tables WHERE owner_table='solutions' AND owner_id=OLD.id)
  BEGIN SELECT RAISE(ABORT,'solutions row owns a data table: move or retire the table first'); END;

CREATE TRIGGER qg_solutions_qid_fill AFTER INSERT ON solutions
  WHEN NEW.part_id IS NOT NULL AND NEW.question_id IS NULL
  BEGIN UPDATE solutions SET question_id=(SELECT question_id FROM parts WHERE id=NEW.part_id) WHERE rowid=NEW.rowid; END;

CREATE TRIGGER qg_solutions_qid_insert BEFORE INSERT ON solutions
  WHEN NEW.part_id IS NOT NULL AND NEW.question_id IS NOT NULL AND NEW.question_id != (SELECT question_id FROM parts WHERE id=NEW.part_id)
  BEGIN SELECT RAISE(ABORT,'solutions.question_id must match its part''s question'); END;

CREATE TRIGGER qg_solutions_qid_update BEFORE UPDATE ON solutions
  WHEN NEW.part_id IS NOT NULL AND NEW.question_id IS NOT NULL AND NEW.question_id != (SELECT question_id FROM parts WHERE id=NEW.part_id)
  BEGIN SELECT RAISE(ABORT,'solutions.question_id must match its part''s question'); END;

CREATE TRIGGER qg_tags_qid_fill AFTER INSERT ON tags
  WHEN NEW.part_id IS NOT NULL AND NEW.question_id IS NULL
  BEGIN UPDATE tags SET question_id=(SELECT question_id FROM parts WHERE id=NEW.part_id) WHERE rowid=NEW.rowid; END;

CREATE TRIGGER qg_tags_qid_insert BEFORE INSERT ON tags
  WHEN NEW.part_id IS NOT NULL AND NEW.question_id IS NOT NULL AND NEW.question_id != (SELECT question_id FROM parts WHERE id=NEW.part_id)
  BEGIN SELECT RAISE(ABORT,'tags.question_id must match its part''s question'); END;

CREATE TRIGGER qg_tags_qid_update BEFORE UPDATE ON tags
  WHEN NEW.part_id IS NOT NULL AND NEW.question_id IS NOT NULL AND NEW.question_id != (SELECT question_id FROM parts WHERE id=NEW.part_id)
  BEGIN SELECT RAISE(ABORT,'tags.question_id must match its part''s question'); END;

CREATE TABLE data_tables(id text primary key, owner_table text, owner_id integer,
  caption text, header_rows integer, label_col integer, rows_json text, source_latex text, spans_json text);

CREATE TABLE data_tables_retired(
  id TEXT,
  owner_table TEXT,
  owner_id INT,
  caption TEXT,
  header_rows INT,
  label_col INT,
  rows_json TEXT,
  source_latex TEXT,
  spans_json TEXT,
  retired_at,
  retired_why
);

CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  sha256 TEXT,
  text_fingerprint TEXT,
  drive_file_id TEXT,
  source_path TEXT UNIQUE NOT NULL,
  size_bytes INTEGER,
  task_type TEXT NOT NULL,          -- hsc|trial|internal_exam|internal_other|solutions|other|unknown
  course TEXT NOT NULL,             -- standard|advanced|ext1|ext2|unknown
  classification_method TEXT,       -- explicit_cover|inferred|human
  year_level INTEGER,               -- 10|11|12|NULL
  school TEXT,
  year INTEGER,
  natural_key TEXT,
  provenance_method TEXT,           -- folder|filename|coverpage
  page_count INTEGER,
  has_text_layer INTEGER,
  parse_path TEXT,                  -- digital|scan
  bundled_solutions INTEGER DEFAULT 0,
  syllabus_version TEXT,            -- pre2017|2017
  cover_excerpt TEXT,
  status TEXT NOT NULL,             -- discovered|excluded|pending|parsed|tagged|failed|skipped
  failure_reason TEXT,
  ingested_at TEXT
, display_label text, school_formal text, task_code text);

CREATE TABLE figures (id INTEGER PRIMARY KEY, question_id INTEGER REFERENCES questions(id), part_id INTEGER REFERENCES parts(id), page INTEGER NOT NULL, bbox TEXT NOT NULL, png_path TEXT NOT NULL, tikz_path TEXT, caption TEXT, redraw_status text, redraw_class text, redraw_notes text, redraw_check text, redraw_table_id text, redraw_request text);

CREATE TABLE mcq_options (id INTEGER PRIMARY KEY, question_id INTEGER NOT NULL REFERENCES questions(id), label TEXT NOT NULL, latex TEXT NOT NULL, is_correct INTEGER, key_source TEXT, figure_key text);

CREATE TABLE page_difficulty(part_id INTEGER PRIMARY KEY REFERENCES parts(id), question_id INTEGER REFERENCES questions(id),
  band INTEGER, wm TEXT, status TEXT, orig_band INTEGER, orig_wm TEXT, is_anchor INTEGER, by TEXT, at TEXT, data_json TEXT NOT NULL);

CREATE TABLE page_exam_items(exam_id TEXT REFERENCES page_exams(id), ordinal INTEGER, question_id INTEGER REFERENCES questions(id),
  PRIMARY KEY(exam_id, ordinal));

CREATE TABLE page_exams(id TEXT PRIMARY KEY, title TEXT, sub TEXT, school TEXT, by TEXT, at TEXT, data_json TEXT NOT NULL);

CREATE TABLE page_reports(id TEXT PRIMARY KEY, question_id INTEGER REFERENCES questions(id), part_id INTEGER REFERENCES parts(id),
  reason TEXT, suggested_band INTEGER, suggested_dot TEXT, note TEXT, status TEXT, reply TEXT, exam_id TEXT, by TEXT, at TEXT, data_json TEXT NOT NULL);

CREATE TABLE page_reviews(doc_key TEXT PRIMARY KEY, question_id INTEGER REFERENCES questions(id), document_id INTEGER REFERENCES documents(id),
  status TEXT, note TEXT, home_json TEXT, fig_json TEXT, sol_json TEXT, by TEXT, at TEXT, data_json TEXT NOT NULL);

CREATE TABLE page_sync(collection TEXT PRIMARY KEY, docs INTEGER, synced_at TEXT, unmatched INTEGER);

CREATE TABLE part_difficulty(part_id integer primary key, question_id integer, band integer, wm text, is_anchor integer,
  nearest_anchor integer, confidence text, reason text, area text, prompt_version text, rated_at text, band_ai integer, wm_ai text, owner_band integer, owner_wm text, source text);

CREATE TABLE parts (id INTEGER PRIMARY KEY, question_id INTEGER NOT NULL REFERENCES questions(id), label TEXT, parent_part_id INTEGER REFERENCES parts(id), ordinal INTEGER NOT NULL, latex TEXT NOT NULL, marks INTEGER, needs_review INTEGER DEFAULT 0, src_label text);

CREATE TABLE questions (id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES documents(id), number TEXT NOT NULL, section TEXT, question_type TEXT NOT NULL, stem_latex TEXT, marks_total INTEGER, page_start INTEGER, page_end INTEGER, needs_review INTEGER DEFAULT 0, review_status TEXT DEFAULT 'unreviewed', review_note TEXT, options_table_json text, options_layout text, old_syllabus text, standard_topic text, home_topic text, home_source text);

CREATE TABLE related_questions (question_id INTEGER NOT NULL REFERENCES questions(id), related_id INTEGER NOT NULL REFERENCES questions(id), similarity REAL NOT NULL, relation TEXT NOT NULL, PRIMARY KEY (question_id, related_id));

CREATE TABLE runs (id INTEGER PRIMARY KEY, document_id INTEGER REFERENCES documents(id), stage TEXT NOT NULL, started_at TEXT, finished_at TEXT, model TEXT, prompt_version TEXT, input_tokens INTEGER, output_tokens INTEGER, est_cost_usd REAL, outcome TEXT NOT NULL, error TEXT);

CREATE TABLE solutions (id INTEGER PRIMARY KEY, part_id INTEGER REFERENCES parts(id), question_id INTEGER REFERENCES questions(id), source TEXT NOT NULL, latex TEXT NOT NULL, marks_breakdown TEXT, source_document_id INTEGER REFERENCES documents(id), model TEXT, prompt_version TEXT, verified_by TEXT, verified_at TEXT, criteria_json text, meta_json text);

CREATE TABLE tags (id INTEGER PRIMARY KEY, part_id INTEGER REFERENCES parts(id), question_id INTEGER REFERENCES questions(id), scheme TEXT NOT NULL, focus_area TEXT, dot_point TEXT, code TEXT, year_level INTEGER, coverage TEXT, is_primary INTEGER DEFAULT 0, confidence REAL, tag_source TEXT NOT NULL, mapping_version TEXT, prompt_version TEXT);

