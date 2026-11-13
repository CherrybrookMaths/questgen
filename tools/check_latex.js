// usage: node check_latex.js file.json  -> validates every latex field renders in KaTeX (text with $...$ math)
const katex=require('/home/claude/pilot/node_modules/katex');
const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[2]));
let bad=[];
function chk(where,s){ if(!s)return; s=s.replace(/\\\$/g,'\uE000'); const re=/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^$]+?)\$|\\\(([\s\S]+?)\\\)/g; let m;
 while((m=re.exec(s))){const tex=(m[1]||m[2]||m[3]||m[4]).replace(/\uE000/g,'\\$'); try{katex.renderToString(tex,{throwOnError:true,displayMode:!!(m[1]||m[2]),trust:false,macros:{"\\exfigure":"\\text{[fig #1]}"}})}catch(e){bad.push(where+': '+e.message.slice(0,120))}}}
function walk(o,p){ if(Array.isArray(o))o.forEach((x,i)=>walk(x,p+'['+i+']')); else if(o&&typeof o==='object')for(const k in o){ if(typeof o[k]==='string'&&/latex/.test(k))chk(p+'.'+k,o[k]); else walk(o[k],p+'.'+k)}}
walk(d,'');console.log(JSON.stringify({errors:bad.length,sample:bad.slice(0,15)}));
