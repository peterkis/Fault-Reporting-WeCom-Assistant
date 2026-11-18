# Card 35B — owner decision applied (2026-11-18)

[PR #191 CI and review rework](ci-fixes.md) records the later fixture/receipt/writer fixes and the full local PR selection: **74/74 entries, 548/548 tests; seven selected tool files, 138/138 tests**. [Per-entry receipts](ci-selection-results.json), [current baseline/image integrity](ci-integrity.json), [updated PR description](pr-description.md). The owner-policy validation below is preserved with its original capture and build identities; it is not the current CI receipt.

**All requested checks and both source-level reverse validations pass. The 18 owner-approved PNGs are preserved byte-for-byte; no current recapture and no approve execution.** The product owner then ran `visual:approve -- --all` in their own terminal; the committed baseline matches the approved SHA-256 set byte-for-byte and `visual:compare` exits 0 with no changes.

[Owner decisions](product-owner-decisions-20261118.md), [18 SHA-256 values](approved-screenshots-20261118.md), [final integrity check](approved-integrity-20261118.json), [machine verification](verification.json).

Approved capture environment: macOS 26.6.2 / Darwin Kernel Version 25.6.0: Fri Jul 31 19:19:08 PDT 2026; root:xnu-12377.161.14~5/RELEASE_ARM64_T6050 / 25.6.0; Chrome/157.0.8103.79; DPR 1; capture input `39f4e20b7502d517524e239bbc60a6ea547fe2014a135d87901bef9e56c40ff3`, head `f76fffef7c693ddcee0139b4f6f03bf59376e358`. Comparison-tool input after the policy/path changes: `7fba3fb3fea627618b93e9df473fdae7f15f48df01677d74e6e5c323192927ef`. The old capture metadata is intentionally preserved, not rebound.

## Changes and deletions

DEFAULT_THRESHOLD now uses pixelmatch 0.1 / ratio 0 by the named owner decision. The card's original ratio >0.1% is superseded. Validation still requires reasons for actual per-screen overrides; none is added. Tests cover one changed pixel and zero pixels, override boundaries, mandatory reasons and temporary-path restrictions. HTML/JSON report wording now states any changed pixel.

Capture and compare accept --current-dir only inside .build/visual; approve does not accept it. Source experiments write only to independent temporary directories, assert the approved current hashes before/after, restore real source exactly and rebuild. The final recapture was removed. No repository files deleted; no permanent product, fixture, viewport, mask, geometry, design-system chapter or prototype changes in this update. Dependencies remain only the two originally requested additions.

## Acceptance

| Item | Result | Evidence |
| --- | --- | --- |
| B0 / B1 tooling | PASS | Local platform-specific capture/compare, strict .mts -> .mjs build, only the requested two dev dependencies. |
| B1 threshold, owner amendment | PASS | 2026-11-18: pixelmatch 0.1; diff count >0 / ratio >0; original >0.1% superseded. Mandatory override reasons retained, no overrides added. |
| B1 validation/report | PASS | Single-pixel full-viewport regression test passes; zero default valid; former 0.001 requires reason; HTML/JSON updated. |
| B1 approval guard | PASS / execution NOT_RUN | Human TTY confirmation and agent refusal remain; alternate current output is restricted to .build/visual and is unavailable to approve. |
| B2 / B3 approved captures | PASS / PRESERVED | The approved 18 PNGs and capture metadata are unchanged; no masks or viewport/fixture changes. |
| B2 stability evidence | PASS / preserved prior result | Existing capture input 39f4e20b... has five runs, 180 raw zero-pixel comparisons. Not recaptured or rebound to the later comparison-tool input. |
| B4.1 / 3 / 4 evidence and conventions | PASS | Guide, owner decision record, hashes, updated report and PR description. Existing UI task-card template retains compare-summary convention. |
| B4.2 first baseline approval | PASS by owner | Owner approved 18 current PNGs and personally copied them with approve on 2026-11-18. The committed 18 PNGs plus meta.json are unchanged by the CI rework; no agent approve. |
| B4.5 radius | PASS | radius: compare exit 1; drawer-processing: 10 px (0.000694%); drawer-dismissed: 10 px (0.000694%); drawer-completed: 10 px (0.000694%); drawer-banner-editing: 10 px (0.000694%); close-dialog-out-of-scope: 28 px (0.001944%); close-dialog-duplicate: 26 px (0.001806%); restore-dialog: 2 px (0.000139%); toast-drawer-stack: 10 px (0.000694%) |
| B4.5 label | PASS | label: compare exit 1; close-dialog-out-of-scope: 95 px (0.006597%); close-dialog-duplicate: 95 px (0.006597%) |
| B5 | PASS | No CI capture, cross-browser matrix, H5, 35A/35C, permanent product edit, assertion replacement, commit or push. |

## Commands and results

| Command | Result | Evidence |
| --- | --- | --- |
| `npm run migration:typecheck` | PASS | `logs/owner-any-pixel-typecheck.log` |
| `npm run migration:build` | PASS; 968 typed modules / 3042 outputs | `logs/owner-any-pixel-build.log` |
| `npm --prefix app/pc-admin run lint:features` | PASS | `logs/owner-any-pixel-eslint.log` |
| `npm --prefix app/pc-admin run lint:css` | PASS; restored product CSS | `logs/owner-any-pixel-stylelint.log` |
| `node --test .build/runtime/tests/visual-regression.test.mjs .build/runtime/tests/pc-admin-copy-terms.test.mjs` | PASS; 17/17 (11 tool + 6 copy) | `logs/owner-any-pixel-unit.log` |
| `node --test .build/tools/pr-plan.test.mjs` | PASS; 22/22; isolated Python/PyYAML environment | `logs/owner-any-pixel-routing.log` |
| `node --test .build/tools/check-agent-docs.test.mjs` | PASS; 20/20 | `logs/owner-any-pixel-docs-tests.log` |
| `npm run docs:agents:check + changed Markdown link checks` | PASS | `logs/owner-any-pixel-docs.log` |
| `node .build/tools/verify-artifact.mjs` | PASS | `logs/owner-any-pixel-artifact.log` |
| `node .build/runtime/tools/visual-regression/reverse-validation.mjs` | PASS; both comparisons exit 1, source restored/rebuilt, approved current unchanged | `source-reverse.json` |
| `npm run visual:compare -- --baseline-dir .build/visual/source-reverse-any-pixel/baseline --report-dir .build/visual/clean-report` | PASS; exit 0, all 18 diff counts = 0 | `local .build/visual/clean-report` |
| `npm run visual:compare` | Historical result before owner copied baseline: expected exit 1, 18 missing. Current PR #191 rework: PASS, exit 0, all 18 zero pixels | [Current result](ci-fixes.md) |

These owner-policy logs remain local (ignored *.log). At that earlier delivery the changes were uncommitted, so no exact Git-diff plan was generated. The later PR #191 rework generates the committed-head plan and runs every selected database/browser entry; see the current receipt above. Full/certify and a new five-run capture were not run: the approved capture algorithm and content did not change, and the owner requested preservation of the current set.

## Screenshots and reports

Approved current: `.build/visual/current/darwin-chrome/` — all 18 original PNGs plus unchanged meta.json. The owner has copied the approved baseline. Current formal review HTML: `.build/visual/report/index.html`, exit 0, 18 zero-pixel comparisons. The earlier clean temporary-baseline report remains at `.build/visual/clean-report/index.html`.

| PNG | Viewport | Mask |
| --- | --- | --- |
| board-default.png | 1440x1000 / DPR 1 | None |
| board-presence.png | 1440x1000 / DPR 1 | None |
| board-filtered-empty.png | 1440x1000 / DPR 1 | None |
| list-default.png | 1440x1000 / DPR 1 | None |
| list-closed-groups.png | 1440x1000 / DPR 1 | None |
| drawer-processing.png | 1440x1000 / DPR 1 | None |
| drawer-dismissed.png | 1440x1000 / DPR 1 | None |
| drawer-completed.png | 1440x1000 / DPR 1 | None |
| drawer-banner-editing.png | 1440x1000 / DPR 1 | None |
| detail-fullpage-1280.png | 1280x1000 / DPR 1 | None |
| close-dialog-out-of-scope.png | 1440x1000 / DPR 1 | None |
| close-dialog-duplicate.png | 1440x1000 / DPR 1 | None |
| restore-dialog.png | 1440x1000 / DPR 1 | None |
| toast-tones.png | 1440x1000 / DPR 1 | None |
| toast-drawer-stack.png | 1440x1000 / DPR 1 | None |
| sidebar-online-popover.png | 1440x1000 / DPR 1 | None |
| conversation-default.png | 1440x1000 / DPR 1 | None |
| notifications-default.png | 1440x1000 / DPR 1 | None |

[Preserved five-run table](stability.md), [original capture-input receipt](stability.json), [stability investigation](stability-investigation.md).

## Source reverse validation

- radius: compare exit 1; drawer-processing: 10 px (0.000694%); drawer-dismissed: 10 px (0.000694%); drawer-completed: 10 px (0.000694%); drawer-banner-editing: 10 px (0.000694%); close-dialog-out-of-scope: 28 px (0.001944%); close-dialog-duplicate: 26 px (0.001806%); restore-dialog: 2 px (0.000139%); toast-drawer-stack: 10 px (0.000694%)
- label: compare exit 1; close-dialog-out-of-scope: 95 px (0.006597%); close-dialog-duplicate: 95 px (0.006597%)

[All per-screen numbers, flags and source restoration](source-reverse.md). Radius/label capture and comparison both use their own current directories. The two compare commands exit 1; the orchestrator succeeds only after both detect changes, sources are restored/rebuilt and approved images remain unchanged.

## Open questions, limits and rollback

- No sensitivity decision remains open: the owner replaced the original 0.1% rule with count >0 on 2026-11-18. Previous missed-detection FAIL evidence is preserved as superseded, not relabeled.
- Image approval is complete; the product owner ran the human-only approve on 2026-11-18; `docs/ui/visual-baseline/darwin-chrome/` holds the 18 approved PNGs and meta.json. Agent commit/push/approve counts are zero.
- Pixelmatch color/anti-alias rules remain unchanged; any pixel means any pixel counted by pixelmatch, not any raw RGBA-byte difference. Only darwin-chrome has been exercised; synthetic realtime presentation and real local HTTP/PG scope are unchanged.
- If a future UI change (including 35A) changes the approved images, capture separately and obtain a new owner review before replacing baseline content.
- Rollback the policy/path/test/doc changes together; do not silently restore the superseded sensitivity. There is no product Schema, persistent flag or deployment change.

[Guide](../../../visual-regression.md), [PR description](pr-description.md), [previous original-ratio delivery](superseded-original-ratio-README.md).
