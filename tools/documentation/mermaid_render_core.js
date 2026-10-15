/* Sole browser drawing owner. Transport, HTML publication and process cleanup stay outside. */
(()=>{
'use strict';
const identity='gift-diagram';
function configuration(fontFamily){
 return {startOnLoad:false,securityLevel:'strict',suppressErrorRendering:true,deterministicIds:true,
  deterministicIDSeed:identity,handDrawnSeed:1,fontFamily,maxTextSize:100000,maxEdges:2000,theme:'default',
  flowchart:{htmlLabels:true},sequence:{useMaxWidth:false},
  secure:['secure','securityLevel','startOnLoad','maxTextSize','maxEdges','suppressErrorRendering',
   'themeCSS','fontFamily','handDrawnSeed','deterministicIds','deterministicIDSeed']};
}
function profile(fontFamily){
 return {configuration:configuration(fontFamily),viewport:{width:innerWidth,height:innerHeight,
  deviceScaleFactor:devicePixelRatio},locale:navigator.language};
}
async function render({source,fontFamily,ms}){
 if(typeof source!=='string'||source.length>100000||/^\s*(?:%%\{\s*(?:init|config)|click\b|---\s*$)/m.test(source))
  return {error:'Diagram source outside the safe reading profile',kind:'syntax'};
 let timer;
 try{
  mermaid.initialize(configuration(fontFamily));
  const result=await Promise.race([mermaid.render(identity,source),new Promise((_,reject)=>{
   timer=setTimeout(()=>reject(new Error('diagram timeout')),ms);
  })]);
  const document=new DOMParser().parseFromString(result.svg,'text/html');
  const svg=document.querySelector('svg');if(!svg)throw new Error('missing SVG');
  return {svg:new XMLSerializer().serializeToString(svg)};
 }catch(error){
  return {error:String(error.stack||error),kind:error.hash&&Array.isArray(error.hash.expected)?'syntax':'fatal'};
 }finally{clearTimeout(timer);}
}
globalThis.GiftMermaidCore=Object.freeze({profile,render});
})();
