/* ===================== Worksheets (owner 26 Nov) =====================
   Owner 19 Nov: "isn't it a bit awkward to have a worksheet builder integrated into the exam one? maybe we should split it?" -> "yes" (its own
   top-bar item, greyed until built); worksheet use counts as used before: "they should see that its been used for now yes".
   Owner 26 Nov, agreed behaviour (a clickable mockup was made; its styling does not carry over):
   - "of course follow similar design style of the exam builder"; "it should be manage din a similar way to exams where there's a lsit, same
     for teh settings logic": My worksheets is My exams' list (25_mine.js renderMine('worksheet')); the settings form is Exam setup's.
   - "when choosing the topics, it has to allow for more specific choosing, going to the skill depth such as missing angle in cosine rule.
     Can't just be cosine rule": topic › row (the Bank's rows) › skill; ticking a row takes its skills, ticking a skill targets it.
   - "Used before is also important": Skip questions already in my saved exams and worksheets, on by default (as Exam setup).
   - "This worksheet should follow the rule order, it should only appear in one like before remember? Like can't do bearings without having
     the earlier skills and so forth": a question's home is the LAST skill it needs in the signed-off skill order (QG.skillOrder; earlier
     skills are assumed), so it is in one skill's worksheets only. Basic skills count only when a question needs nothing else.
   - Hand-picking: "a bit too overkill": the button builds the sheet and opens it; Swap / Remove / + Add on the sheet.
   - "we should avoid live generation of anything": every question comes from the bank.
   - "1 is the best so far but not sure if ti will work for wider questions, also should be lines and not boxes for working"; "the
     worksheet should really conserve space": A4, no cover, no sections, no time, a one-line header, two columns, ruled lines (about one a
     mark, plus one); a question with three or more parts, a table, or anything wider than a column spans both columns (WS.widen).
   - "Give options to print worksheet (with no answer), worked solutions, and worksheet with answers (this is where they can choose single
     number, worked or both)"; "NO I ALSO MEANT a version where the answers are attched after all the questions, for students to self check,
     just the two pdfs stacked one after anotrher": the exam documents exam / guide / answers / stack, each as HTML, PDF and Word.
   Storage: a worksheet is a document of the page database's `exams` collection with kind 'worksheet' (and its settings in ws), so saving,
   autosave, used-before (EXAS.used, xaSavedIds) and the stored database rules are the exams' own; My exams leaves worksheets out.
   One page-wide name (CODE_HEALTH rule 1). */
const WS={view:(load('ws_view')||'mine'),setupFor:null,open:new Set(),m:null,
  DEF:()=>({skills:[],n:10,level:'mixed',avoid:true,name:'',seed:0,last:null}),
  // an empty worksheet (EX while on Worksheets; xKind in 20_exam.js)
  blank:()=>({kind:'worksheet',course:QG.course,title:QG.courseData.name,sub:'Worksheet',school:'CMC Education',time:'',timeAuto:false,mpm:1.8,reading:'',items:[],lines:{},figscale:{},ws:WS.DEF()}),
  S(){if(!EX.ws||typeof EX.ws!=='object')EX.ws=WS.DEF();const d=WS.DEF();for(const k in d)if(EX.ws[k]===undefined)EX.ws[k]=d[k];return EX.ws},
  reset(){WS.m=null},
  /* ---------- skills: order, rows, one home per question ---------- */
  // each skill: its place in the order (i), its row (the Bank's row of its first dot point: DOTS sub-levels, SUB_SPLIT), basic
  model(){const M=WS.m;if(M&&M.so===QG.skillOrder&&M.b===B)return M;
    const list=(QG.skillOrder||[]).map(([name,key,dp,basic],i)=>{const d=DM[dp];return {i,name,basic:!!basic,row:d?'sub:'+d.yl+'|'+d.fa+'|'+(d.sub||''):key?QG.topicKeys([key])[0]:null}});
    const rows=new Map();list.forEach(s=>{if(!s.row)return;if(!rows.has(s.row))rows.set(s.row,[]);rows.get(s.row).push(s)});
    return WS.m={so:QG.skillOrder,b:B,list,by:new Map(list.map(s=>[s.name,s])),rows,hc:new Map()}},
  home(q){const M=WS.model();if(M.hc.has(q.id))return M.hc.get(q.id);
    const sk=qSkills(q).map(n=>M.by.get(n)).filter(Boolean),nb=sk.filter(s=>!s.basic),c=nb.length?nb:sk,h=c.length?c.reduce((a,b)=>b.i>a.i?b:a).name:null;
    M.hc.set(q.id,h);return h},
  // the questions a worksheet may use: the exam builder's own (a topic home, not old syllabus, not a duplicate), approved, not reported
  base:()=>{const homes=xaHomes();return B.questions.filter(q=>homes.has(q.id)&&qState(q)==='approved'&&!repHidden(q)&&WS.home(q))},
  // the worksheet's own topics for the skill gates (XG): the rows of its skills
  extra:S=>[...new Set(S.skills.map(n=>WS.model().by.get(n)?.row).filter(Boolean))],
  pool(S){const want=new Set(S.skills),all=WS.base().filter(q=>want.has(WS.home(q))),av=S.avoid?xaSavedIds():null,fresh=av?all.filter(q=>!av.has(q.id)):all;
    const g=XG.learnt(WS.extra(S)),sp=XG.split(fresh,g.L);return {all,used:all.length-fresh.length,keep:sp.keep,out:sp.out,top:sp.top,g}},
  // per skill: questions it holds (all), and what ticking it would bring in (n: its own row counts as learnt), as Exam setup counts subtopics
  counts(S){const M=WS.model(),av=S.avoid?xaSavedIds():null,ex=WS.extra(S),Ls=new Map(),L=r=>{if(!Ls.has(r))Ls.set(r,XG.learnt([...ex,r]).L);return Ls.get(r)},c={};
    WS.base().forEach(q=>{const h=WS.home(q),e=c[h]=c[h]||{all:0,n:0,used:0,gate:0};e.all++;if(av&&av.has(q.id)){e.used++;return}if(XG.ok(q,L(M.by.get(h).row)))e.n++;else e.gate++});return c},
  // level: the exam builder's bands (qDifOK: Easier = band 3 and below, Harder = band 5 and above) first, then the nearest; Mixed = any
  pick(cands,n,S,R,have){const lv=S.level,M=WS.model(),g=new Map();
    const key=q=>{if(lv!=='easier'&&lv!=='harder')return R();const d=qDiff(q);if(!d)return 9+R();
      return qDifOK(q,{band:lv==='easier'?'lo':'hi'})?R()*.5:1+(lv==='easier'?Math.max(0,d.raw-3):Math.max(0,5-d.raw))+R()*.5};
    cands.forEach(q=>{const h=WS.home(q);if(!g.has(h))g.set(h,[]);g.get(h).push([key(q),q])});g.forEach(a=>a.sort((x,y)=>x[0]-y[0]));
    // the chosen skills share the sheet: the next question comes from the skill with the fewest on it so far (earlier skills first)
    const order=[...g.keys()].sort((a,b)=>M.by.get(a).i-M.by.get(b).i),out=[];
    while(out.length<n){let best=null;for(const h of order)if(g.get(h).length&&(best==null||(have.get(h)||0)<(have.get(best)||0)))best=h;
      if(best==null)break;out.push(g.get(best).shift()[1]);have.set(best,(have.get(best)||0)+1)}
    return out},
  // on the sheet: skills in their order, each easiest first (the exam builder's order, EXSEC.ord)
  sort(qs){const M=WS.model(),i=q=>M.by.get(WS.home(q))?.i??1e4;return qs.slice().sort((a,b)=>i(a)-i(b)||EXSEC.ord(a,b))},
  autoName(S){const M=WS.model(),sk=S.skills.map(n=>M.by.get(n)).filter(Boolean);if(!sk.length)return 'Worksheet';if(sk.length===1)return sk[0].name;
    const rows=[...new Set(sk.map(s=>s.row))];if(rows.length===1)return subName(rows[0]);
    const fas=[...new Set(sk.map(s=>XG.fa(s.row)))];return fas.length===1?fas[0]:fas.length===2?fas[0]+' and '+fas[1].charAt(0).toLowerCase()+fas[1].slice(1):'Mixed skills'},
  // owner 26 Nov (mockup): "If the chosen skills hold fewer questions than asked, make a shorter sheet and say so plainly"
  short(L){if(!L||L.n>=L.asked)return '';const n=L.n,s=n===1?'':'s';
    if(!L.used&&!L.gate)return `Only ${n} question${s} exist${n===1?'s':''} for these skills, so the worksheet has ${n} instead of ${L.asked}.`;
    return `Only ${n} question${s} ${n===1?'is':'are'} left for these skills (${[L.used?`${L.used} already in your saved exams and worksheets`:'',L.gate?`${L.gate} need topics not yet learnt`:''].filter(Boolean).join(', ')}), so the worksheet has ${n} instead of ${L.asked}.`},
  generate(){const S=WS.S();if(!S.skills.length)return null;const P=WS.pool(S);S.seed=(Math.random()*2**31)>>>0;
    const qs=WS.pick(P.keep,Math.max(1,+S.n||10),S,xaRng(S.seed),new Map());
    EX.items=WS.sort(qs).map(q=>q.id);EX.sub=S.name||WS.autoName(S);XA_SWAPPED.clear();
    S.last={n:qs.length,asked:+S.n||10,all:P.all.length,used:P.used,gate:P.out.length};xsave();return S.last},
  // + Add a question / + Add 5: more from the chosen skills (same rules), skills with the fewest on the sheet first
  add(k){const S=WS.S(),on=new Set(EX.items),have=new Map();EX.items.forEach(i=>{const q=xq(i),h=q&&WS.home(q);if(h)have.set(h,(have.get(h)||0)+1)});
    const qs=WS.pick(WS.pool(S).keep.filter(q=>!on.has(q.id)&&!XA_SWAPPED.has(q.id)),k,S,xaRng((Math.random()*2**31)>>>0),have);
    if(!qs.length){toast('No more questions for these skills'+(S.avoid?' that are not in your saved exams and worksheets':''));return}
    EX.items=WS.sort([...EX.items.map(xq).filter(Boolean),...qs]).map(q=>q.id);xsave();exRelayout();toast(`Added ${qs.length} question${qs.length===1?'':'s'}`)},
  // Swap: another question with the same home skill, not on the sheet, not swapped out before, not used before (when skipping)
  swap(id){const q=xq(id),h=q&&WS.home(q);if(!h)return;const S=WS.S(),on=new Set(EX.items);
    const c=WS.pick(WS.pool({...S,skills:[h]}).keep.filter(x=>!on.has(x.id)&&!XA_SWAPPED.has(x.id)),1,S,xaRng((Math.random()*2**31)>>>0),new Map());
    if(!c.length){toast(`No other question for “${h}”`);return}xaSwap(id,c[0].id)},
  remove(id){const i=EX.items.indexOf(id);if(i<0)return;EX.items.splice(i,1);xsave();exRelayout();toast(`Removed Q${i+1}`)},
  async another(){if(!EX.items.length)return;clearTimeout(EXAS.t);if(db&&exmState()!=='saved')await xSaveDb(true);
    const old=EX,S={...JSON.parse(JSON.stringify(WS.S())),avoid:true,last:null},vn=EXAS.vname();
    EX={...WS.blank(),school:old.school,ws:S,sub:vn};const r=WS.generate();
    if(!r||!r.n){EX=old;toast('Not enough unused questions for these skills for another worksheet');return}
    EX.sub=vn;S.name=vn;try{EXC.clear()}catch(_){}xsave();WS.go('mine');xPreview('exam');toast(`Made “${vn}”: ${r.n} questions, none from your saved exams and worksheets`)},
  fresh(stay){clearTimeout(EXAS.t);EX={...WS.blank(),school:EX.school||'CMC Education'};try{EXC.clear()}catch(_){}xsave();if(stay)return;WS.view='setup';WS.setupFor=null;save('ws_view','setup');location.hash='#worksheets';if(view==='worksheets')WS.render();window.scrollTo({top:0})},
  go(v){WS.view=v;WS.setupFor=null;save('ws_view',v);location.hash='#worksheets';if(view==='worksheets')WS.render()},
  /* ---------- the view: My worksheets | the settings form ---------- */
  render(){const box=$('#wsView');if(!box||!B)return;xKind('worksheet');exmSub();XG.load();
    if(!['mine','setup'].includes(WS.view)||WS.view==='setup'&&WS.setupFor==null&&EX.items.length)WS.view='mine';
    if(!box.dataset.built){box.dataset.built=1;box.innerHTML='<div class="exhead"><div class="exttl" id="wsTtl"></div><span class="sp"></span></div><div id="wsSetup"></div><div class="exmine" id="wsMine"></div>'}
    box.dataset.wsview=WS.view;WS.head();if(WS.view==='setup')WS.setup();else renderMine('worksheet')},
  refresh(){if(view!=='worksheets'||!$('#wsView')?.dataset.built)return;EXAS.bar();if(WS.view==='mine')renderMine('worksheet');else{WS.tree();WS.avail()}WS.head()},
  head(){const t=$('#wsTtl');if(t)t.innerHTML=WS.view!=='setup'?'':WS.setupFor!=null?`<b>Settings for “${esc(EXAS.name())}”</b><button type="button" class="linkbtn" data-wsback>Back to the sheet</button>`:'<b>New worksheet</b><button type="button" class="linkbtn" data-wsback>Cancel</button>'},
  setup(){const S=WS.S();
    $('#wsSetup').innerHTML=`<div class="exsetup">
      <section class="extopics"><div class="pagehead"><div class="eyebrow">HSC ${esc(QG.courseData.name)}</div><h2>Set up your worksheet</h2>
        <p class="lead">Choose what to practise, down to single skills: open a topic, tick a row for all its skills or tick one skill. A question belongs to one skill only, the last one it needs in the teaching order.</p></div>
        <div id="wsTopics"></div></section>
      <aside class="exsettings" aria-label="Worksheet settings">
        <div class="exgo"><button type="button" class="exgen" id="wsGo">Make worksheet</button><span class="exgohint" id="wsGoHint" hidden>Choose at least one skill to make a worksheet.</span><div id="wsResult"></div></div>
        <div class="group"><h3>Worksheet</h3>
          <div class="ctl"><div class="lab"><label for="wsName">Worksheet name</label><span class="val">optional</span></div><input type="text" id="wsName" value="${esc(S.name)}"></div>
          <div class="ctl"><div class="lab"><span id="wsNL">Questions</span><span class="val" id="wsNV"></span></div>
            <div class="ws-n" role="group" aria-labelledby="wsNL"><button type="button" class="act" data-wsn="-1" aria-label="One question fewer">−</button><input type="number" id="wsN" min="1" max="60" value="${+S.n||10}" aria-label="Number of questions"><button type="button" class="act" data-wsn="1" aria-label="One more question">+</button>
              <span class="srcseg ws-pre">${[5,10,15,20].map(n=>`<button type="button" data-wsnp="${n}" aria-pressed="${+S.n===n}">${n}</button>`).join('')}</span></div></div>
          <div class="ctl"><div class="lab"><span id="wsLvL">Level</span></div><div class="srcseg" role="group" aria-labelledby="wsLvL">${[['easier','Easier'],['mixed','Mixed'],['harder','Harder']].map(([k,l])=>`<button type="button" data-wslv="${k}" aria-pressed="${S.level===k}">${l}</button>`).join('')}</div>
            <div class="hint">Easier takes band 2–3 questions first, Harder band 5–6 first (the bands of Exams); Mixed takes any.</div></div>
          <label class="exck"><input type="checkbox" id="wsAvoid"${S.avoid?' checked':''}> Skip questions already in my saved exams and worksheets</label>
        </div>
        <div class="group xl-g" id="wsLearnt"></div>
        <div class="group"><h3>What these skills hold</h3><div id="wsAvail"></div></div>
      </aside></div>`;
    WS.tree();WS.avail()},
  // topic tiles (Exam setup's) opening to the rows, each row's skills as pills with their counts
  tree(){const el=$('#wsTopics');if(!el)return;const S=WS.S(),M=WS.model(),tr=xaTree(),C=WS.counts(S),sel=new Set(S.skills);
    const st=sks=>{const on=sks.filter(s=>sel.has(s.name)).length;return on&&on===sks.length?'on':on?'part':''},box=(attr,k,s,lab)=>`<button type="button" class="tbox" ${attr}="${esc(k)}" role="checkbox" aria-checked="${s==='on'?'true':s==='part'?'mixed':'false'}" aria-label="${esc(lab)}">${s==='on'?'✓':''}</button>`;
    const why=c=>[c.gate?`${c.gate} need topics not yet learnt`:'',c.used?`${c.used} in saved exams or worksheets`:''].filter(Boolean).join(' · ');
    const nk=WS.pool(S).keep.length;let h=`<div class="selbar"><span><b>${S.skills.length}</b> skill${S.skills.length===1?'':'s'} chosen · <b>${nk}</b> question${nk===1?'':'s'} to draw from</span><span class="sp"></span><button type="button" class="linkbtn" data-wsnone>Clear all</button></div>
      <p class="ex-cntnote">Each skill counts the approved questions whose last skill it is${S.avoid?', less those in your saved exams and worksheets':''}.</p>`;
    [12,11].forEach(y=>{const fas=[...tr[y]].map(([fa,ks])=>[fa,ks.filter(k=>M.rows.has(k))]).filter(([,ks])=>ks.length);if(!fas.length)return;
      h+=`<section class="strand"><div class="strand-h"><h3>Year ${y}</h3></div><div class="extiles">`;
      fas.forEach(([fa,ks])=>{const key=y+'|'+fa,sks=ks.flatMap(k=>M.rows.get(k)),s=st(sks),open=WS.open.has(key),q=sks.reduce((t,x)=>t+(C[x.name]?.n||0),0),on=sks.filter(x=>sel.has(x.name));
        h+=`<div class="extile ${s==='part'?'ex-part':s}${open?' open':''}"><div class="extile-h">${box('data-wsfa',key,s,'Choose every skill in '+fa)}
          <button type="button" class="extile-t" data-wsexp="${esc(key)}" aria-expanded="${open}"><span class="tt"><b>${esc(fa)}</b><small>${q} question${q===1?'':'s'} · ${on.length?`${on.length} of ${sks.length} skills chosen`:`${sks.length} skill${sks.length===1?'':'s'}`}</small>${on.length&&!open&&s!=='on'?`<small class="expicked">${esc(on.map(x=>x.name).join(', '))}</small>`:''}</span><span class="exchev" aria-hidden="true">▾</span></button></div>
          <div class="ws-rows"${open?'':' hidden'}>${ks.map(k=>{const rs=M.rows.get(k),rq=rs.reduce((t,x)=>t+(C[x.name]?.n||0),0);
            return `<div class="ws-row"><div class="ws-rowh">${box('data-wsrow',k,st(rs),'Choose every skill in '+subName(k))}<span class="ws-rown">${esc(subName(k))}</span><small>${rq}</small></div>
              <div class="pills">${rs.map(x=>{const c=C[x.name]||{all:0,n:0},w=why(c);return `<button type="button" class="pill" data-wssk="${esc(x.name)}" aria-pressed="${sel.has(x.name)}"${c.all?w?` title="${c.n} can be used: ${w}"`:'':' title="No questions have this as their last skill yet"'}><span class="ex-pnm">${esc(x.name)}${w?`<small class="ex-pwhy">${w}</small>`:''}</span><span class="n">${c.n}</span></button>`}).join('')}</div></div>`}).join('')}</div></div>`});
      h+='</div></section>'});
    el.innerHTML=h;const nm=$('#wsName');if(nm)nm.placeholder=S.skills.length?WS.autoName(S):'Named from the skills you pick';
    const lt=$('#wsLearnt');if(lt){const g=XG.learnt(WS.extra(S)),P=WS.pool({...S,avoid:false});lt.innerHTML=XG.html('ws',g,XG.split(P.all,g.L))}},
  avail(){const el=$('#wsAvail');if(!el)return;const S=WS.S(),P=WS.pool(S),n=+S.n||10,b=[0,0,0,0,0,0,0];let un=0;
    P.keep.forEach(q=>{const d=qDiff(q);if(d)b[Math.max(2,Math.min(6,Math.round(d.raw)))]++;else un++});const mx=Math.max(1,...b);
    const w=!S.skills.length?'Choose at least one skill.':P.keep.length<n?WS.short({n:P.keep.length,asked:n,used:P.used,gate:P.out.length}):'';
    el.innerHTML=`<div class="poolline"><b>${P.keep.length}</b> question${P.keep.length===1?'':'s'} for the chosen skills${P.used?` · <b>${P.used}</b> already in saved exams and worksheets`:''}${P.out.length?` · <b>${P.out.length}</b> need topics not yet learnt`:''}</div>
      <table class="avail ws-bands"><thead><tr>${[2,3,4,5,6].map(x=>`<th scope="col" title="Band ${x}">B${x}</th>`).join('')}</tr></thead><tbody><tr>${[2,3,4,5,6].map(x=>`<td class="${b[x]?'':'z'}" style="--a:${Math.round(b[x]/mx*28)}">${b[x]||'–'}</td>`).join('')}</tr></tbody></table>
      <div class="availcap"><span>Questions at each band${un?` (${un} not rated yet)`:''}</span></div>${w?`<div class="warnbox"><p>${esc(w)}</p></div>`:''}`;
    const NV=$('#wsNV');if(NV)NV.textContent=n+' question'+(n===1?'':'s');$$('[data-wsnp]').forEach(x=>x.setAttribute('aria-pressed',String(+x.dataset.wsnp===n)));
    const go=$('#wsGo');if(go){go.disabled=!S.skills.length;go.textContent=WS.setupFor!=null?'Make it again with these settings':'Make worksheet'}const gh=$('#wsGoHint');if(gh)gh.hidden=!!S.skills.length;
    const r=$('#wsResult');if(r){const L=S.last,m=WS.short(L);r.innerHTML=L&&EX.items.length?`<div class="result">Last worksheet: <b>${L.n}</b> question${L.n===1?'':'s'}.${m?` ${esc(m)}`:''}</div>`:''}},
  setSkills(list){const S=WS.S();S.skills=[...new Set(list)];xaSave();WS.tree();WS.avail()},
  /* ---------- the sheet (xPreview, 24_exams.js, draws it; these are the worksheet's own parts) ---------- */
  bar(doc){const D=[['exam','Worksheet'],['guide','Worked solutions'],['answers','With answers',"The worksheet with each question's answer under it, in place of the lines"],['stack','Solutions at the back','The worksheet, then the worked solutions from a new page, in one file: for students to check their own work']];
    return `<div class="xtool"><div class="xseg">${D.map(([k,t,ti])=>`<button data-xdoc="${k}" aria-pressed="${doc===k}"${ti?` title="${esc(ti)}"`:''}>${t}</button>`).join('')}</div>${doc==='answers'?EXSEC.ansSeg():''}
      <span class="xinfo" id="xInfo">Laying out pages…</span><span class="sp"></span><span class="xpvsave" id="xPvSave"></span>
      <span class="xmenu"><button class="act" data-xmenu aria-expanded="false">Worksheet</button><span class="xmenu-pop" hidden><button class="act" id="wsPvSet" title="Change the skills, number of questions or level and make the worksheet again">Settings…</button><button class="act" data-wsadd="1">+ Add a question</button><button class="act" data-wsadd="5">+ Add 5</button></span></span>
      <button class="act" id="wsPvAnother" title="A new worksheet with the same settings and none of the questions in your saved exams and worksheets">Make another like this</button>
      <span class="xmenu"><button class="act ok" data-xmenu aria-expanded="false">Download</button><span class="xmenu-pop" hidden><button class="act" id="xDl" disabled>HTML</button></span></span><button class="act ghost" id="xPvClose">Close</button></div>
      <div class="expvbody"><div class="xpages" id="xPages"></div><aside class="expvside" id="exGSide" aria-label="Questions"></aside></div>`},
  qctl:(q,n)=>`<span class="scr-only ws-qctl"><button type="button" data-wsswap="${q.id}" title="Another question on the same skill">Swap</button><button type="button" data-wsrm="${q.id}" title="Take Q${n} off the worksheet">Remove</button></span>`,
  // one line at the top: the name, N questions · M marks, Name and Date (no cover, sections or time)
  blocks(doc){const qs=EX.items.map(xq).filter(Boolean),m=xMarks(qs),bl=[],t={guide:'Worked solutions',answers:'With answers'}[doc];if(doc==='answers')EXV.fb=0;
    bl.push({wide:true,html:`<div class="ws-head"><b class="ws-ht">${esc(EX.sub)}${t?` <span>· ${t}</span>`:''}</b><span class="ws-hm">${qs.length} question${qs.length===1?'':'s'} · ${m} mark${m===1?'':'s'}</span>${doc==='guide'?'':'<span class="ws-who">Name ________________ Date ____________</span>'}</div>`});
    qs.forEach((q,i)=>bl.push({html:xQ(q,i+1,doc),q}));
    if(doc!=='guide'&&qs.some(needsZ))bl.push({newpage:true,wide:true,html:zTableHTML()});   // owner 17 Nov: the z-score table at the back, as in exams
    bl.forEach(b=>{b.part=doc});return bl},
  // "wide": three or more labelled parts, a table in the question, or anything wider than a column at its own size (a diagram at its
  // print size, a long line of maths) spans both columns. Judged on the measuring copy, before diagrams are capped to their column
  widen(bl,meas){const kids=meas.children;bl.forEach((b,i)=>{if(b.wide||!b.q)return;const el=kids[i],q=b.q,W=el.getBoundingClientRect().width;if(!el||!W)return;
    const parts=q.parts.filter(p=>p.label&&leaf(q,p)).length>=3,tab=[...el.querySelectorAll('.xqb table')].some(t=>!t.closest('.xsol'));
    const fig=[...el.querySelectorAll('img.fig')].some(im=>{const w=parseFloat(im.style.width)||im.getBoundingClientRect().width,s=+(im.closest('[data-figw]')?.style.getPropertyValue('--fs'))||1;return w*s>W+1});
    if(parts||tab||fig||el.scrollWidth>el.clientWidth+2){b.wide=true;el.classList.add('ws-wide')}})},
  // pages of two columns: a run of narrow questions fills a band, left column then right, balanced; a wide one closes the band and spans both
  pack(els,bl,H){const sheets=[];let cur=null,used=0,band=null;
    const hOf=el=>el.getBoundingClientRect().height+parseFloat(getComputedStyle(el).marginBottom||0);
    const start=part=>{cur=[];cur.part=part;sheets.push(cur);used=0;band=null};
    const split=hs=>{const tot=hs.reduce((a,x)=>a+x,0);let l=0,best={k:hs.length,h:tot};for(let k=0;k<=hs.length;k++){const h=Math.max(l,tot-l);if(h<best.h)best={k,h};if(k<hs.length)l+=hs[k]}return best};
    const close=()=>{if(band){used+=band.h;band=null}};
    els.forEach((el,i)=>{const b=bl[i],h=hOf(el);if(!cur||b.newpage||cur.part!==b.part)start(b.part);
      if(b.wide||b.cover){close();if(used+h>H&&cur.length)start(b.part);cur.push(el);used+=h;return}
      if(band){const hs=[...band.hs,h],s=split(hs);if(used+s.h<=H){band.hs=hs;band.els.push(el);band.k=s.k;band.h=s.h;return}close();start(b.part)}
      if(used+h>H&&cur.length)start(b.part);band={els:[el],hs:[h],k:1,h};cur.push(band)});
    return sheets.map(s=>{const o=s.map(x=>{if(!x.els)return x;const d=document.createElement('div');d.className='ws-band';const c=[0,1].map(()=>{const e=document.createElement('div');e.className='ws-col';d.appendChild(e);return e});
      x.els.forEach((e,j)=>c[j<x.k?0:1].appendChild(e));return d});o.part=s.part;return o})},
  info(n,doc){const qs=EX.items.map(xq).filter(Boolean),m=xMarks(qs),L=EX.ws?.last,sh=L&&L.n===qs.length?WS.short(L):'';
    return `${n} page${n===1?'':'s'} · ${qs.length} question${qs.length===1?'':'s'} · ${m} mark${m===1?'':'s'}${doc==='answers'&&EXV.ans!=='worked'&&EXV.fb?` · ${EXV.fb} written part${EXV.fb===1?' has':'s have'} no short answer recorded, so ${EXV.fb===1?'it shows its':'they show their'} worked solution`:''}${sh?' · '+sh:''}`}};

/* ---------- events ---------- */
document.addEventListener('click',e=>{const t=e.target;if(!t.closest)return;
  if(t.closest('[data-ws-fresh]')){e.preventDefault();WS.fresh();return}
  if(!t.closest('#wsView'))return;const S=WS.S(),M=WS.model();
  if(t.closest('[data-wsback]')){const back=WS.setupFor!=null;WS.go('mine');if(back&&EX.items.length)xPreview('exam');return}
  if(t.id==='wsGo'&&!t.disabled&&!t.dataset.ok){EXAS.guard(t,'Making it again',()=>{t.dataset.ok=1;t.click();delete t.dataset.ok});return}
  if(t.id==='wsGo'&&!t.disabled){const r=WS.generate();if(!r)return;if(!r.n){toast('No questions to use for these skills. Choose more skills, or untick Skip.');WS.avail();return}
    try{EXC.clear()}catch(_){}WS.go('mine');xPreview('exam');const m=WS.short(r);toast(m||`Worksheet made · ${r.n} questions`);return}
  const ex=t.closest('[data-wsexp]');if(ex){const k=ex.dataset.wsexp;WS.open.has(k)?WS.open.delete(k):WS.open.add(k);WS.tree();return}
  const fa=t.closest('[data-wsfa]');if(fa){const [y,...r]=fa.dataset.wsfa.split('|'),ns=(xaTree()[y]?.get(r.join('|'))||[]).flatMap(k=>(M.rows.get(k)||[]).map(s=>s.name)),all=ns.every(n=>S.skills.includes(n));
    WS.setSkills(all?S.skills.filter(n=>!ns.includes(n)):[...S.skills,...ns]);return}
  const rw=t.closest('[data-wsrow]');if(rw){const ns=(M.rows.get(rw.dataset.wsrow)||[]).map(s=>s.name),all=ns.every(n=>S.skills.includes(n));WS.setSkills(all?S.skills.filter(n=>!ns.includes(n)):[...S.skills,...ns]);return}
  const sk=t.closest('[data-wssk]');if(sk){const n=sk.dataset.wssk;WS.setSkills(S.skills.includes(n)?S.skills.filter(x=>x!==n):[...S.skills,n]);return}
  if(t.closest('[data-wsnone]')){WS.setSkills([]);return}
  const nb=t.closest('[data-wsn]'),np=t.closest('[data-wsnp]');if(nb||np){S.n=Math.max(1,Math.min(60,np?+np.dataset.wsnp:(+S.n||10)+ +nb.dataset.wsn));const i=$('#wsN');if(i)i.value=S.n;xaSave();WS.avail();return}
  const lv=t.closest('[data-wslv]');if(lv){S.level=lv.dataset.wslv;xaSave();$$('[data-wslv]').forEach(b=>b.setAttribute('aria-pressed',String(b===lv)));return}
  // owner 17 Nov skill gates, as in Exam setup: Already learnt ticks (the worksheet's own rows always count)
  const xg=t.closest('[data-xlk],[data-xly11]');if(xg&&!xg.disabled){const g=XG.learnt(WS.extra(S));if(xg.dataset.xlk)XG.toggle(xg.dataset.xlk,g);else XG.allY11(g);WS.tree();WS.avail();return}});
document.addEventListener('input',e=>{const t=e.target;if(!t.closest||!t.closest('#wsView'))return;const S=WS.S();
  if(t.id==='wsName'){S.name=t.value.trim();xaSave();return}
  if(t.id==='wsN'){const v=Math.round(+t.value);if(v>=1&&v<=60){S.n=v;xaSave();clearTimeout(t._h);t._h=setTimeout(WS.avail,120)}}});
document.addEventListener('change',e=>{const t=e.target;if(!t.closest||!t.closest('#wsView'))return;const S=WS.S();
  if(t.id==='wsN'){S.n=Math.max(1,Math.min(60,Math.round(+t.value)||10));t.value=S.n;xaSave();WS.avail();return}
  if(t.id==='wsAvoid'){S.avoid=t.checked;xaSave();WS.tree();WS.avail();return}
  if(t.matches('[data-xlshow]')){XG.show=t.checked;WS.tree();WS.avail()}});
// on the sheet: Swap / Remove on each question, + Add, Settings, Make another like this (before the exam paper's own click handler)
document.addEventListener('click',e=>{const t=e.target;if(!t.closest||!t.closest('#xPv')||EX.kind!=='worksheet')return;
  const b=t.closest('[data-wsswap],[data-wsrm],[data-wsadd],#wsPvSet,#wsPvAnother');if(!b)return;e.stopImmediatePropagation();
  if(b.dataset.wsswap)WS.swap(+b.dataset.wsswap);else if(b.dataset.wsrm)WS.remove(+b.dataset.wsrm);else if(b.dataset.wsadd)WS.add(+b.dataset.wsadd);
  else if(b.id==='wsPvAnother')WS.another();
  else{exClosePv();WS.view='setup';WS.setupFor=EX.id||'open';save('ws_view','setup');WS.render();window.scrollTo({top:0})}},true);
