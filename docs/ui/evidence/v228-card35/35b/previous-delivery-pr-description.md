# Card 35B — local screenshot regression baseline tool

Adds platform-specific local capture, triptych comparison and human-only approval, backed by an 18-screen deterministic manifest. Only pixelmatch and pngjs are added as development dependencies; tools follow the strict .mts -> .mjs migration build. No product UI code or existing assertions changed; no files deleted.

Validation: typecheck, eslint, stylelint, migration build and artifact verification passed; 14/14 unit/copy tests, 1/1 real Card 34C browser test and 22/22 routing tests passed. Five consecutive captures produced 90 screenshots; all 180 raw pairwise comparisons were zero pixels. [Full acceptance and commands](README.md), [stability table](stability.md).

visual:compare: formal baseline absent by instruction (18 missing; exit 1 with a readable report). Temporary clean baseline: 18 unchanged, exit 0.

Negative controls:
- Radius +2px: compare exit 1; board-default: 83 px (0.005764%); close-dialog-out-of-scope: 35 px (0.002431%).
- Button label one character: compare exit 1; close-dialog-out-of-scope: 95 px (0.006597%).

The experiments use disposable browser style/DOM edits and temporary baselines outside docs/ui/visual-baseline. Eight overlay screenshots mask only the inert workbench background with a validated reason; drawer/dialog foreground, all presence tags and seven independent views remain unmasked; the sort label on three board views has a separate disclosed mask and remains a coverage gap for owner review. Realtime presentation is synthetic; business queries remain real HTTP/PG.

Official baselines remain empty apart from README; approve was not run. Product owner review and fresh capture after 35A merge precede manual approval. No CI capture, cross-browser matrix, H5, 35A/35C, commit, push or PR creation.
