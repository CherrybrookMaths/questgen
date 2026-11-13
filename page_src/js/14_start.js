(async function start(){
  route();
  // owner 15 Nov: "curate should be hidden to peope except editors." Curate shows only for the owner or an editor (user.isOwner() / canEdit());
  // no user capability, or no answer, counts as not an editor, so Curate stays hidden.
  {const c=window.claude;if(!c?.use)setEditor(false);else c.use('user').then(async u=>{let ed=false;if(u){try{ed=!!(await u.isOwner())}catch(e){}if(!ed){try{ed=!!(await u.canEdit())}catch(e){}}}setEditor(ed)}).catch(()=>setEditor(false))}
  try{
    // a load during a republish (or a network blip) can fail once: retry 3 times before giving up
    const get=async(u)=>{let err;for(let i=0;i<4;i++){try{const r=await fetch(u+(u.includes('?')?'&':'?')+'r='+i+'_'+Date.now());if(!r.ok)throw new Error(r.status);return await r.json()}catch(e){err=e;await new Promise(z=>setTimeout(z,800*(i+1)))}}throw err};
    const [b,d]=await Promise.all([get('data/bank.json'),get('data/dotpoints.json')]);
    B=b;DOTS=d;DOTS.forEach(x=>DM[x.id]=x);
  }catch(e){$('#list').innerHTML='<div class="empty">The question bank did not load after 4 tries. <button class="act" onclick="location.reload()">Try again</button></div>';return}
  $('#countAll').textContent=` · ${B.questions.filter(q=>!q.dup_of).length} questions`;
  const docs=Object.values(B.docs).filter(x=>B.questions.some(q=>q.doc===x.id)).sort((a,b)=>a.label.localeCompare(b.label));
  $('#docF').insertAdjacentHTML('beforeend',docs.map(x=>`<option value="${x.id}">${esc(docLabel(x))}</option>`).join(''));
  sel=load('sel')||null; rfilter=load('rf2')||'decide'; if(!STEPS.some(x=>x[0]===rfilter)&&!FILTERS.some(x=>x[0]===rfilter)) rfilter='decide';
  route();
  const c=window.claude; if(!c?.use) return;
  try{
    const [dbns,user]=await Promise.all([c.use('db'),c.use('user')]);
    if(user){try{me=await user.id()}catch(e){}}
    if(dbns){try{dbns.doc('progress/jobs').onSnapshot(d=>{const v=d&&(typeof d.data==='function'?d.data():d.data);JOBS=(v&&v.jobs)||[];renderJobs();if(view==='processes')renderProcesses()},()=>{})}catch(e){}}
    // owner 14 Nov: "need a pill for current jobs and queued jobs". The queue: {items:[{id,title,detail,status,order,asked}],updated}
    if(dbns){try{dbns.doc('progress/queue').onSnapshot(d=>{const v=d&&(typeof d.data==='function'?d.data():d.data);QUEUE=v&&Array.isArray(v.items)?v:null;renderJobs();if(view==='processes')renderProcesses()},()=>{})}catch(e){}}
    if(dbns){try{db=dbns;dbns.doc('progress/import').onSnapshot(d=>{const v=d&&(typeof d.data==='function'?d.data():d.data);if(v){PROG=v;if(view==='processes')renderImport()}},()=>{})}catch(e){}}
    if(dbns){db=dbns; db.collection('reviews').onSnapshot(snap=>{const docs=snap.docs||snap;const nx={};(docs||[]).forEach(s=>{const v=typeof s.data==='function'?s.data():s.data;const id=s.id||(v&&('q'+v.question_id));if(v&&id)nx[id]=v});reviews=nx;TOPICS=null;_clean=null;
      $('#todoN').textContent=todoCount()||''; if(view==='review') refreshReview(); else if(view==='papers') renderPapers(); else if(view==='bank') renderBank(); else if(view==='exams'&&typeof exRefresh==='function') exRefresh()},()=>{})}
  }catch(e){}
})();
