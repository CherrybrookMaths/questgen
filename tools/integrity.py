#!/usr/bin/env python3
"""Database integrity rules for questions.db (owner 14 Nov: "ok fix these issues", after the data-model diagram showed:
(1) page decisions living only in the page database, (2) data_tables owners not enforced, (3) question_id stored twice).

Installs SQLite triggers (idempotent; safe to re-run) and reports violations. Usage:
  python3 tools/integrity.py            # install triggers, fix known gaps, report
  python3 tools/integrity.py --check    # report only (used by batch_check.py)

Rules
- tags / solutions / figures / part_difficulty: when part_id is set, question_id must equal that part's question.
  If a part moves to another question (e.g. a split), the children follow automatically.
- data_tables: owner_table must be questions, parts, solutions, mcq_options or figures, and the owner row must exist.
  A row that owns a table cannot be deleted while the table points at it.
- part_difficulty.nearest_anchor must be a rated part flagged is_anchor.
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import sqlite3, sys, re
DB = paths.DBS
OWNERS = ['questions', 'parts', 'solutions', 'mcq_options', 'figures']
CHILDREN = ['tags', 'solutions', 'figures', 'part_difficulty']

def triggers():
    t = []
    for c in CHILDREN:
        for ev in ('INSERT', 'UPDATE'):
            t.append(f"""CREATE TRIGGER IF NOT EXISTS qg_{c}_qid_{ev.lower()} BEFORE {ev} ON {c}
  WHEN NEW.part_id IS NOT NULL AND NEW.question_id IS NOT NULL AND NEW.question_id != (SELECT question_id FROM parts WHERE id=NEW.part_id)
  BEGIN SELECT RAISE(ABORT,'{c}.question_id must match its part''s question'); END""")
        # a row written with only part_id gets its question filled in, so question_id is always present and correct
        t.append(f"""CREATE TRIGGER IF NOT EXISTS qg_{c}_qid_fill AFTER INSERT ON {c}
  WHEN NEW.part_id IS NOT NULL AND NEW.question_id IS NULL
  BEGIN UPDATE {c} SET question_id=(SELECT question_id FROM parts WHERE id=NEW.part_id) WHERE rowid=NEW.rowid; END""")
    t.append("""CREATE TRIGGER IF NOT EXISTS qg_parts_move AFTER UPDATE OF question_id ON parts
  WHEN NEW.question_id IS NOT OLD.question_id
  BEGIN """ + ' '.join(f"UPDATE {c} SET question_id=NEW.question_id WHERE part_id=NEW.id;" for c in CHILDREN) + " END")
    own = ' OR '.join(f"(NEW.owner_table='{o}' AND EXISTS(SELECT 1 FROM {o} WHERE id=NEW.owner_id))" for o in OWNERS)
    for ev in ('INSERT', 'UPDATE'):
        t.append(f"""CREATE TRIGGER IF NOT EXISTS qg_data_tables_owner_{ev.lower()} BEFORE {ev} ON data_tables
  WHEN NOT ({own})
  BEGIN SELECT RAISE(ABORT,'data_tables owner must be an existing questions/parts/solutions/mcq_options/figures row'); END""")
    for o in OWNERS:
        t.append(f"""CREATE TRIGGER IF NOT EXISTS qg_{o}_owns_table BEFORE DELETE ON {o}
  WHEN EXISTS(SELECT 1 FROM data_tables WHERE owner_table='{o}' AND owner_id=OLD.id)
  BEGIN SELECT RAISE(ABORT,'{o} row owns a data table: move or retire the table first'); END""")
    for ev in ('INSERT', 'UPDATE'):
        t.append(f"""CREATE TRIGGER IF NOT EXISTS qg_anchor_{ev.lower()} BEFORE {ev} ON part_difficulty
  WHEN NEW.nearest_anchor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM part_difficulty WHERE part_id=NEW.nearest_anchor AND is_anchor=1)
  BEGIN SELECT RAISE(ABORT,'nearest_anchor must be a rated HSC reference part'); END""")
    return t

def check(db):
    """Return a list of (level, message). level: 'blocker' or 'warn'."""
    out = []; q = lambda s: db.execute(s).fetchone()[0]
    n = len(db.execute('PRAGMA foreign_key_check').fetchall())
    if n: out.append(('blocker', f'{n} foreign-key violations (PRAGMA foreign_key_check)'))
    for c in CHILDREN:
        n = q(f"SELECT count(*) FROM {c} x JOIN parts p ON p.id=x.part_id WHERE x.question_id IS NOT p.question_id")
        if n: out.append(('blocker', f'{c}: {n} rows whose question_id is missing or differs from their part\'s question'))
    n = q("SELECT count(*) FROM data_tables WHERE owner_table IS NULL OR owner_table NOT IN (%s)" % ','.join(f"'{o}'" for o in OWNERS))
    if n: out.append(('blocker', f'data_tables: {n} rows with no valid owner_table'))
    for o in OWNERS:
        n = q(f"SELECT count(*) FROM data_tables d LEFT JOIN {o} x ON x.id=d.owner_id WHERE d.owner_table='{o}' AND x.id IS NULL")
        if n: out.append(('blocker', f'data_tables: {n} rows owned by a missing {o} row'))
    # every \extable{id} resolves, and every table is used (text reference, figure redraw, or retired)
    ids = {r[0] for r in db.execute('SELECT id FROM data_tables')}; used = set()
    for t, c in [('questions', 'stem_latex'), ('parts', 'latex'), ('solutions', 'latex'), ('mcq_options', 'latex')]:
        for (x,) in db.execute(f'SELECT {c} FROM {t}'):
            used.update(re.findall(r'\\extable\{([\w.-]+)\}', x or ''))
    used.update(r[0] for r in db.execute('SELECT redraw_table_id FROM figures WHERE redraw_table_id IS NOT NULL'))
    miss = used - ids
    if miss: out.append(('blocker', f'{len(miss)} \\extable references point at no table, e.g. {sorted(miss)[:3]}'))
    unused = ids - used
    if unused: out.append(('warn', f'{len(unused)} data_tables rows are not used anywhere, e.g. {sorted(unused)[:3]} (retire them)'))
    n = q("SELECT count(*) FROM part_difficulty d WHERE nearest_anchor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM part_difficulty a WHERE a.part_id=d.nearest_anchor AND a.is_anchor=1)")
    if n: out.append(('blocker', f'part_difficulty: {n} rows point at a missing HSC reference'))
    have = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'qg_%'")}
    need = {re.search(r'EXISTS (\w+)', t).group(1) for t in triggers()}
    if need - have: out.append(('warn', f'{len(need - have)} integrity triggers missing: run tools/integrity.py'))
    return out

def fix(db):
    """One-off repairs found 14 Nov; each is a no-op once applied."""
    # question_id was left empty on part-level tags and solutions; fill it so every row names its question
    for c in CHILDREN:
        db.execute(f"UPDATE {c} SET question_id=(SELECT question_id FROM parts WHERE id={c}.part_id) WHERE part_id IS NOT NULL AND question_id IS NULL")
    # 5 solution tables were created without an owner; the text that uses them names the solution
    for tid, sid in [('309_q16_s_t1', 1781), ('309_q34_s_t1', 1811), ('572_q25_t1', 1883), ('317_q28_t1', 1956), ('317_q28_t2', 1957)]:
        db.execute("UPDATE data_tables SET owner_table='solutions', owner_id=? WHERE id=? AND owner_table IS NULL", (sid, tid))
    # figures redrawn as tables by naming convention (Tf<figure id>) get the explicit link
    db.execute("""UPDATE figures SET redraw_table_id='Tf'||id WHERE redraw_table_id IS NULL AND redraw_class='table_drawn'
                  AND EXISTS(SELECT 1 FROM data_tables WHERE id='Tf'||figures.id)""")
    # tables superseded by questions.options_table_json are retired, not deleted
    db.execute('CREATE TABLE IF NOT EXISTS data_tables_retired AS SELECT *, NULL AS retired_at, NULL AS retired_why FROM data_tables WHERE 0')
    for tid in ['Tp206_1', 'Tp306_1', 'Tp307_2', 'Tp505_1']:
        if db.execute('SELECT 1 FROM data_tables WHERE id=?', (tid,)).fetchone():
            db.execute("INSERT INTO data_tables_retired SELECT *, datetime('now'), 'superseded by questions.options_table_json' FROM data_tables WHERE id=?", (tid,))
            db.execute('DELETE FROM data_tables WHERE id=?', (tid,))

if __name__ == '__main__':
    db = sqlite3.connect(DB)
    if '--check' not in sys.argv:
        fix(db)
        for t in triggers(): db.execute(t)
        db.commit()
    res = check(db)
    for lv, m in res: print(f'{lv.upper():8s}{m}')
    print(f"integrity: {sum(1 for l,_ in res if l=='blocker')} blocker(s), {sum(1 for l,_ in res if l=='warn')} warning(s)")
