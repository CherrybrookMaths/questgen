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

/* ---------- skill gates (owner 17 Nov) ----------
   owner 12 Nov: "skills need to be gated like that"; "if theyve done diff they can't do a diff question which contains int until they do int".
   owner 17 Nov: "lets do skill gates, that's important"; "we cann't assume that learnt is ticked. for example a test might only have AP GP
   finance but AP GP by itself was learnt earlier."; he chose "Learnt list, Y11 pre-ticked"; on the left-out line: "Include it yep."
   A question goes into an exam (Exam setup's generator, Regenerate, Swap and counts; Pick by hand's list, counts, Add 5 at random and
   Add all shown) only when every topic its REQUIRED skills need is learnt: QG.skills[skill] = the skill's taught topic plus its
   prerequisites' topics (tools/bank_split.py skill_gates; basic skills never gate; "can use" skills never gate). Learnt = the exam's
   own topics + the teacher's Already learnt list (on); when any Year 12 topic is in the exam every Year 11 topic counts as well,
   unless the teacher unticked it (off). The list is kept per teacher in the page database (data/users/<id>/learnt, private to that
   person), with this browser's copy (localStorage qg_learnt) as the fallback. The Bank is not gated; saved exams are not changed. */
const XG={on:[],off:[],show:false,open:{setup:true,pick:false},src:null,dirty:false,nc:new Map(),_t:0,_w:null,_ld:0,
  // the topic keys a question needs learnt (cached; cleared when the details land, QG.onDet)
  need(q){let r=XG.nc.get(q.id);if(r)return r;const s=new Set();qSkills(q).forEach(k=>(QG.skills[k]||[]).forEach(t=>s.add(t)));r=[...s];XG.nc.set(q.id,r);return r},
  y11:()=>[...xaTree()[11].values()].flat(),
  // extra = the exam's own topics. owner 17 Nov ("Learnt list, Y11 pre-ticked"): a Year 12 topic in the exam ticks all of Year 11
  learnt(extra){const ex=new Set((extra||[]).filter(Boolean)),L=new Set([...ex,...XG.on]),y12=[...ex].some(k=>k.startsWith('sub:12|'));
    if(y12){const off=new Set(XG.off);XG.y11().forEach(k=>{if(!off.has(k))L.add(k)})}
    // nothing to judge against yet (Pick by hand on "All questions", an empty exam and an empty Already learnt list): no gate, so a
    // tutor's first view is the whole bank, not a near-empty list (17 Nov review of the gates build)
    if(!ex.size&&!XG.on.length)L.none=true;return {L,ex,y12}},
  miss:(q,L)=>L.none?[]:XG.need(q).filter(k=>!L.has(k)),
  ok:(q,L)=>XG.show||!!L.none||XG.need(q).every(k=>L.has(k)),
  // a list split into kept (learnt, or all while the switch is on) and left out, with the focus areas most often missing
  split(qs,L){const out=[],keep=[],fa=new Map();
    qs.forEach(q=>{const m=XG.miss(q,L);if(m.length){out.push(q);new Set(m.map(XG.fa)).forEach(f=>fa.set(f,(fa.get(f)||0)+1))}if(!m.length||XG.show)keep.push(q)});
    return {keep,out,top:[...fa.entries()].sort((a,b)=>b[1]-a[1]).map(x=>x[0])}},
  fa:k=>k.slice(4).split('|')[1]||k,
  label:k=>XG.fa(k)+' › '+subName(k),
  // the exam's own topics in each builder: Exam setup's ticks; Pick by hand also counts the questions already in the exam and the topic browsed
  homesOf:()=>{const h=xaHomes();return EX.items.map(i=>h.get(i)?.sub)},
  autoExtra:A=>A.topics,
  pickExtra(A){const t=EXV.pk.topic,x=[...A.topics,...XG.homesOf()];
    if(t.startsWith('sub:'))x.push(t);else if(t.startsWith('fa:')){const [y,...r]=t.slice(3).split('|');x.push(...(xaTree()[y]?.get(r.join('|'))||[]))}return x},
  checked:(k,g)=>g.ex.has(k)||XG.on.includes(k)||(g.y12&&k.startsWith('sub:11|')&&!XG.off.includes(k)),
  toggle(k,g){const was=XG.checked(k,g);XG.on=XG.on.filter(x=>x!==k);XG.off=XG.off.filter(x=>x!==k);
    if(!was)XG.on.push(k);else if(k.startsWith('sub:11|'))XG.off.push(k);XG.save()},
  allY11(g){const ks=XG.y11(),all=ks.every(k=>XG.checked(k,g)),S=new Set(ks);XG.on=XG.on.filter(k=>!S.has(k));XG.off=XG.off.filter(k=>!S.has(k));
    if(all)XG.off.push(...ks);else XG.on.push(...ks);XG.save()},
  /* ---- kept per teacher (data/users/<id>/learnt), else in this browser ---- */
  path:()=>'data/users/'+QG.me+'/learnt',
  set(v){const a=x=>Array.isArray(x)?x.filter(k=>typeof k==='string'&&k.startsWith('sub:')):[];XG.on=a(v&&v.on);XG.off=a(v&&v.off)},
  load(){if(!XG.src){try{const v=JSON.parse(localStorage.getItem('qg_learnt')||'null');if(v)XG.set(v)}catch(e){}XG.src='local'}
    if(XG.src==='db'||XG._ld||!QG.db||!QG.me)return;XG._ld=1;
    Promise.resolve().then(()=>QG.db.doc(XG.path()).get()).then(d=>{const v=d&&d.exists&&(typeof d.data==='function'?d.data():d.data);
      XG.src='db';if(v&&!XG.dirty){XG.set(v);try{exRefresh()}catch(e){}}},()=>{}).finally(()=>{XG._ld=0})},
  // one write at a time, after a pause, only on a teacher's change
  save(){XG.dirty=true;const v={on:XG.on.slice(),off:XG.off.slice()};try{localStorage.setItem('qg_learnt',JSON.stringify(v))}catch(e){}
    clearTimeout(XG._t);XG._t=setTimeout(()=>{if(!QG.db||!QG.me)return;const w={...v,at:new Date().toISOString()};
      XG._w=(XG._w||Promise.resolve()).then(()=>QG.db.doc(XG.path()).set(w)).catch(()=>{})},700)},
  // a card shown by the switch says what it still needs (owner 17 Nov skill gates)
  note(c,q,L){if(!XG.show||!c||!L)return;const m=XG.miss(q,L);if(!m.length)return;const hd=c.querySelector('.hd');
    const h=`<div class="xl-need">needs: ${m.map(k=>esc(XG.label(k))).join(' · ')}</div>`;hd?hd.insertAdjacentHTML('afterend',h):c.insertAdjacentHTML('afterbegin',h)},
  /* ---- the Already learnt block, the switch and the left-out line (both builders) ---- */
  html(ctx,g,sp){const tree=xaTree(),c=k=>XG.checked(k,g),all=y=>[...tree[y].values()].flat(),n=y=>all(y).filter(c).length,y11=all(11).every(c);
    const yr=y=>`<div class="xl-yr"><div class="xl-yh"><b>Year ${y}</b><small>${n(y)} of ${all(y).length}</small>${y===11?`<button type="button" class="linkbtn" data-xly11 aria-pressed="${y11}">${y11?'Untick all Year 11':'All Year 11'}</button>`:''}</div>
      ${[...tree[y]].map(([fa,ks])=>`<div class="xl-fa"><span class="xl-fn">${esc(fa)}</span><span class="xl-ps">${ks.map(k=>{const inx=g.ex.has(k);
        return `<button type="button" class="xl-p" data-xlk="${esc(k)}" aria-pressed="${c(k)}"${inx?' disabled title="In this exam: always counts as learnt"':''}>${esc(subName(k))}</button>`}).join('')}</span></div>`).join('')}</div>`;
    const N=sp.out.length,s=N===1?'':'s',most=sp.top.length?` (mostly ${esc(sp.top[0])}${sp.top[1]?` and ${esc(sp.top[1])}`:''})`:'';
    const line=!N?'':XG.show?`<p class="xl-out" data-xlout="${N}">${N} question${s} shown need${N===1?'s':''} topics not yet learnt${most}: marked “needs”.</p>`
      :`<p class="xl-out" data-xlout="${N}"><b>${N}</b> question${s} left out: ${N===1?'it needs':'they need'} topics not yet learnt${most}.</p>`;
    return `<details class="xl" data-xlctx="${ctx}"${XG.open[ctx]?' open':''}><summary><b>Already learnt</b><small>${n(12)+n(11)} topic${n(12)+n(11)===1?'':'s'} count as learnt</small></summary>
      <p class="xl-hint">Topics your students have learnt. A question comes in only when every topic it needs is learnt; the exam's own topics always count${g.y12?', and with a Year 12 topic in the exam all of Year 11 starts ticked':''}.</p>${yr(12)}${yr(11)}</details>
      <label class="xl-sw"><input type="checkbox" role="switch" data-xlshow${XG.show?' checked':''}> Show questions that need topics not yet learnt</label>${line}`}};

/* ---------- seeded random (the Exams page generator) ---------- */
function xaRng(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}}

/* ---------- swap and lock ---------- */
// owner 19 Nov: "swap for a similar question is just INSTANTLY replacing it. shouldn't it give options? ... Or they can choose anotehr
// and the hand pick questions can pop up with teh chosen exam topics?" Swap now opens a chooser (XA_SW): the closest candidates, each
// shown in full, with "Use this", and "Browse more in Pick by hand" (opens it on the question's subtopic). Closest = same dot point,
// then same subtopic / focus area / chosen topics, then marks, band and fluency/problem-solving mix (no embeddings: for an exam,
// "similar" means the same skill at the same size and difficulty, which these fields say directly).
function xaSwapCands(id){const A=xa(),q=xq(id);if(!q)return [];const homes=xaHomes(),h=homes.get(id),d=qDiff(q),TS=new Set(A.topics);
  const avoid=A.avoid?xaSavedIds():null,L=XG.learnt([...A.topics,...XG.homesOf()]).L;   // owner 17 Nov: "lets do skill gates": never swap in a question that needs a topic not yet learnt
  const dots=c=>{try{return qiParts(c).flatMap(p=>p.dots.map(x=>x.code)).filter(Boolean)}catch(e){return []}},dq=new Set(dots(q));
  const cands=B.questions.filter(c=>homes.has(c.id)&&c.type===q.type&&!EX.items.includes(c.id)&&!XA_SWAPPED.has(c.id)&&qDiff(c)&&(!A.approved||qState(c)==='approved')&&!repHidden(c)&&!(avoid&&avoid.has(c.id))&&XG.ok(c,L));   // owner 17 Nov: never swap in a reported question
  return cands.map(c=>{const hc=homes.get(c.id),dc=qDiff(c),same=dq.size&&dots(c).some(k=>dq.has(k));
    return {c,same,s:(same?-4:0)+(h&&hc.sub===h.sub?0:h&&hc.area===h.area?3:TS.has(hc.sub)?6:12)+2*Math.abs((+c.marks||0)-(+q.marks||0))+1.5*Math.abs(dc.raw-(d?d.raw:3))+Math.abs(dc.pr-(d?d.pr:0))}})
    .sort((a,b)=>a.s-b.s)}
// to: the chosen question (from the chooser); without it the chooser opens
function xaSwap(id,to){const q=xq(id);if(!q)return;if(to==null){XA_SW.open(id);return}const c=xq(to);if(!c)return;
  XA_SWAPPED.add(id);EX.items[EX.items.indexOf(id)]=to;xsave();if(typeof EXV!=='undefined'&&EXV.sel===id)EXV.sel=to;
  toast(`Swapped for ${qid(c)}${c.marks!==q.marks?` (${c.marks} marks instead of ${q.marks})`:''}`);if(document.body.classList.contains('xpv-on'))exRelayout()}
const XA_SW={id:null,n:6,
  async open(id,more){const q=xq(id);if(!q)return;const L=xaSwapCands(id);if(!L.length){toast('No other question fits these settings');return}
    this.id=id;if(!more)this.n=6;let el=$('#swapDlg');if(!el){el=document.createElement('div');el.id='swapDlg';el.className='repscrim';document.body.appendChild(el)}
    this.prev=document.activeElement;el.hidden=false;document.body.classList.add('rep-on');
    if(!more)el.innerHTML='<div class="repdlg swapdlg"><p class="muted">Finding similar questions…</p></div>';
    const show=L.slice(0,this.n);await QG.need(show.map(x=>x.c)).catch(()=>{});if(this.id!==id)return;
    const sub=xaHomes().get(id)?.sub,subNm=sub?(sub.split('|')[2]||sub):'';
    el.innerHTML=`<div class="repdlg swapdlg" role="dialog" aria-modal="true" aria-label="Swap ${esc(qid(q))}">
      <div class="rephd"><div><div class="repeyebrow">Swap ${esc(qid(q))} · ${esc(srcLine(q))} · ${q.marks} mark${q.marks===1?'':'s'}</div><h3>Choose a replacement</h3>
        <p class="swaphint">Closest first: the same dot point, then the same topic, similar marks and band. ${L.length} question${L.length===1?'':'s'} fit your exam settings.</p></div>
        <button type="button" class="act ghost" data-swx aria-label="Close">✕</button></div>
      <ol class="swaplist">${show.map(({c,same})=>{const d=qDiff(c);return `<li data-swq="${c.id}"><div class="swapmeta">${same?'<span class="swapsame">Same dot point</span>':''}<span>${c.marks} mark${c.marks===1?'':'s'}${d?' · Band '+d.raw.toFixed(1)+' · '+(d.pr>=.5?'Problem solving':'Fluency'):''}</span>${EXAS.usedTag(c)}<button type="button" class="act ok" data-swuse="${c.id}">Use this</button></div>${cardHTML(c)}</li>`}).join('')}</ol>
      <div class="swapfoot">${L.length>this.n?`<button type="button" class="act" data-swmore>Show ${Math.min(6,L.length-this.n)} more</button>`:''}<button type="button" class="linkbtn" data-swpick="${esc(sub||'')}">Browse ${subNm?'“'+esc(subNm)+'”':'more'} in Pick by hand</button></div></div>`;
    el.querySelectorAll('[data-swq]').forEach(li=>{const c=xq(+li.dataset.swq),card=li.querySelector('.card');if(card)hydrate(card,c,'bank')});typeset(el);
    (el.querySelector('[data-swuse]')||el.querySelector('[data-swx]'))?.focus({preventScroll:true})},
  close(){const el=$('#swapDlg');if(el){el.hidden=true;el.innerHTML=''}document.body.classList.remove('rep-on');this.id=null;try{this.prev?.focus()}catch(e){}}};
document.addEventListener('click',e=>{const t=e.target;if(!t.closest||!t.closest('#swapDlg'))return;e.stopImmediatePropagation();
  if(t.id==='swapDlg'||t.closest('[data-swx]')){XA_SW.close();return}
  const u=t.closest('[data-swuse]');if(u){const id=XA_SW.id;XA_SW.close();xaSwap(id,+u.dataset.swuse);return}
  if(t.closest('[data-swmore]')){XA_SW.n+=6;XA_SW.open(XA_SW.id,true);return}
  const pk=t.closest('[data-swpick]');if(pk){XA_SW.close();if(document.body.classList.contains('xpv-on'))exClosePv();EXV.view='pick';if(pk.dataset.swpick)EXV.pk.topic=pk.dataset.swpick;exSaveView();location.hash='#exams';renderExams();return}},true);
addEventListener('keydown',e=>{if(e.key==='Escape'&&XA_SW.id!=null){e.preventDefault();e.stopImmediatePropagation();XA_SW.close()}},true);
function xaLock(id){const A=xa(),i=A.locked.indexOf(id);if(i>=0)A.locked.splice(i,1);else A.locked.push(id);xaSave();xPanel()}

/* ---------- swap / lock on the exam panel (xPanel in 20_exam.js) ---------- */
const XA_LOCK='<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
document.addEventListener('click',e=>{if(!e.target.closest('#xPanel'))return;
  const li=e.target.closest('li[data-xi]');
  if(li&&e.target.closest('[data-xsw]')){const b=e.target.closest('[data-xsw]');if(!b.disabled)xaSwap(+li.dataset.xi);return}
  if(li&&e.target.closest('[data-xlk]')){xaLock(+li.dataset.xi);return}
});
