/* ---------- topic index ---------- */
let TOPICS=null;
// owner 12 Nov ("a questions parts shouldn't be split if they're related" -> "Yeah lets do that"): ONE topic home per
// question = the subheading carrying the most marks across its parts' main dot points. Other parts' topics become gates only.
const subKey=id=>id==='removed'?'special:removed':id==='no_match'?'special:no_match':DM[id]?'sub:'+DM[id].yl+'|'+DM[id].fa+'|'+(DM[id].sub||''):null;
function partPri(q,p,side){if(side==='res'){const v=reviews['q'+q.id]?.tagres?.[p.id];if(v==='A'||v==='B')side=v;else if(v?.id)return [v.id];else if(v?.cov)return [v.cov];else side='cur'}
  if(side!=='cur'&&p.tagd){const x=p.tagd[side];return x.removed?['removed']:x.dp.filter(d=>d[1]==='primary').map(d=>d[0])}
  return effTags(q,p).filter(t=>t.primary).map(t=>t.cov==='removed'||t.cov==='no_match'?t.cov:t.id)}
// tie on marks -> the topic of the LATER part wins (spec: "on a tie, the final answer decides"; owner 12 Nov on QID 1221:
// "both were wrong here, this should've been in integration")
function homeOf(q,side){const w=new Map(),last=new Map();q.parts.filter(p=>leaf(q,p)).forEach((p,pi)=>{const ids=partPri(q,p,side),m=(p.marks||1)/(ids.length||1);ids.forEach(i=>{const k=subKey(i);if(k){w.set(k,(w.get(k)||0)+m);last.set(k,pi)}})});
  // owner 12 Nov: "show the derivative, hence integrate" -> integration, whatever the marks
  const lv=q.parts.filter(p=>leaf(q,p)),lp=lv[lv.length-1];
  if(lv.length>1&&/\bhence\b/i.test(lp.latex||'')&&/\\int/.test(lp.latex||'')&&lv.slice(0,-1).some(p=>/\\dfrac\{d\}\{dx\}|\\frac\{d\}\{dx\}|differentiate|derivative|f'|\\prime/i.test(p.latex||''))){const k=subKey(partPri(q,lp,side)[0]);if(k)return k}
  if(w.size>1&&w.has('special:removed'))w.delete('special:removed');   // owner 12 Nov: a removed 3D part never decides the home when other parts are in the course
  let best=null,bv=-1,bp=-1;w.forEach((v,k)=>{const lp=last.get(k);if(v>bv+1e-9||(Math.abs(v-bv)<1e-9&&lp>bp)){bv=v;best=k;bp=lp}});return best}
function homeNeed(q){return !q.dup_of&&q.parts.some(p=>p.tagd)&&homeOf(q,'A')!==homeOf(q,'B')}
function qHome(q){const r=reviews['q'+q.id]?.home;if(r==='A'||r==='B')return homeOf(q,r);if(r?.id)return subKey(r.id);if(r?.cov)return subKey(r.cov);return partsDone(q)?homeOf(q,'res'):homeOf(q,'cur')}
// picks made per part before the switch to one home per question (5 parts, 12 Nov) still count
function partsDone(q){const t=reviews['q'+q.id]?.tagres;return !!t&&q.parts.filter(tagNeed).every(p=>t[p.id])}
function homeLabel(k){if(!k)return 'none';if(k==='special:removed')return 'Removed from syllabus';if(k==='special:no_match')return 'No dot point fits';const [yl,fa,sb]=k.slice(4).split('|');return `<span class="yb y${yl}">Y${yl}</span> ${esc(fa)}${sb?' › <b>'+esc(sb)+'</b>':''}`}
function qPlaces(q){ // owner 12 Nov: one topic home per question
  const h=qHome(q); return new Set(h?[h]:[]);
}
function qPlacesOld(q){ // (before 12 Nov) primary placement of every part
  const out=new Set();
  q.parts.filter(p=>leaf(q,p)).forEach(p=>{const ts=effTags(q,p);const pri=ts.filter(t=>t.primary);(pri.length?pri:ts).forEach(t=>{
    if(t.cov==='removed') out.add('special:removed'); else if(t.cov==='no_match') out.add('special:no_match');
    else if(DM[t.id]) out.add('sub:'+DM[t.id].yl+'|'+DM[t.id].fa+'|'+(DM[t.id].sub||''));})});
  return out;
}
// owner 12 Nov ("Questions aren't showing in the bank until approved right?" -> "yeah do that"): the Bank shows approved
// questions only; the owner can switch unapproved ones back on (remembered per browser)
let BANKALL=(()=>{try{return localStorage.getItem('bankall')==='1'}catch(e){return false}})();
// owner 13 Nov: "is there a point in this showing if all questions are approvied?" The chip shows only when some questions are
// unapproved AND the viewer is an editor (isEditor(), the Teach | Curate check). Non-editors never see unapproved questions, whatever BANKALL says.
const bankAll=()=>BANKALL&&isEditor();
const inBank=q=>!q.dup_of&&(bankAll()||qState(q)==='approved');
function bankSwitch(){if(!isEditor())return'';const all=B.questions.filter(q=>!q.dup_of).length,ok=B.questions.filter(q=>!q.dup_of&&qState(q)==='approved').length;
  if(ok>=all)return'';
  return `<button class="bankall" data-bankall="1" aria-pressed="${BANKALL}" title="Unapproved questions are still being checked">${BANKALL?`Showing all ${all.toLocaleString()} · <u>approved only</u>`:`Approved only (${ok.toLocaleString()} of ${all.toLocaleString()}) · <u>include unapproved</u>`}</button>`}
function buildTopics(){
  const T={y12:new Map(),y11:new Map(),byKey:{}};
  DOTS.forEach(d=>{const m=d.yl===12?T.y12:T.y11;if(!m.has(d.fa))m.set(d.fa,new Map());const s=m.get(d.fa);const sk=d.sub||'';if(!s.has(sk))s.set(sk,{dps:[],qs:[]});s.get(sk).dps.push(d);T.byKey['sub:'+d.yl+'|'+d.fa+'|'+sk]=s.get(sk)});
  T.byKey['special:removed']={qs:[]};T.byKey['special:no_match']={qs:[]};
  B.questions.filter(inBank).forEach(q=>qPlaces(q).forEach(k=>T.byKey[k]?.qs.push(q)));
  TOPICS=T;
}
const faCount=subs=>new Set([...subs.values()].flatMap(s=>s.qs.map(q=>q.id))).size;
function navHTML(){
  const sec=(title,m,yl)=>`<h3>${title}</h3>`+[...m].map(([fa,subs])=>{
    const open=sel&&(sel.startsWith('sub:'+yl+'|'+fa+'|')||sel==='fa:'+yl+'|'+fa);
    return `<div class="fa${open?' open':''}" data-area="${esc(yl+'|'+fa)}"><button aria-expanded="${!!open}" data-fa="${esc(yl+'|'+fa)}"><span class="t">${esc(fa)}</span><span class="c">${faCount(subs)}</span></button>
      <div class="fold"><ul>${[...subs].map(([sk,s])=>{const key='sub:'+yl+'|'+fa+'|'+sk;return `<li><button data-sel="${esc(key)}" aria-current="${sel===key}"><span>${esc(sk||fa)}</span>${s.qs.length?`<span class="c">${s.qs.length}</span>`:'<span class="none">No questions yet</span>'}</button></li>`}).join('')}</ul></div></div>`}).join('');
  const sp=(key,label)=>`<div class="fa special"><button data-sel="${key}" aria-current="${sel===key}"><span>${label}</span><span class="c">${TOPICS.byKey[key].qs.length}</span></button></div>`;
  return '<div class="navtools"><button data-navall="open">Expand all</button><button data-navall="close">Collapse all</button></div>'+sec('Year 12',TOPICS.y12,12)+sec('Year 11',TOPICS.y11,11)+'<h3>Outside the 2024 syllabus</h3>'+sp('special:removed','Removed content')+(TOPICS.byKey['special:no_match'].qs.length?sp('special:no_match','No 2024 match'):'');
}
function dupLine(q){const c=B.questions.filter(x=>x.dup_of===q.id);const v=q.related.filter(x=>x.rel!=='duplicate').map(x=>B.questions.find(z=>z.id===x.q)).filter(Boolean);
  const same=o=>docLabel(B.docs[o.doc])===docLabel(B.docs[q.doc])&&String(o.number)===String(q.number);   // owner 12 Nov: "the also prose is redundant ... they're literally the same exam twice": a copy of the same paper filed twice says nothing
  const t=[...c.filter(o=>!same(o)).map(o=>`also in ${esc(docLabel(B.docs[o.doc]))} as Q${esc(o.number)}`),...v.map(o=>`similar to ${esc(docLabel(B.docs[o.doc]))} Q${esc(o.number)}`)];
  return t.length?`<div class="help" style="margin:-4px 0 8px">${t.join(' · ')}</div>`:''}
const qLeaves=q=>q.parts.filter(p=>leaf(q,p));
const qSkills=q=>[...new Set(qLeaves(q).flatMap(p=>p.skills||[]))];
const qYear=q=>Math.max(0,...qLeaves(q).flatMap(p=>effTags(q,p).map(t=>DM[t.id]?.yl||0)));
const qPri=q=>[...new Set(qLeaves(q).flatMap(p=>effTags(q,p).filter(t=>t.primary&&DM[t.id]).map(t=>t.id)))];
function cardHTML(q){
  const d=B.docs[q.doc]; const r=reviews['q'+q.id];
  return `<article class="card" data-q="${q.id}"><div class="hd"><span class="qn">${qid(q)}</span><span class="src">${esc(srcLine(q))}</span>
    ${q.type==='mcq'?'<span class="badge">Multiple choice</span>':''}${r?.status==='flagged'?'<span class="badge b-bad">flagged</span>':''}${q.old?'<span class="badge b-old">Old syllabus</span>':''}${q.std?'<span class="badge b-std">Standard course</span>':''}
    <span class="mk">${q.marks!=null?q.marks+(q.marks===1?' mark':' marks'):''}</span></div>${q.old?`<div class="oldsyl"><b>Old syllabus (2017 only):</b> ${tex(q.old)}</div>`:''}${q.std?`<div class="stdsyl"><b>Mathematics Standard, not Advanced:</b> ${esc(q.std)}</div>`:''}${dupLine(q)}${qBody(q,'bank')}
    <div class="cfoot">${q.type==='mcq'?`<button class="act ghost" data-reveal="${q.id}">${revealed.has(q.id)?'Hide answer':'Show answer'}</button>`:''}<span class="meta">${(sk=>sk.length?'Needs: '+sk.map(esc).join(' · '):'')(qSkills(q))}${qYear(q)?`${qSkills(q).length?' · ':''}Year ${qYear(q)}`:''}${(l=>l?((qSkills(q).length||qYear(q))?' · ':'')+l:'')(typeof qDifLabel==='function'?qDifLabel(q):'')}</span><button class="act addx" data-addx="${q.id}" aria-pressed="${xIn(q.id)}">${xIn(q.id)?'✓ In exam':'+ Add to exam'}</button><a class="act ghost edonly" href="#review/list/all" data-open="${q.id}">Open in Review</a></div></article>`;
}
// owner 12 Nov ("make the bank more usable and clean ... looks really dead" -> warm editorial; topic -> subheadings -> questions)
function subRows(subs,yl,fa,max){const rows=[...subs];const top=max||Math.max(1,...rows.map(([k,x])=>x.qs.length));
  return rows.map(([sk,x])=>`<button class="subrow${x.qs.length?'':' none'}" data-sel="${esc('sub:'+yl+'|'+fa+'|'+sk)}"><span class="nm">${esc(sk||fa)}</span><span class="bar"><i style="width:${Math.round(100*x.qs.length/top)}%"></i></span><span class="c">${x.qs.length||'–'}</span></button>`).join('')}
// owner 13 Nov ("holes everywhere"): each card spans as many 2px grid rows as its height, so short cards tuck under each other
function packCards(){$$('#list .facards').forEach(g=>{const kids=[...g.children];kids.forEach(c=>c.style.gridRowEnd='');
  kids.forEach(c=>{c.style.gridRowEnd='span '+Math.ceil((c.getBoundingClientRect().height+14)/2)})})}
addEventListener('resize',()=>{clearTimeout(window._pk);window._pk=setTimeout(()=>{if($('#list .facards'))packCards()},120)});
if(document.fonts)document.fonts.ready.then(()=>{if($('#list .facards'))packCards()});
function homeHTML(){
  const n=B.questions.filter(inBank).length, papers=new Set(B.questions.filter(inBank).map(q=>q.doc)).size;
  // owner 13 Nov: "an overview of the courses, how many questions in each topic and subtopics and be able to click in, most similar to
  // the original design, just holes everywhere tho" -> the original cards, packed without holes (packCards below)
  const cards=(m,yl)=>`<div class="facards">${[...m].map(([fa,subs])=>{const c=faCount(subs);
    // owner 13 Nov: "there's almost no point in being able to click on a topic ... should go straight to subtopic?" -> one subheading: the
    // header opens it; several: the header is a plain title (the subheadings below are the links)
    const only=subs.size===1?'sub:'+yl+'|'+fa+'|'+[...subs][0][0]:null;
    const head=`<b>${esc(fa)}</b><span class="n">${c}<small>questions</small></span>`;
    return `<article class="facard y${yl}">${only?`<button class="fah subrow" data-sel="${esc(only)}">${head}</button>`:`<div class="fah static">${head}</div>`}<div class="subrows">${subRows(subs,yl,fa)}</div></article>`}).join('')}</div>`;
  const sum=m=>[...m.values()].reduce((a,subs)=>a+faCount(subs),0);
  return `<div class="hero"><h1>Question bank</h1><p>Every question from past HSC papers and school trials, filed under the 2024 Mathematics Advanced syllabus. Pick a topic, or search above.</p>
    <div class="stats"><span class="stat"><b>${n.toLocaleString()}</b> questions</span><span class="stat"><b>${papers}</b> papers</span><span class="stat"><b>${sum(TOPICS.y12)}</b> Year 12</span><span class="stat"><b>${sum(TOPICS.y11)}</b> Year 11</span>${bankSwitch()}</div></div>
   <div class="yhead"><h2>Year 12</h2><span class="yb y12">Y12</span></div>${cards(TOPICS.y12,12)}
   <div class="yhead"><h2>Year 11</h2><span class="yb y11">Y11</span><span class="muted">assumed knowledge, may be examined</span></div>${cards(TOPICS.y11,11)}
   <div class="yhead"><h2>Outside the 2024 syllabus</h2></div><div class="facards">
     <article class="facard ys"><button class="fah" data-sel="special:removed"><b>Removed content</b><span class="n">${TOPICS.byKey['special:removed'].qs.length}<small>questions</small></span></button><div class="muted" style="font-size:13px">In past papers but not in the 2024 Advanced course (3D trigonometry, regression, Standard-course statistics).</div></article>
     ${TOPICS.byKey['special:no_match'].qs.length?`<article class="facard ys"><button class="fah" data-sel="special:no_match"><b>No 2024 match</b><span class="n">${TOPICS.byKey['special:no_match'].qs.length}</span></button></article>`:''}</div>`;
}
function faHTML(yl,fa){const subs=(yl==='12'?TOPICS.y12:TOPICS.y11).get(fa);if(!subs)return homeHTML();const c=faCount(subs);
  return `<div class="crumbs"><button data-home="1">All topics</button><span>›</span><span>Year ${yl}</span></div>
    <div class="listhead"><h2>${esc(fa)}</h2><span class="crumb">${c} question${c===1?'':'s'} · ${subs.size} subheading${subs.size===1?'':'s'}</span></div>
    <div class="subgrid">${[...subs].map(([sk,x])=>`<button class="subcard y${yl}${x.qs.length?'':' none'}" data-sel="${esc('sub:'+yl+'|'+fa+'|'+sk)}"><b>${esc(sk||fa)}</b><span class="meta">${x.qs.length?x.qs.length+' question'+(x.qs.length===1?'':'s'):'No questions yet'} · ${x.dps.length} dot point${x.dps.length===1?'':'s'}</span></button>`).join('')}</div>`}
let BF={type:'all',src:'all',fig:'all',band:'all',wm:'all'};try{BF=Object.assign(BF,JSON.parse(localStorage.getItem('bf')||'{}'))}catch(e){}
const bfOK=q=>(BF.type==='all'||(BF.type==='mcq')===(q.type==='mcq'))&&(BF.src==='all'||(BF.src==='hsc')===(B.docs[q.doc]?.task_type==='hsc'))&&(BF.fig==='all'||(figKeys(q).all.length>0)===(BF.fig==='yes'))&&(typeof qDifOK!=='function'||qDifOK(q,BF));   // owner 14 Nov: difficulty filters (exam builder stage 2)
let BSEL={key:null,skill:null,dp:null};
// owner 13 Nov: "in the bank, the pills at the top, make them animated": each filter group (Type, Source, Diagram, Band, Kind)
// has one highlight that slides to the chosen option. The list is redrawn on every click, so the last position of each group's
// highlight is kept in BFPOS and the new highlight starts there, then slides. Reduced motion: it just appears.
const BFPOS={};
function bfPills(){$$('#list .bfilters .grp[data-bfg]').forEach(g=>{const k=g.dataset.bfg,p=g.querySelector('.bfpill'),b=g.querySelector('button[aria-pressed="true"]');if(!p||!b)return;
  const to={x:b.offsetLeft,w:b.offsetWidth,y:b.offsetTop,h:b.offsetHeight},from=BFPOS[k];BFPOS[k]=to;
  const set=v=>{p.style.transform=`translate(${v.x}px,${v.y}px)`;p.style.width=v.w+'px';p.style.height=v.h+'px'};
  if(!from||(from.x===to.x&&from.w===to.w)||matchMedia('(prefers-reduced-motion: reduce)').matches){p.style.transition='none';set(to);p.classList.add('on');return}
  p.style.transition='none';set(from);p.classList.add('on');void p.offsetWidth;p.style.transition='';set(to)})}
function bfHTML(all,shown,narrow){const g=(k,lab,opts)=>`<span class="grp" data-bfg="${k}"><i class="bfpill" aria-hidden="true"></i><span>${lab}</span>${opts.map(([v,l])=>`<button data-bf="${k}:${v}" aria-pressed="${BF[k]===v}">${l}</button>`).join('')}</span>`;
  return `<div class="bfilters">${g('type','Type',[['all','All'],['mcq','Multiple choice'],['written','Written']])}${g('src','Source',[['all','All'],['hsc','HSC'],['school','Trials & school']])}${g('fig','Diagram',[['all','Any'],['yes','With'],['no','Without']])}${g('band','Band',[['all','All'],['lo','2–3'],['mid','4'],['hi','5–6']])}${g('wm','Kind',[['all','All'],['uf','Fluency'],['pr','Problem solving'],['mix','Mixed']])}<span class="shown">${shown} of ${all}</span>${narrow?`<div class="narrow">${narrow}</div>`:''}</div>`}
function renderBank(){
  if(!TOPICS) buildTopics();
  syncNav();
  $('#bankView').classList.toggle('homemode',!search&&(!sel||sel.startsWith('fa:')));
  if($('#nav').offsetParent&&$('#nav .navpill')?.style.opacity!=='1')placePill(true);
  requestAnimationFrame(()=>{if(typeof setHdr==='function')setHdr()});
  if(!search&&sel&&sel.startsWith('fa:')){const [yl,fa]=sel.slice(3).split('|');$('#list').innerHTML=faHTML(yl,fa);return}
  let qs=null, head='';
  if(search){
    const s=search.toLowerCase();
    qs=B.questions.filter(inBank).filter(q=>[qid(q),qid(q).replace(' ',''),String(q.id),srcLine(q),q.stem,...q.parts.map(p=>p.latex),...q.parts.flatMap(p=>(p.t24||[]).map(t=>(DM[t.id]?.sub||'')+' '+(DM[t.id]?.text||'')+' '+(DM[t.id]?.short||'')+' '+(p.free||[]).join(' '))),...q.parts.flatMap(p=>[...(p.skills||[]),...(p.can_use||[])])].join(' ').toLowerCase().includes(s)).slice(0,60);
    head=`<div class="listhead"><h2>Search: “${esc(search)}”</h2><span class="crumb">${qs.length===60?'first 60 matches':qs.length+(qs.length===1?' match':' matches')}</span></div>`;
  } else if(sel&&TOPICS.byKey[sel]){
    const t=TOPICS.byKey[sel]; qs=t.qs.slice().sort((a,b)=>(B.docs[b.doc].label.localeCompare(B.docs[a.doc].label))||(parseInt(a.number)-parseInt(b.number)));
    let title,crumb='',sibs='';
    if(sel.startsWith('sub:')){const [yl,fa,sk]=sel.slice(4).split('|');title=sk||fa;crumb='';t.yl=yl;t.fa=fa;const subs=(yl==='12'?TOPICS.y12:TOPICS.y11).get(fa);if(subs.size>1)sibs=`<div class="sibs">${[...subs].map(([k2,s2])=>{const key='sub:'+yl+'|'+fa+'|'+k2;return `<button class="sib" data-sel="${esc(key)}" aria-current="${key===sel}">${esc(k2||fa)}<span class="c">${s2.qs.length}</span></button>`}).join('')}</div>`}
    else title=sel==='special:removed'?'Removed content':'No 2024 match';
    if(BSEL.key!==sel)BSEL={key:sel,skill:null,dp:null};
    const all=qs.length, base=qs.filter(bfOK);
    const skc={};base.forEach(q=>qSkills(q).forEach(k=>skc[k]=(skc[k]||0)+1));
    const dpc={};base.forEach(q=>qPri(q).forEach(k=>{if((t.dps||[]).some(d=>d.id===k))dpc[k]=(dpc[k]||0)+1}));
    qs=base.filter(q=>(!BSEL.skill||qSkills(q).includes(BSEL.skill))&&(!BSEL.dp||qPri(q).includes(BSEL.dp)));
    const sks=Object.entries(skc).sort((a,b)=>b[1]-a[1]);
    var narrow=(Object.keys(dpc).length>1?`<div class="fl"><span>Dot point</span>${Object.entries(dpc).sort((a,b)=>a[0].localeCompare(b[0])).map(([k,n])=>`<button data-bsel="dp:${k}" aria-pressed="${BSEL.dp===k}" title="${esc(DM[k]?.text||'')}">${esc(DM[k]?.short||k)} <span class="c">${n}</span></button>`).join('')}</div>`:'')+
      '';   // owner 12 Nov: skill bubbles removed ("i dont feel like the skill bubbles work"): a question needs several skills, so they don't split a topic; skills are searchable instead
    head=`<div class="crumbs"><button data-home="1">All topics</button>${t.fa?`<span>›</span><span>${esc(t.fa)}</span>`:''}</div><div class="listhead"><h2>${esc(title)}</h2><span class="crumb">${all} question${all===1?'':'s'}</span>${bankSwitch()}</div>${sibs}${all?bfHTML(all,qs.length,typeof narrow==='string'?narrow:''):''}
      ${t.dps?`<details class="dps"><summary>The ${t.dps.length} syllabus dot point${t.dps.length===1?'':'s'} in this subheading <span class="muted">· number of questions that use each one (a question can use several)</span></summary><ol>${t.dps.map(d=>{const n=t.qs.filter(q=>q.parts.some(p=>effTags(q,p).some(x=>x.id===d.id))).length;return `<li${n?'':' class="zero"'}><code>${d.id}</code>${tex(d.tex||d.text)} <span class="muted">(${n})</span></li>`}).join('')}</ol></details>`:''}`;
    if(!qs.length) head+='<div class="empty">No questions yet. This content is new or rarely examined in the papers loaded so far.</div>';
  }
  if(!qs){ $('#list').innerHTML=homeHTML(); packCards(); return }
  if(sel&&!search&&!qs.length&&TOPICS.byKey[sel]?.qs.length) head+='<div class="empty">No questions match these filters.</div>';
  // owner 13 Nov ("there's some lag when clicking between subtopics"): a long list (140 cards) took ~170 ms to build in one go and froze
  // the pill. Now the first 8 cards go in at once and the rest follow in small batches between frames.
  const L=$('#list');const gen=(L._gen=(L._gen||0)+1);
  L.innerHTML=`<div class="lhead">${head}</div><div class="cards"></div>`;typeset(L.querySelector('.lhead'));   // owner 13 Nov: the dot-point list in the header lost its maths when cards went lazyL.classList.remove('enter');void L.offsetWidth;L.classList.add('enter');
  const box=L.querySelector('.cards');let i=0;
  const batch=n=>{if(L._gen!==gen)return;const part=qs.slice(i,i+n);i+=part.length;const tmp=document.createElement('div');tmp.innerHTML=part.map(cardHTML).join('');
    const els=[...tmp.children];els.forEach(c=>{box.appendChild(c);const q=B.questions.find(x=>x.id===+c.dataset.q);hydrate(c,q,'bank')});
    els.forEach(c=>TSIO.observe(c));if(i<qs.length)setTimeout(()=>batch(12),16)};
  batch(8);bfPills();
}
// owner 13 Nov: "smoother animations ... opening/closing should be smooth, clicking between subtopics should be a smooth pill movement,
// add anything else ... people will be using this a lot". The tree is rendered once and then only updated in place (open state,
// current item), so CSS can animate: folds use grid-rows 0fr->1fr, the highlight is one pill that glides to the current item.
const RM=matchMedia('(prefers-reduced-motion: reduce)');
function syncNav(){const nav=$('#nav');const html=navHTML();const sig=html.replace(/ open"|aria-current="(true|false)"|aria-expanded="(true|false)"/g,'');
  if(nav.dataset.sig!==sig){const was=[...nav.querySelectorAll('.fa.open[data-area]')].map(f=>f.dataset.area);nav.innerHTML=html+'<span class="navpill" aria-hidden="true"></span>';nav.dataset.sig=sig;
    was.forEach(k=>{const f=nav.querySelector(`.fa[data-area="${CSS.escape(k)}"]`);if(f){f.classList.add('open');f.querySelector('button[data-fa]').setAttribute('aria-expanded','true')}});placePill(true);return}
  nav.querySelectorAll('[data-sel]').forEach(b=>b.setAttribute('aria-current',String(b.dataset.sel===sel)));
  // owner 13 Nov: "when moving to another subtopic in another topic, it closes the current one, makes it look forced" -> never auto-close;
  // only open the area you moved into. Areas close when you close them.
  nav.querySelectorAll('.fa[data-area]').forEach(f=>{const k=f.dataset.area;if(sel&&(sel.startsWith('sub:'+k+'|')||sel==='fa:'+k)&&!f.classList.contains('open')){
    f.classList.add('open');f.querySelector('button[data-fa]').setAttribute('aria-expanded','true')}});
  placePill(false)}
function pillEl(root){const b=root.querySelector('[data-sel][aria-current="true"]');if(!b)return null;
  const fa=b.closest('.fa[data-area]');return fa&&!fa.classList.contains('open')?fa.querySelector('button[data-fa]'):b}   // closed area: park on its title
// owner 13 Nov (lag): MathJax was the long task (hundreds of ms per batch). Cards are typeset only when they come near the screen.
const TSIO=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){TSIO.unobserve(e.target);typeset(e.target)}}),{rootMargin:'800px 0px'});
function placePill(jump){const nav=$('#nav'),pill=nav.querySelector('.navpill');if(!pill)return;
  const live=pillEl(nav);if(!live||!nav.offsetParent){pill.style.opacity=0;return}   // hidden list (home page): next placement jumps in place
  // where will it END? measure a hidden copy of the list with the fold animation switched off (the real folds keep animating)
  const c=nav.cloneNode(true);c.removeAttribute('id');c.classList.add('nofx');
  Object.assign(c.style,{position:'absolute',visibility:'hidden',pointerEvents:'none',left:'-9999px',top:'0',width:nav.getBoundingClientRect().width+'px',boxSizing:getComputedStyle(nav).boxSizing,maxHeight:'none',overflow:'scroll'});   // same width as the real list so names wrap the same (owner 13 Nov: pill landed a row off)
  document.body.appendChild(c);const el=pillEl(c),cr=c.getBoundingClientRect(),r=el.getBoundingClientRect(),n=nav.getBoundingClientRect(),lr=live.getBoundingClientRect();
  const t={y:r.top-cr.top,x:lr.left-n.left,w:lr.width,h:lr.height};c.remove();   // size always from the real item (owner 13 Nov: two-line subtopic got a one-line pill)
  nav.querySelectorAll('.fa.parked').forEach(f=>f.classList.remove('parked'));if(live.matches('button[data-fa]'))live.closest('.fa').classList.add('parked');
  const instant=jump||RM.matches||pill.style.opacity!=='1';
  if(instant)pill.style.transition='none';
  pill.style.opacity=1;pill.style.transform=`translate(${t.x}px,${t.y}px)`;pill.style.width=t.w+'px';pill.style.height=t.h+'px';
  if(instant){void pill.offsetWidth;pill.style.transition=''}
  clearTimeout(_pillFix);_pillFix=setTimeout(()=>{   // once the folds have settled, snap to the real position if the prediction was off
    const a=live.getBoundingClientRect(),m=nav.getBoundingClientRect(),y=a.top-m.top+nav.scrollTop,x=a.left-m.left;
    if(Math.abs(y-t.y)>1||Math.abs(a.width-t.w)>1||Math.abs(a.height-t.h)>1){pill.style.transform=`translate(${x}px,${y}px)`;pill.style.width=a.width+'px';pill.style.height=a.height+'px'}
    if(a.top<m.top||a.bottom>m.bottom)live.scrollIntoView({block:'nearest',behavior:RM.matches?'auto':'smooth'})},340)}
let _pillFix=0;
addEventListener('resize',()=>placePill(true));
// owner 13 Nov: "animation going between all topics and a subtopic. It's currently just snapping to it".
// Opening a topic slides the list forward and the clicked card grows into the topic heading; All topics slides back and the
// heading shrinks into its card. Uses the browser's view transitions; without them (older Safari) it snaps as before.
// Reduced motion: a short fade. Names are bk-* so nothing else on the page is affected (CODE_HEALTH rule 2).
// owner 13 Nov: "theres now some lag going between subtopics on the side bar": a view transition freezes the whole page
// (sidebar pill included) while it snapshots and re-renders the list, which felt like lag. Sidebar jumps between subtopics
// now skip it and just fade the new list in; it runs on the compositor and never blocks the sidebar.
function bankFade(){const l=$('#list');if(!l||matchMedia('(prefers-reduced-motion: reduce)').matches)return;l.classList.remove('bk-swap');void l.offsetWidth;l.classList.add('bk-swap')}
function bankGo(dir,src,fn){
  const R=document.documentElement,reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!document.startViewTransition||view!=='bank'){fn();return}
  const prev=sel;R.dataset.bkdir=reduce?'fade':dir;
  const hero=reduce?null:(src||(dir==='back'?$('#list .listhead h2'):null));if(hero)hero.style.viewTransitionName='bk-hero';
  let landed=null;
  const t=document.startViewTransition(()=>{if(hero)hero.style.viewTransitionName='';fn();
    if(reduce)return;
    if(dir==='fwd')landed=$('#list .listhead h2');
    else if(dir==='back'&&prev){const k=CSS.escape(prev),fa=prev.startsWith('fa:')?CSS.escape(prev.slice(3)):null;
      landed=$(`#list [data-sel="${k}"]`)||(fa&&$(`#list [data-fa="${fa}"]`))}
    if(landed)landed.style.viewTransitionName='bk-hero'});
  t.finished.finally(()=>{if(landed)landed.style.viewTransitionName='';delete R.dataset.bkdir});
}
$('#nav').addEventListener('click',e=>{
  // owner 13 Nov: "a nice open and close all somewhere for efficiency"
  const all=e.target.closest('[data-navall]'); if(all){const o=all.dataset.navall==='open';$$('#nav .fa[data-area]').forEach(f=>{f.classList.toggle('open',o);f.querySelector('button[data-fa]').setAttribute('aria-expanded',String(o))});placePill(false);return}
  const fa=e.target.closest('button[data-fa]'); if(fa){const f=fa.closest('.fa');const o=!f.classList.contains('open');f.classList.toggle('open',o);fa.setAttribute('aria-expanded',String(o));placePill(false);return}
  const b=e.target.closest('button[data-sel]'); if(b){sel=b.dataset.sel;search='';$('#q').value='';save('sel',sel);syncNav();requestAnimationFrame(()=>setTimeout(()=>{renderBank();window.scrollTo({top:0});bankFade()},0))}   // nav moves first, list follows a frame later
});
$('#list').addEventListener('click',e=>{
  const ba=e.target.closest('[data-bankall]'); if(ba&&isEditor()){BANKALL=!BANKALL;try{localStorage.setItem('bankall',BANKALL?'1':'0')}catch(_){}TOPICS=null;renderBank();return}
  const bs=e.target.closest('[data-bsel]'); if(bs){const i=bs.dataset.bsel.indexOf(':'),k=bs.dataset.bsel.slice(0,i),v=bs.dataset.bsel.slice(i+1);BSEL[k]=BSEL[k]===v?null:v;renderBank();return}
  const bf=e.target.closest('[data-bf]'); if(bf){const [k,v]=bf.dataset.bf.split(':');BF[k]=v;try{localStorage.setItem('bf',JSON.stringify(BF))}catch(_){}renderBank();return}
  const hm=e.target.closest('[data-home]'); if(hm){bankGo('back',null,()=>{sel=null;save('sel','');renderBank();window.scrollTo({top:0})});return}
  const t=e.target.closest('[data-fa],.subrow[data-sel],.subcard[data-sel],.fah[data-sel]');
  if(t){if(t.classList.contains('none'))return; const prevSel=sel; sel=t.dataset.sel||('fa:'+t.dataset.fa);
    const go=sel;sel=prevSel;bankGo('fwd',t.matches('.fah')?null:t,()=>{sel=go;save('sel',sel);renderBank();window.scrollTo({top:0})});return}
  const sb=e.target.closest('.sib'); if(sb){sel=sb.dataset.sel;save('sel',sel);renderBank();bankFade();return}
  if(e.target.id==='home'){bankGo('back',null,()=>{sel=null;save('sel','');renderBank()});return}
  const rv=e.target.closest('[data-reveal]'); if(rv){const id=+rv.dataset.reveal;revealed.has(id)?revealed.delete(id):revealed.add(id);const c=rv.closest('.card');const q=B.questions.find(x=>x.id===id);c.outerHTML=cardHTML(q);const nc=$(`.card[data-q="${id}"]`);hydrate(nc,q,'bank');typeset(nc);return}
  const op=e.target.closest('[data-open]'); if(op){rfilter='all';rstatus='any';rdoc='';$('#docF').value='';pendingOpen=+op.dataset.open}   // owner 13 Nov: opens in Review's "All questions" list (#review/list/all)
});
let st; $('#q').addEventListener('input',e=>{clearTimeout(st);st=setTimeout(()=>{search=e.target.value.trim();renderBank()},250)});

