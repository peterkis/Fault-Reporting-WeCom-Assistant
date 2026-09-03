# ARCH-005 Targeted Live Revalidation

- Evidence time: `2026-09-03 14:52:51`; PhysicalEpochMs: `1788418371611`
- Live candidate: `82c5d035693705ae3af9290cb3f0af9c3183e900`
- Branch: `arch/asia-shanghai-local-time`
- Outcome: `PASS`

One authorized real test-group mention produced exactly one completed Channel Message, one Incident Intake, one queued Ticket, and one Conversation Session. The adapter recorded `received_at = 2026-09-03 14:10:42` with authoritative `received_epoch_ms = 1788415842978`; raw tenant and participant identifiers are not recorded in this Evidence.

Chrome displayed the real Timeline using canonical local business time: inbound `2026-09-03 14:10`, controlled-failure reply `14:26`, and acknowledged reply `14:33`. The Windows system timezone was changed to UTC, Tokyo Standard Time, and Eastern Standard Time; a fresh Workbench reload in every timezone displayed the same values with no T, Z, offset, or browser-timezone drift. The original `China Standard Time` was restored.

The Gateway fault drill disconnected the authenticated Gateway before an authorized human reply was queued. The Worker performed attempts 1–5 using PhysicalEpochMs anchors. Attempts 1–4 were `RETRY_SCHEDULED`; attempt 5 became the expected controlled `DEAD_LETTER`, always with stable `GATEWAY_UNAVAILABLE`, zero Provider calls, and `NOT_ATTEMPTED` side-effect state. This expected fault artifact is retained. It is not deleted or represented as delivered; unexplained Dead Letter delta is zero. There were no missing epoch anchors, negative elapsed intervals, blind sends, unknown side effects, or lease regressions.

After controlled Gateway reconnect and reauthentication, a separately confirmed human reply was delivered once: one Message, one Delivery, one Attempt, final `SENT`, `ACKNOWLEDGED`, Provider receipt present, `sent_at = 2026-09-03 14:33:57`, and `sent_epoch_ms = 1788417237070`. The enterprise WeCom client displayed the reply exactly once. Duplicate Provider receipt count is zero.

The 600-second observation retained 11 samples with three Runtime role processes plus one loopback-only authentication helper. RSS changed from 297000960 to 298778624 bytes (maximum 298778624; growth 1777664) with no abnormal sustained monotonic growth. Handles were at most 957, owned TCP sockets at most 15, PostgreSQL utilization at most 5%, SSE clients never fell below one, and the Gateway was authenticated for every sample. Projection backlog/failures, Communication pending, Dead Letter delta during observation, and Reconciliation delta were all zero. Cleanup left zero Runtime role processes and zero loopback listeners.

Final catalog and runtime checks report zero forbidden timezone columns, Timeline/Realtime business-time inversions, delivery backlog, reconciliation-required deliveries, duplicate deliveries, lease regressions, browser timezone mismatches, API offset leaks, and fake source conflicts.

Post-live automated regression was reconfirmed: P1 `150/150`, P2 unit `151/151`, P2 PostgreSQL integration `52/52`, Workbench/P2-G1 system browser `5/5`, ARCH-005 unit/architecture `7/7`, ARCH-005 PostgreSQL integration `4/4`, V1.4 architecture tests `14/14`, and the V1.4 architecture validator `360/360`. Every suite reported zero failed, cancelled, skipped, and todo tests; `p2:g1:check` also passed.

This Evidence closes ARCH-005 only. P2 remains `IN_PROGRESS`; `last_completed_task` remains P2-006 and `last_completed_gate` remains P2-G1. P2-007 is `TODO / REQUIRES_SEPARATE_AUTHORIZATION`; DeepSeek, OCR, Incident, P2-G2/P3, production/clinical enablement, and every committed Feature Flag remain unauthorized/off. No push, merge, tag, release, historical Evidence bulk rewrite, migration 001–021 modification, or line-ending renormalization was performed.
