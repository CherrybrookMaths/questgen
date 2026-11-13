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
function fakeClaude(seed) {
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
  const user = {id: async () => 'u_pagetest', profiles: async ids => Object.fromEntries(ids.map(i => [i, {name: i === 'u_pagetest' ? 'Page test' : 'Colleague'}]))};
  const downloads = {save: async ({filename, data}) => {
    let bytes;
    if (typeof data === 'string') bytes = new TextEncoder().encode(data);
    else bytes = new Uint8Array(await data.arrayBuffer());
    let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    await window.__ptSave(filename, btoa(s));
    window.__pt.downloads.push({filename, size: bytes.length});
  }};
  window.__pt = {store, log, downloads: []};
  window.claude = {use: async n => n === 'db' ? db : n === 'user' ? user : n === 'downloads' ? downloads : null};
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

async function newPage(browser, base, seed, {width = 1280, theme = 'light', touch = false} = {}) {
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
  await page.addInitScript(fakeClaude, seed);
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
  await page.waitForFunction(() => typeof B !== 'undefined' && B && B.questions && typeof db !== 'undefined' && db && window.MathJax && MathJax.startup && MathJax.startup.promise, null, {timeout: 45000});
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
  ['review', '#review', '#reviewView', true, async p => {   // an empty queue shows no question: open "Every question" instead
    await p.evaluate(() => { if (!document.querySelector('#approve')) document.querySelector('#rout [data-gof="all"]')?.click() }); }],
  ['reports', '#reports', '#reportsView', false],
  ['papers', '#papers', '#papersView', false],
  ['processes', '#processes', '#processesView', false],   // owner 14 Nov: the Import tab is now Processes
  ['levels', '#levels', '#levelsView', true, async p => {   // nothing left to check: show All, so a part is on screen
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

async function flows(browser, base, seed) {
  const page = await newPage(browser, base, seed, {width: 1280, theme: 'light'});
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
    await page.evaluate(() => { location.hash = '#reports' }); await settle(page, 4000, 2);
    const r = await page.evaluate(() => ({rows: [...document.querySelectorAll('#reportsBox .rep-row')].map(li => li.innerText), badge: document.querySelector('#repN')?.textContent}));
    errs(); assert(r.rows.length >= 1, 'no report rows');
    assert(r.rows.some(t => /Wrong difficulty/.test(t) && /band 5/.test(t) && /Problem solving/.test(t) && /band looks too low/.test(t)), 'the new report (band 5 · Problem solving) is not listed: ' + (r.rows[0] || '').slice(0, 160));
    assert(r.badge === String(r.rows.length), `tab badge “${r.badge}” for ${r.rows.length} open report(s)`);
    return `${r.rows.length} open, badge ${r.badge}`;
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

  /* ---- Review: Agree (approve) writes and moves on ---- */
  await check('review: approve writes to the database and moves on', page, async () => {
    await page.evaluate(() => { location.hash = '#review' }); await settle(page, 5000, 2);
    let has = await page.$('#approve');
    if (!has) { await page.click('#rout [data-gof="all"]'); await settle(page, 4000, 2); has = await page.$('#approve') }   // empty queue: "Every question"
    assert(has, 'no Approve button in Review, even under "Every question"');
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
    assert(open.links.length === 8, `${open.links.length} links in the menu: ${open.links.join(', ')}`);
    assert(open.links.includes('Processes') && !open.links.includes('Import'), `the menu should name Processes, not Import: ${open.links.join(', ')}`);   // owner 14 Nov
    await page.click('#mSheet a[href="#papers"]'); await settle(page, 4000, 2);
    const r = await page.evaluate(() => ({hash: location.hash, hidden: document.querySelector('#mSheet').hidden, cur: document.querySelector('#menuCur').textContent, pv: !document.querySelector('#papersView').hidden, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth}));
    const e = takeErrs(page); assert(!e.length, e.join(' | '));
    assert(r.hash === '#papers' && r.pv, `did not go to Papers (${r.hash})`); assert(r.hidden, 'the menu stayed open'); assert(r.cur === 'Papers', `menu button says “${r.cur}”`);
    assert(r.sw <= r.cw + 1, `horizontal scroll ${r.sw} > ${r.cw}`);
    return `${open.links.length} links; Papers opened`;
  });
  await page.context().close();
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
    assert(wantQ.every(t => pop.txt.includes(t)) && /Open Processes/.test(pop.txt), `the queued list is missing items: ${pop.txt.slice(0, 160)}`);
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
        doneOpen: v.querySelector('.pdone')?.open, doneN: v.querySelectorAll('.pdone li').length, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        // review 14 Nov: one "Running now" on the page; the Import dashboard's sub-headings are the small section labels, below the page title
        runHeads: [...v.querySelectorAll('h2,h3')].filter(h => /^Running now/.test(h.textContent.trim())).length,
        title: parseFloat(getComputedStyle(v.querySelector('#procBox h2')).fontSize), imp: parseFloat(getComputedStyle(v.querySelector('#importBox h2')).fontSize),
        bigSub: [...v.querySelectorAll('#importBox h2 ~ h2')].map(h => h.textContent), subs: [...v.querySelectorAll('#importBox > h3')].map(h => parseFloat(getComputedStyle(h).fontSize))};
    });
    errs();
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
  // touch: the first tap shows the list, a tap on "Open Processes" goes there
  const tp = await newPage(browser, base, seed, {width: 390, theme: 'dark', touch: true});
  await boot(tp, base, '#bank');
  await check('processes: pills on a touch phone', tp, async () => {
    await tp.tap('#jobs .que .jpill'); await sleep(200);
    const a = await tp.evaluate(() => { const p = document.querySelector('#jobs .que .jpop'), r = p.getBoundingClientRect(); return {hash: location.hash, vis: getComputedStyle(p).display !== 'none', l: r.left, r: r.right, w: innerWidth} });
    assert(a.hash === '#bank' && a.vis, `first tap: hash ${a.hash}, list shown ${a.vis}`);
    assert(a.l >= 0 && a.r <= a.w, `the list runs off a ${a.w}px screen (${Math.round(a.l)}–${Math.round(a.r)})`);
    await tp.tap('#jobs .que .jgo'); await settle(tp, 3000, 2);
    const b = await tp.evaluate(() => ({hash: location.hash, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth}));
    const e = takeErrs(tp); assert(!e.length, e.join(' | '));
    assert(b.hash === '#processes', `“Open Processes” went to ${b.hash}`); assert(b.sw <= b.cw + 1, `horizontal scroll ${b.sw} > ${b.cw}`);
    return 'tap shows the list; Open Processes navigates';
  });
  await tp.context().close();
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
const figOnScreen = page => page.evaluate(() => {
  const w = [...document.querySelectorAll('#xPages .exfigw')].find(w => { const i = w.querySelector('img'); return i && i.complete && i.naturalWidth });
  if (!w) return null; w.scrollIntoView({block: 'center'}); return w.dataset.figw });
const figState = (page, k) => page.evaluate(k => { const w = document.querySelector(`#xPages [data-figw="${k}"]`), h = w.querySelector('.figh'), b = w.querySelector('.exfigbox').getBoundingClientRect(), hr = h.getBoundingClientRect();
  return {fs: EX.figscale[k] || 1, img: w.querySelector('img').getBoundingClientRect().width, box: {x: b.x, y: b.y, w: b.width, h: b.height}, hx: hr.x + hr.width / 2, hy: hr.y + hr.height / 2,
    hDisp: getComputedStyle(h).display, pct: getComputedStyle(w.querySelector('.figpct')).display, pctText: w.querySelector('.figpct').textContent} }, k);
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
    await page.mouse.dblclick(d.hx, d.hy); await settle(page, 4000, 2);
    const r = await page.evaluate(k => ({has: k in EX.figscale, fs: EX.figscale[k]}), k), e = await figState(page, k);
    errs(); assert(!r.has, `after a double-click EX.figscale[${k}] is ${r.fs}, expected it removed (100%)`);
    assert(e.box.w > small.box.w * 2, 'the diagram did not grow back after the reset');
    // keyboard: the handle is a slider; → steps 5%
    await page.focus(`#xPages [data-figh="${k}"]`); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(900); await settle(page, 3000, 2);
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
  const tested = {page: sha(PAGE), bank: sha(path.join(SITE, 'data/bank.json')), dotpoints: sha(path.join(SITE, 'data/dotpoints.json'))};
  const srv = await serve(); const base = `http://127.0.0.1:${srv.address().port}/`;
  console.log(`page_test: ${path.relative(ROOT, PAGE)} sha256 ${tested.page.slice(0, 12)} on ${base} · fixture ${Object.keys(seed).length} db docs${QUICK ? ' · QUICK' : ''}`);
  const browser = await chromium.launch({headless: !HEADED, args: ['--disable-dev-shm-usage']});
  let fatal = null;
  try {
    const combos = [[1280, 'light'], [390, 'light']].concat(QUICK ? [] : [[1280, 'dark'], [390, 'dark']]);
    await Promise.all([...combos.map(([w, t]) => sweep(browser, base, seed, w, t)), phone(browser, base, seed), processes(browser, base, seed), availOverlap(browser, base, seed), queueChecks(browser, base, seed)]);
    await flows(browser, base, seed);
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
