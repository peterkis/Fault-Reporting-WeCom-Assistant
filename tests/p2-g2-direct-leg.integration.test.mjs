import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { withG2Runtime, G2_RULE_FLAGS } from './helpers/p2-g2-runtime-harness.mjs';
import { createP2016OrchestrationWorker } from '../src/p2-016-orchestration-adapters.mjs';

async function counts(pool) {
  return (await pool.query(`SELECT
    (SELECT count(*)::integer FROM communication.delivery WHERE target_type='PERSON') AS person_deliveries,
    (SELECT count(*)::integer FROM communication.delivery WHERE target_type='GROUP') AS group_deliveries,
    (SELECT count(*)::integer FROM pilot_ticket.reporter_access_grant) AS grants`)).rows[0];
}

test('P2-G2 group clarification does not create private artifacts before a real Direct Leg', async t => {
  await withG2Runtime(async f => {
    await f.inbound('@合成测试助手'); assert.equal((await f.pump()).processed, 1);
    assert.deepEqual(await counts(f.pool), { person_deliveries: 0, group_deliveries: 1, grants: 0 });
    const text = (await f.pool.query("SELECT content->>'text' AS text FROM communication.message WHERE sender_system_code='RULE_FIRST_ORCHESTRATOR'")).rows[0].text;
    assert.match(text, /可直接在群里补充.*也可选择机器人单聊/u);
    assert.doesNotMatch(text, /已.*(?:私聊|发送单聊|送达)/u);
    assert.equal((await f.pump()).processed, 0);
    await f.delivery.runOnce(); assert.equal(f.providerCalls.length, 1);
    assert.equal(f.providerCalls[0][0], f.groupId);
    await f.inbound('系统不行', { chatType: 'single' }); assert.equal((await f.pump()).processed, 1);
    assert.equal(await f.personDestinationAuthorizer({ transaction: f.pool, bot_id: f.botId, reporter_user_id: f.reporters[0] }), true);
    assert.deepEqual(await counts(f.pool), { person_deliveries: 1, group_deliveries: 1, grants: 0 });
    await f.delivery.runOnce(); assert.equal(f.providerCalls.length, 2); assert.equal(f.providerCalls[1][0], f.reporters[0]);
    const legs = (await f.pool.query('SELECT leg_type FROM intake.channel_leg ORDER BY leg_ordinal')).rows.map(r => r.leg_type);
    assert.deepEqual(legs, ['GROUP_ORIGIN', 'DIRECT_GUIDED']);
    t.diagnostic(JSON.stringify({ group_only_person_artifacts: 0, group_provider_calls: 1, first_direct_inbound_accepted: true, direct_provider_calls: 1 }));
  });
});

test('P2-G2 App manual-review clarification uses the same Direct Leg generation guard', async () => {
  await withG2Runtime(async f => {
    await f.inbound('医保这个规则怎么理解'); await f.pump();
    const review = (await f.get('/api/manual-reviews')).items[0]; assert.ok(review);
    const result = await f.post('/api/manual-reviews/' + review.id + '/resolve', {
      client_command_id: randomUUID(), expected_row_version: review.row_version,
      resolution_code: 'REQUEST_DESCRIPTION', resolution_reason_code: 'OPERATOR_REQUESTED_DESCRIPTION',
    });
    assert.equal(result.status, 200); assert.equal(result.body.ok, true);
    assert.deepEqual(await counts(f.pool), { person_deliveries: 0, group_deliveries: 1, grants: 0 });
    await f.delivery.runOnce(); assert.equal(f.providerCalls.length, 1); assert.equal(f.providerCalls[0][0], f.groupId);
  });
});

test('P2-G2 retained CLOSED Direct Leg permits a new group clarification', async () => {
  await withG2Runtime(async f => {
    await f.inbound('@合成测试助手'); await f.pump();
    await f.inbound('系统不行', { chatType: 'single' }); await f.pump();
    await f.pool.query("UPDATE intake.channel_leg SET status='CLOSED',closed_at=platform.local_now(),row_version=row_version+1 WHERE leg_type='DIRECT_GUIDED'");
    assert.equal(await f.personDestinationAuthorizer({ transaction: f.pool, bot_id: f.botId, reporter_user_id: f.reporters[0] }), true);
    await f.inbound('系统不行'); assert.equal((await f.pump()).processed, 1);
    assert.deepEqual(await counts(f.pool), { person_deliveries: 2, group_deliveries: 2, grants: 0 });
  });
});

test('P2-G2 destination query database error rolls rule facts back instead of meaning no eligible destination', async () => {
  await withG2Runtime(async f => {
    await f.inbound('@合成测试助手');
    const broken = createP2016OrchestrationWorker({ pool: f.pool, identityHmacKey: 'synthetic-g2-identity-key',
      notifications: f.runtime.notifications, realtime: f.runtime.realtimeProjector,
      personDestinationAuthorizer: input => f.personDestinationAuthorizer({ ...input,
        transaction: { query: () => input.transaction.query('SELECT 1/0') } }),
    });
    await assert.rejects(broken.processDueBatch({ feature_flags: G2_RULE_FLAGS }), { code: '25P02' });
    assert.deepEqual(await counts(f.pool), { person_deliveries: 0, group_deliveries: 0, grants: 0 });
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM intake.deterministic_decision')).rows[0].n, 0);
    assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM channel.message_inbox WHERE processing_status='COMPLETED'")).rows[0].n, 1);
    assert.equal((await f.pump()).processed, 1);
    assert.deepEqual(await counts(f.pool), { person_deliveries: 0, group_deliveries: 1, grants: 0 });
  });
});

test('P2-G2 establishing Direct Leg never backfills old Ticket cards; new events can notify', async () => {
  await withG2Runtime(async f => {
    await f.inbound('处方提交不了'); await f.pump();
    const ticket = (await f.pool.query('SELECT id::text FROM pilot_ticket.ticket')).rows[0];
    const event = (await f.pool.query("SELECT event_id::text FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid AND event_type='ticket.created'", [ticket.id])).rows[0];
    assert.deepEqual(await counts(f.pool), { person_deliveries: 0, group_deliveries: 1, grants: 0 });
    await f.inbound('谢谢', { chatType: 'single' }); await f.pump();
    const before = await counts(f.pool);
    assert.equal(before.grants, 0);
    const replay = await f.runtime.notifications.project({ transaction: f.pool, ticket, event });
    assert.equal(replay.replayed, true); assert.deepEqual(await counts(f.pool), before);
    const current = await f.get('/api/tickets/' + ticket.id);
    const result = await f.post('/api/tickets/' + ticket.id + '/accept', {
      client_command_id: randomUUID(), expected_version: current.version, reason_code: 'OPERATOR_ACCEPTED',
    });
    assert.equal(result.status, 200); assert.equal(result.body.ok, true);
    const after = await counts(f.pool);
    assert.equal(after.person_deliveries, before.person_deliveries + 1); assert.equal(after.grants, 1);
  });
});
