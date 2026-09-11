# 医小修成员工单入口设计

Design authorized 2026-09-11; implementation and validation not yet complete. Authority: ADR-0018 and `tasks/P2-G2_yixiaoxiu_member_ticket_entry.md`.

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

Authorizer joins active Reporter public ref to the unique Ticket and its source Intake, checks provider/Bot/reporter and the existing SHA256(JSON.stringify(['WECOM_AIBOT', bot, reporter])) binding. Ticket/ref have no invented expires_at. Actual retention fields and transaction linearization are to be documented from schema and integration evidence before completion. Closure is not revocation.

The member facade holds authentication, authorization and safe queries in one transaction; revocation order is defined by its public-ref lock. A second authentication check before response rejects logout/expiry during awaits. A response already delivered cannot be recalled. Reads, including conditional 304, never use ETag as authorization.

## Grant, sessions and intent

No DDL. Grant consumption and reporter_access_session.grant_id NOT NULL UNIQUE remain unchanged. Member reads create neither row. Access audit session_id/actor_principal_id stay NULL. Shared query keeps the existing public projection; no duplicated SQL or staff query proxy.

Legacy prepare clears the fragment immediately, checks length/encoding, stores only Grant UUID/digest plus browser binding and deadline, then redirects through OAuth. Current HMAC/digest and ownership are checked after authentication. ISSUED/CONSUMED/EXPIRED only locate; REVOKED or invalid binding/signature reject without Grant mutation. Process restart or intent expiry requires a fresh click.

Opaque random browser-bound OAuth states are independent per tab (max8/browser, 1024 global); finishing A does not remove B. Browser binding is server-recognized. Logout and identity replacement invalidate old sessions; late results cannot restore them. Sessions expire after15 minutes without polling extension. No realtime directory revocation is claimed; an independently changed member status may remain unknown within the session lifetime.

## UI and transport

Reuse native Reporter layout and safe textContent rendering. Explicit authenticating/loading/empty/denied/expired/unavailable states. One refresh task, five-second visible-page polling, cancellation on pagehide/logout, fresh authorization on pageshow, clear sensitive DOM/ETag/cursor on identity/ref/auth failure, and ETag accepted only after detail+Timeline success. Maximum100 items. Shanghai text unchanged in UTC/Tokyo/NewYork browsers.

HTTPS Secure HttpOnly __Host cookies, exact Host/origin, fixed callback/redirect destinations, no-store/no-referrer, CSP self assets without unsafe-inline/eval, no wildcard CORS. POST verifies same-origin context. Stable closed errors: authentication401, member scope403, nonexistent/non-owned404, input400, capacity/dependency503; existing OAuth502 preserved.

## Profiles, evidence and stop

OAUTH_ONLY: no database or business API. MEMBER_TICKET_READONLY: existing pool max4, authentication and single-Ticket reads/audit only. FULL_SERVICE_LOOP: same member extension in the existing App; Worker/Gateway unchanged. No new sender/worker/pool. Each profile must close only owned resources.

YXX-01–48 and the existing976/158-file baseline must be bound to the new candidate, along with37 G2 scenarios,202 source audit and10 PR #6 invariants. Source/preparation checks are separate from current READY and live approval. No full test runs while editing candidate files.

Current stop: implementation pending; live identity proof pending; targeted live NOT_RUN; P2-G2-LIVE NOT_RUN and unauthorized; P2-008 blocked. Generate the later targeted runbook without executing it.
