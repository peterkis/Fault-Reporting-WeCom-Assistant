# Source-level reverse validation, default thresholds

Both experiments modify real product source and rebuild the served bundle. Every screen uses pixelmatch 0.1 and changed ratio >0.1%. No mask or threshold override. Temporary baseline: `.build/visual/source-reverse/baseline/darwin-chrome/`. [Complete receipt](source-reverse.json).

### radius

Source: `app/pc-admin/src/design/tokens.css` — `--radius-lg: 12px;` -> `--radius-lg: 14px;`. Capture input: `9ed7482283f589c1cfca28bc1b9a35119d88e6a166cd5dac7f40d51189de4243`. Compare exit 0; **flagged screens: none**.

| Screen | Pixelmatch diff | Ratio | Over 0.1% | Raw RGBA diff |
| --- | ---: | ---: | --- | ---: |
| board-default | 0 | 0.000000% | NO | 475 |
| board-presence | 0 | 0.000000% | NO | 475 |
| board-filtered-empty | 0 | 0.000000% | NO | 570 |
| list-default | 0 | 0.000000% | NO | 0 |
| list-closed-groups | 0 | 0.000000% | NO | 0 |
| drawer-processing | 10 | 0.000694% | NO | 1335 |
| drawer-dismissed | 10 | 0.000694% | NO | 1455 |
| drawer-completed | 10 | 0.000694% | NO | 1418 |
| drawer-banner-editing | 10 | 0.000694% | NO | 1335 |
| detail-fullpage-1280 | 0 | 0.000000% | NO | 209 |
| close-dialog-out-of-scope | 28 | 0.001944% | NO | 2111 |
| close-dialog-duplicate | 26 | 0.001806% | NO | 2124 |
| restore-dialog | 2 | 0.000139% | NO | 1573 |
| toast-tones | 0 | 0.000000% | NO | 5061 |
| toast-drawer-stack | 10 | 0.000694% | NO | 3619 |
| sidebar-online-popover | 0 | 0.000000% | NO | 475 |
| conversation-default | 0 | 0.000000% | NO | 277 |
| notifications-default | 0 | 0.000000% | NO | 0 |

### label

Source: `app/pc-admin/src/design/components/TicketCard/ClosureDialog.tsx` — `>确认关闭</Button>` -> `>确认关单</Button>`. Capture input: `6450d86e52ce980c1b828fea03c021c5dc83d659543f6adec3a811e011406ec5`. Compare exit 0; **flagged screens: none**.

| Screen | Pixelmatch diff | Ratio | Over 0.1% | Raw RGBA diff |
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
| close-dialog-out-of-scope | 95 | 0.006597% | NO | 156 |
| close-dialog-duplicate | 95 | 0.006597% | NO | 156 |
| restore-dialog | 0 | 0.000000% | NO | 0 |
| toast-tones | 0 | 0.000000% | NO | 0 |
| toast-drawer-stack | 0 | 0.000000% | NO | 0 |
| sidebar-online-popover | 0 | 0.000000% | NO | 0 |
| conversation-default | 0 | 0.000000% | NO | 0 |
| notifications-default | 0 | 0.000000% | NO | 0 |

Both source files were restored byte-for-byte, git diff was empty, and migration:build was rerun after each experiment. [Radius restoration](source-reverse-radius-restored.json), [label restoration](source-reverse-label-restored.json). Source diffs: [radius](source-reverse-radius.patch), [label](source-reverse-label.patch). Reports: `.build/visual/source-reverse/{radius,label}/report/index.html`.

The source workflow completed; the card's expected detection was NOT achieved. Raw differences confirm pixels changed, while pixelmatch color/anti-alias filtering and the whole-viewport 0.1% ratio leave these changes under threshold. This is an Open question for the product owner; thresholds were not lowered. The earlier in-page experiments are retained only as historical, insufficient evidence and are not claimed as B4.5 validation.
