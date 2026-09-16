import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { arch005MigrationApplied } from './platform/legacy-migration-guard.mjs';
import { EXTERNAL_TICKET_STATUS, publicPilotTicket } from './p1-005-pilot-ticket-core.mjs';
import { assertLocalDateTime } from './platform/time-contract.mjs';

const MIGRATION_URL = new URL('../database/migrations/006_p1_009_pilot_access.sql', import.meta.url);
const ROLES = new Set(['REPORTER', 'HANDLER', 'DISPATCHER', 'ADMIN']);
const HANDLER_ACTIONS = new Set([
  'accept', 'start', 'request-information', 'resume', 'wait-vendor',
  'resolve', 'cancel', 'add-note',
]);
const REPORTER_ACTIONS = new Set(['confirm', 'reopen']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value, message, maximum) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(message);
  }
  return value;
}

function asArray(value, message) {
  if (!Array.isArray(value)) {
    throw new TypeError(message);
  }
  return value;
}

async function withTransaction(pool, operation) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }
  const client = await pool.connect();
  let destroyClient = false;
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      destroyClient = true;
    }
    throw error;
  } finally {
    client.release(destroyClient);
  }
}

function ticketFields(prefix = 'ticket') {
  return `${prefix}.id::text AS id,
          ${prefix}.ticket_no,
          ${prefix}.source_intake_id::text AS source_intake_id,
          ${prefix}.title,
          ${prefix}.request_type,
          ${prefix}.status,
          ${prefix}.priority,
          ${prefix}.resolver_team_id,
          ${prefix}.assignee_id::text AS assignee_id,
          ${prefix}.external_result,
          ${prefix}.closure_reason,
          ${prefix}.created_at,
          ${prefix}.updated_at,
          ${prefix}.version`;
}

function principalFromRow(row) {
  return {
    id: row.id,
    wecom_user_id: row.wecom_user_id,
    display_name: row.display_name,
    roles: row.roles,
    resolver_team_ids: row.resolver_team_ids,
  };
}

async function loadPrincipal(transaction, actorId) {
  const selected = await transaction.query(
    `SELECT principal.id::text,
            principal.wecom_user_id,
            principal.display_name,
            principal.is_active,
            COALESCE(array_agg(DISTINCT role.role) FILTER (WHERE role.role IS NOT NULL), '{}') AS roles,
            COALESCE(array_agg(DISTINCT membership.team_id) FILTER (WHERE membership.team_id IS NOT NULL), '{}') AS resolver_team_ids
       FROM pilot_ticket.pilot_principal AS principal
       LEFT JOIN pilot_ticket.pilot_principal_role AS role ON role.principal_id = principal.id
       LEFT JOIN pilot_ticket.pilot_team_member AS membership ON membership.principal_id = principal.id
      WHERE principal.id = $1::uuid
      GROUP BY principal.id`,
    [actorId],
  );
  return selected.rowCount === 1 ? selected.rows[0] : null;
}

function principalCanWork(principal) {
  return principal.roles.some((role) => ['HANDLER', 'DISPATCHER', 'ADMIN'].includes(role));
}

function publicEvent(row, includeInternal) {
  const event = {
    event_id: row.event_id,
    event_type: row.event_type,
    old_status: row.old_status,
    new_status: row.new_status,
    aggregate_version: row.aggregate_version,
    event_ordinal: row.event_ordinal,
    external_note: row.external_note,
    reason_code: row.reason_code,
    created_at: assertLocalDateTime(row.created_at),
  };
  if (includeInternal) {
    event.internal_note = row.internal_note;
  }
  return event;
}

async function webReportForIntake(transaction,intakeId) {
  let result;
  try { result=await transaction.query(`SELECT i.source_provider,initial.safe_content AS initial_content,
      COALESCE(supplements.items,'[]'::jsonb) AS supplement_items
    FROM intake.service_intake i
    JOIN intake.web_request_binding b ON b.intake_id=i.id
      AND b.revoked_at IS NULL AND b.retention_until>platform.local_now()
    LEFT JOIN LATERAL (SELECT s.safe_content FROM intake.web_submission s
      WHERE s.intake_id=i.id AND s.kind='SUBMIT' ORDER BY s.input_revision LIMIT 1) initial ON TRUE
    LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('input_revision',s.input_revision::text,
      'text',s.safe_content->>'text') ORDER BY s.input_revision) AS items
      FROM intake.web_submission s WHERE s.intake_id=i.id AND s.kind='SUPPLEMENT') supplements ON TRUE
    WHERE i.id=$1::uuid AND i.retention_until>platform.local_now()`,[intakeId]); }
  catch(error) { if(error?.code==='42P01')return null; throw error; }
  const row=result.rows[0];if(result.rowCount!==1||row.source_provider!=='YIXIAOXIU_WEB')return null;
  const initial=row.initial_content&&typeof row.initial_content==='object'?row.initial_content:{};
  const supplements=Array.isArray(row.supplement_items)?row.supplement_items:[];
  return {source_kind:'WEB_REQUEST',description:typeof initial.description==='string'?initial.description:null,
    location:initial.location??null,service_code:initial.service_code??null,impact_scope:initial.impact_scope??null,
    reported_department_text:initial.reported_department_text??null,extension:initial.extension??null,
    supplements:supplements.map(item=>({input_revision:String(item.input_revision),text:typeof item.text==='string'?item.text:null}))};
}

export async function applyPilotAccessMigration({ pool }) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }
  if (await arch005MigrationApplied(pool)) return Object.freeze({ status: 'LEGACY_MIGRATION_SUPERSEDED' });
  const sql = await readFile(MIGRATION_URL, 'utf8');
  await pool.query(sql);
}

export function createPilotAccessService({ pool } = {}) {
  return Object.freeze({
    upsertPrincipal: async ({
      wecomUserId,
      displayName,
      roles,
      resolverTeamIds = [],
    }) => withTransaction(pool, async (transaction) => {
      nonEmpty(wecomUserId, 'wecomUserId is required.', 256);
      nonEmpty(displayName, 'displayName is required.', 128);
      const normalizedRoles = [...new Set(asArray(roles, 'roles must be an array'))];
      if (normalizedRoles.length === 0 || normalizedRoles.some((role) => !ROLES.has(role))) {
        throw new TypeError('roles must contain Pilot roles.');
      }
      const normalizedTeams = [...new Set(asArray(resolverTeamIds, 'resolverTeamIds must be an array'))]
        .map((teamId) => nonEmpty(teamId, 'resolver team id is invalid.', 64));
      const principal = await transaction.query(
        `INSERT INTO pilot_ticket.pilot_principal (wecom_user_id, display_name)
         VALUES ($1, $2)
         ON CONFLICT (wecom_user_id)
         DO UPDATE SET display_name = EXCLUDED.display_name,
                       is_active = TRUE,
                       updated_at = date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai')
         RETURNING id::text`,
        [wecomUserId, displayName],
      );
      const principalId = principal.rows[0].id;
      await transaction.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id = $1::uuid', [principalId]);
      await transaction.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id = $1::uuid', [principalId]);
      for (const role of normalizedRoles) {
        await transaction.query(
          'INSERT INTO pilot_ticket.pilot_principal_role (principal_id, role) VALUES ($1::uuid, $2)',
          [principalId, role],
        );
      }
      for (const teamId of normalizedTeams) {
        await transaction.query(
          `INSERT INTO pilot_ticket.pilot_team_member (team_id, principal_id)
           VALUES ($1, $2::uuid)`,
          [teamId, principalId],
        );
      }
      const configured = await loadPrincipal(transaction, principalId);
      return principalFromRow(configured);
    }),

    authorizeAction: async ({ transaction, ticket, action, actor }) => {
      if (!transaction || !ticket || !actor?.id) {
        return actor?.type === 'SYSTEM' && action === 'auto-close';
      }
      const principal = await loadPrincipal(transaction, String(actor.id));
      if (principal === null || !principal.is_active) {
        return false;
      }
      if (principal.roles.includes('ADMIN') || principal.roles.includes('DISPATCHER')) {
        return true;
      }
      if (REPORTER_ACTIONS.has(action)) {
        if (!principal.roles.includes('REPORTER')) {
          return false;
        }
        const reporter = await transaction.query(
          'SELECT reporter_wecom_userid FROM intake.service_intake WHERE id = $1::uuid',
          [ticket.intake_id],
        );
        return reporter.rowCount === 1
          && reporter.rows[0].reporter_wecom_userid === principal.wecom_user_id;
      }
      if (!HANDLER_ACTIONS.has(action) || !principal.roles.includes('HANDLER')) {
        return false;
      }
      if (!principal.resolver_team_ids.includes(ticket.resolver_team_id)) {
        return false;
      }
      return action === 'accept' || ticket.assignee_id === principal.id;
    },

    resolveReporterActor: async ({ wecomUserId }) => {
      const selected = await pool.query(
        `SELECT principal.id::text
           FROM pilot_ticket.pilot_principal AS principal
           JOIN pilot_ticket.pilot_principal_role AS role ON role.principal_id = principal.id
          WHERE principal.wecom_user_id = $1
            AND principal.is_active
            AND role.role = 'REPORTER'`,
        [wecomUserId],
      );
      return selected.rowCount === 1
        ? { type: 'REPORTER', id: selected.rows[0].id }
        : null;
    },

    listWorkQueue: async ({ actorId }) => withTransaction(pool, async (transaction) => {
      const principal = await loadPrincipal(transaction, actorId);
      if (principal === null || !principal.is_active || !principalCanWork(principal)) {
        return { ok: false, error: { code: 'FORBIDDEN', retryable: false } };
      }
      const isPrivileged = principal.roles.some((role) => role === 'DISPATCHER' || role === 'ADMIN');
      const tickets = await transaction.query(
        `SELECT ${ticketFields()}, intake.reporter_wecom_userid
           FROM pilot_ticket.ticket AS ticket
           JOIN intake.service_intake AS intake ON intake.id = ticket.source_intake_id
          WHERE ticket.status IN (
              'QUEUED', 'ACCEPTED', 'IN_PROGRESS', 'WAITING_REQUESTER',
              'WAITING_VENDOR', 'RESOLVED', 'REOPENED'
          )
            AND ($1::boolean OR ticket.resolver_team_id = ANY($2::text[]))
          ORDER BY ticket.created_at, ticket.ticket_no`,
        [isPrivileged, principal.resolver_team_ids],
      );
      return {
        ok: true,
        items: tickets.rows.map((row) => ({
          ...publicPilotTicket(row),
          reporter_wecom_userid: row.reporter_wecom_userid,
          mobile_summary: `${row.ticket_no} · ${EXTERNAL_TICKET_STATUS[row.status]}`,
        })),
      };
    }),

    getTicketView: async ({ ticketId, actorId }) => withTransaction(pool, async (transaction) => {
      const principal = await loadPrincipal(transaction, actorId);
      const selected = await transaction.query(
        `SELECT ${ticketFields()}, intake.reporter_wecom_userid
           FROM pilot_ticket.ticket AS ticket
           JOIN intake.service_intake AS intake ON intake.id = ticket.source_intake_id
          WHERE ticket.id = $1::uuid`,
        [ticketId],
      );
      if (principal === null || selected.rowCount !== 1) {
        return { ok: false, error: { code: 'FORBIDDEN', retryable: false } };
      }
      const ticket = selected.rows[0];
      const isReporter = principal.roles.includes('REPORTER')
        && principal.wecom_user_id === ticket.reporter_wecom_userid;
      const isStaff = principalCanWork(principal)
        && (principal.roles.includes('ADMIN') || principal.roles.includes('DISPATCHER')
          || principal.resolver_team_ids.includes(ticket.resolver_team_id));
      if (!isReporter && !isStaff) {
        return { ok: false, error: { code: 'FORBIDDEN', retryable: false } };
      }
      const events = await transaction.query(
        `SELECT event_id::text, event_type, old_status, new_status,
                aggregate_version, event_ordinal, internal_note, external_note,
                reason_code, created_at
           FROM pilot_ticket.ticket_event
          WHERE ticket_id = $1::uuid
          ORDER BY created_at, event_ordinal`,
        [ticketId],
      );
      const webReport=await webReportForIntake(transaction,ticket.source_intake_id);
      return {
        ok: true,
        ticket: {...publicPilotTicket(ticket),...(webReport?{web_report:webReport}:{})},
        events: events.rows.map((event) => publicEvent(event, isStaff)),
      };
    }),
  });
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 32_768) {
        reject(new Error('REQUEST_TOO_LARGE'));
      }
    });
    request.on('end', () => {
      if (body.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...WORKBENCH_SECURITY_HEADERS,
  });
  response.end(JSON.stringify(body));
}

const WORKBENCH_SECURITY_HEADERS = Object.freeze({
  'content-security-policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), geolocation=(), microphone=()',
});

const WORKBENCH_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pilot 工单处理</title><link rel="stylesheet" href="/static/pilot-workbench.css"></head>
<body><main><h1>Pilot 工单处理</h1><p id="state">正在加载待办…</p><ul id="work"></ul></main><script src="/static/pilot-workbench.js" defer></script></body></html>`;

const WORKBENCH_CSS = 'body{font:16px system-ui;margin:1rem;max-width:44rem}button{min-height:44px;padding:.5rem 1rem}li{padding:.75rem 0;border-bottom:1px solid #ddd}';

const WORKBENCH_JAVASCRIPT = `const state=document.querySelector('#state');
const list=document.querySelector('#work');
fetch('/api/pilot/work').then((response)=>response.json()).then((data)=>{
  state.textContent=data.ok?'待办工单':'无访问权限';
  (data.items||[]).forEach((item)=>{
    const entry=document.createElement('li');
    entry.textContent=item.mobile_summary;
    list.append(entry);
  });
}).catch(()=>{state.textContent='暂时无法加载待办'});`;

function sendStatic(response, contentType, body) {
  response.writeHead(200, {
    'content-type': contentType,
    'cache-control': 'no-store',
    ...WORKBENCH_SECURITY_HEADERS,
  });
  response.end(body);
}

export function createPilotWorkbenchServer({ access, actions, authenticate } = {}) {
  if (!access || typeof access.listWorkQueue !== 'function' || typeof access.getTicketView !== 'function') {
    throw new TypeError('A Pilot access service is required.');
  }
  if (!actions || typeof actions.perform !== 'function') {
    throw new TypeError('A Ticket Action service is required.');
  }
  if (typeof authenticate !== 'function') {
    throw new TypeError('An injected Pilot authenticator is required.');
  }
  return createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    try {
      if (request.method === 'GET' && pathname === '/') {
        sendStatic(response, 'text/html; charset=utf-8', WORKBENCH_HTML);
        return;
      }
      if (request.method === 'GET' && pathname === '/static/pilot-workbench.css') {
        sendStatic(response, 'text/css; charset=utf-8', WORKBENCH_CSS);
        return;
      }
      if (request.method === 'GET' && pathname === '/static/pilot-workbench.js') {
        sendStatic(response, 'text/javascript; charset=utf-8', WORKBENCH_JAVASCRIPT);
        return;
      }
      const actor = await authenticate(request);
      if (!actor?.id || !actor?.type) {
        sendJson(response, 401, { ok: false, error: { code: 'UNAUTHORIZED', retryable: false } });
        return;
      }
      if (request.method === 'GET' && pathname === '/api/pilot/work') {
        const result = await access.listWorkQueue({ actorId: actor.id });
        sendJson(response, result.ok ? 200 : 403, result);
        return;
      }
      const ticketMatch = pathname.match(/^\/api\/pilot\/tickets\/([0-9a-f-]{36})$/iu);
      if (request.method === 'GET' && ticketMatch) {
        const result = await access.getTicketView({ ticketId: ticketMatch[1], actorId: actor.id });
        sendJson(response, result.ok ? 200 : 403, result);
        return;
      }
      const actionMatch = pathname.match(/^\/api\/pilot\/tickets\/([0-9a-f-]{36})\/actions\/([a-z-]+)$/iu);
      if (request.method === 'POST' && actionMatch) {
        if (actionMatch[2] === 'auto-close') {
          sendJson(response, 403, { ok: false, error: { code: 'FORBIDDEN', retryable: false } });
          return;
        }
        const body = await readJson(request);
        const result = await actions.perform({
          ...body,
          ticketId: actionMatch[1],
          action: actionMatch[2],
          actor,
        });
        sendJson(response, result.ok ? 200 : result.error.code === 'FORBIDDEN' ? 403 : 409, result);
        return;
      }
      sendJson(response, 404, { ok: false, error: { code: 'NOT_FOUND', retryable: false } });
    } catch {
      sendJson(response, 400, { ok: false, error: { code: 'VALIDATION_FAILED', retryable: false } });
    }
  });
}

export function listenPilotWorkbenchServer(server, { host = '127.0.0.1', port = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('error', onError);
      reject(error);
    };
    server.once('error', onError);
    server.listen({ host, port }, () => {
      server.off('error', onError);
      resolve(server.address());
    });
  });
}

export function closePilotWorkbenchServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
