# T04-05 local self-review

Base: `87de2bc9e8835882cd390b024a04e2865cd367f9`. Clean tested implementation: `60a02654fe48944381239f1b7c73e4f0cc71b761`, tree `f90005ef073bce4c47fc18b28c6cca62446cde23`.

This record covers the four P1 module migrations and the directly consumed p1-007 Worker type repair. It does not approve a business Gate, production activation, merge or T05-01.

## Scope and implementation

- Foundation, first acknowledgement, encrypted backup and P1 E2E now have one `.mts` source each and `.mjs` compiled output. Complete runtime exports, defaults, original validation, errors, time/hash handling and side-effect order match the authentic merged base.
- Raw Inbox property views and PENDING fallback identifiers keep `unknown` leaves. Function-property ports reject restricted implementations. The actual p1-007 Worker still validates raw identifiers before its original string/SQL use. The support repair changes only types.
- No production `any`, ignore directive, double unknown assertion, non-null assertion, declaration bridge or weakened compiler setting was introduced in the five modules. Strict production, tool and type-test programs plus the independent invalid-type canary pass. All four targets occur in the compiled manifest.
- Foundation npm commands validate the artifact and run its compiled module. Missing or stale outputs fail. The original P1 V1.2 configuration contract remains intact.
- Frozen Evidence, SQL, business state, dependency versions, persistent flags and resource defaults have no diff. The original workspace's user changes remain separate.

## Actual verification

The final T04-05 gate passed 47 selected files, 329/329 tests and two clean deterministic builds. The selection retains all 18 original P1 entries, the 17 baseline and 12 supplemental entries, with explicit routing and two new behavior entries. Type examples are excluded from runtime counts.

Tooling/hosts/batches passed 58/58 with zero failures, skips, cancellations or todo. These exercise added/deleted/tampered artifact files, source drift, host/source rejection and compiler sensitivity. Architecture passed 407 checks. The fixed P2-016 wrapper passed for the original full historical checkout; that result is historical-only.

The complete registered suite actually executed all 213 files: 1344 tests, 1342 pass, 2 fail, 0 skipped/cancelled/todo/not-run. The unchanged `ARCH-006 validator passes` and SS-008 scope tests fail on the clean base and the tested implementation with matching counts and titles. The original strict CLI retains exit 1 / `YXX_VERIFICATION_REJECTED`, classified as `YXX_LOCAL_VALIDATION_SCOPE_INVALID`. Later strict checks are not reached. Native byte capture preserves ARCH-006's original nonzero result and limits the extra aggregate path diagnostic to the exact reviewed nine-path source delta; it does not make readiness pass.

Type-erased structure comparison passed for all five modules. A separate real-process comparison verified inert imports, HTTP health and orderly shutdown against base and compiled implementation. On Windows the shutdown probe delivers the Node signal event through test IPC; POSIX operating-system signal delivery was not tested.

520 TAP/stderr hashes and the 47/213 file sets agree with the real reports. Implementation manifest SHA-256: `d74a5bc6505015cc6ebd90ff3f80733d472e0e6b1acdf9f838f8e2fe2ced2deb`. Original attempts remain in the artifact archive, including the first HTTP failure, outdated inventory expectation, PowerShell line-ending rejection and external probe URL error.

The owned PostgreSQL 18.4 cluster has no remaining test databases or other client backends and has been stopped. No pre-existing database or production resource was touched.

## Independent review and publication boundary

Standards and Spec independently reviewed `87de2bc...60a0265`. Standards initially found two P2 type-contract defects on `e16e1ff`; negative signatures reproduced them and the current implementation resolves both. Final remaining findings: Standards 0, Spec 0. Local review does not substitute for current published-head CI or the external Codex review.

The [receipt](../receipts/T04-05.json) deliberately remains `IN_PROGRESS` while final published-head CI and external review are pending. Its `tested_head` remains the real clean implementation ancestor. Documentation-only successors do not rebind that record; their artifacts and published identity must be checked separately.

Final publication results belong on the independent PR. Do not claim `APPROVED` for a review request or reuse an older head's CI. Merge is not authorized here. A later merge must preserve tested history or generate new evidence under the original contract.

Rollback is a separate revert PR of the source, CLI and registration changes. No database rollback is needed. Artifacts remain `STAGED_NOT_ACTIVATED`; T05-01 is not authorized to start.
