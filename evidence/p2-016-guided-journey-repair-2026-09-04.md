# P2-016 group-to-direct live failure repair

Date: 2026-09-04, Asia/Shanghai. Scope: P2-016 only. No second commit, historical data rewrite, migration change, AI or adjacent task authorization.

## Reproduction and cause

The owner confirmed the public regression seam: real-format inbound message → orchestration → Journey/Channel Leg queries.

`node --env-file=.env.pilot --test --test-name-pattern='real-format group' tests/p2-016-guided-journey.integration.test.mjs` reproduced different group/direct Journey IDs twice. The first fixture attempt had an old-clock retention setup error; correcting that setup exposed the actual association failure. No production code had changed when this specific failure was reproduced.

The minimized scenario is a real-shape callback containing `@合成测试助手`, followed by one direct callback with an explicit synthetic technical fault. It uses the real SDK adapter, Inbox and Service Intake processor, P2-016 worker, and authorized Journey query facade. A read-only FK lookup locates the opaque query resource from the worker receipt; behavioral assertions use the public query facade.

Changing only the wakeup text to the literal `bot` made the test pass. This distinguished the entry classifier from the unchanged reporter identity and clock. The classifier recognized only empty text, `bot`, `在吗` and `系统不行`; it did not recognize a retained real bot-display-name mention. Consequently no guided continuation was issued and the direct message became an organic Journey.

## Minimal runtime repair

- For entry classification only, remove the leading display-name mention before checking whether a group description is generic. Persisted text, rule-engine input and provenance hashing remain unchanged.
- Preserve a Journey's recorded entry mode. A second red test showed that adding a detailed message to the same group Intake previously changed the computed mode and raised P2_015_DECISION_CONFLICT. Reading the existing mode fixes this without rewriting its origin.
- Original Contact Journey, continuation and reporter/bot/expiry/ambiguity fences remain authoritative. No nearest-Journey selection, historical rebind or second Ticket Core was added.
- The two new real-input regressions and the existing unique/ambiguous/consumed/expired association cases pass. The related orchestration suite passes (4 tests total).

## Readiness generation correction

The first full rerun at candidate `b1755bb1504142f0d69e249486ba526afe8adc3fd796ff6e45c336ae22e66d34` produced **531/532 pass**, fail=1, skipped/cancelled/todo=0, exit=1, duration=459941.3088 ms. Its only failure was the expected stale readiness hash. All runtime and browser checks passed; this run is not reported as a green full run.

Full regression now explicitly validates implementation/contracts before generating its own readiness receipt. The validator's default and CLI still require readiness Evidence. Deferred implementation checks report `readiness_evidence_checked=false`; live preflight rejects any result unless that field is exactly true and independently validates the complete report and exact hash. A red→green guard regression verifies this separation (7 related tests pass). No CLI/environment bypass was added.

Final candidate: `3752596720f20524ff989ee9cf913b9e104e32a4c2095c48fc83804e7e75f863`.

## Verification status

Second full regression passed **533/533**, fail/cancelled/skipped/todo=0, exit=0, duration **598149.0886 ms**. The current readiness report has been regenerated for the final candidate. Its default full Validator passes 142 checks with readiness_evidence_checked=true; V1.4 validation passes 395 checks and its tests pass 16/16. The failed original live report is preserved in `evidence/p2-016-targeted-live-validation-2026-09-04.md` / `.json`; it is not upgraded by these automated fixes. The final candidate's real live rerun and owner acceptance remain pending.

An ignored local control for a future scoped drill has one passing unit test: it can withhold exactly one successful card ACK on the Gateway→Worker IPC boundary after the real provider returns, without mutating Delivery or invoking a resend. It has **not** been run against WeCom. This would be explicitly labelled controlled IPC ACK loss, not a naturally occurring provider/network failure.

## Cleanup limits

Both full reruns used new process-scoped TEMP/TMP roots, so global stale-profile scans never reached the two earlier policy-blocked Edge profiles. Test database helpers completed their exact-name database cleanup; the final read-only query found temporary databases/backends=0, and process/port checks found scoped processes and 43116/44316 listeners=0. Per-run browser profiles=0.

Recursive removal of the first rerun root `D:\Projects\Fault-Reporting-WeCom-Assistant\tmp\p2016-regression-08ca035e45964a73ae9204bb513cd12d` was itself blocked by tool policy; it remains, and no alternative deletion mechanism was attempted. The second root `D:\Projects\Fault-Reporting-WeCom-Assistant\tmp\p2016-regression-226d8c3552004b809d172857149ab127` retains five non-profile entries (synthetic test artifacts, browser temporary directories and a browser log); no extra recursive delete was attempted. Do not claim filesystem cleanup is complete or indirectly delete blocked roots/profiles.

P2-015 remains DONE; P2-016 remains READY, not DONE. P2-012, P2-G2, P2-008 and P3 are not started by this work. Persistent feature flags remain false.
