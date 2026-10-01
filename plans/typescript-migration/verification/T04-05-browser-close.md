# T04-05 browser socket cleanup repair

Actual published `f8e209e3fb5ab2e3de1482eb558f0b6b2efaeffe` failed [CI 36876787453](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/actions/runs/36876787453). Only T04-02 failed: the original SS-009 browser test completed its business assertions and screenshots, then its independent cleanup observer found `browser_socket = 1`. That batch executed 104/108 files, with 636/637 tests passed and four not_run files. The other five batches passed. All 1,430 available TAP/stderr hashes were verified; the original failure and not_run entries are retained.

The existing helper called socket.close, stopped Chrome and removed its owned profile without awaiting the asynchronous CLOSED state. A new regression at the existing launch → close → ownedResourceState seam retains real Chrome, local HTTP and native CDP transport, delaying only observation of CLOSED for one second. The old helper returns with one socket and fails the regression. The six-line repair waits for the actual CLOSED state under a ten-second deadline after process/profile cleanup. A timeout still rejects with P2_006_BROWSER_SOCKET_NOT_CLOSED; no resource count is fabricated and no failure is accepted as success. Existing command/startup timeouts, target ownership, redirects, cancellation and all original assertions remain unchanged.

Source commit: `ef99c7e3aefc63c0f362cf0a7ac13283f5a2666a`, tree `fd8e516f6254caa4644e59953922ac96c06b3396`.

| Check | Actual result |
| --- | --- |
| New regression against old helper | RED: one failure, sockets 1 |
| All browser lifecycle regressions | GREEN: 5/5 |
| Local T04-05 batch | 50/50 files, 341/341 tests; zero fail/cancelled/skipped/todo/not_run |
| Original SS-009 test without transport instrumentation | PASS; all owned cleanup counts zero |
| Local raw TAP/stderr hashes | 100/100 verified |
| Windows tooling | 59/59 |
| Clean source build and artifact verification | PASS |
| Standards / Spec review applicable to exact source commit | 0 / 0 remaining findings |

The tests ran before the source commit, with the execution manifest honestly recording f8e209e plus a dirty patch. A subsequent clean build at ef99c7e verified identical source input hashes, every input and all 747 output hashes against that tested patch. This content binding does not rewrite the original execution manifest or pretend the tests were launched on a clean published SHA. Fresh configured CI must run on the new authoritative publication head.

All 261 production code/script outputs are byte-identical to f8e209e in the same worktree. Only the existing browser helper and lifecycle test outputs change. No production source, SQL, permissions, business clock/hash/transaction behavior, Feature Flag, dependency or frozen Evidence changes. The owned PostgreSQL 18.4 cluster on loopback port 55435 had no residual databases or other client backends and was confirmed stopped.

[New receipt](../receipts/T04-05-browser-close.json) references the durable local archive. Previous receipts, the applicable 8f929b7 independent P2 closure and the original 213-file snapshot remain bound to their original objects. The strict readiness rejection remains KNOWN_BASELINE_NOT_READY. Publication identity checks, the unchanged strict CLI and the new full configured CI are recorded separately on [PR37](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/37). No CI success, GitHub APPROVE, merge, deployment, real Provider/send/write or T05-01 is claimed at this local snapshot.
