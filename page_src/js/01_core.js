const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
/* Shared page state. owner 13 Nov: "keep the code proper and [lean] as we develop", "run the refactor overnight" (health
   pass, CODE_HEALTH rule 1).
   One object holds what many views share: bank: data/bank.json · dots / dm: the dot points (list / by id) · reviews: review
   decisions from the db · db: the db capability (null without one) · me: the viewer's user id · editor: null until the user
   capability answers, then true only for the owner or an editor · view: the view on screen · course: the course the
   Bank, Exams, topics and dot points are about (courses below). New shared state is a QG field, never a new page-wide name.
   The older names B, DOTS, DM, reviews, db, me, EDITOR and view still work: they are window accessors that read and write
   these fields (not declarations), so nothing that used them had to change. New code writes QG.x. */
// owner 13 Nov (health pass, CODE_HEALTH rule 5): course is a dimension: the course's name and the files holding its questions (with their topics and
// difficulty references) and its dot points come from QG.courses[QG.course]; read them with QG.courseData, never type
// "Advanced" (or its years: the year levels its imported papers come from, owner 21 Nov: no hanging numbers). Only Advanced has data so far; a course is added here once it has a bank, dot points and difficulty references.
const QG={bank:null,dots:[],dm:{},reviews:{},db:null,me:null,editor:null,owner:null,view:'bank',course:'advanced',
  // owner 14 Nov: "Ok we should run Fix 1 and 2" (Fix 1: keep the published page small; fetch data only when needed): bank is
  // the course's small index (tools/bank_split.py); each question's text arrives with its topic file (QG.need below)
  // owner 16 Nov: "Yeah build it" (job 2): the index is slim and compressed; the rest of each question's index fields (triage,
  // review notes, full tags and difficulty) comes in det, read right after start (QG.det)
  // ref: the course's NESA reference sheet, one image per page (owner 18 Nov; from "MA Reference Sheet 2024.pdf" in the CMC Resources
  // drive; Extension 1 / 2 and Standard have their own: ME1, ME2, MST Reference Sheet 2024, ids in state/work/ref_sheets.json)
  courses:{advanced:{name:'Mathematics Advanced',short:'Advanced',years:'Year 12',bank:'data/bank/advanced/index.gz.json',det:'data/bank/advanced/details.gz.json',dots:'data/dotpoints.json',ref:['data/ref/advanced-1.png','data/ref/advanced-2.png']}},
  get courseData(){return this.courses[this.course]},
  byId:new Map(),got:new Set(),fileP:{},failed:new Set(),assets:{},_fillT:0,detOK:false,detP:null,detFail:false,_remix:0,night:null,
  // health pass 21 Nov: a page-database document's fields, and a snapshot's documents as {id, ...fields} (was written out in 15 places)
  val:d=>d&&(typeof d.data==='function'?d.data():d.data), docs:s=>((s&&s.docs)||s||[]).map(x=>({id:x.id,...QG.val(x)})),
  // owner 17 Nov: "lets do skill gates, that's important": {skill: [topic keys it needs learnt]} from the details file (tools/bank_split.py
  // skill_gates: the skill's taught topic + its prerequisites' topics, basic skills left out); read by the exam builders (XG, 23_exam_auto.js)
  skills:{}};
/* ---------- data on demand (Fix 1, owner 14 Nov: "Ok we should run Fix 1 and 2") ----------
   The index (QG.bank) holds every question without its text: ids, paper, marks, parts with tags and difficulty, triage, figure
   keys (q.fk), the "hence integrate" flag (q.hx) and q.h, the topic file its text lives in (bank.files[q.h]). Lists, counts,
   bankStats, the exam generator and Review's tracks run on the index alone. A view that shows questions calls QG.need(qs) first;
   Job 2 (owner 16 Nov: "Yeah build it"): the index at start holds only what the Bank needs (main tags, difficulty band and kind,
   triage tier, figure keys); the rest of the index fields arrive in the course's details file right after start (QG.det) and
   are merged into the same objects. Every view but the Bank waits for them (QG.ready, 09_router.js route), and so does a
   question card (QG.has). Both files are gzip as base64 text: QG.json unpacks them (DecompressionStream, browsers from 2023 on).
   qBody() of a question whose file has not arrived draws a placeholder (QG.pending) that fills itself in when it lands.
   Images (page images, figure crops, redraws, overlays) are read from the address in data/assets.json when it has one (the
   artifact's asset store, uploaded by the main session), else from the published file as before (QG.url). */
Object.assign(QG,{
  // fetch JSON, retrying a load that fails during a republish or a network blip (3 retries, 0.8 s, 1.6 s, 2.4 s)
  async get(u,tries=4){let err;for(let i=0;i<tries;i++){try{const r=await fetch(u+(u.includes('?')?'&':'?')+'r='+i+'_'+Date.now());if(!r.ok)throw new Error(r.status);return await QG.json(r)}catch(e){err=e;if(i<tries-1)await new Promise(z=>setTimeout(z,800*(i+1)))}}throw err},
  // job 2: the bank index and details are gzip carried as base64 text, {v, gz} (the host serves no .gz files); anything else is plain JSON
  async json(r){const o=await r.json();if(!o||typeof o.gz!=='string')return o;
    if(!QG.canGz())throw new Error('this browser cannot unpack the question bank');
    const b=Uint8Array.from(atob(o.gz),c=>c.charCodeAt(0));
    return JSON.parse(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).text())},
  canGz(){return typeof DecompressionStream==='function'},
  OLD:'This browser is too old to open the question bank: please update it (Safari 16.4, Chrome 80, Firefox 113 or later).',
  url(p,v){const a=QG.assets[p];return a?(a.url||a):p+(v?'?v='+encodeURIComponent(v):'')},
  has(q){return !!q&&QG.detOK&&QG.got.has(q.id)},
  hasAll(){return QG.detOK&&QG.got.size>=(QG.bank?.questions.length||0)},
  // fields that moved to the details file start as empty lists, so a list read before they arrive cannot throw
  setBank(b){b.questions.forEach(q=>{for(const k of ['solutions','related','queues','pages'])if(!q[k])q[k]=[]});
    QG.bank=b;QG.byId=new Map(b.questions.map(q=>[q.id,q]));try{_esc={};_dupm=null}catch(e){}QG.got=new Set();QG.fileP={};QG.failed=new Set();QG.detOK=false;QG.detP=null;QG.detFail=false},
  // the details file (job 2): merged into the same question and part objects. A question whose topic file came first keeps
  // that file's full solutions (with their text) instead of the index list.
  det(){if(QG.detOK||!QG.bank)return Promise.resolve();const b=QG.bank;
    return QG.detP||(QG.detP=QG.get(QG.courseData.det).then(d=>{if(QG.bank!==b)return;
      // the index and the details come from one build (src = bank.json's hash); a load during a republish can mix two: read both again
      if(d.src&&b.src&&d.src!==b.src&&!QG._remix){QG._remix=1;return QG.get(QG.courseData.bank).then(nb=>{QG.setBank(nb);return QG.det()})}   // once: a second mismatch merges what matches
      Object.entries(d.q||{}).forEach(([id,c])=>{const q=QG.byId.get(+id);if(!q)return;const {parts,solutions,...rest}=c;Object.assign(q,rest);
        if(solutions&&!QG.got.has(q.id))q.solutions=solutions;
        if(parts){const pm=new Map(q.parts.map(p=>[String(p.id),p]));Object.entries(parts).forEach(([pid,v])=>{const p=pm.get(pid);if(p)Object.assign(p,v)})}});
      QG.skills=d.sk||{};QG.detOK=true;QG.detFail=false;QG.onDet()},
      e=>{QG.detP=null;QG.detFail=true;QG.waitNote()}))},
  // a view other than the Bank draws only once the details are in (09_router.js route calls QG.wait instead)
  ready(v){return !QG.bank||v==='bank'||QG.detOK},
  // caches built from the index are rebuilt with the full fields, then the open view is drawn again
  onDet(){TOPICS=null;
    for(const f of [()=>{_clean=null;_esc={};_rk=null;_dupm=null},()=>{_spot=null},()=>{_grp=null},()=>_ee.clear(),()=>_qd.clear(),()=>{_xah=null},()=>{_xat=null},()=>XG.nc.clear()])try{f()}catch(e){}
    QG.waitNote();route();QG.fill()},
  wait(){QG.waitNote();QG.det()},   // onDet draws the view when they land
  // one notice while a view waits for the details (or they failed to load)
  waitNote(){let n=document.getElementById('detWait');const on=!QG.ready(view);
    if(!on){if(n)n.hidden=true;return}
    if(!n){n=document.createElement('div');n.id='detWait';n.setAttribute('role','status');document.body.appendChild(n)}
    n.hidden=false;n.innerHTML=QG.detFail?(QG.canGz()?'The question details did not load. <button class="act" type="button" data-detretry="1">Try again</button>':QG.OLD):'Loading question details…'},
  file(h){const f=QG.bank.files[h];if(!f)return Promise.resolve();
    return QG.fileP[h]||(QG.fileP[h]=QG.get(f.f+'?v='+f.s,3).then(d=>{QG.failed.delete(h);
      Object.entries(d.q||{}).forEach(([id,c])=>{const q=QG.byId.get(+id);if(!q)return;const {parts,fn,...rest}=c;
        Object.assign(q,rest);const pm=new Map(q.parts.map(p=>[p.id,p]));(parts||[]).forEach(cp=>{const p=pm.get(cp.id);if(p)Object.assign(p,cp)});
        Object.entries(fn||{}).forEach(([k,v])=>{if(QG.bank.figs[k])Object.assign(QG.bank.figs[k],v)});QG.got.add(q.id)})},
      e=>{delete QG.fileP[h];QG.failed.add(h)}))},
  need(qs){const hs=new Set();(qs||[]).forEach(q=>{if(q&&!QG.got.has(q.id)&&q.h!=null)hs.add(q.h)});return Promise.all([...[...hs].map(QG.file),QG.detFail?null:QG.det()]).then(()=>{})},   // after a failure the details load again only on Try again
  needAll(){return QG.need(QG.bank.questions)},
  pending(q,mode){QG.need([q]).then(QG.fill);const bad=QG.failed.has(q.h)||QG.detFail;
    return `<div class="qbody qpend muted" data-qpend="${q.id}" data-qmode="${esc(mode)}">${bad?'This question did not load. <button class="act" type="button" data-qretry="1">Try again</button>':'Loading question…'}</div>`},
  // fill in every placeholder whose question has arrived. Review binds its buttons when it draws, so it is redrawn whole.
  fill(){if(QG._fillT)return;QG._fillT=setTimeout(()=>{QG._fillT=0;let rv=false;
    document.querySelectorAll('[data-qpend]').forEach(el=>{const q=QG.byId.get(+el.dataset.qpend);if(!q)return;
      if(!QG.has(q)){if((QG.failed.has(q.h)||QG.detFail)&&!el.querySelector('[data-qretry]'))el.innerHTML='This question did not load. <button class="act" type="button" data-qretry="1">Try again</button>';return}
      if(el.closest('#rout')){rv=true;return}
      const mode=el.dataset.qmode,t=document.createElement('div');t.innerHTML=qBody(q,mode);const n=t.firstElementChild;el.replaceWith(n);hydrate(n,q,mode);typeset(n)});
    if(rv&&typeof renderReview==='function')renderReview()},0)},
  // Review › a paper: its questions are about to be shown one by one, so their files load as soon as the paper opens
  prefetch(){const m=/^#review\/paper\/(\d+)/.exec(location.hash);if(!m||!QG.bank)return;const ids=(typeof docIds==='function'?docIds(m[1]):[+m[1]]).map(String);
    QG.need(QG.bank.questions.filter(q=>ids.includes(String(q.doc)))).then(QG.fill)}
});
addEventListener('hashchange',()=>QG.prefetch());
document.addEventListener('click',e=>{const d=e.target.closest&&e.target.closest('[data-detretry]');if(!d)return;d.disabled=true;QG.detFail=false;QG.wait()});
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-qretry]');if(!b)return;const q=QG.byId.get(+b.closest('[data-qpend]').dataset.qpend);
  b.disabled=true;QG.failed.delete(q.h);QG.detFail=false;QG.need([q]).then(QG.fill)});
for(const [k,f] of [['B','bank'],['DOTS','dots'],['DM','dm'],['reviews','reviews'],['db','db'],['me','me'],['EDITOR','editor'],['view','view']])
  Object.defineProperty(window,k,{get:()=>QG[f],set:v=>{QG[f]=v},configurable:true});
let sel=null, search='', rlist=[], ridx=0, rfilter='diagrams', rstatus='todo', rdoc='', editing=null, revealed=new Set();
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('on');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('on'),1800)}
function save(k,v){try{localStorage.setItem(k,v)}catch(e){}}
function load(k){try{return localStorage.getItem(k)}catch(e){return null}}
const docLabel=d=>String(d?.label||'').replace('NESA NESA','NESA');
const qid=q=>'QID '+String(q.id).padStart(4,'0');   // owner: every question has a QID; the source line is paper + question number
const srcLine=q=>docLabel(B.docs[q.doc])+' Q'+q.number;
// MathJax 4 loads its font data asynchronously, so typesetPromise only exists once startup.promise resolves: wait for it.
// Also wait for the Tinos web font, so the table fitting below measures with the final text font, not the fallback.
const typeset=el=>{const M=window.MathJax;const ready=Promise.all([M?.startup?.promise,document.fonts?.ready]).catch(()=>{});
  return ready.then(()=>window.MathJax?.typesetPromise?.([el])).then(()=>{fitTables(el);fitOptTables(el);
    // checker report 18 Nov ("Maths breaks across lines"): inline maths never wraps (03_question.css) unless it is wider than its
    // column; those few may break, at MathJax's own break points, instead of running past the edge
    const cs=[...el.querySelectorAll('mjx-container:not([display="true"])')];
    const W=cs.map(c=>{let p=c.parentElement;while(p&&getComputedStyle(p).display.startsWith('inline'))p=p.parentElement;return p?p.clientWidth:0});
    cs.forEach((c,i)=>c.classList.toggle('mjx-wrap',W[i]>0&&c.getBoundingClientRect().width>W[i]+1))}).catch(()=>{})};
// owner: nothing may protrude from a table cell. After typesetting, widen the label column to its widest entry,
// and all value columns (kept equal) to the widest value; the first guess from character counts is only a starting point.
// owner: "make it so that the word is not split up". A cell is never narrower than its widest piece of maths OR its
// longest word (measured in the cell's own font), so headers like "Amplitude" stay whole.
const _mctx=document.createElement('canvas').getContext('2d');
function cellMinW(td){
  if(td.classList.contains('dg')){const wOf=sel=>{let w=0;td.querySelectorAll(sel+' mjx-container').forEach(m=>w=Math.max(w,m.getBoundingClientRect().width));return w};const a=wOf('.dgtr'),c=wOf('.dgbl');return Math.max(a,c)+0.45*Math.min(a,c)+12}   // split corner cell: labels sit diagonally, so the cell only needs the wider label plus part of the other (owner 12 Nov: "period / rate box is still too big")
  let w=0; td.querySelectorAll('mjx-container').forEach(m=>{w=Math.max(w,m.getBoundingClientRect().width)});
  const tw=document.createTreeWalker(td,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement.closest('mjx-container')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  for(let n=tw.nextNode();n;n=tw.nextNode()){const cs=getComputedStyle(n.parentElement);_mctx.font=`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    n.textContent.split(/\s+/).forEach(x=>{if(x)w=Math.max(w,_mctx.measureText(x).width)})}
  return w;
}
function fitOptTables(root){(root||document).querySelectorAll('table.ot').forEach(t=>{   // MCQ answer tables: widen a column only if its typeset maths needs more room
  const cols=[...t.querySelectorAll('colgroup col')]; if(cols.length<2) return;
  const fs=parseFloat(getComputedStyle(t).fontSize)||16, need=cols.map(()=>0);
  t.querySelectorAll('tbody tr').forEach(tr=>[...tr.children].forEach((td,i)=>{const m=td.querySelector('mjx-container');if(m&&i<need.length)need[i]=Math.max(need[i],(m.getBoundingClientRect().width+20)/fs)}));
  let tot=0; cols.forEach((c,i)=>{const w=Math.max(parseFloat(c.style.width)||0,need[i]);c.style.width=w.toFixed(2)+'em';tot+=w}); t.style.width=tot.toFixed(2)+'em';
})}
// owner: "the table seems too long, will it scale itself?" A data table wider than its column shrinks (down to 62%) instead of scrolling
// owner 18 Nov: "The PDF shows side scroll bars, its a persistent issue across many tables. fix it please, its urgent": on an exam sheet a
// table is fitted again to its real column once the sheets are laid out (shrink: only ever smaller, so no page grows), see xPreview
function scaleTables(root,shrink){(root||document).querySelectorAll('.dtwrap>table.dt:not(.ot)').forEach(t=>{const cur=shrink?(parseFloat(t.style.fontSize)||1):1;if(!shrink)t.style.fontSize='';
  const avail=t.parentElement.clientWidth, w=t.offsetWidth; if(avail>0&&w>avail+(shrink?0.5:1)) t.style.fontSize=Math.max(shrink?0.5:0.62,cur*(avail-2)/w).toFixed(3)+'em'})}
function fitTables(root){fitTables0(root);scaleTables(root)}
function fitTables0(root){(root||document).querySelectorAll('table.dt:not(.ot)').forEach(t=>{   // MCQ answer tables size themselves (optTableHTML)
  const cols=[...t.querySelectorAll('colgroup col')]; if(!cols.length) return;
  const fs=parseFloat(getComputedStyle(t).fontSize)||16, lc=t.querySelector('th.rl,th.lab')?1:0;
  const need=cols.map(()=>0);
  t.querySelectorAll('tr').forEach(tr=>{let ci=0;[...tr.children].forEach(td=>{const k=td.colSpan||1;
    if(k===1&&ci<need.length){const w=cellMinW(td)+20;need[ci]=Math.max(need[ci],w/fs)}ci+=k})});
  const cur=cols.map(c=>parseFloat(c.style.width)||0);
  if(t.dataset.percol){let tot=0;cols.forEach((c,i)=>{const w=Math.max(cur[i],need[i]);c.style.width=w.toFixed(2)+'em';tot+=w});t.style.width=tot.toFixed(2)+'em';return}
  // equal value columns sized from the typeset maths (not the character-count estimate), so wide number tables fit like the paper
  const lw=lc?Math.max(3,need[0]||cur[0]):0, vw=Math.max(3.5,...need.slice(lc).map((x,i)=>x?x*1.3:cur[lc+i]));
  cols.forEach((c,i)=>c.style.width=((i<lc?lw:vw)).toFixed(2)+'em');
  t.style.width=(lw+vw*(cols.length-lc)).toFixed(2)+'em';
})}

