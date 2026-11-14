// owner 14 Nov (mockup A, its "Needs a check" view): the papers the scan couldn't place from their folder and file name
/* ---------- Processes › Papers › Needs a check (#processes/papers/check; Curate: editors only) ----------
   Two cards:
   1. "N placed by better rules": tools/classify_paths.py RULES_PROPOSED, one row per fix (rule, an example path, the result, how
      many papers, See all). Nothing changes until the owner presses Accept all: that writes db scans/rules {version, accepted:
      true, by, at} (scans is editors only already). The page applies the fixes at once (PQ.model, from the inventory's
      "proposed": both outcomes are built by tools/inventory.py); Claude mirrors the doc into work/rules_accepted.json
      (tools/sync_pagedb.py) and rebuilds the inventory, which then applies them for good, in every later scan too.
   2. "N for you to place": the rest. Each row: the paths, the rules' guess, the cover and 3 question pages, an "Open the whole
      PDF in Drive" link, Year 11 / 12 and course quick picks (the rules' course guess, and year if they read one, pre-picked
      as the mockup shows: a pre-pick is a suggestion, saved only with the owner's own pick), Not in scope.
   Page pictures (owner 14 Nov: "Needs a check rows show the cover + 3 pages picked at random from the question pages (enlarge
   on click) and an 'Open the whole PDF in Drive' link"): tools/check_pages.py renders them during the cover-page check, one
   JSON pack per paper (data/check/<id>.json: {pages:[{n, role, w, h, thumb, full}]}), listed in data/check_pages.json
   {papers:{<id>:{path, sha256, pages}}}. The manifest is read when this view opens; each row's pack is fetched when the row
   nears the screen, through QG.url(path, sha256), so a pack in data/assets.json comes from the asset store (Fix 1). Until a
   paper has a pack each page is a placeholder. A click on a page opens it full size in an in-page viewer (a modal <dialog>:
   ← / → step through the 4, Esc or × closes, focus returns to the page clicked). The Drive link is built from the file's
   Drive id (inventory paper "g", from documents.drive_file_id): https://drive.google.com/file/d/<id>/view. An answer is db collection paperfix, one doc per
      paper, 'p<id>': {id, files, yl, course, out, by, at}; tools/inventory.py applies it (mirror page_paperfix), so a rescan
      never asks again. A paper counts as placed once it has a year and a course, or is set aside.
   No new page-wide name: PQ.check. Only editors read or write. */
PQ.check=(()=>{
const C={see:null,busy:false,man:null,manP:null,packs:{},io:null,vw:null};
const PAGES=4;   // the cover + 3 question pages (tools/check_pages.py PICK)
// ---- page pictures: the manifest (once), then each row's pack when the row nears the screen
function manifest(){if(C.man||C.manP)return;C.manP=fetch(QG.url('data/check_pages.json')+(QG.assets['data/check_pages.json']?'':'?r='+Date.now())).then(r=>r.ok?r.json():null).catch(()=>null)
  .then(m=>{C.man=(m&&m.papers&&typeof m.papers==='object')?m.papers:{};draw()})}
function pack(id){const e=C.man&&C.man[id];if(!e||C.packs[id])return;C.packs[id]='loading';
  fetch(QG.url(e.path,e.sha256)).then(r=>r.ok?r.json():null).catch(()=>null).then(x=>{C.packs[id]=x&&Array.isArray(x.pages)?x:'none';
    const row=$(`#prCheck [data-prplace="${id}"] .pr-pages`);if(row)row.outerHTML=pagesHTML(PQ.model().byId.get(+id)||{id:+id})})}
function watch(){if(C.io)C.io.disconnect();const rows=[...document.querySelectorAll('#prCheck .pr-pages[data-prwait]')];if(!rows.length)return;
  if(!('IntersectionObserver' in window)){rows.forEach(r=>pack(r.dataset.prwait));return}
  C.io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){C.io.unobserve(e.target);pack(e.target.dataset.prwait)}}),{rootMargin:'400px 0px'});rows.forEach(r=>C.io.observe(r))}
const pgName=(pg,i)=>pg&&pg.role==='cover'||i===0?'Cover':`Page ${pg?pg.n:''}`.trim();
// the 4 pages of a row: buttons with thumbnails once the pack is here, else placeholders
function pagesHTML(p){const x=C.packs[p.id],e=C.man&&C.man[p.id];
  if(x&&typeof x==='object')return `<div class="pr-pages" role="group" aria-label="Cover and question pages">${x.pages.slice(0,PAGES).map((pg,i)=>`<button type="button" class="pr-pg" data-prpg="${p.id}:${i}" aria-label="Open ${esc(pgName(pg,i).toLowerCase())} full size"><img src="${esc(pg.thumb)}" alt="" width="${54}" height="${Math.round(54*(pg.h||1414)/(pg.w||1000))}"><span>${esc(pgName(pg,i))}</span></button>`).join('')}</div>`;
  const why=e?'Loading the page pictures':'The cover-page check adds a picture of this page';
  return `<div class="pr-pages"${e&&!x?` data-prwait="${p.id}"`:''} role="group" aria-label="Cover and question pages">${Array.from({length:PAGES},(_,i)=>`<span class="pr-pg pr-pgph" role="img" aria-label="${i?'Question page':'Cover'}: no picture yet" title="${why}"><span>${i?'Page':'Cover'}</span></span>`).join('')}</div>`}
// the Drive link: the paper's first file with a Drive id
function driveHTML(p){const id=(p.g||[]).find(Boolean);return id&&/^[\w-]{10,}$/.test(id)?`<a class="pr-drive" href="https://drive.google.com/file/d/${esc(id)}/view" target="_blank" rel="noopener">Open the whole PDF in Drive<span aria-hidden="true"> ↗</span></a>`:''}
// ---- the viewer: one modal dialog for the page, built once
function viewer(){let d=$('#prView');if(d)return d;d=document.createElement('dialog');d.id='prView';d.className='pr-view';d.setAttribute('aria-labelledby','prViewT');
  d.innerHTML=`<div class="pr-vhead"><b id="prViewT"></b><span class="pr-vn" aria-live="polite"></span><button type="button" class="pr-x" data-prvx aria-label="Close">×</button></div>
    <div class="pr-vbody"><button type="button" class="pr-vstep" data-prvs="-1" aria-label="Previous page">‹</button><img alt=""><button type="button" class="pr-vstep" data-prvs="1" aria-label="Next page">›</button></div>`;
  ($('#processesView')||document.body).appendChild(d);
  d.addEventListener('close',()=>{const v=C.vw;C.vw=null;const b=v&&(v.from&&v.from.isConnected?v.from:$(`#prCheck [data-prpg="${v.id}:0"]`));if(b)b.focus()});   // Esc closes it natively
  d.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'){e.preventDefault();step(-1)}else if(e.key==='ArrowRight'){e.preventDefault();step(1)}});
  d.addEventListener('click',e=>{if(e.target===d)closeView();else if(e.target.closest('[data-prvx]'))closeView();else{const b=e.target.closest('[data-prvs]');if(b)step(+b.dataset.prvs)}});
  return d}
function showPage(){const v=C.vw,x=C.packs[v.id],pg=x.pages[v.i],d=viewer(),m=PQ.model(),p=m&&m.byId.get(v.id);
  d.querySelector('#prViewT').textContent=`${p?PQ.label(p):'Paper'}: ${pgName(pg,v.i)}`;d.querySelector('.pr-vn').textContent=`${v.i+1} of ${Math.min(PAGES,x.pages.length)}`;
  const im=d.querySelector('img');im.src=pg.full;im.alt=`${pgName(pg,v.i)} of the PDF`}
function openView(id,i,from){const x=C.packs[id];if(!x||typeof x!=='object')return;C.vw={id:+id,i:+i,from};const d=viewer();showPage();if(!d.open)d.showModal();d.querySelector('[data-prvx]').focus()}
function step(k){const v=C.vw;if(!v)return;const n=Math.min(PAGES,C.packs[v.id].pages.length);v.i=(v.i+k+n)%n;showPage()}
function closeView(){const d=$('#prView');if(d&&d.open)d.close()}
// what the rules make of a paper: its course if they named one, what is missing, the year, solutions
function guess(p){const c=p.c!=='unknown'?PQ.short(p.c):'';
  const miss=p.c==='unknown'&&p.yl==='?'?'no course or year level in the name':p.c==='unknown'?'no course in the name':p.yl==='?'?'year level not in the name':String(p.why||'');
  return [c?`Rules say ${c}; ${miss}`:miss.charAt(0).toUpperCase()+miss.slice(1),p.y?String(p.y):'',p.sol?'with solutions':'',p.n>1?`${p.n} files`:''].filter(Boolean).join('. ')+'.'}
function rulesCard(m){const pr=m.D.proposed;if(!pr||(!pr.accepted&&!(pr.rules||[]).some(r=>r.n)))return '';
  const acc=PQ.accepted(),rs=pr.rules||[],n=rs.reduce((s,r)=>s+r.n,0),a=PQ.state.acc;
  if(acc)return `<div class="pr-card pr-cc" data-prcard="rules"><div class="pr-cchead"><div><h3>${pr.accepted?'Better rules in use':`${PQ.plural(n,'paper')} placed by better rules`}</h3>
    <span>✓ Accepted${a&&a.at?` ${esc(clockT(a.at))}`:''}. ${pr.accepted?'The rules apply to every scan.':'Claude applies the rule change to the record and every future scan at the next inventory build.'}</span></div></div></div>`;
  return `<div class="pr-card pr-cc" data-prcard="rules"><div class="pr-cchead"><div><h3>${PQ.plural(n,'paper')} placed by better rules</h3>
      <span>The names were clear; the rules just didn't recognise them. Accept to apply the rule change to these and every future scan.</span></div>
      <button type="button" class="act primary" id="prAccept"${C.busy?' disabled':''}>Accept all ${PQ.nf(n)}</button></div>
    <div class="pr-rules">${rs.map(r=>`<div class="pr-rule" data-prrule="${esc(r.key)}"><div class="pr-rt"><b>${esc(r.rule)}</b><code title="${esc(r.example)}">${esc(r.example||'–')}</code></div>
      <span class="pr-rres">→ <b>${esc(r.result)}</b></span><span class="pr-rn">${PQ.plural(r.n,'paper')}</span>
      <button type="button" class="act" data-prsee="${esc(r.key)}" aria-expanded="${C.see===r.key}"${r.n?'':' disabled'}>${C.see===r.key?'Hide':'See all'}</button>
      ${C.see===r.key?`<ul class="pr-see">${r.ids.map(i=>m.byId.get(i)||(m.D.groups.flatMap(g=>g.papers).find(p=>p.id===i))).filter(Boolean).map(p=>`<li>${esc(PQ.label(p))}${p.p?`<code>${esc(p.p[0])}</code>`:''}</li>`).join('')}</ul>`:''}</div>`).join('')}</div>
    ${pr.changed_other?`<p class="pr-note">The same fixes also sort ${PQ.plural(pr.changed_other,'paper')} that are already held or not in scope into their course (Extension 1, Extension 2, Standard) or Year 11; nothing ready to import changes.</p>`:''}</div>`}
// the pre-pick: what the rules read (course, and the year when they read one), until the owner answers that pick himself
function pre(p){const f=PQ.state.fix[p.id]||{};return {yl:'yl' in f?(f.yl?String(f.yl):''):(p.yl==='11'||p.yl==='12'?p.yl:''),
  course:'course' in f?(f.course||''):(p.c&&p.c!=='unknown'&&(PQ.state.data.courses||[]).some(x=>x.key===p.c)?p.c:'')}}
function placeRow(p){const f=PQ.state.fix[p.id]||{},pk=pre(p),yl=pk.yl,c=pk.course,out=!!f.out;
  const pill=(attr,v,on,lab)=>`<button type="button" class="pr-pill" ${attr}="${esc(v)}" data-prp="${p.id}" aria-pressed="${on}">${esc(lab)}</button>`;
  const cs=(PQ.state.data.courses||[]).filter(x=>x.key!=='unknown');
  const fy=f.yl?String(f.yl):'',fc=f.course||'';   // placed = what is saved, never the pre-pick
  const done=out||(fy&&fc),res=done?(out?'Set aside: not in scope.':`Placed: ${PQ.laneName(fc,fy)} · ${(PQ.state.data.statuses||{})[PQ.placedStatus(fc,fy,p.y)]||''}.`):'';
  return `<div class="pr-place${done?' done':''}" data-prplace="${p.id}">${pagesHTML(p)}
    <div class="pr-pbody"><code class="pr-path">${(p.p||[PQ.label(p)]).map(esc).join('<br>')}</code><span class="pr-guess">${esc(guess(p))}</span>${driveHTML(p)}
      <div class="pr-picks"><span>Year</span>${['11','12'].map(y=>pill('data-pryl',y,yl===y&&!out,y)).join('')}</div>
      <div class="pr-picks"><span>Course</span>${cs.map(x=>pill('data-prc',x.key,c===x.key&&!out,x.short||x.name)).join('')}<button type="button" class="pr-pill pr-out" data-prout="${p.id}" aria-pressed="${out}">Not in scope</button></div>
      ${res?`<p class="pr-res" role="status">✓ ${esc(res)}</p>`:''}</div></div>`}
function draw(){const el=$('#prCheck');if(!el||el.hidden||!isEditor())return;const m=PQ.model();if(!m){el.innerHTML='<p class="pempty">Loading the paper list…</p>';return}
  const pr=m.D.proposed,ruleIds=new Set(pr&&!pr.accepted&&!PQ.accepted()?(pr.rules||[]).flatMap(r=>r.ids):[]);
  // the owner's own: every paper still needing a check that no proposed fix places, plus those he has answered (kept, so he can change them)
  const mine=[...m.ps.filter(p=>p.st==='needs_check'&&!ruleIds.has(p.id)),...m.ps.filter(p=>p.mine)].sort((a,b)=>String((a.p||[''])[0]).localeCompare(String((b.p||[''])[0])));
  const left=mine.filter(p=>p.st==='needs_check').length,all=m.ps.filter(p=>p.st==='needs_check').length,cc=PQ.run&&PQ.run.cover();
  el.innerHTML=`<div class="pr-chead"><a href="#processes/papers" class="pr-back">← Import papers</a><h3>Needs a check</h3><span>${PQ.plural(all,'paper')} the scan couldn't place from their folder and file name</span></div>
    ${rulesCard(m)}
    <div class="pr-card pr-cc" data-prcard="place"><div class="pr-cchead"><div><h3>${PQ.nf(left)} for you to place</h3>
      <span>The cover-page check reads each front page first; what it can't settle waits here with its cover and 3 pages picked at random from the questions. Click a page to enlarge it. Your answer is kept, so a rescan never asks again.</span></div>
      <button type="button" class="act" data-prcover${cc||!all?' disabled':''}>${cc?'Cover-page check requested':'Run the cover-page check'}</button></div>
      ${mine.length?mine.map(placeRow).join(''):'<p class="pempty">Nothing left to place.</p>'}</div>`;
  manifest();watch()}
function render(){if(!isEditor())return;draw()}
// ---- writes (editors only)
async function accept(){const pr=PQ.state.data&&PQ.state.data.proposed;if(!isEditor()||!db||!pr||pr.accepted||PQ.accepted())return false;
  const doc={version:pr.version,accepted:true,by:me||null,at:new Date().toISOString()};
  try{await db.doc('scans/rules').set(doc);PQ.state.acc=doc;PQ.redraw();toast('Rules accepted');return true}catch(_){toast('Could not save. Try again in a moment.');return false}}
async function place(id,patch){const m=PQ.model(),p=m&&m.byId.get(+id);if(!isEditor()||!db||!p)return false;const cur=PQ.state.fix[p.id]||{},pk=pre(p);
  const doc={id:p.id,files:cur.files||p.f||[p.id],yl:pk.yl?+pk.yl:null,course:pk.course||null,out:false,...patch,by:me||null,at:new Date().toISOString()};
  try{await db.doc('paperfix/p'+p.id).set(doc);PQ.state.fix[p.id]=doc;PQ.redraw();return true}catch(_){toast('Could not save. Try again in a moment.');return false}}
document.addEventListener('click',async e=>{const t=e.target;if(!t.closest||!t.closest('#prCheck')||!isEditor())return;
  if(t.closest('#prAccept')){C.busy=true;draw();try{await accept()}finally{C.busy=false;draw()}return}
  const see=t.closest('[data-prsee]');if(see){C.see=C.see===see.dataset.prsee?null:see.dataset.prsee;draw();return}
  const pg=t.closest('[data-prpg]');if(pg){const [id,i]=pg.dataset.prpg.split(':');openView(id,i,pg);return}
  const b=t.closest('[data-prp],[data-prout]');if(b){const id=b.dataset.prp||b.dataset.prout,cur=PQ.state.fix[+id]||{},pp=PQ.model().byId.get(+id),pk=pp?pre(pp):{yl:'',course:''};
    if(b.dataset.prout)await place(id,{out:!cur.out});
    else if(b.dataset.pryl)await place(id,{yl:pk.yl===b.dataset.pryl&&!cur.out?null:+b.dataset.pryl,out:false});
    else await place(id,{course:pk.course===b.dataset.prc&&!cur.out?null:b.dataset.prc,out:false});
    const again=$(`#prCheck [data-prplace="${CSS.escape(id)}"]`);if(again){const k=b.dataset.pryl?`[data-pryl="${b.dataset.pryl}"]`:b.dataset.prc?`[data-prc="${CSS.escape(b.dataset.prc)}"]`:'[data-prout]';const x=again.querySelector(k);if(x)x.focus()}
    return}});   // Run the cover-page check: the Papers click handler (32_papers_q.js) takes it, here as on the lane
return {render,draw,accept,place,guess,state:C,openView,closeView};
})();
if(view==='processes'&&$('#processesView').dataset.tab==='papers')PQ.check.render();
