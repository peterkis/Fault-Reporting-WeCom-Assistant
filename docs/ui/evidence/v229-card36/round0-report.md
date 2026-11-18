> Historical delivery record. The environment diagnosis is superseded by the reviewer-supplied browser results; this is not the current acceptance report.

# Card 36A — motion foundation and controls

Implementation is present; browser acceptance is **FAIL / blocked by Chrome startup**. No browser timing, reduced-motion, interrupt, geometry or visual result is claimed as a pass. E1–E5 filmstrips produced: **0/5**.

Base: `30eb2fc80353d1ab834c5da4bcc183c6415311c6`; branch: `claude/v229-card36a-ddc815`; all changes remain uncommitted. The supplied bundled prototype is preserved. No deployment, real sends, schema change, Gate change or 36B/36C business wiring. The other worktree was not touched.

## Environment and tested identities

- macOS 26.6.2 / Darwin 25.6.0; installed system Google Chrome 157.0.8103.79; Node 24.18.0; loopback PostgreSQL 18.6 (Homebrew).
- Final build input: `fd968bc876d896197ffeed599e617cf822de345c77d3b8ca817ca2808bd1b489`.
- Final manifest SHA-256: `7924aa7952b329463e5d08ce600fa811ee30e8b92b4a61dea033129358a39100`.
- Routed nonbrowser/tool regression snapshot input: `7c031552760f388e5bdd49298a3f333c66175a23d8b470a95cf4381258b19f15`. Later differences are in [artifact-delta.json](checks/artifact-delta.json): the motion browser entry and PC web assets changed; backend/shared runtime bytes did not. Final frontend checks were rerun on the final build. Earlier regression results are not rebound to the final input identity.
- Chrome standalone launch exits with SIGABRT before a DevTools port exists, with empty stderr. Normal and diagnostic attempts failed. The new browser entry and existing Card29 entry report `P2_006_BROWSER_WAIT_TIMEOUT` before UI assertions. Owned resources after launcher cleanup: processes/profiles/timers/sockets all 0. Root cause of the installed browser's abort remains undetermined.

## Change list

- **A1:** exact seven durations, three curves, four offsets and press scale; centralized token reading; CSS/TS/TSX sweep; Stylelint rule, ESLint restrictions and AST provenance tests. Additional tokens: `--delay-tooltip:400ms`, `--scale-popover:.97`, `--hover-lift:-1px`, plus preservation curves `--ease-ambient`, `--ease-linear`, `--ease-toast`.
- **A2:** cached `motionToken`, reduced-motion subscription/invalidation, FLIP continuation and six-animation cap, four-tone restartable highlight, exit presence and standalone NumberRoll. Tools finish/skip effects on hidden documents and obey reduced motion. `highlight` returns `{cancel(), finished}`; `flip` returns `Animation`; NumberRoll accepts `animate={false}`. [APIs](../../../../app/pc-admin/src/design/motion/README.md) are documented for 36B/36C.
- **A3:** development-only URL/localStorage switch, all duration tokens ×5, live cache invalidation and `?motion=off`; production exclusion assertion passes.
- **A4:** E1–E7 controls, shared tooltip warmup, grid collapse and stable chevrons, segmented slider preserving caller buttons/handlers, overlay CSS transitions integrated with HeroUI/React Aria lifecycle. Toast trajectories/durations remain card33's.
- **A5:** [动效 chapter](../../design-system.md#动效): tokens, six principles, current/future motion specifications, reduced-motion/interrupt rules, technology and links from older text. C/D rows explicitly remain specifications for 36B/36C.
- **A6:** timing/property and deterministic filmstrip helpers, isolated real-component fixture/browser entry, unit/policy checks and test routing. Existing business/geometry expected values remain unchanged; relevant geometry checks wait for animations.

E3 retains one original outer table/header and row/action hooks. Valid spanning rows contain fixed-column table segments for grid collapse. Static geometry/accessibility is not browser-verified. Remaining rows expand as a container, without per-row entrance.

## Deletion list and every timing change

| Location / motion | Before | After |
| --- | --- | --- |
| Arrival hook | 2000ms, ease-out | highlight **1200ms**, standard; old frames/offset/tone retained |
| Existing FLIP hook | base 180ms, ease-out, local CSS parser | base 180ms, standard, `motionToken`; no 36B redesign |
| `closure-restored` | `calc(var(--dur-slow) * 5)`, ease-out | highlight 1200ms, standard; keyframes retained for 36B |
| Restoration removal timer | literal 1200ms | highlight token; normal duration unchanged |
| `presence-fade` | 150ms, ease-out | fast **120ms**, standard; no 36C enter/exit redesign |
| Legacy detail dialog / voice-symbol entrance | base 180ms, ease-out | base 180ms, standard; existing keyframes retained |
| Media image transform | base 180ms, implicit ease | base 180ms, standard |
| Conversation background | fast 120ms, implicit ease | fast 120ms, standard |
| E1 button | background/border fast 120ms; no scale | background/scale **80ms pressed / 120ms released**, standard; border interpolation removed (instant) |
| E2 segmented control | immediate selected background/shadow | independent slider/label **180ms**, standard; competing selected-background rule removed |
| E3 disclosure / remainder | vendor height/opacity and arrow timing, or immediate mount | grid/arrow **180ms**, standard; vendor height/keyframes overridden |
| E4 menus/popovers/selects | vendor keyframes or immediate custom panel | enter **120ms standard / exit 80ms exit**, scale .97 + opacity |
| E5 panel/backdrop | separate vendor keyframes/timings | enter **240ms soft / exit 120ms exit**; reduced opacity 120ms |
| E6 hover | fast120 implicit ease; generic shadow base180 | fast **120ms standard**; existing 1px lift/shadows preserved |
| Presence tooltip | 300ms delay, 150ms ease-out fade, delayed visibility | **400ms cold / 0 adjacent**, opacity **80ms standard**, visibility no delayed transition |
| Attachment tooltip | 150ms delay / vendor fade | **400ms cold / 0 adjacent**, opacity **80ms standard** |
| Readonly / follow tooltip | immediate | **400ms cold / 0 adjacent**, opacity **80ms standard** |
| Skeleton / refresh | load-pulse 1400ms, ease-in-out | same duration/curve via `--ease-ambient` |
| Voice ambient loops | slow240, ease-in-out | same duration/curve via `--ease-ambient` |
| Spinners | slow240, linear | same duration/curve via `--ease-linear` |
| Toast | enter180 / exit120, ease-out | same duration/trajectory via `--ease-toast` |

Deleted duplicate CSS-duration parsing, literal WAAPI timing, CSS tooltip hover-delay rules, competing conversation selected-segment background/shadow, and historical select/date fallback selectors. HeroUI overlay/disclosure keyframes are overridden in app CSS; dependencies are untouched. Legacy `drawer-open`, `ds-drawer-enter`, `presence-fade`, `closure-restored` keyframes remain for 36B/36C redesign. No dependency was added/removed; `motion` remains installed and forbidden outside login.

## Whitelist and preserved behaviour

| Entry | Reason |
| --- | --- |
| `login/**/*.{css,ts,tsx}` | Independent decorative login surface, unchanged. No current `motion` import was found there. |
| `Skeleton/skeleton.css`: `ds-skeleton-pulse` / `ds-refresh-progress`, `--load-pulse` | 35A ambient period remains 1.4s. Duration exception limited to this file/names; curve tokenized. |
| Voice ambient loops | Tokenized, not exempted: `--ease-ambient` preserves ease-in-out. |
| Spinners | Tokenized, not exempted: `--ease-linear` preserves rotation rhythm. |
| Toast enter/exit | Tokenized, not exempted: `--ease-toast` preserves card33 ease-out. |

35A load/connection constants, request deadlines, polling, debounce, draft TTL and sound batching remain unchanged; these are not interaction animation durations.

## A6 acceptance

| A6 | Result | Evidence / test |
| --- | --- | --- |
| 1 Tokens / rules / sweep | **PASS** | Stylelint, ESLint, policy5/5; 261 files, 0 CSS bare timings, 0 inline/WAAPI violations; [A1 audit](token-audit.json)15/15 |
| 2 Browser timing/easing/properties | **FAIL — startup blocked** | `pc-admin-card36a-motion.browser.test.mts`; helper called for E1–E7; no measurements |
| 3 CDP reduced motion E1–E5 | **FAIL — startup blocked** | Browser subtest implemented, not reached |
| 4 Mid-open Esc / reverse / unmount / focus | **FAIL — startup blocked** | E4/E5 browser subtest implemented, not reached |
| 5 E3 ten-frame monotonic top | **FAIL — startup blocked** | `assertMonotonicCollapse` implemented, not reached |
| 6 Visual compare, 0 unexpected changes | **FAIL** | Capture fails launching Chrome; compare exits1: current/platform metadata invalid. Empty changed array is not a valid zero-diff result. No 1px slider differences assessed. |
| 7 Five E1–E5 filmstrips | **FAIL — 0/5** | Helper implemented; [status](filmstrip/README.md); no fabricated frames |
| 8 Typecheck / lint / build / copy / related browser | **FAIL overall** | Static/build/copy/nonbrowser pass; 2 browser launch failures, 16 routed browser entries NOT_RUN |

`motion-assert.mts` reads `getAnimations()` including CSS transitions and checks computed-token duration/easing and frame properties. Public WAAPI tools only animate transform/opacity/backgroundColor. Card-required CSS exceptions are explicit: E3 gridTemplateRows, E2 text colour, E6 boxShadow. Exceptions must be named per assertion; E3/E6 calls do so. E2 changes visual width using scaleX and assigns actual width directly. Native details uses discrete content-visibility to retain exit visibility. These are documented interpretations of conflicting property requirements, not blanket test exemptions.

## Expected / measured specification

standard=`cubic-bezier(.2,0,0,1)`; soft=`cubic-bezier(.16,1,.3,1)`; exit=`cubic-bezier(.4,0,1,1)`.

| Motion | Expected token duration / curve | Browser measured duration / easing |
| --- | --- | --- |
| E1 press / release | instant80 standard / fast120 standard | NOT_MEASURED |
| E2 slider / label | base180 standard | NOT_MEASURED |
| E3 grid / arrow | base180 standard | NOT_MEASURED |
| E4 enter / exit | fast120 standard / instant80 exit | NOT_MEASURED |
| E5 panel + mask enter / exit | slow240 soft / fast120 exit | NOT_MEASURED |
| E6 hover | fast120 standard | NOT_MEASURED |
| E7 tooltip | delay400 (adjacent0), instant80 standard | NOT_MEASURED |
| NumberRoll / default FLIP | base180 standard | NOT_MEASURED; Node token/options checks pass |
| Highlight | highlight1200 standard | NOT_MEASURED; Node tones/restart/hold/cancel pass |

## Commands and results

All ran in this worktree. [Raw logs](checks/) preserve initial failures and final results.

| Command / entry | Result |
| --- | --- |
| `npm run migration:typecheck` | PASS strict, negative types, variables, CSS, feature syntax; followed by build |
| `npm run lint:css --prefix app/pc-admin` | PASS final CSS |
| `npm run lint:features --prefix app/pc-admin` | PASS all src |
| `npm run migration:build` | PASS final: typed975 / unchecked legacy329 / outputs3056; syntax975/975, max active2 |
| `node .build/tools/verify-artifact.mjs` | PASS `ARTIFACT_VERIFIED_NOT_ACTIVATED` |
| `node --experimental-strip-types tests/pc-admin-copy-terms.test.mts` | PASS6/6 |
| Final compiled frontend command below | PASS92/92: policy5, tools6, copy6, foundation75 |
| Routed `runSelection` batches: pure / DB / remaining / canonical retry | Final unique64 entries, **531/531 PASS**; initial8 media failures preserved. [Summary](checks/nonbrowser-summary.json), [plan](checks/routed-plan.json) |
| Seven compiled tool groups below | **138/138 PASS**; initial missing-python and Stylelint fixture RED preserved |
| Compiled `pc-admin-card36a-motion.browser.test.mjs` | FAIL Chrome launch, 0 UI assertions |
| Compiled `pc-admin-card29.browser.test.mjs` | FAIL same Chrome launch, 0 UI assertions |
| `npm run visual:capture` | FAIL at first board capture, Chrome launch |
| `npm run visual:compare` | FAIL exit1, invalid current metadata; baselines unchanged |
| `npm run docs:agents:check` | PASS documentation budget/local links |
| `git diff --check` | PASS |

Final frontend / sweep command:

```sh
TS_MIGRATION_TEST_SOURCE_ROOT="$PWD" \
TS_MIGRATION_TEST_RUNTIME_ROOT="$PWD/.build/runtime" \
node --test \
  .build/runtime/tests/pc-admin-motion-policy.test.mjs \
  .build/runtime/tests/pc-admin-motion-tools.test.mjs \
  .build/runtime/tests/pc-admin-copy-terms.test.mjs \
  .build/runtime/tests/pc-admin-design-foundation.test.mjs
```

Exact sweep output:

```text
MOTION_SWEEP {"files":261,"cssBareTiming":0,"inlineOrWaapiViolations":0,"whitelist":"login/** only; --load-pulse ambient duration preserved"}
```

Tool groups:

```sh
PATH="/private/tmp/card36a-python-venv/bin:$PATH" TMPDIR=/private/tmp \
node --test --test-concurrency=1 \
  .build/tools/backend-layout.test.mjs .build/tools/check-agent-docs.test.mjs \
  .build/tools/design-system.test.mjs .build/tools/h5.test.mjs \
  .build/tools/hosts.test.mjs .build/tools/pr-plan.test.mjs \
  .build/tools/tooling.test.mjs
```

The initial media runs rejected symlinked `/var/...` ancestry and Homebrew executable links under existing safe-path guards. Retrying canonical `TMPDIR=/private/tmp` and realpath ffmpeg/ffprobe passed, without H5 code/assertion changes. The Stylelint gate fixture now copies the plugin alongside its config, after its original ConfigError was recorded. Python was supplied in a task-owned temporary venv with CI's pinned PyYAML6.0.2; no system package installation.

Browser reproduction (requires functioning installed system Chrome):

```sh
TS_MIGRATION_TEST_SOURCE_ROOT="$PWD" \
PILOT_DATABASE_URL=postgresql://petervans@127.0.0.1:5432/postgres \
CARD36A_EVIDENCE_DIR="$PWD/docs/ui/evidence/v229-card36" \
node --test .build/runtime/tests/pc-admin-card36a-motion.browser.test.mjs
```

Routing selected82 entries (64 nonbrowser +18 browser). The supplied untracked prototype triggers the existing unknown-path MVP fallback; it was not excluded/reclassified to reduce checks. [Browser status](checks/browser-status.json) lists all16 unexecuted entries.

## Filmstrips and HeroUI fallback

Expected `e1-press.png`, `e2-segment.png`, `e3-collapse.png`, `e4-menu.png`, `e5-modal.png`: **none generated**. The [helper](../../../../tests/helpers/motion-filmstrip.mts) exposes bound `captureFilmstrip(name, trigger, selector)`, pauses relevant real effects at0/25/50/75/100%, captures/stitches with Sharp, then finishes effects. It fails when no animation exists.

The historical select/date `animation:none;transition:none` selector fallback was **removed**. At this base it was inside reduced-motion media, not unconditional. The foundation supplies normal E4 and explicit reduced-motion rules (native preference and dev override, including portals). HeroUI defaults are overridden by transitions for current-state reversal. No flicker/layout result exists because Chrome never launched. Installed HeroUI3.2.6 CSS/React Aria lifecycle were inspected; [official animation-state documentation](https://heroui.com/en/docs/react/getting-started/animation) provides context.

## Open questions / deviations / rollback

1. Chrome startup must be repaired before A6.2–A6.7 and browser parts of A2/A3/A4/A6.8 can be accepted. No timings, CDP results, interrupt/focus results, geometry samples, screenshots or filmstrips exist for this candidate.
2. Sixteen related routed browser entries remain NOT_RUN after launch failure reproduced in the new entry, existing Card29 and visual capture. Unit tests do not replace browser checks.
3. E2 visual-width transform, E3 grid/E2 colour/E6 shadow CSS exceptions and native details' discrete content-visibility retention are explicit interpretations needing browser acceptance.
4. Table collapse markup/static geometry and segmented slider subpixel appearance need browser/screenshot checks. No business/geometry assertion or baseline was loosened; no 1px difference assessed/accepted.
5. ItemFollow was actually a CSS tooltip, not HeroUI. Four families covered: readonly Button, PresenceTags, attachments HeroUI Tooltip, ItemFollow.
6. Public APIs are implemented/unit-tested; isolated browser behaviour remains unverified. No card-move redesign, arrival/chip redesign, NumberRoll business wiring, drawer redesign, previous/next, timeline or presence enter/exit was implemented.
7. No extra unspecified motion, dependency changes, commits/pushes/PRs/branch changes or screenshot approval. No Gate approval inferred.

Rollback is scoped source restoration of this task's edits and new modules/tests/rules; preserve the supplied prototype and failure evidence. No business-data/schema rollback is required. Harness-owned browsers and isolated fixture databases were cleaned; shared PostgreSQL was not stopped/dropped. The task-owned temporary Python venv was removed after tests ([cleanup receipt](checks/cleanup.json)); original failed run records remain preserved. Build is staged, not activated.

Final line-by-line review of section0, baseline differences and A1–A6: A1/A5 source requirements and A3 production exclusion are met; A2/A3/A4 code is present with browser acceptance outstanding; each A6 result/deviation is recorded above. **Browser acceptance is not complete.**
