/* ===================== My exams (owner 14 Nov) =====================
   Owner: "Is there a place to manage created exams?" -> "Yeah do that". A third view on the Exams page beside Exam setup and
   Pick by hand: every saved exam (page database, collection `exams`) with Open, Preview, Duplicate, Rename and Delete (two-step
   confirm), search and sort. The page head also shows "Unsaved changes" / "Saved" for the exam being worked on, with a Save button. */
const EXM={q:{exam:'',worksheet:''},sort:(load('exm_sort')||'new'),ren:null,del:null,names:{},
  // owner 26 Nov (worksheets): "it should be manage din a similar way to exams where there's a lsit": one list, two kinds (the words differ)
  K:{exam:{box:'#exMine',qid:'exmQ',sid:'exmSort',eye:'Saved exams',h:'My exams',one:'exam',fresh:'data-exm-fresh',newL:'New exam',simL:'Make similar',simT:'A new exam with the same settings and none of the questions in your saved exams',
      none:'No saved exams yet. Build one in Exam setup or Pick by hand, then press <b>Save exam</b>.'},
    worksheet:{box:'#wsMine',qid:'wsmQ',sid:'wsmSort',eye:'Saved worksheets',h:'My worksheets',one:'worksheet',fresh:'data-ws-fresh',newL:'New worksheet',simL:'Make another',simT:'Another worksheet with the same settings and none of the questions in your saved exams and worksheets',
      none:'No saved worksheets yet. Press <b>New worksheet</b>, choose the skills to practise and make one: it saves itself.'}},
  kind:x=>x&&x.kind==='worksheet'?'worksheet':'exam'};
function exmSub(){if(!db||typeof _xsub==='undefined'||_xsub)return;
  try{_xsub=db.collection('exams').onSnapshot(s=>{XSAVED=QG.docs(s).sort((a,b)=>String(b.at).localeCompare(String(a.at)));
    {const w=load('exm_open'),x=w&&XSAVED.find(s=>s.id===w);if(w)save('exm_open','');if(x&&exCourse(x)===QG.course){exmLoad(x);toast(`Opened “${x.sub||'Untitled'}” in ${QG.courseData.short}`)}}   // owner 23 Nov: see exmLoad
    // owner 25 Nov ("Besides that, yes action all these things"; checker: topic counts "change when another topic is ticked"): Setup's
    // counts leave out questions in saved exams, so they are drawn again when the saved exams arrive or change (before, they waited
    // for the next tick and then jumped)
    exmNames();if(view==='exams'){exHead();if(EXV.view==='mine')renderMine();else if(EXV.view==='setup'){exTopics();exAvail()}}if(view==='worksheets')WS.refresh()},()=>{})}catch(e){}}
async function exmNames(){const ids=[...new Set(XSAVED.map(x=>x.by).filter(i=>i&&!(i in EXM.names)))];if(!ids.length)return;
  try{const u=await window.claude?.use?.('user');if(!u?.profiles)return;const ps=await u.profiles(ids);ids.forEach(i=>EXM.names[i]=ps?.[i]?.name||'');if(view==='exams'&&EXV.view==='mine')renderMine();if(view==='worksheets'&&WS.view==='mine')renderMine('worksheet')}catch(e){}}
const exmWho=x=>!x.by?'':x.by===me?'you':(EXM.names[x.by]||'a colleague');
// the fields that make up a saved exam; "unsaved" = the open exam differs from its saved copy
// owner 25 Nov ("Besides that, yes action all these things"; review: "the list showed "Saved 4:06 pm" for the exam while the banner said it
// wasn't saved"): the database may hand an object back with its keys in another order, so lines and diagram sizes compare sorted (before,
// a saved exam could read as changed for good: "Saving…" stayed, the banner said not saved). Locks are part of the exam (saved with it).
const exmSig=x=>{const o=v=>Object.keys(v||{}).sort().map(k=>[k,v[k]]);return JSON.stringify([x.title||'',x.sub||'',x.school||'',x.cert||'',x.bytopic!==false,x.time||'',x.reading||'',(x.items||[]).concat((x.gone||[]).map(g=>g.id)).map(Number),x.instr||null,o(x.lines),o(x.figscale),((x.auto&&x.auto.locked)||[]).map(Number).sort((a,b)=>a-b)])};
function exmState(){if(!EX.items.length)return '';if(!EX.id)return 'new';const s=XSAVED.find(x=>x.id===EX.id);if(!s)return db?'new':'';return exmSig(s)===exmSig(EX)?'saved':'changed'}
// owner 14 Nov (Fix 2): "Ok we should run Fix 1 and 2": a saved exam finds its questions by key (RKEY.items), id as fallback
function exmStats(x){const qs=RKEY.items(x).map(xq).filter(Boolean);let m=0,pr=0,w=0,mc=0;
  qs.forEach(q=>{const k=+q.marks||0;m+=k;if(q.type==='mcq')mc++;const d=qDiff(q);if(d){pr+=d.pr*k;w+=k}});return {n:qs.length,m,mc,pr:w?pr/w:0,miss:(x.items||[]).length-qs.length}}
const exmWhen=t=>{const d=new Date(t);if(isNaN(d))return '';const days=Math.floor((Date.now()-d)/864e5);
  return days<1?d.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'}):days<7?d.toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'}):d.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})};
// owner 14 Nov: cert line saved with the exam; "remove Skip questions used in my other saved exams for now" (avoid forced off)
// owner 23 Nov: "All the advanced questions dissappeared and then when I went back to the advanced tab and opened the same exam, the
// questions were now gone, destroying that eaxm": an exam of the other course switches the page to that course
// and opens there (exm_open, after the reload); questions this course's bank cannot show stay in EX.gone and are saved back with it.
// owner 25 Nov: "Also in the relative referuence exam just made, the spinner diagram cannot be rezised currently." Cause: the open exam
// shared its diagram sizes (and lines, instructions, locks) with the saved copy in XSAVED, so a resize changed both, the "unsaved
// changes" check saw no change and the size was never saved (gone on the next open). The open exam takes its own copy.
function exmLoad(x){if(exCourse(x)!==QG.course){save('course',exCourse(x));save('exm_open',x.id);save('sel','');location.reload();return false}
  x=JSON.parse(JSON.stringify(x));const all=RKEY.items(x),ks=x.keys||[];
  EX={course:QG.course,gone:all.map((i,k)=>xq(i)?null:{id:i,key:ks[k]||null}).filter(Boolean),id:x.id,title:x.title,sub:x.sub,school:x.school,cert:x.cert||'',bytopic:x.bytopic!==false,time:x.time,timeAuto:x.timeAuto===true,mpm:+x.mpm||1.8,reading:x.reading,items:all.filter(i=>xq(i)),instr:x.instr||undefined,lines:x.lines||{},figscale:x.figscale||{},auto:Object.assign(XA_DEF(),x.auto||{}),
    ...(x.kind==='worksheet'?{kind:'worksheet',ws:Object.assign(WS.DEF(),x.ws||{})}:{})};   // owner 26 Nov: a worksheet keeps its kind and settings
  xsave();try{EXC.clear()}catch(e){}}
function renderMine(kind='exam'){const K=EXM.K[kind],el=$(K.box);if(!el)return;exmSub();
  if(!db){el.innerHTML=`<div class="exm-empty">Saved ${K.one}s live in the shared database. Open the page in claude.ai to see them.</div>`;return}
  // owner 23 Nov: "you shouldn't even be able to see advanced exams in std and vice versa": My exams lists this course's exams only
  const MINE=XSAVED.filter(x=>exCourse(x)===QG.course&&EXM.kind(x)===kind);   // owner 26 Nov: worksheets are listed on Worksheets only
  const s=EXM.q[kind].trim().toLowerCase();let L=MINE.filter(x=>!s||[x.title,x.sub,x.school].join(' ').toLowerCase().includes(s));
  if(EXM.sort==='old')L=L.slice().reverse();else if(EXM.sort==='title')L=L.slice().sort((a,b)=>String(a.sub||a.title).localeCompare(String(b.sub||b.title)));
  // owner 25 Nov ("Besides that, yes action all these things"; review: ""Open now" stays on after you click Close"): no "Open now" pill
  // (after Close no exam is open); the card of the exam last worked on says when its changes are not saved, beside "Saved <time>"
  const cur=EXM.kind(EX)===kind?exmState():'';const chg=cur==='changed'?EX.id:null;
  el.innerHTML=`<div class="exm-top"><div><div class="exm-eyebrow">${K.eye}</div><h2>${K.h}</h2><p class="exm-lead">${MINE.length} saved ${esc(QG.courseData.short)} ${K.one}${MINE.length===1?'':'s'}. Everyone with access to Questgen sees the same list.</p></div>
    <div class="exm-ctl"><input type="search" id="${K.qid}" placeholder="Search titles" value="${esc(EXM.q[kind])}" aria-label="Search saved ${K.one}s">
      <select id="${K.sid}" aria-label="Sort"><option value="new"${EXM.sort==='new'?' selected':''}>Newest first</option><option value="old"${EXM.sort==='old'?' selected':''}>Oldest first</option><option value="title"${EXM.sort==='title'?' selected':''}>Title A–Z</option></select>
      <button type="button" class="act" ${K.fresh}>${K.newL}</button></div></div>
    ${cur==='new'||cur==='changed'?`<div class="exm-unsaved"><b>${cur==='new'?`Your last ${K.one} has not been saved.`:`Your last ${K.one} has changes that are not saved.`}</b> ${esc(EX.sub||EX.title)} · ${EX.items.length} questions<button type="button" class="act ok" data-exm-save>Save it</button></div>`:''}
    ${L.length?`<ul class="exm-list">${L.map(x=>{const st=exmStats(x),ren=EXM.ren===x.id,del=EXM.del===x.id,who=exmWho(x);
      // owner 19 Nov: "does open and preview go to the same thing? Can we just make the block clickable to enter the exam. Also the blocks
      // are so tall vertically ... more efficient and more design oriented": the card opens the exam; two lines; Make similar stays out, the rest in ⋯
      const fk=typeof qWatch==='function'?RKEY.items(x).map(xq).filter(q=>qWatch(q)).length:0;   // owner 19 Nov: "make the reported one not drop to a new row"
      const wn=(st.miss?`<span class="exm-warn" title="${st.miss} question${st.miss===1?'':'s'} no longer in the bank">⚠ ${st.miss} gone</span>`:'')+(fk?`<span class="exm-warn" data-exm-flag="${fk}" title="${fk} question${fk===1?'':'s'} reported or sent back to review">⚠ ${fk} reported</span>`:'');
      const sch=x.school&&!/^\s*cmc\s+education\s*$/i.test(x.school)?' · '+esc(x.school):'';
      return `<li class="exm-row${ren||del?'':' go'}" data-exm="${esc(x.id)}">
        <div class="exm-main">${ren?`<div class="exm-ren"><input data-exm-rt value="${esc(x.sub||'')}" aria-label="${kind==='exam'?'Exam':'Worksheet'} name" placeholder="Name"><button type="button" class="act ok" data-exm-rok>Save</button><button type="button" class="act ghost" data-exm-rx>Cancel</button></div>`
            :`<div class="exm-l1"><button type="button" class="exm-t" data-exm-open>${esc(x.sub||'Untitled')}</button>${wn}</div>`}
          <div class="exm-meta">${esc(x.title||'')}${sch} · Saved ${esc(exmWhen(x.at))}${who?' by '+esc(who):''}${chg===x.id?' · <b class="exm-chg">changes since then not saved</b>':''}</div></div>
        <div class="exm-stats"><span><b>${st.m}</b> marks</span><span><b>${st.n}</b> questions${st.mc?` (${st.mc} MC)`:''}</span><span><b>${Math.round(st.pr*100)}%</b> PS</span></div>
        <div class="exm-acts">${del?`<span class="exm-sure">Delete for everyone?</span><button type="button" class="act bad" data-exm-delok>Delete</button><button type="button" class="act ghost" data-exm-delx>Keep</button>`
          :`<button type="button" class="act ghost" data-exm-sim title="${K.simT}">${K.simL}</button><span class="xmenu"><button type="button" class="act ghost exm-more" data-xmenu aria-expanded="false" aria-label="More">⋯</button><span class="xmenu-pop" hidden><button type="button" class="act" data-exm-dup title="A copy with the same questions">Duplicate</button><button type="button" class="act" data-exm-ren>Rename</button><button type="button" class="act exm-del" data-exm-del>Delete</button></span></span>`}</div></li>`}).join('')}</ul>`
      :`<div class="exm-empty">${MINE.length?`No saved ${K.one} matches that search.`:K.none}</div>`}`;
  if(EXM.ren){const i=el.querySelector('[data-exm-rt]');if(i){i.focus();i.select()}}}
// the Saved / Unsaved marker (exHead), the My exams segment and container (renderExams), exRefresh and the refresh after
// saving (xSaveDb) are folded into 24_exams.js and 20_exam.js
document.addEventListener('click',async e=>{const t=e.target;
  if(t.closest('[data-exm-save]')){e.preventDefault();if(!db){toast('Saving needs the shared database (open the page in claude.ai)');return}await xSaveDb();return}
  const box=t.closest('#exMine,#wsMine');if(!box)return;const kind=box.id==='wsMine'?'worksheet':'exam',rm=()=>renderMine(kind);
  const row=t.closest('[data-exm]');if(!row)return;const x=XSAVED.find(s=>s.id===row.dataset.exm);if(!x)return;
  const guard=b=>{const st=exmState();if(x.id!==EX.id&&(st==='new'||st==='changed')&&!b.dataset.sure){const o=b.textContent;b.dataset.sure=1;b.textContent=`Replace unsaved ${EXM.K[kind].one}? Press again`;setTimeout(()=>{if(b.isConnected){delete b.dataset.sure;b.textContent=o}},3500);return false}return true};
  const ob=t.closest('[data-exm-open]')||(row.classList.contains('go')&&!t.closest('button,input,.xmenu')?row.querySelector('[data-exm-open]'):null);
  if(ob&&kind==='worksheet'){if(!guard(ob)||exmLoad(x)===false)return;WS.go('mine');if(EX.items.length)xPreview('exam');toast(`Opened “${x.sub||'Untitled'}”`);return}   // owner 26 Nov: a worksheet opens on its sheet
  if(ob){const b=ob;if(!guard(b))return;if(exmLoad(x)===false)return;EXV.view='mine';EXV.mode=null;EXV.setupFor=null;exSaveView();renderExams();if(EX.items.length)xPreview('exam');toast(`Opened “${x.sub||'Untitled'}”`);return}   // owner 19 Nov: an exam opens on its paper
  if(t.closest('[data-exm-sim]')){if(exmLoad(x)===false)return;kind==='worksheet'?WS.another():EXAS.similar();return}
  if(t.closest('[data-exm-dup]')){const id='e'+Date.now(),{id:_o,...rest}=x;
    try{await db.doc('exams/'+id).set({...rest,sub:(x.sub||'Untitled')+' (copy)',by:me||null,at:new Date().toISOString()});toast('Duplicated')}catch(_){toast('Could not duplicate. Try again in a moment.')}return}
  if(t.closest('[data-exm-ren]')){EXM.ren=x.id;EXM.del=null;rm();return}
  if(t.closest('[data-exm-rx]')){EXM.ren=null;rm();return}
  if(t.closest('[data-exm-rok]')){exmRename(x,row.querySelector('[data-exm-rt]').value);return}
  if(t.closest('[data-exm-del]')){EXM.del=x.id;EXM.ren=null;rm();return}
  if(t.closest('[data-exm-delx]')){EXM.del=null;rm();return}
  if(t.closest('[data-exm-delok]')){EXM.del=null;try{await db.doc('exams/'+x.id).delete();if(EX.id===x.id)EXAS.fresh(true);toast(kind==='worksheet'?'Worksheet deleted':'Exam deleted')}catch(_){toast('Could not delete. Try again in a moment.')}return}
});
async function exmRename(x,v){const kind=EXM.kind(x);v=String(v||'').trim();if(!v){toast(`Give the ${EXM.K[kind].one} a name`);return}EXM.ren=null;
  const {id:_o,...rest}=x;try{await db.doc('exams/'+x.id).set({...rest,sub:v});if(EX.id===x.id){EX.sub=v;xsave()}toast('Renamed')}catch(_){toast('Could not rename. Try again in a moment.')}renderMine(kind)}
document.addEventListener('keydown',e=>{const i=e.target.closest?.('[data-exm-rt]');if(!i)return;const x=XSAVED.find(s=>s.id===i.closest('[data-exm]').dataset.exm);if(e.key==='Enter'){e.preventDefault();if(x)exmRename(x,i.value)}else if(e.key==='Escape'){EXM.ren=null;renderMine(EXM.kind(x))}});
document.addEventListener('input',e=>{const k=e.target.id==='exmQ'?'exam':e.target.id==='wsmQ'?'worksheet':null;if(!k)return;const id=e.target.id;EXM.q[k]=e.target.value;const p=e.target.selectionStart;renderMine(k);const i=$('#'+id);if(i){i.focus();try{i.setSelectionRange(p,p)}catch(_){}}});
document.addEventListener('change',e=>{const k=e.target.id==='exmSort'?'exam':e.target.id==='wsmSort'?'worksheet':null;if(k){EXM.sort=e.target.value;save('exm_sort',EXM.sort);renderMine(k)}});

/* ---------- the open exam saves itself (owner 19 Nov) ----------
   Owner: "It is very easy to override a current exam, too many outs and ways to replace the questions accidentally", "Can't tell when
   the exam is actually saved", "General confusion navigating between setup, pick by hand and my exams, can't tell which exam we're
   inside or if we're making a new one", "HSC Adv averages 1.8 minutes per mark", "There is no way to see if a question has been used by a
   previous exam"; asked how to save: "Save by itself"; used questions: "avoid them but if used, should show WHERE in the past they were
   used". The bar above every Exams view names the open exam and its state; any change saves a moment later; replacing the questions
   of a saved exam asks first; New exam and Save as a copy are the only ways to start another. One page-wide name (CODE_HEALTH rule 1). */
const EXAS={t:null,busy:false,ask:null,
  schedule(){clearTimeout(this.t);if(!db||!EX.items.length)return;this.t=setTimeout(()=>this.run(),1200);if(view==='exams'&&typeof EXV!=='undefined'&&EXV.built)exHead();else if(view==='worksheets')this.bar()},
  async run(){if(this.busy){this.schedule();return}const st=exmState();if(st!=='new'&&st!=='changed')return;
    this.busy=true;try{await xSaveDb(true)}finally{this.busy=false;if(view==='exams')exHead();else if(view==='worksheets')this.bar()}},
  // owner 25 Nov ("Besides that, yes action all these things"; review: "Escape closes the whole exam ... with the changes still unsaved"):
  // leaving the paper (Close, or Escape with no menu or dialog open) saves what is not saved yet, then shows My exams
  close(){if(db&&['new','changed'].includes(exmState())){clearTimeout(this.t);this.run()}
    if(EX.kind==='worksheet'){exClosePv();WS.go('mine');return}   // owner 26 Nov: a worksheet's sheet closes to My worksheets
    exClosePv();EXV.view='mine';EXV.setupFor=null;exSaveView();if(view==='exams')renderExams()},
  // the saved time and state of the open exam, for the page head and the paper bar (the saved copy's own time: what was really saved)
  state(){const st=exmState(),s=EX.id&&XSAVED.find(x=>x.id===EX.id),d=s&&new Date(s.at),when=d&&!isNaN(d)?d.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'}):'';
    return {st,html:st==='saved'?`<span class="exst-ok">✓ Saved${when?' '+when:''}</span>`:!db?'kept in this browser (saving needs claude.ai)':this.busy?'Saving…':`<span class="exst-wait">${st==='new'?'Not saved yet':'Unsaved changes'}</span>`}},
  // owner 25 Nov ("Besides that, yes action all these things"; review: "there's no Save button inside the exam. The only Save is a banner on
  // the list page"): the paper bar shows the exam's saved state with a Save button (Ctrl/Cmd-S too); changes still save themselves
  bar(S=this.state()){const el=$('#xPvSave');if(!el)return;const can=db&&(S.st==='new'||S.st==='changed')&&!this.busy;el.dataset.st=S.st||'empty';
  el.innerHTML=`<button type="button" class="act${can?' ok':' ghost'}" data-exm-save${can?'':' disabled'} title="${can?(S.st==='new'?'Not saved yet':'Unsaved changes')+'. Save now (Ctrl+S or ⌘S); changes also save themselves a moment later.':'Changes save themselves (Ctrl+S or ⌘S saves at once)'}">${can?'Save':S.html}</button>`},
  name:()=>EX.sub||EX.title||'Untitled exam',
  // the working time: marks x minutes per mark (1.8 for HSC Advanced: 180 minutes for 100 marks), to 5 minutes, unless typed by hand
  time(){if(EX.timeAuto===false)return;const m=xMarks(EX.items.map(xq).filter(Boolean)),w=Math.max(5,Math.round(m*(+EX.mpm||1.8)/5)*5);EX.time=m?EXSEC.dur(w):''},
  fresh(stay){clearTimeout(this.t);if(EX.kind==='worksheet'){WS.fresh(stay);return}EX={course:QG.course,title:QG.courseData.name,sub:'Practice examination',school:EX.school||'CMC Education',time:'',timeAuto:true,mpm:+EX.mpm||1.8,reading:'10 minutes',items:[],lines:{},figscale:{}};
    try{EXC.clear()}catch(_){}xsave();if(stay)return;if(typeof EXV!=='undefined'){EXV.view='setup';EXV.setupFor=null;EXV.mode=null;exSaveView();location.hash='#exams';if(view==='exams')renderExams();window.scrollTo({top:0})}},
  // owner 19 Nov: "tutors should be able to make similar exams if studnts need another one": the same settings (topics, marks, multiple
  // choice, difficulty, papers), none of the questions in any saved exam (this one included), named "<name> (version 2)", on its paper
  async similar(){if(!EX.items.length)return;clearTimeout(this.t);if(db&&exmState()!=='saved')await xSaveDb(true);
    const A=JSON.parse(JSON.stringify(exA())),homes=xaHomes();if(!A.topics.length)A.topics=[...new Set(EX.items.map(i=>homes.get(i)?.sub).filter(Boolean))];
    if(!A.total||!A.ran)A.total=xMarks(EX.items.map(xq).filter(Boolean)),A.mcq=EX.items.filter(i=>xq(i)?.type==='mcq').length;
    A.locked=[];A.avoid=true;A.last=null;const vn=this.vname();
    const keep={title:EX.title,school:EX.school,cert:EX.cert,bytopic:EX.bytopic,mpm:EX.mpm,reading:EX.reading,instr:EX.instr};
    EX={...keep,course:QG.course,sub:vn,time:'',timeAuto:true,items:[],lines:{},figscale:{},auto:A};A.title=EX.sub;
    const r=exGenerate();if(!r||!r.n){toast('Not enough unused questions in these topics for another version');return}
    EX.sub=vn;try{EXC.clear()}catch(_){}xsave();EXV.view='mine';EXV.setupFor=null;exSaveView();if(view==='exams')renderExams();
    xPreview('exam');toast(`Made “${EX.sub}”: ${r.n} questions, none from your saved exams`)},
  // "<name> (version k)", the first k no saved exam or worksheet has (Make a similar exam; a worksheet's Make another like this)
  vname(){const base=this.name().replace(/\s*\(version \d+\)$/,''),names=new Set((XSAVED||[]).map(x=>x.sub));let k=2;while(names.has(`${base} (version ${k})`))k++;return `${base} (version ${k})`},
  go(v){EXV.view=v;EXV.setupFor=null;EXV.mode=null;exSaveView();location.hash='#exams';if(view==='exams')renderExams()},
  // questions of the OTHER saved exams, by key (RKEY.items): id -> [{id, name, at}]
  used(){const u=this._u;if(u&&u.s===XSAVED&&u.e===EX.id)return u.m;const m=new Map();
    (XSAVED||[]).forEach(x=>{if(x.id===EX.id||exCourse(x)!==QG.course)return;RKEY.items(x).forEach(i=>{if(!m.has(i))m.set(i,[]);m.get(i).push({id:x.id,name:x.sub||x.title||'Untitled',at:x.at})})});
    this._u={s:XSAVED,e:EX.id,m};return m},
  usedTag(q){const u=q&&this.used().get(q.id);if(!u||!u.length)return '';const d=t=>{const x=new Date(t);return isNaN(x)?'':' ('+x.toLocaleDateString('en-AU',{day:'numeric',month:'short'})+')'};
    return `<span class="exused" title="${esc('Used in: '+u.map(x=>x.name+d(x.at)).join('; '))}">Used in ${esc(u[0].name)}${d(u[0].at)}${u.length>1?` and ${u.length-1} more`:''}</span>`},
  // before something replaces the questions of a saved exam: Replace, Make a new exam instead, or Cancel (no confirm(): the frame blocks it)
  guard(btn,what,go){if(!EX.id||!EX.items.length||!XSAVED.some(x=>x.id===EX.id)){go();return}
    document.getElementById('exAsk')?.remove();const d=document.createElement('div');d.id='exAsk';d.className='exask';d.setAttribute('role','alertdialog');
    d.innerHTML=`<p>${esc(what)} replaces the ${EX.items.length===1?'question':EX.items.length+' questions'} in “${esc(this.name())}”.</p><div><button type="button" class="act ok" data-ask="new">Make a new ${EX.kind==='worksheet'?'worksheet':'exam'} instead</button><button type="button" class="act" data-ask="replace">Replace them</button><button type="button" class="act ghost" data-ask="x">Cancel</button></div>`;
    btn.insertAdjacentElement('afterend',d);d.querySelector('[data-ask="new"]').focus();
    d.addEventListener('click',e=>{const a=e.target.closest('[data-ask]')?.dataset.ask;if(!a)return;d.remove();
      if(a==='replace')go();else if(a==='new'){const keep=EX.auto,school=EX.school,mpm=EX.mpm,w=EX.kind==='worksheet'?{kind:'worksheet',ws:EX.ws,timeAuto:false}:{};clearTimeout(this.t);EX={title:QG.courseData.name,sub:'Practice examination',school,time:'',timeAuto:true,mpm,reading:'10 minutes',items:[],lines:{},figscale:{},auto:keep,...w};try{EXC.clear()}catch(_){}xsave();go()}})}};
document.addEventListener('click',e=>{const t=e.target;
  if(t.closest('[data-exm-fresh]')){e.preventDefault();EXAS.fresh();return}
});
