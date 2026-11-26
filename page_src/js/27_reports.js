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
const REP={list:[],sub:null,filter:(load('rep_filter')||'open'),dlg:null,res:null,pick:null,names:{},_lv:null,
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
  try{REP.sub=db.collection('reports').onSnapshot(s=>{REP.list=QG.docs(s).sort((a,b)=>String(b.at).localeCompare(String(a.at)));
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

/* ---------- on the paper: Report beside the QID, screen only ----------
   owner 18 Nov: "I think the i on each question is useless. Remove it. just put the report button as a text which changes on hover
   next to the qid" (this replaces the 14 Nov ⓘ card). The source line ends "QID 1084  Report"; a click opens the report form
   directly. A question with open reports reads "Reported (n)". .scr-only keeps it out of the download, PDF and Word. The dot
   points, band and kind the card showed stay in the grading panel (qiDotsList). data-qinfo keeps its name (the question id). */
const qiLabel=k=>`Report a problem with this question${k?` · ${k} open report${k===1?'':'s'}`:''}`;
function qiButton(q,n){const k=repOpen().filter(r=>r.question_id===q.id).length;
  return `<button type="button" class="exrep scr-only${k?' has':''}" data-qinfo="${q.id}" data-n="${esc(String(n??''))}" aria-haspopup="dialog" aria-label="${qiLabel(k)}" title="${qiLabel(k)}">${k?`Reported (${k})`:'Report'}</button>`}
// each leaf part: its label (when there are several), main dot point(s), band and kind, as the Bank files and rates it
function qiParts(q){const e=typeof exEst==='function'?exEst(q):null,lv=qLeaves(q);
  return lv.map(p=>{const ep=e?.parts.find(x=>x.id===p.id),seen=new Set();
    const dots=partMain(q,p).filter(k=>k&&!seen.has(k)&&seen.add(k)).map(k=>{const d=DM[k];
      return {code:d?k:'',txt:k==='removed'?'Removed from the 2024 syllabus':k==='no_match'?'No 2024 dot point':d?(d.short||d.text||''):'',tx:d?.tex||''}});
    const wm=ep?(ep.ps?'PR':'UF'):p.dif?.wm||null;
    return {lab:lv.length>1?((typeof exPath==='function'&&exPath(q,p))||(p.label?'('+p.label+')':'')):'',dots,b:ep?ep.b:(p.dif?.b??null),kind:wm?(wm==='PR'?'Problem solving':'Fluency'):''}})}
// owner 19 Nov ("I'm still seeing incorrect in dot points"): the official wording with its maths (tex, typeset by MathJax) when the dot point
// has it; the short plain wording (Sₙ = n/2[...]) only otherwise
const qiDotHTML=d=>d.code||d.txt?`${d.code?`<b>${esc(d.code)}</b> `:''}${d.tx?tex(d.tx):esc(d.txt)}`:'';
// the dot points as a list, for the card and the grading panel's question detail
const qiDotsList=(q,cls)=>{const ps=qiParts(q);if(!ps.some(p=>p.dots.length))return `<p class="${cls}-none">No dot point yet.</p>`;
  // owner 14 Nov ("the dot points in the grading panel"): parts filed under the same dot point(s) share one row, "(a)(b) Y12-285 …",
  // instead of repeating the same line under each part
  // (as the old line did: "(a)(c) Y11-040 … · (b) Y11-042 …")
  const rows=[];ps.forEach(p=>{const key=p.dots.map(qiDotHTML).join('|'),same=key&&rows.find(r=>r.key===key);if(same){same.lab=(same.lab||'')+(p.lab||'')}else rows.push({...p,key})});
  return `<ul class="${cls}">${rows.map(p=>`<li>${p.lab?`<span class="pp">${esc(p.lab)}</span>`:''}<span class="${cls}-d">${p.dots.map(qiDotHTML).join('<br>')||'<i>No dot point yet</i>'}</span></li>`).join('')}</ul>`};
// a report sent while the paper is open marks its Report link in place (no re-layout)
function repMarkPaper(){$$('#xPages [data-qinfo]').forEach(b=>{const k=repOpen().filter(r=>r.question_id===+b.dataset.qinfo).length;b.classList.toggle('has',!!k);b.textContent=k?`Reported (${k})`:'Report';b.setAttribute('aria-label',qiLabel(k));b.title=qiLabel(k)})}

/* ---------- the report form ---------- */
function repDotOptions(sel){const by=new Map();DOTS.filter(d=>!d.virt).forEach(d=>{const g=`Year ${d.yl} · ${d.fa}`;if(!by.has(g))by.set(g,[]);by.get(g).push(d)});
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
  // owner 19 Nov: "should be able to report a question you see here / from the bank": Report on every question card (Bank, picker, chooser)
  const cr=t.closest&&t.closest('[data-crep]');if(cr){e.preventDefault();e.stopImmediatePropagation();repForm(+cr.dataset.crep,'');return}
  // Report beside the QID (owner 18 Nov): opens the report form; the click must not also select the question on the paper
  const qi=t.closest&&t.closest('#xPages [data-qinfo]');if(qi){e.preventDefault();e.stopImmediatePropagation();repForm(+qi.dataset.qinfo,qi.dataset.n);return}
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
  // Apply a difficulty report (owner 19 Nov: "yeah apply suggestion or tweak it yourself in the page. It shouldn't need to be sent to
  // claude every time"): each part's band and kind, prefilled with the suggestion, saved as difficulty/<part_id> (as a Difficulty check)
  difParts(r,q){const lv=qLeaves(q);if(r.part_id!=null){const p=lv.find(x=>String(x.id)===String(r.part_id));if(p)return [p]}return lv},
  difHTML(r,m){const ps=this.difParts(r,m),B5=[2,3,4,5,6];
    return `<div class="rep-pick rep-dif"><span>Set each part's band and kind. Saved at once for every exam; the report is resolved.</span>
    <table class="rep-dift"><tbody>${ps.map(p=>{const d=lvDif(p)||{},b=r.suggested_band||d.b||4,w=r.suggested_wm||d.wm||'UF';
      return `<tr data-rdp="${esc(String(p.id))}"><td>${p.label?'('+esc(p.label)+')':'Whole'} <small>${p.marks??''} mark${+p.marks===1?'':'s'} · now band ${d.b??'?'} ${d.wm==='PR'?'problem solving':'fluency'}</small></td>
        <td><select data-rdb aria-label="Band">${B5.map(x=>`<option${x===+b?' selected':''}>${x}</option>`).join('')}</select></td>
        <td><select data-rdw aria-label="Kind"><option value="UF"${w==='UF'?' selected':''}>Fluency</option><option value="PR"${w==='PR'?' selected':''}>Problem solving</option></select></td></tr>`}).join('')}</tbody></table>
    <div class="rep-acts"><button type="button" class="act ok" data-rdok>Apply and resolve</button><button type="button" class="act ghost" data-rpx>Cancel</button></div></div>`},
  async difApply(r,row){const q=this.main(r);if(!q||!db)return false;const at=new Date().toISOString(),out=[];
    const pick=$$('[data-rdp]',row).map(tr=>[tr.dataset.rdp,+tr.querySelector('[data-rdb]').value,tr.querySelector('[data-rdw]').value]);   // read before any await redraws the row
    for(const [pid,band,wm] of pick){const p=q.parts.find(x=>String(x.id)===pid);if(!p)continue;const o=p.dif||{};
      const v={band,wm,orig_band:o.b??null,orig_wm:o.wm??null,status:band===o.b&&wm===o.wm?'agreed':'changed',part_id:p.id,question_id:q.id,key:q.key||null,part:p.label||null,area:o.ar||null,anchor:!!o.a,from_report:r.id,by:me||null,at};
      try{await db.doc('difficulty/'+p.id).set(v);DIFD[p.id]=v}catch(e){toast('Could not save. Try again in a moment.');return false}
      out.push(`${p.label?'('+p.label+') ':''}band ${band} ${wm==='PR'?'problem solving':'fluency'}`)}
    _ee.clear();_qd.clear();
    const ok=await this.set(r,'applied',{status:'resolved',reply:'Applied: '+out.join(' · '),applied:{dif:out}});if(ok)toast('Applied: '+out.join(' · '));return ok},
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
  const ap=m&&r.reason==='difficulty'?`<button type="button" class="act" data-rdif title="Set the band and kind of the reported part (or each part), starting from the suggestion">Apply suggestion</button>`:m&&r.reason==='dot_point'&&DM[r.suggested_dot]?`<button type="button" class="act" data-rapply title="File the question under ${esc(r.suggested_dot)} and resolve the report">Apply suggestion</button>`:'';
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
        ${REP.pick===r.id&&m&&s==='open'?(r.reason==='difficulty'?REP.difHTML(r,m):REP.pickHTML(r,m)):`<div class="rep-acts">${REP.actsHTML(r,s,m)}</div>`}</li>`}).join('')}</ol>`
      :`<div class="rep-empty">${F==='open'?'No open reports. Use <b>Report</b> under a question on the exam paper to add one.':'Nothing here.'}</div>`}`;
  $$('.rep-q',box).forEach(el=>{const q=xq(+el.dataset.q);if(q){hydrate(el,q,'bank');TSIO.observe(el)}});
  $$('.rep-dots',box).forEach(el=>TSIO.observe(el));
  if(REP.res){const i=box.querySelector('[data-rreply]');if(i)i.focus()}}
document.addEventListener('click',e=>{const t=e.target;if(!t.closest||!t.closest('#reportsBox'))return;
  const f=t.closest('[data-rf]');if(f){REP.filter=f.dataset.rf;save('rep_filter',REP.filter);REP.res=REP.pick=null;renderReports();return}
  const row=t.closest('[data-repid]');if(!row)return;const r=REP.list.find(x=>x.id===row.dataset.repid);if(!r)return;
  const busy=p=>{$$('button',row).forEach(b=>b.disabled=true);p.then(ok=>{if(!ok)renderReports()})};   // one click per action; a failed save gives the buttons back
  const ro=t.closest('[data-ropen]');if(ro){reviewOpen(+ro.dataset.ropen);return}   // the link itself opens #review/list/all
  if(t.closest('[data-rapply]')){const ids=REP.parts(r,REP.main(r));if(ids)busy(REP.apply(r,ids));else{REP.pick=r.id;REP.res=null;renderReports()}return}
  if(t.closest('[data-rpok]')){const on=new Set($$('[data-rpp]',row).filter(c=>c.checked).map(c=>c.dataset.rpp)),ids=qLeaves(REP.main(r)).filter(p=>on.has(String(p.id))).map(p=>p.id);
    if(!ids.length){toast('Tick the parts that get the new dot point');return}REP.pick=null;busy(REP.apply(r,ids));return}
  if(t.closest('[data-rpx]')){REP.pick=null;renderReports();return}
  if(t.closest('[data-rdif]')){REP.pick=r.id;REP.res=null;renderReports();return}
  if(t.closest('[data-rdok]')){REP.pick=null;busy(REP.difApply(r,row));return}
  if(t.closest('[data-rclaude]')){busy(REP.send(r));return}
  if(t.closest('[data-rres]')){REP.res=r.id;REP.pick=null;renderReports();return}
  if(t.closest('[data-rresx]')){REP.res=null;renderReports();return}
  if(t.closest('[data-rresok]')){const v=row.querySelector('[data-rreply]')?.value.trim()||'';REP.res=null;REP.set(r,'resolved',{status:'resolved',reply:v});toast('Resolved');return}
  if(t.closest('[data-rdis]')){REP.set(r,'dismissed',{status:'dismissed'});toast('Dismissed');return}
  if(t.closest('[data-rreopen]')){REP.set(r,'reopened',{status:'open'});return}});
document.addEventListener('keydown',e=>{const i=e.target.closest?.('[data-rreply]');if(!i)return;if(e.key==='Enter'){e.preventDefault();i.closest('[data-repid]').querySelector('[data-rresok]')?.click()}else if(e.key==='Escape'){REP.res=null;renderReports()}});
if(typeof view!=='undefined'&&view==='reports'&&B)renderReports();
