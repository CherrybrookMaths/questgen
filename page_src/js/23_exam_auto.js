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
const XA_DEF=()=>({open:true,topen:true,topics:[],total:100,by:'marks',n:20,mcq:10,mcqSet:false,diff:'hsc',pr:30,approved:true,avoid:false,seed:0,locked:[],warns:[],tmix:null,tpr:null,ran:false});
function xa(){if(!EX.auto||typeof EX.auto!=='object')EX.auto=XA_DEF();const d=XA_DEF();for(const k in d)if(EX.auto[k]===undefined)EX.auto[k]=d[k];
  const t=EX.auto.topics;if(Array.isArray(t)){const n=QG.topicKeys(t);if(n.length!==t.length||n.some((k,i)=>k!==t[i]))EX.auto.topics=n}return EX.auto}   // owner 25 Nov: old Trigonometry rows read as the new ones (QG.topicKeys)
const xaSave=()=>{save(xKind.key(),JSON.stringify(EX));};
const XA_SWAPPED=new Set();

/* ---------- difficulty of a question ---------- */
const _qd=new Map();
function qDiff(q){if(_qd.has(q.id))return _qd.get(q.id);lvSub();
  const ls=qLeaves(q).filter(p=>lvDif(p)?.b);let r=null;
  if(ls.length){const w=p=>+p.marks||(ls.length===1?(+q.marks||1):1);let sw=0,sb=0,spr=0;const mix=[0,0,0,0,0,0,0];
    ls.forEach(p=>{const d=lvDif(p),m=w(p),b=Math.max(2,Math.min(6,+d.b));sw+=m;sb+=m*b;if(d.wm==='PR')spr+=m;mix[b]+=m});
    r={band:Math.round(sb/sw*2)/2,raw:sb/sw,pr:spr/sw,mix,w:sw}}
  _qd.set(q.id,r);return r}
const fmtBand=b=>Number.isInteger(b)?String(b):`${Math.floor(b)}–${Math.ceil(b)}`;
// owner 19 Nov ("don't you think that questions which contain PS and UF should just be PS?" -> "yeah that's fine go for it"): a question
// with any problem-solving part is labelled and filtered as Problem solving ("Mixed" is gone); marks still count part by part
const wmName=pr=>pr<=0.001?'Fluency':'Problem solving';
// owner 12 Nov: no pills on bank cards; difficulty is plain text in the footer ("Band 3 · Fluency")
function qDifLabel(q){const d=qDiff(q);return d?`Band ${fmtBand(d.band)} · ${wmName(d.pr)}`:''}
function qDifOK(q,F){const band=F.band||'all',wm=F.wm||'all';if(band==='all'&&wm==='all')return true;const d=qDiff(q);if(!d)return false;
  if(band==='lo'&&d.band>3)return false;if(band==='mid'&&(d.band<3.5||d.band>4.5))return false;if(band==='hi'&&d.band<5)return false;
  if(wm!=='all'&&{uf:'Fluency',pr:'Problem solving',mix:'Problem solving'}[wm]!==wmName(d.pr))return false;return true}

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
    if(!ex.size&&!XG.on.length)L.none=true;
    // owner 25 Nov: "Besides that, yes action all these things" (checker: Critical path analysis "itself showed 0 questions, 5 of 9
    // chosen"). Some skills are taught at a focus area, not a subheading (their first dot point has none, e.g. Standard's Critical path
    // analysis): their topic key ends in "|" and is no subtopic anyone can tick, so those questions could never come in. Such a key
    // counts as learnt once any subtopic of its focus area is learnt (only when it is not a subtopic of its own)
    const tr=xaTree();if(XG.kt!==tr){XG.kt=tr;XG.keys=new Set([12,11].flatMap(y=>[...tr[y].values()].flat()))}const T=XG.keys;
    [...L].forEach(k=>{const f=k.split('|').slice(0,2).join('|')+'|';if(!T.has(f))L.add(f)});
    // owner 25 Nov (Investment and loans, Bivariate data analysis: his rows replace the syllabus's sub-levels): a skill taught at an old
    // sub-level ('sub:12|Investment and loans|Investment', tools/bank_split.py) counts as learnt once any new row holding one of its dot
    // points is learnt, and a card names that row, one a tutor can tick
    QG.keyMap().forEach((ns,o)=>{if(ns.some(n=>L.has(n)))L.add(o)});return {L,ex,y12}},
  miss:(q,L)=>L.none?[]:[...new Set(XG.need(q).filter(k=>!L.has(k)).map(k=>QG.keyMap().get(k)?.[0]||k))],
  ok:(q,L)=>XG.show||!!L.none||XG.need(q).every(k=>L.has(k)),
  // a list split into kept (learnt, or all while the switch is on) and left out, with the focus areas most often missing
  split(qs,L){const out=[],keep=[],fa=new Map();
    qs.forEach(q=>{const m=XG.miss(q,L);if(m.length){out.push(q);new Set(m.map(XG.fa)).forEach(f=>fa.set(f,(fa.get(f)||0)+1))}if(!m.length||XG.show)keep.push(q)});
    return {keep,out,top:[...fa.entries()].sort((a,b)=>b[1]-a[1]).map(x=>x[0])}},
  fa:k=>k.slice(4).split('|')[1]||k,
  label:k=>XG.fa(k)+(subName(k)?' › '+subName(k):''),
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
  set(v){const a=x=>Array.isArray(x)?QG.topicKeys(x.filter(k=>typeof k==='string'&&k.startsWith('sub:'))):[];XG.on=a(v&&v.on);XG.off=a(v&&v.off)},
  load(){if(!XG.src){try{const v=JSON.parse(localStorage.getItem('qg_learnt')||'null');if(v)XG.set(v)}catch(e){}XG.src='local'}
    if(XG.src==='db'||XG._ld||!QG.db||!QG.me)return;XG._ld=1;
    Promise.resolve().then(()=>QG.db.doc(XG.path()).get()).then(d=>{const v=d&&d.exists&&QG.val(d);
      XG.src='db';if(v&&!XG.dirty){XG.set(v);try{exRefresh()}catch(e){}}},()=>{}).finally(()=>{XG._ld=0})},
  // one write at a time, after a pause, only on a teacher's change
  save(){XG.dirty=true;const v={on:XG.on.slice(),off:XG.off.slice()};save('qg_learnt',JSON.stringify(v));
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
    return {c,same,sub:!!(h&&hc.sub===h.sub),inT:TS.has(hc.sub),s:(same?-4:0)+(h&&hc.sub===h.sub?0:h&&hc.area===h.area?3:TS.has(hc.sub)?6:12)+2*Math.abs((+c.marks||0)-(+q.marks||0))+1.5*Math.abs(dc.raw-(d?d.raw:3))+Math.abs(dc.pr-(d?d.pr:0))}})
    .sort((a,b)=>a.s-b.s)}
// to: the chosen question (from the chooser); without it the chooser opens
function xaSwap(id,to){const q=xq(id);if(!q||xaLocked(id,true))return;if(to==null){XA_SW.open(id);return}const c=xq(to);if(!c)return;
  XA_SWAPPED.add(id);EX.items[EX.items.indexOf(id)]=to;xsave();if(typeof EXV!=='undefined'&&EXV.sel===id)EXV.sel=to;
  toast(`Swapped for ${qid(c)}${c.marks!==q.marks?` (${c.marks} marks instead of ${q.marks})`:''}`);if(document.body.classList.contains('xpv-on'))exRelayout()}
const XA_SW={id:null,n:6,
  async open(id,more){const q=xq(id);if(!q||xaLocked(id,true))return;const L=xaSwapCands(id);if(!L.length){toast('No other question fits these settings');return}
    this.id=id;if(!more)this.n=6;let el=$('#swapDlg');if(!el){el=document.createElement('div');el.id='swapDlg';el.className='repscrim';document.body.appendChild(el)}
    this.prev=document.activeElement;el.hidden=false;document.body.classList.add('rep-on');
    if(!more)el.innerHTML='<div class="repdlg swapdlg"><p class="muted">Finding similar questions…</p></div>';
    const show=L.slice(0,this.n);await QG.need(show.map(x=>x.c)).catch(()=>{});if(this.id!==id)return;
    const sub=xaHomes().get(id)?.sub,subNm=sub?(sub.split('|')[2]||sub):'';
    el.innerHTML=`<div class="repdlg swapdlg" role="dialog" aria-modal="true" aria-label="Swap ${esc(qid(q))}">
      <div class="rephd"><div><div class="repeyebrow">Swap ${esc(qid(q))} · ${esc(srcLine(q))} · ${q.marks} mark${q.marks===1?'':'s'}</div><h3>Choose a replacement</h3>
        <p class="swaphint">Closest first: the same dot point, then the same subtopic, similar marks and band. ${(()=>{   // owner 19 Nov: "why is ti always 628 questions?" (it counted every question of the type)
          const nD=L.filter(x=>x.same).length,nS=L.filter(x=>x.sub).length,nT=L.filter(x=>x.inT).length;
          return `${nD} with the same dot point · ${nS} in ${subNm?'“'+esc(subNm)+'”':'the same subtopic'} · ${nT} in this exam's topics`})()}</p></div>
        <button type="button" class="act ghost" data-swx aria-label="Close">✕</button></div>
      <ol class="swaplist">${show.map(({c,same})=>{const d=qDiff(c);return `<li data-swq="${c.id}"><div class="swapmeta">${same?'<span class="swapsame">Same dot point</span>':''}<span>${c.marks} mark${c.marks===1?'':'s'}${d?' · Band '+d.raw.toFixed(1)+' · '+(d.pr>=.5?'Problem solving':'Fluency'):''}</span>${EXAS.usedTag(c)}<button type="button" class="act ok" data-swuse="${c.id}">Use this</button></div>${cardHTML(c)}</li>`}).join('')}</ol>
      <div class="swapfoot">${L.length>this.n?`<button type="button" class="act" data-swmore>Show ${Math.min(6,L.length-this.n)} more</button>`:''}<button type="button" class="linkbtn" data-swpick="${esc(sub||'')}">Pick any question from this exam's topics instead</button></div></div>`;
    el.querySelectorAll('[data-swq]').forEach(li=>{const c=xq(+li.dataset.swq),card=li.querySelector('.card');if(card)hydrate(card,c,'bank')});typeset(el);
    (el.querySelector('[data-swuse]')||el.querySelector('[data-swx]'))?.focus({preventScroll:true})},
  close(){const el=$('#swapDlg');if(el){el.hidden=true;el.innerHTML=''}document.body.classList.remove('rep-on');this.id=null;try{this.prev?.focus()}catch(e){}}};
document.addEventListener('click',e=>{const t=e.target;if(!t.closest||!t.closest('#swapDlg'))return;e.stopImmediatePropagation();
  if(t.id==='swapDlg'||t.closest('[data-swx]')){XA_SW.close();return}
  const u=t.closest('[data-swuse]');if(u){const id=XA_SW.id;XA_SW.close();xaSwap(id,+u.dataset.swuse);return}
  if(t.closest('[data-swmore]')){XA_SW.n+=6;XA_SW.open(XA_SW.id,true);return}
  const pk=t.closest('[data-swpick]');if(pk){const id=XA_SW.id;XA_SW.close();EXPK.open('replace',id);return}},true);   // owner 19 Nov: Replace mode (B)
addEventListener('keydown',e=>{if(e.key==='Escape'&&XA_SW.id!=null){e.preventDefault();e.stopImmediatePropagation();XA_SW.close()}},true);
function xaLock(id){const A=xa(),i=A.locked.indexOf(id);if(i>=0)A.locked.splice(i,1);else A.locked.push(id);xsave();toast(i>=0?'Unlocked: you can change it again':'Locked: kept as is when you regenerate')}
// owner 25 Nov: "Besides that, yes action all these things" (checker: "It's not clear to the user what the lock button does", "lock doesnt
// work it can still be replaced and moved"). A locked question is not swapped, replaced, moved (drag, arrows, Sort easiest first),
// removed or changed by Regenerate; each such control is disabled with xaLocked.tip, and every path that changes the list asks here
// (say: tell the user why nothing happened). One page-wide name (CODE_HEALTH rule 1)
function xaLocked(id,say){const lk=!!EX.auto&&Array.isArray(EX.auto.locked)&&EX.auto.locked.includes(id);if(lk&&say){const i=EX.items.indexOf(id);toast(`Q${i+1} is locked: unlock it to change it`)}return lk}
xaLocked.tip='Locked: kept as is when you regenerate; unlock to change it';
xaLocked.label=lk=>lk?'Locked - click to unlock':'Lock this question';

/* ---------- swap / lock on the exam panel (xPanel in 20_exam.js) ---------- */
const XA_LOCK='<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
document.addEventListener('click',e=>{if(!e.target.closest('#xPanel'))return;
  const li=e.target.closest('li[data-xi]');
  if(li&&e.target.closest('[data-xsw]')){const b=e.target.closest('[data-xsw]');if(!b.disabled)xaSwap(+li.dataset.xi);return}
  if(li&&e.target.closest('[data-xlock]')){xaLock(+li.dataset.xi);return}
});
