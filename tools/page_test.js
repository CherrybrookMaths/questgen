#!/usr/bin/env node
/* Pre-publish page test (hardening action 1, owner 14 Nov: "no more importing for a while until we iron these out").

   Tests the BUILT page, site/review.html, in headless Chromium (Playwright), fully offline:
   - serves site/ itself on a free localhost port, wrapping review.html in the doctype/head/body skeleton the artifact
     publish adds (the file has none of its own);
   - aborts every request that leaves localhost and reports it (the page must not use public CDNs since action 3; a Google
     Fonts request is tolerated and may simply fail, only because the Download HTML file links it on purpose);
   - fakes the runtime capabilities the page asks for with window.claude.use(name):
       db        in-memory: collection(n).onSnapshot, doc(k).set/get/delete/onSnapshot; seeded from work/page_test/fixture.json
                 (tools/page_test_fixture.py, a copy of the real page database mirrored in questions.db), every write logged
       user      id() and profiles()
       downloads save({filename,data}): filename, size and the bytes are captured and checked here
       mcp       (13 Nov, Rescan drive) only when a page is given a fake Drive tree: callTool('Google Drive', 'search_files',
                 {query: "parentId = '<id>' ...", pageToken}) answers from the fixture's folders, 2 items a page; every call is
                 logged in window.__pt.mcp; window.__pt.driveDelay (ms) slows it, window.__pt.driveErr {n, err} rejects n calls
                 with err. Without a tree use('mcp') is null, as in a view with no connector.
   Every check is named and passes or fails; a failure saves a screenshot to work/page_test/shots/<check>.png.
   The result goes to work/page_test/last_result.json (with the sha256 of the page and data it tested), which
   tools/batch_check.py reads: a failed, missing or stale result BLOCKS the publish.

   Usage:  node tools/page_test.js            all checks (about 1 minute)
           node tools/page_test.js --quick    skip the PDF / Word exports and the dark-theme sweep
           node tools/page_test.js --headed   watch it run (needs a display)
           node tools/page_test.js --page F   test another build F (results in *_other; batch_check ignores them)
   Exit code 0 = every check passed, 1 = a check failed, 2 = the test itself could not run.
   Run it through tools/prepublish.sh (build, this test, batch_check). */
'use strict';
const {chromium} = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http'), zlib = require('zlib'), crypto = require('crypto'), cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const PAGE = process.argv.includes('--page') ? path.resolve(process.argv[process.argv.indexOf('--page') + 1]) : path.join(SITE, 'review.html');   // --page F: test another build of the page (served as review.html; the result is not used by batch_check)
const OUT = path.join(ROOT, 'work', 'page_test');

const FIXTURE = path.join(OUT, 'fixture.json');
const OTHER = PAGE !== path.join(SITE, 'review.html');
const RESULT = path.join(OUT, OTHER ? 'other_result.json' : 'last_result.json');
const SHOTS = path.join(OUT, OTHER ? 'shots_other' : 'shots');
const DL = path.join(OUT, OTHER ? 'downloads_other' : 'downloads');
// --only papersLanes,driveScan: run just those groups while you work (recorded as quick, so batch_check will not accept it)
const ONLY = process.argv.includes('--only') ? new Set(process.argv[process.argv.indexOf('--only') + 1].split(',')) : null;
const QUICK = process.argv.includes('--quick') || !!ONLY;
const HEADED = process.argv.includes('--headed');
const T0 = Date.now();

/* ---------------- helpers ---------------- */
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CTYPE = {'.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json',
  '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain'};

// read every entry of a zip (a .docx) with Node's zlib: no extra package needed
function unzip(buf) {
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip file (no end-of-central-directory record)');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const out = {};
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip central directory');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8');
    const lnl = buf.readUInt16LE(off + 26), lxl = buf.readUInt16LE(off + 28), data = buf.slice(off + 30 + lnl + lxl, off + 30 + lnl + lxl + csize);
    out[name] = method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : null;
    p += 46 + nl + xl + cl;
  }
  return out;
}

/* ---------------- the local server ---------------- */
function serve() {
  const skeleton = '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>\n' + fs.readFileSync(PAGE, 'utf8') + '\n</body></html>';
  const srv = http.createServer((req, res) => {
    let u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (u === '/' || u === '/review.html') { res.writeHead(200, {'Content-Type': CTYPE['.html'], 'Cache-Control': 'no-store'}); return res.end(skeleton); }
    // job 3: the asset store serves a pack at the url data/assets.json records (/_blob/<id>); here, the local file it was
    // uploaded from (tools/asset_manifest.py --check proves they are the same bytes)
    if (u.startsWith('/_blob/')) { const m = (JSON.parse(fs.readFileSync(path.join(SITE, 'data/assets.json'), 'utf8')).assets) || {};
      const hit = Object.entries(m).find(([, a]) => (a.url || a) === u);
      if (!hit) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, {'Content-Type': 'application/json'}); return fs.createReadStream(path.join(SITE, hit[0])).pipe(res); }
    const f = path.normalize(path.join(SITE, u));
    if (!f.startsWith(SITE + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {'Content-Type': CTYPE[path.extname(f)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*'});
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

/* ---------------- the fake runtime (runs in the page before its own scripts) ---------------- */
function fakeClaude(arg) {
  // role (15 Nov, Teach | Curate): 'editor' (default: owner + canEdit), 'viewer' (neither), 'none' (no user capability: use('user') → null)
  // 'checker' (17 Nov permissions: Editor share, not the owner): Curate with Review only, no Processes
  const seed = arg && arg.seed, role = (arg && arg.role) || 'editor', drive = arg && arg.drive;
  // deterministic Math.random, so a failing run can be repeated
  let a = 0x9e3779b9; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 };
  const store = new Map(Object.entries(seed || {})), log = [], cs = [], ds = [];
  const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
  const docSnap = k => ({id: k.split('/').pop(), exists: store.has(k), data: () => clone(store.get(k))});
  const collSnap = n => ({docs: [...store.keys()].filter(k => k.startsWith(n + '/') && k.split('/').length === 2).map(docSnap)});
  const notify = () => setTimeout(() => { cs.forEach(([n, cb]) => cb(collSnap(n))); ds.forEach(([k, cb]) => cb(docSnap(k))) }, 0);
  const sub = (list, item, first) => { list.push(item); setTimeout(first, 0); return () => { const i = list.indexOf(item); if (i >= 0) list.splice(i, 1) } };
  const db = {
    collection: n => ({onSnapshot: (cb, err) => sub(cs, [n, cb], () => cb(collSnap(n)))}),
    doc: k => ({
      set: async (v, o) => { const nv = o && o.merge ? {...(store.get(k) || {}), ...v} : v; store.set(k, clone(nv)); log.push({op: 'set', k, v: clone(nv)}); notify() },
      get: async () => docSnap(k),
      delete: async () => { store.delete(k); log.push({op: 'delete', k}); notify() },
      onSnapshot: (cb, err) => sub(ds, [k, cb], () => cb(docSnap(k)))
    })
  };
  const user = {isOwner: async () => role === 'editor', canEdit: async () => role === 'editor' || role === 'checker', id: async () => 'u_pagetest', profiles: async ids => Object.fromEntries(ids.map(i => [i, {name: i === 'u_pagetest' ? 'Page test' : 'Colleague'}]))};
  const downloads = {save: async ({filename, data}) => {
    let bytes;
    if (typeof data === 'string') bytes = new TextEncoder().encode(data);
    else bytes = new Uint8Array(await data.arrayBuffer());
    let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    await window.__ptSave(filename, btoa(s));
    window.__pt.downloads.push({filename, size: bytes.length});
  }};
  // the viewer's Google Drive connector, faked from a small folder tree (read-only: search_files is the only tool it knows)
  const mcp = drive ? {callTool: async (server, tool, input, opts) => {
    window.__pt.mcp.push({server, tool, input: clone(input)});
    const sig = opts && opts.signal;
    await new Promise((res, rej) => { if (sig && sig.aborted) return rej({code: 'cancelled', message: 'aborted'});   // as fetch does
      const t = setTimeout(res, window.__pt.driveDelay || 0); if (sig) sig.addEventListener('abort', () => { clearTimeout(t); rej({code: 'cancelled', message: 'aborted'}) }, {once: true}) });
    const e = window.__pt.driveErr; if (e && e.n > 0) { e.n--; throw {...e.err} }
    if (server !== 'Google Drive' || tool !== 'search_files') throw {code: 'not_in_manifest', message: 'not in the manifest'};
    const m = /parentId = '([^']+)'/.exec(input.query || ''), items = (m && drive.folders[m[1]]) || [];
    const from = +(input.pageToken || 0), per = Math.min(input.pageSize || 100, drive.per || 100), files = clone(items.slice(from, from + per));
    return {content: [{type: 'text', text: JSON.stringify({files})}], payload: {files, ...(from + per < items.length ? {nextPageToken: String(from + per)} : {})}};
  }} : null;
  window.__pt = {store, log, downloads: [], mcp: [], used: [], driveDelay: 0, driveErr: null};
  window.claude = {use: async n => { window.__pt.used.push(n); return n === 'db' ? db : n === 'user' ? (role === 'none' ? null : user) : n === 'downloads' ? downloads : n === 'mcp' ? mcp : null }};
}

/* ---------------- checks ---------------- */
const checks = [];
let outside = [];
// owner 19 Nov: Generate / Regenerate on a saved exam asks first ("Make a new exam instead" / "Replace them"); the existing checks replace
// owner 19 Nov ("lets go 5 controls"): Settings, Regenerate, Topic table and the downloads sit in the paper bar's Exam / Download menus
async function waitPv2(p) { await p.waitForTimeout(300); await p.waitForFunction(() => { const i = document.querySelector('#xInfo'); return i && !/Laying out/.test(i.textContent) }, null, {timeout: 30000}) }
async function pvClick(p, sel) { await p.evaluate(s => { const pop = document.querySelector(s)?.closest('.xmenu-pop'); if (pop && pop.hidden) pop.previousElementSibling.click() }, sel); await p.click(sel) }
async function genClick(p, sel) { await pvClick(p, sel); const a = await p.waitForSelector('#exAsk [data-ask="replace"]', {timeout: 1500}).catch(() => null); if (a) await a.click() }
async function check(name, page, fn) {
  const t = Date.now(); let ok = true, detail = '', shot = null;
  try { detail = (await fn()) || '' } catch (e) { ok = false; detail = String(e && e.message || e).split('\n')[0].slice(0, 600) }
  if (!ok && page) { shot = path.join(SHOTS, name.replace(/[^\w.@-]+/g, '_') + '.png'); try { await page.screenshot({path: shot}) } catch (e) { shot = null } }
  checks.push({name, ok, detail, ms: Date.now() - t, shot: shot && path.relative(ROOT, shot)});
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}  (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  return ok;
}
function assert(c, m) { if (!c) throw new Error(m) }

async function newPage(browser, base, seed, {width = 1280, theme = 'light', touch = false, role = 'editor', drive = null} = {}) {
  const ctx = await browser.newContext({viewport: {width, height: width > 800 ? 900 : 844}, colorScheme: theme, deviceScaleFactor: 1, reducedMotion: 'reduce', acceptDownloads: false, hasTouch: touch, isMobile: touch});
  const page = await ctx.newPage();
  page._errs = [];
  page.on('pageerror', e => page._errs.push('page error: ' + e.message));
  page.on('console', m => {
    const loc = (m.location() && m.location().url) || '';
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com/.test(loc + m.text())) page._errs.push('console error: ' + m.text().slice(0, 300));
    if (m.type() === 'warning' && /Word maths fallback/.test(m.text())) (page._warn = page._warn || []).push(m.text().slice(0, 200));
  });
  await page.route(u => !u.href.startsWith(base), r => { outside.push(r.request().url()); return r.abort() });
  await page.exposeFunction('__ptSave', (fn, b64) => { const f = path.join(DL, fn.replace(/[^\w.\- ]+/g, '_')); fs.writeFileSync(f, Buffer.from(b64, 'base64')); });
  await page.addInitScript(fakeClaude, {seed, role, drive});
  return page;
}
// wait until the page stops changing (text length, element count, typeset maths count)
async function settle(page, max = 8000, quiet = 3) {
  const t0 = Date.now(); let last = '', same = 0;
  while (Date.now() - t0 < max) {
    await sleep(200);
    const sig = await page.evaluate(() => document.body.innerText.length + ':' + document.getElementsByTagName('*').length + ':' + document.getElementsByTagName('mjx-container').length);
    if (sig === last) { if (++same >= quiet) return } else { same = 0; last = sig }
  }
}
// det: also wait for the question details (job 2, QG.det), as every view but the Bank does before it draws
async function boot(page, base, hash = '#bank', det = true) {
  await page.goto(base + 'review.html' + hash);
  await page.waitForFunction(() => typeof B !== 'undefined' && B && B.questions && typeof db !== 'undefined' && db && typeof EDITOR !== 'undefined' && EDITOR !== null && window.MathJax && MathJax.startup && MathJax.startup.promise, null, {timeout: 45000});
  await page.evaluate(() => MathJax.startup.promise);
  if (det) await page.waitForFunction(() => QG.detOK || QG.detFail, null, {timeout: 30000});
  await settle(page);
}
const takeErrs = page => page._errs.splice(0);

/* The views of the page and what each must show. mjx: typeset maths expected in the view. */
const VIEWS = [
  ['bank', '#bank', '#bankView', true, async p => {   // a subtopic with questions, so cards (and maths) are on screen
    await p.evaluate(() => { const b = [...document.querySelectorAll('#list .subrow[data-sel]:not(.none)')][0]; b && b.click() }); }],
  ['exams-setup', '#exams', '#examsView', false, async p => p.evaluate(() => EXAS.fresh())],   // owner 19 Nov: no tabs; New exam opens Setup
  ['exams-pick', '#exams', '#examsView', true, async p => p.evaluate(() => EXPK.open('add'))],   // owner 19 Nov: the picker opens from the preview
  ['exams-mine', '#exams', '#examsView', false, async p => p.evaluate(() => EXAS.go('mine'))],
  // owner 13 Nov: Review is an Inbox, a papers list, one paper at a time and the lists (Recently approved, Other lists)
  ['inbox', '#review', '#inboxView', false],
  ['review-paper', '#review/paper/323', '#reviewView', true],   // the fixture's workload: 2024 Caringbah AT4 has Flagged, Topics, Diagrams and Spot-check left
  ['review', '#review/list/all', '#reviewView', true],
  ['reports', '#review/reports', '#reportsView', false],   // owner 15 Nov: Reports is a step inside Review (13 Nov: an Inbox section)
  ['papers', '#review/papers', '#papersView', false],   // owner 13 Nov: "Merge into Review"
  ['processes', '#processes/work', '#processesView', false],   // owner 14 Nov: the Import tab is now Processes
  ['processes-papers', '#processes/papers', '#processesView', false],   // owner 13 Nov: "Two tabs: Work | Papers"
  ['levels', '#review/difficulty', '#levelsView', true, async p => {   // owner 15 Nov: Difficulty is a step inside Review   // nothing left to check: show All, so a part is on screen
    await p.evaluate(() => { if (!document.querySelector('#levelsBox .lvcard')) document.querySelector('[data-lvshow="all"]')?.click() }); }],
  ['guide-users', '#guide', '#guideView', true, async p => p.evaluate(() => document.querySelector('[data-gpg="cat"]').click())],
  ['guide-developers', '#guide', '#guideView', false, async p => p.evaluate(() => document.querySelector('[data-gpg="dev"]').click())],
];

async function sweep(browser, base, seed, width, theme) {
  const page = await newPage(browser, base, seed, {width, theme});
  await boot(page, base);
  const boot_errs = takeErrs(page);
  for (const [name, hash, box, mjx, sub] of VIEWS) {
    await check(`tab ${name} @${width} ${theme}`, page, async () => {
      await page.evaluate(h => { if (location.hash !== h) location.hash = h; else route() }, hash);
      await settle(page, 4000, 2);
      if (sub) { await sub(page); await settle(page, 6000, 3) }
      // Fix 1 (14 Nov): question text arrives per topic after the view draws; "Loading…" is static text, so settle() alone can
      // return while it shows. Wait for the loads to finish first (a load that never finishes fails the checks below).
      await page.waitForFunction(() => !document.querySelector('[data-qpend]') && !/Loading questions…/.test(document.body.innerText), null, {timeout: 20000}).catch(() => {});
      await settle(page, 4000, 2);
      // night runs 18 and 20 Nov: 'no typeset maths in #bankView' failed although the screenshot showed the maths: MathJax can start
      // after settle's quiet window. Wait for it (a view that never typesets still fails below)
      if (mjx) await page.waitForFunction(b => (document.querySelector(b)?.getElementsByTagName('mjx-container').length || 0) > 0, box, {timeout: 15000}).catch(() => {});
      await page.evaluate(() => window.scrollTo(0, 0));
      const r = await page.evaluate(([box]) => {
        const el = document.querySelector(box), de = document.documentElement;
        return {visible: !!el && !el.hidden && el.offsetWidth > 0 && el.offsetHeight > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden',
          text: el ? el.innerText.trim().length : 0, sw: de.scrollWidth, cw: de.clientWidth, bw: document.body.scrollWidth,
          mjx: el ? el.getElementsByTagName('mjx-container').length : 0,
          merr: el ? el.querySelectorAll('mjx-merror,[data-mjx-error]').length : 0,
          dark: getComputedStyle(document.body).backgroundColor};
      }, [box]);
      const errs = [...boot_errs.splice(0), ...takeErrs(page)];
      assert(!errs.length, errs.slice(0, 3).join(' | '));
      assert(r.visible, `${box} is not visible`);
      assert(r.text > 40, `${box} is (almost) empty: ${r.text} characters of text`);
      assert(r.sw <= r.cw + 1, `horizontal scroll: page is ${r.sw}px wide in a ${r.cw}px window`);
      if (mjx) assert(r.mjx > 0, `no typeset maths in ${box}`);
      assert(!r.merr, `${r.merr} MathJax error(s) in ${box}`);
      return `${r.text} chars, ${r.mjx} maths, bg ${r.dark}`;
    });
  }
  await page.context().close();
}

async function flows(browser, base, seed, seedR) {
  let page = await newPage(browser, base, seed, {width: 1280, theme: 'light'});
  await boot(page, base);
  const errs = () => { const e = takeErrs(page); assert(!e.length, e.slice(0, 3).join(' | ')) };
  const db = () => page.evaluate(() => ({log: window.__pt.log.slice(), n: window.__pt.store.size}));
  const dbGet = k => page.evaluate(k => window.__pt.store.has(k) ? JSON.parse(JSON.stringify(window.__pt.store.get(k))) : null, k);
  const nDl = () => page.evaluate(() => window.__pt.downloads.length);
  const waitDl = async (n0, ms) => { await page.waitForFunction(n => window.__pt.downloads.length > n, n0, {timeout: ms}); return page.evaluate(() => window.__pt.downloads[window.__pt.downloads.length - 1]) };
  const waitPv = async () => { await page.waitForFunction(() => { const i = document.querySelector('#xInfo'); return i && !/Laying out/.test(i.textContent) && document.querySelector('#xWord') && document.querySelectorAll('#xPages .sheet').length }, null, {timeout: 90000}); await settle(page, 5000, 2) };
  const sheetCheck = async () => page.evaluate(() => {
    const host = document.querySelector('#xPages'), pr = document.createElement('div'); pr.style.cssText = 'height:297mm;width:1px;flex:none'; host.appendChild(pr);
    const H = pr.offsetHeight; pr.remove();
    const sh = [...host.querySelectorAll('.sheet')];
    const over = sh.map((s, i) => [i + 1, s.offsetHeight]).filter(([, h]) => h > H + 1);
    return {n: sh.length, H, over, empty: sh.filter(s => !s.querySelector('.sheetbody').children.length).length};
  });
  let ok;

  /* ---- Bank ---- */
  // 23 Nov: the 21 Nov health pass commented out diagLog's guard, so a review record whose figures no longer belong to its question
  // showed as an empty "approved" row in Review's diagram log (owner: "yeah fix it"). The log is the Recent decisions list since 24 Nov
  await check('review: Recent decisions skips records with none of the question\'s figures', page, async () => {
    const r = await page.evaluate(() => {
      const q = QG.bank.questions.find(x => !x.dup_of), k = 'q' + q.id, old = QG.reviews[k];
      QG.reviews[k] = {fig: {'no_such_figure_x9': 'approved'}, at: '2099-01-01T00:00:00Z', by: QG.me || null};
      try { return {id: q.id, row: !!RUNDO.what(q, QG.reviews[k])}; } finally { if (old === undefined) delete QG.reviews[k]; else QG.reviews[k] = old; }
    });
    assert(!r.row, `question ${r.id}: an empty row was listed`);
    return `question ${r.id}: no empty row`;
  });
  // owner 24 Nov: "CONFIDENCE 0%" on a correct, corrected MCQ solution (sent as a bug) and "make sure there aren't any more stale numbers or
  // tags hanging": a solution corrected to the checker's answer says so; an approved one shows no model confidence
  await check('solutions: no stale confidence badge on a checker-confirmed or approved solution', page, async () => {
    const r = await page.evaluate(() => { const q0 = QG.bank.questions.find(x => !x.dup_of && !QG.reviews['q' + x.id]), q = {...q0, type: 'written', options: []}, k = 'q' + q.id;
      const s = {id: 999001, source: 'generated', latex: 'x', criteria: [], meta: {confidence: 0, checker_confirmed: 1}};
      const a = solHTML(q, {...s, meta: {confidence: 0, checker_confirms: 'work/s1/verify_out_15_1.json: B (13)'}}, 'review');
      QG.reviews[k] = {sol: {999001: 'approved'}}; const b = solHTML(q, {...s, meta: {confidence: 0.3}}, 'review'); delete QG.reviews[k];
      const c = solHTML(q, {...s, meta: {confidence: 0.3}}, 'review');
      return {a: /confirmed by the checker/.test(a) && !/confidence 0%/.test(a), b: !/confidence 30%/.test(b), c: /confidence 30%/.test(c)} });
    assert(r.a && r.b && r.c, JSON.stringify(r));
    return 'confirmed: "answer confirmed by the checker", no 0%; approved: no confidence; unreviewed: confidence 30% still shown';
  });
  // owner 24 Nov: "some of the text came out a bit weird": a checker note with dollar amounts was typeset as italic maths between two $.
  // Plain notes keep every $ of an amount; maths written on purpose in the same note is still typeset
  await check('text: dollar amounts in a plain note stay literal; maths in the note is still typeset', page, async () => {
    const r = await page.evaluate(async () => { const host = document.createElement('div'); document.body.prepend(host);
      host.innerHTML = noteTxt("the stored answer is $549.36 (assumes 5 full $2140 payments), but the last is $1621.28, so $10 181.28 and $30.64. Exact: $f'(1)=12e\\approx32.62$, not $32.61$.");
      await typeset(host); const txt = host.textContent, mj = host.querySelectorAll('mjx-container').length; host.remove();
      return {money: ['$549.36', '$2140', '$1621.28', '$10 181.28', '$30.64'].every(x => txt.includes(x)), assumes: txt.includes('(assumes 5 full'), mj} });
    assert(r.money && r.assumes && r.mj === 2, JSON.stringify(r));
    return 'five amounts shown with their $, the words between them plain, the two maths expressions typeset';
  });
  // 23 Nov (owner: "for some questions, the original and question are not lining up any more"): a split question's figure name carries
  // its part in brackets (1305_q1(c)_1); the text renderer must turn it into a figure slot, never print the raw \exfigure command
  await check('text: a figure name with brackets becomes a figure slot', page, async () => {
    const r = await page.evaluate(() => { const h = tex('See \\exfigure{1305_q1(c)_1} here'); return {slot: /data-fig="1305_q1\(c\)_1"/.test(h), raw: /exfigure/.test(h)} });
    assert(r.slot && !r.raw, JSON.stringify(r));
    return 'data-fig="1305_q1(c)_1", no raw command';
  });
  await check('bank: open a subtopic', page, async () => {
    await page.click('#list .subrow[data-sel]:not(.none)');
    await page.waitForSelector('#list .cards .card', {timeout: 10000}); await settle(page, 5000, 2);
    await page.waitForFunction(() => document.querySelectorAll('#list mjx-container').length > 0, null, {timeout: 15000}).catch(() => {});   // same timing fix as the views
    const r = await page.evaluate(() => ({cards: document.querySelectorAll('#list .card').length, mjx: document.querySelectorAll('#list mjx-container').length, h: document.querySelector('#list .listhead h2')?.textContent}));
    errs(); assert(r.cards > 0, 'no question cards'); assert(r.mjx > 0, 'cards have no typeset maths');
    return `“${r.h}”: ${r.cards} cards, ${r.mjx} maths`;
  });
  // owner 13 Nov: "animation going between all topics and a subtopic. It's currently just snapping to it"
  await check('bank: topic transitions (back to All topics, into a topic)', page, async () => {
    const vt = await page.evaluate(() => !!document.startViewTransition);
    await page.click('#list [data-home]');
    const mid = await page.evaluate(() => document.documentElement.dataset.bkdir || '');
    await page.waitForFunction(() => !document.querySelector('#list .listhead h2') && !document.documentElement.dataset.bkdir, null, {timeout: 5000});
    const back = await page.evaluate(() => sel);
    await page.click('#list .subrow[data-sel]:not(.none)');
    await page.waitForSelector('#list .cards .card', {timeout: 10000}); await settle(page, 4000, 2);
    const r = await page.evaluate(() => ({sel, dir: document.documentElement.dataset.bkdir || '', named: [...document.querySelectorAll('#list [style*="view-transition-name"]')].filter(e => e.style.viewTransitionName).length, h: document.querySelector('#list .listhead h2')?.textContent}));
    errs();
    assert(!vt || mid === 'back' || mid === 'fade', `going back did not start a transition (bkdir “${mid}”)`);
    assert(back === null && r.sel && r.h, `navigation broke: back sel ${back}, sel ${r.sel}`);
    assert(!r.dir && !r.named, `transition left state behind: bkdir “${r.dir}”, ${r.named} named elements`);
    return `${vt ? 'view transitions' : 'no view transitions (snaps)'}; back, then “${r.h}”`;
  });
  // owner 13 Nov: "theres now some lag going between subtopics on the side bar": sidebar jumps must not run a view transition
  await check('bank: sidebar subtopic switch has no view transition', page, async () => {
    const r = await page.evaluate(async () => {
      let vt = 0; const orig = document.startViewTransition; if (orig) document.startViewTransition = function (...a) { vt++; return orig.apply(document, a) };
      const bs = [...document.querySelectorAll('#nav button[data-sel]')].filter(b => b.dataset.sel !== sel && b.offsetParent);
      if (!bs.length) { if (orig) document.startViewTransition = orig; return {skip: true} }
      const t0 = performance.now(); bs[0].click();
      await new Promise(r => { const t = setInterval(() => { if (sel === bs[0].dataset.sel && document.querySelector('#list .listhead h2')) { clearInterval(t); r() } }, 10) });
      await new Promise(r => setTimeout(r, 300)); if (orig) document.startViewTransition = orig;
      return {vt, ms: Math.round(performance.now() - t0), fade: document.querySelector('#list').classList.contains('bk-swap')};
    });
    errs(); if (r.skip) return 'no other sidebar subtopic visible';
    assert(r.vt === 0, `sidebar click started ${r.vt} view transition(s)`);
    return `no view transition, list in ${r.ms} ms${r.fade ? ', faded in' : ''}`;
  });
  // owner 13 Nov: "in the bank, the pills at the top, make them animated"
  await check('bank: filter pills slide to the chosen option', page, async () => {
    const pos = () => page.evaluate(() => { const g = document.querySelector('#list .bfilters .grp[data-bfg="type"]'); if (!g) return null;
      const p = g.querySelector('.bfpill'), b = g.querySelector('button[aria-pressed="true"]'), pr = p.getBoundingClientRect(), br = b.getBoundingClientRect();
      return {on: p.classList.contains('on'), dx: Math.round(Math.abs(pr.left - br.left)), dw: Math.round(Math.abs(pr.width - br.width)), label: b.textContent} });
    const a = await pos(); if (!a) return 'no filter bar on this page';
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.evaluate(() => { window.__bfrun = 0; document.addEventListener('transitionrun', e => { if (e.target.classList && e.target.classList.contains('bfpill') && e.propertyName === 'transform') window.__bfrun++ }, true) });
    await page.click('#list .bfilters [data-bf="type:written"]');
    await page.waitForTimeout(400); const b = await pos();
    await page.click('#list .bfilters [data-bf="type:all"]'); await page.waitForTimeout(400); const c = await pos();
    await page.emulateMedia({reducedMotion: 'reduce'});
    errs();
    const runs = await page.evaluate(() => window.__bfrun);
    assert(runs >= 2, `pill did not slide (${runs} slide animations started for 2 clicks)`);
    assert(a.on && a.dx <= 1 && a.dw <= 1, `pill not on the chosen option at start (${JSON.stringify(a)})`);
    assert(b.on && b.dx <= 1 && b.dw <= 1 && b.label === 'Written', `pill did not land on “Written” (${JSON.stringify(b)})`);
    assert(c.dx <= 1 && c.label === 'All', `pill did not return to “All” (${JSON.stringify(c)})`);
    return `${runs} slides started; lands on Written, back to All`;
  });
  await check('bank: search', page, async () => {
    await page.fill('#q', 'annuity');
    await page.waitForFunction(() => /Search:/.test(document.querySelector('#list .listhead h2')?.textContent || ''), null, {timeout: 5000});
    await settle(page, 4000, 2);
    const r = await page.evaluate(() => ({h: document.querySelector('#list .listhead .crumb')?.textContent, cards: document.querySelectorAll('#list .card').length}));
    errs(); assert(r.cards > 0, 'search for "annuity" found no cards'); return r.h;
  });
  // owner 19 Nov: Bank cards no longer add to an exam ("+ Add to exam" removed); the greyed-Worksheets check asserts it is gone

  /* ---- Exams: generate a 60-mark paper with 6 multiple choice ---- */
  let gen = null;
  ok = await check('exams: generate a 60-mark paper', page, async () => {
    await page.evaluate(() => { location.hash = '#exams' }); await settle(page, 4000, 2);
    await page.evaluate(() => EXAS.fresh()); await settle(page, 3000, 2);
    await page.click('[data-sall="all"]'); await settle(page, 2000, 2);
    await page.evaluate(() => { for (const [id, v] of [['gMarks', 60], ['gMcq', 6]]) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', {bubbles: true})) } });
    const lab = await page.evaluate(() => [document.querySelector('#gMarksV')?.textContent, document.querySelector('#gMcqV')?.textContent]);
    await genClick(page, '#gGo'); await waitPv();
    gen = await page.evaluate(() => { const qs = EX.items.map(xq).filter(Boolean); return {n: qs.length, marks: qs.reduce((t, q) => t + (+q.marks || 0), 0), mcq: qs.filter(q => q.type === 'mcq').length, last: exA().last, info: document.querySelector('#xInfo').textContent} });
    errs();
    assert(gen.marks === 60, `total marks ${gen.marks}, expected 60 (sliders said ${lab.join(', ')}; warnings: ${(gen.last?.warns || []).join(' ')})`);
    assert(gen.mcq === 6, `${gen.mcq} multiple-choice questions, expected 6`);
    assert(gen.last && gen.last.marks === 60 && gen.last.nM === 6, `generator summary says ${gen.last?.marks} marks, ${gen.last?.nM} MC`);
    assert(/60 marks/.test(gen.info), `preview header says “${gen.info}”`);
    return `${gen.n} questions, ${gen.marks} marks, ${gen.mcq} MC · ${gen.info}`;
  });

  /* ---- Preview: exam paper and marking guide ---- */
  let examSheets = 0;
  await check('preview: exam paper sheets fit A4', page, async () => {
    assert(gen, 'no exam was generated');
    const r = await sheetCheck(); examSheets = r.n;
    const mj = await page.evaluate(() => document.querySelectorAll('#xPages mjx-container').length);
    errs(); assert(r.n > 1, `${r.n} sheet(s)`); assert(!r.over.length, `sheet(s) taller than 297 mm (${r.H}px): ${r.over.map(([i, h]) => `p${i}=${h}px`).join(', ')}`);
    assert(!r.empty, `${r.empty} empty sheet(s)`); assert(mj > 0, 'no typeset maths on the paper');
    return `${r.n} sheets, ${mj} maths`;
  });
  if (!QUICK) {
    await check('export: PDF', page, async () => {
      const n0 = await nDl(); await pvClick(page, '#xPdf'); const d = await waitDl(n0, 120000);
      const buf = fs.readFileSync(path.join(DL, d.filename.replace(/[^\w.\- ]+/g, '_')));
      const head = buf.slice(0, 5).toString('latin1'), pages = (buf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
      errs(); assert(head === '%PDF-', `file starts “${head}”`); assert(/%%EOF\s*$/.test(buf.slice(-32).toString('latin1')), 'no %%EOF at the end');
      assert(pages === examSheets, `${pages} PDF pages, the preview has ${examSheets} sheets`);
      return `${d.filename}: ${pages} pages, ${(d.size / 1e6).toFixed(1)} MB`;
    });
  }
  const wordCheck = async () => {
    page._warn = [];
    const n0 = await nDl(); await pvClick(page, '#xWord'); const d = await waitDl(n0, 120000);
    const z = unzip(fs.readFileSync(path.join(DL, d.filename.replace(/[^\w.\- ]+/g, '_'))));
    assert(z['word/document.xml'], 'no word/document.xml in the .docx');
    const x = z['word/document.xml'].toString('utf8'), om = (x.match(/<m:oMath[\s>]/g) || []).length;
    const toast = await page.evaluate(() => document.querySelector('#toast')?.textContent || '');
    errs(); assert(om > 0, 'document.xml has no <m:oMath> (no editable equations)');
    assert(!page._warn.length, `${page._warn.length} maths fallback(s): ${page._warn[0]}`);
    assert(!/kept as pictures/.test(toast), toast);
    return `${d.filename}: ${om} equations, ${Object.keys(z).length} parts`;
  };
  if (!QUICK) await check('export: Word (exam paper)', page, wordCheck);
  await check('export: HTML download is clean', page, async () => {
    const n0 = await nDl(); await pvClick(page, '#xDl'); const d = await waitDl(n0, 30000);
    const h = fs.readFileSync(path.join(DL, d.filename.replace(/[^\w.\- ]+/g, '_')), 'utf8');
    const body = h.slice(h.indexOf('<body>'));
    errs(); assert(/^<!doctype html>/i.test(h), 'not an HTML document');
    assert(!/contenteditable/i.test(body), 'the file still has contenteditable elements');
    assert(!/class="[^"]*\bscr-only\b/.test(body), 'the file still has .scr-only (screen-only) elements');
    // owner 14 Nov: the diagram's corner handle and live % and the source line's ⓘ are screen only
    assert(!/class="(figpct|figh|figctl)\b|data-figh=|data-qinfo=/.test(body), 'the file still has a diagram handle, live % or an ⓘ');
    assert((body.match(/class="sheet"/g) || []).length === examSheets, 'sheet count differs from the preview');
    // owner 25 Nov: "reference sheet doenst show up when downloading html": every picture is inside the file
    const imgs = [...body.matchAll(/<img[^>]*src="([^"]*)"/g)].map(m => m[1]), ext = imgs.filter(s => !/^data:/.test(s));
    assert(/class="xref"><img[^>]*src="data:image\//.test(body) && !ext.length, `pictures not in the file: ${ext.slice(0, 3).join(' ')}${/class="xref"/.test(body) ? '' : ' (no reference sheet)'}`);
    return `${d.filename}: ${(d.size / 1e3).toFixed(0)} kB, ${examSheets} sheets`;
  });
  await check('preview: marking guide sheets fit A4', page, async () => {
    await page.click('[data-xdoc="guide"]'); await waitPv();
    const r = await sheetCheck(); errs();
    assert(r.n > 0, 'no sheets'); assert(!r.over.length, `sheet(s) taller than 297 mm: ${r.over.map(([i, h]) => `p${i}=${h}px`).join(', ')}`);
    assert(!r.empty, `${r.empty} empty sheet(s)`);
    return `${r.n} sheets`;
  });
  if (!QUICK) await check('export: Word (marking guide)', page, wordCheck);
  // owner 17 Nov: exams holding a question that refers to the z-score table at the back get the table on the last page
  await check('preview: z-score table at the back only when a question needs it', page, async () => {
    const id = await page.evaluate(() => { const id = EX.items[0]; reviews['q' + id] = { ...(reviews['q' + id] || {}), zt: true }; return id; });
    await page.click('[data-xdoc="exam"]'); await waitPv();
    const on = await page.evaluate(() => { const t = document.querySelector('#xPages .xztab'); const sh = t?.closest('.sheet');
      // owner 18 Nov: the course's reference sheet follows it, so the table is on the last sheet before the reference sheet
      return { has: !!t, last: sh === [...document.querySelectorAll('#xPages .sheet')].filter(s => !s.querySelector('.xref')).pop(), rows: t?.querySelectorAll('tbody tr').length,
        v: t?.querySelector('tbody tr:nth-child(11) td')?.textContent, v2: t?.querySelector('tbody tr:nth-child(20) td:nth-child(8)')?.textContent }; });
    const r = await sheetCheck(); errs();
    assert(on.has && on.last, 'no z-score table on the last sheet'); assert(!r.over.length, 'z-score table sheet taller than A4');
    assert(on.rows === 35 && on.v === '0.8413' && on.v2 === '0.9750', `table values wrong: rows ${on.rows}, z=1.00 ${on.v}, z=1.96 ${on.v2}`);
    // 23 Nov (Batch 12): another question in the exam can need the table from the bank (q.zt), so switch it off on every item
    const prevZ = await page.evaluate(() => Object.fromEntries(EX.items.map(i => [i, reviews['q' + i]?.zt])));
    await page.evaluate(() => EX.items.forEach(i => { reviews['q' + i] = { ...(reviews['q' + i] || {}), zt: false }; }));
    await page.click('[data-xdoc="guide"]'); await waitPv();
    assert(!(await page.$('#xPages .xztab')), 'marking guide shows the z-score table');
    await page.click('[data-xdoc="exam"]'); await waitPv();
    assert(!(await page.$('#xPages .xztab')), 'z-score table shown with no question that needs it');
    await page.evaluate(prev => Object.entries(prev).filter(([i]) => i !== '__first').forEach(([i, v]) => { if (v === undefined || String(i) === String(prev.__first)) delete reviews['q' + i].zt; else reviews['q' + i].zt = v; }), {...prevZ, __first: id});
    return 'appended once, values match P(Z<=z)';
  });

  /* ---- Reports: report a question from the paper; it shows on the Reports tab ---- */
  let repQ = null;
  await check('reports: report a question from the preview', page, async () => {
    await page.click('[data-xdoc="exam"]'); await waitPv();
    // owner 14 Nov ("The dot point home looks stupid in a question" / "the i is fine"): the Report link moved from the question
    // into the card behind the ⓘ on the source line, so the report starts there
    repQ = await page.evaluate(() => +document.querySelector('#xPages [data-qinfo]').dataset.qinfo);
    await page.click(`#xPages [data-qinfo="${repQ}"]`);   // owner 18 Nov: Report beside the QID opens the form directly
    await page.waitForSelector('#repDlg .repdlg', {timeout: 5000});
    await page.click('#repDlg [data-rr="dif"]'); await page.click('#repDlg [data-rb="5"]');
    // owner 14 Nov: "Should let you pick UF and PS in the wrong diff": optional, one at a time; stored as suggested_wm
    await page.click('#repDlg [data-rwm="UF"]'); await page.click('#repDlg [data-rwm="PR"]');
    const wmSel = await page.evaluate(() => [...document.querySelectorAll('#repDlg [data-rwm][aria-checked="true"]')].map(b => b.dataset.rwm).join(','));
    assert(wmSel === 'PR', `kind buttons checked: “${wmSel}”, expected PR only`);
    await page.fill('#repDlg textarea', 'Page test: band looks too low');
    await page.click('#repDlg [data-rsend]');
    await page.waitForFunction(() => document.querySelector('#repDlg')?.hidden, null, {timeout: 5000});
    const w = (await db()).log.filter(x => x.op === 'set' && x.k.startsWith('reports/'));
    await settle(page, 2000, 2);
    const link = await page.evaluate(q => { const b = document.querySelector(`#xPages [data-qinfo="${q}"]`); return b && {has: b.classList.contains('has'), label: b.getAttribute('aria-label')} }, repQ);
    errs(); assert(w.length === 1, `${w.length} report writes`); const v = w[0].v;
    assert(v.question_id === repQ && v.reason === 'difficulty' && v.suggested_band === 5 && v.suggested_wm === 'PR' && v.status === 'open', 'report doc: ' + JSON.stringify(v).slice(0, 200));
    assert(link && link.has && /1 open report/.test(link.label), `the Report link is not marked as reported: ${JSON.stringify(link)}`);
    return `${w[0].k} for QID ${repQ}`;
  });

  /* ---- Swap, Lock, Regenerate ---- */
  await check('exams: swap, lock, then regenerate keeps the locked question', page, async () => {
    await page.click('#exGSide [data-gadd]'); await settle(page, 5000, 2);   // owner 19 Nov: "Add a question" opens the picker on the exam's topics
    const before = await page.evaluate(() => EX.items.slice());
    const rows = await page.evaluate(() => [...document.querySelectorAll('#xPanel li[data-xi]')].map(li => +li.dataset.xi));
    assert(rows.length === before.length, `exam panel lists ${rows.length} rows for ${before.length} questions`);
    const wr = await page.evaluate(() => EX.items.filter(i => xq(i).type !== 'mcq'));
    const sw = wr[0], lk = wr[wr.length - 1];
    // owner 19 Nov: Swap opens a chooser with the closest questions (each shown in full); "Use this" swaps it in
    await page.click(`#xPanel li[data-xi="${sw}"] [data-xsw]`); await page.waitForSelector('#swapDlg [data-swuse]', {timeout: 15000});
    const ch = await page.evaluate(() => ({n: document.querySelectorAll('#swapDlg [data-swuse]').length, cards: document.querySelectorAll('#swapDlg .swaplist .card').length, more: !!document.querySelector('#swapDlg [data-swpick]'), first: +document.querySelector('#swapDlg [data-swuse]').dataset.swuse}));
    assert(ch.n >= 1 && ch.n <= 6 && ch.cards === ch.n && ch.more, `swap chooser: ${JSON.stringify(ch)}`);
    const hint = await page.evaluate(() => document.querySelector('#swapDlg .swaphint').textContent);
    assert(/\d+ with the same dot point · \d+ in .+ · \d+ in this exam's topics/.test(hint), 'chooser counts: ' + hint);
    const pre = await page.evaluate(() => EX.items.slice()); assert(pre.includes(sw), 'opening the chooser already swapped the question');
    await page.click('#swapDlg [data-swuse]'); await settle(page, 3000, 2);
    const afterSwap = await page.evaluate(() => EX.items.slice());
    assert(afterSwap.includes(ch.first) && !(await page.evaluate(() => !document.querySelector('#swapDlg') || document.querySelector('#swapDlg').hidden ? false : true)), `"Use this" did not put QID ${ch.first} in or close the chooser`);
    assert(!afterSwap.includes(sw), `QID ${sw} is still in the exam after Swap`);
    assert(afterSwap.length === before.length, `Swap changed the number of questions (${before.length} → ${afterSwap.length})`);
    const lockId = afterSwap.includes(lk) ? lk : afterSwap.find(i => !before.includes(i));
    await page.click(`#xPanel li[data-xi="${lockId}"] [data-xlock]`); await settle(page, 2000, 2);
    const locked = await page.evaluate(id => ({inA: exA().locked.includes(id), pressed: document.querySelector(`#xPanel li[data-xi="${id}"] [data-xlock]`)?.getAttribute('aria-pressed'), swapOff: document.querySelector(`#xPanel li[data-xi="${id}"] [data-xsw]`)?.disabled}), lockId);
    assert(locked.inA && locked.pressed === 'true', `Lock did not stick: ${JSON.stringify(locked)}`);
    assert(locked.swapOff, 'Swap is still enabled on the locked row');
    await page.click('[data-pkback]'); await waitPv();   // 19 Nov: the picker's "Back to the paper" (no separate Preview paper button)
    await genClick(page, '#exPvRegen'); await page.waitForFunction(() => /New exam/.test(document.querySelector('#toast')?.textContent || ''), null, {timeout: 30000}); await waitPv();
    const after = await page.evaluate(() => EX.items.slice());
    const same = after.filter(i => afterSwap.includes(i)).length;
    errs(); assert(after.includes(lockId), `locked QID ${lockId} is gone after Regenerate`);
    assert(same < after.length, 'Regenerate returned the very same exam');
    return `swapped QID ${sw}, locked QID ${lockId}; Regenerate kept it (${same - 1} other questions repeated of ${after.length})`;
  });
  // owner 19 Nov: the exam builder generates and lands on the paper; the picker opens only from it, to replace a question (any question of
  // the exam's topics takes its place) or to add questions; Worksheets (the hand-built route) is greyed until it is built
  await check('exams: Replace… and Add a question open the picker on the exam topics; Worksheets is greyed', page, async () => {
    if (!(await page.evaluate(() => document.body.classList.contains('xpv-on')))) { await page.evaluate(() => xPreview('exam')); await waitPv() }
    const tgt = await page.evaluate(() => { const i = EX.items.findIndex(x => xq(x)?.type !== 'mcq'); const id = EX.items[i]; exSelect(id, 'list'); return {i, id, n: EX.items.length} });
    await settle(page, 1500, 2);
    await page.click(`#exGSide .gq.sel [data-grepl="${tgt.id}"]`); await page.waitForSelector('#exPkBan', {timeout: 10000}); await settle(page, 4000, 2);
    const r = await page.evaluate(() => { const T = EXPK.topics(), cards = [...document.querySelectorAll('#exCards > .card')].map(c => +c.dataset.q);
      return {ban: document.querySelector('#exPkBan').innerText, n: cards.length, off: cards.filter(id => !T.has(xaHomes().get(id)?.sub)).length, inEx: cards.filter(id => EX.items.includes(id)).length,
        btn: document.querySelector('#exCards [data-pkuse]')?.textContent || '', side: [...document.querySelectorAll('#exSide [data-pt]')].filter(b => b.dataset.pt.startsWith('sub:') && !T.has(b.dataset.pt)).length,
        pv: document.body.classList.contains('xpv-on')} });
    assert(/Replacing Q\d+/.test(r.ban) && r.n > 0 && !r.off && !r.inEx && !r.side && !r.pv, `replace picker: ${JSON.stringify(r)}`);
    assert(/^Replace Q\d+ with this$/.test(r.btn), 'card action: ' + r.btn);
    // owner 19 Nov: the replaced question can be shown, the action sits in the card header, and every card has Report
    await page.click('#exPkBan .expkold summary'); await settle(page, 2500, 2);
    const ex = await page.evaluate(() => ({old: !!document.querySelector('#exPkBan .expkoldq .card'), inHd: !!document.querySelector('#exCards .card > .hd [data-pkuse]'), rep: !!document.querySelector('#exCards .card [data-crep]')}));
    assert(ex.old && ex.inHd && ex.rep, `replace page: ${JSON.stringify(ex)}`);
    const pick = await page.evaluate(() => +document.querySelector('#exCards [data-pkuse]').dataset.pkuse);
    await page.click(`#exCards [data-pkuse="${pick}"]`); await waitPv();
    const a = await page.evaluate(() => ({items: EX.items.slice(), pv: document.body.classList.contains('xpv-on')}));
    assert(a.pv && a.items[tgt.i] === pick && a.items.length === tgt.n && !a.items.includes(tgt.id), `after replacing: ${JSON.stringify({pv: a.pv, at: a.items[tgt.i], pick, n: a.items.length})}`);
    await page.click('#exGSide [data-gadd]'); await page.waitForSelector('#exPkBan', {timeout: 10000}); await settle(page, 4000, 2);
    const ban2 = await page.evaluate(() => document.querySelector('#exPkBan').innerText);
    await page.click('#exCards [data-pkuse]'); await settle(page, 1500, 2);
    const n2 = await page.evaluate(() => EX.items.length);
    await page.click('#exPkBan [data-pkback]'); await waitPv();
    const grey = await page.evaluate(() => { const b = document.querySelector('.views .vsoon'); return !!b && /Worksheets/.test(b.textContent) && !document.querySelector('#examsView [data-exv]') && !document.querySelector('#bankView [data-addx]') });
    errs(); assert(/Adding to/.test(ban2) && n2 === tgt.n + 1, `add picker: ${ban2.slice(0, 60)} · ${tgt.n} → ${n2}`);
    assert(grey, 'Worksheets is not a greyed item in the top bar, the Exams tabs are still there, or Bank cards still have "+ Add to exam"');
    return `Q${tgt.i + 1} replaced by QID ${pick} in place; one question added (${tgt.n} → ${n2}); back on the paper`;
  });

  /* ---- owner 25 Nov: "Besides that, yes action all these things" (the checker's and a review's exam-maker list) ---- */
  // 1. "lock doesnt work it can still be replaced and moved": a locked question is not swapped, replaced, moved, removed or sorted, and
  //    Regenerate keeps it in its place; Lock says what it does
  await check('exams: a locked question cannot be swapped, replaced, moved or removed; Regenerate keeps its place', page, async () => {
    if (!(await page.evaluate(() => document.body.classList.contains('xpv-on')))) { await page.evaluate(() => xPreview('exam')); await waitPv() }
    const t = await page.evaluate(() => { const wr = EX.items.filter(i => xq(i)?.type !== 'mcq'), id = wr[1]; exSelect(id, 'list'); return {id, i: EX.items.indexOf(id), si: 1, mid: wr[2], first: wr[0]} });
    await settle(page, 1200, 2);
    const lb0 = await page.evaluate(id => document.querySelector(`#exGSide [data-glock="${id}"]`)?.textContent.trim(), t.id);
    await page.click(`#exGSide [data-glock="${t.id}"]`); await settle(page, 800, 2);
    const ui = await page.evaluate(id => { const g = s => document.querySelector(`#exGSide ${s}`);
      return {lb: g(`[data-glock="${id}"]`)?.textContent.trim(), off: ['data-gswap', 'data-grepl', 'data-grm'].map(a => g(`[${a}="${id}"]`)).every(b => b && b.disabled && /Locked: kept as is/.test(b.title)),
        drag: g(`[data-drag="${id}"]`)?.getAttribute('draggable'), mv: [...document.querySelectorAll(`#exGSide [data-gmv][data-id="${id}"]`)].every(b => b.disabled)} }, t.id);
    assert(lb0 === 'Lock this question' && ui.lb === 'Locked - click to unlock', `lock button: “${lb0}” → “${ui.lb}”`);
    assert(ui.off && ui.drag === 'false' && ui.mv, `controls of the locked question: ${JSON.stringify(ui)}`);
    const r = await page.evaluate(async ({id, mid, first}) => { const before = EX.items.join(), other = B.questions.find(q => q.type !== 'mcq' && !EX.items.includes(q.id) && xaHomes().has(q.id));
      xaSwap(id, other.id); EXPK.open('replace', id); exMove(id, 1); exMove(mid, -1); exDrop(mid, first, false); xToggle(id);
      const same = EX.items.join() === before, view = EXV.view;
      document.querySelector('#exGSide [data-gsort]')?.click(); await new Promise(r => setTimeout(r, 300));
      return {same, view, pv: document.body.classList.contains('xpv-on'), at: EX.items.filter(i => xq(i)?.type !== 'mcq').indexOf(id)} }, t);
    assert(r.same && r.pv && r.view !== 'pick', `a locked question changed: ${JSON.stringify(r)}`);
    assert(r.at === t.si, `Sort easiest first moved the locked question from Section II place ${t.si + 1} to ${r.at + 1}`);
    await waitPv(); await genClick(page, '#exPvRegen'); await page.waitForFunction(() => /New exam/.test(document.querySelector('#toast')?.textContent || ''), null, {timeout: 30000}); await waitPv();
    const g = await page.evaluate(id => EX.items.filter(i => xq(i)?.type !== 'mcq').indexOf(id), t.id);
    await page.evaluate(id => xaLock(id), t.id); await settle(page, 800, 2);
    errs(); assert(g === t.si, `Regenerate put the locked question at Section II place ${g + 1}, it was at ${t.si + 1}`);
    return `QID ${t.id} (Q${t.i + 1}) locked: swap, replace, move, drop, remove and sort refused; Regenerate kept it in its place`;
  });
  // 2. saving: the saved state matches the database (key order does not matter), a Save button in the paper bar and Ctrl/Cmd-S, Escape
  //    closes the innermost menu only, and leaving the paper saves
  await check('exams: Save in the paper bar and Ctrl+S; the saved state is true; Escape closes a menu first; Close saves', page, async () => {
    if (!(await page.evaluate(() => document.body.classList.contains('xpv-on')))) { await page.evaluate(() => xPreview('exam')); await waitPv() }
    await page.waitForFunction(() => EX.id && exmState() === 'saved', null, {timeout: 10000});
    const k = await page.evaluate(async () => { const d = JSON.parse(JSON.stringify(window.__pt.store.get('exams/' + EX.id)));
      d.lines = Object.fromEntries(Object.entries({...d.lines, 'zz:1': 3, 'aa:1': 4}).reverse()); EX.lines['zz:1'] = 3; EX.lines['aa:1'] = 4; d.figscale = {...d.figscale};
      await db.doc('exams/' + EX.id).set(d); await new Promise(r => setTimeout(r, 200)); const st = exmState(); delete EX.lines['zz:1']; delete EX.lines['aa:1']; return st });
    assert(k === 'saved', `the same exam with its answer lines in another key order reads as “${k}”`);
    await page.evaluate(() => { const i = document.querySelector('#exGSide [data-xname]'); i.value = 'PT renamed on the paper'; i.dispatchEvent(new Event('change', {bubbles: true})) });
    const b1 = await page.evaluate(() => { const b = document.querySelector('#xPvSave [data-exm-save]'); return {t: b?.textContent, dis: b?.disabled} });
    assert(b1.t === 'Save' && !b1.dis, `paper bar after a change: ${JSON.stringify(b1)}`);
    await page.keyboard.press('Control+s'); await page.waitForFunction(() => window.__pt.store.get('exams/' + EX.id)?.sub === 'PT renamed on the paper' && exmState() === 'saved', null, {timeout: 5000});
    await waitPv();
    const b2 = await page.evaluate(() => ({t: document.querySelector('#xPvSave [data-exm-save]')?.textContent || '', cover: document.querySelector('#xPages .cv-title')?.textContent}));
    assert(/✓ Saved \d/.test(b2.t) && b2.cover === 'PT renamed on the paper', `after Ctrl+S: ${JSON.stringify(b2)}`);
    await page.click('#xPv [data-xmenu]'); const open = await page.evaluate(() => !document.querySelector('#xPv .xmenu-pop').hidden);
    await page.keyboard.press('Escape'); await sleep(200);
    const e1 = await page.evaluate(() => ({pop: !document.querySelector('#xPv .xmenu-pop').hidden, pv: document.body.classList.contains('xpv-on')}));
    assert(open && !e1.pop && e1.pv, `Escape on the Exam menu: ${JSON.stringify({open, ...e1})}`);
    await page.evaluate(() => { EX.bytopic = EX.bytopic === false; xsave() });   // a change, then Escape at once (before it saves itself)
    const want = await page.evaluate(() => EX.bytopic !== false);
    await page.keyboard.press('Escape'); await page.waitForFunction(w => (window.__pt.store.get('exams/' + EX.id)?.bytopic !== false) === w, want, {timeout: 5000});
    await settle(page, 1500, 2);
    const m = await page.evaluate(() => ({pv: document.body.classList.contains('xpv-on'), view: EXV.view, cur: !!document.querySelector('#exMine .exm-cur'), txt: document.querySelector(`#exMine [data-exm="${EX.id}"]`)?.innerText || '', ban: !!document.querySelector('#exMine .exm-unsaved')}));
    errs(); assert(!m.pv && m.view === 'mine' && !m.cur && !/Open now/.test(m.txt) && !m.ban && /Saved/.test(m.txt), `after Escape: ${JSON.stringify(m)}`);
    await page.evaluate(() => xPreview('exam')); await waitPv();
    return 'key order ignored; Save + Ctrl+S; Escape closed the menu, then the paper (saved first); no “Open now”';
  });
  // 4. owner 25 Nov: "it should be the same in question and solutions is what I meant": one size per diagram per exam, paper and guide
  await check('exams: a diagram resized on the paper has that size in the marking guide, and the reverse', page, async () => {
    let k = await page.evaluate(() => document.querySelector('#xPages [data-figw]')?.dataset.figw);
    if (!k) { const q = await page.evaluate(() => { const q = B.questions.find(q => q.type !== 'mcq' && figKeys(q).all.length && xaHomes().has(q.id) && !EX.items.includes(q.id)); EX.items.push(q.id); xsave(); return q.id });
      await page.evaluate(() => xPreview('exam')); await waitPv(); k = await page.evaluate(() => document.querySelector('#xPages [data-figw]')?.dataset.figw) }
    assert(k, 'no diagram on the paper');
    await page.evaluate(k => exFigCommit(k, 0.7), k); await waitPv();
    await page.click('[data-xdoc="guide"]'); await waitPv();
    const g = await page.evaluate(k => { const w = document.querySelector(`#xPages [data-figw="${k}"]`); return w && {fs: w.style.getPropertyValue('--fs'), h: !!w.querySelector('.figh')} }, k);
    assert(g && g.fs === '0.7' && g.h, `the guide's copy of ${k}: ${JSON.stringify(g)}`);
    await page.evaluate(k => exFigCommit(k, 1), k); await waitPv();
    await page.click('[data-xdoc="exam"]'); await waitPv();
    const p = await page.evaluate(k => ({fs: document.querySelector(`#xPages [data-figw="${k}"]`)?.style.getPropertyValue('--fs'), saved: EX.figscale[k]}), k);
    errs(); assert(p.fs === '1' && p.saved == null, `the paper after resizing on the guide: ${JSON.stringify(p)}`);
    return `${k}: 70% on the paper showed 70% in the guide; 100% set on the guide is back on the paper`;
  });
  // 7 and 9: rename on the paper (above), answer lines on every written question at once; 8: an instruction's bullet at its first line
  await check('exams: + 1 line on all written questions; a long instruction keeps its bullet on its first line', page, async () => {
    const before = await page.evaluate(() => { const o = {}; EX.items.map(xq).filter(q => q && q.type !== 'mcq').forEach(q => q.parts.forEach(p => { if (leaf(q, p)) o[exLnKey(q, p)] = EX.lines[exLnKey(q, p)] ?? exLnDef(p.marks ?? q.marks) })); return o });
    await page.click('#exGSide [data-glnall="1"]'); await waitPv();
    const after = await page.evaluate(ks => ks.map(k => EX.lines[k]), Object.keys(before));
    const bad = Object.keys(before).filter((k, i) => after[i] !== Math.min(40, before[k] + 1));
    assert(Object.keys(before).length && !bad.length, `${bad.length} of ${Object.keys(before).length} parts did not get one more line`);
    await page.click('#exGSide [data-glnall="-1"]'); await waitPv();
    await page.evaluate(() => { EX.instr = [...(EX.instr || EX_INSTR), 'A long instruction that runs over more than one line on the cover, so that its bullet has to choose a line to sit beside when it wraps']; xsave() });
    await page.evaluate(() => exRelayout()); await waitPv();
    const b = await page.evaluate(() => { const li = [...document.querySelectorAll('#xPages .cv-v li')].find(l => /A long instruction/.test(l.textContent)), ed = li.querySelector('.ed'), pr = document.createElement('span');
      pr.textContent = '\u200b'; li.insertBefore(pr, li.firstChild); const r = pr.getBoundingClientRect(), e = ed.getBoundingClientRect(); pr.remove(); return {probe: r.top - e.top, lines: Math.round(e.height / r.height)} });
    await page.evaluate(() => { EX.instr.pop(); xsave() }); await page.evaluate(() => exRelayout()); await waitPv();
    errs(); assert(b.lines >= 2 && b.probe < 6, `bullet line ${JSON.stringify(b)} (the marker sits where the probe does)`);
    return `${Object.keys(before).length} parts +1 then −1; the wrapped instruction's bullet is on its first line (${b.lines} lines)`;
  });
  // 10. "10 multiple-choice questions take 11 pages": short options sit side by side; Section I questions are never split
  await check('exams: short multiple-choice options sit side by side, no question split', page, async () => {
    const r = await page.evaluate(() => { const mc = EX.items.filter(i => xq(i)?.type === 'mcq').length, secs = [...document.querySelectorAll('#xPages section.xq.mc')];
      return {mc, secs: secs.length, packed: secs.filter(s => s.querySelector('.xol.x2,.xol.x4')).length, ol: secs.filter(s => s.querySelector('.xol')).length} });
    errs(); assert(r.mc && r.secs === r.mc, `${r.mc} multiple-choice questions drawn as ${r.secs} pieces`);
    assert(r.packed > 0, `no multiple-choice options side by side (${r.ol} option lists)`);
    return `${r.packed} of ${r.ol} option lists side by side; ${r.mc} questions, none split`;
  });

  /* ---- Save, My exams, rename, delete ---- */
  let saved = null;
  await check('exams: save, then My exams lists it', page, async () => {
    await page.click('#xPvClose'); await settle(page, 2000, 2);
    await page.evaluate(() => { EX.sub = 'Page test exam'; xsave() });
    await page.waitForFunction(() => EX.id && window.__pt.store.has('exams/' + EX.id) && exmState() === 'saved', null, {timeout: 8000});   // 19 Nov: it saves itself
    saved = await page.evaluate(() => EX.id);
    const doc = await dbGet('exams/' + saved);
    await page.evaluate(() => EXAS.go('mine')); await settle(page, 3000, 2);
    const row = await page.evaluate(id => document.querySelector(`#exMine [data-exm="${id}"]`)?.innerText || null, saved);
    const st = await page.evaluate(() => document.querySelector('#exSaveSt')?.dataset.st);
    errs(); assert(doc && doc.items && doc.items.length && doc.sub === 'Page test exam', 'saved doc: ' + JSON.stringify(doc).slice(0, 200));
    assert(row && /Page test exam/.test(row), 'My exams does not list the saved exam');
    assert(st === 'saved', `head marker is “${st}”, expected saved`);
    return `exams/${saved}, ${doc.items.length} questions`;
  });
  await check('exams: rename in My exams', page, async () => {
    assert(saved, 'nothing saved');
    await pvClick(page, `#exMine [data-exm="${saved}"] [data-exm-ren]`);   // 19 Nov: Duplicate, Rename, Delete sit in the card's ⋯ menu
    await page.fill(`#exMine [data-exm="${saved}"] [data-exm-rt]`, 'Page test renamed');
    await page.click(`#exMine [data-exm="${saved}"] [data-exm-rok]`); await settle(page, 2000, 2);
    const doc = await dbGet('exams/' + saved), row = await page.evaluate(id => document.querySelector(`#exMine [data-exm="${id}"]`)?.innerText || '', saved);
    errs(); assert(doc && doc.sub === 'Page test renamed', 'database still has ' + (doc && doc.sub));
    assert(/Page test renamed/.test(row), 'the row does not show the new name');
    // owner 19 Nov: "Can we just make the block clickable to enter the exam": a click on the card (not on its buttons) opens it on its paper
    await page.evaluate(() => { EX = {...EX, id: null, sub: 'other', items: []}; });
    const box = await page.$(`#exMine [data-exm="${saved}"] .exm-stats`); await box.click(); await page.waitForFunction(id => EX.id === id && document.body.classList.contains('xpv-on'), saved, {timeout: 10000});
    await page.click('#xPvClose'); await settle(page, 1500, 2);
    const h = await page.evaluate(id => document.querySelector(`#exMine [data-exm="${id}"]`).getBoundingClientRect().height, saved);
    assert(h < 90, `a My exams card is ${Math.round(h)} px tall (two lines expected)`);
    return 'renamed; a click on the card opened it; card ' + Math.round(h) + ' px tall';
  });
  await check('exams: delete in My exams', page, async () => {
    assert(saved, 'nothing saved');
    await pvClick(page, `#exMine [data-exm="${saved}"] [data-exm-del]`);
    await page.click(`#exMine [data-exm="${saved}"] [data-exm-delok]`); await settle(page, 2000, 2);
    const doc = await dbGet('exams/' + saved), row = await page.evaluate(id => !!document.querySelector(`#exMine [data-exm="${id}"]`), saved);
    errs(); assert(!doc, 'still in the database'); assert(!row, 'still listed');
    return 'deleted';
  });
  // owner 19 Nov: the exam saves itself, Generate on a saved exam asks first, questions in other saved exams are skipped and say where
  // they were used, and the working time follows marks x 1.8 minutes
  await check('exams: the open exam saves itself, and Generate on it asks before replacing its questions', page, async () => {
    await page.evaluate(() => EXAS.fresh()); await settle(page, 1500, 2);
    const del = await page.evaluate(() => ({id: EX.id || null, n: EX.items.length}));
    assert(!del.id && !del.n, `deleting the open exam left ${JSON.stringify(del)} (it would come back as a new exam)`);
    const skip = await page.evaluate(() => document.querySelector('#gAvoid')?.checked);
    assert(skip === true, '"Skip questions already in my saved exams" is not ticked on a new exam');
    await page.click('[data-sall="all"]'); await settle(page, 1500, 2);   // a new exam starts with no topics chosen
    await genClick(page, '#gGo'); await settle(page, 2500, 2);
    await page.waitForFunction(() => EX.id && window.__pt.store.has('exams/' + EX.id), null, {timeout: 8000});
    await settle(page, 1500, 2);
    const a = await page.evaluate(() => ({id: EX.id, n: EX.items.length, st: exmState(), pv: document.body.classList.contains('xpv-on')}));
    assert(a.n > 0 && a.st === 'saved' && a.pv, `after Generate (saved, on the paper): ${JSON.stringify(a)}`);
    await pvClick(page, '#exPvSet'); await settle(page, 1500, 2);   // 19 Nov: inside an exam, Settings reopens the setup form for it
    const head = await page.evaluate(() => ({t: document.querySelector('#exTtl')?.innerText || '', go: document.querySelector('#gGo')?.textContent}));
    assert(/Settings for/.test(head.t) && /Regenerate with these settings/.test(head.go), 'settings view: ' + JSON.stringify(head));
    await page.click('#gGo'); await page.waitForSelector('#exAsk', {timeout: 3000});
    const ask = await page.evaluate(() => document.querySelector('#exAsk').innerText);
    await page.click('#exAsk [data-ask="x"]');
    const kept = await page.evaluate(() => ({id: EX.id, n: EX.items.length}));
    assert(/replaces the \d+ questions/.test(ask) && kept.id === a.id && kept.n === a.n, `Cancel changed the exam: ${JSON.stringify(kept)} (${ask})`);
    await page.click('#gGo'); await page.click('#exAsk [data-ask="new"]'); await settle(page, 2500, 2);
    if (await page.$('#xPvClose')) { await page.click('#xPvClose'); await settle(page, 1000, 2) }
    await page.waitForFunction(id => EX.id && EX.id !== id && window.__pt.store.has('exams/' + EX.id), a.id, {timeout: 8000});
    const b = await page.evaluate(() => ({id: EX.id, items: EX.items}));
    const old = await dbGet('exams/' + a.id);
    errs(); assert(old && old.items.length === a.n, 'the first exam changed when a new one was made');
    // the first exam's questions are skipped by default, and a question used there says where
    const overlap = b.items.filter(i => old.items.includes(i)).length;
    assert(overlap === 0, `${overlap} question(s) of the saved exam were used again (skip is on by default)`);
    const tag = await page.evaluate(id => { const q = xq(id); return q ? EXAS.usedTag(q) : '' }, old.items[0]);
    assert(/Used in/.test(tag), 'no "Used in" tag for a question of the saved exam: ' + tag);
    const t = await page.evaluate(() => ({time: EX.time, m: xMarks(EX.items.map(xq).filter(Boolean))}));
    const want = Math.max(5, Math.round(t.m * 1.8 / 5) * 5), wantTxt = await page.evaluate(w => EXSEC.dur(w), want);
    assert(t.time === wantTxt, `working time ${t.time} for ${t.m} marks, expected ${wantTxt} (1.8 minutes a mark)`);
    // owner 19 Nov: "tutors should be able to make similar exams if studnts need another one": a new exam, same settings, "(version k)", no repeats
    const bname = await page.evaluate(() => EXAS.name());
    await page.evaluate(() => EXAS.similar());
    await page.waitForFunction(ids => EX.id && !ids.includes(EX.id) && window.__pt.store.has('exams/' + EX.id), [a.id, b.id], {timeout: 15000});
    const c = await page.evaluate(() => ({id: EX.id, items: EX.items.slice(), name: EXAS.name(), pv: document.body.classList.contains('xpv-on')}));
    const bsaved = await dbGet('exams/' + b.id);
    const rep = c.items.filter(i => old.items.includes(i) || b.items.includes(i)).length;
    assert(c.items.length > 0 && /\(version \d+\)$/.test(c.name) && c.name.startsWith(bname.replace(/\s*\(version \d+\)$/, '')) && c.pv, `Make similar: ${JSON.stringify({...c, items: c.items.length})}`);
    assert(rep === 0, `Make similar reused ${rep} question(s) of the saved exams`);
    assert(bsaved && bsaved.items.length === b.items.length, 'Make similar changed the exam it copied');
    await page.click('#xPvClose'); await settle(page, 1000, 2);
    assert(await page.evaluate(() => EXV.view === 'mine' && !!document.querySelector('#examsView .exm-top')), 'Close did not go back to My exams');
    for (const id of [a.id, b.id, c.id]) await page.evaluate(id => db.doc('exams/' + id).delete(), id);
    await page.evaluate(() => EXAS.fresh(true));
    return `autosaved ${a.id}; Cancel kept it; "Make a new exam instead" made ${b.id} with no repeats; ${t.m} marks → ${t.time}`;
  });

  /* ---- Reports tab ---- */
  await check('reports: the report is on the Reports tab', page, async () => {
    await page.evaluate(() => { location.hash = '#review' }); await settle(page, 4000, 2);
    const badge = await page.evaluate(() => document.querySelector('#inboxBox [data-card="reports"] .ict')?.textContent);   // owner 13 Nov: the count is on the Inbox's Reports card
    await page.evaluate(() => { location.hash = '#reports' }); await settle(page, 4000, 2);
    const r = await page.evaluate(b => ({rows: [...document.querySelectorAll('#reportsBox .rep-row')].map(li => li.innerText), badge: b}), badge);
    errs(); assert(r.rows.length >= 1, 'no report rows');
    assert(r.rows.some(t => /Wrong difficulty/.test(t) && /band 5/.test(t) && /Problem solving/.test(t) && /band looks too low/.test(t)), 'the new report (band 5 · Problem solving) is not listed: ' + (r.rows[0] || '').slice(0, 160));
    assert(r.badge === String(r.rows.length), `Inbox Reports count “${r.badge}” for ${r.rows.length} open report(s)`);
    return `${r.rows.length} open, Inbox count ${r.badge}`;
  });

  /* ---- Grouped data packs (stage 2, 15 Nov): redraws and overlays load from data/<kind>/g<n>.json, never per paper ---- */
  await check('figures: every redraw and overlay loads from the grouped packs', page, async () => {
    const r = await page.evaluate(async () => {
      const ks = Object.keys(B.figs).filter(k => ['ok', 'approx'].includes(B.figs[k].status));
      const docs = [...new Set(ks.map(k => k.split('_')[0]))];
      const have = new Set(); for (const d of docs) { const m = await svgs(d); Object.keys(m).forEach(k => have.add(k)) }
      const miss = ks.filter(k => !have.has(k));
      // the overlay / first-redraw pack (Review > Check, "Overlay" and "Before → now")
      const ovk = ks.find(k => B.figs[k].ov) || ks[0], cm = await cmps(ovk.split('_')[0]), ncm = Object.keys(cm).length;
      // hydrate() as the page does it: a redrawn diagram and an overlay image get their data URIs
      const box = document.createElement('div'); const k = ks.find(k => have.has(k)), ck = Object.keys(cm)[0];
      box.innerHTML = `<img data-k="${k}" data-kind="svg"><img data-k="${ck.slice(3)}" data-kind="${ck.slice(0, 2)}">`; document.body.appendChild(box);
      hydrate(box, {id: 0}, 'bank'); await new Promise(z => setTimeout(z, 1500));
      const srcs = [...box.querySelectorAll('img')].map(i => (i.getAttribute('src') || '').slice(0, 15)); box.remove();
      const urls = performance.getEntriesByType('resource').map(e => new URL(e.name).pathname).filter(u => /\/data\/(svg|cmp|focus)\//.test(u));
      return {n: ks.length, docs: docs.length, miss: miss.slice(0, 5), nmiss: miss.length, ncm, srcs, urls: [...new Set(urls)]};
    });
    errs();
    assert(!r.nmiss, `${r.nmiss} of ${r.n} redraws missing from the svg groups: ${r.miss.join(', ')}`);
    assert(r.ncm > 0, 'the overlay pack (data/cmp) is empty or did not load');
    assert(r.srcs.every(s => s.startsWith('data:image/')), `hydrate() left an image without data: ${JSON.stringify(r.srcs)}`);
    const bad = r.urls.filter(u => !/\/data\/(svg|cmp)\/g\d+\.json$/.test(u));
    assert(!bad.length, `requests outside the group files: ${bad.slice(0, 5).join(' ')}`);
    return `${r.n} redraws from ${r.docs} papers in ${r.urls.filter(u => /svg/.test(u)).length} svg group file(s); ${r.ncm} overlay images`;
  });

  /* ---- Review: Agree (approve) writes and moves on (on a page with the Review workload) ---- */
  await page.context().close();
  page = await newPage(browser, base, seedR, {width: 1280, theme: 'light'});
  await boot(page, base, '#review');
  await check('review: approve writes to the database and moves on', page, async () => {
    await page.evaluate(() => { location.hash = '#review/paper/1346' }); await settle(page, 5000, 2);   // owner 13 Nov: one paper at a time (the fixture's 2022 CSSA AT4 starts at Your calls)
    const has = await page.$('#approve');
    assert(has, 'no Approve button in the paper flow');
    const was = await page.evaluate(() => rlist[ridx].id), n0 = (await db()).log.length;
    await page.click('#approve'); await settle(page, 3000, 2);
    // owner 14 Nov (Fix 2, "Ok we should run Fix 1 and 2"): decisions are written by question key, reviews/k_<key> (RKEY.qdoc)
    const dk = await page.evaluate(id => 'reviews/' + RKEY.qdoc(B.questions.find(q => q.id === id)), was);
    const w = (await db()).log.slice(n0).filter(x => x.k === dk);
    const now = await page.evaluate(() => rlist[ridx] && rlist[ridx].id);
    errs(); assert(w.length && w[0].v.status === 'approved', `no approved write for ${dk}`);
    assert(now !== was, `still on QID ${was}`);
    return `QID ${was} approved, now on QID ${now}`;
  });
  // owner 23 Nov: "I need the checker approving fixed tonight" -> "stale page approvals" (37_fresh.js): once a newer version is live, the
  // open page shows the reload bar and refuses approvals (question, diagrams, difficulty); a flag still saves
  await check('review: a page older than the live version shows the reload bar and refuses approvals; flags still save', page, async () => {
    const mine = await page.evaluate(() => FRESH.build);
    assert(/^[0-9a-f]{16}$/.test(mine), `the page carries no build id: ${mine}`);
    const same = await page.evaluate(async () => { FRESH.at = 0; return await FRESH.check() });
    assert(same === false && !(await page.$('#freshBar')), 'the page calls itself stale against its own version.json');
    await page.route(/data\/version\.json/, r => r.fulfill({contentType: 'application/json', body: JSON.stringify({build: 'ffffffffffffffff'})}));
    await page.evaluate(() => { location.hash = '#review/paper/1346' }); await settle(page, 4000, 2);
    const was = await page.evaluate(() => rlist[ridx].id), n0 = (await db()).log.length;
    await page.evaluate(() => { FRESH.at = 0 });   // the last check is old: the guard asks again before approving
    await page.click('#approve'); await settle(page, 2000, 2);
    const r = await page.evaluate(() => ({bar: !!document.querySelector('#freshBar [data-fresh-reload]'), id: rlist[ridx] && rlist[ridx].id, stale: FRESH.stale}));
    const dk = await page.evaluate(id => 'reviews/' + RKEY.qdoc(B.questions.find(q => q.id === id)), was);
    const ap = (await db()).log.slice(n0).filter(x => x.k === dk && x.v && x.v.status === 'approved');
    const lv = await page.evaluate(async () => { const n = window.__pt.log.length; await lvSave(); return window.__pt.log.length - n });
    assert(r.stale && r.bar, `no reload bar on a stale page: ${JSON.stringify(r)}`);
    assert(!ap.length && r.id === was, `approved from a stale page (${ap.length} writes, now on ${r.id})`);
    assert(lv === 0, `difficulty saved from a stale page (${lv} writes)`);
    const fl = await page.evaluate(async () => { const q = rlist[ridx], n = window.__pt.log.length; await write(q, {status: 'flagged', note: 'pt stale flag'}); return window.__pt.log.length - n });
    assert(fl === 1, `a flag from a stale page did not save (${fl} writes)`);
    await page.unroute(/data\/version\.json/);
    await page.evaluate(id => { FRESH.stale = false; FRESH.at = 0; document.getElementById('freshBar')?.remove(); const q = B.questions.find(x => x.id === id); return write(q, {status: null, note: null}) }, was);
    errs();
    return `build ${mine}; stale: bar shown, Approve and difficulty refused, a flag saved`;
  });
  await check('difficulty: Agree writes to the database and moves on', page, async () => {
    await page.evaluate(() => { location.hash = '#levels' }); await settle(page, 5000, 2);
    let has = await page.$('#lvOk');
    if (!has) { await page.click('[data-lvshow="all"]'); await settle(page, 3000, 2); has = await page.$('#lvOk') }
    assert(has, 'no Agree button on the Difficulty tab');
    const was = await page.evaluate(() => +document.querySelector('#levelsBox .lvcard').dataset.part), n0 = (await db()).log.length;
    const lab = await page.evaluate(() => document.querySelector('#lvOk').firstChild.textContent);
    await page.click('#lvOk'); await settle(page, 3000, 2);
    const w = (await db()).log.slice(n0).filter(x => x.k === 'difficulty/' + was);
    const now = await page.evaluate(() => +document.querySelector('#levelsBox .lvcard')?.dataset.part || null);
    errs(); assert(w.length && w[0].v.part_id === was && w[0].v.status === (lab === 'Agree' ? 'agreed' : w[0].v.status), `no write for difficulty/${was}`);
    assert(now !== was, `still on part ${was}`);
    return `part ${was} ${w[0].v.status}, now on part ${now}`;
  });
  // owner 23 Nov: "In difficulty, change the 2,3,4,5,6 to qwert and F PS to d and f"
  await check('difficulty: Q W E R T set the band, D and F the label; 2-6 no longer do', page, async () => {
    const st = () => page.evaluate(() => ({b: document.querySelector('[data-lvb][aria-pressed="true"]')?.dataset.lvb, w: document.querySelector('[data-lvw][aria-pressed="true"]')?.dataset.lvw}));
    await page.keyboard.press('t'); const a = await st(); await page.keyboard.press('q'); const b = await st();
    await page.keyboard.press('f'); const c = await st(); await page.keyboard.press('d'); const d = await st();
    await page.keyboard.press('4'); const e = await st();
    const hints = await page.evaluate(() => [...document.querySelectorAll('.lvbands kbd, .lvwm kbd')].map(k => k.textContent).join(''));
    errs();
    assert(a.b === '6' && b.b === '2' && c.w === 'PR' && d.w === 'UF' && e.b === '2', `keys: t ${a.b}, q ${b.b}, f ${c.w}, d ${d.w}, 4 left band ${e.b}`);
    assert(hints === 'QWERTDF', `key hints on the buttons: ${hints}`);
    return 'T band 6, Q band 2, F Problem solving, D Fluency; 4 does nothing; hints QWERT D F';
  });
  // owner 24 Nov: "for the difficulty page, can u put the solution next to the question, its important I see both quickly and properly to judge difficulty"
  await check('difficulty: each part\'s solution is open beside its part when wide, under it when narrow', page, async () => {
    const pick = () => page.evaluate(async () => {
      LVAREA = 'all'; LVSHOW = 'all'; const l = lvList(); await QG.need(l.map(x => x.q));
      const n = q => q.parts.filter(p => leaf(q, p) && solsFor(q, p.id, 'bank').count).length;
      LVI = Math.max(0, l.findIndex(x => n(x.q) >= 2)); renderLevels(true); await MathJax.startup.promise; return l[LVI] && n(l[LVI].q) });
    const lay = () => page.evaluate(() => [...document.querySelectorAll('#levelsBox .lvq .part')].filter(p => p.querySelector(':scope>.under details.solbox')).map(p => {
      const t = p.querySelector(':scope>.tx').getBoundingClientRect(), s = p.querySelector(':scope>.under').getBoundingClientRect();
      return {open: p.querySelector(':scope>.under details.solbox').open, beside: s.left >= t.right - 1 && Math.abs(s.top - t.top) < 12, under: s.top >= t.bottom - 1 && s.left < t.right}; }));
    const parts = await pick(); assert(parts >= 2, `no multi-part reference with solutions to show (${parts})`);
    await settle(page, 4000, 2); const w = await lay();
    await page.screenshot({path: path.join(SHOTS, 'difficulty_side_1280.png'), fullPage: true});
    const mcq = await page.evaluate(async () => { const l = lvList(), i = l.findIndex(x => x.q.type === 'mcq' && solsFor(x.q, null, 'bank').count); if (i < 0) return null;
      LVI = i; renderLevels(true); await MathJax.startup.promise; const pr = document.querySelector('#levelsBox .qpair'); if (!pr) return {pair: false};
      const [o, s] = [pr.firstElementChild.getBoundingClientRect(), pr.querySelector(':scope>details.solbox').getBoundingClientRect()];
      return {pair: true, beside: s.left >= o.right - 1 && Math.abs(s.top - o.top) < 12, open: pr.querySelector(':scope>details.solbox').open, key: !!pr.querySelector('.opt.correct.show .badge, .ocell.correct, td.ans')}; });
    if (mcq) await page.screenshot({path: path.join(SHOTS, 'difficulty_mcq_1280.png'), fullPage: true});
    assert(!mcq || (mcq.pair && mcq.beside && mcq.open && mcq.key), `MCQ options beside the answer and working: ${JSON.stringify(mcq)}`);
    await page.setViewportSize({width: 390, height: 844}); await pick(); await settle(page, 4000, 2); const n = await lay();
    await page.screenshot({path: path.join(SHOTS, 'difficulty_under_390.png'), fullPage: true});
    const ok = await page.evaluate(() => !!document.querySelector('#lvOk') && getComputedStyle(document.querySelector('#lvAct')).position === 'sticky' && document.documentElement.scrollWidth <= innerWidth + 1);
    await page.setViewportSize({width: 1280, height: 900}); await page.evaluate(() => { LVAREA = load('lv_area2') || 'plan'; LVSHOW = load('lv_show') || 'todo'; LVI = 0; renderLevels() });
    errs();
    assert(w.length >= 2 && w.every(x => x.open && x.beside), `1280: ${JSON.stringify(w)}`);
    assert(n.length >= 2 && n.every(x => x.open && x.under), `390: ${JSON.stringify(n)}`);
    assert(ok, 'the rating bar is missing or the page scrolls sideways at 390 px');
    return `${w.length} parts: solutions open beside them at 1280, under them at 390; ${mcq ? 'an MCQ\'s answer and working beside its options; ' : ''}rating bar kept`;
  });
  await page.context().close();
}

async function phone(browser, base, seed) {
  const page = await newPage(browser, base, seed, {width: 390, theme: 'light'});
  await boot(page, base);
  // checker report 18 Nov ("Maths breaks across lines"): at 390 px no inline maths on the Bank's cards splits unless it is wider than its column
  await check('phone: inline maths on Bank cards splits only when wider than its column', page, async () => {
    await page.evaluate(() => { location.hash = '#bank' }); await settle(page, 4000, 2);
    await page.evaluate(() => document.querySelector('[data-sel^="sub:12|Integral calculus|Areas"]')?.click()); await settle(page, 6000, 2);
    // the cards sit below the filters on a phone, and maths is typeset as cards scroll into view: bring them on screen first
    // (18 Nov: failed 2 of 3 runs without this)
    await page.evaluate(() => (document.querySelector('#bankList .card, .card') || document.body).scrollIntoView({block: 'start'}));
    await page.waitForFunction(() => document.querySelector('#bankList mjx-container, .card mjx-container'), null, {timeout: 15000}).catch(() => {});
    const r = await page.evaluate(() => { const cs = [...document.querySelectorAll('#bankList mjx-container:not([display="true"]), .card mjx-container:not([display="true"])')];
      const bad = cs.filter(c => !c.classList.contains('mjx-wrap') && new Set([...c.getClientRects()].map(x => Math.round(x.top))).size > 1);
      const over = cs.filter(c => { const r = c.getBoundingClientRect(); return r.right > innerWidth + 1 });
      return {n: cs.length, bad: bad.length, over: over.length} });
    assert(r.n > 0, 'no inline maths on the Bank cards at 390 px');
    assert(!r.bad && !r.over, `${r.bad} of ${r.n} inline expressions split, ${r.over} run past the screen edge`);
    return `${r.n} inline expressions at 390 px: none split, none past the edge`;
  });
  await check('phone menu: opens and navigates', page, async () => {
    const vis = await page.evaluate(() => { const b = document.querySelector('#menuBtn'); return !!b && b.offsetWidth > 0 });
    assert(vis, 'the menu button is not visible at 390 px');
    await page.click('#menuBtn'); await settle(page, 1500, 2);
    const open = await page.evaluate(() => ({hidden: document.querySelector('#mSheet').hidden, links: [...document.querySelectorAll('#mSheet a')].map(a => a.textContent.trim()), exp: document.querySelector('#menuBtn').getAttribute('aria-expanded')}));
    assert(!open.hidden && open.exp === 'true', 'the menu did not open');
    assert(open.links.length === 5, `${open.links.length} links in the menu: ${open.links.join(', ')}`);   // 13 Nov: Teach 3 + Curate 2 (Papers merged into Review)
    const heads = await page.evaluate(() => [...document.querySelectorAll('#mSheet .mgrp')].map(g => g.querySelector('.mh').textContent + ':' + [...g.querySelectorAll('a')].map(a => a.textContent.replace(/\d+$/, '').trim()).join('/')));
    assert(heads.join(' | ') === 'Teach:Bank/Exams/Guide | Curate:Review/Processes', `menu groups: ${heads.join(' | ')}`);
    assert(open.links.includes('Processes') && !open.links.includes('Import'), `the menu should name Processes, not Import: ${open.links.join(', ')}`);   // owner 14 Nov
    await page.click('#mSheet a[href="#review"]'); await settle(page, 4000, 2);
    const r = await page.evaluate(() => ({hash: location.hash, hidden: document.querySelector('#mSheet').hidden, cur: document.querySelector('#menuCur').textContent, pv: !document.querySelector('#inboxView').hidden, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth}));
    const e = takeErrs(page); assert(!e.length, e.join(' | '));
    assert(r.hash === '#review' && r.pv, `did not go to the Review Inbox (${r.hash})`); assert(r.hidden, 'the menu stayed open'); assert(r.cur === 'Review', `menu button says “${r.cur}”`);
    assert(r.sw <= r.cw + 1, `horizontal scroll ${r.sw} > ${r.cw}`);
    return `${open.links.length} links; the Review Inbox opened`;
  });
  await page.context().close();
}

/* ---------------- Teach | Curate (owner 15 Nov: "Lets do 2 as well" and "curate should be hidden to peope except editors.") ----------------
   Editor (owner / canEdit): the switch, three tabs per area, Difficulty and Reports as Review steps, the old hashes land on their step.
   Viewer (neither) and no user capability at all: no switch, no Curate tab or link anywhere, and a Curate hash goes to #bank. */
const CURATE_HASHES = ['#review', '#papers', '#processes', '#processes/work', '#processes/papers', '#import', '#levels', '#difficulty', '#reports', '#review/difficulty', '#review/reports', '#review/papers', '#review/paper/323', '#review/paper/323/topics', '#review/list/recent'];
async function areas(browser, base, seed) {
  const navState = p => p.evaluate(() => ({hash: location.hash, view, sw: (() => { const s = document.querySelector('#areaSw'); return !!s && !s.hidden && s.offsetWidth > 0 })(),
    tabs: [...document.querySelectorAll('.views a')].filter(a => a.offsetWidth > 0).map(a => a.firstChild.textContent.trim()),
    cur: document.querySelector('.views a[aria-current="page"]')?.firstChild.textContent.trim(), area: document.documentElement.dataset.area,
    pressed: document.querySelector('#areaSw button[aria-pressed="true"]')?.dataset.area}));
  const go = async (p, h) => { await p.evaluate(h => { location.hash = h }, h); await settle(p, 4000, 2) };

  const page = await newPage(browser, base, seed, {width: 1280, theme: 'light'});
  await boot(page, base);
  const errs = () => { const e = takeErrs(page); assert(!e.length, e.slice(0, 3).join(' | ')) };
  await check('areas (editor): Teach | Curate switch and tabs', page, async () => {
    let r = await navState(page); errs();
    assert(r.sw, 'no Teach | Curate switch for an editor');
    assert(r.tabs.join('/') === 'Bank/Exams/Guide' && r.pressed === 'teach' && r.area === 'teach', `Teach shows ${r.tabs.join('/')} (switch on ${r.pressed})`);
    await page.click('#areaSw button[data-area="curate"]'); await settle(page, 5000, 2);
    r = await navState(page); errs();
    assert(r.view === 'inbox' && r.hash === '#review', `Curate opened ${r.hash} (view ${r.view})`);   // owner 13 Nov: Review opens on the Inbox
    assert(r.tabs.join('/') === 'Review/Processes' && r.pressed === 'curate' && r.cur === 'Review', `Curate shows ${r.tabs.join('/')}, current ${r.cur}`);   // owner 13 Nov: "Merge into Review"
    const sl = await page.evaluate(async () => { await new Promise(z => setTimeout(z, 400)); const s = document.querySelector('#areaSw .aslider').getBoundingClientRect(), b = document.querySelector('#areaSw button[aria-pressed="true"]').getBoundingClientRect(); return {dx: Math.abs(s.left - b.left), dw: Math.abs(s.width - b.width)} });
    assert(sl.dx < 1.5 && sl.dw < 1.5, `the switch highlight is off the selected area by ${sl.dx.toFixed(1)} px / ${sl.dw.toFixed(1)} px`);
    await go(page, '#review/papers'); await page.click('#areaSw button[data-area="teach"]'); await settle(page, 4000, 2);
    r = await navState(page); assert(r.view === 'bank', `Teach went to ${r.hash}`);
    await page.click('#areaSw button[data-area="curate"]'); await settle(page, 4000, 2);
    r = await navState(page); errs(); assert(r.hash === '#review/papers', `Curate should return to the last Curate page (#review/papers), went to ${r.hash}`);
    return 'Teach: Bank/Exams/Guide · Curate: Review/Processes · switch slides · last page per area kept';
  });
  await check('areas (editor): Difficulty and Reports are Inbox sections with ← Inbox', page, async () => {
    // owner 13 Nov: the 7-button step row is gone; Reports and Difficulty are Inbox cards that open their own sections
    await go(page, '#review');
    const st = await page.evaluate(() => ({rbar: !document.querySelector('#rbar').hidden, steps: document.querySelectorAll('#filters .step').length, cards: [...document.querySelectorAll('#inboxBox .icard')].map(c => c.dataset.card)}));
    errs(); assert(!st.rbar && !st.steps, `the old step row is still there (${st.steps} steps, bar ${st.rbar})`);
    assert(st.cards.filter(c => c !== 'back' && c !== 'waiting').join(',') === 'papers,reports,difficulty', `Inbox cards: ${st.cards.join(',')}`);   // 'back' (17 Nov) and 'waiting' (18 Nov) show only when something came back fixed / waits for Claude
    for (const [k, h, v, box] of [['difficulty', '#review/difficulty', 'levels', '#levelsView'], ['reports', '#review/reports', 'reports', '#reportsView']]) {
      await page.click(`#inboxBox [data-card="${k}"] a.ihead`); await settle(page, 4000, 2);
      const r = await page.evaluate(box => ({hash: location.hash, view, shown: !document.querySelector(box).hidden, back: document.querySelector(box + ' > a.rback')?.getAttribute('href'), cur: document.querySelector('.views a[aria-current="page"]')?.firstChild.textContent.trim()}), box);
      errs(); assert(r.hash === h && r.view === v && r.shown, `${k} card opened ${r.hash} (view ${r.view})`);
      assert(r.back === '#review' && r.cur === 'Review', `${k}: back link ${r.back}, tab ${r.cur}`);
      await page.click(box + ' > a.rback'); await settle(page, 3000, 2);
      const b = await page.evaluate(() => ({hash: location.hash, view})); assert(b.hash === '#review' && b.view === 'inbox', `← Inbox from ${k} went to ${b.hash}`);
    }
    return 'no step row; cards papers, reports, difficulty; both sections open and ← Inbox returns';
  });
  await check('areas (editor): old #levels, #difficulty, #reports, #papers and #import still land', page, async () => {
    const out = [];
    for (const [h, want, v] of [['#levels', '#review/difficulty', 'levels'], ['#difficulty', '#review/difficulty', 'levels'], ['#reports', '#review/reports', 'reports'], ['#import', '#processes/papers', 'processes'], ['#papers', '#review/papers', 'papers']]) {
      await go(page, '#bank'); await go(page, h);
      const r = await page.evaluate(() => ({hash: location.hash, view}));
      assert(r.hash === want && r.view === v, `${h} → ${r.hash} (view ${r.view}), expected ${want}`); out.push(`${h}→${r.hash}`);
    }
    errs(); return out.join(' ');
  });
  await check('areas (editor): the last area is remembered', page, async () => {
    await go(page, '#review/papers');
    await page.goto(base + 'review.html'); await page.waitForFunction(() => typeof B !== 'undefined' && B && EDITOR !== null, null, {timeout: 45000}); await settle(page, 5000, 2);
    const r = await navState(page); errs();
    assert(r.hash === '#review/papers' && r.area === 'curate', `a bare reload opened ${r.hash || '(no hash)'} in ${r.area}`);
    return 'reload with no hash reopened #review/papers (Curate)';
  });
  await page.context().close();

  // owner 17 Nov: "Checker (reviewer), Tutors" / "Hide Curate parts, Who can approve": the checker (Editor share) sees Review, never Processes
  {
    const cp = await newPage(browser, base, seed, {width: 1280, theme: 'light', role: 'checker'});
    await boot(cp, base);
    await check('areas (checker): Review only, no Processes', cp, async () => {
      await cp.waitForFunction(() => EDITOR === true && QG.owner === false, null, {timeout: 15000});
      await go(cp, '#review'); let r = await navState(cp);
      assert(r.view === 'inbox' && r.tabs.join('/') === 'Review', `checker Curate shows ${r.tabs.join('/')} (view ${r.view})`);
      for (const h of ['#processes', '#processes/papers', '#import']) {
        await go(cp, '#bank'); await go(cp, h); r = await navState(cp);
        assert(r.view === 'inbox' && r.hash === '#review', `checker on ${h} landed on ${r.hash} (view ${r.view})`);
      }
      const m = await cp.evaluate(() => { document.querySelector('#menuBtn').click(); const t = [...document.querySelectorAll('#mSheet a')].map(a => a.firstChild.textContent.trim()); document.querySelector('#menuBtn').click(); return t });
      assert(!m.includes('Processes'), `phone menu offers ${m.join('/')}`);
      const e = takeErrs(cp); assert(!e.length, e.slice(0, 3).join(' | '));
      return 'tabs Review only; #processes, #processes/papers, #import go to #review; no Processes in the menu';
    });
    // owner 17 Nov: "if questions have been flagged but the spot check is done, the questions CANNOT be approved until all flagged
    // questions are approved": a paper approval stops counting while any question in it is flagged or has a diagram change request
    await check('review: a flagged question holds back the paper approval', cp, async () => {
      const r = await cp.evaluate(() => {
        const qs = B.questions.filter(q => !q.dup_of && q.tri?.tier === 'auto'), q = qs[0]; if (!q) return {skip: true};
        const other = B.questions.find(x => x.doc === q.doc && x.id !== q.id && !x.dup_of);
        const keep = {p: reviews['paper_' + q.doc], o: reviews['q' + other.id], a: reviews['q' + q.id]};
        delete reviews['q' + q.id]; reviews['paper_' + q.doc] = {status: 'approved', at: '2026-11-17T00:00:00Z'};
        const before = approvedAt(q) != null;
        reviews['q' + other.id] = {status: 'flagged', note: 'x'};
        return new Promise(res => setTimeout(() => { const flagged = approvedAt(q) != null, ready = paperReady(q.doc);
          reviews['q' + other.id] = {status: 'approved'};
          setTimeout(() => { const after = approvedAt(q) != null;
            reviews['q' + other.id] = {fig: {k: 'changes'}};
            setTimeout(() => { const fig = approvedAt(q) != null;
              ['paper_' + q.doc, 'q' + other.id, 'q' + q.id].forEach((k, i) => { const v = [keep.p, keep.o, keep.a][i]; if (v === undefined) delete reviews[k]; else reviews[k] = v });
              res({before, flagged, ready, after, fig}) }, 5) }, 5) }, 5)) });
      assert(!r.skip && r.before && !r.flagged && !r.ready && r.after && !r.fig, `paper approval with flags: ${JSON.stringify(r)}`);
      return 'approved paper: auto question approved; a flagged question or a diagram change request in the paper holds it back; approving the flag releases it';
    });
    // owner 17 Nov: "that needs a way for it to be shown in the exam if it has been reported by teachers or put back in review"
    await check('exams: a reported or flagged question is marked in the exam and in My exams', cp, async () => {
      const r = await cp.evaluate(() => {
        const q = B.questions.find(x => !x.dup_of && qState(x) === 'approved'); if (!q) return {skip: true};
        const keepR = reviews['q' + q.id], keepL = REP.list, keepI = EX.items.slice(), keepS = XSAVED;
        EX.items = [q.id]; xPanel(); const clean = !document.querySelector('#xPanel .xwarn') && !document.querySelector('#xPanel .xwarnbox');
        REP.list = [{id: 'r1', question_id: q.id, key: q.key, status: 'open', reason: 'other'}]; xPanel();
        const rep = document.querySelector('#xPanel .xwarn')?.textContent || '';
        REP.list = []; reviews['q' + q.id] = {status: 'flagged', note: 'x'}; xPanel();
        const back = document.querySelector('#xPanel .xwarn')?.textContent || '', box = document.querySelector('#xPanel .xwarnbox')?.textContent || '';
        const mine = qWatch(q)?.back === true;
        if (keepR === undefined) delete reviews['q' + q.id]; else reviews['q' + q.id] = keepR; REP.list = keepL; EX.items = keepI; xPanel();
        return {clean, rep, back, box, mine} });
      assert(!r.skip && r.clean && /reported by a teacher/.test(r.rep) && /sent back to review/.test(r.back) && /1 question in this exam has been reported or sent back/.test(r.box) && r.mine, `exam warnings: ${JSON.stringify(r)}`);
      return 'clean exam: no warning; open report: "reported by a teacher"; flag: "sent back to review" and the notice at the top';
    });
    await check('review: fixed flags come back in one list on the Inbox', cp, async () => {
      const r = await cp.evaluate(() => { const q = B.questions.find(x => !x.dup_of); const keep = reviews['q' + q.id];
        reviews['q' + q.id] = {status: 'flagged', note: 'x', fixed: {note: 'Claude: fixed'}}; const a = backQ(q) && inFilter(q, 'back');
        reviews['q' + q.id] = {fig: {}, fig_done: {k1: 'req -> fixed'}}; const b = backQ(q);
        reviews['q' + q.id] = {fig: {k1: 'approved'}, fig_done: {k1: 'req -> fixed'}}; const c = !backQ(q);
        // owner 17 Nov: the original flag shows beside the fix at the top; an old redraw takes its request from fig_notes
        reviews['q' + q.id] = {status: 'flagged', note: 'the pi is wrong', fixed: {note: 'Claude 17 Nov: moved it'}, fig: {}, fig_notes: {k2: 'axis label covered'}, fig_done: {k2: '2026-11-12 redraw (fix8)'}};
        // owner 17 Nov: a re-flag (old fix still recorded, or a new change request) leaves "back" and joins "waiting"
        const keepB = reviews['q' + q.id];
        reviews['q' + q.id] = {status: 'flagged', note: 'again', fixed: null, fig: {}, fig_done: {k2: 'x -> y'}}; const w1 = waitQ(q) && !backQ(q) && inFilter(q, 'waiting');
        reviews['q' + q.id] = {fig: {k2: 'changes'}, fig_done: {k2: 'x -> y'}, fig_notes: {k2: 'redo it'}}; const w2 = waitQ(q) && !backQ(q) && /redo it/.test(backBoxHTML(q, reviews['q' + q.id]));
        reviews['q' + q.id] = keepB;
        const box = backBoxHTML(q, reviews['q' + q.id]); const d = /the pi is wrong/.test(box) && /moved it/.test(box) && /axis label covered/.test(box) && /redrawn 2026-11-12/.test(box) && w1 && w2;
        if (keep === undefined) delete reviews['q' + q.id]; else reviews['q' + q.id] = keep; return {a, b, c, d} });
      assert(r.a && r.b && r.c && r.d, `back list: ${JSON.stringify(r)}`);
      return 'a fixed text flag and a redrawn diagram are in "Fixed and back for you"; once approved they leave it';
    });
    // checker report 18 Nov (owner: "lets do 2,3,4,6"): "Maths breaks across lines ... '¼ ln 2 − ⅛' breaks in the middle: '− ⅛.' starts
    //   the next line". The expression (2023 HSC Q32(a)) is laid out at every column width from 300 to 720 px: it must never split; an
    //   expression wider than its column still wraps instead of running past the edge
    await check('maths: inline maths moves to the next line whole; only maths wider than its column wraps', cp, async () => {
      const r = await cp.evaluate(async () => { const host = document.createElement('div'); host.className = 'tx'; document.body.prepend(host); const split = [];
        const one = '$\\dfrac{1}{4}\\ln 2-\\dfrac{1}{8}$';
        for (let w = 300; w <= 720; w += 6) { host.style.width = w + 'px'; host.innerHTML = tex('Show that the area bounded by the two curves and the y-axis, as shaded in the diagram, is ' + one + '.'); await typeset(host);
          const c = host.querySelector('mjx-container'); if (new Set([...c.getClientRects()].map(x => Math.round(x.top))).size > 1) split.push(w) }
        host.style.width = '300px'; host.innerHTML = tex('Show that $f(x)=3x^4-8x^3+6x^2-12x+5+\\dfrac{1}{x^2+1}-\\ln(x^2+4)+e^{2x}-7\\sin 3x$ for all real $x$.'); await typeset(host);
        const c = host.querySelector('mjx-container'), long = {wrap: c.classList.contains('mjx-wrap'), over: host.scrollWidth > host.clientWidth + 1};
        host.remove(); return {split, long} });
      assert(!r.split.length, `¼ ln 2 − ⅛ split across lines at column widths ${r.split.join(', ')} px`);
      assert(r.long.wrap && !r.long.over, `a long expression in a 300 px column: wraps ${r.long.wrap}, overflows ${r.long.over}`);
      return '¼ ln 2 − ⅛ never splits from 300 to 720 px; a long expression wraps inside 300 px';
    });
    // owner 18 Nov: "can undo recently approed questions. Maybe a queue on the same page on the right side?"; owner 24 Nov: "merge the
    //   recent descision and recently approved list as they are different": one column lists approvals, flags and diagram requests, newest
    //   first, each with Undo; an undo is listed too; the diagram step has no second log
    await check('review: one Recent decisions list (approved, flagged, diagram requests, undone) beside the question; Undo puts the record back', cp, async () => {
      const r = await cp.evaluate(async () => { const qs = B.questions.filter(x => !x.dup_of && !reviews['q' + x.id]).slice(0, 3), keep = qs.map(q => reviews['q' + q.id]);
        const [q, q2, q3] = qs;
        const before = {status: 'flagged', note: 'test note', fixed: null, at: new Date(Date.now() - 3600e3).toISOString()};
        reviews['q' + q.id] = before; await write(q, {status: 'approved', note: null}); const tick = () => new Promise(f => setTimeout(f, 5)); await tick();
        await write(q2, {status: 'flagged', note: 'label B wrong'});
        await tick(); reviews['q' + q3.id] = {fig: {}, at: new Date().toISOString(), by: me || null}; const k3 = qFigs(q3)[0] || chkFigs(q3)[0];
        if (k3) await write(q3, {fig: {[k3]: 'changes'}, fig_notes: {[k3]: 'move the label'}});
        renderReview(); const el = document.getElementById('rvUndo');
        const rows = el ? [...el.querySelectorAll('.rv-undolist li')] : [], row = id => rows.find(li => li.querySelector(`[data-rundo="q:${id}"]`));
        const listed = !!el && !el.hidden && /Recent decisions/.test(el.textContent) && !!row(q.id) && /approved/.test(row(q.id).textContent)
          && !!row(q2.id) && /flagged: label B wrong/.test(row(q2.id).textContent) && (!k3 || /changes requested: move the label/.test(row(q3.id)?.textContent || ''));
        const order = rows.indexOf(row(q3.id)) <= rows.indexOf(row(q2.id)) && rows.indexOf(row(q2.id)) < rows.indexOf(row(q.id));
        const col = el ? getComputedStyle(document.getElementById('reviewView')).gridTemplateColumns.split(' ').length : 0;
        await RUNDO.undo('q', String(q.id)); const after = reviews['q' + q.id];
        const restored = after.status === 'flagged' && after.note === 'test note';
        const undoneRow = [...document.querySelectorAll('#rvUndo .rv-undolist li.gone')].some(li => /undone/.test(li.textContent));
        await RUNDO.undo('q', String(q2.id)); const unflag = !reviews['q' + q2.id].status || reviews['q' + q2.id].status === undefined;
        // an approval from an earlier session (nothing kept): Undo clears "approved"
        reviews['q' + q.id] = {status: 'approved', at: new Date(Date.now() - 86400e3).toISOString(), by: me || null}; await RUNDO.undo('q', String(q.id));
        const cleared = !reviews['q' + q.id].status;
        const oneList = typeof diagLog === 'undefined' && !document.querySelector('.dlog, #logT');
        qs.forEach((x, i) => { if (keep[i] === undefined) delete reviews['q' + x.id]; else reviews['q' + x.id] = keep[i] }); RUNDO.undone = []; RUNDO.save(); renderReview();
        return {listed, order, col, restored, undoneRow, unflag, cleared, oneList} });
      assert(Object.values(r).every(v => v === true || typeof v === 'number'), `recent decisions: ${JSON.stringify(r)}`);
      return `one list (${r.col} columns): approval, flag and diagram request newest first; Undo restored the flagged record and is listed; an older approval is cleared; no second log in the diagram step`;
    });
    // owner 24 Nov: "the why this is here box get cut off": the full reason is on the page; a long one shows about two lines and "more"
    await check('review: a long "Why this is here" reason is complete, clamped to about two lines with a more toggle', cp, async () => {
      const r = await cp.evaluate(async () => { const q = B.questions.find(x => x.tri && !x.dup_of), keep = q.tri;
        const long = 'Checker got a different answer — (d): the stored solution\'s main answer is $549.36 (assumes 5 full $2140 payments), but the loan finishes with a final payment of only $1621.28, so the remaining payments total $10 181.28 and the saving is 10 181.28 − 10 150.64 = $30.64. The END-OF-REASON';
        q.tri = {...keep, why: [long], look: keep.look || []}; const host = document.createElement('div'); host.style.width = '420px'; document.body.prepend(host);
        host.innerHTML = whyHTML(q); await typeset(host); const li = host.querySelector('li.rv-long'), cl = li?.querySelector('.rv-clamp');
        const lh = cl ? parseFloat(getComputedStyle(cl).lineHeight) || 20 : 0, h1 = cl?.getBoundingClientRect().height || 0;
        const full = /END-OF-REASON/.test(host.textContent) && host.textContent.includes('$549.36');
        li?.querySelector('.rv-more')?.click(); const h2 = cl?.getBoundingClientRect().height || 0, btn = li?.querySelector('.rv-more')?.textContent;
        host.remove(); q.tri = keep; return {full, clamp: h1 > 0 && h1 < lh * 2.6, opens: h2 > h1, btn} });
      assert(r.full && r.clamp && r.opens && r.btn === 'less', JSON.stringify(r));
      return 'the whole reason is there with its $ amounts; about two lines shown, "more" opens it, "less" closes it';
    });
    // owner 18 Nov: "more obvious on the page when questions have been done by you and have been returned. Maybe a different place to the
    //   flagged waiting for claude ones"
    await check('review: Fixed and back for you is first on Review; Flags waiting for Claude sits below Reports and Difficulty', cp, async () => {
      const r = await cp.evaluate(async () => { const qs = B.questions.filter(x => !x.dup_of).slice(5, 7), keep = qs.map(q => reviews['q' + q.id]);
        reviews['q' + qs[0].id] = {status: 'flagged', note: 'x', fixed: {note: 'Claude 18 Nov 10:00: moved the label'}};
        reviews['q' + qs[1].id] = {status: 'flagged', note: 'y', fixed: null};
        location.hash = '#review'; await new Promise(res => setTimeout(res, 400)); renderInbox();
        const cards = [...document.querySelectorAll('.icard')].map(c => c.dataset.card), what = document.querySelector('.icard.rv-back')?.textContent || '';
        qs.forEach((q, i) => { if (keep[i] === undefined) delete reviews['q' + q.id]; else reviews['q' + q.id] = keep[i] });
        return {cards, moved: /moved the label/.test(what)} });
      const iB = r.cards.indexOf('back'), iW = r.cards.indexOf('waiting'), iP = r.cards.indexOf('papers'), iD = r.cards.indexOf('difficulty');
      assert(iB === 0 && iP > iB && iW > iD && r.moved, `card order ${r.cards.join(', ')}; what changed shown: ${r.moved}`);
      return `order: ${r.cards.join(' · ')}; the returned item shows what Claude changed`;
    });
    // owner 19 Nov: "I need a way for the reviewer to run flags" -> a button that sends them to Claude (runs/flags_*, status requested)
    await check('review: Fix my flags now sends the waiting flags to Claude and says when it will run', cp, async () => {
      const r = await cp.evaluate(async () => { const q = B.questions.filter(x => !x.dup_of)[8], keep = reviews['q' + q.id];
        reviews['q' + q.id] = {status: 'flagged', note: 'z', fixed: null}; location.hash = '#review'; await new Promise(res => setTimeout(res, 400)); renderReview();
        const b = document.querySelector('.handoff [data-flr]'); if (!b) return {btn: false}; b.click(); await new Promise(res => setTimeout(res, 600));
        const ids = [...window.__pt.store.keys()].filter(k => /^runs\/flags_/.test(k)), doc = ids.length ? window.__pt.store.get(ids[ids.length - 1]) : null, txt = document.querySelector('.handoff')?.textContent || '';
        if (keep === undefined) delete reviews['q' + q.id]; else reviews['q' + q.id] = keep;
        ids.forEach(k => window.__pt.store.delete(k)); FLR.runs = []; renderReview();
        return {btn: true, kind: doc?.kind, status: doc?.status, txt} });
      assert(r.btn && r.kind === 'flags' && r.status === 'requested' && /Sent to Claude/.test(r.txt) && /Claude checks .+; otherwise at the night run/.test(r.txt), JSON.stringify(r));
      return 'runs/flags_* requested; the line says when Claude picks it up';
    });
    // owner 23 Nov: "get a way for claude to instantly run flags when checker needs them done": with a Claude session able to take it, the
    // click also sends the request as a comment to Claude (sendToClaude from the click, anchored on the button) and the runs doc says so
    await check('review: Fix my flags now sends the request to Claude at once when a session can take it', cp, async () => {
      const r = await cp.evaluate(async () => { const q = B.questions.filter(x => !x.dup_of)[8], keep = reviews['q' + q.id], cm = FLR.cm, cs = FLR.cs; let sent = null;
        FLR.cm = {anchorFor: async el => ({path: 'pt', x: 1, y: 1, el: el.dataset.flr !== undefined}), sendToClaude: async t => { sent = t; return {threadId: 't1', commentId: 'c1'} }}; FLR.cs = 'available';
        reviews['q' + q.id] = {status: 'flagged', note: 'z', fixed: null}; TOPICS = null; _clean = null; _esc = {}; _rk = null; location.hash = '#bank'; await new Promise(res => setTimeout(res, 300)); location.hash = '#review'; await new Promise(res => setTimeout(res, 400)); renderReview();
        const b = document.querySelector('.handoff [data-flr]'); if (!b) return {btn: false}; b.click(); await new Promise(res => setTimeout(res, 600));
        const ids = [...window.__pt.store.keys()].filter(k => /^runs\/flags_/.test(k)), id = ids[ids.length - 1], doc = id ? window.__pt.store.get(id) : null, txt = document.querySelector('.handoff')?.textContent || '';
        if (keep === undefined) delete reviews['q' + q.id]; else reviews['q' + q.id] = keep;
        ids.forEach(k => window.__pt.store.delete(k)); FLR.runs = []; FLR.cm = cm; FLR.cs = cs; renderReview();
        return {btn: true, instant: doc?.instant, onBtn: sent?.anchor?.el, names: !!(sent && id && sent.text.includes(id)), txt} });
      assert(r.btn && r.instant === true && r.onBtn && r.names && /within a few minutes/.test(r.txt), JSON.stringify(r));
      return 'sent to Claude from the click (anchored on the button, naming the runs doc); runs doc instant; the line says within minutes';
    });
    // owner 18 Nov: "Why does it say both 11 and 20?": the banner and the Flags card count the same questions
    await check('review: the flags banner counts each waiting question once, as the Flags card does', cp, async () => {
      const r = await cp.evaluate(async () => { const qs = B.questions.filter(x => !x.dup_of).slice(0, 2), keep = qs.map(q => reviews['q' + q.id]);
        const a = {status: 'approved', fig: {t1: 'changes', t2: 'changes'}}, b = {status: 'flagged', note: 'x', fixed: null};
        reviews['q' + qs[0].id] = a; reviews['k_zz_test_a'] = a; reviews['q' + qs[1].id] = b; reviews['k_zz_test_b'] = b;
        const [n, nq] = pendingFlags(), card = B.questions.filter(waitQ).length;
        // owner 23 Nov: "why don't these numbers match": the card's words say it counts questions and give the banner's flag count
        location.hash = '#review'; await new Promise(res => setTimeout(res, 400)); renderInbox();
        const ct = (document.querySelector('.icard[data-card="waiting"]')?.textContent || '').replace(/\s+/g, ' ');
        delete reviews['k_zz_test_a']; delete reviews['k_zz_test_b'];
        qs.forEach((q, i) => { if (keep[i] === undefined) delete reviews['q' + q.id]; else reviews['q' + q.id] = keep[i] });
        return {n, nq, card, ct, n0: pendingFlags()} });
      assert(r.nq === r.card && r.n - r.n0[0] === 3 && r.nq - r.n0[1] === 2, `banner ${r.n} flags in ${r.nq} questions, card ${r.card}, before ${r.n0}`);
      assert(new RegExp(`^ ?${r.card} ?Questions with flags waiting for Claude ?${r.n} flags `).test(r.ct), `card text: ${r.ct.slice(0, 160)}`);
      return `banner ${r.n} flags in ${r.nq} questions = card "${r.card} Questions with flags waiting for Claude · ${r.n} flags"; a k_ alias is not counted twice`;
    });
    // owner 18 Nov: "Can u make it so when you click on the original and now, they enlarge"
    await check('review: a click on a comparison picture opens it large; arrows step, Esc closes', cp, async () => {
      await cp.evaluate(() => { const q = B.questions.find(x => !x.dup_of && B.docs[x.doc]?.ip && qFigs(x).some(k => B.figs[k] && B.figs[k].status !== 'table' && !/_s\d+$/.test(k)));
        const host = document.createElement('div'); host.id = 'ptZoom'; host.style.width = '700px'; host.innerHTML = figCompareHTML(q); document.body.prepend(host); host.querySelectorAll('details').forEach(d => d.open = true); hydrate(host, q) });
      await cp.waitForFunction(() => [...document.querySelectorAll('#ptZoom .cmp')].some(c => [...c.querySelectorAll('img.fig')].filter(i => i.src && i.complete && i.naturalWidth).length >= 2), null, {timeout: 20000}).catch(async e => { throw new Error(e.message + ' ' + await cp.evaluate(() => JSON.stringify([...document.querySelectorAll('#ptZoom img')].map(i => [i.dataset.k, i.dataset.kind, (i.src || '').slice(0, 30), i.alt])))) });
      const small = await cp.evaluate(() => { const c = [...document.querySelectorAll('#ptZoom .cmp')].find(c => c.querySelectorAll('img.fig[src]').length >= 2); c.id = 'ptZoomC'; return c.querySelector('img.fig[src]').getBoundingClientRect().width });
      await cp.click('#ptZoomC img.fig[src]'); await sleep(300);
      const a = await cp.evaluate(() => { const d = document.getElementById('rvFigZoom'), i = d && d.querySelector('.rv-fzbody img');
        return {open: !!d && d.open, w: i ? i.getBoundingClientRect().width : 0, t: d && d.querySelector('#rvFigZoomT').textContent, n: d && d.querySelector('.rv-fzn').textContent, role: document.querySelector('#ptZoomC img.fig[src]').getAttribute('role')} });
      await cp.keyboard.press('ArrowRight'); await sleep(100);
      const t2 = await cp.evaluate(() => document.querySelector('#rvFigZoomT').textContent);
      await cp.keyboard.press('Escape'); await sleep(200);
      const closed = await cp.evaluate(() => { const d = document.getElementById('rvFigZoom'); const c = !d.open; document.getElementById('ptZoom').remove(); return c });
      assert(a.open && a.w > small * 1.4 && a.role === 'button' && a.n === '1 of 2' && t2 !== a.t && closed, `zoom: ${JSON.stringify({...a, small, t2, closed})}`);
      return `"${a.t}" opens ${Math.round(a.w)} px wide (was ${Math.round(small)} px); → shows "${t2}"; Esc closes`;
    });
    await check('review: a diagram change request holds back the question and its paper', cp, async () => {
      const r = await cp.evaluate(() => {
        const q = B.questions.find(x => !x.dup_of && (B.figs ? Object.keys(B.figs).some(k => k.startsWith(x.doc + '_q')) : true)); if (!q) return {skip: true};
        const keep = reviews['q' + q.id];
        reviews['q' + q.id] = {status: 'approved', fig: {zz_test: 'approved'}};
        const ok1 = qState(q) === 'approved';
        reviews['q' + q.id] = {status: 'approved', fig: {zz_test: 'changes'}};
        const held = qState(q) !== 'approved', work = paperWork(q.doc).left.diagrams > 0;
        reviews['q' + q.id] = {status: 'approved', fig: {}, fig_done: {zz_test: 'req -> redrawn'}};   // redrawn, not yet approved again
        const held2 = qState(q) !== 'approved';
        reviews['q' + q.id] = {status: 'approved', fig: {zz_test: 'approved'}, fig_done: {zz_test: 'req -> redrawn'}};
        const ok2 = qState(q) === 'approved';
        if (keep === undefined) delete reviews['q' + q.id]; else reviews['q' + q.id] = keep;
        return {ok1, held, work, held2, ok2} });
      assert(!r.skip && r.ok1 && r.held && r.work && r.held2 && r.ok2, `diagram change request: ${JSON.stringify(r)}`);
      return 'approved question with a diagram change request: not approved (out of the Bank) and its paper has diagram work left';
    });
    await cp.context().close();
  }
  for (const role of ['viewer', 'none']) {
    const vp = await newPage(browser, base, seed, {width: 1280, theme: 'dark', role});
    await boot(vp, base);
    const verrs = () => { const e = takeErrs(vp); assert(!e.length, e.slice(0, 3).join(' | ')) };
    await check(`areas (${role}): no Curate anywhere`, vp, async () => {
      await vp.waitForFunction(() => EDITOR === false, null, {timeout: 15000});
      await vp.evaluate(() => { const b = [...document.querySelectorAll('#list .subrow[data-sel]:not(.none)')][0]; b && b.click() }); await settle(vp, 5000, 2);   // a subtopic, so bank cards are on screen
      const r = await navState(vp);
      const extra = await vp.evaluate(() => ({open: [...document.querySelectorAll('#list [data-open], .edonly')].filter(e => e.offsetWidth > 0).length, jobs: (() => { const j = document.querySelector('#jobs'); return !!j && !j.hidden && j.offsetWidth > 0 })(),
        rbar: !document.querySelector('#rbar').hidden, cards: document.querySelectorAll('#list .edonly').length}));
      verrs();
      assert(!r.sw, `the Teach | Curate switch shows for a ${role}`);
      assert(r.tabs.join('/') === 'Bank/Exams/Guide', `tabs for a ${role}: ${r.tabs.join('/')}`);
      assert(extra.cards > 0, 'no bank cards on screen to check for "Open in Review"');
      assert(!extra.jobs && !extra.rbar && !extra.open, `Curate pieces visible: jobs pills ${extra.jobs}, review bar ${extra.rbar}, ${extra.open} "Open in Review" link(s)`);
      return `tabs ${r.tabs.join('/')}; no switch or jobs pills; Open in Review hidden on ${extra.cards} cards`;
    });
    await check(`areas (${role}): Curate hashes go to #bank`, vp, async () => {
      const bad = [];
      for (const h of CURATE_HASHES) { await go(vp, '#guide'); await go(vp, h); const r = await vp.evaluate(() => ({hash: location.hash, view, bank: !document.querySelector('#bankView').hidden})); if (r.hash !== '#bank' || r.view !== 'bank' || !r.bank) bad.push(`${h}→${r.hash}/${r.view}`) }
      verrs(); assert(!bad.length, bad.join(' '));
      return `${CURATE_HASHES.length} Curate hashes → #bank`;
    });
    // stage 4 review, 15 Nov: the Guide must not point a viewer at Curate pages they cannot open
    await check(`areas (${role}): the Guide names no Curate page`, vp, async () => {
      await go(vp, '#guide'); await vp.evaluate(() => document.querySelector('[data-gpg="cat"]')?.click()); await settle(vp, 4000, 2);
      const t = await vp.evaluate(() => { document.querySelectorAll('#guideView details').forEach(d => d.open = true); return document.querySelector('#guideView').innerText });
      verrs();
      const hits = (t.match(/Review ›[^\n]{0,30}|checked by you/g) || []);
      assert(!hits.length, `the Guide still says: ${hits.slice(0, 3).join(' | ')}`);
      return `${t.length} chars, no "Review ›" or "checked by you"`;
    });
    await vp.context().close();
  }
  // a viewer opening a Curate link directly, and the phone menu without a Curate group
  const pp = await newPage(browser, base, seed, {width: 390, theme: 'light', role: 'viewer'});
  await check('areas (viewer): a Curate link and the phone menu', pp, async () => {
    await boot(pp, base, '#review/difficulty');
    await pp.waitForFunction(() => EDITOR === false, null, {timeout: 15000}); await settle(pp, 3000, 2);
    const r = await pp.evaluate(() => ({hash: location.hash, view, lv: !document.querySelector('#levelsView').hidden}));
    assert(r.hash === '#bank' && r.view === 'bank' && !r.lv, `#review/difficulty opened for a viewer: ${r.hash} (view ${r.view})`);
    await pp.click('#menuBtn'); await settle(pp, 1500, 2);
    const m = await pp.evaluate(() => ({heads: [...document.querySelectorAll('#mSheet .mh')].map(h => h.textContent), links: [...document.querySelectorAll('#mSheet a')].map(a => a.getAttribute('href'))}));
    const e = takeErrs(pp); assert(!e.length, e.join(' | '));
    assert(m.heads.join('/') === 'Teach' && m.links.join(' ') === '#bank #exams #guide', `viewer menu: ${m.heads.join('/')} · ${m.links.join(' ')}`);
    return `link → #bank; menu ${m.links.join(' ')}`;
  });
  await pp.context().close();
}

/* ---------------- Review: Inbox and one paper at a time (owner 13 Nov) ----------------
   Owner: "I think the next thing I want to do is refine the review process. It is just 7 tabs at the top and its not really clear the
   order / process." Chosen: "One paper at a time", "An 'Inbox' beside papers", "Calls → Check → Topics → Diagrams → Spot-check",
   "Merge into Review", "Your calls · Flagged · Topics · Diagrams · Spot-check". The fixture's workload (page_test_fixture.py WORKLOAD)
   leaves 3 papers with work: 1346 (+510) Your calls/Topics/Diagrams, 323 Flagged/Topics/Diagrams/Spot-check, 1601 Spot-check only. */
async function reviewFlow(browser, base, seed) {
  const page = await newPage(browser, base, seed, {width: 1280, theme: 'light'});
  await boot(page, base, '#review');
  const errs = () => { const e = takeErrs(page); assert(!e.length, e.slice(0, 3).join(' | ')) };
  const go = async h => { await page.evaluate(h => { location.hash = h }, h); await settle(page, 5000, 2) };
  const writes = async (n0, pre) => (await page.evaluate(() => window.__pt.log.slice())).slice(n0).filter(x => x.op === 'set' && x.k.startsWith(pre));
  const logN = () => page.evaluate(() => window.__pt.log.length);
  const track = () => page.evaluate(() => ({hash: location.hash, view, rfilter, pos: ridx, left: paperWork(rdoc).left, n: rlist.length,
    steps: [...document.querySelectorAll('#filters .tstep')].map(li => ({lab: li.querySelector('.lab').textContent, cls: li.className.replace('tstep ', ''), n: li.querySelector('.n')?.textContent || '', num: li.querySelector('.num').textContent})),
    help: document.querySelector('#stephelp')?.textContent || '', title: document.querySelector('#rtitle')?.textContent || '', back: document.querySelector('#rbar .rback')?.getAttribute('href'), toast: document.querySelector('#toast')?.textContent || ''}));

  await check('review: the Inbox summary', page, async () => {
    const r = await page.evaluate(() => {
      const W = [...allWork().values()].filter(w => w.n), card = k => document.querySelector(`#inboxBox [data-card="${k}"]`);
      // 23 Nov (Batch 12): copies carry the original's key (2022 NEAP is mostly 2022 Knox AT4), so only the paper's own questions count
      const ownKey = d => { const c = {}; B.questions.filter(q => String(q.doc) === d && q.key && !q.dup_of).forEach(q => { const p = q.key.replace(/-Q[^-]*$/, ''); c[p] = (c[p] || 0) + 1 }); return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || '' };   // the paper's own key: most of its questions carry it
      return {want: W.length, docs: W.map(w => w.doc).sort(), pc: Object.keys(B.docs).filter(d => B.docs[d].call && PCALL.list([d])[0].open).map(d => mainDoc(d)),
        // a paper imported after the fixture was taken has no review decision at all, so it has work (16 Nov: Batch 6). A decision that
        // reaches one of its questions only through a copy in another paper (shared key, e.g. 2023 Knox AT1 Q2(b) = 2021 HSC Q14,
        // 17 Nov Batch 8) is not the paper's own decision: only keys under the paper's own key count
        fresh: [...new Set(B.questions.map(q => String(q.doc)))].filter(d => !reviews['paper_' + d] && B.questions.filter(q => String(q.doc) === d && !q.dup_of).every(q => { const x = reviews['q' + q.id]; return !(x && (x.question_id == null || +x.question_id === q.id)) && !(q.key && reviews['k_' + q.key] && q.key.startsWith(ownKey(d) + '-')) })).map(d => mainDoc(d)).filter(d => [...allWork().values()].some(w => String(w.doc) === String(d))), rep: repOpen().length, lv: lvTodoN(), view, rbar: !document.querySelector('#rbar').hidden,
        pn: card('papers')?.querySelector('.ict')?.textContent, rows: [...document.querySelectorAll('#inboxBox .iprow')].map(a => ({href: a.getAttribute('href'), dots: a.querySelectorAll('.mtrack i').length, line: a.querySelector('.ipl').textContent})),
        // 17 Nov: a diagram redrawn from a change request and not approved again keeps its paper open (openFix)
        redo: [...new Set(B.questions.filter(q => !q.dup_of && (() => { const x = reviews['q' + q.id]; return x && x.status !== 'flagged' && Object.keys(x.fig_done || {}).some(k => !(x.fig || {})[k]) })()).map(q => String(mainDoc(q.doc))))],
        // 21 Nov (fixture refreshed to the live decisions): a paper with a flag or diagram change request still waiting for Claude has work too
        wait: [...new Set(B.questions.filter(q => !q.dup_of && (x => !!x && ((x.status === 'flagged' && !x.fixed) || Object.values(x.fig || {}).includes('changes')))(reviews['q' + q.id])).map(q => String(mainDoc(q.doc))))],
        all: card('papers')?.querySelector('a.imore')?.getAttribute('href'), grouped: !!card('papers')?.querySelector('.rv-bgs'), vis: [...document.querySelectorAll('#inboxBox .iprow')].filter(a => a.getClientRects().length).length,
        repDone: card('reports')?.classList.contains('idone'), repTxt: card('reports')?.innerText, lvDone: card('difficulty')?.classList.contains('idone'), lvTxt: card('difficulty')?.innerText, lvHref: card('difficulty')?.querySelector('a')?.getAttribute('href'),
        tab: document.querySelector('#todoN').textContent, sw: document.querySelector('#curN').textContent,
        recent: document.querySelector('#inboxBox .ifoot a')?.getAttribute('href'), lists: document.querySelectorAll('#inboxBox .ifoot select[data-lists] option').length};
    });
    errs(); assert(r.view === 'inbox' && !r.rbar, `#review opened view ${r.view} (bar shown ${r.rbar})`);
    // the fixture's workload is 1346, 323, 1601; every paper with an open call raised on it (open_decisions.json "paper_<doc>") has work too (owner 13 Nov)
    const wantDocs = [...new Set(['1346', '1601', '323', ...r.pc, ...r.fresh.map(String), ...r.redo, ...r.wait])].sort();
    assert(r.want === wantDocs.length && r.docs.join(',') === wantDocs.join(','), `papers with work: ${r.docs.join(',')} (want ${wantDocs.join(',')})`);
    // the card opens at least 8 papers (08_review.js SHOW; 17 Nov: whole batch groups, later groups as a header line), then "Show all papers"
    assert(r.pn === String(r.want) && (r.grouped ? r.rows.length === r.want && r.vis >= Math.min(8, r.want) : r.rows.length === Math.min(8, r.want)), `Papers card says ${r.pn}, ${r.rows.length} rows (${r.vis} open, grouped ${r.grouped}), want ${r.want} (${Math.min(8, r.want)} rows)`);
    assert(r.rows.every(x => x.dots === 5 && /^\d+ left · at (Your calls|Flagged|Topics|Diagrams|Spot-check)$/.test(x.line) && /^#review\/paper\/\d+$/.test(x.href)), `rows: ${JSON.stringify(r.rows)}`);
    assert(r.all === '#review/papers', `"Show all papers" goes to ${r.all}`);
    assert(r.rep === 0 && r.repDone && /Reports\s*nothing open/.test(r.repTxt), `Reports card with ${r.rep} open: done ${r.repDone} “${r.repTxt}”`);
    // 18 Nov: the spot-check takes, per topic, the 3 references most other parts were rated against (owner 14 Nov), so rating the
    // 1,337 unrated parts (owner 18 Nov) brought 10 new references into the plan: the card must match the count, done only at 0
    assert((r.lv === 0 ? r.lvDone && /check plan finished/.test(r.lvTxt) : !r.lvDone && r.lvTxt.includes(String(r.lv))) && r.lvHref === '#review/difficulty', `Difficulty card with ${r.lv} to check: done ${r.lvDone} “${r.lvTxt}” → ${r.lvHref}`);
    const tot = String(r.want + r.rep); assert(r.tab === tot && r.sw === tot, `Review tab count ${r.tab}, Curate switch count ${r.sw}; want ${tot}`);
    assert(r.recent === '#review/list/recent' && r.lists > 5, `foot: Recently approved → ${r.recent}, ${r.lists} other lists`);
    await page.selectOption('#inboxBox .ifoot select[data-lists]', 'all'); await settle(page, 4000, 2);
    const l = await page.evaluate(() => ({hash: location.hash, view, rfilter, rstatus, n: rlist.length, track: document.querySelector('#filters').offsetHeight}));
    errs(); assert(l.hash === '#review/list/all' && l.view === 'review' && l.rfilter === 'all' && l.rstatus === 'any' && l.n > 1000 && !l.track, `Other lists → ${l.hash} ${l.rfilter}/${l.rstatus}, ${l.n} questions, track ${l.track}px`);
    return `${r.want} papers (${r.rows.map(x => x.line).join('; ')}); reports and difficulty ticked; tab and switch ${tot}; Other lists → All questions`;
  });

  // owner 17 Nov: "Review: group 'Papers to review' by batch, oldest first ('Batch 4 · 7 of 9 cleared'); papers waiting on a Your
  // call marked as such. Ordered, not locked." The batches are worked out here from the live data/inventory.json (finished batches
  // and lane batches, imported papers only), apart from the page's PQ.batchOf; cleared = Review's own paperWork, n 0.
  await check('review: Papers to review grouped by batch, oldest first, "N of M cleared", your-call marker', page, async () => {
    await go('#review');
    const inv = JSON.parse(fs.readFileSync(path.join(SITE, 'data/inventory.json'), 'utf8')), st = new Map();
    for (const g of inv.groups) for (const p of g.papers) st.set(p.id, p);
    // 23 Nov (Standard batch 1): batches are per lane (course + year); a batch is lane + number, named by the lane once two lanes have
    // imported batches; groups sort by number, then lane (the page's lane order)
    const bOf = new Map(), lanesUsed = new Set();
    for (const L of inv.lanes) {
      const lk = L.course + '_' + L.yl;
      const put = (n, ids) => ids.forEach(i => { const p = st.get(i); if (p && p.st === 'imported') { lanesUsed.add(lk); (p.f || [p.id]).forEach(d => bOf.set(String(d), {lk, n})) } });
      (L.done || []).forEach(d => put(d.n, d.ids)); (L.batches || []).forEach((ids, k) => put(L.first + k, ids));
    }
    const r = await page.evaluate(() => ({bo: Object.fromEntries([...(PQ.batchOf() || new Map()).entries()].map(([d, b]) => [d, {key: b.key, name: b.name, o: b.o}])),
      papers: [...allWork().values()].sort(workOrder).map(w => ({doc: String(w.doc), ids: docIds(w.doc).map(String), n: w.n, call: w.left.decide})),
      groups: [...document.querySelectorAll('#inboxBox [data-card="papers"] .rv-bg')].map(g => ({batch: g.dataset.batch, head: g.querySelector('.rv-bgh').textContent, tag: g.tagName, open: g.open,
        rows: [...g.querySelectorAll('.iprow')].map(a => ({doc: a.getAttribute('href').split('/').pop(), mark: a.querySelector('.rv-call')?.textContent || ''}))}))}));
    errs();
    const want = new Map(), meta = new Map(), multi = lanesUsed.size > 1;
    for (const p of r.papers) {
      const d = p.ids.find(x => bOf.get(x)), b = d ? bOf.get(d) : null, lb = d ? r.bo[d] : null, k = b ? lb.key + ':' + b.n : '';
      if (!want.has(k)) { want.set(k, []); meta.set(k, b ? {n: b.n, o: lb.o, name: lb.name} : null) } want.get(k).push(p) }
    const order = [...want.keys()].sort((a, b) => a === '' ? -1 : b === '' ? 1 : meta.get(a).n - meta.get(b).n || meta.get(a).o - meta.get(b).o);
    const heads = order.map(k => { const ps = want.get(k), m = meta.get(k); return `${k === '' ? 'Before batches' : (multi ? m.name + ' · ' : '') + 'Batch ' + m.n} · ${ps.filter(p => !p.n).length} of ${ps.length} cleared` });
    assert(r.groups.length === order.length && r.groups.map(g => g.head).join(' | ') === heads.join(' | '), `headers ${JSON.stringify(r.groups.map(g => g.head))}, want ${JSON.stringify(heads)}`);
    assert(r.groups.every((g, i) => g.batch === String(order[i])), `batch order ${r.groups.map(g => g.batch)} (want ${order})`);
    for (const [i, g] of r.groups.entries()) {
      const todo = want.get(order[i]).filter(p => p.n);
      assert(g.rows.map(x => x.doc).join() === todo.map(p => p.doc).join(), `${g.head}: rows ${g.rows.map(x => x.doc)} (want ${todo.map(p => p.doc)}, in the list's order)`);
      assert(todo.length ? g.tag === 'DETAILS' : g.tag === 'DIV', `${g.head}: a ${g.tag} (a group with nothing left is its header line only)`);
      for (const x of g.rows) { const p = todo.find(p => p.doc === x.doc); assert(p.call ? x.mark === 'waiting on your call' : x.mark === '', `${x.doc}: ${p.call} open calls, marker “${x.mark}”`) }
    }
    const marked = r.groups.flatMap(g => g.rows).filter(x => x.mark);
    assert(marked.some(x => x.doc === '1346'), `1346 has open Your calls in the fixture but no marker (marked: ${marked.map(x => x.doc)})`);
    // ordered, not locked: a closed group opens and its rows open their paper
    const closed = r.groups.find(g => g.tag === 'DETAILS' && !g.open);
    if (closed) { await page.click(`#inboxBox details.rv-bg[data-batch="${closed.batch}"] > summary`); const o = await page.evaluate(b => document.querySelector(`#inboxBox details.rv-bg[data-batch="${b}"]`).open, closed.batch); assert(o, `${closed.head} did not open`) }
    const busy = r.groups.find(g => g.rows.length && g.open && g.batch !== '');
    if (busy) { await page.click(`#inboxBox .rv-bg[data-batch="${busy.batch}"] .iprow`); await settle(page, 4000, 2);
      const h = await page.evaluate(() => location.hash); assert(h.startsWith('#review/paper/' + busy.rows[0].doc), `a ${busy.head} row opened ${h}`); await go('#review') }
    return `${r.groups.map(g => g.head + (g.rows.length ? ` (${g.rows.length} open)` : '')).join('; ')}; marked ${marked.map(x => x.doc).join(', ')}`;
  });
  // the checker (an editor who is not the owner) gets the same groups: the Inbox fetches data/inventory.json for an editor
  {
    const ck = await newPage(browser, base, seed, {width: 1280, theme: 'light', role: 'checker'});
    await boot(ck, base, '#review');
    await check('review (checker): Papers to review grouped by batch', ck, async () => {
      const r = await ck.evaluate(() => ({hash: location.hash, heads: [...document.querySelectorAll('#inboxBox .rv-bg .rv-bgh')].map(h => h.textContent)}));
      const o = await page.evaluate(() => [...document.querySelectorAll('#inboxBox .rv-bg .rv-bgh')].map(h => h.textContent));
      const e = takeErrs(ck); assert(!e.length, e.slice(0, 3).join(' | '));
      assert(r.hash === '#review' && r.heads.length && r.heads.join(' | ') === o.join(' | '), `checker: ${JSON.stringify(r)}; owner: ${JSON.stringify(o)}`);
      return r.heads.join('; ');
    });
    await ck.context().close();
  }

  await check('review: papers list (#papers) with tracks opens a paper', page, async () => {
    await go('#papers');
    let r = await page.evaluate(() => ({hash: location.hash, view, rows: document.querySelectorAll('#ptable tbody tr').length, tracks: document.querySelectorAll('#ptable tbody .mtrack').length,
      todo: [...document.querySelectorAll('#ptable tbody tr')].filter(tr => /left · at/.test(tr.innerText)).map(tr => tr.dataset.flow).sort(), want: [...allWork().values()].filter(w => w.n).map(w => w.doc).sort(), cols: [...document.querySelectorAll('#ptable thead th')].map(t => t.textContent.replace(/[▲▼]/, '').trim()), back: document.querySelector('#papersView > a.rback')?.getAttribute('href'),
      filters: ['#pfQ', '#pfYear', '#pfTask', '#pfSrc', '#pfProg'].filter(s => document.querySelector(s)).length}));
    errs(); assert(r.hash === '#review/papers' && r.view === 'papers', `#papers → ${r.hash} (view ${r.view})`);
    assert(r.rows > 40 && r.tracks === r.rows && r.todo.join(',') === r.want.join(',') && ['1346', '1601', '323'].every(d => r.todo.includes(d)), `${r.rows} rows, ${r.tracks} tracks, with work: ${r.todo.join(',')} (Inbox: ${r.want.join(',')})`);
    assert(['Paper', 'Review', 'Questions', 'Marks', 'Approved', 'MCQ', 'Short answer', 'Type', 'Source'].every(c => r.cols.includes(c)) && r.filters === 5 && r.back === '#review', `columns ${r.cols.join('/')}, ${r.filters} filters, back ${r.back}`);   // the old Papers tab's columns and filters stay
    await page.selectOption('#pfProg', 'todo'); await settle(page, 3000, 2);
    const nTodo = await page.evaluate(() => document.querySelectorAll('#ptable tbody tr').length);
    await page.selectOption('#pfProg', ''); await settle(page, 2000, 2);
    assert(nTodo === r.want.length, `"Review work left" shows ${nTodo} rows, want ${r.want.length}`);
    await page.click('#ptable tbody tr[data-flow="1346"] td.num'); await settle(page, 5000, 2);
    r = await track(); errs();
    assert(r.hash === '#review/paper/1346/calls' && r.view === 'review' && r.rfilter === 'decide', `row click opened ${r.hash} (${r.rfilter})`);
    return `${r.steps.length} steps; ${nTodo} papers with work; row → ${r.hash}`;
  });

  await check('review: the paper track (order, names, counts, what to do here)', page, async () => {
    await go('#review/paper/323');
    const r = await track(); errs();
    assert(r.hash === '#review/paper/323/flagged' && r.rfilter === 'check', `#review/paper/323 opened ${r.hash} (${r.rfilter}): the first step with work is Flagged`);
    assert(r.steps.map(x => x.lab).join(' · ') === 'Your calls · Flagged · Topics · Diagrams · Spot-check', `track: ${r.steps.map(x => x.lab).join(' · ')}`);
    const K = ['decide', 'check', 'tags', 'diagrams', 'sample'];
    assert(r.steps.every((x, i) => x.n === (r.left[K[i]] ? String(r.left[K[i]]) : '')), `counts ${r.steps.map(x => x.n).join('/')} vs ${JSON.stringify(r.left)}`);
    assert(/\bcur\b/.test(r.steps[1].cls) && !/\bcur\b/.test(r.steps[0].cls) && /none/.test(r.steps[0].cls) && r.steps.slice(2).every(x => /todo/.test(x.cls)), `states ${r.steps.map(x => x.cls).join(' | ')}`);
    assert(/^2\. Flagged\. /.test(r.help) && /source page/.test(r.help), `help line “${r.help}”`);
    assert(/2024 Caringbah High School AT4/.test(r.title) && r.back === '#review', `title “${r.title}”, back ${r.back}`);
    await page.click('#filters .step[data-f="diagrams"]'); await settle(page, 5000, 2);
    const d = await track(); errs();
    assert(d.hash === '#review/paper/323/diagrams' && d.rfilter === 'diagrams' && /\bcur\b/.test(d.steps[3].cls) && /diagrams? left/.test(d.help), `Diagrams step: ${d.hash} ${d.rfilter} “${d.help.slice(0, 60)}”`);
    return `${r.steps.map(x => x.lab + (x.n ? ' ' + x.n : ' ' + x.num)).join(' → ')}`;
  });

  await check('review: a step at 0 moves on to the next step with work (keys)', page, async () => {
    await go('#review/paper/323/flagged');
    const n = (await track()).left.check, n0 = await logN();
    // 24 Nov flake: decide() awaits FRESH.block(), which fetches data/version.json when the last check is over 15 s old; an A pressed
    // during that fetch still sees the same question and approves it again, so one Flagged question was left. Wait for each A to land
    // (the shown question or the step changes) before the next, as a person would see it move on
    const at = () => page.evaluate(() => location.hash + '|' + (rlist[ridx]?.id ?? ''));
    let t;
    for (let i = 0; i < n; i++) { const a0 = await at(); await page.keyboard.press('a');
      await page.waitForFunction(a0 => location.hash + '|' + (rlist[ridx]?.id ?? '') !== a0, a0, {timeout: 5000}); t = await page.evaluate(() => document.querySelector('#toast').textContent); }
    await settle(page, 3000, 2);
    const r = await track(); errs();
    const w = await writes(n0, 'reviews/k_');   // Fix 2: by key
    assert(w.length === n && w.every(x => x.v.status === 'approved'), `${w.length} approvals written for ${n} Flagged questions`);
    assert(r.hash === '#review/paper/323/topics' && r.rfilter === 'tags' && /\bcur\b/.test(r.steps[2].cls) && /done/.test(r.steps[1].cls), `after the last Flagged: ${r.hash} (${r.rfilter}), states ${r.steps.map(x => x.cls).join('|')}`);
    assert(t === 'Flagged done → Topics', `toast “${t}”`);
    await page.keyboard.press('k'); await sleep(200);
    const k = await page.evaluate(() => ridx);
    assert(k === 1 || r.n < 2, `K did not move on (ridx ${k})`);
    await page.keyboard.press('j'); await sleep(200);
    return `${n} × A: ${t}; K/J move within Topics`;
  });

  await check('review: spot-check approves the rest of the paper, then the paper is done', page, async () => {
    await go('#review/paper/1601');
    await page.evaluate(() => { window.__inbox0 = [...allWork().values()].filter(w => w.n).length });
    let r = await track(); errs();
    assert(r.hash === '#review/paper/1601/spot-check' && r.rfilter === 'sample' && r.left.sample === 3, `opened ${r.hash}, ${JSON.stringify(r.left)}`);
    const n0 = await logN();
    for (let i = 0; i < 3; i++) { await page.keyboard.press('a'); await sleep(150) }
    await settle(page, 3000, 2);
    r = await track();
    const btn = await page.evaluate(() => document.querySelector('#rout [data-paperok]')?.textContent || '');
    errs(); assert(r.rfilter === 'sample' && r.left.sample === 1 && r.steps[4].n === '1', `after the sample: ${r.rfilter}, ${JSON.stringify(r.left)}`);   // "approve the rest" is the step's last item
    assert(/Approve the other 8 questions in this paper/.test(btn), `button “${btn}”`);
    await page.click('#rout [data-paperok]'); await settle(page, 3000, 2);
    r = await track();
    const w = await writes(n0, 'reviews/'), pk1601 = await page.evaluate(() => RKEY.pdoc(1601));   // Fix 2: p_<paper key>
    const done = await page.evaluate(() => ({before: window.__inbox0, pdone: document.querySelector('#rout .ppdone')?.innerText || '', next: document.querySelector('#rout .ppdone a.primary')?.getAttribute('href'), ok: paperOK('1601'), inbox: [...allWork().values()].filter(w => w.n).length}));
    errs(); assert(w.filter(x => x.k.startsWith('reviews/k_')).length === 3 && w.some(x => x.k === 'reviews/' + pk1601 && x.v.status === 'approved'), `writes: ${w.map(x => x.k).join(' ')}`);
    assert(done.ok && /is done/.test(done.pdone) && /^#review\/paper\/\d+$/.test(done.next || ''), `paper done panel “${done.pdone.slice(0, 80)}”, next ${done.next}`);
    assert(/done$/.test(r.toast) || /approved/.test(r.toast), `toast “${r.toast}”`);
    assert(r.steps.every(x => /done|none/.test(x.cls)) && done.inbox === done.before - 1, `track ${r.steps.map(x => x.cls).join('|')}; Inbox papers ${done.inbox}`);
    return `3 sample approvals + paper_1601; ${done.pdone.split('\n')[0]}; Inbox now ${done.inbox} papers`;
  });
  // independent review 13 Nov: a finished paper can still be browsed; dots match the big track; lists reach every paper; odd list names settle
  await check('review: done paper browse, mini-track dots, Other lists across papers', page, async () => {
    await page.click('#rout .ppdone [data-browse]'); await settle(page, 4000, 2);
    const b = await page.evaluate(() => ({hash: location.hash, rdoc, docs: [...new Set(rlist.map(q => String(q.doc)))], n: rlist.length, track: document.querySelector('#filters').children.length}));
    errs(); assert(b.hash === '#review/list/all' && b.rdoc === '1601' && b.docs.join() === '1601' && b.n > 5 && !b.track, `"See its questions" → ${b.hash}, paper ${b.rdoc}, docs ${b.docs}, ${b.n} questions, ${b.track} track items left`);
    await go('#review/papers');
    const m = await page.evaluate(() => [...document.querySelectorAll('#ptable tbody tr[data-flow]')].map(tr => { const w = paperWork(tr.dataset.flow);
      return {doc: tr.dataset.flow, got: [...tr.querySelectorAll('.mtrack i')].map(i => i.className).join(','), want: STEPS.map(([k]) => w.left[k] ? (k === w.at ? 'cur' : 'todo') : (w.total[k] || (k === 'sample' && w.ready.length)) ? 'done' : 'none').join(',')} }));
    const off = m.filter(x => x.got !== x.want), c323 = m.find(x => x.doc === '323');
    errs(); assert(!off.length, `${off.length} mini tracks disagree, e.g. ${JSON.stringify(off[0])}`);
    assert(c323 && c323.got.split(',')[0] === 'none', `2024 Caringbah AT4 has no Your calls, its first dot is “${c323 && c323.got}”`);
    const opts = await page.evaluate(() => { location.hash = '#review'; return new Promise(r => setTimeout(() => r([...document.querySelectorAll('#inboxBox select[data-lists] option')].map(o => o.value)), 600)) });
    assert(opts.includes('decide') && opts.includes('diagrams'), `Other lists: ${opts.join(' ')}`);
    await page.evaluate(() => { document.querySelector('#docF').value = '' });   // the list's paper picker still holds 1601 from "See its questions"
    await go('#review/list/diagrams');
    const d = await page.evaluate(() => ({rfilter, n: rlist.length, docs: new Set(rlist.map(q => q.doc)).size, sel: document.querySelector('#rtitle select[data-lists]')?.value}));
    await go('#review/list/nosuchlist');
    const u = await page.evaluate(() => [location.hash, rfilter]);
    errs(); assert(d.rfilter === 'diagrams' && d.docs > 1 && d.sel === 'diagrams', `Diagrams list: ${JSON.stringify(d)}`);
    assert(u[0] === '#review/list/recent' && u[1] === 'recent', `#review/list/nosuchlist → ${u}`);
    return `browse ${b.n} questions of 1601; ${m.length} mini tracks match; Diagrams list ${d.n} questions over ${d.docs} papers`;
  });
  // owner 13 Nov ("isn't that the point of your calls? or is your decision different"): import notes are raised as Your calls,
  // never as loose notes. A call on a paper (open_decisions.json "paper_<doc>", bank docs[doc].call) and a call on a question
  // raised after its approval (q.decide_at) put the paper back in the Inbox, its papers-list row and its Your calls step;
  // answering clears them and keeps the earlier approval. Live paper calls are checked as they are; the question call is injected.
  await check('review: calls raised after approval (paper and question) show in Your calls, the papers list and the Inbox', page, async () => {
    const live = await page.evaluate(() => Object.keys(B.docs).filter(d => B.docs[d].call && PCALL.list([d])[0].open).map(d => mainDoc(d)));
    const qc = await page.evaluate(() => { const busy = new Set([...allWork().values()].filter(w => w.n).map(w => w.doc));
      const q = B.questions.find(q => !q.dup_of && reviews['q' + q.id]?.status === 'approved' && !busy.has(mainDoc(q.doc)) && !q.decide);
      q.decide = 'Test call raised after approval'; q.decide_at = new Date().toISOString(); return {id: q.id, doc: mainDoc(q.doc)} });
    await go('#review');
    const ib = await page.evaluate(() => ({W: Object.fromEntries([...allWork().values()].filter(w => w.n).map(w => [w.doc, w.left.decide])), card: document.querySelector('#inboxBox [data-card="papers"] .ict')?.textContent, tab: document.querySelector('#todoN').textContent,
      rows: Object.fromEntries([...document.querySelectorAll('#inboxBox .iprow')].map(a => [a.getAttribute('href').split('/').pop(), a.querySelector('.ipl').textContent]))}));
    errs();
    for (const d of [...live, qc.doc]) assert(ib.W[d] >= 1 && (!ib.rows[d] || /at Your calls/.test(ib.rows[d])), `paper ${d} not counted in the Inbox under Your calls: ${JSON.stringify(ib)}`);
    assert(ib.card === String(Object.keys(ib.W).length) && ib.tab === ib.card, `Inbox card ${ib.card}, tab ${ib.tab}, papers with work ${Object.keys(ib.W).length}`);
    await go('#review/papers');
    const pl = await page.evaluate(ds => ds.map(d => document.querySelector(`#ptable tbody tr[data-flow="${d}"]`)?.innerText.replace(/\s+/g, ' ') || 'no row'), [...live, qc.doc]);
    assert(pl.every(t => /left · at Your calls/.test(t)), `papers list rows: ${pl.join(' | ')}`);
    const shown = [];
    for (const [i, d] of live.entries()) {
      await go('#review/paper/' + d);
      const r = await track();
      const card = await page.evaluate(d => ({n: document.querySelectorAll('#rout .pcall').length, txt: document.querySelector(`#rout .pcall[data-pcall="${d}"] p`)?.textContent, want: B.docs[d].call.text, approved: reviews['paper_' + d]?.status}), d);
      errs(); assert(r.hash === `#review/paper/${d}/calls` && r.rfilter === 'decide' && r.steps[0].n === String(r.left.decide) && r.left.decide >= 1 && /\bcur\b/.test(r.steps[0].cls), `paper ${d}: ${r.hash} ${r.rfilter}, track ${JSON.stringify(r.steps[0])}, left ${JSON.stringify(r.left)}`);
      assert(card.n >= 1 && card.txt === card.want, `paper ${d} call card: ${JSON.stringify(card)}`);
      const n0 = await logN();
      if (i % 2 === 0) await page.click(`#rout [data-pcok="${d}"]`);
      else { await page.click(`#rout [data-pcopen="${d}"]`); await page.fill(`#pcn-${d}`, 'Label it AT4'); await page.press(`#pcn-${d}`, 'Enter') }
      await settle(page, 3000, 2);
      const w = (await writes(n0, 'reviews/' + await page.evaluate(d => RKEY.pdoc(d), d))).pop(), left = await page.evaluate(d => paperWork(d).left.decide, d);
      errs(); assert(w && w.v.call && w.v.call.status === (i % 2 ? 'flagged' : 'approved') && (i % 2 ? w.v.call.note === 'Label it AT4' : true) && w.v.status === card.approved && left === r.left.decide - 1, `answer on ${d}: ${JSON.stringify(w && w.v)}, Your calls left ${left}`);
      shown.push(`${d} ${i % 2 ? 'typed answer' : 'kept'}`);
    }
    await go('#review/paper/' + qc.doc);
    const q = await page.evaluate(() => ({hash: location.hash, rfilter, id: rlist[ridx]?.id, call: [...document.querySelectorAll('#rout .callout')].map(c => c.textContent).join(' '), left: paperWork(rdoc).left.decide}));
    errs(); assert(q.hash === `#review/paper/${qc.doc}/calls` && q.rfilter === 'decide' && q.id === qc.id && /Needs your decision: Test call raised after approval/.test(q.call) && q.left === 1, `question call: ${JSON.stringify(q)}`);
    const n0 = await logN(); await page.keyboard.press('a'); await settle(page, 3000, 2);
    const w = (await writes(n0, 'reviews/' + await page.evaluate(id => RKEY.qdoc(B.questions.find(q => q.id === id)), qc.id))).pop(), after = await page.evaluate(d => ({left: paperWork(d).left.decide, inbox: [...allWork().values()].filter(w => w.n).length, docs: [...allWork().values()].filter(w => w.n).map(w => w.doc)}), qc.doc);
    errs(); assert(w && w.v.status === 'approved' && w.v.call_at >= (await page.evaluate(id => B.questions.find(q => q.id === id).decide_at, qc.id)) && after.left === 0, `answering the question call: ${JSON.stringify(w && w.v)}, left ${after.left}`);
    // 17 Nov: a live paper whose call is answered leaves the Inbox only if nothing else is open in it (a redraw waiting for its second check keeps it)
    const gone = Object.keys(ib.W).filter(d => !after.docs.map(String).includes(String(d)));
    assert(gone.includes(String(qc.doc)) && gone.every(d => [...live, qc.doc].map(String).includes(d)) && after.inbox === Object.keys(ib.W).length - gone.length, `Inbox papers after answering: ${after.inbox}, before ${Object.keys(ib.W).length}; live ${live}; qc ${qc.doc}; gone ${Object.keys(ib.W).filter(d => !after.docs.map(String).includes(String(d)))}`);
    return `paper calls ${shown.join(', ') || 'none open'}; question call on ${qc.doc} Q${qc.id}; Inbox ${Object.keys(ib.W).length} → ${after.inbox}`;
  });
  await page.context().close();

  // phone 390 px, both themes: Inbox and a paper fit, the track's open step is on screen, the what-to-do line shows
  for (const theme of ['light', 'dark']) {
    const pp = await newPage(browser, base, seed, {width: 390, theme});
    await boot(pp, base, '#review');
    await check(`review: Inbox and paper flow at 390 px (${theme})`, pp, async () => {
      const fit = () => pp.evaluate(() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth}));
      let f = await fit(); assert(f.sw <= f.cw + 1, `Inbox: horizontal scroll ${f.sw} > ${f.cw}`);
      // groups open until 8 rows show (08_review.js SHOW); since Batch 8 (17 Nov) 323's batch group can start folded: open it as a person would
      await pp.evaluate(() => { const d = document.querySelector('#inboxBox .iprow[href="#review/paper/323"]')?.closest('details'); if (d) d.open = true });
      await pp.click('#inboxBox .iprow[href="#review/paper/323"]'); await settle(pp, 5000, 2);
      f = await fit();
      const r = await pp.evaluate(() => { const c = document.querySelector('#filters .tstep.cur .step').getBoundingClientRect(), t = document.querySelector('#filters').getBoundingClientRect(), h = document.querySelector('#stephelp');
        return {hash: location.hash, cur: [Math.round(c.left), Math.round(c.right)], track: [Math.round(t.left), Math.round(t.right)], help: h.offsetHeight > 0 && getComputedStyle(h).display !== 'none', nums: [...document.querySelectorAll('#filters .num')].filter(n => n.offsetWidth > 0).length,
          hdr: Math.round(document.querySelector('header').getBoundingClientRect().height), bg: getComputedStyle(document.body).backgroundColor} });
      const e = takeErrs(pp); assert(!e.length, e.slice(0, 3).join(' | '));
      assert(r.hash === '#review/paper/323/flagged' && f.sw <= f.cw + 1, `${r.hash}: horizontal scroll ${f.sw} > ${f.cw}`);
      assert(r.cur[0] >= r.track[0] - 1 && r.cur[1] <= r.track[1] + 1 && r.nums === 5 && r.help, `open step ${r.cur} outside the track ${r.track}, ${r.nums} step numbers, help shown ${r.help}`);
      return `header ${r.hdr}px, 5 steps, open step on screen, bg ${r.bg}`;
    });
    await pp.context().close();
  }
}

/* ---------------- Processes page and header pills (owner 14 Nov: "need a pill for current jobs and queued jobs ... Can make that page processes") ----------------
   The fixture seeds progress/jobs (one real job + the interim "Queued: 5 tasks" pseudo-job) and progress/queue (1 running, 3 queued, 1 done). */
/* job 6 (owner 16 Nov: "I need a place to see ... what's in that night's automated tasks"): the Tonight card on Processes › Work */
async function tonight(browser, base, seed) {
  const s2 = {...seed, 'progress/night': {steps: [{id: 'restore', title: 'Restore the database from Drive'}, {id: 'scan', title: 'Rescan the exam folder', detail: 'Read only'}],
    skipped: [{title: 'Import queue', why: 'imports are paused (owner 16 Nov)'}], last: {at: new Date(Date.now() - 36e5).toISOString(), items: [{title: 'Rescan the exam folder', status: 'done', result: '3 new files recorded'}]}},
    'runs/rTEST1': {kind: 'cover_check', status: 'requested', papers: [1, 2, 3], at: new Date(Date.now() - 6e5).toISOString()}};
  const p = await newPage(browser, base, s2, {width: 1280, theme: 'light'});
  try {
    await boot(p, base, '#processes/work');
    await check('processes: the Tonight card lists the steps, a waiting request (removable), what is skipped and last night', p, async () => {
      await p.waitForSelector('#procBox .pr-night', {timeout: 10000});
      const r = await p.evaluate(() => { const c = document.querySelector('#procBox .pr-night'); return {txt: c.innerText, drop: !!c.querySelector('[data-night-drop="rTEST1"]'), n: c.querySelectorAll('.pqueue li').length} });
      const e = takeErrs(p); assert(!e.length, e.slice(0, 3).join(' | '));
      assert(r.n === 4 && /Restore the database/.test(r.txt) && /Cover-page check: 3 papers/.test(r.txt) && /Skipped: imports are paused/.test(r.txt) && /Last night/.test(r.txt), `card: ${r.n} rows; ${r.txt.slice(0, 200)}`);
      assert(r.drop, 'no Remove button on the waiting request');
      const n0 = await p.evaluate(() => window.__pt.log.length);
      await p.click('[data-night-drop="rTEST1"]'); await settle(p, 3000, 2);
      const w = (await p.evaluate(() => window.__pt.log.slice())).slice(n0).filter(x => x.op === 'set' && x.k === 'runs/rTEST1');
      const after = await p.evaluate(() => !!document.querySelector('[data-night-drop="rTEST1"]'));
      assert(w.length && w[w.length - 1].v.status === 'cancelled' && !after, `Remove: ${JSON.stringify(w.map(x => x.v.status))}, still listed ${after}`);
      return '2 steps, 1 request (Remove → runs/rTEST1 cancelled, gone from the card), 1 skipped, last night shown';
    });
  } finally { await p.context().close() }
}

async function processes(browser, base, seed) {
  const qd = (seed['progress/queue'] || {}).items || [], jd = (seed['progress/jobs'] || {}).jobs || [];
  const wantRun = jd.filter(j => !/^\s*queued\b/i.test(j.name)).length + qd.filter(x => x.status === 'running').length;
  const wantQ = qd.filter(x => (x.status || 'queued') === 'queued').sort((a, b) => a.order - b.order).map(x => x.title);
  const page = await newPage(browser, base, seed, {width: 1280, theme: 'light'});
  await boot(page, base, '#import');
  const errs = () => { const e = takeErrs(page); assert(!e.length, e.slice(0, 3).join(' | ')) };
  await check('processes: #import goes to #processes/papers', page, async () => {
    const r = await page.evaluate(() => ({hash: location.hash, view, shown: !document.querySelector('#processesView').hidden, cur: document.querySelector('.views a[aria-current="page"]')?.textContent.trim(),
      old: !!document.querySelector('.views a[href="#import"]'), tab: document.querySelector('#vProcesses')?.textContent.trim(), pane: !document.querySelector('#procPapers').hidden}));
    errs(); assert(r.hash === '#processes/papers' && r.view === 'processes' && r.shown && r.pane, `#import landed on ${r.hash} (view ${r.view}, Papers pane ${r.pane})`);   // owner 13 Nov: the import dashboard is in Papers › Import history
    assert(r.cur === 'Processes' && r.tab === 'Processes' && !r.old, `the nav says “${r.cur}”, an Import link remains: ${r.old}`);
    return 'alias → Papers tab; nav reads Processes';
  });
  // owner 13 Nov: "so can we sync the number on the bank and the processes pls"
  await check('processes: Import history counts the same papers and questions as the Bank', page, async () => {
    const r = await page.evaluate(() => { const t = [...document.querySelectorAll('#importBox .tile')].map(x => [x.querySelector('span')?.textContent, x.querySelector('b')?.textContent]);
      const g = l => (t.find(x => x[0] === l) || [])[1]; return {p: g('papers in the Bank'), q: g('questions in the Bank'), s: bankStats()} });
    errs(); assert(r.p === String(r.s.papers) && r.q === r.s.questions.toLocaleString(), `Import history says ${r.p} papers / ${r.q} questions, the Bank ${r.s.papers} / ${r.s.questions}`);
    return `${r.p} papers, ${r.q} questions in both`;
  });
  // owner 13 Nov: "The process page feels a bit bloated now" -> "Two tabs: Work | Papers"
  await check('processes: Work | Papers switch and hashes', page, async () => {
    const st = () => page.evaluate(() => ({hash: location.hash, work: !document.querySelector('#procWork').hidden, papers: !document.querySelector('#procPapers').hidden,
      pressed: document.querySelector('#procSw button[aria-pressed="true"]')?.dataset.ptab, cls: document.querySelector('#procSw').className}));
    const go = async h => { await page.evaluate(h => { location.hash = h }, h); await settle(page, 3000, 2) };
    await go('#bank'); await go('#processes');
    let r = await st(); assert(r.hash === '#processes/papers' && r.papers && !r.work && r.pressed === 'papers', `#processes should reopen the last tab (Papers): ${JSON.stringify(r)}`);
    assert(r.cls === 'areasw', `the switch should reuse the Teach | Curate styles (.areasw), has “${r.cls}”`);
    await page.click('#procSw button[data-ptab="work"]'); await settle(page, 3000, 2);
    r = await st(); assert(r.hash === '#processes/work' && r.work && !r.papers && r.pressed === 'work', `Work button: ${JSON.stringify(r)}`);
    const sl = await page.evaluate(async () => { await new Promise(z => setTimeout(z, 400)); const s = document.querySelector('#procSw .aslider').getBoundingClientRect(), b = document.querySelector('#procSw button[aria-pressed="true"]').getBoundingClientRect(); return {dx: Math.abs(s.left - b.left), dw: Math.abs(s.width - b.width)} });
    assert(sl.dx < 1.5 && sl.dw < 1.5, `the switch highlight is off Work by ${sl.dx.toFixed(1)} / ${sl.dw.toFixed(1)} px`);
    await go('#bank'); await go('#processes'); r = await st(); assert(r.hash === '#processes/work' && r.work, `#processes after Work: ${r.hash}`);
    await page.evaluate(() => localStorage.removeItem('qg_proc_tab')); await go('#bank'); await go('#processes');
    r = await st(); assert(r.hash === '#processes/work' && r.work, `#processes with nothing remembered should open Work: ${r.hash}`);
    await go('#processes/papers'); r = await st(); assert(r.papers && r.pressed === 'papers', `#processes/papers: ${JSON.stringify(r)}`);
    await go('#processes/work'); errs();
    return '#processes → last tab (default Work); #processes/work, #processes/papers; switch slides';
  });
  await check('processes: running and queued pills', page, async () => {
    const r = await page.evaluate(() => [...document.querySelectorAll('#jobs .jp')].map(jp => ({cls: jp.className, txt: jp.querySelector('.jpill').textContent.trim(), href: jp.querySelector('.jpill').getAttribute('href'), pop: jp.querySelector('.jpop').textContent})));
    errs(); assert(r.length === 2, `${r.length} pills in the header`);
    assert(/\brun\b/.test(r[0].cls) && r[0].txt === `${wantRun} running`, `running pill says “${r[0].txt}”, expected “${wantRun} running”`);
    assert(/\bque\b/.test(r[1].cls) && r[1].txt === `${wantQ.length} queued`, `queued pill says “${r[1].txt}”, expected “${wantQ.length} queued”`);
    assert(r.every(x => x.href === '#processes/work'), 'a pill does not link to #processes/work');   // owner 13 Nov: the pills lead to Work
    assert(!/Queued: 5 tasks/.test(r[0].pop), 'the interim “Queued: …” pseudo-job still shows once the queue doc is loaded');
    await page.evaluate(() => { location.hash = '#bank' }); await settle(page, 3000, 2);
    await page.hover('#jobs .que .jpill'); await sleep(150);
    const pop = await page.evaluate(() => { const p = document.querySelector('#jobs .que .jpop'), r = p.getBoundingClientRect(); return {vis: getComputedStyle(p).display !== 'none' && r.width > 0, txt: p.innerText, in: r.left >= 0 && r.right <= innerWidth} });
    assert(pop.vis && pop.in, 'hovering the queued pill shows no list (or it runs off screen)');
    assert(wantQ.every(t => pop.txt.includes(t)), `the queued list is missing items: ${pop.txt.slice(0, 160)}`);
    // owner 13 Nov: "remove the open processes button there because clicking on the pill already takes you there"
    assert(!/Open Processes/.test(pop.txt) && !(await page.$('#jobs .jgo')), 'the popover still has an “Open Processes” link');
    await page.hover('#jobs .run .jpill'); await sleep(150);
    const rp = await page.evaluate(() => { const p = document.querySelector('#jobs .run .jpop'), r = p.getBoundingClientRect(); return {vis: getComputedStyle(p).display !== 'none' && r.width > 0, txt: p.innerText, in: r.left >= 0 && r.right <= innerWidth, bar: !!p.querySelector('.jbar')} });
    assert(rp.vis && rp.in, 'hovering the running pill shows no list (or it runs off screen)');
    assert(/Stage 2 of 4/.test(rp.txt) && rp.bar && /Started \d{1,2}:\d{2} [ap]m/.test(rp.txt) && /Est\. finish (?:\d{1,2} \w{3}, )?\d{1,2}:\d{2} [ap]m/.test(rp.txt), `running popover lacks step / Started / Est. finish: ${rp.txt.replace(/\s+/g, ' ').slice(0, 200)}`);
    await page.click('#jobs .run .jpill'); await settle(page, 3000, 2);
    const h = await page.evaluate(() => location.hash); errs();
    assert(h === '#processes/work', `clicking the running pill went to ${h}`);
    return `“${r[0].txt}”, “${r[1].txt}”; hover list ok; click → Processes`;
  });
  await check('processes: Work sections and order', page, async () => {
    const r = await page.evaluate(() => {
      const v = document.querySelector('#procWork'), vis = e => !!e && e.offsetWidth > 0 && e.offsetHeight > 0 && e.checkVisibility();
      const heads = [...v.querySelectorAll('#procBox h3, #procBox .pdone>summary, #nupH')].filter(vis).map(h => h.textContent.replace(/\s*\d+\s*$/, '').trim());
      return {heads, cards: [...v.querySelectorAll('.pcard')].map(c => ({name: c.querySelector('b').textContent, when: c.querySelector('.pwhen')?.textContent || ''})),
        queue: [...v.querySelectorAll('.pqueue li b')].map(b => b.textContent), asked: [...v.querySelectorAll('.pqueue .pasked')].map(a => getComputedStyle(a).fontStyle),
        doneOpen: v.querySelector('.pdone')?.open, doneDisp: getComputedStyle(v.querySelector('details.pdone')||v).display, doneBig: (()=>{const d=v.querySelector('details.pdone');if(!d)return 0;d.open=true;const m=Math.max(0,...[...d.querySelectorAll('li *')].map(e=>parseFloat(getComputedStyle(e).fontSize)));d.open=false;return m})(), doneN: v.querySelectorAll('.pdone li').length, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        runHeads: [...document.querySelectorAll('#processesView h2,#processesView h3')].filter(h => vis(h) && /^Running now/.test(h.textContent.trim())).length,
        // owner 13 Nov ("Two tabs: Work | Papers"): nothing of Papers on Work
        other: ['#invBox', '#importBox', '#procHist', '#prLanes'].filter(sel => vis(document.querySelector(sel))), title: document.querySelector('#processesView .prhead h2')?.textContent,
        gap: (() => { const s = [...v.querySelectorAll('#procBox .psec')]; return s.length > 1 ? Math.round(s[1].getBoundingClientRect().top - s[0].getBoundingClientRect().bottom) : 0 })()};
    });
    errs();
    // owner 13 Nov: "recently done looks so big": Review's paper-done styles leaked into Recently done (both were .pdone)
    assert(r.doneDisp === 'block' && r.doneBig <= 14, `Recently done layout: display ${r.doneDisp}, largest text ${r.doneBig}px`);
    assert(r.heads.join('|') === 'Running now|Queued|Recently done|Next up', `Work sections: ${r.heads.join(' | ')}`);
    assert(!r.other.length, `Papers content shows on Work: ${r.other.join(', ')}`);
    assert(r.title === 'Processes', `title “${r.title}”`);
    assert(r.cards.length === wantRun, `${r.cards.length} running cards, expected ${wantRun}`);
    assert(r.cards.some(c => /^\d+ min ago$|^just now$/.test(c.when)), `no “N min ago” started time: ${JSON.stringify(r.cards)}`);
    assert(JSON.stringify(r.queue) === JSON.stringify(wantQ), `queue order ${r.queue.join(' / ')}`);
    assert(r.asked.length === wantQ.length && r.asked.every(x => x === 'italic'), `owner quotes not in italics: ${r.asked}`);
    assert(r.doneOpen === false && r.doneN >= 1, 'Recently done should be a collapsed list');
    assert(r.sw <= r.cw + 1, `horizontal scroll ${r.sw} > ${r.cw}`);
    assert(r.runHeads === 1, `${r.runHeads} “Running now” headings on Processes, expected 1`);
    assert(r.gap <= 16, `sections ${r.gap}px apart (tightened to 14)`);
    return `${r.heads.join(' › ')}; ${r.cards.length} running, ${r.queue.length} queued, ${r.doneN} done (collapsed); nothing of Papers`;
  });
  // owner 13 Nov: "Is there a way to see how far long the running process is, start and finish time as well?"
  await check('processes: job step, start, est. finish and duration', page, async () => {
    const T = /(?:\d{1,2} \w{3}, )?\d{1,2}:\d{2} [ap]m/;   // a time past midnight carries its date ("14 Nov, 12:02 am")
    let r = await page.evaluate(() => ({cards: [...document.querySelectorAll('#procBox .pcard')].map(c => c.innerText.replace(/\s+/g, ' ')),
      done: [...document.querySelectorAll('#procBox .pdone li')].map(c => c.textContent.replace(/\s+/g, ' '))}));
    errs();
    const qc = r.cards.find(c => /Stage 2 of 4/.test(c));
    assert(qc && new RegExp('Started ' + T.source).test(qc) && new RegExp('Est\\. finish ' + T.source).test(qc) && !/Finished/.test(qc), `running card: ${qc || r.cards.join(' | ')}`);
    const dc = r.done.find(c => /Processes page/.test(c));
    assert(dc && new RegExp('Started ' + T.source).test(dc) && new RegExp('Finished ' + T.source).test(dc) && /took 1 h 12 min/.test(dc) && !/Est\. finish/.test(dc), `done row: ${dc}`);
    // not today: the date shows; times are in the viewer's local zone (the fixture writes +11:00)
    await page.evaluate(async () => { const q = JSON.parse(JSON.stringify(window.__pt.store.get('progress/queue'))); const it = q.items.find(x => x.status === 'running');
      const d = new Date(Date.now() - 2 * 86400000); d.setHours(9, 5, 0, 0); it.started = d.toISOString(); await db.doc('progress/queue').set(q) });
    await settle(page, 2000, 2);
    r = await page.evaluate(() => { const d = new Date(Date.now() - 2 * 86400000); d.setHours(9, 5, 0, 0);
      return {card: [...document.querySelectorAll('#procBox .pcard')].map(c => c.innerText.replace(/\s+/g, ' ')).find(c => /Stage 2 of 4/.test(c)), want: d.toLocaleDateString('en-AU', {day: 'numeric', month: 'short'}) + ', 9:05 am'} });
    assert(r.card && r.card.includes('Started ' + r.want), `an older start should read “Started ${r.want}”: ${r.card}`);
    return `running: ${qc.match(/Started [^·]+· Est\. finish \S+ [ap]m/)?.[0]}; done: ${dc.match(/took [^A-Z]+/)?.[0].trim()}; older start shows its date`;
  });
  await check('processes: empty states and hidden pills', page, async () => {
    await page.evaluate(async () => { await db.doc('progress/jobs').set({jobs: []}); await db.doc('progress/queue').set({items: [], updated: new Date().toISOString()}) });
    await settle(page, 2000, 2);
    const r = await page.evaluate(() => ({jobsHidden: document.querySelector('#jobs').hidden, pills: document.querySelectorAll('#jobs .jpill').length,
      empty: [...document.querySelectorAll('#procBox .pempty')].map(p => p.textContent.trim()), work: !document.querySelector('#procWork').hidden}));
    errs(); assert(r.jobsHidden && !r.pills, `pills still showing with nothing running or queued (${r.pills})`);
    assert(r.empty.length === 2 && r.empty.every(t => t.length > 5 && t.length < 80), `empty states: ${JSON.stringify(r.empty)}`);
    assert(r.work, 'the Work tab is no longer showing');
    return r.empty.join(' / ');
  });
  await page.context().close();
  // touch (owner 13 Nov): the first tap shows the list; a tap elsewhere closes it; a tap on the list, or a second tap on the pill, opens Processes
  const tp = await newPage(browser, base, seed, {width: 390, theme: 'dark', touch: true});
  await boot(tp, base, '#bank');
  const popState = sel => tp.evaluate(sel => { const p = document.querySelector(sel), r = p.getBoundingClientRect(); return {hash: location.hash, vis: getComputedStyle(p).display !== 'none' && r.width > 0, l: r.left, r: r.right, w: innerWidth, link: !!p.querySelector('.jgo'), txt: p.innerText} }, sel);
  await check('processes: pills on a touch phone', tp, async () => {
    await tp.tap('#jobs .que .jpill'); await sleep(200);
    const a = await popState('#jobs .que .jpop');
    assert(a.hash === '#bank' && a.vis, `first tap: hash ${a.hash}, list shown ${a.vis}`);
    assert(a.l >= 0 && a.r <= a.w, `the list runs off a ${a.w}px screen (${Math.round(a.l)}–${Math.round(a.r)})`);
    assert(!a.link && !/Open Processes/.test(a.txt), 'the popover still has “Open Processes”');
    await tp.touchscreen.tap(195, 600); await sleep(200);
    const c = await tp.evaluate(() => !document.querySelector('#jobs .jp.open'));
    assert(c, 'a tap elsewhere did not close the list');
    await tp.tap('#jobs .que .jpill'); await sleep(200);
    await tp.tap('#jobs .que .jpop'); await settle(tp, 3000, 2);
    const b = await tp.evaluate(() => ({hash: location.hash, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth}));
    assert(b.hash === '#processes/work', `a tap on the list went to ${b.hash}`); assert(b.sw <= b.cw + 1, `horizontal scroll ${b.sw} > ${b.cw}`);
    await tp.evaluate(() => { location.hash = '#bank' }); await settle(tp, 3000, 2);
    await tp.tap('#jobs .run .jpill'); await sleep(200);
    const r = await popState('#jobs .run .jpop');
    assert(r.vis && r.l >= 0 && r.r <= r.w, `running list at 390px: shown ${r.vis}, ${Math.round(r.l)}–${Math.round(r.r)}`);
    assert(/Started/.test(r.txt) && /Est\. finish/.test(r.txt), `running list has no times: ${r.txt.replace(/\s+/g, ' ').slice(0, 160)}`);
    await tp.tap('#jobs .run .jpill'); await settle(tp, 3000, 2);
    const h = await tp.evaluate(() => location.hash);
    const e = takeErrs(tp); assert(!e.length, e.join(' | '));
    assert(h === '#processes/work', `a second tap on the pill went to ${h}`);
    return 'tap shows the list (inside 390px, no link); tap elsewhere closes; tap on list or second tap → Processes';
  });
  await tp.context().close();
}

/* ---------------- Bank "Approved only" chip (owner 13 Nov: "is there a point in this showing if all questions are approvied?") ----------------
   Shown only when some questions are unapproved AND the viewer is an editor. A non-editor never sees unapproved questions, even with bankall=1. */
async function bankChip(browser, base, seed) {
  const state = p => p.evaluate(() => { const all = B.questions.filter(q => !q.dup_of), ok = all.filter(q => qState(q) === 'approved');
    return {chip: document.querySelectorAll('#bankView .bankall').length, all: all.length, ok: ok.length, shown: B.questions.filter(inBank).length,
      stat: +(document.querySelector('#bankView .stats .stat b')?.textContent.replace(/\D/g, '') || -1)} });
  const page = await newPage(browser, base, seed, {width: 1280, theme: 'light'});
  await boot(page, base, '#bank');
  await check('bank: approved-only chip for an editor', page, async () => {
    // the fixture may have every question approved: make every 7th one unapproved for this check
    await page.evaluate(() => { window.__qs = qState; const real = qState; if (B.questions.filter(q => !q.dup_of).every(q => real(q) === 'approved')) { qState = q => q.id % 7 ? real(q) : null; TOPICS = null; renderBank() } });
    await settle(page, 3000, 2);
    let r = await state(page);
    assert(r.ok < r.all, `could not make questions unapproved (${r.ok}/${r.all})`);
    assert(r.chip === 1, `editor with ${r.all - r.ok} unapproved: ${r.chip} chips`);
    await page.click('#bankView .bankall'); await settle(page, 3000, 2);
    r = await state(page); assert(r.shown === r.all && r.chip === 1, `include unapproved shows ${r.shown} of ${r.all}`);
    await page.click('#bankView .bankall'); await settle(page, 3000, 2);
    // every question approved: the chip goes
    await page.evaluate(() => { qState = () => 'approved'; TOPICS = null; renderBank() }); await settle(page, 3000, 2);
    const r2 = await state(page);
    await page.evaluate(() => { qState = window.__qs; TOPICS = null; renderBank() });
    const e = takeErrs(page); assert(!e.length, e.slice(0, 3).join(' | '));
    assert(r2.chip === 0, `all approved, but the chip still shows (${r2.chip})`);
    return `${r.ok} of ${r.all} approved: chip shown and toggles; all approved: hidden`;
  });
  await page.context().close();
  for (const role of ['viewer', 'none']) {
    const vp = await newPage(browser, base, seed, {width: 390, theme: 'light', role});
    await vp.addInitScript(() => { try { localStorage.setItem('bankall', '1') } catch (e) {} });
    await boot(vp, base, '#bank');
    await check(`bank (${role}): no approved-only chip, no unapproved questions`, vp, async () => {
      await vp.evaluate(() => { const real = qState; qState = q => q.id % 7 ? real(q) : null; TOPICS = null; renderBank() }); await settle(vp, 3000, 2);
      const r = await state(vp); const e = takeErrs(vp); assert(!e.length, e.slice(0, 3).join(' | '));
      assert(r.chip === 0, `a ${role} sees the approved-only chip`);
      assert(r.ok < r.all && r.shown === r.ok && r.stat === r.ok, `a ${role} with bankall=1 sees ${r.shown} questions (stat ${r.stat}), approved ${r.ok} of ${r.all}`);
      return `${r.shown} approved questions only`;
    });
    await vp.context().close();
  }
}

/* ---------------- Next up notes on Processes (owner 13 Nov: "add a place somewhere for me to write down what to flesh out next") ----------------
   db collection "notes", one doc per note {text, order, done, by, at}: add, ↑ ↓ and drag reorder, tick → collapsed Done, inline delete confirm. */
async function nextUp(browser, base, seed) {
  const notes = p => p.evaluate(() => [...window.__pt.store.entries()].filter(([k]) => k.startsWith('notes/')).map(([k, v]) => ({id: k.slice(6), ...v})).sort((a, b) => a.order - b.order));
  const openTexts = p => p.evaluate(() => [...document.querySelectorAll('#nupList > .nlist .ntext')].map(x => x.textContent));
  const page = await newPage(browser, base, seed, {width: 1280, theme: 'light'});
  await page.addInitScript(() => { window.__confirms = 0; window.confirm = () => { window.__confirms++; return true } });
  await boot(page, base, '#processes');
  const errs = () => { const e = takeErrs(page); assert(!e.length, e.slice(0, 3).join(' | ')) };
  await check('next up: card, empty state, add', page, async () => {
    const r = await page.evaluate(() => ({shown: !document.querySelector('#notesBox').hidden, h: document.querySelector('#nupH')?.textContent.trim(), empty: document.querySelector('#nupList .pempty')?.textContent.trim(),
      after: (() => { const w = document.querySelector('#procWork'), n = w.querySelector('#notesBox'), q = w.querySelector('#pQueH'); return location.hash === '#processes/work' && !!(n && q && (q.compareDocumentPosition(n) & 4)) && !w.querySelector('#importBox, #invBox') })()}));
    errs(); assert(r.shown && /^Next up/.test(r.h), `Next up card: shown ${r.shown}, heading “${r.h}”`);
    assert(r.empty === 'Ideas for what to build next. Claude reads this list.', `empty state “${r.empty}”`);
    assert(r.after, 'Next up is not on Work under the queue (or Work is not the default tab)');
    for (const t of ['Worksheets tab', 'Topic heat map', 'Bulk export']) { await page.fill('#nupIn', t); await page.click('#nupForm button[type=submit]'); await settle(page, 1500, 2) }
    const cleared = await page.evaluate(() => document.querySelector('#nupIn').value === '');
    await page.fill('#nupIn', '   '); await page.press('#nupIn', 'Enter'); await settle(page, 800, 2);
    const n = await notes(page); errs();
    assert(n.length === 3 && n.map(x => x.text).join('|') === 'Worksheets tab|Topic heat map|Bulk export', `notes in db: ${JSON.stringify(n.map(x => x.text))}`);
    assert(n.every(x => x.done === false && x.by === 'u_pagetest' && !isNaN(Date.parse(x.at)) && typeof x.order === 'number'), `note fields: ${JSON.stringify(n[0])}`);
    assert((await openTexts(page)).join('|') === 'Worksheets tab|Topic heat map|Bulk export', 'list order on screen');
    assert(cleared, 'the input was not cleared after Add');
    return '3 notes added (blank ignored); {text, order, done, by, at}';
  });
  await check('next up: reorder with ↑ ↓ and drag', page, async () => {
    await page.click('#nupList [data-nmove="1"][data-nid]'); await settle(page, 1500, 2);   // first note down
    let t = await openTexts(page); assert(t.join('|') === 'Topic heat map|Worksheets tab|Bulk export', `after ↓: ${t.join('|')}`);
    const ids = (await notes(page)).map(x => x.text); assert(ids.join('|') === 'Topic heat map|Worksheets tab|Bulk export', `db order after ↓: ${ids.join('|')}`);
    const last = page.locator('#nupList > .nlist > li').nth(2), first = page.locator('#nupList > .nlist > li').nth(0);
    await last.dragTo(first, {targetPosition: {x: 40, y: 3}}); await settle(page, 1500, 2);
    t = await openTexts(page); const d = (await notes(page)).map(x => x.text); errs();
    assert(t.join('|') === 'Bulk export|Topic heat map|Worksheets tab' && d.join('|') === t.join('|'), `after drag: screen ${t.join('|')}, db ${d.join('|')}`);
    return t.join(' › ');
  });
  await check('next up: tick done, inline delete', page, async () => {
    await page.click('#nupList > .nlist li:nth-child(1) .ntick'); await settle(page, 1500, 2);
    let r = await page.evaluate(() => ({open: [...document.querySelectorAll('#nupList > .nlist .ntext')].map(x => x.textContent), done: document.querySelector('#nupList details.ndone'), dn: [...document.querySelectorAll('#nupList details.ndone .ntext')].map(x => x.textContent)}));
    const n = await notes(page);
    assert(r.open.join('|') === 'Topic heat map|Worksheets tab' && r.dn.join('|') === 'Bulk export', `after tick: open ${r.open}, done ${r.dn}`);
    assert(await page.evaluate(() => !document.querySelector('#nupList details.ndone').open), 'the Done list should start collapsed');
    assert(n.find(x => x.text === 'Bulk export').done === true, 'tick not saved');
    await page.click('#nupList > .nlist li:nth-child(1) [data-ndel]'); await settle(page, 800, 2);
    r = await page.evaluate(() => document.querySelector('#nupList > .nlist li:nth-child(1) .ndelq')?.textContent || '');
    assert(/Delete\?/.test(r), `no inline confirm: “${r}”`);
    await page.click('#nupList [data-ndelno]'); await settle(page, 800, 2);
    assert((await notes(page)).length === 3, '“Keep” deleted the note');
    await page.click('#nupList > .nlist li:nth-child(1) [data-ndel]'); await page.click('#nupList [data-ndelok]'); await settle(page, 1500, 2);
    const left = (await notes(page)).map(x => x.text), conf = await page.evaluate(() => window.__confirms); errs();
    assert(left.join('|') === 'Worksheets tab|Bulk export' || left.sort().join('|') === 'Bulk export|Worksheets tab', `after delete: ${left}`);
    assert(conf === 0, `confirm() was called ${conf} times`);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); assert(sw <= 1, `horizontal scroll ${sw}px`);
    return 'ticked → Done (collapsed); Keep / Delete inline; no confirm()';
  });
  await page.context().close();
  // phone: the card fits 390px and the ↑ ↓ buttons work by tap
  const tp = await newPage(browser, base, seed, {width: 390, theme: 'dark', touch: true});
  await boot(tp, base, '#processes');
  await check('next up: phone 390px', tp, async () => {
    for (const t of ['A fairly long note about what to flesh out next, so it has to wrap on a phone screen', 'Short']) { await tp.fill('#nupIn', t); await tp.tap('#nupForm button[type=submit]'); await settle(tp, 1500, 2) }
    await tp.tap('#nupList [data-nmove="-1"]:not([disabled])'); await settle(tp, 1500, 2);
    const r = await tp.evaluate(() => { const b = document.querySelector('#notesBox').getBoundingClientRect(); return {t: [...document.querySelectorAll('#nupList > .nlist .ntext')].map(x => x.textContent), r: b.right, w: innerWidth,
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth} });
    const e = takeErrs(tp); assert(!e.length, e.join(' | '));
    assert(r.t[0] === 'Short', `↑ by tap: ${r.t.join(' | ')}`); assert(r.r <= r.w && r.sw <= r.cw + 1, `overflow at 390px: card right ${r.r}, scroll ${r.sw} > ${r.cw}`);
    return 'fits; ↑ works by tap';
  });
  await tp.context().close();
  // a viewer never gets the card or a write
  const vp = await newPage(browser, base, seed, {width: 1280, theme: 'light', role: 'viewer'});
  await boot(vp, base, '#bank');
  await check('next up (viewer): no card, no writes', vp, async () => {
    const r = await vp.evaluate(async () => { renderNotes(); const ok = await noteSet({id: 'nx', text: 'x', order: 1, done: false}, {}); return {hidden: document.querySelector('#notesBox').hidden, ok, w: window.__pt.log.filter(l => l.k.startsWith('notes/')).length} });
    assert(r.hidden && r.ok === false && r.w === 0, JSON.stringify(r));
    return 'hidden; noteSet refused';
  });
  await vp.context().close();
}

/* ======== Processes › Papers: lanes, batch panel, queue, Needs a check (owner 14 Nov, mockup A: "I like A's design much more") ========
   Own block (14 Nov, import-lanes round): replaces the 13 Nov papersQueue (import order, grid) and papersRun (Go) groups.
   The fixture's small inventory (tools/page_test_fixture.py sample_papers, served in place of data/inventory.json):
   summary adds up; lanes and their counts; the batch panel opens with 9 papers and Swap matches tools/batches.py apply_swaps;
   queue add / reorder / remove and Start the queue; Needs a check: Accept the proposed rules and place a paper; Import history
   collapsed; 390 px phone (lanes wrap, panel stacks); a viewer sees nothing, fetches nothing, writes nothing.
   Owner 14 Nov follow-ups (merge of import-lanes):
   - "Maybe remove the lock for now since I'm in charge of import": no limit text, no `limit` in the runs doc; "N batches are
     waiting for review" beside Start is information only (Start stays enabled).
   - "I would like to see how many of the batches have cleared checks on the import page too": the fixture's imported papers are
     real bank papers (page_test_fixture.py LANE_REVIEW): 1601 cleared ONLY through key docs (k_/p_), 323 with its decisions
     taken off; squares clr / wait, the lane line, the batch panel chips, and a live change from the reviews collection.
   - Needs a check rows: the cover + 3 question pages (fixture pack for 9140, placeholders for 9601), the in-page viewer
     (opens, ← / → step through 4, Esc closes, focus returns), the Drive link, the rules' course guess pre-picked.
   - the queue line "Batch 10" stays on one line at 1280 px. */
const LANE_STATUSES = ['imported', 'ready_current', 'ready_old', 'needs_check', 'held_y11', 'held_course', 'not_in_scope', 'duplicate'];
function laneTally(inv) {   // written apart from the page's model(), so the two can disagree
  const t = Object.fromEntries(LANE_STATUSES.map(s => [s, 0])); let n = 0;
  for (const g of inv.groups) for (const p of g.papers) { t[p.st]++; n++ }
  return {t, n, imported: t.imported, ready: t.ready_current + t.ready_old, check: t.needs_check, aside: t.held_y11 + t.held_course + t.not_in_scope + t.duplicate};
}
async function papersLanes(browser, base, seed, fx) {
  if (!fx || !fx.inventory || !fx.inventory.lanes) { await check('papers: fixture', null, async () => { throw new Error('work/page_test/fixture.json has no lanes inventory: run tools/page_test_fixture.py') }); return }
  const inv = fx.inventory, ck = fx.check || {manifest: {papers: {}}, packs: {}};
  const serveInv = async p => { p._inv = 0; await p.route(u => /\/data\/inventory\.json/.test(u.href), r => { p._inv++; return r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(inv)}) });
    await p.route(u => /\/data\/check_pages\.json/.test(u.href), r => r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(ck.manifest)}));
    await p.route(u => /\/data\/check\/\d+\.json/.test(u.href), r => { const k = new URL(r.request().url()).pathname.slice(1); return ck.packs[k] ? r.fulfill({status: 200, contentType: 'application/json', body: ck.packs[k]}) : r.fulfill({status: 404, body: ''}) }) };
  // owner 14 Nov: the imported fixture papers' review docs (1601 by key docs only, 323 with nothing): page_test_fixture.py lane_reviews
  const rv = fx.reviews || {drop: [], add: {}}, dropL = new Set(rv.drop);
  seed = {...Object.fromEntries(Object.entries(seed).filter(([k]) => !dropL.has(k))), ...rv.add};
  const docs = (p, c) => p.evaluate(c => [...window.__pt.store.entries()].filter(([k]) => k.startsWith(c + '/')).map(([k, v]) => ({k, ...v})), c);
  const tiles = p => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#prSum .pr-tile')].map(t => [t.dataset.k, {n: +t.querySelector('b').textContent.replace(/\D/g, ''), w: t.querySelector('span').textContent}])));
  const qtitles = p => p.evaluate(() => [...document.querySelectorAll('#prQueue .pr-qi b')].map(b => b.textContent));
  const page = await newPage(browser, base, seed, {width: 1280, theme: 'light'});
  await serveInv(page);
  await boot(page, base, '#processes/papers'); await settle(page, 3000, 2);
  const errs = () => { const e = takeErrs(page); assert(!e.length, e.slice(0, 3).join(' | ')) };
  // owner 14 Nov: "there seems to be some inconsistencies in paper numbers": one status per paper; the four numbers add up
  await check('papers: the summary adds up to the folder total', page, async () => {
    const L = laneTally(inv), r = await tiles(page), sub = await page.evaluate(() => document.querySelector('#ivSub').textContent);
    errs();
    assert(L.n === inv.totals.papers && LANE_STATUSES.every(s => L.t[s] === inv.totals[s]), `fixture totals ${JSON.stringify(inv.totals)} vs recount ${JSON.stringify(L.t)}`);
    assert(r.imported.n === L.imported && r.ready.n === L.ready && r.check.n === L.check && r.aside.n === L.aside, `tiles ${JSON.stringify(r)} (want ${L.imported} / ${L.ready} / ${L.check} / ${L.aside})`);
    assert(r.imported.n + r.ready.n + r.check.n + r.aside.n === L.n, 'the four numbers do not add up to the papers in the folder');
    assert(r.ready.w === 'ready to import · Year 12 Advanced' && r.check.w === 'need a check (year or course unknown)' && r.aside.w === 'held or not in scope', `tile words ${JSON.stringify(r)}`);
    assert(new RegExp(`^${L.n} papers in the shared folder \\(${inv.docs} files\\) · last scan .+ · 1 new since$`).test(sub), `top line: “${sub}”`);
    // the same rule on the live inventory: every paper has one status, they add up, and the lanes hold only ready papers
    const live = JSON.parse(fs.readFileSync(path.join(SITE, 'data/inventory.json'), 'utf8')), LL = laneTally(live);
    assert(LL.n === live.totals.papers && LANE_STATUSES.every(s => LL.t[s] === (live.totals[s] || 0)), `live inventory: statuses ${JSON.stringify(LL.t)} vs totals ${JSON.stringify(live.totals)}`);
    return `fixture ${L.imported} + ${L.ready} + ${L.check} + ${L.aside} = ${L.n}; live ${LL.imported} + ${LL.ready} + ${LL.check} + ${LL.aside} = ${LL.n}`;
  });
  await check('papers: lanes render with the right counts', page, async () => {
    const r = await page.evaluate(() => ({lanes: [...document.querySelectorAll('#prLanes .pr-lane:not(.pr-chk)')].map(l => ({name: l.querySelector('.pr-lname b').textContent, sub: l.querySelector('.pr-lname small').textContent,
        sq: [...l.querySelectorAll('.pr-sq .pr-b')].map(b => b.className.replace('pr-b ', '') + ':' + b.dataset.prb.split(':')[1]), acts: [...l.querySelectorAll('.pr-lacts button')].map(b => b.textContent)})),
      chk: document.querySelector('#prLanes .pr-chk .pr-lname small')?.textContent, chkActs: [...document.querySelectorAll('#prLanes .pr-chk .pr-lacts > *')].map(b => b.textContent),
      lock: document.querySelector('#prLock > summary')?.textContent, lockRows: [...document.querySelectorAll('#prLock li')].map(li => [...li.children].map(c => c.textContent.trim()).join(' ')),
      cps: document.querySelector('#prCopies > summary')?.textContent, cpRow: [...(document.querySelector('#prCopies li[data-cp="9701"]')?.children || [])].map(c => c.textContent.trim()).join(' '),
      cpLinks: [...document.querySelectorAll('#prCopies li[data-cp="9701"] a')].map(a => a.href), cpLis: document.querySelectorAll('#prCopies li').length, cpParts: [...document.querySelectorAll('#prCopies .pr-cpp')].map(d => d.dataset.cpp + ':' + d.querySelectorAll('li').length).join('|'),
      legend: [...document.querySelectorAll('#prLanes .pr-legend span')].map(s => s.textContent), old: ['#ivGrid', '#ivGo', '#ivRun', '#ivPick', '#ivBy', '#ivStats'].filter(s => document.querySelector(s)),
      order: (() => { const at = s => document.querySelector(s); return ['#ivSub', '#prSum', '#prLanes', '#prQueue', '#procHist'].every((s, i, a) => !i || (at(a[i - 1]).compareDocumentPosition(at(s)) & 4)) })()}));
    errs();
    assert(r.order, 'Papers is not: top line, summary, lanes, queue, Import history');
    assert(!r.old.length, `old Papers parts remain: ${r.old}`);
    assert(r.lanes.length === 1 && r.lanes[0].name === 'Year 12 Advanced', `lanes ${JSON.stringify(r.lanes.map(l => l.name))}`);
    const l = r.lanes[0];
    assert(/^2 batches imported \(1 cleared review, 1 waiting\) · 23 papers to go · 3 batches( · 1 new)?$/.test(l.sub), `lane line “${l.sub}”`);
    assert(l.sq.join(' ') === 'clr:4 wait:5 cur:6 cur:7 cur:8', `squares ${l.sq.join(' ')}`);
    assert(l.acts.join('|') === '+1 batch|+2 batches|Queue all 3', `lane buttons ${l.acts}`);
    assert(r.chk === '3 papers: year or course not read yet. Sorted into lanes once checked.' && r.chkActs.join('|') === 'Run the cover-page check|Resolve', `Needs a check lane: ${r.chk} ${r.chkActs}`);
    assert(r.lock === 'Locked · 3 courses, 8 papers' && r.lockRows.some(x => /^Year 11 Advanced 3 papers Held until Year 12 is finished$/.test(x)) && r.lockRows.some(x => /^Year 12 Extension 1 3 papers Needs course setup$/.test(x)), `locked: ${r.lock} ${JSON.stringify(r.lockRows)}`);
    // owner 16 Nov: copies listed beside their original with both Drive links; never in a lane batch
    // owner 16 Nov (screenshot): "can't tell anything from it": the verdict on the row, three folded parts, one line per file
    assert(r.cps === 'Copies and missing files · nothing needs you' && r.cpLis === 3 && r.cpParts === 'cp:1|mv:1|ms:1', `copies summary “${r.cps}”, ${r.cpLis} rows, parts ${r.cpParts}`);
    assert(/^2025 Abbotsleigh AT1.*copy in Abbotsleigh › Yr 12 Adv Copy ↗Original ↗$/.test(r.cpRow || ''), `copy row “${r.cpRow}”`);
    assert(r.cpLinks.join() === 'https://drive.google.com/file/d/1copyfixture9701aa/view,https://drive.google.com/file/d/1origfixture9101aa/view', `copy links ${r.cpLinks}`);
    assert(!fx.inventory.lanes.some(L => L.batches.flat().includes(9701)), 'a copy sits in a lane batch');
    assert(r.legend.join('|') === 'Imported, cleared review|Imported, waiting for review|In the queue|Ready, current syllabus|Ready, old syllabus', `legend ${r.legend}`);
    return `${l.name}: ${l.sub}; ${l.sq.length} squares; ${r.lock}`;
  });
  // owner 14 Nov: "I would like to see how many of the batches have cleared checks on the import page too, its good to know."
  await check('papers: cleared review vs waiting (Review\'s own track, key docs, live)', page, async () => {
    const C = fx.reviews ? 1601 : null;
    const st = await page.evaluate(() => ({keyOnly: Object.keys(reviews).length > 0, store: [...window.__pt.store.keys()].filter(k => /^reviews\/(k_2024-Knox-AT2|p_2024-Knox-AT2$|paper_1601$)/.test(k)),
      q1601: B.questions.filter(q => q.doc === 1601).map(q => window.__pt.store.has('reviews/q' + q.id)).filter(Boolean).length,
      work: {c: paperWork(1601).n, w: paperWork(323).n}, rs: {c: PQ.reviewState(PQ.model().byId.get(1601)), w: PQ.reviewState(PQ.model().byId.get(323))},
      look: ['clr', 'wait'].map(c => { const e = document.querySelector('#prLanes .pr-sq .pr-b.' + c), cs = getComputedStyle(e); return [cs.backgroundColor, cs.borderTopWidth, cs.borderTopColor] })}));
    assert(C && st.store.some(k => k.startsWith('reviews/k_')) && st.store.includes('reviews/p_2024-Knox-AT2') && !st.store.includes('reviews/paper_1601') && st.q1601 === 0, `1601 should be decided by key docs only: ${JSON.stringify(st.store.slice(0, 4))} q docs ${st.q1601}`);
    assert(st.work.c === 0 && st.work.w > 0 && st.rs.c === 'cleared' && st.rs.w === 'waiting', `Review's track: 1601 ${st.work.c} left (${st.rs.c}), 323 ${st.work.w} left (${st.rs.w})`);
    assert(st.look[0][1] === '1px' && st.look[1][1] === '2px' && st.look[0][0] === st.look[1][2] && st.look[1][0] !== st.look[0][0], `square look: cleared ${st.look[0]}, waiting ${st.look[1]}`);
    await page.click('#prLanes [data-prb="advanced_12:5"]'); await settle(page, 600, 2);
    let r = await page.evaluate(() => ({head: document.querySelector('#prLanes .pr-panel .pr-phead > span').textContent, chips: [...document.querySelectorAll('#prLanes .pr-panel .pr-plist li')].map(li => [li.querySelector('span').textContent, li.querySelector('.pr-chip').textContent, li.querySelector('.pr-chip').getAttribute('href')])}));
    assert(r.head === '1 paper · imported (b5) · 0 of 1 cleared review' && r.chips.length === 1 && r.chips[0][0] === '2024 Caringbah High School AT4' && r.chips[0][1] === 'Waiting for review' && r.chips[0][2] === '#review/paper/323', `Batch 5 panel ${JSON.stringify(r)}`);
    await page.click('#prLanes [data-prb="advanced_12:4"]'); await settle(page, 600, 2);
    r = await page.evaluate(() => ({head: document.querySelector('#prLanes .pr-panel .pr-phead > span').textContent, chips: [...document.querySelectorAll('#prLanes .pr-panel .pr-plist li')].map(li => li.querySelector('.pr-chip').textContent)}));
    assert(r.head === '1 paper · imported (b4) · 1 of 1 cleared review' && r.chips.join() === 'Cleared review', `Batch 4 panel ${JSON.stringify(r)}`);
    await page.click('#prLanes .pr-panel [data-prclose]'); await settle(page, 400, 2);
    // live: take one key doc away (as Review's undo would) and put it back; the square, the lane line and the queue's count follow
    const k = st.store.find(x => x.startsWith('reviews/k_')), saved = await page.evaluate(k => JSON.parse(JSON.stringify(window.__pt.store.get(k))), k);
    const look = () => page.evaluate(() => ({sq: document.querySelector('#prLanes [data-prb="advanced_12:4"]').className.replace('pr-b ', ''), sub: document.querySelector('#prLanes .pr-lane .pr-lname small').textContent.split(' · ')[0], wait: document.querySelector('#prQueue .pr-wait')?.textContent}));
    const before = await look();
    await page.evaluate(k => QG.db.doc(k).delete(), k); await settle(page, 800, 2);
    const mid = await look();
    await page.evaluate(([k, v]) => QG.db.doc(k).set(v), [k, saved]); await settle(page, 800, 2);
    const after = await look(); errs();
    assert(before.sq === 'clr' && before.wait === '1 batch is waiting for review' && mid.sq === 'wait' && mid.sub === '2 batches imported (0 cleared review, 2 waiting)' && mid.wait === '2 batches are waiting for review' && after.sq === 'clr' && after.sub === '2 batches imported (1 cleared review, 1 waiting)',
      `live: ${JSON.stringify({before, mid, after})}`);
    return `1601 cleared through ${st.store.length} key docs, 323 waiting (${st.work.w} left); panels; live ${before.sq} → ${mid.sq} → ${after.sq}`;
  });
  await check('papers: a square opens its batch with 9 papers; Swap = tools/batches.py', page, async () => {
    await page.click('#prLanes [data-prb="advanced_12:6"]'); await settle(page, 800, 2);
    let r = await page.evaluate(() => ({head: [...document.querySelector('#prLanes .pr-panel .pr-phead').children].map(c => c.textContent.trim()).filter(Boolean).join(' '), li: [...document.querySelectorAll('#prLanes .pr-panel .pr-plist li')].map(li => li.querySelector('span').textContent), swaps: document.querySelectorAll('#prLanes .pr-panel [data-prswap]').length, on: document.querySelector('#prLanes .pr-b.on')?.dataset.prb}));
    assert(r.li.length === 9 && r.swaps === 9 && r.on === 'advanced_12:6', `batch panel: ${JSON.stringify(r)}`);
    assert(r.head === 'Batch 6 9 papers · current syllabus · 2023–25 · not in the queue Add to the queue ×', `panel heading “${r.head}”`);
    await page.click('#prLanes .pr-panel [data-prswap="9101"]'); await settle(page, 1200, 2);
    const d = await docs(page, 'batches'), got = await page.evaluate(() => PQ.lanes()[0].batches.map(b => b.ids));
    errs();
    assert(d.length === 1 && d[0].k === 'batches/advanced_12' && d[0].course === 'advanced' && d[0].yl === '12' && d[0].swaps.length === 1 && d[0].swaps[0].id === 9101 && d[0].swaps[0].by === 'u_pagetest', `batches doc ${JSON.stringify(d)}`);
    assert(JSON.stringify(got) === JSON.stringify(fx.swap_expect), `after Swap the page has ${JSON.stringify(got)}, tools/batches.py ${JSON.stringify(fx.swap_expect)}`);
    r = await page.evaluate(() => ({li: [...document.querySelectorAll('#prLanes .pr-panel .pr-plist li')].length}));
    await page.click('#prLanes .pr-panel [data-prclose]'); await settle(page, 500, 2);
    const closed = await page.evaluate(() => !document.querySelector('#prLanes .pr-panel'));
    assert(r.li === 9 && closed, `after Swap ${r.li} papers in Batch 6; closed ${closed}`);
    return 'Batch 6: 9 papers, Swap moved 9101 to the end; batch sizes kept; page = Python';
  });
  // owner 14 Nov: "we might want to run multiple batches over the night", then "Let's do 3 batches before the lock"
  await check('queue: +1 / +2 batches, reorder, remove, limit text, Start the queue', page, async () => {
    await page.click('#prLanes [data-pradd="1"]'); await settle(page, 1000, 2);
    await page.click('#prLanes [data-pradd="2"]'); await settle(page, 1000, 2);
    let t = await qtitles(page), d = (await docs(page, 'queue')).sort((a, b) => a.order - b.order);
    assert(t.join('|') === 'Year 12 Advanced · Batch 6|Year 12 Advanced · Batch 7|Year 12 Advanced · Batch 8', `queue ${t}`);
    assert(d.map(x => x.k).join() === 'queue/advanced_12_6,queue/advanced_12_7,queue/advanced_12_8' && d.every((x, i) => x.order === i + 1 && x.course === 'advanced' && x.yl === '12' && x.by === 'u_pagetest'), `queue docs ${JSON.stringify(d)}`);
    const sq = await page.evaluate(() => [...document.querySelectorAll('#prLanes .pr-sq .pr-b')].map(b => b.className.replace('pr-b ', '').replace(' on', '')).join(' '));
    assert(sq === 'clr wait queued queued queued', `squares after queueing: ${sq}`);
    const r = await page.evaluate(() => ({st: [...document.querySelectorAll('#prQueue .pr-qs')].map(s => s.textContent), foot: document.querySelector('#prQueue .pr-qfoot').textContent.replace(/\s+/g, ' '), lim: document.querySelector('#prQueue .pr-limit'), txt: document.querySelector('#prQueue').textContent, est: document.querySelector('#prQueue .pr-est').textContent, api: document.querySelector('#prQueue .pr-api').textContent, head: document.querySelector('#prQueue .pr-qhead span').textContent, all: document.querySelector('[data-pradd="all"]').disabled,
      wait: (() => { const w = document.querySelector('#prQueue .pr-startrow .pr-wait'), s = document.querySelector('#prQueue .pr-startrow #prQStart'); return w && {t: w.textContent, tag: w.tagName, ctl: !!w.querySelector('button,a,input'), start: s && !s.disabled, beside: Math.abs(w.getBoundingClientRect().top + w.getBoundingClientRect().height / 2 - (s.getBoundingClientRect().top + s.getBoundingClientRect().height / 2)) < 12} })()}));
    assert(r.st.join() === 'Next,Waiting,Waiting', `states ${r.st}`);
    // 21 Nov (owner: "no hanging numbers"): the cost comes from the measured batches (fixture: US$3–4 a paper), not a typed-in estimate
    assert(r.foot === '3 batches · 23 papersCost US$69–92' || r.foot === '3 batches · 23 papers Cost US$69–92', `footer “${r.foot}”`);
    // owner 14 Nov: "Maybe remove the lock for now since I'm in charge of import"
    assert(!r.lim && !/Stops when \d|before the lock|limit/i.test(r.txt) && r.head === 'Runs top to bottom until the queue is empty. Stops early only if a batch comes back with unusual problems.' && r.est === 'US$3–4 a paper, from the batches imported so far (Costs)' && r.api === 'This sends the queue to Claude, which imports it batch by batch through the Anthropic API.', `queue texts: ${r.head} / ${r.est} / ${r.api} / lock text ${!!r.lim}`);
    assert(r.wait && r.wait.t === '1 batch is waiting for review' && r.wait.tag === 'SPAN' && !r.wait.ctl && r.wait.start && r.wait.beside, `waiting count beside Start (information only): ${JSON.stringify(r.wait)}`);
    assert(r.all, 'Queue all should be disabled with every batch queued');
    await page.click('#prQueue [data-prq-id="advanced_12_6"][data-prqmv="1"]'); await settle(page, 1000, 2);
    t = await qtitles(page); d = (await docs(page, 'queue')).sort((a, b) => a.order - b.order);
    assert(t[0] === 'Year 12 Advanced · Batch 7' && t[1] === 'Year 12 Advanced · Batch 6' && d.map(x => x.batch).join() === '7,6,8', `after ↓: ${t} / db ${d.map(x => x.batch)}`);
    await page.click('#prQueue [data-prqdel="advanced_12_8"]'); await settle(page, 1000, 2);
    t = await qtitles(page); d = await docs(page, 'queue');
    assert(t.length === 2 && d.length === 2 && !d.some(x => x.batch === 8), `after ×: ${t}`);
    await page.click('#prQStart'); await settle(page, 1200, 2);
    const runs = await docs(page, 'runs'), card = await page.evaluate(() => document.querySelector('#prQueue .pr-run')?.textContent || '');
    errs();
    assert(runs.length === 1 && runs[0].kind === 'queue' && runs[0].status === 'requested' && !('limit' in runs[0]) && runs[0].stop_early && runs[0].stop_early.your_calls === 13 && runs[0].queue.map(x => x.batch).join() === '7,6' && runs[0].queue[0].papers.length === 9 && runs[0].by === 'u_pagetest', `runs doc ${JSON.stringify(runs)}`);
    assert(/Sent to Claude/.test(card) && !(await page.$('#prQStart')), `after Start: “${card}”`);
    await page.click('#prQCancel'); await settle(page, 1000, 2);
    const c = await docs(page, 'runs');
    assert(c[0].status === 'cancelled' && !!(await page.$('#prQStart')), `after Cancel: ${c[0].status}`);
    return 'queue/advanced_12_6..8 written in order; ↓ and × reach the db; no lock (no limit), waiting count beside Start; runs doc kind queue; Cancel';
  });
  // owner 14 Nov review: the queue line wrapped "Batch 10" at 1280 px. A queued batch numbered 10 (no such batch in the fixture lane:
  // listed by name only) must keep "<lane> · Batch 10" on one line, and "Batch 10" is never split.
  await check('queue: "Batch 10" stays on one line at 1280px', page, async () => {
    await page.evaluate(() => QG.db.doc('queue/advanced_12_10').set({course: 'advanced', yl: '12', batch: 10, order: 99, by: 'u_pagetest', at: new Date().toISOString()})); await settle(page, 800, 2);
    const r = await page.evaluate(() => [...document.querySelectorAll('#prQueue .pr-qi .pr-qt b')].map(b => { const lh = parseFloat(getComputedStyle(b).lineHeight) || 20, n = b.querySelector('.pr-nw'); return {t: b.textContent, lines: Math.round(b.getBoundingClientRect().height / lh), nw: n && n.getClientRects().length} }));
    await page.evaluate(() => QG.db.doc('queue/advanced_12_10').delete()); await settle(page, 600, 2); errs();
    const b10 = r.find(x => /Batch 10$/.test(x.t));
    assert(b10 && r.every(x => x.lines === 1 && x.nw === 1), `queue titles ${JSON.stringify(r)}`);
    return r.map(x => x.t).join(' | ');
  });
  await check('papers: Run the cover-page check records a request in runs', page, async () => {
    await page.click('#prLanes [data-prcover]'); await settle(page, 1000, 2);
    const r = (await docs(page, 'runs')).filter(x => x.kind === 'cover_check'), b = await page.evaluate(() => ({t: document.querySelector('#prLanes [data-prcover]').textContent, d: document.querySelector('#prLanes [data-prcover]').disabled}));
    errs();
    assert(r.length === 1 && r[0].status === 'requested' && r[0].papers.slice().sort().join() === '9140,9141,9601', `cover_check doc ${JSON.stringify(r)}`);
    assert(b.d && b.t === 'Cover-page check requested', `button ${JSON.stringify(b)}`);
    return 'one cover_check request with the 3 Needs a check papers';
  });
  await check('needs a check: Accept the better rules, place a paper', page, async () => {
    await page.click('#prLanes a[href="#processes/papers/check"]'); await settle(page, 1500, 2);
    let r = await page.evaluate(() => ({hash: location.hash, main: document.querySelector('#prMainWrap').hidden, chk: !document.querySelector('#prCheck').hidden, hist: document.querySelector('#procHist').hidden,
      h: [...document.querySelectorAll('#prCheck h3')].map(h => h.textContent), rules: [...document.querySelectorAll('#prCheck .pr-rule')].map(x => x.querySelector('.pr-rt b').textContent + ' ' + x.querySelector('.pr-rn').textContent),
      rows: [...document.querySelectorAll('#prCheck .pr-place')].map(x => +x.dataset.prplace), acc: document.querySelector('#prAccept')?.textContent, cover: [...document.querySelectorAll('#prCheck .pr-place')].every(x => x.querySelectorAll('.pr-pages .pr-pg').length === 4)}));
    assert(r.hash === '#processes/papers/check' && r.main && r.chk && r.hist, `the check view: ${JSON.stringify(r)}`);
    assert(r.h.join('|') === 'Needs a check|1 paper placed by better rules|2 for you to place' && r.acc === 'Accept all 1', `headings ${r.h} / ${r.acc}`);
    assert(r.rules[0] === '"Ext 1" or "EXT1" (with or without a space), or a "Yr 12 Ext 1" folder 1 paper' && r.rules.length === 5, `rules ${r.rules}`);   // v3 (21 Nov)
    assert(r.rows.join() === '9140,9601' && r.cover, `rows to place ${r.rows}`);
    await page.click('#prCheck [data-prsee="ext1"]'); await settle(page, 500, 2);
    const see = await page.evaluate(() => [...document.querySelectorAll('#prCheck .pr-see li')].map(li => li.textContent));
    assert(see.length === 1 && /2024 Oakhill College AT2/.test(see[0]), `See all: ${see}`);
    await page.click('#prAccept'); await settle(page, 1200, 2);
    const acc = await docs(page, 'scans');
    assert(acc.length === 1 && acc[0].k === 'scans/rules' && acc[0].accepted === true && acc[0].version === 3 && acc[0].by === 'u_pagetest', `scans/rules ${JSON.stringify(acc)}`);
    // owner 14 Nov (mockup): the rules' course guess is pre-picked, not saved: Ascham 2019 shows Advanced pressed and no paperfix yet
    const pre = await page.evaluate(() => ({c: [...document.querySelectorAll('#prCheck [data-prplace="9140"] [data-prc]')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.prc),
      y: [...document.querySelectorAll('#prCheck [data-prplace="9140"] [data-pryl]')].filter(b => b.getAttribute('aria-pressed') === 'true').length, n: [...window.__pt.store.keys()].filter(k => k.startsWith('paperfix/')).length,
      none: [...document.querySelectorAll('#prCheck [data-prplace="9601"] [aria-pressed="true"]')].length}));
    assert(pre.c.join() === 'advanced' && pre.y === 0 && pre.n === 0 && pre.none === 0, `pre-pick: ${JSON.stringify(pre)}`);
    // place: Ascham 2019 (year level not known) as Year 12 -> with the pre-picked Advanced: ready, old syllabus (before 2020); the Barker file not in scope
    await page.click('#prCheck [data-prplace="9140"] [data-pryl="12"]'); await settle(page, 800, 2);
    await page.click('#prCheck [data-prplace="9601"] [data-prout]'); await settle(page, 800, 2);
    const fx2 = await docs(page, 'paperfix'), res = await page.evaluate(() => ({h: [...document.querySelectorAll('#prCheck h3')].map(h => h.textContent), res: [...document.querySelectorAll('#prCheck .pr-res')].map(x => x.textContent)}));
    const a = fx2.find(x => x.k === 'paperfix/p9140'), b = fx2.find(x => x.k === 'paperfix/p9601');
    assert(a && a.yl === 12 && a.course === 'advanced' && !a.out && a.files.join() === '9140' && a.by === 'u_pagetest' && b && b.out === true, `paperfix docs ${JSON.stringify(fx2)}`);
    assert(res.h.includes('0 for you to place') && res.res.some(x => /Placed: Year 12 Advanced · ready to import, old syllabus/.test(x)) && res.res.some(x => /Left out: it will not be imported/.test(x)), `after placing: ${JSON.stringify(res)}`);
    // owner 17 Nov: "I don't get why I couldn't choose from the resolve page what to do as well": a paper with no year (9601) placed
    // as Year 12 Advanced says what is missing and takes the HSC year typed in; the button reads "Leave out"
    await page.click('#prCheck [data-prplace="9601"] [data-prout]'); await settle(page, 600, 2);
    await page.click('#prCheck [data-prplace="9601"] [data-pryl="12"]'); await settle(page, 600, 2);
    await page.click('#prCheck [data-prplace="9601"] [data-prc="advanced"]'); await settle(page, 600, 2);
    const yr = await page.evaluate(() => { const row = document.querySelector('#prCheck [data-prplace="9601"]');
      return {inp: !!row.querySelector('input[data-pry]'), res: row.querySelector('.pr-res')?.textContent || '', out: row.querySelector('[data-prout]').textContent} });
    assert(yr.inp && /Almost: type the year the class graduates/.test(yr.res) && yr.out === 'Leave out', `no-year paper: ${JSON.stringify(yr)}`);
    await page.fill('#prCheck [data-prplace="9601"] input[data-pry]', '2024'); await page.press('#prCheck [data-prplace="9601"] input[data-pry]', 'Enter');
    await page.evaluate(() => document.querySelector('#prCheck [data-prplace="9601"] input[data-pry]')?.dispatchEvent(new Event('change', {bubbles: true}))); await settle(page, 800, 2);
    const fx3 = (await docs(page, 'paperfix')).find(x => x.k === 'paperfix/p9601'), yres = await page.evaluate(() => document.querySelector('#prCheck [data-prplace="9601"] .pr-res')?.textContent || '');
    assert(fx3 && fx3.y === 2024 && fx3.yl === 12 && fx3.course === 'advanced' && !fx3.out && /Placed: Year 12 Advanced 2024 · ready to import/.test(yres), `year typed: ${JSON.stringify(fx3)} / ${yres}`);
    await page.click('#prCheck [data-prplace="9601"] [data-prout]'); await settle(page, 800, 2);   // back to left out: the counts below expect it
    // owner 14 Nov: the cover + 3 question pages (9140 has a pack; 9601 placeholders) and "Open the whole PDF in Drive"
    const pg = await page.evaluate(() => { const row = id => document.querySelector(`#prCheck [data-prplace="${id}"]`);
      return {a: [...row(9140).querySelectorAll('.pr-pages button.pr-pg')].map(b => [b.dataset.prpg, b.querySelector('img')?.src.slice(0, 22), b.textContent]), ph: [...row(9601).querySelectorAll('.pr-pages .pr-pgph')].length, phBtn: row(9601).querySelectorAll('.pr-pages button').length,
        drive: [...row(9140).querySelectorAll('a.pr-drive')].map(a => [a.textContent, a.getAttribute('href'), a.target, a.rel]), drive2: row(9601).querySelectorAll('a.pr-drive').length} });
    assert(pg.a.length === 4 && pg.a.every((x, i) => x[0] === '9140:' + i && x[1] === 'data:image/png;base64,') && pg.a.map(x => x[2]).join() === 'Cover,Page 3,Page 6,Page 9', `9140 pages ${JSON.stringify(pg.a)}`);
    assert(pg.ph === 4 && pg.phBtn === 0, `9601 placeholders ${pg.ph} (buttons ${pg.phBtn})`);
    assert(pg.drive.length === 1 && pg.drive[0][0] === 'Open the whole PDF in Drive ↗' && pg.drive[0][1] === 'https://drive.google.com/file/d/1fixtureAscham9140abcdEF/view' && pg.drive[0][2] === '_blank' && /noopener/.test(pg.drive[0][3]) && pg.drive2 === 0, `Drive link ${JSON.stringify(pg.drive)} / 9601 ${pg.drive2}`);
    // the viewer: click page 2 of 4, → → ← ← ←, Esc; focus back on the page clicked
    await page.click('#prCheck [data-prpg="9140:1"]'); await settle(page, 500, 2);
    const vw = () => page.evaluate(() => { const d = document.querySelector('#prView'); return {open: !!(d && d.open), t: d?.querySelector('#prViewT').textContent, n: d?.querySelector('.pr-vn').textContent, src: d?.querySelector('img').src.length, alt: d?.querySelector('img').alt, modal: !!(d && d.matches(':modal')), focus: document.activeElement?.getAttribute('aria-label') || document.activeElement?.dataset.prpg, btns: d ? [...d.querySelectorAll('button')].map(b => b.getAttribute('aria-label')) : []} });
    const full = JSON.parse(ck.packs['data/check/9140.json']).pages.map(p => p.full.length), seen = [];
    let v = await vw(); seen.push(v.n);
    assert(v.open && v.modal && v.t === '2019 Ascham School AT3: Page 3' && v.n === '2 of 4' && v.src === full[1] && v.alt === 'Page 3 of the PDF' && v.focus === 'Close' && v.btns.join() === 'Close,Previous page,Next page', `viewer opened: ${JSON.stringify(v)}`);
    for (const k of ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft']) { await page.keyboard.press(k); await settle(page, 300, 1); v = await vw(); seen.push(v.n + (v.src === full[+v.n[0] - 1] ? '' : ' (wrong picture)')) }
    assert(seen.join('|') === '2 of 4|3 of 4|4 of 4|3 of 4|2 of 4|1 of 4', `stepping: ${seen.join(' | ')}`);
    await page.keyboard.press('ArrowLeft'); await settle(page, 300, 1); v = await vw(); seen.push(v.n);
    await page.keyboard.press('Escape'); await settle(page, 400, 2);
    const closed = await vw(), foc = await page.evaluate(() => document.activeElement?.dataset.prpg);
    errs();
    assert(v.n === '4 of 4' && !closed.open && foc === '9140:1', `wrap ${v.n}; after Esc open ${closed.open}, focus on ${foc}`);
    await page.click('#prCheck [data-prpg="9140:3"]'); await settle(page, 400, 2);
    await page.click('#prView [data-prvx]'); await settle(page, 400, 2);
    const c2 = await vw(), foc2 = await page.evaluate(() => document.activeElement?.dataset.prpg);
    assert(!c2.open && foc2 === '9140:3', `× closes and refocuses: open ${c2.open}, focus ${foc2}`);
    await page.evaluate(() => document.querySelector('#prCheck .pr-back').click()); await settle(page, 1500, 2);
    const back = await page.evaluate(() => location.hash === '#processes/papers' && !document.querySelector('#prMainWrap').hidden && document.querySelector('#prCheck').hidden);
    const t = await tiles(page), L = laneTally(inv); errs();
    assert(back, '← Import papers did not lead back to the lanes');
    // Accept: 9141 -> Extension 1 (held); 9140 -> ready; 9601 -> not in scope; the four numbers still add up
    assert(t.check.n === 0 && t.ready.n === L.ready + 1 && t.aside.n === L.aside + 2 && t.imported.n + t.ready.n + t.check.n + t.aside.n === L.n, `tiles after Accept and placing ${JSON.stringify(t)}`);
    return 'Accept writes scans/rules; Advanced pre-picked, Year 12 and Leave out write paperfix; a paper with no year takes the typed HSC year; 4 pages + placeholders, viewer ← → Esc, Drive link; the summary follows and still adds up';
  });
  await check('papers: Import history collapsed at the bottom', page, async () => {
    const a = await page.evaluate(() => { const h = document.querySelector('#procHist'); return {open: h.open, hidden: h.hidden, sum: h.querySelector('summary').textContent.trim(), inside: ['.tiles', '.bgrp'].every(s => h.querySelector('#importBox ' + s))} });
    errs(); assert(a.sum === 'Import history' && a.open === false && !a.hidden && a.inside, `Import history: ${JSON.stringify(a)}`);
    return 'collapsed; tiles and finished batches inside';
  });
  // owner 21 Nov: "I want to see somewhere the costs logged properly, per paper, per batch total"
  // 23 Nov: a Standard batch (n 'S1') is labelled "Standard batch 1" (12_import.js), so the row check follows that label
  await check('papers: Costs lists every batch with its total, and a batch opens to its papers', page, async () => {
    const want = JSON.parse(fs.readFileSync(path.join(SITE, 'data/costs.json'), 'utf8'));
    await page.evaluate(() => { const d = document.querySelector('#procCost'); d.open = true });
    await page.waitForSelector('#costBox .pr-ct tbody tr.pr-cb', {timeout: 8000});
    const r = await page.evaluate(() => ({rows: [...document.querySelectorAll('#costBox .pr-ct tbody tr.pr-cb')].map(t => t.innerText), foot: document.querySelector('#costBox .pr-ct tfoot')?.innerText || '', note: document.querySelector('#costBox .pr-cnote')?.innerText || ''}));
    const usd = x => 'US$' + x.toLocaleString('en-AU', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    assert(r.rows.length === want.batches.length && want.batches.every((b, i) => r.rows[i].includes(b.course === 'standard' ? 'Standard batch ' + String(b.n).slice(1) : 'Batch ' + b.n) && r.rows[i].includes(usd(b.usd))), 'batch rows: ' + JSON.stringify(r.rows));
    assert(r.foot.includes(usd(want.batch_usd)) && /monthly limit/.test(r.note), `total/limit: ${r.foot} | ${r.note}`);
    const b0 = want.batches[0];
    await page.click(`#costBox [data-costb="${b0.n}"]`); await settle(page, 500, 2);
    const papers = await page.evaluate(() => [...document.querySelectorAll('#costBox .pr-cp tbody tr')].map(t => t.innerText));
    assert(papers.length === b0.papers.length && papers[0].includes(b0.papers[0].label), 'papers: ' + JSON.stringify(papers.slice(0, 2)));
    return `${r.rows.length} batches (Standard ones named as such), total ${usd(want.batch_usd)}; ${b0.n} opens to ${papers.length} papers`;
  });
  await page.context().close();
  // phone: lanes wrap, the batch panel and the queue stack, nothing runs off 390 px
  const tp = await newPage(browser, base, seed, {width: 390, theme: 'dark', touch: true});
  await serveInv(tp); await boot(tp, base, '#processes/papers'); await settle(tp, 3000, 2);
  await check('papers: phone 390px (lanes wrap, panel stacks)', tp, async () => {
    await tp.tap('#prLanes [data-prb="advanced_12:7"]'); await settle(tp, 800, 2);
    await tp.tap('#prLanes [data-pradd="1"]'); await settle(tp, 1000, 2);
    const r = await tp.evaluate(() => { const R = s => document.querySelector(s).getBoundingClientRect(), lis = [...document.querySelectorAll('#prLanes .pr-panel .pr-plist li')].map(l => l.getBoundingClientRect());
      return {w: innerWidth, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, right: Math.max(...[...document.querySelectorAll('#invBox *')].filter(e => e.offsetWidth).map(e => e.getBoundingClientRect().right)),
        oneCol: lis.length === 9 && lis.every(l => Math.abs(l.left - lis[0].left) < 1), stacked: R('#prQueue').top >= R('#prLanes').bottom - 1, tiles: [...document.querySelectorAll('#prSum .pr-tile')].map(t => Math.round(t.getBoundingClientRect().width)),
        q: [...document.querySelectorAll('#prQueue .pr-qi b')].map(b => b.textContent)} });
    const e = takeErrs(tp); assert(!e.length, e.join(' | '));
    assert(r.sw <= r.cw + 1 && r.right <= r.w + 0.5, `overflow at 390px: ${JSON.stringify(r)}`);
    assert(r.oneCol && r.stacked, `panel one column ${r.oneCol}, queue under the lanes ${r.stacked}`);
    assert(r.q.join() === 'Year 12 Advanced · Batch 6', `+1 batch by tap: ${r.q}`);
    return `fits; tiles ${r.tiles.join('/')} px; panel one column; queue under the lanes`;
  });
  await tp.context().close();
  // a viewer: no section, no inventory fetch, no subscriptions, no writes
  const vp = await newPage(browser, base, seed, {width: 1280, theme: 'light', role: 'viewer'});
  await serveInv(vp); await boot(vp, base, '#bank');
  await check('papers (viewer): nothing shows, nothing is written', vp, async () => {
    for (const h of ['#processes/papers', '#processes/papers/check', '#processes']) { await vp.evaluate(h => { location.hash = h }, h); await settle(vp, 2000, 2) }
    const r = await vp.evaluate(async () => { PQ.render(); PQ.run.render(); const a = await PQ.run.add([{key: 'advanced_12', n: 6}]); const s = await PQ.run.start(); const c = await PQ.run.coverCheck(); const acc = await PQ.check.accept(); const pl = await PQ.check.place(9140, {yl: 12});
      return {hash: location.hash, hidden: document.querySelector('#invBox').hidden, html: document.querySelector('#invBox').innerHTML.length, a, s, c, acc, pl, w: window.__pt.log.length, subs: Object.keys(PQ.state.subs).length + Object.keys(PQ.run.state.subs).length} });
    assert(r.hidden && r.html === 0 && r.a === 0 && r.s === null && r.c === null && r.acc === false && r.pl === false && r.w === 0 && r.subs === 0 && r.hash === '#bank', JSON.stringify(r));
    assert(vp._inv === 0, `a viewer fetched data/inventory.json ${vp._inv} time(s)`);
    return 'hidden; Curate hashes → #bank; every write refused; no fetch, no subscription';
  });
  await vp.context().close();
}
/* ======== end of the Processes › Papers lanes block ======== */

/* ---------------- Rescan drive (Processes › Papers) ----------------
   owner 13 Nov: "Where is the button to rescan the drive?" (earlier: "New exams are gonna be added to this folder periodically
   we need a way to ... see what we actually haven't ingested yet"). The fake Google Drive connector answers from the fixture's
   small tree (tools/page_test_fixture.py sample_drive); the inventory carries the matching record and the real path rules.
   Progress and Cancel; new files grouped by course x year as tools/classify_paths.py classifies them; the scans doc; the
   classifier port against every recorded path; back-off and per-code errors; no connector; a viewer; 390 px; reload. */
async function driveScan(browser, base, seed, fx) {
  if (!fx.papers || !fx.drive) { await check('rescan: fixture', null, async () => { throw new Error('work/page_test/fixture.json has no "drive": run tools/page_test_fixture.py') }); return }
  const inv = fx.papers.inventory, invFiles = fx.papers.inventory_files, dv = fx.drive;
  // the recorded files are a separate data/inventory_files.json (CODE_HEALTH rule 6), fetched only for Rescan drive: counted in p._files
  const serveInv = async p => { p._inv = 0; p._files = 0; await p.route(u => /\/data\/inventory\.json/.test(u.href), r => { p._inv++; return r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(inv)}) });
    await p.route(u => /\/data\/inventory_files\.json/.test(u.href), r => { p._files++; return r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(invFiles)}) }) };
  const scans = p => p.evaluate(() => [...window.__pt.store.entries()].filter(([k]) => k.startsWith('scans/')).map(([k, v]) => ({k, ...v})));
  const open = async (opts, seedX = seed) => { const p = await newPage(browser, base, seedX, opts); await serveInv(p); await boot(p, base, '#processes/papers'); await settle(p, 3000, 2); return p };
  const go = p => p.evaluate(() => document.querySelector('#ivScanGo').click());
  const done = p => p.waitForFunction(() => !document.querySelector('#ivScan .ivsprog') && !!document.querySelector('#ivScan .ivsres, #ivScan .ivserr'), null, {timeout: 20000});
  const gid = e => e.course + '|' + (e.yl === 11 || e.yl === 12 ? String(e.yl) : '?');
  const want = {}; for (const [i, e] of Object.entries(dv.expect)) if (!dv.like[i]) (want[gid(e)] = want[gid(e)] || []).push(i);
  const nNew = Object.values(want).flat().length;

  const page = await open({width: 1280, theme: 'light', drive: dv});
  const errs = () => { const e = takeErrs(page); assert(!e.length, e.slice(0, 3).join(' | ')) };
  await check('rescan: button beside the last scan, progress, Cancel saves nothing', page, async () => {
    await page.waitForSelector('#ivScanGo', {timeout: 12000});
    const pos = await page.evaluate(() => { const b = document.querySelector('#ivScanGo'), s = document.querySelector('#ivSub'); return {row: b.parentElement.parentElement === s.parentElement, txt: b.textContent, sub: s.textContent} });
    assert(pos.row && pos.txt === 'Rescan drive' && /last scan/.test(pos.sub), JSON.stringify(pos));
    assert(page._files === 0, `opening Processes › Papers fetched data/inventory_files.json ${page._files} time(s): it is for Rescan drive only`);
    // 23 Nov flake: at 400 ms a call the 6-folder scan could finish before the Cancel click landed (and the page redrew the button
    // after every folder). The fake call is abortable, so a long delay keeps the scan running until Cancel
    await page.evaluate(() => { window.__pt.driveDelay = 60000 });
    await go(page);
    await page.waitForFunction(() => /Scanning Google Drive · \d+ of \d+ folders/.test(document.querySelector('#ivScan .ivsprog')?.textContent || ''), null, {timeout: 5000});
    const pr = await page.evaluate(() => ({t: document.querySelector('#ivScan .ivsptxt').textContent, dis: document.querySelector('#ivScanGo').disabled, bar: !!document.querySelector('#ivScan progress')}));
    assert(pr.dis && pr.bar, `while scanning: ${JSON.stringify(pr)}`);
    await page.click('#ivScanStop');
    await page.waitForFunction(() => /Scan cancelled\. Nothing was saved\./.test(document.querySelector('#ivScan .ivserr')?.textContent || ''), null, {timeout: 5000});
    const n = (await scans(page)).length, en = await page.evaluate(() => !document.querySelector('#ivScanGo').disabled); errs();
    assert(n === 0 && en, `after Cancel: ${n} scans docs, button enabled ${en}`);
    assert(page._files === 1, `Rescan drive fetched data/inventory_files.json ${page._files} time(s) (want 1)`);
    return pr.t.trim();
  });
  await check('rescan: new files grouped by course x year, scan doc saved', page, async () => {
    await page.evaluate(() => { window.__pt.driveDelay = 20; window.__pt.mcp.length = 0 });
    const t0 = Date.now(); await go(page);
    await done(page);
    const r = await page.evaluate(() => ({res: document.querySelector('#ivScan .ivsres')?.textContent || '', err: document.querySelector('#ivScan .ivserr')?.textContent || '',
      last: document.querySelector('#ivScan .ivslast p')?.textContent || '', note: document.querySelector('#ivScan .ivsnote')?.textContent || '',
      groups: Object.fromEntries([...document.querySelectorAll('#ivScan .ivslast details.ivsg')].map(d => [d.dataset.ivsg, [...d.querySelectorAll('.ivsname')].map(x => x.textContent)])),
      like: [...document.querySelectorAll('#ivScan .ivchip.like')].map(c => c.closest('li').querySelector('.ivsname').textContent),
      sub: document.querySelector('#ivSub').textContent, calls: window.__pt.mcp.slice()}));
    errs();
    assert(!r.err, `error shown: ${r.err}`);
    assert(new RegExp(`^${nNew} new files since `).test(r.res) && /1 file with the same size as a recorded file/.test(r.res), `headline: “${r.res}”`);
    assert(r.last.startsWith(`Found in the last scan, not yet in the record: ${nNew}`) && r.note === 'Tonight\'s night run adds these to the record (Processes › Work › Tonight). Open a group to see its files.', `last-scan line: “${r.last}” / “${r.note}”`);
    const name = i => dv.expect[i].path.split('/').pop();
    for (const [g, ids] of Object.entries(want)) assert((r.groups[g] || []).filter(x => ids.map(name).includes(x)).length === ids.length, `group ${g}: ${JSON.stringify(r.groups[g])} (want ${ids.map(name)})`);
    assert(r.like.join('|') === name('n3'), `same-size chip on: ${r.like}`);
    assert(new RegExp(`· last scan .+, ${nNew} new since$`).test(r.sub), `sub line: “${r.sub}”`);
    // read-only: only search_files on Google Drive, one parentId query per folder, paging used, the skipped folder never opened
    assert(r.calls.every(c => c.server === 'Google Drive' && c.tool === 'search_files' && /^parentId = '[\w-]+' and \(mimeType = 'application\/vnd\.google-apps\.folder' or mimeType = 'application\/pdf'\) and trashed = false$/.test(c.input.query) && c.input.excludeContentSnippets === true), `unexpected call: ${JSON.stringify(r.calls.find(c => c.tool !== 'search_files' || !/^parentId/.test(c.input.query)))}`);
    assert(r.calls.some(c => c.input.pageToken) && !r.calls.some(c => /'fCO'/.test(c.input.query)), 'pageToken never used, or the skipped folder was opened');
    const parents = new Set(r.calls.map(c => /'([^']+)'/.exec(c.input.query)[1]));
    assert(parents.size === dv.folder_count, `folders walked ${parents.size} (want ${dv.folder_count})`);
    const ss = await scans(page); assert(ss.length === 1, `${ss.length} scans docs`);
    const d = ss[0];
    assert(/^scans\/s\d{14}$/.test(d.k) && d.by === 'u_pagetest' && !isNaN(Date.parse(d.at)) && d.root === 'ROOTFAKE', `scan doc: ${d.k} ${d.by} ${d.at} ${d.root}`);
    assert(d.counts.new === nNew && d.counts.like === 1 && d.counts.folders === dv.folder_count && d.counts.matched === 3 && d.counts.pdfs === 9, `counts ${JSON.stringify(d.counts)}`);
    for (const [i, e] of Object.entries(dv.expect)) { const f = d.new.find(x => x.id === i);
      assert(f && f.path === e.path && f.course === e.course && f.yl === e.yl && f.year === e.year && f.status === e.status && typeof f.size === 'number' && f.name === name(i), `scan doc file ${i}: ${JSON.stringify(f)} (want ${JSON.stringify(e)})`) }
    assert(d.new.find(x => x.id === 'n3').like === dv.like.n3, 'n3 has no like');
    return `${nNew} new + 1 same size in ${Date.now() - t0} ms; ${r.calls.length} calls; ${Object.entries(r.groups).map(([g, x]) => g + ' ' + x.length).join(', ')}`;
  });
  // 16 Nov (owner: "can you fix it all?"): no cap on saved files (a scan kept only 500 of 583), saved in parts under the 256 KiB a
  // document holds and merged back on read; folders walked in a fixed order; a note when PDFs were uploaded in the last hour
  await check('rescan: 1,500 new files are all saved in parts (each under 256 KiB), merged back after a reload; fixed order; recent-upload note', null, async () => {
    const big = JSON.parse(JSON.stringify(dv)), now = new Date().toISOString();
    big.per = 100;   // Drive's real page size (the small fixture pages would hit the walk's 60-pages-per-folder limit first)
    for (let i = 0; i < 1500; i++) big.folders.fKY12.push({id: 'bulk' + i, title: `2025 Knox Year 12 Mathematics Advanced Assessment Task ${i % 4 + 1} with worked solutions copy ${i}.pdf`, mimeType: 'application/pdf', fileSize: String(200000 + i), createdTime: now});
    const p = await open({width: 1280, theme: 'light', drive: big});
    try {
      await p.evaluate(() => { window.__pt.driveDelay = 0 }); await go(p); await done(p);
      const r = await p.evaluate(() => ({err: document.querySelector('#ivScan .ivserr')?.textContent || '', note: [...document.querySelectorAll('#ivScan .ivsnote')].map(x => x.textContent).join(' | '),
        calls: window.__pt.mcp.map(c => c.input.orderBy)}));
      const ss = await scans(p), main = ss.find(x => !x.of), parts = ss.filter(x => x.of);
      const e = takeErrs(p); assert(!e.length, e.slice(0, 3).join(' | '));
      assert(!r.err, `error: ${r.err}`);
      assert(r.calls.length && r.calls.every(o => o === 'modifiedTime desc'), `orderBy: ${[...new Set(r.calls)]}`);
      assert(/uploaded in the last hour/.test(r.note), `no recent-upload note: “${r.note}”`);
      const all = main.new.length + parts.reduce((n, x) => n + x.new.length, 0), want = main.counts.new + main.counts.like;
      assert(main.parts === parts.length + 1 && parts.length >= 1 && all === want && want >= 1500, `parts ${main.parts}, docs ${parts.length + 1}, rows ${all} of ${want}`);
      const big1 = Math.max(...ss.map(x => JSON.stringify(x).length)); assert(big1 < 256 * 1024, `a scans doc is ${big1} bytes`);
      // reload: a fresh page seeded with the saved docs reads every part back
      const seed2 = {...seed}; for (const x of ss) { const {k, ...v} = x; seed2[k] = v }
      const q = await open({width: 1280, theme: 'light'}, seed2);
      try { await q.waitForFunction(() => /Found in the last scan, not yet in the record: \d+/.test(document.querySelector('#ivScan .ivslast p')?.textContent || ''), null, {timeout: 15000});
        const n = await q.evaluate(() => +/record: (\d+)/.exec(document.querySelector('#ivScan .ivslast p').textContent)[1]);
        const e2 = takeErrs(q); assert(!e2.length, e2.slice(0, 3).join(' | '));
        assert(n === main.counts.new, `after a reload the last scan lists ${n} new files (want ${main.counts.new})`);
        return `${want} rows in ${main.parts} docs (largest ${big1} bytes); reload lists all ${n} new; every call orderBy modifiedTime desc` } finally { await q.context().close() }
    } finally { await p.context().close() }
  });
  await check('rescan: page classification = tools/classify_paths.py on every recorded path', page, async () => {
    const bad = await page.evaluate(cases => cases.filter(([p, c, yl, t, y, s, st, why]) => { const r = PQ.scan.classify(p);
      return !r || r.course !== c || r.yl !== yl || r.task !== t || r.year !== y || r.school !== s || r.status !== st || (r.why || null) !== (why || null) }).slice(0, 5).map(x => x[0]), fx.classify || []);
    assert((fx.classify || []).length > 100, `only ${(fx.classify || []).length} recorded paths in the fixture`);
    assert(!bad.length, `differs on: ${bad.join(' | ')}`);
    return `${fx.classify.length} paths agree`;
  });
  await check('rescan: back-off once on a rate limit, then stop; errors per code', page, async () => {
    const run = async err => { await page.evaluate(e => { window.__pt.driveDelay = 0; window.__pt.mcp.length = 0; window.__pt.driveErr = e }, err);
      const n0 = (await scans(page)).length; await go(page); await done(page);
      return page.evaluate(n0 => ({msg: document.querySelector('#ivScan .ivserr')?.textContent || '', calls: window.__pt.mcp.length, w: [...window.__pt.store.keys()].filter(k => k.startsWith('scans/')).length - n0}), n0) };
    // retryable, twice in a row: one wait and one retry, then the scan stops (never a loop)
    let r = await run({n: 2, err: {code: 'rate_limited', message: 'slow down', retryable: true, retryAfterMs: 300}});
    assert(/busy and did not answer\. Nothing was saved/.test(r.msg) && r.calls === 2 && r.w === 0, `rate limit twice: ${JSON.stringify(r)}`);
    // retryable once: the retry succeeds and the scan completes
    r = await run({n: 1, err: {code: 'server_unavailable', message: '503', retryable: true, retryAfterMs: 200}});
    assert(!r.msg && r.w === 1, `one transient error: ${JSON.stringify(r)}`);
    const codes = {not_in_manifest: /was not allowed for this page/, approval_required: /was not allowed for this page/, needs_reauth: /needs reconnecting/, server_not_connected: /not connected for you/,
      blocked_by_policy: /block Google Drive search/, tool_error: /reported an error: boom/, weird_code: /The scan stopped \(weird_code\)/};
    for (const [code, re] of Object.entries(codes)) { r = await run({n: 1, err: {code, message: 'boom'}});
      assert(re.test(r.msg) && r.calls === 1 && r.w === 0, `${code}: ${JSON.stringify(r)}`) }
    await page.evaluate(() => { window.__pt.driveErr = null }); errs();
    return 'rate limit: 1 retry then stop; 7 codes, each with its own message; nothing saved';
  });
  await page.context().close();
  // reload: the last scan is read back from the database
  const kept = await (async () => { const p = await open({width: 1280, theme: 'light', drive: dv}); await p.waitForSelector('#ivScanGo'); await go(p); await done(p);
    const st = await p.evaluate(() => Object.fromEntries([...window.__pt.store.entries()])); await p.context().close(); return st })();
  const rp = await open({width: 1280, theme: 'light', drive: dv}, kept);
  await check('rescan: the last scan is shown after a reload', rp, async () => {
    await rp.waitForFunction(() => !!document.querySelector('#ivScan .ivslast'), null, {timeout: 8000});
    const r = await rp.evaluate(() => ({last: document.querySelector('#ivScan .ivslast p').textContent, res: !!document.querySelector('#ivScan .ivsres'), n: document.querySelectorAll('#ivScan .ivslast .ivsname').length, calls: window.__pt.mcp.length}));
    const e = takeErrs(rp); assert(!e.length, e.join(' | '));
    assert(r.last.startsWith(`Found in the last scan, not yet in the record: ${nNew}`) && !r.res && r.n === nNew + 1 && r.calls === 0, JSON.stringify(r));
    return r.last;
  });
  await rp.context().close();
  // no connector in this view: no button, "Ask Claude to rescan"
  const np = await open({width: 1280, theme: 'light'});
  await check('rescan: no Google Drive in this view → Ask Claude to rescan', np, async () => {
    await np.waitForFunction(() => !!document.querySelector('#ivScanBtn .ivask'), null, {timeout: 12000});
    const r = await np.evaluate(() => ({btn: !!document.querySelector('#ivScanGo'), ask: document.querySelector('#ivScanBtn .ivask').textContent, used: window.__pt.used.includes('mcp')}));
    const e = takeErrs(np); assert(!e.length, e.join(' | '));
    assert(!r.btn && r.ask === 'Ask Claude to rescan' && r.used, JSON.stringify(r));
    return 'button hidden';
  });
  await np.context().close();
  // phone: progress and results fit 390 px; the button works by tap
  const tp = await open({width: 390, theme: 'dark', touch: true, drive: dv});
  await check('rescan: phone 390px', tp, async () => {
    await tp.waitForSelector('#ivScanGo'); await tp.evaluate(() => { window.__pt.driveDelay = 300 }); await tp.tap('#ivScanGo');
    await tp.waitForSelector('#ivScan .ivsprog', {timeout: 5000});
    const a = await tp.evaluate(() => ({r: document.querySelector('#ivScan .ivsprog').getBoundingClientRect().right, w: innerWidth, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth}));
    await tp.evaluate(() => { window.__pt.driveDelay = 0 }); await done(tp);
    const b = await tp.evaluate(() => ({r: Math.max(...[...document.querySelectorAll('#ivScan *')].map(x => x.getBoundingClientRect().right)), w: innerWidth, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, res: document.querySelector('#ivScan .ivsres')?.textContent || ''}));
    const e = takeErrs(tp); assert(!e.length, e.join(' | '));
    assert(a.r <= a.w && a.sw <= a.cw + 1, `progress overflows at 390px: ${JSON.stringify(a)}`);
    assert(b.r <= b.w && b.sw <= b.cw + 1 && /new files since/.test(b.res), `results overflow at 390px: ${JSON.stringify(b)}`);
    return 'progress and results fit';
  });
  await tp.context().close();
  // a viewer: nothing shows, the connector is never asked for, nothing is written
  const vp = await newPage(browser, base, seed, {width: 1280, theme: 'light', role: 'viewer', drive: dv});
  await serveInv(vp); await boot(vp, base, '#bank');
  await check('rescan (viewer): no button, no Drive call, nothing written', vp, async () => {
    await vp.evaluate(() => { location.hash = '#processes' }); await settle(vp, 2000, 2);
    const r = await vp.evaluate(async () => { PQ.scan.render(); await PQ.scan.start();
      return {btn: !!document.querySelector('#ivScanGo'), box: document.querySelector('#invBox').hidden, used: window.__pt.used.includes('mcp'), calls: window.__pt.mcp.length, w: window.__pt.log.filter(l => l.k.startsWith('scans/')).length} });
    assert(!r.btn && r.box && !r.used && r.calls === 0 && r.w === 0, JSON.stringify(r));
    return 'hidden; use("mcp") never called; start() refused';
  });
  await vp.context().close();
}

/* ---------------- Exam setup: availability table labels (owner 14 Nov: "overlap") ----------------
   "Fluency" / "Problem solving" must sit in their own column: the drawn text of each label (measured with a Range, not the
   cell box) ends at least 4px before the first band cell, at desktop (380px settings panel), the narrow two-column width, and phone. */
async function availOverlap(browser, base, seed) {
  for (const width of [1280, 1000, 390]) {
    const page = await newPage(browser, base, seed, {width, theme: 'light'});
    await boot(page, base, '#exams');
    await check(`exams: availability labels clear of the cells @${width}`, page, async () => {
      await page.evaluate(() => EXAS.fresh()); await settle(page, 3000, 2);
      await page.click('[data-sall="all"]'); await settle(page, 3000, 2);
      const r = await page.evaluate(() => [...document.querySelectorAll('#availBox .avail tbody tr')].map(tr => {
        const th = tr.querySelector('th.k'), td = tr.querySelector('td'), rg = document.createRange(); rg.selectNodeContents(th.querySelector('span') || th);
        const rs = [...rg.getClientRects()].filter(x => x.width > 0), c = td.getBoundingClientRect();
        const right = Math.max(...rs.map(x => x.right)), hit = rs.some(x => x.right > c.left && x.left < c.right && x.bottom > c.top && x.top < c.bottom);
        return {lab: th.textContent.trim(), gap: Math.round(c.left - right), hit, lines: new Set(rs.map(x => Math.round(x.top))).size, val: td.textContent.trim()};
      }));
      const e = takeErrs(page); assert(!e.length, e.join(' | '));
      assert(r.length === 2, `${r.length} rows in the availability table`);
      for (const x of r) { assert(!x.hit, `“${x.lab}” overlaps the B2 cell`); assert(x.gap >= 4, `“${x.lab}” is ${x.gap}px from the B2 cell`) }
      assert(r.every(x => x.lines <= 2), `a label wraps onto ${Math.max(...r.map(x => x.lines))} lines (a word was split)`);
      return r.map(x => `${x.lab}: gap ${x.gap}px, ${x.lines} line${x.lines > 1 ? 's' : ''}, B2 ${x.val}`).join(' · ');
    });
    await page.context().close();
  }
}

/* QUEUE #2 and #4 (owner 14 Nov) on a generated paper.
   #2 "resizing is really unintuitive, it should just be drag the corner in and out diagonally": no − / + pill; dragging the
      corner handle changes EX.figscale and the drawn width in proportion, shows a live % only while dragging, lays the paper
      out once at the end (not on every move), clamps to 30-200%, double-click resets; on a touch phone a finger drag works.
   #4 "The dot point home looks stupid in a question" / "the i is fine": no dot-point line or Report link in the question; an ⓘ
      ends every source line and opens a card (dot points, band, kind, Report); outside click and Esc close it, keys work, and
      Report opens the form; the grading panel's question detail lists the dot points. */
async function genPaper(page) {
  await page.evaluate(() => EXAS.fresh()); await settle(page, 3000, 2);
  await page.click('[data-sall="all"]'); await settle(page, 2000, 2);
  await genClick(page, '#gGo');
  await page.waitForFunction(() => { const i = document.querySelector('#xInfo'); return i && !/Laying out/.test(i.textContent) && document.querySelector('#xWord') && document.querySelectorAll('#xPages .sheet').length }, null, {timeout: 90000});
  await settle(page, 5000, 2);
}
// the first diagram on the paper whose image has loaded, scrolled to the middle of the screen
// fix 13 Nov: wait for a re-layout of the paper to finish (the quiet-DOM settle alone can return while MathJax is still typesetting
// on a busy machine, and a control grabbed then is replaced a moment later)
const laidOut = async page => { await sleep(150); await page.waitForFunction(() => { const i = document.querySelector('#xInfo'); return i && !/Laying out/.test(i.textContent) }, null, {timeout: 60000}); await settle(page, 3000, 2) };
const figOnScreen = page => page.evaluate(() => {
  const w = [...document.querySelectorAll('#xPages .exfigw')].find(w => { const i = w.querySelector('img'); return i && i.complete && i.naturalWidth });
  if (!w) return null; w.scrollIntoView({block: 'center'}); return w.dataset.figw });
const figState = (page, k) => page.evaluate(k => { const w = document.querySelector(`#xPages [data-figw="${k}"]`), h = w.querySelector('.figh'), b = w.querySelector('.exfigbox').getBoundingClientRect(), hr = h.getBoundingClientRect();
  return {fs: EX.figscale[k] || 1, img: w.querySelector('img').getBoundingClientRect().width, box: {x: b.x, y: b.y, w: b.width, h: b.height}, hx: hr.x + hr.width / 2, hy: hr.y + hr.height / 2,
    hDisp: getComputedStyle(h).display, pct: getComputedStyle(w.querySelector('.figpct')).display, pctText: w.querySelector('.figpct').textContent} }, k);
/* ---------------- Exams on other question pools (fix 13 Nov) ----------------
   Found during the Review redesign: with the Review workload applied (1,499 approved questions instead of 1,576) a marking-guide
   sheet was 1,350 px (past A4) and a corner drag could not shrink a diagram (1.32 → 1.32). Every exam check above runs on one pool
   and one generator seed, so these generate exams on two pools (the live approved set, and the Review workload's) with several
   seeds and sizes, and check every sheet of the paper and the guide, that a question cut inside a part is put back together whole
   (for Word), that every diagram's corner handle can be grabbed, and that dragging a corner in shrinks the diagram.
   The seeds include the ones that failed before the fix. */
const POOL_RUNS = {live: [[1, 40], [4, 100], [5, 60]], workload: [[0, 60], [4, 100], [7, 80]]};
async function examPools(browser, base, pools) {
  await Promise.all(Object.entries(pools).map(async ([name, seed]) => {
    const page = await newPage(browser, base, seed, {width: 1280, theme: 'light'});
    await boot(page, base, '#exams');
    const errs = () => { const e = takeErrs(page); assert(!e.length, e.slice(0, 3).join(' | ')) };
    const waitPv = async () => { await page.waitForFunction(() => { const i = document.querySelector('#xInfo'); return i && !/Laying out/.test(i.textContent) && document.querySelector('#xWord') && document.querySelectorAll('#xPages .sheet').length }, null, {timeout: 120000}); await settle(page, 5000, 2) };
    const sheets = () => page.evaluate(() => {
      const host = document.querySelector('#xPages'), pr = document.createElement('div'); pr.style.cssText = 'height:297mm;width:1px;flex:none'; host.appendChild(pr);
      const H = pr.offsetHeight; pr.remove(); const sh = [...host.querySelectorAll('.sheet')];
      return {n: sh.length, H, over: sh.map((s, i) => [i + 1, s.offsetHeight, [...s.querySelectorAll('section.xq')].map(x => x.dataset.q).join('/')]).filter(([, h]) => h > H + 1),
        empty: sh.filter(s => !s.querySelector('.sheetbody').children.length).length} });
    const approved = await page.evaluate(() => B.questions.filter(q => !q.dup_of && inBank(q)).length);
    for (const [sd, marks] of POOL_RUNS[name]) {
      await check(`exams (${name} pool, ${approved} questions, seed ${sd}): ${marks}-mark paper and guide fit A4, handles grabbable`, page, async () => {
        await page.evaluate(s => { let a = 0x9e3779b9 + s * 7919; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }, sd);
        await page.evaluate(() => { if (document.body.classList.contains('xpv-on')) exClosePv() }); await settle(page, 1500, 2);
        // the same exam each run, through its Settings (a new exam each run would skip the earlier runs' questions)
        await page.evaluate(() => { if (EX.id) { EXV.view = 'setup'; EXV.setupFor = EX.id; exSaveView(); renderExams() } else EXAS.fresh() }); await settle(page, 2000, 2); await page.click('[data-sall="all"]'); await settle(page, 1500, 2);
        await page.evaluate(m => { for (const [id, v] of [['gMarks', m], ['gMcq', Math.round(m / 10)]]) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', {bubbles: true})) } }, marks);
        await genClick(page, '#gGo'); await waitPv();
        const tot = await page.evaluate(() => xMarks(EX.items.map(xq).filter(Boolean)));
        const ex = await sheets();
        await page.click('[data-xdoc="guide"]'); await waitPv();
        const gd = await sheets();
        // a question cut inside a part (data-cut pieces) is put back together for Word (exRejoin) with exactly its own text
        const rj = await page.evaluate(() => {
          const norm = t => t.replace(/\s+/g, ' ').trim(), cut = [...new Set([...document.querySelectorAll('#xPages section.xq [data-cut]')].map(e => e.closest('section.xq').dataset.q))];
          const cl = document.querySelector('#xPages').cloneNode(true); exRejoin(cl); const bad = [];
          for (const q of cut) { const want = document.createElement('div'); want.innerHTML = EXC.get(exCKey(xq(+q), 'guide', xQ(xq(+q), 0, 'guide'))) || '';
            const got = [...cl.querySelectorAll(`section.xq[data-q="${q}"] > .xqb`)].map(b => b.textContent).join('');
            if (norm(got) !== norm(want.textContent) || cl.querySelector(`section.xq[data-q="${q}"] [data-cut]`)) bad.push(q) }
          return {cut, bad} });
        await page.click('[data-xdoc="exam"]'); await waitPv();
        // every diagram's corner handle is what the pointer finds when its diagram is hovered (not clipped by the text box or covered)
        const ks = await page.evaluate(() => [...document.querySelectorAll('#xPages .exfigw')].map(w => w.dataset.figw)), hbad = [];
        for (const k of ks) {
          const b = await page.evaluate(k => { const w = document.querySelector(`#xPages [data-figw="${k}"]`); w.scrollIntoView({block: 'center'}); const r = w.querySelector('.exfigbox').getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 30)} }, k);
          await page.mouse.move(b.x, b.y);
          if (!await page.evaluate(k => { const h = document.querySelector(`#xPages [data-figh="${k}"]`), r = h.getBoundingClientRect(); if (!r.width) return false; const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!e && e.closest('[data-figh]') === h }, k)) hbad.push(k);
        }
        await page.mouse.move(2, 2);
        errs();
        // owner 18 Nov: the cover's marks block reads "Total marks: N", then per section "Section I – n marks (pages a–b)", the
        // questions to attempt and the time to allow; the pages agree with where each section's heading sits, the times add up
        const cv = await page.evaluate(() => { const sh = [...document.querySelectorAll('#xPages .sheet')], at = n => sh.findIndex(s => s.querySelector(`.xsechd[data-sec="${n}"]`)) + 1;
          const t = [...document.querySelectorAll('#xPages .cv-sec')].map(e => e.innerText.replace(/\s+/g, ' ').trim()), k = document.querySelector('#xPages .cv-secs')?.previousElementSibling?.textContent || '';
          return {t, k, p1: at(1), p2: at(2), n: sh.map(s => !!s.querySelector('section.xq')).lastIndexOf(true) + 1, W: EXSEC.mins(EX.time)} });   // n: the last sheet with a question (the z table and reference sheet follow)
        if (sd === POOL_RUNS[name][0][0]) { await page.evaluate(() => document.querySelectorAll('#xPv .xtool').forEach(e => e.style.visibility = 'hidden')); await (await page.$('#xPages .sheet')).screenshot({path: SHOTS + '/exam_cover_marks.png'}); await page.evaluate(() => document.querySelectorAll('#xPv .xtool').forEach(e => e.style.visibility = '')) }
        const mins = cv.t.map(x => { const m = x.match(/Allow about (?:(\d+) hours?)?(?: and )?(?:(\d+) minutes?)?/); return m ? (+m[1] || 0) * 60 + (+m[2] || 0) : 0 });
        // owner 18 Nov: the paper's source line is the QID only (no school or year)
        const srcs = await page.evaluate(() => [...document.querySelectorAll('#xPages .exsrcl')].map(e => e.textContent.trim()).filter(t => !/^QID \w+$/.test(t)));
        assert(!srcs.length, `source lines on the paper that are not just the QID: ${srcs.slice(0, 3).join(' | ')}`);
        // owner 18 Nov: no top rule and no footer on the cover, "Page n of N" on the others, no "Marks by topic" heading, the table toggles
        const ft = await page.evaluate(() => { const sh = [...document.querySelectorAll('#xPages .sheet')], cv = sh[0];
          return {cf: !!cv.querySelector('.sheetfoot'), f2: sh[1]?.querySelector('.sheetfoot span')?.textContent, n: sh.length, head: /marks by topic/i.test(cv.innerText),
            tbl: !!cv.querySelector('.extopictbl'), rule: getComputedStyle(cv.querySelector('.cv-head')).borderTopStyle} });
        assert(!ft.cf && ft.f2 === `Page 2 of ${ft.n}` && !ft.head && ft.tbl && ft.rule === 'none', `cover: ${JSON.stringify(ft)}`);
        // owner 19 Nov: generated order = meter band, then fluency before problem solving, then marks
        if (sd === POOL_RUNS[name][0][0]) {   // "Sort easiest first" on a shuffled exam gives the same order back
          await page.evaluate(() => { EX.items = EX.items.slice().reverse(); xsave(); exRelayout() }); await waitPv();
          await page.click('#exGSide [data-gsort]'); await waitPv() }
        const ordBad = await page.evaluate(() => { const qs = EX.items.map(xq).filter(Boolean), k = q => [Math.round(exEst(q)?.d ?? 3), exEst(q)?.kind === 'Problem solving' ? 1 : 0, +q.marks || 0];
          const bad = []; for (const t of ['mcq', 'w']) { const s = qs.filter(q => (q.type === 'mcq') === (t === 'mcq')); for (let i = 1; i < s.length; i++) { const a = k(s[i - 1]), b = k(s[i]); if (a[0] > b[0] || a[0] === b[0] && (a[1] > b[1] || a[1] === b[1] && a[2] > b[2])) bad.push(qid(s[i])) } } return bad });
        assert(!ordBad.length, 'out of order after Generate: ' + ordBad.slice(0, 5).join(', '));
        // owner 19 Nov: always an odd number of pages, padded with a marked blank page after the last question page
        const odd = await page.evaluate(() => { const sh = [...document.querySelectorAll('#xPages .sheet')], lastQ = sh.map(s => !!s.querySelector('section.xq')).lastIndexOf(true);
          return {n: sh.length, blanks: sh.filter(s => s.querySelector('.xblank')).length, after: sh.slice(lastQ + 1).filter(s => s.querySelector('.xblank')).length} });
        assert(odd.n % 2 === 1 && odd.blanks - odd.after === 1 && odd.after <= 1, `pages: ${JSON.stringify(odd)} (want an odd count; one blank after the cover, at most one after the questions)`);
        if (sd === POOL_RUNS[name][0][0]) {
          await pvClick(page, '#exPvTopic'); await waitPv();
          const off = await page.evaluate(() => ({tbl: !!document.querySelector('#xPages .sheet .extopictbl'), v: EX.bytopic}));
          await pvClick(page, '#exPvTopic'); await waitPv();
          const on = await page.evaluate(() => ({tbl: !!document.querySelector('#xPages .sheet .extopictbl'), v: EX.bytopic}));
          assert(!off.tbl && off.v === false && on.tbl && on.v === true, `topic table toggle: off ${JSON.stringify(off)}, on ${JSON.stringify(on)}`);
        }
        assert(cv.k === `Total marks: ${tot}` && cv.t.length === 2, `cover marks block: "${cv.k}", ${cv.t.length} section(s)`);
        assert(cv.t[0].startsWith(`Section I – `) && cv.t[0].includes(`(pages ${cv.p1}–${cv.p2 - 1})`) || cv.t[0].includes(`(page ${cv.p1})`), `Section I pages: "${cv.t[0]}" (heading on page ${cv.p1}, Section II from ${cv.p2})`);
        assert(cv.t[1].includes(`(pages ${cv.p2}–${cv.n})`) || cv.t[1].includes(`(page ${cv.p2})`), `Section II pages: "${cv.t[1]}" (from page ${cv.p2} of ${cv.n})`);
        assert(mins[0] > 0 && mins[0] + mins[1] === cv.W, `section times ${mins.join(' + ')} minutes, working time ${cv.W}`);
        assert(tot >= marks - 2 && tot <= marks + 2, `${tot} marks, asked for ${marks}`);
        assert(!ex.over.length, `exam sheet(s) taller than 297 mm (${ex.H}px): ${ex.over.map(([i, h, q]) => `p${i}=${h}px (Q ${q})`).join(', ')}`);
        assert(!gd.over.length, `marking-guide sheet(s) taller than 297 mm (${gd.H}px): ${gd.over.map(([i, h, q]) => `p${i}=${h}px (Q ${q})`).join(', ')}`);
        assert(!ex.empty && !gd.empty, `${ex.empty + gd.empty} empty sheet(s)`);
        assert(!rj.bad.length, `question(s) ${rj.bad.join(', ')} are not put back together whole for Word`);
        assert(!hbad.length, `${hbad.length} of ${ks.length} diagram corner handle(s) cannot be grabbed (clipped or covered): ${hbad.slice(0, 5).join(', ')}`);
        return `${tot} marks: paper ${ex.n} sheets, guide ${gd.n} sheets, ${ks.length} diagram handles grabbable${rj.cut.length ? `, Q ${rj.cut.join(', ')} cut inside a part and rejoined` : ''}`;
      });
    }
    await check(`exams (${name} pool): a diagram pushed onto the next page stays under the pointer, and a drag in shrinks it`, page, async () => {
      // the diagram with the least room below it on its sheet: dragging it out moves its question to the next page, which used to
      // throw it off screen, so the next drag on its corner found nothing ("scale 1.32 → 1.32")
      const roomOf = `(w => { const sb = w.closest('.sheetbody'), pr = document.createElement('div'); pr.style.height = '250mm'; sb.appendChild(pr); const H = pr.getBoundingClientRect().height; pr.remove();
        const last = [...sb.children].pop(); return sb.getBoundingClientRect().top + H - last.getBoundingClientRect().bottom })`;
      // the generated paper depends on the pool: if no diagram can move (each one heads its sheet), regenerate, up to 6 tries
      // (13 Nov: hiding the CSSA 2022 duplicate whole changed the live pool's paper and left none movable)
      const pick = () => page.evaluate(roomOf => { const room = eval(roomOf); let best = null, bv = -1e9;
        document.querySelectorAll('#xPages .exfigw').forEach(w => { const i = w.querySelector('img'); if (!i || !i.complete || !i.naturalWidth) return;
          const blk = w.closest('.xblk'); if (blk === blk.parentElement.firstElementChild) return;   // the first block on a sheet cannot move to the next
          const v = w.querySelector('.exfigbox').getBoundingClientRect().height - room(w); if (v > bv) { bv = v; best = w.dataset.figw } });
        if (best) document.querySelector(`#xPages [data-figw="${best}"]`).scrollIntoView({block: 'center'}); return best }, roomOf);
      let k = await pick();
      for (let i = 0; !k && i < 6; i++) { await genClick(page, '#exPvRegen'); await settle(page, 1500, 2); k = await pick() }
      assert(k, 'no loaded diagram on the paper'); await settle(page, 1000, 2);
      const sheetOf = k => page.evaluate(k => [...document.querySelectorAll('#xPages .sheet')].indexOf(document.querySelector(`#xPages [data-figw="${k}"]`).closest('.sheet')) + 1, k);
      const grab = async () => { const a = await figState(page, k); await page.mouse.move(a.box.x + a.box.w / 2, a.box.y + Math.min(a.box.h / 2, 30)); return figState(page, k) };
      const p0 = await sheetOf(k), a = await grab(), room = await page.evaluate(([k, roomOf]) => eval(roomOf)(document.querySelector(`#xPages [data-figw="${k}"]`)), [k, roomOf]);
      const dy = Math.max(40, Math.min(room + 80, a.box.h * 0.9)), dx = dy * a.box.w / (2 * a.box.h);
      await page.mouse.move(a.hx, a.hy); await page.mouse.down(); await page.mouse.move(a.hx + dx, a.hy + dy, {steps: 6}); await page.mouse.up(); await laidOut(page);
      const b = await grab(), p1 = await sheetOf(k);
      assert(b.fs > 1.05, `drag out: ${a.fs} → ${b.fs}`);
      assert(Math.abs(b.box.y - a.box.y) < 3 && b.hDisp !== 'none', `after the drag out the diagram moved on screen from y ${Math.round(a.box.y)} to ${Math.round(b.box.y)} (page ${p0} → ${p1})`);
      await page.mouse.move(b.hx, b.hy); await page.mouse.down(); await page.mouse.move(b.hx - 15, b.hy - 25, {steps: 5}); await page.mouse.up(); await laidOut(page);
      const c = await figState(page, k);
      await page.evaluate(() => { EX.figscale = {}; xsave(); exRelayout() }); await laidOut(page);
      errs();
      assert(c.fs < b.fs && c.img < b.img, `drag in after a drag out: ${b.fs} → ${c.fs} (image ${Math.round(b.img)} → ${Math.round(c.img)} px)`);
      return `${k} (${Math.round(room)} px free on page ${p0}): 100% → ${Math.round(b.fs * 100)}% (now on page ${p1}, stayed in place) → ${Math.round(c.fs * 100)}%`;
    });
    await page.context().close();
  }));
}

async function queueChecks(browser, base, seed) {
  const page = await newPage(browser, base, seed, {width: 1280, theme: 'light'});
  await boot(page, base, '#exams');
  const errs = () => { const e = takeErrs(page); assert(!e.length, e.slice(0, 3).join(' | ')) };
  await genPaper(page);
  // count paper layouts (xPreview) while dragging
  await page.evaluate(() => { const f = window.xPreview; window.__lay = 0; window.xPreview = function () { window.__lay++; return f.apply(this, arguments) } });
  let k = null;
  await check('exams: diagram resize by dragging the corner', page, async () => {
    k = await figOnScreen(page); assert(k, 'no diagram on the paper'); await settle(page, 1500, 2);
    const pill = await page.evaluate(() => document.querySelectorAll('#xPages .figctl, #xPages [data-figs], #xPages [data-figr]').length);
    assert(!pill, `${pill} old − / + / reset controls still on the paper`);
    const s0 = await figState(page, k);
    assert(s0.hDisp === 'none', 'the corner handle shows without hover');
    await page.mouse.move(s0.box.x + s0.box.w / 2, s0.box.y + s0.box.h / 2);
    const s1 = await figState(page, k);
    assert(s1.hDisp !== 'none', 'hovering the diagram does not show the corner handle');
    assert(Math.abs(s1.hx - (s0.box.x + s0.box.w)) < 12 && Math.abs(s1.hy - (s0.box.y + s0.box.h)) < 12, `the handle is not on the diagram's corner (handle ${Math.round(s1.hx)},${Math.round(s1.hy)}; corner ${Math.round(s0.box.x + s0.box.w)},${Math.round(s0.box.y + s0.box.h)})`);
    assert(s1.pct === 'none', 'the live % shows before any drag');
    const lay0 = await page.evaluate(() => window.__lay);
    await page.mouse.move(s1.hx, s1.hy); await page.mouse.down();
    await page.mouse.move(s1.hx + 20, s1.hy + 30, {steps: 4}); await page.mouse.move(s1.hx + 40, s1.hy + 60, {steps: 4}); await page.waitForTimeout(80);
    const mid = await figState(page, k), layMid = await page.evaluate(() => window.__lay);
    assert(mid.pct !== 'none' && /^\d+%$/.test(mid.pctText) && +mid.pctText.slice(0, -1) > 100, `no live % while dragging (${mid.pct}, “${mid.pctText}”)`);
    assert(layMid === lay0, `the paper was laid out ${layMid - lay0} time(s) during the drag`);
    await page.mouse.up(); await settle(page, 4000, 2);
    const s2 = await figState(page, k), lay1 = await page.evaluate(() => window.__lay);
    errs();
    assert(s2.fs > 1.05 && s2.fs <= 2, `EX.figscale[${k}] is ${s2.fs} after dragging out`);
    assert(String(s2.fs) === mid.pctText.slice(0, -1) / 100 + '', `stored ${s2.fs}, the live % said ${mid.pctText}`);
    const ratio = s2.img / s0.img;
    assert(Math.abs(ratio - s2.fs / s0.fs) < 0.04, `image width ×${ratio.toFixed(2)} for scale ×${(s2.fs / s0.fs).toFixed(2)}`);
    assert(s2.pct === 'none', 'the live % stays after the drag');
    assert(lay1 - lay0 === 1, `the paper was laid out ${lay1 - lay0} time(s) after the drag, expected 1`);
    const saved = await page.evaluate(k => (JSON.parse(localStorage.getItem('qg_exam') || '{}').figscale || {})[k], k);
    assert(saved === s2.fs, `kept in the exam: ${saved}`);
    // diagonal: a drag inwards along the diagonal shrinks it
    const a = await figState(page, k); await page.mouse.move(a.box.x + a.box.w / 2, a.box.y + a.box.h / 2); const a1 = await figState(page, k);
    await page.mouse.move(a1.hx, a1.hy); await page.mouse.down(); await page.mouse.move(a1.hx - 15, a1.hy - 25, {steps: 5}); await page.mouse.up(); await settle(page, 4000, 2);
    const s3 = await figState(page, k);
    assert(s3.fs < s2.fs && s3.img < s2.img, `dragging the corner inwards: ${s2.fs} → ${s3.fs}`);
    return `${k}: 100% → ${Math.round(s2.fs * 100)}% (image ${Math.round(s0.img)} → ${Math.round(s2.img)} px), in → ${Math.round(s3.fs * 100)}%; 1 layout`;
  });
  await check('exams: diagram resize clamps to 30–200%, double-click resets', page, async () => {
    assert(k, 'no diagram');
    const drag = async (dx, dy) => { await page.evaluate(k => document.querySelector(`#xPages [data-figw="${k}"]`).scrollIntoView({block: 'center'}), k); await settle(page, 800, 2); const a = await figState(page, k); await page.mouse.move(a.box.x + a.box.w / 2, a.box.y + a.box.h / 2); const b = await figState(page, k);
      await page.mouse.move(b.hx, b.hy); await page.mouse.down(); await page.mouse.move(b.hx + dx, b.hy + dy, {steps: 6}); await page.mouse.up(); await settle(page, 4000, 2); return figState(page, k) };
    const big = await drag(900, 1400); const small = await drag(-1500, -2400);
    const colW = await page.evaluate(k => { const fw = document.querySelector(`#xPages [data-figw="${k}"]`); const col = fw?.closest('.xcol, .xbody, .xpage') || fw?.parentElement; return col ? col.getBoundingClientRect().width : 0 }, k);
    // 17 Nov: a diagram already wide at 100% stops at the column width before 200% (the exam is random, so which diagram varies)
    assert(big.fs === 2 || (big.fs > 1 && big.box.w >= colW * 0.9), `dragging far out gives ${big.fs} (width ${Math.round(big.box.w)} of column ${Math.round(colW)}), expected 2 or the full column`); assert(small.fs === 0.3, `dragging far in gives ${small.fs}, expected 0.3`);
    await page.evaluate(k => document.querySelector(`#xPages [data-figw="${k}"]`).scrollIntoView({block: 'center'}), k); await settle(page, 800, 2); const c = await figState(page, k); await page.mouse.move(c.box.x + c.box.w / 2, c.box.y + c.box.h / 2); const d = await figState(page, k);
    await page.mouse.dblclick(d.hx, d.hy); await laidOut(page);
    const r = await page.evaluate(k => ({has: k in EX.figscale, fs: EX.figscale[k]}), k), e = await figState(page, k);
    errs(); assert(!r.has, `after a double-click EX.figscale[${k}] is ${r.fs}, expected it removed (100%)`);
    assert(e.box.w > small.box.w * 2, 'the diagram did not grow back after the reset');
    // keyboard: the handle is a slider; → steps 5%
    await page.focus(`#xPages [data-figh="${k}"]`); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(900); await laidOut(page);
    const kb = await page.evaluate(k => ({fs: EX.figscale[k], now: document.querySelector(`#xPages [data-figh="${k}"]`)?.getAttribute('aria-valuenow'), focus: document.activeElement?.dataset?.figh}), k);
    assert(kb.fs === 1.1 && kb.now === '110', `two → presses: ${JSON.stringify(kb)}`);
    assert(kb.focus === k, 'focus left the handle after the keyboard resize');
    await page.keyboard.press('Home'); await page.waitForTimeout(900); await settle(page, 3000, 2);
    return `far out ${big.fs * 100}%, far in ${small.fs * 100}%, double-click → 100%, keys → 110% → Home`;
  });
  // checker report 18 Nov (owner: "lets do 2,3,4,6"): "Dragging a diagram onto the next page doesn't work. On an exam where a diagram has
  //   been pushed to the next page, dragging it to shrink it does nothing." A diagram near the foot of a sheet is grown until the paper
  //   moves it to the next sheet, then its corner is dragged in on the new sheet: the scale must change both times.
  await check('exams: a diagram grown onto the next page can be shrunk there by dragging', page, async () => {
    const at = k => page.evaluate(k => { const w = document.querySelector(`#xPages [data-figw="${k}"]`); return w ? [...document.querySelectorAll('#xPages .sheet')].indexOf(w.closest('.sheet')) : -1 }, k);
    const drag = async (k, dx, dy) => { await page.evaluate(k => document.querySelector(`#xPages [data-figw="${k}"]`).scrollIntoView({block: 'center'}), k); await settle(page, 800, 2);
      const a = await figState(page, k); await page.mouse.move(a.box.x + a.box.w / 2, a.box.y + a.box.h / 2); const b = await figState(page, k);
      await page.mouse.move(b.hx, b.hy); await page.mouse.down(); await page.mouse.move(b.hx + dx, b.hy + dy, {steps: 6}); await page.mouse.up(); await laidOut(page); return figState(page, k) };
    // 18 Nov: answer lines set to 0 so questions pack together (with the taller headings and line spacing, every question with a locally
    // loaded diagram started its own sheet, and one that starts a sheet can only grow in place)
    const lines0 = await page.evaluate(() => { const keep = JSON.stringify(EX.lines || {}); [...document.querySelectorAll('#xPages [data-ln]')].forEach(b => { EX.lines[b.dataset.ln] = 0 }); xsave(); exRelayout(); return keep });
    await laidOut(page);
    // 19 Nov: with the generated order (band, then kind, then marks) every question with a loaded diagram can start its own sheet, and
    // one that starts a sheet can only grow in place. So each try is a small exam of its own: the shortest written question without a
    // diagram, then the question holding the diagram (they share a sheet; growing the diagram pushes it to the next)
    const order0 = await page.evaluate(() => JSON.stringify(EX.items));
    const tries = await page.evaluate(() => { const secs = [...document.querySelectorAll('#xPages section.xq.wr')];
      const hasFig = sc => [...sc.querySelectorAll('.exfigw img')].some(i => i.complete && i.naturalWidth);
      const short = secs.filter(sc => !hasFig(sc)).sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0];
      return {short: short ? +short.dataset.q : null, figs: [...new Set(secs.filter(hasFig).map(sc => +sc.dataset.q))].slice(0, 8)} });
    let res = null;
    for (const fq of tries.figs) {
      if (!tries.short) break;
      await page.evaluate(([a, b]) => { EX.items = [a, b]; EX.figscale = {}; xsave(); exRelayout() }, [tries.short, fq]); await laidOut(page); await settle(page, 2500, 2);
      const k = await page.evaluate(q => { const w = [...document.querySelectorAll(`#xPages section.xq[data-q="${q}"] .exfigw`)].find(w => { const i = w.querySelector('img'); return i && i.complete && i.naturalWidth });
        return w && w.closest('.xblk')?.previousElementSibling ? w.dataset.figw : null }, fq);
      if (!k) continue;
      const p0 = await at(k), s0 = await figState(page, k), g = await drag(k, 350, 520), p1 = await at(k);
      if (p1 === p0) continue;
      const sh = await drag(k, -120, -180);
      res = {k, p0, p1, fs0: s0.fs, grown: g.fs, shrunk: sh.fs}; break;
    }
    const ks = tries.figs;
    await page.evaluate(([l, o]) => { EX.figscale = {}; EX.lines = JSON.parse(l); EX.items = JSON.parse(o); xsave(); exRelayout() }, [lines0, order0]); await laidOut(page); errs();
    assert(res, `no diagram moved to the next sheet when grown (tried ${ks.length})`);
    assert(res.grown > res.fs0 && res.shrunk < res.grown, `grown ${res.fs0} → ${res.grown} (sheet ${res.p0 + 1} → ${res.p1 + 1}), then dragged in → ${res.shrunk}`);
    return `${res.k}: ${Math.round(res.fs0 * 100)}% → ${Math.round(res.grown * 100)}% moved it to sheet ${res.p1 + 1}; dragged in there → ${Math.round(res.shrunk * 100)}%`;
  });
  await check('export: a resized diagram keeps its size in the HTML download', page, async () => {
    assert(k, 'no diagram');
    await page.evaluate(k => { EX.figscale[k] = 1.5; xsave(); exRelayout() }, k); await settle(page, 5000, 2);
    const n0 = await page.evaluate(() => window.__pt.downloads.length); await pvClick(page, '#xDl');
    await page.waitForFunction(n => window.__pt.downloads.length > n, n0, {timeout: 30000});
    const d = await page.evaluate(() => window.__pt.downloads[window.__pt.downloads.length - 1]);
    const h = fs.readFileSync(path.join(DL, d.filename.replace(/[^\w.\- ]+/g, '_')), 'utf8'), body = h.slice(h.indexOf('<body>'));
    errs(); assert(new RegExp(`data-figw="${k}" style="--fs:1\\.5"`).test(body), 'the download lost the diagram size');
    assert(/\.exfigw \.figslot\{zoom:var\(--fs,1\)/.test(h), 'the download has no rule applying --fs');
    assert(!/class="(figpct|figh)\b/.test(body), 'the download has the handle or the live %');
    await page.evaluate(k => { delete EX.figscale[k]; xsave(); exRelayout() }, k); await settle(page, 5000, 2);
    return `${d.filename}: ${k} at 150%`;
  });

  /* ---- #4: Report beside the QID (owner 18 Nov: "I think the i on each question is useless. Remove it. just put the report button as a
     text which changes on hover next to the qid") ---- */
  await check('paper: each source line ends with a Report link (no ⓘ, no dot-point line)', page, async () => {
    const r = await page.evaluate(() => ({old: document.querySelectorAll('#xPages .exalpha, #xPages .exdot, #xPages [data-rep], #xPages .exinfo, #qiPop').length,
      src: document.querySelectorAll('#xPages .xq .xsrc').length, rep: [...document.querySelectorAll('#xPages .xq .xsrc > .exsrcl + button.exrep.scr-only[data-qinfo]')].filter(b => /^Report(ed \(\d+\))?$/.test(b.textContent)).length,
      txt: [...document.querySelectorAll('#xPages .xq .xsrc .exsrcl')].some(x => /Y1[12]-\d{3}/.test(x.innerText))}));
    errs(); assert(!r.old, `${r.old} old ⓘ / dot-point line / card element(s) on the paper`); assert(!r.txt, 'a source line still shows a dot point');
    assert(r.src > 0 && r.rep === r.src, `${r.rep} Report links for ${r.src} source lines`);
    return `${r.rep} source lines, each ending with Report`;
  });
  await check('paper: Report opens the report form; Esc closes it and the preview stays open', page, async () => {
    const q = await page.evaluate(() => { const b = document.querySelector('#xPages [data-qinfo]'); b.scrollIntoView({block: 'center'}); EXV.sel = null; return +b.dataset.qinfo });
    await settle(page, 800, 2); const sel0 = await page.evaluate(() => EXV.sel);
    await page.click(`#xPages [data-qinfo="${q}"]`);
    const f = await page.evaluate(() => ({dlg: !!document.querySelector('#repDlg .repdlg') && !document.querySelector('#repDlg').hidden, sel: EXV.sel}));
    assert(f.dlg, 'Report did not open the form'); assert(f.sel === sel0, 'clicking Report also selected the question');
    await page.keyboard.press('Escape');
    const g = await page.evaluate(() => ({dlg: !document.querySelector('#repDlg')?.hidden, pv: document.body.classList.contains('xpv-on')}));
    errs(); assert(!g.dlg && g.pv, `Esc on the form: ${JSON.stringify(g)}`);
    return `QID ${q}: form opened and closed`;
  });
  await check('exams: the grading panel lists the dot points', page, async () => {
    const q = await page.evaluate(() => +document.querySelector('#xPages [data-qinfo]').dataset.qinfo);
    await page.evaluate(q => { if (!EXV.grade) document.querySelector('#exGrade')?.click(); exSelect(q, 'list') }, q); await settle(page, 2000, 2);
    const r = await page.evaluate(() => { const d = document.querySelector('#exGSide .gq.sel .gdots'); return d && d.innerText });
    errs(); assert(r && /Dot points/.test(r) && (/Y1[12]-\d{3}/.test(r) || /No dot point yet|syllabus|No 2024/.test(r)), 'no dot points in the selected question\'s detail: ' + String(r).slice(0, 120));
    // review 14 Nov: parts filed under the same dot point share one row instead of repeating it
    const dup = await page.evaluate(() => { let n = 0, m = 0; [...document.querySelectorAll('#xPages [data-qinfo]')].forEach(b => { const q = xq(+b.dataset.qinfo); if (!q) return;
      const u = document.createElement('div'); u.innerHTML = qiDotsList(q, 'gdotl'); const t = [...u.querySelectorAll('.gdotl-d')].map(d => d.textContent); n += t.length - new Set(t).size; if (/\)\(/.test(u.textContent)) m++ }); return {n, m} });
    assert(!dup.n, `${dup.n} repeated dot-point row(s) in the grading panel`);
    // owner 18 Nov: Report in the grading panel too
    await page.click('#exGSide .gq.sel [data-grep]');
    const rf = await page.evaluate(() => !!document.querySelector('#repDlg .repdlg') && !document.querySelector('#repDlg').hidden);
    assert(rf, 'Report in the grading panel did not open the report form'); await page.keyboard.press('Escape');
    return r.replace(/\s+/g, ' ').slice(0, 90) + ` · ${dup.m} question(s) share a row across parts`;
  });
  // owner 19 Nov: "I need a button to delete a question from an exam ... Should it even be togglable? It seems like it should always be there"
  await check('exams: the Questions panel is always there on a wide screen; Remove from exam, then Undo puts it back in place', page, async () => {
    const ui = await page.evaluate(() => ({h: document.querySelector('#exGSide h3')?.textContent, btn: getComputedStyle(document.querySelector('#exGrade')).display, side: getComputedStyle(document.querySelector('#exGSide')).display}));
    assert(ui.h === 'Questions' && ui.btn === 'none' && ui.side !== 'none', 'panel: ' + JSON.stringify(ui));
    const before = await page.evaluate(() => EX.items.slice()), id = before[1];
    await page.evaluate(id => exSelect(id, 'list'), id); await settle(page, 1500, 2);
    await page.click('#exGSide .gq.sel [data-grm]'); await waitPv2(page);
    const mid = await page.evaluate(() => EX.items.slice());
    assert(mid.length === before.length - 1 && !mid.includes(id), `Remove: ${before.length} -> ${mid.length}`);
    await page.click('#exGSide [data-gundo]'); await waitPv2(page);
    const after = await page.evaluate(() => EX.items.slice());
    errs(); assert(JSON.stringify(after) === JSON.stringify(before), 'Undo did not put it back in the same place');
    return `QID ${id} removed (${mid.length} questions), Undo restored Q2`;
  });
  await page.context().close();

  /* touch phone: a finger drag on the handle, and the ⓘ card fits the screen */
  const tp = await newPage(browser, base, seed, {width: 390, theme: 'dark', touch: true});
  await boot(tp, base, '#exams');
  await check('exams: diagram resize and Report on a touch phone', tp, async () => {
    await genPaper(tp);
    const k = await figOnScreen(tp); assert(k, 'no diagram'); await settle(tp, 1500, 2);
    const s0 = await figState(tp, k);
    assert(s0.hDisp !== 'none', 'no corner handle on a touch screen (there is no hover)');
    const hr = await tp.evaluate(k => document.querySelector(`#xPages [data-figh="${k}"]`).getBoundingClientRect().width, k);
    const cdp = await tp.context().newCDPSession(tp), pt = (x, y) => [{x, y, id: 1, radiusX: 4, radiusY: 4, force: 1}];
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: pt(s0.hx, s0.hy)});
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: pt(s0.hx + i * 6, s0.hy + i * 9)});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await settle(tp, 4000, 2);
    const s1 = await figState(tp, k);
    assert(s1.fs > 1.05, `EX.figscale after a finger drag: ${s1.fs}`); assert(s1.img > s0.img * 1.05, `image ${Math.round(s0.img)} → ${Math.round(s1.img)} px`);
    const b = await tp.evaluate(() => { const b = document.querySelector('#xPages [data-qinfo]'); b.scrollIntoView({block: 'center'}); const r = b.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width} });
    await settle(tp, 800, 2); const b2 = await tp.evaluate(() => { const r = document.querySelector('#xPages [data-qinfo]').getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width} });
    await tp.tap('#xPages [data-qinfo]');
    const c = await tp.evaluate(() => { const p = document.querySelector('#repDlg .repdlg'); if (!p) return null; const r = p.getBoundingClientRect(); return {l: r.left, r: r.right, t: r.top, b: r.bottom, W: innerWidth, H: innerHeight, sx: document.documentElement.scrollWidth} });
    const e = takeErrs(tp); assert(!e.length, e.join(' | '));
    assert(c, 'tapping Report did not open the report form');
    assert(c.l >= 0 && c.r <= c.W && c.t >= 0 && c.b <= c.H + 1, `report form off screen: ${JSON.stringify(c)}`);   // the form is a full-width sheet on a phone
    assert(b2.w >= 16 && hr >= 8, `Report ${b2.w.toFixed(0)} px, handle ${hr.toFixed(0)} px wide on the phone paper`);
    // review 14 Nov: paper controls (− N lines +, the corner handle) scroll UNDER the sticky toolbar, not over it
    await tp.keyboard.press('Escape');
    const under = await tp.evaluate(async () => { const t = document.querySelector('.expv .xtool').getBoundingClientRect(), sc = document.querySelector('.xpv') || document.scrollingElement;
      const els = [...document.querySelectorAll('#xPages .lnctl, #xPages .figh')].filter(e => e.getBoundingClientRect().width); let bad = [], n = 0;
      for (const e of els.slice(0, 12)) { const r0 = e.getBoundingClientRect(); sc.scrollTop += r0.top - (t.top + t.height / 2); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; if (y < t.top + 2 || y > t.bottom - 2) continue; n++;
        const hit = document.elementFromPoint(x, y); if (!hit || !hit.closest('.xtool')) bad.push(e.className) }
      return {n, bad} });
    assert(under.n > 0, 'could not scroll a paper control under the toolbar');
    assert(!under.bad.length, `${under.bad.length} paper control(s) drawn over the sticky toolbar: ${under.bad.slice(0, 3).join(', ')}`);
    return `${k}: finger drag → ${Math.round(s1.fs * 100)}%; ⓘ ${b2.w.toFixed(0)} px, form ${Math.round(c.r - c.l)} px wide; ${under.n} controls stay under the toolbar`;
  });
  await tp.context().close();
}

/* ---------------- Data on demand (Fix 1, owner 14 Nov: "Ok we should run Fix 1 and 2") ----------------
   Plan "Questgen architecture plan: before imports resume", Fix 1: keep the published page small; fetch data only when needed.
   The page loads the course index (data/bank/<course>/index.gz.json since job 2; the details file right after) and the dot points at start, never bank.json; a topic's
   question text (one file per topic home, tools/bank_split.py) loads when a view shows it; image packs come from the address in
   data/assets.json when it has one (the asset store), else from the published file. */
async function dataSplit(browser, base, seed) {
  // job 3: a pack served from the asset store (/_blob/<id>) is logged as the published path data/assets.json maps it to
  const blob = Object.fromEntries(Object.entries((JSON.parse(fs.readFileSync(path.join(SITE, 'data/assets.json'), 'utf8')).assets) || {}).map(([k, a]) => [String(a.url || a).replace(/^\//, ''), k]));
  const log = p => { p._req = []; p.on('request', r => { const u = r.url(); if (u.startsWith(base)) { const x = u.slice(base.length).split('?')[0]; p._req.push({u: blob[x] || x, t: Date.now(), store: !!blob[x]}) } });
    p._done = {}; p.on('requestfinished', r => { const u = r.url().slice(base.length).split('?')[0]; if (!(u in p._done)) p._done[u] = Date.now() }) };
  const topicRe = /^data\/bank\/[^/]+\/(?!index\.json)(?![^/]+\.gz\.json$)[^/]+\.json$/;
  const errs = p => { const e = takeErrs(p); assert(!e.length, e.slice(0, 3).join(' | ')) };
  const openSub = async p => { await p.click('#list .subrow[data-sel]:not(.none)'); await p.waitForSelector('#list .cards .card', {timeout: 15000}); await settle(p, 5000, 2) };
  const page = await newPage(browser, base, seed, {width: 1280, theme: 'light'});
  log(page);
  await boot(page, base, '#bank');
  await check('data: the index loads first, no question text at start', page, async () => {
    const urls = page._req.map(x => x.u), ix = urls.findIndex(u => /^data\/bank\/[^/]+\/index\.gz\.json$/.test(u));
    const r = await page.evaluate(() => ({index: QG.courseData.bank, files: B.files.length, got: QG.got.size, n: B.questions.length, text: B.questions.some(q => 'stem' in q || q.parts.some(p => 'latex' in p))}));
    errs(page);
    assert(ix >= 0, `the index ${r.index} was never requested: ${urls.filter(u => u.startsWith('data/')).join(' ')}`);
    assert(!urls.includes('data/bank.json'), 'the page still loads data/bank.json');
    assert(urls.includes('data/assets.json'), 'data/assets.json (image addresses) was not read at start');
    const topics = urls.filter(u => topicRe.test(u));
    assert(!topics.length, `the Bank home loaded ${topics.length} topic file(s) before any topic opened: ${topics.slice(0, 3).join(' ')}`);
    assert(!r.got && !r.text, `question text is in the page before any view asked for it (${r.got} questions loaded)`);
    return `${r.index} at start (start requests: ${urls.filter(u => u.startsWith('data/')).join(', ')}); ${r.n} questions, ${r.files} topic files, none loaded`;
  });
  await check('data: a topic\'s file loads when the topic opens, and only its files', page, async () => {
    const n0 = page._req.length;
    await openSub(page);
    const r = await page.evaluate(() => { const t = TOPICS.byKey[sel]; return {sel, need: [...new Set(t.qs.map(q => B.files[q.h].f))], all: t.qs.every(q => QG.has(q)),
      cards: document.querySelectorAll('#list .card').length, pend: document.querySelectorAll('#list [data-qpend]').length, mjx: document.querySelectorAll('#list mjx-container').length} });
    const got = [...new Set(page._req.slice(n0).map(x => x.u).filter(u => topicRe.test(u)))];
    errs(page);
    const ixAt = Object.entries(page._done).find(([u]) => /index\.gz\.json$/.test(u))?.[1], first = page._req.find(x => topicRe.test(x.u));
    assert(ixAt && first && first.t >= ixAt, 'a topic file was requested before the index had arrived');
    assert(r.need.every(f => got.includes(f)), `opening ${r.sel} did not load ${r.need.filter(f => !got.includes(f)).join(' ')}`);
    assert(got.every(f => r.need.includes(f)), `opening ${r.sel} also loaded ${got.filter(f => !r.need.includes(f)).join(' ')}`);
    assert(r.all && r.cards > 0 && !r.pend && r.mjx > 0, `${r.cards} cards, ${r.pend} still loading, ${r.mjx} maths`);
    // a second visit reads nothing again
    const n1 = page._req.length; await page.click('#list [data-home]'); await settle(page, 3000, 2); await openSub(page);
    const again = page._req.slice(n1).map(x => x.u).filter(u => topicRe.test(u));
    assert(!again.length, `reopening the topic fetched ${again.join(' ')} again`);
    return `${r.sel.split('|').pop()}: ${got.length} file(s) (${got.map(f => f.split('/').pop()).join(', ')}), ${r.cards} cards, ${r.mjx} maths`;
  });
  // which image packs this topic reads (redraws and/or page-image packs): the next check moves one of them to a "store" address
  const packs = [...new Set(page._req.map(x => x.u).filter(u => /^data\/(img|svg|cmp)\/[^/]+\.json$/.test(u)))];
  await page.context().close();

  await check('data: images come from data/assets.json when it lists them, else from the published file', null, async () => {
    assert(packs.length, 'the topic opened above read no image pack: pick a topic with diagrams');
    const moved = packs[0], storeUrl = '__store/' + moved.replace(/\//g, '_');
    const p = await newPage(browser, base, seed, {width: 1280, theme: 'light'}); log(p);
    await p.route(u => /\/data\/assets\.json(\?|$)/.test(u.href), r => r.fulfill({status: 200, contentType: 'application/json',
      body: JSON.stringify({v: 1, assets: {[moved]: {url: '/' + storeUrl, sha256: 'test', bytes: 0}}})}));
    await p.route(u => u.href.startsWith(base + '__store/'), r => r.fulfill({status: 200, contentType: 'application/json', body: fs.readFileSync(path.join(SITE, moved))}));
    try {
      await boot(p, base, '#bank'); await openSub(p);
      await p.waitForFunction(() => [...document.querySelectorAll('#list img.fig')].every(i => i.getAttribute('src') || /missing/i.test(i.alt)), null, {timeout: 15000}).catch(() => {});
      await settle(p, 4000, 2);
      const urls = p._req.map(x => x.u), r = await p.evaluate(() => { const im = [...document.querySelectorAll('#list img.fig')];
        return {n: im.length, missing: im.filter(i => /missing|not available/i.test(i.alt) || !i.getAttribute('src')).map(i => i.dataset.k), broken: im.filter(i => i.complete && i.getAttribute('src') && !i.naturalWidth).length} });
      const e = takeErrs(p); assert(!e.length, e.slice(0, 3).join(' | '));
      assert(urls.includes(storeUrl), `${moved} is listed in data/assets.json but /${storeUrl} was never fetched`);
      assert(!urls.includes(moved), `${moved} was still fetched from the published file`);
      const rest = packs.slice(1);
      assert(rest.every(u => urls.includes(u)), `packs not in the manifest did not come from their published files: ${rest.filter(u => !urls.includes(u)).join(' ')}`);
      assert(r.n > 0 && !r.missing.length && !r.broken, `${r.n} diagrams, missing ${r.missing.slice(0, 4).join(' ')}, ${r.broken} broken`);
      return `${moved} from the store address; ${rest.length} other pack(s) from the published files; ${r.n} diagrams drawn`;
    } finally { await p.context().close() }
  });

  // 390 px with slow topic files: the loading state and the filled-in page both fit; Review fills its placeholder itself
  const tp = await newPage(browser, base, seed, {width: 390, theme: 'light'}); log(tp);
  let hold = true, fail = false; const held = [];
  await tp.route(u => topicRe.test(u.href.slice(base.length).split('?')[0]), r => fail ? r.fulfill({status: 500, body: 'down'}) : hold ? held.push(r) : r.continue());
  const release = () => { hold = false; held.splice(0).forEach(r => r.continue()) };
  await boot(tp, base, '#bank');
  await check('data: 390px while a topic loads, and after', tp, async () => {
    await tp.evaluate(() => { const b = [...document.querySelectorAll('#list .subrow[data-sel]:not(.none)')][0]; b && b.click() });
    await tp.waitForFunction(() => /Loading questions/.test(document.querySelector('#list')?.innerText || ''), null, {timeout: 8000});
    const w = await tp.evaluate(() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, cards: document.querySelectorAll('#list .card').length}));
    assert(w.sw <= w.cw + 1, `while loading the page is ${w.sw}px wide in ${w.cw}px`);
    assert(!w.cards, 'cards were drawn before their text arrived');
    release(); await tp.waitForSelector('#list .cards .card', {timeout: 15000}); await settle(tp, 5000, 2);
    const a = await tp.evaluate(() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, cards: document.querySelectorAll('#list .card').length, mjx: document.querySelectorAll('#list mjx-container').length}));
    errs(tp);
    assert(a.sw <= a.cw + 1, `after loading the page is ${a.sw}px wide in ${a.cw}px`);
    assert(a.cards && a.mjx, `${a.cards} cards, ${a.mjx} maths after loading`);
    return `“Loading questions…” then ${a.cards} cards, ${a.mjx} maths; fits ${a.cw}px`;
  });
  await check('data: Review shows a placeholder until the question\'s file lands, then the question', tp, async () => {
    hold = true;
    const target = await tp.evaluate(() => { const q = B.questions.find(q => !q.dup_of && !QG.has(q)); return q && q.id });
    assert(target, 'every question is already loaded');
    await tp.evaluate(id => { pendingOpen = id; location.hash = '#review/list/all' }, target);
    await tp.waitForFunction(() => document.querySelector('#rout [data-qpend]'), null, {timeout: 8000});
    const w = await tp.evaluate(() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, t: document.querySelector('#rout [data-qpend]').innerText}));
    assert(w.sw <= w.cw + 1, `the placeholder page is ${w.sw}px wide in ${w.cw}px`);
    release();
    await tp.waitForFunction(() => !document.querySelector('#rout [data-qpend]') && document.querySelector('#rout .qbody'), null, {timeout: 15000}); await settle(tp, 5000, 2);
    const r = await tp.evaluate(() => ({mjx: document.querySelectorAll('#rout mjx-container').length, appr: !!document.querySelector('#approve'), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth}));
    errs(tp);
    assert(r.mjx > 0 && r.appr, `after loading: ${r.mjx} maths, approve button ${r.appr}`);
    assert(r.sw <= r.cw + 1, `the filled-in page is ${r.sw}px wide in ${r.cw}px`);
    return `“${w.t.trim()}”, then the question with ${r.mjx} maths; fits ${r.cw}px`;
  });
  await check('data: a topic file that fails says so, and Try again loads it', tp, async () => {
    fail = true;
    const target = await tp.evaluate(() => { const q = B.questions.find(q => !q.dup_of && !QG.has(q)); return q && q.id });
    assert(target, 'every question is already loaded');
    await tp.evaluate(id => { pendingOpen = id; refreshReview() }, target);
    await tp.waitForSelector('#rout [data-qretry]', {timeout: 20000});
    takeErrs(tp);   // the failed loads log 500s on purpose
    fail = false;
    await tp.click('#rout [data-qretry]');
    await tp.waitForFunction(() => !document.querySelector('#rout [data-qpend]') && document.querySelector('#rout .qbody'), null, {timeout: 15000}); await settle(tp, 4000, 2);
    takeErrs(tp);
    return `QID ${target}: “did not load” with Try again, then the question`;
  });
  await tp.context().close();

  // job 2 (owner 16 Nov: "Yeah build it"): the slim index at start, the details right after; every view but the Bank waits for them
  const dp = await newPage(browser, base, seed, {width: 1280, theme: 'light'}); log(dp);
  let dhold = true; const dheld = [];
  await dp.route(u => /\/data\/bank\/[^/]+\/details\.gz\.json/.test(u.href), r => dhold ? dheld.push(r) : r.continue());
  await boot(dp, base, '#bank', false);
  await check('data: the Bank works from the slim index while the details load', dp, async () => {
    const r = await dp.evaluate(() => ({det: QG.detOK, stats: bankStats(), rows: document.querySelectorAll('#list .subrow[data-sel]:not(.none)').length,
      slim: B.questions.every(q => !('review_note' in q) && q.parts.every(p => !('skills' in p)))}));
    errs(dp);
    assert(!r.det, 'the details had already been merged although their file was held back');
    assert(r.slim, 'the start index carries detail fields (review notes or skills)');
    assert(r.stats.questions > 0 && r.rows > 0, `Bank home: ${r.stats.questions} questions, ${r.rows} topic rows`);
    const ix = dp._req.findIndex(x => /index\.gz\.json$/.test(x.u)), dt = dp._req.findIndex(x => /details\.gz\.json$/.test(x.u));
    assert(ix >= 0 && dt > ix, `the details were not requested after the index (index #${ix}, details #${dt})`);
    return `${r.stats.questions} questions in ${r.stats.papers} papers, ${r.rows} topic rows from the slim index; details requested after it`;
  });
  await check('data: another view waits for the details, then draws; counts and topic homes do not change', dp, async () => {
    const before = await dp.evaluate(() => ({stats: bankStats(), homes: B.questions.map(q => qHome(q)).join('|')}));
    // every other view, opened while the details are held back, waits without a page error (live redraws included)
    const tour = ['#review', '#processes/work', '#processes/papers', '#guide', '#review/reports', '#exams'];
    for (const h of tour) { await dp.evaluate(h => { location.hash = h }, h); await dp.waitForTimeout(700) }
    const shown = await dp.evaluate(() => view);
    await dp.waitForFunction(() => { const n = document.getElementById('detWait'); return n && !n.hidden && /Loading question details/.test(n.textContent) }, null, {timeout: 8000});
    const mid = await dp.evaluate(() => !!document.querySelector('#examsView .exm-top, #examsView .exm-empty'));
    dhold = false; dheld.splice(0).forEach(r => r.continue());
    await dp.waitForFunction(() => QG.detOK && document.querySelector('#examsView .exm-top, #examsView .exm-empty'), null, {timeout: 15000}); await settle(dp, 4000, 2);
    const after = await dp.evaluate(() => { const n = document.getElementById('detWait'); return {stats: bankStats(), homes: B.questions.map(q => qHome(q)).join('|'), note: !n || n.hidden,
      full: B.questions.some(q => q.tri?.why) && B.questions.some(q => q.parts.some(p => p.dif?.r)), sols: B.questions.some(q => q.solutions.length)} });
    errs(dp);
    assert(!mid, 'Exams drew before the details arrived');
    assert(shown === 'wait:exams', `while waiting the view was named ${shown}, not wait:exams (live redraws would draw it)`);
    assert(after.note, 'the "Loading question details" notice stayed after they arrived');
    assert(after.full && after.sols, 'the details were not merged (no triage reasons, difficulty reasons or solutions)');
    assert(JSON.stringify(before.stats) === JSON.stringify(after.stats), `bankStats changed when the details landed: ${JSON.stringify(before.stats)} → ${JSON.stringify(after.stats)}`);
    assert(before.homes === after.homes, 'a question\'s topic home changed when the details landed');
    return `${tour.length} views opened while waiting, no errors; “Loading question details…”, then Exams; bankStats ${after.stats.questions} questions / ${after.stats.papers} papers and every topic home unchanged`;
  });
  await dp.context().close();
  // job 3 (owner 14 Nov: "What if we dropped them and rerendered them in the new location?"): tools/image_lifecycle.py
  await check('images: a cleared paper reads crops from its crop group and says its scans are gone; a paper in review keeps both', null, async () => {
    const crop = {}; for (const f of fs.readdirSync(path.join(SITE, 'data/crop')).filter(f => /^g\d+\.json$/.test(f))) Object.assign(crop, JSON.parse(fs.readFileSync(path.join(SITE, 'data/crop', f), 'utf8')));
    const kept = fs.readdirSync(path.join(SITE, 'data/img')).filter(f => /^\d+\.json$/.test(f)).map(f => f.slice(0, -5));
    // 17 Nov: a cleared paper with an item back in review gets its scans back (image_lifecycle), so pick a crop whose paper has none
    const ck = Object.keys(crop).map(k => k.replace(/^figures\/|\.png$/g, '')).find(k => !kept.includes(k.split('_')[0])), cdoc = ck.split('_')[0];
    assert(kept.length, 'no paper in review has a per-paper pack: pick another fixture');
    const kpack = JSON.parse(fs.readFileSync(path.join(SITE, 'data/img', kept[0] + '.json'), 'utf8')), kpage = Object.keys(kpack).find(k => k.startsWith('pages/'));
    const p = await newPage(browser, base, seed, {width: 1280, theme: 'light'}); log(p);
    try {
      await boot(p, base, '#bank');
      const r = await p.evaluate(async ({ck, cdoc, kpage, kdoc}) => {
        const box = document.createElement('div'); document.body.appendChild(box);
        box.innerHTML = `<img class="fig" data-k="${ck}" data-kind="png"><img data-page="pages/${cdoc}_1.jpg"><img data-page="${kpage}">`;
        hydrate(box, {id: 0, parts: [], figures: []}, 'bank');
        const t0 = Date.now(); while (Date.now() - t0 < 10000 && (!box.children[0].getAttribute('src') || !box.children[2].getAttribute('src'))) await new Promise(z => setTimeout(z, 100));
        const out = {crop: !!box.children[0].getAttribute('src'), gone: box.children[1].classList.contains('rv-gone') && !box.children[1].getAttribute('src'),
          scan: !!box.children[2].getAttribute('src'), ipC: !!B.docs[cdoc]?.ip, ipK: !!B.docs[kdoc]?.ip}; box.remove(); return out }, {ck, cdoc, kpage, kdoc: kept[0]});
      const urls = p._req.map(x => x.u), e = takeErrs(p);
      assert(!e.length, e.slice(0, 3).join(' | '));
      assert(!r.ipC && r.ipK, `index flags: cleared paper ${cdoc} ip=${r.ipC}, paper in review ${kept[0]} ip=${r.ipK}`);
      assert(r.crop && urls.some(u => /^data\/crop\/g\d+\.json$/.test(u)) && !urls.includes(`data/img/${cdoc}.json`), `crop ${ck}: shown ${r.crop}; requests ${urls.filter(u => /^data\/(img|crop)\//.test(u)).join(' ')}`);
      assert(r.gone, `the cleared paper's page scan did not say it was removed`);
      assert(r.scan && urls.includes(`data/img/${kept[0]}.json`), `paper in review ${kept[0]}: scan shown ${r.scan}`);
      return `crop ${ck} from ${urls.find(u => /^data\/crop\//.test(u))}; paper ${cdoc}'s scan: "removed after review"; paper ${kept[0]} (in review) scan from its own pack`;
    } finally { await p.context().close() }
  });
  await check('data: a details file that fails: the Bank says so with Try again, which then loads it', null, async () => {
    const p = await newPage(browser, base, seed, {width: 1280, theme: 'light'}); log(p);
    let down = true;
    await p.route(u => /\/data\/bank\/[^/]+\/details\.gz\.json/.test(u.href), r => down ? r.fulfill({status: 500, body: 'down'}) : r.continue());
    try {
      await boot(p, base, '#bank');
      await p.click('#list .subrow[data-sel]:not(.none)');
      await p.waitForSelector('#list [data-qretry]', {timeout: 20000});
      const n500 = p._req.filter(x => /details\.gz\.json$/.test(x.u)).length;
      await p.waitForTimeout(3000);
      const n2 = p._req.filter(x => /details\.gz\.json$/.test(x.u)).length;
      takeErrs(p);   // the failed loads log 500s on purpose
      assert(n2 === n500, `the details kept being requested after failing (${n500} → ${n2})`);
      down = false;
      await p.click('#list [data-qretry]');
      await p.waitForFunction(() => QG.detOK && !document.querySelector('#list [data-qpend]') && document.querySelector('#list .card .qbody'), null, {timeout: 20000});
      takeErrs(p);
      return `“did not load” with Try again after ${n500} tries, no further requests; Try again loaded the details and the cards`;
    } finally { await p.context().close() }
  });
}

/* ---------------- question keys (Fix 2) ----------------
   owner 14 Nov: "Ok we should run Fix 1 and 2" (plan "Questgen architecture plan: before imports resume", Fix 2: stable
   question keys; approvals follow the question). Decisions are stored as reviews/k_<key> and reviews/p_<paper key>; old
   reviews/q<id> and reviews/paper_<doc> docs are still read until a key doc exists. The fixture is the live mirror, which
   holds only old docs, so these checks run the fallback against real data. */
async function questionKeys(browser, base, seed) {
  const page = await newPage(browser, base, seed, {width: 1280, theme: 'light'});
  await boot(page, base, '#bank'); await settle(page, 5000, 2);
  const errs = () => { const e = takeErrs(page); assert(!e.length, e.slice(0, 3).join(' | ')) };
  await check('keys: the CSSA 2022 copies share keys and the approvals on 274/275 count for 44/45', page, async () => {
    const r = await page.evaluate(() => ['2022-CSSA-AT4-Q10', '2022-CSSA-AT4-Q11'].map(k => {
      const qs = B.questions.filter(q => q.key === k);
      return {k, ids: qs.map(q => q.id).sort((a, b) => a - b), state: qs.map(q => [q.id, qState(q), !!q.dup_of]), raw: !!reviews['k_' + k]} }));
    errs();
    for (const x of r) {
      assert(x.ids.length === 2, `${x.k}: ${JSON.stringify(x.ids)}`);
      assert(x.state.every(([, st]) => st === 'approved'), `${x.k}: ${JSON.stringify(x.state)}`);
    }
    assert(JSON.stringify(r.map(x => x.ids)) === '[[44,274],[45,275]]', `copies ${JSON.stringify(r.map(x => x.ids))}`);
    return r.map(x => `${x.k}: ${x.state.map(([i, st, d]) => `${i}${d ? ' (hidden)' : ''} ${st}`).join(', ')}${x.raw ? '' : ' (from old q<id> docs)'}`).join('; ');
  });
  await check('keys: old q<id> and paper_<doc> docs are read until a key doc exists; writes go to the key', page, async () => {
    const r = await page.evaluate(async () => {
      const a = RKEY.index({q274: {status: 'approved', at: '2026-11-10T00:00:00Z', fig: {f1: 'approved'}}, q44: {fig: {f2: 'changes'}, note: 'newer', at: '2026-11-11T00:00:00Z'}});
      const b = RKEY.index({q274: {status: 'approved'}, 'k_2022-CSSA-AT4-Q10': {status: 'flagged', note: 'key doc'}});
      const c = RKEY.index({paper_510: {status: 'approved', doc: 510}});
      const n0 = window.__pt.log.length, q = B.questions.find(x => x.id === 45);
      await write(q, {status: 'flagged', note: 'page test'});
      const w = window.__pt.log.slice(n0).map(x => x.k);
      return {a44: a.q44, b44: b.q44.status, b274: b.q274.status, c1346: c.paper_1346?.status, pdoc: RKEY.pdoc(1346), w, s275: reviews.q275.status, k: reviews.q275.key};
    });
    errs();
    assert(r.a44.status === 'approved' && r.a44.fig.f1 === 'approved' && r.a44.fig.f2 === 'changes' && r.a44.note === 'newer', `merged old docs: ${JSON.stringify(r.a44)}`);
    assert(r.b44 === 'flagged' && r.b274 === 'flagged', `a key doc decides: ${r.b44}/${r.b274}`);
    assert(r.c1346 === 'approved' && r.pdoc === 'p_2022-CSSA-AT4', `paper: ${r.c1346}, ${r.pdoc}`);
    assert(r.w.length === 1 && r.w[0] === 'reviews/k_2022-CSSA-AT4-Q11' && r.s275 === 'flagged' && r.k === '2022-CSSA-AT4-Q11', `write: ${JSON.stringify(r)}`);
    return `old docs merged (approval wins, newest note); key doc wins; paper_510 counts for 1346; write → ${r.w[0]}, copy 275 follows`;
  });
  await check('keys: saved exams still load (old ids; keys find the copy the Bank shows)', page, async () => {
    const r = await page.evaluate(async () => {
      const ok = B.questions.filter(q => !q.dup_of && qState(q) === 'approved').slice(0, 4).map(q => q.id);
      const hid = B.questions.find(q => q.id === 274).dup_of ? 274 : 44, vis = hid === 274 ? 44 : 274;
      exmLoad({id: 'pt_old', title: 'T', sub: 'Old format', items: ok});
      const old = EX.items.slice();
      exmLoad({id: 'pt_key', title: 'T', sub: 'With keys', items: [hid, ...ok], keys: ['2022-CSSA-AT4-Q10', ...ok.map(i => B.questions.find(q => q.id === i).key)]});
      const key = EX.items.slice();
      const ex = await new Promise(res => db.collection('exams').onSnapshot(sn => res((sn.docs || sn).map(x => ({id: x.id, ...x.data()})))));
      const all = ex.map(x => ({id: x.id, n: (x.items || []).filter(i => xq(i)).length, m: RKEY.items(x).filter(i => xq(i)).length}));
      const n0 = window.__pt.log.length; await xSaveDb();
      const w = window.__pt.log.slice(n0).find(x => x.k === 'exams/pt_key');
      return {ok, old, key, vis, all, w: w && w.v};
    });
    errs();
    assert(JSON.stringify(r.old) === JSON.stringify(r.ok), `old exam: ${JSON.stringify(r.old)} vs ${JSON.stringify(r.ok)}`);
    assert(r.key[0] === r.vis && r.key.length === r.ok.length + 1, `keyed exam: ${JSON.stringify(r.key)}, visible copy ${r.vis}`);
    assert(r.all.every(x => x.m >= x.n), `saved exams lose questions: ${JSON.stringify(r.all.filter(x => x.m < x.n))}`);
    assert(r.w && Array.isArray(r.w.keys) && r.w.keys.length === r.w.items.length && r.w.keys[0] === '2022-CSSA-AT4-Q10', `saved: ${JSON.stringify(r.w && {items: r.w.items, keys: r.w.keys})}`);
    assert(r.all.length > 0, 'no saved exams in the fixture');
    return `old-format exam loads ${r.old.length}/${r.ok.length}; hidden copy → ${r.vis}; ${r.all.length} fixture exams load; save writes keys`;
  });
  await page.context().close();
}

/* ---- Reports: acting on a report (owner 17 Nov: "So how do we actually change the reported questions?", then "yes build it in the
   background. When a question is reported, it needs to be logged somewhere right? and disappear from the bank.") ---- */
/* ---------------- Exam paper: no scroll bars on a sheet (owner 18 Nov, urgent) ----------------
   Owner: "Q0979 exam name Mia's advanced exam. The PDF shows side scroll bars, its a persistent issue across many tables. fix it please,
   its urgent". The PDF is a picture of each sheet (29_pdf.js), so any box on a sheet that can scroll sideways shows its scroll bar
   in the PDF. An exam of every question that holds a data table (QID 979 among them), paper and guide: no element on a sheet may be
   wider inside than its box while it scrolls (overflow auto/scroll). */
async function paperTables(browser, base, seed) {
  const page = await newPage(browser, base, seed, {width: 1280, theme: 'light'});
  await boot(page, base, '#exams');
  const waitPv = async () => { await page.waitForFunction(() => { const i = document.querySelector('#xInfo'); return i && !/Laying out/.test(i.textContent) && document.querySelector('#xWord') && document.querySelectorAll('#xPages .sheet').length }, null, {timeout: 180000}); await settle(page, 5000, 2) };
  const scrollers = () => page.evaluate(() => [...document.querySelectorAll('#xPages .sheet *')].filter(e => { const c = getComputedStyle(e); return /auto|scroll/.test(c.overflowX) && e.scrollWidth > e.clientWidth + 0 && e.clientWidth > 0 })
    .map(e => (e.closest('section.xq')?.dataset.q || '?') + ':' + e.className + ' ' + e.scrollWidth + '>' + e.clientWidth)
    // and no data table wider than its column on the sheet (it would run into the margin): they are fitted after layout
    .concat([...document.querySelectorAll('#xPages .sheet .dtwrap>table.dt')].filter(t => t.offsetWidth > t.parentElement.clientWidth + 1)
      .map(t => (t.closest('section.xq')?.dataset.q || '?') + ': table ' + t.offsetWidth + ' wider than its column ' + t.parentElement.clientWidth)));
  await check('exams: no scroll bar on any sheet, paper and guide (every table question, QID 979)', page, async () => {
    // the start index carries no question text: the table questions come from bank.json (tools' copy), shown ones only
    const all = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/bank.json'), 'utf8')).questions;
    const want = all.filter(q => q.id === 979 || /\\extable\{/.test(JSON.stringify(q)) || q.opt_table).map(q => q.id);
    // checker 18 Nov (2024 Abbotsleigh AT4 Q9, QID 1178): a table drawn as a diagram (figure status "table") counts too, shown as approved
    const n = await page.evaluate(w => { const shown = new Set(B.questions.filter(q => !q.dup_of).map(q => q.id));
      const ft = B.questions.filter(q => !q.dup_of && qFigs(q).some(k => B.figs[k]?.status === 'table'));
      ft.forEach(q => { const f = {...(reviews['q' + q.id]?.fig || {})}; qFigs(q).forEach(k => { if (B.figs[k]?.status === 'table') f[k] = 'approved' }); reviews['q' + q.id] = {...(reviews['q' + q.id] || {}), fig: f} });
      EX.items = [...new Set([979, 1178, ...w, ...ft.map(q => q.id)])].filter(id => shown.has(id)).slice(0, 100); xsave(); return EX.items.length }, want);
    await page.evaluate(() => xPreview('exam')); await waitPv(); const ex = await scrollers();
    await page.click('[data-xdoc="guide"]'); await waitPv(); const gd = await scrollers();
    const e = takeErrs(page); assert(!e.length, e.slice(0, 3).join(' | '));
    assert(!ex.length && !gd.length, `scroll bars on the sheets: paper ${ex.length} [${ex.slice(0, 6).join(' | ')}], guide ${gd.length} [${gd.slice(0, 6).join(' | ')}]`);
    return `${n} questions with tables: no scroll bar on the paper or the guide`;
  });
  // checker 18 Nov: "No z-table at the back": build_bank marked no question (it matched keys before they were attached)
  await check('exams: questions marked for the z-score table come from the bank, and their exam ends with the table', page, async () => {
    const r = await page.evaluate(() => { const z = B.questions.filter(q => !q.dup_of && q.zt); if (!z.length) return {n: 0};
      const keep = EX.items; EX.items = [z[0].id]; const bl = xBlocks('exam').filter(b => !/class="xref"/.test(b.html)); EX.items = keep; return {n: z.length, last: bl[bl.length - 1].html.slice(0, 400)} });
    assert(r.n > 0, 'no question in the bank is marked for the z-score table (state/work/ztable.json lists 9)');
    assert(/z|normal/i.test(r.last) && /<table/.test(r.last), `the exam does not end with the table: ${r.last}`);
    return `${r.n} marked questions; an exam with one ends with the z-score table`;
  });
  // checker 18 Nov: a multiple-choice question's worked solution that runs onto the next page was laid out one letter wide
  await check('exams: the continued piece of a multiple-choice question keeps the full width', page, async () => {
    const r = await page.evaluate(() => { const sh = document.querySelector('#xPages .sheet .sheetbody') || document.querySelector('#xPages .sheet');
      const s = document.createElement('section'); s.className = 'xq mc'; s.innerHTML = '<div class="xqb"><div class="xsol">A probability density function must satisfy two conditions.</div></div>';
      sh.appendChild(s); const w = s.querySelector('.xqb').getBoundingClientRect().width, W = s.getBoundingClientRect().width; s.remove(); return {w, W} });
    assert(r.w > r.W * 0.8, `continued body ${Math.round(r.w)} px of ${Math.round(r.W)} px`);
    return `continued body ${Math.round(r.w)} px of ${Math.round(r.W)} px`;
  });
  await page.context().close();
}

async function reportActions(browser, base, seed) {
  const page = await newPage(browser, base, seed, {width: 1280, theme: 'light'});
  await boot(page, base, '#bank');
  const errs = () => { const e = takeErrs(page); assert(!e.length, e.slice(0, 3).join(' | ')) };
  const dbGet = k => page.evaluate(k => window.__pt.store.has(k) ? JSON.parse(JSON.stringify(window.__pt.store.get(k))) : null, k);
  const hash = async h => { await page.evaluate(h => { location.hash = h }, h); await settle(page, 4000, 2) };
  const waitRep = (id, st) => page.waitForFunction(([id, st]) => window.__pt.store.get('reports/' + id)?.status === st, [id, st], {timeout: 8000});
  // an approved question in the Bank and in the exam pools; a report on it, written to the database as the form does
  const seedRep = (id, doc) => page.evaluate(async ([id, doc]) => { await db.doc('reports/' + id).set({by: 'u_other', at: new Date().toISOString(), status: 'open', ...doc}); await new Promise(r => setTimeout(r, 60)) }, [id, doc]);
  const pick = n => page.evaluate(n => { const hs = xaHomes(); return B.questions.filter(q => !q.dup_of && qState(q) === 'approved' && hs.has(q.id) && exEst(q) && inBank(q))[n].id }, n);
  const where = id => page.evaluate(id => { const q = xq(id), A = {...exA(), approved: true, avoid: false, src: new Proxy({}, {get: () => true})};
    // skill gates (17 Nov) shown through the switch: this check is about reports, and an empty exam has nothing learnt
    const sw = XG.show; XG.show = true; let pick; try { pick = exFiltered().some(x => x.id === id) } finally { XG.show = sw }
    return {bank: inBank(q), list: B.questions.filter(inBank).some(x => x.id === id), pick, pool: exBase(A, xaHomes()).some(x => x.id === id)} }, id);

  await check('reports: a reported question leaves the Bank and new exams; a saved exam keeps it with the warning; Dismiss brings it back', page, async () => {
    const id = await pick(0), before = await where(id);
    assert(before.bank && before.pick && before.pool, `QID ${id} not in the Bank and pools to start with: ${JSON.stringify(before)}`);
    await page.evaluate(async id => { const q = xq(id); await db.doc('exams/pt_rep').set({title: 'T', sub: 'Reported test', items: [id], keys: [q.key], at: new Date().toISOString()}) }, id);
    await seedRep('rt_open', {question_id: id, key: (await page.evaluate(id => xq(id).key, id)), reason: 'other', note: 'Page test: the answer is wrong'});
    const during = await where(id);
    await hash('#exams'); await page.evaluate(() => EXAS.go('mine')); await settle(page, 3000, 2);
    const mine = await page.evaluate(() => document.querySelector('#exMine [data-exm="pt_rep"] .exm-warn')?.textContent || '');
    const ex = await page.evaluate(id => { exmLoad(XSAVED.find(x => x.id === 'pt_rep')); xPanel(); return {held: EX.items.includes(id), warn: document.querySelector(`#xPanel li[data-xi="${id}"] .xwarn`)?.textContent || ''} }, id);
    errs();
    assert(!during.bank && !during.list && !during.pick && !during.pool, `reported QID ${id} still offered: ${JSON.stringify(during)}`);
    assert(ex.held && /reported by a teacher/.test(ex.warn) && /reported/.test(mine), `saved exam: ${JSON.stringify(ex)}, My exams “${mine}”`);
    await hash('#review/reports');
    const row = await page.evaluate(() => document.querySelector('#reportsBox [data-repid="rt_open"]')?.innerText || '');
    assert(/Open in Review/.test(row) && /Send to Claude/.test(row) && /Resolve/.test(row) && /Dismiss/.test(row) && !/Apply suggestion/.test(row), `open report actions: ${row.slice(-120)}`);
    await page.click('#reportsBox [data-repid="rt_open"] [data-rdis]'); await waitRep('rt_open', 'dismissed'); await settle(page, 2000, 2);
    const after = await where(id), doc = await dbGet('reports/rt_open');
    errs();
    assert(after.bank && after.pick && after.pool, `dismissed, QID ${id} still hidden: ${JSON.stringify(after)}`);
    assert(doc.done_by === 'u_pagetest' && doc.done_at && doc.action === 'dismissed' && doc.log?.length === 1 && doc.log[0].action === 'dismissed', `dismiss not logged: ${JSON.stringify(doc).slice(0, 200)}`);
    return `QID ${id}: out of the Bank, the pick list and the generator pool while open; saved exam keeps it (“${ex.warn.trim().slice(0, 40)}…”); back after Dismiss`;
  });

  // owner 19 Nov: "yeah apply suggestion or tweak it yourself in the page. It shouldn't need to be sent to claude every time"
  await check('reports: Apply suggestion on a wrong difficulty sets each part (tweakable), counts at once in the exam maker, and resolves', page, async () => {
    const q = await page.evaluate(() => { const hs = xaHomes(); const q = B.questions.find(q => !q.dup_of && qState(q) === 'approved' && hs.has(q.id) && qLeaves(q).length === 2 && qLeaves(q).every(p => p.dif?.b && p.dif.b < 5)); return q && {id: q.id, key: q.key, parts: qLeaves(q).map(p => p.id), d0: exEst(q).d} });
    assert(q, 'no two-part question below band 5 in the fixture');
    await seedRep('rt_dif', {question_id: q.id, key: q.key, reason: 'difficulty', suggested_band: 5, suggested_wm: 'PR', note: 'Page test: too hard'});
    await page.evaluate(() => renderReports()); await settle(page, 1500, 2);
    await page.click('#reportsBox [data-repid="rt_dif"] [data-rdif]'); await settle(page, 800, 2);
    const pre = await page.evaluate(() => [...document.querySelectorAll('#reportsBox [data-repid="rt_dif"] [data-rdp]')].map(tr => [tr.querySelector('[data-rdb]').value, tr.querySelector('[data-rdw]').value]));
    assert(pre.length === 2 && pre.every(([b, w]) => b === '5' && w === 'PR'), 'not prefilled with the suggestion: ' + JSON.stringify(pre));
    await page.selectOption('#reportsBox [data-repid="rt_dif"] [data-rdp]:last-child [data-rdb]', '4');   // tweak the second part
    await page.click('#reportsBox [data-repid="rt_dif"] [data-rdok]'); await waitRep('rt_dif', 'resolved'); await settle(page, 1500, 2);
    const r = await page.evaluate(q => ({a: window.__pt.store.get('difficulty/' + q.parts[0]), b: window.__pt.store.get('difficulty/' + q.parts[1]), d: exEst(xq(q.id)).d, kind: exEst(xq(q.id)).kind}), q);
    const doc = await dbGet('reports/rt_dif');
    errs();
    assert(r.a?.band === 5 && r.a.wm === 'PR' && r.a.status === 'changed' && r.b?.band === 4 && r.b.wm === 'PR' && r.b.from_report === 'rt_dif', 'difficulty docs: ' + JSON.stringify([r.a, r.b]).slice(0, 300));
    assert(r.d > q.d0 && r.kind === 'Problem solving', `exam maker estimate ${q.d0.toFixed(2)} -> ${r.d.toFixed(2)} (${r.kind})`);
    assert(doc.status === 'resolved' && /Applied: .*band 5 problem solving.*band 4 problem solving/.test(doc.reply), 'report: ' + JSON.stringify(doc).slice(0, 200));
    for (const pid of q.parts) await page.evaluate(pid => { window.__pt.store.delete('difficulty/' + pid); delete DIFD[pid]; _ee.clear(); _qd.clear() }, pid);
    return `QID ${q.id}: band ${q.d0.toFixed(1)} -> ${r.d.toFixed(1)}; ${doc.reply}`;
  });
  await check('reports: Open in Review, then Apply suggestion changes the dot point and resolves', page, async () => {
    const id = await page.evaluate(() => { const hs = xaHomes(); return B.questions.find(q => !q.dup_of && qState(q) === 'approved' && hs.has(q.id) && qLeaves(q).length === 1 && DM[partMain(q, qLeaves(q)[0])[0]]).id });
    const dot = await page.evaluate(id => { const q = xq(id), cur = partMain(q, qLeaves(q)[0])[0]; return DOTS.find(d => d.id !== cur && d.yl === DM[cur].yl).id }, id);
    await seedRep('rt_dot', {question_id: id, key: (await page.evaluate(id => xq(id).key, id)), reason: 'dot_point', suggested_dot: dot, note: 'Page test: wrong topic'});
    await page.evaluate(() => renderReports()); await settle(page, 2000, 2);
    await page.click('#reportsBox [data-repid="rt_dot"] [data-ropen]'); await settle(page, 5000, 2);
    const rv = await page.evaluate(() => ({hash: location.hash, view, id: rlist[ridx]?.id}));
    assert(rv.hash === '#review/list/all' && rv.view === 'review' && rv.id === id, `Open in Review: ${JSON.stringify(rv)}, expected QID ${id}`);
    await hash('#review/reports');
    await page.click('#reportsBox [data-repid="rt_dot"] [data-rapply]'); await waitRep('rt_dot', 'resolved'); await settle(page, 2000, 2);
    const r = await page.evaluate(id => { const q = xq(id); return {dot: partMain(q, qLeaves(q)[0])[0], home: qHome(q) === subKey(partMain(q, qLeaves(q)[0])[0]) || !!reviews['q' + id]?.home?.id, bank: inBank(q), w: window.__pt.log.filter(x => x.k === 'reviews/' + RKEY.qdoc(q)).pop()?.v?.tag_edits} }, id);
    const doc = await dbGet('reports/rt_dot');
    errs();
    assert(r.dot === dot && r.w && Object.values(r.w).some(e => e.id === dot), `dot point after Apply: ${r.dot} (wanted ${dot}), tag_edits ${JSON.stringify(r.w)}`);
    assert(doc.reply === `Applied: ${dot} ` + (await page.evaluate(d => DM[d].short || DM[d].text, dot)) && doc.action === 'applied' && doc.done_by === 'u_pagetest' && doc.applied?.dot === dot, `report after Apply: ${JSON.stringify(doc).slice(0, 240)}`);
    assert(r.bank, 'the question is still out of the Bank after Apply resolved its report');
    assert(r.home, 'the home topic did not follow the applied dot point');
    // parts filed under different dot points: the row asks which parts with a picker
    const m = await page.evaluate(() => { const hs = xaHomes(); const q = B.questions.find(q => !q.dup_of && qState(q) === 'approved' && hs.has(q.id) && (s => s.length > 1 && new Set(s).size === s.length)(qLeaves(q).map(p => partMain(q, p)[0] || '')));
      if (!q) return null; const used = new Set(qLeaves(q).map(p => partMain(q, p)[0])); return {id: q.id, key: q.key, dot: DOTS.find(d => !used.has(d.id)).id, parts: qLeaves(q).map(p => p.id)} });
    if (!m) return `QID ${id} → ${dot} (no multi-part question with different dot points to test the picker)`;
    await seedRep('rt_dot2', {question_id: m.id, key: m.key, reason: 'dot_point', suggested_dot: m.dot, note: 'Page test: which part'});
    await page.evaluate(() => renderReports()); await settle(page, 2000, 2);
    await page.click('#reportsBox [data-repid="rt_dot2"] [data-rapply]'); await settle(page, 1000, 2);
    const n = await page.evaluate(() => document.querySelectorAll('#reportsBox [data-repid="rt_dot2"] .rep-pick [data-rpp]').length);
    assert(n === m.parts.length, `part picker shows ${n} parts for ${m.parts.length}`);
    await page.click(`#reportsBox [data-repid="rt_dot2"] [data-rpp="${m.parts[0]}"]`); await page.click('#reportsBox [data-repid="rt_dot2"] [data-rpok]');
    await waitRep('rt_dot2', 'resolved'); await settle(page, 1500, 2);
    const p2 = await page.evaluate(m => { const q = xq(m.id), lv = qLeaves(q); return lv.map(p => partMain(q, p)[0]) }, m);
    errs();
    assert(p2[0] === m.dot && p2.slice(1).every(x => x !== m.dot), `picker applied to ${JSON.stringify(p2)}, wanted only the first part → ${m.dot}`);
    return `QID ${id} → ${dot}, report resolved (“${doc.reply.slice(0, 40)}”); QID ${m.id}: picker, first part only → ${m.dot}`;
  });

  // coordinator 17 Nov: the card showed tagger A's dot point for QID 559 (2026-NESA-HSC-Q32) although Review settled part (b) on
  // tagger B (tagres {"890": "B"}): the card shows the dot points that count (partMain, as qHome files it) and the home topic
  await check('reports: the card shows the dot points Review settled and the home topic (QID 559)', page, async () => {
    const q = await page.evaluate(() => { const q = xq(559); if (!q) return null; const p = q.parts.find(x => String(x.id) === '890');
      const pri = s => p?.tagd?.[s]?.dp.filter(d => d[1] === 'primary').map(d => d[0]) || [];
      return {key: q.key, tagres: reviews.q559?.tagres, a: pri('A'), b: pri('B'), lab: p?.label, home: (() => { const d = document.createElement('div'); d.innerHTML = homeLabel(qHome(q)); return d.textContent })()} });
    // 21 Nov: the fixture follows the live decisions; Review's pick for part 890 was B on 13 Nov and is A now: test whichever was picked
    const pick = q?.tagres?.['890'], use = pick === 'A' ? q.a : q?.b, other = pick === 'A' ? q?.b : q?.a;
    assert(q && (pick === 'A' || pick === 'B') && use.length && other.some(x => !use.includes(x)), `fixture QID 559: ${JSON.stringify(q)}`);
    await seedRep('rt_559', {question_id: 559, key: q.key, reason: 'dot_point', note: 'Page test: which topic'});
    await page.evaluate(() => renderReports()); await settle(page, 2000, 2);
    const c = await page.evaluate(() => { const r = document.querySelector('#reportsBox [data-repid="rt_559"]'); return {dots: r?.querySelector('.rep-dots')?.textContent || '', home: r?.querySelector('.rep-home')?.textContent || ''} });
    errs();
    const wrong = other.filter(x => !use.includes(x));
    assert(use.every(x => c.dots.includes(x)) && !wrong.some(x => c.dots.includes(x)), `card dot points “${c.dots}”: want ${use.join(',')} (tagger ${pick}), not ${wrong.join(',')}`);
    assert(c.home === 'Home topic: ' + q.home && q.home.length > 5, `home line “${c.home}”, want “${q.home}”`);
    await page.evaluate(async () => { await db.doc('reports/rt_559').delete(); await new Promise(r => setTimeout(r, 60)) });
    return `part (${q.lab}): ${q.b.join(',')} (tagger B, Review's pick), not ${wrong.join(',')}; ${c.home}`;
  });

  // owner 17 Nov: "yes clear the hidden choices and yes make sure it doesn't happen agai": the tags every screen shows (effTags)
  // are the ones the exam builder files by, whatever Review picked; switching the pick keeps the question decided
  await check('tags: what the screen shows is what the exam builder files by (one source of truth)', page, async () => {
    const r = await page.evaluate(() => { const q = xq(559), p = q.parts.find(x => String(x.id) === '890'), keep = reviews.q559;
      const shown = () => effTags(q, p).filter(t => t.primary).map(t => t.id), filed = () => partMain(q, p);
      const sideB = p.tagd.B.dp.filter(d => d[1] === 'primary').map(d => d[0]), sideA = p.tagd.A.dp.filter(d => d[1] === 'primary').map(d => d[0]);
      reviews.q559 = {...keep, tagres: {...keep.tagres, 890: 'B'}};   // 21 Nov: set B explicitly (the live pick is A since the fixture refresh)
      const out = {b: [shown(), filed(), sideB]};
      reviews.q559 = {...keep, tagres: {...keep.tagres, 890: 'A'}}; out.a = [shown(), filed(), sideA, isTodo(q, 'tags')];
      reviews.q559 = {...keep, tagres: {...keep.tagres, 890: {id: 'Y12-257'}}}; out.id = [shown(), filed(), isTodo(q, 'tags')];
      reviews.q559 = keep; return out });
    errs();
    const same = (x, y) => JSON.stringify([...x].sort()) === JSON.stringify([...y].sort());
    assert(same(r.b[0], r.b[1]) && same(r.b[0], r.b[2]), `pick B: shown ${r.b[0]} filed ${r.b[1]} side ${r.b[2]}`);
    assert(same(r.a[0], r.a[1]) && same(r.a[0], r.a[2]) && r.a[3] === false, `pick A: shown ${r.a[0]} filed ${r.a[1]} side ${r.a[2]} open ${r.a[3]}`);
    assert(same(r.id[0], ['Y12-257']) && same(r.id[1], ['Y12-257']) && r.id[2] === false, `pick by id: ${JSON.stringify(r.id)}`);
    return `B: ${r.b[0]}; A: ${r.a[0]}; by id: ${r.id[0]}; the question stays decided`;
  });

  // owner 17 Nov: "Y12 questions can NEVER show in Y11 bank, likewise vice versa. If it has ANY y12 parts, it goes straight to Y12."
  await check('bank: a question with any Year 12 tag files under Year 12 only, and the reverse (2023 HSC Q32)', page, async () => {
    const r = await page.evaluate(() => { const bad = [];
      B.questions.filter(q => !q.dup_of).forEach(q => { const h = qHome(q); if (!h || !h.startsWith('sub:')) return;
        const y12 = qY12(q);
        if ((h.slice(4).split('|')[0] === '12') !== y12) bad.push(q.key + ' → ' + h) });
      const q = B.questions.find(x => x.key === '2023-NESA-HSC-Q32');
      return {bad, n: B.questions.length, q32: q ? qHome(q) : 'missing'} });
    errs();
    assert(!r.bad.length, `${r.bad.length} question(s) filed in the wrong year: ${r.bad.slice(0, 5).join('; ')}`);
    assert(/^sub:12\|/.test(r.q32), `2023 HSC Q32 filed under ${r.q32}, want a Year 12 topic`);
    return `${r.n} questions checked; 2023 HSC Q32 → ${r.q32.split('|').pop()}`;
  });

  // owner 17 Nov (QID 1633): "Also found an out of course question in Y11". Standard-course questions never sit in an Advanced topic
  await check('bank: Mathematics Standard questions are in their own group, never under an Advanced topic', page, async () => {
    const r = await page.evaluate(() => { TOPICS = null; buildTopics(); const bad = [];
      Object.entries(TOPICS.byKey).forEach(([k, v]) => { if (k.startsWith('sub:')) v.qs.forEach(q => { if (q.std) bad.push(q.key + ' in ' + k) }) });
      const std = B.questions.filter(q => q.std && inBank(q)).length;
      return {bad, std, grp: TOPICS.byKey['special:std'].qs.length} });
    errs();
    assert(!r.bad.length, `Standard questions in Advanced topics: ${r.bad.slice(0, 5).join('; ')}`);
    assert(r.grp === r.std, `Mathematics Standard group holds ${r.grp}, want ${r.std}`);
    return `${r.grp} Standard questions in their own group, none in Advanced topics`;
  });

  await check('reports: Send to Claude flags the question (waiting for Claude); approving the fix resolves the report', page, async () => {
    const id = await pick(3);
    await seedRep('rt_dif', {question_id: id, key: (await page.evaluate(id => xq(id).key, id)), reason: 'difficulty', suggested_band: 5, note: 'Page test: too easy'});
    await page.evaluate(() => renderReports()); await settle(page, 2000, 2);
    await page.click('#reportsBox [data-repid="rt_dif"] [data-rclaude]'); await waitRep('rt_dif', 'sent'); await settle(page, 2000, 2);
    const s = await page.evaluate(id => { const q = xq(id), r = reviews['q' + id], row = document.querySelector('#reportsBox [data-repid="rt_dif"]');
      return {wait: waitQ(q), note: r?.note, fixed: r?.fixed, bank: inBank(q), st: row?.dataset.st, txt: row?.innerText || '', inbox: B.questions.filter(waitQ).some(x => x.id === id)} }, id);
    const doc = await dbGet('reports/rt_dif');
    errs();
    assert(s.wait && s.inbox && s.fixed === null && /^Report \(Wrong difficulty\): Page test: too easy Suggests band 5\.$/.test(s.note || ''), `flag after Send: ${JSON.stringify(s).slice(0, 240)}`);
    assert(s.st === 'sent' && /Sent to Claude/.test(s.txt) && /waiting for Claude/.test(s.txt) && !s.bank, `sent report row: ${s.st}, bank ${s.bank}: ${s.txt.slice(0, 160)}`);
    assert(doc.action === 'sent' && doc.done_by === 'u_pagetest' && doc.sent_at && doc.flag === s.note, `report after Send: ${JSON.stringify(doc).slice(0, 240)}`);
    // Claude fixes it (fixed note: "Fixed and back"), then the checker approves it in Review
    await page.evaluate(async id => { const q = xq(id); await write(q, {fixed: {note: 'Claude 17 Nov: rated band 5'}}); }, id); await settle(page, 1500, 2);
    const back = await page.evaluate(() => document.querySelector('#reportsBox [data-repid="rt_dif"]')?.innerText || '');
    await page.evaluate(async id => { await new Promise(r => setTimeout(r, 5)); await write(xq(id), {status: 'approved'}) }, id); await settle(page, 2000, 2);
    const f = await page.evaluate(id => { const row = document.querySelector('#reportsBox [data-repid="rt_dif"]'); return {st: row?.dataset.st || '(not in Open)', bank: inBank(xq(id)), rs: REP.st(REP.list.find(r => r.id === 'rt_dif'))} }, id);
    await page.click('#reportsBox [data-rf="resolved"]'); await settle(page, 1500, 2);
    const res = await page.evaluate(() => document.querySelector('#reportsBox [data-repid="rt_dif"]')?.innerText || '');
    await page.click('#reportsBox [data-rf="open"]');
    errs();
    assert(/back in Review for approval/.test(back), `after the fix the row says: ${back.slice(0, 200)}`);
    assert(f.rs === 'resolved' && f.st === '(not in Open)' && f.bank, `after approval: ${JSON.stringify(f)}`);
    assert(/Resolved/.test(res) && /Fixed and approved/.test(res), `Resolved list: ${res.slice(0, 200)}`);
    return `QID ${id}: flagged “${s.note.slice(0, 50)}…”, waiting for Claude; fixed → back for approval; approved → Resolved, “Fixed and approved”, back in the Bank`;
  });
  await page.context().close();
}

/* ---------------- main ---------------- */
/* Skill gates in the exam builders (owner 17 Nov: "lets do skill gates, that's important"; 12 Nov: "if theyve done diff they can't do a
   diff question which contains int until they do int"; 17 Nov: "we cann't assume that learnt is ticked ..."; "Learnt list, Y11
   pre-ticked"; "Include it yep."). The example: 2020 HSC Q18 (QID 219) needs "Integration using a given derivative" (taught in
   Integral calculus › Primitive functions): with Differential calculus and its own subtopic ticked it stays out of the exam until
   Primitive functions is ticked or in Already learnt. Independent count: QG.skills (bank_split skill_gates) read directly. */
async function skillGates(browser, base, seed) {
  const Q = 219, PRIM = 'sub:12|Integral calculus|Primitive functions';
  const page = await newPage(browser, base, seed, {width: 1280, theme: 'light'});
  await boot(page, base, '#exams');
  const errs = () => { const e = takeErrs(page); assert(!e.length, e.slice(0, 3).join(' | ')) };
  // the exam's topics: Differential calculus (Year 12) and Q18's own subtopic; nothing in Already learnt; switch off
  const setup = () => page.evaluate(({Q}) => { EXV.view = 'setup'; exSaveView(); renderExams(); XG.on = []; XG.off = []; XG.show = false; XG.open.setup = true;
    const h = xaHomes().get(Q).sub, dc = [...xaTree()[12]].filter(([fa]) => fa === 'Differential calculus').flatMap(([, ks]) => ks);
    exA().approved = true; exSetTopics([...dc, h]); return h }, {Q});
  const inPool = () => page.evaluate(Q => exPool(exA(), xaHomes()).some(q => q.id === Q), Q);

  // 17 Nov review: with nothing to judge against (empty exam, "All questions", empty Already learnt) nothing is gated
  await check('exams: no gate while nothing is ticked, browsed, added or learnt', page, async () => {
    const r = await page.evaluate(() => { const keep = {items: EX.items.slice(), topics: exA().topics.slice(), t: EXV.pk.topic, on: XG.on, off: XG.off, show: XG.show};
      try { EX.items.length = 0; exSetTopics([]); EXV.pk.topic = 'all'; XG.on = []; XG.off = []; XG.show = false;
        const g = XG.learnt(XG.pickExtra(exA())), qs = B.questions.filter(q => !q.dup_of && inBank(q));
        return {none: !!g.L.none, out: XG.split(qs, g.L).out.length, n: qs.length} }
      finally { EX.items.push(...keep.items); exSetTopics(keep.topics); EXV.pk.topic = keep.t; XG.on = keep.on; XG.off = keep.off; XG.show = keep.show } });
    errs();
    assert(r.none && r.out === 0, `empty exam: ${r.out} of ${r.n} left out (none=${r.none})`);
    return `${r.n} questions, none left out`;
  });
  await check('exams: skill gates leave a question needing an untaught topic out of the generator and the counts', page, async () => {
    const h = await setup(); await settle(page, 2000, 2);
    const r = await page.evaluate(({Q, h}) => {
      const A = exA(), seen = new Set(); for (let i = 0; i < 6; i++) { exGenerate(); EX.items.forEach(x => seen.add(x)) }
      // the subtopic tile's count (what ticking it brings in) leaves Q out; the Exams setup line names the left-out ones
      const pill = document.querySelector(`#exTopics [data-tsub="${CSS.escape(h)}"] .n`)?.textContent, raw = exBase(A, xaHomes()).filter(q => xaHomes().get(q.id).sub === h).length;
      return {gen: seen.has(Q), pill: +pill, raw, need: XG.need(xq(Q))} }, {Q, h});
    errs();
    assert(r.need.includes('sub:12|Integral calculus|Primitive functions'), `Q18 needs ${r.need.join(', ')}`);
    assert(!(await inPool()), 'Q18 is in the generator pool');
    assert(!r.gen, 'Q18 was generated into an exam');
    assert(r.pill < r.raw, `its subtopic shows ${r.pill} of ${r.raw}: the gated question is still counted`);
    return `QID ${Q} out of the pool and 6 generated exams; its subtopic counts ${r.pill} of ${r.raw}`;
  });

  await check('exams: the left-out line counts what the gates leave out, with the topics most missing', page, async () => {
    const r = await page.evaluate(() => {
      const A = exA(), T = new Set(A.topics), L = new Set([...A.topics, ...[...xaTree()[11].values()].flat()]);   // a Year 12 topic is in: all of Year 11 counts
      // owner 25 Nov: a skill taught at a focus area (its key ends in "|", no subtopic of that name) counts once a subtopic of the area is learnt
      const keys = new Set([12, 11].flatMap(y => [...xaTree()[y].values()].flat())); [...L].forEach(k => { const f = k.split('|').slice(0, 2).join('|') + '|'; if (!keys.has(f)) L.add(f) });
      const raw = exBase(A, xaHomes()).filter(q => T.has(xaHomes().get(q.id).sub));
      const out = raw.filter(q => qSkills(q).some(s => (QG.skills[s] || []).some(k => !L.has(k))));
      const el = document.querySelector('#exLearnt .xl-out');
      return {want: out.length, got: el ? +el.dataset.xlout : 0, text: el?.textContent || '', pool: exPool(A, xaHomes()).length, raw: raw.length} });
    errs();
    assert(r.want > 0, 'nothing is left out (the example needs one)');
    assert(r.got === r.want, `the line says ${r.got}, want ${r.want}`);
    assert(r.pool === r.raw - r.want, `pool ${r.pool}, want ${r.raw} − ${r.want}`);
    assert(/left out: (they need|it needs) topics not yet learnt \(mostly /.test(r.text), `line: ${r.text}`);
    return r.text.trim();
  });

  await check('exams: Already learnt brings the question back, and is kept per teacher in the page database', page, async () => {
    await page.click(`#exLearnt [data-xlk="${PRIM}"]`); await settle(page, 2000, 2);
    assert(await inPool(), 'Q18 is still out with Primitive functions in Already learnt');
    const line = await page.evaluate(() => +(document.querySelector('#exLearnt .xl-out')?.dataset.xlout || 0));
    await sleep(1200);
    const w = await page.evaluate(() => window.__pt.log.filter(x => x.k === 'data/users/u_pagetest/learnt').pop());
    errs();
    assert(w && w.v.on.includes('sub:12|Integral calculus|Primitive functions'), 'no write to data/users/u_pagetest/learnt');
    // ticked in the exam instead: the same
    await page.click(`#exLearnt [data-xlk="${PRIM}"]`); await sleep(100);
    assert(!(await inPool()), 'unticking it did not leave Q18 out again');
    await page.evaluate(p => exSetTopics([...exA().topics, p]), PRIM); await settle(page, 1500, 2);
    assert(await inPool(), 'Q18 is out with Primitive functions ticked in the exam');
    const dis = await page.evaluate(p => document.querySelector(`#exLearnt [data-xlk="${p}"]`)?.disabled, PRIM);
    assert(dis, 'a topic in the exam is not shown as always learnt (disabled) in the list');
    // a teacher's list comes back from the database on another device
    const p2 = await newPage(browser, base, {...seed, 'data/users/u_pagetest/learnt': {on: [PRIM], off: []}}, {width: 1280, theme: 'light'});
    await boot(p2, base, '#exams'); await settle(p2, 2000, 2);
    const back = await p2.evaluate(p => XG.src === 'db' && XG.on.includes(p), PRIM);
    await p2.context().close();
    assert(back, 'the saved list did not load from data/users/<id>/learnt');
    return `back in the pool; the line then says ${line || 0}; saved to data/users/u_pagetest/learnt and read back`;
  });

  await check('exams: Year 11 starts ticked in Already learnt once a Year 12 topic is in the exam', page, async () => {
    const r = await page.evaluate(() => { XG.on = []; XG.off = []; const y11 = [...xaTree()[11].values()].flat(), y12 = [...xaTree()[12].values()].flat();
      const st = () => { exLearnt(); const b = [...document.querySelectorAll('#exLearnt .xl-p')].filter(x => x.dataset.xlk.startsWith('sub:11|') && !x.disabled); return {n: b.length, on: b.filter(x => x.getAttribute('aria-pressed') === 'true').length} };
      exSetTopics([y11[0]]); const a = st();
      exSetTopics([y11[0], y12[0]]); const b = st();
      document.querySelector(`#exLearnt .xl-p[data-xlk="${CSS.escape(y11[3])}"]`).click(); const c = st(), off = XG.off.slice();
      document.querySelector('#exLearnt [data-xly11]').click(); const d = st();
      return {a, b, c, d, off, k: y11[3]} });
    errs();
    assert(r.a.on === 0, `Year 11 only: ${r.a.on} Year 11 topics pre-ticked`);
    assert(r.b.on === r.b.n, `with a Year 12 topic ${r.b.on} of ${r.b.n} Year 11 topics ticked`);
    assert(r.c.on === r.c.n - 1 && r.off.includes(r.k), 'unticking one Year 11 topic did not stick');
    assert(r.d.on === r.d.n, '"All Year 11" did not tick them all again');
    return `Year 11 only: 0 of ${r.a.n} ticked; with a Year 12 topic: ${r.b.on} of ${r.b.n}; untick one: ${r.c.on}; All Year 11: ${r.d.on}`;
  });

  await check('exams: basic skills never gate', page, async () => {
    const r = await page.evaluate(() => {
      const basic = ['Expanding and factorising', 'Quadratic equations', 'Index laws'].filter(s => !QG.skills[s]);
      XG.on = []; XG.off = []; XG.show = false;
      const only = B.questions.filter(q => qSkills(q).length && qSkills(q).every(s => !QG.skills[s]));
      return {basic, n: Object.keys(QG.skills).length, only: only.length, ok: only.filter(q => XG.ok(q, new Set())).length} });
    errs();
    assert(r.basic.length === 3, 'a basic skill gates');
    assert(r.only > 0 && r.ok === r.only, `${r.ok} of ${r.only} basic-only questions pass with nothing learnt`);
    return `${r.n} skills gate; ${r.only} questions needing only basic skills pass with nothing learnt`;
  });

  // owner 25 Nov ("Besides that, yes action all these things"): the checker's "Topic counts change when another topic is ticked" (the
  // reason now sits beside each count; the counts follow the saved exams as they arrive; a skill taught at a whole focus area counts once
  // a subtopic of it is learnt), "put generate button on top", and a review's "no way to set a question count"
  await check('exams: Setup says why a count is lower, follows the saved exams, Generate on top, a question count', page, async () => {
    const h = await setup(); await page.evaluate(() => { EXV.setupFor = 'open'; EXV.view = 'setup'; renderExams() }); await settle(page, 2000, 2);   // Setup as an exam's Settings (the exam has questions)
    const top = await page.evaluate(() => ({first: !!document.querySelector('.exsettings')?.firstElementChild?.querySelector('#gGo'), n: document.querySelectorAll('#gGo').length}));
    assert(top.first && top.n === 1, `Generate: ${JSON.stringify(top)}`);
    const why = await page.evaluate(h => { const p = document.querySelector(`#exTopics [data-tsub="${CSS.escape(h)}"]`); return {n: +p.querySelector('.n').textContent, why: p.querySelector('.ex-pwhy')?.textContent || ''} }, h);
    assert(/\d+ need /.test(why.why), `the gated subtopic says “${why.why}”`);
    // a saved exam arrives holding two of its questions: the count drops at once, with the reason, without another tick
    const {ids, k} = await page.evaluate(() => { exA().avoid = true; exA().avoidSet = true; exTopics(); const P = exPool(exA(), xaHomes()), c = {};
      P.forEach(q => { const s = xaHomes().get(q.id).sub; c[s] = (c[s] || 0) + 1 }); const k = Object.keys(c).sort((a, b) => c[b] - c[a])[0];
      return {k, ids: P.filter(q => xaHomes().get(q.id).sub === k).slice(0, 2).map(q => q.id)} });
    const n0 = await page.evaluate(k => +document.querySelector(`#exTopics [data-tsub="${CSS.escape(k)}"] .n`).textContent, k);
    await page.evaluate(ids => db.doc('exams/ePTsetup').set({title: 'T', sub: 'PT setup counts', items: ids, keys: ids.map(i => xq(i).key), course: QG.course, at: new Date().toISOString()}), ids);
    await page.waitForFunction(([k, n0]) => +document.querySelector(`#exTopics [data-tsub="${CSS.escape(k)}"] .n`).textContent !== n0, [k, n0], {timeout: 4000}).catch(() => {});
    const n1 = await page.evaluate(k => { const p = document.querySelector(`#exTopics [data-tsub="${CSS.escape(k)}"]`); return {n: +p.querySelector('.n').textContent, why: p.querySelector('.ex-pwhy')?.textContent || ''} }, k);
    await page.evaluate(() => db.doc('exams/ePTsetup').delete()); await sleep(300);
    assert(ids.length === 2 && n1.n === n0 - 2 && /\d+ in saved exams/.test(n1.why), `after a saved exam arrived: ${n0} → ${JSON.stringify(n1)}`);
    const fa = await page.evaluate(() => { const ks = [...xaTree()[12].get('Differential calculus')], f = 'sub:12|Differential calculus|', real = ks.includes(f);
      return {real, has: XG.learnt([ks[0]]).L.has(f), not: XG.learnt([]).L.has(f)} });
    assert(fa.real || (fa.has && !fa.not), `a focus-area-level skill: ${JSON.stringify(fa)}`);
    // size by a number of questions
    await page.click('[data-gby="n"]');
    await page.evaluate(() => { const el = document.getElementById('gN'); el.value = 12; el.dispatchEvent(new Event('input', {bubbles: true})) });
    const vis = await page.evaluate(() => ({m: document.getElementById('gMarks').closest('.ctl').hidden, n: document.getElementById('gN').closest('.ctl').hidden, lab: document.getElementById('gNV').textContent}));
    const g = await page.evaluate(() => { const keep = EX.items.slice(); exGenerate(); const n = EX.items.length; EX.items = keep; exA().by = 'marks'; xaSave(); EXV.setupFor = null; renderSetup(); return n });
    errs(); assert(vis.m && !vis.n && vis.lab === '12 questions', `size controls: ${JSON.stringify(vis)}`);
    assert(g === 12, `generated ${g} questions, asked for 12`);
    return `“${why.why}”; a saved exam took ${n0} → ${n1.n} (“${n1.why}”) at once; Generate first; 12 questions asked, 12 generated`;
  });
  await check('exams: Pick by hand leaves gated questions out; the switch shows them with a “needs” note', page, async () => {
    const h = await page.evaluate(Q => { XG.on = []; XG.off = []; XG.show = false; exSetTopics([]); EX.items = []; xsave();
      const h = xaHomes().get(Q).sub; EXV.view = 'pick'; EXV.mode = {kind: 'add', id: null, doc: 'exam'}; exSaveView(); EXV.pk = {...EXV.pk, topic: h, q: '', paper: 'all', type: 'all', marks: 'all', band: 'all', wm: 'all', fig: false, hide: false}; renderExams(); return h }, Q);
    await settle(page, 4000, 2);
    const a = await page.evaluate(Q => ({inList: EXCUR.some(q => q.id === Q), out: EXV.gate.sp.out.length, line: +(document.querySelector('#exLearntP .xl-out')?.dataset.xlout || 0)}), Q);
    // Add all shown / Add 5 at random take only what the list shows: tried on Differential calculus, where some are left out
    await page.evaluate(() => { EXV.pk.topic = 'fa:12|Differential calculus'; EXV.pk.limit = 1000; exSideNav(); exList(false) }); await settle(page, 6000, 2);
    await page.click('#exAddAll'); await sleep(100); await page.click('#exAddRand'); await sleep(100);
    const added = await page.evaluate(() => { const out = new Set(EXV.gate.sp.out.map(q => q.id)), shown = EXCUR.length;
      return {n: EX.items.length, bad: EX.items.filter(i => out.has(i)).length, out: out.size, shown} });
    await page.evaluate(h => { EX.items = []; xsave(); EXV.pk.topic = h; EXV.pk.limit = 20; exSideNav(); exList() }, h); await settle(page, 4000, 2);
    await page.click('#exLearntP [data-xlshow]'); await settle(page, 4000, 2);
    await page.evaluate(Q => { const i = EXCUR.findIndex(q => q.id === Q); if (i >= EXV.pk.limit) { EXV.pk.limit = i + 1; exList(false) } }, Q); await settle(page, 4000, 2);
    const b = await page.evaluate(Q => ({inList: EXCUR.some(q => q.id === Q), note: document.querySelector(`#exCards .card[data-q="${Q}"] .xl-need`)?.textContent || '',
      notes: document.querySelectorAll('#exCards .xl-need').length}), Q);
    await page.evaluate(() => { XG.show = false; exRefresh() });
    errs();
    assert(!a.inList, 'Q18 is in the pick list with nothing learnt');
    assert(a.out > 0 && a.line === a.out, `left-out line ${a.line}, want ${a.out}`);
    assert(added.out > 0 && added.n > 0 && !added.bad, `Differential calculus: ${added.n} added of ${added.shown} shown, ${added.bad} of ${added.out} left-out ones added`);
    assert(b.inList, 'the switch did not show Q18');
    assert(/needs: .*Primitive functions/.test(b.note), `Q18's note: “${b.note}”`);
    return `topic ${h.split('|')[2]}: ${a.out} left out; Differential calculus: Add all shown took ${added.n}, none of its ${added.out} left out; switch on: ${b.notes} cards marked, Q18 “${b.note}”`;
  });

  await check('bank: skill gates do not touch the Bank', page, async () => {
    const r = await page.evaluate(Q => { XG.on = []; XG.off = []; XG.show = false; TOPICS = null; buildTopics(); const h = qHome(xq(Q));
      return {inBank: inBank(xq(Q)), inTopic: (TOPICS.byKey[h]?.qs || []).some(q => q.id === Q)} }, Q);
    errs();
    assert(r.inBank && r.inTopic, `Q18 inBank ${r.inBank}, in its Bank topic ${r.inTopic}`);
    return 'Q18 stays in the Bank under its topic with nothing learnt';
  });
  // owner 23 Nov: "we need to start working on the standard course" (STANDARD_SPEC.md step 4): the header switch reloads the page in
  // the other course; Standard 2 has its own topics and only Standard papers' questions (23 Nov: the pilot, Standard batch 1, filled
  // it), and every view opens without an error
  await check('course switch: Standard 2 opens its own topics and only Standard questions, then back to Advanced', page, async () => {
    await page.evaluate(() => { localStorage.setItem('course', 'standard'); location.hash = 'bank' }); await page.reload();
    await page.waitForSelector('#list .facard', {timeout: 20000});
    const inv = JSON.parse(fs.readFileSync(path.join(SITE, 'data/inventory.json'), 'utf8'));
    const stdDocs = new Set(inv.groups.filter(g => g.course === 'standard').flatMap(g => g.papers.flatMap(p => p.f || [p.id])).map(Number));
    const r = await page.evaluate(() => ({c: QG.course, sel: document.querySelector('#courseSel')?.value, n: B.questions.length, docs: [...new Set(B.questions.map(q => q.doc))],
      fas: [...document.querySelectorAll('#list .facard .fah b')].map(b => b.textContent)}));
    for (const v of ['inbox', 'review', 'exam', 'papers', 'guide', 'levels', 'bank']) { await page.evaluate(v => location.hash = v, v); await page.waitForTimeout(400) }
    errs();
    assert(r.c === 'standard' && r.sel === 'standard', `course ${r.c}, switch shows ${r.sel}`);
    const notStd = r.docs.filter(d => !stdDocs.has(Number(d)));
    assert(!notStd.length, `the Standard bank holds questions of papers that are not Standard: ${notStd.slice(0, 5)}`);
    assert(r.fas.includes('Network flow') && r.fas.includes('Annuities') && !r.fas.includes('Integral calculus'), `topics: ${r.fas.join(', ')}`);
    await page.evaluate(() => { localStorage.setItem('course', 'advanced'); location.hash = 'bank' }); await page.reload();
    await page.waitForSelector('#list .facard', {timeout: 20000});
    const a = await page.evaluate(() => ({c: QG.course, n: B.questions.length}));
    assert(a.c === 'advanced' && a.n > 0, `back to Advanced: course ${a.c}, ${a.n} questions`);
    return `${r.fas.length} Standard topics, ${r.n} questions from ${r.docs.length} Standard papers; Advanced back with ${a.n}`;
  });
  // owner 23 Nov: "All the advanced questions dissappeared and then when I went back to the advanced tab and opened the same exam, the
  // questions were now gone, destroying that eaxm": an Advanced exam opened with the page on Standard 2 switches the page to Advanced and
  // is never saved against the Standard bank; a question the bank cannot show stays in the saved exam
  await check('exams keep their course: an Advanced exam never loses questions on Standard 2', page, async () => {
    const ids = await page.evaluate(() => B.questions.filter(q => !q.dup_of).slice(0, 3).map(q => ({id: q.id, key: q.key})));
    const doc = {title: 'Mathematics Advanced', sub: 'PT course exam', items: ids.map(x => x.id), keys: ids.map(x => x.key), at: new Date().toISOString()};   // no course: saved before 23 Nov
    // 1. same course: a question the bank cannot show (retired) is kept and saved back
    const k = await page.evaluate(async d => { exmSub(); await QG.db.doc('exams/ePTgone').set({...d, items: [...d.items, 99999991], keys: [...d.keys, 'PT-GONE-Q1']}); await new Promise(r => setTimeout(r, 300));
      const x = XSAVED.find(s => s.id === 'ePTgone'); exmLoad(x); const shown = EX.items.length; await xSaveDb(true);
      return {shown, gone: (EX.gone || []).length, saved: window.__pt.store.get('exams/ePTgone').items}; }, doc);
    assert(k.shown === 3 && k.gone === 1 && k.saved.length === 4 && k.saved.includes(99999991), `retired question: ${JSON.stringify(k)}`);
    // owner 23 Nov (Difficulty checker screenshot): "D is missing in answer table": an open MCQ solution names its answer in every view
    const ans = await page.evaluate(() => { const q = {id: -1, type: 'mcq', marks: 1, options: [{label: 'C', is_correct: false}, {label: 'D', is_correct: true}]};   // options arrive with a topic file
      const t = document.createElement('div'); t.innerHTML = solHTML(q, {id: 1, source: 'generated', latex: 'x', criteria: [[1, 'Correct answer']], meta: {}}, 'bank');
      return {key: q.options.find(o => o.is_correct).label, cell: t.querySelector('td.ans')?.textContent || ''}; });
    assert(ans && ans.cell === ans.key, `MCQ answer cell in a Bank / Difficulty solution: ${JSON.stringify(ans)}`);
    // 2. on Standard 2: the Advanced exam is not listed; opening it switches the page to Advanced; nothing is written
    await page.evaluate(() => { localStorage.setItem('course', 'standard'); location.hash = 'exams' }); await page.reload();
    await page.waitForFunction(() => typeof QG !== 'undefined' && QG.course === 'standard' && typeof B !== 'undefined' && B && B.questions, null, {timeout: 30000});
    const w = await page.evaluate(async d => { exmSub(); await QG.db.doc('exams/ePTadv').set(d); await new Promise(r => setTimeout(r, 300));
      const n0 = window.__pt.log.length, x = XSAVED.find(s => s.id === 'ePTadv');
      EX = {...EX, id: 'ePTadv', course: 'advanced', items: [], sub: 'stale'}; await xSaveDb(true);   // a stale Advanced exam must not save here
      const refused = window.__pt.log.length === n0 && window.__pt.store.get('exams/ePTadv').items.length === 3;
      EXV.view = 'mine'; renderExams(); return {refused, listed: !!document.querySelector('[data-exm="ePTadv"]'), lead: document.querySelector('#exMine .exm-lead')?.textContent || ''}; }, doc);
    assert(w.refused, 'an Advanced exam was saved with the page on Standard 2');
    // owner 23 Nov: "you shouldn't even be able to see advanced exams in std and vice versa"
    assert(!w.listed && /Standard 2 exam/.test(w.lead), `My exams on Standard 2 lists the Advanced exam: ${w.listed}, "${w.lead}"`);
    await Promise.all([page.waitForNavigation({timeout: 20000}), page.evaluate(() => exmLoad(XSAVED.find(s => s.id === 'ePTadv')))]);   // any other way in (a stale link) switches the course
    await page.waitForFunction(() => typeof QG !== 'undefined' && QG.course === 'advanced', null, {timeout: 30000});
    const after = await page.evaluate(() => ({course: localStorage.getItem('course'), open: localStorage.getItem('exm_open')}));
    errs();
    assert(after.course === 'advanced', `opening it switched the course to ${after.course}`);
    return 'retired question kept (4 saved); on Standard 2 the Advanced exam is not listed, never saved, and a direct open switches to Advanced';
  });
  await page.context().close();
}

if (require.main !== module) { /* required by a debugging script: hand over the helpers, run nothing */ module.exports = {serve, newPage, boot, settle, unzip, FIXTURE, OUT}; return }
(async () => {
  for (const d of [OUT, SHOTS, DL]) fs.mkdirSync(d, {recursive: true});
  for (const d of [SHOTS, DL]) for (const f of fs.readdirSync(d)) fs.unlinkSync(path.join(d, f));
  if (!fs.existsSync(FIXTURE)) { try { cp.execFileSync('python3', [path.join(__dirname, 'page_test_fixture.py'), FIXTURE], {stdio: 'inherit'}) } catch (e) { console.log('(no fixture: the fake database starts empty)') } }
  const fx = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) : {docs: {}};
  const seed = fx.docs || {};
  // owner 13 Nov (Review: Inbox + one paper at a time): every live paper is approved, so the Review pages get a workload
  // (page_test_fixture.py WORKLOAD): these review docs are left out. Bank and Exams keep the live approved set.
  const dropR = new Set((fx.workload || {}).drop || []), seedR = Object.fromEntries(Object.entries(seed).filter(([k]) => !dropR.has(k)));
  // Fix 1 (14 Nov): the page loads the course index, not bank.json; index = sha256 of every file under data/bank/ (index + topic files)
  const bankDir = path.join(SITE, 'data/bank'), walk = d => fs.readdirSync(d, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const tested = {page: sha(PAGE), bank: sha(path.join(SITE, 'data/bank.json')), dotpoints: sha(path.join(SITE, 'data/dotpoints.json')),
    index: crypto.createHash('sha256').update(walk(bankDir).sort().map(f => path.relative(SITE, f) + ':' + sha(f)).join('\n')).digest('hex')};
  const srv = await serve(); const base = `http://127.0.0.1:${srv.address().port}/`;
  console.log(`page_test: ${path.relative(ROOT, PAGE)} sha256 ${tested.page.slice(0, 12)} on ${base} · fixture ${Object.keys(seed).length} db docs${QUICK ? ' · QUICK' : ''}${ONLY ? ' · only ' + [...ONLY].join(',') : ''}`);
  const browser = await chromium.launch({headless: !HEADED, args: ['--disable-dev-shm-usage']});
  let fatal = null;
  try {
    const combos = [[1280, 'light'], [390, 'light']].concat(QUICK ? [] : [[1280, 'dark'], [390, 'dark']]);
    const run = (f, ...a) => !ONLY || ONLY.has(f.name) ? f(...a) : null;
    await Promise.all([...combos.map(([w, t]) => run(sweep, browser, base, seedR, w, t)), run(phone, browser, base, seedR), run(areas, browser, base, seedR), run(processes, browser, base, seed), run(tonight, browser, base, seed), run(reviewFlow, browser, base, seedR), run(bankChip, browser, base, seed), run(nextUp, browser, base, seed), run(papersLanes, browser, base, seed, fx.papers), run(driveScan, browser, base, seed, fx), run(availOverlap, browser, base, seed), run(queueChecks, browser, base, seed), run(dataSplit, browser, base, seed), run(questionKeys, browser, base, seed), run(reportActions, browser, base, seed), run(skillGates, browser, base, seed), run(paperTables, browser, base, seed)]);
    // fix 13 Nov: the exam pool runs go beside the flows, not in the crowd above (each lays out up to 100-mark papers)
    await Promise.all([run(flows, browser, base, seed, seedR), run(examPools, browser, base, {live: seed, workload: seedR})]);
    const ext = [...new Set(outside)], bad = ext.filter(u => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u));
    await check('offline: no requests to public CDNs', null, async () => { assert(!bad.length, `${bad.length} outside request(s): ${bad.slice(0, 5).join(' ')}`); return ext.length ? `${ext.length} Google Fonts request(s) blocked, allowed` : 'none' });
  } catch (e) { fatal = String(e && e.stack || e); console.error('page_test could not finish:', fatal) }
  await browser.close(); srv.close();
  const failed = checks.filter(c => !c.ok);
  const res = {ok: !fatal && !failed.length && checks.length > 0, quick: QUICK, at: new Date().toISOString(), seconds: Math.round((Date.now() - T0) / 1000),
    tested, fixture: {made: fx.made || null, synced: fx.synced || null, docs: Object.keys(seed).length},
    passed: checks.length - failed.length, failed: failed.length, fatal, checks};
  fs.writeFileSync(RESULT, JSON.stringify(res, null, 1));
  console.log(`\npage_test: ${res.passed} passed, ${res.failed} failed${fatal ? ', STOPPED EARLY' : ''} in ${res.seconds} s → ${path.relative(ROOT, RESULT)}`);
  failed.forEach(c => console.log(`  FAIL ${c.name}: ${c.detail}${c.shot ? ' [' + c.shot + ']' : ''}`));
  process.exit(fatal ? 2 : failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2) });
