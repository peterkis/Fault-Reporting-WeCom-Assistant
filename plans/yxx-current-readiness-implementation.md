# YXX current readiness implementation

User-authorized objective: execute stages 0-7 from the agreed plan to completion.
Contract: [ADR-0027](../adr/0027_yxx_current_readiness.md).
Branch: `codex/yxx-current-readiness`.
Baseline: `562a96ffdd7148d729ab0eed9d215abe894f12c2`.
This progress document is not acceptance evidence.

| Stage | Required deliverable | Status |
| --- | --- | --- |
| 0 | GitHub identity, clean isolated checkout, known rejection and 28 pinned SQL/state records | COMPLETE |
| 1 | Historical/current contract, scope/evidence rules, public TDD seams and stop lines | COMPLETE; evidence wire format follows its public-interface TDD slices |
| 2 | Classified failure, current scope, historical protection and structural validation | COMPLETE; development validation only, final frozen acceptance remains stage 6 |
| 3 | Routed compiled execution, cases, per-file provenance and historical obligations | NOT_STARTED |
| 4 | Current evidence verifier, append-only publication, pointer and mutation tests | NOT_STARTED |
| 5 | ARCH006/current CI separation and retained historical CI | NOT_STARTED |
| 6 | Frozen candidate, full applicable execution, two-axis review and owned-resource cleanup | NOT_STARTED |
| 7 | Append evidence, publish PR, verify final head CI/review, authorized history-preserving merge | NOT_STARTED |

## Baseline observations (2026-10-02)

- GitHub main and local main are the stated SHA; full clean worktree identity passed.
- Historical strict CLI: exit 1 `YXX_VERIFICATION_REJECTED`.
- Current strict/non-strict CLI: exit 1 `SS010_NOT_READY`; underlying public checks:
  `YXX_LOCAL_VALIDATION_SCOPE_INVALID`.
- SQL scope has 22 files; additions versus SS008 are 035 and 036. Six protected
  stage files are unchanged. Three historical G0 evidence paths have adjudicated changes.
- ARCH006 at the merged baseline reports the scope and current-evidence errors (2).
- Registry: 213 entries, 194 STAGED_RUNTIME, 6 MIXED_EXPLICIT_ROOTS, 13 SOURCE_HOST;
  5 typed tests, 132 DB-requiring entries and 58 browser-requiring entries.
- Existing yxx-dev-current selection: 43 files, not complete current acceptance.
- Baseline receipts are outside the checkout under the task artifact directory
  `yxx-current-readiness-20261002`; no historical report was rewritten.

## Execution and acceptance

Development checkpoint (2026-10-02, not frozen acceptance): six public-interface
RED->GREEN cycles cover argument diagnostics, current successor structure, missing
current evidence, missing build, build binding to scope/adjudication inputs, and
default AI-disabled configuration. Three additional regression cases cover SQL
content/list plus forged manifest, protected phase/mode drift, and network/business
process denial. Routed result: 9/9, no skips/cancellations/todos. Owned fixture
worktrees were removed. New scope pins 22 SQL, six state files and two defaults.

A seventh RED->GREEN cycle fixes the public readiness API's default source root
when imported from the compiled runtime. The complete current selection now passes
10/10, with no skips/cancellations/todos; strict type checking also passes.
The existing SS010 contract selection passes 6/6 with an owned PostgreSQL 18.4
cluster (compatibility-pg-v4). Its receipt confirms stop exit 0 and data removal.
Earlier launcher attempts and a missing-build attempt remain separately recorded;
they are not acceptance runs. No owned PostgreSQL process remains after this check.

The user explicitly approved the one additional pre-PR21 G0 transition recorded in
`.github/review/yxx-current-evidence-adjudication.json`. The original five-entry
record is unchanged. A diagnostic use of the PR-specific checker across the entire
r6->current graph also reported merge propagation edges; that is not a historical
PASS or a new adjudication. Current history verification now checks the full graph
from the original r6 anchor, every modifying parent edge, exact six dispositions,
and index/working-tree bytes and modes. Merge propagation accepts only forward
approved transitions present in a supplying parent; other changes remain rejected.
The original SS009 validator and original PR21 checker remain unchanged.

Two further public-interface RED->GREEN cycles reproduce and reject later G0
working-tree changes and committed rewrite-restore. Regression cases cover hidden
side-branch rewrites, new append-only receipts, deletion, mode drift and expansion
of the approved record. Routed result: 15/15; migration host regressions: 18/18;
strict tools/runtime/type-test programs and negative type canary pass. Temporary
fixture worktrees were removed. Receipts: stage02-history-15, stage02-hosts-green.log
and stage02-history-types.log in the external task artifact directory.

The strict current report consumer is not implemented;
strict mode deliberately fails `CURRENT_EVIDENCE_REQUIRED` meanwhile. No current
READY, full acceptance, CI, independent review or release is claimed here.

Follow vertical TDD cycles at the seams recorded in ADR-0027. Retain RED/GREEN
outputs externally and record applicable checks per change. Never turn a missing
runtime/environment dependency into a readiness failure classification.

The new report must bind the actual tested SHA/tree, complete controlled inventory,
scope, artifact manifests, actual current/historical execution domains, acceptance
mapping, original logs/trace/images, two distinct SPEC/STANDARDS reviews, limitations
and cleanup. A submitted report is not final CI approval for its successor commit.

Full-run sequencing: fast development selection -> freeze C -> all current obligations
and separate historical checks -> independent reviews -> append E -> final H CI/review.
Any controlled-input repair after freezing creates a new tested candidate; preserve
failed evidence. Shards are disjoint, separately isolated and collectively complete.

Completion requires current strict readiness PASS on the delivered candidate, original
SS009 strict PASS on its fixed history, all applicable negative tests rejecting,
independently recoverable originals, final exact-head CI/review, and confirmed cleanup.
Historical READY is not current READY. No live authorization, business deployment,
production write, real provider send, T05 advancement or parent Gate progression.
