# Overnight report, 13 Nov

Nothing was published or imported overnight. The database (questions.db), the exam PDFs and Google Drive were not touched. Everything is committed on main, and `bash tools/prepublish.sh` passes: 157 of 157 page checks, 0 blockers.

## What changed

**1. The Papers tab is simpler** (Processes › Papers, editors only). This is what you asked for: "I'm getting CONFUSED with our current papers page", then "Yes, with batch pauses". From top to bottom:
- **Summary.** 52 imported · 513 can be imported (232 current syllabus, 281 old) · 2,093 set aside (1,002 other courses, 801 Year 11 held, 49 course not known yet, 241 not in scope). The Rescan drive button is still on the first line.
- **Import a course.** Pick a Year and a Course, then press Go. Year 12 Advanced shows 486 not imported, 54 batches of 9, and an estimated US$5,832–8,262. Go asks you to Confirm or Cancel on the page itself. Year 11 is switched off ("held until Year 12 is finished"), and so are Standard, Extension 1 and Extension 2 ("needs course setup").
- **Running / next.** This shows the run you requested, with a Cancel request button, and the next two batches. With no run, it shows Batch 6 and Batch 7 from your import order.
- **Choose papers ▸, By course ▸ and Import history ▸** are folded away below.

Go only records a request. Import is still paused. When it resumes, Claude does one batch at a time and waits for you to clear each batch in Review before starting the next.

**2. Code clean-up, with no visible change.** Dead code and two unused files are gone. Five class names that clashed between views were renamed. There is now a size budget that blocks a publish if the page or the data grows more than 25% past tonight's size. Shared state is in one place, and the course ("Advanced") is now a setting rather than typed into the page. The page is 35 KB smaller.

**3. Independent review (this stage).**
- I clicked through every area on the built page with real data: the Bank, Exams (built a 100-mark paper; the PDF and Word downloads worked), Review, Processes and the Guide. I did this as an editor, as a viewer, and with no user at all. There were no console errors, no missing files and no sideways scrolling.
- I compared screenshots against the last published version (publish-v211) at 1280 px light and at 390 px light and dark. The Bank, Review, Exams, the Guide and Processes › Work are pixel-identical. The only differences are clock text ("16 min ago") and the Papers tab, which was meant to change.
- Both paper calls work. Cherrybrook 2025 "Keep as is" and North Sydney Boys 2024 "Change…" each saved your answer, and the Inbox then cleared.

## What I fixed or chose while you were asleep
- **Running / next now sits above Choose papers.** It had been built below, so opening the import order (132 papers) pushed your run out of sight. The build notes also described it as above. The empty message now ends "…or choose papers one by one below."
- **Refreshed the copies of the specs and tools** kept with the page (project/), which had fallen behind. I also added CODE_HEALTH.md to them. The old copies held only older wordings that the main files have since replaced.

## Please check first
1. **Processes › Papers**: does the order and wording make sense now? Try Go, then Cancel, on Year 12 Advanced.
2. **Review**: the two paper calls are still waiting for your real answer. My test answers were not saved.
3. **Exams**: if a question has its answer lines set to 0, a 72 px gap is left behind. This has always been there and came from a shared style by accident. Should it go? Removing it reflows exam papers.
4. **Import history** still says "43 / 177 papers parsed" and "1282 questions loaded" (old batch counts). The summary above it says 52 imported. These were already out of step before tonight. Tell me if you want them brought in line.

---

## Publish instructions (main session)

1. Run `bash tools/prepublish.sh`. It must exit 0. As of this commit it does: 157/157 checks, 0 blockers.
2. Run `python3 tools/publish_set.py --json > work/publish_files_1113.json`. At this commit the map has 46 entries, including two nulls: `data/bank_v1_before_split.json` and `project/focus_crops.py.txt`. Pass the map unchanged, nulls included.
3. Publish with the Artifact tool:
   - `url`: https://claude.ai/artifact/MSd3GSrwsAqwzmBX8wSC8f
   - `file_path`: `site/review.html`
   - `files`: the map from step 2 (keys are published paths; values are paths relative to /home/claude/pilot)
   - `capabilities`:

```json
{
  "db": {"rules": [
    {"path": "reviews", "read": "view",  "write": "interact"},
    {"path": "scans",   "read": "admin", "write": "admin"},
    {"path": "runs",    "read": "admin", "write": "admin"}
  ]},
  "downloads": true,
  "user": {},
  "mcp": {"servers": [{"server": "Google Drive", "tools": ["search_files"]}]}
}
```

   **Warning:** a non-empty `capabilities` object replaces everything the page has now. Collections without a rule fall back to the default: anyone signed in can read, and Contributors can write. The page also uses `importq`, `difficulty`, `exams`, `notes`, `progress` and `reports`. UI_SPEC says `importq` is editors only, "like `importq` and `scans`", but the rule set above does not include it. Before publishing, check the live page's current rules. If it has an `importq` rule (or any other), add `{"path": "importq", "read": "admin", "write": "admin"}` and keep the rest. Otherwise the import order becomes readable by viewers and writable by Contributors.
4. Run `python3 tools/batch_check.py --mark-published`. It commits and tags publish-v212.
5. Sync Drive as usual, including `/mnt/user-data/outputs/questgen_repo.bundle`.
