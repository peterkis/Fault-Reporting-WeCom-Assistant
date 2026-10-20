import {timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {once} from 'node:events';
import type {OAuthHttpHandler} from './p2-g2-wecom-oauth-http.mjs';
import type {YxxSelfServiceCommand} from './yxx-self-service-command.mjs';
import type {createYxxSelfServiceQuery} from './yxx-self-service-query.mjs';
import type {createYxxSelfServiceAuthorization,YxxMemberContext,YxxMemberSource} from './yxx-self-service-authorization.mjs';
import type {YxxH5Media} from './yxx-h5-media.mjs';
import type {H5MediaWeCom} from '../contracts/yxx_h5_media_contracts.js';
import type {H5MediaLease} from '../contracts/yxx_h5_media_contracts.js';
import type {H5BootstrapExtension,H5ReportFilters} from '../contracts/yxx_h5_v2_contracts.js';
import {readYxxJsonBody} from './yxx-self-service-native-http.mjs';

const API='/api/yixiaoxiu/';
const V2='application/vnd.yixiaoxiu.v2+json';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const REF='([A-Za-z0-9_-]{32})';
const HEADERS=Object.freeze({'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'});
interface HttpOptions {
 enabled?:boolean;publicOrigin:string;
 command:Pick<YxxSelfServiceCommand,'accept'|'authorize'|'revalidateWrite'|'urge'|'evaluate'>;
 query:Pick<ReturnType<typeof createYxxSelfServiceQuery>,'list'|'detailWithEtag'|'department'|'lifecycleReceipt'>;
 authorization:Pick<ReturnType<typeof createYxxSelfServiceAuthorization<IncomingMessage>>,'authorize'|'revalidate'>;
 media:YxxH5Media|null;wecom:H5MediaWeCom|null;sdk:H5BootstrapExtension['sdk'];
}
function fail(code:string,status=400):never{throw Object.assign(new Error(code),{code,status});}
function header(request:IncomingMessage,name:string):string|null{const value=request.headers[name];return typeof value==='string'?value:null;}
function equal(left:string|null,right:string|null){if(left===null||right===null)return false;const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b);}
function json(response:ServerResponse,status:number,value:unknown,extra:Record<string,string>={}){response.writeHead(status,{...HEADERS,'content-type':'application/json; charset=utf-8',...extra});response.end(status===304?undefined:JSON.stringify(value));}
function keys(value:Record<string,unknown>,allowed:readonly string[]){if(Object.keys(value).some(key=>!allowed.includes(key)))fail('YXX_INPUT_INVALID');}
function params(url:URL,allowed:readonly string[]){for(const key of url.searchParams.keys())if(!allowed.includes(key)||url.searchParams.getAll(key).length!==1)fail('YXX_INPUT_INVALID');}
function readGuard(request:IncomingMessage,origin:string){
 if(header(request,'sec-fetch-site')==='cross-site'||header(request,'origin')!==null&&header(request,'origin')!==origin)fail('YXX_FORBIDDEN',403);
 if(header(request,'transfer-encoding')||Number(header(request,'content-length')??0)>0)fail('YXX_INPUT_INVALID');
}
function writeGuard(request:IncomingMessage,origin:string){if(header(request,'origin')!==origin||header(request,'sec-fetch-site')==='cross-site')fail('YXX_ORIGIN_INVALID',403);if(header(request,'content-encoding'))fail('YXX_CONTENT_TYPE_INVALID',415);}
function canWrite(context:YxxMemberContext){if(!context.scope||!['MEMBER_SELF_SERVICE','FULL_SERVICE_LOOP'].includes(context.profile)||!context.write_flag||!context.flags.YIXIAOXIU_SELF_SERVICE_ENABLED||!context.flags.YIXIAOXIU_MY_REPORTS_ENABLED)fail('YXX_MEMBER_WRITE_DISABLED',403);}
function failure(value:unknown):{status:number;code:string}{
 const error=value as {status?:number;code?:string}|null;let status=error?.status;
 const code=typeof error?.code==='string'?error.code:'';
 if(status===undefined){if(/AUTH_REQUIRED|MEMBER_REQUIRED/u.test(code))status=401;else if(/FORBIDDEN|DISABLED|CSRF/u.test(code))status=403;else if(/NOT_FOUND/u.test(code))status=404;else if(/CONFLICT|VERSION|COOLDOWN/u.test(code))status=409;else if(/TOO_LARGE|OVERSIZED/u.test(code))status=413;else if(/INVALID|INPUT|LIMIT/u.test(code)||value instanceof TypeError)status=400;else status=503;}
 if(![400,401,403,404,409,413,415,422,429,503].includes(status))status=503;
 return {status,code:/^YXX_[A-Z0-9_]{1,100}$/u.test(code)?code:status>=500?'YXX_UNAVAILABLE':'YXX_INPUT_INVALID'};
}

/** V2 negotiation preserves the original member API; new media is scoped to its authenticated owner. */
export function createYxxH5Http({enabled=false,publicOrigin,command,query,authorization,media,wecom,sdk}:HttpOptions){
 if(typeof enabled!=='boolean')fail('YXX_CONFIG_INVALID',503);
 const origin=new URL(publicOrigin);
 const v2=(request:IncomingMessage)=>(header(request,'accept')??'').split(',').some(value=>value.trim().split(';')[0]===V2);
 async function member(request:IncomingMessage){const context=await authorization.authorize({request,operation:'WEB_DETAIL',source:'WEB'});if(!context.scope)fail('YXX_AUTH_REQUIRED',401);return context;}
 async function write(request:IncomingMessage,input:unknown){const context=await command.authorize({request,input});return {scope:context.scope,verifyCurrentWrite:()=>command.revalidateWrite({request,context})};}
 const handler:OAuthHttpHandler=async({request,response,url})=>{
  if(!enabled||!url.pathname.startsWith(API))return false;
  try{
   if(request.headers.host!==origin.host||url.origin!==origin.origin)fail('YXX_ORIGIN_INVALID',403);
   if(Buffer.byteLength(request.url??'')>2048||!(request.url??'').startsWith('/')||(request.url??'').startsWith('//')||(request.url??'').split('?')[0]!==url.pathname)fail('YXX_INPUT_INVALID');
   const path=url.pathname.slice(API.length),method=request.method;
   if(method==='GET'&&path==='my-reports'&&v2(request)){
    readGuard(request,origin.origin);params(url,['source','cursor','limit','search','status']);
    const source=url.searchParams.get('source');if(source!==null&&source!=='WEB'&&source!=='BOT')fail('YXX_INPUT_INVALID');
    json(response,200,await query.list({request,source:source as YxxMemberSource|null,cursor:url.searchParams.get('cursor'),limit:url.searchParams.get('limit'),search:url.searchParams.get('search'),status:url.searchParams.get('status') as H5ReportFilters['status'],v2:true}));return true;
   }
   const detail=new RegExp('^requests/'+REF+'$','u').exec(path);
   if(method==='GET'&&detail&&v2(request)){
    readGuard(request,origin.origin);params(url,[]);const ifNoneMatch=header(request,'if-none-match');if(ifNoneMatch!==null&&ifNoneMatch.length>256)fail('YXX_INPUT_INVALID');
    const result=await query.detailWithEtag({request,requestRef:detail[1],ifNoneMatch,v2:true});json(response,result.status,result.body,{etag:result.etag});return true;
   }
   if(method==='POST'&&path==='requests'&&v2(request)){
    writeGuard(request,origin.origin);params(url,[]);const input=await readYxxJsonBody(request,16*1024);if(input.schema_version!==2)fail('YXX_INPUT_INVALID');
    const result=await command.accept({request,input});json(response,result.replayed?200:202,{ok:true,replayed:result.replayed,receipt:result.receipt,location:'/wecom/yixiaoxiu/reports/'+result.receipt.request_ref});return true;
   }
   if(path==='department-reports'){
    if(method!=='GET')fail('YXX_NOT_FOUND',404);readGuard(request,origin.origin);params(url,['cursor','limit','search','status']);
    json(response,200,await query.department({request,cursor:url.searchParams.get('cursor'),limit:url.searchParams.get('limit'),search:url.searchParams.get('search'),status:url.searchParams.get('status') as H5ReportFilters['status']}));return true;
   }
   const lifecycle=new RegExp('^requests/'+REF+'/(urge|evaluation|member-commands)(?:/([0-9a-f-]{36}))?$','iu').exec(path);
   if(lifecycle){
    const requestRef=lifecycle[1] as string,action=lifecycle[2];
    if(method==='GET'&&action==='member-commands'&&lifecycle[3]){
     readGuard(request,origin.origin);params(url,['purpose']);const purpose=url.searchParams.get('purpose');if(!UUID.test(lifecycle[3])||purpose!=='URGE'&&purpose!=='EVALUATION')fail('YXX_INPUT_INVALID');
     json(response,200,await query.lifecycleReceipt({request,requestRef,clientCommandId:lifecycle[3],purpose}));return true;
    }
    if(method!=='POST'||lifecycle[3]||!['urge','evaluation'].includes(action??''))fail('YXX_NOT_FOUND',404);
    writeGuard(request,origin.origin);params(url,[]);const input=await readYxxJsonBody(request,4096);if(header(request,'if-match')!=='"'+String(input.expected_ticket_version)+'"')fail('YXX_CONFLICT',409);
    const result=action==='urge'?await command.urge({request,input,requestRef}):await command.evaluate({request,input,requestRef});json(response,200,result);return true;
   }
   if(path==='js-sdk/signature'){
    if(method!=='POST')fail('YXX_NOT_FOUND',404);writeGuard(request,origin.origin);params(url,[]);
    const input=await readYxxJsonBody(request,2048);keys(input,['url','kind']);if(typeof input.url!=='string'||input.kind!=='CORP'&&input.kind!=='AGENT')fail('YXX_INPUT_INVALID');
    const context=await member(request);canWrite(context);if(!equal(header(request,'x-csrf-token'),context.csrf_token))fail('YXX_CSRF_INVALID',403);
    if(!wecom||!sdk.enabled)fail('YXX_MEDIA_PROVIDER_UNAVAILABLE',503);
    const result=await wecom.sign({url:input.url,type:input.kind==='AGENT'?'AGENT':'CORPORATE',signal:AbortSignal.timeout(6000)});
    const latest=await authorization.revalidate(request,context);canWrite(latest);if(!equal(context.csrf_token,latest.csrf_token))fail('YXX_AUTH_RECHECK_FAILED',503);
    json(response,200,result);return true;
   }
   if(path==='media/uploads'){
    if(method!=='POST')fail('YXX_NOT_FOUND',404);writeGuard(request,origin.origin);params(url,[]);const input=await readYxxJsonBody(request,2048);
    const checked=await write(request,input);if(!media)fail('YXX_MEDIA_DISABLED',503);const result=await media.reserve({...checked,input});await checked.verifyCurrentWrite();json(response,result.replayed?200:201,result);return true;
   }
   const upload=/^media\/uploads\/([0-9a-f-]{36})(?:\/(content|wecom))?$/iu.exec(path);
   if(upload){
    writeGuard(request,origin.origin);params(url,[]);const ref=upload[1] as string;if(!UUID.test(ref))fail('YXX_INPUT_INVALID');
    const clientCommandId=header(request,'idempotency-key');if(!clientCommandId||!UUID.test(clientCommandId))fail('YXX_IDEMPOTENCY_KEY_INVALID');
    const checked=await write(request,{client_command_id:clientCommandId});if(!media)fail('YXX_MEDIA_DISABLED',503);
    if(method==='PUT'&&upload[2]==='content'){
     const length=header(request,'content-length');if(length!==null&&(!/^[1-9][0-9]*$/u.test(length)||Number(length)>20*1024*1024))fail('YXX_BODY_TOO_LARGE',413);
     const result=await media.upload({...checked,ref,body:request as AsyncIterable<Uint8Array>});await checked.verifyCurrentWrite();request.resume();json(response,200,result);return true;
    }
    if(method==='POST'&&upload[2]==='wecom'){
     const input=await readYxxJsonBody(request,1024);keys(input,['server_id']);if(typeof input.server_id!=='string')fail('YXX_INPUT_INVALID');
     const result=await media.importWeCom({...checked,ref,serverId:input.server_id});await checked.verifyCurrentWrite();json(response,200,result);return true;
    }
    if(method==='DELETE'&&!upload[2]){if(header(request,'transfer-encoding')||Number(header(request,'content-length')??0)>0)fail('YXX_INPUT_INVALID');await media.cancel({...checked,ref});await checked.verifyCurrentWrite();json(response,200,{ok:true});return true;}
    fail('YXX_NOT_FOUND',404);
   }
   const resource=new RegExp('^requests/'+REF+'/media/([0-9a-f-]{36})$','iu').exec(path);
   if(resource){
    if(method!=='GET')fail('YXX_NOT_FOUND',404);readGuard(request,origin.origin);params(url,['variant']);const variant=url.searchParams.get('variant')??'PLAYABLE';if(!['ORIGINAL','PLAYABLE'].includes(variant)||!UUID.test(resource[2] as string))fail('YXX_INPUT_INVALID');
    if(!media)fail('YXX_MEDIA_DISABLED',503);const context=await member(request);if(!context.scope)fail('YXX_AUTH_REQUIRED',401);
    const controller=new AbortController(),abort=()=>controller.abort();request.once('aborted',abort);response.once('close',abort);
    let lease:H5MediaLease|null=null;
    try{
     lease=await media.read({scope:context.scope,ref:resource[2] as string,requestRef:resource[1] as string,variant:variant as 'ORIGINAL'|'PLAYABLE',verifyCurrentRead:async()=>{await authorization.revalidate(request,context);},signal:controller.signal});
     response.writeHead(200,{...HEADERS,'content-type':lease.mime_type,'content-length':lease.byte_size,'content-disposition':variant==='ORIGINAL'?'attachment':'inline'});
     for await(const chunk of lease.stream){controller.signal.throwIfAborted();if(!response.write(chunk))await once(response,'drain',{signal:controller.signal});}response.end();
    }finally{request.off('aborted',abort);response.off('close',abort);await lease?.close();}return true;
   }
   return false;
  }catch(value){const selected=failure(value);if(response.headersSent)response.destroy();else json(response,selected.status,{error:{code:selected.code,retryable:selected.status>=500}});return true;}
 };
 return Object.freeze({handler});
}
