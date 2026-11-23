/* ===================== Stale-page approvals (owner 23 Nov) =====================
   Owner 23 Nov: "I need the checker approving fixed tonight. That is priority number 1" -> "stale page approvals": that afternoon the
   checker approved 10 questions of the 2021 HSC on a page opened before their solutions were replaced, so the approvals landed on
   content they never saw. tools/build_page.py stamps every build with an id worked out from the page and the bank files it shows
   (QG_BUILD below) and writes the same id to data/version.json. The page compares the two at start, every minute, whenever the tab
   comes back into view and right before every approval; once a newer version is live, a bar asks for a reload and approvals
   (questions, diagrams, papers, paper calls, difficulty) are refused until then. Flags and notes still save. One page-wide name
   (CODE_HEALTH rule 1). */
const FRESH={build:'__QG_BUILD__',stale:false,t:null,at:0,
  async check(){if(this.stale||this.build.startsWith('__'))return this.stale;
    try{const r=await fetch('data/version.json?t='+Date.now(),{cache:'no-store'});if(!r.ok)return false;const v=await r.json();
      this.at=Date.now();if(v&&v.build&&v.build!==this.build){this.stale=true;this.bar()}}catch(e){}
    return this.stale},
  bar(){if(document.getElementById('freshBar'))return;const d=document.createElement('div');d.id='freshBar';d.className='freshbar';d.setAttribute('role','alert');
    d.innerHTML='<b>A newer version of Questgen is live.</b> <span>Reload to see the latest questions and solutions. Approving is paused on this page until you do.</span> <button type="button" class="act ok" data-fresh-reload>Reload now</button>';
    document.body.prepend(d)},
  // true (and a toast) when this page is out of date: the caller does not approve. It asks the server again when the last answer is
  // more than 15 s old, so an approval never rests on a stale check (a fast keyboard run costs one small request every 15 s)
  async block(){if(!this.stale&&Date.now()-this.at>15000)await this.check();if(!this.stale)return false;this.bar();toast('A newer version is live: reload before approving');return true},
  start(){this.check();clearInterval(this.t);this.t=setInterval(()=>this.check(),60000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)this.check()});window.addEventListener('focus',()=>this.check())}};
document.addEventListener('click',e=>{if(e.target.closest('[data-fresh-reload]'))location.reload()});
FRESH.start();
