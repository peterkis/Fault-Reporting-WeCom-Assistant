# PR 192 — CI browser race investigation

Baseline: `c21d00c7ef295670f124c368b1eca8b807ec0a4a`; main comparison: `67999466deedacea714812f7cc23884c2a5b7db1`. This round changes only the toast test's pre-measurement wait and this evidence. No production, realtime, Card 12, shared harness, 35B or assertion changes; no commit/push. [Scope and original equality guard](scope.json), [main comparison](main-comparison.json).

Environment: macOS 26.6.2 (25G83), Chrome 157.0.8103.79, Node 24.18.0, local PostgreSQL with fixture-owned UUID databases. [Environment](environment.json). Final source input: `6d780c3492f29412596d921a578e158d4053e1e46a4d04792ab2ca40c149954f`; manifest: `7191d3d5d796956991694966353614ef388612df969ba3f2671ab4ec3355d7e5`. All final browser runs use this one rebuilt artifact.

## Toast: proven test settle race

The unchanged test reproduced the **exact CI difference** at CPU 6x: expected `656 × 379.4375`, actual `656 × 382.4375`. [Original failing diagnostic TAP](diagnosis/toast-probe-6.tap), [full layout/read trace](diagnosis/toast-probe-6.json), [CI failure excerpt](ci/toast-rerun-excerpt.txt).

The extra 3px comes from the existing saved-draft affordance, not the conflict toast:

| Observed state | Dialog height | Inline controls |
| --- | --- | --- |
| Draft saving | 379.4375px | Status icon 20px; confirm/discard buttons 32px |
| Draft saved | 382.4375px | `toggle-draft-limit` appears at 35px and grows the inline row by 3px |

The original pre-conflict trace already contains both heights (including a 382.4375px frame at 2900.3ms), **before either conflict-producing request or the 409 toast**. Fonts are `loaded` in both layouts and their family, size and line-height agree. The other direct-child heights agree. The absolutely positioned refresh marker does not account for the height difference.

The assignment component/draft hook, button, dialog and feedback CSS are byte-identical to main. `DraftStatus` is unchanged; the only 35A changes in its file add read-only reporting, which reports pending operations for `unknown`/`checking`, not `conflict`. Main comparison is by source and relevant sections; **main was not executed in a separate worktree**.

The test now waits for the existing `草稿已保存` status and visible saved-draft affordance, then performs the existing font and animation settling before capturing its baseline. The original `deepEqual` of width/height remains exact. No delay, tolerance, retry of the assertion, CSS change or production workaround was added. [Fixed diagnostic TAP](diagnosis/toast-fixed-probe-6.tap), [fixed layout trace](diagnosis/toast-fixed-probe-6.json): the captured baseline and comparison both measure 382.4375px.

## Card 12 revision: not reproduced; no 35A cause established

The original Linux CI failure remains recorded: [first-attempt TAP](ci/card12-first-attempt.tap), [failure screenshot](ci/card12-first-attempt-revision.png). The screenshot shows **「当前账号无法查看工作台。」**, the existing session HTTP-403 fence; it does not show an offline/stale workbench. The same HEAD's [CI rerun passes 7/7](ci/card12-rerun.tap). [CI run and verified artifact provenance](ci/provenance.json) identifies both downloaded archives and their verified SHA-256 digests; no signed URLs, full job logs or credentials are published.

The code paths were compared with main:

- The test and `clearSessionAuthorization`/UI session fence are unchanged. The realtime hook's entire refresh callback, including bootstrap, identity reconciliation and the 401/403 catch, is byte-identical. `ApiError` only gained diagnostic request metadata; its status/code and authorization checks are unchanged.
- An UNKNOWN command POST is not a failed authoritative GET. Losing that command response cannot set `disconnectedAt`. This test neither forces failed GETs nor takes the browser offline.
- Healthy visible reads retain the single 5s scheduler. Each refresh reads bootstrap first; the test's fetch wrapper records its revision before identity reconciliation or subsequent business invalidation. No valid SSE hint is dropped during backoff in this HEAD. Search invalidation callbacks do not participate in this test.
- Genuine failed/timed-out reads, a hidden page, or credible authorization rejection can pause/stop automatic recovery by their existing contracts. This is not evidence that any such condition occurred before the CI timeout. In particular, the screenshot establishes the final denial state but cannot identify the request that produced it. No request trace was captured in that CI attempt.

A separate CPU 6x [revision trace](diagnosis/revision-trace-6.json), [TAP](diagnosis/revision-trace-6.tap), observed the fresh revision **885.5ms** after the role-insertion marker, online and visible, with bootstrap responses all 200 and none aborted. Both complete-file ten-run series below also pass. This supports leaving the known flaky test and realtime product code unchanged; it does **not** prove the CI-only denial's root cause. That remains an explicit investigation limit, rather than a newly assigned “legacy” or “test bug” diagnosis.

## Repeated full-file runs

Every cell executes the complete file. Each rate series ran five rounds in order; the two series ran concurrently, along with the requested regressions. No failed intermediate diagnostic is included in this final matrix. [Per-file identity, CPU acknowledgements and per-case JSON](matrix/results.json).

| Round | Toast normal | Toast CPU 6x | Card12-review normal | Card12-review CPU 6x |
| --- | --- | --- | --- | --- |
| 1 | [PASS 1/1](matrix/normal-toast-1.tap) | [PASS 1/1](matrix/cpu6-toast-1.tap) | [PASS 7/7](matrix/normal-review-1.tap) | [PASS 7/7](matrix/cpu6-review-1.tap) |
| 2 | [PASS 1/1](matrix/normal-toast-2.tap) | [PASS 1/1](matrix/cpu6-toast-2.tap) | [PASS 7/7](matrix/normal-review-2.tap) | [PASS 7/7](matrix/cpu6-review-2.tap) |
| 3 | [PASS 1/1](matrix/normal-toast-3.tap) | [PASS 1/1](matrix/cpu6-toast-3.tap) | [PASS 7/7](matrix/normal-review-3.tap) | [PASS 7/7](matrix/cpu6-review-3.tap) |
| 4 | [PASS 1/1](matrix/normal-toast-4.tap) | [PASS 1/1](matrix/cpu6-toast-4.tap) | [PASS 7/7](matrix/normal-review-4.tap) | [PASS 7/7](matrix/cpu6-review-4.tap) |
| 5 | [PASS 1/1](matrix/normal-toast-5.tap) | [PASS 1/1](matrix/cpu6-toast-5.tap) | [PASS 7/7](matrix/normal-review-5.tap) | [PASS 7/7](matrix/cpu6-review-5.tap) |

Total: **20 full-file runs, 80/80 cases, zero skips/cancellations**. CPU 6x is installed with CDP `Emulation.setCPUThrottlingRate` before the first navigation, using a temporary out-of-tree Node `registerHooks` loader. Final matrix `CARD35A_TRACE=0` only injects that CPU call and prints its acknowledgement; test bodies, fixture logic and artifact bytes are untouched. The normal series uses the same loader with rate 1. All 80 browser launches (40 at each rate) acknowledged the expected rate. The diagnostic observer runs use `CARD35A_TRACE=1` and are kept separately above. The loader SHA-256 is in the scope/matrix receipts; the loader is not a repository change.

Execution uses local Chrome, `PILOT_DATABASE_URL=postgresql://petervans@127.0.0.1:5432/postgres`, `TS_MIGRATION_TEST_DB_ISOLATED=1`, `TS_MIGRATION_REQUIRE_BROWSER=1`, a real-path owned TMPDIR, and the current source/runtime roots. Matrix invocation inside `.build/runtime`:

```sh
CARD35A_DIAGNOSTIC_CPU_RATE=6 CARD35A_TRACE=0 node --import <temporary-loader.mjs> --test --test-concurrency=1 tests/workbench-toast-feedback.browser.test.mjs
CARD35A_DIAGNOSTIC_CPU_RATE=6 CARD35A_TRACE=0 node --import <temporary-loader.mjs> --test --test-concurrency=1 tests/pc-admin-card12-review.browser.test.mjs
# Repeat each five times; rate=1 for the normal series. TAP + existing case reporter also enabled.
```

## Requested checks

The existing `runSelection` API executes each routed regression from the compiled runtime, without rebuilding between entries. [Per-entry results and receipt links](regressions.json) include execution arguments, source/executed hashes, exit codes and case counts.

| Command / entry | Result | Evidence |
| --- | --- | --- |
| `npm run migration:typecheck` | PASS | [Output](checks/typecheck.txt) |
| `npm run migration:build` | PASS, staged only | [Output](checks/build.txt) |
| `npm --prefix app/pc-admin run lint:css` | PASS | [Stylelint](checks/stylelint.txt) |
| `npm --prefix app/pc-admin run lint:features` | PASS | [ESLint](checks/eslint.txt) |
| `tests/pc-admin-card35a-states.browser.test.mts` | PASS 10/10 | [TAP](checks/001-pc-admin-card35a-states.browser.test.mts.tap) |
| `tests/wbint-t38-protocol.browser.test.mts` | PASS 2/2 | [TAP](checks/001-wbint-t38-protocol.browser.test.mts.tap) |
| `tests/wbint-t38-realtime.test.mts` | PASS 11/11 | [TAP](checks/001-wbint-t38-realtime.test.mts.tap) |
| `tests/workbench-detail-restructure.browser.test.mts` | PASS 2/2 | [TAP](checks/001-workbench-detail-restructure.browser.test.mts.tap) |
| `tests/pc-admin-copy-terms.test.mts` | PASS 6/6 | [TAP](checks/001-pc-admin-copy-terms.test.mts.tap) |
| `npm run docs:agents:check` | PASS | [Output](checks/agent-docs.txt) |
| `node --test .build/tools/check-agent-docs.test.mjs` | PASS 20/20 | [Output](checks/agent-docs-tests.txt) |
| `node .build/tools/verify-artifact.mjs` | PASS | [Output](checks/artifact.txt) |
| Evidence Markdown local targets + `git check-ignore` | PASS, 648 links, zero issues/ignored targets | [Receipt](checks/local-links.json) |
| `git diff --check` | PASS | [Output](checks/diff-check.txt) |

Application regressions: **31/31**, in addition to the **80/80** matrix cases. Diagnostic negative reproduction is intentionally FAIL and preserved; it is not a final-candidate failure. CI is not rerun from this uncommitted worktree. No actual Linux execution, full CI selection rerun, main browser execution or Windows run is claimed. No visual/product change requires replacement of the prior 1440px state screenshots; this report adds the original Linux failure screenshot for diagnosis and retains all historical evidence.
