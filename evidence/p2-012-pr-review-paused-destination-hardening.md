# P2-012 paused subscription destination replacement

PASS. Review comment 3951285976; baseline 711269b8780e8edfad3011e78df5e2e6e986c9af.

PAUSED and PENDING_DESTINATION both load the existing nested server-filtered destination chooser before resume. No backend or migration changes.

For each viewport: pause active subscription, expire old Journey, create fresh direct leg for same synthetic Reporter via real orchestrator, offer only fresh leg, submit exactly one POST with both expected versions 2, verify ACTIVE and new leg in PostgreSQL.

The existing browser test first failed without the chooser. All three unchanged viewport cases pass after the UI fix. Full serial regression: 575/575, no failures, skipped, cancelled or todo. No test thresholds, timeouts or scales were weakened. Existing package GC-enabled test convention retained.

All six cleanup counts are zero. P2-G2 remains NOT_STARTED, P2-008 blocked, all persistent flags false; no AI/OCR/RAG or live-send validation was run. Historical live and prior review evidence remains immutable.

Rollback: disable Incident flags; no schema change. Fresh Codex review of the published commit is required before merge.

## Targeted TAP
```text
TAP version 13
# Subtest: P2-012 both parsed OpenAPI documents declare canonical subscription destinations and service failures
ok 1 - P2-012 both parsed OpenAPI documents declare canonical subscription destinations and service failures
  ---
  duration_ms: 584.8779
  type: 'test'
  ...
# Subtest: P2-012 static authorization, frozen predecessors, scope, schemas and synthetic fixture gate
ok 2 - P2-012 static authorization, frozen predecessors, scope, schemas and synthetic fixture gate
  ---
  duration_ms: 2991.1268
  type: 'test'
  ...
# Subtest: P2-012 live runner fails before network/listener unless all five independent fuses and verified evidence exist
ok 3 - P2-012 live runner fails before network/listener unless all five independent fuses and verified evidence exist
  ---
  duration_ms: 0.9787
  type: 'test'
  ...
# Subtest: P2-012 readiness cannot be fabricated from partial regression, skips, changed inputs or live claims
ok 4 - P2-012 readiness cannot be fabricated from partial regression, skips, changed inputs or live claims
  ---
  duration_ms: 0.248
  type: 'test'
  ...
# Subtest: P2-012 DONE requires the approved live candidate, client confirmation, clean Incident deliveries and complete regressions
ok 5 - P2-012 DONE requires the approved live candidate, client confirmation, clean Incident deliveries and complete regressions
  ---
  duration_ms: 0.2274
  type: 'test'
  ...
# Subtest: P2-012 frozen candidate permits only the explicit closeout governance set
ok 6 - P2-012 frozen candidate permits only the explicit closeout governance set
  ---
  duration_ms: 0.215
  type: 'test'
  ...
# Subtest: P2-012 review hardening preserves exact paths and requires independent current regression evidence
ok 7 - P2-012 review hardening preserves exact paths and requires independent current regression evidence
  ---
  duration_ms: 0.2729
  type: 'test'
  ...
# Subtest: P2-012 v2 HTTP OpenAPI hardening has an independent closed allowlist and complete regression gate
ok 8 - P2-012 v2 HTTP OpenAPI hardening has an independent closed allowlist and complete regression gate
  ---
  duration_ms: 0.3014
  type: 'test'
  ...
# Subtest: P2-012 subscription review preserves its baseline, scope and independent regression
ok 9 - P2-012 subscription review preserves its baseline, scope and independent regression
  ---
  duration_ms: 0.2782
  type: 'test'
  ...
# Subtest: P2-012 paused destination review is bounded and preserves previous full regression evidence
ok 10 - P2-012 paused destination review is bounded and preserves previous full regression evidence
  ---
  duration_ms: 0.3046
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 1440x900 human confirmation, refresh and accessibility
ok 11 - P2-012 database-backed browser 1440x900 human confirmation, refresh and accessibility
  ---
  duration_ms: 7094.7836
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 1366x768 human confirmation, refresh and accessibility
ok 12 - P2-012 database-backed browser 1366x768 human confirmation, refresh and accessibility
  ---
  duration_ms: 9349.9292
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 390x844 human confirmation, refresh and accessibility
ok 13 - P2-012 database-backed browser 390x844 human confirmation, refresh and accessibility
  ---
  duration_ms: 7693.4551
  type: 'test'
  ...
# Subtest: P2-012 actual HTTP inherits authentication, CSRF, command fence and durable realtime
ok 14 - P2-012 actual HTTP inherits authentication, CSRF, command fence and durable realtime
  ---
  duration_ms: 2835.0279
  type: 'test'
  ...
# Subtest: P2-012 actual HTTP preserves notification failure, rollback and durable replay before explicit recovery
ok 15 - P2-012 actual HTTP preserves notification failure, rollback and durable replay before explicit recovery
  ---
  duration_ms: 4119.359
  type: 'test'
  ...
1..15
# tests 15
# suites 0
# pass 15
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 36477.7005

```

## Full serial TAP
```text
TAP version 13
# Subtest: ARCH-005 architecture validator freezes migrations and reports all hard static counts at zero
ok 1 - ARCH-005 architecture validator freezes migrations and reports all hard static counts at zero
  ---
  duration_ms: 141.7099
  type: 'test'
  ...
# Subtest: P2-007 and its authorized P2-015 successor keep the frozen ARCH-005 contract
ok 2 - P2-007 and its authorized P2-015 successor keep the frozen ARCH-005 contract
  ---
  duration_ms: 2.7309
  type: 'test'
  ...
# Subtest: existing 001-021 database passes 022 check rollback, apply, forbidden-zero, and repeat no-op
ok 3 - existing 001-021 database passes 022 check rollback, apply, forbidden-zero, and repeat no-op
  ---
  duration_ms: 2693.8881
  type: 'test'
  ...
# Subtest: fresh database executes 001-021-022 through the current-baseline entrypoint
ok 4 - fresh database executes 001-021-022 through the current-baseline entrypoint
  ---
  duration_ms: 1570.8
  type: 'test'
  ...
# Subtest: ARCH-006 validator passes
ok 5 - ARCH-006 validator passes
  ---
  duration_ms: 162.905
  type: 'test'
  ...
# Subtest: machine state preserves ARCH-006 facts and separately authorized P2-015/P2-016 successor lifecycles
ok 6 - machine state preserves ARCH-006 facts and separately authorized P2-015/P2-016 successor lifecycles
  ---
  duration_ms: 1.8832
  type: 'test'
  ...
# Subtest: ten safe deterministic results are first-class and Manual Review is valid
ok 7 - ten safe deterministic results are first-class and Manual Review is valid
  ---
  duration_ms: 0.8553
  type: 'test'
  ...
# Subtest: Ticket lifecycle reuses authoritative actions and reliable notification boundary
ok 8 - Ticket lifecycle reuses authoritative actions and reliable notification boundary
  ---
  duration_ms: 0.7183
  type: 'test'
  ...
# Subtest: Incident remains human-confirmed and AI-independent
ok 9 - Incident remains human-confirmed and AI-independent
  ---
  duration_ms: 0.583
  type: 'test'
  ...
# Subtest: AI-off readiness and feature flags are closed by default
ok 10 - AI-off readiness and feature flags are closed by default
  ---
  duration_ms: 1.8151
  type: 'test'
  ...
# Subtest: configuration preserves G0 boundaries and substitutes only the invalid test secret
ok 11 - configuration preserves G0 boundaries and substitutes only the invalid test secret
  ---
  duration_ms: 1.7057
  type: 'test'
  ...
# Subtest: redaction and error mapping do not expose a configured secret
ok 12 - redaction and error mapping do not expose a configured secret
  ---
  duration_ms: 0.5775
  type: 'test'
  ...
# Subtest: the connection stability window is bounded and explicit
ok 13 - the connection stability window is bounded and explicit
  ---
  duration_ms: 0.202
  type: 'test'
  ...
# Subtest: authenticated probe starts shutdown by SIGTERM and calls disconnect before completion
ok 14 - authenticated probe starts shutdown by SIGTERM and calls disconnect before completion
  ---
  duration_ms: 3.623
  type: 'test'
  ...
# Subtest: text frame capture records only the permitted, desensitized shape
ok 15 - text frame capture records only the permitted, desensitized shape
  ---
  duration_ms: 1.4896
  type: 'test'
  ...
# Subtest: capture arguments require a named scenario and an evidence jsonl target
ok 16 - capture arguments require a named scenario and an evidence jsonl target
  ---
  duration_ms: 0.4648
  type: 'test'
  ...
# Subtest: media capture records only desensitized frame, download, and filename metadata
ok 17 - media capture records only desensitized frame, download, and filename metadata
  ---
  duration_ms: 2.1363
  type: 'test'
  ...
# Subtest: media capture arguments restrict scenarios, evidence output, and aes key modes
ok 18 - media capture arguments restrict scenarios, evidence output, and aes key modes
  ---
  duration_ms: 1.3657
  type: 'test'
  ...
# Subtest: voice capture retains only safe transcript metadata and does not download media
ok 19 - voice capture retains only safe transcript metadata and does not download media
  ---
  duration_ms: 0.2964
  type: 'test'
  ...
# Subtest: video capture reuses encrypted download evidence without exposing media references
ok 20 - video capture reuses encrypted download evidence without exposing media references
  ---
  duration_ms: 0.3282
  type: 'test'
  ...
# Subtest: download evidence maps decrypt failures and local deadline without leaking error details
ok 21 - download evidence maps decrypt failures and local deadline without leaking error details
  ---
  duration_ms: 4.2849
  type: 'test'
  ...
# Subtest: push arguments restrict scenario, timing, repeat and evidence output
ok 22 - push arguments restrict scenario, timing, repeat and evidence output
  ---
  duration_ms: 0.9005
  type: 'test'
  ...
# Subtest: direct push uses userid in memory but records only desensitized delivery evidence
ok 23 - direct push uses userid in memory but records only desensitized delivery evidence
  ---
  duration_ms: 2.4093
  type: 'test'
  ...
# Subtest: group mention mode is opt-in and invalid chatid rejection keeps SDK error text out of evidence
ok 24 - group mention mode is opt-in and invalid chatid rejection keeps SDK error text out of evidence
  ---
  duration_ms: 0.5756
  type: 'test'
  ...
# Subtest: group markdown-then-text mention probe sends two ordered bodies and treats only the text probe rejection as a valid result
ok 25 - group markdown-then-text mention probe sends two ordered bodies and treats only the text probe rejection as a valid result
  ---
  duration_ms: 0.4353
  type: 'test'
  ...
# Subtest: group mention arguments restrict timeout, trigger token and evidence output
ok 26 - group mention arguments restrict timeout, trigger token and evidence output
  ---
  duration_ms: 0.9586
  type: 'test'
  ...
# Subtest: group mention reply uses passive text syntax with the current callback sender
ok 27 - group mention reply uses passive text syntax with the current callback sender
  ---
  duration_ms: 0.9575
  type: 'test'
  ...
# Subtest: stream reply uses the same passive mention syntax in a finished SDK-supported stream body
ok 28 - stream reply uses the same passive mention syntax in a finished SDK-supported stream body
  ---
  duration_ms: 0.1252
  type: 'test'
  ...
# Subtest: acknowledged group reply reuses the triggering frame and records only hashes and field shape
ok 29 - acknowledged group reply reuses the triggering frame and records only hashes and field shape
  ---
  duration_ms: 2.2189
  type: 'test'
  ...
# Subtest: probe ignores non-group and wrong-token messages before handling the matching group callback
ok 30 - probe ignores non-group and wrong-token messages before handling the matching group callback
  ---
  duration_ms: 0.2962
  type: 'test'
  ...
# Subtest: provider rejection is a completed negative capability result and excludes SDK error text
ok 31 - provider rejection is a completed negative capability result and excludes SDK error text
  ---
  duration_ms: 0.4253
  type: 'test'
  ...
# Subtest: capture builder never serializes raw callback or reply values
ok 32 - capture builder never serializes raw callback or reply values
  ---
  duration_ms: 0.2034
  type: 'test'
  ...
# Subtest: card arguments enforce local evidence, trigger chat type, and the five-second late boundary
ok 33 - card arguments enforce local evidence, trigger chat type, and the five-second late boundary
  ---
  duration_ms: 1.1023
  type: 'test'
  ...
# Subtest: card shape has a unique caller-owned task id and both required actions
ok 34 - card shape has a unique caller-owned task id and both required actions
  ---
  duration_ms: 1.0929
  type: 'test'
  ...
# Subtest: fast button event updates the matching task id within five seconds without persisting raw input
ok 35 - fast button event updates the matching task id within five seconds without persisting raw input
  ---
  duration_ms: 4.5362
  type: 'test'
  ...
# Subtest: duplicate mode records the second same-user same-action callback and preserves buttons until then
ok 36 - duplicate mode records the second same-user same-action callback and preserves buttons until then
  ---
  duration_ms: 0.9589
  type: 'test'
  ...
# Subtest: late mode calls update after the limit and records a platform rejection as an explicit expired-behavior result
ok 37 - late mode calls update after the limit and records a platform rejection as an explicit expired-behavior result
  ---
  duration_ms: 0.9025
  type: 'test'
  ...
# Subtest: a task-id mismatch is safely recorded with field names and hashes but never updates a foreign card
ok 38 - a task-id mismatch is safely recorded with field names and hashes but never updates a foreign card
  ---
  duration_ms: 0.784
  type: 'test'
  ...
# Subtest: reply arguments only accept registered scenarios and evidence output paths
ok 39 - reply arguments only accept registered scenarios and evidence output paths
  ---
  duration_ms: 1.4468
  type: 'test'
  ...
# Subtest: welcome, Markdown, stream, and media builders use the documented reply forms
ok 40 - welcome, Markdown, stream, and media builders use the documented reply forms
  ---
  duration_ms: 2.785
  type: 'test'
  ...
# Subtest: welcome replies accept an enter_chat event even when its chattype is omitted
ok 41 - welcome replies accept an enter_chat event even when its chattype is omitted
  ---
  duration_ms: 1.6832
  type: 'test'
  ...
# Subtest: stream refresh reuses one callback and stream id, then omits the body for matching feedback
ok 42 - stream refresh reuses one callback and stream id, then omits the body for matching feedback
  ---
  duration_ms: 3.7374
  type: 'test'
  ...
# Subtest: Markdown reply is callback-bound and never serializes trigger text or identifiers
ok 43 - Markdown reply is callback-bound and never serializes trigger text or identifiers
  ---
  duration_ms: 0.3421
  type: 'test'
  ...
# Subtest: file, image, and voice upload then reply through the callback-bound media interface
ok 44 - file, image, and voice upload then reply through the callback-bound media interface
  ---
  duration_ms: 1.053
  type: 'test'
  ...
# Subtest: video echo downloads only in memory, reuploads with a safe filename, and replies with title and description
ok 45 - video echo downloads only in memory, reuploads with a safe filename, and replies with title and description
  ---
  duration_ms: 0.651
  type: 'test'
  ...
# Subtest: provider rejection has a stable classification without recording provider error text
ok 46 - provider rejection has a stable classification without recording provider error text
  ---
  duration_ms: 0.3482
  type: 'test'
  ...
# Subtest: feedback empty-reply rejection is a completed negative capability result
ok 47 - feedback empty-reply rejection is a completed negative capability result
  ---
  duration_ms: 2.1051
  type: 'test'
  ...
# Subtest: G0-007 defaults to a 4 hour 30 minute Windows-native soak and keeps Phase boundaries
ok 48 - G0-007 defaults to a 4 hour 30 minute Windows-native soak and keeps Phase boundaries
  ---
  duration_ms: 1.3449
  type: 'test'
  ...
# Subtest: run id is opaque and deterministic under an injected clock
ok 49 - run id is opaque and deterministic under an injected clock
  ---
  duration_ms: 0.1532
  type: 'test'
  ...
# Subtest: reconnect recovery, resource samples, and message replay stay content-free
ok 50 - reconnect recovery, resource samples, and message replay stay content-free
  ---
  duration_ms: 1.6387
  type: 'test'
  ...
# Subtest: a completed requested soak does not satisfy the 4 hour 30 minute Gate duration when shortened
ok 51 - a completed requested soak does not satisfy the 4 hour 30 minute Gate duration when shortened
  ---
  duration_ms: 0.3193
  type: 'test'
  ...
# Subtest: G0-008 closure preserves completed Gate 0 and P1 facts independently of the moving P2 frontier
ok 52 - G0-008 closure preserves completed Gate 0 and P1 facts independently of the moving P2 frontier
  ---
  duration_ms: 4.1471
  type: 'test'
  ...
# Subtest: G0-008 report covers every completed Gate 0 evidence source and retains limits
ok 53 - G0-008 report covers every completed Gate 0 evidence source and retains limits
  ---
  duration_ms: 4.6739
  type: 'test'
  ...
# Subtest: the capability-freeze ADR is accepted and does not skip P1-001
ok 54 - the capability-freeze ADR is accepted and does not skip P1-001
  ---
  duration_ms: 1.5462
  type: 'test'
  ...
# Subtest: the documented 512 KiB plan covers 3,920,958 bytes in eight ordered chunks
ok 55 - the documented 512 KiB plan covers 3,920,958 bytes in eight ordered chunks
  ---
  duration_ms: 1.6879
  type: 'test'
  ...
# Subtest: test-only padding creates an exact target-sized MP4 without retaining an original filename
ok 56 - test-only padding creates an exact target-sized MP4 without retaining an original filename
  ---
  duration_ms: 0.5319
  type: 'test'
  ...
# Subtest: layered upload sends init, every serial chunk, and finish with fresh request IDs
ok 57 - layered upload sends init, every serial chunk, and finish with fresh request IDs
  ---
  duration_ms: 32.6135
  type: 'test'
  ...
# Subtest: a rejected chunk prevents finish and returns an explicit stage result
ok 58 - a rejected chunk prevents finish and returns an explicit stage result
  ---
  duration_ms: 2.6431
  type: 'test'
  ...
# Subtest: the probe downloads in memory, completes the layer sequence, then issues one callback-bound reply
ok 59 - the probe downloads in memory, completes the layer sequence, then issues one callback-bound reply
  ---
  duration_ms: 4.3626
  type: 'test'
  ...
# Subtest: arguments remain restricted to the G0 evidence directory and 10 MiB provider limit
ok 60 - arguments remain restricted to the G0 evidence directory and 10 MiB provider limit
  ---
  duration_ms: 0.4795
  type: 'test'
  ...
# Subtest: validates and redacts a Webhook URL without exposing its key
ok 61 - validates and redacts a Webhook URL without exposing its key
  ---
  duration_ms: 0.7718
  type: 'test'
  ...
# Subtest: builds the documented text, markdown, media, news, and card payload forms
ok 62 - builds the documented text, markdown, media, news, and card payload forms
  ---
  duration_ms: 1.3992
  type: 'test'
  ...
# Subtest: creates bounded in-memory image, file, and AMR fixtures and documented multipart headers
ok 63 - creates bounded in-memory image, file, and AMR fixtures and documented multipart headers
  ---
  duration_ms: 0.5359
  type: 'test'
  ...
# Subtest: records only safe live-probe evidence when every provider reply is accepted
ok 64 - records only safe live-probe evidence when every provider reply is accepted
  ---
  duration_ms: 32.1876
  type: 'test'
  ...
# Subtest: P1 configuration accepts Pilot-only dependencies and produces a secret-free summary
ok 65 - P1 configuration accepts Pilot-only dependencies and produces a secret-free summary
  ---
  duration_ms: 1.5158
  type: 'test'
  ...
# Subtest: P1 configuration rejects missing, cross-phase, and unapproved public-edge settings
ok 66 - P1 configuration rejects missing, cross-phase, and unapproved public-edge settings
  ---
  duration_ms: 0.5119
  type: 'test'
  ...
# Subtest: preflight output and CLI options do not expose configuration secrets
ok 67 - preflight output and CLI options do not expose configuration secrets
  ---
  duration_ms: 0.3394
  type: 'test'
  ...
# Subtest: the Pilot foundation health endpoint starts and stops without business routes
ok 68 - the Pilot foundation health endpoint starts and stops without business routes
  ---
  duration_ms: 35.0787
  type: 'test'
  ...
# Subtest: text Frame becomes an SDK-independent normalized message
ok 69 - text Frame becomes an SDK-independent normalized message
  ---
  duration_ms: 7.6477
  type: 'test'
  ...
# Subtest: image Frame exposes only an opaque media download reference
ok 70 - image Frame exposes only an opaque media download reference
  ---
  duration_ms: 0.5975
  type: 'test'
  ...
# Subtest: mixed Frame preserves text and image ordering in one normalized message
ok 71 - mixed Frame preserves text and image ordering in one normalized message
  ---
  duration_ms: 0.3375
  type: 'test'
  ...
# Subtest: replayed Frame keeps one durable idempotency key without Adapter-side dropping
ok 72 - replayed Frame keeps one durable idempotency key without Adapter-side dropping
  ---
  duration_ms: 0.2034
  type: 'test'
  ...
# Subtest: illegal Frame returns a stable, non-retryable and secret-free error
ok 73 - illegal Frame returns a stable, non-retryable and secret-free error
  ---
  duration_ms: 0.13
  type: 'test'
  ...
# Subtest: invalid Adapter receive time returns a stable error instead of throwing
ok 74 - invalid Adapter receive time returns a stable error instead of throwing
  ---
  duration_ms: 0.1411
  type: 'test'
  ...
# Subtest: text that exceeds the contract only after normalization fails closed
ok 75 - text that exceeds the contract only after normalization fails closed
  ---
  duration_ms: 0.5052
  type: 'test'
  ...
# Subtest: text incompatible with the Phase 1 PostgreSQL boundary fails closed
ok 76 - text incompatible with the Phase 1 PostgreSQL boundary fails closed
  ---
  duration_ms: 0.1428
  type: 'test'
  ...
# Subtest: non-message callback bodies are classified as unsupported before message-only fields
ok 77 - non-message callback bodies are classified as unsupported before message-only fields
  ---
  duration_ms: 0.1216
  type: 'test'
  ...
# Subtest: Frame envelope, identity and content validation use stable reasons
ok 78 - Frame envelope, identity and content validation use stable reasons
  ---
  duration_ms: 0.3943
  type: 'test'
  ...
# Subtest: Normalized Message JSON Schema matches the Adapter interface and excludes SDK secrets
ok 79 - Normalized Message JSON Schema matches the Adapter interface and excludes SDK secrets
  ---
  duration_ms: 1.4757
  type: 'test'
  ...
# Subtest: quoted text from the recorded Gate 0 shape is preserved without raw SDK fields
ok 80 - quoted text from the recorded Gate 0 shape is preserved without raw SDK fields
  ---
  duration_ms: 0.2
  type: 'test'
  ...
# Subtest: Gate 0 verified file, voice and video Frames use the same normalized seam
ok 81 - Gate 0 verified file, voice and video Frames use the same normalized seam
  ---
  duration_ms: 0.3131
  type: 'test'
  ...
# Subtest: quoted media keeps an independent opaque reference
ok 82 - quoted media keeps an independent opaque reference
  ---
  duration_ms: 0.1673
  type: 'test'
  ...
# Subtest: persists one Channel Message and returns the original result on replay
ok 83 - persists one Channel Message and returns the original result on replay
  ---
  duration_ms: 129.2241
  type: 'test'
  ...
# Subtest: snapshots validated input before connection acquisition
ok 84 - snapshots validated input before connection acquisition
  ---
  duration_ms: 6.0858
  type: 'test'
  ...
# Subtest: concurrent duplicates execute first processing exactly once
ok 85 - concurrent duplicates execute first processing exactly once
  ---
  duration_ms: 123.4458
  type: 'test'
  ...
# Subtest: first-processing failure rolls back the Inbox row and permits a clean retry
ok 86 - first-processing failure rolls back the Inbox row and permits a clean retry
  ---
  duration_ms: 9.2664
  type: 'test'
  ...
# Subtest: non-plain processing result roots fail as processing errors
ok 87 - non-plain processing result roots fail as processing errors
  ---
  duration_ms: 11.1644
  type: 'test'
  ...
# Subtest: processing result snapshot rejects nested non-JSON runtime objects
ok 88 - processing result snapshot rejects nested non-JSON runtime objects
  ---
  duration_ms: 4.7884
  type: 'test'
  ...
# Subtest: processing result validation never executes toJSON hooks
ok 89 - processing result validation never executes toJSON hooks
  ---
  duration_ms: 3.525
  type: 'test'
  ...
# Subtest: processing result validation rejects Proxy toJSON substitution without executing it
ok 90 - processing result validation rejects Proxy toJSON substitution without executing it
  ---
  duration_ms: 3.1208
  type: 'test'
  ...
# Subtest: inherited toJSON pollution cannot transform an otherwise plain result
ok 91 - inherited toJSON pollution cannot transform an otherwise plain result
  ---
  duration_ms: 4.4101
  type: 'test'
  ...
# Subtest: processing result snapshot accepts nested plain JSON arrays
ok 92 - processing result snapshot accepts nested plain JSON arrays
  ---
  duration_ms: 4.6087
  type: 'test'
  ...
# Subtest: first-processing callback cannot commit the Inbox transaction early
ok 93 - first-processing callback cannot commit the Inbox transaction early
  ---
  duration_ms: 3.8631
  type: 'test'
  ...
# Subtest: first-processing callback cannot change Inbox transaction characteristics
ok 94 - first-processing callback cannot change Inbox transaction characteristics
  ---
  duration_ms: 3.9059
  type: 'test'
  ...
# Subtest: comment-obfuscated transaction control remains blocked
ok 95 - comment-obfuscated transaction control remains blocked
  ---
  duration_ms: 3.8611
  type: 'test'
  ...
# Subtest: SET LOCAL cannot change the Inbox-owned transaction
ok 96 - SET LOCAL cannot change the Inbox-owned transaction
  ---
  duration_ms: 3.9487
  type: 'test'
  ...
# Subtest: session defaults cannot poison a pooled connection after Inbox commit
ok 97 - session defaults cannot poison a pooled connection after Inbox commit
  ---
  duration_ms: 43.1982
  type: 'test'
  ...
# Subtest: function-based session configuration is rejected before pooled connection reuse
ok 98 - function-based session configuration is rejected before pooled connection reuse
  ---
  duration_ms: 160.2053
  type: 'test'
  ...
# Subtest: ordinary Inbox use preserves caller-owned pool session baselines
ok 99 - ordinary Inbox use preserves caller-owned pool session baselines
  ---
  duration_ms: 44.5767
  type: 'test'
  ...
# Subtest: callback-style transaction queries are rejected before PostgreSQL execution
ok 100 - callback-style transaction queries are rejected before PostgreSQL execution
  ---
  duration_ms: 5.7574
  type: 'test'
  ...
# Subtest: unawaited transaction query failure remains a processing failure
ok 101 - unawaited transaction query failure remains a processing failure
  ---
  duration_ms: 9.2752
  type: 'test'
  ...
# Subtest: transaction view is revoked when first processing settles
ok 102 - transaction view is revoked when first processing settles
  ---
  duration_ms: 4.6963
  type: 'test'
  ...
# Subtest: a duplicate after a real process restart receives the committed result
ok 103 - a duplicate after a real process restart receives the committed result
  ---
  duration_ms: 385.4173
  type: 'test'
  ...
# Subtest: temporary database unavailability returns a stable retryable error without processing
ok 104 - temporary database unavailability returns a stable retryable error without processing
  ---
  duration_ms: 2.0466
  type: 'test'
  ...
# Subtest: invalid privacy, retention, plaintext payload and non-contract message fields fail before database access
ok 105 - invalid privacy, retention, plaintext payload and non-contract message fields fail before database access
  ---
  duration_ms: 0.9809
  type: 'test'
  ...
# Subtest: privacy, retention and caller-encrypted raw payload are persisted without entering the result
ok 106 - privacy, retention and caller-encrypted raw payload are persisted without entering the result
  ---
  duration_ms: 6.7813
  type: 'test'
  ...
# Subtest: migration fails closed when an existing Inbox lacks required constraints
ok 107 - migration fails closed when an existing Inbox lacks required constraints
  ---
  duration_ms: 415.012
  type: 'test'
  ...
# Subtest: migration reports the stable drift error before indexing a table with missing columns
ok 108 - migration reports the stable drift error before indexing a table with missing columns
  ---
  duration_ms: 293.4255
  type: 'test'
  ...
# Subtest: migration rejects a weakened check constraint that keeps the expected name
ok 109 - migration rejects a weakened check constraint that keeps the expected name
  ---
  duration_ms: 431.013
  type: 'test'
  ...
# Subtest: migration rejects a deferrable idempotency constraint unusable by ON CONFLICT
ok 110 - migration rejects a deferrable idempotency constraint unusable by ON CONFLICT
  ---
  duration_ms: 307.2743
  type: 'test'
  ...
# Subtest: migration rejects a deferrable primary key unusable by later foreign keys
ok 111 - migration rejects a deferrable primary key unusable by later foreign keys
  ---
  duration_ms: 309.0035
  type: 'test'
  ...
# Subtest: migration rejects a same-name hash index that cannot serve retention range scans
ok 112 - migration rejects a same-name hash index that cannot serve retention range scans
  ---
  duration_ms: 305.1173
  type: 'test'
  ...
# Subtest: migration rejects an extra check constraint outside the frozen set
ok 113 - migration rejects an extra check constraint outside the frozen set
  ---
  duration_ms: 370.1642
  type: 'test'
  ...
# Subtest: migration rejects an extra unique constraint that changes write semantics
ok 114 - migration rejects an extra unique constraint that changes write semantics
  ---
  duration_ms: 417.5483
  type: 'test'
  ...
# Subtest: migration rejects a generated column that breaks explicit Inbox writes
ok 115 - migration rejects a generated column that breaks explicit Inbox writes
  ---
  duration_ms: 443.0623
  type: 'test'
  ...
# Subtest: migration is reentrant when the existing Inbox matches the frozen catalog
ok 116 - migration is reentrant when the existing Inbox matches the frozen catalog
  ---
  duration_ms: 463.8014
  type: 'test'
  ...
# Subtest: migration is limited to the P1-003 Channel Inbox and freezes the database constraints
ok 117 - migration is limited to the P1-003 Channel Inbox and freezes the database constraints
  ---
  duration_ms: 0.8681
  type: 'test'
  ...
# Subtest: creates one Service Intake, primary message relation and received audit event
ok 118 - creates one Service Intake, primary message relation and received audit event
  ---
  duration_ms: 181.5441
  type: 'test'
  ...
# Subtest: aggregates multiple supplements into one Intake without creating a Ticket
ok 119 - aggregates multiple supplements into one Intake without creating a Ticket
  ---
  duration_ms: 34.781
  type: 'test'
  ...
# Subtest: explicit new-report intent starts a new Intake inside the 90-second window
ok 120 - explicit new-report intent starts a new Intake inside the 90-second window
  ---
  duration_ms: 15.5747
  type: 'test'
  ...
# Subtest: an explicit reference to another ticket closes the current aggregation window
ok 121 - an explicit reference to another ticket closes the current aggregation window
  ---
  duration_ms: 35.6941
  type: 'test'
  ...
# Subtest: pure image creates a waiting Intake and emits a clarification audit event
ok 122 - pure image creates a waiting Intake and emits a clarification audit event
  ---
  duration_ms: 10.1162
  type: 'test'
  ...
# Subtest: a description clarifies the waiting image Intake instead of creating another Intake
ok 123 - a description clarifies the waiting image Intake instead of creating another Intake
  ---
  duration_ms: 16.7504
  type: 'test'
  ...
# Subtest: concurrent distinct messages in one context aggregate into exactly one Intake
ok 124 - concurrent distinct messages in one context aggregate into exactly one Intake
  ---
  duration_ms: 160.8867
  type: 'test'
  ...
# Subtest: reversed lock acquisition still aggregates bounded timestamp inversion and preserves valid update time
ok 125 - reversed lock acquisition still aggregates bounded timestamp inversion and preserves valid update time
  ---
  duration_ms: 20.769
  type: 'test'
  ...
# Subtest: reversed lock acquisition never crosses an explicit new-context boundary
ok 126 - reversed lock acquisition never crosses an explicit new-context boundary
  ---
  duration_ms: 58.2445
  type: 'test'
  ...
# Subtest: classifies the documented request types without AI and honors incident negation
ok 127 - classifies the documented request types without AI and honors incident negation
  ---
  duration_ms: 97.2205
  type: 'test'
  ...
# Subtest: standalone thanks is CHATTER without an unnecessary clarification request
ok 128 - standalone thanks is CHATTER without an unnecessary clarification request
  ---
  duration_ms: 6.6787
  type: 'test'
  ...
# Subtest: aggregate privacy is strongest, retention is earliest, and Inbox snapshots contain no report summary
ok 129 - aggregate privacy is strongest, retention is earliest, and Inbox snapshots contain no report summary
  ---
  duration_ms: 17.5763
  type: 'test'
  ...
# Subtest: includes exactly 90 seconds and starts a new Intake after the window
ok 130 - includes exactly 90 seconds and starts a new Intake after the window
  ---
  duration_ms: 29.0679
  type: 'test'
  ...
# Subtest: different senders and conversations stay separate while direct chat maps to WECOM_DIRECT
ok 131 - different senders and conversations stay separate while direct chat maps to WECOM_DIRECT
  ---
  duration_ms: 20.6159
  type: 'test'
  ...
# Subtest: Channel Message replay returns the original Intake result without duplicate relations or events
ok 132 - Channel Message replay returns the original Intake result without duplicate relations or events
  ---
  duration_ms: 10.4833
  type: 'test'
  ...
# Subtest: downstream failure rolls back Channel Message, Intake, relations and events before a clean retry
ok 133 - downstream failure rolls back Channel Message, Intake, relations and events before a clean retry
  ---
  duration_ms: 14.6987
  type: 'test'
  ...
# Subtest: migration fails closed on legacy Inbox summaries and upgrades pre-redacted aggregates
ok 134 - migration fails closed on legacy Inbox summaries and upgrades pre-redacted aggregates
  ---
  duration_ms: 301.5127
  type: 'test'
  ...
# Subtest: migration runner exposes only the exact legacy-remediation failure as non-retryable
ok 135 - migration runner exposes only the exact legacy-remediation failure as non-retryable
  ---
  duration_ms: 0.3616
  type: 'test'
  ...
# Subtest: migration is limited to Service Intake, message relations and Intake audit events
ok 136 - migration is limited to Service Intake, message relations and Intake audit events
  ---
  duration_ms: 1.9385
  type: 'test'
  ...
# Subtest: Service Intake JSON Schema freezes the domain boundary and P1-004 version semantics
ok 137 - Service Intake JSON Schema freezes the domain boundary and P1-004 version semantics
  ---
  duration_ms: 0.6402
  type: 'test'
  ...
# Subtest: Service Intake migration is re-entrant
ok 138 - Service Intake migration is re-entrant
  ---
  duration_ms: 3.8022
  type: 'test'
  ...
# Subtest: invalid aggregation windows fail before a processor can access a transaction
ok 139 - invalid aggregation windows fail before a processor can access a transaction
  ---
  duration_ms: 0.4968
  type: 'test'
  ...
# Subtest: an explicit report creates one idempotent Pilot Ticket without AI or Hospital Tickets
ok 140 - an explicit report creates one idempotent Pilot Ticket without AI or Hospital Tickets
  ---
  duration_ms: 111.0707
  type: 'test'
  ...
# Subtest: a downstream failure rolls back the Intake-to-Ticket relationship before retry
ok 141 - a downstream failure rolls back the Intake-to-Ticket relationship before retry
  ---
  duration_ms: 22.2441
  type: 'test'
  ...
# Subtest: a Ticket number collision fails explicitly and leaves the second Intake unlinked
ok 142 - a Ticket number collision fails explicitly and leaves the second Intake unlinked
  ---
  duration_ms: 25.0243
  type: 'test'
  ...
# Subtest: the database rejects a Ticket when its source Intake does not point back to it
ok 143 - the database rejects a Ticket when its source Intake does not point back to it
  ---
  duration_ms: 11.2356
  type: 'test'
  ...
# Subtest: explicit Ticket Actions enforce legal transitions, versions, and an ordered audit timeline
ok 144 - explicit Ticket Actions enforce legal transitions, versions, and an ordered audit timeline
  ---
  duration_ms: 131.3569
  type: 'test'
  ...
# Subtest: concurrent handlers cannot both accept the same queued Ticket
ok 145 - concurrent handlers cannot both accept the same queued Ticket
  ---
  duration_ms: 45.9091
  type: 'test'
  ...
# Subtest: Phase 1 rejects an Incident-link action until the Phase 2 Incident fact exists
ok 146 - Phase 1 rejects an Incident-link action until the Phase 2 Incident fact exists
  ---
  duration_ms: 39.0151
  type: 'test'
  ...
# Subtest: state, Ticket Event, Outbox, and target deliveries commit together while delivery failures retry independently
ok 147 - state, Ticket Event, Outbox, and target deliveries commit together while delivery failures retry independently
  ---
  duration_ms: 178.8593
  type: 'test'
  ...
# Subtest: a leased Delivery is not sent twice by concurrent Workers and terminal failures become dead letters
ok 148 - a leased Delivery is not sent twice by concurrent Workers and terminal failures become dead letters
  ---
  duration_ms: 58.9772
  type: 'test'
  ...
# Subtest: an Outbox failure rolls back the Ticket state and its Ticket Event
ok 149 - an Outbox failure rolls back the Ticket state and its Ticket Event
  ---
  duration_ms: 14.2472
  type: 'test'
  ...
# Subtest: the default notification matrix keeps internal notes off reporter delivery and the Worker rate-limits each target
ok 150 - the default notification matrix keeps internal notes off reporter delivery and the Worker rate-limits each target
  ---
  duration_ms: 74.0615
  type: 'test'
  ...
# Subtest: first acknowledgement is sent only after commit and a reconnect replay does not create or send twice
ok 151 - first acknowledgement is sent only after commit and a reconnect replay does not create or send twice
  ---
  duration_ms: 108.8593
  type: 'test'
  ...
# Subtest: temporary delivery failure preserves a real Ticket for retry, while a non-report never fabricates a Ticket number
ok 152 - temporary delivery failure preserves a real Ticket for retry, while a non-report never fabricates a Ticket number
  ---
  duration_ms: 32.8178
  type: 'test'
  ...
# Subtest: Pilot roles isolate teams, enable audited handling, and keep internal notes out of reporter views
ok 153 - Pilot roles isolate teams, enable audited handling, and keep internal notes out of reporter views
  ---
  duration_ms: 147.1593
  type: 'test'
  ...
# Subtest: the minimum local Pilot workbench exposes an injected authenticated mobile-friendly work view
ok 154 - the minimum local Pilot workbench exposes an injected authenticated mobile-friendly work view
  ---
  duration_ms: 50.3748
  type: 'test'
  ...
# Subtest: supplement, card confirmation, duplicate card protection, close, and reopen preserve a real Ticket lifecycle
ok 155 - supplement, card confirmation, duplicate card protection, close, and reopen preserve a real Ticket lifecycle
  ---
  duration_ms: 225.4867
  type: 'test'
  ...
# Subtest: the complete lifecycle processor exposes created delivery ids for post-commit acknowledgement
ok 156 - the complete lifecycle processor exposes created delivery ids for post-commit acknowledgement
  ---
  duration_ms: 16.3586
  type: 'test'
  ...
# Subtest: expired cards do not mutate Tickets and resolved Tickets close automatically with an explicit non-user reason
ok 157 - expired cards do not mutate Tickets and resolved Tickets close automatically with an explicit non-user reason
  ---
  duration_ms: 39.1112
  type: 'test'
  ...
# Subtest: P1-011 parses only explicit backup drill modes and keeps credentials out of utility arguments
ok 158 - P1-011 parses only explicit backup drill modes and keeps credentials out of utility arguments
  ---
  duration_ms: 1.6737
  type: 'test'
  ...
# Subtest: P1-011 backup check validates controls without writing credential or encryption-key values
ok 159 - P1-011 backup check validates controls without writing credential or encryption-key values
  ---
  duration_ms: 111.9415
  type: 'test'
  ...
# Subtest: P1-011 emits a fixed restore alert and failure context when a drill cannot start
ok 160 - P1-011 emits a fixed restore alert and failure context when a drill cannot start
  ---
  duration_ms: 13.2719
  type: 'test'
  ...
# Subtest: P1-011 keeps a logical backup encrypted at rest while restoring the exact stream
ok 161 - P1-011 keeps a logical backup encrypted at rest while restoring the exact stream
  ---
  duration_ms: 15.8087
  type: 'test'
  ...
# Subtest: P1-011 authenticates an encrypted artifact before exposing any plaintext to the restore consumer
ok 162 - P1-011 authenticates an encrypted artifact before exposing any plaintext to the restore consumer
  ---
  duration_ms: 7.7314
  type: 'test'
  ...
# Subtest: P1-011 writes only a redacted, structured operational log record
ok 163 - P1-011 writes only a redacted, structured operational log record
  ---
  duration_ms: 47.4043
  type: 'test'
  ...
# Subtest: P1-011 keeps a persisted core intake available when optional dependencies fail
ok 164 - P1-011 keeps a persisted core intake available when optional dependencies fail
  ---
  duration_ms: 2.0314
  type: 'test'
  ...
# Subtest: P1-011 composes the operational boundary around the real Inbox to Pilot Ticket lifecycle
ok 165 - P1-011 composes the operational boundary around the real Inbox to Pilot Ticket lifecycle
  ---
  duration_ms: 82.7062
  type: 'test'
  ...
# Subtest: P1-011 alerts with stable codes without carrying the rejected sensitive values
ok 166 - P1-011 alerts with stable codes without carrying the rejected sensitive values
  ---
  duration_ms: 0.5757
  type: 'test'
  ...
# Subtest: P1-011 serves the Pilot workbench under a same-origin CSP without inline code
ok 167 - P1-011 serves the Pilot workbench under a same-origin CSP without inline code
  ---
  duration_ms: 25.368
  type: 'test'
  ...
# Subtest: P1-011 preserves safe backup and restore checkpoints in an admin-only immutable audit trail
ok 168 - P1-011 preserves safe backup and restore checkpoints in an admin-only immutable audit trail
  ---
  duration_ms: 52.8585
  type: 'test'
  ...
# Subtest: P1-012 accepts only an explicit check or approved live scenario
ok 169 - P1-012 accepts only an explicit check or approved live scenario
  ---
  duration_ms: 3.0315
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"21be1c6a3f8f1a6f91e80db470d8da66","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING"}}
# Subtest: P1-012 recovers only an explicitly approved, stale, terminated-local reply-probe evidence claim and audits it
ok 170 - P1-012 recovers only an explicitly approved, stale, terminated-local reply-probe evidence claim and audits it
  ---
  duration_ms: 20.1221
  type: 'test'
  ...
# Subtest: P1-012 restores the stale claim and releases the recovery guard if its recovery audit cannot append
ok 171 - P1-012 restores the stale claim and releases the recovery guard if its recovery audit cannot append
  ---
  duration_ms: 9.6225
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MISMATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MISMATCHED","bot_scope":"MATCHED","payload_token_match":"EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MISMATCHED","payload_token_match":"WECOM_MENTION_PREFIX_EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_REPLY_PROBE_EVIDENCE_CLAIM_IN_PROGRESS"}
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"4af1d7429befdd94db535dd28524ba6c","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING","resumed":true}}
# Subtest: P1-012 retains a truthful quarantine audit and blocks replies when quarantine cleanup fails, then resumes safely
ok 172 - P1-012 retains a truthful quarantine audit and blocks replies when quarantine cleanup fails, then resumes safely
  ---
  duration_ms: 27.8627
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MISMATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MISMATCHED","bot_scope":"MATCHED","payload_token_match":"EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MISMATCHED","payload_token_match":"WECOM_MENTION_PREFIX_EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_REPLY_PROBE_EVIDENCE_CLAIM_IN_PROGRESS"}
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"d483e5e60df35048bfa617d383a11f87","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING"}}
# Subtest: P1-012 atomically takes over a stale recovery guard while a live reply and second recovery remain blocked
ok 173 - P1-012 atomically takes over a stale recovery guard while a live reply and second recovery remain blocked
  ---
  duration_ms: 16.4835
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MISMATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MISMATCHED","bot_scope":"MATCHED","payload_token_match":"EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MISMATCHED","payload_token_match":"WECOM_MENTION_PREFIX_EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_REPLY_PROBE_EVIDENCE_CLAIM_IN_PROGRESS"}
# Subtest: P1-012 leaves multiple quarantine markers fail-closed for operator reconciliation
ok 174 - P1-012 leaves multiple quarantine markers fail-closed for operator reconciliation
  ---
  duration_ms: 11.7463
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MISMATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MISMATCHED","bot_scope":"MATCHED","payload_token_match":"EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MISMATCHED","payload_token_match":"WECOM_MENTION_PREFIX_EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_REPLY_PROBE_EVIDENCE_CLAIM_IN_PROGRESS"}
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"532399a33ff62bdff65fc25f212b18c5","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING"}}
# Subtest: P1-012 recovery guard blocks concurrent recovery and live reply acquisition until recovery audit completes
ok 175 - P1-012 recovery guard blocks concurrent recovery and live reply acquisition until recovery audit completes
  ---
  duration_ms: 14.5883
  type: 'test'
  ...
# Subtest: P1-012 validates WSS and Pilot configuration without requiring a public listener
ok 176 - P1-012 validates WSS and Pilot configuration without requiring a public listener
  ---
  duration_ms: 0.4638
  type: 'test'
  ...
# Subtest: P1-012 check emits a redacted readiness record with no public-IP prerequisite
ok 177 - P1-012 check emits a redacted readiness record with no public-IP prerequisite
  ---
  duration_ms: 232.1276
  type: 'test'
  ...
# Subtest: P1-012 marks an active delivery without an explicit provider ACK as retryable
ok 178 - P1-012 marks an active delivery without an explicit provider ACK as retryable
  ---
  duration_ms: 0.3654
  type: 'test'
  ...
# Subtest: P1-012 uses the Gate-0-verified completed stream shape for a group passive reply
ok 179 - P1-012 uses the Gate-0-verified completed stream shape for a group passive reply
  ---
  duration_ms: 0.2389
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MISMATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MISMATCHED","bot_scope":"MATCHED","payload_token_match":"EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MISMATCHED","payload_token_match":"WECOM_MENTION_PREFIX_EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_REPLY_PROBE","probe":{"exact_token":true,"addressing":"WECOM_MENTION_PREFIX","database_write":false,"run_id":"2a1b6b2372c6d40ba0834437640cf549"},"passive_reply":{"operation":"aibot_respond_msg_stream","attempted":true,"acknowledged":true,"provider_errcode":0,"outcome":"ACKED"}}
# Subtest: P1-012 keeps a short reply probe exact-scoped and out of the Pilot database
ok 180 - P1-012 keeps a short reply probe exact-scoped and out of the Pilot database
  ---
  duration_ms: 13.8167
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MISMATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MISMATCHED","bot_scope":"MATCHED","payload_token_match":"EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MISMATCHED","payload_token_match":"WECOM_MENTION_PREFIX_EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_REPLY_PROBE","probe":{"exact_token":true,"addressing":"WECOM_MENTION_PREFIX","database_write":false,"run_id":"5a6edd9d28d9c033726637925ffd084d"},"passive_reply":{"operation":"aibot_respond_msg_stream","attempted":true,"acknowledged":true,"provider_errcode":0,"outcome":"ACKED"}}
# {"test_id":"P1-012","event":"p1_012_client_display_observed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","source_result_hash":"97285ced800b3fc757c4b05cf3f96510","source_addressing":"WECOM_MENTION_PREFIX","provider_reply_acknowledged":true,"database_write":false,"observer":"configured_test_account","observation":"VISIBLE"}
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MISMATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MISMATCHED","bot_scope":"MATCHED","payload_token_match":"EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MISMATCHED","payload_token_match":"WECOM_MENTION_PREFIX_EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_REPLY_PROBE","probe":{"exact_token":true,"addressing":"WECOM_MENTION_PREFIX","database_write":false,"run_id":"7fc609779f5b2699e54c9f9de2752ccb"},"passive_reply":{"operation":"aibot_respond_msg_stream","attempted":true,"acknowledged":true,"provider_errcode":0,"outcome":"ACKED"}}
# {"test_id":"P1-012","event":"p1_012_client_display_observed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","source_result_hash":"46f627bd77d5fbaeb30abd34045d55d6","source_addressing":"WECOM_MENTION_PREFIX","provider_reply_acknowledged":true,"database_write":false,"observer":"configured_test_account","observation":"VISIBLE"}
# Subtest: P1-012 records a visible client observation only for the latest successful mention reply probe
ok 181 - P1-012 records a visible client observation only for the latest successful mention reply probe
  ---
  duration_ms: 36.3148
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_client_display_observed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT","source_result_hash":"a98b043eaf220dfa7f8a6d15a1fdb998","provider_reply_acknowledged":true,"database_write":true,"ticket_created":true,"intake_status":"TICKET_CREATED","observer":"configured_test_account","observation":"VISIBLE"}
# Subtest: P1-012 records one HMAC-linked client observation for a successful Ticket-creating group text
ok 182 - P1-012 records one HMAC-linked client observation for a successful Ticket-creating group text
  ---
  duration_ms: 9.3909
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_shared_delivery_reconciled","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"SHARED_DELIVERY_RECONCILIATION","database_mutation":false,"synthetic_signature":"ACK_PREFIX","delivery_count":2,"ticket_count":1,"attempt_count":3,"retry_attempts":1,"synthetic_sent_attempts":2,"channels":{"pilot_team":1,"wecom_direct":1},"audit_history_preserved":true,"excluded_from_real_wecom_delivery_evidence":true,"reconciliation_status":"IDENTIFIED_AND_EXCLUDED"}
# Subtest: P1-012 reconciles the exact synthetic shared Delivery footprint without mutating database facts
ok 183 - P1-012 reconciles the exact synthetic shared Delivery footprint without mutating database facts
  ---
  duration_ms: 3.8333
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_client_display_observed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","source_result_hash":"4820f6a54a47a36001fef143b95d984c","source_addressing":"WECOM_MENTION_PREFIX","provider_reply_acknowledged":true,"database_write":false,"observer":"configured_test_account","observation":"VISIBLE"}
# Subtest: P1-012 serializes concurrent client observations for one reply-probe source
ok 184 - P1-012 serializes concurrent client observations for one reply-probe source
  ---
  duration_ms: 14.753
  type: 'test'
  ...
# Subtest: P1-012 rejects a client observation whose source becomes stale before it claims the evidence chain
ok 185 - P1-012 rejects a client observation whose source becomes stale before it claims the evidence chain
  ---
  duration_ms: 2.7406
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MISMATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MISMATCHED","bot_scope":"MATCHED","payload_token_match":"EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MISMATCHED","payload_token_match":"WECOM_MENTION_PREFIX_EXACT","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_reply_probe_callback_observed","scenario":"GROUP_REPLY_PROBE","callback_received":true,"group_scope":"MATCHED","sender_scope":"MATCHED","bot_scope":"MATCHED","payload_token_match":"CONTAINS_ONLY","database_write":false,"reply_attempted":false}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_REPLY_PROBE_EVIDENCE_CLAIM_IN_PROGRESS"}
# {"test_id":"P1-012","event":"p1_012_client_display_observed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","source_result_hash":"4c5d5941c70db9012679de7412973148","source_addressing":"WECOM_MENTION_PREFIX","provider_reply_acknowledged":true,"database_write":false,"observer":"configured_test_account","observation":"VISIBLE"}
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_EVIDENCE_WRITE_FAILED"}
# Subtest: P1-012 rejects a later reply probe before passive reply while client observation holds the evidence chain
ok 186 - P1-012 rejects a later reply probe before passive reply while client observation holds the evidence chain
  ---
  duration_ms: 16.1322
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# Subtest: P1-012 prevents a reply probe from starting after an earlier evidence failure has won
ok 187 - P1-012 prevents a reply probe from starting after an earlier evidence failure has won
  ---
  duration_ms: 31.8425
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_REPLY_PROBE","probe":{"exact_token":true,"addressing":"BARE","database_write":false,"run_id":"0f47d959e419878a9acfd3ef56199241"},"passive_reply":{"operation":"aibot_respond_msg_stream","attempted":true,"acknowledged":true,"provider_errcode":0,"outcome":"ACKED"}}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_EVIDENCE_WRITE_FAILED"}
# Subtest: P1-012 records an in-flight reply probe before its deferred terminal failure
ok 188 - P1-012 records an in-flight reply probe before its deferred terminal failure
  ---
  duration_ms: 16.3437
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_LIVE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN"}
# Subtest: P1-012 hard-times-out a permanently pending reply probe with an explicit unknown side-effect state
ok 189 - P1-012 hard-times-out a permanently pending reply probe with an explicit unknown side-effect state
  ---
  duration_ms: 16.2749
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_LIVE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN"}
# Subtest: P1-012 suppresses a late reply-probe success record after its hard timeout
ok 190 - P1-012 suppresses a late reply-probe success record after its hard timeout
  ---
  duration_ms: 47.3317
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_EVIDENCE_WRITE_FAILED"}
# Subtest: P1-012 prevents a failed group-id capture run from updating the local group id
ok 191 - P1-012 prevents a failed group-id capture run from updating the local group id
  ---
  duration_ms: 5.1809
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_applied","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"side_effect_state":"APPLIED","configuration_updated":true,"group_id_hash":"9aa6151c5e05da82086348a14803d96d"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_EVIDENCE_WRITE_FAILED","side_effect_state":"APPLIED","configuration_updated":true,"group_id_hash":"9aa6151c5e05da82086348a14803d96d"}
# Subtest: P1-012 records an in-flight group-id capture before its deferred terminal failure
ok 192 - P1-012 records an in-flight group-id capture before its deferred terminal failure
  ---
  duration_ms: 28.7926
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_wss_error","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id","error_code":"ECONNRESET"}
# {"test_id":"P1-012","event":"p1_012_wss_disconnected","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_wss_reconnecting","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_wss_reauthenticated","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_EVIDENCE_WRITE_FAILED","side_effect_state":"APPLIED","configuration_updated":true,"group_id_hash":"c94df840bdca90ded1fa0e1092a64ee4"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# Subtest: P1-012 preserves a safe applied-capture audit when its applied evidence append fails
ok 193 - P1-012 preserves a safe applied-capture audit when its applied evidence append fails
  ---
  duration_ms: 5.1926
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_GROUP_ID_CAPTURE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN","group_id_hash":"eac76feda981759f44d849e3e50e5a7e","reconciliation_required":true}
# Subtest: P1-012 hard-times-out a pending group-id capture and aborts its local update seam
ok 194 - P1-012 hard-times-out a pending group-id capture and aborts its local update seam
  ---
  duration_ms: 1.0595
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_GROUP_ID_CAPTURE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN","group_id_hash":"eac76feda981759f44d849e3e50e5a7e","reconciliation_required":true}
# Subtest: P1-012 leaves a late non-cooperative capture update as reconcilable unknown without a late applied record
ok 195 - P1-012 leaves a late non-cooperative capture update as reconcilable unknown without a late applied record
  ---
  duration_ms: 25.0947
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_error","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT","error_code":"ECONNRESET"}
# {"test_id":"P1-012","event":"p1_012_wss_disconnected","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reconnecting","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reauthenticated","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_TEXT","core":{"accepted":true},"passive_reply":{"acknowledged":true},"run_id":"e0db01c4b09b9bd55d2f7f9350d1400d"}
# Subtest: P1-012 waits through a transient SDK disconnect and records only safe reconnect evidence
ok 196 - P1-012 waits through a transient SDK disconnect and records only safe reconnect evidence
  ---
  duration_ms: 8.5385
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_wss_error","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id","error_code":"ECONNRESET"}
# {"test_id":"P1-012","event":"p1_012_wss_disconnected","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_wss_reconnecting","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_wss_reauthenticated","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_applied","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"side_effect_state":"APPLIED","configuration_updated":true,"group_id_hash":"c94df840bdca90ded1fa0e1092a64ee4"}
# Subtest: P1-012 captures a scoped test-group id only into the local config and hashes its evidence
ok 197 - P1-012 captures a scoped test-group id only into the local config and hashes its evidence
  ---
  duration_ms: 9.5457
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT","timeout_ms":10000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT"}
# {"test_id":"P1-012","event":"p1_012_wss_disconnected","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT"}
# {"test_id":"P1-012","event":"p1_012_wss_reconnect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT"}
# {"test_id":"P1-012","event":"p1_012_wss_reauthenticated","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT"}
# Subtest: P1-012 requires one-process approval and records an outbound-WSS reconnect without a public listener
ok 198 - P1-012 requires one-process approval and records an outbound-WSS reconnect without a public listener
  ---
  duration_ms: 272.5976
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT","timeout_ms":10000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_disconnected","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reconnect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reauthenticated","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_post_reconnect_message_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT","reauthenticated":true}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"RECONNECT_GROUP_TEXT","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"SENT"},"run_id":"9b962e1b6c01deed0832309ac3b831a0","reconnect":{"reauthenticated_before_callback":true}}
# Subtest: P1-012 forces reauthentication before accepting one scoped group-text callback
ok 199 - P1-012 forces reauthentication before accepting one scoped group-text callback
  ---
  duration_ms: 280.9258
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":1,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":2,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":3,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":4,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":5,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":6,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":7,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":8,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":9,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":10,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":11,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":12,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":13,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":14,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":15,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":16,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":17,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":18,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":19,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":20,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":21,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":22,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":23,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":24,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":25,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":26,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":27,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":28,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":29,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":30,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":31,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":32,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":33,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":34,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":35,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":36,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":37,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":38,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":39,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":40,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":41,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":42,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":43,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":44,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":45,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":46,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":47,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":48,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":49,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":50,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":51,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":52,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":53,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":54,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":55,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":56,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":57,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":58,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":59,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":60,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":61,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":62,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":63,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":64,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":65,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":66,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":67,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":68,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":69,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":70,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":71,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":72,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":73,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":74,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":75,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":76,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":77,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":78,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":79,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":80,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":81,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":82,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":83,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":84,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":85,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":86,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":87,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":88,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":89,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":90,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":91,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":92,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":93,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":94,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":95,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":96,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":97,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":98,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":99,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":100,"run_id":"0b89ac031c03c0d69c37ed1f254ecb72"}
# {"test_id":"P1-012","event":"p1_012_live_burst_result","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100","run_id":"0b89ac031c03c0d69c37ed1f254ecb72","expected_count":100,"callback_count":100,"unique_message_count":100,"accepted_within_target_count":100,"duplicate_callback_count":0,"database":{"inbox_count":100,"intake_count":100,"ticket_count":100,"outbox_count":100,"delivery_count":200,"tickets_with_invalid_outbox_count":0,"tickets_with_invalid_delivery_count":0},"zero_lost_tickets":true,"zero_duplicate_tickets":true,"notifications_traceable":true,"collection_elapsed_ms":51,"outcome":"PASSED"}
# Subtest: P1-012 completes a strictly sequenced 100-message live burst only after database fact reconciliation
ok 200 - P1-012 completes a strictly sequenced 100-message live burst only after database fact reconciliation
  ---
  duration_ms: 55.1724
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":1,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":2,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":3,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":4,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":5,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":6,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":7,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":8,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":9,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":10,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":11,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":12,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":13,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":14,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":15,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":16,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":17,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":18,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":19,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":20,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":21,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":22,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":23,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":24,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":25,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":26,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":27,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":28,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":29,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":30,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":31,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":32,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":33,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":34,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":35,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":36,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":37,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":38,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":39,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":40,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":41,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":42,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":43,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":44,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":45,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":46,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":47,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":48,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":49,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":50,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":51,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":52,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":53,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":54,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":55,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":56,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":57,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":58,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":59,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":60,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":61,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":62,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":63,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":64,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":65,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":66,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":67,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":68,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":69,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":70,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":71,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":72,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":73,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":74,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":75,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":76,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":77,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":78,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":79,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":80,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":81,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":82,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":83,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":84,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":85,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":86,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":87,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":88,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":89,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":90,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":91,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":92,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":93,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":94,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":95,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":96,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":97,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":98,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":99,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":100,"run_id":"6d9342ea0b58cb80fb55e29e60be2179"}
# {"test_id":"P1-012","event":"p1_012_live_burst_result","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100","run_id":"6d9342ea0b58cb80fb55e29e60be2179","expected_count":100,"callback_count":100,"unique_message_count":100,"accepted_within_target_count":100,"duplicate_callback_count":0,"database":{"inbox_count":100,"intake_count":100,"ticket_count":100,"outbox_count":100,"delivery_count":200,"tickets_with_invalid_outbox_count":2,"tickets_with_invalid_delivery_count":2},"zero_lost_tickets":true,"zero_duplicate_tickets":true,"notifications_traceable":false,"collection_elapsed_ms":55,"outcome":"FAILED"}
# Subtest: P1-012 burst fails closed when global notification totals mask per-ticket gaps
ok 201 - P1-012 burst fails closed when global notification totals mask per-ticket gaps
  ---
  duration_ms: 58.2178
  type: 'test'
  ...
# Subtest: P1-012 exercises the real Pilot core under duplicate, image, burst, Outbox failure, and AI-off conditions
ok 202 - P1-012 exercises the real Pilot core under duplicate, image, burst, Outbox failure, and AI-off conditions
  ---
  duration_ms: 931.0868
  type: 'test'
  ...
# Subtest: P1-012 handles a scoped group text frame through Intake then a safe reply and Delivery
ok 203 - P1-012 handles a scoped group text frame through Intake then a safe reply and Delivery
  ---
  duration_ms: 5.8256
  type: 'test'
  ...
# Subtest: P1-012 records an image-degraded Intake without fabricating a Ticket
ok 204 - P1-012 records an image-degraded Intake without fabricating a Ticket
  ---
  duration_ms: 0.762
  type: 'test'
  ...
# Subtest: P1-012 accepts an addressed group mixed image only when it contains the run token and an image
ok 205 - P1-012 accepts an addressed group mixed image only when it contains the run token and an image
  ---
  duration_ms: 0.8707
  type: 'test'
  ...
# Subtest: P1-012 ignores an unscoped group frame without calling any operational seam
ok 206 - P1-012 ignores an unscoped group frame without calling any operational seam
  ---
  duration_ms: 0.2942
  type: 'test'
  ...
# Subtest: P1-012 keeps a transient core failure safe and retryable without leaking the failure text
ok 207 - P1-012 keeps a transient core failure safe and retryable without leaking the failure text
  ---
  duration_ms: 0.4906
  type: 'test'
  ...
# Subtest: P1-012 keeps a thrown database fault out of the client reply and safe evidence
ok 208 - P1-012 keeps a thrown database fault out of the client reply and safe evidence
  ---
  duration_ms: 0.5175
  type: 'test'
  ...
# Subtest: P1-012 requires an explicit successful provider receipt for a passive reply
ok 209 - P1-012 requires an explicit successful provider receipt for a passive reply
  ---
  duration_ms: 0.4709
  type: 'test'
  ...
# Subtest: P1-012 preserves a provider reply rejection code without keeping its message text
ok 210 - P1-012 preserves a provider reply rejection code without keeping its message text
  ---
  duration_ms: 0.5034
  type: 'test'
  ...
# Subtest: P1-012 Go/No-Go requires real client observation but never a public IP for outbound WSS
ok 211 - P1-012 Go/No-Go requires real client observation but never a public IP for outbound WSS
  ---
  duration_ms: 0.3353
  type: 'test'
  ...
# Subtest: P1-012 WeCom burst UI plan is side-effect free and preserves the requested sequence range
ok 212 - P1-012 WeCom burst UI plan is side-effect free and preserves the requested sequence range
  ---
  duration_ms: 880.9967
  type: 'test'
  ...
# Subtest: P1-012 WeCom burst UI driver fails closed on invalid ranges and ambiguous modes
ok 213 - P1-012 WeCom burst UI driver fails closed on invalid ranges and ambiguous modes
  ---
  duration_ms: 1651.4491
  type: 'test'
  ...
# Subtest: P1-012 WeCom burst UI driver retains fail-closed target, clipboard, stop, and reconciliation guards
ok 214 - P1-012 WeCom burst UI driver retains fail-closed target, clipboard, stop, and reconciliation guards
  ---
  duration_ms: 5.7251
  type: 'test'
  ...
# Subtest: P2-001 PostgreSQL contract is idempotent, isolated, and fail closed
ok 215 - P2-001 PostgreSQL contract is idempotent, isolated, and fail closed
  ---
  duration_ms: 1147.2842
  type: 'test'
  ...
# Subtest: all P2 conversation feature flags default to false
ok 216 - all P2 conversation feature flags default to false
  ---
  duration_ms: 2.0539
  type: 'test'
  ...
# Subtest: Thread identity separates single, group, and multiple bots without exposing raw ids in its key
ok 217 - Thread identity separates single, group, and multiple bots without exposing raw ids in its key
  ---
  duration_ms: 0.8947
  type: 'test'
  ...
# Subtest: Thread identity rejects malformed channel scope with a stable error
ok 218 - Thread identity rejects malformed channel scope with a stable error
  ---
  duration_ms: 0.451
  type: 'test'
  ...
# Subtest: group Session scope isolates participants and Intakes
ok 219 - group Session scope isolates participants and Intakes
  ---
  duration_ms: 0.4942
  type: 'test'
  ...
# Subtest: Session boundary rules cover ended, explicit, different Intake, idle equality, and continuation
ok 220 - Session boundary rules cover ended, explicit, different Intake, idle equality, and continuation
  ---
  duration_ms: 0.8354
  type: 'test'
  ...
# Subtest: only auditable boundary reasons are accepted from callers
ok 221 - only auditable boundary reasons are accepted from callers
  ---
  duration_ms: 0.6686
  type: 'test'
  ...
# Subtest: Session lifecycle is OPEN/WAITING_USER with ENDED terminal
ok 222 - Session lifecycle is OPEN/WAITING_USER with ENDED terminal
  ---
  duration_ms: 0.2402
  type: 'test'
  ...
# Subtest: control modes fail closed, default HUMAN, and reserve AUTO for P2-010/P2-G4
ok 223 - control modes fail closed, default HUMAN, and reserve AUTO for P2-010/P2-G4
  ---
  duration_ms: 0.3168
  type: 'test'
  ...
# Subtest: generation and row versions advance only for unique invalidating changes
ok 224 - generation and row versions advance only for unique invalidating changes
  ---
  duration_ms: 0.2234
  type: 'test'
  ...
# Subtest: disabled guard does not invoke storage or external seams and raw failures stay hidden
ok 225 - disabled guard does not invoke storage or external seams and raw failures stay hidden
  ---
  duration_ms: 0.5726
  type: 'test'
  ...
# Subtest: database failures map to stable public errors
ok 226 - database failures map to stable public errors
  ---
  duration_ms: 0.1454
  type: 'test'
  ...
# Subtest: P2-001 migration is limited to Thread and Session and reserves later tasks
ok 227 - P2-001 migration is limited to Thread and Session and reserves later tasks
  ---
  duration_ms: 6.9452
  type: 'test'
  ...
# Subtest: JSON Schemas, public OpenAPI view, and TypeScript declarations freeze safe vocabulary
ok 228 - JSON Schemas, public OpenAPI view, and TypeScript declarations freeze safe vocabulary
  ---
  duration_ms: 2.1549
  type: 'test'
  ...
# Subtest: P2-002 migration 011 first/repeat apply is exact and leaves P1/P2-001 unchanged
ok 229 - P2-002 migration 011 first/repeat apply is exact and leaves P1/P2-001 unchanged
  ---
  duration_ms: 699.9894
  type: 'test'
  ...
# Subtest: P2-002 migration CLI runs only 011, is repeatable, and rolls check mode back
ok 230 - P2-002 migration CLI runs only 011, is repeatable, and rolls check mode back
  ---
  duration_ms: 1661.6639
  type: 'test'
  ...
# {"child_process_runs":4,"child_exit_codes":[0,0,0,0],"preapply_check_created_tables":0,"migration_files_executed":1,"tables_added":3,"p1_p2_001_catalog_unchanged":true,"postapply_check_rolled_back":true,"temp_database_cleanup":true}
# Subtest: P2-002 migration CLI fails closed on incompatible read-only source dependencies
ok 231 - P2-002 migration CLI fails closed on incompatible read-only source dependencies
  ---
  duration_ms: 902.8046
  type: 'test'
  ...
# {"child_exit_code":1,"stable_error":"P2_002_SCHEMA_DRIFT_REMEDIATION_REQUIRED","p2_tables_created":0,"temp_database_cleanup":true}
# Subtest: P2-002 migration 011 fails closed on missing column
ok 232 - P2-002 migration 011 fails closed on missing column
  ---
  duration_ms: 698.5274
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on weakened CHECK constraint
ok 233 - P2-002 migration 011 fails closed on weakened CHECK constraint
  ---
  duration_ms: 764.4255
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on wrong unique constraint columns
ok 234 - P2-002 migration 011 fails closed on wrong unique constraint columns
  ---
  duration_ms: 614.7865
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on wrong index access method
ok 235 - P2-002 migration 011 fails closed on wrong index access method
  ---
  duration_ms: 682.8135
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on wrong partial-index predicate
ok 236 - P2-002 migration 011 fails closed on wrong partial-index predicate
  ---
  duration_ms: 724.3396
  type: 'test'
  ...
# Subtest: P2-002 P1 source adapter reads Channel/Intake/Ticket/Delivery facts without mutating them
ok 237 - P2-002 P1 source adapter reads Channel/Intake/Ticket/Delivery facts without mutating them
  ---
  duration_ms: 2647.1533
  type: 'test'
  ...
# {"source_record_count":4,"channel_message_count":1,"ticket_event_variant_count":2,"delivery_count":1,"source_snapshot_unchanged":true}
# Subtest: P2-002 real worker processes roll back before commit and replay after ACK loss
ok 238 - P2-002 real worker processes roll back before commit and replay after ACK loss
  ---
  duration_ms: 1560.6214
  type: 'test'
  ...
# {"before_commit_kill_exit":{"code":null,"signal":"SIGKILL","killed":true},"before_commit_backend_close_polls":1,"before_commit_restart_exit":{"code":0,"signal":null,"killed":false},"before_commit_restart_inserted":1,"after_commit_kill_exit":{"code":null,"signal":"SIGKILL","killed":true},"after_commit_backend_close_polls":1,"after_commit_restart_exit":{"code":0,"signal":null,"killed":false},"after_commit_restart_replayed":1,"final_item_count":1,"final_binding_count":1,"final_checkpoint_cursor":"1","temp_database_cleanup":true}
# Subtest: P2-002 stale rebuild cannot delete a source committed after snapshot preparation
ok 239 - P2-002 stale rebuild cannot delete a source committed after snapshot preparation
  ---
  duration_ms: 630.1399
  type: 'test'
  ...
# {"connection_wait_polls":1,"stale_rebuild_error":"CONVERSATION_TIMELINE_REBUILD_FAILED","preserved_item_count":3,"preserved_binding_count":3,"preserved_checkpoint_cursor":"3","full_rebuild_item_count":3,"full_rebuild_hash":"d376a1a8329ac7b6d35f02b7acbd4ec939634c1d98b720e9a23bb8f946d0c7b7","temp_database_cleanup":true}
# Subtest: P2-002 projector is idempotent, concurrent, transactional, rebuildable, private, and restart safe
ok 240 - P2-002 projector is idempotent, concurrent, transactional, rebuildable, private, and restart safe
  ---
  duration_ms: 4595.6569
  type: 'test'
  ...
# {"same_source_concurrency":12,"different_source_concurrency":12,"bulk_item_count":2001,"bulk_batch_count":101,"bulk_max_batch_size":20,"bulk_peak_heap_delta_bytes":21194264,"bulk_heap_sample_count":101,"bulk_heap_segment_means_bytes":[18262930,21789706,25610883,24068051],"bulk_first_to_last_heap_trend_bytes":5805121,"bulk_max_adjacent_heap_trend_bytes":3821177,"bulk_interrupted_at_cursor":"20","bulk_restart_remaining_items":1981,"rebuild_canonical_hash":"ddc973f58a422acbc14fd3c1ae7a93b9abf04417919427ef652e4259fe242868","temp_database_cleanup":"verified-by-finally"}
# Subtest: P2-002 suite leaves no random database or worker backend residual
ok 241 - P2-002 suite leaves no random database or worker backend residual
  ---
  duration_ms: 43.1293
  type: 'test'
  ...
# {"temp_database_count":0,"worker_backend_count":0,"isolated_source_data_residual":0,"isolated_projection_schema_residual":0}
# Subtest: P2-002 uses the frozen P2-001 Conversation Item enums
ok 242 - P2-002 uses the frozen P2-001 Conversation Item enums
  ---
  duration_ms: 9.1098
  type: 'test'
  ...
# Subtest: projection source schema parses and freezes the five source types
ok 243 - projection source schema parses and freezes the five source types
  ---
  duration_ms: 2.362
  type: 'test'
  ...
# Subtest: normalization rejects invalid source type, session UUID, date, ordinal and additions
ok 244 - normalization rejects invalid source type, session UUID, date, ordinal and additions
  ---
  duration_ms: 2.9544
  type: 'test'
  ...
# Subtest: date normalization rejects hostile Date/object paths without invoking or leaking them
ok 245 - date normalization rejects hostile Date/object paths without invoking or leaking them
  ---
  duration_ms: 0.7628
  type: 'test'
  ...
# Subtest: safe_content accepts only bounded plain JSON data properties
ok 246 - safe_content accepts only bounded plain JSON data properties
  ---
  duration_ms: 0.6071
  type: 'test'
  ...
# Subtest: toJSON, Proxy and prototype-pollution keys cannot bypass pure JSON checks
ok 247 - toJSON, Proxy and prototype-pollution keys cannot bypass pure JSON checks
  ---
  duration_ms: 0.4866
  type: 'test'
  ...
# Subtest: source_hash is stable across key order and detects semantic mutation
ok 248 - source_hash is stable across key order and detects semantic mutation
  ---
  duration_ms: 0.5966
  type: 'test'
  ...
# Subtest: privacy and retention controls can tighten without changing semantic source_hash
ok 249 - privacy and retention controls can tighten without changing semantic source_hash
  ---
  duration_ms: 0.3389
  type: 'test'
  ...
# Subtest: canonical order uses the frozen rank and exact deterministic tie-break tuple
ok 250 - canonical order uses the frozen rank and exact deterministic tie-break tuple
  ---
  duration_ms: 0.8861
  type: 'test'
  ...
# Subtest: canonical order compares BIGINT ordinals numerically without Number conversion
ok 251 - canonical order compares BIGINT ordinals numerically without Number conversion
  ---
  duration_ms: 1.8198
  type: 'test'
  ...
# Subtest: source id and variant break otherwise identical timestamp/rank/ordinal ties
ok 252 - source id and variant break otherwise identical timestamp/rank/ordinal ties
  ---
  duration_ms: 0.7991
  type: 'test'
  ...
# Subtest: CHANNEL_MESSAGE maps only clean_text and four safe flags
ok 253 - CHANNEL_MESSAGE maps only clean_text and four safe flags
  ---
  duration_ms: 0.8276
  type: 'test'
  ...
# Subtest: TICKET_EVENT splits STATUS, EXTERNAL_NOTE and INTERNAL_NOTE variants
ok 254 - TICKET_EVENT splits STATUS, EXTERNAL_NOTE and INTERNAL_NOTE variants
  ---
  duration_ms: 0.8535
  type: 'test'
  ...
# Subtest: TICKET_EVENT external variant cannot contain internal note or operator identity
ok 255 - TICKET_EVENT external variant cannot contain internal note or operator identity
  ---
  duration_ms: 0.347
  type: 'test'
  ...
# Subtest: TICKET_EVENT omits absent note variants
ok 256 - TICKET_EVENT omits absent note variants
  ---
  duration_ms: 0.2451
  type: 'test'
  ...
# Subtest: DELIVERY is INTERNAL and excludes target/provider/raw error data
ok 257 - DELIVERY is INTERNAL and excludes target/provider/raw error data
  ---
  duration_ms: 0.4153
  type: 'test'
  ...
# Subtest: Communication Message fixture mapper requires an explicit fixture marker
ok 258 - Communication Message fixture mapper requires an explicit fixture marker
  ---
  duration_ms: 0.3446
  type: 'test'
  ...
# Subtest: Handoff fixture defaults to INTERNAL and never creates a future table dependency
ok 259 - Handoff fixture defaults to INTERNAL and never creates a future table dependency
  ---
  duration_ms: 0.2187
  type: 'test'
  ...
# Subtest: normalized safe_content deny-list blocks privacy and provider leakage fields
ok 260 - normalized safe_content deny-list blocks privacy and provider leakage fields
  ---
  duration_ms: 0.5308
  type: 'test'
  ...
# Subtest: feature flag is fail-closed before any database call
ok 261 - feature flag is fail-closed before any database call
  ---
  duration_ms: 0.5317
  type: 'test'
  ...
# Subtest: batchSize defaults to 20 and is bounded at construction and invocation
ok 262 - batchSize defaults to 20 and is bounded at construction and invocation
  ---
  duration_ms: 0.5445
  type: 'test'
  ...
# Subtest: runtime freezes every source and operation to the single timeline projector name
ok 263 - runtime freezes every source and operation to the single timeline projector name
  ---
  duration_ms: 1.2299
  type: 'test'
  ...
# Subtest: public storage failures contain only the stable code
ok 264 - public storage failures contain only the stable code
  ---
  duration_ms: 0.3807
  type: 'test'
  ...
# Subtest: database sequence uniqueness is deterministically mapped to the frozen sequence error
ok 265 - database sequence uniqueness is deterministically mapped to the frozen sequence error
  ---
  duration_ms: 6.734
  type: 'test'
  ...
# Subtest: rebuild authorization and wrapper accessor validation fail before storage
ok 266 - rebuild authorization and wrapper accessor validation fail before storage
  ---
  duration_ms: 1.3913
  type: 'test'
  ...
# Subtest: rebuild stale-snapshot fence fails before DELETE for extra or foreign bindings
ok 267 - rebuild stale-snapshot fence fails before DELETE for extra or foreign bindings
  ---
  duration_ms: 2.2339
  type: 'test'
  ...
# Subtest: Canonical Timeline Hash excludes projected_at and physical input order
ok 268 - Canonical Timeline Hash excludes projected_at and physical input order
  ---
  duration_ms: 0.9162
  type: 'test'
  ...
# Subtest: Canonical Timeline Hash validates arrays and items before any caller property access
ok 269 - Canonical Timeline Hash validates arrays and items before any caller property access
  ---
  duration_ms: 0.9144
  type: 'test'
  ...
# Subtest: EXTERNAL audience uses SQL visibility filtering and defense-in-depth filtering
ok 270 - EXTERNAL audience uses SQL visibility filtering and defense-in-depth filtering
  ---
  duration_ms: 0.6686
  type: 'test'
  ...
# Subtest: WORKBENCH excludes RESTRICTED and RESTRICTED_ADMIN requires explicit authorization
ok 271 - WORKBENCH excludes RESTRICTED and RESTRICTED_ADMIN requires explicit authorization
  ---
  duration_ms: 0.3222
  type: 'test'
  ...
# Subtest: generic TimelineSourceAdapter maps rows outside projector transactions
ok 272 - generic TimelineSourceAdapter maps rows outside projector transactions
  ---
  duration_ms: 1.4016
  type: 'test'
  ...
# Subtest: public wrapper APIs reject Proxy/accessor arguments before invoking dependencies
ok 273 - public wrapper APIs reject Proxy/accessor arguments before invoking dependencies
  ---
  duration_ms: 0.8779
  type: 'test'
  ...
# Subtest: unknown Proxy/accessor error objects are sanitized without a second trap
ok 274 - unknown Proxy/accessor error objects are sanitized without a second trap
  ---
  duration_ms: 0.2263
  type: 'test'
  ...
# Subtest: worker reads a bounded batch before invoking the projector and preserves AbortSignal
ok 275 - worker reads a bounded batch before invoking the projector and preserves AbortSignal
  ---
  duration_ms: 0.4553
  type: 'test'
  ...
# Subtest: worker maps unknown adapter failures to the stable storage error
ok 276 - worker maps unknown adapter failures to the stable storage error
  ---
  duration_ms: 0.179
  type: 'test'
  ...
# Subtest: checkpoint cursor accepts nullable expected values and enforces the shared 512 bound
ok 277 - checkpoint cursor accepts nullable expected values and enforces the shared 512 bound
  ---
  duration_ms: 3.2186
  type: 'test'
  ...
# Subtest: migration runner executes only migration 011 and sanitizes raw failures
ok 278 - migration runner executes only migration 011 and sanitizes raw failures
  ---
  duration_ms: 2.3753
  type: 'test'
  ...
# Subtest: the public error vocabulary contains exactly the eleven frozen stable codes
ok 279 - the public error vocabulary contains exactly the eleven frozen stable codes
  ---
  duration_ms: 0.3328
  type: 'test'
  ...
# Subtest: P1 source adapter reads current sources in one repeatable-read read-only transaction
ok 280 - P1 source adapter reads current sources in one repeatable-read read-only transaction
  ---
  duration_ms: 0.5225
  type: 'test'
  ...
# Subtest: P2-003 migration 012 is exact, reentrant, CLI-scoped, and check-only rolls back
ok 281 - P2-003 migration 012 is exact, reentrant, CLI-scoped, and check-only rolls back
  ---
  duration_ms: 1700.4434
  type: 'test'
  ...
# {"migration_process_runs":4,"migration_files_executed":1,"relations_added":2,"prior_catalog_unchanged":true,"precheck_rolled_back":true,"postcheck_rolled_back":true,"temp_database_cleanup":true}
# Subtest: P2-003 migration fails closed for missing column, weak check, wrong unique and index drift
ok 282 - P2-003 migration fails closed for missing column, weak check, wrong unique and index drift
  ---
  duration_ms: 4556.6076
  type: 'test'
  ...
# {"drift_scenarios":5,"temp_database_cleanup":true}
# Subtest: P2-003 append, concurrency, caller transaction, durable replay and authorization are exact
ok 283 - P2-003 append, concurrency, caller transaction, durable replay and authorization are exact
  ---
  duration_ms: 2353.8216
  type: 'test'
  ...
# {"same_event_concurrency":12,"different_event_concurrency":12,"pool_maximum":4,"natural_identity_hole":true,"ack_loss_replayed":true,"replay_batch_count":3,"replay_batch_maximum":50,"authorization_variants":4,"retained_event_count":124,"temp_database_cleanup":true}
# Subtest: P2-003 retention check/apply preserves prefix and floor semantics with CLI authorization
ok 284 - P2-003 retention check/apply preserves prefix and floor semantics with CLI authorization
  ---
  duration_ms: 5275.0728
  type: 'test'
  ...
# {"check_zero_write":true,"unauthorized_apply_zero_write":true,"deleted_prefix_count":2,"floor_event_id":"2","expired_after_live_retained":true,"retry_idempotent":true,"replay_gap_http_fallback":true,"cursor_ahead_http_409":true,"authorized_cli_apply":true}
# Subtest: P2-003 retention delete/floor is atomic and every cleanup batch is at most 200
ok 285 - P2-003 retention delete/floor is atomic and every cleanup batch is at most 200
  ---
  duration_ms: 7684.4348
  type: 'test'
  ...
# {"first_batch_deleted":200,"second_batch_deleted":1,"floor_delete_atomic_rollback":true}
# Subtest: P2-003 localhost SSE admits 32 clients, rejects 33, heartbeats, delivers and releases resources
ok 286 - P2-003 localhost SSE admits 32 clients, rejects 33, heartbeats, delivers and releases resources
  ---
  duration_ms: 5073.2536
  type: 'test'
  ...
# {"peak_client_count":32,"event_count":100,"each_client_received":100,"capacity_rejections":1,"maximum_writable_length":16695,"slow_client_disconnects":0,"heap_samples_bytes":[9812360,11853552,13208632,11190256,12812848,25513832,15023480],"first_heap_bytes":9812360,"last_heap_bytes":15023480,"heap_sample_mean_bytes":14202137,"first_to_last_heap_trend_bytes":5211120,"peak_heap_delta_bytes":15701472,"database_query_batches":108,"resource_release_polls":2,"temp_database_cleanup":true}
# Subtest: P2-003 child kill/restart replays Last-Event-ID and missed wakeup recovers from PostgreSQL
ok 287 - P2-003 child kill/restart replays Last-Event-ID and missed wakeup recovers from PostgreSQL
  ---
  duration_ms: 4649.8174
  type: 'test'
  ...
# {"killed_server_exit":{"code":null,"signal":"SIGKILL","killed":true},"killed_server_backend_close_polls":1,"first_event_id":"1","post_restart_event_id":"2","recovery_poll_event_id":"3","app_restart_postgresql_replay":true,"missed_wakeup_recovered":true,"server_a_port":50331,"server_b_port":50354,"temp_database_cleanup":true}
# Subtest: P2-003 real paused slow client is isolated while normal delivery and append continue
ok 288 - P2-003 real paused slow client is isolated while normal delivery and append continue
  ---
  duration_ms: 22491.9777
  type: 'test'
  ...
# {"slow_disconnect_count":1,"normal_client_received":5001,"persisted_event_count":5001,"slow_disconnect_polls":84,"active_slow_write_window_polls":14,"normal_joined_during_slow_drain_polls":1,"normal_client_remained_connected":true,"append_during_slow_write_window":true,"business_transaction_during_slow_write_window":true,"temp_database_cleanup":true}
# Subtest: P2-003 streams 5,000 events in bounded batches and bounded heap without retaining frames
ok 289 - P2-003 streams 5,000 events in bounded batches and bounded heap without retaining frames
  ---
  duration_ms: 6699.8675
  type: 'test'
  ...
# {"event_count":5000,"replay_query_batch_count":100,"replay_batch_size":50,"captured_frame_count":0,"maximum_parser_buffer_bytes":370,"maximum_writable_length":16588,"heap_samples_bytes":[9814408,11751440,15305456,10904496,11315912,18016080],"first_to_last_heap_trend_bytes":8201672,"peak_heap_delta_bytes":8201672,"temp_database_cleanup":true}
# Subtest: P2-003 suite leaves no owned database, schema, child, backend, socket, port or timer residual
ok 290 - P2-003 suite leaves no owned database, schema, child, backend, socket, port or timer residual
  ---
  duration_ms: 76.018
  type: 'test'
  ...
# {"active_test_clients":0,"active_fallback_requests":0,"active_test_http_sockets":0,"active_test_wait_timers":0,"active_cli_children":0,"active_server_children":0,"owned_port_count":6,"closed_port_count":6,"port_close_polls":[1,1,1,1,1,1],"owned_database_count":0,"owned_schema_count":0,"owned_backend_count":0,"active_database_count":0,"emergency_client_cleanup_count":0,"emergency_fallback_cleanup_count":0,"emergency_http_socket_cleanup_count":0}
# Subtest: Realtime Event and Fallback Schemas parse as draft 2020-12 closed contracts
ok 291 - Realtime Event and Fallback Schemas parse as draft 2020-12 closed contracts
  ---
  duration_ms: 14.5213
  type: 'test'
  ...
# Subtest: Realtime vocabularies freeze all event, source, aggregate, scope and visibility values
ok 292 - Realtime vocabularies freeze all event, source, aggregate, scope and visibility values
  ---
  duration_ms: 4.2822
  type: 'test'
  ...
# Subtest: TypeScript declarations mirror every frozen Schema and runtime vocabulary
ok 293 - TypeScript declarations mirror every frozen Schema and runtime vocabulary
  ---
  duration_ms: 3.7576
  type: 'test'
  ...
# Subtest: authorized replay SQL clips scope and visibility before LIMIT and payload materialization
ok 294 - authorized replay SQL clips scope and visibility before LIMIT and payload materialization
  ---
  duration_ms: 1.3378
  type: 'test'
  ...
# Subtest: Fallback Schema freezes the six safe fields, four reasons and two strategies
ok 295 - Fallback Schema freezes the six safe fields, four reasons and two strategies
  ---
  duration_ms: 2.401
  type: 'test'
  ...
# Subtest: normalization rejects invalid event, source, aggregate and scope vocabularies
ok 296 - normalization rejects invalid event, source, aggregate and scope vocabularies
  ---
  duration_ms: 5.2599
  type: 'test'
  ...
# Subtest: SESSION and THREAD require a UUID scope while SYSTEM requires null
ok 297 - SESSION and THREAD require a UUID scope while SYSTEM requires null
  ---
  duration_ms: 3.4906
  type: 'test'
  ...
# Subtest: normalization rejects invalid timestamps and requires expires_at after occurred_at
ok 298 - normalization rejects invalid timestamps and requires expires_at after occurred_at
  ---
  duration_ms: 1.4789
  type: 'test'
  ...
# Subtest: aggregate versions use nullable canonical PostgreSQL BIGINT strings
ok 299 - aggregate versions use nullable canonical PostgreSQL BIGINT strings
  ---
  duration_ms: 1.4856
  type: 'test'
  ...
# Subtest: Last-Event-ID accepts zero and the BIGINT maximum without Number conversion
ok 300 - Last-Event-ID accepts zero and the BIGINT maximum without Number conversion
  ---
  duration_ms: 0.6245
  type: 'test'
  ...
# Subtest: Last-Event-ID rejects negative, decimal, scientific, signed, spaced and overflow forms
ok 301 - Last-Event-ID rejects negative, decimal, scientific, signed, spaced and overflow forms
  ---
  duration_ms: 0.5363
  type: 'test'
  ...
# Subtest: payload accepts only bounded plain finite JSON data
ok 302 - payload accepts only bounded plain finite JSON data
  ---
  duration_ms: 1.39
  type: 'test'
  ...
# Subtest: payload enforces depth, node, object, array, string and canonical-byte limits
ok 303 - payload enforces depth, node, object, array, string and canonical-byte limits
  ---
  duration_ms: 7.8649
  type: 'test'
  ...
# Subtest: payload rejects Proxy and accessor paths without invoking hostile code
ok 304 - payload rejects Proxy and accessor paths without invoking hostile code
  ---
  duration_ms: 0.8297
  type: 'test'
  ...
# Subtest: payload rejects toJSON, symbols and prototype-pollution keys
ok 305 - payload rejects toJSON, symbols and prototype-pollution keys
  ---
  duration_ms: 0.6137
  type: 'test'
  ...
# Subtest: payload rejects message content and sensitive identifier property names
ok 306 - payload rejects message content and sensitive identifier property names
  ---
  duration_ms: 1.1351
  type: 'test'
  ...
# Subtest: event key is stable, opaque and changes with its frozen identity tuple
ok 307 - event key is stable, opaque and changes with its frozen identity tuple
  ---
  duration_ms: 2.4917
  type: 'test'
  ...
# Subtest: event hash is canonical across payload key order and changes on semantic mutation
ok 308 - event hash is canonical across payload key order and changes on semantic mutation
  ---
  duration_ms: 1.3479
  type: 'test'
  ...
# Subtest: event hash excludes expires_at, event_id and created_at
ok 309 - event hash excludes expires_at, event_id and created_at
  ---
  duration_ms: 0.8418
  type: 'test'
  ...
# Subtest: Conversation Item mapper exposes only the seven safe projection fields plus occurred_at
ok 310 - Conversation Item mapper exposes only the seven safe projection fields plus occurred_at
  ---
  duration_ms: 1.3174
  type: 'test'
  ...
# Subtest: Session fixture mapper freezes created and updated event variants with safe payloads
ok 311 - Session fixture mapper freezes created and updated event variants with safe payloads
  ---
  duration_ms: 1.2766
  type: 'test'
  ...
# Subtest: Timeline rebuilt fixture mapper exposes only count and canonical hash metadata
ok 312 - Timeline rebuilt fixture mapper exposes only count and canonical hash metadata
  ---
  duration_ms: 0.8776
  type: 'test'
  ...
# Subtest: public event view contains exactly nine safe fields and no publisher, source, hash or scope IDs
ok 313 - public event view contains exactly nine safe fields and no publisher, source, hash or scope IDs
  ---
  duration_ms: 0.9597
  type: 'test'
  ...
# Subtest: SSE event encoding uses id/type/single-line JSON and supports every frozen event type
ok 314 - SSE event encoding uses id/type/single-line JSON and supports every frozen event type
  ---
  duration_ms: 5.2689
  type: 'test'
  ...
# Subtest: SSE encoding rejects CR/LF event injection and never emits raw payload newlines
ok 315 - SSE encoding rejects CR/LF event injection and never emits raw payload newlines
  ---
  duration_ms: 0.5858
  type: 'test'
  ...
# Subtest: heartbeat is a comment frame and consumes no event id
ok 316 - heartbeat is a comment frame and consumes no event id
  ---
  duration_ms: 0.2265
  type: 'test'
  ...
# Subtest: authorization defaults to deny-all and rejects absent or malformed contexts
ok 317 - authorization defaults to deny-all and rejects absent or malformed contexts
  ---
  duration_ms: 0.8016
  type: 'test'
  ...
# Subtest: authorization normalizes bounded UUID sets without wildcard access
ok 318 - authorization normalizes bounded UUID sets without wildcard access
  ---
  duration_ms: 0.367
  type: 'test'
  ...
# Subtest: restricted-admin defense-in-depth closes a malicious replay without delivering it
ok 319 - restricted-admin defense-in-depth closes a malicious replay without delivering it
  ---
  duration_ms: 3.9405
  type: 'test'
  ...
# Subtest: controlled principal disconnect closes only the selected SSE client
ok 320 - controlled principal disconnect closes only the selected SSE client
  ---
  duration_ms: 7.8187
  type: 'test'
  ...
# Subtest: disabled handler returns safe polling fallback with zero database calls and no timers
ok 321 - disabled handler returns safe polling fallback with zero database calls and no timers
  ---
  duration_ms: 1.0245
  type: 'test'
  ...
# Subtest: disabled event store fails before acquiring a database connection
ok 322 - disabled event store fails before acquiring a database connection
  ---
  duration_ms: 0.742
  type: 'test'
  ...
# Subtest: disconnect during authentication never acquires replay, Hub, or timer resources
ok 323 - disconnect during authentication never acquires replay, Hub, or timer resources
  ---
  duration_ms: 0.5146
  type: 'test'
  ...
# Subtest: disconnect during authorization never acquires replay, Hub, or timer resources
ok 324 - disconnect during authorization never acquires replay, Hub, or timer resources
  ---
  duration_ms: 0.5408
  type: 'test'
  ...
# Subtest: Wakeup Hub admits 32 clients, rejects the 33rd, and releases capacity
ok 325 - Wakeup Hub admits 32 clients, rejects the 33rd, and releases capacity
  ---
  duration_ms: 0.3648
  type: 'test'
  ...
# Subtest: replay batch configuration accepts 200 and rejects 201
ok 326 - replay batch configuration accepts 200 and rejects 201
  ---
  duration_ms: 0.2494
  type: 'test'
  ...
# Subtest: list replay rejects limits above 200 before querying storage
ok 327 - list replay rejects limits above 200 before querying storage
  ---
  duration_ms: 0.615
  type: 'test'
  ...
# Subtest: backpressure waits for drain and releases only the affected stream
ok 328 - backpressure waits for drain and releases only the affected stream
  ---
  duration_ms: 1.7697
  type: 'test'
  ...
# Subtest: drain timeout disconnects only the slow client with bounded metrics
ok 329 - drain timeout disconnects only the slow client with bounded metrics
  ---
  duration_ms: 2.8527
  type: 'test'
  ...
# Subtest: retention gap after SSE headers closes the stream and reconnect returns 410 fallback
ok 330 - retention gap after SSE headers closes the stream and reconnect returns 410 fallback
  ---
  duration_ms: 2.0103
  type: 'test'
  ...
# Subtest: polling fallback normalizes canonical IDs and rejects unsafe forms
ok 331 - polling fallback normalizes canonical IDs and rejects unsafe forms
  ---
  duration_ms: 0.2651
  type: 'test'
  ...
# Subtest: public HTTP errors expose only stable codes and never raw authentication failures
ok 332 - public HTTP errors expose only stable codes and never raw authentication failures
  ---
  duration_ms: 0.4898
  type: 'test'
  ...
# Subtest: migration 020 is exact, reentrant, CLI-scoped, check-only, and preserves 005/010/011/012 catalogs
ok 333 - migration 020 is exact, reentrant, CLI-scoped, check-only, and preserves 005/010/011/012 catalogs
  ---
  duration_ms: 2011.7397
  type: 'test'
  ...
# {"first_apply":true,"repeated_apply":true,"check_rollback":true,"frozen_catalog_relations":10}
# Subtest: migration 020 fails closed for missing columns, weakened checks, wrong unique, index method and predicate
ok 334 - migration 020 fails closed for missing columns, weakened checks, wrong unique, index method and predicate
  ---
  duration_ms: 6066.459
  type: 'test'
  ...
# {"drift_mutations":["missingcol","weakcheck","wrongunique","indexmethod","indexpred"],"stable_error":"P2_004_SCHEMA_DRIFT_REMEDIATION_REQUIRED"}
# Subtest: Communication service commits atomically, isolates idempotency scopes, and never mutates Session
ok 335 - Communication service commits atomically, isolates idempotency scopes, and never mutates Session
  ---
  duration_ms: 3340.9052
  type: 'test'
  ...
# {"browser_double_click_concurrency":12,"committed_fact_sets":1,"human_ai_same_body_isolated":true,"internal_note_outbox_count":0}
# Subtest: Delivery Worker enforces claim CAS, ACK, retry, dead letter, timeout unknown and lease recovery
ok 336 - Delivery Worker enforces claim CAS, ACK, retry, dead letter, timeout unknown and lease recovery
  ---
  duration_ms: 4608.9228
  type: 'test'
  ...
# {"concurrent_workers":12,"single_claim":true,"gateway_reconnect":true,"timeout_unknown":true,"leased_recovered":true,"sending_not_resent":true}
# Subtest: multi-target delivery is isolated, target rate limit is durable, and reconciliation is explicit
ok 337 - multi-target delivery is isolated, target rate limit is durable, and reconciliation is explicit
  ---
  duration_ms: 2676.8895
  type: 'test'
  ...
# {"multi_target_count":2,"isolated_outcomes":["SENT","DEAD_LETTER"],"target_rate_limit":true,"reconciliation_resolutions":["CONFIRMED_SENT","CONFIRMED_NOT_SENT_REQUEUE","CANCEL"]}
# Subtest: real Worker kill/restart reclaims LEASED but never blindly resends SENDING
ok 338 - real Worker kill/restart reclaims LEASED but never blindly resends SENDING
  ---
  duration_ms: 3090.8631
  type: 'test'
  ...
# {"leased_child_exit":{"code":null,"signal":"SIGKILL"},"leased_restart_sent":true,"sending_child_exit":{"code":null,"signal":"SIGKILL"},"sending_restart_reconciled":true,"blind_resend_count":0}
# Subtest: P1 compatibility is read-only until it delegates to the existing P1 worker
ok 339 - P1 compatibility is read-only until it delegates to the existing P1 worker
  ---
  duration_ms: 2885.755
  type: 'test'
  ...
# {"p1_read_snapshot_unchanged":true,"p1_delivery_delegated":true,"communication_rows_created":0}
# Subtest: 500 deliveries remain bounded at batch 20 and interruption resumes without resource growth
ok 340 - 500 deliveries remain bounded at batch 20 and interruption resumes without resource growth
  ---
  duration_ms: 12665.5902
  type: 'test'
  ...
# {"deliveries":500,"batch_size":20,"interrupted_after":100,"resumed_to":500,"heap_samples":[17369216,20214232,18076072,20968840,18756768,21608664,18511912,21579080,25828272,14313560],"heap_growth_bytes":-3055656,"soak_claimed":false}
# Subtest: P2-004 integration leaves no owned database or backend residual
ok 341 - P2-004 integration leaves no owned database or backend residual
  ---
  duration_ms: 50.463
  type: 'test'
  ...
# {"database_count":0,"backend_count":0,"active_database_count":0,"worker_child_count":0,"worker_count":0,"timer_count":0,"child_process_count":0}
# Subtest: P2-004 JSON Schemas use draft 2020-12 and close object shapes
ok 342 - P2-004 JSON Schemas use draft 2020-12 and close object shapes
  ---
  duration_ms: 8.9406
  type: 'test'
  ...
# Subtest: Reply Command schema and future OpenAPI bind session and idempotency without exposing a target
ok 343 - Reply Command schema and future OpenAPI bind session and idempotency without exposing a target
  ---
  duration_ms: 2.0084
  type: 'test'
  ...
# Subtest: frozen Communication vocabularies are exact
ok 344 - frozen Communication vocabularies are exact
  ---
  duration_ms: 1.4498
  type: 'test'
  ...
# Subtest: normalization freezes Agent, AI, System, internal note and media contracts
ok 345 - normalization freezes Agent, AI, System, internal note and media contracts
  ---
  duration_ms: 1.8727
  type: 'test'
  ...
# Subtest: invalid UUID, row version, privacy, retention, message type, and browser authority are rejected
ok 346 - invalid UUID, row version, privacy, retention, message type, and browser authority are rejected
  ---
  duration_ms: 0.7087
  type: 'test'
  ...
# Subtest: plain JSON fence rejects Proxy, accessor, symbol, toJSON, prototype and pollution keys
ok 347 - plain JSON fence rejects Proxy, accessor, symbol, toJSON, prototype and pollution keys
  ---
  duration_ms: 0.328
  type: 'test'
  ...
# Subtest: plain JSON fence enforces depth, node, string and array bounds
ok 348 - plain JSON fence enforces depth, node, string and array bounds
  ---
  duration_ms: 0.2012
  type: 'test'
  ...
# Subtest: content and command hashes are stable, key-order independent and cover row version
ok 349 - content and command hashes are stable, key-order independent and cover row version
  ---
  duration_ms: 1.0271
  type: 'test'
  ...
# Subtest: destination resolution uses authoritative Thread fields for single and group
ok 350 - destination resolution uses authoritative Thread fields for single and group
  ---
  duration_ms: 0.2881
  type: 'test'
  ...
# Subtest: disabled service performs zero database and authorization work
ok 351 - disabled service performs zero database and authorization work
  ---
  duration_ms: 0.3899
  type: 'test'
  ...
# Subtest: disabled Worker performs zero database and Sender calls
ok 352 - disabled Worker performs zero database and Sender calls
  ---
  duration_ms: 0.3575
  type: 'test'
  ...
# Subtest: Sender Port validates ACK, rejected, unknown and rejects malformed results
ok 353 - Sender Port validates ACK, rejected, unknown and rejects malformed results
  ---
  duration_ms: 0.3645
  type: 'test'
  ...
# Subtest: Mock Sender records only safe call metadata
ok 354 - Mock Sender records only safe call metadata
  ---
  duration_ms: 0.2936
  type: 'test'
  ...
# Subtest: message projection maps Agent, AI, Internal and System without changing ownership
ok 355 - message projection maps Agent, AI, Internal and System without changing ownership
  ---
  duration_ms: 0.3207
  type: 'test'
  ...
# Subtest: delivery timeline and realtime mappers expose only safe delivery fields
ok 356 - delivery timeline and realtime mappers expose only safe delivery fields
  ---
  duration_ms: 0.2397
  type: 'test'
  ...
# Subtest: legacy notification mapping is safe and exact
ok 357 - legacy notification mapping is safe and exact
  ---
  duration_ms: 0.1365
  type: 'test'
  ...
# Subtest: public stable error inventory excludes raw provider and storage details
ok 358 - public stable error inventory excludes raw provider and storage details
  ---
  duration_ms: 0.0997
  type: 'test'
  ...
# Subtest: migration 021 is scoped, reentrant, check-rolls-back, and drift fails closed
ok 359 - migration 021 is scoped, reentrant, check-rolls-back, and drift fails closed
  ---
  duration_ms: 5452.4222
  type: 'test'
  ...
# {"first_apply":true,"repeated_apply":true,"check_rollback":true,"new_tables":4}
# Subtest: takeover is serialized/idempotent; handoff request-accept-release and request-cancel are audited atomically
ok 360 - takeover is serialized/idempotent; handoff request-accept-release and request-cancel are audited atomically
  ---
  duration_ms: 2558.9555
  type: 'test'
  ...
# {"concurrent_winners":1,"idempotent_parallel":12,"handoff":["REQUESTED","ACCEPTED","RELEASED"],"cancel":"CANCELLED"}
# Subtest: admin force transfer works; non-admin, inactive target, wrong-team handler, ended and stale commands fail closed
ok 361 - admin force transfer works; non-admin, inactive target, wrong-team handler, ended and stale commands fail closed
  ---
  duration_ms: 2404.4461
  type: 'test'
  ...
# {"admin_force_transfer":true,"handler_force":false,"inactive":false,"wrong_team":false}
# Subtest: generation race blocks stale AI before Communication and realtime failure rolls back control facts
ok 362 - generation race blocks stale AI before Communication and realtime failure rolls back control facts
  ---
  duration_ms: 2265.892
  type: 'test'
  ...
# {"generation_start":1,"stale":true,"append_communication_calls":0,"message_delta":0,"outbox_delta":0,"delivery_delta":0,"realtime_failure_rollback":true}
# Subtest: 32 principals keep independent monotonic cursors; visibility COUNT is correct and Session versions do not move
ok 363 - 32 principals keep independent monotonic cursors; visibility COUNT is correct and Session versions do not move
  ---
  duration_ms: 2692.8586
  type: 'test'
  ...
# {"principals":32,"monotonic":true,"session_version_unchanged":true,"workbench_unread":1,"restricted_unread":2}
# Subtest: 2C4G bounded capacity covers 500 assignment/handoff facts and 2,000 cursor updates without residual resources
ok 364 - 2C4G bounded capacity covers 500 assignment/handoff facts and 2,000 cursor updates without residual resources
  ---
  duration_ms: 5062.2781
  type: 'test'
  ...
# {"assignments":500,"handoffs":500,"cursor_updates":2000,"max_list_limit":200,"heap_samples":5,"heap_monotonic_unbounded":false,"pool_max":4,"soak_24h":false}
# Subtest: all P2-005 JSON Schemas parse and freeze strict objects
ok 365 - all P2-005 JSON Schemas parse and freeze strict objects
  ---
  duration_ms: 6.008
  type: 'test'
  ...
# Subtest: status, command, event, invalidation, and stable error vocabularies are frozen
ok 366 - status, command, event, invalidation, and stable error vocabularies are frozen
  ---
  duration_ms: 1.7677
  type: 'test'
  ...
# Subtest: normalization is bounded and command hash is stable across key order
ok 367 - normalization is bounded and command hash is stable across key order
  ---
  duration_ms: 1.7511
  type: 'test'
  ...
# Subtest: invalid identifiers, versions, sequences, reason codes, target modes, and extra authority fail closed
ok 368 - invalid identifiers, versions, sequences, reason codes, target modes, and extra authority fail closed
  ---
  duration_ms: 0.7144
  type: 'test'
  ...
# Subtest: non-plain JSON, Proxy, accessor, toJSON, symbol, cycle, and prototype pollution are rejected
ok 369 - non-plain JSON, Proxy, accessor, toJSON, symbol, cycle, and prototype pollution are rejected
  ---
  duration_ms: 0.3346
  type: 'test'
  ...
# Subtest: default authorization rejects every operation
ok 370 - default authorization rejects every operation
  ---
  duration_ms: 0.1706
  type: 'test'
  ...
# Subtest: disabled service returns before every database call and hides raw failures
ok 371 - disabled service returns before every database call and hides raw failures
  ---
  duration_ms: 0.4158
  type: 'test'
  ...
# Subtest: generation fence distinguishes current, stale, and HUMAN-forbidden without process state
ok 372 - generation fence distinguishes current, stale, and HUMAN-forbidden without process state
  ---
  duration_ms: 0.7528
  type: 'test'
  ...
# Subtest: assigned Communication authorizer denies AI flags, inactive/unassigned agents, and accepts assigned active actor
ok 373 - assigned Communication authorizer denies AI flags, inactive/unassigned agents, and accepts assigned active actor
  ---
  duration_ms: 0.4021
  type: 'test'
  ...
# Subtest: Realtime mappers expose versions/status only and no identity or content
ok 374 - Realtime mappers expose versions/status only and no identity or content
  ---
  duration_ms: 0.7135
  type: 'test'
  ...
# Subtest: Timeline mapper uses internal HANDOFF_EVENT and requires explicit privacy/retention
ok 375 - Timeline mapper uses internal HANDOFF_EVENT and requires explicit privacy/retention
  ---
  duration_ms: 0.3206
  type: 'test'
  ...
# Subtest: system browser desktop workbench flow is responsive, refresh-safe and XSS-safe
ok 376 - system browser desktop workbench flow is responsive, refresh-safe and XSS-safe
  ---
  duration_ms: 1773.0148
  type: 'test'
  ...
# {"browser":"C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe","viewport":{"label":"desktop","width":1440,"height":900},"interactions":{"select":1,"takeover":1,"transfer":1,"reply":1,"internal_note":1,"sse_update":true,"polling_fallback":true,"filter":true,"refresh_restore":true},"keyboard_focus_visible":true,"security_headers":true,"xss_executed":false,"horizontal_overflow":false}
# Subtest: system browser mobile workbench flow is responsive, refresh-safe and XSS-safe
ok 377 - system browser mobile workbench flow is responsive, refresh-safe and XSS-safe
  ---
  duration_ms: 1683.2218
  type: 'test'
  ...
# {"browser":"C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe","viewport":{"label":"mobile","width":390,"height":844},"interactions":{"select":1,"takeover":1,"transfer":1,"reply":1,"internal_note":1,"sse_update":true,"polling_fallback":true,"filter":true,"refresh_restore":true},"keyboard_focus_visible":true,"security_headers":true,"xss_executed":false,"horizontal_overflow":false}
# Subtest: system browser renders the same Workbench LocalDateTime under UTC, Tokyo, and New York
ok 378 - system browser renders the same Workbench LocalDateTime under UTC, Tokyo, and New York
  ---
  duration_ms: 923.3495
  type: 'test'
  ...
# Subtest: P2-006 applies no DDL and leaves no isolated PostgreSQL resources
ok 379 - P2-006 applies no DDL and leaves no isolated PostgreSQL resources
  ---
  duration_ms: 2615.3511
  type: 'test'
  ...
# {"migration_022":true,"catalog_unchanged":true,"feature_enabled_only_in_test":true}
# Subtest: admin/dispatcher/handler authorization is enforced in SQL data access and timeline visibility
ok 380 - admin/dispatcher/handler authorization is enforced in SQL data access and timeline visibility
  ---
  duration_ms: 2695.0563
  type: 'test'
  ...
# {"admin_sessions":2,"dispatcher_sessions":2,"assigned_handler_sessions":1,"outsider_sessions":0,"reporter_forbidden":true,"inactive_forbidden":true,"restricted_hidden_from_handler":true}
# Subtest: 500 conversations and 10,000 items have duplicate-free keyset pages and bounded read latency
ok 381 - 500 conversations and 10,000 items have duplicate-free keyset pages and bounded read latency
  ---
  duration_ms: 59137.9703
  type: 'test'
  ...
# {"sessions":500,"items":10000,"assignments":500,"tickets":500,"deliveries":500,"list_requests":1000,"detail_requests":1000,"keyset_unique":true,"p95":{"list_ms":60.391,"detail_ms":14.15}}
# Subtest: workbench facade commits human reply, internal note, takeover and idempotent replay through P2-004/P2-005 ports
ok 382 - workbench facade commits human reply, internal note, takeover and idempotent replay through P2-004/P2-005 ports
  ---
  duration_ms: 3724.974
  type: 'test'
  ...
# {"takeover":true,"replayed":true,"transfer":true,"release":true,"handoff_request_cancel":true,"read_cursor":1,"external_messages":1,"internal_notes":1,"external_outbox":1,"internal_outbox":0,"pending_retry":true,"dead_letter_requeue":true,"reconciliation_required_blocks_retry":true,"admin_reconciliation":true}
# Subtest: 200 real HTTP reply commits and 12-way duplicate submit remain bounded without sender calls or socket residue
ok 383 - 200 real HTTP reply commits and 12-way duplicate submit remain bounded without sender calls or socket residue
  ---
  duration_ms: 7872.8257
  type: 'test'
  ...
# {"reply_http":{"samples":200,"p50_ms":15.737,"p95_ms":24.871,"p99_ms":29.981,"max_ms":60.147},"duplicate_submit_parallel":12,"messages":201,"outboxes":201,"deliveries":201,"sender_calls":0,"heap_samples_bytes":[17514256,25648608,22910624,30215232,19800648,27242888,22994768,30110816],"pool_max":4}
# Subtest: P2-003 SSE route delivers committed messages through authorized refetch within 2 seconds and releases timers
ok 384 - P2-003 SSE route delivers committed messages through authorized refetch within 2 seconds and releases timers
  ---
  duration_ms: 5261.1741
  type: 'test'
  ...
# {"new_message_commit_sse_refetch":{"samples":100,"p50_ms":18.442,"p95_ms":24.797,"p99_ms":54.97,"max_ms":113.912},"authorized_events":100,"unauthorized_events":0}
# Subtest: workbench schemas parse and OpenAPI 3.1 exposes every implemented route
ok 385 - workbench schemas parse and OpenAPI 3.1 exposes every implemented route
  ---
  duration_ms: 9.2881
  type: 'test'
  ...
# Subtest: opaque cursor round-trips normalized timestamp and session id
ok 386 - opaque cursor round-trips normalized timestamp and session id
  ---
  duration_ms: 2.1946
  type: 'test'
  ...
# Subtest: opaque cursor rejects malformed, oversized, and structurally extended values
ok 387 - opaque cursor rejects malformed, oversized, and structurally extended values
  ---
  duration_ms: 0.8339
  type: 'test'
  ...
# Subtest: disabled query service performs zero database and authorization calls
ok 388 - disabled query service performs zero database and authorization calls
  ---
  duration_ms: 0.6442
  type: 'test'
  ...
# Subtest: list SQL applies authorization in WHERE before keyset ORDER BY and LIMIT
ok 389 - list SQL applies authorization in WHERE before keyset ORDER BY and LIMIT
  ---
  duration_ms: 0.7173
  type: 'test'
  ...
# Subtest: query page limit and state filters fail closed
ok 390 - query page limit and state filters fail closed
  ---
  duration_ms: 1.0873
  type: 'test'
  ...
# Subtest: HTTP server construction fails when authentication port is absent
ok 391 - HTTP server construction fails when authentication port is absent
  ---
  duration_ms: 0.5822
  type: 'test'
  ...
# Subtest: HTTP API rejects unauthenticated and expired contexts without fallback
ok 392 - HTTP API rejects unauthenticated and expired contexts without fallback
  ---
  duration_ms: 63.1438
  type: 'test'
  ...
# Subtest: Cookie writes require exact origin, same-site context, constant-time CSRF and matching idempotency
ok 393 - Cookie writes require exact origin, same-site context, constant-time CSRF and matching idempotency
  ---
  duration_ms: 38.9793
  type: 'test'
  ...
# Subtest: Bearer mode requires Authorization header and tokens in query are forbidden
ok 394 - Bearer mode requires Authorization header and tokens in query are forbidden
  ---
  duration_ms: 11.5023
  type: 'test'
  ...
# Subtest: HTTP security headers contain strict CSP without inline or eval and no wildcard CORS
ok 395 - HTTP security headers contain strict CSP without inline or eval and no wildcard CORS
  ---
  duration_ms: 6.866
  type: 'test'
  ...
# Subtest: non-JSON and oversized write bodies are rejected with stable public errors
ok 396 - non-JSON and oversized write bodies are rejected with stable public errors
  ---
  duration_ms: 13.4179
  type: 'test'
  ...
# Subtest: command facade delegates frozen control and communication ports without sender access
ok 397 - command facade delegates frozen control and communication ports without sender access
  ---
  duration_ms: 1.8578
  type: 'test'
  ...
# Subtest: UI source renders untrusted content through text nodes only
ok 398 - UI source renders untrusted content through text nodes only
  ---
  duration_ms: 0.8054
  type: 'test'
  ...
# Subtest: UI reducer bounds conversations and timeline arrays
ok 399 - UI reducer bounds conversations and timeline arrays
  ---
  duration_ms: 1.2388
  type: 'test'
  ...
# Subtest: refresh storage persists only selected id and filter
ok 400 - refresh storage persists only selected id and filter
  ---
  duration_ms: 0.5459
  type: 'test'
  ...
# Subtest: P2-006 creates no migration and static preview check succeeds
ok 401 - P2-006 creates no migration and static preview check succeeds
  ---
  duration_ms: 150.6937
  type: 'test'
  ...
# Subtest: P2-012 real command capacity 500 candidates, 200 incidents, 2000 reports, 1000 subscriptions, 5000 events, 500 bindings and 32 SSE
ok 402 - P2-012 real command capacity 500 candidates, 200 incidents, 2000 reports, 1000 subscriptions, 5000 events, 500 bindings and 32 SSE
  ---
  duration_ms: 49042.1849
  type: 'test'
  ...
# {"candidates":500,"incidents":200,"reports":2000,"subscriptions":1000,"events":5200,"bindings":550,"notification_sent":550,"pool_max":4,"sse_max":32,"sse_after_stop":0,"heap_samples_bytes":[15176904,34988864,80160600,71284752,73969168,41972392,62175240,82555384,49896104,70260224,36918584,55847784,18020848],"heap_peak_bytes":82555384,"heap_final_bytes":18020848,"real_sdk_calls":0,"model_calls":0}
# {"cleanup":{"database_count":0,"backend_count":0}}
# Subtest: P2-012 real TypeScript consumers accept nullable cursors and optional owner teams
ok 403 - P2-012 real TypeScript consumers accept nullable cursors and optional owner teams
  ---
  duration_ms: 549.5218
  type: 'test'
  ...
# Subtest: P2-012 parsed OpenAPI incident state filters match all runtime states and queue aliases
ok 404 - P2-012 parsed OpenAPI incident state filters match all runtime states and queue aliases
  ---
  duration_ms: 538.8684
  type: 'test'
  ...
# Subtest: P2-012 closes input shapes, rejects hostile values and preserves deterministic command hashes
ok 405 - P2-012 closes input shapes, rejects hostile values and preserves deterministic command hashes
  ---
  duration_ms: 4.1299
  type: 'test'
  ...
# Subtest: P2-012 stable HTTP matrix is exhaustive, deterministic and rejects hostile results without executing code
ok 406 - P2-012 stable HTTP matrix is exhaustive, deterministic and rejects hostile results without executing code
  ---
  duration_ms: 33.6644
  type: 'test'
  ...
# Subtest: P2-012 maintenance expires a bounded ordered batch through private SYSTEM commands without notifications
ok 407 - P2-012 maintenance expires a bounded ordered batch through private SYSTEM commands without notifications
  ---
  duration_ms: 3523.3572
  type: 'test'
  ...
# Subtest: P2-012 maintenance replays concurrent scans, handles human/time races and surfaces a still-due failure
ok 408 - P2-012 maintenance replays concurrent scans, handles human/time races and surfaces a still-due failure
  ---
  duration_ms: 5808.0442
  type: 'test'
  ...
# Subtest: P2-012 maintenance scans after import and expires an imported due candidate in the same iteration
ok 409 - P2-012 maintenance scans after import and expires an imported due candidate in the same iteration
  ---
  duration_ms: 1620.9213
  type: 'test'
  ...
# Subtest: P2-012 real database human confirmation, idempotency, recovery isolation and notification facts
ok 410 - P2-012 real database human confirmation, idempotency, recovery isolation and notification facts
  ---
  duration_ms: 2907.1164
  type: 'test'
  ...
# Subtest: dynamic live configuration requires an approved group but no preconfigured Reporter userid hash
ok 411 - dynamic live configuration requires an approved group but no preconfigured Reporter userid hash
  ---
  duration_ms: 5.0906
  type: 'test'
  ...
# Subtest: dynamic Sender rechecks the persisted approved-group Reporter before each PERSON provider call
ok 412 - dynamic Sender rechecks the persisted approved-group Reporter before each PERSON provider call
  ---
  duration_ms: 2.1043
  type: 'test'
  ...
# Subtest: approved test group discovers an unconfigured Reporter before their direct flow and outbound notice
ok 413 - approved test group discovers an unconfigured Reporter before their direct flow and outbound notice
  ---
  duration_ms: 1.2141
  type: 'test'
  ...
# Subtest: P2-012 migration 032 applies atomically, detects catalog drift and preserves seven-table scope
ok 414 - P2-012 migration 032 applies atomically, detects catalog drift and preserves seven-table scope
  ---
  duration_ms: 3622.5492
  type: 'test'
  ...
# Subtest: P2-012 fresh current baseline reaches 032 and repeated status/check/apply preserve the catalog
ok 415 - P2-012 fresh current baseline reaches 032 and repeated status/check/apply preserve the catalog
  ---
  duration_ms: 3802.4207
  type: 'test'
  ...
# Subtest: P2-012 network-off three-role assembly serves Incident and closes children, sockets and pools
ok 416 - P2-012 network-off three-role assembly serves Incident and closes children, sockets and pools
  ---
  duration_ms: 5314.148
  type: 'test'
  ...
# {"network_enabled":false,"restarted":false,"metrics":{"process_count":3,"gateway_authenticated":0,"gateway_reconnect_total":0,"app_rss_bytes":86020096,"app_heap_used_bytes":20617840,"app_heap_total_bytes":33865728,"app_external_bytes":4567169,"app_cpu_percent":15.93,"app_event_loop_delay_p95_ms":32.079871,"app_active_resources":8,"app_active_timers":2,"app_active_sockets":6,"app_active_file_handles":0,"app_active_handles":6,"app_uptime_seconds":1.71,"app_pool_total":2,"app_pool_idle":2,"app_pool_waiting":0,"app_pool_max":4,"worker_rss_bytes":92229632,"worker_heap_used_bytes":19141448,"worker_heap_total_bytes":33865728,"worker_external_bytes":4477341,"worker_cpu_percent":24.103,"worker_event_loop_delay_p95_ms":32.047103,"worker_active_resources":4,"worker_active_timers":2,"worker_active_sockets":2,"worker_active_file_handles":0,"worker_active_handles":2,"worker_uptime_seconds":1.7,"worker_pool_total":1,"worker_pool_idle":1,"worker_pool_waiting":0,"worker_pool_max":2,"gateway_rss_bytes":79925248,"gateway_heap_used_bytes":12701240,"gateway_heap_total_bytes":31604736,"gateway_external_bytes":4206782,"gateway_cpu_percent":2.233,"gateway_event_loop_delay_p95_ms":32.129023,"gateway_active_resources":2,"gateway_active_timers":1,"gateway_active_sockets":1,"gateway_active_file_handles":0,"gateway_active_handles":1,"gateway_uptime_seconds":1.729,"gateway_pool_total":0,"gateway_pool_idle":0,"gateway_pool_waiting":0,"gateway_pool_max":1,"total_rss_bytes":258174976,"total_heap_used_bytes":52460528,"total_cpu_percent":42.266,"sse_clients":0,"projection_backlog":0,"projection_failures":0,"communication_pending":1,"dead_letter":0,"reconciliation_required":0,"postgres_active_connections":1,"postgres_idle_connections":4,"postgres_other_connections":0,"postgres_max_connections":100,"postgres_connection_utilization_percent":5}}
# {"network_enabled":false,"restarted":true,"metrics":{"process_count":3,"gateway_authenticated":0,"gateway_reconnect_total":0,"app_rss_bytes":82845696,"app_heap_used_bytes":15038888,"app_heap_total_bytes":33341440,"app_external_bytes":4334348,"app_cpu_percent":32.2,"app_event_loop_delay_p95_ms":33.062911,"app_active_resources":6,"app_active_timers":1,"app_active_sockets":5,"app_active_file_handles":0,"app_active_handles":5,"app_uptime_seconds":0.459,"app_pool_total":1,"app_pool_idle":1,"app_pool_waiting":0,"app_pool_max":4,"worker_rss_bytes":89849856,"worker_heap_used_bytes":13333552,"worker_heap_total_bytes":31866880,"worker_external_bytes":4206782,"worker_cpu_percent":24.543,"worker_event_loop_delay_p95_ms":31.195135,"worker_active_resources":2,"worker_active_timers":1,"worker_active_sockets":1,"worker_active_file_handles":0,"worker_active_handles":1,"worker_uptime_seconds":0.456,"worker_pool_total":0,"worker_pool_idle":0,"worker_pool_waiting":0,"worker_pool_max":2,"gateway_rss_bytes":79986688,"gateway_heap_used_bytes":12689792,"gateway_heap_total_bytes":31604736,"gateway_external_bytes":4206782,"gateway_cpu_percent":0,"gateway_event_loop_delay_p95_ms":31.277055,"gateway_active_resources":2,"gateway_active_timers":1,"gateway_active_sockets":1,"gateway_active_file_handles":0,"gateway_active_handles":1,"gateway_uptime_seconds":0.465,"gateway_pool_total":0,"gateway_pool_idle":0,"gateway_pool_waiting":0,"gateway_pool_max":1,"total_rss_bytes":252682240,"total_heap_used_bytes":41062232,"total_cpu_percent":56.743,"sse_clients":0,"projection_backlog":0,"projection_failures":0,"communication_pending":1,"dead_letter":0,"reconciliation_required":0,"postgres_active_connections":2,"postgres_idle_connections":2,"postgres_other_connections":0,"postgres_max_connections":100,"postgres_connection_utilization_percent":4}}
# Subtest: P2-012 Reporter HTTP preserves bound grants, refresh ETag, safe milestones and unlink visibility
ok 417 - P2-012 Reporter HTTP preserves bound grants, refresh ETag, safe milestones and unlink visibility
  ---
  duration_ms: 2346.2535
  type: 'test'
  ...
# Subtest: P2-012 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
ok 418 - P2-012 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
  ---
  duration_ms: 5317.3453
  type: 'test'
  ...
# {"server_commit_response_lost":true,"restart_replayed":true,"incident_confirmed_event_count":1,"unknown_recovery_send_calls":0,"authorized_retry_calls":1,"ack_restart_send_calls":0}
# Subtest: P2-012 both parsed OpenAPI documents declare canonical subscription destinations and service failures
ok 419 - P2-012 both parsed OpenAPI documents declare canonical subscription destinations and service failures
  ---
  duration_ms: 905.4643
  type: 'test'
  ...
# Subtest: P2-012 static authorization, frozen predecessors, scope, schemas and synthetic fixture gate
ok 420 - P2-012 static authorization, frozen predecessors, scope, schemas and synthetic fixture gate
  ---
  duration_ms: 3699.3957
  type: 'test'
  ...
# Subtest: P2-012 live runner fails before network/listener unless all five independent fuses and verified evidence exist
ok 421 - P2-012 live runner fails before network/listener unless all five independent fuses and verified evidence exist
  ---
  duration_ms: 1.0556
  type: 'test'
  ...
# Subtest: P2-012 readiness cannot be fabricated from partial regression, skips, changed inputs or live claims
ok 422 - P2-012 readiness cannot be fabricated from partial regression, skips, changed inputs or live claims
  ---
  duration_ms: 0.2748
  type: 'test'
  ...
# Subtest: P2-012 DONE requires the approved live candidate, client confirmation, clean Incident deliveries and complete regressions
ok 423 - P2-012 DONE requires the approved live candidate, client confirmation, clean Incident deliveries and complete regressions
  ---
  duration_ms: 0.2544
  type: 'test'
  ...
# Subtest: P2-012 frozen candidate permits only the explicit closeout governance set
ok 424 - P2-012 frozen candidate permits only the explicit closeout governance set
  ---
  duration_ms: 0.2346
  type: 'test'
  ...
# Subtest: P2-012 review hardening preserves exact paths and requires independent current regression evidence
ok 425 - P2-012 review hardening preserves exact paths and requires independent current regression evidence
  ---
  duration_ms: 0.2871
  type: 'test'
  ...
# Subtest: P2-012 v2 HTTP OpenAPI hardening has an independent closed allowlist and complete regression gate
ok 426 - P2-012 v2 HTTP OpenAPI hardening has an independent closed allowlist and complete regression gate
  ---
  duration_ms: 0.3315
  type: 'test'
  ...
# Subtest: P2-012 subscription review preserves its baseline, scope and independent regression
ok 427 - P2-012 subscription review preserves its baseline, scope and independent regression
  ---
  duration_ms: 0.3027
  type: 'test'
  ...
# Subtest: P2-012 paused destination review is bounded and preserves previous full regression evidence
ok 428 - P2-012 paused destination review is bounded and preserves previous full regression evidence
  ---
  duration_ms: 0.3028
  type: 'test'
  ...
# Subtest: P2-012 incomplete persisted Candidate summary remains explicit and does not invent clustering evidence
ok 429 - P2-012 incomplete persisted Candidate summary remains explicit and does not invent clustering evidence
  ---
  duration_ms: 2.2459
  type: 'test'
  ...
# Subtest: P2-012 four scope permissions, authorization before replay, expiry maintenance and closed schemas
ok 430 - P2-012 four scope permissions, authorization before replay, expiry maintenance and closed schemas
  ---
  duration_ms: 2811.0592
  type: 'test'
  ...
# Subtest: P2-012 approved-group Reporter discovery persists before direct intake, Sender scope and database guard
ok 431 - P2-012 approved-group Reporter discovery persists before direct intake, Sender scope and database guard
  ---
  duration_ms: 2373.4107
  type: 'test'
  ...
# Subtest: P2-012 real direct-leg eligibility suppresses group-only Ticket artifacts and validates persisted destination scope
ok 432 - P2-012 real direct-leg eligibility suppresses group-only Ticket artifacts and validates persisted destination scope
  ---
  duration_ms: 2460.2281
  type: 'test'
  ...
# Subtest: P2-012 cross-channel same reporter, pending activation, pause, unlink and reporter-safe history
ok 433 - P2-012 cross-channel same reporter, pending activation, pause, unlink and reporter-safe history
  ---
  duration_ms: 2508.5663
  type: 'test'
  ...
# Subtest: P2-012 fixed notices reuse sender, restart persistence, explicit UNKNOWN reconciliation and no blind resend
ok 434 - P2-012 fixed notices reuse sender, restart persistence, explicit UNKNOWN reconciliation and no blind resend
  ---
  duration_ms: 2316.3033
  type: 'test'
  ...
# Subtest: P2-012 expired direct destinations cannot activate subscriptions and pending reopen never claims activation
ok 435 - P2-012 expired direct destinations cannot activate subscriptions and pending reopen never claims activation
  ---
  duration_ms: 2315.5629
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 1440x900 human confirmation, refresh and accessibility
ok 436 - P2-012 database-backed browser 1440x900 human confirmation, refresh and accessibility
  ---
  duration_ms: 5255.2486
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 1366x768 human confirmation, refresh and accessibility
ok 437 - P2-012 database-backed browser 1366x768 human confirmation, refresh and accessibility
  ---
  duration_ms: 5448.857
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 390x844 human confirmation, refresh and accessibility
ok 438 - P2-012 database-backed browser 390x844 human confirmation, refresh and accessibility
  ---
  duration_ms: 6086.4023
  type: 'test'
  ...
# Subtest: P2-012 actual HTTP inherits authentication, CSRF, command fence and durable realtime
ok 439 - P2-012 actual HTTP inherits authentication, CSRF, command fence and durable realtime
  ---
  duration_ms: 2199.6236
  type: 'test'
  ...
# Subtest: P2-012 actual HTTP preserves notification failure, rollback and durable replay before explicit recovery
ok 440 - P2-012 actual HTTP preserves notification failure, rollback and durable replay before explicit recovery
  ---
  duration_ms: 3242.4677
  type: 'test'
  ...
# Subtest: reporter identity is HMAC-bound and directory failures defer safely
ok 441 - reporter identity is HMAC-bound and directory failures defer safely
  ---
  duration_ms: 2.6379
  type: 'test'
  ...
# Subtest: direct association follows reliable priorities and never uses userid plus time
ok 442 - direct association follows reliable priorities and never uses userid plus time
  ---
  duration_ms: 2.4768
  type: 'test'
  ...
# Subtest: manual review internal query and resolve default deny before storage access
ok 443 - manual review internal query and resolve default deny before storage access
  ---
  duration_ms: 2.6551
  type: 'test'
  ...
# Subtest: migration 030 supports fresh baseline, check rollback, apply, no-op and five drift failures
ok 444 - migration 030 supports fresh baseline, check rollback, apply, no-op and five drift failures
  ---
  duration_ms: 4256.1791
  type: 'test'
  ...
# Subtest: orchestrator persists three entries, keeps threads separate and replays Ticket/Communication safely
ok 445 - orchestrator persists three entries, keeps threads separate and replays Ticket/Communication safely
  ---
  duration_ms: 2761.8338
  type: 'test'
  ...
# Subtest: rule failure reaches review; authorized keyset query and concurrent human resolution append one override
ok 446 - rule failure reaches review; authorized keyset query and concurrent human resolution append one override
  ---
  duration_ms: 2418.1658
  type: 'test'
  ...
# Subtest: continuation refs are hashed, reporter/bot bound, expiring, revocable and single-use
ok 447 - continuation refs are hashed, reporter/bot bound, expiring, revocable and single-use
  ---
  duration_ms: 2603.8551
  type: 'test'
  ...
# Subtest: migration 001 through 022 and P2-007 runtime are unchanged from origin/main
ok 448 - migration 001 through 022 and P2-007 runtime are unchanged from origin/main
  ---
  duration_ms: 54.374
  type: 'test'
  ...
# Subtest: strict feature flags default false and reject non-canonical values
ok 449 - strict feature flags default false and reject non-canonical values
  ---
  duration_ms: 2.8394
  type: 'test'
  ...
# Subtest: ordinary JSON boundary rejects proxy, accessor, symbol, toJSON, cycles and pollution keys
ok 450 - ordinary JSON boundary rejects proxy, accessor, symbol, toJSON, cycles and pollution keys
  ---
  duration_ms: 0.4178
  type: 'test'
  ...
# Subtest: router protects faults from acknowledgement and maps required examples
ok 451 - router protects faults from acknowledgement and maps required examples
  ---
  duration_ms: 64.518
  type: 'test'
  ...
# Subtest: ten result codes are reachable and deterministic
ok 452 - ten result codes are reachable and deterministic
  ---
  duration_ms: 92.0497
  type: 'test'
  ...
# Subtest: clinical high risk reaches review and unsupported root cause is never confirmed
ok 453 - clinical high risk reaches review and unsupported root cause is never confirmed
  ---
  duration_ms: 34.249
  type: 'test'
  ...
# Subtest: gold manifest references all 96 + 42 + 64 frozen cases with ten routes
ok 454 - gold manifest references all 96 + 42 + 64 frozen cases with ten routes
  ---
  duration_ms: 3.5297
  type: 'test'
  ...
# Subtest: crash before commit leaves no partial facts; crash after commit restarts as replay
ok 455 - crash before commit leaves no partial facts; crash after commit restarts as replay
  ---
  duration_ms: 3017.6147
  type: 'test'
  ...
# {"crash_before_commit_partial_facts":{"journeys":0,"decisions":0,"tickets":0},"crash_after_commit":{"journeys":1,"decisions":1,"tickets":1},"restart_processed":0,"replay_duplicate_delta":0}
# Subtest: bounded worker processes 500 journeys, 2000 turns, 500 decisions and 100 reviews on one worker
ok 456 - bounded worker processes 500 journeys, 2000 turns, 500 decisions and 100 reviews on one worker
  ---
  duration_ms: 15465.2717
  type: 'test'
  ...
# {"journeys":500,"turns":2000,"decisions":500,"reviews":100,"worker_count":1,"pool_max":4,"batch_max":100,"heap_samples_bytes":[16621056,16638320,23093424,16986920,12377976,22306936],"heap_fall_or_stable":true,"timer_active_after_stop":false,"soak_24h":false}
# Subtest: worker defaults are bounded and disabled flags claim nothing
ok 457 - worker defaults are bounded and disabled flags claim nothing
  ---
  duration_ms: 2.7765
  type: 'test'
  ...
# Subtest: worker rejects batches above maximum without querying storage
ok 458 - worker rejects batches above maximum without querying storage
  ---
  duration_ms: 0.6578
  type: 'test'
  ...
# Subtest: P2-016 bounded capacity: 500 Tickets / 5000 events / 200 review resolutions / 500 cards / 100 sessions / 32 SSE
ok 459 - P2-016 bounded capacity: 500 Tickets / 5000 events / 200 review resolutions / 500 cards / 100 sessions / 32 SSE
  ---
  duration_ms: 91077.4342
  type: 'test'
  ...
# {"tickets":500,"ticket_events":5000,"review_resolutions":200,"cards":500,"group_receipts":400,"reporter_sessions":100,"pool_max":4,"sse_max":32,"sse_after_stop":0,"heap_samples_bytes":[14522832,30708368,37001376,28726040,62620696,54111328,69008864,34126560,18370336,39881584,17955928,39395120,19536784,41373984,21102856,42940832,23029432,44752440,23111920,39323568,55723856,22275696,40933952,56896304,21832864,37517904,53447984,63942256,79401288,19237248],"heap_peak_bytes":79401288,"heap_final_bytes":19237248,"heap_fall_or_stable":true,"real_sdk_calls":0,"soak_24h":false}
# {"cleanup":{"database_count":0,"backend_count":0}}
# Subtest: P2-016 plain JSON excludes active objects without invoking user hooks
ok 460 - P2-016 plain JSON excludes active objects without invoking user hooks
  ---
  duration_ms: 3.7911
  type: 'test'
  ...
# Subtest: P2-016 strict command, versions, closed keys and bounded lists
ok 461 - P2-016 strict command, versions, closed keys and bounded lists
  ---
  duration_ms: 2.3112
  type: 'test'
  ...
# Subtest: notification policy includes created
ok 462 - notification policy includes created
  ---
  duration_ms: 0.2356
  type: 'test'
  ...
# Subtest: notification policy includes accepted
ok 463 - notification policy includes accepted
  ---
  duration_ms: 0.114
  type: 'test'
  ...
# Subtest: notification policy includes started
ok 464 - notification policy includes started
  ---
  duration_ms: 0.1144
  type: 'test'
  ...
# Subtest: notification policy includes resumed
ok 465 - notification policy includes resumed
  ---
  duration_ms: 0.1323
  type: 'test'
  ...
# Subtest: notification policy includes waiting_requester
ok 466 - notification policy includes waiting_requester
  ---
  duration_ms: 0.1011
  type: 'test'
  ...
# Subtest: notification policy includes waiting_vendor
ok 467 - notification policy includes waiting_vendor
  ---
  duration_ms: 0.0931
  type: 'test'
  ...
# Subtest: notification policy includes resolved
ok 468 - notification policy includes resolved
  ---
  duration_ms: 0.1123
  type: 'test'
  ...
# Subtest: notification policy includes closed
ok 469 - notification policy includes closed
  ---
  duration_ms: 0.2187
  type: 'test'
  ...
# Subtest: notification policy includes reopened
ok 470 - notification policy includes reopened
  ---
  duration_ms: 0.1044
  type: 'test'
  ...
# Subtest: notification policy includes cancelled
ok 471 - notification policy includes cancelled
  ---
  duration_ms: 0.1294
  type: 'test'
  ...
# Subtest: notes and assignment changes never become external free-text notifications
ok 472 - notes and assignment changes never become external free-text notifications
  ---
  duration_ms: 0.1286
  type: 'test'
  ...
# Subtest: template card exact shape, last-four and safe immutable view
ok 473 - template card exact shape, last-four and safe immutable view
  ---
  duration_ms: 1.2937
  type: 'test'
  ...
# Subtest: card rejects unsafe origin javascript:alert(1)
ok 474 - card rejects unsafe origin javascript:alert(1)
  ---
  duration_ms: 0.223
  type: 'test'
  ...
# Subtest: card rejects unsafe origin data:text/html,x
ok 475 - card rejects unsafe origin data:text/html,x
  ---
  duration_ms: 0.1352
  type: 'test'
  ...
# Subtest: card rejects unsafe origin file:///x
ok 476 - card rejects unsafe origin file:///x
  ---
  duration_ms: 0.0839
  type: 'test'
  ...
# Subtest: card rejects unsafe origin http://reporter.example.test
ok 477 - card rejects unsafe origin http://reporter.example.test
  ---
  duration_ms: 0.0821
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://attacker.invalid
ok 478 - card rejects unsafe origin https://attacker.invalid
  ---
  duration_ms: 0.0658
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://[userinfo]@reporter.example.test
ok 479 - card rejects unsafe origin https://[userinfo]@reporter.example.test
  ---
  duration_ms: 0.0504
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://reporter.example.test/?grant=abc
ok 480 - card rejects unsafe origin https://reporter.example.test/?grant=abc
  ---
  duration_ms: 0.0582
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://reporter.example.test/\#x
ok 481 - card rejects unsafe origin https://reporter.example.test/\#x
  ---
  duration_ms: 0.0624
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://reporter.example.test/path
ok 482 - card rejects unsafe origin https://reporter.example.test/path
  ---
  duration_ms: 0.0518
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":0}
ok 483 - sender accepts only explicit numeric ACK {"errcode":0}
  ---
  duration_ms: 1.3942
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"body":{"errcode":0}}
ok 484 - sender accepts only explicit numeric ACK {"body":{"errcode":0}}
  ---
  duration_ms: 0.4985
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {}
ok 485 - sender accepts only explicit numeric ACK {}
  ---
  duration_ms: 0.3644
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":"0"}
ok 486 - sender accepts only explicit numeric ACK {"errcode":"0"}
  ---
  duration_ms: 1.0459
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":null}
ok 487 - sender accepts only explicit numeric ACK {"errcode":null}
  ---
  duration_ms: 0.3206
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":40001}
ok 488 - sender accepts only explicit numeric ACK {"errcode":40001}
  ---
  duration_ms: 0.2893
  type: 'test'
  ...
# Subtest: sender fail-closed {"enabled":false}
ok 489 - sender fail-closed {"enabled":false}
  ---
  duration_ms: 0.1503
  type: 'test'
  ...
# Subtest: sender fail-closed {"cardEnabled":false}
ok 490 - sender fail-closed {"cardEnabled":false}
  ---
  duration_ms: 0.0778
  type: 'test'
  ...
# Subtest: sender fail-closed {"target":"not-allowlisted"}
ok 491 - sender fail-closed {"target":"not-allowlisted"}
  ---
  duration_ms: 0.1366
  type: 'test'
  ...
# Subtest: sender fail-closed {"binding":false}
ok 492 - sender fail-closed {"binding":false}
  ---
  duration_ms: 0.1994
  type: 'test'
  ...
# Subtest: gateway unavailable before network is retry-safe, no SDK call
ok 493 - gateway unavailable before network is retry-safe, no SDK call
  ---
  duration_ms: 0.5761
  type: 'test'
  ...
# Subtest: live inbound is clipped before persistence by approved bot, person and group hashes
ok 494 - live inbound is clipped before persistence by approved bot, person and group hashes
  ---
  duration_ms: 0.7849
  type: 'test'
  ...
# Subtest: Ticket delivery operator commands authorize before receipt, persist idempotence and never blindly retry UNKNOWN
ok 495 - Ticket delivery operator commands authorize before receipt, persist idempotence and never blindly retry UNKNOWN
  ---
  duration_ms: 2037.1969
  type: 'test'
  ...
# Subtest: P2-016 real-format group wakeup and direct description remain one Journey through public queries
ok 496 - P2-016 real-format group wakeup and direct description remain one Journey through public queries
  ---
  duration_ms: 2257.0912
  type: 'test'
  ...
# Subtest: P2-016 group-to-direct unique binding preserves Journey; ambiguous, consumed and expired candidates never guess
ok 497 - P2-016 group-to-direct unique binding preserves Journey; ambiguous, consumed and expired candidates never guess
  ---
  duration_ms: 8078.9802
  type: 'test'
  ...
# Subtest: P2-016 later same-group description preserves the recorded entry mode instead of rejecting the Journey
ok 498 - P2-016 later same-group description preserves the recorded entry mode instead of rejecting the Journey
  ---
  duration_ms: 2019.7805
  type: 'test'
  ...
# Subtest: P2-016 approved topology uses three real bounded processes, rule-first Worker and zero live SDK calls
ok 499 - P2-016 approved topology uses three real bounded processes, rule-first Worker and zero live SDK calls
  ---
  duration_ms: 3943.081
  type: 'test'
  ...
# {"process_count":3,"pool_max":7,"live_provider_calls":0,"rule_first_worker":true}
# Subtest: P2-016 live harness requires exact owner fuses and HTTPS bounded configuration, without logging secrets
ok 500 - P2-016 live harness requires exact owner fuses and HTTPS bounded configuration, without logging secrets
  ---
  duration_ms: 3.4046
  type: 'test'
  ...
# Subtest: P2-016 live requires an exact verified candidate and at least 15 minutes; cannot claim final completion
ok 501 - P2-016 live requires an exact verified candidate and at least 15 minutes; cannot claim final completion
  ---
  duration_ms: 0.4211
  type: 'test'
  ...
# Subtest: P2-016 live CLI with no approvals exits before DB, listener, Evidence or SDK work
ok 502 - P2-016 live CLI with no approvals exits before DB, listener, Evidence or SDK work
  ---
  duration_ms: 261.6622
  type: 'test'
  ...
# Subtest: P2-016 review resolution and Safe Action commit or roll back together
ok 503 - P2-016 review resolution and Safe Action commit or roll back together
  ---
  duration_ms: 3987.7027
  type: 'test'
  ...
# Subtest: P2-016 migration is atomic, check-only, exact, reentrant and drift-failing
    # Subtest: rejects table drift
    ok 1 - rejects table drift
      ---
      duration_ms: 41.1281
      type: 'test'
      ...
    # Subtest: rejects column drift
    ok 2 - rejects column drift
      ---
      duration_ms: 26.4979
      type: 'test'
      ...
    # Subtest: rejects type drift
    ok 3 - rejects type drift
      ---
      duration_ms: 37.7876
      type: 'test'
      ...
    # Subtest: rejects default drift
    ok 4 - rejects default drift
      ---
      duration_ms: 25.146
      type: 'test'
      ...
    # Subtest: rejects constraint drift
    ok 5 - rejects constraint drift
      ---
      duration_ms: 23.8984
      type: 'test'
      ...
    # Subtest: rejects index drift
    ok 6 - rejects index drift
      ---
      duration_ms: 24.9448
      type: 'test'
      ...
    # Subtest: rejects foreign_key drift
    ok 7 - rejects foreign_key drift
      ---
      duration_ms: 23.772
      type: 'test'
      ...
    1..7
ok 504 - P2-016 migration is atomic, check-only, exact, reentrant and drift-failing
  ---
  duration_ms: 2889.1357
  type: 'test'
  ...
# Subtest: P2-016 persisted card delivery, HMAC grants, one-use sessions and reporter-safe timeline
ok 505 - P2-016 persisted card delivery, HMAC grants, one-use sessions and reporter-safe timeline
  ---
  duration_ms: 2176.2765
  type: 'test'
  ...
# Subtest: P2-016 existing rule worker creates Ticket notifications, safe group/direct guidance and SYSTEM-only timeout closure
ok 506 - P2-016 existing rule worker creates Ticket notifications, safe group/direct guidance and SYSTEM-only timeout closure
  ---
  duration_ms: 2686.3078
  type: 'test'
  ...
# Subtest: Reporter browser 1440x900 real DB/session, fragment removal, refresh, timezone, safe data and logout
ok 507 - Reporter browser 1440x900 real DB/session, fragment removal, refresh, timezone, safe data and logout
  ---
  duration_ms: 4345.9643
  type: 'test'
  ...
# Subtest: Reporter browser 390x844 real DB/session, fragment removal, refresh, timezone, safe data and logout
ok 508 - Reporter browser 390x844 real DB/session, fragment removal, refresh, timezone, safe data and logout
  ---
  duration_ms: 4138.4592
  type: 'test'
  ...
# Subtest: Reporter grant expiry, HMAC rotation, one-consume concurrency, session expiry/revocation and cross-ticket isolation
ok 509 - Reporter grant expiry, HMAC rotation, one-consume concurrency, session expiry/revocation and cross-ticket isolation
  ---
  duration_ms: 1925.8605
  type: 'test'
  ...
# Subtest: P2-016 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
ok 510 - P2-016 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
  ---
  duration_ms: 4333.6155
  type: 'test'
  ...
# {"server_commit_response_lost":true,"restart_replayed":true,"ticket_event_count":1,"unknown_recovery_send_calls":0,"authorized_retry_calls":1,"ack_restart_send_calls":0}
# Subtest: P2-016 architecture guards preserve authorization, immutable baselines and closed contracts
ok 511 - P2-016 architecture guards preserve authorization, immutable baselines and closed contracts
  ---
  duration_ms: 1641.2844
  type: 'test'
  ...
# Subtest: P2-016 default validator still requires readiness Evidence; deferred source checks cannot authorize live work
ok 512 - P2-016 default validator still requires readiness Evidence; deferred source checks cannot authorize live work
  ---
  duration_ms: 1829.5712
  type: 'test'
  ...
# Subtest: P2-016 schemas and declarations exist; Reporter outputs cannot contain internal identity or credentials
ok 513 - P2-016 schemas and declarations exist; Reporter outputs cannot contain internal identity or credentials
  ---
  duration_ms: 20.9788
  type: 'test'
  ...
# Subtest: JSON contract rejects extra keys, noncanonical types and offset time
ok 514 - JSON contract rejects extra keys, noncanonical types and offset time
  ---
  duration_ms: 7.6142
  type: 'test'
  ...
# Subtest: P2-016 closeout freezes every business input and the exact file set
ok 515 - P2-016 closeout freezes every business input and the exact file set
  ---
  duration_ms: 0.4561
  type: 'test'
  ...
# Subtest: P2-016 completion requires owner approval, precise candidates, live duration and zero-skip final regression
ok 516 - P2-016 completion requires owner approval, precise candidates, live duration and zero-skip final regression
  ---
  duration_ms: 0.7078
  type: 'test'
  ...
# Subtest: Real DB internal browser traverses every user lifecycle action, transfer and atomic takeover/accept
ok 517 - Real DB internal browser traverses every user lifecycle action, transfer and atomic takeover/accept
  ---
  duration_ms: 8482.1438
  type: 'test'
  ...
# Subtest: P2-016 Ticket lifecycle, command persistence, authorization and independent responsibility
ok 518 - P2-016 Ticket lifecycle, command persistence, authorization and independent responsibility
  ---
  duration_ms: 4771.4715
  type: 'test'
  ...
# Subtest: P2-016 native browser 1440x900 command, review, refresh, SSE, polling, XSS and auth-expiry
ok 519 - P2-016 native browser 1440x900 command, review, refresh, SSE, polling, XSS and auth-expiry
  ---
  duration_ms: 7197.3056
  type: 'test'
  ...
# Subtest: P2-016 native browser 390x844 command, review, refresh, SSE, polling, XSS and auth-expiry
ok 520 - P2-016 native browser 390x844 command, review, refresh, SSE, polling, XSS and auth-expiry
  ---
  duration_ms: 6975.4389
  type: 'test'
  ...
# Subtest: confirmation survives realtime refetch and rejects a stale version instead of overwriting the form
ok 521 - confirmation survives realtime refetch and rejects a stale version instead of overwriting the form
  ---
  duration_ms: 1426.4022
  type: 'test'
  ...
# Subtest: P2-016 actual HTTP assembly: fail-closed flags, auth, CSRF, Ticket actions and durable SSE
ok 522 - P2-016 actual HTTP assembly: fail-closed flags, auth, CSRF, Ticket actions and durable SSE
  ---
  duration_ms: 2198.7349
  type: 'test'
  ...
# Subtest: P2-G1 system browser duplicate submit fence sends one human reply and preserves safe rendering
ok 523 - P2-G1 system browser duplicate submit fence sends one human reply and preserves safe rendering
  ---
  duration_ms: 1560.6529
  type: 'test'
  ...
# {"browser":"C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe","viewport":{"width":390,"height":844},"replay_events":100,"realtime_list_calls":3,"duplicate_submit_calls":1,"polling_fallback":true,"xss_executed":false,"horizontal_overflow":false}
# Subtest: P2-G1 system browser preserves native SSE reconnect and sends Last-Event-ID
ok 524 - P2-G1 system browser preserves native SSE reconnect and sends Last-Event-ID
  ---
  duration_ms: 4260.0747
  type: 'test'
  ...
# {"sse_connections":2,"last_event_id_used":true,"polling_stopped_after_reconnect":true}
# Subtest: P2-G1 live browser sessions navigate to the actual Workbench route with isolated cookies
ok 525 - P2-G1 live browser sessions navigate to the actual Workbench route with isolated cookies
  ---
  duration_ms: 2582.3973
  type: 'test'
  ...
# {"browser_sessions":2,"workbench_route_requests":2,"isolated_cookie_headers":true,"root_not_requested":true,"safe_telemetry":true}
# Subtest: P2-G1 P1 commit, durable projection recovery, duplicate idempotency, participant isolation and catalog invariance
ok 526 - P2-G1 P1 commit, durable projection recovery, duplicate idempotency, participant isolation and catalog invariance
  ---
  duration_ms: 2758.6864
  type: 'test'
  ...
# {"tickets":3,"duplicate_ticket_delta":0,"duplicate_item_delta":0,"participant_sessions":3,"first_versions":[1,1],"next_versions":[2,2],"p1_survived_projection_failure":true,"recovery_backlog":0,"catalog_unchanged":true}
# Subtest: P2-G1 different Intake atomically ends the prior participant Session before opening the next
ok 527 - P2-G1 different Intake atomically ends the prior participant Session before opening the next
  ---
  duration_ms: 2282.957
  type: 'test'
  ...
# {"different_intake_sessions":2,"prior_ended":1,"active_sessions":1,"active_versions":[1,1],"projection_failures":0}
# Subtest: P2-G1 fault paths serialize takeover, isolate internal note, deduplicate reply and recover delivery without blind resend
ok 528 - P2-G1 fault paths serialize takeover, isolate internal note, deduplicate reply and recover delivery without blind resend
  ---
  duration_ms: 2804.7023
  type: 'test'
  ...
# {"concurrent_takeover_winners":1,"internal_note":{"message":1,"outbox":0,"delivery":0},"duplicate_reply_parallel":12,"reply":{"messages":1,"outboxes":1,"deliveries":1},"gateway_unavailable_pending":true,"reconnect_provider_calls":1,"unknown_reconciliation":true,"ai_calls":0,"ocr_calls":0}
# Subtest: P2-G1 local runtime binds one loopback App and reports human-only readiness with strict Test Auth
ok 529 - P2-G1 local runtime binds one loopback App and reports human-only readiness with strict Test Auth
  ---
  duration_ms: 2645.9149
  type: 'test'
  ...
# {"app_processes":1,"loopback_http":true,"readiness":true,"gateway_required":false,"active_gateway_count":0,"projection_batch":20,"communication_batch":20,"communication_sender":"MOCK","sse_client_cap":32,"dynamic_realtime_authorization":true,"test_auth_http_only":true,"human_only":true}
# Subtest: P2-G1 process cluster runs App, Worker and Gateway in three bounded Node processes
ok 530 - P2-G1 process cluster runs App, Worker and Gateway in three bounded Node processes
  ---
  duration_ms: 3005.0871
  type: 'test'
  ...
# {"process_count":3,"app_pool_max":4,"worker_pool_max":2,"gateway_pool_max":1,"combined_runtime":false,"raw_identifiers_recorded":false}
# Subtest: P2-G1 isolated PostgreSQL Replay Gap drives real Edge through Last-Event-ID, 410 and refetch
ok 531 - P2-G1 isolated PostgreSQL Replay Gap drives real Edge through Last-Event-ID, 410 and refetch
  ---
  duration_ms: 14743.4083
  type: 'test'
  ...
# {"http_status":410,"last_event_id":true,"refetch":["LIST","DETAIL","TIMELINE"],"process_count":3,"isolated_database_cleanup":true}
# Subtest: P2-G1 bounded capacity projects 1000 synthetic inbound facts and drains 500 deliveries with no catalog drift
ok 532 - P2-G1 bounded capacity projects 1000 synthetic inbound facts and drains 500 deliveries with no catalog drift
  ---
  duration_ms: 50805.8861
  type: 'test'
  ...
# {"synthetic_inbound":1000,"projected":1000,"delivery_backlog":500,"delivery_sent":500,"sender_calls":500,"projector_batch":20,"delivery_batch":20,"pool_max":4,"catalog_unchanged":true,"oom":0,"soak_24h":false}
# Subtest: live CLI exposes only the six explicit modes and requires three process fuses for sending
ok 533 - live CLI exposes only the six explicit modes and requires three process fuses for sending
  ---
  duration_ms: 2.0449
  type: 'test'
  ...
# Subtest: gateway process can commit inbound before the App process projects it
ok 534 - gateway process can commit inbound before the App process projects it
  ---
  duration_ms: 1.1868
  type: 'test'
  ...
# Subtest: process resource interface exposes bounded role metrics without a PID or environment
ok 535 - process resource interface exposes bounded role metrics without a PID or environment
  ---
  duration_ms: 0.8456
  type: 'test'
  ...
# Subtest: gateway permits one active WSClient, gates readiness on authentication, reconnects and shuts down cleanly
ok 536 - gateway permits one active WSClient, gates readiness on authentication, reconnects and shuts down cleanly
  ---
  duration_ms: 3.7915
  type: 'test'
  ...
# Subtest: sender enforces persistent target hash allowlist and maps ACK, explicit rejection, unknown and gateway-unavailable safely
ok 537 - sender enforces persistent target hash allowlist and maps ACK, explicit rejection, unknown and gateway-unavailable safely
  ---
  duration_ms: 1.2123
  type: 'test'
  ...
# Subtest: test authentication is server-configured, active non-reporter only, short-lived and emits strict HttpOnly cookie metadata
ok 538 - test authentication is server-configured, active non-reporter only, short-lived and emits strict HttpOnly cookie metadata
  ---
  duration_ms: 2.4039
  type: 'test'
  ...
# Subtest: test authentication isolates two configured principals with independent short-lived cookies and CSRF values
ok 539 - test authentication isolates two configured principals with independent short-lived cookies and CSRF values
  ---
  duration_ms: 1.1239
  type: 'test'
  ...
# Subtest: live harness requires two distinct configured principals and creates a safe unique run id
ok 540 - live harness requires two distinct configured principals and creates a safe unique run id
  ---
  duration_ms: 0.3469
  type: 'test'
  ...
# Subtest: disabled coordinator performs no database work and batch/stream inventory are bounded
ok 541 - disabled coordinator performs no database work and batch/stream inventory are bounded
  ---
  duration_ms: 0.3779
  type: 'test'
  ...
# Subtest: temporary database failure is isolated behind stable projection errors without raw details or false success
ok 542 - temporary database failure is isolated behind stable projection errors without raw details or false success
  ---
  duration_ms: 0.6537
  type: 'test'
  ...
# Subtest: P2-002 transaction hook is optional and P2-G1 browser source has an in-flight duplicate-submit fence
ok 543 - P2-002 transaction hook is optional and P2-G1 browser source has an in-flight duplicate-submit fence
  ---
  duration_ms: 2.637
  type: 'test'
  ...
# Subtest: live script has no broad --live mode and no default live-send npm command
ok 544 - live script has no broad --live mode and no default live-send npm command
  ---
  duration_ms: 3.9546
  type: 'test'
  ...
# Subtest: shared pg factory preserves date/time/timestamp/timestamptz/tsrange/BIGINT strings and JSON objects
ok 545 - shared pg factory preserves date/time/timestamp/timestamptz/tsrange/BIGINT strings and JSON objects
  ---
  duration_ms: 50.2002
  type: 'test'
  ...
# Subtest: shared pg factory rejects Date recursively before sending SQL
ok 546 - shared pg factory rejects Date recursively before sending SQL
  ---
  duration_ms: 28.3045
  type: 'test'
  ...
# Subtest: LocalDate, LocalTime, and LocalDateTime accept real Asia/Shanghai calendar values
ok 547 - LocalDate, LocalTime, and LocalDateTime accept real Asia/Shanghai calendar values
  ---
  duration_ms: 0.8356
  type: 'test'
  ...
# Subtest: LocalDateTime rejects invalid dates, T/Z/UTC/offset/IANA, fractions, whitespace, and objects
ok 548 - LocalDateTime rejects invalid dates, T/Z/UTC/offset/IANA, fractions, whitespace, and objects
  ---
  duration_ms: 1.0581
  type: 'test'
  ...
# Subtest: PhysicalEpochMs remains a canonical non-negative decimal string and round-trips Shanghai local seconds
ok 549 - PhysicalEpochMs remains a canonical non-negative decimal string and round-trips Shanghai local seconds
  ---
  duration_ms: 0.4198
  type: 'test'
  ...
# Subtest: explicit Asia/Shanghai formatter is invariant under UTC, Tokyo, and New York process TZ
ok 550 - explicit Asia/Shanghai formatter is invariant under UTC, Tokyo, and New York process TZ
  ---
  duration_ms: 208.8461
  type: 'test'
  ...
# Subtest: V1.3 compatibility command delegates to active V1.4 validation
ok 551 - V1.3 compatibility command delegates to active V1.4 validation
  ---
  duration_ms: 89.6861
  type: 'test'
  ...
# Subtest: V1.4 architecture validator passes
ok 552 - V1.4 architecture validator passes
  ---
  duration_ms: 105.0254
  type: 'test'
  ...
# Subtest: P2/P2-G1 lifecycle state is internally consistent without changing P1
ok 553 - P2/P2-G1 lifecycle state is internally consistent without changing P1
  ---
  duration_ms: 7.1152
  type: 'test'
  ...
# Subtest: P2-004 independent authorization and stop line are preserved
ok 554 - P2-004 independent authorization and stop line are preserved
  ---
  duration_ms: 0.6509
  type: 'test'
  ...
# Subtest: P2-005 independent authorization and stop line are recorded
ok 555 - P2-005 independent authorization and stop line are recorded
  ---
  duration_ms: 0.6599
  type: 'test'
  ...
# Subtest: P2-006 independent authorization and stop line are recorded
ok 556 - P2-006 independent authorization and stop line are recorded
  ---
  duration_ms: 0.5872
  type: 'test'
  ...
# Subtest: P2-004 completion artifacts preserve P1 notification and Ticket ownership
ok 557 - P2-004 completion artifacts preserve P1 notification and Ticket ownership
  ---
  duration_ms: 1.5192
  type: 'test'
  ...
# Subtest: P2-005 completion artifacts preserve frozen Session and identity ownership
ok 558 - P2-005 completion artifacts preserve frozen Session and identity ownership
  ---
  duration_ms: 0.6261
  type: 'test'
  ...
# Subtest: P2-006 completion has a runnable workbench and no migration 022
ok 559 - P2-006 completion has a runnable workbench and no migration 022
  ---
  duration_ms: 1.4612
  type: 'test'
  ...
# Subtest: P2-001 and P2-002 frozen artifacts remain present
ok 560 - P2-001 and P2-002 frozen artifacts remain present
  ---
  duration_ms: 0.3198
  type: 'test'
  ...
# Subtest: P3 remains greenfield and contains no historical ticket program
ok 561 - P3 remains greenfield and contains no historical ticket program
  ---
  duration_ms: 1.5721
  type: 'test'
  ...
# Subtest: future flags default off without legacy import flags
ok 562 - future flags default off without legacy import flags
  ---
  duration_ms: 0.4722
  type: 'test'
  ...
# Subtest: conceptual schema has no historical migration fields or second ticket core
ok 563 - conceptual schema has no historical migration fields or second ticket core
  ---
  duration_ms: 0.6934
  type: 'test'
  ...
# Subtest: new source example is non-authoritative
ok 564 - new source example is non-authoritative
  ---
  duration_ms: 0.6245
  type: 'test'
  ...
# Subtest: 2C4G limits remain conservative
ok 565 - 2C4G limits remain conservative
  ---
  duration_ms: 0.736
  type: 'test'
  ...
# Subtest: P2-016 authorization reconciles only the historical P2-015 ledger
ok 566 - P2-016 authorization reconciles only the historical P2-015 ledger
  ---
  duration_ms: 4.6231
  type: 'test'
  ...
# Subtest: architecture validator rejects the historical P2-015 ledger drift
ok 567 - architecture validator rejects the historical P2-015 ledger drift
  ---
  duration_ms: 23.346
  type: 'test'
  ...
# Subtest: P2-012 authorization rejects premature completion and next-gate authorization
ok 568 - P2-012 authorization rejects premature completion and next-gate authorization
  ---
  duration_ms: 0.6915
  type: 'test'
  ...
1..568
# tests 575
# suites 0
# pass 575
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 705259.2772

```
