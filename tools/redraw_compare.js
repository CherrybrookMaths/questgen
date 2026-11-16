// Compare every re-rendered redraw (tikz/svg/<key>.svg, tools/render_redraws.py) with the approved version the page publishes
// (site/data/svg/g<n>.json: {key: data URI}). Job 3 (CLAUDE.md first jobs): "compare every re-rendered redraw with the published
// approved version; list anything beyond a pixel or two for the owner instead of assuming it matches."
// Identical bytes pass at once. Otherwise both are drawn by the same browser at 2x their size on a white canvas and compared
// pixel by pixel (a pixel differs when any channel differs by more than 48 of 255). Usage:
//   node tools/redraw_compare.js            -> work/render/redraw_compare.json and a summary
const {chromium} = require('playwright'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), SITE = path.join(ROOT, 'site'), OUT = path.join(ROOT, 'work/render/redraw_compare.json');
(async () => {
  const pub = {};
  for (const f of fs.readdirSync(path.join(SITE, 'data/svg')).filter(f => /^g\d+\.json$/.test(f)))
    Object.assign(pub, JSON.parse(fs.readFileSync(path.join(SITE, 'data/svg', f), 'utf8')));
  const res = {}, todo = [];
  for (const [k, uri] of Object.entries(pub)) {
    const f = path.join(ROOT, 'tikz/svg', k + '.svg');
    if (!fs.existsSync(f)) { res[k] = {st: 'not rendered'}; continue }
    const mine = 'data:image/svg+xml;base64,' + fs.readFileSync(f).toString('base64');
    if (mine === uri) res[k] = {st: 'identical'}; else todo.push([k, uri, mine]);
  }
  const b = await chromium.launch(), p = await b.newPage();
  await p.setContent('<html><body></body></html>');
  for (let i = 0; i < todo.length; i += 20) {
    const part = await p.evaluate(async items => {
      const load = u => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error('load')); im.src = u });
      const draw = (im, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(im, 0, 0, w, h); return x.getImageData(0, 0, w, h).data };
      const out = {};
      for (const [k, a, bb] of items) {
        try {
          const A = await load(a), B = await load(bb);
          const aw = A.naturalWidth, ah = A.naturalHeight, bw = B.naturalWidth, bh = B.naturalHeight;
          const sizeOff = Math.max(Math.abs(aw - bw) / Math.max(aw, 1), Math.abs(ah - bh) / Math.max(ah, 1));
          const w = Math.max(1, Math.round(aw * 2)), h = Math.max(1, Math.round(ah * 2));
          const da = draw(A, w, h), db = draw(B, w, h); let diff = 0, ink = 0;
          for (let j = 0; j < da.length; j += 4) {
            const d = Math.max(Math.abs(da[j] - db[j]), Math.abs(da[j + 1] - db[j + 1]), Math.abs(da[j + 2] - db[j + 2]));
            if (d > 48) diff++;
            if (da[j] < 200 || da[j + 1] < 200 || da[j + 2] < 200) ink++;
          }
          out[k] = {st: 'differs', px: diff, ink, frac: ink ? +(diff / ink).toFixed(4) : 0, size: [aw, ah, bw, bh], sizeOff: +sizeOff.toFixed(4)};
        } catch (e) { out[k] = {st: 'error', err: String(e.message || e)} }
      }
      return out;
    }, todo.slice(i, i + 20));
    Object.assign(res, part);
  }
  await b.close();
  // "a pixel or two": at most 2 differing pixels at 2x and the same size (within 0.5%) counts as the same picture
  for (const r of Object.values(res)) if (r.st === 'differs' && r.px <= 2 && r.sizeOff <= 0.005) r.st = 'same';
  fs.mkdirSync(path.dirname(OUT), {recursive: true}); fs.writeFileSync(OUT, JSON.stringify(res, null, 0));
  const n = {}; Object.values(res).forEach(r => n[r.st] = (n[r.st] || 0) + 1);
  console.log('redraw_compare:', Object.keys(res).length, 'published redraws:', JSON.stringify(n));
  const worst = Object.entries(res).filter(([, r]) => r.st === 'differs' || r.st === 'error').sort((a, b) => (b[1].frac || 1) - (a[1].frac || 1)).slice(0, 15);
  worst.forEach(([k, r]) => console.log(' ', k, r.st, r.px != null ? `${r.px} px (${(100 * r.frac).toFixed(2)}% of ink), size ${r.size.join('x')}` : r.err));
})();
