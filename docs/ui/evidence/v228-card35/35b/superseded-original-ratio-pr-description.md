# Card 35B — local screenshot regression baseline tool (reworked)

Adds platform-specific local capture, HTML/JSON comparison and human-only approval with an 18-screen deterministic manifest. New dependencies are only pixelmatch/pngjs; tools follow strict .mts -> .mjs. Rework removes every mask and threshold override, replaces live-page negative controls with guarded real-source edit/build/capture/compare/restore cycles, and formats all 13 new .mts files. Removed broad masking, sort-label marking and tuned thresholds; no repository files deleted or permanent product changes.

Validation: typecheck, build, eslint, stylelint, artifact and docs checks pass; 16/16 tool/copy tests, 22/22 routing tests, 20/20 docs tests, 6/6 existing browser lifecycle tests and 1/1 Card 34C real browser test pass. Five consecutive full captures produced 90 PNGs; every one of 180 pairwise raw comparisons is zero with **no masks**. [Acceptance and commands](superseded-original-ratio-README.md), [stability table](stability.md), [investigation](stability-investigation.md).

visual:compare: official baseline deliberately absent (18 missing, exit 1). Temporary clean baseline: 18 unchanged, exit 0.

Source-level negative controls (all default thresholds):
- radius: compare exit 0; flagged: none; drawer-processing 10 px (0.000694%); drawer-dismissed 10 px (0.000694%); drawer-completed 10 px (0.000694%); drawer-banner-editing 10 px (0.000694%); close-dialog-out-of-scope 28 px (0.001944%); close-dialog-duplicate 26 px (0.001806%); restore-dialog 2 px (0.000139%); toast-drawer-stack 10 px (0.000694%)
- label: compare exit 0; flagged: none; close-dialog-out-of-scope 95 px (0.006597%); close-dialog-duplicate 95 px (0.006597%)

**B4.5 detection remains FAIL / OPEN QUESTION**: no threshold was lowered to make a test pass. [All 18 per-screen results and restoration proofs](superseded-original-ratio-source-reverse.md). The owner must decide whether the specified sensitivity is adequate for these small changes.

No approve, commit, push, PR, CI capture, browser matrix, H5 or 35A/35C work. Official baseline contains only README; after owner image review and 35A merge, recapture before manual approval. Synthetic realtime presentation does not replace existing business/geometry assertions.
