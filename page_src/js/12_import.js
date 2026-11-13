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
  return `<details class="brow"><summary><b>${esc(b.id)}</b><span class="st ${cls}">${esc(lab)}</span>
    ${stageCells(b)}
    <span class="muted">${n} paper${n===1?'':'s'}${b.questions?` · ${esc(String(b.questions))} questions`:''}</span></summary>
    <div class="bbody">${b.note?`<div class="muted">${esc(b.note)}</div>`:''}<div class="bstages">${STAGES.map(([k,l])=>{const v=(b.stages||{})[k]||'waiting';return `<span><span class="st ${v.replace('/','')}">${SLABEL[v]||esc(v)}</span> ${esc(l)}</span>`}).join('')}</div>
    <ul class="bpapers">${(b.papers||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div></details>`}
function batchesHTML(L){const g={done:[],running:[],failed:[],waiting:[]};L.forEach(b=>g[batchState(b)[0]].push(b));
  const grp=(arr,title,open)=>arr.length?`<details class="bgrp"${open?' open':''}><summary>${title} <span class="muted">· ${arr.length} batch${arr.length===1?'':'es'} · ${arr.reduce((n,b)=>n+(b.papers||[]).length,0)} papers</span></summary><div class="bscroll">${stageHead()}${arr.map(batchRow).join('')}</div></details>`:'';
  return `<p class="sub">Tap a batch to see its papers. – means the stage wasn't needed.</p>`+
    grp(g.failed,'Needs attention',true)+grp(g.running,'In progress',true)+grp(g.done,'Finished',false)+grp(g.waiting,'Waiting',false)}
function renderImport(){
  const P=PROG, box=$('#importBox'); if(!box) return;
  if(!P){box.innerHTML='<h2>Import</h2><div class="empty">No import progress recorded yet.</div>';return}
  const t=P.totals||{}, pct=(a,b)=>b?Math.round(100*a/b):0;
  const tile=(v,l,a,b)=>`<div class="tile"><b>${v??'–'}</b><span>${l}</span>${b?`<div class="bar"><i style="width:${pct(a,b)}%"></i></div>`:''}</div>`;
  const run=(P.running||[]);
  // owner 14 Nov ("Can make that page processes"): on Processes the dashboard sits under its Import heading, so its own
  // sub-headings use the page's small section labels, and its stage list is "Import stages running" (shown only when something
  // is), so the page no longer has two "Running now" headings.
  box.innerHTML=`<h2>Import</h2><p class="sub">Year 12 Advanced papers, newest first · updated ${esc(ago(P.updated))}${P.eta?` · ${esc(P.eta)}`:''}</p>
  <div class="tiles">${tile(`${t.parsed||0} / ${t.papers_total||0}`,'papers parsed',t.parsed,t.papers_total)}${tile(`${t.published||0} / ${t.papers_total||0}`,'papers on this page',t.published,t.papers_total)}
  ${tile(t.questions,'questions loaded')}${tile(`${t.figures_redrawn||0} / ${t.figures_total||0}`,'diagrams redrawn',t.figures_redrawn,t.figures_total)}${tile(t.solutions_written,'solutions written by Claude')}</div>
  ${run.length?`<h3>Import stages running</h3><ul>${run.map(r=>`<li><span class="pulse" aria-hidden="true"></span><b>${esc(r.stage)}</b> · ${esc(r.batch||'')} ${r.detail?'· '+esc(r.detail):''} <span class="muted">· started ${esc(ago(r.started))}</span></li>`).join('')}</ul>`:''}
  <h3>Batches</h3>${batchesHTML(P.batches||[])}
  ${(P.issues||[]).length?`<h3>Needs your decision</h3><ul>${P.issues.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}
  ${(P.log||[]).length?`<h3>Log</h3><ul class="log">${P.log.slice(-15).reverse().map(x=>`<li>${esc(x.t?new Date(x.t).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'')} · ${esc(x.msg)}</li>`).join('')}</ul>`:''}`;
}
/* ---------- Processes (owner 14 Nov: "Can u show this list of tasks on the artifact somewhere ... Can be on the same as import.
   Can make that page processes") ----------
   Top to bottom: Running now (progress/jobs + queue items marked running), Queued (progress/queue, in order, with the owner's
   own words in italics), Recently done (collapsed), then the import dashboard (renderImport, unchanged) under its Import heading. */
// owner 13 Nov: "Is there a way to see how far long the running process is, start and finish time as well? Would be helpful":
// each row shows its step ("Stage 2 of 4", with a small bar), Started, and Est. finish while running/queued or Finished + how long it took once done (jobTimes, 13_shell.js).
function renderProcesses(){const box=$('#procBox');if(!box)return;
  const run=runningNow(),que=queueItems('queued'),done=queueItems('done').reverse();
  const asked=x=>x.asked?`<p class="pasked">“${esc(String(x.asked).replace(/^["“]|["”]$/g,''))}”</p>`:'';
  const openDone=!!box.querySelector('details.pdone[open]');
  box.innerHTML=`<h2>Processes</h2><p class="sub">What Claude is working on now, and what you've asked for next.${QUEUE&&QUEUE.updated?` Queue updated ${esc(ago(QUEUE.updated))}.`:''}</p>
  <section class="psec" aria-labelledby="pRunH"><h3 id="pRunH">Running now${run.length?` <span class="pcount">${run.length}</span>`:''}</h3>
  ${run.length?`<div class="pcards">${run.map(j=>`<article class="pcard"><div class="pctop"><span class="pdot" aria-hidden="true"></span><b>${esc(j.name)}</b>${j.started?`<span class="pwhen">${esc(startedAgo(j.started))}</span>`:''}</div>${j.step?`<div class="pstep">${esc(j.step)}${stepBar(j.step)}</div>`:''}${jobTimes(j)}${j.detail?`<p>${esc(j.detail)}</p>`:''}${j.src==='queue'?`<span class="ptag">From the queue</span>`:''}${asked(j)}</article>`).join('')}</div>`:'<p class="pempty">Nothing running right now.</p>'}</section>
  <section class="psec" aria-labelledby="pQueH"><h3 id="pQueH">Queued${que.length?` <span class="pcount">${que.length}</span>`:''}</h3>
  ${que.length?`<ol class="pqueue">${que.map((x,i)=>`<li><span class="pnum" aria-hidden="true">${i+1}</span><div><b>${esc(x.title)}</b>${x.step?`<div class="pstep">${esc(x.step)}</div>`:''}${jobTimes(x)}${x.detail?`<p>${esc(x.detail)}</p>`:''}${asked(x)}</div></li>`).join('')}</ol>`:`<p class="pempty">${QUEUE?'Nothing queued. New requests will show here.':'No queue yet. Requests you line up will show here.'}</p>`}</section>
  ${done.length?`<section class="psec"><details class="pdone"${openDone?' open':''}><summary>Recently done <span class="pcount">${done.length}</span></summary><ul>${done.slice(0,20).map(x=>`<li><span class="pok" aria-hidden="true">✓</span><div><b>${esc(x.title)}</b>${jobTimes({...x,status:'done'})}${x.detail?`<p>${esc(x.detail)}</p>`:''}</div></li>`).join('')}</ul></details></section>`:''}`;
  if(typeof PQ!=='undefined')PQ.render();   // owner 13 Nov: "me choosing which set of papers to import next" (32_papers_q.js, own script block)
  if(typeof renderNotes==='function')renderNotes()}   // 31_notes.js loads in a later script block; the user answer can arrive before it
fetch('data/progress.json?v='+Date.now()).then(r=>r.ok?r.json():null).then(p=>{if(p&&!PROG){PROG=p;if(view==='processes')renderImport()}}).catch(()=>{});
setInterval(()=>{if(view==='processes'){renderProcesses();renderImport()}},60000);   // keeps the "12 min ago" times fresh
