# E1–E5 filmstrips

Environment: macOS26.6.2 / Darwin25.6.0; reviewer system Chrome157.0.8103.79.

Status: **pending reviewer rerun after round2**. No new application filmstrip image was generated locally. The incoming R1 run passed5/6 motion subtests but failed E1 capture; raw results remain in `../reviewer-r2/`.

The browser entry now waits for both media and root CSS preference reset, navigates to a verified fresh fixture document, releases the pointer, prepares scroll/hover outside the frozen window and verifies normal transitions and the hit target. E1's frozen trigger only sends mousePressed.

`createFilmstripCapture(browser, directory)` returns the unchanged `captureFilmstrip(name, trigger, selector)` API. It freezes CDP playback before triggering, waits two rAFs for CSS transitions, pauses/seeks real effects at0/25/50/75/100%, crops a fixed union of component bounds with16px margin, stitches and restores playback in finally. Full-screen masks do not enlarge a smaller component crop.

On zero effects, both the assertion and `<name>-failure.json` contain document/target animation counts, selector node count, computed transform and transition property/duration, active/data-pressed state, root data-motion attributes and reduced-motion media value. Node tests verify the diagnostic fields, crop/seek contract and cleanup; they are not application evidence.

Expected after reviewer rerun: `e1-press.png`, `e2-segment.png`, `e3-collapse.png`, `e4-menu.png`, `e5-modal.png`, each with JSON metadata. Set `CARD36A_EVIDENCE_DIR` to the parent directory for the compiled browser entry.

## 36B data motion

The reviewer’s round 1 run on macOS 26.6.2 / Darwin 25.6.0 with Chrome 157.0.8103.79 captured `board-move`, `board-arrival`, `list-row-highlight` and `count-roll`. `board-chip` failed with zero observable chip animations. The diagnostics are in [board-chip-failure.json](board-chip-failure.json).

Post-rework capture is **NOT RUN**. The local Chrome probe timed out before DevTools became available.

The compiled `pc-admin-card36b-motion.browser.test.mjs` entry captures `board-move`, `board-arrival`, `board-chip`, `list-row-highlight` and `count-roll` as PNG + JSON, with a separate environment JSON recording the running OS and Chrome version. `CARD36B_EVIDENCE_DIR` can redirect both filmstrips and measurement receipts. Run outside the restricted sandbox with the synthetic loopback PostgreSQL fixture.
