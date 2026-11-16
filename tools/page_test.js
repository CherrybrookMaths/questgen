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
    await new Promise((res, rej) => { const t = setTimeout(res, window.__pt.driveDelay || 0); if (sig) sig.addEventListener('abort', () => { clearTimeout(t); rej({code: 'cancelled', message: 'aborted'}) }, {once: true}) });
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
  ['exams-setup', '#exams', '#examsView', false, async p => p.evaluate(() => document.querySelector('[data-exv="setup"]').click())],
  ['exams-pick', '#exams', '#examsView', true, async p => p.evaluate(() => document.querySelector('[data-exv="pick"]').click())],
  ['exams-mine', '#exams', '#examsView', false, async p => p.evaluate(() => document.querySelector('[data-exv="mine"]').click())],
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
  await check('bank: open a subtopic', page, async () => {
    await page.click('#list .subrow[data-sel]:not(.none)');
    await page.waitForSelector('#list .cards .card', {timeout: 10000}); await settle(page, 5000, 2);
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
  await check('bank: add a question to the exam', page, async () => {
    const id = await page.evaluate(() => { const b = document.querySelector('#list [data-addx][aria-pressed="false"]'); if (!b) return null; b.click(); return +b.dataset.addx });
    assert(id, 'no "+ Add to exam" button on the cards');
    const r = await page.evaluate(id => ({inEx: EX.items.includes(id), btn: document.querySelector(`#list [data-addx="${id}"]`)?.textContent, stored: (JSON.parse(localStorage.getItem('qg_exam') || '{}').items || []).includes(id)}), id);
    errs(); assert(r.inEx, 'question not in EX.items'); assert(/In exam/.test(r.btn), `button says “${r.btn}”`); assert(r.stored, 'exam not kept in localStorage');
    await page.fill('#q', ''); return `QID ${id} added`;
  });

  /* ---- Exams: generate a 60-mark paper with 6 multiple choice ---- */
  let gen = null;
  ok = await check('exams: generate a 60-mark paper', page, async () => {
    await page.evaluate(() => { location.hash = '#exams' }); await settle(page, 4000, 2);
    await page.click('[data-exv="setup"]'); await settle(page, 3000, 2);
    await page.click('[data-sall="all"]'); await settle(page, 2000, 2);
    await page.evaluate(() => { for (const [id, v] of [['gMarks', 60], ['gMcq', 6]]) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', {bubbles: true})) } });
    const lab = await page.evaluate(() => [document.querySelector('#gMarksV')?.textContent, document.querySelector('#gMcqV')?.textContent]);
    await page.click('#gGo'); await waitPv();
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
      const n0 = await nDl(); await page.click('#xPdf'); const d = await waitDl(n0, 120000);
      const buf = fs.readFileSync(path.join(DL, d.filename.replace(/[^\w.\- ]+/g, '_')));
      const head = buf.slice(0, 5).toString('latin1'), pages = (buf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
      errs(); assert(head === '%PDF-', `file starts “${head}”`); assert(/%%EOF\s*$/.test(buf.slice(-32).toString('latin1')), 'no %%EOF at the end');
      assert(pages === examSheets, `${pages} PDF pages, the preview has ${examSheets} sheets`);
      return `${d.filename}: ${pages} pages, ${(d.size / 1e6).toFixed(1)} MB`;
    });
  }
  const wordCheck = async () => {
    page._warn = [];
    const n0 = await nDl(); await page.click('#xWord'); const d = await waitDl(n0, 120000);
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
    const n0 = await nDl(); await page.click('#xDl'); const d = await waitDl(n0, 30000);
    const h = fs.readFileSync(path.join(DL, d.filename.replace(/[^\w.\- ]+/g, '_')), 'utf8');
    const body = h.slice(h.indexOf('<body>'));
    errs(); assert(/^<!doctype html>/i.test(h), 'not an HTML document');
    assert(!/contenteditable/i.test(body), 'the file still has contenteditable elements');
    assert(!/class="[^"]*\bscr-only\b/.test(body), 'the file still has .scr-only (screen-only) elements');
    // owner 14 Nov: the diagram's corner handle and live % and the source line's ⓘ are screen only
    assert(!/class="(figpct|figh|figctl)\b|data-figh=|data-qinfo=/.test(body), 'the file still has a diagram handle, live % or an ⓘ');
    assert((body.match(/class="sheet"/g) || []).length === examSheets, 'sheet count differs from the preview');
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

  /* ---- Reports: report a question from the paper; it shows on the Reports tab ---- */
  let repQ = null;
  await check('reports: report a question from the preview', page, async () => {
    await page.click('[data-xdoc="exam"]'); await waitPv();
    // owner 14 Nov ("The dot point home looks stupid in a question" / "the i is fine"): the Report link moved from the question
    // into the card behind the ⓘ on the source line, so the report starts there
    repQ = await page.evaluate(() => +document.querySelector('#xPages [data-qinfo]').dataset.qinfo);
    await page.click(`#xPages [data-qinfo="${repQ}"]`);
    await page.click('#qiPop [data-qirep]');
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
    assert(link && link.has && /1 open report/.test(link.label), `the ⓘ is not marked as reported: ${JSON.stringify(link)}`);
    return `${w[0].k} for QID ${repQ}`;
  });

  /* ---- Swap, Lock, Regenerate ---- */
  await check('exams: swap, lock, then regenerate keeps the locked question', page, async () => {
    await page.click('#xPvClose'); await settle(page, 2000, 2);
    await page.click('[data-exv="pick"]'); await settle(page, 5000, 2);
    const before = await page.evaluate(() => EX.items.slice());
    const rows = await page.evaluate(() => [...document.querySelectorAll('#xPanel li[data-xi]')].map(li => +li.dataset.xi));
    assert(rows.length === before.length, `exam panel lists ${rows.length} rows for ${before.length} questions`);
    const wr = await page.evaluate(() => EX.items.filter(i => xq(i).type !== 'mcq'));
    const sw = wr[0], lk = wr[wr.length - 1];
    await page.click(`#xPanel li[data-xi="${sw}"] [data-xsw]`); await settle(page, 3000, 2);
    const afterSwap = await page.evaluate(() => EX.items.slice());
    assert(!afterSwap.includes(sw), `QID ${sw} is still in the exam after Swap`);
    assert(afterSwap.length === before.length, `Swap changed the number of questions (${before.length} → ${afterSwap.length})`);
    const lockId = afterSwap.includes(lk) ? lk : afterSwap.find(i => !before.includes(i));
    await page.click(`#xPanel li[data-xi="${lockId}"] [data-xlk]`); await settle(page, 2000, 2);
    const locked = await page.evaluate(id => ({inA: exA().locked.includes(id), pressed: document.querySelector(`#xPanel li[data-xi="${id}"] [data-xlk]`)?.getAttribute('aria-pressed'), swapOff: document.querySelector(`#xPanel li[data-xi="${id}"] [data-xsw]`)?.disabled}), lockId);
    assert(locked.inA && locked.pressed === 'true', `Lock did not stick: ${JSON.stringify(locked)}`);
    assert(locked.swapOff, 'Swap is still enabled on the locked row');
    await page.click('#exPvBtn'); await waitPv();
    await page.click('#exPvRegen'); await page.waitForFunction(() => /New exam/.test(document.querySelector('#toast')?.textContent || ''), null, {timeout: 30000}); await waitPv();
    const after = await page.evaluate(() => EX.items.slice());
    const same = after.filter(i => afterSwap.includes(i)).length;
    errs(); assert(after.includes(lockId), `locked QID ${lockId} is gone after Regenerate`);
    assert(same < after.length, 'Regenerate returned the very same exam');
    return `swapped QID ${sw}, locked QID ${lockId}; Regenerate kept it (${same - 1} other questions repeated of ${after.length})`;
  });

  /* ---- Save, My exams, rename, delete ---- */
  let saved = null;
  await check('exams: save, then My exams lists it', page, async () => {
    await page.click('#xPvClose'); await settle(page, 2000, 2);
    await page.evaluate(() => { EX.sub = 'Page test exam'; xsave() });
    await page.click('#exSaveSt [data-exm-save]');
    await page.waitForFunction(() => EX.id && window.__pt.store.has('exams/' + EX.id), null, {timeout: 5000});
    saved = await page.evaluate(() => EX.id);
    const doc = await dbGet('exams/' + saved);
    await page.click('[data-exv="mine"]'); await settle(page, 3000, 2);
    const row = await page.evaluate(id => document.querySelector(`#exMine [data-exm="${id}"]`)?.innerText || null, saved);
    const st = await page.evaluate(() => document.querySelector('#exSaveSt')?.dataset.st);
    errs(); assert(doc && doc.items && doc.items.length && doc.sub === 'Page test exam', 'saved doc: ' + JSON.stringify(doc).slice(0, 200));
    assert(row && /Page test exam/.test(row), 'My exams does not list the saved exam');
    assert(st === 'saved', `head marker is “${st}”, expected saved`);
    return `exams/${saved}, ${doc.items.length} questions`;
  });
  await check('exams: rename in My exams', page, async () => {
    assert(saved, 'nothing saved');
    await page.click(`#exMine [data-exm="${saved}"] [data-exm-ren]`);
    await page.fill(`#exMine [data-exm="${saved}"] [data-exm-rt]`, 'Page test renamed');
    await page.click(`#exMine [data-exm="${saved}"] [data-exm-rok]`); await settle(page, 2000, 2);
    const doc = await dbGet('exams/' + saved), row = await page.evaluate(id => document.querySelector(`#exMine [data-exm="${id}"]`)?.innerText || '', saved);
    errs(); assert(doc && doc.sub === 'Page test renamed', 'database still has ' + (doc && doc.sub));
    assert(/Page test renamed/.test(row), 'the row does not show the new name');
    return 'renamed';
  });
  await check('exams: delete in My exams', page, async () => {
    assert(saved, 'nothing saved');
    await page.click(`#exMine [data-exm="${saved}"] [data-exm-del]`);
    await page.click(`#exMine [data-exm="${saved}"] [data-exm-delok]`); await settle(page, 2000, 2);
    const doc = await dbGet('exams/' + saved), row = await page.evaluate(id => !!document.querySelector(`#exMine [data-exm="${id}"]`), saved);
    errs(); assert(!doc, 'still in the database'); assert(!row, 'still listed');
    return 'deleted';
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
  await page.context().close();
}

async function phone(browser, base, seed) {
  const page = await newPage(browser, base, seed, {width: 390, theme: 'light'});
  await boot(page, base);
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
    assert(st.cards.join(',') === 'papers,reports,difficulty', `Inbox cards: ${st.cards.join(',')}`);
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
      return {want: W.length, docs: W.map(w => w.doc).sort(), pc: Object.keys(B.docs).filter(d => B.docs[d].call && PCALL.list([d])[0].open).map(d => mainDoc(d)),
        // a paper imported after the fixture was taken has no review decision at all, so it has work (16 Nov: Batch 6)
        fresh: [...new Set(B.questions.map(q => String(q.doc)))].filter(d => !reviews['paper_' + d] && B.questions.filter(q => String(q.doc) === d).every(q => !reviews['q' + q.id] && !(q.key && reviews['k_' + q.key]))).map(d => mainDoc(d)).filter(d => [...allWork().values()].some(w => String(w.doc) === String(d))), rep: repOpen().length, lv: lvTodoN(), view, rbar: !document.querySelector('#rbar').hidden,
        pn: card('papers')?.querySelector('.ict')?.textContent, rows: [...document.querySelectorAll('#inboxBox .iprow')].map(a => ({href: a.getAttribute('href'), dots: a.querySelectorAll('.mtrack i').length, line: a.querySelector('.ipl').textContent})),
        all: card('papers')?.querySelector('a.imore')?.getAttribute('href'),
        repDone: card('reports')?.classList.contains('idone'), repTxt: card('reports')?.innerText, lvDone: card('difficulty')?.classList.contains('idone'), lvTxt: card('difficulty')?.innerText, lvHref: card('difficulty')?.querySelector('a')?.getAttribute('href'),
        tab: document.querySelector('#todoN').textContent, sw: document.querySelector('#curN').textContent,
        recent: document.querySelector('#inboxBox .ifoot a')?.getAttribute('href'), lists: document.querySelectorAll('#inboxBox .ifoot select[data-lists] option').length};
    });
    errs(); assert(r.view === 'inbox' && !r.rbar, `#review opened view ${r.view} (bar shown ${r.rbar})`);
    // the fixture's workload is 1346, 323, 1601; every paper with an open call raised on it (open_decisions.json "paper_<doc>") has work too (owner 13 Nov)
    const wantDocs = [...new Set(['1346', '1601', '323', ...r.pc, ...r.fresh.map(String)])].sort();
    assert(r.want === wantDocs.length && r.docs.join(',') === wantDocs.join(','), `papers with work: ${r.docs.join(',')} (want ${wantDocs.join(',')})`);
    // the card lists at most 8 papers (08_review.js SHOW), then "Show all papers"
    assert(r.pn === String(r.want) && r.rows.length === Math.min(8, r.want), `Papers card says ${r.pn}, ${r.rows.length} rows, want ${r.want} (${Math.min(8, r.want)} rows)`);
    assert(r.rows.every(x => x.dots === 5 && /^\d+ left · at (Your calls|Flagged|Topics|Diagrams|Spot-check)$/.test(x.line) && /^#review\/paper\/\d+$/.test(x.href)), `rows: ${JSON.stringify(r.rows)}`);
    assert(r.all === '#review/papers', `"Show all papers" goes to ${r.all}`);
    assert(r.rep === 0 && r.repDone && /Reports\s*nothing open/.test(r.repTxt), `Reports card with ${r.rep} open: done ${r.repDone} “${r.repTxt}”`);
    assert(r.lv === 0 && r.lvDone && /check plan finished/.test(r.lvTxt) && r.lvHref === '#review/difficulty', `Difficulty card with ${r.lv} to check: done ${r.lvDone} “${r.lvTxt}” → ${r.lvHref}`);
    const tot = String(r.want + r.rep); assert(r.tab === tot && r.sw === tot, `Review tab count ${r.tab}, Curate switch count ${r.sw}; want ${tot}`);
    assert(r.recent === '#review/list/recent' && r.lists > 5, `foot: Recently approved → ${r.recent}, ${r.lists} other lists`);
    await page.selectOption('#inboxBox .ifoot select[data-lists]', 'all'); await settle(page, 4000, 2);
    const l = await page.evaluate(() => ({hash: location.hash, view, rfilter, rstatus, n: rlist.length, track: document.querySelector('#filters').offsetHeight}));
    errs(); assert(l.hash === '#review/list/all' && l.view === 'review' && l.rfilter === 'all' && l.rstatus === 'any' && l.n > 1000 && !l.track, `Other lists → ${l.hash} ${l.rfilter}/${l.rstatus}, ${l.n} questions, track ${l.track}px`);
    return `${r.want} papers (${r.rows.map(x => x.line).join('; ')}); reports and difficulty ticked; tab and switch ${tot}; Other lists → All questions`;
  });

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
    let t;
    for (let i = 0; i < n; i++) { await page.keyboard.press('a'); await sleep(150); t = await page.evaluate(() => document.querySelector('#toast').textContent); }
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
    const w = (await writes(n0, 'reviews/' + await page.evaluate(id => RKEY.qdoc(B.questions.find(q => q.id === id)), qc.id))).pop(), after = await page.evaluate(d => ({left: paperWork(d).left.decide, inbox: [...allWork().values()].filter(w => w.n).length}), qc.doc);
    errs(); assert(w && w.v.status === 'approved' && w.v.call_at >= (await page.evaluate(id => B.questions.find(q => q.id === id).decide_at, qc.id)) && after.left === 0, `answering the question call: ${JSON.stringify(w && w.v)}, left ${after.left}`);
    assert(after.inbox === Object.keys(ib.W).length - live.length - 1, `Inbox papers after answering: ${after.inbox}, before ${Object.keys(ib.W).length}`);
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
    assert(r.lock === 'Locked · 3 courses, 8 papers' && r.lockRows.some(x => /^Year 11 Advanced 3 papers Held until Year 12 is finished \(your 13 Nov ruling\)$/.test(x)) && r.lockRows.some(x => /^Year 12 Extension 1 3 papers Needs course setup$/.test(x)), `locked: ${r.lock} ${JSON.stringify(r.lockRows)}`);
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
    assert(r.foot === '3 batches · 23 papersEst. US$276–391' || r.foot === '3 batches · 23 papers Est. US$276–391', `footer “${r.foot}”`);
    // owner 14 Nov: "Maybe remove the lock for now since I'm in charge of import"
    assert(!r.lim && !/Stops when \d|before the lock|limit/i.test(r.txt) && r.head === 'Runs top to bottom until the queue is empty. Stops early only if a batch comes back with unusual problems.' && r.est === 'Estimate US$12–17 a paper' && r.api === 'Until the import API is connected, this sends the queue to Claude.', `queue texts: ${r.head} / ${r.est} / ${r.api} / lock text ${!!r.lim}`);
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
    assert(r.rules[0] === '"EXT1" written without a space, or a "Y12 Ext1" folder 1 paper' && r.rules.length === 4, `rules ${r.rules}`);
    assert(r.rows.join() === '9140,9601' && r.cover, `rows to place ${r.rows}`);
    await page.click('#prCheck [data-prsee="ext1"]'); await settle(page, 500, 2);
    const see = await page.evaluate(() => [...document.querySelectorAll('#prCheck .pr-see li')].map(li => li.textContent));
    assert(see.length === 1 && /2024 Oakhill College AT2/.test(see[0]), `See all: ${see}`);
    await page.click('#prAccept'); await settle(page, 1200, 2);
    const acc = await docs(page, 'scans');
    assert(acc.length === 1 && acc[0].k === 'scans/rules' && acc[0].accepted === true && acc[0].version === 2 && acc[0].by === 'u_pagetest', `scans/rules ${JSON.stringify(acc)}`);
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
    await page.evaluate(() => { window.__pt.driveDelay = 400 });
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
      await page.click('[data-exv="setup"]'); await settle(page, 3000, 2);
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
  await page.click('[data-exv="setup"]'); await settle(page, 3000, 2);
  await page.click('[data-sall="all"]'); await settle(page, 2000, 2);
  await page.click('#gGo');
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
        await page.click('[data-exv="setup"]'); await settle(page, 2000, 2); await page.click('[data-sall="all"]'); await settle(page, 1500, 2);
        await page.evaluate(m => { for (const [id, v] of [['gMarks', m], ['gMcq', Math.round(m / 10)]]) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', {bubbles: true})) } }, marks);
        await page.click('#gGo'); await waitPv();
        const tot = await page.evaluate(() => xMarks(EX.items.map(xq).filter(Boolean)));
        const ex = await sheets();
        await page.click('[data-xdoc="guide"]'); await waitPv();
        const gd = await sheets();
        // a question cut inside a part (data-cut pieces) is put back together for Word (exRejoin) with exactly its own text
        const rj = await page.evaluate(() => {
          const norm = t => t.replace(/\s+/g, ' ').trim(), cut = [...new Set([...document.querySelectorAll('#xPages section.xq [data-cut]')].map(e => e.closest('section.xq').dataset.q))];
          const cl = document.querySelector('#xPages').cloneNode(true); exRejoin(cl); const bad = [];
          for (const q of cut) { const want = document.createElement('div'); want.innerHTML = EXC.get(exCKey(xq(+q), 'guide')) || '';
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
      for (let i = 0; !k && i < 6; i++) { await page.getByRole('button', {name: 'Regenerate', exact: true}).click(); await settle(page, 1500, 2); k = await pick() }
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
    assert(big.fs === 2, `dragging far out gives ${big.fs}, expected 2`); assert(small.fs === 0.3, `dragging far in gives ${small.fs}, expected 0.3`);
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
  await check('export: a resized diagram keeps its size in the HTML download', page, async () => {
    assert(k, 'no diagram');
    await page.evaluate(k => { EX.figscale[k] = 1.5; xsave(); exRelayout() }, k); await settle(page, 5000, 2);
    const n0 = await page.evaluate(() => window.__pt.downloads.length); await page.click('#xDl');
    await page.waitForFunction(n => window.__pt.downloads.length > n, n0, {timeout: 30000});
    const d = await page.evaluate(() => window.__pt.downloads[window.__pt.downloads.length - 1]);
    const h = fs.readFileSync(path.join(DL, d.filename.replace(/[^\w.\- ]+/g, '_')), 'utf8'), body = h.slice(h.indexOf('<body>'));
    errs(); assert(new RegExp(`data-figw="${k}" style="--fs:1\\.5"`).test(body), 'the download lost the diagram size');
    assert(/\.exfigw \.figslot\{zoom:var\(--fs,1\)/.test(h), 'the download has no rule applying --fs');
    assert(!/class="(figpct|figh)\b/.test(body), 'the download has the handle or the live %');
    await page.evaluate(k => { delete EX.figscale[k]; xsave(); exRelayout() }, k); await settle(page, 5000, 2);
    return `${d.filename}: ${k} at 150%`;
  });

  /* ---- #4: the ⓘ card ---- */
  await check('paper: the dot-point line is gone, an ⓘ ends each source line', page, async () => {
    const r = await page.evaluate(() => ({old: document.querySelectorAll('#xPages .exalpha, #xPages .exdot, #xPages [data-rep]').length,
      src: document.querySelectorAll('#xPages .xq .xsrc').length, info: document.querySelectorAll('#xPages .xq .xsrc > .exsrcl + button.exinfo.scr-only[data-qinfo][aria-haspopup="dialog"]').length,
      txt: [...document.querySelectorAll('#xPages .xq .xsrc')].some(x => /Y1[12]-\d{3}|Report/.test(x.innerText))}));
    errs(); assert(!r.old, `${r.old} old dot-point line / Report link element(s) on the paper`); assert(!r.txt, 'a source line still shows a dot point or "Report"');
    assert(r.src > 0 && r.info === r.src, `${r.info} ⓘ buttons for ${r.src} source lines`);
    return `${r.info} source lines, each with an ⓘ`;
  });
  await check('paper: the ⓘ card (dot points, band, kind, Report)', page, async () => {
    const q = await page.evaluate(() => { const b = [...document.querySelectorAll('#xPages [data-qinfo]')].find(b => qLeaves(xq(+b.dataset.qinfo)).length > 1) || document.querySelector('#xPages [data-qinfo]');
      b.scrollIntoView({block: 'center'}); EXV.sel = null; return +b.dataset.qinfo });
    await settle(page, 1000, 2);
    const sel0 = await page.evaluate(() => EXV.sel);
    await page.click(`#xPages [data-qinfo="${q}"]`);
    const c = await page.evaluate(q => { const p = document.querySelector('#qiPop'); if (!p) return null; const r = p.getBoundingClientRect();
      return {txt: p.innerText, role: p.getAttribute('role'), exp: document.querySelector(`#xPages [data-qinfo="${q}"]`).getAttribute('aria-expanded'), in: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
        parts: p.querySelectorAll('.qiparts > li').length, leaves: qLeaves(xq(q)).length, sel: EXV.sel} }, q);
    assert(c, 'the ⓘ did not open a card');
    assert(c.role === 'dialog' && c.exp === 'true', `role ${c.role}, aria-expanded ${c.exp}`);
    assert(/Y1[12]-\d{3}/.test(c.txt) && /Band \d|Not rated/.test(c.txt) && /Fluency|Problem solving/.test(c.txt) && /Report/.test(c.txt), 'the card lacks a dot point, band, kind or Report: ' + c.txt.slice(0, 160));
    assert(c.parts === c.leaves, `${c.parts} part rows for ${c.leaves} parts`); assert(c.in, 'the card is not inside the window');
    assert(c.sel === sel0, 'clicking the ⓘ also selected the question');
    await page.mouse.click(5, 300);   // outside
    assert(!(await page.$('#qiPop')), 'a click outside did not close the card');
    // keyboard: Enter opens, Esc closes and returns focus, the preview stays open
    await page.focus(`#xPages [data-qinfo="${q}"]`); await page.keyboard.press('Enter');
    assert(await page.$('#qiPop'), 'Enter on the ⓘ did not open the card');
    await page.keyboard.press('Tab');
    const f1 = await page.evaluate(() => document.activeElement?.matches('#qiPop [data-qirep]'));
    assert(f1, 'Tab does not reach Report in the card');
    await page.keyboard.press('Escape');
    const k2 = await page.evaluate(q => ({pop: !!document.querySelector('#qiPop'), focus: document.activeElement?.dataset?.qinfo, pv: document.body.classList.contains('xpv-on')}), q);
    assert(!k2.pop && k2.focus === String(q) && k2.pv, `after Esc: ${JSON.stringify(k2)}`);
    // Report from the card opens the form
    await page.click(`#xPages [data-qinfo="${q}"]`); await page.click('#qiPop [data-qirep]');
    const f = await page.evaluate(q => ({dlg: !!document.querySelector('#repDlg .repdlg') && !document.querySelector('#repDlg').hidden, pop: !!document.querySelector('#qiPop'), title: document.querySelector('#repT')?.textContent, q: REP.dlg?.q}), q);
    assert(f.dlg && !f.pop && f.q === q, `Report from the card: ${JSON.stringify(f)}`);
    await page.keyboard.press('Escape');
    const g = await page.evaluate(() => ({dlg: !document.querySelector('#repDlg')?.hidden, pv: document.body.classList.contains('xpv-on')}));
    errs(); assert(!g.dlg && g.pv, `Esc on the form: ${JSON.stringify(g)}`);
    return `QID ${q}: ${c.parts} part(s) · “${f.title}”`;
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
    return r.replace(/\s+/g, ' ').slice(0, 90) + ` · ${dup.m} question(s) share a row across parts`;
  });
  await page.context().close();

  /* touch phone: a finger drag on the handle, and the ⓘ card fits the screen */
  const tp = await newPage(browser, base, seed, {width: 390, theme: 'dark', touch: true});
  await boot(tp, base, '#exams');
  await check('exams: diagram resize and ⓘ on a touch phone', tp, async () => {
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
    const c = await tp.evaluate(() => { const p = document.querySelector('#qiPop'); if (!p) return null; const r = p.getBoundingClientRect(); return {l: r.left, r: r.right, t: r.top, b: r.bottom, W: innerWidth, H: innerHeight, sx: document.documentElement.scrollWidth} });
    const e = takeErrs(tp); assert(!e.length, e.join(' | '));
    assert(c, 'tapping the ⓘ did not open the card');
    assert(c.l >= 8 && c.r <= c.W - 8 && c.t >= 0 && c.b <= c.H, `card off screen: ${JSON.stringify(c)}`);
    assert(b2.w >= 16 && hr >= 8, `ⓘ ${b2.w.toFixed(0)} px, handle ${hr.toFixed(0)} px wide on the phone paper`);
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
    return `${k}: finger drag → ${Math.round(s1.fs * 100)}%; ⓘ ${b2.w.toFixed(0)} px, card ${Math.round(c.r - c.l)} px wide; ${under.n} controls stay under the toolbar`;
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
    const mid = await dp.evaluate(() => !!document.querySelector('#examsView [data-exv]'));
    dhold = false; dheld.splice(0).forEach(r => r.continue());
    await dp.waitForFunction(() => QG.detOK && document.querySelector('#examsView [data-exv]'), null, {timeout: 15000}); await settle(dp, 4000, 2);
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
    const ck = Object.keys(crop)[0].replace(/^figures\/|\.png$/g, ''), cdoc = ck.split('_')[0];
    const kept = fs.readdirSync(path.join(SITE, 'data/img')).filter(f => /^\d+\.json$/.test(f)).map(f => f.slice(0, -5));
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

/* ---------------- main ---------------- */
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
    await Promise.all([...combos.map(([w, t]) => run(sweep, browser, base, seedR, w, t)), run(phone, browser, base, seedR), run(areas, browser, base, seedR), run(processes, browser, base, seed), run(tonight, browser, base, seed), run(reviewFlow, browser, base, seedR), run(bankChip, browser, base, seed), run(nextUp, browser, base, seed), run(papersLanes, browser, base, seed, fx.papers), run(driveScan, browser, base, seed, fx), run(availOverlap, browser, base, seed), run(queueChecks, browser, base, seed), run(dataSplit, browser, base, seed), run(questionKeys, browser, base, seed)]);
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
