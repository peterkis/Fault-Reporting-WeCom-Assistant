# Card 35B revised local delivery

Local tooling, stability and required checks pass. **B4.5 expected detection is not achieved at the required default thresholds and remains an Open question**. The source-level experiment procedure completed and both product files are restored. Official baseline approval remains pending. No commit, push, PR or approve execution.

Environment: macOS 26.6.2 / Darwin Kernel Version 25.6.0: Fri Jul 31 19:19:08 PDT 2026; root:xnu-12377.161.14~5/RELEASE_ARM64_T6050 / 25.6.0; Chrome/157.0.8103.79; DPR 1; Node v24.18.0; PostgreSQL 18.6. Head `f76fffef7c693ddcee0139b4f6f03bf59376e358`, final input `39f4e20b7502d517524e239bbc60a6ea547fe2014a135d87901bef9e56c40ff3`. [Receipt](superseded-original-ratio-verification.json).

## Changes and deletions

Reworked reverse validation to edit real CSS/component source, rebuild, invoke capture/compare and restore/rebuild with hash guards. Removed all three threshold overrides and every manifest mask; removed the broad background-mask implementation and sort-label marking. Stabilization now waits for image decode and clears only non-containing-block HeroUI hints, preserves drawer translate, and asserts unchanged control/drawer/toast rectangles; only sort-trigger identity transforms are normalized. Reformatted 13 .mts files with explicit screen objects; zero lines over 200 characters. Added exact source-edit and frozen-Date unit checks. No repository files deleted; no permanent product source, design-system state chapter, existing assertion or prototype change. Added only an explicit fullRaster opt-in to the existing browser test harness; visual capture enables --disable-partial-raster, other callers retain their defaults. Only pixelmatch and pngjs remain newly declared development dependencies.

## Acceptance

| Item | Result | Evidence / scope |
| --- | --- | --- |
| B0 | PASS | Local platform-specific tooling; system Chrome; no capture workflow in CI. |
| B1 tools/scripts/dependencies | PASS | Strict .mts -> .mjs build; only pixelmatch/pngjs added as devDependencies. |
| B1 capture/compare | PASS | 18 captures; triptych/JSON, ratios/flags, clear missing-baseline behavior and nonzero failures. |
| B1 approval guard | PASS; human success NOT_RUN | Pure guard checks pass; interactive TTY and agent refusal; no approve execution. |
| B1 platform/meta/threshold | PASS | OS, Chrome, DPR and input hashes recorded; every screen uses pixelmatch 0.1 / ratio >0.1%; no overrides. |
| B2 stability helper | PASS | Frozen Date APIs, deterministic synthetic data, fonts/image decoding, motion/caret/paint settling and exact geometry guards. |
| B2 masks/root-cause investigation | PASS | All 18 masks empty. Scrims/backgrounds/text compared. See stability-investigation.md; background compositing explanation remains an evidence-based inference, not a proven sole cause. |
| B2 five consecutive captures | PASS | Same final source input and machine; 5x18, all 180 pairwise raw diffs zero. |
| B3 manifest | PASS | All 18 explicit objects with name/route/preparation/viewport/mask/threshold. |
| B4.1 evidence | PASS | Fresh zero-mask five-run table; old failures and earlier invalid evidence retained separately. |
| B4.2 official baseline | DEFERRED as instructed | Only README; owner reviews 18 current images, recaptures after 35A merge, then approves manually. |
| B4.3 documentation | PASS | Workflow, platforms, adding screens, owner approval and source experiments documented. |
| B4.4 UI card template | PASS | PR compare summary convention in plans/pc-admin-design-v21/ui-task-card-template.md. |
| B4.5 radius source procedure | PASS | Real token source 12->14px; build/capture/compare; byte restoration, empty git diff and rebuild. |
| B4.5 label source procedure | PASS | Real ClosureDialog source one-character edit; build/capture/compare; byte restoration, empty git diff and rebuild. |
| B4.5 radius detection | FAIL / OPEN QUESTION | radius: compare exit 0; flagged: none; drawer-processing 10 px (0.000694%); drawer-dismissed 10 px (0.000694%); drawer-completed 10 px (0.000694%); drawer-banner-editing 10 px (0.000694%); close-dialog-out-of-scope 28 px (0.001944%); close-dialog-duplicate 26 px (0.001806%); restore-dialog 2 px (0.000139%); toast-drawer-stack 10 px (0.000694%) |
| B4.5 label detection | FAIL / OPEN QUESTION | label: compare exit 0; flagged: none; close-dialog-out-of-scope 95 px (0.006597%); close-dialog-duplicate 95 px (0.006597%) |
| B5 | PASS | No CI capture, H5, browser matrix, permanent product change, 35A/35C work or existing assertion replacement. |
| Review readability | PASS | 13 new .mts files formatted; zero lines over 200 characters. |

## Commands and actual results

| Command | Result | Evidence |
| --- | --- | --- |
| `npm run migration:typecheck` | PASS | `logs/rework-typecheck.log` |
| `npm run migration:build` | PASS; 968 typed modules / 3042 outputs | `logs/rework-build.log` |
| `npm --prefix app/pc-admin run lint:features` | PASS | `logs/rework-eslint.log` |
| `npm --prefix app/pc-admin run lint:css` | PASS | `logs/rework-stylelint.log` |
| `node --test .build/runtime/tests/visual-regression.test.mjs .build/runtime/tests/pc-admin-copy-terms.test.mjs` | PASS; 16/16 (10 tool + 6 copy) | `logs/rework-unit.log` |
| `node --test .build/tools/pr-plan.test.mjs` | PASS; 22/22; isolated local Python/PyYAML environment | `logs/rework-routing.log` |
| `node --test .build/tools/check-agent-docs.test.mjs` | PASS; 20/20 | `logs/rework-docs-tests.log` |
| `npm run docs:agents:check + changed Markdown link checks` | PASS | `logs/rework-docs.log` |
| `node .build/tools/verify-artifact.mjs` | PASS | `logs/rework-artifact.log` |
| `node --test .build/runtime/tests/p2-g2-browser-lifecycle.test.mjs` | PASS; 6/6 existing browser lifecycle cases | `logs/rework-browser-harness.log` |
| `node --test .build/runtime/tests/pc-admin-card34c-copy.browser.test.mjs` | PASS; 1/1 real HTTP/PG/Chrome | `logs/rework-browser.log` |
| `5 x npm run visual:capture -- --run-id rework-final-N` | PASS; 90 PNGs, all 180 raw pairwise diffs zero; no masks | `stability.json` |
| `node .build/runtime/tools/visual-regression/reverse-validation.mjs` | Source workflow executed; EXPECTED DETECTION NOT ACHIEVED at default thresholds | `source-reverse.json` |
| `npm run visual:compare -- --baseline-dir .build/visual/source-reverse/baseline --report-dir .build/visual/clean-report` | PASS; exit 0; 18 unchanged | `local .build/visual/clean-report` |
| `npm run visual:compare` | EXPECTED exit 1; 18 missing baselines, no crash | `local .build/visual/report` |

Browser commands use the task's loopback PG and source/runtime root environment. Routing uses the previously isolated Python/PyYAML environment; no Python dependency was added to the repository. Logs are retained locally (ignored *.log). The real Git-diff CI plan is skipped because all work remains uncommitted. Full/certify and unrelated historical suites were not run.

## Screenshots

Review `.build/visual/report/index.html`: all 18 current images remain under `.build/visual/current/darwin-chrome/`, with meta.json. The formal report correctly lists 18 missing baselines and exits 1. The temporary clean comparison is `.build/visual/clean-report/index.html` (exit 0). **All 18 screens have no masks**, including scrims and the sort label.

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

[Five-run 5x18 table](stability.md), [all 180 raw comparisons](stability.json), [root-cause investigation](stability-investigation.md).

## Source-level reverse validation

- radius: compare exit 0; flagged: none; drawer-processing 10 px (0.000694%); drawer-dismissed 10 px (0.000694%); drawer-completed 10 px (0.000694%); drawer-banner-editing 10 px (0.000694%); close-dialog-out-of-scope 28 px (0.001944%); close-dialog-duplicate 26 px (0.001806%); restore-dialog 2 px (0.000139%); toast-drawer-stack 10 px (0.000694%)
- label: compare exit 0; flagged: none; close-dialog-out-of-scope 95 px (0.006597%); close-dialog-duplicate 95 px (0.006597%)

[Every screen's pixels, ratio, raw difference and flag](superseded-original-ratio-source-reverse.md); [machine-readable receipt](superseded-original-ratio-source-reverse.json). Both real source edits were rebuilt and served through capture, then restored byte-for-byte, checked with git diff and rebuilt. The current images are clean. No experiment used in-page injection or the official baseline directory.

## Open questions and limits

- Both tiny intentional changes remain below the specified default detection threshold. No screen was flagged. B4.5 detection is honestly marked FAIL / OPEN QUESTION; the product owner must decide whether future sensitivity should change. All current thresholds remain at pixelmatch 0.1 and ratio >0.1%.
- Background blur/scrollbar/font/animation observations and rejected probes are documented. The original intermittent background failure was not reproduced by this round's eight-run control; residual compositing hints are an evidence-based explanation, not a proven sole cause. Final acceptance uses the full zero-mask five-run result.
- Realtime/presence are fixed synthetic presentation; business reads remain real local HTTP/PG. Only darwin-chrome was exercised. No stable screen requires a permanent product change.
- Official baseline and actual human approval success path are NOT_RUN by instruction. Review current images, recapture after 35A merges, then approve manually in a normal interactive terminal. The directory contains only README.
- Earlier masked/threshold-tuned and in-page receipts remain under their original fingerprints and `previous-delivery-*`; their PASS claims are superseded by this report, not rebound to this candidate. Original failures remain; the intermediate zero-diff candidate with shifted toast geometry is also retained as pre-geometry-guard-* and superseded.
- Every capture closes its own browser/profile/timers/sockets and own HTTP runtime, and drops only its new synthetic database. Shared PostgreSQL and sibling worktrees are untouched.

Rollback removes this card's tooling/tests/scripts/build registration/docs; no persistent flag, Schema migration or deployment exists. [Guide](../../../visual-regression.md), [PR description](superseded-original-ratio-pr-description.md).
