import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import fs, {mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fullTicketCardSql,fullIntakeOrReviewCardSql,isFullCardProjection} from './helpers/card42a-sql-observer.mjs';
import {registerHooks} from 'node:module';
import {Socket} from 'node:net';
import {checkedLoopbackDatabaseUrl} from '../app/server/src/platform/loopback-database.mjs';
import {checkEvidenceGeneration} from '../app/server/scripts/perf-evidence-publication.mjs';
import {migrationConnection} from '../app/server/scripts/migration-database.mjs';
import {createPostgresClient,createPostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  type Web01CardRow as CardRow,
  type CardRelationRow,
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
import type {FollowAnchor,FollowBatchRow} from '../app/server/src/workbench-follow.mjs';
import type {ProjectionProof,ProjectionRow} from '../app/server/src/workbench-card-projections.mjs';
import {createWorkbenchSearch,type SearchRow,type SearchProof,type WindowClock} from '../app/server/src/workbench-search.mjs';
import {validGroupSql, sourceGroupOriginBindingSql} from '../app/server/src/workbench-source-groups.mjs';
import {supplementMaterialsSql} from '../app/server/src/workbench-supplement-follow-up.mjs';
import {
  type RoleSettingRow,
  ROLE_SETTINGS,
  buildRoleSettingSql,
  checkRoleSettings,
  parseRoleSettingsArgs,
  validateRoleName,
} from '../app/server/scripts/db-role-settings.mjs';
import {publishPerfEvidence,runPerfBoard,assertLoopbackDatabaseUrl,assertPerfBoardVersion,isPerfItemProjection,inspectPerfScenario,measurePerfScenario,perfReadCount,perfSearchPrincipalCount} from '../app/server/scripts/perf-board.mjs';
import type {CatalogSnapshot} from '../app/server/src/platform/postgres-catalog.mjs';
import {ticketTerminalAtSchemaReady,TICKET_TERMINAL_AT_MIGRATION_ID,type TicketTerminalCatalogRow} from '../app/server/scripts/ticket-terminal-at-migrate.mjs';
import type {PostgresQueryResult, PostgresQueryRow} from '../app/server/src/platform/postgres-pool.mjs';
import {createP2016TicketQuery,type P2016TicketRow} from '../app/server/src/p2-016-ticket-query.mjs';
import type {BoardColumn} from '../contracts/web01_workbench_contracts.js';
import type {WorkbenchSearchCriteria} from '../contracts/workbench_search_contracts.js';

const ROOT = process.env.TS_MIGRATION_TEST_SOURCE_ROOT ?? process.cwd();
const PRINCIPAL_ID = '11111111-1111-4111-8111-111111111111';
const SAMPLE_ID = '22222222-2222-4222-8222-222222222222';
const SAMPLE_INTAKE_ID = '33333333-3333-4333-8333-333333333333';

function result<R extends PostgresQueryRow>(rows:R[]):PostgresQueryResult<R>{
  return {rows,rowCount:rows.length,command:'SELECT',oid:0,fields:[]};
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

  const exclusion='i.id NOT IN (SELECT actual.source_intake_id FROM pilot_ticket.ticket actual)';
  const completedPages=[null,{kind:'ticket',id:SAMPLE_ID,order_group:1,at:'2026-11-25 09:00:00'}];
  for(const cursor of completedPages){
    const page=buildBoardKeysQuery({column:'handled',relatedOnly:false,includeFollow:false,allRange:true,
      from:'2026-11-24 00:00:00',until:'2026-11-26 00:00:00',limit:51,cursor});
    assert.ok(page.sql.includes(exclusion));
    assert.match(page.sql,/r\.resolved_at>=\(SELECT terminal_at FROM ticket_page_floor\)/u);
    assert.match(page.sql,/ranked\.order_group=1 AND ranked\.order_at>=\(SELECT terminal_at FROM ticket_page_floor\)/u);
    assert.match(page.sql,/unbounded WHERE \(SELECT terminal_at FROM ticket_page_floor\) IS NULL/u);
    assert.ok(page.handled);
    assert.ok(!page.handled.completedIntakesSql.includes('ticket_page_floor'),'the current final count sees the complete authorized cohort');
    assert.match(page.handled.completedIntakesSql,/FROM reviewed_intakes i LEFT JOIN LATERAL/u);
    assert.match(page.handled.completedIntakesSql,/FROM eligible i WHERE NOT i\.reviewed AND/u);
  }
  assert.ok(buildHandledGroupCountsSql({relatedOnly:false,includeFollow:false}).includes(exclusion));
  // Handled group_counts + buildSingleCardSql param checks
  const countsSql = buildHandledGroupCountsSql({relatedOnly: true, includeFollow: true});
  assertNoVolatileTimeCalls(countsSql, 'handledGroupCounts');
  assertContiguousParams(countsSql, [true, PRINCIPAL_ID, ['PILOT_IT'], '1700000000000', '2026-11-25 10:00:00', false, '2026-11-24 00:00:00', '2026-11-26 00:00:00'], 'handledGroupCounts');

  assertContiguousParams(buildSingleCardSql('ticket'), [true, PRINCIPAL_ID, ['PILOT_IT'], '1700000000000', '2026-11-25 10:00:00', SAMPLE_ID], 'singleCard:ticket');
  assertContiguousParams(buildSingleCardSql('review'), [true, PRINCIPAL_ID, ['PILOT_IT'], '1700000000000', '2026-11-25 10:00:00', SAMPLE_ID], 'singleCard:review');
  assertContiguousParams(buildSingleCardSql('intake', '$4::uuid', '$2::bigint', '$3::timestamp without time zone'), [true, '1700000000000', '2026-11-25 10:00:00', SAMPLE_ID], 'singleCard:intake');

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

test('Card 42A: runtime mock execution verifies contiguous params and single projection query per list()', async t => {
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
  } satisfies CardRow & {order_at:string;order_group:number};

  let emptyResult = false;
  let expireOriginDuringDecoration=false,sourceOrigin:string|null=SAMPLE_INTAKE_ID;
  const searchSignature=(sql:string)=>sql.includes('SELECT cards.kind,cards.id,cards.intake_id,cards.origin_intake_id,')
    ?JSON.stringify(['sig-1',sourceOrigin]):JSON.stringify(['sig-1']);
  let convertedReview:'ticket'|'intake'|'review'|null=null;
  let intakeReadable=true,reviewSourceReadable=true,convertAtProjection=false;
  let revokeDuringAttention=false,aliasReadable=true;
  let directIntake:CardRow|null=null,pendingReview:CardRow|null=null;
  const makeQuery = async (sqlText: string, values: unknown[] = []) => {
    executed.push({sql: sqlText, values});
    assertContiguousParams(sqlText, values, `mockQuery(${sqlText.slice(0, 60)})`);
    if(convertAtProjection&&isFullCardProjection(sqlText)){
      convertedReview='ticket';convertAtProjection=false;
    }
    const currentCard=directIntake??pendingReview??sampleTicketRow;
    if(sqlText.includes('END AS projected_card FROM review_item_route route')){
      assert.match(sqlText,/review_item_route AS MATERIALIZED/u);
      assert.equal(values.length,2,'only principal ID and requested Review ID cross the projection boundary');
      assert.equal(values[0],PRINCIPAL_ID);
      assert.ok(sqlText.includes('reader.broad OR t.assignee_id=reader.id OR t.resolver_team_id=ANY(reader.teams)'));
      const dispatch=sqlText.slice(sqlText.indexOf('CASE route.kind'));
      assert.ok(dispatch.includes('route.broad OR jt.assignee_id=route.reader_id OR jt.resolver_team_id=ANY(route.teams)'));
      assert.ok(dispatch.includes('route.broad OR t.assignee_id=route.reader_id OR t.resolver_team_id=ANY(route.teams)'));
      for(const kind of ['ticket','review','intake']){
        assert.ok(dispatch.includes("WHEN '"+kind+"' THEN (SELECT row_to_json(projected) FROM (SELECT '"+kind+"'::text AS kind"));
      }
      assert.equal(dispatch.split('=route.id').length-1,3,'each CASE arm selects only the canonical primary key');
      return result([{projected_card:currentCard,roles:['ADMIN'],teams:['PILOT_IT']}]);
    }
    const trimmed = sqlText.trim();
    if (trimmed.startsWith('SET ') || trimmed === 'BEGIN' || trimmed === 'COMMIT' || trimmed === 'ROLLBACK') {
      return result([]);
    }
    if (sqlText.includes('AS review_legs'))return result<FollowBatchRow>([{kind:convertedReview?'review':'ticket',id:SAMPLE_ID,intake_id:SAMPLE_INTAKE_ID,readable:!convertedReview,
      missing_review:convertedReview!==null,review_scope_overflow:false,canonical_changed:convertedReview==='ticket',handling:false,communication:false,anchors:[{id:SAMPLE_INTAKE_ID,following:true,row_version:'1'}],review_legs:0}]);
    if (sqlText.includes('SELECT i.id::text,COALESCE(f.following')){
      if(revokeDuringAttention)aliasReadable=false;
      return result<FollowAnchor>([{id:SAMPLE_INTAKE_ID,following:true,row_version:'1'}]);
    }
    if (sqlText.startsWith('SELECT source_intake_id::text AS id FROM pilot_ticket.ticket'))
      return result<Pick<CardRow,'id'>>([{id:SAMPLE_INTAKE_ID}]);
    if (sqlText.includes('AS valid') && !sqlText.includes('proof') && !sqlText.includes('session_valid')) {
      return result<{valid:boolean}>([{valid: true}]);
    }
    if (sqlText.includes('now_epoch') && sqlText.includes('AS now_local') && !sqlText.includes('final_clock AS MATERIALIZED') && !sqlText.includes('AS session_valid')) {
      return result<WindowClock>([{from: '2026-11-24 00:00:00', until: '2026-11-26 00:00:00', now_epoch: '1700000000000', now_local: '2026-11-25 10:00:00'}]);
    }
    if(sqlText.includes('to_regclass')&&sqlText.includes('AS present'))return result<{present:boolean}>([{present:false}]);
    if (sqlText.includes('to_regclass')) {
      return result<{web:boolean;now_epoch:string;now_local:string}>([{web: false, now_epoch: '1700000000000', now_local: '2026-11-25 10:00:00'}]);
    }
    if (sqlText.includes('FROM page_keys')) {
      return result(emptyResult ? [] : [{...sampleTicketRow,key_kind:sampleTicketRow.kind,key_id:sampleTicketRow.id,reader_valid:true}]);
    }
    if (sqlText.includes('SELECT * FROM projected_sources')) {
      if(expireOriginDuringDecoration){sourceOrigin=null;expireOriginDuringDecoration=false;}
      return result<ProjectionRow>([{kind:currentCard.kind,id:currentCard.id,status:currentCard.status,evidence:[],safety_signature:'sig-1'}]);
    }
    if(sqlText.includes('AS session_valid')&&sqlText.includes('AS card_signatures')){
      return result<SearchProof>([{session_valid:true,scope_valid:true,anchor_valid:true,more:false,
        card_signatures:{['ticket:'+SAMPLE_ID]:'card-sig'},items:emptyResult?[]:[{kind:'ticket',id:SAMPLE_ID,safety_signature:searchSignature(sqlText)}]}]);
    }
    if (sqlText.includes('AS session_valid')) {
      return result<ProjectionProof>([{
        principal_valid: true,
        detail_source: {description:'详情（合成）',reported_at:null,records:[]},
        ...(sqlText.includes('AS review_source_valid')?{review_source_valid:reviewSourceReadable}:{}),
        session_valid: true,
        scope_valid: true,
        group_counts: {completed: 1, dismissed: 0},
        page_matches: true,
        items: emptyResult ? [] : [{
          kind: currentCard.kind,
          id: currentCard.id,
          status: currentCard.status,
          stage_entered_at: '2026-11-25 09:00:00',
          safety_signature: 'sig-1',
          closure_evidence: currentCard.closure_evidence,
        }],
      }]);
    }
    if (sqlText.includes('AS card_signature FROM cards')) {
      return result<CardRow&{card_signature:string}>(emptyResult ? [] : [{...sampleTicketRow, card_signature: 'card-sig'}]);
    }
    if (sqlText.includes('FROM matched') && sqlText.includes('safety_signature')) {
      return result<SearchRow>(emptyResult ? [] : [{
        kind: 'ticket',
        id: SAMPLE_ID,
        intake_id: SAMPLE_INTAKE_ID,
        order_at: '2026-11-25 09:00:00',
        order_group: 1,
        safety_signature: searchSignature(sqlText),
      }]);
    }
    if (sqlText.includes("source_provider='YIXIAOXIU_WEB'") && sqlText.includes('LIMIT 1')) {
      return result([]);
    }
    if (sqlText.startsWith('SELECT t.id::text,t.ticket_no,t.request_type'))
      return result<P2016TicketRow>([{id:SAMPLE_ID,intake_id:SAMPLE_INTAKE_ID,assignee_id:PRINCIPAL_ID,resolver_team_id:'PILOT_IT',
        ticket_no:sampleTicketRow.number,request_type:'INCIDENT',priority:'NORMAL',status:'COMPLETED',version:2,
        created_at:sampleTicketRow.created_at,updated_at:sampleTicketRow.updated_at}]);
    if(sqlText.includes('AS communication FROM cards'))
      return result<CardRelationRow>([{kind:'ticket',id:SAMPLE_ID,handling:false,communication:false}]);
    if(sqlText.includes('SELECT t.id,t.source_intake_id AS intake_id,t.ticket_no AS number,t.title'))
      return result<Pick<CardRow,'id'|'intake_id'|'number'|'title'>>([{id:SAMPLE_ID,intake_id:SAMPLE_INTAKE_ID,number:sampleTicketRow.number,title:sampleTicketRow.title}]);
    if(sqlText.includes('SELECT t.id,t.source_intake_id AS intake_id FROM pilot_ticket.ticket'))
      return result<Pick<CardRow,'id'|'intake_id'>>([{id:SAMPLE_ID,intake_id:SAMPLE_INTAKE_ID}]);
    if(sqlText.includes('SELECT r.id::text,r.status,r.row_version::text FROM'))return result([]);
    if(sqlText.includes('SELECT r.id,r.service_intake_id AS intake_id FROM intake.manual_review_item r'))
      return result(convertAtProjection||pendingReview?.id===values[1]?[{id:values[1],intake_id:SAMPLE_INTAKE_ID}]:[]);
    if(fullIntakeOrReviewCardSql.test(sqlText))return result(directIntake?[{...directIntake,roles:['ADMIN'],teams:['PILOT_IT']}]:[]);
    if(sqlText.includes('SELECT i.id,i.id AS intake_id FROM intake.service_intake i')||sqlText.includes('SELECT i.id AS intake_id FROM intake.service_intake i'))
      return result(intakeReadable?[{intake_id:SAMPLE_INTAKE_ID}]:[]);
    if(fullTicketCardSql.test(sqlText))return result([{...sampleTicketRow,roles:['ADMIN'],teams:['PILOT_IT']}]);
    if(sqlText.includes('ORDER BY s.created_at,s.id LIMIT 100')||sqlText.startsWith('SELECT p.display_name,rt.display_name'))return result([]);
    if(sqlText.startsWith('SELECT source_provider FROM intake.service_intake'))return result([{source_provider:'WECOM_AIBOT'}]);
    throw Error('Unexpected fixture SQL: '+sqlText.slice(0,100));
  };

  const mockPool=createPostgresPool({max:1});
  t.after(()=>mockPool.end());
  t.mock.method(mockPool,'query',makeQuery);
  t.mock.method(mockPool,'connect',async()=>({query:makeQuery,release(){}}));

  const ticketQuery = createP2016TicketQuery({
    pool: mockPool,
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

  const web01 = createWeb01WorkbenchQuery({pool: mockPool, query: ticketQuery});
  for (const column of ['pending', 'active', 'handled'] as const) {
    executed.length = 0;
    const res = await web01.list({authContext: auth, column, range: 'recent', cursor: null, limit: '20'});
    assert.equal(res.column, column);
    const boardMainQueries = executed.filter(q => q.sql.includes('page_keys AS ('));
    assert.equal(boardMainQueries.length, 1, `list(${column}) must execute page_keys query exactly once`);
    if(column==='pending')assert.match(boardMainQueries[0]?.sql??'',/\(SELECT actual\.source_intake_id FROM pilot_ticket\.ticket actual WHERE actual\.source_intake_id=i\.id\) IS NULL/u);
    if(column==='handled'){
      const proof=executed.find(q=>q.sql.includes('AS page_matches'));assert.ok(proof);
      assert.match(proof.sql,/to_char\(page\.order_at,'YYYY-MM-DD HH24:MI:SS'\)\)\s+ORDER BY page\.order_group DESC,page\.order_at DESC,page\.kind DESC,page\.id DESC/u);
      assert.ok(!proof.sql.includes("SELECT kind::text,id::text,order_group,to_char(order_at"),'the final aggregate receives timestamp and UUID sort keys');
      assert.equal(proof.sql.split('handled_completed_intakes AS MATERIALIZED').length-1,1);
      assert.equal(proof.sql.split('FROM handled_completed_intakes completed').length-1,2,'count and ordered sentinel must use the same post-wait cohort');
      assert.equal(proof.sql.split('i.id NOT IN (SELECT actual.source_intake_id FROM pilot_ticket.ticket actual)').length-1,1);
      const projection=executed.find(q=>q.sql.includes('SELECT * FROM projected_sources'));assert.ok(projection);
      for(const {sql} of [projection,proof]){
        assert.match(sql,/page_reviews AS MATERIALIZED \([\s\S]+?r\.resolution_decision_id IN \(SELECT decision_id FROM page_material/u);
        assert.ok(sql.includes('FROM reviewed_material source WHERE source.ordinal<=101'),'the overflow sentinel applies after reviewer expansion');
      }
    }
  }

  // Match the fields inside the ticket SELECT itself, including a full card nested in a proof statement.

  executed.length=0;
  const detail=await web01.detail({authContext:auth,kind:'ticket',id:SAMPLE_ID,cursor:null,limit:20});
  assert.equal(detail.item.id,SAMPLE_ID);
  assert.equal(executed.filter(q=>fullTicketCardSql.test(q.sql)).length,1,'detail must hydrate exactly once across route and projection checks');
  assert.deepEqual(executed.filter(q=>isPerfItemProjection(q.sql)),executed.filter(q=>fullTicketCardSql.test(q.sql)),
    'perf evidence selects exactly the executed direct Ticket projection');

  executed.length=0;
  assert.deepEqual(await web01.authorizedSummary(auth,'ticket',SAMPLE_ID),{kind:'ticket',id:SAMPLE_ID,number:sampleTicketRow.number,title:sampleTicketRow.title});
  const labels=executed.find(q=>q.sql.includes('AS intake_id,t.ticket_no AS number,t.title'));assert.ok(labels);
  assert.match(labels.sql,/pilot_ticket\.pilot_team_member m WHERE m\.principal_id=p\.id/u);
  assert.match(labels.sql,/p\.is_active AND r\.role IN \('ADMIN','DISPATCHER','HANDLER'\)/u);
  assert.match(labels.sql,/reader\.broad OR t\.assignee_id=reader\.id OR t\.resolver_team_id=ANY\(reader\.teams\)/u);
  assert.equal(executed.filter(q=>fullTicketCardSql.test(q.sql)).length,0);
  await assert.rejects(web01.projectSearchItems(auth,[{...detail.item,status:'QUEUED'}]),{status:400,code:'P2_016_CURSOR_INVALID'});

  // Exercise the real Follow reader on the same recorder. Only migration readiness has a synthetic result.
  // The PG parity test covers this assembly with the actual receipt catalog and migrated tables.
  const followModule=new URL('../app/server/src/workbench-follow.mjs?count-fixture',import.meta.url).href;
  const hooks=registerHooks({resolve(specifier,context,next){
    if(context.parentURL===import.meta.url && specifier==='../app/server/src/workbench-follow.mjs')
      return {url:followModule,shortCircuit:true};
    if(context.parentURL===followModule && specifier==='../scripts/workbench-follow-migrate.mjs')
      return {url:'data:text/javascript,export async function followSchemaReady(){return true}',shortCircuit:true};
    return next(specifier,context);
  }});
  try {
    const {createWorkbenchFollow}=await import('../app/server/src/workbench-follow.mjs');
    const followPool=createPostgresPool({max:1});
    t.after(()=>followPool.end());
    t.mock.method(followPool,'query',makeQuery);
    const reviews={canonicalItem:async()=>{
      if(!aliasReadable)throw Object.assign(Error('Review material no longer readable'),{status:404,code:'P2_016_NOT_FOUND'});
      if(!convertedReview)throw Error('unexpected review route');
      if(convertedReview==='review'){assert.ok(pendingReview);return {kind:convertedReview,id:pendingReview.id};}
      return {kind:convertedReview,id:convertedReview==='ticket'?SAMPLE_ID:SAMPLE_INTAKE_ID};
    }};
    const follow=createWorkbenchFollow({pool:followPool,query:ticketQuery,enabled:true,manualReviewEnabled:true,reviews});
    const withFollow=createWeb01WorkbenchQuery({pool:followPool,query:ticketQuery,workbenchFollowEnabled:true,follow,manualReviewEnabled:true,reviews});
    executed.length=0;
    const followed=await withFollow.detail({authContext:auth,kind:'ticket',id:SAMPLE_ID,cursor:null,limit:20});
    assert.partialDeepStrictEqual(followed.item,{attention:{following:true}});
    assert.equal(executed.filter(q=>fullTicketCardSql.test(q.sql)).length,1);
    assert.ok(executed.filter(q=>q.sql.includes('SELECT i.id::text,COALESCE(f.following')).length>=2);
    const directAnchors=executed.find(q=>q.sql.includes('SELECT i.id::text,COALESCE(f.following'));
    assert.match(directAnchors?.sql??'',/ORDER BY i\.id LIMIT 101/u);
    executed.length=0;
    await follow.attentionMany(auth,[followed.item],'search');
    const batch=executed.find(q=>q.sql.includes('AS review_legs'));assert.ok(batch);
    assert.match(batch.sql,/ORDER BY a\.id\) AS items FROM \(\s*SELECT i\.id,COALESCE/u);
    assert.match(batch.sql,/FALSE AS review_scope_overflow/u);
    const review={...followed.item,kind:'review' as const};
    for(const surface of ['board','search'] as const){
      executed.length=0;
      // The synthetic store only contains the Ticket. Inspect the real missing-Review query before it refuses the batch.
      await assert.rejects(follow.attentionMany(auth,[review,review],surface),{code:'P2_016_NOT_FOUND'});
      const batches=executed.filter(q=>q.sql.includes('AS review_legs'));assert.equal(batches.length,1);
      assert.equal((batches[0]?.sql.match(/readable_journeys OFFSET 10000/gu)??[]).length,surface==='search'?1:0);
    }
    const itemReader=createWeb01WorkbenchQuery({pool:mockPool,query:ticketQuery,manualReviewEnabled:true,reviews});
    const aliasId='44444444-4444-4444-8444-444444444444';
    const intakeRow:CardRow={...sampleTicketRow,kind:'intake',id:SAMPLE_INTAKE_ID,assignee_name:null,priority:null,completed_at:null};
    async function checkItemAndDetail(kind:'review'|'intake',id:string,expected:CardRow|null){
      for(const load of [
        ()=>itemReader.authorizedItem(auth,kind,id),
        async()=>(await itemReader.detail({authContext:auth,kind,id,cursor:null,limit:20})).item,
      ]){
        executed.length=0;
        if(expected){
          const item=await load();
          assert.deepEqual([item.kind,item.id,item.status],[expected.kind,expected.id,expected.status]);
        }else await assert.rejects(load(),{status:404,code:'P2_016_NOT_FOUND'});
        const full=executed.filter(q=>isFullCardProjection(q.sql));assert.equal(full.length,1);
        if(kind==='intake')assert.ok(full[0]?.sql.includes('OR (reader.broad AND i.retention_until>'));
        else assert.ok(full[0]?.sql.includes('END AS projected_card FROM review_item_route route'));
      }
    }
    for(const status of ['WAITING_DESCRIPTION','COMPLETED',null] as const){
      directIntake=status?{...intakeRow,status,closure_evidence:status==='COMPLETED'?intakeRow.closure_evidence:null}:null;
      await checkItemAndDetail('intake',SAMPLE_INTAKE_ID,directIntake);
    }
    pendingReview={...intakeRow,kind:'review',id:SAMPLE_ID,status:'PENDING',closure_evidence:null};
    await checkItemAndDetail('review',SAMPLE_ID,pendingReview);
    convertedReview='review';
    await checkItemAndDetail('review',aliasId,pendingReview);
    pendingReview=null;convertedReview='intake';directIntake={...intakeRow,status:'COMPLETED'};
    await checkItemAndDetail('review',aliasId,directIntake);
    directIntake=null;convertedReview=null;
    convertAtProjection=true;
    executed.length=0;
    const alias=await withFollow.detail({authContext:auth,kind:'review',id:aliasId,cursor:null,limit:20});
    assert.equal(alias.item.kind,'ticket');assert.equal(alias.item.id,SAMPLE_ID);
    assert.equal(executed.filter(q=>fullTicketCardSql.test(q.sql)).length,1);
    assert.equal(convertAtProjection,false);
    assert.equal(executed.filter(q=>isFullCardProjection(q.sql)).length,1);
    const projected=executed.findIndex(q=>isFullCardProjection(q.sql));
    assert.ok(!executed.slice(0,projected).some(q=>q.sql.includes('SELECT r.id,r.service_intake_id AS intake_id')),
      'the request never commits to a Review key in a preceding identity read');
    assert.ok(executed.slice(projected+1).some(q=>q.sql.includes('SELECT r.id,r.service_intake_id AS intake_id')),
      'detail rechecks the requested Review route after projecting the Ticket');
    reviewSourceReadable=false;
    await assert.rejects(withFollow.detail({authContext:auth,kind:'review',id:aliasId,cursor:null,limit:20}),{status:404,code:'P2_016_NOT_FOUND'});
    reviewSourceReadable=true;
    revokeDuringAttention=true;
    await assert.rejects(withFollow.authorizedItem(auth,'review',aliasId),{status:404,code:'P2_016_NOT_FOUND'});
    assert.equal(aliasReadable,false);
    revokeDuringAttention=false;aliasReadable=true;
    await assert.rejects(follow.attentionMany(auth,[review],'search'),{status:400,code:'P2_016_CURSOR_INVALID'});
    await assert.rejects(follow.attentionMany(auth,[review],'board'),{status:409,code:'P2_016_VERSION_CONFLICT'});
    convertedReview='intake';
    await assert.rejects(follow.attentionMany(auth,[review],'search'),{status:400,code:'P2_016_CURSOR_INVALID'});
    intakeReadable=false;
    await assert.rejects(follow.attentionMany(auth,[review],'search'),{status:404,code:'P2_016_NOT_FOUND'});
  } finally {
    hooks.deregister();
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
      searchCriteria({column: 'all', range: 'recent', q: '打印机'}),
      searchCriteria({column: 'pending', range: 'recent', q: '打印', responsibility: 'handling'}),
      searchCriteria({column: 'active', range: 'all', q: ''}),
      searchCriteria({column: 'handled', range: 'recent', q: '', closure_kind: 'completed'}),
      searchCriteria({column: 'handled', range: 'all', q: '', statuses: ['COMPLETED']}),
      ...(empty ? [
        searchCriteria({column: 'handled', statuses: ['QUEUED']}),
        searchCriteria({column: 'handled', statuses: ['RECEIVED']}),
        searchCriteria({column: 'handled', closure_kind: 'dismissed', statuses: ['COMPLETED']}),
      ] : []),
    ]) {
      executed.length = 0;
      const page = await search.search({authContext: auth, request: {criteria, cursor: null, limit: 10}});
      assert.equal(page.items.length, empty ? 0 : 1);
      assert.equal(executed.filter(q=>q.sql.includes('AS card_signature FROM cards')).length,empty?0:1);
      assert.equal(executed.filter(q=>fullTicketCardSql.test(q.sql)).length,empty?0:1,'count full SELECTs across selection, decoration and final proof');
      const proof=executed.find(q=>q.sql.includes('AS anchor_valid'));
      assert.ok(proof?.sql.startsWith('WITH final_clock AS MATERIALIZED'));
      // The realistic capacity plan used to scan all Journeys and replay all Intakes for each search candidate.
      const pageSql=executed.find(q=>q.sql.includes('AS safety_signature FROM matched'))?.sql;
      assert.match(pageSql??'',/ORDER BY matched\.order_group DESC,matched\.order_at DESC,matched\.kind DESC,matched\.id DESC LIMIT/u);
      const originReads=executed.filter(q=>q.sql.includes('candidate_keys AS ('));
      assert.equal(originReads.length,empty?1:2,'selection and the nonempty final proof both use the origin binding');
      if(criteria.q==='打印机'){
        const selection=originReads[0]?.sql??'';
        assert.match(selection,/\(SELECT actual\.source_intake_id FROM pilot_ticket\.ticket actual WHERE actual\.source_intake_id=i\.id\) IS NULL/u);
        assert.match(selection,/LIMIT 1 OFFSET 999\) THEN i\.id NOT IN/u);
        assert.match(selection,/actual\.source_intake_id=closing_review\.service_intake_id\) IS NULL/u);
        assert.ok(selection.includes('i.id NOT IN (SELECT actual.source_intake_id FROM pilot_ticket.ticket actual)'));
      }
      for(const {sql} of originReads){
        assert.match(sql,/enriched AS \(\s*SELECT cards\.kind,cards\.id,cards\.intake_id,cards\.origin_intake_id,/u);
        assert.ok(sql.includes("to_char(cards.sort_at,'YYYY-MM-DD HH24:MI:SS') AS sort_at"));
        assert.match(sql,/origin\.origin_intake_id=r\.intake_id::uuid\s+UNION SELECT leg\.journey_id/u);
        assert.match(sql,/leg\.source_intake_id=r\.intake_id::uuid\s+UNION SELECT rev\.journey_id/u);
        assert.match(sql,/r\.kind='review' AND rev\.id=r\.id::uuid/u);
        assert.match(sql,/FROM intake\.service_intake origin\s+WHERE origin\.id=cards\.origin_intake_id AND origin\.retention_until_epoch_ms>[^\n]* LIMIT 1\s*\) i ON TRUE/u);
      }
      for (const q of executed) {
        if (!q.sql.includes('stamp') && !q.sql.includes('AS now_local') && !q.sql.includes('AS valid') && !q.sql.includes('session_valid')) {
          assertNoVolatileTimeCalls(q.sql, 'search query');
        }
      }
    }
  }
  emptyResult=false;expireOriginDuringDecoration=true;
  const byNumber={authContext:auth,request:{criteria:searchCriteria({q:sampleTicketRow.number}),cursor:null,limit:10}};
  await assert.rejects(search.search(byNumber),{status:400,code:'P2_016_CURSOR_INVALID'});
  assert.equal(expireOriginDuringDecoration,false);
  assert.equal((await search.search(byNumber)).items[0]?.id,SAMPLE_ID);

});

test('42A catalog readiness sends one statement on a pool configured with a custom search_path',async t=>{
  const pool=createPostgresPool({options:'-c search_path=platform,public',max:1});
  t.after(()=>pool.end());
  t.mock.method(pool,'connect',()=>assert.fail('catalog probe acquired a separate connection'));
  let registered=true;
  const queries=t.mock.method(pool,'query',async(sql:string,values:unknown[])=>{
    assertContiguousParams(sql,values,'075 catalog probe');
    assert.equal(values[0],TICKET_TERMINAL_AT_MIGRATION_ID);
    const checksum=values[1];assert.ok(typeof checksum==='string');
    assert.match(sql,/pg_catalog\.set_config\('quote_all_identifiers','off',true\)/u);
    assert.match(sql,/pg_catalog\.set_config\('quote_all_identifiers',rendered\.original_quote,true\)/u);
    assert.match(sql,/pg_catalog\.set_config\('search_path','pg_catalog, public, pg_temp',true\)/u);
    assert.match(sql,/pg_catalog\.row_to_json\(inventory\) FROM \(WITH cons AS/u);
    assert.match(sql,/pg_catalog\.set_config\('search_path',rendered\.original,true\)/u);
    return result<CatalogSnapshot<TicketTerminalCatalogRow>>([{snapshot:registered?{checksum_sha256:checksum,ready:true}:null}]);
  });
  assert.equal(await ticketTerminalAtSchemaReady(pool),true);
  assert.equal(queries.mock.callCount(),1);
  registered=false;
  assert.equal(await ticketTerminalAtSchemaReady(pool),false);
  assert.equal(queries.mock.callCount(),2);
});

test('Card 42A-2 & 42A-7: 075 migration SQL & db-role-settings contract', async t => {
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

  const mockRoleTx=(rows:RoleSettingRow[])=>{
    const pool=createPostgresPool({max:1});
    t.after(()=>pool.end());
    t.mock.method(pool,'query',async()=>result(rows));
    return pool;
  };
  const mockCheckReady = await checkRoleSettings(mockRoleTx([{exists: true, setconfig: ['jit=off'],database_config:null}]), 'ticket_app');
  assert.deepEqual(mockCheckReady, {ok: true, role: 'ticket_app', missing: [], current: {jit: 'off'}});

  const overridden=await checkRoleSettings(mockRoleTx([{exists:true,setconfig:['jit=off'],database_config:['jit=on']}]),'ticket_app');
  assert.deepEqual(overridden,{ok:false,role:'ticket_app',missing:['jit'],current:{jit:'on'}});
  const mockCheckPending = await checkRoleSettings(mockRoleTx([{exists: true, setconfig: null,database_config:null}]), 'ticket_app');
  assert.deepEqual(mockCheckPending, {ok: false, role: 'ticket_app', missing: ['jit'], current: {jit: null}});

  await assert.rejects(
    checkRoleSettings(mockRoleTx([{exists: false, setconfig: null,database_config:null}]), 'absent_role'),
    /DB_ROLE_NOT_FOUND/u,
  );
});

test('Card 42A perf evidence requires PG18 and admits every measured search within the principal quota',()=>{
  assert.doesNotThrow(()=>assertPerfBoardVersion(180006,'18.6',true));
  for(const major of [17,19])assert.throws(()=>assertPerfBoardVersion(major*10000,String(major),true),/PERF_BOARD_REQUIRES_PG18/u);
  assert.throws(()=>assertPerfBoardVersion(170000,'17',false),/PERF_BOARD_REQUIRES_PG18/u);
  assert.doesNotThrow(()=>assertPerfBoardVersion(190000,'19',false));
  for(const [warmup,iterations] of [[3,100],[0,80]] as const){
    const principals=perfSearchPrincipalCount(warmup,iterations),calls=3*(warmup+iterations);
    assert.ok(20*principals>=calls&&20*(principals-1)<calls);
  }
});

test('42A perf preflight checks driver-effective destinations without opening a connection',async t=>{
  const target='postgresql://127.0.0.1:5432/fixture';
  assert.equal(assertLoopbackDatabaseUrl(target).host,'127.0.0.1');
  assert.equal(assertLoopbackDatabaseUrl('postgresql://[::1]:5544/fixture').port,5544);
  assert.equal(assertLoopbackDatabaseUrl(target+'?hostaddr=127.0.0.1&port=5432').port,5432);
  for(const [authority,expectedHost] of [['[::1]','::1'],['localhost','127.0.0.1'],['127.0.0.1','127.0.0.1']] as const){
    const config=assertLoopbackDatabaseUrl('postgresql://fixture_user:fixture_pass@'+authority+':5544/admin');
    for(const options of [config,migrationConnection({...config,database:'owned_fixture'})]){
      assert.equal(options.user,'fixture_user');assert.equal(options.password,'fixture_pass');
      const connect=t.mock.method(Socket.prototype,'connect',function(this:Socket,...args:unknown[]){
        assert.deepEqual(args,[5544,expectedHost]);
        queueMicrotask(()=>this.destroy(Error('synthetic socket stop')));
        return this;
      });
      const client=createPostgresClient(options);
      await assert.rejects(client.connect(),/synthetic socket stop/u);
      assert.equal(connect.mock.callCount(),1);connect.mock.restore();
    }
  }
  for(const raw of [target+'?host=other.invalid',target+'?hostaddr=192.0.2.1',target+'?port=5544',
    target+'?host=%2Ftmp',target+'?port=5432x','socket://localhost/fixture','postgresql://other.invalid/fixture']){
    assert.throws(()=>assertLoopbackDatabaseUrl(raw),/PERF_BOARD_(?:REQUIRES_LOOPBACK_DATABASE|DATABASE_DESTINATION_MISMATCH)/u);
  }
});

test('42A perf CLI hands the numeric destination to the admin pool and the baseline migrator',()=>{
  const driver=import.meta.resolve('pg');
  const preload=`import assert from 'node:assert/strict';
    import {Socket} from 'node:net';
    import pg from ${JSON.stringify(driver)};
    const applications=new Set();
    Socket.prototype.connect=function(port,host){
      assert.equal(host,'::1');assert.equal(port,5544);
      queueMicrotask(()=>this.destroy(Error('SYNTHETIC_SOCKET_STOP')));return this;
    };
    async function check(pool){
      const opts=pool.options;
      assert.equal(opts.connectionString,undefined);assert.equal(opts.host,'::1');
      assert.equal(opts.user,'fixture');assert.equal(opts.password,'synthetic');
      if(opts.application_name==='perf_board_admin')assert.equal(opts.database,'admin');
      else assert.match(opts.database,/^ticket_card42a_perf_board_/);
      const client=new pg.Client(opts);
      await assert.rejects(client.connect(),/SYNTHETIC_SOCKET_STOP/);
      applications.add(opts.application_name);
    }
    pg.Pool.prototype.query=async function(sql){
      assert.equal(this.options.application_name,'perf_board_admin');
      await check(this);
      return {rows:sql.includes('server_version_num')?[{version:'18',ver_num:180000}]:[]};
    };
    pg.Pool.prototype.connect=async function(){await check(this);throw Error('SYNTHETIC_MIGRATION_STOP');};
    process.on('exit',()=>assert.deepEqual([...applications],['perf_board_admin','arch_005_current_baseline_migrator']));`;
  const cli=fileURLToPath(new URL('../app/server/scripts/perf-board.mjs',import.meta.url));
  const ran=spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(preload),cli],{
    encoding:'utf8',env:{...process.env,PILOT_DATABASE_URL:'postgresql://fixture:synthetic@[::1]:5544/admin',PGHOSTADDR:'::1'},
  });
  assert.equal(ran.status,1);assert.match(ran.stderr,/SYNTHETIC_MIGRATION_STOP/u);
  assert.doesNotMatch(ran.stderr,/AssertionError/u);
});

test('P1-003 preserves the caller socket destination for the suite, migration and restart worker',()=>{
  const url='postgresql://fixture@localhost:5544/caller_database';
  assert.equal(checkedLoopbackDatabaseUrl(url+'?hostaddr=::1'),url+'?hostaddr=::1');
  for(const bad of [url+'?host=wrong.invalid',url+'?hostaddr=192.0.2.1',url+'?port=5545'])
    assert.throws(()=>checkedLoopbackDatabaseUrl(bad),/DATABASE_DESTINATION_MISMATCH/u);
  const probe=`import assert from 'node:assert/strict';import {writeSync} from 'node:fs';import {Socket} from 'node:net';
    import pg from ${JSON.stringify(import.meta.resolve('pg'))};
    let suite=false;
    Socket.prototype.connect=function(port,host){
      assert.deepEqual([port,host],[5544,'localhost']);
      queueMicrotask(()=>this.destroy(Error('observed native socket')));return this;
    };
    async function check(pool){
      assert.equal(pool.options.connectionString,process.env.PILOT_DATABASE_URL);
      assert.equal(pool.options.stream,undefined);
      await assert.rejects(new pg.Client(pool.options).connect(),/observed native socket/);
    }
    pg.Pool.prototype.query=async function(){
      await check(this);suite=true;return {rows:[{marker_table_exists:false}],rowCount:1};
    };
    pg.Pool.prototype.connect=async function(){
      await check(this);
      if(process.env.P1_003_DESTINATION_PROBE==='suite'){
        assert.ok(suite);assert.equal(this.options.application_name,'arch_005_current_baseline_migrator');
      }
      writeSync(1,'P1_003_DESTINATION_VERIFIED');process.exit(0);
    };`;
  for(const [role,file,...args] of [
    ['suite','./p1-003-channel-message-inbox.test.mjs'],
    ['worker','./fixtures/p1-003-inbox-worker.mjs','replay','p1-003-restart-22222222-2222-4222-8222-222222222222'],
  ] as const){
    const run=spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(probe),fileURLToPath(new URL(file,import.meta.url)),...args],
      {encoding:'utf8',env:{...process.env,PILOT_DATABASE_URL:url,PGHOSTADDR:'::1',P1_003_DESTINATION_PROBE:role}});
    assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/P1_003_DESTINATION_VERIFIED/u);
  }
});

test('ordinary postgres pools and clients leave localhost address-family selection to the native socket',async t=>{
  const databaseUrl='postgresql://fixture@localhost:5544/app';
  assert.deepEqual(migrationConnection(databaseUrl),{connectionString:databaseUrl});
  const dial=t.mock.method(Socket.prototype,'connect',function(this:Socket,...args:unknown[]){
    assert.equal(Object.getPrototypeOf(this),Socket.prototype);
    assert.deepEqual(args,[5544,'localhost']);
    queueMicrotask(()=>this.destroy(Error('native localhost dial observed')));
    return this;
  });
  await assert.rejects(createPostgresClient({connectionString:databaseUrl}).connect(),/native localhost dial observed/u);
  const pool=createPostgresPool({connectionString:databaseUrl,max:1});
  try{await assert.rejects(pool.connect(),/native localhost dial observed/u);}finally{await pool.end();}
  assert.equal(dial.mock.callCount(),2);
});

test('loopback configuration preserves the installed pg TLS policy',()=>{
  for(const query of ['ssl=no-verify','sslmode=require','sslmode=disable']){
    const url='postgresql://fixture@localhost:5544/admin?'+query;
    const baseline=createPostgresClient({connectionString:url});
    const pinned=createPostgresClient(assertLoopbackDatabaseUrl(url));
    assert.deepEqual(pinned.ssl,baseline.ssl,query);
    if(query==='ssl=no-verify')assert.deepEqual(pinned.ssl,{rejectUnauthorized:false});
    if(query==='sslmode=require')assert.ok(pinned.ssl);
  }
  assert.throws(()=>assertLoopbackDatabaseUrl('postgresql://localhost/admin?ssl=unknown'),/SSL_OPTION_INVALID/u);
});

test('localhost keeps its TLS and pgpass identity across direct, nested and migration connections',t=>{
  const root=mkdtempSync(path.join(tmpdir(),'42a-pgpass-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const passfile=path.join(root,'fixture.pgpass');
  writeFileSync(passfile,'127.0.0.1:5544:*:fixture:wrong-address-entry\nlocalhost:5544:*:fixture:lowercase-entry\nLOCALHOST:5544:*:fixture:uppercase-entry\n',{mode:0o600});
  const key=path.join(root,'key.pem'),cert=path.join(root,'cert.pem');
  const openssl=['openssl',...['C:','D:'].map(drive=>drive+'/Program Files/Git/usr/bin/openssl.exe')];
  const binary=openssl.find(bin=>spawnSync(bin,['version']).status===0);
  assert.ok(binary);
  const generated=spawnSync(binary,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1',
    '-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost']);
  assert.equal(generated.status,0);
  const script=`import assert from 'node:assert/strict';import tls from 'node:tls';import {Socket} from 'node:net';
    import {Duplex,PassThrough} from 'node:stream';import fs from 'node:fs';
    import {createPostgresClient} from ${JSON.stringify(new URL('../app/server/src/platform/postgres-pool.mjs',import.meta.url).href)};
    import {loopbackFixtureTarget,withFixtureMigrations} from ${JSON.stringify(new URL('../app/server/src/platform/loopback-database.mjs',import.meta.url).href)};
    import {migrationConnection} from ${JSON.stringify(new URL('../app/server/scripts/migration-database.mjs',import.meta.url).href)};
    let hostname;
    const tlsConnect=tls.connect;
    const ca=fs.readFileSync(${JSON.stringify(cert)}),context=tls.createSecureContext({key:fs.readFileSync(${JSON.stringify(key)}),cert:ca});
    let sockets=0,sni=0,verified=0;
    Socket.prototype.connect=function(port,addr){
      assert.deepEqual([port,addr],[5544,'127.0.0.1']);sockets++;
      queueMicrotask(()=>{this.emit('connect');this.emit('data',Buffer.from('S'));});return this;
    };
    tls.connect=function(options){
      assert.equal(options.servername,hostname);
      const forward=new PassThrough(),backward=new PassThrough();
      const peer=new tls.TLSSocket(Duplex.from({writable:backward,readable:forward}),{isServer:true,secureContext:context});
      peer.on('error',()=>{});
      const client=tlsConnect({...options,socket:Duplex.from({writable:forward,readable:backward}),ca,
        checkServerIdentity(name,cert){
          assert.equal(name,hostname);assert.ok(tls.checkServerIdentity('127.0.0.1',cert));
          verified++;return (options.checkServerIdentity??tls.checkServerIdentity)(name,cert);
        }});
      peer.once('secure',()=>{assert.equal(peer.servername,hostname);sni++;client.destroy(Error('synthetic TLS handshake observed'));peer.destroy();});
      return client;
    };
    for(const [authority,query,expectedName,password] of [
      ['localhost','','localhost','lowercase-entry'],['LOCALHOST','','LOCALHOST','uppercase-entry'],
      ['localhost','&host=LOCALHOST','LOCALHOST','uppercase-entry']]){
      hostname=expectedName;
      const {databaseUrl,connection}=loopbackFixtureTarget('postgresql://fixture@'+authority+':5544/owned?sslmode=verify-full'+query);
      assert.equal(new URL(databaseUrl).hostname,hostname);assert.equal(connection.host,hostname);
      const pending=withFixtureMigrations(databaseUrl,async()=>{
        const unrelated=databaseUrl.replace('/owned?','/other?');
        assert.deepEqual(migrationConnection(unrelated),{connectionString:unrelated});
        for(const options of [connection,migrationConnection({...connection,database:'isolated'}),migrationConnection(databaseUrl)]){
          const client=createPostgresClient(options);
          client.connection.stream.write=()=>true;
          await new Promise(resolve=>client._getPassword(resolve));
          assert.equal(client.password,password);
          await assert.rejects(client.connect(),/synthetic TLS handshake observed/);
        }
      });
      assert.deepEqual(migrationConnection(databaseUrl),{connectionString:databaseUrl});
      await pending;
      assert.deepEqual(migrationConnection(databaseUrl),{connectionString:databaseUrl});
    }
    assert.equal(sockets,9);assert.equal(sni,9);assert.equal(verified,9);`;
  const env:NodeJS.ProcessEnv={...process.env,PGPASSFILE:passfile,PGHOSTADDR:'127.0.0.1'};delete env.PGPASSWORD;
  const run=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env});
  assert.equal(run.status,0,run.stderr);
});

test('075 owned fixture pins admin, callback and nested migrator sockets before DDL',()=>{
  const harness=new URL('./helpers/p2-015-postgres-harness.mjs',import.meta.url).href;
  const migrate=new URL('../app/server/scripts/p2-015-migrate.mjs',import.meta.url).href;
  const script=`import assert from 'node:assert/strict';import {Socket} from 'node:net';
    import pg from ${JSON.stringify(import.meta.resolve('pg'))};
    import {withP2015IsolatedDatabase as fixture} from ${JSON.stringify(harness)};
    import {migrateP2015} from ${JSON.stringify(migrate)};
    let calls=0,created=0;const stages=new Set();
    Socket.prototype.connect=function(port,host){
      assert.equal(port,5544);assert.equal(host,process.env.EXPECT_HOST);
      queueMicrotask(()=>this.destroy(Error('synthetic stop')));return this;
    };
    async function check(pool){
      calls++;const c=new pg.Client(pool.options);await assert.rejects(c.connect(),/synthetic stop/);
      const admin=c.database==='admin';
      if(!admin)assert.match(c.database,/^ticket_card42a_pin_/);
      stages.add(admin?'admin':pool.options.application_name==='p2_015_migrator'?'migration':'fixture');
    }
    pg.Pool.prototype.query=async function(sql){
      await check(this);if(this.options.application_name==='p2_015_migrator')throw Error('owned migration reached');
      if(sql.startsWith('CREATE DATABASE'))created++;
      return {rows:[{count:0}],rowCount:1};
    };
    pg.Pool.prototype.connect=async function(){await check(this);throw Error('owned migration reached');};
    const opts={purpose:'pin',namespace:'ticket_card42a',run:async({pool,databaseUrl})=>{
      await pool.query('SELECT 1');await assert.rejects(migrateP2015({databaseUrl}),/owned migration reached/);
    }};
    await assert.rejects(fixture({...opts,databaseUrl:process.env.PILOT_DATABASE_URL+'?host=other.invalid'}),/DESTINATION_MISMATCH/);
    assert.equal(calls,0);await fixture({...opts,databaseUrl:process.env.PILOT_DATABASE_URL});
    assert.equal(created,1);assert.deepEqual([...stages],['admin','fixture','migration']);`;
  for(const [host,literal] of [['[::1]','::1'],['localhost','127.0.0.1'],['LOCALHOST','127.0.0.1']] as const){
    const run=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',
      env:{...process.env,PILOT_DATABASE_URL:'postgresql://fixture@'+host+':5544/admin',EXPECT_HOST:literal,PGHOSTADDR:literal}});
    assert.equal(run.status,0,run.stderr);
  }
});

test('isolated database harnesses use the owned catalog name and pinned transport for both pools',()=>{
  const harnesses=['002','003','004','005','006'].map(id=>[
    new URL('./helpers/p2-'+id+'-postgres-harness.mjs',import.meta.url).href,'withP2'+id+'IsolatedDatabase',
  ]);
  harnesses.push([new URL('../app/server/src/p2-g1-isolated-postgres.mjs',import.meta.url).href,'withP2G1IsolatedPostgres']);
  const script=`import assert from 'node:assert/strict';import pg from ${JSON.stringify(import.meta.resolve('pg'))};
    let created,dropped;
    pg.Pool.prototype.query=async function(sql){
      assert.equal(this.options.database,'admin');assert.equal(this.options.host,'LOCALHOST');
      assert.equal(typeof this.options.stream,'function');
      if(sql.startsWith('CREATE DATABASE'))created=sql.split('"')[1];
      if(sql.startsWith('DROP DATABASE'))dropped=sql.split('"')[1];
      return {rows:[{count:0}],rowCount:1};
    };
    for(const [file,key] of ${JSON.stringify(harnesses)}){
      created=dropped=undefined;
      const fixture=(await import(file))[key];
      const name=await fixture({databaseUrl:'postgresql://fixture@LOCALHOST:5544/admin',purpose:'pin',run:async({pool,databaseName})=>{
        assert.ok(created);assert.equal(databaseName,created);assert.equal(pool.options.database,created);
        assert.equal(pool.options.host,'LOCALHOST');assert.equal(typeof pool.options.stream,'function');
        return databaseName;
      }});
      assert.equal(name,created);assert.equal(dropped,created);
    }`;
  const run=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,PGHOSTADDR:'127.0.0.1'}});
  assert.equal(run.status,0,run.stderr);
});

test('42A perf CLI refuses a mismatched destination before its first database call',()=>{
  const driver=import.meta.resolve('pg');
  const preload=`import pg from ${JSON.stringify(driver)};
    pg.Pool.prototype.query=pg.Pool.prototype.connect=()=>{throw Error('UNEXPECTED_DATABASE_CALL');};`;
  const cli=fileURLToPath(new URL('../app/server/scripts/perf-board.mjs',import.meta.url));
  for(const [url,port,hostaddr] of [
    ['postgresql://127.0.0.1:5432/fixture?port=5544','',''],
    ['postgresql://127.0.0.1/fixture','5544',''],
    ['postgresql://127.0.0.1:5432/fixture','','192.0.2.1'],
  ] as const){
    const result=spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(preload),cli],{
      encoding:'utf8',env:{...process.env,PILOT_DATABASE_URL:url,PGPORT:port,PGHOSTADDR:hostaddr},
    });
    assert.equal(result.status,1);assert.match(result.stderr,/PERF_BOARD_DATABASE_DESTINATION_MISMATCH/u);
    assert.doesNotMatch(result.stderr,/UNEXPECTED_DATABASE_CALL/u);
  }
});

test('42A zero warmups measures the very first request and records its SQL',async()=>{
  for(const warmup of [0,3]){
    let calls=0;
    let addRead:(sql:string)=>void=()=>{throw Error('unexpected read');};
    const run=await measurePerfScenario('trial',warmup,1,1,async()=>{
      calls++;addRead('SELECT '+calls);return {count:1,value:calls};
    },reads=>{if(reads)addRead=sql=>{reads.push({sql,values:[],elapsedMs:0});};});
    assert.equal(run.error,undefined);assert.equal(calls,warmup+1);assert.equal(run.stats?.iterations,1);
    assert.equal(run.statements[0]?.sql,'SELECT '+(warmup+1));assert.equal(run.last,calls);
  }
});

test('42A acceptance counts secondary plan, JIT and EXPLAIN failures without diagnostics',async()=>{
  const sqls=['BEGIN','SELECT page','SELECT hydration','COMMIT','SELECT proof','SELECT schema'];
  assert.equal(perfReadCount(sqls),4);
  const statements=sqls.map((sql,index)=>({sql,values:[],elapsedMs:index}));
  const seen:string[]=[];
  const result=await inspectPerfScenario('handled',statements,sql=>sql==='SELECT page',async(_label,statement)=>{
    seen.push(statement.sql);
    if(statement.sql==='SELECT schema')throw Error('explain failed');
    if(statement.sql==='SELECT proof')return {text:'',root:{Plan:{'Node Type':'Result'},JIT:{Functions:1}}};
    if(statement.sql==='SELECT hydration')return {text:'',root:{Plan:{'Node Type':'Nested Loop',Plans:[{'Node Type':'Seq Scan','Relation Name':'ticket','Actual Loops':2}]}}};
    return {text:'primary plan',root:{Plan:{'Node Type':'Result'}}};
  });
  assert.deepEqual(seen,['SELECT page','SELECT hydration','SELECT proof','SELECT schema']);
  assert.equal(result.primaryText,'primary plan');
  assert.equal(result.failures.length,3);
  assert.match(result.failures.join(' '),/stmt-03.*SEQ_SCAN_TICKET_REPEATED.*stmt-05.*JIT_USED.*stmt-06.*explain failed/u);
  assert.match(result.dominant?.label??'',/stmt-06 SELECT schema/u);
});

test('42A rejects an empty middle request even when the preceding page was full',async()=>{
  let calls=0;
  const run=await measurePerfScenario('search_text_recent',0,3,50,async()=>({count:++calls===2?0:50}),()=>{});
  assert.match(run.error??'',/ROW_COUNT:expected=50:actual=0/u);assert.equal(run.stats,null);assert.equal(calls,2);
});

test('42A failed informational requests and absent primary plans leave existing evidence intact',async t=>{
  const root=mkdtempSync(path.join(tmpdir(),'42a-evidence-'));t.after(()=>rmSync(root,{force:true,recursive:true}));
  const dir=path.join(root,'published');mkdirSync(dir);
  const previous='existing evidence\n',last='42a-explain-search-text-all.txt';
  for(const file of ['42a-perf-board.txt',last])writeFileSync(path.join(dir,file),previous);
  const plans=['pending','active','handled','handled-all','handled-page2','item','search','search-text','search-text-all']
    .map(file=>({file,scenario:file,text:'Result',complete:true}));
  for(const change of [{complete:false,text:'Result'},{complete:true,text:undefined},{complete:true,text:''}]){
    assert.throws(()=>publishPerfEvidence(dir,'new','18',plans.map(p=>p.file==='search-text-all'?{...p,...change}:p)),/INCOMPLETE_EVIDENCE/u);
    assert.deepEqual(readdirSync(dir).sort(),[last,'42a-perf-board.txt'].sort());
    for(const file of readdirSync(dir))assert.equal(readFileSync(path.join(dir,file),'utf8'),previous);
  }
  const invalid=await inspectPerfScenario('search_text_all',[{sql:'primary',values:[],elapsedMs:1}],()=>true,
    async()=>({text:'not a plan',root:{}}));
  assert.equal(invalid.primaryText,undefined);assert.equal(invalid.explainErrors.length,1);
  publishPerfEvidence(dir,'complete','18',plans);assert.equal(readdirSync(dir).length,10);
  assert.equal(readFileSync(path.join(dir,'42a-perf-board.txt'),'utf8'),'-- run_id='+checkEvidenceGeneration(dir)+'\ncomplete\n');
});

test('42A evidence survives each interrupted rename and a retry removes only its stale temps',async t=>{
  const root=mkdtempSync(path.join(tmpdir(),'42a-publish-'));
  t.after(()=>rmSync(root,{force:true,recursive:true}));
  const keys=['pending','active','handled','handled-all','handled-page2','item','search','search-text','search-text-all'];
  const names=[...keys.map(key=>'42a-explain-'+key+'.txt'),'42a-perf-board.txt'];
  const publish=(dir:string,label:string)=>publishPerfEvidence(dir,label,'18',
    keys.map(file=>({file,scenario:file,complete:true,text:label+' plan '+file})));
  const originalRename=fs.renameSync;
  for(let cut=0;cut<=names.length;cut++){
    const dir=path.join(root,String(cut));
    const oldId=publish(dir,'old');
    const unrelated=['README.md','.notes.tmp','.42a-explain-item.txt.notes.tmp','.42a-explain-other.txt.'+oldId+'.tmp'];
    for(const name of unrelated)writeFileSync(path.join(dir,name),'keep');
    const orphan='.42a-explain-item.txt.'+oldId+'.tmp';
    writeFileSync(path.join(dir,orphan),'orphan');
    let renamed=0;
    const fault=t.mock.method(fs,'renameSync',(src:fs.PathLike,dst:fs.PathLike)=>{
      if(cut===0)throw Error('interrupted');
      originalRename(src,dst);
      if(++renamed===cut)throw Error('interrupted');
    });
    try{assert.throws(()=>publish(dir,'interrupted'),/interrupted/u);}finally{fault.mock.restore();}
    assert.equal(renamed,cut);
    assert.ok(!readdirSync(dir).includes(orphan));
    const remaining=readdirSync(dir).filter(name=>name.endsWith('.tmp')&&!unrelated.includes(name));
    assert.equal(remaining.length,names.length-cut);
    for(const [index,name] of names.entries()){
      const bytes=readFileSync(path.join(dir,name),'utf8');
      const label=index<cut?'interrupted':'old';
      const key=keys[index];
      const body=key?'-- scenario '+key+'; EXPLAIN (ANALYZE, BUFFERS) of the exact statement it sent; 18\n'+label+' plan '+key+'\n':label+'\n';
      assert.equal(bytes.slice(bytes.indexOf('\n')+1),body);
      assert.equal(bytes.startsWith('-- run_id='+oldId+'\n'),index>=cut);
    }
    if(cut===0)assert.equal(checkEvidenceGeneration(dir),oldId);
    else if(cut===names.length)assert.notEqual(checkEvidenceGeneration(dir),oldId);
    else await assert.rejects(runPerfBoard(['--check-evidence',dir]),/PERF_BOARD_EVIDENCE_MIXED_GENERATION/u);

    const retryId=publish(dir,'retry');
    assert.notEqual(retryId,oldId);
    for(const name of names)assert.ok(readFileSync(path.join(dir,name),'utf8').startsWith('-- run_id='+retryId+'\n'));
    assert.deepEqual(readdirSync(dir).sort(),[...names,...unrelated].sort());
    for(const name of unrelated)assert.equal(readFileSync(path.join(dir,name),'utf8'),'keep');
  }
});

test('42A evidence check distinguishes historical, partly tagged and incomplete sets',async t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'42a-headers-'));
  t.after(()=>rmSync(dir,{force:true,recursive:true}));
  const keys=['pending','active','handled','handled-all','handled-page2','item','search','search-text','search-text-all'];
  const plans=keys.map(file=>({file,scenario:file,complete:true,text:'Result'}));
  const id=publishPerfEvidence(dir,'summary','18',plans);
  const output=t.mock.method(console,'log',()=>{});
  await runPerfBoard(['--check-evidence',dir]);
  assert.deepEqual(output.mock.calls[0]?.arguments,['PERF_BOARD_EVIDENCE_VERIFIED run_id='+id]);
  for(const name of readdirSync(dir))writeFileSync(path.join(dir,name),'historical evidence\n');
  assert.throws(()=>checkEvidenceGeneration(dir),/PERF_BOARD_EVIDENCE_RUN_ID_MISSING/u);
  writeFileSync(path.join(dir,'42a-perf-board.txt'),'-- run_id='+id+'\nsummary\n');
  assert.throws(()=>checkEvidenceGeneration(dir),/PERF_BOARD_EVIDENCE_MIXED_GENERATION/u);
  rmSync(path.join(dir,'42a-explain-active.txt'));
  assert.throws(()=>checkEvidenceGeneration(dir),/PERF_BOARD_INCOMPLETE_EVIDENCE:42a-explain-active.txt/u);
  assert.notEqual(publishPerfEvidence(dir,'retry','18',plans),id);
});

test('42A dominant SQL excerpts end cleanly when truncation lands on a space',async()=>{
  const sql='SELECT '+'x'.repeat(88)+' FROM fixture';
  assert.equal(sql[95],' ');
  const result=await inspectPerfScenario('item',[{sql,values:[],elapsedMs:1}],()=>true,async()=>({text:'plan',root:{Plan:{'Node Type':'Result'}}}));
  assert.deepEqual(result.failures,[]);assert.ok(result.dominant);
  assert.equal(result.dominant.label,result.dominant.label.trimEnd());
});

test('42A role CLI exits 1 for apply when a database override keeps JIT on',()=>{
  // Only the DB transport is synthetic. Run the built CLI, its catalog checks and its JSON/exit protocol.
  const driver=import.meta.resolve('pg');
  const preload=`import pg from ${JSON.stringify(driver)};
    let globalJit=process.env.WIDE,changes=0;
    pg.Pool.prototype.query=async function(sql) {
      if(sql.startsWith('ALTER ROLE')) {
        changes++;globalJit=sql.includes('RESET')?'':'off';
        return {rows:[]};
      }
      if(!sql.includes('pg_db_role_setting')) throw Error('unexpected query');
      return {rows:[{exists:true,setconfig:globalJit?['jit='+globalJit]:[],database_config:process.env.OVERRIDE?['jit='+process.env.OVERRIDE]:[]}]};
    };
    pg.Pool.prototype.end=async()=>{if(changes!==Number(process.env.CHANGES))throw Error('unexpected ALTER ROLE count: '+changes);};`;
  const cli=fileURLToPath(new URL('../app/server/scripts/db-role-settings.mjs',import.meta.url));
  for(const [mode,wide,override,changes,code,status,ok] of [
    ['apply','','on',1,1,'PENDING',false],['apply','','',1,0,'APPLIED',true],['check','','on',0,0,'PENDING',false],['reset','','on',1,0,'RESET',false],
    ['apply','on','off',1,0,'APPLIED',true],['apply','off','off',0,0,'NOOP_ALREADY_APPLIED',true],['apply','off','on',0,1,'PENDING',false],
    ['check','on','off',0,0,'READY',true],
    ['apply','FaLsE','0',0,0,'NOOP_ALREADY_APPLIED',true],['apply','no','of',0,0,'NOOP_ALREADY_APPLIED',true],
    ['apply','f','1',0,1,'PENDING',false],['apply','o','no',1,0,'APPLIED',true],
  ] as const) {
    const result=spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(preload),cli,'--role','ticket_fixture','--'+mode],
      {encoding:'utf8',env:{...process.env,PILOT_DATABASE_URL:'postgresql://localhost/unused',WIDE:wide,OVERRIDE:override,CHANGES:String(changes)}});
    assert.equal(result.status,code,result.stderr);
    const output=JSON.parse(result.stdout);
    assert.equal(output.status,status);assert.equal(output.ok,ok);
  }
});
