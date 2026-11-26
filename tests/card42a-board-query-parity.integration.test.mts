import assert from 'node:assert/strict';
import {spyPool,fullTicketCardSql,isFullCardProjection} from './helpers/card42a-sql-observer.mjs';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withWeb01Fixture, seedCard28Board, seedWeb01NoConversationIntake} from './helpers/web01-workbench-fixture.mjs';
import {createWeb01WorkbenchQuery} from '../app/server/src/web01-workbench-query.mjs';
import {createPerfBoardReads,PERF_BOARD_READ_LIMITS,perfReadCount} from '../app/server/scripts/perf-board.mjs';
import {createWorkbenchSearch} from '../app/server/src/workbench-search.mjs';
import {createWorkbenchFollow} from '../app/server/src/workbench-follow.mjs';
import {createWorkbenchReminders} from '../app/server/src/workbench-reminders.mjs';
import {createWorkbenchSourceGroups} from '../app/server/src/workbench-source-groups.mjs';
import {createWorkbenchFollowUpSchedules} from '../app/server/src/workbench-follow-up-schedules.mjs';
import {migrateWorkbenchFollowUpSchedules} from '../app/server/scripts/workbench-follow-up-schedules-migrate.mjs';
import {migrateWorkbenchFollowUpDueSignals} from '../app/server/scripts/workbench-follow-up-due-migrate.mjs';
import {migrateWorkbenchPersonalRead} from '../app/server/scripts/workbench-personal-read-migrate.mjs';
import {migrateWorkbenchFollow} from '../app/server/scripts/workbench-follow-migrate.mjs';
import {migrateWorkbenchSupplementFollowUp} from '../app/server/scripts/workbench-supplement-follow-up-migrate.mjs';
import {createWorkbenchSupplementFollowUp} from '../app/server/src/workbench-supplement-follow-up.mjs';
import {createP2016TicketQuery} from '../app/server/src/p2-016-ticket-query.mjs';
import {createPilotWorkbenchAuthorizationAdapter} from '../app/server/src/p2-006-workbench-authorization.mjs';
import {createP2016ManualReviewFacade} from '../app/server/src/p2-016-manual-review-facade.mjs';
import {loadServiceCatalog} from '../app/server/src/p2-007-service-catalog.mjs';
import {createPilotTicketCore} from '../app/server/src/p1-005-pilot-ticket-core.mjs';
import {createTicketActionService} from '../app/server/src/p1-006-ticket-state-actions.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {assertLocalDateTime} from '../app/server/src/platform/time-contract.mjs';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import type {P2016EnabledRuntime} from '../app/server/src/p2-016-runtime.mjs';
import type {BoardColumn, BoardCompletionRange, BoardPage, WorkbenchCard} from '../contracts/web01_workbench_contracts.js';
import type {WorkbenchSearchCriteria, WorkbenchSearchPage} from '../contracts/workbench_search_contracts.js';
// Pre-42A stack: verbatim copies of the main 5bc972fb modules (see tests/fixtures/card42a-legacy/).
import {createP2016ManualReviewFacade as createLegacyReviewFacade} from './fixtures/card42a-legacy/p2-016-manual-review-facade.mjs';
import {createWeb01WorkbenchQuery as createLegacyWorkbenchQuery} from './fixtures/card42a-legacy/web01-workbench-query.mjs';
import {createWorkbenchSearch as createLegacyWorkbenchSearch} from './fixtures/card42a-legacy/workbench-search.mjs';
import {createWorkbenchFollow as createLegacyWorkbenchFollow} from './fixtures/card42a-legacy/workbench-follow.mjs';
import {createWorkbenchReminders as createLegacyWorkbenchReminders} from './fixtures/card42a-legacy/workbench-reminders.mjs';
import {createWorkbenchSourceGroups as createLegacyWorkbenchSourceGroups} from './fixtures/card42a-legacy/workbench-source-groups.mjs';
import {createWorkbenchSupplementFollowUp as createLegacyWorkbenchSupplementFollowUp} from './fixtures/card42a-legacy/workbench-supplement-follow-up.mjs';

interface Web01Context {
  processReviewIntake:(id:string)=>Promise<unknown>;
  pool: PostgresPool;
  databaseUrl: string;
  tickets: {ticket: {id: string; ticket_no: string; status: string}; intake: {intakeId: string; receivedAt: string}}[];
  principals: {id: string; display_name: string}[];
  outsider: {id: string};
  runtime: P2016EnabledRuntime;
}

function createAuth(principalId: string) {
  return {
    principal_id: principalId,
    auth_method: 'TEST',
    csrf_token: 'parity-csrf-token-0123456789',
    expires_epoch_ms: String(Date.now() + 3_600_000),
  };
}

test('Card 42A parity: board list/item, multi-page cursors, follow, reminders, search, and single card query execution match legacy SQL', {timeout: 180000}, async () => {
  await withWeb01Fixture(async (f: Web01Context) => {
    assert.match(new URL(f.databaseUrl).pathname,/^\/ticket_card42a_web01_/u);
    // Same order as T41: the follow receipt inventory is only current after the closure-chain migrations.
    await migrateWorkbenchPersonalRead({databaseUrl: f.databaseUrl, mode: 'apply'});
    await migrateWorkbenchFollow({databaseUrl: f.databaseUrl, mode: 'apply'});
    await migrateWorkbenchSupplementFollowUp({databaseUrl: f.databaseUrl, mode: 'apply'});
    await migrateWorkbenchFollowUpSchedules({databaseUrl: f.databaseUrl, mode: 'apply'});
    await migrateWorkbenchFollowUpDueSignals({databaseUrl: f.databaseUrl, mode: 'apply'});
    const seeded = await seedCard28Board(f);
    const fixtureTicketIds=f.tickets.map(({ticket})=>ticket.id);
    const inconsistent=await f.pool.query(`SELECT t.id FROM pilot_ticket.ticket t
      LEFT JOIN LATERAL (SELECT e.event_id,e.created_at FROM pilot_ticket.ticket_event e
        WHERE e.ticket_id=t.id AND e.new_status=t.status AND e.old_status IS DISTINCT FROM e.new_status
          AND e.event_type IN ('ticket.resolved','ticket.completed','ticket.dismissed')
        ORDER BY e.aggregate_version DESC,e.event_ordinal DESC LIMIT 1) last_event ON true
      LEFT JOIN pilot_ticket.closure_record c ON c.ticket_id=t.id AND c.restored_at IS NULL
      WHERE t.id=ANY($1::uuid[]) AND t.status IN ('RESOLVED','COMPLETED','DISMISSED')
        AND (t.terminal_at IS DISTINCT FROM last_event.created_at
          OR t.terminal_epoch_ms IS DISTINCT FROM floor(extract(epoch FROM (last_event.created_at AT TIME ZONE 'Asia/Shanghai'))*1000)::bigint
          OR (t.status='DISMISSED' AND c.ended_at IS DISTINCT FROM t.terminal_at))`,[fixtureTicketIds]);
    assert.deepEqual(inconsistent.rows,[],'Card 27/28 adjustments preserve the terminal event, pair and active dismissal time');
    const adminId = f.principals[0]?.id;
    const handlerId = f.principals[1]?.id;
    assert.ok(adminId && handlerId);

    // Add a reopened ticket and a follow-pinned item to cover every union branch and scope
    const core = createPilotTicketCore({pool: f.pool});
    const access = createPilotAccessService({pool: f.pool});
    const actions = createTicketActionService({pool: f.pool, authorize: access.authorizeAction});
    const extraIntake = await seedWeb01NoConversationIntake({pool: f.pool, text: '对拍重开工单（合成）', location: '住院部三楼（合成）'});
    const extraTicket = (await core.createForIntake({intakeId: extraIntake.intakeId, occurredAt: assertLocalDateTime(extraIntake.receivedAt), traceId: '42a-parity-reopen'})).ticket;
    assert.ok(extraTicket);
    // Every setup action must succeed and the ticket must end REOPENED (Codex 42A r1): reopen needs an ADMIN/DISPATCHER.
    for (const [action, actorId, expectedVersion, reasonCode] of [
      ['accept', handlerId, 1, 'ACCEPT'],
      ['start', handlerId, 2, 'START'],
      ['resolve', handlerId, 3, 'SOLVED'],
      ['reopen', adminId, 4, 'REOPEN'],
    ] as const) {
      const performed = await actions.perform({ticketId: extraTicket.id, action, actor: {type: 'PILOT_USER', id: actorId}, expectedVersion, traceId: '42a-' + action, reasonCode});
      assert.equal(performed.ok, true, `parity setup ${action} must succeed: ${JSON.stringify(performed)}`);
    }
    const reopenedStatus = (await f.pool.query<{status: string; terminal_at: string | null}>(
      'SELECT status, terminal_at::text FROM pilot_ticket.ticket WHERE id=$1::uuid', [extraTicket.id],
    )).rows[0];
    assert.deepEqual(reopenedStatus, {status: 'REOPENED', terminal_at: null});

    // The manual-review fixture already produces an unlinked pending Review through the real orchestrator.
    const pendingReviewRow = (await f.pool.query<{id: string}>(
      `SELECT id::text FROM intake.manual_review_item WHERE status='PENDING' ORDER BY created_at,id LIMIT 1`,
    )).rows[0];
    assert.ok(pendingReviewRow, 'manual-review fixture must provide a pending Review（合成）');

    // Explicit follow on a ticket for admin
    const followedTicket = f.tickets[2]?.ticket;
    assert.ok(followedTicket);
    await f.pool.query(
      `INSERT INTO pilot_ticket.workbench_item_follow(principal_id, source_intake_id, following)
       SELECT $1::uuid, source_intake_id, true FROM pilot_ticket.ticket WHERE id=$2::uuid
       ON CONFLICT(principal_id, source_intake_id) DO UPDATE SET following=true`,
      [adminId, followedTicket.id],
    );

    const catalog = await loadServiceCatalog();
    let beforeCardRead:((sql:string)=>Promise<void>|undefined)|undefined;
    const spy = spyPool(f.pool,sql=>beforeCardRead?.(sql));
    function ticketReads(pool:PostgresPool,createReviews:typeof createP2016ManualReviewFacade) {
      const authorization=createPilotWorkbenchAuthorizationAdapter({pool});
      const query=createP2016TicketQuery({pool,enabled:true,authorization,ticketStaffCompletionEnabled:true,ticketReopenRoundsEnabled:true});
      return {query,reviews:createReviews({pool,query,enabled:true}),
        schedules:createWorkbenchFollowUpSchedules({pool,query,enabled:true})};
    }
    const {query:ticketQuery,reviews,schedules:followUpSchedules}=ticketReads(spy.pool,createP2016ManualReviewFacade);
    const legacy=ticketReads(f.pool,createLegacyReviewFacade);
    const sourceGroups=createWorkbenchSourceGroups({pool:spy.pool,query:ticketQuery});
    const supplementFollowUp=createWorkbenchSupplementFollowUp({pool:spy.pool,query:ticketQuery,enabled:true});
    const follow=createWorkbenchFollow({pool:spy.pool,query:ticketQuery,reviews,manualReviewEnabled:true,manualReportsEnabled:false,enabled:true});

    const newQuery = createWeb01WorkbenchQuery({
      pool: spy.pool,
      query: ticketQuery,
      sourceGroups,
      workbenchFollowEnabled: true,
      follow,
      followUpSchedules,
      manualReviewEnabled: true,
      manualReportsEnabled: false,
      reviews,
      supplementFollowUp,
      serviceCatalog: catalog,
    });
    const legacySourceGroups = createLegacyWorkbenchSourceGroups({pool: f.pool, query: legacy.query});
    const legacySupplementFollowUp = createLegacyWorkbenchSupplementFollowUp({pool: f.pool, query: legacy.query, enabled: true});
    const legacyFollow = createLegacyWorkbenchFollow({pool: f.pool, query: legacy.query, reviews:legacy.reviews, manualReviewEnabled: true, manualReportsEnabled: false, enabled: true});
    const legacyQuery = createLegacyWorkbenchQuery({
      pool: f.pool,
      query: legacy.query,
      sourceGroups: legacySourceGroups,
      workbenchFollowEnabled: true,
      follow: legacyFollow,
      followUpSchedules:legacy.schedules,
      manualReviewEnabled: true,
      manualReportsEnabled: false,
      reviews:legacy.reviews,
      supplementFollowUp: legacySupplementFollowUp,
      serviceCatalog: catalog,
    });

    const newSearch = createWorkbenchSearch({
      pool: spy.pool,
      query: ticketQuery,
      cards: newQuery,
      enabled: true,
      localTestProfile: true,
      features: {follow: true, supplements: true, schedules: true, manual: false, manualReview: true, sourceGroups: true},
    });
    const legacySearch = createLegacyWorkbenchSearch({
      pool: f.pool,
      query: legacy.query,
      cards: legacyQuery,
      enabled: true,
      localTestProfile: true,
      features: {follow: true, supplements: true, schedules: true, manual: false, manualReview: true, sourceGroups: true},
    });

    const adminAuth = createAuth(adminId);
    const handlerAuth = createAuth(handlerId);
    const outsiderAuth = createAuth(f.outsider.id);

    // Exercise the assembled human-role decorators through their normal entry points at two page sizes.
    const human=createPerfBoardReads(spy.pool,catalog);
    for(const limit of ['1','50']){
      spy.queries.length=0;
      const page=await human.web01.list({authContext:adminAuth,column:'active',range:'recent',cursor:null,limit});
      assert.ok(page.items.length>0);assert.ok(page.items.every(item=>Object.hasOwn(item,'supplement_follow_up')));
      const manualRead=Number(page.items.some(item=>item.source==='MANUAL'));
      assert.ok(perfReadCount(spy.queries)<=PERF_BOARD_READ_LIMITS.page+manualRead,`assembled board limit=${limit}: ${spy.queries.length} reads`);
      assert.equal(spy.queries.filter(sql=>sql.includes('summary.pending AS has_pending_supplements')).length,1);
    }
    spy.queries.length=0;
    const single=await human.web01.authorizedItem(adminAuth,'ticket',extraTicket.id);
    assert.ok(Object.hasOwn(single,'supplement_follow_up'));
    assert.ok(perfReadCount(spy.queries)<=PERF_BOARD_READ_LIMITS.item);

    // 1. Compare paginated list() across all columns, ranges, scopes, and personas + single-execution count
    const listCombos: {auth: ReturnType<typeof createAuth>; column: BoardColumn; range: BoardCompletionRange; scope: 'team' | 'related'; handledFrom?: string; handledTo?: string}[] = [
      {auth: adminAuth, column: 'pending', range: 'recent', scope: 'team'},
      {auth: adminAuth, column: 'active', range: 'recent', scope: 'team'},
      {auth: adminAuth, column: 'handled', range: 'recent', scope: 'team'},
      {auth: adminAuth, column: 'handled', range: 'all', scope: 'team'},
      {auth: adminAuth, column: 'handled', range: 'custom', scope: 'team', handledFrom: seeded.yesterday, handledTo: seeded.yesterday},
      {auth: adminAuth, column: 'pending', range: 'recent', scope: 'related'},
      {auth: adminAuth, column: 'handled', range: 'all', scope: 'related'},
      {auth: handlerAuth, column: 'pending', range: 'recent', scope: 'team'},
      {auth: handlerAuth, column: 'handled', range: 'recent', scope: 'team'},
      {auth: handlerAuth, column: 'handled', range: 'all', scope: 'related'},
      {auth: outsiderAuth, column: 'pending', range: 'recent', scope: 'team'},
    ];

    for (const combo of listCombos) {
      let newCursor: string | null = null;
      let oldCursor: string | null = null;
      const newAll: WorkbenchCard[] = [];
      const oldAll: WorkbenchCard[] = [];
      let pageIndex = 0;
      do {
        spy.queries.length = 0;
        const newPage: BoardPage = await newQuery.list({
          authContext: combo.auth,
          column: combo.column,
          range: combo.range,
          scope: combo.scope,
          handledFrom: combo.handledFrom ?? null,
          handledTo: combo.handledTo ?? null,
          cursor: newCursor,
          limit: '3',
        });
        const oldPage: BoardPage = await legacyQuery.list({
          authContext: combo.auth,
          column: combo.column,
          range: combo.range,
          scope: combo.scope,
          handledFrom: combo.handledFrom ?? null,
          handledTo: combo.handledTo ?? null,
          cursor: oldCursor,
          limit: '3',
        });

        const pageKeyQueries = spy.queries.filter(q => q.includes('page_keys AS ('));
        assert.equal(pageKeyQueries.length, 1, `list(${combo.column}/${combo.scope}) p${pageIndex} must execute 1 page_keys query`);
        assert.equal(spy.queries.some(q => q.includes('WITH cards AS')), false, 'new list() must not execute legacy full WITH cards scan');

        assert.deepEqual(newPage.items, oldPage.items, `items mismatch on ${combo.column}/${combo.range}/${combo.scope} page ${pageIndex}`);
        assert.deepEqual(newPage.group_counts, oldPage.group_counts, `group_counts mismatch on ${combo.column}/${combo.range}/${combo.scope}`);
        assert.deepEqual(newPage.range, oldPage.range);
        assert.equal(Boolean(newPage.next_cursor), Boolean(oldPage.next_cursor), `hasMore mismatch on ${combo.column} page ${pageIndex}`);
        // 42A-5: the external cursor encoding is unchanged byte for byte.
        assert.equal(newPage.next_cursor, oldPage.next_cursor, `cursor encoding mismatch on ${combo.column}/${combo.range}/${combo.scope} page ${pageIndex}`);

        // Bidirectional cursor compatibility on first transition
        if (pageIndex === 0 && newPage.next_cursor && oldPage.next_cursor) {
          const newFromOldCursor = await newQuery.list({
            authContext: combo.auth, column: combo.column, range: combo.range, scope: combo.scope,
            handledFrom: combo.handledFrom ?? null, handledTo: combo.handledTo ?? null,
            cursor: oldPage.next_cursor, limit: '3',
          });
          const oldFromNewCursor = await legacyQuery.list({
            authContext: combo.auth, column: combo.column, range: combo.range, scope: combo.scope,
            handledFrom: combo.handledFrom ?? null, handledTo: combo.handledTo ?? null,
            cursor: newPage.next_cursor, limit: '3',
          });
          assert.deepEqual(newFromOldCursor.items, oldFromNewCursor.items, 'cross-version cursors must return identical next page');
        }

        newAll.push(...newPage.items);
        oldAll.push(...oldPage.items);
        newCursor = newPage.next_cursor;
        oldCursor = oldPage.next_cursor;
        pageIndex++;
      } while (newCursor !== null || oldCursor !== null);
      assert.deepEqual(newAll, oldAll);
    }

    // 2. Compare authorizedItem across ticket, review, open intake, closed intake & outsider denial
    const closedIntakeRow = (await f.pool.query<{id: string}>(
      `SELECT id::text FROM intake.service_intake WHERE status='COMPLETED' AND pilot_ticket_id IS NULL LIMIT 1`,
    )).rows[0];
    assert.ok(closedIntakeRow);

    for (const [kind, id] of [
      ['ticket', extraTicket.id],
      ['ticket', seeded.manual],
      ['review', pendingReviewRow.id],
      ['intake', seeded.failedIntake],
      ['intake', closedIntakeRow.id],
    ] as const) {
      spy.queries.length=0;
      const [newItem, oldItem] = await Promise.all([
        newQuery.authorizedItem(adminAuth, kind, id),
        legacyQuery.authorizedItem(adminAuth, kind, id),
      ]);
      assert.deepEqual(newItem, oldItem, `authorizedItem parity failed for ${kind}:${id}`);
      assert.equal(spy.queries.filter(isFullCardProjection).length,1,`item ${kind}:${id}`);
      spy.queries.length=0;
      const input={authContext:adminAuth,kind,id,cursor:null,limit:20};
      const current=await newQuery.detail(input);
      assert.equal(JSON.stringify(current),JSON.stringify(await legacyQuery.detail(input)),`detail bytes ${kind}:${id}`);
      assert.equal(spy.queries.filter(isFullCardProjection).length,1,`detail ${kind}:${id}`);
    }
    await assert.rejects(newQuery.authorizedItem(outsiderAuth, 'ticket', extraTicket.id), /NOT_FOUND/u);
    await assert.rejects(legacyQuery.authorizedItem(outsiderAuth, 'ticket', extraTicket.id), /NOT_FOUND/u);

    spy.queries.length=0;
    const detailInput={authContext:adminAuth,kind:'ticket',id:extraTicket.id,cursor:null,limit:20};
    const detail=await newQuery.detail(detailInput);
    const legacyDetail=await legacyQuery.detail(detailInput);
    assert.deepEqual(detail,legacyDetail);
    assert.equal(JSON.stringify(detail),JSON.stringify(legacyDetail),'detail JSON bytes match main');

    assert.equal(spy.queries.filter(sql=>fullTicketCardSql.test(sql)).length,1,'Follow-enabled detail hydrates the ticket once');
    assert.ok(spy.queries.filter(sql=>sql.includes('SELECT i.id::text,COALESCE(f.following')).length>=2,
      'the recorder observes Follow attention and the final Follow READ');

    // 3. Follow attentionMany parity
    const samplePage = await newQuery.list({authContext: adminAuth, column: 'pending', range: 'recent', scope: 'team', cursor: null, limit: '10'});
    const [newAttn, oldAttn] = await Promise.all([
      follow.attentionMany(adminAuth, samplePage.items),
      legacyFollow.attentionMany(adminAuth, samplePage.items),
    ]);
    assert.deepEqual(newAttn, oldAttn);

    // 4. Reminders parity. The admin follows the extra ticket, which is resolved before both baselines and
    // reopened after them; the runtime's own realtime projector publishes the ticket events. The increment
    // must contain that RELATED_REOPEN fact, so the comparison cannot pass on two empty pages.
    // Actions publish their ticket events through the runtime's own realtime projector, as the HTTP handlers do.
    const projectedActions = createTicketActionService({pool: f.pool, authorize: access.authorizeAction,
      afterAction: async ({transaction, ticket, event}) => f.runtime.realtimeProjector.ticket({transaction, ticket, event})});
    const reminders = createWorkbenchReminders({pool: spy.pool, query: ticketQuery, enabled: true, followEnabled: true});
    const legacyReminders = createLegacyWorkbenchReminders({pool: f.pool, query: legacy.query, enabled: true, followEnabled: true});
    await f.pool.query(`INSERT INTO pilot_ticket.workbench_item_follow(principal_id, source_intake_id, following)
       SELECT $1::uuid, source_intake_id, true FROM pilot_ticket.ticket WHERE id=$2::uuid
       ON CONFLICT(principal_id, source_intake_id) DO UPDATE SET following=true`, [adminId, extraTicket.id]);
    const currentVersion = async () => {
      const row = (await f.pool.query<{version: number}>('SELECT version FROM pilot_ticket.ticket WHERE id=$1::uuid', [extraTicket.id])).rows[0];
      assert.ok(row);
      return row.version;
    };
    for (const [action, actorId, reasonCode] of [['start', handlerId, 'START'], ['resolve', handlerId, 'SOLVED']] as const) {
      const performed = await projectedActions.perform({ticketId: extraTicket.id, action, actor: {type: 'PILOT_USER', id: actorId}, expectedVersion: await currentVersion(), traceId: '42a-rem-' + action, reasonCode});
      assert.equal(performed.ok, true, `reminder setup ${action} must succeed: ${JSON.stringify(performed)}`);
    }
    // The signed baseline token embeds the request instant ("f") and its wall-clock expiry ("e"), which
    // legitimately differ per call; the token's scope and event watermark, and the rest of the page, must match.
    const tokenBody = (token: string) => {
      const payload: unknown = JSON.parse(Buffer.from(token.split('_')[0] ?? '', 'base64url').toString('utf8'));
      assert.ok(payload !== null && typeof payload === 'object' && !Array.isArray(payload));
      return Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'f' && key !== 'e'));
    };
    const baseline = await reminders.page({authContext: adminAuth, parameters: new URLSearchParams({limit: '10'})});
    const legacyBaseline = await legacyReminders.page({authContext: adminAuth, parameters: new URLSearchParams({limit: '10'})});
    assert.deepEqual({...baseline, baseline_token: tokenBody(baseline.baseline_token)}, {...legacyBaseline, baseline_token: tokenBody(legacyBaseline.baseline_token)}, 'reminder baseline page must match legacy');
    assert.equal(baseline.reset_required, false);
    // Same-second facts are history by design; step past the baseline second before reopening.
    await f.pool.query('SELECT pg_sleep((1000 - platform.physical_epoch_ms() % 1000 + 30) / 1000.0)');
    const reopened = await projectedActions.perform({ticketId: extraTicket.id, action: 'reopen', actor: {type: 'PILOT_USER', id: adminId}, expectedVersion: await currentVersion(), traceId: '42a-rem-reopen', reasonCode: 'REOPEN'});
    assert.equal(reopened.ok, true, JSON.stringify(reopened));
    const after = (page: typeof baseline) => new URLSearchParams({limit: '10', after_event_id: page.as_of_event_id, baseline_token: page.baseline_token});
    const increment = await reminders.page({authContext: adminAuth, parameters: after(baseline)});
    const legacyIncrement = await legacyReminders.page({authContext: adminAuth, parameters: after(legacyBaseline)});
    assert.equal(increment.reset_required, false);
    const published = (await f.pool.query<{events: string}>(`SELECT jsonb_agg(jsonb_build_object('id',event_id,'type',event_type,'src',source_type,'agg',aggregate_type))::text AS events
      FROM conversation.realtime_event WHERE aggregate_id=$1 AND event_id>$2::bigint`, [extraTicket.id, baseline.as_of_event_id])).rows[0]?.events;
    assert.ok(increment.items.some(item => item.reason === 'RELATED_REOPEN' && item.canonical_item.id === extraTicket.id),
      JSON.stringify({new: increment.items, legacy: legacyIncrement.items, published, baseline: baseline.as_of_event_id, high: increment.as_of_event_id}));
    assert.deepEqual(increment.items, legacyIncrement.items, 'reminder items, reasons, order and identities must match legacy');
    assert.equal(increment.as_of_event_id, legacyIncrement.as_of_event_id);
    assert.equal(Boolean(increment.next_cursor), Boolean(legacyIncrement.next_cursor));

    // 5. Search parity across multiple criteria and multi-page pagination
    const fullCriteria = (patch: Partial<WorkbenchSearchCriteria>): WorkbenchSearchCriteria => ({
      q: '', column: 'all', range: 'recent', scope: 'team', responsibility: 'any',
      resolver_team_id: null, assignee_id: null, sources: [], source_group_ref: null,
      statuses: [], supplement: 'any', schedule: 'any', ...patch,
    });
    spy.queries.length=0;
    const humanSearch=await human.search.search({authContext:adminAuth,request:{criteria:fullCriteria({q:extraTicket.ticket_no}),cursor:null,limit:50}});
    assert.ok(humanSearch.items.some(item=>item.id===extraTicket.id));
    assert.ok(perfReadCount(spy.queries)<=PERF_BOARD_READ_LIMITS.search+Number(humanSearch.items.some(item=>item.source==='MANUAL')));
    const searchCases: WorkbenchSearchCriteria[] = [
      fullCriteria({column: 'all', range: 'recent', q: ''}),
      fullCriteria({column: 'pending', range: 'recent', q: '合成'}),
      fullCriteria({column: 'active', range: 'recent', q: ''}),
      fullCriteria({column: 'handled', range: 'recent', q: ''}),
      fullCriteria({column: 'handled', range: 'all', q: '', closure_kind: 'dismissed'}),
      fullCriteria({column: 'handled', range: 'all', q: '', scope: 'related', responsibility: 'following'}),
      fullCriteria({column: 'all', range: 'custom', handled_from: seeded.yesterday, handled_to: seeded.yesterday, q: ''}),
    ];
    for (const criteria of searchCases) {
      let nCursor: string | null = null;
      let oCursor: string | null = null;
      do {
        const [nPage, oPage]: [WorkbenchSearchPage, WorkbenchSearchPage] = await Promise.all([
          newSearch.search({authContext: adminAuth, request: {criteria, cursor: nCursor, limit: 4}}),
          legacySearch.search({authContext: adminAuth, request: {criteria, cursor: oCursor, limit: 4}}),
        ]);
        assert.deepEqual(nPage.items, oPage.items, `search items mismatch for ${JSON.stringify(criteria)}`);
        assert.deepEqual(nPage.range, oPage.range);
        assert.equal(Boolean(nPage.next_cursor), Boolean(oPage.next_cursor));
        // Search cursors are HMAC-signed with a per-instance secret and carry an instance-bound "binding";
        // the position fields (window, at, order_group, kind, id) and the criteria digest must be identical.
        const cursorPosition = (cursor: string | null) => {
          if (cursor === null) return null;
          const payload: unknown = JSON.parse(Buffer.from(cursor.split('.')[0] ?? '', 'base64url').toString('utf8'));
          assert.ok(payload !== null && typeof payload === 'object' && !Array.isArray(payload));
          return Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'binding'));
        };
        assert.deepEqual(cursorPosition(nPage.next_cursor), cursorPosition(oPage.next_cursor), `search cursor position mismatch for ${JSON.stringify(criteria)}`);
        nCursor = nPage.next_cursor;
        oCursor = oPage.next_cursor;
      } while (nCursor !== null || oCursor !== null);
    }
    // This Intake has a readable Ticket, so even the retained closed-Intake path must refuse it.
    for(const reader of [newQuery,legacyQuery]){
      const stale={...detailInput,kind:'intake',id:extraIntake.intakeId};
      for(const request of [()=>reader.authorizedItem(adminAuth,stale.kind,stale.id),()=>reader.detail(stale)]){
        spy.queries.length=0;
        await assert.rejects(request(),{status:404,code:'P2_016_NOT_FOUND'});
        if(reader===newQuery)assert.equal(spy.queries.filter(isFullCardProjection).length,1);
      }
    }

    // Commit the conversion on a separate connection immediately before the first
    // full projection. A reader that already chose a Review key here would miss the Ticket.
    let linked=false;
    beforeCardRead=sql=>{
      if(!isFullCardProjection(sql))return;
      beforeCardRead=undefined;
      return f.pool.query(`UPDATE intake.contact_journey SET linked_ticket_id=$2,status='TICKET_LINKED'
        WHERE id=(SELECT journey_id FROM intake.manual_review_item WHERE id=$1)`,[pendingReviewRow.id,extraTicket.id])
        .then(result=>{assert.equal(result.rowCount,1);linked=true;});
    };
    const aliasInput={...detailInput,kind:'review',id:pendingReviewRow.id};
    spy.queries.length=0;
    const alias=await newQuery.detail(aliasInput);
    assert.ok(linked);
    assert.equal(alias.item.kind,'ticket');assert.equal(alias.item.id,extraTicket.id);
    assert.equal(JSON.stringify(alias),JSON.stringify(await legacyQuery.detail(aliasInput)));
    const projections=spy.queries.filter(isFullCardProjection);
    assert.equal(projections.length,1);
    assert.ok(spy.queries.filter(sql=>sql.includes('SELECT i.id::text,COALESCE(f.following')).length>=2);
    const statement=projections[0];assert.ok(statement);
    // PostgreSQL reports each correlated CASE arm as a SubPlan of the route scan.
    // Check executions, since the SQL text necessarily contains all three alternatives.
    interface ArmPlan {'Parent Relationship':string;'Actual Loops':number}
    const explain=await f.pool.query<{'QUERY PLAN':{Plan:{Alias:string;Plans:ArmPlan[]}}[]}>(
      'EXPLAIN (ANALYZE,FORMAT JSON) '+statement,[adminId,aliasInput.id]);
    const plan=explain.rows[0]?.['QUERY PLAN'][0]?.Plan;assert.ok(plan);
    assert.equal(plan.Alias,'route');
    assert.deepEqual(plan.Plans.filter(node=>node['Parent Relationship']==='SubPlan').map(node=>node['Actual Loops']),[1,0,0],
      'the Review alias executes the Ticket projection once and both other arms zero times');
    spy.queries.length=0;
    assert.deepEqual(await newQuery.authorizedItem(adminAuth,'review',aliasInput.id),await legacyQuery.authorizedItem(adminAuth,'review',aliasInput.id));
    assert.equal(spy.queries.filter(isFullCardProjection).length,1);
    // Change the real grant after scope() and before the atomic Review projection.
    await f.pool.query("UPDATE pilot_ticket.ticket SET assignee_id=NULL,resolver_team_id='PILOT_IT' WHERE id=$1",[extraTicket.id]);
    const removed=await f.pool.query("DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1 AND team_id='PILOT_IT'",[handlerId]);
    assert.equal(removed.rowCount,1);
    const handlerRequest={...aliasInput,authContext:handlerAuth};
    await assert.rejects(newQuery.detail(handlerRequest),{status:404,code:'P2_016_NOT_FOUND'});
    let joined=false;
    beforeCardRead=sql=>{
      if(!isFullCardProjection(sql))return;
      beforeCardRead=undefined;
      return f.pool.query("INSERT INTO pilot_ticket.pilot_team_member(principal_id,team_id) VALUES ($1,'PILOT_IT')",[handlerId]).then(()=>{joined=true;});
    };
    const granted=await newQuery.detail(handlerRequest);
    assert.ok(joined);assert.equal(granted.item.id,extraTicket.id);
    assert.equal(JSON.stringify(granted),JSON.stringify(await legacyQuery.detail(handlerRequest)));

    // The requested Review remains readable via its Journey; a second pending Review
    // on the Ticket's source Intake belongs to a Journey with no readable Ticket.
    const version=(await f.pool.query<{v:string}>('SELECT row_version::text AS v FROM intake.manual_review_item WHERE id=$1',[pendingReviewRow.id])).rows[0];
    assert.ok(version);
    const cancelled=await reviews.resolveManualReview({authContext:adminAuth,reviewId:pendingReviewRow.id,body:{
      client_command_id:randomUUID(),expected_row_version:version.v,resolution_code:'CANCEL_REVIEW',resolution_reason_code:'EXPLICIT_RETIREMENT'}});
    assert.ok(cancelled.ok);
    const hiddenSource=await seedPersistedIntake({pool:f.pool,text:'审核原因仅对有权限的人员可见（合成）',requestType:'INCIDENT',status:'RECEIVED'});
    const assigned=(await core.createForIntake({intakeId:hiddenSource.intakeId,occurredAt:assertLocalDateTime(hiddenSource.receivedAt),traceId:'42a-reason-scope'})).ticket;
    assert.ok(assigned);
    await f.processReviewIntake(hiddenSource.intakeId);
    const isolatedJourney=await f.pool.query("UPDATE intake.contact_journey SET linked_ticket_id=NULL,status='WAITING_REVIEW',ended_at=NULL WHERE origin_intake_id=$1",[hiddenSource.intakeId]);
    assert.equal(isolatedJourney.rowCount,1);
    await f.pool.query('UPDATE pilot_ticket.ticket SET assignee_id=$2 WHERE id=$1',[assigned.id,adminId]);
    await f.pool.query("UPDATE intake.contact_journey SET linked_ticket_id=$2,status='TICKET_LINKED' WHERE id=(SELECT journey_id FROM intake.manual_review_item WHERE id=$1)",[pendingReviewRow.id,assigned.id]);
    const hidden=(await f.pool.query<{id:string;reason:string}>(`SELECT r.id,r.review_reason_code AS reason FROM intake.manual_review_item r
      JOIN intake.contact_journey j ON j.id=r.journey_id WHERE r.service_intake_id=$1 AND r.status='PENDING' AND j.linked_ticket_id IS NULL`,[hiddenSource.intakeId])).rows[0];
    assert.ok(hidden);
    assert.equal((await newQuery.detail(aliasInput)).item.review_reason,hidden.reason);
    let downgraded=false;
    beforeCardRead=sql=>{
      if(!isFullCardProjection(sql))return;
      beforeCardRead=undefined;
      return f.pool.query("UPDATE pilot_ticket.pilot_principal_role SET role='HANDLER' WHERE principal_id=$1 AND role='ADMIN'",[adminId])
        .then(result=>{assert.equal(result.rowCount,1);downgraded=true;});
    };
    const restricted=await newQuery.detail(aliasInput);
    assert.ok(downgraded);assert.equal(restricted.item.id,assigned.id);
    assert.equal(restricted.item.review_reason,null);
    assert.ok(!restricted.review_refs?.some(ref=>ref.id===hidden.id));
    assert.equal(JSON.stringify(restricted),JSON.stringify(await legacyQuery.detail(aliasInput)));

    // Two readable Tickets compete for this Review. Its own Intake belongs to X;
    // the Journey was subsequently linked to Y. Compare independent resolvers.
    const laterSource=await seedWeb01NoConversationIntake({pool:f.pool,text:'复核旅程目标（合成）',location:'一楼（合成）'});
    const journeyTicket=(await core.createForIntake({intakeId:laterSource.intakeId,occurredAt:assertLocalDateTime(laterSource.receivedAt),traceId:'42a-journey-target'})).ticket;
    assert.ok(journeyTicket);assert.notEqual(journeyTicket.id,assigned.id);
    const relinked=await f.pool.query("UPDATE intake.contact_journey SET linked_ticket_id=$2,status='TICKET_LINKED' WHERE id=(SELECT journey_id FROM intake.manual_review_item WHERE id=$1)",[hidden.id,journeyTicket.id]);
    assert.equal(relinked.rowCount,1);
    for(const facade of [reviews,legacy.reviews]){
      assert.deepEqual(await facade.canonicalItem({authContext:handlerAuth,reviewId:hidden.id}),{kind:'ticket',id:journeyTicket.id});
    }
    const competing={...aliasInput,authContext:handlerAuth,id:hidden.id};
    for(const reader of [newQuery,legacyQuery]){
      assert.equal((await reader.authorizedItem(handlerAuth,'ticket',assigned.id)).id,assigned.id);
      assert.equal((await reader.authorizedItem(handlerAuth,'review',hidden.id)).id,journeyTicket.id);
    }
    assert.equal(JSON.stringify(await newQuery.detail(competing)),JSON.stringify(await legacyQuery.detail(competing)));
  }, {namespace: 'ticket_card42a', precisionV212: true, serviceCatalog: loadServiceCatalog(), ticketSelfHandlingEnabled: true, workbenchBoardActionsEnabled: true, workbenchSearchEnabled: true, workbenchFollowEnabled: true, workbenchManualReviewEnabled: true, sourceGroupDirectoryEnabled: true, workbenchRealtimeEnabled: true});
});

test('42A active board preserves revoked page keys ahead of a readable Ticket',async()=>{
  await withWeb01Fixture(async(f:Web01Context)=>{
    const ids=f.tickets.filter(({ticket})=>['IN_PROGRESS','WAITING_VENDOR','WAITING_REQUESTER'].includes(ticket.status)).slice(0,3).map(({ticket})=>ticket.id);
    assert.equal(ids.length,3);
    await f.pool.query("INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES ('R15_A','A（合成）'),('R15_B','B（合成）')");
    const changed=await f.pool.query(`UPDATE pilot_ticket.ticket t SET resolver_team_id=CASE WHEN k.ordinal<=2 THEN 'R15_A' ELSE 'R15_B' END,
      updated_at=platform.local_now()+((3-k.ordinal)*interval '1 second') FROM unnest($1::uuid[]) WITH ORDINALITY k(id,ordinal) WHERE t.id=k.id`,[ids]);
    assert.equal(changed.rowCount,3);
    await f.pool.query("INSERT INTO pilot_ticket.pilot_team_member(principal_id,team_id) VALUES ($1,'R15_B')",[f.outsider.id]);
    const input={authContext:createAuth(f.outsider.id),column:'active',limit:'1',range:'all',cursor:null};
    for(const createReader of [createLegacyWorkbenchQuery,createWeb01WorkbenchQuery]){
      await f.pool.query("INSERT INTO pilot_ticket.pilot_team_member(principal_id,team_id) VALUES ($1,'R15_A')",[f.outsider.id]);
      let revokeTeam:string|null=null;
      const spy=spyPool(f.pool,sql=>{
        if(!revokeTeam||!(sql.includes('FROM page_keys')||sql.includes('ORDER BY order_group DESC,order_at DESC,kind DESC,id DESC LIMIT')))return;
        const team=revokeTeam;revokeTeam=null;
        return f.pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1 AND team_id=$2',[f.outsider.id,team])
          .then(result=>{assert.equal(result.rowCount,1);});
      });
      const reader=createReader({pool:spy.pool,query:createP2016TicketQuery({pool:spy.pool,enabled:true})});
      assert.deepEqual((await reader.list({...input,limit:'3'})).items.map(item=>item.id),ids);
      revokeTeam='R15_B';
      const sentinel=await reader.list({...input,limit:'2'});assert.equal(revokeTeam,null);
      assert.deepEqual(sentinel.items.map(item=>item.id),ids.slice(0,2));assert.ok(sentinel.next_cursor);
      await f.pool.query("INSERT INTO pilot_ticket.pilot_team_member(principal_id,team_id) VALUES ($1,'R15_B')",[f.outsider.id]);
      revokeTeam='R15_A';
      await assert.rejects(reader.list(input),{status:404,code:'P2_016_NOT_FOUND'});assert.equal(revokeTeam,null);
      const fresh=await reader.list(input);assert.deepEqual(fresh.items.map(item=>item.id),[ids[2]]);assert.equal(fresh.next_cursor,null);
    }
  },{namespace:'ticket_card42a'});
});
