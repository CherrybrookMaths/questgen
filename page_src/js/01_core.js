const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
let B=null, DOTS=[], DM={}, reviews={}, db=null, me=null;
let sel=null, search='', rlist=[], ridx=0, rfilter='diagrams', rstatus='todo', rdoc='', editing=null, revealed=new Set();
function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('on');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('on'),1800)}
function save(k,v){try{localStorage.setItem(k,v)}catch(e){}}
function load(k){try{return localStorage.getItem(k)}catch(e){return null}}
const docLabel=d=>String(d?.label||'').replace('NESA NESA','NESA');
const qid=q=>'QID '+String(q.id).padStart(4,'0');   // owner: every question has a QID; the source line is paper + question number
const srcLine=q=>docLabel(B.docs[q.doc])+' Q'+q.number;
// MathJax 4 loads its font data asynchronously, so typesetPromise only exists once startup.promise resolves: wait for it.
// Also wait for the Tinos web font, so the table fitting below measures with the final text font, not the fallback.
const typeset=el=>{const M=window.MathJax;const ready=Promise.all([M?.startup?.promise,document.fonts?.ready]).catch(()=>{});
  return ready.then(()=>window.MathJax?.typesetPromise?.([el])).then(()=>{fitTables(el);fitOptTables(el)}).catch(()=>{})};
// owner: nothing may protrude from a table cell. After typesetting, widen the label column to its widest entry,
// and all value columns (kept equal) to the widest value; the first guess from character counts is only a starting point.
// owner: "make it so that the word is not split up". A cell is never narrower than its widest piece of maths OR its
// longest word (measured in the cell's own font), so headers like "Amplitude" stay whole.
const _mctx=document.createElement('canvas').getContext('2d');
function cellMinW(td){
  if(td.classList.contains('dg')){const wOf=sel=>{let w=0;td.querySelectorAll(sel+' mjx-container').forEach(m=>w=Math.max(w,m.getBoundingClientRect().width));return w};const a=wOf('.dgtr'),c=wOf('.dgbl');return Math.max(a,c)+0.45*Math.min(a,c)+12}   // split corner cell: labels sit diagonally, so the cell only needs the wider label plus part of the other (owner 12 Nov: "period / rate box is still too big")
  let w=0; td.querySelectorAll('mjx-container').forEach(m=>{w=Math.max(w,m.getBoundingClientRect().width)});
  const tw=document.createTreeWalker(td,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement.closest('mjx-container')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  for(let n=tw.nextNode();n;n=tw.nextNode()){const cs=getComputedStyle(n.parentElement);_mctx.font=`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    n.textContent.split(/\s+/).forEach(x=>{if(x)w=Math.max(w,_mctx.measureText(x).width)})}
  return w;
}
function fitOptTables(root){(root||document).querySelectorAll('table.ot').forEach(t=>{   // MCQ answer tables: widen a column only if its typeset maths needs more room
  const cols=[...t.querySelectorAll('colgroup col')]; if(cols.length<2) return;
  const fs=parseFloat(getComputedStyle(t).fontSize)||16, need=cols.map(()=>0);
  t.querySelectorAll('tbody tr').forEach(tr=>[...tr.children].forEach((td,i)=>{const m=td.querySelector('mjx-container');if(m&&i<need.length)need[i]=Math.max(need[i],(m.getBoundingClientRect().width+20)/fs)}));
  let tot=0; cols.forEach((c,i)=>{const w=Math.max(parseFloat(c.style.width)||0,need[i]);c.style.width=w.toFixed(2)+'em';tot+=w}); t.style.width=tot.toFixed(2)+'em';
})}
// owner: "the table seems too long, will it scale itself?" A data table wider than its column shrinks (down to 62%) instead of scrolling
function scaleTables(root){(root||document).querySelectorAll('.dtwrap>table.dt:not(.ot)').forEach(t=>{t.style.fontSize='';
  const avail=t.parentElement.clientWidth, w=t.offsetWidth; if(avail>0&&w>avail+1) t.style.fontSize=Math.max(0.62,(avail-2)/w).toFixed(3)+'em'})}
function fitTables(root){fitTables0(root);scaleTables(root)}
function fitTables0(root){(root||document).querySelectorAll('table.dt:not(.ot)').forEach(t=>{   // MCQ answer tables size themselves (optTableHTML)
  const cols=[...t.querySelectorAll('colgroup col')]; if(!cols.length) return;
  const fs=parseFloat(getComputedStyle(t).fontSize)||16, lc=t.querySelector('th.rl,th.lab')?1:0;
  const need=cols.map(()=>0);
  t.querySelectorAll('tr').forEach(tr=>{let ci=0;[...tr.children].forEach(td=>{const k=td.colSpan||1;
    if(k===1&&ci<need.length){const w=cellMinW(td)+20;need[ci]=Math.max(need[ci],w/fs)}ci+=k})});
  const cur=cols.map(c=>parseFloat(c.style.width)||0);
  if(t.dataset.percol){let tot=0;cols.forEach((c,i)=>{const w=Math.max(cur[i],need[i]);c.style.width=w.toFixed(2)+'em';tot+=w});t.style.width=tot.toFixed(2)+'em';return}
  // equal value columns sized from the typeset maths (not the character-count estimate), so wide number tables fit like the paper
  const lw=lc?Math.max(3,need[0]||cur[0]):0, vw=Math.max(3.5,...need.slice(lc).map((x,i)=>x?x*1.3:cur[lc+i]));
  cols.forEach((c,i)=>c.style.width=((i<lc?lw:vw)).toFixed(2)+'em');
  t.style.width=(lw+vw*(cols.length-lc)).toFixed(2)+'em';
})}

