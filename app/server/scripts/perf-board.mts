import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {migrateCurrentBaselineWithYxx} from './migrate-current-baseline.mjs';
import {migrateTicketSelfHandling} from './ticket-self-handling-migrate.mjs';
import {migrateTicketStaffCompletion} from './ticket-staff-completion-migrate.mjs';
import {migrateTicketRoundNotifications} from './ticket-round-notifications-migrate.mjs';
import {migrateWorkbenchManualReports} from './workbench-manual-reports-migrate.mjs';
import {migrateWorkbenchVerifiedManualReports} from './workbench-verified-manual-reports-migrate.mjs';
import {migrateTicketUnassign} from './ticket-unassign-migrate.mjs';
import {migrateTicketReopenRounds} from './ticket-reopen-rounds-migrate.mjs';
import {migrateWorkbenchPersonalRead} from './workbench-personal-read-migrate.mjs';
import {migrateBotReporterFeedback} from './bot-reporter-feedback-migrate.mjs';
import {migrateWorkbenchFollow} from './workbench-follow-migrate.mjs';
import {migrateWorkbenchSupplementFollowUp} from './workbench-supplement-follow-up-migrate.mjs';
import {migrateWorkbenchFollowUpSchedules} from './workbench-follow-up-schedules-migrate.mjs';
import {migrateTicketReturnToDispatch} from './ticket-return-to-dispatch-migrate.mjs';
import {migrateWorkbenchFollowUpDueSignals} from './workbench-follow-up-due-migrate.mjs';
import {migrateWorkbenchSourceGroups} from './workbench-source-groups-migrate.mjs';
import {migrateIncidentInternalNotes} from './incident-internal-notes-migrate.mjs';
import {migrateIncidentPublicProgress} from './incident-public-progress-migrate.mjs';
import {migrateIncidentOwnerTransfer} from './incident-owner-transfer-migrate.mjs';
import {migrateIncidentDeliveryControl} from './incident-delivery-control-migrate.mjs';
import {migrateConversationDeliveryCommands} from './conversation-delivery-commands-migrate.mjs';
import {migrateServiceClosure} from './service-closure-migrate.mjs';
import {migrateCompletionDismissal} from './completion-dismissal-migrate.mjs';
import {migrateNotificationVocabulary} from './notification-vocabulary-migrate.mjs';
import {migrateSystemClosureRestore} from './system-closure-restore-migrate.mjs';
import {migrateTicketTerminalAt} from './ticket-terminal-at-migrate.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {createPilotWorkbenchAuthorizationAdapter} from '../src/p2-006-workbench-authorization.mjs';
import {createP2016TicketQuery} from '../src/p2-016-ticket-query.mjs';
import {loadServiceCatalog} from '../src/p2-007-service-catalog.mjs';
import {createWeb01WorkbenchQuery} from '../src/web01-workbench-query.mjs';
import {createWorkbenchSearch} from '../src/workbench-search.mjs';
import type {WorkbenchSearchCriteria} from '../../../contracts/workbench_search_contracts.js';

function fullSearchCriteria(patch: Partial<WorkbenchSearchCriteria>): WorkbenchSearchCriteria {
  return {
    q: '', column: 'handled', range: 'recent', scope: 'team', responsibility: 'any',
    resolver_team_id: null, assignee_id: null, sources: [], source_group_ref: null,
    statuses: [], supplement: 'any', schedule: 'any', ...patch,
  };
}

interface PlanNode {
  'Node Type'?: string;
  'Relation Name'?: string;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Rows Removed by Filter'?: number;
  Plans?: PlanNode[];
}

interface ExplainJsonRoot {
  Plan?: PlanNode;
  'Execution Time'?: number;
  JIT?: {Functions?: number};
}

interface LatencyStats {
  name: string;
  iterations: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  rowCount: number;
}

function assertLoopbackDatabaseUrl(raw: string): URL {
  const parsed = new URL(raw);
  const host = parsed.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`PERF_BOARD_REQUIRES_LOOPBACK_DATABASE:${host}`);
  }
  return parsed;
}

function computeStats(name: string, samples: readonly number[], rowCount: number): LatencyStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number): number => {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
    return Number((sorted[idx] ?? 0).toFixed(2));
  };
  return {
    name,
    iterations: sorted.length,
    minMs: Number((sorted[0] ?? 0).toFixed(2)),
    p50Ms: at(0.5),
    p95Ms: at(0.95),
    maxMs: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
    rowCount,
  };
}

/**
 * Card 42 §42A acceptance: no full Seq Scan of ticket combined with ~50k loops (the pre-42A pathology: per-row
 * LATERAL work over every ticket). Rows examined = (emitted + removed by filter) x loops.
 * - a ticket Seq Scan repeated across loops fails;
 * - any ticket node executed >= 1000 times fails (per-row probing of the ticket table);
 * - any node executed >= 50,000 times fails.
 * A single-pass ticket scan (one loop, e.g. a hash build for an anti-join) is allowed but listed in the summary.
 */
function assertPlanNodeSafe(label: string, node: PlanNode, singlePass: string[]): void {
  const nodeType = node['Node Type'] ?? '';
  const relation = node['Relation Name'] ?? '';
  const loops = node['Actual Loops'] ?? 0;
  const examined = ((node['Actual Rows'] ?? 0) + (node['Rows Removed by Filter'] ?? 0)) * Math.max(1, loops);
  if (nodeType === 'Seq Scan' && relation === 'ticket' && loops > 1) {
    throw new Error(`PERF_BOARD_SEQ_SCAN_TICKET_REPEATED:${label}:examined=${examined}:loops=${loops}`);
  }
  if (nodeType === 'Seq Scan' && relation === 'ticket' && examined > 5000) singlePass.push(`${label}:examined=${examined}`);
  if (relation === 'ticket' && loops >= 1000) {
    throw new Error(`PERF_BOARD_TICKET_HIGH_LOOPS:${label}:${nodeType}:loops=${loops}`);
  }
  if (loops >= 50000) throw new Error(`PERF_BOARD_HIGH_LOOPS:${label}:${nodeType}:${relation}:loops=${loops}`);
  for (const child of node.Plans ?? []) {
    assertPlanNodeSafe(label, child, singlePass);
  }
}
const singlePassTicketScans: string[] = [];

async function explainQuery(
  pool: PostgresPool,
  label: string,
  sql: string,
  values: readonly unknown[],
  diagDir: string | null = null,
  guard = true,
): Promise<{text: string; executionMs: number}> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const jsonRes = await client.query<{'QUERY PLAN': ExplainJsonRoot[]}>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
      [...values],
    );
    const root = jsonRes.rows[0]?.['QUERY PLAN']?.[0];
    if (!root?.Plan) throw new Error(`PERF_BOARD_EXPLAIN_EMPTY:${label}`);
    if (diagDir) {
      const diagText = await client.query<{'QUERY PLAN': string}>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`, [...values]);
      mkdirSync(diagDir, {recursive: true});
      writeFileSync(path.join(diagDir, `${label}.txt`), diagText.rows.map(r => r['QUERY PLAN']).join('\n') + '\n', 'utf8');
    }
    if ((root.JIT?.Functions ?? 0) > 0) {
      throw new Error(`PERF_BOARD_JIT_USED:${label}:functions=${root.JIT?.Functions}`);
    }
    if (guard) assertPlanNodeSafe(label, root.Plan, singlePassTicketScans);

    const textRes = await client.query<{'QUERY PLAN': string}>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`,
      [...values],
    );
    await client.query('COMMIT');
    const text = textRes.rows.map(r => r['QUERY PLAN']).join('\n');
    return {text, executionMs: Number((root['Execution Time'] ?? 0).toFixed(2))};
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function applyAllMigrations(databaseUrl: string): Promise<void> {
  await migrateCurrentBaselineWithYxx({databaseUrl});
  const migrators = [
    migrateTicketSelfHandling,
    migrateTicketStaffCompletion,
    migrateTicketRoundNotifications,
    migrateWorkbenchManualReports,
    migrateWorkbenchVerifiedManualReports,
    migrateTicketUnassign,
    migrateTicketReopenRounds,
    migrateWorkbenchPersonalRead,
    migrateBotReporterFeedback,
    migrateWorkbenchFollow,
    migrateWorkbenchSupplementFollowUp,
    migrateWorkbenchFollowUpSchedules,
    migrateTicketReturnToDispatch,
    migrateWorkbenchFollowUpDueSignals,
    migrateWorkbenchSourceGroups,
    migrateIncidentInternalNotes,
    migrateIncidentPublicProgress,
    migrateIncidentOwnerTransfer,
    migrateIncidentDeliveryControl,
    migrateConversationDeliveryCommands,
    migrateServiceClosure,
    migrateCompletionDismissal,
    migrateNotificationVocabulary,
    migrateSystemClosureRestore,
    migrateTicketTerminalAt,
  ];
  for (const migrate of migrators) {
    await migrate({databaseUrl, mode: 'apply'});
  }
}

interface SeedResult {sampleTicketId: string; sampleHandledTicketId: string}
/**
 * Set-based synthesis following the construction rules of the existing capacity fixture
 * (tests/helpers/p2-015-postgres-harness.mjs seedCapacityDataset) and of the Ticket core:
 * every WeCom intake has its primary channel message, intake.received event and PRIMARY relation;
 * every ticket is paired with its intake inside one transaction (the pair triggers are deferred to commit);
 * every DISMISSED ticket has its ticket.dismissed event and an active closure record linked to that event,
 * honouring the reason/notify matrix. All visible text carries 「（合成）」.
 */
async function seedSyntheticDataset(pool: PostgresPool, adminId: string, handlerId: string): Promise<SeedResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    const epoch = (await client.query<{epoch: string}>('SELECT platform.physical_epoch_ms()::text AS epoch')).rows[0]?.epoch;
    if (!epoch) throw new Error('PERF_BOARD_CLOCK_UNAVAILABLE');
    // 56,000 primary messages, one per intake, spread over one year.
    await client.query(
      `INSERT INTO channel.message_inbox(schema_version,provider,msg_id,idempotency_key,req_id,bot_id,
         chat_type,chat_id,sender_user_id,msg_type,received_at,raw_text,clean_text,normalized_message,
         processing_status,response_snapshot,privacy_class,trace_id,retention_until,completed_at)
       SELECT 1,'WECOM_AIBOT','perf-'||g,'WECOM_AIBOT:perf-'||g,'req-perf-'||g,'bot-perf',
         CASE WHEN g % 3 = 0 THEN 'group' ELSE 'single' END,CASE WHEN g % 3 = 0 THEN 'group-perf-'||(g % 40) END,
         'reporter-'||((g - 1) % 200 + 1),'text',
         platform.local_from_epoch_ms($1::bigint) - ((g % 360)||' days')::interval - ((g % 80000)||' seconds')::interval,
         '临床工作站网络波动（合成） #'||g,'临床工作站网络波动（合成） #'||g,
         jsonb_build_object('msgtype','text','bot_mentioned',g % 3 = 0),
         'COMPLETED','{}'::jsonb,'INTERNAL','trace-perf-'||g,
         platform.local_from_epoch_ms($1::bigint) + interval '400 days',
         platform.local_from_epoch_ms($1::bigint) - ((g % 360)||' days')::interval - ((g % 80000)||' seconds')::interval
       FROM generate_series(1,56000) g`,
      [epoch],
    );
    // 56,000 intakes: 50,400 will be paired with a ticket, 5,550 completed without a ticket, 50 awaiting triage.
    await client.query(
      `INSERT INTO intake.service_intake(id,intake_no,source_channel,source_provider,source_bot_id,source_chat_type,
         source_chat_id,reporter_wecom_userid,privacy_class,retention_until,request_type,summary,reported_location_text,status,
         primary_message_id,message_count,last_message_at,version,created_at,updated_at)
       SELECT ('00000000-0000-4000-8000-'||lpad(to_hex(g),12,'0'))::uuid,
         'INT-20261125-'||lpad(g::text,6,'0'),
         CASE WHEN g % 3 = 0 THEN 'WECOM_GROUP' ELSE 'WECOM_DIRECT' END,'WECOM_AIBOT','bot-perf',m.chat_type,m.chat_id,
         m.sender_user_id,'INTERNAL',m.retention_until,
         CASE WHEN g <= 50400 THEN 'INCIDENT' ELSE 'CHATTER' END,
         CASE WHEN g % 10 = 0 THEN '打印机故障排查（合成） #'||g ELSE '临床工作站网络波动（合成） #'||g END,
         '门诊大楼'||((g % 8) + 1)||'层（合成）',
         CASE WHEN g <= 50400 THEN 'WAITING_TRIAGE' WHEN g <= 55950 THEN 'COMPLETED' ELSE 'WAITING_TRIAGE' END,
         m.id,1,m.received_at,1,m.received_at,m.received_at
       FROM generate_series(1,56000) g JOIN channel.message_inbox m ON m.msg_id='perf-'||g`,
    );
    await client.query(
      `INSERT INTO intake.service_intake_message(intake_id,channel_message_id,relation_type,sequence_no,linked_at,trace_id)
       SELECT i.id,i.primary_message_id,'PRIMARY',1,i.created_at,'trace-perf-msg-'||i.intake_no FROM intake.service_intake i WHERE i.source_bot_id='bot-perf'`,
    );
    await client.query(
      `INSERT INTO intake.service_intake_event(event_type,aggregate_type,intake_id,aggregate_version,event_ordinal,occurred_at,trace_id,payload)
       SELECT 'intake.received','intake',i.id,1,1,i.created_at,'trace-perf-intake-'||i.intake_no,jsonb_build_object('status',i.status)
         FROM intake.service_intake i WHERE i.source_bot_id='bot-perf'`,
    );
    // 50,400 tickets matching the Card 42 §1 ratio: COMPLETED 46,667 / DISMISSED 3,356 / RESOLVED 317 / open 60.
    // Terminal times are whole seconds (075 CHECK); 200 of them fall inside today's handled range.
    await client.query(
      `WITH rows AS (
         SELECT g,('10000000-0000-4000-8000-'||lpad(to_hex(g),12,'0'))::uuid AS ticket_id,
                ('00000000-0000-4000-8000-'||lpad(to_hex(g),12,'0'))::uuid AS intake_id,
                CASE WHEN g <= 35 THEN 'QUEUED' WHEN g <= 60 THEN 'IN_PROGRESS' WHEN g <= 377 THEN 'RESOLVED'
                     WHEN g <= 3733 THEN 'DISMISSED' ELSE 'COMPLETED' END AS status,
                CASE WHEN g <= 60 THEN NULL::timestamp
                     WHEN g <= 260 THEN date_trunc('second',platform.local_from_epoch_ms($2::bigint)) - ((g % 18)||' hours')::interval - ((g % 60)||' minutes')::interval
                     ELSE date_trunc('second',platform.local_from_epoch_ms($2::bigint)) - ((2 + (g % 350))||' days')::interval - ((g % 80000)||' seconds')::interval END AS term_at
           FROM generate_series(1,50400) g)
       INSERT INTO pilot_ticket.ticket(id,ticket_no,source_intake_id,title,request_type,status,priority,resolver_team_id,
         assignee_id,reported_location_text,version,created_at,updated_at,terminal_at)
       SELECT r.ticket_id,'IT-20261125-'||lpad(r.g::text,6,'0'),r.intake_id,
         CASE WHEN r.g % 10 = 0 THEN '打印机脱机故障（合成） #'||r.g ELSE '系统终端异常处理（合成） #'||r.g END,
         'INCIDENT',r.status,CASE WHEN r.g % 5 = 0 THEN 'HIGH' ELSE 'NORMAL' END,'PILOT_IT',
         CASE WHEN r.status='QUEUED' THEN NULL::uuid ELSE $1::uuid END,
         '住院部'||((r.g % 12) + 1)||'病区（合成）',
         CASE WHEN r.status='QUEUED' THEN 2 ELSE 6 END,
         i.created_at,
         CASE WHEN r.term_at IS NULL THEN GREATEST(i.created_at,date_trunc('second',platform.local_from_epoch_ms($2::bigint)) - ((r.g % 12)||' minutes')::interval)
              ELSE GREATEST(i.created_at,r.term_at) END,
         CASE WHEN r.term_at IS NULL THEN NULL ELSE GREATEST(date_trunc('second',i.created_at),r.term_at) END
       FROM rows r JOIN intake.service_intake i ON i.id=r.intake_id`,
      [handlerId, epoch],
    );
    await client.query(
      `UPDATE intake.service_intake i SET pilot_ticket_id=t.id,status='TICKET_CREATED',version=2
         FROM pilot_ticket.ticket t WHERE t.source_intake_id=i.id AND t.ticket_no LIKE 'IT-20261125-%'`,
    );
    // Six events per ticket (two for QUEUED); the last one is the terminal transition at terminal_at.
    await client.query(
      `INSERT INTO pilot_ticket.ticket_event(event_id,ticket_id,event_type,old_status,new_status,aggregate_version,event_ordinal,
         operator_type,operator_id,internal_note,trace_id,created_at)
       SELECT uuidv7(),t.id,
         CASE ord WHEN 1 THEN 'ticket.created' WHEN 2 THEN 'ticket.queued' WHEN 3 THEN 'ticket.accepted' WHEN 4 THEN 'ticket.started'
           WHEN 5 THEN 'ticket.note_added'
           ELSE CASE t.status WHEN 'RESOLVED' THEN 'ticket.resolved' WHEN 'DISMISSED' THEN 'ticket.dismissed' WHEN 'COMPLETED' THEN 'ticket.completed' ELSE 'ticket.note_added' END END,
         CASE ord WHEN 1 THEN NULL WHEN 2 THEN 'NEW' WHEN 3 THEN 'QUEUED' WHEN 4 THEN 'ACCEPTED' WHEN 5 THEN 'IN_PROGRESS'
           ELSE 'IN_PROGRESS' END,
         CASE ord WHEN 1 THEN 'NEW' WHEN 2 THEN 'QUEUED' WHEN 3 THEN 'ACCEPTED' WHEN 4 THEN 'IN_PROGRESS' WHEN 5 THEN 'IN_PROGRESS'
           ELSE CASE WHEN t.status IN ('RESOLVED','COMPLETED','DISMISSED') THEN t.status ELSE 'IN_PROGRESS' END END,
         CASE WHEN ord = 1 THEN 1 ELSE ord END,ord,
         CASE WHEN ord <= 2 THEN 'SYSTEM' ELSE 'PILOT_USER' END,CASE WHEN ord <= 2 THEN NULL ELSE $1 END,
         CASE WHEN ord = 5 THEN '合成排查记录（合成）' WHEN ord = 6 AND t.status IN ('RESOLVED','COMPLETED') THEN '合成排查完成说明（合成）' END,
         'perf-seed:'||t.ticket_no||':'||ord,
         CASE WHEN ord = 6 AND t.terminal_at IS NOT NULL THEN t.terminal_at
              ELSE LEAST(t.created_at + (ord||' minutes')::interval,COALESCE(t.terminal_at,t.updated_at)) END
       FROM pilot_ticket.ticket t CROSS JOIN generate_series(1,6) ord
       WHERE t.ticket_no LIKE 'IT-20261125-%' AND (t.status <> 'QUEUED' OR ord <= 2) AND (t.status <> 'IN_PROGRESS' OR ord <= 5)`,
      [handlerId],
    );
    // Active closure records for every DISMISSED ticket, linked to its ticket.dismissed event (071 closure_subject).
    await client.query(
      `INSERT INTO pilot_ticket.closure_record(subject_type,ticket_id,reason_code,note,duplicate_of_ref,notify_reporter,
         before_status,before_team_id,before_version,before_snapshot,ended_by,source,ended_at,closure_ticket_event_id)
       SELECT 'TICKET',t.id,reason.code,NULL,NULL,reason.code<>'FALSE_REPORT_OR_TEST',
         'IN_PROGRESS','PILOT_IT',5,'{}'::jsonb,$1,'MANUAL',t.terminal_at,e.event_id
         FROM pilot_ticket.ticket t
         JOIN pilot_ticket.ticket_event e ON e.ticket_id=t.id AND e.event_type='ticket.dismissed'
         CROSS JOIN LATERAL (SELECT CASE WHEN right(t.ticket_no,1) IN ('0','3','6') THEN 'FALSE_REPORT_OR_TEST' ELSE 'REPORTER_WITHDREW' END AS code) reason
        WHERE t.status='DISMISSED' AND t.ticket_no LIKE 'IT-20261125-%'`,
      [adminId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  await pool.query('ANALYZE');
  return {
    sampleTicketId: '10000000-0000-4000-8000-' + (400).toString(16).padStart(12, '0'),
    sampleHandledTicketId: '10000000-0000-4000-8000-' + (100).toString(16).padStart(12, '0'),
  };
}

function parseCliArgs(argv: readonly string[]): {writeEvidenceDir: string | null; diagDir: string | null; allowOlderPg: boolean; warmup: number; iterations: number} {
  let writeEvidenceDir: string | null = null;
  let diagDir: string | null = null;
  let allowOlderPg = false;
  let warmup = 3;
  let iterations = 30;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--write-evidence') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error('PERF_BOARD_WRITE_EVIDENCE_DIR_REQUIRED');
      writeEvidenceDir = next;
      i++;
    } else if (arg?.startsWith('--write-evidence=')) {
      writeEvidenceDir = arg.slice('--write-evidence='.length);
    } else if (arg?.startsWith('--diag-dir=')) {
      diagDir = arg.slice('--diag-dir='.length);
    } else if (arg === '--allow-older-pg') {
      allowOlderPg = true;
    } else if (arg === '--iterations' && argv[i + 1]) {
      iterations = Number(argv[i + 1]);
      i++;
    } else if (arg === '--warmup' && argv[i + 1]) {
      warmup = Number(argv[i + 1]);
      i++;
    }
  }
  if (!Number.isSafeInteger(iterations) || iterations < 1 || !Number.isSafeInteger(warmup) || warmup < 0) throw new Error('PERF_BOARD_ITERATIONS_INVALID');
  // Evidence is only written for a full PG18 run (Codex 42A r1): no older-server override, at least 30 samples.
  if (writeEvidenceDir && (allowOlderPg || iterations < 30)) throw new Error('PERF_BOARD_EVIDENCE_REQUIRES_PG18_AND_30_ITERATIONS');
  return {writeEvidenceDir, diagDir, allowOlderPg, warmup, iterations};
}

export async function runPerfBoard(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) throw new Error('PERF_BOARD_PILOT_DATABASE_URL_REQUIRED');
  assertLoopbackDatabaseUrl(databaseUrl);
  const {writeEvidenceDir, diagDir, allowOlderPg, warmup, iterations} = parseCliArgs(argv);

  const dbName = `ticket_card42a_perf_board_${randomUUID().replaceAll('-', '_')}`;
  const quoted = `"${dbName}"`;
  const adminPool = createPostgresPool({connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, application_name: 'perf_board_admin'});
  let pool: PostgresPool | null = null;
  let runError: unknown = null;
  let cleanupError: unknown = null;

  try {
    const versionRow = (await adminPool.query<{version: string; ver_num: number}>(
      `SELECT version() AS version, current_setting('server_version_num')::integer AS ver_num`,
    )).rows[0];
    if (!versionRow) throw new Error('PERF_BOARD_VERSION_CHECK_FAILED');
    if (!allowOlderPg && versionRow.ver_num < 180000) {
      throw new Error(`PERF_BOARD_REQUIRES_PG18:found=${versionRow.version}`);
    }

    await adminPool.query(`CREATE DATABASE ${quoted} TEMPLATE template0`);
    const isolatedUrl = new URL(databaseUrl);
    isolatedUrl.pathname = `/${dbName}`;
    await applyAllMigrations(isolatedUrl.toString());
    // 42A-7 in miniature: the deployment sets jit=off on the application role (db-role-settings). This throwaway
    // database gets the same setting at database level, so no cluster-wide role is touched by a benchmark.
    await adminPool.query(`ALTER DATABASE ${quoted} SET jit = off`);

    pool = createPostgresPool({connectionString: isolatedUrl.toString(), max: 2, connectionTimeoutMillis: 10_000, application_name: 'perf_board_runner'});
    const access = createPilotAccessService({pool});
    const adminPrincipal = await access.upsertPrincipal({wecomUserId: 'perf-admin', displayName: '压测管理员（合成）', roles: ['ADMIN'], resolverTeamIds: ['PILOT_IT']});
    const handlerPrincipal = await access.upsertPrincipal({wecomUserId: 'perf-handler', displayName: '压测处理人（合成）', roles: ['HANDLER'], resolverTeamIds: ['PILOT_IT']});

    const tSeed0 = performance.now();
    const {sampleTicketId, sampleHandledTicketId} = await seedSyntheticDataset(pool, adminPrincipal.id, handlerPrincipal.id);
    const seedMs = Number((performance.now() - tSeed0).toFixed(1));

    const counts = (await pool.query<{intakes: string; tickets: string; events: string; closures: string; by_status: Record<string, number>}>(
      `SELECT (SELECT count(*) FROM intake.service_intake)::text AS intakes,(SELECT count(*) FROM pilot_ticket.ticket)::text AS tickets,
              (SELECT count(*) FROM pilot_ticket.ticket_event)::text AS events,(SELECT count(*) FROM pilot_ticket.closure_record)::text AS closures,
              (SELECT jsonb_object_agg(status,n) FROM (SELECT status,count(*)::integer AS n FROM pilot_ticket.ticket GROUP BY status) s) AS by_status`,
    )).rows[0];
    if (!counts) throw new Error('PERF_BOARD_COUNTS_FAILED');
    const jitRows = await Promise.all([pool.query<{jit: string}>('SHOW jit'), pool.query<{jit: string}>('SHOW jit')]);
    const effectiveJit = [...new Set(jitRows.map(r => r.rows[0]?.jit ?? 'unknown'))].join(',');
    if (effectiveJit !== 'off') throw new Error(`PERF_BOARD_JIT_NOT_OFF:${effectiveJit}`);

    const catalog = await loadServiceCatalog();
    const authorization = createPilotWorkbenchAuthorizationAdapter({pool});
    const ticketQuery = createP2016TicketQuery({pool, enabled: true, authorization, ticketStaffCompletionEnabled: true, ticketReopenRoundsEnabled: true});
    // Every statement any scenario sends is recorded so EXPLAIN runs on the exact production SQL and values.
    let recording: {sql: string; values: readonly unknown[]}[] | null = null;
    const record = (args: unknown[]) => {
      const [sql, values] = args;
      if (recording && typeof sql === 'string') recording.push({sql, values: Array.isArray(values) ? values : []});
    };
    const timedPool = pool;
    const recordingPool = new Proxy(timedPool, {
      get(target, prop, receiver) {
        if (prop === 'query') return (...args: unknown[]) => { record(args); return Reflect.apply(target.query, target, args); };
        if (prop === 'connect') {
          return async () => {
            const client = await target.connect();
            return new Proxy(client, {
              get(clientTarget, clientProp, clientReceiver) {
                if (clientProp === 'query') return (...args: unknown[]) => { record(args); return Reflect.apply(clientTarget.query, clientTarget, args); };
                const val = Reflect.get(clientTarget, clientProp, clientReceiver);
                return typeof val === 'function' ? val.bind(clientTarget) : val;
              },
            });
          };
        }
        const val = Reflect.get(target, prop, receiver);
        return typeof val === 'function' ? val.bind(target) : val;
      },
    });
    const web01 = createWeb01WorkbenchQuery({pool: recordingPool, query: ticketQuery, serviceCatalog: catalog});
    const search = createWorkbenchSearch({
      pool: recordingPool, query: ticketQuery, cards: web01, enabled: true, localTestProfile: true,
      features: {follow: false, supplements: false, schedules: false, manual: false, manualReview: false, sourceGroups: false},
    });
    const authFor = (principalId: string) => ({principal_id: principalId, auth_method: 'TEST', csrf_token: 'perf-board-csrf-token-' + principalId.slice(0, 8), expires_epoch_ms: String(Date.now() + 3_600_000)});
    const auth = authFor(adminPrincipal.id);
    // The production search limiter (20 calls / minute / principal) stays in force; search samples rotate over
    // equivalently authorized synthetic admins so every timed call is a real, admitted request.
    const searchAdmins: ReturnType<typeof authFor>[] = [];
    for (let n = 0; n < Math.ceil((warmup + iterations) * 2 / 15) + 1; n++) {
      const principal = await access.upsertPrincipal({wecomUserId: 'perf-search-admin-' + n, displayName: '压测检索管理员' + n + '（合成）', roles: ['ADMIN'], resolverTeamIds: ['PILOT_IT']});
      searchAdmins.push(authFor(principal.id));
    }
    let searchTurn = 0;
    const nextSearchAuth = () => {
      const value = searchAdmins[searchTurn++ % searchAdmins.length];
      if (!value) throw new Error('PERF_BOARD_SEARCH_PRINCIPALS_MISSING');
      return value;
    };

    const measure = async <T,>(name: string, fn: () => Promise<{count: number; value?: T}>): Promise<{stats: LatencyStats; last?: T; statements: {sql: string; values: readonly unknown[]}[]}> => {
      recording = [];
      await fn();
      const statements = recording;
      recording = null;
      for (let w = 1; w < warmup; w++) await fn();
      const samples: number[] = [];
      let count = 0;
      let last: T | undefined;
      for (let i = 0; i < iterations; i++) {
        const t0 = performance.now();
        const r = await fn();
        samples.push(performance.now() - t0);
        count = r.count;
        last = r.value;
      }
      return {stats: computeStats(name, samples, count), statements, ...(last !== undefined ? {last} : {})};
    };
    const mainStatement = (label: string, statements: readonly {sql: string; values: readonly unknown[]}[], pick: (sql: string) => boolean) => {
      const found = statements.find(statement => pick(statement.sql));
      if (!found) throw new Error('PERF_BOARD_STATEMENT_NOT_CAPTURED:' + label);
      return found;
    };

    const pendingRes = await measure('pending_p1', async () => {
      const p = await web01.list({authContext: auth, column: 'pending', range: 'recent', cursor: null, limit: '50'});
      return {count: p.items.length, value: p};
    });
    const activeRes = await measure('active_p1', async () => {
      const p = await web01.list({authContext: auth, column: 'active', range: 'recent', cursor: null, limit: '50'});
      return {count: p.items.length};
    });
    const handledP1 = await measure('handled_recent_p1', async () => {
      const p = await web01.list({authContext: auth, column: 'handled', range: 'recent', cursor: null, limit: '50'});
      return {count: p.items.length, value: p};
    });
    const handledAllP1 = await measure('handled_all_p1', async () => {
      const p = await web01.list({authContext: auth, column: 'handled', range: 'all', cursor: null, limit: '50'});
      return {count: p.items.length, value: p};
    });
    const handledCursor = handledAllP1.last?.next_cursor ?? null;
    if (!handledCursor) throw new Error('PERF_BOARD_EXPECTED_HANDLED_CURSOR');
    const handledP2 = await measure('handled_all_p2', async () => {
      const p = await web01.list({authContext: auth, column: 'handled', range: 'all', cursor: handledCursor, limit: '50'});
      return {count: p.items.length};
    });
    const itemRes = await measure('item_ticket', async () => {
      await web01.authorizedItem(auth, 'ticket', sampleHandledTicketId);
      return {count: 1};
    });
    const searchHandled = await measure('search_handled_recent', async () => {
      const p = await search.search({authContext: nextSearchAuth(), request: {criteria: fullSearchCriteria({column: 'handled', range: 'recent', q: ''}), cursor: null, limit: 50}});
      return {count: p.items.length};
    });
    const searchTextRecent = await measure('search_text_recent', async () => {
      const p = await search.search({authContext: nextSearchAuth(), request: {criteria: fullSearchCriteria({column: 'all', range: 'recent', q: '打印机'}), cursor: null, limit: 50}});
      return {count: p.items.length};
    });
    const searchText = await measure('search_text_all', async () => {
      const p = await search.search({authContext: nextSearchAuth(), request: {criteria: fullSearchCriteria({column: 'all', range: 'all', q: '打印机'}), cursor: null, limit: 50}});
      return {count: p.items.length};
    });
    void sampleTicketId;

    const allStats = [pendingRes.stats, activeRes.stats, handledP1.stats, handledAllP1.stats, handledP2.stats, itemRes.stats, searchHandled.stats, searchTextRecent.stats];
    // Informational, not part of the card's acceptance set: a substring search over the whole year must examine
    // every ticket's text; it is reported so the budget question stays visible (see 42a-README open questions).
    const informationalStats = [searchText.stats];
    // Collect every failure; plans are still captured so a failing run explains itself.
    const failures = allStats.filter(s => s.p95Ms >= 100).map(s => `PERF_BOARD_P95_EXCEEDED:${s.name}:p95=${s.p95Ms}ms`);

    // EXPLAIN (ANALYZE, BUFFERS) on the exact statements each scenario sent (captured above).
    const isPage = (sql: string) => sql.includes('WITH page_keys AS');
    const isSearchPage = (sql: string) => sql.includes('candidate_keys') && sql.includes('AS safety_signature FROM matched');
    const isItem = (sql: string) => sql.includes('FROM pilot_ticket.ticket t') && sql.includes('WHERE t.id=$6::uuid');
    const explains: [string, string, {sql: string; values: readonly unknown[]}][] = [
      ['pending', 'pending_p1', mainStatement('pending', pendingRes.statements, isPage)],
      ['active', 'active_p1', mainStatement('active', activeRes.statements, isPage)],
      ['handled', 'handled_recent_p1', mainStatement('handled', handledP1.statements, isPage)],
      ['handled-all', 'handled_all_p1', mainStatement('handled-all', handledAllP1.statements, isPage)],
      ['handled-page2', 'handled_all_p2', mainStatement('handled-page2', handledP2.statements, isPage)],
      ['item', 'item_ticket', mainStatement('item', itemRes.statements, isItem)],
      ['search', 'search_handled_recent', mainStatement('search', searchHandled.statements, isSearchPage)],
      ['search-text', 'search_text_recent', mainStatement('search-text', searchTextRecent.statements, isSearchPage)],
      ['search-text-all', 'search_text_all', mainStatement('search-text-all', searchText.statements, isSearchPage)],
    ];
    const explained: {file: string; scenario: string; text: string; executionMs: number}[] = [];
    const informationalFindings: string[] = [];
    for (const [file, scenario, statement] of explains) {
      try {
        const result = await explainQuery(pool, file, statement.sql, statement.values, diagDir);
        explained.push({file, scenario, ...result});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (informationalStats.some(stat => stat.name === scenario)) {
          // Keep the plan text for the record even though its guard is reported, not asserted.
          const result = await explainQuery(pool, file, statement.sql, statement.values, diagDir, false);
          explained.push({file, scenario, ...result});
          informationalFindings.push(message);
        } else failures.push(message);
      }
    }

    if (diagDir) {
      // Diagnostics: plan every read statement of each over-budget scenario, not only its main one.
      for (const [scenario, statements] of [['pending_p1', pendingRes.statements], ['active_p1', activeRes.statements], ['handled_recent_p1', handledP1.statements], ['handled_all_p2', handledP2.statements], ['item_ticket', itemRes.statements], ['search_text_all', searchText.statements]] as const) {
        let n = 0;
        for (const statement of statements) {
          n++;
          if (!/^\s*(SELECT|WITH)/iu.test(statement.sql)) continue;
          try { await explainQuery(pool, `${scenario}-stmt-${String(n).padStart(2, '0')}`, statement.sql, statement.values, diagDir); } catch { /* guard failures are reported by the main plans */ }
        }
      }
    }
    const byStatus = Object.entries(counts.by_status ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(', ');
    const summaryLines = [
      `PostgreSQL Version: ${versionRow.version}`,
      `Dataset (synthetic 「（合成）」, actual row counts): service_intake=${counts.intakes}, ticket=${counts.tickets} (${byStatus}), ticket_event=${counts.events}, closure_record=${counts.closures}, seed_ms=${seedMs}`,
      `Warmup=${warmup}, Iterations=${iterations}, jit=${effectiveJit} (database setting, verified on the timed connections), search principals rotated=${searchAdmins.length}`,
      '',
      'Scenario                     Rows   Min(ms)   P50(ms)   P95(ms)   Max(ms)',
      ...allStats.map(s => `${s.name.padEnd(28)} ${String(s.rowCount).padStart(4)}   ${String(s.minMs).padStart(7)}   ${String(s.p50Ms).padStart(7)}   ${String(s.p95Ms).padStart(7)}   ${String(s.maxMs).padStart(7)}`),
      'Informational (not asserted):',
      ...informationalStats.map(s => `${s.name.padEnd(28)} ${String(s.rowCount).padStart(4)}   ${String(s.minMs).padStart(7)}   ${String(s.p50Ms).padStart(7)}   ${String(s.p95Ms).padStart(7)}   ${String(s.maxMs).padStart(7)}`),
      '',
      'Informational plan findings (not asserted): ' + (informationalFindings.join(', ') || 'none'),
      'Single-pass ticket scans (1 loop; allowed): ' + (singlePassTicketScans.filter(x => !x.includes('-stmt-')).join(', ') || 'none'),
      'EXPLAIN Execution Times (ms): ' + explained.map(e => `${e.file}=${e.executionMs}`).join(', '),
      'Assertions: every asserted P95 < 100ms; no repeated ticket Seq Scan; no ticket node with >= 1000 loops; no node with >= 50000 loops; ZERO JIT functions.',
    ];
    const summary = summaryLines.join('\n');
    console.log(summary);

    if (failures.length) throw new Error(failures.join('\n'));
    if (writeEvidenceDir) {
      mkdirSync(writeEvidenceDir, {recursive: true});
      writeFileSync(path.join(writeEvidenceDir, '42a-perf-board.txt'), summary + '\n', 'utf8');
      for (const e of explained) {
        writeFileSync(path.join(writeEvidenceDir, `42a-explain-${e.file}.txt`), `-- scenario ${e.scenario}; EXPLAIN (ANALYZE, BUFFERS) of the exact statement it sent; ${versionRow.version}\n` + e.text + '\n', 'utf8');
      }
    }
  } catch (error) {
    runError = error;
  } finally {
    try {
      await pool?.end();
      await adminPool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [dbName]);
      await adminPool.query(`DROP DATABASE IF EXISTS ${quoted}`);
    } catch (error) {
      cleanupError = error;
    } finally {
      await adminPool.end().catch(err => {
        cleanupError ??= err;
      });
    }
  }

  if (runError && cleanupError) throw new AggregateError([runError, cleanupError]);
  if (runError) throw runError;
  if (cleanupError) throw cleanupError;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPerfBoard().catch(error => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
