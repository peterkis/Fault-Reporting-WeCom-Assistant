import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';
import { createP2G1HumanOnlyAssembly } from '../src/p2-g1-human-only-assembly.mjs';
import { createChannelMessageInbox } from '../src/p1-003-channel-message-inbox.mjs';
import { createP2016DirectIntakeProcessor } from '../src/p2-016-direct-intake.mjs';

test('G2-E08 twelve reverse-ordered normal Frames in one local second preserve durable arrival sequence and one Ticket after duplicate replay',async t=>{
  await withG2Runtime(async f=>{
    // Owned test assembly clock only. No host/DB clock changes and no claim
    // that an unprovided Provider timestamp determines business ordering.
    // Force delayed projection across a local-second boundary, independent of machine speed.
    const stamp=Math.floor(Date.now()/1000)*1000-2000,inbox=createChannelMessageInbox({pool:f.pool}),processor=createP2016DirectIntakeProcessor();
    const assembly=createP2G1HumanOnlyAssembly({operationalIntake:{accept:input=>inbox.accept(input,processor)},coordinator:f.runtime.coordinator,now:()=>new Date(stamp)});
    const frames=Array.from({length:12},(_,i)=>({cmd:'aibot_msg_callback',headers:{req_id:randomUUID()},body:{msgid:randomUUID(),aibotid:f.botId,
      chattype:'single',from:{userid:f.reporters[0]},msgtype:'text',text:{content:'打印机卡纸。补充描述序号'+i}}})).reverse();
    for(const frame of frames)assert.equal((await assembly.handleFrame(frame)).p1_committed,true);
    await f.pump();
    const rows=(await f.pool.query(`SELECT c.msg_id,c.received_epoch_ms::text,m.sequence_no FROM intake.service_intake_message m
      JOIN channel.message_inbox c ON c.id=m.channel_message_id ORDER BY m.sequence_no`)).rows;
    assert.deepEqual(rows.map(r=>r.msg_id),frames.map(f=>f.body.msgid));
    assert.deepEqual(rows.map(r=>Number(r.sequence_no)),Array.from({length:12},(_,i)=>i+1));
    assert.deepEqual([...new Set(rows.map(r=>r.received_epoch_ms))],[String(stamp)]);
    const counts=async()=>(await f.pool.query(`SELECT (SELECT count(*)::integer FROM channel.message_inbox) AS inbox,
      (SELECT count(*)::integer FROM intake.service_intake) AS intakes,(SELECT count(*)::integer FROM pilot_ticket.ticket) AS tickets,
      (SELECT count(*)::integer FROM conversation.item WHERE item_type='USER_MESSAGE') AS timeline_messages`)).rows[0];
    const before=await counts();assert.deepEqual(before,{inbox:12,intakes:1,tickets:1,timeline_messages:12});
    await Promise.all(frames.map(frame=>assembly.handleFrame(frame)));await f.pump();
    assert.deepEqual(await counts(),before);
    t.diagnostic(JSON.stringify({scenario_id:'G2-E08',source_frames:12,local_second_count:1,reverse_submission_order_preserved:true,
      replay_message_delta:0,replay_intake_delta:0,replay_ticket_delta:0,seeded_business_facts:false}));
  });
});
