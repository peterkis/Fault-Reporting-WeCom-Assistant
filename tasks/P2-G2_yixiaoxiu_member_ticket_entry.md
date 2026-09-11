# P2-G2-YXX-TICKET-ENTRY

Status: READY_FOR_TARGETED_LIVE_VALIDATION. Implementation: IMPLEMENTED; automation: VERIFIED; identity namespace: LIVE_VERIFICATION_PENDING. Parent: P2-G2 / ASSEMBLY. Date: 2026-09-11.

Input: baseline `4cecdb5551da455a8b0a6c877f7f0a63ffa6eec9`, user-approved v1.0 member ticket entry prompt, existing OAuth, Reporter, Ticket source Intake and notification bindings.
Output: member-authenticated single-Ticket read entry, canonical and historical card adapters, shared safe query, minimal browser page, isolated PostgreSQL/HTTP/Edge automation, current-candidate evidence and an unexecuted targeted-live runbook.

Authorization: `evidence/p2-g2-yxx-entry-start-authorization.md`. Design: `docs/p2-g2-yixiaoxiu-member-ticket-entry.md`; accepted decision: `adr/0018_yixiaoxiu_member_ticket_entry.md`.

Contract: server-selected MEMBER_REQUIRED or explicit LEGACY_BOUND_GRANT; OAuth authentication plus per-request ownership, never membership alone. Closed request/response schemas and both OpenAPI route matrices are synchronized.

Database: no DDL or migrations; preserve 001–032 and grant_id NOT NULL UNIQUE. Only isolated fixtures and accurate access audits may be written. No new persistent member Session, Grant or Ticket to represent web login.

Validation: user prompt YXX-01–YXX-48, Unit/Contract, real isolated PostgreSQL + HTTP, real Edge redirect/Cookie/callback, stop/restart, resource limits, existing full runner including P2-007. Known gaps receive genuine RED before repair; additional regression is labelled accurately. Final SPEC and STANDARDS review independently inspect the exact candidate.

Safety: every API and 304 authorizes current OAuth identity against authoritative Ticket/source Intake and active public ref. Legacy cookies cannot bypass MEMBER_REQUIRED. Logging contains no raw identity or credentials. Web login creates no Direct Leg or private-send eligibility.

Resource limits: one App, existing pool max4, 32 concurrent reads, pending intents max1024 and max8 per browser, authentication session max15 minutes, provider concurrency1/deadline5 seconds/64KiB, page max100 rows.

Feature flag: reporterMemberEntry.enabled is strict boolean, default false. Persistent business flags remain false. MEMBER_REQUIRED misconfiguration fails closed; disabling the entry never selects legacy fallback.

Rollback: stop the owned local profile, expire all ephemeral authentication/intent state, retain business facts. No down migration, broad cleanup or user-file restoration.

Completion requires current full regression, all 48 assertions, evidence binding, independent review and cleanup. Unknown real identity namespace remains an explicit live prerequisite. No real WeCom calls/data/sends, cloud writes, formal observation, P2-G2-LIVE, P2-008, push, PR, merge, tag or release.


Current evidence: evidence/p2-g2-yxx-entry-report.json; 1029/1029 full regression over165files,48 member scenarios and both independent review axes PASS. Parent last-completed pointers remain unchanged; no targeted-live or Gate authorization is inferred.
