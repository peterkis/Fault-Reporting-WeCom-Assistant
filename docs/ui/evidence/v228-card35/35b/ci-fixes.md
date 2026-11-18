# PR #191 CI and review fixes

This record covers the uncommitted fixes on PR head `7ea9e17cafeb58f0dca268a59119aabeb8d1ce61`, compared with main/base `f76fffef7c693ddcee0139b4f6f03bf59376e358`. It does not replace the earlier screenshot, stability or source-experiment receipts.

## CI fixes

The SS-009 HTTP recovery fixture applied `migrateCurrentBaselineWithYxx` without the schema successors used by the current runtime. A local run before the fix reproduced both failures: processing queried the missing `pilot_ticket.closure_record` relation, and the revocation case returned 503 instead of the asserted 404. The affected test, shared resource helper and baseline migration script have no difference between main `f76fffef` and PR head `7ea9e17c`; this is a pre-existing main fixture defect exposed by the broad selection triggered by `package.json`.

The SS-009 runtime setup now applies the existing migration functions in order: baseline with YXX, service closure 071, completion/dismissal 072, notification vocabulary 073, system closure restore 074. HTTP recovery, crash recovery, capacity and the savepoint scenario use this shared setup. Catalog-only tests retain their immutable historical chain.

Running all five SS-009 integration files exposed another outdated fixture payload: capacity's 50 out-of-scope resolutions omitted the closure reason pair required since card 27C. They now send `NOT_IT_SCOPE` / `OUT_OF_SCOPE_CONFIRMED`, matching the current workbench contract. All original count, response, business and cleanup assertions remain unchanged.

An AST audit against committed HEAD verifies all 102 existing `assert.*` calls across the five SS-009 files and shared resource helper are text-identical and in the same order. Per-file assertion counts and hashes are included in the machine-readable receipt.

The populated Bot upgrade scenario still checks the exact 032 → 033 → 034 catalog and all original row snapshots. It temporarily applies empty 071 only to populate through current Ticket Core, rolls 071 back before the historical migration assertions, then reapplies 071 for current-runtime replay. Later migrations are deliberately excluded from this historical scenario: they change the frozen catalog and remove columns captured by its original snapshots. The runtime savepoint scenario uses the complete successor chain.

## Capture receipt and evidence writers

Compare accepts a current PNG only when `meta.json.screens` records its name and its SHA-256 matches. A partial capture replaces the receipt rather than merging old captures. Full comparison marks uncovered files `unrecorded` and mismatches `stale`, omits them as current images, and fails. Explicit named comparison is supported, reports its subset scope and lists screens not compared. Incomplete receipts fail closed.

Three new tool tests cover partial capture with 17 leftover PNGs, explicit subset/unknown names, hash mismatch and incomplete capture, and fresh nested evidence/log directories including restore-path writes. Reverse validation and stability share the directory preparation helper. Capture, compare and approval writers were also checked for directory creation before writes. Approval was not executed.

## Execution method and environment

The committed Git-diff plan is kept at `.build/pr191/plan.json`; no scratch plan is added to the repository. It selects 74 routed entries plus seven tool test files. Entries run through the repository's `runSelection` API against the compiled runtime, with local PostgreSQL, isolated fixture databases, the system Chrome, PyYAML 6.0.2 and explicit ffmpeg/ffprobe paths. The local wrapper records a failed batch and resumes only its not-run remainder so fail-fast behavior cannot hide later entries. No selected entry or assertion is skipped.

macOS's default temp directory uses the `/var` alias for `/private/var`. An initial selected-tool run exposed an existing path mismatch in `outputFiles`: it walks a real path but computes relative names from the alias, causing `H5_BUILD_OUTPUT_INVALID` and related fixture failures. A probe recorded the escaping relative names. The same H5 check passes with canonical `TMPDIR`; selected tool checks use that environment correction. No path assertion or product code is changed.

The first complete 74-entry run passed 72 entries and failed H5 flow/media in the real transcoder. Both configured Homebrew bin paths were symlinks; the existing transcoder intentionally requires regular executable files and rejects symlinks before starting a child. Resolving `H5_MEDIA_FFMPEG` and `H5_MEDIA_FFPROBE` to the actual Cellar binaries makes the two routed entries pass (15/15 tests). This is a local environment correction, with the executable guard and every media assertion preserved. The full selection is repeated with canonical temp and executable paths; the first failure receipts are retained separately.

The CI job's global database initialization/cleanup and clean-worktree checks are not copied onto this shared local PostgreSQL/worktree: fixtures own and clean their UUID databases, and the user requires the fixes to stay uncommitted. The local run is reported separately from remote CI. Full/certify and new screenshot capture are outside this rework.

## Results

Final candidate: uncommitted fixes on `7ea9e17cafeb58f0dca268a59119aabeb8d1ce61`, build input `5878b428baa5939c6a35f6a66ed5dad45ea4fb8a2ae44765199660a382d59c88`. Node 24.18.0; macOS 26.6.2 / Darwin 25.6.0; system Chrome 157.0.8103.79. The committed-head plan and both complete runs select the same 74 entries. No known-flake exclusions were used.

| Requested fix | Result | Evidence |
| --- | --- | --- |
| SS-009 current runtime setup; unchanged existing assertions | PASS | HTTP recovery 2/2; all five SS-009 files 14/14; full PR selection 74/74. Historical catalog checks and capacity counts remain intact. |
| Reject unrecorded/stale current PNGs | PASS | A receipt containing one screen rejects 17 leftover PNGs; hash mismatch rejects the file. Explicit named subset succeeds only for verified files; incomplete capture fails. |
| Fresh evidence/log directory, including restore path | PASS | Shared recursive directory preparation; new test writes ordinary, restore and stability outputs into a fresh temporary tree. |
| Full selected database/browser and tooling checks | PASS | 548/548 routed tests, 138/138 selected tool tests, policy scheduling 1/1; no skips or cancellations. |
| Committed-baseline compare and approved image preservation | PASS | Exit 0, 18 unchanged screens / zero pixels; all 19 baseline files and 18 approved current PNG hashes unchanged. |

| Command / check | Result | Local log |
| --- | --- | --- |
| `npm run migration:typecheck` | PASS, strict and negative type checks | `logs/pr191-typecheck.log` |
| `npm run migration:build` | PASS, 969 typed modules / 3044 outputs | `logs/pr191-build.log` |
| `npm --prefix app/pc-admin run lint:features` | PASS | `logs/pr191-eslint.log` |
| `npm --prefix app/pc-admin run lint:css` | PASS | `logs/pr191-stylelint.log` |
| `node --test .build/runtime/tests/visual-regression.test.mjs .build/runtime/tests/pc-admin-copy-terms.test.mjs` | PASS, 20/20 (14 tool + 6 copy) | `logs/pr191-visual-unit.log` |
| All seven `plan.tools` via `node --test --test-reporter=tap --test-concurrency=1` | PASS, 138/138; includes routing 22/22 and docs 20/20 | `logs/pr191-selected-tools.log` |
| `node --test --test-name-pattern 'retired T02 replay' .build/tools/t02-expiry.test.mjs` | PASS, 1/1 | `logs/pr191-scheduling.log` |
| `npm run docs:agents:check`, committed-plan docs check, and changed Markdown link checks | PASS | `logs/pr191-docs.log`, `logs/pr191-docs-changed.log` |
| `node .build/tools/verify-artifact.mjs` | PASS | `logs/pr191-artifact.log` |
| `npm run visual:compare` | PASS, exit 0; full 18-screen manifest; zero pixels | `logs/pr191-visual-compare.log` |
| Planned union through `runSelection` with isolated PG and system Chrome | PASS, 74/74 entries, 548/548 tests | `logs/pr191-ci/` |
| All `tests/yxx-ss-009-*.integration.test.mjs` through `runSelection` | PASS, 5/5 entries, 14/14 tests | `logs/pr191-ss009/` |

[Machine-readable per-entry receipts and log hashes](ci-selection-results.json), [baseline/current SHA-256 integrity](ci-integrity.json), [PR description](pr-description.md). Original TAP, stderr and case traces are retained in the ignored local log folders; the selection summary is a durable receipt, not a scratch plan. Initial HTTP, intermediate fixture, initial tooling, and initial full-selection failures remain recorded separately.

## Limits and scope

No unresolved acceptance failure remains. Remote CI has not been rerun for the uncommitted fixes; these are local results. No worktree commit, push or approve was performed. No product code, approved baseline, dependency, visual rendering fixture, threshold or CI configuration changed; no repository files were deleted. The untracked design prototype was left in place.

The final 18 current PNGs were not recaptured. The report remains at `.build/visual/report/index.html` with `report.json`. Source reverse experiments and five-run capture stability were not repeated in this rework; their original receipts remain bound to their original inputs. Rollback concerns only the tooling, test setup and accompanying docs; approval and approved baseline files are outside these changes.

## Card B0–B5 recheck

The original card's common constraints, B0–B5 and delivery format were reread before this handoff. Later explicit owner instructions supersede the original threshold and agent-approval wording.

| Card item | Result / limit |
| --- | --- |
| B0 local tool and platform separation | PASS; preserved. The PR CI selection was run locally at the user's request; no CI integration was added. |
| B1 scripts, metadata, reports, dependencies and approval guard | PASS. Compare adds receipt/hash validation and explicit subset scope. Existing two dev dependencies and the human-only approval guard are unchanged. Default ratio 0 is the owner decision of 2026-11-18; original ratio 0.001 is superseded. No overrides added. |
| B2 deterministic capture and five-run stability | PRESERVED prior PASS, not repeated. No capture/stabilization/fixture changes; approved PNGs and metadata are byte-identical. The original 180 zero-pixel pair results retain their original capture identity. |
| B3 all 18 manifest entries | PASS / preserved; full committed-baseline comparison covers all 18. No additional 35A state screens added. |
| B4 tools, guide, evidence, task-card convention and reverse controls | PASS, with prior reverse/stability receipts preserved. Receipt behavior is documented; PR summary and per-entry CI evidence are updated. The owner has already approved/copied the baseline; this agent does not approve or modify it. Source experiments were not repeated for the writer-only fix. |
| B5 scope and assertions | PASS. No new CI workflow, browser matrix, H5/product implementation, 35A/35C work or assertion replacement. H5 entries were executed only because the user required the existing full CI selection. |

## Full PR selection

All 74 entries passed (548/548 tests; 0 failures, cancellations, skips or todo). 44 entries require PostgreSQL and 12 require the system browser.

| Entry | Result | Tests passed |
| --- | --- | --- |
| tests/migration-canary.test.mts | PASS | 1/1 |
| tests/mvp-application-members.integration.test.mts | PASS | 1/1 |
| tests/mvp-group-replies.integration.test.mts | PASS | 4/4 |
| tests/mvp-notification-policy.integration.test.mts | PASS | 8/8 |
| tests/p2-003-realtime-event-log.integration.test.mjs | PASS | 11/11 |
| tests/p2-007-staff-directory-process-options.test.mjs | PASS | 4/4 |
| tests/p2-007-staff-directory-process-role.test.mjs | PASS | 1/1 |
| tests/p2-007-staff-directory-sync.test.mjs | PASS | 3/3 |
| tests/p2-007-staff-directory-worker.test.mjs | PASS | 1/1 |
| tests/p2-007-third-party-current-profile-query.test.mjs | PASS | 3/3 |
| tests/p2-007-third-party-reporter-directory.test.mjs | PASS | 17/17 |
| tests/p2-007-third-party-staff-directory.integration.test.mjs | PASS | 6/6 |
| tests/p2-007-third-party-staff-directory.test.mjs | PASS | 30/30 |
| tests/p2-015-contact-journey.test.mjs | PASS | 2/2 |
| tests/p2-015-manual-review.test.mjs | PASS | 1/1 |
| tests/p2-015-rule-first-orchestration.integration.test.mjs | PASS | 5/5 |
| tests/p2-015-rule-first-orchestration.test.mjs | PASS | 7/7 |
| tests/p2-015-worker-restart.integration.test.mjs | PASS | 2/2 |
| tests/p2-015-worker.test.mjs | PASS | 7/7 |
| tests/p2-016-live-cluster.integration.test.mjs | PASS | 1/1 |
| tests/p2-016-schema-contract.test.mjs | PASS | 6/6 |
| tests/p2-016-ticket-lifecycle.integration.test.mjs | PASS | 1/1 |
| tests/p2-016-workbench-auth.integration.test.mjs | PASS | 6/6 |
| tests/p2-016-workbench-http.integration.test.mjs | PASS | 2/2 |
| tests/p2-016-workbench-wecom-auth.test.mjs | PASS | 5/5 |
| tests/p2-g2-yixiaoxiu-delegated-identity.integration.test.mjs | PASS | 1/1 |
| tests/pc-admin-card12-review.browser.test.mts | PASS | 7/7 |
| tests/pc-admin-card16.browser.test.mts | PASS | 3/3 |
| tests/pc-admin-copy-terms.test.mts | PASS | 6/6 |
| tests/pc-admin-design-foundation.test.mts | PASS | 75/75 |
| tests/pc-admin-legacy-retirement.browser.test.mts | PASS | 2/2 |
| tests/platform-boundary-contracts.test.mts | PASS | 6/6 |
| tests/platform-postgres-callback.integration.test.mts | PASS | 4/4 |
| tests/platform-postgres-time.integration.test.mjs | PASS | 2/2 |
| tests/platform-time-contract.test.mjs | PASS | 4/4 |
| tests/t10-atomic-rollback.integration.test.mts | PASS | 4/4 |
| tests/t10-current-authority-wait.integration.test.mts | PASS | 1/1 |
| tests/t10-unknown-recovery.browser.test.mts | PASS | 2/2 |
| tests/t11-completion.integration.test.mts | PASS | 8/8 |
| tests/t24-round-notification-identity.integration.test.mts | PASS | 1/1 |
| tests/t24-synthetic-sender-unknown.integration.test.mts | PASS | 1/1 |
| tests/t25-app-delivery-http-recovery.integration.test.mts | PASS | 1/1 |
| tests/t35-account-switch.browser.test.mts | PASS | 1/1 |
| tests/t35-current-authority-wait.integration.test.mts | PASS | 1/1 |
| tests/t35-unknown-read.browser.test.mts | PASS | 1/1 |
| tests/visual-regression.test.mts | PASS | 14/14 |
| tests/wbint-t17-manual-receipts.integration.test.mts | PASS | 1/1 |
| tests/wbint-t19-manual-self-handling-authority.integration.test.mts | PASS | 1/1 |
| tests/wbint-t19-manual-self-handling-contracts.test.mts | PASS | 4/4 |
| tests/wbint-t19-manual-self-handling-risks.integration.test.mts | PASS | 4/4 |
| tests/wbint-t19-manual-self-handling-unknown.browser.test.mts | PASS | 1/1 |
| tests/wbint-t22-realtime-tracer.browser.test.mts | PASS | 1/1 |
| tests/wbint-t32-exception-authorization.browser.test.mts | PASS | 1/1 |
| tests/wbint-t32-exception-compatibility.integration.test.mts | PASS | 4/4 |
| tests/wbint-t32-exception-contract.test.mts | PASS | 3/3 |
| tests/wbint-t32-notification-exceptions.integration.test.mts | PASS | 1/1 |
| tests/wbint-t32-session-exceptions.integration.test.mts | PASS | 4/4 |
| tests/web01-workbench.integration.test.mjs | PASS | 17/17 |
| tests/web01-workbench.test.mts | PASS | 9/9 |
| tests/yxx-h5-admin-contracts.test.mts | PASS | 7/7 |
| tests/yxx-h5-application-auth.test.mts | PASS | 8/8 |
| tests/yxx-h5-flow.integration.test.mts | PASS | 1/1 |
| tests/yxx-h5-frontend.test.mts | PASS | 81/81 |
| tests/yxx-h5-http.test.mts | PASS | 22/22 |
| tests/yxx-h5-media.integration.test.mts | PASS | 6/6 |
| tests/yxx-h5-media.test.mts | PASS | 14/14 |
| tests/yxx-h5-migrate.integration.test.mts | PASS | 11/11 |
| tests/yxx-h5-runtime.test.mts | PASS | 19/19 |
| tests/yxx-h5-static.test.mts | PASS | 14/14 |
| tests/yxx-h5-v2-contract.test.mts | PASS | 8/8 |
| tests/yxx-h5-v2.integration.test.mts | PASS | 3/3 |
| tests/yxx-ss-007-native-http-errors.test.mjs | PASS | 15/15 |
| tests/yxx-ss-009-http-recovery.integration.test.mjs | PASS | 2/2 |
| tests/yxx-ss-010-runtime.integration.test.mjs | PASS | 6/6 |

## Selected tool checks

All seven selected files passed, 138/138 tests; no skips.

| Tool entry | Result |
| --- | --- |
| tools/ts-migration/backend-layout.test.mts | PASS |
| tools/ts-migration/check-agent-docs.test.mts | PASS |
| tools/ts-migration/design-system.test.mts | PASS |
| tools/ts-migration/h5.test.mts | PASS |
| tools/ts-migration/hosts.test.mts | PASS |
| tools/ts-migration/pr-plan.test.mts | PASS |
| tools/ts-migration/tooling.test.mts | PASS |

## All SS-009 integration files

This explicit audit adds the four SS-009 files not already in the PR selection. All five files passed, 14/14 tests.

| Entry | Result | Tests passed |
| --- | --- | --- |
| tests/yxx-ss-009-review-regressions.integration.test.mjs | PASS | 2/2 |
| tests/yxx-ss-009-catalog.integration.test.mjs | PASS | 4/4 |
| tests/yxx-ss-009-crash.integration.test.mjs | PASS | 4/4 |
| tests/yxx-ss-009-http-recovery.integration.test.mjs | PASS | 2/2 |
| tests/yxx-ss-009-capacity.integration.test.mjs | PASS | 2/2 |
