import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {
  CARD_SQL,
  CLOSED_INTAKE_CARD_SQL,
  COMMUNICATION_CARD_SQL,
  FOLLOW_CARD_SQL,
  HANDLING_CARD_SQL,
  RELATED_CARD_SQL,
  WEB01_AUTHORIZED_CARDS_SQL,
  buildBoardKeysQuery,
  buildBoardKeysSql,
  buildCardsCteSql,
  buildCommunicationPredicateSql,
  buildEnrichSelectedCardsSql,
  buildFollowPredicateSql,
  buildHandledGroupCountsSql,
  buildLightweightCardsCteSql,
  buildSingleCardSql,
  buildSingleItemReadableSql,
  buildTargetedCardsSql,
  createParamBuilder,
  createWeb01WorkbenchQuery,
  workbenchSearchCardsSql,
} from '../app/server/src/web01-workbench-query.mjs';
import {createWorkbenchSearch} from '../app/server/src/workbench-search.mjs';
import {validGroupSql, sourceGroupOriginBindingSql} from '../app/server/src/workbench-source-groups.mjs';
import {supplementMaterialsSql} from '../app/server/src/workbench-supplement-follow-up.mjs';
import {
  ROLE_SETTINGS,
  buildRoleSettingSql,
  checkRoleSettings,
  parseRoleSettingsArgs,
  validateRoleName,
} from '../app/server/scripts/db-role-settings.mjs';
import {TICKET_TERMINAL_AT_MIGRATION_ID} from '../app/server/scripts/ticket-terminal-at-migrate.mjs';
import type {PostgresPool, PostgresQueryResult, PostgresQueryRow, PostgresTransaction} from '../app/server/src/platform/postgres-pool.mjs';
import {createP2016TicketQuery} from '../app/server/src/p2-016-ticket-query.mjs';
import type {BoardColumn} from '../contracts/web01_workbench_contracts.js';
import type {WorkbenchSearchCriteria} from '../contracts/workbench_search_contracts.js';

const ROOT = process.cwd();
const PRINCIPAL_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_ID = '22222222-2222-4222-8222-222222222222';
const SAMPLE_INTAKE_ID = '33333333-3333-4333-8333-333333333333';

function toRows<R>(value: unknown): R[] {
  return value as R[];
}

function assertNoVolatileTimeCalls(sql: string, label: string): void {
  assert.equal(/platform\.physical_epoch_ms\s*\(/iu.test(sql), false, `${label} must not contain platform.physical_epoch_ms()`);
  assert.equal(/platform\.local_now\s*\(/iu.test(sql), false, `${label} must not contain platform.local_now()`);
}

function assertContiguousParams(sql: string, values: readonly unknown[], label: string): void {
  const withoutLiterals = sql.replace(/'(?:''|[^'])*'/gu, "''");
  const matches = [...withoutLiterals.matchAll(/\$(\d+)/gu)].map(m => Number(m[1]));
  const distinct = new Set(matches);
  if (values.length === 0) {
    assert.equal(distinct.size, 0, `${label}: expected 0 params, found ${[...distinct].join(',')}`);
    return;
  }
  assert.ok(!distinct.has(0), `${label}: invalid $0 parameter placeholder`);
  for (let i = 1; i <= values.length; i++) {
    assert.ok(distinct.has(i), `${label}: missing parameter $${i} (values.length=${values.length})`);
  }
  for (const idx of distinct) {
    assert.ok(idx <= values.length, `${label}: parameter $${idx} out of bounds for values.length=${values.length}`);
  }
}

test('Card 42A-1: static SQL exports and query builders contain zero volatile time functions', () => {
  const staticSqls: [string, string][] = [
    ['CARD_SQL', CARD_SQL],
    ['WEB01_AUTHORIZED_CARDS_SQL', WEB01_AUTHORIZED_CARDS_SQL],
    ['HANDLING_CARD_SQL', HANDLING_CARD_SQL],
    ['COMMUNICATION_CARD_SQL', COMMUNICATION_CARD_SQL],
    ['RELATED_CARD_SQL', RELATED_CARD_SQL],
    ['FOLLOW_CARD_SQL', FOLLOW_CARD_SQL],
    ['CLOSED_INTAKE_CARD_SQL', CLOSED_INTAKE_CARD_SQL],
    ['workbenchSearchCardsSql(true)', workbenchSearchCardsSql(true)],
    ['workbenchSearchCardsSql(false)', workbenchSearchCardsSql(false)],
    ['buildCardsCteSql', buildCardsCteSql('$4::bigint', '$5::timestamp without time zone')],
    ['buildEnrichSelectedCardsSql', buildEnrichSelectedCardsSql('page_keys', '$4::bigint', '$5::timestamp without time zone')],
    ['buildTargetedCardsSql', buildTargetedCardsSql('$6::jsonb', '$4::bigint', '$5::timestamp without time zone')],
    ['buildLightweightCardsCteSql', buildLightweightCardsCteSql('$4::bigint', '$5::timestamp without time zone')],
    ['validGroupSql(param)', validGroupSql('$5::timestamp without time zone')],
    ['sourceGroupOriginBindingSql(param)', sourceGroupOriginBindingSql('$4::bigint')],
    ['supplementMaterialsSql(param)', supplementMaterialsSql('$1::uuid', '$2::uuid', '$4::bigint')],
  ];
  for (const [label, sql] of staticSqls) {
    assertNoVolatileTimeCalls(sql, label);
  }
  for (const kind of ['ticket', 'review', 'intake', 'any'] as const) {
    assertNoVolatileTimeCalls(buildCommunicationPredicateSql({kind, idExpr: 'x.id', intakeIdExpr: 'x.intake_id'}), `comm:${kind}`);
    assertNoVolatileTimeCalls(buildFollowPredicateSql({kind, idExpr: 'x.id', intakeIdExpr: 'x.intake_id'}), `follow:${kind}`);
  }
  for (const kind of ['ticket', 'review', 'intake'] as const) {
    assertNoVolatileTimeCalls(buildSingleCardSql(kind), `singleCard:${kind}`);
    assertNoVolatileTimeCalls(buildSingleItemReadableSql(kind, '$4::uuid'), `singleReadable:${kind}`);
  }
});

test('Card 42A-1/6: source files keep volatile clock calls restricted to clock capture and single-row auth proofs', () => {
  // Every remaining volatile call site must be one of these kinds; a count alone cannot show where a call sits.
  const allowed: [string, RegExp][] = [
    ['request clock capture', /AS now_epoch|AS now_local|AS epoch,|AS local_now|AS local_ts\)/u],
    ['cookie session expiry predicate', /<\$\$\{start\}::bigint|\$\$\{start\}::bigint>platform\.physical_epoch_ms\(\)|expires_epoch_ms>platform\.physical_epoch_ms\(\)/u],
    ['final READ proof clock (single-row CTE)', /final_clock AS MATERIALIZED/u],
    ['row write timestamp', /DO UPDATE SET .*updated_at=platform\.local_now\(\)/u],
  ];
  const checkedFiles = [
    'app/server/src/web01-workbench-query.mts',
    'app/server/src/workbench-card-projections.mts',
    'app/server/src/workbench-follow.mts',
    'app/server/src/workbench-reminders.mts',
    'app/server/src/workbench-search.mts',
  ];
  for (const file of checkedFiles) {
    const lines = readFileSync(path.join(ROOT, file), 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!/platform\.(?:physical_epoch_ms|local_now)\s*\(/u.test(line)) return;
      const context = line + (lines[index - 1]?.includes('final_clock AS MATERIALIZED') ? ' final_clock AS MATERIALIZED' : '');
      assert.ok(allowed.some(([, pattern]) => pattern.test(context)), `${file}:${index + 1} has a volatile clock call outside clock capture / session / final-proof / write sites: ${line.trim().slice(0, 160)}`);
    });
  }

  const web01Src = readFileSync(path.join(ROOT, 'app/server/src/web01-workbench-query.mts'), 'utf8');
  const cardSqlDecl = web01Src.match(/export function buildCardsCteSql[\s\S]*?^export const CARD_SQL/mu)?.[0] ?? '';
  assert.ok(cardSqlDecl.length > 0);
  assertNoVolatileTimeCalls(cardSqlDecl, 'web01-workbench-query buildCardsCteSql source');
});

test('Card 42A-4/5: buildBoardKeysQuery & handled counts have contiguous params and no to_char in keyset/ORDER BY', () => {
  const columns: BoardColumn[] = ['pending', 'active', 'handled'];
  for (const column of columns) {
    for (const relatedOnly of [false, true]) {
      for (const includeFollow of [false, true]) {
        const noCursor = buildBoardKeysQuery({
          column, relatedOnly, includeFollow, allRange: false,
          from: '2026-11-24 00:00:00', until: '2026-11-26 00:00:00', limit: 51, cursor: null,
        });
        assertNoVolatileTimeCalls(noCursor.sql, `keys:${column}:noCursor`);
        assert.equal(/WHERE[\s\S]*to_char\(/iu.test(noCursor.sql), false, `keys:${column}: WHERE must not use to_char()`);
        assert.equal(/ORDER BY[^\n;]*to_char\(/iu.test(noCursor.sql), false, `keys:${column}: ORDER BY must not use to_char()`);
        assertContiguousParams(
          `${noCursor.sql}\n${buildEnrichSelectedCardsSql('page_keys')}`,
          [true, PRINCIPAL_ID, ['PILOT_IT'], '1700000000000', '2026-11-25 10:00:00', ...noCursor.values],
          `pageSql:${column}:noCursor`,
        );

        const kinds = column === 'active' ? ['ticket'] : column === 'pending' ? ['ticket', 'review', 'intake'] : ['ticket', 'intake'];
        const groups = column === 'handled' ? [0, 1] : [0];
        for (const order_group of groups) {
          for (const kind of kinds) {
            const withCursor = buildBoardKeysQuery({
              column, relatedOnly, includeFollow, allRange: false,
              from: '2026-11-24 00:00:00', until: '2026-11-26 00:00:00', limit: 51,
              cursor: {order_group, at: '2026-11-25 09:00:00', kind, id: SAMPLE_ID},
            });
            assertNoVolatileTimeCalls(withCursor.sql, `keys:${column}:cursor:${order_group}:${kind}`);
            assertContiguousParams(
              `${withCursor.sql}\n${buildEnrichSelectedCardsSql('page_keys')}`,
              [true, PRINCIPAL_ID, ['PILOT_IT'], '1700000000000', '2026-11-25 10:00:00', ...withCursor.values],
              `pageSql:${column}:cursor:${order_group}:${kind}`,
            );
          }
        }
      }
    }
  }

  // Handled group_counts + buildSingleCardSql param checks
  const countsSql = buildHandledGroupCountsSql({relatedOnly: true, includeFollow: true});
  assertNoVolatileTimeCalls(countsSql, 'handledGroupCounts');
  assertContiguousParams(countsSql, [true, PRINCIPAL_ID, ['PILOT_IT'], '1700000000000', '2026-11-25 10:00:00', false, '2026-11-24 00:00:00', '2026-11-26 00:00:00'], 'handledGroupCounts');

  assertContiguousParams(buildSingleCardSql('ticket'), [true, PRINCIPAL_ID, ['PILOT_IT'], '1700000000000', '2026-11-25 10:00:00', SAMPLE_ID], 'singleCard:ticket');
  assertContiguousParams(buildSingleCardSql('review'), [true, PRINCIPAL_ID, ['PILOT_IT'], '1700000000000', '2026-11-25 10:00:00', SAMPLE_ID], 'singleCard:review');
  assertContiguousParams(buildSingleCardSql('intake', '$4::uuid', '$2::bigint', '$3::timestamp without time zone', '$1::boolean'), [true, '1700000000000', '2026-11-25 10:00:00', SAMPLE_ID], 'singleCard:intake');

  // Targeted cards SQL param check
  assertContiguousParams(buildTargetedCardsSql('$6::jsonb'), [true, PRINCIPAL_ID, ['PILOT_IT'], '1700000000000', '2026-11-25 10:00:00', '[]'], 'targetedCards');

  // Backward-compatible buildBoardKeysSql alias still works without throwing
  const compatSql = buildBoardKeysSql({column: 'pending', relatedOnly: false, includeFollow: false, hasCursor: false});
  assert.ok(compatSql.includes('ORDER BY'));

  const pb = createParamBuilder([true]);
  assert.equal(pb.once('a', 'x', 'text'), '$2::text');
  assert.equal(pb.once('a', 'y', 'text'), '$2::text');
  assert.equal(pb.add(42, 'integer'), '$3::integer');
  assert.deepEqual(pb.values, [true, 'x', 42]);
});

test('Card 42A: runtime mock execution verifies contiguous params and single projection query per list()', async () => {
  const executed: {sql: string; values: readonly unknown[]}[] = [];
  const sampleTicketRow = {
    kind: 'ticket',
    id: SAMPLE_ID,
    intake_id: SAMPLE_INTAKE_ID,
    number: 'T-001',
    title: '打印机卡纸（合成）',
    status: 'COMPLETED',
    priority: 'P2',
    location: '门诊二楼（合成）',
    reporter_name: '张三（合成）',
    reporter_department: '内科（合成）',
    source: 'WECOM_AIBOT',
    assignee_name: '李四（合成）',
    review_reason: null,
    created_at: '2026-11-25 08:00:00',
    updated_at: '2026-11-25 09:00:00',
    completed_at: '2026-11-25 09:00:00',
    sort_at: '2026-11-25 09:00:00',
    order_at: '2026-11-25 09:00:00',
    order_group: 1,
    closure_evidence: {
      source: 'MANUAL',
      reason_code: null,
      reason_note: '已处理（合成）',
      ended_by_display_name: '李四（合成）',
      ended_at: '2026-11-25 09:00:00',
      resolver_team_id: 'PILOT_IT',
      assignee_id: PRINCIPAL_ID,
    },
  };

  let emptyResult = false;
  function asMockPool(value: unknown): PostgresPool {
    return value as PostgresPool;
  }
  const makeQuery = async <R extends PostgresQueryRow = Record<string, unknown>>(sqlText: string, values: unknown[] = []): Promise<PostgresQueryResult<R>> => {
    executed.push({sql: sqlText, values});
    assertContiguousParams(sqlText, values, `mockQuery(${sqlText.slice(0, 60)})`);
    const result = (rows: Record<string, unknown>[]): PostgresQueryResult<R> => ({
      rows: toRows<R>(rows),
      rowCount: rows.length,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });
    const trimmed = sqlText.trim();
    if (trimmed.startsWith('SET ') || trimmed === 'BEGIN' || trimmed === 'COMMIT' || trimmed === 'ROLLBACK') {
      return result([]);
    }
    if (sqlText.includes('AS valid') && !sqlText.includes('proof') && !sqlText.includes('session_valid')) {
      return result([{valid: true}]);
    }
    if (sqlText.includes('now_epoch') && sqlText.includes('AS now_local') && !sqlText.includes('AS session_valid')) {
      return result([{from: '2026-11-24 00:00:00', until: '2026-11-26 00:00:00', now_epoch: '1700000000000', now_local: '2026-11-25 10:00:00'}]);
    }
    if (sqlText.includes('to_regclass')) {
      return result([{web: false, now_epoch: '1700000000000', now_local: '2026-11-25 10:00:00'}]);
    }
    if (sqlText.includes('FROM page_keys')) {
      return result(emptyResult ? [] : [sampleTicketRow]);
    }
    if (sqlText.includes('SELECT * FROM projected_sources')) {
      return result([{kind: 'ticket', id: SAMPLE_ID, status: 'COMPLETED', evidence: [], safety_signature: 'sig-1'}]);
    }
    if (sqlText.includes('AS session_valid')) {
      return result([{
        principal_valid: true,
        session_valid: true,
        anchor_valid: true,
        scope_valid: true,
        more: false,
        group_counts: {completed: 1, dismissed: 0},
        page_matches: true,
        items: emptyResult ? [] : [{
          kind: 'ticket',
          id: SAMPLE_ID,
          status: 'COMPLETED',
          stage_entered_at: '2026-11-25 09:00:00',
          safety_signature: 'sig-1',
          closure_evidence: sampleTicketRow.closure_evidence,
        }],
      }]);
    }
    if (sqlText.includes('FROM matched') && sqlText.includes('safety_signature')) {
      return result(emptyResult ? [] : [{
        kind: 'ticket',
        id: SAMPLE_ID,
        intake_id: SAMPLE_INTAKE_ID,
        order_at: '2026-11-25 09:00:00',
        order_group: 1,
        safety_signature: 'sig-1',
      }]);
    }
    if (sqlText.includes('FROM matched')) {
      return result([{ok: 1}]);
    }
    if (sqlText.includes("source_provider='YIXIAOXIU_WEB'") && sqlText.includes('LIMIT 1')) {
      return result([]);
    }
    if (sqlText.includes('FROM pilot_ticket.ticket t')) {
      return result([sampleTicketRow]);
    }
    if (sqlText.includes('FROM intake.service_intake')) {
      return result([]);
    }
    return result([]);
  };

  const mockTx: PostgresTransaction = {query: makeQuery};
  const mockPool = asMockPool({
    query: makeQuery,
    connect: async () => ({query: makeQuery, release: () => undefined}),
    end: async () => undefined,
  });

  const ticketQuery = createP2016TicketQuery({
    pool: mockTx,
    enabled: true,
    authorization: {
      resolvePrincipal: async () => ({
        principal_id: PRINCIPAL_ID,
        display_name: '管理员（合成）',
        roles: ['ADMIN'],
        team_ids: ['PILOT_IT'],
        is_active: true,
      }),
    },
  });

  const auth = {
    principal_id: PRINCIPAL_ID,
    auth_method: 'TEST',
    csrf_token: 'csrf-token-value-123456',
    expires_epoch_ms: '9999999999999',
  };

  const web01 = createWeb01WorkbenchQuery({pool: mockTx, query: ticketQuery});
  for (const column of ['pending', 'active', 'handled'] as const) {
    executed.length = 0;
    const res = await web01.list({authContext: auth, column, range: 'recent', cursor: null, limit: '20'});
    assert.equal(res.column, column);
    const boardMainQueries = executed.filter(q => q.sql.includes('WITH page_keys AS'));
    assert.equal(boardMainQueries.length, 1, `list(${column}) must execute page_keys query exactly once`);
  }

  const search = createWorkbenchSearch({
    pool: mockPool,
    query: ticketQuery,
    cards: web01,
    enabled: true,
    localTestProfile: true,
    features: {follow: false, supplements: false, schedules: false, manual: false, manualReview: false, sourceGroups: false},
  });
  const searchCriteria = (patch: Partial<WorkbenchSearchCriteria>): WorkbenchSearchCriteria => ({
    q: '', column: 'all', range: 'recent', scope: 'team', responsibility: 'any',
    resolver_team_id: null, assignee_id: null, sources: [], source_group_ref: null,
    statuses: [], supplement: 'any', schedule: 'any', ...patch,
  });
  for (const empty of [false, true]) {
    emptyResult = empty;
    for (const criteria of [
      searchCriteria({column: 'all', range: 'recent', q: ''}),
      searchCriteria({column: 'pending', range: 'recent', q: '打印', responsibility: 'handling'}),
      searchCriteria({column: 'active', range: 'all', q: ''}),
      searchCriteria({column: 'handled', range: 'recent', q: '', closure_kind: 'completed'}),
      searchCriteria({column: 'handled', range: 'all', q: '', statuses: ['COMPLETED']}),
    ]) {
      executed.length = 0;
      const page = await search.search({authContext: auth, request: {criteria, cursor: null, limit: 10}});
      assert.equal(page.items.length, empty ? 0 : 1);
      for (const q of executed) {
        if (!q.sql.includes('stamp') && !q.sql.includes('AS now_local') && !q.sql.includes('AS valid') && !q.sql.includes('session_valid')) {
          assertNoVolatileTimeCalls(q.sql, 'search query');
        }
      }
    }
  }
});

test('Card 42A-2 & 42A-7: 075 migration SQL & db-role-settings contract', async () => {
  assert.equal(TICKET_TERMINAL_AT_MIGRATION_ID, '075_ticket_terminal_at');
  const sql075 = readFileSync(path.join(ROOT, 'database/migrations/075_ticket_terminal_at.sql'), 'utf8');
  for (const token of [
    'terminal_at TIMESTAMP WITHOUT TIME ZONE',
    'terminal_epoch_ms BIGINT',
    'ticket_terminal_at_second_check',
    'ticket_terminal_status_check',
    'ticket_terminal_epoch_check',
    'sync_local_epoch_pair',
    'ticket_terminal_idx',
    'ticket_resolved_terminal_idx',
    'ticket_open_updated_idx',
  ]) {
    assert.ok(sql075.includes(token), `075 migration missing ${token}`);
  }

  assert.deepEqual(ROLE_SETTINGS.map(s => [s.name, s.value]), [['jit', 'off']]);
  assert.equal(validateRoleName('ticket_app'), 'ticket_app');
  assert.throws(() => validateRoleName('bad;role'), /DB_ROLE_NAME_INVALID/u);
  assert.throws(() => validateRoleName('1starts_with_digit'), /DB_ROLE_NAME_INVALID/u);
  assert.deepEqual(buildRoleSettingSql('ticket_app', 'apply'), ['ALTER ROLE "ticket_app" SET jit = off']);
  assert.deepEqual(buildRoleSettingSql('ticket_app', 'reset'), ['ALTER ROLE "ticket_app" RESET jit']);
  assert.deepEqual(parseRoleSettingsArgs(['--role', 'ticket_app', '--apply']), {role: 'ticket_app', mode: 'apply'});
  assert.deepEqual(parseRoleSettingsArgs(['--role=ticket_app', '--reset']), {role: 'ticket_app', mode: 'reset'});
  assert.throws(() => parseRoleSettingsArgs(['--check']), /DB_ROLE_SETTINGS_ROLE_REQUIRED/u);
  assert.throws(() => parseRoleSettingsArgs(['--role', 'app', '--bogus']), /DB_ROLE_SETTINGS_ARGUMENT_INVALID/u);

  const mockRoleTx = (rows: {exists: boolean; setconfig: string[] | null}[]): Pick<PostgresTransaction, 'query'> => ({
    query: (async <R extends PostgresQueryRow>() => ({
      rows: toRows<R>(rows),
      rowCount: rows.length,
      command: 'SELECT',
      oid: 0,
      fields: [],
    })) as PostgresTransaction['query'],
  });
  const mockCheckReady = await checkRoleSettings(mockRoleTx([{exists: true, setconfig: ['jit=off']}]), 'ticket_app');
  assert.deepEqual(mockCheckReady, {ok: true, role: 'ticket_app', missing: [], current: {jit: 'off'}});

  const mockCheckPending = await checkRoleSettings(mockRoleTx([{exists: true, setconfig: null}]), 'ticket_app');
  assert.deepEqual(mockCheckPending, {ok: false, role: 'ticket_app', missing: ['jit'], current: {jit: null}});

  await assert.rejects(
    checkRoleSettings(mockRoleTx([{exists: false, setconfig: null}]), 'absent_role'),
    /DB_ROLE_NOT_FOUND/u,
  );
});
