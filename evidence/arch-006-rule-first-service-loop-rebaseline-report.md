# ARCH-006 Rule-First Service Loop Rebaseline Report

## Result

ARCH-006 is `DONE` as an architecture, plan, task, Gate, validator, test, and Evidence rebaseline only. Phase 2 remains `IN_PROGRESS`; `last_completed_task=P2-007`, `last_completed_gate=P2-G1`, and `last_completed_architecture_task=ARCH-006`. There is no active task or Lane. P2-015 is the next candidate and is not authorized.

## Delivered architecture

- Accepted ADR-0017 freezes rules and humans as the primary service path and AI as optional enhancement.
- Capability Gap Inventory proves nine existing capabilities and thirteen unassembled gaps without treating contracts or pure functions as production assembly.
- P2-015 and P2-016 are added as unauthorized future task cards; P2-012 keeps its original ID and moves before P2-008.
- P2-G2 is the deterministic full service loop; P2-G3 is AI Shadow; P2-G4 is Copilot + Media; P2-G5 is Controlled Auto + Phase 2 Go.
- Ten deterministic first-class results, the formal 90% safe-route metric, dual responsibility, Ticket Action/API/notification boundaries, Reporter-safe Timeline, human-confirmed Incident, split readiness, AI-off conditions, and default-false flags are frozen.
- Migration 030 and conditional 031 are reservations only. No SQL was created.

## Validation

Final validation results on 2026-09-03:

```text
node scripts/validate-arch-006-rule-first-service-loop.mjs
PASS: 259 checks

npm run validate:architecture:v1.4
PASS: 383 checks

npm run test:architecture:v1.4
PASS: 14/14; fail=0; cancelled=0; skipped=0; todo=0

node --test --test-concurrency=1 tests/arch-006-rule-first-service-loop.test.mjs
PASS: 6/6; fail=0; cancelled=0; skipped=0; todo=0

node --env-file=.env.pilot --test --test-concurrency=1 tests/*.test.mjs
PASS: 444/444; fail=0; cancelled=0; skipped=0; todo=0
duration_ms=302490.266
```

The first complete serial attempt is retained as a truthful failed run: 442/444 passed with two failures. One was an ARCH-005 architecture assertion that still expected ARCH-005 to be the latest architecture task and P2-008 to be the next candidate; it was updated to preserve ARCH-005 `DONE` while recognizing ARCH-006 and P2-015. The other was a transient existing mobile Edge wait timeout; an immediate isolated browser rerun passed 2/2 without Runtime changes, and the second complete serial run passed the same mobile test and all 444 tests.

## Scope proof

- Business Runtime changes: 0
- Database migration changes: 0
- AI Provider code changes: 0
- WeCom Sender changes: 0
- Unified Ticket Core runtime changes: 0
- Historical Evidence rewrites: 0
- `archive/` changes: 0
- Feature Flags enabled: 0
- Model Provider calls: 0

Only ARCH-006 governance, architecture, plans, future task definitions, indexes, validators/tests, new Evidence, and default-false example configuration are changed.

## Stop line

P2-007 remains `DONE`; P2-G1 remains `PASSED`; ARCH-005 remains `DONE`. P2-015, P2-016, P2-012, P2-008, and P2-G2 remain not started and require separate authorization. DeepSeek is not integrated. No Feature Flag is enabled. No push, merge, tag, release, real Incident, WeCom message, template card, Reporter Portal, or future Runtime work was performed.
