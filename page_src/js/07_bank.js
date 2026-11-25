/* ---------- topic index ---------- */
let TOPICS=null;
const CNT_NOTE={bank:'Counts every question with a part on the topic, so one question can count under several topics.',
  pick:'Counts each question once, under its main topic, and only if the topics its skills need are learnt. So they can be lower than the Bank\'s.',
  setup:'Counts each question once, under its main topic, using the settings on this page (papers, approval, saved exams, difficulty) and only if the topics its skills need are learnt.'};
// owner 12 Nov ("a questions parts shouldn't be split if they're related" -> "Yeah lets do that"): ONE topic home per
// question = the subheading carrying the most marks across its parts' main dot points. Other parts' topics become gates only.
// owner 24 Nov (Bank cards like "Critical path analysis · Critical path analysis 12"): "we should display the level under here, it does
//   nothing like this. For ANnuities it should be Future value and present value. Since PV is taught after, any question which has both goes
//   into PV." A topic the syllabus gives no sub-level is split by its dot points (their short names); a topic in SUB_SPLIT gets the owner's
//   own sub-levels instead. Which annuity question is which comes from its text at build time (tools/bank_split.py, q.st).
// owner 25 Nov: "Some of the std topics are overkill. We need to simplify it. Begin with Trig. The ones that should show are below. Subdot
//   points can be stuff they can choose inside one. Trigonometry * Right angled trigonometry * Sine rule * Finding an angle * Finding a side
//   * Cosine rule * Finding an angle * Finding a side * Area of a triangle * Bearings * Radial surveys. Start with this first, lets make sure
//   that allw roks." His answers: 'Practical problems with Pythagoras and trigonometry' (S2-12-071) -> "Right angled trig"; the sine rule
//   obtuse-angle dot point (S2-12-065) -> one choice "Finding an angle" (with S2-12-064).
// A sub-level is a list of dot points (the Bank's "Dot point" pills: one per dot point) or {choice: dot points} (the owner's own pills; a
// pill covers all its dot points; one choice is no choice, so no pills). Sub-levels show in the order written here.
const SUB_SPLIT={Annuities:{'Future value':['S2-12-055','S2-12-056','S2-12-057','S2-12-059','S2-12-060'],'Present value':['S2-12-058','S2-12-061']},
  Trigonometry:{'Right angled trigonometry':{'Right angled trigonometry':['S2-12-062','S2-12-071']},
    'Sine rule':{'Finding an angle':['S2-12-064','S2-12-065'],'Finding a side':['S2-12-063']},
    'Cosine rule':{'Finding an angle':['S2-12-067'],'Finding a side':['S2-12-066']},
    'Area of a triangle':['S2-12-068'],'Bearings':['S2-12-069'],'Radial surveys':['S2-12-070']}};
function subLevels(ds){const by={};ds.forEach(d=>(by[d.yl+'|'+d.fa]=by[d.yl+'|'+d.fa]||[]).push(d));
  const ord=new Map();Object.entries(by).forEach(([k0,xs])=>{if(xs.some(d=>d.sub))return;const sp=SUB_SPLIT[xs[0].fa],ks=sp?Object.keys(sp):[];
    xs.forEach(d=>{d.sub=sp?(ks.find(k=>[sp[k]].flatMap(v=>Array.isArray(v)?v:Object.values(v).flat()).includes(d.id))||ks[0]):(d.short||d.text);d.subAuto=1});
    // the owner's order: a split topic's dot points are listed sub-level by sub-level (the sidebar and the exam builders take the order of DOTS)
    if(sp)ord.set(k0,xs.slice().sort((a,b)=>ks.indexOf(a.sub)-ks.indexOf(b.sub)))});
  return ds.flatMap(d=>{const k=d.yl+'|'+d.fa,o=ord.get(k);return !o?[d]:by[k][0]===d?o:[]})}
// owner 25 Nov (Trigonometry simplified): exams and Already learnt lists saved before keep the rows they ticked. A topic key stored while a
// split topic had one row per dot point ('sub:<yl>|<fa>|<the dot point's short name>') reads as the dot point's new sub-level; duplicates
// collapse to one. Derived from SUB_SPLIT, so it covers the next topics the owner simplifies (23_exam_auto.js xa and XG.set call it)
QG.topicKeys=ks=>{if(!DOTS)return ks;if(!QG._ska){QG._ska=new Map();DOTS.forEach(d=>{if(!d.subAuto||!SUB_SPLIT[d.fa])return;const o='sub:'+d.yl+'|'+d.fa+'|'+(d.short||d.text);if(o!=='sub:'+d.yl+'|'+d.fa+'|'+d.sub)QG._ska.set(o,'sub:'+d.yl+'|'+d.fa+'|'+d.sub)})}
  return [...new Set(ks.map(k=>QG._ska.get(k)||k))]};
// a home in one of these new rows counts as its topic in Review: two taggers who chose different dot points of the same topic still agree
// (before 24 Nov the topic had one row, so they never needed a decision; the new rows must not create review work)
const homeTopic=k=>{if(!k||!k.startsWith('sub:'))return k;const [yl,fa]=k.slice(4).split('|');return DOTS.some(d=>d.fa===fa&&String(d.yl)===yl&&d.subAuto)?'sub:'+yl+'|'+fa+'|':k};
const subKey=id=>id==='removed'?'special:removed':id==='no_match'?'special:no_match':DM[id]?'sub:'+DM[id].yl+'|'+DM[id].fa+'|'+(DM[id].sub||''):null;
function partPri(q,p,side){if(side==='res'){const v=reviews['q'+q.id]?.tagres?.[p.id];if(v==='A'||v==='B')side=v;else if(v?.id)return [v.id];else if(v?.cov)return [v.cov];else side='cur'}
  if(side!=='cur'&&p.tagd){const x=p.tagd[side];return x.removed?['removed']:x.dp.filter(d=>d[1]==='primary').map(d=>d[0])}
  return effTags(q,p).filter(t=>t.primary).map(t=>t.cov==='removed'||t.cov==='no_match'?t.cov:t.id)}
// tie on marks -> the topic of the LATER part wins (spec: "on a tie, the final answer decides"; owner 12 Nov on QID 1221:
// "both were wrong here, this should've been in integration")
// side 'main': each part's dot points as the Bank files them (partMain); 'A' / 'B' / 'res' / 'cur' as partPri
// Year 12 if any tag of any part is (q.y12, set by tools/bank_split.py from every tag; the slim index keeps main tags only) or a
// Review tag change made it so (effTags main tags are in the index)
const qY12=q=>!!q.y12||q.parts.some(p=>effTags(q,p).some(t=>DM[t.id]?.yl===12));
function homeOf(q,side){const pri=p=>side==='main'?partMain(q,p):partPri(q,p,side),w=new Map(),last=new Map();q.parts.filter(p=>leaf(q,p)).forEach((p,pi)=>{const ids=pri(p),m=(p.marks||1)/(ids.length||1);ids.forEach(i=>{const k=subKey(i);if(k){w.set(k,(w.get(k)||0)+m);last.set(k,pi)}})});
  // owner 12 Nov: "show the derivative, hence integrate" -> integration, whatever the marks. The test reads the part text, so it
  // runs once in tools/bank_split.py (q.hx); the index has no text (Fix 1, owner 14 Nov: "Ok we should run Fix 1 and 2")
  const lv=q.parts.filter(p=>leaf(q,p)),lp=lv[lv.length-1];
  // owner 17 Nov (2023 HSC Q32, an areas question filed under Y11 Algebraic techniques by a 3-3 tie): "Y12 questions can NEVER show
  // in Y11 bank, likewise vice versa. If it has ANY y12 parts, it goes straight to Y12." A question with any Year 12 tag (main or
  // also, any part) is filed under a Year 12 topic only; the marks and the tie rule decide among its Year 12 topics.
  // main tags + the Year 12 "also" tags kept in the index (y12a): the same before and after the details file lands
  const all=p=>side==='A'||side==='B'?[...(p.tagd?.[side]?.dp||[]).filter(d=>d[1]==='primary').map(d=>d[0]),...(p.tagd?.[side]?.y12a||[])]
    :[...effTags(q,p).filter(t=>t.primary).map(t=>t.id),...(p.y12a||[])];
  const y12=qY12(q),yr=k=>k.startsWith('sub:')?+k.slice(4).split('|')[0]:0;
  if(y12){[...w.keys()].forEach(k=>{if(yr(k)===11)w.delete(k)});
    if(![...w.keys()].some(k=>yr(k)===12))lv.forEach((p,pi)=>{const ids=all(p).filter(i=>DM[i]?.yl===12),m=(p.marks||1)/(ids.length||1);ids.forEach(i=>{const k=subKey(i);if(k){w.set(k,(w.get(k)||0)+m);last.set(k,pi)}})})}
  if(q.hx){const k=subKey(pri(lp)[0]);if(k&&(!y12||yr(k)===12))return k}
  if(w.size>1&&w.has('special:removed'))w.delete('special:removed');   // owner 12 Nov: a removed 3D part never decides the home when other parts are in the course
  let best=null,bv=-1,bp=-1;w.forEach((v,k)=>{const lp=last.get(k);if(v>bv+1e-9||(Math.abs(v-bv)<1e-9&&lp>bp)){bv=v;best=k;bp=lp}});return best}
function homeNeed(q){return !q.dup_of&&q.parts.some(p=>p.tagd)&&homeTopic(homeOf(q,'A'))!==homeTopic(homeOf(q,'B'))}
function qHome(q){const h=qHome0(q);if(q.st&&h&&h.startsWith('sub:')){const [yl,fa]=h.slice(4).split('|');if(SUB_SPLIT[fa]?.[q.st])return 'sub:'+yl+'|'+fa+'|'+q.st}return h}   // owner 24 Nov: an annuity question with PV in it is filed under Present value
function qHome0(q){const r=reviews['q'+q.id]?.home;
  // the year rule above holds for a home picked by hand too: a Year 12 question never files under a Year 11 dot point, nor the reverse
  if(r?.id&&DM[r.id]&&qY12(q)!==(DM[r.id].yl===12))return homeOf(q,'main');
  if(r?.id)return subKey(r.id);if(r?.cov)return subKey(r.cov);return homeOf(q,'main')}
// the side Review settled for the question: its home pick (A or B), else the per-part picks once they are all made, else the current tags
const homeSide=q=>{const r=reviews['q'+q.id]?.home;return r==='A'||r==='B'?r:partsDone(q)?'res':'cur'};
// a part's main dot points as the Bank files it (the ones qHome counts). owner 17 Nov (Reports: "So how do we actually change the
// reported questions?"): a part's own tag change (Review's Change tag, or a report's Apply suggestion: reviews tag_edits) is the
// newest call on that part, so it wins over the side settled before. The Reports card and the paper's ⓘ show these, not the raw tags.
const partMain=(q,p)=>partPri(q,p,reviews['q'+q.id]?.tag_edits?.[p.id]?'cur':homeSide(q));
// picks made per part before the switch to one home per question (5 parts, 12 Nov) still count
function partsDone(q){const t=reviews['q'+q.id]?.tagres;return !!t&&q.parts.filter(tagNeed).every(p=>t[p.id])}
function homeLabel(k){if(!k)return 'none';if(k==='special:removed')return 'Removed from syllabus';if(k==='special:no_match')return 'No dot point fits';if(k==='special:std')return 'Mathematics Standard';const [yl,fa,sb]=k.slice(4).split('|');return `<span class="yb y${yl}">Y${yl}</span> ${esc(fa)}${sb?' › <b>'+esc(sb)+'</b>':''}`}
function qPlaces(q){ // owner 12 Nov: one topic home per question
  // owner 17 Nov (QID 1633, a Standard bivariate data question filed under Y11 Constructing and using functions): "Also found an
  // out of course question in Y11". A question marked Mathematics Standard (q.std) is never filed under an Advanced topic: it sits
  // in the Bank's "Mathematics Standard" group, as the exam builders already leave it out (23_exam_auto.js xaHomes)
  if(q.std)return new Set(['special:std']);
  const h=qHome(q); return new Set(h?[h]:[]);
}
// owner 25 Nov ("Besides that, yes action all these things"), relaying the checker: "The Bank opens on Mathematics Standard while Advanced
// is selected. Standard sits under "Outside the 2024 syllabus", so Advanced users land on the wrong topic." The Bank reopens on the topic
// saved in this browser only when it is one of the course's own topics; a group outside the syllabus (Removed content, Mathematics
// Standard, No 2024 match) or a topic of the other course opens on the course's first topic that has questions instead (Year 12 first,
// in the sidebar's order). Nothing saved: the All topics overview, as before (owner 13 Nov, "Bank home").
function bankStart(k){if(!k)return null;const key=d=>'sub:'+d.yl+'|'+d.fa+'|'+(d.sub||'');
  if(DOTS.some(d=>key(d)===k||'fa:'+d.yl+'|'+d.fa===k))return k;
  const homes=new Set(B.questions.filter(q=>!q.dup_of).flatMap(q=>[...qPlaces(q)]));
  const d=[...DOTS.filter(d=>d.yl===12),...DOTS.filter(d=>d.yl!==12)].find(d=>homes.has(key(d)));
  return d?key(d):null}
// owner 12 Nov ("Questions aren't showing in the bank until approved right?" -> "yeah do that"): the Bank shows approved
// questions only; the owner can switch unapproved ones back on (remembered per browser)
let BANKALL=load('bankall')==='1';
// owner 13 Nov: "is there a point in this showing if all questions are approvied?" The chip shows only when some questions are
// unapproved AND the viewer is an editor (isEditor(), the Teach | Curate check). Non-editors never see unapproved questions, whatever BANKALL says.
const bankAll=()=>BANKALL&&isEditor();
// owner 17 Nov: "When a question is reported, it needs to be logged somewhere right? and disappear from the bank." A question with a
// live report (open, or sent to Claude and not approved again: REP.hides, 27_reports.js) is out of the Bank whatever the switch says,
// and out of every exam picker (24_exams exBase, 23_exam_auto xaSwap). REP is read guarded: its script block may not have run yet.
const repHidden=q=>typeof REP==='object'&&REP.hides(q);
const inBank=q=>!q.dup_of&&!repHidden(q)&&(bankAll()||qState(q)==='approved');
// owner 13 Nov: "so can we sync the number on the bank and the processes pls": the Bank hero and Processes › Import history
// both count from here, so the two can never disagree. A paper filed twice is hidden whole by build_bank.py.
function bankStats(){const qs=B.questions.filter(inBank);return {questions:qs.length,papers:new Set(qs.map(q=>q.doc)).size}}
function bankSwitch(){if(!isEditor())return'';const all=B.questions.filter(q=>!q.dup_of).length,ok=B.questions.filter(q=>!q.dup_of&&qState(q)==='approved').length;
  if(ok>=all)return'';
  return `<button class="bankall" data-bankall="1" aria-pressed="${BANKALL}" title="Unapproved questions are still being checked">${BANKALL?`Showing all ${all.toLocaleString()} · <u>approved only</u>`:`Approved only (${ok.toLocaleString()} of ${all.toLocaleString()}) · <u>include unapproved</u>`}</button>`}
function buildTopics(){
  const T={y12:new Map(),y11:new Map(),byKey:{}};
  DOTS.forEach(d=>{const m=d.yl===12?T.y12:T.y11;if(!m.has(d.fa))m.set(d.fa,new Map());const s=m.get(d.fa);const sk=d.sub||'';if(!s.has(sk))s.set(sk,{dps:[],qs:[]});s.get(sk).dps.push(d);T.byKey['sub:'+d.yl+'|'+d.fa+'|'+sk]=s.get(sk)});
  T.byKey['special:removed']={qs:[]};T.byKey['special:no_match']={qs:[]};T.byKey['special:std']={qs:[]};
  B.questions.filter(inBank).forEach(q=>qPlaces(q).forEach(k=>T.byKey[k]?.qs.push(q)));
  TOPICS=T;
}
const faCount=subs=>new Set([...subs.values()].flatMap(s=>s.qs.map(q=>q.id))).size;
// owner 25 Nov, relaying the checker: "The sidebar also keeps the old topic highlighted while you search." While a search is shown no
// topic is current, so the sidebar's highlight (and its pill) steps aside; clearing the search brings it back
const navSel=()=>search?null:sel;
function navHTML(){const cur=navSel();
  const sec=(title,m,yl)=>`<h3>${title}</h3>`+[...m].map(([fa,subs])=>{
    const open=sel&&(sel.startsWith('sub:'+yl+'|'+fa+'|')||sel==='fa:'+yl+'|'+fa);
    return `<div class="fa${open?' open':''}" data-area="${esc(yl+'|'+fa)}"><button aria-expanded="${!!open}" data-fa="${esc(yl+'|'+fa)}"><span class="t">${esc(fa)}</span><span class="c">${faCount(subs)}</span></button>
      <div class="fold"><ul>${[...subs].map(([sk,s])=>{const key='sub:'+yl+'|'+fa+'|'+sk;return `<li><button data-sel="${esc(key)}" aria-current="${cur===key}"><span>${esc(sk||fa)}</span>${s.qs.length?`<span class="c">${s.qs.length}</span>`:'<span class="none">No questions yet</span>'}</button></li>`}).join('')}</ul></div></div>`}).join('');
  const sp=(key,label)=>`<div class="fa special"><button data-sel="${key}" aria-current="${cur===key}"><span>${label}</span><span class="c">${TOPICS.byKey[key].qs.length}</span></button></div>`;
  // checker report 18 Nov ("Topic counts differ between screens ... nothing on screen says so. It reads like a bug"); owner: "lets do 2,3,4,6".
  //   The Bank counts a question under every topic one of its parts is on; the exam builders count it once, under its main topic, and
  //   only if its skills are learnt. Each screen now says which count it shows (CNT_NOTE; exam builders in 24_exams.js)
  return '<div class="navtools"><button data-navall="open">Expand all</button><button data-navall="close">Collapse all</button></div><p class="bk-cntnote">'+CNT_NOTE.bank+'</p>'+sec('Year 12',TOPICS.y12,12)+sec('Year 11',TOPICS.y11,11)+'<h3>Outside the 2024 syllabus</h3>'+sp('special:removed','Removed content')+(TOPICS.byKey['special:std'].qs.length?sp('special:std','Mathematics Standard'):'')+(TOPICS.byKey['special:no_match'].qs.length?sp('special:no_match','No 2024 match'):'');
}
// health pass 21 Nov: one map of each question's duplicates per bank (dupLine ran a whole-bank filter for every card); QG.onDet clears it
let _dupm=null;const dupsOf=id=>{if(!_dupm){_dupm=new Map();B.questions.forEach(x=>{if(x.dup_of)(_dupm.get(x.dup_of)||_dupm.set(x.dup_of,[]).get(x.dup_of)).push(x)})}return _dupm.get(id)||[]};
function dupLine(q){const c=dupsOf(q.id);const v=q.related.filter(x=>x.rel!=='duplicate').map(x=>QG.byId.get(x.q)).filter(Boolean);
  const same=o=>docLabel(B.docs[o.doc])===docLabel(B.docs[q.doc])&&String(o.number)===String(q.number);   // owner 12 Nov: "the also prose is redundant ... they're literally the same exam twice": a copy of the same paper filed twice says nothing
  const t=[...c.filter(o=>!same(o)).map(o=>`also in ${esc(docLabel(B.docs[o.doc]))} as Q${esc(o.nlabel||o.number)}`),...v.map(o=>`similar to ${esc(docLabel(B.docs[o.doc]))} Q${esc(o.nlabel||o.number)}`)];
  return t.length?`<div class="help" style="margin:-4px 0 8px">${t.join(' · ')}</div>`:''}
const qLeaves=q=>q.parts.filter(p=>leaf(q,p));
const qSkills=q=>[...new Set(qLeaves(q).flatMap(p=>p.skills||[]))];
const qYear=q=>Math.max(0,...qLeaves(q).flatMap(p=>effTags(q,p).map(t=>DM[t.id]?.yl||0)));
const qPri=q=>[...new Set(qLeaves(q).flatMap(p=>effTags(q,p).filter(t=>t.primary&&DM[t.id]).map(t=>t.id)))];
function cardHTML(q){
  const d=B.docs[q.doc]; const r=reviews['q'+q.id];
  return `<article class="card" data-q="${q.id}"><div class="hd"><span class="qn">${qid(q)}</span><span class="src">${esc(srcLine(q))}</span>
    ${q.type==='mcq'?'<span class="badge">Multiple choice</span>':''}${r?.status==='flagged'?'<span class="badge b-bad">flagged</span>':''}${q.old?'<span class="badge b-old">Old syllabus</span>':''}${q.std?'<span class="badge b-std">Standard course</span>':''}
    <span class="mk">${q.marks!=null?q.marks+(q.marks===1?' mark':' marks'):''}</span></div>${q.old?`<div class="oldsyl"><b>Old syllabus (2017 only):</b> ${tex(q.old)}</div>`:''}${q.std?`<div class="stdsyl"><b>Mathematics Standard, not ${esc(QG.courseData.short)}:</b> ${esc(q.std)}</div>`:''}${dupLine(q)}${qBody(q,'bank')}
    <div class="cfoot">${q.type==='mcq'?`<button class="act ghost" data-reveal="${q.id}">${revealed.has(q.id)?'Hide answer':'Show answer'}</button>`:''}<span class="meta">${(sk=>sk.length?'Needs: '+sk.map(esc).join(' · '):'')(qSkills(q))}${qYear(q)?`${qSkills(q).length?' · ':''}Year ${qYear(q)}`:''}${(l=>l?((qSkills(q).length||qYear(q))?' · ':'')+l:'')(typeof qDifLabel==='function'?qDifLabel(q):'')}</span><a class="act ghost edonly" href="#review/list/all" data-open="${q.id}">Open in Review</a><button type="button" class="act ghost" data-crep="${q.id}" title="Report a problem with this question">Report</button></div></article>`;
}
// owner 12 Nov ("make the bank more usable and clean ... looks really dead" -> warm editorial; topic -> subheadings -> questions)
function subRows(subs,yl,fa,max){const rows=[...subs];const top=max||Math.max(1,...rows.map(([k,x])=>x.qs.length));
  return rows.map(([sk,x])=>`<button class="subrow${x.qs.length?'':' none'}" data-sel="${esc('sub:'+yl+'|'+fa+'|'+sk)}"><span class="nm">${esc(sk||fa)}</span><span class="bar"><i style="width:${Math.round(100*x.qs.length/top)}%"></i></span><span class="c">${x.qs.length||'–'}</span></button>`).join('')}
// owner 13 Nov ("holes everywhere"): each card spans as many 2px grid rows as its height, so short cards tuck under each other
function packCards(){$$('#list .facards').forEach(g=>{const kids=[...g.children];kids.forEach(c=>c.style.gridRowEnd='');
  kids.forEach(c=>{c.style.gridRowEnd='span '+Math.ceil((QG.rect(c).height+14)/2)})})}
addEventListener('resize',()=>{clearTimeout(window._pk);window._pk=setTimeout(()=>{if($('#list .facards'))packCards()},120)});
if(document.fonts)document.fonts.ready.then(()=>{if($('#list .facards'))packCards()});
function homeHTML(){
  const {questions:n,papers}=bankStats();
  // owner 13 Nov: "an overview of the courses, how many questions in each topic and subtopics and be able to click in, most similar to
  // the original design, just holes everywhere tho" -> the original cards, packed without holes (packCards below)
  const cards=(m,yl)=>`<div class="facards">${[...m].map(([fa,subs])=>{const c=faCount(subs);
    // owner 13 Nov: "there's almost no point in being able to click on a topic ... should go straight to subtopic?" -> one subheading: the
    // header opens it; several: the header is a plain title (the subheadings below are the links)
    const only=subs.size===1?'sub:'+yl+'|'+fa+'|'+[...subs][0][0]:null;
    const head=`<b>${esc(fa)}</b><span class="n">${c}<small>questions</small></span>`;
    return `<article class="facard y${yl}">${only?`<button class="fah subrow" data-sel="${esc(only)}">${head}</button>`:`<div class="fah static">${head}</div>`}<div class="subrows">${subRows(subs,yl,fa)}</div></article>`}).join('')}</div>`;
  const sum=m=>[...m.values()].reduce((a,subs)=>a+faCount(subs),0);
  return `<div class="hero"><h1>Question bank</h1><p>Every question from past HSC papers and school trials, filed under the 2024 ${esc(QG.courseData.name)} syllabus. Pick a topic, or search above.</p>
    <div class="stats"><span class="stat"><b>${n.toLocaleString()}</b> questions</span><span class="stat"><b>${papers}</b> papers</span><span class="stat"><b>${sum(TOPICS.y12)}</b> Year 12</span><span class="stat"><b>${sum(TOPICS.y11)}</b> Year 11</span>${bankSwitch()}</div></div>
   <div class="yhead"><h2>Year 12</h2><span class="yb y12">Y12</span></div>${cards(TOPICS.y12,12)}
   <div class="yhead"><h2>Year 11</h2><span class="yb y11">Y11</span><span class="muted">assumed knowledge, may be examined</span></div>${cards(TOPICS.y11,11)}
   <div class="yhead"><h2>Outside the 2024 syllabus</h2></div><div class="facards">
     <article class="facard ys"><button class="fah" data-sel="special:removed"><b>Removed content</b><span class="n">${TOPICS.byKey['special:removed'].qs.length}<small>questions</small></span></button><div class="muted" style="font-size:13px">In past papers but not in the 2024 ${esc(QG.courseData.short)} course (3D trigonometry, regression, Standard-course statistics).</div></article>
     ${TOPICS.byKey['special:std'].qs.length?`<article class="facard ys"><button class="fah" data-sel="special:std"><b>Mathematics Standard</b><span class="n">${TOPICS.byKey['special:std'].qs.length}<small>questions</small></span></button><div class="muted" style="font-size:13px">Standard-course content found in past papers (bivariate data, annuity tables). Kept for a Standard bank; never in ${esc(QG.courseData.short)} exams.</div></article>`:''}
     ${TOPICS.byKey['special:no_match'].qs.length?`<article class="facard ys"><button class="fah" data-sel="special:no_match"><b>No 2024 match</b><span class="n">${TOPICS.byKey['special:no_match'].qs.length}</span></button></article>`:''}</div>`;
}
function faHTML(yl,fa){const subs=(yl==='12'?TOPICS.y12:TOPICS.y11).get(fa);if(!subs)return homeHTML();const c=faCount(subs);
  return `<div class="crumbs"><button data-home="1">All topics</button><span>›</span><span>Year ${yl}</span></div>
    <div class="listhead"><h2>${esc(fa)}</h2><span class="crumb">${c} question${c===1?'':'s'} · ${subs.size} subheading${subs.size===1?'':'s'}</span></div>
    <div class="subgrid">${[...subs].map(([sk,x])=>`<button class="subcard y${yl}${x.qs.length?'':' none'}" data-sel="${esc('sub:'+yl+'|'+fa+'|'+sk)}"><b>${esc(sk||fa)}</b><span class="meta">${x.qs.length?x.qs.length+' question'+(x.qs.length===1?'':'s'):'No questions yet'} · ${x.dps.length} dot point${x.dps.length===1?'':'s'}</span></button>`).join('')}</div>`}
let BF={type:'all',src:'all',fig:'all',band:'all',wm:'all'};try{BF=Object.assign(BF,JSON.parse(localStorage.getItem('bf')||'{}'))}catch(e){}
const bfOK=q=>(BF.type==='all'||(BF.type==='mcq')===(q.type==='mcq'))&&(BF.src==='all'||(BF.src==='hsc')===(B.docs[q.doc]?.task_type==='hsc'))&&(BF.fig==='all'||(figKeys(q).all.length>0)===(BF.fig==='yes'))&&(typeof qDifOK!=='function'||qDifOK(q,BF));   // owner 14 Nov: difficulty filters (exam builder stage 2)
let BSEL={key:null,dp:null};
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
  return `<div class="bfilters">${g('type','Type',[['all','All'],['mcq','Multiple choice'],['written','Written']])}${g('src','Source',[['all','All'],['hsc','HSC'],['school','Trials & school']])}${g('fig','Diagram',[['all','Any'],['yes','With'],['no','Without']])}${g('band','Band',[['all','All'],['lo','2–3'],['mid','4'],['hi','5–6']])}${g('wm','Kind',[['all','All'],['uf','Fluency'],['pr','Problem solving']])}<span class="shown">${shown} of ${all}</span>${narrow?`<div class="narrow">${narrow}</div>`:''}</div>`}
function renderBank(){
  if(!TOPICS) buildTopics();
  syncNav();
  $('#bankView').classList.toggle('homemode',!search&&(!sel||sel.startsWith('fa:')));
  if($('#nav').offsetParent&&$('#nav .navpill')?.style.opacity!=='1')placePill(true);
  requestAnimationFrame(()=>{if(typeof setHdr==='function')setHdr()});
  if(!search&&sel&&sel.startsWith('fa:')){const [yl,fa]=sel.slice(3).split('|');$('#list').innerHTML=faHTML(yl,fa);return}
  let qs=null, head='';
  if(search){
    // owner 25 Nov ("Besides that, yes action all these things"), relaying the checker: "Question search is slow and capped. It took about
    // 6-8 seconds and only shows "first 60 matches", with no total and no way to see more." The first search used to load every topic
    // file (about 9 MB for Advanced) to read the question text; it now reads one search file (search.gz.json, about 0.5 MB, tools/
    // bank_split.py) and keeps each question's search text (QG.hay). The total is shown, 60 at a time, with "Show more".
    const s0=search,L0=$('#list'),hd=`<div class="listhead"><h2>Search: “${esc(search)}”</h2>`;
    if(!QG.srch||!QG.detOK){
      if(QG.srchFail||QG.detFail){L0.innerHTML=hd+'</div><div class="empty">The search did not load. <button class="act" type="button" data-sretry="1">Try again</button></div>';return}
      L0.innerHTML=hd+'<span class="crumb">Searching…</span></div>';
      Promise.all([QG.search(),QG.det()]).then(()=>{if(search===s0&&view==='bank')renderBank()});return}
    // a question's search text: its QID, paper, own words (the search file), dot points and skills, lower case, built once
    const hay=q=>{let h=QG.hay.get(q.id);if(h==null){h=[qid(q),qid(q).replace(' ',''),String(q.id),srcLine(q),QG.srch[q.id]||'',...q.parts.flatMap(p=>(p.t24||[]).map(t=>(DM[t.id]?.sub||'')+' '+(DM[t.id]?.text||'')+' '+(DM[t.id]?.short||''))),...q.parts.flatMap(p=>p.skills||[])].join(' ').toLowerCase();QG.hay.set(q.id,h)}return h};
    const s=search.toLowerCase();
    // matches in the sidebar's topic order (Year 12 first), newest paper first within a topic, as a topic's own list: the first 60 then
    // come from a few topic files, so their text arrives sooner than from 60 papers spread over every topic
    if(!TOPICS)buildTopics();const rk=new Map(Object.keys(TOPICS.byKey).map((k,i)=>[k,i])),rank=q=>rk.get([...qPlaces(q)][0])??1e9;
    qs=B.questions.filter(inBank).filter(q=>hay(q).includes(s)).map(q=>[rank(q),q]).sort((a,b)=>a[0]-b[0]||B.docs[b[1].doc].label.localeCompare(B.docs[a[1].doc].label)||parseInt(a[1].number)-parseInt(b[1].number)).map(x=>x[1]);
    if(BSEL.sq!==search)Object.assign(BSEL,{sq:search,sn:60});
    head=`${hd}<span class="crumb">${qs.length.toLocaleString()} ${qs.length===1?'match':'matches'}</span></div>`;
  } else if(sel&&TOPICS.byKey[sel]){
    const t=TOPICS.byKey[sel]; qs=t.qs.slice().sort((a,b)=>(B.docs[b.doc].label.localeCompare(B.docs[a.doc].label))||(parseInt(a.number)-parseInt(b.number)));
    let title,sibs='';
    if(sel.startsWith('sub:')){const [yl,fa,sk]=sel.slice(4).split('|');title=sk||fa;t.yl=yl;t.fa=fa;const subs=(yl==='12'?TOPICS.y12:TOPICS.y11).get(fa);if(subs.size>1)sibs=`<div class="sibs">${[...subs].map(([k2,s2])=>{const key='sub:'+yl+'|'+fa+'|'+k2;return `<button class="sib" data-sel="${esc(key)}" aria-current="${key===sel}">${esc(k2||fa)}<span class="c">${s2.qs.length}</span></button>`}).join('')}</div>`}
    else title=sel==='special:removed'?'Removed content':sel==='special:std'?'Mathematics Standard':'No 2024 match';
    if(BSEL.key!==sel)BSEL={key:sel,dp:null};
    const all=qs.length, base=qs.filter(bfOK);
    // the pills: one per dot point, or the owner's choices (SUB_SPLIT, owner 25 Nov: "Subdot points can be stuff they can choose inside
    // one"): a choice counts and shows the questions with a main tag on any of its dot points
    const own=t.fa&&SUB_SPLIT[t.fa]?.[title],ch=own&&!Array.isArray(own)?Object.entries(own):null,grp=ch||(t.dps||[]).map(d=>[d.id,[d.id]]).sort((a,b)=>a[0].localeCompare(b[0]));
    const onG=(q,ids)=>{const p=qPri(q);return ids.some(i=>p.includes(i))};
    const dpc={};base.forEach(q=>grp.forEach(([k,ids])=>{if(onG(q,ids))dpc[k]=(dpc[k]||0)+1}));
    const bg=grp.find(g=>g[0]===BSEL.dp);qs=base.filter(q=>!BSEL.dp||onG(q,bg?bg[1]:[BSEL.dp]));
    // counts on one line add up or say why (owner 18 Nov): a question on two choices counts under each, and the label says how many do
    const many=base.filter(q=>grp.filter(([,ids])=>onG(q,ids)).length>1).length;
    const narrow=Object.keys(dpc).length>1?`<div class="fl"><span${many?` title="${many} question${many===1?' uses':'s use'} more than one of these, so the counts add up to more than ${base.length}"`:''}>Dot point</span>${grp.filter(([k])=>dpc[k]).map(([k,ids])=>`<button data-bsel="dp:${esc(k)}" aria-pressed="${BSEL.dp===k}" title="${esc(ids.map(i=>DM[i]?.text||'').join(' / '))}">${esc(ch?k:DM[k]?.short||k)} <span class="c">${dpc[k]}</span></button>`).join('')}</div>`:'';   // owner 12 Nov: skill bubbles removed ("i dont feel like the skill bubbles work"): a question needs several skills, so they don't split a topic; skills are searchable instead
    head=`<div class="crumbs"><button data-home="1">All topics</button>${t.fa?`<span>›</span><span>${esc(t.fa)}</span>`:''}</div><div class="listhead"><h2>${esc(title)}</h2><span class="crumb">${all} question${all===1?'':'s'}</span>${bankSwitch()}</div>${sibs}${all?bfHTML(all,qs.length,narrow):''}
      ${t.dps?`<details class="dps"><summary>The ${t.dps.length} syllabus dot point${t.dps.length===1?'':'s'} in this subheading <span class="muted">· number of questions that use each one (a question can use several)</span></summary><ol>${t.dps.map(d=>{const n=t.qs.filter(q=>q.parts.some(p=>effTags(q,p).some(x=>x.id===d.id))).length;return `<li${n?'':' class="zero"'}><code>${d.id}</code>${tex(d.tex||d.text)} <span class="muted">(${n})</span></li>`}).join('')}</ol></details>`:''}`;
    if(!qs.length) head+='<div class="empty">No questions yet. This content is new or rarely examined in the papers loaded so far.</div>';
  }
  if(!qs){ $('#list').innerHTML=homeHTML(); packCards(); return }
  if(sel&&!search&&!qs.length&&TOPICS.byKey[sel]?.qs.length) head+='<div class="empty">No questions match these filters.</div>';
  // owner 13 Nov ("there's some lag when clicking between subtopics"): a long list (140 cards) took ~170 ms to build in one go and froze
  // the pill. Now the first 8 cards go in at once and the rest follow in small batches between frames.
  const L=$('#list');const gen=(L._gen=(L._gen||0)+1);
  // Fix 1 (owner 14 Nov: "Ok we should run Fix 1 and 2"): a topic's questions load with its topic file the first time it opens
  if(!search&&qs.some(q=>!QG.has(q)&&!QG.failed.has(q.h))&&!QG.detFail){   // job 2: a failed details file ends the wait too (cards say so, with Try again)
  L.innerHTML=`<div class="lhead">${head}</div><div class="cards"><div class="empty">Loading questions…</div></div>`;typeset(L.querySelector('.lhead'));
    QG.need(qs).then(()=>{if(L._gen===gen&&view==='bank')renderBank()});return}
  // a search draws its cards at once: a card whose topic file has not arrived shows "Loading question…" and fills itself in (QG.pending)
  const found=qs;if(search)qs=qs.slice(0,BSEL.sn);
  L.innerHTML=`<div class="lhead">${head}</div><div class="cards"></div>${search?'<div class="bk-more"></div>':''}`;typeset(L.querySelector('.lhead'));   // owner 13 Nov: the dot-point list in the header lost its maths when cards went lazy
  // (health pass 13 Nov: the list's own enter animation, swallowed by this comment, was not restored: bankGo's view
  // transition already animates #list, and a second animation inside it would double the slide; #list.enter CSS removed)
  const box=L.querySelector('.cards');let i=0;
  const batch=n=>{if(L._gen!==gen)return;const part=qs.slice(i,i+n);i+=part.length;const tmp=document.createElement('div');tmp.innerHTML=part.map(cardHTML).join('');
    const els=[...tmp.children];els.forEach(c=>{box.appendChild(c);const q=QG.byId.get(+c.dataset.q);hydrate(c,q,'bank')});
    els.forEach(c=>TSIO.observe(c));if(i<qs.length)setTimeout(()=>batch(12),16)};
  batch(8);bfPills();
  if(search){const more=L.querySelector('.bk-more'),foot=()=>{const left=found.length-qs.length;
      more.innerHTML=left>0?`<span class="muted">Showing ${qs.length.toLocaleString()} of ${found.length.toLocaleString()}</span><button type="button" class="act" data-smore="1">Show ${Math.min(60,left)} more</button>`:''};
    foot();L._more=()=>{if(L._gen!==gen)return;const idle=i>=qs.length;qs=found.slice(0,qs.length+60);BSEL.sn=qs.length;foot();if(idle)batch(12)}}
}
// owner 13 Nov: "smoother animations ... opening/closing should be smooth, clicking between subtopics should be a smooth pill movement,
// add anything else ... people will be using this a lot". The tree is rendered once and then only updated in place (open state,
// current item), so CSS can animate: folds use grid-rows 0fr->1fr, the highlight is one pill that glides to the current item.
const RM=matchMedia('(prefers-reduced-motion: reduce)');
function syncNav(){const nav=$('#nav');const html=navHTML();const sig=html.replace(/ open"|aria-current="(true|false)"|aria-expanded="(true|false)"/g,'');
  if(nav.dataset.sig!==sig){const was=[...nav.querySelectorAll('.fa.open[data-area]')].map(f=>f.dataset.area);nav.innerHTML=html+'<span class="navpill" aria-hidden="true"></span>';nav.dataset.sig=sig;
    was.forEach(k=>{const f=nav.querySelector(`.fa[data-area="${CSS.escape(k)}"]`);if(f){f.classList.add('open');f.querySelector('button[data-fa]').setAttribute('aria-expanded','true')}});placePill(true);return}
  nav.querySelectorAll('[data-sel]').forEach(b=>b.setAttribute('aria-current',String(b.dataset.sel===navSel())));
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
  Object.assign(c.style,{position:'absolute',visibility:'hidden',pointerEvents:'none',left:'-9999px',top:'0',width:QG.rect(nav).width+'px',boxSizing:getComputedStyle(nav).boxSizing,maxHeight:'none',overflow:'scroll'});   // same width as the real list so names wrap the same (owner 13 Nov: pill landed a row off)
  document.body.appendChild(c);const el=pillEl(c),cr=QG.rect(c),r=QG.rect(el),n=QG.rect(nav),lr=QG.rect(live);   // QG.rect: CSS px under the viewer's page zoom (owner 25 Nov)
  const t={y:r.top-cr.top,x:lr.left-n.left,w:lr.width,h:lr.height};c.remove();   // size always from the real item (owner 13 Nov: two-line subtopic got a one-line pill)
  nav.querySelectorAll('.fa.parked').forEach(f=>f.classList.remove('parked'));if(live.matches('button[data-fa]'))live.closest('.fa').classList.add('parked');
  const instant=jump||RM.matches||pill.style.opacity!=='1';
  if(instant)pill.style.transition='none';
  pill.style.opacity=1;pill.style.transform=`translate(${t.x}px,${t.y}px)`;pill.style.width=t.w+'px';pill.style.height=t.h+'px';
  if(instant){void pill.offsetWidth;pill.style.transition=''}
  clearTimeout(_pillFix);_pillFix=setTimeout(()=>{   // once the folds have settled, snap to the real position if the prediction was off
    const a=QG.rect(live),m=QG.rect(nav),y=a.top-m.top+nav.scrollTop,x=a.left-m.left;
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
  const ba=e.target.closest('[data-bankall]'); if(ba&&isEditor()){BANKALL=!BANKALL;save('bankall',BANKALL?'1':'0');TOPICS=null;renderBank();return}
  const bs=e.target.closest('[data-bsel]'); if(bs){const i=bs.dataset.bsel.indexOf(':'),k=bs.dataset.bsel.slice(0,i),v=bs.dataset.bsel.slice(i+1);BSEL[k]=BSEL[k]===v?null:v;renderBank();return}
  const bf=e.target.closest('[data-bf]'); if(bf){const [k,v]=bf.dataset.bf.split(':');BF[k]=v;save('bf',JSON.stringify(BF));renderBank();return}
  const hm=e.target.closest('[data-home]'); if(hm){bankGo('back',null,()=>{sel=null;save('sel','');renderBank();window.scrollTo({top:0})});return}
  const t=e.target.closest('[data-fa],.subrow[data-sel],.subcard[data-sel],.fah[data-sel]');
  if(t){if(t.classList.contains('none'))return; const prevSel=sel; sel=t.dataset.sel||('fa:'+t.dataset.fa);
    const go=sel;sel=prevSel;bankGo('fwd',t.matches('.fah')?null:t,()=>{sel=go;save('sel',sel);renderBank();window.scrollTo({top:0})});return}
  const sb=e.target.closest('.sib'); if(sb){sel=sb.dataset.sel;save('sel',sel);renderBank();bankFade();return}
  const rv=e.target.closest('[data-reveal]'); if(rv){const id=+rv.dataset.reveal;revealed.has(id)?revealed.delete(id):revealed.add(id);const c=rv.closest('.card');const q=QG.byId.get(id);c.outerHTML=cardHTML(q);const nc=$(`.card[data-q="${id}"]`);hydrate(nc,q,'bank');typeset(nc);return}
  const sm=e.target.closest('[data-smore]'); if(sm){$('#list')._more?.();return}
  const sr=e.target.closest('[data-sretry]'); if(sr){QG.srchFail=false;QG.detFail=false;renderBank();return}
  const op=e.target.closest('[data-open]'); if(op)reviewOpen(+op.dataset.open);   // owner 13 Nov: opens in Review's "All questions" list (#review/list/all)
});
let st; $('#q').addEventListener('input',e=>{clearTimeout(st);st=setTimeout(()=>{search=e.target.value.trim();renderBank()},250)});

