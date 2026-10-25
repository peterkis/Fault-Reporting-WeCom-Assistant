import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {Agent,createServer,request as httpRequest,type IncomingMessage} from 'node:http';
import {join} from 'node:path';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {withP2015IsolatedDatabase} from './helpers/p2-015-postgres-harness.mjs';
import {testRoots} from './helpers/migration-roots.mjs';
import {createYxxSelfServiceStore} from '../app/server/src/yxx-self-service-store.mjs';
import {createYxxSelfServiceOrchestrator} from '../app/server/src/yxx-self-service-orchestrator.mjs';
import {createYxxSelfServiceQuery} from '../app/server/src/yxx-self-service-query.mjs';
import {createYxxSelfServiceAuthorization,type YxxMemberScope} from '../app/server/src/yxx-self-service-authorization.mjs';
import {createYxxH5Profile} from '../app/server/src/yxx-h5-v2-profile.mjs';
import {createThirdPartyStaffDirectoryStore} from '../app/server/src/p2-007-staff-directory-store.mjs';
import {getH5ReadBatchContext,getH5ReadBatchTiming,getH5ReadParticipantId,createH5ReadBatch} from '../app/server/src/yxx-h5-read-batch.mjs';
import type {H5EntryResponse} from '../contracts/yxx_h5_entry_contracts.js';
import type {YxxSelfServiceBootstrap} from '../contracts/yxx_self_service_contracts.js';
import type {PostgresPool,PostgresPoolClient} from '../app/server/src/platform/postgres-pool.mjs';

const secret='synthetic-h5-read-batch-integration-secret-over-thirty-two-bytes';
const flags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
const bootstrap:YxxSelfServiceBootstrap={authenticated:true,identity_mode:'MEMBER_SELF_SERVICE',read_only:false,can_submit:true,can_supplement:true,csrf_token:'synthetic-batch-csrf',recovery_scope:'synthetic-batch-recovery'};
const requestAssociation=new AsyncLocalStorage<IncomingMessage>();
function memberScope():YxxMemberScope{return {scopeHash:createHash('sha256').update(randomUUID()).digest('hex') as YxxMemberScope['scopeHash'],sourceCorpScope:'synthetic-batch-corp',sourceAppScope:'synthetic-batch-app',proofRef:'synthetic-h5-batch-proof'};}
function auth(scope:YxxMemberScope){return {profile:'MEMBER_SELF_SERVICE',flags,write_flag:true,csrf_token:bootstrap.csrf_token,canonical_reporter_binding:scope.scopeHash,source_corp_scope:scope.sourceCorpScope,source_app_scope:scope.sourceAppScope,proof_ref:scope.proofRef};}
function gate(){let release=()=>{};const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}
async function until(check:()=>boolean|Promise<boolean>,message:string,maximumMs=4500){const deadline=performance.now()+maximumMs;while(!await check()){assert.ok(performance.now()<deadline,message);await new Promise<void>(resolve=>setTimeout(resolve,10));}}
async function within<T>(promise:Promise<T>,maximumMs:number,message:string){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([promise,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error(message)),maximumMs);})]);}finally{if(timer)clearTimeout(timer);}}
function errorCode(error:unknown){return error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'&&/^[A-Z0-9_]+$/u.test(error.code)?error.code:'UNCLASSIFIED';}

interface SqlObservation {text:string;sha256:string;participants:readonly string[];phase:'direct'|'control'|'shared';started:number;ended?:number;code?:string;pid:number|null}
/** Decorate the actual pg instances. A Proxy would violate ARCH-005 parameters. */
function observeNativeQueries(pool:PostgresPool){
 const statements:SqlObservation[]=[],native=new Map<PostgresPoolClient,PropertyDescriptor|undefined>(),connect=pool.connect,descriptor=Object.getOwnPropertyDescriptor(pool,'connect');
 function wrap(value:unknown){
  assert.ok(value&&typeof value==='object'&&'query' in value&&typeof value.query==='function'&&'release' in value&&typeof value.release==='function');
  const client=value as PostgresPoolClient;if(native.has(client))return client;native.set(client,Object.getOwnPropertyDescriptor(client,'query'));const query=client.query;
  const observed=function(...args:unknown[]){
   const context=getH5ReadBatchContext(),request=requestAssociation.getStore(),id=request?getH5ReadParticipantId(request):undefined;
   const participants=context?.participants??(id?[id]:[]),text=typeof args[0]==='string'?args[0]:null,pid:unknown=Reflect.get(client,'processID');
   const observation:SqlObservation|null=text&&participants.length?{text,sha256:createHash('sha256').update(text).digest('hex'),participants:Object.freeze([...participants]),phase:context?.phase??'direct',started:performance.now(),pid:typeof pid==='number'?pid:null}:null;
   if(observation)statements.push(observation);
   const result:unknown=Reflect.apply(query,client,args);
   if(!(result instanceof Promise)||!observation)return result;
   return result.then(value=>{observation.ended=performance.now();return value;},(error:unknown)=>{observation.ended=performance.now();observation.code=errorCode(error);throw error;});
  };
  if(Object.getOwnPropertyDescriptor(query,'__arch005Guarded')?.value===true)Object.defineProperty(observed,'__arch005Guarded',{value:true});
  Object.defineProperty(client,'query',{value:observed,writable:true,configurable:true});return client;
 }
 Object.defineProperty(pool,'connect',{configurable:true,writable:true,value:function(...args:unknown[]):unknown{
  const callback=args[0];if(typeof callback==='function')return Reflect.apply(connect,pool,[function(this:unknown,...received:unknown[]){if(received[1])received[1]=wrap(received[1]);return Reflect.apply(callback,this,received);},...args.slice(1)]);
  const result:unknown=Reflect.apply(connect,pool,args);return result instanceof Promise?result.then(wrap):result;
 }});
 return {statements,restore(){if(descriptor)Object.defineProperty(pool,'connect',descriptor);else Reflect.deleteProperty(pool,'connect');for(const [client,prior] of native)if(prior)Object.defineProperty(client,'query',prior);else Reflect.deleteProperty(client,'query');}};
}

interface HttpResult {status:number;body:string;code?:string}
async function service(pool:PostgresPool,store:ReturnType<typeof createYxxSelfServiceStore>,profile:ReturnType<typeof createYxxH5Profile>,onRecheck?:(request:IncomingMessage)=>Promise<void>){
 const scopes=new WeakMap<IncomingMessage,YxxMemberScope>(),routes=new Map<string,{scope:YxxMemberScope;view:'home'|'department'}>(),requests=new Map<string,IncomingMessage>(),responses=new Map<string,H5EntryResponse>(),handlers=new Set<Promise<void>>(),authenticateCount=new WeakMap<IncomingMessage,number>();
 const authorization=createYxxSelfServiceAuthorization({profile:'MEMBER_SELF_SERVICE',flags,authenticate:async request=>{authenticateCount.set(request,(authenticateCount.get(request)??0)+1);const scope=scopes.get(request);assert.ok(scope);return auth(scope);},recheck:Object.assign(async(request:IncomingMessage)=>{await onRecheck?.(request);const scope=scopes.get(request);assert.ok(scope);return auth(scope);},{localOnly:true as const})});
 const query=createYxxSelfServiceQuery({pool,authorization,store,scopeSecret:secret,h5Profile:profile}),agent=new Agent({keepAlive:true,maxSockets:24});
 const server=createServer((request,response)=>{
  const id=request.url?.slice(1)??'',route=routes.get(id);if(!route){response.writeHead(404).end();return;}requests.set(id,request);scopes.set(request,route.scope);
  const pending=requestAssociation.run(request,async()=>{
   try{const result=await query.h5Entry({request,input:{view:route.view},bootstrap});responses.set(id,result);if(!response.destroyed)response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(result));}
   catch(error){if(!response.destroyed){const status=error&&typeof error==='object'&&'status' in error&&typeof error.status==='number'?error.status:503;response.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify({code:errorCode(error)}));}}
  });handlers.add(pending);void pending.finally(()=>handlers.delete(pending)).catch(()=>undefined);
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const port=address.port;
 function start(scope:YxxMemberScope,view:'home'|'department'='home'){
  const id=randomUUID();routes.set(id,{scope,view});let disconnect=()=>{};
  const result=new Promise<HttpResult>(resolve=>{
   const outgoing=httpRequest({hostname:'127.0.0.1',port,path:'/'+id,agent,headers:{Cookie:'synthetic_cookie_canary_must_not_enter_batch_context'}},response=>{let body='';response.setEncoding('utf8');response.on('data',(part:string)=>{body+=part;});response.on('end',()=>resolve({status:response.statusCode??0,body}));response.on('error',(error:unknown)=>resolve({status:0,body:'',code:errorCode(error)}));});
   outgoing.once('error',(error:unknown)=>resolve({status:0,body:'',code:errorCode(error)}));disconnect=()=>outgoing.destroy();outgoing.end();
  });
  return {id,result,disconnect:()=>disconnect(),request:()=>requests.get(id)};
 }
 return {query,start,requests,responses,authenticateCount,async close(){await query.closeH5Reads();await Promise.allSettled([...handlers]);agent.destroy();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}
type Service=Awaited<ReturnType<typeof service>>;
type Read=ReturnType<Service['start']>;
function requestOf(read:Read){const request=read.request();assert.ok(request);return request;}
function participantOf(read:Read){const id=getH5ReadParticipantId(requestOf(read));assert.ok(id);return id;}
const business=(statement:SqlObservation)=>/^\s*(SELECT|WITH)\b/iu.test(statement.text);
const shared=(statements:SqlObservation[])=>statements.filter(statement=>statement.phase==='shared'&&business(statement));
const safeStatements=(statements:readonly SqlObservation[])=>statements.map(statement=>({sha256:statement.sha256,phase:statement.phase,participants:statement.participants,pid:statement.pid,started_at_ms:statement.started,ended_at_ms:statement.ended,error_code:statement.code}));
async function lockBindings(pool:PostgresPool){const client=await pool.connect();await client.query('BEGIN');await client.query('LOCK TABLE intake.web_request_binding IN ACCESS EXCLUSIVE MODE');return client;}
async function blockedBatch(holder:PostgresPoolClient){
 await holder.query('SELECT pg_catalog.pg_stat_clear_snapshot()');
 return (await holder.query<{pid:number;blockers:number[];relation_waiting:boolean}>(`SELECT a.pid,pg_catalog.pg_blocking_pids(a.pid) AS blockers,
  EXISTS(SELECT 1 FROM pg_catalog.pg_locks l WHERE l.pid=a.pid AND l.locktype='relation' AND l.relation='intake.web_request_binding'::pg_catalog.regclass AND l.mode='AccessShareLock' AND NOT l.granted) AS relation_waiting
  FROM pg_catalog.pg_stat_activity a WHERE a.datname=pg_catalog.current_database() AND a.pid<>pg_catalog.pg_backend_pid()
   AND a.state='active' AND a.wait_event_type='Lock' AND a.query LIKE 'WITH batch_input AS MATERIALIZED (%'`)).rows;
}

test('bounded H5 read batches use real PostgreSQL leases, native HTTP cancellation and fresh per-member terminal reads',{timeout:240000},async t=>{
 const databaseUrl=process.env.PILOT_DATABASE_URL;assert.ok(databaseUrl,'owned PostgreSQL 18 is required');assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(databaseUrl).hostname));
 await withP2015IsolatedDatabase({databaseUrl,purpose:'h5readbatch',max:4,run:async({pool}:{pool:PostgresPool})=>{
  assert.ok(Number((await pool.query<{server_version_num:string}>('SHOW server_version_num')).rows[0]?.server_version_num)>=180000);
  const migrations=join(testRoots().sourceRoot,'database/migrations');for(const file of (await readdir(migrations)).filter(name=>/^\d{3}_.+\.sql$/u.test(name)&&Number(name.slice(0,3))<=66).sort())await pool.query(await readFile(join(migrations,file),'utf8'));
  const a=memberScope(),b=memberScope(),store=createYxxSelfServiceStore({pool,scopeSecret:secret,h5Enabled:true}),profile=createYxxH5Profile({pool,scopeSecret:secret,enabled:true}),directory=createThirdPartyStaffDirectoryStore({pool}),version='b'.repeat(64);
  const orchestrator=createYxxSelfServiceOrchestrator({pool,profile:'MEMBER_SELF_SERVICE',featureFlags:flags,ruleEngine:{evaluate(){throw new Error('DECLARED_INTENT_MUST_NOT_CALL_RULE_ENGINE');}}});
  const ownedRefs=new Map<YxxMemberScope,string[]>();
  for(const [index,scope] of [a,b].entries()){
   const refs:string[]=[];for(let ordinal=0;ordinal<11;ordinal++){const accepted=await store.accept({scope,input:{schema_version:2,client_command_id:randomUUID(),intent:'FAULT',description:'SYNTHETIC_OWNER_'+String(index)+'_REPORT_'+String(ordinal),location:{text:null,unknown:true},media_refs:[]}});refs.push(accepted.receipt.request_ref);assert.equal((await orchestrator.processOne({requestRef:accepted.receipt.request_ref})).processed,true);}ownedRefs.set(scope,refs);
  }
  const members=[{provider_user_id:'batch-provider-a',employee_id:'BATCH-A',nickname:'synthetic a',phone:null,provider_wecom_id:null},{provider_user_id:'batch-provider-b',employee_id:'BATCH-B',nickname:'synthetic b',phone:null,provider_wecom_id:null}];
  await directory.publishSnapshot({source_scope:'FORMAL',root_ref:'synthetic-h5-batch-root',snapshot:{snapshot_version:version,departments:[{provider_department_id:'batch-department',parent_provider_department_id:null,name:'synthetic batch department',provider_gid:null,provider_gid_type:null,depth:0}],members,memberships:members.map(member=>({provider_user_id:member.provider_user_id,provider_department_id:'batch-department'})),protocol_warnings:[],counts:{departments:1,members:2,memberships:2,max_depth:0}}});
  for(const [index,scope] of [a,b].entries()){const member=members[index];assert.ok(member);const current=await directory.findMemberByProviderUserId({source_scope:'FORMAL',provider_user_id:member.provider_user_id});assert.ok(current);await directory.saveResolvedProfile({source_scope:'FORMAL',reporter_identity_hash:scope.scopeHash,source_namespace:'WECOM_APP_OPENID',resolution_method:'SYNTHETIC_VERIFIED_UID',member:current,profile:{provider_user_id:member.provider_user_id,employee_id:member.employee_id,display_name:member.nickname,phone:null,sex:null,avatar_url:null}});}
  await pool.query("UPDATE directory.member_current SET account_status='ACTIVE'");
  const observed=observeNativeQueries(pool);
  try{
   await t.test('normal keep-alive GET closes its input without cancellation; cursors remain bound to the individual member',async()=>{
    const app=await service(pool,store,profile);try{
     const homeRead=app.start(a),homeHttp=await homeRead.result;assert.equal(homeHttp.status,200);const home=app.responses.get(homeRead.id);assert.ok(home?.view==='home');assert.equal(home.data.recent_reports.length,3);assert.ok(home.data.recent_reports.every(item=>ownedRefs.get(a)?.includes(item.ref)));assert.equal(home.data.department_summary?.total,22);
     const first=app.start(a,'department'),second=app.start(b,'department');assert.equal((await first.result).status,200);assert.equal((await second.result).status,200);
     const left=app.responses.get(first.id),right=app.responses.get(second.id);assert.ok(left?.view==='department'&&right?.view==='department');assert.deepEqual(left.data.department.items,right.data.department.items);assert.equal(left.data.department.total,22);assert.equal(left.data.department.items.length,20);assert.ok(left.data.department.next_cursor&&right.data.department.next_cursor);assert.notEqual(left.data.department.next_cursor,right.data.department.next_cursor);
     for(const read of [homeRead,first,second]){assert.equal(getH5ReadBatchTiming(requestOf(read))?.outcome,'committed');assert.equal(app.authenticateCount.get(requestOf(read)),1);const logical=observed.statements.filter(statement=>statement.participants.includes(participantOf(read))&&business(statement));assert.equal(logical.filter(statement=>statement.phase==='shared').length,1);assert.equal(logical.filter(statement=>statement.phase==='direct').length,2);}
     t.diagnostic(JSON.stringify({phase:'H5_READ_HTTP_AUTHENTICATION',participants:[homeRead,first,second].map(read=>({participant_id:participantOf(read),entry_authenticate_calls:app.authenticateCount.get(requestOf(read))}))}));
     const priorAuth=app.authenticateCount.get(requestOf(second));assert.equal(priorAuth,1);
     await assert.rejects(app.query.department({request:requestOf(second),cursor:left.data.department.next_cursor}),{code:'YXX_CURSOR_INVALID'});
     assert.equal(app.authenticateCount.get(requestOf(second)),priorAuth+1,'an additional, independent legacy Port call performs its own READ authentication');
    }finally{await app.close();}
   });

   await t.test('one active batch seals immediately; late arrivals form the next batch and every slot keeps its own preview',async()=>{
    const app=await service(pool,store,profile),holder=await lockBindings(pool),from=observed.statements.length;let locked=true;
    try{
     const first=app.start(a);await until(async()=>(await blockedBatch(holder)).some(row=>row.relation_waiting),'first shared SQL must wait for the actual WB relation lock');
     const second=app.start(b),third=app.start(a);await until(()=>[second,third].every(read=>{const request=read.request();return request!==undefined&&getH5ReadBatchTiming(request)?.queued_at_ms!==undefined;}),'late members must finish and release their initial transaction before queueing');
     assert.equal(shared(observed.statements.slice(from)).length,1);assert.equal(shared(observed.statements.slice(from))[0]?.participants.length,1);
     await holder.query('COMMIT');locked=false;for(const read of [first,second,third])assert.equal((await read.result).status,200);
     const physical=shared(observed.statements.slice(from));assert.equal(physical.length,2);assert.deepEqual(physical.map(statement=>statement.participants.length),[1,2]);
     t.diagnostic(JSON.stringify({phase:'H5_READ_SEALED_FIFO',physical_statements:safeStatements(physical)}));
     for(const [read,scope] of [[first,a],[second,b],[third,a]] as const){const body=app.responses.get(read.id);assert.ok(body?.view==='home');assert.ok(body.data.recent_reports.every(item=>ownedRefs.get(scope)?.includes(item.ref)));const timing=getH5ReadBatchTiming(requestOf(read));assert.ok(timing?.queued_at_ms!==undefined&&timing.sealed_at_ms!==undefined&&timing.terminal_started_at_ms!==undefined);assert.ok(timing.received_at_ms<=timing.queued_at_ms&&timing.queued_at_ms<=timing.sealed_at_ms);assert.equal(observed.statements.filter(statement=>business(statement)&&statement.participants.includes(participantOf(read))).length,3);}
     const cross={...a,sourceCorpScope:'synthetic-different-corp',sourceAppScope:'synthetic-different-app'},isolated=app.start(cross);assert.equal((await isolated.result).status,200);const isolatedBody=app.responses.get(isolated.id);assert.ok(isolatedBody?.view==='home');assert.deepEqual(isolatedBody.data.recent_reports,[]);assert.equal(isolatedBody.data.department_summary?.total,0);
    }finally{if(locked)await holder.query('ROLLBACK');holder.release();await app.close();}
   });

   await t.test('a disconnected first batch really drains; an older next-slot deadline cannot cancel its younger peer',async()=>{
    const app=await service(pool,store,profile),holder=await lockBindings(pool),from=observed.statements.length;let locked=true;
    try{
     const first=app.start(a);await until(async()=>(await blockedBatch(holder)).some(row=>row.relation_waiting),'first batch must have a server-side lock wait');
     // Deliberately stagger genuine arrival deadlines; these waits create the
     // timeout boundary under test, not an observation substitute.
     await holder.query('SELECT pg_catalog.pg_sleep(0.4)');const older=app.start(a);
     await until(()=>{const request=older.request();return request!==undefined&&getH5ReadBatchTiming(request)?.queued_at_ms!==undefined;},'older participant must be queued');
     await holder.query('SELECT pg_catalog.pg_sleep(0.7)');const younger=app.start(b);
     await until(()=>{const request=younger.request();return request!==undefined&&getH5ReadBatchTiming(request)?.queued_at_ms!==undefined;},'younger participant must be queued');
     first.disconnect();assert.equal((await first.result).status,0);
     await until(()=>getH5ReadBatchTiming(requestOf(first))?.outcome==='cancelled','real socket close must cancel first delivery');
     assert.equal(shared(observed.statements.slice(from)).length,1,'delivery cancellation must not release the server execution slot');const firstLock=await blockedBatch(holder);assert.ok(firstLock.some(row=>row.relation_waiting));
     t.diagnostic(JSON.stringify({phase:'H5_READ_DISCONNECTED_DELIVERY_SERVER_DRAINING',locks:firstLock,physical_statements:safeStatements(shared(observed.statements.slice(from)))}));
     await until(()=>shared(observed.statements.slice(from)).length===2,'next batch starts only after the first real statement timeout and rollback',6000);
     const phases=shared(observed.statements.slice(from)),firstSql=phases[0],nextSql=phases[1];assert.ok(firstSql&&nextSql);assert.equal(firstSql.code,'57014');assert.equal(nextSql.participants.length,2);
     const rollback=observed.statements.slice(from).find(statement=>statement.phase==='control'&&statement.text==='ROLLBACK'&&statement.participants.includes(participantOf(first)));assert.ok(rollback?.ended!==undefined);assert.ok(nextSql.started>=rollback.ended,'a locally rejected HTTP promise is never treated as a server acknowledgement');
     const expired=await within(older.result,2500,'older HTTP must reach its original five-second deadline');assert.equal(expired.status,503);assert.ok(expired.body.includes('YXX_READ_TIMEOUT'));
     assert.equal(nextSql.ended,undefined,'younger peer still owns the already started SQL');const youngerLock=await blockedBatch(holder);assert.ok(youngerLock.some(row=>row.relation_waiting));
     t.diagnostic(JSON.stringify({phase:'H5_READ_OLDER_DEADLINE_YOUNGER_STILL_READING',locks:youngerLock,older_timing:getH5ReadBatchTiming(requestOf(older)),younger_timing:getH5ReadBatchTiming(requestOf(younger)),previous_rollback:safeStatements([rollback]),physical_statements:safeStatements(phases)}));
     await holder.query('COMMIT');locked=false;assert.equal((await younger.result).status,200);assert.equal(getH5ReadBatchTiming(requestOf(younger))?.outcome,'committed');
    }finally{if(locked)await holder.query('ROLLBACK');holder.release();await app.close();}
   });

   await t.test('host close rejects deliveries but waits for real server timeout and rollback before returning',async()=>{
    const app=await service(pool,store,profile),holder=await lockBindings(pool),from=observed.statements.length;let locked=true;
    try{
     const first=app.start(a);await until(async()=>(await blockedBatch(holder)).some(row=>row.relation_waiting),'closing case must start real locked SQL');
     const next=app.start(b);await until(()=>{const request=next.request();return request!==undefined&&getH5ReadBatchTiming(request)?.queued_at_ms!==undefined;},'second request must queue without holding a connection');
     let closed=false;const close=app.query.closeH5Reads().then(()=>{closed=true;});
     assert.equal((await first.result).status,503);assert.equal((await next.result).status,503);const closingLocks=await blockedBatch(holder);assert.ok(closingLocks.some(row=>row.relation_waiting));assert.equal(closed,false,'shutdown is still draining the actual server query');
     t.diagnostic(JSON.stringify({phase:'H5_READ_CLOSE_WAITING_FOR_SERVER',close_completed:closed,locks:closingLocks,physical_statements:safeStatements(shared(observed.statements.slice(from)))}));
     await within(close,6500,'shared native statement_timeout bounds shutdown drain');
     const statements=observed.statements.slice(from),physical=shared(statements);assert.equal(physical.length,1,'closed queued work never dispatches');assert.equal(physical[0]?.code,'57014');assert.ok(statements.some(statement=>statement.phase==='control'&&statement.text==='ROLLBACK'&&statement.ended!==undefined));assert.deepEqual(await blockedBatch(holder),[]);assert.equal(pool.waitingCount,0);
     t.diagnostic(JSON.stringify({phase:'H5_READ_CLOSE_SERVER_ACKNOWLEDGED',close_completed:closed,pool_waiting:pool.waitingCount,physical_statements:safeStatements(statements.filter(statement=>statement.phase!=='direct'))}));
     await holder.query('COMMIT');locked=false;
    }finally{if(locked)await holder.query('ROLLBACK');holder.release();await app.close();}
   });

   await t.test('an aborted late initial checkout is retained until it settles and is discarded without starting SQL',async()=>{
    const app=await service(pool,store,profile),held:PostgresPoolClient[]=[],from=observed.statements.length;const removed:PostgresPoolClient[]=[],removedAt=new WeakMap<PostgresPoolClient,number>();const onRemove=(client:PostgresPoolClient)=>{removed.push(client);removedAt.set(client,performance.now());};pool.on('remove',onRemove);
    try{
     for(let index=0;index<4;index++)held.push(await pool.connect());const read=app.start(a);await until(()=>pool.waitingCount===1,'initial transaction must really be waiting for the original bounded pool');read.disconnect();assert.equal((await read.result).status,0);await until(()=>getH5ReadBatchTiming(requestOf(read))?.outcome==='cancelled','delivery rejects while native checkout remains pending');
     let closed=false;const close=app.query.closeH5Reads().then(()=>{closed=true;});await nextTurn();assert.equal(closed,false);assert.equal(pool.waitingCount,1);
     const late=held.pop();assert.ok(late);const releasedAt=performance.now();late.release();await within(close,1500,'late native checkout settles and releases its admission');const closeReturnedAt=performance.now();
     t.diagnostic(JSON.stringify({phase:'H5_READ_LATE_UNUSED_CLIENT_REMOVAL',participant_id:participantOf(read),released_at_ms:releasedAt,removed_at_ms:removedAt.get(late),close_returned_at_ms:closeReturnedAt,removal_observed:removed.includes(late),pool_waiting:pool.waitingCount,physical_statements:safeStatements(observed.statements.slice(from).filter(statement=>statement.participants.includes(participantOf(read))))}));
     assert.ok(removed.includes(late),'unused late native connection is destroyed rather than reused with cancelled work');assert.equal(observed.statements.slice(from).filter(statement=>statement.participants.includes(participantOf(read))).length,0);assert.equal(pool.waitingCount,0);
    }finally{for(const client of held)client.release();pool.removeListener('remove',onRemove);await app.close();}
   });

   await t.test('twenty admitted initial requests include pending pool leases and the next HTTP is explicitly rejected',async()=>{
    const app=await service(pool,store,profile),holder=await pool.connect();let locked=false;const reads:Read[]=[];
    try{
     await holder.query('BEGIN');locked=true;await holder.query('LOCK TABLE directory.member_current IN ACCESS EXCLUSIVE MODE');for(let index=0;index<20;index++)reads.push(app.start(index%2?a:b));
     await until(()=>pool.waitingCount===17,'three real initial transactions plus seventeen pending native leases must consume all twenty admissions');const overflow=app.start(a);assert.equal((await overflow.result).status,429);assert.equal(getH5ReadBatchTiming(requestOf(overflow))?.queued_at_ms,undefined);
     t.diagnostic(JSON.stringify({phase:'H5_READ_INITIAL_ADMISSION_BOUND',admitted_participants:reads.map(participantOf),pool_waiting:pool.waitingCount,overflow_status:429}));
     await holder.query('COMMIT');locked=false;for(const read of reads)assert.equal((await read.result).status,200);assert.equal(pool.waitingCount,0);
    }finally{if(locked)await holder.query('ROLLBACK');holder.release();await app.close();}
   });

   await t.test('socket cancellation during the outer READ recheck cannot become a committed result',async()=>{
    const entered=gate(),release=gate();let targetId:string|undefined;const app=await service(pool,store,profile,async request=>{if(request.url==='/'+targetId){entered.release();await release.promise;}});
    try{
     const read=app.start(a);targetId=read.id;
     await within(entered.promise,3000,'fresh terminal query must finish before the deliberately held outer local READ recheck');
     const peer=app.start(b);assert.equal((await peer.result).status,200,'other members do not wait for a completed batch or another outer recheck');read.disconnect();assert.equal((await read.result).status,0);release.release();await until(()=>getH5ReadBatchTiming(requestOf(read))?.closed_at_ms!==undefined,'outer completion must observe the aborted budget');assert.equal(getH5ReadBatchTiming(requestOf(read))?.outcome,'cancelled');assert.equal(app.responses.has(read.id),false);
     t.diagnostic(JSON.stringify({phase:'H5_READ_OUTER_RECHECK_ABORT',participant_id:participantOf(read),timing:getH5ReadBatchTiming(requestOf(read)),peer_participant_id:participantOf(peer),peer_timing:getH5ReadBatchTiming(requestOf(peer))}));
    }finally{release.release();await app.close();}
   });

   await t.test('native transaction callbacks cannot send another business statement after their first server acknowledgement follows cancellation',async()=>{
    const manager=createH5ReadBatch({pool}),holder=await lockBindings(pool),app=await service(pool,store,profile);let locked=true;
    try{
     const normal=app.start(a);await until(async()=>(await blockedBatch(holder)).some(row=>row.relation_waiting),'real native HTTP provides the budget and transport');
     const request=requestOf(normal),budget=manager.open(request);let second=false;
     const read=requestAssociation.run(request,()=>manager.transaction(budget,async tx=>{await tx.query('SELECT 1 FROM intake.web_request_binding LIMIT 1');second=true;await tx.query('SELECT 2 AS must_not_start');}));void read.catch(()=>undefined);
     await until(async()=>{await holder.query('SELECT pg_catalog.pg_stat_clear_snapshot()');return (await holder.query<{count:number}>("SELECT count(*)::integer AS count FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT 1 FROM intake.web_request_binding%'")).rows[0]?.count===1;},'first native callback statement must really wait on the relation lock');
     normal.disconnect();assert.equal((await normal.result).status,0);await assert.rejects(read,{code:'YXX_REQUEST_ABORTED'});await holder.query('COMMIT');locked=false;await manager.close();assert.equal(second,true,'the original SQL really returned after cancellation');
     // The flag above is set by the callback after the first acknowledgement;
     // tx.query still rejects before a second SQL can reach pg.
     assert.equal(observed.statements.some(statement=>statement.text==='SELECT 2 AS must_not_start'),false);
     t.diagnostic(JSON.stringify({phase:'H5_READ_NATIVE_CALLBACK_DRAIN',participant_id:participantOf(normal),late_first_acknowledgement:second,physical_statements:safeStatements(observed.statements.filter(statement=>statement.participants.includes(participantOf(normal))))}));
    }finally{if(locked)await holder.query('ROLLBACK');holder.release();await manager.close();await app.close();}
   });
  }finally{observed.restore();}
 }});
});
