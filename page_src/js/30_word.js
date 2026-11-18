/* ===================== Word export (owner 14 Nov) =====================
   Owner: "Word too pls" (after PDF export). Builds a real .docx in the browser from the laid-out paper:
   - text, bold/italic, parts with labels and right-aligned marks, answer lines, MCQ options, tables, diagrams (as pictures);
   - maths becomes native, editable Word equations: TeX (kept by MathJax as data-latex) -> MathML (MathJax.tex2mml)
     -> Office Math (mathml2omml). If one expression fails to convert it falls back to a picture of it.
   Libraries load only on demand: docx 9.0.2 (UMD) and mathml2omml 0.5.0 (ES module). Saved via the downloads capability. */
const WORD_LIBS={docx:VENDOR+'docx-9.0.2/build/index.umd.js',m2o:VENDOR+'mathml2omml-0.5.0/dist/index.js'};   // self-hosted (tools/vendor.py)
let _wordLibs=null;
const wordLoad=()=>_wordLibs||(_wordLibs=(async()=>{
  if(!window.docx)await new Promise((ok,no)=>{const s=document.createElement('script');s.src=WORD_LIBS.docx;s.onload=ok;s.onerror=()=>no(new Error('Could not load docx'));document.head.appendChild(s)});
  const m=await import(WORD_LIBS.m2o);return {D:window.docx,mml2omml:m.mml2omml}})().catch(e=>{_wordLibs=null;throw e}));
const W_SKIP='.scr-only,button,.sheetfoot,.lnctl,.figctl,.figpct,.figh,.exaddli,script,style,#MJX-SVG-global-cache,.xqh.cont';
function b64bytes(d){const s=atob(d);const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u}
async function wordPng(src,w,h,scale=2){const img=new Image();img.src=src;await img.decode();const c=document.createElement('canvas');c.width=Math.max(1,Math.round(w*scale));c.height=Math.max(1,Math.round(h*scale));
  const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(img,0,0,c.width,c.height);return b64bytes(c.toDataURL('image/png').split(',')[1])}
// mathml2omml leaves an integral's body empty and puts the integrand after it (Word then shows an empty box):
// move what follows the integral sign into its body, stopping at "=" or at another big operator.
// mathml2omml writes <, > and & inside <m:t> unescaped (e.g. "m < 1/a"), which is invalid XML
const escT=om=>om.replace(/(<m:t(?:\s[^>]*)?>)([\s\S]*?)(<\/m:t>)/g,(m,a,t,b)=>a+t.replace(/&(?![a-z]+;|#\d+;)/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+b);
function fixNary(om){const NS='http://schemas.openxmlformats.org/officeDocument/2006/math';let d;try{d=new DOMParser().parseFromString(om,'application/xml')}catch(e){return om}
  if(d.getElementsByTagName('parsererror').length)return om;
  for(const n of [...d.getElementsByTagNameNS(NS,'nary')]){const e=[...n.children].find(c=>c.localName==='e');if(!e||e.childNodes.length)continue;
    let x=n.nextSibling;while(x){const nx=x.nextSibling;if(x.nodeType===1&&(x.localName==='nary'||(x.localName==='r'&&/[=]/.test(x.textContent))))break;e.appendChild(x);x=nx}}
  return new XMLSerializer().serializeToString(d)}
async function xWord(doc){
  const btn=$('#xWord'),info=$('#xInfo'),old=info?.textContent;const say=t=>{if(info)info.textContent=t};
  const dl=window.claude?.use?await window.claude.use('downloads'):null;if(!dl){toast('Downloading is not available in this view');return}
  if(btn)btn.disabled=true;let host=null,fails=0,maths=0;
  try{say('Loading the Word maker…');const {D,mml2omml}=await wordLoad();
    const {Paragraph,TextRun,ImageRun,Table,TableRow,TableCell,WidthType,AlignmentType,BorderStyle,TabStopType,ImportedXmlComponent,ShadingType,PageNumber,Footer,HeightRule}=D;
    host=pdfClone();document.body.appendChild(host);if(typeof exRejoin==='function')exRejoin(host);
    const cache=document.getElementById('MJX-SVG-global-cache');
    const RIGHT=9638;   // right tab stop (twips) for marks: A4 width minus 2 cm margins
    const FONT='Times New Roman',UI=FONT;   // owner 18 Nov: one font (the questions') for every part of the exam
    // ---- maths ----
    const mathRun=async(mc)=>{maths++;const svg=mc.querySelector('svg');const tex=svg?.querySelector('g[data-mml-node="math"]')?.getAttribute('data-latex')||svg?.querySelector('[data-latex]')?.getAttribute('data-latex');const disp=mc.getAttribute('display')==='true';
      if(tex){try{const t2=tex.replace(/\\mathop\{\\Large\\intop\}\\nolimits/g,'\\int');const mml=await MathJax.tex2mmlPromise(t2,{display:disp});const om=fixNary(escT(mml2omml(mml)));const x=ImportedXmlComponent.fromXmlString(om);const el=x.root?.[0]||x;return el}catch(e){console.warn('Word maths fallback:',tex,e?.message)}}
      fails++;   // fallback: a picture of the expression
      try{const r=mc.getBoundingClientRect();const cl=svg.cloneNode(true);if(cache)cl.insertBefore(cache.querySelector('defs')?.cloneNode(true)||document.createElement('defs'),cl.firstChild);
        cl.setAttribute('width',r.width);cl.setAttribute('height',r.height);const src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(cl));
        return new ImageRun({type:'png',data:await wordPng(src,r.width,r.height,3),transformation:{width:r.width,height:r.height}})}catch(e){return new TextRun({text:tex||'[maths]'})}};
    // ---- inline content of an element -> runs ----
    const isBlock=el=>{if(el.nodeType!==1)return false;if(el.matches('mjx-container'))return el.getAttribute('display')==='true';const d=getComputedStyle(el).display;return !/^inline/.test(d)&&d!=='contents'&&d!=='none'};
    async function runs(node,fmt,out){
      if(node.nodeType===3){const t=node.textContent.replace(/\s+/g,' ');if(t)out.push(new TextRun({text:t,bold:fmt.b,italics:fmt.i,font:fmt.font,size:fmt.size,color:fmt.color,superScript:fmt.sup,subScript:fmt.sub}));return}
      if(node.nodeType!==1||node.matches(W_SKIP))return;
      if(node.matches('mjx-container')){out.push(await mathRun(node));return}
      if(node.tagName==='IMG'){const r=node.getBoundingClientRect();if(r.width<2)return;try{out.push(new ImageRun({type:'png',data:await wordPng(node.src,r.width,r.height),transformation:{width:Math.round(r.width),height:Math.round(r.height)}}))}catch(e){}return}
      if(node.tagName==='BR'){out.push(new TextRun({text:'',break:1}));return}
      if(node.classList.contains('pbr')){out.push(new TextRun({text:'',break:2}));return}
      const f={...fmt};if(/^(B|STRONG)$/.test(node.tagName)||+getComputedStyle(node).fontWeight>=600)f.b=true;if(/^(I|EM)$/.test(node.tagName)||getComputedStyle(node).fontStyle==='italic')f.i=true;
      if(node.tagName==='SUP')f.sup=true;if(node.tagName==='SUB')f.sub=true;
      for(const c of node.childNodes)await runs(c,f,out)}
    const P=(children,o={})=>new Paragraph({children,spacing:{after:o.after??80,before:o.before??0,line:o.line},...o});
    const NB={style:BorderStyle.NONE,size:0,color:'FFFFFF'},LB={style:BorderStyle.SINGLE,size:4,color:'9AA0A6'};
    // answer lines as a borderless table with a rule under each row (consecutive bordered paragraphs merge into one box)
    const lines=(n,ind)=>new Table({rows:Array.from({length:n},()=>new TableRow({height:{value:510,rule:HeightRule.EXACT},children:[new TableCell({children:[new Paragraph('')],borders:{top:NB,left:NB,right:NB,bottom:LB}})]})),width:{size:100,type:WidthType.PERCENTAGE},indent:ind?{size:ind,type:WidthType.DXA}:undefined,borders:{top:NB,bottom:NB,left:NB,right:NB,insideHorizontal:LB,insideVertical:NB}});
    // ---- blocks ----
    async function blocks(el,ctx,out){
      if(el.nodeType!==1||el.matches(W_SKIP))return;
      const fmt={font:ctx.font||FONT,size:ctx.size};
      if(el.matches('.xlines,.exln')){const n=el.querySelectorAll('i').length;if(n){out.push(P([],{after:0}));out.push(lines(n,ctx.indent||0))}out.push(P([],{after:120}));return}
      if(el.matches('table')){out.push(await table(el,ctx));out.push(P([],{after:60}));return}
      if(el.matches('.xsechd')){const t=el.firstChild?.textContent?.trim()||'';const sec2=/Section II/.test(el.textContent);const rs=[new TextRun({text:t,bold:true,font:UI,size:24})];
        const sp=el.querySelector('span');if(sp)rs.push(new TextRun({text:'\t'+sp.textContent.trim(),font:UI,size:18,color:'555555'}));
        out.push(new Paragraph({children:rs,tabStops:[{type:TabStopType.RIGHT,position:RIGHT}],pageBreakBefore:sec2&&doc==='exam',keepNext:true,spacing:{before:200,after:160},border:{top:{style:BorderStyle.SINGLE,size:8,color:'111111',space:4},bottom:{style:BorderStyle.SINGLE,size:8,color:'111111',space:4}}}));return}
      if(el.matches('.xqh')){const b=el.querySelector('b')?.textContent||'',s=el.querySelector('span')?.textContent||'';
        out.push(new Paragraph({children:[new TextRun({text:b,bold:true,font:UI,size:22}),new TextRun({text:'\t'+s,font:UI,size:20})],tabStops:[{type:TabStopType.RIGHT,position:RIGHT}],keepNext:true,spacing:{before:240,after:120},border:{bottom:{style:BorderStyle.SINGLE,size:6,color:'111111',space:2}}}));return}
      if(el.matches('.xqn')){out.push(new Paragraph({children:[new TextRun({text:el.textContent.trim(),bold:true,font:UI,size:22})],keepNext:true,spacing:{before:240,after:60}}));return}
      if(el.matches('.xsrc')){const t=el.querySelector('.exsrcl')?.textContent||el.textContent;out.push(new Paragraph({children:[new TextRun({text:t.trim(),font:UI,size:14,color:'8A8F96'})],alignment:AlignmentType.RIGHT,spacing:{before:40,after:200}}));return}
      if(el.matches('.xpart')){const lab=el.querySelector(':scope>.xpl')?.textContent||'',mk=el.querySelector(':scope>.xpm')?.textContent||'',pb=el.querySelector(':scope>.xpb');const ind=(ctx.indent||0)+567;
        const sub=[];if(pb)for(const c of pb.children)await blocks(c,{...ctx,indent:ind},sub);
        // label and marks go on the first text paragraph of the part
        const first=sub.findIndex(x=>x._runs);
        const head=[];if(lab)head.push(new TextRun({text:lab+'\t',font:FONT}));
        if(first>=0&&sub[first]._runs){sub[first]=new Paragraph({children:[...head,...sub[first]._runs,...(mk?[new TextRun({text:'\t'+mk,bold:true,font:UI,size:20})]:[])],indent:{left:ind,hanging:lab?567:0},tabStops:[{type:TabStopType.LEFT,position:ind},{type:TabStopType.RIGHT,position:RIGHT}],spacing:{after:80}})}
        else if(lab||mk)sub.unshift(new Paragraph({children:[...head,...(mk?[new TextRun({text:'\t'+mk,bold:true,font:UI,size:20})]:[])],indent:{left:ind,hanging:567},tabStops:[{type:TabStopType.LEFT,position:ind},{type:TabStopType.RIGHT,position:RIGHT}]}));
        out.push(...sub);return}
      if(el.matches('.xo')){const lb=el.querySelector(':scope>b'),lab=lb?.textContent||'';const rs=[new TextRun({text:lab+'\t',bold:true,font:UI,size:20})];for(const c of el.childNodes){if(c===lb)continue;await runs(c,fmt,rs)}
        const ok=el.classList.contains('xok')&&doc==='guide';out.push(new Paragraph({children:rs,indent:{left:(ctx.indent||0)+567,hanging:567},tabStops:[{type:TabStopType.LEFT,position:(ctx.indent||0)+567}],spacing:{after:80},...(ok?{shading:{type:ShadingType.CLEAR,fill:'E3F1E5',color:'auto'},border:{left:{style:BorderStyle.SINGLE,size:6,color:'2F7A43',space:6}}}:{})}));return}
      if(el.matches('.xsol,.sol')&&!ctx.inSol){const sub=[];for(const c of el.children)await blocks(c,{...ctx,inSol:true,indent:(ctx.indent||0)+284},sub);
        out.push(...sub.map(x=>x));return}
      if(el.matches('ul,ol')){let k=0;for(const li of el.children){if(li.matches(W_SKIP))continue;k++;const rs=[new TextRun({text:(el.tagName==='OL'?k+'.':'•')+'\t',font:fmt.font})];for(const c of li.childNodes)await runs(c,fmt,rs);
        out.push(new Paragraph({children:rs,indent:{left:(ctx.indent||0)+567,hanging:340},tabStops:[{type:TabStopType.LEFT,position:(ctx.indent||0)+567}],spacing:{after:40}}))}return}
      if(el.matches('mjx-container')){out.push(new Paragraph({children:[await mathRun(el)],alignment:AlignmentType.CENTER,spacing:{before:80,after:80}}));return}
      if(el.tagName==='IMG'){const rs=[];await runs(el,fmt,rs);out.push(new Paragraph({children:rs,alignment:AlignmentType.CENTER,spacing:{before:80,after:80}}));return}
      // generic: group inline children into paragraphs, recurse into block children
      let buf=[];const flush=()=>{if(buf.some(r=>!(r instanceof TextRun)||true)&&buf.length){const p=new Paragraph({children:buf,indent:ctx.indent?{left:ctx.indent}:undefined,spacing:{after:80},...(ctx.inSol?{border:{left:{style:BorderStyle.SINGLE,size:4,color:'B8BEC6',space:8}}}:{})});p._runs=buf;out.push(p)}buf=[]};
      for(const c of el.childNodes){if(c.nodeType===1&&c.matches(W_SKIP))continue;
        if(c.nodeType===1&&isBlock(c)){flush();await blocks(c,ctx,out)}else await runs(c,fmt,buf)}
      flush()}
    async function table(t,ctx){const rows=[];for(const tr of t.querySelectorAll(':scope>tr,:scope>thead>tr,:scope>tbody>tr,:scope>tfoot>tr')){const cells=[];
        for(const td of tr.children){const ps=[];await blocks(td,{...ctx,indent:0,inSol:false},ps);const bold=td.tagName==='TH';
          cells.push(new TableCell({children:ps.length?ps:[new Paragraph('')],columnSpan:td.colSpan>1?td.colSpan:undefined,rowSpan:td.rowSpan>1?td.rowSpan:undefined,margins:{top:40,bottom:40,left:80,right:80},...(bold?{shading:{type:ShadingType.CLEAR,fill:'F2F2F2',color:'auto'}}:{})}))}
        if(cells.length)rows.push(new TableRow({children:cells}))}
      return new Table({rows,width:{size:100,type:WidthType.PERCENTAGE}})}
    // ---- cover ----
    async function cover(cv,out){const tx=s=>cv.querySelector(s)?.textContent.trim()||'';
      // owner 18 Nov: the logo (or the school's name) at the top left, Name: and Tutor: lines at the top right
      const lg=cv.querySelector('.cv-logo'),lr=lg&&lg.getBoundingClientRect();let head;
      try{head=lg&&lr.width>2?new ImageRun({type:'png',data:await wordPng(lg.src,lr.width,lr.height,3),transformation:{width:Math.round(lr.width),height:Math.round(lr.height)}}):null}catch(e){head=null}
      out.push(new Paragraph({children:[head||new TextRun({text:(tx('.xschool')||'').toUpperCase(),font:UI,size:20,bold:true,characterSpacing:40})],spacing:{after:120}}));   // owner 18 Nov: no top rule
      for(const w of cv.querySelectorAll('.cv-who em'))out.push(new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({text:w.textContent+' ',font:UI,size:20}),new TextRun({text:'_'.repeat(30),font:UI,size:20})],spacing:{after:160}}));
      out.push(new Paragraph({children:[],spacing:{after:200}}));
      if(tx('.cv-cert'))out.push(new Paragraph({children:[new TextRun({text:tx('.cv-cert').toUpperCase(),font:UI,size:18,characterSpacing:30})],spacing:{after:60}}));
      out.push(new Paragraph({children:[new TextRun({text:tx('.cv-course'),font:FONT,size:44,bold:true})],spacing:{after:80}}));
      if(tx('.cv-title'))out.push(new Paragraph({children:[new TextRun({text:tx('.cv-title'),font:FONT,size:28,color:'444444'})],spacing:{after:360}}));
      const g=cv.querySelector('.cv-grid');if(g){let lab='';for(const c of g.children){if(c.matches('.cv-k')){const sm=c.querySelector('small');lab=sm?[...c.childNodes].filter(n=>n!==sm).map(n=>n.textContent).join('').trim()+' – '+sm.textContent.trim():c.textContent.trim();out.push(new Paragraph({children:[new TextRun({text:lab,font:UI,size:20,bold:true})],spacing:{before:160,after:60},keepNext:true}))}else await blocks(c,{font:FONT},out)}}
      const tt=cv.querySelector('.extopictbl');if(tt){   // owner 18 Nov: marks by topic is always on the cover
      out.push(new Paragraph({children:[],spacing:{before:480}}));const t=tt.querySelector('table');if(t)out.push(await table(t,{font:UI,size:18}))}}   // owner 18 Nov: no "Marks by topic" heading
    // ---- walk the sheets ----
    const body=[];const sheets=[...host.querySelectorAll('.sheet')];let k=0;
    for(const sh of sheets){k++;say(`Making the Word file: page ${k} of ${sheets.length}…`);
      for(const blk of sh.querySelectorAll(':scope>.sheetbody>*')){const cv=blk.querySelector('.xcover');
        // owner 18 Nov: the blank back of the cover and each reference-sheet page are pages of their own in Word too
        if(blk.querySelector('.xblank')){body.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{before:5600},children:[new TextRun({text:blk.textContent.trim(),font:FONT,italics:true})]}),new Paragraph({children:[],pageBreakBefore:true}));continue}
        if(blk.querySelector('.xref'))body.push(new Paragraph({children:[],pageBreakBefore:true}));
        if(cv){await cover(cv,body);body.push(new Paragraph({children:[],pageBreakBefore:true}));continue}
        await blocks(blk,{font:FONT},body)}
      await new Promise(r=>setTimeout(r,0))}
    const title=`${EX.sub||EX.title||'Exam'}${doc==='guide'?' – marking guide':''}`;
    const wd=new D.Document({creator:'Questgen',title,styles:{default:{document:{run:{font:FONT,size:23}}}},
      // owner 18 Nov: no footer on the cover (a blank first-page footer), and "Page 1 of 28"
      sections:[{properties:{titlePage:doc==='exam',page:{size:{width:11906,height:16838},margin:{top:1134,bottom:1134,left:1134,right:1134}}},
        footers:{first:new Footer({children:[new Paragraph({children:[]})]}),default:new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:`${EX.title||''} · ${EX.sub||''}${doc==='guide'?' · marking guide':''}    `,font:UI,size:16,color:'777777'}),new TextRun({children:['Page ',PageNumber.CURRENT,' of ',PageNumber.TOTAL_PAGES],font:UI,size:16,color:'777777'})]})]})},
        children:body}]});
    say('Packing…');const blob=await D.Packer.toBlob(wd);
    const name=(EX.sub||EX.title||'exam').replace(/[^\w\- ]+/g,'').trim()||'exam';
    await dl.save({filename:`${name}${doc==='guide'?' - marking guide':''}.docx`,data:blob});
    toast(fails?`Word file saved · ${fails} of ${maths} equations kept as pictures`:'Word file saved, with editable equations')}
  catch(e){if(e?.code!=='declined')toast(e?.code?`Could not save the Word file (${e.code})`:`Could not make the Word file: ${e.message||e}`);console.error(e)}
  finally{host?.remove();if(btn)btn.disabled=false;say(old||'')}}
// the button sits after "Download PDF"; xPreview (24_exams.js) adds it once the pages are laid out
document.addEventListener('click',e=>{const b=e.target.closest('#xWord');if(!b||b.disabled)return;e.preventDefault();xWord($('#xDl')?.dataset.doc||EXV?.doc||'exam')});
