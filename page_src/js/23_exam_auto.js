/* ===================== Exam builder stage 2: automatic (owner 14 Nov) =====================
   Owner: "can you begin building stage 2 of the exam builder in the background please? The one where it's an automatic one."
   Pick topics, total marks, the number of multiple-choice questions, a difficulty (Easier / HSC-like / Harder) and a fluency /
   problem-solving split; the generator fills the exam (EX.items), so preview, marking guide, save and download all keep working.
   Since the Exams page (24_exams.js) took over the settings and the generator, this file keeps only what that page and the
   bank share: question difficulty (qDiff), topic homes and tree, the seeded random, and Swap / Lock on the exam panel.
   (health pass 13 Nov: the stage-2 drawer UI and its generator were unused and removed; they are in git history.)
   Regenerate = new seed, same settings. Each question in the list can be swapped for the closest alternative or locked so that
   Regenerate keeps it. Difficulty comes from DIFFICULTY_SPEC (part band 2-6, wm UF/PR). Question band = marks-weighted mean of
   its parts' bands, rounded to 0.5; a question's problem-solving share = marks on PR parts / its marks. */
const XA_DEF=()=>({open:true,topen:true,topics:[],total:100,mcq:10,mcqSet:false,diff:'hsc',pr:30,approved:true,avoid:false,seed:0,locked:[],warns:[],tmix:null,tpr:null,ran:false});
function xa(){if(!EX.auto||typeof EX.auto!=='object')EX.auto=XA_DEF();const d=XA_DEF();for(const k in d)if(EX.auto[k]===undefined)EX.auto[k]=d[k];return EX.auto}
const xaSave=()=>{try{localStorage.setItem(XKEY,JSON.stringify(EX))}catch(e){}};
const XA_SWAPPED=new Set();

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

/* ---------- seeded random (the Exams page generator) ---------- */
function xaRng(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}}

/* ---------- swap and lock ---------- */
function xaSwap(id){const A=xa(),q=xq(id);if(!q)return;const homes=xaHomes(),h=homes.get(id),d=qDiff(q),TS=new Set(A.topics);XA_SWAPPED.add(id);
  const avoid=A.avoid?xaSavedIds():null;
  const cands=B.questions.filter(c=>homes.has(c.id)&&c.type===q.type&&!EX.items.includes(c.id)&&!XA_SWAPPED.has(c.id)&&qDiff(c)&&(!A.approved||qState(c)==='approved')&&!repHidden(c)&&!(avoid&&avoid.has(c.id)));   // owner 17 Nov: never swap in a reported question
  if(!cands.length){toast('No other question fits');return}
  const sc=c=>{const hc=homes.get(c.id),dc=qDiff(c);return (h&&hc.sub===h.sub?0:h&&hc.area===h.area?3:TS.has(hc.sub)?6:12)+2*Math.abs((+c.marks||0)-(+q.marks||0))+1.5*Math.abs(dc.raw-(d?d.raw:3))+Math.abs(dc.pr-(d?d.pr:0))+Math.random()*.3};
  let best=null,bs=1e9;cands.forEach(c=>{const v=sc(c);if(v<bs){bs=v;best=c}});
  EX.items[EX.items.indexOf(id)]=best.id;xsave();toast(`Swapped for ${qid(best)}${best.marks!==q.marks?` (${best.marks} marks instead of ${q.marks})`:''}`)}
function xaLock(id){const A=xa(),i=A.locked.indexOf(id);if(i>=0)A.locked.splice(i,1);else A.locked.push(id);xaSave();xPanel()}

/* ---------- swap / lock on the exam panel (xPanel in 20_exam.js) ---------- */
const XA_LOCK='<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
document.addEventListener('click',e=>{if(!e.target.closest('#xPanel'))return;
  const li=e.target.closest('li[data-xi]');
  if(li&&e.target.closest('[data-xsw]')){const b=e.target.closest('[data-xsw]');if(!b.disabled)xaSwap(+li.dataset.xi);return}
  if(li&&e.target.closest('[data-xlk]')){xaLock(+li.dataset.xi);return}
});
