import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { withG2Runtime,G2_RULE_FLAGS } from './helpers/p2-g2-runtime-harness.mjs';
import { createReporterDirectoryPort } from '../src/p2-015-contact-journey.mjs';
import { createP2G1HumanOnlyAssembly } from '../src/p2-g1-human-only-assembly.mjs';
import { createChannelMessageInbox } from '../src/p1-003-channel-message-inbox.mjs';
import { createP2016DirectIntakeProcessor } from '../src/p2-016-direct-intake.mjs';
import { g2BusinessCounts,g2DecisionObservation } from './helpers/p2-g2-gold-observation.mjs';
import { shanghaiLocalToEpochMs } from '../src/platform/time-contract.mjs';
const source=readFileSync('tests/fixtures/p2-007/hospital-it-multichannel-evaluation-corpus.v1.jsonl','utf8').trim().split(/\r?\n/u).map(JSON.parse);

test('original X020 preserves earliest Provider report time across actual explicit Direct continuation',async t=>{
  const c=source.find(c=>c.case_id==='P2-007-X020');
  await withG2Runtime(async f=>{
    const start=Date.now();let clock=start;
    const inbox=createChannelMessageInbox({pool:f.pool}),processor=createP2016DirectIntakeProcessor();
    const assembly=createP2G1HumanOnlyAssembly({operationalIntake:{accept:input=>inbox.accept(input,processor)},coordinator:f.runtime.coordinator,now:()=>new Date(clock)});
    let publicRef;
    for(const [index,turn] of c.turns.entries()){
      clock=start+turn.offset_ms;
      const text=index===0?turn.text:'续接工单 '+publicRef+'：'+turn.text;
      const frame={cmd:'aibot_msg_callback',headers:{req_id:randomUUID()},body:{msgid:randomUUID(),aibotid:f.botId,
        chattype:index===0?'group':'single',...(index===0?{chatid:f.groupId}:{}),from:{userid:f.reporters[0]},
        create_time:Number(shanghaiLocalToEpochMs(turn.provider_sent_at))/1000,msgtype:'text',text:{content:text}}};
      assert.equal((await assembly.handleFrame(frame)).p1_committed,true);
      await f.worker.processDueBatch({feature_flags:G2_RULE_FLAGS,now_epoch_ms:String(clock+15000)});
      if(index===0)publicRef=(await f.pool.query('SELECT public_ref FROM pilot_ticket.reporter_public_ref')).rows[0].public_ref;
    }
    const rows=(await f.pool.query('SELECT reported_at,last_activity_at FROM intake.contact_journey')).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].reported_at,c.expected.reported_at);
    assert.ok(BigInt(shanghaiLocalToEpochMs(rows[0].last_activity_at))>=BigInt(start-1000));
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM intake.channel_leg')).rows[0].n,2);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n,1);
    t.diagnostic(JSON.stringify({source_case_id:c.case_id,reported_at:rows[0].reported_at,provider_time_from_actual_frame:true,
      continuation_source_adjudication:'SOURCE_PLACEHOLDER_REPLACED_WITH_ACTUAL_PUBLIC_REF_TEXT',journeys:1,tickets:1,legs:2,provider_calls:0}));
  });
});

test('original X021 keeps Provider, receipt, durable Inbox, Intake and Ticket timestamps separate',async t=>{
  const c=source.find(c=>c.case_id==='P2-007-X021');
  await withG2Runtime(async f=>{
    const provider='2026-09-02 09:00:00';
    const frame={cmd:'aibot_msg_callback',headers:{req_id:randomUUID()},body:{msgid:randomUUID(),aibotid:f.botId,
      chattype:'single',from:{userid:f.reporters[0]},create_time:Number(shanghaiLocalToEpochMs(provider))/1000,
      msgtype:'text',text:{content:c.turns[0].text}}};
    assert.equal((await f.runtime.assembly.handleFrame(frame)).p1_committed,true);await f.pump();
    const row=(await f.pool.query(`SELECT m.create_time AS provider_sent_at,m.received_at AS gateway_received_at,
      m.created_at AS inbox_committed_at,i.created_at AS intake_created_at,t.created_at AS ticket_created_at,
      m.provider_create_epoch_ms::text,m.received_epoch_ms::text
      FROM channel.message_inbox m JOIN intake.service_intake i ON i.primary_message_id=m.id
      JOIN pilot_ticket.ticket t ON t.source_intake_id=i.id WHERE m.msg_id=$1`,[frame.body.msgid])).rows[0];
    assert.equal(row.provider_sent_at,provider);assert.equal(row.provider_create_epoch_ms,shanghaiLocalToEpochMs(provider));
    for(const name of c.expected.required_timestamps)assert.match(row[name],/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);
    assert.notEqual(row.gateway_received_at,row.provider_sent_at);assert.ok(BigInt(row.received_epoch_ms)>BigInt(row.provider_create_epoch_ms));
    t.diagnostic(JSON.stringify({source_case_id:c.case_id,surface:'NORMAL_SDK_CREATE_TIME_AND_REAL_PERSISTENCE',timestamp_columns:Object.keys(row),
      provider_time_distinct:true,provider_calls:0}));
  });
});

for(const n of [16,17,18,19])test('original directory source X'+String(n).padStart(3,'0'),async t=>{
  const c=source.find(c=>c.case_id==='P2-007-X'+String(n).padStart(3,'0'));
  const snapshot={source:'WECOM_DIRECTORY',version:'synthetic-source-directory-v1',memberships:
    n===17?[{department_ref:'synthetic-primary-unknown-a',role:'MEMBER'},{department_ref:'synthetic-primary-unknown-b',role:'MEMBER'}]:
      [{department_ref:n===19?'TEST_INTERNAL_MEDICINE':'synthetic-source-department',role:'PRIMARY'}]};
  const directoryPort=createReporterDirectoryPort({resolveProfile:async()=>{if(n===18)throw new Error('synthetic-directory-unavailable');return {status:'RESOLVED',snapshot};}});
  await withG2Runtime(async f=>{
    const observations=[];
    for(const turn of c.turns){await f.inbound(turn.text,{chatType:'single'});const batch=await f.pump();
      observations.push(await g2DecisionObservation({pool:f.pool,decisionId:batch.results[0].decision_id}));}
    const row=(await f.pool.query('SELECT profile_resolution_status,profile_snapshot FROM intake.contact_journey')).rows[0];
    assert.deepEqual(row,{profile_resolution_status:n===18?'DEFERRED':'RESOLVED',profile_snapshot:n===18?{}:snapshot});
    if(n===17)assert.equal(Object.hasOwn(row.profile_snapshot,'primary_department'),false);
    if(n===19){const text=(await f.pool.query('SELECT clean_text FROM channel.message_inbox')).rows[0].clean_text;
      assert.ok(text.includes('测试影像区'));assert.equal(row.profile_snapshot.memberships[0].department_ref,'TEST_INTERNAL_MEDICINE');}
    const counts=await g2BusinessCounts(f.pool);assert.equal(counts.tickets,1);assert.equal(counts.inbox,c.turns.length);
    t.diagnostic(JSON.stringify({source_case_id:c.case_id,surface:'ORIGINAL_FRAME_WITH_TRUSTED_DIRECTORY_SIMULATOR',counts,observations,
      hospital_directory_connected:false,source_semantic_adjudication:n===16?'HOSPITAL_DIRECTORY_IS_FUTURE_SOURCE_CURRENT_PORT_WECOM_SIMULATOR':null,
      provider_calls:f.providerCalls.length}));
  },{directoryPort});
});

for(const n of [7,9,11,13])test('original temporal/session source X'+String(n).padStart(3,'0'),async t=>{
  const c=source.find(c=>c.case_id==='P2-007-X'+String(n).padStart(3,'0'));
  await withG2Runtime(async f=>{
    const start=Date.now();let clock=start;
    const inbox=createChannelMessageInbox({pool:f.pool}),processor=createP2016DirectIntakeProcessor();
    const assembly=createP2G1HumanOnlyAssembly({operationalIntake:{accept:input=>inbox.accept(input,processor)},coordinator:f.runtime.coordinator,now:()=>new Date(clock)});
    const observations=[];
    for(const [i,turn] of c.turns.entries()){
      clock=start+turn.offset_ms;
      const frame={cmd:'aibot_msg_callback',headers:{req_id:randomUUID()},body:{msgid:randomUUID(),aibotid:f.botId,
        chattype:turn.channel==='WECOM_GROUP'?'group':'single',...(turn.channel==='WECOM_GROUP'?{chatid:f.groupId}:{}),
        from:{userid:f.reporters[0]},msgtype:'text',text:{content:turn.text}}};
      assert.equal((await assembly.handleFrame(frame)).p1_committed,true);
      assert.equal((await g2BusinessCounts(f.pool)).inbox,i+1);
      const batch=await f.worker.processDueBatch({feature_flags:G2_RULE_FLAGS,now_epoch_ms:String(clock)});assert.equal(batch.processed,1);
      observations.push(await g2DecisionObservation({pool:f.pool,decisionId:batch.results[0].decision_id}));
    }
    const counts=await g2BusinessCounts(f.pool),expected=n===7||n===13?2:1;
    assert.equal(counts.tickets,expected);assert.equal(counts.inbox,c.turns.length);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM intake.contact_journey')).rows[0].n,expected);
    if(n===11){assert.equal(counts.reviews,1);assert.equal(observations.at(-1).result_code,'MANUAL_REVIEW_REQUIRED');}
    const epochs=(await f.pool.query('SELECT received_epoch_ms::text FROM channel.message_inbox ORDER BY received_epoch_ms,id')).rows;
    assert.deepEqual(epochs.map(r=>Number(r.received_epoch_ms)-start),c.turns.map(t=>t.offset_ms));
    t.diagnostic(JSON.stringify({source_case_id:c.case_id,surface:'ORIGINAL_FRAME_WITH_OWNED_RECEIVE_CLOCK',
      source_offsets_honored:true,host_or_database_clock_modified:false,counts,observations,provider_calls:f.providerCalls.length}));
  });
});
