/* ===================== Exam builder (owner 13 Nov, stage 1) =====================
   Owner: "can we implement something like this [his HSC exam maker] on this artifact?" -> "yeah do that".
   Stage 1 = build by hand: "Add to exam" on every bank card, an exam panel, an A4 preview (cover, Section I/II,
   answer lines, paginated sheets), a marking guide, and Download (the artifact cannot print; the downloaded
   .html prints or saves as PDF from the browser). Saved exams live in the page database, collection `exams`. */
// owner 23 Nov: "All the advanced questions dissappeared and then when I went back to the advanced tab and opened the same exam, the
// questions were now gone, destroying that eaxm": every exam belongs to one course (exam.course;
// none recorded = 'advanced', every exam saved before 23 Nov). The open exam is kept per course in this browser, and an exam of
// another course is never loaded, edited or saved against this course's bank (xSaveDb, exmLoad in 25_mine.js).
const XKEY=QG.course==='advanced'?'qg_exam':'qg_exam_'+QG.course;
const exCourse=x=>(x&&x.course)||'advanced';
// owner 26 Nov (worksheets, "it should be manage din a similar way to exams where there's a lsit, same for teh settings logic"): a worksheet is
// an exam document with kind 'worksheet' (38_worksheets.js). EX is the open exam on Exams and the open worksheet on Worksheets; each kind
// keeps its own copy in this browser (xKind.key) and xKind swaps EX when the view changes (one page-wide name, CODE_HEALTH rule 1)
function xKind(k){const ws=k==='worksheet';if((EX.kind==='worksheet')===ws)return;
  if(typeof EXAS!=='undefined'){clearTimeout(EXAS.t);if(db&&['new','changed'].includes(exmState()))EXAS.run()}   // the one being left saves first (its fields are read at once)
  let v=null;try{v=JSON.parse(localStorage.getItem(ws?XKEY+'_ws':XKEY))}catch(e){}
  EX=v&&Array.isArray(v.items)&&exCourse(v)===QG.course&&(v.kind==='worksheet')===ws?v:ws?WS.blank():xKind.blank();EX.course=QG.course;
  try{EXC.clear();XA_SWAPPED.clear()}catch(e){}}
xKind.key=()=>EX.kind==='worksheet'?XKEY+'_ws':XKEY;
xKind.blank=()=>({title:QG.courseData.name,sub:'Practice examination',school:'CMC Education',time:'',timeAuto:true,mpm:1.8,reading:'10 minutes',items:[]});
let EX=(()=>{try{const v=JSON.parse(localStorage.getItem(XKEY));if(v&&Array.isArray(v.items)&&v.kind!=='worksheet'&&(exCourse(v)===QG.course||(!v.course&&!v.id&&!v.items.length)))return v}catch(e){}return null})()||xKind.blank();
EX.course=QG.course;
// an exam opened before 19 Nov keeps the working time it has (only new exams follow the marks until a time is typed)
if(EX.timeAuto===undefined)EX.timeAuto=!EX.id&&!EX.items.length;
// owner 19 Nov ("Save by itself"): every change is kept in this browser and, for an exam in the shared database, saved there a moment
// later (EXAS.schedule, 25_mine.js, which loads later: hence the typeof test). The working time follows the marks (EXAS.time)
const xsave=()=>{if(typeof EXAS!=='undefined')EXAS.time();save(xKind.key(),JSON.stringify(EX));xCount();if(typeof EXAS!=='undefined')EXAS.schedule()};
const xq=id=>QG.byId.get(id);   // health pass 21 Nov: the id index (was a scan of every question, ~27 callers, many in loops)
function xCount(){if($('#xPanel')&&!$('#xPanel').hidden)xPanel()
  // any change to the exam (add, remove, reorder, swap, load) refreshes the Exams page around it (owner 14 Nov, Exams page + My exams).
  // EXV is declared by 24_exams.js, which loads later: the typeof test keeps the first call below (at load) safe.
  if(view==='exams'&&typeof EXV!=='undefined'&&EXV.built){exHead();if(EXV.view==='setup'){exResult();exLabels()}}}
function xToggle(id){if(xaLocked(id,true))return;const i=EX.items.indexOf(id);if(i>=0)EX.items.splice(i,1);else EX.items.push(id);xsave();toast(i>=0?'Removed from the exam':'Added to the exam')}
const xSections=()=>{const qs=EX.items.map(xq).filter(Boolean);return {mc:qs.filter(q=>q.type==='mcq'),wr:qs.filter(q=>q.type!=='mcq')}};
const xMarks=qs=>qs.reduce((t,q)=>t+(+q.marks||0),0);

/* ---------- panel ---------- */
function xPanel(){
  const p=$('#xPanel'),{mc,wr}=xSections(),tot=xMarks(mc)+xMarks(wr);let n=0;const A=exA();
  // Exams page (owner 14 Nov): each row also shows the band estimate and has Swap / Lock (owner 19 Nov: "keep lock")
  const row=q=>{n++;const e=exEst(q),lk=A.locked.includes(q.id),w=typeof qWatch==='function'?qWatch(q):null;
    return `<li data-xi="${q.id}"${lk?' class="locked"':''}${w?' data-xwarn="1"':''}><span class="xn">${n}</span><span class="xt">${esc(srcLine(q))}<small>${qid(q)} · ${q.marks??'?'} mark${q.marks===1?'':'s'}${e?` · Band ${e.d.toFixed(1)} · ${e.kind==='Problem solving'?'PS':e.kind}`:''}</small>${w?`<small class="xwarn">⚠ ${esc(w.text)}: swap it (⇄) or remove it before printing</small>`:''}${typeof EXAS!=='undefined'?EXAS.usedTag(q):''}</span>
    <span class="xb">${(()=>{const off=t=>lk?` disabled title="${xaLocked.tip}"`:` title="${t}"`;   // owner 25 Nov: a locked row's controls say why they are off
      return `<button data-xsw aria-label="Swap for a similar question"${off('Swap for a similar question')}>⇄</button><button data-xlock aria-pressed="${lk}" title="${xaLocked.label(lk)}" aria-label="${xaLocked.label(lk)}">${XA_LOCK}</button><button data-xmv="-1" aria-label="Move up"${off('Move up')}>↑</button><button data-xmv="1" aria-label="Move down"${off('Move down')}>↓</button><button data-xrm aria-label="Remove"${off('Remove')}>×</button>`})()}</span></li>`};
  p.innerHTML=`<div class="xhd"><h2>This exam</h2><button class="act ghost" id="xClose" aria-label="Close">✕</button></div>
    <div class="xtot">${EX.items.length} question${EX.items.length===1?'':'s'} · ${tot} mark${tot===1?'':'s'}</div>${(()=>{const k=typeof qWatch==='function'?EX.items.map(xq).filter(q=>qWatch(q)).length:0;return k?`<div class="xwarnbox" role="status">⚠ ${k} question${k===1?' in this exam has':'s in this exam have'} been reported or sent back to review since ${k===1?'it was':'they were'} added. Check ${k===1?'it':'them'} before printing.</div>`:''})()}
    <div class="xf"><label>Title<input data-xf="title" value="${esc(EX.title)}"></label><label>Subtitle<input data-xf="sub" value="${esc(EX.sub)}"></label>
      <label>School<input data-xf="school" value="${esc(EX.school)}"></label><div class="xf2"><label>Working time<input data-xf="time" value="${esc(EX.time)}" title="Follows the marks × minutes per mark until you type a time"></label><label>Reading time<input data-xf="reading" value="${esc(EX.reading)}"></label></div>
      <div class="xf2"><label>Minutes per mark<input type="number" data-xmpm min="0.5" max="4" step="0.1" value="${+EX.mpm||1.8}"></label><div class="xmpmh">${EX.timeAuto===false?`Working time typed by hand. <button type="button" class="linkbtn" data-xtauto>Work it out from the marks</button>`:'Working time = marks × minutes per mark (HSC Advanced: 1.8).'}</div></div></div>
    ${EX.items.length?`${mc.length?`<div class="xsec">Section I · multiple choice · ${xMarks(mc)} marks</div><ol class="xlist">${mc.map(row).join('')}</ol>`:''}${wr.length?`<div class="xsec">Section II · ${xMarks(wr)} marks</div><ol class="xlist">${wr.map(row).join('')}</ol>`:''}`
      :'<div class="xempty">No questions yet. Press <b>+ Add to exam</b> on any question in the Bank.</div>'}
    <div class="xacts"><button class="act ok" id="xPrev" ${EX.items.length?'':'disabled'}>Preview paper</button><button class="act" id="xGuide" ${EX.items.length?'':'disabled'}>Marking guide</button><button class="act" id="xAns" ${EX.items.length?'':'disabled'} title="The paper with each question's answer straight after it">Paper with answers</button></div>
`;
  // owner 19 Nov ("too many outs and ways to replace the questions accidentally"): the panel's own list of saved exams (it replaced the
  // open exam in one click) is gone; exams are opened from My exams
  exHead();if(view==='exams'&&EXV.view==='pick'){const n=$('#exLs');if(n&&EXCUR.length){const inEx=EXCUR.filter(q=>EX.items.includes(q.id)).length;n.textContent=`${EXCUR.length} question${EXCUR.length===1?'':'s'}${inEx?` · ${inEx} in the exam`:''}${bankAll()||!isEditor()?'':' · approved only'}`}}
}
let XSAVED=[],_xsub=null;
// owner 14 Nov (Fix 2, "Ok we should run Fix 1 and 2"): keys (question keys, parallel to items) let a saved exam find its
// questions again after a re-parse or a change of which copy the Bank shows (RKEY.items).
// saving: every field, including settings, lines, diagram sizes and locks (Exams page, owner 14 Nov); then My exams and the
// page head's Saved / Unsaved marker refresh (they refresh even when there is no database). True when the database took the write
// (owner 25 Nov: "Saved <time>" only for what was really saved)
async function xSaveDb(quiet){let ok=false;
  if(exCourse(EX)!==QG.course){toast('This exam belongs to '+(QG.courses[exCourse(EX)]?.short||exCourse(EX))+'. Switch the course to save it.');return false}   // owner 23 Nov: see XKEY
  if(db){exA();const id=EX.id||('e'+Date.now());EX.id=id;save(xKind.key(),JSON.stringify(EX));
    const A=EX.auto||{},keep={topics:A.topics,total:A.total,by:A.by,n:A.n,mcq:A.mcq,pr:A.pr,dF:A.dF,dP:A.dP,src:A.src,approved:A.approved,avoid:A.avoid,title:A.title,locked:A.locked,diff:A.diff};
    try{await db.doc('exams/'+id).set({title:EX.title,sub:EX.sub,school:EX.school,cert:EX.cert||'',bytopic:EX.bytopic!==false,time:EX.time,timeAuto:EX.timeAuto!==false,mpm:+EX.mpm||1.8,reading:EX.reading,course:QG.course,items:EX.items.concat((EX.gone||[]).map(g=>g.id)),keys:EX.items.map(i=>xq(i)?.key||null).concat((EX.gone||[]).map(g=>g.key||null)),instr:EX.instr||null,lines:EX.lines||{},figscale:EX.figscale||{},auto:keep,...(EX.kind==='worksheet'?{kind:'worksheet',ws:EX.ws||null}:{}),by:me||null,at:new Date().toISOString()});ok=true;if(!quiet)toast('Exam saved')}
    catch(e){toast('Could not save. Try again in a moment.')}}
  if(view==='exams'){exHead();if(EXV.view==='mine')renderMine()}if(view==='worksheets')WS.refresh();return ok}
document.addEventListener('click',e=>{
  if(!e.target.closest('#xPanel'))return;
  const li=e.target.closest('li[data-xi]');
  if(li&&e.target.closest('[data-xrm]')){xToggle(+li.dataset.xi);return}
  if(li&&e.target.closest('[data-xmv]')){const id=+li.dataset.xi,d=+e.target.closest('[data-xmv]').dataset.xmv,q=xq(id);
    const same=EX.items.filter(i=>(xq(i)?.type==='mcq')===(q.type==='mcq'));const k=same.indexOf(id),t=same[k+d];if(t==null||xaLocked(id,true)||xaLocked(t,true))return;
    const a1=EX.items.indexOf(id),a2=EX.items.indexOf(t);[EX.items[a1],EX.items[a2]]=[EX.items[a2],EX.items[a1]];xsave();return}
  if(e.target.closest('#xPrev')){xPreview('exam');return}
  if(e.target.closest('#xGuide')){xPreview('guide');return}
  if(e.target.closest('#xAns')){xPreview('answers');return}
  if(e.target.closest('[data-xtauto]')){EX.timeAuto=true;xsave();return}
});
document.addEventListener('input',e=>{const f=e.target.closest('[data-xf]');if(f){EX[f.dataset.xf]=f.value;if(f.dataset.xf==='time')EX.timeAuto=false;save(xKind.key(),JSON.stringify(EX));if(typeof EXAS!=='undefined')EXAS.schedule()}});
// owner 19 Nov: "HSC Adv averages 1.8 minutes per mark. Should be a place to change that too": the working time follows it
document.addEventListener('change',e=>{const f=e.target.closest('[data-xmpm]');if(!f)return;const v=Math.max(.5,Math.min(4,+f.value||1.8));EX.mpm=Math.round(v*10)/10;EX.timeAuto=true;xsave()});

/* ---------- paper ---------- */
function xFigSlots(q,keys){return keys.map(k=>`<span class="figslot" data-fig="${k}"></span>`).join('')}
// One question as printed. On the exam paper (not the guide) every diagram slot gets a corner resize handle (exFigWrap) and each
// leaf part gets editable answer lines (exLines), both from the Exams page (owner 14 Nov). The source line ends with an ⓘ that
// opens the question's dot points, band and Report, screen only (question reports, owner 14 Nov, alpha; ⓘ owner 14 Nov).
// owner 26 Nov: "Give options to print worksheet (with no answer), worked solutions, and worksheet with answers (this is where they can
// choose single number, worked or both). Really should be an option to print exam with answers too in our current builder."
// doc 'answers' (Paper with answers): the exam paper, each question followed by its answer (EXV.ans): 'final' the short answer, 'worked'
// the marking guide's worked solution, 'both'. Only a multiple-choice question records a short answer (its letter); a written part has
// none in the data, so it shows its worked solution in every mode (counted in EXV.fb for the preview's info line; never made up).
function xQ(q,n,doc){exA();
  const fk=figKeys(q), guide=doc==='guide', ans=doc==='answers', am=ans?EXV.ans:'', key=q.type==='mcq'&&q.options.find(o=>o.is_correct)?.label;
  const loose=fk.all.filter(k=>!fk.inline.has(k)&&!fk.opt.has(k)&&!q.figures.find(f=>f.src.endsWith('/'+k+'.png')&&f.part));
  const partFigs=pid=>q.figures.filter(f=>f.part===pid).map(f=>f.src.split('/').pop().replace('.png','')).filter(k=>!fk.inline.has(k));
  // guide: worked solution only; no internal review notes, no rubric for MCQ (the key is highlighted and tabled)
  const clean=h=>h.replace(/<div class="callout"><b>(Check this|Corrected from source)[\s\S]*?<\/div>/g,'').replace(/<div class="help">(?:<[^>]*>)*\s*Corrected from source[\s\S]*?<\/div>/g,'').replace(q.type==='mcq'?/<table class="rub">[\s\S]*?<\/table>/g:/$^/,'');
  const sols=pid=>{if(!guide&&!ans)return '';const s=solsFor(q,pid,'bank');if(s.count&&ans&&am!=='worked'&&q.type!=='mcq')EXV.fb++;return s.count?`<div class="xsol">${clean(s.html)}</div>`:''};
  const mcOnly=q.type==='mcq'&&am==='final'&&key;   // final answer only: the letter, no working (filed under its part or the whole question)
  const mcSols=q.type==='mcq'&&!mcOnly?q.parts.map(p=>sols(p.id)).join(''):'';
  const mcKey=q.type==='mcq'&&key&&(am==='final'||am==='both')?`<div class="ex-ans"><b>Answer:</b> ${esc(key)}</div>`:'';
  const lone=q.parts.length===1&&!q.parts[0].label;
  const parts=q.parts.map(p=>{const lf=leaf(q,p);
    const mk=p.marks!=null&&!lone?`<span class="xpm">[${p.marks}]</span>`:'';   // owner 18 Nov (sample layout): part marks as "[2]" at the right
    return `<div class="xpart ${p.parent?'child':''} ${p.label?'':'nolab'}">${p.label?`<span class="xpl">(${esc(p.label)})</span>`:''}<div class="xpb"><div class="tx">${tex(p.latex)}${xFigSlots(q,partFigs(p.id))}</div>
      ${lf&&q.type!=='mcq'&&doc==='exam'?exLines(q,p):''}${q.type==='mcq'?'':sols(p.id)}</div>${mk}</div>`}).join('');
  let opts='';const lay=q.layout||(q.opt_table?'table':'text');
  if(q.type==='mcq'){const ok=o=>(guide||ans)&&o.is_correct?' xok':'';
    if(lay==='table'&&q.opt_table)opts=optTableHTML(q,guide||ans);
    else if(lay==='graph')opts=`<div class="xog">${q.options.map(o=>`<div class="xo${ok(o)}"><b>${o.label}.</b>${o.fig?xFigSlots(q,[o.fig]):`<span class="tx">${tex(o.latex)}</span>`}</div>`).join('')}</div>`;
    else opts=`<div class="xol">${q.options.map(o=>`<div class="xo${ok(o)}"><b>${o.label}.</b><span class="tx">${tex(o.latex)}</span></div>`).join('')}</div>`}
  // owner 26 Nov (worksheets): "the worksheet should really conserve space": a worksheet question is headed by its number and marks only
  const ws=EX.kind==='worksheet',head=q.type==='mcq'?`<span class="xqn">${n}</span>`:`<div class="xqh${ws?' ws-qh':''}"><b>${ws?n:'QUESTION '+n}</b><span>(${q.marks??'?'} mark${q.marks===1?'':'s'})</span></div>`;
  // owner 18 Nov, with a sample paper: "can u make the format of questions like this": "QUESTION 4  (4 marks)" in bold capitals with the
  // marks beside it (no rule), "(a)" in plain type, "[1]" at the right of each part, dotted answer lines (08_exam.css, 30_word.js)
  // owner 14 Nov: "The dot point home looks stupid in a question", then "Yeah that's fine, the i is fine". The grey dot-point
  // line and Report link are gone from the question; a Report link ends the source line (owner 18 Nov; qiButton, 27_reports.js)
  // with the dot points per part, band, kind and Report. Screen only (.scr-only), like the old line.
  // owner 18 Nov: "In the PDF output, remove the school name, just the qid for each question": the paper (and so its PDF, Word and HTML
  // downloads) shows only the QID; the marking guide keeps the source, and ⓘ still shows it on screen
  const src=`<div class="xsrc exsrc"><span class="exsrcl">${guide?esc(srcLine(q))+' · ':''}${qid(q)}</span>${qiButton(q,n)}${ws?WS.qctl(q,n):''}</div>`;   // worksheets: Swap / Remove (screen only)
  const h=`<section class="xq ${q.type==='mcq'?'mc':'wr'}" data-q="${q.id}">${head}<div class="xqb">${q.stem?`<div class="tx">${tex(q.stem)}</div>`:''}${xFigSlots(q,loose)}${parts}${opts}${mcKey}${mcSols}${mcOnly?'':sols(null)}</div>${src}</section>`;
  // every diagram slot, including inline \exfigure ones that tex() writes, so this runs on the finished HTML.
  // owner 25 Nov: "This is currently independent, but it should be the same in question and solutions is what I meant": the marking
  // guide draws each diagram at the exam's size for it too (EX.figscale, one size per figure per exam), with the same corner handle,
  // so resizing a diagram on either changes it on both
  return h.replace(/<span class="figslot" data-fig="([\w.()-]+)"><\/span>/g,(m,k)=>exFigWrap(k));
}
// xCover (the editable cover) is in 24_exams.js
// owner 26 Nov: "NO I ALSO MEANT a version where the answers are attched after all the questions, for students to self check, just the two
// pdfs stacked one after anotrher": doc 'stack' is the exam paper as printed, then the marking guide from a new page, each numbering its own
// pages (b.part says which; 24_exams.js xPreview)
function xBlocks(doc){if(doc==='stack')return [...xBlocks('exam'),...xBlocks('guide').map((b,i)=>({...b,newpage:b.newpage||!i}))];
  if(EX.kind==='worksheet')return WS.blocks(doc);   // owner 26 Nov: no cover, no sections, two columns (38_worksheets.js)
  const {mc,wr}=xSections(),paper=doc!=='guide';const bl=[];let n=0;if(doc==='answers')EXV.fb=0;
  if(paper)bl.push({cover:true,html:xCover(mc,wr)},{cover:true,html:'<div class="xblank">This page is intentionally left blank.</div>'});   // owner 18 Nov: the back of the first page is blank
  else{const keys=mc.map((q,i)=>`<td>${i+1}</td><td><b>${q.options.find(o=>o.is_correct)?.label||'–'}</b></td>`);
    bl.push({html:`<div class="xgh"><div class="xeyebrow">${esc(EX.school)} · ${esc(EX.title)}</div><h1>${esc(EX.sub)} – marking guide</h1></div>${mc.length?`<div class="xsechd"><b>Section I – answer key</b></div><table class="xkey"><tbody>${keys.map(k=>`<tr>${k}</tr>`).join('')}</tbody></table>`:''}`})}
  const SH=EXSEC.secs(mc,wr);   // owner 18 Nov: section headings as on a NESA paper (EXSEC.head, 24_exams.js)
  if(mc.length){bl.push({sec:true,html:EXSEC.head(SH[0],!paper)});mc.forEach(q=>bl.push({html:xQ(q,++n,doc),q}))}
  // owner 17 Nov: questions that "refer to the z score table at the back of the exam" keep that wording, and the exam gets the
  // table appended at the back (zTableHTML, 19_ztable.js). Questions that print their own portion of the table keep it.
  const zAtEnd=paper&&[...mc,...wr].some(needsZ);
  if(wr.length){bl.push({sec:true,newpage:paper,html:EXSEC.head(SH[SH.length-1],!paper)});wr.forEach(q=>bl.push({html:xQ(q,++n,doc),q}))}
  if(zAtEnd)bl.push({newpage:true,html:zTableHTML()});
  // owner 18 Nov: "attach an advanced reference sheet at the end for students. This should be an extension 1 or 2 one or a standard one
  // when we do more courses later so plan for that": each course names its NESA reference sheet pages (QG.courses[..].ref)
  if(paper)(QG.courseData.ref||[]).forEach((p,i)=>bl.push({newpage:true,html:`<div class="xref"><img src="${esc(QG.url(p))}" alt="Reference sheet, page ${i+1}"></div>`}));
  bl.forEach(b=>{b.part=doc});return bl}
// a document's name after the exam's (titles, file names, page footers); the exam paper has none
// owner 26 Nov (worksheets): "worked solutions" is a worksheet's name for its marking guide
const XDOC={guide:'marking guide',answers:'with answers',stack:'with solutions at the back'},xDocSfx=(doc,sep)=>XDOC[doc]?sep+(doc==='guide'&&EX.kind==='worksheet'?'worked solutions':XDOC[doc]):'';
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
  // owner 25 Nov ("Besides that, yes action all these things"; checker: "reference sheet doenst show up when downloading html"): the
  // reference sheet pages (and any picture still held by address, not inline) are put into the file itself, so it needs nothing else
  await Promise.all([...clone.querySelectorAll('img[src]')].filter(i=>!/^data:/.test(i.getAttribute('src'))).map(async i=>{
    try{const b=await (await fetch(i.src)).blob();i.setAttribute('src',await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=no;r.readAsDataURL(b)}))}catch(e){}}));
  const css=$$('style').map(s=>s.textContent).join('\n');
  const cache=document.getElementById('MJX-SVG-global-cache');
  // The page's own fonts are self-hosted (vendor/fonts/fonts.css, hardening 14 Nov), but that relative link would not resolve in a
  // downloaded file, so the file keeps the Google Fonts links it always had (same faces; the viewer's browser fetches them).
  const fonts=EXPORT_FONT_LINKS;
  const name=(EX.sub||'exam').replace(/[^\w\- ]+/g,'').trim()||'exam';
  const html=`<!doctype html><html lang="en-AU" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(EX.sub)}${xDocSfx(doc,' – ')}</title>${fonts}<style>${css}
body{background:#e9e6df!important}body>*:not(.xpages){display:none!important}.xpages{display:flex!important;padding:24px 0}
html,body{margin:0!important;padding:0!important}:root{padding:0!important}
@media print{body{background:#fff!important}.xpages{padding:0!important;gap:0!important}.sheet{height:297mm!important;min-height:0!important;overflow:hidden;margin:0!important;box-shadow:none!important}}</style></head><body>${cache?cache.outerHTML:''}<div class="xpages">${$('#xPages').innerHTML}</div>
<script>/* Print with Ctrl+P / Cmd+P, or save as PDF from the print dialog. Made with Questgen. */<\/script></body></html>`;
  if(!dl){toast('Downloading is not available in this view');return}
  try{await dl.save({filename:`${name}${xDocSfx(doc,' - ')}.html`,data:html});toast('Saved. Open the file and print it, or save it as PDF.')}
  catch(e){if(e?.code!=='declined')toast('Could not download ('+(e?.code||'error')+')')}
  }finally{clone.remove();live.id='xPages'}}
document.addEventListener('click',e=>{
  if(e.target.closest('#xPvClose')){xClosePv();return}
  const s=e.target.closest('[data-xdoc]');if(s){xPreview(s.dataset.xdoc);return}
  const a=e.target.closest('[data-xans]');if(a){EXV.ans=a.dataset.xans;save('ex_ans',EXV.ans);xPreview('answers');return}   // owner 26 Nov: see xQ
  const d=e.target.closest('#xDl');if(d&&!d.disabled){xDownload(d.dataset.doc);return}});

xCount();
