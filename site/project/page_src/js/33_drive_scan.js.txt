// owner 13 Nov: "Where is the button to rescan the drive?" (earlier: "New exams are gonna be added to this folder periodically we need a way to ... see what we actually haven't ingested yet")
/* ---------- Rescan drive (Processes › Papers, Curate: editors only) ----------
   A button next to the "last scan" time walks the shared exam folder in Google Drive READ-ONLY with the viewer's own Google
   Drive connector (runtime capability mcp, tool search_files: one query per folder, parentId = '<id>' and folder / PDF mimeType
   clauses, pageToken, excludeContentSnippets). The folder id is data/inventory.json root_drive_id (tools/inventory.py), never
   written here. The folder is a school shared drive other staff use: this code only ever SEARCHES it (IMPORT_PLAYBOOK: never
   move, rename or reorganise anything there).
   A file is known when its Drive id or its path (case-insensitive, as Windows is) is in the recorded-files list; a file with the same
   size as a recorded one is shown as "same size as <path>" (probably moved or copied; tools/scan_folder.py decides when Claude
   records it). New files are classified with inventory.rules = tools/classify_paths.py RULES (one copy of the rules; the page
   test checks this port against the Python on every recorded path) and grouped by course x year level, as the grid is.
   Each finished scan is saved to db collection "scans", one doc per scan: {at, by, new:[{id, name, path, size, course, year,
   yl, task, school, status, why, like?}], counts}. Claude folds them into the documents table at the next import step
   (IMPORT_PLAYBOOK "New papers in the shared folder"). A cancelled or failed scan saves nothing.
   No mcp in this view (claude.use('mcp') null): no button, "Ask Claude to rescan". Viewers: nothing (renderInv never runs).
   The recorded-files list (~3,300 files) is NOT in data/inventory.json: it is data/inventory_files.json (inventory.files_url),
   fetched only when needed, i.e. when Rescan drive is pressed or a saved scan is to be listed, so a normal Processes load stays
   small (CODE_HEALTH rule 6, 13 Nov: the Drive rescan took the inventory past 600 KB).
   No new page-wide name: everything hangs off PQ (32_papers_q.js) as PQ.scan. */
PQ.scan=(()=>{
const SERVER='Google Drive',TOOL='search_files',FOLDER='application/vnd.google-apps.folder',PDF='application/pdf';
// limits so a scan can never run away: folders walked, pages per folder, calls at once, files kept in one scan doc
const LIM={folders:3000,pages:60,workers:3,keep:500,page:100};
const S={mcp:undefined,run:null,prog:null,fresh:null,err:'',scans:[],sub:null,K:null,KF:null,RX:null,RF:null,files:null,filesP:null,filesFor:null};
const inv=()=>PQ.state.data;
const sleep=(ms,signal)=>new Promise((res,rej)=>{const t=setTimeout(res,ms);signal&&signal.addEventListener('abort',()=>{clearTimeout(t);rej({code:'cancelled'})},{once:true})});
const key=p=>String(p||'').normalize('NFC').replace(/\\/g,'/').replace(/^\/+|\/+$/g,'').replace(/\s+/g,' ').toLowerCase();
const reEsc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const gid=r=>r.course+'|'+(r.yl===11||r.yl===12?String(r.yl):'?');   // the grid's year levels (tools/inventory.py yl_of)

// ---- what the record already has (data/inventory_files.json: {built, dirs, f:[[dir, name, size, drive id]]}), fetched on demand
const filesUrl=()=>{const D=inv(),u=D&&D.files_url;return typeof u==='string'&&/^data\/[\w.-]+\.json$/.test(u)?u:null};
function loadFiles(){const D=inv(),u=filesUrl();if(!u)return Promise.resolve(null);
  if(S.files&&S.filesFor===D)return Promise.resolve(S.files);if(S.filesP)return S.filesP;
  S.filesP=fetch(u+'?v='+encodeURIComponent(D.built||'')).then(r=>r.ok?r.json():null).then(j=>{S.files=j&&Array.isArray(j.f)&&Array.isArray(j.dirs)?j:null;S.filesFor=D;return S.files},()=>null).finally(()=>{S.filesP=null});
  return S.filesP}
function known(){const F=S.files;if(!F||S.filesFor!==inv())return null;if(S.KF===F)return S.K;
  const K={ids:new Set(),paths:new Set(),sizes:new Map()};
  for(const [d,n,sz,id] of F.f){const p=(F.dirs[d]?F.dirs[d]+'/':'')+n;K.paths.add(key(p));if(id)K.ids.add(id);if(sz&&!K.sizes.has(sz))K.sizes.set(sz,p)}
  S.K=K;S.KF=F;return K}
// a saved scan to list needs the record: fetch it once, then draw again
function needFiles(){if(!S.filesP&&!known()&&filesUrl())loadFiles().then(f=>{if(f){paint();PQ.sub()}})}
const isKnown=(K,f)=>!!(f.id&&K.ids.has(f.id))||K.paths.has(key(f.path));

// ---- tools/classify_paths.py classify_path, from the rules it exports (RULES): course, year level, task, year, school, status
function rx(){const R=inv()&&inv().rules;if(!R)return null;if(S.RF===R)return S.RX;
  const c=x=>new RegExp(x);
  S.RX={R,course:R.course.map(([x,v])=>[c(x),v]),yl:R.year_level.map(([x,v])=>[c(x),v]),
    task:R.task.map(r=>({on:r.on,re:c(r.re),not:r.not?c(r.not):null,task:r.task})),year:c(R.year),
    schools:[...R.schools,...R.providers].map(s=>[s,new RegExp('\\b'+reEsc(s)+'\\b','i')]),bundled:new RegExp(R.bundled,'i'),
    fb:R.fallback?{ma:c(R.fallback.course_advanced),school:c(R.fallback.school),old:c(R.fallback.old_year)}:null};
  S.RF=R;return S.RX}
function classify(p){const X=rx();if(!X)return null;const R=X.R,name=p.split('/').pop(),lp=p.toLowerCase(),ln=name.toLowerCase();
  const first=(L,t)=>{for(const [r,v] of L)if(r.test(t))return v;return null};
  let course=first(X.course,lp)||'unknown';const yl=first(X.yl,lp);
  let task='unknown';for(const r of X.task){if(r.re.test(r.on==='both'?' '+ln:ln)&&!(r.not&&r.not.test(ln))){task=r.task;break}}
  const m=X.year.exec(name)||X.year.exec(p);
  let school=null;for(const src of [name,p]){const hit=X.schools.find(([,r])=>r.test(src));if(hit){school=hit[0];break}}
  let year=m?+m[1]:null;
  // RULES.fallback (13 Nov naming, e.g. "Hornsby Girls Yr12 MA 2026 AT4 w Solutions"): on the name as written, only where the rules above found nothing
  if(X.fb){let f;if(course==='unknown'&&X.fb.ma.test(name))course='advanced';
    if(!school&&(f=X.fb.school.exec(name)))school=f[1].trim();
    if(!year&&(f=X.fb.old.exec(name)))year=+f[1]}
  let status='discovered',why=null;
  if(task==='other'){status='excluded';why='not a question paper (name)'}
  else if(R.off_courses.includes(course)||R.off_year_levels.includes(yl)){status='excluded';why='non-target course/year (name)'}
  else if(course==='unknown'||yl==null||task==='unknown')why='review queue: '+[['course',course==='unknown'],['year_level',yl==null],['task_type',task==='unknown']].filter(x=>x[1]).map(x=>x[0]).join(', ');
  return {course,yl,task,year,school,status,why}}

// ---- the saved scans (db collection scans), newest first
function subscribe(){if(S.sub||!db||!isEditor())return;
  try{S.sub=db.collection('scans').onSnapshot(s=>{const d=s.docs||s;S.scans=(d||[]).map(x=>({id:x.id,...(typeof x.data==='function'?x.data():x.data)})).filter(x=>x&&x.at&&Array.isArray(x.new)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));paint();PQ.sub()},()=>{})}catch(e){}}
// the latest scan for the sub line: {at, n} (n = its new files still not in the record; same-size look-alikes not counted)
function last(){const s=S.scans[0];if(!s)return null;const K=known();if(!K)needFiles();return {at:s.at,n:s.new.filter(f=>!f.like&&!(K&&isKnown(K,f))).length}}

// ---- one search_files call; a retryable error (or rate_limited) waits and is tried ONCE more, never in a loop
async function call(input,signal){
  for(let k=0;;k++){
    try{const r=await S.mcp.callTool(SERVER,TOOL,input,{signal,cache:false});const p=r&&r.payload;
      if(!p||typeof p!=='object')throw {code:'bad_shape'};return p}
    catch(e){if(signal.aborted)throw {code:'cancelled'};
      if(k===0&&e&&(e.retryable||e.code==='rate_limited')){S.prog.wait=true;paint();await sleep(Math.min(60000,e.retryAfterMs||1500+Math.random()*2500),signal);S.prog.wait=false;paint();continue}
      throw e}}}
// walk the folder tree breadth first, LIM.workers folders at a time
async function walk(root,signal){const skip=new Set((inv().scan_skip||[]).map(key)),seen=new Set([root]),queue=[{id:root,path:''}],files=new Map(),P=S.prog;
  async function folder(f){let tok=null,pages=0;
    do{const input={query:`parentId = '${f.id}' and (mimeType = '${FOLDER}' or mimeType = '${PDF}') and trashed = false`,pageSize:LIM.page,excludeContentSnippets:true};if(tok)input.pageToken=tok;
      const p=await call(input,signal),list=Array.isArray(p.files)?p.files:[];
      for(const x of list){if(!x||!x.id)continue;const path=(f.path?f.path+'/':'')+String(x.title||x.name||'');
        if(x.mimeType===FOLDER){if(seen.has(x.id)||skip.has(key(path))||!/^[\w-]+$/.test(x.id))continue;seen.add(x.id);queue.push({id:x.id,path});P.total++;if(P.total>LIM.folders)throw {code:'too_big'}}
        else if(!files.has(x.id)){files.set(x.id,{id:x.id,name:String(x.title||x.name||''),path,size:+x.fileSize||null});P.pdfs++}}
      tok=list.length&&p.nextPageToken?p.nextPageToken:null}while(tok&&++pages<LIM.pages)}
  await new Promise((res,rej)=>{let active=0,dead=false;
    const pump=()=>{if(dead)return;if(!queue.length&&!active)return res();
      while(active<LIM.workers&&queue.length){const f=queue.shift();active++;
        folder(f).then(()=>{active--;P.done++;paint();pump()},e=>{if(!dead){dead=true;rej(e)}})}};
    pump()});
  return [...files.values()]}

async function start(){if(!isEditor()||!S.mcp||typeof S.mcp!=='object'||S.run||!db)return;const D=inv(),root=D&&D.root_drive_id;
  if(!root||!/^[\w-]+$/.test(root)||!rx())return;
  const ac=new AbortController();S.run=ac;S.err='';S.fresh=null;S.prog={done:0,total:1,pdfs:0,wait:false};paint();
  try{if(!await loadFiles()||!known())throw {code:'no_record'};
    const files=await walk(root,ac.signal),K=known(),prev=S.scans[0]||null,before=new Set(prev?prev.new.map(f=>f.id):[]);
    const rows=[];let matched=0;
    for(const f of files){if(isKnown(K,f)){matched++;continue}const c=classify(f.path),like=f.size&&K.sizes.get(f.size);
      rows.push({id:f.id,name:f.name,path:f.path,size:f.size,course:c.course,year:c.year,yl:c.yl,task:c.task,school:c.school,status:c.status,why:c.why,...(like?{like}:{})})}
    rows.sort((a,b)=>a.path.localeCompare(b.path));
    const groups={};rows.filter(r=>!r.like).forEach(r=>{groups[gid(r)]=(groups[gid(r)]||0)+1});
    const fresh=rows.filter(r=>!r.like&&!before.has(r.id)).length;
    const at=new Date().toISOString(),since=[prev&&prev.at,D.last_scan&&D.last_scan.at].filter(Boolean).sort((a,b)=>Date.parse(a)-Date.parse(b)).pop()||null;   // the later of the last Drive rescan and the last folder scan
    const doc={at,by:me||null,root,new:rows.slice(0,LIM.keep),
      counts:{folders:S.prog.done,pdfs:files.length,matched,new:rows.filter(r=>!r.like).length,like:rows.filter(r=>r.like).length,since_last:fresh,groups,...(rows.length>LIM.keep?{truncated:rows.length}:{})}};
    let saved=true;
    try{await db.doc('scans/s'+at.replace(/\D/g,'').slice(0,14)).set(doc)}catch(e){saved=false}
    if(saved&&!S.scans.some(s=>s.at===at))S.scans.unshift({id:'s'+at,...doc});
    S.fresh={n:fresh,earlier:doc.counts.new-fresh,like:doc.counts.like,since,saved,rows:saved?null:rows,pdfs:files.length,folders:S.prog.done};
  }catch(e){S.err=message(e);if(e&&['not_granted','capability_disabled','capability_removed'].includes(e.code))S.mcp=null}
  finally{S.run=null;S.prog=null;paint();PQ.sub()}}
function stop(){if(S.run)S.run.abort()}

// one message per error code: each says what fixes it (never one generic banner)
function message(e){const c=e&&e.code;const again='then press Rescan drive again.';
  switch(c){
    case 'cancelled':return 'Scan cancelled. Nothing was saved.';
    case 'needs_reauth':return 'Google Drive needs reconnecting: claude.ai Settings → Connectors → Google Drive, '+again;
    case 'server_not_connected':return 'Google Drive is not connected for you. Add it in claude.ai Settings → Connectors, '+again;
    case 'selection_required':return 'You have more than one Google Drive connector. Choose one when claude.ai asks, '+again;
    case 'server_not_found':return 'The Google Drive connector is gone. Reconnect it in claude.ai Settings → Connectors, '+again;
    case 'not_in_manifest':case 'approval_required':case 'consent_required':return 'Google Drive was not allowed for this page. Allow it when claude.ai asks (or in the page’s permissions menu), '+again;
    case 'blocked_by_policy':return 'Your organisation’s settings block Google Drive search here. Ask Claude to rescan instead.';
    case 'server_unavailable':case 'rate_limited':return 'Google Drive is busy and did not answer. Nothing was saved. Try again in a few minutes.';
    case 'tool_error':return 'Google Drive reported an error: '+String(e.message||'unknown').slice(0,200)+'. Nothing was saved.';
    case 'not_granted':case 'capability_disabled':case 'capability_removed':return 'This view cannot use Google Drive. Ask Claude to rescan.';
    case 'too_big':return `The folder has more than ${LIM.folders.toLocaleString('en-AU')} subfolders; the scan stopped. Ask Claude to rescan.`;
    case 'bad_shape':return 'Google Drive answered in a form this page does not know. Nothing was saved. Ask Claude to rescan.';
    case 'no_record':return 'The list of recorded files (data/inventory_files.json) did not load. Nothing was scanned. Reload the page and try again, or ask Claude to rescan.';
    case 'user_changed':return '';
    default:return `The scan stopped (${String(c||'error')}). Nothing was saved. Try again, or ask Claude to rescan.`}}

// ---- drawing
const plural=(n,w)=>`${n} ${w}${n===1?'':'s'}`;
function listHTML(rows){const D=inv(),order=((D&&D.groups)||[]).map(g=>g.course+'|'+g.yl),by=new Map();
  rows.forEach(r=>{const g=gid(r);if(!by.has(g))by.set(g,[]);by.get(g).push(r)});
  const ks=[...by.keys()].sort((a,b)=>((order.indexOf(a)+1)||99)-((order.indexOf(b)+1)||99)||a.localeCompare(b));
  return ks.map(k=>{const [c,yl]=k.split('|'),rs=by.get(k),cc=PQ.course(c);
    return `<details class="ivsg" data-ivsg="${esc(k)}"${cc.ready?' open':''}><summary><b>${esc(cc.short||cc.name||c)}</b> <span class="ivyl">${esc(PQ.years[yl]||yl)}</span> <span class="pcount">${rs.length}</span></summary><ul class="ivslist">${rs.map(r=>{const dir=r.path.includes('/')?r.path.slice(0,r.path.lastIndexOf('/')):'';
      return `<li><span class="ivsname">${esc(r.name)}</span>${dir?`<small class="ivsdir">${esc(dir)}</small>`:''}<span class="ivchips">${r.year?`<span class="ivchip">${esc(r.year)}</span>`:''}${r.school?`<span class="ivchip">${esc(r.school)}</span>`:''}${r.status==='excluded'?`<span class="ivchip">${esc(/not a question/.test(r.why||'')?'Not a question paper':'Not imported')}</span>`:''}${r.like?`<span class="ivchip like" title="${esc(r.like)}">Same size as a recorded file</span>`:''}</span></li>`}).join('')}</ul></details>`}).join('')}
function button(){const el=$('#ivScanBtn');if(!el)return;const D=inv();
  if(S.mcp===undefined||S.mcp==='asking'||!D){el.innerHTML='';return}
  if(S.mcp===null||!D.root_drive_id||!filesUrl()||!D.rules){el.innerHTML='<span class="ivask" title="Rescanning needs the Google Drive connector, which this view does not have">Ask Claude to rescan</span>';return}
  if(!$('#ivScanGo'))el.innerHTML='<button type="button" class="act ivscanb" id="ivScanGo">Rescan drive</button>';
  $('#ivScanGo').disabled=!!S.run}
function paint(){if(!isEditor())return;button();const el=$('#ivScan');if(!el)return;let h='';
  if(S.prog){const P=S.prog;h+=`<div class="ivsprog" role="status"><span class="ivsptxt">Scanning Google Drive · <b>${P.done}</b> of <b>${P.total}</b> folders · ${plural(P.pdfs,'PDF')}${P.wait?' · <em>waiting for Google Drive…</em>':''}</span>
    <progress max="${P.total}" value="${P.done}" aria-label="Folders scanned"></progress><button type="button" class="act" id="ivScanStop">Cancel</button></div>`}
  if(S.err)h+=`<p class="ivserr" role="alert">${esc(S.err)}</p>`;
  const F=S.fresh;
  if(F){h+=`<p class="ivsres" role="status"><b>${plural(F.n,'new file')} since ${esc(F.since?clockT(F.since):'the first stock-take')}</b> <small>(${plural(F.pdfs,'PDF')} in ${plural(F.folders,'folder')})</small>${F.earlier?` · ${F.earlier} found in an earlier scan, still not in the record`:''}${F.like?` · ${plural(F.like,'file')} with the same size as a recorded file (probably moved or copied)`:''}</p>`;
    if(!F.saved)h+=`<p class="ivserr" role="alert">Could not save this scan for Claude: the list below is on this screen only.</p>${listHTML(F.rows)}`}
  const s=S.scans[0],K=known();if(s&&!K)needFiles();
  if(s&&K){const rows=s.new.filter(f=>!isKnown(K,f)),n=rows.filter(r=>!r.like).length;
    h+=`<div class="ivslast"><p><b>Found in the last scan, not yet in the record: ${n}</b> <small>· scanned ${esc(clockT(s.at))}</small></p>
      <p class="ivsnote">Claude adds these to the record at the next import step.</p>${rows.length?listHTML(rows):''}</div>`}
  el.innerHTML=h}
function render(){if(!isEditor()||!$('#ivScan'))return;subscribe();
  if(S.mcp===undefined){const c=window.claude;if(!c||!c.use)S.mcp=null;
    else{S.mcp='asking';c.use('mcp').then(m=>{S.mcp=m||null},()=>{S.mcp=null}).finally(paint)}}
  paint()}
document.addEventListener('click',e=>{const t=e.target;if(!t.closest||!t.closest('#invBox'))return;
  if(t.closest('#ivScanGo'))start();else if(t.closest('#ivScanStop'))stop()});
if(view==='processes')render();
return {render,last,start,stop,classify,state:S};
})();
