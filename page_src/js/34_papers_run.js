// owner 14 Nov: "we might want to run multiple batches over the night" (this replaced the 13 Nov per-batch pause)
// owner 14 Nov: "Maybe remove the lock for now since I'm in charge of import" (supersedes "Let's do 3 batches before the lock")
/* ---------- Processes › Papers › Queue (Curate: editors only) ----------
   ONE ordered list of batches across courses: db collection "queue", one doc per batch, id '<lane>_<n>' ('advanced_12_6'):
   {course, yl, batch, order, by, at}. Batches come in from the lanes (+1 batch, +2 batches, Queue all, a batch panel's Add to
   the queue); ↑ ↓ reorder (the shared writeOrder, 31_notes.js), × removes (no confirm: it can be added again).
   Start the queue writes ONE request to db collection "runs" (as Go did): {kind:'queue', status:'requested', stop_early,
   queue:[{course, yl, batch, papers}], papers, est, by, at}; Cancel sets status 'cancelled' (kept). Until the import API is
   connected, Claude runs it (tools/import_next.py follows the queue): every batch in it, top to bottom, until it is empty;
   no review lock. It stops early only when a batch comes back with unusual problems (STOP_EARLY, IMPORT_PLAYBOOK "Queue").
   "N batches are waiting for review" beside Start is information only (PQ.waiting(): imported batches whose papers have not
   all cleared Review, by Review's own per-paper track). Run the cover-page check writes {kind:'cover_check',
   status:'requested', papers:[the Needs a check papers], by, at} to "runs" too; Claude does the check.
   No new page-wide name: PQ.run. Only editors read or write: every handler checks isOwnerV(). */
PQ.run=(()=>{
const R={q:[],runs:[],subs:{},busy:false};
// unusual problems that stop the queue early (chosen 14 Nov while the owner was away; tools/import_next.py STOP_EARLY): a paper
// that loaded no questions, 3 or more pages the parser could not read, or more than 12 Your calls in one batch
const STOP_EARLY={failed_papers:1,failed_pages:3,your_calls:13};
// until a cost per paper is measured, US$12–17 a paper, labelled an estimate (owner 13 Nov)
const EST=[12,17];
const ACTIVE=['requested','running'];
const snap=QG.docs;
function subscribe(){if(!db||!isOwnerV())return;
  if(!R.subs.q)try{R.subs.q=db.collection('queue').onSnapshot(s=>{R.q=snap(s).filter(x=>x&&x.course&&Number.isFinite(+x.batch));PQ.redraw();draw()},()=>{})}catch(e){}
  if(!R.subs.r)try{R.subs.r=db.collection('runs').onSnapshot(s=>{R.runs=snap(s).filter(x=>x&&x.status);PQ.redraw();draw();
    if(view==='processes'&&$('#processesView').dataset.tab!=='papers')renderProcesses()},()=>{})}catch(e){}}   // job 6: the Tonight card lists waiting requests
const key=x=>PQ.laneKey(x.course,String(x.yl));
const ordered=()=>R.q.slice().sort((a,b)=>(+a.order||0)-(+b.order||0)||String(a.at).localeCompare(String(b.at)));
// the queue with each batch resolved (papers still ready); an imported batch stays listed as Imported until Claude removes it
function items(){return ordered().map(x=>{const f=PQ.batch(key(x),x.batch);return {x,f,ready:f?f.b.ready:[],done:!!(f&&f.b.done)||!!(f&&!f.b.ready.length)}})}
const live=()=>items().filter(i=>!i.done);
function pos(k,n){const i=live().findIndex(i=>key(i.x)===k&&+i.x.batch===+n);return i+1}
const active=kind=>R.runs.filter(r=>r.kind===kind&&ACTIVE.includes(r.status)).sort((a,b)=>String(b.at).localeCompare(String(a.at)))[0]||null;
function cost(n){const v=PQ.cost(),pp=v||EST;return {est:!v,pp,lo:n*pp[0],hi:n*pp[1]}}
function draw(){const el=$('#prQueue');if(!el||!isOwnerV())return;if(!PQ.state.data){el.innerHTML='';return}
  const L=items(),n=live(),np=n.reduce((s,i)=>s+i.ready.length,0),c=cost(np),run=active('queue');
  const row=(i,k)=>{const f=i.f,nm=f?f.lane.name:PQ.laneName(i.x.course,String(i.x.yl)),st=i.done?'Imported':k===0?(run&&run.status==='running'?'Running':'Next'):'Waiting';
    return `<li class="pr-qi${!i.done&&k===0?' next':''}${i.done?' done':''}" data-prq="${esc(i.x.id)}"><span class="pr-qn" aria-hidden="true">${i.done?'✓':k+1}</span>
      <span class="pr-qt"><b>${esc(nm)} · <span class="pr-nw">Batch ${esc(i.x.batch)}</span></b><small>${i.done?'imported':`${PQ.plural(i.ready.length,'paper')}${i.ready.length?' · '+esc(PQ.yrs(i.ready)):''}`}</small></span>
      <span class="pr-qs">${st}</span><span class="pr-qacts">${i.done?'':`<button type="button" class="nbtn" data-prqmv="-1" data-prq-id="${esc(i.x.id)}" aria-label="Move up"${k===0?' disabled':''}>↑</button><button type="button" class="nbtn" data-prqmv="1" data-prq-id="${esc(i.x.id)}" aria-label="Move down"${k===n.length-1?' disabled':''}>↓</button>`}<button type="button" class="nbtn ndel" data-prqdel="${esc(i.x.id)}" aria-label="Remove from the queue">×</button></span></li>`};
  let k=0;
  // owner 14 Nov: "Maybe remove the lock for now since I'm in charge of import": no limit; the waiting count is information only
  const wt=PQ.waiting(),wtxt=wt===1?'1 batch is waiting for review':`${wt?PQ.nf(wt):'No'} batches are waiting for review`;
  el.innerHTML=`<div class="pr-qhead"><h4>Queue</h4><span>Runs top to bottom until the queue is empty. Stops early only if a batch comes back with unusual problems.</span></div>
    ${L.length?`<ol class="pr-qlist">${L.map(i=>row(i,i.done?-1:k++)).join('')}</ol>`:`<p class="pempty">Nothing queued. Add batches from a course: +1 batch, or click a square.</p>`}
    <div class="pr-qfoot"><span>${PQ.plural(n.length,'batch','batches')} · ${PQ.plural(np,'paper')}</span><span>${c.est?'Est. ':'Cost '}${np?PQ.usd([c.lo,c.hi]):'US$0'}</span></div>
    ${run?`<div class="pr-run" role="status"><b>${run.status==='running'?'Claude is running the queue':'Sent to Claude'}</b><small>requested ${esc(clockT(run.at))}${run.status==='requested'?' · Claude starts it when importing resumes; later the import API will start it directly.':''}</small><button type="button" class="act" id="prQCancel"${R.busy?' disabled':''}>Cancel</button></div>`:
      `<div class="pr-startrow"><button type="button" class="act primary pr-start" id="prQStart"${!n.length||R.busy?' disabled':''}>Start the queue</button><span class="pr-wait" role="status">${wtxt}</span></div>`}
    <p class="pr-est">${c.est?`Estimate US$${EST[0]}–${EST[1]} a paper`:`${esc(PQ.usd(c.pp))} a paper`}</p>
    <p class="pr-api">Until the import API is connected, this sends the queue to Claude.</p>`}
function render(){if(!isOwnerV())return;subscribe();draw()}
// ---- writes (editors only)
const now=()=>new Date().toISOString();
async function add(list){if(!isOwnerV()||!db)return 0;const have=new Set(R.q.map(x=>x.id));let o=R.q.length?Math.max(...R.q.map(x=>+x.order||0)):0,n=0;
  for(const {key:k,n:b} of list){const f=PQ.batch(k,b);if(!f||!f.b.ready.length||f.b.done)continue;const id=`${k}_${b}`;if(have.has(id))continue;
    const doc={course:f.lane.course,yl:f.lane.yl,batch:+b,order:++o,by:me||null,at:now()};
    try{await db.doc('queue/'+id).set(doc);n++;have.add(id);if(!R.q.some(x=>x.id===id))R.q.push({id,...doc})}catch(_){toast('Could not save. Try again in a moment.');break}}
  if(n){PQ.redraw();draw();toast(`${PQ.plural(n,'batch','batches')} added to the queue`)}return n}
// the lane's next batches that are not queued yet, in lane order
function addNext(k,count){const L=PQ.lanes().find(x=>x.key===k);if(!L)return Promise.resolve(0);
  return add(L.batches.filter(b=>b.ready.length&&!b.done&&!pos(k,b.n)).slice(0,count).map(b=>({key:k,n:b.n})))}
async function setOrder(x,patch){const {id,...rest}=x;try{await db.doc('queue/'+id).set({...rest,...patch});return true}catch(_){toast('Could not save. Try again in a moment.');return false}}
async function move(id,d){if(!isOwnerV()||!db)return;const ids=live().map(i=>i.x.id),i=ids.indexOf(id),j=i+d;if(i<0||j<0||j>=ids.length)return;
  [ids[i],ids[j]]=[ids[j],ids[i]];await writeOrder(R.q,ids.concat(items().filter(i=>i.done).map(i=>i.x.id)),setOrder,()=>{PQ.redraw();draw()})}
async function remove(id){if(!isOwnerV()||!db)return false;try{await db.doc('queue/'+id).delete();R.q=R.q.filter(x=>x.id!==id);PQ.redraw();draw();toast('Removed from the queue');return true}catch(_){toast('Could not remove. Try again in a moment.');return false}}
async function start(){const n=live();if(!isOwnerV()||!db||!n.length||active('queue'))return null;const np=n.reduce((s,i)=>s+i.ready.length,0),c=cost(np);
  const id='r'+Date.now(),doc={kind:'queue',status:'requested',stop_early:STOP_EARLY,queue:n.map(i=>({course:i.x.course,yl:i.x.yl,batch:+i.x.batch,papers:i.ready.map(p=>p.id)})),papers:np,est:[c.lo,c.hi],by:me||null,at:now()};
  try{await db.doc('runs/'+id).set(doc);if(!R.runs.some(r=>r.id===id))R.runs.push({id,...doc});toast('Queue sent to Claude');return id}catch(_){toast('Could not save. Try again in a moment.');return null}}
async function cancel(){const a=active('queue');if(!isOwnerV()||!db||!a)return false;const {id,...rest}=a,doc={...rest,status:'cancelled',cancelled_by:me||null,cancelled_at:now()};
  try{await db.doc('runs/'+id).set(doc);Object.assign(a,doc);toast('Queue run cancelled');return true}catch(_){toast('Could not cancel. Try again in a moment.');return false}}
// Run the cover-page check: a request for Claude (it reads each front page; what it can't settle waits in Needs a check)
const cover=()=>active('cover_check');
async function coverCheck(){const m=PQ.model();if(!isOwnerV()||!db||!m||cover())return null;const ids=m.ps.filter(p=>p.st==='needs_check').map(p=>p.id);if(!ids.length)return null;
  const id='r'+Date.now(),doc={kind:'cover_check',status:'requested',papers:ids,by:me||null,at:now()};
  try{await db.doc('runs/'+id).set(doc);if(!R.runs.some(r=>r.id===id))R.runs.push({id,...doc});PQ.redraw();toast('Cover-page check requested');return id}catch(_){toast('Could not save. Try again in a moment.');return null}}
const busy=async f=>{R.busy=true;draw();try{return await f()}finally{R.busy=false;draw()}};
document.addEventListener('click',async e=>{const t=e.target;if(!t.closest||!t.closest('#invBox')||!isOwnerV())return;
  const mv=t.closest('[data-prqmv]');if(mv){await move(mv.dataset.prqId,+mv.dataset.prqmv);const b=document.querySelector(`#prQueue [data-prq-id="${CSS.escape(mv.dataset.prqId)}"][data-prqmv="${mv.dataset.prqmv}"]`);if(b&&!b.disabled)b.focus();return}
  const dl=t.closest('[data-prqdel]');if(dl){await remove(dl.dataset.prqdel);return}
  if(t.closest('#prQStart')){await busy(start);return}
  if(t.closest('#prQCancel')){await busy(cancel);return}});
// job 6: the Tonight card on Processes › Work lists the requests waiting for the night session, and can withdraw one
const pending=()=>R.runs.filter(r=>r.status==='requested').sort((a,b)=>String(a.at).localeCompare(String(b.at)));
async function drop(id){const r=R.runs.find(x=>x.id===id);if(!isOwnerV()||!db||!r)return false;const {id:_,...rest}=r,doc={...rest,status:'cancelled',cancelled_by:me||null,cancelled_at:now()};
  try{await db.doc('runs/'+id).set(doc);Object.assign(r,doc);PQ.redraw();draw();if(view==='processes')renderProcesses();toast('Removed from tonight');return true}catch(_){toast('Could not remove. Try again in a moment.');return false}}
return {render,draw,state:R,pos,add,addNext,remove,move,start,cancel,cover,coverCheck,items,watch:subscribe,pending,drop};
})();
if(view==='processes'&&$('#processesView').dataset.tab==='papers')PQ.run.render();
