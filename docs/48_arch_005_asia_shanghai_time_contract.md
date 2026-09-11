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

Business time records when a business fact occurred; it never provides unique ordering. Every event stream therefore carries an explicit `sequence_no`, `ordinal`, `revision`, or `event_id`. Canonical ascending reads order by business time first and the stream's explicit sequence second:

```sql
ORDER BY business_time ASC, sequence_no ASC
```

Concrete mappings are: Conversation Timeline `occurred_at, sequence_no`; Realtime `occurred_at, event_id`; Ticket and Control Events `occurred_at/created_at, event_ordinal`; Delivery Attempts `started_at, attempt_no`. Descending UI views reverse both fields. Fractional timestamps, insertion order, and database physical order are forbidden tie-breakers. A Timeline sequence is allocated explicitly under the per-Session advisory lock; facts that arrive in the same business second append with that persisted sequence, while a fact whose business second is older than the persisted tail requires the authorized rebuild flow.

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

## Closure and stop line

Automated acceptance advanced ARCH-005 only to `READY_FOR_TARGETED_LIVE_REVALIDATION`. The separately authorized targeted live revalidation passed on 2026-09-03; closure Evidence is `evidence/arch-005-targeted-live-revalidation.md`. P2-007 remains `TODO / REQUIRES_SEPARATE_AUTHORIZATION`; DeepSeek, OCR, Incident, P2-G2/P3, production/clinical enablement, and all Feature Flags remain unauthorized.

## 当前授权状态（2026-09-08）

上文阶段授权描述保留其历史时点；当前 P2-007、P2-015、P2-016、P2-012 已完成。当前仅 P2-G2 / ASSEMBLY 获独立准备授权，执行到 READY_FOR_LIVE_E2E 后停止；真实发送、云主机变更、现场写库、正式观察及 Gate 批准均须另行授权。P2-008 保持阻断，全部持久 Feature Flag 默认 false。依据 `evidence/p2-g2-start-authorization.md`；未改变本文件的领域契约或历史完成 Evidence。
