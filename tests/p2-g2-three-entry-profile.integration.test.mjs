import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withG2Runtime,G2_RULE_FLAGS } from './helpers/p2-g2-runtime-harness.mjs';
import { createP2G1HumanOnlyAssembly } from '../src/p2-g1-human-only-assembly.mjs';
import { createChannelMessageInbox } from '../src/p1-003-channel-message-inbox.mjs';
import { createP2016DirectIntakeProcessor } from '../src/p2-016-direct-intake.mjs';

test('group active session continues after 120 seconds but respects Reporter, explicit new fault and idle boundaries',async()=>{
  await withG2Runtime(async f=>{
    const start=Date.now();let clock=start;
    const inbox=createChannelMessageInbox({pool:f.pool}),processor=createP2016DirectIntakeProcessor();
    const assembly=createP2G1HumanOnlyAssembly({operationalIntake:{accept:input=>inbox.accept(input,processor)},coordinator:f.runtime.coordinator,now:()=>new Date(clock)});
    const send=async(text,offset,reporter=f.reporters[0])=>{
      clock=start+offset;
      const frame={cmd:'aibot_msg_callback',headers:{req_id:randomUUID()},body:{msgid:randomUUID(),aibotid:f.botId,
        chattype:'group',chatid:f.groupId,from:{userid:reporter},msgtype:'text',text:{content:'@故障助手 '+text}}};
      assert.equal((await assembly.handleFrame(frame)).p1_committed,true);
      await f.worker.processDueBatch({feature_flags:G2_RULE_FLAGS,now_epoch_ms:String(clock+15000)});
    };
    const count=async()=>(await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n;
    await send('处方提交失败',0);await send('补充：处方提交一直失败',120000);assert.equal(await count(),1);
    await send('处方提交失败',121000,f.reporters[1]);assert.equal(await count(),2);
    await send('另一个问题：打印不了',122000);assert.equal(await count(),3);
    await send('打印不了',122000+1800001);assert.equal(await count(),4);
    assert.equal(f.providerCalls.length,0);
  });
});

test('G2 business profile one completes group clarification, admission and human conversation without any Direct Leg',async t=>{
  await withG2Runtime(async f=>{
    await f.inbound('@故障助手');await f.pump();
    const clarification=(await f.pool.query("SELECT content->>'text' AS text FROM communication.message WHERE sender_system_code='RULE_FIRST_ORCHESTRATOR'")).rows[0].text;
    assert.match(clarification,/群.{0,5}补充/u);assert.doesNotMatch(clarification,/请先打开机器人单聊/u);
    await f.inbound('处方提交不了');await f.pump();
    const ticket=(await f.pool.query('SELECT id FROM pilot_ticket.ticket')).rows[0];assert.ok(ticket);
    const session=(await f.pool.query("SELECT id FROM conversation.session WHERE status<>'ENDED'")).rows[0];
    const act=async(action,body={})=>{const d=await f.get('/api/conversations/'+session.id);
      return f.post('/api/conversations/'+session.id+'/'+action,{client_command_id:randomUUID(),expected_row_version:d.session.row_version,...body});};
    assert.equal((await act('takeover',{target_principal_id:f.admin.id,reason_code:'WORKBENCH_TAKEOVER'})).status,200);
    assert.equal((await act('messages',{text:'已收到您的群内报修，正在处理。'})).status,202);
    await f.inbound('补充：保存处方时没有反应。');await f.pump();
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n,1);
    assert.equal((await act('messages',{text:'已完成处理，请在群里确认是否恢复。'})).status,202);
    await f.inbound('现在恢复正常了，谢谢。');await f.pump();
    assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM intake.channel_leg WHERE leg_type IN ('DIRECT_GUIDED','DIRECT_ORGANIC')")).rows[0].n,0);
    assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM communication.delivery WHERE target_type='PERSON'")).rows[0].n,0);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.reporter_access_grant')).rows[0].n,0);
    const deliveries=(await f.pool.query("SELECT d.target_type,m.purpose FROM communication.delivery d JOIN communication.outbox o ON o.id=d.outbox_id JOIN communication.message m ON m.id=o.message_id")).rows;
    assert.ok(deliveries.every(d=>d.target_type==='GROUP'));assert.equal(deliveries.filter(d=>d.purpose==='HUMAN_REPLY').length,2);
    assert.equal(f.providerCalls.length,0);
    t.diagnostic(JSON.stringify({business_profile:'GROUP_ONLY',surface:'NORMAL_GROUP_FRAMES_AUTHENTICATED_HTTP_REAL_OUTBOX',
      ticket_count:1,human_group_replies:2,direct_legs:0,private_deliveries:0,grants:0,provider_calls:0}));
  });
});
