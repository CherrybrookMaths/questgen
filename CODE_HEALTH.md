# Code health: standing rule for every feature

Owner, 13 Nov: "keep this in the front of your mind as we build more features? It's important to keep the code proper and
[lean] as we develop, always come back to this ... [as] we develop new features."

This applies to every round, big or quick. Every builder prompt includes it, and every reviewer checks it.

## Rules for new code
1. **No new page-wide names.** New state goes through the shared state module (see the refactor round), or stays inside its
   own feature's scope. Count of top-level declarations must not grow without a reason written in the commit message.
2. **Styles are scoped.** Every view's CSS is prefixed by its view (e.g. `.procs .x`, `.rv-…`). No bare generic class names
   (`.pdone`, `.row`, `.card`) at the top level. The 13 Nov `.pdone` clash is the example of why.
3. **Reshape, don't bolt on.** If a feature overlaps existing code, change the existing code instead of adding a parallel
   copy. Duplicated logic is a review finding.
4. **Delete what's dead.** Code or data a change makes unused is removed in the same round (archived locally if it's data).
5. **Course is a dimension.** Never hard-code "Advanced"; topics/dot points/references come from the course's data.
6. **Watch size.** The pre-publish check reports page size and bank size against a budget; growth past it is a blocker
   until the owner agrees.

## Every round
- Builder: follow the rules; list any exceptions in the report.
- Reviewer: check the diff against rules 1–6, not only "does it work".
- After every 3–4 feature rounds, or before a big feature, run a short health pass (dead code, duplication, size).

## Known debt (13 Nov)
- ~190 top-level declarations shared across 26 files.
- Unprefixed CSS across older views.
- Dead: FOCUS_STEPS/focusPack, unused exam-auto code, site/data/bank_v1_before_split.json still published.
- Whole 5 MB bank loads at start (split by topic/course when import resumes).
- "Advanced" assumed in topics, dot points, difficulty references.
- 07_bank.js renderBank: a `//` comment swallowed the list's enter animation code (`L.classList.remove('enter')...`), so
  `#list.enter` never runs. Fix in the health pass.

## Job times on Processes (owner 13 Nov: "Are you times right? It said the recent task started 6:05")
Times in progress/queue were typed from memory and drifted (the inventory round showed 6:05; it started 7:06).
Always stamp started/finished/eta from the clock (`TZ=Australia/Sydney date -Iminutes`), never from memory.

## Parallel work (owner 13 Nov: "there has to be a way for the importer to not block the bank page right? They don't seem related.")
Unrelated changes run in parallel, each in its own git worktree (e.g. /home/claude/wt_<name>, branch <name>), with ignored
data folders symlinked in but its OWN work/ folder (page_test writes there). Merge into main when the running round has
committed, rebuild, run prepublish, publish once. Only the publish itself is sequential.
Worktree setup: symlink node_modules, site/data/{cmp,img,svg}, site/figures, site/pages, tikz; real work/ with copies of
pilot/work/*.json. A publish made from a worktree is not recorded in main's manifest until the branch is merged and
--mark-published runs in main.

## Framework (owner 13 Nov)
Asked "is react better if we are going to deploy?", then "ok great, lets not switch then". Stay on plain JS in page_src/.
Revisit the framework choice only when moving to real servers (that move rebuilds the data layer anyway). Until then the
health rules above keep the code shaped so a later move is cheap: state in one module, styles scoped per view, course as data.
