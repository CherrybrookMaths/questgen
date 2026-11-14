// owner 14 Nov (mockup A, its "Needs a check" view): the papers the scan couldn't place from their folder and file name
/* ---------- Processes › Papers › Needs a check (#processes/papers/check; Curate: editors only) ----------
   Two cards:
   1. "N placed by better rules": tools/classify_paths.py RULES_PROPOSED, one row per fix (rule, an example path, the result, how
      many papers, See all). Nothing changes until the owner presses Accept all: that writes db scans/rules {version, accepted:
      true, by, at} (scans is editors only already). The page applies the fixes at once (PQ.model, from the inventory's
      "proposed": both outcomes are built by tools/inventory.py); Claude mirrors the doc into work/rules_accepted.json
      (tools/sync_pagedb.py) and rebuilds the inventory, which then applies them for good, in every later scan too.
   2. "N for you to place": the rest. Each row: the paths, the rules' guess, a cover placeholder (page images exist only for
      imported papers), Year 11 / 12 and course quick picks, Not in scope. An answer is db collection paperfix, one doc per
      paper, 'p<id>': {id, files, yl, course, out, by, at}; tools/inventory.py applies it (mirror page_paperfix), so a rescan
      never asks again. A paper counts as placed once it has a year and a course, or is set aside.
   No new page-wide name: PQ.check. Only editors read or write. */
PQ.check=(()=>{
const C={see:null,busy:false};
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
function placeRow(p){const f=PQ.state.fix[p.id]||{},yl=f.yl?String(f.yl):'',c=f.course||'',out=!!f.out;
  const pill=(attr,v,on,lab)=>`<button type="button" class="pr-pill" ${attr}="${esc(v)}" data-prp="${p.id}" aria-pressed="${on}">${esc(lab)}</button>`;
  const cs=(PQ.state.data.courses||[]).filter(x=>x.key!=='unknown');
  const done=out||(yl&&c),res=done?(out?'Set aside: not in scope.':`Placed: ${PQ.laneName(c,yl)} · ${(PQ.state.data.statuses||{})[PQ.placedStatus(c,yl,p.y)]||''}.`):'';
  return `<div class="pr-place${done?' done':''}" data-prplace="${p.id}"><div class="pr-cover" role="img" aria-label="Cover page preview" title="The cover-page check adds a picture of the front page">cover</div>
    <div class="pr-pbody"><code class="pr-path">${(p.p||[PQ.label(p)]).map(esc).join('<br>')}</code><span class="pr-guess">${esc(guess(p))}</span>
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
      <span>The cover-page check reads each front page first; what it can't settle waits here. Your answer is kept, so a rescan never asks again.</span></div>
      <button type="button" class="act" data-prcover${cc||!all?' disabled':''}>${cc?'Cover-page check requested':'Run the cover-page check'}</button></div>
      ${mine.length?mine.map(placeRow).join(''):'<p class="pempty">Nothing left to place.</p>'}</div>`}
function render(){if(!isEditor())return;draw()}
// ---- writes (editors only)
async function accept(){const pr=PQ.state.data&&PQ.state.data.proposed;if(!isEditor()||!db||!pr||pr.accepted||PQ.accepted())return false;
  const doc={version:pr.version,accepted:true,by:me||null,at:new Date().toISOString()};
  try{await db.doc('scans/rules').set(doc);PQ.state.acc=doc;PQ.redraw();toast('Rules accepted');return true}catch(_){toast('Could not save. Try again in a moment.');return false}}
async function place(id,patch){const m=PQ.model(),p=m&&m.byId.get(+id);if(!isEditor()||!db||!p)return false;const cur=PQ.state.fix[p.id]||{};
  const doc={id:p.id,files:cur.files||p.f||[p.id],yl:cur.yl||null,course:cur.course||null,out:false,...patch,by:me||null,at:new Date().toISOString()};
  try{await db.doc('paperfix/p'+p.id).set(doc);PQ.state.fix[p.id]=doc;PQ.redraw();return true}catch(_){toast('Could not save. Try again in a moment.');return false}}
document.addEventListener('click',async e=>{const t=e.target;if(!t.closest||!t.closest('#prCheck')||!isEditor())return;
  if(t.closest('#prAccept')){C.busy=true;draw();try{await accept()}finally{C.busy=false;draw()}return}
  const see=t.closest('[data-prsee]');if(see){C.see=C.see===see.dataset.prsee?null:see.dataset.prsee;draw();return}
  const b=t.closest('[data-prp],[data-prout]');if(b){const id=b.dataset.prp||b.dataset.prout,cur=PQ.state.fix[+id]||{};
    if(b.dataset.prout)await place(id,{out:!cur.out});
    else if(b.dataset.pryl)await place(id,{yl:cur.yl===+b.dataset.pryl&&!cur.out?null:+b.dataset.pryl,out:false});
    else await place(id,{course:cur.course===b.dataset.prc&&!cur.out?null:b.dataset.prc,out:false});
    const again=$(`#prCheck [data-prplace="${CSS.escape(id)}"]`);if(again){const k=b.dataset.pryl?`[data-pryl="${b.dataset.pryl}"]`:b.dataset.prc?`[data-prc="${CSS.escape(b.dataset.prc)}"]`:'[data-prout]';const x=again.querySelector(k);if(x)x.focus()}
    return}});   // Run the cover-page check: the Papers click handler (32_papers_q.js) takes it, here as on the lane
return {render,draw,accept,place,guess,state:C};
})();
if(view==='processes'&&$('#processesView').dataset.tab==='papers')PQ.check.render();
