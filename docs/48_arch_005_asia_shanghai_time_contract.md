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

### H5 department read adapter (2026-10-21)

Under [ADR-0036](../adr/0036_yixiaoxiu_h5_performance_read_and_media_budgets.md), the initial adapter permitted the `departmentReportsSql` and `departmentInTransaction` constructors in `src/yxx-h5-v2-profile.mts` to expand the existing formula. The subsequent sealed-batch revision moves those closed fragments into `h5DepartmentDirectorySql`, `h5DepartmentReportsSql` and `h5DepartmentPageSql` in [the shared static SQL adapter](../src/yxx-h5-batch-sql.mts); independent reads and sealed batches select fixed local mappings from the same constructors. Only these department read constructors may expand the formula:

```sql
pg_catalog.floor(EXTRACT(epoch FROM pg_catalog.clock_timestamp())
  OPERATOR(pg_catalog.*) 1000::pg_catalog.numeric)::pg_catalog.int8
```

Each original clock guard keeps its own expression at the original evaluation boundary. The adapter preserves numeric milliseconds, floor and BIGINT conversion; it must not introduce a shared clock parameter, single-row CTE, InitPlan, transaction/statement time, or STABLE/IMMUTABLE clock. Function, operator and type qualification protects the formula from a changed `search_path`. This is a local SQL adapter, not a change to migration 022, the global function definition, any other caller, or the time contract inventory. PostgreSQL documents [per-row volatile evaluation](https://www.postgresql.org/docs/18/xfunc-volatility.html) and [physical clock changes within a statement](https://www.postgresql.org/docs/18/functions-datetime.html).

The adapter keeps all source, binding, retention, current membership and post-wait terminal checks. Its acceptance requires real expiry and controlled-wait cases, numeric floor boundaries, timezone/search-path cases, equivalent DTOs and constrained execution plans. Tests that replace `platform.physical_epoch_ms()` do not exercise an expanded formula and cannot substitute for these cases. If the helper's ACL or replaceable clock becomes a governance boundary, this narrow exception must be reviewed again. Clock-adapter rollback restores the helper expression in the shared constructors, without modifying persisted data or historical migrations; disabling performance reads separately restores the original HTTP read path.

ADR-0036 additionally permits the narrowly scoped sealed in-flight H5 batch adapter. Each participant obtains its own current directory proof in the batch statement; only exactly equal authorized sets and read rules share that statement's source scan. Distinct source guards retain the qualified formula above and independently sample the physical clock. The batch deliberately reduces repeated evaluation across participating HTTP requests; it does not cache a clock value or claim the old per-HTTP call multiplicity. No request may attach after dispatch or reuse a completed result, and every participant still performs its own new-statement membership and outer READ terminal checks. This forward exception applies only to that adapter, not independent queries or any global time helper; original physical-expiry and controlled-wait acceptance remains required.

## Workbench and Evidence

Workbench renders the server LocalDateTime text directly as `YYYY-MM-DD HH:mm`, so UTC, Asia/Tokyo, and America/New_York browser settings show the same value. New structured Evidence uses both `event_time` LocalDateTime and `event_epoch_ms` PhysicalEpochMs. Historical Evidence is not rewritten.

## Closure and stop line

Automated acceptance advanced ARCH-005 only to `READY_FOR_TARGETED_LIVE_REVALIDATION`. The separately authorized targeted live revalidation passed on 2026-09-03; closure Evidence is `evidence/arch-005-targeted-live-revalidation.md`. P2-007 remains `TODO / REQUIRES_SEPARATE_AUTHORIZATION`; DeepSeek, OCR, Incident, P2-G2/P3, production/clinical enablement, and all Feature Flags remain unauthorized.

## 当前授权状态（2026-09-08）

上文阶段授权描述保留其历史时点；当前 P2-007、P2-015、P2-016、P2-012 已完成。当前仅 P2-G2 / ASSEMBLY 获独立准备授权，执行到 READY_FOR_LIVE_E2E 后停止；真实发送、云主机变更、现场写库、正式观察及 Gate 批准均须另行授权。P2-008 保持阻断，全部持久 Feature Flag 默认 false。依据 `evidence/p2-g2-start-authorization.md`；未改变本文件的领域契约或历史完成 Evidence。
