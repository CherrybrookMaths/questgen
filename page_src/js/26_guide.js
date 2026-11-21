/* ===================== Guide v2 (owner 14 Nov) =====================
   Owner: "We need to rewrite the guide tab. It needs to have many parts. 1. How questions are categorised. This will cover
   difficulty and topic. Use visuals and avoid heavy prose and voice. and 2. an explanation of how the system stands and how to
   migrate it to live servers." Figures are live from the bank where possible; the long tagging rules stay, folded away. */
// worked tagging examples (owner 12 Nov: "add a tab to the artifact which explains how questions are tagged, provide some
// different examples"); rules as settled in TAG_SPEC.md; the examples are live questions from the bank
// owner 21 Nov ("make sure there's no hanging numbers anywhere which can go stale"): each example names a question and describes
// its shape (parts, marks, flags), so each carries a check of that shape; an example whose question was retired, split or re-marked
// is left out (with a console warning) instead of showing an explanation that no longer matches. [id, check, title, why]
const gxPri=p=>(p.t24||[]).find(t=>t.primary)?.id;
const GUIDE_EX=[
 [1082,q=>q.parts.length===1&&gxPri(q.parts[0])==='Y11-122','One part, one topic','A single-part question gets one main dot point. Limits have no dot point of their own in the 2024 syllabus, so a limit by factorising files under the derivative from first principles (Y11-122). Its only gate is the algebra it needs.'],
 [618,q=>q.parts.length===5,'Related parts stay together','Five parts on one book-restoration context. Four parts are continuous random variables, so that is the home. Part (b) finds a straight line: that becomes a gate (Equations of straight lines), not a second place the question is filed.'],
 [1221,q=>q.parts.length===2&&+q.parts[0].marks===2&&+q.parts[1].marks===2,'A tie in marks goes to the later part','(a) sketch the derivative and (b) find an area are 2 marks each. On a tie the later part decides, so the question is filed under integration.'],
 [1699,q=>q.parts.length===2&&+q.parts[0].marks===3&&+q.parts[1].marks===1,'Your override wins','By marks (3 of 4) this is differentiation, but the point of the question is the "hence" integral, so it was set to Primitive functions by hand.'],
 [979,q=>q.parts.length===1,'Needs vs can use','Expected value and the probability distribution are needed for the marks (gates). Calculus for the maximum is one valid method among others (the vertex of a parabola also works), so it is "can use": it lists the question under that skill for practice but never hides it.'],
 [191,q=>!!q.old,'Removed from the syllabus','3D trigonometry is no longer in Mathematics Advanced (now Year 11 Extension 1), so the question is marked old syllabus and kept out of Advanced topic lists.'],
 [228,q=>!!q.std,'Standard course content','Bivariate data analysis is in Mathematics Standard, not Advanced. The question keeps its Standard topic so it can be used when the bank grows to Standard.']];
// owner 21 Nov ("make sure there's no hanging numbers anywhere which can go stale"): row counts and size come from the bank build
// (tools/build_bank.py counts), with the build date; they were typed in on 14 Nov
const G2_DB=()=>{const c=QG.bank?.counts||{},b=String(QG.bank?.built||''),d=b.length>=8?new Date(+b.slice(0,4),+b.slice(4,6)-1,+b.slice(6,8)):null;
  return {tables:['questions','parts','tags','solutions','mcq_options','figures','data_tables','documents','part_difficulty'].filter(t=>c[t]!=null).map(t=>[t,c[t]]),
    mb:c._db_mb,asof:d?d.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'}):''}};
function g2Stats(){const qs=B.questions.filter(q=>!q.dup_of&&!q.old&&!q.std);const areas={},subs=new Set();let filed=0;
  qs.forEach(q=>{const h=qHome(q);if(!h||!h.startsWith('sub:'))return;filed++;const [yl,fa,sb]=h.slice(4).split('|');subs.add(h);const k=yl+'|'+fa;areas[k]=(areas[k]||0)+1});
  const parts=[];qs.forEach(q=>q.parts.forEach(p=>{if(p.dif)parts.push({p,q})}));
  const band=[0,0,0,0,0,0,0],wm={UF:0,PR:0};parts.forEach(({p})=>{const m=+p.marks||1;band[p.dif.b]+=m;wm[p.dif.wm]=(wm[p.dif.wm]||0)+m});
  const ref=parts.filter(x=>x.p.dif.a).length,src={owner:0,shifted:0};parts.forEach(x=>{if(x.p.dif.s)src[x.p.dif.s]=(src[x.p.dif.s]||0)+1});
  const fas=new Set(DOTS.map(d=>d.yl+'|'+d.fa)).size,sbs=new Set(DOTS.map(d=>d.yl+'|'+d.fa+'|'+d.sub)).size;
  return {qs:qs.length,filed,areas,subs:subs.size,parts:parts.length,band,wm,ref,src,fas,sbs,dots:DOTS.length}}
const g2pct=(a,t)=>t?Math.round(a/t*100):0;
function g2Bars(rows,max,cls=''){return `<div class="g2bars ${cls}">${rows.map(([l,v,sub])=>`<div class="g2bar"><span class="l">${l}</span><i><s style="width:${max?Math.max(1.5,v/max*100):0}%"></s></i><b>${v}</b>${sub?`<em>${sub}</em>`:''}</div>`).join('')}</div>`}
const G2_BAND=[[2,'Routine','One step: recall, read a graph, substitute'],[3,'Standard','Two steps, or one technique applied cleanly'],[4,'Multi-step','Several steps, ideas combined, careful algebra'],[5,'Non-routine','Unfamiliar set-up, general proof, extended reasoning'],[6,'Insight','Novel model or a long argument taken to the end']];
function g2Checked(){let chk=0,chg=0;try{Object.values(DIFD||{}).forEach(d=>{if(d.status&&d.anchor!==false){chk++;if(d.status==='changed')chg++}})}catch(e){}return {chk,chg}}
// owner 15 Nov: "curate should be hidden to peope except editors." Viewers are not pointed at Review steps they cannot see.
const g2ChkHTML=(chk,chg,ref)=>{const ed=typeof isEditor==='function'&&isEditor();return `<b>${chk}<small> / ${ref}</small></b><span>References checked by ${ed?'you':'an editor'}</span><em>${chk?`${chg} changed${ed?' · in Review › Difficulty':''}`:'Not loaded yet, or none checked'}</em>`};
// owner 14 Nov: "what is the _ references checked by you": the count comes from the page database after the Guide is drawn, so refresh the tile when it arrives
function g2ChkRefresh(){const el=$('#g2chk');if(!el)return;const {chk,chg}=g2Checked();let ref=0;B.questions.forEach(q=>{if(!q.dup_of&&!q.old&&!q.std)q.parts.forEach(p=>{if(p.dif&&p.dif.a)ref++})});el.innerHTML=g2ChkHTML(chk,chg,ref)}
const G2_PAGE=()=>load('g2page')==='dev'?'dev':'cat';
document.addEventListener('click',e=>{const b=e.target.closest('[data-gpg]');if(!b)return;save('g2page',b.dataset.gpg);renderGuide();window.scrollTo({top:0})});
function renderGuide(){const box=$('#guideBox');if(!box||!B)return;try{lvSub()}catch(e){}
  const S=g2Stats(),Y=yl=>Object.entries(S.areas).filter(([k])=>k.startsWith(yl+'|')).map(([k,v])=>[esc(k.split('|')[1]),v]).sort((a,b)=>b[1]-a[1]);
  const amax=Math.max(...Object.values(S.areas),1),bt=S.band.reduce((a,b)=>a+b,0),bmax=Math.max(...S.band,1),wt=(S.wm.UF||0)+(S.wm.PR||0);
  const {chk,chg}=g2Checked();
  const ex=GUIDE_EX.map(([id,ok,t,why],i)=>{const q=QG.byId.get(id);if(!q||q.dup_of||!ok(q)){if(B?.questions?.length)console.warn('guide example left out (question gone or changed):',id);return ''}const lv=q.parts.filter(p=>leaf(q,p));
    // owner 14 Nov: "show the question first. then explain how it was tagged."
    return `<details class="g2ex"${i===0?' open':''}><summary><b>${esc(t)}</b><span class="muted">${qid(q)} · ${esc(srcLine(q))}</span></summary>
      <div class="g2qbox"><div class="g2k">The question</div><div class="qtext" data-gq="${q.id}"></div></div>
      <div class="g2k g2how">How it was tagged</div><p class="g2note">${esc(why)}</p>
      <div class="g2scroll"><table class="g2t"><thead><tr><th>Part</th><th>Marks</th><th>Main dot point</th><th>Band</th><th>Kind</th></tr></thead><tbody>${lv.map(p=>{const pri=effTags(q,p).filter(t=>t.primary);
        return `<tr><td>${p.label?'('+esc(p.label)+')':'–'}</td><td>${p.marks??''}</td><td>${pri.map(t=>t.cov==='removed'?'Removed':DM[t.id]?`<span class="tid">${t.id}</span> ${esc(DM[t.id].short||'')}`:esc(t.id||'')).join('<br>')||'–'}</td><td>${p.dif?p.dif.b:'–'}</td><td>${p.dif?(p.dif.wm==='PR'?'Problem solving':'Fluency'):'–'}</td></tr>`}).join('')}</tbody></table></div>
      <div class="g2home">Filed under ${q.old?'Old syllabus':q.std?'Standard: '+esc(q.std):homeLabel(qHome(q))}</div></details>`}).join('');
  // owner 14 Nov: "Split the guide into two subpages, one for the first 4, and the second for the last two for developers"
  const pg=G2_PAGE();
  box.innerHTML=`<div class="g2" data-gpage="${pg}">
  <div class="g2top"><div class="g2eyebrow">Guide</div>
    <div class="xseg g2seg" role="group" aria-label="Guide pages"><button type="button" data-gpg="cat" aria-pressed="${pg==='cat'}">For users</button><button type="button" data-gpg="dev" aria-pressed="${pg==='dev'}">For developers</button></div>
    <h2>${pg==='dev'?'The system, and going live':'How questions are categorised'}</h2>
    <nav class="g2nav" aria-label="Guide sections">${pg==='dev'?'<a href="#g2-now">The system today</a><a href="#g2-data">Data model</a><a href="#g2-live">Going live</a>':'<a href="#g2-topic">Topic</a><a href="#g2-diff">Difficulty</a><a href="#g2-wm">Fluency / problem solving</a><a href="#g2-ex">Examples</a>'}</nav></div>
  <div class="g2pg1">

  <div class="g2axes"><div><b>Topic</b><span>Where it is filed</span></div><div><b>Difficulty</b><span>Band 2–6</span></div><div><b>Kind</b><span>Fluency or problem solving</span></div></div>

  <section id="g2-topic" class="g2sec"><h3>1 · Topic</h3>
    <div class="g2tree">${[['Year',2,'Year 12'],['Focus area',S.fas,'Integral calculus'],['Subheading',S.sbs,'Areas and the definite integral'],['Dot point',S.dots,'Y12-279 · areas bounded by a curve']].map(([l,n,e],i)=>`${i?'<span class="g2arr" aria-hidden="true">→</span>':''}<div class="g2node"><b>${n}</b><span>${l}s</span><em>${esc(e)}</em></div>`).join('')}</div>
    <p class="g2cap">NESA 2024 ${esc(QG.courseData.name)} syllabus. Every tag quotes a dot point verbatim.</p>
    <div class="g2three">
      <div class="g2card"><div class="g2k">Per part</div><b>Main dot point</b><span>What the part's marks are for</span></div>
      <div class="g2card"><div class="g2k">Per question</div><b>Home</b><span>One subheading. Shown there and only there</span></div>
      <div class="g2card"><div class="g2k">Per part</div><b>Needs · Can use</b><span>Needs hides the question until learnt. Can use never hides it</span></div></div>
    <h4>Choosing the home</h4>
    <div class="g2file">
      <div class="g2q"><div class="g2qh">Question · 4 marks</div>
        <div class="g2p"><span>(a)</span><em>Y12-291 · analyse stationary points</em><b>2</b></div>
        <div class="g2p"><span>(b)</span><em>Y12-279 · area bounded by a curve</em><b>2</b></div></div>
      <span class="g2arr" aria-hidden="true">→</span>
      <div class="g2tally"><div class="g2qh">Marks per subheading</div>
        <div class="g2tl"><span>Turning points and graphing</span><i><s style="width:50%"></s></i><b>2</b></div>
        <div class="g2tl win"><span>Areas and the definite integral</span><i><s style="width:50%"></s></i><b>2</b></div>
        <div class="g2tie">Tie → later part wins</div></div>
      <span class="g2arr" aria-hidden="true">→</span>
      <div class="g2win"><div class="g2qh">Home</div><b>Integral calculus</b><span>Areas and the definite integral</span></div></div>
    <ul class="g2rules"><li><b>Most marks</b> wins</li><li><b>Tie</b> → later part</li><li><b>Application</b> beats technique</li><li><b>Related parts</b> never split</li><li><b>Year</b> = highest year among its tags</li><li><b>Your override</b> beats everything</li></ul>
    <h4>Questions per focus area <span class="muted">· ${S.filed.toLocaleString()} filed</span></h4>
    <div class="g2cols"><div><div class="g2yr">Year 12</div>${g2Bars(Y(12),amax)}</div><div><div class="g2yr">Year 11</div>${g2Bars(Y(11),amax,'y11')}</div></div>
    <details class="g2more"><summary>All tagging rules</summary><ol class="grules">
      <li><b>Parts are tagged, questions are filed.</b> Each part is tagged; the question is shown whole and filed once.</li>
      <li><b>Home = the subheading with the most marks</b> across the parts' main dot points. A tie goes to the later part.</li>
      <li><b>Related parts are never split.</b> A part from another topic adds a gate, not a second home. Old papers with unrelated parts were split on import.</li>
      <li><b>An application beats a technique</b>: motion, areas, optimisation and finance are the topic; the calculus inside is a gate.</li>
      <li><b>Year</b> is the highest year among the tags. Any Year 12 skill keeps it out of Year 11 lists.</li>
      <li><b>Assumed algebra</b> (factorising, index laws, surds…) is a gate only when the marks are for that skill.</li>
      <li><b>"Also assessed" dot points</b> record coverage only.</li>
      <li><b>Not in Advanced</b>: marked removed (e.g. 3D trigonometry, now Extension 1) or kept with its Standard topic (e.g. bivariate data).</li>
      <li><b>"Show the derivative, hence integrate"</b> → integration.</li>
      <li><b>sec, cosec, cot graphs</b> → the trig-graph dot point, with a note.</li>
      <li><b>Product, quotient, chain rule</b>: exp/log/trig → Y12-240; two rules or a choice → Y11-134; else Y11-131/132/133.</li>
      <li><b>How tags are made</b>: two independent AI taggers; agreement stands; a gate dispute goes to a third check; a home dispute ${isEditor()?'comes to Review › Topics':'goes to an editor'}.</li></ol></details>
  </section>

  <section id="g2-diff" class="g2sec"><h3>2 · Difficulty</h3>
    <p class="g2cap">HSC band of a typical student who gets the part fully right. Rated per part.</p>
    <div class="g2scale">${G2_BAND.map(([b,n,d])=>`<div class="g2b b${b}"><b>${b}</b><span>${n}</span><em>${d}</em></div>`).join('')}</div>
    <h4>How the ratings are anchored</h4>
    <div class="g2anchor">
      <div class="g2an"><b>${S.ref}</b><span>HSC parts rated first</span><em>The reference set</em></div><span class="g2arr" aria-hidden="true">→</span>
      <div class="g2an"><b>${(S.parts-S.ref).toLocaleString()}</b><span>Other parts</span><em>Each matched to its closest HSC reference</em></div><span class="g2arr" aria-hidden="true">→</span>
      <div class="g2an hl" id="g2chk">${g2ChkHTML(chk,chg,S.ref)}</div><span class="g2arr" aria-hidden="true">→</span>
      <div class="g2an"><b>${S.src.shifted||0}</b><span>Parts moved with them</span><em>Same shift as their reference</em></div></div>
    <p class="g2cap">No official band list exists: NESA's mapping grids give marks and outcomes, not bands. The HSC reference set is the baseline.</p>
    <div class="g2cols"><div><h4>Question band</h4><div class="g2calc"><div><span>(a)</span><b>Band 3</b><em>× 2 marks</em></div><div><span>(b)</span><b>Band 5</b><em>× 3 marks</em></div><div class="eq"><span>=</span><b>Band 4.2</b><em>→ shown as 4</em></div></div>
      <p class="g2cap">Marks-weighted mean of its parts, to the nearest half.</p></div>
      <div><h4>Marks by band <span class="muted">· whole bank</span></h4>${g2Bars([2,3,4,5,6].map(b=>['Band '+b,S.band[b],g2pct(S.band[b],bt)+'%']),bmax,'band')}</div></div>
  </section>

  <section id="g2-wm" class="g2sec"><h3>3 · Fluency or problem solving</h3>
    <p class="g2cap">From the 2024 syllabus' Working Mathematically outcome. One label per part.</p>
    <div class="g2vs"><div class="uf"><b>Fluency</b><span>Recognise it, then a standard method gets there</span><ul><li>Differentiate or integrate</li><li>Apply a known formula</li><li>Read or sketch a familiar graph</li><li>Direct probability calculation</li></ul></div>
      <div class="pr"><b>Problem solving</b><span>Choose or build the method</span><ul><li>Model a situation</li><li>Show that · prove · explain why</li><li>Interpret in context</li><li>Combine ideas not spelt out</li></ul></div></div>
    <div class="g2split"><span class="uf" style="flex:${S.wm.UF||1}">Fluency ${g2pct(S.wm.UF,wt)}%</span><span class="pr" style="flex:${S.wm.PR||1}">Problem solving ${g2pct(S.wm.PR,wt)}%</span></div>
    <p class="g2cap">Share of all marks in the bank, counted part by part. A question with any problem-solving part is labelled Problem solving.</p>
  </section>

  <section id="g2-ex" class="g2sec"><h3>4 · Examples from the bank</h3>${ex}</section>

  </div><div class="g2pg2">
  <section id="g2-now" class="g2sec"><h3>1 · The system today</h3>
    <div class="g2flow">${[['Source PDFs','Google Drive'],['Parse','AI, per paper'],['Load','SQLite'],['Tag','2 taggers + check'],['Solutions','format · write'],['Diagrams','TikZ redraw'],['Check','independent'],['Build','bank.json'],['Questgen','this page']].map(([a,b],i)=>`${i?'<span class="g2arr" aria-hidden="true">→</span>':''}<div class="g2st${i===8?' hl':''}"><b>${a}</b><span>${b}</span></div>`).join('')}</div>
    <p class="g2cap">Steps 2–8 run in Claude sessions with the Python tools in <code>tools/</code>. Every step has a written spec.</p>
    <div class="g2stores">
      <div class="g2card"><div class="g2k">Master data</div><b>questions.db</b><span>${(g=>`SQLite${g.mb?` · ${g.mb} MB`:''}${g.asof?` · at the build of ${esc(g.asof)}`:''}`)(G2_DB())}</span><table class="g2mini">${G2_DB().tables.map(([t,n])=>`<tr><td>${t}</td><td>${n.toLocaleString()}</td></tr>`).join('')}</table></div>
      <div class="g2card"><div class="g2k">Published with the page</div><b>Page files</b><span>Static, rebuilt from the database</span><table class="g2mini"><tr><td>Question index</td><td>small, at start</td></tr><tr><td>Question text</td><td>per topic</td></tr><tr><td>Page images</td><td>per paper, while in review</td></tr><tr><td>Diagrams (SVG)</td><td>asset store</td></tr><tr><td>Specs + tools</td><td>GitHub</td></tr></table></div>
      <div class="g2card"><div class="g2k">Written from the page</div><b>Page database</b><span>Shared, in claude.ai</span><table class="g2mini"><tr><td colspan="2" style="color:var(--accent)">Mirrored into questions.db (page_*)</td></tr><tr><td>reviews</td><td>approvals, flags</td></tr><tr><td>difficulty</td><td>your checks</td></tr><tr><td>exams</td><td>saved exams</td></tr><tr><td>reports</td><td>question reports</td></tr><tr><td>progress</td><td>jobs, queue, import</td></tr></table></div>
      <div class="g2card"><div class="g2k">Backup</div><b>Google Drive</b><span>Database, files, review export</span><table class="g2mini"><tr><td>When</td><td>after major changes</td></tr><tr><td>How</td><td>by Claude, on request</td></tr></table></div></div>
    <h4>Limits today</h4>
    <div class="g2lim">${[['Access','claude.ai accounts only, shared by invitation'],['Updates','Content changes need a Claude session, then a republish'],['Printing','Download, then print from the browser'],['Data','Page decisions are copied into the database at each rebuild (sync_pagedb.py), not live'],['Scale','One page, under the 256 MB platform cap; a small index loads at start, question text per topic']].map(([a,b])=>`<div><b>${a}</b><span>${b}</span></div>`).join('')}</div>
  </section>

  <section id="g2-data" class="g2sec"><h3>2 · Data model</h3>
    <p class="g2cap">How the tables connect. A paper (document) has questions; a question has parts; everything else hangs off a question or a part.</p>
    <div class="g2scroll g2schema">${schemaSVG()}</div>
    <div class="g2lim g2keys">${[['documents','One row per PDF found on Drive, including ones left out'],['questions','One per question as filed; QID is its id'],['parts','Each (a), (i)… Answerable parts carry marks'],['tags','Several per part: main dot point, gates, can use'],['part_difficulty','One per answerable part, with the model’s and your ratings']].map(([a,b])=>`<div><b>${a}</b><span>${b}</span></div>`).join('')}</div>
  </section>
  <section id="g2-live" class="g2sec"><h3>3 · Going live</h3>
    <div class="g2block"><b>Blocker first</b><span>Copyright: the bank holds NESA and school papers. Get advice on licensing before anyone outside CMC can see it.</span></div>
    <h4>Target</h4>
    <div class="g2arch">
      <div class="g2lane"><div class="g2box user"><b>Teachers</b><span>Browser, phone</span></div></div>
      <span class="g2arr down" aria-hidden="true">↓</span>
      <div class="g2lane"><div class="g2box"><b>Web app</b><span>Teach: Bank · Exams · Guide. Curate (editors): Review · Papers · Processes</span></div><div class="g2box"><b>Accounts</b><span>Sign-in, roles, schools</span></div></div>
      <span class="g2arr down" aria-hidden="true">↓</span>
      <div class="g2lane"><div class="g2box"><b>API</b><span>Search, exams, reviews, reports, PDF export</span></div></div>
      <span class="g2arr down" aria-hidden="true">↓</span>
      <div class="g2lane"><div class="g2box db"><b>Postgres</b><span>Questions, tags, difficulty, exams</span></div><div class="g2box db"><b>File storage + CDN</b><span>Diagrams, page images</span></div></div>
      <span class="g2arr up" aria-hidden="true">↑</span>
      <div class="g2lane"><div class="g2box job"><b>Content pipeline</b><span>Same Python tools + Claude API, run as jobs</span></div></div></div>
    <h4>What moves where</h4>
    <div class="g2scroll"><table class="g2t g2map"><thead><tr><th>Today</th><th></th><th>Live</th></tr></thead><tbody>${[
      ['SQLite questions.db','Postgres (same tables)'],['bank.json loaded whole','API queries, page by page'],['Page database, mirrored in page_* tables','Postgres tables, written directly by the app'],
      ['Page images, SVG in page files','File storage behind a CDN'],['claude.ai sharing','Accounts with roles: viewer, teacher, editor, admin'],['Download, then print','Server-made PDF'],
      ['Claude sessions run the pipeline','Scheduled jobs calling the Claude API'],['Drive copies on request','Automatic nightly backups']].map(([a,b])=>`<tr><td>${a}</td><td class="g2to">→</td><td>${b}</td></tr>`).join('')}</tbody></table></div>
    <h4>Steps</h4>
    <ol class="g2steps">${[
      ['Clear copyright','Licences or permission for every paper source; drop what can’t be cleared.','Blocker'],
      ['Freeze the data model','Specs + schema become the contract. Add ids for reports and exams.',''],
      ['Move the data','SQLite → Postgres; export the page database; upload files to storage.',''],
      ['Build the app','Port the page’s screens to a web framework; keep MathJax and the exam layout code.','Biggest step'],
      ['Accounts and roles','Sign-in for staff; per-school spaces if sold to other schools.',''],
      ['Pipeline as jobs','Wrap the tools so new papers import on a schedule with Claude API calls.',''],
      ['Staging, then live','Parallel run with this page; compare counts; switch over; nightly backups and monitoring.','']].map(([t,d,k],i)=>`<li><span class="n">${i+1}</span><div><b>${t}</b>${k?`<em class="k${k==='Blocker'?' bad':''}">${k}</em>`:''}<span>${d}</span></div></li>`).join('')}</ol>
    <h4>Hosting choices</h4>
    <div class="g2vs"><div><b>Managed</b><span>Hosted database + app platform (e.g. Supabase, Vercel)</span><ul><li>Fastest to set up</li><li>Little server upkeep</li><li>Monthly fees grow with use</li></ul></div>
      <div><b>Own cloud account</b><span>e.g. AWS, Azure, Google Cloud</span><ul><li>Full control, data-location choice</li><li>Needs a developer to run it</li><li>Better at large scale</li></ul></div></div>
    <p class="g2cap">Either way: the question data, specs and tools carry over unchanged. The page itself is rewritten, not moved.</p>
  </section></div></div>`;
  $$('#guideBox details.g2ex').forEach(d=>{const fill=()=>{const el=d.querySelector('[data-gq]');if(d.open&&el&&!el.dataset.done){const q=QG.byId.get(+el.dataset.gq);el.innerHTML=qBody(q,'bank');el.dataset.done=1;hydrate(el,q,'bank');el.querySelectorAll('details.solbox').forEach(x=>x.open=false);typeset(el)}};d.addEventListener('toggle',fill);fill()});
  typeset(box)}
document.addEventListener('click',e=>{const a=e.target.closest('.g2nav a');if(!a)return;e.preventDefault();const t=document.querySelector(a.getAttribute('href'));if(t)t.scrollIntoView({behavior:RM.matches?'auto':'smooth',block:'start'})});
