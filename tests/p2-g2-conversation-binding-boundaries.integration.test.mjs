import test from 'node:test';
import assert from 'node:assert/strict';
import {withLateBindingFixture} from './helpers/p2-g2-late-binding-harness.mjs';
import {reconcileP2016ConversationBindings} from '../src/p2-016-conversation-binding.mjs';

test('bounded binding scan advances beyond twenty invalid HMAC rows and twelve concurrent cycles never rewrite accepted facts',async t=>{
  await withLateBindingFixture(async f=>{
    for(let i=0;i<21;i++)assert.equal((await f.submit(i)).p1_committed,true);
    await f.pump();await f.pump();await f.runtime.coordinator.runOnce();await f.runtime.coordinator.runOnce();
    const legs=(await f.pool.query('SELECT id,source_intake_id FROM intake.channel_leg ORDER BY id')).rows;assert.equal(legs.length,21);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM conversation.session')).rows[0].n,21);
    await f.pool.query('UPDATE intake.channel_leg SET channel_identity_hash=$2 WHERE id=ANY($1::uuid[])',[legs.slice(0,20).map(l=>l.id),'f'.repeat(64)]);
    const accepted=async()=>(await f.pool.query(`SELECT (SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM intake.deterministic_decision d) AS decisions,
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM pilot_ticket.ticket t) AS tickets`)).rows[0];
    const before=await accepted();
    // Exact no-cursor rescan reproduces the old scheduling failure on real DB
    // data; it is not presented as a separate frozen candidate execution.
    for(let i=0;i<2;i++)assert.equal((await reconcileP2016ConversationBindings({pool:f.pool,identityHmacKey:f.identityHmacKey,beforeTransaction:f.runtime.realtimeProjector.lock})).filled,0);
    assert.equal((await f.pool.query('SELECT conversation_session_id FROM intake.channel_leg WHERE id=$1',[legs[20].id])).rows[0].conversation_session_id,null);
    await f.pump();await f.pump();
    const valid=(await f.pool.query('SELECT conversation_session_id,row_version::text FROM intake.channel_leg WHERE id=$1',[legs[20].id])).rows[0];
    assert.ok(valid.conversation_session_id);assert.equal(valid.row_version,'2');
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM intake.channel_leg WHERE id=ANY($1::uuid[]) AND conversation_session_id IS NOT NULL',[legs.slice(0,20).map(l=>l.id)])).rows[0].n,0);
    await Promise.all(Array.from({length:12},()=>f.pump()));
    assert.deepEqual((await f.pool.query('SELECT conversation_session_id,row_version::text FROM intake.channel_leg WHERE id=$1',[legs[20].id])).rows[0],valid);
    assert.deepEqual(await accepted(),before);
    t.diagnostic(JSON.stringify({invalid_rows_unchanged:20,valid_later_row_filled:1,concurrent_cycles:12,decision_ticket_rewrites:0}));
  });
});

test('post-acceptance binding failure rolls back both references and explicitly preserves the already committed new Ticket',async()=>{
  await withLateBindingFixture(async f=>{
    await f.submit(0);await f.pump();await f.runtime.coordinator.runOnce();
    const first=(await f.pool.query('SELECT id,journey_id FROM intake.channel_leg')).rows[0];
    // SYNTHETIC_FAULT in this owned test DB, removed before retry.
    await f.pool.query('ALTER TABLE intake.contact_journey ADD CONSTRAINT g2_owned_binding_fault CHECK (current_session_id IS NULL)');
    await f.submit(1);
    await assert.rejects(f.pump(),error=>error.code==='P2_015_POST_BATCH_MAINTENANCE_FAILED'&&error.accepted_batch_committed===true&&error.processed===1);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n,2);
    assert.equal((await f.pool.query('SELECT conversation_session_id FROM intake.channel_leg WHERE id=$1',[first.id])).rows[0].conversation_session_id,null);
    assert.equal((await f.pool.query('SELECT current_session_id FROM intake.contact_journey WHERE id=$1',[first.journey_id])).rows[0].current_session_id,null);
    await f.pool.query('ALTER TABLE intake.contact_journey DROP CONSTRAINT g2_owned_binding_fault');
    await f.runtime.coordinator.runOnce();assert.equal((await f.pump()).processed,0);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM intake.channel_leg WHERE conversation_session_id IS NULL OR conversation_thread_id IS NULL')).rows[0].n,0);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n,2);
  });
});

test('two delayed Legs retain their separate historical Sessions and only the latest Leg fills the current Journey pointer',async()=>{
  await withLateBindingFixture(async f=>{
    await f.submit(0,'group','@测试助手');await f.pump();await f.submit(0);await f.pump();
    const legs=(await f.pool.query('SELECT id,journey_id,source_intake_id,leg_type,leg_ordinal FROM intake.channel_leg ORDER BY leg_ordinal')).rows;
    assert.deepEqual(legs.map(l=>l.leg_type),['GROUP_ORIGIN','DIRECT_GUIDED']);assert.equal(legs[0].journey_id,legs[1].journey_id);
    await f.runtime.coordinator.runOnce();await f.pump();
    const actual=(await f.pool.query(`SELECT l.id,l.conversation_session_id,s.id AS actual_session FROM intake.channel_leg l
      JOIN conversation.session s ON s.service_intake_id=l.source_intake_id ORDER BY l.leg_ordinal`)).rows;
    assert.ok(actual.every(l=>l.conversation_session_id===l.actual_session));assert.notEqual(actual[0].actual_session,actual[1].actual_session);
    const journey=(await f.pool.query('SELECT origin_session_id,current_session_id FROM intake.contact_journey WHERE id=$1',[legs[0].journey_id])).rows[0];
    assert.deepEqual(journey,{origin_session_id:actual[0].actual_session,current_session_id:actual[1].actual_session});
    // An existing conflicting partial reference is a synthetic integrity fault,
    // never permission for the reconciler to replace it with a guessed value.
    await f.pool.query('UPDATE intake.channel_leg SET conversation_session_id=$2,conversation_thread_id=NULL WHERE id=$1',[legs[0].id,actual[1].actual_session]);
    await f.pump();
    assert.deepEqual((await f.pool.query('SELECT conversation_session_id,conversation_thread_id FROM intake.channel_leg WHERE id=$1',[legs[0].id])).rows[0],
      {conversation_session_id:actual[1].actual_session,conversation_thread_id:null});
  });
});
