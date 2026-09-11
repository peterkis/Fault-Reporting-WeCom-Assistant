import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withG2Runtime} from './helpers/p2-g2-runtime-harness.mjs';
import {configurationFixture} from './helpers/p2-g2-configuration-fixture.mjs';
import {collectG2Reconciliation} from '../src/p2-g2-reconciliation.mjs';
import {g2Hash} from '../src/p2-g2-validation-config.mjs';

test('人工确认高风险显式续报复用原工单，重放不重复建单或通知',async()=>{
  await withG2Runtime(async f=>{
    await f.inbound('打印机卡纸了');await f.pump();
    const original=(await f.get('/api/tickets')).items[0];
    const ref=(await f.pool.query('SELECT public_ref FROM pilot_ticket.reporter_public_ref WHERE ticket_id=$1',[original.id])).rows[0].public_ref;
    await f.inbound('续接工单 '+ref+'：急诊唯一叫号终端坏了。',{chatType:'single'});await f.pump();
    const review=(await f.get('/api/manual-reviews')).items[0];assert.ok(review);
    const before=await f.get('/api/manual-reviews/'+review.id);
    assert.equal((await f.get('/api/tickets')).items.length,1);
    const notifications=(await f.pool.query('SELECT count(*)::integer AS n FROM communication.ticket_notification_binding')).rows[0].n;
    const body={client_command_id:randomUUID(),expected_row_version:review.row_version,resolution_code:'CONFIRM_TICKET_ELIGIBLE',resolution_reason_code:'HUMAN_CONFIRMED'};
    for(let i=0;i<2;i++)assert.equal((await f.post('/api/manual-reviews/'+review.id+'/resolve',body)).status,200);
    const tickets=(await f.get('/api/tickets')).items;assert.deepEqual(tickets.map(ticket=>ticket.id),[original.id]);
    assert.equal((await f.get('/api/contact-journeys/'+review.journey_id)).linked_ticket_id,original.id);
    assert.deepEqual((await f.get('/api/manual-reviews/'+review.id)).safe_result,before.safe_result);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM communication.ticket_notification_binding')).rows[0].n,notifications);
  });
});

test('合法内部备注不进入 Outbox，真实只读对账不将其判为外发泄漏',async()=>{
  await withG2Runtime(async f=>{
    await f.inbound('打印机卡纸了',{chatType:'single'});await f.pump();
    const session=(await f.pool.query('SELECT conversation_session_id AS id FROM intake.channel_leg LIMIT 1')).rows[0];
    const detail=await f.get('/api/conversations/'+session.id);
    assert.equal((await f.post('/api/conversations/'+session.id+'/takeover',{client_command_id:randomUUID(),expected_row_version:detail.session.row_version,target_principal_id:f.admin.id,reason_code:'WORKBENCH_TAKEOVER'})).status,200);
    const owned=await f.get('/api/conversations/'+session.id);
    assert.equal((await f.post('/api/conversations/'+session.id+'/internal-notes',{client_command_id:randomUUID(),expected_row_version:owned.session.row_version,text:'synthetic-review-private-note'})).status,201);
    assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM communication.message WHERE purpose='INTERNAL_NOTE'")).rows[0].n,1);
    assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM communication.outbox o JOIN communication.message m ON m.id=o.message_id WHERE m.purpose='INTERNAL_NOTE'")).rows[0].n,0);
    const {manifest}=configurationFixture();manifest.scope.person_hashes=f.reporters.map(g2Hash);manifest.scope.direct_organic_person_hash=g2Hash(f.reporters[2]);
    const tx=await f.pool.connect();
    try{await tx.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const snapshot=await collectG2Reconciliation({transaction:tx,manifest});assert.equal(snapshot.counts.internal_note_leaks,0);
      assert.ok(!JSON.stringify(snapshot).includes('synthetic-review-private-note'));await tx.query('ROLLBACK');
    }finally{tx.release();}
  });
});
