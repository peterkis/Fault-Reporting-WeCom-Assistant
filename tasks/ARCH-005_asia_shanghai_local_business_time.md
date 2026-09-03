# ARCH-005 Asia/Shanghai Local Business Time Contract

- Status: DONE
- Phase: P2
- Lane: ARCHITECTURE
- Authorized at: 2026-09-03
- Baseline: `358d9f69392141401c4ca3b7ba46294541d2a696`
- Branch: `arch/asia-shanghai-local-time`
- Evidence: `evidence/arch-005-start-authorization.md`, `evidence/arch-005-time-inventory-before.json`, `evidence/arch-005-time-inventory-after.json`

## Objective

Establish one Asia/Shanghai business-time contract across project-owned PostgreSQL schemas, domain/runtime code, API/JSON Schema, Workbench, and newly generated Evidence. Preserve physical epoch milliseconds for external instants, deadlines, leases, retries, expiry, retention, and elapsed-time anchors.

## Inputs and outputs

- Inputs: frozen migrations 001–021, populated Pilot PostgreSQL, P1/P2 Human-only runtime and contracts, P2-G1 passed baseline.
- Outputs: migration 022, shared time/pg platform modules, migrated runtime/contracts/Workbench, current-baseline migrator, architecture validator, automated Evidence, and targeted-live-revalidation runbook.
- Database change: additive and converting migration 022 only; migrations 001–021 remain immutable.

## Completion boundary

Automated acceptance first set `READY_FOR_TARGETED_LIVE_REVALIDATION`. The separately authorized minimum live revalidation passed on 2026-09-03 and is recorded in `evidence/arch-005-targeted-live-revalidation.md`. P2-007 remains `TODO / REQUIRES_SEPARATE_AUTHORIZATION`; DeepSeek, OCR, Incident, P2-G2/P3, production/clinical enablement, and all Feature Flags remain unauthorized and disabled.

Automated migration, projection rehash/resequence, browser timezone matrix, and P1/P2/P2-G1 regressions passed on 2026-09-03. Targeted live revalidation also passed on 2026-09-03 with real test-group inbound, acknowledged human reply, Gateway fault/reconnect, a real Windows timezone matrix, and a 10-minute controlled resource observation. The controlled fault's expected Dead Letter Evidence is retained with zero Provider calls and zero unknown side effects.
