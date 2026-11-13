// owner 13 Nov: "add a place somewhere for me to write down what to flesh out next"
/* ---------- Next up notes (owner 13 Nov: "add a place somewhere for me to write down what to flesh out next") ----------
   A "Next up" card on Processes (Curate, so editors only). db collection "notes", one doc per note:
   {text, order, done, by, at}. Open notes in `order`; ticked ones move to a collapsed "Done" list. Reorder by dragging
   (desktop) or the ↑ ↓ buttons; delete asks inline (no confirm()). Only editors write: every handler checks isEditor().
   Claude reads this list (ArtifactData list on "notes") when asked what to build next. */
const NOTES={list:[],sub:null,loaded:false,del:null,drag:null};
const notesOpen=()=>NOTES.list.filter(n=>!n.done).sort((a,b)=>(+a.order||0)-(+b.order||0)||String(a.at).localeCompare(String(b.at)));
const notesDone=()=>NOTES.list.filter(n=>n.done).sort((a,b)=>String(b.doneAt||b.at).localeCompare(String(a.doneAt||a.at)));
function notesSubscribe(){if(NOTES.sub||!db||!isEditor())return;
  try{NOTES.sub=db.collection('notes').onSnapshot(s=>{const d=s.docs||s;NOTES.list=(d||[]).map(x=>({id:x.id,...(typeof x.data==='function'?x.data():x.data)})).filter(n=>n&&typeof n.text==='string');NOTES.loaded=true;notesList()},()=>{})}catch(e){}}
// the card is drawn once (so a half-typed note survives the Processes refresh); only the list inside it is redrawn
function renderNotes(){const box=$('#notesBox');if(!box)return;box.hidden=!isEditor();if(box.hidden)return;
  if(!box.dataset.ready){box.dataset.ready='1';
    box.innerHTML=`<section class="psec nup" aria-labelledby="nupH"><h3 id="nupH">Next up <span class="pcount" id="nupN" hidden></span></h3>
      <form class="nupadd" id="nupForm" autocomplete="off"><label class="sr" for="nupIn">New note</label><input id="nupIn" type="text" maxlength="500" placeholder="What to flesh out next…"><button type="submit" class="act">Add</button></form>
      <div id="nupList"></div></section>`}
  notesSubscribe();notesList()}
function noteRow(n,i,len){const del=NOTES.del===n.id;
  return `<li class="nrow" data-note="${esc(n.id)}" draggable="${del?'false':'true'}"><span class="ngrip" aria-hidden="true" title="Drag to reorder">⋮⋮</span>
    <input type="checkbox" class="ntick" data-ntick="${esc(n.id)}" aria-label="Done: ${esc(n.text)}">
    <span class="ntext">${esc(n.text)}</span>
    <span class="nacts">${del?`<span class="ndelq">Delete? <button type="button" class="nyes" data-ndelok="${esc(n.id)}">Delete</button><button type="button" class="nno" data-ndelno="1">Keep</button></span>`:
      `<button type="button" class="nbtn" data-nmove="-1" data-nid="${esc(n.id)}" aria-label="Move up"${i===0?' disabled':''}>↑</button><button type="button" class="nbtn" data-nmove="1" data-nid="${esc(n.id)}" aria-label="Move down"${i===len-1?' disabled':''}>↓</button><button type="button" class="nbtn ndel" data-ndel="${esc(n.id)}" aria-label="Delete note">×</button>`}</span></li>`}
function notesList(){const el=$('#nupList');if(!el)return;const op=notesOpen(),dn=notesDone(),wasOpen=!!el.querySelector('details.ndone[open]');
  const n=$('#nupN');if(n){n.hidden=!op.length;n.textContent=op.length}
  el.innerHTML=(op.length?`<ol class="nlist">${op.map((x,i)=>noteRow(x,i,op.length)).join('')}</ol>`:`<p class="pempty">${NOTES.loaded||!db?'Ideas for what to build next. Claude reads this list.':'Loading notes…'}</p>`)+
    (dn.length?`<details class="ndone"${wasOpen?' open':''}><summary>Done <span class="pcount">${dn.length}</span></summary><ul class="nlist">${dn.map(x=>`<li class="nrow isdone" data-note="${esc(x.id)}"><input type="checkbox" class="ntick" data-ntick="${esc(x.id)}" checked aria-label="Not done: ${esc(x.text)}"><span class="ntext">${esc(x.text)}</span><span class="nacts">${NOTES.del===x.id?`<span class="ndelq">Delete? <button type="button" class="nyes" data-ndelok="${esc(x.id)}">Delete</button><button type="button" class="nno" data-ndelno="1">Keep</button></span>`:`<button type="button" class="nbtn ndel" data-ndel="${esc(x.id)}" aria-label="Delete note">×</button>`}</span></li>`).join('')}</ul></details>`:'')}
async function noteSet(n,patch){if(!isEditor()||!db)return false;const {id,...rest}=n;
  try{await db.doc('notes/'+id).set({...rest,...patch});return true}catch(e){toast('Could not save. Try again in a moment.');return false}}
// write a new order 1..n for the open notes, only for the ones that moved
async function notesReorder(ids){if(!isEditor())return;const by=Object.fromEntries(NOTES.list.map(n=>[n.id,n]));
  const ch=ids.map((id,i)=>[by[id],i+1]).filter(([n,o])=>n&&+n.order!==o);ch.forEach(([n,o])=>n.order=o);notesList();
  for(const [n,o] of ch)await noteSet(n,{order:o})}
document.addEventListener('submit',async e=>{if(e.target.id!=='nupForm')return;e.preventDefault();if(!isEditor()||!db)return;
  const inp=$('#nupIn'),t=inp.value.trim();if(!t)return;const op=notesOpen();
  const id='n'+Date.now().toString(36)+Math.floor(Math.random()*1e6).toString(36);
  const doc={text:t.slice(0,500),order:(op.length?Math.max(...op.map(n=>+n.order||0)):0)+1,done:false,by:me||null,at:new Date().toISOString()};
  try{await db.doc('notes/'+id).set(doc);inp.value='';inp.focus()}catch(_){toast('Could not save. Try again in a moment.')}});
document.addEventListener('click',async e=>{const t=e.target;if(!t.closest||!t.closest('#notesBox'))return;
  const mv=t.closest('[data-nmove]');if(mv){const ids=notesOpen().map(n=>n.id),i=ids.indexOf(mv.dataset.nid),j=i+ +mv.dataset.nmove;if(i<0||j<0||j>=ids.length)return;
    [ids[i],ids[j]]=[ids[j],ids[i]];await notesReorder(ids);const b=document.querySelector(`#nupList [data-nid="${CSS.escape(mv.dataset.nid)}"][data-nmove="${mv.dataset.nmove}"]`);if(b&&!b.disabled)b.focus();return}
  const dl=t.closest('[data-ndel]');if(dl){NOTES.del=dl.dataset.ndel;notesList();const k=$('#nupList [data-ndelno]');if(k)k.focus();return}
  if(t.closest('[data-ndelno]')){const id=NOTES.del;NOTES.del=null;notesList();const b=id&&document.querySelector(`#nupList [data-ndel="${CSS.escape(id)}"]`);if(b)b.focus();return}
  const ok=t.closest('[data-ndelok]');if(ok){if(!isEditor()||!db)return;const id=ok.dataset.ndelok;NOTES.del=null;
    try{await db.doc('notes/'+id).delete();NOTES.list=NOTES.list.filter(n=>n.id!==id);notesList();toast('Note deleted')}catch(_){toast('Could not delete. Try again in a moment.')}return}});
document.addEventListener('change',async e=>{const c=e.target.closest&&e.target.closest('#notesBox [data-ntick]');if(!c)return;
  const n=NOTES.list.find(x=>x.id===c.dataset.ntick);if(!n)return;if(!isEditor()){c.checked=!!n.done;return}
  const done=c.checked,patch={done,doneAt:done?new Date().toISOString():null};
  if(!done)patch.order=(Math.max(0,...notesOpen().map(x=>+x.order||0)))+1;   // un-ticked: back to the end of the list
  Object.assign(n,patch);notesList();await noteSet(n,patch)});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&NOTES.del&&e.target.closest&&e.target.closest('#notesBox')){NOTES.del=null;notesList()}});
// drag to reorder (desktop); the ↑ ↓ buttons do the same from the keyboard or a phone
document.addEventListener('dragstart',e=>{const li=e.target.closest&&e.target.closest('#nupList .nlist>li[draggable="true"]');if(!li)return;NOTES.drag=li.dataset.note;li.classList.add('ndrag');try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',NOTES.drag)}catch(_){}});
document.addEventListener('dragover',e=>{if(!NOTES.drag)return;const li=e.target.closest&&e.target.closest('#nupList .nlist>li[draggable]');if(!li||li.dataset.note===NOTES.drag)return;e.preventDefault();
  const r=li.getBoundingClientRect(),after=e.clientY>r.top+r.height/2;$$('#nupList .nover-a,#nupList .nover-b').forEach(x=>x.classList.remove('nover-a','nover-b'));li.classList.add(after?'nover-a':'nover-b')});
document.addEventListener('drop',async e=>{if(!NOTES.drag)return;const li=e.target.closest&&e.target.closest('#nupList .nlist>li[draggable]');e.preventDefault();const from=NOTES.drag;NOTES.drag=null;
  if(!li||li.dataset.note===from){notesList();return}const after=li.classList.contains('nover-a'),ids=notesOpen().map(n=>n.id).filter(x=>x!==from);
  let k=ids.indexOf(li.dataset.note);if(k<0){notesList();return}ids.splice(after?k+1:k,0,from);await notesReorder(ids)});
document.addEventListener('dragend',()=>{if(NOTES.drag){NOTES.drag=null;notesList()}});
if(view==='processes')renderNotes();   // Processes may already be open when this block loads
