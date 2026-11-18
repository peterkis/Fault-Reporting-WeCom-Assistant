# Five consecutive captures

darwin-chrome; macOS 26.6.2 / Darwin Kernel Version 25.6.0: Fri Jul 31 19:19:08 PDT 2026; root:xnu-12377.161.14~5/RELEASE_ARM64_T6050 / 25.6.0; Chrome/157.0.8103.79; DPR 1.

Head: `f76fffef7c693ddcee0139b4f6f03bf59376e358`; uncommitted input fingerprint: `116f87a18553929f43b2d2cc6b20f0ec835e5378dd18aff9b7a8472edaae0a36`. Same build and machine; each screen owns a new DB/browser. All 10 pairs per screen are compared with raw RGBA differences, with zero tolerance.

| Run | board-default | board-presence | board-filtered-empty | list-default | list-closed-groups | drawer-processing | drawer-dismissed | drawer-completed | drawer-banner-editing | detail-fullpage-1280 | close-dialog-out-of-scope | close-dialog-duplicate | restore-dialog | toast-tones | toast-drawer-stack | sidebar-online-popover | conversation-default | notifications-default |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| stability-1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| stability-2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3436 | 0 | 0 | 14 | 3722 | 0 | 0 | 0 | 0 | 0 |
| stability-3 | 0 | 0 | 0 | 0 | 0 | 0 | 3443 | 0 | 3436 | 0 | 0 | 14 | 0 | 0 | 0 | 0 | 0 | 0 |
| stability-4 | 0 | 0 | 0 | 0 | 0 | 0 | 3443 | 0 | 3436 | 0 | 0 | 14 | 0 | 0 | 0 | 0 | 0 | 0 |
| stability-5 | 178389 | 0 | 55947 | 0 | 0 | 3436 | 0 | 3443 | 3436 | 0 | 3568 | 14 | 0 | 0 | 0 | 0 | 0 | 0 |

| Screen | Maximum raw changed pixels over 10 pairs |
| --- | ---: |
| board-default | 178389 |
| board-presence | 0 |
| board-filtered-empty | 55947 |
| list-default | 0 |
| list-closed-groups | 0 |
| drawer-processing | 3436 |
| drawer-dismissed | 3443 |
| drawer-completed | 3443 |
| drawer-banner-editing | 3436 |
| detail-fullpage-1280 | 0 |
| close-dialog-out-of-scope | 3568 |
| close-dialog-duplicate | 14 |
| restore-dialog | 3722 |
| toast-tones | 0 |
| toast-drawer-stack | 0 |
| sidebar-online-popover | 0 |
| conversation-default | 0 |
| notifications-default | 0 |

Result: FAIL; 180 pairwise comparisons.
