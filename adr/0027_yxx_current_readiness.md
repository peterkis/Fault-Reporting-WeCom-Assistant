# ADR-0027: Current YXX technical readiness with immutable historical acceptance

Status: Accepted for implementation by the user's staged execution request, 2026-10-02.
Readiness, live permission, and PR completion remain unproven until their respective checks finish.

## Baseline and problem

The GitHub-verified main baseline is `562a96ffdd7148d729ab0eed9d215abe894f12c2`,
tree `fc20b1021291aca44b45ba3be461423a61bcee48`. PR37 was merged by
`78fc466af50c6d4c27850998267510fb1592157b`; this task does not start T05.
The current SS010 CLI calls the historical SS008 scope through the SS009 validator.
That scope correctly rejects migrations 035/036 and cannot certify the current candidate.
The current CLI hides the cause behind `SS010_NOT_READY`; the historical CLI returns
`YXX_VERIFICATION_REJECTED`. ARCH006 has two scope/current-evidence failures at this baseline.

## Decisions

1. Preserve ADR-0022 and the historical r7/SS009 validator, scope, records, tested
   ancestors and original tamper assertions. Run the original strict command in the
   complete CRLF checkout of published PR19 head
   `41edd855e7bc55149facb6a4b2e0076776c22e66`. A later source checkout is not that fixture.
2. `node scripts/yxx-self-service-readiness.mjs --require-ready` is the current
   offline entry. Without `--require-ready`, successful structural checking means
   `STRUCTURE_VALID_NOT_READY`. Strict success means `READY_FOR_LIMITED_WRITE_LIVE`
   technical preparation only: `live_authorized:false`, no parent Gate advancement.
   The stable failure envelope retains `SS010_NOT_READY` and adds allowlisted
   `stage`/`reason_code`. Unexpected failures remain failures without raw error data.
3. Current scope pins the accepted baseline, its 22 SQL paths, file modes and LF
   canonical content hashes, the six protected state files, and default capability
   boundaries. Build/raw-byte guards remain independently applicable. It never accepts
   every file found on disk or only an SQL filename. No SQL change is authorized here.
   An explicit subsequent contract change is needed for a different SQL/state scope.
4. History verification retains complete ancestry, overlay rejection, every relevant
   commit edge and index/working-file checks. Reuse the exact PR21 adjudications;
   never create a path exemption or accept rewrite-then-restore. Current scope/evidence
   processing must not alter the historical validator to make current HEAD pass it.
5. Reuse the current candidate inventory and migration route registry. Current scope,
   acceptance obligations and verification controls must be bound to the candidate.
   New implementation is strict MTS; existing MJS receives only necessary integration
   fixes. There is one runtime implementation and no source fallback.
6. Keep source, staged runtime and fixed historical roots distinct. Capture actual
   entry paths/hashes, source paths/hashes, loaded implementation provenance, TAP,
   stderr, case trace, file execution and cleanup receipts. Runtime line numbers
   must not be presented as TypeScript source lines without a verified mapping.
   Reject failures, skips, cancellations, todos, not-run files and missing identities.
7. Audit all registered obligations (213 at baseline), including genuine historical
   positives. Preserve historical tests on fixed objects and provide current scope
   positives/negatives separately. Report each domain's expected/actual set and SHA;
   historical execution is never counted as current-source execution. A 43-file
   development selection or overlapping migration batches are not full acceptance.
8. New final evidence uses a unique `yxx-current-<run_id>` namespace. Publication
   refuses existing targets; failed attempts remain independently identified. Store
   original records once and reference their size/encoding/SHA256. Check paths,
   symlinks, bounds, parsed content, candidate identity and set completeness, not
   only checksums. No PASS-only fallback or sole reliance on expiring Actions logs.
   Each reviewer writes an original JSON record (`schema_version: 1`,
   `kind: CURRENT_INDEPENDENT_REVIEW_RECORD`) containing its evidence time,
   axis/reviewer, tested head/tree/fingerprint, independent flag, verdict,
   unresolved count, historical-limitations confirmation, findings and nonempty
   `review_text`. Summaries must reference distinct originals and match those
   fields exactly. Check original bytes/size/SHA and fatal UTF-8 before parsing.
   This binds the records; independence and semantic quality still require the
   actual separate review process and final independent review.
   The schema-2 current pointer is the acyclic binding root for exact report,
   artifact catalog and attestation references. The catalog includes every original
   namespace file (including report) and excludes only itself and attestation;
   attestation binds report and catalog. Strict readiness requires the exact
   namespace union, original sizes/SHA/encodings and matching identities. A schema-1
   pointer remains readable for historical diagnostics but cannot prove READY.
   Current namespace originals are fatal UTF-8 text except PNG screenshot bytes,
   which must have the PNG signature and `binary` encoding. No arbitrary binary
   declaration may bypass text decoding. Bound the namespace traversal and bytes.
9. A separate current pointer may select an append-only report. Historical SS010
   and SS011 reports stay unchanged. Scope and acceptance inputs participate in
   candidate binding; evidence/pointer publication has an explicit non-circular role.
   Changed candidate, scope, proof requirements or missing/corrupt artifacts invalidate
   readiness. Do not invent a wall-clock TTL or renew an expired live authorization.
10. Split structural governance from evidence-consuming strict readiness. Tests and
    evidence generation must not require the READY report that they will produce.
    Final CI independently requires strict readiness. PR37's exact rejection
    classifier remains historical, not a classifier for future current candidates.
11. Freeze implementation, scope, tests, runner and CI at tested commit C. Run current
    acceptance and independent SPEC/STANDARDS review there. Append evidence to make H;
    require C to remain an ancestor of H and controlled inputs to remain identical.
    Report C's real tree, not H's evidence-bearing tree. Final H CI/review is recorded
    externally without self-referential commit hashes. Rebuild artifacts for H because
    the existing artifact guard binds actual head/tree; do not remove that guard.
12. Verify the accepted 22-SQL combination in an owned isolated PostgreSQL environment
    through existing migration entry points, default-closed capabilities and simulated
    providers. Preserve historical 032->033/034 test meaning. This task grants no
    access to a live database, OAuth, sending, deployment, P2-008 or production AI.

## Agreed public test seams

The approved stage plan identifies the current readiness CLI, current scope/evidence
verification entry, migration runner CLI, append-only evidence publication CLI,
history-protection entry and ARCH006 CLI. Test one observable behavior at a time:
RED at the real seam, minimal GREEN implementation, then the next behavior. Use real
temporary Git repositories/files/compiled artifacts, owned PostgreSQL and browsers;
mock only external dependencies. Do not mock internal validators to manufacture PASS.

## Existing live history and rollback

### Fixed T02 comparison retired from current admission (2026-10-03)

The user's revised closure instruction supersedes the earlier two-case T02 expiry
classification boundary. Only the SOURCE comparison replay at fixed T02
`7eefaa99591bfaa2e787701efd315ff701c51f35` and its remaining-file follow-up have
ended their PR38 admission duties. The historical migration comparison is retired
from current admission. Original FAIL, NOT_RUN, diagnosis and cleanup records stay
unchanged and are never represented as PASS or counted as current execution.
Original commands and the existing classifier remain available for manual diagnosis;
classification is not a prerequisite for retirement. No new case exemptions, replay
platform, workflow or classifier matrix is needed. Fixed-T02 runtime observations
are likewise removed from the CI admission call chain, avoiding indirect gating.

This does not retire historical object-source or evidence-integrity checks, the
fixed SS009 proof, still-applicable fixed P2-016 proof, or any test on current source
or compiled artifacts. Production permission, transaction, delivery and retention
constraints remain applicable. Current type/tool checks, clean build/artifact,
registry-derived four disjoint shards and complete union, architecture, strict
readiness and resource cleanup remain hard gates. The source-baseline job retains
its current responsibilities and the collector still requires its success; no
job-wide continue-on-error or acceptance of missing/skipped results is allowed.

Freeze one final candidate after these scheduling changes. Reuse the existing
acceptance and publication programs/model; retain C7's original identity and generate
new evidence for changed controlled inputs under decision 11. Final H must have real
successful current required CI and necessary review, no unresolved blockers or merge
conflicts. The user authorizes publication and a history-preserving merge commit
under those conditions without repeat confirmation or administrator override.
Final H/CI facts go in the PR description/comment, avoiding documentation successors
created solely to embed CI SHA. No T05, new business stage, production database,
sending, deployment, AI enablement or parent Gate advancement is authorized.

On 2026-10-02 the user additionally approved exactly the existing transition
`627d5f72959b4b2a085d734c311712363f87a3f8` / parent
`a58577d66733b3ec39f5d74af9ff44c70b79fe38` for
`evidence/g0-005-active-push-matrix.md`, blob
`b91ae75db2f49b3a2ff3240ff262e3d1c1a4db21` ->
`9bbadb5e3e140d3f3097cf386dc3ba198d37fd8d`, both mode `100644`, change `M`.
It appended the 14-line HTTP template-card capability record before PR21.
The precise record is `.github/review/yxx-current-evidence-adjudication.json`.
This acknowledges an existing historical rule violation; it does not claim the
append originally complied with immutability. The old five PR21 adjudications and
all historical evidence remain unchanged. Later same-path transitions still reject.

SS011's AC102 owner confirmation accepts partial close and AC101 write-off/read-only
rollback. AC096 B independent clear-fault evidence and AC099 actual response-loss/
stop-resume remain incomplete. This task neither resets those facts nor completes them.

Failure remains closed. Before merge, stop and preserve evidence; after merge,
revert implementation through a separate change while preserving append-only evidence
and historical approvals. No database rollback or deployment occurs in this task.

## v3 开发准入与认证调度（2026-10-03）

经用户授权，普通 TypeScript PR 采用活动 selection 的类型、一次构建、相关测试、制品和自有资源清理；历史差异保护在独立轻量 PR job 执行。完整 current 回归移至手动 full，证据消费的严格 readiness 移至手动 certify。固定历史证明由 SS009 workflow 的独立手动 certify 执行，R01 分别记录两条成功运行 URL。此调度分离不改变本 ADR 的认证字段、指纹、拒绝条件、证据准备/发布流程或生产授权；普通 PR 通过不代表 READY。
