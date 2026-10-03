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
| 4 | Current evidence verifier, append-only publication, pointer and mutation tests | COMPLETE for development implementation; component/publication regressions pass; actual whole-packet strict READY remains unverified until stage 6 frozen acceptance |
| 5 | ARCH006/current CI separation and retained historical CI | COMPLETE for development implementation; final exact-head CI and wall-time measurement remain stages 6-7 |
| 6 | Frozen candidate, full applicable execution, two-axis review and owned-resource cleanup | COMPLETE; C 9b25f57, 216 files / 1380 tests PASS, both reviews PASS, cleanup confirmed |
| 7 | Append evidence, publish PR, verify final head CI/review, authorized history-preserving merge | IN_PROGRESS; immutable packet staged and strict READY verified; final H CI/review/merge pending |

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

Historical SS009 proof was independently completed on the GitHub-confirmed PR19
head `41edd855e7bc55149facb6a4b2e0076776c22e66` with base
`375d47b013017edb858206cc5f3475c9aed77dfd`. Identity preflight, unchanged strict
CLI, four original regression files (36/36), original r6 mutation probe and all
eight historical validators pass. V1.4 reports 407 checks. The isolated checkout
remains clean. The initial regression attempt failed one case due to Windows Git
path length; both attempts remain recorded. Only checkout-local `core.longpaths`
was enabled before the successful rerun; historical source and evidence were not
modified. External `historical-ss009-proof-02/catalog.json` binds the raw proof and
case trace. This is fixed historical proof, not current candidate acceptance.

Current review and cleanup components require two distinct normalized reviewer
identities, separate SPEC/STANDARDS axes and exact candidate binding; all findings
must be resolved. Cleanup requires raw TAP cleanup observations with zero owned
residuals plus matching successful environment shutdown receipts for every run.
PASS-only cleanup and whitespace/case aliases for the same reviewer reject.
The public strict entry remains closed pending the complete evidence consumer.

The historical component now verifies the catalog, original proof/log hashes and
sizes, authoritative fixed PR identity, preflight, unchanged strict command,
36 regression cases and TAP, all four r6 probe experiments and all eight original
validator commands/results. It compares the historical fingerprint and tested
ancestor with protected r7; these never substitute for the current fingerprint.
Public-entry RED->GREEN covers a PASS-only historical summary. Synthetic consistency
mutations cover wrong head, omitted validator, rehashed unsuccessful strict output,
omitted probe experiment, omitted trace case and raw log tampering. Routed evidence
tests pass 8/8 and strict type programs pass. The same compiled component separately
accepts the actual `historical-ss009-proof-02` originals (external replay result
`stage04-historical-replay-01/result.json`). An earlier routed attempt timed out at
240 seconds; its failure record is retained. A targeted rerun passed 2/2 and the
complete rerun passed 8/8 in about 35 seconds. No timeout threshold was relaxed.

Specialized proof now binds all original SS009/SS010 TAP observations to the
executed host fingerprint. Runtime identity uses the tested candidate's archived
build manifest plus unchanged runtime files, so evidence-only publication does not
misbind C's receipts to H's new build metadata. Existing fault/capacity/catalog
semantics are reused. Both real browser/PostgreSQL receipt sets, zero external
network calls, four original screenshots and their digests/PNG dimensions are
required. Observations may not be omitted, duplicated or replaced by a PASS summary.
The public strict entry passed RED->GREEN for unsupported specialized summaries.
Routed development tests pass 9/9, including runtime drift, wrong host fingerprint,
missing capacity/observations, missing real PostgreSQL and damaged screenshot
rejections, plus evidence-only manifest successor compatibility. Historical receipts
and images reused by the parser fixtures are explicitly synthetic test inputs;
they are not current execution evidence. Actual current full execution, scenario
and source accounting, current artifact guarding at final strict success, immutable
publication and final READY remain pending.

Source accounting is recomputed from integrity-checked current per-file TAP, ordered
by source path, with recomputed aggregate counts. It reuses the existing source
audit for all 202 cases, the 122 normal-input denominator and actual manual-review
observations. The report must exactly match the derived audit and preserve
`original_semantics_all_passed:false` and the requirement for semantic review.
It cannot claim current coverage solely from a historical PASS summary. Historical
TAP replay in development tests is explicitly a parser fixture, never current
acceptance. Scene-to-case mapping and historical scenario linkage still require
their separate proof component before the full strict entry can return READY.
Public-entry RED->GREEN and routed development tests pass 10/10, including freshly
rehashed missing-source/manual-action negatives and raw corruption; strict type
programs pass. Receipts are under `slice30-red`, `slice30-green`,
`stage04-source-accounting-tests` and `stage04-source-accounting-types.log` in the
external task artifact directory. These results do not claim current full acceptance.

Before consuming the legacy scenario mapping for current accounting, its exact
`plans/yxx-ss-009-acceptance.json` path was added to current candidate controls and
raw build inputs. A public CLI regression first demonstrated that editing this
mapping left the existing build usable, then passed after the binding fix. The
regression also checks that each verification-control edit changes the candidate
fingerprint. The historical mapping itself and frozen historical implementation
remain unchanged. Evidence: `slice31-red.log`, `slice31-green.log` and
`stage04-scenario-control-types.log`; focused test 1/1 and strict types pass.

Current scenario mapping now derives AC001-090 from the controlled legacy mapping
and AC091-094 from the existing SS010 acceptance contract. Every declared test must
match exactly one successful raw trace record at its expected source path; bound
records include source hash, actual executed path and executed-file line number.
Compiled line numbers are explicitly not source lines. Existing member/G2 historical
bindings (48/37 scenarios) are independently regenerated against current cases and
source hashes. Their `live_result:NOT_RUN` describes this automated run only;
the mapping explicitly preserves historical live facts without revalidating or
resetting AC095-102. No live permission is inferred. Public-entry RED->GREEN and
routed tests pass 11/11, including missing scenarios, duplicate/missing cases,
wrong file bindings and false live authorization. Strict types pass. Historical
trace replay is a parser fixture only, not evidence of current candidate execution.
Receipts: `slice32-red`, `slice32-green`, `stage04-scenario-proof-tests` and
`stage04-scenario-proof-types.log` in the external artifact directory.

The evidence API now reuses the existing migration artifact verifier for actual
current source identity and every runtime output byte. Once all implemented proof
components are supplied, `checkSS010` invokes this guard as well as the CLI's existing
check. A real compiled module mutation and absent build reject with
`CURRENT_BUILD_INVALID`; the same unchanged build passes before and after restoration.
Routed evidence tests pass 12/12. Strict readiness still deliberately returns
`CURRENT_EVIDENCE_INCOMPLETE`: binding of combined 22-SQL runtime proof and immutable publication
remain pending. The existing old-chain and separate 035/036 tests do not prove the
complete combination in one owned database. No existing migration, historical
evidence or SQL file has been changed. Receipts: `slice33-red.log`, `slice33-green.log`,
`stage04-artifact-guard-tests` and `stage04-artifact-guard-types.log`.

The combined 22-SQL development characterization now passes in one owned PostgreSQL
18.4 database, through the existing baseline/YXX, workbench-auth and staff-directory
entry points. It observes all 14 legacy applications, checks all eight subsequent
marker IDs and raw SQL checksums, validates YXX/directory catalogs, then repeats the
entry points and requires NOOP with unchanged markers. Ticket/intake counts remain
zero. The raw TAP contains `CURRENT_SCOPE_CATALOG` with the scope hash, executed
runtime fingerprint, 22 normalized SQL digests and measured outcomes, followed by
the existing measured database/pool cleanup receipt. The outer cluster was stopped
(exit 0) and its owned data directory removed. This adds no SQL or migrator changes.
The new typed test is mandatory in the current full set and has a DB-required route.
Runtime characterization: 1/1; registry/host regressions: 23/23; strict types pass.
External receipts are `stage04-combined-v1-tests`, `stage04-combined-v1-pg-cleanup.json`,
`stage04-combined-tooling.log` and `stage04-combined-types.log`. This development run
is not frozen acceptance; strict consumption of its receipt shape remains pending.

Combined migration receipt consumption is now implemented. It requires exactly one
receipt from the designated current migration test, exact 22-file scope, 14 observed
legacy applications, eight raw SQL marker checksums, PostgreSQL 18, successful
initial application and unchanged-marker replay, valid catalog and zero business
rows. Scope and tested-runtime fingerprints must match. Twelve semantic/source
mutations remain rejected even with recomputed TAP hashes. The tested runtime
fingerprint reconstruction is shared with specialized proof verification.

The strict consumer now requires all nine proof components, checks report time and
`CURRENT_AUTOMATION_COMPLETE` with live/parent permission false, then verifies the
actual current build before its success return. Success reports technical
`READY_FOR_LIMITED_WRITE_LIVE`, `base_service_ready:true` and
`ai_enhancement_ready:false`; it never grants live or parent Gate permission.
This success branch is implemented but has not yet been proven with a real complete
frozen packet. Current strict CLI still exits 1 with `CURRENT_EVIDENCE_REQUIRED`.
Component/negative regressions pass 13/13 and strict types pass. Receipts:
`slice34-red`, `slice34-green`, `stage04-migration-proof-tests`,
`stage04-strict-composition-tests`, `stage04-strict-composition-types.log` and
`stage04-strict-current-closed.log`. Immutable publication and stages 5-7 remain.

Append-only publication is implemented in `tools/ts-migration/publish-current-evidence.mts`.
Its input is an external prepared directory with `packet.json` and the exact listed
payload files. The packet manifest is `{schema_version:1,kind:"CURRENT_EVIDENCE_PACKET",
run_id,files:[{path,bytes,sha256}]}`; paths are relative to that directory. It must
include `report.json`, whose nine proof components reference files beneath
`evidence/yxx-current-<run_id>/`. Every input file is checked before staging. Raw bytes
are copied exclusively into a new namespace and checked again. Limits are 64 MiB per
file, 256 MiB total and 4096 payload files. The input manifest itself is not payload.
Existing evidence directories are never overwritten or deleted; failed partial
staging remains unreferenced for inspection. Text/Binary bytes, including CRLF and
empty stderr, are preserved. Input/output links, escaped paths, Windows reserved
names, case collisions, unlisted files, bad hashes and foreign report references reject.
Canonical paths prevent a directory alias disguising an in-repository packet.

The pointer is written last. First publication uses exclusive creation. Replacement
requires `--expected-pointer-sha256` matching the current pointer's actual bytes;
publication is serialized with an exclusive owned lock and replacement uses an
atomic same-directory rename. Other locks and earlier reports are preserved.
This command only returns `EVIDENCE_STAGED_NOT_READINESS`, never READY. Packet
integrity is not semantic acceptance: rebuild, run the full strict consumer, then
commit the evidence-only successor, rebuild again and verify the final published head.
Do not manufacture PASS data to prepare a packet; derive it from the frozen raw
execution, independent reviews, measured cleanup and the controlled derivation APIs.

```text
npm run migration:tools
node .build/tools/publish-current-evidence.mjs --packet <absolute-prepared-directory>
# For an explicitly selected replacement, append --expected-pointer-sha256 <current-raw-pointer-sha256>.
npm run migration:build
node scripts/yxx-self-service-readiness.mjs --require-ready
```

Publication public-CLI regressions pass 8/8, including exact-prior-hash replacement
and protection of another publisher's lock; strict types pass. RED->GREEN records
are `slice35-*`, `slice36-*` and `slice37-*`; final receipts are
`stage04-publication-complete-tests.log` and `stage04-publication-complete-types.log`.
All publication tests use owned synthetic repositories and cannot establish current
readiness. No actual current pointer or final evidence packet has been published.

Stage 4 execution core now checks the complete declared current set across disjoint
run references, per-file success, source/actual execution hashes, archived build
identity and agreement with current build metadata, raw TAP/stderr/trace digests and
sizes, parsed counts, loaded-file provenance, case names/nesting and TAP agreement.
Partial PASS summaries, duplicate shards, omitted work, rehashed failing TAP and
rehashed missing/wrong cases reject. The new `yxx-current-evidence` selection passes
5/5 (including ten consistency mutations); acceptance-plan tests pass 3/3 and strict
type programs pass. These parser fixtures are explicitly synthetic and cannot pass
the actual readiness entry; they are not published acceptance evidence.

The registry now has 216 entries: original 213 plus three current-readiness test files.
The current contract requires 215 files, with one separate historical SS008 file.
The two registered SOURCE_HOST review tests and their two direct implementation
dependencies are now explicit build/candidate controls. A real CLI RED->GREEN
proved their former build-binding omission; review documentation is not included.

Before completing stage 4, wire the complete strict consumer (including the real
current artifact verifier for direct API callers), historical/specialized receipts,
review and cleanup proofs, and append-only publishing. Before final evidence/CI,
adapt the two development assertions that currently expect the real checkout to
have no current pointer: final publication must not make valid readiness break its
own tests. Preserve isolated missing-evidence negatives. Freeze/run in a complete
CRLF checkout so archived raw input/output hashes reproduce across CI hosts.

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
budget; subsequent evidence-consumer cases use a separate registered file rather
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
It now accounts for all 216 registered files: 215 current, one fixed-historical SS008
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
route modes. Strict types pass. The current full run has not yet been performed.
The separate fixed historical proof is recorded above and does not contribute to
current execution counts.

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

Stage 5 first slice: ARCH006 now calls the current ADR-0027 structural check,
including exact scope and full protected-evidence history, without requiring a
current evidence packet. It rejects all historical evidence modifications relative
to origin/main; new receipts remain append-only. There is no missing-scope fallback
to historical acceptance. The fixed historical checkout and validator are untouched.
Existing public CLI regression reproduced both old failures, then passed 6/6.
The extended routed regression passes 7/7, including missing current scope and an
unauthorized historical evidence change through the compiled CLI. An initial
negative-control attempt hit the source-host artifact guard first; its log is
retained and is not counted as the ARCH006 protection result. Logs: stage05-arch-red,
stage05-arch-green, stage05-arch-protection and stage05-arch-protection-green under
the external task artifact directory. This is development validation only.
Current strict readiness, frozen full acceptance and final CI remain unproven.

Stage 5 shard execution slice: the public runner now supports `--current-plan
--shards 4` and `--current-full --shard 1/4` (one-based identity, maximum 16 shards).
The deterministic partition covers all 215 current files exactly once; four shards
contain 53 or 54 files. Historical scope stays outside that set. Each invocation
retains normal build, route, raw TAP/trace, artifact and isolated-database checks.
No per-file timeouts or capacity durations were reduced. Existing strict evidence
verification rejects duplicate or missing files across current_runs; shard labels
alone never prove completeness. Planning/execution tooling regression: 5/5, with
both missing-capability RED logs retained. Receipts: stage05-shard-red,
stage05-shard-execution-red and stage05-shard-acceptance-final.log. Full shard runs
and CI wall-time measurement remain pending; no time-saving result is claimed yet.

Stage 5 CI collection slice: `verify-current-shards.mts` checks downloaded shard
summaries against the current planned sets, exact expected Git head/tree, clean
and identical build manifests, all raw TAP/stderr/case-trace byte hashes, TAP
counts and the complete 215-file union. Its output explicitly sets readiness=false;
this collector is not the acceptance packet verifier. Public CLI RED->GREEN fixture
coverage rejects missing summaries, omitted work, duplicate shard identity, forged
counts, corrupt raw TAP and a wrong build identity. Synthetic collection fixtures
are parser/integrity regression inputs only, never acceptance evidence. Log:
stage05-collection-green.log. Workflow integration remains pending.

Stage 5 workflow integration: TypeScript CI now runs four disjoint current shards
instead of six overlapping migration batches. Baseline/source comparison starts
independently and retains one current shadow rather than two identical selections.
The final current-complete job requires all tooling, current shards and baseline
jobs to succeed, downloads this run's artifacts, then checks all 215 files and raw
logs against the published head. The baseline job now requires actual current
ARCH006 and strict SS010 success; original SS009 on current remains explicitly
rejected. The pinned PR37 refusal classifier is retained in its named tooling
regression, not applied to the new candidate. Fixed historical SS009 CI retains
strict verification, r6 mutations and validators and now includes the original
SS008 scope test; Windows long paths are enabled before checkout.
Both workflow YAML documents and all 39 shell steps pass local syntax validation
(stage05-ci-syntax.json). No remote CI run or wall-time improvement is claimed.
Readiness-test evidence lifecycle assumptions still need correction before freeze.

Stage 5 lifecycle closure: the actual-checkout readiness tests now work both before
and after evidence publication. Missing/malformed evidence stays a rejecting
isolated-fixture test; the real CLI must match the strict API's current decision.
The prior real missing-evidence assumption was reproduced RED with a temporary
invalid pointer, which was removed. A complete 240-second routed attempt timed out
and remains FAIL, not acceptance evidence. Its processes exited; one clean owned
fixture worktree was subsequently removed. The CLI/offline checks moved to a
separate MTS test entry, preserving all 19 cases and the 240-second per-file limit.
The two routed files pass 13/13 (196.5 seconds) and 6/6 (87.6 seconds). Registry and
host regressions pass 26/26. Logs: stage05-lifecycle-red, stage05-lifecycle-tests
(failed), stage05-lifecycle-split-tests and stage05-lifecycle-registry.log.
Current acceptance is now 216 files plus one separately historical registered
file (217 entries total), with four disjoint current shards of 54 files. The stale
current ARCH006 known-failure annotation was removed; the pinned PR37 classifier
and its independent historical regression remain unchanged. Final strict READY,
current full execution, independent review and remote CI are still unproven.

Stage 6 frozen acceptance (2026-10-03): candidate C
`9b25f574cb956f6afbd275f1d0278efa653720e4` / tree
`b68d33d0e8a723610b14b4a90befe91cfeb706fb` completed all 216 current
files and 1380/1380 tests, zero fail/cancelled/skipped/todo/not_run. The owned
PG18 environment stopped successfully and its data directory was removed; raw
cleanup confirms zero residuals and no preexisting resource changes. Independent
SPEC and STANDARDS reviewers each returned PASS with zero unresolved findings.
The 927-file append-only packet retains raw TAP/stderr/traces, historical proof,
specialized screenshots, scenario/source accounting and review/cleanup receipts.
All eight packet components passed; after staging and rebuilding, the public
current strict CLI returned READY_FOR_LIMITED_WRITE_LIVE with zero database,
provider or listener activity and live_authorized=false. The original historical
SS009 command on current remains rejected; its fixed historical proof passes.
Final evidence-bearing H rebuild, remote CI, exact-head review and merge are
pending and are recorded externally to avoid self-referential evidence hashes.
