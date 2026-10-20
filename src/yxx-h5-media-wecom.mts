import {createHash,randomBytes} from 'node:crypto';
import type {WeComAccessTokenProvider} from './p2-g2-wecom-oauth-provider.mjs';
import {readWeComResponse} from './p2-g2-wecom-oauth-provider.mjs';
import type {H5MediaKind,H5MediaWeCom} from '../contracts/yxx_h5_media_contracts.js';
import {H5_MEDIA_LIMITS,H5MediaError,inspectMedia,mediaFail} from './yxx-h5-media-format.mjs';

/** Official docs: /document/path/90506, /90254, /90255 (read 2026-10-20). */
export function createYxxH5MediaWeCom({accessTokenProvider,publicOrigin,corpId,agentId,fetchImpl=fetch,now=Date.now}:{accessTokenProvider:WeComAccessTokenProvider;publicOrigin:string;corpId:string;agentId:string;fetchImpl?:typeof fetch;now?:()=>number}):H5MediaWeCom {
 const origin=new URL(publicOrigin);if(origin.origin!==publicOrigin||!corpId||corpId.length>128||!agentId||agentId.length>128||/[\r\n\x00]/u.test(corpId+agentId)||typeof accessTokenProvider!=='function')mediaFail('YXX_MEDIA_PROVIDER_CONFIG_INVALID',503);
 const tickets=new Map<string,{value:string;expires:number}>(),nextAttempt=new Map<string,number>();let active=false,stopped=false,current:AbortController|null=null;
 let settled:Promise<void>=Promise.resolve(),finish=()=>{};
 async function operation<T>(signal:AbortSignal,timeout:number,run:(combined:AbortSignal)=>Promise<T>):Promise<T>{
  if(stopped)mediaFail('YXX_MEDIA_PROVIDER_UNAVAILABLE',503);if(active)mediaFail('YXX_MEDIA_BUSY',429);active=true;settled=new Promise<void>(r=>{finish=r;});const controller=new AbortController();current=controller;
  const combined=AbortSignal.any([signal,controller.signal]);let timer:ReturnType<typeof setTimeout>|undefined;
  const timeoutResult=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new H5MediaError('YXX_MEDIA_PROVIDER_UNAVAILABLE',503));},timeout);timer.unref();});
  const task=(async()=>{try{return await run(combined);}catch(error){if(error instanceof H5MediaError)throw error;mediaFail('YXX_MEDIA_PROVIDER_UNAVAILABLE',503);}finally{active=false;current=null;finish();}})();
  try{return await Promise.race([task,timeoutResult]);}finally{controller.abort();clearTimeout(timer);}
 }
 async function credential(signal:AbortSignal){const token=await accessTokenProvider({signal});signal.throwIfAborted();if(typeof token!=='string'||!token||token.length>4096||/[\r\n]/u.test(token))mediaFail('YXX_MEDIA_PROVIDER_UNAVAILABLE',503);return token;}
 function invalidate(token:string,value:unknown){if(value&&typeof value==='object'&&[40014,42001].includes(Number((value as {errcode?:unknown}).errcode)))accessTokenProvider.invalidate?.(token);}
 return Object.freeze({
  async sign({url,type='CORPORATE',signal}:Parameters<H5MediaWeCom['sign']>[0]){
   if(typeof url!=='string'||url.length>4096||/[\r\n]/u.test(url)||!['CORPORATE','AGENT'].includes(type))mediaFail('YXX_MEDIA_INPUT_INVALID');let page:URL;try{page=new URL(url);}catch{mediaFail('YXX_MEDIA_INPUT_INVALID');}
   if(page.origin!==origin.origin||page.username||page.password||page.pathname!=='/wecom/yixiaoxiu'&&!page.pathname.startsWith('/wecom/yixiaoxiu/'))mediaFail('YXX_MEDIA_INPUT_INVALID');
   const signingUrl=url.split('#',1)[0];if(!signingUrl)mediaFail('YXX_MEDIA_INPUT_INVALID');
   return operation(signal,5000,async combined=>{
    let ticket=tickets.get(type);if(!ticket||ticket.expires<=now()){
     if((nextAttempt.get(type)??0)>now())mediaFail('YXX_MEDIA_PROVIDER_UNAVAILABLE',503);nextAttempt.set(type,now()+30_000);
     const token=await credential(combined),endpoint=new URL(type==='AGENT'?'https://qyapi.weixin.qq.com/cgi-bin/ticket/get':'https://qyapi.weixin.qq.com/cgi-bin/get_jsapi_ticket');endpoint.searchParams.set('access_token',token);if(type==='AGENT')endpoint.searchParams.set('type','agent_config');
     const started=now(),value=await readWeComResponse(await fetchImpl(endpoint,{method:'GET',redirect:'error',signal:combined}),combined);combined.throwIfAborted();
     if(!value||typeof value!=='object')mediaFail('YXX_MEDIA_PROVIDER_UNAVAILABLE',503);const body=value as {errcode?:unknown;ticket?:unknown;expires_in?:unknown};invalidate(token,body);
     if(body.errcode!==0||typeof body.ticket!=='string'||!body.ticket||Buffer.byteLength(body.ticket)>512||!Number.isSafeInteger(body.expires_in)||Number(body.expires_in)<1||Number(body.expires_in)>86400)mediaFail('YXX_MEDIA_PROVIDER_UNAVAILABLE',503);
     const lifetime=Number(body.expires_in)*1000;ticket={value:body.ticket,expires:started+lifetime-Math.min(60_000,lifetime/10)};tickets.set(type,ticket);nextAttempt.delete(type);
    }
    const timestamp=Math.floor(now()/1000),nonceStr=randomBytes(18).toString('base64url');const signature=createHash('sha1').update('jsapi_ticket='+ticket.value+'&noncestr='+nonceStr+'&timestamp='+timestamp+'&url='+signingUrl).digest('hex');combined.throwIfAborted();return {corpId,agentId,timestamp,nonceStr,signature};
   });
  },
  async download({kind,serverId,signal}:Parameters<H5MediaWeCom['download']>[0]){
   if(!['IMAGE','VOICE','VIDEO'].includes(kind)||typeof serverId!=='string'||serverId.length<1||serverId.length>512||/[\s\x00-\x1f\x7f]/u.test(serverId))mediaFail('YXX_MEDIA_INPUT_INVALID');
   return operation(signal,30_000,async combined=>{
    const token=await credential(combined),url=new URL('https://qyapi.weixin.qq.com/cgi-bin/media/get');url.searchParams.set('access_token',token);url.searchParams.set('media_id',serverId);
    const response=await fetchImpl(url,{method:'GET',redirect:'error',signal:combined});if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});mediaFail('YXX_MEDIA_PROVIDER_UNAVAILABLE',503);}
    const reader=response.body.getReader(),chunks:Buffer[]=[];let length=0,bytes:Buffer|null=null;
    try{const declared=response.headers.get('content-length');if(declared!==null&&(!/^[0-9]+$/u.test(declared)||Number(declared)>H5_MEDIA_LIMITS[kind]))mediaFail('YXX_MEDIA_OVERSIZED',413);
     for(;;){combined.throwIfAborted();const value=await reader.read();if(value.done)break;length+=value.value.byteLength;if(length>H5_MEDIA_LIMITS[kind])mediaFail('YXX_MEDIA_OVERSIZED',413);chunks.push(Buffer.from(value.value));}
     bytes=Buffer.concat(chunks,length);if(!length)mediaFail('YXX_MEDIA_PROVIDER_UNAVAILABLE',503);
     if(bytes[0]===123){let body:unknown;try{body=JSON.parse(bytes.toString('utf8'));}catch{body=null;}invalidate(token,body);mediaFail('YXX_MEDIA_PROVIDER_UNAVAILABLE',503);}
     const mime=kind==='VOICE'?'audio/amr':kind==='VIDEO'?'video/mp4':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes.toString('ascii',8,12)==='WEBP'?'image/webp':'image/jpeg';
     inspectMedia(bytes,kind,mime);combined.throwIfAborted();const result=bytes;bytes=null;return {bytes:result,mime_type:mime};
    }finally{bytes?.fill(0);for(const c of chunks)c.fill(0);await reader.cancel().catch(()=>{});reader.releaseLock();}
   });
  },
  async close(){stopped=true;current?.abort();await settled;tickets.clear();nextAttempt.clear();},
 });
}
