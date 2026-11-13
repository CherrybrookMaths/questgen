/* ---------- routing ---------- */
let view='bank';
function todoCount(){return STEPS.reduce((n,[k])=>n+B.questions.filter(q=>inFilter(q,k)&&isTodo(q,k)).length,0)}
/* ---------- Teach | Curate (owner 15 Nov: "Lets do 2 as well" and "curate should be hidden to peope except editors.") ----------
   Two areas. Teach: Bank · Exams · Guide. Curate: Review · Papers · Processes, where Difficulty and Reports are steps inside
   Review (#review/difficulty, #review/reports; the old #levels, #difficulty and #reports links still land there).
   EDITOR: null while the user capability has not answered, then true only for the artifact's owner or an editor
   (user.isOwner() / user.canEdit()). Unknown (null) or no user capability counts as not an editor: Curate stays hidden.
   This hides the Curate UI only; what the database lets a viewer write is decided by its rules, not by this page. */
let EDITOR=null;
const AREAS={teach:['bank','exams','guide'],curate:['review','papers','processes','levels','reports']};
const areaOf=v=>AREAS.curate.includes(v)?'curate':'teach';
const isEditor=()=>EDITOR===true;
const HASHV={'#review':'review','#review/difficulty':'levels','#review/reports':'reports','#papers':'papers','#processes':'processes','#guide':'guide','#exams':'exams','#bank':'bank'};
const VHASH={review:'#review',levels:'#review/difficulty',reports:'#review/reports',papers:'#papers',processes:'#processes',guide:'#guide',exams:'#exams',bank:'#bank'};
// old links: #import (owner 14 Nov) → Processes; #levels / #difficulty / #reports (tabs until 15 Nov) → their Review step
const HASH_ALIAS={'#import':'#processes','#levels':'#review/difficulty','#difficulty':'#review/difficulty','#reports':'#review/reports'};
function setHash(h){try{history.replaceState(null,'',h)}catch(e){location.replace(h)}}
function applyArea(){const a=areaOf(view),ed=isEditor();
  document.documentElement.dataset.area=a;document.documentElement.classList.toggle('editor',ed);
  $$('.views a[data-area]').forEach(x=>x.hidden=!ed?x.dataset.area!=='teach':x.dataset.area!==a);
  const sw=$('#areaSw');if(sw){sw.hidden=!ed;$$('#areaSw button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.area===a)))}
  if(ed){save('qg_area',a);save('qg_last_'+a,VHASH[view]||'')}   // owner/editor: remember the last area (and view in it)
  moveAreaSlider()}
function moveAreaSlider(){const sw=$('#areaSw'),sl=sw&&sw.querySelector('.aslider'),cur=sw&&sw.querySelector('button[aria-pressed="true"]');if(!sl||!cur||sw.hidden)return;
  sl.style.width=cur.offsetWidth+'px';sl.style.transform=`translateX(${cur.offsetLeft}px)`}
function goArea(a){if(!isEditor()&&a==='curate')return;const last=load('qg_last_'+a);location.hash=(last&&areaOf(HASHV[last])===a)?last:(a==='curate'?'#review':'#bank')}
function route(){
  // owner 14 Nov: "Can make that page processes". The Import tab is now Processes (#processes); old #import links still land there.
  const al=HASH_ALIAS[location.hash];if(al)setHash(al);
  let v=HASHV[location.hash]||'bank';
  // owner 15 Nov: "curate should be hidden to peope except editors." A viewer who opens a Curate link lands on the Bank.
  // While the user capability has not answered yet (EDITOR null) the Bank shows and the link is kept, so an editor's link still works once it answers.
  if(areaOf(v)==='curate'&&!isEditor()){v='bank';if(EDITOR===false)setHash('#bank')}
  view=v;
  const inRev=['review','levels','reports'].includes(view);
  $('#guideView').hidden=view!=='guide';$('#levelsView').hidden=view!=='levels';$('#reportsView').hidden=view!=='reports';$('#examsView').hidden=view!=='exams';$('#processesView').hidden=view!=='processes';$('#papersView').hidden=view!=='papers';
  [['vBank','bank'],['vExams','exams'],['vGuide','guide'],['vPapers','papers'],['vProcesses','processes']].forEach(([id,v])=>$('#'+id).setAttribute('aria-current',view===v?'page':'false'));
  $('#vReview').setAttribute('aria-current',inRev?'page':'false');   // owner 15 Nov: Difficulty and Reports are steps inside Review
  $('#bankView').hidden=view!=='bank'; $('#reviewView').hidden=view!=='review'; $('#rbar').hidden=!inRev; $('#rbar').classList.toggle('xstep',inRev&&view!=='review'); $('#progbar').hidden=view!=='review'; $('#searchBox').hidden=view!=='bank';
  applyArea();
  renderJobs(); moveSlider();
  try{const cur=document.querySelector('.views a[aria-current="page"]'),nv=cur?.parentElement;if(nv&&nv.scrollWidth>nv.clientWidth)nv.scrollTo({left:cur.offsetLeft-nv.clientWidth/2+cur.offsetWidth/2,behavior:'smooth'})}catch(e){}   // owner 14 Nov: on a phone the tab row scrolls; keep the open tab in sight
  const shown=[['bank','#bankView'],['review','#reviewView'],['papers','#papersView'],['processes','#processesView'],['guide','#guideView'],['levels','#levelsView'],['reports','#reportsView'],['exams','#examsView']].find(x=>x[0]===view);
  if(shown&&window._lastView!==view){const el=$(shown[1]);if(el){el.classList.remove('enter');void el.offsetWidth;el.classList.add('enter')}window._lastView=view}   // owner 12 Nov: tab switch animation
  if(view==='processes'){renderProcesses();renderImport();if(!B)return}
  if(!B) return;
  $('#todoN').textContent=todoCount()||'';
  if(inRev&&view!=='review')renderSteps();
  if(view==='guide') renderGuide(); else if(view==='reports') renderReports(); else if(view==='levels') renderLevels(); else if(view==='exams') renderExams(); else if(view==='bank') renderBank(); else if(view==='papers') renderPapers(); else if(view==='processes'){renderProcesses();renderImport()} else { $('#stF').value=rstatus; refreshReview(); }
}
// the user capability answered: show or hide Curate, and send a viewer on a Curate link to the Bank
function setEditor(ed){EDITOR=!!ed;
  // owner/editor with no link in the address: open the area used last
  if(EDITOR&&!location.hash&&load('qg_area')==='curate'&&!window._navved){goArea('curate');return}
  route()}
window.addEventListener('hashchange',()=>{window._navved=true},true);
document.addEventListener('click',e=>{const b=e.target.closest('#areaSw button[data-area]');if(b)goArea(b.dataset.area)});
window.addEventListener('resize',()=>moveAreaSlider());
