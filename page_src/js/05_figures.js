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
// health pass 21 Nov: one cached fetch for every image pack (page scans, crops, redraws, overlays): the paths never collide
const PACKS={},packGet=f=>PACKS[f]||(PACKS[f]=fetch(QG.url(f,B?.built)).then(r=>r.json()).catch(()=>({})));
// Fix 1: each pack is fetched from its asset-store address when data/assets.json lists one, else from the published file (QG.url)
// Job 3 (owner 14 Nov: "What if we dropped them and rerendered them in the new location?"): a paper in review keeps its own
// pack (page scans + crops, docs[doc].ip); once cleared, its scans are gone and the crops the page can still show are in the
// crop group data/crop/g<doc % 8>.json (tools/image_lifecycle.py). The key is the same in both: 'figures/<key>.png'.
const pack=doc=>packGet(B?.docs?.[doc]?.ip?'data/img/'+doc+'.json':packFile('crop',doc));
// owner 15 Nov (via workflow brief): "Lets do ... 4" -> fewer published files. Redraw (svg) and overlay/first-redraw (cmp)
// packs are group files data/<kind>/g<paper id % n>.json, not one per paper; still fetched lazily, once per group.
// PACK_G must match GROUPS in tools/packs.py (batch_check checks it). Page images (data/img) stay one file per paper while in review.
const PACK_G={svg:32,cmp:1,crop:8};
const packFile=(kind,doc)=>'data/'+kind+'/g'+(parseInt(doc,10)%PACK_G[kind])+'.json';
const cmps=doc=>packGet(packFile('cmp',doc)), svgs=doc=>packGet(packFile('svg',doc));
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
    if(im.dataset.kind==='ov'||im.dataset.kind==='v1'){cmps(doc).then(m=>{const v=m[im.dataset.kind+':'+k];if(v)im.src=v;else{const n=document.createElement('p');n.className='rv-nov1';n.textContent='Not kept for this diagram: compare the original with now.';im.replaceWith(n)}});return}   // owner 18 Nov screenshot: a missing picture showed a broken-image icon
    if(im.dataset.kind==='svg') svgs(doc).then(m=>{if(m[k]){if(m[k].startsWith('data:image/png'))im.onload=()=>{im.style.width=Math.round(im.naturalWidth*0.32)+'px'};im.src=m[k]}else im.alt='Redraw missing'});
    else pack(doc).then(m=>{const p='figures/'+k+'.png';if(m[p]){im.onload=()=>{im.style.width=Math.round(im.naturalWidth*0.48)+'px'};im.src=m[p]}else im.alt='Image missing: '+k});
  });
  root.querySelectorAll('img[data-page]').forEach(im=>{const p=im.dataset.page,d=p.split('/').pop().split('_')[0];
    if(!B?.docs?.[d]?.ip){im.alt='Page image removed after review (Claude can re-render it from the PDF)';im.classList.add('rv-gone');return}   // job 3
    pack(d).then(m=>{if(m[p])im.src=m[p]})});
}

// owner 18 Nov: "Can u make it so when you click on the original and now, they enlarge". A click (or Enter) on a picture in a
//   Review comparison (side by side, overlay, before -> now) opens it large in a modal dialog; ‹ › (or the arrow keys) step
//   through the other pictures of the same comparison, Esc or a click outside closes it. One scope, no page-wide names (CODE_HEALTH 1).
(()=>{const SEL='.figrow .cmp img.fig[src],.figrow .cmp3 img.fig[src],.figrow .ovfig img.fig[src]';let list=[],at=0,from=null;
  const cap=im=>im.closest('figure')?.querySelector('figcaption')?.textContent.trim()||im.alt||'Picture';
  function dlg(){let d=document.getElementById('rvFigZoom');if(d)return d;d=document.createElement('dialog');d.id='rvFigZoom';d.className='rv-figzoom';d.setAttribute('aria-labelledby','rvFigZoomT');
    d.innerHTML=`<div class="rv-fzhead"><b id="rvFigZoomT"></b><span class="rv-fzn" aria-live="polite"></span><button type="button" class="rv-fzx" aria-label="Close">×</button></div>
      <div class="rv-fzbody"><button type="button" class="rv-fzstep" data-fzs="-1" aria-label="Previous picture">‹</button><img alt=""><button type="button" class="rv-fzstep" data-fzs="1" aria-label="Next picture">›</button></div>`;
    document.body.appendChild(d);
    d.addEventListener('click',e=>{if(e.target===d||e.target.closest('.rv-fzx'))d.close();else{const b=e.target.closest('[data-fzs]');if(b)go(+b.dataset.fzs)}});
    d.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'){e.preventDefault();go(-1)}else if(e.key==='ArrowRight'){e.preventDefault();go(1)}});
    d.addEventListener('close',()=>{if(from&&from.isConnected)from.focus();from=null});return d}
  function show(){const d=dlg(),im=list[at],big=d.querySelector('.rv-fzbody img');big.src=im.src;big.alt=im.alt||cap(im);
    d.querySelector('#rvFigZoomT').textContent=cap(im);d.querySelector('.rv-fzn').textContent=list.length>1?`${at+1} of ${list.length}`:'';
    d.querySelectorAll('.rv-fzstep').forEach(b=>b.hidden=list.length<2)}
  function go(k){if(list.length<2)return;at=(at+k+list.length)%list.length;show()}
  function open(im){const row=im.closest('.figrow');list=[...(row||document).querySelectorAll(SEL)];at=Math.max(0,list.indexOf(im));from=im;show();const d=dlg();if(!d.open)d.showModal();d.querySelector('.rv-fzx').focus()}
  // the pictures load after the comparison is drawn, so they are marked as buttons when they arrive
  document.addEventListener('load',e=>{const im=e.target;if(im.tagName==='IMG'&&im.matches(SEL)){im.tabIndex=0;im.setAttribute('role','button');im.title='Click to enlarge'}},true);
  document.addEventListener('click',e=>{const im=e.target.closest?.(SEL);if(im){e.preventDefault();open(im)}});
  document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches?.(SEL)){e.preventDefault();open(e.target)}})})();
