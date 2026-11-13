/* ---------- tags ---------- */
function effTags(q,p){
  const ed=reviews['q'+q.id]?.tag_edits?.[p.id];
  if(ed) return ed.cov==='removed'||ed.cov==='no_match'?[{cov:ed.cov,primary:1}]:[{id:ed.id,primary:1,cov:DM[ed.id]?.yl===12?'examinable':'moved_to_year_11',conf:1,edited:1}];
  return p.t24||[];
}
function chipHTML(t,p){
  const c17=p.c17?.code; const c17t=c17?`${esc(c17)} ${esc(B.codes17[c17]||'')}`:'';
  if(t.cov==='removed'||t.cov==='no_match'){
    const lab=t.cov==='removed'?'Removed from 2024 syllabus':'No 2024 match';
    return `<span class="chipw"><button class="chip ${t.cov}" aria-expanded="false">${lab}</button><span class="pop" role="tooltip"><span class="t">${t.cov==='removed'?'This content was in the 2017 syllabus but is not in the 2024 syllabus.':'No 2024 dot point fits this part.'}</span>${c17?`<span class="o">2017: ${c17t}</span>`:''}</span></span>`;
  }
  const d=DM[t.id]||{}; const sub=d.short||d.sub||d.fa||t.id;
  return `<span class="chipw"><button class="chip ${d.yl===11?'y11':''} ${t.primary?'':'sec'}" aria-expanded="false"><span class="y">${esc(t.id)}</span>${esc(sub)}</button>
    <span class="pop" role="tooltip"><span class="k">${esc(t.id)} · Year ${d.yl} · ${esc(d.fa)}${d.sub?' › '+esc(d.sub):''}</span><span class="t">${tex(d.tex||d.text)}</span>
    ${t.primary?'':'<span class="k">Secondary tag</span>'}${t.conf!=null&&t.conf<0.6?`<span class="k">Tagger confidence ${t.conf}</span>`:''}${t.edited?'<span class="k">Changed in review</span>':''}
    ${c17?`<span class="o">2017 code: ${c17t}</span>`:''}${p.skills?.length?`<span class="o">Needs: ${p.skills.map(esc).join(', ')}</span>`:''}${p.can_use?.length?`<span class="o">Can use: ${p.can_use.map(esc).join(', ')}</span>`:''}</span></span>`;
}
function tagsHTML(q,p){return `<div class="tags">${effTags(q,p).map(t=>chipHTML(t,p)).join('')}</div>`}
document.addEventListener('click',e=>{
  const ch=e.target.closest('.chip'); $$('.chipw.open').forEach(w=>{if(!ch||w!==ch.parentElement){w.classList.remove('open');w.firstElementChild.setAttribute('aria-expanded','false')}});
  if(ch){const w=ch.parentElement;const o=!w.classList.contains('open');w.classList.toggle('open',o);ch.setAttribute('aria-expanded',String(o))}
});

