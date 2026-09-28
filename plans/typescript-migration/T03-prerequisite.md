# T03-01 prerequisite: executable batch gate and explicit review hosts

This is the prerequisite PR, based on merged T02 `7eefaa99591bfaa2e787701efd315ff701c51f35`. The four platform implementations remain MJS. T03-01 starts only after this PR is reviewed and its merge is separately authorized. No deployment or subsequent batch is authorized.

## Interfaces

`npm run migration:gate -- --batch T03-01 --report-dir <external-new-directory>` reads the in-repository batch registry, checks strict types and negative types, builds twice, verifies both artifacts, and actually runs the registered dependency and baseline tests. On PowerShell use `npm.cmd` so npm.ps1 does not consume the forwarded flags. Unknown batches, empty groups, missing routes, incomplete execution and fail/skip/cancel/todo are fatal. Existing types/type-tests/default-canary commands remain distinct from a batch gate.

The report separates automated checks from independent review. A missing test environment leaves behavior NOT_RUN and lists the unexecuted files; a failed test preserves the actual failure and remaining files. Existing report directories are not overwritten.

SOURCE_HOST keeps the real checkout as cwd and reads its source/Schema/history. A verified, development-only Node import hook resolves application imports to the current compiled runtime. It never compiles on demand or falls back to source. STAGED_RUNTIME remains entirely within the runtime tree. The hook is not installed by production startup and accepts no environment-supplied source override. Current strict source CLIs require a completed migration build; missing or stale output is an infrastructure failure, not KNOWN_BASELINE_NOT_READY.

The predecessor verifier accepts an explicit sourceRoot from source-review callers; the original scope, ancestry and evidence checks are unchanged. The runtime observer compares against a clean checkout of the exact T02 merge, never a reconstructed Git graph. G2 source inventory and artifact inventory use separate explicit roots and still reject old approval fingerprints.

## Authorized baseline repairs

The user explicitly authorized separate historical and current outcomes after clean T02 reproduced the SS009 scope failures. Original historical assertions run at PR19 head `41edd855e7bc55149facb6a4b2e0076776c22e66`, with its authoritative base and original CRLF policy. Current SS009 assertions require the exact scope rejection; the current gitignore is checked against merged T02 rather than pretending the frozen earlier bytes are current. Logical MTS/MJS test mapping retains candidate coverage.

P1-003 uses the existing current-baseline migration to prepare its synthetic database, as T02 already did for P1-004. Its original privacy/time assertions and isolated legacy migration tests are retained. P2-012 current-source predecessor rejection is separated from unchanged P2-012 assertions in the fixed P2-016 historical checkout. No frozen SQL, Evidence, tested_head or business Gate is edited.

## Verification and rollback

The registry includes the initial 29 direct and 166 reverse-dependency files, the full personnel baseline and named dynamic/host additions. Tests use isolated loopback PG18, real browser where required, and per-entry Node flags. Missing dependencies cannot become skipped PASS. Current readiness remains non-ready only when exact original public and internal errors match the authentic reference.

Read the exact-head PR/CI results and the accompanying external log archive for completion; this document does not self-certify a future head. Independent review and merge approval remain separate. Rollback is a dedicated revert PR covering tools, routes, source-host adaptations and current-test repairs together; there is no database migration or production activation to roll back.

Browser screenshots and synthetic SS010 state directories live outside the verified runtime tree. SS007 native UI and SS009 capacity files have explicit 900-second whole-file budgets (original case timeouts and serial execution remain unchanged); the runner records the actual budget. Local diagnostic logs include preserved original timeouts and artifact-contamination failures; corrected checks do not erase them.

The existing P2-G1 browser-session test launcher also discovers standard Linux Chrome/Chromium paths, matching the existing test harness. Its loopback restriction, cookies, headless options, telemetry and cleanup remain unchanged; this support-file change does not activate a live script.
