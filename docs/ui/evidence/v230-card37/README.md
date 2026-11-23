# Card 37 evidence

This folder holds the evidence for Card 37A (optimistic updates and Undo) and Card 37C (hover cards). The 37C hover-card capture inventory is in [card37c-hover.md](card37c-hover.md).

## Card 37A acceptance and visual evidence

**Verified in Chrome after round 4c.** The 37A browser suite passed 42/42 and the store tests 7/7. In the round-2 rollback filmstrip, frame 2 showed the red outline while the card was still at the top of 处理中. From round 3 the outline starts after the return animation, and A5.3 and the A5.11 filmstrip check its position. The stills and filmstrips below come from the round-3 Chrome run. Round 4 changed only when the board reread runs and which card plays the outline, so no still or filmstrip state changed.

## Round history

| Round | Tool and model | Work and result |
|---|---|---|
| r0 development | Antigravity Orchestrator Neon | Implemented A1–A4. |
| r0 tests and review | Codex | Added A5 and reviewed the uncommitted candidate. PostgreSQL A5.8 passed 5/8. Three failures covered the two worker orderings for a late ordinary return and the closure deadline. Chrome could not start in the sandbox. The visual comparison had no valid current capture. [Historical TAP receipt](notification-window.tap) |
| r1 production fixes | Codex gpt-6.2-astra | Codex made the production fixes because Antigravity was out of quota. Strict checks, builds and artifact verification passed. The combined notification, configuration, copy and toast-policy run passed 48/48, including A5.8. Selected related server regressions passed 87/87. |
| r1 tests and review | Codex | Outside the sandbox, the reviewer reported **37A browser 33/33**, **card32d-toast 2/2**, and **A5.8 PostgreSQL 11/11**. Related suites passed or failed identically on clean main. |
| r2 tests and review | Codex | Strict typecheck, build and artifact verification passed. Motion-helper tests passed 10/10. A synthetic probe distinguished DOM placement from a FLIP-translated frame. Fresh stills, filmstrips and the new browser assertion await the reviewer's run. |
| r3 production fixes and tests | Codex gpt-6.2-astra, by user decision | R1 sequences the outline after the return to the original position. R2 settles a one-click claim conflict with the winner toast and releases the board controls. A paired A5.3 browser test checks the live board and the existing move-form conflict. Claude ran Chrome: 37A browser 36/36. |
| r4 production fixes and tests | Codex gpt-6.2-astra, by user decision | Fixed three review findings. A hidden or unrendered row releases the rollback-cue wait at once. A one-click claim from the conversation drawer waits for the outline before the board reread. A rejected second claim after Undo keeps Undo's restored position. Claude ran Chrome: 37A browser 37/37. |
| r4b, r4c production fixes and tests | Codex gpt-6.2-astra | Fixed three findings from Codex's review of r4. A stale board cache no longer clears the restored position pin. A collapsed board subgroup no longer delays the reread. Each visible card copy registers its own completion. r4c removed an r4b change that suppressed the outline on the reminder-location card: the board filters out the located item (`Workbench.tsx:428`), so that card is the only copy. Claude ran Chrome: 37A browser 42/42, store 7/7. |

The reviewer identified matching clean-main failures in card32b, card34a media, toast-feedback, human-workbench-process, t34 and t07. The r1 browser count predates the new flash-position assertion. The historical uncommitted candidate was reviewed against Git HEAD `1798592a8b48416bc01a9c9ddfa022f80d6ae0aa`.

### Fixed in r1

- Claim notification suppression now uses the interval between the persisted claim and return events on both bot and app routes. Closure delivery uses the closure event time.
- Undo checks the originating receipt version. Winner names require a successful current read. Changing the visible query cannot insert old cards into its results.
- Terminal recovery releases the overlay. Pending claims and closes retain their controllers across other card actions. Close preflight failures preserve the draft, and 查看 opens the item.
- 接单选项 supports claim Undo. Each follow action has its own toast. Undo checks the ten-second deadline at invocation and survives same-view detail navigation. Card 32D/33 now exercises ordinary loading and success with the shared follow-up schedule command.

## Round 2 capture targets

The reviewer found a card in mid-flight in the claim still, rolling digits in the conflict still, and a sliding clone plus a stale 待受理 header in the closure still. Static capture now waits for finite animations in the board, drawer and document, checks that flight clones are gone, and checks that the outgoing count digits are invisible. The four terminal stills require the optimistic-state markers to clear. The pending-badge still requires an outstanding claim. Toasts are hover-paused during the capture waits.

| Artifact | State shown | Producer |
|---|---|---|
| `undo-claim-toast.png` | Card has settled in 处理中 after confirmation, with 已领取 and the Undo button visible. | A5.5 claim |
| `undo-dismiss-toast.png` | The drawer reread shows 已关闭 in both the read-only bar and the header. The closure toast is visible. | A5.5 close |
| `undo-done-toast.png` | The return is acknowledged, the card occupies its original 待受理 index, and 已撤销 is visible. | A5.5 claim |
| `claim-conflict-rollback.png` | Settled rollback at the original index with the peer's name and 查看. The fixture holds the board refetch until capture so the peer's subsequent authoritative move is a separate observation. | A5.3 |
| `card-pending-badge.png` | The claimed card is stationary in 处理中 with 确认中 visible. The fixture holds the write until after capture. A5.1 still measures the two-second and 80 ms responses independently. | A5.11 optimistic claim |
| `optimistic-claim.png`, `optimistic-claim.json` | Five samples of the actual claim movement and their capture metadata. | A5.11 |
| `rollback.png`, `rollback.json` | Five samples of the return move and their capture metadata. The last frame finishes the paused return so the outline can start at the original position. | A5.11 |

The flash probe records the animation target's DOM column, original-column index and visual column at onset. It samples the rendered card during the outline because FLIP can place a 待受理 DOM node visibly over 处理中. The failure message includes the start, first visible frame and any observed frame in 处理中. The test writes the conflict still and rollback filmstrip before checking the flash location, so a positional failure leaves the images available for inspection.

## Round 3 local verification

Strict TypeScript, PC-admin typecheck, Stylelint, ESLint, the unified build and artifact verification passed. The build syntax-checked 987 compiled entries. The copy, motion and toast-policy run passed 25/25, including cancellation, a replacement FLIP, reduced motion and the final filmstrip frame. The documentation checks passed, including 20/20 checker tests.

```sh
npm run migration:typecheck
npm --prefix app/pc-admin run typecheck
npm --prefix app/pc-admin run lint:css
npm --prefix app/pc-admin run lint:features
npm run migration:build
npm run migration:verify-artifact
TS_MIGRATION_TEST_SOURCE_ROOT="$PWD" node --test .build/runtime/tests/pc-admin-copy-terms.test.mjs .build/runtime/tests/pc-admin-motion-tools.test.mjs .build/runtime/tests/pc-admin-toast-policy.test.mjs
npm run docs:agents:check
node --test .build/tools/check-agent-docs.test.mjs
```

## Reviewer commands

Run from the worktree on the Chrome-capable host. The round-2 sandbox has macOS 26.6.2, Chrome 158.0.8127.37, Node 24.18.0 and PostgreSQL 18.6. Chrome cannot launch a test session here. The reviewer did not supply a separate browser version for round 1.

```sh
export TS_MIGRATION_TEST_SOURCE_ROOT="$PWD"
export PILOT_DATABASE_URL=postgresql://petervans@127.0.0.1:5432/postgres
export CARD37A_EVIDENCE_DIR="$PWD/docs/ui/evidence/v230-card37"

npm run migration:typecheck
npm run migration:build
npm run migration:verify-artifact
node --test --test-concurrency=1 \
  .build/runtime/tests/pc-admin-card37a-optimistic.browser.test.mjs \
  .build/runtime/tests/pc-admin-card37a-motion.browser.test.mjs \
  .build/runtime/tests/pc-admin-card37a-recovery.browser.test.mjs
```

The full browser suite produces all five stills and both PNG/JSON filmstrip pairs. To repeat just the capture cases after the build, run the following from the same shell.

```sh
node --test --test-concurrency=1 --test-name-pattern='^37A A5[.](3|5|11) ' \
  .build/runtime/tests/pc-admin-card37a-optimistic.browser.test.mjs \
  .build/runtime/tests/pc-admin-card37a-motion.browser.test.mjs
```

For the existing move-form conflict and lost-acknowledgement replay checks, run `node --test --test-concurrency=1 .build/runtime/tests/wbint-t42-board-boundaries.browser.test.mjs`.

The related r1 entry points are `node --test .build/runtime/tests/pc-admin-card32d-toast.browser.test.mjs` and `node --test .build/runtime/tests/card37a-notification-undo-window.integration.test.mjs`.

## Card 37C hover evidence

The 37C browser suite writes its capture inventory and measured popover motion to [card37c-hover.md](card37c-hover.md). The review record is [review.md](review.md).

## Card 37B keyboard evidence


The B5 browser suite records the host OS release and Chrome product version beside each screenshot when it captures the named state.

| Screenshot | Capture OS | Browser version |
| --- | --- | --- |
| `shortcuts-dialog.png` | darwin 25.6.0 | Chrome/158.0.8127.37 |
| `menu-kbd.png` | darwin 25.6.0 | Chrome/158.0.8127.37 |
| `tooltip-kbd.png` | darwin 25.6.0 | Chrome/158.0.8127.37 |
| `board-keyboard-current.png` | darwin 25.6.0 | Chrome/158.0.8127.37 |
| `goto-chip.png` | darwin 25.6.0 | Chrome/158.0.8127.37 |
| `palette-kbd.png` | darwin 25.6.0 | Chrome/158.0.8127.37 |
| `shortcut-unavailable-hint.png` | darwin 25.6.0 | Chrome/158.0.8127.37 |

All seven captures wait for the whole viewport to settle. The dialog and capsule captures also check opacity through their ancestors. `menu-kbd.png` shows the real menu on a single-result active board, with every item hit-tested. The separate R3 last-pending-card test exercises the unfiltered board where the disclosure clips the menu.

Run from the worktree after `npm run migration:build`. Ordinary runs (CI included) write the screenshots to a temporary directory; set `CARD37B_EVIDENCE_DIR=docs/ui/evidence/v230-card37` to regenerate the committed files and the rows above.

```sh
export TS_MIGRATION_TEST_SOURCE_ROOT="$PWD"
export CARD37B_EVIDENCE_DIR=docs/ui/evidence/v230-card37
export PILOT_DATABASE_URL=postgresql://petervans@127.0.0.1:5432/postgres
node --test --test-concurrency=1 \
  .build/runtime/tests/pc-admin-card37b-keys.browser.test.mjs \
  .build/runtime/tests/pc-admin-card37b-surfaces.browser.test.mjs \
  .build/runtime/tests/pc-admin-card37b-pauses.browser.test.mjs \
  .build/runtime/tests/pc-admin-card37b-recovery.browser.test.mjs
```
