# Source-level reverse validation — owner decision 2026-11-18

Default: any pixelmatch-classified changed pixel, color threshold 0.1, count >0 / ratio >0. No per-screen overrides or masks. Both experiments modify real source and rebuild the served bundle; no in-page experiment injection. [Machine receipt](source-reverse.json).

## radius

Real source: `app/pc-admin/src/design/tokens.css`; `--radius-lg: 12px;` -> `--radius-lg: 14px;`. Rebuilt capture input: `0ae0a7ca7c1185603ad332f0b75c295eef7ccb6925b4a8783e96ec2e73f1b210`. **Compare exit 1; 8 screens flagged.**

| Screen | Diff pixels | Ratio | Changed (count >0) | Raw RGBA pixels |
| --- | ---: | ---: | --- | ---: |
| board-default | 0 | 0.000000% | NO | 475 |
| board-presence | 0 | 0.000000% | NO | 475 |
| board-filtered-empty | 0 | 0.000000% | NO | 570 |
| list-default | 0 | 0.000000% | NO | 0 |
| list-closed-groups | 0 | 0.000000% | NO | 0 |
| drawer-processing | 10 | 0.000694% | YES | 1335 |
| drawer-dismissed | 10 | 0.000694% | YES | 1455 |
| drawer-completed | 10 | 0.000694% | YES | 1418 |
| drawer-banner-editing | 10 | 0.000694% | YES | 1335 |
| detail-fullpage-1280 | 0 | 0.000000% | NO | 209 |
| close-dialog-out-of-scope | 28 | 0.001944% | YES | 2111 |
| close-dialog-duplicate | 26 | 0.001806% | YES | 2124 |
| restore-dialog | 2 | 0.000139% | YES | 1573 |
| toast-tones | 0 | 0.000000% | NO | 5061 |
| toast-drawer-stack | 10 | 0.000694% | YES | 3620 |
| sidebar-online-popover | 0 | 0.000000% | NO | 475 |
| conversation-default | 0 | 0.000000% | NO | 277 |
| notifications-default | 0 | 0.000000% | NO | 0 |

## label

Real source: `app/pc-admin/src/design/components/TicketCard/ClosureDialog.tsx`; `>确认关闭</Button>` -> `>确认关单</Button>`. Rebuilt capture input: `8a8e740f915de1ae16e16f7585ce6a1d39bf58d2f86f3b149d61d0d05bf1489c`. **Compare exit 1; 2 screens flagged.**

| Screen | Diff pixels | Ratio | Changed (count >0) | Raw RGBA pixels |
| --- | ---: | ---: | --- | ---: |
| board-default | 0 | 0.000000% | NO | 0 |
| board-presence | 0 | 0.000000% | NO | 0 |
| board-filtered-empty | 0 | 0.000000% | NO | 0 |
| list-default | 0 | 0.000000% | NO | 0 |
| list-closed-groups | 0 | 0.000000% | NO | 0 |
| drawer-processing | 0 | 0.000000% | NO | 0 |
| drawer-dismissed | 0 | 0.000000% | NO | 0 |
| drawer-completed | 0 | 0.000000% | NO | 0 |
| drawer-banner-editing | 0 | 0.000000% | NO | 0 |
| detail-fullpage-1280 | 0 | 0.000000% | NO | 0 |
| close-dialog-out-of-scope | 95 | 0.006597% | YES | 156 |
| close-dialog-duplicate | 95 | 0.006597% | YES | 156 |
| restore-dialog | 0 | 0.000000% | NO | 0 |
| toast-tones | 0 | 0.000000% | NO | 0 |
| toast-drawer-stack | 0 | 0.000000% | NO | 0 |
| sidebar-online-popover | 0 | 0.000000% | NO | 0 |
| conversation-default | 0 | 0.000000% | NO | 0 |
| notifications-default | 0 | 0.000000% | NO | 0 |

Both source files were restored exactly and rebuilt after each experiment. [Radius restore](source-reverse-radius-restored.json), [label restore](source-reverse-label-restored.json). Approved current PNGs and meta.json remained unchanged; no final current recapture. [Hash verification](approved-integrity-20261118.json).

Temporary baseline and reports: `.build/visual/source-reverse-any-pixel/{baseline,radius/report,label/report}/`. Experimental images use their own `{radius,label}/current/darwin-chrome/` directories. The previous original-ratio results remain in [the superseded report](superseded-original-ratio-source-reverse.md) and [receipt](superseded-original-ratio-source-reverse.json); their FAIL values were not rewritten.
