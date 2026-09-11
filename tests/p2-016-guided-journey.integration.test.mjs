import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createP2016OrchestrationWorker } from '../src/p2-016-orchestration-adapters.mjs';
import { createP2016TicketNotificationProjector } from '../src/p2-016-ticket-notification-projector.mjs';
import { createP2016RealtimeProjector } from '../src/p2-016-realtime-projector.mjs';
import { shanghaiLocalToEpochMs } from '../src/platform/time-contract.mjs';
import { seedPersistedIntake } from './helpers/p2-015-postgres-harness.mjs';
import { withP2016IsolatedDatabase,applyThrough030 } from './helpers/p2-016-postgres-harness.mjs';
import { migrateP2016 } from '../scripts/p2-016-migrate.mjs';
import { createChannelMessageInbox } from '../src/p1-003-channel-message-inbox.mjs';
import { createServiceIntakeProcessor } from '../src/p1-004-service-intake.mjs';
import { createP2G1HumanOnlyAssembly } from '../src/p2-g1-human-only-assembly.mjs';
import { createPilotAccessService } from '../src/p1-009-pilot-access-workbench.mjs';
import { createP2016TicketQuery } from '../src/p2-016-ticket-query.mjs';
import { createP2016ManualReviewFacade } from '../src/p2-016-manual-review-facade.mjs';
const flags={RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true};

test('P2-016 real-format group wakeup and direct description remain one Journey through public queries',async()=>{
  await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'p2016ingress',run:async({pool,databaseUrl})=>{
    await applyThrough030({pool,databaseUrl});await migrateP2016({databaseUrl});
    let clock=Date.now();
    const inbox=createChannelMessageInbox({pool}),processor=createServiceIntakeProcessor();
    const assembly=createP2G1HumanOnlyAssembly({projectAfterCommit:false,privacyClass:'INTERNAL',now:()=>new Date(clock),
      operationalIntake:{accept:input=>inbox.accept(input,processor)}});
    const worker=createP2016OrchestrationWorker({pool,identityHmacKey:'synthetic-ingress-identity-key',now:()=>String(clock),
      notifications:createP2016TicketNotificationProjector({enabled:true}),realtime:createP2016RealtimeProjector({pool,enabled:true})});
    const principal=await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'synthetic-journey-reader',displayName:'合成查询坐席',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    const authContext={principal_id:principal.id},query=createP2016ManualReviewFacade({pool,enabled:true,query:createP2016TicketQuery({pool,enabled:true})});
    const incoming=(id,chattype,text)=>({cmd:'aibot_msg_callback',headers:{req_id:'req-'+id},body:{
      msgid:id,aibotid:'synthetic-guided-bot',chattype,...(chattype==='group'?{chatid:'synthetic-guided-group'}:{}),
      from:{userid:'synthetic-guided-reporter'},msgtype:'text',text:{content:text}}});
    const process=async frame=>{
      const accepted=await assembly.handleFrame(frame);assert.equal(accepted.ok,true);
      clock+=5000;const batch=await worker.processDueBatch({feature_flags:flags,now_epoch_ms:String(clock)});
      assert.equal(batch.processed,1);
      // Locate the opaque query resource using the public batch receipt; assertions use the Journey query facade.
      return (await pool.query('SELECT journey_id::text FROM intake.deterministic_decision WHERE id=$1::uuid',[batch.results[0].decision_id])).rows[0].journey_id;
    };
    const groupJourneyId=await process(incoming('synthetic-wakeup','group','@合成测试助手'));
    const directJourneyId=await process(incoming('synthetic-description','single','3楼护士站HIS登录报错'));
    const group=await query.journey({authContext,journeyId:groupJourneyId});
    const direct=await query.journey({authContext,journeyId:directJourneyId});
    assert.equal(direct.id,group.id,'direct description must attach to the group-guided Journey');
    assert.equal(direct.origin_channel,'WECOM_GROUP');assert.equal(direct.current_channel,'WECOM_DIRECT');
    assert.deepEqual((await query.journey({authContext,journeyId:group.id,part:'legs'})).map(leg=>leg.leg_type),['GROUP_ORIGIN','DIRECT_GUIDED']);
  }});
});
test('P2-016 group-to-direct unique binding preserves Journey; ambiguous, consumed and expired candidates never guess',async()=>{
  for(const count of [1,2,3,4])await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'p2016guided',run:async({pool,databaseUrl})=>{
    await applyThrough030({pool,databaseUrl});await migrateP2016({databaseUrl});
    let clock=shanghaiLocalToEpochMs('2026-09-03 12:01:00');const worker=createP2016OrchestrationWorker({pool,identityHmacKey:'synthetic-guided-identity-key',
      now:()=>clock,notifications:createP2016TicketNotificationProjector({enabled:true}),realtime:createP2016RealtimeProjector({pool,enabled:true})});
    const groups=count===2?2:1;
    for(let i=0;i<groups;i++)await seedPersistedIntake({pool,text:'系统不行'});
    assert.equal((await worker.processDueBatch({feature_flags:flags})).processed,groups);
    if(count===3){await seedPersistedIntake({pool,text:'系统不行',chatType:'single'});assert.equal((await worker.processDueBatch({feature_flags:flags})).processed,1);}
    if(count===4)clock=shanghaiLocalToEpochMs('2026-09-03 15:01:00');
    const direct=await seedPersistedIntake({pool,text:'处方提交不了',chatType:'single'});
    const result=await worker.processDueBatch({feature_flags:flags});assert.equal(result.processed,1);
    const binding=(await pool.query('SELECT j.id::text,j.origin_intake_id::text,j.status,l.leg_type FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id WHERE l.source_intake_id=$1::uuid',[direct.intakeId])).rows[0];
    if(count===1){
      assert.equal(binding.leg_type,'DIRECT_GUIDED');assert.notEqual(binding.origin_intake_id,direct.intakeId);
      assert.equal((await pool.query('SELECT count(*)::integer AS n FROM intake.contact_journey')).rows[0].n,1);
      assert.equal((await pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n,1);
      assert.equal((await pool.query('SELECT state FROM intake.continuation_ref')).rows[0].state,'BOUND');
      assert.equal((await pool.query("SELECT count(*)::integer AS n FROM communication.ticket_notification_binding WHERE destination_type='GROUP'")).rows[0].n,1);
    }else if(count===4){
      assert.equal(binding.leg_type,'DIRECT_ORGANIC');assert.equal(binding.origin_intake_id,direct.intakeId);
      assert.equal((await pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n,1);
    }else{
      // P2-G2 adjudication: leave association undecided while accepting the current explicit fault.
      assert.equal(binding.leg_type,'DIRECT_ORGANIC');assert.equal((await pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n,1);
      const review=(await pool.query('SELECT review_reason_code FROM intake.manual_review_item WHERE service_intake_id=$1::uuid',[direct.intakeId])).rows[0];assert.equal(review.review_reason_code,'MULTIPLE_GUIDED_JOURNEYS');
    }
    assert.equal((await worker.processDueBatch({feature_flags:flags})).processed,0);
  }});
});

test('P2-016 later same-group description preserves the recorded entry mode instead of rejecting the Journey',async()=>{
  await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'p2016entry',run:async({pool,databaseUrl})=>{
    await applyThrough030({pool,databaseUrl});await migrateP2016({databaseUrl});
    let clock=Date.now();const inbox=createChannelMessageInbox({pool}),processor=createServiceIntakeProcessor();
    const assembly=createP2G1HumanOnlyAssembly({projectAfterCommit:false,privacyClass:'INTERNAL',now:()=>new Date(clock),
      operationalIntake:{accept:input=>inbox.accept(input,processor)}});
    const worker=createP2016OrchestrationWorker({pool,identityHmacKey:'synthetic-ingress-identity-key',now:()=>String(clock),
      notifications:createP2016TicketNotificationProjector({enabled:true}),realtime:createP2016RealtimeProjector({pool,enabled:true})});
    const principal=await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'synthetic-entry-reader',displayName:'合成查询坐席',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    const authContext={principal_id:principal.id},query=createP2016ManualReviewFacade({pool,enabled:true});
    let journeyId;
    for(const [index,text]of ['@合成测试助手','3楼护士站HIS登录报错'].entries()){
      assert.equal((await assembly.handleFrame({cmd:'aibot_msg_callback',headers:{req_id:'req-entry-'+index},body:{
        msgid:'synthetic-entry-'+index,aibotid:'synthetic-entry-bot',chattype:'group',chatid:'synthetic-entry-group',
        from:{userid:'synthetic-entry-reporter'},msgtype:'text',text:{content:text}}})).ok,true);
      clock+=5000;const result=await worker.processDueBatch({feature_flags:flags,now_epoch_ms:String(clock)});assert.equal(result.processed,1);
      journeyId??=(await pool.query('SELECT journey_id::text FROM intake.deterministic_decision WHERE id=$1::uuid',[result.results[0].decision_id])).rows[0].journey_id;
    }
    const journey=await query.journey({authContext,journeyId});assert.equal(journey.entry_mode,'GROUP_MENTION_TO_DIRECT_GUIDED');
    assert.equal(journey.status,'TICKET_LINKED');
    assert.equal((await query.journey({authContext,journeyId,part:'legs'})).length,1);
    assert.equal((await worker.processDueBatch({feature_flags:flags,now_epoch_ms:String(clock)})).processed,0);
  }});
});
