# T04-05 browser startup fixture repair

The actual published `0d05ed3e59595d8e8ab7715fd1c9e57a4e1819d1` failed [CI 36836469698](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/actions/runs/36836469698). T03-01, T04-02 and T04-03 each failed the original SS-009 browser test during its first relative navigation. T04-01, T04-04 and the then-current 48-file T04-05 passed. The complete failed reports, 1,396 verified TAP/stderr hashes and each not_run list remain preserved; that CI is not accepted or silently retried as green.

A local T03 diagnostic reproduced the same failure without changing the candidate. A controlled real Chrome/HTTP probe held the initial response: the original public launch helper returned when TargetInfo advertised the requested URL, while Runtime still reported about:blank. Relative location.assign then raised the same DOMException shown in CI. The helper was byte-identical to the real base. Instrumented diagnostic passes are not acceptance evidence.

The new real browser regression holds the first HTTP response for three seconds and verifies the returned document and immediate relative navigation. Against the original helper it ran RED (3 pass / 1 fail, actual document about:blank). The smallest repair waits for the real document origin/path, or an explicitly declared same-origin redirect, and readyState interactive/complete under the existing startup signal. The existing timeout, target ownership, redirect, cancellation and cleanup checks remain intact. It then ran GREEN 4/4.

Clean tested source: `67b5a8fe692015637b3ad44e0e21097843be9ce7`, tree `10db20207c4b2e6bdab227f33527c7596b827209`.

| Check | Actual result |
| --- | --- |
| Strict types, negative type tests and independent canary | PASS |
| Expanded T04-05 gate | 50 selected/executed files, 340/340; zero fail/cancelled/skipped/todo/not_run |
| Original SS-009 browser test | PASS, without diagnostic instrumentation |
| Raw batch TAP/stderr hashes | 100/100 verified |
| Tooling / hosts / batches | 59/59 on Windows |
| Two clean builds and artifact verification | PASS |
| Standards / Spec review pinned to 67b5a8f | 0 / 0 remaining findings |

Manifest SHA-256: `2542ac7c360b1e66de8b5d3bd168899ed63834b2e03e25c8922377e184d0efa9`. All 261 production code/script outputs match the previous candidate in the same worktree. Of 747 outputs, only tests/helpers/p2-006-browser-harness.mjs and tests/p2-g2-browser-lifecycle.test.mjs change. Six migrated/support module runtime ASTs still match the real base. No production source, SQL, runtime guard, authorization, transaction, clock, hash, feature flag or frozen Evidence changes in this repair.

The owned loopback PostgreSQL 18.4 cluster on port 55435 was checked for residual databases and client backends, then stopped. Existing user resources were not touched.

[New receipt](../receipts/T04-05-browser-startup.json) binds the actual tested source ancestor and the independent durable archive. The initial 213-file / 1344-test run remains the original 60a0265 snapshot (1342 pass / two reproduced baseline failures); it was not rerun or rebound. The original strict readiness CLI on the identity-verified previous published object still exits 1 / YXX_VERIFICATION_REJECTED, underlying YXX_LOCAL_VALIDATION_SCOPE_INVALID. This remains KNOWN_BASELINE_NOT_READY.

[PR37](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/37) records the new authoritative published head, fresh full configured CI and the external request after that CI is verified. Published-object history preflight must again be followed by the unchanged strict CLI. These are pending at the local snapshot. Previous CI and review quota responses do not replace current validation. T04-05 stays IN_PROGRESS; merge, activation, deployment, real Provider/send/write and T05-01 remain outside authorization.
