# 医小修成员工单入口设计

Design authorized 2026-09-11. Runtime implemented; current full regression and independent review must be bound before readiness. Authority: ADR-0018 and `tasks/P2-G2_yixiaoxiu_member_ticket_entry.md`.

## Intended route matrix

| Method/path | MEMBER_REQUIRED behavior |
|---|---|
| GET /wecom/yixiaoxiu/ | Authentication status only; choose no Ticket |
| GET /wecom/yixiaoxiu/login | Generic OAuth, no arbitrary query |
| GET /wecom/yixiaoxiu/callback | Exactly one code/state; fixed 303 destination from server intent |
| POST /wecom/yixiaoxiu/logout | Revoke browser sessions, pending/in-flight intents |
| GET /wecom/yixiaoxiu/tickets/{public_ref} | Empty page shell or browser-bound OAuth intent |
| GET /api/reporter/member/session | Safe authentication status, no identity |
| POST /api/reporter/member-entry/prepare | Legacy fragment to bounded browser continuation; no Ticket disclosure |
| GET /wecom/yixiaoxiu/continue/{entry_ref} | Resolve browser-bound continuation after member authentication |
| GET /api/reporter/tickets/{public_ref} | Per-request ownership then shared safe detail |
| GET /api/reporter/tickets/{public_ref}/timeline | Same ownership, bounded safe milestones and ref-bound cursor |
| GET /reporter/ and /reporter/open | Legacy landing; no anonymous read |
| GET /reporter/reporter.js and /reporter/reporter.css | Same-origin static assets only |
| GET /api/reporter/bootstrap | Safe member status only; no old Cookie Ticket selection |
| POST /api/reporter/access/exchange | Refuse capability exchange in member mode |
| POST /api/reporter/logout | Same member logout semantics |

## Authentication and ownership

Only OAuth.authenticate supplies the verified identity. Config fixes corp/app/agent/Bot scope. VERIFIED_SAME_NAMESPACE requires strict memberIdsConfirmed=true and a nonempty proof reference; synthetic proof is limited to an isolated test profile. No names, phones, department guesses, case folding or trimming. Live namespace correspondence is currently UNVERIFIED, and historical OAuth-only success proves no Ticket ownership correspondence.

Authorizer joins active Reporter public ref to the unique Ticket and its source Intake, checks provider/Bot/reporter and the existing SHA256(JSON.stringify(['WECOM_AIBOT', bot, reporter])) binding. Ticket and public ref have no expires_at or independent retention column. Access requires source Intake.retention_until_epoch_ms to remain future; its deadline is the earliest related Channel Message retention. If ref.journey_id is present, the Journey retention must also remain future. Member Incident milestones additionally filter incident.retention_until_epoch_ms. No expired notification Message or Grant extends these business-retention limits. Closure is not revocation.

The member facade holds authentication, authorization and safe queries in one REPEATABLE READ transaction; FOR SHARE on ref/Ticket/Intake defines the authorization linearization point and blocks conflicting ref revocation until the read commits. A concurrent update visible only after that snapshot affects the next request; already delivered content cannot be recalled. SQL lock and statement waits are limited to2 seconds. OAuth is rechecked before commit, after commit and immediately before HTTP response, including304. A response already delivered cannot be recalled. Reads never use ETag as authorization.

## Grant, sessions and intent

Member card sending validates the existing persisted notification binding, cross-linked Delivery/Outbox/Message and Ticket/event, the active public ref and provider/Bot/reporter identity. The request idempotency key and canonical content hash must match the stored delivery and message. Message, source Intake and any referenced Journey must remain within retention. A consumed, expired or absent Grant cannot suppress this member notification; no Grant is renewed or created by Sender. Legacy sending retains its Grant checks. Pre-SDK database interruption is retryable without a send; invalid bindings fail permanently; unknown SDK receipts still require reconciliation. See `evidence/p2-g2-yxx-entry-pr8-repair-authorization.md`.

No DDL. Grant consumption and reporter_access_session.grant_id NOT NULL UNIQUE remain unchanged. Member reads create neither row. Authorized Timeline reads append TIMELINE_READ/MEMBER_AUTHORIZED_QUERY with NULL session_id/grant_id/actor_principal_id; denied ownership/legacy locator appends ACCESS_DENIED/MEMBER_ENTRY_DENIED without a guessed owner. Detail alone does not append a Timeline audit, and missing/expired OAuth or invalid configuration can fail before DB access. This is Ticket/result audit, not a persistent member audit directory. Shared query keeps the existing public projection; no duplicated SQL or staff query proxy.

Legacy prepare clears the fragment immediately, checks length/encoding, stores only Grant UUID/digest plus browser binding and deadline, then redirects through OAuth. Current HMAC/digest and ownership are checked after authentication. ISSUED/CONSUMED/EXPIRED only locate; REVOKED or invalid binding/signature reject without Grant mutation. Missing, expired or foreign-browser continuations return a generic 404 HTML page prompting a fresh click on the original card, including after restart; no Ticket data is disclosed.

Opaque random browser-bound OAuth states are independent per tab (max8/recognized browser binding,1024 global). A retained __Host-wecom_oauth binding plus a per-state __Host-wecom_intent_* cookie prevents two first navigations from overwriting their callback binding. The first simultaneous requests may establish distinct server browser bindings before either Cookie reaches the client; both callbacks remain usable, and global bounds still apply. Finishing A removes only A's state cookie. Logout invalidates all recognized browser binding cookies present, their pending callbacks and sessions, plus the current member session; identity replacement revokes the previous member session. Sessions expire after15 minutes without polling extension. No realtime directory revocation is claimed; a directory status change without a delivered revocation event may remain unknown for the remaining session lifetime.

## UI and transport

An explicit login or legacy prepare refreshes the recognized browser binding for20 minutes so a fresh five-minute intent is not truncated by its old deadline. Authentication remains fixed at15 minutes; polling and validity checks do not refresh either deadline. Expired or logged-out bindings are never resurrected.

Reuse native Reporter layout and safe textContent rendering. Explicit authenticating/loading/empty/denied/expired/unavailable states. One refresh task, five-second visible-page polling, cancellation on pagehide/logout, fresh authorization on pageshow, clear sensitive DOM/ETag/cursor on identity/ref/auth failure, and ETag accepted only after detail+Timeline success. Maximum100 items. Shanghai text unchanged in UTC/Tokyo/NewYork browsers.

HTTPS Secure HttpOnly __Host cookies, exact Host/origin, fixed callback/redirect destinations, no-store/no-referrer, CSP self assets without unsafe-inline/eval, no wildcard CORS. POST verifies same-origin context. Stable closed errors: authentication401, member scope403, nonexistent/non-owned404, input400, capacity/dependency503; existing OAuth502 preserved.

## Profiles, evidence and stop

OAUTH_ONLY: no database or business API. MEMBER_TICKET_READONLY: existing pool max4, authentication and single-Ticket reads/audit only. FULL_SERVICE_LOOP: same member extension in the existing App; Worker/Gateway unchanged. No new sender/worker/pool. Each profile must close only owned resources.

YXX-01–48 and the existing976/158-file baseline must be bound to the new candidate, along with37 G2 scenarios,202 source audit and10 PR #6 invariants. Source/preparation checks are separate from current READY and live approval. No full test runs while editing candidate files.

The G2 manifest binds reporter_access_policy=MEMBER_REQUIRED and member_entry_config_sha256 for any future live run. The Controller validates exact enabled flags, application/Bot identity and LIVE proof configuration before side effects; only App receives OAuth credentials. The Gateway receives only the link mode. Fixed gettoken/getuserinfo HTTP allowlist entries are App-only and do not allow ID conversion, arbitrary API endpoints or model traffic. The existing mock full-service-loop regression explicitly uses LEGACY_BOUND_GRANT, while the new full App test selects MEMBER_REQUIRED with simulated OAuth.

The common browser test harness gained only an optional exact SPKI pin and a CDP session command seam to test owned tabs. The G2 dynamic Sender gained only linkMode forwarding; its Direct Leg and send qualification checks are unchanged. No new dependencies or database functions were added.

Additional integration files beyond the new member modules are deliberate: the existing Reporter HTTP facade selects the member handler before legacy routing; the P2-016 Runtime composes that extension and closes its ephemeral state; the P2-012 Incident adapter receives the existing read transaction and retention filter. G2 manifest/schema, Controller, process-role and network boundary bind member policy/proof and pass application credentials only to App. Two prior negative tests now construct the complete live-shaped synthetic fixture instead of manually changing only its mode; their authorization and network assertions remain intact. The new bind/check/serve scripts respectively bind recorded automation, verify offline readiness and provide the unexecuted deployment entry point. The actual changed-file inventory is `evidence/p2-g2-yxx-entry-change-inventory.json`.

Current stop: live identity proof pending; targeted live NOT_RUN; P2-G2-LIVE NOT_RUN and unauthorized; P2-008 blocked. The runbook is `docs/runbooks/yixiaoxiu-member-ticket-entry.md`; its future actions have not been executed.
