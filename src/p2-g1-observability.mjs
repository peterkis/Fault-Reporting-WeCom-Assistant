import { monitorEventLoopDelay } from 'node:perf_hooks';

export const P2_G1_REQUIRED_MIGRATION_RELATIONS = Object.freeze([
  'channel.message_inbox',
  'intake.service_intake',
  'pilot_ticket.ticket',
  'pilot_ticket.ticket_event',
  'conversation.thread',
  'conversation.session',
  'conversation.item',
  'conversation.item_source_binding',
  'conversation.projection_checkpoint',
  'conversation.realtime_event',
  'communication.message',
  'communication.outbox',
  'communication.delivery',
  'conversation.assignment',
  'conversation.handoff',
  'conversation.read_cursor',
  'conversation.control_event',
]);

function safeNumber(value) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0; }

export async function captureP2G1CatalogSnapshot(pool) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('P2_G1_CATALOG_CONFIGURATION_INVALID');
  const result = await pool.query(`SELECT kind,identity FROM (
    SELECT 'schema' kind,n.nspname identity FROM pg_namespace n WHERE n.nspname IN ('channel','intake','pilot_ticket','notification','conversation','communication')
    UNION ALL SELECT 'table',n.nspname||'.'||c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('channel','intake','pilot_ticket','notification','conversation','communication') AND c.relkind='r'
    UNION ALL SELECT 'column',table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||is_nullable FROM information_schema.columns WHERE table_schema IN ('channel','intake','pilot_ticket','notification','conversation','communication')
    UNION ALL SELECT 'constraint',n.nspname||'.'||c.relname||'.'||co.conname||':'||pg_get_constraintdef(co.oid,true) FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('channel','intake','pilot_ticket','notification','conversation','communication')
    UNION ALL SELECT 'index',n.nspname||'.'||c.relname||':'||pg_get_indexdef(c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('channel','intake','pilot_ticket','notification','conversation','communication') AND c.relkind='i'
    UNION ALL SELECT 'function',n.nspname||'.'||p.proname||':'||pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('channel','intake','pilot_ticket','notification','conversation','communication')
    UNION ALL SELECT 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('channel','intake','pilot_ticket','notification','conversation','communication') AND NOT t.tgisinternal
    UNION ALL SELECT 'extension',extname||':'||extversion FROM pg_extension
  ) catalog ORDER BY kind,identity`);
  return Object.freeze(result.rows.map((row) => `${row.kind}:${row.identity}`));
}

export function createP2G1Observability({ pool, coordinator, gateway, realtime, enabled = false } = {}) {
  if (!pool || typeof pool.query !== 'function' || typeof enabled !== 'boolean') throw new TypeError('P2_G1_OBSERVABILITY_CONFIGURATION_INVALID');
  const delay = monitorEventLoopDelay({ resolution: 20 });
  if (enabled) delay.enable();
  let projectionFailures = 0;
  let p1CommittedFacts = 0;
  let previousCpu = process.cpuUsage();
  let previousCpuAt = process.hrtime.bigint();

  function recordProjection(result) {
    projectionFailures += safeNumber(result?.failures);
  }
  function recordP1Commit() { p1CommittedFacts += 1; }

  async function metrics() {
    const [backlog, communication] = await Promise.all([
      coordinator?.backlog?.() ?? { total: 0 },
      pool.query(`SELECT
        count(*) FILTER(WHERE status IN ('PENDING','LEASED','SENDING'))::integer pending,
        count(*) FILTER(WHERE status='RECONCILIATION_REQUIRED')::integer reconciliation_required,
        count(*) FILTER(WHERE status='DEAD_LETTER')::integer dead_letter
        FROM communication.delivery`),
    ]);
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    const cpuAt = process.hrtime.bigint();
    const elapsedMicroseconds = Number(cpuAt - previousCpuAt) / 1_000;
    const cpuPercent = elapsedMicroseconds > 0
      ? ((cpu.user - previousCpu.user) + (cpu.system - previousCpu.system)) / elapsedMicroseconds * 100
      : 0;
    previousCpu = cpu;
    previousCpuAt = cpuAt;
    const resources = typeof process.getActiveResourcesInfo === 'function' ? process.getActiveResourcesInfo() : [];
    const poolState = { in_use: safeNumber(pool.totalCount) - safeNumber(pool.idleCount), idle: safeNumber(pool.idleCount) };
    const realtimeState = realtime?.getMetrics?.() ?? {};
    const gatewayState = gateway?.getStatus?.() ?? {};
    return Object.freeze({
      p1_committed_facts: p1CommittedFacts,
      projection_backlog: safeNumber(backlog.total),
      projection_failures: projectionFailures,
      sse_clients: safeNumber(realtimeState.active_clients),
      communication_pending: safeNumber(communication.rows[0]?.pending),
      reconciliation_required: safeNumber(communication.rows[0]?.reconciliation_required),
      dead_letter: safeNumber(communication.rows[0]?.dead_letter),
      gateway_authenticated: gatewayState.authenticated === true ? 1 : 0,
      gateway_reconnect_total: safeNumber(gatewayState.reconnect_total),
      pool_in_use: poolState.in_use,
      pool_idle: poolState.idle,
      pool_total: safeNumber(pool.totalCount),
      pool_max: safeNumber(pool.options?.max),
      rss_bytes: memory.rss,
      heap_used_bytes: memory.heapUsed,
      cpu_percent: Number(Math.max(0, cpuPercent).toFixed(3)),
      event_loop_delay_p95_ms: enabled ? Number(delay.percentile(95) / 1e6) : 0,
      active_resources: resources.length,
      active_sockets: resources.filter((name) => /TCP|Socket|Pipe/iu.test(name)).length,
    });
  }

  async function readiness({ httpListening, workbenchEnabled, projectionEnabled, communicationEnabled, requireGateway = true, featureFlags = {} }) {
    let database = false;
    let migrations = false;
    try {
      await pool.query('SELECT 1');
      database = true;
      const result = await pool.query('SELECT relation_name,to_regclass(relation_name) IS NOT NULL present FROM unnest($1::text[]) AS relation_name', [P2_G1_REQUIRED_MIGRATION_RELATIONS]);
      migrations = result.rows.length === P2_G1_REQUIRED_MIGRATION_RELATIONS.length && result.rows.every((row) => row.present === true);
    } catch { /* safe readiness remains false */ }
    const forbiddenFlagsOff = ['AI_TRIAGE_ENABLED','AI_CONVERSATION_ENABLED','AI_AUTO_REPLY_ENABLED','OCR_ENABLED','INCIDENT_CORRELATION_ENABLED','INTEGRATION_CONNECTOR_ENABLED']
      .every((name) => featureFlags[name] !== true);
    const checks = Object.freeze({
      postgres: database,
      migrations_001_021: migrations,
      app_http: httpListening === true,
      workbench: workbenchEnabled === true,
      projection_worker: projectionEnabled === true,
      communication_worker: communicationEnabled === true,
      gateway_authenticated: !requireGateway || gateway?.getStatus?.().authenticated === true,
      human_only_flags: forbiddenFlagsOff,
    });
    return Object.freeze({ ok: Object.values(checks).every(Boolean), checks });
  }

  async function close() { delay.disable(); }
  return Object.freeze({ metrics, readiness, recordProjection, recordP1Commit, close });
}
