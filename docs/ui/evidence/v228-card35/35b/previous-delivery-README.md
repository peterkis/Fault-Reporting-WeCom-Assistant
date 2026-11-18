# Card 35B local visual regression delivery

Final local verification completed. Official baseline approval is pending the product owner, as explicitly requested. No commit, push, PR, or approve execution.

Environment: macOS 26.6.2; Chrome/157.0.8103.79; Node v24.18.0; PostgreSQL 18.6 (Homebrew); DPR 1. Head: `f76fffef7c693ddcee0139b4f6f03bf59376e358`; uncommitted build input: `2eb703555cfc82a68709923badce7dfe2d8683e5ace420726dc48cb180b15ba2`. [Machine/build receipt](environment.json).

## Changes and deletions

Added capture/compare/human approval tools, strict build registration, deterministic screenshot helper and 18-screen manifest, unit routing and testing-policy entry, guide and UI task-card template. npm added only the two requested development packages. No repository files deleted; product source, existing assertions, prototype and design-system state chapter remain untouched.

## Acceptance

| Item | Result | Evidence / scope |
| --- | --- | --- |
| B0 | PASS | Local system Chrome only; platform names and metadata validated; no CI capture workflow. |
| B1 directory/dependencies/build | PASS | TypeScript .mts -> .mjs; only pixelmatch 8.0.0 / pngjs 7.0.0 added as devDependencies with npm lockfile; build/type/artifact checks. |
| B1 capture | PASS | 18 final PNGs + meta.json under .build/visual/current/darwin-chrome/. |
| B1 compare | PASS | Triptych, diff count/ratio, per-screen threshold/reason, over-threshold flag, masks/reasons, report.json; missing baseline and changed-screen tests. |
| B1 approve guard | PASS / human success NOT_RUN | Pure guard tests cover non-TTY and agent environments. Interactive prompt and copy path implemented. The approve command was never run. |
| B1 platform/meta/threshold | PASS | OS + Chrome + DPR in capture metadata; platform separation and threshold boundaries covered by unit tests; overrides have validated reasons. |
| B2 viewport/time/motion/fonts | PASS | 1440x1000 DPR 1; 1280 full-page override; Date.now and new Date fixed to local 2026-11-13 10:00; reduced motion, CSS, fonts, animation settle and frames. |
| B2 deterministic fixtures/masks | PASS with disclosed scope | Fresh owned database/browser per screen; fixed identities/times/people; static realtime presentation fixture. Eight inert workbench backgrounds and one small sort label on each of three board views are masked with reasons; drawer/dialog foreground and presence tags remain visible. |
| B2 five consecutive runs | PASS | Same final input hash and machine; five x 18 screenshots; all 180 pairwise raw RGBA comparisons = 0. See stability.md. |
| B3 manifest | PASS | All 18 names, routes/preparation steps, viewport, mask and threshold fields present and validated. State-class additions remain for 35A author after merge. |
| B4.1 delivery/evidence | PASS | Tools, helper, manifest, five-run table and original failed attempt retained. |
| B4.2 official baseline | DEFERRED as instructed | Only README in the delivery; product owner reviews current images and runs approve manually. 35A merge requires fresh capture before baseline approval. |
| B4.3 guide | PASS | docs/ui/visual-regression.md covers execution, reports, intentional approved updates, new screens and per-platform baselines. |
| B4.4 template | PASS | No existing dedicated UI/PR template found; convention added in plans/pc-admin-design-v21/ui-task-card-template.md. |
| B4.5 radius +2px | PASS | board-default: 83 px (0.005764%); close-dialog-out-of-scope: 35 px (0.002431%) |
| B4.5 button one character | PASS | close-dialog-out-of-scope: 95 px (0.006597%) |
| B5 | PASS | No CI capture, browser matrix, H5, product UI code, design-system state chapter, 35A/35C work or existing assertion replacement. |

## Commands and actual results

| Command | Result | Evidence |
| --- | --- | --- |
| `npm run migration:typecheck` | PASS | `logs/typecheck-final.log` |
| `npm --prefix app/pc-admin run lint:features` | PASS | `logs/eslint.log` |
| `npm --prefix app/pc-admin run lint:css` | PASS | `logs/stylelint.log` |
| `npm run migration:build` | PASS; 968 typed modules / 3,042 outputs | `logs/build-final.log` |
| `node .build/tools/verify-artifact.mjs` | PASS | `logs/artifact-final.log` |
| `node --test .build/runtime/tests/visual-regression.test.mjs .build/runtime/tests/pc-admin-copy-terms.test.mjs` | PASS; 14/14 (8 tool + 6 copy) | `logs/unit-final.log` |
| `node --test .build/runtime/tests/pc-admin-card34c-copy.browser.test.mjs` | PASS; 1/1 real HTTP/PG/Chrome | `logs/browser-card34c-final.log` |
| `node --test .build/tools/pr-plan.test.mjs` | PASS; 22/22, isolated Python/PyYAML environment | `logs/routing-tests-with-python.log` |
| `npm run docs:agents:check + changed Markdown checks` | PASS | `logs/docs-final.log` |
| `node --test .build/tools/check-agent-docs.test.mjs` | PASS; 20/20 | `logs/docs-tests-final.log` |
| `5 x npm run visual:capture -- --run-id delivery-N` | PASS; 90 images, 180 raw pairwise comparisons, all zero | `stability.json` |
| `node .build/runtime/tools/visual-regression/reverse-validation.mjs` | PASS; both compare calls returned 1 and flagged the intended screen | `reverse-validation.json` |
| `npm run visual:compare -- --baseline-dir .build/visual/reverse/baseline --report-dir .build/visual/clean-report` | PASS; exit 0, 18/18 unchanged | `local .build report` |
| `npm run visual:compare` | EXPECTED exit 1; 18 missing baselines, no crash | `local .build/visual/report` |

Logs are retained locally in this evidence directory (the repository ignores *.log). The real Git-diff CI plan was not generated because changes remain uncommitted; no plan based only on unchanged HEAD is presented as coverage. Full/certify and unrelated historical browser suites were not run. [Machine-readable receipt](verification.json).

## Screenshots

Review all 18 current images in the generated HTML report: `.build/visual/report/index.html`; structured report: `.build/visual/report/report.json`. Images and metadata: `.build/visual/current/darwin-chrome/`. The report deliberately shows 18 missing baselines until the owner approves. A clean comparison against the temporary baseline is at `.build/visual/clean-report/index.html` (exit 0).

| Screen / PNG filename | Viewport | Mask |
| --- | --- | --- |
| `board-default.png` | 1440x1000 / DPR 1 | Sort label only |
| `board-presence.png` | 1440x1000 / DPR 1 | Sort label only |
| `board-filtered-empty.png` | 1440x1000 / DPR 1 | No |
| `list-default.png` | 1440x1000 / DPR 1 | No |
| `list-closed-groups.png` | 1440x1000 / DPR 1 | No |
| `drawer-processing.png` | 1440x1000 / DPR 1 | Yes; `.app` only |
| `drawer-dismissed.png` | 1440x1000 / DPR 1 | Yes; `.app` only |
| `drawer-completed.png` | 1440x1000 / DPR 1 | Yes; `.app` only |
| `drawer-banner-editing.png` | 1440x1000 / DPR 1 | Yes; `.app` only |
| `detail-fullpage-1280.png` | 1280x1000 / DPR 1 | No |
| `close-dialog-out-of-scope.png` | 1440x1000 / DPR 1 | Yes; `.app` only |
| `close-dialog-duplicate.png` | 1440x1000 / DPR 1 | Yes; `.app` only |
| `restore-dialog.png` | 1440x1000 / DPR 1 | Yes; `.app` only |
| `toast-tones.png` | 1440x1000 / DPR 1 | No |
| `toast-drawer-stack.png` | 1440x1000 / DPR 1 | Yes; `.app` only |
| `sidebar-online-popover.png` | 1440x1000 / DPR 1 | Sort label only |
| `conversation-default.png` | 1440x1000 / DPR 1 | No |
| `notifications-default.png` | 1440x1000 / DPR 1 | No |

[Five-run results (5 x 18 and per-screen maximum)](stability.md); [raw comparison receipt](stability.json); [manifest](../../../../../tests/visual/manifest.mts).

## Reverse validation summaries

- Radius: `--radius-lg` 12px -> 14px; compare exit 1; board-default: 83 px (0.005764%); close-dialog-out-of-scope: 35 px (0.002431%). [Receipt](reverse-radius.json).
- Label: `确认关闭` -> `确认关单` (one character); compare exit 1; close-dialog-out-of-scope: 95 px (0.006597%). [Receipt](reverse-label.json).

Both use a temporary baseline copied from current captures under `.build/visual/reverse/baseline/darwin-chrome/`; reports stay under `.build/visual/reverse/{radius,label}/report/`. Changes are injected only into disposable browser documents and disappear when those contexts close. Product source files were never edited for these experiments. The final current screenshots remain pristine.

## Limits, open questions and rollback

- Official baselines and the human confirmation/copy success path are intentionally NOT_RUN. The baseline directory contains only README. The owner must review these images, then recapture after 35A merges and approve manually. The masked sort-label coverage gap remains explicitly disclosed below; no business or permission contract was changed.
- Eight overlay screens cover only the occluded workbench background with an explicit mask/reason. Drawer/dialog foreground controls are fully compared. Three board views also mask the same small sort label (等待最久); those glyph pixels are outside coverage because local rasterization remained unstable without product changes. Seven screens have no masks. This is an explicit Open question / coverage limit for owner review.
- Realtime and presence presentation are synthetic/fixed; business reads use real local HTTP/PG. This tool supplements the existing real authorization, business and geometry tests. Only darwin-chrome was exercised.
- Initial failed full stability results are preserved in [the original table](stability-failed-initial.md) and [JSON](stability-failed-initial.json). The later sort-label failure is preserved in [its table](stability-failed-sort-label.md) and [JSON](stability-failed-sort-label.json). [Diagnosis](diagnosis.json) records the rendering probes. The stable pre-threshold candidate remains separately identified in [its receipt](stability-accepted-before-threshold.json); none was rebound to the final input hash.
- Every capture awaits owned browser/profile/timer/socket zero-state assertions, closes its own HTTP runtime, and drops only its newly created UUID synthetic database. Shared PostgreSQL and sibling worktrees were not stopped or cleaned.
- Rollback removes this card's tool/test/script/build-registration/document changes and its generated artifacts. No product schema migration, persistent feature flag or deployment was made.

Guide: [visual regression workflow](../../../visual-regression.md). PR draft: [review-ready description](pr-description.md).
