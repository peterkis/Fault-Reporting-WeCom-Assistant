# YXX-SS-002 contract freeze

The web source is `PORTAL / YIXIAOXIU_WEB / APP_WEB_SELF_SERVICE`. A web form
is represented by a `WEB_FORM` leg linked to a real web submission. It never
creates an Inbox row, Bot message, Conversation Thread/Session, or Direct Leg.
The existing Bot branch keeps its non-null message/chat/session foreign keys.

The seven API contracts are:

| Method | Path | operationId |
|---|---|---|
| GET | `/api/yixiaoxiu/bootstrap` | `yxxSelfServiceBootstrap` |
| POST | `/api/yixiaoxiu/requests` | `yxxCreateRequest` |
| GET | `/api/yixiaoxiu/my-reports` | `yxxListMyReports` |
| GET | `/api/yixiaoxiu/requests/{request_ref}` | `yxxGetRequest` |
| GET | `/api/yixiaoxiu/requests/{request_ref}/timeline` | `yxxGetRequestTimeline` |
| POST | `/api/yixiaoxiu/requests/{request_ref}/supplements` | `yxxSupplementRequest` |
| GET | `/api/yixiaoxiu/commands/{client_command_id}` | `yxxGetMyCommand` |

The closed input schemas reject identity, provider, Ticket, actor, status,
priority, time, and unknown fields. `202 ACCEPTED` means the Web Request is
durably received, never that a Ticket exists. A repeated command returns the
same receipt; the same ID with a different canonical body is `409`.

Migration 033 is reserved for three auxiliary tables and the following exact
conditional catalog delta. It is immutable after application; the forward
correction migration 034 only tightens the preserved single/group Bot source
check and does not rewrite 033.

| Object | 033 change | Web branch check | Bot branch preservation |
|---|---|---|---|
| `intake.service_intake` | `primary_web_submission_id`, `source_app_scope`, `canonical_reporter_binding` | These are required; Bot/chat/inbox fields are null only for `PORTAL` | Existing non-null/FK/source checks remain |
| `intake.contact_journey` | `APP_WEB_SELF_SERVICE`, `PORTAL`, app scope | Must originate from Web Intake | Three Bot modes and scope stay unchanged |
| `intake.channel_leg` | `WEB_FORM`, `web_submission_id` FK | Thread/session/inbox are null and submission FK is present | Existing leg FKs and single/group checks remain |
| `intake.deterministic_decision` | `source_kind=WEB`, submission FK, `basis_input_revision` | Decision leg must be `WEB_FORM` | Existing source-window/hash rules remain |
| `intake.manual_review_item` | `basis_input_revision` | Shared root lock and current basis | Existing review ownership/commands remain |
| `intake.service_intake_event` | Web accept/supplement source marker | Append to shared Intake stream | Existing event types remain |

Three new tables are `intake.web_request_binding`,
`intake.web_submission`, and `intake.web_command_receipt`. Their request ref,
member keyset, pending partial index, and scope+command unique constraints are
non-deferred. Cross-member FKs, mixed Web/Bot rows, missing Bot fields, wrong
FKs, weak checks, and wrong partial indexes are negative catalog cases. The
plan preserves `pilot_ticket_id`, `version`, the existing Ticket Core, Bot
foreign keys, and all historical catalog/evidence. Persistent flags remain
false in every example configuration.

## SS-007 recovery scope refinement

Bootstrap additionally returns `recovery_scope`, a 64-character lowercase HMAC
hex value. The server derives it from the protected canonical member binding
and source corp/app scopes using a stable server-only recovery binding secret.
It is not a credential and grants no read or write access. It must stay stable
for the same member/scope when CSRF rotates or that member reauthenticates.

The browser may persist only a version, opaque command UUID and opaque recovery scope for a pending command. Version 3 records use `{v:3,id,scope}` in a separate localStorage key per UUID, with a sessionStorage pointer for the current tab. The durable set is bounded to 20 records; storage failure or capacity exhaustion prevents a new POST. This extends the original tab-scoped recovery to survive tab closure. The stored fields are the opaque
command UUID and this opaque recovery scope. Bootstrap compares the saved scope
before resuming GET-only recovery. A different scope clears the previous
member's DOM and tab pointer, without deleting durable records belonging to other scopes. A matching scope preserves the command fence
even when CSRF changes. Unknown-scope legacy records remain conservative;
an early 404 alone never proves that an earlier transaction cannot commit. A legacy record without a scope cannot be assigned to the current member merely because bootstrap succeeded. Only a validated receipt or a definite rejection clears the corresponding command record; form text, raw identity, tokens and CSRF remain excluded.

Logout publishes only a fixed same-origin `v1/logout` invalidation signal over
BroadcastChannel and the storage event fallback. It carries no command UUID,
scope, cookie, CSRF value or form text. Every open self-service document clears
its protected DOM and stops its controller without rebroadcasting or starting
OAuth; its own durable command record remains available for later same-scope
GET-only recovery.

The native logout endpoint preserves the established entry error namespace:
closed-body, query and content-type failures are `YXX_ENTRY_INPUT_INVALID`,
origin failures are `YXX_ENTRY_ORIGIN_INVALID`, and service failures use the
existing `YXX_ENTRY_*` mapping.

The new secret must be supplied through protected server configuration and
remain stable across restarts. It must never be sent to the browser, logged,
stored with command data, or derived from the current CSRF token. This contract
refinement has no database migration and does not relax command authorization,
member ownership checks, or `MEMBER_TICKET_READONLY` restrictions.
