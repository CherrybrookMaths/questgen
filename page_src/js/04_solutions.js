/* ---------- solutions ---------- */
const solDec=(q,s)=>reviews['q'+q.id]?.sol?.[s.id]??(q.tri?.ok_sols?.includes(s.id)?'approved':undefined);   // cleared by the checks (triage.py) unless you decide otherwise
function solHTML(q,s,mode){
  const isMcq=q.type==='mcq', key=isMcq?(q.options.find(o=>o.is_correct)?.label||''):'';
  const m=s.meta||{}; const gen=s.source==='generated'; const dec=solDec(q,s);
  const badges=[gen?`<span class="badge b-gen">Model-generated${dec==='approved'?' · approved':''}</span>`:'<span class="badge b-acc">Marking guidelines</span>'];
  // owner 24 Nov (the "CONFIDENCE 0%" badge on a corrected, correct solution): a solution corrected to the checker's own answer says so;
  // the generation-time confidence described the old text (tools/stale_fixes.py confirm)
  if(gen&&m.checker_confirms) badges.push('<span class="badge b-ok">answer confirmed by the checker</span>');
  else if(gen&&m.confidence!=null) badges.push(`<span class="badge ${m.confidence<0.6?'b-bad':''}">confidence ${Math.round(m.confidence*100)}%</span>`);
  if(gen&&m.check) badges.push(`<span class="badge ${/fail|mismatch|disagree|wrong|error/i.test(m.check)?'b-bad':'b-ok'}">self-check ${esc(m.check==='passed'?'passed':m.check)}</span>`);
  if(m.reused_from){const o=QG.byId.get(m.reused_from);badges.push(`<span class="badge">copied from ${o?esc(docLabel(B.docs[o.doc]))+' Q'+esc(o.number):'duplicate'}</span>`)}
  if(mode==='review'&&gen&&dec==='rejected') badges.push('<span class="badge b-bad">rejected</span>');
  const crit=(s.criteria||[]).filter(c=>c[1]);
  const single=crit.length===1&&/^(provides )?(the )?correct answer\.?$|^\(?[A-D]\)?$/i.test(crit[0][1].trim());
  // owner 23 Nov (screenshot of the Difficulty checker): "D is missing in answer table": the answer shows wherever the solution is
  // open (the working names it anyway); the Bank card's Show answer still hides it on the question itself
  const ansCell=`<td class="m ans">${esc(key)}</td>`;
  const mcqRows=[[crit.reduce((t,c)=>t+(+c[0]||0),0)||q.marks||1,'']];   // owner: MCQ criterion is always just "Correct answer"
  const rub=isMcq?`<table class="rub"><thead><tr><th scope="col">Marks</th><th scope="col">Answer</th><th scope="col">Criterion</th></tr></thead><tbody>${mcqRows.map((c,i)=>`<tr><td class="m">${c[0]??'–'}</td>${i===0?ansCell:'<td class="m"></td>'}<td>${c[1]?tex(c[1]):'Correct answer'}</td></tr>`).join('')}</tbody></table>`
   :crit.length?`<table class="rub"><thead><tr><th scope="col">Marks</th><th scope="col">Criterion</th></tr></thead><tbody>${crit.map(c=>`<tr><td class="m">${c[0]??'–'}</td><td>${tex(c[1])}</td></tr>`).join('')}</tbody></table>`:'';
  const actions=mode==='review'&&gen?`<div class="row"><button class="act ok" data-sol="${s.id}" data-v="approved">Approve solution</button><button class="act warn" data-sol="${s.id}" data-v="rejected">Reject</button></div>`:'';
  return `<div class="sol ${s.source}"><div class="shd">${badges.join('')}</div>${(s.latex||'').trim()?`<div class="tx">${tex(s.latex)}</div>`:''}${rub}
    ${m.marker_note?`<div class="callout"><b>Marker's note:</b> ${tex(m.marker_note)}</div>`:''}
    ${m.concern?`<div class="callout"><b>Check this:</b> ${tex(m.concern)}</div>`:''}${m.corrected?(mode==='review'?`<div class="callout"><b>Corrected from source (check):</b> ${tex(m.corrected.replace(/^Corrected from source: /,''))}</div>`:`<div class="help">${tex(m.corrected)}</div>`):''}${mode==='review'&&m.rubric_note?`<div class="help">${esc(m.rubric_note)}</div>`:''}${mode==='review'&&m.source_flag?`<div class="callout"><b>Possible error in the source:</b> ${tex(m.source_flag)}</div>`:''}${actions}</div>`;
}
function solsFor(q,pid,mode){
  const all=q.solutions.filter(s=>(s.part_id??null)===pid);
  const vis=mode==='review'||mode==='tags'?all:all.filter(s=>s.source!=='generated'||solDec(q,s)==='approved');
  const hidden=all.length-vis.length;
  return {html:vis.map(s=>solHTML(q,s,mode)).join(''),hidden,count:vis.length};
}

