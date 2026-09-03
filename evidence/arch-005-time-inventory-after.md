# ARCH-005 Time Inventory — After

- Evidence time: `2026-09-03 13:27:03` / epoch ms `1788413223666`
- Automated status: `READY_FOR_TARGETED_LIVE_REVALIDATION`
- Business timezone: `Asia/Shanghai`; LocalDateTime precision: second
- Migration 022 checksum: `dd31f84d9afdea32cf298680e57baeb6834a6930727daa9eb1f2df9331e16cba`
- Owned schemas: channel, intake, pilot_ticket, notification, operations, conversation, communication, platform, integration
- Converted forbidden timezone columns: 77; remaining: 0
- Final owned columns: 79 `timestamp without time zone`, 47 BIGINT, including 24 explicit `*_epoch_ms` columns
- Platform functions: `local_now`, `physical_epoch_ms`, `local_from_epoch_ms`, forbidden-type inventory/assertion, and local/epoch compatibility synchronization; all are SECURITY INVOKER
- PostgreSQL client boundary: date/time/timestamp/legacy timestamptz/tsrange/BIGINT remain strings; recursive Date SQL parameters are rejected

Event ordering is explicit: business time first, then `sequence_no`, `event_id`, `event_ordinal`, `attempt_no`, or revision as appropriate. Timeline uses `occurred_at, sequence_no`; Realtime uses `occurred_at, event_id`. The authorized projection rebuild converted 647 Timeline hashes and 649 Realtime hashes, then resequenced 649 derived Realtime events to remove 10 historical business-time inversions. A repeat run changed zero rows. No authoritative P1/Ticket/Communication/Control fact and no projection row was deleted.

Automated regression: P1 150/150; P2 unit 151/151; P2/P2-G1 integration 52/52; ARCH-005 unit/browser 7/7; ARCH-005 PostgreSQL 4/4; P2-006/P2-G1 system browser 5/5. All reported fail/cancelled/skipped/todo counts are zero. Static and runtime hard gates are zero for forbidden types, API offset leaks, Date SQL parameters, browser timezone mismatch, ordering violations, fake source conflicts, duplicate delivery, lease regression, and projection backlog.

This is not closeout Evidence. Targeted live revalidation has not run. P2-007 remains `TODO / BLOCKED_BY_ARCH_005`; DeepSeek, OCR, Incident, P2-G2/P3, production/clinical enablement, and every Feature Flag remain unauthorized/off. No push, merge, tag, or release was performed; historical Evidence was not bulk rewritten; migrations 001–021 were not modified.
