# SS-011 AC-098/099 automated follow-up — 2026-09-21

Command:

`node --env-file=.env.pilot --test tests/yxx-ss-009-http-recovery.integration.test.mjs tests/yxx-ss-005-member-queries.integration.test.mjs`

Result: 6 tests passed, 0 failed. The run used localhost PostgreSQL isolated databases created by the test harness and verified cleanup of the owned database, backends, fixture pool, observer pool and HTTP listener. It did not connect to or modify the SS-011 cloud database.

Covered behaviors:

- member-owned list/detail and bound cursor access, including cross-member denial;
- command receipt lookup denial across members;
- same-command replay returning the original result without a second Intake;
- lost HTTP response followed by command lookup and same-ID replay;
- supplement lock rechecks for logout, identity switch, write shutdown and revocation;
- bounded processing batch and no unauthorized external send path in the fixture.

This is isolated automated evidence, not live A/B command-level acceptance. The live member evidence currently covers the A/B list/detail UI boundary: A cannot see B's records, B can see B's own records, and B opening A's detail link returns to the generic own-session home without A data. Live command lookup, forged cursor/identity field requests and their exact audit records remain `NOT_RUN` until a protected real-member request capture is available. AC-098/099 therefore remain partial and must not be marked complete from this artifact alone.

## Live database-layer follow-up

Against the current SS-011 database through the member service runtime, a read-only store-layer check found two distinct reporter bindings and nine existing receipts. Each binding returned only its own Web list. Cross-binding detail and command lookup returned `YXX_NOT_FOUND`; using an A cursor with B returned `YXX_CURSOR_INVALID`; the check performed no database write.

A second read-only store-layer check replayed one existing real submit receipt with the identical command ID and content: `replayed=true` and the same request reference. The same command ID with changed content returned `YXX_COMMAND_CONFLICT`; receipt count remained 9 before and after. This is live database-layer evidence for AC-098/099 authorization and idempotency, not a captured HTTP response-loss or process restart drill.
