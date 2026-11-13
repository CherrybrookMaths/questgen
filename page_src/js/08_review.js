/* ---------- Review ---------- */
const FILTERS=[['recent','Recently approved (newest first)'],['decide','Needs your decision'],['scanqs','Scans: question + solution'],['digitalqs','Digital: quick skim'],['diagrams','Diagrams to approve'],['generated','Generated solutions'],['review','Parse flagged'],['no_match','No match'],['removed','Old syllabus'],['standard','Standard course'],['scan','Scans'],['duplicate','Near-duplicates'],['audited','Self-audited'],['changes','Diagram changes requested'],['redone','Redrawn from your notes'],['all','All questions']];
const qFigs=q=>figKeys(q).all.filter(redrawable);
const qGen=q=>q.solutions.filter(s=>s.source==='generated');
// owner 12 Nov: "way too many pills, not sure what I'm meant to check and in what order". Four steps, in order.
const STEPS=[['decide','Decide','Calls only you can make: a correction to a school\u2019s or NESA\u2019s solution, a possible error in the source, a borderline syllabus call.'],
  ['check','Check','Every question with a table (check it against the page), plus anything the automatic checks or the independent maths checker could not clear. Each one says why and what to look at.'],
  ['sample','Spot-check','A random 10% of each paper that passed every check. When a paper\u2019s sample is all fine, approve the rest of that paper in one click.'],
  ['diagrams','Diagrams','Every redrawn diagram, one question at a time, original beside redraw. A approves, F flags (type the reason, Enter sends), K next, J back.'],
  ['tags','Tags','Questions where the tagger and the independent checker would file the question under a different topic (its home: the topic carrying most of the marks). Pick the right home from the question: 1 tagger, 2 checker, F pick a dot point in another topic. Gates are automatic and shown for information only.']];
const paperOK=doc=>reviews['paper_'+doc]?.status==='approved';
const chkFigsAll=q=>q.tri?q.tri.chk_figs.filter(redrawable):qFigs(q);
// owner 12 Nov ("yeah do that"): High-confidence diagrams (question graphs, blank axes: 48 of 50 approved) are spot-checked,
// not checked one by one: a stable random 10% per paper (at least 1) stays in the queue. A flag on any High diagram of a
// paper puts all of that paper's High diagrams back on full check. Already-decided diagrams always stay visible.
let _spot=null;
function hstr(x){let h=2166136261;for(const c of x){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
function spotSet(){if(_spot)return _spot;const by={};B.questions.forEach(q=>{if(q.dup_of)return;chkFigsAll(q).forEach(k=>{if(figRisk(k)[0]==='High')(by[q.doc]=by[q.doc]||[]).push(k)})});
  const keep=new Set();Object.values(by).forEach(ks=>{ks.sort((a,b)=>hstr(a)-hstr(b));ks.slice(0,Math.max(1,Math.ceil(ks.length/10))).forEach(k=>keep.add(k))});return _spot=keep}
function escalated(doc){return B.questions.some(q=>q.doc===doc&&chkFigsAll(q).some(k=>figRisk(k)[0]==='High'&&reviews['q'+q.id]?.fig?.[k]==='changes'))}
const chkFigs=q=>chkFigsAll(q).filter(k=>figRisk(k)[0]!=='High'||spotSet().has(k)||reviews['q'+q.id]?.fig?.[k]||escalated(q.doc));
function qState(q){const r=reviews['q'+(q.dup_of||q.id)]?.status; if(r) return r; const t=q.tri?.tier; if(t==='auto'&&paperOK(q.doc)) return 'approved'; return null}
function needsDecision(q){if(reviews['q'+q.id]?.status==='flagged')return true;
  if(q.tri)return q.tri.tier==='decide';   // imported questions: triage already decided (a correction the independent checker confirmed is NOT a decision) — owner 12 Nov: "why is this in decide?"
  return !!q.decide||q.solutions.some(x=>(x.meta||{}).source_flag||(x.meta||{}).corrected)}
// owner 12 Nov: "I need a list of recently approved in case" — newest approvals first; F re-flags, the note says why
function approvedAt(q){const r=reviews['q'+q.id];if(r?.status==='approved')return r.at||'';const pr=reviews['paper_'+q.doc];if(pr?.status==='approved'&&q.tri?.tier==='auto'&&!r?.status)return pr.at||'';return null}
function inFilter(q,f){if(f==='recent')return !q.dup_of&&approvedAt(q)!=null;if(f==='tags')return homeNeed(q);if(f==='all')return !q.dup_of;if(f==='check'||f==='sample')return !q.dup_of&&q.tri?.tier===f;if(f==='decide')return !q.dup_of&&(q.tri?.tier==='decide'||needsDecision(q));if(f==='diagrams')return !q.dup_of&&chkFigs(q).length>0;if(f==='decide')return !q.dup_of&&needsDecision(q);if(f==='scanqs')return !q.dup_of&&q.queues.includes('scan');if(f==='digitalqs')return !q.dup_of&&!q.queues.includes('scan');if(f==='diagrams')return !q.dup_of&&qFigs(q).length>0;if(f==='changes')return qFigs(q).some(k=>figDec(q,k)==='changes');if(f==='redone')return Object.keys(reviews['q'+q.id]?.fig_done||{}).length>0;if(f==='generated')return !q.dup_of&&qGen(q).length>0;return !q.dup_of&&q.queues.includes(f)}   // owner: hidden duplicate copies never count in a queue ("they are misleading")
function isTodo(q,f){if(q.dup_of)return false;if(f==='tags')return !reviews['q'+q.id]?.home&&!partsDone(q);   // a hidden copy follows the copy that was reviewed
  if(f==='decide')return reviews['q'+q.id]?.status!=='approved';if(f==='diagrams')return chkFigs(q).some(k=>!reviews['q'+q.id]?.fig?.[k]);if(f==='check'||f==='sample')return !reviews['q'+q.id]?.status;if(f==='redone')return Object.keys(reviews['q'+q.id]?.fig_done||{}).some(k=>!figDec(q,k));if(f==='changes')return qFigs(q).some(k=>figDec(q,k)==='changes');if(f==='diagrams')return qFigs(q).some(k=>!figDec(q,k));if(f==='generated')return qGen(q).some(s=>!solDec(q,s));return !reviews['q'+q.id]?.status}
function statusOK(q){const r=reviews['q'+(q.dup_of||q.id)];if(rstatus==='any')return true;if(rstatus==='todo')return isTodo(q,rfilter);return r?.status===rstatus}
let pendingOpen=null;
// owner 12 Nov: diagram confidence by type, from first-look flag rates (297 reviewed). Riskiest first in the Diagrams queue.
const RISK={table:['Low',3,'tables: 80% flagged'],table_drawn:['Low',3,'tables: 80% flagged'],'geometry·s':['Low',3,'geometry solution sketches: 64% flagged'],'other·s':['Low',3,'other solution sketches: 44% flagged'],'tree·s':['Low',3,'tree diagrams: few reviewed'],tree:['Low',3,'tree diagrams: few reviewed'],'graph·s':['Medium',2,'graph solution sketches: 18% flagged'],'statistical·s':['Medium',2,'statistical solution sketches'],statistical:['Medium',2,'statistical: 14% flagged'],geometry:['Medium',2,'geometry: 13% flagged'],graph:['High',1,'question graphs: spot-check (48 of 50 approved)'],blank_axes:['High',1,'blank axes: spot-check'],other:['Medium',2,'other diagrams'],photo:['Medium',2,'photos']};
function figRisk(k){const f=B.figs[k]||{};const c=f.status==='table'?'table':(f.cls||'other');return RISK[c+(/_s\d+$/.test(k)?'·s':'')]||RISK[c]||['Medium',2,'']}
function qRisk(q){return Math.max(0,...chkFigs(q).map(k=>figRisk(k)[1]))}
// owner 12 Nov: "where do i go and batch approve the rest?" -> papers whose spot-check is clean, approvable from the Review header
function readyPapers(){const out=[];for(const doc in B.docs){const qs=B.questions.filter(q=>String(q.doc)===doc&&!q.dup_of),smp=qs.filter(q=>q.tri?.tier==='sample'),rest=qs.filter(q=>q.tri?.tier==='auto'&&!reviews['q'+q.id]?.status);
  if(!rest.length||paperOK(+doc)||paperOK(doc))continue; if(!smp.length||smp.some(q=>reviews['q'+q.id]?.status!=='approved'))continue; out.push([doc,rest.length,smp.length])}return out}
function readyHTML(){const r=readyPapers(); if(!r.length) return ''; const n=r.reduce((a,x)=>a+x[1],0);
  return `<details class="banner ready"><summary><span><b>${r.length} paper${r.length>1?'s':''} ready:</b> every spot-checked question is approved, so the other ${n} questions can go in the bank.</span> <button class="act ok" id="approveReady">Approve all ${n}</button></summary>
    <ul class="help">${r.map(([d,k,m])=>`<li>${esc(docLabel(B.docs[d]))}: ${m} spot-checked, ${k} to approve <button class="act ghost" data-paperok="${d}">Approve this paper</button></li>`).join('')}</ul></details>`}
async function approveReady(){const r=readyPapers(); for(const [d] of r) await approvePaper(d); toast(r.length+' papers approved')}
document.addEventListener('click',e=>{if(e.target.closest('#approveReady')){e.preventDefault();approveReady()}});
// owner 15 Nov: "Lets do 2 as well". Difficulty and Reports are steps inside Review, after Decide, Check, Spot-check, Diagrams
// and Tags, with their counts (parts still to check in the chosen Difficulty list; open reports). They open their own
// pages (#review/difficulty, #review/reports) under the same step row; the paper picker and ← → belong to the question steps only.
const XSTEPS=[['difficulty','Difficulty','levels','HSC reference ratings: one part at a time, Agree or change the band and kind (2\u20136 set the band, F / P the kind, Enter or A saves).'],
  ['reports','Reports','reports','Questions reported from an exam paper for a wrong difficulty, a wrong dot point or something else. Resolve or dismiss each one.']];
function xstepN(k){try{if(k==='difficulty')return typeof lvTodoN==='function'?lvTodoN():0;if(k==='reports')return typeof repOpen==='function'?repOpen().length:0}catch(e){}return 0}
function renderSteps(){if(!B)return;
  const base=B.questions.filter(q=>!rdoc||String(q.doc)===rdoc);
  const sc=STEPS.map(([k])=>base.filter(q=>inFilter(q,k)&&isTodo(q,k)).length);
  const xs=XSTEPS.find(x=>x[2]===view),onQ=!xs;
  const cur=onQ?STEPS.find(x=>x[0]===rfilter):null;
  const dleft=base.filter(q=>inFilter(q,'diagrams')).reduce((n,q)=>n+chkFigs(q).filter(k=>!reviews['q'+q.id]?.fig?.[k]).length,0);   // owner 12 Nov: "why does my diagram review say 468" -> label the unit
  $('#filters').innerHTML=STEPS.map(([k,l],i)=>`<button class="step${sc[i]?'':' empty0'}" data-f="${k}" aria-pressed="${onQ&&k===rfilter}"><span class="num">${i+1}</span>${l}<span class="n" title="${sc[i]} question${sc[i]===1?'':'s'} to do${k==='diagrams'?' · '+dleft+' diagrams':''}">${sc[i]}</span></button>`).join('')
    +XSTEPS.map(([k,l,v],i)=>{const n=xstepN(k);return `<button class="step${n?'':' empty0'}" data-f="${k}" aria-pressed="${view===v}"><span class="num">${STEPS.length+i+1}</span>${l}<span class="n" title="${n} ${k==='reports'?'open report'+(n===1?'':'s'):'part'+(n===1?'':'s')+' to check'}">${n}</span></button>`}).join('')
    +`<button class="act ghost" id="recentBtn" aria-pressed="${onQ&&rfilter==='recent'}">Recently approved</button><details class="more"><summary>Other lists</summary><select id="moreF" aria-label="Other lists"><option value="">Choose…</option>${FILTERS.filter(([k])=>!['decide','diagrams'].includes(k)).map(([k,l])=>`<option value="${k}"${onQ&&k===rfilter?' selected':''}>${l}</option>`).join('')}</select></details>`
    +(onQ?readyHTML():'')+`<p class="stephelp">${xs?esc(xs[3]):`${rfilter==='diagrams'?`<b>${sc[STEPS.findIndex(x=>x[0]==='diagrams')]} questions · ${dleft} diagrams left.</b> `:''}${cur?esc(cur[2]):'Showing: '+esc((FILTERS.find(f=>f[0]===rfilter)||[,''])[1])+' (any status). Pick a numbered step to go back to your queue.'}`}</p>`;
  $('#recentBtn')&&($('#recentBtn').onclick=()=>goStep('recent','any'));
  const mf=$('#moreF'); if(mf) mf.onchange=()=>{if(!mf.value)return;goStep(mf.value,'any')};
  try{const fs=$('#filters'),pb=fs.querySelector('.step[aria-pressed="true"]');if(pb&&fs.scrollWidth>fs.clientWidth){const a=fs.getBoundingClientRect(),b=pb.getBoundingClientRect();fs.scrollLeft+=b.left-a.left-(a.width-b.width)/2}}catch(e){}   // phone: the step row scrolls; keep the open step in sight (Difficulty and Reports sit at its end)
  return {base}}
// open a Review step: a question step re-draws Review (going back to #review from Difficulty or Reports); the two page steps change the address
function goStep(f,st){const xs=XSTEPS.find(x=>x[0]===f);if(xs){location.hash=VHASH[xs[2]];return}
  rfilter=f;rstatus=st||'todo';save('rf2',rfilter);ridx=0;if(view!=='review'){location.hash='#review';return}refreshReview()}
function refreshReview(){ if(typeof renderJobs==='function')renderJobs();
  const {base}=renderSteps();
  rlist=base.filter(q=>inFilter(q,rfilter)&&statusOK(q));
  if(rfilter==='diagrams') rlist.sort((a,b)=>qRisk(b)-qRisk(a));
  if(rfilter==='recent') rlist.sort((a,b)=>String(approvedAt(b)).localeCompare(String(approvedAt(a))));   // riskiest diagrams first (stable: paper order within a level)
  if(pendingOpen){const i=rlist.findIndex(q=>q.id===pendingOpen);if(i>=0)ridx=i;pendingOpen=null}
  if(ridx>=rlist.length) ridx=Math.max(0,rlist.length-1);
  renderReview();
}
const figMode={};
function figCompareHTML(q){
  const ks=qFigs(q); if(!ks.length) return '';
  const row=k=>{const f=B.figs[k],dec=figDec(q,k);
    const right=f.status==='table'?dtHTML(f.table,{blank:true}):`<img class="fig" alt="Redrawn" data-k="${k}" data-kind="svg">`;
    const done=reviews['q'+q.id]?.fig_done?.[k]; const hasV1=f.status!=='table'&&f.cls!=='table_drawn';
    const mode=figMode[k]||(done&&!dec?'before':'side');
    const tabs=f.status==='table'?'':`<div class="seg" role="group" aria-label="View">${[['side','Side by side'],['overlay','Overlay'],...(hasV1?[['before','Before → now']]:[])].map(([m,l])=>`<button class="segb" data-fmode="${k}" data-m="${m}" aria-pressed="${m===mode}">${l}</button>`).join('')}</div>`;
    const ov=f.ov?`<div class="help">Overlap with the original: <b>${Math.round(f.ov[0]*100)}%</b> of the original's ink lies on the redraw and <b>${Math.round(f.ov[1]*100)}%</b> of the redraw's ink lies on the original (within 2 px). Thin lines against thick scanned strokes and different stipple dots lower this without being errors.</div>`:'';
    const views={
      side:`<div class="cmp"><figure><figcaption>Original</figcaption><img class="fig" alt="Original" data-k="${k}" data-kind="png"></figure><figure><figcaption>${f.status==='table'?'As a table':'Redrawn (now)'}</figcaption>${right}</figure></div>`,
      overlay:`<figure class="ovfig"><figcaption><span style="color:#e12d2d">■ only in original</span> · <span style="color:#285ae6">■ only in redraw</span> · <span style="color:var(--ink)">■ both</span></figcaption><img class="fig" alt="Overlay of original and redraw" data-k="${k}" data-kind="ov"></figure>${ov}`,
      before:`${done?`<div class="callout"><b>Your note:</b> ${esc(done)}</div>`:''}<div class="cmp3"><figure><figcaption>Original</figcaption><img class="fig" alt="Original" data-k="${k}" data-kind="png"></figure><figure><figcaption>Before (the version you reviewed)</figcaption><img class="fig" alt="First redraw" data-k="${k}" data-kind="v1"></figure><figure><figcaption>Now</figcaption>${right}</figure></div>`};
    return `<div class="figrow">${tabs}${views[f.status==='table'?'side':mode]}
      <div class="row">${f.status==='approx'?'<span class="badge b-scan">estimated shape</span>':''}${f.check==='fixed'?'<span class="badge b-acc">fixed by checker</span>':''}${f.check==='concern'?'<span class="badge b-bad">checker concern</span>':''}
        ${dec?`<span class="badge ${dec==='approved'?'b-ok':dec==='changes'?'b-gen':'b-bad'}">${dec==='approved'?'redraw approved':dec==='changes'?'changes requested':'keeping original'}</span>`:''}</div>
      ${!dec&&done&&mode!=='before'?`<div class="callout"><b>Redrawn from your note:</b> ${esc(done)}</div>`:''}
      ${dec==='changes'&&reviews['q'+q.id]?.fig_notes?.[k]?`<div class="callout"><b>Your request:</b> ${esc(reviews['q'+q.id].fig_notes[k])}</div>`:''}
      ${f.notes?`<details class="help"><summary>What was changed</summary>${esc(f.notes).split(' | ').map(x=>`<div>${x}</div>`).join('')}</details>`:''}${f.check_notes&&f.check!=='pass'?`<div class="help"><b>Checker:</b> ${esc(f.check_notes)}</div>`:''}
      <div class="row"><button class="act ok" data-fig="${k}" data-v="approved">Use redraw</button><button class="act" data-figreq="${k}">Request changes</button><button class="act warn" data-fig="${k}" data-v="rejected">Keep original</button></div>
      <div class="req" data-reqbox="${k}" hidden><label class="help" for="rq-${k}">What should change in the redraw? Claude redraws it from this note in the next session.</label><textarea id="rq-${k}" placeholder="e.g. Make it match the original sketch proportions; label the angle at B as 30°">${esc(reviews['q'+q.id]?.fig_notes?.[k]||'')}</textarea><div class="row"><button class="act ok" data-reqsave="${k}">Save request</button><button class="act ghost" data-reqcancel="${k}">Cancel</button></div></div></div>`};
  const pend=ks.filter(k=>figDec(q,k)!=='approved'), ok=ks.filter(k=>figDec(q,k)==='approved');
  const okBlock=ok.length?`<details class="figdone"><summary>✓ ${ok.length} diagram${ok.length>1?'s':''} approved · show comparison</summary>${ok.map(row).join('')}</details>`:'';
  if(!pend.length) return okBlock;   // nothing to decide: stay out of the way of the question and solution
  return `<div class="section"><h4>Diagrams to check · original vs redraw</h4>${pend.map(row).join('')}
    ${pend.length>1?`<div class="row"><button class="act ok" id="figAll">Use all redraws on this question <kbd>D</kbd></button></div>`:''}${okBlock}</div>`;
}
function tagEditHTML(q,p){
  return `<div class="tags">${effTags(q,p).map(t=>chipHTML(t,p)).join('')}<button class="act ghost edit-tag" data-part="${p.id}">Change tag</button></div>${editing===p.id?pickerHTML():''}${p.note?`<div class="notes">${esc(p.note)}</div>`:''}`;
}
function pickerHTML(){return `<div class="picker"><input id="pickQ" type="search" placeholder="Search dot points: e.g. chain rule, annuity, Y12-220" aria-label="Search dot points">
  <div class="row"><button class="act" id="setRemoved">Mark removed content</button><button class="act" id="setNoMatch">Mark no match</button><button class="act" id="cancelPick">Cancel</button></div><ul id="pickList"></ul></div>`}
function whyHTML(q){
  const t=q.tri; if(!t) return '';
  const cls=t.tier==='decide'?'decide':t.tier==='sample'?'sample':'';
  return `<div class="why ${cls}"><b>Why this is here</b><ul>${t.why.map(w=>`<li>${esc(w)}</li>`).join('')||'<li>Passed every check</li>'}</ul>${t.look.length?`<b>What to check</b><ol>${t.look.map(w=>`<li>${esc(w)}</li>`).join('')}</ol>`:''}</div>`}
function sampleBanner(doc){
  const qs=B.questions.filter(q=>q.doc===doc&&!q.dup_of), smp=qs.filter(q=>q.tri?.tier==='sample'), rest=qs.filter(q=>q.tri?.tier==='auto');
  if(!smp.length||!rest.length||paperOK(doc)) return paperOK(doc)?`<div class="banner">✓ ${esc(docLabel(B.docs[doc]))}: spot-check clean, the other ${rest.length} questions are approved.</div>`:'';
  const ok=smp.filter(q=>reviews['q'+q.id]?.status==='approved').length, bad=smp.filter(q=>reviews['q'+q.id]?.status==='flagged').length;
  if(bad) return `<div class="why"><b>Spot-check</b>${bad} of ${smp.length} sampled questions in ${esc(docLabel(B.docs[doc]))} were flagged, so the rest of this paper stays unapproved. Claude will re-check the paper.</div>`;
  if(ok<smp.length) return `<div class="help">Spot-check for ${esc(docLabel(B.docs[doc]))}: ${ok} of ${smp.length} done. When all are fine you can approve the other ${rest.length} questions in one click.</div>`;
  return `<div class="banner"><span>All ${smp.length} spot-checked questions in <b>${esc(docLabel(B.docs[doc]))}</b> are fine.</span><button class="act ok" data-paperok="${doc}">Approve the other ${rest.length} questions in this paper</button></div>`}
async function approvePaper(doc){const key='paper_'+doc;const next={status:'approved',doc:+doc,by:me||null,at:new Date().toISOString()};reviews[key]=next;TOPICS=null;
  if(!db){toast('Not saved: this view has no shared storage');return}
  try{await db.doc('reviews/'+key).set(next);toast('Paper approved')}catch(e){toast('Could not save. Try again in a moment.')}refreshReview()}
// owner 12 Nov: "one question per page ... K should be to go next. Bind a keystroke to approve, bind a keystroke to flag ...
// pull up a textbox ... hit enter to send the flag through. Keep a log on the side ... That can collapse as well."
let logOpen=(()=>{try{return localStorage.getItem('dlog')!=='0'}catch(e){return true}})();
function diagLog(){
  const rows=[];
  Object.entries(reviews).forEach(([k,r])=>{if(!k.startsWith('q')||!r?.fig||!r.at)return;const q=B.questions.find(x=>'q'+x.id===k);if(!q)return;
    const ks=Object.keys(r.fig).filter(f=>chkFigs(q).includes(f)||qFigs(q).includes(f));if(!ks.length)return;
    const fl=ks.filter(f=>r.fig[f]!=='approved');rows.push({q,at:r.at,flag:fl.length?(r.fig_notes?.[fl[0]]||'flagged'):null,nf:fl.length,n:ks.length})});
  rows.sort((x,y)=>y.at.localeCompare(x.at));
  return `<aside class="dlog${logOpen?'':' shut'}"><button class="act ghost" id="logT" aria-expanded="${logOpen}">${logOpen?'Hide log ›':'‹ Log'}</button>
    ${logOpen?`<h4>Recent decisions</h4>${rows.length?`<ul>${rows.slice(0,25).map(r=>`<li class="${r.flag?'fl':'ok'}"><button class="lk" data-logq="${r.q.id}">${qid(r.q)}</button> <span class="muted">${esc(srcLine(r.q))}</span><div>${r.flag?'⚑ '+(r.nf<r.n?`${r.nf} of ${r.n}: `:'')+esc(r.flag):'✓ approved'+(r.n>1?` (${r.n})`:'')} <span class="muted">· ${esc(ago(r.at))}</span> <button class="lk" data-undo="${r.q.id}">undo</button></div></li>`).join('')}</ul>`:'<p class="muted">Nothing yet.</p>'}`:''}</aside>`}
// owner 12 Nov: "How often should I hand diagram flags to you? Should we show in the UI when to do that?"
// A flag stays 'changes' until Claude redraws it and clears it, so the count of 'changes' = flags not yet handed over.
const HANDOFF_AT=15;
function pendingFlags(){let n=0;const qs=new Set();Object.entries(reviews).forEach(([k,r])=>{Object.values(r?.fig||{}).forEach(v=>{if(v==='changes'){n++;qs.add(k)}})});return [n,qs.size]}
function handoffHTML(){const [n,nq]=pendingFlags();if(!n)return'';const due=n>=HANDOFF_AT;
  return `<div class="handoff${due?' due':''}"><b>${n} flag${n===1?'':'s'} waiting for Claude</b> <span class="muted">(${nq} question${nq===1?'':'s'})</span> · ${due?'Time to hand these over: tell Claude <i>"check my diagram flags"</i>.':`Hand over at ${HANDOFF_AT}, at the end of a session, or sooner if the same new kind of problem shows up twice.`}</div>`}
function renderDiag(){
  const q=rlist[ridx];
  const done=rlist.filter(x=>!isTodo(x,'diagrams')).length;
  $('#pos').textContent=rlist.length?`Question ${ridx+1} of ${rlist.length} · ${rlist.length-done} questions left`:'0 / 0'; $('#prog').style.width=(rlist.length?100*done/rlist.length:0)+'%';
  if(!q){$('#rout').innerHTML=handoffHTML()+`<div class="dwrap"><div class="empty">No diagrams waiting. ${nextStepHTML()}</div>${diagLog()}</div>`;bindNext();bindLog();return}
  const ks=chkFigs(q), r=reviews['q'+q.id]||{};
  $('#rout').innerHTML=handoffHTML()+`<div class="dwrap"><div class="dmain">
    <div class="row"><b style="font-size:18px">${qid(q)}</b><span class="muted">${esc(srcLine(q))} · ${ks.length} diagram${ks.length>1?'s':''}</span></div>
    ${ks.map((k,i)=>{const f=B.figs[k],dec=r.fig?.[k];return `<div class="dq${dec?' decided':''}"><div class="dnum">${ks.length>1?`<kbd>${i+1}</kbd> Diagram ${i+1} of ${ks.length} · `:''}${/_s\d+$/.test(k)?'solution':'question'} · <span class="conf c${figRisk(k)[1]}" title="${esc(figRisk(k)[2])}">${figRisk(k)[0]} confidence</span> <span class="muted">${esc(figRisk(k)[2])}</span></div><div class="cmp"><figure><figcaption>Original</figcaption><img class="fig" alt="Original" data-k="${k}" data-kind="png"></figure><figure><figcaption>${f.status==='table'?'As a table':'Redrawn'}</figcaption>${f.status==='table'?dtHTML(f.table,{blank:true}):`<img class="fig" alt="Redrawn" data-k="${k}" data-kind="svg">`}</figure></div>
      ${dec?`<span class="badge ${dec==='approved'?'b-ok':'b-bad'}">${dec==='approved'?'approved':'flagged: '+esc(r.fig_notes?.[k]||'')}</span>`:''}${f.notes?`<details class="help"><summary>What the redraw changed</summary>${esc(f.notes).split(' | ').slice(-2).map(x=>`<div>${x}</div>`).join('')}</details>`:''}</div>`}).join('')}
    <details class="help"><summary>Question text</summary><div class="qtext">${qBody(q,'review')}</div></details>
    <div class="row keys"><button class="act ok" id="dA"><kbd>A</kbd> Approve</button><button class="act warn" id="dF"><kbd>F</kbd> Flag</button><span class="help"><kbd>J</kbd> previous · <kbd>K</kbd> next</span></div>
    <div class="flagbox" id="flagbox" hidden>${ks.length>1?`<div class="row" id="flagpick">${ks.map((k,i)=>`<label class="pick"><input type="checkbox" data-fk="${k}"> ${i+1}</label>`).join('')}<span class="help">Which diagram? Press its number (press again to untick; several allowed), then type the reason. None picked = all.</span></div>`:''}<label class="help" for="flagtxt">What's wrong? <kbd>Enter</kbd> sends the flag, <kbd>Esc</kbd> cancels.</label><input id="flagtxt" type="text" placeholder="e.g. label B is on the wrong vertex"></div>
  </div>${diagLog()}</div>`;
  hydrate($('#rout'),q,'review'); typeset($('#rout'));
  $('#dA').onclick=()=>diagDecide('approved'); $('#dF').onclick=openFlag;
  const ft=$('#flagtxt'); ft.onkeydown=e=>{if(/^[1-9]$/.test(e.key)&&!ft.value&&$('#flagpick')){e.preventDefault();pickDiag(+e.key);return}if(e.key==='Enter'){e.preventDefault();let t=ft.value.trim();const sel=new Set($$('#flagpick [data-fk]').filter(c=>c.checked).map(c=>c.dataset.fk));
    const m=ks.length>1&&t.match(/^([1-9](?:\s*[,&]\s*[1-9])*)\s*[:\-.)]?\s+(.*)$/);if(m){m[1].split(/[,&]/).forEach(d=>{const k=ks[+d.trim()-1];if(k)sel.add(k)});t=m[2].trim()}
    if(!t){toast('Type a reason first');return}diagDecide('changes',t,sel.size?[...sel]:null)}else if(e.key==='Escape'){$('#flagbox').hidden=true;ft.value=''}};
  $$('#flagpick [data-fk]').forEach(c=>c.onchange=markPicked);
  bindLog();
}
function pickDiag(n){const c=$$('#flagpick [data-fk]')[n-1];if(!c)return;c.checked=!c.checked;markPicked()}
function markPicked(){const sel=new Set($$('#flagpick [data-fk]').filter(c=>c.checked).map(c=>c.dataset.fk));$$('#rout .dq').forEach((d,i)=>d.classList.toggle('picked',sel.has(chkFigs(rlist[ridx])[i])))}
function openFlag(){const b=$('#flagbox');if(!b)return;b.hidden=false;$('#flagtxt').focus()}
async function diagDecide(v,note,only){const q=rlist[ridx];if(!q)return;const r=reviews['q'+q.id]||{};const ks=chkFigs(q);
  // owner 12 Nov: flag one diagram, not all of them ("21 flagged" was really ~12). Flagging some approves the rest on the page.
  const fig={...(r.fig||{})},notes={...(r.fig_notes||{})};ks.forEach(k=>{const hit=!only||only.includes(k);fig[k]=hit?v:(fig[k]||'approved');if(note&&hit)notes[k]=note});
  write(q,note?{fig,fig_notes:notes}:{fig}); const was=q.id; refreshReview();   // move on at once; the save finishes in the background
  if(rlist[ridx]?.id===was) go(1); window.scrollTo({top:0});}   // the decided question leaves the to-do list; the next one takes its place
function bindLog(){
  $('#logT')&&($('#logT').onclick=()=>{logOpen=!logOpen;try{localStorage.setItem('dlog',logOpen?'1':'0')}catch(e){}renderDiag()});
  $$('#rout [data-logq]').forEach(b=>b.onclick=()=>{rstatus='any';pendingOpen=+b.dataset.logq;refreshReview()});
  $$('#rout [data-undo]').forEach(b=>b.onclick=async()=>{const q=B.questions.find(x=>x.id===+b.dataset.undo);const r=reviews['q'+q.id]||{};const fig={...(r.fig||{})};
    chkFigs(q).forEach(k=>delete fig[k]);await write(q,{fig});toast('Undone: '+qid(q)+' is back in the list');refreshReview()});
}
function nextStepHTML(){const base=B.questions.filter(q=>!rdoc||String(q.doc)===rdoc);const nx=STEPS.map(([k,l],i)=>[k,l,i,base.filter(q=>inFilter(q,k)&&isTodo(q,k)).length]).filter(x=>x[0]!==rfilter&&x[3]>0);
  return nx.length?`<div class="row" style="margin-top:10px">${nx.map(([k,l,i,n])=>`<button class="act" data-gof="${k}">Go to ${i+1}. ${l} · ${n}</button>`).join('')}</div>`:'<div style="margin-top:8px">Your queue is empty: everything imported so far is checked.</div>'}
function bindNext(){$$('#rout [data-gof]').forEach(b=>b.onclick=()=>{rfilter=b.dataset.gof;rstatus='todo';save('rf2',rfilter);ridx=0;refreshReview()})}
/* owner 12 Nov ("lets do that"): Tags step — choose between tagger (A) and checker (B) where they disagreed a lot */
function dpChip(id,role,other){const d=DM[id]||{};const diff=!other.has(id);
  return `<span class="tdp${diff?' tdiff':''}" title="${esc(id+' · '+(d.fa||'')+(d.sub?' › '+d.sub:'')+' — '+(d.text||''))}"><span class="yb y${d.yl||''}">Y${d.yl||'?'}</span><span class="tid">${esc(id)}</span> ${esc(d.short||d.sub||d.fa||'')}${role==='primary'?'':' <span class="muted">(also)</span>'}</span>`}
function sideHTML(x,o,lab,key,chosen){
  const od=new Set(o.dp.map(d=>d[0])),orq=new Set(o.req),oc=new Set(o.can);
  const sk=(arr,oth)=>arr.length?arr.map(k=>`<span class="tsk${oth.has(k)?'':' tdiff'}">${esc(k)}</span>`).join(''):'<span class="muted">none</span>';
  return `<div class="tside${chosen===key?' chosen':''}"><div class="thead"><kbd>${key==='A'?1:2}</kbd> ${lab}${x.conf!=null?` <span class="muted">· confidence ${x.conf}</span>`:''}${chosen===key?' <span class="badge b-ok">kept</span>':''}</div>
    ${x.removed?`<div class="trow"><b>Removed from 2024 syllabus</b><div>${esc(x.removed)}</div></div>`:''}
    <div class="trow"><b>Main dot point</b><div class="tlist">${x.dp.filter(d=>d[1]==='primary').map(([id,r])=>dpChip(id,r,new Set(o.dp.filter(d=>d[1]==='primary').map(d=>d[0])))).join('')||'<span class="muted">none</span>'}</div></div>
    ${(al=>al.length?`<details class="talso"><summary>Also assessed: ${al.length} dot point${al.length>1?'s':''} (kept, not part of your check)</summary><div class="tlist">${al.map(([id,r])=>dpChip(id,r,od)).join('')}</div></details>`:'')(x.dp.filter(d=>d[1]!=='primary'))}
    ${x.note?`<div class="trow"><b>Note</b><div class="muted">${esc(x.note)}</div></div>`:''}</div>`}
let tagActive=null;
// owner 12 Nov ("I don't feel like I can accurately choose the gates" -> "yeah lets do that"): the owner picks only the TOPIC
// (main dot point, or removed). Gates are settled automatically: both sides' skills combined, each disputed skill kept only
// with a quoted solution step (work/gates). Parts whose two sides share the main dot point need no decision.
const tagPri=x=>x.dp.filter(d=>d[1]==='primary').map(d=>d[0]).join(',');
function tagNeed(p){const d=p.tagd;return !!d&&(tagPri(d.A)!==tagPri(d.B)||!!d.A.removed!==!!d.B.removed)}
function gatesHTML(p){const d=p.tagd,A=new Set(d.A.req),Bs=new Set(d.B.req),ev=p.gates||{};
  const all=[...new Set([...d.A.req,...d.B.req])];
  return `<div class="tgates"><b>Needs (gates): settled automatically, not part of your check</b><div class="tlist">${all.map(k=>{const both=A.has(k)&&Bs.has(k),e=ev[k];
    return both?`<span class="tsk">${esc(k)}</span>`:`<span class="tsk ${e?(e.decision==='keep'?'gk':'gd'):'tdiff'}" title="${esc(e?(e.evidence||e.reason||''):'Named by one side only; being checked against the solution')}">${esc(k)} <span class="muted">${e?(e.decision==='keep'?'· kept':e.decision==='can_use'?'· can use':'· dropped'):'· checking'}</span></span>`}).join('')||'<span class="muted">none</span>'}</div></div>`}
// owner 12 Nov: "u need to show solutions somewhere so I can verify it". Every solution for the part (and the whole-question
// solution when the question has one part), plus the MCQ answer, shown open above the two tag sets.
function tagSolHTML(q,p){revealed.add(q.id);
  const own=q.solutions.filter(x=>x.part_id===p.id), whole=q.parts.length===1||!p.label?q.solutions.filter(x=>x.part_id==null):[];
  const sols=[...own,...whole];
  const key=q.type==='mcq'?q.options.find(o=>o.is_correct):null;
  const ans=key?`<div class="tans"><b>Answer:</b> ${esc(key.label)}. ${key.fig?'(graph option)':tex(key.latex||'')}</div>`:'';
  if(!sols.length&&!ans)return '<div class="help">No solution stored for this part.</div>';
  return `<details class="solbox tsol" open><summary>Solution${sols.length>1?'s':''}</summary>${ans}${sols.map(x=>solHTML(q,x,'tags')).join('')}</details>`}
// owner 12 Nov: "make the tag review page only show the question with the solutions collapsed and the tags so I can easily
// verify or not". The question reads as one piece; each part carries its tags; disputed parts carry the 1/2/F choice inline.
function pickedPri(q,p){const v=reviews['q'+q.id]?.tagres?.[p.id];if(!p.tagd)return (p.t24||[]).filter(t=>t.primary).map(t=>t.cov==='removed'?'removed':t.id);
  if(v==='A'||v==='B'){const x=p.tagd[v];return x.removed?['removed']:x.dp.filter(d=>d[1]==='primary').map(d=>d[0])}
  if(v&&v.id)return [v.id]; if(v&&v.cov)return [v.cov]; const x=p.tagd.B;return x.removed?['removed']:x.dp.filter(d=>d[1]==='primary').map(d=>d[0])}
function qTagSummary(q){const lv=q.parts.filter(p=>leaf(q,p));const gates=[...new Set(lv.flatMap(p=>p.skills||[]))];
  const r=reviews['q'+q.id]?.home,ch=r==='A'||r==='B'?r:null,hA=homeOf(q,'A'),hB=homeOf(q,'B');
  const parts=side=>lv.filter(p=>partPri(q,p,side).some(i=>subKey(i)===homeOf(q,side))).map(p=>p.label?'('+esc(p.label)+')':'').join(' ');
  const opt=(k,lab,h)=>`<div class="topt${ch===k?' chosen':''}"><kbd>${k==='A'?1:2}</kbd> <span class="muted">${lab}</span> <span class="tdp">${homeLabel(h)}</span> <span class="muted">${parts(k)}</span>${ch===k?' <span class="badge b-ok">chosen</span>':''}</div>`;
  return `<div class="tchoice active"><div class="tchead">Home topic: where this question is filed${r&&!ch?` <span class="badge b-bad">your pick: ${homeLabel(qHome(q))}${r.note?' · '+esc(r.note):''}</span>`:''}</div>
    ${opt('A','Tagger',hA)}${opt('B','Checker',hB)}
    <div class="row keys"><button class="act" data-tc="A"><kbd>1</kbd> Tagger</button><button class="act ok" data-tc="B"><kbd>2</kbd> Checker</button><button class="act warn" id="tF"><kbd>F</kbd> Both wrong: pick another</button>${r?`<button class="act ghost" data-redo="1">Undo</button>`:''}</div>
    <div class="flagbox tpick" id="tflag" hidden><div class="row"><b>Pick a dot point in the right topic</b><span class="seg" role="group" aria-label="Year">${['all','11','12'].map(y=>`<button class="act ghost${tpYear===y?' on':''}" data-ty="${y}">${y==='all'?'Both':'Year '+y}</button>`).join('')}</span></div>
        <input id="tflagtxt" type="search" placeholder="Search: e.g. chain rule, reciprocal, Y12-240 (Enter picks the first match, Esc cancels)" aria-label="Search dot points">
        <div id="tpList" class="tplist"></div>
        <div class="row"><input id="tpNote" type="text" placeholder="Optional note, e.g. no dot point covers graphing cot x" style="flex:1;min-width:0"><button class="act" id="tpRemoved">Removed from syllabus</button><button class="act" id="tpNone">No dot point fits</button></div></div>
    <div class="muted"><b>Gates (automatic)</b> ${gates.map(esc).join(', ')||'none'}</div></div>`}
function sideChip(x){return x.removed?`<span class="tdp tdiff">Removed from syllabus</span>`:x.dp.filter(d=>d[1]==='primary').map(([id])=>{const d=DM[id]||{};return `<span class="tdp" title="${esc(id+' · '+(d.fa||'')+(d.sub?' › '+d.sub:'')+' — '+(d.text||''))}"><span class="yb y${d.yl||''}">Y${d.yl||'?'}</span><span class="tid">${esc(id)}</span> ${esc(d.short||d.sub||'')}</span>`}).join('')||'<span class="muted">none</span>'}
function tagChoiceHTML(q,p){const v=reviews['q'+q.id]?.tagres?.[p.id],ch=v==='A'||v==='B'?v:null,act=p.id===tagActive,d=p.tagd;
  const opt=(k,lab,x)=>`<div class="topt${ch===k?' chosen':''}"><kbd>${k==='A'?1:2}</kbd> <span class="muted">${lab}</span> ${sideChip(x)}${x.note?` <span class="tnote" title="${esc(x.note)}">note</span>`:''}${ch===k?' <span class="badge b-ok">chosen</span>':''}</div>`;
  return `<div class="tchoice${act?' active':''}${v?' decided':''}"><div class="tchead">Topics disagree${v&&!ch?` <span class="badge b-bad">your pick: ${v.id?esc(v.id+' '+(DM[v.id]?.short||'')):v.cov==='removed'?'removed from syllabus':'no dot point fits'}${v.note?' · '+esc(v.note):''}</span>`:''}</div>
    ${opt('A','Tagger',d.A)}${opt('B','Checker',d.B)}
    ${act?`<div class="row keys"><button class="act" data-tc="A"><kbd>1</kbd> Tagger</button><button class="act ok" data-tc="B"><kbd>2</kbd> Checker</button><button class="act warn" id="tF"><kbd>F</kbd> Both wrong: pick another</button></div>
      <div class="flagbox tpick" id="tflag" hidden><div class="row"><b>Pick the correct main dot point</b><span class="seg" role="group" aria-label="Year">${['all','11','12'].map(y=>`<button class="act ghost${tpYear===y?' on':''}" data-ty="${y}">${y==='all'?'Both':'Year '+y}</button>`).join('')}</span></div>
        <input id="tflagtxt" type="search" placeholder="Search: e.g. chain rule, reciprocal, Y12-240 (Enter picks the first match, Esc cancels)" aria-label="Search dot points">
        <div id="tpList" class="tplist"></div>
        <div class="row"><input id="tpNote" type="text" placeholder="Optional note, e.g. no dot point covers graphing cot x" style="flex:1;min-width:0"><button class="act" id="tpRemoved">Removed from syllabus</button><button class="act" id="tpNone">No dot point fits</button></div></div>`:(v?`<button class="act ghost" data-redo="${p.id}">Change</button>`:'')}</div>`}
function renderTagd(){
  const q=rlist[ridx];
  const done=rlist.filter(x=>!isTodo(x,'tags')).length;
  $('#pos').textContent=rlist.length?`Question ${ridx+1} of ${rlist.length} · ${rlist.length-done} left`:'0 / 0'; $('#prog').style.width=(rlist.length?100*done/rlist.length:0)+'%';
  if(!q){$('#rout').innerHTML=`<div class="empty">No home topics waiting. ${nextStepHTML()}</div>`;bindNext();return}
  $('#rout').innerHTML=`<div class="row"><b style="font-size:18px">${qid(q)}</b><span class="muted">${esc(srcLine(q))}</span></div>
    ${qTagSummary(q)}<div class="qtext tagq">${qBody(q,'tags')}</div>`;
  hydrate($('#rout'),q,'review'); typeset($('#rout'));
  $$('#rout [data-tc]').forEach(b=>b.onclick=()=>tagChoose(b.dataset.tc));
  $('#tF')&&($('#tF').onclick=openTagFlag);
  $('#rout [data-redo]')&&($('#rout [data-redo]').onclick=()=>{write(q,{home:null});renderTagd()});
  const ft=$('#tflagtxt'); if(ft){ft.oninput=drawTP; ft.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();const f=$('#tpList [data-tp]');if(f)tpPick(f.dataset.tp)}else if(e.key==='Escape'){$('#tflag').hidden=true;ft.value=''}};
    $$('#rout [data-ty]').forEach(b=>b.onclick=()=>{tpYear=b.dataset.ty;$$('#rout [data-ty]').forEach(x=>x.classList.toggle('on',x===b));drawTP();$('#tflagtxt').focus()});
    $('#tpRemoved').onclick=()=>tagChoose({cov:'removed',note:$('#tpNote').value.trim()||null});
    $('#tpNone').onclick=()=>{const n=$('#tpNote').value.trim();if(!n){toast('Say in the note what it is about');$('#tpNote').focus();return}tagChoose({cov:'no_match',note:n})}}
}
function openTagFlag(){const b=$('#tflag');if(!b)return;b.hidden=false;drawTP();$('#tflagtxt').focus()}
// owner 12 Nov: "If its both wrong, I should be able to pick from a Y11 and Y12 list for the correct main dot point"
let tpYear='all';
function drawTP(){const el=$('#tpList');if(!el)return;const s=($('#tflagtxt')?.value||'').toLowerCase().trim();
  const pool=DOTS.filter(d=>tpYear==='all'||String(d.yl)===tpYear);
  const row=d=>`<button class="tprow" data-tp="${d.id}"><span class="yb y${d.yl}">Y${d.yl}</span><span class="tid">${d.id}</span> ${esc(d.short||d.text)}</button>`;
  if(s){const hits=pool.filter(d=>(d.id+' '+d.fa+' '+(d.sub||'')+' '+(d.short||'')+' '+d.text).toLowerCase().includes(s)).slice(0,40);
    el.innerHTML=hits.map(row).join('')||'<div class="muted">No dot point matches.</div>'}
  else{const g=new Map();pool.forEach(d=>{const k='Year '+d.yl+' · '+d.fa;if(!g.has(k))g.set(k,new Map());const m=g.get(k),sk=d.sub||'';if(!m.has(sk))m.set(sk,[]);m.get(sk).push(d)});
    el.innerHTML=[...g].map(([k,m])=>`<details><summary>${esc(k)}</summary>${[...m].map(([sk,ds])=>`${sk?`<div class="tpsub">${esc(sk)}</div>`:''}${ds.map(row).join('')}`).join('')}</details>`).join('')}
  $$('#tpList [data-tp]').forEach(b=>b.onclick=()=>tpPick(b.dataset.tp))}
function tpPick(id){tagChoose({id,note:$('#tpNote')?.value.trim()||null})}
function tagChoose(v){const q=rlist[ridx];if(!q)return;write(q,{home:v});TOPICS=null;const was=q.id;refreshReview();if(rlist[ridx]?.id===was)go(1);window.scrollTo({top:0})}
function renderReview(){
  $('#reviewView').classList.toggle('grid',rfilter==='diagrams'||rfilter==='tags'||FOCUS_STEPS.includes(rfilter));
  $('#rout').previousElementSibling.textContent=rfilter==='diagrams'?'Diagrams to check':rfilter==='tags'?'Tags to settle':'Parsed question';
  if(rfilter==='diagrams'){renderDiag();return}
  if(rfilter==='tags'){renderTagd();return}
  const done=rlist.filter(q=>!isTodo(q,rfilter)).length;
  $('#prog').style.width=(rlist.length?100*done/rlist.length:0)+'%';
  $('#pos').textContent=rlist.length?`${ridx+1} / ${rlist.length}`+(rfilter==='recent'&&approvedAt(rlist[ridx])?' · approved '+new Date(approvedAt(rlist[ridx])).toLocaleString([], {day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):''):'0 / 0';
  if(!rlist.length){
    const base=B.questions.filter(q=>!rdoc||String(q.doc)===rdoc);
    const next=FILTERS.filter(([k])=>k!==rfilter&&k!=='all').map(([k,l])=>[k,l,base.filter(q=>inFilter(q,k)&&isTodo(q,k)).length]).filter(x=>x[2]>0);
    const label=(FILTERS.find(f=>f[0]===rfilter)||[])[1]||'';
    $('#rout').innerHTML=`<div class="empty" style="text-align:left;display:flex;flex-direction:column;gap:12px">
      <div><b style="color:var(--ink);font-size:16px">${rstatus==='todo'?`Nothing left in “${esc((STEPS.find(x=>x[0]===rfilter)||[,label])[1])}”.`:'No questions match these filters.'}</b></div>${rfilter==='sample'?[...new Set(B.questions.filter(q=>q.tri?.tier==='sample'&&(!rdoc||String(q.doc)===rdoc)).map(q=>q.doc))].map(sampleBanner).join(''):''}${nextStepHTML()}
      <div>All ${B.questions.filter(q=>!q.dup_of).length} questions are still in the bank — open the <a href="#bank">Bank</a> to browse them by topic, or pick what to review next:</div>
      <div class="row">${next.map(([k,l,n])=>`<button class="act" data-gof="${k}">${esc(l)} · ${n}</button>`).join('')}<button class="act" data-gof="all" data-any="1">Every question (any status)</button></div></div>`;
    $('#src').innerHTML='';$('#srcTitle').textContent='Source page';
    $$('#rout [data-gof]').forEach(b=>b.onclick=()=>{rfilter=b.dataset.gof;save('rf2',rfilter);if(b.dataset.any){rstatus='any';$('#stF').value='any'}ridx=0;refreshReview()});
    return}
  const q=rlist[ridx], d=B.docs[q.doc], r=reviews['q'+q.id];
  $('#srcTitle').textContent=`${docLabel(d)} · page ${q.pages.map(p=>+p.split('_').pop().split('.')[0]+1).join(', ')}`;
  $('#src').innerHTML=q.pages.map(p=>`<img data-page="${p}" alt="Source page">`).join('');
  const rel=q.related.map(x=>{const o=B.questions.find(z=>z.id===x.q);return o&&!(docLabel(B.docs[o.doc])===docLabel(B.docs[q.doc])&&String(o.number)===String(q.number))?`${docLabel(B.docs[o.doc])} Q${o.number} (${Math.round(x.sim*100)}% similar)`:''}).filter(Boolean).join('; ');
  $('#rout').innerHTML=`${q.old?`<div class="oldsyl"><b>Old syllabus (2017 only):</b> ${tex(q.old)}</div>`:''}${q.std?`<div class="stdsyl"><b>Mathematics Standard, not Advanced:</b> ${esc(q.std)}</div>`:''}
    <div class="row"><span class="badge ${d.parse_path==='scan'?'b-scan':'b-acc'}">${d.parse_path}</span>
      ${q.tri?'':`${q.queues.includes('review')?'<span class="badge b-bad">parse flagged</span>':''}`}
      ${r?.status?`<span class="badge ${r.status==='approved'?'b-ok':'b-bad'}">${r.status}</span>`:''}
      <span class="muted" style="font-size:13px">${esc(docLabel(d))} · Section ${esc(q.section||'–')}${q.marks!=null?' · '+q.marks+(q.marks===1?' mark':' marks'):''}</span></div>
    <h3 style="margin:0;font-size:20px">${qid(q)} <span class="muted" style="font-size:15px;font-weight:400">${esc(srcLine(q))}</span></h3>
    ${rfilter==='sample'?sampleBanner(q.doc):''}${whyHTML(q)}
    ${q.decide?`<div class="callout"><b>Needs your decision:</b> ${tex(q.decide)}</div>`:''}${q.review_note&&!/^scan (path|transcription)[^|;]*$/i.test(q.review_note.trim())?`<details class="figdone" style="color:var(--muted)"><summary style="color:var(--warn)">Transcription notes</summary><div class="help">${esc(q.review_note)}</div></details>`:''}${rel?`<div class="help">Also appears as: ${esc(rel)}</div>`:''}
    ${figCompareHTML(q)}
    ${FOCUS_STEPS.includes(rfilter)?`<div class="focuscmp"><figure><figcaption>On the paper</figcaption><div id="fsrc" class="fsrc"><span class="muted">Loading the paper…</span></div></figure><figure><figcaption>In the bank</figcaption><div class="qtext">${qBody(q,'review')}</div></figure></div>
      <details class="help fullpage"><summary>Full source page${q.pages.length>1?'s':''}</summary>${q.pages.map(p=>`<img data-page="${p}" alt="Source page" style="width:100%">`).join('')}</details>`:`<div class="section"><h4>Question as it will appear</h4>${qBody(q,'review')}</div>`}
    <div class="decision">${r?.note?`<div class="help"><b>Your note:</b> ${esc(r.note)}</div>`:''}
      <div class="row"><button class="act ok" id="approve"><kbd>A</kbd> Approve question + solution</button><span class="help">Approving also approves any model-written solution shown here that you haven't rejected.</span><button class="act warn" id="flag"><kbd>F</kbd> Flag</button>
      <span class="help">${db?'Decisions save for everyone with access.':'Saving is off in this view; decisions are not kept.'}</span></div>
      <div class="flagbox" id="qflag" hidden><label class="help" for="note">What's wrong? <kbd>Enter</kbd> sends the flag, <kbd>Esc</kbd> cancels.</label><input id="note" type="text" placeholder="e.g. Part (b) is missing the integral bounds" value="${esc(r?.status==='flagged'?r.note||'':'')}"></div></div>`;
  hydrate($('#rout'),q,'review'); hydrate($('#src'),q,'review'); typeset($('#rout'));
  if(FOCUS_STEPS.includes(rfilter)){const sol=(q.tri?.look||[]).some(x=>/solution|answer|marks/i.test(x));
    if(!sol)$$('#rout .focuscmp details.solbox').forEach(d=>d.open=false);   // solutions only open when the check is about them
    focusPack(q.doc).then(m=>{const el=$('#fsrc');if(!el||rlist[ridx]?.id!==q.id)return;const r=m[q.id];
      el.innerHTML=r&&r.q.length?r.q.map(u=>`<img src="${u}" alt="The question on the source paper">`).join(''):'<span class="muted">No crop for this question (scanned or unusual layout). Open the full source page below.</span>'})}
  $('#approve').onclick=()=>decide('approved'); $('#flag').onclick=openQFlag;
  // owner 12 Nov: flag like the diagrams step: F opens a one-line box, type the reason, Enter sends, Esc cancels
  $('#note').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();if(!$('#note').value.trim()){toast('Type a reason first');return}decide('flagged')}else if(e.key==='Escape'){$('#qflag').hidden=true;$('#note').blur()}};
  $$('#rout [data-fig]').forEach(b=>{if(b.tagName==='BUTTON')b.onclick=()=>setFig(q,b.dataset.fig,b.dataset.v)});
  $$('#rout [data-sol]').forEach(b=>b.onclick=()=>setSol(q,+b.dataset.sol,b.dataset.v));
  $('#figAll')&&($('#figAll').onclick=()=>figAll(q));
  $$('#rout [data-fmode]').forEach(b=>b.onclick=()=>{figMode[b.dataset.fmode]=b.dataset.m;renderReview()});
  $$('#rout [data-figreq]').forEach(b=>b.onclick=()=>{const bx=$(`[data-reqbox="${b.dataset.figreq}"]`);bx.hidden=false;bx.querySelector('textarea').focus()});
  $$('#rout [data-reqcancel]').forEach(b=>b.onclick=()=>{$(`[data-reqbox="${b.dataset.reqcancel}"]`).hidden=true});
  $$('#rout [data-reqsave]').forEach(b=>b.onclick=()=>{const k=b.dataset.reqsave;const t=$(`[data-reqbox="${k}"] textarea`).value.trim();if(!t){toast('Write what should change first');return}setFigReq(q,k,t)});
  $$('.edit-tag').forEach(b=>b.onclick=()=>{editing=+b.dataset.part;renderReview();setupPicker()});
  if(editing) setupPicker();
}
async function write(q,patch){
  const key='q'+q.id; const cur=reviews[key]||{};
  const next={...cur,...patch,question_id:q.id,by:me||null,at:new Date().toISOString()};
  reviews[key]=next; TOPICS=null; _clean=null;
  if(!db){toast('Not saved: this view has no shared storage');return}
  try{await db.doc('reviews/'+key).set(next);toast('Saved')}catch(e){toast(e?.code==='not_granted'||e?.code==='forbidden'?'You can view but not save decisions here':'Could not save. Try again in a moment.')}
}
async function setFig(q,k,v){await write(q,{fig:{...(reviews['q'+q.id]?.fig||{}),[k]:v}});afterDecision(q)}
async function setFigReq(q,k,t){const r=reviews['q'+q.id]||{};await write(q,{fig:{...(r.fig||{}),[k]:'changes'},fig_notes:{...(r.fig_notes||{}),[k]:t}});afterDecision(q)}
async function figAll(q){const f={...(reviews['q'+q.id]?.fig||{})};qFigs(q).forEach(k=>f[k]='approved');await write(q,{fig:f});afterDecision(q)}
async function setSol(q,id,v){await write(q,{sol:{...(reviews['q'+q.id]?.sol||{}),[id]:v}});afterDecision(q)}
function afterDecision(q){ // stay on the item until everything in the current filter is decided, then move on
  if(rstatus==='todo'&&!isTodo(q,rfilter)&&['diagrams','generated'].includes(rfilter)){refreshReview();window.scrollTo({top:0})} else renderReview()}
async function setTag(t){const q=rlist[ridx];const ed={...(reviews['q'+q.id]?.tag_edits||{})};ed[editing]=t.cov?{cov:t.cov}:{id:t.id};editing=null;await write(q,{tag_edits:ed});renderReview()}
// owner 12 Nov ("in the check one, its taking too long looking at the question, just show side by side the part I actually
// need to check"): Check and Decide show the question as printed (a crop of the source page) beside the bank version
const FOCUS_STEPS=[];const _fp={};   // owner 12 Nov: cropped side-by-side was worse; rolled back to the full-page view
function focusPack(doc){return _fp[doc]=_fp[doc]||fetch('data/focus/'+doc+'.json').then(r=>r.ok?r.json():{}).catch(()=>({}))}
function openQFlag(){const b=$('#qflag');if(!b)return;b.hidden=false;const n=$('#note');n.focus();n.select()}
async function decide(status){const q=rlist[ridx];if(!q)return;const patch={status,note:$('#note')?.value.trim()||null};
  if(status==='approved'){const sol={...(reviews['q'+q.id]?.sol||{})};let n=0;qGen(q).forEach(x=>{if(!sol[x.id]){sol[x.id]='approved';n++}});if(n)patch.sol=sol}
  write(q,patch);   // owner 12 Nov: "why doesn't approving auto next" -> don't wait for the save; move on at once
  const was=q.id; if(rstatus==='todo'&&!['diagrams','generated'].includes(rfilter)){refreshReview()} else renderReview();
  if(rlist[ridx]?.id===was) go(1); window.scrollTo({top:0})}
function setupPicker(){
  const inp=$('#pickQ'); if(!inp) return; inp.focus();
  const draw=()=>{const s=inp.value.toLowerCase().trim();const hits=(s?DOTS.filter(d=>(d.id+' '+d.fa+' '+(d.sub||'')+' '+d.text).toLowerCase().includes(s)):DOTS).slice(0,60);
    $('#pickList').innerHTML=hits.map(d=>`<li data-id="${d.id}"><b>${d.id}</b> · ${esc(d.fa)}${d.sub?' › '+esc(d.sub):''}<br>${tex(d.tex||d.text)}</li>`).join('');typeset($('#pickList'));
    $$('#pickList li').forEach(li=>li.onclick=()=>setTag({id:li.dataset.id}))};
  inp.oninput=draw; draw();
  inp.onkeydown=e=>{if(e.key==='Enter'){const f=$('#pickList li');if(f)setTag({id:f.dataset.id})}if(e.key==='Escape'){editing=null;renderReview()}};
  $('#setRemoved').onclick=()=>setTag({cov:'removed'}); $('#setNoMatch').onclick=()=>setTag({cov:'no_match'}); $('#cancelPick').onclick=()=>{editing=null;renderReview()};
}
function go(n){editing=null;ridx=Math.min(Math.max(0,ridx+n),Math.max(0,rlist.length-1));renderReview();window.scrollTo({top:0})}   // renderReview shows one diagram question at a time in step 4
$('#filters').addEventListener('click',e=>{const b=e.target.closest('.step');if(!b)return;goStep(b.dataset.f,'todo')});
$('#stF').onchange=e=>{rstatus=e.target.value;ridx=0;refreshReview()};
$('#docF').onchange=e=>{rdoc=e.target.value;ridx=0;refreshReview()};
$('#prev').onclick=()=>go(-1); $('#next').onclick=()=>go(1);
document.addEventListener('keydown',e=>{if(view!=='review'||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;
  if(e.key==='k'||e.key==='ArrowRight')go(1); else if(e.key==='j'||e.key==='ArrowLeft')go(-1);   // owner 12 Nov: "K should be to go next"
  else if(rfilter==='tags'){if(e.key==='1')tagChoose('A');else if(e.key==='2')tagChoose('B');else if(e.key==='f'){e.preventDefault();openTagFlag()}}
  else if(rfilter==='diagrams'&&e.key==='a')diagDecide('approved'); else if(rfilter==='diagrams'&&e.key==='f'){e.preventDefault();openFlag()}
  else if(rfilter==='diagrams'&&/^[1-9]$/.test(e.key)&&$('#flagpick')){e.preventDefault();pickDiag(+e.key);openFlag()}   // owner 12 Nov: "let me press the numbers on my keyboard" 
  else if(e.key==='a')decide('approved'); else if(e.key==='f'){e.preventDefault();openQFlag()}
  else if(e.key==='d'){const q=rlist[ridx];if(q&&qFigs(q).length)figAll(q)}});

