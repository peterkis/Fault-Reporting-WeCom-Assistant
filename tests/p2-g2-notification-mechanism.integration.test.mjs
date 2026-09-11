import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withG2Runtime} from './helpers/p2-g2-runtime-harness.mjs';
import {g2BusinessCounts} from './helpers/p2-g2-gold-observation.mjs';

test('D12-053/054/055/056/064 actual clarification and optional creation card use Outbox; internal note stays internal',async t=>{
  await withG2Runtime(async f=>{
    await f.inbound('@故障助手');await f.pump();
    const group=(await f.pool.query("SELECT id FROM communication.delivery WHERE target_type='GROUP'")).rows[0];assert.ok(group);
    assert.equal((await f.delivery.deliver({deliveryId:group.id})).status,'SENT');
    assert.equal(Number((await f.pool.query("SELECT count(*) FROM communication.delivery WHERE target_type='PERSON'")).rows[0].count),0);
    await f.inbound('@故障助手',{chatType:'single'});await f.pump();
    assert.equal(Number((await f.pool.query("SELECT count(*) FROM communication.delivery WHERE target_type='PERSON'")).rows[0].count),1);
    await f.inbound('打印机有问题',{chatType:'single'});await f.pump();
    assert.equal(Number((await f.pool.query("SELECT count(*) FROM communication.message WHERE message_type='template_card'")).rows[0].count),1);
    assert.equal(Number((await f.pool.query('SELECT count(*) FROM pilot_ticket.ticket')).rows[0].count),1);
    const session=(await f.pool.query("SELECT conversation_session_id AS id FROM intake.channel_leg WHERE leg_type='DIRECT_GUIDED'")).rows[0];
    const detail=await f.get('/api/conversations/'+session.id);
    assert.equal((await f.post('/api/conversations/'+session.id+'/takeover',{client_command_id:randomUUID(),expected_row_version:detail.session.row_version,
      target_principal_id:f.admin.id,reason_code:'WORKBENCH_TAKEOVER'},detail.session.row_version)).status,200);
    const owned=await f.get('/api/conversations/'+session.id),before=await g2BusinessCounts(f.pool);
    assert.equal((await f.post('/api/conversations/'+session.id+'/internal-notes',{client_command_id:randomUUID(),expected_row_version:owned.session.row_version,
      text:'synthetic-internal-mechanism-note'},owned.session.row_version)).status,201);
    const after=await g2BusinessCounts(f.pool);assert.equal(after.messages-before.messages,1);
    assert.equal(after.outboxes,before.outboxes);assert.equal(after.deliveries,before.deliveries);
    assert.equal(Number((await f.pool.query(`SELECT count(*) FROM communication.message m WHERE m.purpose<>'INTERNAL_NOTE'
      AND NOT EXISTS(SELECT 1 FROM communication.outbox o JOIN communication.delivery d ON d.outbox_id=o.id WHERE o.message_id=m.id)`)).rows[0].count),0);
    assert.equal(f.providerCalls.length,1);
    t.diagnostic(JSON.stringify({source_case_ids:['D12-053','D12-054','D12-055','D12-056','D12-064'],
      surface:'NORMAL_GROUP_DIRECT_INTAKE_AUTHENTICATED_NOTE_AND_MOCK_SEND',d12_053_adjudication:'PROACTIVE_OUTBOX_ALTERNATIVE_NOT_CALLBACK_PASS',
      d12_055_adjudication:'PRIVATE_CLARIFICATION_ONLY_AFTER_ACTUAL_DIRECT_LEG',d12_056_adjudication:'OPTIONAL_CREATED_EVENT_EXPLICITLY_ENABLED',
      strong_mention_client_visibility:'NOT_CLAIMED',internal_note_outbox_delta:0,live_provider_calls:0}));
  },{ticketNotificationAdditionalEvents:['ticket.created']});
});

test('D12-062 version seven notification remains single across three committed event replays',async t=>{
  await withG2Runtime(async f=>{
    await f.inbound('打印机有问题',{chatType:'single'});await f.pump();const initial=(await f.get('/api/tickets')).items[0];
    for(const action of ['accept','start','request-information','resume','wait-vendor','resume']){
      const ticket=await f.get('/api/tickets/'+initial.id);
      assert.equal((await f.post('/api/tickets/'+ticket.id+'/'+action,{client_command_id:randomUUID(),expected_version:ticket.version,
        reason_code:'OPERATOR_REVIEWED'},ticket.version)).status,200);
    }
    const ticket=(await f.pool.query('SELECT * FROM pilot_ticket.ticket WHERE id=$1',[initial.id])).rows[0];assert.equal(Number(ticket.version),7);
    const event=(await f.pool.query("SELECT * FROM pilot_ticket.ticket_event WHERE ticket_id=$1 AND aggregate_version=7 AND event_type='ticket.resumed'",[ticket.id])).rows[0];assert.ok(event);
    const before=await g2BusinessCounts(f.pool);
    for(let i=0;i<3;i++){const tx=await f.pool.connect();try{await tx.query('BEGIN');
      assert.equal((await f.runtime.notifications.project({transaction:tx,ticket,event})).replayed,true);await tx.query('COMMIT');
    }catch(error){await tx.query('ROLLBACK');throw error;}finally{tx.release();}}
    assert.deepEqual(await g2BusinessCounts(f.pool),before);
    assert.equal(Number((await f.pool.query('SELECT count(*) FROM communication.ticket_notification_binding WHERE ticket_id=$1 AND ticket_event_id=$2',[ticket.id,event.event_id])).rows[0].count),1);
    t.diagnostic(JSON.stringify({source_case_id:'D12-062',surface:'ACTUAL_LIFECYCLE_VERSION_SEVEN_AND_TRANSACTIONAL_EVENT_REPLAY',
      ticket_version:7,replayed_events:3,new_deliveries:0,optional_resumed_event_enabled:true,provider_calls:f.providerCalls.length}));
  },{ticketNotificationAdditionalEvents:['ticket.resumed']});
});
