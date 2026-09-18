# P2 YXX self-service intake

This task group is the local implementation of the fixed 医小修 homepage and
member self-service intake. The authoritative specification remains the
checked-in plan package at
`D:/Projects/CodexPlans/yixiaoxiu_self_service_tickets_v1/`.

## Baseline

- Base branch: `main`
- Base commit: `4820dc8cde548f81db39e9159c5dbf00c0c006d5`
- Base tree: `9526b93b07fc36ccf0adfed680f849118db6f936`
- Fixed homepage: `https://chengdu.mobimedical.cn/wecom/yixiaoxiu/`
- Scope: local implementation, isolated PostgreSQL/HTTP/browser checks, and
  readiness evidence only.

## Stop lines

The implementation never calls a real OAuth provider or WeCom SDK, opens a
production or hospital database, sends a message, connects through SSH,
deploys, or enables AI/OCR/RAG/intranet/P3. `YXX-SS-011`, `P2-G2-LIVE`, and
`P2-008` remain outside this task group. Persistent feature flags default to
false.

## Dependency ledger

```text
SS-000 -> SS-001
SS-000 -> SS-002 -> SS-003 -> SS-004 -> SS-006
SS-003 -> SS-005
SS-001 + SS-002 -> SS-007
SS-004 + SS-005 + SS-006 + SS-007 -> SS-008 -> SS-009 -> SS-010
SS-011 requires a separate live authorization.
```

Each ticket is completed with its own tests and evidence, committed on this
branch, pushed to its review branch, and held until the corresponding review is
resolved before the next dependent ticket starts.
## Current status

| Ticket | Status | Evidence |
|---|---|---|
| YXX-SS-000 | COMPLETE | this ledger, imported task index and committed contract baseline |
| YXX-SS-001 | COMPLETE | bounded homepage OAuth return tests and runbook |
| YXX-SS-002 | COMPLETE | closed Web/API contract schemas, types and freeze runbook |
| YXX-SS-003 | COMPLETE | immutable migration 033 plus forward correction 034, catalog checks and isolated Web storage tests |
| YXX-SS-004 | COMPLETE | shared rule/Ticket/Review orchestration, command boundary, lifecycle projection and isolated DB evidence |
| YXX-SS-005 | COMPLETE | member query authorization, mixed Web/Bot pagination and safe progress evidence |
| YXX-SS-006 | COMPLETE | supplement command, revision/race/recovery integration evidence |
| YXX-SS-007 | IN_REVIEW | current aggregate: `evidence/yxx-ss-007-current-readiness-v33.json`; historical reports remain non-current |
| YXX-SS-008..010 | PLANNED | depend on SS-007 review and real local DB/HTTP assembly |
| YXX-SS-011 | NOT AUTHORIZED | intentionally out of scope |
