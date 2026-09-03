# ARCH-005 Asia/Shanghai Local Business Time Contract

- Status: IN_PROGRESS
- Phase: P2
- Lane: ARCHITECTURE
- Authorized at: 2026-09-03
- Baseline: `358d9f69392141401c4ca3b7ba46294541d2a696`
- Branch: `arch/asia-shanghai-local-time`
- Evidence: `evidence/arch-005-start-authorization.md`

## Objective

Establish one Asia/Shanghai business-time contract across project-owned PostgreSQL schemas, domain/runtime code, API/JSON Schema, Workbench, and newly generated Evidence. Preserve physical epoch milliseconds for external instants, deadlines, leases, retries, expiry, retention, and elapsed-time anchors.

## Inputs and outputs

- Inputs: frozen migrations 001–021, populated Pilot PostgreSQL, P1/P2 Human-only runtime and contracts, P2-G1 passed baseline.
- Outputs: migration 022, shared time/pg platform modules, migrated runtime/contracts/Workbench, current-baseline migrator, architecture validator, automated Evidence, and targeted-live-revalidation runbook.
- Database change: additive and converting migration 022 only; migrations 001–021 remain immutable.

## Completion boundary

Automated acceptance can only set `READY_FOR_TARGETED_LIVE_REVALIDATION`. Completion requires the separately executed minimum live revalidation and project-owner approval. P2-007 remains `TODO / BLOCKED_BY_ARCH_005`; DeepSeek, OCR, Incident, P2-G2/P3, production/clinical enablement, and all Feature Flags remain unauthorized and disabled.
