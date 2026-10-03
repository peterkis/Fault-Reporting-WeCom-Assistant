import { createConversationWorkbenchQueryService } from '../../src/p2-006-workbench-query.mjs';
import { createPilotWorkbenchAuthorizationAdapter } from '../../src/p2-006-workbench-authorization.mjs';
import type { WorkbenchPrincipal } from '../../src/p2-006-workbench-authorization.mjs';
import type { PostgresTransaction } from '../../src/platform/postgres-pool.mjs';

declare const pool: PostgresTransaction;
declare const principal: WorkbenchPrincipal;
const authorize = createPilotWorkbenchAuthorizationAdapter({ pool });
const query = createConversationWorkbenchQueryService({ pool, authorize, enabled: true });
const authContext = { principal_id: 'synthetic' };
query.listConversations({ authContext, state: 'mine', limit: 30 });
query.getConversationDetail({ authContext, sessionId: 'synthetic' });
authorize.authorizeSession({ principal, sessionId: 'synthetic', action: 'VIEW', queryable: pool });
// @ts-expect-error -- Workbench list filters accept only implemented queue states.
query.listConversations({ authContext, state: 'ai_processing' });
// @ts-expect-error -- A query limit is a numeric or HTTP string value, never an object.
query.listConversations({ authContext, limit: { unlimited: true } });
// @ts-expect-error -- Authorization requires a complete principal, never a bare identifier.
authorize.authorizeSession({ principal: 'synthetic', sessionId: 'synthetic', action: 'VIEW' });
// @ts-expect-error -- Authorization actions use the existing workbench action vocabulary.
authorize.authorizeSession({ principal, sessionId: 'synthetic', action: 'DELETE' });
