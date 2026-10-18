import test from 'node:test';
import assert from 'node:assert/strict';
import {withLateBindingFixture} from './helpers/p2-g2-late-binding-harness.mjs';
import {reconcileP2016ConversationBindings} from '../src/p2-016-conversation-binding.mjs';

test('same-topic Direct input keeps its Intake while the actual Session exists before delayed Leg and Journey binding',async t=>{
  await withLateBindingFixture(async f=>{
    assert.equal((await f.submit(0,'single','系统不行')).p1_committed,true);
    assert.equal((await f.pump()).processed,1);
    const original=(await f.pool.query(`SELECT l.id,l.journey_id,l.source_intake_id,l.conversation_session_id,l.conversation_thread_id,
      j.origin_session_id,j.current_session_id FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id`)).rows[0];
    assert.ok(original);
    assert.deepEqual([original.conversation_session_id,original.conversation_thread_id,original.origin_session_id,original.current_session_id],[null,null,null,null]);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM conversation.session')).rows[0].n,0);
    assert.equal((await f.runtime.coordinator.runOnce()).failures,0);
    const session=(await f.pool.query('SELECT id,thread_id,creation_idempotency_key FROM conversation.session WHERE service_intake_id=$1',[original.source_intake_id])).rows[0];assert.ok(session);
    const primary=(await f.pool.query('SELECT primary_message_id::text FROM intake.service_intake WHERE id=$1',[original.source_intake_id])).rows[0];
    assert.equal(session.creation_idempotency_key,'P2-G1:CHANNEL_MESSAGE:'+primary.primary_message_id);
    // Do not pump between Session projection and the second inbound message:
    // this is the real scheduling window in which reconciliation has not run.
    assert.deepEqual((await f.pool.query(`SELECT l.id,l.journey_id,l.source_intake_id,l.conversation_session_id,l.conversation_thread_id,
      j.origin_session_id,j.current_session_id FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id WHERE l.id=$1`,[original.id])).rows[0],original);
    assert.equal((await f.submit(0,'single','系统不行')).p1_committed,true);
    assert.deepEqual((await f.pool.query('SELECT id,message_count FROM intake.service_intake')).rows,[{id:original.source_intake_id,message_count:2}]);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM conversation.session')).rows[0].n,1);
    assert.equal((await f.pump()).processed,1);assert.equal((await f.runtime.coordinator.runOnce()).failures,0);
    const bound=(await f.pool.query(`SELECT l.id,l.journey_id,l.source_intake_id,l.conversation_session_id,l.conversation_thread_id,
      j.origin_session_id,j.current_session_id FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id`)).rows;
    assert.deepEqual(bound,[{...original,conversation_session_id:session.id,conversation_thread_id:session.thread_id,origin_session_id:session.id,current_session_id:session.id}]);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM conversation.session')).rows[0].n,1);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM intake.contact_journey')).rows[0].n,1);
    assert.deepEqual((await f.pool.query('SELECT DISTINCT service_intake_id,journey_id FROM intake.deterministic_decision')).rows,[{service_intake_id:original.source_intake_id,journey_id:original.journey_id}]);
    assert.equal((await f.pool.query('SELECT max(source_window_end_sequence)::integer AS sequence FROM intake.deterministic_decision')).rows[0].sequence,2);
    t.diagnostic(JSON.stringify({projected_session_before_binding:true,intakes:1,messages:2,sessions:1,journeys:1,original_binding_preserved:true}));
  });
});

for(const fault of ['creation-key-mismatch','conflicting-existing-reference','invalid-channel-hash','shared-invalid-reporter-hash','conflicting-origin-session'])test('an unfilled Direct binding never authorizes reuse with '+fault,async()=>{
  await withLateBindingFixture(async f=>{
    await f.submit(0,'single','系统不行');await f.pump();await f.runtime.coordinator.runOnce();
    const references=async()=>(await f.pool.query(`SELECT l.id,l.journey_id,l.source_intake_id,l.conversation_session_id,l.conversation_thread_id,
      l.channel_identity_hash,l.reporter_identity_hash,j.reporter_identity_hash AS journey_reporter_hash,j.origin_intake_id,j.origin_session_id,j.current_session_id
      FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id`)).rows[0];
    const original=await references();
    assert.deepEqual([original.conversation_session_id,original.conversation_thread_id],[null,null]);
    const session=(await f.pool.query('SELECT id FROM conversation.session WHERE service_intake_id=$1',[original.source_intake_id])).rows[0];assert.ok(session);
    let expectedIntakes=2;
    if(fault==='creation-key-mismatch'){
      // Explicit corruption belongs only to this fixture, never the production path.
      await f.pool.query('UPDATE conversation.session SET creation_idempotency_key=$2 WHERE id=$1',[session.id,'SYNTHETIC_FOREIGN_CREATION_KEY']);
    }else if(fault==='invalid-channel-hash'){
      assert.notEqual(original.channel_identity_hash,'e'.repeat(64));
      await f.pool.query('UPDATE intake.channel_leg SET channel_identity_hash=$2 WHERE id=$1',[original.id,'e'.repeat(64)]);
    }else if(fault==='shared-invalid-reporter-hash'){
      assert.equal(original.reporter_identity_hash,original.journey_reporter_hash);assert.notEqual(original.reporter_identity_hash,'e'.repeat(64));
      await f.pool.query('UPDATE intake.channel_leg SET reporter_identity_hash=$2 WHERE id=$1',[original.id,'e'.repeat(64)]);
      await f.pool.query('UPDATE intake.contact_journey SET reporter_identity_hash=$2 WHERE id=$1',[original.journey_id,'e'.repeat(64)]);
    }else{
      await f.submit(1,'single','系统不行');await f.runtime.coordinator.runOnce();
      const foreign=(await f.pool.query('SELECT id FROM conversation.session WHERE service_intake_id<>$1',[original.source_intake_id])).rows[0];assert.ok(foreign);
      if(fault==='conflicting-origin-session'){
        assert.equal(original.origin_intake_id,original.source_intake_id);
        await f.pool.query('UPDATE intake.contact_journey SET origin_session_id=$2 WHERE id=$1',[original.journey_id,foreign.id]);
      }else await f.pool.query('UPDATE intake.channel_leg SET conversation_session_id=$2 WHERE id=$1',[original.id,foreign.id]);
      expectedIntakes=3;
    }
    const before=await references();
    assert.equal((await f.submit(0,'single','系统不行')).p1_committed,true);
    assert.equal((await f.pool.query('SELECT message_count FROM intake.service_intake WHERE id=$1',[original.source_intake_id])).rows[0].message_count,1);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM intake.service_intake')).rows[0].n,expectedIntakes);
    assert.deepEqual(await references(),before);
  });
});

test('a guided Direct Leg keeps its different valid group origin during pending binding and later same-topic input',async()=>{
  await withLateBindingFixture(async f=>{
    await f.submit(0,'group','@测试助手');await f.pump();await f.runtime.coordinator.runOnce();await f.pump();
    const origin=(await f.pool.query('SELECT id,origin_intake_id,origin_session_id,current_session_id FROM intake.contact_journey')).rows[0];
    assert.ok(origin.origin_session_id);assert.equal(origin.current_session_id,origin.origin_session_id);
    await f.submit(0,'single','打印机卡纸');await f.pump();
    const direct=(await f.pool.query("SELECT id,source_intake_id,conversation_session_id,conversation_thread_id FROM intake.channel_leg WHERE journey_id=$1 AND leg_type='DIRECT_GUIDED'",[origin.id])).rows[0];assert.ok(direct);
    assert.notEqual(direct.source_intake_id,origin.origin_intake_id);assert.deepEqual([direct.conversation_session_id,direct.conversation_thread_id],[null,null]);
    await f.runtime.coordinator.runOnce();
    const session=(await f.pool.query('SELECT id,thread_id FROM conversation.session WHERE service_intake_id=$1',[direct.source_intake_id])).rows[0];assert.ok(session);assert.notEqual(session.id,origin.origin_session_id);
    assert.deepEqual((await f.pool.query('SELECT origin_session_id,current_session_id FROM intake.contact_journey WHERE id=$1',[origin.id])).rows[0],{origin_session_id:origin.origin_session_id,current_session_id:null});
    assert.equal((await f.submit(0,'single','补充：打印机卡纸。')).p1_committed,true);
    assert.equal((await f.pool.query('SELECT message_count FROM intake.service_intake WHERE id=$1',[direct.source_intake_id])).rows[0].message_count,2);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM intake.service_intake')).rows[0].n,2);
    await f.pump();await f.runtime.coordinator.runOnce();
    assert.deepEqual((await f.pool.query('SELECT conversation_session_id,conversation_thread_id FROM intake.channel_leg WHERE id=$1',[direct.id])).rows[0],{conversation_session_id:session.id,conversation_thread_id:session.thread_id});
    assert.deepEqual((await f.pool.query('SELECT origin_session_id,current_session_id FROM intake.contact_journey WHERE id=$1',[origin.id])).rows[0],{origin_session_id:origin.origin_session_id,current_session_id:session.id});
    assert.equal((await f.submit(0,'single','补充：仍是同一台打印机。')).p1_committed,true);
    assert.equal((await f.pool.query('SELECT message_count FROM intake.service_intake WHERE id=$1',[direct.source_intake_id])).rows[0].message_count,3);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM intake.service_intake')).rows[0].n,2);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM intake.contact_journey')).rows[0].n,1);
  });
});

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
