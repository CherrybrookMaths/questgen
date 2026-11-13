/* phone menu (owner 14 Nov: "it'll have to be some pop up or side bar right?") */
(()=>{const btn=$('#menuBtn'),sh=$('#mSheet');const NAMES={bank:'Bank',review:'Review',papers:'Papers',processes:'Processes',levels:'Difficulty',reports:'Reports',guide:'Guide',exams:'Exams'};
  const sync=()=>{$('#menuCur').textContent=NAMES[view]||'Menu';$('#menuN').textContent=''   /* owner 14 Nov: "Exams 935" read as a count of exams; counts stay in the menu list */};
  const close=()=>{sh.hidden=true;btn.setAttribute('aria-expanded','false')};
  const open=()=>{sh.innerHTML=[...document.querySelectorAll('.views a')].map(a=>{const n=a.querySelector('.n')?.textContent||'';return `<a href="${a.getAttribute('href')}" aria-current="${a.getAttribute('aria-current')==='page'?'page':'false'}">${esc(a.firstChild.textContent)}${n?`<span class="n">${esc(n)}</span>`:''}</a>`}).join('')
      +`<hr><button type="button" data-mtheme>Theme <span class="mt">${esc(($('#themeBtn')?.textContent||'').replace(/^Theme:\s*/,''))}</span></button>`;
    sh.hidden=false;btn.setAttribute('aria-expanded','true')};
  btn.addEventListener('click',e=>{e.stopPropagation();sh.hidden?open():close()});
  sh.addEventListener('click',e=>{if(e.target.closest('[data-mtheme]')){$('#themeBtn').click();open();return}if(e.target.closest('a'))close()});
  document.addEventListener('click',e=>{if(!sh.hidden&&!e.target.closest('#mSheet,#menuBtn'))close()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!sh.hidden){close();btn.focus()}});
  addEventListener('hashchange',()=>setTimeout(sync,0));sync();
  try{new MutationObserver(sync).observe($('#todoN'),{childList:true,characterData:true,subtree:true})}catch(e){}
})();
