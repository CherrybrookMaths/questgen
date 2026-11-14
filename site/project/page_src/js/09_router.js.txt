/* ---------- routing (the view on screen is QG.view, alias view) ---------- */
// owner 13 Nov ("An 'Inbox' beside papers"): the Review tab and the Curate switch count the Inbox: papers with work left + open reports
function todoCount(){if(!B)return 0;let n=0;allWork().forEach(w=>{if(w.n)n++});return n+(typeof repOpen==='function'?repOpen().length:0)}
/* ---------- Teach | Curate (owner 15 Nov: "Lets do 2 as well" and "curate should be hidden to peope except editors.") ----------
   Two areas. Teach: Bank · Exams · Guide. Curate: Review · Papers · Processes, where Difficulty and Reports are steps inside
   Review (#review/difficulty, #review/reports; the old #levels, #difficulty and #reports links still land there).
   QG.editor (alias EDITOR): null while the user capability has not answered, then true only for the artifact's owner or an editor
   (user.isOwner() / user.canEdit()). Unknown (null) or no user capability counts as not an editor: Curate stays hidden.
   This hides the Curate UI only; what the database lets a viewer write is decided by its rules, not by this page. */
// owner 13 Nov: Review is an Inbox (#review), the papers list (#review/papers, the old Papers tab: "Merge into Review"), one paper at a
// time (#review/paper/<doc>/<step>), the lists (#review/list/<filter>), Reports and Difficulty. Curate is Review · Processes.
const AREAS={teach:['bank','exams','guide'],curate:['inbox','review','papers','processes','levels','reports']};
const REVIEW_VIEWS=['inbox','review','papers','levels','reports'];
const areaOf=v=>AREAS.curate.includes(v)?'curate':'teach';
const isEditor=()=>QG.editor===true;
const HASHV={'#review':'inbox','#review/papers':'papers','#review/difficulty':'levels','#review/reports':'reports','#processes':'processes','#processes/work':'processes','#processes/papers':'processes','#processes/papers/check':'processes','#guide':'guide','#exams':'exams','#bank':'bank'};
const VHASH={inbox:'#review',review:'#review',levels:'#review/difficulty',reports:'#review/reports',papers:'#review/papers',processes:'#processes',guide:'#guide',exams:'#exams',bank:'#bank'};
// old links: #import (owner 14 Nov) → Processes › Papers (owner 13 Nov, two tabs: the import dashboard is in Papers › Import history); #levels / #difficulty / #reports (tabs until 15 Nov) → their Review section; #papers (tab until 13 Nov) → Review's papers
const HASH_ALIAS={'#import':'#processes/papers','#levels':'#review/difficulty','#difficulty':'#review/difficulty','#reports':'#review/reports','#papers':'#review/papers'};
// owner 13 Nov: "The process page feels a bit bloated now" -> "Two tabs: Work | Papers": #processes/work, #processes/papers; bare #processes opens the tab used last (default Work)
// owner 14 Nov (mockup A): #processes/papers/check is the Papers tab's Needs a check view (psub 'check')
function parseHash(h){if(HASHV[h]){const m=/^#processes\/(\w+)(?:\/(\w+))?$/.exec(h);return m?{v:HASHV[h],ptab:m[1],psub:m[2]||''}:{v:HASHV[h]}}let m=/^#review\/paper\/(\d+)(?:\/([\w-]+))?$/.exec(h);if(m)return {v:'review',doc:m[1],step:m[2]||''};
  m=/^#review\/list\/(\w+)$/.exec(h);if(m)return {v:'review',list:m[1]};return {v:'bank'}}
function setHash(h){try{history.replaceState(null,'',h)}catch(e){location.replace(h)}}
function applyArea(){const a=areaOf(view),ed=isEditor();
  document.documentElement.dataset.area=a;document.documentElement.classList.toggle('editor',ed);
  $$('.views a[data-area]').forEach(x=>x.hidden=!ed?x.dataset.area!=='teach':x.dataset.area!==a);
  const sw=$('#areaSw');if(sw){sw.hidden=!ed;$$('#areaSw button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.area===a)))}
  if(ed){save('qg_area',a);save('qg_last_'+a,parseHash(location.hash).v===view?location.hash:(VHASH[view]||''))}   // owner/editor: remember the last area (and view in it)
  moveAreaSlider()}
// every segmented switch (Teach | Curate in the header, Work | Papers on Processes): the highlight sits under the pressed button
function moveAreaSlider(){$$('.areasw').forEach(sw=>{const sl=sw.querySelector('.aslider'),cur=sw.querySelector('button[aria-pressed="true"]');if(!sl||!cur||sw.hidden||!sw.offsetWidth)return;
  sl.style.width=cur.offsetWidth+'px';sl.style.transform=`translateX(${cur.offsetLeft}px)`})}
function goArea(a){if(!isEditor()&&a==='curate')return;const last=load('qg_last_'+a);location.hash=(last&&areaOf(parseHash(last).v)===a)?last:(a==='curate'?'#review':'#bank')}
function route(){
  // owner 14 Nov: "Can make that page processes". The Import tab is now Processes (#processes); old #import links land on its Papers tab (owner 13 Nov, Work | Papers).
  const al=HASH_ALIAS[location.hash];if(al)setHash(al);
  const P=parseHash(location.hash);let v=P.v;
  // owner 15 Nov: "curate should be hidden to peope except editors." A viewer who opens a Curate link lands on the Bank.
  // While the user capability has not answered yet (EDITOR null) the Bank shows and the link is kept, so an editor's link still works once it answers.
  if(areaOf(v)==='curate'&&!isEditor()){v='bank';if(EDITOR===false)setHash('#bank')}
  // a paper (or list) needs the bank to resolve; until it loads the Inbox stands in
  if(v==='review'&&(!B||!openReview(P)))v='inbox';
  // Processes: the tab in the address, else the one used last (per browser), else Work; the address then names it
  if(v==='processes'&&isEditor()){const T=['work','papers'],t=T.includes(P.ptab)?P.ptab:(T.includes(load('qg_proc_tab'))?load('qg_proc_tab'):'work');
    const sub=t==='papers'&&P.ptab==='papers'&&P.psub==='check'?'check':'';
    if(location.hash!=='#processes/'+t+(sub?'/'+sub:''))setHash('#processes/'+t+(sub?'/'+sub:''));save('qg_proc_tab',t);$('#processesView').dataset.tab=t;$('#processesView').dataset.sub=sub}
  QG.view=v;
  const inRev=REVIEW_VIEWS.includes(view);
  $('#guideView').hidden=view!=='guide';$('#levelsView').hidden=view!=='levels';$('#reportsView').hidden=view!=='reports';$('#examsView').hidden=view!=='exams';$('#processesView').hidden=view!=='processes';$('#papersView').hidden=view!=='papers';$('#inboxView').hidden=view!=='inbox';
  [['vBank','bank'],['vExams','exams'],['vGuide','guide'],['vProcesses','processes']].forEach(([id,v])=>$('#'+id).setAttribute('aria-current',view===v?'page':'false'));
  $('#vReview').setAttribute('aria-current',inRev?'page':'false');   // owner 13 Nov: the Inbox, papers, Reports and Difficulty are all inside Review
  // owner 13 Nov: the 7-button step row is gone; the bar under the header is only for a paper (its track) or a list
  $('#bankView').hidden=view!=='bank'; $('#reviewView').hidden=view!=='review'; $('#rbar').hidden=view!=='review'; $('#progbar').hidden=view!=='review'; $('#searchBox').hidden=view!=='bank';
  applyArea();
  renderJobs(); moveSlider();
  try{const cur=document.querySelector('.views a[aria-current="page"]'),nv=cur?.parentElement;if(nv&&nv.scrollWidth>nv.clientWidth)nv.scrollTo({left:cur.offsetLeft-nv.clientWidth/2+cur.offsetWidth/2,behavior:'smooth'})}catch(e){}   // owner 14 Nov: on a phone the tab row scrolls; keep the open tab in sight
  const shown=[['bank','#bankView'],['review','#reviewView'],['inbox','#inboxView'],['papers','#papersView'],['processes','#processesView'],['guide','#guideView'],['levels','#levelsView'],['reports','#reportsView'],['exams','#examsView']].find(x=>x[0]===view);
  if(shown&&window._lastView!==view){const el=$(shown[1]);if(el){el.classList.remove('enter');void el.offsetWidth;el.classList.add('enter')}window._lastView=view}   // owner 12 Nov: tab switch animation
  if(view==='processes'){renderProcesses();if(!B)return}
  if(!B) return;
  updateCounts();
  if(view==='inbox') renderInbox(); else if(view==='guide') renderGuide(); else if(view==='reports') renderReports(); else if(view==='levels') renderLevels(); else if(view==='exams') renderExams(); else if(view==='bank') renderBank(); else if(view==='papers') renderPapers(); else if(view==='processes') renderProcesses(); else { $('#stF').value=rstatus; refreshReview(); }
}
// the user capability answered: show or hide Curate, and send a viewer on a Curate link to the Bank
function setEditor(ed){QG.editor=!!ed;TOPICS=null;   // owner 13 Nov: the Bank's approved-only filter depends on the role
  // owner/editor with no link in the address: open the area used last
  if(EDITOR&&!location.hash&&load('qg_area')==='curate'&&!window._navved){goArea('curate');return}
  route()}
window.addEventListener('hashchange',()=>{window._navved=true},true);
document.addEventListener('click',e=>{const b=e.target.closest('#areaSw button[data-area]');if(b)goArea(b.dataset.area);const p=e.target.closest('#procSw button[data-ptab]');if(p)location.hash='#processes/'+p.dataset.ptab});
window.addEventListener('resize',()=>moveAreaSlider());
