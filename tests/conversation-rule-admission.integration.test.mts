import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {IncomingMessage} from 'node:http';
import {Socket} from 'node:net';
import {withT22Fixture} from './helpers/wbint-t22-fixture.mjs';
import {addInboxSession,attachInboxJourney,conversationPost,freshCommand,INBOX_IDENTITY_KEY} from './helpers/conversation-inbox-fixture.mjs';
import type {InboxSession} from './helpers/conversation-inbox-fixture.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import type {T22Fixture} from './helpers/wbint-t22-fixture.mjs';
import {createP2016OrchestrationWorker} from '../src/p2-016-orchestration-adapters.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import {createCommunicationDeliveryWorker} from '../src/p2-004-communication-delivery-worker.mjs';
import {composeConversationRuleAdmission} from '../src/conversation-rule-admission.mjs';
import {MockResolvedDirectory} from '../src/p2-015-contact-journey.mjs';
import {createManualReviewStore} from '../src/p2-015-manual-review.mjs';
import {t31Http} from './helpers/t31-public-progress-fixture.mjs';
import {randomUUID} from 'node:crypto';
import type {CommunicationSenderResult} from '../src/p2-004-communication-sender-port.mjs';

async function produce(f:T22Fixture){
  const worker=createP2016OrchestrationWorker({pool:f.pool,identityHmacKey:INBOX_IDENTITY_KEY,notifications:f.runtime.notifications,realtime:f.runtime.realtimeProjector,directoryPort:MockResolvedDirectory({contact:{name:'合成报修人'}})});
  await worker.processDueBatch({feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true},batch_size:50,now_epoch_ms:String(Date.now()+10000)});
}
async function deliveries(pool:PostgresPool,session:InboxSession){
  return (await pool.query<{id:string;journey_id:string;client_command_id:string;action_id:string}>(`SELECT d.id::text,decision.journey_id::text,m.client_command_id::text,a.id::text AS action_id
    FROM communication.message m JOIN communication.outbox o ON o.message_id=m.id JOIN communication.delivery d ON d.outbox_id=o.id
    JOIN intake.channel_leg l ON l.source_intake_id=$1::uuid JOIN intake.deterministic_decision decision ON decision.channel_leg_id=l.id
    JOIN intake.safe_action_suggestion a ON a.decision_id=decision.id AND a.action_type='REQUEST_ONE_DESCRIPTION'
    WHERE m.session_id=$2::uuid AND m.sender_system_code='RULE_FIRST_ORCHESTRATOR' ORDER BY d.id`,[session.intakeId,session.id])).rows;
}
async function saved(pool:PostgresPool,id:string){return (await pool.query('SELECT status,side_effect_state,last_error_code FROM communication.delivery WHERE id=$1::uuid',[id])).rows[0];}
const acknowledged:CommunicationSenderResult={outcome:'ACKNOWLEDGED',provider_message_id:'synthetic-local-only',error_code:null,retryable:false};

test('queued ordinary rules pause across reliable windows, remain paused after release, and leave separate people/topics and human-approved actions usable',async()=>{
  await withT22Fixture(async f=>{
    const a=await addInboxSession(f.pool,{reporter:'rules-a',group:'rules-shared',text:'系统不行'});
    const otherTopic=await addInboxSession(f.pool,{reporter:a.reporter,group:'rules-other',text:'系统不行'});
    const otherPerson=await addInboxSession(f.pool,{reporter:'rules-b',group:a.group,text:'系统不行'});
    await produce(f);
    const [queued,independent,another]=await Promise.all([deliveries(f.pool,a),deliveries(f.pool,otherTopic),deliveries(f.pool,otherPerson)]);
    assert.equal(queued.length,2,'real group guidance must include its exact derived private command');assert.equal(independent.length,2);assert.equal(another.length,2);
    assert.ok(queued.some(row=>row.action_id!==row.client_command_id));const first=queued[0];assert.ok(first);
    const direct=await addInboxSession(f.pool,{reporter:a.reporter,group:null,text:'同一问题的私聊补充'});await attachInboxJourney(f.pool,direct,{journeyId:first.journey_id});
    assert.equal((await conversationPost(f.origin,f.cookie,direct.id,'takeover',freshCommand())).status,200);
    let sent=0,prior=0;const worker=createCommunicationDeliveryWorker({pool:f.pool,enabled:true,attemptAdmission:composeConversationRuleAdmission(async()=>{prior++;return true;}),sender:{send:async()=>{sent++;return acknowledged;}}});
    await worker.deliver({deliveryId:first.id});assert.equal(sent,0);assert.deepEqual(await saved(f.pool,first.id),{status:'CANCELLED',side_effect_state:'NOT_ATTEMPTED',last_error_code:'COMMUNICATION_RULE_REPLY_SUPPRESSED'});
    const version=(await f.pool.query<{row_version:number}>('SELECT row_version::integer FROM conversation.session WHERE id=$1::uuid',[direct.id])).rows[0]?.row_version;assert.ok(version);
    assert.equal((await conversationPost(f.origin,f.cookie,direct.id,'release',freshCommand(version))).status,200);
    const second=queued[1];assert.ok(second);await worker.deliver({deliveryId:second.id});assert.equal(sent,0);assert.equal((await saved(f.pool,second.id))?.status,'CANCELLED');
    for(const row of [...independent,...another])await worker.deliver({deliveryId:row.id});assert.equal(sent,4);assert.equal(prior,6);
    // A real manual-review resolution creates a HUMAN_OVERRIDDEN Decision and
    // explicit safety actions; it must survive this topic's existing human history.
    await produce(f);
    const decision=(await f.pool.query<{id:string}>("SELECT id::text FROM intake.deterministic_decision WHERE service_intake_id=$1::uuid ORDER BY decision_ordinal DESC LIMIT 1",[direct.intakeId])).rows[0];assert.ok(decision);
    const review=await createManualReviewStore().enqueue({transaction:f.pool,input:{decision_id:decision.id,journey_id:first.journey_id,service_intake_id:direct.intakeId,review_reason_code:'SYNTHETIC_REQUESTED_REVIEW'}});
    const request=new IncomingMessage(new Socket());request.headers.cookie=f.cookie;
    try{const resolved=await f.runtime.reviews.resolveManualReview({authContext:await f.runtime.authenticate.authenticate(request),reviewId:review.id,body:{...freshCommand(),expected_row_version:String(review.row_version),resolution_code:'REQUEST_DESCRIPTION',resolution_reason_code:'HUMAN_REQUESTED_DESCRIPTION'}});assert.equal(resolved.ok,true,JSON.stringify(resolved));}finally{request.socket.destroy();}
    const approved=(await f.pool.query<{id:string}>(`SELECT d.id::text FROM communication.delivery d JOIN communication.outbox o ON o.id=d.outbox_id JOIN communication.message m ON m.id=o.message_id
      JOIN intake.safe_action_suggestion a ON a.id=m.client_command_id JOIN intake.deterministic_decision dec ON dec.id=a.decision_id WHERE dec.journey_id=$1::uuid AND dec.status='HUMAN_OVERRIDDEN'`,[first.journey_id])).rows;assert.ok(approved.length>0);
    for(const row of approved)await worker.deliver({deliveryId:row.id});assert.equal(sent,4+approved.length);
  },{inbox:true,realtime:true});
});

test('mounting rule admission alone preserves the missing Incident admission rejection',async()=>{
  await t31Http({purpose:'cirules'},async({pool,confirm,post})=>{
    const incident=await confirm(),published=await post('/api/incidents/'+incident+'/publish-update',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'WORKBENCH_PUBLIC_PROGRESS',summary:'合成独立准入边界',preview_confirmed:true});assert.equal(published.status,200);
    const rows=(await pool.query<{id:string}>(`SELECT d.id::text FROM communication.delivery d JOIN communication.outbox o ON o.id=d.outbox_id
      JOIN communication.incident_notification_binding b ON b.communication_message_id=o.message_id WHERE b.incident_event_id=$1::uuid`,[published.body.result_event_id])).rows;assert.ok(rows.length>0);
    let calls=0;const worker=createCommunicationDeliveryWorker({pool,enabled:true,attemptAdmission:composeConversationRuleAdmission(),sender:{send:async()=>{calls++;return acknowledged;}}});
    for(const row of rows){await worker.deliver({deliveryId:row.id});assert.equal((await saved(pool,row.id))?.status,'CANCELLED');}assert.equal(calls,0);
  });
});

test('the composed runtime orders a takeover before admission, while a send already admitted retains UNKNOWN without a resend',async()=>{
  await withT22Fixture(async f=>{
    const waiting=await addInboxSession(f.pool,{reporter:'order-a',group:null,text:'系统不行'}),crossed=await addInboxSession(f.pool,{reporter:'order-b',group:null,text:'系统不行'});await produce(f);
    const [first]=await deliveries(f.pool,waiting),[second]=await deliveries(f.pool,crossed);assert.ok(first);assert.ok(second);
    let calls=0,entered:()=>void=()=>{},finish:(result:CommunicationSenderResult)=>void=()=>{};
    const atSender=new Promise<void>(resolve=>{entered=resolve;}),result=new Promise<CommunicationSenderResult>(resolve=>{finish=resolve;});
    let admissionEntered:()=>void=()=>{},continueAdmission:()=>void=()=>{};
    const beforeAdmission=new Promise<void>(resolve=>{admissionEntered=resolve;}),admissionGate=new Promise<void>(resolve=>{continueAdmission=resolve;});
    const runtime=createP2016Runtime({pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:f.origin,principalIds:[f.principals[0]?.id??''],externalSendEnabled:false,
      deliveryAttemptAdmission:async({deliveryId})=>{if(deliveryId===first.id){admissionEntered();await admissionGate;}return true;},
      senderAdapter:{send:async()=>{calls++;entered();return result;}}});
    try{
      const held=runtime.communicationWorker.deliver({deliveryId:first.id});await beforeAdmission;
      assert.equal((await saved(f.pool,first.id))?.status,'LEASED');
      assert.equal((await conversationPost(f.origin,f.cookie,waiting.id,'takeover',freshCommand())).status,200);
      continueAdmission();await held;assert.equal(calls,0);
      const sending=runtime.communicationWorker.deliver({deliveryId:second.id});await atSender;
      assert.equal((await conversationPost(f.origin,f.cookie,crossed.id,'takeover',freshCommand())).status,200);
      finish({outcome:'UNKNOWN',provider_message_id:null,error_code:'SYNTHETIC_RESPONSE_LOST',retryable:false});await sending;assert.equal(calls,1);
      assert.equal((await saved(f.pool,second.id))?.status,'RECONCILIATION_REQUIRED');await runtime.communicationWorker.deliver({deliveryId:second.id});assert.equal(calls,1);
    }finally{continueAdmission();finish(acknowledged);await runtime.stop();}
  },{inbox:true,realtime:true});
});

test('a real split-process Worker mounts rule admission; the public no-hook factory fails closed for an unprovable rule source',async()=>{
  await withT22Fixture(async f=>{
    const session=await addInboxSession(f.pool,{reporter:'split-a',group:null,text:'系统不行'});await produce(f);const [queued]=await deliveries(f.pool,session);assert.ok(queued);
    assert.equal((await conversationPost(f.origin,f.cookie,session.id,'takeover',freshCommand())).status,200);
    const child=fork(new URL('../scripts/p2-g1-process-role.mjs',import.meta.url),['--role=WORKER'],{env:{...process.env,PILOT_DATABASE_URL:f.databaseUrl,P2_G1_SENDER_ENABLED:'true'},stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});
    let calls=0,legacyCalls=0,stderr='';child.stderr?.on('data',(bytes:Buffer)=>{stderr+=bytes.toString();});child.on('message',(raw:unknown)=>{if(raw&&typeof raw==='object'&&'type'in raw&&raw.type==='provider-send-request'&&'request_id'in raw&&typeof raw.request_id==='string'&&'request'in raw&&raw.request&&typeof raw.request==='object'&&'delivery_id'in raw.request){if(raw.request.delivery_id===queued.id)calls++;else legacyCalls++;child.send({type:'provider-send-response',request_id:raw.request_id,ok:true,result:acknowledged});}});
    try{
      const deadline=Date.now()+10000;let state:unknown;while(Date.now()<deadline){state=await saved(f.pool,queued.id);if(state&&typeof state==='object'&&'status'in state&&state.status==='CANCELLED')break;await new Promise(resolve=>setTimeout(resolve,50));}
      assert.equal((state as {status:string}).status,'CANCELLED',stderr);assert.equal(calls,0);
      console.log('CONVERSATION_SPLIT_WORKER '+JSON.stringify({suppressed_sender_calls:calls,unrelated_sender_calls:legacyCalls}));
    }finally{if(child.exitCode===null){const ended=once(child,'exit');child.send({type:'stop'});const timer=setTimeout(()=>child.kill('SIGKILL'),5000);try{await ended;}finally{clearTimeout(timer);}}child.stderr?.destroy();assert.equal(child.exitCode,0);}
    const raw=await addInboxSession(f.pool,{reporter:'no-proof',group:null,text:'系统不行'});await produce(f);const [unproven]=await deliveries(f.pool,raw);assert.ok(unproven);
    let unprotected=0;const direct=createCommunicationDeliveryWorker({pool:f.pool,enabled:true,sender:{send:async()=>{unprotected++;return acknowledged;}}});await direct.deliver({deliveryId:unproven.id});assert.equal(unprotected,0);assert.equal((await saved(f.pool,unproven.id))?.status,'CANCELLED');
  },{inbox:true,realtime:true});
});
