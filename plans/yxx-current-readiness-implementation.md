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
| 3 | Routed compiled execution, cases, per-file provenance and historical obligations | COMPLETE; development routing/provenance validation, full acceptance remains stage 6 |
| 4 | Current evidence verifier, append-only publication, pointer and mutation tests | IN_PROGRESS; pointer integrity and candidate binding implemented; execution/review/cleanup proof consumer and publisher pending |
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

Stage 4 development: `plans/yxx-current-readiness.json` is a separate pointer with
`schema_version:1` and `report:{path,sha256,bytes}`. Its target is restricted to
`evidence/yxx-current-<run_id>/report.json`. References use raw bytes (no newline
normalization); paths, symlinks, size and digest are checked before JSON parsing.
The new evidence namespace has `-text` attributes, preserving raw diagnostics in
Windows/Linux Git checkouts. `.gitattributes` is itself bound by build and candidate.

The report header binds `schema_version:1`, `contract:ADR-0027`, `run_id`,
`tested_head`, `tested_tree`, `candidate_fingerprint`, `scope_sha256` and
`acceptance_sha256`. Actual Git ancestry, exact candidate path set, working bytes,
index blobs and modes must match the tested commit. A same-tree synthetic orphan
is not an ancestor. These checks alone are insufficient: strict readiness still
returns `CURRENT_EVIDENCE_INCOMPLETE` after valid metadata until the full proof
consumer is implemented. No current pointer/report has been published in this task.

RED->GREEN slices 16-19 cover malformed pointers, wrong candidates, Git newline
conversion and stale builds after attributes change. Candidate compatibility passes
4/4 with an owned PostgreSQL 18.4 cluster; stop exit 0 and directory removal are
confirmed in `stage04-candidate-pg-cleanup.json`. Strict type programs pass.
Complete routed reader/binding regression passes 19/19 with no skips/cancellations/
todos/not_run. It includes wrong tree, stale scope/acceptance hashes, older candidate
and an explicitly synthetic same-tree non-ancestor rejection. All fixture worktrees
were removed. The 214-second development file is close to its existing 240-second
budget; add subsequent evidence-consumer cases in a separate registered file rather
than expanding that timeout or silently filtering acceptance cases.

Stage 3 development: the migration runner reuses the compiled G2 case reporter.
Each file receipt records actual execution path/cwd, source and executed byte hashes,
TAP/stderr/JSONL paths, sizes and hashes, and explicitly executed-file line numbers.
Case files must match observed loaded files in the checkout; a mismatched trace
fails despite passing TAP. Nonempty run directories reject before writing.
These changes have independent public-runner RED->GREEN evidence (slice10-12).
Complete migration host regression: 20/20. Actual compiled canary plus SOURCE_HOST
schema-contract execution: 7/7 across two files, with bound traces. Strict programs
and negative type canary pass. These are development checks, not the final full run.
The explicit current/historical mapping is now in
`plans/yxx-current-readiness-acceptance.json`, bound to both build and candidate.
It accounts for all 214 registered files: 213 current, one fixed-historical SS008
scope obligation. The historical domain also retains the original SS009 evidence,
history and governance regressions plus unchanged strict CLI. Current SS009
negative/protection tests remain in the current domain; they were not reclassified.
Current scope positives and negatives are in `tests/yxx-current-readiness.test.mts`.
The final evidence consumer is still pending; runner receipts alone do not prove READY.

Coverage-contract tests pass 3/3, including omissions, duplicates and wrong historical
identity. A public CLI RED->GREEN proves changing the acceptance contract invalidates
the existing build. With the case reporter enabled, the MIXED_EXPLICIT_ROOTS readiness
selection passes 15/15, case_count 15, no not_run files, executing its compiled MJS.
Together with the earlier SOURCE_HOST/STAGED_RUNTIME 7/7 this exercises all current
route modes. Strict types pass. The 213-file current full run and independent frozen
historical run have not yet been performed in this task.

Development commands (full execution needs the separately owned test environment):

```text
npm run migration:tools
node .build/tools/run-tests.mjs --current-plan
node .build/tools/run-tests.mjs --current-full --report-dir <new-external-directory>
```

The first runner command emits a plan, not results. The second executes the exact
current set through existing routes and rejects missing isolation before build/run.
Historical commands run independently in the complete, identity-verified CRLF
checkout named by the contract; preserve its original source-host implementation.
Its strict and regression logs must identify that head and must never contribute
to the current-file executed count. Retain the existing r6 mutation probe and
architecture checks when producing final historical evidence.

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
