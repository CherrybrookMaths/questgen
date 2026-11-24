// owner 14 Nov (mockup A of three): "I like A's design much more" — course lanes, a batch panel, one queue
// owner 14 Nov: "there seems to be some inconsistencies in paper numbers" — one status per paper, every number from one list
// owner 13 Nov: "New exams are gonna be added to this folder periodically we need a way to ... see what we actually haven't ingested yet"
/* ---------- Processes › Papers (Curate: editors only) ----------
   data/inventory.json (tools/inventory.py) gives every paper in the shared folder ONE status (st): imported, ready_current,
   ready_old, needs_check, held_y11, held_course, not_in_scope, duplicate. Every number on this tab is a count of that one list,
   in papers (files only in the top line), so the summary's four numbers add up to the folder total.
   Top to bottom: the top line (papers in the folder, last scan, new since the baseline scan, Rescan drive: PQ.scan,
   33_drive_scan.js), the summary (imported · ready to import · need a check · held or not in scope), then two panels:
   - Courses (#prLanes): one lane per course + year level with ready papers (inventory "lanes", tools/batches.py: each ready
     paper sits in a fixed numbered batch of 9, assigned once). A square per batch (imported / in the queue / ready, current
     syllabus / ready, old syllabus); a click opens the batch panel (its papers, Swap). +1 batch, +2 batches and Queue all add
     the lane's next batches that are not queued yet. Then the Needs a check lane (Run the cover-page check; Resolve opens
     #processes/papers/check, PQ.check in 35_papers_check.js), the locked courses folded into one row, and the legend.
   - Queue (#prQueue): PQ.run (34_papers_run.js).
   Review state (owner 14 Nov: "I would like to see how many of the batches have cleared checks on the import page too, its good
   to know"): an imported batch is "cleared review" when every one of its papers has finished Review's flow, else "imported,
   waiting for review". A paper's state is Review's own per-paper track (08_review.js paperWork: every step done, no open Your
   calls), which reads the reviews through RKEY, so key docs (reviews/k_<key>, p_<paper key>, Fix 2) count; nothing here
   re-implements it (CODE_HEALTH rule 3). The reviews subscription (14_start.js) redraws this tab, so it updates live.
   Swap (owner's mockup: "Swap moves the paper to the end of the course and pulls the next one in") is db collection "batches",
   one doc per lane ('advanced_12'): {course, yl, swaps: [{id, by, at}]}; swapsApply below = tools/batches.py apply_swaps.
   The proposed path-rule fixes (tools/classify_paths.py RULES_PROPOSED) and the owner's answers in Needs a check (db paperfix)
   apply here at once (model()), before Claude rebuilds the inventory: the inventory carries both outcomes (proposed).
   One page-wide name, PQ (CODE_HEALTH rule 1); PQ.scan, PQ.run and PQ.check hang off it. Only editors read or write. */
const PQ=(()=>{
const S={data:null,loading:false,failed:false,acc:null,fix:{},swaps:{},subs:{},open:null,busy:false};
const YN={'12':'Year 12','11':'Year 11','?':'Year ?'};
const READY=['ready_current','ready_old'];
const SIZE=9;
const nf=x=>Number(x||0).toLocaleString('en-AU');
const plural=(n,w,ws)=>`${nf(n)} ${n===1?w:(ws||w+'s')}`;
const ord=n=>n+(['th','st','nd','rd'][(n%100-20)%10]||['th','st','nd','rd'][n%100]||'th');
const label=p=>p.l||(p.t==='HSC'?`${p.y} NESA HSC`:`${p.y} ${p.s} ${p.t}`);
const courses=()=>(S.data&&S.data.courses)||[];
const course=k=>courses().find(c=>c.key===k)||{key:k,name:k,ready:false};
const short=k=>course(k).short||course(k).name||k;
// a lane's name, e.g. "Year 12 Advanced" (course names come from the inventory: CODE_HEALTH rule 5)
const laneName=(c,yl)=>c==='unknown'?(yl==='?'?'Course and year not known':`${YN[yl]}, course not known`):yl==='?'?`${short(c)}, year not known`:`${YN[yl]} ${short(c)}`;
const laneKey=(c,yl)=>c+'_'+(yl==='?'?'x':yl);
const yrs=ps=>{const y=ps.map(p=>p.y).filter(Boolean);if(!y.length)return '';const a=Math.min(...y),b=Math.max(...y);return a===b?String(a):`${a}–${String(b).slice(-2)}`};
const snap=QG.docs;

// ---- loading (editors only: a viewer never fetches the inventory or subscribes)
// rv: Review's Inbox asks for the batches (batchOf), so an editor who is not the owner (the checker) fetches it too; a viewer never does
function load(rv){if(S.data||S.loading||!(isOwnerV()||rv&&isEditor()))return;S.loading=true;
  fetch('data/inventory.json?v='+Date.now()).then(r=>r.ok?r.json():null).then(d=>{S.data=d&&Array.isArray(d.groups)?d:null;S.failed=!S.data})
    .catch(()=>{S.failed=true}).finally(()=>{S.loading=false;if(view==='processes')render();else if(view==='inbox'&&S.data)renderInbox()})}
function subscribe(){if(!db||!isOwnerV())return;
  const on=(k,f)=>{if(S.subs[k])return;try{S.subs[k]=f()}catch(e){}};
  on('fix',()=>db.collection('paperfix').onSnapshot(s=>{S.fix={};snap(s).forEach(x=>{if(Number.isFinite(+x.id))S.fix[+x.id]=x});redraw()},()=>{}));
  on('swaps',()=>db.collection('batches').onSnapshot(s=>{S.swaps={};snap(s).forEach(x=>{S.swaps[x.id]=Array.isArray(x.swaps)?x.swaps:[]});redraw();if(API.run)API.run.draw()},()=>{}));
  on('acc',()=>db.doc('scans/rules').onSnapshot(d=>{S.acc=d&&d.exists?QG.val(d):null;redraw()},()=>{}))}

// ---- the proposed rule fixes: accepted in the page db (scans/rules) or already in the inventory
function accepted(){const pr=S.data&&S.data.proposed;if(!pr)return false;if(pr.accepted)return true;const a=S.acc;return !!(a&&a.accepted&&a.version===pr.version)}
// the rules a new Drive file is classified with (33_drive_scan.js): the inventory's, or the proposed set once accepted here
function rules(){const D=S.data;if(!D)return null;const pr=D.proposed;return pr&&!pr.accepted&&accepted()&&pr.rules_after?pr.rules_after:D.rules}
// a paper the owner placed: the same decisions as tools/inventory.py status_of
function placedStatus(c,yl,y){const C=course(c);
  if(c!=='unknown'&&!C.ready)return 'held_course';if(yl==='11')return 'held_y11';if(c==='unknown'||yl==='?'||!y)return 'needs_check';
  const old=(S.data.rules&&S.data.rules.old_syllabus_before)||2020;return y<old?'ready_old':'ready_current'}

// ---- the one list every number comes from (memoised on the inventory, the Accept and the owner's answers)
let M=null;
function model(){const D=S.data;if(!D)return null;const k=accepted()+'|'+JSON.stringify(S.fix);if(M&&M.D===D&&M.k===k)return M;
  let ps=[];for(const g of D.groups)for(const p of g.papers)ps.push({...p,c:g.course,yl:g.yl});
  const pr=D.proposed;
  if(pr&&!pr.accepted&&accepted()){const rm=new Set(pr.replace||[]);ps=ps.filter(p=>!rm.has(p.id));
    for(const [gk,xs] of Object.entries(pr.papers||{})){const [c,yl]=gk.split('|');xs.forEach(p=>ps.push({...p,c,yl}))}}
  for(const p of ps){const f=S.fix[p.id];if(!f||p.st!=='needs_check')continue;
    if(f.out){p.st='not_in_scope';p.why='you set it aside';p.mine=1}
    else if((f.yl===11||f.yl===12)&&f.course){p.c=f.course;p.yl=String(f.yl);if(!p.y&&f.y)p.y=f.y;p.st=placedStatus(p.c,p.yl,p.y);p.mine=1}}
  const t={};(D.statuses?Object.keys(D.statuses):[]).forEach(s=>t[s]=0);ps.forEach(p=>{t[p.st]=(t[p.st]||0)+1});
  return M={D,k,ps,t,total:ps.length,byId:new Map(ps.map(p=>[p.id,p]))}}

// ---- review state (owner 14 Nov: "I would like to see how many of the batches have cleared checks on the import page too")
// 'cleared' | 'waiting' for an imported paper, from Review's own paperWork (08_review.js) on each file that has questions in the
// bank index; null until the index and the question details (job 2) have loaded. Memoised on the reviews map and the index (both replaced, never mutated).
const RV={rv:null,b:null,m:new Map()};
function reviewState(p){if(!B||!B.questions||!QG.detOK||typeof paperWork!=='function')return null;   // job 2: Review's work counts read triage, which comes with the details
  if(RV.rv!==reviews||RV.b!==B){RV.rv=reviews;RV.b=B;RV.m=new Map()}
  // owner 18 Nov (screenshot: Batch 11 "7 of 7 cleared review" mid-import): a paper mid-import (inventory imp, tools/import_hold.py) is
  // importing, and a paper with no questions in the bank is never cleared
  if(p.imp)return 'importing';
  if(!RV.m.has(p.id)){const fs=(p.f||[p.id]).filter(d=>B.docs[d]&&B.questions.some(q=>q.doc===d));
    RV.m.set(p.id,fs.length&&fs.every(d=>paperWork(d).n===0)?'cleared':'waiting')}
  return RV.m.get(p.id)}
// a batch of imported papers: cleared when every paper is (a paper not found stays waiting)
const batchState=ps=>ps.length&&ps.every(p=>reviewState(p)==='cleared')?'clr':'wait';
// every imported batch on the tab: [{key, n, st}] (finished batches and lane batches whose papers are all imported)
function imported(){const m=model();if(!m)return [];return lanes().flatMap(L=>[...L.done.map(d=>({key:L.key,n:d.n,ps:d.ids.map(i=>m.byId.get(i)).filter(Boolean)})),
  ...L.batches.filter(b=>b.done).map(b=>({key:L.key,n:b.n,ps:b.ps}))]).map(x=>({...x,st:batchState(x.ps)}))}
// owner 14 Nov: "Maybe remove the lock for now since I'm in charge of import": the waiting count is shown as information only
const waiting=()=>imported().filter(x=>x.st==='wait').length;

// ---- lanes and batches
// Swap: the paper leaves its batch for the end of the lane; every later batch passes its first paper back one batch, so each
// batch keeps its size and number. A batch with an imported paper is fixed (skipped). Same as tools/batches.py apply_swaps.
function swapsApply(bs,sw,fixed){const B=bs.map(b=>b.slice()),sizes=B.map(b=>b.length),frozen=b=>b.some(i=>fixed.has(i));
  for(const s of sw||[]){const i=s&&typeof s==='object'?s.id:s,k=B.findIndex(b=>b.includes(i));if(k<0||frozen(B[k]))continue;
    const idx=[];for(let j=k;j<B.length;j++)if(!frozen(B[j]))idx.push(j);
    const flat=idx.flatMap(j=>B[j]).filter(x=>x!==i).concat(i);let o=0;for(const j of idx){B[j]=flat.slice(o,o+sizes[j]);o+=sizes[j]}}
  return B}
// every lane, also one with nothing left to import (batchOf needs its finished batches); lanes() keeps the ones the tab shows
function allLanes(){const m=model();if(!m)return [];const imp=new Set(m.ps.filter(p=>p.st==='imported').map(p=>p.id));
  return (m.D.lanes||[]).map(L=>{const key=laneKey(L.course,L.yl),bs=swapsApply(L.batches||[],S.swaps[key],imp);
    const batches=bs.map((ids,k)=>{const ps=ids.map(i=>m.byId.get(i)).filter(Boolean),ready=ps.filter(p=>READY.includes(p.st)&&p.c===L.course&&p.yl===L.yl);
      const n=L.first+k,done=ps.some(p=>p.st==='imported')&&ps.every(p=>p.st==='imported'||p.st==='not_in_scope'||p.st==='duplicate');   // owner 25 Nov (Standard "3 batches imported" after 10 were): a file the import found is not a paper of this course (answer sheet, Advanced paper, copy) no longer keeps its batch from counting as imported
      return {n,ids,ps,ready,done,frozen:ps.some(p=>p.st==='imported'),cur:ready.some(p=>p.st==='ready_current'),key}});
    const inLane=m.ps.filter(p=>p.c===L.course&&p.yl===L.yl),batched=new Set(bs.flat());
    return {...L,key,name:laneName(L.course,L.yl),batches,done:L.done||[],imported:inLane.filter(p=>p.st==='imported').length,
      // big PDFs (over 10 MB, owner 18 Nov) are ready but out of the batches: counted apart, so to go + big = the summary's ready
      ready:inLane.filter(p=>READY.includes(p.st)&&!p.big).length,big:inLane.filter(p=>READY.includes(p.st)&&p.big).length,unbatched:inLane.filter(p=>READY.includes(p.st)&&!p.big&&!batched.has(p.id)).length,
      newN:inLane.filter(p=>p.new).length}})}
const lanes=()=>allLanes().filter(L=>L.ready||L.batches.some(b=>b.ready.length));
// owner 17 Nov: "Review: group 'Papers to review' by batch, oldest first ('Batch 4 · 7 of 9 cleared'); papers waiting on a Your call
// marked as such. Ordered, not locked." Review's Inbox reads this: doc id (string) -> {key, n, name, o (lane order)} for every
// imported paper in a numbered batch (finished batches and lane batches); null until the inventory has loaded. A swap never moves
// an imported paper (swapsApply skips a batch that holds one), so the checker, who has no swaps subscription, gets the same map.
let BO=null;
function batchOf(){if(!S.data){if(!S.failed)load(true);return null}const m=model();if(BO&&BO.m===m)return BO.map;const map=new Map();
  allLanes().forEach((L,o)=>{const put=(n,ids)=>ids.forEach(i=>{const p=m.byId.get(i);if(p&&p.st==='imported')(p.f||[p.id]).forEach(d=>map.set(String(d),{key:L.key,n,name:L.name,o}))});
    L.done.forEach(d=>put(d.n,d.ids||[]));L.batches.forEach(b=>put(b.n,b.ids))});
  BO={m,map};return map}
// one batch of a lane: {lane, b} (PQ.run reads it for the queue)
function batch(key,n){const L=lanes().find(x=>x.key===key);const b=L&&L.batches.find(x=>x.n===+n);return b?{lane:L,b}:null}

// ---- drawing
function sub(){const el=$('#ivSub');if(!el)return;const D=S.data,m=model();
  if(!D){el.textContent=S.failed?'The paper list could not be loaded.':'Loading the paper list…';return}
  const ls=D.last_scan,ds=API.scan&&API.scan.last(),dl=ds&&(!ls||Date.parse(ds.at)>Date.parse(ls.at));   // a Drive rescan later than the folder scan wins
  el.textContent=`${nf(m.total)} papers in the shared folder (${nf(D.docs)} files) · `+(dl?`last scan ${clockT(ds.at)}, ${ds.n} new since`:ls?`last scan ${clockT(ls.at)} · ${nf(m.ps.filter(p=>p.new).length)} new since`:'no folder scan yet')}
// the summary: four numbers, one bucket per status, adding up to the folder total
const AREAS=[['imported',['imported']],['ready',READY],['check',['needs_check']],['aside',['held_y11','held_course','not_in_scope','duplicate']]];
function tiles(){const el=$('#prSum');if(!el)return;const m=model();if(!m){el.innerHTML='';return}
  const n=k=>AREAS.find(a=>a[0]===k)[1].reduce((s,x)=>s+(m.t[x]||0),0),L=lanes();
  const what={imported:'imported',ready:'ready to import'+(L.length?' · '+L.map(x=>x.name).join(', '):''),check:'need a check (year or course unknown)',aside:'held or not in scope'};
  el.innerHTML=AREAS.map(([k])=>`<div class="pr-tile" data-k="${k}"><b>${nf(n(k))}</b><span>${esc(what[k])}</span></div>`).join('')}
// owner 14 Nov: imported squares split into cleared review (solid green) and imported, waiting for review (pale, green border)
const SQW={clr:'imported, cleared review',wait:'imported, waiting for review',queued:'in the queue',cur:'ready, current syllabus',old:'ready, old syllabus'};
function sqState(b){if(b.done)return batchState(b.ps);if(API.run&&API.run.pos(b.key,b.n))return 'queued';return b.cur?'cur':'old'}
// a paper's chip in the batch panel: its review state, with a link into Review when it is still waiting
function rvChip(p){const s=reviewState(p);if(s==='importing')return '<span class="pr-chip" title="Being imported: not in the bank yet">Importing</span>';if(s==='cleared')return '<span class="pr-chip ok">Cleared review</span>';
  const d=(p.f||[p.id]).find(x=>B&&B.docs[x]);return s==='waiting'&&d!=null?`<a class="pr-chip pr-wt" href="#review/paper/${esc(mainDoc(d))}">Waiting for review</a>`:'<span class="pr-chip ok">Imported</span>'}
function laneHTML(L){const open=S.open&&S.open.key===L.key?S.open.n:null,todo=L.batches.filter(b=>b.ready.length),m=model();
  const free=todo.filter(b=>!(API.run&&API.run.pos(L.key,b.n))).length,im=imported().filter(x=>x.key===L.key),clr=im.filter(x=>x.st==='clr').length;
  const sq=L.done.map(d=>{const s=batchState(d.ids.map(i=>m.byId.get(i)).filter(Boolean)),t=`Batch ${d.n}, ${SQW[s]}`;
      return `<button type="button" class="pr-b ${s}${open===d.n?' on':''}" data-prb="${esc(L.key)}:${d.n}" title="${esc(t)}" aria-label="${esc(t)}" aria-expanded="${open===d.n}"></button>`}).join('')+
    L.batches.filter(b=>b.ready.length||b.done).map(b=>{const s=sqState(b),t=`Batch ${b.n}, ${SQW[s]}`;
      return `<button type="button" class="pr-b ${s}${open===b.n?' on':''}" data-prb="${esc(L.key)}:${b.n}" title="${esc(t)}" aria-label="${esc(t)}" aria-expanded="${open===b.n}"></button>`}).join('');
  return `<div class="pr-lane" data-lane="${esc(L.key)}"><div class="pr-lrow"><div class="pr-lname"><b>${esc(L.name)}</b>
      <small>${plural(im.length,'batch','batches')} imported (${nf(clr)} cleared review, ${im.length-clr?`<a href="#review" title="Review lists the papers still waiting">${nf(im.length-clr)} waiting</a>`:'0 waiting'}) · <span title="Ready papers in the batch squares below (one square per batch)">${nf(L.ready)} papers to go · ${plural(todo.length,'batch','batches')}</span>${L.unbatched?` · ${nf(L.unbatched)} wait for a batch`:''}${L.big?` · <a href="#prBig" data-prbig title="Over the ${PQ.bigMB()} limit: out of the batches until a smaller copy exists">${plural(L.big,'big PDF')}, for later</a>`:''}${L.newN?` · <span title="Papers first found after the first full Drive scan${S.data?.baseline_scan?` (${esc(new Date(S.data.baseline_scan).toLocaleDateString('en-AU',{day:'numeric',month:'short'}))})`:''}, in every status">${nf(L.newN)} found after the first scan</span>`:''}</small></div>
    <div class="pr-lacts"><button type="button" class="act" data-pradd="1" data-lane="${esc(L.key)}"${free?'':' disabled'}>+1 batch</button><button type="button" class="act" data-pradd="2" data-lane="${esc(L.key)}"${free>1?'':' disabled'}>+2 batches</button><button type="button" class="act primary" data-pradd="all" data-lane="${esc(L.key)}"${free?'':' disabled'}>Queue all ${nf(free)}</button></div></div>
    <div class="pr-sq" role="group" aria-label="${esc(L.name)} batches">${sq}</div>${open!=null?panelHTML(L,open):''}</div>`}
// the batch panel: its papers and Swap
function panelHTML(L,n){const d=L.done.find(x=>x.n===n),b=L.batches.find(x=>x.n===n),m=model();
  const rvs=ps=>{const c=ps.filter(p=>reviewState(p)==='cleared').length;return `${nf(c)} of ${nf(ps.length)} cleared review`};
  if(d){const ps=d.ids.map(i=>m.byId.get(i)).filter(Boolean);
    return `<div class="pr-panel" role="region" aria-label="Batch ${n}"><div class="pr-phead"><b>Batch ${n}</b><span>${plural(d.ids.length,'paper')} · imported (${esc(d.id)}) · ${rvs(ps)}</span><button type="button" class="pr-x" data-prclose aria-label="Close batch">×</button></div>
    <ul class="pr-plist">${ps.map(p=>`<li><span>${esc(label(p))}</span>${rvChip(p)}</li>`).join('')}</ul></div>`}
  if(!b)return '';const q=API.run?API.run.pos(L.key,n):0,ready=new Set(b.ready.map(p=>p.id));
  const sp=b.done?b.ps:b.ready,isOld=p=>p.st==='ready_old'||p.old;   // an imported batch describes its papers (it has none ready)
  const syl=sp.every(isOld)?'old syllabus':sp.some(isOld)?'current and old syllabus':'current syllabus';
  const where=b.done?(b.ps.some(p=>p.imp)?'importing (not in the bank yet)':`imported · ${rvs(b.ps)}`):q?`in the queue, ${ord(q)}`:'not in the queue',gone=b.ps.filter(p=>!ready.has(p.id)&&p.st!=='imported');
  const last=L.batches.length?L.batches[L.batches.length-1].n:n;
  return `<div class="pr-panel" role="region" aria-label="Batch ${n}"><div class="pr-phead"><b>Batch ${n}</b><span>${plural(sp.length,'paper')} · ${syl} · ${esc(yrs(sp))} · ${where}${gone.length?` · ${gone.length} no longer ready`:''}</span>
      ${!q&&!b.done&&b.ready.length?`<button type="button" class="act" data-prqone="${esc(L.key)}:${n}">Add to the queue</button>`:''}<button type="button" class="pr-x" data-prclose aria-label="Close batch">×</button></div>
    <ul class="pr-plist">${b.ps.map(p=>{const r=ready.has(p.id);return `<li${r?'':' class="off"'}><span title="${esc(label(p))}">${esc(label(p))}</span>${p.st==='ready_old'?'<span class="pr-chip">old</span>':''}${p.st==='imported'?rvChip(p):''}${r&&!b.frozen?`<button type="button" class="act pr-swap" data-prswap="${p.id}" data-lane="${esc(L.key)}">Swap</button>`:''}${!r&&p.st!=='imported'?`<span class="pr-chip">${esc((m.D.statuses||{})[p.st]||p.st)}</span>`:''}</li>`}).join('')}</ul>
    <p class="pr-note">Swap moves the paper to the end of the course and pulls the next one in. A batch keeps its papers; new papers from a rescan start new batches after Batch ${last}.</p></div>`}
// owner 18 Nov: "if the pdf is too big, just move it somewhere else for later (big pdfs)": ready papers whose PDF is over the Drive
// connector's 10 MB limit (inventory big, MB) are kept out of the batches (tools/batches.py) and listed here until a smaller copy exists
function bigHTML(m){const ps=m.ps.filter(p=>p.big&&(p.st==='ready_current'||p.st==='ready_old'));if(!ps.length)return '';
  return `<details class="pr-lock" id="prBig"><summary>Big PDFs, for later · ${plural(ps.length,'paper')}</summary><p class="muted pr-note">Over the Drive connector's ${PQ.bigMB()} limit, so an import cannot fetch them. They are out of the batches; a smaller copy of the same paper (or a split file) puts one back in a new batch.</p><ul>${ps.sort((a,b)=>b.big-a.big).map(p=>`<li><b>${esc(label(p))}</b><span>${p.big} MB</span></li>`).join('')}</ul></details>`}
// the locked courses, folded into one row (owner 13 Nov: Year 11 held; the other courses need setup)
function lockedHTML(m){const by=new Map();m.ps.filter(p=>p.st==='held_y11'||p.st==='held_course').forEach(p=>{const k=p.c+'|'+p.yl;if(!by.has(k))by.set(k,{c:p.c,yl:p.yl,n:0,st:p.st});by.get(k).n++});
  const rows=[...by.values()].sort((a,b)=>b.n-a.n),tot=rows.reduce((s,r)=>s+r.n,0);if(!rows.length)return '';
  const nc=new Set(rows.map(r=>r.st==='held_y11'?'y11':r.c)).size;   // courses as the mockup counts them: Year 11 (held) + each course that needs setup
  const why=r=>r.st==='held_y11'?'Held until Year 12 is finished':'Needs course setup';
  return `<details class="pr-lock" id="prLock"><summary>Locked · ${plural(nc,'course')}, ${plural(tot,'paper')}</summary><ul>${rows.map(r=>`<li><b>${esc(laneName(r.c,r.yl))}</b><span>${plural(r.n,'paper')}</span><span class="pr-why" title="${esc(r.st==='held_y11'?m.D.statuses.held_y11:course(r.c).note||'')}">${esc(why(r))}</span></li>`).join('')}</ul></details>`}
// owner 16 Nov: "Where does point 13 exist?", "I want it now", "duplicate exams will never be batched and imported right?" Copies (same size
// in bytes and a similar name as a recorded file; tools/scan_folder.py) are kept out of every paper's files (tools/inventory.py
// held); this lists them beside their original with both Drive links, plus the last scan's moved and missing files
function copiesHTML(m){const H=m.D.held||{},cp=H.copies||[],mv=H.moved||[],ms=H.missing||[];if(!cp.length&&!mv.length&&!ms.length)return '';
  // owner 16 Nov (screenshot): "can't tell anything from it just looks like a SUPER long list": the verdict first, each part folded,
  // one line per file: the paper you know, where the file sits, the links
  const dl=(g,t)=>g&&/^[\w-]{10,}$/.test(g)?`<a class="pr-drive" href="https://drive.google.com/file/d/${esc(g)}/view" target="_blank" rel="noopener">${esc(t)}<span aria-hidden="true"> ↗</span></a>`:'';
  const dir=p=>p.split('/').slice(0,-1).join(' › ')||'top folder',stx=p=>p?((m.D.statuses||{})[p.st]||p.st):'';
  const rows=cp.map(c=>{const p=m.byId.get(c[6]);return {c,p,l:p?label(p):c[4].split('/').pop()}}).sort((a,b)=>a.l.localeCompare(b.l));
  const line=(k,main,sub,links)=>`<li ${k}><div class="pr-cpm"><b>${main}</b><small>${sub}</small></div><div class="pr-cpl">${links}</div></li>`;
  const part=(id,h,n,why,items)=>n?`<details class="pr-cpp" data-cpp="${id}"><summary>${esc(h)} <span>${nf(n)}</span><small>${esc(why)}</small></summary><ul>${items}</ul></details>`:'';
  const act=ms.filter(x=>x[2]!=='excluded').length;
  return `<details class="pr-lock pr-cps" id="prCopies"><summary>Copies and missing files · ${act?`${plural(act,'file')} need you`:'nothing needs you'}</summary>
    <p class="pr-note">Found by the folder scan${H.at?` of ${esc(clockT(H.at))}`:''}. Open a part to see its files.</p>
    ${part('cp','Copies set aside',cp.length,'a second copy of a paper already recorded: never batched or imported',rows.map(({c,p,l})=>line(`data-cp="${c[0]}"`,esc(l),`${p?esc(stx(p))+' · ':''}copy in ${esc(dir(c[1]))}`,dl(c[2],'Copy')+dl(c[5],'Original'))).join(''))}
    ${part('mv','Moved',mv.length,'the record now follows the file',mv.map(x=>line('',esc(x[1].split('/').pop()),`now in ${esc(dir(x[1]))} · was in ${esc(dir(x[2]))}`,'')).join(''))}
    ${part('ms','No longer in the folder',ms.length,act?'some were in use: check these':'all were set aside already: nothing lost',ms.map(x=>line('',esc(x[1].split('/').pop()),`was in ${esc(dir(x[1]))} · ${esc(x[2]==='excluded'?'set aside, not in the bank':x[2])}`,'')).join(''))}
    <p class="pr-note">"Same file" = same size in bytes and a similar name (Drive gives no checksum). If one looks wrong, open both and tell Claude.</p></details>`}
function lanesHTML(){const el=$('#prLanes');if(!el)return;const m=model();if(!m){el.innerHTML='';return}
  const L=lanes(),lock=$('#prLock'),wasOpen=!!(lock&&lock.open),cpo=!!($('#prCopies')||{}).open,cpp=[...document.querySelectorAll('#prCopies .pr-cpp[open]')].map(d=>d.dataset.cpp),cc=API.run&&API.run.cover();
  el.innerHTML=`<div class="pr-lhead"><h4>Courses</h4><span>Each square is a batch of ${SIZE} papers. Current syllabus first, newest year first. Click a square to see its papers.</span></div>
    ${L.length?L.map(laneHTML).join(''):`<p class="pempty">Nothing ready to import.</p>`}
    <div class="pr-lane pr-chk"><div class="pr-lrow"><div class="pr-lname"><b>Needs a check</b><small>${plural(m.t.needs_check||0,'paper')}: year or course not read yet. Sorted into lanes once checked.</small></div>
      <div class="pr-lacts"><button type="button" class="act" data-prcover${cc||!m.t.needs_check?' disabled':''}>${cc?'Cover-page check requested':'Run the cover-page check'}</button><a class="act pr-link" href="#processes/papers/check">Resolve</a></div></div></div>
    ${bigHTML(m)}${lockedHTML(m)}${copiesHTML(m)}
    <div class="pr-legend" aria-hidden="true">${Object.entries(SQW).map(([k,w])=>`<span><i class="pr-b ${k}"></i>${esc(w[0].toUpperCase()+w.slice(1))}</span>`).join('')}</div>`;   // owner 14 Nov: cleared vs waiting in the legend
  if(wasOpen&&$('#prLock'))$('#prLock').open=true;if(cpo&&$('#prCopies'))$('#prCopies').open=true;cpp.forEach(k=>{const d=$(`#prCopies [data-cpp="${k}"]`);if(d)d.open=true})}
function redraw(){if(!isOwnerV()||!$('#prLanes'))return;M=null;sub();tiles();lanesHTML();if(API.check)API.check.draw()}
function render(){const box=$('#invBox');if(!box)return;box.hidden=!isOwnerV();if(box.hidden)return;
  if(!box.dataset.ready){box.dataset.ready='1';
    box.innerHTML=`<section class="psec pr-papers" aria-label="Papers"><div id="prMainWrap">
      <div class="ivsubrow"><p class="ivsub" id="ivSub"></p><span id="ivScanBtn"></span></div><div id="ivScan"></div>
      <div class="pr-sum" id="prSum"></div>
      <div class="pr-main"><section class="pr-card pr-lanes" id="prLanes" aria-label="Courses"></section><aside class="pr-card pr-queue" id="prQueue" aria-label="Queue"></aside></div></div>
      <section class="pr-check" id="prCheck" hidden></section></section>`}
  const chk=$('#processesView').dataset.sub==='check';$('#prMainWrap').hidden=chk;$('#prCheck').hidden=!chk;const h=$('#procHist');if(h)h.hidden=chk;const hc=$('#procCost');if(hc)hc.hidden=chk;
  load();subscribe();redraw();if(API.scan)API.scan.render();if(API.run)API.run.render();if(API.check)API.check.render()}

// ---- writes (editors only)
async function swap(key,id){const L=lanes().find(x=>x.key===key);if(!isOwnerV()||!db||!L)return false;
  const doc={course:L.course,yl:L.yl,swaps:[...(S.swaps[key]||[]),{id:+id,by:me||null,at:new Date().toISOString()}]};
  try{await db.doc('batches/'+key).set(doc);S.swaps[key]=doc.swaps;redraw();if(API.run)API.run.draw();toast('Moved to the end of '+L.name);return true}catch(_){toast('Could not save. Try again in a moment.');return false}}
document.addEventListener('click',async e=>{const t=e.target;if(!t.closest||!t.closest('#invBox')||!isOwnerV())return;
  const sq=t.closest('[data-prb]');if(sq){const [key,n]=sq.dataset.prb.split(':');S.open=S.open&&S.open.key===key&&S.open.n===+n?null:{key,n:+n};lanesHTML();
    const p=$('#prLanes .pr-panel');if(p)p.scrollIntoView({block:'nearest'});return}
  if(t.closest('[data-prbig]')){e.preventDefault();const d=$('#prBig');if(d){d.open=true;d.scrollIntoView({block:'start',behavior:'smooth'})}return}   // owner 18 Nov: a count links to what it counts
  if(t.closest('[data-prclose]')){const k=S.open;S.open=null;lanesHTML();const b=k&&$(`#prLanes [data-prb="${CSS.escape(k.key+':'+k.n)}"]`);if(b)b.focus();return}
  const sw=t.closest('[data-prswap]');if(sw){if(S.busy)return;S.busy=true;try{await swap(sw.dataset.lane,sw.dataset.prswap)}finally{S.busy=false}return}
  const ad=t.closest('[data-pradd]');if(ad&&API.run){await API.run.addNext(ad.dataset.lane,ad.dataset.pradd==='all'?Infinity:+ad.dataset.pradd);return}
  const one=t.closest('[data-prqone]');if(one&&API.run){const [key,n]=one.dataset.prqone.split(':');await API.run.add([{key,n:+n}]);return}
  if(t.closest('[data-prcover]')&&API.run){await API.run.coverCheck();return}});
// scan, run, check: the parts in 33-35 hang off this object (no new page-wide name); code here reaches them through API
const API={render,redraw,state:S,model,lanes,batch,batchOf,reviewState,imported,waiting,label,course,short,laneName,laneKey,years:YN,yrs,plural,nf,accepted,rules,placedStatus,swapsApply,sub,
  // the Drive connector's download limit, from the inventory (tools/inventory.py BIG; owner 21 Nov: no hanging numbers)
  bigMB:()=>S.data?.big_mb?S.data.big_mb+' MB':'download',
  cost:()=>{const c=S.data&&S.data.cost_per_paper,v=typeof c==='number'?[c,c]:Array.isArray(c)?c:c&&typeof c==='object'?[c.lo??c.min,c.hi??c.max]:null;return v&&v.length===2&&v.every(Number.isFinite)?v:null},
  usd:([lo,hi])=>{const f=x=>Math.round(x).toLocaleString('en-AU');return lo===hi?`US$${f(lo)}`:`US$${f(lo)}–${f(hi)}`},size:SIZE,
  groups:()=>(S.data&&S.data.groups)||[]};
if(view==='processes'&&$('#processesView').dataset.tab==='papers')render();   // Processes › Papers may already be open when this block loads
return API;
})();
