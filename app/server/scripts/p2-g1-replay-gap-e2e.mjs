import { createHash, randomInt, randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { pathToFileURL } from 'node:url';

import { createPilotAccessService } from '../src/p1-009-pilot-access-workbench.mjs';
import { cleanupRealtimeRetention, createRealtimeEventStore, REALTIME_STREAM_NAME } from '../src/p2-003-realtime-event-log.mjs';
import { launchP2G1TestBrowserSessions } from '../src/p2-g1-browser-sessions.mjs';
import { createP2G1HumanOnlyAssembly, createP2G1PilotOperationalIntake, validateP2G1ProcessApprovals } from '../src/p2-g1-human-only-assembly.mjs';
import { createP2G1InboundProjectionCoordinator } from '../src/p2-g1-inbound-projection-coordinator.mjs';
import { withP2G1IsolatedPostgres } from '../src/p2-g1-isolated-postgres.mjs';
import { applyP2G1Migrations } from '../src/p2-g1-migrations.mjs';
import { createP2G1ProcessCluster } from '../src/p2-g1-process-cluster.mjs';
import { formatEpochMsToShanghaiLocal } from '../src/platform/time-contract.mjs';

const COMMIT = /^[a-f0-9]{40}$/u;

function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

function runId(now = new Date()) {
  const stamp = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, '0')).join('');
  return `P2G1-${stamp}-${randomInt(100_000, 1_000_000)}`;
}

async function reservePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function syntheticFrame(id, occurredToken) {
  return {
    cmd: 'aibot_msg_callback',
    headers: { req_id: `synthetic-replay-request-${occurredToken}` },
    body: {
      msgid: `synthetic-replay-message-${id}`,
      aibotid: 'synthetic-replay-bot',
      chattype: 'group',
      chatid: 'synthetic-replay-group',
      from: { userid: 'synthetic-replay-user' },
      msgtype: 'text',
      text: { content: '合成 Replay Gap 测试消息。' },
    },
  };
}

async function waitForTelemetry(browserSessions, predicate, { timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let telemetry = [];
  while (Date.now() < deadline) {
    telemetry = await browserSessions.safeTelemetry();
    if (predicate(telemetry)) return telemetry;
    await delay(100);
  }
  throw new Error('P2_G1_REPLAY_GAP_BROWSER_TIMEOUT');
}

async function createPrincipals(pool) {
  const access = createPilotAccessService({ pool });
  const values = [];
  for (const label of ['A', 'B']) {
    values.push(await access.upsertPrincipal({
      wecomUserId: `synthetic-replay-principal-${label}-${randomUUID()}`,
      displayName: `Synthetic Replay ${label}`,
      roles: ['ADMIN'],
      resolverTeamIds: [],
    }));
  }
  return values;
}

export async function runP2G1ReplayGap({
  databaseUrl,
  identityHashKey,
  liveCandidate,
  headless = true,
} = {}) {
  if (typeof databaseUrl !== 'string' || databaseUrl.length < 1
    || typeof identityHashKey !== 'string' || identityHashKey.length < 16
    || typeof liveCandidate !== 'string' || !COMMIT.test(liveCandidate)
    || typeof headless !== 'boolean') {
    throw new TypeError('P2_G1_REPLAY_GAP_CONFIGURATION_INVALID');
  }
  const id = runId();
  const startedAt = Date.now();
  return withP2G1IsolatedPostgres({
    databaseUrl,
    purpose: 'replaygap',
    run: async ({ pool, databaseUrl: isolatedDatabaseUrl, databaseName }) => {
      const migrations = await applyP2G1Migrations({ pool, databaseUrl: isolatedDatabaseUrl });
      const principals = await createPrincipals(pool);
      const occurredAt = new Date(Date.now() - 30_000);
      const coordinator = createP2G1InboundProjectionCoordinator({ pool, enabled: true, batchSize: 20 });
      const assembly = createP2G1HumanOnlyAssembly({
        operationalIntake: createP2G1PilotOperationalIntake({ pool, identityHashKey }),
        coordinator,
        privacyClass: 'INTERNAL',
        retentionMs: 1_000,
        now: () => occurredAt,
      });
      const accepted = await assembly.handleFrame(syntheticFrame(randomUUID(), id));
      if (accepted.ok !== true || accepted.p1_committed !== true) throw new Error('P2_G1_REPLAY_GAP_SEED_FAILED');
      const context = await pool.query(`SELECT session.id::text AS session_id, session.thread_id::text
        FROM conversation.session AS session ORDER BY session.created_at LIMIT 1`);
      if (context.rowCount !== 1) throw new Error('P2_G1_REPLAY_GAP_SEED_FAILED');
      const port = await reservePort();
      const cluster = createP2G1ProcessCluster({
        databaseUrl: isolatedDatabaseUrl,
        identityHashKey,
        principalIds: principals.map((value) => value.id),
        listenPort: port,
        gatewayEnabled: false,
        senderEnabled: false,
        allowedTargetHashes: [],
      });
      let browsers = null;
      let clusterCleanup = false;
      let browserCleanup = false;
      let outcome = null;
      let failure = null;
      try {
        const runtime = await cluster.start();
        browsers = await launchP2G1TestBrowserSessions({ origin: runtime.origin, cookies: runtime.cookies, headless });
        await browsers.selectFirstConversations();
        const before = await waitForTelemetry(browsers, (sessions) => sessions.length === 2 && sessions.every((session) => (
          session.connection_label === '实时连接' && session.sse.length > 0 && session.timeline_item_count > 0
        )));
        const store = createRealtimeEventStore({ pool, enabled: true, defaultRetentionMs: 1_000 });
        const windowBefore = await store.getReplayWindow({ streamName: REALTIME_STREAM_NAME });
        const disconnected = await cluster.disconnectRealtimePrincipal(0);
        if (disconnected.disconnected_count !== 1) throw new Error('P2_G1_REPLAY_GAP_DISCONNECT_FAILED');
        const gapOccurredEpochMs = String(Date.now() - 20_000);
        const gapOccurredAt = formatEpochMsToShanghaiLocal(gapOccurredEpochMs);
        const appended = await store.append({
          schema_version: 1,
          publisher_name: 'P2_G1_REPLAY_GAP',
          publisher_version: '1',
          source_type: 'CONVERSATION_SESSION',
          source_id: `p2-g1-replay-gap-${id}`,
          event_variant: 'PRIMARY',
          event_type: 'conversation.session.updated',
          aggregate_type: 'CONVERSATION_SESSION',
          aggregate_id: context.rows[0].session_id,
          aggregate_version: '999',
          authorization_scope_type: 'SESSION',
          authorization_scope_id: context.rows[0].session_id,
          visibility_scope: 'WORKBENCH',
          payload: { state: 'OPEN', replay_gap_test: true },
          occurred_at: gapOccurredAt,
          expires_at: formatEpochMsToShanghaiLocal(String(Date.now() - 10_000)),
        });
        const cleanup = await cleanupRealtimeRetention({
          pool,
          streamName: REALTIME_STREAM_NAME,
          limit: 200,
          now_epoch_ms: String(Date.now()),
          authorized: true,
        });
        if (cleanup.deleted_count < 1 || BigInt(cleanup.new_floor_event_id) <= BigInt(windowBefore.high_watermark_event_id)
          || cleanup.new_floor_event_id !== appended.event_id) {
          throw new Error('P2_G1_REPLAY_GAP_FLOOR_NOT_ADVANCED');
        }
        const cookie = runtime.cookies[0];
        const fallbackResponse = await fetch(`${runtime.origin}/api/realtime/events?scope=workbench`, {
          headers: { cookie: `${cookie.name}=${cookie.value}`, 'last-event-id': windowBefore.high_watermark_event_id },
          signal: AbortSignal.timeout(5_000),
        });
        const fallback = await fallbackResponse.json();
        if (fallbackResponse.status !== 410 || fallback?.fallback?.reason !== 'REPLAY_GAP'
          || fallback?.fallback?.strategy !== 'REFETCH_CONVERSATION_LIST_AND_TIMELINE') {
          throw new Error('P2_G1_REPLAY_GAP_HTTP_FALLBACK_FAILED');
        }
        const after = await waitForTelemetry(browsers, (sessions) => {
          const agent = sessions[0];
          const previous = before[0];
          const categories = new Set(agent.fetch.slice(previous.fetch.length).map((entry) => entry.category));
          return agent.eventsource_last_event_id_request_count >= 1
            && agent.eventsource_http_410_count >= 1
            && agent.connection_label === '轮询模式'
            && ['LIST','DETAIL','TIMELINE'].every((category) => categories.has(category));
        });
        const timeline = await pool.query(`SELECT count(*)::int AS count,
          (count(*) - count(DISTINCT id))::int AS duplicate_count
          FROM conversation.item WHERE session_id=$1::uuid`, [context.rows[0].session_id]);
        if (after[0].timeline_item_count !== timeline.rows[0].count || timeline.rows[0].duplicate_count !== 0) {
          throw new Error('P2_G1_REPLAY_GAP_TIMELINE_INCOMPLETE');
        }
        outcome = Object.freeze({
          schema_version: 1,
          gate: 'P2-G1',
          run_id: id,
          event: 'sse_replay_gap_result',
          event_time: formatEpochMsToShanghaiLocal(String(Date.now())),
          event_epoch_ms: String(Date.now()),
          scenario: 'isolated-postgresql-replay-gap',
          live_candidate: liveCandidate,
          outcome: 'PASS',
          database_scope: 'ISOLATED_POSTGRESQL_TEST_DATABASE',
          database_name_sha256: createHash('sha256').update(databaseName).digest('hex'),
          migrations_applied: migrations.migration_count,
          pilot_database_mutated: false,
          cursor_before_floor: true,
          http_status: fallbackResponse.status,
          fallback_reason: fallback.fallback.reason,
          fallback_strategy: fallback.fallback.strategy,
          eventsource_last_event_id_used: true,
          eventsource_http_410_count: after[0].eventsource_http_410_count,
          list_refetched: true,
          detail_refetched: true,
          timeline_refetched: true,
          timeline_item_count: timeline.rows[0].count,
          duplicate_timeline_item_count: 0,
          full_browser_refresh_required: false,
          process_count: runtime.process_count,
          combined_runtime: false,
          browser_session_count: browsers.count,
          duration_ms: Date.now() - startedAt,
          raw_identifiers_recorded: false,
        });
      } catch (error) {
        failure = error;
      } finally {
        if (browsers) {
          try { await browsers.close(); browserCleanup = true; }
          catch (error) { failure ??= error; }
        }
        try { const stopped = await cluster.stop(); clusterCleanup = stopped.process_count === 0; }
        catch (error) { failure ??= error; }
      }
      if (failure) throw failure;
      if (!browserCleanup || !clusterCleanup || outcome === null) throw new Error('P2_G1_REPLAY_GAP_CLEANUP_FAILED');
      return Object.freeze({ ...outcome, browser_cleanup: true, process_cleanup: true });
    },
  });
}

async function main(argv = process.argv.slice(2), env = process.env) {
  validateP2G1ProcessApprovals(env, { checkOnly: true });
  if (argv.length === 1 && argv[0] === '--check') {
    console.log(JSON.stringify({ ok: true, mode: 'check', isolated_postgresql_required: true, pilot_database_writes: false, edge_required: true, external_side_effects: false }));
    return;
  }
  if (argv.length !== 1 || argv[0] !== '--run' || env.P2_G1_ISOLATED_REPLAY_GAP_APPROVED !== 'true') {
    throw new Error('P2_G1_REPLAY_GAP_APPROVAL_REQUIRED');
  }
  const result = await runP2G1ReplayGap({
    databaseUrl: env.PILOT_DATABASE_URL,
    identityHashKey: env.PILOT_LOG_IDENTITY_HASH_KEY,
    liveCandidate: env.P2_G1_LIVE_CANDIDATE,
    headless: env.P2_G1_BROWSER_HEADLESS === 'true',
  });
  await appendFile('evidence/p2-g1-live-e2e.jsonl', JSON.stringify(result) + '\n');
  console.log(JSON.stringify({ ok: true, ...result }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error_code: error?.message?.startsWith('P2_G1_') ? error.message : 'P2_G1_REPLAY_GAP_FAILED' }));
    process.exitCode = 1;
  });
}
