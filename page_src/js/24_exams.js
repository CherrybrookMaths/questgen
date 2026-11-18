/* ===================== Exams page (owner 14 Nov) =====================
   owner 14 Nov: "Making the exam should be on another page, and it should operate similar to the html file I gave you."
   He chose: a new tab in Questgen; all of Setup page, Preview + grading panel, Edit on the paper, Pick by hand view.
   Mirrors his HSC Advanced Exam Maker: Exam setup (topic tiles, sliders, availability table, Generate) | Pick by hand
   (topics | question cards | exam panel), and a full-screen A4 preview with a grading panel, Regenerate, Swap,
   editable cover, answer lines and diagram sizes. The side drawer from stage 1/2 is replaced: the header "Exam · N" pill
   now opens this page. Difficulty: band 2-6 and fluency (UF) / problem solving (PR) per part, from DIFFICULTY_SPEC. */
const EXV={view:(()=>{try{return localStorage.getItem('ex_view')||'setup'}catch(e){return 'setup'}})(),
  pk:{topic:'all',q:'',paper:'all',type:'all',marks:'all',sort:'new',band:'all',wm:'all',fig:false,hide:false,limit:20},
  open:new Set(),pkOpen:new Set(),sel:null,doc:'exam',grade:true,built:false,moved:null};
const exSaveView=()=>{try{localStorage.setItem('ex_view',EXV.view)}catch(e){}};

/* ---------- settings (kept in EX.auto with the stage-2 fields) ---------- */
function exA(){const A=xa();if(!A.src||typeof A.src!=='object')A.src={hsc:true,trial:true,school:true};
  // owner 19 Nov (questions used before): "avoid them but if used, should show WHERE in the past they were used" - skipping questions
  // already in a saved exam is back, on unless unticked (supersedes 14 Nov "remove Skip questions used in my other saved exams for now")
  if(!A.avoidSet)A.avoid=true;   // saved settings from before 19 Nov hold avoid:false (it was forced off): on until ticked off here
  if(A.dF==null)A.dF=3.2;if(A.dP==null)A.dP=4.2;if(A.title==null)A.title='';if(A.last===undefined)A.last=null;
  if(!EX.lines||typeof EX.lines!=='object')EX.lines={};if(!EX.figscale||typeof EX.figscale!=='object')EX.figscale={};return A}
const exSrc=q=>{const t=B.docs[q.doc]?.task_type;return t==='hsc'?'hsc':t==='trial'?'trial':'school'};
const EX_SRC=[['hsc','NESA HSC'],['trial','Trials'],['school','School exams']];
// owner 14 Nov ("make it more sophisticated"): plain "Band 4.2" labels; the Solid/Strong words are gone
const dLab=b=>'Band '+(+b).toFixed(1);

/* ---------- per-question estimate from the part ratings ---------- */
const _ee=new Map();
function exPath(q,p){const by=new Map(q.parts.map(y=>[y.id,y]));const c=[];let x=p;while(x){if(x.label)c.unshift('('+x.label+')');x=x.parent?by.get(x.parent):null}return c.join('')}
function exEst(q){if(_ee.has(q.id))return _ee.get(q.id);
  const ls=qLeaves(q).filter(p=>p.dif&&p.dif.b);let r=null;
  if(ls.length){const w=p=>+p.marks||(ls.length===1?(+q.marks||1):1);const sw=ls.reduce((t,p)=>t+w(p),0)||1,k=(+q.marks||sw)/sw;
    let fl=0,ps=0,wF=0,wP=0;
    const parts=ls.map(p=>{const m=w(p)*k,b=Math.max(2,Math.min(6,+p.dif.b)),isP=p.dif.wm==='PR';if(isP){ps+=m;wP+=m*b}else{fl+=m;wF+=m*b}
      return {id:p.id,lab:exPath(q,p),m,b,ps:isP,r:p.dif.r||''}});
    const m=fl+ps;r={m,fl,ps,dF:fl?wF/fl:null,dP:ps?wP/ps:null,d:(wF+wP)/(m||1),kind:ps<=1e-9?'Fluency':'Problem solving',parts}}   // owner 19 Nov: any problem-solving part makes it a problem-solving question
  _ee.set(q.id,r);return r}
// owner 19 Nov ("math should render properly in the grading tab", then "Are you sure the math renders properly? I'm still seeing incorrect
// in dot points and why it was rated this way"): the rater's reasons are plain text ("S_20 = 4 S_10", "a/(1-r)", "sqrt2"). Each word that
// looks like maths is turned into LaTeX (powers, subscripts, a/b as a fraction, sqrt, Greek, <= >= !=) and typeset by MathJax like the
// questions; other words stay text. Dot points use their official LaTeX wording (dotpoints.json "tex"), see qiParts.
const exMathTeX=s=>{const G={theta:'\\theta',alpha:'\\alpha',beta:'\\beta',lambda:'\\lambda',sigma:'\\sigma',mu:'\\mu',phi:'\\phi',pi:'\\pi',infinity:'\\infty',inf:'\\infty'};
  const strip=x=>x.replace(/^\((.*)\)$/,'$1');
  const conv=x=>x.replace(/<=/g,'\\le ').replace(/>=/g,'\\ge ').replace(/!=/g,'\\ne ').replace(/sqrt\s*\(([^()]*)\)/g,'\\sqrt{$1}').replace(/sqrt([\w.]+)/g,'\\sqrt{$1}')
    .replace(/\^\(([^()]*)\)/g,'^{$1}').replace(/_\(([^()]*)\)/g,'_{$1}').replace(/\^(-?[\w.]+)/g,'^{$1}').replace(/_([\w.]+)/g,'_{$1}')
    .replace(/(\([^()]*\)|[\w.]+(?:\^\{[^{}]*\})?)\/(\([^()]*\)|[\w.]+)/g,(m,a,b)=>`\\frac{${strip(a)}}{${strip(b)}}`)
    .replace(/\b(theta|alpha|beta|lambda|sigma|mu|phi|pi|infinity|inf)\b/g,m=>G[m]+' ').replace(/\bcosec\b/g,'\\operatorname{cosec}').replace(/(^|[^\\a-z])(sin|cos|tan|sec|cot|ln|log)(?![a-z])/g,'$1\\$2 ');
  const isM=w=>/[\^_=<>]|sqrt|\b(theta|alpha|beta|lambda|sigma|mu|phi|pi)\b|[\w)]\/[\w(]/.test(w)&&!/^[A-Za-z]{2,}\/[A-Za-z]{2,}$/.test(w);
  return tex(String(s||'').replace(/\$/g,'\\$').split(/(\s+)/).map(w=>{if(!w.trim()||!isM(w))return w;const m=w.match(/^(.*?)([,;:]*)$/);return m[1]?'$'+conv(m[1])+'$'+m[2]:w}).join(''))};
const fmtM=m=>Number.isInteger(m)?String(m):String(+m.toFixed(1));

/* ---------- pool ---------- */
function exBase(A,homes){const avoid=A.avoid?xaSavedIds():null;
  return B.questions.filter(q=>homes.has(q.id)&&exEst(q)&&A.src[exSrc(q)]&&(!A.approved||qState(q)==='approved')&&!repHidden(q)&&!(avoid&&avoid.has(q.id)))}   // owner 17 Nov: a reported question is out of new exams ("disappear from the bank")
// owner 17 Nov: "lets do skill gates, that's important": the pool keeps only questions whose skills' topics are learnt (XG, 23_exam_auto.js)
function exPool(A,homes,all){const T=new Set(A.topics),raw=exBase(A,homes).filter(q=>T.has(homes.get(q.id).sub));return all?raw:XG.split(raw,XG.learnt(XG.autoExtra(A)).L).keep}
const subName=k=>k.split('|')[2]||k.slice(4).split('|')[1];
function exAutoTitle(A){const tree=xaTree(),sel=new Set(A.topics),fas=[];
  [12,11].forEach(y=>tree[y].forEach((ks,fa)=>{const s=ks.filter(k=>sel.has(k));if(s.length)fas.push({fa,s,all:ks.length})}));
  if(!fas.length)return QG.courseData.name+' practice';
  if(fas.length===1){const f=fas[0];return f.s.length===1&&f.all>1?subName(f.s[0]):f.fa}
  if(fas.length===2)return fas[0].fa+' and '+fas[1].fa.charAt(0).toLowerCase()+fas[1].fa.slice(1);
  return 'Mixed topics'}

/* ---------- generator (stage 2's seeded greedy fill + improvement moves; cost now uses separate fluency and
   problem-solving difficulty targets, like the owner's exam maker) ---------- */
function exStats(S,homes,T){let marks=0,mcq=0,fl=0,ps=0,wF=0,wP=0,dev=0;const area={};
  for(const q of S){const e=exEst(q);if(!e)continue;const m=+q.marks||e.m;marks+=m;if(q.type==='mcq')mcq++;fl+=e.fl;ps+=e.ps;
    for(const p of e.parts){if(p.ps){wP+=p.b*p.m;if(T)dev+=p.m*Math.abs(p.b-T.dP)}else{wF+=p.b*p.m;if(T)dev+=p.m*Math.abs(p.b-T.dF)}}
    const h=homes.get(q.id);if(h)area[h.area]=(area[h.area]||0)+m}
  return {marks,mcq,fl,ps,dF:fl?wF/fl:null,dP:ps?wP/ps:null,dev:dev/((fl+ps)||1),area}}
function exCost(st,T){let c=0;if(T.full)c+=20*Math.abs(st.marks-T.total)+20*Math.abs(st.mcq-T.mcq);
  const tm=(st.fl+st.ps)||1;c+=6*Math.abs(st.ps/tm-T.s);
  if(st.dF!=null)c+=2*Math.abs(st.dF-T.dF)*(st.fl/tm);if(st.dP!=null)c+=2*Math.abs(st.dP-T.dP)*(st.ps/tm);
  c+=.25*st.dev;let al=0;const mk=st.marks||1;for(const a in T.area)al+=Math.abs((st.area[a]||0)/mk-T.area[a]);return c+2*al}
function exGenerate(){const A=exA();if(!A.topics.length){toast('Choose at least one subtopic first');return null}
  const homes=xaHomes(),pool=exPool(A,homes);
  const locked=A.locked.filter(i=>EX.items.includes(i)).map(xq).filter(Boolean);A.locked=locked.map(q=>q.id);const lockedIds=new Set(A.locked);
  const mcqP=pool.filter(q=>q.type==='mcq'&&!lockedIds.has(q.id)),wrP=pool.filter(q=>q.type!=='mcq'&&!lockedIds.has(q.id));
  if(!mcqP.length&&!wrP.length&&!locked.length){toast('No questions match. Choose more topics or papers.');return null}
  const T={total:A.total,mcq:A.mcq,s:A.pr/100,dF:A.dF,dP:A.dP,area:{},full:false};
  pool.forEach(q=>{const a=homes.get(q.id).area;T.area[a]=(T.area[a]||0)+(+q.marks||0)});{const s=Object.values(T.area).reduce((a,b)=>a+b,0)||1;for(const k in T.area)T.area[k]/=s}
  A.seed=(Math.random()*2**31)>>>0;const R=xaRng(A.seed);
  let S=[...locked];const used=new Set(S.map(q=>q.id));
  const cost=sel=>exCost(exStats(sel,homes,T),T);
  const sample=(arr,n,f)=>{const out=[];for(let t=0;t<n*4&&out.length<n&&arr.length;t++){const q=arr[Math.floor(R()*arr.length)];if(!used.has(q.id)&&(!f||f(q))&&!out.includes(q))out.push(q)}return out};
  const greedy=c=>{let best=null,bc=1e9;c.forEach(q=>{const v=cost([...S,q])+R()*.03;if(v<bc){bc=v;best=q}});S.push(best);used.add(best.id)};
  const needM=Math.max(0,A.mcq-locked.filter(q=>q.type==='mcq').length);
  for(let k=0;k<needM;k++){const c=sample(mcqP,24);if(!c.length)break;greedy(c)}
  const marks=()=>S.reduce((t,q)=>t+(+q.marks||0),0);
  for(let g=0;g<300;g++){const rem=A.total-marks();if(rem<=0)break;const c=sample(wrP,30,q=>q.marks<=rem);if(!c.length)break;greedy(c)}
  T.full=true;const byM={};wrP.forEach(q=>{(byM[q.marks]=byM[q.marks]||[]).push(q)});
  let cur=cost(S),best=S.slice(),bestC=cur;const N_IT=900;
  for(let it=0;it<N_IT;it++){const temp=.06*(1-it/N_IT),diff=A.total-marks(),free=S.filter(q=>!lockedIds.has(q.id)),r=R();let N=null;
    if(diff>0&&r<.25){const c=(byM[diff]||[]).filter(q=>!used.has(q.id));if(c.length)N=[...S,c[Math.floor(R()*c.length)]]}
    else if(diff<0&&r<.25){const c=free.filter(q=>q.type!=='mcq'&&q.marks<=-diff);if(c.length){const x=c[Math.floor(R()*c.length)];N=S.filter(q=>q!==x)}}
    if(!N&&free.length){const x=free[Math.floor(R()*free.length)],isM=x.type==='mcq';let c=null;
      if(!isM&&R()<.5)c=(byM[x.marks+diff]||[]).filter(q=>!used.has(q.id));
      if(!c||!c.length)c=sample(isM?mcqP:wrP,6);
      if(c.length){const y=c[Math.floor(R()*c.length)];N=S.map(q=>q===x?y:q)}}
    if(!N)continue;const nc=cost(N);
    if(nc<cur||(temp>0&&R()<Math.exp((cur-nc)/temp))){S=N;cur=nc;used.clear();S.forEach(q=>used.add(q.id));if(cur<bestC){bestC=cur;best=S.slice()}}}
  S=best;
  const bo=q=>exEst(q)?.d??3;   // HSC order: easier first within each section
  const mc=S.filter(q=>q.type==='mcq').sort((a,b)=>bo(a)-bo(b)),wr=S.filter(q=>q.type!=='mcq').sort((a,b)=>bo(a)-bo(b)||a.marks-b.marks);
  EX.items=[...mc,...wr].map(q=>q.id);EX.sub=A.title||exAutoTitle(A);
  const st=exStats(S,homes,null);A.ran=true;A.tpr=T.s;
  A.last={n:S.length,marks:st.marks,F:st.fl,P:st.ps,dF:st.dF,dP:st.dP,nM:st.mcq,topics:new Set(S.map(q=>homes.get(q.id)?.sub).filter(Boolean)).size,chosen:A.topics.length,warns:exWarn(A,st,pool)};
  A.warns=A.last.warns;XA_SWAPPED.clear();xsave();return A.last}
function exWarn(A,st,pool){const w=[],mN=pool.filter(q=>q.type==='mcq').length,wM=pool.filter(q=>q.type!=='mcq').reduce((t,q)=>t+(+q.marks||0),0);
  if(st.mcq<A.mcq)w.push(`Only ${mN} multiple-choice question${mN===1?'':'s'} match these topics, so Section I has ${st.mcq}.`);
  if(st.marks!==A.total)w.push(wM<A.total-A.mcq?`These topics only have ${wM} marks of written questions, so the exam has ${st.marks} marks instead of ${A.total}. Add topics or lower the total.`:`The closest found is ${st.marks} marks (target ${A.total}). Press Regenerate, or add a topic.`);
  const tm=(st.fl+st.ps)||1,s=A.pr/100;
  if(st.ps/tm<s-.07)w.push(`Problem solving is ${Math.round(st.ps/tm*100)}% of the marks, against ${A.pr}%: these topics are short of problem-solving parts.`);
  else if(st.ps/tm>s+.1)w.push(`Problem solving is ${Math.round(st.ps/tm*100)}% of the marks, more than the ${A.pr}% asked for: these topics have few fluency-only questions.`);
  if(st.dF!=null&&Math.abs(st.dF-A.dF)>.4)w.push(`Fluency marks average band ${st.dF.toFixed(1)}, against ${A.dF.toFixed(1)}: these topics have few fluency parts ${st.dF<A.dF?'that hard':'that easy'}.`);
  if(st.dP!=null&&Math.abs(st.dP-A.dP)>.4)w.push(`Problem-solving marks average band ${st.dP.toFixed(1)}, against ${A.dP.toFixed(1)}: these topics have few problem-solving parts ${st.dP<A.dP?'that hard':'that easy'}.`);
  return w}

/* ---------- page shell ---------- */
// owner 14 Nov ("Is there a place to manage created exams?"): a third view, My exams (25_mine.js), beside Exam setup and Pick by hand
function renderExams(){const box=$('#examsView');if(!box||!B)return;exmSub();exA();XG.load();
  if(!EXV.built){EXV.built=true;
    box.innerHTML=`<div class="exhead"><div class="xseg exseg" role="group" aria-label="Exams"><button type="button" data-exv="setup">Exam setup</button><button type="button" data-exv="pick">Pick by hand</button><button type="button" data-exv="mine">My exams</button></div>
      <span class="exsum" id="exSum"></span><span class="sp"></span>
      <button type="button" class="act exnarrow-s" id="exTopicsBtn" aria-controls="exSide">Topics</button>
      <button type="button" class="act exnarrow" id="exExamBtn" aria-controls="exRight">Exam · <span id="exExamN">0</span></button>
      <button type="button" class="act ok" data-expv="exam" id="exPvBtn">Preview paper</button></div>
      <div id="exSetup"></div>
      <div class="expick" id="exPick"><nav class="exside" id="exSide" aria-label="Topics"></nav><main class="exmain" id="exMain"></main><aside class="exright" id="exRight" aria-label="Exam being built"></aside></div><div class="exmine" id="exMine"></div>
      <div class="exscrim" id="exScrim"></div>`;
    const p=$('#xPanel');if(p){$('#exRight').appendChild(p);p.hidden=false;p.classList.add('inpage')}}
  const hh=document.querySelector('header')?.getBoundingClientRect().height||64;box.style.setProperty('--hdr',Math.round(hh)+'px');
  $$('[data-exv]',box).forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.exv===EXV.view)));
  box.dataset.exview=EXV.view;exHead();
  // My exams keeps the setup view drawn underneath (hidden by CSS), as it always has
  if(EXV.view==='pick')renderPick();else renderSetup();
  if(EXV.view==='mine'){renderMine();exHead()}}
function exHead(){const n=EX.items.length,m=xMarks(EX.items.map(xq).filter(Boolean));
  const s=$('#exSum');if(s)s.textContent=n?`This exam: ${n} question${n===1?'':'s'} · ${m} mark${m===1?'':'s'}`:'No questions in the exam yet';
  const en=$('#exExamN');if(en)en.textContent=n;const pb=$('#exPvBtn');if(pb)pb.disabled=!n;
  // head: Saved / Unsaved marker + Save button (owner: don't lose a generated exam by clicking away); exmState is in 25_mine.js
  if(!s)return;let b=$('#exSaveSt');
  if(!b){s.insertAdjacentHTML('afterend','<span class="exm-st" id="exSaveSt"></span>');b=$('#exSaveSt')}
  // owner 19 Nov: the open exam's name and state, on every Exams view ("can't tell which exam we're inside or if we're making a new one")
  const st=exmState(),nm=esc(EXAS.name()),when=EXAS.at?EXAS.at.toLocaleTimeString('en-AU',{hour:'numeric',minute:'2-digit'}):'';b.dataset.st=st||'empty';
  b.innerHTML=!n?`<b>New exam</b> · add questions to start`
    :`<b>${EX.id?'Editing':'New exam'}:</b> ${nm} · ${st==='saved'?`<span class="exst-ok">✓ Saved${when?' '+when:''}</span>`:!db?'kept in this browser (saving needs claude.ai)':EXAS.busy?'Saving…':`<span class="exst-wait">Saving…</span> <button type="button" class="linkbtn" data-exm-save>Save now</button>`}
      <span class="exst-acts"><button type="button" class="linkbtn" data-exm-copy${EX.id?'':' hidden'}>Save as a copy</button><button type="button" class="linkbtn" data-exm-fresh>New exam</button></span>`}
function exRefresh(){if(view!=='exams')return;if(EXV.view==='mine'){renderMine();exHead();return}if(EXV.view==='setup'){exTopics();exAvail()}else{exSideNav();exList()}exHead()}

/* ---------- Setup ---------- */
const sliderCtl=(id,lab,min,max,step,val,ends,hint,cls='')=>`<div class="ctl ${cls}"><div class="lab"><label for="${id}">${lab}</label><span class="val" id="${id}V"></span></div>
  <input type="range" class="rng" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><div class="ends"><span>${ends[0]}</span><span>${ends[1]}</span></div>${hint?`<div class="hint">${hint}</div>`:''}</div>`;
const exOverall=A=>(1-A.pr/100)*A.dF+(A.pr/100)*A.dP;
function renderSetup(){const A=exA();
  $('#exSetup').innerHTML=`<div class="exsetup">
    <section class="extopics"><div class="pagehead"><div class="eyebrow">HSC ${esc(QG.courseData.name)}</div><h2>Set up your exam</h2>
      <p class="lead">Pick the topics to cover. Tick a box to take a whole topic, or open it to choose subtopics. Then set the marks and difficulty, and generate.</p></div>
      <div id="exTopics"></div></section>
    <aside class="exsettings" aria-label="Exam settings">
      <div class="group"><h3>Exam</h3>
        <div class="ctl"><div class="lab"><label for="gTitle">Title</label></div><input type="text" id="gTitle" placeholder="${esc(exAutoTitle(A))}" value="${esc(A.title)}"></div>
        ${sliderCtl('gMarks','Total marks',10,100,5,Math.min(100,A.total),['10','100'],'')}
        ${sliderCtl('gMcq','Multiple choice',0,10,1,Math.min(10,A.mcq),['None','10'],'Placed first as Section I, 1 mark each.')}
        <div class="ctl"><div class="lab"><span id="gSrcL">Papers to draw from</span></div><div class="srcseg" role="group" aria-labelledby="gSrcL">${EX_SRC.map(([k,l])=>`<button type="button" data-src="${k}" aria-pressed="${!!A.src[k]}">${l}</button>`).join('')}</div></div>
        <label class="exck"><input type="checkbox" id="gApproved"${A.approved?' checked':''}> Approved questions only</label>
        <label class="exck"><input type="checkbox" id="gAvoid"${A.avoid?' checked':''}> Skip questions already in my saved exams</label>
      </div>
      <div class="group"><h3>Difficulty</h3>
        ${sliderCtl('gAll','Overall',2,6,0.1,exOverall(A),['Band 2','Band 6'],'Moves both difficulty sliders below together.')}
        ${sliderCtl('gSplit','Fluency and problem solving',0,100,5,A.pr,['More fluency','More problem solving'],'')}
        <div id="splitBar"></div>
        <div class="hint" style="margin:8px 0 16px">Fluency is routine skills. Problem solving needs reasoning, proof or applying ideas in context.</div>
        ${sliderCtl('gDF','Fluency difficulty',2,6,0.1,A.dF,['Band 2','Band 6'],'','fl')}
        ${sliderCtl('gDP','Problem-solving difficulty',2,6,0.1,A.dP,['Band 2','Band 6'],'','ps')}
      </div>
      <div class="group xl-g" id="exLearnt"></div>
      <div class="group"><h3>What these topics can supply</h3><div id="availBox"></div></div>
      <div class="exgo"><button type="button" class="exgen" id="gGo">Generate exam</button>
      <button type="button" class="linkbtn pickhand" data-exv="pick">or pick questions by hand</button><span class="exgohint" id="gGoHint" hidden>Choose at least one subtopic to generate.</span></div>
      <div id="gResult"></div>
    </aside></div>`;
  exTopics();exLabels();exAvail();exResult()}
function exTopics(){const el=$('#exTopics');if(!el)return;const A=exA(),tree=xaTree(),homes=xaHomes(),base=exBase(A,homes),cnt={},has={},sel=new Set(A.topics),Ls=new Map();
  // owner 17 Nov (skill gates): a subtopic counts the questions that would come in if it were ticked (its own topic counts as learnt)
  const Lk=k=>{if(!Ls.has(k))Ls.set(k,XG.learnt([...A.topics,k]).L);return Ls.get(k)};
  const raw={};base.forEach(q=>{const k=homes.get(q.id).sub;has[k]=1;raw[k]=(raw[k]||0)+1;if(XG.ok(q,Lk(k)))cnt[k]=(cnt[k]||0)+1});const nq=exPool(A,homes).length;exLearnt();
  let h=`<div class="selbar"><span><b>${A.topics.length}</b> subtopic${A.topics.length===1?'':'s'} chosen · <b>${nq}</b> question${nq===1?'':'s'} match</span><span class="sp"></span><button type="button" class="linkbtn" data-sall="all">Select all</button><button type="button" class="linkbtn" data-snone="all">Clear all</button></div><p class="ex-cntnote">${CNT_NOTE.setup}</p>`;
  [12,11].forEach(y=>{h+=`<section class="strand"><div class="strand-h"><h3>Year ${y}</h3><button type="button" class="linkbtn" data-sall="${y}">Select all</button><button type="button" class="linkbtn" data-snone="${y}">Clear</button></div><div class="extiles">`;
    tree[y].forEach((ks,fa)=>{const key=y+'|'+fa,live=ks.filter(k=>has[k]),on=ks.filter(k=>sel.has(k)).length,state=on&&on>=live.length&&live.length?'on':on?'part':'';
      const q=ks.reduce((t,k)=>t+(cnt[k]||0),0),open=EXV.open.has(key),chosen=ks.filter(k=>sel.has(k)).map(subName);
      h+=`<div class="extile ${state==='part'?'ex-part':state}${open?' open':''}"><div class="extile-h">
        <button type="button" class="tbox" data-tfa="${esc(key)}" role="checkbox" aria-checked="${state==='on'?'true':state==='part'?'mixed':'false'}" aria-label="Choose all of ${esc(fa)}"${live.length?'':' disabled'}>${state==='on'?'✓':''}</button>
        <button type="button" class="extile-t" data-texp="${esc(key)}" aria-expanded="${open}"><span class="tt"><b>${esc(fa)}</b><small>${q} question${q===1?'':'s'} · ${on?`${on} of ${ks.length} chosen`:`${ks.length} subtopic${ks.length===1?'':'s'}`}</small>${chosen.length&&!open&&state!=='on'?`<small class="expicked">${esc(chosen.join(', '))}</small>`:''}</span><span class="exchev" aria-hidden="true">▾</span></button></div>
        <div class="pills" ${open?'':'hidden'}>${ks.map(k=>{const n=cnt[k]||0;return `<button type="button" class="pill" data-tsub="${esc(k)}" aria-pressed="${sel.has(k)}"${has[k]?n?(raw[k]>n?` title="${n} of ${raw[k]} can be used: ${raw[k]-n} need${raw[k]-n===1?'s':''} a topic not learnt yet"`:''):' title="Its questions need topics not yet learnt"':' disabled title="No questions yet"'}>${esc(subName(k))}<span class="n">${n}</span></button>`}).join('')}</div></div>`});
    h+='</div></section>'});
  el.innerHTML=h;const t=$('#gTitle');if(t)t.placeholder=exAutoTitle(A)}
// the Already learnt block in Exam setup, with the switch and the left-out line for the ticked topics
function exLearnt(){const el=$('#exLearnt');if(!el)return;const A=exA(),g=XG.learnt(XG.autoExtra(A));el.innerHTML=XG.html('setup',g,XG.split(exPool(A,xaHomes(),true),g.L))}
function exLabels(){const A=exA(),fill=(id,v,min,max)=>{const el=$('#'+id);if(el)el.style.setProperty('--p',((v-min)/(max-min)*100)+'%')};
  const set=(id,t)=>{const el=$('#'+id+'V');if(el)el.textContent=t};
  set('gMarks',A.total+' marks');fill('gMarks',A.total,10,100);
  set('gMcq',A.mcq?A.mcq+' question'+(A.mcq===1?'':'s'):'None');fill('gMcq',A.mcq,0,10);
  const o=exOverall(A);set('gAll',dLab(o));fill('gAll',o,2,6);
  set('gSplit',`${100-A.pr} / ${A.pr}`);fill('gSplit',A.pr,0,100);
  const sb=$('#splitBar');if(sb)sb.innerHTML=`<div class="splitbar">${A.pr<100?`<i class="f" style="flex:${100-A.pr}"></i>`:''}${A.pr>0?`<i class="p" style="flex:${A.pr}"></i>`:''}</div><div class="splitleg"><span><i class="f"></i>Fluency <b>${100-A.pr}%</b></span><span><i class="p"></i>Problem solving <b>${A.pr}%</b></span></div>`;
  set('gDF',dLab(A.dF));fill('gDF',A.dF,2,6);set('gDP',dLab(A.dP));fill('gDP',A.dP,2,6);
  const f=$('#gDF'),p=$('#gDP');if(f)f.disabled=A.pr===100;if(p)p.disabled=A.pr===0;
  const go=$('#gGo');if(go){go.disabled=!A.topics.length;go.textContent=EX.items.length&&A.ran?'Generate a new exam':'Generate exam'}const gh=$('#gGoHint');if(gh)gh.hidden=!!A.topics.length}
function exAvail(){const el=$('#availBox');if(!el)return;const A=exA(),pool=exPool(A,xaHomes()),cell={F:[0,0,0,0,0,0,0],P:[0,0,0,0,0,0,0]};let tf=0,tp=0;
  pool.forEach(q=>exEst(q).parts.forEach(x=>{const b=Math.round(x.b);cell[x.ps?'P':'F'][b]+=x.m;x.ps?tp+=x.m:tf+=x.m}));
  const mx=Math.max(1,...cell.F,...cell.P),nm=pool.filter(q=>q.type==='mcq').length;
  // owner 14 Nov: "overlap". The row labels had no column of their own (a fixed table takes its widths from the first row,
  // whose label cell is empty), so Fluency / Problem solving ran into B2. A <colgroup> now gives them a real column with a gap.
  const row=(k,lab,t)=>`<tr class="${k==='F'?'fl':'ps'}"><th class="k" scope="row"><i></i><span>${lab}</span></th>${[2,3,4,5,6].map(b=>{const v=Math.round(cell[k][b]);return `<td class="${v?'':'z'} ${Math.round(t)===b?'hot':''}" style="--a:${Math.round(v/mx*28)}"${Math.round(t)===b?' title="Your target band"':''}>${v||'–'}</td>`}).join('')}</tr>`;
  const warn=[],T=A.total,needF=T*(1-A.pr/100),needP=T*A.pr/100;
  if(!A.topics.length)warn.push('Choose at least one subtopic.');
  else{if(tf+tp<T)warn.push(`These topics only have ${Math.round(tf+tp)} marks of questions. The exam will come out shorter than ${T} marks.`);
    else{if(tp<needP*.9)warn.push(`Only ${Math.round(tp)} problem-solving marks are available, short of the ${Math.round(needP)} you asked for.`);if(tf<needF*.9)warn.push(`Only ${Math.round(tf)} fluency marks are available, short of the ${Math.round(needF)} you asked for.`)}
    if(A.mcq>nm)warn.push(`Only ${nm} multiple-choice question${nm===1?'':'s'} in these topics.`);
    if(!EX_SRC.some(([k])=>A.src[k]))warn.push('Choose at least one kind of paper to draw from.')}
  el.innerHTML=`<div class="poolline"><b>${pool.length}</b> questions · <b>${Math.round(tf)}</b> fluency marks · <b>${Math.round(tp)}</b> problem-solving marks · <b>${nm}</b> multiple choice</div>
    <table class="avail"><colgroup><col class="kc"><col span="5"></colgroup><thead><tr><th></th>${[2,3,4,5,6].map(b=>`<th scope="col" title="Band ${b}">B${b}</th>`).join('')}</tr></thead><tbody>${row('F','Fluency',A.dF)}${row('P','Problem solving',A.dP)}</tbody></table>
    <div class="availcap"><span>Marks available at each band</span><span><i></i>Your target</span></div>
    ${warn.length?`<div class="warnbox">${warn.map(w=>`<p>${esc(w)}</p>`).join('')}</div>`:''}`;
  exLabels()}
function exResult(){const el=$('#gResult');if(!el)return;const r=exA().last;if(!r||!EX.items.length){el.innerHTML='';return}
  const tm=(r.F+r.P)||1,pct=Math.round(r.P/tm*100);
  el.innerHTML=`<div class="result">Last exam: <b>${r.n}</b> questions, <b>${r.marks}</b> marks${r.nM?` (${r.nM} multiple choice)`:''}. ${100-pct}% fluency${r.dF!=null?` at band ${r.dF.toFixed(1)}`:''}, ${pct}% problem solving${r.dP!=null?` at band ${r.dP.toFixed(1)}`:''}. Covers ${r.topics} of ${r.chosen} chosen subtopic${r.chosen===1?'':'s'}.
    ${r.warns&&r.warns.length?`<ul class="xa-warn">${r.warns.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:''}
    <div class="genrow"><button type="button" class="act" data-expv="exam">Open exam</button><button type="button" class="act" data-exv="pick">Swap questions</button></div></div>`}
function exSetTopics(list){const A=exA();A.topics=[...new Set(list)];xaSave();exTopics();exAvail()}

/* ---------- Pick by hand ---------- */
function renderPick(){exSideNav();exFilters();exList();xPanel()}
function exSideNav(){const el=$('#exSide');if(!el)return;const tree=xaTree(),homes=xaHomes(),cnt={},cntA={};let all=0;
  // owner 17 Nov (skill gates): each topic counts what browsing it would show (its own subtopics count as learnt, XG.pickExtra)
  const A=exA(),base=[...A.topics,...XG.homesOf()],L0=XG.learnt(base).L,Ls=new Map(),Lof=(k,ks)=>{if(!Ls.has(k))Ls.set(k,XG.learnt([...base,...ks]).L);return Ls.get(k)};
  const raw={};B.questions.forEach(q=>{if(q.dup_of||!inBank(q))return;const h=homes.get(q.id);if(XG.ok(q,L0))all++;if(!h)return;raw[h.sub]=(raw[h.sub]||0)+1;const [y,fa]=h.area.split('|');
    if(XG.ok(q,Lof(h.sub,[h.sub])))cnt[h.sub]=(cnt[h.sub]||0)+1;if(XG.ok(q,Lof('fa:'+h.area,tree[y]?.get(fa)||[])))cntA[h.area]=(cntA[h.area]||0)+1});
  const T=EXV.pk.topic;
  el.innerHTML=`<div class="exsidehd"><b>Topics</b><button type="button" class="linkbtn exnarrow-s" data-exclose>Close</button></div><p class="ex-cntnote">${CNT_NOTE.pick}</p><button type="button" class="tb" data-pt="all" aria-current="${T==='all'}"><span>All questions</span><span class="c">${all}</span></button>`+[12,11].map(y=>`<h3>Year ${y}</h3>`+[...tree[y]].map(([fa,ks])=>{const ak=y+'|'+fa,open=EXV.pkOpen.has(ak)||T==='fa:'+ak||(T.startsWith('sub:')&&ks.includes(T));
    return `<details class="exfa"${open?' open':''} data-pfa="${esc(ak)}"><summary><span>${esc(fa)}</span><span class="c">${cntA[ak]||0}</span></summary><div class="subs">
      ${ks.length>1?`<button type="button" class="tb" data-pt="fa:${esc(ak)}" aria-current="${T==='fa:'+ak}"><span>All of ${esc(fa)}</span><span class="c">${cntA[ak]||0}</span></button>`:''}
      ${ks.map(k=>`<button type="button" class="tb${cnt[k]?'':' ex-empty'}" data-pt="${esc(k)}" aria-current="${T===k}"${(raw[k]||0)>(cnt[k]||0)?` title="${cnt[k]||0} of ${raw[k]} with this main topic: ${raw[k]-(cnt[k]||0)} need${raw[k]-(cnt[k]||0)===1?'s':''} a topic not learnt yet"`:''}><span>${esc(subName(k))}</span>${cnt[k]?`<span class="c">${cnt[k]}</span>`:'<span class="none">none yet</span>'}</button>`).join('')}</div></details>`}).join('')).join('')}
function exFilters(){const el=$('#exMain');if(!el||el.dataset.ready)return;el.dataset.ready=1;const F=EXV.pk;
  const groups={hsc:'NESA HSC',trial:'Trial papers',internal_exam:'School tasks'};let o='<option value="all">All papers</option>';
  Object.entries(groups).forEach(([k,lab])=>{const ds=Object.values(B.docs).filter(d=>d.task_type===k&&B.questions.some(q=>String(q.doc)===String(d.id))).sort((a,b)=>String(b.label).localeCompare(String(a.label)));if(!ds.length)return;
    o+=`<optgroup label="${lab}"><option value="t:${k}">All ${lab.toLowerCase()}</option>${ds.map(d=>`<option value="${d.id}">${esc(docLabel(d))}</option>`).join('')}</optgroup>`});
  el.innerHTML=`<div class="exfilters"><input type="search" id="fq" placeholder="Search questions, e.g. geometric series, normal distribution, 2023 Q24" aria-label="Search questions" value="${esc(F.q)}">
      <select id="fpaper" aria-label="Paper">${o}</select>
      <select id="ftype" aria-label="Question type"><option value="all">MCQ and written</option><option value="mcq">Multiple choice</option><option value="written">Written response</option></select>
      <select id="fmarks" aria-label="Marks"><option value="all">Any marks</option><option value="1">1 mark</option><option value="2">2 marks</option><option value="3">3 marks</option><option value="4">4 marks</option><option value="5">5+ marks</option></select>
      <select id="fband" aria-label="Band"><option value="all">Any band</option><option value="lo">Band 2–3</option><option value="mid">Band 4</option><option value="hi">Band 5–6</option></select>
      <select id="fwm" aria-label="Kind"><option value="all">Fluency and problem solving</option><option value="uf">Fluency</option><option value="pr">Problem solving</option></select>
      <select id="fsort" aria-label="Sort"><option value="new">Newest paper first</option><option value="old">Oldest paper first</option><option value="easy">Easiest first</option><option value="hard">Hardest first</option><option value="mup">Marks, low to high</option><option value="mdown">Marks, high to low</option></select>
      <label class="exck"><input type="checkbox" id="ffig"${F.fig?' checked':''}> Has a diagram</label>
      <label class="exck"><input type="checkbox" id="fhide"${F.hide?' checked':''}> Hide questions already in the exam</label></div>
    <div class="xl-wrap" id="exLearntP"></div>
    <div class="exlisthead"><div><h2 id="exLt">All questions</h2><div class="sub" id="exLs"></div></div><div class="acts"><button class="act" id="exAddRand" type="button">Add 5 at random</button><button class="act" id="exAddAll" type="button">Add all shown</button></div></div>
    <div class="excards" id="exCards"></div><button class="act exmore" id="exMore" type="button" hidden>Show more</button>`;
  ['paper','type','marks','band','wm','sort'].forEach(k=>{const s=$('#f'+k);if(s)s.value=F[k]})}
let EXCUR=[];
function exFiltered(){const F=EXV.pk,homes=xaHomes();let qs=B.questions.filter(q=>!q.dup_of&&inBank(q));
  if(F.topic!=='all')qs=qs.filter(q=>{const h=homes.get(q.id);return h&&(F.topic.startsWith('fa:')?h.area===F.topic.slice(3):h.sub===F.topic)});
  if(F.q){const s=F.q.toLowerCase();qs=qs.filter(q=>[qid(q),qid(q).replace(' ',''),String(q.id),srcLine(q),q.stem,...q.parts.map(p=>p.latex),...q.parts.flatMap(p=>p.skills||[])].join(' ').toLowerCase().includes(s))}
  if(F.paper!=='all')qs=qs.filter(q=>F.paper.startsWith('t:')?B.docs[q.doc]?.task_type===F.paper.slice(2):String(q.doc)===F.paper);
  if(F.type!=='all')qs=qs.filter(q=>(F.type==='mcq')===(q.type==='mcq'));
  if(F.marks!=='all')qs=qs.filter(q=>F.marks==='5'?(+q.marks>=5):+q.marks===+F.marks);
  if(F.band!=='all'||F.wm!=='all')qs=qs.filter(q=>qDifOK(q,{band:F.band,wm:F.wm}));
  if(F.fig)qs=qs.filter(q=>figKeys(q).all.length>0);if(F.hide)qs=qs.filter(q=>!EX.items.includes(q.id));
  // owner 17 Nov: "lets do skill gates, that's important": questions needing a topic not yet learnt are left out (or marked, with the switch)
  const g=XG.learnt(XG.pickExtra(exA())),sp=XG.split(qs,g.L);EXV.gate={g,sp};qs=sp.keep;
  const yr=q=>parseInt(docLabel(B.docs[q.doc]))||0,num=q=>parseInt(q.number)||0,d=q=>exEst(q)?.d??9;
  const cmp={new:(a,b)=>yr(b)-yr(a)||docLabel(B.docs[a.doc]).localeCompare(docLabel(B.docs[b.doc]))||num(a)-num(b),old:(a,b)=>yr(a)-yr(b)||docLabel(B.docs[a.doc]).localeCompare(docLabel(B.docs[b.doc]))||num(a)-num(b),
    easy:(a,b)=>d(a)-d(b),hard:(a,b)=>d(b)-d(a),mup:(a,b)=>(+a.marks||0)-(+b.marks||0),mdown:(a,b)=>(+b.marks||0)-(+a.marks||0)}[F.sort]||(()=>0);
  return qs.sort(cmp)}
function exList(reset=true){const box=$('#exCards');if(!box)return;const F=EXV.pk;if(reset)F.limit=20;
  // Fix 1 (owner 14 Nov: "Ok we should run Fix 1 and 2"): search reads the question text, so the first search loads every topic
  // file; the cards shown load their topic files before they are drawn (exList._g drops an answer a newer call has replaced)
  const g=exList._g=(exList._g||0)+1,again=()=>{if(exList._g===g)exList(reset)};
  if(F.q&&!QG.hasAll()&&!QG.failed.size){box.innerHTML='<div class="exempty">Searching every topic…</div>';QG.needAll().then(again);return}
  EXCUR=exFiltered();const t=F.topic;{const lp=$('#exLearntP');if(lp)lp.innerHTML=XG.html('pick',EXV.gate.g,EXV.gate.sp)}
  $('#exLt').textContent=t==='all'?'All questions':t.startsWith('fa:')?t.split('|')[1]:subName(t);
  const inEx=EXCUR.filter(q=>EX.items.includes(q.id)).length;
  $('#exLs').textContent=`${EXCUR.length} question${EXCUR.length===1?'':'s'}${inEx?` · ${inEx} in the exam`:''}${bankAll()||!isEditor()?'':' · approved only'}`;
  const show=EXCUR.slice(0,F.limit);if(show.some(q=>!QG.has(q)&&!QG.failed.has(q.h))){if(reset)box.innerHTML='<div class="exempty">Loading questions…</div>';QG.need(show).then(again);return}
  const have=new Set($$('#exCards > .card').map(c=>+c.dataset.q));
  if(reset){box.innerHTML='';have.clear()}
  const add=show.filter(q=>!have.has(q.id)),tmp=document.createElement('div');tmp.innerHTML=add.map(cardHTML).join('');
  [...tmp.children].forEach(c=>{box.appendChild(c);const q=xq(+c.dataset.q);hydrate(c,q,'bank');TSIO.observe(c);XG.note(c,q,EXV.gate.g.L);
    const u=EXAS.usedTag(q);if(u)c.insertAdjacentHTML('afterbegin',`<div class="exusedrow">${u}</div>`)});   // owner 19 Nov: where it was used before
  if(!EXCUR.length)box.innerHTML='<div class="exempty">No questions match. Try another topic or clear a filter.</div>';
  $('#exMore').hidden=EXCUR.length<=F.limit;$('#exMore').textContent=`Show more (${EXCUR.length-F.limit} left)`}

/* the exam panel inside the page: stage-1 panel with Swap / Lock on each row (stage 2), no drawer. Drawn by xPanel (20_exam.js). */

/* ---------- paper: editable cover, answer lines, diagram sizes ---------- */
const exLnKey=(q,p)=>q.id+':'+p.id;
const exLnDef=m=>Math.max(3,Math.min(24,Math.round((+m||1)*3)));
// every diagram slot on the paper (inline \exfigure ones too) gets a corner handle.
// owner 14 Nov: "resizing is really unintuitive, it should just be drag the corner in and out diagonally". The − 100% + pill is
// gone. The slot sits in an inline box (.exfigbox) the size of the drawn diagram, so the handle is on the diagram's own corner;
// a live "%" (.figpct) shows only while dragging; double-click (or double-tap) the handle to reset; arrow keys on the focused
// handle step 5%. The size is still EX.figscale[k] (30-200%), applied as --fs (zoom) on the slot.
const exFigWrap=k=>{const s=EX.figscale[k]||1,p=Math.round(s*100);return `<span class="exfigw" data-figw="${k}" style="--fs:${s}"><span class="exfigbox"><span class="figslot" data-fig="${k}"></span><span class="figpct" aria-hidden="true">${p}%</span><span class="figh" data-figh="${k}" role="slider" tabindex="0" aria-label="Diagram size" aria-valuemin="30" aria-valuemax="200" aria-valuenow="${p}" aria-valuetext="${p}%" title="Drag the corner to resize · double-click to reset"></span></span></span>`};
// a leaf part's answer lines: the per-part count (EX.lines) with +/- controls; the default is 3 per mark (3 to 24)
const exLines=(q,p)=>{const k=exLnKey(q,p),def=exLnDef(p.marks??q.marks),v=EX.lines[k]??def;
    return `<div class="xlines exln${v?'':' ex-empty'}" data-ln="${k}">${'<i></i>'.repeat(v)}<span class="lnctl"><button type="button" data-lnd="-1" aria-label="Fewer lines"${v<=0?' disabled':''}>−</button><span class="lnn">${v} line${v===1?'':'s'}</span><button type="button" data-lnd="1" aria-label="More lines"${v>=40?' disabled':''}>+</button></span></div>`};
const ED=(field,tag,cls,ph,val)=>{const v=val!=null?val:(EX[field]||'');return `<${tag} class="${cls} ed${v?'':' ed-empty'}" contenteditable="true" spellcheck="true" data-edit="${field}" data-ph="${esc(ph)}" title="Click to edit">${esc(v)}</${tag}>`};
const exRuns=a=>{const o=[];for(let i=0;i<a.length;i++){let j=i;while(j+1<a.length&&a[j+1]===a[j]+1)j++;o.push(j>i+1?`${a[i]}–${a[j]}`:j===i+1?`${a[i]}, ${a[j]}`:`${a[i]}`);i=j}return o.join(', ')};
const EX_INSTR=['Write using black pen','Calculators approved by NESA may be used','A reference sheet is provided'];
// owner 14 Nov: "the cover page does not look super professional. Additionally, the year (HSC or Preliminary) and the
// course Mathematics Advanced should be on separate lines." NESA-like: school, then certificate, course and title on their
// own lines, a rule structure, well-spaced name lines, a hairline stats row and a two-column instructions block.
// The certificate comes from the questions (all Year 11 -> "Preliminary", else HSC) and is editable (EX.cert).
const exCertAuto=()=>{const qs=EX.items.map(xq).filter(Boolean);return qs.length&&qs.every(q=>qYear(q)===11)?'Preliminary':'Higher School Certificate'};
// owner 14 Nov: "The cover page TOPIC is too wide, the questions are far too cramped": runs never break inside
const exRunsH=a=>exRuns(a).split(', ').map(r=>`<span>${r}</span>`).join(', ');
// owner 18 Nov (screenshot of a NESA cover: "Total marks: 100" beside "Section I – 10 marks (pages 1–6)", "Attempt Questions 1–10",
// "Allow about 15 minutes for this section", then Section II the same): "in terms of the cover page format, the marks part should like
// something like this in terms of layout. implement this as well". Each section's time is its share of the working time by marks
// (rounded to 5 minutes, Section II takes the rest), and its pages are filled in once the paper is laid out (EXSEC.pages)
const EXSEC={   // one page-wide name (CODE_HEALTH rule 1)
  // owner 18 Nov: "find the CMC education logo in our drive and add it in instead of saying CMC education": "CMC Logo Black.svg" from
  // the CMC Resources drive (read only), cropped to the artwork, its <style> class turned into one fill (no page-wide CSS)
  logo:'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjIzLjUgMjAuNSA5NC4xIDQzLjgiIGZpbGw9IiMxMTEiPjxnPjxnPjxwb2x5Z29uIHBvaW50cz0iMzMuMSA2MS4yIDM1LjggNjEuMiAzNS44IDYwLjYgMzMuMSA2MC42IDMzLjEgNTguOSAzNi4yIDU4LjkgMzYuMiA1OC4yIDMyLjMgNTguMiAzMi4zIDYzLjcgMzYuMyA2My43IDM2LjMgNjMgMzMuMSA2MyAzMy4xIDYxLjIiLz48cGF0aCBkPSJNNDUuMyw1OC41Yy0uNS0uMi0xLS4zLTEuNS0uM2gtMi4zdjUuNWgyLjNjLjYsMCwxLjEtLjEsMS41LS4zLjUtLjIuOC0uNiwxLTEsLjItLjQuNC0uOS40LTEuNHMtLjEtMS0uNC0xLjRjLS4yLS40LS42LS43LTEtMVpNNDUuNyw2MmMtLjIuMy0uNC42LS44LjdzLS43LjMtMS4yLjNoLTEuNXYtNC4xaDEuNWMuNCwwLC44LDAsMS4yLjNzLjYuNC44LjdjLjIuMy4zLjcuMywxLjFzMCwuOC0uMywxLjFaIi8+PHBhdGggZD0iTTU1LjcsNjEuM2MwLC42LS4xLDEtLjQsMS4zLS4zLjMtLjcuNC0xLjIuNC0xLDAtMS41LS42LTEuNS0xLjh2LTMuMWgtLjh2My4xYzAsLjguMiwxLjQuNiwxLjguNC40LDEsLjYsMS43LjZzMS4zLS4yLDEuNy0uNmMuNC0uNC42LTEsLjYtMS44di0zLjFoLS44djMuMVoiLz48cGF0aCBkPSJNNjMuNCw1OS4xYy4zLS4yLjctLjMsMS4xLS4zLjYsMCwxLjEuMiwxLjUuN2wuNS0uNWMtLjMtLjMtLjYtLjUtLjktLjZzLS43LS4yLTEuMi0uMi0xLC4xLTEuNS40LS44LjYtMSwxYy0uMy40LS40LjktLjQsMS40cy4xLDEsLjQsMS40Yy4zLjQuNi44LDEsMSwuNC4yLjkuNCwxLjUuNHMuOCwwLDEuMi0uMmMuNC0uMS43LS40LjktLjZsLS41LS41Yy0uNC40LS45LjctMS41LjdzLS44LDAtMS4xLS4zYy0uMy0uMi0uNi0uNC0uOC0uOC0uMi0uMy0uMy0uNy0uMy0xLjFzMC0uOC4zLTEuMWMuMi0uMy40LS42LjgtLjhaIi8+PHBhdGggZD0iTTczLjIsNTguMmwtMi41LDUuNWguOGwuNi0xLjRoMi45bC42LDEuNGguOGwtMi41LTUuNWgtLjhaTTcyLjQsNjEuN2wxLjItMi43LDEuMiwyLjdoLTIuNFoiLz48cG9seWdvbiBwb2ludHM9IjgwLjEgNTguOSA4MiA1OC45IDgyIDYzLjcgODIuOCA2My43IDgyLjggNTguOSA4NC43IDU4LjkgODQuNyA1OC4yIDgwLjEgNTguMiA4MC4xIDU4LjkiLz48cmVjdCB4PSI4OS40IiB5PSI1OC4yIiB3aWR0aD0iLjgiIGhlaWdodD0iNS41Ii8+PHBhdGggZD0iTTk5LjgsNTguNWMtLjQtLjItLjktLjQtMS41LS40cy0xLjEuMS0xLjUuNGMtLjQuMi0uOC42LTEsMS0uMy40LS40LjktLjQsMS40cy4xLDEsLjQsMS40Yy4zLjQuNi44LDEsMSwuNC4yLjkuNCwxLjUuNHMxLS4xLDEuNS0uNGMuNC0uMi44LS42LDEtMSwuMy0uNC40LS45LjQtMS40cy0uMS0xLS40LTEuNGMtLjMtLjQtLjYtLjgtMS0xWk0xMDAuMSw2MmMtLjIuMy0uNC42LS44LjgtLjMuMi0uNy4zLTEuMS4zcy0uOCwwLTEuMS0uM2MtLjMtLjItLjYtLjQtLjgtLjgtLjItLjMtLjMtLjctLjMtMS4xczAtLjguMy0xLjFjLjItLjMuNC0uNi44LS44LjMtLjIuNy0uMywxLjEtLjNzLjgsMCwxLjEuM2MuMy4yLjYuNC44LjguMi4zLjMuNy4zLDEuMXMwLC44LS4zLDEuMVoiLz48cG9seWdvbiBwb2ludHM9IjExMC4zIDU4LjIgMTEwLjMgNjIuMyAxMDcgNTguMiAxMDYuMyA1OC4yIDEwNi4zIDYzLjcgMTA3LjEgNjMuNyAxMDcuMSA1OS42IDExMC40IDYzLjcgMTExLjEgNjMuNyAxMTEuMSA1OC4yIDExMC4zIDU4LjIiLz48L2c+PGc+PHBhdGggZD0iTTExNS4zLDQ2LjljLTIuNywyLjctNi4xLDQuMS0xMC40LDQuMXMtNy43LTEuNC0xMC4zLTQuMWMtMi42LTIuOC0zLjktNi4yLTMuOS0xMC4zczEuMy03LjUsMy44LTEwLjJjMi41LTIuNyw1LjctNC4xLDkuNS00LjFzNS4xLjcsNy4zLDJjMi4yLDEuNCwzLjYsMy4yLDQuMiw1LjdoLjRsLS45LTYuMWMtMS4zLS45LTMtMS42LTUuMS0yLjEtMi0uNS00LS44LTYtLjgtMy4xLDAtNS45LjctOC40LDItMi41LDEuNC00LjUsMy4yLTUuOSw1LjYtMS40LDIuNC0yLjEsNS0yLjEsOHMuNyw1LjYsMi4yLDhjMS40LDIuNCwzLjUsNC4zLDYuMSw1LjYsMi42LDEuNCw1LjYsMi4xLDguOCwyLjEsNC44LDAsNy45LTEuNCwxMC42LTQuMSwyLjMtMi41LDIuNi0zLjcuMi0xLjNaIi8+PHBhdGggZD0iTTU3LjYsMjFsLTIuMSwxNy4xYzAsLjIsMCwuMywwLC41LDAsLjMtLjEuNi0uMi45LDAsLjEsMCwuMywwLC40LS45LDMuNC0yLjUsNS44LTMuNSw3LTIuNywyLjgtNi4xLDQuMS0xMC40LDQuMXMtNy43LTEuNC0xMC4zLTQuMWMtMi42LTIuOC0zLjktNi4yLTMuOS0xMC4zczEuMy03LjUsMy44LTEwLjJjMi41LTIuNyw1LjctNC4xLDkuNS00LjFzNS4xLjcsNy4zLDJjMi4yLDEuNCwzLjYsMy4yLDQuMiw1LjdoLjRsLS45LTYuMWMtMS4zLS45LTMtMS42LTUuMS0yLjEtMi0uNS00LS44LTYtLjgtMy4xLDAtNS45LjctOC40LDItMi41LDEuNC00LjUsMy4yLTUuOSw1LjYtMS40LDIuNC0yLjEsNS0yLjEsOHMuNyw1LjYsMi4yLDhjMS40LDIuNCwzLjUsNC4zLDYuMSw1LjYsMi42LDEuNCw1LjYsMi4xLDguOCwyLjFzNy40LTEsOS45LTNjMCwwLDAsMCwwLDAsMCwwLC4yLS4xLjMtLjIsMCwwLDAsMCwwLDAsMS4zLTEsNS4zLTMuOSw2LjItMTAuOWwxLjItMTAuMSw3LjEsMTUuMywxLjUtMy40LTkuMS0xOWgtLjRaIi8+PHBvbHlnb24gcG9pbnRzPSI3MC4yIDQ2LjkgNzAuMiA0Ni45IDcwLjIgNDYuOSA3MC4yIDQ2LjkiLz48cGF0aCBkPSJNODgsNTEuMWMtLjgtLjYtMS0xLjEtMS4zLTEuOC0uMy0uNy0uNC0xLjktLjQtMS45bC0zLjUtMjIuMi0yLjEsNC43LDIuNCwxNy45YzAsLjIsMCwuNC4xLjcsMCwuNi4xLDEuMywwLDEuNiwwLC4zLS4xLjYtLjMuOS0uNC42LS44LjktMS41LjloLS41di40aDguOXYtLjRoLS4yYy0uNiwwLTEuMi0uMy0xLjgtLjdaIi8+PC9nPjwvZz48cGF0aCBkPSJNODQuMiwyMWMtLjgsMC0zLjEsMi4yLTUuMiw2LjRsLTkuMywxOC40LTItNC4zLTEuNSwzLjQsMy40LDcuNWguNGMuMi0xLjIuNy0yLjYsMS41LTQuNGw4LjktMjAuMXMwLDAsMS4xLTIuM2MyLjItNC4zLDMuNS00LjUsMi43LTQuNVoiLz48L3N2Zz4=',
  isCMC:()=>/^\s*cmc\s+education\s*$/i.test(EX.school||''),
  mins:t=>{const s=String(t||'').toLowerCase(),h=+(s.match(/([\d.]+)\s*h/)||[])[1]||0,m=+(s.match(/(\d+)\s*m/)||[])[1]||0;return Math.round(h*60+m)},
  dur:m=>{const h=Math.floor(m/60),r=m%60;return [h?`${h} hour${h===1?'':'s'}`:'',r?`${r} minute${r===1?'':'s'}`:''].filter(Boolean).join(' and ')||'0 minutes'},
  // each section: number, roman, questions, marks and minutes (the working time shared by marks, to 5 minutes; Section II the rest)
  secs(mc,wr){const tot=xMarks(mc)+xMarks(wr),W=this.mins(EX.time),secs=[];let m1=0;
    if(mc.length){m1=W&&wr.length?Math.max(5,Math.round(W*xMarks(mc)/tot/5)*5):W;secs.push({n:1,r:'I',q:`1–${mc.length}`,mk:xMarks(mc),min:m1})}
    if(wr.length)secs.push({n:2,r:'II',q:`${mc.length+1}–${mc.length+wr.length}`,mk:xMarks(wr),min:W-m1});
    return secs},
  // owner 18 Nov (NESA sample): the heading at the start of each section: "Section I", then its marks, the questions to attempt and the time
  head(x,guide){return `<div class="xsechd" data-sec="${x.n}"><b>Section ${x.r}</b><p>${x.mk} mark${x.mk===1?'':'s'}</p><p>Attempt Questions ${x.q}</p>${!guide&&x.min>0?`<p>Allow about ${this.dur(x.min)} for this section</p>`:''}</div>`},
  blocks(mc,wr,tot){const W=this.mins(EX.time),secs=this.secs(mc,wr);
    return secs.map(x=>`<div class="cv-sec"><p class="cv-sech"><b>Section ${x.r} – ${x.mk} mark${x.mk===1?'':'s'}</b> <span class="cv-pg" data-pgsec="${x.n}"></span></p><ul><li>Attempt Questions ${x.q}</li>${W&&x.min>0?`<li>Allow about ${this.dur(x.min)} for this section</li>`:''}</ul></div>`).join('')},
  // the pages each section runs over, as the page footers number them (the cover is page 1)
  pages(host){const sh=[...host.querySelectorAll('.sheet')],at=n=>sh.findIndex(s=>s.querySelector(`.xsechd[data-sec="${n}"]`));
    const last=sh.map(s=>!!s.querySelector('section.xq')).lastIndexOf(true);   // the z-score table and reference sheet after it are not a section's pages
    const a1=at(1),a2=at(2),rng=(a,b)=>a<0||b<a?'':a===b?`(page ${a+1})`:`(pages ${a+1}–${b+1})`;
    host.querySelectorAll('.cv-pg').forEach(el=>{el.textContent=el.dataset.pgsec==='1'?rng(a1,a2>=0?a2-1:last):rng(a2,last)})}};
// owner 18 Nov: "the 100 marks, section I and II and working time is redundent because its below. Also remove the student name, teacher
// name, class and date. Just put in the top right in a sensible spot the Name: and Tutor:" (the stats row and the four name lines are gone;
// UI_SPEC "Cover" records the change)
function xCover(mc,wr){exA();const tot=xMarks(mc)+xMarks(wr),homes=xaHomes();if(!Array.isArray(EX.instr))EX.instr=EX_INSTR.slice();
  // marks by topic (focus area of each question's home), with the question numbers
  const T=new Map(),all=[...mc,...wr];all.forEach((q,i)=>{const h=homes.get(q.id),name=h?h.area.split('|')[1]:'Other',e=T.get(name)||{s1:0,s2:0,refs:[]};e[q.type==='mcq'?'s1':'s2']+=+q.marks||0;e.refs.push(i+1);T.set(name,e)});
  const split=mc.length&&wr.length,rows=[...T.entries()].map(([name,e])=>`<tr><th scope="row">${esc(name)}</th><td class="qs">${exRunsH(e.refs)}</td>${split?`<td>${e.s1||'–'}</td><td>${e.s2||'–'}</td>`:''}<td class="tt">${e.s1+e.s2}</td><td class="xsc"></td></tr>`).join('');
  const nq=n=>`${n} question${n===1?'':'s'}`;
  return `<div class="xcover excover">
    <div class="cv-head"><div class="cv-top">${EXSEC.isCMC()?`<img class="cv-logo" src="${EXSEC.logo}" alt="CMC Education">`:ED('school','div','xschool','School')}<div class="cv-who"><span><em>Name:</em><i></i></span><span><em>Tutor:</em><i></i></span></div></div>
      ${ED('cert','div','cv-cert','Certificate',EX.cert||exCertAuto())}
      ${ED('title','div','cv-course','Course')}
      ${ED('sub','h1','cv-title','Exam title')}</div>
    <div class="cv-grid">
      <div class="cv-k">General instructions</div><ul class="cv-v"><li>Reading time – ${ED('reading','span','','10 minutes')}</li><li>Working time – ${ED('time','span','','2 hours')}</li>${EX.instr.map((t,i)=>`<li>${ED('instr:'+i,'span','','Instruction',t)}</li>`).join('')}${wr.length?'<li>For questions in Section II, show relevant mathematical reasoning and/or calculations</li>':''}<li class="exaddli"><button type="button" class="linkbtn" data-addinstr>+ Add an instruction</button></li></ul>
      <div class="cv-k">Total marks: ${tot}</div><div class="cv-v cv-secs">${EXSEC.blocks(mc,wr,tot)}</div>
    </div>
    ${rows&&EX.bytopic!==false?`<div class="extopictbl"><table aria-label="Marks by topic"><colgroup><col class="c-t"><col class="c-q">${split?'<col class="c-n"><col class="c-n">':''}<col class="c-n"><col class="c-s"></colgroup><thead><tr><th scope="col">Topic</th><th scope="col" class="qs">Questions</th>${split?'<th scope="col">Section I</th><th scope="col">Section II</th>':''}<th scope="col">Total</th><th scope="col">Score</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th scope="row">Total</th><td></td>${split?`<td>${xMarks(mc)}</td><td>${xMarks(wr)}</td>`:''}<td class="tt">${tot}</td><td class="xsc">/ ${tot}</td></tr></tfoot></table></div>`:''}</div>`}

/* ---------- preview: A4 sheets, grading panel, Fit pages ---------- */
const EXC=new Map();   // typeset question bodies, so re-laying out after an edit only typesets what changed
const exCKey=(q,doc)=>doc+'|'+q.id+'|'+JSON.stringify(Object.entries(EX.lines||{}).filter(([k])=>k.startsWith(q.id+':')))+'|'+JSON.stringify(figKeys(q).all.map(k=>EX.figscale?.[k]||1));
// owner 19 Nov: "I have no idea what fit pages does" -> asked, "Remove it": questions stay in the order set (Fit pages, which swapped
// nearby questions to fill pages after Generate or on request, is gone)
const exBlockish=el=>{if(/^(mjx-|svg$|img$|table$|figure$|canvas$)/i.test(el.tagName))return false;const d=getComputedStyle(el).display;return ['block','grid','flex','list-item','flow-root'].includes(d)};
// fix 13 Nov (exam pools): a worked solution's text is often ONE inline span holding inline maths, display maths and line
// breaks (span.pbr). It may be cut too, at a line boundary between its children, so it counts as a container that can be cut
const exBlockKid=el=>{const d=getComputedStyle(el).display;return d!=='inline'&&d!=='contents'&&d!=='none'};
const exCuttable=el=>exBlockish(el)||(getComputedStyle(el).display==='inline'&&!/^(mjx-|svg$|img$)/i.test(el.tagName)&&[...el.children].some(exBlockKid));
// the bottom of what a column actually holds (grid columns are stretched to the row's height, so the box itself says nothing)
const exInkBottom=el=>{let b=-1e9;for(const c of el.children){const r=c.getBoundingClientRect();if(r.height>0)b=Math.max(b,r.bottom)}return b};
// the places where a new line starts in running text: before or after a block child, or at a word that wraps to a new line.
// Returns {at: the node to move on} for the last such place above lim, or {into: a child to cut inside} when none is found.
function exFlowCut(el,lim){const A=[],rg=document.createRange();
  const rects=n=>{let L;if(n.nodeType===1)L=[...n.getClientRects()];else{rg.selectNodeContents(n);L=[...rg.getClientRects()]}L=L.filter(r=>r.width>0||r.height>0);return L};
  for(const n of el.childNodes){
    if(n.nodeType===1){const L=rects(n);if(!L.length)continue;A.push({node:n,off:null,top:L[0].top,bot:L[L.length-1].bottom,bottom:Math.max(...L.map(r=>r.bottom))});continue}
    if(n.nodeType!==3)continue;const t=n.textContent;
    for(let o=0;o<t.length;o++){if(/\s/.test(t[o])||(o>0&&!/\s/.test(t[o-1])))continue;rg.setStart(n,o);rg.setEnd(n,o+1);const r=[...rg.getClientRects()].find(r=>r.height>0);if(r)A.push({node:n,off:o,top:r.top,bot:r.bottom,bottom:r.bottom})}}
  let best=-1;for(let i=1;i<A.length;i++){if(A[i].top>lim)break;if(A[i].top>=A[i-1].bot-2&&A[i].top>A[0].top+1)best=i}
  if(best>0){const a=A[best];return {at:a.off?a.node.splitText(a.off):a.node}}
  const x=A.find(a=>a.bottom>lim);return x&&x.off==null&&exCuttable(x.node)?{into:x.node}:null}
function exCutTall(blk,H,open){const lim=blk.getBoundingClientRect().top+H*0.98,path=[];let el=blk.querySelector('section.xq > .xqb');
  for(let d=0;el&&d<12;d++){const kids=[...el.children].filter(k=>k.getBoundingClientRect().height>0);if(!kids.length)return null;
    const R=kids.map(k=>k.getBoundingClientRect()),stacked=kids.length===1||R.every((r,i)=>!i||r.top>=R[i-1].bottom-2);
    // fix 13 Nov (exam pools): running text (a worked solution is often ONE inline span of words, inline maths, display maths and
    // line breaks): cut at the start of the last line that begins above the page end, splitting a text node between words if need be
    {const ds=getComputedStyle(el).display;if(ds!=='grid'&&ds!=='flex'&&([...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())||kids.some(k=>!exBlockKid(k)))){
      const r=exFlowCut(el,lim);if(r&&r.at)return exCont(blk,path,[r.at],open);
      if(r&&r.into){path.push({par:el,child:r.into,stacked:true});el=r.into;continue}return null}}
    if(stacked){const i=R.findIndex(r=>r.bottom>lim);if(i<0)return null;if(i>0)return exCont(blk,path,[kids[i]],open);
      if(!exCuttable(kids[0]))return null;path.push({par:el,child:kids[0],stacked:true});el=kids[0];continue}
    // side by side: cut inside the column whose CONTENT runs furthest down (fix 13 Nov: all grid columns are stretched to the
    // row's height, so "the tallest column" picked the empty label column and the cut gave up)
    let t=0;const ink=kids.map(exInkBottom);ink.forEach((b,j)=>{if(b>ink[t])t=j});if(!exCuttable(kids[t]))return null;
    path.push({par:el,child:kids[t],stacked:false});el=kids[t]}
  return null}
function exCont(blk,path,move,open){const q2=open(false),nb=q2.closest('.xblk');blk.after(nb);let host=q2;
  for(const {par,child,stacked} of path){const sh=child.cloneNode(false);sh.dataset.cut='1';   // data-cut: 1 = a copy of a wrapper, x = an empty column (exRejoin undoes them)
    if(stacked){host.appendChild(sh);let n=child.nextSibling;const later=[];while(n){later.push(n);n=n.nextSibling}later.forEach(x=>host.appendChild(x))}   // text nodes too, so exRejoin restores the exact order
    else [...par.children].forEach(s=>{if(s===child)host.appendChild(sh);else{const e=s.cloneNode(false);e.dataset.cut='x';host.appendChild(e)}});
    host=sh}
  let n=move[0];const all=[];while(n){all.push(n);n=n.nextSibling}all.forEach(x=>host.appendChild(x));return nb}
// The Word file flows its own pages, so it gets each question whole, as before: pieces cut inside a part (exCont) are put back
// together in its copy of the sheets (30_word.js). Pieces cut between parts stay as they always were.
function exRejoin(root){let last=new Map();
  const merge=(dst,src)=>{[...src.childNodes].forEach(c=>{if(c.nodeType===1&&c.dataset.cut==='x')return;
    if(c.nodeType===1&&c.dataset.cut==='1'){const t=[...dst.children].reverse().find(d=>d.tagName===c.tagName&&d.className===c.className);if(t){merge(t,c);return}c.removeAttribute('data-cut')}
    dst.appendChild(c)});dst.normalize()};   // fix 13 Nov: text split at a line (exFlowCut) becomes one text node again
  root.querySelectorAll('section.xq').forEach(sec=>{const qb=sec.querySelector(':scope>.xqb'),prev=last.get(sec.dataset.q);
    if(prev&&qb&&qb.querySelector(':scope>[data-cut]')){merge(prev.querySelector(':scope>.xqb'),qb);const src=sec.querySelector(':scope>.xsrc');if(src)prev.appendChild(src);sec.closest('.xblk')?.remove();return}
    last.set(sec.dataset.q,sec)})}
async function xPreview(doc,opts={}){exA();EXV.doc=doc;let ov=$('#xPv');
  if(!ov){ov=document.createElement('div');ov.id='xPv';ov.className='xpv expv';document.body.appendChild(ov)}
  const keepScroll=opts.keep?ov.scrollTop:0;
  if(!opts.keep||!$('#xPages')){
    ov.innerHTML=`<div class="xtool"><div class="xseg"><button data-xdoc="exam" aria-pressed="${doc==='exam'}">Exam paper</button><button data-xdoc="guide" aria-pressed="${doc==='guide'}">Marking guide</button></div>
      <span class="xinfo" id="xInfo">Laying out pages…</span><span class="sp"></span>
      <button class="act" id="exGrade" aria-pressed="${EXV.grade}">Grading</button><button class="act" id="exPvTopic" aria-pressed="${EX.bytopic!==false}" title="Show the marks-by-topic table at the bottom of the cover">Topic table</button>
      <button class="act" id="exPvRegen"${exA().topics.length?'':' disabled title="Choose topics in Exam setup first"'}>Regenerate</button><button class="act" id="exPvSwap">Swap questions</button>
      <button class="act ok" id="xDl" disabled>Download to print</button><button class="act ghost" id="xPvClose">Close</button></div>
      <div class="expvbody"><div class="xpages" id="xPages"></div><aside class="expvside" id="exGSide" aria-label="Question grading"></aside></div>`}
  else{$$('[data-xdoc]',ov).forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.xdoc===doc)));$('#xInfo').textContent='Laying out pages…'}
  if(!opts.keep)EXV.grade=innerWidth>1000;   // phones: the grading panel is a slide-over, closed until asked for
  if(!document.body.classList.contains('xpv-on')){EXV.pageY=scrollY;window.scrollTo(0,0)}   // a scrolled page underneath misplaces the fixed panels on phones
  ov.hidden=false;document.body.classList.add('xpv-on');ov.classList.toggle('grade-off',!EXV.grade);$('#exGrade')?.setAttribute('aria-pressed',String(EXV.grade));
  await QG.need(EX.items.map(xq));   // Fix 1 (owner 14 Nov: "Ok we should run Fix 1 and 2"): the paper's questions' topic files, before layout
  const bl=xBlocks(doc),meas=document.createElement('div');meas.className='xmeasure sheetbody';
  meas.innerHTML=bl.map((b,i)=>`<div class="xblk${b.cover?' cover':''}" data-i="${i}">${b.html}</div>`).join('');document.body.appendChild(meas);
  bl.forEach((b,i)=>{if(!b.q)return;const el=meas.querySelector(`[data-i="${i}"]`),c=EXC.get(exCKey(b.q,doc)),qb=el.querySelector('.xqb');
    if(c&&qb){qb.innerHTML=c;el.dataset.cached=1}else hydrate(el,b.q,'bank')});
  await typeset(meas);await xWait(meas);await typeset(meas);
  bl.forEach((b,i)=>{if(!b.q)return;const el=meas.querySelector(`[data-i="${i}"]`);if(!el.dataset.cached){const qb=el.querySelector('.xqb');if(qb)EXC.set(exCKey(b.q,doc),qb.innerHTML)}});
  $$('img.fig',meas).forEach(im=>{im.style.maxWidth='100%'});
  // 14 Nov: content height 250 mm, not 259: the review pass measured only ~250 mm fitting inside a 297 mm sheet (padding + footer), so full sheets ran past A4 and were cut off in PDF/print.
  const probe=document.createElement('div');probe.style.height='250mm';meas.appendChild(probe);const H=probe.getBoundingClientRect().height;probe.remove();
  // hardening 14 Nov (page test): with many topics the cover ran past 297 mm, and the PDF and print cut "Marks by topic" off.
  // When the cover is too tall, the table moves to a page of its own straight after it (the Word file still puts it on its cover)
  // owner 18 Nov: "it's very important marks by topic is on the cover page": a cover too tall for its sheet no longer sends the table to
  // the next page; the table's type steps down (to 6.5 pt at the least) until the cover fits
  {const ci=bl.findIndex(b=>b.cover),cv=ci>=0?meas.children[ci]:null,tt=cv&&cv.querySelector('.extopictbl table');
    for(let pt=8.5;tt&&pt>=6.5&&cv.getBoundingClientRect().height>H*0.98;pt-=0.5)tt.style.fontSize=pt+'pt';
    // still too tall (many topics): the whole cover is scaled down to fit its sheet
    const xc=cv&&cv.querySelector('.xcover'),hh=cv&&cv.getBoundingClientRect().height;if(xc&&hh>H*0.98)xc.style.zoom=String(Math.floor(H*0.97/hh*1000)/1000)}
  // a question taller than a page is cut between its parts; later pieces say "(continued)"
  let els=[...meas.children];const bl2=[];
  // 18 Nov: a question straight after a section heading shares the heading's sheet (a heading never ends a sheet alone), so its first
  // piece must fit under the heading (the NESA-style heading is about 30 mm tall)
  els=els.flatMap((el,i)=>{const sec=el.querySelector('section.xq'),hp=i>0&&bl[i-1]?.sec?els[i-1].getBoundingClientRect().height+parseFloat(getComputedStyle(els[i-1]).marginBottom||0):0,lim=j=>j===0?H-hp:H;
    if(!sec||el.getBoundingClientRect().height<=lim(0)*0.98){bl2.push(bl[i]);return [el]}
    const head=sec.firstElementChild,qb=sec.querySelector('.xqb'),src=sec.querySelector('.xsrc'),kids=[...qb.children],pieces=[];
    const open=first=>{const b=document.createElement('div');b.className='xblk';const s2=document.createElement('section');s2.className=sec.className;s2.dataset.q=sec.dataset.q;
      if(first)s2.appendChild(head);else s2.insertAdjacentHTML('beforeend',head.classList.contains('xqh')?`<div class="xqh cont"><b>${head.querySelector('b').textContent} (continued)</b><span></span></div>`:'');
      const q2=document.createElement('div');q2.className='xqb';s2.appendChild(q2);b.appendChild(s2);meas.insertBefore(b,el);pieces.push(b);return q2};
    let box=open(true);
    kids.forEach(k=>{box.appendChild(k);const h=box.closest('.xblk').getBoundingClientRect().height;if(h>lim(pieces.length-1)*0.98&&box.children.length>1){box.removeChild(k);box=open(false);box.appendChild(k)}});
    // hardening 14 Nov (page test): a single part (or one part's worked solution) taller than a page was left whole, so its
    // sheet grew past 297 mm and the PDF / print cut the bottom off. Such a piece is now also cut inside the part, between lines
    for(let k=0;k<pieces.length;k++){let g=0;while(pieces[k].getBoundingClientRect().height>lim(k)*0.98&&g++<40){const nx=exCutTall(pieces[k],lim(k),open);if(!nx)break;pieces.splice(pieces.indexOf(nx),1);pieces.splice(k+1,0,nx);k++}}
    if(src)pieces[pieces.length-1].querySelector('section').appendChild(src);el.remove();pieces.forEach(()=>bl2.push({q:bl[i].q}));return pieces});
  bl.length=0;bl.push(...bl2);
  const sheets=[];let cur=null,used=0;const start=()=>{cur=[];sheets.push(cur);used=0};
  els.forEach((el,i)=>{const b=bl[i],h=el.getBoundingClientRect().height+parseFloat(getComputedStyle(el).marginBottom||0);
    const nextH=b.sec&&els[i+1]?els[i+1].getBoundingClientRect().height:0,onlyHead=cur&&cur.length===1&&bl[els.indexOf(cur[0])]?.sec;
    if(!cur||b.cover||b.newpage||(used+h+nextH>H&&cur.length&&!onlyHead))start();
    cur.push(el);used+=h;if(b.cover)cur=null});
  // owner 19 Nov: "The exam should always have an odd number of pages so no nothing is printing on the back page, add an intentional
  // blank marked page where needed": an even count gets a marked blank page after the last question page (before the z-score table
  // and the reference sheet, which stay at the back)
  if(doc==='exam'&&sheets.length%2===0){const at=sheets.map(s=>s.some(el=>el.querySelector('section.xq'))).lastIndexOf(true)+1,b=document.createElement('div');
    b.className='xblk cover';b.innerHTML='<div class="xblank">This page is intentionally left blank.</div>';sheets.splice(at>0?at:sheets.length,0,[b])}
  const host=$('#xPages');host.innerHTML='';
  sheets.forEach((s,k)=>{const sh=document.createElement('div');sh.className='sheet';const body=document.createElement('div');body.className='sheetbody';s.forEach(el=>body.appendChild(el));sh.appendChild(body);
    // owner 18 Nov: "remove the footer on the cover page", "instead of 1/28 write Page 1 of 28"
    if(!(doc==='exam'&&k===0))sh.insertAdjacentHTML('beforeend',`<div class="sheetfoot">${esc(EX.title)} · ${esc(EX.sub)}${doc==='guide'?' · marking guide':''}<span>Page ${k+1} of ${sheets.length}</span></div>`);host.appendChild(sh)});
  meas.remove();EXSEC.pages(host);scaleTables(host,true);exZoom();
  const qs=EX.items.map(xq).filter(Boolean),tot=xMarks(qs);let F=0,P=0,w=0;qs.forEach(q=>{const e=exEst(q);if(e){F+=e.fl;P+=e.ps;w+=e.d*e.m}});
  $('#xInfo').textContent=`${sheets.length} page${sheets.length===1?'':'s'} · ${qs.length} questions · ${tot} marks${F+P?` · ${Math.round(P/(F+P)*100)}% problem solving · average band ${(w/(F+P)).toFixed(1)}`:''}`;
  $('#xDl').disabled=false;$('#xDl').dataset.doc=doc;
  exGrading();if(opts.keep)ov.scrollTop=keepScroll;else ov.scrollTop=0;
  // owner 14 Nov ("make it so we can export pdfs from here"): Download PDF (29_pdf.js) and Download Word (30_word.js) sit beside
  // "Download HTML" once the pages are laid out
  const dlb=$('#xDl');
  if(dlb&&!$('#xPdf')){dlb.insertAdjacentHTML('beforebegin',`<button class="act ok" id="xPdf" type="button" title="Save the paper as a PDF">Download PDF</button>`);dlb.textContent='Download HTML';dlb.classList.remove('ok');dlb.title='A web page you can print, or save as a PDF with selectable text'}
  const pb=$('#xPdf');
  // owner 17 Nov: "Add a disclaimer the word one is not tested on the user side." Owner 19 Nov: "remove Word export is not yet tested by
  // users: check the file before you print or send it." (the line beside the button is gone; the button keeps "(beta)" and its tooltip)
  if(pb&&!$('#xWord'))pb.insertAdjacentHTML('afterend',`<button class="act" id="xWord" type="button" title="Save as a Word document with editable equations. Not yet tested by users: check the file before you print or send it.">Download Word (beta)</button>`)}
function exZoom(){const h=$('#xPages');if(!h)return;const tb=$('#xPv .xtool');if(tb)$('#xPv').style.setProperty('--tool',tb.offsetHeight+'px');const side=EXV.grade&&innerWidth>1000?380:0,avail=innerWidth-side-24;const z=Math.min(1,avail/800);h.style.zoom=z<.999?String(Math.max(.4,z)):'';
  // owner 14 Nov (ⓘ, diagram handle): screen-only controls on a scaled paper divide by this, so they keep a usable size on a phone
  h.style.setProperty('--xz',z<.999?String(Math.max(.4,z)):'1')}
addEventListener('resize',()=>{if(document.body.classList.contains('xpv-on'))exZoom()});
const exRelayout=()=>document.body.classList.contains('xpv-on')?xPreview(EXV.doc,{keep:true}):Promise.resolve();

/* grading panel */
const kindCls=k=>k==='Problem solving'?'Problem':k;
const exMeter=(d,k)=>`<span class="exmeter ${kindCls(k)}" aria-label="Band ${d.toFixed(1)}">${[2,3,4,5,6].map(i=>`<i class="${Math.round(d)>=i?'on':''}"></i>`).join('')}</span>`;
function exGrading(){const el=$('#exGSide');if(!el)return;const qs=EX.items.map(xq).filter(Boolean);let F=0,P=0,wF=0,wP=0;
  qs.forEach(q=>{const e=exEst(q);if(!e)return;F+=e.fl;P+=e.ps;wF+=(e.dF||0)*e.fl;wP+=(e.dP||0)*e.ps});
  const split=qs.some(q=>q.type==='mcq')&&qs.some(q=>q.type!=='mcq'),sec=q=>q.type==='mcq'?1:2;
  // owner 14 Nov: "The dot point home looks stupid in a question": the dot points moved off the paper into this detail (and the
  // paper's ⓘ card), "where they belong"
  const gdots=q=>`<div class="gdots"><b>Dot points</b>${qiDotsList(q,'gdotl')}</div>`;
  const det=q=>{const e=exEst(q);if(!e)return `<div class="gdet"><div class="gsrc">${esc(srcLine(q))} · ${qid(q)}</div><div class="glab">Not rated yet.</div>${gdots(q)}</div>`;const multi=e.parts.length>1;
    return `<div class="gdet"><div class="gsrc">${esc(srcLine(q))} · ${qid(q)} · ${q.marks} mark${q.marks===1?'':'s'}</div>${EXAS.usedTag(q)}
      <div class="glab">Band ${e.d.toFixed(1)} overall · ${fmtM(e.fl)} fluency, ${fmtM(e.ps)} problem-solving mark${e.ps===1?'':'s'}</div>${gdots(q)}
      <table class="gparts"><thead><tr><th>Part</th><th>Marks</th><th>Kind</th><th>Band</th></tr></thead><tbody>${e.parts.map(x=>`<tr><td>${esc(x.lab||'Whole')}</td><td>${fmtM(x.m)}</td><td>${x.ps?'Problem solving':'Fluency'}</td><td>${x.b}</td></tr>`).join('')}</tbody></table>
      <div class="gwhy"><b>Why it was rated this way</b><ul>${e.parts.filter(x=>x.r).map(x=>`<li>${multi&&x.lab?`<span class="pp">${esc(x.lab)}</span> `:''}${exMathTeX(x.r)}</li>`).join('')||'<li>No reason recorded.</li>'}</ul></div>
      <div class="gacts"><button type="button" class="act" data-gswap="${q.id}">Swap for a similar question…</button>${(()=>{const k=repOpen().filter(r=>r.question_id===q.id).length;   // owner 18 Nov: "can u actually put the report on the right bar as well? the grading bar as well"
        return `<button type="button" class="act" data-grep="${q.id}" title="${esc(qiLabel(k))}">${k?`Reported (${k})`:'Report'}</button>`})()}</div></div>`};
  el.innerHTML=`<div class="gtop"><h3>Question grading</h3><button type="button" class="linkbtn" id="exGClose">Hide</button></div><div class="gsub">Click a question on the paper, or in this list.</div>
    <div class="gsum"><div class="f"><b>${fmtM(F)} marks</b>Fluency${F?` · average band ${(wF/F).toFixed(1)}`:''}</div><div class="p"><b>${fmtM(P)} marks</b>Problem solving${P?` · average band ${(wP/P).toFixed(1)}`:''}</div></div>
    <div class="gsub" style="margin:-4px 0 8px">Drag a row to change the order on the paper.</div>
    <ol class="glist">${qs.map((q,i)=>{const e=exEst(q),s=EXV.sel===q.id,first=i===0||sec(qs[i-1])!==sec(q),last=i===qs.length-1||sec(qs[i+1])!==sec(q);
      const head=split&&first?`<li class="gsec">Section ${sec(q)===1?'I · multiple choice':'II · written'}</li>`:'';const k=e?e.kind:'Fluency';
      return `${head}<li class="gq${s?' sel':''}${EXV.moved===q.id?' moved':''}" data-gqli="${q.id}"><div class="gqrow" draggable="true" data-drag="${q.id}"><span class="grip" aria-hidden="true" title="Drag to reorder">⋮⋮</span>
        <button type="button" class="gqh" data-gq="${q.id}" aria-expanded="${s}"><span class="exgn">Q${i+1}</span><span class="exgk ${kindCls(k)}">${k==='Problem solving'?'Problem':k}</span>${e?exMeter(e.d,k):'<span></span>'}<span class="exgd">${q.marks}</span></button>
        <span class="gmv"><button type="button" data-gmv="-1" data-id="${q.id}" aria-label="Move up"${first?' disabled':''}>▲</button><button type="button" data-gmv="1" data-id="${q.id}" aria-label="Move down"${last?' disabled':''}>▼</button></span></div>${s?det(q):''}</li>`}).join('')}</ol>
    <div class="gnote">Bands run from 2 to 6, as in the HSC. Each part was rated against HSC reference parts checked by an editor (Curate › Review › Difficulty). To question a rating, use Report in a question\u2019s ⓘ card.</div>`;typeset(el);   // owner 19 Nov: dot points and reasons carry maths

  $$('#xPages .xq').forEach(x=>x.classList.toggle('sel',+x.dataset.q===EXV.sel))}
function exSelect(id,from){EXV.sel=EXV.sel===id&&from==='list'?null:id;exGrading();
  if(from==='paper'&&innerWidth<=1000&&!EXV.grade){EXV.grade=true;$('#xPv')?.classList.remove('grade-off');$('#exGrade')?.setAttribute('aria-pressed','true')}
  // scroll the overlay / the panel themselves (scrollIntoView can shift the whole viewport on phones)
  const beh=RM.matches?'auto':'smooth',ov=$('#xPv'),side=$('#exGSide');
  if(from==='list'&&EXV.sel){const el=$(`#xPages .xq[data-q="${id}"]`);if(el&&ov){const tb=ov.querySelector('.xtool')?.offsetHeight||0;ov.scrollTo({top:ov.scrollTop+el.getBoundingClientRect().top-ov.getBoundingClientRect().top-tb-12,behavior:beh})}}
  else{const li=$(`#exGSide [data-gqli="${id}"]`);if(li&&side){const r=li.getBoundingClientRect(),sr=side.getBoundingClientRect();if(r.top<sr.top||r.bottom>sr.bottom)side.scrollTo({top:side.scrollTop+r.top-sr.top-60,behavior:beh})}}}
function exOrder(ord,id){EX.items=ord;EXV.moved=id;xsave();exRelayout();clearTimeout(exOrder._t);exOrder._t=setTimeout(()=>{EXV.moved=null},900)}
function exMove(id,d){const qs=EX.items.map(xq).filter(Boolean),i=qs.findIndex(q=>q.id===id),j=i+d;if(j<0||j>=qs.length)return;
  if((qs[i].type==='mcq')!==(qs[j].type==='mcq')){toast('Multiple-choice questions stay in Section I.');return}
  const ord=qs.map(q=>q.id);[ord[i],ord[j]]=[ord[j],ord[i]];exOrder(ord,id)}
function exDrop(id,tid,after){if(id===tid)return;const a=xq(id),b=xq(tid);if(!a||!b)return;if((a.type==='mcq')!==(b.type==='mcq')){toast('Multiple-choice questions stay in Section I.');return}
  const ord=EX.items.filter(x=>x!==id);ord.splice(ord.indexOf(tid)+(after?1:0),0,id);exOrder(ord,id)}
function exClosePv(){xClosePv();if(EXV.pageY)window.scrollTo(0,EXV.pageY);EXV.pageY=0;if(view==='exams'){exHead();if(EXV.view==='setup')exResult();else xPanel()}}

/* download (xDownload) and saving (xSaveDb) are in 20_exam.js */

/* ---------- events ---------- */
// owner 14 Nov: the header "Exam · N" pill opens the Exams page (the drawer is gone)
document.addEventListener('click',e=>{
  if(e.target.closest('#xBtn')){e.preventDefault();e.stopImmediatePropagation();if(EX.items.length&&EXV.view==='setup'&&!exA().topics.length)EXV.view='pick';location.hash='#exams';if(view==='exams')renderExams();return}
  // load a saved exam with all its fields (stage 1 only restored the questions)
  const ld=e.target.closest('#xPanel [data-xload]');if(ld){e.stopImmediatePropagation();const x=XSAVED.find(s=>s.id===ld.dataset.xload);if(!x)return;
    EX={id:x.id,title:x.title,sub:x.sub,school:x.school,cert:x.cert||'',bytopic:x.bytopic!==false,time:x.time,reading:x.reading,items:(x.items||[]).filter(i=>xq(i)),instr:x.instr||undefined,lines:x.lines||{},figscale:x.figscale||{},auto:Object.assign(XA_DEF(),x.auto||{},{avoid:false})};
    xsave();EXC.clear();toast('Exam opened');return}
  if(e.target.closest('#examsView #xClose')){e.stopImmediatePropagation();document.body.classList.remove('exr-open','exs-open');return}
  const rv=e.target.closest('#examsView [data-reveal]');if(rv){e.stopImmediatePropagation();const id=+rv.dataset.reveal;revealed.has(id)?revealed.delete(id):revealed.add(id);const c=rv.closest('.card'),q=xq(id);
    const t=document.createElement('div');t.innerHTML=cardHTML(q);const nc=t.firstElementChild;c.replaceWith(nc);hydrate(nc,q,'bank');XG.note(nc,q,EXV.gate?.g.L);typeset(nc);return}
},true);
document.addEventListener('click',e=>{const t=e.target;
  if(t.closest('#xPv')){
    // owner 14 Nov: the diagram's − / + / reset pill is gone; a click on the corner handle does nothing (drag, double-click or keys)
    if(t.closest('.lnctl,[data-edit],.figh,.figpct,[data-addinstr]')){
      const ln=t.closest('[data-lnd]');if(ln&&!ln.disabled){const box=ln.closest('[data-ln]'),k=box.dataset.ln,cur=box.querySelectorAll('i').length;EX.lines[k]=Math.max(0,Math.min(40,cur+ +ln.dataset.lnd));xsave();exRelayout();return}
      if(t.closest('[data-addinstr]')){EX.instr=[...(EX.instr||EX_INSTR),'New instruction'];xsave();exRelayout();return}
      return}
    if(t.closest('#exGrade')){EXV.grade=!EXV.grade;$('#xPv').classList.toggle('grade-off',!EXV.grade);t.closest('#exGrade').setAttribute('aria-pressed',String(EXV.grade));exZoom();return}
    if(t.closest('#exGClose')){EXV.grade=false;$('#xPv').classList.add('grade-off');$('#exGrade')?.setAttribute('aria-pressed','false');exZoom();return}
    if(t.closest('#exPvSwap')){exClosePv();EXV.view='pick';exSaveView();location.hash='#exams';renderExams();return}
    // owner 18 Nov: "Give an option to toggle that table on and off" (saved with the exam: EX.bytopic, on unless set to false)
    if(t.closest('#exPvTopic')){EX.bytopic=EX.bytopic===false;xsave();t.closest('#exPvTopic').setAttribute('aria-pressed',String(EX.bytopic!==false));exRelayout();return}
    if(t.closest('#exPvRegen')&&!t.closest('#exPvRegen').dataset.ok){const b=t.closest('#exPvRegen');if(b.disabled)return;EXAS.guard(b,'Regenerate',()=>{b.dataset.ok=1;b.click();delete b.dataset.ok});return}
    if(t.closest('#exPvRegen')){const b=t.closest('#exPvRegen');if(b.disabled)return;const r=exGenerate();if(r){EXC.clear();xPreview(EXV.doc);toast(`New exam · ${r.n} questions · ${r.marks} marks`)}return}
    if(t.closest('#xPvClose')){e.stopImmediatePropagation();exClosePv();return}
    const gr=t.closest('[data-grep]');if(gr){const id=+gr.dataset.grep;repForm(id,String(EX.items.indexOf(id)+1));return}
    const gs=t.closest('[data-gswap]');if(gs){xaSwap(+gs.dataset.gswap);return}   // opens the chooser (XA_SW); the swap re-lays out and selects the new question
    const mv=t.closest('[data-gmv]');if(mv){if(!mv.disabled)exMove(+mv.dataset.id,+mv.dataset.gmv);return}
    const gq=t.closest('[data-gq]');if(gq){exSelect(+gq.dataset.gq,'list');return}
    const pq=t.closest('#xPages .xq');if(pq){exSelect(+pq.dataset.q,'paper');return}
    return}
  if(!t.closest('#examsView'))return;
  const v=t.closest('[data-exv]');if(v){EXV.view=v.dataset.exv;exSaveView();renderExams();window.scrollTo({top:0});return}
  const pv=t.closest('[data-expv]');if(pv){if(!EX.items.length){toast('Add questions first');return}xPreview(pv.dataset.expv);return}
  if(t.id==='gGo'&&!t.dataset.ok){EXAS.guard(t,'Generating a new exam',()=>{t.dataset.ok=1;t.click();delete t.dataset.ok});return}
  if(t.id==='gGo'){const r=exGenerate();if(!r)return;if(!r.n){toast('No questions match. Choose more topics or papers.');return}EXC.clear();exResult();exLabels();exHead();xPreview('exam');return}
  const ex=t.closest('[data-texp]');if(ex){const k=ex.dataset.texp;EXV.open.has(k)?EXV.open.delete(k):EXV.open.add(k);exTopics();return}
  const tree=()=>xaTree(),A=exA();
  // owner 17 Nov (skill gates): Already learnt ticks; the exam's own topics are disabled there (they always count)
  const xg=t.closest('[data-xlk],[data-xly11]');if(xg&&!xg.disabled){const ctx=xg.closest('[data-xlctx]')?.dataset.xlctx,g=XG.learnt(ctx==='pick'?XG.pickExtra(A):XG.autoExtra(A));
    if(xg.dataset.xlk)XG.toggle(xg.dataset.xlk,g);else XG.allY11(g);exRefresh();return}
  const sa=t.closest('[data-sall]');if(sa){const y=sa.dataset.sall,ks=(y==='all'?[12,11]:[+y]).flatMap(yy=>[...tree()[yy].values()].flat());const base=new Set(exBase(A,xaHomes()).map(q=>xaHomes().get(q.id).sub));exSetTopics([...A.topics,...ks.filter(k=>base.has(k))]);return}
  const sn=t.closest('[data-snone]');if(sn){const y=sn.dataset.snone;if(y==='all')exSetTopics([]);else{const ks=new Set([...tree()[+y].values()].flat());exSetTopics(A.topics.filter(k=>!ks.has(k)))}return}
  const fb=t.closest('[data-tfa]');if(fb&&!fb.disabled){const [y,...r]=fb.dataset.tfa.split('|'),ks=tree()[y].get(r.join('|'))||[],base=new Set(exBase(A,xaHomes()).map(q=>xaHomes().get(q.id).sub)),live=ks.filter(k=>base.has(k)),all=live.every(k=>A.topics.includes(k));
    exSetTopics(all?A.topics.filter(k=>!ks.includes(k)):[...A.topics,...live]);return}
  const sb=t.closest('[data-tsub]');if(sb&&!sb.disabled){const k=sb.dataset.tsub;exSetTopics(A.topics.includes(k)?A.topics.filter(x=>x!==k):[...A.topics,k]);return}
  const sr=t.closest('[data-src]');if(sr){const k=sr.dataset.src;A.src[k]=!A.src[k];xaSave();sr.setAttribute('aria-pressed',String(A.src[k]));exTopics();exAvail();return}
  const pt=t.closest('[data-pt]');if(pt){EXV.pk.topic=pt.dataset.pt;exSideNav();exList();document.body.classList.remove('exs-open');window.scrollTo({top:0});return}
  if(t.closest('[data-exclose]')){document.body.classList.remove('exs-open','exr-open');return}
  if(t.id==='exMore'){EXV.pk.limit+=20;exList(false);return}
  if(t.id==='exAddAll'){let n=0;EXCUR.slice(0,EXV.pk.limit).forEach(q=>{if(!EX.items.includes(q.id)){EX.items.push(q.id);n++}});xsave();toast(n?`Added ${n} question${n===1?'':'s'}`:'All shown questions are already in the exam');return}
  if(t.id==='exAddRand'){const c=EXCUR.filter(q=>!EX.items.includes(q.id));for(let i=c.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[c[i],c[j]]=[c[j],c[i]]}const pick=c.slice(0,5);pick.forEach(q=>EX.items.push(q.id));xsave();toast(pick.length?`Added ${pick.length} at random`:'Nothing left to add here');return}
  if(t.id==='exTopicsBtn'){document.body.classList.toggle('exs-open');document.body.classList.remove('exr-open');return}
  if(t.id==='exExamBtn'||t.closest('#exExamBtn')){document.body.classList.toggle('exr-open');document.body.classList.remove('exs-open');return}
  if(t.id==='exScrim'){document.body.classList.remove('exs-open','exr-open');return}
});
document.addEventListener('input',e=>{const t=e.target;if(!t.closest)return;
  if(t.closest('#examsView')){const A=exA(),sl={gMarks:'total',gMcq:'mcq',gSplit:'pr',gDF:'dF',gDP:'dP'};
    if(sl[t.id]){A[sl[t.id]]=+t.value;if(t.id==='gMcq')A.mcqSet=true;if(t.id==='gMarks'&&!A.mcqSet){A.mcq=Math.min(10,Math.round(A.total/10));const m=$('#gMcq');if(m)m.value=A.mcq}const al=$('#gAll');if(al)al.value=exOverall(A);xaSave();exLabels();clearTimeout(t._h);t._h=setTimeout(exAvail,60);return}
    if(t.id==='gAll'){A.dF=A.dP=+t.value;$('#gDF').value=A.dF;$('#gDP').value=A.dP;xaSave();exLabels();clearTimeout(t._h);t._h=setTimeout(exAvail,60);return}
    if(t.id==='gTitle'){A.title=t.value.trim();xaSave();return}
    if(t.id==='fq'){EXV.pk.q=t.value.trim();clearTimeout(t._h);t._h=setTimeout(()=>exList(),180);return}}});
document.addEventListener('change',e=>{const t=e.target;if(!t.closest||!t.closest('#examsView'))return;const A=exA();
  if(t.id==='gApproved'){A.approved=t.checked;xaSave();exTopics();exAvail();return}
  if(t.id==='gAvoid'){A.avoid=t.checked;A.avoidSet=true;xaSave();exTopics();exAvail();return}
  if(t.matches('[data-xlshow]')){XG.show=t.checked;exRefresh();return}
  const m={fpaper:'paper',ftype:'type',fmarks:'marks',fsort:'sort',fband:'band',fwm:'wm'};if(m[t.id]){EXV.pk[m[t.id]]=t.value;exList();return}
  if(t.id==='ffig'){EXV.pk.fig=t.checked;exList();return}if(t.id==='fhide'){EXV.pk.hide=t.checked;exList();return}});
document.addEventListener('toggle',e=>{const d=e.target;if(d.dataset&&d.dataset.pfa){d.open?EXV.pkOpen.add(d.dataset.pfa):EXV.pkOpen.delete(d.dataset.pfa)}if(d.dataset&&d.dataset.xlctx)XG.open[d.dataset.xlctx]=d.open},true);
// editing the cover on the paper: click to type; Enter or clicking away saves (owner's exam maker)
document.addEventListener('keydown',e=>{const el=e.target.closest&&e.target.closest('#xPv [data-edit]');if(!el)return;if(e.key==='Enter'||e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();el.blur()}},true);
document.addEventListener('paste',e=>{const el=e.target.closest&&e.target.closest('#xPv [data-edit]');if(!el)return;e.preventDefault();const s=(e.clipboardData||window.clipboardData).getData('text').replace(/\s+/g,' ');document.execCommand('insertText',false,s)});
document.addEventListener('focusout',e=>{const el=e.target.closest&&e.target.closest('#xPv [data-edit]');if(!el)return;const f=el.dataset.edit,v=el.textContent.replace(/\s+/g,' ').trim();
  if(f.startsWith('instr:')){const i=+f.slice(6),arr=(EX.instr||EX_INSTR).slice(),old=arr[i];if(v)arr[i]=v;else arr.splice(i,1);if(v===old)return;EX.instr=arr}
  else if(f==='cert'){const nv=v===exCertAuto()?'':v;if(nv===(EX.cert||''))return;EX.cert=nv}
  else{const old=EX[f]||'';if(v===old)return;EX[f]=v}
  xsave();toast('Paper updated');exRelayout()});
// drag the corner handle to resize a diagram (owner 14 Nov: "it should just be drag the corner in and out diagonally").
// Pointer events, so mouse, pen and touch all work. The diagram is centred, so its bottom-right corner moves half as far
// sideways as the diagram grows; the scale is the least-squares fit that keeps that corner under the pointer. While dragging only
// --fs and the live % change (one rAF per frame); the paper is laid out again (exRelayout) once, when the drag ends.
let EXFR=null,EXFTAP=null;
const exFigSet=(w,s)=>{const p=Math.round(s*100);w.style.setProperty('--fs',s);const c=w.querySelector('.figpct');if(c)c.textContent=p+'%';
  const h=w.querySelector('.figh');if(h){h.setAttribute('aria-valuenow',p);h.setAttribute('aria-valuetext',p+'%')}};
// fix 13 Nov (exam pools): a resized diagram can move to the next page when the paper is laid out again; it then jumped off
// screen, so the next drag on its corner found nothing under the pointer ("scale 1.32 → 1.32"). The paper now scrolls so the
// diagram's top edge stays where it was on screen (a diagram grows down from its top, so when it stays on its page nothing moves).
const exFigKeep=(k,p)=>{const ov=$('#xPv'),q=()=>document.querySelector(`#xPages [data-figw="${k}"] .exfigbox`),el=q();if(!ov||!el)return p;const t0=el.getBoundingClientRect().top;
  return Promise.resolve(p).then(()=>{const e2=q();if(e2)ov.scrollTop+=e2.getBoundingClientRect().top-t0})};
const exFigCommit=(k,s)=>{s=Math.round(Math.max(.3,Math.min(2,s))*100)/100;if(s===(EX.figscale[k]||1))return false;if(s===1)delete EX.figscale[k];else EX.figscale[k]=s;xsave();exFigKeep(k,exRelayout());return true};
const exFigReset=k=>{if(!(k in EX.figscale))return;delete EX.figscale[k];xsave();exFigKeep(k,exRelayout());toast('Diagram back to 100%')};
// fix 13 Nov (exam pools): a diagram is never drawn wider than the column (max-width), so a scale past that point changed nothing
// on the paper, and dragging in from there did nothing visible either. The size at 100% is measured (not divided out of a drawn
// size that may be capped) and the largest scale is the one that fills the column (at most 200%).
const exFigBase=w=>{const b=w.querySelector('.exfigbox'),old=w.style.getPropertyValue('--fs');w.style.setProperty('--fs','1');const r=b.getBoundingClientRect();w.style.setProperty('--fs',old);
  const col=w.getBoundingClientRect().width;return {w0:r.width||100,h0:r.height||100,smax:r.width>0&&col>0?Math.max(1,Math.min(2,Math.floor(col/r.width*100)/100)):2}};
document.addEventListener('pointerdown',e=>{const h=e.target.closest&&e.target.closest('#xPv [data-figh]');if(!h||e.button>0)return;e.preventDefault();e.stopPropagation();
  const w=h.closest('.exfigw'),B=exFigBase(w),s0=Math.min(B.smax,EX.figscale[h.dataset.figh]||1);
  EXFR={k:h.dataset.figh,w,h,x:e.clientX,y:e.clientY,s0,s:s0,w0:B.w0,h0:B.h0,smax:B.smax,raf:0,moved:false};
  try{h.setPointerCapture(e.pointerId)}catch(_){}});
document.addEventListener('pointermove',e=>{const f=EXFR;if(!f)return;const dx=e.clientX-f.x,dy=e.clientY-f.y;
  if(!f.moved){if(Math.hypot(dx,dy)<3)return;f.moved=true;f.w.classList.add('resizing');document.body.classList.add('fig-resizing')}
  const a=f.w0/2,b=f.h0;f.s=Math.max(.3,Math.min(f.smax,f.s0+(dx*a+dy*b)/(a*a+b*b||1)));f.s=Math.round(f.s*100)/100;
  if(!f.raf)f.raf=requestAnimationFrame(()=>{f.raf=0;exFigSet(f.w,f.s)})});
const exFigEnd=()=>{const f=EXFR;if(!f)return;EXFR=null;if(f.raf)cancelAnimationFrame(f.raf);f.w.classList.remove('resizing');document.body.classList.remove('fig-resizing');
  if(f.moved){EXFTAP=null;exFigSet(f.w,f.s);exFigCommit(f.k,f.s);return}
  // a tap without a drag: two within 350 ms is a double-tap (touch screens fire no dblclick), so reset
  const now=performance.now();if(EXFTAP&&EXFTAP.k===f.k&&now-EXFTAP.t<350){EXFTAP=null;exFigReset(f.k)}else EXFTAP={k:f.k,t:now}};
document.addEventListener('pointerup',exFigEnd);document.addEventListener('pointercancel',exFigEnd);
document.addEventListener('dblclick',e=>{const h=e.target.closest&&e.target.closest('#xPv [data-figh]');if(!h)return;e.preventDefault();EXFTAP=null;exFigReset(h.dataset.figh)});
// keyboard: arrows step 5%, Home resets; the paper is laid out again once the keys go quiet
let EXFKEY=null;
document.addEventListener('keydown',e=>{const h=e.target.closest&&e.target.closest('#xPv [data-figh]');if(!h)return;
  const d={ArrowRight:.05,ArrowUp:.05,ArrowLeft:-.05,ArrowDown:-.05}[e.key];if(d==null&&e.key!=='Home')return;e.preventDefault();e.stopPropagation();
  const k=h.dataset.figh,w=h.closest('.exfigw'),smax=exFigBase(w).smax;const cur=Math.min(smax,EXFKEY&&EXFKEY.k===k?EXFKEY.s:(EX.figscale[k]||1));
  const s=e.key==='Home'?1:Math.round(Math.max(.3,Math.min(smax,cur+d))*100)/100;exFigSet(w,s);w.classList.add('resizing');
  if(EXFKEY)clearTimeout(EXFKEY.t);EXFKEY={k,s,t:setTimeout(()=>{EXFKEY=null;w.classList.remove('resizing');if(exFigCommit(k,s)){let n=0;const iv=setInterval(()=>{const el=document.querySelector(`#xPv [data-figh="${k}"]`);if(el&&el!==h){clearInterval(iv);el.focus({preventScroll:true})}else if(++n>40)clearInterval(iv)},100)}},600)}});
// drag to reorder in the grading list
let EXDRAG=null;
document.addEventListener('dragstart',e=>{const r=e.target.closest&&e.target.closest('#exGSide [data-drag]');if(!r)return;EXDRAG=+r.dataset.drag;e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain',String(EXDRAG))}catch(_){}r.closest('.gq').classList.add('dragging')});
document.addEventListener('dragover',e=>{if(EXDRAG==null)return;const li=e.target.closest&&e.target.closest('#exGSide .gq');$$('#exGSide .gq.drop-before,#exGSide .gq.drop-after').forEach(x=>x.classList.remove('drop-before','drop-after'));if(!li)return;e.preventDefault();
  const r=li.getBoundingClientRect();li.classList.add(e.clientY>r.top+Math.min(r.height,44)/2?'drop-after':'drop-before')});
document.addEventListener('drop',e=>{if(EXDRAG==null)return;const li=e.target.closest&&e.target.closest('#exGSide .gq');if(li){e.preventDefault();exDrop(EXDRAG,+li.dataset.gqli,li.classList.contains('drop-after'))}});
document.addEventListener('dragend',()=>{EXDRAG=null;$$('#exGSide .gq').forEach(x=>x.classList.remove('dragging','drop-before','drop-after'))});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('xpv-on')){e.stopImmediatePropagation();exClosePv()}else if(e.key==='Escape')document.body.classList.remove('exs-open','exr-open')},true);
// any change to the exam (add, remove, reorder, swap, load) refreshes the page around it: see xCount (20_exam.js)
if(view==='exams'&&B)renderExams();
