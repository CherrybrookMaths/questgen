// owner 13 Nov: "Can the import queue be dynamic, me choosing which set of papers to import next? We can always [build the] framework for the courses standard extension and extension two [later] right?"
// owner 13 Nov: "New exams are gonna be added to this folder periodically we need a way to ... see what we actually haven't ingested yet"
// owner 13 Nov: "Should we also order what's in standard and also extension one and extension two while we're scanning anyways?"
/* ---------- Papers and the owner's import order (Processes, Curate: editors only) ----------
   data/inventory.json (tools/inventory.py): every paper in the shared folder, in course x year groups, each paper with its state
   (imported / waiting / out_of_course / out_of_scope / other), "new" when the latest folder scan (tools/scan_folder.py) added it,
   and pick:1 when it can be queued (Advanced and waiting). Courses that are not ready (inventory courses[].ready) show their
   counts with a short "needs course setup" and have no checkboxes. Since 13 Nov (owner: "The process page feels a bit bloated
   now" -> "Two tabs: Work | Papers") this is the Papers tab, and the grid is compact: one row per course, Year 12 / 11 / ? cells.
   The owner ticks papers (or a whole school / group) and presses "Add to import queue". db collection "importq", one doc per
   paper, id 'd<doc_id>': {doc_id, label, course, year_level, order, added_by, at}. Reorder by drag (desktop) or ↑ ↓; × removes.
   Import itself is paused (owner 14 Nov: "no more importing for a while until we iron these out"), so the card says so.
   Claude reads the order with ArtifactData list on "importq" (tools/import_next.py). Only editors write: every handler checks isEditor(). */
/* One page-wide name, PQ (code health 13 Nov, rule 1): everything else stays inside this scope.
   PQ.render() draws the card (renderProcesses calls it); PQ.add / PQ.remove / PQ.state are for the page test. */
const PQ=(()=>{
const INV={data:null,loading:false,failed:false,q:[],sub:null,loaded:false,sel:new Set(),open:null};   // open: the course|year group whose papers show under the grid row
const IVY={'12':'Year 12','11':'Year 11','?':'Year ?'};
// owner 14 Nov: "no more importing for a while until we iron these out"
const IVPAUSE='Import is paused. This only sets the order for when it resumes.';
const invLabel=p=>p.l||(p.t==='HSC'?`${p.y} NESA HSC`:`${p.y} ${p.s} ${p.t}`);
const invCourse=k=>((INV.data&&INV.data.courses)||[]).find(c=>c.key===k)||{key:k,name:k,ready:false};
const invShort=k=>invCourse(k).short||invCourse(k).name||k;
const invGroups=()=>(INV.data&&INV.data.groups)||[];
const invGid=g=>g.course+'|'+g.yl;
function invFind(id){for(const g of invGroups()){const p=g.papers.find(x=>x.id===+id);if(p)return{p,g}}return null}
const invQ=()=>INV.q.slice().sort((a,b)=>(+a.order||0)-(+b.order||0)||String(a.at).localeCompare(String(b.at)));
const invQueued=()=>new Map(invQ().map((x,i)=>[+x.doc_id,i+1]));
const invPickable=(p,qd)=>!!p.pick&&!(qd||invQueued()).has(p.id);
function invLoad(){if(INV.data||INV.loading||!isEditor())return;INV.loading=true;
  fetch('data/inventory.json?v='+Date.now()).then(r=>r.ok?r.json():null).then(d=>{INV.data=d&&Array.isArray(d.groups)?d:null;INV.failed=!INV.data})
    .catch(()=>{INV.failed=true}).finally(()=>{INV.loading=false;if(view==='processes')renderInv()})}
function invSubscribe(){if(INV.sub||!db||!isEditor())return;
  try{INV.sub=db.collection('importq').onSnapshot(s=>{const d=s.docs||s;INV.q=(d||[]).map(x=>({id:x.id,...(typeof x.data==='function'?x.data():x.data)})).filter(x=>x&&Number.isFinite(+x.doc_id));INV.loaded=true;invQueue();invGridMarks()},()=>{})}catch(e){}}
// the card is drawn once (open groups and ticks survive the Processes refresh); the queue, grid and bar redraw inside it
function renderInv(){const box=$('#invBox');if(!box)return;box.hidden=!isEditor();if(box.hidden)return;
  if(!box.dataset.ready){box.dataset.ready='1';
    // owner 13 Nov ("Two tabs: Work | Papers"): the tab names the section, so no heading; the pause note is one quiet line
    box.innerHTML=`<section class="psec ivp" aria-label="Papers">
      <div class="ivsubrow"><p class="ivsub" id="ivSub"></p><span id="ivScanBtn"></span></div><div id="ivScan"></div>
      <div class="ivq"><h4 id="ivQH">Import order <span class="pcount" id="ivQN" hidden></span></h4><p class="ivpause" role="note">${esc(IVPAUSE)}</p><div id="ivQList"></div></div>
      <div id="ivGrid"></div>
      <div class="ivbar" id="ivBar" hidden><span id="ivSelN" aria-live="polite"></span><button type="button" class="act" id="ivClear">Clear</button><button type="button" class="act ivadd" id="ivAdd">Add to import queue</button></div></section>`}
  invLoad();invSubscribe();invSub();invQueue();if(!$('#ivGrid').dataset.built)invGrid();invBar();if(API.scan)API.scan.render()}
function invSub(){const el=$('#ivSub');if(!el)return;const D=INV.data;
  if(!D){el.textContent=INV.failed?'The paper list could not be loaded.':'Loading the paper list…';return}
  const t=D.totals||{},ls=D.last_scan,ds=API.scan&&API.scan.last(),dl=ds&&(!ls||Date.parse(ds.at)>Date.parse(ls.at));   // a Drive rescan later than the folder scan wins
  el.textContent=`${t.papers||0} papers in the shared folder (${D.docs||0} files) · `+(dl?`last scan ${clockT(ds.at)}, ${ds.n} new`:ls?`last folder scan ${clockT(ls.at)}, ${ls.inserted||0} new`:'no folder scan yet: counts are from the first stock-take')}
// ---- the import order (owner's queue)
function invQueue(){const el=$('#ivQList');if(!el)return;const q=invQ(),n=$('#ivQN');if(n){n.hidden=!q.length;n.textContent=q.length}
  const cost=INV.data&&INV.data.cost_per_paper;
  el.innerHTML=q.length?`<ol class="nlist ivql">${q.map((x,i)=>{const f=invFind(x.doc_id),p=f&&f.p,warn=p&&p.st==='imported'?'already imported':p&&!p.pick?'can no longer be imported':!p&&INV.data?'not in the paper list':'';
    return `<li class="nrow" data-ivq="${esc(x.id)}" draggable="true"><span class="ngrip" aria-hidden="true" title="Drag to reorder">⋮⋮</span><span class="ivqn" aria-hidden="true">${i+1}</span>
      <span class="ntext"><b>${esc(x.label||(p?invLabel(p):'Paper '+x.doc_id))}</b><small>${esc(invShort(x.course))}${x.year_level?' · Year '+esc(x.year_level):''}${cost?` · ${esc(cost)}`:''}${warn?` · <em class="ivwarn">${esc(warn)}</em>`:''}</small></span>
      <span class="nacts"><button type="button" class="nbtn" data-ivmove="-1" data-ivid="${esc(x.id)}" aria-label="Move up"${i===0?' disabled':''}>↑</button><button type="button" class="nbtn" data-ivmove="1" data-ivid="${esc(x.id)}" aria-label="Move down"${i===q.length-1?' disabled':''}>↓</button><button type="button" class="nbtn ndel" data-ivdel="${esc(x.id)}" aria-label="Remove from the import queue">×</button></span></li>`}).join('')}</ol>`:
    `<p class="pempty">${INV.loaded||!db?`Nothing queued. Tick ${esc(['papers',...((INV.data&&INV.data.courses)||[]).filter(c=>c.ready).map(c=>c.short||c.name)].reverse().join(' '))} below and press Add to import queue.`:'Loading the import order…'}</p>`}
// ---- the course grid (owner 13 Nov: "The process page feels a bit bloated now" -> "Two tabs: Work | Papers"): one row per
// course, in the inventory's order, columns Year 12 / Year 11 / Year ?. A ready course's cell reads "imported / waiting waiting";
// any other cell the papers in the folder. A cell opens that group's papers under its course row (one group at a time).
const IVYL=['12','11','?'];
const invNote=c=>String(c.note||'needs course setup').split(/\s*[(:]/)[0];   // the short form, once per row; the full note is its title
function invGrid(){const el=$('#ivGrid');if(!el)return;const G=invGroups();if(!INV.data){el.innerHTML='';return}el.dataset.built='1';
  const scan=!!INV.data.last_scan,keys=[...new Set([...(INV.data.courses||[]).map(c=>c.key),...G.map(g=>g.course)])];
  const cell=(c,yl)=>{const g=G.find(x=>x.course===c.key&&x.yl===yl),k=(g&&g.counts)||{},yn=IVY[yl]||yl,lab=`<i class="ivcl">${esc(yn)}</i>`;
    if(!g||!k.papers)return `<span class="ivcell ivz">${lab}<span class="ivct">–</span></span>`;
    const imp=k.imported||0,wait=k.waiting||0,split=c.ready&&(imp||wait),nw=scan&&k.new?`<span class="ivchip new">${k.new} new</span>`:'';
    const tip=`${invShort(c.key)} ${yn}: ${k.papers} papers in the folder`+(c.ready?` · ${imp} imported · ${wait} waiting`:'')+(scan?` · ${k.new||0} new`:'');
    return `<button type="button" class="ivcell" data-ivg="${esc(invGid(g))}" aria-expanded="false" title="${esc(tip)}" aria-label="${esc(tip)}">${lab}<span class="ivct">${split?`<b class="ok">${imp}</b> / <b class="wait">${wait}</b> waiting`:`<b>${k.papers}</b>`}</span>${nw}</button>`};
  el.innerHTML=`<div class="ivhead" aria-hidden="true"><span>Course</span>${IVYL.map(yl=>`<span>${esc(IVY[yl])}</span>`).join('')}</div>`+
    keys.map(key=>{const c=invCourse(key);
      return `<div class="ivr${c.ready?'':' off'}" data-ivc="${esc(key)}"><div class="ivname"><b>${esc(invShort(key))}</b>${c.ready?'':`<small class="ivnote" title="${esc(c.note||'')}">${esc(invNote(c))}</small>`}</div>
        ${IVYL.map(yl=>cell(c,yl)).join('')}<div class="ivbody" hidden></div></div>`}).join('');
  if(INV.open)invOpen(INV.open)}
function invOpen(gid){const g=gid&&invGroups().find(x=>invGid(x)===gid);INV.open=g?gid:null;
  $$('#ivGrid .ivcell[data-ivg]').forEach(b=>{const on=b.dataset.ivg===INV.open;b.setAttribute('aria-expanded',String(on));b.classList.toggle('on',on)});
  $$('#ivGrid .ivbody').forEach(b=>{b.hidden=true;b.innerHTML='';delete b.dataset.ivg});
  const b=g&&$(`#ivGrid .ivr[data-ivc="${CSS.escape(g.course)}"] .ivbody`);if(b){b.dataset.ivg=gid;b.hidden=false;invFill(b)}}
const IVST={imported:['Imported','ok'],waiting:['Waiting','wait'],out_of_course:['Other course',''],out_of_scope:['Not imported',''],other:['Duplicate / skipped','']};
function invBody(g){const ready=!!invCourse(g.course).ready,qd=invQueued(),pick=g.papers.filter(p=>invPickable(p,qd)),gid=invGid(g);
  const by=new Map();g.papers.forEach(p=>{const s=p.s||'School not known';if(!by.has(s))by.set(s,[]);by.get(s).push(p)});
  const row=p=>{const st=IVST[p.st]||[p.st,''],qn=qd.get(p.id),can=ready&&invPickable(p,qd),cid='ivc'+p.id;
    return `<li class="ivpp st-${esc(p.st)}">${can?`<input type="checkbox" id="${cid}" data-ivp="${p.id}"${INV.sel.has(p.id)?' checked':''}>`:'<span class="ivnobox" aria-hidden="true"></span>'}
      <label${can?` for="${cid}"`:''} class="ivpl">${esc(invLabel(p))}</label>
      <span class="ivchips">${qn?`<span class="ivchip q">In queue · #${qn}</span>`:`<span class="ivchip ${st[1]}">${esc(st[0])}</span>`}${p.new?'<span class="ivchip new">New</span>':''}${p.scan?'<span class="ivchip">Scan</span>':''}${p.st==='waiting'&&!p.sol?'<span class="ivchip">No solutions</span>':''}${p.n>1?`<span class="ivchip">${p.n} files</span>`:''}</span>
      ${p.why?`<small class="ivwhy">${esc(p.why)}</small>`:''}</li>`};
  return `<p class="ivbh"><b>${esc(invShort(g.course))}</b> ${esc(IVY[g.yl]||g.yl)} · ${g.papers.length} paper${g.papers.length===1?'':'s'}</p>`+
    (ready?(pick.length?`<label class="ivall"><input type="checkbox" data-ivall="${esc(gid)}"> Select all ${pick.length} waiting</label>`:`<p class="ivmsg">Nothing here can be queued: ${g.counts.imported?'imported papers are done and ':''}the rest are not import papers.</p>`)
      :`<p class="ivmsg">Listed so you can see what is there; these can't be queued yet.</p>`)+
    [...by].map(([s,ps])=>{const sp=ps.filter(p=>ready&&invPickable(p,qd));
      return `<div class="ivs"><div class="ivsh">${sp.length?`<label><input type="checkbox" data-ivsch="${esc(gid)}" data-school="${esc(s)}"> ${esc(s)}</label>`:`<span>${esc(s)}</span>`}<span class="pcount">${ps.length}</span></div><ul class="ivpl-list">${ps.map(row).join('')}</ul></div>`}).join('')}
function invFill(b){const g=b&&invGroups().find(x=>invGid(x)===b.dataset.ivg);if(!g)return;b.innerHTML=invBody(g);invTicks(b)}
// redraw the open group after the queue changes (In queue chips, which boxes are tickable)
function invGridMarks(){$$('#ivGrid .ivbody:not([hidden])').forEach(invFill);for(const id of [...INV.sel]){if(invQueued().has(id))INV.sel.delete(id)}invBar()}
// group / school boxes: ticked when every tickable paper under them is, half when some are
function invTicks(scope){(scope?[scope]:$$('#ivGrid .ivbody:not([hidden])')).forEach(det=>{
  const set=(box,ids)=>{if(!box)return;const n=ids.filter(i=>INV.sel.has(i)).length;box.checked=!!ids.length&&n===ids.length;box.indeterminate=n>0&&n<ids.length};
  const ids=sel=>[...det.querySelectorAll(sel)].map(x=>+x.dataset.ivp);
  set(det.querySelector('[data-ivall]'),ids('[data-ivp]'));
  det.querySelectorAll('.ivs').forEach(s=>set(s.querySelector('[data-ivsch]'),[...s.querySelectorAll('[data-ivp]')].map(x=>+x.dataset.ivp)))})}
function invBar(){const bar=$('#ivBar');if(!bar)return;const n=INV.sel.size;bar.hidden=!n;const t=$('#ivSelN');if(t)t.textContent=`${n} paper${n===1?'':'s'} selected`}
// ---- writes (editors only)
async function invAdd(ids){if(!isEditor()||!db)return 0;const qd=invQueued(),q=invQ();let o=q.length?Math.max(...q.map(x=>+x.order||0)):0,n=0;
  for(const id of ids){const f=invFind(id);if(!f||!f.p.pick||qd.has(+id))continue;const {p,g}=f;
    const doc={doc_id:p.id,label:invLabel(p),course:g.course,year_level:g.yl==='?'?null:+g.yl,order:++o,added_by:me||null,at:new Date().toISOString()};
    try{await db.doc('importq/d'+p.id).set(doc);n++;if(!INV.q.some(x=>+x.doc_id===p.id))INV.q.push({id:'d'+p.id,...doc})}catch(_){toast('Could not save. Try again in a moment.');break}}
  return n}
async function invSet(x,patch){if(!isEditor()||!db)return false;const {id,...rest}=x;try{await db.doc('importq/'+id).set({...rest,...patch});return true}catch(e){toast('Could not save. Try again in a moment.');return false}}
async function invReorder(ids){if(!isEditor())return;await writeOrder(INV.q,ids,invSet,()=>{invQueue();invGridMarks()})}
async function invRemove(id){if(!isEditor()||!db)return false;try{await db.doc('importq/'+id).delete();INV.q=INV.q.filter(x=>x.id!==id);invQueue();invGridMarks();toast('Removed from the import queue');return true}catch(_){toast('Could not remove. Try again in a moment.');return false}}
document.addEventListener('change',e=>{const t=e.target;if(!t.closest||!t.closest('#invBox'))return;if(!isEditor()){t.checked=false;return}
  const det=t.closest('.ivbody');
  if(t.dataset.ivp){const id=+t.dataset.ivp;t.checked?INV.sel.add(id):INV.sel.delete(id)}
  else if(t.dataset.ivall||t.dataset.ivsch){const sc=t.dataset.ivall?det:t.closest('.ivs');sc.querySelectorAll('[data-ivp]').forEach(b=>{b.checked=t.checked;const id=+b.dataset.ivp;t.checked?INV.sel.add(id):INV.sel.delete(id)})}
  else return;
  invTicks(det);invBar()});
document.addEventListener('click',async e=>{const t=e.target;if(!t.closest||!t.closest('#invBox'))return;
  const cell=t.closest('#ivGrid .ivcell[data-ivg]');if(cell){invOpen(INV.open===cell.dataset.ivg?null:cell.dataset.ivg);return}
  if(t.closest('#ivClear')){INV.sel.clear();$$('#ivGrid [data-ivp]').forEach(b=>b.checked=false);invTicks();invBar();return}
  if(t.closest('#ivAdd')){if(!isEditor())return;const ids=[...INV.sel];const n=await invAdd(ids);INV.sel.clear();invQueue();invGridMarks();
    if(n)toast(`${n} paper${n===1?'':'s'} added to the import queue`);const h=$('#ivQH');if(h&&n)h.scrollIntoView({block:'nearest'});return}
  const mv=t.closest('[data-ivmove]');if(mv){const ids=invQ().map(x=>x.id),i=ids.indexOf(mv.dataset.ivid),j=i+ +mv.dataset.ivmove;if(i<0||j<0||j>=ids.length)return;
    [ids[i],ids[j]]=[ids[j],ids[i]];await invReorder(ids);const b=document.querySelector(`#ivQList [data-ivid="${CSS.escape(mv.dataset.ivid)}"][data-ivmove="${mv.dataset.ivmove}"]`);if(b&&!b.disabled)b.focus();return}
  const dl=t.closest('[data-ivdel]');if(dl){await invRemove(dl.dataset.ivdel);return}});
sortableList('#ivQList .ivql>li','ivq',()=>invQ().map(x=>x.id),invReorder,invQueue);   // drag (desktop); ↑ ↓ for keyboard and phone (31_notes.js)
// sub: the sub line; course, years: names for the Rescan drive results. 33_drive_scan.js adds API.scan (= PQ.scan, no new
// page-wide name); code in here reaches it through API, since PQ itself is not assigned until this block returns.
const API={render:renderInv,add:invAdd,remove:invRemove,open:invOpen,state:INV,sub:invSub,course:invCourse,years:IVY};
if(view==='processes'&&$('#processesView').dataset.tab==='papers')renderInv();   // Processes › Papers may already be open when this block loads
return API;
})();
