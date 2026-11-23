/* ---------- import progress (owner 12 Nov: "add a dashboard to keep track of what's running") ----------
   Source: db doc progress/import, written by Claude as each stage starts/finishes; falls back to data/progress.json. */
let PROG=null;
const STAGES=[['parse','Parse'],['load','Load'],['tag','Tag'],['solutions','Format solutions'],['generate','Write solutions'],['diagrams','Diagrams'],['verify','Independent check'],['publish','On this page']];
const SLABEL={done:'Done',running:'Running',waiting:'Waiting',failed:'Problem','n/a':'Not needed'};
// owner 14 Nov: "I don't like the Parse -> Load -> Tag prose... not very clear and requires too much reading": the stages are now
// column headings with short names (full name on hover), and each batch row has a tick, dash or spinner under each heading.
const SSHORT={parse:'Parse',load:'Load',tag:'Tag',solutions:'Format',generate:'Write',diagrams:'Diagrams',verify:'Check',publish:'Live'};
const SMARK={done:'✓',running:'',waiting:'',failed:'!','n/a':'–'};
const stageCells=b=>STAGES.map(([k,l])=>{const v=(b.stages||{})[k]||'waiting';return `<span class="sc ${v.replace('/','')}" title="${esc(l)}: ${esc(SLABEL[v]||v)}">${SMARK[v]??''}</span>`}).join('');
const stageHead=()=>`<div class="bhead" aria-hidden="true"><span></span><span></span>${STAGES.map(([k,l])=>`<span class="sh" title="${esc(l)}">${SSHORT[k]}</span>`).join('')}<span></span></div>`;
function ago(t){if(!t)return'';const m=Math.round((Date.now()-new Date(t))/60000);return m<1?'just now':m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' d ago'}
// owner 12 Nov: "each batch takes so much vspace ... find a way to collapse". One compact row per batch:
// stages as a strip of dots, papers behind a toggle; finished and waiting batches grouped and collapsed.
function batchState(b){const st=STAGES.map(([k])=>(b.stages||{})[k]||'waiting');
  if(st.includes('failed'))return['failed','Problem'];if(st.every(v=>v==='done'||v==='n/a'))return['done','Done'];
  const r=STAGES.find(([k])=>(b.stages||{})[k]==='running');if(r)return['running',r[1]];
  if(st.some(v=>v==='done'))return['running','Part done'];return['waiting','Waiting']}
function batchRow(b){const [cls,lab]=batchState(b);const n=(b.papers||[]).length;
  return `<details class="brow"><summary><b>${esc(b.id)}</b><span class="pr-st ${cls}">${esc(lab)}</span>
    ${stageCells(b)}
    <span class="muted">${n} paper${n===1?'':'s'}${b.questions?` · ${esc(String(b.questions))} questions`:''}</span></summary>
    <div class="bbody">${b.note?`<div class="muted">${esc(b.note)}</div>`:''}<div class="bstages">${STAGES.map(([k,l])=>{const v=(b.stages||{})[k]||'waiting';return `<span><span class="pr-st ${v.replace('/','')}">${SLABEL[v]||esc(v)}</span> ${esc(l)}</span>`}).join('')}</div>
    <ul class="bpapers">${(b.papers||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div></details>`}
// owner 13 Nov: "but we already have 15 waiting batches?" -> ONE list; since 14 Nov what is still to import is the course lanes'
// numbered batches (Papers tab, PQ), so the history shows finished batches only.
function batchesHTML(L){const done=L.filter(b=>batchState(b)[0]==='done');
  return done.length?`<p class="sub">Tap a batch to see its papers. – means the stage wasn't needed.</p><details class="bgrp" open><summary>Finished <span class="muted">· ${done.length} batch${done.length===1?'':'es'} · ${done.reduce((n,b)=>n+(b.papers||[]).length,0)} papers</span></summary><div class="bscroll">${stageHead()}${done.map(batchRow).join('')}</div></details>`:'<p class="pempty">No finished batches yet.</p>'}
// owner 13 Nov ("The process page feels a bit bloated now" -> "Two tabs: Work | Papers"): this dashboard now sits inside
// Processes › Papers › "Import history" (collapsed), so it has no heading of its own; the log shows the last 5 entries, "Show all" the rest.
// owner 24 Nov: "make sure there aren't any more stale numbers or tags hanging": the diagram and Claude-solution tiles counted only the
// first in-session batches (tools/progress.py, frozen since 13 Nov); like the papers and questions tiles they now count the Bank itself
// (figure keys and their redraws from the index; generated solutions once the details are in), the stored totals only as a fallback
function liveTotals(t){if(!B?.questions?.length)return {d:t.figures_redrawn||0,n:t.figures_total||0,g:t.solutions_written};
  const qs=B.questions.filter(inBank),ks=new Set(qs.flatMap(q=>figKeys(q).all));
  return {d:[...ks].filter(redrawable).length,n:ks.size,g:QG.detOK?qs.reduce((n,q)=>n+(q.solutions||[]).filter(s=>s.source==='generated').length,0):t.solutions_written}}
function renderImport(){
  const P=PROG, box=$('#importBox'); if(!box) return;
  if(!P){box.innerHTML='<div class="empty">No import progress recorded yet.</div>';return}
  const t=P.totals||{}, pct=(a,b)=>b?Math.round(100*a/b):0;
  const tile=(v,l,a,b)=>`<div class="tile"><b>${v??'–'}</b><span>${l}</span>${b?`<div class="pr-bar"><i style="width:${pct(a,b)}%"></i></div>`:''}</div>`;
  const run=(P.running||[]),log=(P.log||[]).slice().reverse(),all=box.dataset.logall==='1';
  box.innerHTML=`<p class="sub">${esc(QG.courseData.years)} ${esc(QG.courseData.short)} papers, newest first · updated ${esc(ago(P.updated))}${P.eta?` · ${esc(P.eta)}`:''}</p>
  <div class="tiles">${(bs=>tile(B?.questions?.length?bs.papers:null,'papers in the Bank')+tile(B?.questions?.length?bs.questions.toLocaleString():null,'questions in the Bank'))(B?.questions?bankStats():{})}
  ${(f=>tile(`${f.d} / ${f.n}`,'diagrams redrawn',f.d,f.n)+tile(f.g,'solutions written by Claude'))(liveTotals(t))}</div>
  ${run.length?`<h3>Import stages running</h3><ul>${run.map(r=>`<li><span class="pulse" aria-hidden="true"></span><b>${esc(r.stage)}</b> · ${esc(r.batch||'')} ${r.detail?'· '+esc(r.detail):''} <span class="muted">· started ${esc(ago(r.started))}</span></li>`).join('')}</ul>`:''}
  <h3>Batches</h3>${batchesHTML(P.batches||[])}
  ${log.length?`<h3>Log</h3><ul class="log">${log.map((x,i)=>`<li${i>=5&&!all?' hidden':''}>${esc(x.t?new Date(x.t).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'')} · ${esc(x.msg)}</li>`).join('')}</ul>${log.length>5&&!all?`<button type="button" class="act plogall" data-logall>Show all ${log.length}</button>`:''}`:''}`;
}
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('#importBox [data-logall]');if(!b)return;const box=$('#importBox');box.dataset.logall='1';box.querySelectorAll('.log li[hidden]').forEach(li=>li.hidden=false);b.remove()});
/* ---------- Processes (owner 14 Nov: "Can u show this list of tasks on the artifact somewhere ... Can be on the same as import.
   Can make that page processes") ----------
   owner 13 Nov: "The process page feels a bit bloated now" -> "Two tabs: Work | Papers" (the switch in page.html, the tab in
   #processesView data-tab, set by route() from #processes/work | #processes/papers).
   Work: Running now (progress/jobs + queue items marked running), Queued (progress/queue, in order, with the owner's own words
   in italics), Recently done (collapsed), Next up (31_notes.js).
   Papers (owner 14 Nov, mockup A: "I like A's design much more"): the top line with Rescan drive, the summary, the course lanes
   and the queue (PQ, 32-35_papers_*.js; #processes/papers/check is its Needs a check view), then Import history (renderImport,
   collapsed). */
// owner 13 Nov: "Is there a way to see how far long the running process is, start and finish time as well? Would be helpful":
// each row shows its step ("Stage 2 of 4", with a small bar), Started, and Est. finish while running/queued or Finished + how long it took once done (jobTimes, 13_shell.js).
// job 6 (owner 16 Nov: "I need a place to see ... what's in that night's automated tasks"): what the night session will do, in
// order: its fixed steps (progress/night, kept by NIGHT.md), the requests waiting in db runs (removable), what it skips and why,
// and how last night went. The night session works from the same two sources, so the card is the night's to-do list.
const NIGHT_KIND={cover_check:'Cover-page check',queue:'Import queue'};
function tonightHTML(){const N=QG.night||{},run=(typeof PQ!=='undefined'&&PQ.run)||null;if(run&&run.watch)run.watch();
  const req=run&&run.pending?run.pending():[],steps=N.steps||[],skip=N.skipped||[],last=N.last;
  if(!steps.length&&!req.length&&!last)return'';
  const st={done:'✓',failed:'✗',skipped:'–'};
  return `<section class="psec pr-night" aria-labelledby="pNightH"><h3 id="pNightH">Tonight${N.time?` <span class="pcount">${esc(N.time)}</span>`:''}</h3>
  <ol class="pqueue">${steps.map((x,i)=>`<li><span class="pnum" aria-hidden="true">${i+1}</span><div><b>${esc(x.title)}</b>${x.detail?`<p>${esc(x.detail)}</p>`:''}</div></li>`).join('')}
  ${req.map(r=>`<li><span class="pnum" aria-hidden="true">+</span><div><b>${esc(NIGHT_KIND[r.kind]||r.kind)}${r.papers?.length?`: ${r.papers.length} paper${r.papers.length===1?'':'s'}`:''}</b><p>Requested ${esc(ago(r.at))}${isOwnerV()?` · <button type="button" class="linkbtn" data-night-drop="${esc(r.id)}">Remove</button>`:''}</p></div></li>`).join('')}
  ${skip.map(x=>`<li class="pr-nskip"><span class="pnum" aria-hidden="true">–</span><div><b>${esc(x.title)}</b>${x.why?`<p>Skipped: ${esc(x.why)}</p>`:''}</div></li>`).join('')}</ol>
  ${last&&last.items?.length?`<details class="pr-nlast"><summary>Last night${last.at?`, ${esc(ago(last.at))}`:''}</summary><ul>${last.items.map(x=>`<li><span class="pr-nst" aria-hidden="true">${st[x.status]||'·'}</span><div><b>${esc(x.title)}</b>${x.result?`<p>${esc(x.result)}</p>`:''}</div></li>`).join('')}</ul></details>`:''}</section>`}
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-night-drop]');if(!b||typeof PQ==='undefined'||!PQ.run)return;b.disabled=true;PQ.run.drop(b.dataset.nightDrop)});
function renderProcesses(){const box=$('#procBox'),pv=$('#processesView');if(!box||!pv)return;
  const tab=pv.dataset.tab==='papers'?'papers':'work';
  $('#procWork').hidden=tab!=='work';$('#procPapers').hidden=tab!=='papers';
  $$('#procSw button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.ptab===tab)));moveAreaSlider();
  if(tab==='papers'){if(typeof PQ!=='undefined')PQ.render();renderImport();return}   // PQ: 32_papers_q.js, a later script block
  const run=runningNow(),que=queueItems('queued'),done=queueItems('done').reverse();
  const asked=x=>x.asked?`<p class="pasked">“${esc(String(x.asked).replace(/^["“]|["”]$/g,''))}”</p>`:'';
  const openDone=!!box.querySelector('details.pdone[open]');
  box.innerHTML=`<p class="sub">What Claude is working on now, and what you've asked for next.${QUEUE&&QUEUE.updated?` Queue updated ${esc(ago(QUEUE.updated))}.`:''}</p>
  <section class="psec" aria-labelledby="pRunH"><h3 id="pRunH">Running now${run.length?` <span class="pcount">${run.length}</span>`:''}</h3>
  ${run.length?`<div class="pcards">${run.map(j=>`<article class="pcard"><div class="pctop"><span class="pdot" aria-hidden="true"></span><b>${esc(j.name)}</b>${j.started?`<span class="pwhen">${esc(startedAgo(j.started))}</span>`:''}</div>${j.step?`<div class="pstep">${esc(j.step)}${stepBar(j.step)}</div>`:''}${jobTimes(j)}${j.detail?`<p>${esc(j.detail)}</p>`:''}${j.src==='queue'?`<span class="ptag">From the queue</span>`:''}${asked(j)}</article>`).join('')}</div>`:'<p class="pempty">Nothing running right now.</p>'}</section>
  ${tonightHTML()}
  <section class="psec" aria-labelledby="pQueH"><h3 id="pQueH">Queued${que.length?` <span class="pcount">${que.length}</span>`:''}</h3>
  ${que.length?`<ol class="pqueue">${que.map((x,i)=>`<li><span class="pnum" aria-hidden="true">${i+1}</span><div><b>${esc(x.title)}</b>${x.step?`<div class="pstep">${esc(x.step)}</div>`:''}${jobTimes(x)}${x.detail?`<p>${esc(x.detail)}</p>`:''}${asked(x)}</div></li>`).join('')}</ol>`:`<p class="pempty">${QUEUE?'Nothing queued. New requests will show here.':'No queue yet. Requests you line up will show here.'}</p>`}</section>
  ${done.length?`<section class="psec"><details class="pdone"${openDone?' open':''}><summary>Recently done <span class="pcount">${done.length}</span></summary><ul>${done.slice(0,20).map(x=>`<li><span class="pok" aria-hidden="true">✓</span><div><b>${esc(x.title)}</b>${jobTimes({...x,status:'done'})}${x.detail?`<p>${esc(x.detail)}</p>`:''}</div></li>`).join('')}</ul></details></section>`:''}`;
  if(typeof renderNotes==='function')renderNotes()}   // 31_notes.js loads in a later script block; the user answer can arrive before it
fetch('data/progress.json?v='+Date.now()).then(r=>r.ok?r.json():null).then(p=>{if(p&&!PROG){PROG=p;if(view==='processes')renderImport()}}).catch(()=>{});
setInterval(()=>{if(view==='processes')renderProcesses()},60000);   // keeps the "12 min ago" times fresh
/* Costs (owner 21 Nov: "I want to see somewhere the costs logged properly, per paper, per batch total", "Yeah build it"):
   Processes › Papers › Costs. Everything comes from data/costs.json (tools/costs.py, built from every logged API call); nothing
   here is typed in. Loaded when the section opens. */
const COST={d:null,open:new Set(),
  load(){if(COST.d)return Promise.resolve(COST.d);return fetch(QG.url('data/costs.json',Date.now())).then(r=>r.ok?r.json():null).then(d=>COST.d=d).catch(()=>null)},
  usd:x=>'US$'+(+x).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2}),
  steps:s=>Object.entries(s||{}).map(([k,v])=>`${esc(k)} ${COST.usd(v)}`).join(' · '),
  render(){const el=$('#costBox');if(!el)return;const d=COST.d;if(!d){el.innerHTML='<div class="empty">No cost log yet.</div>';return}
    const mon=Object.entries(d.months||{}),cur=mon.length?mon[mon.length-1]:null,pp=d.per_paper;
    const row=b=>{const op=COST.open.has(b.n);return `<tr class="pr-cb"><td><button type="button" class="linkbtn" data-costb="${b.n}" aria-expanded="${op}">${b.course==='standard'?'Standard batch '+String(b.n).slice(1):'Batch '+b.n}</button></td><td>${esc(b.date)}</td>
      <td class="n">${b.papers.length}</td><td class="n">${b.questions.toLocaleString('en-AU')}</td><td class="n"><b>${COST.usd(b.usd)}</b></td><td class="n">${COST.usd(b.per_paper)}</td><td class="n">${b.per_question!=null?COST.usd(b.per_question):'–'}</td></tr>
      ${op?`<tr class="pr-cd"><td colspan="7"><p class="pr-cst">By step: ${COST.steps(b.steps)}${b.shared_usd?` · not tied to one paper ${COST.usd(b.shared_usd)}`:''}</p>
        <table class="pr-ct pr-cp"><thead><tr><th>Paper</th><th class="n">Questions</th><th class="n">Cost</th><th class="n">Per question</th></tr></thead><tbody>
        ${b.papers.map(p=>`<tr><td>${esc(p.label)}</td><td class="n">${p.questions}</td><td class="n">${COST.usd(p.usd)}</td><td class="n">${p.questions?COST.usd(p.usd/p.questions):'–'}</td></tr>`).join('')}</tbody></table></td></tr>`:''}`};
    const unmetered=d.first_api_batch>1?`<p class="pr-cnote">Batches 1–${d.first_api_batch-1} ran inside Claude sessions before the API, so they have no per-call cost (not metered).</p>`:'';
    el.innerHTML=`<p class="pr-cnote">Every API call is logged with its paper and step. ${pp?`Average ${COST.usd(pp.mean)} a paper (batches range ${COST.usd(pp.lo)}–${COST.usd(pp.hi)}).`:''}
      ${cur?` This month ${COST.usd(cur[1])} of the ${COST.usd(d.limit_usd)} monthly limit.`:''} Updated ${esc(String(d.made||'').replace('T',' '))}.</p>
      <table class="pr-ct"><thead><tr><th>Batch</th><th>Date</th><th class="n">Papers</th><th class="n">Questions</th><th class="n">Total</th><th class="n">Per paper</th><th class="n">Per question</th></tr></thead>
      <tbody>${d.batches.map(row).join('')}</tbody><tfoot><tr><th colspan="4">All batches</th><th class="n">${COST.usd(d.batch_usd)}</th><th colspan="2"></th></tr></tfoot></table>
      ${(d.other||[]).length?`<h4 class="pr-ch">Other API spend</h4><ul class="pr-co">${d.other.map(o=>`<li>${esc(o.name)}: ${esc((o.steps||[]).join(', '))} · ${o.papers} papers · ${esc(o.from)}${o.to!==o.from?'–'+esc(o.to):''} · <b>${COST.usd(o.usd)}</b></li>`).join('')}</ul>`:''}
      <p class="pr-cnote">All API spend: ${COST.usd(d.total_usd)}${mon.length>1?' ('+mon.map(([m,v])=>`${esc(m)} ${COST.usd(v)}`).join(', ')+')':''}.</p>${unmetered}`}};
document.addEventListener('toggle',e=>{if(e.target.id==='procCost'&&e.target.open)COST.load().then(()=>COST.render())},true);
document.addEventListener('click',e=>{const b=e.target.closest('[data-costb]');if(b){const n=isNaN(+b.dataset.costb)?b.dataset.costb:+b.dataset.costb;COST.open.has(n)?COST.open.delete(n):COST.open.add(n);COST.render();return}
  if(e.target.closest('[data-costopen]')){e.preventDefault();const d=$('#procCost');if(d){d.open=true;d.scrollIntoView({block:'start'})}}});
