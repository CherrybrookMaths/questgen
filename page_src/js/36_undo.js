// owner 18 Nov: "for the undon button, can undo recently approed questions. Maybe a queue on the same page on the right side? or
//   anywhere convenient really". Review shows the last decisions made under your name beside the question (right-hand column; under it
//   on narrow screens), each with Undo. A decision made in this browser puts back the record exactly as it was before (kept here, and
//   in sessionStorage so a reload keeps it); an older approval is undone by clearing its "approved", which returns it to its queue,
//   and older diagram decisions by clearing them. Paper approvals (the spot-check's "approve the rest") are listed too. One page-wide
//   name (CODE_HEALTH rule 1).
// owner 24 Nov: "merge the recent descision and recently approved list as they are different": the diagram step's own "Recent
//   decisions" log (owner 12 Nov: "Keep a log on the side ... That can collapse as well") and this "Recently approved" column are one
//   list now: every recent decision (approved, flagged, diagram changes requested, kept original, undone), newest first, with its
//   QID, paper and question, time, what was decided and Undo. It still collapses (Hide / Show, remembered in this browser).
const RUNDO={N:20,prev:{},undone:[],
  load(){try{const s=JSON.parse(sessionStorage.getItem('rundo')||'{}');this.prev=s.prev||(s.undone?{}:s);this.undone=s.undone||[]}catch(e){this.prev={};this.undone=[]}},
  save(){try{sessionStorage.setItem('rundo',JSON.stringify({prev:this.prev,undone:this.undone.slice(0,this.N)}))}catch(e){}},
  // before a decision is written: remember what the record held (null = there was none). write() (08_review.js) calls it for
  // every question decision; approvePaper for paper approvals
  note(kind,id,cur){this.load();this.prev[kind+id]={was:cur?JSON.parse(JSON.stringify(cur)):null,t:Date.now()};this.save()},
  // what a question record decided, in words ('' = nothing to list: a tag or difficulty edit only)
  what(q,r){if(r.status==='approved')return {ok:1,t:'✓ approved'};if(r.status==='flagged')return {t:'⚑ flagged'+(r.note?': '+r.note:'')};
    const own=new Set([...chkFigs(q),...qFigs(q)]),ks=Object.keys(r.fig||{}).filter(k=>own.has(k));if(!ks.length)return null;
    const ch=ks.filter(k=>r.fig[k]==='changes'),kept=ks.filter(k=>r.fig[k]==='rejected'),of=n=>ks.length>1?`${n} of ${ks.length} diagrams: `:'';
    if(ch.length)return {t:'⚑ '+of(ch.length)+'changes requested'+(r.fig_notes?.[ch[0]]?': '+r.fig_notes[ch[0]]:'')};
    if(kept.length)return {t:'⚑ '+of(kept.length)+'original kept'};
    return {ok:1,t:'✓ diagram'+(ks.length>1?'s':'')+' approved'+(ks.length>1?` (${ks.length})`:'')}},
  items(){if(!B||!QG.detOK)return [];this.load();const out=[],mine=r=>r&&r.at&&(!me||r.by===me);
    B.questions.forEach(q=>{if(q.dup_of)return;const r=reviews['q'+q.id];if(!mine(r))return;const w=this.what(q,r);
      if(w)out.push({kind:'q',id:q.id,at:r.at,label:qid(q),sub:srcLine(q),...w})});
    const seen=new Set();Object.values(B.docs).forEach(d=>{const r=reviews['paper_'+d.id];if(!mine(r)||r.status!=='approved'||seen.has(r))return;seen.add(r);
      out.push({kind:'p',id:String(d.id),at:r.at,label:'Paper',sub:docLabel(d)+' (the rest of the paper)',ok:1,t:'✓ approved'})});
    this.undone.forEach(u=>out.push({...u,gone:1,t:'↶ undone'+(u.was?': '+u.was:'')}));
    return out.sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,this.N)},
  html(){const it=this.items();if(!it.length)return '';const open=load('dlog')!=='0';
    const when=t=>new Date(t).toLocaleString([], {day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
    return `<div class="rv-undohead"><h2>Recent decisions</h2><button type="button" class="act ghost" data-rundot aria-expanded="${open}">${open?'Hide':'Show'}</button></div>`+(open?`<p class="muted rv-undohelp">Decided by mistake? Undo puts it back in its list.</p><ul class="rv-undolist">${it.map(x=>
      `<li class="${x.gone?'gone':x.ok?'ok':'fl'}"><div>${x.kind==='q'?`<button type="button" class="lk" data-logq="${x.id}">${esc(x.label)}</button>`:`<b>${esc(x.label)}</b>`} <span class="muted">${esc(when(x.at))}</span></div><div class="muted rv-undosub">${esc(x.sub)}</div><div class="rv-undowhat">${noteTxt(x.t)}</div>${x.gone?'':`<button type="button" class="act ghost" data-rundo="${x.kind}:${x.id}">Undo</button>`}</li>`).join('')}</ul>`:'')},
  render(){let el=document.getElementById('rvUndo');const v=document.getElementById('reviewView');if(!v)return;
    if(!el){el=document.createElement('aside');el.id='rvUndo';el.className='pane rv-undo';el.setAttribute('aria-label','Recent decisions');v.appendChild(el);
      el.addEventListener('click',e=>{const b=e.target.closest('[data-rundo]');if(b){const [k,id]=b.dataset.rundo.split(':');this.undo(k,id);return}
        const q=e.target.closest('[data-logq]');if(q){rstatus='any';pendingOpen=+q.dataset.logq;refreshReview();return}
        if(e.target.closest('[data-rundot]')){save('dlog',load('dlog')==='0'?'1':'0');this.render()}})}
    const h=this.html();el.innerHTML=h;el.hidden=!h;v.classList.toggle('has-undo',!!h);if(h)typeset(el)},
  async undo(kind,id){this.load();const p=this.prev[kind+id],r=kind==='q'?reviews['q'+id]:reviews['paper_'+id];
    // the kept record only if nothing has been decided on this item since it was noted
    const exact=p&&r&&Math.abs(Date.parse(r.at)-p.t)<5000;   // r.at is the decision this note was made for, not a later one
    let label,was;
    if(kind==='q'){const q=QG.byId.get(+id);if(!q)return;was=this.what(q,r||{})?.t||'';
      // an older decision (nothing kept here): an approval or flag is cleared; diagram decisions are cleared (the old log's undo)
      let patch;if(!exact){if(r?.status)patch={status:null};else{const fig={...(r?.fig||{})};chkFigs(q).forEach(k=>delete fig[k]);patch={fig}}}
      const ok=exact?await write(q,p.was?{...p.was}:{},true):await write(q,patch);
      if(ok===false)return;label=qid(q);toast(`Undone: ${qid(q)} is back in its list`)}
    else{const key=RKEY.pdoc(id),next=exact?{...(p.was||{}),doc:+id}:{...(r||{}),status:null,doc:+id};next.by=me||null;next.at=new Date().toISOString();if(B.docs[id]?.key)next.key=B.docs[id].key;
      RKEY.docsOf(id).forEach(d=>reviews['paper_'+d]=next);TOPICS=null;was='✓ approved';
      if(!db){toast('Not saved: this view has no shared storage');return}
      try{await db.doc('reviews/'+key).set(next)}catch(e){toast('Could not save. Try again in a moment.');return}
      label='Paper';toast(`Undone: ${docLabel(B.docs[id])} is no longer approved`)}
    this.load();delete this.prev[kind+id];
    const q=kind==='q'?QG.byId.get(+id):null;
    this.undone.unshift({kind,id,at:new Date(Date.now()+1).toISOString(),label,sub:q?srcLine(q):docLabel(B.docs[id])+' (the rest of the paper)',was:was.replace(/^[✓⚑] /,'')});
    this.save();refreshReview()}};
