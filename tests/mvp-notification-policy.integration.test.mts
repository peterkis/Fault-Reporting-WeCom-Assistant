import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {createPilotTicketCore} from '../src/p1-005-pilot-ticket-core.mjs';
import {createTicketRoundNotifications} from '../src/workbench-ticket-round-notifications.mjs';
import {createP2016WeComSender} from '../src/p2-016-wecom-sender.mjs';
import {createCommunicationDeliveryWorker,createCommunicationReconciliationPort} from '../src/p2-004-communication-delivery-worker.mjs';
import {createMvpNotificationAdmission} from '../src/mvp-group-replies.mjs';
import {composeConversationRuleAdmission} from '../src/conversation-rule-admission.mjs';
import {createWorkbenchBotMemberAdmission} from '../src/human-workbench-bot-member-admission.mjs';

test('MVP actual handling and completion use independent private notices and only the exact configured group completion Webhooks',{timeout:240000},async()=>{
 const targets=[{botId:'bot-test',groupId:'group-mvp-a'},{botId:'bot-test',groupId:'group-mvp-b'}];
 await withT24Fixture(async context=>{
  const http=await t11Http(context),items:{id:string;ticketNo:string;group:string}[]=[],payloads:{key:string;body:unknown}[]=[],cards:unknown[]=[];
  for(const tag of ['mvp-a','mvp-b','mvp-no-hook']){
   const intake=await seedPersistedIntake({pool:context.pool,text:'MVP_PRIVATE_MATERIAL 打印机打印不了',chatType:'group',requestType:'INCIDENT',status:'RECEIVED',tag});
   const created=await createPilotTicketCore({pool:context.pool}).createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:tag});assert.ok(created.ticket);
   const started=await http.start(created.ticket.id);await context.runtime.roundNotifications.runOnce();
   const first=await context.pool.query<{node:string;destination_type:string}>('SELECT r.node,r.destination_type FROM communication.ticket_round_notification_binding r WHERE ticket_id=$1::uuid',[created.ticket.id]);
   assert.deepEqual(first.rows,[{node:'FIRST_HANDLING',destination_type:'PERSON'}]);
   const body=http.command(started);assert.equal((await http.post(created.ticket.id,'complete',body)).status,200);assert.equal((await http.post(created.ticket.id,'complete',body)).status,200);
   await context.runtime.roundNotifications.runOnce();await context.runtime.roundNotifications.runOnce();
   items.push({id:created.ticket.id,ticketNo:started.ticket_no,group:'group-'+tag});
  }
  const sender=createP2016WeComSender({mvpPolicy:true,gateway:{getAuthenticatedClient:()=>({sendMessage:async(_target,body)=>{cards.push(body);return {errcode:0};}})},
   enabled:true,cardEnabled:true,allowedTargetHashes:[],qualifyBotNotificationRecipient:async source=>{assert.equal(source.botId,'bot-test');assert.equal(source.reporterUserId,'user-test');return true;},reporterAccess:context.runtime.reporterAccess,
   origin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],linkMode:'MEMBER_REQUIRED',
   groupRoundNotifications:{pool:context.pool,mvpPolicy:true,routes:targets.map((t,i)=>({...t,url:'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=synthetic-'+i})),
    resolveMentionUserId:async source=>{assert.equal(source.reporterUserId,'user-test');return 'qualified-original-reporter';},
    fetchImpl:async(input,init)=>{payloads.push({key:new URL(String(input)).searchParams.get('key')??'',body:JSON.parse(String(init?.body))});return new Response('{"errcode":0}');}}});
  const worker=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender,attemptAdmission:composeConversationRuleAdmission(createMvpNotificationAdmission())});
  for(const item of items){
   const deliveries=await context.pool.query<{id:string}>('SELECT delivery_id::text AS id FROM communication.ticket_notification_binding WHERE ticket_id=$1::uuid ORDER BY created_at,id',[item.id]);
   assert.equal(deliveries.rowCount,item.group==='group-mvp-no-hook'?2:3);
   for(const d of deliveries.rows){const sent=await worker.deliver({deliveryId:d.id});assert.ok(sent&&'status'in sent);assert.equal(sent.status,'SENT');assert.equal(await worker.deliver({deliveryId:d.id}),null);}
  }
  assert.equal(cards.length,6);assert.equal(payloads.length,2);
  for(const [i,payload] of payloads.entries()){
   assert.equal(payload.key,'synthetic-'+i);
   assert.deepEqual(payload.body,{msgtype:'text',text:{content:'工单#'+items[i]?.ticketNo+'小修已完成，麻烦您验收一下，有问题随时@医小修～',mentioned_list:['qualified-original-reporter']}});
  }
  const json=JSON.stringify(cards);assert.equal(json.includes('主动单聊'),false);assert.equal(json.includes('群聊报修'),false);assert.equal(json.includes('工程师正在处理你的工单'),true);
  assert.equal(JSON.stringify([...cards,...payloads]).includes('MVP_PRIVATE_MATERIAL'),false);assert.equal(JSON.stringify([...cards,...payloads]).includes('INTERNAL_T11_CANARY'),false);
 },{mvpNotificationsEnabled:true,groupNotificationTargets:targets,manualRoundConsumption:true});
});

test('MVP original Bot private and group completion notices recover from temporary member lookup outages without duplicate sends',{timeout:240000},async()=>{
 const groupId='group-mvp-bot-recovery';
 await withT24Fixture(async context=>{
  const intake=await seedPersistedIntake({pool:context.pool,text:'合成打印机打印不了',chatType:'group',requestType:'INCIDENT',status:'RECEIVED',tag:'mvp-bot-recovery'});
  const created=await createPilotTicketCore({pool:context.pool}).createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:'mvp-bot-recovery'});assert.ok(created.ticket);
  const http=await t11Http(context),started=await http.start(created.ticket.id);await context.runtime.roundNotifications.runOnce();assert.equal((await http.post(created.ticket.id,'complete',http.command(started))).status,200);await context.runtime.roundNotifications.runOnce();
  let unavailable=true,privateSends=0,groupSends=0;
  const admission=createWorkbenchBotMemberAdmission({botId:'bot-test',accessTokenProvider:async()=> 'SYNTHETIC_TOKEN',fetchImpl:async input=>{
   if(unavailable)return new Response('synthetic outage',{status:503});const url=new URL(input instanceof Request?input.url:String(input));
   return new Response(JSON.stringify(url.pathname.endsWith('/user/get')?{errcode:0,userid:'open-original-reporter',status:1}:{errcode:0,open_userid_list:[{userid:'user-test',open_userid:'open-original-reporter'}]}));
  }});
  const sender=createP2016WeComSender({mvpPolicy:true,enabled:true,cardEnabled:true,allowedTargetHashes:[],linkMode:'MEMBER_REQUIRED',reporterAccess:context.runtime.reporterAccess,origin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],
   qualifyBotNotificationRecipient:source=>admission.qualifyDelivery({provider:'WECOM_AIBOT',bot_id:source.botId,sender_user_id:source.reporterUserId,chat_type:'single'}),gateway:{getAuthenticatedClient:()=>({sendMessage:async()=>{privateSends++;return {errcode:0};}})},
   groupRoundNotifications:{pool:context.pool,mvpPolicy:true,routes:[{botId:'bot-test',groupId,url:'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=synthetic-recovery'}],resolveMentionUserId:async source=>await admission.qualifyDelivery({provider:'WECOM_AIBOT',bot_id:source.botId,sender_user_id:source.reporterUserId,chat_type:'group',chat_id:source.groupId})?source.reporterUserId:null,
    fetchImpl:async(_input,init)=>{groupSends++;assert.deepEqual(JSON.parse(String(init?.body)).text.mentioned_list,['user-test']);return new Response('{"errcode":0}');}}});
  const worker=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender,attemptAdmission:composeConversationRuleAdmission(createMvpNotificationAdmission())});
  const notices=(await context.pool.query<{id:string}>('SELECT delivery_id::text AS id FROM communication.ticket_notification_binding WHERE ticket_id=$1::uuid ORDER BY id',[created.ticket.id])).rows;assert.equal(notices.length,3);
  for(const row of notices){const result=await worker.deliver({deliveryId:row.id});assert.ok(result&&'status'in result);assert.equal(result.status,'PENDING');assert.equal(result.side_effect_state,'NOT_ATTEMPTED');}
  assert.equal(privateSends,0);assert.equal(groupSends,0);unavailable=false;
  await context.pool.query('WITH stamp AS(SELECT platform.physical_epoch_ms() AS epoch) UPDATE communication.delivery SET next_attempt_epoch_ms=epoch,next_attempt_at=platform.local_from_epoch_ms(epoch) FROM stamp WHERE id=ANY($1::uuid[])',[notices.map(row=>row.id)]);
  for(const row of notices){const result=await worker.deliver({deliveryId:row.id});assert.ok(result&&'status'in result);assert.equal(result.status,'SENT');assert.equal(await worker.deliver({deliveryId:row.id}),null);}
  assert.equal(privateSends,2);assert.equal(groupSends,1);
 },{mvpNotificationsEnabled:true,groupNotificationTargets:[{botId:'bot-test',groupId}],manualRoundConsumption:true});
});

for(const priorState of ['DEAD_LETTER','SENT','RECONCILIATION_REQUIRED','CANCELLED_UNKNOWN'] as const)test('MVP upgrade respects the original side-effect evidence of '+priorState,{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const http=await t11Http(context),initial=await http.detail(context.ticketId),person=context.principals[0];assert.ok(person);
  assert.equal((await http.post(context.ticketId,'assign',{client_command_id:randomUUID(),expected_version:initial.version,reason_code:'MVP_LEGACY_ASSIGN',target_principal_id:person.id,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]})).status,200);
  const legacy=createTicketRoundNotifications({pool:context.pool,enabled:true,botId:'bot-test',reporterAccess:context.runtime.reporterAccess});await legacy.runOnce();
  const old=(await context.pool.query<{id:string;content_hash:string}>(`SELECT d.id::text,m.content_hash FROM communication.ticket_notification_binding b JOIN communication.delivery d ON d.id=b.delivery_id JOIN communication.message m ON m.id=b.message_id WHERE b.ticket_id=$1::uuid`,[context.ticketId])).rows[0];assert.ok(old);
  const worker=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender:{send:async()=>priorState==='DEAD_LETTER'?{outcome:'REJECTED_NOT_APPLIED',provider_message_id:null,error_code:'SYNTHETIC_PRE_SEND_REJECTION',retryable:false}:priorState==='SENT'?{outcome:'ACKNOWLEDGED',provider_message_id:'synthetic-old-ack',error_code:null,retryable:false}:{outcome:'UNKNOWN',provider_message_id:null,error_code:'SYNTHETIC_OLD_UNKNOWN',retryable:false}}});
  await worker.deliver({deliveryId:old.id});
  if(priorState==='CANCELLED_UNKNOWN'){
   const cancelled=await createCommunicationReconciliationPort({pool:context.pool}).reconcileUnknownDelivery({deliveryId:old.id,expectedStatus:'RECONCILIATION_REQUIRED',resolution:'CANCEL',reasonCode:'SYNTHETIC_OPERATOR_CANCEL',authorized:true});assert.ok(cancelled&&'status'in cancelled);assert.equal(cancelled.status,'CANCELLED');
  }
  await http.start(context.ticketId);await context.runtime.roundNotifications.runOnce();await context.runtime.roundNotifications.runOnce();
  const replacement=await context.pool.query("SELECT 1 FROM communication.ticket_round_notification_binding WHERE ticket_id=$1::uuid AND node='FIRST_HANDLING'",[context.ticketId]);
  assert.equal(replacement.rows.length,priorState==='DEAD_LETTER'?1:0,'only a proven unattempted legacy notice can be retired');
  const saved=(await context.pool.query<{status:string;side_effect_state:string}>('SELECT status,side_effect_state FROM communication.delivery WHERE id=$1::uuid',[old.id])).rows[0];assert.ok(saved);
  if(priorState==='DEAD_LETTER'){
   assert.deepEqual(saved,{status:'CANCELLED',side_effect_state:'NOT_ATTEMPTED'});
   assert.equal((await context.pool.query("SELECT 1 FROM communication.delivery_attempt WHERE delivery_id=$1::uuid AND outcome='CANCELLED' AND side_effect_state='NOT_ATTEMPTED'",[old.id])).rows.length,1);
  }else assert.equal(saved.side_effect_state,priorState==='SENT'?'ACKNOWLEDGED':'UNKNOWN');
  assert.equal((await context.pool.query<{content_hash:string}>('SELECT m.content_hash FROM communication.message m JOIN communication.outbox o ON o.message_id=m.id JOIN communication.delivery d ON d.outbox_id=o.id WHERE d.id=$1::uuid',[old.id])).rows[0]?.content_hash,old.content_hash);
 },{mvpNotificationsEnabled:true,ticketAssignmentEnabled:true,manualRoundConsumption:true});
});

test('MVP Bot member qualification rechecks the retained original inbox after its last await before sending a private card',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const http=await t11Http(context);await http.start(context.ticketId);await context.runtime.roundNotifications.runOnce();
  const delivery=(await context.pool.query<{id:string}>("SELECT b.delivery_id::text AS id FROM communication.ticket_round_notification_binding r JOIN communication.ticket_notification_binding b ON b.id=r.notification_binding_id WHERE r.ticket_id=$1::uuid AND r.node='FIRST_HANDLING'",[context.ticketId])).rows[0];assert.ok(delivery);
  const source=(await context.pool.query<{primary_message_id:string}>('SELECT i.primary_message_id::text FROM pilot_ticket.ticket t JOIN intake.service_intake i ON i.id=t.source_intake_id WHERE t.id=$1::uuid',[context.ticketId])).rows[0];assert.ok(source);
  let qualified=0,sdk=0;
  const sender=createP2016WeComSender({mvpPolicy:true,enabled:true,cardEnabled:true,allowedTargetHashes:[],linkMode:'MEMBER_REQUIRED',reporterAccess:context.runtime.reporterAccess,
   origin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],gateway:{getAuthenticatedClient:()=>({sendMessage:async()=>{sdk++;return {errcode:0};}})},
   qualifyBotNotificationRecipient:async()=>{
    qualified++;await context.pool.query(`WITH stamp AS(SELECT platform.physical_epoch_ms()-1 AS cutoff)
     UPDATE channel.message_inbox SET retention_until=platform.local_from_epoch_ms(cutoff),retention_until_epoch_ms=cutoff FROM stamp WHERE id=$1::bigint`,[source.primary_message_id]);return true;
   }});
  const worker=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender,attemptAdmission:composeConversationRuleAdmission(createMvpNotificationAdmission())});
  const result=await worker.deliver({deliveryId:delivery.id});assert.ok(result&&'status'in result);assert.equal(result.status,'DEAD_LETTER');assert.equal(result.side_effect_state,'NOT_ATTEMPTED');
  assert.equal(qualified,1);assert.equal(sdk,0);
 },{mvpNotificationsEnabled:true,manualRoundConsumption:true});
});

test('MVP queued assignment stays silent and cancels an obsolete unattempted notice; real handling and reopened rounds preserve original responsibility facts',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const id=context.ticketId,http=await t11Http(context),initial=await http.detail(id),person=context.principals[0];assert.ok(person);
  const assign={client_command_id:randomUUID(),expected_version:initial.version,reason_code:'MVP_QUEUED',target_principal_id:person.id,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]};
  assert.equal((await http.post(id,'assign',assign)).status,200);
  await context.runtime.roundNotifications.runOnce();assert.equal((await context.pool.query('SELECT 1 FROM communication.ticket_notification_binding WHERE ticket_id=$1::uuid',[id])).rowCount,0);
  const responsibility=(await http.detail(id)).handling_cycle?.first_responsibility_event_id;assert.ok(responsibility);
  // Produce an actual old-policy promise to prove forward cancellation, without rewriting its immutable message.
  const legacy=createTicketRoundNotifications({pool:context.pool,enabled:true,botId:'bot-test',reporterAccess:context.runtime.reporterAccess});await legacy.runOnce();
  const old=(await context.pool.query<{id:string;content_hash:string}>(`SELECT d.id::text,m.content_hash FROM communication.ticket_notification_binding b JOIN communication.delivery d ON d.id=b.delivery_id JOIN communication.message m ON m.id=b.message_id WHERE b.ticket_id=$1::uuid`,[id])).rows[0];assert.ok(old);
  let sends=0;const worker=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender:{send:async()=>{sends++;return {outcome:'ACKNOWLEDGED',provider_message_id:null,error_code:null,retryable:false};}},attemptAdmission:composeConversationRuleAdmission(createMvpNotificationAdmission())});
  await worker.deliver({deliveryId:old.id});
  const cancelled=(await context.pool.query<{status:string;side_effect_state:string}>('SELECT status,side_effect_state FROM communication.delivery WHERE id=$1::uuid',[old.id])).rows[0];
  assert.deepEqual(cancelled,{status:'CANCELLED',side_effect_state:'NOT_ATTEMPTED'});assert.equal(sends,0);
  const beforeAccept=await http.detail(id);assert.equal((await http.post(id,'accept-for-later',{client_command_id:randomUUID(),expected_version:beforeAccept.version,reason_code:'MVP_ACCEPT',resolver_team_id:'PILOT_IT'})).status,200);
  await context.runtime.roundNotifications.runOnce();
  let current=await http.start(id);await context.runtime.roundNotifications.runOnce();
  assert.equal(current.handling_cycle?.first_responsibility_event_id,responsibility);
  const first=(await context.pool.query<{node:string;event_id:string}>(`SELECT r.node,b.ticket_event_id::text AS event_id FROM communication.ticket_round_notification_binding r JOIN communication.ticket_notification_binding b ON b.id=r.notification_binding_id WHERE r.ticket_id=$1::uuid AND r.node='FIRST_HANDLING'`,[id])).rows;
  assert.equal(first.length,1);assert.notEqual(first[0]?.event_id,responsibility);
  assert.equal((await http.post(id,'complete',http.command(current))).status,200);await context.runtime.roundNotifications.runOnce();
  current=await http.detail(id);assert.equal((await http.post(id,'reopen',{client_command_id:randomUUID(),expected_version:current.version,reason_code:'MVP_REOPEN',note:'仅内部合成重开',external_visible:false})).status,200);
  const reopened=await http.detail(id);assert.equal(reopened.ticket_no,current.ticket_no);assert.equal(reopened.handling_cycle?.cycle_no,2);
  current=await http.start(id);await context.runtime.roundNotifications.runOnce();assert.equal((await http.post(id,'complete',http.command(current))).status,200);await context.runtime.roundNotifications.runOnce();
  const fresh=createTicketRoundNotifications({pool:context.pool,mvpPolicy:true,enabled:true,botId:'bot-test',reporterAccess:context.runtime.reporterAccess,templateVersion:'mvp-round-notification/2'});await fresh.runOnce();
  const rows=await context.pool.query<{node:string;cycle_no:number}>(`SELECT r.node,c.cycle_no FROM communication.ticket_round_notification_binding r JOIN pilot_ticket.ticket_handling_cycle c ON c.id=r.cycle_id WHERE r.ticket_id=$1::uuid AND r.node<>'FIRST_RESPONSIBILITY' ORDER BY c.cycle_no,r.node`,[id]);
  assert.deepEqual(rows.rows,[{node:'FIRST_HANDLING',cycle_no:1},{node:'STAFF_COMPLETED',cycle_no:1},{node:'FIRST_HANDLING',cycle_no:2},{node:'STAFF_COMPLETED',cycle_no:2}]);
  assert.equal((await context.pool.query<{content_hash:string}>('SELECT m.content_hash FROM communication.message m JOIN communication.outbox o ON o.message_id=m.id JOIN communication.delivery d ON d.outbox_id=o.id WHERE d.id=$1::uuid',[old.id])).rows[0]?.content_hash,old.content_hash);
 },{mvpNotificationsEnabled:true,ticketAssignmentEnabled:true,ticketReopenRoundsEnabled:true,manualRoundConsumption:true});
});
