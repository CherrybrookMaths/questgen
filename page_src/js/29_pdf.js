/* ===================== PDF export (owner 14 Nov) =====================
   Owner: "make it so we can export pdfs from here. Find a way". The artifact frame cannot open the print dialog, but it can
   hand the viewer a file (downloads capability). So the A4 sheets in the preview are drawn to images in the browser
   (html-to-image), placed one per page in a PDF (jsPDF), and saved through the downloads capability.
   Trade-off: the PDF pages are pictures at about 190 dpi: they print sharply, but the text can't be selected or searched.
   "Download HTML" stays for a text PDF via the browser's own print dialog. Libraries load only when the button is pressed. */
const PDF_LIBS=[VENDOR+'html-to-image-1.11.11/dist/html-to-image.js',VENDOR+'jspdf-2.5.1/dist/jspdf.umd.min.js'];   // self-hosted (tools/vendor.py)
let _pdfLibs=null;
const pdfLoad=()=>_pdfLibs||(_pdfLibs=Promise.all(PDF_LIBS.map(src=>new Promise((ok,no)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>no(new Error('Could not load '+src.split('/vendor/')[1]));document.head.appendChild(s)}))).catch(e=>{_pdfLibs=null;throw e}));
// the same clean copy the HTML download uses: no on-screen controls, dot-point lines or Report links
function pdfClone(){const live=$('#xPages');const c=live.cloneNode(true);
  c.querySelectorAll('.lnctl,.figctl,.figpct,.figh,.exaddli,.scr-only,.g2k,mjx-assistive-mml').forEach(e=>e.remove());   // 18 Nov: the hidden screen-reader copy of each formula is drawn by the picture maker and pushed table rows taller
  c.querySelectorAll('[contenteditable]').forEach(e=>{e.removeAttribute('contenteditable');e.removeAttribute('title');if(e.classList.contains('ed-empty'))e.textContent=''});
  c.querySelectorAll('.sel').forEach(e=>e.classList.remove('sel'));
  // owner 18 Nov ("The PDF shows side scroll bars, its a persistent issue across many tables ... its urgent"). The picture maker copies
  // each box's on-screen height, and a table's height includes its caption; drawn again, the rows got that whole height and the table
  // grew by the caption (QID 979: rows 64 -> 89 px), so it overflowed its box: scroll bars, a cut-off last row. In the copy a caption
  // becomes a centred line above its table, styled as on screen, and the table's height is its rows only.
  const lc=[...live.querySelectorAll('table.dt>caption')],cc=[...c.querySelectorAll('table.dt>caption')];
  if(lc.length===cc.length)cc.forEach((cap,i)=>{const cs=getComputedStyle(lc[i]),d=document.createElement('div'),t=cap.parentElement,w=t.parentElement;
    for(const k of ['font','color','textAlign','padding','lineHeight','letterSpacing'])d.style[k]=cs[k];d.innerHTML=cap.innerHTML;cap.remove();
    if(w&&w.classList.contains('dtwrap')){w.style.flexDirection='column';w.style.alignItems='center';d.style.width=t.style.width||'auto';d.style.maxWidth='100%';w.insertBefore(d,t)}else t.before(d)});
  c.removeAttribute('id');c.style.cssText='position:fixed;left:-20000px;top:0;zoom:1;transform:none;display:block;padding:0;width:auto';
  return c}
async function xPdf(doc){
  const btn=$('#xPdf'),info=$('#xInfo'),old=info?.textContent;const say=t=>{if(info)info.textContent=t};
  const dl=window.claude?.use?await window.claude.use('downloads'):null;if(!dl){toast('Downloading is not available in this view');return}
  if(btn)btn.disabled=true;let host=null;
  try{
    say('Loading the PDF maker…');await pdfLoad();
    const {jsPDF}=window.jspdf;const h2i=window.htmlToImage;
    host=pdfClone();document.body.appendChild(host);
    // MathJax draws every symbol by reference to one shared <defs> block; each page image needs its own copy of it
    const cache=document.getElementById('MJX-SVG-global-cache');
    const sheets=[...host.querySelectorAll('.sheet')];if(!sheets.length)throw new Error('No pages to export');
    const pdf=new jsPDF({unit:'mm',format:'a4',orientation:'portrait',compress:true});
    // owner 18 Nov: "The PDF shows side scroll bars, its a persistent issue across many tables. fix it please, its urgent". The picture
    // keeps each box's on-screen size but drew its text in a fallback font (skipFonts), which is wider: tight table cells wrapped,
    // overflowed their box and showed scroll bars. The page's own fonts (self-hosted) are now embedded once and used for every sheet.
    say('Loading the fonts…');let fontCss='';try{fontCss=await h2i.getFontEmbedCSS(host)}catch(e){}
    for(let i=0;i<sheets.length;i++){const sh=sheets[i];say(`Making the PDF: page ${i+1} of ${sheets.length}…`);
      sh.style.boxShadow='none';sh.style.margin='0';sh.style.height='297mm';sh.style.minHeight='0';sh.style.overflow='hidden';
      if(cache)sh.prepend(cache.cloneNode(true));
      const r=sh.getBoundingClientRect();
      const cv=await h2i.toCanvas(sh,{pixelRatio:2.1,backgroundColor:'#ffffff',...(fontCss?{fontEmbedCSS:fontCss}:{skipFonts:true}),width:Math.round(r.width),height:Math.round(r.height)});
      if(i)pdf.addPage('a4','portrait');
      pdf.addImage(cv.toDataURL('image/jpeg',0.9),'JPEG',0,0,210,297,undefined,'FAST');
      await new Promise(res=>setTimeout(res,0))}   // let the page breathe between sheets
    const title=(EX.sub||EX.title||'exam').replace(/[^\w\- ]+/g,'').trim()||'exam';
    pdf.setProperties({title:`${EX.sub||EX.title||'Exam'}${doc==='guide'?' – marking guide':''}`,creator:'Questgen'});
    const blob=pdf.output('blob');say('Saving…');
    await dl.save({filename:`${title}${doc==='guide'?' - marking guide':''}.pdf`,data:blob});
    toast(`PDF saved · ${sheets.length} page${sheets.length===1?'':'s'}`)}
  catch(e){if(e?.code==='declined'){}else toast(e?.code?`Could not save the PDF (${e.code})`:`Could not make the PDF: ${e.message||e}`)}
  finally{host?.remove();if(btn)btn.disabled=false;say(old||'')}}
// the button sits beside "Download HTML"; xPreview (24_exams.js) adds it once the pages are laid out
document.addEventListener('click',e=>{const b=e.target.closest('#xPdf');if(!b||b.disabled)return;e.preventDefault();xPdf($('#xDl')?.dataset.doc||EXV?.doc||'exam')});
