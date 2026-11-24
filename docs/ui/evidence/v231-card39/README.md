# Card 39A evidence

This folder holds the verification guide, main baseline geometry capture instructions, and screenshot artifacts for Card 39A (ring room inside clipped board groups and remainder containers).

- **Target OS**: Windows 10 / Windows 11 desktop & browser workbench.
- **Local evidence capture host**: macOS Chrome (Chrome cannot launch in the development sandbox; screenshots and browser assertions are executed by the reviewer on the Chrome-capable host).

## Pixel sampling method (`tests/pc-admin-card39a-ring-room.browser.test.mts`)

`--shadow-keyboard-current` is defined as `0 0 0 2px var(--brand), 0 0 0 5px var(--brand-subtle)`.
The outer `--brand-subtle` band spans `2px` to `5px` outside the card border-box (`3px` thick).

- **Sampling offset interpretation**: We sample **4px outward from the card border edge** at the 4 edge midpoints (using `3.5px` CSS offset scaled to device pixels — at DPR 1, `Math.floor((edge +- 3.5) * 1)` hits the 4th outward pixel, the exact center of the `2px..5px` `--brand-subtle` band). Sampling 4px beyond the outer edge of the 5px ring (`5px + 4px = 9px`) would sample the column/page background and could never equal `--brand-subtle`.

For each target card (first and last card of 待受理「待判断」、待受理「待接单」、已处理「已完成」，and the expanded 「显示剩余 N 项」 areas):

1. Drive real keyboard navigation (`j` / `k` from an adjacent card link) so the target card receives `data-keyboard-current="true"` and `:focus-visible`.
2. Add `.is-selected` to the card without mounting the detail drawer (opening the drawer covers the viewport with `.workbench-drawer-backdrop` `rgba(55,53,47,.16)` and obscures the 已处理 column behind the 720px drawer panel, which would tint or block pixel sampling). Separately, the test performs a real CDP click on a card and asserts that the clicked item opens with `.is-selected` and `data-keyboard-current="true"` both present on that card.
3. Move the pointer onto `${card} .card-top` (`Input.dispatchMouseEvent` `mouseMoved`) so `:hover` (`translateY(-1px)`) is active without triggering owner hover cards or claim tooltips, then call `waitForAnimationsSettled(b)`.
4. Resolve `--brand-subtle` RGB in the DOM via a temporary probe element, capture the viewport PNG via CDP `Page.captureScreenshot`, and decode raw RGBA pixels via `sharp`.
5. Sample the 4 edge midpoints at 4px outward (`3.5px` CSS offset scaled by `sx = imageWidth / innerWidth`, `sy = imageHeight / innerHeight`) and assert every channel (`R`, `G`, `B`) is within `±2` of resolved `--brand-subtle`.

## Main (`8f86d51e`) baseline geometry & container audit

- **Board card width, x, and inter-group heading y**: On clean `8f86d51e` (note `base.css:6` uses `--page-pad-x: 32px` above `1280px`), `39A A3 geometry` measures the actual card `x` and `width` for first/last cards of each target group and remainder plus the 「待接单」 heading `y` in both expanded and collapsed states of 「待判断」. When `CARD39A_GEOMETRY_OUT` is set, it writes `main-geometry.json`; on this branch, `39A A3 geometry` compares live measurements against `docs/ui/evidence/v231-card39/main-geometry.json` and requires exact equality (`0` deviation).
- **Bottom ring room without collapse leak**: Every `.ticket-card` carries `margin-bottom: 8px` (`--space-2`), which is enclosed by `.disclosure__body` and `.ds-collapse-inner` (`overflow: hidden` BFC) and provides `8px >= 6px` bottom room when expanded while collapsing cleanly to `0px` (`0fr`) with zero leaked pixels. Adjacent-group collapse (`-8px` before 「待接单」) is applied on `.disclosure__content[data-expanded=true]` with a matching `--dur-base var(--ease-standard)` transition on `margin-bottom`, so the last card in 「待判断」 keeps its 8px bottom room when expanded while collapsed 「待判断」 leaves the full `12px` inter-group gap matching `main`.
- **List-view groups (`WorkTable`)**: Audited — native `<table>` rows toggled via `[hidden]` with no `overflow: hidden/clip` wrapper; keyboard-current rows use `inset` cell `box-shadow`, so list groups are unaffected.
- **Drawer collapsible sections (`.workbench-disclosure`)**: Audited — no demonstrated clipping case on main, left unchanged.

## Screenshots

| Screenshot | Capture OS | Browser version |
| --- | --- | --- |
| `board-selected-intake-group.png` | darwin 25.6.0 | Chrome/158.0.8127.37 |
| `board-keyboard-current-done-group.png` | darwin 25.6.0 | Chrome/158.0.8127.37 |
| `board-remainder-selected.png` | darwin 25.6.0 | Chrome/158.0.8127.37 |

## visual:compare

Host run on macOS 26.6.2 / Chrome 158.0.8127.37 (2026-11-24). Baseline: a clean `8f86d51e` worktree (`npm run migration:build && npm run visual:capture`, 19 screens). Candidate: this branch after agy round 3 (`npm run visual:capture`, 19 screens). Command: `npm run visual:compare -- --baseline-dir .build/visual/main-ref --report-dir .build/visual/report39a`.

Result: `changed: []`, `missing_baselines: []`, `unrecorded: []`, `stale: []`, `metadata_errors: []` — **0 / 19 screens changed**.

Explanation: none of the 19 manifest screens puts a grouped or remainder card into the selected, keyboard-current, hovered or focus-visible state, and the wider clip box keeps resting cards (including their `--shadow-1`) at the same pixels because card width and x are unchanged. The ring fix is therefore only visible in the three 39A screenshots above, which `visual:compare` does not cover. `visual:approve` was not run.

## Reviewer commands

1. Generate `main-geometry.json` on clean `8f86d51e` (using the `39A A3 geometry` test from this branch):

```sh
export TS_MIGRATION_TEST_SOURCE_ROOT="$PWD"
export PILOT_DATABASE_URL=postgresql://petervans@127.0.0.1:5432/postgres
export CARD39A_GEOMETRY_OUT="$PWD/docs/ui/evidence/v231-card39/main-geometry.json"
node --test --test-concurrency=1 --test-name-pattern='39A A3 geometry' .build/runtime/tests/pc-admin-card39a-ring-room.browser.test.mjs
```

2. Run the full Card 39A browser suite and regenerate screenshots on the Card 39A worktree after `npm run migration:typecheck && npm run migration:build && npm run migration:verify-artifact`:

```sh
unset CARD39A_GEOMETRY_OUT
export TS_MIGRATION_TEST_SOURCE_ROOT="$PWD"
export PILOT_DATABASE_URL=postgresql://petervans@127.0.0.1:5432/postgres
export CARD39A_EVIDENCE_DIR=docs/ui/evidence/v231-card39
node --test --test-concurrency=1 .build/runtime/tests/pc-admin-card39a-ring-room.browser.test.mjs
```
