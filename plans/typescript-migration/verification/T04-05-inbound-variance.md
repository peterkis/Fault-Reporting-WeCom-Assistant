# T04-05 raw inbound variance repair

Reviewed published head: `3c02ad9c5c9f106700706d984371e821f957e9b9`; real base: `87de2bc9e8835882cd390b024a04e2865cd367f9`. The independent review supplied one P2: method-shaped `InboxService.accept` and `FirstAcknowledgementService.accept` allow a narrower implementation to be labelled as a public service before downstream function-property wiring. Original CI success did not cover that assignment layer. Earlier zero-finding local reviews missed it.

The supplied clean local fix `c17768c6120291f8b0fdf70570a1b66afa5be9d4` was imported as its original Git object, preserving its direct parent and user-owned checkout/reports. Its 48-file / 335-test report and all 96 TAP/stderr hashes were independently verified against its actual Git tree. These remain local c177 evidence, not published-head validation.

Review of the composed chain found the same method exception on `PilotE2EHandler.handleFrame`. A reasoned negative type test first produced TS2578 against c177; the type-only function-property repair made the complete strict program green. Clean tested successor: `f747b5979786a3428870c4b3e3983c7fc1859d25`, tree `51415532494f318d293b6a3c479f47d83a95f6be`.

The three public raw boundaries now use function properties. Positive signatures retain actual Inbox → FirstAcknowledgement → E2E wiring and the handler's `unknown` callback. Pre-labelled narrow implementations are rejected. Three independent in-memory compiler controls each restore one old method signature and recover its corresponding TS2578; the unchanged fixed program has zero diagnostics. No source is mutated by these controls, and no any, suppression or declaration bridge is added.

Actual new validation on clean f747:

| Check | Result |
| --- | --- |
| Strict types, type negatives and independent canary | PASS |
| T04-05 gate | 48 selected/executed files; 335/335; no fail/cancelled/skipped/todo/not_run |
| Raw TAP/stderr hashes | 96/96 verified |
| Tooling / hosts / batches on Windows | 59/59 |
| Two clean builds and artifact verification | PASS |
| V1.4 architecture | 407 checks, exit 0 |
| Standards / Spec review pinned to f747 | 0 / 0 remaining findings |

Manifest SHA-256: `560121af2f9270fcbe9bb491128b9c83e74108504d0e957f888afa12028a1728`. All 261 production code/script outputs are byte-identical to the previous candidate built in this same worktree. Of 747 runtime outputs, only the three corresponding source maps change. All four migration targets plus Inbox and Notification have the same type-erased runtime AST as the real base; comparison preserves business expressions and literal strings.

The original ARCH006 validator still exits 1 with its complete diagnostics. Its comparison permits only the exact ten-path migration/support delta, with a new out-of-scope rejection test; the original validator and all other path/diagnostic refusals remain intact. The original strict CLI still exits 1 / `YXX_VERIFICATION_REJECTED`, underlying `YXX_LOCAL_VALIDATION_SCOPE_INVALID`. This is `KNOWN_BASELINE_NOT_READY`, not a readiness pass.

The complete 213-file / 1344-test run remains the original `60a0265` snapshot: 1342 pass and two independently reproduced baseline failures. It was not rerun or rebound to this type-only fix. [Initial receipt](../receipts/T04-05.json) and [fixture repair receipt](../receipts/T04-05-ci-repair.json) are unchanged. Previous [published CI 36816642410](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/actions/runs/36816642410) belongs to 3c02ad9; it is not evidence for the new source candidate. Its external Codex response was a usage limit, not an actual review.

The owned PostgreSQL 18.4 cluster on loopback port 55435 has no residual test databases or client backends and is stopped. The user's independent cluster and primary checkout were not touched. No SQL, runtime guard/default, authorization, clock, hash, transaction, sending order, frozen Evidence or feature flag changed in this repair.

[New receipt](../receipts/T04-05-inbound-variance.json) preserves tested f747 as an actual ancestor. [PR37](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/37) records the authoritative successor head, fresh CI, published-history identity check followed by the unchanged strict CLI, and a new external request after current CI verification. Those results are pending at this local snapshot. Batch state stays IN_PROGRESS; no merge, activation, deployment, real Provider/send/write or T05-01 is authorized.
