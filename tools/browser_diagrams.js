/* Optional local-browser rendering. No engine download, product execution or network. */
(()=>{
'use strict';
const host=document.getElementById('sec-diagram-tools');if(!host)return;
const jobs=JSON.parse(document.getElementById('sec-diagram-jobs').textContent);
const status=document.getElementById('sec-diagram-status');
const picker=document.getElementById('sec-engine-file');
const button=document.getElementById('sec-render-start');
const save=document.getElementById('sec-save-diagram-cache');
const engineData=document.getElementById('sec-engine-data');
const nonce=host.dataset.nonce;
const decoder=new TextDecoder('utf-8',{fatal:true});
const encoder=new TextEncoder();let frame=null,running=false,engineBytes=null,renderer=null;
const results=new Map();
const limit=10_000_000;
function from64(s){const v=atob(s);return Uint8Array.from(v,x=>x.charCodeAt(0));}
function to64(bytes){let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);}
function sha256Portable(bytes){
 const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
 const H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
 const data=new Uint8Array(Math.ceil((bytes.length+9)/64)*64);data.set(bytes);data[bytes.length]=128;
 const v=new DataView(data.buffer);v.setUint32(data.length-8,Math.floor(bytes.length/0x20000000));v.setUint32(data.length-4,(bytes.length*8)>>>0);
 const w=new Uint32Array(64),ro=(x,n)=>(x>>>n)|(x<<(32-n));
 for(let off=0;off<data.length;off+=64){
  for(let i=0;i<16;i++)w[i]=v.getUint32(off+i*4);
  for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(ro(x,7)^ro(x,18)^(x>>>3))+w[i-7]+(ro(y,17)^ro(y,19)^(y>>>10)))>>>0;}
  let [a,b,c,d,e,f,g,h]=H;
  for(let i=0;i<64;i++){const s=(ro(e,6)^ro(e,11)^ro(e,25)),ch=(e&f)^(~e&g),t1=(h+s+ch+K[i]+w[i])>>>0,t2=((ro(a,2)^ro(a,13)^ro(a,22))+((a&b)^(a&c)^(b&c)))>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
  for(const [i,x]of [a,b,c,d,e,f,g,h].entries())H[i]=(H[i]+x)>>>0;
 }
 return H.map(x=>x.toString(16).padStart(8,'0')).join('');
}
async function digest(bytes){
 if(globalThis.crypto&&crypto.subtle){const d=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));return [...d].map(x=>x.toString(16).padStart(2,'0')).join('');}
 return sha256Portable(bytes);
}
function progress(message){const n=results.size;status.textContent=`本地渲染 ${n}/${jobs.length}：${message}`;status.dataset.complete=n===jobs.length?'true':'false';save.disabled=n!==jobs.length;}
function validateSvg(text){
 if(typeof text!=='string'||encoder.encode(text).length>limit)throw Error('SVG超出预算或返回类型错误');
 const doc=new DOMParser().parseFromString(text,'image/svg+xml');
 if(doc.querySelector('parsererror')||doc.documentElement.localName!=='svg')throw Error('SVG不是有效XML');
 const banned=new Set(['script','iframe','object','embed','image','a','use','animate','set']);
 for(const e of doc.querySelectorAll('*')){
  if(banned.has(e.localName.toLowerCase()))throw Error('拒绝活动SVG元素');
  for(const a of [...e.attributes]){
   const k=a.localName.toLowerCase(),v=a.value;
   if(k.startsWith('on')||(['href','src'].includes(k)&&!v.startsWith('#')))throw Error('拒绝活动或外部SVG属性');
   if(k==='style'&&(/url\(\s*["']?(?!#)/i.test(v)||/@import/i.test(v)))throw Error('拒绝外部SVG样式');
  }
  if(e.localName==='style'&&(/@import/i.test(e.textContent)||/url\(\s*["']?(?:https?:|data:|\/\/)/i.test(e.textContent)))throw Error('拒绝外部SVG样式表');
 }
 return new XMLSerializer().serializeToString(doc.documentElement);
}
function install(job,svg){
 const text=validateSvg(svg),bytes=encoder.encode(text);
 const fig=document.getElementById(job.id),box=fig.querySelector('.image-scroll');
 const img=document.createElement('img');img.alt=job.path+'：'+job.line;img.loading='lazy';img.src='data:image/svg+xml;base64,'+to64(bytes);
 box.replaceChildren(img);fig.dataset.rendered='true';results.set(job.id,{job,bytes});return bytes;
}
// Cached figures remain labelled as cached and are not mistaken for newly rendered results.
progress('引擎未运行。选择可信的本地独立Mermaid脚本后，才渲染本页全部图；原图源始终可读。');
const boot=function(){
 let m=null,ready=false;
 window.addEventListener('message',async ev=>{
  if(ev.source!==parent)return;
  const q=ev.data;
  if(!q||q.channel!=='sec-graph-frame/1')return;
  try{
   if(q.kind==='engine'&&!ready){
    const s=document.createElement('script');s.nonce=q.nonce;s.textContent=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(q.data),x=>x.charCodeAt(0)));document.head.appendChild(s);
    m=window.mermaid;if(!m||typeof m.render!=='function'||typeof m.initialize!=='function')throw Error('需要暴露window.mermaid的离线独立JS，不是ESM入口');
    ready=true;parent.postMessage({channel:q.channel,kind:'ready'},'*');
   }else if(q.kind==='render'&&ready){
    const config={startOnLoad:false,securityLevel:'strict',suppressErrorRendering:true,deterministicIds:true,deterministicIDSeed:q.id,handDrawnSeed:q.seed,fontFamily:'Arial, Microsoft YaHei, Noto Sans CJK SC, sans-serif',maxTextSize:100000,maxEdges:2000,theme:'default',flowchart:{htmlLabels:true},sequence:{useMaxWidth:false},secure:['secure','securityLevel','startOnLoad','maxTextSize','maxEdges','themeCSS','fontFamily','handDrawnSeed','deterministicIds','deterministicIDSeed']};
    m.initialize(config);const r=await m.render(q.id,q.source);
    const d=new DOMParser().parseFromString(r.svg,'text/html'),svg=d.querySelector('svg');if(!svg)throw Error('没有SVG');
    parent.postMessage({channel:q.channel,kind:'svg',id:q.id,svg:new XMLSerializer().serializeToString(svg)},'*');
   }
  }catch(e){parent.postMessage({channel:q.channel,kind:'error',id:q.id||null,error:String(e).slice(0,1800)},'*');}
 });
 parent.postMessage({channel:'sec-graph-frame/1',kind:'booted'},'*');
};
function waitMessage(expected,id,timeout=45000){return new Promise((resolve,reject)=>{
 const handle=setTimeout(()=>{cleanup();reject(Error('浏览器渲染等待超时；保留原图源。同步引擎卡死时可关闭此页，强进程终止需要静态出版模式。'));},timeout);
 function cleanup(){clearTimeout(handle);window.removeEventListener('message',receive);}
 function receive(ev){
  if(!frame||ev.source!==frame.contentWindow)return;
  const x=ev.data;if(!x||x.channel!=='sec-graph-frame/1')return;
  if(x.kind==='error'){cleanup();reject(Error(x.error));return;}
  if(x.kind===expected&&(id===undefined||x.id===id)){cleanup();resolve(x);}
 }
 window.addEventListener('message',receive);
});}
async function loadEngine(){
 if(engineData.textContent){const b=from64(engineData.textContent.trim());if(b.length>30_000_000)throw Error('引擎超出预算');return b;}
 const f=picker.files&&picker.files[0];if(!f)throw Error('请选择可信的mermaid独立JS文件');if(f.size>30_000_000)throw Error('引擎超出预算');return new Uint8Array(await f.arrayBuffer());
}
button.addEventListener('click',async()=>{
 if(running)return;running=true;button.disabled=true;save.disabled=true;
 try{
  engineBytes=await loadEngine();decoder.decode(engineBytes);const engineHash=await digest(engineBytes);
  renderer={state:'rendered-in-reader-browser',engine_sha256:engineHash,font_family:'Arial, Microsoft YaHei, Noto Sans CJK SC, sans-serif',browser:navigator.userAgent,profile:'sec-reader-strict/1',network:'CSP blocked',browser_sandbox:'allow-scripts without allow-same-origin'};
  frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('title','隔离的本地图渲染器');frame.style.cssText='position:fixed;left:-5000px;top:0;width:1800px;height:1200px;border:0;';
  const csp=`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'`;
  const bootText='('+boot.toString()+')();';
  frame.srcdoc='<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+csp.replaceAll('"','&quot;')+'"></head><body><script nonce="'+nonce+'">'+bootText.replace(/<\/script/gi,'<\\/script')+'<'+ '/script></body></html>';
  const started=waitMessage('booted',undefined,15000);document.body.appendChild(frame);await started;
  const ready=waitMessage('ready',undefined,20000);frame.contentWindow.postMessage({channel:'sec-graph-frame/1',kind:'engine',data:to64(engineBytes),nonce},'*');await ready;
  results.clear();
  for(const job of jobs){
   if(job.source.length>100000||/^\s*(?:%%\{\s*(?:init|config)|click\b|---\s*$)/m.test(job.source))throw Error('图源超出安全画像：'+job.path);
   const pending=waitMessage('svg',job.id);const seed=(parseInt((await digest(encoder.encode(job.id))).slice(0,8),16)&0x7fffffff)||1;
   frame.contentWindow.postMessage({channel:'sec-graph-frame/1',kind:'render',id:job.id,source:job.source,seed},'*');
   const r=await pending;install(job,r.svg);progress(job.path+' 第'+job.line+'行');
  }
  progress('全部成功；可以保存当前图缓存，下次普通构建无需图引擎。');
 }catch(e){progress('未完成：'+e.message);status.dataset.complete='false';save.disabled=true;}
 finally{if(frame){frame.remove();frame=null;}running=false;button.disabled=false;}
});
save.addEventListener('click',async()=>{
 if(results.size!==jobs.length||!renderer)return;
 const entries={};
 for(const {job,bytes} of results.values()){
  entries[job.sha256]={source_sha256:job.sha256,svg_sha256:await digest(bytes),svg_bytes:bytes.length,encoding:'base64',data:to64(bytes),renderer_id:job.id};
 }
 const v={schema:'sec.diagram-cache/1',purpose:'Rebuildable current-source rendering cache; not product authority',renderer,entries};
 const blob=new Blob([JSON.stringify(v)+'\n'],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='figures.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
});
})();
