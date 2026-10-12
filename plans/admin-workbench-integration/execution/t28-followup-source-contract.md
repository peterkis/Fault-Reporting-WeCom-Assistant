# T28 follow-up candidate contract — SOURCE_ONLY

This source preparation is **NOT_BUILT_NOT_RUN**. It freezes tests and a candidate UI contract for issue #83; it does not implement or accept the remaining follow-up UI. The historical bb337 original first failure remains a historical failure. The original 5,949-byte first test, its ADMIN Cookie/three Reporters/assertions/240,000 ms budget, and stock registry flags remain unchanged.

Existing authority: Accepted ADR-0023/0024/0026/0029/0031, `docs/api/workbench/incidents.md`, `src/p2-012-workbench-http.mts`, `src/p2-012-domain-contracts.mts`, `src/p2-012-incident-command-service.mts`, and migration 032. No database migration or production module changes are proposed by this preparation. T36's separate disposition authority does not expand Incident roles.

## Closed existing HTTP inputs

All paths below are relative to `/api/incidents/{incidentId}` and use POST. Every body contains only `client_command_id` (UUID), `reason_code` (existing reason enum), `expected_row_version` (exact positive decimal string within PostgreSQL bigint), and the fields in the table. The path supplies Incident/action/report/subscription identities; those identities and `action` are forbidden body fields. The original UUID is the idempotency key; quoted If-Match is the exact parent version. Cookie, current bootstrap CSRF and same-origin validation remain required. Child versions also remain exact strings above 2^53.

| Action | Existing path | Additional body fields | Candidate public UI choice |
| --- | --- | --- | --- |
| START_INVESTIGATING | `/start-investigating` | none | existing operation selector |
| CORRECT_SCOPE | `/correct-scope` | `confirmed_scope` | 确认范围 |
| SET_PRIMARY_TICKET | `/primary-ticket` | required `primary_ticket_id: UUID \| null` | 主工单; NONE means explicit null |
| LINK_REPORT | `/reports/link` | `source_decision_id` | 报修来源 from current linkable reports |
| UNLINK_REPORT | `/reports/{reportId}/unlink` | `expected_report_version` | 关联报修 |
| MARK_REPORTER_RECOVERED | `/reports/{reportId}/mark-recovered` | `expected_report_version` | 关联报修 |
| PAUSE_SUBSCRIPTION | `/subscriptions/{subscriptionId}/pause` | `expected_subscription_version` | 通知订阅 |
| RESUME_SUBSCRIPTION | `/subscriptions/{subscriptionId}/resume` | `expected_subscription_version`; optional `direct_channel_leg_id: UUID \| null` | 通知订阅; preserve existing destination when omitted |
| RESOLVE_INCIDENT | `/resolve` | none | explicit resolve operation |
| CLOSE_INCIDENT | `/close` | none | explicit close operation |

Candidate controls extend the existing 公共故障操作/决定原因 selectors without substituting display names for identities. Tests use existing reason codes: OPERATOR_REVIEWED, SCOPE_CORRECTION, WORKBENCH_CONFIRMED, CONFIRMED_SHARED_FAULT, INCORRECT_ASSOCIATION, RECOVERY_CONFIRMED and SUBSCRIPTION_REQUEST.

## Existing authority and outcomes

ADMIN/DISPATCHER are broad Incident actors; scope correction, pause/resume and close require ADMIN. DISPATCHER confirmation is LOCAL/BUILDING with current explicit CAMPUS policy default false. Recovery by HANDLER requires current assignment to the target report's individual Ticket. Incident owner identity grants no additional action authority. Current target membership and parent/child versions are checked by the single existing command service and ledger; competing parent commands must commit once or fail atomically. Primary Ticket must be linked; no-primary remains a valid explicit choice.

Resolve/close leave individual Ticket state, events and responsibility independent. Unlink/recovery and pause/resume affect only the existing target/subscriber semantics; notification evidence remains the existing Outbox/Delivery projection. A committed action ACK does not prove delivery.

GET detail, reports, subscriptions, linkable reports, scoped direct destinations, events and notifications remain public observations. Child pages are bounded (default 30, reports/subscriptions 100 maximum, events 200); a loaded-page count must not be represented as an Incident total. Narrow roles must not receive broad owner/primary references or subscriber/destination projections.

Unknown outcome keeps the exact UUID, captured versions and body. A refreshed Incident GET cannot settle it. There is currently no public Incident command-receipt GET or Incident draft restoration contract; this preparation adds neither. Explicit recovery/consume behavior remains a future whole-task gap to resolve through the existing ledger and authorized public seam after a real failing slice, rather than inventing another receipt store.

## Prepared tests and limits

Three registered `.mts` entries contain nine action tracers and three version/authority/input risks. They reuse the existing T27 isolated fixture, compiled formal bundle, ADMIN session and actual HTTP/Core/transactions. Version counter fault injection and transport reply loss are test-only; neither fabricates business success. External sending and notification flags remain false. The notification-page comparison proves only the fixture's observed projection, not delivery or an enabled-notification matrix.

Single App/Worker/Gateway, SSE 32, pool ≤8, concurrency 1, existing cleanup and default-off rollback remain unchanged. Future whole execution must first receive a fresh heavy grant, normally merge the final post-T25 root, calibrate the existing D wrapper scope while preserving guards, freeze/build once, run the untouched original first, and then complete all seven criteria. Bounded material/history UI, current-assignee recovery, same-reporter subscription transitions, current-authority callback races, actual independent deliveries, draft consumption and full formal-bundle acceptance remain unverified.
