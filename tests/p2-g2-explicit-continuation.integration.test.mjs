import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { withG2Runtime,G2_RULE_FLAGS } from './helpers/p2-g2-runtime-harness.mjs';
import { createP2016OrchestrationWorker } from '../src/p2-016-orchestration-adapters.mjs';
import {resolveDirectJourneyAssociation} from '../src/p2-015-contact-journey.mjs';

async function receiptRef(f){return (await f.pool.query("SELECT m.content->>'text' AS text FROM communication.ticket_notification_binding b JOIN communication.message m ON m.id=b.message_id WHERE b.destination_type='GROUP' ORDER BY b.id LIMIT 1")).rows[0].text.match(/续接工单 ([A-Za-z0-9_-]{32})：/u)?.[1];}

test('D12-017 existing Direct association wins implicit precedence; explicit new-topic command creates a separate binding',async t=>{
  await withG2Runtime(async f=>{
    await f.inbound('打印机卡纸了');await f.pump();const refA=await receiptRef(f);
    await f.inbound('续接工单 '+refA+'：补充，还是卡纸。',{chatType:'single'});await f.pump();
    const original=(await f.pool.query("SELECT id,journey_id,source_intake_id,conversation_session_id FROM intake.channel_leg WHERE leg_type='DIRECT_GUIDED'")).rows[0];
    await f.inbound('另外门诊系统进不去了');await f.pump();
    const other=(await f.pool.query(`SELECT j.id,r.public_ref FROM intake.contact_journey j JOIN pilot_ticket.reporter_public_ref r
      ON r.ticket_id=j.linked_ticket_id WHERE j.id<>$1`,[original.journey_id])).rows[0];assert.ok(other);
    assert.deepEqual(resolveDirectJourneyAssociation({direct_binding_journey_id:original.journey_id,continuation_journey_id:other.id}),
      {outcome:'LINK',reason:'EXISTING_DIRECT_BINDING',journey_id:original.journey_id});
    await f.inbound('续接工单 '+other.public_ref+'：补充，还是进不去。',{chatType:'single'});await f.pump();
    assert.deepEqual((await f.pool.query('SELECT id,journey_id,source_intake_id,conversation_session_id FROM intake.channel_leg WHERE id=$1',[original.id])).rows[0],original);
    const current=(await f.pool.query("SELECT journey_id,conversation_session_id FROM intake.channel_leg WHERE leg_type='DIRECT_GUIDED' AND id<>$1",[original.id])).rows;
    assert.equal(current.length,1);assert.equal(current[0].journey_id,other.id);assert.notEqual(current[0].conversation_session_id,original.conversation_session_id);
    assert.equal((await f.pool.query('SELECT close_reason FROM conversation.session WHERE id=$1',[original.conversation_session_id])).rows[0].close_reason,'EXPLICIT_USER_NEW_TOPIC');
    assert.equal(Number((await f.pool.query('SELECT count(*) FROM pilot_ticket.ticket')).rows[0].count),2);
    t.diagnostic(JSON.stringify({source_case_id:'D12-017',surface:'PURE_PRECEDENCE_PLUS_PERSISTED_EXPLICIT_NEW_TOPIC',
      old_leg_binding_unchanged:true,explicit_user_command_required:true,provider_calls:f.providerCalls.length}));
  });
});

test('G2 explicit reference comes from actual group Outbox and binds a fresh Direct Leg without a second Ticket',async t=>{
  await withG2Runtime(async f=>{
    await f.inbound('打印机卡纸了');await f.pump();
    const text=(await f.pool.query("SELECT m.content->>'text' AS text FROM communication.ticket_notification_binding b JOIN communication.message m ON m.id=b.message_id WHERE b.destination_type='GROUP'")).rows[0].text;
    const ref=text.match(/续接工单 ([A-Za-z0-9_-]{32})：/u)?.[1];assert.ok(ref,'actual group receipt must provide an authorized opaque reference');
    assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM communication.delivery WHERE target_type='PERSON'")).rows[0].n,0);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.reporter_access_grant')).rows[0].n,0);
    const original=(await f.pool.query('SELECT id,source_intake_id FROM pilot_ticket.ticket')).rows[0];
    const direct=await f.inbound('续接工单 '+ref+'：补充，还是卡纸。',{chatType:'single'});await f.pump();
    t.diagnostic(JSON.stringify({journeys:(await f.pool.query('SELECT status,linked_ticket_id IS NOT NULL AS linked FROM intake.contact_journey')).rows,
      ref_match:(await f.pool.query("SELECT position($1 in raw_text)>0 AS matched FROM channel.message_inbox ORDER BY id DESC LIMIT 1",[ref])).rows,
      decisions:(await f.pool.query('SELECT reason_code FROM intake.deterministic_decision')).rows}));
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM intake.contact_journey')).rows[0].n,1);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM intake.service_intake')).rows[0].n,2);
    assert.deepEqual((await f.pool.query('SELECT id,source_intake_id FROM pilot_ticket.ticket')).rows,[original]);
    assert.deepEqual((await f.pool.query('SELECT leg_type FROM intake.channel_leg ORDER BY leg_ordinal')).rows.map(r=>r.leg_type),['GROUP_ORIGIN','DIRECT_GUIDED']);
    await f.runtime.assembly.handleFrame(direct.frame);await Promise.all(Array.from({length:12},()=>f.pump()));
    await f.inbound('补充，打印机还是卡纸。',{chatType:'single'});await f.pump();
    assert.deepEqual((await f.pool.query('SELECT id,source_intake_id FROM pilot_ticket.ticket')).rows,[original]);
    assert.equal(f.providerCalls.length,0);
    t.diagnostic(JSON.stringify({source_case_id:'D12-018',surface:'ACTUAL_OUTBOX_REFERENCE_THEN_NORMAL_DIRECT_INGRESS',ticket_delta:1,journeys:1}));
  });
});

for(const boundary of ['WRONG_REPORTER','WRONG_BOT','REVOKED','EXPIRED','TAIL','UUID','DIFFERENT_CASE'])
test('G2 explicit reference refuses '+boundary+' while preserving the current fault',async t=>{
  await withG2Runtime(async f=>{
    await f.inbound('打印机卡纸了');await f.pump();
    let ref=await receiptRef(f);assert.ok(ref);
    const original=(await f.pool.query('SELECT id,origin_intake_id,linked_ticket_id FROM intake.contact_journey')).rows[0];
    if(boundary==='REVOKED')await f.runtime.reporterAccess.revokeInTransaction({transaction:f.pool,ticketId:original.linked_ticket_id,actorPrincipalId:f.admin.id});
    if(boundary==='TAIL')ref=ref.slice(-4);
    if(boundary==='UUID')ref=original.linked_ticket_id;
    if(boundary==='DIFFERENT_CASE')ref=ref.replace(/[A-Za-z]/u,c=>c===c.toUpperCase()?c.toLowerCase():c.toUpperCase());
    const frame={cmd:'aibot_msg_callback',headers:{req_id:randomUUID()},body:{msgid:randomUUID(),
      aibotid:boundary==='WRONG_BOT'?'synthetic-other-bot':f.botId,chattype:'single',
      from:{userid:boundary==='WRONG_REPORTER'?f.reporters[1]:f.reporters[0]},msgtype:'text',text:{content:'续接工单 '+ref+'：处方提交不了。'}}};
    assert.equal((await f.runtime.assembly.handleFrame(frame)).p1_committed,true);
    const worker=boundary==='EXPIRED'?createP2016OrchestrationWorker({pool:f.pool,identityHmacKey:'synthetic-g2-identity-key',
      notifications:f.runtime.notifications,realtime:f.runtime.realtimeProjector,now:()=>String(Date.now()+31*86400000)}):f.worker;
    await worker.processDueBatch({feature_flags:G2_RULE_FLAGS,now_epoch_ms:String(Date.now()+15000)});
    assert.deepEqual((await f.pool.query('SELECT id,origin_intake_id,linked_ticket_id FROM intake.contact_journey WHERE id=$1',[original.id])).rows,[original]);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n,2);
    assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM intake.manual_review_item WHERE review_reason_code='EXPLICIT_REFERENCE_REJECTED'")).rows[0].n,1);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM intake.channel_leg WHERE journey_id=$1',[original.id])).rows[0].n,1);
    assert.equal(f.providerCalls.length,0);
    t.diagnostic(JSON.stringify({boundary,surface:'REAL_RECEIPT_NORMAL_DIRECT_FRAME',original_binding_unchanged:true,current_fault_admitted:true}));
  });
});

const source=readFileSync('tests/fixtures/p2-007/hospital-it-multichannel-evaluation-corpus.v1.jsonl','utf8').trim().split(/\r?\n/u).map(JSON.parse);
test('D12-007/014 originally guided Ticket retains channel origin and an audited unique association',async t=>{
  await withG2Runtime(async f=>{
    await f.inbound('@故障助手');await f.pump();
    await f.inbound('处方提交不了',{chatType:'single'});await f.pump();
    const original=(await f.pool.query('SELECT id,source_intake_id FROM pilot_ticket.ticket')).rows[0];
    const ref=await receiptRef(f);assert.ok(ref);
    await f.inbound('补充，处方还是提交不了。',{chatType:'single'});await f.pump();
    await f.inbound('续接工单 '+ref+'：补充，处方提交不了。',{chatType:'single'});await f.pump();
    assert.deepEqual((await f.pool.query('SELECT id,source_intake_id FROM pilot_ticket.ticket')).rows,[original]);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM intake.contact_journey')).rows[0].n,1);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM intake.manual_review_item')).rows[0].n,0);
    const journey=(await f.pool.query('SELECT id,entry_mode,origin_channel,current_channel FROM intake.contact_journey')).rows[0];
    assert.equal(journey.entry_mode,'GROUP_MENTION_TO_DIRECT_GUIDED');assert.equal(journey.origin_channel,'WECOM_GROUP');assert.equal(journey.current_channel,'WECOM_DIRECT');
    const first=(await f.pool.query(`SELECT d.safe_result,l.id AS leg_id FROM intake.deterministic_decision d
      JOIN intake.service_intake i ON i.id=d.service_intake_id JOIN intake.channel_leg l ON l.id=d.channel_leg_id
      WHERE i.source_chat_type='single' ORDER BY d.decision_ordinal LIMIT 1`)).rows[0];
    assert.deepEqual(first.safe_result.journey_association,{method:'UNIQUE_GUIDED_JOURNEY',journey_ref:journey.id,channel_leg_ref:first.leg_id});
    t.diagnostic(JSON.stringify({source_case_ids:['D12-007','D12-014'],surface:'NORMAL_GROUP_TO_DIRECT_WITH_PERSISTED_ASSOCIATION_REASON',provider_calls:0}));
  });
});

test('G2 latest exact Direct recovery blocks older group evidence from a new Incident candidate',async()=>{
  await withG2Runtime(async f=>{
    for(const reporter of f.reporters){await f.inbound('测试诊室断网。',{reporter});await f.pump();}
    const ref=(await f.pool.query(`SELECT r.public_ref FROM pilot_ticket.reporter_public_ref r
      JOIN pilot_ticket.ticket t ON t.id=r.ticket_id JOIN intake.service_intake i ON i.id=t.source_intake_id
      WHERE i.reporter_wecom_userid=$1`,[f.reporters[0]])).rows[0].public_ref;
    await f.inbound('续接工单 '+ref+'：现在恢复正常了',{chatType:'single'});
    // A not-yet-evaluated sibling message is also not permission to use stale evidence.
    await f.runtime.incidentExtension.runOnce();
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM incident.candidate_review')).rows[0].n,0);
    await f.pump();await f.runtime.incidentExtension.runOnce();
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM incident.candidate_review')).rows[0].n,0);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n,3);
  });
});

for(const n of [5,8,12,30])test('original explicit continuation source X'+String(n).padStart(3,'0'),async t=>{
  const c=source.find(c=>c.case_id==='P2-007-X'+String(n).padStart(3,'0'));
  await withG2Runtime(async f=>{
    const turns=c.turns.filter(turn=>turn.speaker!=='BOT');
    await f.inbound(turns[0].text);await f.pump();
    const ref=await receiptRef(f);assert.ok(ref);
    const original=(await f.pool.query('SELECT id,origin_intake_id,reported_at,entry_mode FROM intake.contact_journey')).rows[0];
    await f.inbound('续接工单 '+ref+'：'+turns[1].text,{chatType:'single'});await f.pump();
    if(n===30){await f.inbound(turns[2].text,{chatType:'single',reporter:f.reporters[1]});await f.pump();}
    await f.runtime.incidentExtension.runOnce();
    assert.deepEqual((await f.pool.query('SELECT id,origin_intake_id,reported_at,entry_mode FROM intake.contact_journey WHERE id=$1',[original.id])).rows,[original]);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM intake.channel_leg WHERE journey_id=$1',[original.id])).rows[0].n,2);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n,n===30?2:1);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM incident.candidate_review')).rows[0].n,0);
    t.diagnostic(JSON.stringify({source_case_id:c.case_id,surface:'ORIGINAL_TEXT_WITH_ACTUAL_PUBLIC_REF_APPLICATION_COMMAND',
      synthetic_provider_fields_added:0,source_literal_ref_replaced:true,original_text_preserved_in_command:true,
      bot_prompt_adjudication:n===5?'ACTUAL_GROUP_OUTBOX_RECEIPT_NO_UNAUTHORIZED_PRIVATE_PROMPT':null,
      same_intake_adjudication:n===12?'TWO_IMMUTABLE_CHANNEL_INTAKES_ONE_JOURNEY_ONE_TICKET':null,
      origin_entry_mode:original.entry_mode,distinct_reporters:n===30?2:1,provider_calls:0}));
  });
});
