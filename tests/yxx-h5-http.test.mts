import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {IncomingMessage} from 'node:http';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {createYxxH5Http} from '../src/yxx-h5-http.mjs';
import {createYxxSelfServiceNativeHttp} from '../src/yxx-self-service-native-http.mjs';
import {createYxxMemberCommandContext} from '../src/yxx-self-service-command.mjs';
import {createYxxSelfServiceAuthorization} from '../src/yxx-self-service-authorization.mjs';
import {createWeComWebOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';
import type {OAuthState} from '../src/p2-g2-wecom-web-oauth.mjs';
import {sessionName} from '../src/p2-g2-wecom-oauth-http.mjs';
import {parseYxxInitialRequestInput} from '../src/yxx-self-service-store.mjs';
import type {YxxSelfServiceStore,YxxStoreCommand,YxxCommandReceipt,YxxAcceptResult} from '../src/yxx-self-service-store.mjs';
import {H5_ACCEPT,H5_LIMITS,parseH5UrgeInput,parseH5EvaluationInput,h5Fail} from '../src/yxx-h5-v2-contracts.mjs';
import type {H5MediaMetadata,H5MediaWeCom} from '../contracts/yxx_h5_media_contracts.js';
import type {YxxH5Media} from '../src/yxx-h5-media.mjs';
import type {PostgresTransaction} from '../src/platform/postgres-pool.mjs';

const REF='H'.repeat(32),OTHER_REF='X'.repeat(32);
const MEDIA='2b1f2c30-a051-4a44-8a2a-dc4b6467d7b1';
const CSRF='H5_HTTP_SYNTHETIC_CSRF_NOT_A_SECRET_0001';
const FLAGS={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
const WHEN='2026-10-20 12:30:00',EPOCH=String(Date.parse(WHEN.replace(' ','T')+'+08:00'));
const BYTES=Buffer.from('h5-http-synthetic-media');
const META:H5MediaMetadata={media_ref:MEDIA,kind:'IMAGE',mime_type:'image/png',byte_size:BYTES.length,duration_ms:null,playback_status:'READY',playback_mime_type:'image/png'};
const noDatabase:PostgresTransaction={query:async()=>{throw new Error('H5_HTTP_DATABASE_FORBIDDEN');}};
type HttpOptions=Parameters<typeof createYxxH5Http>[0];
type QueryInput=Parameters<HttpOptions['query']['list']>[0];
interface Control {
 authFailure:'NONE'|'DENIED'|'UNAVAILABLE'|'UNSAFE';recheckFailure:'NONE'|'DENIED'|'UNAVAILABLE';
 stream:'NORMAL'|'DENY_SECOND'|'REJECT_OPEN'|'WAIT_DISCONNECT';readClosed:number;readOpened:number;readChunks:number;
 accepts:number;signatureCalls:number;reserved:number;uploaded:number;imported:number;cancelled:number;
 lastScope:string|null;lastBody:Buffer|null;listCalls:QueryInput[];detailV2:boolean[];
 afterSign:()=>void;releaseStream:()=>void;afterClose:()=>void;
 completed:{path:string;requestAbortedListeners:number;responseCloseListeners:number}[];
}
interface Fixture {base:string;origin:string;cookie:string;control:Control;headers:(commandId?:string)=>Record<string,string>;fetch:(path:string,init?:RequestInit)=>Promise<Response>}
function record(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
async function json(response:Response):Promise<Record<string,unknown>>{const raw:unknown=await response.json();return record(raw);}
function v2Input(id=randomUUID()){return {schema_version:2,client_command_id:id,intent:'CONTACT_REQUEST',description:null,location:{text:null,unknown:true},media_refs:[]};}
function v1Input(id=randomUUID()){return {schema_version:1,client_command_id:id,description:'合成故障',location:{text:null,unknown:true},service_code:null,impact_scope:'UNKNOWN',reported_department_text:null,extension:null};}

async function fixture(run:(f:Fixture)=>Promise<void>){
 const control:Control={authFailure:'NONE',recheckFailure:'NONE',stream:'NORMAL',readClosed:0,readOpened:0,readChunks:0,accepts:0,signatureCalls:0,reserved:0,uploaded:0,imported:0,cancelled:0,lastScope:null,lastBody:null,listCalls:[],detailV2:[],afterSign:()=>{},releaseStream:()=>{},afterClose:()=>{},completed:[]};
 let dispatch:((request:IncomingMessage,response:import('node:http').ServerResponse)=>Promise<void>)|null=null;
 const server=createServer((request,response)=>{void dispatch?.(request,response).catch(()=>{if(response.headersSent)response.destroy();else{response.writeHead(500);response.end('H5_HTTP_HARNESS_FAILURE');}});});
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');
 const base='http://127.0.0.1:'+address.port,origin='https://127.0.0.1:'+address.port;
 const oauth=createWeComWebOAuth({enabled:true,publicOrigin:origin,corpId:'ww-h5-http-synthetic',agentId:'1000002',resolveCode:async()=>({userid:'H5_HTTP_SYNTHETIC_MEMBER'})});assert.equal(oauth.enabled,true);if(!oauth.enabled)throw new Error('OAUTH_DISABLED');
 const intent=oauth.begin(),state=new URL(intent.location).searchParams.get('state');assert.ok(state);const session=await oauth.complete({state:state as OAuthState,browserToken:intent.browserToken,code:'H5_HTTP_SYNTHETIC_CODE'});
 const cookie=sessionName+'='+session.sessionToken;
 function rawAuth(){
  if(control.authFailure==='DENIED')h5Fail('YXX_FORBIDDEN',403);
  if(control.authFailure==='UNAVAILABLE')h5Fail('APPLICATION_MEMBER_UNAVAILABLE',503);
  if(control.authFailure==='UNSAFE')throw Object.assign(new Error('token=H5_HTTP_LEAK_CANARY password=H5_HTTP_LEAK_CANARY'),{code:'token=H5_HTTP_LEAK_CANARY',status:500,headers:{authorization:'H5_HTTP_LEAK_CANARY'}});
  return {profile:'FULL_SERVICE_LOOP',flags:FLAGS,write_flag:true,csrf_token:CSRF,session_generation:'synthetic-generation-1',canonical_reporter_binding:'a'.repeat(64),source_corp_scope:'ww-h5-http-synthetic',source_app_scope:'1000002',proof_ref:'h5-http-synthetic-proof'};
 }
 const recheck=Object.assign(async()=>{if(control.recheckFailure==='DENIED')h5Fail('YXX_FORBIDDEN',403);if(control.recheckFailure==='UNAVAILABLE')h5Fail('APPLICATION_MEMBER_UNAVAILABLE',503);return rawAuth();},{localOnly:true as const});
 const authorization=createYxxSelfServiceAuthorization<IncomingMessage>({authenticate:async()=>rawAuth(),recheck,profile:'FULL_SERVICE_LOOP',flags:FLAGS});
 const receipt=(id:string):YxxCommandReceipt=>({client_command_id:id,status:'ACCEPTED',request_ref:REF,intake_no:'I-SYNTHETIC-001',accepted_revision:'1',accepted_at:WHEN,accepted_epoch_ms:EPOCH});
 const receipts=new Map<string,YxxCommandReceipt>();
 const acceptStore=async(options:YxxStoreCommand):Promise<YxxAcceptResult>=>{
  const input=parseYxxInitialRequestInput(options.input);control.lastScope=options.scope.scopeHash;
  const previous=receipts.get(input.client_command_id);if(previous)return {replayed:true,receipt:previous};
  await options.onNewCommand?.({scope:options.scope,value:input,kind:'SUBMIT',transaction:noDatabase});await options.onBeforeCommit?.({scope:options.scope,value:input,kind:'SUBMIT',transaction:noDatabase});
  const result=receipt(input.client_command_id);receipts.set(input.client_command_id,result);control.accepts++;return {replayed:false,receipt:result};
 };
 const store:Pick<YxxSelfServiceStore,'accept'|'acceptInTransaction'|'command'>={accept:acceptStore,acceptInTransaction:acceptStore,command:async()=>{throw new Error('UNUSED_COMMAND_READ');}};
 const command=createYxxMemberCommandContext({store,authenticate:async()=>rawAuth(),recheck:Object.assign(async()=>recheck(),{localOnly:true as const}),profile:'FULL_SERVICE_LOOP',flags:FLAGS,quota:Object.assign(async()=>true,{localOnly:true as const})});
 const lifecycleCommand:HttpOptions['command']={...command,
  urge:async options=>{await command.authorize({...options,kind:'URGE'});const input=parseH5UrgeInput(options.input);return {ok:true,replayed:false,client_command_id:input.client_command_id,request_ref:REF,purpose:'URGE',accepted_at:WHEN,accepted_epoch_ms:EPOCH};},
  evaluate:async options=>{await command.authorize({...options,kind:'EVALUATION'});const input=parseH5EvaluationInput(options.input);return {ok:true,replayed:false,client_command_id:input.client_command_id,request_ref:REF,purpose:'EVALUATION',accepted_at:WHEN,accepted_epoch_ms:EPOCH};},
 };
 const query:HttpOptions['query']={
  list:async input=>{assert.ok(input);control.listCalls.push(input);await authorization.authorize({request:input.request});return {items:[],next_cursor:null};},
  detailWithEtag:async input=>{assert.ok(input);control.detailV2.push(input.v2===true);await authorization.authorize({request:input.request});return {status:304,etag:'"h5-http-synthetic"',body:null};},
  department:async input=>{await authorization.authorize({request:input.request});return {items:[],next_cursor:null,total:0,active_count:0};},
  lifecycleReceipt:async input=>{await authorization.authorize({request:input.request});return {state:'UNKNOWN',client_command_id:String(input.clientCommandId),request_ref:REF,purpose:input.purpose};},
 };
 const media:YxxH5Media={
  reserve:async input=>{await input.verifyCurrentWrite();control.lastScope=input.scope.scopeHash;control.reserved++;return {media_ref:MEDIA,kind:'IMAGE',status:'RESERVED',expires_epoch_ms:String(Date.now()+60000),replayed:false};},
  reservation:async()=>{throw new Error('UNUSED_RESERVATION');},
  upload:async input=>{await input.verifyCurrentWrite();const chunks:Buffer[]=[];for await(const chunk of input.body)chunks.push(Buffer.from(chunk));control.lastBody=Buffer.concat(chunks);control.uploaded++;return META;},
  importWeCom:async input=>{await input.verifyCurrentWrite();assert.equal(input.serverId,'H5_HTTP_SYNTHETIC_SERVER_ID');control.imported++;return META;},
  cancel:async input=>{await input.verifyCurrentWrite();control.cancelled++;},
  list:async()=>[],listForRequest:async()=>[],listForRequestInTransaction:async()=>[],listForIntake:async()=>[],
  read:async input=>{
   await input.verifyCurrentRead();control.lastScope=input.scope.scopeHash;if(input.requestRef!==REF)h5Fail('YXX_MEDIA_NOT_FOUND',404);if(control.stream==='REJECT_OPEN')h5Fail('YXX_MEDIA_NOT_FOUND',404);control.readOpened++;
   let released=false;const close=async()=>{if(!released){released=true;control.readClosed++;control.afterClose();}};
   let firstSent=false;const stream=control.stream==='WAIT_DISCONNECT'?new Readable({read(){if(!firstSent){firstSent=true;control.readChunks++;this.push(Buffer.from('first'));}}}):Readable.from((async function*(){try{if(control.stream==='DENY_SECOND'){await input.verifyCurrentRead();control.readChunks++;yield Buffer.from('first');await new Promise<void>(resolve=>{control.releaseStream=resolve;});await input.verifyCurrentRead();control.readChunks++;yield Buffer.from('PRIVATE_SECOND_CHUNK');}else{await input.verifyCurrentRead();control.readChunks++;yield BYTES;}}finally{await close();}})(),{objectMode:false});
   const aborted=()=>stream.destroy();input.signal?.addEventListener('abort',aborted,{once:true});return {asset:META,mime_type:META.mime_type,byte_size:control.stream==='DENY_SECOND'||control.stream==='WAIT_DISCONNECT'?25:BYTES.length,stream,close:async()=>{input.signal?.removeEventListener('abort',aborted);stream.destroy();await close();}};
  },
  readForIntake:async()=>{throw new Error('UNUSED_STAFF_READ');},claimInTransaction:async()=>{},processNextTranscode:async()=>({processed:false}),cleanupExpired:async()=>0,close:async()=>{},ownedResourceState:()=>({active:0,plaintext_bytes:0}),
 };
 const wecom:H5MediaWeCom={sign:async input=>{input.signal.throwIfAborted();control.signatureCalls++;control.afterSign();return {corpId:'ww-h5-http-synthetic',agentId:'1000002',timestamp:1792470600,nonceStr:'synthetic-nonce',signature:'synthetic-signature'};},download:async()=>{throw new Error('UNUSED_DOWNLOAD');},close:async()=>{}};
 const h5=createYxxH5Http({enabled:true,publicOrigin:origin,command:lifecycleCommand,query,authorization,media,wecom,sdk:{enabled:true,corp_id:'ww-h5-http-synthetic',agent_id:'1000002'}});
 const native=createYxxSelfServiceNativeHttp({publicOrigin:origin,oauth,oauthHttp:async()=>false,command,supplement:{accept:async()=>{throw new Error('UNUSED_SUPPLEMENT');}},query:{...query,timeline:async()=>{throw new Error('UNUSED_TIMELINE');},commandStatus:async()=>{throw new Error('UNUSED_COMMAND_STATUS');}},authenticateMember:async()=>rawAuth(),profile:'FULL_SERVICE_LOOP',featureFlags:FLAGS,recoveryBindingSecret:'H5_HTTP_SYNTHETIC_RECOVERY_KEY_0000000001',h5Handler:h5.handler,
  h5Bootstrap:async()=>({profile:{name:null,department:null,phone:null,avatar_url:null},can_upload:true,can_urge:true,can_evaluate:true,can_view_department:false,sdk:{enabled:true,corp_id:'ww-h5-http-synthetic',agent_id:'1000002'},support:{emergency_phone:'18117887318',service_phone:'61318500'},limits:H5_LIMITS}),
 });
 dispatch=async(request,response)=>{const beforeRequest=request.listenerCount('aborted'),beforeResponse=response.listenerCount('close'),url=new URL(request.url??'/',origin);const handled=await native.handler({request,response,url});if(!handled){response.writeHead(404,{'content-type':'application/json'});response.end('{"unhandled":true}');}control.completed.push({path:url.pathname,requestAbortedListeners:request.listenerCount('aborted')-beforeRequest,responseCloseListeners:response.listenerCount('close')-beforeResponse});};
 const headers=(commandId?:string)=>({accept:H5_ACCEPT,origin,'content-type':'application/json','x-csrf-token':CSRF,cookie,...(commandId?{'idempotency-key':commandId}:{})});
 try{await run({base,origin,cookie,control,headers,fetch:(path,init={})=>fetch(base+path,{...init,headers:{cookie,...init.headers},signal:AbortSignal.timeout(5000)})});}
 finally{control.releaseStream();server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));oauth.close();}
}

test('H5 real HTTP negotiates V2 lists/details/bootstrap while preserving native V1 route shapes',{timeout:15000},async()=>fixture(async f=>{
 assert.equal((await f.fetch('/api/yixiaoxiu/my-reports',{headers:{accept:'application/json'}})).status,200);assert.equal(f.control.listCalls.at(-1)?.v2,undefined);
 assert.equal((await f.fetch('/api/yixiaoxiu/my-reports?source=WEB&search=printer&status=ACTIVE&limit=20',{headers:{accept:H5_ACCEPT}})).status,200);assert.equal(f.control.listCalls.at(-1)?.v2,true);assert.equal(f.control.listCalls.at(-1)?.search,'printer');
 assert.equal((await f.fetch('/api/yixiaoxiu/my-reports?search=printer',{headers:{accept:'application/json'}})).status,400);
 for(const accept of ['application/json',H5_ACCEPT]){const r=await f.fetch('/api/yixiaoxiu/requests/'+REF,{headers:{accept,'if-none-match':'"h5-http-synthetic"'}});assert.equal(r.status,304);assert.equal(await r.text(),'');assert.equal(r.headers.get('etag'),'"h5-http-synthetic"');}assert.deepEqual(f.control.detailV2,[false,true]);
 const v1=await json(await f.fetch('/api/yixiaoxiu/bootstrap',{headers:{accept:'application/json'}}));assert.equal(Object.hasOwn(v1,'h5'),false);const v2=await json(await f.fetch('/api/yixiaoxiu/bootstrap',{headers:{accept:H5_ACCEPT}}));assert.equal(record(v2.h5).can_upload,true);
}));

test('H5 real HTTP accepts V2 once and retains V1 input with status and original UUID replay',{timeout:15000},async()=>fixture(async f=>{
 for(const input of [v1Input(),v2Input()]){const headers={...f.headers(input.client_command_id),accept:input.schema_version===1?'application/json':H5_ACCEPT};const first=await f.fetch('/api/yixiaoxiu/requests',{method:'POST',headers,body:JSON.stringify(input)});assert.equal(first.status,202);const body=await json(first);assert.equal(record(body.receipt).client_command_id,input.client_command_id);assert.equal(body.location,'/wecom/yixiaoxiu/reports/'+REF);const replay=await f.fetch('/api/yixiaoxiu/requests',{method:'POST',headers,body:JSON.stringify(input)});assert.equal(replay.status,200);assert.equal((await json(replay)).replayed,true);}assert.equal(f.control.accepts,2);assert.equal(f.control.lastScope,'a'.repeat(64));
}));

test('H5 real HTTP requires explicit V2 negotiation rather than falling through native V1 submission',{timeout:15000},async()=>fixture(async f=>{
 const input=v2Input(),r=await f.fetch('/api/yixiaoxiu/requests',{method:'POST',headers:{...f.headers(input.client_command_id),accept:'application/json'},body:JSON.stringify(input)});assert.equal(r.status,400);assert.equal(f.control.accepts,0);
}));

test('H5 real HTTP enforces origin, CSRF, idempotency, closed JSON and lifecycle If-Match',{timeout:15000},async()=>fixture(async f=>{
 const input=v2Input();for(const headers of [{...f.headers(input.client_command_id),origin:'https://other.example.test'},{...f.headers(input.client_command_id),'x-csrf-token':'wrong'},{...f.headers(input.client_command_id),'idempotency-key':randomUUID()}]){const r=await f.fetch('/api/yixiaoxiu/requests',{method:'POST',headers,body:JSON.stringify(input)});assert.ok([400,403].includes(r.status));}assert.equal(f.control.accepts,0);
 const duplicate='{"schema_version":2,"schema_version":2,"client_command_id":"'+input.client_command_id+'"}';assert.equal((await f.fetch('/api/yixiaoxiu/requests',{method:'POST',headers:f.headers(input.client_command_id),body:duplicate})).status,400);
 const urge={schema_version:1,client_command_id:randomUUID(),expected_ticket_version:3};const path='/api/yixiaoxiu/requests/'+REF+'/urge';assert.equal((await f.fetch(path,{method:'POST',headers:f.headers(urge.client_command_id),body:JSON.stringify(urge)})).status,409);assert.equal((await f.fetch(path,{method:'POST',headers:{...f.headers(urge.client_command_id),'if-match':'"3"'},body:JSON.stringify(urge)})).status,200);
 const evaluation={...urge,client_command_id:randomUUID(),completed_round_ref:'e'.repeat(32),rating:5,comment:null};assert.equal((await f.fetch('/api/yixiaoxiu/requests/'+REF+'/evaluation',{method:'POST',headers:{...f.headers(evaluation.client_command_id),'if-match':'"3"'},body:JSON.stringify(evaluation)})).status,200);
 const receipt=await json(await f.fetch('/api/yixiaoxiu/requests/'+REF+'/member-commands/'+urge.client_command_id+'?purpose=URGE'));assert.equal(receipt.state,'UNKNOWN');assert.equal(receipt.client_command_id,urge.client_command_id);
}));

test('H5 real HTTP media reserve/raw/import/cancel keep authenticated scope and original command headers',{timeout:15000},async()=>fixture(async f=>{
 const id=randomUUID(),input={schema_version:1,client_command_id:id,kind:'IMAGE',mime_type:'image/png',byte_size:BYTES.length,duration_ms:null};assert.equal((await f.fetch('/api/yixiaoxiu/media/uploads',{method:'POST',headers:f.headers(id),body:JSON.stringify(input)})).status,201);
 const upload=await f.fetch('/api/yixiaoxiu/media/uploads/'+MEDIA+'/content',{method:'PUT',headers:{...f.headers(id),'content-type':'image/png'},body:BYTES});assert.equal(upload.status,200);assert.deepEqual(f.control.lastBody,BYTES);assert.equal(f.control.lastScope,'a'.repeat(64));
 assert.equal((await f.fetch('/api/yixiaoxiu/media/uploads/'+MEDIA+'/wecom',{method:'POST',headers:f.headers(id),body:JSON.stringify({server_id:'H5_HTTP_SYNTHETIC_SERVER_ID'})})).status,200);
 assert.equal((await f.fetch('/api/yixiaoxiu/media/uploads/'+MEDIA,{method:'DELETE',headers:f.headers(id)})).status,200);assert.deepEqual([f.control.reserved,f.control.uploaded,f.control.imported,f.control.cancelled],[1,1,1,1]);
 assert.equal((await f.fetch('/api/yixiaoxiu/media/uploads/'+MEDIA+'/content',{method:'PUT',headers:{...f.headers(),'content-type':'image/png'},body:BYTES})).status,400);
}));

test('H5 real HTTP SDK signature is scoped by CSRF and final member recheck without a command UUID',{timeout:15000},async()=>fixture(async f=>{
 const body=JSON.stringify({url:f.origin+'/wecom/yixiaoxiu/',kind:'CORP'});const good=await f.fetch('/api/yixiaoxiu/js-sdk/signature',{method:'POST',headers:f.headers(),body});assert.equal(good.status,200);const signed=await json(good);assert.equal(signed.corpId,'ww-h5-http-synthetic');assert.equal(signed.agentId,'1000002');assert.equal(f.control.signatureCalls,1);
 assert.equal((await f.fetch('/api/yixiaoxiu/js-sdk/signature',{method:'POST',headers:{...f.headers(),'x-csrf-token':'bad'},body})).status,403);assert.equal(f.control.signatureCalls,1);
 assert.equal((await f.fetch('/api/yixiaoxiu/js-sdk/signature',{method:'POST',headers:f.headers(),body:JSON.stringify({url:f.origin+'/wecom/yixiaoxiu/',kind:['AGENT']})})).status,400);
 f.control.afterSign=()=>{f.control.recheckFailure='UNAVAILABLE';};assert.equal((await f.fetch('/api/yixiaoxiu/js-sdk/signature',{method:'POST',headers:f.headers(),body})).status,503);
}));

test('H5 real HTTP retains member Provider 503 and returns a closed sanitized error body',{timeout:15000},async()=>fixture(async f=>{
 for(const failure of ['UNAVAILABLE','UNSAFE'] as const){f.control.authFailure=failure;const r=await f.fetch('/api/yixiaoxiu/requests/'+REF+'/media/'+MEDIA);assert.equal(r.status,503);const text=await r.text();assert.equal(text.includes('H5_HTTP_LEAK_CANARY'),false);const body=record(JSON.parse(text)),error=record(body.error);assert.deepEqual(Object.keys(body),['error']);assert.deepEqual(Object.keys(error).sort(),['code','retryable']);assert.equal(error.retryable,true);assert.equal(r.headers.get('cache-control'),'no-store');}
 f.control.authFailure='DENIED';assert.equal((await f.fetch('/api/yixiaoxiu/requests/'+REF+'/media/'+MEDIA)).status,403);
}));

test('H5 real HTTP preserves explicit member rejection and temporary qualification failure for new writes',{timeout:15000},async()=>fixture(async f=>{
 for(const [failure,status] of [['DENIED',403],['UNAVAILABLE',503]] as const){f.control.authFailure=failure;const input=v2Input();const response=await f.fetch('/api/yixiaoxiu/requests',{method:'POST',headers:f.headers(input.client_command_id),body:JSON.stringify(input)});assert.equal(response.status,status);assert.equal(record((await json(response)).error).retryable,status===503);}
 assert.equal(f.control.accepts,0);f.control.authFailure='NONE';f.control.recheckFailure='UNAVAILABLE';const input=v2Input();assert.equal((await f.fetch('/api/yixiaoxiu/requests',{method:'POST',headers:f.headers(input.client_command_id),body:JSON.stringify(input)})).status,503);assert.equal(f.control.accepts,0);
}));

test('H5 real HTTP reads only the passed member/request scope and closes media leases/listeners',{timeout:15000},async()=>fixture(async f=>{
 const path='/api/yixiaoxiu/requests/'+REF+'/media/'+MEDIA;const success=await f.fetch(path);assert.equal(success.status,200);assert.equal(success.headers.get('content-type'),'image/png');assert.equal(success.headers.get('cache-control'),'no-store');assert.deepEqual(Buffer.from(await success.arrayBuffer()),BYTES);assert.equal(f.control.readClosed,1);
 const forbidden=await f.fetch('/api/yixiaoxiu/requests/'+OTHER_REF+'/media/'+MEDIA);assert.equal(forbidden.status,404);await forbidden.text();
 f.control.stream='REJECT_OPEN';const rejected=await f.fetch(path);assert.equal(rejected.status,404);await rejected.text();
 assert.equal(f.control.readOpened,1);for(const entry of f.control.completed.filter(value=>value.path.endsWith('/media/'+MEDIA)))assert.deepEqual([entry.requestAbortedListeners,entry.responseCloseListeners],[0,0]);
}));

test('H5 real HTTP stops before a later media chunk after current READ is denied and always closes the lease',{timeout:15000},async()=>fixture(async f=>{
 f.control.stream='DENY_SECOND';const response=await f.fetch('/api/yixiaoxiu/requests/'+REF+'/media/'+MEDIA);assert.equal(response.status,200);assert.ok(response.body);const reader=response.body.getReader();assert.equal(new TextDecoder().decode((await reader.read()).value),'first');f.control.recheckFailure='DENIED';f.control.releaseStream();await assert.rejects(reader.read());reader.releaseLock();assert.equal(f.control.readChunks,1);assert.equal(f.control.readClosed,1);
}));

test('H5 real HTTP releases the owned media lease when the browser cancels a stream',{timeout:15000},async()=>fixture(async f=>{
 f.control.stream='WAIT_DISCONNECT';const closed=new Promise<void>(resolve=>{f.control.afterClose=resolve;});
 const response=await f.fetch('/api/yixiaoxiu/requests/'+REF+'/media/'+MEDIA);assert.ok(response.body);const reader=response.body.getReader();assert.equal(new TextDecoder().decode((await reader.read()).value),'first');await reader.cancel();reader.releaseLock();await closed;assert.equal(f.control.readClosed,1);
}));
