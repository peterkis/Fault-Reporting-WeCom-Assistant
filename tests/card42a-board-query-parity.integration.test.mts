import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withWeb01Fixture, seedCard28Board, seedWeb01NoConversationIntake} from './helpers/web01-workbench-fixture.mjs';
import {createWeb01WorkbenchQuery} from '../app/server/src/web01-workbench-query.mjs';
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
import {createWeb01WorkbenchQuery as createLegacyWorkbenchQuery} from './fixtures/card42a-legacy/web01-workbench-query.mjs';
import {createWorkbenchSearch as createLegacyWorkbenchSearch} from './fixtures/card42a-legacy/workbench-search.mjs';
import {createWorkbenchFollow as createLegacyWorkbenchFollow} from './fixtures/card42a-legacy/workbench-follow.mjs';
import {createWorkbenchReminders as createLegacyWorkbenchReminders} from './fixtures/card42a-legacy/workbench-reminders.mjs';
import {createWorkbenchSourceGroups as createLegacyWorkbenchSourceGroups} from './fixtures/card42a-legacy/workbench-source-groups.mjs';
import {createWorkbenchSupplementFollowUp as createLegacyWorkbenchSupplementFollowUp} from './fixtures/card42a-legacy/workbench-supplement-follow-up.mjs';

interface Web01Context {
  pool: PostgresPool;
  databaseUrl: string;
  tickets: {ticket: {id: string; ticket_no: string; status: string}; intake: {intakeId: string; receivedAt: string}}[];
  principals: {id: string; display_name: string}[];
  outsider: {id: string};
  runtime: P2016EnabledRuntime;
}

function spyPool(pool: PostgresPool) {
  const queries: string[] = [];
  const wrapQuery = (target: object, queryFn: (...args: unknown[]) => unknown) => (...args: unknown[]) => {
    const [sql] = args;
    if (typeof sql === 'string') queries.push(sql);
    return Reflect.apply(queryFn, target, args);
  };
  const wrapped = new Proxy(pool, {
    get(target, prop, receiver) {
      if (prop === 'query') return wrapQuery(target, target.query);
      if (prop === 'connect') {
        return async () => {
          const client = await target.connect();
          return new Proxy(client, {
            get(clientTarget, clientProp, clientReceiver) {
              if (clientProp === 'query') return wrapQuery(clientTarget, clientTarget.query);
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
  return {pool: wrapped, queries};
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
    // Same order as T41: the follow receipt inventory is only current after the closure-chain migrations.
    await migrateWorkbenchPersonalRead({databaseUrl: f.databaseUrl, mode: 'apply'});
    await migrateWorkbenchFollow({databaseUrl: f.databaseUrl, mode: 'apply'});
    await migrateWorkbenchSupplementFollowUp({databaseUrl: f.databaseUrl, mode: 'apply'});
    await migrateWorkbenchFollowUpSchedules({databaseUrl: f.databaseUrl, mode: 'apply'});
    await migrateWorkbenchFollowUpDueSignals({databaseUrl: f.databaseUrl, mode: 'apply'});
    const seeded = await seedCard28Board(f);
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
    const authorization = createPilotWorkbenchAuthorizationAdapter({pool: f.pool});
    const ticketQuery = createP2016TicketQuery({pool: f.pool, enabled: true, authorization, ticketStaffCompletionEnabled: true, ticketReopenRoundsEnabled: true});
    const reviews = createP2016ManualReviewFacade({pool: f.pool, query: ticketQuery, enabled: true});

    const sourceGroups = createWorkbenchSourceGroups({pool: f.pool, query: ticketQuery});
    const followUpSchedules = createWorkbenchFollowUpSchedules({pool: f.pool, query: ticketQuery, enabled: true});
    const supplementFollowUp = createWorkbenchSupplementFollowUp({pool: f.pool, query: ticketQuery, enabled: true});
    const follow = createWorkbenchFollow({pool: f.pool, query: ticketQuery, reviews, manualReviewEnabled: true, manualReportsEnabled: false, enabled: true});

    const spy = spyPool(f.pool);
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
    const legacySourceGroups = createLegacyWorkbenchSourceGroups({pool: f.pool, query: ticketQuery});
    const legacySupplementFollowUp = createLegacyWorkbenchSupplementFollowUp({pool: f.pool, query: ticketQuery, enabled: true});
    const legacyFollow = createLegacyWorkbenchFollow({pool: f.pool, query: ticketQuery, reviews, manualReviewEnabled: true, manualReportsEnabled: false, enabled: true});
    const legacyQuery = createLegacyWorkbenchQuery({
      pool: f.pool,
      query: ticketQuery,
      sourceGroups: legacySourceGroups,
      workbenchFollowEnabled: true,
      follow: legacyFollow,
      followUpSchedules,
      manualReviewEnabled: true,
      manualReportsEnabled: false,
      reviews,
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
      query: ticketQuery,
      cards: legacyQuery,
      enabled: true,
      localTestProfile: true,
      features: {follow: true, supplements: true, schedules: true, manual: false, manualReview: true, sourceGroups: true},
    });

    const adminAuth = createAuth(adminId);
    const handlerAuth = createAuth(handlerId);
    const outsiderAuth = createAuth(f.outsider.id);

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

        const pageKeyQueries = spy.queries.filter(q => q.includes('WITH page_keys AS'));
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
      ['intake', closedIntakeRow.id],
    ] as const) {
      const [newItem, oldItem] = await Promise.all([
        newQuery.authorizedItem(adminAuth, kind, id),
        legacyQuery.authorizedItem(adminAuth, kind, id),
      ]);
      assert.deepEqual(newItem, oldItem, `authorizedItem parity failed for ${kind}:${id}`);
    }
    await assert.rejects(newQuery.authorizedItem(outsiderAuth, 'ticket', extraTicket.id), /NOT_FOUND/u);
    await assert.rejects(legacyQuery.authorizedItem(outsiderAuth, 'ticket', extraTicket.id), /NOT_FOUND/u);

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
    const reminders = createWorkbenchReminders({pool: f.pool, query: ticketQuery, enabled: true, followEnabled: true});
    const legacyReminders = createLegacyWorkbenchReminders({pool: f.pool, query: ticketQuery, enabled: true, followEnabled: true});
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
  }, {precisionV212: true, serviceCatalog: loadServiceCatalog(), ticketSelfHandlingEnabled: true, workbenchBoardActionsEnabled: true, workbenchSearchEnabled: true, workbenchFollowEnabled: true, workbenchManualReviewEnabled: true, sourceGroupDirectoryEnabled: true, workbenchRealtimeEnabled: true});
});

