import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { createPilotAccessService } from '../src/p1-009-pilot-access-workbench.mjs';
import { createP2016Runtime } from '../src/p2-016-runtime.mjs';
import { createP2016OrchestrationWorker } from '../src/p2-016-orchestration-adapters.mjs';
import { applyThrough031, withP2012Database, assertNoP2012Residual } from './helpers/p2-012-postgres-harness.mjs';
import { migrateP2012 } from '../scripts/p2-012-migrate.mjs';

// Gate acceptance tests; the pre-repair RED remains immutable in evidence/.
// Business inputs enter only through the normal Frame -> Inbox -> Intake pipeline.
// The isolated database is mandatory; no seed of Message, Intake, Decision or Ticket.
test('P2-G2 ten-route prerequisite: committed decisions have an executable next step', { timeout: 120000 }, async t => {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  assert.equal(typeof databaseUrl, 'string', 'P2_G2_LOCAL_DATABASE_REQUIRED');
  const target = new URL(databaseUrl);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'P2_G2_LOCAL_DATABASE_ONLY');
  try {
    await withP2012Database({ databaseUrl, purpose: 'g2route', run: async ({ pool, databaseUrl: isolated }) => {
      await applyThrough031({ pool, databaseUrl: isolated });
      await migrateP2012({ databaseUrl: isolated });
      const principal = await createPilotAccessService({ pool }).upsertPrincipal({
        wecomUserId: 'synthetic-g2-route-admin', displayName: '合成路由核验', roles: ['ADMIN'], resolverTeamIds: ['PILOT_IT'],
      });
      const reservation = createServer();
      await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
      const listenPort = reservation.address().port;
      await new Promise(resolve => reservation.close(resolve));
      const runtime = createP2016Runtime({ pool, flags: { TICKET_LIFECYCLE_WORKBENCH_ENABLED: true },
        principalId: principal.id, publicOrigin: 'http://127.0.0.1:' + listenPort, listenPort });
      const worker = createP2016OrchestrationWorker({ pool, identityHmacKey: 'synthetic-g2-route-identity-key',
        notifications: runtime.notifications, realtime: runtime.realtimeProjector });
      const flags = { RULE_FIRST_ORCHESTRATION_ENABLED: true, MANUAL_REVIEW_QUEUE_ENABLED: true };
      try {
        const started = await runtime.start();
        const origin = 'http://127.0.0.1:' + started.address.port;
        const cookie = started.cookie.name + '=' + started.cookie.value;
        const cases = [
          ['fault-control', '处方提交不了', 'TICKET_ELIGIBLE'],
          ['review-control', '急诊抢救患者处方提交不了', 'MANUAL_REVIEW_REQUIRED'],
          ['status-query', '工单到哪一步了', 'STATUS_QUERY'],
          ['business-consultation', '医保这个规则怎么理解', 'BUSINESS_CONSULTATION'],
        ];
        for (const [caseId, text, expected] of cases) await t.test(caseId, async sub => {
          const msgid = 'synthetic-g2-route-' + caseId;
          const accepted = await runtime.assembly.handleFrame({ cmd: 'aibot_msg_callback', headers: { req_id: msgid }, body: {
            msgid, aibotid: 'synthetic-g2-route-bot', chattype: 'single',
            from: { userid: 'synthetic-g2-' + caseId }, msgtype: 'text', text: { content: text },
          } });
          assert.equal(accepted.ok, true);
          assert.equal(accepted.p1_committed, true);
          const before = (await pool.query(`SELECT
            (SELECT count(*)::integer FROM channel.message_inbox WHERE msg_id=$1 AND processing_status='COMPLETED') AS messages,
            (SELECT count(*)::integer FROM intake.service_intake i JOIN channel.message_inbox m ON m.id=i.primary_message_id WHERE m.msg_id=$1) AS intakes,
            (SELECT count(*)::integer FROM intake.deterministic_decision d JOIN intake.service_intake i ON i.id=d.service_intake_id JOIN channel.message_inbox m ON m.id=i.primary_message_id WHERE m.msg_id=$1) AS decisions`, [msgid])).rows[0];
          assert.deepEqual(before, { messages: 1, intakes: 1, decisions: 0 });
          const batch = await worker.processDueBatch({ feature_flags: flags });
          assert.equal(batch.processed, 1);
          assert.equal(batch.results[0].result_code, expected);
          const decisionId = batch.results[0].decision_id;
          const read = async () => (await pool.query(`SELECT d.result_code,d.requires_manual_review,
            d.linked_ticket_id IS NOT NULL AS has_linked_ticket,j.profile_resolution_status,
            a.action_type,a.execution_policy,a.state,a.result_ref_type,a.error_code,a.retryable,
            (SELECT count(*)::integer FROM intake.manual_review_item r WHERE r.decision_id=d.id AND r.status='PENDING') AS pending_reviews
            FROM intake.deterministic_decision d JOIN intake.safe_action_suggestion a ON a.decision_id=d.id
            JOIN intake.contact_journey j ON j.id=d.journey_id
            WHERE d.id=$1::uuid ORDER BY a.action_ordinal`, [decisionId])).rows;
          const first = await read();
          const restartedWorker = createP2016OrchestrationWorker({ pool, identityHmacKey: 'synthetic-g2-route-identity-key',
            notifications: runtime.notifications, realtime: runtime.realtimeProjector });
          const retry = await restartedWorker.processDueBatch({ feature_flags: flags });
          assert.equal(retry.processed, 0);
          assert.deepEqual(await read(), first);
          const response = await fetch(origin + '/api/manual-reviews', { headers: { cookie } });
          assert.equal(response.status, 200);
          const reviews = await response.json();
          const visibleReview = reviews.items.some(item => item.decision_id === decisionId);
          const factCounts = (await pool.query(`SELECT
            (SELECT count(*)::integer FROM pilot_ticket.ticket t JOIN intake.service_intake i ON i.id=t.source_intake_id JOIN channel.message_inbox m ON m.id=i.primary_message_id WHERE m.msg_id=$1) AS tickets,
            (SELECT count(*)::integer FROM conversation.session s JOIN intake.service_intake i ON i.id=s.service_intake_id JOIN channel.message_inbox m ON m.id=i.primary_message_id WHERE m.msg_id=$1) AS sessions`, [msgid])).rows[0];
          sub.diagnostic(JSON.stringify({ case_id: caseId, persist_before_route: before, actions: first,
            http_manual_review_visible: visibleReview, restart_batch_processed: retry.processed, ...factCounts,
            test_type: 'LOCAL_REAL_POSTGRES_HTTP_NORMAL_INGRESS', gateway_enabled: false, sender_enabled: false }));
          if (['TICKET_ELIGIBLE', 'MANUAL_REVIEW_REQUIRED'].includes(expected)) assert.equal(factCounts.tickets, 1);
          else assert.equal(factCounts.tickets, 0);
          if (expected === 'MANUAL_REVIEW_REQUIRED') assert.equal(visibleReview, true);
          assert.equal(factCounts.sessions, 1, 'normal Conversation projection must be present');
          if (['STATUS_QUERY', 'BUSINESS_CONSULTATION'].includes(expected)) {
            assert.equal(first.every(a => a.has_linked_ticket === false), true);
            // docs51: unclear association/policy goes to human review; docs57 makes the Review durable.
            // A generic Conversation session alone is not that required Manual Review fact.
            assert.equal(visibleReview, true, 'P2_G2_UNRESOLVED_ASSOCIATION_OR_POLICY_REVIEW_REQUIRED');
            assert.equal(first.length, 1);
            assert.equal(first[0].state, 'EXECUTED');
            assert.equal(first[0].result_ref_type, 'MANUAL_REVIEW');
            const review = reviews.items.find(item => item.decision_id === decisionId);
            const getReview = async () => (await fetch(origin + '/api/manual-reviews/' + review.id, { headers: { cookie } })).json();
            const originalReview = await getReview();
            const bootstrap = await (await fetch(origin + '/api/lifecycle/bootstrap', { headers: { cookie } })).json();
            const body = { client_command_id: randomUUID(), expected_row_version: review.row_version,
              resolution_code: expected === 'STATUS_QUERY' ? 'REQUEST_DESCRIPTION' : 'CLASSIFY_BUSINESS_CONSULTATION',
              resolution_reason_code: 'OPERATOR_REVIEWED' };
            const post = async value => {
              const response = await fetch(origin + '/api/manual-reviews/' + review.id + '/resolve', {
                method: 'POST', headers: { cookie, origin, 'content-type': 'application/json',
                  'x-csrf-token': bootstrap.csrf_token, 'idempotency-key': value.client_command_id,
                  'if-match': '"' + value.expected_row_version + '"' }, body: JSON.stringify(value),
              });
              return { status: response.status, body: await response.json() };
            };
            const resolved = await Promise.all(Array.from({ length: 12 }, () => post(body)));
            assert.ok(resolved.every(r => r.status === 200 && r.body.ok === true));
            assert.equal(resolved.filter(r => r.body.replayed === false).length, 1);
            assert.equal((await post({ ...body, resolution_reason_code: 'DIFFERENT_REASON' })).status, 409);
            const handled = await getReview();
            assert.equal(handled.status, 'RESOLVED');
            assert.deepEqual(handled.safe_result, originalReview.safe_result);
            assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM intake.deterministic_decision
              WHERE journey_id=$1::uuid AND status='HUMAN_OVERRIDDEN'`, [review.journey_id])).rows[0].n, 1);
            sub.diagnostic(JSON.stringify({ case_id: caseId, human_resolution: body.resolution_code,
              concurrent_commands: 12, effective_commits: 1, original_decision_preserved: true }));
          }
          assert.ok(first.some(a => ['EXECUTED', 'REPLAYED'].includes(a.state)) || visibleReview,
            'P2_G2_EXECUTABLE_NEXT_STEP_REQUIRED: a PROPOSED suggestion without an executable handler or reachable Review is not a completed safe route');
        });
        for (const [caseId, text] of [['status', '工单到哪一步了'], ['policy', '医保这个规则怎么理解']]) {
          await t.test(caseId + '-review-database-failure-and-recovery', async sub => {
            const msgid = 'synthetic-g2-recovery-' + caseId;
            assert.equal((await runtime.assembly.handleFrame({ cmd: 'aibot_msg_callback', headers: { req_id: msgid }, body: {
              msgid, aibotid: 'synthetic-g2-route-bot', chattype: 'single', from: { userid: msgid },
              msgtype: 'text', text: { content: text },
            } })).ok, true);
            const faultPool = { query: pool.query.bind(pool), connect: async () => {
              const client = await pool.connect();
              return { release: client.release.bind(client), query: (sql, values) =>
                /INSERT INTO intake\.manual_review_item/u.test(sql)
                  ? client.query('SELECT 1/0') : client.query(sql, values) };
            } };
            const broken = createP2016OrchestrationWorker({ pool: faultPool,
              identityHmacKey: 'synthetic-g2-route-identity-key', notifications: runtime.notifications, realtime: runtime.realtimeProjector });
            await assert.rejects(broken.processDueBatch({ feature_flags: flags }), { code: '22012' });
            const facts = async () => (await pool.query(`SELECT
              (SELECT count(*)::integer FROM channel.message_inbox WHERE msg_id=$1 AND processing_status='COMPLETED') AS messages,
              (SELECT count(*)::integer FROM intake.deterministic_decision d JOIN intake.service_intake i ON i.id=d.service_intake_id JOIN channel.message_inbox m ON m.id=i.primary_message_id WHERE m.msg_id=$1) AS decisions,
              (SELECT count(*)::integer FROM intake.manual_review_item r JOIN intake.service_intake i ON i.id=r.service_intake_id JOIN channel.message_inbox m ON m.id=i.primary_message_id WHERE m.msg_id=$1) AS reviews`, [msgid])).rows[0];
            assert.deepEqual(await facts(), { messages: 1, decisions: 0, reviews: 0 });
            await Promise.all(Array.from({ length: 12 }, () => worker.processDueBatch({ feature_flags: flags })));
            assert.deepEqual(await facts(), { messages: 1, decisions: 1, reviews: 1 });
            assert.equal((await worker.processDueBatch({ feature_flags: flags })).processed, 0);
            sub.diagnostic(JSON.stringify({ case_id: caseId, real_postgres_fault: '22012',
              durable_inbound_preserved: true, partial_rule_facts: 0, concurrent_recovery_requests: 12, reviews_after_recovery: 1 }));
          });
        }
      } finally {
        await worker.stop();
        await runtime.stop();
        assert.equal(runtime.server.listening, false);
      }
    } });
  } finally {
    const residual = await assertNoP2012Residual({ databaseUrl });
    t.diagnostic(JSON.stringify({ cleanup: residual, cleanup_passed: true }));
  }
});
