# E1–E5 filmstrips

Environment: macOS26.6.2 / Darwin25.6.0; reviewer system Chrome157.0.8103.79.

Status: **pending reviewer rerun after round2**. No new application filmstrip image was generated locally. The incoming R1 run passed5/6 motion subtests but failed E1 capture; raw results remain in `../reviewer-r2/`.

The browser entry now waits for both media and root CSS preference reset, navigates to a verified fresh fixture document, releases the pointer, prepares scroll/hover outside the frozen window and verifies normal transitions and the hit target. E1's frozen trigger only sends mousePressed.

`createFilmstripCapture(browser, directory)` returns the unchanged `captureFilmstrip(name, trigger, selector)` API. It freezes CDP playback before triggering, waits two rAFs for CSS transitions, pauses/seeks real effects at0/25/50/75/100%, crops a fixed union of component bounds with16px margin, stitches and restores playback in finally. Full-screen masks do not enlarge a smaller component crop.

On zero effects, both the assertion and `<name>-failure.json` contain document/target animation counts, selector node count, computed transform and transition property/duration, active/data-pressed state, root data-motion attributes and reduced-motion media value. Node tests verify the diagnostic fields, crop/seek contract and cleanup; they are not application evidence.

Expected after reviewer rerun: `e1-press.png`, `e2-segment.png`, `e3-collapse.png`, `e4-menu.png`, `e5-modal.png`, each with JSON metadata. Set `CARD36A_EVIDENCE_DIR` to the parent directory for the compiled browser entry.

## Card 36C — detail and presence

The reviewer captured all seven strips on macOS 26.6.2 (Darwin 25.6.0) with headless Chrome 158.0.8127.37. The durations and easing curves below come from the [browser receipt](card36c-motion-receipt.json). The available `detail-next` strip predates the r5 exit-clone change, and its recapture is pending.

| Strip | Target | Files |
| --- | --- | --- |
| `drawer-enter` | Drawer and backdrop opening | [PNG](drawer-enter.png) · [JSON](drawer-enter.json) |
| `drawer-exit` | Drawer and backdrop closing | [PNG](drawer-exit.png) · [JSON](drawer-exit.json) |
| `drawer-return-cue` | Last-viewed board card's background cue | [PNG](drawer-return-cue.png) · [JSON](drawer-return-cue.json) |
| `detail-next` | Outgoing and incoming detail bodies | [PNG](detail-next.png) · [JSON](detail-next.json) |
| `timeline-arrival` | A colleague's new handling record sliding in | [PNG](timeline-arrival.png) · [JSON](timeline-arrival.json) |
| `presence-enter` | Name tag and outline appearing | [PNG](presence-enter.png) · [JSON](presence-enter.json) |
| `presence-exit` | Name tag and outline leaving after the retention interval | [PNG](presence-exit.png) · [JSON](presence-exit.json) |

| Motion | Expected duration and easing tokens | Measured |
| --- | --- | --- |
| Drawer and backdrop enter | `--dur-slow` 240 ms, `--ease-soft` | 240 ms, `cubic-bezier(0.16, 1, 0.3, 1)` |
| Drawer and backdrop exit | `--dur-base` 180 ms, `--ease-exit` | 180 ms, `cubic-bezier(0.4, 0, 1, 1)` |
| Detail body exit | `--dur-fast` 120 ms, `--ease-exit` | 120 ms, `cubic-bezier(0.4, 0, 1, 1)` |
| Detail body enter | `--dur-base` 180 ms, `--ease-standard` | 180 ms, `cubic-bezier(0.2, 0, 0, 1)` |
| Full-page detail fade | `--dur-fast` 120 ms, `--ease-standard` | 120 ms, `cubic-bezier(0.2, 0, 0, 1)` |
| Return cue | `--dur-return` 600 ms, `--ease-standard` | 600 ms, `cubic-bezier(0.2, 0, 0, 1)` |
| Timeline entry | `--dur-base` 180 ms, `--ease-standard` | 180 ms, `cubic-bezier(0.2, 0, 0, 1)` |
| Timeline intake highlight | `--dur-highlight` 1,200 ms, `--ease-standard` | 1,200 ms, `cubic-bezier(0.2, 0, 0, 1)` |
| Timeline arrival while reading below the top | The visible record stays within 1 px of its original viewport top and the timeline top stays offscreen. Browser scroll anchoring can adjust `scrollTop` to hold the reading position. The chip reads 「↑ 1 条新记录」. | Reviewer verified the reading-position assertion. |
| Presence tag enter and re-enter, outline appear | `--dur-fast` 120 ms, `--ease-standard` | 120 ms, `cubic-bezier(0.2, 0, 0, 1)` |
| Presence tag exit | `--dur-fast` 120 ms, `--ease-exit` | 120 ms, `cubic-bezier(0.4, 0, 1, 1)` |
| View ↔ edit colour and outline, pencil fade, +N NumberRoll | `--dur-base` 180 ms, `--ease-standard` | 180 ms, `cubic-bezier(0.2, 0, 0, 1)` |

With the local fixture PostgreSQL connection set in `PILOT_DATABASE_URL`, a fresh migration build and a browser-capable session, run from the worktree root.

```sh
export TS_MIGRATION_TEST_SOURCE_ROOT="$PWD"
export CARD36C_EVIDENCE_DIR="$PWD/docs/ui/evidence/v229-card36/filmstrip"
cd .build/runtime
node --test tests/pc-admin-card36c-motion.browser.test.mjs
```

The browser entry uses the shared capture helper at 0/25/50/75/100%. Its `card36c-motion-receipt.json` records the OS, browser, acceptance results and timings. Drawer and timeline scenarios use the development workbench against the real isolated Web01 server. The presence fixture replays snapshots from the Card 30B peer sessions so the 200 ms and 500 ms windows can be driven at the display layer. Presence exit capture defers the fixture's exit-retention timer while sampling the real CSS transition.
