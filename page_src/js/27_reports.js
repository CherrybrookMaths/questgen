/* ===================== Question reports (owner 14 Nov, alpha) =====================
   owner 14 Nov: "since this is currently in alpha, it would be good to see each question's dot point somewhere in the exam
   paper page and an ability to report this question for wrong difficulty, wrong dot point and have it come up in a new
   review tab."
   - On the on-screen paper (exam and marking guide) each question's source line ends with an ⓘ (owner 14 Nov: "The dot point
     home looks stupid in a question" / "the i is fine") that opens its dot point(s), band, kind and Report. It carries
     .scr-only, so the download, PDF, Word and print leave it out (like the line and diagram controls).
   - Report opens a small form: Wrong difficulty (optional band 2-6), Wrong dot point (optional pick or free text), Other,
     and a note. One doc per report in the page database, collection `reports`:
     {question_id, part_id?, reason: difficulty|dot_point|other, suggested_band?, suggested_wm?, suggested_dot?, note, exam_id?, by, at, status:'open'}
     suggested_wm: 'UF' (fluency) | 'PR' (problem solving), owner 14 Nov: "Should let you pick UF and PS in the wrong diff".
   - A Reports tab (#reports) lists them with the question rendered; Resolve (optional reply) and Dismiss; a count badge
     on the tab shows open reports. (15 Nov: now the Reports step inside Review, #review/reports, with its count on the step.) */
/* owner 17 Nov: "So how do we actually change the reported questions?" then, on the proposal, "yes build it in the background. When a
   question is reported, it needs to be logged somewhere right? and disappear from the bank."
   - An open report has Open in Review, Apply suggestion (a wrong dot point with a suggested one: the same tag change as Review's
     picker), Send to Claude (the report becomes the question's flag: "Flags waiting for Claude"), Resolve and Dismiss.
   - A sent report (status 'sent') stays under Open as "Sent to Claude" until its question is approved again after it was sent; then
     it shows as Resolved, "Fixed and approved" (REP.st works this out; nothing is written).
   - While a report is open or sent, its question is out of the Bank and every exam picker (REP.hides via repHidden, 07_bank.js).
     Saved exams that hold it keep it with the "reported by a teacher" warning (qWatch); Review and Reports still show it.
   - Every action is logged on the report: action, done_by, done_at, and one entry per action in log [{action, by, at}]. */
const REP={list:[],sub:null,filter:(()=>{try{return localStorage.getItem('rep_filter')||'open'}catch(e){return 'open'}})(),dlg:null,res:null,pick:null,names:{},_lv:null,
  main(r){const q=xq(r.question_id);return q&&q.dup_of?xq(q.dup_of)||q:q},   // the copy the Bank and Review show
  st(r){const s=r.status||'open';if(s!=='sent')return s;const q=this.main(r);
    return q&&qState(q)==='approved'&&String(reviews['q'+q.id]?.at||'')>=String(r.sent_at||'')?'resolved':'sent'},
  // the live reports (open or sent), worked out once per task and again whenever the list changes
  live(){if(!this._lv||this._lv.src!==this.list){const L=this.list.filter(r=>['open','sent'].includes(this.st(r)));
      this._lv={src:this.list,L,ids:new Set(L.flatMap(r=>[r.question_id,this.main(r)?.id])),keys:new Set(L.map(r=>r.key).filter(Boolean))};setTimeout(()=>{this._lv=null},0)}
    return this._lv},
  hides(q){const v=this.live();return !!v.L.length&&(v.ids.has(q.id)||(q.dup_of!=null&&v.ids.has(q.dup_of))||(!!q.key&&v.keys.has(q.key)))}};
const REP_WHY={difficulty:'Wrong difficulty',dot_point:'Wrong dot point',other:'Other'};
const REP_WM={UF:'Fluency',PR:'Problem solving'};
function repSub(){if(REP.sub||!db)return !!REP.sub;
  try{REP.sub=db.collection('reports').onSnapshot(s=>{const d=s.docs||s;REP.list=(d||[]).map(x=>({id:x.id,...(typeof x.data==='function'?x.data():x.data)})).sort((a,b)=>String(b.at).localeCompare(String(a.at)));
    repBadge();repNames();if(view==='reports')renderReports();repMarkPaper();TOPICS=null;if(view==='bank'&&B)renderBank();   // owner 17 Nov: a reported question leaves the Bank at once
    try{const xp=$('#xPanel');if(xp&&!xp.hidden&&typeof xPanel==='function')xPanel();if(typeof exRefresh==='function')exRefresh()}catch(_){}   // owner 17 Nov: exam warnings and pickers follow new reports
  },()=>{})}catch(e){REP.sub=null}return !!REP.sub}
// db arrives asynchronously (claude.use('db')); subscribe as soon as it exists
(()=>{let n=0;const t=setInterval(()=>{if(repSub()||++n>240)clearInterval(t)},500)})();
const repOpen=()=>REP.list.filter(r=>(r.status||'open')==='open');
// owner 17 Nov: "that needs a way for it to be shown in the exam if it has been reported by teachers or put back in review by [the
// checker]": a question in an exam is marked when it has an open report or is flagged (incl. a diagram change request) since.
function qWatch(q){if(!q)return null;const back=typeof qState==='function'&&qState(q)==='flagged';
  const ids=new Set([q.id,q.dup_of].filter(Boolean)),n=REP.live().L.filter(r=>ids.has(r.question_id)||(q.key&&r.key===q.key)).length;
  if(!back&&!n)return null;return {back,n,text:[back?'sent back to review':'',n?(n===1?'reported by a teacher':`reported ${n} times`):''].filter(Boolean).join(' · ')}}
// owner 15 Nov: Reports is a step inside Review; its count is on the step (was the tab badge #repN)
// owner 13 Nov: the count is on the Inbox's Reports card and in the Review tab / Curate switch totals
function repBadge(){if(typeof renderSteps==='function')renderSteps()}
async function repNames(){const ids=[...new Set(REP.list.map(x=>x.by).filter(i=>i&&i!==me&&!(i in REP.names)))];if(!ids.length)return;
  try{const u=await window.claude?.use?.('user');if(!u?.profiles)return;const ps=await u.profiles(ids);ids.forEach(i=>REP.names[i]=ps?.[i]?.name||'');if(view==='reports')renderReports()}catch(e){}}
const repWho=id=>!id?'':id===me?'you':(REP.names[id]||'a colleague');

/* ---------- dot points of a question (main dot point of each leaf part, as the Bank files it) ---------- */
function repDots(q){const lv=qLeaves(q),multi=lv.length>1,seen=new Map();
  lv.forEach(p=>partMain(q,p).forEach(k=>{if(!k)return;   // owner 17 Nov: the dot points that count (QID 559 showed tagger A's, not Review's pick)
    if(!seen.has(k))seen.set(k,[]);if(p.label)seen.get(k).push(p.label)}));
  return [...seen.entries()].map(([k,labs])=>{const d=DM[k];const lab=multi&&labs.length&&labs.length<lv.length?labs.map(l=>'('+l+')').join('')+' ':'';
    const txt=k==='removed'?'Removed from the 2024 syllabus':k==='no_match'?'No 2024 dot point':d?(d.short||d.text||''):'';
    return {k,lab,txt,code:d?k:''}})}
const repDotsHTML=q=>{const ds=repDots(q);return ds.length?ds.map(d=>`<span class="exdot">${esc(d.lab)}${d.code?`<b>${esc(d.code)}</b> `:''}${esc(d.txt)}</span>`).join('<span class="exsep"> · </span>'):'<span class="exdot">No dot point yet</span>'};

/* ---------- on the paper: an ⓘ on the source line, screen only ----------
   owner 14 Nov: "The dot point home looks stupid in a question", then, of the proposed ⓘ: "Yeah that's fine, the i is fine".
   The grey dot-point line and the Report link left the question. The ⓘ at the end of the source line ("2025 Sydney Girls … ·
   QID 1084  ⓘ") opens a small card: the dot point(s) per part (code and short text), each part's band and Fluency / Problem
   solving, and Report, which opens the report form. Esc or a click outside closes it; focus goes back to the ⓘ. The button
   carries .scr-only, so the download, PDF and Word leave it out, as they left out the old line. */
const QI_ICON='<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.25"/><circle cx="8" cy="4.9" r=".95" fill="currentColor"/><path d="M8 7.1v4.4" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/></svg>';
const qiLabel=k=>`Dot points, band and Report${k?` · ${k} open report${k===1?'':'s'}`:''}`;
function qiButton(q,n){const k=repOpen().filter(r=>r.question_id===q.id).length;
  return `<button type="button" class="exinfo scr-only${k?' has':''}" data-qinfo="${q.id}" data-n="${esc(String(n??''))}" aria-haspopup="dialog" aria-expanded="false" aria-label="${qiLabel(k)}" title="${qiLabel(k)}">${QI_ICON}</button>`}
// each leaf part: its label (when there are several), main dot point(s), band and kind, as the Bank files and rates it
function qiParts(q){const e=typeof exEst==='function'?exEst(q):null,lv=qLeaves(q);
  return lv.map(p=>{const ep=e?.parts.find(x=>x.id===p.id),seen=new Set();
    const dots=partMain(q,p).filter(k=>k&&!seen.has(k)&&seen.add(k)).map(k=>{const d=DM[k];
      return {code:d?k:'',txt:k==='removed'?'Removed from the 2024 syllabus':k==='no_match'?'No 2024 dot point':d?(d.short||d.text||''):''}});
    const wm=ep?(ep.ps?'PR':'UF'):p.dif?.wm||null;
    return {lab:lv.length>1?((typeof exPath==='function'&&exPath(q,p))||(p.label?'('+p.label+')':'')):'',dots,b:ep?ep.b:(p.dif?.b??null),kind:wm?(wm==='PR'?'Problem solving':'Fluency'):''}})}
const qiDotHTML=d=>d.code||d.txt?`${d.code?`<b>${esc(d.code)}</b> `:''}${esc(d.txt)}`:'';
// the dot points as a list, for the card and the grading panel's question detail
const qiDotsList=(q,cls)=>{const ps=qiParts(q);if(!ps.some(p=>p.dots.length))return `<p class="${cls}-none">No dot point yet.</p>`;
  // owner 14 Nov ("the dot points in the grading panel"): parts filed under the same dot point(s) share one row, "(a)(b) Y12-285 …",
  // instead of repeating the same line under each part
  // (as the old line did: "(a)(c) Y11-040 … · (b) Y11-042 …")
  const rows=[];ps.forEach(p=>{const key=p.dots.map(qiDotHTML).join('|'),same=key&&rows.find(r=>r.key===key);if(same){same.lab=(same.lab||'')+(p.lab||'')}else rows.push({...p,key})});
  return `<ul class="${cls}">${rows.map(p=>`<li>${p.lab?`<span class="pp">${esc(p.lab)}</span>`:''}<span class="${cls}-d">${p.dots.map(qiDotHTML).join('<br>')||'<i>No dot point yet</i>'}</span></li>`).join('')}</ul>`};
let QI=null;
function qiOpen(btn){qiClose(false);const q=xq(+btn.dataset.qinfo);if(!q)return;const n=btn.dataset.n,ps=qiParts(q),k=repOpen().filter(r=>r.question_id===q.id).length,multi=ps.length>1;
  const el=document.createElement('div');el.id='qiPop';el.className='qipop';el.setAttribute('role','dialog');el.setAttribute('aria-label',`${n?'Question '+n+', ':''}${qid(q)}: dot points and band`);el.tabIndex=-1;
  el.innerHTML=`<div class="qihd">${n?`<b>Question ${esc(n)}</b> · `:''}${qid(q)}</div>
    <ul class="qiparts${multi?' multi':''}">${ps.map(p=>`<li>${multi?`<span class="qilab">${esc(p.lab||'–')}</span>`:''}<div class="qibody">${p.dots.length?p.dots.map(d=>`<div class="qidot">${qiDotHTML(d)}</div>`).join(''):'<div class="qidot qinone">No dot point yet</div>'}
      <div class="qimeta">${p.b!=null?`Band ${esc(String(p.b))}`:'Not rated yet'}${p.kind?` · ${p.kind}`:''}</div></div></li>`).join('')}</ul>
    <div class="qifoot"><span class="qirepn">${k?`${k} open report${k===1?'':'s'}`:''}</span><button type="button" class="act qirep" data-qirep="${q.id}" data-n="${esc(n||'')}">Report</button></div>`;
  document.body.appendChild(el);QI={btn,el};btn.setAttribute('aria-expanded','true');qiPlace();el.focus({preventScroll:true})}
function qiPlace(){if(!QI)return;const {btn,el}=QI;if(!document.contains(btn)){qiClose(false);return}
  const r=btn.getBoundingClientRect(),W=innerWidth,H=innerHeight,m=12,w=el.offsetWidth,h=el.offsetHeight;
  if(r.bottom<0||r.top>H){qiClose(false);return}
  let x=Math.min(W-m-w,Math.max(m,r.right-w)),y=r.bottom+6;if(y+h>H-m&&r.top-6-h>=m)y=r.top-6-h;y=Math.max(m,Math.min(y,H-m-h));
  el.style.left=Math.round(x)+'px';el.style.top=Math.round(y)+'px'}
function qiClose(refocus){if(!QI)return;const {btn,el}=QI;QI=null;el.remove();btn.setAttribute('aria-expanded','false');if(refocus&&document.contains(btn))btn.focus({preventScroll:true})}
addEventListener('scroll',e=>{if(QI&&!(e.target.closest&&e.target.closest('#qiPop')))qiPlace()},true);
addEventListener('resize',()=>qiClose(false));
// keyboard: Esc closes (window capture runs before the paper's own Esc, which would close the preview); Tab stays in the card
// (its one control is Report), Shift+Tab or Tab past it returns to the ⓘ and closes
addEventListener('keydown',e=>{if(!QI||REP.dlg)return;
  if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();qiClose(true);return}
  if(e.key==='Tab'&&QI.el.contains(document.activeElement)){const b=QI.el.querySelector('.qirep');if(document.activeElement!==b&&!e.shiftKey){e.preventDefault();b.focus()}else{e.preventDefault();qiClose(true)}}},true);
// a report sent while the paper is open marks its ⓘ in place (no re-layout)
function repMarkPaper(){$$('#xPages [data-qinfo]').forEach(b=>{const k=repOpen().filter(r=>r.question_id===+b.dataset.qinfo).length;b.classList.toggle('has',!!k);b.setAttribute('aria-label',qiLabel(k));b.title=qiLabel(k)})}

/* ---------- the report form ---------- */
function repDotOptions(sel){const by=new Map();DOTS.forEach(d=>{const g=`Year ${d.yl} · ${d.fa}`;if(!by.has(g))by.set(g,[]);by.get(g).push(d)});
  return `<option value="">Choose the right dot point (optional)</option>`+[...by.entries()].sort((a,b)=>b[0].localeCompare(a[0])).map(([g,ds])=>`<optgroup label="${esc(g)}">${ds.map(d=>`<option value="${esc(d.id)}"${d.id===sel?' selected':''}>${esc(d.id)} · ${esc(d.short||d.text)}</option>`).join('')}</optgroup>`).join('')}
function repForm(qidn,n){const q=xq(qidn);if(!q)return;const lv=qLeaves(q),e=typeof exEst==='function'?exEst(q):null;
  REP.dlg={q:q.id,n,reason:null,band:null,wm:null,part:'',prev:document.activeElement};
  let el=$('#repDlg');if(!el){el=document.createElement('div');el.id='repDlg';el.className='repscrim';document.body.appendChild(el)}
  el.innerHTML=`<div class="repdlg" role="dialog" aria-modal="true" aria-labelledby="repT">
    <div class="rephd"><div><div class="repeyebrow">Alpha · report a problem</div><h3 id="repT">${n?`Question ${esc(String(n))} · `:''}${qid(q)}</h3><div class="repsrc">${esc(srcLine(q))}</div></div><button type="button" class="repx" data-rclose aria-label="Close">×</button></div>
    <div class="repnow"><span>Filed under</span><div>${repDotsHTML(q)}</div>${e?`<span>Rated</span><div>Band ${e.d.toFixed(1)} · ${esc(e.kind)}</div>`:''}</div>
    ${lv.length>1?`<label class="repf"><span>Which part</span><select data-rpart><option value="">The whole question</option>${lv.map(p=>`<option value="${p.id}">(${esc(p.label||'?')})${p.dif?.b?` · band ${p.dif.b}`:''}</option>`).join('')}</select></label>`:''}
    <div class="repf"><span id="repWhyL">What is wrong</span><div class="repseg" role="radiogroup" aria-labelledby="repWhyL">
      <button type="button" role="radio" aria-checked="false" data-rr="dif">Wrong difficulty</button><button type="button" role="radio" aria-checked="false" data-rr="dot">Wrong dot point</button><button type="button" role="radio" aria-checked="false" data-rr="other">Other</button></div></div>
    <div class="repdif" data-rshow="dif" hidden>
      <div class="repf repf-band"><span id="repBL">Suggested band <i>optional</i></span><div class="repbands" role="radiogroup" aria-labelledby="repBL">${[2,3,4,5,6].map(b=>`<button type="button" role="radio" aria-checked="false" data-rb="${b}">${b}</button>`).join('')}</div></div>
      <div class="repf repf-wm"><span id="repWL">Kind <i>optional</i></span><div class="repseg repwm" role="radiogroup" aria-labelledby="repWL">${Object.entries(REP_WM).map(([k,l])=>`<button type="button" role="radio" aria-checked="false" data-rwm="${k}">${l}</button>`).join('')}</div></div></div>
    <div class="repf" data-rshow="dot" hidden><span>Right dot point <i>optional</i></span><select data-rdot>${repDotOptions('')}</select><input type="text" data-rdotx placeholder="or describe it" aria-label="Describe the right dot point"></div>
    <label class="repf"><span>Note <i data-rnoteopt>optional</i></span><textarea rows="3" placeholder="What should change, and why"></textarea></label>
    <div class="repmsg" data-rmsg hidden></div>
    <div class="repacts"><button type="button" class="act ghost" data-rclose>Cancel</button><button type="button" class="act ok" data-rsend>Send report</button></div></div>`;
  el.hidden=false;document.body.classList.add('rep-on');setTimeout(()=>el.querySelector('[data-rr]')?.focus(),30)}
function repClose(){const el=$('#repDlg');if(el){el.hidden=true;el.innerHTML=''}document.body.classList.remove('rep-on');const p=REP.dlg?.prev;REP.dlg=null;try{p?.focus()}catch(e){}}
// owner 14 Nov (Fix 2): "Ok we should run Fix 1 and 2": a report carries its question's key (tools/qkeys.py)
async function repSend(){const D=REP.dlg,el=$('#repDlg');if(!D)return;const msg=el.querySelector('[data-rmsg]'),say=t=>{msg.textContent=t;msg.hidden=false};
  if(!D.reason){say('Choose what is wrong.');return}
  const note=el.querySelector('textarea').value.trim(),dot=el.querySelector('[data-rdot]')?.value||'',dotx=el.querySelector('[data-rdotx]')?.value.trim()||'';
  if(D.reason==='other'&&!note){say('Add a note to say what is wrong.');return}
  if(!db){say('Reports are saved in the shared database. Open the page in claude.ai to send one.');return}
  const part=el.querySelector('[data-rpart]')?.value||'';
  const doc={question_id:D.q,key:xq(D.q)?.key||null,reason:D.reason==='dif'?'difficulty':D.reason==='dot'?'dot_point':'other',note,by:me||null,at:new Date().toISOString(),status:'open'};
  if(part)doc.part_id=+part||part;if(EX.id)doc.exam_id=EX.id;
  if(D.reason==='dif'&&D.band)doc.suggested_band=D.band;
  if(D.reason==='dif'&&D.wm)doc.suggested_wm=D.wm;   // owner 14 Nov: "Should let you pick UF and PS in the wrong diff"
  if(D.reason==='dot'&&(dot||dotx))doc.suggested_dot=dot||dotx;
  const id='r'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  const b=el.querySelector('[data-rsend]');b.disabled=true;b.textContent='Sending…';
  try{await db.doc('reports/'+id).set(doc);repClose();toast(isEditor()?'Report sent. It is listed in Review › Reports.':'Report sent. Thank you.')}
  catch(e){b.disabled=false;b.textContent='Send report';say('Could not send. Try again in a moment.')}}
// capture: a Report click must not also select the question on the paper
document.addEventListener('click',e=>{const t=e.target;
  // the ⓘ on the paper (owner 14 Nov): toggles its card; the click must not also select the question on the paper
  const qi=t.closest&&t.closest('#xPages [data-qinfo]');if(qi){e.preventDefault();e.stopImmediatePropagation();QI&&QI.btn===qi?qiClose(true):qiOpen(qi);return}
  const qr=t.closest&&t.closest('#qiPop [data-qirep]');if(qr){e.preventDefault();e.stopImmediatePropagation();const id=+qr.dataset.qirep,n=qr.dataset.n;qiClose(true);repForm(id,n);return}
  if(QI){if(t.closest&&t.closest('#qiPop')){e.stopImmediatePropagation();return}qiClose(false)}   // a click outside closes it
  if(!t.closest||!t.closest('#repDlg'))return;e.stopImmediatePropagation();
  if(t.id==='repDlg'||t.closest('[data-rclose]')){repClose();return}
  const rr=t.closest('[data-rr]');if(rr){const D=REP.dlg;D.reason=rr.dataset.rr;$$('#repDlg [data-rr]').forEach(x=>x.setAttribute('aria-checked',String(x===rr)));
    $$('#repDlg [data-rshow]').forEach(x=>x.hidden=x.dataset.rshow!==D.reason);const o=$('#repDlg [data-rnoteopt]');if(o)o.textContent=D.reason==='other'?'required':'optional';$('#repDlg [data-rmsg]').hidden=true;return}
  // owner 14 Nov: "Should let you pick UF and PS in the wrong diff": Fluency / Problem solving beside the band; optional, a
  // second press clears it (like the band)
  const rw=t.closest('[data-rwm]');if(rw){const D=REP.dlg,v=rw.dataset.rwm;D.wm=D.wm===v?null:v;$$('#repDlg [data-rwm]').forEach(x=>x.setAttribute('aria-checked',String(x.dataset.rwm===D.wm)));return}
  const rb=t.closest('[data-rb]');if(rb){const D=REP.dlg,v=+rb.dataset.rb;D.band=D.band===v?null:v;$$('#repDlg [data-rb]').forEach(x=>x.setAttribute('aria-checked',String(+x.dataset.rb===D.band)));return}
  if(t.closest('[data-rsend]')){repSend();return}},true);
// Esc closes the form only (window capture runs before the paper's own Esc handler, which would close the preview)
addEventListener('keydown',e=>{if(!REP.dlg)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();repClose();return}
  if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();repSend();return}
  if(e.key==='Tab'){const f=$$('#repDlg button:not([disabled]),#repDlg select,#repDlg textarea,#repDlg input:not([hidden])').filter(x=>x.offsetParent);if(!f.length)return;const i=f.indexOf(document.activeElement);
    if(e.shiftKey&&i<=0){e.preventDefault();f[f.length-1].focus()}else if(!e.shiftKey&&i===f.length-1){e.preventDefault();f[0].focus()}}
  e.stopImmediatePropagation()},true);

/* ---------- acting on a report (owner 17 Nov: "So how do we actually change the reported questions?") ---------- */
Object.assign(REP,{
  // the suggestion in words, for the flag Send to Claude writes
  sugg(r){if(r.reason==='difficulty'){const s=[r.suggested_band?'band '+r.suggested_band:'',REP_WM[r.suggested_wm]||''].filter(Boolean).join(' · ');return s?`Suggests ${s}.`:''}
    if(r.reason==='dot_point'&&r.suggested_dot){const d=DM[r.suggested_dot];return `Suggests ${d?r.suggested_dot+' '+(d.short||d.text):'“'+r.suggested_dot+'”'}.`}return ''},
  // the parts Apply suggestion changes: the reported part; else the only part, or the parts not yet under the suggested dot point
  // when they share one main dot point; else null (ambiguous: the row asks with a part picker)
  parts(r,q){if(r.part_id!=null){const p=q.parts.find(x=>String(x.id)===String(r.part_id));if(p)return [p.id]}
    const lv=qLeaves(q),sig=p=>partMain(q,p).slice().sort().join(',');if(lv.length<2)return lv.map(p=>p.id);
    const off=lv.filter(p=>sig(p)!==r.suggested_dot),pool=off.length?off:lv;return new Set(pool.map(sig)).size===1?pool.map(p=>p.id):null},
  // record an action on the report: its fields, what was done, who and when, and one entry in its log
  async set(r,act,patch){const {id,...rest}=r,at=new Date().toISOString(),by=me||null;
    try{await db.doc('reports/'+id).set({...rest,...patch,...(act==='reopened'?{}:{action:act,done_by:by,done_at:at}),log:[...(r.log||[]),{action:act,by,at}]});return true}
    catch(e){toast('Could not save. Try again in a moment.');return false}},
  // Apply suggestion: the same tag change as Review's picker (setTag, tag_edits), then the report is resolved
  async apply(r,ids){const q=this.main(r),d=DM[r.suggested_dot];if(!q||!d||!ids.length)return false;
    if(!await write(q,tagEdit(q,ids,{id:r.suggested_dot})))return false;
    const ok=await this.set(r,'applied',{status:'resolved',reply:`Applied: ${r.suggested_dot} ${d.short||d.text}`,applied:{dot:r.suggested_dot,parts:ids}});if(ok)toast('Applied: '+r.suggested_dot);return ok},
  // Send to Claude: the report becomes the question's flag (status flagged, no fix yet: "Flags waiting for Claude")
  async send(r){const q=this.main(r);if(!q)return false;const cur=reviews['q'+q.id]||{},p=r.part_id!=null?q.parts.find(x=>String(x.id)===String(r.part_id)):null;
    const flag=`Report (${REP_WHY[r.reason]||'Other'}${p?', part ('+(p.label||'?')+')':''}): ${r.note||'(no note)'}${(s=>s?' '+s:'')(this.sugg(r))}`;
    const note=cur.status==='flagged'&&!cur.fixed&&cur.note&&!cur.note.includes(flag)?cur.note+' | '+flag:flag;   // a flag already waiting keeps its words
    if(!await write(q,{status:'flagged',note,fixed:null}))return false;
    const ok=await this.set(r,'sent',{status:'sent',flag,sent_at:new Date().toISOString()});if(ok)toast('Sent to Claude: it waits in Review › Flags waiting for Claude');return ok}});

/* ---------- Reports tab ---------- */
const repWhen=t=>{const d=new Date(t);if(isNaN(d))return '';const m=(Date.now()-d)/6e4;
  return m<1?'just now':m<60?`${Math.round(m)} min ago`:m<1440?`${Math.round(m/60)} h ago`:d.toLocaleDateString('en-AU',{day:'numeric',month:'short'})};
function repWhat(r,q){const p=r.part_id!=null&&q?q.parts.find(x=>String(x.id)===String(r.part_id)):null;const bits=[];
  if(r.reason==='difficulty'){const e=q&&typeof exEst==='function'?exEst(q):null,now=p?.dif?.b??e?.d?.toFixed(1),wm=REP_WM[r.suggested_wm];
    const nowK=p?.dif?(p.dif.wm==='PR'?'Problem solving':'Fluency'):e?.kind;
    // owner 14 Nov: "Should let you pick UF and PS in the wrong diff": the suggested kind sits beside the suggested band
    if(r.suggested_band||wm)bits.push(`${r.suggested_band?`Band ${esc(String(now??'?'))}`:''}${wm?`${r.suggested_band?' · ':''}${esc(nowK||'?')}`:''} → suggests <b>${[r.suggested_band?'band '+esc(String(r.suggested_band)):'',wm?esc(wm):''].filter(Boolean).join(' · ')}</b>`);
    else bits.push('No band or kind suggested')}
  if(r.reason==='dot_point'){const d=DM[r.suggested_dot];bits.push(r.suggested_dot?`Suggests <b>${d?esc(r.suggested_dot)+'</b> '+esc(d.short||d.text):esc(r.suggested_dot)+'</b>'}`:'No dot point suggested')}
  return {part:p?`Part (${esc(p.label||'?')})`:'Whole question',bits}}
// the parts of a report row that change with what was done to it (REP methods: no new page-wide names, CODE_HEALTH rule 1)
Object.assign(REP,{
  by:(by,at)=>`${by?' by '+esc(repWho(by)):''}${at?' · '+esc(repWhen(at)):''}`,
// what happened to a handled report (owner 17 Nov: a sent report says where its question is: waiting for Claude or back for approval)
  doneHTML(r,s,m){if(s==='open')return '';
  if(s==='sent'){const where=m?(waitQ(m)?'waiting for Claude':backQ(m)?'fixed, back in Review for approval':''):'';
    return `<div class="rep-done">Sent to Claude${REP.by(r.done_by,r.done_at)}${where?' · '+where:''}${r.flag?`: <span>${esc(r.flag)}</span>`:''}</div>`}
  if(r.status==='sent')return `<div class="rep-done">Resolved: <span>Fixed and approved</span> (sent to Claude${REP.by(r.done_by,r.done_at)})</div>`;
  return `<div class="rep-done">${s==='resolved'?'Resolved':'Dismissed'}${REP.by(r.done_by,r.done_at)}${r.reply?`: <span>${esc(r.reply)}</span>`:''}</div>`},
// Apply suggestion when the parts are filed under different dot points: tick the parts that get the suggested one
  pickHTML:(r,m)=>`<div class="rep-pick" role="group" aria-label="Parts that get ${esc(r.suggested_dot)}"><span>The parts are filed under different dot points. Which get <b>${esc(r.suggested_dot)}</b>?</span>
  <div class="rep-pparts">${qLeaves(m).map(p=>`<label><input type="checkbox" data-rpp="${esc(String(p.id))}"> (${esc(p.label||'?')}) <small>${esc(partMain(m,p).map(k=>k==='removed'?'removed':k==='no_match'?'no dot point':k).join(', ')||'no dot point yet')}</small></label>`).join('')}</div>
  <div class="rep-acts"><button type="button" class="act ok" data-rpok>Apply to the ticked parts</button><button type="button" class="act ghost" data-rpx>Cancel</button></div></div>`,
  actsHTML(r,s,m){const ro=m?`<a class="act ghost" href="#review/list/all" data-ropen="${m.id}">Open in Review</a>`:'',
    rd=`<button type="button" class="act ok" data-rres>Resolve</button><button type="button" class="act ghost" data-rdis>Dismiss</button>`;
  if(s==='sent')return ro+rd;if(s!=='open')return `${ro}<button type="button" class="act ghost" data-rreopen>Reopen</button>`;
  if(REP.res===r.id)return `<input type="text" data-rreply placeholder="Reply (optional), e.g. moved to band 5" aria-label="Reply"><button type="button" class="act ok" data-rresok>Resolve</button><button type="button" class="act ghost" data-rresx>Cancel</button>`;
  const ap=m&&r.reason==='dot_point'&&DM[r.suggested_dot]?`<button type="button" class="act" data-rapply title="File the question under ${esc(r.suggested_dot)} and resolve the report">Apply suggestion</button>`:'';
  return `${ro}${ap}${m?`<button type="button" class="act" data-rclaude title="Flag the question for Claude to fix. It stays out of the bank until the fix is approved.">Send to Claude</button>`:''}${rd}`}});
function renderReports(){const box=$('#reportsBox');if(!box||!B)return;repSub();repBadge();
  if(!db){box.innerHTML=`<div class="rep-top"><div><div class="rep-eyebrow">Alpha</div><h2>Question reports</h2></div></div><div class="rep-empty">Reports live in the shared database. Open the page in claude.ai to see them.</div>`;return}
  // owner 17 Nov: a report sent to Claude stays under Open ("Sent to Claude") until its question is approved again
  const F=REP.filter,S=new Map(REP.list.map(r=>[r.id,REP.st(r)])),cnt={open:0,resolved:0,dismissed:0,all:REP.list.length};S.forEach(s=>{const k=s==='sent'?'open':s;cnt[k]=(cnt[k]||0)+1});
  const L=REP.list.filter(r=>{const s=S.get(r.id);return F==='all'||s===F||(F==='open'&&s==='sent')});
  box.innerHTML=`<div class="rep-top"><div><div class="rep-eyebrow">Alpha</div><h2>Question reports</h2><p class="rep-lead">Questions flagged from the exam paper for a wrong difficulty, a wrong dot point or something else. While a report is open its question is out of the bank. Apply the suggestion, send it to Claude to fix, resolve it once the bank is fixed, or dismiss it.</p></div>
      <div class="rep-seg" role="group" aria-label="Show">${[['open','Open'],['resolved','Resolved'],['dismissed','Dismissed'],['all','All']].map(([k,l])=>`<button type="button" data-rf="${k}" aria-pressed="${F===k}">${l}<span>${cnt[k]||0}</span></button>`).join('')}</div></div>
    ${L.length?`<ol class="rep-list">${L.map(r=>{const q=xq(r.question_id),m=REP.main(r),w=repWhat(r,q),s=S.get(r.id),live=s==='open'||s==='sent';
      return `<li class="rep-row" data-repid="${esc(r.id)}" data-st="${s}">
        <div class="rep-hd"><span class="rep-why rep-${esc(r.reason)}">${esc(REP_WHY[r.reason]||'Report')}</span><span class="rep-qid">${q?qid(q):'QID '+esc(String(r.question_id))}</span><span class="rep-part">${w.part}</span>${s==='sent'?'<span class="rep-sent">Sent to Claude</span>':''}
          <span class="rep-meta">${esc(repWhen(r.at))}${r.by?' · '+esc(repWho(r.by)):''}${r.exam_id?` · from ${esc((typeof XSAVED!=='undefined'&&XSAVED.find(x=>x.id===r.exam_id)?.sub)||'an exam')}`:''}</span></div>
        ${w.bits.length?`<div class="rep-what">${w.bits.join(' · ')}</div>`:''}
        ${r.note?`<blockquote class="rep-note">${esc(r.note)}</blockquote>`:''}
        ${REP.doneHTML(r,s,m)}
        ${q?`<details class="rep-qbox"${live?' open':''}><summary>${esc(srcLine(q))} · ${q.marks??'?'} mark${q.marks===1?'':'s'}</summary><div class="rep-dots">${repDotsHTML(q)}</div><div class="rep-home">Home topic: ${homeLabel(qHome(REP.main(r)||q))}</div><div class="rep-q" data-q="${q.id}">${qBody(q,'bank')}</div></details>`:'<div class="rep-gone">This question is no longer in the bank.</div>'}
        ${REP.pick===r.id&&m&&s==='open'?REP.pickHTML(r,m):`<div class="rep-acts">${REP.actsHTML(r,s,m)}</div>`}</li>`}).join('')}</ol>`
      :`<div class="rep-empty">${F==='open'?'No open reports. Use <b>Report</b> under a question on the exam paper to add one.':'Nothing here.'}</div>`}`;
  $$('.rep-q',box).forEach(el=>{const q=xq(+el.dataset.q);if(q){hydrate(el,q,'bank');TSIO.observe(el)}});
  $$('.rep-dots',box).forEach(el=>TSIO.observe(el));
  if(REP.res){const i=box.querySelector('[data-rreply]');if(i)i.focus()}}
document.addEventListener('click',e=>{const t=e.target;if(!t.closest||!t.closest('#reportsBox'))return;
  const f=t.closest('[data-rf]');if(f){REP.filter=f.dataset.rf;try{localStorage.setItem('rep_filter',REP.filter)}catch(_){}REP.res=REP.pick=null;renderReports();return}
  const row=t.closest('[data-repid]');if(!row)return;const r=REP.list.find(x=>x.id===row.dataset.repid);if(!r)return;
  const busy=p=>{$$('button',row).forEach(b=>b.disabled=true);p.then(ok=>{if(!ok)renderReports()})};   // one click per action; a failed save gives the buttons back
  const ro=t.closest('[data-ropen]');if(ro){reviewOpen(+ro.dataset.ropen);return}   // the link itself opens #review/list/all
  if(t.closest('[data-rapply]')){const ids=REP.parts(r,REP.main(r));if(ids)busy(REP.apply(r,ids));else{REP.pick=r.id;REP.res=null;renderReports()}return}
  if(t.closest('[data-rpok]')){const on=new Set($$('[data-rpp]',row).filter(c=>c.checked).map(c=>c.dataset.rpp)),ids=qLeaves(REP.main(r)).filter(p=>on.has(String(p.id))).map(p=>p.id);
    if(!ids.length){toast('Tick the parts that get the new dot point');return}REP.pick=null;busy(REP.apply(r,ids));return}
  if(t.closest('[data-rpx]')){REP.pick=null;renderReports();return}
  if(t.closest('[data-rclaude]')){busy(REP.send(r));return}
  if(t.closest('[data-rres]')){REP.res=r.id;REP.pick=null;renderReports();return}
  if(t.closest('[data-rresx]')){REP.res=null;renderReports();return}
  if(t.closest('[data-rresok]')){const v=row.querySelector('[data-rreply]')?.value.trim()||'';REP.res=null;REP.set(r,'resolved',{status:'resolved',reply:v});toast('Resolved');return}
  if(t.closest('[data-rdis]')){REP.set(r,'dismissed',{status:'dismissed'});toast('Dismissed');return}
  if(t.closest('[data-rreopen]')){REP.set(r,'reopened',{status:'open'});return}});
document.addEventListener('keydown',e=>{const i=e.target.closest?.('[data-rreply]');if(!i)return;if(e.key==='Enter'){e.preventDefault();i.closest('[data-repid]').querySelector('[data-rresok]')?.click()}else if(e.key==='Escape'){REP.res=null;renderReports()}});
if(typeof view!=='undefined'&&view==='reports'&&B)renderReports();
