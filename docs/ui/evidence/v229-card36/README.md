# Card 36A — rework round 4

Round 3 is preserved below, including the native single-table exception and confirmed tokens. This round changes only the Card16 arrivals test and documentation; no production motion, selectors, scroll amount or reading-position assertion changes. Base remains `bfeb7251e05c301a33ec389fdcde6c36bda7234c`, with all changes uncommitted.

### Incoming reviewer verification

The reviewer reports that the round-3 tree passed typecheck/build/Stylelint/ESLint/copy, Node motion 16/16, pr-plan `--check-docs`, Card36A motion 8/8, Card29/Card32A and all other related suites previously selected. All 18 screens, including list-default and list-closed-groups, were 0 px against the previous main-identical captures. These are reviewer results for round 3, not a new local browser run.

The additionally selected Card16 arrivals suite failed twice in arrival/collapsed/scrolling; reduced/filtered passed. Card31 failed once at “online changes never re-render board cards” and then passed on rerun; that observation is recorded only and is outside this round.

### 1 — exact arrival timing follows the computed token

The old assertion required a literal 2000ms although 36A's token sweep already made the existing hook read `motionToken('--dur-highlight')` and `motionToken('--ease-standard')`. Owner decision: **existing card16 arrival highlight now follows --dur-highlight (2000→1200ms, --ease-standard); 36B owns C2**.

The test now reads `--dur-highlight` with `getComputedStyle(document.documentElement)`, converts its CSS time to milliseconds, asserts exactly 1200, then requires the captured arrival duration to equal that computed value exactly. The `mode!=='reduced'` expectation remains unchanged. No arrival implementation is redesigned.

### 2 — wait for E3 expansion before scrolling or measuring

`Workbench` now renders board remainder cards in `Collapse`; its grid track transitions from 0fr to 1fr over `--dur-base` (180ms). The old test clicked expand and immediately called `window.scrollTo(0,200)` while the page could still be too short to scroll. Main's immediate expansion had hidden this timing assumption.

The scrolling branch now waits for `aria-expanded=true` and the shared `waitForAnimationsSettled` helper before the same scroll call. Arrival/collapsed setup also settles after the requested expansion state and before geometry snapshots. The scroll amount 200, `scrollY>0`, exact reading-position equality and all original selectors/business assertions remain unchanged. No product-code defect or change is introduced by this round.

### Round 4 verification and handoff

Local command logs use `/private/tmp/card36a-r4-*.log` as plain paths only; no links to ignored logs are added.

| Check | Round 4 status |
| --- | --- |
| `npm run migration:typecheck` → `npm run migration:build` | PASS; 975 typed, 329 unchecked legacy, 3056 outputs; syntax 975/975 |
| `npm run lint:css --prefix app/pc-admin` / `npm run lint:features --prefix app/pc-admin` | PASS |
| `node --experimental-strip-types tests/pc-admin-copy-terms.test.mts` | PASS 6/6 |
| Compiled `pc-admin-motion-policy` + `pc-admin-motion-tools` | PASS 16/16; source sweep 261 files, 0 bare CSS timings, 0 inline/WAAPI violations |
| `npm run docs:agents:check` / pr-plan `--check-docs` against main `30eb2fc8` | PASS |
| `node --test .build/tools/check-agent-docs.test.mjs` | PASS 20/20 |
| `node .build/tools/verify-artifact.mjs` / `git diff --check` | PASS |
| Card16 arrival/collapsed/scrolling/reduced/filtered | pending reviewer rerun |
| Card36A/related browser suites and 18-screen pixel parity | pending reviewer rerun |

The exact motion command was `TS_MIGRATION_TEST_SOURCE_ROOT="$PWD" TS_MIGRATION_TEST_RUNTIME_ROOT="$PWD/.build/runtime" node --test .build/runtime/tests/pc-admin-motion-policy.test.mjs .build/runtime/tests/pc-admin-motion-tools.test.mjs`. The exact plan command was `node .build/tools/pr-plan.mjs --base 30eb2fc80353d1ab834c5da4bcc183c6415311c6 --head HEAD --check-docs --out /private/tmp/card36a-r4-pr-plan.json`.

Build source input hash: `b0be286f78623addc3370c639a26f8574e02412f0b1e0d67b96f057bcc4479ed`; verified manifest SHA256: `609607ecf8a752b3f7c74f363740631828956d7b8e4d8da50bc6c3556ef1051e`. All six beyond-A1 token values and round-3 code patches remain unchanged.

No browser launch, baseline approval, commit/push/rebase/stash/branch change or database work is performed in this round. The reviewer reruns the updated compiled Card16 suite; static checks do not establish its browser verdict.

---

## Round 3 record (preserved)

Current base: `bfeb7251e05c301a33ec389fdcde6c36bda7234c` (PR #193). This round leaves its changes uncommitted. No commit/push/rebase/stash/branch change, baseline approval or browser launch. Static/reference appearance remains current main `30eb2fc80353d1ab834c5da4bcc183c6415311c6`.

### Confirmed owner decisions

The six beyond-A1 tokens are **confirmed by the owner (2026-11-19)**: `--ease-ambient`, `--ease-linear`, `--ease-toast`, `--scale-popover`, `--hover-lift`, `--delay-tooltip`. Only confirmation wording changed; their values are unchanged. Each token comment and the design chapter carries the same confirmation.

**列表视图分组保持原生单表，不做高度展开，仅箭头旋转（2026-11-19 负责人确认）**。

List stages, subgroups and remaining-item controls now use main's direct table rows and immediate visibility/mount changes. The chevrons keep `--dur-base` / `--ease-standard`, with no transition in reduced motion. Board groups, board remaining items and drawer sections keep their full E3 grid collapse; the board zero-jump test is unchanged.

### CI link root cause and correction

The README linked `reviewer-r2/related.log` and `reviewer-r2/motion.log`. They existed locally but were excluded by the root `*.log` rule, so fresh CI checkouts could not resolve them. Those references are now plain text paths, supported by tracked summaries and input records. No `.gitignore` change or forced log staging is used.

The [Git-aware link audit](checks/r3/link-audit.json) checks all Markdown files introduced/changed by this PR, using the CI Markdown parser, `git ls-files`, visible untracked files and `git check-ignore`. It reproduces the two ignored-link failures in committed HEAD and checks the working version independently, including directory links with tracked descendants. `docs:agents:check` and the exact pr-plan `--check-docs` path are also run against the required main base. Local ignored raw logs are not claimed as tracked evidence.

### Native-table accessibility correction

`TableCollapse` created nested headerless tables, so the outer `scope=col` headers no longer labelled the data cells. Removed that wrapper and all list-specific exit retention, nested colgroups and segment/clipping CSS. The stage/subgroup/remainder branches follow main, preserving hidden rows, IDs, ARIA state/controls, row-link and keyboard claim hooks. No list row height/grid animation remains.

Card29 now checks both the initial list and expanded remainders: no nested table, exactly seven outer column headers, every data row directly in an outer `tbody.list-group`, and every cell in the same table as its indexed `scope=col` header. Its previous clipping assertion is strengthened with a no-wrapper condition. Card32A returns to flat sibling-row traversal and adds a same-table assertion. All existing business and geometry values remain unchanged.

### Verification and handoff

[Round 3 results](checks/r3/results.json) records final commands, the tested source/artifact identity, token-value and link audits. Raw local command logs use `/private/tmp/card36a-r3-*.log` and are cited as paths only.

| Check | Round 3 status |
| --- | --- |
| Typecheck, then build | PASS; strict/negative types and 975/975 compiled syntax checks |
| Stylelint / ESLint / copy terms / Node motion checks | PASS; copy6/6 and combined frontend97/97 |
| docs:agents:check / pr-plan --check-docs / Git-visible link targets | PASS; current link audit has 0 missing/ignored targets |
| List accessibility, keyboard/ARIA and exact list-default/list-closed-groups pixels | pending reviewer rerun |
| Other related browser tests and A6 browser/filmstrip acceptance | pending reviewer rerun |

Reviewer reruns the updated Card29/Card32A checks and related list/claim scenarios, then compares list-default and list-closed-groups directly with main; the target remains 0 changed pixels. No pixel result is inferred from static source checks. No board/drawer motion, business schema, permissions or data flow was changed by this round.

---

The round 2 record below retains its original source identity and results; current list behaviour and owner confirmation are governed by round 3 above.

## Historical round 2 record

**Local checks PASS. Browser and pixel acceptance PASS (reviewer rerun 2026-11-19, macOS 25.6.0 / Chrome 157.0.8103.79; see 「Reviewer rerun」).** All changes remain uncommitted on `claude/v229-card36a-ddc815`, base `30eb2fc80353d1ab834c5da4bcc183c6415311c6`. No commit/push, PR, baseline approval, deployment, schema change or 36B/36C motion wiring. The supplied prototype and other worktree are preserved.

## Static reference and scope correction

The static reference is **captured current main**, using the same capture tool/environment. The reviewer measured unmodified main itself changing 14/18 screens against the committed baseline. This is a main-vs-baseline finding, not a reason to change main's appearance in 36A. R1's attempt to restore older title rhythm and lane tint was out of scope and is withdrawn.

Owner findings, **not fixed in 36A**:

- Main's card title rhythm is about 8px taller than the committed baseline. Its existing `.card-open h3` cascade is retained exactly.
- Main's active/handled lanes use the existing grey appearance rather than the old baseline's tint. Their existing cascade is retained exactly.
- Main's 35A empty/readonly/danger-icon presentation also belongs to the current reference. No related business presentation is removed to match older images.

No committed baseline, threshold, mask or screenshot assertion was changed. No residual pixel difference is accepted or attributed to subpixel rendering without measurement. Any actual remaining 1px segmented-slider pixels must be listed after the reviewer recaptures this candidate.

## Changes and root causes

### a / b — card height and lane colour

Removed the R1 `.ds-ticket-card .ds-ticket-body h3` specificity addition and its comment; restored the original title selector/declarations. Removed the R1 `.ds-board-column.board-column:is(.active,.handled)` background override. A read-only comparison of final production CSS with the reviewer's captured-main build confirms the same four title/lane rules in the same cascade order: [CSS parity check](checks/r2/main-style-parity.json). This is CSS-rule verification, not pixel acceptance.

### c — expanded chevron pointed down

The source combined `rotate:none` and `transform` in one rule. The compiled CSS folded the independent-rotation reset away while retaining HeroUI's `rotate:-180deg` and the new `transform:rotate(-180deg)`. Those two rotations stacked, producing a full turn back to down. The R1 reduced-motion variation was folded similarly.

The independent `rotate:none` reset now has a separate selector/rule, and transform alone owns the E3 rotation. Reduced motion disables the transition while keeping the same static end state. A production-asset regression test went RED on the R1 CSS and now passes. [Final compiled rules](checks/r2/compiled-chevron.json):

```css
html body :is(.ds-board-group,.workbench-disclosure) .disclosure__indicator{rotate:none}
html body :is(.ds-board-group,.workbench-disclosure) [data-slot=disclosure-indicator][data-expanded=true]{transform:rotate(-180deg)}
```

The real HeroUI BoardGroup is also included in the isolation fixture. Its browser checks assert expanded-up/collapsed-down in normal and reduced motion, with no independent second rotation; these new browser assertions await reviewer execution.

### d — final group bottom spacing

The 8px grid-item compensation is now limited to a card-ending group immediately followed by another BoardGroup. There the original last-card margin collapsed into the next group's 12px margin. The final group must keep its original 8px gap before the remainder control. The supplied main/R1 side crop shows the R1 pending footer short by the three 8px title differences plus this extra 8px removal. Child margins remain stable while a remainder mounts/unmounts. Final pixels await reviewer comparison.

### 1 — shared settle helper regression

R1 removed the original `+500ms` final-rAF grace and treated a missed frame as failure before rechecking whether any work remained. That produced the Card35A `requestAnimationFrame/not-rendering` failure even for a quiet page.

The helper restores that grace and snapshots running/pending animations and entering state before reporting a timeout. An elapsed deadline with neither is settled. Entering/delayed-transition rechecks remain; real pending work still fails. Node regressions cover delayed transition creation, late frames beyond the nominal deadline, and an expired quiet page with no new rAF. The grace regression went RED before the fix and is now green. No Card35A assertion or scenario was removed or loosened.

### 2 — filmstrip setup and diagnostics

The sequence reused the document from the preceding reduced-motion/pointer subtest. Its restoration asserted the live JS media preference but did not establish that the asynchronous change listener had cleared `data-motion-reduced`, nor prove a released/hit-testable button with its normal CSS transition. Freezing CDP playback alone did not establish those preconditions.

The reduced-motion subtest now waits for both the media query and root CSS attribute to reset. Evidence capture starts in a fresh normal-mode fixture document, with an old-document marker preventing a navigation wait from accidentally succeeding in the previous document. It explicitly releases the pointer, prepares scroll/hover before freezing, and asserts the unpressed, normal-CSS, hit-testable state. The frozen E1 trigger performs only mousePressed, with an explicit button bitmask; no settle wait occurs inside that trigger.

The no-animation assertion now includes and saves:

- document animation count, selector node count and unfiltered target animation count;
- each target's computed transform, transition property/duration, `:active` and `data-pressed` state;
- every root `data-motion*` attribute and the reduced-motion media-query value.

A failure writes `filmstrip/<name>-failure.json` before cleanup. Node checks verify diagnostic completeness and playback restoration on both trigger failure and zero effects. The browser confirmation of the sequence correction remains pending. The API `captureFilmstrip(name, trigger, selector)`, pre-trigger CDP freeze, real-effect seeking and component-region crop remain intact.

R1's passing Card29/Card31/Card32A fixes are retained. No global hit-test check or 260/36/24 geometry assertion was changed.

## Incoming reviewer results and direct main comparison

These results describe **R1**, not the revised R2 candidate:

- Related browser suite: **40/41 PASS**. Card29/Card31/Card32A PASS; Card35A A4.6–8 failed at the old settle helper's frame deadline. Local-only raw log: `reviewer-r2/related.log` (ignored; tracked summaries/input records below).
- Motion browser entry: **5/6 subtests PASS**; E1 filmstrip failed. The later URL slow/off subtest was not reached after that failure. Local-only raw log: `reviewer-r2/motion.log` (ignored; tracked summaries/input records below).
- Recomputed from the supplied existing PNGs with pixelmatch threshold .1: **12 changed / 6 identical** against captured main, exactly matching the reviewer's counts. This offline comparison did not launch or recapture an application. [Machine comparison and hashes](reviewer-r2/incoming-r1-vs-main.json), [main metadata](reviewer-r2/main-capture-meta.json), [R1 metadata](reviewer-r2/incoming-r1-capture-meta.json), [side crop: main left / R1 right](reviewer-r2/incoming-r1-vs-main-board.png).

| Screen | Incoming R1 vs main pixels | Disposition |
| --- | ---: | --- |
| board-default | 48064 | a/b/c/d corrections; pending new comparison |
| board-presence | 48064 | Same board correction; presence motion/outline unchanged |
| sidebar-online-popover | 48048 | Board underlay; existing popover geometry fix retained |
| drawer-banner-editing | 21068 | Board underlay; no drawer/presence redesign |
| drawer-processing | 15123 | Board underlay |
| toast-drawer-stack | 15123 | Board underlay; Toast unchanged |
| drawer-dismissed | 15007 | Board underlay; main readonly presentation retained |
| drawer-completed | 14972 | Board underlay; main readonly presentation retained |
| restore-dialog | 9591 | Board underlay; modal unchanged |
| close-dialog-out-of-scope | 8182 | Board underlay; form geometry unchanged |
| close-dialog-duplicate | 8182 | Board underlay; form geometry unchanged |
| board-filtered-empty | 48 | Group chevron orientation |
| list-default | 0 | Incoming identical |
| list-closed-groups | 0 | Incoming identical |
| detail-fullpage-1280 | 0 | Incoming identical, including the Save glyph |
| notifications-default | 0 | Incoming identical |
| conversation-default | 0 | Incoming identical |
| toast-tones | 0 | Incoming identical |

The previous Save-glyph concern disappears against actual main and is not an R2 open item. The old-baseline comparison is retained as historical evidence; it is not the A6.6 acceptance reference. Earlier reports retain their own identities: [round1](round1-report.md), [round0](round0-report.md).

## Local verification and identity

Environment: macOS26.6.2 / Darwin25.6.0, Node24.18.0. Reviewer system Chrome157.0.8103.79. No browser run or launch investigation was performed this round, per instruction.

Final source input: `5a85c7e163b7d91573c7c04822f4812985ba3f60c9137fdb29fa3fcd183ba425`.

Final manifest SHA-256: `ecfd4570297322cd291226d64846c5ece6520c6d5f867a3d1eb46965bfc95813`.

| Command / check | R2 result |
| --- | --- |
| `npm run migration:typecheck` | PASS final; strict/negative types, CSS, variables, feature syntax. Initial diagnostic-callback type errors were fixed; original failure retained. |
| `npm run migration:build` | PASS after typecheck; typed975 / unchecked legacy329 / outputs3056; syntax975/975, max active2 |
| `npm run lint:css --prefix app/pc-admin` | PASS |
| `npm run lint:features --prefix app/pc-admin` | PASS |
| `node --experimental-strip-types tests/pc-admin-copy-terms.test.mts` | PASS6/6 |
| `node --experimental-strip-types --test tests/pc-admin-motion-tools.test.mts` | PASS10/10 |
| Final compiled frontend command below | **PASS97/97**: motion policy6, tools10, copy6, design foundation75 |
| `node .build/tools/verify-artifact.mjs` | PASS `ARTIFACT_VERIFIED_NOT_ACTIVATED` |
| Production chevron reset assertion | PASS; original R1 asset was RED |
| Captured-main / R2 title-and-lane CSS-rule parity | PASS4 rules; not pixel acceptance |
| `npm run docs:agents:check` / `git diff --check` | PASS documentation budget/local links and whitespace |
| Browser suites, captures, main pixel comparison, filmstrips | **PASS (reviewer rerun)** |

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

[Local logs](checks/r2/) preserve the initial type failure and pre-fix REDs, followed by final PASS results. The incoming R1 main comparison is bound to `c9e602f21a13e9af28fe8bd60ea7fd45d43fb1a228eabcd3bbbde9dd2b7bc204`; the main capture records `3dba6720d8b540b3faceb0bd67bb63e03145149f6a54fca14571ca01ee3788fa`. Neither is rebound to R2.

## A1–A6 status

A1 exact tokens/rules/source sweep and A3 production debug exclusion pass locally. A2 tools remain implemented and Node-tested; no business motion wiring was added. A4 E1–E7 and A5 chapter remain in scope; this round only restores current-main appearance and corrects the checks/setup above.

| A6 | Current revised candidate |
| --- | --- |
| 1 Tokens / lint / zero-bare sweep | PASS |
| 2 Browser duration/easing/property assertions | PASS (reviewer rerun; `motion-receipt.json`) |
| 3 CDP reduced motion / functionality | PASS (reviewer rerun) |
| 4 E4/E5 reverse / unmount / focus | PASS (reviewer rerun) |
| 5 E3 ten-frame monotonic geometry | PASS (reviewer rerun) |
| 6 Pixel-identical to captured current main | PASS: 18/18 screens 0 px vs main 30eb2fc8 captures; `visual:compare` vs committed baselines still FAILS on main itself (stale baselines, owner decision); no baseline update |
| 7 E1–E5 five-frame filmstrips | PASS: `filmstrip/e1-press … e5-modal.png` |
| 8 Typecheck/lints/build/copy/Node/browser | PASS (yxx-h5-flow excluded: local ffmpeg/ffprobe path env, unrelated) |

standard=`cubic-bezier(.2,0,0,1)`; soft=`cubic-bezier(.16,1,.3,1)`; exit=`cubic-bezier(.4,0,1,1)`.

| Motion | Expected token / duration / curve | R2 browser measurement |
| --- | --- | --- |
| E1 press/release | instant80 / fast120 standard | 80 / 120ms, cubic-bezier(.2,0,0,1) |
| E2 slider/label | base180 standard | 180ms, cubic-bezier(.2,0,0,1) |
| E3 grid/arrow | base180 standard | 180ms / 180ms, cubic-bezier(.2,0,0,1) |
| E4 enter/exit | fast120 standard / instant80 exit | 120ms standard / 80ms cubic-bezier(.4,0,1,1) |
| E5 panel/mask | slow240 soft / fast120 exit | 240ms cubic-bezier(.16,1,.3,1) / 120ms cubic-bezier(.4,0,1,1) |
| E6 hover | fast120 standard | 120ms, cubic-bezier(.2,0,0,1) |
| E7 tooltip | delay400 (adjacent0), instant80 standard | cold ≥400ms, adjacent <400ms; 80ms standard |

The historical select/date fallback remains removed; E4 and explicit reduced-motion handling own those states. Toast curves/durations and 35A state timing remain unchanged. `motion` remains installed and forbidden outside login.

## Added beyond A1, confirmed by the owner (2026-11-19)

All six retain an individual reason in `tokens.css` and the design chapter:

| Token | Value | Reason |
| --- | --- | --- |
| `--ease-ambient` | ease-in-out | Preserve existing 35A / voice loop rhythm |
| `--ease-linear` | linear | Preserve spinner speed |
| `--ease-toast` | ease-out | Preserve card33 Toast curves |
| `--scale-popover` | .97 | E4's specified menu scale |
| `--hover-lift` | -1px | E6's existing lift |
| `--delay-tooltip` | 400ms | E7's first-tooltip wait |

Login decorative motion remains outside the workbench sweep. The only extra CSS-duration whitelist is Skeleton/refresh's narrowly scoped 35A `--load-pulse`; ambient/Toast/spinner curves are tokenized instead of exempted. Public WAAPI frame properties remain restricted; E3 grid, E2 text colour and E6 shadow are explicit CSS exceptions. The historical table-only `overflow:clip` variant is removed in round 3; the current list uses direct native rows and no collapse clipping layer.

## Handoff / remaining verification

- Reviewer reruns the motion entry (including the real HeroUI chevron checks, filmstrips and later URL-debug subtest), Card35A and related suites.
- Reviewer recaptures main and R2 with the same tool and compares all18 screens directly. Target is zero differences; any measured 1px segmented-slider exception must be listed individually. None is claimed now.
- Expected filmstrips: `e1-press`, `e2-segment`, `e3-collapse`, `e4-menu`, `e5-modal`. [Status and diagnostic contract](filmstrip/README.md).
- Title rhythm / lane colour differences between main and the old baseline are owner findings only. No approval or correction is inferred.

No business/schema rollback is needed. Revert only this task's scoped source changes if required, preserving the prototype and historical evidence. No shared database or other worktree was touched; no browser/server resource was started this round. Final A1–A6 line review: local checks above pass; all browser/pixel/filmstrip acceptance remains explicitly pending reviewer rerun.

## Reviewer rerun (2026-11-19, outside the Codex sandbox)

macOS 25.6.0 (darwin), Chrome 157.0.8103.79, Postgres `127.0.0.1:5432`.

| Check | Result |
|---|---|
| `npm run migration:typecheck` → `npm run migration:build` | PASS |
| Stylelint `src/**/*.css`, ESLint `src/**/*.{ts,tsx}` | PASS |
| `tests/pc-admin-copy-terms.test.mts` | PASS |
| Node motion policy + tools (incl. production-asset debug-switch assertion) | 16/16 PASS |
| `pc-admin-card36a-motion.browser.test` | 8/8 PASS |
| Related browser/integration entries (card12-review, 16, 29, 30B, 31, 32A, 35A, legacy-retirement, t10, t35×2, wbint t19/t22/t32, ss-009, ss-010) | 41/41 PASS (11 entries first failed in ~2ms with a Postgres connection AggregateError from the shared database, then 13/13 PASS on rerun) |
| `yxx-h5-flow.integration` | Not counted: local ffmpeg/ffprobe path requirement (environment, unrelated to 36A) |
| 36A captures vs unmodified main `30eb2fc8` captures (pixelmatch .1) | 0 px on all 18 screens |
| `npm run visual:compare` vs committed baselines | FAIL for both main and 36A (14/18 changed on main itself); baselines predate 35A merge — owner decision, not approved here |

Measured timings (`motion-receipt.json`): E1 80/120ms standard; E2 180 standard; E3 grid + arrow 180 standard; E4 in 120 standard / out 80 exit; E5 panel + backdrop in 240 soft / out 120 exit; E6 120 standard; E7 80 standard — all equal to the tokens.


## Reviewer rerun — rounds 3 and 4 (2026-11-19, outside the Codex sandbox)

macOS 25.6.0, Chrome 157.0.8103.79, Postgres `127.0.0.1:5432`.

| Check | Result |
|---|---|
| typecheck → build, Stylelint, ESLint, copy terms, Node motion 16/16, `docs:agents:check`, `pr-plan --check-docs` vs `30eb2fc8` | PASS |
| `pc-admin-card36a-motion.browser.test` | 8/8 PASS |
| Related browser/integration suites (card12-review, 16, 16-arrivals, 29, 30B, 31, 32A, 35A, legacy-retirement, t10-waiting, t35×2, wbint t19/t22/t32, ss-009, ss-010) | 52/53 PASS |
| Card16 arrivals `scrolling` | FAIL, **pre-existing on main**: main `30eb2fc8` fails the same assertion twice with the same 2px reading-position shift (cards 100→102, 238→240) when the 「1 条新报修」 capsule appears. Not caused by 36A; recorded for a separate fix. |
| Card31 | Failed once (online change re-rendered a board card), passed on rerun; it also passed in rounds 1–2. Recorded as intermittent. |
| 18 screens vs the round-2 captures (themselves 0 px vs main) | 0 px on all 18, including list-default and list-closed-groups |
