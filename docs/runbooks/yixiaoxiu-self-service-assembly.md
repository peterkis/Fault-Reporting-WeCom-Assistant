# SS-008 local assembly

This runbook describes local composition, not deployment authorization. The
fixed application home remains `/wecom/yixiaoxiu/`. No vendor setting changes.
SS-009/010 readiness and SS-011 live implementation are separate tasks.

## Profiles and ownership

`createYxxProfile` uses the existing OAuth HTTP server for OAUTH_ONLY,
MEMBER_TICKET_READONLY and MEMBER_SELF_SERVICE. OAUTH_ONLY constructs no DB
adapter. READONLY refuses the Web API prefix even with erroneous write flags;
its old authorized Ticket reads retain their existing access audit behavior.

SELF composes the existing member command/store/query adapters with the native
HTTP handler. Verified delegated mapping is initialized once; transactions only
resolve the bounded local mapping. Corp, app, proof and config hash are checked.
The member scope and CSRF/session generations use purpose-separated HMACs;
none is accepted from form data. The App owns one stoppable DB pump (default
batch 10, maximum 20, default interval 5000 ms). Its supplied pool must be <=4.

FULL mounts the same HTTP extension inside the original P2-016/P2-012 App,
with no Web App pump. The original G2 Worker role receives only the two Web
flags, and invokes the same processor through the existing Worker extension.
App/Worker/Gateway pools stay 4/2/1; the existing controller pool is separate.
The Gateway receives no Web flags. No new long-running service is introduced.

When FULL mounts the self-service extension, `/health/ready` also requires both
`033_yxx_self_service_intake` and `034_yxx_self_service_direct_chat_check` in the
schema migration ledger. A missing marker or failed schema query makes
`checks.yxx_self_service_schema` and `base_service_ready` false (HTTP 503).
FULL without this extension retains its original readiness requirements.

Both persistent flags default false. To close writes while preserving approved
reads, keep MY_REPORTS_ENABLED true and set SELF_SERVICE_ENABLED false in an
explicitly authorized configuration. Bootstrap becomes read-only, Submit and
Supplement refuse writes, and list/detail/timeline/command recovery continue.
The existing pending input remains durable; stopping the pump never deletes it.

## Route audit and proxy advice

Dispatch order is native member routes, original member Ticket/Grant bridge,
then original OAuth handler. Internal Workbench authentication stays independent.
The native handler checks the exact public Host, canonical path and Origin; it
does not trust arbitrary forwarded headers. Proxy recommendations below require
separate deployment approval and have not been applied.

| Method | Exact route or bounded parameter route | Owner |
|---|---|---|
| GET | `/wecom/yixiaoxiu/` | native home or original bounded OAuth |
| GET | `/wecom/yixiaoxiu/reports`, `/reports/new`, `/reports/{request_ref}` under the application root | native pages |
| GET | `/wecom/yixiaoxiu/self-service.js`, `/self-service.css` under the application root | native static assets |
| GET | `/wecom/yixiaoxiu/login`, `/callback`, `/continue/{ref}`, `/tickets/{public_ref}` | original OAuth/member handler |
| POST | `/wecom/yixiaoxiu/logout` | native logout, original browser/session invalidation |
| GET | `/api/yixiaoxiu/bootstrap` | native capabilities |
| POST | `/api/yixiaoxiu/requests` | existing member command context |
| GET | `/api/yixiaoxiu/my-reports` | existing member query |
| GET | `/api/yixiaoxiu/requests/{request_ref}` | member query, authorized 304 |
| GET | `/api/yixiaoxiu/requests/{request_ref}/timeline` | member safe timeline |
| POST | `/api/yixiaoxiu/requests/{request_ref}/supplements` | existing supplement command |
| GET | `/api/yixiaoxiu/commands/{client_command_id}` | same-member receipt recovery |

Preserve the public Host when forwarding these application/member routes to the
loopback App. Retain the separately governed legacy `/api/reporter/` routes.
Do not add public routing for `/workbench`, `/api/tickets`, `/api/manual-reviews`,
`/api/contact-journeys` or Incident APIs. Do not redirect every homepage GET to
login or redirect API401 responses. Both OpenAPI documents reference the same
closed seven-route YXX fragment; existing contract tests parse and compare it.

## Authority, UI and realtime

Web submissions and supplements use real Web source objects; Ticket state still
belongs to the original Core. Original internal Review and Ticket APIs expose
the existing `web_report` projection. The Workbench shows source, initial input
and supplements; sessionless tickets explicitly have no conversation reply
action. Web notification policy returns APP_ONLY before PERSON routing, so no
external Message/Outbox/Delivery/Grant or dead letter is created.

Sessionless Ticket hints use existing SYSTEM events with a bounded list of
authorized Ticket aggregate IDs. SQL filters both aggregate ID and visibility
before LIMIT. Handler scope follows Ticket assignee/team access; it does not
grant all SYSTEM or restricted-admin events. Members never receive staff roles.

## Validation and history

`tests/yxx-ss-008-assembly.integration.test.mjs` uses owned local PostgreSQL,
actual HTTP, the original Review/Ticket actions, a real Worker child process,
and a local system browser. OAuth provider and mapping initialization are
synthetic; no real identities, SDK calls or sends are used.

`plans/yxx-self-service-validation-scope.json` separates current local work from
the frozen creation-v2 parent READY snapshot. It pins merged main, all six parent
state files and the complete 001-034 migration inventory/content. Historical
Evidence cannot be modified. `--require-ready` still demands a current complete
candidate; local validation never marks the parent Gate PASSED.

Rollback is configuration-only shutdown of new writes/pump with safe reads as
authorized. Keep facts and immutable migrations. Do not DROP the new schema,
delete user submissions, or reinterpret local success as a live approval.
