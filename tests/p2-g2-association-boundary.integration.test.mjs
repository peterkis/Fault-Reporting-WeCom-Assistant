import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';
import { createP2016OrchestrationWorker } from '../src/p2-016-orchestration-adapters.mjs';
import { createReporterDirectoryPort } from '../src/p2-015-contact-journey.mjs';
import { G2_RULE_FLAGS } from './helpers/p2-g2-runtime-harness.mjs';
import { createContinuationRefService } from '../src/p2-015-continuation-ref.mjs';
import { hmacIdentity } from '../src/p2-015-domain-contracts.mjs';
import { formatEpochMsToShanghaiLocal } from '../src/platform/time-contract.mjs';
import { g2BusinessCounts,g2DecisionObservation } from './helpers/p2-g2-gold-observation.mjs';

test('G2-J01 continuation wrong Bot/Reporter, expired, revoked and reused token reject against real normal-ingress prerequisites',async t=>{
  await withG2Runtime(async f=>{
    await f.inbound('@故障助手');await f.pump();
    await f.inbound('系统不行',{chatType:'single'});await f.pump();
    const journey=(await f.pool.query('SELECT id,reporter_identity_hash FROM intake.contact_journey')).rows[0];
    const legs=(await f.pool.query('SELECT id,leg_type FROM intake.channel_leg ORDER BY leg_ordinal')).rows;
    assert.deepEqual(legs.map(l=>l.leg_type),['GROUP_ORIGIN','DIRECT_GUIDED']);
    const service=createContinuationRefService(),now=String(Date.now()),local=formatEpochMsToShanghaiLocal(now);
    const transaction=async run=>{const client=await f.pool.connect();try{await client.query('BEGIN');const result=await run(client);await client.query('COMMIT');return result;}
      catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}};
    const botHash=hmacIdentity(f.botId,'synthetic-g2-identity-key');
    const issue=()=>transaction(tx=>service.issue({transaction:tx,input:{journey_id:journey.id,origin_leg_id:legs[0].id,
      purpose:'EXPLICIT_CONTINUATION',reporter_binding_hash:journey.reporter_identity_hash,bot_binding_hash:botHash,
      issued_at:local,issued_epoch_ms:now,ttl_minutes:1,issue_idempotency_key:'g2-mechanism-'+randomUUID()}}));
    const consume=(issued,change={})=>transaction(tx=>service.consume({transaction:tx,input:{token:issued.token,
      purpose:'EXPLICIT_CONTINUATION',reporter_binding_hash:journey.reporter_identity_hash,bot_binding_hash:botHash,
      consumed_epoch_ms:now,consumed_at:local,target_leg_id:legs[1].id,...change}}));
    const issued=await issue();
    for(const change of [{reporter_binding_hash:'b'.repeat(64)},{bot_binding_hash:'b'.repeat(64)}]){
      await assert.rejects(consume(issued,change),{code:'P2_015_CONTINUATION_BINDING_MISMATCH'});
      assert.equal((await f.pool.query('SELECT state FROM intake.continuation_ref WHERE id=$1',[issued.id])).rows[0].state,'ISSUED');
    }
    assert.equal((await consume(issued)).state,'CONSUMED');
    await assert.rejects(consume(issued),{code:'P2_015_CONTINUATION_CONSUMED'});
    const expired=await issue(),later=String(BigInt(expired.expires_epoch_ms)+1n);
    await assert.rejects(consume(expired,{consumed_epoch_ms:later,consumed_at:formatEpochMsToShanghaiLocal(later)}),{code:'P2_015_CONTINUATION_EXPIRED'});
    const revoked=await issue();await transaction(tx=>service.revoke({transaction:tx,id:revoked.id,revoked_at:local,revoked_epoch_ms:now}));
    await assert.rejects(consume(revoked),{code:'P2_015_CONTINUATION_EXPIRED'});
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM intake.channel_leg')).rows[0].n,2);
    assert.equal((await g2BusinessCounts(f.pool)).tickets,0);
    t.diagnostic(JSON.stringify({scenario_id:'G2-J01',source_case_ids:['D12-009','D12-010','D12-011','D12-012'],
      surface:'PERSISTED_TOKEN_SERVICE_WITH_NORMAL_INGRESS_PREREQUISITES',existing_direct_leg:true,
      token_is_not_authorization:true,token_callback_integration_claimed:false,raw_token_output:false,provider_calls:f.providerCalls.length}));
  });
});

for(const [text,ticketCount] of [['处方提交不了',1],['我有两个待补充问题，不知道这条属于哪一个。',0]])
test('G2-J01 ambiguous association preserves current report admission: '+text,async t=>{
  await withG2Runtime(async f=>{
    await f.inbound('@故障助手');await f.pump();
    await f.runtime.assembly.handleFrame({cmd:'aibot_msg_callback',headers:{req_id:randomUUID()},body:{msgid:randomUUID(),
      aibotid:f.botId,chattype:'group',chatid:'synthetic-second-guidance-group',from:{userid:f.reporters[0]},
      msgtype:'text',text:{content:'@故障助手'}}});await f.pump();
    const original=(await f.pool.query('SELECT id,origin_intake_id FROM intake.contact_journey ORDER BY id')).rows;
    assert.equal(original.length,2);
    assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM intake.contact_journey WHERE entry_mode='GROUP_MENTION_TO_DIRECT_GUIDED'")).rows[0].n,2);
    const direct=await f.inbound(text,{chatType:'single'}),batch=await f.pump();
    const observed=await g2DecisionObservation({pool:f.pool,decisionId:batch.results[0].decision_id});
    assert.equal(observed.result_code,'MANUAL_REVIEW_REQUIRED');assert.equal(observed.reason_code,'MULTIPLE_GUIDED_JOURNEYS');
    const counts=await g2BusinessCounts(f.pool);assert.equal(counts.tickets,ticketCount);assert.equal(counts.reviews,1);
    assert.deepEqual((await f.pool.query('SELECT id,origin_intake_id FROM intake.contact_journey WHERE id=ANY($1::uuid[]) ORDER BY id',[original.map(r=>r.id)])).rows,original);
    assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM intake.continuation_ref WHERE state='BOUND'")).rows[0].n,0);
    await f.runtime.assembly.handleFrame(direct.frame);await Promise.all(Array.from({length:12},()=>f.pump()));
    assert.deepEqual(await g2BusinessCounts(f.pool),counts);
    t.diagnostic(JSON.stringify({scenario_id:'G2-J01',source_case_ids:ticketCount?[]:['P2-007-X006','D12-013','D12-015'],
      surface:'NORMAL_FRAME_AMBIGUOUS_JOURNEYS',current_fault_ticket_count:ticketCount,observed,provider_calls:f.providerCalls.length}));
  });
});


async function twoPendingGroups(f){
  await f.inbound('@故障助手');await f.pump();
  await f.runtime.assembly.handleFrame({cmd:'aibot_msg_callback',headers:{req_id:randomUUID()},body:{msgid:randomUUID(),
    aibotid:f.botId,chattype:'group',chatid:'synthetic-second-guidance-group',from:{userid:f.reporters[0]},msgtype:'text',text:{content:'@故障助手'}}});await f.pump();
}
for(const fault of ['RULE_EXCEPTION','WINDOW_LIMIT','NORMAL_HIGH_RISK'])test('G2-E07/J01 independent inactive/association evidence survives '+fault,async()=>{
  await withG2Runtime(async f=>{
    await twoPendingGroups(f);
    if(fault==='WINDOW_LIMIT')for(let i=0;i<11;i++)await f.inbound((i?'补充：':'处方提交不了。')+'甲'.repeat(1990),{chatType:'single'});
    else await f.inbound(fault==='NORMAL_HIGH_RISK'?'急诊唯一叫号终端坏了。':'处方提交不了',{chatType:'single'});
    const directoryPort=createReporterDirectoryPort({resolveProfile:async()=>({status:'RESOLVED',snapshot:{source:'WECOM_DIRECTORY',
      version:'synthetic-inactive-fault-v1',account_status:'INACTIVE',valid_at:'2026-09-09 08:00:00'}})});
    const worker=createP2016OrchestrationWorker({pool:f.pool,identityHmacKey:'synthetic-g2-identity-key',notifications:f.runtime.notifications,
      realtime:f.runtime.realtimeProjector,directoryPort,...(fault==='RULE_EXCEPTION'?{ruleEngine:{evaluate(){throw new Error('synthetic-rule-failure');}}}:{})});
    const batch=await worker.processDueBatch({feature_flags:G2_RULE_FLAGS,now_epoch_ms:String(Date.now()+15000)});
    assert.equal(batch.processed,1);
    const row=(await f.pool.query('SELECT safe_result FROM intake.deterministic_decision WHERE id=$1',[batch.results[0].decision_id])).rows[0].safe_result;
    assert.ok(row.unknown_fields.includes('journey_selection'));assert.equal(row.identity_review.directory_assertion.account_status,'INACTIVE');
    assert.equal(row.ticket_creation_recommended,fault==='NORMAL_HIGH_RISK');assert.equal((await g2BusinessCounts(f.pool)).tickets,fault==='NORMAL_HIGH_RISK'?1:0);
    if(fault==='NORMAL_HIGH_RISK')assert.ok(['HIGH','CRITICAL_REVIEW_REQUIRED'].includes(row.clinical_safety_risk));
    const review=(await f.pool.query('SELECT id FROM intake.manual_review_item WHERE decision_id=$1',[batch.results[0].decision_id])).rows[0];
    assert.equal((await f.get('/api/manual-reviews/'+review.id)).safe_result.identity_review.directory_assertion.version,'synthetic-inactive-fault-v1');
  });
});

test('G2-J01 review enqueue database fault rolls back current Ticket/Decision/actions while preserving Inbox',async()=>{
  await withG2Runtime(async f=>{
    await twoPendingGroups(f);await f.inbound('处方提交不了',{chatType:'single'});
    const before=await g2BusinessCounts(f.pool);
    // SYNTHETIC_FAULT in the isolated fixture database; no migration artifact.
    await f.pool.query('ALTER TABLE intake.manual_review_item ADD CONSTRAINT synthetic_g2_review_failure CHECK(false) NOT VALID');
    await assert.rejects(f.pump());assert.deepEqual(await g2BusinessCounts(f.pool),before);
    await f.pool.query('ALTER TABLE intake.manual_review_item DROP CONSTRAINT synthetic_g2_review_failure');
    await f.pump();const after=await g2BusinessCounts(f.pool);assert.equal(after.tickets,before.tickets+1);assert.equal(after.reviews,before.reviews+1);
  });
});
