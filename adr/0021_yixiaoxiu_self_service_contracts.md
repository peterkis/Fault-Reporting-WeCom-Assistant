# ADR-0021: 医小修网页自助报修契约与来源边界

Status: Accepted for local implementation on the `phase2/yixiaoxiu-self-service-intake` lane. This is not a live or deployment approval.

## Decision

### 2026-10-05 authorized local product increment

YXX-UI-003 adds a protected same-origin, no-store `GET /api/yixiaoxiu/service-catalog` to the original seven-route baseline. It exposes only a bounded version and enabled service codes, Chinese names and categories from the existing rule catalog, never internal routing configuration. Web service codes retain the 64-character/null boundary and accept the catalog's dotted segments in addition to the original undotted codes. A failed catalog read leaves text intake available. This additive contract is authorized for local implementation/review only; flags, Ticket authority, database schema and live boundaries remain unchanged.

- A web submission is `source_channel=PORTAL`, `source_provider=YIXIAOXIU_WEB`,
  `entry_mode=APP_WEB_SELF_SERVICE` and `leg_type=WEB_FORM`.
- `WEB_FORM` owns a real `web_submission` reference and leaves Bot message,
  Inbox, Conversation Thread, Conversation Session and Direct Leg references
  NULL. Existing Bot source constraints remain intact.
- `intake.web_request_binding`, `intake.web_submission` and
  `intake.web_command_receipt` are technical web-source objects. They do not
  own Ticket state; Unified Ticket Core remains the only Ticket authority.
- The API surface is the original seven routes plus the authorized catalog increment above. All writes
  use the current member Cookie, CSRF/origin checks, a closed JSON shape and an
  idempotent command ID. The server derives identity and source fields.
- `MEMBER_TICKET_READONLY` rejects every web write even if a write flag is
  accidentally true. `OAUTH_ONLY` touches no database. `MEMBER_SELF_SERVICE`
  permits an App-owned bounded processor only when both persistent flags are
  true. `FULL_SERVICE_LOOP` uses the existing Worker and never starts a second
  pump. Web lifecycle output is `APP_ONLY`; it creates no Message, Outbox,
  Delivery, Grant or WeCom send.

## Compatibility and migration

Migration 033 is immutable after application. It may make conditional Web
columns nullable and add source-branch checks/FKs, but it does not alter
migrations 001–032 or create a second Ticket Core. Forward migration 034
corrects the preserved Bot single/group chat-ID check without rewriting 033.
The exact catalog delta and both checksums are recorded in
`docs/runbooks/yixiaoxiu-self-service-contract-freeze.md` and verified by the
migration tests before any runtime path is enabled.

## SS-008 local assembly clarification

SS-008 explicitly integrates the ADR-0019 verified delegated mapping adapter
into MEMBER_SELF_SERVICE and FULL_SERVICE_LOOP locally. Its config hash,
corp/app scope, approved member list and proof requirements remain mandatory;
raw same-namespace matching is not substituted. This supersedes only the prior
standalone-readonly assembly restriction, and authorizes no live conversion,
deployment, sending or additional members.

Disabling SELF_SERVICE_ENABLED closes new writes and the processor, while
MY_REPORTS_ENABLED may retain already-authorized reads and command recovery.
The bootstrap reports read_only and no write capabilities in that mode. The
original profile/schema freeze is historical; the current profile contract
expresses this shutdown state. All persistent defaults remain false.

Sessionless Web Ticket realtime retains the existing SYSTEM envelope. Internal
handlers receive only explicitly authorized Ticket aggregate IDs (same team or
assignee predicate as the Ticket query), before SQL LIMIT/payload materialization.
Those IDs share the existing 256-scope bound. ADMIN/DISPATCHER system access and
manual-review restrictions stay unchanged; no fake Session or new DB scope is
created. Realtime remains a projection, never a member authentication mechanism.
