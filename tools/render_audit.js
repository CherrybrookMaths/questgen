// Render every question (text, options, tables, solutions, criteria) exactly as the review page does and report
// MathJax errors and visible raw LaTeX. Usage: node render_audit.js [docIds,comma-separated] > out.json
// Needs: python3 -m http.server 8765 in site/ (started by verify.py).
const {chromium}=require('playwright');
(async()=>{
  const docs=(process.argv[2]||'').split(',').filter(Boolean).map(Number);
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1200,height:900}});
  // the sandbox cannot reach the CDN: serve the same pinned MathJax 4.1.3 from a local npm copy
  // MathJax install from tools/run_render_audit.sh: $QG_MJ, else <QG_SCRATCH or system temp>/questgen/mj
  const os=require('os'), path=require('path');
  const NM=path.join(process.env.QG_MJ||path.join(process.env.QG_SCRATCH||path.join(os.tmpdir(),'questgen'),'mj'),'node_modules')+'/', fs=require('fs');
  await p.route(/cdn\.jsdelivr\.net\/npm\//,r=>{const u=new URL(r.request().url()).pathname.replace(/^\/npm\//,'').replace(/@\d+\.\d+\.\d+/g,'');
    const f=NM+u; if(fs.existsSync(f)) r.fulfill({path:f,contentType:f.endsWith('.js')?'application/javascript':f.endsWith('.json')?'application/json':undefined}); else r.abort()});
  await p.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());
  await p.goto('http://localhost:8765/review.html#bank'); await p.waitForFunction('typeof B==="object"&&B&&window.MathJax&&MathJax.startup&&MathJax.startup.promise',null,{timeout:60000});
  await p.evaluate(()=>MathJax.startup.promise);
  const res=await p.evaluate(async(docs)=>{
    const out=[]; const box=document.createElement('div'); box.style.cssText='position:absolute;left:0;top:0;width:900px'; document.body.appendChild(box);
    const qs=B.questions.filter(q=>!q.dup_of&&(!docs.length||docs.includes(q.doc)));
    for(const q of qs){
      box.innerHTML=qBody(q,'review');
      try{await MathJax.typesetPromise([box])}catch(e){out.push({id:q.id,err:['typeset exception: '+e.message]});continue}
      const errs=[];
      box.querySelectorAll('mjx-merror,[data-mjx-error]').forEach(e=>errs.push('MathJax: '+(e.getAttribute('data-mjx-error')||e.textContent).slice(0,120)));
      const w=document.createTreeWalker(box,NodeFilter.SHOW_TEXT); let n;
      while((n=w.nextNode())){const t=n.textContent; if(n.parentElement.closest('mjx-container,script,style,textarea'))continue;
        const m=t.match(/\\(begin|end|frac|dfrac|text|exfigure|extable|left|right|times|sqrt|int|item)\b|\$\$|\$\\|\$[a-zA-Z(]|\\\\/); if(m) errs.push('raw LaTeX visible: '+t.trim().slice(0,100))}
      box.querySelectorAll('mjx-container:not([display="true"])').forEach(m=>{if(m.querySelector('mjx-linestrut, mjx-mtable')&&!m.closest('table'))errs.push('line break inside inline maths')});
      if(errs.length) out.push({id:q.id,doc:q.doc,number:q.number,err:[...new Set(errs)].slice(0,6)});
      MathJax.typesetClear([box]);
    }
    return {checked:qs.length,problems:out};
  },docs);
  console.log(JSON.stringify(res)); await b.close();
})();
