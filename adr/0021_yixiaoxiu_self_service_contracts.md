# ADR-0021: 医小修网页自助报修契约与来源边界

Status: Accepted for local implementation on the `phase2/yixiaoxiu-self-service-intake` lane. This is not a live or deployment approval.

## Decision

- A web submission is `source_channel=PORTAL`, `source_provider=YIXIAOXIU_WEB`,
  `entry_mode=APP_WEB_SELF_SERVICE` and `leg_type=WEB_FORM`.
- `WEB_FORM` owns a real `web_submission` reference and leaves Bot message,
  Inbox, Conversation Thread, Conversation Session and Direct Leg references
  NULL. Existing Bot source constraints remain intact.
- `intake.web_request_binding`, `intake.web_submission` and
  `intake.web_command_receipt` are technical web-source objects. They do not
  own Ticket state; Unified Ticket Core remains the only Ticket authority.
- The API surface is the seven routes in the YXX OpenAPI contract. All writes
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
