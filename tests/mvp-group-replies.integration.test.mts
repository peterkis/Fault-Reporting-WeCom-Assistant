import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {createP2016OrchestrationWorker} from '../src/p2-016-orchestration-adapters.mjs';
import {createP2016WeComSender} from '../src/p2-016-wecom-sender.mjs';
import {createCommunicationDeliveryWorker} from '../src/p2-004-communication-delivery-worker.mjs';
import {createMvpNotificationAdmission,MVP_GROUP_RECEIVED,MVP_GROUP_CLARIFY,MVP_GROUP_THANKS} from '../src/mvp-group-replies.mjs';
import {composeConversationRuleAdmission} from '../src/conversation-rule-admission.mjs';
import {ApplicationMemberUnavailableError} from '../src/wecom-application-member.mjs';

const flags={RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true};
test('MVP production rule worker classifies group faults, uncertainty, pure thanks and silence with one source-bound receipt and no Webhook dependency',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const worker=createP2016OrchestrationWorker({pool:context.pool,mvpPolicy:true,identityHmacKey:'mvp-synthetic-identity-key',notifications:context.runtime.notifications,realtime:context.runtime.realtimeProjector});
  const vectors=[
   {text:'@医小修 合成打印机打印不了。',expected:MVP_GROUP_RECEIVED,ticket:true},
   {text:'@医小修 在吗',expected:MVP_GROUP_CLARIFY,ticket:false},
   {text:'@医小修 谢谢',expected:MVP_GROUP_THANKS,ticket:false},
   {text:'@医小修 天气怎么样',expected:null,ticket:false},
   {text:'@医小修 谢谢，打印机打印不了。',expected:MVP_GROUP_RECEIVED,ticket:true},
  ];
  const sources:Awaited<ReturnType<typeof seedPersistedIntake>>[]=[];
  for(const [i,vector] of vectors.entries())sources.push(await seedPersistedIntake({pool:context.pool,text:vector.text,chatType:'group',requestType:'UNKNOWN',status:'RECEIVED',tag:'mvp-reply-'+i}));
  const pump=()=>worker.processDueBatch({feature_flags:flags,batch_size:20,now_epoch_ms:String(Date.now()+15000)});
  try{
   await pump();const calls:{target:string;text:string}[]=[];let qualificationUnavailable=false,failAfterQualification=false,localLookupUnavailable=false;
   const faultingPool=new Proxy(context.pool,{get:(target,key)=>key==='query'?new Proxy(target.query,{apply:(query,_receiver,args)=>{if(localLookupUnavailable){localLookupUnavailable=false;throw Error('SYNTHETIC_FINAL_LOOKUP_UNAVAILABLE');}return Reflect.apply(query,target,args);}}):Reflect.get(target,key)});
   const sender=createP2016WeComSender({mvpPolicy:true,groupReplies:{pool:faultingPool,authorize:async()=>{if(qualificationUnavailable)throw new ApplicationMemberUnavailableError();if(failAfterQualification){failAfterQualification=false;localLookupUnavailable=true;}return true;}},gateway:{getAuthenticatedClient:()=>({sendMessage:async(target,body)=>{
    assert.equal(body.msgtype,'markdown');if(body.msgtype==='markdown')calls.push({target,text:body.markdown.content});return {errcode:0};}})},
    enabled:true,cardEnabled:true,allowedTargetHashes:[],reporterAccess:context.runtime.reporterAccess,origin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],linkMode:'MEMBER_REQUIRED'});
   const delivery=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender,attemptAdmission:composeConversationRuleAdmission(createMvpNotificationAdmission())});
   for(const [i,vector] of vectors.entries()){
    const source=sources[i];assert.ok(source);
    const facts=await context.pool.query<{ticket_id:string|null}>('SELECT pilot_ticket_id::text AS ticket_id FROM intake.service_intake WHERE id=$1::uuid',[source.intakeId]);assert.equal(facts.rows[0]?.ticket_id!==null,vector.ticket);
    const replies=await context.pool.query<{id:string;text:string}>(`SELECT d.id::text,m.content->>'text' AS text FROM communication.message m JOIN communication.outbox o ON o.message_id=m.id JOIN communication.delivery d ON d.outbox_id=o.id
     JOIN intake.deterministic_decision dec ON dec.id::text=m.content->'group_reply'->>'decision_id' WHERE dec.service_intake_id=$1::uuid AND m.sender_system_code='MVP_GROUP_REPLY'`,[source.intakeId]);
    assert.equal(replies.rowCount,vector.expected===null?0:1,vector.text);
    if(vector.expected!==null){assert.equal(replies.rows[0]?.text,vector.expected);const id=replies.rows[0]?.id??'';
     if(i===0){qualificationUnavailable=true;const pending=await delivery.deliver({deliveryId:id});assert.ok(pending&&'status'in pending);assert.equal(pending.status,'PENDING');assert.equal(pending.side_effect_state,'NOT_ATTEMPTED');assert.equal(calls.length,0);qualificationUnavailable=false;
      await context.pool.query('WITH stamp AS(SELECT platform.physical_epoch_ms()-1000 AS epoch) UPDATE communication.delivery SET next_attempt_epoch_ms=epoch,next_attempt_at=platform.local_from_epoch_ms(epoch) FROM stamp WHERE id=$1::uuid',[id]);}
     if(i===0){failAfterQualification=true;const pending=await delivery.deliver({deliveryId:id});assert.ok(pending&&'status'in pending);assert.equal(pending.status,'PENDING');assert.equal(pending.side_effect_state,'NOT_ATTEMPTED');assert.equal(calls.length,0);
      await context.pool.query('WITH stamp AS(SELECT platform.physical_epoch_ms()-1000 AS epoch) UPDATE communication.delivery SET next_attempt_epoch_ms=epoch,next_attempt_at=platform.local_from_epoch_ms(epoch) FROM stamp WHERE id=$1::uuid',[id]);}
     const result=await delivery.deliver({deliveryId:id});assert.ok(result&&'status'in result);assert.equal(result.status,'SENT');assert.equal(await delivery.deliver({deliveryId:id}),null);}
   }
   assert.equal(calls.length,4);const before=(await context.pool.query<{n:number}>('SELECT count(*)::integer AS n FROM communication.delivery')).rows[0]?.n;
   await pump();assert.equal((await context.pool.query<{n:number}>('SELECT count(*)::integer AS n FROM communication.delivery')).rows[0]?.n,before);
   assert.equal(calls.some(c=>c.text.includes('user-test')),false);
   assert.equal((await context.pool.query("SELECT 1 FROM communication.message WHERE sender_system_code='RULE_FIRST_ORCHESTRATOR' AND id IN(SELECT message_id FROM communication.outbox) AND content->>'text' LIKE '%群里继续补充%'")).rowCount,0);
  }finally{await worker.stop();}
 },{mvpNotificationsEnabled:true,manualRoundConsumption:true});
});

test('MVP human takeover permanently suppresses ordinary rules but permits a fixed thanks bound to the new original message',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const worker=createP2016OrchestrationWorker({pool:context.pool,mvpPolicy:true,identityHmacKey:'mvp-synthetic-identity-key',notifications:context.runtime.notifications,realtime:context.runtime.realtimeProjector});
  const pump=()=>worker.processDueBatch({feature_flags:flags,batch_size:20,now_epoch_ms:String(Date.now()+15000)});
  const group='mvp-live-group',inbound=async(text:string)=>{
   const msgid=randomUUID(),result=await context.runtime.assembly.handleFrame({cmd:'aibot_msg_callback',headers:{req_id:'mvp-'+msgid},body:{aibotid:'bot-test',msgid,chattype:'group',chatid:group,from:{userid:'user-test'},msgtype:'text',text:{content:'@医小修 '+text}}});assert.equal(result.ok,true);
   const q=await context.pool.query<{id:string;intake_id:string}>(`SELECT m.id::text,r.intake_id::text FROM channel.message_inbox m JOIN intake.service_intake_message r ON r.channel_message_id=m.id WHERE m.msg_id=$1`,[msgid]);assert.equal(q.rowCount,1);const row=q.rows[0];assert.ok(row);return row;
  };
  try{
   const first=await inbound('打印机打印不了。');await pump();await context.runtime.coordinator.runOnce();await pump();
   const session=(await context.pool.query<{id:string}>('SELECT id::text FROM conversation.session WHERE service_intake_id=$1::uuid',[first.intake_id])).rows[0];assert.ok(session);
   const cookie=context.cookies[0];assert.ok(cookie);const read=async(path:string)=>{const res=await fetch(context.origin+path,{headers:{cookie}});assert.equal(res.status,200);return await res.json() as Record<string,unknown>;};
   const bootstrap=await read('/api/lifecycle/bootstrap'),detail=await read('/api/conversations/'+session.id),s=detail.session as {row_version:number};
   const command={client_command_id:randomUUID(),expected_row_version:s.row_version,target_principal_id:context.principals[0]?.id,reason_code:'WORKBENCH_TAKEOVER'};
   const take=await fetch(context.origin+'/api/conversations/'+session.id+'/takeover',{method:'POST',headers:{cookie,origin:context.origin,'content-type':'application/json','x-csrf-token':String(bootstrap.csrf_token),'idempotency-key':command.client_command_id,'if-match':'"'+s.row_version+'"'},body:JSON.stringify(command)});assert.equal(take.status,200,await take.text());
   const before=(await context.pool.query<{n:number}>('SELECT count(*)::integer AS n FROM pilot_ticket.ticket_event')).rows[0]?.n;
   const thanks=await inbound('谢谢');assert.equal(thanks.intake_id,first.intake_id);await pump();
   const notices=await context.pool.query<{id:string;text:string;kind:string}>(`SELECT d.id::text,m.content->>'text' AS text,m.content->'group_reply'->>'kind' AS kind FROM communication.message m JOIN communication.outbox o ON o.message_id=m.id JOIN communication.delivery d ON d.outbox_id=o.id
    JOIN intake.deterministic_decision dec ON dec.id::text=m.content->'group_reply'->>'decision_id' WHERE dec.service_intake_id=$1::uuid ORDER BY m.created_at,m.id`,[first.intake_id]);
   assert.equal(notices.rowCount,2);assert.equal(notices.rows[1]?.text,MVP_GROUP_THANKS);
   let sent=0;const delivery=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender:{send:async()=>{sent++;return {outcome:'ACKNOWLEDGED',provider_message_id:null,error_code:null,retryable:false};}},attemptAdmission:composeConversationRuleAdmission(createMvpNotificationAdmission())});
   for(const row of notices.rows)await delivery.deliver({deliveryId:row.id});assert.equal(sent,1);
   const states=await context.pool.query<{status:string;kind:string}>(`SELECT d.status,m.content->'group_reply'->>'kind' AS kind FROM communication.delivery d JOIN communication.outbox o ON o.id=d.outbox_id JOIN communication.message m ON m.id=o.message_id WHERE d.id=ANY($1::uuid[]) ORDER BY m.created_at,m.id`,[notices.rows.map(n=>n.id)]);
   assert.deepEqual(states.rows,[{status:'CANCELLED',kind:'RECEIVED'},{status:'SENT',kind:'THANKS'}]);
   assert.equal((await context.pool.query<{n:number}>('SELECT count(*)::integer AS n FROM pilot_ticket.ticket_event')).rows[0]?.n,before);
   const supplement=await inbound('打印机位置在合成区。');await pump();
   const remaining=await context.pool.query("SELECT m.content,i.status,i.id::text,j.status AS journey_status FROM communication.message m JOIN intake.deterministic_decision d ON d.id::text=m.content->'group_reply'->>'decision_id' JOIN intake.service_intake i ON i.id=d.service_intake_id JOIN intake.contact_journey j ON j.id=d.journey_id WHERE m.sender_system_code='MVP_GROUP_REPLY' AND i.id=$1::uuid",[first.intake_id]);
   assert.equal(supplement.intake_id,first.intake_id,JSON.stringify(remaining.rows));assert.equal(remaining.rowCount,2,JSON.stringify(remaining.rows));
  }finally{await worker.stop();}
 },{mvpNotificationsEnabled:true,manualRoundConsumption:true});
});

test('MVP a newly batched fault remains eligible when followed by thanks',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const worker=createP2016OrchestrationWorker({pool:context.pool,mvpPolicy:true,identityHmacKey:'mvp-synthetic-identity-key',notifications:context.runtime.notifications,realtime:context.runtime.realtimeProjector});
  const inbound=async(text:string)=>{
   const msgid=randomUUID();const result=await context.runtime.assembly.handleFrame({cmd:'aibot_msg_callback',headers:{req_id:'mvp-batch-'+msgid},body:{aibotid:'bot-test',msgid,chattype:'group',chatid:'mvp-batched-fault',from:{userid:'user-test'},msgtype:'text',text:{content:'@医小修 '+text}}});assert.equal(result.ok,true);
   const row=(await context.pool.query<{intake_id:string}>('SELECT r.intake_id::text FROM channel.message_inbox m JOIN intake.service_intake_message r ON r.channel_message_id=m.id WHERE m.msg_id=$1',[msgid])).rows[0];assert.ok(row);return row.intake_id;
  };
  try{
   const fault=await inbound('打印机打印不了。');assert.equal(await inbound('谢谢'),fault);
   await worker.processDueBatch({feature_flags:flags,batch_size:20,now_epoch_ms:String(Date.now()+15000)});
   const intake=(await context.pool.query<{ticket_id:string|null}>('SELECT pilot_ticket_id::text AS ticket_id FROM intake.service_intake WHERE id=$1::uuid',[fault])).rows[0];assert.ok(intake?.ticket_id,'a trailing thanks must not discard the unprocessed fault');
   const replies=await context.pool.query<{text:string}>(`SELECT m.content->>'text' AS text FROM communication.message m JOIN intake.deterministic_decision d ON d.id::text=m.content->'group_reply'->>'decision_id' WHERE d.service_intake_id=$1::uuid ORDER BY m.created_at,m.id`,[fault]);
   assert.equal(replies.rows.filter(row=>row.text===MVP_GROUP_RECEIVED).length,1);assert.equal(replies.rows.filter(row=>row.text===MVP_GROUP_THANKS).length,1);
  }finally{await worker.stop();}
 },{mvpNotificationsEnabled:true,manualRoundConsumption:true});
});

test('MVP takeover and release pause all automatic business actions in the same group or direct topic',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const worker=createP2016OrchestrationWorker({pool:context.pool,mvpPolicy:true,identityHmacKey:'mvp-synthetic-identity-key',notifications:context.runtime.notifications,realtime:context.runtime.realtimeProjector});
  const pump=()=>worker.processDueBatch({feature_flags:flags,batch_size:20,now_epoch_ms:String(Date.now()+15000)});
  const cookie=context.cookies[0];assert.ok(cookie);
  const read=async(path:string)=>{const response=await fetch(context.origin+path,{headers:{cookie}});assert.equal(response.status,200);return await response.json() as Record<string,unknown>;};
  const bootstrap=await read('/api/lifecycle/bootstrap');
  const state=async(id:string)=>(await context.pool.query(`SELECT i.request_type,i.status,i.version,i.pilot_ticket_id::text,j.status AS journey_status,j.row_version::text AS journey_version,
   (SELECT count(*)::integer FROM intake.manual_review_item r WHERE r.service_intake_id=i.id) AS review_count
   FROM intake.service_intake i JOIN intake.contact_journey j ON j.origin_intake_id=i.id WHERE i.id=$1::uuid`,[id])).rows[0];
  try{
   for(const chatType of ['group','single'] as const){
    const inbound=async(text:string)=>{
     const msgid=randomUUID();const result=await context.runtime.assembly.handleFrame({cmd:'aibot_msg_callback',headers:{req_id:'mvp-paused-'+msgid},body:{aibotid:'bot-test',msgid,chattype:chatType,...(chatType==='group'?{chatid:'mvp-paused-business'}:{}),from:{userid:'mvp-paused-'+chatType},msgtype:'text',text:{content:(chatType==='group'?'@医小修 ':'')+text}}});assert.equal(result.ok,true);
     const row=(await context.pool.query<{intake_id:string}>('SELECT r.intake_id::text FROM channel.message_inbox m JOIN intake.service_intake_message r ON r.channel_message_id=m.id WHERE m.msg_id=$1',[msgid])).rows[0];assert.ok(row);return row.intake_id;
    };
    const intakeId=await inbound('在吗');await pump();await context.runtime.coordinator.runOnce();await pump();
    const session=(await context.pool.query<{id:string}>('SELECT id::text FROM conversation.session WHERE service_intake_id=$1::uuid',[intakeId])).rows[0];assert.ok(session);
    const control=async(action:'takeover'|'release')=>{
     const detail=await read('/api/conversations/'+session.id),value=detail.session as {row_version:number};
     const command={client_command_id:randomUUID(),expected_row_version:value.row_version,...(action==='takeover'?{target_principal_id:context.principals[0]?.id}:{}),reason_code:action==='takeover'?'WORKBENCH_TAKEOVER':'WORKBENCH_RELEASE'};
     const response=await fetch(context.origin+'/api/conversations/'+session.id+'/'+action,{method:'POST',headers:{cookie,origin:context.origin,'content-type':'application/json','x-csrf-token':String(bootstrap.csrf_token),'idempotency-key':command.client_command_id,'if-match':'"'+value.row_version+'"'},body:JSON.stringify(command)});assert.equal(response.status,200,await response.text());
    };
    await control('takeover');
    for(const text of ['打印机打印不了。','电脑无法开机。']){
     assert.equal(await inbound(text),intakeId);const before=await state(intakeId);assert.ok(before);assert.equal(before.pilot_ticket_id,null,'isolated '+chatType+' topic before '+text);
     await pump();assert.deepEqual(await state(intakeId),before,'human takeover must prevent classification, tickets, journey transitions and review enqueueing');
     await pump();assert.deepEqual(await state(intakeId),before,'a rescan must keep business state paused');
     if(text==='打印机打印不了。')await control('release');
    }
    const actions=await context.pool.query<{state:string}>(`SELECT a.state FROM intake.safe_action_suggestion a JOIN intake.deterministic_decision d ON d.id=a.decision_id WHERE d.service_intake_id=$1::uuid AND d.source_window_end_sequence>1`,[intakeId]);
    assert.ok(actions.rows.length>0);assert.ok(actions.rows.every(action=>action.state==='CANCELLED'));
   }
  }finally{await worker.stop();}
 },{mvpNotificationsEnabled:true,manualRoundConsumption:true});
});
