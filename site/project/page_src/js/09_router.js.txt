/* ---------- routing ---------- */
let view='bank';
function todoCount(){return STEPS.reduce((n,[k])=>n+B.questions.filter(q=>inFilter(q,k)&&isTodo(q,k)).length,0)}
function route(){
  // owner 14 Nov: "Can make that page processes". The Import tab is now Processes (#processes); old #import links still land there.
  if(location.hash==='#import'){try{history.replaceState(null,'','#processes')}catch(e){location.replace('#processes');return}}
  view=location.hash==='#review'?'review':location.hash==='#papers'?'papers':location.hash==='#processes'?'processes':location.hash==='#guide'?'guide':location.hash==='#levels'?'levels':location.hash==='#reports'?'reports':location.hash==='#exams'?'exams':'bank';
  $('#vGuide').setAttribute('aria-current',view==='guide'?'page':'false');$('#guideView').hidden=view!=='guide';
  $('#vLevels').setAttribute('aria-current',view==='levels'?'page':'false');$('#levelsView').hidden=view!=='levels';
  $('#vReports').setAttribute('aria-current',view==='reports'?'page':'false');$('#reportsView').hidden=view!=='reports';
  $('#vExams').setAttribute('aria-current',view==='exams'?'page':'false');$('#examsView').hidden=view!=='exams';
  $('#vProcesses').setAttribute('aria-current',view==='processes'?'page':'false');$('#processesView').hidden=view!=='processes';
  $('#vBank').setAttribute('aria-current',view==='bank'?'page':'false');$('#vReview').setAttribute('aria-current',view==='review'?'page':'false');$('#vPapers').setAttribute('aria-current',view==='papers'?'page':'false');$('#papersView').hidden=view!=='papers';
  $('#bankView').hidden=view!=='bank'; $('#reviewView').hidden=view!=='review'; $('#rbar').hidden=view!=='review'; $('#progbar').hidden=view!=='review'; $('#searchBox').hidden=view!=='bank';
  renderJobs(); moveSlider();
  try{const cur=document.querySelector('.views a[aria-current="page"]'),nv=cur?.parentElement;if(nv&&nv.scrollWidth>nv.clientWidth)nv.scrollTo({left:cur.offsetLeft-nv.clientWidth/2+cur.offsetWidth/2,behavior:'smooth'})}catch(e){}   // owner 14 Nov: on a phone the tab row scrolls; keep the open tab in sight
  const shown=[['bank','#bankView'],['review','#reviewView'],['papers','#papersView'],['processes','#processesView'],['guide','#guideView'],['levels','#levelsView'],['reports','#reportsView'],['exams','#examsView']].find(x=>x[0]===view);
  if(shown&&window._lastView!==view){const el=$(shown[1]);if(el){el.classList.remove('enter');void el.offsetWidth;el.classList.add('enter')}window._lastView=view}   // owner 12 Nov: tab switch animation
  if(view==='processes'){renderProcesses();renderImport();if(!B)return}
  if(!B) return;
  $('#todoN').textContent=todoCount()||'';
  if(view==='guide') renderGuide(); else if(view==='reports') renderReports(); else if(view==='levels') renderLevels(); else if(view==='exams') renderExams(); else if(view==='bank') renderBank(); else if(view==='papers') renderPapers(); else if(view==='processes'){renderProcesses();renderImport()} else { $('#stF').value=rstatus; refreshReview(); }
}
