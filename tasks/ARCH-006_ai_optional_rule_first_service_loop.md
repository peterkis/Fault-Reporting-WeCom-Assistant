# ARCH-006 AI-Optional Rule-First Full Service Loop Rebaseline

> 历史范围（2026-09-03）：本架构任务已完成。下文 Acceptance/Stop line 仅描述当时任务与授权；它不是后续已授权 TypeScript 迁移的现行执行单。规则优先、AI 可关闭、单一 Ticket Core、Outbox、隐私和权限不变量继续适用。原日期、基线、验收与 Evidence 引用保留。

- Status: DONE
- Phase: P2 / IN_PROGRESS
- Lane: ARCHITECTURE
- Authorized at: 2026-09-03
- Completed at: 2026-09-03
- Baseline: `0a163528a94a15c5cbe6bc5e1e2063f5e0d746de`
- Branch: `arch/ai-optional-rule-first-service-loop`
- Authorization Evidence: `evidence/arch-006-start-authorization.md`
- Completion Evidence: `evidence/arch-006-rule-first-service-loop-rebaseline-report.md`
- Database change: none

## Objective

Freeze an AI-optional, rule-first, human-fallback full service loop before any AI Shadow work. Reorder future P2 tasks and Gates so deterministic intake, complete Ticket lifecycle, reporter-safe notification, and human-confirmed Incident are proven before P2-008.

## Inputs and outputs

- Inputs: frozen P1/P2-001 through P2-007 runtime, P2-G1 Evidence, ARCH-005 time contract, current plans and backlog.
- Outputs: ADR-0017, four Mermaid diagrams, docs 50–54, P2-015/P2-016 task cards, P2-012 future dependency update, capability-gap inventory, validator, architecture test, roadmap/backlog/index updates, and completion Evidence.
- Schema/Contract: architecture-only definitions; no executable Schema or migration.
- Migration: none; 030 and conditional 031 are reservations only.

## Acceptance

- AI-off core-loop invariants and split readiness are explicit;
- ten deterministic first-class results have complete decision contracts;
- P2-015/P2-016/P2-012 precede P2-008 and remain unauthorized;
- P2-G2 through P2-G5 have one consistent meaning everywhere;
- P2-007 remains DONE, P2-G1 remains PASSED, ARCH-005 remains DONE;
- all Feature Flag defaults remain false;
- architecture validator, targeted test, V1.4 tests, and full serial repository suite pass;
- changed paths contain no business Runtime, migration, WeCom sender, AI Provider, web, archive, or historical Evidence rewrite.

## Stop line

ARCH-006 completes definitions only. Do not start P2-015, P2-016, P2-012, P2-008, P2-G2, push, merge, tag, release, or enable any Feature Flag.
