# ARCH-005 Time Inventory Before Migration

## Result

The frozen `001`–`021` migration chain produces 77 project-owned timezone-bearing columns in the current populated Pilot database. No database was assumed empty. The migration must preserve all authoritative P1, Ticket, Communication, Control, replay, and idempotency facts while changing the temporal representation.

The machine-readable, per-table and per-column inventory is in `evidence/arch-005-time-inventory-before.json`.

## Start identity and data safety

- Branch: `arch/asia-shanghai-local-time`
- Baseline: `358d9f69392141401c4ca3b7ba46294541d2a696`
- Staging package: `staging/p2-007-domain-package-v1.2` at `c37bea8a66d69b38f6d2182702cb5d9f89f1a884`; not present in ARCH-005 history
- Worktree at Gate: clean; `origin/main...HEAD = 0 0`; `git diff --check = 0`
- Pilot database: populated; 34 owned tables enumerated before migration
- Catalog SHA-256: `becc48193733f8234a997f3043e0f8a5fb172acc246f035cef4e7fcef1d56041`
- Catalog inventory: 375 columns, 641 constraints, 105 indexes
- Encrypted backup and isolated restore: `SUCCEEDED`, artifact SHA-256 `796c05cb740c25e0c33b6ae01e84f589c1e41ea7092db17e81cbbce3e047c6d7`, 13 objects verified

## Counts

| Asset | Before count | Treatment |
|---|---:|---|
| Live owned-schema forbidden columns | 77 | Explicitly convert in migration 022; final count must be 0 |
| Frozen migration `TIMESTAMPTZ` declaration locations | 75 | Keep migrations 001–021 immutable; supersede through migration 022 |
| Conceptual schema draft forbidden occurrences | 58 | Rewrite the draft to the new contract; it remains non-executable |
| SQL time construct occurrences | 183 | Review defaults, comparisons, ordering, lease, retry, expiry, and retention semantics |
| JSON Schema/OpenAPI `format: date-time` occurrences | 41 across 21 files | Replace project business time with shared LocalDateTime; epoch values remain strings |
| JavaScript Date constructs | 368 (`src` 155, scripts 37, tests 175, web 1) | Keep Date only in clocks/adapters/formatter internals; remove from domain/API/SQL/hash/UI paths |
| JSON/JSONL time-like fields | 171 across 25 files | Migrate active contracts/fixtures; preserve frozen historical Evidence |
| Historical Evidence exemptions | 88 | Do not batch rewrite 87 P2-G1 live-E2E plus 1 resource-observation occurrence |

## Classification

| Classification | Owned DB columns | Required migration |
|---|---:|---|
| `BUSINESS_LOCAL` | 59 | `timestamp without time zone`, explicit `AT TIME ZONE 'Asia/Shanghai'`, second precision, local default where applicable |
| `EXTERNAL_SOURCE_INSTANT` | 2 | Preserve provider/receive epoch string as BIGINT and derive LocalDateTime once at the Adapter boundary |
| `TECHNICAL_DEADLINE` | 13 | Add authoritative non-negative BIGINT `*_epoch_ms`; local `*_at` is display-only and constrained to the same second |
| `ELAPSED_TIME_ANCHOR` | 3 | Add BIGINT epoch anchors for delivery send/attempt measurement; do not subtract LocalDateTime values |
| `DERIVED_DISPLAY` | 1 UI path | Render server canonical LocalDateTime directly; browser timezone must not affect output |
| `HISTORICAL_EVIDENCE_EXEMPTION` | 88 JSONL fields | Preserve immutable historical text |

## Owned schemas

The active owned inventory is `channel`, `intake`, `pilot_ticket`, `notification`, `operations`, `conversation`, `communication`, and `platform`. `integration` is reserved for explicit registration when a future authorized migration creates it. PostgreSQL system schemas and third-party databases are excluded.

## Ordering, hash, and rebuild risk

- LocalDateTime is not an ordering uniqueness mechanism. Existing `sequence_no`, `event_id`, `event_ordinal`, `aggregate_version`, UUID, and stable keyset tie-breakers remain authoritative.
- P2-002 `source_hash`, `content_hash`, `canonical_order_key`, and checkpoint facts must not be silently rewritten. Timeline items are a rebuildable read model, so representation changes require the existing explicit rebuild/reprojection flow and Evidence.
- P2-003 `payload_hash` and `event_hash`, SSE `Last-Event-ID`, replay floor, and retention order remain event-ID based. Expiry moves to epoch milliseconds.
- P2-004 `command_hash` and `content_hash`, delivery idempotency, worker claim, retry, lease, kill/restart, and reconciliation semantics move to authoritative epoch fields without duplicate delivery.
- P2-005 request/command hashes and control event ordering remain stable; `event_ordinal` is the same-second tie-break.
- P2-006 keyset cursors carry canonical LocalDateTime plus `session_id`; waiting duration uses epoch milliseconds and never parses LocalDateTime.

## P2-007 boundary

The read-only v1.2 staging decision package contains multiple `format: date-time` definitions that conflict with ARCH-005. It is not imported in this task. A later separately authorized P2-007 flow must upgrade it to v1.2.1 or later, regenerate manifests/hashes, and apply the migration note in `docs/49_p2_007_time_contract_migration_note.md`.
