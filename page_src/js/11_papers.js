/* ---------- papers: every exam ingested, with question counts ----------
   owner 13 Nov: "Merge into Review". This is Review's papers section (#review/papers; #papers lands here). Each row also has the
   paper's review track (5 dots: done / where it is / still to do) and "N left · at <step>"; a row opens that paper's flow. */
const TYPE_LABEL={hsc:'HSC',trial:'Trial',internal_exam:'School task',internal_other:'School task'};
function renderPapers(){
  // one row per paper: the same paper filed as two PDFs is merged (its duplicate questions are hidden in the Bank)
  const groups=new Map(); let rows; const W=allWork();
  Object.values(B.docs).forEach(d=>{if(!B.questions.some(q=>q.doc===d.id))return;const k=docLabel(d);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(d)});
  rows=[...groups.values()].map(ds=>{const ids=ds.map(d=>d.id);const qs=B.questions.filter(q=>ids.includes(q.doc));
    const uq=qs.filter(q=>!q.dup_of);
    const marks=uq.reduce((n,q)=>n+(+q.marks||0),0), mcq=uq.filter(q=>q.type==='mcq').length;
    const done=uq.filter(q=>qState(q)==='approved').length;
    const main=ds.slice().sort((a,b)=>uq.filter(q=>q.doc===b.id).length-uq.filter(q=>q.doc===a.id).length)[0];
    return {d:main,ds,qs,uq,marks,mcq,done,w:W.get(mainDoc(main.id))||paperWork(main.id),year:+(String(main.label).match(/\d{4}/)||[0])[0]}})
    .sort((a,b)=>b.year-a.year||docLabel(a.d).localeCompare(docLabel(b.d)));
  // owner 12 Nov: filtering on the papers page
  const PF=PFILT; const school=r=>docLabel(r.d).replace(/^\d{4}\s+/,'').replace(/\s+(AT\d|HSC)$/,'');
  const task=r=>(docLabel(r.d).match(/\b(AT\d|HSC)\b/)||[,''])[1];
  const prog=r=>r.done===0?'none':r.done>=r.uq.length?'done':'some';
  const progOK=r=>!PF.prog||(PF.prog==='todo'?r.w.n>0:prog(r)===PF.prog);
  const allRows=rows;
  rows=rows.filter(r=>(!PF.q||docLabel(r.d).toLowerCase().includes(PF.q.toLowerCase()))&&(!PF.year||String(r.year)===PF.year)&&(!PF.task||task(r)===PF.task)&&(!PF.src||(r.d.parse_path==='scan'?'scan':'digital')===PF.src)&&progOK(r));
  const key={left:r=>r.w.n,paper:r=>docLabel(r.d),q:r=>r.uq.length,marks:r=>r.marks,done:r=>r.done/Math.max(1,r.uq.length),year:r=>r.year};
  if(PF.sort&&key[PF.sort]){const f=key[PF.sort],dir=PF.dir==='asc'?1:-1;rows.sort((a,b)=>{const x=f(a),y=f(b);return (typeof x==='string'?x.localeCompare(y):x-y)*dir})}
  const years=[...new Set(allRows.map(r=>r.year))].sort((a,b)=>b-a), tasks=[...new Set(allRows.map(task))].filter(Boolean).sort();
  const th=(k,l,num)=>`<th class="sortable${num?' num':''}" data-sort="${k}" aria-sort="${PF.sort===k?(PF.dir==='asc'?'ascending':'descending'):'none'}">${l}${PF.sort===k?`<span class="ar">${PF.dir==='asc'?'▲':'▼'}</span>`:''}</th>`;
  const T=k=>rows.reduce((n,r)=>n+r[k],0);
  const tot={q:rows.reduce((n,r)=>n+r.qs.length,0),u:rows.reduce((n,r)=>n+r.uq.length,0)};
  if(!$('#pfil')) $('#papersList').innerHTML=`<h2>Papers</h2><p class="sub" id="psub"></p><p class="sub">Open a paper to walk its review top to bottom: your calls, flagged, topics, diagrams, spot-check.</p>
  <div class="pfil" id="pfil"><input id="pfQ" type="search" placeholder="Search papers, e.g. Baulkham, NESA, 2025" aria-label="Search papers">
  <select id="pfYear" aria-label="Year"></select><select id="pfTask" aria-label="Task"></select>
  <select id="pfSrc" aria-label="Source"><option value="">Digital and scans</option><option value="digital">Digital only</option><option value="scan">Scans only</option></select>
  <select id="pfProg" aria-label="Review progress"><option value="">Any progress</option><option value="todo">Review work left</option><option value="none">Not started</option><option value="some">In progress</option><option value="done">Fully approved</option></select>
  <button class="act ghost clr" id="pfClr" type="button">Clear</button></div><div id="ptable"></div>`;
  const yS=$('#pfYear'),tS=$('#pfTask');
  yS.innerHTML='<option value="">All years</option>'+years.map(y=>`<option${String(y)===PF.year?' selected':''}>${y}</option>`).join('');
  tS.innerHTML='<option value="">All tasks</option>'+tasks.map(t=>`<option${t===PF.task?' selected':''}>${t}</option>`).join('');
  if(document.activeElement!==$('#pfQ'))$('#pfQ').value=PF.q;$('#pfSrc').value=PF.src;$('#pfProg').value=PF.prog;
  $('#psub').textContent=`${rows.length} of ${allRows.length} papers${allRows.some(r=>r.ds.length>1)?` (${allRows.reduce((n,r)=>n+r.ds.length,0)} PDFs)`:''} · ${tot.u} questions shown`;
  $('#ptable').innerHTML=`<div class="pwrap"><table class="pp"><thead><tr>${th('paper','Paper')}${th('left','Review')}${th('q','Questions',1)}${th('marks','Marks',1)}${th('done','Approved',1)}<th class="num">MCQ</th><th class="num">Short answer</th><th>Type</th><th>Source</th><th></th></tr></thead><tbody>
  ${rows.map(r=>`<tr data-flow="${r.w.doc}"><td class="pname"><a class="plink" href="#review/paper/${r.w.doc}">${esc(docLabel(r.d))}</a>${r.ds.length>1?`<div class="muted">Filed as ${r.ds.length} PDFs; the ${r.qs.length-r.uq.length} repeated questions are counted once</div>`:''}</td>
    <td class="ptrack">${miniTrack(r.w)} <span class="ipl">${workLine(r.w)}</span></td>
    <td class="num">${r.uq.length}</td><td class="num">${r.marks}</td><td class="num">${r.done}<span class="muted"> / ${r.uq.length}</span><span class="pbar" aria-hidden="true"><i style="width:${Math.round(100*r.done/Math.max(1,r.uq.length))}%"></i></span></td>
    <td class="num">${r.mcq}</td><td class="num">${r.uq.length-r.mcq}</td>
    <td>${esc(TYPE_LABEL[r.d.task_type]||r.d.task_type||'')}</td><td>${r.d.parse_path==='scan'?'Scan':'Digital'}</td>
    <td><a class="act ghost" href="#review/paper/${r.w.doc}" style="font-size:13px">${r.w.n?'Review':'Open'}</a></td></tr>`).join('')}
  </tbody><tfoot><tr><td>Total</td><td>${rows.filter(r=>r.w.n).length} with work left</td><td class="num">${tot.u}</td><td class="num">${T('marks')}</td><td class="num">${T('done')}<span class="muted"> / ${tot.u}</span></td><td class="num">${T('mcq')}</td><td class="num">${tot.u-T('mcq')}</td><td></td><td></td><td></td></tr></tfoot></table></div>`;
  $$('#ptable tr[data-flow]').forEach(tr=>tr.onclick=e=>{if(!e.target.closest('a,button'))location.hash='#review/paper/'+tr.dataset.flow});   // the whole row opens the paper
  const upd=(k,v)=>{PFILT[k]=v;save('pfilt',JSON.stringify(PFILT));renderPapers()};
  $('#pfQ').oninput=e=>upd('q',e.target.value);$('#pfYear').onchange=e=>upd('year',e.target.value);$('#pfTask').onchange=e=>upd('task',e.target.value);
  $('#pfSrc').onchange=e=>upd('src',e.target.value);$('#pfProg').onchange=e=>upd('prog',e.target.value);
  $('#pfClr').onclick=()=>{PFILT={q:'',year:'',task:'',src:'',prog:'',sort:'',dir:''};save('pfilt',JSON.stringify(PFILT));renderPapers()};
  $$('#ptable th[data-sort]').forEach(h=>h.onclick=()=>{const k=h.dataset.sort;if(PFILT.sort===k)PFILT.dir=PFILT.dir==='asc'?'desc':'asc';else{PFILT.sort=k;PFILT.dir=k==='paper'?'asc':'desc'}save('pfilt',JSON.stringify(PFILT));renderPapers()});
}
let PFILT=(()=>{try{return Object.assign({q:'',year:'',task:'',src:'',prog:'',sort:'',dir:''},JSON.parse(load('pfilt')||'{}'))}catch(e){return {q:'',year:'',task:'',src:'',prog:'',sort:'',dir:''}}})();
