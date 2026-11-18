# Linux timing investigation — historical reproductions

These are intermediate diagnostics, not the final stress matrix. Original assertions, failures and exploratory mistakes are preserved. The [final matrix](../../checks/linux-timing/README.md) is the only five-plus-five result for the current candidate.

## Original two CI symptoms

[Reproduction script](original-reproduction-script.txt) temporarily instruments only the compiled original test: 6x CDP CPU throttling, an additional 220ms before the nominal 80ms response, and a probe at the existing SSE assertion. Source and compiled test were restored before the final normal build. The application JavaScript was unchanged.

[Exact original failures](original-failures.txt): both assertions failed (0/2). The 80ms wrapper awaited the real endpoint, so its target was not an upper bound. A real read longer than 150ms legitimately starts loading. This proves the fixture can cause the exact CI failure; the added 220ms is a reproduction aid, not a claim about CI's measured latency.

[SSE diagnostic](original-sse-diagnostic.json): `bodySame=true`, `fullSkeleton=false`; the two remaining skeleton blocks belonged to the initial attachment section (`正在加载报修资料…`). The broad artificial detail delay also matched attachment endpoints. The main detail query uses a stable key and only shows `DetailSkeleton` while pending without data. No product JavaScript change was necessary.

## Intermediate candidates and findings

- [Before warm query / 4x](before-warm-query-cpu4-1.tap): a separate normal-live-label readiness race was caught. GET recovery and native EventSource live are independent; the live assertion now waits for live, while the recovered bar still has its original two-second assertion.
- [Before navigation fix / 4x](before-route-fix-cpu4-1.tap): an exploratory test selector timed out. The final fast test uses browser navigation to a fresh query key and keeps the original global no-busy assertion; filter submission has its own legitimate busy state.
- [Intermediate CPU summary](intermediate-cpu4-summary.txt) and [normal summary](intermediate-normal-summary.txt) predate the final scrollbar fix. Their successful files do not count toward the final sequence. The obsolete normal loop was stopped at an explicit sentinel after two files; remaining files were NOT_RUN for that candidate.
- Separate response timers could still finish after 150ms when the first result began a slow render. The final fixture pre-captures authorized synthetic bodies and releases each concurrent batch in one task. [Isolated batched response check](isolated-batched-response.txt) passed at 4x. Actual response durations remain asserted below 150ms.
- [Before scrollbar fix / 4x](before-scrollbar-fix-cpu4-1.tap): both original timing scenarios passed, but the unchanged table geometry assertion failed: width 1136 → 1120 (16px). [Normal 1](before-scrollbar-fix-normal-1.tap) and [normal 2](before-scrollbar-fix-normal-2.tap) passed on that earlier candidate; neither is counted in the final matrix.

## Product scrollbar regression

The independent fixture forces five skeleton rows followed by content tall enough to create page and table scrollbars. The existing ≤1px assertion was retained and a whole-table loading-to-content header assertion was added.

| Candidate | Result | Measurement |
| --- | --- | --- |
| Original page/table overflow | FAIL, 16px width loss | [JSON](gutter-before.json), [test output](gutter-before.txt) |
| Stable gutters without forcing page scrollbar | FAIL, 8px width loss | [JSON](gutter-after.json), [test output](gutter-after.txt) |
| Final list-scoped page overflow and stable inner gutter | PASS, 0px | [JSON](gutter-verified.json), [test output](gutter-verified.txt) |

The final change is restricted to `:root:has(.ds-list-toolbar)` and `.ds-work-table-wrap`. Product JavaScript, query keys, permissions and realtime scheduling are unchanged. This is a separate CSS defect found during the requested slow-runner investigation.
