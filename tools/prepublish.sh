#!/usr/bin/env bash
# (16 Nov: export_src.py removed: project/ copies of the page code stopped being published on 14 Nov (v217); GitHub holds page_src/)
# Before EVERY publish of the review page (hardening action 1, 14 Nov). Stops at the first step that fails.
#   1. tools/build_page.py        assemble site/review.html from page_src/ (and check site/vendor/)
#   2. tools/page_test_fixture.py refresh the fake page database from the questions.db mirror (page_* tables)
#   3. tools/page_test.js         the automated page test (offline, about 1 minute): every tab, bank, exams, exports, reports
#   4. tools/batch_check.py       end-of-batch checks; blocks on a failed or stale page test
#   then tools/publish_set.py prints what to publish (files changed since the last publish, with counts against the limits)
# Usage: bash tools/prepublish.sh            exit 0 = safe to publish
#        bash tools/prepublish.sh --quick    faster test without exports (batch_check will still block: run the full one)
set -euo pipefail
cd "$(dirname "$0")/.."
# owner 18 Nov ("yeah fix whatever needs fixing first"): mid-import, the bank may have been built WITH the held papers (QG_WITH_HELD=1, for
# the import's own homes / difficulty steps). Such a bank must never go live, so it is rebuilt without them here first (batch_check
# still blocks one that slips through)
if python3 -c "
import json, sys; sys.path.insert(0, 'tools'); import import_hold
h = import_hold.held_docs()
sys.exit(0 if h and any(int(q['doc']) in h for q in json.load(open('site/data/bank.json'))['questions']) else 1)"; then
  echo '== 0/4 the bank holds papers still mid-import: rebuilding it without them'
  python3 tools/build_bank.py | tail -1 && python3 tools/bank_split.py | tail -1
fi
echo '== 1/4 build page';            python3 tools/build_page.py | sed -n '1,2p'
echo '== 2/4 page test fixture';     python3 tools/page_test_fixture.py
echo '== 3/4 page test';             node tools/page_test.js "$@" | grep -v '^PASS  tab ' || { echo 'PAGE TEST FAILED: see work/page_test/last_result.json and work/page_test/shots/'; exit 1; }
echo '== 4/4 batch check';           python3 tools/batch_check.py
echo '== publish set';               python3 tools/publish_set.py | sed -n '1,6p'; echo '   (full files map: python3 tools/publish_set.py --json)'
