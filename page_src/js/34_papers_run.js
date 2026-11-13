// owner 13 Nov: "We need a general summary at the top of the Paper's tab of processes as well. How many papers found, how many imported, a brief breakdown and stuff. Set it up so that once the API is set up, we can choose a grade 11 or 12 and course Adv / std/ extension 1 and extesnion 2 and hit Go and the API would get called to import all papers which are on file but not imported from that level and grade. Is that the best way ? I'm getting CONFUSED with our current papers page" -> chose "Yes, with batch pauses"
/* ---------- Papers: summary, Import a course (Go), Running / next (Processes › Papers, Curate: editors only) ----------
   Summary (#ivStats): imported / can be imported (current and old syllabus) / set aside (other courses, Year 11 held, course not
   known yet, not in scope), counted from data/inventory.json by ONE rule, kind() below; the page test recounts them.
   Import a course (#ivGo): Year and Course selects (years from the grid's, courses from the inventory: CODE_HEALTH rule 5), the
   papers not imported yet with their split, batches of 9, a cost range (inventory cost_per_paper, else an estimate of US$12–17 a
   paper), or why it can't run (course not set up; Year 11 held). Go asks inline (no confirm()), Confirm writes ONE run request
   to db collection "runs": {year, course, papers:[doc ids in import order], batch_size:9, pause_after_each_batch:true,
   status:'requested', by, at}. One active run at a time (requested / running / paused); Cancel request sets status 'cancelled'.
   Claude reads it with tools/import_next.py (it takes precedence over the import order) and sets status as the run goes;
   after each batch the run waits until the owner has cleared that batch's Review track (IMPORT_PLAYBOOK "Go").
   Running / next (#ivRun): the active run, then the next batches (from the run, else from the import order).
   No new page-wide name: PQ.run (as PQ.scan). Only editors write: every handler checks isEditor(). */
PQ.run=(()=>{
const R={runs:[],sub:null,yl:'12',course:null,ask:false,busy:false};
const ACTIVE=['requested','running','paused'];
// owner 13 Nov ("Yes, with batch pauses"): until a cost per paper is measured, show US$12–17 a paper, labelled an estimate
const EST=[12,17];
const nf=x=>Number(x||0).toLocaleString('en-AU');
const ess=(k,w,ws)=>`${nf(k)} ${k===1?w:(ws||w+'s')}`;
// owner 13 Nov: "Year 11 papers leave alone for now, would like to finalise Y12 first"
const HELD='held until Year 12 is finished (your 13 Nov ruling)';
// the one rule that sorts a paper into the summary's buckets
function kind(p,g){if(p.st==='imported')return 'imported';if(p.pick)return p.old?'old':'current';if(p.st==='out_of_course')return 'course';
  if(g.yl==='11'&&(p.st==='waiting'||/^Year 11\b/.test(p.why||'')))return 'held';return p.st==='waiting'?'check':'scope'}
function tally(gs){const t={imported:0,current:0,old:0,course:0,held:0,check:0,scope:0};for(const g of gs)for(const p of g.papers)t[kind(p,g)]++;return t}
const active=()=>R.runs.filter(r=>ACTIVE.includes(r.status)).sort((a,b)=>String(b.at).localeCompare(String(a.at)))[0]||null;
const courses=()=>((PQ.state.data&&PQ.state.data.courses)||[]).filter(c=>c.key!=='unknown');   // "Course not known" is not a course you can pick
const ylName=yl=>PQ.years[yl]||'Year '+yl;
function subscribe(){if(R.sub||!db||!isEditor())return;
  try{R.sub=db.collection('runs').onSnapshot(s=>{const d=s.docs||s;R.runs=(d||[]).map(x=>({id:x.id,...(typeof x.data==='function'?x.data():x.data)})).filter(x=>x&&x.status);draw()},()=>{})}catch(e){}}
// ---- the chosen year x course: its papers not imported yet (in import order), the split, and why Go can't run
function choice(){const c=PQ.course(R.course),g=PQ.groups().find(x=>x.course===R.course&&x.yl===R.yl),ps=g?g.papers:[];
  const can=ps.filter(p=>p.pick),held=g?ps.filter(p=>kind(p,g)==='held').length:0;
  // papers already in the import order keep the owner's order; then current syllabus before old, newest year first
  const pos=new Map(PQ.rows().map((r,i)=>[+r.x.doc_id,i])),at=p=>pos.has(p.id)?pos.get(p.id):1e9;
  const list=can.slice().sort((a,b)=>at(a)-at(b)||(a.old?1:0)-(b.old?1:0)||(b.y||0)-(a.y||0)||a.id-b.id);
  const why=!c.ready?c.note||'needs course setup':!can.length&&held?HELD:!can.length?`nothing left to import in ${ylName(R.yl)} ${c.short||c.name}`:'';
  return {c,list,old:can.filter(p=>p.old).length,held,all:ps.length,why}}
function cost(n){const v=PQ.cost(),e=!v,pp=v||EST;return {pp,est:e,lo:n*pp[0],hi:n*pp[1]}}
// ---- summary
function stats(){const el=$('#ivStats');if(!el)return;const D=PQ.state.data;if(!D){el.innerHTML='';return}
  const t=tally(PQ.groups()),can=t.current+t.old,aside=t.course+t.held+t.check+t.scope;
  const part=[[t.course,'in other courses that need setup'],[t.held,'Year 11, held until Year 12 is finished'],[t.check,'course not known yet (cover check)'],[t.scope,'not in scope']].filter(x=>x[0]);
  el.innerHTML=`<div class="ivstat" data-k="imported"><b>${nf(t.imported)}</b><span>imported</span><small>in the bank</small></div>
    <div class="ivstat" data-k="can"><b>${nf(can)}</b><span>can be imported</span><small>${nf(t.current)} current syllabus · ${nf(t.old)} old syllabus</small></div>
    <div class="ivstat" data-k="aside"><b>${nf(aside)}</b><span>set aside</span><small>${part.map(([k,w])=>`<i>${nf(k)} ${esc(w)}</i>`).join('')}</small></div>`}
// ---- Import a course
function goCard(){const el=$('#ivGo');if(!el||!PQ.state.data)return;
  const C=courses();if(!R.course||!C.some(c=>c.key===R.course))R.course=(C.find(c=>c.ready)||C[0]||{}).key;
  if(!el.dataset.ready){el.dataset.ready='1';
    el.innerHTML=`<h4>Import a course</h4><div class="ivgorow"><label>Year <select id="ivGoY">${Object.keys(PQ.years).filter(y=>y!=='?').sort((a,b)=>b-a).map(y=>`<option value="${esc(y)}">${esc(y)}</option>`).join('')}</select></label>
      <label>Course <select id="ivGoC">${C.map(c=>`<option value="${esc(c.key)}">${esc(c.short||c.name)}</option>`).join('')}</select></label>
      <button type="button" class="act primary ivgob" id="ivGoBtn">Go</button></div><div id="ivGoN" aria-live="polite"></div><div id="ivGoAsk"></div>`;
    $('#ivGoY').value=R.yl;$('#ivGoC').value=R.course}
  const k=choice(),n=k.list.length,a=active(),cc=cost(n),btn=$('#ivGoBtn');
  const block=k.why||(a?'a run is already requested: cancel it under Running / next to start another':'');
  btn.disabled=!!block||R.busy;btn.title=block;
  $('#ivGoN').innerHTML=k.why?`<p class="ivgocount off"><b>${nf(k.all)}</b> ${ylName(R.yl)} ${esc(k.c.short||k.c.name)} paper${k.all===1?'':'s'} in the folder</p><p class="ivgowhy">Can't import: ${esc(k.why)}</p>`:
    `<p class="ivgocount"><b>${nf(n)}</b> not imported</p><p class="ivgod">${nf(n-k.old)} current syllabus · ${nf(k.old)} old syllabus</p>
     <p class="ivgod">${ess(Math.ceil(n/PQ.batch),'batch','batches')} of ${PQ.batch}, pausing after each one until you've cleared it in Review</p>
     <p class="ivgod ivgocost">${cc.est?'Estimated cost':'Cost'} ${PQ.usd([cc.lo,cc.hi])} <small>(${cc.est?'estimate, ':''}${PQ.usd(cc.pp)} a paper)</small></p>${a?`<p class="ivgowhy">${esc(block)}</p>`:''}`;
  const ask=$('#ivGoAsk');if(!R.ask||block){R.ask=false;ask.innerHTML='';return}
  if(!ask.firstChild)ask.innerHTML=`<div class="ivgoask" role="group" aria-label="Confirm"><p>Start importing ${ess(n,'paper')}, ~${PQ.usd([cc.lo,cc.hi])}?</p><button type="button" class="act primary" id="ivGoYes">Confirm</button><button type="button" class="act" id="ivGoNo">Cancel</button></div>`}
// ---- Running / next
const STATUS={requested:['Requested','Requested — Claude starts it when importing resumes; later the import API will start it directly.'],
  running:['Running','Claude is importing it now.'],paused:['Paused','Waiting for you to clear the last batch in Review before the next one starts.']};
function runCard(){const el=$('#ivRun');if(!el)return;const a=active(),B=PQ.batch;
  // the next papers: from the active run (skipping any imported since), else from the owner's import order
  let ids;if(a)ids=(a.papers||[]).filter(id=>{const f=PQ.find(id);return f&&f.p.pick});else ids=PQ.rows().filter(r=>!r.warn).map(r=>+r.x.doc_id);
  const b0=PQ.nextBatch(),nb=Math.ceil(ids.length/B),show=[0,1].filter(i=>i<nb);
  const card=a?(s=>`<div class="ivrcard" data-run="${esc(a.id)}"><div class="ivrtop"><b>${esc(ylName(String(a.year)))} ${esc(PQ.course(a.course).short||a.course)} · ${ess((a.papers||[]).length,'paper')}</b><span class="ivchip q">${esc(s[0])}</span></div>
      <p>${esc(s[1])}</p><small>${ess(Math.ceil((a.papers||[]).length/(a.batch_size||B)),'batch','batches')} of ${a.batch_size||B}${a.pause_after_each_batch?', a pause after each':''} · requested ${esc(clockT(a.at))}</small>
      <button type="button" class="act" id="ivRunCancel"${R.busy?' disabled':''}>Cancel request</button></div>`)(STATUS[a.status]||[a.status,'']):'';
  const name=id=>{const f=PQ.find(id);return f?PQ.label(f.p)+(f.p.old?' · old syllabus':''):'Paper '+id};
  const next=show.map(i=>`<div class="ivnb"><p class="ivdiv" role="separator"><span>Batch ${b0+i}</span></p><ol>${ids.slice(i*B,i*B+B).map(id=>`<li>${esc(name(id))}</li>`).join('')}</ol></div>`).join('');
  el.innerHTML=`<h4>Running / next</h4>${card}${ids.length?`<p class="ivnfrom">Next ${a?'from this run':'from your import order'}:</p>${next}${nb>2?`<p class="ivnmore">… and ${ess(nb-2,'more batch','more batches')}</p>`:''}`:
    a?'':`<p class="pempty">Nothing requested yet. Pick a year and course above and press Go, or choose papers one by one.</p>`}`}
function draw(){if(!isEditor()||!$('#ivGo'))return;stats();goCard();runCard()}
function render(){if(!isEditor())return;subscribe();draw()}
// ---- writes (editors only)
async function request(){const k=choice(),n=k.list.length;if(!isEditor()||!db||k.why||active()||!n)return null;
  const id='r'+Date.now(),doc={year:+R.yl,course:R.course,papers:k.list.map(p=>p.id),batch_size:PQ.batch,pause_after_each_batch:true,status:'requested',by:me||null,at:new Date().toISOString()};
  try{await db.doc('runs/'+id).set(doc);if(!R.runs.some(r=>r.id===id))R.runs.push({id,...doc});toast(`Requested: ${ess(n,'paper')}`);return id}catch(_){toast('Could not save. Try again in a moment.');return null}}
async function cancel(){const a=active();if(!isEditor()||!db||!a)return false;const {id,...rest}=a,doc={...rest,status:'cancelled',cancelled_by:me||null,cancelled_at:new Date().toISOString()};
  try{await db.doc('runs/'+id).set(doc);Object.assign(a,doc);toast('Run request cancelled');return true}catch(_){toast('Could not cancel. Try again in a moment.');return false}}
const busy=async f=>{R.busy=true;draw();try{return await f()}finally{R.busy=false;draw()}};
document.addEventListener('change',e=>{const t=e.target;if(t.id!=='ivGoY'&&t.id!=='ivGoC')return;if(t.id==='ivGoY')R.yl=t.value;else R.course=t.value;R.ask=false;draw()});
document.addEventListener('click',async e=>{const t=e.target;if(!t.closest||!t.closest('#invBox')||!isEditor())return;
  if(t.closest('#ivGoBtn')){R.ask=true;draw();const y=$('#ivGoYes');if(y)y.focus();return}
  if(t.closest('#ivGoNo')){R.ask=false;draw();$('#ivGoBtn').focus();return}
  if(t.closest('#ivGoYes')){R.ask=false;await busy(request);return}
  if(t.closest('#ivRunCancel')){await busy(cancel);return}});
return {render,draw,state:R,tally,kind,request,cancel,choice};
})();
if(view==='processes'&&$('#processesView').dataset.tab==='papers')PQ.run.render();
