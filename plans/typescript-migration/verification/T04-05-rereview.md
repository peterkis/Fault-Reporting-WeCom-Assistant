# T04-05 independent rereview closure and local terminal verification

Reviewed published head: `8f929b73084690c46190d6cf4968b2801894b2ae`; GitHub PR base: `87de2bc9e8835882cd390b024a04e2865cd367f9`. The PR API confirms that exact object is published. The original fix `c17768c6120291f8b0fdf70570a1b66afa5be9d4` is its real ancestor. No temporary reconstructed SHA or same-tree substitution is used.

The user supplied an independent remote rereview of this object. Its actual TypeScript 5.9.3 project program has zero diagnostics. Narrow implementations are independently rejected at InboxService.accept, FirstAcknowledgementService.accept and PilotE2EHandler.handleFrame with TS2322; restoring each old method signature in compiler memory triggers the corresponding TS2578 negative. The original raw-input variance P2 is closed. No new confirmed P1/P2 was reported within the review's stated scope. This followup verifies existing reports; it does not claim to have rerun those independent compiler/browser experiments or submitted GitHub APPROVE.

The independent six-module runtime AST comparison matches the real base. All 261 production code/script outputs match the previous published candidate; changed outputs are three corresponding source maps, the browser test helper and its regression. Protected database, Evidence, lockfile and configuration changes remain absent. No new source fix is required by the supplied findings.

The actual [published-head CI 36851491429](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/actions/runs/36851491429) was downloaded and independently audited:

| Batch | selected / executed | pass / tests |
| --- | --- | --- |
| T03-01 | 181 / 181 | 1204 / 1204 |
| T04-01 | 153 / 153 | 921 / 921 |
| T04-02 | 108 / 108 | 664 / 664 |
| T04-03 | 96 / 96 | 581 / 581 |
| T04-04 | 131 / 131 | 763 / 763 |
| T04-05 | 50 / 50 | 340 / 340 |

All non-pass and not_run counts are zero in these CI batches. The 1,438 TAP/stderr hashes match, and Windows/Ubuntu tooling are each 59/59. These sets overlap and are not summed as unique coverage. Manifest SHA-256: `dc00e39c4275305ca0db6b83e84d57b45efed39689c210c272af7426c5025ec3`.

The remote review initially could only read 36/50 extra-local records before its control connection timed out. Direct subsequent inspection found terminal batch.json and tests/summary.json, both ending FAIL: 47/50 records, 46 PASS files, one SOURCE_HOST architecture-test subprocess ETIMEDOUT after 240,000 ms and three not_run files. The timeout's TAP contains only its version header. The 300/300 completed TAP tests therefore do not prove full-batch PASS. All 94 recorded TAP/stderr hashes were checked. The subprocess timeout root cause remains unconfirmed; it is not a newly confirmed product defect. The failed extra run remains separate from current published CI success.

The three unexecuted files are:

- tests/yxx-ss-002-contract.test.mjs
- tests/yxx-ss-009-browser.integration.test.mjs
- tests/yxx-ss-009-evidence-history.test.mjs

Temporary PostgreSQL cleanup is now verified rather than inferred from the script's finally block: stop_exit 0, recorded complete shutdown, owned data directory removed and absent, and port 52353 has no listener. No additional cleanup, database restart or full test rerun was performed by this followup.

The [Codex reply](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/37#issuecomment-5931481053) remains a code-review usage limit, not approval. The applicable independent rereview is recorded separately. Source implementation and test content are unchanged by this documentation successor; the 8f929b7 source CI/review remain bound to 8f929b7, while configured successor CI is reported for its actual new head. No duplicate robot request is made solely for documentation movement.

[New receipt](../receipts/T04-05-rereview.json) points to the separate durable terminal archive and hashes. The earlier receipts, tested 67b5a8f source, original 60a0265 complete-registry snapshot (213 files, 1342/1344, two reproduced baseline failures), frozen historical assertions and published artifacts remain unchanged. No full 213-entry rereview run is claimed. Original strict readiness remains exit 1 / YXX_VERIFICATION_REJECTED / YXX_LOCAL_VALIDATION_SCOPE_INVALID, classified KNOWN_BASELINE_NOT_READY.

T04-05 remains IN_PROGRESS and unmerged. Artifacts are STAGED_NOT_ACTIVATED. No SQL, runtime flag, real Provider/send/write, activation, deployment, merge or T05-01 is authorized by this documentation publication.
