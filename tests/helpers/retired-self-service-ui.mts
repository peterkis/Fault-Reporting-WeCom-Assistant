import {readFile} from 'node:fs/promises';
import type {ServerResponse,RequestListener} from 'node:http';
import {createYxxSelfServiceNativeHttp,type YxxNativeHttpOptions} from '../../app/server/src/yxx-self-service-native-http.mjs';

/** Frozen V1 client for historical API/lifecycle regression only. Production
 * handlers never import this fixture and its URLs are not production assets. */
export function createRetiredSelfServiceFixture():NonNullable<YxxNativeHttpOptions['h5Static']> {
 const read=(name:string)=>readFile(new URL('../fixtures/retired-self-service/'+name,import.meta.url));
 const gated=new WeakSet<ServerResponse>();
 return Object.freeze({enabled:true,
  async page(response:ServerResponse){
   // The old root used the V1 native authorization gate before presenting HTML.
   // Decline the modern public-shell attempt; only its post-gate call renders.
   if(response.req.url?.split('?')[0]==='/wecom/yixiaoxiu/'&&!gated.has(response)){gated.add(response);return false;}
   const bytes=await read('self-service.html');response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end(bytes);return true;
  },
  async asset(url:URL,response:ServerResponse){const selected=url.pathname==='/wecom/yixiaoxiu/self-service.js'?['self-service.js','text/javascript']:url.pathname==='/wecom/yixiaoxiu/self-service.css'?['self-service.css','text/css']:null;if(!selected||url.search)return false;const bytes=await read(selected[0]??'');response.writeHead(200,{'content-type':selected[1]+'; charset=utf-8','cache-control':'no-store'});response.end(bytes);return true;},
 });
}
export function createYxxSelfServiceNativeHttpWithRetiredUi(options:YxxNativeHttpOptions){return createYxxSelfServiceNativeHttp({...options,h5Static:createRetiredSelfServiceFixture()});}

/** Test-only presentation for legacy child-process regressions. The actual
 * child still handles OAuth and every API. The shell contains no member facts;
 * its current-member bootstrap and commands must pass that child's guards. */
export function retiredSelfServiceProcessPresentation(forward:RequestListener):RequestListener {
 const ui=createRetiredSelfServiceFixture();
 return(request,response)=>{void(async()=>{
  const url=new URL(request.url??'/','http://127.0.0.1');
  if(request.method==='GET'){
   if(await ui.asset(url,response))return;
   const page=/^\/wecom\/yixiaoxiu\/(?:reports(?:\/(?:new|[A-Za-z0-9_-]{32}))?)?$/u.test(url.pathname);
   if(page&&!url.search&&request.headers.cookie?.split(';').some(part=>part.trim().startsWith('__Host-wecom_session='))){if(!await ui.page(response))await ui.page(response);return;}
  }
  forward(request,response);
 })().catch(()=>{if(!response.headersSent)response.writeHead(503);response.end();});};
}
