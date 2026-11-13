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
const QUICK = process.argv.includes('--quick');
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
  const seed = arg && arg.seed, role = (arg && arg.role) || 'editor';
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
  const user = {isOwner: async () => role === 'editor', canEdit: async () => role === 'editor', id: async () => 'u_pagetest', profiles: async ids => Object.fromEntries(ids.map(i => [i, {name: i === 'u_pagetest' ? 'Page test' : 'Colleague'}]))};
  const downloads = {save: async ({filename, data}) => {
    let bytes;
    if (typeof data === 'string') bytes = new TextEncoder().encode(data);
    else bytes = new Uint8Array(await data.arrayBuffer());
    let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    await window.__ptSave(filename, btoa(s));
    window.__pt.downloads.push({filename, size: bytes.length});
  }};
  window.__pt = {store, log, downloads: []};
  window.claude = {use: async n => n === 'db' ? db : n === 'user' ? (role === 'none' ? null : user) : n === 'downloads' ? downloads : null};
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

async function newPage(browser, base, seed, {width = 1280, theme = 'light', touch = false, role = 'editor'} = {}) {
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
  await page.addInitScript(fakeClaude, {seed, role});
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
async function boot(page, base, hash = '#bank') {
  await page.goto(base + 'review.html' + hash);
  await page.waitForFunction(() => typeof B !== 'undefined' && B && B.questions && typeof db !== 'undefined' && db && typeof EDITOR !== 'undefined' && EDITOR !== null && window.MathJax && MathJax.startup && MathJax.startup.promise, null, {timeout: 45000});
  await page.evaluate(() => MathJax.startup.promise);
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
  ['processes', '#processes', '#processesView', false],   // owner 14 Nov: the Import tab is now Processes
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
    const w = (await db()).log.slice(n0).filter(x => x.k === 'reviews/q' + was);
    const now = await page.evaluate(() => rlist[ridx] && rlist[ridx].id);
    errs(); assert(w.length && w[0].v.status === 'approved', `no approved write for reviews/q${was}`);
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
const CURATE_HASHES = ['#review', '#papers', '#processes', '#import', '#levels', '#difficulty', '#reports', '#review/difficulty', '#review/reports', '#review/papers', '#review/paper/323', '#review/paper/323/topics', '#review/list/recent'];
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
    for (const [h, want, v] of [['#levels', '#review/difficulty', 'levels'], ['#difficulty', '#review/difficulty', 'levels'], ['#reports', '#review/reports', 'reports'], ['#import', '#processes', 'processes'], ['#papers', '#review/papers', 'papers']]) {
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
      return {want: W.length, docs: W.map(w => w.doc).sort(), rep: repOpen().length, lv: lvTodoN(), view, rbar: !document.querySelector('#rbar').hidden,
        pn: card('papers')?.querySelector('.ict')?.textContent, rows: [...document.querySelectorAll('#inboxBox .iprow')].map(a => ({href: a.getAttribute('href'), dots: a.querySelectorAll('.mtrack i').length, line: a.querySelector('.ipl').textContent})),
        all: card('papers')?.querySelector('a.imore')?.getAttribute('href'),
        repDone: card('reports')?.classList.contains('idone'), repTxt: card('reports')?.innerText, lvDone: card('difficulty')?.classList.contains('idone'), lvTxt: card('difficulty')?.innerText, lvHref: card('difficulty')?.querySelector('a')?.getAttribute('href'),
        tab: document.querySelector('#todoN').textContent, sw: document.querySelector('#curN').textContent,
        recent: document.querySelector('#inboxBox .ifoot a')?.getAttribute('href'), lists: document.querySelectorAll('#inboxBox .ifoot select[data-lists] option').length};
    });
    errs(); assert(r.view === 'inbox' && !r.rbar, `#review opened view ${r.view} (bar shown ${r.rbar})`);
    assert(r.want === 3 && r.docs.join(',') === '1346,1601,323', `papers with work: ${r.docs.join(',')} (the fixture's workload is 1346, 323, 1601)`);
    assert(r.pn === String(r.want) && r.rows.length === r.want, `Papers card says ${r.pn}, ${r.rows.length} rows, want ${r.want}`);
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
      todo: [...document.querySelectorAll('#ptable tbody tr')].filter(tr => /left · at/.test(tr.innerText)).map(tr => tr.dataset.flow).sort(), cols: [...document.querySelectorAll('#ptable thead th')].map(t => t.textContent.replace(/[▲▼]/, '').trim()), back: document.querySelector('#papersView > a.rback')?.getAttribute('href'),
      filters: ['#pfQ', '#pfYear', '#pfTask', '#pfSrc', '#pfProg'].filter(s => document.querySelector(s)).length}));
    errs(); assert(r.hash === '#review/papers' && r.view === 'papers', `#papers → ${r.hash} (view ${r.view})`);
    assert(r.rows > 40 && r.tracks === r.rows && r.todo.join(',') === '1346,1601,323', `${r.rows} rows, ${r.tracks} tracks, with work: ${r.todo.join(',')}`);
    assert(['Paper', 'Review', 'Questions', 'Marks', 'Approved', 'MCQ', 'Short answer', 'Type', 'Source'].every(c => r.cols.includes(c)) && r.filters === 5 && r.back === '#review', `columns ${r.cols.join('/')}, ${r.filters} filters, back ${r.back}`);   // the old Papers tab's columns and filters stay
    await page.selectOption('#pfProg', 'todo'); await settle(page, 3000, 2);
    const nTodo = await page.evaluate(() => document.querySelectorAll('#ptable tbody tr').length);
    await page.selectOption('#pfProg', ''); await settle(page, 2000, 2);
    assert(nTodo === 3, `"Review work left" shows ${nTodo} rows`);
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
    const w = await writes(n0, 'reviews/q');
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
    const w = await writes(n0, 'reviews/');
    const done = await page.evaluate(() => ({pdone: document.querySelector('#rout .ppdone')?.innerText || '', next: document.querySelector('#rout .ppdone a.primary')?.getAttribute('href'), ok: paperOK('1601'), inbox: [...allWork().values()].filter(w => w.n).length}));
    errs(); assert(w.filter(x => x.k.startsWith('reviews/q')).length === 3 && w.some(x => x.k === 'reviews/paper_1601' && x.v.status === 'approved'), `writes: ${w.map(x => x.k).join(' ')}`);
    assert(done.ok && /is done/.test(done.pdone) && /^#review\/paper\/\d+$/.test(done.next || ''), `paper done panel “${done.pdone.slice(0, 80)}”, next ${done.next}`);
    assert(/done$/.test(r.toast) || /approved/.test(r.toast), `toast “${r.toast}”`);
    assert(r.steps.every(x => /done|none/.test(x.cls)) && done.inbox === 2, `track ${r.steps.map(x => x.cls).join('|')}; Inbox papers ${done.inbox}`);
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
async function processes(browser, base, seed) {
  const qd = (seed['progress/queue'] || {}).items || [], jd = (seed['progress/jobs'] || {}).jobs || [];
  const wantRun = jd.filter(j => !/^\s*queued\b/i.test(j.name)).length + qd.filter(x => x.status === 'running').length;
  const wantQ = qd.filter(x => (x.status || 'queued') === 'queued').sort((a, b) => a.order - b.order).map(x => x.title);
  const page = await newPage(browser, base, seed, {width: 1280, theme: 'light'});
  await boot(page, base, '#import');
  const errs = () => { const e = takeErrs(page); assert(!e.length, e.slice(0, 3).join(' | ')) };
  await check('processes: #import goes to #processes', page, async () => {
    const r = await page.evaluate(() => ({hash: location.hash, view, shown: !document.querySelector('#processesView').hidden, cur: document.querySelector('.views a[aria-current="page"]')?.textContent.trim(),
      old: !!document.querySelector('.views a[href="#import"]'), tab: document.querySelector('#vProcesses')?.textContent.trim()}));
    errs(); assert(r.hash === '#processes' && r.view === 'processes' && r.shown, `#import landed on ${r.hash} (view ${r.view})`);
    assert(r.cur === 'Processes' && r.tab === 'Processes' && !r.old, `the nav says “${r.cur}”, an Import link remains: ${r.old}`);
    return 'alias ok; nav reads Processes';
  });
  await check('processes: running and queued pills', page, async () => {
    const r = await page.evaluate(() => [...document.querySelectorAll('#jobs .jp')].map(jp => ({cls: jp.className, txt: jp.querySelector('.jpill').textContent.trim(), href: jp.querySelector('.jpill').getAttribute('href'), pop: jp.querySelector('.jpop').textContent})));
    errs(); assert(r.length === 2, `${r.length} pills in the header`);
    assert(/\brun\b/.test(r[0].cls) && r[0].txt === `${wantRun} running`, `running pill says “${r[0].txt}”, expected “${wantRun} running”`);
    assert(/\bque\b/.test(r[1].cls) && r[1].txt === `${wantQ.length} queued`, `queued pill says “${r[1].txt}”, expected “${wantQ.length} queued”`);
    assert(r.every(x => x.href === '#processes'), 'a pill does not link to #processes');
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
    assert(/Stage 2 of 4/.test(rp.txt) && rp.bar && /Started \d{1,2}:\d{2} [ap]m/.test(rp.txt) && /Est\. finish \d{1,2}:\d{2} [ap]m/.test(rp.txt), `running popover lacks step / Started / Est. finish: ${rp.txt.replace(/\s+/g, ' ').slice(0, 200)}`);
    await page.click('#jobs .run .jpill'); await settle(page, 3000, 2);
    const h = await page.evaluate(() => location.hash); errs();
    assert(h === '#processes', `clicking the running pill went to ${h}`);
    return `“${r[0].txt}”, “${r[1].txt}”; hover list ok; click → Processes`;
  });
  await check('processes: page sections and order', page, async () => {
    const r = await page.evaluate(() => {
      const v = document.querySelector('#processesView'), heads = [...v.querySelectorAll('#procBox h3, #procBox .pdone>summary, #importBox h2')].map(h => h.textContent.replace(/\s*\d+\s*$/, '').trim());
      return {heads, cards: [...v.querySelectorAll('.pcard')].map(c => ({name: c.querySelector('b').textContent, when: c.querySelector('.pwhen')?.textContent || ''})),
        queue: [...v.querySelectorAll('.pqueue li b')].map(b => b.textContent), asked: [...v.querySelectorAll('.pqueue .pasked')].map(a => getComputedStyle(a).fontStyle),
        doneOpen: v.querySelector('.pdone')?.open, doneDisp: getComputedStyle(v.querySelector('details.pdone')||v).display, doneBig: (()=>{const d=v.querySelector('details.pdone');if(!d)return 0;d.open=true;const m=Math.max(0,...[...d.querySelectorAll('li *')].map(e=>parseFloat(getComputedStyle(e).fontSize)));d.open=false;return m})(), doneN: v.querySelectorAll('.pdone li').length, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        // review 14 Nov: one "Running now" on the page; the Import dashboard's sub-headings are the small section labels, below the page title
        runHeads: [...v.querySelectorAll('h2,h3')].filter(h => /^Running now/.test(h.textContent.trim())).length,
        title: parseFloat(getComputedStyle(v.querySelector('#procBox h2')).fontSize), imp: parseFloat(getComputedStyle(v.querySelector('#importBox h2')).fontSize),
        bigSub: [...v.querySelectorAll('#importBox h2 ~ h2')].map(h => h.textContent), subs: [...v.querySelectorAll('#importBox > h3')].map(h => parseFloat(getComputedStyle(h).fontSize))};
    });
    errs();
    // owner 13 Nov: "recently done looks so big": Review's paper-done styles leaked into Recently done (both were .pdone)
    assert(r.doneDisp === 'block' && r.doneBig <= 14, `Recently done layout: display ${r.doneDisp}, largest text ${r.doneBig}px`);
    const order = ['Running now', 'Queued', 'Recently done', 'Import'].map(h => r.heads.indexOf(h));
    assert(order.every(i => i >= 0) && order.every((x, i) => !i || x > order[i - 1]), `sections out of order: ${r.heads.join(' | ')}`);
    assert(r.cards.length === wantRun, `${r.cards.length} running cards, expected ${wantRun}`);
    assert(r.cards.some(c => /^\d+ min ago$|^just now$/.test(c.when)), `no “N min ago” started time: ${JSON.stringify(r.cards)}`);
    assert(JSON.stringify(r.queue) === JSON.stringify(wantQ), `queue order ${r.queue.join(' / ')}`);
    assert(r.asked.length === wantQ.length && r.asked.every(x => x === 'italic'), `owner quotes not in italics: ${r.asked}`);
    assert(r.doneOpen === false && r.doneN >= 1, 'Recently done should be a collapsed list');
    assert(r.sw <= r.cw + 1, `horizontal scroll ${r.sw} > ${r.cw}`);
    assert(r.runHeads === 1, `${r.runHeads} “Running now” headings on Processes, expected 1`);
    assert(!r.bigSub.length && r.subs.length && r.subs.every(x => x < 14) && r.imp < r.title, `Import heading ${r.imp}px vs title ${r.title}px; big sub-headings: ${r.bigSub.join(', ')}; sub-heading sizes ${r.subs}`);
    return `${r.cards.length} running, ${r.queue.length} queued, ${r.doneN} done (collapsed), Import below with ${r.subs.length} small sub-headings`;
  });
  // owner 13 Nov: "Is there a way to see how far long the running process is, start and finish time as well?"
  await check('processes: job step, start, est. finish and duration', page, async () => {
    const T = /\d{1,2}:\d{2} [ap]m/;
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
      empty: [...document.querySelectorAll('#procBox .pempty')].map(p => p.textContent.trim()), import: !!document.querySelector('#importBox h2')}));
    errs(); assert(r.jobsHidden && !r.pills, `pills still showing with nothing running or queued (${r.pills})`);
    assert(r.empty.length === 2 && r.empty.every(t => t.length > 5 && t.length < 80), `empty states: ${JSON.stringify(r.empty)}`);
    assert(r.import, 'the Import heading is gone');
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
    assert(b.hash === '#processes', `a tap on the list went to ${b.hash}`); assert(b.sw <= b.cw + 1, `horizontal scroll ${b.sw} > ${b.cw}`);
    await tp.evaluate(() => { location.hash = '#bank' }); await settle(tp, 3000, 2);
    await tp.tap('#jobs .run .jpill'); await sleep(200);
    const r = await popState('#jobs .run .jpop');
    assert(r.vis && r.l >= 0 && r.r <= r.w, `running list at 390px: shown ${r.vis}, ${Math.round(r.l)}–${Math.round(r.r)}`);
    assert(/Started/.test(r.txt) && /Est\. finish/.test(r.txt), `running list has no times: ${r.txt.replace(/\s+/g, ' ').slice(0, 160)}`);
    await tp.tap('#jobs .run .jpill'); await settle(tp, 3000, 2);
    const h = await tp.evaluate(() => location.hash);
    const e = takeErrs(tp); assert(!e.length, e.join(' | '));
    assert(h === '#processes', `a second tap on the pill went to ${h}`);
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
      after: (() => { const v = document.querySelector('#processesView'), n = v.querySelector('#notesBox'), q = v.querySelector('#pQueH'), i = v.querySelector('#importBox'); return !!(n && q && i && (q.compareDocumentPosition(n) & 4) && (n.compareDocumentPosition(i) & 4)) })()}));
    errs(); assert(r.shown && /^Next up/.test(r.h), `Next up card: shown ${r.shown}, heading “${r.h}”`);
    assert(r.empty === 'Ideas for what to build next. Claude reads this list.', `empty state “${r.empty}”`);
    assert(r.after, 'Next up is not between the queue and the Import dashboard');
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

/* ---------------- Papers and the owner's import order on Processes ----------------
   owner 13 Nov: "Can the import queue be dynamic, me choosing which set of papers to import next? We can always [build the]
   framework for the courses standard extension and extension two [later] right?" The page reads data/inventory.json (here the
   fixture's small inventory, served in place of the live one) and db collection importq (seeded with one doc, paper 9103).
   Grid counts; Standard / Extension 1 / unknown rows have no checkboxes; tick a school + a paper, Add, ↑ ↓, drag, remove;
   390 px on a touch phone; a viewer gets no section, no fetch and no write. */
async function papersQueue(browser, base, seed, fx) {
  if (!fx) { await check('papers: fixture', null, async () => { throw new Error('work/page_test/fixture.json has no "papers": run tools/page_test_fixture.py') }); return }
  const inv = fx.inventory, seedQ = {...seed, ...fx.importq};
  const serveInv = async p => { p._inv = 0; await p.route(u => /\/data\/inventory\.json/.test(u.href), r => { p._inv++; return r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(inv)}) }) };
  const qdocs = p => p.evaluate(() => [...window.__pt.store.entries()].filter(([k]) => k.startsWith('importq/')).map(([k, v]) => ({k, ...v})).sort((a, b) => a.order - b.order));
  const qtexts = p => p.evaluate(() => [...document.querySelectorAll('#ivQList .ivql .ntext b')].map(b => b.textContent));
  const openG = (p, g) => p.evaluate(g => { const d = document.querySelector(`#ivGrid details[data-ivg="${g}"]`); if (d && !d.open) d.querySelector('summary').click() }, g);
  const page = await newPage(browser, base, seedQ, {width: 1280, theme: 'light'});
  await serveInv(page);
  await boot(page, base, '#processes'); await settle(page, 3000, 2);
  const errs = () => { const e = takeErrs(page); assert(!e.length, e.slice(0, 3).join(' | ')) };
  await check('papers: course x year grid counts', page, async () => {
    const r = await page.evaluate(() => {
      const v = document.querySelector('#processesView'), pos = s => { const a = v.querySelector(s), b = v.querySelector('#ivH'); return a && b ? a.compareDocumentPosition(b) : 0 };
      return {shown: !document.querySelector('#invBox').hidden, h: document.querySelector('#ivH')?.textContent.trim(), pause: document.querySelector('#invBox .ivpause')?.textContent.trim(),
        afterQueue: !!(pos('#pQueH') & 4), beforeNotes: !!(pos('#nupH') & 2), sub: document.querySelector('#ivSub')?.textContent,
        rows: Object.fromEntries([...document.querySelectorAll('#ivGrid details.ivg')].map(d => [d.dataset.ivg, {n: [...d.querySelectorAll('summary .ivn')].map(x => x.textContent.trim()), off: d.classList.contains('off'), note: d.querySelector('.ivnote')?.textContent || ''}])),
        q: [...document.querySelectorAll('#ivQList .ivql .ntext b')].map(b => b.textContent)};
    });
    errs(); assert(r.shown && r.h === 'Papers', `Papers section: shown ${r.shown}, heading “${r.h}”`);
    assert(r.afterQueue && r.beforeNotes, 'Papers is not between the queue and Next up');
    assert(/Import is paused\. This only sets the order for when it resumes\.$/.test(r.pause || ''), `pause note: “${r.pause}”`);
    assert(/^16 papers in the shared folder \(17 files\) · last folder scan .+, 2 new$/.test(r.sub || ''), `sub line: “${r.sub}”`);
    const want = {'advanced|12': ['8', '3', '4', '1'], 'advanced|11': ['2', '0', '0', '0'], 'ext1|12': ['3', '–', '–', '1'], 'standard|12': ['2', '–', '–', '0'], 'unknown|?': ['1', '–', '–', '0']};
    for (const [g, n] of Object.entries(want)) assert(r.rows[g] && r.rows[g].n.join(',') === n.join(','), `${g}: ${r.rows[g] && r.rows[g].n.join(',')} (want ${n.join(',')})`);
    assert(Object.keys(r.rows).join(',') === Object.keys(want).join(','), `rows ${Object.keys(r.rows)}`);
    for (const g of ['ext1|12', 'standard|12']) assert(r.rows[g].off && r.rows[g].note === 'needs course setup (topics, dot points, difficulty references)', `${g}: off ${r.rows[g].off}, note “${r.rows[g].note}”`);
    assert(!r.rows['advanced|12'].off && !r.rows['advanced|12'].note, 'the Advanced row is marked as needing setup');
    assert(r.q.join('|') === '2024 Knox Grammar School AT1', `import order from the seeded importq: ${r.q}`);
    return Object.entries(r.rows).map(([g, x]) => `${g} ${x.n.join('/')}`).join(' · ');
  });
  await check('papers: Standard / Extension / unknown rows cannot be ticked', page, async () => {
    for (const g of ['ext1|12', 'standard|12', 'unknown|?', 'advanced|11']) await openG(page, g);
    await settle(page, 1500, 2);
    const r = await page.evaluate(() => Object.fromEntries(['ext1|12', 'standard|12', 'unknown|?', 'advanced|11'].map(g => { const d = document.querySelector(`#ivGrid details[data-ivg="${g}"]`);
      return [g, {boxes: d.querySelectorAll('input[type=checkbox]').length, papers: d.querySelectorAll('.ivpp').length, msg: d.querySelector('.ivmsg')?.textContent || '', schools: [...d.querySelectorAll('.ivsh')].map(x => x.textContent.replace(/\d+$/, '').trim())}] })));
    const added = await page.evaluate(() => PQ.add([9401, 9501, 9301, 9601])), w = (await qdocs(page)).length; errs();
    for (const [g, n] of [['ext1|12', 3], ['standard|12', 2], ['unknown|?', 1], ['advanced|11', 2]]) assert(r[g].boxes === 0 && r[g].papers === n, `${g}: ${r[g].boxes} checkboxes, ${r[g].papers} papers (want 0, ${n})`);
    assert(/needs course setup \(topics, dot points, difficulty references\)/.test(r['ext1|12'].msg) && /can't be queued yet/.test(r['standard|12'].msg), `messages: ${r['ext1|12'].msg} / ${r['standard|12'].msg}`);
    assert(r['ext1|12'].schools.join('|') === 'Abbotsleigh|CSSA|Knox Grammar School', `ext1 papers by school: ${r['ext1|12'].schools}`);
    assert(added === 0 && w === 1, `PQ.add of non-Advanced / not-waiting papers wrote ${added} (importq docs ${w})`);
    return 'no checkboxes; listed by school; PQ.add refuses them';
  });
  await check('papers: tick a school and a paper, Add to import queue', page, async () => {
    await openG(page, 'advanced|12'); await settle(page, 1500, 2);
    const before = await page.evaluate(() => { const d = document.querySelector('#ivGrid details[data-ivg="advanced|12"]');
      return {boxes: [...d.querySelectorAll('[data-ivp]')].map(b => +b.dataset.ivp).sort(), inq: [...d.querySelectorAll('.ivchip.q')].map(c => c.textContent), all: d.querySelector('[data-ivall]')?.parentElement.textContent.trim(), bar: document.querySelector('#ivBar').hidden} });
    assert(before.boxes.join(',') === '9101,9102,9104', `tickable papers ${before.boxes} (want the 3 waiting ones not queued)`);
    assert(before.inq.join('|') === 'In queue · #1' && before.all === 'Select all 3 waiting' && before.bar, JSON.stringify(before));
    await page.click('#ivGrid details[data-ivg="advanced|12"] [data-ivsch][data-school="Abbotsleigh"]');
    let bar = await page.evaluate(() => ({t: document.querySelector('#ivSelN').textContent, hid: document.querySelector('#ivBar').hidden, all: (b => b && {c: b.checked, i: b.indeterminate})(document.querySelector('[data-ivall="advanced|12"]'))}));
    assert(!bar.hid && bar.t === '2 papers selected' && bar.all.i && !bar.all.c, `after ticking Abbotsleigh: ${JSON.stringify(bar)}`);
    await page.click('#ivc9104');
    bar = await page.evaluate(() => ({t: document.querySelector('#ivSelN').textContent, all: document.querySelector('[data-ivall="advanced|12"]').checked}));
    assert(bar.t === '3 papers selected' && bar.all, `after ticking 9104: ${JSON.stringify(bar)}`);
    await page.click('#ivAdd'); await settle(page, 2000, 2);
    const d = await qdocs(page), t = await qtexts(page); errs();
    assert(d.map(x => x.doc_id).join(',') === '9103,9101,9102,9104' && d.map(x => x.order).join(',') === '1,2,3,4', `importq: ${d.map(x => x.doc_id + '@' + x.order)}`);
    const n = d.find(x => x.doc_id === 9104);
    assert(n.k === 'importq/d9104' && n.label === '2026 Knox Grammar School AT4' && n.course === 'advanced' && n.year_level === 12 && n.added_by === 'u_pagetest' && !isNaN(Date.parse(n.at)), `doc fields: ${JSON.stringify(n)}`);
    assert(t.join('|') === '2024 Knox Grammar School AT1|2025 Abbotsleigh AT4|2023 Abbotsleigh AT2|2026 Knox Grammar School AT4', `on screen: ${t.join(' | ')}`);
    const after = await page.evaluate(() => { const d = document.querySelector('#ivGrid details[data-ivg="advanced|12"]'); return {boxes: d.querySelectorAll('[data-ivp]').length, inq: d.querySelectorAll('.ivchip.q').length, bar: document.querySelector('#ivBar').hidden, msg: d.querySelector('.ivmsg')?.textContent || ''} });
    assert(after.boxes === 0 && after.inq === 4 && after.bar, `after Add: ${JSON.stringify(after)}`);
    return `3 added in order; {doc_id, label, course, year_level, order, added_by, at}`;
  });
  await check('papers: reorder with ↑ ↓ and drag, remove', page, async () => {
    await page.click('#ivQList [data-ivmove="1"]'); await settle(page, 1500, 2);   // first (9103) down
    let t = await qtexts(page), d = (await qdocs(page)).map(x => x.label);
    assert(t[0] === '2025 Abbotsleigh AT4' && t[1] === '2024 Knox Grammar School AT1' && d.join('|') === t.join('|'), `after ↓: screen ${t.join(' | ')}, db ${d.join(' | ')}`);
    const last = page.locator('#ivQList .ivql > li').nth(3), first = page.locator('#ivQList .ivql > li').nth(0);
    await last.dragTo(first, {targetPosition: {x: 40, y: 3}}); await settle(page, 1500, 2);
    t = await qtexts(page); d = (await qdocs(page)).map(x => x.label);
    assert(t[0] === '2026 Knox Grammar School AT4' && d.join('|') === t.join('|'), `after drag: screen ${t.join(' | ')}, db ${d.join(' | ')}`);
    await page.click('#ivQList .ivql > li:nth-child(2) [data-ivdel]'); await settle(page, 1500, 2);
    t = await qtexts(page); const dd = await qdocs(page); errs();
    assert(dd.length === 3 && !dd.some(x => x.doc_id === 9101) && t.length === 3, `after remove: ${t.join(' | ')} (db ${dd.map(x => x.doc_id)})`);
    const back = await page.evaluate(() => !!document.querySelector('#ivGrid details[data-ivg="advanced|12"] [data-ivp="9101"]'));
    assert(back, 'a removed paper is not tickable again');
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); assert(sw <= 1, `horizontal scroll ${sw}px`);
    return t.join(' › ');
  });
  // review 13 Nov: the order the owner set survives a reload (a new page on the database the first one left behind)
  const kept = await page.evaluate(() => Object.fromEntries([...window.__pt.store.entries()]));
  const want = await qtexts(page);
  await page.context().close();
  const rp = await newPage(browser, base, kept, {width: 1280, theme: 'light'});
  await serveInv(rp);
  await boot(rp, base, '#processes'); await settle(rp, 3000, 2);
  await check('papers: the import order persists after a reload', rp, async () => {
    const t = await qtexts(rp), e = takeErrs(rp); assert(!e.length, e.join(' | '));
    assert(t.length === 3 && t.join('|') === want.join('|'), `after reload: ${t.join(' | ')} (want ${want.join(' | ')})`);
    return t.join(' › ');
  });
  await rp.context().close();
  // phone: the grid and the queue fit 390 px; ticking and ↑ work by tap
  const tp = await newPage(browser, base, seedQ, {width: 390, theme: 'dark', touch: true});
  await serveInv(tp);
  await boot(tp, base, '#processes'); await settle(tp, 3000, 2);
  await check('papers: phone 390px', tp, async () => {
    await tp.evaluate(() => document.querySelector('#ivGrid details[data-ivg="advanced|12"] summary').click()); await settle(tp, 1500, 2);
    await tp.tap('#ivc9102'); await tp.tap('#ivAdd'); await settle(tp, 2000, 2);
    await tp.tap('#ivQList .ivql > li:nth-child(2) [data-ivmove="-1"]'); await settle(tp, 1500, 2);
    const r = await tp.evaluate(() => { const b = document.querySelector('#invBox').getBoundingClientRect(), nums = [...document.querySelectorAll('#ivGrid summary .ivn')].map(n => n.getBoundingClientRect().right);
      return {t: [...document.querySelectorAll('#ivQList .ivql .ntext b')].map(x => x.textContent), right: b.right, w: innerWidth, nr: Math.max(...nums), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        rowH: document.querySelector('#ivGrid details[data-ivg="ext1|12"] summary').getBoundingClientRect().height} });
    const e = takeErrs(tp); assert(!e.length, e.join(' | '));
    assert(r.t.join('|') === '2023 Abbotsleigh AT2|2024 Knox Grammar School AT1', `after tick, Add and ↑ by tap: ${r.t.join(' | ')}`);
    assert(r.right <= r.w && r.nr <= r.right && r.sw <= r.cw + 1, `overflow at 390px: box right ${r.right}, numbers right ${r.nr}, scroll ${r.sw} > ${r.cw}`);
    return `fits (row with note ${Math.round(r.rowH)} px tall); tick, Add and ↑ work by tap`;
  });
  await tp.context().close();
  // a viewer: no section, no inventory fetch, no write
  const vp = await newPage(browser, base, seedQ, {width: 1280, theme: 'light', role: 'viewer'});
  await serveInv(vp);
  await boot(vp, base, '#bank');
  await check('papers (viewer): nothing shows, nothing is written', vp, async () => {
    await vp.evaluate(() => { location.hash = '#processes' }); await settle(vp, 2000, 2);
    const r = await vp.evaluate(async () => { PQ.render(); const n = await PQ.add([9101, 9102]); const rm = await PQ.remove('d9103');
      return {hash: location.hash, hidden: document.querySelector('#invBox').hidden, html: document.querySelector('#invBox').innerHTML.length, n, rm, w: window.__pt.log.filter(l => l.k.startsWith('importq/')).length} });
    assert(r.hidden && r.html === 0 && r.n === 0 && r.rm === false && r.w === 0 && r.hash === '#bank', JSON.stringify(r));
    assert(vp._inv === 0, `a viewer fetched data/inventory.json ${vp._inv} time(s)`);
    return 'hidden; #processes → #bank; PQ.add / PQ.remove refused; no fetch';
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
      const k = await page.evaluate(roomOf => { const room = eval(roomOf); let best = null, bv = -1e9;
        document.querySelectorAll('#xPages .exfigw').forEach(w => { const i = w.querySelector('img'); if (!i || !i.complete || !i.naturalWidth) return;
          const blk = w.closest('.xblk'); if (blk === blk.parentElement.firstElementChild) return;   // the first block on a sheet cannot move to the next
          const v = w.querySelector('.exfigbox').getBoundingClientRect().height - room(w); if (v > bv) { bv = v; best = w.dataset.figw } });
        if (best) document.querySelector(`#xPages [data-figw="${best}"]`).scrollIntoView({block: 'center'}); return best }, roomOf);
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
  const tested = {page: sha(PAGE), bank: sha(path.join(SITE, 'data/bank.json')), dotpoints: sha(path.join(SITE, 'data/dotpoints.json'))};
  const srv = await serve(); const base = `http://127.0.0.1:${srv.address().port}/`;
  console.log(`page_test: ${path.relative(ROOT, PAGE)} sha256 ${tested.page.slice(0, 12)} on ${base} · fixture ${Object.keys(seed).length} db docs${QUICK ? ' · QUICK' : ''}`);
  const browser = await chromium.launch({headless: !HEADED, args: ['--disable-dev-shm-usage']});
  let fatal = null;
  try {
    const combos = [[1280, 'light'], [390, 'light']].concat(QUICK ? [] : [[1280, 'dark'], [390, 'dark']]);
    await Promise.all([...combos.map(([w, t]) => sweep(browser, base, seedR, w, t)), phone(browser, base, seedR), areas(browser, base, seedR), processes(browser, base, seed), reviewFlow(browser, base, seedR), bankChip(browser, base, seed), nextUp(browser, base, seed), papersQueue(browser, base, seed, fx.papers), availOverlap(browser, base, seed), queueChecks(browser, base, seed)]);
    // fix 13 Nov: the exam pool runs go beside the flows, not in the crowd above (each lays out up to 100-mark papers)
    await Promise.all([flows(browser, base, seed, seedR), examPools(browser, base, {live: seed, workload: seedR})]);
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
