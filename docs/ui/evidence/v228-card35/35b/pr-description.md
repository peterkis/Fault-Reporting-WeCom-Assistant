# Card 35B — local screenshot regression baseline tool

Adds platform-specific local capture, HTML/JSON comparison and human-only approval for 18 deterministic screens. The product owner approved the current PNG set on 2026-11-18 and changed the default to **any pixelmatch-classified changed pixel** (pixelmatch 0.1, ratio >0). The original card default ratio >0.1% is superseded. Per-screen overrides still require reasons; none is used.

This rework prevents a partial capture from passing with 17 leftover images: compare now requires each selected PNG to be recorded in the current receipt and match its SHA-256. Uncovered files are `unrecorded`; hash mismatches are `stale`; both fail comparison. A named subset is explicit in the command and report. Partial capture replaces its receipt rather than merging older captures. Incomplete capture also fails closed. Reverse validation and stability now prepare nested evidence/log directories before writing, including restoration logs. Three regression tests cover these cases.

## CI fixes

SS-009 HTTP recovery used only `migrateCurrentBaselineWithYxx`, while the current runtime queries `pilot_ticket.closure_record` and later schema. This fixture defect already exists on main `f76fffef`; the affected setup files are unchanged between main and PR head `7ea9e17c`. A local run before the fix reproduced 2/2 failures, including 503 instead of the asserted 404 on revocation. The broad selection caused by `package.json` exposed it; 35B did not introduce it.

Current SS-009 runtime fixtures now apply 071 → 072 → 073 → 074 after the baseline. The capacity fixture sends the current out-of-scope closure reason pair. The populated historical Bot scenario retains the exact 032 → 034 catalog and original row snapshots, with empty 071 applied only around current-runtime population/replay. Every existing assertion is preserved. Other selected older chains were audited and exercised without further setup failures.

The complete local PR selection passed **74/74 entries, 548/548 tests**: 44 entries require PostgreSQL and 12 require the system browser. All seven selected tooling files passed **138/138 tests**, including routing and docs tests. No known-flake exclusion, cancellation or skip was used. [Per-entry results and diagnosis](ci-fixes.md), [machine-readable receipts](ci-selection-results.json).

The explicit audit of **all five SS-009 integration files passes 14/14 tests**, including both capacity profiles and the historical catalog/replay scenario. Every selected older-chain setup and the already-current SS-010 fixture also passed.

Local environment corrections: canonical `TMPDIR` avoids the macOS `/var` alias mismatch in existing build-fixture checks; resolved FFmpeg/ffprobe executable paths satisfy the existing no-symlink guard. The initial complete run's two H5 media failures are preserved; both pass with the real binary paths (15/15 tests), and the entire selection was then repeated successfully. No media/product code or assertions changed.

## Validation and visual comparison

Typecheck, build (969 typed modules / 3044 outputs), eslint, stylelint and artifact checks pass. The standalone tool/copy run passes **20/20 tests** (14 tool + 6 copy); the policy scheduling check passes 1/1. Build input: `5878b428baa5939c6a35f6a66ed5dad45ea4fb8a2ae44765199660a382d59c88`, with uncommitted fixes on head `7ea9e17cafeb58f0dca268a59119aabeb8d1ce61`. The earlier five-run 90-image/180-pair result remains bound to capture input `39f4e20b7502d517524e239bbc60a6ea547fe2014a135d87901bef9e56c40ff3`; it was not rerun or rebound.

Approved image integrity: **18/18 SHA-256 values unchanged; no current recapture**. [Hashes](approved-screenshots-20261118.md), [verification](approved-integrity-20261118.json), [acceptance and commands](README.md).

`npm run visual:compare` against the committed owner-approved baseline exits **0**: **18 unchanged screens, zero changed pixels**, no stale/unrecorded files, no missing baseline or metadata errors. All 19 committed baseline files and all 18 approved current PNGs are unchanged. No capture or approval was executed. [Current integrity proof](ci-integrity.json). Report: `.build/visual/report/index.html` and `report.json`.

Source-level negative controls under the new default:

- radius: compare exit 1; drawer-processing: 10 px (0.000694%); drawer-dismissed: 10 px (0.000694%); drawer-completed: 10 px (0.000694%); drawer-banner-editing: 10 px (0.000694%); close-dialog-out-of-scope: 28 px (0.001944%); close-dialog-duplicate: 26 px (0.001806%); restore-dialog: 2 px (0.000139%); toast-drawer-stack: 10 px (0.000694%)
- label: compare exit 1; close-dialog-out-of-scope: 95 px (0.006597%); close-dialog-duplicate: 95 px (0.006597%)

Both real source edits were rebuilt, captured and compared in independent temporary directories, then restored byte-for-byte and rebuilt; no experimental source residue. [Every screen's pixels/ratio/flag and restoration proofs](source-reverse.md). **B4.5 detection now passes.** The superseded original-ratio failures remain preserved.

The owner-approved 18 PNGs stay in `.build/visual/current/darwin-chrome/`; the owner-approved committed baseline is untouched. These fixes remain uncommitted, with no push or approve. Remote CI has not been rerun for these uncommitted fixes. No product code, dependencies, rendering/fixture content for visual capture, visual thresholds, CI configuration, browser matrix, 35A or 35C changes; no files deleted. The source negative controls above are preserved prior evidence, not repeated during this CI rework.
