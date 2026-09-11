import test from 'node:test';
import assert from 'node:assert/strict';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';
import { configurationFixture } from './helpers/p2-g2-configuration-fixture.mjs';
import { g2Hash } from '../src/p2-g2-validation-config.mjs';
import { collectG2Reconciliation } from '../src/p2-g2-reconciliation.mjs';

test('read-only reconciliation preserves actual Delivery/attempt ledger without identity, content or invented ACK',async()=>{
  await withG2Runtime(async f=>{
    await f.inbound('处方提交不了',{chatType:'single'});await f.pump();
    const {manifest}=configurationFixture();manifest.scope.person_hashes=f.reporters.map(g2Hash);
    manifest.scope.direct_organic_person_hash=g2Hash(f.reporters[2]);
    const before=await f.pool.query('SELECT count(*)::integer AS n FROM communication.delivery');
    const tx=await f.pool.connect();let snapshot;
    try{await tx.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');snapshot=await collectG2Reconciliation({transaction:tx,manifest});await tx.query('ROLLBACK');}
    finally{tx.release();}
    assert.equal(snapshot.counts.ticket_count,1);assert.equal(snapshot.deliveries.length,before.rows[0].n);
    assert.ok(snapshot.deliveries.length>0);assert.equal(snapshot.counts.internal_note_leaks,0);
    assert.ok(snapshot.deliveries.every(d=>d.status==='PENDING'&&!Object.hasOwn(d,'provider_ack_numeric')));
    assert.ok(snapshot.deliveries.some(d=>d.source_event_type==='ticket.created'&&d.source_version_kind==='TICKET_AGGREGATE_VERSION'));
    assert.equal(snapshot.attempts.length,0);
    for(const canary of [...f.reporters,'处方提交不了'])assert.ok(!JSON.stringify(snapshot).includes(canary));
    assert.deepEqual((await f.pool.query('SELECT count(*)::integer AS n FROM communication.delivery')).rows,before.rows);
  },{ticketNotificationAdditionalEvents:['ticket.created']});
});

test('approved group Reporter plus actual Direct Leg remains within reconciliation scope when absent from explicit person hashes',async()=>{
  await withG2Runtime(async f=>{
    const reporter=f.reporters[3];await f.inbound('【p2-g2测试】打印机卡纸',{reporter});await f.pump();
    await f.inbound('【p2-g2测试】打印机卡纸',{reporter,chatType:'single'});await f.pump();
    const ticket=(await f.get('/api/tickets')).items[0],detail=await f.get('/api/tickets/'+ticket.id);
    const {randomUUID}=await import('node:crypto');
    assert.equal((await f.post('/api/tickets/'+ticket.id+'/accept',{client_command_id:randomUUID(),expected_version:detail.version,reason_code:'OPERATOR_REVIEWED'})).status,200);
    const {manifest}=configurationFixture();manifest.scope.person_hashes=f.reporters.slice(0,3).map(g2Hash);manifest.scope.direct_organic_person_hash=g2Hash(f.reporters[2]);
    assert.ok((await f.pool.query("SELECT count(*)::integer AS n FROM communication.delivery WHERE target_type='PERSON'")).rows[0].n>0);
    const tx=await f.pool.connect();try{await tx.query('BEGIN READ ONLY');
      const snapshot=await collectG2Reconciliation({transaction:tx,manifest});assert.equal(snapshot.counts.out_of_scope_deliveries,0);
      assert.ok(!JSON.stringify(snapshot).includes(reporter));await tx.query('ROLLBACK');
    }finally{tx.release();}
  },{reporterCount:4});
});
