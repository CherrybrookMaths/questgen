/* ===================== Exam builder stage 2: automatic (owner 14 Nov) =====================
   Owner: "can you begin building stage 2 of the exam builder in the background please? The one where it's an automatic one."
   Pick topics, total marks, the number of multiple-choice questions, a difficulty (Easier / HSC-like / Harder) and a fluency /
   problem-solving split; the generator fills the exam (EX.items), so preview, marking guide, save and download all keep working.
   Regenerate = new seed, same settings. Each question in the list can be swapped for the closest alternative or locked so that
   Regenerate keeps it. Difficulty comes from DIFFICULTY_SPEC (part band 2-6, wm UF/PR). Question band = marks-weighted mean of
   its parts' bands, rounded to 0.5; a question's problem-solving share = marks on PR parts / its marks. */
const XA_DEF=()=>({open:true,topen:true,topics:[],total:100,mcq:10,mcqSet:false,diff:'hsc',pr:30,approved:true,avoid:false,seed:0,locked:[],warns:[],tmix:null,tpr:null,ran:false});
function xa(){if(!EX.auto||typeof EX.auto!=='object')EX.auto=XA_DEF();const d=XA_DEF();for(const k in d)if(EX.auto[k]===undefined)EX.auto[k]=d[k];return EX.auto}
const xaSave=()=>{try{localStorage.setItem(XKEY,JSON.stringify(EX))}catch(e){}};
const XA_OPEN=new Set(), XA_SWAPPED=new Set();

/* ---------- difficulty of a question ---------- */
const _qd=new Map();
function qDiff(q){if(_qd.has(q.id))return _qd.get(q.id);
  const ls=qLeaves(q).filter(p=>p.dif&&p.dif.b);let r=null;
  if(ls.length){const w=p=>+p.marks||(ls.length===1?(+q.marks||1):1);let sw=0,sb=0,spr=0;const mix=[0,0,0,0,0,0,0];
    ls.forEach(p=>{const m=w(p),b=Math.max(2,Math.min(6,+p.dif.b));sw+=m;sb+=m*b;if(p.dif.wm==='PR')spr+=m;mix[b]+=m});
    r={band:Math.round(sb/sw*2)/2,raw:sb/sw,pr:spr/sw,mix,w:sw}}
  _qd.set(q.id,r);return r}
const fmtBand=b=>Number.isInteger(b)?String(b):`${Math.floor(b)}–${Math.ceil(b)}`;
const wmName=pr=>pr<=0.001?'Fluency':pr>=0.999?'Problem solving':'Mixed';
// owner 12 Nov: no pills on bank cards; difficulty is plain text in the footer ("Band 3 · Fluency")
function qDifLabel(q){const d=qDiff(q);return d?`Band ${fmtBand(d.band)} · ${wmName(d.pr)}`:''}
function qDifOK(q,F){const band=F.band||'all',wm=F.wm||'all';if(band==='all'&&wm==='all')return true;const d=qDiff(q);if(!d)return false;
  if(band==='lo'&&d.band>3)return false;if(band==='mid'&&(d.band<3.5||d.band>4.5))return false;if(band==='hi'&&d.band<5)return false;
  if(wm!=='all'&&{uf:'Fluency',pr:'Problem solving',mix:'Mixed'}[wm]!==wmName(d.pr))return false;return true}

/* ---------- topics and pool ---------- */
let _xah=null,_xahR=null;
function xaHomes(){if(_xah&&_xahR===reviews)return _xah;const m=new Map();
  B.questions.forEach(q=>{if(q.dup_of||q.old||q.std||!(+q.marks>0))return;const h=qHome(q);if(!h||!h.startsWith('sub:'))return;const [yl,fa]=h.slice(4).split('|');m.set(q.id,{sub:h,area:yl+'|'+fa})});
  _xah=m;_xahR=reviews;return m}
let _xat=null;
function xaTree(){if(_xat)return _xat;const t={12:new Map(),11:new Map()};
  DOTS.forEach(d=>{const m=t[d.yl];if(!m)return;if(!m.has(d.fa))m.set(d.fa,[]);const k='sub:'+d.yl+'|'+d.fa+'|'+(d.sub||'');const a=m.get(d.fa);if(!a.includes(k))a.push(k)});return _xat=t}
const xaSavedIds=()=>{const s=new Set();try{(XSAVED||[]).forEach(x=>{if(x.id!==EX.id)(x.items||[]).forEach(i=>s.add(i))})}catch(e){}return s};
function xaBase(A,homes){const avoid=A.avoid?xaSavedIds():null;
  return B.questions.filter(q=>homes.has(q.id)&&qDiff(q)&&(!A.approved||qState(q)==='approved')&&!(avoid&&avoid.has(q.id)))}
function xaPool(A,homes){const T=new Set(A.topics);return xaBase(A,homes).filter(q=>T.has(homes.get(q.id).sub))}
const xaAreas=A=>[...new Set(A.topics.map(k=>k.slice(4).split('|').slice(0,2).join('|')))];

/* ---------- targets, stats, cost ---------- */
const XA_TILT={easy:[0,0,1.8,1.35,.7,.35,.15],hsc:[0,0,1,1,1,1,1],hard:[0,0,.4,.8,1.3,1.8,2.2]};
function xaMixOf(qs){const mix=[0,0,0,0,0,0,0];qs.forEach(q=>{const d=qDiff(q);if(!d)return;const k=(+q.marks||d.w)/d.w;for(let b=2;b<=6;b++)mix[b]+=d.mix[b]*k});return mix}
// HSC-like = the band mix (by marks) of the HSC questions in the chosen topics; all HSC questions if the topics have too few
function xaTarget(A,pool){let mix=xaMixOf(pool.filter(q=>B.docs[q.doc]?.task_type==='hsc'));
  if(mix.reduce((a,b)=>a+b,0)<20)mix=xaMixOf(B.questions.filter(q=>!q.dup_of&&B.docs[q.doc]?.task_type==='hsc'));
  const t=XA_TILT[A.diff]||XA_TILT.hsc;mix=mix.map((v,b)=>v*(t[b]||0));const s=mix.reduce((a,b)=>a+b,0)||1;return mix.map(v=>v/s)}
function xaStats(qs,homes){const mix=[0,0,0,0,0,0,0];let marks=0,pr=0,dw=0,mcq=0;const area={};
  qs.forEach(q=>{const m=+q.marks||0;marks+=m;if(q.type==='mcq')mcq++;const d=qDiff(q);if(d){const k=m/d.w;for(let b=2;b<=6;b++)mix[b]+=d.mix[b]*k;pr+=d.pr*m;dw+=m}
    const h=homes.get(q.id);if(h)area[h.area]=(area[h.area]||0)+m});
  const s=mix.reduce((a,b)=>a+b,0)||1;return {marks,mcq,mix:mix.map(v=>v/s),pr:dw?pr/dw:0,area}}
function xaCost(st,T){let c=0;if(T.full)c+=20*Math.abs(st.marks-T.total)+20*Math.abs(st.mcq-T.mcq);
  for(let b=2;b<=6;b++)c+=4*Math.abs(st.mix[b]-T.mix[b]);c+=3*Math.abs(st.pr-T.pr);
  let al=0;const tm=st.marks||1;for(const a in T.area)al+=Math.abs((st.area[a]||0)/tm-T.area[a]);return c+2*al}
function xaRng(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}}

/* ---------- generator: seeded greedy fill, then ~900 improvement moves ---------- */
function xaGenerate(){const A=xa();if(!A.topics.length){toast('Pick at least one topic first');return}
  const homes=xaHomes(),pool=xaPool(A,homes);
  const locked=A.locked.filter(i=>EX.items.includes(i)).map(xq).filter(Boolean);A.locked=locked.map(q=>q.id);
  const lockedIds=new Set(A.locked);
  const mcqP=pool.filter(q=>q.type==='mcq'&&!lockedIds.has(q.id)),wrP=pool.filter(q=>q.type!=='mcq'&&!lockedIds.has(q.id));
  const T={total:A.total,mcq:A.mcq,mix:xaTarget(A,pool),pr:A.pr/100,area:{},full:false};
  // topic spread: each chosen focus area's share of the marks follows its share of the matching questions' marks
  pool.forEach(q=>{const a=homes.get(q.id).area;T.area[a]=(T.area[a]||0)+(+q.marks||0)});{const s=Object.values(T.area).reduce((a,b)=>a+b,0)||1;for(const k in T.area)T.area[k]/=s}
  A.seed=(Math.random()*2**31)>>>0;const R=xaRng(A.seed);
  let S=[...locked];const used=new Set(S.map(q=>q.id));
  const cost=sel=>xaCost(xaStats(sel,homes),T);
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
  // HSC order: easier first within each section
  const bo=q=>qDiff(q)?.raw??3;
  const mc=S.filter(q=>q.type==='mcq').sort((a,b)=>bo(a)-bo(b)),wr=S.filter(q=>q.type!=='mcq').sort((a,b)=>bo(a)-bo(b)||a.marks-b.marks);
  EX.items=[...mc,...wr].map(q=>q.id);
  A.tmix=T.mix;A.tpr=T.pr;A.ran=true;A.warns=xaWarn(A,S,pool,homes,T);XA_SWAPPED.clear();
  xsave();const st=xaStats(S,homes);toast(st.marks===A.total?`Exam generated · ${S.length} questions · ${st.marks} marks`:`Generated ${st.marks} of ${A.total} marks (see the note)`);
}
const pct=v=>Math.round(v*100)+'%';
function xaWarn(A,S,pool,homes,T){const w=[],st=xaStats(S,homes),areas=xaAreas(A),faN=a=>a.split('|')[1];
  const mN=pool.filter(q=>q.type==='mcq').length,wM=pool.filter(q=>q.type!=='mcq').reduce((t,q)=>t+(+q.marks||0),0);
  if(st.mcq<A.mcq)w.push(`Only ${mN} multiple-choice question${mN===1?'':'s'} match these topics, so Section I has ${st.mcq}.`);
  if(st.marks!==A.total)w.push(wM<A.total-A.mcq?`These topics only have ${wM} marks of written questions, so the exam has ${st.marks} marks instead of ${A.total}. Add topics or lower the total.`:`The closest found is ${st.marks} marks (target ${A.total}). Press Regenerate, or add a topic.`);
  const hiT=T.mix[5]+T.mix[6],hiA=st.mix[5]+st.mix[6];
  if(hiA<hiT-.05){const few=areas.map(a=>[a,pool.filter(q=>homes.get(q.id).area===a&&qDiff(q).raw>=4.5).length]).filter(x=>x[1]<=3).sort((a,b)=>a[1]-b[1]);
    w.push(`Fewer hard marks than targeted: ${pct(hiA)} band 5–6, against ${pct(hiT)}.`+(few.length?' '+few.slice(0,3).map(([a,n])=>`Only ${n} band 5+ question${n===1?'':'s'} in ${faN(a)}.`).join(' '):''))}
  const loT=T.mix[2],loA=st.mix[2];
  if(loA<loT-.06){const few=areas.map(a=>[a,pool.filter(q=>homes.get(q.id).area===a&&qDiff(q).raw<=2.5).length]).filter(x=>x[1]<=3).sort((a,b)=>a[1]-b[1]);
    w.push(`Fewer easy marks than targeted: ${pct(loA)} band 2, against ${pct(loT)}.`+(few.length?' '+few.slice(0,3).map(([a,n])=>`Only ${n} band-2 question${n===1?'':'s'} in ${faN(a)}.`).join(' '):''))}
  if(st.pr<T.pr-.07){const prM=Math.round(pool.reduce((t,q)=>t+qDiff(q).pr*(+q.marks||0),0));w.push(`Problem solving is ${pct(st.pr)} of the marks, against ${pct(T.pr)}: these topics have only about ${prM} marks of problem-solving parts.`)}
  else if(st.pr>T.pr+.1)w.push(`Problem solving is ${pct(st.pr)} of the marks, more than the ${pct(T.pr)} asked for: these topics have few fluency-only questions.`);
  return w}

/* ---------- swap and lock ---------- */
function xaSwap(id){const A=xa(),q=xq(id);if(!q)return;const homes=xaHomes(),h=homes.get(id),d=qDiff(q),TS=new Set(A.topics);XA_SWAPPED.add(id);
  const avoid=A.avoid?xaSavedIds():null;
  const cands=B.questions.filter(c=>homes.has(c.id)&&c.type===q.type&&!EX.items.includes(c.id)&&!XA_SWAPPED.has(c.id)&&qDiff(c)&&(!A.approved||qState(c)==='approved')&&!(avoid&&avoid.has(c.id)));
  if(!cands.length){toast('No other question fits');return}
  const sc=c=>{const hc=homes.get(c.id),dc=qDiff(c);return (h&&hc.sub===h.sub?0:h&&hc.area===h.area?3:TS.has(hc.sub)?6:12)+2*Math.abs((+c.marks||0)-(+q.marks||0))+1.5*Math.abs(dc.raw-(d?d.raw:3))+Math.abs(dc.pr-(d?d.pr:0))+Math.random()*.3};
  let best=null,bs=1e9;cands.forEach(c=>{const v=sc(c);if(v<bs){bs=v;best=c}});
  EX.items[EX.items.indexOf(id)]=best.id;xsave();toast(`Swapped for ${qid(best)}${best.marks!==q.marks?` (${best.marks} marks instead of ${q.marks})`:''}`)}
function xaLock(id){const A=xa(),i=A.locked.indexOf(id);if(i>=0)A.locked.splice(i,1);else A.locked.push(id);xaSave();xPanel()}

/* ---------- drawer UI ---------- */
const XA_LOCK='<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
function xaAvailHTML(){const A=xa(),homes=xaHomes(),pool=xaPool(A,homes);
  if(!A.topics.length)return '<div class="xa-h">Pick topics to see what the bank has.</div>';
  const bins=[0,0,0,0,0,0,0],mk=pool.reduce((t,q)=>t+(+q.marks||0),0),mN=pool.filter(q=>q.type==='mcq').length;
  pool.forEach(q=>{bins[Math.max(2,Math.min(6,Math.round(qDiff(q).raw)))]++});const mx=Math.max(1,...bins);
  return `<div class="xa-avh"><b>${pool.length}</b> questions match · ${mk.toLocaleString()} marks · ${mN} multiple choice</div>
    <div class="xa-hist" role="img" aria-label="Matching questions by band">${[2,3,4,5,6].map(b=>`<div><i style="height:${Math.max(bins[b]?6:2,Math.round(bins[b]/mx*36))}px"></i><b>${bins[b]}</b><span>B${b}</span></div>`).join('')}</div>`}
function xaSummaryHTML(){const A=xa(),qs=EX.items.map(xq).filter(Boolean);if(!qs.length)return '';const st=xaStats(qs,xaHomes()),tm=A.tmix;
  const mx=Math.max(...[2,3,4,5,6].map(b=>Math.max(st.mix[b],tm?tm[b]:0)),.01);
  return `<div class="xa-sum"><div class="xa-l">This exam</div>${tm?'<div class="xa-h">Bar: this exam. Line: the target.</div>':''}
    <div class="xa-bars">${[2,3,4,5,6].map(b=>`<div class="xa-bar"><span>Band ${b}</span><i><s style="width:${st.mix[b]/mx*100}%"></s>${tm?`<u style="left:${tm[b]/mx*100}%"></u>`:''}</i><em>${pct(st.mix[b])}</em></div>`).join('')}</div>
    <div class="xa-h">${st.marks} mark${st.marks===1?'':'s'}${A.ran?` (target ${A.total})`:''} · ${pct(1-st.pr)} fluency, ${pct(st.pr)} problem solving${A.tpr!=null&&A.ran?` (target ${pct(1-A.tpr)} / ${pct(A.tpr)})`:''}</div>
    ${A.warns&&A.warns.length?`<ul class="xa-warn">${A.warns.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:''}</div>`}
function xaTopicsHTML(){const A=xa(),tree=xaTree(),homes=xaHomes(),base=xaBase(A,homes),cnt={},sel=new Set(A.topics);base.forEach(q=>{const k=homes.get(q.id).sub;cnt[k]=(cnt[k]||0)+1});
  return [12,11].map(yl=>`<div class="xa-yr">Year ${yl}<button type="button" data-xa-all="${yl}">All</button></div>`+[...tree[yl]].map(([fa,ks])=>{const n=ks.reduce((t,k)=>t+(cnt[k]||0),0),key=yl+'|'+fa;
    if(ks.length===1)return `<label class="xa-fa one${n?'':' zero'}"><input type="checkbox" data-xa-fa="${esc(key)}"><span>${esc(fa)}</span><span class="c">${n}</span></label>`;
    return `<div class="xa-fa${n?'':' zero'}"><input type="checkbox" data-xa-fa="${esc(key)}" aria-label="${esc(fa)}"><details data-xa-fad="${esc(key)}"${XA_OPEN.has(key)?' open':''}><summary><span>${esc(fa)}</span><span class="c">${n}</span></summary>
      ${ks.map(k=>`<label class="xa-sub${cnt[k]?'':' zero'}"><input type="checkbox" data-xa-sub="${esc(k)}"${sel.has(k)?' checked':''}><span>${esc(k.split('|')[2]||fa)}</span><span class="c">${cnt[k]||0}</span></label>`).join('')}</details></div>`}).join('')).join('')}
function xaTopicSum(){const A=xa();return A.topics.length?`${xaAreas(A).length} area${xaAreas(A).length===1?'':'s'} · ${A.topics.length} subheading${A.topics.length===1?'':'s'}`:'none picked'}
function xaHTML(){const A=xa(),unl=EX.items.filter(i=>!A.locked.includes(i)).length;
  return `<details class="xauto" data-xa-open${A.open?' open':''}><summary>Auto-generate</summary><div class="xa-body">
    <details class="xa-tp" data-xa-topen${A.topen?' open':''}><summary><span class="xa-l">Topics</span><span class="xa-h" id="xaTsum">${xaTopicSum()}</span></summary>
      <div class="xa-tools"><button type="button" data-xa-all="all">Select all</button><button type="button" data-xa-all="none">Clear</button></div>
      <div class="xa-topics">${xaTopicsHTML()}</div></details>
    <div class="xa-row"><span class="xa-l">Total marks</span><div class="xa-seg">${[50,70,100].map(v=>`<button type="button" data-xa-total="${v}" aria-pressed="${A.total===v}">${v}</button>`).join('')}<input type="number" inputmode="numeric" min="5" max="200" data-xa-num="total" value="${[50,70,100].includes(A.total)?'':A.total}" placeholder="Other" aria-label="Other total"${[50,70,100].includes(A.total)?'':' class="on"'}></div></div>
    <div class="xa-row"><span class="xa-l">Multiple choice</span><div class="xa-mc"><input type="number" inputmode="numeric" min="0" max="30" data-xa-num="mcq" value="${A.mcq}" aria-label="Multiple-choice questions"><span class="xa-h">in Section I</span></div></div>
    <div class="xa-row"><span class="xa-l">Difficulty</span><div class="xa-seg">${[['easy','Easier'],['hsc','HSC-like'],['hard','Harder']].map(([v,l])=>`<button type="button" data-xa-diff="${v}" aria-pressed="${A.diff===v}">${l}</button>`).join('')}</div></div>
    <div class="xa-row col"><span class="xa-l">Fluency / problem solving <b id="xaPrL">${100-A.pr}% / ${A.pr}%</b></span><input type="range" min="0" max="60" step="5" data-xa-num="pr" value="${A.pr}" aria-label="Problem-solving share of marks"></div>
    <label class="xa-ck"><input type="checkbox" data-xa-ck="approved"${A.approved?' checked':''}> Approved questions only</label>
    <label class="xa-ck"><input type="checkbox" data-xa-ck="avoid"${A.avoid?' checked':''}> Skip questions used in my other saved exams</label>
    <div class="xa-av" id="xaAv">${xaAvailHTML()}</div>
    <button type="button" class="act ok xa-go" data-xa-go${A.topics.length?'':' disabled'}>${A.ran?'Regenerate':'Generate exam'}</button>
    ${unl&&EX.items.length?`<div class="xa-h">Replaces the ${unl} unlocked question${unl===1?'':'s'} in this exam. Lock any you want to keep.</div>`:''}
    ${xaSummaryHTML()}</div></details>`}
function xaSyncChecks(){const p=$('#xPanel');if(!p)return;const A=xa(),sel=new Set(A.topics),tree=xaTree();
  p.querySelectorAll('[data-xa-fa]').forEach(cb=>{const [yl,...r]=cb.dataset.xaFa.split('|'),ks=tree[yl]?.get(r.join('|'))||[],on=ks.filter(k=>sel.has(k)).length;cb.checked=on===ks.length&&on>0;cb.indeterminate=on>0&&on<ks.length});
  p.querySelectorAll('[data-xa-sub]').forEach(cb=>cb.checked=sel.has(cb.dataset.xaSub));
  const av=$('#xaAv');if(av)av.innerHTML=xaAvailHTML();const ts=$('#xaTsum');if(ts)ts.textContent=xaTopicSum();
  const go=p.querySelector('[data-xa-go]');if(go)go.disabled=!A.topics.length}
// (the stage-2 drawer wrapper of xPanel was replaced by the Exams page; xPanel in 20_exam.js draws Swap / Lock and the band note)
function xaSetTopics(list){const A=xa();A.topics=[...new Set(list)];xaSave();xaSyncChecks()}
document.addEventListener('click',e=>{if(!e.target.closest('#xPanel'))return;const A=xa();
  const li=e.target.closest('li[data-xi]');
  if(li&&e.target.closest('[data-xsw]')){const b=e.target.closest('[data-xsw]');if(!b.disabled)xaSwap(+li.dataset.xi);return}
  if(li&&e.target.closest('[data-xlk]')){xaLock(+li.dataset.xi);return}
  const al=e.target.closest('[data-xa-all]');if(al){const v=al.dataset.xaAll,tree=xaTree();
    if(v==='none')xaSetTopics([]);else if(v==='all')xaSetTopics([12,11].flatMap(y=>[...tree[y].values()].flat()));
    else{const ks=[...tree[v].values()].flat(),all=ks.every(k=>A.topics.includes(k));xaSetTopics(all?A.topics.filter(k=>!ks.includes(k)):[...A.topics,...ks])}return}
  const tb=e.target.closest('[data-xa-total]');if(tb){A.total=+tb.dataset.xaTotal;if(!A.mcqSet)A.mcq=Math.round(A.total/10);xaSave();xPanel();return}
  const db_=e.target.closest('[data-xa-diff]');if(db_){A.diff=db_.dataset.xaDiff;xaSave();$$('[data-xa-diff]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.xaDiff===A.diff)));return}
  const go=e.target.closest('[data-xa-go]');if(go&&!go.disabled){const unl=EX.items.filter(i=>!A.locked.includes(i)).length;
    if(unl&&!A.ran&&!go.dataset.sure){go.dataset.sure=1;go.textContent=`Replace ${unl} question${unl===1?'':'s'}? Press again`;setTimeout(()=>{if(go.isConnected){delete go.dataset.sure;go.textContent='Generate exam'}},3500);return}
    xaGenerate();return}
});
document.addEventListener('change',e=>{const t=e.target;if(!t.closest||!t.closest('#xPanel'))return;const A=xa();
  if(t.dataset.xaFa){const [yl,...r]=t.dataset.xaFa.split('|'),ks=xaTree()[yl]?.get(r.join('|'))||[];xaSetTopics(t.checked?[...A.topics,...ks]:A.topics.filter(k=>!ks.includes(k)));return}
  if(t.dataset.xaSub){xaSetTopics(t.checked?[...A.topics,t.dataset.xaSub]:A.topics.filter(k=>k!==t.dataset.xaSub));return}
  if(t.dataset.xaCk){A[t.dataset.xaCk]=t.checked;xaSave();xaSyncChecks();return}
  if(t.dataset.xaNum==='total'){A.total=Math.max(5,Math.min(200,Math.round(+t.value||A.total)));if(!A.mcqSet)A.mcq=Math.round(A.total/10);xaSave();xPanel();return}
  if(t.dataset.xaNum==='mcq'){A.mcq=Math.max(0,Math.min(30,Math.round(+t.value||0)));A.mcqSet=true;xaSave();return}
});
document.addEventListener('input',e=>{const t=e.target;if(t.dataset?.xaNum==='pr'){const A=xa();A.pr=+t.value;xaSave();const l=$('#xaPrL');if(l)l.textContent=`${100-A.pr}% / ${A.pr}%`}});
document.addEventListener('toggle',e=>{const d=e.target;if(!d.closest||!d.closest('#xPanel'))return;const A=xa();
  if(d.hasAttribute('data-xa-open')){A.open=d.open;xaSave()}else if(d.hasAttribute('data-xa-topen')){A.topen=d.open;xaSave()}
  else if(d.dataset.xaFad){d.open?XA_OPEN.add(d.dataset.xaFad):XA_OPEN.delete(d.dataset.xaFad)}},true);
