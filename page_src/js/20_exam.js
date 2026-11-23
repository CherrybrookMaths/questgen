/* ===================== Exam builder (owner 13 Nov, stage 1) =====================
   Owner: "can we implement something like this [his HSC exam maker] on this artifact?" -> "yeah do that".
   Stage 1 = build by hand: "Add to exam" on every bank card, an exam panel, an A4 preview (cover, Section I/II,
   answer lines, paginated sheets), a marking guide, and Download (the artifact cannot print; the downloaded
   .html prints or saves as PDF from the browser). Saved exams live in the page database, collection `exams`. */
const XKEY='qg_exam';
let EX=(()=>{try{const v=JSON.parse(localStorage.getItem(XKEY));if(v&&Array.isArray(v.items))return v}catch(e){}return null})()||
  {title:QG.courseData.name,sub:'Practice examination',school:'CMC Education',time:'',timeAuto:true,mpm:1.8,reading:'10 minutes',items:[]};
// an exam opened before 19 Nov keeps the working time it has (only new exams follow the marks until a time is typed)
if(EX.timeAuto===undefined)EX.timeAuto=!EX.id&&!EX.items.length;
// owner 19 Nov ("Save by itself"): every change is kept in this browser and, for an exam in the shared database, saved there a moment
// later (EXAS.schedule, 25_mine.js, which loads later: hence the typeof test). The working time follows the marks (EXAS.time)
const xsave=()=>{if(typeof EXAS!=='undefined')EXAS.time();save(XKEY,JSON.stringify(EX));xCount();if(typeof EXAS!=='undefined')EXAS.schedule()};
const xq=id=>QG.byId.get(id);   // health pass 21 Nov: the id index (was a scan of every question, ~27 callers, many in loops)
function xCount(){if($('#xPanel')&&!$('#xPanel').hidden)xPanel()
  // any change to the exam (add, remove, reorder, swap, load) refreshes the Exams page around it (owner 14 Nov, Exams page + My exams).
  // EXV is declared by 24_exams.js, which loads later: the typeof test keeps the first call below (at load) safe.
  if(view==='exams'&&typeof EXV!=='undefined'&&EXV.built){exHead();if(EXV.view==='setup'){exResult();exLabels()}}}
function xToggle(id){const i=EX.items.indexOf(id);if(i>=0)EX.items.splice(i,1);else EX.items.push(id);xsave();toast(i>=0?'Removed from the exam':'Added to the exam')}
const xSections=()=>{const qs=EX.items.map(xq).filter(Boolean);return {mc:qs.filter(q=>q.type==='mcq'),wr:qs.filter(q=>q.type!=='mcq')}};
const xMarks=qs=>qs.reduce((t,q)=>t+(+q.marks||0),0);

/* ---------- panel ---------- */
function xPanel(){
  const p=$('#xPanel'),{mc,wr}=xSections(),tot=xMarks(mc)+xMarks(wr);let n=0;const A=exA();
  // Exams page (owner 14 Nov): each row also shows the band estimate and has Swap / Lock (owner 19 Nov: "keep lock")
  const row=q=>{n++;const e=exEst(q),lk=A.locked.includes(q.id),w=typeof qWatch==='function'?qWatch(q):null;
    return `<li data-xi="${q.id}"${lk?' class="locked"':''}${w?' data-xwarn="1"':''}><span class="xn">${n}</span><span class="xt">${esc(srcLine(q))}<small>${qid(q)} · ${q.marks??'?'} mark${q.marks===1?'':'s'}${e?` · Band ${e.d.toFixed(1)} · ${e.kind==='Problem solving'?'PS':e.kind}`:''}</small>${w?`<small class="xwarn">⚠ ${esc(w.text)}: swap it (⇄) or remove it before printing</small>`:''}${typeof EXAS!=='undefined'?EXAS.usedTag(q):''}</span>
    <span class="xb"><button data-xsw title="Swap for a similar question" aria-label="Swap for a similar question"${lk?' disabled':''}>⇄</button><button data-xlk aria-pressed="${lk}" title="${lk?'Unlock':'Lock: Regenerate keeps it'}" aria-label="${lk?'Unlock':'Lock'}">${XA_LOCK}</button><button data-xmv="-1" title="Move up" aria-label="Move up">↑</button><button data-xmv="1" title="Move down" aria-label="Move down">↓</button><button data-xrm title="Remove" aria-label="Remove">×</button></span></li>`};
  p.innerHTML=`<div class="xhd"><h2>This exam</h2><button class="act ghost" id="xClose" aria-label="Close">✕</button></div>
    <div class="xtot">${EX.items.length} question${EX.items.length===1?'':'s'} · ${tot} mark${tot===1?'':'s'}</div>${(()=>{const k=typeof qWatch==='function'?EX.items.map(xq).filter(q=>qWatch(q)).length:0;return k?`<div class="xwarnbox" role="status">⚠ ${k} question${k===1?' in this exam has':'s in this exam have'} been reported or sent back to review since ${k===1?'it was':'they were'} added. Check ${k===1?'it':'them'} before printing.</div>`:''})()}
    <div class="xf"><label>Title<input data-xf="title" value="${esc(EX.title)}"></label><label>Subtitle<input data-xf="sub" value="${esc(EX.sub)}"></label>
      <label>School<input data-xf="school" value="${esc(EX.school)}"></label><div class="xf2"><label>Working time<input data-xf="time" value="${esc(EX.time)}" title="Follows the marks × minutes per mark until you type a time"></label><label>Reading time<input data-xf="reading" value="${esc(EX.reading)}"></label></div>
      <div class="xf2"><label>Minutes per mark<input type="number" data-xmpm min="0.5" max="4" step="0.1" value="${+EX.mpm||1.8}"></label><div class="xmpmh">${EX.timeAuto===false?`Working time typed by hand. <button type="button" class="linkbtn" data-xtauto>Work it out from the marks</button>`:'Working time = marks × minutes per mark (HSC Advanced: 1.8).'}</div></div></div>
    ${EX.items.length?`${mc.length?`<div class="xsec">Section I · multiple choice · ${xMarks(mc)} marks</div><ol class="xlist">${mc.map(row).join('')}</ol>`:''}${wr.length?`<div class="xsec">Section II · ${xMarks(wr)} marks</div><ol class="xlist">${wr.map(row).join('')}</ol>`:''}`
      :'<div class="xempty">No questions yet. Press <b>+ Add to exam</b> on any question in the Bank.</div>'}
    <div class="xacts"><button class="act ok" id="xPrev" ${EX.items.length?'':'disabled'}>Preview paper</button><button class="act" id="xGuide" ${EX.items.length?'':'disabled'}>Marking guide</button></div>
`;
  // owner 19 Nov ("too many outs and ways to replace the questions accidentally"): the panel's own list of saved exams (it replaced the
  // open exam in one click) is gone; exams are opened from My exams
  exHead();if(view==='exams'&&EXV.view==='pick'){const n=$('#exLs');if(n&&EXCUR.length){const inEx=EXCUR.filter(q=>EX.items.includes(q.id)).length;n.textContent=`${EXCUR.length} question${EXCUR.length===1?'':'s'}${inEx?` · ${inEx} in the exam`:''}${bankAll()||!isEditor()?'':' · approved only'}`}}
}
let XSAVED=[],_xsub=null;
// owner 14 Nov (Fix 2, "Ok we should run Fix 1 and 2"): keys (question keys, parallel to items) let a saved exam find its
// questions again after a re-parse or a change of which copy the Bank shows (RKEY.items).
// saving: every field, including settings, lines, diagram sizes and locks (Exams page, owner 14 Nov); then My exams and the
// page head's Saved / Unsaved marker refresh (they refresh even when there is no database)
async function xSaveDb(quiet){
  if(db){exA();const id=EX.id||('e'+Date.now());EX.id=id;save(XKEY,JSON.stringify(EX));
    const A=EX.auto||{},keep={topics:A.topics,total:A.total,mcq:A.mcq,pr:A.pr,dF:A.dF,dP:A.dP,src:A.src,approved:A.approved,avoid:A.avoid,title:A.title,locked:A.locked,diff:A.diff};
    try{await db.doc('exams/'+id).set({title:EX.title,sub:EX.sub,school:EX.school,cert:EX.cert||'',bytopic:EX.bytopic!==false,time:EX.time,timeAuto:EX.timeAuto!==false,mpm:+EX.mpm||1.8,reading:EX.reading,items:EX.items,keys:EX.items.map(i=>xq(i)?.key||null),instr:EX.instr||null,lines:EX.lines||{},figscale:EX.figscale||{},auto:keep,by:me||null,at:new Date().toISOString()});if(!quiet)toast('Exam saved')}
    catch(e){toast('Could not save. Try again in a moment.')}}
  if(view==='exams'){exHead();if(EXV.view==='mine')renderMine()}}
document.addEventListener('click',e=>{
  if(!e.target.closest('#xPanel'))return;
  const li=e.target.closest('li[data-xi]');
  if(li&&e.target.closest('[data-xrm]')){xToggle(+li.dataset.xi);return}
  if(li&&e.target.closest('[data-xmv]')){const id=+li.dataset.xi,d=+e.target.closest('[data-xmv]').dataset.xmv,q=xq(id);
    const same=EX.items.filter(i=>(xq(i)?.type==='mcq')===(q.type==='mcq'));const k=same.indexOf(id),t=same[k+d];if(t==null)return;
    const a1=EX.items.indexOf(id),a2=EX.items.indexOf(t);[EX.items[a1],EX.items[a2]]=[EX.items[a2],EX.items[a1]];xsave();return}
  if(e.target.closest('#xPrev')){xPreview('exam');return}
  if(e.target.closest('#xGuide')){xPreview('guide');return}
  if(e.target.closest('[data-xtauto]')){EX.timeAuto=true;xsave();return}
});
document.addEventListener('input',e=>{const f=e.target.closest('[data-xf]');if(f){EX[f.dataset.xf]=f.value;if(f.dataset.xf==='time')EX.timeAuto=false;save(XKEY,JSON.stringify(EX));if(typeof EXAS!=='undefined')EXAS.schedule()}});
// owner 19 Nov: "HSC Adv averages 1.8 minutes per mark. Should be a place to change that too": the working time follows it
document.addEventListener('change',e=>{const f=e.target.closest('[data-xmpm]');if(!f)return;const v=Math.max(.5,Math.min(4,+f.value||1.8));EX.mpm=Math.round(v*10)/10;EX.timeAuto=true;xsave()});

/* ---------- paper ---------- */
function xFigSlots(q,keys){return keys.map(k=>`<span class="figslot" data-fig="${k}"></span>`).join('')}
// One question as printed. On the exam paper (not the guide) every diagram slot gets a corner resize handle (exFigWrap) and each
// leaf part gets editable answer lines (exLines), both from the Exams page (owner 14 Nov). The source line ends with an ⓘ that
// opens the question's dot points, band and Report, screen only (question reports, owner 14 Nov, alpha; ⓘ owner 14 Nov).
function xQ(q,n,doc){exA();
  const fk=figKeys(q), guide=doc==='guide';
  const loose=fk.all.filter(k=>!fk.inline.has(k)&&!fk.opt.has(k)&&!q.figures.find(f=>f.src.endsWith('/'+k+'.png')&&f.part));
  const partFigs=pid=>q.figures.filter(f=>f.part===pid).map(f=>f.src.split('/').pop().replace('.png','')).filter(k=>!fk.inline.has(k));
  // guide: worked solution only; no internal review notes, no rubric for MCQ (the key is highlighted and tabled)
  const clean=h=>h.replace(/<div class="callout"><b>(Check this|Corrected from source)[\s\S]*?<\/div>/g,'').replace(/<div class="help">(?:<[^>]*>)*\s*Corrected from source[\s\S]*?<\/div>/g,'').replace(q.type==='mcq'?/<table class="rub">[\s\S]*?<\/table>/g:/$^/,'');
  const sols=pid=>{if(!guide)return '';const s=solsFor(q,pid,'bank');return s.count?`<div class="xsol">${clean(s.html)}</div>`:''};
  const mcSols=q.type==='mcq'?q.parts.map(p=>sols(p.id)).join(''):'';
  const lone=q.parts.length===1&&!q.parts[0].label;
  const parts=q.parts.map(p=>{const lf=leaf(q,p);
    const mk=p.marks!=null&&!lone?`<span class="xpm">[${p.marks}]</span>`:'';   // owner 18 Nov (sample layout): part marks as "[2]" at the right
    return `<div class="xpart ${p.parent?'child':''} ${p.label?'':'nolab'}">${p.label?`<span class="xpl">(${esc(p.label)})</span>`:''}<div class="xpb"><div class="tx">${tex(p.latex)}${xFigSlots(q,partFigs(p.id))}</div>
      ${lf&&q.type!=='mcq'&&!guide?exLines(q,p):''}${q.type==='mcq'?'':sols(p.id)}</div>${mk}</div>`}).join('');
  let opts='';const lay=q.layout||(q.opt_table?'table':'text');
  if(q.type==='mcq'){const ok=o=>guide&&o.is_correct?' xok':'';
    if(lay==='table'&&q.opt_table)opts=optTableHTML(q,guide);
    else if(lay==='graph')opts=`<div class="xog">${q.options.map(o=>`<div class="xo${ok(o)}"><b>${o.label}.</b>${o.fig?xFigSlots(q,[o.fig]):`<span class="tx">${tex(o.latex)}</span>`}</div>`).join('')}</div>`;
    else opts=`<div class="xol">${q.options.map(o=>`<div class="xo${ok(o)}"><b>${o.label}.</b><span class="tx">${tex(o.latex)}</span></div>`).join('')}</div>`}
  const head=q.type==='mcq'?`<span class="xqn">${n}</span>`:`<div class="xqh"><b>QUESTION ${n}</b><span>(${q.marks??'?'} mark${q.marks===1?'':'s'})</span></div>`;
  // owner 18 Nov, with a sample paper: "can u make the format of questions like this": "QUESTION 4  (4 marks)" in bold capitals with the
  // marks beside it (no rule), "(a)" in plain type, "[1]" at the right of each part, dotted answer lines (08_exam.css, 30_word.js)
  // owner 14 Nov: "The dot point home looks stupid in a question", then "Yeah that's fine, the i is fine". The grey dot-point
  // line and Report link are gone from the question; a Report link ends the source line (owner 18 Nov; qiButton, 27_reports.js)
  // with the dot points per part, band, kind and Report. Screen only (.scr-only), like the old line.
  // owner 18 Nov: "In the PDF output, remove the school name, just the qid for each question": the paper (and so its PDF, Word and HTML
  // downloads) shows only the QID; the marking guide keeps the source, and ⓘ still shows it on screen
  const src=`<div class="xsrc exsrc"><span class="exsrcl">${guide?esc(srcLine(q))+' · ':''}${qid(q)}</span>${qiButton(q,n)}</div>`;
  const h=`<section class="xq ${q.type==='mcq'?'mc':'wr'}" data-q="${q.id}">${head}<div class="xqb">${q.stem?`<div class="tx">${tex(q.stem)}</div>`:''}${xFigSlots(q,loose)}${parts}${opts}${mcSols}${sols(null)}</div>${src}</section>`;
  // every diagram slot, including inline \exfigure ones that tex() writes, so this runs on the finished HTML
  return guide?h:h.replace(/<span class="figslot" data-fig="([\w.()-]+)"><\/span>/g,(m,k)=>exFigWrap(k));
}
// xCover (the editable cover) is in 24_exams.js
function xBlocks(doc){const {mc,wr}=xSections();const bl=[];let n=0;
  if(doc==='exam')bl.push({cover:true,html:xCover(mc,wr)},{cover:true,html:'<div class="xblank">This page is intentionally left blank.</div>'});   // owner 18 Nov: the back of the first page is blank
  else{const keys=mc.map((q,i)=>`<td>${i+1}</td><td><b>${q.options.find(o=>o.is_correct)?.label||'–'}</b></td>`);
    bl.push({html:`<div class="xgh"><div class="xeyebrow">${esc(EX.school)} · ${esc(EX.title)}</div><h1>${esc(EX.sub)} – marking guide</h1></div>${mc.length?`<div class="xsechd"><b>Section I – answer key</b></div><table class="xkey"><tbody>${keys.map(k=>`<tr>${k}</tr>`).join('')}</tbody></table>`:''}`})}
  const SH=EXSEC.secs(mc,wr);   // owner 18 Nov: section headings as on a NESA paper (EXSEC.head, 24_exams.js)
  if(mc.length){bl.push({sec:true,html:EXSEC.head(SH[0],doc==='guide')});mc.forEach(q=>bl.push({html:xQ(q,++n,doc),q}))}
  // owner 17 Nov: questions that "refer to the z score table at the back of the exam" keep that wording, and the exam gets the
  // table appended at the back (zTableHTML, 19_ztable.js). Questions that print their own portion of the table keep it.
  const zAtEnd=doc==='exam'&&[...mc,...wr].some(needsZ);
  if(wr.length){bl.push({sec:true,newpage:doc==='exam',html:EXSEC.head(SH[SH.length-1],doc==='guide')});wr.forEach(q=>bl.push({html:xQ(q,++n,doc),q}))}
  if(zAtEnd)bl.push({newpage:true,html:zTableHTML()});
  // owner 18 Nov: "attach an advanced reference sheet at the end for students. This should be an extension 1 or 2 one or a standard one
  // when we do more courses later so plan for that": each course names its NESA reference sheet pages (QG.courses[..].ref)
  if(doc==='exam')(QG.courseData.ref||[]).forEach((p,i)=>bl.push({newpage:true,html:`<div class="xref"><img src="${esc(QG.url(p))}" alt="Reference sheet, page ${i+1}"></div>`}));
  return bl}
const xWait=root=>new Promise(res=>{const t0=performance.now();const tick=()=>{const imgs=[...root.querySelectorAll('img')];const done=imgs.every(i=>i.getAttribute('src')&&i.complete||i.alt==='Redraw missing'||/^Image missing/.test(i.alt));
  if(done||performance.now()-t0>8000)res();else setTimeout(tick,120)};tick()});
// xPreview (A4 preview, grading panel, Fit pages, export buttons) is in 24_exams.js
function xClosePv(){const ov=$('#xPv');if(ov){ov.hidden=true;ov.innerHTML=''}document.body.classList.remove('xpv-on')}
// fonts linked from a downloaded HTML file (see xDownload)
const EXPORT_FONT_LINKS='<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=Fraunces:opsz,wght@9..144,500;9..144,600&amp;family=IBM+Plex+Mono:wght@400;500&amp;display=swap">'+
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Tinos:ital,wght@0,400;0,700;1,400;1,700&amp;display=swap">';
// download: the pages without the on-screen controls (Exams page, owner 14 Nov). A clean copy takes the id #xPages while the file
// is made; .scr-only: dot-point lines and Report links (owner 14 Nov, alpha)
async function xDownload(doc){const live=$('#xPages');if(!live)return;const clone=live.cloneNode(true);
  clone.querySelectorAll('.lnctl,.figctl,.figpct,.figh,.exaddli,.scr-only').forEach(e=>e.remove());
  clone.querySelectorAll('[contenteditable]').forEach(e=>{e.removeAttribute('contenteditable');e.removeAttribute('title');if(e.classList.contains('ed-empty'))e.textContent=''});
  clone.querySelectorAll('.sel').forEach(e=>e.classList.remove('sel'));
  live.id='xPagesLive';clone.id='xPages';clone.style.cssText='position:absolute;left:-99999px;top:0;zoom:1';document.body.appendChild(clone);
  try{
  const c=window.claude;const dl=c?.use?await c.use('downloads'):null;
  const css=$$('style').map(s=>s.textContent).join('\n');
  const cache=document.getElementById('MJX-SVG-global-cache');
  // The page's own fonts are self-hosted (vendor/fonts/fonts.css, hardening 14 Nov), but that relative link would not resolve in a
  // downloaded file, so the file keeps the Google Fonts links it always had (same faces; the viewer's browser fetches them).
  const fonts=EXPORT_FONT_LINKS;
  const name=(EX.sub||'exam').replace(/[^\w\- ]+/g,'').trim()||'exam';
  const html=`<!doctype html><html lang="en-AU" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(EX.sub)}${doc==='guide'?' – marking guide':''}</title>${fonts}<style>${css}
body{background:#e9e6df!important}body>*:not(.xpages){display:none!important}.xpages{display:flex!important;padding:24px 0}
html,body{margin:0!important;padding:0!important}:root{padding:0!important}
@media print{body{background:#fff!important}.xpages{padding:0!important;gap:0!important}.sheet{height:297mm!important;min-height:0!important;overflow:hidden;margin:0!important;box-shadow:none!important}}</style></head><body>${cache?cache.outerHTML:''}<div class="xpages">${$('#xPages').innerHTML}</div>
<script>/* Print with Ctrl+P / Cmd+P, or save as PDF from the print dialog. Made with Questgen. */<\/script></body></html>`;
  if(!dl){toast('Downloading is not available in this view');return}
  try{await dl.save({filename:`${name}${doc==='guide'?' - marking guide':''}.html`,data:html});toast('Saved. Open the file and print it, or save it as PDF.')}
  catch(e){if(e?.code!=='declined')toast('Could not download ('+(e?.code||'error')+')')}
  }finally{clone.remove();live.id='xPages'}}
document.addEventListener('click',e=>{
  if(e.target.closest('#xPvClose')){xClosePv();return}
  const s=e.target.closest('[data-xdoc]');if(s){xPreview(s.dataset.xdoc);return}
  const d=e.target.closest('#xDl');if(d&&!d.disabled){xDownload(d.dataset.doc);return}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('xpv-on'))xClosePv()});

xCount();
