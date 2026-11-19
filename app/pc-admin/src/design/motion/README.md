# Motion tools (36A)

CSS tokens are the only numeric source. `motionToken('--dur-base')` returns milliseconds;
`motionToken('--ease-standard')` returns a CSS easing. The cache is invalidated on system
preference/visibility changes and development overrides. `useReducedMotion()` subscribes to
the same source. Importing tokens has no DOM side effect until first use / initialization.

- `flip(el, from, to, {duration, easing, lift})` accepts viewport `{left, top}` rectangles
  and token names. It returns an `Animation`. Repeating on the same element samples its
  current visual rectangle before cancelling. At most six elements run concurrently.
  `lift` sets shadow/z-index temporarily; only transform is animated.
- `highlight(el, {tone: 'intake'|'active'|'done'|'brand'})` fades the phase background to
  the original computed background. Repeating restarts 1200ms. Reduced motion holds the
  solid colour for that duration, then restores the original inline background. Returns
  `{cancel(), finished}`; `cancel` restores immediately, and `finished` resolves on either
  completion or cancellation, including a reduced-motion hold.
- `useExitPresence(present, durationToken)` returns whether to render. Reopening cancels
  pending removal; reduced motion and hidden documents retain for zero time.
- `<NumberRoll value={number} animate={boolean}/>` rolls the entire number up/down, reserves
  the wider old/new value, and exposes only the final accessible text. First paint is static;
  rapid changes cancel previous effects. Set `animate={false}` on filter/search/view changes.

Hidden documents never start these effects. Preference/visibility changes finish running
effects. All tool keyframes are restricted to transform, opacity, backgroundColor.
No caller should parse CSS durations or import an animation library. 36B/36C own business
triggers and wiring; these tools hold no business objects.

Controls use CSS transitions. HeroUI's `data-entering` is the starting style and its
`data-exiting` is the ending style; the existing React Aria lifecycle waits for transitions
and restores focus. Custom popovers use `usePopoverPresence`. Collapse's only layout
transition is grid-template-rows (E3). Text colour (E2) and existing hover shadow (E6) are
explicit CSS exceptions to the public WAAPI tools' property restriction.
