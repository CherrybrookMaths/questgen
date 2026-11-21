// owner 18 Nov: "for the undon button, can undo recently approed questions. Maybe a queue on the same page on the right side? or
//   anywhere convenient really". Review shows the last approvals made under your name beside the question (right-hand column; under it
//   on narrow screens), each with Undo. An approval made in this browser puts back the record exactly as it was before (kept here, and
//   in sessionStorage so a reload keeps it); an older one is undone by clearing its "approved", which returns it to its queue.
//   Paper approvals (the spot-check's "approve the rest") are listed too. One page-wide name (CODE_HEALTH rule 1).
const RUNDO={N:10,prev:{},
  load(){try{this.prev=JSON.parse(sessionStorage.getItem('rundo')||'{}')}catch(e){this.prev={}}},
  save(){try{sessionStorage.setItem('rundo',JSON.stringify(this.prev))}catch(e){}},
  // before an approval is written: remember what the record held (null = there was none)
  note(kind,id,cur){this.load();this.prev[kind+id]={was:cur?JSON.parse(JSON.stringify(cur)):null,t:Date.now()};this.save()},
  items(){if(!B||!QG.detOK)return [];const out=[],mine=r=>r&&r.status==='approved'&&r.at&&(!me||r.by===me);
    B.questions.forEach(q=>{if(q.dup_of)return;const r=reviews['q'+q.id];if(mine(r))out.push({kind:'q',id:q.id,at:r.at,label:qid(q),sub:srcLine(q)})});
    const seen=new Set();Object.values(B.docs).forEach(d=>{const r=reviews['paper_'+d.id];if(!mine(r)||seen.has(r))return;seen.add(r);
      out.push({kind:'p',id:String(d.id),at:r.at,label:'Paper',sub:docLabel(d)+' (the rest of the paper)'})});
    return out.sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,this.N)},
  html(){const it=this.items();if(!it.length)return '';
    const when=t=>new Date(t).toLocaleString([], {day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
    return `<h2>Recently approved</h2><p class="muted rv-undohelp">Approved by mistake? Undo puts it back in its list.</p><ul class="rv-undolist">${it.map(x=>
      `<li><div><b>${esc(x.label)}</b> <span class="muted">${esc(when(x.at))}</span></div><div class="muted rv-undosub">${esc(x.sub)}</div><button type="button" class="act ghost" data-rundo="${x.kind}:${x.id}">Undo</button></li>`).join('')}</ul>`},
  render(){let el=document.getElementById('rvUndo');const v=document.getElementById('reviewView');if(!v)return;
    if(!el){el=document.createElement('aside');el.id='rvUndo';el.className='pane rv-undo';el.setAttribute('aria-label','Recently approved');v.appendChild(el);
      el.addEventListener('click',e=>{const b=e.target.closest('[data-rundo]');if(b){const [k,id]=b.dataset.rundo.split(':');this.undo(k,id)}})}
    const h=this.html();el.innerHTML=h;el.hidden=!h;v.classList.toggle('has-undo',!!h)},
  async undo(kind,id){this.load();const p=this.prev[kind+id],r=kind==='q'?reviews['q'+id]:reviews['paper_'+id];
    // the kept record only if nothing has been decided on this item since it was noted
    const exact=p&&r&&Math.abs(Date.parse(r.at)-p.t)<5000;   // r.at is the approval this note was made for, not a later decision
    if(kind==='q'){const q=QG.byId.get(+id);if(!q)return;
      const ok=exact?await write(q,p.was?{...p.was}:{},true):await write(q,{status:null});
      if(ok===false)return;toast(`Undone: ${qid(q)} is back in its list`)}
    else{const key=RKEY.pdoc(id),next=exact?{...(p.was||{}),doc:+id}:{...(r||{}),status:null,doc:+id};next.by=me||null;next.at=new Date().toISOString();if(B.docs[id]?.key)next.key=B.docs[id].key;
      RKEY.docsOf(id).forEach(d=>reviews['paper_'+d]=next);TOPICS=null;
      if(!db){toast('Not saved: this view has no shared storage');return}
      try{await db.doc('reviews/'+key).set(next)}catch(e){toast('Could not save. Try again in a moment.');return}
      toast(`Undone: ${docLabel(B.docs[id])} is no longer approved`)}
    delete this.prev[kind+id];this.save();refreshReview()}};
