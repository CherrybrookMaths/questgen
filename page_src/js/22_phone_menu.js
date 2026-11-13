/* phone menu (owner 14 Nov: "it'll have to be some pop up or side bar right?") */
(()=>{const btn=$('#menuBtn'),sh=$('#mSheet');const NAMES={bank:'Bank',inbox:'Review',review:'Review',papers:'Papers',processes:'Processes',levels:'Difficulty',reports:'Reports',guide:'Guide',exams:'Exams'};   // Difficulty and Reports: Review steps since 15 Nov; owner 13 Nov: Papers, Reports and Difficulty are sections of Review (the menu lists Review · Processes)
  const sync=()=>{$('#menuCur').textContent=NAMES[view]||'Menu';$('#menuN').textContent=''   /* owner 14 Nov: "Exams 935" read as a count of exams; counts stay in the menu list */};
  const close=()=>{sh.hidden=true;btn.setAttribute('aria-expanded','false')};
  // owner 15 Nov: the menu is grouped by area, Teach then Curate; the Curate group is there only for the owner and editors
  const link=a=>{const n=a.querySelector('.n')?.textContent||'';return `<a href="${a.getAttribute('href')}" aria-current="${a.getAttribute('aria-current')==='page'?'page':'false'}">${esc(a.firstChild.textContent)}${n?`<span class="n">${esc(n)}</span>`:''}</a>`};
  const group=(k,l)=>{const as=[...document.querySelectorAll(`.views a[data-area="${k}"]`)];return `<div class="mgrp" data-marea="${k}"><div class="mh">${l}</div>${as.map(link).join('')}</div>`};
  const open=()=>{sh.innerHTML=group('teach','Teach')+(isEditor()?group('curate','Curate'):'')
      +`<hr><button type="button" data-mtheme>Theme <span class="mt">${esc(($('#themeBtn')?.textContent||'').replace(/^Theme:\s*/,''))}</span></button>`;
    sh.hidden=false;btn.setAttribute('aria-expanded','true')};
  btn.addEventListener('click',e=>{e.stopPropagation();sh.hidden?open():close()});
  sh.addEventListener('click',e=>{if(e.target.closest('[data-mtheme]')){$('#themeBtn').click();open();return}if(e.target.closest('a'))close()});
  document.addEventListener('click',e=>{if(!sh.hidden&&!e.target.closest('#mSheet,#menuBtn'))close()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!sh.hidden){close();btn.focus()}});
  addEventListener('hashchange',()=>setTimeout(sync,0));sync();
  try{new MutationObserver(sync).observe($('#todoN'),{childList:true,characterData:true,subtree:true})}catch(e){}
})();
