# Card 35B — local screenshot regression baseline tool

Adds platform-specific local capture, HTML/JSON comparison and human-only approval for 18 deterministic screens. The product owner approved the current PNG set on 2026-11-18 and changed the default to **any pixelmatch-classified changed pixel** (pixelmatch 0.1, ratio >0). The original card default ratio >0.1% is superseded. Per-screen overrides still require reasons; none is used.

This update adds protected temporary current paths for source experiments, preserves approved current PNGs/meta.json, updates validation/tests/report wording and removes the final current recapture. No repository files deleted or permanent product/fixture/visual-stability changes. New dependencies remain only pixelmatch/pngjs.

Validation: typecheck, build, eslint, restored-CSS stylelint, artifact and docs checks pass; 17/17 tool/copy tests, 22/22 routing tests, 20/20 docs tests pass. The single-pixel report test fails comparison with exactly one changed pixel. The earlier five-run 90-image/180-pair zero-mask result remains bound to capture input `39f4e20b7502d517524e239bbc60a6ea547fe2014a135d87901bef9e56c40ff3`; it was not rerun or rebound to the new tool input.

Approved image integrity: **18/18 SHA-256 values unchanged; no current recapture**. [Hashes](approved-screenshots-20261118.md), [verification](approved-integrity-20261118.json), [acceptance and commands](README.md).

visual:compare: clean temporary approved baseline — exit 0, 18 screens / zero changed pixels. Formal baseline still absent by instruction — 18 missing, exit 1 with a readable report.

Source-level negative controls under the new default:
- radius: compare exit 1; drawer-processing: 10 px (0.000694%); drawer-dismissed: 10 px (0.000694%); drawer-completed: 10 px (0.000694%); drawer-banner-editing: 10 px (0.000694%); close-dialog-out-of-scope: 28 px (0.001944%); close-dialog-duplicate: 26 px (0.001806%); restore-dialog: 2 px (0.000139%); toast-drawer-stack: 10 px (0.000694%)
- label: compare exit 1; close-dialog-out-of-scope: 95 px (0.006597%); close-dialog-duplicate: 95 px (0.006597%)

Both real source edits were rebuilt, captured and compared in independent temporary directories, then restored byte-for-byte and rebuilt; no experimental source residue. [Every screen's pixels/ratio/flag and restoration proofs](source-reverse.md). **B4.5 detection now passes.** The superseded original-ratio failures remain preserved.

The owner-approved 18 PNGs stay in .build/visual/current/darwin-chrome/. The reviewer will run approve; the agent has not. No commit, push, PR, CI capture, browser matrix, H5 or 35A/35C work.
