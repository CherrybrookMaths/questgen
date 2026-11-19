/* ===================== My exams (owner 14 Nov) =====================
   Owner: "Is there a place to manage created exams?" -> "Yeah do that". A third view on the Exams page beside Exam setup and
   Pick by hand: every saved exam (page database, collection `exams`) with Open, Preview, Duplicate, Rename and Delete (two-step
   confirm), search and sort. The page head also shows "Unsaved changes" / "Saved" for the exam being worked on, with a Save button. */
const EXM={q:'',sort:(()=>{try{return localStorage.getItem('exm_sort')||'new'}catch(e){return 'new'}})(),ren:null,del:null,names:{}};
function exmSub(){if(!db||typeof _xsub==='undefined'||_xsub)return;
  try{_xsub=db.collection('exams').onSnapshot(s=>{const d=s.docs||s;XSAVED=(d||[]).map(x=>({id:x.id,...(typeof x.data==='function'?x.data():x.data)})).sort((a,b)=>String(b.at).localeCompare(String(a.at)));
    exmNames();if(view==='exams'){exHead();if(EXV.view==='mine')renderMine()}},()=>{})}catch(e){}}
async function exmNames(){const ids=[...new Set(XSAVED.map(x=>x.by).filter(i=>i&&!(i in EXM.names)))];if(!ids.length)return;
  try{const u=await window.claude?.use?.('user');if(!u?.profiles)return;const ps=await u.profiles(ids);ids.forEach(i=>EXM.names[i]=ps?.[i]?.name||'');if(view==='exams'&&EXV.view==='mine')renderMine()}catch(e){}}
const exmWho=x=>!x.by?'':x.by===me?'you':(EXM.names[x.by]||'a colleague');
// the fields that make up a saved exam; "unsaved" = the open exam differs from its saved copy
const exmSig=x=>JSON.stringify([x.title||'',x.sub||'',x.school||'',x.cert||'',x.bytopic!==false,x.time||'',x.reading||'',x.items||[],x.instr||null,x.lines||{},x.figscale||{}]);
function exmState(){if(!EX.items.length)return '';if(!EX.id)return 'new';const s=XSAVED.find(x=>x.id===EX.id);if(!s)return db?'new':'';return exmSig(s)===exmSig(EX)?'saved':'changed'}
// owner 14 Nov (Fix 2): "Ok we should run Fix 1 and 2": a saved exam finds its questions by key (RKEY.items), id as fallback
function exmStats(x){const qs=RKEY.items(x).map(xq).filter(Boolean);let m=0,pr=0,w=0,mc=0;
  qs.forEach(q=>{const k=+q.marks||0;m+=k;if(q.type==='mcq')mc++;const d=qDiff(q);if(d){pr+=d.pr*k;w+=k}});return {n:qs.length,m,mc,pr:w?pr/w:0,miss:(x.items||[]).length-qs.length}}
const exmWhen=t=>{const d=new Date(t);if(isNaN(d))return '';const days=Math.floor((Date.now()-d)/864e5);
  return days<1?d.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'}):days<7?d.toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'}):d.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})};
// owner 14 Nov: cert line saved with the exam; "remove Skip questions used in my other saved exams for now" (avoid forced off)
function exmLoad(x){EX={id:x.id,title:x.title,sub:x.sub,school:x.school,cert:x.cert||'',bytopic:x.bytopic!==false,time:x.time,timeAuto:x.timeAuto===true,mpm:+x.mpm||1.8,reading:x.reading,items:RKEY.items(x).filter(i=>xq(i)),instr:x.instr||undefined,lines:x.lines||{},figscale:x.figscale||{},auto:Object.assign(XA_DEF(),x.auto||{})};
  xsave();try{EXC.clear()}catch(e){}}
function renderMine(){const el=$('#exMine');if(!el)return;exmSub();
  if(!db){el.innerHTML='<div class="exm-empty">Saved exams live in the shared database. Open the page in claude.ai to see them.</div>';return}
  const s=EXM.q.trim().toLowerCase();let L=XSAVED.filter(x=>!s||[x.title,x.sub,x.school].join(' ').toLowerCase().includes(s));
  if(EXM.sort==='old')L=L.slice().reverse();else if(EXM.sort==='title')L=L.slice().sort((a,b)=>String(a.sub||a.title).localeCompare(String(b.sub||b.title)));
  const cur=exmState();
  el.innerHTML=`<div class="exm-top"><div><div class="exm-eyebrow">Saved exams</div><h2>My exams</h2><p class="exm-lead">${XSAVED.length} saved exam${XSAVED.length===1?'':'s'}. Everyone with access to Questgen sees the same list.</p></div>
    <div class="exm-ctl"><input type="search" id="exmQ" placeholder="Search titles" value="${esc(EXM.q)}" aria-label="Search saved exams">
      <select id="exmSort" aria-label="Sort"><option value="new"${EXM.sort==='new'?' selected':''}>Newest first</option><option value="old"${EXM.sort==='old'?' selected':''}>Oldest first</option><option value="title"${EXM.sort==='title'?' selected':''}>Title A–Z</option></select>
      <button type="button" class="act" data-exm-fresh>New exam</button></div></div>
    ${cur==='new'||cur==='changed'?`<div class="exm-unsaved"><b>${cur==='new'?'The exam you are working on has not been saved.':'The open exam has changes that are not saved.'}</b> ${esc(EX.sub||EX.title)} · ${EX.items.length} questions<button type="button" class="act ok" data-exm-save>Save it</button></div>`:''}
    ${L.length?`<ul class="exm-list">${L.map(x=>{const st=exmStats(x),open=x.id===EX.id,ren=EXM.ren===x.id,del=EXM.del===x.id,who=exmWho(x);
      // owner 19 Nov: "does open and preview go to the same thing? Can we just make the block clickable to enter the exam. Also the blocks
      // are so tall vertically ... more efficient and more design oriented": the card opens the exam; two lines; Make similar stays out, the rest in ⋯
      const fk=typeof qWatch==='function'?RKEY.items(x).map(xq).filter(q=>qWatch(q)).length:0;   // owner 19 Nov: "make the reported one not drop to a new row"
      const wn=(st.miss?`<span class="exm-warn" title="${st.miss} question${st.miss===1?'':'s'} no longer in the bank">⚠ ${st.miss} gone</span>`:'')+(fk?`<span class="exm-warn" data-exm-flag="${fk}" title="${fk} question${fk===1?'':'s'} reported or sent back to review">⚠ ${fk} reported</span>`:'');
      const sch=x.school&&!/^\s*cmc\s+education\s*$/i.test(x.school)?' · '+esc(x.school):'';
      return `<li class="exm-row${open?' open':''}${ren||del?'':' go'}" data-exm="${esc(x.id)}">
        <div class="exm-main">${ren?`<div class="exm-ren"><input data-exm-rt value="${esc(x.sub||'')}" aria-label="Exam name" placeholder="Name"><button type="button" class="act ok" data-exm-rok>Save</button><button type="button" class="act ghost" data-exm-rx>Cancel</button></div>`
            :`<div class="exm-l1"><button type="button" class="exm-t" data-exm-open>${esc(x.sub||'Untitled')}</button>${open?'<span class="exm-cur">Open now</span>':''}${wn}</div>`}
          <div class="exm-meta">${esc(x.title||'')}${sch} · Saved ${esc(exmWhen(x.at))}${who?' by '+esc(who):''}</div></div>
        <div class="exm-stats"><span><b>${st.m}</b> marks</span><span><b>${st.n}</b> questions${st.mc?` (${st.mc} MC)`:''}</span><span><b>${Math.round(st.pr*100)}%</b> PS</span></div>
        <div class="exm-acts">${del?`<span class="exm-sure">Delete for everyone?</span><button type="button" class="act bad" data-exm-delok>Delete</button><button type="button" class="act ghost" data-exm-delx>Keep</button>`
          :`<button type="button" class="act ghost" data-exm-sim title="A new exam with the same settings and none of the questions in your saved exams">Make similar</button><span class="xmenu"><button type="button" class="act ghost exm-more" data-xmenu aria-expanded="false" aria-label="More">⋯</button><span class="xmenu-pop" hidden><button type="button" class="act" data-exm-dup title="A copy with the same questions">Duplicate</button><button type="button" class="act" data-exm-ren>Rename</button><button type="button" class="act exm-del" data-exm-del>Delete</button></span></span>`}</div></li>`}).join('')}</ul>`
      :`<div class="exm-empty">${XSAVED.length?'No saved exam matches that search.':'No saved exams yet. Build one in Exam setup or Pick by hand, then press <b>Save exam</b>.'}</div>`}`;
  if(EXM.ren){const i=el.querySelector('[data-exm-rt]');if(i){i.focus();i.select()}}}
// the Saved / Unsaved marker (exHead), the My exams segment and container (renderExams), exRefresh and the refresh after
// saving (xSaveDb) are folded into 24_exams.js and 20_exam.js
document.addEventListener('click',async e=>{const t=e.target;
  if(t.closest('[data-exm-save]')){e.preventDefault();if(!db){toast('Saving needs the shared database (open the page in claude.ai)');return}await xSaveDb();return}
  if(!t.closest('#exMine'))return;
  const row=t.closest('[data-exm]');if(!row)return;const x=XSAVED.find(s=>s.id===row.dataset.exm);if(!x)return;
  const guard=b=>{const st=exmState();if(x.id!==EX.id&&(st==='new'||st==='changed')&&!b.dataset.sure){const o=b.textContent;b.dataset.sure=1;b.textContent='Replace unsaved exam? Press again';setTimeout(()=>{if(b.isConnected){delete b.dataset.sure;b.textContent=o}},3500);return false}return true};
  const ob=t.closest('[data-exm-open]')||(row.classList.contains('go')&&!t.closest('button,input,.xmenu')?row.querySelector('[data-exm-open]'):null);
  if(ob){const b=ob;if(!guard(b))return;exmLoad(x);EXV.view='mine';EXV.mode=null;EXV.setupFor=null;exSaveView();renderExams();if(EX.items.length)xPreview('exam');toast(`Opened “${x.sub||'Untitled'}”`);return}   // owner 19 Nov: an exam opens on its paper
  if(t.closest('[data-exm-sim]')){exmLoad(x);EXAS.similar();return}
  if(t.closest('[data-exm-dup]')){const id='e'+Date.now(),{id:_o,...rest}=x;
    try{await db.doc('exams/'+id).set({...rest,sub:(x.sub||'Untitled')+' (copy)',by:me||null,at:new Date().toISOString()});toast('Duplicated')}catch(_){toast('Could not duplicate. Try again in a moment.')}return}
  if(t.closest('[data-exm-ren]')){EXM.ren=x.id;EXM.del=null;renderMine();return}
  if(t.closest('[data-exm-rx]')){EXM.ren=null;renderMine();return}
  if(t.closest('[data-exm-rok]')){exmRename(x,row.querySelector('[data-exm-rt]').value);return}
  if(t.closest('[data-exm-del]')){EXM.del=x.id;EXM.ren=null;renderMine();return}
  if(t.closest('[data-exm-delx]')){EXM.del=null;renderMine();return}
  if(t.closest('[data-exm-delok]')){EXM.del=null;try{await db.doc('exams/'+x.id).delete();if(EX.id===x.id)EXAS.fresh(true);toast('Exam deleted')}catch(_){toast('Could not delete. Try again in a moment.')}return}
});
async function exmRename(x,v){v=String(v||'').trim();if(!v){toast('Give the exam a name');return}EXM.ren=null;
  const {id:_o,...rest}=x;try{await db.doc('exams/'+x.id).set({...rest,sub:v});if(EX.id===x.id){EX.sub=v;xsave()}toast('Renamed')}catch(_){toast('Could not rename. Try again in a moment.')}renderMine()}
document.addEventListener('keydown',e=>{const i=e.target.closest?.('[data-exm-rt]');if(!i)return;if(e.key==='Enter'){e.preventDefault();const x=XSAVED.find(s=>s.id===i.closest('[data-exm]').dataset.exm);if(x)exmRename(x,i.value)}else if(e.key==='Escape'){EXM.ren=null;renderMine()}});
document.addEventListener('input',e=>{if(e.target.id==='exmQ'){EXM.q=e.target.value;const p=e.target.selectionStart;renderMine();const i=$('#exmQ');if(i){i.focus();try{i.setSelectionRange(p,p)}catch(_){}}}});
document.addEventListener('change',e=>{if(e.target.id==='exmSort'){EXM.sort=e.target.value;try{localStorage.setItem('exm_sort',EXM.sort)}catch(_){}renderMine()}});

/* ---------- the open exam saves itself (owner 19 Nov) ----------
   Owner: "It is very easy to override a current exam, too many outs and ways to replace the questions accidentally", "Can't tell when
   the exam is actually saved", "General confusion navigating between setup, pick by hand and my exams, can't tell which exam we're
   inside or if we're making a new one", "HSC Adv averages 1.8 minutes per mark", "There is no way to see if a question has been used by a
   previous exam"; asked how to save: "Save by itself"; used questions: "avoid them but if used, should show WHERE in the past they were
   used". The bar above every Exams view names the open exam and its state; any change saves a moment later; replacing the questions
   of a saved exam asks first; New exam and Save as a copy are the only ways to start another. One page-wide name (CODE_HEALTH rule 1). */
const EXAS={t:null,busy:false,at:null,ask:null,
  schedule(){clearTimeout(this.t);if(!db||!EX.items.length)return;this.t=setTimeout(()=>this.run(),1200);if(view==='exams'&&typeof EXV!=='undefined'&&EXV.built)exHead()},
  async run(){if(this.busy){this.schedule();return}const st=exmState();if(st!=='new'&&st!=='changed')return;
    this.busy=true;try{await xSaveDb(true);this.at=new Date()}finally{this.busy=false;if(view==='exams')exHead()}},
  name:()=>EX.sub||EX.title||'Untitled exam',
  // the working time: marks x minutes per mark (1.8 for HSC Advanced: 180 minutes for 100 marks), to 5 minutes, unless typed by hand
  time(){if(EX.timeAuto===false)return;const m=xMarks(EX.items.map(xq).filter(Boolean)),w=Math.max(5,Math.round(m*(+EX.mpm||1.8)/5)*5);EX.time=m?EXSEC.dur(w):''},
  fresh(stay){clearTimeout(this.t);EX={title:QG.courseData.name,sub:'Practice examination',school:EX.school||'CMC Education',time:'',timeAuto:true,mpm:+EX.mpm||1.8,reading:'10 minutes',items:[],lines:{},figscale:{}};
    try{EXC.clear()}catch(_){}xsave();if(stay)return;if(typeof EXV!=='undefined'){EXV.view='setup';EXV.setupFor=null;EXV.mode=null;exSaveView();location.hash='#exams';if(view==='exams')renderExams();window.scrollTo({top:0})}},
  // owner 19 Nov: "tutors should be able to make similar exams if studnts need another one": the same settings (topics, marks, multiple
  // choice, difficulty, papers), none of the questions in any saved exam (this one included), named "<name> (version 2)", on its paper
  async similar(){if(!EX.items.length)return;clearTimeout(this.t);if(db&&exmState()!=='saved')await xSaveDb(true);
    const A=JSON.parse(JSON.stringify(exA())),homes=xaHomes();if(!A.topics.length)A.topics=[...new Set(EX.items.map(i=>homes.get(i)?.sub).filter(Boolean))];
    if(!A.total||!A.ran)A.total=xMarks(EX.items.map(xq).filter(Boolean)),A.mcq=EX.items.filter(i=>xq(i)?.type==='mcq').length;
    A.locked=[];A.avoid=true;A.last=null;const base=(this.name()).replace(/\s*\(version \d+\)$/,''),names=new Set((XSAVED||[]).map(x=>x.sub));let k=2;while(names.has(`${base} (version ${k})`))k++;
    const keep={title:EX.title,school:EX.school,cert:EX.cert,bytopic:EX.bytopic,mpm:EX.mpm,reading:EX.reading,instr:EX.instr};
    EX={...keep,sub:`${base} (version ${k})`,time:'',timeAuto:true,items:[],lines:{},figscale:{},auto:A};A.title=EX.sub;
    const r=exGenerate();if(!r||!r.n){toast('Not enough unused questions in these topics for another version');return}
    EX.sub=`${base} (version ${k})`;try{EXC.clear()}catch(_){}xsave();EXV.view='mine';EXV.setupFor=null;exSaveView();if(view==='exams')renderExams();
    xPreview('exam');toast(`Made “${EX.sub}”: ${r.n} questions, none from your saved exams`)},
  go(v){EXV.view=v;EXV.setupFor=null;EXV.mode=null;exSaveView();location.hash='#exams';if(view==='exams')renderExams()},
  // questions of the OTHER saved exams, by key (RKEY.items): id -> [{id, name, at}]
  used(){const u=this._u;if(u&&u.s===XSAVED&&u.e===EX.id)return u.m;const m=new Map();
    (XSAVED||[]).forEach(x=>{if(x.id===EX.id)return;RKEY.items(x).forEach(i=>{if(!m.has(i))m.set(i,[]);m.get(i).push({id:x.id,name:x.sub||x.title||'Untitled',at:x.at})})});
    this._u={s:XSAVED,e:EX.id,m};return m},
  usedTag(q){const u=q&&this.used().get(q.id);if(!u||!u.length)return '';const d=t=>{const x=new Date(t);return isNaN(x)?'':' ('+x.toLocaleDateString('en-AU',{day:'numeric',month:'short'})+')'};
    return `<span class="exused" title="${esc('Used in: '+u.map(x=>x.name+d(x.at)).join('; '))}">Used in ${esc(u[0].name)}${d(u[0].at)}${u.length>1?` and ${u.length-1} more`:''}</span>`},
  // before something replaces the questions of a saved exam: Replace, Make a new exam instead, or Cancel (no confirm(): the frame blocks it)
  guard(btn,what,go){if(!EX.id||!EX.items.length||!XSAVED.some(x=>x.id===EX.id)){go();return}
    document.getElementById('exAsk')?.remove();const d=document.createElement('div');d.id='exAsk';d.className='exask';d.setAttribute('role','alertdialog');
    d.innerHTML=`<p>${esc(what)} replaces the ${EX.items.length===1?'question':EX.items.length+' questions'} in “${esc(this.name())}”.</p><div><button type="button" class="act ok" data-ask="new">Make a new exam instead</button><button type="button" class="act" data-ask="replace">Replace them</button><button type="button" class="act ghost" data-ask="x">Cancel</button></div>`;
    btn.insertAdjacentElement('afterend',d);d.querySelector('[data-ask="new"]').focus();
    d.addEventListener('click',e=>{const a=e.target.closest('[data-ask]')?.dataset.ask;if(!a)return;d.remove();
      if(a==='replace')go();else if(a==='new'){const keep=EX.auto,school=EX.school,mpm=EX.mpm;clearTimeout(this.t);EX={title:QG.courseData.name,sub:'Practice examination',school,time:'',timeAuto:true,mpm,reading:'10 minutes',items:[],lines:{},figscale:{},auto:keep};try{EXC.clear()}catch(_){}xsave();go()}})}};
document.addEventListener('click',e=>{const t=e.target;
  if(t.closest('[data-exm-fresh]')){e.preventDefault();EXAS.fresh();return}
});
