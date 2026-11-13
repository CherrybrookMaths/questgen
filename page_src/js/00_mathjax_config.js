// Hardening (owner 14 Nov, action 3): no public CDNs. MathJax, its font data, the export libraries and the web fonts are
// self-hosted in site/vendor/ and published next to this page (exact list: tools/vendor_manifest.json, made by tools/vendor.py).
const VENDOR=new URL('vendor/',document.baseURI).href;
window.MathJax={
  loader:{paths:{mathjax:VENDOR+'mathjax-4.1.3',fonts:VENDOR.replace(/\/$/,''),
    'mathjax-termes':VENDOR+'mathjax-termes-font-4.1.3'}},   // every runtime load stays on these pinned local copies
  tex:{inlineMath:[['$','$']],displayMath:[['$$','$$']],processEscapes:true},
  output:{font:'mathjax-termes'},   // TeX Gyre Termes = Times, matching the papers
  svg:{fontCache:'global'},
  // no speech worker / SRE JSON fetches (worker + connect loads may be blocked by the page CSP); keep hidden MathML for screen readers as in v3
  options:{menuOptions:{settings:{enrich:false,speech:false,braille:false,assistiveMml:true}}},
  startup:{typeset:false,ready(){MathJax.startup.defaultReady();
    // owner 13 Nov (QID 1205 flag): "integrals which contain dfracs or are tall should use \displaystyle \int". The Termes font's display
    // integral is barely taller than its inline one, so a tall integral (display maths, or next to \dfrac / \left / an array) gets an
    // enlarged sign that spans the fraction; inline maths of that kind is also set in display style. Plain inline integrals are untouched.
    MathJax.startup.input[0].preFilters.add(({math})=>{let s=math.math;if(!/\\int(?![a-zA-Z])/.test(s))return;
      if(!(math.display||/\\displaystyle|\\dfrac|\\left|\\begin\{/.test(s)))return;
      s=s.replace(/\\int(?![a-zA-Z])/g,'\\mathop{\\Large\\intop}\\nolimits');
      if(!math.display&&!/\\displaystyle/.test(s))s='\\displaystyle '+s;math.math=s})}}};
