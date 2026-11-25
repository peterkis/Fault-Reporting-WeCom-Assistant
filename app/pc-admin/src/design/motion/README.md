# Motion tools (36A / 36B)

CSS tokens are the only numeric source. `motionToken('--dur-base')` returns milliseconds;
`motionToken('--ease-standard')` returns a CSS easing. The cache is invalidated on system
preference/visibility changes and development overrides. `useReducedMotion()` subscribes to
the same source. Importing tokens has no DOM side effect until first use / initialization.

- `flip(el, from, to, {duration, easing, lift, fadeOut, end, scroll})` accepts viewport `{left, top}`
  rectangles and token names (plus optional pre-read `scroll` coordinates so batched callers avoid
  reading `window.scrollX`/`scrollY` after DOM writes). It returns an `Animation`. Repeating on the
  same element samples its current visual rectangle before cancelling. At most six elements run
  concurrently (checked before measuring layout so overflow elements snap without forced reflow;
  `lift: true` cross-column moves evict a `lift: false` sibling flip if slots filled across split
  query ticks). `getFlipLayout`, `hasFreeFlipSlot`, and `canStartLiftFlip` expose running slot
  state without extra DOM reads. `lift` sets shadow/z-index temporarily; `fadeOut` fades opacity
  from 1 to 0 over the last 30% of the flight (for flights into collapsed groups or to an optional
  `end` visible column edge); only transform and (when `fadeOut`) opacity are animated. While
  running, `data-motion-flipping` is set on `el` and ref-counted `data-motion-flip-host` is set on
  enclosing `.ds-collapse`/`.disclosure__content` ancestors so expanded containers unclip
  temporarily without `:has()` subtree invalidation.
- `highlight(el, {tone: 'intake'|'active'|'done'|'brand', background?})` activates a `::after`
  overlay (`inset:0; border-radius:inherit; pointer-events:none`, above host background and below
  content) carrying the phase tint (`--stage-*-bg` / `--brand-subtle`) and `1px` inset ring
  (`--highlight-ring-*` via `--shadow-highlight-*`) via `data-highlight-tone`. When the host is in
  a persistent/transient state (`.is-selected`, `[data-closure-kind="DISMISSED"]`, `:active`,
  `[data-presence]`, `[data-keyboard-current="true"]`, `[data-optimistic-rollback="true"]`), the
  overlay keeps `background: transparent` and clears inset state rings so host fill and outer/inner
  rings stay visible; on narrow list rows (`max-width: 1080px`), the sticky first column `th::after`
  runs the same synchronized `opacity` hold/fade so brand highlight remains visible above scrolled
  columns. Animates ONLY `::after`'s `opacity`: holds at `1` for `--dur-highlight-hold` (240ms),
  then fades to `0` over `--dur-highlight` (1200ms) with `--ease-ambient` (total 1.44s), without
  mutating `el`'s own `background-color` or inline styles. Repeating restarts timing; reduced
  motion holds the overlay statically for `--dur-highlight-hold + --dur-highlight` and removes
  `data-highlight-tone` with no fade. Returns `{cancel(), finished}`; `cancel` removes the overlay
  immediately, and `finished` resolves on either completion or cancellation. (`board-motion.ts` tracks
  all active highlight handles and cancels them on scope reset or unmount.)
- Arrival slide (`enterSlide`, `animateTimelineEntry`) still runs `--shift-md` + `opacity` over
  `--dur-base` / `--ease-standard`, while starting `highlight()` concurrently from frame 0.
- `useExitPresence(present, durationToken)` returns whether to render. Reopening cancels
  pending removal; reduced motion and hidden documents retain for zero time.
- `<NumberRoll value={number} animate={boolean}/>` rolls the entire number up/down, reserves
  the wider old/new value during animated rolls, renders visual digits via `::before` pseudo-
  elements (`data-value`) so parent `textContent` always equals the final number, and exposes
  only the final accessible text via `.sr-only`. First paint is static; rapid changes cancel
  previous effects. Set `animate={false}` on filter/search/view/scope changes.
- `self-write.ts` (`markSelfWrite`, `consumeSelfWrite`, `clearSelfWrites`): presentation-only
  per-principal registry of item identities (`kind:id` and `intake_id`) just written by the
  current user, with a 15s lazy TTL and 100-entry cap (no timers, no business DTOs). Consumed
  on the next confirmed column/group change or arrival; unknown or expired entries default to
  other-caused (triggers `highlight`).
- `board-motion.ts` (`useBoardCardMotion`, `useMotionScopeReady`, `useClosureElementHighlight`,
  `columnHighlightTone`): 36B data-motion coordinator for board card FLIP moves + make-room/
  close-up + collapsed-group/off-screen flights (B1), board arrivals + off-screen `NewItemsChip`
  tracking with IntersectionObserver (B2), list group-change/new-row brand highlights + chip (B3),
  merged `data-closure-highlight` driving, and scope-settled `NumberRoll` gating (B4).

Hidden documents never start these effects. Preference/visibility changes finish running
effects. All tool keyframes are restricted to transform, opacity, backgroundColor.
No caller should parse CSS durations or import an animation library. 36C owns detail/presence
wiring; these tools hold no business objects.

Controls use CSS transitions. HeroUI's `data-entering` is the starting style and its
`data-exiting` is the ending style; the existing React Aria lifecycle waits for transitions
and restores focus. Custom popovers use `usePopoverPresence`. Collapse's standard layout
transition is `grid-template-rows` (E3), with one scoped CSS exception approved by user
decision (2026-11-24, card 39A option A): only `.ds-board-group` followed by another
`.ds-board-group` and containing cards also transitions `margin-bottom` with the same
`--dur-base` / `--ease-standard` tokens (disabled under `prefers-reduced-motion: reduce`
and `html[data-motion-reduced]`) so the last card keeps `--card-ring-room` for its bottom
ring while the next group heading `y` stays equal to main in both expanded and collapsed
states. Text colour (E2) and existing hover shadow (E6) are explicit CSS exceptions to the
public WAAPI tools' property restriction.
