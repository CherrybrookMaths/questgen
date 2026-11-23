/* ---------- question body (shared by both views) ---------- */
function leaf(q,p){return !q.parts.some(c=>c.parent===p.id)}
// o.open (Difficulty, owner 24 Nov: "for the difficulty page, can u put the solution next to the question, its important I see both
// quickly and properly to judge difficulty"): solutions open and the MCQ answer marked, as in Review; the options and their
// solution share one .qpair box so the Difficulty card can set them side by side
function qBody(q,mode,o){
  if(!QG.has(q))return QG.pending(q,mode);   // Fix 1 (owner 14 Nov: "Ok we should run Fix 1 and 2"): text not here yet: a placeholder that fills itself in
  const show=mode==='review'||!!o?.open||revealed.has(q.id), open=mode==='review'||!!o?.open?' open':'';
  const fk=figKeys(q);
  const loose=fk.all.filter(k=>!fk.inline.has(k)&&!fk.opt.has(k)&&!q.figures.find(f=>f.src.endsWith('/'+k+'.png')&&f.part)).map(k=>`<span class="figslot" data-fig="${k}"></span>`).join('');
  const partFigs=pid=>q.figures.filter(f=>f.part===pid).map(f=>{const k=f.src.split('/').pop().replace('.png','');return fk.inline.has(k)?'':`<span class="figslot" data-fig="${k}"></span>`}).join('');
  let first=true;
  const parts=q.parts.map(p=>{
    const sol=solsFor(q,p.id,mode); const lf=leaf(q,p);
    const solBlock=sol.count?`<details class="solbox"${open}><summary>Solution${sol.count>1?'s':''}</summary>${sol.html}</details>`:(sol.hidden?'<div class="pending">Worked solution waiting for approval</div>':'');
    const tags=lf&&mode!=='bank'?(mode==='tags'?tagsHTML(q,p):mode==='review'?`<details class="tagfold"${editing===p.id?' open':''}><summary>Syllabus tags (not part of your check)</summary>${tagEditHTML(q,p)}</details>`:tagsHTML(q,p)):'';
    const h=`<div class="part ${p.parent?'child':''} ${first&&!p.label?'first':''} ${p.label?'':'nolabel'}">${p.label?`<span class="plabel">(${esc(p.label)})</span>`:''}
      <div class="tx">${tex(p.latex)}${partFigs(p.id)}</div><span class="pmarks">${p.marks!=null&&!(q.parts.length===1&&p.marks===q.marks)?p.marks+(p.marks===1?' mark':' marks'):''}</span>
      ${tags||solBlock?`<div class="under">${tags}${solBlock}</div>`:''}</div>`;
    first=false; return h;
  }).join('');
  let opts='';
  const lay=q.layout||(q.opt_table?'table':'text');
  const ans=o=>show&&o.is_correct?`<span class="badge ${o.key_source==='generated'?'b-gen':'b-ok'}">${o.key_source==='generated'?'model key':'answer'}</span>`:'';
  if(lay==='table'&&q.opt_table) opts=optTableHTML(q,show);
  else if(lay==='graph') opts=`<div class="ogrid">${q.options.map(o=>`<div class="ocell ${o.is_correct&&show?'correct':''}"><div class="ohd"><b>${o.label}.</b>${ans(o)}</div>${o.fig?`<span class="figslot" data-fig="${o.fig}"></span>`:`<span class="tx">${tex(o.latex)}</span>`}</div>`).join('')}</div>`;
  else if(q.options.length) opts=`<div class="opts">${q.options.map(o=>`<div class="opt ${o.is_correct?'correct':''} ${show?'show':''}"><b>${o.label}.</b><span class="tx">${tex(o.latex)}</span>${show&&o.is_correct?`<span class="badge ${o.key_source==='generated'?'b-gen':'b-ok'}">${o.key_source==='generated'?'model key':'answer'}</span>`:''}</div>`).join('')}</div>`;
  const qs=solsFor(q,null,mode);
  const qsol=qs.count?`<details class="solbox"${open}><summary>${q.type==='mcq'?'Answer and solution':'Solution'}</summary>${qs.html}</details>`:(qs.hidden?'<div class="pending">Worked solution waiting for approval</div>':'');
  return `<div class="qbody">${q.stem?`<div class="tx">${tex(q.stem)}</div>`:''}${loose}${parts}${o?.open&&opts&&qsol?`<div class="qpair">${opts}${qsol}</div>`:opts+qsol}</div>`;
}

