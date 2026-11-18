// Z-score table at the back of an exam (owner 17 Nov: "Some questions say refer to the z score table at the back of the exam.
// For THOSE specifically, we arenot adding the z score table in ... We need a way to append a z score table at the back of
// exams which ahve those questions tho." and "Questions which have a pportion of the ztable in there arleady we will keep.").
// A question needs it when the bank marks it (q.zt, from state/work/ztable.json via build_bank.py) or Review sets reviews.zt;
// an explicit zt:false in Review overrides the bank. The values are computed here (P(Z <= z), 4 dp), not copied from a paper.
const needsZ=q=>{const v=reviews['q'+q.id]?.zt;return v===undefined?!!q?.zt:!!v};
const zPhi=z=>{const n=2000,h=z/n,f=t=>Math.exp(-t*t/2);let s=f(0)+f(z);   // Simpson's rule on the normal density: error < 1e-12
  for(let i=1;i<n;i++)s+=(i%2?4:2)*f(i*h);return 0.5+s*h/3/Math.sqrt(2*Math.PI)};
let zTabCache='';
function zTableHTML(){if(zTabCache)return zTabCache;
  const cols=[...Array(10).keys()],rows=[...Array(35).keys()];
  const head=`<tr><th><i>z</i></th>${cols.map(c=>`<th>0.0${c}</th>`).join('')}</tr>`;
  const body=rows.map(r=>`<tr><th>${(r/10).toFixed(1)}</th>${cols.map(c=>`<td>${zPhi(r/10+c/100).toFixed(4)}</td>`).join('')}</tr>`).join('');
  return zTabCache=`<div class="xztab"><div class="xsechd"><b>Standard normal distribution table</b></div>
    <p>The table gives <i>P</i>(<i>Z</i> ≤ <i>z</i>), the area under the standard normal curve to the left of <i>z</i>, for <i>Z</i> ~ <i>N</i>(0, 1).
    For negative <i>z</i>, use <i>P</i>(<i>Z</i> ≤ −<i>z</i>) = 1 − <i>P</i>(<i>Z</i> ≤ <i>z</i>).</p>
    <table class="xzt"><thead>${head}</thead><tbody>${body}</tbody></table></div>`}
