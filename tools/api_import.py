#!/usr/bin/env python3
"""Run the model steps of an import batch through the Anthropic API, logging tokens and US$ per call, step and paper.

Owner 17 Nov: "I want to do batch 8 via the api so we can get a cost estimate"; "we'll need API for usage limits too right?
Lets just set it up?"; on the key, "yes yes use qg anthropic key". The key is read from $QG_ANTHROPIC_API_KEY (else
$ANTHROPIC_API_KEY); it is never printed, logged or written to a file.

Same specs and models per step as the in-session import (IMPORT_PLAYBOOK "Models per step", 16 Nov): parse, split and
solutions on Sonnet, tagging, diagrams and verify on Opus, no Haiku. The deterministic steps between them (load.py,
post_load.py, prep_batch.py, apply_text.py, apply_diagrams.py, prep_verify.py, triage.py, build_bank.py) run locally as
before; this tool only replaces the agents. Each paper is its own run (or a few chunks), so its cost is exact.

  python3 tools/api_import.py parse    <batch> <doc_id> [...]   src/<doc>.pdf (+ its solutions files) -> state/out/<doc>.json, figures/
  python3 tools/api_import.py split    <batch>                  work/<b>/split_in.json   -> work/<b>/split_out.json
  python3 tools/api_import.py tag      <batch>                  tag/in_<b>_*.json        -> tag/out_<b>_<doc>_<k>.json
  python3 tools/api_import.py solfmt   <batch>                  work/<b>/solfmt_in_*.json -> work/solfmt_<b>_<doc>_<k>.json
  python3 tools/api_import.py gen      <batch>                  work/<b>/gen_in_*.json   -> work/<b>/gen_out_<doc>_<k>.json (+ tikz/group_<b>_gen_<doc>.json)
  python3 tools/api_import.py diagrams <batch>                  tikz/group_<b>_*.json    -> state/tikz/tex/<id>.tex, tikz/result_<b>_<doc>_<k>.json
  python3 tools/api_import.py verify   <batch>                  work/<b>/verify_in_*.json -> state/work/<b>/verify_out_<doc>_<k>.json
  python3 tools/api_import.py difficulty <batch> [--docs ...]     unrated leaf parts in the Bank -> state/work/difficulty/<b>/<doc>_<k>.json
  python3 tools/api_import.py difficulty-apply <batch>           those files -> part_difficulty (then tools/apply_difficulty_reviews.py)
  python3 tools/api_import.py cost     <batch>                  per step / per paper / per model table -> state/work/api_import/<b>/cost.json
Options: --docs 1585,1597 (only these papers), --workers N (papers in parallel, default 4), --redo (run chunks that already
have an output file again).

Log: state/work/api_import/<batch>/calls.jsonl, one line per API call {t, step, doc, chunk, model, effort, turn, usage, usd,
stop}. Transcripts (images and PDFs left out) in work/api_import/<batch>/<step>_<doc>_<k>.json (untracked).
Prices: tools/api_import.py PRICE (US$ per million tokens, Claude API list prices, 17 Nov).
"""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import paths  # repo locations (tools/paths.py)
import base64, datetime, glob, json, os, re, sqlite3, subprocess, sys, threading, time, traceback
from concurrent.futures import ThreadPoolExecutor

P, S = paths.P, paths.S
# US$ per million tokens: input, output, cache read; a 5-minute cache write costs 1.25 x input (Claude API list prices)
PRICE = {'claude-opus-5-5': (4.0, 20.0, 0.20), 'claude-sonnet-5-5': (2.0, 10.0, 0.10), 'claude-opus-5': (5.0, 25.0, 0.50),
         'claude-opus-4-8': (5.0, 25.0, 0.50), 'claude-sonnet-5': (2.0, 10.0, 0.20)}
# owner 16 Nov (IMPORT_PLAYBOOK "Models per step"): parse and solutions Sonnet, tagging Opus, diagrams and verify Opus, no Haiku
MODEL = {'parse': 'claude-sonnet-5-5', 'split': 'claude-sonnet-5-5', 'solfmt': 'claude-sonnet-5-5', 'gen': 'claude-sonnet-5-5',
         'tag': 'claude-opus-5-5', 'diagrams': 'claude-opus-5-5', 'verify': 'claude-opus-5-5',
         # owner 18 Nov: "Yeah can u do that to the API tool please? Also we need to assign difficulty to the questions in the bank
         # which aren't assigned." (to adding a difficulty step on Opus; bands need the same judgement as tagging)
         'difficulty': 'claude-opus-5-5'}
EFFORT = {'parse': 'high', 'split': 'medium', 'solfmt': 'medium', 'gen': 'high', 'tag': 'high', 'diagrams': 'high', 'verify': 'high', 'difficulty': 'high'}
CHUNK = {'tag': 120, 'solfmt': 30, 'gen': 10, 'diagrams': 8, 'verify': 20, 'split': 60, 'difficulty': 40}
MULTI_TURN = {'parse', 'diagrams', 'verify'}   # steps that loop over several turns (renders, checks); the rest submit in one reply
MAX_TURNS = {'parse': 60, 'diagrams': 40, 'verify': 30, 'gen': 12}
LOCK = threading.Lock()


# ---------------------------------------------------------------- API client, logging, agent loop
def client():
    import anthropic
    key = os.environ.get('QG_ANTHROPIC_API_KEY') or os.environ.get('ANTHROPIC_API_KEY')
    if not key: sys.exit('no API key: set QG_ANTHROPIC_API_KEY in the environment settings')
    return anthropic.Anthropic(api_key=key, max_retries=6, timeout=1800)


def usd(model, u):
    pin, pout, pcr = PRICE.get(model, PRICE['claude-opus-5-5'])
    return round((u['input_tokens'] * pin + u['cache_creation_input_tokens'] * pin * 1.25 + u['cache_read_input_tokens'] * pcr
                  + u['output_tokens'] * pout) / 1e6, 5)


def now():   # CLAUDE.md: times are Sydney time, read from the clock
    from zoneinfo import ZoneInfo
    return datetime.datetime.now(ZoneInfo('Australia/Sydney')).isoformat(timespec='seconds')


def log_call(batch, rec):
    d = S + f'work/api_import/{batch}/'; os.makedirs(d, exist_ok=True)
    with LOCK, open(d + 'calls.jsonl', 'a') as f: f.write(json.dumps(rec) + '\n')


def strip_media(o):
    """A transcript without base64 payloads (PDFs, images)."""
    if isinstance(o, dict):
        if o.get('type') == 'base64' and 'data' in o: return {**o, 'data': f'<{len(o["data"])} b64 chars>'}
        return {k: strip_media(v) for k, v in o.items()}
    if isinstance(o, list): return [strip_media(x) for x in o]
    return o


def dump(x):
    return x.model_dump(exclude_none=True) if hasattr(x, 'model_dump') else x


class Run:
    """One agent run: a step on one chunk of one paper. Tools are (definition, handler) pairs; the run ends when the
    submit tool's handler returns done=True, or after MAX_TURNS."""
    def __init__(self, batch, step, doc, chunk, system, user, tools, submit):
        self.batch, self.step, self.doc, self.chunk = batch, step, doc, chunk
        self.model, self.effort = MODEL[step], EFFORT[step]
        self.system, self.user, self.tools, self.submit = system, user, tools, submit
        self.primed = threading.Event()   # set after the first reply: the shared instructions are cached from then on
        self.done, self.result, self.cost, self.turns = False, None, 0.0, 0

    def go(self, api):
        msgs = [{'role': 'user', 'content': self.user}]
        defs = [t[0] for t in self.tools]; handlers = {t[0]['name']: t[1] for t in self.tools}
        nudges = 0
        for turn in range(MAX_TURNS.get(self.step, 8)):
            self.turns = turn + 1
            for attempt in range(5):
                try:
                    with api.beta.messages.stream(model=self.model, max_tokens=64000, system=self.system, tools=defs, messages=msgs,
                                                  thinking={'type': 'adaptive'}, output_config={'effort': self.effort},
                                                  # owner 18 Nov: "Lets try one more batch with NO batching but with the caching fixed and lets compare
                                                  #   costs". Batch 10 paid US$20.18 for cache writes and got US$1.95 of reads back. Single-turn steps
                                                  #   no longer mark the whole request (it is never sent again); multi-turn steps keep it for their next turn
                                                  **({'cache_control': {'type': 'ephemeral'}} if self.step in MULTI_TURN or turn > 0 else {}),
                                                  betas=['server-side-fallback-2026-07-01'], fallbacks='default') as s:
                        m = s.get_final_message()
                    break
                except Exception as e:   # the SDK already retried 429/5xx/connection errors 6 times; a few slower retries more
                    if attempt == 4 or type(e).__name__ in ('BadRequestError', 'AuthenticationError', 'PermissionDeniedError', 'NotFoundError'): raise
                    time.sleep(30 * (attempt + 1))
            u = {k: getattr(m.usage, k, 0) or 0 for k in ('input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens')}
            c = usd(m.model, u); self.cost += c
            self.primed.set()
            log_call(self.batch, {'t': now(), 'step': self.step, 'doc': self.doc, 'chunk': self.chunk, 'model': m.model, 'effort': self.effort,
                                  'turn': turn + 1, **u, 'usd': c, 'stop': m.stop_reason})
            msgs.append({'role': 'assistant', 'content': [dump(b) for b in m.content]})
            if m.stop_reason == 'refusal': raise RuntimeError(f'refused: {dump(m.stop_details)}')
            uses = [b for b in m.content if b.type == 'tool_use']
            if m.stop_reason == 'max_tokens' and uses:   # a cut-off tool call cannot be run: ask for a smaller one
                msgs[-1]['content'] = [dump(b) for b in m.content if b.type != 'tool_use']
                msgs.append({'role': 'user', 'content': 'Your last reply was cut off at the output limit before the tool call finished. '
                                                        'Make the call again with less in it (e.g. submit in parts if the tool allows it).'})
                continue
            if not uses:
                nudges += 1
                if nudges > 2: break
                msgs.append({'role': 'user', 'content': f'Finish by calling {self.submit} with the complete output.'}); continue
            res = []
            for b in uses:
                h = handlers.get(b.name)
                try: out, done = h(b.input) if h else (f'unknown tool {b.name}', False)
                except Exception as e: out, done = f'tool error: {type(e).__name__}: {e}', False
                if done: self.done = True
                res.append({'type': 'tool_result', 'tool_use_id': b.id, 'content': out if isinstance(out, list) else str(out)})
            msgs.append({'role': 'user', 'content': res})
            if self.done: break
        d = P + f'work/api_import/{self.batch}/'; os.makedirs(d, exist_ok=True)
        json.dump(strip_media(msgs), open(d + f'{self.step}_{self.doc}_{self.chunk}.json', 'w'), ensure_ascii=False, indent=1)
        return self


def text_block(s, cache=False):
    b = {'type': 'text', 'text': s}
    if cache: b['cache_control'] = {'type': 'ephemeral'}
    return b


def image_block(path_or_bytes, limit=1900):
    data = open(path_or_bytes, 'rb').read() if isinstance(path_or_bytes, str) else path_or_bytes
    from PIL import Image
    import io
    im = Image.open(io.BytesIO(data))
    if max(im.size) > limit:   # the API refuses images over 2000 px a side in requests with many images (17 Nov, diagrams 833)
        im.thumbnail((limit, limit)); buf = io.BytesIO(); im.save(buf, 'PNG'); data = buf.getvalue()
    return {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/png', 'data': base64.b64encode(data).decode()}}


def pdf_block(doc_id, title):
    return {'type': 'document', 'title': title,
            'source': {'type': 'base64', 'media_type': 'application/pdf', 'data': base64.b64encode(open(str(paths.SRC / f'{doc_id}.pdf'), 'rb').read()).decode()}}


def submit_tool(name, desc, schema):
    return {'name': name, 'description': desc, 'input_schema': schema}


def bare_math(s):
    """True when text has maths commands outside $...$ / \\(...\\) (it would show as raw LaTeX on the page)."""
    s = re.sub(r'\\\$', '', s or '')
    s = re.sub(r'\$\$.*?\$\$|\$[^$]*\$|\\\(.*?\\\)|\\\[.*?\\\]', '', s, flags=re.S)
    s = re.sub(r'\\(exfigure|extable|textbf|textit|emph|underline|textsuperscript|text|quad|qquad|newline|item|begin|end|\\)\b(\{[^}]*\})?', '', s)
    return bool(re.search(r'\\[a-zA-Z]+|\^|_\{', s))


def check_latex(obj):
    f = paths.scratch('api_import') / f'chk_{threading.get_ident()}.json'
    json.dump(obj, open(f, 'w'), ensure_ascii=False)
    r = subprocess.run(['node', P + 'tools/check_latex.js', str(f)], capture_output=True, text=True)
    try: return json.loads(r.stdout)
    except ValueError: return {'errors': 1, 'sample': [r.stderr[-300:]]}


def db():
    c = sqlite3.connect(paths.DBS); c.row_factory = sqlite3.Row; return c


def spec(name):
    return open(P + name).read()


API_NOTE = """
## Running through the API (17 Nov)
You are run through the Anthropic API, not inside a Claude Code session: there is no Bash, Read or file system. Where the
spec above says to run a command, read a file or write a file, use the tools you are given instead; paths in the spec
are only names. Your final output goes in the submit tool's input (not a file, not your reply). Ignore the spec's
"Final reply" section: after the submit tool says the output was saved, reply with one short line.
"""


# ---------------------------------------------------------------- parse
FIG_ID = re.compile(r'^(\d+)_q([0-9A-Za-z().-]+)_(s?\d+)$')


def pdf_page(doc_id, page):
    import pymupdf
    d = pymupdf.open(str(paths.SRC / f'{doc_id}.pdf'))
    if not 0 <= page < d.page_count: raise ValueError(f'page {page} out of range 0..{d.page_count - 1}')
    return d, d[page]


def t_page_text(a):
    d, pg = pdf_page(a['file'], a['page'])
    t = pg.get_text('text')
    return (t if t.strip() else '(no text layer on this page: it is a scan)')[:12000], False


def t_render(a):
    import pymupdf
    d, pg = pdf_page(a['file'], a['page'])
    dpi = max(60, min(int(a.get('dpi') or 110), 300))
    clip = pymupdf.Rect(a['clip']) if a.get('clip') else None
    pix = pg.get_pixmap(dpi=dpi, clip=clip)
    r = pg.rect
    return [{'type': 'text', 'text': f'file {a["file"]} page {a["page"]} (0-based): {r.width:.0f} x {r.height:.0f} pt' + (f', clip {a["clip"]}' if clip else '') + f', {dpi} dpi'},
            image_block(pix.tobytes('png'))], False


def t_layout(a):
    """Bounding boxes of embedded images and of clusters of vector drawings on a page (digital PDFs): exact figure positions."""
    import pymupdf
    d, pg = pdf_page(a['file'], a['page'])
    imgs = [[round(v) for v in i['bbox']] for i in pg.get_image_info()]
    rects = [pymupdf.Rect(x['rect']) for x in pg.get_drawings() if x['rect'].width > 1 or x['rect'].height > 1]
    clusters = []
    for r in rects:
        r = pymupdf.Rect(r)
        merged = True
        while merged:
            merged = False
            for c in clusters:
                if (c + (-6, -6, 6, 6)).intersects(r):
                    clusters.remove(c); r |= c; merged = True; break
        clusters.append(r)
    cl = [[round(c.x0), round(c.y0), round(c.x1), round(c.y1)] for c in clusters if c.width > 20 and c.height > 20]
    full = pg.rect
    cl = [c for c in cl if not (c[2] - c[0] > 0.9 * full.width and c[3] - c[1] > 0.9 * full.height)]   # page frames
    return json.dumps({'page_size': [round(full.width), round(full.height)], 'images': imgs, 'drawing_clusters': cl[:40]}), False


def t_crop(a):
    import pymupdf
    k = a['id']
    if not FIG_ID.match(k): return f'bad figure id {k!r}: use <doc>_q<number>_<k> or <doc>_q<number>_s<k>', False
    d, pg = pdf_page(a['file'], a['page'])
    bbox = pymupdf.Rect(a['bbox']) & pg.rect
    if bbox.is_empty: return 'empty bbox', False
    os.makedirs(P + 'figures', exist_ok=True)
    pix = pg.get_pixmap(dpi=200, clip=bbox); pix.save(P + f'figures/{k}.png')
    return [{'type': 'text', 'text': f'saved figures/{k}.png ({pix.width} x {pix.height} px, bbox {[round(v, 1) for v in bbox]}). Check it shows the whole figure and nothing else.'},
            image_block(pix.tobytes('png'))], False


PARSE_TASK = """Parse the paper below into the parse-v1 JSON of the spec, and submit it with `submit_parse`.

Paper: document id {doc}, label "{label}", task_type {task_type}, parse_path {parse_path}, year {year}, setter {school}, task {task}.
Files attached (PDF documents, in this order):
{files}
The output's document_id is {doc}. Questions come from file {doc}. Solutions / marking guidelines come from the solutions file(s) when
they are separate (merge them into this one output, as the 2024 Knox AT2 parse did with its guideline file) or from the bundled
pages; MCQ keys from the guidelines (or an answer-sheet file).

What the bank's current parse outputs also carry (follow them exactly; they are what tools/load.py reads):
- top level: "task_type", "cover": {{"year", "year_printed", "graduation_year", "school_or_setter", "school_formal", "task_code", "label", "title"}}
  read off the cover (graduation-year rule of the spec's Naming section; trials are AT4), "tables": [], "solution_figures": [], "notes".
- every question: "seq" (1-based order in the paper), "section", "options_layout" ("text" | "table" | "graph") and "key_source" on MCQs.
  Option figures: each option's own figure has id <doc>_q<n>_<k>, `attach`: "option A" etc., and the option carries "figure_key".
- tables printed as text in a question go in "tables" as data, with \\extable{{<id>}} in the text where the table is:
  {{"id": "<doc>_q<n>_t<k>", "question": "<n>", "part": null | "b.ii", "caption": null | "...", "header_rows": 0, "label_column": true | false,
  "rows": [["$x$", "1", "2"], ["$f(x)$", "3", "5"]], "spans": [[row, col, colspan, rowspan], ...]}}. Cells are maths (wrap words in \\text{{}}, write \\%).
  A table drawn as a picture can be cropped as a figure instead.
- solutions: {{"question": "<n>", "part": null | "a" | "b.ii", "latex", "marks_breakdown": "2: ...; 1: ..." | null, "source": "extracted"}}.
- solution figures (sketches or diagrams in the guidelines): "solution_figures": [{{"id": "<doc>_q<n>_s<k>", "source_pdf": "<file id>", "page",
  "bbox", "question": "<n>", "part": null | "b", "caption"}}], cropped with crop_figure from that file, and \\exfigure{{<id>}} in the solution's latex.
- Question numbers as printed. Follow the spec's "Unrelated parts are separate questions" rule yourself: a school paper that groups unrelated
  items under one number stores each as its own question "1(a)", "1(b)" (parts that share a stem or data, or say hence, stay together).
  A multiple-choice item stored that way is an MCQ question (question_type mcq, options in mcq_options, never inline in the text), with
  its key in mcq_key under that number (e.g. "1(a)": "D"), as the 2024 Knox AT2 parse did. A split step later catches anything left.

Tools: page_text (exact wording from a digital page's text layer), render_page (look at a page or zoom into a clip at higher dpi),
page_layout (exact boxes of the images and vector drawings on a digital page: use them for figure bboxes), crop_figure (writes the PNG;
look at what it returns). Page numbers in every tool and in the output are 0-based indexes into that file. The attached PDFs show
you every page already: use the tools for exact text, zoom and crops, not to re-read pages you can already see.
Submit the whole JSON once you have done the spec's self-checks; submit_parse runs the LaTeX check and the figure-file check and
tells you what to fix. Fix and submit again (the whole JSON) until it says saved."""


def parse_tools(doc):
    fid = {'type': 'integer', 'description': 'file (document) id, e.g. %d' % doc}
    pg = {'type': 'integer', 'description': '0-based page index'}
    box = {'type': 'array', 'items': {'type': 'number'}, 'minItems': 4, 'maxItems': 4, 'description': '[x0, y0, x1, y1] in PDF points, origin top-left'}
    tries = {'n': 0}

    def submit(a):
        out = a.get('output')
        if isinstance(out, str):
            try: out = json.loads(out)
            except ValueError as e: return f'output is not valid JSON: {e}', False
        errs = []
        if not isinstance(out, dict) or not isinstance(out.get('questions'), list): return 'output must be the parse JSON object with a questions list', False
        if out.get('document_id') != doc: errs.append(f'document_id must be {doc}')
        figs = {f['id'] for q in out['questions'] for f in q.get('figures') or []} | {f['id'] for f in out.get('solution_figures') or []}
        texts = json.dumps(out, ensure_ascii=False)
        for k in sorted(set(re.findall(r'\\\\exfigure\{([^}]+)\}', texts)) | figs):
            if not os.path.exists(P + f'figures/{k}.png'): errs.append(f'figures/{k}.png does not exist (crop it with crop_figure)')
            if k not in figs: errs.append(f'\\exfigure{{{k}}} is used but no figure record (question figures / solution_figures) has that id')
        tabs = {t['id'] for t in out.get('tables') or []}
        for t in set(re.findall(r'\\\\extable\{([^}]+)\}', texts)) - tabs: errs.append(f'\\extable{{{t}}} is used but "tables" has no entry {t}')
        for q in out['questions']:
            if not q.get('parts'): errs.append(f'Q{q.get("number")}: no parts')
            for p in q.get('parts') or []:
                if not (p.get('latex') or '').strip(): errs.append(f'Q{q.get("number")}({p.get("label")}): empty latex')
            # checker 17 Nov (Batch 8): "The fractions in the choices are not rendering. They say \dfrac{25}{28} instead of the
            # actual rendered fraction": options written without $...$ passed the LaTeX check (it reads them as text).
            for o in q.get('mcq_options') or []:
                if bare_math(o.get('latex')): errs.append(f'Q{q.get("number")} option {o.get("label")}: maths outside $...$ (wrap it: ${o.get("latex")}$)')
        cl = check_latex(out)
        if cl.get('errors'): errs += [f'LaTeX: {s}' for s in cl.get('sample', [])] + ([f'... {cl["errors"]} LaTeX errors in all'] if cl['errors'] > 15 else [])
        tries['n'] += 1
        if errs and tries['n'] < 4: return 'Not saved. Fix these and submit the whole JSON again:\n' + '\n'.join(errs[:60]), False
        if errs: out['notes'] = (out.get('notes') or '') + ' | API submit check, unresolved after 4 tries: ' + '; '.join(errs[:20])
        out.setdefault('prompt_version', 'parse-v1'); out['parse_model'] = MODEL['parse']
        json.dump(out, open(S + f'out/{doc}.json', 'w'), ensure_ascii=False, indent=1)
        nq = len(out['questions']); np_ = sum(len(q['parts']) for q in out['questions'])
        return f'saved state/out/{doc}.json: {nq} questions, {np_} parts, {len(figs)} figures, {len(out.get("solutions") or [])} solutions' + (' (with unresolved check errors noted)' if errs else ''), True

    return [
        ({'name': 'page_text', 'description': 'Text layer of one page (digital PDFs), for exact wording.', 'input_schema': {'type': 'object', 'properties': {'file': fid, 'page': pg}, 'required': ['file', 'page']}}, t_page_text),
        ({'name': 'render_page', 'description': 'Render a page (or a clip of it, to zoom in) as a PNG you can look at.', 'input_schema': {'type': 'object', 'properties': {'file': fid, 'page': pg, 'dpi': {'type': 'integer', 'description': '60-300, default 110'}, 'clip': box}, 'required': ['file', 'page']}}, t_render),
        ({'name': 'page_layout', 'description': 'Page size and the exact boxes of embedded images and clusters of vector drawings on a page, in PDF points.', 'input_schema': {'type': 'object', 'properties': {'file': fid, 'page': pg}, 'required': ['file', 'page']}}, t_layout),
        ({'name': 'crop_figure', 'description': 'Crop a figure at 200 dpi to figures/<id>.png and show it. Call again with the same id to replace a crop.', 'input_schema': {'type': 'object', 'properties': {'id': {'type': 'string'}, 'file': fid, 'page': pg, 'bbox': box}, 'required': ['id', 'file', 'page', 'bbox']}}, t_crop),
        (submit_tool('submit_parse', 'Submit the complete parse JSON (the whole object). It is checked; when it says saved, you are done.',
                     {'type': 'object', 'properties': {'output': {'type': 'object', 'description': 'the parse-v1 JSON object'}}, 'required': ['output']}), submit)]


def paper_files(c, doc):
    """Every file of a paper (question paper, separate solutions, answer sheet), as the inventory groups them."""
    import inventory
    inv = inventory.build(sqlite3.connect('file:' + paths.DBS + '?mode=ro', uri=True), files=True)
    ids = next((p['f'] for g in inv['groups'] for p in g['papers'] if p['id'] == doc), [doc])
    return [dict(c.execute('select * from documents where id=?', (f,)).fetchone()) for f in ids]


def run_parse(api, batch, docs):
    c = db()
    jobs = []
    for doc in docs:
        r = c.execute('select * from documents where id=?', (doc,)).fetchone()
        files = [f for f in paper_files(c, doc) if os.path.exists(str(paths.SRC / f'{f["id"]}.pdf'))]
        if not any(f['id'] == doc for f in files): print('skip (no src/%d.pdf)' % doc); continue
        if not args.redo and os.path.exists(S + f'out/{doc}.json'): print('skip (done)', doc); continue
        desc = '\n'.join(f'- file {f["id"]}: {f["task_type"]}, {f["parse_path"]}, {f["page_count"]} pages, "{os.path.basename(f["source_path"])}"' for f in files)
        system = [text_block(spec('PARSE_SPEC.md') + API_NOTE, cache=True)]
        user = [pdf_block(f['id'], f'file {f["id"]}: {os.path.basename(f["source_path"])}') for f in files]
        user[-1]['cache_control'] = {'type': 'ephemeral'}
        user.append(text_block(PARSE_TASK.format(doc=doc, label=r['display_label'] or '', task_type=r['task_type'], parse_path=r['parse_path'], year=r['year'],
                                                 school=r['school_formal'], task=r['task_code'], files=desc)))
        jobs.append(Run(batch, 'parse', doc, 1, system, user, parse_tools(doc), 'submit_parse'))
    return jobs


# ---------------------------------------------------------------- chunked JSON steps (split, tag, solfmt, gen, verify)
def doc_of_question(c, qid):
    r = c.execute('select document_id from questions where id=?', (qid,)).fetchone(); return r[0] if r else None


def chunks(items, n):
    k = max(1, -(-len(items) // n))
    return [items[i * len(items) // k:(i + 1) * len(items) // k] for i in range(k)]


def by_doc(items, key):
    out = {}
    for it in items: out.setdefault(key(it), []).append(it)
    return out


def json_submit(name, desc, check, write):
    tries = {'n': 0}

    def h(a):
        out = a.get('output')
        if isinstance(out, str):
            try: out = json.loads(out)
            except ValueError as e: return f'output is not valid JSON: {e}', False
        errs = check(out)
        tries['n'] += 1
        if errs and tries['n'] < 3: return 'Not saved. Fix these and submit the whole output again:\n' + '\n'.join(errs[:40]), False
        write(out, errs)
        return 'saved' + (f' (with {len(errs)} unresolved problems noted)' if errs else ''), True
    return (submit_tool(name, desc, {'type': 'object', 'properties': {'output': {'description': 'the complete output'}}, 'required': ['output']}), h)


def latex_errs(out):
    cl = check_latex(out)
    return [f'LaTeX: {s}' for s in cl.get('sample', [])] if cl.get('errors') else []


def run_split(api, batch, docs):
    c = db(); items = json.load(open(P + f'work/{batch}/split_in.json'))
    jobs = []; out_files = []
    for doc, its in by_doc(items, lambda x: doc_of_question(c, x['question_id'])).items():
        if docs and doc not in docs: continue
        for k, ch in enumerate(chunks(its, CHUNK['split']), 1):
            f = P + f'work/{batch}/split_out_{doc}_{k}.json'; out_files.append(f)
            if os.path.exists(f) and not args.redo: continue
            ids = {x['question_id'] for x in ch}
            tops = {x['question_id']: sorted(x['top_labels']) for x in ch}

            def check(out, ids=ids, tops=tops):
                e = []
                for s in (out or {}).get('splits', []):
                    if s.get('question_id') not in ids: e.append(f'question_id {s.get("question_id")} is not in the input')
                    elif sorted(l for g in s.get('groups', []) for l in g) != tops[s['question_id']]: e.append(f'{s["question_id"]}: groups must use every top-level label once: {tops[s["question_id"]]}')
                return e
            task = ('Decide, for each question below, whether its lettered parts are UNRELATED items grouped under one number (split them) or one '
                    'question (keep). Spec rule (PARSE_SPEC "Unrelated parts are separate questions", owner 11 Nov): "Store each unrelated part as its own '
                    'question numbered 13(a), 13(b). Keep parts together when they share a stem or data, or one says hence / use part (a)." A shared '
                    'instruction such as "Differentiate the following", "Find:" or "Evaluate" over a list of exercises also keeps them together '
                    '(the bank keeps all 22 such lists as one question; the Batch 8 API run split two and they were not applied). Group the '
                    'top-level labels: [["a"],["b","c"]] splits off (a) and keeps (b),(c) together. List only questions to split, with a one-line reason. '
                    'Submit {"splits": [{"question_id", "groups", "reason"}]} with submit_split (an empty list when nothing splits).\n\n' + json.dumps(ch, ensure_ascii=False))
            jobs.append(Run(batch, 'split', doc, k, [text_block('You prepare NSW HSC Mathematics Advanced exam questions for a question bank.' + API_NOTE, cache=True)],
                            [text_block(task)], [json_submit('submit_split', 'Submit {"splits": [...]}', check,
                                                             lambda out, errs, f=f: json.dump(out, open(f, 'w'), ensure_ascii=False, indent=1))], 'submit_split'))
    return jobs, out_files


def merge_split(batch, files):
    allsp = []
    for f in files:
        if os.path.exists(f): allsp += json.load(open(f)).get('splits', [])
    json.dump({'splits': allsp}, open(P + f'work/{batch}/split_out.json', 'w'), ensure_ascii=False, indent=1)
    print('work/%s/split_out.json: %d splits' % (batch, len(allsp)))


def run_tag(api, batch, docs):
    items = []
    for f in sorted(glob.glob(P + f'tag/in_{batch}_*.json')): items += json.load(open(f))['parts']
    dps = json.load(open(S + 'work/skills/dotpoints.json')); dp_ids = {d['id'] for d in dps}
    skills = json.load(open(P + 'site/project/skills_spec.json')); names = {s['skill'] for s in (skills if isinstance(skills, list) else skills.get('skills', []))}
    pre = json.load(open(S + 'work/skills/skill_prereqs.json'))
    system = [text_block(spec('TAG_SPEC.md') + API_NOTE + '\n\n## work/skills/dotpoints.json\n' + json.dumps(dps, ensure_ascii=False)
                         + '\n\n## work/skills/skills_spec.json\n' + json.dumps(skills, ensure_ascii=False)
                         + '\n\n## work/skills/skill_prereqs.json\n' + json.dumps(pre, ensure_ascii=False), cache=True)]
    jobs = []
    for doc, its in by_doc(items, lambda x: x['doc']).items():
        if docs and doc not in docs: continue
        for k, ch in enumerate(chunks(its, CHUNK['tag']), 1):
            f = P + f'tag/out_{batch}_{doc}_{k}.json'
            if os.path.exists(f) and not args.redo: continue
            ids = {x['part_id'] for x in ch}

            def check(out, ids=ids):
                if not isinstance(out, list): return ['output must be a JSON list, one object per part']
                e = [f'missing part_id {p}' for p in ids - {x.get('part_id') for x in out}]
                for x in out:
                    e += [f'part {x.get("part_id")}: unknown dot point {d.get("id")}' for d in x.get('dot_points') or [] if d.get('id') not in dp_ids]
                    e += [f'part {x.get("part_id")}: unknown skill {s!r} (use exact names)' for s in (x.get('required_skills') or []) + (x.get('can_use_skills') or []) if s not in names]
                    if x.get('dot_points') and sum(d.get('role') == 'primary' for d in x['dot_points']) != 1: e.append(f'part {x.get("part_id")}: exactly one primary dot point')
                return e

            def write(out, errs, f=f, ids=ids):
                good = [x for x in out if isinstance(x, dict) and x.get('part_id') in ids]
                for x in good:   # names the tagger could not get right after 3 tries are dropped, not stored
                    x['dot_points'] = [d for d in x.get('dot_points') or [] if d.get('id') in dp_ids]
                    x['required_skills'] = [s for s in x.get('required_skills') or [] if s in names]
                    x['can_use_skills'] = [s for s in x.get('can_use_skills') or [] if s in names]
                    if errs: x['note'] = ((x.get('note') or '') + ' [API submit check unresolved]').strip()
                json.dump(good, open(f, 'w'), ensure_ascii=False, indent=1)
            task = ('Tag every part below by the spec (tag-v2.2). Parts without marks whose sub-parts carry the marks are lead-ins: no tags. '
                    'Submit a JSON list, one object per part_id, with submit_tags.\n\n' + json.dumps(ch, ensure_ascii=False))
            jobs.append(Run(batch, 'tag', doc, k, system, [text_block(task)], [json_submit('submit_tags', 'Submit the list of part tag objects', check, write)], 'submit_tags'))
    return jobs


def run_solfmt(api, batch, docs):
    c = db(); items = []
    for f in sorted(glob.glob(P + f'work/{batch}/solfmt_in_*.json')): items += json.load(open(f))
    system = [text_block(spec('SOLUTION_SPEC.md') + API_NOTE, cache=True)]
    jobs = []
    for doc, its in by_doc(items, lambda x: doc_of_question(c, x['question_id'])).items():
        if docs and doc not in docs: continue
        for k, ch in enumerate(chunks(its, CHUNK['solfmt']), 1):
            f = P + f'work/solfmt_{batch}_{doc}_{k}.json'
            if os.path.exists(f) and not args.redo: continue
            ids = {x['id'] for x in ch}
            for x in ch: base, k0 = next_sketch_k(c, x['question_id']); x['sketch_id'] = f'{base}_s{k0}'
            qof = {x['id']: (x['question_id'], x['sketch_id']) for x in ch}

            def check(out, ids=ids, qof=qof):
                if not isinstance(out, dict) or not isinstance(out.get('results'), list): return ['output must be {"results": [...]}']
                e = [f'missing solution id {i}' for i in ids - {r.get('id') for r in out['results']}]
                for r in out['results']:   # 17 Nov (Batch 8): a formatter invented the key "2023kings_q15_s1"
                    e += [f'solution {r.get("id")}: \\exfigure{{{k}}} is not an existing figure or this solution\'s sketch_id {qof[r["id"]][1]}'
                          for k in re.findall(r'\\exfigure\{([^}]+)\}', r.get('latex') or '') if r.get('id') in qof
                          and k != qof[r['id']][1] and not os.path.exists(P + f'figures/{k}.png')]
                return e + latex_errs(out)

            def write(out, errs, f=f, ids=ids, qof=qof, doc=doc):
                out['results'] = [r for r in out['results'] if r.get('id') in ids and r.get('latex')]
                json.dump(out, open(f, 'w'), ensure_ascii=False, indent=1)
                queue_sketches(batch, doc, [(qof[r['id']][1], qof[r['id']][0], (r.get('format_note') or '') + ' Solution: ' + r['latex'][:1500])
                                            for r in out['results'] if f'\\exfigure{{{qof[r["id"]][1]}}}' in r['latex']])
            task = ('Format every solution below to the house style (formatting only: never change the mathematics). Each item has the question for '
                    'context, the solution latex, its criteria rows and meta. Return one result per solution id, in the spec\'s "Output per solution" '
                    'shape, as {"results": [...]} with submit_solutions. Keep "meta" keys you are given. content_flags is ONLY for a possible error that is '
                    'still in the solution you return; a slip in the source that you fixed, or a note that the source is consistent, goes in '
                    'format_note (Batch 8: 8 such notes in content_flags reached the owner\'s Decide queue). A solution that needs a drawing it does not have '
                    '(SOLUTION_SPEC "Draw it") puts \\exfigure{<its sketch_id>} where the drawing goes and describes it in format_note, starting '
                    '"Sketch still to draw:", with every feature and coordinate; another step draws it.\n\n' + json.dumps(ch, ensure_ascii=False))
            jobs.append(Run(batch, 'solfmt', doc, k, system, [text_block(task)], [json_submit('submit_solutions', 'Submit {"results": [...]}', check, write)], 'submit_solutions'))
    return jobs


GEN_TASK = """Write the missing worked solutions for the questions below (SOLUTION_SPEC: "Every question has a solution", MCQs need working,
top-down criteria, drawn sketches). Each item lists the question's parts with `leaf` and `has_solution`: write a solution for every LEAF part
with has_solution false (part_id set), and for an MCQ with no working write one solution for the question (part_id null). If an MCQ has no
keyed option, give the key in mcq_keys.

Output {{"solutions": [{{"question_id", "part_id" | null, "latex", "criteria": [[marks, "text"], ...], "meta": {{"confidence": 0-1,
"self_check": "how you checked the answer", "generated_note": "..." }}}}], "mcq_keys": {{"<question_id>": "B"}},
"sketches": [{{"id", "question_id", "describe": "what to draw: axes, curve, every labelled feature with coordinates"}}]}}.
A solution that needs a drawing puts \\exfigure{{<id>}} at its place and lists the drawing in "sketches"; another step draws it in
house style from your description (exact coordinates and labels). Sketch ids for a question are <doc>_q<number>_s<k>, starting at
the k given for that question. Check every answer independently (you may use the python tool) before you submit.
Figure crops of the questions are attached where they exist.

{items}"""


def run_python(a):
    r = subprocess.run([sys.executable, '-I', '-c', a['code']], capture_output=True, text=True, timeout=90, cwd=str(paths.scratch('api_import')))
    return ((r.stdout or '') + ('\nSTDERR: ' + r.stderr[-1500:] if r.returncode else ''))[-6000:] or '(no output: print what you need)', False


PY_TOOL = ({'name': 'python', 'description': 'Run a Python 3 snippet (sympy, numpy, scipy available) and see stdout. No files, no network.',
            'input_schema': {'type': 'object', 'properties': {'code': {'type': 'string'}}, 'required': ['code']}}, run_python)


def next_sketch_k(c, qid):
    r = c.execute('select q.document_id, q.number from questions q where q.id=?', (qid,)).fetchone()
    ks = [int(m.group(1)) for (p,) in c.execute('select png_path from figures where question_id=?', (qid,)) for m in [re.search(r'_s(\d+)\.png$', p or '')] if m]
    return f'{r[0]}_q{r[1]}', (max(ks) + 1 if ks else 1)


def queue_sketches(batch, doc, sk):
    """Solution sketches with no crop, (id, question_id, description): drawn by the diagrams step (tikz/group_<b>_gen_<doc>.json)."""
    if not sk: return
    g = P + f'tikz/group_{batch}_gen_{doc}.json'
    old = json.load(open(g)) if os.path.exists(g) else []
    old = [x for x in old if x['id'] not in {k for k, _, _ in sk}]
    json.dump(old + [{'id': k, 'context': d, 'caption': 'solution sketch (drawn from the worked solution)', 'kind': 'new_sketch', 'doc': doc,
                      'question_id': q} for k, q, d in sk], open(g, 'w'), ensure_ascii=False, indent=1)


def run_gen(api, batch, docs):
    c = db(); items = []
    for f in sorted(glob.glob(P + f'work/{batch}/gen_in_*.json')): items += json.load(open(f))
    system = [text_block(spec('SOLUTION_SPEC.md') + API_NOTE, cache=True)]
    jobs = []
    for doc, its in by_doc(items, lambda x: x['doc']).items():
        if docs and doc not in docs: continue
        for k, ch in enumerate(chunks(its, CHUNK['gen']), 1):
            f = P + f'work/{batch}/gen_out_{doc}_{k}.json'
            if os.path.exists(f) and not args.redo: continue
            for it in ch: base, s = next_sketch_k(c, it['question_id']); it['sketch_ids_start'] = f'{base}_s{s}'
            need = {(it['question_id'], p['part_id']) for it in ch for p in it['parts'] if p['leaf'] and not p['has_solution']}
            mcq = {it['question_id'] for it in ch if it['type'] == 'mcq'}
            content = [text_block(GEN_TASK.format(items=json.dumps(ch, ensure_ascii=False)))]
            for it in ch:
                for fp in it.get('figures') or []:
                    if os.path.exists(P + fp): content += [text_block(f'Figure {os.path.basename(fp)[:-4]} (question {it["question_id"]}):'), image_block(P + fp)]

            def check(out, need=need, mcq=mcq, ch=ch):
                if not isinstance(out, dict) or not isinstance(out.get('solutions'), list): return ['output must be {"solutions": [...], "mcq_keys": {}, "sketches": []}']
                got = {(s.get('question_id'), s.get('part_id')) for s in out['solutions']}
                e = [f'no solution for question {q} part {p}' for q, p in need if (q, p) not in got and (q, None) not in got]
                e += [f'no solution for MCQ {q}' for q in mcq if not any(g[0] == q for g in got)]
                sk = {s.get('id') for s in out.get('sketches') or []}
                e += [f'\\exfigure{{{x}}} has no entry in sketches' for x in re.findall(r'\\exfigure\{([^}]+)\}', json.dumps(out['solutions'])) if x not in sk and not os.path.exists(P + f'figures/{x}.png')]
                return e + latex_errs(out['solutions'])

            def write(out, errs, f=f, doc=doc):
                out['model'] = MODEL['gen']
                for s in out['solutions']: s.setdefault('model', MODEL['gen'])
                sk = out.pop('sketches', None) or []
                json.dump(out, open(f, 'w'), ensure_ascii=False, indent=1)
                queue_sketches(batch, doc, [(s['id'], s.get('question_id'), s.get('describe', '')) for s in sk])
            jobs.append(Run(batch, 'gen', doc, k, system, content, [PY_TOOL, json_submit('submit_generated', 'Submit {"solutions", "mcq_keys", "sketches"}', check, write)], 'submit_generated'))
    return jobs


# ---------------------------------------------------------------- diagrams
def render_tex(k, tex):
    """Write state/tikz/tex/<k>.tex and build it like tools/tikz_render.sh (which needs an original crop for its side-by-side)."""
    open(S + f'tikz/tex/{k}.tex', 'w').write(tex)
    if os.path.exists(P + f'figures/{k}.png'):
        r = subprocess.run(['bash', P + 'tools/tikz_render.sh', k], capture_output=True, text=True, timeout=300)
        return r.returncode == 0, (r.stdout + r.stderr)[-1500:]
    T = P + 'tikz/'
    for d in ('build', 'svg', 'png', 'cmp'): os.makedirs(T + d, exist_ok=True)
    for st in ('examstyle', 'tree_style'):
        if not os.path.exists(T + f'{st}.tex'): os.symlink(S + f'tikz/{st}.tex', T + f'{st}.tex')
    open(T + f'build/{k}.tex', 'w').write(tex)
    r = subprocess.run(['pdflatex', '-interaction=nonstopmode', '-halt-on-error', f'{k}.tex'], cwd=T + 'build', capture_output=True, text=True, timeout=300,
                       env={**os.environ, 'extra_mem_bot': '30000000'})
    if r.returncode:
        log = open(T + f'build/{k}.log', errors='replace').read()
        return False, '\n'.join(re.findall(r'^!.*(?:\n.*){0,3}', log, re.M)[:5])[-1500:]
    subprocess.run(['pdftocairo', '-svg', f'{k}.pdf', f'../svg/{k}.svg'], cwd=T + 'build', check=True)
    subprocess.run([sys.executable, P + 'tools/svg_compact.py', T + f'svg/{k}.svg'], check=True)
    subprocess.run(['pdftoppm', '-png', '-r', '200', '-singlefile', f'{k}.pdf', f'../png/{k}'], cwd=T + 'build', check=True)
    return True, 'ok'


def diagram_tools(items):
    known = {x['id']: x for x in items}

    def view(a):
        k = a['id']
        if not os.path.exists(P + f'figures/{k}.png'): return f'{k} has no original crop (draw it from its description)', False
        return [text_block(f'original crop figures/{k}.png (200 dpi)'), image_block(P + f'figures/{k}.png')], False

    def draw(a):
        k = a['id']
        if k not in known: return f'{k} is not one of this group\'s figures', False
        ok, msg = render_tex(k, a['tex'])
        if not ok: return 'compile failed:\n' + msg, False
        out = [text_block(f'compiled {k}')]
        if os.path.exists(P + f'figures/{k}.png'):
            import overlay as OV
            os.makedirs(P + 'tikz/overlay', exist_ok=True)
            try:
                sc = OV.overlay(k); out.append(text_block(f'overlay scores: original ink covered {sc[0]}, redraw ink covered {sc[1]} (1.0 = perfect); '
                                                          f'side by side (ORIGINAL left, REDRAWN right) and the overlay (red only original, blue only redraw, black both) follow'))
                out += [image_block(P + f'tikz/cmp/{k}.png'), image_block(P + f'tikz/overlay/{k}.png')]
                known[k]['_overlay'] = [sc[0], sc[1]]
            except Exception as e: out += [text_block(f'overlay failed: {e}'), image_block(P + f'tikz/png/{k}.png')]
        else: out.append(image_block(P + f'tikz/png/{k}.png'))
        return out, False

    def check(out):
        if not isinstance(out, dict) or not isinstance(out.get('results'), list): return ['output must be {"results": [...]}']
        e = [f'no result for {k}' for k in set(known) - {r.get('id') for r in out['results']}]
        for r in out['results']:
            if r.get('status') in ('ok', 'approx') and not os.path.exists(S + f'tikz/tex/{r.get("id")}.tex'): e.append(f'{r.get("id")}: status {r["status"]} but no compiled tex (draw it first)')
            if r.get('status') == 'table' and not (r.get('table') or {}).get('rows'): e.append(f'{r.get("id")}: status table needs table.rows')
            # checker 18 Nov (2023 Knox AT1 Q4c): "Make the slash between the N and r longer touching both corners": a corner cell split by a
            #   diagonal is \diag{row label}{column label} (PARSE_SPEC), never "N \backslash r", which prints a short slash between the letters
            for row in ((r.get('table') or {}).get('rows') or [])[:3]:
                for v in row:
                    if '\\backslash' in str(v) and str(v).strip() != '\\backslash':
                        e.append(f'{r.get("id")}: corner cell {v!r}: write a split corner cell as \\diag{{row label}}{{column label}}')
        return e
    tools = [({'name': 'view_crop', 'description': 'Show an original crop.', 'input_schema': {'type': 'object', 'properties': {'id': {'type': 'string'}}, 'required': ['id']}}, view),
             ({'name': 'draw', 'description': 'Write tikz/tex/<id>.tex (the whole file, from the spec\'s template) and compile it. Returns the redraw, '
               'the side-by-side with the original and the overlay with its two scores, or the LaTeX error.',
               'input_schema': {'type': 'object', 'properties': {'id': {'type': 'string'}, 'tex': {'type': 'string'}}, 'required': ['id', 'tex']}}, draw)]
    return tools, known, check


DIAG_TASK = """Redraw every figure below in house style (the spec). Each has id, context (question or solution text, for understanding only),
caption and kind (question | option | solution | new_sketch). A new_sketch has no original crop: draw it from its context (the worked
solution's description) to the spec's rules for solution sketches. At most 2 drawing rounds per figure (owner 12 Nov). A figure that is
really a table: status "table" with table {{caption, rows, header_rows, label_col, spans}} (no TikZ); a corner cell split by a
diagonal is \\diag{{row label}}{{column label}}, with a rowspan if it spans two header rows. A photo or anything that cannot be
redrawn: status "keep_crop".
Submit {{"results": [{{"id", "class" (graph | geometry | statistical | blank_axes | tree | table | photo | other), "status" (ok | approx |
table | keep_crop), "rounds", "notes" (what you drew, what differs from the crop and why, rules used), "table": null | {{...}}}}]}} with
submit_diagrams.

{items}"""


def run_diagrams(api, batch, docs):
    items = []
    for f in sorted(glob.glob(P + f'tikz/group_{batch}_*.json')): items += json.load(open(f))
    style = open(S + 'tikz/examstyle.tex').read(); tree = open(S + 'tikz/tree_style.tex').read()
    system = [text_block(spec('DIAGRAM_SPEC.md') + API_NOTE + '\n## tikz/examstyle.tex (house style, \\input by every file)\n' + style
                         + '\n## tikz/tree_style.tex (\\input{../tree_style.tex} for tree diagrams)\n' + tree, cache=True)]
    jobs = []
    seen = set()
    for doc, its in by_doc([x for x in items if not (x['id'] in seen or seen.add(x['id']))], lambda x: x['doc']).items():
        if docs and doc not in docs: continue
        for k, ch in enumerate(chunks(its, CHUNK['diagrams']), 1):
            f = P + f'tikz/result_{batch}_{doc}_{k}.json'
            if os.path.exists(f) and not args.redo: continue
            tools, known, check = diagram_tools(ch)
            content = [text_block(DIAG_TASK.format(items=json.dumps(ch, ensure_ascii=False)))]
            for it in ch:
                if os.path.exists(P + f'figures/{it["id"]}.png'): content += [text_block(f'original crop {it["id"]}:'), image_block(P + f'figures/{it["id"]}.png')]

            def write(out, errs, f=f, known=known):
                for r in out['results']:
                    r.setdefault('overlay', (known.get(r.get('id')) or {}).get('_overlay'))
                    if errs: r['notes'] = ((r.get('notes') or '') + ' [API submit check unresolved]').strip()
                out['results'] = [r for r in out['results'] if r.get('id') in known]
                json.dump(out, open(f, 'w'), ensure_ascii=False, indent=1)
            jobs.append(Run(batch, 'diagrams', doc, k, system, content, tools + [json_submit('submit_diagrams', 'Submit {"results": [...]}', check, write)], 'submit_diagrams'))
    return jobs


# ---------------------------------------------------------------- verify
def run_verify(api, batch, docs):
    c = db(); items = []
    for f in sorted(glob.glob(P + f'work/{batch}/verify_in_*.json')): items += json.load(open(f))
    system = [text_block(spec('VERIFY_SPEC.md') + API_NOTE, cache=True)]
    jobs = []
    os.makedirs(S + f'work/{batch}', exist_ok=True)
    for doc, its in by_doc(items, lambda x: doc_of_question(c, x['question_id'])).items():
        if docs and doc not in docs: continue
        for k, ch in enumerate(chunks(its, CHUNK['verify']), 1):
            f = S + f'work/{batch}/verify_out_{doc}_{k}.json'
            if os.path.exists(f) and not args.redo: continue
            ids = {x['question_id'] for x in ch}
            for x in ch: x.pop('pdf', None)
            pages = sorted({p for x in ch for p in range(x['pages'][0] or 0, (x['pages'][1] or x['pages'][0] or 0) + 1)})
            content = [pdf_block(doc, f'paper {doc}'), text_block(
                f'The paper is attached as a PDF (pages are 0-based in the input: page 0 is the first page; this chunk uses pages {pages}). '
                'Check every question below by the spec and submit {"group": "%s_%s_%d", "results": [...]} with submit_verify, one result per question_id. '
                'Use the python tool for the answer checks.\n\n' % (batch, doc, k) + json.dumps(ch, ensure_ascii=False))]
            content[0]['cache_control'] = {'type': 'ephemeral'}
            for it in ch:
                # Batch 10 (18 Nov): the verifier was shown the school's crop of a solution sketch, so it reported 4 sketches as wrong that the
                #   diagram step had already redrawn correctly. The bank shows the redraw: check that one when it exists
                for fp in it.get('figures') or []:
                    k = os.path.basename(fp)[:-4]; rd = P + f'tikz/png/{k}.png'
                    if os.path.exists(rd): content += [text_block(f'figure {k} (question {it["question_id"]}), as redrawn for the bank:'), image_block(rd)]
                    elif os.path.exists(P + fp): content += [text_block(f'figure {k} (question {it["question_id"]}):'), image_block(P + fp)]

            def check(out, ids=ids):
                if not isinstance(out, dict) or not isinstance(out.get('results'), list): return ['output must be {"group", "results": [...]}']
                return [f'no result for question {q}' for q in ids - {r.get('question_id') for r in out['results']}]

            def write(out, errs, f=f, ids=ids):
                out['results'] = [r for r in out['results'] if r.get('question_id') in ids]; out['model'] = MODEL['verify']
                json.dump(out, open(f, 'w'), ensure_ascii=False, indent=1)
            jobs.append(Run(batch, 'verify', doc, k, system, content, [PY_TOOL, json_submit('submit_verify', 'Submit {"group", "results"}', check, write)], 'submit_verify'))
    return jobs



# ---------------------------------------------------------------- difficulty (DIFFICULTY_SPEC, diff-v1)
# Every leaf part gets a band 2-6 and UF/PR, compared with the HSC reference parts (part_difficulty.is_anchor = 1; the owner reviewed
# them 14 Nov). The model sees each reference's ORIGINAL rating (band_ai / wm_ai), as the 13 Nov rating did, so the owner's
# corrections then reach the new parts through tools/apply_difficulty_reviews.py (a part rated against a corrected reference moves
# with it) and are never applied twice. New parts are never references: the reference set stays the one he reviewed.
DIFF_OUT = S + 'work/difficulty/'


def area_of(c, pid):
    t = c.execute("select focus_area, year_level from tags where part_id=? and scheme='2024' and is_primary=1 and focus_area is not null", (pid,)).fetchone()
    return f"Y{t[1]}_{t[0].replace(' ', '_').replace(',', '')}" if t else 'Unhomed'


def unrated_leaves(c, docs):
    """Leaf parts with no part_difficulty row, of questions the Bank shows (bank.json), optionally only these papers."""
    bank = {q['id'] for q in json.load(open(P + 'site/data/bank.json'))['questions']}
    rows = c.execute("""select p.id pid, p.label, p.marks, p.latex, p.parent_part_id, q.id qid, q.document_id doc, q.number, q.stem_latex, q.question_type
        from parts p join questions q on q.id=p.question_id
        where p.id not in (select parent_part_id from parts where parent_part_id is not null)
          and p.id not in (select part_id from part_difficulty) order by q.document_id, q.id, p.ordinal, p.id""").fetchall()
    return [r for r in rows if r['qid'] in bank and (not docs or r['doc'] in docs)]


def run_difficulty(api, batch, docs):
    c = db()
    lab = {r['id']: r['display_label'] for r in c.execute('select id, display_label from documents')}
    anchors = []
    for r in c.execute("""select d.part_id, d.area, d.band_ai, d.wm_ai, p.marks, p.latex, q.stem_latex from part_difficulty d
                          join parts p on p.id=d.part_id join questions q on q.id=d.question_id where d.is_anchor=1 order by d.area, d.part_id"""):
        anchors.append({'part_id': r['part_id'], 'area': r['area'], 'marks': r['marks'], 'band': r['band_ai'], 'wm': r['wm_ai'],
                        'text': ((r['stem_latex'] or '') + ' ' + r['latex'])[:350]})
    ids = {a['part_id'] for a in anchors}
    system = [text_block(spec('DIFFICULTY_SPEC.md') + API_NOTE + '\n## The HSC reference parts (anchors), with their ratings\n'
                         + json.dumps(anchors, ensure_ascii=False), cache=True)]
    items = unrated_leaves(c, docs)
    jobs = []
    os.makedirs(DIFF_OUT + batch, exist_ok=True)
    for doc, its in by_doc(items, lambda r: r['doc']).items():
        for k, ch in enumerate(chunks(its, CHUNK['difficulty']), 1):
            f = DIFF_OUT + f'{batch}/{doc}_{k}.json'
            if os.path.exists(f) and not args.redo: continue
            want = {r['pid'] for r in ch}
            data = []
            for r in ch:
                chain, par = [], r['parent_part_id']
                while par:
                    x = c.execute('select label, latex, parent_part_id from parts where id=?', (par,)).fetchone(); chain.insert(0, x['latex']); par = x['parent_part_id']
                sol = ' '.join(x[0] for x in c.execute('select latex from solutions where part_id=? or (part_id is null and question_id=?)', (r['pid'], r['qid'])))
                data.append({'part_id': r['pid'], 'paper': lab.get(r['doc']), 'question': r['number'], 'label': r['label'], 'marks': r['marks'],
                             'type': r['question_type'], 'area': area_of(c, r['pid']), 'context': ' '.join(x for x in [r['stem_latex'] or ''] + chain if x)[:1500],
                             'text': r['latex'][:1500], 'solution': sol[:1500]})

            def check(out, want=want):
                if not isinstance(out, list): return ['output must be a JSON list, one object per part_id']
                e = [f'missing part_id {p}' for p in want - {x.get('part_id') for x in out}]
                for x in out:
                    if x.get('band') not in (2, 3, 4, 5, 6): e.append(f'part {x.get("part_id")}: band must be an integer 2-6')
                    if x.get('wm') not in ('UF', 'PR'): e.append(f'part {x.get("part_id")}: wm must be UF or PR')
                    if x.get('nearest_anchor') not in ids: e.append(f'part {x.get("part_id")}: nearest_anchor must be one of the reference part_ids')
                    if x.get('confidence') not in ('high', 'medium', 'low'): e.append(f'part {x.get("part_id")}: confidence high, medium or low')
                return e

            def write(out, errs, f=f, want=want):
                json.dump([x for x in out if isinstance(x, dict) and x.get('part_id') in want and x.get('band') in (2, 3, 4, 5, 6)
                           and x.get('wm') in ('UF', 'PR') and x.get('nearest_anchor') in ids], open(f, 'w'), ensure_ascii=False, indent=1)
            task = ('Rate every part below by the spec: band (2-6), wm (UF or PR), nearest_anchor (the part_id of the reference part it is '
                    'closest to in difficulty, from the list in the system prompt), confidence, reason (at most 15 words). These are not '
                    'HSC references themselves. Submit a JSON list, one object per part_id, with submit_difficulty.\n\n' + json.dumps(data, ensure_ascii=False))
            jobs.append(Run(batch, 'difficulty', doc, k, system, [text_block(task)],
                            [json_submit('submit_difficulty', 'Submit the list of part ratings', check, write)], 'submit_difficulty'))
    return jobs


def difficulty_apply(batch):
    """Write state/work/difficulty/<batch>/*.json into part_difficulty (only parts that have no row yet). Then run
    tools/apply_difficulty_reviews.py on an export of the page's `difficulty` collection, so the owner's reference corrections reach them."""
    c = db(); n = 0
    today = datetime.datetime.now().strftime('%Y-%m-%d')
    for f in sorted(glob.glob(DIFF_OUT + f'{batch}/*.json')):
        for x in json.load(open(f)):
            q = c.execute('select question_id from parts where id=?', (x['part_id'],)).fetchone()
            if not q or c.execute('select 1 from part_difficulty where part_id=?', (x['part_id'],)).fetchone(): continue
            c.execute("""insert into part_difficulty(part_id, question_id, band, wm, is_anchor, nearest_anchor, confidence, reason, area, prompt_version,
                         rated_at, band_ai, wm_ai, source) values (?,?,?,?,0,?,?,?,?,?,?,?,?,'model')""",
                      (x['part_id'], q[0], x['band'], x['wm'], x['nearest_anchor'], x.get('confidence'), (x.get('reason') or '')[:200],
                       area_of(c, x['part_id']), 'diff-v1-api', today, x['band'], x['wm']))
            n += 1
    c.commit(); print(f'difficulty-apply {batch}: {n} parts rated; next: tools/apply_difficulty_reviews.py <difficulty export>')

# ---------------------------------------------------------------- cost report
def cost(batch):
    rows = [json.loads(l) for l in open(S + f'work/api_import/{batch}/calls.jsonl')]
    c = db(); lab = {r['id']: r['display_label'] or str(r['id']) for r in c.execute('select id, display_label from documents')}
    agg = lambda key: {k: {'calls': len(v), 'usd': round(sum(r['usd'] for r in v), 2),
                           **{t: sum(r[t] for r in v) for t in ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens')}}
                       for k, v in by_doc(rows, key).items()}
    steps, papers, models = agg(lambda r: r['step']), agg(lambda r: r['doc']), agg(lambda r: r['model'])
    grid = {}
    for r in rows: grid.setdefault(r['doc'], {}).setdefault(r['step'], 0.0); grid[r['doc']][r['step']] += r['usd']
    total = round(sum(r['usd'] for r in rows), 2)
    rep = {'batch': batch, 'made': now(), 'calls': len(rows), 'usd': total, 'papers': len(papers), 'usd_per_paper': round(total / max(len(papers), 1), 2),
           'by_step': steps, 'by_paper': {str(k): {'label': lab.get(k), **v, 'by_step': {s: round(x, 2) for s, x in grid[k].items()}} for k, v in papers.items()},
           'by_model': models, 'prices_per_mtok': PRICE}
    json.dump(rep, open(S + f'work/api_import/{batch}/cost.json', 'w'), indent=1)
    order = ['parse', 'split', 'tag', 'solfmt', 'gen', 'diagrams', 'verify', 'difficulty']
    print(f'{"paper":44s}' + ''.join(f'{s:>9s}' for s in order) + f'{"total":>9s}')
    for k in papers:
        print(f'{lab.get(k, str(k))[:43]:44s}' + ''.join(f'{grid[k].get(s, 0):9.2f}' for s in order) + f'{papers[k]["usd"]:9.2f}')
    print(f'{"all papers":44s}' + ''.join(f'{steps.get(s, {}).get("usd", 0):9.2f}' for s in order) + f'{total:9.2f}')
    print(f'US$ per paper: {rep["usd_per_paper"]} over {len(papers)} papers, {len(rows)} calls')
    # what the money went on (caching fix, 18 Nov): output, cache writes (1.25x input), cache reads (0.1x), plain input
    kind = {'output': 0.0, 'cache writes': 0.0, 'cache reads': 0.0, 'input': 0.0}
    for r in rows:
        pin, pout, pcr = PRICE.get(r['model'], PRICE['claude-opus-5-5'])
        kind['output'] += r['output_tokens'] * pout / 1e6; kind['cache writes'] += r['cache_creation_input_tokens'] * pin * 1.25 / 1e6
        kind['cache reads'] += r['cache_read_input_tokens'] * pcr / 1e6; kind['input'] += r['input_tokens'] * pin / 1e6
    rep['by_kind'] = {k: round(v, 2) for k, v in kind.items()}
    json.dump(rep, open(S + f'work/api_import/{batch}/cost.json', 'w'), indent=1)
    print('by kind: ' + ', '.join(f'{k} US${v:.2f}' for k, v in kind.items()))
    import subprocess; subprocess.run([sys.executable, P + 'tools/costs.py'])   # 21 Nov: Processes › Papers › Costs follows every batch
    return rep


# ---------------------------------------------------------------- main
def main():
    global args
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('step'); ap.add_argument('batch'); ap.add_argument('ids', nargs='*', type=int)
    ap.add_argument('--docs', default=''); ap.add_argument('--workers', type=int, default=4); ap.add_argument('--redo', action='store_true')
    args = ap.parse_args()
    if args.step == 'cost': cost(args.batch); return
    if args.step == 'difficulty-apply': difficulty_apply(args.batch); return
    docs = [int(x) for x in args.docs.split(',') if x] or args.ids
    api = client()
    split_files = None
    if args.step == 'parse': jobs = run_parse(api, args.batch, docs)
    elif args.step == 'split': jobs, split_files = run_split(api, args.batch, docs)
    else: jobs = {'tag': run_tag, 'solfmt': run_solfmt, 'gen': run_gen, 'diagrams': run_diagrams, 'verify': run_verify,
                 'difficulty': run_difficulty}[args.step](api, args.batch, docs)
    print(f'{args.step}: {len(jobs)} runs ({MODEL[args.step]}, effort {EFFORT[args.step]})', flush=True)

    def one(j):
        t = time.time()
        try: j.go(api); print(f'  {j.step} {j.doc}/{j.chunk}: {"done" if j.done else "NOT DONE"} in {j.turns} turns, {time.time() - t:.0f}s, US${j.cost:.2f}', flush=True)
        except Exception as e: print(f'  {j.step} {j.doc}/{j.chunk}: FAILED {type(e).__name__}: {e}', flush=True); traceback.print_exc()
        j.primed.set()   # a failed first run must not hold the others back
        return j
    # caching fix (18 Nov): all runs of a step used to start together, so each wrote the same shared instructions to the cache and none
    # read them. The first run goes alone until its first reply is back; the rest then read the instructions from the cache (0.1x price)
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = []
        if jobs:
            futs.append(ex.submit(one, jobs[0])); jobs[0].primed.wait(timeout=900)
        futs += [ex.submit(one, j) for j in jobs[1:]]
        done = [f.result() for f in futs]
    if split_files is not None: merge_split(args.batch, split_files)
    print(f'{args.step}: {sum(j.done for j in done)} of {len(done)} runs done, US${sum(j.cost for j in done):.2f}')
    if not all(j.done for j in done): sys.exit(1)


if __name__ == '__main__':
    main()
