// Main topics (homes) of new questions, from the page's own qHome() (IMPORT_PLAYBOOK step 12). Serve site/ on 8766 first. Usage: node tools/homes.js 382,369,...
const {chromium} = require('playwright');
(async () => {
  const docs = new Set(process.argv[2].split(',').map(Number));
  const b = await chromium.launch(), p = await b.newPage();
  await p.goto(`http://localhost:${process.env.QG_HOMES_PORT || 8766}/review.html#bank`);   // tools/homes.py passes a free port
  await p.waitForFunction('typeof B==="object"&&B&&B.questions&&typeof qHome==="function"&&typeof QG==="object"&&QG.detOK', null, {timeout: 120000});
  const out = await p.evaluate(ds => { const r = {}; B.questions.filter(q => ds.includes(q.doc)).forEach(q => { r[q.id] = qHome(q) || null }); return r }, [...docs]);
  console.log(JSON.stringify(out)); await b.close();
})();
