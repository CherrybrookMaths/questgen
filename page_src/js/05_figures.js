/* ---------- figures ---------- */
// owner 12 Nov: High-confidence diagrams are spot-checked (1 per paper). When a paper's sampled High diagrams are all approved
// and none of its High diagrams is flagged, the paper's other High diagrams count as approved (bug found on QID 1647:
// 328 unsampled redraws were never shown).
let _clean=null;
function spotClean(doc){_clean=_clean||{};if(doc in _clean)return _clean[doc];let ok=true,any=false;
  B.questions.forEach(q=>{if(q.doc!==doc||q.dup_of)return;chkFigsAll(q).forEach(k=>{if(figRisk(k)[0]==='High'&&spotSet().has(k)){any=true;if(reviews['q'+q.id]?.fig?.[k]!=='approved')ok=false}})});
  return _clean[doc]=any&&ok&&!escalated(doc)}
const figDec=(q,k)=>reviews['q'+q.id]?.fig?.[k]??(q.tri?.ok_figs?.includes(k)?'approved':(figRisk(k)[0]==='High'&&!spotSet().has(k)&&spotClean(q.doc)?'approved':undefined));
function figKeys(q){
  const s=[q.stem,...q.parts.map(p=>p.latex),...q.solutions.map(x=>x.latex),...q.options.map(o=>o.latex)].join(' ');
  const inl=[...s.matchAll(/\\exfigure\{([\w.-]+)\}/g)].map(m=>m[1]);
  const lst=q.figures.map(f=>f.src.split('/').pop().replace('.png',''));
  const of=q.options.map(o=>o.fig).filter(Boolean);
  return {inline:new Set(inl),all:[...new Set([...lst,...inl,...of])],opt:new Set(of)};
}
const redrawable=k=>{const f=B.figs[k];return f&&(f.status==='ok'||f.status==='approx'||f.status==='table')};
const PACKS={}, SVGS={};
const pack=doc=>PACKS[doc]||(PACKS[doc]=fetch('data/img/'+doc+'.json?v='+(B?.built||'')).then(r=>r.json()).catch(()=>({})));
const CMPS={}; const cmps=doc=>CMPS[doc]||(CMPS[doc]=fetch('data/cmp/'+doc+'.json?v='+(B?.built||'')).then(r=>r.json()).catch(()=>({})));
const svgs=doc=>SVGS[doc]||(SVGS[doc]=fetch('data/svg/'+doc+'.json?v='+(B?.built||'')).then(r=>r.json()).catch(()=>({})));
function hydrate(root,q,mode){
  root.querySelectorAll('.figslot[data-fig]').forEach(el=>{
    // owner: "I cannot see the x-axis". Solution diagrams Claude drew (<paper>_q<n>_s<k>) have no original, and their
    // 200 dpi PNG loses 1-pixel axes when the browser shrinks it, so they always show as the vector SVG.
    const k=el.dataset.fig, f=B.figs[k], useNew=f&&(figDec(q,k)==='approved'||(/_s\d+$/.test(k)&&f.status!=='table'));
    if(useNew&&f.status==='table'&&f.table){el.innerHTML=dtHTML(f.table,{blank:true});typeset(el);return}
    el.innerHTML=`<img class="fig" alt="Figure" data-k="${k}" data-kind="${useNew?'svg':'png'}">`;
  });
  root.querySelectorAll('img[data-k]').forEach(im=>{
    const k=im.dataset.k, doc=k.split('_')[0];
    if(im.dataset.kind==='ov'||im.dataset.kind==='v1'){cmps(doc).then(m=>{const v=m[im.dataset.kind+':'+k];if(v)im.src=v;else im.alt='Not available'});return}
    if(im.dataset.kind==='svg') svgs(doc).then(m=>{if(m[k]){if(m[k].startsWith('data:image/png'))im.onload=()=>{im.style.width=Math.round(im.naturalWidth*0.32)+'px'};im.src=m[k]}else im.alt='Redraw missing'});
    else pack(doc).then(m=>{const p='figures/'+k+'.png';if(m[p]){im.onload=()=>{im.style.width=Math.round(im.naturalWidth*0.48)+'px'};im.src=m[p]}else im.alt='Image missing: '+k});
  });
  root.querySelectorAll('img[data-page]').forEach(im=>{const p=im.dataset.page;pack(p.split('/').pop().split('_')[0]).then(m=>{if(m[p])im.src=m[p]})});
}

