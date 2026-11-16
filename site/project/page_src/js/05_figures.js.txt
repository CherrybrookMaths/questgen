/* ---------- figures ---------- */
// owner 12 Nov: High-confidence diagrams are spot-checked (1 per paper). When a paper's sampled High diagrams are all approved
// and none of its High diagrams is flagged, the paper's other High diagrams count as approved (bug found on QID 1647:
// 328 unsampled redraws were never shown).
let _clean=null;
function spotClean(doc){_clean=_clean||{};if(doc in _clean)return _clean[doc];let ok=true,any=false;
  B.questions.forEach(q=>{if(q.doc!==doc||q.dup_of)return;chkFigsAll(q).forEach(k=>{if(figRisk(k)[0]==='High'&&spotSet().has(k)){any=true;if(reviews['q'+q.id]?.fig?.[k]!=='approved')ok=false}})});
  return _clean[doc]=any&&ok&&!escalated(doc)}
const figDec=(q,k)=>reviews['q'+q.id]?.fig?.[k]??(q.tri?.ok_figs?.includes(k)?'approved':(figRisk(k)[0]==='High'&&!spotSet().has(k)&&spotClean(q.doc)?'approved':undefined));
// Fix 1 (owner 14 Nov: "Ok we should run Fix 1 and 2"): a question's figure keys come with the index (q.fk, worked out once by
// tools/bank_split.py from the figure list, every \exfigure{} in its text and the option figures), so Review's counts and the
// Diagram filter never need the question text. all keeps that order; inline and opt are the \exfigure and option keys.
function figKeys(q){const f=q.fk||{};return {inline:new Set(f.i||[]),all:f.a||[],opt:new Set(f.o||[])}}
const redrawable=k=>{const f=B.figs[k];return f&&(f.status==='ok'||f.status==='approx'||f.status==='table')};
const PACKS={}, SVGS={};
// Fix 1: each pack is fetched from its asset-store address when data/assets.json lists one, else from the published file (QG.url)
// Job 3 (owner 14 Nov: "What if we dropped them and rerendered them in the new location?"): a paper in review keeps its own
// pack (page scans + crops, docs[doc].ip); once cleared, its scans are gone and the crops the page can still show are in the
// crop group data/crop/g<doc % 8>.json (tools/image_lifecycle.py). The key is the same in both: 'figures/<key>.png'.
const pack=doc=>{const f=B?.docs?.[doc]?.ip?'data/img/'+doc+'.json':packFile('crop',doc);
  return PACKS[f]||(PACKS[f]=fetch(QG.url(f,B?.built)).then(r=>r.json()).catch(()=>({})))};
// owner 15 Nov (via workflow brief): "Lets do ... 4" -> fewer published files. Redraw (svg) and overlay/first-redraw (cmp)
// packs are group files data/<kind>/g<paper id % n>.json, not one per paper; still fetched lazily, once per group.
// PACK_G must match GROUPS in tools/packs.py (batch_check checks it). Page images (data/img) stay one file per paper while in review.
const PACK_G={svg:32,cmp:1,crop:8};
const packFile=(kind,doc)=>'data/'+kind+'/g'+(parseInt(doc,10)%PACK_G[kind])+'.json';
const CMPS={}; const cmps=doc=>{const f=packFile('cmp',doc);return CMPS[f]||(CMPS[f]=fetch(QG.url(f,B?.built)).then(r=>r.json()).catch(()=>({})))};
const svgs=doc=>{const f=packFile('svg',doc);return SVGS[f]||(SVGS[f]=fetch(QG.url(f,B?.built)).then(r=>r.json()).catch(()=>({})))};
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
  root.querySelectorAll('img[data-page]').forEach(im=>{const p=im.dataset.page,d=p.split('/').pop().split('_')[0];
    if(!B?.docs?.[d]?.ip){im.alt='Page image removed after review (Claude can re-render it from the PDF)';im.classList.add('rv-gone');return}   // job 3
    pack(d).then(m=>{if(m[p])im.src=m[p]})});
}

