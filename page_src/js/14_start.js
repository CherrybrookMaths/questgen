(async function start(){
  courseSwitch();
  route();
  // owner 15 Nov: "curate should be hidden to peope except editors." Curate shows only for the owner or an editor (user.isOwner() / canEdit());
  // no user capability, or no answer, counts as not an editor, so Curate stays hidden.
  {const c=window.claude;if(!c?.use)setEditor(false);else c.use('user').then(async u=>{let ed=false,own=false;if(u){try{own=ed=!!(await u.isOwner())}catch(e){}if(!ed){try{ed=!!(await u.canEdit())}catch(e){}}}setEditor(ed,own)}).catch(()=>setEditor(false))}
  try{
    // a load during a republish (or a network blip) can fail once: QG.get retries 3 times before giving up.
    // owner 14 Nov: "Ok we should run Fix 1 and 2" (Fix 1): the index and the dot points load first; question text comes per
    // topic when a view needs it (QG.need). data/assets.json (image addresses in the asset store) is optional: none = the
    // published image files, as before.
    const [b,d,a]=await Promise.all([QG.get(QG.courseData.bank),QG.get(QG.courseData.dots),
      fetch('data/assets.json?r='+Date.now()).then(r=>r.ok?r.json():null).catch(()=>null)]);
    QG.assets=(a&&a.assets)||{};QG.setBank(b);QG.dots=subLevels(d);d.forEach(x=>QG.dm[x.id]=x);QG.det();QG.prefetch();   // job 2 (owner 16 Nov: "Yeah build it"): the details start loading at once, after the index
  }catch(e){$('#list').innerHTML=QG.canGz()?'<div class="empty">The question bank did not load after 4 tries. <button class="act" onclick="location.reload()">Try again</button></div>':'<div class="empty">'+QG.OLD+'</div>';return}
  $('#countAll').textContent=` · ${B.questions.filter(q=>!q.dup_of).length} questions`;
  const docs=Object.values(B.docs).filter(x=>B.questions.some(q=>q.doc===x.id)).sort((a,b)=>a.label.localeCompare(b.label));
  $('#docF').insertAdjacentHTML('beforeend',docs.map(x=>`<option value="${x.id}">${esc(docLabel(x))}</option>`).join(''));
  sel=load('sel')||null; rfilter=load('rf2')||'decide'; if(!STEPS.some(x=>x[0]===rfilter)&&!FILTERS.some(x=>x[0]===rfilter)) rfilter='decide';
  route();
  const c=window.claude; if(!c?.use) return;
  try{
    const [dbns,user]=await Promise.all([c.use('db'),c.use('user')]);
    if(user){try{QG.me=await user.id()}catch(e){}}
    if(dbns){try{dbns.doc('progress/jobs').onSnapshot(d=>{const v=QG.val(d);JOBS=(v&&v.jobs)||[];renderJobs();if(view==='processes'&&QG.ready(view))renderProcesses()},()=>{})}catch(e){}}
    // owner 14 Nov: "need a pill for current jobs and queued jobs". The queue: {items:[{id,title,detail,status,order,asked}],updated}
    // job 6 (owner 16 Nov: "I need a place to see ... what's in that night's automated tasks"): progress/night, kept by the night
    // session (NIGHT.md): {steps:[{id,title,detail}], skipped:[{title,why}], last:{at,items:[{title,status,result}]}, updated}
    if(dbns){try{dbns.doc('progress/night').onSnapshot(d=>{const v=QG.val(d);QG.night=v||null;if(view==='processes'&&QG.ready(view))renderProcesses()},()=>{})}catch(e){}}
    if(dbns){try{dbns.doc('progress/queue').onSnapshot(d=>{const v=QG.val(d);QUEUE=v&&Array.isArray(v.items)?v:null;renderJobs();if(view==='processes'&&QG.ready(view))renderProcesses()},()=>{})}catch(e){}}
    if(dbns){try{QG.db=dbns;dbns.doc('progress/import').onSnapshot(d=>{const v=QG.val(d);if(v){PROG=v;if(view==='processes'&&QG.ready(view))renderImport()}},()=>{})}catch(e){}}
    if(dbns){QG.db=dbns; QG.db.collection('reviews').onSnapshot(snap=>{const docs=snap.docs||snap;const nx={};(docs||[]).forEach(s=>{const v=typeof s.data==='function'?s.data():s.data;const id=s.id||(v&&('q'+v.question_id));if(v&&id)nx[id]=v});QG.reviews=RKEY.index(nx);TOPICS=null;_clean=null;_esc={};_rk=null;
      updateCounts(); if(!QG.ready(view))return; if(view==='review') refreshReview(); else if(view==='papers') renderPapers(); else if(view==='inbox') renderInbox(); else if(view==='bank') renderBank(); else if(view==='reports'&&typeof renderReports==='function') renderReports(); else if(view==='exams'&&typeof exRefresh==='function') exRefresh(); else if(view==='processes'){renderImport();let pq=null;try{pq=PQ}catch(e){}if(pq){pq.redraw();pq.run.draw()}}},()=>{})}   // Import history counts approved questions too (bankStats); owner 14 Nov: the lanes' cleared / waiting squares and the queue's waiting count follow Review live (PQ is read guarded: an early snapshot can arrive before 32_papers_q.js has run)
  }catch(e){}
})();
