#!/usr/bin/env python3
"""Home topics of new questions into the database (IMPORT_PLAYBOOK pipeline step 12), in one command.

23 Nov (Batch 13 report: "Home topics weren't being written to the database after homes.js ... the tool still doesn't do it"; owner:
"run another two batches in the background"): tools/homes.js only printed the page's own qHome() per question; the import then wrote
them by hand. This serves site/ on a free port, runs homes.js on the given papers and writes questions.home_topic (home_source
'computed'), never over a home the owner set (home_source starting 'owner').
  python3 tools/homes.py 1341,1342,...      then tools/home_rules.py <reviews export> --write (owner filing rules)
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import json, os, socket, sqlite3, subprocess, sys, time


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


def main(docs):
    port = free_port()
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1'], cwd=paths.P + 'site',
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(1)
        r = subprocess.run(['node', paths.P + 'tools/homes.js', docs], capture_output=True, text=True, timeout=600,
                           env={**os.environ, 'QG_HOMES_PORT': str(port)})
        if r.returncode: sys.exit('homes.js failed: ' + r.stderr[-500:])
        h = json.loads(r.stdout)
    finally:
        srv.terminate()
    c = sqlite3.connect(paths.DB); n = kept = none = 0
    for q, v in h.items():
        if not v: none += 1; continue
        src = c.execute('select home_source from questions where id=?', (int(q),)).fetchone()
        if src and (src[0] or '').startswith('owner'): kept += 1; continue
        c.execute("update questions set home_topic=?, home_source='computed' where id=?", (v, int(q))); n += 1
    c.commit()
    print(f'homes: {n} written, {kept} owner homes kept, {none} with no home (removed / old syllabus) of {len(h)} questions')


if __name__ == '__main__':
    main(sys.argv[1])
