# ARCH-005 Asia/Shanghai Local Business Time Contract

## Scope

The project has one business timezone: `Asia/Shanghai`. The contract applies to project-owned PostgreSQL schemas, domain/runtime values, APIs and JSON Schema, Workbench display, new logs/Evidence, and later P2/P3 work. PostgreSQL system schemas, third-party databases/SDK internals, immutable historical Evidence text, and raw external time before Adapter conversion are excluded.

## Types

| Type | Canonical API text | PostgreSQL | Meaning |
|---|---|---|---|
| LocalDate | `YYYY-MM-DD` | `date` | Hospital business date |
| LocalTime | `HH:mm` | `time without time zone` | Hospital business wall time |
| LocalDateTime | `YYYY-MM-DD HH:mm:ss` | `timestamp without time zone` | Asia/Shanghai business wall time at exact second precision |
| PhysicalEpochMs | non-negative decimal string | `BIGINT` | External instant, lease, retry, timeout, expiry, retention, or elapsed-time anchor |

LocalDateTime rejects `T`, `Z`, UTC/offset suffixes, fractional seconds, timezone names, whitespace, invalid calendar dates, non-strings, Proxy/accessor/toJSON objects, and polluted keys. APIs never serialize BIGINT epoch values as JavaScript Number.

## Ordering

LocalDateTime has only second precision. Deterministic order within the same second is carried by `sequence_no`, `event_id`, `event_ordinal`, `aggregate_version`, or a stable UUID/hash tie-break. Database insertion order and fractional time are never implicit tie-breakers.

## Database

Migration `022_arch_005_asia_shanghai_time_contract.sql` is the only migration that changes the frozen 001–021 result. It creates:

- `platform.local_now()` — transaction-consistent Asia/Shanghai LocalDateTime at second precision;
- `platform.physical_epoch_ms()` — physical wall-clock epoch milliseconds;
- `platform.local_from_epoch_ms(BIGINT)` — one-time boundary conversion;
- `platform.time_contract` — version, timezone, pattern, precision, activation anchors, and owned-schema inventory;
- `platform.forbidden_owned_schema_time_types()` and `platform.assert_time_contract()` — forbidden-type enumeration and stable validation;
- `platform.schema_migration` — checksum-bound current-baseline marker.

Connections created by `src/platform/postgres-pool.mjs` set `TimeZone=Asia/Shanghai` and `DateStyle=ISO,YMD`, preserve date/time/timestamp/timestamptz/tsrange/BIGINT as strings, and recursively reject JavaScript Date query parameters.

The owned inventory is `channel`, `intake`, `pilot_ticket`, `notification`, `operations`, `conversation`, `communication`, `platform`, and reserved `integration`. Registration of `integration` does not create or authorize P3.

## Deadlines and elapsed time

Every migrated deadline or elapsed anchor has an authoritative `*_epoch_ms` BIGINT. Its local `*_at` companion is a display/audit value constrained to the same second. Claim, retry, expiry, retention, waiting duration, and timeout comparisons use epoch values. A compatibility trigger protects frozen legacy isolated tests and derives a missing companion at the database boundary; current runtime paths pass/use epoch values explicitly.

## Workbench and Evidence

Workbench renders the server LocalDateTime text directly as `YYYY-MM-DD HH:mm`, so UTC, Asia/Tokyo, and America/New_York browser settings show the same value. New structured Evidence uses both `event_time` LocalDateTime and `event_epoch_ms` PhysicalEpochMs. Historical Evidence is not rewritten.

## Stop line

Automated acceptance advances ARCH-005 only to `READY_FOR_TARGETED_LIVE_REVALIDATION`. P2-007, DeepSeek, OCR, Incident, P2-G2/P3, production/clinical enablement, and all Feature Flags remain unauthorized.
