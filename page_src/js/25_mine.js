/* ===================== My exams (owner 14 Nov) =====================
   Owner: "Is there a place to manage created exams?" -> "Yeah do that". A third view on the Exams page beside Exam setup and
   Pick by hand: every saved exam (page database, collection `exams`) with Open, Preview, Duplicate, Rename and Delete (two-step
   confirm), search and sort. The page head also shows "Unsaved changes" / "Saved" for the exam being worked on, with a Save button. */
const EXM={q:'',sort:(()=>{try{return localStorage.getItem('exm_sort')||'new'}catch(e){return 'new'}})(),ren:null,del:null,names:{}};
function exmSub(){if(!db||typeof _xsub==='undefined'||_xsub)return;
  try{_xsub=db.collection('exams').onSnapshot(s=>{const d=s.docs||s;XSAVED=(d||[]).map(x=>({id:x.id,...(typeof x.data==='function'?x.data():x.data)})).sort((a,b)=>String(b.at).localeCompare(String(a.at)));
    exmNames();if(view==='exams'){exHead();if(EXV.view==='mine')renderMine()}if(typeof xSavedList==='function')xSavedList()},()=>{})}catch(e){}}
async function exmNames(){const ids=[...new Set(XSAVED.map(x=>x.by).filter(i=>i&&!(i in EXM.names)))];if(!ids.length)return;
  try{const u=await window.claude?.use?.('user');if(!u?.profiles)return;const ps=await u.profiles(ids);ids.forEach(i=>EXM.names[i]=ps?.[i]?.name||'');if(view==='exams'&&EXV.view==='mine')renderMine()}catch(e){}}
const exmWho=x=>!x.by?'':x.by===me?'you':(EXM.names[x.by]||'a colleague');
// the fields that make up a saved exam; "unsaved" = the open exam differs from its saved copy
const exmSig=x=>JSON.stringify([x.title||'',x.sub||'',x.school||'',x.cert||'',x.time||'',x.reading||'',x.items||[],x.instr||null,x.lines||{},x.figscale||{}]);
function exmState(){if(!EX.items.length)return '';if(!EX.id)return 'new';const s=XSAVED.find(x=>x.id===EX.id);if(!s)return db?'new':'';return exmSig(s)===exmSig(EX)?'saved':'changed'}
// owner 14 Nov (Fix 2): "Ok we should run Fix 1 and 2": a saved exam finds its questions by key (RKEY.items), id as fallback
function exmStats(x){const qs=RKEY.items(x).map(xq).filter(Boolean);let m=0,pr=0,w=0,mc=0;
  qs.forEach(q=>{const k=+q.marks||0;m+=k;if(q.type==='mcq')mc++;const d=qDiff(q);if(d){pr+=d.pr*k;w+=k}});return {n:qs.length,m,mc,pr:w?pr/w:0,miss:(x.items||[]).length-qs.length}}
const exmWhen=t=>{const d=new Date(t);if(isNaN(d))return '';const days=Math.floor((Date.now()-d)/864e5);
  return days<1?d.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'}):days<7?d.toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'}):d.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})};
// owner 14 Nov: cert line saved with the exam; "remove Skip questions used in my other saved exams for now" (avoid forced off)
function exmLoad(x){EX={id:x.id,title:x.title,sub:x.sub,school:x.school,cert:x.cert||'',time:x.time,reading:x.reading,items:RKEY.items(x).filter(i=>xq(i)),instr:x.instr||undefined,lines:x.lines||{},figscale:x.figscale||{},auto:Object.assign(XA_DEF(),x.auto||{},{avoid:false})};
  xsave();try{EXC.clear()}catch(e){}}
function renderMine(){const el=$('#exMine');if(!el)return;exmSub();
  if(!db){el.innerHTML='<div class="exm-empty">Saved exams live in the shared database. Open the page in claude.ai to see them.</div>';return}
  const s=EXM.q.trim().toLowerCase();let L=XSAVED.filter(x=>!s||[x.title,x.sub,x.school].join(' ').toLowerCase().includes(s));
  if(EXM.sort==='old')L=L.slice().reverse();else if(EXM.sort==='title')L=L.slice().sort((a,b)=>String(a.sub||a.title).localeCompare(String(b.sub||b.title)));
  const cur=exmState();
  el.innerHTML=`<div class="exm-top"><div><div class="exm-eyebrow">Saved exams</div><h2>My exams</h2><p class="exm-lead">${XSAVED.length} saved exam${XSAVED.length===1?'':'s'}. Everyone with access to Questgen sees the same list.</p></div>
    <div class="exm-ctl"><input type="search" id="exmQ" placeholder="Search titles" value="${esc(EXM.q)}" aria-label="Search saved exams">
      <select id="exmSort" aria-label="Sort"><option value="new"${EXM.sort==='new'?' selected':''}>Newest first</option><option value="old"${EXM.sort==='old'?' selected':''}>Oldest first</option><option value="title"${EXM.sort==='title'?' selected':''}>Title A–Z</option></select>
      <button type="button" class="act" data-exm-new>New exam</button></div></div>
    ${cur==='new'||cur==='changed'?`<div class="exm-unsaved"><b>${cur==='new'?'The exam you are working on has not been saved.':'The open exam has changes that are not saved.'}</b> ${esc(EX.sub||EX.title)} · ${EX.items.length} questions<button type="button" class="act ok" data-exm-save>Save it</button></div>`:''}
    ${L.length?`<ul class="exm-list">${L.map(x=>{const st=exmStats(x),open=x.id===EX.id,ren=EXM.ren===x.id,del=EXM.del===x.id,who=exmWho(x);
      return `<li class="exm-row${open?' open':''}" data-exm="${esc(x.id)}">
        <div class="exm-main">${ren?`<div class="exm-ren"><input data-exm-rt value="${esc(x.sub||'')}" aria-label="Exam name" placeholder="Name"><button type="button" class="act ok" data-exm-rok>Save</button><button type="button" class="act ghost" data-exm-rx>Cancel</button></div>`
            :`<button type="button" class="exm-t" data-exm-open>${esc(x.sub||'Untitled')}</button>`}
          <div class="exm-meta">${esc(x.title||'')}${x.school?' · '+esc(x.school):''}${open?' · <span class="exm-cur">open now</span>':''}</div>
          <div class="exm-stats"><span><b>${st.m}</b> marks</span><span><b>${st.n}</b> questions${st.mc?` (${st.mc} MC)`:''}</span><span>${Math.round((1-st.pr)*100)}% fluency · ${Math.round(st.pr*100)}% PS</span>${st.miss?`<span class="exm-warn">${st.miss} question${st.miss===1?'':'s'} no longer in the bank</span>`:''}</div>
          <div class="exm-who">Saved ${esc(exmWhen(x.at))}${who?' by '+esc(who):''}</div></div>
        <div class="exm-acts">${del?`<span class="exm-sure">Delete for everyone?</span><button type="button" class="act bad" data-exm-delok>Delete</button><button type="button" class="act ghost" data-exm-delx>Keep</button>`
          :`<button type="button" class="act ok" data-exm-open>Open</button><button type="button" class="act" data-exm-pv>Preview</button><button type="button" class="act ghost" data-exm-dup>Duplicate</button><button type="button" class="act ghost" data-exm-ren>Rename</button><button type="button" class="act ghost exm-del" data-exm-del aria-label="Delete">Delete</button>`}</div></li>`}).join('')}</ul>`
      :`<div class="exm-empty">${XSAVED.length?'No saved exam matches that search.':'No saved exams yet. Build one in Exam setup or Pick by hand, then press <b>Save exam</b>.'}</div>`}`;
  if(EXM.ren){const i=el.querySelector('[data-exm-rt]');if(i){i.focus();i.select()}}}
// the Saved / Unsaved marker (exHead), the My exams segment and container (renderExams), exRefresh and the refresh after
// saving (xSaveDb) are folded into 24_exams.js and 20_exam.js
document.addEventListener('click',async e=>{const t=e.target;
  if(t.closest('[data-exm-save]')){e.preventDefault();if(!db){toast('Saving needs the shared database (open the page in claude.ai)');return}await xSaveDb();return}
  if(!t.closest('#exMine'))return;
  if(t.closest('[data-exm-new]')){const b=t.closest('[data-exm-new]'),st=exmState();
    if((st==='new'||st==='changed')&&!b.dataset.sure){b.dataset.sure=1;b.textContent='Discard unsaved changes? Press again';setTimeout(()=>{if(b.isConnected){delete b.dataset.sure;b.textContent='New exam'}},3500);return}
    EX={title:QG.courseData.name,sub:'Practice examination',school:EX.school||'CMC Education',time:'2 hours',reading:'10 minutes',items:[],lines:{},figscale:{}};xsave();try{EXC.clear()}catch(_){}
    EXV.view='setup';exSaveView();renderExams();toast('New exam started');return}
  const row=t.closest('[data-exm]');if(!row)return;const x=XSAVED.find(s=>s.id===row.dataset.exm);if(!x)return;
  const guard=b=>{const st=exmState();if(x.id!==EX.id&&(st==='new'||st==='changed')&&!b.dataset.sure){const o=b.textContent;b.dataset.sure=1;b.textContent='Replace unsaved exam? Press again';setTimeout(()=>{if(b.isConnected){delete b.dataset.sure;b.textContent=o}},3500);return false}return true};
  if(t.closest('[data-exm-open]')){const b=t.closest('[data-exm-open]');if(!guard(b))return;exmLoad(x);EXV.view=(x.auto&&x.auto.topics&&x.auto.topics.length&&x.auto.ran)?'setup':'pick';exSaveView();renderExams();toast(`Opened “${x.sub||'Untitled'}”`);return}
  if(t.closest('[data-exm-pv]')){const b=t.closest('[data-exm-pv]');if(!guard(b))return;exmLoad(x);renderMine();exHead();xPreview('exam');return}
  if(t.closest('[data-exm-dup]')){const id='e'+Date.now(),{id:_o,...rest}=x;
    try{await db.doc('exams/'+id).set({...rest,sub:(x.sub||'Untitled')+' (copy)',by:me||null,at:new Date().toISOString()});toast('Duplicated')}catch(_){toast('Could not duplicate. Try again in a moment.')}return}
  if(t.closest('[data-exm-ren]')){EXM.ren=x.id;EXM.del=null;renderMine();return}
  if(t.closest('[data-exm-rx]')){EXM.ren=null;renderMine();return}
  if(t.closest('[data-exm-rok]')){exmRename(x,row.querySelector('[data-exm-rt]').value);return}
  if(t.closest('[data-exm-del]')){EXM.del=x.id;EXM.ren=null;renderMine();return}
  if(t.closest('[data-exm-delx]')){EXM.del=null;renderMine();return}
  if(t.closest('[data-exm-delok]')){EXM.del=null;try{await db.doc('exams/'+x.id).delete();if(EX.id===x.id){delete EX.id;xsave()}toast('Exam deleted')}catch(_){toast('Could not delete. Try again in a moment.')}return}
});
async function exmRename(x,v){v=String(v||'').trim();if(!v){toast('Give the exam a name');return}EXM.ren=null;
  const {id:_o,...rest}=x;try{await db.doc('exams/'+x.id).set({...rest,sub:v});if(EX.id===x.id){EX.sub=v;xsave()}toast('Renamed')}catch(_){toast('Could not rename. Try again in a moment.')}renderMine()}
document.addEventListener('keydown',e=>{const i=e.target.closest?.('[data-exm-rt]');if(!i)return;if(e.key==='Enter'){e.preventDefault();const x=XSAVED.find(s=>s.id===i.closest('[data-exm]').dataset.exm);if(x)exmRename(x,i.value)}else if(e.key==='Escape'){EXM.ren=null;renderMine()}});
document.addEventListener('input',e=>{if(e.target.id==='exmQ'){EXM.q=e.target.value;const p=e.target.selectionStart;renderMine();const i=$('#exmQ');if(i){i.focus();try{i.setSelectionRange(p,p)}catch(_){}}}});
document.addEventListener('change',e=>{if(e.target.id==='exmSort'){EXM.sort=e.target.value;try{localStorage.setItem('exm_sort',EXM.sort)}catch(_){}renderMine()}});
