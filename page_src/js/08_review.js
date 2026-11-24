/* ---------- Review ---------- */
const FILTERS=[['back','Fixed and back for you'],['waiting','Flags waiting for Claude'],['recent','Recently approved (newest first)'],['decide','Needs your decision'],['scanqs','Scans: question + solution'],['digitalqs','Digital: quick skim'],['diagrams','Diagrams to approve'],['generated','Generated solutions'],['review','Parse flagged'],['no_match','No match'],['removed','Old syllabus'],['standard','Standard course'],['scan','Scans'],['duplicate','Near-duplicates'],['audited','Self-audited'],['changes','Diagram changes requested'],['redone','Redrawn from your notes'],['all','All questions']];
const qFigs=q=>figKeys(q).all.filter(redrawable);
const qGen=q=>q.solutions.filter(s=>s.source==='generated');
// owner 12 Nov: "way too many pills, not sure what I'm meant to check and in what order". Steps, in order.
// owner 13 Nov: "I think the next thing I want to do is refine the review process. It is just 7 tabs at the top and its not
// really clear the order / process". He chose, in his words:
//   order "Calls → Check → Topics → Diagrams → Spot-check" (spot-check last, because it approves the rest of the paper);
//   names "Your calls · Flagged · Topics · Diagrams · Spot-check" ('Decide'→'Your calls', 'Check'→'Flagged', 'Tags'→'Topics'),
//   each step with a one-line 'what to do here' under the track. The internal keys (decide, check, tags, diagrams, sample)
//   are unchanged, so stored decisions, job 'affects' and the Other lists keep working.
const STEPS=[['decide','Your calls','Calls only you can make: a correction to a school\u2019s or NESA\u2019s solution, a possible error in the source, a borderline syllabus call, or a call on the whole paper (shown at the top). A approves, F flags with a reason.'],
  ['check','Flagged','The automatic checks or the independent maths checker could not clear these (and every table). Compare with the source page: each one says why and what to look at.'],
  ['tags','Topics','The tagger and the checker would file these under different topics. Pick the right home from the question: 1 tagger, 2 checker, F another dot point. Gates are automatic.'],
  ['diagrams','Diagrams','Each redrawn diagram beside its original. A approves, F flags (type the reason, Enter sends), K next, J back.'],
  ['sample','Spot-check','A random sample of the questions that passed every check. When they are all fine, approve the rest of the paper in one click.']];
const SLUG={decide:'calls',check:'flagged',tags:'topics',diagrams:'diagrams',sample:'spot-check'};   // #review/paper/<doc>/<slug>
const UNSLUG=Object.fromEntries(Object.entries(SLUG).map(([k,v])=>[v,k]));
const stepLabel=k=>(STEPS.find(x=>x[0]===k)||FILTERS.find(x=>x[0]===k)||[,k])[1];
// Review mode: 'paper' (one paper, walked top to bottom: #review/paper/<doc>/<step>) or 'list' (Recently approved, Other lists: #review/list/<filter>)
let RMODE='paper';
/* Question keys (Fix 2 of the plan "Questgen architecture plan: before imports resume"; owner 14 Nov: "Ok we should run Fix 1
   and 2"). Decisions are stored by permanent key, not by question id: reviews/k_<key> ('2022-CSSA-AT4-Q10', bank q.key from
   tools/qkeys.py) and reviews/p_<paper key> ('2022-CSSA-AT4', bank docs[d].key). Every copy of a question shares its key, so
   an approval on any copy counts for all of them (14 Nov: the CSSA paper filed twice hid the approved 274/275 behind
   unapproved copies 44/45). index() turns the raw collection into the in-page map the rest of the page reads, still by
   'q<id>' / 'paper_<doc>', one shared record per key. Old 'q<id>' / 'paper_<doc>' docs are read as a fallback while the
   migration (tools/migrate_reviews_to_keys.py) has not reached them; a k_/p_ doc, once it exists, is the decision.
   Saved exams (keys), difficulty checks (key) and reports (key) also carry the key, so tools can re-attach them. */
const RKEY={_g:null,
  groups(){if(this._g)return this._g;const q={},p={};
    B.questions.forEach(x=>{if(x.key)(q[x.key]=q[x.key]||[]).push(x.id)});
    Object.values(B.docs).forEach(d=>{if(d.key)(p[d.key]=p[d.key]||[]).push(d.id)});return this._g={q,p}},
  qdoc:q=>q.key?'k_'+q.key:'q'+q.id,                                      // where a question's decision is written
  pdoc:d=>B.docs[d]?.key?'p_'+B.docs[d].key:'paper_'+d,                    // where a paper's decision is written
  copies(q){return q.key?this.groups().q[q.key]||[q.id]:[q.id]},
  docsOf(d){const k=B.docs[d]?.key;return k?this.groups().p[k]||[+d]:[+d]},
  // old docs of several copies: an approval wins, then the newest; the newest note is kept; maps (fig, sol ...) merge, newest wins
  rank:r=>[r?.status==='approved'?3:r?.status==='flagged'?2:r?.status?1:0,String(r?.at||'')],
  merge(list){if(list.length<2)return list[0];const obj=(k,v)=>v&&typeof v==='object'&&!Array.isArray(v)&&k!=='call',out={};
    const asc=[...list].sort((a,b)=>String(a.at||'').localeCompare(String(b.at||'')));
    const top=[...asc].sort((a,b)=>{const x=this.rank(a),y=this.rank(b);return x[0]-y[0]||x[1].localeCompare(y[1])}).pop();
    asc.forEach(r=>Object.entries(r).forEach(([k,v])=>{if(obj(k,v))out[k]={...(out[k]||{}),...v}}));
    Object.entries(top).forEach(([k,v])=>{if(!obj(k,v))out[k]=v});
    const n=asc.filter(r=>r.note).pop(),c=asc.filter(r=>r.call).pop();if(n)out.note=n.note;if(c)out.call=c.call;return out},
  index(raw){const nx={...raw},{q,p}=this.groups();
    Object.entries(q).forEach(([k,ids])=>{const r=raw['k_'+k]||this.merge(ids.map(i=>raw['q'+i]).filter(Boolean));if(r)ids.forEach(i=>nx['q'+i]=r)});
    Object.entries(p).forEach(([k,ds])=>{const r=raw['p_'+k]||this.merge(ds.map(d=>raw['paper_'+d]).filter(Boolean));if(r)ds.forEach(d=>nx['paper_'+d]=r)});
    return nx},
  // a saved exam's questions: by key when it has keys (the copy the Bank shows), else by id
  items(x){const ks=x.keys||[];return (x.items||[]).map((id,i)=>{const k=ks[i];if(!k)return id;const g=this.groups().q[k]||[];
    if(g.includes(id)&&!xq(id)?.dup_of)return id;return g.find(j=>!xq(j)?.dup_of)??g[0]??id})}};
// owner 17 Nov: "if questions have been flagged but the spot check is done, the questions CANNOT be approved until all flagged
// questions are approved". A paper's one-click approval (and the questions it approves) counts only while no question in the
// paper is flagged (status 'flagged') or has a diagram with changes requested; it counts again once every flag is approved.
// flagsIn(doc) is cached for one task (cleared on the next tick), so a render that asks per question stays linear.
// owner 17 Nov: "are the 5 papers in auto approve really ready? what about the flagged checks". A question is still open while it
// is flagged, has a diagram with changes requested, or has a diagram Claude redrew from a request (fig_done) that the checker has
// not approved again: the redraw needs its second check before anything in the paper counts as approved.
const openFix=r=>!!r&&(r.status==='flagged'||Object.values(r.fig||{}).includes('changes')||Object.keys(r.fig_done||{}).some(k=>!(r.fig||{})[k]));
let _flagMemo=null;
function flagsIn(doc){if(!_flagMemo){_flagMemo={};setTimeout(()=>{_flagMemo=null},0);
    for(const q of (B?.questions||[])){if(q.dup_of)continue;const r=reviews['q'+q.id];if(openFix(r))(_flagMemo[q.doc]=_flagMemo[q.doc]||[]).push(q.id)}}
  return (typeof RKEY!=='undefined'&&RKEY.docsOf?RKEY.docsOf(String(doc)):[doc]).flatMap(d=>_flagMemo[+d]||[])}
const paperOK=doc=>reviews['paper_'+doc]?.status==='approved'&&!flagsIn(doc).length;
const chkFigsAll=q=>q.tri?(q.tri.chk_figs||[]).filter(redrawable):qFigs(q);
// owner 12 Nov ("yeah do that"): High-confidence diagrams (question graphs, blank axes: 48 of 50 approved) are spot-checked,
// not checked one by one: a stable random 10% per paper (at least 1) stays in the queue. A flag on any High diagram of a
// paper puts all of that paper's High diagrams back on full check. Already-decided diagrams always stay visible.
let _spot=null;
function hstr(x){let h=2166136261;for(const c of x){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
function spotSet(){if(_spot)return _spot;const by={};B.questions.forEach(q=>{if(q.dup_of)return;chkFigsAll(q).forEach(k=>{if(figRisk(k)[0]==='High')(by[q.doc]=by[q.doc]||[]).push(k)})});
  const keep=new Set();Object.values(by).forEach(ks=>{ks.sort((a,b)=>hstr(a)-hstr(b));ks.slice(0,Math.max(1,Math.ceil(ks.length/10))).forEach(k=>keep.add(k))});return _spot=keep}
// health pass 21 Nov: cached per paper (it scanned the whole bank for every High diagram in chkFigs); cleared with _clean
let _esc={};function escalated(doc){return doc in _esc?_esc[doc]:_esc[doc]=B.questions.some(q=>q.doc===doc&&chkFigsAll(q).some(k=>figRisk(k)[0]==='High'&&reviews['q'+q.id]?.fig?.[k]==='changes'))}
const chkFigs=q=>chkFigsAll(q).filter(k=>figRisk(k)[0]!=='High'||spotSet().has(k)||reviews['q'+q.id]?.fig?.[k]||escalated(q.doc));
// owner 17 Nov: "exams should never get throug[h] until all flags are fixed": a question with a diagram change request counts as
// flagged (not approved: out of the tutors' Bank and the exam builder) until the redraw is approved
function qState(q){const rv=reviews['q'+(q.dup_of||q.id)],r=rv?.status; if(rv&&rv.status!=='flagged'&&openFix(rv)) return 'flagged'; if(r) return r; const t=q.tri?.tier; if(t==='auto'&&paperOK(q.doc)) return 'approved'; return null}
// a call Claude raised (site/project/open_decisions.json -> q.decide) is always a decision, imported or not (owner 13 Nov:
// "isn't that the point of your calls? or is your decision different": import notes are raised as calls, never as loose notes)
function needsDecision(q){if(reviews['q'+q.id]?.status==='flagged'||q.decide)return true;
  if(q.tri)return q.tri.tier==='decide';   // imported questions: triage already decided (a correction the independent checker confirmed is NOT a decision) — owner 12 Nov: "why is this in decide?"
  return q.solutions.some(x=>(x.meta||{}).source_flag||(x.meta||{}).corrected)}
// a call raised after the question was approved re-opens it until the owner answers it (decide() stamps call_at)
const callOpen=q=>!!q.decide_at&&String(reviews['q'+q.id]?.call_at||'')<q.decide_at;
// owner 12 Nov: "I need a list of recently approved in case" — newest approvals first; F re-flags, the note says why
function approvedAt(q){const r=reviews['q'+q.id];if(r?.status==='approved')return r.at||'';const pr=reviews['paper_'+q.doc];if(pr?.status==='approved'&&paperOK(q.doc)&&q.tri?.tier==='auto'&&!r?.status)return pr.at||'';return null}
// owner 17 Nov: "is it easy for the checker to find questions coming back again?" A question is back when Claude fixed its flag
// (status flagged + fixed note) or redrew a diagram from a change request that has no decision yet (fig_done, no fig value)
// owner 17 Nov: "two of them had to get RE flagged, they should dissappear and be added to flags waiting for claude. Make the
// flags waiting a drop down too so we can see": a question with a flag Claude has not fixed yet, or a diagram change request,
// is waiting for Claude (waitQ) and is never "back", even when an older fix of it is still recorded.
const waitR=r=>!!r&&((r.status==='flagged'&&!r.fixed)||Object.values(r.fig||{}).includes('changes'));
function waitQ(q){return !q.dup_of&&waitR(reviews['q'+q.id])}
function waitBoxHTML(r){const rows=[];if(r.status==='flagged'&&!r.fixed)rows.push(['Question',r.note||'(no note written)']);
  for(const [k,v] of Object.entries(r.fig||{}))if(v==='changes')rows.push([/_s\d+$/.test(k)?'Solution diagram':'Diagram',r.fig_notes?.[k]||'(no request written)']);
  return `<div class="backbox wait"><h4>Waiting for Claude: your flag</h4><table><tbody>${rows.map(([w,a])=>`<tr><th>${esc(w)}</th><td>${esc(a)}</td></tr>`).join('')}</tbody></table><div class="help">Claude fixes it on the next request from Steve or a comment sent to Claude; it then moves to "Fixed and back for you".</div></div>`}
function backQ(q){if(q.dup_of)return false;const r=reviews['q'+q.id];if(!r||waitR(r))return false;
  return (r.status==='flagged'&&!!r.fixed)||Object.keys(r.fig_done||{}).some(k=>!(r.fig||{})[k])}
function inFilter(q,f){if(f==='back')return backQ(q);if(f==='waiting')return waitQ(q);if(f==='recent')return !q.dup_of&&approvedAt(q)!=null;if(f==='tags')return homeNeed(q);if(f==='all')return !q.dup_of;if(f==='check'||f==='sample')return !q.dup_of&&q.tri?.tier===f;if(f==='decide')return !q.dup_of&&needsDecision(q);if(f==='diagrams')return !q.dup_of&&chkFigs(q).length>0;if(f==='scanqs')return !q.dup_of&&q.queues.includes('scan');if(f==='digitalqs')return !q.dup_of&&!q.queues.includes('scan');if(f==='changes')return qFigs(q).some(k=>figDec(q,k)==='changes');if(f==='redone')return Object.keys(reviews['q'+q.id]?.fig_done||{}).length>0;if(f==='generated')return !q.dup_of&&qGen(q).length>0;return !q.dup_of&&q.queues.includes(f)}   // owner: hidden duplicate copies never count in a queue ("they are misleading")
function isTodo(q,f){if(q.dup_of)return false;if(f==='tags')return !reviews['q'+q.id]?.home&&!partsDone(q);   // a hidden copy follows the copy that was reviewed
  if(f==='decide')return reviews['q'+q.id]?.status!=='approved'||callOpen(q);if(f==='diagrams')return chkFigs(q).some(k=>!reviews['q'+q.id]?.fig?.[k]);if(f==='check'||f==='sample')return !reviews['q'+q.id]?.status;if(f==='back')return backQ(q);if(f==='waiting')return waitQ(q);if(f==='redone')return Object.keys(reviews['q'+q.id]?.fig_done||{}).some(k=>!figDec(q,k));if(f==='changes')return qFigs(q).some(k=>figDec(q,k)==='changes');if(f==='generated')return qGen(q).some(s=>!solDec(q,s));return !reviews['q'+q.id]?.status}
function statusOK(q){const r=reviews['q'+(q.dup_of||q.id)];if(rstatus==='any')return true;if(rstatus==='todo')return isTodo(q,rfilter);return r?.status===rstatus}
let pendingOpen=null;
// owner 12 Nov: diagram confidence by type, from first-look flag rates (297 reviewed then). Riskiest first in the Diagrams queue.
// The levels stay as set; the "n of m flagged" shown with them is counted live from Review's decisions (owner 21 Nov: "make sure
// there's no hanging numbers anywhere which can go stale"; the 12 Nov percentages were typed in)
const RISK={table:['Low',3,'tables'],table_drawn:['Low',3,'tables'],'geometry·s':['Low',3,'geometry solution sketches'],'other·s':['Low',3,'other solution sketches'],'tree·s':['Low',3,'tree diagrams'],tree:['Low',3,'tree diagrams'],'graph·s':['Medium',2,'graph solution sketches'],'statistical·s':['Medium',2,'statistical solution sketches'],statistical:['Medium',2,'statistical'],geometry:['Medium',2,'geometry'],graph:['High',1,'question graphs (spot-checked)'],blank_axes:['High',1,'blank axes (spot-checked)'],other:['Medium',2,'other diagrams'],photo:['Medium',2,'photos']};
const riskKey=k=>{const f=B.figs[k]||{};const c=f.status==='table'?'table':(f.cls||'other');const s=c+(/_s\d+$/.test(k)?'·s':'');return RISK[s]?s:RISK[c]?c:null};
function figRisk(k){const r=RISK[riskKey(k)];return r||['Medium',2,'']}
// flagged = a change was asked for (now or before a fix); decided = approved or flagged. Cached with _esc (cleared with _clean)
let _rk=null;function riskTxt(k){const key=riskKey(k),r=RISK[key];if(!r)return '';
  if(!_rk){_rk={};const seen=new Map();   // each diagram once (Review holds copies of a decision under several keys)
    Object.values(reviews).forEach(v=>{if(!v?.fig&&!v?.fig_done)return;new Set([...Object.keys(v.fig||{}),...Object.keys(v.fig_done||{})]).forEach(f=>seen.set(f,seen.get(f)||v.fig?.[f]==='changes'||!!v.fig_done?.[f]))});
    seen.forEach((fl,f)=>{const g=riskKey(f);if(!g)return;const t=_rk[g]=_rk[g]||[0,0];t[1]++;if(fl)t[0]++})}
  const [fl,n]=_rk[key]||[0,0];return `${r[2]}: ${n?`${fl} of ${n} reviewed were flagged`:'none reviewed yet'}`}
function qRisk(q){return Math.max(0,...chkFigs(q).map(k=>figRisk(k)[1]))}
// owner 12 Nov: "where do i go and batch approve the rest?" -> papers whose spot-check is clean, approvable from the Review header
function paperReady(doc){doc=String(doc);const qs=B.questions.filter(q=>String(q.doc)===doc&&!q.dup_of),smp=qs.filter(q=>q.tri?.tier==='sample'),rest=qs.filter(q=>q.tri?.tier==='auto'&&!reviews['q'+q.id]?.status);
  if(!rest.length||paperOK(+doc)||paperOK(doc))return null; if(!smp.length||smp.some(q=>reviews['q'+q.id]?.status!=='approved'))return null; if(flagsIn(doc).length)return null; return [doc,rest.length,smp.length]}
function readyPapers(){return Object.keys(B.docs).map(paperReady).filter(Boolean)}
function readyHTML(){const r=readyPapers(); if(!r.length) return ''; const n=r.reduce((a,x)=>a+x[1],0);
  return `<details class="banner ready"><summary><span><b>${r.length} paper${r.length>1?'s':''} ready:</b> every spot-checked question is approved, so the other ${n} questions can go in the bank.</span> <button class="act ok" id="approveReady">Approve all ${n}</button></summary>
    <ul class="help">${r.map(([d,k,m])=>`<li>${esc(docLabel(B.docs[d]))}: ${m} spot-checked, ${k} to approve <button class="act ghost" data-paperok="${d}">Approve this paper</button></li>`).join('')}</ul></details>`}
async function approveReady(){const r=readyPapers(); for(const [d] of r) await approvePaper(d); toast(r.length+' papers approved')}
document.addEventListener('click',e=>{if(e.target.closest('#approveReady')){e.preventDefault();approveReady()}});
/* ---------- Review: Inbox and one paper at a time (owner 13 Nov) ----------
   He asked: "I think the next thing I want to do is refine the review process. It is just 7 tabs at the top and its not really
   clear the order / process. Let's clear that up together", and chose:
   - Paper flow: "One paper at a time" — open a paper and walk it top to bottom with a progress track (#review/paper/<doc>/<step>).
   - Upkeep: "An 'Inbox' beside papers" — Review opens on a summary: Papers to review · Reports · Difficulty, each with a count and
     a one-line 'what this is'; empty ones collapse to a tick (#review).
   - Papers tab: "Merge into Review" — the papers list is Review's papers section (#review/papers; #papers still lands there).
   This replaces the 7-button step row (15 Nov). Difficulty and Reports are Inbox sections (#review/difficulty, #review/reports). */
let _prevLeft=null,_advanced=false,_holdToast=0;
// a paper filed as two PDFs is one paper (as on the old Papers tab): its documents share a label
let _grp=null;
function docGroups(){if(_grp)return _grp;const g=new Map();
  Object.values(B.docs).forEach(d=>{if(!B.questions.some(q=>q.doc===d.id))return;const k=docLabel(d);if(!g.has(k))g.set(k,[]);g.get(k).push(d)});
  const n=id=>B.questions.filter(q=>q.doc===id&&!q.dup_of).length;_grp=new Map();
  g.forEach(ds=>{const main=ds.length>1?ds.slice().sort((a,b)=>n(b.id)-n(a.id))[0]:ds[0];const ids=ds.map(d=>d.id);ids.forEach(i=>_grp.set(String(i),{main:String(main.id),ids}))});return _grp}
const docIds=doc=>(docGroups().get(String(doc))||{ids:[+doc]}).ids;
const mainDoc=doc=>(docGroups().get(String(doc))||{main:String(doc)}).main;
// what is left in each step of one paper. The spot-check step also counts "approve the rest" once its sample is clean.
function workOf(main,ids,qs){const left={},total={};STEPS.forEach(([k])=>{left[k]=0;total[k]=0});
  qs.forEach(q=>STEPS.forEach(([k])=>{if(inFilter(q,k)){total[k]++;if(isTodo(q,k))left[k]++}}));
  const pc=PCALL.list(ids);total.decide+=pc.length;left.decide+=pc.filter(c=>c.open).length;   // calls on the paper itself count in Your calls
  // owner 17 Nov: a paper is not cleared while any diagram in it waits on a requested change (it used to count as decided)
  const fx=qs.filter(q=>{const r=reviews['q'+q.id];return !q.dup_of&&r&&r.status!=='flagged'&&openFix(r)}).length;left.diagrams+=fx;total.diagrams+=fx;
  const ready=ids.map(paperReady).filter(Boolean);left.sample+=ready.length;
  const n=STEPS.reduce((a,[k])=>a+left[k],0);
  return {doc:main,ids,left,total,ready,n,at:(STEPS.find(([k])=>left[k]>0)||[])[0]||null}}
// owner 24 Nov: "can you make it so that the papers that haven't been looked at are highlighted so I know which ones I've looked at
//   (from checker)": a paper is "looked at" once the checker's account wrote any review on it (a question approved, flagged, a diagram
//   request, or the paper's own decision). CHECKER is his account id (the one that presses "Fix my flags now" and writes the flags).
const CHECKER='u_mP9tmz6NRnOivy8Y4rJU5g';
function checkerSeen(){const s=new Set();B.questions.forEach(q=>{if(reviews['q'+q.id]?.by===CHECKER||reviews['paper_'+q.doc]?.by===CHECKER||reviews['paper_'+q.doc]?.call?.by===CHECKER)s.add(mainDoc(q.doc))});return s}
const unseenTag='<span class="rv-new" title="The checker has not approved, flagged or decided anything in this paper yet">Not looked at</span>';
function paperWork(doc){const ids=docIds(doc);return workOf(mainDoc(doc),ids,B.questions.filter(q=>ids.includes(q.doc)))}
function allWork(){const by=new Map();B.questions.forEach(q=>{const m=mainDoc(q.doc);if(!by.has(m))by.set(m,[]);by.get(m).push(q)});
  const W=new Map();by.forEach((qs,m)=>W.set(m,workOf(m,docIds(m),qs)));return W}
const workYear=w=>+(String(B.docs[w.doc]?.label||'').match(/\d{4}/)||[0])[0];
const workOrder=(a,b)=>workYear(b)-workYear(a)||docLabel(B.docs[a.doc]).localeCompare(docLabel(B.docs[b.doc]));   // as the papers list: newest first
function nextStepWith(w,cur){const i=STEPS.findIndex(x=>x[0]===cur),ks=STEPS.map(x=>x[0]);return ks.slice(i+1).concat(ks.slice(0,Math.max(0,i))).find(k=>w.left[k]>0)||null}
// the paper's track: 5 numbered steps, done ticks, the open step highlighted, counts
function trackHTML(w,cur){return STEPS.map(([k,l],i)=>{const n=w.left[k],t=w.total[k]+(w.ready.length&&k==='sample'?1:0),on=k===cur;
    const st=n?'todo':t?'done':'none';
    const tip=n?`${n} left${k==='sample'&&w.ready.length?' (approve the rest of the paper)':''}`:t?'Done':'Nothing in this paper';
    return `<li class="tstep ${st}${on?' cur':''}"><button type="button" class="step" data-f="${k}" aria-current="${on?'step':'false'}" title="${esc(l+': '+tip)}"><span class="num" aria-hidden="true">${n||!t?i+1:'✓'}</span><span class="lab">${esc(l)}</span>${n?`<span class="n">${n}</span>`:`<span class="sr">${esc(tip)}</span>`}</button></li>`}).join('')}
// the papers list and the Inbox: the same track as 5 dots (review 13 Nov: a step with nothing in the paper is a faint ring, as on the big track, not a 'done' dot)
function miniTrack(w){return `<span class="mtrack" role="img" aria-label="${esc(STEPS.map(([k,l])=>l+(w.left[k]?' '+w.left[k]+' left':w.total[k]?' done':' nothing in this paper')).join(', '))}">${STEPS.map(([k])=>`<i class="${w.left[k]?(k===w.at?'cur':'todo'):w.total[k]||(k==='sample'&&w.ready.length)?'done':'none'}"></i>`).join('')}</span>`}
const workLine=w=>w.n?`${w.n} left · at ${esc(stepLabel(w.at))}`:'✓ approved';
// Review tab and Curate switch: the Inbox total (papers to review + open reports)
function updateCounts(){if(!QG.detOK)return;const n=todoCount();   // job 2: the to-do count reads triage, which arrives with the details
  $('#todoN').textContent=n||'';const c=$('#curN');if(c)c.textContent=n||''}
// review 13 Nov: the steps are walked per paper now, so "Needs your decision" and "Diagrams to approve" across every paper stay reachable here (the old step row's paper picker did that)
const otherListsHTML=sel=>`<select data-lists aria-label="Other lists"><option value="">${sel?'Other lists…':'Choose…'}</option>${FILTERS.map(([k,l])=>`<option value="${k}"${k===sel?' selected':''}>${esc(l)}</option>`).join('')}</select>`;
// owner 17 Nov: "Review: group 'Papers to review' by batch, oldest first ('Batch 4 · 7 of 9 cleared'); papers waiting on a Your call
// marked as such. Ordered, not locked." Groups from the import batches (PQ.batchOf, 32_papers_q.js); papers in no batch come first
// as "Before batches". Within a group the order is workOrder. Cleared = no review work left (w.n 0, as Processes' "cleared review").
// A group with nothing left is its header line only; nothing is locked: every group opens, every row opens its paper.
function inboxGroups(all){const bo=typeof PQ==='object'&&PQ.batchOf();if(!bo)return null;const g=new Map();
  [...all.values()].sort(workOrder).forEach(w=>{const b=docIds(w.doc).map(d=>bo.get(String(d))).find(Boolean),k=b?b.key+':'+b.n:'';
    if(!g.has(k))g.set(k,{b,ws:[]});g.get(k).ws.push(w)});
  const multi=new Set([...bo.values()].map(b=>b.key)).size>1;   // course is a dimension: name the lane once there is more than one
  return [...g.values()].sort((x,y)=>!x.b?-1:!y.b?1:x.b.n-y.b.n||x.b.o-y.b.o)
    .map(({b,ws})=>({n:b?b.n:'',k:b?b.key+':'+b.n:'',name:b?(multi?b.name+' · ':'')+'Batch '+b.n:'Before batches',ws,clr:ws.filter(w=>!w.n).length}))}   // k: lane + number (23 Nov: Standard batch 1 and Advanced batch 1 shared one open/closed state)
function renderInbox(){const box=$('#inboxBox');if(!box||!B)return;
  const all=allWork(),W=[...all.values()].filter(w=>w.n).sort(workOrder),rep=typeof repOpen==='function'?repOpen().length:0,lv=typeof lvTodoN==='function'?lvTodoN():0;
  const card=(k,n,title,what,href,doneText,body='')=>n?`<section class="icard" data-card="${k}"><a class="ihead" href="${href}"><span class="ict">${n}</span><span class="itx"><b>${title}</b><span class="iwhat">${what}</span></span><span class="igo" aria-hidden="true">→</span></a>${body}</section>`
    :`<section class="icard idone" data-card="${k}"><a class="ihead" href="${href}"><span class="itick" aria-hidden="true">✓</span><span class="itx"><b>${title}</b><span class="iwhat">${doneText}</span></span><span class="igo">${k==='papers'?'Show all papers':'Open'} →</span></a></section>`;
  const SEEN=checkerSeen(),SHOW=8,row=w=>`<li><a class="iprow${SEEN.has(String(w.doc))?'':' rv-unseen'}" href="#review/paper/${w.doc}"><span class="ipn"><span class="rv-pnm">${esc(docLabel(B.docs[w.doc]))}</span>${w.left.decide?'<span class="rv-call">waiting on your call</span>':''}${SEEN.has(String(w.doc))?'':unseenTag}</span>${miniTrack(w)}<span class="ipl">${workLine(w)}</span></a></li>`;
  // groups open in order until SHOW rows are out; later groups show their header and open on a click ("N more" counts their rows)
  const G=W.length?inboxGroups(all):null,was=new Map([...box.querySelectorAll('details.rv-bg')].map(d=>[d.dataset.batch,d.open]));let shown=0,more=Math.max(0,W.length-SHOW),list=`<ul class="iplist">${W.slice(0,SHOW).map(row).join('')}</ul>`;
  if(G){more=0;list=`<div class="rv-bgs">${G.map(g=>{const todo=g.ws.filter(w=>w.n),head=`${esc(g.name)} · ${g.clr} of ${g.ws.length} cleared`;
    if(!todo.length)return `<div class="rv-bg rv-bgdone" data-batch="${esc(g.k)}"><span class="rv-bgh">${head}</span></div>`;
    const open=shown<SHOW;if(open)shown+=todo.length;else more+=todo.length;
    return `<details class="rv-bg" data-batch="${esc(g.k)}"${(was.has(g.k)?was.get(g.k):open)?' open':''}><summary class="rv-bgh">${head}</summary><ul class="iplist">${todo.map(row).join('')}</ul></details>`}).join('')}</div>`}
  // owner 18 Nov: "it [should] be more obvious on the page when questions have been done by you and have been returned. Maybe a
  //   different place to the flagged waiting for claude ones, I think they use the same real estate right now": returned work is the
  //   first thing on Review, highlighted, with what came back; flags still waiting for Claude sit lower down, quieter
  box.innerHTML=`<div class="ihd"><h2>Review</h2><p class="sub">What is waiting for you. Papers are walked one at a time, top to bottom.</p></div>
    ${(()=>{const bq=B.questions.filter(backQ);if(!bq.length)return '';
      const what=q=>{const r=reviews['q'+q.id]||{};if(r.status==='flagged'&&r.fixed)return fixTxt(r.fixed.note);
        const k=Object.keys(r.fig_done||{}).find(k=>!(r.fig||{})[k]);return k?splitDone(r.fig_done[k],r.fig_notes?.[k]).fix:''};
      const rows=bq.slice(0,6).map(q=>`<li><b>${qid(q)}</b> <span class="muted">${esc(srcLine(q))}</span><span class="rv-bkwhat">${esc(what(q))}</span></li>`).join('');
      return card('back',bq.length,'Fixed and back for you','Claude fixed these after your flag or change request. Check each one and approve it, or flag it again.','#review/list/back','',
        `<ul class="rv-bklist">${rows}</ul>${bq.length>6?`<a class="imore" href="#review/list/back">${bq.length-6} more · Check them all →</a>`:`<a class="imore" href="#review/list/back">Check them now →</a>`}`).replace('class="icard"','class="icard rv-back"')})()}
    ${card('papers',W.length,'Papers to review','Open a paper and walk it top to bottom: your calls, flagged, topics, diagrams, then the spot-check that approves the rest.','#review/papers','all approved',
      readyHTML()+`${list}<a class="imore" href="#review/papers">${more?`${more} more · `:''}Show all papers →</a>`)}
    <div class="ipair">${card('reports',rep,'Reports','Questions reported from an exam paper: a wrong difficulty, a wrong dot point or something else. Resolve or dismiss each one.','#review/reports','nothing open')}
    ${card('difficulty',lv,'Difficulty','HSC reference ratings: agree or change the band and kind, one part at a time.','#review/difficulty','check plan finished')}</div>
    ${(()=>{// owner 23 Nov: "why don't these numbers match" (the card "35 Flags waiting for Claude" counted QUESTIONS, the banner said
      // "43 flags waiting for Claude (35 questions)"): the card now says it counts questions and gives the banner's flag count (pendingFlags)
      const nw=B.questions.filter(waitQ).length,[nf]=pendingFlags();return nw?card('waiting',nw,`Question${nw===1?'':'s'} with flags waiting for Claude`,`${nf} flag${nf===1?'':'s'} (flags and diagram change requests) Claude has not fixed yet. Nothing to do here: they move to "Fixed and back for you" at the top once fixed.`,'#review/list/waiting','').replace('class="icard"','class="icard rv-wait"'):''})()}
    ${handoffHTML()}<div class="ifoot"><a href="#review/list/recent">Recently approved</a><span aria-hidden="true">·</span><label>Other lists ${otherListsHTML('')}</label></div>`}
// draw the Review chrome for the open view: the Inbox, or the paper's track (list mode: a plain header). Also keeps the counts.
function renderSteps(){if(!B||!QG.detOK)return {base:[]};updateCounts();   // job 2: steps count triage, which comes with the details
  
  if(view==='inbox'){renderInbox();return {base:[]}}
  if(view==='papers'&&$('#ptable')){renderPapers();return {base:[]}}
  if(view!=='review')return {base:[]};
  const base=rdoc?B.questions.filter(q=>docIds(rdoc).includes(q.doc)):B.questions;
  const rb=$('#rbar');rb.classList.toggle('paper',RMODE==='paper');rb.classList.toggle('list',RMODE!=='paper');
  const dleft=base.filter(q=>inFilter(q,'diagrams')).reduce((n,q)=>n+chkFigs(q).filter(k=>!reviews['q'+q.id]?.fig?.[k]).length,0);   // owner 12 Nov: "why does my diagram review say 468" -> label the unit
  if(RMODE==='paper'){const w=paperWork(rdoc),cur=STEPS.find(x=>x[0]===rfilter)||STEPS[0];
    $('#rtitle').innerHTML=`<b>${esc(docLabel(B.docs[w.doc]))}</b><span class="rleft">${w.n?`${w.n} left`:'✓ done'}</span>`;
    $('#filters').innerHTML=trackHTML(w,rfilter);
    $('#stephelp').innerHTML=`<b>${STEPS.indexOf(cur)+1}. ${esc(cur[1])}.</b> ${rfilter==='diagrams'&&w.left.diagrams?`${w.left.diagrams} question${w.left.diagrams===1?'':'s'} · ${dleft} diagram${dleft===1?'':'s'} left. `:''}${esc(cur[2])}`;
    try{const fs=$('#filters'),pb=fs.querySelector('.step[aria-current="step"]');if(pb&&fs.scrollWidth>fs.clientWidth){const a=fs.getBoundingClientRect(),b=pb.getBoundingClientRect();fs.scrollLeft+=b.left-a.left-(a.width-b.width)/2}}catch(e){}
  }else{const inSel=FILTERS.some(x=>x[0]===rfilter);$('#rtitle').innerHTML=`${inSel?'':`<b>${esc(stepLabel(rfilter))}</b>`}${otherListsHTML(inSel?rfilter:'')}`;   // the select names the list
    $('#filters').innerHTML='';
    $('#stephelp').innerHTML=rfilter==='recent'?'Newest approvals first. F flags a question again; the note says why.':`Every question in this list, any status.${rdoc?'':' Pick a paper to narrow it.'}`}
  return {base}}
// open a step of the paper (or a list); Difficulty and Reports are Inbox sections
function goStep(f,st){if(f==='difficulty'){location.hash='#review/difficulty';return}if(f==='reports'){location.hash='#review/reports';return}
  if(RMODE==='paper'&&rdoc&&view==='review'&&STEPS.some(x=>x[0]===f)){const h='#review/paper/'+mainDoc(rdoc)+'/'+SLUG[f];if(location.hash!==h)location.hash=h;return}
  location.hash='#review/list/'+f}
// the address names the paper and step (or the list); called by route() once the bank is loaded
function openReview(P){
  if(P.doc){if(!docGroups().has(String(P.doc))){setHash('#review');return false}
    const d=mainDoc(P.doc),k=UNSLUG[P.step]||'';const was=RMODE+'|'+rdoc+'|'+rfilter;
    RMODE='paper';rdoc=d;rstatus='todo';
    if(k)rfilter=k;else{rfilter=paperWork(d).at||'sample'}
    const h='#review/paper/'+d+'/'+SLUG[rfilter];if(location.hash!==h)setHash(h);
    if(was!==RMODE+'|'+rdoc+'|'+rfilter){ridx=0;_prevLeft=null}}
  else{const f=FILTERS.some(x=>x[0]===P.list)||STEPS.some(x=>x[0]===P.list)?P.list:'recent';
    if(RMODE!=='list'||rfilter!==f)ridx=0;RMODE='list';rfilter=f;rstatus='any';rdoc=$('#docF').value;
    if(f!==P.list)setHash('#review/list/'+f)}   // an unknown list name: the address says which list is shown
  return true}
function refreshReview(){ if(typeof renderJobs==='function')renderJobs();
  _advanced=false;
  // owner 13 Nov: when a step hits 0 it moves on to the next step with work, with a small toast ("Your calls done → Flagged")
  if(RMODE==='paper'&&rdoc&&rstatus==='todo'){const w=paperWork(rdoc),p=_prevLeft;
    if(p&&p.doc===rdoc&&p.f===rfilter&&p.n>0&&!w.left[rfilter]){const nx=nextStepWith(w,rfilter);
      if(nx){_holdToast=Date.now()+2200;toast(`${stepLabel(rfilter)} done → ${stepLabel(nx)}`);rfilter=nx;ridx=0;_advanced=true;setHash('#review/paper/'+rdoc+'/'+SLUG[nx])}
      else if(!w.n){_holdToast=Date.now()+2200;toast(`${docLabel(B.docs[w.doc])} done`)}}
    _prevLeft={doc:rdoc,f:rfilter,n:w.left[rfilter]}}
  const {base}=renderSteps();
  rlist=base.filter(q=>inFilter(q,rfilter)&&statusOK(q));
  if(rfilter==='diagrams') rlist.sort((a,b)=>qRisk(b)-qRisk(a));
  if(rfilter==='recent') rlist.sort((a,b)=>String(approvedAt(b)).localeCompare(String(approvedAt(a))));   // riskiest diagrams first (stable: paper order within a level)
  if(pendingOpen){const i=rlist.findIndex(q=>q.id===pendingOpen);if(i>=0)ridx=i;pendingOpen=null}
  if(ridx>=rlist.length) ridx=Math.max(0,rlist.length-1);
  renderReview();
}
const figMode={};
// owner 17 Nov: "we need to know what the original flag is so the reviewer can compare". fig_done is
// "<checker's request> -> Claude <time>: <what changed>"; redraws from before 17 Nov hold only "<date> redraw (fixN)".
// The request is also kept in fig_notes (older redraws, "2026-11-12 redraw (fix8)", have it only there).
// health pass 21 Nov: one way to drop the "Claude <date> <time> (<who>):" prefix of a fix note (three patterns before; one kept the prefix when the note had a time)
const fixTxt=t=>String(t||'').replace(/^Claude \d+ \w+(?: \d+:\d\d)?(?: \([^)]*\))?: /,'');
const splitDone=(done,ask)=>{const i=done.indexOf(' -> ');return i<0?{ask:ask||'',fix:'',when:done}:{ask:done.slice(0,i)||ask||'',fix:fixTxt(done.slice(i+4))}};
function doneHTML(done,ask){const d=splitDone(done,ask);
  return `<div class="callout"><div><b>Your original request:</b> ${d.ask?noteTxt(d.ask):'none: Claude redrew this in a rule sweep, not from a flag of yours'}</div><div><b>What Claude changed:</b> ${d.fix?noteTxt(d.fix):'redrawn '+esc(d.when)+(d.ask?' to meet your request':'')}</div></div>`}
// owner 17 Nov: "where is the original flag on the back to you page?": one box at the top of every returned item lists each
// original flag or request beside what Claude changed, before the question, so the checker reads it first.
// owner 17 Nov: "why does fixewd and back tou have approved questions?": an approved question is listed when a diagram was
// redrawn after the approval; the badge says "text approved · redrawn diagram needs your OK" instead of "approved".
function backBoxHTML(q,r){if(waitR(r)&&!q.dup_of)return waitBoxHTML(r);if(!r||!backQ(q))return '';const rows=[];
  if(r.status==='flagged'&&r.fixed)rows.push(['Question',r.note||'(no note written)',fixTxt(r.fixed.note)]);
  for(const [k,done] of Object.entries(r.fig_done||{})){if((r.fig||{})[k])continue;const d=splitDone(done,r.fig_notes?.[k]);
    rows.push([/_s\d+$/.test(k)?'Solution diagram':'Diagram',d.ask||'none: redrawn by Claude in a rule sweep',d.fix||'redrawn '+d.when])}
  if(!rows.length)return '';
  return `<div class="backbox"><h4>Back for you: your original flag and what Claude changed</h4><table><thead><tr><th></th><th>Your original flag</th><th>What Claude changed</th></tr></thead><tbody>${rows.map(([w,a,f])=>`<tr><th>${esc(w)}</th><td>${noteTxt(a)}</td><td>${noteTxt(f)}</td></tr>`).join('')}</tbody></table><div class="help">Compare with the source page and, for diagrams, the Before → now pictures below. Approve, or flag it again.</div></div>`}
function figCompareHTML(q){
  const ks=qFigs(q); if(!ks.length) return '';
  const row=k=>{const f=B.figs[k],dec=figDec(q,k);
    const right=f.status==='table'?dtHTML(f.table,{blank:true}):`<img class="fig" alt="Redrawn" data-k="${k}" data-kind="svg">`;
    const done=reviews['q'+q.id]?.fig_done?.[k]; const hasV1=f.status!=='table'&&f.cls!=='table_drawn';
    const mode=figMode[k]||(done&&!dec?'before':'side');
    const tabs=f.status==='table'?'':`<div class="seg" role="group" aria-label="View">${[['side','Side by side'],['overlay','Overlay'],...(hasV1?[['before','Before → now']]:[])].map(([m,l])=>`<button class="segb" data-fmode="${k}" data-m="${m}" aria-pressed="${m===mode}">${l}</button>`).join('')}</div>`;
    const ov=f.ov?`<div class="help">Overlap with the original: <b>${Math.round(f.ov[0]*100)}%</b> of the original's ink lies on the redraw and <b>${Math.round(f.ov[1]*100)}%</b> of the redraw's ink lies on the original (within 2 px). Thin lines against thick scanned strokes and different stipple dots lower this without being errors.</div>`:'';
    // checker 20 Nov flags "original image missing" (Girraween Q3, twice) and "original image is missing. Find and put it there" (Hornsby
    // Q18): a sketch Claude drew for a worked solution has no original (figures row page 0, no box; bank fig.no). Say so in the box.
    const orig=f.no?`<figure><figcaption>Original</figcaption><p class="rv-nov1">No original: the paper has no diagram here. Claude drew this sketch for the worked solution, so check it against the solution's working.</p></figure>`:`<figure><figcaption>Original</figcaption><img class="fig" alt="Original" data-k="${k}" data-kind="png"></figure>`;
    const views={
      side:`<div class="cmp">${orig}<figure><figcaption>${f.status==='table'?'As a table':'Redrawn (now)'}</figcaption>${right}</figure></div>`,
      overlay:`<figure class="ovfig"><figcaption><span style="color:#e12d2d">■ only in original</span> · <span style="color:#285ae6">■ only in redraw</span> · <span style="color:var(--ink)">■ both</span></figcaption><img class="fig" alt="Overlay of original and redraw" data-k="${k}" data-kind="ov"></figure>${ov}`,
      before:`${done?doneHTML(done,reviews['q'+q.id]?.fig_notes?.[k]):''}<div class="cmp3">${orig}<figure><figcaption>Before (the version you reviewed)</figcaption><img class="fig" alt="First redraw" data-k="${k}" data-kind="v1"></figure><figure><figcaption>Now</figcaption>${right}</figure></div>`};
    return `<div class="figrow">${tabs}${views[f.status==='table'?'side':mode]}
      <div class="row">${f.status==='approx'?'<span class="badge b-scan">estimated shape</span>':''}${f.check==='fixed'?'<span class="badge b-acc">fixed by checker</span>':''}${f.check==='concern'?'<span class="badge b-bad">checker concern</span>':''}
        ${dec?`<span class="badge ${dec==='approved'?'b-ok':dec==='changes'?'b-gen':'b-bad'}">${dec==='approved'?'redraw approved':dec==='changes'?'changes requested':'keeping original'}</span>`:''}</div>
      ${!dec&&done&&mode!=='before'?doneHTML(done,reviews['q'+q.id]?.fig_notes?.[k]):''}
      ${dec==='changes'&&reviews['q'+q.id]?.fig_notes?.[k]?`<div class="callout"><b>Your request:</b> ${noteTxt(reviews['q'+q.id].fig_notes[k])}</div>`:''}
      ${f.notes?`<details class="help"><summary>What was changed</summary>${esc(f.notes).split(' | ').map(x=>`<div>${x}</div>`).join('')}</details>`:''}${f.check_notes&&f.check!=='pass'?`<div class="help"><b>Checker:</b> ${noteTxt(f.check_notes)}</div>`:''}
      <div class="row"><button class="act ok" data-fig="${k}" data-v="approved">Use redraw</button><button class="act" data-figreq="${k}">Request changes</button><button class="act warn" data-fig="${k}" data-v="rejected">Keep original</button></div>
      <div class="req" data-reqbox="${k}" hidden><label class="help" for="rq-${k}">What should change in the redraw? Claude redraws it from this note in the next session.</label><textarea id="rq-${k}" placeholder="e.g. Make it match the original sketch proportions; label the angle at B as 30°">${esc(reviews['q'+q.id]?.fig_notes?.[k]||'')}</textarea><div class="row"><button class="act ok" data-reqsave="${k}">Save request</button><button class="act ghost" data-reqcancel="${k}">Cancel</button></div></div></div>`};
  const pend=ks.filter(k=>figDec(q,k)!=='approved'), ok=ks.filter(k=>figDec(q,k)==='approved');
  const okBlock=ok.length?`<details class="figdone"><summary>✓ ${ok.length} diagram${ok.length>1?'s':''} approved · show comparison</summary>${ok.map(row).join('')}</details>`:'';
  if(!pend.length) return okBlock;   // nothing to decide: stay out of the way of the question and solution
  return `<div class="section"><h4>Diagrams to check · original vs redraw</h4>${pend.map(row).join('')}
    ${pend.length>1?`<div class="row"><button class="act ok" id="figAll">Use all redraws on this question <kbd>D</kbd></button></div>`:''}${okBlock}</div>`;
}
function tagEditHTML(q,p){
  return `<div class="tags">${effTags(q,p).map(t=>chipHTML(t,p)).join('')}<button class="act ghost edit-tag" data-part="${p.id}">Change tag</button></div>${editing===p.id?pickerHTML():''}${p.note?`<div class="notes">${noteTxt(p.note)}</div>`:''}`;
}
function pickerHTML(){return `<div class="picker"><input id="pickQ" type="search" placeholder="Search dot points: e.g. chain rule, annuity, Y12-220" aria-label="Search dot points">
  <div class="row"><button class="act" id="setRemoved">Mark removed content</button><button class="act" id="setNoMatch">Mark no match</button><button class="act" id="cancelPick">Cancel</button></div><ul id="pickList"></ul></div>`}
function whyHTML(q){
  const t=q.tri; if(!t) return '';
  const cls=t.tier==='decide'?'decide':t.tier==='sample'?'sample':'';
  // owner 24 Nov: "the why this is here box get cut off": reasons come in full (tools/triage.py no longer cuts them); a long one shows
  //   about two lines and a "more" toggle. "some of the text came out a bit weird": plain notes keep a literal $ (noteTxt, 02_text.js)
  const li=w=>w.length>180?`<li class="rv-long"><span class="rv-clamp">${noteTxt(w)}</span> <button type="button" class="lk rv-more" aria-expanded="false">more</button></li>`:`<li>${noteTxt(w)}</li>`;
  return `<div class="why ${cls}"><b>Why this is here</b><ul>${t.why.map(li).join('')||'<li>Passed every check</li>'}</ul>${t.look.length?`<b>What to check</b><ol>${t.look.map(li).join('')}</ol>`:''}</div>`}
document.addEventListener('click',e=>{const b=e.target.closest?.('.why .rv-more');if(!b)return;const li=b.closest('li'),o=li.classList.toggle('open');b.textContent=o?'less':'more';b.setAttribute('aria-expanded',o)});
function sampleBanner(doc){doc=+doc;
  const qs=B.questions.filter(q=>q.doc===doc&&!q.dup_of), smp=qs.filter(q=>q.tri?.tier==='sample'), rest=qs.filter(q=>q.tri?.tier==='auto');
  if(reviews['paper_'+doc]?.status==='approved'&&flagsIn(doc).length&&rest.length) return `<div class="why"><b>${flagsIn(doc).length} flagged</b>The other ${rest.length} questions in ${esc(docLabel(B.docs[doc]))} count as approved again once every flagged question is fixed and approved.</div>`;
  if(!smp.length||!rest.length||paperOK(doc)) return paperOK(doc)?`<div class="banner">✓ ${esc(docLabel(B.docs[doc]))}: spot-check clean, the other ${rest.length} questions are approved.</div>`:'';
  const ok=smp.filter(q=>reviews['q'+q.id]?.status==='approved').length, bad=smp.filter(q=>reviews['q'+q.id]?.status==='flagged').length;
  const fl=flagsIn(doc).length;
  if(!bad&&fl&&ok===smp.length) return `<div class="why"><b>Spot-check done, but ${fl} question${fl===1?' is':'s are'} flagged</b>The other ${rest.length} questions in ${esc(docLabel(B.docs[doc]))} can be approved once every flagged question is fixed and approved.</div>`;
  if(bad) return `<div class="why"><b>Spot-check</b>${bad} of ${smp.length} sampled questions in ${esc(docLabel(B.docs[doc]))} were flagged, so the rest of this paper stays unapproved. Claude will re-check the paper.</div>`;
  if(ok<smp.length) return `<div class="help">Spot-check for ${esc(docLabel(B.docs[doc]))}: ${ok} of ${smp.length} done. When all are fine you can approve the other ${rest.length} questions in one click.</div>`;
  return `<div class="banner"><span>All ${smp.length} spot-checked questions in <b>${esc(docLabel(B.docs[doc]))}</b> are fine.</span><button class="act ok" data-paperok="${doc}">Approve the other ${rest.length} questions in this paper</button></div>`}
async function approvePaper(doc){if(await FRESH.block())return;doc=String(doc);const key=RKEY.pdoc(doc);RUNDO.note('p',doc,reviews['paper_'+doc]);const next={...(reviews['paper_'+doc]||{}),status:'approved',doc:+doc,by:me||null,at:new Date().toISOString()};if(B.docs[doc]?.key)next.key=B.docs[doc].key;
  RKEY.docsOf(doc).forEach(d=>reviews['paper_'+d]=next);TOPICS=null;   // owner 14 Nov (Fix 2): one decision for every file of the paper
  if(!db){toast('Not saved: this view has no shared storage');return}
  if(view==='review')refreshReview();else renderSteps();   // move on at once (owner 12 Nov: "why doesn't approving auto next"); the save finishes in the background
  try{await db.doc('reviews/'+key).set(next);if(Date.now()>_holdToast)toast('Paper approved')}catch(e){toast('Could not save. Try again in a moment.')}}
/* Calls on a whole paper (owner 13 Nov, the import notes: a cover label, a trial filed as an assessment task). Raised by Claude
   in site/project/open_decisions.json as "paper_<doc>" (bank docs[doc].call {text, raised}); shown at the top of the paper's
   Your calls step and counted in it (workOf), so the paper list and the Inbox count them. The owner answers on the card:
   "Keep as is" or a typed answer; it is stored in reviews/paper_<doc>.call {status:'approved'|'flagged', note, by, at} next
   to the paper approval. An answer older than the call's raised time does not count. Claude applies a typed answer and
   removes the entry. */
const PCALL={
  list(ids){return ids.map(d=>{const c=B.docs[d]?.call;if(!c)return null;const a=reviews['paper_'+d]?.call;
    return {doc:+d,text:c.text,a,open:!(a&&(!c.raised||String(a.at||'')>=c.raised))}}).filter(Boolean)},
  html(ids){return PCALL.list(ids).map(c=>`<div class="why decide pcall" data-pcall="${c.doc}"><b>Call on this paper · ${esc(docLabel(B.docs[c.doc]))}</b><p>${noteTxt(c.text)}</p>
    ${c.open?`<div class="row"><button class="act ok" data-pcok="${c.doc}">Keep as is</button><button class="act warn" data-pcopen="${c.doc}">Change…</button></div>
      <div class="flagbox" data-pcbox="${c.doc}" hidden><label class="help" for="pcn-${c.doc}">What should it be? <kbd>Enter</kbd> sends, <kbd>Esc</kbd> cancels.</label><input id="pcn-${c.doc}" type="text" placeholder="e.g. Label it AT4"></div>`
    :`<div class="help">✓ Your answer: ${c.a.status==='approved'?'keep as is':noteTxt(c.a.note||'')} <span class="muted">· ${esc(ago(c.a.at))}</span> <button class="lk" data-pcopen="${c.doc}">change</button></div>
      <div class="flagbox" data-pcbox="${c.doc}" hidden><input id="pcn-${c.doc}" type="text" aria-label="Your answer" value="${esc(c.a.note||'')}"></div>`}</div>`).join('')},
  async answer(doc,status,note){if(status==='approved'&&await FRESH.block())return;const key=RKEY.pdoc(doc);const next={...(reviews['paper_'+doc]||{}),doc:+doc,call:{status,note:note||null,by:me||null,at:new Date().toISOString()}};
    if(B.docs[doc]?.key)next.key=B.docs[doc].key;RKEY.docsOf(doc).forEach(d=>reviews['paper_'+d]=next);if(view==='review')refreshReview();else renderSteps();
    if(!db){toast('Not saved: this view has no shared storage');return}
    try{await db.doc('reviews/'+key).set(next);if(Date.now()>_holdToast)toast('Saved')}catch(e){toast(e?.code==='not_granted'||e?.code==='forbidden'?'You can view but not save decisions here':'Could not save. Try again in a moment.')}}};
document.addEventListener('click',e=>{const t=e.target.closest&&e.target.closest('[data-pcok],[data-pcopen]');if(!t)return;e.preventDefault();
  if(t.dataset.pcok){PCALL.answer(t.dataset.pcok,'approved');return}
  const bx=$(`[data-pcbox="${t.dataset.pcopen}"]`);if(bx){bx.hidden=false;bx.querySelector('input').focus()}});
document.addEventListener('keydown',e=>{const i=e.target.closest&&e.target.closest('[data-pcbox] input');if(!i)return;const d=i.closest('[data-pcbox]').dataset.pcbox;
  if(e.key==='Enter'){e.preventDefault();const v=i.value.trim();if(!v){toast('Type your answer first');return}PCALL.answer(d,'flagged',v)}
  else if(e.key==='Escape'){i.closest('[data-pcbox]').hidden=true}},true);
// owner 12 Nov: "one question per page ... K should be to go next. Bind a keystroke to approve, bind a keystroke to flag ...
// pull up a textbox ... hit enter to send the flag through. Keep a log on the side ... That can collapse as well." The log is the
// Recent decisions column (36_undo.js), merged with Recently approved on 24 Nov (owner: "merge the recent descision and recently
// approved list as they are different"); it still collapses.
// owner 12 Nov: "How often should I hand diagram flags to you? Should we show in the UI when to do that?"
// A flag stays 'changes' until Claude redraws it and clears it, so the count of 'changes' = flags not yet handed over.

// owner 18 Nov: "Why does it say both 11 and 20?" -> count per bank question, as the Flags card does: the reviews index holds each
//   question's decision under its k_ key and again under q<id>, so walking the raw docs counted every request twice
//   and text flags were left out; now flags = diagram requests + open text flags, questions = the card's waitQ count
function pendingFlags(){let n=0,nq=0;(B?.questions||[]).forEach(q=>{if(!waitQ(q))return;const r=reviews['q'+q.id];n+=Object.values(r?.fig||{}).filter(v=>v==='changes').length+(r.status==='flagged'&&!r.fixed?1:0);nq++});return [n,nq]}
// owner 19 Nov: "I need a way for the reviewer to run flags, he couldn't do it all of his last shift" -> "Button + checks in shift",
// "monday, tuesday, wednesday, friday 9-5 all those days": the button writes runs/<id> {kind:'flags', status:'requested'}; a scheduled
// session checks hourly in those hours (the platform's minimum) (FLAGS.md "Scheduled check"), the night run clears what is left
// owner 23 Nov: "get a way for claude to instantly run flags when checker needs them done": the button also sends the request to Claude
//   as a comment (comments capability, sendToClaude, from the click itself), which wakes the standing flag-watcher session at once
//   (FLAGS.md "Instant runs"); the runs doc stays the record and the fallback (hourly shift check, night run) when no session can take it
const FLR={runs:[],sub:0,cm:null,cs:null,
  watch(){if(this.sub||!db)return;this.sub=1;window.claude?.use?.('comments').then(c=>{this.cm=c;return c?.canSendToClaude?.()}).then(v=>{this.cs=v||null},()=>{});try{db.collection('runs').onSnapshot(s=>{this.runs=QG.docs(s).filter(r=>r.kind==='flags');if(view==='review')renderReview()},()=>{this.sub=0})}catch(e){this.sub=0}},
  last(){return this.runs.slice().sort((a,b)=>String(b.at).localeCompare(String(a.at)))[0]||null},
  async ask(btn){if(!db){toast('Needs the shared database (open the page in claude.ai)');return}const id='flags_'+Date.now(),doc={kind:'flags',status:'requested',by:QG.me||null,at:new Date().toISOString()};
    const [n,nq]=pendingFlags();let now=false;
    if(this.cm&&this.cs==='available')try{const anchor=await this.cm.anchorFor(btn);   // first, while the click is fresh
      await this.cm.sendToClaude({anchor,text:`Fix my flags now: ${n} flag${n===1?'':'s'} in ${nq} question${nq===1?'':'s'} waiting (request runs/${id}). Please run FLAGS.md and hand them back.`});now=true}
      catch(e){console.warn('Fix my flags now: not sent to Claude at once',e?.code||e);this.cs=null}
    if(now)doc.instant=true;
    try{await db.doc('runs/'+id).set(doc);this.runs.push({id,...doc});toast(now?'Sent to Claude: starting now':'Sent to Claude');renderReview()}catch(e){toast('Could not send ('+(e?.code||e?.message||'unknown error')+'). Try again in a moment.');console.warn('Fix my flags now: write refused',e)}}};   // 23 Nov: the checker reports the button "not working" and no runs/flags_* doc was written since 20 Nov: the code makes the next failure diagnosable
// when Claude picks a request up: read from the page database (progress/night: flagcheck, written when the scheduled check changes,
// and time, the night run's), not typed in (owner 21 Nov: "make sure there's no hanging numbers anywhere which can go stale")
const FLR_WHEN=()=>`Claude checks ${esc(QG.night?.flagcheck||'during the checker\'s shift')}; otherwise at the night run${QG.night?.time?` (${esc(QG.night.time)})`:''}.`;
// owner 25 Nov ("Besides that, yes action all these things"), relaying the checker: "The Curate page shows a developer log to users. It's full
// of jargon ("Live as v336... another Claude session had committed... unpublished") and ends in ".."." The last run is one plain sentence
// built from the run doc: how many flags were fixed (fixed, else the "<n> fixed" / "<n> of <m> back for approval" in result), how many
// wait for Steve (waiting, else "<m> wait for Steve") and when it went live (done_at). The run's own text stays behind "Details" for the
// owner (FLAGS.md step 4 writes fixed and waiting since 25 Nov)
function runLine(r){const when=clockT(r.done_at||r.at),res=String(r.result||''),num=(v,re)=>v!=null&&v!==''&&!isNaN(+v)?+v:(m=>m?+m[1]:null)(re.exec(res));
  const fixed=num(r.fixed,/(\d+)\s+(?:of\s+\d+\s+)?(?:flags?\s+)?(?:fixed|back for approval)/i),wait=num(r.waiting,/(\d+)\s+waits?\s+for\s+Steve/i);
  const s=r.status==='failed'?`The last run (${when}) could not finish. Flags still open can be sent again.`
    :fixed?`Fixed ${fixed} flag${fixed===1?'':'s'}; live since ${when}.`+(wait?` ${wait} wait${wait===1?'s':''} for Steve.`:'')
    :/nothing (open|waiting|to fix)/i.test(res)?`Last checked ${when}: nothing was waiting.`:`Last run finished ${when}.`+(wait?` ${wait} wait${wait===1?'s':''} for Steve.`:'');
  return `<span class="rv-runline">${esc(s)}</span>${isOwnerV()&&res?`<details class="rv-runlog"><summary>Details</summary><p>${esc(res)}</p></details>`:''}`}
function handoffHTML(){const [n,nq]=pendingFlags();FLR.watch();const r=FLR.last(),act=r&&(r.status==='requested'||r.status==='running');
  const t=x=>x?new Date(x).toLocaleString('en-AU',{weekday:'short',hour:'numeric',minute:'2-digit'}):'';
  const st=act?(r.status==='running'?`<b>Claude is fixing them</b> (started ${t(r.started||r.at)}). They come back under "Fixed and back for you".`:`<b>Sent to Claude</b> ${t(r.at)}. ${r.instant?'Claude should start within a few minutes.':FLR_WHEN()}`)
    :r&&(r.status==='done'||r.status==='failed')&&Date.now()-(parseT(r.done_at||r.at)||0)<864e5?runLine(r):'';
  if(!n&&!act)return st?`<div class="handoff">${st}</div>`:'';
  return `<div class="handoff${act?'':' due'}"><b>${n} flag${n===1?'':'s'} waiting for Claude</b> <span class="muted">(${nq} question${nq===1?'':'s'})</span>${act?` · ${st}`:` <button type="button" class="act ok" data-flr>Fix my flags now</button><span class="muted"> ${FLR_WHEN()}</span>${st?` ${st}`:''}`}</div>`}
document.addEventListener('click',e=>{if(e.target.closest?.('[data-flr]')){const b=e.target.closest('[data-flr]');b.disabled=true;FLR.ask(b)}});
function renderDiag(){
  const q=rlist[ridx];
  const done=rlist.filter(x=>!isTodo(x,'diagrams')).length;
  $('#pos').textContent=rlist.length?`Question ${ridx+1} of ${rlist.length} · ${rlist.length-done} questions left`:'0 / 0'; $('#prog').style.width=(rlist.length?100*done/rlist.length:0)+'%';
  if(!q){$('#rout').innerHTML=handoffHTML()+`<div class="dwrap"><div class="empty">No diagrams waiting. ${nextStepHTML()}</div></div>`;bindNext();return}
  // owner 23 Nov: "there are quite a lot of missing images in the standard exam checkers": the Diagrams step showed a broken
  // Original for sketches Claude drew for worked solutions (fig.no, no box in the paper); it now says so, as the flag view does
  const ks=chkFigs(q), r=reviews['q'+q.id]||{};
  $('#rout').innerHTML=handoffHTML()+`<div class="dwrap"><div class="dmain">
    <div class="row"><b style="font-size:18px">${qid(q)}</b><span class="muted">${esc(srcLine(q))} · ${ks.length} diagram${ks.length>1?'s':''}</span></div>
    ${ks.map((k,i)=>{const f=B.figs[k],dec=r.fig?.[k];return `<div class="dq${dec?' decided':''}"><div class="dnum">${ks.length>1?`<kbd>${i+1}</kbd> Diagram ${i+1} of ${ks.length} · `:''}${/_s\d+$/.test(k)?'solution':'question'} · <span class="conf c${figRisk(k)[1]}" title="${esc(riskTxt(k))}">${figRisk(k)[0]} confidence</span> <span class="muted">${esc(figRisk(k)[2])}</span></div><div class="cmp">${f.no?`<figure><figcaption>Original</figcaption><p class="rv-nov1">No original: the paper has no diagram here. Claude drew this sketch for the worked solution, so check it against the solution's working.</p></figure>`:`<figure><figcaption>Original</figcaption><img class="fig" alt="Original" data-k="${k}" data-kind="png"></figure>`}<figure><figcaption>${f.status==='table'?'As a table':'Redrawn'}</figcaption>${f.status==='table'?dtHTML(f.table,{blank:true}):`<img class="fig" alt="Redrawn" data-k="${k}" data-kind="svg">`}</figure></div>
      ${dec?`<span class="badge ${dec==='approved'?'b-ok':'b-bad'}">${dec==='approved'?'approved':'flagged: '+noteTxt(r.fig_notes?.[k]||'')}</span>`:''}${f.notes?`<details class="help"><summary>What the redraw changed</summary>${esc(f.notes).split(' | ').slice(-2).map(x=>`<div>${x}</div>`).join('')}</details>`:''}</div>`}).join('')}
    <details class="help"><summary>Question text</summary><div class="qtext">${qBody(q,'review')}</div></details>
    <div class="row keys"><button class="act ok" id="dA"><kbd>A</kbd> Approve</button><button class="act warn" id="dF"><kbd>F</kbd> Flag</button><span class="help"><kbd>J</kbd> previous · <kbd>K</kbd> next</span></div>
    <div class="flagbox" id="flagbox" hidden>${ks.length>1?`<div class="row" id="flagpick">${ks.map((k,i)=>`<label class="pick"><input type="checkbox" data-fk="${k}"> ${i+1}</label>`).join('')}<span class="help">Which diagram? Press its number (press again to untick; several allowed), then type the reason. None picked = all.</span></div>`:''}<label class="help" for="flagtxt">What's wrong? <kbd>Enter</kbd> sends the flag, <kbd>Esc</kbd> cancels.</label><input id="flagtxt" type="text" placeholder="e.g. label B is on the wrong vertex"></div>
  </div></div>`;
  hydrate($('#rout'),q,'review'); typeset($('#rout'));
  $('#dA').onclick=()=>diagDecide('approved'); $('#dF').onclick=openFlag;
  const ft=$('#flagtxt'); ft.onkeydown=e=>{if(/^[1-9]$/.test(e.key)&&!ft.value&&$('#flagpick')){e.preventDefault();pickDiag(+e.key);return}if(e.key==='Enter'){e.preventDefault();let t=ft.value.trim();const sel=new Set($$('#flagpick [data-fk]').filter(c=>c.checked).map(c=>c.dataset.fk));
    const m=ks.length>1&&t.match(/^([1-9](?:\s*[,&]\s*[1-9])*)\s*[:\-.)]?\s+(.*)$/);if(m){m[1].split(/[,&]/).forEach(d=>{const k=ks[+d.trim()-1];if(k)sel.add(k)});t=m[2].trim()}
    if(!t){toast('Type a reason first');return}diagDecide('changes',t,sel.size?[...sel]:null)}else if(e.key==='Escape'){$('#flagbox').hidden=true;ft.value=''}};
  $$('#flagpick [data-fk]').forEach(c=>c.onchange=markPicked);
}
function pickDiag(n){const c=$$('#flagpick [data-fk]')[n-1];if(!c)return;c.checked=!c.checked;markPicked()}
function markPicked(){const sel=new Set($$('#flagpick [data-fk]').filter(c=>c.checked).map(c=>c.dataset.fk));$$('#rout .dq').forEach((d,i)=>d.classList.toggle('picked',sel.has(chkFigs(rlist[ridx])[i])))}
function openFlag(){const b=$('#flagbox');if(!b)return;b.hidden=false;$('#flagtxt').focus()}
async function diagDecide(v,note,only){const q=rlist[ridx];if(!q)return;if(v==='approved'&&await FRESH.block())return;   // owner 23 Nov: "stale page approvals"
  const r=reviews['q'+q.id]||{};const ks=chkFigs(q);
  // owner 12 Nov: flag one diagram, not all of them ("21 flagged" was really ~12). Flagging some approves the rest on the page.
  const fig={...(r.fig||{})},notes={...(r.fig_notes||{})};ks.forEach(k=>{const hit=!only||only.includes(k);fig[k]=hit?v:(fig[k]||'approved');if(note&&hit)notes[k]=note});
  write(q,note?{fig,fig_notes:notes}:{fig}); const was=q.id; refreshReview();   // move on at once; the save finishes in the background
  if(!_advanced&&rlist[ridx]?.id===was) go(1); window.scrollTo({top:0});}   // the decided question leaves the to-do list; the next one takes its place
function nextStepHTML(){if(RMODE==='paper'&&rdoc)return paperNextHTML();
  const base=B.questions.filter(q=>!rdoc||docIds(rdoc).includes(q.doc));const nx=STEPS.map(([k,l],i)=>[k,l,i,base.filter(q=>inFilter(q,k)&&isTodo(q,k)).length]).filter(x=>x[0]!==rfilter&&x[3]>0);
  return nx.length?`<div class="row" style="margin-top:10px">${nx.map(([k,l,i,n])=>`<button class="act" data-gof="${k}">${i+1}. ${l} · ${n}</button>`).join('')}</div>`:'<div style="margin-top:8px">Your queue is empty: everything imported so far is checked.</div>'}
// owner 13 Nov ("One paper at a time"): in a paper, an empty step offers the next step with work, or says the paper is done
function paperNextHTML(){const w=paperWork(rdoc),nx=nextStepWith(w,rfilter),d=B.docs[w.doc];
  if(!w.n){const more=[...allWork().values()].filter(x=>x.n&&x.doc!==w.doc).sort(workOrder)[0];
    return `<div class="ppdone"><span class="ptick" aria-hidden="true">✓</span><div><b>${esc(docLabel(d))} is done.</b><div class="muted">Every step is clear.</div></div>
      <div class="row">${more?`<a class="act primary" href="#review/paper/${more.doc}">Next paper: ${esc(docLabel(B.docs[more.doc]))} →</a>`:''}<a class="act ghost" href="#review/list/all" data-browse="${w.doc}">See its questions</a><a class="act" href="#review">← Inbox</a></div></div>`}
  return `<div class="row" style="margin-top:10px">${nx?`<button class="act primary" data-gof="${nx}">Go to ${STEPS.findIndex(x=>x[0]===nx)+1}. ${esc(stepLabel(nx))} · ${w.left[nx]} →</button>`:''}<a class="act ghost" href="#review">← Inbox</a></div>`}
function bindNext(){$$('#rout [data-gof]').forEach(b=>b.onclick=()=>goStep(b.dataset.gof,b.dataset.any?'any':'todo'))}
/* owner 12 Nov ("lets do that"): Tags step — choose between tagger (A) and checker (B) where they disagreed a lot */
// owner 12 Nov ("I don't feel like I can accurately choose the gates" -> "yeah lets do that"): the owner picks only the TOPIC
// (main dot point, or removed). Gates are settled automatically: both sides' skills combined, each disputed skill kept only
// with a quoted solution step (work/gates). Parts whose two sides share the main dot point need no decision.
const tagPri=x=>x.dp.filter(d=>d[1]==='primary').map(d=>d[0]).join(',');
function tagNeed(p){const d=p.tagd;return !!d&&(tagPri(d.A)!==tagPri(d.B)||!!d.A.removed!==!!d.B.removed)}
// owner 12 Nov: "make the tag review page only show the question with the solutions collapsed and the tags so I can easily
// verify or not". The question reads as one piece; each part carries its tags; disputed parts carry the 1/2/F choice inline.
function qTagSummary(q){const lv=q.parts.filter(p=>leaf(q,p));const gates=[...new Set(lv.flatMap(p=>p.skills||[]))];
  const r=reviews['q'+q.id]?.home,ch=r==='A'||r==='B'?r:null,hA=homeOf(q,'A'),hB=homeOf(q,'B');
  const parts=side=>lv.filter(p=>partPri(q,p,side).some(i=>subKey(i)===homeOf(q,side))).map(p=>p.label?'('+esc(p.label)+')':'').join(' ');
  const opt=(k,lab,h)=>`<div class="topt${ch===k?' chosen':''}"><kbd>${k==='A'?1:2}</kbd> <span class="muted">${lab}</span> <span class="tdp">${homeLabel(h)}</span> <span class="muted">${parts(k)}</span>${ch===k?' <span class="badge b-ok">chosen</span>':''}</div>`;
  return `<div class="tchoice active"><div class="tchead">Home topic: where this question is filed${r&&!ch?` <span class="badge b-bad">your pick: ${homeLabel(qHome(q))}${r.note?' · '+noteTxt(r.note):''}</span>`:''}</div>
    ${opt('A','Tagger',hA)}${opt('B','Checker',hB)}
    <div class="row keys"><button class="act" data-tc="A"><kbd>1</kbd> Tagger</button><button class="act ok" data-tc="B"><kbd>2</kbd> Checker</button><button class="act warn" id="tF"><kbd>F</kbd> Both wrong: pick another</button>${r?`<button class="act ghost" data-redo="1">Undo</button>`:''}</div>
    <div class="flagbox tpick" id="tflag" hidden><div class="row"><b>Pick a dot point in the right topic</b><span class="seg" role="group" aria-label="Year">${['all','11','12'].map(y=>`<button class="act ghost${tpYear===y?' on':''}" data-ty="${y}">${y==='all'?'Both':'Year '+y}</button>`).join('')}</span></div>
        <input id="tflagtxt" type="search" placeholder="Search: e.g. chain rule, reciprocal, Y12-240 (Enter picks the first match, Esc cancels)" aria-label="Search dot points">
        <div id="tpList" class="tplist"></div>
        <div class="row"><input id="tpNote" type="text" placeholder="Optional note, e.g. no dot point covers graphing cot x" style="flex:1;min-width:0"><button class="act" id="tpRemoved">Removed from syllabus</button><button class="act" id="tpNone">No dot point fits</button></div></div>
    <div class="muted"><b>Gates (automatic)</b> ${gates.map(esc).join(', ')||'none'}</div></div>`}
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
function tagChoose(v){const q=rlist[ridx];if(!q)return;write(q,{home:v});TOPICS=null;const was=q.id;refreshReview();if(!_advanced&&rlist[ridx]?.id===was)go(1);window.scrollTo({top:0})}
function renderReview(){RUNDO.render();
  $('#reviewView').classList.toggle('grid',rfilter==='diagrams'||rfilter==='tags');
  $('#rout').previousElementSibling.textContent=rfilter==='diagrams'?'Diagrams to check':rfilter==='tags'?'Tags to settle':'Parsed question';
  if(rfilter==='diagrams'){renderDiag();return}
  if(rfilter==='tags'){renderTagd();return}
  const done=rlist.filter(q=>!isTodo(q,rfilter)).length;
  $('#prog').style.width=(rlist.length?100*done/rlist.length:0)+'%';
  $('#pos').textContent=rlist.length?`${ridx+1} / ${rlist.length}`+(rfilter==='recent'&&approvedAt(rlist[ridx])?' · approved '+new Date(approvedAt(rlist[ridx])).toLocaleString([], {day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):''):'0 / 0';
  if(!rlist.length&&RMODE==='paper'){   // owner 13 Nov: one paper at a time; an empty step says so and points to the next one
    // owner 18 Nov: "why does it say 1 on spot check but there's nothing there" -> the 1 is the approve-the-rest click; say so
    const w=paperWork(rdoc);
    $('#rout').innerHTML=`<div class="empty rv-pempty">${w.n&&!(rfilter==='decide'&&w.left.decide)?(rfilter==='sample'&&w.left.sample?`<b>Spot-check is done: one click left, approve the rest of the paper below.</b>`:`<b>Nothing left in “${esc(stepLabel(rfilter))}” for this paper.</b>`):''}
      ${rfilter==='sample'?w.ids.map(sampleBanner).join(''):''}${rfilter==='decide'?PCALL.html(w.ids):''}${paperNextHTML()}</div>`;
    $('#src').innerHTML='';$('#srcTitle').textContent='Source page';$('#reviewView').classList.add('grid');bindNext();typeset($('#rout'));return}   // no question: no empty source pane; a call's maths and \$ render (24 Nov)
  if(!rlist.length){
    const base=B.questions.filter(q=>!rdoc||docIds(rdoc).includes(q.doc));
    const next=FILTERS.filter(([k])=>k!==rfilter&&k!=='all').map(([k,l])=>[k,l,base.filter(q=>inFilter(q,k)&&isTodo(q,k)).length]).filter(x=>x[2]>0);
    const label=(FILTERS.find(f=>f[0]===rfilter)||[])[1]||'';
    $('#rout').innerHTML=`<div class="empty" style="text-align:left;display:flex;flex-direction:column;gap:12px">
      <div><b style="color:var(--ink);font-size:16px">${rstatus==='todo'?`Nothing left in “${esc((STEPS.find(x=>x[0]===rfilter)||[,label])[1])}”.`:'No questions match these filters.'}</b></div>${rfilter==='sample'?[...new Set(B.questions.filter(q=>q.tri?.tier==='sample'&&(!rdoc||String(q.doc)===rdoc)).map(q=>q.doc))].map(sampleBanner).join(''):''}${nextStepHTML()}
      <div>All ${B.questions.filter(q=>!q.dup_of).length} questions are still in the bank — open the <a href="#bank">Bank</a> to browse them by topic, or pick what to review next:</div>
      <div class="row">${next.map(([k,l,n])=>`<button class="act" data-gof="${k}">${esc(l)} · ${n}</button>`).join('')}<button class="act" data-gof="all" data-any="1">Every question (any status)</button></div></div>`;
    $('#src').innerHTML='';$('#srcTitle').textContent='Source page';
    bindNext();
    return}
  const q=rlist[ridx], d=B.docs[q.doc], r=reviews['q'+q.id];
  $('#srcTitle').textContent=`${docLabel(d)} · page ${q.pages.map(p=>+p.split('_').pop().split('.')[0]+1).join(', ')}`;
  $('#src').innerHTML=q.pages.map(p=>`<img data-page="${p}" alt="Source page">`).join('');
  const rel=q.related.map(x=>{const o=QG.byId.get(x.q);return o&&!(docLabel(B.docs[o.doc])===docLabel(B.docs[q.doc])&&String(o.number)===String(q.number))?`${docLabel(B.docs[o.doc])} Q${esc(o.nlabel||o.number)} (${Math.round(x.sim*100)}% similar)`:''}).filter(Boolean).join('; ');
  $('#rout').innerHTML=`${backBoxHTML(q,r)}${q.old?`<div class="oldsyl"><b>Old syllabus (2017 only):</b> ${tex(q.old)}</div>`:''}${q.std?`<div class="stdsyl"><b>Mathematics Standard, not ${esc(QG.courseData.short)}:</b> ${esc(q.std)}</div>`:''}
    <div class="row"><span class="badge ${d.parse_path==='scan'?'b-scan':'b-acc'}">${d.parse_path}</span>
      ${q.tri?'':`${q.queues.includes('review')?'<span class="badge b-bad">parse flagged</span>':''}`}
      ${r?.status==='approved'&&openFix(r)?`<span class="badge b-gen" title="The question and solution were approved; a diagram was redrawn after that and needs your OK">text approved · redrawn diagram needs your OK</span>`:r?.status?`<span class="badge ${r.status==='approved'?'b-ok':'b-bad'}">${r.status}</span>`:''}
      <span class="muted" style="font-size:13px">${esc(docLabel(d))} · Section ${esc(q.section||'–')}${q.marks!=null?' · '+q.marks+(q.marks===1?' mark':' marks'):''}</span></div>
    <h3 style="margin:0;font-size:20px">${qid(q)} <span class="muted" style="font-size:15px;font-weight:400">${esc(srcLine(q))}</span></h3>
    ${rfilter==='sample'?sampleBanner(q.doc):''}${rfilter==='decide'&&RMODE==='paper'?PCALL.html(docIds(q.doc)):''}${whyHTML(q)}
    ${q.decide?`<div class="callout"><b>Needs your decision:</b> ${tex(q.decide)}</div>`:''}${q.review_note&&!/^scan (path|transcription)[^|;]*$/i.test(q.review_note.trim())?`<details class="figdone" style="color:var(--muted)"><summary style="color:var(--warn)">Transcription notes</summary><div class="help">${noteTxt(q.review_note)}</div></details>`:''}${rel?`<div class="help">Also appears as: ${esc(rel)}</div>`:''}
    ${figCompareHTML(q)}
    <div class="section"><h4>Question as it will appear</h4>${qBody(q,'review')}</div>
    <div class="decision">${r?.status==='flagged'&&r?.fixed?.note?`<div class="callout"><div><b>Your original flag:</b> ${noteTxt(r.note||'(no note written)')}</div><div><b>What Claude changed:</b> ${noteTxt(fixTxt(r.fixed.note))}</div><div class="help">Compare with the page scan above, then approve or flag again.</div></div>`:r?.note?`<div class="help"><b>Your note:</b> ${noteTxt(r.note)}</div>`:''}
      <div class="row"><button class="act ok" id="approve"><kbd>A</kbd> Approve question + solution</button><span class="help">Approving also approves any model-written solution shown here that you haven't rejected.</span><button class="act warn" id="flag"><kbd>F</kbd> Flag</button>
      <button class="act ghost" id="ztog" aria-pressed="${needsZ(q)}" title="Use when the question refers to a z-score table that is not printed with it: exams with this question get the table on the last page">${needsZ(q)?'✓ ':''}Z-score table at the back</button>
      <span class="help">${db?'Decisions save for everyone with access.':'Saving is off in this view; decisions are not kept.'}</span></div>
      <div class="flagbox" id="qflag" hidden><label class="help" for="note">What's wrong? <kbd>Enter</kbd> sends the flag, <kbd>Esc</kbd> cancels.</label><input id="note" type="text" placeholder="e.g. Part (b) is missing the integral bounds" value="${esc(r?.status==='flagged'?r.note||'':'')}"></div></div>`;
  hydrate($('#rout'),q,'review'); hydrate($('#src'),q,'review'); typeset($('#rout'));
  $('#approve').onclick=()=>decide('approved'); $('#flag').onclick=openQFlag;
  $('#ztog').onclick=async()=>{await write(q,{zt:!needsZ(q)});renderReview()};
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
async function write(q,patch,whole){   // whole: patch is the entire record (Undo puts back the record as it was, 36_undo.js)
  // owner 23 Nov: "stale page approvals": the last line of defence for any approval that reaches here from an out-of-date page
  if(!whole&&FRESH.stale&&(patch.status==='approved'||['fig','sol'].some(f=>Object.values(patch[f]||{}).includes('approved')))){FRESH.block();return false}
  if(!whole)RUNDO.note('q',q.id,reviews['q'+q.id]);   // owner 24 Nov (one Recent decisions list): every decision can be undone exactly
  const key=RKEY.qdoc(q); const cur=reviews['q'+q.id]||{};   // owner 14 Nov (Fix 2): stored by key, shared by every copy
  const next={...(whole?{}:cur),...patch,question_id:q.id,by:me||null,at:new Date().toISOString()};if(q.key)next.key=q.key;
  RKEY.copies(q).forEach(i=>reviews['q'+i]=next); TOPICS=null; _clean=null;_esc={};_rk=null;
  if(!db){toast('Not saved: this view has no shared storage');return false}
  try{await db.doc('reviews/'+key).set(next);if(Date.now()>_holdToast)toast('Saved');return true}catch(e){toast(e?.code==='not_granted'||e?.code==='forbidden'?'You can view but not save decisions here':'Could not save. Try again in a moment.');return false}
}   // true once saved: a report's action (27_reports.js) is recorded only after its review write landed
// open one question in Review's "All questions" list (#review/list/all): the Bank card's and a report's "Open in Review" (owner 13 Nov)
function reviewOpen(id){rfilter='all';rstatus='any';rdoc='';$('#docF').value='';pendingOpen=id}
async function setFig(q,k,v){await write(q,{fig:{...(reviews['q'+q.id]?.fig||{}),[k]:v}});afterDecision(q)}
async function setFigReq(q,k,t){const r=reviews['q'+q.id]||{};await write(q,{fig:{...(r.fig||{}),[k]:'changes'},fig_notes:{...(r.fig_notes||{}),[k]:t}});afterDecision(q)}
async function figAll(q){if(await FRESH.block())return;const f={...(reviews['q'+q.id]?.fig||{})};qFigs(q).forEach(k=>f[k]='approved');await write(q,{fig:f});afterDecision(q)}
async function setSol(q,id,v){await write(q,{sol:{...(reviews['q'+q.id]?.sol||{}),[id]:v}});afterDecision(q)}
function afterDecision(q){ // stay on the item until everything in the current filter is decided, then move on
  if(rstatus==='todo'&&!isTodo(q,rfilter)&&['diagrams','generated'].includes(rfilter)){refreshReview();window.scrollTo({top:0})} else renderReview()}
async function setTag(t){const q=rlist[ridx],p=editing;editing=null;await write(q,tagEdit(q,[p],t));renderReview()}
function openQFlag(){const b=$('#qflag');if(!b)return;b.hidden=false;const n=$('#note');n.focus();n.select()}
// owner 23 Nov: "stale page approvals" (37_fresh.js): no approval from a page older than the live version
async function decide(status){const q=rlist[ridx];if(!q)return;if(status==='approved'&&await FRESH.block())return;const patch={status,note:$('#note')?.value.trim()||null};if(status==='flagged')patch.fixed=null;   // a re-flag drops the old fix: it waits for Claude again (owner 17 Nov)
 if(q.decide)patch.call_at=new Date().toISOString();
  if(status==='approved'){const sol={...(reviews['q'+q.id]?.sol||{})};let n=0;qGen(q).forEach(x=>{if(!sol[x.id]){sol[x.id]='approved';n++}});if(n)patch.sol=sol}
  write(q,patch);   // owner 12 Nov: "why doesn't approving auto next" -> don't wait for the save; move on at once
  const was=q.id; if(rstatus==='todo'&&!['diagrams','generated'].includes(rfilter)){refreshReview()} else renderReview();
  if(!_advanced&&rlist[ridx]?.id===was) go(1); window.scrollTo({top:0})}
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
$('#filters').addEventListener('click',e=>{const b=e.target.closest('.step');if(!b)return;goStep(b.dataset.f,'todo')});   // the paper's step track
// review 13 Nov: a finished paper can still be browsed question by question (the old Papers tab's "Review" link did this): All questions, this paper
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-browse]');if(b){$('#docF').value=b.dataset.browse}},true);
document.addEventListener('change',e=>{const m=e.target.closest&&e.target.closest('select[data-lists]');if(m&&m.value)location.hash='#review/list/'+m.value});   // "Other lists" (Inbox foot, list header)
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

