/* ===================== Difficulty check (owner 14 Nov) =====================
   Owner: "begin with that [the review screen for the HSC reference ratings]. Make it both desktop and mobile friendly, I might
   want to approve on the go today". One part at a time: the question with the rated part highlighted, our band (2-6) and
   working-mathematically label (UF / PR), and Agree or a change. Decisions go to the page database, collection `difficulty`
   (doc = part id). Changing a reference band later shifts every part that was compared with it (applied at build time). */
const LV_FLAGS=[2066,1137,2209,2547,2625,2303,2817,1311,1587];   // parts the overnight audit flagged (difficulty_report.md)
const LV_FIRST=['Y11_Exponential_and_logarithmic_functions','Y11_Trigonometric_identities_and_equations','Y12_Sequences_and_series'];   // thin reference sets first
const LV_WM={UF:'Understanding & fluency',PR:'Problem solving & reasoning'};
const LV_BAND={2:'one routine step',3:'two steps / standard technique',4:'several steps, ideas combined',5:'non-routine set-up or general proof',6:'needs real insight'};
let DIFD={},LVQ=null,LVI=0,LVAREA=(()=>{try{return localStorage.getItem('lv_area')||'thin'}catch(e){return 'thin'}})(),LVSHOW=(()=>{try{return localStorage.getItem('lv_show')||'todo'}catch(e){return 'todo'}})(),_lvsub=null;
const lvName=a=>String(a||'').replace(/^Y1[12]_/,'').replace(/_/g,' ');
const lvYear=a=>/^Y11/.test(a)?'Y11':'Y12';
function lvItems(){if(LVQ)return LVQ;const out=[];
  B.questions.forEach(q=>{if(q.dup_of)return;q.parts.forEach(p=>{const d0=p.dif;if(!d0)return;const d=d0.m!=null?{...d0,b:d0.m,wm:d0.mw}:d0;   // compare with the model's original rating, not the owner-applied one
  if(d.a||LV_FLAGS.includes(p.id))out.push({q,p,d,flag:!d.a})})});
  const rank=x=>x.flag?99:(LV_FIRST.indexOf(x.d.ar)>=0?LV_FIRST.indexOf(x.d.ar):10);
  out.sort((x,y)=>rank(x)-rank(y)||String(x.d.ar).localeCompare(String(y.d.ar))||x.q.id-y.q.id||x.p.id-y.p.id);
  const lean={};B.questions.forEach(q=>q.parts.forEach(p=>{const n=p.dif?.na;if(n)lean[n]=(lean[n]||0)+1}));out.forEach(x=>x.lean=lean[x.p.id]||0);
  // owner 14 Nov: "Yeah let's do that" (spot-check): the 9 flagged parts, then the 3 parts per remaining topic that the most other parts were rated against
  const by={};out.forEach(x=>{if(x.flag){x.spot=1;return}if(LV_FIRST.includes(x.d.ar))return;(by[x.d.ar]=by[x.d.ar]||[]).push(x)});
  Object.values(by).forEach(xs=>xs.slice().sort((a,b)=>b.lean-a.lean||a.p.id-b.p.id).slice(0,3).forEach(x=>x.spot=1));
  return LVQ=out}
const lvDone=x=>!!DIFD[x.p.id]?.status;
const lvInArea=x=>LVAREA==='all'||(LVAREA==='spot'?!!x.spot:LVAREA==='thin'?LV_FIRST.includes(x.d.ar)&&!x.flag:LVAREA==='flags'?x.flag:x.d.ar===LVAREA&&!x.flag);
// owner 15 Nov: the Difficulty step in Review shows this count: parts still to check in the chosen list
// owner 13 Nov: "Why are there still difficulty checks to go through": the count followed whichever dropdown list was open
// (e.g. All = 217 optional references), so it never reached 0. It now counts only the plan: thin topics, the spot-check,
// and any topic with two or more changes (checked in full). The optional references stay reachable from the dropdown.
function lvHot(){const chg={};lvItems().forEach(y=>{if(DIFD[y.p.id]?.status==='changed'&&!y.flag)chg[y.d.ar]=(chg[y.d.ar]||0)+1});return Object.keys(chg).filter(a=>chg[a]>=2)}
function lvTodoN(){if(!B)return 0;lvSub();const hot=lvHot();return lvItems().filter(x=>(x.spot||x.flag||(LV_FIRST.includes(x.d.ar)&&!x.flag)||hot.includes(x.d.ar))&&!lvDone(x)).length}
function lvList(){const all=lvItems();
  const r=all.filter(x=>lvInArea(x)&&(LVSHOW==='all'||!lvDone(x)));
  return LVAREA==='spot'?r.sort((a,b)=>(b.flag?1:0)-(a.flag?1:0)||String(a.d.ar).localeCompare(String(b.d.ar))||b.lean-a.lean):r}
function lvSub(){if(_lvsub||!db)return;try{_lvsub=db.collection('difficulty').onSnapshot(s=>{const d=s.docs||s,nx={};(d||[]).forEach(x=>{const v=typeof x.data==='function'?x.data():x.data;if(v)nx[x.id]=v});DIFD=nx;if(['inbox','review','levels','reports'].includes(view))renderSteps();if(view==='levels')renderLevels(true);else if(view==='guide'&&typeof g2ChkRefresh==='function')g2ChkRefresh()},()=>{})}catch(e){}}
function renderLevels(keep){
  lvSub();const box=$('#levelsBox');const all=lvItems(),list=lvList();
  const done=all.filter(lvDone).length, anchors=all.filter(x=>!x.flag), adone=anchors.filter(lvDone).length;
  if(!keep)LVI=Math.min(LVI,Math.max(0,list.length-1));else LVI=Math.min(LVI,Math.max(0,list.length-1));
  const areas=[...new Set(anchors.map(x=>x.d.ar))].sort((a,b)=>(LV_FIRST.includes(a)?0:1)-(LV_FIRST.includes(b)?0:1)||a.localeCompare(b));
  const cnt=f=>{const xs=all.filter(f);return `${xs.filter(lvDone).length}/${xs.length}`};
  const x=list[LVI];
  const head=`<div class="lvtop"><div class="lvtitle"><h2>Difficulty check</h2><span class="lvprog"><b>${adone}</b> of ${anchors.length} HSC references checked${done>adone?` · ${done-adone} flagged parts`:''}${lvTodoN()===0?' · <b>check plan finished</b>; anything left in this list is optional':''}</span></div>
    <div class="lvbar"><i style="width:${Math.round(100*adone/Math.max(1,anchors.length))}%"></i></div>
    <div class="lvctl"><select id="lvArea" aria-label="Which parts"><option value="thin"${LVAREA==='thin'?' selected':''}>Start here: thin topics (${cnt(x=>LV_FIRST.includes(x.d.ar)&&!x.flag)})</option><option value="spot"${LVAREA==='spot'?' selected':''}>Spot-check: flagged + 3 per topic (${cnt(x=>x.spot)})</option>
      ${areas.map(a=>`<option value="${esc(a)}"${LVAREA===a?' selected':''}>${lvYear(a)} ${esc(lvName(a))} (${cnt(x=>x.d.ar===a&&!x.flag)})</option>`).join('')}
      <option value="flags"${LVAREA==='flags'?' selected':''}>Flagged by the audit (${cnt(x=>x.flag)})</option><option value="all"${LVAREA==='all'?' selected':''}>Everything (${cnt(()=>true)})</option></select>
      <div class="lvseg" role="group" aria-label="Show"><button data-lvshow="todo" aria-pressed="${LVSHOW==='todo'}">To check</button><button data-lvshow="all" aria-pressed="${LVSHOW==='all'}">All</button></div></div></div>`;
  if(!x){const chg={};all.forEach(y=>{if(DIFD[y.p.id]?.status==='changed'&&!y.flag)chg[y.d.ar]=(chg[y.d.ar]||0)+1});const hot=Object.keys(chg).filter(a=>chg[a]>=2);
    box.innerHTML=head+`<div class="lvempty"><b>Nothing left here.</b><br>${LVAREA==='spot'?(hot.length?`Check these topics in full (two or more changes): ${hot.map(a=>esc(lvYear(a)+' '+lvName(a))).join(', ')}.`:'No topic had two or more changes, so the rest of the ratings stand. You\'re done.'):LVAREA==='thin'?'The thin topics are done. Next: Spot-check in the dropdown above.':'Pick another topic above, or show All to revisit.'}</div>`;return}
  const dec=DIFD[x.p.id], band=dec?.band??x.d.b, wm=dec?.wm??x.d.wm, changed=dec&&(dec.band!==x.d.b||dec.wm!==x.d.wm);
  const label=x.p.label?`(${x.p.label})`:'';
  box.innerHTML=head+`<article class="lvcard" data-part="${x.p.id}">
    <div class="lvmeta"><span class="lvtag ${x.flag?'flag':''}">${x.flag?'Flagged by the audit':'HSC reference'}</span><span>${lvYear(x.d.ar)} ${esc(lvName(x.d.ar))}</span><span class="lvpos">${LVI+1} / ${list.length}</span></div>
    <h3>${esc(srcLine(x.q))} ${esc(label)} <small>${qid(x.q)} · ${x.p.marks??x.q.marks??'?'} mark${(x.p.marks??x.q.marks)===1?'':'s'}</small></h3>
    <div class="lvq">${qBody(x.q,'bank')}</div></article>
    <div class="lvact" id="lvAct">
      <div class="lvwhy"><b>Our rating:</b> Band ${x.d.b} · ${LV_WM[x.d.wm]}${x.d.c==='l'?' · <span class="lvlow">low confidence</span>':''}<span class="lvr">${esc(x.d.r||'')}</span>${x.lean?`<span class="lvlean">${x.lean} other part${x.lean===1?'':'s'} were rated against this one</span>`:''}</div>
      <div class="lvpick"><div class="lvbands" role="group" aria-label="Band">${[2,3,4,5,6].map(b=>`<button data-lvb="${b}" aria-pressed="${band===b}" title="Band ${b}: ${LV_BAND[b]}"><b>${b}</b><span>${['','','routine','standard','multi-step','non-routine','insight'][b]}</span></button>`).join('')}</div>
        <div class="lvwm" role="group" aria-label="Working mathematically">${['UF','PR'].map(w=>`<button data-lvw="${w}" aria-pressed="${wm===w}">${w==='UF'?'Fluency':'Problem solving'}</button>`).join('')}</div></div>
      <div class="lvgo"><button class="lvnav" data-lvnav="-1" aria-label="Previous" ${LVI?'':'disabled'}>‹</button>
        <button class="lvok ${changed?'chg':''}" id="lvOk">${dec?.status?(changed?'Saved: changed ✓':'Agreed ✓'):(band!==x.d.b||wm!==x.d.wm?'Save change':'Agree')}<kbd>↵</kbd></button>
        <button class="lvnav" data-lvnav="1" aria-label="Next" ${LVI<list.length-1?'':'disabled'}>›</button></div>
    </div>`;
  box._pick={band,wm};
  const q=x.q,card=box.querySelector('.lvcard');hydrate(card,q,'bank');
  const parts=card.querySelectorAll('.qbody > .part');const k=q.parts.findIndex(p=>p.id===x.p.id);
  if(q.parts.length>1)parts.forEach((el,i)=>{el.classList.add(i===k?'lvhit':'lvdim')});
  card.querySelectorAll('details.solbox').forEach(d=>d.open=false);
  typeset(card);
}
function lvSet(k,v){const box=$('#levelsBox');if(!box._pick)return;box._pick[k]=v;
  $$(k==='band'?'[data-lvb]':'[data-lvw]',box).forEach(b=>b.setAttribute('aria-pressed',String((k==='band'?+b.dataset.lvb:b.dataset.lvw)===v)));
  const x=lvList()[LVI],ok=$('#lvOk');if(x&&ok){const ch=box._pick.band!==x.d.b||box._pick.wm!==x.d.wm;ok.firstChild.textContent=ch?'Save change':'Agree';ok.classList.toggle('chg',ch)}}
async function lvSave(){const box=$('#levelsBox'),list=lvList(),x=list[LVI];if(!x)return;const {band,wm}=box._pick;
  const v={band,wm,orig_band:x.d.b,orig_wm:x.d.wm,status:band===x.d.b&&wm===x.d.wm?'agreed':'changed',part_id:x.p.id,question_id:x.q.id,area:x.d.ar,anchor:!x.flag,by:me||null,at:new Date().toISOString()};
  DIFD[x.p.id]=v;   // optimistic; move on at once (owner: "why doesn't approving auto next")
  if(LVSHOW==='todo'){renderLevels(true)}else{LVI=Math.min(LVI+1,list.length-1);renderLevels(true)}
  window.scrollTo({top:0,behavior:RM.matches?'auto':'smooth'});
  if(!db){toast('Not saved: open the page in claude.ai to save');return}
  try{await db.doc('difficulty/'+x.p.id).set(v)}catch(e){toast('Could not save. Try again in a moment.')}}
document.addEventListener('change',e=>{if(e.target.id==='lvArea'){LVAREA=e.target.value;try{localStorage.setItem('lv_area',LVAREA)}catch(_){}LVI=0;renderLevels();renderSteps()}});
document.addEventListener('click',e=>{if(view!=='levels')return;
  const s=e.target.closest('[data-lvshow]');if(s){LVSHOW=s.dataset.lvshow;try{localStorage.setItem('lv_show',LVSHOW)}catch(_){}LVI=0;renderLevels();return}
  const b=e.target.closest('[data-lvb]');if(b){lvSet('band',+b.dataset.lvb);return}
  const w=e.target.closest('[data-lvw]');if(w){lvSet('wm',w.dataset.lvw);return}
  const n=e.target.closest('[data-lvnav]');if(n&&!n.disabled){LVI+=+n.dataset.lvnav;renderLevels(true);window.scrollTo({top:0});return}
  if(e.target.closest('#lvOk')){lvSave();return}});
document.addEventListener('keydown',e=>{if(view!=='levels'||e.target.closest('input,textarea,select'))return;
  if(/^[2-6]$/.test(e.key)){lvSet('band',+e.key);e.preventDefault()}else if(e.key==='f'){lvSet('wm','UF')}else if(e.key==='p'){lvSet('wm','PR')}
  else if(e.key==='Enter'||e.key==='a'){e.preventDefault();lvSave()}else if(e.key==='k'||e.key==='ArrowRight'){const l=lvList();if(LVI<l.length-1){LVI++;renderLevels(true)}}else if(e.key==='j'||e.key==='ArrowLeft'){if(LVI){LVI--;renderLevels(true)}}});
