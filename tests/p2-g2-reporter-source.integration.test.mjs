import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withG2Runtime,G2_RULE_FLAGS} from './helpers/p2-g2-runtime-harness.mjs';
import {createP2016OrchestrationWorker} from '../src/p2-016-orchestration-adapters.mjs';
import {g2BusinessCounts} from './helpers/p2-g2-gold-observation.mjs';

test('D12-057 real rollback after notification append leaves accepted Inbox but no Ticket/card delivery',async t=>{
  await withG2Runtime(async f=>{
    await f.inbound('打印机卡纸了',{chatType:'single'});const before=await g2BusinessCounts(f.pool);let appended=false;
    const worker=createP2016OrchestrationWorker({pool:f.pool,identityHmacKey:'synthetic-g2-identity-key',
      realtime:f.runtime.realtimeProjector,personDestinationAuthorizer:f.personDestinationAuthorizer,
      notifications:{project:async input=>{
        await f.runtime.notifications.project(input);
        appended=Number((await input.transaction.query('SELECT count(*) FROM communication.delivery')).rows[0].count)===1;
        throw new Error('SYNTHETIC_AFTER_NOTIFICATION_APPEND');
      }}});
    await assert.rejects(worker.processDueBatch({feature_flags:G2_RULE_FLAGS,now_epoch_ms:String(Date.now()+15000)}));
    assert.equal(appended,true);assert.deepEqual(await g2BusinessCounts(f.pool),before);
    assert.equal(before.inbox,1);assert.equal(before.tickets,0);assert.equal(f.providerCalls.length,0);
    t.diagnostic(JSON.stringify({source_case_id:'D12-057',surface:'NORMAL_INGRESS_WITH_ACTUAL_POST_APPEND_TRANSACTION_ROLLBACK',
      inbox_retained:true,ticket_delta:0,delivery_delta:0,provider_calls:0}));
  },{ticketNotificationAdditionalEvents:['ticket.created']});
});

test('D12-016/058/059/060/061 three real Ticket grants isolate Reporter HTTP access; card event callback stays unsupported',async t=>{
  await withG2Runtime(async f=>{
    for(const reporter of f.reporters){await f.inbound('打印机卡纸了',{chatType:'single',reporter});await f.pump();}
    const notifications=(await f.pool.query(`SELECT b.delivery_id,b.ticket_id,t.ticket_no FROM communication.ticket_notification_binding b
      JOIN pilot_ticket.ticket t ON t.id=b.ticket_id ORDER BY t.ticket_no`)).rows;
    assert.equal(notifications.length,3);const sessions=[];
    const exchange=grant=>fetch(f.origin+'/api/reporter/access/exchange',{method:'POST',
      headers:{origin:f.origin,'content-type':'application/json'},body:JSON.stringify({grant})});
    for(const n of notifications){
      assert.equal((await f.delivery.deliver({deliveryId:n.delivery_id})).status,'SENT');
      const grant=await f.runtime.reporterAccess.deliveryGrant({deliveryId:n.delivery_id});
      const r=await exchange(grant.token);assert.equal(r.status,200);const data=await r.json();
      sessions.push({...n,ref:data.public_ref,cookie:r.headers.get('set-cookie').split(';')[0]});
      assert.equal((await exchange(grant.token)).status,401);
    }
    const first=await f.get('/api/tickets/'+notifications[0].ticket_id);
    assert.equal((await f.post('/api/tickets/'+first.id+'/notes',{client_command_id:randomUUID(),expected_version:first.version,
      reason_code:'OPERATOR_REVIEWED',note:'synthetic-internal-note-canary',external_visible:false},first.version)).status,200);
    for(const [i,s] of sessions.entries()){
      const path='/api/reporter/tickets/'+s.ref,headers={cookie:s.cookie};
      const r=await fetch(f.origin+path,{headers});assert.equal(r.status,200);const detail=await r.json();
      assert.equal(detail.ticket_no,s.ticket_no);assert.equal(detail.suffix.length,4);
      const timeline=await fetch(f.origin+path+'/timeline',{headers});assert.equal(timeline.status,200);
      assert.equal((await timeline.text()).includes('synthetic-internal-note-canary'),false);
      assert.equal((await fetch(f.origin+path)).status,401);
      assert.equal((await fetch(f.origin+'/api/reporter/tickets/'+sessions[(i+1)%3].ref,{headers})).status,401);
      assert.ok([401,404].includes((await fetch(f.origin+'/api/reporter/tickets/'+detail.suffix,{headers})).status));
    }
    const before=await g2BusinessCounts(f.pool);
    const event={cmd:'aibot_event_callback',headers:{req_id:randomUUID()},body:{msgid:randomUUID(),create_time:Math.floor(Date.now()/1000),
      aibotid:f.botId,chattype:'single',from:{userid:f.reporters[0]},msgtype:'event',
      event:{eventtype:'template_card_event',task_id:'ticket_'+sessions[0].ref+'_v1',event_key:'synthetic-open'}}};
    assert.equal((await f.runtime.assembly.handleFrame(event)).ok,false);await f.pump();
    assert.deepEqual(await g2BusinessCounts(f.pool),before);assert.equal(f.providerCalls.length,3);
    t.diagnostic(JSON.stringify({source_case_ids:['D12-016','D12-058','D12-059','D12-060','D12-061'],
      surface:'NORMAL_TICKETS_REAL_GRANT_EXCHANGE_AND_REPORTER_HTTP',sdk_callback_surface:'NOT_IMPLEMENTED_REJECTED_WITH_ZERO_BUSINESS_EFFECTS',
      d12_016_validation:'ADJUDICATED_URL_ALTERNATIVE_NOT_CALLBACK_PASS',d12_061_adjudication:'CURRENT_OPTIONAL_CARD_IMPLEMENTED_LOCAL_ONLY',
      synthetic_card_acks:3,live_provider_calls:0}));
  },{ticketNotificationAdditionalEvents:['ticket.created']});
});
