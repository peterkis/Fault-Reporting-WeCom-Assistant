import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';
import { createP2012DynamicWeComSender } from '../src/p2-012-live-reporter-scope.mjs';
import { createCommunicationDeliveryWorker } from '../src/p2-004-communication-delivery-worker.mjs';
import { textHashP2016,transactionP2016 } from '../src/p2-016-domain-contracts.mjs';
import { createP2016TicketNotificationProjector } from '../src/p2-016-ticket-notification-projector.mjs';

test('existing group-only receipt replays without duplicate artifacts even when the optional private authorizer is absent',async()=>{
  await withG2Runtime(async f=>{
    await f.inbound('打印机卡纸了',{chatType:'group'});await f.pump();
    const ticket=(await f.pool.query('SELECT id FROM pilot_ticket.ticket')).rows[0];
    const event=(await f.pool.query("SELECT event_id FROM pilot_ticket.ticket_event WHERE ticket_id=$1 AND event_type='ticket.created'",[ticket.id])).rows[0];
    const counts=async()=>(await f.pool.query(`SELECT (SELECT count(*)::int FROM communication.message) AS messages,
      (SELECT count(*)::int FROM communication.outbox) AS outboxes,(SELECT count(*)::int FROM communication.delivery) AS deliveries,
      (SELECT count(*)::int FROM pilot_ticket.reporter_access_grant) AS grants`)).rows[0];
    const before=await counts(),projector=createP2016TicketNotificationProjector({enabled:true,cardEnabled:true,reporterAccess:f.runtime.reporterAccess});
    for(let i=0;i<3;i++)assert.equal((await transactionP2016(f.pool,transaction=>projector.project({transaction,ticket,event}))).replayed,true);
    assert.deepEqual(await counts(),before);assert.equal(before.grants,0);assert.equal(f.providerCalls.length,0);
  });
});

for(const [chatType,providerCode] of [['single',0],['group',0],['group',45009],['group',93000],['group',null]])test('default notification frequency through complete authenticated lifecycle '+chatType+'/'+providerCode,async()=>{
  await withG2Runtime(async f=>{
    await f.inbound('打印机有问题',{chatType});await f.pump();
    const ticket=(await f.pool.query('SELECT id FROM pilot_ticket.ticket')).rows[0];assert.ok(ticket);
    for(const action of ['accept','start','request-information','resume','wait-vendor','resume','resolve','confirm']){
      const detail=await f.get('/api/tickets/'+ticket.id);
      const command={client_command_id:randomUUID(),expected_version:detail.version,reason_code:'OPERATOR_REVIEWED',note:'合成处理记录'};
      const url='/api/tickets/'+ticket.id+'/'+action;
      const result=await f.post(url,command,detail.version);assert.equal(result.status,200,JSON.stringify(result.body));
      assert.equal((await f.post(url,command,detail.version)).status,200);
    }
    const rows=(await f.pool.query(`SELECT b.notification_type,b.destination_type,m.message_type,m.content FROM communication.ticket_notification_binding b
      JOIN communication.message m ON m.id=b.message_id ORDER BY m.created_at,m.id`)).rows;
    assert.deepEqual(rows.map(r=>r.notification_type).sort(),chatType==='single'?['TICKET_ACCEPTED','TICKET_CLOSED']:['TICKET_CLOSED','TICKET_CREATED']);
    assert.ok(rows.every(r=>r.destination_type===(chatType==='single'?'PERSON':'GROUP')));
    if(chatType==='single')assert.ok(rows.every(r=>r.message_type==='template_card'&&r.content.public_ref));
    else {
      assert.equal(rows.find(r=>r.notification_type==='TICKET_CLOSED').content.transport,'WECOM_GROUP_WEBHOOK');
      const calls=[],audit=[];
      const sender=createP2012DynamicWeComSender({pool:f.pool,enabled:true,botId:f.botId,
        allowedTargetHashes:[textHashP2016(f.groupId)],approvedGroupHashes:[textHashP2016(f.groupId)],
        gateway:{getAuthenticatedClient(){throw Error('WSS_MUST_NOT_SEND_CLOSURE');}},
        groupClosureWebhook:{routes:[{botId:f.botId,groupId:f.groupId,url:'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=synthetic-unused'}],
          recordProviderResult:record=>audit.push(record),
          fetchImpl:async(url,options)=>{assert.equal(options.redirect,'error');calls.push(JSON.parse(options.body));
            if(providerCode===null)throw Error('SYNTHETIC_NETWORK_RESPONSE_LOST');
            return new Response(JSON.stringify({errcode:providerCode}),{status:200});}}});
      const delivery=createCommunicationDeliveryWorker({pool:f.pool,sender,enabled:true});
      const id=(await f.pool.query("SELECT delivery_id FROM communication.ticket_notification_binding WHERE notification_type='TICKET_CLOSED'")).rows[0].delivery_id;
      await delivery.deliver({deliveryId:id});
      assert.equal((await delivery.getDelivery({deliveryId:id})).status,providerCode===0?'SENT':providerCode===null?'RECONCILIATION_REQUIRED':'DEAD_LETTER');
      assert.equal(audit.length,1);assert.equal(audit[0].provider_errcode,providerCode);
      assert.equal(audit[0].operation,'send_msg');assert.equal(audit[0].outcome,providerCode===0?'ACKED':providerCode===null?'UNKNOWN':'REJECTED');
      assert.doesNotMatch(JSON.stringify(audit),/synthetic-unused|reporter-0|qyapi/u);
      assert.deepEqual(calls,[{msgtype:'text',text:{content:rows.find(r=>r.notification_type==='TICKET_CLOSED').content.text,mentioned_list:[f.reporters[0]]}}]);
      await delivery.deliver({deliveryId:id});assert.equal(calls.length,1);
    }
    assert.equal(f.providerCalls.length,0);
  });
});
