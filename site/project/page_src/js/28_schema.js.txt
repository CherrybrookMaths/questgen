/* ===================== Guide: data model diagram (owner 14 Nov) =====================
   Owner: "Show a visual of our db schema and how everything connects". An SVG entity diagram on the Guide's developer page:
   the 11 SQLite tables (solid lines = foreign keys), plus the stores outside the database that link to it by id (dashed):
   the page database collections, the syllabus file and the published bank.json. Counts as of the last rebuild. */
const SCH={W:1220,H:830,w:250,rh:19,hh:30,
 t:[
  // id, title, x, y, rows [name, note, key], count, kind
  ['documents','documents',20,20,[['id','','pk'],['school · year · task_code',''],['task_type · course',''],['drive_file_id','source PDF'],['status · page_count','']],1632,'db'],
  ['runs','runs',20,250,[['id','','pk'],['document_id','','fk'],['stage · model',''],['tokens · est_cost_usd','']],78,'db'],
  ['data_tables','data_tables',20,430,[['id','e.g. T535_1','pk'],['owner_table · owner_id','any row'],['rows_json · spans_json','']],217,'db'],
  ['questions','questions',330,20,[['id','QID','pk'],['document_id','','fk'],['number · section',''],['question_type','mcq / written'],['stem_latex · marks_total',''],['home_topic','filed under'],['old_syllabus · standard_topic','']],1618,'db'],
  ['mcq_options','mcq_options',330,250,[['id','','pk'],['question_id','','fk'],['label · latex',''],['is_correct','']],1988,'db'],
  ['related','related_questions',330,410,[['question_id','','pk'],['related_id','','pk'],['relation · similarity','duplicate / reuse']],80,'db'],
  ['figures','figures',330,550,[['id','','pk'],['question_id','','fk'],['part_id','→ parts, if one part','fk'],['png_path · tikz_path','crop / redraw'],['redraw_status','']],960,'db'],
  ['parts','parts',640,20,[['id','','pk'],['question_id','','fk'],['parent_part_id','(i) under (a)','fk'],['label · src_label',''],['latex · marks','']],2626,'db'],
  ['solutions','solutions',640,210,[['id','','pk'],['part_id','','fk'],['question_id','→ questions','fk'],['source_document_id','→ documents','fk'],['source','school / Claude'],['latex · criteria_json','']],2581,'db'],
  ['diff','part_difficulty',640,420,[['part_id','','pk'],['band · wm','2–6 · UF/PR'],['nearest_anchor','HSC reference','fk'],['band_ai · owner_band','model vs you'],['source','owner / shifted / model']],2292,'db'],
  ['tags','tags',950,20,[['id','','pk'],['part_id','','fk'],['question_id','→ questions','fk'],['dot_point','Y12-279','fk'],['is_primary · coverage','main / gate'],['scheme','2024 / 2017']],12625,'db'],
  ['dots','dotpoints.json',950,240,[['id','Y11-001 … Y12-359','pk'],['focus area · subheading',''],['text · short','']],359,'file'],
  ['pagedb','Page database',950,380,[['reviews/q<id>','→ questions'],['difficulty/<part_id>','your checks'],['exams/<id>','→ questions (list)'],['reports/<id>','→ questions · parts'],['progress/*','jobs · queue · import']],null,'page'],
  ['mirror','page_* mirror tables',20,580,[['page_reviews','1,066 · → questions'],['page_difficulty','99 · → parts'],['page_exams · …_items','→ questions'],['page_reports','→ questions · parts'],['page_sync','when each was copied']],null,'db'],
  ['bank','bank.json',950,600,[['questions[]','built from all tables'],['parts[].dif','difficulty'],['docs · tables','']],1618,'file']],
 e:[ // from table, from row index, to table, to row index, style, label
  ['runs',1,'documents',0,'fk'],['questions',1,'documents',0,'fk'],['mcq','',0],
  ['mcq_options',1,'questions',0,'fk'],['related',0,'questions',0,'fk'],['related',1,'questions',0,'fk'],
  ['figures',1,'questions',0,'fk'],['parts',1,'questions',0,'fk'],['parts',2,'parts',0,'self'],
  ['solutions',1,'parts',0,'fk'],
  ['diff',0,'parts',0,'fk'],['diff',2,'diff',0,'self'],['tags',1,'parts',0,'fk'],['tags',3,'dots',0,'link'],
  ['data_tables',1,'questions',0,'poly'],['pagedb',1,'diff',0,'link'],['pagedb',0,'mirror',0,'sync']].filter(x=>x.length>=5)};
function schemaSVG(){const {w,rh,hh}=SCH,B={};
  SCH.t.forEach(([id,title,x,y,rows,n,kind])=>{B[id]={id,title,x,y,rows,n,kind,h:hh+rows.length*rh+8}});
  const ry=(b,i)=>b.y+hh+i*rh+rh/2+2;
  let edges='';
  SCH.e.forEach(([f,fi,t,ti,st])=>{const a=B[f],b=B[t];if(!a||!b)return;const y1=ry(a,fi),y2=b.y+hh/2;let d;
    if(st==='sync'){const xa=a.x,ya=a.y+a.h,yb=b.y+hh/2,yl=SCH.H-60;const ys=a.y+a.h-12;d=`M${xa} ${ys} L ${xa-14} ${ys} L ${xa-14} ${yl} L ${b.x+w+30} ${yl} L ${b.x+w+30} ${yb} L ${b.x+w} ${yb}`}
    else if(st==='self'||st==='self2'){const xr=a.x+w,y3=st==='self'?ry(b,0):y2;d=`M${xr} ${y1} C ${xr+34} ${y1}, ${xr+34} ${y3}, ${xr} ${y3}`;if(st==='self2'){const x0=a.x;d=`M${x0} ${y1} C ${x0-30} ${y1}, ${b.x-30} ${b.y+b.h-10}, ${b.x+20} ${b.y+b.h}`}}
    else if(b.x+w<a.x){const x1=a.x,x2=b.x+w;d=`M${x1} ${y1} C ${x1-(x1-x2)/2} ${y1}, ${x2+(x1-x2)/2} ${y2}, ${x2} ${y2}`}
    else if(b.x>a.x+w){const x1=a.x+w,x2=b.x;d=`M${x1} ${y1} C ${x1+(x2-x1)/2} ${y1}, ${x2-(x2-x1)/2} ${y2}, ${x2} ${y2}`}
    else{const x1=a.x,x2=b.x,xm=Math.min(x1,x2)-26;d=`M${x1} ${y1} C ${xm} ${y1}, ${xm} ${y2}, ${x2} ${y2}`}
    edges+=`<path class="se ${st}" d="${d}" marker-end="url(#sch-ar)"/>`});
  const boxes=Object.values(B).map(b=>`<g class="sb ${b.kind}"><rect x="${b.x}" y="${b.y}" width="${w}" height="${b.h}" rx="6"/><rect class="sbh" x="${b.x}" y="${b.y}" width="${w}" height="${hh}" rx="6"/><rect class="sbh" x="${b.x}" y="${b.y+hh-8}" width="${w}" height="8"/>
    <text class="st" x="${b.x+12}" y="${b.y+20}">${esc(b.title)}</text>${b.n!=null?`<text class="sn" x="${b.x+w-12}" y="${b.y+20}" text-anchor="end">${b.n.toLocaleString()}</text>`:''}
    ${b.rows.map(([nm,note,k],i)=>`<text class="sr ${k||''}" x="${b.x+12}" y="${ry(b,i)+4}">${k==='pk'?'◆ ':k==='fk'?'→ ':''}${esc(nm)}</text>${note?`<text class="snote" x="${b.x+w-12}" y="${ry(b,i)+4}" text-anchor="end">${esc(note)}</text>`:''}`).join('')}</g>`).join('');
  return `<svg class="schema" viewBox="0 0 ${SCH.W} ${SCH.H}" role="img" aria-label="Diagram of the Questgen data model: documents, questions, parts and the tables that hang off them, plus the page database, syllabus file and bank.json">
  <defs><marker id="sch-ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" class="sarw"/></marker></defs>
  <g class="szones"><text x="20" y="${SCH.H-46}" class="sz">questions.db (SQLite)</text><text x="${SCH.W/2}" y="${SCH.H-66}" class="sz" text-anchor="middle">copied by tools/sync_pagedb.py at each rebuild</text><text x="950" y="${SCH.H-46}" class="sz">Outside the database</text></g>
  <line x1="925" y1="10" x2="925" y2="${SCH.H-30}" class="sdiv"/>
  ${edges}${boxes}
  <g class="slegend" transform="translate(20 ${SCH.H-24})"><line x1="0" y1="0" x2="34" y2="0" class="se fk"/><text x="42" y="4">foreign key (many → one)</text>
   <line x1="230" y1="0" x2="264" y2="0" class="se link"/><text x="272" y="4">linked by id, outside SQLite</text>
   <line x1="480" y1="0" x2="514" y2="0" class="se poly"/><text x="522" y="4">points at any table (owner_table + owner_id)</text>
   <text x="820" y="4">◆ key   → refers to (main links only)</text></g></svg>`}
