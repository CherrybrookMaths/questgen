document.addEventListener('click',e=>{const b=e.target.closest('[data-paperok]');if(b)approvePaper(b.dataset.paperok)});
window.addEventListener('hashchange',route);
// owner 12 Nov: "show somewhere on the artifact things which are running so I know". Source: db doc progress/jobs, written by Claude
// when a background job starts or finishes: {jobs:[{name, detail, affects:'diagrams'|'decide'|'check'|'sample'|'tags'|'', started}]}
// owner 12 Nov: "a way to change between dark and light mode". Auto follows the device; stored per viewer.
const THEMES=[['auto','Theme: Auto'],['light','☀ Light'],['dark','☾ Dark']];
function applyTheme(t){const r=document.documentElement;if(t==='light'||t==='dark')r.setAttribute('data-theme',t);else r.removeAttribute('data-theme');
  const b=$('#themeBtn');if(b){const x=THEMES.find(x=>x[0]===t)||THEMES[0];b.textContent=x[1];b.setAttribute('aria-label','Theme: '+x[0]+'. Click to change')}}
let THEME=load('theme')||'auto';applyTheme(THEME);
document.addEventListener('click',e=>{if(e.target.closest('#themeBtn')){const i=THEMES.findIndex(x=>x[0]===THEME);THEME=THEMES[(i+1)%3][0];save('theme',THEME);applyTheme(THEME)}});
let JOBS=[];
function moveSlider(){const nav=document.querySelector('.views'),sl=nav&&nav.querySelector('.slider'),cur=nav&&nav.querySelector('a[aria-current="page"]');if(!sl||!cur)return;
  sl.style.width=cur.offsetWidth+'px';sl.style.transform=`translateX(${cur.offsetLeft}px)`}
window.addEventListener('resize',moveSlider);
try{const ro=new ResizeObserver(()=>moveSlider());document.querySelectorAll('.views a').forEach(a=>ro.observe(a))}catch(e){}   // tab widths change when the Review count fills in
function setHdr(){const h=document.querySelector("header");if(h)document.documentElement.style.setProperty("--hdr",h.getBoundingClientRect().height+"px");const bv=document.getElementById("bankView");if(bv&&!bv.hidden){const pt=parseFloat(getComputedStyle(bv).paddingTop)||0;document.documentElement.style.setProperty("--navtop",(bv.getBoundingClientRect().top+scrollY+pt)+"px")}}   // owner 12 Nov: the sidebar sticks exactly where it starts, so it never shifts
if(window.ResizeObserver){new ResizeObserver(()=>setHdr()).observe(document.querySelector("header"))}
// owner 14 Nov: "Can u show this list of tasks on the artifact somewhere, need a pill for current jobs and queued jobs".
// Two quiet pills replace the single jobs pill: "N running" (accent) and "N queued" (muted). Each shows its list on hover
// (on a touch screen the first tap shows it) and links to Processes. A pill with a count of 0 is hidden.
// Running = progress/jobs plus any progress/queue item marked running. Once the queue doc is loaded, the old
// "Queued: 5 tasks" pseudo-job in progress/jobs is ignored: the queued pill says it properly.
let QUEUE=null;
function startedAgo(s){if(!s)return'';let d=null;const hm=/^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if(hm){d=new Date();d.setHours(+hm[1],+hm[2],0,0);if(d-Date.now()>5*60000)d.setDate(d.getDate()-1)}else d=new Date(s);
  return isNaN(d)?'since '+s:ago(d)}
function queueItems(st){return ((QUEUE&&QUEUE.items)||[]).filter(x=>x&&x.title&&(!st||(x.status||'queued')===st)).sort((a,b)=>(+a.order||1e9)-(+b.order||1e9))}
function runningNow(){const jobs=JOBS.filter(j=>j&&j.name&&!(QUEUE&&/^\s*queued\b/i.test(j.name))).map(j=>({...j,src:'job'}));
  const have=new Set(jobs.map(j=>String(j.name).trim().toLowerCase()));
  return jobs.concat(queueItems('running').filter(x=>!have.has(String(x.title).trim().toLowerCase())).map(x=>({name:x.title,detail:x.detail,started:x.started,asked:x.asked,src:'queue'})))}
function renderJobs(){const el=$('#jobs');if(!el)return;const run=runningNow(),que=queueItems('queued');
  // owner 15 Nov: the pills lead to Processes (Curate), so only editors see them
  el.hidden=!isEditor()||(!run.length&&!que.length);if(el.hidden){el.innerHTML='';setHdr();return}
  const hit=run.filter(j=>j.affects&&view==='review'&&rfilter===j.affects);
  const go=`<a class="jgo" href="#processes">Open Processes →</a>`;
  const runPill=run.length?`<span class="jp run${hit.length?' hit':''}"><a class="jpill" href="#processes" aria-describedby="jpopR"><span class="dot" aria-hidden="true"></span>${hit.length?'Wait · ':''}${run.length} running</a>
    <span class="jpop" role="tooltip" id="jpopR">${run.map(j=>`<span class="job"><b>${esc(j.name)}</b>${j.detail?`<span class="muted">${esc(j.detail)}</span>`:''}${j.started?`<span class="muted when">${esc(startedAgo(j.started))}</span>`:''}</span>`).join('')}${hit.length?`<span class="jwarn">Wait before reviewing this step: ${esc(hit.map(j=>j.name).join(', '))} will change it.</span>`:''}${go}</span></span>`:'';
  const quePill=que.length?`<span class="jp que"><a class="jpill" href="#processes" aria-describedby="jpopQ">${que.length} queued</a>
    <span class="jpop" role="tooltip" id="jpopQ">${que.slice(0,6).map((x,i)=>`<span class="job"><b><span class="qn">${i+1}</span>${esc(x.title)}</b>${x.detail?`<span class="muted">${esc(x.detail)}</span>`:''}</span>`).join('')}${que.length>6?`<span class="muted">and ${que.length-6} more</span>`:''}${go}</span></span>`:'';
  el.innerHTML=runPill+quePill;setHdr()}
function placeJpop(jp){const pill=jp&&jp.querySelector('.jpill'),pop=jp&&jp.querySelector('.jpop');if(!pill||!pop)return;const r=pill.getBoundingClientRect(),w=Math.min(380,innerWidth-32);
  pop.style.width=w+'px';pop.style.top=(r.bottom+8)+'px';pop.style.left=Math.max(16,Math.min(r.left,innerWidth-16-w))+'px'}
document.addEventListener('mouseover',e=>{const jp=e.target.closest&&e.target.closest('.jobs .jp');if(jp&&!jp.contains(e.relatedTarget))placeJpop(jp)});
document.addEventListener('focusin',e=>{const jp=e.target.closest&&e.target.closest('.jobs .jp');if(jp)placeJpop(jp)});
// touch: no hover, so the first tap on a pill opens its list (with "Open Processes →"), a second tap goes there
document.addEventListener('click',e=>{const pill=e.target.closest('.jobs .jpill'),open=document.querySelector('.jobs .jp.open');
  if(open&&!open.contains(e.target))open.classList.remove('open');
  if(!pill)return;const jp=pill.closest('.jp');let touch=false;try{touch=matchMedia('(hover:none)').matches}catch(_){}
  if(touch&&!jp.classList.contains('open')){e.preventDefault();placeJpop(jp);jp.classList.add('open')}else jp.classList.remove('open')});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){const o=document.querySelector('.jobs .jp.open');if(o)o.classList.remove('open')}});

