import assert from 'node:assert/strict';
import {randomUUID,createHash,randomBytes} from 'node:crypto';
import {request as requestHttp} from 'node:http';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {withP2016IsolatedDatabase,applyThrough030} from './helpers/p2-016-postgres-harness.mjs';
import {seedPersistedIntake,seedCapacityDataset} from './helpers/p2-015-postgres-harness.mjs';
import {object,rows} from './helpers/t41-search-risk-fixture.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import type {P2016EnabledRuntime} from '../src/p2-016-runtime.mjs';
import {listenConversationWorkbenchServer} from '../src/p2-006-workbench-http.mjs';
import {createPilotTicketCore} from '../src/p1-005-pilot-ticket-core.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {createYxxSelfServiceAuthorization} from '../src/yxx-self-service-authorization.mjs';
import {createYxxSelfServiceStore} from '../src/yxx-self-service-store.mjs';
import {createYxxSelfServiceOrchestrator} from '../src/yxx-self-service-orchestrator.mjs';
import {assertLocalDateTime} from '../src/platform/time-contract.mjs';
import {migrateP2016} from '../scripts/p2-016-migrate.mjs';
import {migrateWorkbenchSupplementFollowUp} from '../scripts/workbench-supplement-follow-up-migrate.mjs';
import {migrateWorkbenchFollowUpSchedules} from '../scripts/workbench-follow-up-schedules-migrate.mjs';
import type {PostgresPool,PostgresPoolClient} from '../src/platform/postgres-pool.mjs';

function text(value:unknown):string{assert.ok(typeof value==='string');return value;}
type Reader='admin'|'staff'|'outsider';
interface Base {pool:PostgresPool;databaseUrl:string;origin:string;runtime:P2016EnabledRuntime;
 principals:{id:string;wecom_user_id:string;display_name:string}[];outsider:{id:string};
 tickets:{ticket:{id:string;ticket_no:string;status:string;version:number};intake:{intakeId:string}}[]}
interface SearchFixture extends Base {staffId:string;get(path:string,reader?:Reader):Promise<Response>;
 post(path:string,body:Readonly<Record<string,unknown>>,reader?:Reader):Promise<Response>}
function ownedHttp(url:string,headers:Record<string,string>,body?:string):Promise<Response>{
 return new Promise((resolve,reject)=>{const request=requestHttp(url,{method:body===undefined?'GET':'POST',headers,agent:false},response=>{
  const chunks:Buffer[]=[];response.on('data',(chunk:Buffer)=>chunks.push(chunk));response.once('error',reject);
  response.once('end',()=>resolve(new Response(Buffer.concat(chunks).toString('utf8'),{status:response.statusCode??500})));
 });request.setTimeout(15000,()=>request.destroy(new Error('T41_ACCEPTANCE_HTTP_TIMEOUT')));request.once('error',reject);request.end(body);});
}
async function json(response:Response,status=200){assert.equal(response.status,status,await response.clone().text());return object(await response.json());}
async function search(f:Pick<SearchFixture,'get'>,parameters:Record<string,string>,reader:Reader='staff'){
 const page=await json(await f.get('/api/workbench/search?'+new URLSearchParams(parameters),reader));
 assert.equal(Object.hasOwn(page,'total'),false);assert.equal(Object.hasOwn(page,'hidden_count'),false);assert.equal(Object.hasOwn(page,'matches'),false);
 return rows(page.items);
}
function only(items:Record<string,unknown>[],kind:string,id:string){assert.deepEqual(items.map(item=>[item.kind,item.id]),[[kind,id]]);}
async function withSearchFixture(run:(fixture:SearchFixture)=>Promise<void>,{states=false}:{states?:boolean}={}){
 return withWeb01Fixture(async(base:Base)=>{
  await base.runtime.stop();
  if(states){await migrateWorkbenchSupplementFollowUp({databaseUrl:base.databaseUrl,mode:'apply'});await migrateWorkbenchFollowUpSchedules({databaseUrl:base.databaseUrl,mode:'apply'});}
  const admin=base.principals[0],staff=base.principals[2];assert.ok(admin&&staff);
  const runtime=createP2016Runtime({pool:base.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:base.origin,
   listenPort:Number(new URL(base.origin).port),principalIds:[admin.id,staff.id,base.outsider.id],externalSendEnabled:false,
   workbenchSearchEnabled:true,workbenchManualReportsEnabled:true,workbenchManualReviewEnabled:true,workbenchFollowEnabled:true,
   workbenchConversationsEnabled:true,sourceGroupDirectoryEnabled:true,workbenchSupplementFollowUpEnabled:states,workbenchFollowUpSchedulesEnabled:states});
  try{
   const cookies=(await runtime.start()).cookies;assert.ok(cookies);const a=cookies[0],s=cookies[1],o=cookies[2];assert.ok(a&&s&&o);
   const entries={admin:a,staff:s,outsider:o},csrf:Record<Reader,string>={admin:'',staff:'',outsider:''};
   const get=(path:string,reader:Reader='staff')=>{const cookie=entries[reader];return ownedHttp(base.origin+path,{cookie:cookie.name+'='+cookie.value});};
   for(const reader of ['admin','staff','outsider'] as const)csrf[reader]=text((await json(await get('/api/lifecycle/bootstrap',reader))).csrf_token);
   const post=(path:string,body:Readonly<Record<string,unknown>>,reader:Reader='staff')=>{
    const cookie=entries[reader],version=body.expected_version??body.expected_row_version??body.expected_follow_version;
    return ownedHttp(base.origin+path,{cookie:cookie.name+'='+cookie.value,origin:base.origin,'content-type':'application/json',
     'idempotency-key':text(body.client_command_id),'x-csrf-token':csrf[reader],...(version===undefined?{}:{'if-match':'"'+String(version)+'"'})},JSON.stringify(body));
   };
   await run({...base,runtime,staffId:staff.id,get,post});
  }finally{await runtime.stop();assert.equal(runtime.server.listening,false);assert.equal((await runtime.observability.metrics()).sse_clients,0);
   assert.equal(await new Promise<number>((resolve,reject)=>runtime.server.getConnections((error,count)=>error?reject(error):resolve(count))),0);}
 },{manualProjection:true,chronologicalTicketEvents:true,workbenchManualReportsEnabled:true,workbenchManualReviewEnabled:true,workbenchFollowEnabled:true,sourceGroupDirectoryEnabled:true});
}
async function webReport(f:SearchFixture,description:string,location:string,department:string){
 const flags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
 const member={profile:'MEMBER_SELF_SERVICE',write_flag:true,flags,csrf_token:'t41-synthetic-member-csrf',
  canonical_reporter_binding:createHash('sha256').update(randomUUID()).digest('hex'),source_corp_scope:'t41-synthetic-corp',source_app_scope:'t41-synthetic-app',proof_ref:'tests/t41-synthetic-web'};
 const authorization=createYxxSelfServiceAuthorization<null>({profile:'MEMBER_SELF_SERVICE',flags,authenticate:async()=>member,recheck:Object.assign(async()=>member,{localOnly:true as const})});
 const store=createYxxSelfServiceStore({pool:f.pool,scopeSecret:'t41-local-only-web-source-secret'}),orchestrator=createYxxSelfServiceOrchestrator({pool:f.pool,profile:'MEMBER_SELF_SERVICE',featureFlags:flags});
 const initial=await authorization.read({request:null,operation:'WEB_COMMAND',source:'WEB',run:context=>store.accept({scope:context.scope,
  input:{schema_version:1,client_command_id:randomUUID(),description,location:{text:location,unknown:false},service_code:null,impact_scope:'SINGLE_WORKSTATION',reported_department_text:department,extension:null}})});
 const created=await orchestrator.processOne({requestRef:initial.receipt.request_ref});assert.equal(created.processed,true);assert.ok('ticket_id' in created&&created.ticket_id);assert.equal(created.result_code,'TICKET_ELIGIBLE');
 return {ticketId:created.ticket_id,supplement:async(expectedRevision:string,supplementText:string)=>{
  const accepted=await authorization.read({request:null,operation:'WEB_COMMAND',source:'WEB',run:context=>store.accept({scope:context.scope,kind:'SUPPLEMENT',requestRef:initial.receipt.request_ref,
   input:{schema_version:1,client_command_id:randomUUID(),expected_input_revision:expectedRevision,text:supplementText}})});
  const processed=await orchestrator.processOne({requestRef:initial.receipt.request_ref});assert.equal(processed.processed,true);assert.ok('ticket_id' in processed);assert.equal(processed.ticket_id,created.ticket_id);return accepted.receipt.accepted_revision;
 }};
}

test('T41 all five real source types and retained at-report fields are searchable before paging without directory reads',{timeout:240000},async()=>{
 await withSearchFixture(async f=>{
  const group=f.tickets[0];assert.ok(group);
  const journey=(await f.pool.query<{id:string}>('SELECT id::text FROM intake.contact_journey WHERE origin_intake_id=$1::uuid',[group.intake.intakeId])).rows[0];assert.ok(journey);
  await f.pool.query(`UPDATE intake.contact_journey SET profile_resolution_status='RESOLVED',profile_snapshot=$2::jsonb WHERE id=$1::uuid`,[journey.id,JSON.stringify({source:'WECOM_DIRECTORY',version:'T41_REPORT_TIME',contact:{name:'T41SnapshotName',mobile:'T41SnapshotMobile',telephone:'T41SnapshotTelephone'},memberships:[{name:'T41SnapshotDepartment'}]})]);
  const directIntake=await seedPersistedIntake({pool:f.pool,text:'T41_DIRECT_ORIGINAL 处方提交不了',chatType:'single',requestType:'INCIDENT',status:'RECEIVED'});
  const direct=await createPilotTicketCore({pool:f.pool}).createForIntake({intakeId:directIntake.intakeId,occurredAt:directIntake.receivedAt,traceId:'t41-direct-source'});assert.ok(direct.ticket);
  const web=await webReport(f,'T41_WEB_ORIGINAL 处方提交不了','T41WebLocation','T41WebDepartment');
  const manual=new Map<string,string>();
  for(const source of ['PHONE','ON_SITE'] as const){
   const result=await json(await f.post('/api/workbench/reports',{schema_version:1,client_command_id:randomUUID(),source,description:'T41_'+source+'_ORIGINAL 处方提交不了',location:{text:'T41'+source+'Location',unknown:false},reporter:{verification:'UNVERIFIED',name:'T41'+source+'Name',contact:'T41'+source+'Contact',department:'T41'+source+'Department'}},'admin'),202);
   assert.equal(result.reporter_verification,'UNVERIFIED');manual.set(source,text(object(result.ticket).id));
  }
  const examples=[['WECOM_GROUP','T41SnapshotName',group.ticket.id],['WECOM_DIRECT','T41_DIRECT_ORIGINAL',direct.ticket.id],['WEB_REQUEST','T41_WEB_ORIGINAL',web.ticketId],['MANUAL_PHONE','T41_PHONE_ORIGINAL',manual.get('PHONE')],['MANUAL_ON_SITE','T41_ON_SITE_ORIGINAL',manual.get('ON_SITE')]];
  for(const [source,q,id]of examples){assert.ok(source&&q&&id);only(await search(f,{sources:source,q,limit:'1'},'admin'),'ticket',id);}
  const item=object((await json(await f.get('/api/workbench/items/ticket/'+group.ticket.id,'admin'))).item);
  for(const q of [text(item.number),'门诊二楼打印机无法打印处方','门诊二楼 · 203 诊室','T41SnapshotName','T41SnapshotMobile','T41SnapshotTelephone','T41SnapshotDepartment'])
   only(await search(f,{q,sources:'WECOM_GROUP',limit:'1'},'admin'),'ticket',group.ticket.id);
  for(const q of ['T41PHONELocation','T41PHONEName','T41PHONEContact','T41PHONEDepartment'])only(await search(f,{q,sources:'MANUAL_PHONE'},'admin'),'ticket',text(manual.get('PHONE')));
  for(const q of ['T41WebLocation','T41WebDepartment'])only(await search(f,{q,sources:'WEB_REQUEST'},'admin'),'ticket',web.ticketId);
  await f.pool.query(`UPDATE intake.contact_journey SET retention_until_epoch_ms=platform.physical_epoch_ms()-1,retention_until=platform.local_from_epoch_ms(platform.physical_epoch_ms()-1) WHERE id=$1::uuid`,[journey.id]);
  assert.deepEqual(await search(f,{q:'T41SnapshotName'},'admin'),[]);
  assert.equal((await f.get('/api/workbench/items/ticket/'+group.ticket.id,'admin')).status,200,'Ticket READ must remain while its report-time profile expires');
 });
});

test('T41 combines original responsibility, follow, exact supplement and shared schedule state with current authorized source/status filters',{timeout:240000},async()=>{
 await withSearchFixture(async f=>{
  const handled=f.tickets[6];assert.ok(handled);const handledItem=object((await json(await f.get('/api/workbench/items/ticket/'+handled.ticket.id))).item);
  only(await search(f,{q:text(handledItem.number),responsibility:'handling',resolver_team_id:'PILOT_IT',assignee_id:f.staffId,statuses:'WAITING_VENDOR',sources:'WECOM_GROUP',column:'active'}),'ticket',handled.ticket.id);
  assert.deepEqual(await search(f,{q:text(handledItem.number),responsibility:'unassigned'}),[]);
  const publication=await f.runtime.coordinator.runOnce();assert.ok(publication.streams.every(stream=>stream.failures.length===0),JSON.stringify(publication.streams));
  const session=(await f.pool.query<{id:string}>('SELECT id::text FROM conversation.session WHERE service_intake_id=$1::uuid',[handled.intake.intakeId])).rows[0];assert.ok(session);
  const conversation=await json(await f.get('/api/conversations/'+session.id)),sessionView=object(conversation.session);
  const takeover=await f.post('/api/conversations/'+session.id+'/takeover',{client_command_id:randomUUID(),expected_row_version:sessionView.row_version,reason_code:'WORKBENCH_TAKEOVER'});assert.equal(takeover.status,200,await takeover.clone().text());
  only(await search(f,{q:text(handledItem.number),responsibility:'communication',scope:'related',statuses:'WAITING_VENDOR',sources:'WECOM_GROUP'}),'ticket',handled.ticket.id);
  const web=await webReport(f,'T41_STATE_WEB 处方提交不了','T41 state location','T41 state department'),path='/api/tickets/'+web.ticketId,itemPath='/api/workbench/items/ticket/'+web.ticketId;
  const first=object((await json(await f.get(itemPath))).item),attention=object(first.attention);
  assert.equal((await f.post(itemPath+'/follow',{client_command_id:randomUUID(),canonical_item:{kind:'ticket',id:web.ticketId},expected_follow_version:text(attention.follow_version),following:true})).status,200);
  only(await search(f,{q:'T41_STATE_WEB',scope:'related',responsibility:'following',sources:'WEB_REQUEST',statuses:'QUEUED',supplement:'none',schedule:'none'}),'ticket',web.ticketId);
  assert.equal(await web.supplement('1','T41 exact revision two original supplement'),'2');
  const pending=await json(await f.get(path+'/supplement-follow-up'));assert.equal(pending.has_pending_supplements,true);const material=rows(pending.items)[0];assert.ok(material);assert.equal(material.revision,'2');
  only(await search(f,{q:'T41_STATE_WEB',responsibility:'following',supplement:'pending',schedule:'none'}),'ticket',web.ticketId);
  assert.deepEqual(await search(f,{q:'T41_STATE_WEB',supplement:'followed'}),[]);
  const recorded=await f.post(path+'/supplement-follow-up',{client_command_id:randomUUID(),action:'RECORD_DISPOSITION',source_ref:text(material.source_ref),revision:'2',disposition_note:'T41 actual internal disposition',mark_followed_up:true});assert.equal(recorded.status,200,await recorded.clone().text());
  only(await search(f,{q:'T41_STATE_WEB',supplement:'followed',schedule:'none'}),'ticket',web.ticketId);
  assert.deepEqual(await search(f,{q:'T41_STATE_WEB',supplement:'pending'}),[]);
  const ticket=await json(await f.get(path)),clock=(await f.pool.query<{due:string}>("SELECT to_char(platform.local_from_epoch_ms(platform.physical_epoch_ms()+5000),'YYYY-MM-DD HH24:MI:SS') AS due")).rows[0];assert.ok(clock);
  const scheduled=await f.post(path+'/follow-up-schedule',{client_command_id:randomUUID(),expected_version:ticket.version,expected_schedule_version:'0',reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE',action:'SET',due_at:assertLocalDateTime(clock.due)},'admin');assert.equal(scheduled.status,200,await scheduled.clone().text());
  only(await search(f,{q:'T41_STATE_WEB',sources:'WEB_REQUEST',statuses:'QUEUED',responsibility:'following',supplement:'followed',schedule:'active'}),'ticket',web.ticketId);
  const schedule=await json(await f.get(path+'/follow-up-schedule')),active=object(schedule.active);assert.equal(active.is_due,false);
  const deadline=performance.now()+10000;let due=false;
  while(performance.now()<deadline){due=(await f.pool.query<{due:boolean}>('SELECT platform.physical_epoch_ms()>=$1::bigint AS due',[text(active.due_epoch_ms)])).rows[0]?.due===true;if(due)break;await new Promise<void>(resolve=>setTimeout(resolve,20));}assert.equal(due,true);
  only(await search(f,{q:'T41_STATE_WEB',scope:'related',responsibility:'following',supplement:'followed',schedule:'due'}),'ticket',web.ticketId);
  assert.deepEqual(await search(f,{q:'T41_STATE_WEB',schedule:'none'}),[]);
  const ended=await f.post(path+'/follow-up-schedule',{client_command_id:randomUUID(),expected_version:schedule.ticket_version,expected_schedule_version:text(schedule.schedule_version),reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE',action:'CANCEL',due_at:null},'admin');assert.equal(ended.status,200,await ended.clone().text());
  only(await search(f,{q:'T41_STATE_WEB',supplement:'followed',schedule:'none'}),'ticket',web.ticketId);
  assert.deepEqual(await search(f,{q:'T41_STATE_WEB',schedule:'active'}),[]);
  assert.deepEqual(await search(f,{q:'T41_STATE_WEB',responsibility:'following'},'outsider'),[]);
 },{states:true});
});

test('T41 cursor cannot cross two real stored Cookie sessions or a current role change for the same principal',{timeout:120000},async()=>{
 await withWeb01Fixture(async(f:{pool:PostgresPool;backendOrigin:string;cookies:string[];sessionId:string;principals:{id:string;wecom_user_id:string;display_name:string}[]})=>{
  const get=(cookie:string,path:string)=>fetch(f.backendOrigin+path,{headers:{cookie},signal:AbortSignal.timeout(15000)}),cookie=f.cookies[0];assert.ok(cookie);
  const first=await json(await get(cookie,'/api/workbench/search?limit=1')),cursor=text(first.next_cursor),token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');
  const created=await f.pool.query<{session_id:string}>(`INSERT INTO pilot_ticket.workbench_auth_session(session_token_hash,csrf_token_hash,principal_id,identity_hash,created_at,created_epoch_ms,last_seen_at,last_seen_epoch_ms,expires_epoch_ms,expires_at)
   SELECT $2,$3,principal_id,identity_hash,created_at,created_epoch_ms,last_seen_at,last_seen_epoch_ms,expires_epoch_ms,expires_at FROM pilot_ticket.workbench_auth_session WHERE session_id=$1::uuid RETURNING session_id::text`,[f.sessionId,createHash('sha256').update(token).digest('hex'),createHash('sha256').update(csrf).digest('hex')]);
  assert.equal(created.rowCount,1);assert.notEqual(created.rows[0]?.session_id,f.sessionId);
  const other='__Host-wecom_workbench_session='+token+'; __Host-wecom_workbench_csrf='+csrf;
  const principal=await json(await get(cookie,'/api/lifecycle/bootstrap')),second=await json(await get(other,'/api/lifecycle/bootstrap'));assert.equal(second.principal_id,principal.principal_id);assert.deepEqual(second.roles,principal.roles);
  const mixed=await get(other,'/api/workbench/search?limit=1&cursor='+encodeURIComponent(cursor));assert.equal(mixed.status,400);assert.equal(object(object(await mixed.json()).error).code,'P2_016_CURSOR_INVALID');
  const actor=f.principals[0];assert.ok(actor);await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:actor.wecom_user_id,displayName:actor.display_name,roles:['DISPATCHER'],resolverTeamIds:['PILOT_IT']});
  const changed=await get(cookie,'/api/workbench/search?limit=1&cursor='+encodeURIComponent(cursor));assert.equal(changed.status,400);assert.equal(Object.hasOwn(object(await changed.json()),'items'),false);
 },{realWorkbenchAuthentication:true,workbenchSearchEnabled:true});
});

test('T41 public search releases its query connection in a one-connection pool and records the actual PG18 bounded plan over 500 source Intakes',{timeout:240000},async()=>{
 await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'t41plan',max:1,run:async(f:{pool:PostgresPool;databaseUrl:string})=>{
  await applyThrough030(f);const migrationOptions={databaseUrl:f.databaseUrl,mode:'apply'};await migrateP2016(migrationOptions);
  const actor=await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:'t41-pool-one',displayName:'T41 one-connection actor',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
  const capacity=await seedCapacityDataset({pool:f.pool,tag:'t41plan'});assert.equal(capacity.journeys,500);
  const origin='http://127.0.0.1:0',runtime=createP2016Runtime({pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:origin,principalIds:[actor.id],externalSendEnabled:false,workbenchSearchEnabled:true,workbenchManualReviewEnabled:true});
  let captured:{sql:string;values:unknown[]}|undefined,original=f.pool.connect;
  f.pool.connect=new Proxy(original,{apply(target,receiver,args:unknown[]){if(args.length)return Reflect.apply(target,receiver,args);return Reflect.apply(target,receiver,args).then((client:PostgresPoolClient)=>{
   return new Proxy(client,{get(value,key){if(key==='query')return new Proxy(client.query,{apply(execute,_this,argumentsList:unknown[]){
    const sql=argumentsList[0],values=argumentsList[1];if(typeof sql==='string'&&sql.includes('LIMIT $22')){assert.ok(Array.isArray(values));captured={sql,values:[...values]};}
    return Reflect.apply(execute,client,argumentsList);
   }});const property=Reflect.get(value,key);return typeof property==='function'?property.bind(value):property;}});
  });}});
  try{
   const address=await listenConversationWorkbenchServer(runtime.server,{port:0}),cookie=runtime.authenticate.browserCookies?.()[0];assert.ok(cookie);assert.ok(address&&typeof address!=='string');
   const response=await ownedHttp('http://127.0.0.1:'+address.port+'/api/workbench/search?q=CAP%3At41plan%3A&limit=1',{cookie:cookie.name+'='+cookie.value});
   const page=await json(response);assert.equal(rows(page.items).length,1);assert.ok(typeof page.next_cursor==='string');assert.ok(captured);
   const plan=await f.pool.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+captured.sql,captured.values);
   const document=object(rows(plan.rows)[0]),array=document['QUERY PLAN'];assert.ok(Array.isArray(array));const report=object(array[0]),rootPlan=object(report.Plan);
   assert.equal(rootPlan['Node Type'],'Limit');assert.ok(typeof report['Execution Time']==='number'&&report['Execution Time']<2000);
   assert.ok(typeof rootPlan['Actual Rows']==='number'&&rootPlan['Actual Rows']<=2);assert.equal(f.pool.totalCount,1);
   console.log('T41_PG_PLAN '+JSON.stringify({dataset:capacity,pool_max:1,total_connections:f.pool.totalCount,plan:array}));
  }finally{f.pool.connect=original;await runtime.stop();assert.equal(runtime.server.listening,false);assert.equal(await new Promise<number>((resolve,reject)=>runtime.server.getConnections((error,count)=>error?reject(error):resolve(count))),0);}
 }});
});
