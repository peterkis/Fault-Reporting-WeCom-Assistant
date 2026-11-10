import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withT24Fixture} from './t24-round-notification-fixture.mjs';
import {t11Http} from './t11-completion-fixture.mjs';
import type {T11Fixture} from './t11-completion-fixture.mjs';
import {seedPersistedIntake} from './p2-015-postgres-harness.mjs';
import {createPilotTicketCore} from '../../app/server/src/p1-005-pilot-ticket-core.mjs';
import {createP2016WeComSender} from '../../app/server/src/p2-016-wecom-sender.mjs';
import {createCommunicationDeliveryWorker,createCommunicationReconciliationPort} from '../../app/server/src/p2-004-communication-delivery-worker.mjs';
import {createMvpNotificationAdmission} from '../../app/server/src/mvp-group-replies.mjs';
import {appendCommunication} from '../../app/server/src/p2-004-communication-core.mjs';
import {transactionP2016} from '../../app/server/src/p2-016-domain-contracts.mjs';
import {formatEpochMsToShanghaiLocal} from '../../app/server/src/platform/time-contract.mjs';
import {ticketNotificationP2016} from '../../app/server/src/p2-016-ticket-notification-policy.mjs';
import {createP2016TicketNotificationProjector} from '../../app/server/src/p2-016-ticket-notification-projector.mjs';
import {appendTicketEvent} from '../../app/server/src/p1-006-ticket-state-actions.mjs';
import type {LocalDateTime} from '../../contracts/time_contracts.js';

// Review R4/R5. All provider calls below terminate in this file's synthetic SDK.
// The existing fixture owns its UUID database and installs 071 after its other
// migrations. Explicit consumption avoids racing an automatic projector.
const fixtureOptions={mvpNotificationsEnabled:true,manualRoundConsumption:true,roundNotificationsOff:true};
const INTERNAL='关闭通知审查内部说明（合成）';
const CLOSE_TEXT='已按您的要求撤销本次报修。';
const RESTORE_TEXT='您的报修已重新受理，我们会继续处理。';
type Kind='TICKET'|'INTAKE';
interface Subject {kind:Kind;id:string;intakeId:string;receivedAt:LocalDateTime}
interface Closure {id:string;notification_message_id:string|null;restoration_notification_message_id:string|null;restoration_notification_processed_at:string|null}
type Qualification=(source:{botId:string;reporterUserId:string})=>Promise<boolean>;

function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
async function json(response:Response,status=200){const value:unknown=await response.json();assert.equal(response.status,status,JSON.stringify(value));return object(value);}
function wireText(body:unknown){const value=object(body);assert.ok(value.msgtype==='text'||value.msgtype==='markdown');const text=object(value[value.msgtype]).content;assert.equal(typeof text,'string');return text;}

async function seedSubject(f:T11Fixture,kind:Kind):Promise<Subject>{
 const seed=await seedPersistedIntake({pool:f.pool,text:'报修通知审查打印机故障（合成）',chatType:'single',requestType:'INCIDENT',status:'RECEIVED'});
 if(kind==='INTAKE')return {kind,id:seed.intakeId,intakeId:seed.intakeId,receivedAt:seed.receivedAt};
 const created=await createPilotTicketCore({pool:f.pool}).createForIntake({intakeId:seed.intakeId,occurredAt:seed.receivedAt,traceId:'card27c-review-synthetic'});assert.ok(created.ticket);
 return {kind,id:created.ticket.id,intakeId:seed.intakeId,receivedAt:seed.receivedAt};
}

async function subjectState(f:T11Fixture,subject:Subject){
 const http=await t11Http(f,0,{closeConnections:true});
 if(subject.kind==='TICKET')return http.detail(subject.id);
 const state=await json(await http.get('/api/intakes/'+subject.id+'/closure-context'));
 assert.equal(typeof state.status,'string');assert.equal(typeof state.version,'number');
 return {status:String(state.status),version:Number(state.version)};
}

async function intakePost(f:T11Fixture,subject:Subject,action:'close'|'restore',body:{client_command_id:string;expected_version:number;reason_code:string;note?:string}){
 const cookie=f.cookies[0];assert.ok(cookie);const http=await t11Http(f,0,{closeConnections:true});
 const boot=await json(await http.get('/api/lifecycle/bootstrap'));assert.equal(typeof boot.csrf_token,'string');
 return json(await fetch(f.origin+'/api/intakes/'+subject.id+'/'+action,{method:'POST',headers:{cookie,connection:'close',origin:f.origin,'content-type':'application/json','idempotency-key':body.client_command_id,'if-match':'"'+body.expected_version+'"','x-csrf-token':String(boot.csrf_token)},body:JSON.stringify(body)}));
}

async function transition(f:T11Fixture,subject:Subject,restoring=false){
 const before=await subjectState(f,subject),body={client_command_id:randomUUID(),expected_version:before.version,reason_code:restoring?'RESTORE_CLOSED':'REPORTER_WITHDREW',...(restoring?{}:{note:INTERNAL})};
 if(subject.kind==='INTAKE')await intakePost(f,subject,restoring?'restore':'close',body);
 else {const http=await t11Http(f,0,{closeConnections:true});await json(await http.post(subject.id,restoring?'restore':'dismiss',body));}
 return subjectState(f,subject);
}

async function latest(f:T11Fixture,subject:Subject){
 const row=(await f.pool.query<Closure>(`SELECT id::text,notification_message_id::text,restoration_notification_message_id::text,restoration_notification_processed_at::text FROM pilot_ticket.closure_record WHERE ${subject.kind==='TICKET'?'ticket_id':'intake_id'}=$1::uuid ORDER BY (restored_at IS NULL) DESC,ended_at DESC,id DESC LIMIT 1`,[subject.id])).rows[0];assert.ok(row);return row;
}
async function closure(f:T11Fixture,id:string){
 const row=(await f.pool.query<Closure>('SELECT id::text,notification_message_id::text,restoration_notification_message_id::text,restoration_notification_processed_at::text FROM pilot_ticket.closure_record WHERE id=$1::uuid',[id])).rows[0];assert.ok(row);return row;
}
async function delivery(f:T11Fixture,messageId:string|null){
 assert.ok(messageId);const rows=(await f.pool.query<{id:string}>('SELECT d.id::text FROM communication.outbox o JOIN communication.delivery d ON d.outbox_id=o.id WHERE o.message_id=$1::uuid',[messageId])).rows;assert.equal(rows.length,1);const row=rows[0];assert.ok(row);return row.id;
}
async function deliveryState(f:T11Fixture,id:string){
 const row=(await f.pool.query<{status:string;side_effect_state:string}>('SELECT status,side_effect_state FROM communication.delivery WHERE id=$1::uuid',[id])).rows[0];assert.ok(row);return row;
}
async function assertUnsent(f:T11Fixture,id:string){
 const saved=await deliveryState(f,id);assert.ok(['CANCELLED','DEAD_LETTER'].includes(saved.status),JSON.stringify(saved));assert.equal(saved.side_effect_state,'NOT_ATTEMPTED');
 assert.equal((await f.pool.query("SELECT 1 FROM communication.delivery_attempt WHERE delivery_id=$1::uuid AND side_effect_state IN ('ACKNOWLEDGED','UNKNOWN')",[id])).rowCount,0);
}

function senderHarness(f:T11Fixture,{qualify=async()=>true,unknown=false}:{qualify?:Qualification;unknown?:boolean}={}){
 let qualifications=0;const payloads:unknown[]=[];
 const sender=createP2016WeComSender({mvpPolicy:true,enabled:true,cardEnabled:true,allowedTargetHashes:[],linkMode:'MEMBER_REQUIRED',reporterAccess:f.runtime.reporterAccess,
  origin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],closureNotifications:{pool:f.pool},
  qualifyBotNotificationRecipient:async source=>{qualifications++;assert.deepEqual(source,{botId:'bot-test',reporterUserId:'user-test'});return qualify(source);},
  gateway:{getAuthenticatedClient:()=>({sendMessage:async(target,body)=>{assert.equal(target,'user-test');payloads.push(body);assert.equal(JSON.stringify(body).includes(INTERNAL),false);return unknown?{}:{errcode:0,headers:{req_id:'关闭通知回执（合成）-'+payloads.length}};}})}});
 const worker=createCommunicationDeliveryWorker({pool:f.pool,enabled:true,sender,attemptAdmission:createMvpNotificationAdmission(),maxDeliveriesPerTargetWindow:1000});
 return {worker,payloads,get qualifications(){return qualifications;}};
}

async function preparedNotice(f:T11Fixture,kind:Kind,restoring=false){
 const subject=await seedSubject(f,kind);await transition(f,subject);let record=await latest(f,subject);
 if(restoring){const ack=senderHarness(f);const result=await ack.worker.deliver({deliveryId:await delivery(f,record.notification_message_id)});assert.ok(result&&'status'in result);assert.equal(result.status,'SENT');assert.equal(ack.payloads.length,1);await transition(f,subject,true);record=await closure(f,record.id);}
 return {subject,record,deliveryId:await delivery(f,restoring?record.restoration_notification_message_id:record.notification_message_id)};
}

test('Card 27C-A review R4 real Bot sender qualifies closure and restoration text for both subjects without a static target allowlist',{timeout:300000},async t=>withT24Fixture(async f=>{
 for(const kind of ['TICKET','INTAKE'] as const)await t.test(kind,async()=>{
  const notice=await preparedNotice(f,kind),h=senderHarness(f);
  const first=await h.worker.deliver({deliveryId:notice.deliveryId});assert.ok(first&&'status'in first);assert.equal(first.status,'SENT');assert.equal(first.side_effect_state,'ACKNOWLEDGED');
  await transition(f,notice.subject,true);const restored=await closure(f,notice.record.id),restoredDelivery=await delivery(f,restored.restoration_notification_message_id);
  const second=await h.worker.deliver({deliveryId:restoredDelivery});assert.ok(second&&'status'in second);assert.equal(second.status,'SENT');assert.equal(second.side_effect_state,'ACKNOWLEDGED');
  assert.deepEqual(h.payloads.map(wireText),[CLOSE_TEXT,RESTORE_TEXT]);assert.equal(h.qualifications,2);
  assert.equal(await h.worker.deliver({deliveryId:notice.deliveryId}),null);assert.equal(await h.worker.deliver({deliveryId:restoredDelivery}),null);assert.equal(h.payloads.length,2);
 });
},fixtureOptions));

// Card 32D-L / ADR-0058 supplement: the persisted binding of each closure-side notice carries its own type; restoration no longer
// borrows TICKET_REOPENED, and the dismissal notice is never TICKET_CANCELLED.
test('Card 32D-L dismissal and restoration notices bind TICKET_DISMISSED and TICKET_RESTORED; reopening keeps TICKET_REOPENED',{timeout:300000},async()=>withT24Fixture(async f=>{
 const notice=await preparedNotice(f,'TICKET'),h=senderHarness(f);
 const sent=await h.worker.deliver({deliveryId:notice.deliveryId});assert.ok(sent&&'status'in sent);assert.equal(sent.status,'SENT');
 await transition(f,notice.subject,true);const restored=await closure(f,notice.record.id);await delivery(f,restored.restoration_notification_message_id);
 const ids=(await f.pool.query<{closure:string;restoration:string}>('SELECT closure_ticket_event_id::text AS closure,restoration_event_id::text AS restoration FROM pilot_ticket.closure_record WHERE id=$1::uuid',[notice.record.id])).rows[0];
 assert.ok(ids?.closure&&ids.restoration);
 const bindings=(await f.pool.query<{ticket_event_id:string;notification_type:string;message_id:string}>('SELECT ticket_event_id::text,notification_type,message_id::text FROM communication.ticket_notification_binding WHERE ticket_id=$1::uuid ORDER BY created_at,id',[notice.subject.id])).rows;
 const typeOf=(eventId:string)=>bindings.filter(row=>row.ticket_event_id===eventId).map(row=>row.notification_type);
 assert.deepEqual(typeOf(ids.closure),['TICKET_DISMISSED'],'the dismissal notice');
 assert.deepEqual(typeOf(ids.restoration),['TICKET_RESTORED'],'the restoration notice has its own type');
 assert.deepEqual(bindings.filter(row=>row.message_id===restored.restoration_notification_message_id).map(row=>row.notification_type),['TICKET_RESTORED']);
 assert.equal(bindings.some(row=>['TICKET_CANCELLED','TICKET_REOPENED'].includes(row.notification_type)),false,JSON.stringify(bindings));
 // Reopening a completed Ticket and the reminder before automatic completion keep their own policy types.
 const policy=(event_type:string,new_status:string)=>ticketNotificationP2016({event_type,new_status},{additionalEventTypes:[event_type]})?.notification_type;
 assert.equal(policy('ticket.reopened','REOPENED'),'TICKET_REOPENED');assert.equal(policy('ticket.restored','QUEUED'),'TICKET_RESTORED');
 assert.equal(policy('ticket.dismissed','DISMISSED'),'TICKET_DISMISSED');assert.equal(policy('ticket.auto_complete_reminder','RESOLVED'),'TICKET_RESOLVED');
 assert.equal(ticketNotificationP2016({event_type:'ticket.auto_close_reminder',new_status:'RESOLVED'}),null,'the old reminder event is not a ticket notification');
},fixtureOptions));

test('Card 32D-L a reopened completed Ticket persists a TICKET_REOPENED binding through the current notification projector',{timeout:300000},async()=>withT24Fixture(async f=>{
 const subject=await seedSubject(f,'TICKET');
 const reopened=(await f.pool.query<{status:string;version:number}>("UPDATE pilot_ticket.ticket SET status='REOPENED',version=version+1 WHERE id=$1::uuid RETURNING *",[subject.id])).rows[0];assert.ok(reopened);
 // Same synthetic writer as the closure cases: the reopen fact of a completed Ticket, then the real projector and binding table.
 await appendTicketEvent({transaction:f.pool,ticket:reopened as never,eventType:'ticket.reopened',oldStatus:'COMPLETED',actor:{type:'SYSTEM',id:null},traceId:'c32dl-reopened'});
 const eventId=String((await f.pool.query<{id:string}>("SELECT event_id::text AS id FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid AND event_type='ticket.reopened'",[subject.id])).rows[0]?.id);
 const projector=createP2016TicketNotificationProjector({enabled:true,mvpPolicy:true,reporterAccess:f.runtime.reporterAccess,additionalEventTypes:['ticket.reopened']});
 const result=await transactionP2016(f.pool,transaction=>projector.project({transaction,ticket:{id:subject.id},event:{event_id:eventId}}));
 assert.equal((result as {created?:boolean}).created,true,JSON.stringify(result));
 const bindings=(await f.pool.query<{notification_type:string}>('SELECT notification_type FROM communication.ticket_notification_binding WHERE ticket_id=$1::uuid AND ticket_event_id=$2::uuid',[subject.id,eventId])).rows;
 assert.deepEqual(bindings.map(row=>row.notification_type),['TICKET_REOPENED'],'reopening keeps its own type, never TICKET_RESTORED');
},fixtureOptions));

test('Card 27C-A review R4 closure qualification denial and changed source binding never reach the synthetic SDK',{timeout:300000},async t=>withT24Fixture(async f=>{
 for(const kind of ['TICKET','INTAKE'] as const)for(const restoring of [false,true])for(const mode of ['denied','binding-changed'] as const)await t.test(kind+' '+(restoring?'restore':'close')+' '+mode,async()=>{
  const notice=await preparedNotice(f,kind,restoring);
  const h=senderHarness(f,{qualify:async()=>{
   if(mode==='denied')return false;
   // This awaited mutation occurs after the sender's first durable basis read.
   const changed=await f.pool.query("UPDATE intake.service_intake SET reporter_wecom_userid='资格等待后已变更报修人（合成）' WHERE id=$1::uuid",[notice.subject.intakeId]);assert.equal(changed.rowCount,1);return true;
  }});
  await h.worker.deliver({deliveryId:notice.deliveryId});assert.equal(h.qualifications,1);assert.equal(h.payloads.length,0);await assertUnsent(f,notice.deliveryId);
 });
},fixtureOptions));

test('Card 27C-A review R4 final closure basis rechecks real close or restore transitions after member qualification waits',{timeout:300000},async t=>withT24Fixture(async f=>{
 for(const kind of ['TICKET','INTAKE'] as const)for(const restoring of [false,true])await t.test(kind+' '+(restoring?'restore then close':'close then restore'),async()=>{
  const notice=await preparedNotice(f,kind,restoring);
  const h=senderHarness(f,{qualify:async()=>{await transition(f,notice.subject,!restoring);return true;}});
  await h.worker.deliver({deliveryId:notice.deliveryId});assert.equal(h.qualifications,1);assert.equal(h.payloads.length,0);await assertUnsent(f,notice.deliveryId);
  assert.equal((await subjectState(f,notice.subject)).status,restoring?'DISMISSED':(kind==='TICKET'?'QUEUED':'RECEIVED'));
 });
},fixtureOptions));

test('Card 27C-A review R4 ordinary lifecycle text cannot borrow dynamic closure recipient qualification',{timeout:240000},async()=>withT24Fixture(async f=>{
 for(const forgeMarker of [false,true]){
  const expiry=String(Date.now()+2592000000);
  const message=await transactionP2016(f.pool,transaction=>appendCommunication({transaction,actor:null,command:{session_id:null,sender_kind:'SYSTEM',sender_system_code:'TICKET_LIFECYCLE',purpose:'SYSTEM_NOTIFICATION',message_type:'text',visibility:'EXTERNAL',client_command_id:randomUUID(),content:{text:RESTORE_TEXT,...(forgeMarker?{transport:'SERVICE_CLOSURE_TEXT'}:{})},destination_policy:'P2_016_REPORTER',privacy_class:'INTERNAL',retention_until:formatEpochMsToShanghaiLocal(expiry),retention_until_epoch_ms:expiry},resolvedDestinations:[{provider:'WECOM_AIBOT',channel_account_id:'bot-test',target_type:'PERSON',target_id:'user-test'}]}));
  assert.ok(message&&!('error'in message));const id=await delivery(f,message.message_id),h=senderHarness(f);
  await h.worker.deliver({deliveryId:id});assert.equal(h.qualifications,0);assert.equal(h.payloads.length,0);await assertUnsent(f,id);
 }
},fixtureOptions));

test('Card 27C-A review R5 reconciliation of an earlier UNKNOWN close never enqueues a superseded restoration',{timeout:300000},async t=>withT24Fixture(async f=>{
 for(const kind of ['TICKET','INTAKE'] as const)await t.test(kind,async()=>{
  const notice=await preparedNotice(f,kind),unknown=senderHarness(f,{unknown:true});
  const unresolved=await unknown.worker.deliver({deliveryId:notice.deliveryId});assert.ok(unresolved&&'status'in unresolved);assert.equal(unresolved.status,'RECONCILIATION_REQUIRED');assert.equal(unresolved.side_effect_state,'UNKNOWN');assert.equal(unknown.payloads.length,1);
  await transition(f,notice.subject,true);assert.equal((await closure(f,notice.record.id)).restoration_notification_message_id,null);
  await transition(f,notice.subject);const second=await latest(f,notice.subject);assert.notEqual(second.id,notice.record.id);const ack=senderHarness(f);
  const secondDelivery=await ack.worker.deliver({deliveryId:await delivery(f,second.notification_message_id)});assert.ok(secondDelivery&&'status'in secondDelivery);assert.equal(secondDelivery.status,'SENT');
  const reconciled=await createCommunicationReconciliationPort({pool:f.pool}).reconcileUnknownDelivery({deliveryId:notice.deliveryId,expectedStatus:'RECONCILIATION_REQUIRED',resolution:'CONFIRMED_SENT',reasonCode:'CARD27C_SYNTHETIC_CONFIRMED_SENT',authorized:true});assert.ok(reconciled&&'status'in reconciled);assert.equal(reconciled.status,'SENT');
  await f.runtime.notifications.projectPendingClosures({pool:f.pool});await f.runtime.notifications.projectPendingClosures({pool:f.pool});
  const old=await closure(f,notice.record.id);assert.equal(old.restoration_notification_message_id,null);assert.ok(old.restoration_notification_processed_at,'superseded work is durably consumed');
  assert.equal((await subjectState(f,notice.subject)).status,'DISMISSED');assert.deepEqual(ack.payloads.map(wireText),[CLOSE_TEXT]);
 });
},fixtureOptions));

test('Card 27C-A review R5 an already queued restoration is rejected after the next closure',{timeout:300000},async t=>withT24Fixture(async f=>{
 for(const kind of ['TICKET','INTAKE'] as const)await t.test(kind,async()=>{
  const notice=await preparedNotice(f,kind,true);await transition(f,notice.subject);const next=await latest(f,notice.subject);assert.notEqual(next.id,notice.record.id);
  const h=senderHarness(f);await h.worker.deliver({deliveryId:notice.deliveryId});assert.equal(h.payloads.length,0);await assertUnsent(f,notice.deliveryId);
  const sent=await h.worker.deliver({deliveryId:await delivery(f,next.notification_message_id)});assert.ok(sent&&'status'in sent);assert.equal(sent.status,'SENT');assert.deepEqual(h.payloads.map(wireText),[CLOSE_TEXT]);
 });
},fixtureOptions));

test('Card 27C-A review R5 an Intake restoration cannot announce acceptance after its canonical Ticket has closed',{timeout:240000},async()=>withT24Fixture(async f=>{
 const notice=await preparedNotice(f,'INTAKE',true);
 const promoted=await createPilotTicketCore({pool:f.pool}).createForIntake({intakeId:notice.subject.intakeId,occurredAt:notice.subject.receivedAt,traceId:'canonical-ticket-关闭通知（合成）'});assert.ok(promoted.ticket);
 const canonical:Subject={...notice.subject,kind:'TICKET',id:promoted.ticket.id};await transition(f,canonical);
 const h=senderHarness(f);await h.worker.deliver({deliveryId:notice.deliveryId});assert.equal(h.payloads.length,0);await assertUnsent(f,notice.deliveryId);assert.equal((await subjectState(f,canonical)).status,'DISMISSED');
},fixtureOptions));
