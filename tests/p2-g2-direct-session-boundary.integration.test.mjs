import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';
import { createP2G1HumanOnlyAssembly } from '../src/p2-g1-human-only-assembly.mjs';
import { createChannelMessageInbox } from '../src/p1-003-channel-message-inbox.mjs';
import { createP2016DirectIntakeProcessor } from '../src/p2-016-direct-intake.mjs';
import { shanghaiLocalToEpochMs } from '../src/platform/time-contract.mjs';

async function exercise({ gap, followUp, expectedJourneys, expectedTickets, mutate = null, idleTimeoutMs,
  otherReporter = false, otherBot = false, gapFromLastActivity = false, expectedEndedReason }) {
  await withG2Runtime(async f => {
    // Synthetic time is restricted to this owned test assembly. PostgreSQL and
    // host clocks are untouched; this is not live observation time.
    let clock = Date.now();
    const inbox = createChannelMessageInbox({ pool: f.pool }), processor = createP2016DirectIntakeProcessor({ idleTimeoutMs });
    const assembly = createP2G1HumanOnlyAssembly({ operationalIntake: { accept: input => inbox.accept(input, processor) },
      coordinator: f.runtime.coordinator, now: () => new Date(clock) });
    const submit = async (text, second = false) => {
      const frame = { cmd: 'aibot_msg_callback', headers: { req_id: randomUUID() }, body: {
        msgid: randomUUID(), aibotid: second && otherBot ? 'synthetic-other-bot' : f.botId,
        chattype: 'single', from: { userid: f.reporters[second && otherReporter ? 1 : 0] },
        msgtype: 'text', text: { content: text },
      } };
      assert.equal((await assembly.handleFrame(frame)).p1_committed, true); await f.pump();
    };
    await submit('打印不了');
    if (mutate) await mutate(f);
    if (gapFromLastActivity) clock = Number((await f.pool.query("SELECT last_activity_epoch_ms::text FROM conversation.session WHERE status<>'ENDED'")).rows[0].last_activity_epoch_ms);
    clock += gap;
    await submit(followUp, true);
    const counts = (await f.pool.query(`SELECT
      (SELECT count(*)::integer FROM channel.message_inbox) AS messages,
      (SELECT count(*)::integer FROM intake.contact_journey) AS journeys,
      (SELECT count(*)::integer FROM pilot_ticket.ticket) AS tickets,
      (SELECT count(*)::integer FROM conversation.thread) AS threads,
      (SELECT count(*)::integer FROM conversation.session) AS total_sessions,
      (SELECT count(*)::integer FROM conversation.session WHERE status<>'ENDED') AS active_sessions`)).rows[0];
    assert.equal(counts.messages, 2); assert.equal(counts.threads, otherReporter || otherBot ? 2 : 1);
    assert.equal(counts.journeys, expectedJourneys, JSON.stringify(counts));
    assert.equal(counts.tickets, expectedTickets, JSON.stringify(counts));
    assert.equal(counts.total_sessions, expectedJourneys, JSON.stringify(counts));
    assert.equal(counts.active_sessions, otherReporter || otherBot ? 2 : 1, JSON.stringify(counts));
    if (expectedEndedReason) assert.equal((await f.pool.query("SELECT close_reason FROM conversation.session WHERE status='ENDED'")).rows[0].close_reason, expectedEndedReason);
  });
}

test('explicit new-fault label opens a separate Direct intake while ordinary supplemental wording stays in the prior issue',async()=>{
  await exercise({gap:1000,followUp:'另外一个故障：测试诊室断网。',expectedJourneys:2,expectedTickets:2,expectedEndedReason:'EXPLICIT_USER_NEW_TOPIC'});
  await exercise({gap:1000,followUp:'不是新故障，只是补充：打印还是不行。',expectedJourneys:1,expectedTickets:1});
});

test('explicit new-fault Direct report does not consume an unrelated pending group guidance Journey',async()=>{
  await withG2Runtime(async f=>{
    await f.inbound('@测试助手');await f.pump();
    const original=(await f.pool.query('SELECT id,status,origin_intake_id FROM intake.contact_journey')).rows[0];
    await f.inbound('另外一个故障：测试诊室断网。',{chatType:'single'});await f.pump();
    const journeys=(await f.pool.query('SELECT id,entry_mode FROM intake.contact_journey')).rows;
    assert.equal(journeys.length,2);
    assert.deepEqual((await f.pool.query('SELECT id,status,origin_intake_id FROM intake.contact_journey WHERE id=$1',[original.id])).rows[0],original);
    assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM intake.continuation_ref WHERE state='BOUND'")).rows[0].n,0);
    assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM intake.contact_journey WHERE entry_mode='DIRECT_ORGANIC'")).rows[0].n,1);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n,1);
    assert.equal((await f.pool.query(`SELECT d.safe_result->'journey_association'->>'method' AS method FROM intake.deterministic_decision d
      JOIN intake.service_intake i ON i.id=d.service_intake_id WHERE i.source_chat_type='single' ORDER BY d.decision_ordinal LIMIT 1`)).rows[0].method,'EXPLICIT_USER_NEW_TOPIC');
  });
});
test('P2-G2 D12-030 active Direct session survives the P1 90-second fragment window', () => exercise({
  gap: 120000, followUp: '补充：仍然打印不了', expectedJourneys: 1, expectedTickets: 1,
}));
test('P2-G2 D12-031 explicit additional fault creates its own Journey and Ticket', () => exercise({
  gap: 1000, followUp: '另外门诊系统也登录不了', expectedJourneys: 2, expectedTickets: 2,
}));
test('P2-G2 existing explicit new-report boundary remains available', () => exercise({
  gap: 1000, followUp: '另一个问题，处方提交不了', expectedJourneys: 2, expectedTickets: 2,
}));

for (const [name, options] of [
  ['another Reporter', { otherReporter: true }],
  ['another Bot', { otherBot: true }],
  ['ended Session within fragment window', { mutate: f => f.pool.query("UPDATE conversation.session SET status='ENDED',ended_at=last_activity_at,close_reason='EXPLICIT_END'") }],
  ['ended Journey within fragment window', { mutate: f => f.pool.query("UPDATE intake.contact_journey SET status='ENDED',ended_at=last_activity_at") }],
  ['closed Direct Leg within fragment window', { mutate: f => f.pool.query("UPDATE intake.channel_leg SET status='CLOSED',closed_at=opened_at") }],
  ['mismatched persisted Reporter binding', { mutate: f => f.pool.query("UPDATE intake.channel_leg SET reporter_identity_hash=repeat('f',64)") }],
  ['exact configured idle limit', { idleTimeoutMs: 1000, gapFromLastActivity: true, expectedEndedReason: 'IDLE_TIMEOUT' }],
  ['expired Intake retention', { gap: 86401000, idleTimeoutMs: 2 * 86400000 }],
  ['expired Journey retention', { gap: 10000, mutate: async f => {
    const row = (await f.pool.query('SELECT reported_at FROM intake.contact_journey')).rows[0];
    const expiry = String(BigInt(shanghaiLocalToEpochMs(row.reported_at)) + 1000n);
    await f.pool.query('UPDATE intake.contact_journey SET retention_until_epoch_ms=$1::bigint,retention_until=platform.local_from_epoch_ms($1::bigint)', [expiry]);
  } }],
]) test((name==='expired Journey retention'?'D12-008 ':'')+'P2-G2 Direct Session never resumes ' + name, () => exercise({
  gap: 1000, followUp: '打印不了', expectedJourneys: 2, expectedTickets: 2, ...options,
}));

for (const text of ['另外补充：打印机也打印不了', '另外门诊系统也没有问题', '另外说明：打印机也打印不了',
  '另外并不是门诊系统也登录不了。', '另外，如果门诊系统也登录不了怎么办？', '另外 补充打印机也打印不了'])
  test('P2-G2 additive supplement or negation does not create another report: ' + text, () => exercise({
    gap: 120000, followUp: text, expectedJourneys: 1, expectedTickets: 1,
  }));

for (const [ended, preciseClock] of [[false, false], [true, false], [false, true]]) test('P2-G2 supplement follows an already committed new issue while Session projection is delayed; previous ended=' + ended + '; millisecond idle boundary=' + preciseClock, async () => {
  await withG2Runtime(async f => {
    await f.inbound('打印不了', { chatType: 'single' }); await f.pump();
    if (ended) await f.pool.query("UPDATE conversation.session SET status='ENDED',ended_at=last_activity_at,close_reason='EXPLICIT_END'");
    let clock = Math.floor(Date.now() / 1000) * 1000 + 10800;
    const inbox = createChannelMessageInbox({ pool: f.pool }), processor = createP2016DirectIntakeProcessor({ idleTimeoutMs: preciseClock ? 1000 : undefined });
    const delayed = createP2G1HumanOnlyAssembly({ operationalIntake: { accept: input => inbox.accept(input, processor) }, projectAfterCommit: false,
      ...(preciseClock ? { now: () => new Date(clock) } : {}) });
    for (const text of ['另外门诊系统也登录不了', '补充：门诊登录界面仍然登录不了']) {
      const result = await delayed.handleFrame({ cmd: 'aibot_msg_callback', headers: { req_id: randomUUID() }, body: {
        msgid: randomUUID(), aibotid: f.botId, chattype: 'single', from: { userid: f.reporters[0] },
        msgtype: 'text', text: { content: text },
      } }); assert.equal(result.p1_committed, true); clock += 999;
    }
    const counts = (await f.pool.query('SELECT message_count FROM intake.service_intake ORDER BY primary_message_id')).rows.map(r => r.message_count);
    assert.deepEqual(counts, [1, 2]);
    await f.runtime.coordinator.runOnce(); await f.pump();
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n, 2);
  });
});
