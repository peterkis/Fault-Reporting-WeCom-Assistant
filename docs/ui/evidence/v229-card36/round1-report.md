> Historical round1 record. Round2 withdraws its title/lane appearance corrections and uses captured current main as the static reference. See README.md for current status.

# Card 36A — rework round 1

**Code changes and local checks complete. Browser acceptance: pending reviewer rerun.** No commit/push, PR, baseline approval, deployment, database migration or 36B/36C motion wiring. Base remains `30eb2fc80353d1ab834c5da4bcc183c6415311c6`, branch `claude/v229-card36a-ddc815`; the supplied prototype is preserved.

The reviewer successfully ran the incoming candidate outside the sandbox: motion timing/geometry/interrupt/tools/debug/reduced-motion checks passed; filmstrip capture failed. Related suite: 38/42 passed, with Card29/Card31/Card32A and an unrelated H5 FFmpeg-environment failure. This supersedes the original environment diagnosis. No browser launch investigation or browser run was performed in this round, per the rework instructions. Old results retain their original identity in [round0-report.md](round0-report.md) and `checks/`; they are not current acceptance results.

## Numbered fixes and root causes

1. **Resting geometry / visual differences.** Two spacing mechanisms compounded: the retained `.card-open h3` rule could win over the TicketCard primitive's equal-specificity title rule, adding 4px above/below each title (24px across three cards); converting a block disclosure to grid/hidden overflow contained the final card's formerly collapsed 8px margin. The primitive now owns title rhythm with a stronger selector, and pending groups compensate that margin at the grid item, without changing child spacing when a remainder mounts. Lane colours similarly belong to the primitive, independent of retained layout CSS order. Reduced-motion disclosure arrows retain the original static rotation. The segmented background previously assumed 2px inset / 28px height / small radius; the actual view switch uses 3px / 30px / pill radius. The slider now measures all three from the selected button. No new motion or per-row entrance was added.
2. **Card31 / Card32A .97 geometry.** This was the settle boundary: `usePopoverPresence` removes `data-entering` after two rAFs. The old wait helper checked an initially empty animation list, waited those two frames, and returned without rechecking the newly created CSS transition. It could therefore report the .97 starting state as settled. The helper now waits for entering to clear and rechecks animations after quiet frames; both tests also explicitly await the panel's entering attribute removal. The exact 260/36/24 assertions remain unchanged. A Node regression reproduces the old early return.
3. **Card29 timeout.** The supplied compiled line 56 is the list's remaining-item button loop, not a native details summary. Nested `overflow:hidden` collapse layers became additional scroll containers. The click helper's `scrollIntoView` could scroll a still-expanding inner layer, leaving a later control clipped; retained table hover/position rules also matched the new structural ancestor rows. Table clipping layers now use `overflow:clip`, leaving scrolling to the original table wrapper; structural rows do not own positioning or hover appearance. The test waits for group expansion before the loop and asserts that inner clipping layers keep zero scroll offsets. The original hit-test/stability checks and all geometry values remain intact. The later drawer-menu geometry check now also waits for its transition.
4. **Filmstrips.** The helper previously triggered first, then made another CDP round-trip to pause an 80ms transition. It now enables CDP Animation and freezes playback **before** triggering, allows two rAFs for CSS transition creation, pauses/seeks real effects at 0/25/50/75/100%, and restores playback rate 1 in `finally`, including trigger failure. Scrolling/hover preparation occurs before capture so it cannot wait on an intentionally frozen transition. Captures use the union of target bounds over all samples plus 16px margin; a full-screen scrim does not overwhelm a smaller panel crop. The reusable `captureFilmstrip(name, trigger, selector)` signature is unchanged. Node checks cover freezing order, seeking/cropping and failure cleanup; actual E1–E5 images await reviewer rerun.
5. **Button border feedback.** Restored `border-color var(--dur-fast) var(--ease-standard)` alongside the original background transition and new transform transition. The pressed-duration rule remains instant; release remains fast.
6. **Empty SegmentedControl.** Empty children render no slider, so the original `:empty` rule works again. An additional CSS guard covers an empty fragment/slider-only DOM. A Node SSR check verifies the empty element; reappearing children reset initial slider geometry.
7. **Beyond-A1 tokens.** All six are retained, individually commented in `tokens.css`, listed below and in the [动效 chapter](../../design-system.md#动效) as **added beyond A1, owner to confirm**.

The table-only clip variant is documented in the design chapter. Other E3 clipping remains hidden overflow; the public WAAPI tools still only animate transform/opacity/backgroundColor. CSS grid, text colour and hover shadow remain the card's explicit CSS exceptions.

## Extra tokens — added beyond A1, owner to confirm

| Token | Value | One-line reason |
| --- | --- | --- |
| `--ease-ambient` | ease-in-out | Preserve the existing 35A / voice ambient loop rhythm. |
| `--ease-linear` | linear | Preserve spinner rotation speed. |
| `--ease-toast` | ease-out | Preserve card33 Toast curves. |
| `--scale-popover` | .97 | Express E4's specified menu scale. |
| `--hover-lift` | -1px | Preserve E6's existing hover lift. |
| `--delay-tooltip` | 400ms | Express E7's specified first-tooltip delay. |

The whitelist remains `login/**` for its independent decorative surface, plus the narrowly scoped Skeleton/refresh `--load-pulse` duration exception preserving 35A's 1.4s period. Ambient/spinner/Toast curves are tokenized rather than exempted. No 35A state timing was changed.

## Every supplied visual screen

These counts describe the **incoming reviewer run**, not a new comparison. Raw [visual report](reviewer-r1/visual-report.json), [input hashes](reviewer-r1/input-index.json), [baseline/main source comparison](reviewer-r1/baseline-to-main.json) and [source diff](reviewer-r1/baseline-to-main.patch) are preserved. The read-only images remain in the reviewer-supplied `scratchpad/r1/visual-report/images/` directory.

The recorded visual baseline is `f76fffef7c693ddcee0139b4f6f03bf59376e358`, before the current main's 35A merge. Some differences are therefore already present in main: ReadOnlyBar/Badge and unavailable-note presentation, page-level filtered EmptyState/clear action and handled-empty placement, and danger CircleX replacing TriangleAlert. These current MVP behaviours were preserved. They are **not accepted as slider differences**, and no baseline was changed. A6.6 still needs reviewer reconciliation against the intended current-main reference.

| Screen | Incoming changed pixels | Inspection / disposition |
| --- | ---: | --- |
| board-default | 48365 | Title rhythm, contained final margin, arrow end state and slider geometry corrected; recapture pending. |
| board-presence | 48365 | Same geometry mechanisms; existing presence outline/motion not redesigned. |
| board-filtered-empty | 10735 | Slider/arrow/lane corrections apply. The page EmptyState, clear action and handled-empty placement are pre-existing 35A changes; retained. |
| list-default | 134 | Diff confined to slider bottom at x1334–1393, y140–144; fixed its 2px height deficit and pill radius. This was more than an accepted 1px rendering exception. |
| list-closed-groups | 134 | Same slider issue at x1334–1393, y119–123; fixed. |
| drawer-processing | 15067 | Board underlay geometry corrected. Small Save-glyph pixels also appeared; no claim that they are slider pixels or resolved without recapture. |
| drawer-dismissed | 47017 | Board underlay corrections; the approximately 40px body offset, readonly badge, disabled-note/footer differences come from main's 35A ReadOnlyBar/note UI; retained. |
| drawer-completed | 37451 | Same main readonly presentation and underlay distinction; retained current MVP state. |
| drawer-banner-editing | 21599 | Board/presence positioning follows corrected card rhythm; no presence-outline redesign. Save-glyph recapture also needed. |
| detail-fullpage-1280 | 69 | Isolated Save-glyph difference, x1155–1177/y952–962 in high-contrast inspection; requires reviewer recapture, not categorized as a slider exception. |
| close-dialog-out-of-scope | 7964 | Changed pixels are in the board underlay to the left of the modal; panel/form geometry itself matches in supplied diff. Underlay corrections apply. |
| close-dialog-duplicate | 7964 | Same underlay-only distinction; modal motion/spec retained. |
| restore-dialog | 31427 | Modal itself matches; board underlay plus 35A readonly drawer/footer differences remain separated as above. |
| toast-tones | 0 | Incoming unchanged; Toast behaviour/timing preserved. |
| toast-drawer-stack | 15067 | Same board-underlay/Save distinction as drawer-processing; Toast preserved. |
| sidebar-online-popover | 48341 | Supplied static popover region itself matches; board underlay corrections apply. The separate .97 geometry race is fixed at the settle boundary. |
| conversation-default | 0 | Incoming unchanged. |
| notifications-default | 84 | Danger glyph TriangleAlert→CircleX, already changed in main by 35A; source proof preserved. Current danger semantics retained. |

No remaining pixel difference is claimed acceptable. Whether the new candidate has any slider subpixel difference is **pending reviewer rerun**. No geometry/business assertion, screenshot threshold, mask or baseline was loosened.

## Local checks and identity

Environment: macOS 26.6.2 / Darwin25.6.0, Node24.18.0. Reviewer browser: Chrome157.0.8103.79 (see incoming receipt). The final build is staged, not activated.

- Source input hash: `c9e602f21a13e9af28fe8bd60ea7fd45d43fb1a228eabcd3bbbde9dd2b7bc204`.
- Manifest SHA-256: `f94e9837aba16fb5983afd63e85277d8703183616e999b7467242a0e8c7d849e`.

| Command | This round |
| --- | --- |
| `npm run migration:typecheck` | PASS; strict/negative types/design variables/CSS/ESLint. Rebuilt afterwards. |
| `npm run migration:build` | PASS; final975 typed /329 unchecked legacy /3056 outputs, syntax975/975, max active2. |
| `npm run lint:css --prefix app/pc-admin` | PASS final CSS. |
| `npm run lint:features --prefix app/pc-admin` | PASS all src. |
| `node --experimental-strip-types tests/pc-admin-copy-terms.test.mts` | PASS6/6. |
| `node --experimental-strip-types --test tests/pc-admin-motion-tools.test.mts` | PASS9/9; includes delayed-transition, filmstrip cleanup/crop and empty-segment regressions. |
| Final compiled frontend command below | PASS95/95: motion policy5, motion tools9, copy6, design foundation75. |
| `node .build/tools/verify-artifact.mjs` | PASS `ARTIFACT_VERIFIED_NOT_ACTIVATED`. |
| `npm run docs:agents:check` / `git diff --check` | PASS documentation budget/links and whitespace. |
| Browser suites / visual capture / comparison / filmstrips | **pending reviewer rerun**; not run in this round. |

```sh
TS_MIGRATION_TEST_SOURCE_ROOT="$PWD" \
TS_MIGRATION_TEST_RUNTIME_ROOT="$PWD/.build/runtime" \
node --test \
  .build/runtime/tests/pc-admin-motion-policy.test.mjs \
  .build/runtime/tests/pc-admin-motion-tools.test.mjs \
  .build/runtime/tests/pc-admin-copy-terms.test.mjs \
  .build/runtime/tests/pc-admin-design-foundation.test.mjs
```

```text
MOTION_SWEEP {"files":261,"cssBareTiming":0,"inlineOrWaapiViolations":0,"whitelist":"login/** only; --load-pulse ambient duration preserved"}
```

Logs: `checks/r1/`. The meaningful pre-fix RED for both helper bugs is preserved. Incoming measurements/results are not rebound to this rework. The prior 531-test /138-tool regression remains historical in the round0 record and was not rerun wholesale for this scoped rework. The unrelated H5 FFmpeg environment failure was not investigated, per instruction.

## A1–A6 and browser acceptance status

A1 tokens/rules/sweep: local PASS. A2 APIs remain implemented and Node-tested; changed browser consumers await rerun. A3 production debug exclusion: local PASS. A4 E1–E7 changes and A5 chapter are present. Every A6 browser row below is the new candidate's status.

| A6 | Current result |
| --- | --- |
| 1 Token/rule checks and zero-bare sweep | PASS |
| 2 Browser duration/easing/property assertions | pending reviewer rerun |
| 3 CDP reduced motion / E1–E5 functionality | pending reviewer rerun |
| 4 E4/E5 interruption, unmount and focus | pending reviewer rerun |
| 5 E3 ten-frame monotonic geometry | pending reviewer rerun |
| 6 Zero unexpected screenshot changes | pending reviewer rerun; inherited baseline/main differences documented above |
| 7 E1–E5 five-frame filmstrips | pending reviewer rerun; 0 new images produced locally |
| 8 Typecheck/lints/build/copy/Node/browser | Local checks PASS; browser pending reviewer rerun |

standard=`cubic-bezier(.2,0,0,1)`; soft=`cubic-bezier(.16,1,.3,1)`; exit=`cubic-bezier(.4,0,1,1)`.

| Motion | Expected tokens / milliseconds / curve | This revised candidate's browser measurement |
| --- | --- | --- |
| E1 press/release | instant80 / fast120 standard | pending reviewer rerun |
| E2 slider/label | base180 standard | pending reviewer rerun |
| E3 grid/arrow | base180 standard | pending reviewer rerun |
| E4 enter/exit | fast120 standard / instant80 exit | pending reviewer rerun |
| E5 panel/mask | slow240 soft / fast120 exit | pending reviewer rerun |
| E6 hover | fast120 standard | pending reviewer rerun |
| E7 tooltip | delay400 (adjacent0), instant80 standard | pending reviewer rerun |

## Open items and handoff

- Reviewer reruns the motion entry, Card29/Card31/Card32A and related suites, then visual capture/compare and E1–E5 filmstrips against this revised candidate. Keep exact business/geometry values and all selectors.
- The old baseline's 35A empty/readonly/danger-icon differences require owner/reviewer reconciliation with current-main behaviour. No approval or baseline change is inferred. The small Save-glyph region needs fresh evidence; it has not been excused as slider rendering.
- Expected filmstrips: `e1-press`, `e2-segment`, `e3-collapse`, `e4-menu`, `e5-modal`; [helper/status](filmstrip/README.md). No application screenshot is fabricated from Node fixtures.
- No business/schema/data rollback needed. Revert only this task's scoped source changes if required; preserve the prototype and historical evidence. Own temporary diagnostic baseline copy was retired after recording its CSS/source comparison; no shared database or another worktree was modified.
