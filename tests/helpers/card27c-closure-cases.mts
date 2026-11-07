import assert from 'node:assert/strict';
import type {ClosureHistoryPage} from '../../contracts/unified_closure_contracts.js';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {launchSystemBrowser,closeBrowserTestResources} from './p2-006-browser-harness.mjs';
import {clickWorkbenchControl} from './heroui-workbench-controls.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {withWeb01Fixture,seedCard27Board,seedWeb01NoConversationIntake} from './web01-workbench-fixture.mjs';
import {withP2016IsolatedDatabase,applyThrough030} from './p2-016-postgres-harness.mjs';
import {seedPersistedIntake} from './p2-015-postgres-harness.mjs';
import {t11Http} from './t11-completion-fixture.mjs';
import type {T11Fixture} from './t11-completion-fixture.mjs';
import {migrateP2016} from '../../app/server/scripts/p2-016-migrate.mjs';
import {migrateServiceClosure} from '../../app/server/scripts/service-closure-migrate.mjs';
import {migrateWorkbenchFollowUpSchedules} from '../../app/server/scripts/workbench-follow-up-schedules-migrate.mjs';
import {migrateWorkbenchFollowUpDueSignals} from '../../app/server/scripts/workbench-follow-up-due-migrate.mjs';
import {migrateWorkbenchSupplementFollowUp} from '../../app/server/scripts/workbench-supplement-follow-up-migrate.mjs';
import {migrateWorkbenchManualReports} from '../../app/server/scripts/workbench-manual-reports-migrate.mjs';
import {migrateWorkbenchPersonalRead} from '../../app/server/scripts/workbench-personal-read-migrate.mjs';
import {createP2016Runtime} from '../../app/server/src/p2-016-runtime.mjs';
import {createP2016OrchestrationWorker} from '../../app/server/src/p2-016-orchestration-adapters.mjs';
import {createYxxSelfServiceOrchestrator} from '../../app/server/src/yxx-self-service-orchestrator.mjs';
import {listenConversationWorkbenchServer} from '../../app/server/src/p2-006-workbench-http.mjs';
import {createPilotTicketCore} from '../../app/server/src/p1-005-pilot-ticket-core.mjs';
import {createPilotAccessService} from '../../app/server/src/p1-009-pilot-access-workbench.mjs';
import {appendTicketEvent,createTicketActionService} from '../../app/server/src/p1-006-ticket-state-actions.mjs';
import {createNotificationOutbox} from '../../app/server/src/p1-007-notification-outbox.mjs';
import {createCommunicationDeliveryWorker} from '../../app/server/src/p2-004-communication-delivery-worker.mjs';
import {createServiceIntakeDecisionPort} from '../../app/server/src/p2-015-service-intake-decision-port.mjs';
import {createRuleFirstOrchestrator} from '../../app/server/src/p2-015-rule-first-orchestrator.mjs';
import {createSafeActionExecutor,createExistingTicketCommandPort} from '../../app/server/src/p2-015-safe-action-executor.mjs';
import {createManualReviewStore} from '../../app/server/src/p2-015-manual-review.mjs';
import {createDecisionStore} from '../../app/server/src/p2-015-decision-store.mjs';
import {createRuleEngine} from '../../app/server/src/p2-007-rule-engine.mjs';
import {createChannelMessageInbox} from '../../app/server/src/p1-003-channel-message-inbox.mjs';
import {adaptWeComSdkFrame} from '../../app/server/src/p1-002-wecom-sdk-adapter.mjs';
import {createServiceIntakeProcessor} from '../../app/server/src/p1-004-service-intake.mjs';
import {formatEpochMsToShanghaiLocal,assertLocalDateTime,nowShanghaiLocal} from '../../app/server/src/platform/time-contract.mjs';
import {CLOSURE_REASONS,reporterClosureText,reporterClosureProjection} from '../../app/server/src/service-closure-records.mjs';
import type {ClosureRecord} from '../../app/server/src/service-closure-records.mjs';
import type {ClosureReasonCode} from '../../contracts/unified_closure_contracts.js';
import type {PostgresPool,PostgresPoolClient} from '../../app/server/src/platform/postgres-pool.mjs';
import {conversationDeliveryReceiptCatalog,conversationDeliveryReceiptSchemaShape} from '../../app/server/src/p2-006-delivery-command-schema.mjs';

const CANARY='内部说明不得外发（合成）';
const expectedText:Record<ClosureReasonCode,string>={FALSE_REPORT_OR_TEST:'已关闭',DUPLICATE:'您的报修与已有报修重复，我们会在原报修中继续跟进。',NOT_IT_SCOPE:'您反映的问题不属于信息科受理范围，建议联系相关部门处理。',REPORTER_WITHDREW:'已按您的要求撤销本次报修。',REPORTER_UNREACHABLE:'多次联系未果，本次报修已关闭。如仍需处理，请重新报修。',OTHER:'您的报修已关闭。如仍需处理，请重新报修。'};
type Fixture=T11Fixture&{processReviewIntake:(id:string)=>Promise<unknown>};
function object(v:unknown):Record<string,unknown>{assert.ok(v&&typeof v==='object'&&!Array.isArray(v));return v as Record<string,unknown>;}
async function responseJson(r:Response,status=200):Promise<Record<string,unknown>>{const v:unknown=await r.json();assert.equal(r.status,status,JSON.stringify(v));return object(v);}
async function withClosureFixture(run:(f:Fixture)=>Promise<void>){
 await withWeb01Fixture(async(f:Fixture)=>{
  await f.runtime.stop();
  const runtime=createP2016Runtime({pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:f.origin,listenPort:Number(new URL(f.origin).port),principalIds:[f.principals[0]?.id??'',f.outsider.id,f.principals[1]?.id??''],externalSendEnabled:false,ticketSelfHandlingEnabled:true,ticketWaitingActionsEnabled:true,workbenchManualReviewEnabled:true,workbenchFollowUpSchedulesEnabled:true,workbenchSupplementFollowUpEnabled:true});
  // Use the existing explicit-consumption host: these cases drive every command,
  // decision and delivery themselves, without a competing Session projector.
  try{await listenConversationWorkbenchServer(runtime.server,{port:Number(new URL(f.origin).port)});const cookies=runtime.authenticate.browserCookies?.();assert.ok(cookies);await run({...f,runtime,cookies:cookies.map(c=>c.name+'='+c.value),browserCookies:cookies});}
  finally{await runtime.stop();assert.equal(runtime.server.listening,false);}
 },{precisionV212:true,ticketSelfHandlingEnabled:true,workbenchManualReviewEnabled:true,beforeClosureMigration:async({databaseUrl}:{databaseUrl:string})=>{
  await migrateWorkbenchManualReports({databaseUrl,mode:'apply'});await migrateWorkbenchPersonalRead({databaseUrl,mode:'apply'});
  await migrateWorkbenchFollowUpSchedules({databaseUrl:databaseUrl,mode:'apply'});
  await migrateWorkbenchFollowUpDueSignals({databaseUrl:databaseUrl,mode:'apply'});
  await migrateWorkbenchSupplementFollowUp({databaseUrl:databaseUrl,mode:'apply'});
 }});
}
async function post(f:Fixture,path:string,body:Record<string,unknown>,index=0){
 const cookie=f.cookies[index];assert.ok(cookie);const bootstrap=await responseJson(await fetch(f.origin+'/api/lifecycle/bootstrap',{headers:{cookie,connection:'close'}}));
 return fetch(f.origin+path,{method:'POST',headers:{cookie,connection:'close',origin:f.origin,'content-type':'application/json','idempotency-key':String(body.client_command_id),'if-match':'"'+String(body.expected_version??body.expected_row_version)+'"','x-csrf-token':String(bootstrap.csrf_token)},body:JSON.stringify(body)});
}
async function freshTicket(f:Fixture,status='QUEUED'){
 const intake=await seedPersistedIntake({pool:f.pool,text:'打印机无法工作（合成）',requestType:'INCIDENT',status:'RECEIVED',chatType:'single'});
 const created=await createPilotTicketCore({pool:f.pool}).createForIntake({intakeId:intake.intakeId,occurredAt:assertLocalDateTime(intake.receivedAt),traceId:'card27c-fixture'});assert.ok(created.ticket);
 await appendTicketEvent({transaction:f.pool,ticket:created.ticket,eventType:'ticket.created',actor:{type:'SYSTEM',id:null},traceId:'card27c-created'});
 const admin=await t11Http(f,0,{closeConnections:true}),handler=await t11Http(f,2,{closeConnections:true});
 if(status==='NEW'){
  const changed=(await f.pool.query<{version:number}>("UPDATE pilot_ticket.ticket SET status='NEW',version=version+1 WHERE id=$1::uuid RETURNING version",[created.ticket.id])).rows[0];assert.ok(changed);
  await appendTicketEvent({transaction:f.pool,ticket:{...created.ticket,status:'NEW',version:changed.version},eventType:'ticket.created',oldStatus:created.ticket.status,actor:{type:'SYSTEM',id:null},traceId:'card27c-new-state-input'});
 }else if(status==='ACCEPTED'){
  await responseJson(await admin.post(created.ticket.id,'accept',{client_command_id:randomUUID(),expected_version:created.ticket.version,reason_code:'SYNTHETIC_ACCEPT'}));
 }else if(status!=='QUEUED'){
  const started=await handler.start(created.ticket.id);
  if(status==='WAITING_REQUESTER'||status==='WAITING_VENDOR')await responseJson(await handler.post(created.ticket.id,status==='WAITING_REQUESTER'?'request-information':'wait-vendor',{client_command_id:randomUUID(),expected_version:started.version,reason_code:'SYNTHETIC_WAIT',note:'等待补充（合成）',external_visible:false}));
  else if(status==='REOPENED'){
   // State-input fixture uses the same existing synthetic writer/event helper as WEB01.
   const ticket=(await f.pool.query("UPDATE pilot_ticket.ticket SET status='REOPENED',version=version+1 WHERE id=$1::uuid RETURNING *",[created.ticket.id])).rows[0];assert.ok(ticket);
   await appendTicketEvent({transaction:f.pool,ticket:{...created.ticket,status:'REOPENED',version:Number(ticket.version)},eventType:'ticket.reopened',oldStatus:'CLOSED',actor:{type:'SYSTEM',id:null},traceId:'card27c-reopened-input'});
  }
 }
 return {id:created.ticket.id,intakeId:intake.intakeId,http:admin,current:await admin.detail(created.ticket.id)};
}
const closeBody=(version:number,reason:ClosureReasonCode='OTHER',extra:Record<string,unknown>={})=>({client_command_id:randomUUID(),expected_version:version,reason_code:reason,note:CANARY,...(reason==='NOT_IT_SCOPE'?{secondary_reason_code:'OUT_OF_SCOPE_CONFIRMED'}:{}),...extra});
async function latest(f:Fixture,kind:'TICKET'|'INTAKE',id:string){const r=(await f.pool.query<ClosureRecord>(`SELECT * FROM pilot_ticket.closure_record WHERE ${kind==='TICKET'?'ticket_id':'intake_id'}=$1::uuid ORDER BY closed_at DESC,id DESC LIMIT 1`,[id])).rows[0];assert.ok(r);return r;}

// Delay only the return from a real successful receipt INSERT; FK locks remain held.
function holdClosureReceipt(pool:PostgresPool,commandId:string){
 const originalConnect=pool.connect,restoreQueries=new Map<PostgresPoolClient,()=>void>();
 let backendPid:number|null=null,release:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
 pool.connect=new Proxy(originalConnect,{apply(target,receiver,args:unknown[]){
  if(args.length)return Reflect.apply(target,receiver,args);
  return Reflect.apply(target,receiver,args).then((client:PostgresPoolClient)=>{
   const originalQuery=client.query,originalRelease=client.release;
   client.query=new Proxy(originalQuery,{apply(execute,_this,queryArgs:unknown[]){
    const sql=typeof queryArgs[0]==='string'?queryArgs[0].trimStart():'',values=queryArgs[1];
    const result:unknown=Reflect.apply(execute,client,queryArgs);
    if(!sql.startsWith('INSERT INTO pilot_ticket.ticket_command_receipt')||!Array.isArray(values)||values[1]!==commandId)return result;
    assert.ok(result instanceof Promise);return result.then(async value=>{
     const pid=(await client.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(pid);backendPid=pid;await gate;return value;
    });
   }});
   const restore=()=>{client.query=originalQuery;client.release=originalRelease;restoreQueries.delete(client);};restoreQueries.set(client,restore);
   client.release=(...releaseArgs:Parameters<PostgresPoolClient['release']>)=>{restore();return Reflect.apply(originalRelease,client,releaseArgs);};return client;
  });
 }});
 return {release,restore(){pool.connect=originalConnect;for(const restore of [...restoreQueries.values()])restore();},async held(){
  const until=performance.now()+10000;while(backendPid===null&&performance.now()<until)await delay(10);assert.ok(backendPid,'the real legacy receipt INSERT must finish before starting the closure command');return backendPid;
 }};
}
async function closureCommandWait(pool:PostgresPool,blocker:number){
 const until=performance.now()+10000;
 do{
  const waiting=(await pool.query<{query:string;wait_event:string}>(`SELECT query,wait_event FROM pg_stat_activity
   WHERE datname=current_database() AND wait_event_type='Lock' AND $1::integer=ANY(pg_blocking_pids(pid))`,[blocker])).rows[0];
  if(waiting)return waiting;await delay(10);
 }while(performance.now()<until);
 assert.fail('the closure command must reach an actual PostgreSQL lock wait behind the gated legacy command');
}

test('Card 27C-A migration applies once, rejects checksum drift, rolls back an empty fixture, and reapplies',{timeout:240000},async()=>{
 const databaseUrl=process.env.PILOT_DATABASE_URL;assert.ok(databaseUrl);
 await withP2016IsolatedDatabase({databaseUrl,purpose:'closure27c',run:async(context:{pool:PostgresPool;databaseUrl:string})=>{
  await applyThrough030(context);const options={databaseUrl:context.databaseUrl,mode:'apply'};await migrateP2016(options);
  const catalog=async()=>(await context.pool.query("SELECT conrelid::regclass::text AS relation,conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE (conrelid='pilot_ticket.ticket_event'::regclass AND conname='ticket_event_type_check') OR (conrelid='intake.service_intake_event'::regclass AND conname='service_intake_event_type_check') OR (conrelid='pilot_ticket.ticket_command_receipt'::regclass AND conname='p2016_command_resource') ORDER BY relation,conname")).rows;
  const before=await catalog(),beforeReceipt=await conversationDeliveryReceiptCatalog(context.pool);assert.equal((await migrateServiceClosure({databaseUrl:context.databaseUrl,mode:'check'})).status,'PENDING');
  assert.equal((await migrateServiceClosure({databaseUrl:context.databaseUrl,mode:'apply'})).status,'APPLIED');
  assert.equal((await migrateServiceClosure({databaseUrl:context.databaseUrl,mode:'apply'})).status,'NOOP_ALREADY_APPLIED');
  assert.equal(await conversationDeliveryReceiptSchemaShape(context.pool,'before'),'BASE','071 preserves the exact original receipt contract through its verified extension');
  await assert.rejects(migrateP2016(options),/P2_016_SCHEMA_DRIFT/u,'the fixed legacy 031 catalog must not certify a current 071 object');
  const guard=(await context.pool.query<{definition:string}>("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='pilot_ticket.ticket_command_receipt'::regclass AND conname='p2016_command_resource'")).rows[0];assert.ok(guard);
  await context.pool.query('ALTER TABLE pilot_ticket.ticket_command_receipt DROP CONSTRAINT p2016_command_resource');await context.pool.query('ALTER TABLE pilot_ticket.ticket_command_receipt ADD CONSTRAINT p2016_command_resource CHECK(true)');
  await assert.rejects(conversationDeliveryReceiptSchemaShape(context.pool,'before'),/SERVICE_CLOSURE_SCHEMA_DRIFT/u);
  await context.pool.query('ALTER TABLE pilot_ticket.ticket_command_receipt DROP CONSTRAINT p2016_command_resource');await context.pool.query('ALTER TABLE pilot_ticket.ticket_command_receipt ADD CONSTRAINT p2016_command_resource '+guard.definition);
  const checksum=(await context.pool.query<{checksum_sha256:string}>("SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id='071_unified_service_closure'")).rows[0];assert.ok(checksum);
  await context.pool.query("UPDATE platform.schema_migration SET checksum_sha256=repeat('0',64) WHERE migration_id='071_unified_service_closure'");
  await assert.rejects(migrateServiceClosure({databaseUrl:context.databaseUrl,mode:'apply'}),/SCHEMA_DRIFT/u);
  await context.pool.query("UPDATE platform.schema_migration SET checksum_sha256=$1 WHERE migration_id='071_unified_service_closure'",[checksum.checksum_sha256]);
  assert.equal((await migrateServiceClosure({databaseUrl:context.databaseUrl,mode:'rollback'})).status,'ROLLED_BACK');assert.deepEqual(await catalog(),before);assert.deepEqual(await conversationDeliveryReceiptCatalog(context.pool),beforeReceipt);const restoredLegacy=await migrateP2016(options);assert.ok(restoredLegacy);assert.equal(restoredLegacy.status,'NOOP_ALREADY_APPLIED');
  assert.equal((await migrateServiceClosure({databaseUrl:context.databaseUrl,mode:'apply'})).status,'APPLIED');
  assert.equal(await conversationDeliveryReceiptSchemaShape(context.pool,'before'),'BASE');
 }});
});

test('Card 27C-A six reasons close Tickets and Intakes, enforce the notification matrix, and keep internal notes private',{timeout:300000},async t=>withClosureFixture(async f=>{
 for(const kind of ['TICKET','INTAKE','REVIEW'] as const)for(const reason of Object.keys(CLOSURE_REASONS) as ClosureReasonCode[])await t.test(kind+' '+reason,async()=>{
  const target=kind==='TICKET'?await freshTicket(f):await seedPersistedIntake({pool:f.pool,text:'待判断事项（合成）',status:'WAITING_TRIAGE'});
  const id='id' in target?target.id:target.intakeId,version='current' in target?target.current.version:1;
  let expectedReview:Record<string,unknown>={};if(kind==='REVIEW'){await f.processReviewIntake(id);const review=(await f.pool.query<{row_version:string}>('SELECT row_version::text FROM intake.manual_review_item WHERE service_intake_id=$1::uuid AND status=\'PENDING\' ORDER BY created_at,id LIMIT 1',[id])).rows[0];assert.ok(review);expectedReview={expected_review_version:review.row_version};const current=(await f.pool.query<{version:number}>('SELECT version FROM intake.service_intake WHERE id=$1::uuid',[id])).rows[0];assert.ok(current);await responseJson(await post(f,'/api/intakes/'+id+'/close',closeBody(current.version,reason,expectedReview)));}else await responseJson(await post(f,kind==='TICKET'?'/api/tickets/'+id+'/cancel':'/api/intakes/'+id+'/close',closeBody(version,reason)));
  const record=await latest(f,kind==='TICKET'?'TICKET':'INTAKE',id);assert.equal(record.reason_code,reason);assert.equal(record.note,CANARY);assert.equal(record.notify_reporter,!['FALSE_REPORT_OR_TEST','OTHER'].includes(reason));assert.equal(record.source,'MANUAL');assert.match(record.closed_at,/^\d{4}-\d{2}-\d{2} /u);
  const messages=(await f.pool.query<{content:Record<string,unknown>}>('SELECT content FROM communication.message WHERE id=$1::uuid',[record.notification_message_id])).rows;
  assert.equal(messages.length,record.notify_reporter?1:0);
  if(messages[0]){assert.equal(messages[0].content.text,expectedText[reason]);assert.ok(!JSON.stringify(messages[0]).includes(CANARY));}
  assert.equal(reporterClosureProjection({reason_code:reason,duplicate_of_ref:null},kind==='TICKET'?'CANCELLED':'IGNORED'),reason==='FALSE_REPORT_OR_TEST'?'已关闭':reporterClosureText(record));
 });
 const other=await freshTicket(f);await responseJson(await post(f,'/api/tickets/'+other.id+'/cancel',closeBody(other.current.version,'OTHER',{notify_reporter:true})));assert.ok((await latest(f,'TICKET',other.id)).notification_message_id);
 const duplicate=await freshTicket(f),originalId=f.tickets[9]?.ticket.id;assert.ok(originalId);const original={current:await duplicate.http.detail(originalId)};assert.equal(original.current.status,'CLOSED');await responseJson(await post(f,'/api/tickets/'+duplicate.id+'/cancel',closeBody(duplicate.current.version,'DUPLICATE',{duplicate_of_ref:original.current.ticket_no,note:' \t '})));
 const record=await latest(f,'TICKET',duplicate.id);assert.equal(record.note,null);assert.equal(record.duplicate_of_ref,original.current.ticket_no);assert.ok(reporterClosureText(record).endsWith('原报修编号：'+original.current.ticket_no));
 const notice=(await f.pool.query<{content:unknown}>('SELECT content FROM communication.message WHERE id=$1::uuid',[record.notification_message_id])).rows[0];assert.ok(notice);assert.equal(object(notice.content).text,reporterClosureText(record));
 await assert.rejects(migrateServiceClosure({databaseUrl:f.databaseUrl,mode:'rollback'}),/SERVICE_CLOSURE_ROLLBACK_REQUIRES_EMPTY_FIXTURE/u,'rollback must preserve committed closure facts');
}));

test('Card 27C-A all open Ticket states close and restore their state, owner and cycle while ending every active schedule',{timeout:300000},async t=>withClosureFixture(async f=>{
 for(const state of ['NEW','QUEUED','ACCEPTED','IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR','REOPENED'])await t.test(state,async()=>{
  const target=await freshTicket(f,state),before=target.current;
  await responseJson(await post(f,'/api/tickets/'+target.id+'/follow-up-schedule',{client_command_id:randomUUID(),expected_version:before.version,expected_schedule_version:'0',reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE',action:'SET',due_at:formatEpochMsToShanghaiLocal(String(Math.floor((Date.now()+60000)/1000)*1000))}));
  const current=await target.http.detail(target.id);await responseJson(await post(f,'/api/tickets/'+target.id+'/cancel',closeBody(current.version)));
  const closed=await target.http.detail(target.id);assert.equal(closed.status,'CANCELLED');assert.equal((await f.pool.query('SELECT 1 FROM pilot_ticket.follow_up_schedule WHERE ticket_id=$1::uuid AND scheduled_event_id IS NOT NULL',[target.id])).rowCount,0);
  const history=await responseJson(await target.http.get('/api/tickets/'+target.id+'/closure-history'));assert.equal(object(history.restore_target).status,state);assert.equal(object(history.restore_target).column,['NEW','QUEUED','ACCEPTED','REOPENED'].includes(state)?'pending':'active');
  const record=await latest(f,'TICKET',target.id);assert.equal(record.before_status,state);assert.equal(record.before_assignee_id,before.assignee_id);assert.equal(record.before_cycle_id,before.handling_cycle?.id??null);
  const restore={client_command_id:randomUUID(),expected_version:closed.version,reason_code:'RESTORE_CLOSED'},result=await responseJson(await post(f,'/api/tickets/'+target.id+'/restore',restore));assert.equal(result.ticket_version,closed.version+1);
  const replay=await responseJson(await post(f,'/api/tickets/'+target.id+'/restore',restore));assert.equal(replay.replayed,true);assert.equal(replay.ticket_event_id,result.ticket_event_id);
  const restored=await target.http.detail(target.id);assert.equal(restored.status,state);assert.equal(restored.assignee_id,before.assignee_id);assert.deepEqual(restored.handling_cycle,before.handling_cycle);
  assert.equal((await f.pool.query('SELECT 1 FROM pilot_ticket.follow_up_schedule WHERE ticket_id=$1::uuid AND scheduled_event_id IS NOT NULL',[target.id])).rowCount,0);
  assert.equal((await f.pool.query("SELECT 1 FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid AND event_type='ticket.handling_aborted'",[target.id])).rowCount,before.handling_cycle?1:0);
 });
 await t.test('DUPLICATE_LINKED public-fault closure restores its prior state',async()=>{
  const http=await t11Http(f,0,{closeConnections:true}),id=f.tickets[1]?.ticket.id;assert.ok(id);const before=await http.detail(id),ids=await seedCard27Board(f);assert.equal(ids.duplicate,id);
  const ended=await http.detail(id);assert.equal(ended.status,'DUPLICATE_LINKED');assert.equal((await post(f,'/api/tickets/'+id+'/cancel',closeBody(ended.version))).status,409);
  await responseJson(await post(f,'/api/tickets/'+id+'/restore',{client_command_id:randomUUID(),expected_version:ended.version,reason_code:'RESTORE_CLOSED'}));
  const restored=await http.detail(id);assert.equal(restored.status,before.status);assert.equal(restored.assignee_id,before.assignee_id);
 });
}));

test('Card 27C-A staff visibility, readonly denial, input validation, idempotency and If-Match conflicts remain enforced',{timeout:300000},async t=>withClosureFixture(async f=>{
 const admin=await t11Http(f,0,{closeConnections:true});
 for(const role of ['HANDLER','DISPATCHER','ADMIN'])await t.test(role+' close and restore',async()=>{
  const principal=f.principals[1];assert.ok(principal);await f.pool.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid',[principal.id]);await f.pool.query('INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,$2)',[principal.id,role]);
  const target=await freshTicket(f);await responseJson(await post(f,'/api/tickets/'+target.id+'/cancel',closeBody(target.current.version),2));const closed=await admin.detail(target.id);await responseJson(await post(f,'/api/tickets/'+target.id+'/restore',{client_command_id:randomUUID(),expected_version:closed.version,reason_code:'RESTORE_CLOSED'},2));
 });
 const target=await freshTicket(f),body=closeBody(target.current.version);
 for(const patch of [{reason_code:'ARBITRARY_FORMAT_VALID'},{reason_code:'OTHER',note:' \t '},{reason_code:'NOT_IT_SCOPE'},{reason_code:'NOT_IT_SCOPE',secondary_reason_code:'UNKNOWN'},{reason_code:'DUPLICATE',duplicate_of_ref:target.current.ticket_no},{reason_code:'FALSE_REPORT_OR_TEST',notify_reporter:true},{reason_code:'OTHER',duplicate_of_ref:target.current.ticket_no}]){
  const r=await post(f,'/api/tickets/'+target.id+'/cancel',{...body,...patch,client_command_id:randomUUID()});assert.ok([400,409].includes(r.status),JSON.stringify(await r.json()));assert.equal((await admin.detail(target.id)).version,target.current.version);
 }
 assert.equal((await post(f,'/api/tickets/'+target.id+'/cancel',closeBody(target.current.version,'DUPLICATE',{duplicate_of_ref:'IT-CARD27C-NOT-VISIBLE'}))).status,404);assert.equal((await admin.detail(target.id)).version,target.current.version);
 assert.equal((await post(f,'/api/tickets/'+target.id+'/cancel',body,1)).status,404);
 const replay1=await responseJson(await post(f,'/api/tickets/'+target.id+'/cancel',body));const replay2=await responseJson(await post(f,'/api/tickets/'+target.id+'/cancel',body));assert.equal(replay2.replayed,true);assert.equal(replay1.ticket_event_id,replay2.ticket_event_id);assert.equal((await f.pool.query('SELECT 1 FROM pilot_ticket.closure_record WHERE ticket_id=$1::uuid',[target.id])).rowCount,1);
 assert.equal((await post(f,'/api/tickets/'+target.id+'/cancel',{...body,reason_code:'FALSE_REPORT_OR_TEST'})).status,409);
 const race=await freshTicket(f),results=await Promise.all([post(f,'/api/tickets/'+race.id+'/cancel',closeBody(race.current.version)),post(f,'/api/tickets/'+race.id+'/cancel',closeBody(race.current.version))]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 for(const endedState of ['CLOSED','RESOLVED']){const item=f.tickets[endedState==='CLOSED'?9:12];assert.ok(item);const ended=await admin.detail(item.ticket.id);assert.equal(ended.status,endedState);assert.equal((await post(f,'/api/tickets/'+item.ticket.id+'/cancel',closeBody(ended.version))).status,409);}
 const closed=await admin.detail(target.id);assert.equal((await post(f,'/api/tickets/'+target.id+'/cancel',closeBody(closed.version))).status,409);
 assert.equal((await post(f,'/api/tickets/'+target.id+'/restore',{client_command_id:randomUUID(),expected_version:target.current.version,reason_code:'RESTORE_CLOSED'})).status,409);
 const principal=f.principals[1];assert.ok(principal);const readonly=await freshTicket(f),cookie=f.cookies[2];assert.ok(cookie);
 await responseJson(await post(f,'/api/tickets/'+readonly.id+'/accept',{client_command_id:randomUUID(),expected_version:readonly.current.version,reason_code:'SYNTHETIC_READONLY_OWNER'},2));
 await responseJson(await post(f,'/api/tickets/'+readonly.id+'/cancel',closeBody((await admin.detail(readonly.id)).version)));const readonlyVersion=(await admin.detail(readonly.id)).version;
 const csrf=await responseJson(await fetch(f.origin+'/api/lifecycle/bootstrap',{headers:{cookie,connection:'close'}}));await f.pool.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid',[principal.id]);
 for(const action of ['cancel','restore']){const id= randomUUID(),input=action==='restore'?{client_command_id:id,expected_version:readonlyVersion,reason_code:'RESTORE_CLOSED'}:closeBody(readonlyVersion,'OTHER',{client_command_id:id});assert.equal((await fetch(f.origin+'/api/tickets/'+readonly.id+'/'+action,{method:'POST',headers:{cookie,connection:'close',origin:f.origin,'content-type':'application/json','x-csrf-token':String(csrf.csrf_token),'idempotency-key':id,'if-match':'"'+readonlyVersion+'"'},body:JSON.stringify(input)})).status,401,'removing every internal role invalidates the existing test authentication');assert.equal((await admin.detail(readonly.id)).version,readonlyVersion);}

}));

test('Card 27C-A legacy default-off runtime locks the stream before receipts for closure concurrency',{timeout:240000},async t=>withWeb01Fixture(async(f:Fixture)=>{
 assert.equal(typeof f.runtime.realtimeProjector.ticket.lock,'function','use the actual runtime projector with completion, takeover, waiting and reopen flags left at their defaults');
 const cases=[{legacy:'queue',state:'NEW',action:'cancel'},{legacy:'accept',state:'QUEUED',action:'cancel'},{legacy:'notes',state:'QUEUED',action:'cancel'},{legacy:'notes',state:'QUEUED',action:'restore'}] as const;
 for(const scenario of cases)await t.test(scenario.legacy+' then '+scenario.action,async()=>{
  const target=await freshTicket(f,scenario.state);
  if(scenario.action==='restore')await responseJson(await post(f,'/api/tickets/'+target.id+'/cancel',closeBody(target.current.version)));
  const before=await target.http.detail(target.id),legacyId=randomUUID(),closureId=randomUUID(),held=holdClosureReceipt(f.pool,legacyId);
  let first:Promise<Response>|undefined,second:Promise<Response>|undefined;
  try{
   first=post(f,'/api/tickets/'+target.id+'/'+scenario.legacy,{client_command_id:legacyId,expected_version:before.version,reason_code:'SYNTHETIC_STREAM_ORDER',note:'并发锁序核对（合成）'});
   const blocker=await held.held();
   second=post(f,'/api/tickets/'+target.id+'/'+scenario.action,scenario.action==='cancel'?closeBody(before.version+1,'OTHER',{client_command_id:closureId}):{client_command_id:closureId,expected_version:before.version,reason_code:'RESTORE_CLOSED'});
   const waiting=await closureCommandWait(f.pool,blocker);console.log('CARD27C_LEGACY_RECEIPT_WAIT '+JSON.stringify({legacy:scenario.legacy,closure:scenario.action,wait_event:waiting.wait_event,waiting_on_stream:/pg_advisory_xact_lock/u.test(waiting.query)}));assert.equal(waiting.wait_event,'advisory');assert.match(waiting.query,/pg_advisory_xact_lock/u,'the closure command must wait for the stream, without first competing for the Ticket row held by the receipt FK');
   held.release();const legacy=await responseJson(await first,scenario.action==='restore'?409:200);await responseJson(await second);
   if(scenario.action==='restore')assert.equal(object(legacy.error).code,'INVALID_STATE_TRANSITION','a note on a closed Ticket keeps its existing state rejection');
   const receipts=(await f.pool.query<{command_type:string;state:string;error_code:string|null}>(`SELECT command_type,state,error_code FROM pilot_ticket.ticket_command_receipt WHERE client_command_id IN ($1::uuid,$2::uuid) ORDER BY command_type`,[legacyId,closureId])).rows;
   assert.equal(receipts.length,2);assert.equal(receipts.find(row=>row.command_type===scenario.action)?.state,'COMMITTED');
   const legacyReceipt=receipts.find(row=>row.command_type===(scenario.legacy==='notes'?'add-note':scenario.legacy));assert.ok(legacyReceipt);assert.equal(legacyReceipt.state,scenario.action==='restore'?'FAILED':'COMMITTED');assert.equal(legacyReceipt.error_code,scenario.action==='restore'?'INVALID_STATE_TRANSITION':null);
   const after=await target.http.detail(target.id);assert.equal(after.status,scenario.action==='restore'?'QUEUED':'CANCELLED');assert.equal(after.version,before.version+(scenario.action==='restore'?1:2));
   console.log('CARD27C_STREAM_BEFORE_RECEIPT '+JSON.stringify({legacy:scenario.legacy,closure:scenario.action,wait_event:waiting.wait_event,stream_before_ticket:true,receipts:receipts.map(row=>({action:row.command_type,state:row.state,error:row.error_code}))}));
  }finally{held.release();await Promise.allSettled([first,second].filter((pending):pending is Promise<Response>=>pending!==undefined));held.restore();}
 });
},{precisionV212:true,manualProjection:true}));

test('Card 27C-A active global owners restore their prior state without a team membership',{timeout:240000},async t=>withClosureFixture(async f=>{
 const owner=f.principals[1];assert.ok(owner);const identity=(await f.pool.query<{wecom_user_id:string;display_name:string}>('SELECT wecom_user_id,display_name FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[owner.id])).rows[0];assert.ok(identity);
 for(const role of ['ADMIN','DISPATCHER'] as const)await t.test(role,async()=>{
  const principal=await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:identity.wecom_user_id,displayName:identity.display_name,roles:[role],resolverTeamIds:[]});assert.equal(principal.id,owner.id);
  assert.equal((await f.pool.query('SELECT 1 FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[owner.id])).rowCount,0);
  const target=await freshTicket(f);await responseJson(await post(f,'/api/tickets/'+target.id+'/accept',{client_command_id:randomUUID(),expected_version:target.current.version,reason_code:'SYNTHETIC_GLOBAL_ACCEPT'},2));
  const before=await target.http.detail(target.id);assert.equal(before.status,'ACCEPTED');assert.equal(before.assignee_id,owner.id);
  await responseJson(await post(f,'/api/tickets/'+target.id+'/cancel',closeBody(before.version)));const closed=await target.http.detail(target.id);
  await responseJson(await post(f,'/api/tickets/'+target.id+'/restore',{client_command_id:randomUUID(),expected_version:closed.version,reason_code:'RESTORE_CLOSED'}));
  const restored=await target.http.detail(target.id);assert.equal(restored.status,before.status);assert.equal(restored.assignee_id,owner.id);assert.equal(restored.resolver_team_id,before.resolver_team_id);
 });
}));

test('Card 27C-A inactive or out-of-team owners restore as unclaimed and repeated closures append separate records',{timeout:240000},async()=>withClosureFixture(async f=>{
 const target=await freshTicket(f,'IN_PROGRESS'),owner=target.current.assignee_id;assert.ok(owner);assert.deepEqual((await f.pool.query<{role:string}>('SELECT role FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid ORDER BY role',[owner])).rows.map(row=>row.role),['HANDLER'],'the inactive and lost-team fallback cases use a scoped HANDLER owner');await responseJson(await post(f,'/api/tickets/'+target.id+'/cancel',closeBody(target.current.version)));
 await f.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[owner]);let closed=await target.http.detail(target.id);await responseJson(await post(f,'/api/tickets/'+target.id+'/restore',{client_command_id:randomUUID(),expected_version:closed.version,reason_code:'RESTORE_CLOSED'}));
 const restored=await target.http.detail(target.id);assert.equal(restored.status,'QUEUED');assert.equal(restored.assignee_id,null);
 await responseJson(await post(f,'/api/tickets/'+target.id+'/cancel',closeBody(restored.version)));closed=await target.http.detail(target.id);await responseJson(await post(f,'/api/tickets/'+target.id+'/restore',{client_command_id:randomUUID(),expected_version:closed.version,reason_code:'RESTORE_CLOSED'}));
 const rows=(await f.pool.query<ClosureRecord>('SELECT * FROM pilot_ticket.closure_record WHERE ticket_id=$1::uuid ORDER BY id',[target.id])).rows;assert.equal(rows.length,2);assert.ok(rows.every(r=>r.restored_at&&r.restored_by));
 await f.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=true WHERE id=$1::uuid',[owner]);const other=await freshTicket(f,'WAITING_VENDOR');await responseJson(await post(f,'/api/tickets/'+other.id+'/cancel',closeBody(other.current.version)));await f.pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid AND team_id=$2',[owner,other.current.resolver_team_id]);const ended=await other.http.detail(other.id);assert.equal((await post(f,'/api/tickets/'+other.id+'/restore',{client_command_id:randomUUID(),expected_version:ended.version,reason_code:'RESTORE_CLOSED'},2)).status,403,'a historical owner does not retain work authority after losing the current team');await responseJson(await post(f,'/api/tickets/'+other.id+'/restore',{client_command_id:randomUUID(),expected_version:ended.version,reason_code:'RESTORE_CLOSED'}));assert.equal((await other.http.detail(other.id)).status,'QUEUED');assert.equal((await other.http.detail(other.id)).assignee_id,null);
}));

test('Card 27C-A restoration notices require acknowledged close delivery and never duplicate the legacy P1 cancellation notice',{timeout:240000},async()=>withClosureFixture(async f=>{
 const target=await freshTicket(f),body=closeBody(target.current.version,'REPORTER_WITHDREW');await responseJson(await post(f,'/api/tickets/'+target.id+'/cancel',body));const record=await latest(f,'TICKET',target.id);assert.ok(record.notification_message_id);
 const mock=createCommunicationDeliveryWorker({pool:f.pool,enabled:true,batchSize:20,sender:{send:async()=>({outcome:'ACKNOWLEDGED',provider_message_id:null,error_code:null,retryable:false})}});await mock.runOnce({limit:20});
 const closed=await target.http.detail(target.id);await responseJson(await post(f,'/api/tickets/'+target.id+'/restore',{client_command_id:randomUUID(),expected_version:closed.version,reason_code:'RESTORE_CLOSED'}));
 const notice=(await f.pool.query<{content:Record<string,unknown>}>(`SELECT m.content FROM pilot_ticket.closure_record c JOIN communication.message m ON m.id=c.restoration_notification_message_id WHERE c.id=$1::uuid`,[record.id])).rows[0];assert.ok(notice);assert.equal(notice.content.text,'您的报修已重新受理，我们会继续处理。');assert.ok(!JSON.stringify(notice).includes(CANARY));
 const pending=await freshTicket(f);await responseJson(await post(f,'/api/tickets/'+pending.id+'/cancel',closeBody(pending.current.version,'DUPLICATE')));const prior=await latest(f,'TICKET',pending.id),pendingClosed=await pending.http.detail(pending.id);await responseJson(await post(f,'/api/tickets/'+pending.id+'/restore',{client_command_id:randomUUID(),expected_version:pendingClosed.version,reason_code:'RESTORE_CLOSED'}));assert.equal((await f.pool.query('SELECT 1 FROM pilot_ticket.closure_record WHERE id=$1::uuid AND restoration_notification_message_id IS NOT NULL',[prior.id])).rowCount,0);assert.equal((await f.pool.query("SELECT 1 FROM communication.outbox o JOIN communication.delivery d ON d.outbox_id=o.id WHERE o.message_id=$1::uuid AND d.status='CANCELLED'",[prior.notification_message_id])).rowCount,1);
 const direct=await freshTicket(f),result=await createTicketActionService({pool:f.pool,authorize:async()=>true}).perform({ticketId:direct.id,action:'cancel',actor:{type:'PILOT_USER',id:f.principals[0]?.id??''},expectedVersion:direct.current.version,reasonCode:'DUPLICATE',traceId:'card27c-p1-default'});assert.ok(result?.ok);
 assert.equal(result.event.event_type,'ticket.cancelled');await createNotificationOutbox().enqueueTicketEvent({transaction:f.pool,ticket:result.ticket,event:{...result.event,event_type:'ticket.cancelled'}});assert.equal((await f.pool.query('SELECT 1 FROM notification.delivery d JOIN notification.outbox o ON o.id=d.outbox_id WHERE o.ticket_event_id=$1::uuid',[result.event.event_id])).rowCount,0);
}));

test('Card 27C-A system classification records the physical close time and a pending Review restores its original column',{timeout:240000},async()=>withClosureFixture(async f=>{
 const system=await seedPersistedIntake({pool:f.pool,text:'今天天气如何（合成）',chatType:'single',requestType:'UNKNOWN',status:'WAITING_DESCRIPTION'}),core=createPilotTicketCore({pool:f.pool});
 await f.pool.query("UPDATE channel.message_inbox SET received_at=platform.local_now()-interval '2 days' WHERE id=$1::bigint",[system.messageId]);await f.pool.query("UPDATE intake.service_intake SET last_message_at=platform.local_now()-interval '2 days' WHERE id=$1::uuid",[system.intakeId]);
 const decisionStore=createDecisionStore(),orchestrator=createRuleFirstOrchestrator({pool:f.pool,identityHmacKey:'card27c-synthetic-identity-key-32-bytes',ruleEngine:createRuleEngine(),decisionStore,safeActionExecutor:createSafeActionExecutor({intakeDecisionPort:createServiceIntakeDecisionPort(),ticketCommandPort:createExistingTicketCommandPort({ticketCore:core}),manualReviewStore:createManualReviewStore(),decisionStore})});
 await orchestrator.processPersistedIntake({service_intake_id:system.intakeId,feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true}});
 const record=await latest(f,'INTAKE',system.intakeId);assert.equal(record.source,'SYSTEM');const near=(await f.pool.query<{fresh:boolean}>('SELECT $1::timestamp BETWEEN platform.local_now()-interval \'30 seconds\' AND platform.local_now()+interval \'1 second\' AS fresh',[record.closed_at])).rows[0];assert.equal(near?.fresh,true);
 const thanksFrame=adaptWeComSdkFrame({cmd:'aibot_msg_callback',headers:{req_id:'thanks-（合成）-'+randomUUID()},body:{msgid:'感谢用例（合成）-'+randomUUID(),aibotid:'bot-test',chattype:'single',from:{userid:'thanks-synthetic-user'},msgtype:'text',text:{content:'谢谢'}}},{receivedAt:nowShanghaiLocal()});assert.ok(thanksFrame.ok);
 const expiry=String(Math.floor(Date.now()/1000)*1000+2592000000),thanks=await createChannelMessageInbox({pool:f.pool}).accept({message:thanksFrame.message,traceId:'card27c-initial-thanks',privacyClass:'INTERNAL',retentionUntil:formatEpochMsToShanghaiLocal(expiry),retentionUntilEpochMs:expiry},createServiceIntakeProcessor());
 const thanksIntake=object(object(object(thanks).result).intake);assert.equal(thanksIntake.status,'IGNORED');assert.equal(typeof thanksIntake.id,'string');const thanksId=String(thanksIntake.id),thanksRecord=await latest(f,'INTAKE',thanksId);assert.equal(thanksRecord.before_status,'WAITING_DESCRIPTION');assert.equal(thanksRecord.source,'SYSTEM');await responseJson(await post(f,'/api/intakes/'+thanksId+'/restore',{client_command_id:randomUUID(),expected_version:thanksIntake.version,reason_code:'RESTORE_CLOSED'}));assert.equal((await f.pool.query<{status:string}>('SELECT status FROM intake.service_intake WHERE id=$1::uuid',[thanksId])).rows[0]?.status,'WAITING_DESCRIPTION');
 const intake=await seedPersistedIntake({pool:f.pool,text:'人工判断后关闭（合成）'});await f.processReviewIntake(intake.intakeId);const review=(await f.pool.query<{id:string;row_version:string}>('SELECT id::text,row_version::text FROM intake.manual_review_item WHERE service_intake_id=$1::uuid AND status=\'PENDING\'',[intake.intakeId])).rows[0];assert.ok(review);
 await responseJson(await post(f,'/api/manual-reviews/'+review.id+'/resolve',{client_command_id:randomUUID(),expected_row_version:review.row_version,resolution_code:'MARK_OUT_OF_SCOPE',resolution_reason_code:'OUT_OF_SCOPE_CONFIRMED',reason_code:'NOT_IT_SCOPE',secondary_reason_code:'OUT_OF_SCOPE_CONFIRMED'}));const ended=(await f.pool.query<{version:number}>('SELECT version FROM intake.service_intake WHERE id=$1::uuid',[intake.intakeId])).rows[0];assert.ok(ended);
 await responseJson(await post(f,'/api/intakes/'+intake.intakeId+'/restore',{client_command_id:randomUUID(),expected_version:ended.version,reason_code:'RESTORE_CLOSED'}));const restored=(await f.pool.query<{status:string;row_version:string}>('SELECT status,row_version::text FROM intake.manual_review_item WHERE id=$1::uuid',[review.id])).rows[0];assert.equal(restored?.status,'PENDING');assert.ok(BigInt(restored.row_version)>BigInt(review.row_version));
}));

test('Card 27C-A Bot and Web workers preserve closed Intakes and resume the ordinary workflow only after restoration',{timeout:240000},async t=>withClosureFixture(async f=>{
 const bot=createP2016OrchestrationWorker({pool:f.pool,mvpPolicy:false,identityHmacKey:'card27c-closed-worker-synthetic-key',notifications:f.runtime.notifications,realtime:f.runtime.realtimeProjector});
 const web=createYxxSelfServiceOrchestrator({pool:f.pool,profile:'MEMBER_SELF_SERVICE',featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true}});
 const read=async(id:string)=>{const row=(await f.pool.query<{status:string;version:number;pilot_ticket_id:string|null}>('SELECT status,version,pilot_ticket_id::text FROM intake.service_intake WHERE id=$1::uuid',[id])).rows[0];assert.ok(row);return row;};
 for(const kind of ['BOT','WEB'])await t.test(kind,async()=>{
  const source=kind==='BOT'?await seedPersistedIntake({pool:f.pool,text:'门诊二楼打印机卡纸，无法打印处方（合成）',requestType:'INCIDENT',status:'RECEIVED',chatType:'single'}):await seedWeb01NoConversationIntake({pool:f.pool,text:'门诊二楼打印机卡纸，无法打印处方（合成）',location:'门诊二楼（合成）',serviceCode:'PRINT.PRINTER_DEVICE'});
  const id=source.intakeId,before=await read(id),ref='requestRef' in source?source.requestRef:null;
  const run=async()=>{if(kind==='BOT')await bot.processDueBatch({feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true},batch_size:50});else{assert.equal(typeof ref,'string');return web.processOne({requestRef:ref});}};
  await responseJson(await post(f,'/api/intakes/'+id+'/close',closeBody(before.version)));const closed=await read(id);assert.equal(closed.status,'IGNORED');
  await run();assert.deepEqual(await read(id),closed,'queued automatic work cannot reopen a closed Intake or create its Ticket');
  await responseJson(await post(f,'/api/intakes/'+id+'/restore',{client_command_id:randomUUID(),expected_version:closed.version,reason_code:'RESTORE_CLOSED'}));const restored=await read(id);assert.equal(restored.status,before.status);assert.equal(restored.pilot_ticket_id,null);
  await run();const continued=await read(id);assert.equal(continued.status,'TICKET_CREATED');assert.equal(typeof continued.pilot_ticket_id,'string');
 });
}));

test('Card 27C-A closing processing terminates pending supplemental follow-up and cards without destroying material',{timeout:240000},async()=>withClosureFixture(async f=>{
 const target=await freshTicket(f,'WAITING_REQUESTER'),source=(await f.pool.query<{source_chat_type:string;source_chat_id:string|null;source_bot_id:string;reporter_wecom_userid:string}>('SELECT source_chat_type,source_chat_id,source_bot_id,reporter_wecom_userid FROM intake.service_intake WHERE id=$1::uuid',[target.intakeId])).rows[0];assert.ok(source);
 const frame=adaptWeComSdkFrame({cmd:'aibot_msg_callback',headers:{req_id:'synthetic-'+randomUUID()},body:{msgid:randomUUID(),aibotid:source.source_bot_id,chattype:source.source_chat_type,chatid:source.source_chat_id,from:{userid:source.reporter_wecom_userid},msgtype:'text',text:{content:'补充故障现象（合成）'}}},{receivedAt:nowShanghaiLocal()});assert.ok(frame.ok);
 const expiry=String(Math.floor(Date.now()/1000)*1000+2592000000);await createChannelMessageInbox({pool:f.pool}).accept({message:frame.message,traceId:'card27c-supplement',privacyClass:'INTERNAL',retentionUntil:formatEpochMsToShanghaiLocal(expiry),retentionUntilEpochMs:expiry},createServiceIntakeProcessor({existingIntakeSelector:async()=>({id:target.intakeId})}));
 const before=(await f.pool.query('SELECT 1 FROM intake.service_intake_message WHERE intake_id=$1::uuid',[target.intakeId])).rowCount;assert.ok(before&&before>1);
 await responseJson(await post(f,'/api/tickets/'+target.id+'/cancel',closeBody((await target.http.detail(target.id)).version)));
 assert.equal((await f.pool.query('SELECT 1 FROM pilot_ticket.closure_supplement_termination WHERE ticket_id=$1::uuid',[target.id])).rowCount,1);
 assert.equal((await f.pool.query('SELECT 1 FROM notification.card_action_task WHERE ticket_id=$1::uuid AND consumed_at IS NULL',[target.id])).rowCount,0);
 const closed=await target.http.detail(target.id);await responseJson(await post(f,'/api/tickets/'+target.id+'/restore',{client_command_id:randomUUID(),expected_version:closed.version,reason_code:'RESTORE_CLOSED'}));
 const summary=await responseJson(await target.http.get('/api/tickets/'+target.id+'/supplement-follow-up'));assert.equal(summary.has_pending_supplements,false);assert.equal((await f.pool.query('SELECT 1 FROM intake.service_intake_message WHERE intake_id=$1::uuid',[target.intakeId])).rowCount,before);
}));

test('Card 27C-B closure history reads real delivery facts, effective owners and bounded version-ordered history',{timeout:240000},async()=>withClosureFixture(async f=>{
 const target=await freshTicket(f,'IN_PROGRESS'),owner=target.current.assignee_id;assert.ok(owner);
 const read=async()=>{const response=await target.http.get('/api/tickets/'+target.id+'/closure-history');assert.equal(response.status,200);return response.json() as Promise<ClosureHistoryPage>;};
 assert.deepEqual((await read()).items,[]);
 await responseJson(await post(f,'/api/tickets/'+target.id+'/cancel',closeBody(target.current.version,'REPORTER_WITHDREW')));
 let page=await read();assert.equal(page.items.length,1);assert.equal(page.items[0]?.note,CANARY);assert.equal(page.items[0]?.notification_state,'NOT_SENT');assert.equal(page.restore_target?.status,'IN_PROGRESS');assert.equal(page.restore_target?.column,'active');assert.ok(page.restore_target?.assignee_name);assert.equal(page.next_before_version,null);
 const outside=f.cookies[1];assert.ok(outside);assert.equal((await fetch(f.origin+'/api/tickets/'+target.id+'/closure-history',{headers:{cookie:outside,connection:'close'}})).status,404);
 for(const query of ['?before_version=0','?before_version=-1','?before_version=1&before_version=2','?unknown=1'])assert.equal((await target.http.get('/api/tickets/'+target.id+'/closure-history'+query)).status,400);
 const sender=createCommunicationDeliveryWorker({pool:f.pool,enabled:true,batchSize:20,sender:{send:async()=>({outcome:'ACKNOWLEDGED',provider_message_id:null,error_code:null,retryable:false})}});await sender.runOnce({limit:20});
 page=await read();assert.equal(page.items[0]?.notification_state,'SENT');assert.equal(page.restore_target?.notification_state,'SENT');
 await f.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[owner]);page=await read();assert.deepEqual(page.restore_target,{status:'QUEUED',column:'pending',assignee_name:null,notification_state:'SENT'});
 await responseJson(await post(f,'/api/tickets/'+target.id+'/restore',{client_command_id:randomUUID(),expected_version:page.version,reason_code:'RESTORE_CLOSED'}));
 page=await read();assert.equal(page.restore_target,null);assert.ok(page.items[0]?.restored_at);assert.ok(page.items[0]?.restored_by_display_name);
 for(let index=0;index<20;index++){const current=await target.http.detail(target.id);await responseJson(await post(f,'/api/tickets/'+target.id+'/cancel',closeBody(current.version)));const closed=await target.http.detail(target.id);await responseJson(await post(f,'/api/tickets/'+target.id+'/restore',{client_command_id:randomUUID(),expected_version:closed.version,reason_code:'RESTORE_CLOSED'}));}
 page=await read();assert.equal(page.items.length,20);assert.equal(page.next_before_version,page.items.at(-1)?.before_version);assert.ok(page.items.every((item,index)=>index===0||item.before_version<(page.items[index-1]?.before_version??0)));
 const response=await target.http.get('/api/tickets/'+target.id+'/closure-history?before_version='+page.next_before_version);assert.equal(response.status,200);const tail=await response.json() as ClosureHistoryPage;assert.equal(tail.items.length,1);assert.equal(tail.next_before_version,null);assert.equal(tail.restore_target,null);assert.equal(new Set([...page.items,...tail.items].map(item=>item.id)).size,21);
 const intake=await seedPersistedIntake({pool:f.pool,text:'范围外咨询（合成）',requestType:'INCIDENT',status:'WAITING_TRIAGE',chatType:'single'});
 const context=await responseJson(await target.http.get('/api/intakes/'+intake.intakeId+'/closure-context'));
 await responseJson(await post(f,'/api/intakes/'+intake.intakeId+'/close',closeBody(Number(context.version),'NOT_IT_SCOPE')));
 const intakePage=await responseJson(await target.http.get('/api/intakes/'+intake.intakeId+'/closure-history'));assert.equal(object(intakePage.restore_target).column,'pending');assert.equal(object(intakePage.restore_target).status,'WAITING_TRIAGE');assert.ok(Array.isArray(intakePage.items));assert.equal(object(intakePage.items[0]).reason_code,'NOT_IT_SCOPE');
}));

test('Card 27C-B restore requires renewed confirmation when the closing delivery becomes acknowledged',{timeout:240000},async()=>withClosureFixture(async f=>{
 const target=await freshTicket(f),path='/api/tickets/'+target.id+'/restore';
 await responseJson(await post(f,'/api/tickets/'+target.id+'/cancel',closeBody(target.current.version,'REPORTER_WITHDREW')));
 let page=await responseJson(await target.http.get('/api/tickets/'+target.id+'/closure-history'));assert.equal(object(page.restore_target).notification_state,'NOT_SENT');
 const cookie=f.browserCookies[0],cookieUrl=cookie?.url;assert.ok(cookie&&cookieUrl);let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,error:unknown,posts=0;
 const observe=(request:import('node:http').IncomingMessage)=>{if(request.method==='POST'&&request.url===path)posts++;};f.runtime.server.on('request',observe);
 try{
  browser=await launchSystemBrowser({url:f.origin+'/workbench/app/items/ticket/'+target.id,width:1440,height:900,cookies:[{...cookie,url:cookieUrl}]});assert.ok(browser);
  await browser.command('Page.bringToFront');await browser.waitFor("document.querySelector('.ds-next-step [data-action=restore-closed]')?.disabled===false");
  await clickWorkbenchControl(browser,'.ds-next-step [data-action=restore-closed]');
  await browser.waitFor("Boolean(document.querySelector('[data-restore-confirmation]'))");
  assert.equal(await browser.evaluate("document.querySelector('[data-restore-confirmation]').textContent.includes('将通知报修人已重新受理')"),false);
  assert.equal(await browser.evaluate("document.querySelector('[data-restore-confirmation]').textContent.includes('关闭通知尚未送达，恢复后将按送达结果决定是否通知')"),true);
  const sender=createCommunicationDeliveryWorker({pool:f.pool,enabled:true,batchSize:20,sender:{send:async()=>({outcome:'ACKNOWLEDGED',provider_message_id:null,error_code:null,retryable:false})}});await sender.runOnce({limit:20});
  page=await responseJson(await target.http.get('/api/tickets/'+target.id+'/closure-history'));assert.equal(object(page.restore_target).notification_state,'SENT');
  await clickWorkbenchControl(browser,'[data-action=confirm-restore-closed]');
  await browser.waitFor("document.querySelector('[data-restore-confirmation]')?.textContent.includes('关闭时已通知，将通知报修人已重新受理')&&document.body.innerText.includes('恢复目标或关闭通知状态已变化')");
  assert.equal(posts,0);assert.equal((await target.http.detail(target.id)).status,'CANCELLED');
  await clickWorkbenchControl(browser,'[data-action=confirm-restore-closed]');await browser.waitFor("!document.querySelector('[data-restore-confirmation]')");
  assert.equal(posts,1);assert.equal((await target.http.detail(target.id)).status,'QUEUED');
 }catch(failure){error=failure;}
 finally{f.runtime.server.removeListener('request',observe);await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);}
}));

test('Card 27C-B failed later history page keeps the first twenty records visible and permits retry',{timeout:240000},async()=>withClosureFixture(async f=>{
 const target=await freshTicket(f);let current=target.current;
 for(let index=0;index<21;index++){
  await responseJson(await post(f,'/api/tickets/'+target.id+'/cancel',closeBody(current.version,'FALSE_REPORT_OR_TEST')));
  const closed=await target.http.detail(target.id);await responseJson(await post(f,'/api/tickets/'+target.id+'/restore',{client_command_id:randomUUID(),expected_version:closed.version,reason_code:'RESTORE_CLOSED'}));
  current=await target.http.detail(target.id);
 }
 const cookie=f.browserCookies[0],cookieUrl=cookie?.url;assert.ok(cookie&&cookieUrl);let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,error:unknown;
 try{
  browser=await launchSystemBrowser({url:f.origin+'/workbench/app/items/ticket/'+target.id,width:1440,height:900,cookies:[{...cookie,url:cookieUrl}]});assert.ok(browser);
  await browser.command('Page.bringToFront');await browser.waitFor("document.querySelectorAll('[data-closure-history] [data-closure-record]').length===20");
  await browser.evaluate("(()=>{const original=fetch;let failed=false;globalThis.fetch=async(url,options)=>{if(!failed&&String(url).includes('/closure-history?before_version=')){failed=true;return new Response(JSON.stringify({error:{code:'P2_016_UNAVAILABLE'}}),{status:503,headers:{'content-type':'application/json'}});}return original(url,options);};})()");
  await clickWorkbenchControl(browser,'[data-closure-history] button');
  await browser.waitFor("document.querySelector('[data-closure-history]')?.textContent.includes('更早记录暂不可读')");
  assert.equal(await browser.evaluate("document.querySelectorAll('[data-closure-history] [data-closure-record]').length"),20);
  await clickWorkbenchControl(browser,'[data-closure-history] button');await browser.waitFor("document.querySelectorAll('[data-closure-history] [data-closure-record]').length===21");
 }catch(failure){error=failure;}
 finally{await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);}
}));
