/* ---------- text + tables ---------- */
// owner 12 Nov: "I can see \\textbf in the table heading". Table captions are typed as LaTeX text; turn text-mode
// formatting outside $…$ into HTML so nothing raw shows (bold, italic, sans, \text, \$, line breaks).
function capHTML(c){const parts=String(c||'').split(/(\$[^$]*\$)/);
  return parts.map((x,i)=>{if(i%2)return tex(x);let h=x;for(let k=0;k<4;k++)h=h.replace(/\\textbf\{([^{}]*)\}/g,'\u0001$1\u0002').replace(/\\textit\{([^{}]*)\}/g,'\u0003$1\u0004').replace(/\\(?:textsf|text|textrm|mathrm)\{([^{}]*)\}/g,'$1');
    h=h.replace(/\\\$/g,'$').replace(/\\\\/g,'\n');
    return esc(h).replace(/\u0001/g,'<b>').replace(/\u0002/g,'</b>').replace(/\u0003/g,'<i>').replace(/\u0004/g,'</i>').replace(/\n/g,'<br>')}).join('')}
// owner 24 Nov: "some of the text came out a bit weird": a checker's note "$549.36 (assumes 5 full $2140 payments)" was typeset as
// maths between the two $ signs. Plain notes (why / look reasons, checker notes, flags, calls) go through noteTxt: a $ that starts
// an amount (a number followed by a space, punctuation or the end, not by more maths) is escaped as \$, which MathJax shows as $;
// maths written on purpose ($6.6$, $12\,696$, $f'(1)=12e$) is untouched. Only for HTML that is typeset (MathJax turns \$ into $).
// A second pass runs only when an odd number of $ is left (an amount followed by an operator: "$6700 = 28475/4.25").
const noteTxt=s=>{const AMT=/(?<![\\$])\$(?=\d[\d,]*(?:\.\d+)?(?:[\s),;:!?'"]|\.(?!\d)|$)(?!\s*[=+*\/<>^_-]))/g,AMT2=/(?<![\\$])\$(?=\d[\d,]*(?:\.\d+)?(?:[\s),;:!?'"]|\.(?!\d)|$))/g;
  let t=String(s??'').replace(AMT,'\\$');if(t.replace(/\\\$/g,'').split('$').length%2===0)t=t.replace(AMT2,'\\$');return esc(t)};
function tex(s){
  let h=esc(s).replace(/\\text\{\\textdollar\}/g,'\\$').replace(/\\textdollar/g,'\\$');
  // owner 12 Nov (QID 889 "\underline{\textbf{and}} is not rendering properly", QID 933): text-mode formatting outside maths
  h=h.split(/(\$\$[\s\S]*?\$\$|(?<!\\)\$(?:\\\$|[^$])*?(?<!\\)\$)/).map((seg,i)=>{if(i%2)return seg;let prev;
    do{prev=seg;seg=seg.replace(/\\textbf\{([^{}]*)\}/g,'<b>$1</b>').replace(/\\(?:textit|emph)\{([^{}]*)\}/g,'<i>$1</i>').replace(/\\underline\{([^{}]*)\}/g,'<u>$1</u>').replace(/\\text\{([^{}]*)\}/g,'$1')}while(seg!==prev);
    // owner 24 Nov (2026 HSC Std Q2 showed "$800\,000": "what's with the notation here"): LaTeX spaces in text, as in money
    //   amounts \$800\,000, print as the paper's thin space (narrow no-break, so the number never splits), not as "\,"
    return seg.replace(/\\%/g,'%').replace(/\\&amp;/g,'&amp;').replace(/\\,/g,' ').replace(/\\[;:]/g,' ')}).join('');
  // 23 Nov (owner: "for some questions, the original and question are not lining up any more" + raw \exfigure text): figure names from split
  // questions carry the part in brackets (1305_q1(c)_1), so the name pattern allows ( ) here, in 20_exam.js, bank_split.py and ztable.py
  h=h.replace(/\\exfigure\{([\w.()-]+)\}/g,(m,id)=>`</span><span class="figslot" data-fig="${id}"></span><span>`);
  h=h.replace(/\\extable\{(\w+)\}/g,(m,id)=>`</span>${dtHTML(id)}<span>`);
  // owner: dot points render as dot points. Lists are stored as \begin{itemize} \item … \end{itemize}
  h=h.replace(/\s*\\begin\{enumerate\}\s*\\item\s*/g,'</span><ol class="qlist"><li><span>').replace(/\s*\\end\{enumerate\}\s*/g,'</span></li></ol><span>');   // numbered list as printed (Girraween 2025 Q19)
  h=h.replace(/\s*\\begin\{itemize\}\s*\\item\s*/g,'</span><ul class="qlist"><li><span>').replace(/\s*\\item\s*/g,'</span></li><li><span>').replace(/\s*\\end\{itemize\}\s*/g,'</span></li></ul><span>');
  // owner: "option 1 and 2 should go in a box just like the question": boxed text is stored as \begin{framed} … \end{framed}
  h=h.replace(/\s*\\begin\{framed\}\s*/g,'</span><div class="qbox"><span>').replace(/\s*\\end\{framed\}\s*/g,'</span></div><span>');
  h=h.replace(/\s*\n\s*(\$\$[\s\S]*?\$\$)\s*\n?\s*/g,' $1 ');   // display maths makes its own line: drop the blank lines around it
  return '<span>'+h.replace(/\n\n+/g,'<span class="pbr"></span>').replace(/\n/g,' ')+'</span>';
}
const plain=c=>String(c||'').replace(/\\(text|textit|textbf|mathrm)\{([^}]*)\}/g,'$2').replace(/\\[a-z]+/gi,'x').replace(/[{}$\\]/g,'');
const lineLen=c=>Math.max(0,...String(c||'').split('\\\\').map(x=>plain(x).length));   // longest line of a cell (health pass 21 Nov: was written twice)
function cell(c){c=String(c??'').trim(); if(!c) return ''; const L=c.split('\\\\'); if(L.length<2) return esc('$'+c+'$'); return L.map(x=>'<span class="ln">'+esc('$'+x.trim()+'$')+'</span>').join('')}   // owner: a header wraps where the paper wraps it (\\\\ in the cell)
// \diag{row label}{column label}: a corner cell split by a diagonal, as printed (row label bottom-left, column label top-right)
function diagSplit(c){c=String(c||'').trim(); if(!c.startsWith('\\diag{')) return null; const g=[]; let i=5;
  while(g.length<2&&c[i]==='{'){let d=0,j=i; for(;j<c.length;j++){if(c[j]==='{')d++; else if(c[j]==='}'){d--; if(!d)break}} g.push(c.slice(i+1,j)); i=j+1}
  return g.length===2?g:null}
function dtHTML(id,opts={}){
  const t=B.tables[id]; if(!t) return `<span class="notes">Missing table ${esc(id)}</span>`;
  // owner 12 Nov: "the stem and leaf is not a table, do it as a stem and leaf plot": no grid, one rule between stem and leaves
  // checker 24 Nov (2020 Cherrybrook AT3 Q4): "Put the rest of the stem and leaf plot": leaves stored one per cell were cut to the first
  if(/^stem-and-leaf/i.test(t.cap||'')) return `<div class="dtwrap"><table class="slp"><tbody>${t.rows.map(r=>`<tr><th scope="row">${esc(r[0]??'')}</th><td>${esc(r.slice(1).filter(x=>String(x??'').trim()!=='').join(' '))}</td></tr>`).join('')}</tbody></table></div>`;
  const rows=t.rows, n=Math.max(...rows.map(r=>r.length)), lc=t.lc?1:0, hr=t.hr||0;
  const span={}, rspan={}, covered=new Set(); (t.spans||[]).forEach(([r,c,k,rs])=>{span[r+','+c]=k||1; if(rs>1){rspan[r+','+c]=rs; for(let i=1;i<rs;i++)for(let j=0;j<(k||1);j++)covered.add((r+i)+','+(c+j))}});
  // owner: columns are only forced equal for number tables (x / P(X=x), periods / rates); tables of words size each column to
  // its longest line, with headers wrapping where the paper wraps them ("Height and Gender can be narrowed")
  const hdr=rows[Math.max(0,hr-1)]||[], uniform=!hr||hdr.slice(lc).every(c=>lineLen(c)<=8);
  // owner 24 Nov (2024 HSC Std Q20, "is this table approved? Why is it like that"): a split corner cell is two labels side by side plus the
  //   gap between them (03_question.css .dgw), so its column is sized for both; it was sized as one short word and "Rate" spilled into 1%
  const cellLen=c=>{const dg=diagSplit(c);return dg?2*Math.max(lineLen(dg[0]),lineLen(dg[1]))+3:lineLen(c)};
  const colLen=j=>Math.max(...rows.map((r,i)=>covered.has(i+','+j)||(span[i+','+j]>1)?0:cellLen(r[j])));
  const lw=lc?Math.min(Math.max(colLen(0),4),24)*0.62+1.4:0;
  const vw=Math.min(Math.max(...rows.flatMap(r=>r.slice(lc).map(c=>lineLen(c))),3),14)*0.62+1.8;
  const ws=Array.from({length:n},(_,j)=>j<lc?lw:uniform?vw:Math.min(Math.max(colLen(j),3),26)*0.6+1.8);
  const cols=`<colgroup>${ws.map(w=>`<col style="width:${w.toFixed(1)}em">`).join('')}</colgroup>`;
  const width=ws.reduce((a,b)=>a+b,0).toFixed(1);
  // checker 17 Nov (2024 Oakhill AT2 Q16): "The first table in the question is running off the page to the right." A table wider than
  // its column now shrinks to fit (fixed layout keeps the columns' proportions) instead of scrolling off the side.
  // checker 17 Nov (2024 Sydney Tech Q30, the 11-column z-table): "Make the text in each of the boxes bigger, not changing the size of each
  // box": a table shrinks to at most 80% of its natural width; narrower than that it scrolls inside its own box (.dtwrap) instead of
  // squeezing the numbers.
  const tr=(r,ri,head)=>{let out='',skip=0;for(let c=0;c<n;c++){if(skip){skip--;continue} if(covered.has(ri+','+c)) continue;
      const k=span[ri+','+c]; if(k>1) skip=k-1; const rs=rspan[ri+','+c]; const at=(k>1?` colspan="${k}"`:'')+(rs>1?` rowspan="${rs}"`:'');
      // checker 23 Nov (2023 HSC Std Q17): "shade out the boxes that are same city to the same city": a cell holding \shade is a grey, empty box, as printed
      if(String(r[c]??'').trim()==='\\shade'){ out+=`<td class="shd"${at}></td>`; continue }
      // checker 23 Nov (2024 HSC Std Q12): "There is a bump in the top left corner": the split is a drawn line (it was a gradient, which stepped at its ends)
      const dg=diagSplit(r[c]); const v=dg?`<svg class="dgl" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="0" x2="100" y2="100"/></svg><span class="dgw"><span class="dgtr">${cell(dg[1])}</span><span class="dgbl">${cell(dg[0])}</span></span>`:cell(r[c]);
      if(dg){ out+=`<th scope="col" class="dg"${at}>${v}</th>`; continue }   // owner: "table needs to look identical with that split down the cell"
      if(head) out+=`<th scope="col"${at}>${v}</th>`;
      else if(c<lc) out+=`<th scope="row" class="rl"${at}>${v}</th>`; else out+=`<td${at}>${v}</td>`;}
    return `<tr>${out}</tr>`};
  const head=rows.slice(0,hr).map((r,i)=>tr(r,i,true)).join(''), body=rows.slice(hr).map((r,i)=>tr(r,i+hr,false)).join('');
  return `<div class="dtwrap"><table class="dt${opts.blank?' blankok':''}"${uniform?'':' data-percol="1"'} style="width:min(${width}em,100%);min-width:${(width*0.8).toFixed(1)}em;max-width:none">${t.cap?`<caption>${capHTML(t.cap)}</caption>`:''}${cols}${head?`<thead>${head}</thead>`:''}<tbody>${body}</tbody></table></div>`;
}
function optTableHTML(q,show){
  const ot=q.opt_table, n=ot.headers.length, key=q.options.find(o=>o.is_correct)?.label, ksrc=q.options.find(o=>o.is_correct)?.key_source;
  // owner: headers wrap only where the paper wraps (\\), so each column is as wide as its longest header line or cell
  const cw=ot.headers.map((h,i)=>Math.min(18,Math.max(7,0.55*Math.max(lineLen(h),...Object.values(ot.rows).map(r=>plain(r[i]||'').length))+2)));
  return `<div class="dtwrap"><table class="dt ot" style="width:${(3.2+(show?5.5:0)+cw.reduce((a,b)=>a+b,0)).toFixed(1)}em;max-width:100%">
   <colgroup><col style="width:3.2em">${cw.map(w=>`<col style="width:${w.toFixed(1)}em">`).join('')}${show?'<col style="width:5.5em">':''}</colgroup>
   <thead><tr><th class="lab"></th>${ot.headers.map(h=>`<th scope="col" class="oth">${h.split('\\\\').map(tex).join('<br>')}</th>`).join('')}${show?'<th class="ansc"></th>':''}</tr></thead>
   <tbody>${['A','B','C','D'].filter(l=>ot.rows[l]).map(l=>`<tr class="${l===key?'correct':''} ${show?'show':''}"><th class="lab" scope="row">${l}.</th>${ot.rows[l].map(c=>`<td>${tex(c)}</td>`).join('')}${show?`<td class="ansc">${l===key?`<span class="badge ${ksrc==='generated'?'b-gen':'b-ok'}">${ksrc==='generated'?'model key':'answer'}</span>`:''}</td>`:''}</tr>`).join('')}</tbody></table></div>`;
}

