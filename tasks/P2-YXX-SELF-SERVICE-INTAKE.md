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
| YXX-SS-007 | COMPLETE | `evidence/yxx-ss-007-completion-reconciliation.json`: v33 sources/TAP verified, final PR review and merge reconciled |
| YXX-SS-008 | COMPLETE | `evidence/yxx-ss-008-pr18-readiness-report.json`: PR18 readiness repair, isolated PostgreSQL/HTTP/browser/Worker, full regression and two independent reviews |
| YXX-SS-009 | IMPLEMENTATION_AND_AUTOMATION_COMPLETE / local PASS | `evidence/yxx-ss-009-r7-report.json`; PR #19 discussion closeout is described below; no formal remote APPROVED claim |
| YXX-SS-010 | IMPLEMENTATION_AND_AUTOMATION_COMPLETE / READY_FOR_LIMITED_WRITE_LIVE | `evidence/yxx-ss-010-report.json`: 1217/1217 across 195 files; local strict readiness and two independent reviews PASS; live NOT_RUN |
| YXX-SS-011 | DEPLOYED / waiting A-B human click | `evidence/yxx-ss-011-live-deployment-report.json`; AC-095 through AC-102 NOT_RUN |

As of 2026-09-21, PR #19 at `0d1cfa2935f028ca5c0a97838615dad1ab453563`
remains open with all 13 review threads resolved and its five current checks
successful. The local published-history preflight and original strict readiness
entry also pass on that clean published checkout. This rechecks existing evidence;
it is not a new full PostgreSQL/browser regression. The machine plan's pending
formal remote review field and immutable r7 report are not rewritten as APPROVED.
Follow [review closeout and evidence reduction](../.github/review/README.md#审查结束条件与后续减量)
for repeat findings and future work. Evidence reduction is a separate pending
change, not an additional SS-009 acceptance condition.

## SS-008 execution baseline

The user authorized completion reconciliation and continuation on merged main
`2d9fda2065b1303620f247a9e4d9754f0a3472d9` (tree
`b1397a10f7c11ec74c85d3582fd44a5e234302c4`). The original base above remains
historical. This run permits local commits only; push/PR/merge/tag remain forbidden.

## SS-010 execution baseline

The user explicitly rebased the new task scope onto PR #19's merge commit
`c1af81a86951054f4898f043c43381a5842abbf2` (tree
`54969cbcd2785f62b562ac32aa431e16ee300bd8`). PR #19 is merged; its earlier open
status above is the recorded review-closeout snapshot. This does not rewrite
r7's historical remote-review field as APPROVED.

SS-010 permits local implementation, isolated validation, independent reviews
and ordinary local commits only. No push/PR/merge/tag or live work. Its independent
two-role dedicated-test-database runtime and owner authorization are specified
in ADR-0022 and the [limited-write preparation runbook](../docs/runbooks/yixiaoxiu-limited-write-preparation.md).
SS-011 remains NOT_AUTHORIZED and the parent Gate does not advance.

The tested source commit is `c8e561a9cc58df1bf0c2c73a840001f9374c91f5`;
the full run reports an unchanged candidate and zero failed/cancelled/skipped/todo
tests. AC-091 through AC-094 are PASS in the new SS010 report; the old SS009 matrix
remains unchanged. Only local commits were made. Remote CI/review are NOT_RUN.
Formal natural GC, physical 2C4G and 60-minute observation remain NOT_RUN.

## SS-011 offline preparation

The user requested implementation of the SS-011 plan, including its explicit
pending-environment and separate live-approval stops. Offline preparation is
recorded in `evidence/yxx-ss-011-preparation-report.json`; the operational checklist
is `docs/runbooks/yixiaoxiu-ss011-execution.md`. The GitHub-observed PR20 merge is
`a58577d66733b3ec39f5d74af9ff44c70b79fe38`. Its PR-head CI has two SUCCESS and two
SKIPPED jobs, and a Codex no-major-issues comment, not a formal APPROVED review.
This successor observation does not rewrite SS010's historical remote fields.

The user subsequently authorized the local workstation to control the live
window and confirmed that A/B can click the WeCom member entry. The current
candidate is deployed in a stopped-Gateway state: `/wecom/yixiaoxiu/` now emits
the real OAuth redirect, while the previous OAuth-only container is preserved
and stopped. The unified management workbench is deployed loopback-only on
port 43124 and is reachable after an SSH local tunnel at
`http://127.0.0.1:43124/workbench/lifecycle`; its short-lived staff cookies are
kept in protected cloud state. Nginx was not changed and no public workbench
route was added. See `evidence/yxx-ss-011-live-deployment-report.json`.
Target host/database, actors, window, permissions and archival details remain
pending in `plans/yxx-ss-011-execution-inputs.json`. The live matrix remains NOT_RUN;
no live authorization, deployment, OAuth, database connection or Gate advancement
has occurred during this preparation.

Subsequent user authorization permitted use of the configured cloud host,
configuration backups, a dedicated test database, A/B as both reporters and staff,
A as owner, and restore into an independent drill database. This cloud preparation
is complete, including real backups, isolated restore verification and new-test-DB
migrations. The original source database, configuration and running OAuth/nginx
services are preserved. The drill database is retained with connections disabled.
See `evidence/yxx-ss-011-cloud-preparation-report.json` for current facts and retained
failed attempts. This supersedes the offline-only operational snapshot above;
it does not authorize or claim completion of the still-unexecuted Web live matrix.
