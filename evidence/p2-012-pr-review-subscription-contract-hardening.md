# P2-012 subscription / client contract review

自动化验证：PASS。用户授权修复 PR #6 的 P2、逐一回复和解决，最终 head 的 Codex review 无发现后使用普通 merge commit 合并。该授权不启动 P2-G2/P2-008、AI/OCR/RAG 或真实企业微信发送。

基线：21414a42ecc454a0079ab60801148acab0d7f247。提交标题：fix(p2): align subscription retention and client contracts。本文件不写入自身提交 SHA；GitHub review/merge 的最终状态以 PR API 为准。

## 四项修复与证明

- 3950900504：恢复、首次关联、目的地查询和私人通知投影均检查 Journey 保留期及一致身份绑定。真实 PostgreSQL 复现过期 resume 被错误接受；修复后拒绝并保持原订阅状态，过期目的地不再列出。已 ACTIVE 后才过期时也不新增私人通知；过期 Direct Leg 重关联保持 PENDING_DESTINATION。
- 3950900513：最后一份报告解除后重关联 group-only 报告，以既有 subscription.created 记录新逻辑订阅周期，payload.status=PENDING_DESTINATION；只有实际 ACTIVE 才使用 activated。物理行仍复用，语义说明在 docs/64，无 migration。真实库断言事件类型和实际状态一致。
- 3950900523：next_cursor 改为 string|null，同时修复相同错误类型生成留下的可选 owner_team_id?:never。真实 TypeScript strict consumer 接受 string/null cursor、可选团队，拒绝 numeric cursor。使用当前已安装 TypeScript，未新增 npm 依赖。
- 3950900528：两个 OpenAPI /api/incidents GET 均声明可选 state，覆盖 ACTIVE、FINISHED 与全部7种实际状态；PyYAML 全文解析后逐项比较 runtime enum。

## 回归与一次验证环境修正

P2-012定向38/38。首次完整串行574 tests/573 pass/1 fail：既有容量用例的 heap 回落采样断言失败，之前的业务规模、送达、SSE与heap<256MiB断言通过。原完整 TAP 保留。当前无 --expose-gc 命令实测 gc_exposed=false，而仓库已有 P2-012/P2-016测试脚本均使用 --expose-gc，容量用例本身调用 global.gc?.()。

启用该既有方式进行相同用例诊断：1/1，500 Candidates、200 Incidents、2000 Reports、1000 Subscriptions、5200 Events、550 bindings/送达，32 SSE，pool max4；heap峰值85215384 bytes、结束18117144 bytes；DB/backend均0。没有修改业务代码、断言、超时或测试规模来处理这次失败。

最终完整串行命令：`node --expose-gc --env-file=.env.pilot --test --test-concurrency=1 --test-reporter=tap tests/*.test.mjs`。结果574/574、exit0、fail/cancelled/skipped/todo全部0，耗时663011.632ms。当前runtime input SHA-256：ba5e3a9d597072c0d90dac88c015281484cafe6a6b3623ac05a1f7015e32940b。

## 冻结、资源与隐私

001～032/catalog/P2-007/Live Sender授权、现场记录、旧v1/v2 Review Evidence、负责人批准均不改。完成JSON只追加独立 pr_review_subscription_contract_hardening。v3门禁固定本轮基线、标题、路径和全量证据；旧v1/v2函数及证据继续验证。

无新常驻进程、Pool、Timer或数据库对象；DB/backend/测试Node child/HTTP listener/browser process/profile均0。保留本轮原始TAP和核验文件；宿主其他Codex/MCP进程及旧受保护临时目录不属于本轮清理。20个持久Feature Flag均false。隐私扫描21文件、5个敏感配置值，匹配0；未打印值。P2-012保持DONE、P2-G2未启动。

关闭：保持三个Incident开关false，无down migration。用户当前已授权正常push/reply/resolve/merge；这不改写旧阶段的no-push历史事实。

## 修改文件

- CHANGELOG.md
- FILE_INDEX.md
- MANIFEST.json
- contracts/conversation_center.openapi.yaml
- contracts/openapi.yaml
- contracts/p2_012_contracts.d.ts
- docs/64_p2_012_reporter_subscription_recovery.md
- evidence/p2-012-human-confirmed-incident-report.json
- evidence/p2-012-pr-review-subscription-contract-hardening.json
- evidence/p2-012-pr-review-subscription-contract-hardening.md
- scripts/validate-p2-012-human-confirmed-incident.mjs
- src/p2-012-incident-command-service.mjs
- src/p2-012-incident-query.mjs
- src/p2-012-notification-policy.mjs
- tests/p2-012-client-contract-review.test.mjs
- tests/p2-012-schema-live-guards.test.mjs
- tests/p2-012-subscription-review.integration.test.mjs

<details>
<summary>Targeted — raw SHA-256 5f33f1a7f4b230dab307156e1900670b5b991207b962b70359307632d02e70d3</summary>

内嵌文本仅规范换行与行尾空白；原文件：tmp/p2012-review3/targeted.tap。

````text
TAP version 13
# Subtest: P2-012 real command capacity 500 candidates, 200 incidents, 2000 reports, 1000 subscriptions, 5000 events, 500 bindings and 32 SSE
ok 1 - P2-012 real command capacity 500 candidates, 200 incidents, 2000 reports, 1000 subscriptions, 5000 events, 500 bindings and 32 SSE
  ---
  duration_ms: 66302.3047
  type: 'test'
  ...
# {"candidates":500,"incidents":200,"reports":2000,"subscriptions":1000,"events":5200,"bindings":550,"notification_sent":550,"pool_max":4,"sse_max":32,"sse_after_stop":0,"heap_samples_bytes":[15126944,32275576,73388744,40860824,41185200,61329144,81725712,48948680,69112776,89473560,56478232,73567512,25128984],"heap_peak_bytes":89473560,"heap_final_bytes":25128984,"real_sdk_calls":0,"model_calls":0}
# {"cleanup":{"database_count":0,"backend_count":0}}
# Subtest: P2-012 real TypeScript consumers accept nullable cursors and optional owner teams
ok 2 - P2-012 real TypeScript consumers accept nullable cursors and optional owner teams
  ---
  duration_ms: 464.3797
  type: 'test'
  ...
# Subtest: P2-012 parsed OpenAPI incident state filters match all runtime states and queue aliases
ok 3 - P2-012 parsed OpenAPI incident state filters match all runtime states and queue aliases
  ---
  duration_ms: 466.962
  type: 'test'
  ...
# Subtest: P2-012 closes input shapes, rejects hostile values and preserves deterministic command hashes
ok 4 - P2-012 closes input shapes, rejects hostile values and preserves deterministic command hashes
  ---
  duration_ms: 2.9937
  type: 'test'
  ...
# Subtest: P2-012 stable HTTP matrix is exhaustive, deterministic and rejects hostile results without executing code
ok 5 - P2-012 stable HTTP matrix is exhaustive, deterministic and rejects hostile results without executing code
  ---
  duration_ms: 30.4982
  type: 'test'
  ...
# Subtest: P2-012 maintenance expires a bounded ordered batch through private SYSTEM commands without notifications
ok 6 - P2-012 maintenance expires a bounded ordered batch through private SYSTEM commands without notifications
  ---
  duration_ms: 3662.4817
  type: 'test'
  ...
# Subtest: P2-012 maintenance replays concurrent scans, handles human/time races and surfaces a still-due failure
ok 7 - P2-012 maintenance replays concurrent scans, handles human/time races and surfaces a still-due failure
  ---
  duration_ms: 5879.3365
  type: 'test'
  ...
# Subtest: P2-012 maintenance scans after import and expires an imported due candidate in the same iteration
ok 8 - P2-012 maintenance scans after import and expires an imported due candidate in the same iteration
  ---
  duration_ms: 3961.0421
  type: 'test'
  ...
# Subtest: P2-012 real database human confirmation, idempotency, recovery isolation and notification facts
ok 9 - P2-012 real database human confirmation, idempotency, recovery isolation and notification facts
  ---
  duration_ms: 3955.9557
  type: 'test'
  ...
# Subtest: dynamic live configuration requires an approved group but no preconfigured Reporter userid hash
ok 10 - dynamic live configuration requires an approved group but no preconfigured Reporter userid hash
  ---
  duration_ms: 5.6431
  type: 'test'
  ...
# Subtest: dynamic Sender rechecks the persisted approved-group Reporter before each PERSON provider call
ok 11 - dynamic Sender rechecks the persisted approved-group Reporter before each PERSON provider call
  ---
  duration_ms: 2.0718
  type: 'test'
  ...
# Subtest: approved test group discovers an unconfigured Reporter before their direct flow and outbound notice
ok 12 - approved test group discovers an unconfigured Reporter before their direct flow and outbound notice
  ---
  duration_ms: 1.1876
  type: 'test'
  ...
# Subtest: P2-012 migration 032 applies atomically, detects catalog drift and preserves seven-table scope
ok 13 - P2-012 migration 032 applies atomically, detects catalog drift and preserves seven-table scope
  ---
  duration_ms: 3401.2732
  type: 'test'
  ...
# Subtest: P2-012 fresh current baseline reaches 032 and repeated status/check/apply preserve the catalog
ok 14 - P2-012 fresh current baseline reaches 032 and repeated status/check/apply preserve the catalog
  ---
  duration_ms: 4413.3955
  type: 'test'
  ...
# Subtest: P2-012 network-off three-role assembly serves Incident and closes children, sockets and pools
ok 15 - P2-012 network-off three-role assembly serves Incident and closes children, sockets and pools
  ---
  duration_ms: 5606.3053
  type: 'test'
  ...
# {"network_enabled":false,"restarted":false,"metrics":{"process_count":3,"gateway_authenticated":0,"gateway_reconnect_total":0,"app_rss_bytes":85123072,"app_heap_used_bytes":20450128,"app_heap_total_bytes":33865728,"app_external_bytes":4566034,"app_cpu_percent":20.333,"app_event_loop_delay_p95_ms":31.604735,"app_active_resources":8,"app_active_timers":2,"app_active_sockets":6,"app_active_file_handles":0,"app_active_handles":6,"app_uptime_seconds":1.724,"app_pool_total":2,"app_pool_idle":2,"app_pool_waiting":0,"app_pool_max":4,"worker_rss_bytes":92102656,"worker_heap_used_bytes":18898592,"worker_heap_total_bytes":33865728,"worker_external_bytes":4475653,"worker_cpu_percent":12.599,"worker_event_loop_delay_p95_ms":32.358399,"worker_active_resources":4,"worker_active_timers":2,"worker_active_sockets":2,"worker_active_file_handles":0,"worker_active_handles":2,"worker_uptime_seconds":1.711,"worker_pool_total":1,"worker_pool_idle":1,"worker_pool_waiting":0,"worker_pool_max":2,"gateway_rss_bytes":79265792,"gateway_heap_used_bytes":12701352,"gateway_heap_total_bytes":31866880,"gateway_external_bytes":4206782,"gateway_cpu_percent":1.152,"gateway_event_loop_delay_p95_ms":31.703039,"gateway_active_resources":2,"gateway_active_timers":1,"gateway_active_sockets":1,"gateway_active_file_handles":0,"gateway_active_handles":1,"gateway_uptime_seconds":1.741,"gateway_pool_total":0,"gateway_pool_idle":0,"gateway_pool_waiting":0,"gateway_pool_max":1,"total_rss_bytes":256491520,"total_heap_used_bytes":52050072,"total_cpu_percent":34.084,"sse_clients":0,"projection_backlog":0,"projection_failures":0,"communication_pending":1,"dead_letter":0,"reconciliation_required":0,"postgres_active_connections":1,"postgres_idle_connections":4,"postgres_other_connections":0,"postgres_max_connections":100,"postgres_connection_utilization_percent":5}}
# {"network_enabled":false,"restarted":true,"metrics":{"process_count":3,"gateway_authenticated":0,"gateway_reconnect_total":0,"app_rss_bytes":82640896,"app_heap_used_bytes":15029728,"app_heap_total_bytes":32817152,"app_external_bytes":4334348,"app_cpu_percent":45.391,"app_event_loop_delay_p95_ms":30.851071,"app_active_resources":6,"app_active_timers":1,"app_active_sockets":5,"app_active_file_handles":0,"app_active_handles":5,"app_uptime_seconds":0.544,"app_pool_total":1,"app_pool_idle":1,"app_pool_waiting":0,"app_pool_max":4,"worker_rss_bytes":89604096,"worker_heap_used_bytes":13340784,"worker_heap_total_bytes":31866880,"worker_external_bytes":4206782,"worker_cpu_percent":27.639,"worker_event_loop_delay_p95_ms":34.930687,"worker_active_resources":2,"worker_active_timers":1,"worker_active_sockets":1,"worker_active_file_handles":0,"worker_active_handles":1,"worker_uptime_seconds":0.538,"worker_pool_total":0,"worker_pool_idle":0,"worker_pool_waiting":0,"worker_pool_max":2,"gateway_rss_bytes":79282176,"gateway_heap_used_bytes":12696104,"gateway_heap_total_bytes":31866880,"gateway_external_bytes":4206782,"gateway_cpu_percent":0,"gateway_event_loop_delay_p95_ms":32.145407,"gateway_active_resources":2,"gateway_active_timers":1,"gateway_active_sockets":1,"gateway_active_file_handles":0,"gateway_active_handles":1,"gateway_uptime_seconds":0.579,"gateway_pool_total":0,"gateway_pool_idle":0,"gateway_pool_waiting":0,"gateway_pool_max":1,"total_rss_bytes":251527168,"total_heap_used_bytes":41066616,"total_cpu_percent":73.03,"sse_clients":0,"projection_backlog":0,"projection_failures":0,"communication_pending":1,"dead_letter":0,"reconciliation_required":0,"postgres_active_connections":1,"postgres_idle_connections":3,"postgres_other_connections":0,"postgres_max_connections":100,"postgres_connection_utilization_percent":4}}
# Subtest: P2-012 Reporter HTTP preserves bound grants, refresh ETag, safe milestones and unlink visibility
ok 16 - P2-012 Reporter HTTP preserves bound grants, refresh ETag, safe milestones and unlink visibility
  ---
  duration_ms: 2640.7941
  type: 'test'
  ...
# Subtest: P2-012 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
ok 17 - P2-012 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
  ---
  duration_ms: 3900.4076
  type: 'test'
  ...
# {"server_commit_response_lost":true,"restart_replayed":true,"incident_confirmed_event_count":1,"unknown_recovery_send_calls":0,"authorized_retry_calls":1,"ack_restart_send_calls":0}
# Subtest: P2-012 both parsed OpenAPI documents declare canonical subscription destinations and service failures
ok 18 - P2-012 both parsed OpenAPI documents declare canonical subscription destinations and service failures
  ---
  duration_ms: 695.1935
  type: 'test'
  ...
# Subtest: P2-012 static authorization, frozen predecessors, scope, schemas and synthetic fixture gate
ok 19 - P2-012 static authorization, frozen predecessors, scope, schemas and synthetic fixture gate
  ---
  duration_ms: 3519.8468
  type: 'test'
  ...
# Subtest: P2-012 live runner fails before network/listener unless all five independent fuses and verified evidence exist
ok 20 - P2-012 live runner fails before network/listener unless all five independent fuses and verified evidence exist
  ---
  duration_ms: 1.0648
  type: 'test'
  ...
# Subtest: P2-012 readiness cannot be fabricated from partial regression, skips, changed inputs or live claims
ok 21 - P2-012 readiness cannot be fabricated from partial regression, skips, changed inputs or live claims
  ---
  duration_ms: 0.3138
  type: 'test'
  ...
# Subtest: P2-012 DONE requires the approved live candidate, client confirmation, clean Incident deliveries and complete regressions
ok 22 - P2-012 DONE requires the approved live candidate, client confirmation, clean Incident deliveries and complete regressions
  ---
  duration_ms: 0.2718
  type: 'test'
  ...
# Subtest: P2-012 frozen candidate permits only the explicit closeout governance set
ok 23 - P2-012 frozen candidate permits only the explicit closeout governance set
  ---
  duration_ms: 0.2192
  type: 'test'
  ...
# Subtest: P2-012 review hardening preserves exact paths and requires independent current regression evidence
ok 24 - P2-012 review hardening preserves exact paths and requires independent current regression evidence
  ---
  duration_ms: 0.2779
  type: 'test'
  ...
# Subtest: P2-012 v2 HTTP OpenAPI hardening has an independent closed allowlist and complete regression gate
ok 25 - P2-012 v2 HTTP OpenAPI hardening has an independent closed allowlist and complete regression gate
  ---
  duration_ms: 0.3823
  type: 'test'
  ...
# Subtest: P2-012 subscription review preserves its baseline, scope and independent regression
ok 26 - P2-012 subscription review preserves its baseline, scope and independent regression
  ---
  duration_ms: 0.4152
  type: 'test'
  ...
# Subtest: P2-012 incomplete persisted Candidate summary remains explicit and does not invent clustering evidence
ok 27 - P2-012 incomplete persisted Candidate summary remains explicit and does not invent clustering evidence
  ---
  duration_ms: 2.2344
  type: 'test'
  ...
# Subtest: P2-012 four scope permissions, authorization before replay, expiry maintenance and closed schemas
ok 28 - P2-012 four scope permissions, authorization before replay, expiry maintenance and closed schemas
  ---
  duration_ms: 2377.4653
  type: 'test'
  ...
# Subtest: P2-012 approved-group Reporter discovery persists before direct intake, Sender scope and database guard
ok 29 - P2-012 approved-group Reporter discovery persists before direct intake, Sender scope and database guard
  ---
  duration_ms: 2166.3234
  type: 'test'
  ...
# Subtest: P2-012 real direct-leg eligibility suppresses group-only Ticket artifacts and validates persisted destination scope
ok 30 - P2-012 real direct-leg eligibility suppresses group-only Ticket artifacts and validates persisted destination scope
  ---
  duration_ms: 2299.0672
  type: 'test'
  ...
# Subtest: P2-012 cross-channel same reporter, pending activation, pause, unlink and reporter-safe history
ok 31 - P2-012 cross-channel same reporter, pending activation, pause, unlink and reporter-safe history
  ---
  duration_ms: 2519.7523
  type: 'test'
  ...
# Subtest: P2-012 fixed notices reuse sender, restart persistence, explicit UNKNOWN reconciliation and no blind resend
ok 32 - P2-012 fixed notices reuse sender, restart persistence, explicit UNKNOWN reconciliation and no blind resend
  ---
  duration_ms: 3288.063
  type: 'test'
  ...
# Subtest: P2-012 expired direct destinations cannot activate subscriptions and pending reopen never claims activation
ok 33 - P2-012 expired direct destinations cannot activate subscriptions and pending reopen never claims activation
  ---
  duration_ms: 4210.4949
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 1440x900 human confirmation, refresh and accessibility
ok 34 - P2-012 database-backed browser 1440x900 human confirmation, refresh and accessibility
  ---
  duration_ms: 7744.6055
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 1366x768 human confirmation, refresh and accessibility
ok 35 - P2-012 database-backed browser 1366x768 human confirmation, refresh and accessibility
  ---
  duration_ms: 7715.6816
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 390x844 human confirmation, refresh and accessibility
ok 36 - P2-012 database-backed browser 390x844 human confirmation, refresh and accessibility
  ---
  duration_ms: 5533.9873
  type: 'test'
  ...
# Subtest: P2-012 actual HTTP inherits authentication, CSRF, command fence and durable realtime
ok 37 - P2-012 actual HTTP inherits authentication, CSRF, command fence and durable realtime
  ---
  duration_ms: 2470.5541
  type: 'test'
  ...
# Subtest: P2-012 actual HTTP preserves notification failure, rollback and durable replay before explicit recovery
ok 38 - P2-012 actual HTTP preserves notification failure, rollback and durable replay before explicit recovery
  ---
  duration_ms: 4428.1355
  type: 'test'
  ...
1..38
# tests 38
# suites 0
# pass 38
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 167383.0828
````

</details>

<details>
<summary>First full failure — raw SHA-256 7f929a77fc33d94b2995408d2b3e4f4b9ec6b9d82875976ef22948d6354e23fc</summary>

内嵌文本仅规范换行与行尾空白；原文件：tmp/p2012-review3/full.tap。

````text
TAP version 13
# Subtest: ARCH-005 architecture validator freezes migrations and reports all hard static counts at zero
ok 1 - ARCH-005 architecture validator freezes migrations and reports all hard static counts at zero
  ---
  duration_ms: 223.0758
  type: 'test'
  ...
# Subtest: P2-007 and its authorized P2-015 successor keep the frozen ARCH-005 contract
ok 2 - P2-007 and its authorized P2-015 successor keep the frozen ARCH-005 contract
  ---
  duration_ms: 2.6866
  type: 'test'
  ...
# Subtest: existing 001-021 database passes 022 check rollback, apply, forbidden-zero, and repeat no-op
ok 3 - existing 001-021 database passes 022 check rollback, apply, forbidden-zero, and repeat no-op
  ---
  duration_ms: 3831.9957
  type: 'test'
  ...
# Subtest: fresh database executes 001-021-022 through the current-baseline entrypoint
ok 4 - fresh database executes 001-021-022 through the current-baseline entrypoint
  ---
  duration_ms: 1967.6923
  type: 'test'
  ...
# Subtest: ARCH-006 validator passes
ok 5 - ARCH-006 validator passes
  ---
  duration_ms: 193.1029
  type: 'test'
  ...
# Subtest: machine state preserves ARCH-006 facts and separately authorized P2-015/P2-016 successor lifecycles
ok 6 - machine state preserves ARCH-006 facts and separately authorized P2-015/P2-016 successor lifecycles
  ---
  duration_ms: 1.1576
  type: 'test'
  ...
# Subtest: ten safe deterministic results are first-class and Manual Review is valid
ok 7 - ten safe deterministic results are first-class and Manual Review is valid
  ---
  duration_ms: 1.1967
  type: 'test'
  ...
# Subtest: Ticket lifecycle reuses authoritative actions and reliable notification boundary
ok 8 - Ticket lifecycle reuses authoritative actions and reliable notification boundary
  ---
  duration_ms: 0.9324
  type: 'test'
  ...
# Subtest: Incident remains human-confirmed and AI-independent
ok 9 - Incident remains human-confirmed and AI-independent
  ---
  duration_ms: 0.6761
  type: 'test'
  ...
# Subtest: AI-off readiness and feature flags are closed by default
ok 10 - AI-off readiness and feature flags are closed by default
  ---
  duration_ms: 1.3706
  type: 'test'
  ...
# Subtest: configuration preserves G0 boundaries and substitutes only the invalid test secret
ok 11 - configuration preserves G0 boundaries and substitutes only the invalid test secret
  ---
  duration_ms: 1.3166
  type: 'test'
  ...
# Subtest: redaction and error mapping do not expose a configured secret
ok 12 - redaction and error mapping do not expose a configured secret
  ---
  duration_ms: 0.7796
  type: 'test'
  ...
# Subtest: the connection stability window is bounded and explicit
ok 13 - the connection stability window is bounded and explicit
  ---
  duration_ms: 0.2712
  type: 'test'
  ...
# Subtest: authenticated probe starts shutdown by SIGTERM and calls disconnect before completion
ok 14 - authenticated probe starts shutdown by SIGTERM and calls disconnect before completion
  ---
  duration_ms: 3.9704
  type: 'test'
  ...
# Subtest: text frame capture records only the permitted, desensitized shape
ok 15 - text frame capture records only the permitted, desensitized shape
  ---
  duration_ms: 3.7295
  type: 'test'
  ...
# Subtest: capture arguments require a named scenario and an evidence jsonl target
ok 16 - capture arguments require a named scenario and an evidence jsonl target
  ---
  duration_ms: 1.1503
  type: 'test'
  ...
# Subtest: media capture records only desensitized frame, download, and filename metadata
ok 17 - media capture records only desensitized frame, download, and filename metadata
  ---
  duration_ms: 2.793
  type: 'test'
  ...
# Subtest: media capture arguments restrict scenarios, evidence output, and aes key modes
ok 18 - media capture arguments restrict scenarios, evidence output, and aes key modes
  ---
  duration_ms: 1.152
  type: 'test'
  ...
# Subtest: voice capture retains only safe transcript metadata and does not download media
ok 19 - voice capture retains only safe transcript metadata and does not download media
  ---
  duration_ms: 0.3526
  type: 'test'
  ...
# Subtest: video capture reuses encrypted download evidence without exposing media references
ok 20 - video capture reuses encrypted download evidence without exposing media references
  ---
  duration_ms: 0.4082
  type: 'test'
  ...
# Subtest: download evidence maps decrypt failures and local deadline without leaking error details
ok 21 - download evidence maps decrypt failures and local deadline without leaking error details
  ---
  duration_ms: 3.9472
  type: 'test'
  ...
# Subtest: push arguments restrict scenario, timing, repeat and evidence output
ok 22 - push arguments restrict scenario, timing, repeat and evidence output
  ---
  duration_ms: 1.4326
  type: 'test'
  ...
# Subtest: direct push uses userid in memory but records only desensitized delivery evidence
ok 23 - direct push uses userid in memory but records only desensitized delivery evidence
  ---
  duration_ms: 3.1207
  type: 'test'
  ...
# Subtest: group mention mode is opt-in and invalid chatid rejection keeps SDK error text out of evidence
ok 24 - group mention mode is opt-in and invalid chatid rejection keeps SDK error text out of evidence
  ---
  duration_ms: 0.7997
  type: 'test'
  ...
# Subtest: group markdown-then-text mention probe sends two ordered bodies and treats only the text probe rejection as a valid result
ok 25 - group markdown-then-text mention probe sends two ordered bodies and treats only the text probe rejection as a valid result
  ---
  duration_ms: 0.538
  type: 'test'
  ...
# Subtest: group mention arguments restrict timeout, trigger token and evidence output
ok 26 - group mention arguments restrict timeout, trigger token and evidence output
  ---
  duration_ms: 1.149
  type: 'test'
  ...
# Subtest: group mention reply uses passive text syntax with the current callback sender
ok 27 - group mention reply uses passive text syntax with the current callback sender
  ---
  duration_ms: 0.7259
  type: 'test'
  ...
# Subtest: stream reply uses the same passive mention syntax in a finished SDK-supported stream body
ok 28 - stream reply uses the same passive mention syntax in a finished SDK-supported stream body
  ---
  duration_ms: 0.1571
  type: 'test'
  ...
# Subtest: acknowledged group reply reuses the triggering frame and records only hashes and field shape
ok 29 - acknowledged group reply reuses the triggering frame and records only hashes and field shape
  ---
  duration_ms: 1.8853
  type: 'test'
  ...
# Subtest: probe ignores non-group and wrong-token messages before handling the matching group callback
ok 30 - probe ignores non-group and wrong-token messages before handling the matching group callback
  ---
  duration_ms: 0.5047
  type: 'test'
  ...
# Subtest: provider rejection is a completed negative capability result and excludes SDK error text
ok 31 - provider rejection is a completed negative capability result and excludes SDK error text
  ---
  duration_ms: 0.4004
  type: 'test'
  ...
# Subtest: capture builder never serializes raw callback or reply values
ok 32 - capture builder never serializes raw callback or reply values
  ---
  duration_ms: 0.3171
  type: 'test'
  ...
# Subtest: card arguments enforce local evidence, trigger chat type, and the five-second late boundary
ok 33 - card arguments enforce local evidence, trigger chat type, and the five-second late boundary
  ---
  duration_ms: 2.8345
  type: 'test'
  ...
# Subtest: card shape has a unique caller-owned task id and both required actions
ok 34 - card shape has a unique caller-owned task id and both required actions
  ---
  duration_ms: 1.173
  type: 'test'
  ...
# Subtest: fast button event updates the matching task id within five seconds without persisting raw input
ok 35 - fast button event updates the matching task id within five seconds without persisting raw input
  ---
  duration_ms: 9.2967
  type: 'test'
  ...
# Subtest: duplicate mode records the second same-user same-action callback and preserves buttons until then
ok 36 - duplicate mode records the second same-user same-action callback and preserves buttons until then
  ---
  duration_ms: 1.0993
  type: 'test'
  ...
# Subtest: late mode calls update after the limit and records a platform rejection as an explicit expired-behavior result
ok 37 - late mode calls update after the limit and records a platform rejection as an explicit expired-behavior result
  ---
  duration_ms: 1.7588
  type: 'test'
  ...
# Subtest: a task-id mismatch is safely recorded with field names and hashes but never updates a foreign card
ok 38 - a task-id mismatch is safely recorded with field names and hashes but never updates a foreign card
  ---
  duration_ms: 1.0843
  type: 'test'
  ...
# Subtest: reply arguments only accept registered scenarios and evidence output paths
ok 39 - reply arguments only accept registered scenarios and evidence output paths
  ---
  duration_ms: 1.1253
  type: 'test'
  ...
# Subtest: welcome, Markdown, stream, and media builders use the documented reply forms
ok 40 - welcome, Markdown, stream, and media builders use the documented reply forms
  ---
  duration_ms: 4.0345
  type: 'test'
  ...
# Subtest: welcome replies accept an enter_chat event even when its chattype is omitted
ok 41 - welcome replies accept an enter_chat event even when its chattype is omitted
  ---
  duration_ms: 2.5843
  type: 'test'
  ...
# Subtest: stream refresh reuses one callback and stream id, then omits the body for matching feedback
ok 42 - stream refresh reuses one callback and stream id, then omits the body for matching feedback
  ---
  duration_ms: 3.9105
  type: 'test'
  ...
# Subtest: Markdown reply is callback-bound and never serializes trigger text or identifiers
ok 43 - Markdown reply is callback-bound and never serializes trigger text or identifiers
  ---
  duration_ms: 0.4783
  type: 'test'
  ...
# Subtest: file, image, and voice upload then reply through the callback-bound media interface
ok 44 - file, image, and voice upload then reply through the callback-bound media interface
  ---
  duration_ms: 1.2831
  type: 'test'
  ...
# Subtest: video echo downloads only in memory, reuploads with a safe filename, and replies with title and description
ok 45 - video echo downloads only in memory, reuploads with a safe filename, and replies with title and description
  ---
  duration_ms: 0.7976
  type: 'test'
  ...
# Subtest: provider rejection has a stable classification without recording provider error text
ok 46 - provider rejection has a stable classification without recording provider error text
  ---
  duration_ms: 0.3944
  type: 'test'
  ...
# Subtest: feedback empty-reply rejection is a completed negative capability result
ok 47 - feedback empty-reply rejection is a completed negative capability result
  ---
  duration_ms: 2.3386
  type: 'test'
  ...
# Subtest: G0-007 defaults to a 4 hour 30 minute Windows-native soak and keeps Phase boundaries
ok 48 - G0-007 defaults to a 4 hour 30 minute Windows-native soak and keeps Phase boundaries
  ---
  duration_ms: 1.483
  type: 'test'
  ...
# Subtest: run id is opaque and deterministic under an injected clock
ok 49 - run id is opaque and deterministic under an injected clock
  ---
  duration_ms: 0.1917
  type: 'test'
  ...
# Subtest: reconnect recovery, resource samples, and message replay stay content-free
ok 50 - reconnect recovery, resource samples, and message replay stay content-free
  ---
  duration_ms: 2.5024
  type: 'test'
  ...
# Subtest: a completed requested soak does not satisfy the 4 hour 30 minute Gate duration when shortened
ok 51 - a completed requested soak does not satisfy the 4 hour 30 minute Gate duration when shortened
  ---
  duration_ms: 0.6963
  type: 'test'
  ...
# Subtest: G0-008 closure preserves completed Gate 0 and P1 facts independently of the moving P2 frontier
ok 52 - G0-008 closure preserves completed Gate 0 and P1 facts independently of the moving P2 frontier
  ---
  duration_ms: 2.543
  type: 'test'
  ...
# Subtest: G0-008 report covers every completed Gate 0 evidence source and retains limits
ok 53 - G0-008 report covers every completed Gate 0 evidence source and retains limits
  ---
  duration_ms: 2.0497
  type: 'test'
  ...
# Subtest: the capability-freeze ADR is accepted and does not skip P1-001
ok 54 - the capability-freeze ADR is accepted and does not skip P1-001
  ---
  duration_ms: 2.3703
  type: 'test'
  ...
# Subtest: the documented 512 KiB plan covers 3,920,958 bytes in eight ordered chunks
ok 55 - the documented 512 KiB plan covers 3,920,958 bytes in eight ordered chunks
  ---
  duration_ms: 1.2571
  type: 'test'
  ...
# Subtest: test-only padding creates an exact target-sized MP4 without retaining an original filename
ok 56 - test-only padding creates an exact target-sized MP4 without retaining an original filename
  ---
  duration_ms: 0.5785
  type: 'test'
  ...
# Subtest: layered upload sends init, every serial chunk, and finish with fresh request IDs
ok 57 - layered upload sends init, every serial chunk, and finish with fresh request IDs
  ---
  duration_ms: 37.5618
  type: 'test'
  ...
# Subtest: a rejected chunk prevents finish and returns an explicit stage result
ok 58 - a rejected chunk prevents finish and returns an explicit stage result
  ---
  duration_ms: 2.9494
  type: 'test'
  ...
# Subtest: the probe downloads in memory, completes the layer sequence, then issues one callback-bound reply
ok 59 - the probe downloads in memory, completes the layer sequence, then issues one callback-bound reply
  ---
  duration_ms: 4.915
  type: 'test'
  ...
# Subtest: arguments remain restricted to the G0 evidence directory and 10 MiB provider limit
ok 60 - arguments remain restricted to the G0 evidence directory and 10 MiB provider limit
  ---
  duration_ms: 0.293
  type: 'test'
  ...
# Subtest: validates and redacts a Webhook URL without exposing its key
ok 61 - validates and redacts a Webhook URL without exposing its key
  ---
  duration_ms: 2.1458
  type: 'test'
  ...
# Subtest: builds the documented text, markdown, media, news, and card payload forms
ok 62 - builds the documented text, markdown, media, news, and card payload forms
  ---
  duration_ms: 2.6691
  type: 'test'
  ...
# Subtest: creates bounded in-memory image, file, and AMR fixtures and documented multipart headers
ok 63 - creates bounded in-memory image, file, and AMR fixtures and documented multipart headers
  ---
  duration_ms: 0.8078
  type: 'test'
  ...
# Subtest: records only safe live-probe evidence when every provider reply is accepted
ok 64 - records only safe live-probe evidence when every provider reply is accepted
  ---
  duration_ms: 26.3435
  type: 'test'
  ...
# Subtest: P1 configuration accepts Pilot-only dependencies and produces a secret-free summary
ok 65 - P1 configuration accepts Pilot-only dependencies and produces a secret-free summary
  ---
  duration_ms: 1.4903
  type: 'test'
  ...
# Subtest: P1 configuration rejects missing, cross-phase, and unapproved public-edge settings
ok 66 - P1 configuration rejects missing, cross-phase, and unapproved public-edge settings
  ---
  duration_ms: 0.6782
  type: 'test'
  ...
# Subtest: preflight output and CLI options do not expose configuration secrets
ok 67 - preflight output and CLI options do not expose configuration secrets
  ---
  duration_ms: 0.3888
  type: 'test'
  ...
# Subtest: the Pilot foundation health endpoint starts and stops without business routes
ok 68 - the Pilot foundation health endpoint starts and stops without business routes
  ---
  duration_ms: 43.6375
  type: 'test'
  ...
# Subtest: text Frame becomes an SDK-independent normalized message
ok 69 - text Frame becomes an SDK-independent normalized message
  ---
  duration_ms: 3.6178
  type: 'test'
  ...
# Subtest: image Frame exposes only an opaque media download reference
ok 70 - image Frame exposes only an opaque media download reference
  ---
  duration_ms: 0.7571
  type: 'test'
  ...
# Subtest: mixed Frame preserves text and image ordering in one normalized message
ok 71 - mixed Frame preserves text and image ordering in one normalized message
  ---
  duration_ms: 0.4395
  type: 'test'
  ...
# Subtest: replayed Frame keeps one durable idempotency key without Adapter-side dropping
ok 72 - replayed Frame keeps one durable idempotency key without Adapter-side dropping
  ---
  duration_ms: 0.2439
  type: 'test'
  ...
# Subtest: illegal Frame returns a stable, non-retryable and secret-free error
ok 73 - illegal Frame returns a stable, non-retryable and secret-free error
  ---
  duration_ms: 0.1844
  type: 'test'
  ...
# Subtest: invalid Adapter receive time returns a stable error instead of throwing
ok 74 - invalid Adapter receive time returns a stable error instead of throwing
  ---
  duration_ms: 0.1804
  type: 'test'
  ...
# Subtest: text that exceeds the contract only after normalization fails closed
ok 75 - text that exceeds the contract only after normalization fails closed
  ---
  duration_ms: 0.7888
  type: 'test'
  ...
# Subtest: text incompatible with the Phase 1 PostgreSQL boundary fails closed
ok 76 - text incompatible with the Phase 1 PostgreSQL boundary fails closed
  ---
  duration_ms: 0.2171
  type: 'test'
  ...
# Subtest: non-message callback bodies are classified as unsupported before message-only fields
ok 77 - non-message callback bodies are classified as unsupported before message-only fields
  ---
  duration_ms: 0.1615
  type: 'test'
  ...
# Subtest: Frame envelope, identity and content validation use stable reasons
ok 78 - Frame envelope, identity and content validation use stable reasons
  ---
  duration_ms: 0.7329
  type: 'test'
  ...
# Subtest: Normalized Message JSON Schema matches the Adapter interface and excludes SDK secrets
ok 79 - Normalized Message JSON Schema matches the Adapter interface and excludes SDK secrets
  ---
  duration_ms: 2.6536
  type: 'test'
  ...
# Subtest: quoted text from the recorded Gate 0 shape is preserved without raw SDK fields
ok 80 - quoted text from the recorded Gate 0 shape is preserved without raw SDK fields
  ---
  duration_ms: 0.3274
  type: 'test'
  ...
# Subtest: Gate 0 verified file, voice and video Frames use the same normalized seam
ok 81 - Gate 0 verified file, voice and video Frames use the same normalized seam
  ---
  duration_ms: 0.4097
  type: 'test'
  ...
# Subtest: quoted media keeps an independent opaque reference
ok 82 - quoted media keeps an independent opaque reference
  ---
  duration_ms: 0.3497
  type: 'test'
  ...
# Subtest: persists one Channel Message and returns the original result on replay
ok 83 - persists one Channel Message and returns the original result on replay
  ---
  duration_ms: 180.0242
  type: 'test'
  ...
# Subtest: snapshots validated input before connection acquisition
ok 84 - snapshots validated input before connection acquisition
  ---
  duration_ms: 7.7856
  type: 'test'
  ...
# Subtest: concurrent duplicates execute first processing exactly once
ok 85 - concurrent duplicates execute first processing exactly once
  ---
  duration_ms: 137.7385
  type: 'test'
  ...
# Subtest: first-processing failure rolls back the Inbox row and permits a clean retry
ok 86 - first-processing failure rolls back the Inbox row and permits a clean retry
  ---
  duration_ms: 12.3574
  type: 'test'
  ...
# Subtest: non-plain processing result roots fail as processing errors
ok 87 - non-plain processing result roots fail as processing errors
  ---
  duration_ms: 14.34
  type: 'test'
  ...
# Subtest: processing result snapshot rejects nested non-JSON runtime objects
ok 88 - processing result snapshot rejects nested non-JSON runtime objects
  ---
  duration_ms: 6.3455
  type: 'test'
  ...
# Subtest: processing result validation never executes toJSON hooks
ok 89 - processing result validation never executes toJSON hooks
  ---
  duration_ms: 4.3218
  type: 'test'
  ...
# Subtest: processing result validation rejects Proxy toJSON substitution without executing it
ok 90 - processing result validation rejects Proxy toJSON substitution without executing it
  ---
  duration_ms: 4.0861
  type: 'test'
  ...
# Subtest: inherited toJSON pollution cannot transform an otherwise plain result
ok 91 - inherited toJSON pollution cannot transform an otherwise plain result
  ---
  duration_ms: 6.2939
  type: 'test'
  ...
# Subtest: processing result snapshot accepts nested plain JSON arrays
ok 92 - processing result snapshot accepts nested plain JSON arrays
  ---
  duration_ms: 5.2537
  type: 'test'
  ...
# Subtest: first-processing callback cannot commit the Inbox transaction early
ok 93 - first-processing callback cannot commit the Inbox transaction early
  ---
  duration_ms: 4.4786
  type: 'test'
  ...
# Subtest: first-processing callback cannot change Inbox transaction characteristics
ok 94 - first-processing callback cannot change Inbox transaction characteristics
  ---
  duration_ms: 6.0617
  type: 'test'
  ...
# Subtest: comment-obfuscated transaction control remains blocked
ok 95 - comment-obfuscated transaction control remains blocked
  ---
  duration_ms: 5.2819
  type: 'test'
  ...
# Subtest: SET LOCAL cannot change the Inbox-owned transaction
ok 96 - SET LOCAL cannot change the Inbox-owned transaction
  ---
  duration_ms: 4.6588
  type: 'test'
  ...
# Subtest: session defaults cannot poison a pooled connection after Inbox commit
ok 97 - session defaults cannot poison a pooled connection after Inbox commit
  ---
  duration_ms: 53.7624
  type: 'test'
  ...
# Subtest: function-based session configuration is rejected before pooled connection reuse
ok 98 - function-based session configuration is rejected before pooled connection reuse
  ---
  duration_ms: 57.5283
  type: 'test'
  ...
# Subtest: ordinary Inbox use preserves caller-owned pool session baselines
ok 99 - ordinary Inbox use preserves caller-owned pool session baselines
  ---
  duration_ms: 64.453
  type: 'test'
  ...
# Subtest: callback-style transaction queries are rejected before PostgreSQL execution
ok 100 - callback-style transaction queries are rejected before PostgreSQL execution
  ---
  duration_ms: 8.7664
  type: 'test'
  ...
# Subtest: unawaited transaction query failure remains a processing failure
ok 101 - unawaited transaction query failure remains a processing failure
  ---
  duration_ms: 18.2059
  type: 'test'
  ...
# Subtest: transaction view is revoked when first processing settles
ok 102 - transaction view is revoked when first processing settles
  ---
  duration_ms: 11.7703
  type: 'test'
  ...
# Subtest: a duplicate after a real process restart receives the committed result
ok 103 - a duplicate after a real process restart receives the committed result
  ---
  duration_ms: 850.73
  type: 'test'
  ...
# Subtest: temporary database unavailability returns a stable retryable error without processing
ok 104 - temporary database unavailability returns a stable retryable error without processing
  ---
  duration_ms: 4.5317
  type: 'test'
  ...
# Subtest: invalid privacy, retention, plaintext payload and non-contract message fields fail before database access
ok 105 - invalid privacy, retention, plaintext payload and non-contract message fields fail before database access
  ---
  duration_ms: 3.8604
  type: 'test'
  ...
# Subtest: privacy, retention and caller-encrypted raw payload are persisted without entering the result
ok 106 - privacy, retention and caller-encrypted raw payload are persisted without entering the result
  ---
  duration_ms: 22.1021
  type: 'test'
  ...
# Subtest: migration fails closed when an existing Inbox lacks required constraints
ok 107 - migration fails closed when an existing Inbox lacks required constraints
  ---
  duration_ms: 866.0805
  type: 'test'
  ...
# Subtest: migration reports the stable drift error before indexing a table with missing columns
ok 108 - migration reports the stable drift error before indexing a table with missing columns
  ---
  duration_ms: 710.5634
  type: 'test'
  ...
# Subtest: migration rejects a weakened check constraint that keeps the expected name
ok 109 - migration rejects a weakened check constraint that keeps the expected name
  ---
  duration_ms: 1138.7201
  type: 'test'
  ...
# Subtest: migration rejects a deferrable idempotency constraint unusable by ON CONFLICT
ok 110 - migration rejects a deferrable idempotency constraint unusable by ON CONFLICT
  ---
  duration_ms: 858.6449
  type: 'test'
  ...
# Subtest: migration rejects a deferrable primary key unusable by later foreign keys
ok 111 - migration rejects a deferrable primary key unusable by later foreign keys
  ---
  duration_ms: 705.0294
  type: 'test'
  ...
# Subtest: migration rejects a same-name hash index that cannot serve retention range scans
ok 112 - migration rejects a same-name hash index that cannot serve retention range scans
  ---
  duration_ms: 508.6257
  type: 'test'
  ...
# Subtest: migration rejects an extra check constraint outside the frozen set
ok 113 - migration rejects an extra check constraint outside the frozen set
  ---
  duration_ms: 606.0588
  type: 'test'
  ...
# Subtest: migration rejects an extra unique constraint that changes write semantics
ok 114 - migration rejects an extra unique constraint that changes write semantics
  ---
  duration_ms: 578.6849
  type: 'test'
  ...
# Subtest: migration rejects a generated column that breaks explicit Inbox writes
ok 115 - migration rejects a generated column that breaks explicit Inbox writes
  ---
  duration_ms: 511.443
  type: 'test'
  ...
# Subtest: migration is reentrant when the existing Inbox matches the frozen catalog
ok 116 - migration is reentrant when the existing Inbox matches the frozen catalog
  ---
  duration_ms: 568.424
  type: 'test'
  ...
# Subtest: migration is limited to the P1-003 Channel Inbox and freezes the database constraints
ok 117 - migration is limited to the P1-003 Channel Inbox and freezes the database constraints
  ---
  duration_ms: 2.1494
  type: 'test'
  ...
# Subtest: creates one Service Intake, primary message relation and received audit event
ok 118 - creates one Service Intake, primary message relation and received audit event
  ---
  duration_ms: 153.9459
  type: 'test'
  ...
# Subtest: aggregates multiple supplements into one Intake without creating a Ticket
ok 119 - aggregates multiple supplements into one Intake without creating a Ticket
  ---
  duration_ms: 35.9883
  type: 'test'
  ...
# Subtest: explicit new-report intent starts a new Intake inside the 90-second window
ok 120 - explicit new-report intent starts a new Intake inside the 90-second window
  ---
  duration_ms: 15.3983
  type: 'test'
  ...
# Subtest: an explicit reference to another ticket closes the current aggregation window
ok 121 - an explicit reference to another ticket closes the current aggregation window
  ---
  duration_ms: 37.7251
  type: 'test'
  ...
# Subtest: pure image creates a waiting Intake and emits a clarification audit event
ok 122 - pure image creates a waiting Intake and emits a clarification audit event
  ---
  duration_ms: 10.6982
  type: 'test'
  ...
# Subtest: a description clarifies the waiting image Intake instead of creating another Intake
ok 123 - a description clarifies the waiting image Intake instead of creating another Intake
  ---
  duration_ms: 17.73
  type: 'test'
  ...
# Subtest: concurrent distinct messages in one context aggregate into exactly one Intake
ok 124 - concurrent distinct messages in one context aggregate into exactly one Intake
  ---
  duration_ms: 174.025
  type: 'test'
  ...
# Subtest: reversed lock acquisition still aggregates bounded timestamp inversion and preserves valid update time
ok 125 - reversed lock acquisition still aggregates bounded timestamp inversion and preserves valid update time
  ---
  duration_ms: 20.8616
  type: 'test'
  ...
# Subtest: reversed lock acquisition never crosses an explicit new-context boundary
ok 126 - reversed lock acquisition never crosses an explicit new-context boundary
  ---
  duration_ms: 67.9931
  type: 'test'
  ...
# Subtest: classifies the documented request types without AI and honors incident negation
ok 127 - classifies the documented request types without AI and honors incident negation
  ---
  duration_ms: 101.9964
  type: 'test'
  ...
# Subtest: standalone thanks is CHATTER without an unnecessary clarification request
ok 128 - standalone thanks is CHATTER without an unnecessary clarification request
  ---
  duration_ms: 8.4298
  type: 'test'
  ...
# Subtest: aggregate privacy is strongest, retention is earliest, and Inbox snapshots contain no report summary
ok 129 - aggregate privacy is strongest, retention is earliest, and Inbox snapshots contain no report summary
  ---
  duration_ms: 19.1797
  type: 'test'
  ...
# Subtest: includes exactly 90 seconds and starts a new Intake after the window
ok 130 - includes exactly 90 seconds and starts a new Intake after the window
  ---
  duration_ms: 30.9466
  type: 'test'
  ...
# Subtest: different senders and conversations stay separate while direct chat maps to WECOM_DIRECT
ok 131 - different senders and conversations stay separate while direct chat maps to WECOM_DIRECT
  ---
  duration_ms: 23.1514
  type: 'test'
  ...
# Subtest: Channel Message replay returns the original Intake result without duplicate relations or events
ok 132 - Channel Message replay returns the original Intake result without duplicate relations or events
  ---
  duration_ms: 12.1737
  type: 'test'
  ...
# Subtest: downstream failure rolls back Channel Message, Intake, relations and events before a clean retry
ok 133 - downstream failure rolls back Channel Message, Intake, relations and events before a clean retry
  ---
  duration_ms: 15.2545
  type: 'test'
  ...
# Subtest: migration fails closed on legacy Inbox summaries and upgrades pre-redacted aggregates
ok 134 - migration fails closed on legacy Inbox summaries and upgrades pre-redacted aggregates
  ---
  duration_ms: 260.751
  type: 'test'
  ...
# Subtest: migration runner exposes only the exact legacy-remediation failure as non-retryable
ok 135 - migration runner exposes only the exact legacy-remediation failure as non-retryable
  ---
  duration_ms: 0.3477
  type: 'test'
  ...
# Subtest: migration is limited to Service Intake, message relations and Intake audit events
ok 136 - migration is limited to Service Intake, message relations and Intake audit events
  ---
  duration_ms: 1.7926
  type: 'test'
  ...
# Subtest: Service Intake JSON Schema freezes the domain boundary and P1-004 version semantics
ok 137 - Service Intake JSON Schema freezes the domain boundary and P1-004 version semantics
  ---
  duration_ms: 1.1025
  type: 'test'
  ...
# Subtest: Service Intake migration is re-entrant
ok 138 - Service Intake migration is re-entrant
  ---
  duration_ms: 4.1515
  type: 'test'
  ...
# Subtest: invalid aggregation windows fail before a processor can access a transaction
ok 139 - invalid aggregation windows fail before a processor can access a transaction
  ---
  duration_ms: 0.4164
  type: 'test'
  ...
# Subtest: an explicit report creates one idempotent Pilot Ticket without AI or Hospital Tickets
ok 140 - an explicit report creates one idempotent Pilot Ticket without AI or Hospital Tickets
  ---
  duration_ms: 265.5115
  type: 'test'
  ...
# Subtest: a downstream failure rolls back the Intake-to-Ticket relationship before retry
ok 141 - a downstream failure rolls back the Intake-to-Ticket relationship before retry
  ---
  duration_ms: 24.5094
  type: 'test'
  ...
# Subtest: a Ticket number collision fails explicitly and leaves the second Intake unlinked
ok 142 - a Ticket number collision fails explicitly and leaves the second Intake unlinked
  ---
  duration_ms: 29.7318
  type: 'test'
  ...
# Subtest: the database rejects a Ticket when its source Intake does not point back to it
ok 143 - the database rejects a Ticket when its source Intake does not point back to it
  ---
  duration_ms: 11.6859
  type: 'test'
  ...
# Subtest: explicit Ticket Actions enforce legal transitions, versions, and an ordered audit timeline
ok 144 - explicit Ticket Actions enforce legal transitions, versions, and an ordered audit timeline
  ---
  duration_ms: 154.8857
  type: 'test'
  ...
# Subtest: concurrent handlers cannot both accept the same queued Ticket
ok 145 - concurrent handlers cannot both accept the same queued Ticket
  ---
  duration_ms: 47.9154
  type: 'test'
  ...
# Subtest: Phase 1 rejects an Incident-link action until the Phase 2 Incident fact exists
ok 146 - Phase 1 rejects an Incident-link action until the Phase 2 Incident fact exists
  ---
  duration_ms: 41.0894
  type: 'test'
  ...
# Subtest: state, Ticket Event, Outbox, and target deliveries commit together while delivery failures retry independently
ok 147 - state, Ticket Event, Outbox, and target deliveries commit together while delivery failures retry independently
  ---
  duration_ms: 273.5271
  type: 'test'
  ...
# Subtest: a leased Delivery is not sent twice by concurrent Workers and terminal failures become dead letters
ok 148 - a leased Delivery is not sent twice by concurrent Workers and terminal failures become dead letters
  ---
  duration_ms: 79.0977
  type: 'test'
  ...
# Subtest: an Outbox failure rolls back the Ticket state and its Ticket Event
ok 149 - an Outbox failure rolls back the Ticket state and its Ticket Event
  ---
  duration_ms: 19.4029
  type: 'test'
  ...
# Subtest: the default notification matrix keeps internal notes off reporter delivery and the Worker rate-limits each target
ok 150 - the default notification matrix keeps internal notes off reporter delivery and the Worker rate-limits each target
  ---
  duration_ms: 125.0912
  type: 'test'
  ...
# Subtest: first acknowledgement is sent only after commit and a reconnect replay does not create or send twice
ok 151 - first acknowledgement is sent only after commit and a reconnect replay does not create or send twice
  ---
  duration_ms: 156.8747
  type: 'test'
  ...
# Subtest: temporary delivery failure preserves a real Ticket for retry, while a non-report never fabricates a Ticket number
ok 152 - temporary delivery failure preserves a real Ticket for retry, while a non-report never fabricates a Ticket number
  ---
  duration_ms: 39.7098
  type: 'test'
  ...
# Subtest: Pilot roles isolate teams, enable audited handling, and keep internal notes out of reporter views
ok 153 - Pilot roles isolate teams, enable audited handling, and keep internal notes out of reporter views
  ---
  duration_ms: 201.6289
  type: 'test'
  ...
# Subtest: the minimum local Pilot workbench exposes an injected authenticated mobile-friendly work view
ok 154 - the minimum local Pilot workbench exposes an injected authenticated mobile-friendly work view
  ---
  duration_ms: 55.1906
  type: 'test'
  ...
# Subtest: supplement, card confirmation, duplicate card protection, close, and reopen preserve a real Ticket lifecycle
ok 155 - supplement, card confirmation, duplicate card protection, close, and reopen preserve a real Ticket lifecycle
  ---
  duration_ms: 275.342
  type: 'test'
  ...
# Subtest: the complete lifecycle processor exposes created delivery ids for post-commit acknowledgement
ok 156 - the complete lifecycle processor exposes created delivery ids for post-commit acknowledgement
  ---
  duration_ms: 21.7616
  type: 'test'
  ...
# Subtest: expired cards do not mutate Tickets and resolved Tickets close automatically with an explicit non-user reason
ok 157 - expired cards do not mutate Tickets and resolved Tickets close automatically with an explicit non-user reason
  ---
  duration_ms: 54.9422
  type: 'test'
  ...
# Subtest: P1-011 parses only explicit backup drill modes and keeps credentials out of utility arguments
ok 158 - P1-011 parses only explicit backup drill modes and keeps credentials out of utility arguments
  ---
  duration_ms: 1.8649
  type: 'test'
  ...
# Subtest: P1-011 backup check validates controls without writing credential or encryption-key values
ok 159 - P1-011 backup check validates controls without writing credential or encryption-key values
  ---
  duration_ms: 128.4349
  type: 'test'
  ...
# Subtest: P1-011 emits a fixed restore alert and failure context when a drill cannot start
ok 160 - P1-011 emits a fixed restore alert and failure context when a drill cannot start
  ---
  duration_ms: 38.0503
  type: 'test'
  ...
# Subtest: P1-011 keeps a logical backup encrypted at rest while restoring the exact stream
ok 161 - P1-011 keeps a logical backup encrypted at rest while restoring the exact stream
  ---
  duration_ms: 18.399
  type: 'test'
  ...
# Subtest: P1-011 authenticates an encrypted artifact before exposing any plaintext to the restore consumer
ok 162 - P1-011 authenticates an encrypted artifact before exposing any plaintext to the restore consumer
  ---
  duration_ms: 10.3673
  type: 'test'
  ...
# Subtest: P1-011 writes only a redacted, structured operational log record
ok 163 - P1-011 writes only a redacted, structured operational log record
  ---
  duration_ms: 56.2428
  type: 'test'
  ...
# Subtest: P1-011 keeps a persisted core intake available when optional dependencies fail
ok 164 - P1-011 keeps a persisted core intake available when optional dependencies fail
  ---
  duration_ms: 2.4417
  type: 'test'
  ...
# Subtest: P1-011 composes the operational boundary around the real Inbox to Pilot Ticket lifecycle
ok 165 - P1-011 composes the operational boundary around the real Inbox to Pilot Ticket lifecycle
  ---
  duration_ms: 94.7141
  type: 'test'
  ...
# Subtest: P1-011 alerts with stable codes without carrying the rejected sensitive values
ok 166 - P1-011 alerts with stable codes without carrying the rejected sensitive values
  ---
  duration_ms: 0.6968
  type: 'test'
  ...
# Subtest: P1-011 serves the Pilot workbench under a same-origin CSP without inline code
ok 167 - P1-011 serves the Pilot workbench under a same-origin CSP without inline code
  ---
  duration_ms: 26.3991
  type: 'test'
  ...
# Subtest: P1-011 preserves safe backup and restore checkpoints in an admin-only immutable audit trail
ok 168 - P1-011 preserves safe backup and restore checkpoints in an admin-only immutable audit trail
  ---
  duration_ms: 67.5437
  type: 'test'
  ...
# Subtest: P1-012 accepts only an explicit check or approved live scenario
ok 169 - P1-012 accepts only an explicit check or approved live scenario
  ---
  duration_ms: 2.8321
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"a87b3d613ed96da8e2efc679d430ee0c","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING"}}
# Subtest: P1-012 recovers only an explicitly approved, stale, terminated-local reply-probe evidence claim and audits it
ok 170 - P1-012 recovers only an explicitly approved, stale, terminated-local reply-probe evidence claim and audits it
  ---
  duration_ms: 46.4768
  type: 'test'
  ...
# Subtest: P1-012 restores the stale claim and releases the recovery guard if its recovery audit cannot append
ok 171 - P1-012 restores the stale claim and releases the recovery guard if its recovery audit cannot append
  ---
  duration_ms: 23.9687
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
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"97709ea00cb77f3b31bd9faa2983e60a","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING","resumed":true}}
# Subtest: P1-012 retains a truthful quarantine audit and blocks replies when quarantine cleanup fails, then resumes safely
ok 172 - P1-012 retains a truthful quarantine audit and blocks replies when quarantine cleanup fails, then resumes safely
  ---
  duration_ms: 48.579
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
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"8fbec5a49e7891f8c0d3ee4bc19fb9b5","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING"}}
# Subtest: P1-012 atomically takes over a stale recovery guard while a live reply and second recovery remain blocked
ok 173 - P1-012 atomically takes over a stale recovery guard while a live reply and second recovery remain blocked
  ---
  duration_ms: 32.4694
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
  duration_ms: 21.2834
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
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"f382830123bec947ebfedc4397579e54","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING"}}
# Subtest: P1-012 recovery guard blocks concurrent recovery and live reply acquisition until recovery audit completes
ok 175 - P1-012 recovery guard blocks concurrent recovery and live reply acquisition until recovery audit completes
  ---
  duration_ms: 22.3321
  type: 'test'
  ...
# Subtest: P1-012 validates WSS and Pilot configuration without requiring a public listener
ok 176 - P1-012 validates WSS and Pilot configuration without requiring a public listener
  ---
  duration_ms: 0.5391
  type: 'test'
  ...
# Subtest: P1-012 check emits a redacted readiness record with no public-IP prerequisite
ok 177 - P1-012 check emits a redacted readiness record with no public-IP prerequisite
  ---
  duration_ms: 250.2738
  type: 'test'
  ...
# Subtest: P1-012 marks an active delivery without an explicit provider ACK as retryable
ok 178 - P1-012 marks an active delivery without an explicit provider ACK as retryable
  ---
  duration_ms: 0.3908
  type: 'test'
  ...
# Subtest: P1-012 uses the Gate-0-verified completed stream shape for a group passive reply
ok 179 - P1-012 uses the Gate-0-verified completed stream shape for a group passive reply
  ---
  duration_ms: 0.257
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
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_REPLY_PROBE","probe":{"exact_token":true,"addressing":"WECOM_MENTION_PREFIX","database_write":false,"run_id":"6e2784b26929f63dc659a0523dc9cfea"},"passive_reply":{"operation":"aibot_respond_msg_stream","attempted":true,"acknowledged":true,"provider_errcode":0,"outcome":"ACKED"}}
# Subtest: P1-012 keeps a short reply probe exact-scoped and out of the Pilot database
ok 180 - P1-012 keeps a short reply probe exact-scoped and out of the Pilot database
  ---
  duration_ms: 35.8861
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
  duration_ms: 47.4187
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_client_display_observed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT","source_result_hash":"a98b043eaf220dfa7f8a6d15a1fdb998","provider_reply_acknowledged":true,"database_write":true,"ticket_created":true,"intake_status":"TICKET_CREATED","observer":"configured_test_account","observation":"VISIBLE"}
# Subtest: P1-012 records one HMAC-linked client observation for a successful Ticket-creating group text
ok 182 - P1-012 records one HMAC-linked client observation for a successful Ticket-creating group text
  ---
  duration_ms: 11.4407
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_shared_delivery_reconciled","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"SHARED_DELIVERY_RECONCILIATION","database_mutation":false,"synthetic_signature":"ACK_PREFIX","delivery_count":2,"ticket_count":1,"attempt_count":3,"retry_attempts":1,"synthetic_sent_attempts":2,"channels":{"pilot_team":1,"wecom_direct":1},"audit_history_preserved":true,"excluded_from_real_wecom_delivery_evidence":true,"reconciliation_status":"IDENTIFIED_AND_EXCLUDED"}
# Subtest: P1-012 reconciles the exact synthetic shared Delivery footprint without mutating database facts
ok 183 - P1-012 reconciles the exact synthetic shared Delivery footprint without mutating database facts
  ---
  duration_ms: 4.1212
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_client_display_observed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","source_result_hash":"4820f6a54a47a36001fef143b95d984c","source_addressing":"WECOM_MENTION_PREFIX","provider_reply_acknowledged":true,"database_write":false,"observer":"configured_test_account","observation":"VISIBLE"}
# Subtest: P1-012 serializes concurrent client observations for one reply-probe source
ok 184 - P1-012 serializes concurrent client observations for one reply-probe source
  ---
  duration_ms: 17.0495
  type: 'test'
  ...
# Subtest: P1-012 rejects a client observation whose source becomes stale before it claims the evidence chain
ok 185 - P1-012 rejects a client observation whose source becomes stale before it claims the evidence chain
  ---
  duration_ms: 3.3812
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
  duration_ms: 18.0251
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# Subtest: P1-012 prevents a reply probe from starting after an earlier evidence failure has won
ok 187 - P1-012 prevents a reply probe from starting after an earlier evidence failure has won
  ---
  duration_ms: 24.6567
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_REPLY_PROBE","probe":{"exact_token":true,"addressing":"BARE","database_write":false,"run_id":"2de06ea0a32ba1e989eb019675fa136c"},"passive_reply":{"operation":"aibot_respond_msg_stream","attempted":true,"acknowledged":true,"provider_errcode":0,"outcome":"ACKED"}}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_EVIDENCE_WRITE_FAILED"}
# Subtest: P1-012 records an in-flight reply probe before its deferred terminal failure
ok 188 - P1-012 records an in-flight reply probe before its deferred terminal failure
  ---
  duration_ms: 32.5601
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_LIVE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN"}
# Subtest: P1-012 hard-times-out a permanently pending reply probe with an explicit unknown side-effect state
ok 189 - P1-012 hard-times-out a permanently pending reply probe with an explicit unknown side-effect state
  ---
  duration_ms: 18.2029
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_LIVE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN"}
# Subtest: P1-012 suppresses a late reply-probe success record after its hard timeout
ok 190 - P1-012 suppresses a late reply-probe success record after its hard timeout
  ---
  duration_ms: 29.4884
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_EVIDENCE_WRITE_FAILED"}
# Subtest: P1-012 prevents a failed group-id capture run from updating the local group id
ok 191 - P1-012 prevents a failed group-id capture run from updating the local group id
  ---
  duration_ms: 9.6604
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_applied","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"side_effect_state":"APPLIED","configuration_updated":true,"group_id_hash":"9aa6151c5e05da82086348a14803d96d"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_EVIDENCE_WRITE_FAILED","side_effect_state":"APPLIED","configuration_updated":true,"group_id_hash":"9aa6151c5e05da82086348a14803d96d"}
# Subtest: P1-012 records an in-flight group-id capture before its deferred terminal failure
ok 192 - P1-012 records an in-flight group-id capture before its deferred terminal failure
  ---
  duration_ms: 29.1996
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
  duration_ms: 14.1036
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_GROUP_ID_CAPTURE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN","group_id_hash":"eac76feda981759f44d849e3e50e5a7e","reconciliation_required":true}
# Subtest: P1-012 hard-times-out a pending group-id capture and aborts its local update seam
ok 194 - P1-012 hard-times-out a pending group-id capture and aborts its local update seam
  ---
  duration_ms: 5.604
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_GROUP_ID_CAPTURE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN","group_id_hash":"eac76feda981759f44d849e3e50e5a7e","reconciliation_required":true}
# Subtest: P1-012 leaves a late non-cooperative capture update as reconcilable unknown without a late applied record
ok 195 - P1-012 leaves a late non-cooperative capture update as reconcilable unknown without a late applied record
  ---
  duration_ms: 21.0223
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_error","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT","error_code":"ECONNRESET"}
# {"test_id":"P1-012","event":"p1_012_wss_disconnected","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reconnecting","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reauthenticated","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_TEXT","core":{"accepted":true},"passive_reply":{"acknowledged":true},"run_id":"b40774bc1985ef7b5f80ce5ec7bb8fb9"}
# Subtest: P1-012 waits through a transient SDK disconnect and records only safe reconnect evidence
ok 196 - P1-012 waits through a transient SDK disconnect and records only safe reconnect evidence
  ---
  duration_ms: 39.049
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
  duration_ms: 16.3365
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
  duration_ms: 275.0466
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT","timeout_ms":10000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_disconnected","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reconnect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reauthenticated","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_post_reconnect_message_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT","reauthenticated":true}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"RECONNECT_GROUP_TEXT","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"SENT"},"run_id":"b7ec74f12b1a57d3c5ae00f48b820a1d","reconnect":{"reauthenticated_before_callback":true}}
# Subtest: P1-012 forces reauthentication before accepting one scoped group-text callback
ok 199 - P1-012 forces reauthentication before accepting one scoped group-text callback
  ---
  duration_ms: 308.6072
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
# {"test_id":"P1-012","event":"p1_012_live_burst_result","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100","run_id":"0b89ac031c03c0d69c37ed1f254ecb72","expected_count":100,"callback_count":100,"unique_message_count":100,"accepted_within_target_count":100,"duplicate_callback_count":0,"database":{"inbox_count":100,"intake_count":100,"ticket_count":100,"outbox_count":100,"delivery_count":200,"tickets_with_invalid_outbox_count":0,"tickets_with_invalid_delivery_count":0},"zero_lost_tickets":true,"zero_duplicate_tickets":true,"notifications_traceable":true,"collection_elapsed_ms":78,"outcome":"PASSED"}
# Subtest: P1-012 completes a strictly sequenced 100-message live burst only after database fact reconciliation
ok 200 - P1-012 completes a strictly sequenced 100-message live burst only after database fact reconciliation
  ---
  duration_ms: 84.4616
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":1,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":2,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":3,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":4,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":5,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":6,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":7,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":8,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":9,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":10,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":11,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":12,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":13,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":14,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":15,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":16,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":17,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":18,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":19,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":20,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":21,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":22,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":23,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":24,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":25,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":26,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":27,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":28,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":29,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":30,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":31,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":32,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":33,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":34,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":35,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":36,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":37,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":38,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":39,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":40,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":41,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":42,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":43,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":44,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":45,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":46,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":47,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":48,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":49,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":50,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":51,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":52,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":53,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":54,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":55,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":56,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":57,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":58,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":59,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":60,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":61,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":62,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":63,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":64,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":65,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":66,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":67,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":68,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":69,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":70,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":71,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":72,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":73,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":74,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":75,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":76,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":77,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":78,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":79,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":80,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":81,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":82,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":83,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":84,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":85,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":86,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":87,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":88,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":89,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":90,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":91,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":92,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":93,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":94,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":95,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":96,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":97,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":98,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":99,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":100,"run_id":"dbf939144c39d44ffc87b5517abae5e7"}
# {"test_id":"P1-012","event":"p1_012_live_burst_result","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100","run_id":"dbf939144c39d44ffc87b5517abae5e7","expected_count":100,"callback_count":100,"unique_message_count":100,"accepted_within_target_count":100,"duplicate_callback_count":0,"database":{"inbox_count":100,"intake_count":100,"ticket_count":100,"outbox_count":100,"delivery_count":200,"tickets_with_invalid_outbox_count":2,"tickets_with_invalid_delivery_count":2},"zero_lost_tickets":true,"zero_duplicate_tickets":true,"notifications_traceable":false,"collection_elapsed_ms":67,"outcome":"FAILED"}
# Subtest: P1-012 burst fails closed when global notification totals mask per-ticket gaps
ok 201 - P1-012 burst fails closed when global notification totals mask per-ticket gaps
  ---
  duration_ms: 72.4631
  type: 'test'
  ...
# Subtest: P1-012 exercises the real Pilot core under duplicate, image, burst, Outbox failure, and AI-off conditions
ok 202 - P1-012 exercises the real Pilot core under duplicate, image, burst, Outbox failure, and AI-off conditions
  ---
  duration_ms: 806.9843
  type: 'test'
  ...
# Subtest: P1-012 handles a scoped group text frame through Intake then a safe reply and Delivery
ok 203 - P1-012 handles a scoped group text frame through Intake then a safe reply and Delivery
  ---
  duration_ms: 5.4167
  type: 'test'
  ...
# Subtest: P1-012 records an image-degraded Intake without fabricating a Ticket
ok 204 - P1-012 records an image-degraded Intake without fabricating a Ticket
  ---
  duration_ms: 0.6377
  type: 'test'
  ...
# Subtest: P1-012 accepts an addressed group mixed image only when it contains the run token and an image
ok 205 - P1-012 accepts an addressed group mixed image only when it contains the run token and an image
  ---
  duration_ms: 0.772
  type: 'test'
  ...
# Subtest: P1-012 ignores an unscoped group frame without calling any operational seam
ok 206 - P1-012 ignores an unscoped group frame without calling any operational seam
  ---
  duration_ms: 0.289
  type: 'test'
  ...
# Subtest: P1-012 keeps a transient core failure safe and retryable without leaking the failure text
ok 207 - P1-012 keeps a transient core failure safe and retryable without leaking the failure text
  ---
  duration_ms: 0.5242
  type: 'test'
  ...
# Subtest: P1-012 keeps a thrown database fault out of the client reply and safe evidence
ok 208 - P1-012 keeps a thrown database fault out of the client reply and safe evidence
  ---
  duration_ms: 0.525
  type: 'test'
  ...
# Subtest: P1-012 requires an explicit successful provider receipt for a passive reply
ok 209 - P1-012 requires an explicit successful provider receipt for a passive reply
  ---
  duration_ms: 0.4304
  type: 'test'
  ...
# Subtest: P1-012 preserves a provider reply rejection code without keeping its message text
ok 210 - P1-012 preserves a provider reply rejection code without keeping its message text
  ---
  duration_ms: 0.4619
  type: 'test'
  ...
# Subtest: P1-012 Go/No-Go requires real client observation but never a public IP for outbound WSS
ok 211 - P1-012 Go/No-Go requires real client observation but never a public IP for outbound WSS
  ---
  duration_ms: 0.3136
  type: 'test'
  ...
# Subtest: P1-012 WeCom burst UI plan is side-effect free and preserves the requested sequence range
ok 212 - P1-012 WeCom burst UI plan is side-effect free and preserves the requested sequence range
  ---
  duration_ms: 1498.9067
  type: 'test'
  ...
# Subtest: P1-012 WeCom burst UI driver fails closed on invalid ranges and ambiguous modes
ok 213 - P1-012 WeCom burst UI driver fails closed on invalid ranges and ambiguous modes
  ---
  duration_ms: 1884.7497
  type: 'test'
  ...
# Subtest: P1-012 WeCom burst UI driver retains fail-closed target, clipboard, stop, and reconciliation guards
ok 214 - P1-012 WeCom burst UI driver retains fail-closed target, clipboard, stop, and reconciliation guards
  ---
  duration_ms: 13.6328
  type: 'test'
  ...
# Subtest: P2-001 PostgreSQL contract is idempotent, isolated, and fail closed
ok 215 - P2-001 PostgreSQL contract is idempotent, isolated, and fail closed
  ---
  duration_ms: 1080.6149
  type: 'test'
  ...
# Subtest: all P2 conversation feature flags default to false
ok 216 - all P2 conversation feature flags default to false
  ---
  duration_ms: 1.3871
  type: 'test'
  ...
# Subtest: Thread identity separates single, group, and multiple bots without exposing raw ids in its key
ok 217 - Thread identity separates single, group, and multiple bots without exposing raw ids in its key
  ---
  duration_ms: 0.8045
  type: 'test'
  ...
# Subtest: Thread identity rejects malformed channel scope with a stable error
ok 218 - Thread identity rejects malformed channel scope with a stable error
  ---
  duration_ms: 0.3944
  type: 'test'
  ...
# Subtest: group Session scope isolates participants and Intakes
ok 219 - group Session scope isolates participants and Intakes
  ---
  duration_ms: 0.4494
  type: 'test'
  ...
# Subtest: Session boundary rules cover ended, explicit, different Intake, idle equality, and continuation
ok 220 - Session boundary rules cover ended, explicit, different Intake, idle equality, and continuation
  ---
  duration_ms: 0.6554
  type: 'test'
  ...
# Subtest: only auditable boundary reasons are accepted from callers
ok 221 - only auditable boundary reasons are accepted from callers
  ---
  duration_ms: 0.3437
  type: 'test'
  ...
# Subtest: Session lifecycle is OPEN/WAITING_USER with ENDED terminal
ok 222 - Session lifecycle is OPEN/WAITING_USER with ENDED terminal
  ---
  duration_ms: 0.2026
  type: 'test'
  ...
# Subtest: control modes fail closed, default HUMAN, and reserve AUTO for P2-010/P2-G4
ok 223 - control modes fail closed, default HUMAN, and reserve AUTO for P2-010/P2-G4
  ---
  duration_ms: 0.2697
  type: 'test'
  ...
# Subtest: generation and row versions advance only for unique invalidating changes
ok 224 - generation and row versions advance only for unique invalidating changes
  ---
  duration_ms: 0.6343
  type: 'test'
  ...
# Subtest: disabled guard does not invoke storage or external seams and raw failures stay hidden
ok 225 - disabled guard does not invoke storage or external seams and raw failures stay hidden
  ---
  duration_ms: 0.5996
  type: 'test'
  ...
# Subtest: database failures map to stable public errors
ok 226 - database failures map to stable public errors
  ---
  duration_ms: 0.1359
  type: 'test'
  ...
# Subtest: P2-001 migration is limited to Thread and Session and reserves later tasks
ok 227 - P2-001 migration is limited to Thread and Session and reserves later tasks
  ---
  duration_ms: 6.2843
  type: 'test'
  ...
# Subtest: JSON Schemas, public OpenAPI view, and TypeScript declarations freeze safe vocabulary
ok 228 - JSON Schemas, public OpenAPI view, and TypeScript declarations freeze safe vocabulary
  ---
  duration_ms: 2.981
  type: 'test'
  ...
# Subtest: P2-002 migration 011 first/repeat apply is exact and leaves P1/P2-001 unchanged
ok 229 - P2-002 migration 011 first/repeat apply is exact and leaves P1/P2-001 unchanged
  ---
  duration_ms: 647.0044
  type: 'test'
  ...
# Subtest: P2-002 migration CLI runs only 011, is repeatable, and rolls check mode back
ok 230 - P2-002 migration CLI runs only 011, is repeatable, and rolls check mode back
  ---
  duration_ms: 1663.6132
  type: 'test'
  ...
# {"child_process_runs":4,"child_exit_codes":[0,0,0,0],"preapply_check_created_tables":0,"migration_files_executed":1,"tables_added":3,"p1_p2_001_catalog_unchanged":true,"postapply_check_rolled_back":true,"temp_database_cleanup":true}
# Subtest: P2-002 migration CLI fails closed on incompatible read-only source dependencies
ok 231 - P2-002 migration CLI fails closed on incompatible read-only source dependencies
  ---
  duration_ms: 810.5906
  type: 'test'
  ...
# {"child_exit_code":1,"stable_error":"P2_002_SCHEMA_DRIFT_REMEDIATION_REQUIRED","p2_tables_created":0,"temp_database_cleanup":true}
# Subtest: P2-002 migration 011 fails closed on missing column
ok 232 - P2-002 migration 011 fails closed on missing column
  ---
  duration_ms: 630.4586
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on weakened CHECK constraint
ok 233 - P2-002 migration 011 fails closed on weakened CHECK constraint
  ---
  duration_ms: 717.4173
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on wrong unique constraint columns
ok 234 - P2-002 migration 011 fails closed on wrong unique constraint columns
  ---
  duration_ms: 813.9395
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on wrong index access method
ok 235 - P2-002 migration 011 fails closed on wrong index access method
  ---
  duration_ms: 636.3538
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on wrong partial-index predicate
ok 236 - P2-002 migration 011 fails closed on wrong partial-index predicate
  ---
  duration_ms: 605.4218
  type: 'test'
  ...
# Subtest: P2-002 P1 source adapter reads Channel/Intake/Ticket/Delivery facts without mutating them
ok 237 - P2-002 P1 source adapter reads Channel/Intake/Ticket/Delivery facts without mutating them
  ---
  duration_ms: 2829.0586
  type: 'test'
  ...
# {"source_record_count":4,"channel_message_count":1,"ticket_event_variant_count":2,"delivery_count":1,"source_snapshot_unchanged":true}
# Subtest: P2-002 real worker processes roll back before commit and replay after ACK loss
ok 238 - P2-002 real worker processes roll back before commit and replay after ACK loss
  ---
  duration_ms: 2133.0835
  type: 'test'
  ...
# {"before_commit_kill_exit":{"code":null,"signal":"SIGKILL","killed":true},"before_commit_backend_close_polls":1,"before_commit_restart_exit":{"code":0,"signal":null,"killed":false},"before_commit_restart_inserted":1,"after_commit_kill_exit":{"code":null,"signal":"SIGKILL","killed":true},"after_commit_backend_close_polls":1,"after_commit_restart_exit":{"code":0,"signal":null,"killed":false},"after_commit_restart_replayed":1,"final_item_count":1,"final_binding_count":1,"final_checkpoint_cursor":"1","temp_database_cleanup":true}
# Subtest: P2-002 stale rebuild cannot delete a source committed after snapshot preparation
ok 239 - P2-002 stale rebuild cannot delete a source committed after snapshot preparation
  ---
  duration_ms: 1167.3236
  type: 'test'
  ...
# {"connection_wait_polls":1,"stale_rebuild_error":"CONVERSATION_TIMELINE_REBUILD_FAILED","preserved_item_count":3,"preserved_binding_count":3,"preserved_checkpoint_cursor":"3","full_rebuild_item_count":3,"full_rebuild_hash":"4275bd8ee1e6ba0cdc44118689f1d8cb2b6e2adf3258e6144643e414d703c45b","temp_database_cleanup":true}
# Subtest: P2-002 projector is idempotent, concurrent, transactional, rebuildable, private, and restart safe
ok 240 - P2-002 projector is idempotent, concurrent, transactional, rebuildable, private, and restart safe
  ---
  duration_ms: 10597.4486
  type: 'test'
  ...
# {"same_source_concurrency":12,"different_source_concurrency":12,"bulk_item_count":2001,"bulk_batch_count":101,"bulk_max_batch_size":20,"bulk_peak_heap_delta_bytes":21027968,"bulk_heap_sample_count":101,"bulk_heap_segment_means_bytes":[17609815,20206558,23928832,24593853],"bulk_first_to_last_heap_trend_bytes":6984038,"bulk_max_adjacent_heap_trend_bytes":3722274,"bulk_interrupted_at_cursor":"20","bulk_restart_remaining_items":1981,"rebuild_canonical_hash":"e256db7eacb7f5f30a0d9cfdf6b1ace76430a732b145857c25d35d3396205e95","temp_database_cleanup":"verified-by-finally"}
# Subtest: P2-002 suite leaves no random database or worker backend residual
ok 241 - P2-002 suite leaves no random database or worker backend residual
  ---
  duration_ms: 56.5982
  type: 'test'
  ...
# {"temp_database_count":0,"worker_backend_count":0,"isolated_source_data_residual":0,"isolated_projection_schema_residual":0}
# Subtest: P2-002 uses the frozen P2-001 Conversation Item enums
ok 242 - P2-002 uses the frozen P2-001 Conversation Item enums
  ---
  duration_ms: 6.1355
  type: 'test'
  ...
# Subtest: projection source schema parses and freezes the five source types
ok 243 - projection source schema parses and freezes the five source types
  ---
  duration_ms: 1.372
  type: 'test'
  ...
# Subtest: normalization rejects invalid source type, session UUID, date, ordinal and additions
ok 244 - normalization rejects invalid source type, session UUID, date, ordinal and additions
  ---
  duration_ms: 2.2909
  type: 'test'
  ...
# Subtest: date normalization rejects hostile Date/object paths without invoking or leaking them
ok 245 - date normalization rejects hostile Date/object paths without invoking or leaking them
  ---
  duration_ms: 0.6006
  type: 'test'
  ...
# Subtest: safe_content accepts only bounded plain JSON data properties
ok 246 - safe_content accepts only bounded plain JSON data properties
  ---
  duration_ms: 0.6431
  type: 'test'
  ...
# Subtest: toJSON, Proxy and prototype-pollution keys cannot bypass pure JSON checks
ok 247 - toJSON, Proxy and prototype-pollution keys cannot bypass pure JSON checks
  ---
  duration_ms: 0.5578
  type: 'test'
  ...
# Subtest: source_hash is stable across key order and detects semantic mutation
ok 248 - source_hash is stable across key order and detects semantic mutation
  ---
  duration_ms: 0.6546
  type: 'test'
  ...
# Subtest: privacy and retention controls can tighten without changing semantic source_hash
ok 249 - privacy and retention controls can tighten without changing semantic source_hash
  ---
  duration_ms: 0.2723
  type: 'test'
  ...
# Subtest: canonical order uses the frozen rank and exact deterministic tie-break tuple
ok 250 - canonical order uses the frozen rank and exact deterministic tie-break tuple
  ---
  duration_ms: 0.726
  type: 'test'
  ...
# Subtest: canonical order compares BIGINT ordinals numerically without Number conversion
ok 251 - canonical order compares BIGINT ordinals numerically without Number conversion
  ---
  duration_ms: 0.848
  type: 'test'
  ...
# Subtest: source id and variant break otherwise identical timestamp/rank/ordinal ties
ok 252 - source id and variant break otherwise identical timestamp/rank/ordinal ties
  ---
  duration_ms: 1.0845
  type: 'test'
  ...
# Subtest: CHANNEL_MESSAGE maps only clean_text and four safe flags
ok 253 - CHANNEL_MESSAGE maps only clean_text and four safe flags
  ---
  duration_ms: 0.5264
  type: 'test'
  ...
# Subtest: TICKET_EVENT splits STATUS, EXTERNAL_NOTE and INTERNAL_NOTE variants
ok 254 - TICKET_EVENT splits STATUS, EXTERNAL_NOTE and INTERNAL_NOTE variants
  ---
  duration_ms: 0.4352
  type: 'test'
  ...
# Subtest: TICKET_EVENT external variant cannot contain internal note or operator identity
ok 255 - TICKET_EVENT external variant cannot contain internal note or operator identity
  ---
  duration_ms: 0.2807
  type: 'test'
  ...
# Subtest: TICKET_EVENT omits absent note variants
ok 256 - TICKET_EVENT omits absent note variants
  ---
  duration_ms: 0.1985
  type: 'test'
  ...
# Subtest: DELIVERY is INTERNAL and excludes target/provider/raw error data
ok 257 - DELIVERY is INTERNAL and excludes target/provider/raw error data
  ---
  duration_ms: 0.3239
  type: 'test'
  ...
# Subtest: Communication Message fixture mapper requires an explicit fixture marker
ok 258 - Communication Message fixture mapper requires an explicit fixture marker
  ---
  duration_ms: 0.2714
  type: 'test'
  ...
# Subtest: Handoff fixture defaults to INTERNAL and never creates a future table dependency
ok 259 - Handoff fixture defaults to INTERNAL and never creates a future table dependency
  ---
  duration_ms: 0.1918
  type: 'test'
  ...
# Subtest: normalized safe_content deny-list blocks privacy and provider leakage fields
ok 260 - normalized safe_content deny-list blocks privacy and provider leakage fields
  ---
  duration_ms: 0.4432
  type: 'test'
  ...
# Subtest: feature flag is fail-closed before any database call
ok 261 - feature flag is fail-closed before any database call
  ---
  duration_ms: 0.4478
  type: 'test'
  ...
# Subtest: batchSize defaults to 20 and is bounded at construction and invocation
ok 262 - batchSize defaults to 20 and is bounded at construction and invocation
  ---
  duration_ms: 0.453
  type: 'test'
  ...
# Subtest: runtime freezes every source and operation to the single timeline projector name
ok 263 - runtime freezes every source and operation to the single timeline projector name
  ---
  duration_ms: 0.8768
  type: 'test'
  ...
# Subtest: public storage failures contain only the stable code
ok 264 - public storage failures contain only the stable code
  ---
  duration_ms: 0.2935
  type: 'test'
  ...
# Subtest: database sequence uniqueness is deterministically mapped to the frozen sequence error
ok 265 - database sequence uniqueness is deterministically mapped to the frozen sequence error
  ---
  duration_ms: 4.0406
  type: 'test'
  ...
# Subtest: rebuild authorization and wrapper accessor validation fail before storage
ok 266 - rebuild authorization and wrapper accessor validation fail before storage
  ---
  duration_ms: 1.4139
  type: 'test'
  ...
# Subtest: rebuild stale-snapshot fence fails before DELETE for extra or foreign bindings
ok 267 - rebuild stale-snapshot fence fails before DELETE for extra or foreign bindings
  ---
  duration_ms: 1.4547
  type: 'test'
  ...
# Subtest: Canonical Timeline Hash excludes projected_at and physical input order
ok 268 - Canonical Timeline Hash excludes projected_at and physical input order
  ---
  duration_ms: 0.4422
  type: 'test'
  ...
# Subtest: Canonical Timeline Hash validates arrays and items before any caller property access
ok 269 - Canonical Timeline Hash validates arrays and items before any caller property access
  ---
  duration_ms: 1.4386
  type: 'test'
  ...
# Subtest: EXTERNAL audience uses SQL visibility filtering and defense-in-depth filtering
ok 270 - EXTERNAL audience uses SQL visibility filtering and defense-in-depth filtering
  ---
  duration_ms: 0.707
  type: 'test'
  ...
# Subtest: WORKBENCH excludes RESTRICTED and RESTRICTED_ADMIN requires explicit authorization
ok 271 - WORKBENCH excludes RESTRICTED and RESTRICTED_ADMIN requires explicit authorization
  ---
  duration_ms: 0.2583
  type: 'test'
  ...
# Subtest: generic TimelineSourceAdapter maps rows outside projector transactions
ok 272 - generic TimelineSourceAdapter maps rows outside projector transactions
  ---
  duration_ms: 0.4823
  type: 'test'
  ...
# Subtest: public wrapper APIs reject Proxy/accessor arguments before invoking dependencies
ok 273 - public wrapper APIs reject Proxy/accessor arguments before invoking dependencies
  ---
  duration_ms: 0.6263
  type: 'test'
  ...
# Subtest: unknown Proxy/accessor error objects are sanitized without a second trap
ok 274 - unknown Proxy/accessor error objects are sanitized without a second trap
  ---
  duration_ms: 0.1823
  type: 'test'
  ...
# Subtest: worker reads a bounded batch before invoking the projector and preserves AbortSignal
ok 275 - worker reads a bounded batch before invoking the projector and preserves AbortSignal
  ---
  duration_ms: 0.3304
  type: 'test'
  ...
# Subtest: worker maps unknown adapter failures to the stable storage error
ok 276 - worker maps unknown adapter failures to the stable storage error
  ---
  duration_ms: 0.1305
  type: 'test'
  ...
# Subtest: checkpoint cursor accepts nullable expected values and enforces the shared 512 bound
ok 277 - checkpoint cursor accepts nullable expected values and enforces the shared 512 bound
  ---
  duration_ms: 2.0888
  type: 'test'
  ...
# Subtest: migration runner executes only migration 011 and sanitizes raw failures
ok 278 - migration runner executes only migration 011 and sanitizes raw failures
  ---
  duration_ms: 2.3684
  type: 'test'
  ...
# Subtest: the public error vocabulary contains exactly the eleven frozen stable codes
ok 279 - the public error vocabulary contains exactly the eleven frozen stable codes
  ---
  duration_ms: 0.3971
  type: 'test'
  ...
# Subtest: P1 source adapter reads current sources in one repeatable-read read-only transaction
ok 280 - P1 source adapter reads current sources in one repeatable-read read-only transaction
  ---
  duration_ms: 0.4152
  type: 'test'
  ...
# Subtest: P2-003 migration 012 is exact, reentrant, CLI-scoped, and check-only rolls back
ok 281 - P2-003 migration 012 is exact, reentrant, CLI-scoped, and check-only rolls back
  ---
  duration_ms: 1569.065
  type: 'test'
  ...
# {"migration_process_runs":4,"migration_files_executed":1,"relations_added":2,"prior_catalog_unchanged":true,"precheck_rolled_back":true,"postcheck_rolled_back":true,"temp_database_cleanup":true}
# Subtest: P2-003 migration fails closed for missing column, weak check, wrong unique and index drift
ok 282 - P2-003 migration fails closed for missing column, weak check, wrong unique and index drift
  ---
  duration_ms: 6219.1313
  type: 'test'
  ...
# {"drift_scenarios":5,"temp_database_cleanup":true}
# Subtest: P2-003 append, concurrency, caller transaction, durable replay and authorization are exact
ok 283 - P2-003 append, concurrency, caller transaction, durable replay and authorization are exact
  ---
  duration_ms: 3230.072
  type: 'test'
  ...
# {"same_event_concurrency":12,"different_event_concurrency":12,"pool_maximum":4,"natural_identity_hole":true,"ack_loss_replayed":true,"replay_batch_count":3,"replay_batch_maximum":50,"authorization_variants":4,"retained_event_count":124,"temp_database_cleanup":true}
# Subtest: P2-003 retention check/apply preserves prefix and floor semantics with CLI authorization
ok 284 - P2-003 retention check/apply preserves prefix and floor semantics with CLI authorization
  ---
  duration_ms: 6200.4477
  type: 'test'
  ...
# {"check_zero_write":true,"unauthorized_apply_zero_write":true,"deleted_prefix_count":2,"floor_event_id":"2","expired_after_live_retained":true,"retry_idempotent":true,"replay_gap_http_fallback":true,"cursor_ahead_http_409":true,"authorized_cli_apply":true}
# Subtest: P2-003 retention delete/floor is atomic and every cleanup batch is at most 200
ok 285 - P2-003 retention delete/floor is atomic and every cleanup batch is at most 200
  ---
  duration_ms: 4766.9378
  type: 'test'
  ...
# {"first_batch_deleted":200,"second_batch_deleted":1,"floor_delete_atomic_rollback":true}
# Subtest: P2-003 localhost SSE admits 32 clients, rejects 33, heartbeats, delivers and releases resources
ok 286 - P2-003 localhost SSE admits 32 clients, rejects 33, heartbeats, delivers and releases resources
  ---
  duration_ms: 3427.6618
  type: 'test'
  ...
# {"peak_client_count":32,"event_count":100,"each_client_received":100,"capacity_rejections":1,"maximum_writable_length":16695,"slow_client_disconnects":0,"heap_samples_bytes":[9989104,10785064,11909320,12930808,14019424,35038160,36646640],"first_heap_bytes":9989104,"last_heap_bytes":36646640,"heap_sample_mean_bytes":18759789,"first_to_last_heap_trend_bytes":26657536,"peak_heap_delta_bytes":26657536,"database_query_batches":118,"resource_release_polls":2,"temp_database_cleanup":true}
# Subtest: P2-003 child kill/restart replays Last-Event-ID and missed wakeup recovers from PostgreSQL
ok 287 - P2-003 child kill/restart replays Last-Event-ID and missed wakeup recovers from PostgreSQL
  ---
  duration_ms: 3487.8702
  type: 'test'
  ...
# {"killed_server_exit":{"code":null,"signal":"SIGKILL","killed":true},"killed_server_backend_close_polls":1,"first_event_id":"1","post_restart_event_id":"2","recovery_poll_event_id":"3","app_restart_postgresql_replay":true,"missed_wakeup_recovered":true,"server_a_port":59330,"server_b_port":59336,"temp_database_cleanup":true}
# Subtest: P2-003 real paused slow client is isolated while normal delivery and append continue
ok 288 - P2-003 real paused slow client is isolated while normal delivery and append continue
  ---
  duration_ms: 19890.8255
  type: 'test'
  ...
# {"slow_disconnect_count":1,"normal_client_received":5001,"persisted_event_count":5001,"slow_disconnect_polls":83,"active_slow_write_window_polls":11,"normal_joined_during_slow_drain_polls":1,"normal_client_remained_connected":true,"append_during_slow_write_window":true,"business_transaction_during_slow_write_window":true,"temp_database_cleanup":true}
# Subtest: P2-003 streams 5,000 events in bounded batches and bounded heap without retaining frames
ok 289 - P2-003 streams 5,000 events in bounded batches and bounded heap without retaining frames
  ---
  duration_ms: 4021.049
  type: 'test'
  ...
# {"event_count":5000,"replay_query_batch_count":101,"replay_batch_size":50,"captured_frame_count":0,"maximum_parser_buffer_bytes":370,"maximum_writable_length":16588,"heap_samples_bytes":[9934880,11776280,13404896,12341320,19286768,17297432],"first_to_last_heap_trend_bytes":7362552,"peak_heap_delta_bytes":9351888,"temp_database_cleanup":true}
# Subtest: P2-003 suite leaves no owned database, schema, child, backend, socket, port or timer residual
ok 290 - P2-003 suite leaves no owned database, schema, child, backend, socket, port or timer residual
  ---
  duration_ms: 107.8034
  type: 'test'
  ...
# {"active_test_clients":0,"active_fallback_requests":0,"active_test_http_sockets":0,"active_test_wait_timers":0,"active_cli_children":0,"active_server_children":0,"owned_port_count":6,"closed_port_count":6,"port_close_polls":[1,1,1,1,1,1],"owned_database_count":0,"owned_schema_count":0,"owned_backend_count":0,"active_database_count":0,"emergency_client_cleanup_count":0,"emergency_fallback_cleanup_count":0,"emergency_http_socket_cleanup_count":0}
# Subtest: Realtime Event and Fallback Schemas parse as draft 2020-12 closed contracts
ok 291 - Realtime Event and Fallback Schemas parse as draft 2020-12 closed contracts
  ---
  duration_ms: 7.7662
  type: 'test'
  ...
# Subtest: Realtime vocabularies freeze all event, source, aggregate, scope and visibility values
ok 292 - Realtime vocabularies freeze all event, source, aggregate, scope and visibility values
  ---
  duration_ms: 1.0944
  type: 'test'
  ...
# Subtest: TypeScript declarations mirror every frozen Schema and runtime vocabulary
ok 293 - TypeScript declarations mirror every frozen Schema and runtime vocabulary
  ---
  duration_ms: 1.2324
  type: 'test'
  ...
# Subtest: authorized replay SQL clips scope and visibility before LIMIT and payload materialization
ok 294 - authorized replay SQL clips scope and visibility before LIMIT and payload materialization
  ---
  duration_ms: 1.4752
  type: 'test'
  ...
# Subtest: Fallback Schema freezes the six safe fields, four reasons and two strategies
ok 295 - Fallback Schema freezes the six safe fields, four reasons and two strategies
  ---
  duration_ms: 1.2252
  type: 'test'
  ...
# Subtest: normalization rejects invalid event, source, aggregate and scope vocabularies
ok 296 - normalization rejects invalid event, source, aggregate and scope vocabularies
  ---
  duration_ms: 1.1922
  type: 'test'
  ...
# Subtest: SESSION and THREAD require a UUID scope while SYSTEM requires null
ok 297 - SESSION and THREAD require a UUID scope while SYSTEM requires null
  ---
  duration_ms: 1.1795
  type: 'test'
  ...
# Subtest: normalization rejects invalid timestamps and requires expires_at after occurred_at
ok 298 - normalization rejects invalid timestamps and requires expires_at after occurred_at
  ---
  duration_ms: 0.5511
  type: 'test'
  ...
# Subtest: aggregate versions use nullable canonical PostgreSQL BIGINT strings
ok 299 - aggregate versions use nullable canonical PostgreSQL BIGINT strings
  ---
  duration_ms: 0.5528
  type: 'test'
  ...
# Subtest: Last-Event-ID accepts zero and the BIGINT maximum without Number conversion
ok 300 - Last-Event-ID accepts zero and the BIGINT maximum without Number conversion
  ---
  duration_ms: 0.2277
  type: 'test'
  ...
# Subtest: Last-Event-ID rejects negative, decimal, scientific, signed, spaced and overflow forms
ok 301 - Last-Event-ID rejects negative, decimal, scientific, signed, spaced and overflow forms
  ---
  duration_ms: 0.2031
  type: 'test'
  ...
# Subtest: payload accepts only bounded plain finite JSON data
ok 302 - payload accepts only bounded plain finite JSON data
  ---
  duration_ms: 0.5117
  type: 'test'
  ...
# Subtest: payload enforces depth, node, object, array, string and canonical-byte limits
ok 303 - payload enforces depth, node, object, array, string and canonical-byte limits
  ---
  duration_ms: 3.0706
  type: 'test'
  ...
# Subtest: payload rejects Proxy and accessor paths without invoking hostile code
ok 304 - payload rejects Proxy and accessor paths without invoking hostile code
  ---
  duration_ms: 0.2484
  type: 'test'
  ...
# Subtest: payload rejects toJSON, symbols and prototype-pollution keys
ok 305 - payload rejects toJSON, symbols and prototype-pollution keys
  ---
  duration_ms: 1.9335
  type: 'test'
  ...
# Subtest: payload rejects message content and sensitive identifier property names
ok 306 - payload rejects message content and sensitive identifier property names
  ---
  duration_ms: 0.8016
  type: 'test'
  ...
# Subtest: event key is stable, opaque and changes with its frozen identity tuple
ok 307 - event key is stable, opaque and changes with its frozen identity tuple
  ---
  duration_ms: 1.6277
  type: 'test'
  ...
# Subtest: event hash is canonical across payload key order and changes on semantic mutation
ok 308 - event hash is canonical across payload key order and changes on semantic mutation
  ---
  duration_ms: 0.7324
  type: 'test'
  ...
# Subtest: event hash excludes expires_at, event_id and created_at
ok 309 - event hash excludes expires_at, event_id and created_at
  ---
  duration_ms: 0.531
  type: 'test'
  ...
# Subtest: Conversation Item mapper exposes only the seven safe projection fields plus occurred_at
ok 310 - Conversation Item mapper exposes only the seven safe projection fields plus occurred_at
  ---
  duration_ms: 0.4758
  type: 'test'
  ...
# Subtest: Session fixture mapper freezes created and updated event variants with safe payloads
ok 311 - Session fixture mapper freezes created and updated event variants with safe payloads
  ---
  duration_ms: 0.7935
  type: 'test'
  ...
# Subtest: Timeline rebuilt fixture mapper exposes only count and canonical hash metadata
ok 312 - Timeline rebuilt fixture mapper exposes only count and canonical hash metadata
  ---
  duration_ms: 0.3354
  type: 'test'
  ...
# Subtest: public event view contains exactly nine safe fields and no publisher, source, hash or scope IDs
ok 313 - public event view contains exactly nine safe fields and no publisher, source, hash or scope IDs
  ---
  duration_ms: 0.3711
  type: 'test'
  ...
# Subtest: SSE event encoding uses id/type/single-line JSON and supports every frozen event type
ok 314 - SSE event encoding uses id/type/single-line JSON and supports every frozen event type
  ---
  duration_ms: 2.26
  type: 'test'
  ...
# Subtest: SSE encoding rejects CR/LF event injection and never emits raw payload newlines
ok 315 - SSE encoding rejects CR/LF event injection and never emits raw payload newlines
  ---
  duration_ms: 0.2982
  type: 'test'
  ...
# Subtest: heartbeat is a comment frame and consumes no event id
ok 316 - heartbeat is a comment frame and consumes no event id
  ---
  duration_ms: 0.1193
  type: 'test'
  ...
# Subtest: authorization defaults to deny-all and rejects absent or malformed contexts
ok 317 - authorization defaults to deny-all and rejects absent or malformed contexts
  ---
  duration_ms: 0.4182
  type: 'test'
  ...
# Subtest: authorization normalizes bounded UUID sets without wildcard access
ok 318 - authorization normalizes bounded UUID sets without wildcard access
  ---
  duration_ms: 0.1798
  type: 'test'
  ...
# Subtest: restricted-admin defense-in-depth closes a malicious replay without delivering it
ok 319 - restricted-admin defense-in-depth closes a malicious replay without delivering it
  ---
  duration_ms: 2.1233
  type: 'test'
  ...
# Subtest: controlled principal disconnect closes only the selected SSE client
ok 320 - controlled principal disconnect closes only the selected SSE client
  ---
  duration_ms: 4.4779
  type: 'test'
  ...
# Subtest: disabled handler returns safe polling fallback with zero database calls and no timers
ok 321 - disabled handler returns safe polling fallback with zero database calls and no timers
  ---
  duration_ms: 0.8169
  type: 'test'
  ...
# Subtest: disabled event store fails before acquiring a database connection
ok 322 - disabled event store fails before acquiring a database connection
  ---
  duration_ms: 0.5017
  type: 'test'
  ...
# Subtest: disconnect during authentication never acquires replay, Hub, or timer resources
ok 323 - disconnect during authentication never acquires replay, Hub, or timer resources
  ---
  duration_ms: 0.3022
  type: 'test'
  ...
# Subtest: disconnect during authorization never acquires replay, Hub, or timer resources
ok 324 - disconnect during authorization never acquires replay, Hub, or timer resources
  ---
  duration_ms: 0.2834
  type: 'test'
  ...
# Subtest: Wakeup Hub admits 32 clients, rejects the 33rd, and releases capacity
ok 325 - Wakeup Hub admits 32 clients, rejects the 33rd, and releases capacity
  ---
  duration_ms: 0.1825
  type: 'test'
  ...
# Subtest: replay batch configuration accepts 200 and rejects 201
ok 326 - replay batch configuration accepts 200 and rejects 201
  ---
  duration_ms: 0.1509
  type: 'test'
  ...
# Subtest: list replay rejects limits above 200 before querying storage
ok 327 - list replay rejects limits above 200 before querying storage
  ---
  duration_ms: 0.336
  type: 'test'
  ...
# Subtest: backpressure waits for drain and releases only the affected stream
ok 328 - backpressure waits for drain and releases only the affected stream
  ---
  duration_ms: 1.0393
  type: 'test'
  ...
# Subtest: drain timeout disconnects only the slow client with bounded metrics
ok 329 - drain timeout disconnects only the slow client with bounded metrics
  ---
  duration_ms: 1.7694
  type: 'test'
  ...
# Subtest: retention gap after SSE headers closes the stream and reconnect returns 410 fallback
ok 330 - retention gap after SSE headers closes the stream and reconnect returns 410 fallback
  ---
  duration_ms: 0.8919
  type: 'test'
  ...
# Subtest: polling fallback normalizes canonical IDs and rejects unsafe forms
ok 331 - polling fallback normalizes canonical IDs and rejects unsafe forms
  ---
  duration_ms: 0.1123
  type: 'test'
  ...
# Subtest: public HTTP errors expose only stable codes and never raw authentication failures
ok 332 - public HTTP errors expose only stable codes and never raw authentication failures
  ---
  duration_ms: 0.2706
  type: 'test'
  ...
# Subtest: migration 020 is exact, reentrant, CLI-scoped, check-only, and preserves 005/010/011/012 catalogs
ok 333 - migration 020 is exact, reentrant, CLI-scoped, check-only, and preserves 005/010/011/012 catalogs
  ---
  duration_ms: 1231.2151
  type: 'test'
  ...
# {"first_apply":true,"repeated_apply":true,"check_rollback":true,"frozen_catalog_relations":10}
# Subtest: migration 020 fails closed for missing columns, weakened checks, wrong unique, index method and predicate
ok 334 - migration 020 fails closed for missing columns, weakened checks, wrong unique, index method and predicate
  ---
  duration_ms: 4840.6995
  type: 'test'
  ...
# {"drift_mutations":["missingcol","weakcheck","wrongunique","indexmethod","indexpred"],"stable_error":"P2_004_SCHEMA_DRIFT_REMEDIATION_REQUIRED"}
# Subtest: Communication service commits atomically, isolates idempotency scopes, and never mutates Session
ok 335 - Communication service commits atomically, isolates idempotency scopes, and never mutates Session
  ---
  duration_ms: 3748.0689
  type: 'test'
  ...
# {"browser_double_click_concurrency":12,"committed_fact_sets":1,"human_ai_same_body_isolated":true,"internal_note_outbox_count":0}
# Subtest: Delivery Worker enforces claim CAS, ACK, retry, dead letter, timeout unknown and lease recovery
ok 336 - Delivery Worker enforces claim CAS, ACK, retry, dead letter, timeout unknown and lease recovery
  ---
  duration_ms: 3177.803
  type: 'test'
  ...
# {"concurrent_workers":12,"single_claim":true,"gateway_reconnect":true,"timeout_unknown":true,"leased_recovered":true,"sending_not_resent":true}
# Subtest: multi-target delivery is isolated, target rate limit is durable, and reconciliation is explicit
ok 337 - multi-target delivery is isolated, target rate limit is durable, and reconciliation is explicit
  ---
  duration_ms: 2936.736
  type: 'test'
  ...
# {"multi_target_count":2,"isolated_outcomes":["SENT","DEAD_LETTER"],"target_rate_limit":true,"reconciliation_resolutions":["CONFIRMED_SENT","CONFIRMED_NOT_SENT_REQUEUE","CANCEL"]}
# Subtest: real Worker kill/restart reclaims LEASED but never blindly resends SENDING
ok 338 - real Worker kill/restart reclaims LEASED but never blindly resends SENDING
  ---
  duration_ms: 2844.9978
  type: 'test'
  ...
# {"leased_child_exit":{"code":null,"signal":"SIGKILL"},"leased_restart_sent":true,"sending_child_exit":{"code":null,"signal":"SIGKILL"},"sending_restart_reconciled":true,"blind_resend_count":0}
# Subtest: P1 compatibility is read-only until it delegates to the existing P1 worker
ok 339 - P1 compatibility is read-only until it delegates to the existing P1 worker
  ---
  duration_ms: 2547.8979
  type: 'test'
  ...
# {"p1_read_snapshot_unchanged":true,"p1_delivery_delegated":true,"communication_rows_created":0}
# Subtest: 500 deliveries remain bounded at batch 20 and interruption resumes without resource growth
ok 340 - 500 deliveries remain bounded at batch 20 and interruption resumes without resource growth
  ---
  duration_ms: 10613.2328
  type: 'test'
  ...
# {"deliveries":500,"batch_size":20,"interrupted_after":100,"resumed_to":500,"heap_samples":[15510216,15879328,18741840,14744424,17543520,14974864,19251304,23316624,24169264,27069656],"heap_growth_bytes":11559440,"soak_claimed":false}
# Subtest: P2-004 integration leaves no owned database or backend residual
ok 341 - P2-004 integration leaves no owned database or backend residual
  ---
  duration_ms: 59.8302
  type: 'test'
  ...
# {"database_count":0,"backend_count":0,"active_database_count":0,"worker_child_count":0,"worker_count":0,"timer_count":0,"child_process_count":0}
# Subtest: P2-004 JSON Schemas use draft 2020-12 and close object shapes
ok 342 - P2-004 JSON Schemas use draft 2020-12 and close object shapes
  ---
  duration_ms: 9.8207
  type: 'test'
  ...
# Subtest: Reply Command schema and future OpenAPI bind session and idempotency without exposing a target
ok 343 - Reply Command schema and future OpenAPI bind session and idempotency without exposing a target
  ---
  duration_ms: 3.5233
  type: 'test'
  ...
# Subtest: frozen Communication vocabularies are exact
ok 344 - frozen Communication vocabularies are exact
  ---
  duration_ms: 0.7683
  type: 'test'
  ...
# Subtest: normalization freezes Agent, AI, System, internal note and media contracts
ok 345 - normalization freezes Agent, AI, System, internal note and media contracts
  ---
  duration_ms: 1.4435
  type: 'test'
  ...
# Subtest: invalid UUID, row version, privacy, retention, message type, and browser authority are rejected
ok 346 - invalid UUID, row version, privacy, retention, message type, and browser authority are rejected
  ---
  duration_ms: 0.6374
  type: 'test'
  ...
# Subtest: plain JSON fence rejects Proxy, accessor, symbol, toJSON, prototype and pollution keys
ok 347 - plain JSON fence rejects Proxy, accessor, symbol, toJSON, prototype and pollution keys
  ---
  duration_ms: 0.2695
  type: 'test'
  ...
# Subtest: plain JSON fence enforces depth, node, string and array bounds
ok 348 - plain JSON fence enforces depth, node, string and array bounds
  ---
  duration_ms: 0.1728
  type: 'test'
  ...
# Subtest: content and command hashes are stable, key-order independent and cover row version
ok 349 - content and command hashes are stable, key-order independent and cover row version
  ---
  duration_ms: 0.8573
  type: 'test'
  ...
# Subtest: destination resolution uses authoritative Thread fields for single and group
ok 350 - destination resolution uses authoritative Thread fields for single and group
  ---
  duration_ms: 0.2422
  type: 'test'
  ...
# Subtest: disabled service performs zero database and authorization work
ok 351 - disabled service performs zero database and authorization work
  ---
  duration_ms: 0.347
  type: 'test'
  ...
# Subtest: disabled Worker performs zero database and Sender calls
ok 352 - disabled Worker performs zero database and Sender calls
  ---
  duration_ms: 0.2911
  type: 'test'
  ...
# Subtest: Sender Port validates ACK, rejected, unknown and rejects malformed results
ok 353 - Sender Port validates ACK, rejected, unknown and rejects malformed results
  ---
  duration_ms: 0.3059
  type: 'test'
  ...
# Subtest: Mock Sender records only safe call metadata
ok 354 - Mock Sender records only safe call metadata
  ---
  duration_ms: 0.2191
  type: 'test'
  ...
# Subtest: message projection maps Agent, AI, Internal and System without changing ownership
ok 355 - message projection maps Agent, AI, Internal and System without changing ownership
  ---
  duration_ms: 0.2912
  type: 'test'
  ...
# Subtest: delivery timeline and realtime mappers expose only safe delivery fields
ok 356 - delivery timeline and realtime mappers expose only safe delivery fields
  ---
  duration_ms: 0.1993
  type: 'test'
  ...
# Subtest: legacy notification mapping is safe and exact
ok 357 - legacy notification mapping is safe and exact
  ---
  duration_ms: 0.1026
  type: 'test'
  ...
# Subtest: public stable error inventory excludes raw provider and storage details
ok 358 - public stable error inventory excludes raw provider and storage details
  ---
  duration_ms: 0.0958
  type: 'test'
  ...
# Subtest: migration 021 is scoped, reentrant, check-rolls-back, and drift fails closed
ok 359 - migration 021 is scoped, reentrant, check-rolls-back, and drift fails closed
  ---
  duration_ms: 4758.2606
  type: 'test'
  ...
# {"first_apply":true,"repeated_apply":true,"check_rollback":true,"new_tables":4}
# Subtest: takeover is serialized/idempotent; handoff request-accept-release and request-cancel are audited atomically
ok 360 - takeover is serialized/idempotent; handoff request-accept-release and request-cancel are audited atomically
  ---
  duration_ms: 2354.4075
  type: 'test'
  ...
# {"concurrent_winners":1,"idempotent_parallel":12,"handoff":["REQUESTED","ACCEPTED","RELEASED"],"cancel":"CANCELLED"}
# Subtest: admin force transfer works; non-admin, inactive target, wrong-team handler, ended and stale commands fail closed
ok 361 - admin force transfer works; non-admin, inactive target, wrong-team handler, ended and stale commands fail closed
  ---
  duration_ms: 2459.4323
  type: 'test'
  ...
# {"admin_force_transfer":true,"handler_force":false,"inactive":false,"wrong_team":false}
# Subtest: generation race blocks stale AI before Communication and realtime failure rolls back control facts
ok 362 - generation race blocks stale AI before Communication and realtime failure rolls back control facts
  ---
  duration_ms: 2382.5408
  type: 'test'
  ...
# {"generation_start":1,"stale":true,"append_communication_calls":0,"message_delta":0,"outbox_delta":0,"delivery_delta":0,"realtime_failure_rollback":true}
# Subtest: 32 principals keep independent monotonic cursors; visibility COUNT is correct and Session versions do not move
ok 363 - 32 principals keep independent monotonic cursors; visibility COUNT is correct and Session versions do not move
  ---
  duration_ms: 3814.6883
  type: 'test'
  ...
# {"principals":32,"monotonic":true,"session_version_unchanged":true,"workbench_unread":1,"restricted_unread":2}
# Subtest: 2C4G bounded capacity covers 500 assignment/handoff facts and 2,000 cursor updates without residual resources
ok 364 - 2C4G bounded capacity covers 500 assignment/handoff facts and 2,000 cursor updates without residual resources
  ---
  duration_ms: 4365.2157
  type: 'test'
  ...
# {"assignments":500,"handoffs":500,"cursor_updates":2000,"max_list_limit":200,"heap_samples":5,"heap_monotonic_unbounded":false,"pool_max":4,"soak_24h":false}
# Subtest: all P2-005 JSON Schemas parse and freeze strict objects
ok 365 - all P2-005 JSON Schemas parse and freeze strict objects
  ---
  duration_ms: 4.7398
  type: 'test'
  ...
# Subtest: status, command, event, invalidation, and stable error vocabularies are frozen
ok 366 - status, command, event, invalidation, and stable error vocabularies are frozen
  ---
  duration_ms: 0.7405
  type: 'test'
  ...
# Subtest: normalization is bounded and command hash is stable across key order
ok 367 - normalization is bounded and command hash is stable across key order
  ---
  duration_ms: 1.9813
  type: 'test'
  ...
# Subtest: invalid identifiers, versions, sequences, reason codes, target modes, and extra authority fail closed
ok 368 - invalid identifiers, versions, sequences, reason codes, target modes, and extra authority fail closed
  ---
  duration_ms: 0.8145
  type: 'test'
  ...
# Subtest: non-plain JSON, Proxy, accessor, toJSON, symbol, cycle, and prototype pollution are rejected
ok 369 - non-plain JSON, Proxy, accessor, toJSON, symbol, cycle, and prototype pollution are rejected
  ---
  duration_ms: 0.3296
  type: 'test'
  ...
# Subtest: default authorization rejects every operation
ok 370 - default authorization rejects every operation
  ---
  duration_ms: 0.1747
  type: 'test'
  ...
# Subtest: disabled service returns before every database call and hides raw failures
ok 371 - disabled service returns before every database call and hides raw failures
  ---
  duration_ms: 0.3921
  type: 'test'
  ...
# Subtest: generation fence distinguishes current, stale, and HUMAN-forbidden without process state
ok 372 - generation fence distinguishes current, stale, and HUMAN-forbidden without process state
  ---
  duration_ms: 0.7567
  type: 'test'
  ...
# Subtest: assigned Communication authorizer denies AI flags, inactive/unassigned agents, and accepts assigned active actor
ok 373 - assigned Communication authorizer denies AI flags, inactive/unassigned agents, and accepts assigned active actor
  ---
  duration_ms: 0.3791
  type: 'test'
  ...
# Subtest: Realtime mappers expose versions/status only and no identity or content
ok 374 - Realtime mappers expose versions/status only and no identity or content
  ---
  duration_ms: 0.6749
  type: 'test'
  ...
# Subtest: Timeline mapper uses internal HANDOFF_EVENT and requires explicit privacy/retention
ok 375 - Timeline mapper uses internal HANDOFF_EVENT and requires explicit privacy/retention
  ---
  duration_ms: 0.2859
  type: 'test'
  ...
# Subtest: system browser desktop workbench flow is responsive, refresh-safe and XSS-safe
ok 376 - system browser desktop workbench flow is responsive, refresh-safe and XSS-safe
  ---
  duration_ms: 1572.1466
  type: 'test'
  ...
# {"browser":"C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe","viewport":{"label":"desktop","width":1440,"height":900},"interactions":{"select":1,"takeover":1,"transfer":1,"reply":1,"internal_note":1,"sse_update":true,"polling_fallback":true,"filter":true,"refresh_restore":true},"keyboard_focus_visible":true,"security_headers":true,"xss_executed":false,"horizontal_overflow":false}
# Subtest: system browser mobile workbench flow is responsive, refresh-safe and XSS-safe
ok 377 - system browser mobile workbench flow is responsive, refresh-safe and XSS-safe
  ---
  duration_ms: 2422.8816
  type: 'test'
  ...
# {"browser":"C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe","viewport":{"label":"mobile","width":390,"height":844},"interactions":{"select":1,"takeover":1,"transfer":1,"reply":1,"internal_note":1,"sse_update":true,"polling_fallback":true,"filter":true,"refresh_restore":true},"keyboard_focus_visible":true,"security_headers":true,"xss_executed":false,"horizontal_overflow":false}
# Subtest: system browser renders the same Workbench LocalDateTime under UTC, Tokyo, and New York
ok 378 - system browser renders the same Workbench LocalDateTime under UTC, Tokyo, and New York
  ---
  duration_ms: 2022.8
  type: 'test'
  ...
# Subtest: P2-006 applies no DDL and leaves no isolated PostgreSQL resources
ok 379 - P2-006 applies no DDL and leaves no isolated PostgreSQL resources
  ---
  duration_ms: 5134.4733
  type: 'test'
  ...
# {"migration_022":true,"catalog_unchanged":true,"feature_enabled_only_in_test":true}
# Subtest: admin/dispatcher/handler authorization is enforced in SQL data access and timeline visibility
ok 380 - admin/dispatcher/handler authorization is enforced in SQL data access and timeline visibility
  ---
  duration_ms: 4291.2994
  type: 'test'
  ...
# {"admin_sessions":2,"dispatcher_sessions":2,"assigned_handler_sessions":1,"outsider_sessions":0,"reporter_forbidden":true,"inactive_forbidden":true,"restricted_hidden_from_handler":true}
# Subtest: 500 conversations and 10,000 items have duplicate-free keyset pages and bounded read latency
ok 381 - 500 conversations and 10,000 items have duplicate-free keyset pages and bounded read latency
  ---
  duration_ms: 57798.239
  type: 'test'
  ...
# {"sessions":500,"items":10000,"assignments":500,"tickets":500,"deliveries":500,"list_requests":1000,"detail_requests":1000,"keyset_unique":true,"p95":{"list_ms":76.896,"detail_ms":11.862}}
# Subtest: workbench facade commits human reply, internal note, takeover and idempotent replay through P2-004/P2-005 ports
ok 382 - workbench facade commits human reply, internal note, takeover and idempotent replay through P2-004/P2-005 ports
  ---
  duration_ms: 2155.0152
  type: 'test'
  ...
# {"takeover":true,"replayed":true,"transfer":true,"release":true,"handoff_request_cancel":true,"read_cursor":1,"external_messages":1,"internal_notes":1,"external_outbox":1,"internal_outbox":0,"pending_retry":true,"dead_letter_requeue":true,"reconciliation_required_blocks_retry":true,"admin_reconciliation":true}
# Subtest: 200 real HTTP reply commits and 12-way duplicate submit remain bounded without sender calls or socket residue
ok 383 - 200 real HTTP reply commits and 12-way duplicate submit remain bounded without sender calls or socket residue
  ---
  duration_ms: 5857.6771
  type: 'test'
  ...
# {"reply_http":{"samples":200,"p50_ms":15.801,"p95_ms":26.666,"p99_ms":31.717,"max_ms":121.619},"duplicate_submit_parallel":12,"messages":201,"outboxes":201,"deliveries":201,"sender_calls":0,"heap_samples_bytes":[23056344,20475872,22389216,29701208,26458680,23888216,31026432,27786288],"pool_max":4}
# Subtest: P2-003 SSE route delivers committed messages through authorized refetch within 2 seconds and releases timers
ok 384 - P2-003 SSE route delivers committed messages through authorized refetch within 2 seconds and releases timers
  ---
  duration_ms: 3958.5586
  type: 'test'
  ...
# {"new_message_commit_sse_refetch":{"samples":100,"p50_ms":14.834,"p95_ms":28.912,"p99_ms":36.618,"max_ms":80.616},"authorized_events":100,"unauthorized_events":0}
# Subtest: workbench schemas parse and OpenAPI 3.1 exposes every implemented route
ok 385 - workbench schemas parse and OpenAPI 3.1 exposes every implemented route
  ---
  duration_ms: 5.0385
  type: 'test'
  ...
# Subtest: opaque cursor round-trips normalized timestamp and session id
ok 386 - opaque cursor round-trips normalized timestamp and session id
  ---
  duration_ms: 1.1706
  type: 'test'
  ...
# Subtest: opaque cursor rejects malformed, oversized, and structurally extended values
ok 387 - opaque cursor rejects malformed, oversized, and structurally extended values
  ---
  duration_ms: 0.6096
  type: 'test'
  ...
# Subtest: disabled query service performs zero database and authorization calls
ok 388 - disabled query service performs zero database and authorization calls
  ---
  duration_ms: 0.461
  type: 'test'
  ...
# Subtest: list SQL applies authorization in WHERE before keyset ORDER BY and LIMIT
ok 389 - list SQL applies authorization in WHERE before keyset ORDER BY and LIMIT
  ---
  duration_ms: 0.5148
  type: 'test'
  ...
# Subtest: query page limit and state filters fail closed
ok 390 - query page limit and state filters fail closed
  ---
  duration_ms: 0.4188
  type: 'test'
  ...
# Subtest: HTTP server construction fails when authentication port is absent
ok 391 - HTTP server construction fails when authentication port is absent
  ---
  duration_ms: 0.5899
  type: 'test'
  ...
# Subtest: HTTP API rejects unauthenticated and expired contexts without fallback
ok 392 - HTTP API rejects unauthenticated and expired contexts without fallback
  ---
  duration_ms: 74.1856
  type: 'test'
  ...
# Subtest: Cookie writes require exact origin, same-site context, constant-time CSRF and matching idempotency
ok 393 - Cookie writes require exact origin, same-site context, constant-time CSRF and matching idempotency
  ---
  duration_ms: 41.6025
  type: 'test'
  ...
# Subtest: Bearer mode requires Authorization header and tokens in query are forbidden
ok 394 - Bearer mode requires Authorization header and tokens in query are forbidden
  ---
  duration_ms: 7.1484
  type: 'test'
  ...
# Subtest: HTTP security headers contain strict CSP without inline or eval and no wildcard CORS
ok 395 - HTTP security headers contain strict CSP without inline or eval and no wildcard CORS
  ---
  duration_ms: 5.0211
  type: 'test'
  ...
# Subtest: non-JSON and oversized write bodies are rejected with stable public errors
ok 396 - non-JSON and oversized write bodies are rejected with stable public errors
  ---
  duration_ms: 7.9624
  type: 'test'
  ...
# Subtest: command facade delegates frozen control and communication ports without sender access
ok 397 - command facade delegates frozen control and communication ports without sender access
  ---
  duration_ms: 0.8443
  type: 'test'
  ...
# Subtest: UI source renders untrusted content through text nodes only
ok 398 - UI source renders untrusted content through text nodes only
  ---
  duration_ms: 0.4328
  type: 'test'
  ...
# Subtest: UI reducer bounds conversations and timeline arrays
ok 399 - UI reducer bounds conversations and timeline arrays
  ---
  duration_ms: 0.4534
  type: 'test'
  ...
# Subtest: refresh storage persists only selected id and filter
ok 400 - refresh storage persists only selected id and filter
  ---
  duration_ms: 0.1989
  type: 'test'
  ...
# Subtest: P2-006 creates no migration and static preview check succeeds
ok 401 - P2-006 creates no migration and static preview check succeeds
  ---
  duration_ms: 102.4739
  type: 'test'
  ...
# Subtest: P2-012 real command capacity 500 candidates, 200 incidents, 2000 reports, 1000 subscriptions, 5000 events, 500 bindings and 32 SSE
not ok 402 - P2-012 real command capacity 500 candidates, 200 incidents, 2000 reports, 1000 subscriptions, 5000 events, 500 bindings and 32 SSE
  ---
  duration_ms: 56529.3321
  type: 'test'
  location: 'D:\\Projects\\Fault-Reporting-WeCom-Assistant\\tests\\p2-012-capacity.integration.test.mjs:18:1'
  failureType: 'testCodeFailure'
  error: |-
    The expression evaluated to a falsy value:

      assert.ok(peak>last||peak-samples[0]<16*1024*1024)

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: '=='
  stack: |-
    run (file:///D:/Projects/Fault-Reporting-WeCom-Assistant/tests/p2-012-capacity.integration.test.mjs:59:117)
    process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    async withP2015IsolatedDatabase (file:///D:/Projects/Fault-Reporting-WeCom-Assistant/tests/helpers/p2-015-postgres-harness.mjs:33:14)
    async TestContext.<anonymous> (file:///D:/Projects/Fault-Reporting-WeCom-Assistant/tests/p2-012-capacity.integration.test.mjs:20:3)
    async Test.run (node:internal/test_runner/test:1332:7)
    async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3)
  ...
# Subtest: P2-012 real TypeScript consumers accept nullable cursors and optional owner teams
ok 403 - P2-012 real TypeScript consumers accept nullable cursors and optional owner teams
  ---
  duration_ms: 352.8482
  type: 'test'
  ...
# Subtest: P2-012 parsed OpenAPI incident state filters match all runtime states and queue aliases
ok 404 - P2-012 parsed OpenAPI incident state filters match all runtime states and queue aliases
  ---
  duration_ms: 401.7305
  type: 'test'
  ...
# Subtest: P2-012 closes input shapes, rejects hostile values and preserves deterministic command hashes
ok 405 - P2-012 closes input shapes, rejects hostile values and preserves deterministic command hashes
  ---
  duration_ms: 3.4069
  type: 'test'
  ...
# Subtest: P2-012 stable HTTP matrix is exhaustive, deterministic and rejects hostile results without executing code
ok 406 - P2-012 stable HTTP matrix is exhaustive, deterministic and rejects hostile results without executing code
  ---
  duration_ms: 27.6902
  type: 'test'
  ...
# Subtest: P2-012 maintenance expires a bounded ordered batch through private SYSTEM commands without notifications
ok 407 - P2-012 maintenance expires a bounded ordered batch through private SYSTEM commands without notifications
  ---
  duration_ms: 2682.7331
  type: 'test'
  ...
# Subtest: P2-012 maintenance replays concurrent scans, handles human/time races and surfaces a still-due failure
ok 408 - P2-012 maintenance replays concurrent scans, handles human/time races and surfaces a still-due failure
  ---
  duration_ms: 5452.2115
  type: 'test'
  ...
# Subtest: P2-012 maintenance scans after import and expires an imported due candidate in the same iteration
ok 409 - P2-012 maintenance scans after import and expires an imported due candidate in the same iteration
  ---
  duration_ms: 1867.9657
  type: 'test'
  ...
# Subtest: P2-012 real database human confirmation, idempotency, recovery isolation and notification facts
ok 410 - P2-012 real database human confirmation, idempotency, recovery isolation and notification facts
  ---
  duration_ms: 2648.5354
  type: 'test'
  ...
# Subtest: dynamic live configuration requires an approved group but no preconfigured Reporter userid hash
ok 411 - dynamic live configuration requires an approved group but no preconfigured Reporter userid hash
  ---
  duration_ms: 2.3001
  type: 'test'
  ...
# Subtest: dynamic Sender rechecks the persisted approved-group Reporter before each PERSON provider call
ok 412 - dynamic Sender rechecks the persisted approved-group Reporter before each PERSON provider call
  ---
  duration_ms: 1.6003
  type: 'test'
  ...
# Subtest: approved test group discovers an unconfigured Reporter before their direct flow and outbound notice
ok 413 - approved test group discovers an unconfigured Reporter before their direct flow and outbound notice
  ---
  duration_ms: 0.6234
  type: 'test'
  ...
# Subtest: P2-012 migration 032 applies atomically, detects catalog drift and preserves seven-table scope
ok 414 - P2-012 migration 032 applies atomically, detects catalog drift and preserves seven-table scope
  ---
  duration_ms: 2243.7875
  type: 'test'
  ...
# Subtest: P2-012 fresh current baseline reaches 032 and repeated status/check/apply preserve the catalog
ok 415 - P2-012 fresh current baseline reaches 032 and repeated status/check/apply preserve the catalog
  ---
  duration_ms: 3031.8728
  type: 'test'
  ...
# Subtest: P2-012 network-off three-role assembly serves Incident and closes children, sockets and pools
ok 416 - P2-012 network-off three-role assembly serves Incident and closes children, sockets and pools
  ---
  duration_ms: 4568.1208
  type: 'test'
  ...
# {"network_enabled":false,"restarted":false,"metrics":{"process_count":3,"gateway_authenticated":0,"gateway_reconnect_total":0,"app_rss_bytes":85704704,"app_heap_used_bytes":20594472,"app_heap_total_bytes":33865728,"app_external_bytes":4567169,"app_cpu_percent":12.433,"app_event_loop_delay_p95_ms":31.686655,"app_active_resources":8,"app_active_timers":2,"app_active_sockets":6,"app_active_file_handles":0,"app_active_handles":6,"app_uptime_seconds":1.594,"app_pool_total":2,"app_pool_idle":2,"app_pool_waiting":0,"app_pool_max":4,"worker_rss_bytes":92499968,"worker_heap_used_bytes":19117952,"worker_heap_total_bytes":33341440,"worker_external_bytes":4477341,"worker_cpu_percent":13.792,"worker_event_loop_delay_p95_ms":32.145407,"worker_active_resources":4,"worker_active_timers":2,"worker_active_sockets":2,"worker_active_file_handles":0,"worker_active_handles":2,"worker_uptime_seconds":1.589,"worker_pool_total":1,"worker_pool_idle":1,"worker_pool_waiting":0,"worker_pool_max":2,"gateway_rss_bytes":79048704,"gateway_heap_used_bytes":12720936,"gateway_heap_total_bytes":31604736,"gateway_external_bytes":4206782,"gateway_cpu_percent":1.088,"gateway_event_loop_delay_p95_ms":32.030719,"gateway_active_resources":2,"gateway_active_timers":1,"gateway_active_sockets":1,"gateway_active_file_handles":0,"gateway_active_handles":1,"gateway_uptime_seconds":1.602,"gateway_pool_total":0,"gateway_pool_idle":0,"gateway_pool_waiting":0,"gateway_pool_max":1,"total_rss_bytes":257253376,"total_heap_used_bytes":52433360,"total_cpu_percent":27.313,"sse_clients":0,"projection_backlog":0,"projection_failures":0,"communication_pending":1,"dead_letter":0,"reconciliation_required":0,"postgres_active_connections":1,"postgres_idle_connections":4,"postgres_other_connections":0,"postgres_max_connections":100,"postgres_connection_utilization_percent":5}}
# {"network_enabled":false,"restarted":true,"metrics":{"process_count":3,"gateway_authenticated":0,"gateway_reconnect_total":0,"app_rss_bytes":81928192,"app_heap_used_bytes":15052176,"app_heap_total_bytes":32555008,"app_external_bytes":4334348,"app_cpu_percent":37.398,"app_event_loop_delay_p95_ms":31.522815,"app_active_resources":6,"app_active_timers":1,"app_active_sockets":5,"app_active_file_handles":0,"app_active_handles":5,"app_uptime_seconds":0.474,"app_pool_total":1,"app_pool_idle":1,"app_pool_waiting":0,"app_pool_max":4,"worker_rss_bytes":89624576,"worker_heap_used_bytes":13333696,"worker_heap_total_bytes":31866880,"worker_external_bytes":4206782,"worker_cpu_percent":19.141,"worker_event_loop_delay_p95_ms":31.997951,"worker_active_resources":2,"worker_active_timers":1,"worker_active_sockets":1,"worker_active_file_handles":0,"worker_active_handles":1,"worker_uptime_seconds":0.47,"worker_pool_total":0,"worker_pool_idle":0,"worker_pool_waiting":0,"worker_pool_max":2,"gateway_rss_bytes":79200256,"gateway_heap_used_bytes":12690840,"gateway_heap_total_bytes":31604736,"gateway_external_bytes":4206782,"gateway_cpu_percent":33.186,"gateway_event_loop_delay_p95_ms":31.784959,"gateway_active_resources":2,"gateway_active_timers":1,"gateway_active_sockets":1,"gateway_active_file_handles":0,"gateway_active_handles":1,"gateway_uptime_seconds":0.484,"gateway_pool_total":0,"gateway_pool_idle":0,"gateway_pool_waiting":0,"gateway_pool_max":1,"total_rss_bytes":250753024,"total_heap_used_bytes":41076712,"total_cpu_percent":89.725,"sse_clients":0,"projection_backlog":0,"projection_failures":0,"communication_pending":1,"dead_letter":0,"reconciliation_required":0,"postgres_active_connections":2,"postgres_idle_connections":2,"postgres_other_connections":0,"postgres_max_connections":100,"postgres_connection_utilization_percent":4}}
# Subtest: P2-012 Reporter HTTP preserves bound grants, refresh ETag, safe milestones and unlink visibility
ok 417 - P2-012 Reporter HTTP preserves bound grants, refresh ETag, safe milestones and unlink visibility
  ---
  duration_ms: 2525.0581
  type: 'test'
  ...
# Subtest: P2-012 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
ok 418 - P2-012 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
  ---
  duration_ms: 5497.4378
  type: 'test'
  ...
# {"server_commit_response_lost":true,"restart_replayed":true,"incident_confirmed_event_count":1,"unknown_recovery_send_calls":0,"authorized_retry_calls":1,"ack_restart_send_calls":0}
# Subtest: P2-012 both parsed OpenAPI documents declare canonical subscription destinations and service failures
ok 419 - P2-012 both parsed OpenAPI documents declare canonical subscription destinations and service failures
  ---
  duration_ms: 732.3742
  type: 'test'
  ...
# Subtest: P2-012 static authorization, frozen predecessors, scope, schemas and synthetic fixture gate
ok 420 - P2-012 static authorization, frozen predecessors, scope, schemas and synthetic fixture gate
  ---
  duration_ms: 4857.5889
  type: 'test'
  ...
# Subtest: P2-012 live runner fails before network/listener unless all five independent fuses and verified evidence exist
ok 421 - P2-012 live runner fails before network/listener unless all five independent fuses and verified evidence exist
  ---
  duration_ms: 1.4843
  type: 'test'
  ...
# Subtest: P2-012 readiness cannot be fabricated from partial regression, skips, changed inputs or live claims
ok 422 - P2-012 readiness cannot be fabricated from partial regression, skips, changed inputs or live claims
  ---
  duration_ms: 0.3995
  type: 'test'
  ...
# Subtest: P2-012 DONE requires the approved live candidate, client confirmation, clean Incident deliveries and complete regressions
ok 423 - P2-012 DONE requires the approved live candidate, client confirmation, clean Incident deliveries and complete regressions
  ---
  duration_ms: 0.3539
  type: 'test'
  ...
# Subtest: P2-012 frozen candidate permits only the explicit closeout governance set
ok 424 - P2-012 frozen candidate permits only the explicit closeout governance set
  ---
  duration_ms: 0.3416
  type: 'test'
  ...
# Subtest: P2-012 review hardening preserves exact paths and requires independent current regression evidence
ok 425 - P2-012 review hardening preserves exact paths and requires independent current regression evidence
  ---
  duration_ms: 0.4264
  type: 'test'
  ...
# Subtest: P2-012 v2 HTTP OpenAPI hardening has an independent closed allowlist and complete regression gate
ok 426 - P2-012 v2 HTTP OpenAPI hardening has an independent closed allowlist and complete regression gate
  ---
  duration_ms: 0.4752
  type: 'test'
  ...
# Subtest: P2-012 subscription review preserves its baseline, scope and independent regression
ok 427 - P2-012 subscription review preserves its baseline, scope and independent regression
  ---
  duration_ms: 0.4257
  type: 'test'
  ...
# Subtest: P2-012 incomplete persisted Candidate summary remains explicit and does not invent clustering evidence
ok 428 - P2-012 incomplete persisted Candidate summary remains explicit and does not invent clustering evidence
  ---
  duration_ms: 3.0938
  type: 'test'
  ...
# Subtest: P2-012 four scope permissions, authorization before replay, expiry maintenance and closed schemas
ok 429 - P2-012 four scope permissions, authorization before replay, expiry maintenance and closed schemas
  ---
  duration_ms: 3680.3662
  type: 'test'
  ...
# Subtest: P2-012 approved-group Reporter discovery persists before direct intake, Sender scope and database guard
ok 430 - P2-012 approved-group Reporter discovery persists before direct intake, Sender scope and database guard
  ---
  duration_ms: 2981.4612
  type: 'test'
  ...
# Subtest: P2-012 real direct-leg eligibility suppresses group-only Ticket artifacts and validates persisted destination scope
ok 431 - P2-012 real direct-leg eligibility suppresses group-only Ticket artifacts and validates persisted destination scope
  ---
  duration_ms: 3910.4836
  type: 'test'
  ...
# Subtest: P2-012 cross-channel same reporter, pending activation, pause, unlink and reporter-safe history
ok 432 - P2-012 cross-channel same reporter, pending activation, pause, unlink and reporter-safe history
  ---
  duration_ms: 3836.6554
  type: 'test'
  ...
# Subtest: P2-012 fixed notices reuse sender, restart persistence, explicit UNKNOWN reconciliation and no blind resend
ok 433 - P2-012 fixed notices reuse sender, restart persistence, explicit UNKNOWN reconciliation and no blind resend
  ---
  duration_ms: 4092.9724
  type: 'test'
  ...
# Subtest: P2-012 expired direct destinations cannot activate subscriptions and pending reopen never claims activation
ok 434 - P2-012 expired direct destinations cannot activate subscriptions and pending reopen never claims activation
  ---
  duration_ms: 3805.3784
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 1440x900 human confirmation, refresh and accessibility
ok 435 - P2-012 database-backed browser 1440x900 human confirmation, refresh and accessibility
  ---
  duration_ms: 8902.5808
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 1366x768 human confirmation, refresh and accessibility
ok 436 - P2-012 database-backed browser 1366x768 human confirmation, refresh and accessibility
  ---
  duration_ms: 6127.7794
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 390x844 human confirmation, refresh and accessibility
ok 437 - P2-012 database-backed browser 390x844 human confirmation, refresh and accessibility
  ---
  duration_ms: 6779.2362
  type: 'test'
  ...
# Subtest: P2-012 actual HTTP inherits authentication, CSRF, command fence and durable realtime
ok 438 - P2-012 actual HTTP inherits authentication, CSRF, command fence and durable realtime
  ---
  duration_ms: 3676.2363
  type: 'test'
  ...
# Subtest: P2-012 actual HTTP preserves notification failure, rollback and durable replay before explicit recovery
ok 439 - P2-012 actual HTTP preserves notification failure, rollback and durable replay before explicit recovery
  ---
  duration_ms: 3579.7245
  type: 'test'
  ...
# Subtest: reporter identity is HMAC-bound and directory failures defer safely
ok 440 - reporter identity is HMAC-bound and directory failures defer safely
  ---
  duration_ms: 2.0781
  type: 'test'
  ...
# Subtest: direct association follows reliable priorities and never uses userid plus time
ok 441 - direct association follows reliable priorities and never uses userid plus time
  ---
  duration_ms: 1.0393
  type: 'test'
  ...
# Subtest: manual review internal query and resolve default deny before storage access
ok 442 - manual review internal query and resolve default deny before storage access
  ---
  duration_ms: 1.5007
  type: 'test'
  ...
# Subtest: migration 030 supports fresh baseline, check rollback, apply, no-op and five drift failures
ok 443 - migration 030 supports fresh baseline, check rollback, apply, no-op and five drift failures
  ---
  duration_ms: 6386.6082
  type: 'test'
  ...
# Subtest: orchestrator persists three entries, keeps threads separate and replays Ticket/Communication safely
ok 444 - orchestrator persists three entries, keeps threads separate and replays Ticket/Communication safely
  ---
  duration_ms: 3807.9477
  type: 'test'
  ...
# Subtest: rule failure reaches review; authorized keyset query and concurrent human resolution append one override
ok 445 - rule failure reaches review; authorized keyset query and concurrent human resolution append one override
  ---
  duration_ms: 3520.0222
  type: 'test'
  ...
# Subtest: continuation refs are hashed, reporter/bot bound, expiring, revocable and single-use
ok 446 - continuation refs are hashed, reporter/bot bound, expiring, revocable and single-use
  ---
  duration_ms: 4142.2788
  type: 'test'
  ...
# Subtest: migration 001 through 022 and P2-007 runtime are unchanged from origin/main
ok 447 - migration 001 through 022 and P2-007 runtime are unchanged from origin/main
  ---
  duration_ms: 97.0181
  type: 'test'
  ...
# Subtest: strict feature flags default false and reject non-canonical values
ok 448 - strict feature flags default false and reject non-canonical values
  ---
  duration_ms: 2.8736
  type: 'test'
  ...
# Subtest: ordinary JSON boundary rejects proxy, accessor, symbol, toJSON, cycles and pollution keys
ok 449 - ordinary JSON boundary rejects proxy, accessor, symbol, toJSON, cycles and pollution keys
  ---
  duration_ms: 0.5122
  type: 'test'
  ...
# Subtest: router protects faults from acknowledgement and maps required examples
ok 450 - router protects faults from acknowledgement and maps required examples
  ---
  duration_ms: 80.2483
  type: 'test'
  ...
# Subtest: ten result codes are reachable and deterministic
ok 451 - ten result codes are reachable and deterministic
  ---
  duration_ms: 110.9185
  type: 'test'
  ...
# Subtest: clinical high risk reaches review and unsupported root cause is never confirmed
ok 452 - clinical high risk reaches review and unsupported root cause is never confirmed
  ---
  duration_ms: 43.3193
  type: 'test'
  ...
# Subtest: gold manifest references all 96 + 42 + 64 frozen cases with ten routes
ok 453 - gold manifest references all 96 + 42 + 64 frozen cases with ten routes
  ---
  duration_ms: 1.8793
  type: 'test'
  ...
# Subtest: crash before commit leaves no partial facts; crash after commit restarts as replay
ok 454 - crash before commit leaves no partial facts; crash after commit restarts as replay
  ---
  duration_ms: 4738.5194
  type: 'test'
  ...
# {"crash_before_commit_partial_facts":{"journeys":0,"decisions":0,"tickets":0},"crash_after_commit":{"journeys":1,"decisions":1,"tickets":1},"restart_processed":0,"replay_duplicate_delta":0}
# Subtest: bounded worker processes 500 journeys, 2000 turns, 500 decisions and 100 reviews on one worker
ok 455 - bounded worker processes 500 journeys, 2000 turns, 500 decisions and 100 reviews on one worker
  ---
  duration_ms: 19070.3028
  type: 'test'
  ...
# {"journeys":500,"turns":2000,"decisions":500,"reviews":100,"worker_count":1,"pool_max":4,"batch_max":100,"heap_samples_bytes":[16545960,17799416,34604688,37000952,39652240,59005104],"heap_fall_or_stable":true,"timer_active_after_stop":false,"soak_24h":false}
# Subtest: worker defaults are bounded and disabled flags claim nothing
ok 456 - worker defaults are bounded and disabled flags claim nothing
  ---
  duration_ms: 1.6107
  type: 'test'
  ...
# Subtest: worker rejects batches above maximum without querying storage
ok 457 - worker rejects batches above maximum without querying storage
  ---
  duration_ms: 0.8873
  type: 'test'
  ...
# Subtest: P2-016 bounded capacity: 500 Tickets / 5000 events / 200 review resolutions / 500 cards / 100 sessions / 32 SSE
ok 458 - P2-016 bounded capacity: 500 Tickets / 5000 events / 200 review resolutions / 500 cards / 100 sessions / 32 SSE
  ---
  duration_ms: 108581.1999
  type: 'test'
  ...
# {"tickets":500,"ticket_events":5000,"review_resolutions":200,"cards":500,"group_receipts":400,"reporter_sessions":100,"pool_max":4,"sse_max":32,"sse_after_stop":0,"heap_samples_bytes":[14829192,30278456,38483800,46306896,48480120,63875368,61341408,44947232,66896576,52579336,74535392,63962256,85910072,76305688,99180912,30395832,51886048,35297000,52292456,68918400,50883368,67331904,87192488,60610584,77547928,92452920,65682440,76174520,33965696,33302184],"heap_peak_bytes":99180912,"heap_final_bytes":33302184,"heap_fall_or_stable":true,"real_sdk_calls":0,"soak_24h":false}
# {"cleanup":{"database_count":0,"backend_count":0}}
# Subtest: P2-016 plain JSON excludes active objects without invoking user hooks
ok 459 - P2-016 plain JSON excludes active objects without invoking user hooks
  ---
  duration_ms: 2.9311
  type: 'test'
  ...
# Subtest: P2-016 strict command, versions, closed keys and bounded lists
ok 460 - P2-016 strict command, versions, closed keys and bounded lists
  ---
  duration_ms: 1.9616
  type: 'test'
  ...
# Subtest: notification policy includes created
ok 461 - notification policy includes created
  ---
  duration_ms: 0.2316
  type: 'test'
  ...
# Subtest: notification policy includes accepted
ok 462 - notification policy includes accepted
  ---
  duration_ms: 0.1065
  type: 'test'
  ...
# Subtest: notification policy includes started
ok 463 - notification policy includes started
  ---
  duration_ms: 0.1015
  type: 'test'
  ...
# Subtest: notification policy includes resumed
ok 464 - notification policy includes resumed
  ---
  duration_ms: 0.1013
  type: 'test'
  ...
# Subtest: notification policy includes waiting_requester
ok 465 - notification policy includes waiting_requester
  ---
  duration_ms: 0.0977
  type: 'test'
  ...
# Subtest: notification policy includes waiting_vendor
ok 466 - notification policy includes waiting_vendor
  ---
  duration_ms: 0.0782
  type: 'test'
  ...
# Subtest: notification policy includes resolved
ok 467 - notification policy includes resolved
  ---
  duration_ms: 0.083
  type: 'test'
  ...
# Subtest: notification policy includes closed
ok 468 - notification policy includes closed
  ---
  duration_ms: 0.1972
  type: 'test'
  ...
# Subtest: notification policy includes reopened
ok 469 - notification policy includes reopened
  ---
  duration_ms: 0.1336
  type: 'test'
  ...
# Subtest: notification policy includes cancelled
ok 470 - notification policy includes cancelled
  ---
  duration_ms: 0.1604
  type: 'test'
  ...
# Subtest: notes and assignment changes never become external free-text notifications
ok 471 - notes and assignment changes never become external free-text notifications
  ---
  duration_ms: 0.1162
  type: 'test'
  ...
# Subtest: template card exact shape, last-four and safe immutable view
ok 472 - template card exact shape, last-four and safe immutable view
  ---
  duration_ms: 1.1137
  type: 'test'
  ...
# Subtest: card rejects unsafe origin javascript:alert(1)
ok 473 - card rejects unsafe origin javascript:alert(1)
  ---
  duration_ms: 0.1718
  type: 'test'
  ...
# Subtest: card rejects unsafe origin data:text/html,x
ok 474 - card rejects unsafe origin data:text/html,x
  ---
  duration_ms: 0.1615
  type: 'test'
  ...
# Subtest: card rejects unsafe origin file:///x
ok 475 - card rejects unsafe origin file:///x
  ---
  duration_ms: 0.0922
  type: 'test'
  ...
# Subtest: card rejects unsafe origin http://reporter.example.test
ok 476 - card rejects unsafe origin http://reporter.example.test
  ---
  duration_ms: 0.0682
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://attacker.invalid
ok 477 - card rejects unsafe origin https://attacker.invalid
  ---
  duration_ms: 0.0772
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://[userinfo]@reporter.example.test
ok 478 - card rejects unsafe origin https://[userinfo]@reporter.example.test
  ---
  duration_ms: 0.062
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://reporter.example.test/?grant=abc
ok 479 - card rejects unsafe origin https://reporter.example.test/?grant=abc
  ---
  duration_ms: 0.0549
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://reporter.example.test/\#x
ok 480 - card rejects unsafe origin https://reporter.example.test/\#x
  ---
  duration_ms: 0.0542
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://reporter.example.test/path
ok 481 - card rejects unsafe origin https://reporter.example.test/path
  ---
  duration_ms: 0.0464
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":0}
ok 482 - sender accepts only explicit numeric ACK {"errcode":0}
  ---
  duration_ms: 1.1124
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"body":{"errcode":0}}
ok 483 - sender accepts only explicit numeric ACK {"body":{"errcode":0}}
  ---
  duration_ms: 0.3735
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {}
ok 484 - sender accepts only explicit numeric ACK {}
  ---
  duration_ms: 0.3019
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":"0"}
ok 485 - sender accepts only explicit numeric ACK {"errcode":"0"}
  ---
  duration_ms: 0.2216
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":null}
ok 486 - sender accepts only explicit numeric ACK {"errcode":null}
  ---
  duration_ms: 1.1156
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":40001}
ok 487 - sender accepts only explicit numeric ACK {"errcode":40001}
  ---
  duration_ms: 0.3009
  type: 'test'
  ...
# Subtest: sender fail-closed {"enabled":false}
ok 488 - sender fail-closed {"enabled":false}
  ---
  duration_ms: 0.1363
  type: 'test'
  ...
# Subtest: sender fail-closed {"cardEnabled":false}
ok 489 - sender fail-closed {"cardEnabled":false}
  ---
  duration_ms: 0.0753
  type: 'test'
  ...
# Subtest: sender fail-closed {"target":"not-allowlisted"}
ok 490 - sender fail-closed {"target":"not-allowlisted"}
  ---
  duration_ms: 0.1211
  type: 'test'
  ...
# Subtest: sender fail-closed {"binding":false}
ok 491 - sender fail-closed {"binding":false}
  ---
  duration_ms: 0.2038
  type: 'test'
  ...
# Subtest: gateway unavailable before network is retry-safe, no SDK call
ok 492 - gateway unavailable before network is retry-safe, no SDK call
  ---
  duration_ms: 0.497
  type: 'test'
  ...
# Subtest: live inbound is clipped before persistence by approved bot, person and group hashes
ok 493 - live inbound is clipped before persistence by approved bot, person and group hashes
  ---
  duration_ms: 0.5196
  type: 'test'
  ...
# Subtest: Ticket delivery operator commands authorize before receipt, persist idempotence and never blindly retry UNKNOWN
ok 494 - Ticket delivery operator commands authorize before receipt, persist idempotence and never blindly retry UNKNOWN
  ---
  duration_ms: 2573.8932
  type: 'test'
  ...
# Subtest: P2-016 real-format group wakeup and direct description remain one Journey through public queries
ok 495 - P2-016 real-format group wakeup and direct description remain one Journey through public queries
  ---
  duration_ms: 2859.9823
  type: 'test'
  ...
# Subtest: P2-016 group-to-direct unique binding preserves Journey; ambiguous, consumed and expired candidates never guess
ok 496 - P2-016 group-to-direct unique binding preserves Journey; ambiguous, consumed and expired candidates never guess
  ---
  duration_ms: 10975.8011
  type: 'test'
  ...
# Subtest: P2-016 later same-group description preserves the recorded entry mode instead of rejecting the Journey
ok 497 - P2-016 later same-group description preserves the recorded entry mode instead of rejecting the Journey
  ---
  duration_ms: 2635.8882
  type: 'test'
  ...
# Subtest: P2-016 approved topology uses three real bounded processes, rule-first Worker and zero live SDK calls
ok 498 - P2-016 approved topology uses three real bounded processes, rule-first Worker and zero live SDK calls
  ---
  duration_ms: 4377.3513
  type: 'test'
  ...
# {"process_count":3,"pool_max":7,"live_provider_calls":0,"rule_first_worker":true}
# Subtest: P2-016 live harness requires exact owner fuses and HTTPS bounded configuration, without logging secrets
ok 499 - P2-016 live harness requires exact owner fuses and HTTPS bounded configuration, without logging secrets
  ---
  duration_ms: 3.552
  type: 'test'
  ...
# Subtest: P2-016 live requires an exact verified candidate and at least 15 minutes; cannot claim final completion
ok 500 - P2-016 live requires an exact verified candidate and at least 15 minutes; cannot claim final completion
  ---
  duration_ms: 0.4221
  type: 'test'
  ...
# Subtest: P2-016 live CLI with no approvals exits before DB, listener, Evidence or SDK work
ok 501 - P2-016 live CLI with no approvals exits before DB, listener, Evidence or SDK work
  ---
  duration_ms: 255.3044
  type: 'test'
  ...
# Subtest: P2-016 review resolution and Safe Action commit or roll back together
ok 502 - P2-016 review resolution and Safe Action commit or roll back together
  ---
  duration_ms: 2120.019
  type: 'test'
  ...
# Subtest: P2-016 migration is atomic, check-only, exact, reentrant and drift-failing
    # Subtest: rejects table drift
    ok 1 - rejects table drift
      ---
      duration_ms: 34.1953
      type: 'test'
      ...
    # Subtest: rejects column drift
    ok 2 - rejects column drift
      ---
      duration_ms: 19.5986
      type: 'test'
      ...
    # Subtest: rejects type drift
    ok 3 - rejects type drift
      ---
      duration_ms: 60.6854
      type: 'test'
      ...
    # Subtest: rejects default drift
    ok 4 - rejects default drift
      ---
      duration_ms: 20.5895
      type: 'test'
      ...
    # Subtest: rejects constraint drift
    ok 5 - rejects constraint drift
      ---
      duration_ms: 23.4505
      type: 'test'
      ...
    # Subtest: rejects index drift
    ok 6 - rejects index drift
      ---
      duration_ms: 21.1077
      type: 'test'
      ...
    # Subtest: rejects foreign_key drift
    ok 7 - rejects foreign_key drift
      ---
      duration_ms: 20.8867
      type: 'test'
      ...
    1..7
ok 503 - P2-016 migration is atomic, check-only, exact, reentrant and drift-failing
  ---
  duration_ms: 2579.1049
  type: 'test'
  ...
# Subtest: P2-016 persisted card delivery, HMAC grants, one-use sessions and reporter-safe timeline
ok 504 - P2-016 persisted card delivery, HMAC grants, one-use sessions and reporter-safe timeline
  ---
  duration_ms: 2097.7805
  type: 'test'
  ...
# Subtest: P2-016 existing rule worker creates Ticket notifications, safe group/direct guidance and SYSTEM-only timeout closure
ok 505 - P2-016 existing rule worker creates Ticket notifications, safe group/direct guidance and SYSTEM-only timeout closure
  ---
  duration_ms: 1867.9118
  type: 'test'
  ...
# Subtest: Reporter browser 1440x900 real DB/session, fragment removal, refresh, timezone, safe data and logout
ok 506 - Reporter browser 1440x900 real DB/session, fragment removal, refresh, timezone, safe data and logout
  ---
  duration_ms: 4984.5319
  type: 'test'
  ...
# Subtest: Reporter browser 390x844 real DB/session, fragment removal, refresh, timezone, safe data and logout
ok 507 - Reporter browser 390x844 real DB/session, fragment removal, refresh, timezone, safe data and logout
  ---
  duration_ms: 5658.1645
  type: 'test'
  ...
# Subtest: Reporter grant expiry, HMAC rotation, one-consume concurrency, session expiry/revocation and cross-ticket isolation
ok 508 - Reporter grant expiry, HMAC rotation, one-consume concurrency, session expiry/revocation and cross-ticket isolation
  ---
  duration_ms: 3451.8602
  type: 'test'
  ...
# Subtest: P2-016 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
ok 509 - P2-016 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
  ---
  duration_ms: 5773.2963
  type: 'test'
  ...
# {"server_commit_response_lost":true,"restart_replayed":true,"ticket_event_count":1,"unknown_recovery_send_calls":0,"authorized_retry_calls":1,"ack_restart_send_calls":0}
# Subtest: P2-016 architecture guards preserve authorization, immutable baselines and closed contracts
ok 510 - P2-016 architecture guards preserve authorization, immutable baselines and closed contracts
  ---
  duration_ms: 2405.9942
  type: 'test'
  ...
# Subtest: P2-016 default validator still requires readiness Evidence; deferred source checks cannot authorize live work
ok 511 - P2-016 default validator still requires readiness Evidence; deferred source checks cannot authorize live work
  ---
  duration_ms: 2763.6524
  type: 'test'
  ...
# Subtest: P2-016 schemas and declarations exist; Reporter outputs cannot contain internal identity or credentials
ok 512 - P2-016 schemas and declarations exist; Reporter outputs cannot contain internal identity or credentials
  ---
  duration_ms: 51.7708
  type: 'test'
  ...
# Subtest: JSON contract rejects extra keys, noncanonical types and offset time
ok 513 - JSON contract rejects extra keys, noncanonical types and offset time
  ---
  duration_ms: 19.0192
  type: 'test'
  ...
# Subtest: P2-016 closeout freezes every business input and the exact file set
ok 514 - P2-016 closeout freezes every business input and the exact file set
  ---
  duration_ms: 1.9561
  type: 'test'
  ...
# Subtest: P2-016 completion requires owner approval, precise candidates, live duration and zero-skip final regression
ok 515 - P2-016 completion requires owner approval, precise candidates, live duration and zero-skip final regression
  ---
  duration_ms: 3.9797
  type: 'test'
  ...
# Subtest: Real DB internal browser traverses every user lifecycle action, transfer and atomic takeover/accept
ok 516 - Real DB internal browser traverses every user lifecycle action, transfer and atomic takeover/accept
  ---
  duration_ms: 11704.6568
  type: 'test'
  ...
# Subtest: P2-016 Ticket lifecycle, command persistence, authorization and independent responsibility
ok 517 - P2-016 Ticket lifecycle, command persistence, authorization and independent responsibility
  ---
  duration_ms: 4038.6559
  type: 'test'
  ...
# Subtest: P2-016 native browser 1440x900 command, review, refresh, SSE, polling, XSS and auth-expiry
ok 518 - P2-016 native browser 1440x900 command, review, refresh, SSE, polling, XSS and auth-expiry
  ---
  duration_ms: 7080.764
  type: 'test'
  ...
# Subtest: P2-016 native browser 390x844 command, review, refresh, SSE, polling, XSS and auth-expiry
ok 519 - P2-016 native browser 390x844 command, review, refresh, SSE, polling, XSS and auth-expiry
  ---
  duration_ms: 7993.8849
  type: 'test'
  ...
# Subtest: confirmation survives realtime refetch and rejects a stale version instead of overwriting the form
ok 520 - confirmation survives realtime refetch and rejects a stale version instead of overwriting the form
  ---
  duration_ms: 2088.9904
  type: 'test'
  ...
# Subtest: P2-016 actual HTTP assembly: fail-closed flags, auth, CSRF, Ticket actions and durable SSE
ok 521 - P2-016 actual HTTP assembly: fail-closed flags, auth, CSRF, Ticket actions and durable SSE
  ---
  duration_ms: 2951.0083
  type: 'test'
  ...
# Subtest: P2-G1 system browser duplicate submit fence sends one human reply and preserves safe rendering
ok 522 - P2-G1 system browser duplicate submit fence sends one human reply and preserves safe rendering
  ---
  duration_ms: 1690.8304
  type: 'test'
  ...
# {"browser":"C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe","viewport":{"width":390,"height":844},"replay_events":100,"realtime_list_calls":3,"duplicate_submit_calls":1,"polling_fallback":true,"xss_executed":false,"horizontal_overflow":false}
# Subtest: P2-G1 system browser preserves native SSE reconnect and sends Last-Event-ID
ok 523 - P2-G1 system browser preserves native SSE reconnect and sends Last-Event-ID
  ---
  duration_ms: 5014.4291
  type: 'test'
  ...
# {"sse_connections":2,"last_event_id_used":true,"polling_stopped_after_reconnect":true}
# Subtest: P2-G1 live browser sessions navigate to the actual Workbench route with isolated cookies
ok 524 - P2-G1 live browser sessions navigate to the actual Workbench route with isolated cookies
  ---
  duration_ms: 5419.7239
  type: 'test'
  ...
# {"browser_sessions":2,"workbench_route_requests":2,"isolated_cookie_headers":true,"root_not_requested":true,"safe_telemetry":true}
# Subtest: P2-G1 P1 commit, durable projection recovery, duplicate idempotency, participant isolation and catalog invariance
ok 525 - P2-G1 P1 commit, durable projection recovery, duplicate idempotency, participant isolation and catalog invariance
  ---
  duration_ms: 4715.6416
  type: 'test'
  ...
# {"tickets":3,"duplicate_ticket_delta":0,"duplicate_item_delta":0,"participant_sessions":3,"first_versions":[1,1],"next_versions":[2,2],"p1_survived_projection_failure":true,"recovery_backlog":0,"catalog_unchanged":true}
# Subtest: P2-G1 different Intake atomically ends the prior participant Session before opening the next
ok 526 - P2-G1 different Intake atomically ends the prior participant Session before opening the next
  ---
  duration_ms: 3466.8451
  type: 'test'
  ...
# {"different_intake_sessions":2,"prior_ended":1,"active_sessions":1,"active_versions":[1,1],"projection_failures":0}
# Subtest: P2-G1 fault paths serialize takeover, isolate internal note, deduplicate reply and recover delivery without blind resend
ok 527 - P2-G1 fault paths serialize takeover, isolate internal note, deduplicate reply and recover delivery without blind resend
  ---
  duration_ms: 2894.4236
  type: 'test'
  ...
# {"concurrent_takeover_winners":1,"internal_note":{"message":1,"outbox":0,"delivery":0},"duplicate_reply_parallel":12,"reply":{"messages":1,"outboxes":1,"deliveries":1},"gateway_unavailable_pending":true,"reconnect_provider_calls":1,"unknown_reconciliation":true,"ai_calls":0,"ocr_calls":0}
# Subtest: P2-G1 local runtime binds one loopback App and reports human-only readiness with strict Test Auth
ok 528 - P2-G1 local runtime binds one loopback App and reports human-only readiness with strict Test Auth
  ---
  duration_ms: 3964.5563
  type: 'test'
  ...
# {"app_processes":1,"loopback_http":true,"readiness":true,"gateway_required":false,"active_gateway_count":0,"projection_batch":20,"communication_batch":20,"communication_sender":"MOCK","sse_client_cap":32,"dynamic_realtime_authorization":true,"test_auth_http_only":true,"human_only":true}
# Subtest: P2-G1 process cluster runs App, Worker and Gateway in three bounded Node processes
ok 529 - P2-G1 process cluster runs App, Worker and Gateway in three bounded Node processes
  ---
  duration_ms: 3482.7239
  type: 'test'
  ...
# {"process_count":3,"app_pool_max":4,"worker_pool_max":2,"gateway_pool_max":1,"combined_runtime":false,"raw_identifiers_recorded":false}
# Subtest: P2-G1 isolated PostgreSQL Replay Gap drives real Edge through Last-Event-ID, 410 and refetch
ok 530 - P2-G1 isolated PostgreSQL Replay Gap drives real Edge through Last-Event-ID, 410 and refetch
  ---
  duration_ms: 18612.3989
  type: 'test'
  ...
# {"http_status":410,"last_event_id":true,"refetch":["LIST","DETAIL","TIMELINE"],"process_count":3,"isolated_database_cleanup":true}
# Subtest: P2-G1 bounded capacity projects 1000 synthetic inbound facts and drains 500 deliveries with no catalog drift
ok 531 - P2-G1 bounded capacity projects 1000 synthetic inbound facts and drains 500 deliveries with no catalog drift
  ---
  duration_ms: 66466.3246
  type: 'test'
  ...
# {"synthetic_inbound":1000,"projected":1000,"delivery_backlog":500,"delivery_sent":500,"sender_calls":500,"projector_batch":20,"delivery_batch":20,"pool_max":4,"catalog_unchanged":true,"oom":0,"soak_24h":false}
# Subtest: live CLI exposes only the six explicit modes and requires three process fuses for sending
ok 532 - live CLI exposes only the six explicit modes and requires three process fuses for sending
  ---
  duration_ms: 1.567
  type: 'test'
  ...
# Subtest: gateway process can commit inbound before the App process projects it
ok 533 - gateway process can commit inbound before the App process projects it
  ---
  duration_ms: 1.1869
  type: 'test'
  ...
# Subtest: process resource interface exposes bounded role metrics without a PID or environment
ok 534 - process resource interface exposes bounded role metrics without a PID or environment
  ---
  duration_ms: 0.8704
  type: 'test'
  ...
# Subtest: gateway permits one active WSClient, gates readiness on authentication, reconnects and shuts down cleanly
ok 535 - gateway permits one active WSClient, gates readiness on authentication, reconnects and shuts down cleanly
  ---
  duration_ms: 4.0483
  type: 'test'
  ...
# Subtest: sender enforces persistent target hash allowlist and maps ACK, explicit rejection, unknown and gateway-unavailable safely
ok 536 - sender enforces persistent target hash allowlist and maps ACK, explicit rejection, unknown and gateway-unavailable safely
  ---
  duration_ms: 1.3999
  type: 'test'
  ...
# Subtest: test authentication is server-configured, active non-reporter only, short-lived and emits strict HttpOnly cookie metadata
ok 537 - test authentication is server-configured, active non-reporter only, short-lived and emits strict HttpOnly cookie metadata
  ---
  duration_ms: 0.8957
  type: 'test'
  ...
# Subtest: test authentication isolates two configured principals with independent short-lived cookies and CSRF values
ok 538 - test authentication isolates two configured principals with independent short-lived cookies and CSRF values
  ---
  duration_ms: 0.7075
  type: 'test'
  ...
# Subtest: live harness requires two distinct configured principals and creates a safe unique run id
ok 539 - live harness requires two distinct configured principals and creates a safe unique run id
  ---
  duration_ms: 0.297
  type: 'test'
  ...
# Subtest: disabled coordinator performs no database work and batch/stream inventory are bounded
ok 540 - disabled coordinator performs no database work and batch/stream inventory are bounded
  ---
  duration_ms: 1.6511
  type: 'test'
  ...
# Subtest: temporary database failure is isolated behind stable projection errors without raw details or false success
ok 541 - temporary database failure is isolated behind stable projection errors without raw details or false success
  ---
  duration_ms: 2.0472
  type: 'test'
  ...
# Subtest: P2-002 transaction hook is optional and P2-G1 browser source has an in-flight duplicate-submit fence
ok 542 - P2-002 transaction hook is optional and P2-G1 browser source has an in-flight duplicate-submit fence
  ---
  duration_ms: 22.5836
  type: 'test'
  ...
# Subtest: live script has no broad --live mode and no default live-send npm command
ok 543 - live script has no broad --live mode and no default live-send npm command
  ---
  duration_ms: 1.5961
  type: 'test'
  ...
# Subtest: shared pg factory preserves date/time/timestamp/timestamptz/tsrange/BIGINT strings and JSON objects
ok 544 - shared pg factory preserves date/time/timestamp/timestamptz/tsrange/BIGINT strings and JSON objects
  ---
  duration_ms: 51.176
  type: 'test'
  ...
# Subtest: shared pg factory rejects Date recursively before sending SQL
ok 545 - shared pg factory rejects Date recursively before sending SQL
  ---
  duration_ms: 156.2874
  type: 'test'
  ...
# Subtest: LocalDate, LocalTime, and LocalDateTime accept real Asia/Shanghai calendar values
ok 546 - LocalDate, LocalTime, and LocalDateTime accept real Asia/Shanghai calendar values
  ---
  duration_ms: 0.9333
  type: 'test'
  ...
# Subtest: LocalDateTime rejects invalid dates, T/Z/UTC/offset/IANA, fractions, whitespace, and objects
ok 547 - LocalDateTime rejects invalid dates, T/Z/UTC/offset/IANA, fractions, whitespace, and objects
  ---
  duration_ms: 1.4778
  type: 'test'
  ...
# Subtest: PhysicalEpochMs remains a canonical non-negative decimal string and round-trips Shanghai local seconds
ok 548 - PhysicalEpochMs remains a canonical non-negative decimal string and round-trips Shanghai local seconds
  ---
  duration_ms: 0.549
  type: 'test'
  ...
# Subtest: explicit Asia/Shanghai formatter is invariant under UTC, Tokyo, and New York process TZ
ok 549 - explicit Asia/Shanghai formatter is invariant under UTC, Tokyo, and New York process TZ
  ---
  duration_ms: 244.4267
  type: 'test'
  ...
# Subtest: V1.3 compatibility command delegates to active V1.4 validation
ok 550 - V1.3 compatibility command delegates to active V1.4 validation
  ---
  duration_ms: 132.4038
  type: 'test'
  ...
# Subtest: V1.4 architecture validator passes
ok 551 - V1.4 architecture validator passes
  ---
  duration_ms: 91.8872
  type: 'test'
  ...
# Subtest: P2/P2-G1 lifecycle state is internally consistent without changing P1
ok 552 - P2/P2-G1 lifecycle state is internally consistent without changing P1
  ---
  duration_ms: 4.6416
  type: 'test'
  ...
# Subtest: P2-004 independent authorization and stop line are preserved
ok 553 - P2-004 independent authorization and stop line are preserved
  ---
  duration_ms: 1.1298
  type: 'test'
  ...
# Subtest: P2-005 independent authorization and stop line are recorded
ok 554 - P2-005 independent authorization and stop line are recorded
  ---
  duration_ms: 0.6639
  type: 'test'
  ...
# Subtest: P2-006 independent authorization and stop line are recorded
ok 555 - P2-006 independent authorization and stop line are recorded
  ---
  duration_ms: 0.8239
  type: 'test'
  ...
# Subtest: P2-004 completion artifacts preserve P1 notification and Ticket ownership
ok 556 - P2-004 completion artifacts preserve P1 notification and Ticket ownership
  ---
  duration_ms: 2.2212
  type: 'test'
  ...
# Subtest: P2-005 completion artifacts preserve frozen Session and identity ownership
ok 557 - P2-005 completion artifacts preserve frozen Session and identity ownership
  ---
  duration_ms: 0.4302
  type: 'test'
  ...
# Subtest: P2-006 completion has a runnable workbench and no migration 022
ok 558 - P2-006 completion has a runnable workbench and no migration 022
  ---
  duration_ms: 0.8377
  type: 'test'
  ...
# Subtest: P2-001 and P2-002 frozen artifacts remain present
ok 559 - P2-001 and P2-002 frozen artifacts remain present
  ---
  duration_ms: 0.4038
  type: 'test'
  ...
# Subtest: P3 remains greenfield and contains no historical ticket program
ok 560 - P3 remains greenfield and contains no historical ticket program
  ---
  duration_ms: 1.6894
  type: 'test'
  ...
# Subtest: future flags default off without legacy import flags
ok 561 - future flags default off without legacy import flags
  ---
  duration_ms: 0.6107
  type: 'test'
  ...
# Subtest: conceptual schema has no historical migration fields or second ticket core
ok 562 - conceptual schema has no historical migration fields or second ticket core
  ---
  duration_ms: 0.4876
  type: 'test'
  ...
# Subtest: new source example is non-authoritative
ok 563 - new source example is non-authoritative
  ---
  duration_ms: 0.8394
  type: 'test'
  ...
# Subtest: 2C4G limits remain conservative
ok 564 - 2C4G limits remain conservative
  ---
  duration_ms: 1.1732
  type: 'test'
  ...
# Subtest: P2-016 authorization reconciles only the historical P2-015 ledger
ok 565 - P2-016 authorization reconciles only the historical P2-015 ledger
  ---
  duration_ms: 2.1624
  type: 'test'
  ...
# Subtest: architecture validator rejects the historical P2-015 ledger drift
ok 566 - architecture validator rejects the historical P2-015 ledger drift
  ---
  duration_ms: 22.1849
  type: 'test'
  ...
# Subtest: P2-012 authorization rejects premature completion and next-gate authorization
ok 567 - P2-012 authorization rejects premature completion and next-gate authorization
  ---
  duration_ms: 0.3681
  type: 'test'
  ...
1..567
# tests 574
# suites 0
# pass 573
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 790931.5224
````

</details>

<details>
<summary>Capacity diagnosis — raw SHA-256 e52a375d2da9482da298c2e8f70138015e1c00952930f5cc00af48eacd66a1c5</summary>

内嵌文本仅规范换行与行尾空白；原文件：tmp/p2012-review3/capacity-diagnostic.tap。

````text
TAP version 13
# Subtest: P2-012 real command capacity 500 candidates, 200 incidents, 2000 reports, 1000 subscriptions, 5000 events, 500 bindings and 32 SSE
ok 1 - P2-012 real command capacity 500 candidates, 200 incidents, 2000 reports, 1000 subscriptions, 5000 events, 500 bindings and 32 SSE
  ---
  duration_ms: 77127.8643
  type: 'test'
  ...
# {"candidates":500,"incidents":200,"reports":2000,"subscriptions":1000,"events":5200,"bindings":550,"notification_sent":550,"pool_max":4,"sse_max":32,"sse_after_stop":0,"heap_samples_bytes":[15171392,38059488,82794672,23644448,76563392,44625440,64833616,85215384,52616264,72979968,39712744,80692576,18117144],"heap_peak_bytes":85215384,"heap_final_bytes":18117144,"real_sdk_calls":0,"model_calls":0}
# {"cleanup":{"database_count":0,"backend_count":0}}
1..1
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 77717.1591
````

</details>

<details>
<summary>Final full — raw SHA-256 b79675a4032c3217ce134ad51e2b7978800c34f6295cfb49c0b52e74b823ea28</summary>

内嵌文本仅规范换行与行尾空白；原文件：tmp/p2012-review3/full-final.tap。

````text
TAP version 13
# Subtest: ARCH-005 architecture validator freezes migrations and reports all hard static counts at zero
ok 1 - ARCH-005 architecture validator freezes migrations and reports all hard static counts at zero
  ---
  duration_ms: 123.0898
  type: 'test'
  ...
# Subtest: P2-007 and its authorized P2-015 successor keep the frozen ARCH-005 contract
ok 2 - P2-007 and its authorized P2-015 successor keep the frozen ARCH-005 contract
  ---
  duration_ms: 2.4383
  type: 'test'
  ...
# Subtest: existing 001-021 database passes 022 check rollback, apply, forbidden-zero, and repeat no-op
ok 3 - existing 001-021 database passes 022 check rollback, apply, forbidden-zero, and repeat no-op
  ---
  duration_ms: 3431.7406
  type: 'test'
  ...
# Subtest: fresh database executes 001-021-022 through the current-baseline entrypoint
ok 4 - fresh database executes 001-021-022 through the current-baseline entrypoint
  ---
  duration_ms: 3161.9522
  type: 'test'
  ...
# Subtest: ARCH-006 validator passes
ok 5 - ARCH-006 validator passes
  ---
  duration_ms: 178.6277
  type: 'test'
  ...
# Subtest: machine state preserves ARCH-006 facts and separately authorized P2-015/P2-016 successor lifecycles
ok 6 - machine state preserves ARCH-006 facts and separately authorized P2-015/P2-016 successor lifecycles
  ---
  duration_ms: 1.0654
  type: 'test'
  ...
# Subtest: ten safe deterministic results are first-class and Manual Review is valid
ok 7 - ten safe deterministic results are first-class and Manual Review is valid
  ---
  duration_ms: 1.1293
  type: 'test'
  ...
# Subtest: Ticket lifecycle reuses authoritative actions and reliable notification boundary
ok 8 - Ticket lifecycle reuses authoritative actions and reliable notification boundary
  ---
  duration_ms: 1.0392
  type: 'test'
  ...
# Subtest: Incident remains human-confirmed and AI-independent
ok 9 - Incident remains human-confirmed and AI-independent
  ---
  duration_ms: 0.7695
  type: 'test'
  ...
# Subtest: AI-off readiness and feature flags are closed by default
ok 10 - AI-off readiness and feature flags are closed by default
  ---
  duration_ms: 2.1772
  type: 'test'
  ...
# Subtest: configuration preserves G0 boundaries and substitutes only the invalid test secret
ok 11 - configuration preserves G0 boundaries and substitutes only the invalid test secret
  ---
  duration_ms: 1.3425
  type: 'test'
  ...
# Subtest: redaction and error mapping do not expose a configured secret
ok 12 - redaction and error mapping do not expose a configured secret
  ---
  duration_ms: 0.3946
  type: 'test'
  ...
# Subtest: the connection stability window is bounded and explicit
ok 13 - the connection stability window is bounded and explicit
  ---
  duration_ms: 0.2198
  type: 'test'
  ...
# Subtest: authenticated probe starts shutdown by SIGTERM and calls disconnect before completion
ok 14 - authenticated probe starts shutdown by SIGTERM and calls disconnect before completion
  ---
  duration_ms: 3.6433
  type: 'test'
  ...
# Subtest: text frame capture records only the permitted, desensitized shape
ok 15 - text frame capture records only the permitted, desensitized shape
  ---
  duration_ms: 2.358
  type: 'test'
  ...
# Subtest: capture arguments require a named scenario and an evidence jsonl target
ok 16 - capture arguments require a named scenario and an evidence jsonl target
  ---
  duration_ms: 0.6899
  type: 'test'
  ...
# Subtest: media capture records only desensitized frame, download, and filename metadata
ok 17 - media capture records only desensitized frame, download, and filename metadata
  ---
  duration_ms: 3.4516
  type: 'test'
  ...
# Subtest: media capture arguments restrict scenarios, evidence output, and aes key modes
ok 18 - media capture arguments restrict scenarios, evidence output, and aes key modes
  ---
  duration_ms: 2.3803
  type: 'test'
  ...
# Subtest: voice capture retains only safe transcript metadata and does not download media
ok 19 - voice capture retains only safe transcript metadata and does not download media
  ---
  duration_ms: 0.4698
  type: 'test'
  ...
# Subtest: video capture reuses encrypted download evidence without exposing media references
ok 20 - video capture reuses encrypted download evidence without exposing media references
  ---
  duration_ms: 0.5415
  type: 'test'
  ...
# Subtest: download evidence maps decrypt failures and local deadline without leaking error details
ok 21 - download evidence maps decrypt failures and local deadline without leaking error details
  ---
  duration_ms: 3.9707
  type: 'test'
  ...
# Subtest: push arguments restrict scenario, timing, repeat and evidence output
ok 22 - push arguments restrict scenario, timing, repeat and evidence output
  ---
  duration_ms: 1.65
  type: 'test'
  ...
# Subtest: direct push uses userid in memory but records only desensitized delivery evidence
ok 23 - direct push uses userid in memory but records only desensitized delivery evidence
  ---
  duration_ms: 3.7978
  type: 'test'
  ...
# Subtest: group mention mode is opt-in and invalid chatid rejection keeps SDK error text out of evidence
ok 24 - group mention mode is opt-in and invalid chatid rejection keeps SDK error text out of evidence
  ---
  duration_ms: 0.8664
  type: 'test'
  ...
# Subtest: group markdown-then-text mention probe sends two ordered bodies and treats only the text probe rejection as a valid result
ok 25 - group markdown-then-text mention probe sends two ordered bodies and treats only the text probe rejection as a valid result
  ---
  duration_ms: 0.6259
  type: 'test'
  ...
# Subtest: group mention arguments restrict timeout, trigger token and evidence output
ok 26 - group mention arguments restrict timeout, trigger token and evidence output
  ---
  duration_ms: 1.2772
  type: 'test'
  ...
# Subtest: group mention reply uses passive text syntax with the current callback sender
ok 27 - group mention reply uses passive text syntax with the current callback sender
  ---
  duration_ms: 1.5528
  type: 'test'
  ...
# Subtest: stream reply uses the same passive mention syntax in a finished SDK-supported stream body
ok 28 - stream reply uses the same passive mention syntax in a finished SDK-supported stream body
  ---
  duration_ms: 0.1863
  type: 'test'
  ...
# Subtest: acknowledged group reply reuses the triggering frame and records only hashes and field shape
ok 29 - acknowledged group reply reuses the triggering frame and records only hashes and field shape
  ---
  duration_ms: 2.0964
  type: 'test'
  ...
# Subtest: probe ignores non-group and wrong-token messages before handling the matching group callback
ok 30 - probe ignores non-group and wrong-token messages before handling the matching group callback
  ---
  duration_ms: 0.3841
  type: 'test'
  ...
# Subtest: provider rejection is a completed negative capability result and excludes SDK error text
ok 31 - provider rejection is a completed negative capability result and excludes SDK error text
  ---
  duration_ms: 0.4017
  type: 'test'
  ...
# Subtest: capture builder never serializes raw callback or reply values
ok 32 - capture builder never serializes raw callback or reply values
  ---
  duration_ms: 0.2041
  type: 'test'
  ...
# Subtest: card arguments enforce local evidence, trigger chat type, and the five-second late boundary
ok 33 - card arguments enforce local evidence, trigger chat type, and the five-second late boundary
  ---
  duration_ms: 1.2531
  type: 'test'
  ...
# Subtest: card shape has a unique caller-owned task id and both required actions
ok 34 - card shape has a unique caller-owned task id and both required actions
  ---
  duration_ms: 1.4567
  type: 'test'
  ...
# Subtest: fast button event updates the matching task id within five seconds without persisting raw input
ok 35 - fast button event updates the matching task id within five seconds without persisting raw input
  ---
  duration_ms: 5.3502
  type: 'test'
  ...
# Subtest: duplicate mode records the second same-user same-action callback and preserves buttons until then
ok 36 - duplicate mode records the second same-user same-action callback and preserves buttons until then
  ---
  duration_ms: 1.0661
  type: 'test'
  ...
# Subtest: late mode calls update after the limit and records a platform rejection as an explicit expired-behavior result
ok 37 - late mode calls update after the limit and records a platform rejection as an explicit expired-behavior result
  ---
  duration_ms: 1.1218
  type: 'test'
  ...
# Subtest: a task-id mismatch is safely recorded with field names and hashes but never updates a foreign card
ok 38 - a task-id mismatch is safely recorded with field names and hashes but never updates a foreign card
  ---
  duration_ms: 0.9679
  type: 'test'
  ...
# Subtest: reply arguments only accept registered scenarios and evidence output paths
ok 39 - reply arguments only accept registered scenarios and evidence output paths
  ---
  duration_ms: 1.4903
  type: 'test'
  ...
# Subtest: welcome, Markdown, stream, and media builders use the documented reply forms
ok 40 - welcome, Markdown, stream, and media builders use the documented reply forms
  ---
  duration_ms: 3.052
  type: 'test'
  ...
# Subtest: welcome replies accept an enter_chat event even when its chattype is omitted
ok 41 - welcome replies accept an enter_chat event even when its chattype is omitted
  ---
  duration_ms: 2.5899
  type: 'test'
  ...
# Subtest: stream refresh reuses one callback and stream id, then omits the body for matching feedback
ok 42 - stream refresh reuses one callback and stream id, then omits the body for matching feedback
  ---
  duration_ms: 4.161
  type: 'test'
  ...
# Subtest: Markdown reply is callback-bound and never serializes trigger text or identifiers
ok 43 - Markdown reply is callback-bound and never serializes trigger text or identifiers
  ---
  duration_ms: 0.514
  type: 'test'
  ...
# Subtest: file, image, and voice upload then reply through the callback-bound media interface
ok 44 - file, image, and voice upload then reply through the callback-bound media interface
  ---
  duration_ms: 1.4284
  type: 'test'
  ...
# Subtest: video echo downloads only in memory, reuploads with a safe filename, and replies with title and description
ok 45 - video echo downloads only in memory, reuploads with a safe filename, and replies with title and description
  ---
  duration_ms: 0.9416
  type: 'test'
  ...
# Subtest: provider rejection has a stable classification without recording provider error text
ok 46 - provider rejection has a stable classification without recording provider error text
  ---
  duration_ms: 0.4511
  type: 'test'
  ...
# Subtest: feedback empty-reply rejection is a completed negative capability result
ok 47 - feedback empty-reply rejection is a completed negative capability result
  ---
  duration_ms: 3.2441
  type: 'test'
  ...
# Subtest: G0-007 defaults to a 4 hour 30 minute Windows-native soak and keeps Phase boundaries
ok 48 - G0-007 defaults to a 4 hour 30 minute Windows-native soak and keeps Phase boundaries
  ---
  duration_ms: 1.4951
  type: 'test'
  ...
# Subtest: run id is opaque and deterministic under an injected clock
ok 49 - run id is opaque and deterministic under an injected clock
  ---
  duration_ms: 0.2118
  type: 'test'
  ...
# Subtest: reconnect recovery, resource samples, and message replay stay content-free
ok 50 - reconnect recovery, resource samples, and message replay stay content-free
  ---
  duration_ms: 2.0573
  type: 'test'
  ...
# Subtest: a completed requested soak does not satisfy the 4 hour 30 minute Gate duration when shortened
ok 51 - a completed requested soak does not satisfy the 4 hour 30 minute Gate duration when shortened
  ---
  duration_ms: 0.4037
  type: 'test'
  ...
# Subtest: G0-008 closure preserves completed Gate 0 and P1 facts independently of the moving P2 frontier
ok 52 - G0-008 closure preserves completed Gate 0 and P1 facts independently of the moving P2 frontier
  ---
  duration_ms: 3.6062
  type: 'test'
  ...
# Subtest: G0-008 report covers every completed Gate 0 evidence source and retains limits
ok 53 - G0-008 report covers every completed Gate 0 evidence source and retains limits
  ---
  duration_ms: 2.8191
  type: 'test'
  ...
# Subtest: the capability-freeze ADR is accepted and does not skip P1-001
ok 54 - the capability-freeze ADR is accepted and does not skip P1-001
  ---
  duration_ms: 1.97
  type: 'test'
  ...
# Subtest: the documented 512 KiB plan covers 3,920,958 bytes in eight ordered chunks
ok 55 - the documented 512 KiB plan covers 3,920,958 bytes in eight ordered chunks
  ---
  duration_ms: 1.9349
  type: 'test'
  ...
# Subtest: test-only padding creates an exact target-sized MP4 without retaining an original filename
ok 56 - test-only padding creates an exact target-sized MP4 without retaining an original filename
  ---
  duration_ms: 0.6123
  type: 'test'
  ...
# Subtest: layered upload sends init, every serial chunk, and finish with fresh request IDs
ok 57 - layered upload sends init, every serial chunk, and finish with fresh request IDs
  ---
  duration_ms: 44.0937
  type: 'test'
  ...
# Subtest: a rejected chunk prevents finish and returns an explicit stage result
ok 58 - a rejected chunk prevents finish and returns an explicit stage result
  ---
  duration_ms: 2.9526
  type: 'test'
  ...
# Subtest: the probe downloads in memory, completes the layer sequence, then issues one callback-bound reply
ok 59 - the probe downloads in memory, completes the layer sequence, then issues one callback-bound reply
  ---
  duration_ms: 4.5576
  type: 'test'
  ...
# Subtest: arguments remain restricted to the G0 evidence directory and 10 MiB provider limit
ok 60 - arguments remain restricted to the G0 evidence directory and 10 MiB provider limit
  ---
  duration_ms: 0.2699
  type: 'test'
  ...
# Subtest: validates and redacts a Webhook URL without exposing its key
ok 61 - validates and redacts a Webhook URL without exposing its key
  ---
  duration_ms: 1.0962
  type: 'test'
  ...
# Subtest: builds the documented text, markdown, media, news, and card payload forms
ok 62 - builds the documented text, markdown, media, news, and card payload forms
  ---
  duration_ms: 2.375
  type: 'test'
  ...
# Subtest: creates bounded in-memory image, file, and AMR fixtures and documented multipart headers
ok 63 - creates bounded in-memory image, file, and AMR fixtures and documented multipart headers
  ---
  duration_ms: 1.19
  type: 'test'
  ...
# Subtest: records only safe live-probe evidence when every provider reply is accepted
ok 64 - records only safe live-probe evidence when every provider reply is accepted
  ---
  duration_ms: 45.0354
  type: 'test'
  ...
# Subtest: P1 configuration accepts Pilot-only dependencies and produces a secret-free summary
ok 65 - P1 configuration accepts Pilot-only dependencies and produces a secret-free summary
  ---
  duration_ms: 2.1786
  type: 'test'
  ...
# Subtest: P1 configuration rejects missing, cross-phase, and unapproved public-edge settings
ok 66 - P1 configuration rejects missing, cross-phase, and unapproved public-edge settings
  ---
  duration_ms: 0.7628
  type: 'test'
  ...
# Subtest: preflight output and CLI options do not expose configuration secrets
ok 67 - preflight output and CLI options do not expose configuration secrets
  ---
  duration_ms: 0.4422
  type: 'test'
  ...
# Subtest: the Pilot foundation health endpoint starts and stops without business routes
ok 68 - the Pilot foundation health endpoint starts and stops without business routes
  ---
  duration_ms: 43.8626
  type: 'test'
  ...
# Subtest: text Frame becomes an SDK-independent normalized message
ok 69 - text Frame becomes an SDK-independent normalized message
  ---
  duration_ms: 3.7977
  type: 'test'
  ...
# Subtest: image Frame exposes only an opaque media download reference
ok 70 - image Frame exposes only an opaque media download reference
  ---
  duration_ms: 0.8661
  type: 'test'
  ...
# Subtest: mixed Frame preserves text and image ordering in one normalized message
ok 71 - mixed Frame preserves text and image ordering in one normalized message
  ---
  duration_ms: 0.4637
  type: 'test'
  ...
# Subtest: replayed Frame keeps one durable idempotency key without Adapter-side dropping
ok 72 - replayed Frame keeps one durable idempotency key without Adapter-side dropping
  ---
  duration_ms: 0.2714
  type: 'test'
  ...
# Subtest: illegal Frame returns a stable, non-retryable and secret-free error
ok 73 - illegal Frame returns a stable, non-retryable and secret-free error
  ---
  duration_ms: 0.1936
  type: 'test'
  ...
# Subtest: invalid Adapter receive time returns a stable error instead of throwing
ok 74 - invalid Adapter receive time returns a stable error instead of throwing
  ---
  duration_ms: 0.1936
  type: 'test'
  ...
# Subtest: text that exceeds the contract only after normalization fails closed
ok 75 - text that exceeds the contract only after normalization fails closed
  ---
  duration_ms: 0.9757
  type: 'test'
  ...
# Subtest: text incompatible with the Phase 1 PostgreSQL boundary fails closed
ok 76 - text incompatible with the Phase 1 PostgreSQL boundary fails closed
  ---
  duration_ms: 0.2276
  type: 'test'
  ...
# Subtest: non-message callback bodies are classified as unsupported before message-only fields
ok 77 - non-message callback bodies are classified as unsupported before message-only fields
  ---
  duration_ms: 0.1895
  type: 'test'
  ...
# Subtest: Frame envelope, identity and content validation use stable reasons
ok 78 - Frame envelope, identity and content validation use stable reasons
  ---
  duration_ms: 0.4709
  type: 'test'
  ...
# Subtest: Normalized Message JSON Schema matches the Adapter interface and excludes SDK secrets
ok 79 - Normalized Message JSON Schema matches the Adapter interface and excludes SDK secrets
  ---
  duration_ms: 1.7885
  type: 'test'
  ...
# Subtest: quoted text from the recorded Gate 0 shape is preserved without raw SDK fields
ok 80 - quoted text from the recorded Gate 0 shape is preserved without raw SDK fields
  ---
  duration_ms: 0.3157
  type: 'test'
  ...
# Subtest: Gate 0 verified file, voice and video Frames use the same normalized seam
ok 81 - Gate 0 verified file, voice and video Frames use the same normalized seam
  ---
  duration_ms: 0.4156
  type: 'test'
  ...
# Subtest: quoted media keeps an independent opaque reference
ok 82 - quoted media keeps an independent opaque reference
  ---
  duration_ms: 0.2445
  type: 'test'
  ...
# Subtest: persists one Channel Message and returns the original result on replay
ok 83 - persists one Channel Message and returns the original result on replay
  ---
  duration_ms: 119.5414
  type: 'test'
  ...
# Subtest: snapshots validated input before connection acquisition
ok 84 - snapshots validated input before connection acquisition
  ---
  duration_ms: 6.2157
  type: 'test'
  ...
# Subtest: concurrent duplicates execute first processing exactly once
ok 85 - concurrent duplicates execute first processing exactly once
  ---
  duration_ms: 128.4183
  type: 'test'
  ...
# Subtest: first-processing failure rolls back the Inbox row and permits a clean retry
ok 86 - first-processing failure rolls back the Inbox row and permits a clean retry
  ---
  duration_ms: 13.1604
  type: 'test'
  ...
# Subtest: non-plain processing result roots fail as processing errors
ok 87 - non-plain processing result roots fail as processing errors
  ---
  duration_ms: 16.4834
  type: 'test'
  ...
# Subtest: processing result snapshot rejects nested non-JSON runtime objects
ok 88 - processing result snapshot rejects nested non-JSON runtime objects
  ---
  duration_ms: 6.404
  type: 'test'
  ...
# Subtest: processing result validation never executes toJSON hooks
ok 89 - processing result validation never executes toJSON hooks
  ---
  duration_ms: 4.6264
  type: 'test'
  ...
# Subtest: processing result validation rejects Proxy toJSON substitution without executing it
ok 90 - processing result validation rejects Proxy toJSON substitution without executing it
  ---
  duration_ms: 4.4309
  type: 'test'
  ...
# Subtest: inherited toJSON pollution cannot transform an otherwise plain result
ok 91 - inherited toJSON pollution cannot transform an otherwise plain result
  ---
  duration_ms: 7.5262
  type: 'test'
  ...
# Subtest: processing result snapshot accepts nested plain JSON arrays
ok 92 - processing result snapshot accepts nested plain JSON arrays
  ---
  duration_ms: 6.168
  type: 'test'
  ...
# Subtest: first-processing callback cannot commit the Inbox transaction early
ok 93 - first-processing callback cannot commit the Inbox transaction early
  ---
  duration_ms: 5.1476
  type: 'test'
  ...
# Subtest: first-processing callback cannot change Inbox transaction characteristics
ok 94 - first-processing callback cannot change Inbox transaction characteristics
  ---
  duration_ms: 5.5719
  type: 'test'
  ...
# Subtest: comment-obfuscated transaction control remains blocked
ok 95 - comment-obfuscated transaction control remains blocked
  ---
  duration_ms: 5.0501
  type: 'test'
  ...
# Subtest: SET LOCAL cannot change the Inbox-owned transaction
ok 96 - SET LOCAL cannot change the Inbox-owned transaction
  ---
  duration_ms: 5.0725
  type: 'test'
  ...
# Subtest: session defaults cannot poison a pooled connection after Inbox commit
ok 97 - session defaults cannot poison a pooled connection after Inbox commit
  ---
  duration_ms: 57.6311
  type: 'test'
  ...
# Subtest: function-based session configuration is rejected before pooled connection reuse
ok 98 - function-based session configuration is rejected before pooled connection reuse
  ---
  duration_ms: 62.9938
  type: 'test'
  ...
# Subtest: ordinary Inbox use preserves caller-owned pool session baselines
ok 99 - ordinary Inbox use preserves caller-owned pool session baselines
  ---
  duration_ms: 162.9353
  type: 'test'
  ...
# Subtest: callback-style transaction queries are rejected before PostgreSQL execution
ok 100 - callback-style transaction queries are rejected before PostgreSQL execution
  ---
  duration_ms: 6.0915
  type: 'test'
  ...
# Subtest: unawaited transaction query failure remains a processing failure
ok 101 - unawaited transaction query failure remains a processing failure
  ---
  duration_ms: 8.7605
  type: 'test'
  ...
# Subtest: transaction view is revoked when first processing settles
ok 102 - transaction view is revoked when first processing settles
  ---
  duration_ms: 5.9176
  type: 'test'
  ...
# Subtest: a duplicate after a real process restart receives the committed result
ok 103 - a duplicate after a real process restart receives the committed result
  ---
  duration_ms: 427.606
  type: 'test'
  ...
# Subtest: temporary database unavailability returns a stable retryable error without processing
ok 104 - temporary database unavailability returns a stable retryable error without processing
  ---
  duration_ms: 2.8635
  type: 'test'
  ...
# Subtest: invalid privacy, retention, plaintext payload and non-contract message fields fail before database access
ok 105 - invalid privacy, retention, plaintext payload and non-contract message fields fail before database access
  ---
  duration_ms: 1.5602
  type: 'test'
  ...
# Subtest: privacy, retention and caller-encrypted raw payload are persisted without entering the result
ok 106 - privacy, retention and caller-encrypted raw payload are persisted without entering the result
  ---
  duration_ms: 7.324
  type: 'test'
  ...
# Subtest: migration fails closed when an existing Inbox lacks required constraints
ok 107 - migration fails closed when an existing Inbox lacks required constraints
  ---
  duration_ms: 398.3199
  type: 'test'
  ...
# Subtest: migration reports the stable drift error before indexing a table with missing columns
ok 108 - migration reports the stable drift error before indexing a table with missing columns
  ---
  duration_ms: 328.8758
  type: 'test'
  ...
# Subtest: migration rejects a weakened check constraint that keeps the expected name
ok 109 - migration rejects a weakened check constraint that keeps the expected name
  ---
  duration_ms: 476.3065
  type: 'test'
  ...
# Subtest: migration rejects a deferrable idempotency constraint unusable by ON CONFLICT
ok 110 - migration rejects a deferrable idempotency constraint unusable by ON CONFLICT
  ---
  duration_ms: 461.7868
  type: 'test'
  ...
# Subtest: migration rejects a deferrable primary key unusable by later foreign keys
ok 111 - migration rejects a deferrable primary key unusable by later foreign keys
  ---
  duration_ms: 368.4732
  type: 'test'
  ...
# Subtest: migration rejects a same-name hash index that cannot serve retention range scans
ok 112 - migration rejects a same-name hash index that cannot serve retention range scans
  ---
  duration_ms: 574.3938
  type: 'test'
  ...
# Subtest: migration rejects an extra check constraint outside the frozen set
ok 113 - migration rejects an extra check constraint outside the frozen set
  ---
  duration_ms: 618.4464
  type: 'test'
  ...
# Subtest: migration rejects an extra unique constraint that changes write semantics
ok 114 - migration rejects an extra unique constraint that changes write semantics
  ---
  duration_ms: 544.3009
  type: 'test'
  ...
# Subtest: migration rejects a generated column that breaks explicit Inbox writes
ok 115 - migration rejects a generated column that breaks explicit Inbox writes
  ---
  duration_ms: 675.7698
  type: 'test'
  ...
# Subtest: migration is reentrant when the existing Inbox matches the frozen catalog
ok 116 - migration is reentrant when the existing Inbox matches the frozen catalog
  ---
  duration_ms: 883.5095
  type: 'test'
  ...
# Subtest: migration is limited to the P1-003 Channel Inbox and freezes the database constraints
ok 117 - migration is limited to the P1-003 Channel Inbox and freezes the database constraints
  ---
  duration_ms: 1.1488
  type: 'test'
  ...
# Subtest: creates one Service Intake, primary message relation and received audit event
ok 118 - creates one Service Intake, primary message relation and received audit event
  ---
  duration_ms: 234.8606
  type: 'test'
  ...
# Subtest: aggregates multiple supplements into one Intake without creating a Ticket
ok 119 - aggregates multiple supplements into one Intake without creating a Ticket
  ---
  duration_ms: 56.007
  type: 'test'
  ...
# Subtest: explicit new-report intent starts a new Intake inside the 90-second window
ok 120 - explicit new-report intent starts a new Intake inside the 90-second window
  ---
  duration_ms: 23.7829
  type: 'test'
  ...
# Subtest: an explicit reference to another ticket closes the current aggregation window
ok 121 - an explicit reference to another ticket closes the current aggregation window
  ---
  duration_ms: 51.2483
  type: 'test'
  ...
# Subtest: pure image creates a waiting Intake and emits a clarification audit event
ok 122 - pure image creates a waiting Intake and emits a clarification audit event
  ---
  duration_ms: 14.5325
  type: 'test'
  ...
# Subtest: a description clarifies the waiting image Intake instead of creating another Intake
ok 123 - a description clarifies the waiting image Intake instead of creating another Intake
  ---
  duration_ms: 28.6921
  type: 'test'
  ...
# Subtest: concurrent distinct messages in one context aggregate into exactly one Intake
ok 124 - concurrent distinct messages in one context aggregate into exactly one Intake
  ---
  duration_ms: 338.5431
  type: 'test'
  ...
# Subtest: reversed lock acquisition still aggregates bounded timestamp inversion and preserves valid update time
ok 125 - reversed lock acquisition still aggregates bounded timestamp inversion and preserves valid update time
  ---
  duration_ms: 38.0065
  type: 'test'
  ...
# Subtest: reversed lock acquisition never crosses an explicit new-context boundary
ok 126 - reversed lock acquisition never crosses an explicit new-context boundary
  ---
  duration_ms: 135.8092
  type: 'test'
  ...
# Subtest: classifies the documented request types without AI and honors incident negation
ok 127 - classifies the documented request types without AI and honors incident negation
  ---
  duration_ms: 177.3164
  type: 'test'
  ...
# Subtest: standalone thanks is CHATTER without an unnecessary clarification request
ok 128 - standalone thanks is CHATTER without an unnecessary clarification request
  ---
  duration_ms: 15.7275
  type: 'test'
  ...
# Subtest: aggregate privacy is strongest, retention is earliest, and Inbox snapshots contain no report summary
ok 129 - aggregate privacy is strongest, retention is earliest, and Inbox snapshots contain no report summary
  ---
  duration_ms: 31.242
  type: 'test'
  ...
# Subtest: includes exactly 90 seconds and starts a new Intake after the window
ok 130 - includes exactly 90 seconds and starts a new Intake after the window
  ---
  duration_ms: 61.7637
  type: 'test'
  ...
# Subtest: different senders and conversations stay separate while direct chat maps to WECOM_DIRECT
ok 131 - different senders and conversations stay separate while direct chat maps to WECOM_DIRECT
  ---
  duration_ms: 40.5472
  type: 'test'
  ...
# Subtest: Channel Message replay returns the original Intake result without duplicate relations or events
ok 132 - Channel Message replay returns the original Intake result without duplicate relations or events
  ---
  duration_ms: 29.6909
  type: 'test'
  ...
# Subtest: downstream failure rolls back Channel Message, Intake, relations and events before a clean retry
ok 133 - downstream failure rolls back Channel Message, Intake, relations and events before a clean retry
  ---
  duration_ms: 24.4002
  type: 'test'
  ...
# Subtest: migration fails closed on legacy Inbox summaries and upgrades pre-redacted aggregates
ok 134 - migration fails closed on legacy Inbox summaries and upgrades pre-redacted aggregates
  ---
  duration_ms: 345.8237
  type: 'test'
  ...
# Subtest: migration runner exposes only the exact legacy-remediation failure as non-retryable
ok 135 - migration runner exposes only the exact legacy-remediation failure as non-retryable
  ---
  duration_ms: 0.4856
  type: 'test'
  ...
# Subtest: migration is limited to Service Intake, message relations and Intake audit events
ok 136 - migration is limited to Service Intake, message relations and Intake audit events
  ---
  duration_ms: 2.0388
  type: 'test'
  ...
# Subtest: Service Intake JSON Schema freezes the domain boundary and P1-004 version semantics
ok 137 - Service Intake JSON Schema freezes the domain boundary and P1-004 version semantics
  ---
  duration_ms: 1.8453
  type: 'test'
  ...
# Subtest: Service Intake migration is re-entrant
ok 138 - Service Intake migration is re-entrant
  ---
  duration_ms: 6.2283
  type: 'test'
  ...
# Subtest: invalid aggregation windows fail before a processor can access a transaction
ok 139 - invalid aggregation windows fail before a processor can access a transaction
  ---
  duration_ms: 0.5828
  type: 'test'
  ...
# Subtest: an explicit report creates one idempotent Pilot Ticket without AI or Hospital Tickets
ok 140 - an explicit report creates one idempotent Pilot Ticket without AI or Hospital Tickets
  ---
  duration_ms: 166.6132
  type: 'test'
  ...
# Subtest: a downstream failure rolls back the Intake-to-Ticket relationship before retry
ok 141 - a downstream failure rolls back the Intake-to-Ticket relationship before retry
  ---
  duration_ms: 34.6211
  type: 'test'
  ...
# Subtest: a Ticket number collision fails explicitly and leaves the second Intake unlinked
ok 142 - a Ticket number collision fails explicitly and leaves the second Intake unlinked
  ---
  duration_ms: 42.9363
  type: 'test'
  ...
# Subtest: the database rejects a Ticket when its source Intake does not point back to it
ok 143 - the database rejects a Ticket when its source Intake does not point back to it
  ---
  duration_ms: 19.5604
  type: 'test'
  ...
# Subtest: explicit Ticket Actions enforce legal transitions, versions, and an ordered audit timeline
ok 144 - explicit Ticket Actions enforce legal transitions, versions, and an ordered audit timeline
  ---
  duration_ms: 194.7195
  type: 'test'
  ...
# Subtest: concurrent handlers cannot both accept the same queued Ticket
ok 145 - concurrent handlers cannot both accept the same queued Ticket
  ---
  duration_ms: 68.168
  type: 'test'
  ...
# Subtest: Phase 1 rejects an Incident-link action until the Phase 2 Incident fact exists
ok 146 - Phase 1 rejects an Incident-link action until the Phase 2 Incident fact exists
  ---
  duration_ms: 61.9824
  type: 'test'
  ...
# Subtest: state, Ticket Event, Outbox, and target deliveries commit together while delivery failures retry independently
ok 147 - state, Ticket Event, Outbox, and target deliveries commit together while delivery failures retry independently
  ---
  duration_ms: 632.3688
  type: 'test'
  ...
# Subtest: a leased Delivery is not sent twice by concurrent Workers and terminal failures become dead letters
ok 148 - a leased Delivery is not sent twice by concurrent Workers and terminal failures become dead letters
  ---
  duration_ms: 275.4244
  type: 'test'
  ...
# Subtest: an Outbox failure rolls back the Ticket state and its Ticket Event
ok 149 - an Outbox failure rolls back the Ticket state and its Ticket Event
  ---
  duration_ms: 51.4713
  type: 'test'
  ...
# Subtest: the default notification matrix keeps internal notes off reporter delivery and the Worker rate-limits each target
ok 150 - the default notification matrix keeps internal notes off reporter delivery and the Worker rate-limits each target
  ---
  duration_ms: 269.1346
  type: 'test'
  ...
# Subtest: first acknowledgement is sent only after commit and a reconnect replay does not create or send twice
ok 151 - first acknowledgement is sent only after commit and a reconnect replay does not create or send twice
  ---
  duration_ms: 275.8952
  type: 'test'
  ...
# Subtest: temporary delivery failure preserves a real Ticket for retry, while a non-report never fabricates a Ticket number
ok 152 - temporary delivery failure preserves a real Ticket for retry, while a non-report never fabricates a Ticket number
  ---
  duration_ms: 75.0882
  type: 'test'
  ...
# Subtest: Pilot roles isolate teams, enable audited handling, and keep internal notes out of reporter views
ok 153 - Pilot roles isolate teams, enable audited handling, and keep internal notes out of reporter views
  ---
  duration_ms: 289.6812
  type: 'test'
  ...
# Subtest: the minimum local Pilot workbench exposes an injected authenticated mobile-friendly work view
ok 154 - the minimum local Pilot workbench exposes an injected authenticated mobile-friendly work view
  ---
  duration_ms: 98.2467
  type: 'test'
  ...
# Subtest: supplement, card confirmation, duplicate card protection, close, and reopen preserve a real Ticket lifecycle
ok 155 - supplement, card confirmation, duplicate card protection, close, and reopen preserve a real Ticket lifecycle
  ---
  duration_ms: 453.011
  type: 'test'
  ...
# Subtest: the complete lifecycle processor exposes created delivery ids for post-commit acknowledgement
ok 156 - the complete lifecycle processor exposes created delivery ids for post-commit acknowledgement
  ---
  duration_ms: 35.2421
  type: 'test'
  ...
# Subtest: expired cards do not mutate Tickets and resolved Tickets close automatically with an explicit non-user reason
ok 157 - expired cards do not mutate Tickets and resolved Tickets close automatically with an explicit non-user reason
  ---
  duration_ms: 91.3238
  type: 'test'
  ...
# Subtest: P1-011 parses only explicit backup drill modes and keeps credentials out of utility arguments
ok 158 - P1-011 parses only explicit backup drill modes and keeps credentials out of utility arguments
  ---
  duration_ms: 4.8221
  type: 'test'
  ...
# Subtest: P1-011 backup check validates controls without writing credential or encryption-key values
ok 159 - P1-011 backup check validates controls without writing credential or encryption-key values
  ---
  duration_ms: 214.7631
  type: 'test'
  ...
# Subtest: P1-011 emits a fixed restore alert and failure context when a drill cannot start
ok 160 - P1-011 emits a fixed restore alert and failure context when a drill cannot start
  ---
  duration_ms: 28.5941
  type: 'test'
  ...
# Subtest: P1-011 keeps a logical backup encrypted at rest while restoring the exact stream
ok 161 - P1-011 keeps a logical backup encrypted at rest while restoring the exact stream
  ---
  duration_ms: 29.4498
  type: 'test'
  ...
# Subtest: P1-011 authenticates an encrypted artifact before exposing any plaintext to the restore consumer
ok 162 - P1-011 authenticates an encrypted artifact before exposing any plaintext to the restore consumer
  ---
  duration_ms: 14.7186
  type: 'test'
  ...
# Subtest: P1-011 writes only a redacted, structured operational log record
ok 163 - P1-011 writes only a redacted, structured operational log record
  ---
  duration_ms: 68.7403
  type: 'test'
  ...
# Subtest: P1-011 keeps a persisted core intake available when optional dependencies fail
ok 164 - P1-011 keeps a persisted core intake available when optional dependencies fail
  ---
  duration_ms: 3.0946
  type: 'test'
  ...
# Subtest: P1-011 composes the operational boundary around the real Inbox to Pilot Ticket lifecycle
ok 165 - P1-011 composes the operational boundary around the real Inbox to Pilot Ticket lifecycle
  ---
  duration_ms: 125.4435
  type: 'test'
  ...
# Subtest: P1-011 alerts with stable codes without carrying the rejected sensitive values
ok 166 - P1-011 alerts with stable codes without carrying the rejected sensitive values
  ---
  duration_ms: 0.9575
  type: 'test'
  ...
# Subtest: P1-011 serves the Pilot workbench under a same-origin CSP without inline code
ok 167 - P1-011 serves the Pilot workbench under a same-origin CSP without inline code
  ---
  duration_ms: 36.4291
  type: 'test'
  ...
# Subtest: P1-011 preserves safe backup and restore checkpoints in an admin-only immutable audit trail
ok 168 - P1-011 preserves safe backup and restore checkpoints in an admin-only immutable audit trail
  ---
  duration_ms: 58.4799
  type: 'test'
  ...
# Subtest: P1-012 accepts only an explicit check or approved live scenario
ok 169 - P1-012 accepts only an explicit check or approved live scenario
  ---
  duration_ms: 6.4785
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"a5a31c2bc0dd0cb87c3bcc9a47fc29aa","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING"}}
# Subtest: P1-012 recovers only an explicitly approved, stale, terminated-local reply-probe evidence claim and audits it
ok 170 - P1-012 recovers only an explicitly approved, stale, terminated-local reply-probe evidence claim and audits it
  ---
  duration_ms: 41.6492
  type: 'test'
  ...
# Subtest: P1-012 restores the stale claim and releases the recovery guard if its recovery audit cannot append
ok 171 - P1-012 restores the stale claim and releases the recovery guard if its recovery audit cannot append
  ---
  duration_ms: 16.2214
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
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"fa14b9c8c7f02827d7fc75d881c53eb1","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING","resumed":true}}
# Subtest: P1-012 retains a truthful quarantine audit and blocks replies when quarantine cleanup fails, then resumes safely
ok 172 - P1-012 retains a truthful quarantine audit and blocks replies when quarantine cleanup fails, then resumes safely
  ---
  duration_ms: 56.9322
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
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"1954adbccfbf489ebc6ab5e8030aad96","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING"}}
# Subtest: P1-012 atomically takes over a stale recovery guard while a live reply and second recovery remain blocked
ok 173 - P1-012 atomically takes over a stale recovery guard while a live reply and second recovery remain blocked
  ---
  duration_ms: 37.5406
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
  duration_ms: 23.1201
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
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"9869a625b0ba838f1c3b5c5c2fdadd09","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING"}}
# Subtest: P1-012 recovery guard blocks concurrent recovery and live reply acquisition until recovery audit completes
ok 175 - P1-012 recovery guard blocks concurrent recovery and live reply acquisition until recovery audit completes
  ---
  duration_ms: 26.2387
  type: 'test'
  ...
# Subtest: P1-012 validates WSS and Pilot configuration without requiring a public listener
ok 176 - P1-012 validates WSS and Pilot configuration without requiring a public listener
  ---
  duration_ms: 0.6887
  type: 'test'
  ...
# Subtest: P1-012 check emits a redacted readiness record with no public-IP prerequisite
ok 177 - P1-012 check emits a redacted readiness record with no public-IP prerequisite
  ---
  duration_ms: 318.2682
  type: 'test'
  ...
# Subtest: P1-012 marks an active delivery without an explicit provider ACK as retryable
ok 178 - P1-012 marks an active delivery without an explicit provider ACK as retryable
  ---
  duration_ms: 0.5182
  type: 'test'
  ...
# Subtest: P1-012 uses the Gate-0-verified completed stream shape for a group passive reply
ok 179 - P1-012 uses the Gate-0-verified completed stream shape for a group passive reply
  ---
  duration_ms: 0.3527
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
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_REPLY_PROBE","probe":{"exact_token":true,"addressing":"WECOM_MENTION_PREFIX","database_write":false,"run_id":"a47cbdbd9fbf6b190cecc19e997b7bf3"},"passive_reply":{"operation":"aibot_respond_msg_stream","attempted":true,"acknowledged":true,"provider_errcode":0,"outcome":"ACKED"}}
# Subtest: P1-012 keeps a short reply probe exact-scoped and out of the Pilot database
ok 180 - P1-012 keeps a short reply probe exact-scoped and out of the Pilot database
  ---
  duration_ms: 17.142
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
  duration_ms: 62.0827
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_client_display_observed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT","source_result_hash":"a98b043eaf220dfa7f8a6d15a1fdb998","provider_reply_acknowledged":true,"database_write":true,"ticket_created":true,"intake_status":"TICKET_CREATED","observer":"configured_test_account","observation":"VISIBLE"}
# Subtest: P1-012 records one HMAC-linked client observation for a successful Ticket-creating group text
ok 182 - P1-012 records one HMAC-linked client observation for a successful Ticket-creating group text
  ---
  duration_ms: 14.8298
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_shared_delivery_reconciled","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"SHARED_DELIVERY_RECONCILIATION","database_mutation":false,"synthetic_signature":"ACK_PREFIX","delivery_count":2,"ticket_count":1,"attempt_count":3,"retry_attempts":1,"synthetic_sent_attempts":2,"channels":{"pilot_team":1,"wecom_direct":1},"audit_history_preserved":true,"excluded_from_real_wecom_delivery_evidence":true,"reconciliation_status":"IDENTIFIED_AND_EXCLUDED"}
# Subtest: P1-012 reconciles the exact synthetic shared Delivery footprint without mutating database facts
ok 183 - P1-012 reconciles the exact synthetic shared Delivery footprint without mutating database facts
  ---
  duration_ms: 5.374
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_client_display_observed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","source_result_hash":"4820f6a54a47a36001fef143b95d984c","source_addressing":"WECOM_MENTION_PREFIX","provider_reply_acknowledged":true,"database_write":false,"observer":"configured_test_account","observation":"VISIBLE"}
# Subtest: P1-012 serializes concurrent client observations for one reply-probe source
ok 184 - P1-012 serializes concurrent client observations for one reply-probe source
  ---
  duration_ms: 21.5399
  type: 'test'
  ...
# Subtest: P1-012 rejects a client observation whose source becomes stale before it claims the evidence chain
ok 185 - P1-012 rejects a client observation whose source becomes stale before it claims the evidence chain
  ---
  duration_ms: 5.2022
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
  duration_ms: 25.0281
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# Subtest: P1-012 prevents a reply probe from starting after an earlier evidence failure has won
ok 187 - P1-012 prevents a reply probe from starting after an earlier evidence failure has won
  ---
  duration_ms: 26.198
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_REPLY_PROBE","probe":{"exact_token":true,"addressing":"BARE","database_write":false,"run_id":"9bf2c13cafc57edf63d5953a8948532d"},"passive_reply":{"operation":"aibot_respond_msg_stream","attempted":true,"acknowledged":true,"provider_errcode":0,"outcome":"ACKED"}}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_EVIDENCE_WRITE_FAILED"}
# Subtest: P1-012 records an in-flight reply probe before its deferred terminal failure
ok 188 - P1-012 records an in-flight reply probe before its deferred terminal failure
  ---
  duration_ms: 19.0079
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_LIVE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN"}
# Subtest: P1-012 hard-times-out a permanently pending reply probe with an explicit unknown side-effect state
ok 189 - P1-012 hard-times-out a permanently pending reply probe with an explicit unknown side-effect state
  ---
  duration_ms: 13.7365
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_LIVE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN"}
# Subtest: P1-012 suppresses a late reply-probe success record after its hard timeout
ok 190 - P1-012 suppresses a late reply-probe success record after its hard timeout
  ---
  duration_ms: 46.2735
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_EVIDENCE_WRITE_FAILED"}
# Subtest: P1-012 prevents a failed group-id capture run from updating the local group id
ok 191 - P1-012 prevents a failed group-id capture run from updating the local group id
  ---
  duration_ms: 5.3796
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_applied","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"side_effect_state":"APPLIED","configuration_updated":true,"group_id_hash":"9aa6151c5e05da82086348a14803d96d"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_EVIDENCE_WRITE_FAILED","side_effect_state":"APPLIED","configuration_updated":true,"group_id_hash":"9aa6151c5e05da82086348a14803d96d"}
# Subtest: P1-012 records an in-flight group-id capture before its deferred terminal failure
ok 192 - P1-012 records an in-flight group-id capture before its deferred terminal failure
  ---
  duration_ms: 29.2269
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
  duration_ms: 9.2046
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_GROUP_ID_CAPTURE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN","group_id_hash":"eac76feda981759f44d849e3e50e5a7e","reconciliation_required":true}
# Subtest: P1-012 hard-times-out a pending group-id capture and aborts its local update seam
ok 194 - P1-012 hard-times-out a pending group-id capture and aborts its local update seam
  ---
  duration_ms: 16.0939
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_GROUP_ID_CAPTURE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN","group_id_hash":"eac76feda981759f44d849e3e50e5a7e","reconciliation_required":true}
# Subtest: P1-012 leaves a late non-cooperative capture update as reconcilable unknown without a late applied record
ok 195 - P1-012 leaves a late non-cooperative capture update as reconcilable unknown without a late applied record
  ---
  duration_ms: 23.1143
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_error","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT","error_code":"ECONNRESET"}
# {"test_id":"P1-012","event":"p1_012_wss_disconnected","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reconnecting","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reauthenticated","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_TEXT","core":{"accepted":true},"passive_reply":{"acknowledged":true},"run_id":"5627284e8413d3bc7c38c30f35511fcc"}
# Subtest: P1-012 waits through a transient SDK disconnect and records only safe reconnect evidence
ok 196 - P1-012 waits through a transient SDK disconnect and records only safe reconnect evidence
  ---
  duration_ms: 14.8896
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
  duration_ms: 15.2316
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
  duration_ms: 273.4969
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT","timeout_ms":10000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_disconnected","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reconnect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reauthenticated","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_post_reconnect_message_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT","reauthenticated":true}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"RECONNECT_GROUP_TEXT","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"SENT"},"run_id":"84278b7e7e0256b19d2f53e182fe672b","reconnect":{"reauthenticated_before_callback":true}}
# Subtest: P1-012 forces reauthentication before accepting one scoped group-text callback
ok 199 - P1-012 forces reauthentication before accepting one scoped group-text callback
  ---
  duration_ms: 282.5691
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
# {"test_id":"P1-012","event":"p1_012_live_burst_result","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100","run_id":"0b89ac031c03c0d69c37ed1f254ecb72","expected_count":100,"callback_count":100,"unique_message_count":100,"accepted_within_target_count":100,"duplicate_callback_count":0,"database":{"inbox_count":100,"intake_count":100,"ticket_count":100,"outbox_count":100,"delivery_count":200,"tickets_with_invalid_outbox_count":0,"tickets_with_invalid_delivery_count":0},"zero_lost_tickets":true,"zero_duplicate_tickets":true,"notifications_traceable":true,"collection_elapsed_ms":133,"outcome":"PASSED"}
# Subtest: P1-012 completes a strictly sequenced 100-message live burst only after database fact reconciliation
ok 200 - P1-012 completes a strictly sequenced 100-message live burst only after database fact reconciliation
  ---
  duration_ms: 141.38
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":1,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":2,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":3,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":4,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":5,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":6,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":7,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":8,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":9,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":10,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":11,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":12,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":13,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":14,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":15,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":16,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":17,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":18,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":19,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":20,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":21,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":22,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":23,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":24,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":25,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":26,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":27,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":28,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":29,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":30,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":31,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":32,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":33,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":34,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":35,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":36,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":37,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":38,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":39,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":40,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":41,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":42,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":43,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":44,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":45,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":46,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":47,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":48,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":49,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":50,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":51,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":52,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":53,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":54,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":55,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":56,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":57,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":58,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":59,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":60,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":61,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":62,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":63,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":64,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":65,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":66,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":67,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":68,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":69,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":70,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":71,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":72,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":73,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":74,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":75,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":76,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":77,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":78,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":79,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":80,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":81,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":82,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":83,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":84,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":85,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":86,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":87,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":88,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":89,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":90,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":91,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":92,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":93,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":94,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":95,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":96,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":97,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":98,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":99,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":100,"run_id":"a8f85d39296f2c20478a6f69001058c4"}
# {"test_id":"P1-012","event":"p1_012_live_burst_result","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100","run_id":"a8f85d39296f2c20478a6f69001058c4","expected_count":100,"callback_count":100,"unique_message_count":100,"accepted_within_target_count":100,"duplicate_callback_count":0,"database":{"inbox_count":100,"intake_count":100,"ticket_count":100,"outbox_count":100,"delivery_count":200,"tickets_with_invalid_outbox_count":2,"tickets_with_invalid_delivery_count":2},"zero_lost_tickets":true,"zero_duplicate_tickets":true,"notifications_traceable":false,"collection_elapsed_ms":132,"outcome":"FAILED"}
# Subtest: P1-012 burst fails closed when global notification totals mask per-ticket gaps
ok 201 - P1-012 burst fails closed when global notification totals mask per-ticket gaps
  ---
  duration_ms: 140.7752
  type: 'test'
  ...
# Subtest: P1-012 exercises the real Pilot core under duplicate, image, burst, Outbox failure, and AI-off conditions
ok 202 - P1-012 exercises the real Pilot core under duplicate, image, burst, Outbox failure, and AI-off conditions
  ---
  duration_ms: 1244.9804
  type: 'test'
  ...
# Subtest: P1-012 handles a scoped group text frame through Intake then a safe reply and Delivery
ok 203 - P1-012 handles a scoped group text frame through Intake then a safe reply and Delivery
  ---
  duration_ms: 9.1181
  type: 'test'
  ...
# Subtest: P1-012 records an image-degraded Intake without fabricating a Ticket
ok 204 - P1-012 records an image-degraded Intake without fabricating a Ticket
  ---
  duration_ms: 0.9281
  type: 'test'
  ...
# Subtest: P1-012 accepts an addressed group mixed image only when it contains the run token and an image
ok 205 - P1-012 accepts an addressed group mixed image only when it contains the run token and an image
  ---
  duration_ms: 1.0595
  type: 'test'
  ...
# Subtest: P1-012 ignores an unscoped group frame without calling any operational seam
ok 206 - P1-012 ignores an unscoped group frame without calling any operational seam
  ---
  duration_ms: 0.3502
  type: 'test'
  ...
# Subtest: P1-012 keeps a transient core failure safe and retryable without leaking the failure text
ok 207 - P1-012 keeps a transient core failure safe and retryable without leaking the failure text
  ---
  duration_ms: 0.6549
  type: 'test'
  ...
# Subtest: P1-012 keeps a thrown database fault out of the client reply and safe evidence
ok 208 - P1-012 keeps a thrown database fault out of the client reply and safe evidence
  ---
  duration_ms: 0.653
  type: 'test'
  ...
# Subtest: P1-012 requires an explicit successful provider receipt for a passive reply
ok 209 - P1-012 requires an explicit successful provider receipt for a passive reply
  ---
  duration_ms: 0.5831
  type: 'test'
  ...
# Subtest: P1-012 preserves a provider reply rejection code without keeping its message text
ok 210 - P1-012 preserves a provider reply rejection code without keeping its message text
  ---
  duration_ms: 0.603
  type: 'test'
  ...
# Subtest: P1-012 Go/No-Go requires real client observation but never a public IP for outbound WSS
ok 211 - P1-012 Go/No-Go requires real client observation but never a public IP for outbound WSS
  ---
  duration_ms: 0.4331
  type: 'test'
  ...
# Subtest: P1-012 WeCom burst UI plan is side-effect free and preserves the requested sequence range
ok 212 - P1-012 WeCom burst UI plan is side-effect free and preserves the requested sequence range
  ---
  duration_ms: 1057.9591
  type: 'test'
  ...
# Subtest: P1-012 WeCom burst UI driver fails closed on invalid ranges and ambiguous modes
ok 213 - P1-012 WeCom burst UI driver fails closed on invalid ranges and ambiguous modes
  ---
  duration_ms: 2374.1563
  type: 'test'
  ...
# Subtest: P1-012 WeCom burst UI driver retains fail-closed target, clipboard, stop, and reconciliation guards
ok 214 - P1-012 WeCom burst UI driver retains fail-closed target, clipboard, stop, and reconciliation guards
  ---
  duration_ms: 6.4658
  type: 'test'
  ...
# Subtest: P2-001 PostgreSQL contract is idempotent, isolated, and fail closed
ok 215 - P2-001 PostgreSQL contract is idempotent, isolated, and fail closed
  ---
  duration_ms: 1378.9011
  type: 'test'
  ...
# Subtest: all P2 conversation feature flags default to false
ok 216 - all P2 conversation feature flags default to false
  ---
  duration_ms: 2.3212
  type: 'test'
  ...
# Subtest: Thread identity separates single, group, and multiple bots without exposing raw ids in its key
ok 217 - Thread identity separates single, group, and multiple bots without exposing raw ids in its key
  ---
  duration_ms: 1.4785
  type: 'test'
  ...
# Subtest: Thread identity rejects malformed channel scope with a stable error
ok 218 - Thread identity rejects malformed channel scope with a stable error
  ---
  duration_ms: 0.6473
  type: 'test'
  ...
# Subtest: group Session scope isolates participants and Intakes
ok 219 - group Session scope isolates participants and Intakes
  ---
  duration_ms: 0.6441
  type: 'test'
  ...
# Subtest: Session boundary rules cover ended, explicit, different Intake, idle equality, and continuation
ok 220 - Session boundary rules cover ended, explicit, different Intake, idle equality, and continuation
  ---
  duration_ms: 0.8224
  type: 'test'
  ...
# Subtest: only auditable boundary reasons are accepted from callers
ok 221 - only auditable boundary reasons are accepted from callers
  ---
  duration_ms: 0.4229
  type: 'test'
  ...
# Subtest: Session lifecycle is OPEN/WAITING_USER with ENDED terminal
ok 222 - Session lifecycle is OPEN/WAITING_USER with ENDED terminal
  ---
  duration_ms: 0.2595
  type: 'test'
  ...
# Subtest: control modes fail closed, default HUMAN, and reserve AUTO for P2-010/P2-G4
ok 223 - control modes fail closed, default HUMAN, and reserve AUTO for P2-010/P2-G4
  ---
  duration_ms: 0.3511
  type: 'test'
  ...
# Subtest: generation and row versions advance only for unique invalidating changes
ok 224 - generation and row versions advance only for unique invalidating changes
  ---
  duration_ms: 0.2512
  type: 'test'
  ...
# Subtest: disabled guard does not invoke storage or external seams and raw failures stay hidden
ok 225 - disabled guard does not invoke storage or external seams and raw failures stay hidden
  ---
  duration_ms: 0.619
  type: 'test'
  ...
# Subtest: database failures map to stable public errors
ok 226 - database failures map to stable public errors
  ---
  duration_ms: 0.1794
  type: 'test'
  ...
# Subtest: P2-001 migration is limited to Thread and Session and reserves later tasks
ok 227 - P2-001 migration is limited to Thread and Session and reserves later tasks
  ---
  duration_ms: 7.2001
  type: 'test'
  ...
# Subtest: JSON Schemas, public OpenAPI view, and TypeScript declarations freeze safe vocabulary
ok 228 - JSON Schemas, public OpenAPI view, and TypeScript declarations freeze safe vocabulary
  ---
  duration_ms: 3.3567
  type: 'test'
  ...
# Subtest: P2-002 migration 011 first/repeat apply is exact and leaves P1/P2-001 unchanged
ok 229 - P2-002 migration 011 first/repeat apply is exact and leaves P1/P2-001 unchanged
  ---
  duration_ms: 1011.0463
  type: 'test'
  ...
# Subtest: P2-002 migration CLI runs only 011, is repeatable, and rolls check mode back
ok 230 - P2-002 migration CLI runs only 011, is repeatable, and rolls check mode back
  ---
  duration_ms: 3921.695
  type: 'test'
  ...
# {"child_process_runs":4,"child_exit_codes":[0,0,0,0],"preapply_check_created_tables":0,"migration_files_executed":1,"tables_added":3,"p1_p2_001_catalog_unchanged":true,"postapply_check_rolled_back":true,"temp_database_cleanup":true}
# Subtest: P2-002 migration CLI fails closed on incompatible read-only source dependencies
ok 231 - P2-002 migration CLI fails closed on incompatible read-only source dependencies
  ---
  duration_ms: 1066.7963
  type: 'test'
  ...
# {"child_exit_code":1,"stable_error":"P2_002_SCHEMA_DRIFT_REMEDIATION_REQUIRED","p2_tables_created":0,"temp_database_cleanup":true}
# Subtest: P2-002 migration 011 fails closed on missing column
ok 232 - P2-002 migration 011 fails closed on missing column
  ---
  duration_ms: 949.892
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on weakened CHECK constraint
ok 233 - P2-002 migration 011 fails closed on weakened CHECK constraint
  ---
  duration_ms: 843.519
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on wrong unique constraint columns
ok 234 - P2-002 migration 011 fails closed on wrong unique constraint columns
  ---
  duration_ms: 703.6135
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on wrong index access method
ok 235 - P2-002 migration 011 fails closed on wrong index access method
  ---
  duration_ms: 773.6712
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on wrong partial-index predicate
ok 236 - P2-002 migration 011 fails closed on wrong partial-index predicate
  ---
  duration_ms: 762.5431
  type: 'test'
  ...
# Subtest: P2-002 P1 source adapter reads Channel/Intake/Ticket/Delivery facts without mutating them
ok 237 - P2-002 P1 source adapter reads Channel/Intake/Ticket/Delivery facts without mutating them
  ---
  duration_ms: 3692.1984
  type: 'test'
  ...
# {"source_record_count":4,"channel_message_count":1,"ticket_event_variant_count":2,"delivery_count":1,"source_snapshot_unchanged":true}
# Subtest: P2-002 real worker processes roll back before commit and replay after ACK loss
ok 238 - P2-002 real worker processes roll back before commit and replay after ACK loss
  ---
  duration_ms: 2077.3778
  type: 'test'
  ...
# {"before_commit_kill_exit":{"code":null,"signal":"SIGKILL","killed":true},"before_commit_backend_close_polls":1,"before_commit_restart_exit":{"code":0,"signal":null,"killed":false},"before_commit_restart_inserted":1,"after_commit_kill_exit":{"code":null,"signal":"SIGKILL","killed":true},"after_commit_backend_close_polls":1,"after_commit_restart_exit":{"code":0,"signal":null,"killed":false},"after_commit_restart_replayed":1,"final_item_count":1,"final_binding_count":1,"final_checkpoint_cursor":"1","temp_database_cleanup":true}
# Subtest: P2-002 stale rebuild cannot delete a source committed after snapshot preparation
ok 239 - P2-002 stale rebuild cannot delete a source committed after snapshot preparation
  ---
  duration_ms: 807.1666
  type: 'test'
  ...
# {"connection_wait_polls":1,"stale_rebuild_error":"CONVERSATION_TIMELINE_REBUILD_FAILED","preserved_item_count":3,"preserved_binding_count":3,"preserved_checkpoint_cursor":"3","full_rebuild_item_count":3,"full_rebuild_hash":"fd48fcb3aca50305fc12c2aeec39d491249dbd83bf7860d1446948caff187d2c","temp_database_cleanup":true}
# Subtest: P2-002 projector is idempotent, concurrent, transactional, rebuildable, private, and restart safe
ok 240 - P2-002 projector is idempotent, concurrent, transactional, rebuildable, private, and restart safe
  ---
  duration_ms: 7533.0221
  type: 'test'
  ...
# {"same_source_concurrency":12,"different_source_concurrency":12,"bulk_item_count":2001,"bulk_batch_count":101,"bulk_max_batch_size":20,"bulk_peak_heap_delta_bytes":20385584,"bulk_heap_sample_count":101,"bulk_heap_segment_means_bytes":[17246990,19822485,23095252,25522396],"bulk_first_to_last_heap_trend_bytes":8275406,"bulk_max_adjacent_heap_trend_bytes":3272767,"bulk_interrupted_at_cursor":"20","bulk_restart_remaining_items":1981,"rebuild_canonical_hash":"4d6603a570f5bd117d1f5ac021fa158febfee754784cd2ba0bc78a8785b6110a","temp_database_cleanup":"verified-by-finally"}
# Subtest: P2-002 suite leaves no random database or worker backend residual
ok 241 - P2-002 suite leaves no random database or worker backend residual
  ---
  duration_ms: 55.5915
  type: 'test'
  ...
# {"temp_database_count":0,"worker_backend_count":0,"isolated_source_data_residual":0,"isolated_projection_schema_residual":0}
# Subtest: P2-002 uses the frozen P2-001 Conversation Item enums
ok 242 - P2-002 uses the frozen P2-001 Conversation Item enums
  ---
  duration_ms: 8.5392
  type: 'test'
  ...
# Subtest: projection source schema parses and freezes the five source types
ok 243 - projection source schema parses and freezes the five source types
  ---
  duration_ms: 4.6944
  type: 'test'
  ...
# Subtest: normalization rejects invalid source type, session UUID, date, ordinal and additions
ok 244 - normalization rejects invalid source type, session UUID, date, ordinal and additions
  ---
  duration_ms: 2.9436
  type: 'test'
  ...
# Subtest: date normalization rejects hostile Date/object paths without invoking or leaking them
ok 245 - date normalization rejects hostile Date/object paths without invoking or leaking them
  ---
  duration_ms: 0.7731
  type: 'test'
  ...
# Subtest: safe_content accepts only bounded plain JSON data properties
ok 246 - safe_content accepts only bounded plain JSON data properties
  ---
  duration_ms: 0.6074
  type: 'test'
  ...
# Subtest: toJSON, Proxy and prototype-pollution keys cannot bypass pure JSON checks
ok 247 - toJSON, Proxy and prototype-pollution keys cannot bypass pure JSON checks
  ---
  duration_ms: 0.4973
  type: 'test'
  ...
# Subtest: source_hash is stable across key order and detects semantic mutation
ok 248 - source_hash is stable across key order and detects semantic mutation
  ---
  duration_ms: 0.5885
  type: 'test'
  ...
# Subtest: privacy and retention controls can tighten without changing semantic source_hash
ok 249 - privacy and retention controls can tighten without changing semantic source_hash
  ---
  duration_ms: 0.2931
  type: 'test'
  ...
# Subtest: canonical order uses the frozen rank and exact deterministic tie-break tuple
ok 250 - canonical order uses the frozen rank and exact deterministic tie-break tuple
  ---
  duration_ms: 0.8597
  type: 'test'
  ...
# Subtest: canonical order compares BIGINT ordinals numerically without Number conversion
ok 251 - canonical order compares BIGINT ordinals numerically without Number conversion
  ---
  duration_ms: 0.6925
  type: 'test'
  ...
# Subtest: source id and variant break otherwise identical timestamp/rank/ordinal ties
ok 252 - source id and variant break otherwise identical timestamp/rank/ordinal ties
  ---
  duration_ms: 0.6025
  type: 'test'
  ...
# Subtest: CHANNEL_MESSAGE maps only clean_text and four safe flags
ok 253 - CHANNEL_MESSAGE maps only clean_text and four safe flags
  ---
  duration_ms: 0.6209
  type: 'test'
  ...
# Subtest: TICKET_EVENT splits STATUS, EXTERNAL_NOTE and INTERNAL_NOTE variants
ok 254 - TICKET_EVENT splits STATUS, EXTERNAL_NOTE and INTERNAL_NOTE variants
  ---
  duration_ms: 0.5779
  type: 'test'
  ...
# Subtest: TICKET_EVENT external variant cannot contain internal note or operator identity
ok 255 - TICKET_EVENT external variant cannot contain internal note or operator identity
  ---
  duration_ms: 0.3925
  type: 'test'
  ...
# Subtest: TICKET_EVENT omits absent note variants
ok 256 - TICKET_EVENT omits absent note variants
  ---
  duration_ms: 0.2364
  type: 'test'
  ...
# Subtest: DELIVERY is INTERNAL and excludes target/provider/raw error data
ok 257 - DELIVERY is INTERNAL and excludes target/provider/raw error data
  ---
  duration_ms: 0.3952
  type: 'test'
  ...
# Subtest: Communication Message fixture mapper requires an explicit fixture marker
ok 258 - Communication Message fixture mapper requires an explicit fixture marker
  ---
  duration_ms: 0.3624
  type: 'test'
  ...
# Subtest: Handoff fixture defaults to INTERNAL and never creates a future table dependency
ok 259 - Handoff fixture defaults to INTERNAL and never creates a future table dependency
  ---
  duration_ms: 0.244
  type: 'test'
  ...
# Subtest: normalized safe_content deny-list blocks privacy and provider leakage fields
ok 260 - normalized safe_content deny-list blocks privacy and provider leakage fields
  ---
  duration_ms: 0.5675
  type: 'test'
  ...
# Subtest: feature flag is fail-closed before any database call
ok 261 - feature flag is fail-closed before any database call
  ---
  duration_ms: 0.9408
  type: 'test'
  ...
# Subtest: batchSize defaults to 20 and is bounded at construction and invocation
ok 262 - batchSize defaults to 20 and is bounded at construction and invocation
  ---
  duration_ms: 0.9156
  type: 'test'
  ...
# Subtest: runtime freezes every source and operation to the single timeline projector name
ok 263 - runtime freezes every source and operation to the single timeline projector name
  ---
  duration_ms: 1.1717
  type: 'test'
  ...
# Subtest: public storage failures contain only the stable code
ok 264 - public storage failures contain only the stable code
  ---
  duration_ms: 0.3799
  type: 'test'
  ...
# Subtest: database sequence uniqueness is deterministically mapped to the frozen sequence error
ok 265 - database sequence uniqueness is deterministically mapped to the frozen sequence error
  ---
  duration_ms: 4.9283
  type: 'test'
  ...
# Subtest: rebuild authorization and wrapper accessor validation fail before storage
ok 266 - rebuild authorization and wrapper accessor validation fail before storage
  ---
  duration_ms: 1.666
  type: 'test'
  ...
# Subtest: rebuild stale-snapshot fence fails before DELETE for extra or foreign bindings
ok 267 - rebuild stale-snapshot fence fails before DELETE for extra or foreign bindings
  ---
  duration_ms: 1.5601
  type: 'test'
  ...
# Subtest: Canonical Timeline Hash excludes projected_at and physical input order
ok 268 - Canonical Timeline Hash excludes projected_at and physical input order
  ---
  duration_ms: 0.4589
  type: 'test'
  ...
# Subtest: Canonical Timeline Hash validates arrays and items before any caller property access
ok 269 - Canonical Timeline Hash validates arrays and items before any caller property access
  ---
  duration_ms: 1.3178
  type: 'test'
  ...
# Subtest: EXTERNAL audience uses SQL visibility filtering and defense-in-depth filtering
ok 270 - EXTERNAL audience uses SQL visibility filtering and defense-in-depth filtering
  ---
  duration_ms: 0.6197
  type: 'test'
  ...
# Subtest: WORKBENCH excludes RESTRICTED and RESTRICTED_ADMIN requires explicit authorization
ok 271 - WORKBENCH excludes RESTRICTED and RESTRICTED_ADMIN requires explicit authorization
  ---
  duration_ms: 0.2642
  type: 'test'
  ...
# Subtest: generic TimelineSourceAdapter maps rows outside projector transactions
ok 272 - generic TimelineSourceAdapter maps rows outside projector transactions
  ---
  duration_ms: 0.4887
  type: 'test'
  ...
# Subtest: public wrapper APIs reject Proxy/accessor arguments before invoking dependencies
ok 273 - public wrapper APIs reject Proxy/accessor arguments before invoking dependencies
  ---
  duration_ms: 0.7008
  type: 'test'
  ...
# Subtest: unknown Proxy/accessor error objects are sanitized without a second trap
ok 274 - unknown Proxy/accessor error objects are sanitized without a second trap
  ---
  duration_ms: 0.2081
  type: 'test'
  ...
# Subtest: worker reads a bounded batch before invoking the projector and preserves AbortSignal
ok 275 - worker reads a bounded batch before invoking the projector and preserves AbortSignal
  ---
  duration_ms: 0.3921
  type: 'test'
  ...
# Subtest: worker maps unknown adapter failures to the stable storage error
ok 276 - worker maps unknown adapter failures to the stable storage error
  ---
  duration_ms: 0.1581
  type: 'test'
  ...
# Subtest: checkpoint cursor accepts nullable expected values and enforces the shared 512 bound
ok 277 - checkpoint cursor accepts nullable expected values and enforces the shared 512 bound
  ---
  duration_ms: 3.9076
  type: 'test'
  ...
# Subtest: migration runner executes only migration 011 and sanitizes raw failures
ok 278 - migration runner executes only migration 011 and sanitizes raw failures
  ---
  duration_ms: 2.6972
  type: 'test'
  ...
# Subtest: the public error vocabulary contains exactly the eleven frozen stable codes
ok 279 - the public error vocabulary contains exactly the eleven frozen stable codes
  ---
  duration_ms: 0.2786
  type: 'test'
  ...
# Subtest: P1 source adapter reads current sources in one repeatable-read read-only transaction
ok 280 - P1 source adapter reads current sources in one repeatable-read read-only transaction
  ---
  duration_ms: 0.4896
  type: 'test'
  ...
# Subtest: P2-003 migration 012 is exact, reentrant, CLI-scoped, and check-only rolls back
ok 281 - P2-003 migration 012 is exact, reentrant, CLI-scoped, and check-only rolls back
  ---
  duration_ms: 2044.3177
  type: 'test'
  ...
# {"migration_process_runs":4,"migration_files_executed":1,"relations_added":2,"prior_catalog_unchanged":true,"precheck_rolled_back":true,"postcheck_rolled_back":true,"temp_database_cleanup":true}
# Subtest: P2-003 migration fails closed for missing column, weak check, wrong unique and index drift
ok 282 - P2-003 migration fails closed for missing column, weak check, wrong unique and index drift
  ---
  duration_ms: 5467.3185
  type: 'test'
  ...
# {"drift_scenarios":5,"temp_database_cleanup":true}
# Subtest: P2-003 append, concurrency, caller transaction, durable replay and authorization are exact
ok 283 - P2-003 append, concurrency, caller transaction, durable replay and authorization are exact
  ---
  duration_ms: 2609.3474
  type: 'test'
  ...
# {"same_event_concurrency":12,"different_event_concurrency":12,"pool_maximum":4,"natural_identity_hole":true,"ack_loss_replayed":true,"replay_batch_count":3,"replay_batch_maximum":50,"authorization_variants":4,"retained_event_count":124,"temp_database_cleanup":true}
# Subtest: P2-003 retention check/apply preserves prefix and floor semantics with CLI authorization
ok 284 - P2-003 retention check/apply preserves prefix and floor semantics with CLI authorization
  ---
  duration_ms: 11370.3013
  type: 'test'
  ...
# {"check_zero_write":true,"unauthorized_apply_zero_write":true,"deleted_prefix_count":2,"floor_event_id":"2","expired_after_live_retained":true,"retry_idempotent":true,"replay_gap_http_fallback":true,"cursor_ahead_http_409":true,"authorized_cli_apply":true}
# Subtest: P2-003 retention delete/floor is atomic and every cleanup batch is at most 200
ok 285 - P2-003 retention delete/floor is atomic and every cleanup batch is at most 200
  ---
  duration_ms: 4443.3552
  type: 'test'
  ...
# {"first_batch_deleted":200,"second_batch_deleted":1,"floor_delete_atomic_rollback":true}
# Subtest: P2-003 localhost SSE admits 32 clients, rejects 33, heartbeats, delivers and releases resources
ok 286 - P2-003 localhost SSE admits 32 clients, rejects 33, heartbeats, delivers and releases resources
  ---
  duration_ms: 3540.5336
  type: 'test'
  ...
# {"peak_client_count":32,"event_count":100,"each_client_received":100,"capacity_rejections":1,"maximum_writable_length":16695,"slow_client_disconnects":0,"heap_samples_bytes":[9825600,11867040,12811168,11164048,12308272,25514080,15212696],"first_heap_bytes":9825600,"last_heap_bytes":15212696,"heap_sample_mean_bytes":14100415,"first_to_last_heap_trend_bytes":5387096,"peak_heap_delta_bytes":15688480,"database_query_batches":105,"resource_release_polls":2,"temp_database_cleanup":true}
# Subtest: P2-003 child kill/restart replays Last-Event-ID and missed wakeup recovers from PostgreSQL
ok 287 - P2-003 child kill/restart replays Last-Event-ID and missed wakeup recovers from PostgreSQL
  ---
  duration_ms: 3904.2598
  type: 'test'
  ...
# {"killed_server_exit":{"code":null,"signal":"SIGKILL","killed":true},"killed_server_backend_close_polls":1,"first_event_id":"1","post_restart_event_id":"2","recovery_poll_event_id":"3","app_restart_postgresql_replay":true,"missed_wakeup_recovered":true,"server_a_port":56466,"server_b_port":56471,"temp_database_cleanup":true}
# Subtest: P2-003 real paused slow client is isolated while normal delivery and append continue
ok 288 - P2-003 real paused slow client is isolated while normal delivery and append continue
  ---
  duration_ms: 18471.7714
  type: 'test'
  ...
# {"slow_disconnect_count":1,"normal_client_received":5001,"persisted_event_count":5001,"slow_disconnect_polls":84,"active_slow_write_window_polls":10,"normal_joined_during_slow_drain_polls":1,"normal_client_remained_connected":true,"append_during_slow_write_window":true,"business_transaction_during_slow_write_window":true,"temp_database_cleanup":true}
# Subtest: P2-003 streams 5,000 events in bounded batches and bounded heap without retaining frames
ok 289 - P2-003 streams 5,000 events in bounded batches and bounded heap without retaining frames
  ---
  duration_ms: 6879.417
  type: 'test'
  ...
# {"event_count":5000,"replay_query_batch_count":100,"replay_batch_size":50,"captured_frame_count":0,"maximum_parser_buffer_bytes":370,"maximum_writable_length":16588,"heap_samples_bytes":[9791736,14868896,15272680,16487424,15008832,14966976],"first_to_last_heap_trend_bytes":5175240,"peak_heap_delta_bytes":6695688,"temp_database_cleanup":true}
# Subtest: P2-003 suite leaves no owned database, schema, child, backend, socket, port or timer residual
ok 290 - P2-003 suite leaves no owned database, schema, child, backend, socket, port or timer residual
  ---
  duration_ms: 62.5282
  type: 'test'
  ...
# {"active_test_clients":0,"active_fallback_requests":0,"active_test_http_sockets":0,"active_test_wait_timers":0,"active_cli_children":0,"active_server_children":0,"owned_port_count":6,"closed_port_count":6,"port_close_polls":[1,1,1,1,1,1],"owned_database_count":0,"owned_schema_count":0,"owned_backend_count":0,"active_database_count":0,"emergency_client_cleanup_count":0,"emergency_fallback_cleanup_count":0,"emergency_http_socket_cleanup_count":0}
# Subtest: Realtime Event and Fallback Schemas parse as draft 2020-12 closed contracts
ok 291 - Realtime Event and Fallback Schemas parse as draft 2020-12 closed contracts
  ---
  duration_ms: 9.1173
  type: 'test'
  ...
# Subtest: Realtime vocabularies freeze all event, source, aggregate, scope and visibility values
ok 292 - Realtime vocabularies freeze all event, source, aggregate, scope and visibility values
  ---
  duration_ms: 1.4636
  type: 'test'
  ...
# Subtest: TypeScript declarations mirror every frozen Schema and runtime vocabulary
ok 293 - TypeScript declarations mirror every frozen Schema and runtime vocabulary
  ---
  duration_ms: 1.9212
  type: 'test'
  ...
# Subtest: authorized replay SQL clips scope and visibility before LIMIT and payload materialization
ok 294 - authorized replay SQL clips scope and visibility before LIMIT and payload materialization
  ---
  duration_ms: 1.6753
  type: 'test'
  ...
# Subtest: Fallback Schema freezes the six safe fields, four reasons and two strategies
ok 295 - Fallback Schema freezes the six safe fields, four reasons and two strategies
  ---
  duration_ms: 1.4085
  type: 'test'
  ...
# Subtest: normalization rejects invalid event, source, aggregate and scope vocabularies
ok 296 - normalization rejects invalid event, source, aggregate and scope vocabularies
  ---
  duration_ms: 1.5974
  type: 'test'
  ...
# Subtest: SESSION and THREAD require a UUID scope while SYSTEM requires null
ok 297 - SESSION and THREAD require a UUID scope while SYSTEM requires null
  ---
  duration_ms: 1.5141
  type: 'test'
  ...
# Subtest: normalization rejects invalid timestamps and requires expires_at after occurred_at
ok 298 - normalization rejects invalid timestamps and requires expires_at after occurred_at
  ---
  duration_ms: 0.7413
  type: 'test'
  ...
# Subtest: aggregate versions use nullable canonical PostgreSQL BIGINT strings
ok 299 - aggregate versions use nullable canonical PostgreSQL BIGINT strings
  ---
  duration_ms: 0.7244
  type: 'test'
  ...
# Subtest: Last-Event-ID accepts zero and the BIGINT maximum without Number conversion
ok 300 - Last-Event-ID accepts zero and the BIGINT maximum without Number conversion
  ---
  duration_ms: 0.2582
  type: 'test'
  ...
# Subtest: Last-Event-ID rejects negative, decimal, scientific, signed, spaced and overflow forms
ok 301 - Last-Event-ID rejects negative, decimal, scientific, signed, spaced and overflow forms
  ---
  duration_ms: 0.2708
  type: 'test'
  ...
# Subtest: payload accepts only bounded plain finite JSON data
ok 302 - payload accepts only bounded plain finite JSON data
  ---
  duration_ms: 0.7155
  type: 'test'
  ...
# Subtest: payload enforces depth, node, object, array, string and canonical-byte limits
ok 303 - payload enforces depth, node, object, array, string and canonical-byte limits
  ---
  duration_ms: 4.5688
  type: 'test'
  ...
# Subtest: payload rejects Proxy and accessor paths without invoking hostile code
ok 304 - payload rejects Proxy and accessor paths without invoking hostile code
  ---
  duration_ms: 0.6789
  type: 'test'
  ...
# Subtest: payload rejects toJSON, symbols and prototype-pollution keys
ok 305 - payload rejects toJSON, symbols and prototype-pollution keys
  ---
  duration_ms: 0.4805
  type: 'test'
  ...
# Subtest: payload rejects message content and sensitive identifier property names
ok 306 - payload rejects message content and sensitive identifier property names
  ---
  duration_ms: 0.7825
  type: 'test'
  ...
# Subtest: event key is stable, opaque and changes with its frozen identity tuple
ok 307 - event key is stable, opaque and changes with its frozen identity tuple
  ---
  duration_ms: 1.8711
  type: 'test'
  ...
# Subtest: event hash is canonical across payload key order and changes on semantic mutation
ok 308 - event hash is canonical across payload key order and changes on semantic mutation
  ---
  duration_ms: 0.8507
  type: 'test'
  ...
# Subtest: event hash excludes expires_at, event_id and created_at
ok 309 - event hash excludes expires_at, event_id and created_at
  ---
  duration_ms: 0.5928
  type: 'test'
  ...
# Subtest: Conversation Item mapper exposes only the seven safe projection fields plus occurred_at
ok 310 - Conversation Item mapper exposes only the seven safe projection fields plus occurred_at
  ---
  duration_ms: 0.578
  type: 'test'
  ...
# Subtest: Session fixture mapper freezes created and updated event variants with safe payloads
ok 311 - Session fixture mapper freezes created and updated event variants with safe payloads
  ---
  duration_ms: 1.0748
  type: 'test'
  ...
# Subtest: Timeline rebuilt fixture mapper exposes only count and canonical hash metadata
ok 312 - Timeline rebuilt fixture mapper exposes only count and canonical hash metadata
  ---
  duration_ms: 0.4489
  type: 'test'
  ...
# Subtest: public event view contains exactly nine safe fields and no publisher, source, hash or scope IDs
ok 313 - public event view contains exactly nine safe fields and no publisher, source, hash or scope IDs
  ---
  duration_ms: 0.4892
  type: 'test'
  ...
# Subtest: SSE event encoding uses id/type/single-line JSON and supports every frozen event type
ok 314 - SSE event encoding uses id/type/single-line JSON and supports every frozen event type
  ---
  duration_ms: 2.9352
  type: 'test'
  ...
# Subtest: SSE encoding rejects CR/LF event injection and never emits raw payload newlines
ok 315 - SSE encoding rejects CR/LF event injection and never emits raw payload newlines
  ---
  duration_ms: 0.3636
  type: 'test'
  ...
# Subtest: heartbeat is a comment frame and consumes no event id
ok 316 - heartbeat is a comment frame and consumes no event id
  ---
  duration_ms: 0.1385
  type: 'test'
  ...
# Subtest: authorization defaults to deny-all and rejects absent or malformed contexts
ok 317 - authorization defaults to deny-all and rejects absent or malformed contexts
  ---
  duration_ms: 0.5341
  type: 'test'
  ...
# Subtest: authorization normalizes bounded UUID sets without wildcard access
ok 318 - authorization normalizes bounded UUID sets without wildcard access
  ---
  duration_ms: 0.2306
  type: 'test'
  ...
# Subtest: restricted-admin defense-in-depth closes a malicious replay without delivering it
ok 319 - restricted-admin defense-in-depth closes a malicious replay without delivering it
  ---
  duration_ms: 3.263
  type: 'test'
  ...
# Subtest: controlled principal disconnect closes only the selected SSE client
ok 320 - controlled principal disconnect closes only the selected SSE client
  ---
  duration_ms: 5.3924
  type: 'test'
  ...
# Subtest: disabled handler returns safe polling fallback with zero database calls and no timers
ok 321 - disabled handler returns safe polling fallback with zero database calls and no timers
  ---
  duration_ms: 0.7523
  type: 'test'
  ...
# Subtest: disabled event store fails before acquiring a database connection
ok 322 - disabled event store fails before acquiring a database connection
  ---
  duration_ms: 0.565
  type: 'test'
  ...
# Subtest: disconnect during authentication never acquires replay, Hub, or timer resources
ok 323 - disconnect during authentication never acquires replay, Hub, or timer resources
  ---
  duration_ms: 0.3664
  type: 'test'
  ...
# Subtest: disconnect during authorization never acquires replay, Hub, or timer resources
ok 324 - disconnect during authorization never acquires replay, Hub, or timer resources
  ---
  duration_ms: 0.3426
  type: 'test'
  ...
# Subtest: Wakeup Hub admits 32 clients, rejects the 33rd, and releases capacity
ok 325 - Wakeup Hub admits 32 clients, rejects the 33rd, and releases capacity
  ---
  duration_ms: 0.2412
  type: 'test'
  ...
# Subtest: replay batch configuration accepts 200 and rejects 201
ok 326 - replay batch configuration accepts 200 and rejects 201
  ---
  duration_ms: 0.1804
  type: 'test'
  ...
# Subtest: list replay rejects limits above 200 before querying storage
ok 327 - list replay rejects limits above 200 before querying storage
  ---
  duration_ms: 0.4381
  type: 'test'
  ...
# Subtest: backpressure waits for drain and releases only the affected stream
ok 328 - backpressure waits for drain and releases only the affected stream
  ---
  duration_ms: 1.197
  type: 'test'
  ...
# Subtest: drain timeout disconnects only the slow client with bounded metrics
ok 329 - drain timeout disconnects only the slow client with bounded metrics
  ---
  duration_ms: 2.6944
  type: 'test'
  ...
# Subtest: retention gap after SSE headers closes the stream and reconnect returns 410 fallback
ok 330 - retention gap after SSE headers closes the stream and reconnect returns 410 fallback
  ---
  duration_ms: 1.0455
  type: 'test'
  ...
# Subtest: polling fallback normalizes canonical IDs and rejects unsafe forms
ok 331 - polling fallback normalizes canonical IDs and rejects unsafe forms
  ---
  duration_ms: 0.153
  type: 'test'
  ...
# Subtest: public HTTP errors expose only stable codes and never raw authentication failures
ok 332 - public HTTP errors expose only stable codes and never raw authentication failures
  ---
  duration_ms: 0.36
  type: 'test'
  ...
# Subtest: migration 020 is exact, reentrant, CLI-scoped, check-only, and preserves 005/010/011/012 catalogs
ok 333 - migration 020 is exact, reentrant, CLI-scoped, check-only, and preserves 005/010/011/012 catalogs
  ---
  duration_ms: 1518.3951
  type: 'test'
  ...
# {"first_apply":true,"repeated_apply":true,"check_rollback":true,"frozen_catalog_relations":10}
# Subtest: migration 020 fails closed for missing columns, weakened checks, wrong unique, index method and predicate
ok 334 - migration 020 fails closed for missing columns, weakened checks, wrong unique, index method and predicate
  ---
  duration_ms: 4942.0065
  type: 'test'
  ...
# {"drift_mutations":["missingcol","weakcheck","wrongunique","indexmethod","indexpred"],"stable_error":"P2_004_SCHEMA_DRIFT_REMEDIATION_REQUIRED"}
# Subtest: Communication service commits atomically, isolates idempotency scopes, and never mutates Session
ok 335 - Communication service commits atomically, isolates idempotency scopes, and never mutates Session
  ---
  duration_ms: 3848.531
  type: 'test'
  ...
# {"browser_double_click_concurrency":12,"committed_fact_sets":1,"human_ai_same_body_isolated":true,"internal_note_outbox_count":0}
# Subtest: Delivery Worker enforces claim CAS, ACK, retry, dead letter, timeout unknown and lease recovery
ok 336 - Delivery Worker enforces claim CAS, ACK, retry, dead letter, timeout unknown and lease recovery
  ---
  duration_ms: 2552.2375
  type: 'test'
  ...
# {"concurrent_workers":12,"single_claim":true,"gateway_reconnect":true,"timeout_unknown":true,"leased_recovered":true,"sending_not_resent":true}
# Subtest: multi-target delivery is isolated, target rate limit is durable, and reconciliation is explicit
ok 337 - multi-target delivery is isolated, target rate limit is durable, and reconciliation is explicit
  ---
  duration_ms: 2451.6218
  type: 'test'
  ...
# {"multi_target_count":2,"isolated_outcomes":["SENT","DEAD_LETTER"],"target_rate_limit":true,"reconciliation_resolutions":["CONFIRMED_SENT","CONFIRMED_NOT_SENT_REQUEUE","CANCEL"]}
# Subtest: real Worker kill/restart reclaims LEASED but never blindly resends SENDING
ok 338 - real Worker kill/restart reclaims LEASED but never blindly resends SENDING
  ---
  duration_ms: 2852.2798
  type: 'test'
  ...
# {"leased_child_exit":{"code":null,"signal":"SIGKILL"},"leased_restart_sent":true,"sending_child_exit":{"code":null,"signal":"SIGKILL"},"sending_restart_reconciled":true,"blind_resend_count":0}
# Subtest: P1 compatibility is read-only until it delegates to the existing P1 worker
ok 339 - P1 compatibility is read-only until it delegates to the existing P1 worker
  ---
  duration_ms: 2170.4589
  type: 'test'
  ...
# {"p1_read_snapshot_unchanged":true,"p1_delivery_delegated":true,"communication_rows_created":0}
# Subtest: 500 deliveries remain bounded at batch 20 and interruption resumes without resource growth
ok 340 - 500 deliveries remain bounded at batch 20 and interruption resumes without resource growth
  ---
  duration_ms: 9850.9147
  type: 'test'
  ...
# {"deliveries":500,"batch_size":20,"interrupted_after":100,"resumed_to":500,"heap_samples":[17088288,19956376,17859520,20780752,18592688,21478808,18470744,21595928,25864656,14765944],"heap_growth_bytes":-2322344,"soak_claimed":false}
# Subtest: P2-004 integration leaves no owned database or backend residual
ok 341 - P2-004 integration leaves no owned database or backend residual
  ---
  duration_ms: 40.6509
  type: 'test'
  ...
# {"database_count":0,"backend_count":0,"active_database_count":0,"worker_child_count":0,"worker_count":0,"timer_count":0,"child_process_count":0}
# Subtest: P2-004 JSON Schemas use draft 2020-12 and close object shapes
ok 342 - P2-004 JSON Schemas use draft 2020-12 and close object shapes
  ---
  duration_ms: 14.4534
  type: 'test'
  ...
# Subtest: Reply Command schema and future OpenAPI bind session and idempotency without exposing a target
ok 343 - Reply Command schema and future OpenAPI bind session and idempotency without exposing a target
  ---
  duration_ms: 3.752
  type: 'test'
  ...
# Subtest: frozen Communication vocabularies are exact
ok 344 - frozen Communication vocabularies are exact
  ---
  duration_ms: 2.0752
  type: 'test'
  ...
# Subtest: normalization freezes Agent, AI, System, internal note and media contracts
ok 345 - normalization freezes Agent, AI, System, internal note and media contracts
  ---
  duration_ms: 2.5688
  type: 'test'
  ...
# Subtest: invalid UUID, row version, privacy, retention, message type, and browser authority are rejected
ok 346 - invalid UUID, row version, privacy, retention, message type, and browser authority are rejected
  ---
  duration_ms: 1.054
  type: 'test'
  ...
# Subtest: plain JSON fence rejects Proxy, accessor, symbol, toJSON, prototype and pollution keys
ok 347 - plain JSON fence rejects Proxy, accessor, symbol, toJSON, prototype and pollution keys
  ---
  duration_ms: 0.4741
  type: 'test'
  ...
# Subtest: plain JSON fence enforces depth, node, string and array bounds
ok 348 - plain JSON fence enforces depth, node, string and array bounds
  ---
  duration_ms: 0.3124
  type: 'test'
  ...
# Subtest: content and command hashes are stable, key-order independent and cover row version
ok 349 - content and command hashes are stable, key-order independent and cover row version
  ---
  duration_ms: 1.4291
  type: 'test'
  ...
# Subtest: destination resolution uses authoritative Thread fields for single and group
ok 350 - destination resolution uses authoritative Thread fields for single and group
  ---
  duration_ms: 0.4115
  type: 'test'
  ...
# Subtest: disabled service performs zero database and authorization work
ok 351 - disabled service performs zero database and authorization work
  ---
  duration_ms: 0.6091
  type: 'test'
  ...
# Subtest: disabled Worker performs zero database and Sender calls
ok 352 - disabled Worker performs zero database and Sender calls
  ---
  duration_ms: 0.4781
  type: 'test'
  ...
# Subtest: Sender Port validates ACK, rejected, unknown and rejects malformed results
ok 353 - Sender Port validates ACK, rejected, unknown and rejects malformed results
  ---
  duration_ms: 0.4797
  type: 'test'
  ...
# Subtest: Mock Sender records only safe call metadata
ok 354 - Mock Sender records only safe call metadata
  ---
  duration_ms: 0.3895
  type: 'test'
  ...
# Subtest: message projection maps Agent, AI, Internal and System without changing ownership
ok 355 - message projection maps Agent, AI, Internal and System without changing ownership
  ---
  duration_ms: 0.4855
  type: 'test'
  ...
# Subtest: delivery timeline and realtime mappers expose only safe delivery fields
ok 356 - delivery timeline and realtime mappers expose only safe delivery fields
  ---
  duration_ms: 0.3507
  type: 'test'
  ...
# Subtest: legacy notification mapping is safe and exact
ok 357 - legacy notification mapping is safe and exact
  ---
  duration_ms: 0.1835
  type: 'test'
  ...
# Subtest: public stable error inventory excludes raw provider and storage details
ok 358 - public stable error inventory excludes raw provider and storage details
  ---
  duration_ms: 0.1528
  type: 'test'
  ...
# Subtest: migration 021 is scoped, reentrant, check-rolls-back, and drift fails closed
ok 359 - migration 021 is scoped, reentrant, check-rolls-back, and drift fails closed
  ---
  duration_ms: 6097.0497
  type: 'test'
  ...
# {"first_apply":true,"repeated_apply":true,"check_rollback":true,"new_tables":4}
# Subtest: takeover is serialized/idempotent; handoff request-accept-release and request-cancel are audited atomically
ok 360 - takeover is serialized/idempotent; handoff request-accept-release and request-cancel are audited atomically
  ---
  duration_ms: 2834.833
  type: 'test'
  ...
# {"concurrent_winners":1,"idempotent_parallel":12,"handoff":["REQUESTED","ACCEPTED","RELEASED"],"cancel":"CANCELLED"}
# Subtest: admin force transfer works; non-admin, inactive target, wrong-team handler, ended and stale commands fail closed
ok 361 - admin force transfer works; non-admin, inactive target, wrong-team handler, ended and stale commands fail closed
  ---
  duration_ms: 3764.0718
  type: 'test'
  ...
# {"admin_force_transfer":true,"handler_force":false,"inactive":false,"wrong_team":false}
# Subtest: generation race blocks stale AI before Communication and realtime failure rolls back control facts
ok 362 - generation race blocks stale AI before Communication and realtime failure rolls back control facts
  ---
  duration_ms: 3946.4576
  type: 'test'
  ...
# {"generation_start":1,"stale":true,"append_communication_calls":0,"message_delta":0,"outbox_delta":0,"delivery_delta":0,"realtime_failure_rollback":true}
# Subtest: 32 principals keep independent monotonic cursors; visibility COUNT is correct and Session versions do not move
ok 363 - 32 principals keep independent monotonic cursors; visibility COUNT is correct and Session versions do not move
  ---
  duration_ms: 4052.3386
  type: 'test'
  ...
# {"principals":32,"monotonic":true,"session_version_unchanged":true,"workbench_unread":1,"restricted_unread":2}
# Subtest: 2C4G bounded capacity covers 500 assignment/handoff facts and 2,000 cursor updates without residual resources
ok 364 - 2C4G bounded capacity covers 500 assignment/handoff facts and 2,000 cursor updates without residual resources
  ---
  duration_ms: 4815.4954
  type: 'test'
  ...
# {"assignments":500,"handoffs":500,"cursor_updates":2000,"max_list_limit":200,"heap_samples":5,"heap_monotonic_unbounded":false,"pool_max":4,"soak_24h":false}
# Subtest: all P2-005 JSON Schemas parse and freeze strict objects
ok 365 - all P2-005 JSON Schemas parse and freeze strict objects
  ---
  duration_ms: 6.7154
  type: 'test'
  ...
# Subtest: status, command, event, invalidation, and stable error vocabularies are frozen
ok 366 - status, command, event, invalidation, and stable error vocabularies are frozen
  ---
  duration_ms: 1.1803
  type: 'test'
  ...
# Subtest: normalization is bounded and command hash is stable across key order
ok 367 - normalization is bounded and command hash is stable across key order
  ---
  duration_ms: 1.6459
  type: 'test'
  ...
# Subtest: invalid identifiers, versions, sequences, reason codes, target modes, and extra authority fail closed
ok 368 - invalid identifiers, versions, sequences, reason codes, target modes, and extra authority fail closed
  ---
  duration_ms: 0.6889
  type: 'test'
  ...
# Subtest: non-plain JSON, Proxy, accessor, toJSON, symbol, cycle, and prototype pollution are rejected
ok 369 - non-plain JSON, Proxy, accessor, toJSON, symbol, cycle, and prototype pollution are rejected
  ---
  duration_ms: 0.3104
  type: 'test'
  ...
# Subtest: default authorization rejects every operation
ok 370 - default authorization rejects every operation
  ---
  duration_ms: 0.1653
  type: 'test'
  ...
# Subtest: disabled service returns before every database call and hides raw failures
ok 371 - disabled service returns before every database call and hides raw failures
  ---
  duration_ms: 0.5441
  type: 'test'
  ...
# Subtest: generation fence distinguishes current, stale, and HUMAN-forbidden without process state
ok 372 - generation fence distinguishes current, stale, and HUMAN-forbidden without process state
  ---
  duration_ms: 0.7681
  type: 'test'
  ...
# Subtest: assigned Communication authorizer denies AI flags, inactive/unassigned agents, and accepts assigned active actor
ok 373 - assigned Communication authorizer denies AI flags, inactive/unassigned agents, and accepts assigned active actor
  ---
  duration_ms: 0.3741
  type: 'test'
  ...
# Subtest: Realtime mappers expose versions/status only and no identity or content
ok 374 - Realtime mappers expose versions/status only and no identity or content
  ---
  duration_ms: 0.7194
  type: 'test'
  ...
# Subtest: Timeline mapper uses internal HANDOFF_EVENT and requires explicit privacy/retention
ok 375 - Timeline mapper uses internal HANDOFF_EVENT and requires explicit privacy/retention
  ---
  duration_ms: 0.301
  type: 'test'
  ...
# Subtest: system browser desktop workbench flow is responsive, refresh-safe and XSS-safe
ok 376 - system browser desktop workbench flow is responsive, refresh-safe and XSS-safe
  ---
  duration_ms: 2310.831
  type: 'test'
  ...
# {"browser":"C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe","viewport":{"label":"desktop","width":1440,"height":900},"interactions":{"select":1,"takeover":1,"transfer":1,"reply":1,"internal_note":1,"sse_update":true,"polling_fallback":true,"filter":true,"refresh_restore":true},"keyboard_focus_visible":true,"security_headers":true,"xss_executed":false,"horizontal_overflow":false}
# Subtest: system browser mobile workbench flow is responsive, refresh-safe and XSS-safe
ok 377 - system browser mobile workbench flow is responsive, refresh-safe and XSS-safe
  ---
  duration_ms: 2032.2572
  type: 'test'
  ...
# {"browser":"C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe","viewport":{"label":"mobile","width":390,"height":844},"interactions":{"select":1,"takeover":1,"transfer":1,"reply":1,"internal_note":1,"sse_update":true,"polling_fallback":true,"filter":true,"refresh_restore":true},"keyboard_focus_visible":true,"security_headers":true,"xss_executed":false,"horizontal_overflow":false}
# Subtest: system browser renders the same Workbench LocalDateTime under UTC, Tokyo, and New York
ok 378 - system browser renders the same Workbench LocalDateTime under UTC, Tokyo, and New York
  ---
  duration_ms: 1424.9382
  type: 'test'
  ...
# Subtest: P2-006 applies no DDL and leaves no isolated PostgreSQL resources
ok 379 - P2-006 applies no DDL and leaves no isolated PostgreSQL resources
  ---
  duration_ms: 4691.9594
  type: 'test'
  ...
# {"migration_022":true,"catalog_unchanged":true,"feature_enabled_only_in_test":true}
# Subtest: admin/dispatcher/handler authorization is enforced in SQL data access and timeline visibility
ok 380 - admin/dispatcher/handler authorization is enforced in SQL data access and timeline visibility
  ---
  duration_ms: 2282.562
  type: 'test'
  ...
# {"admin_sessions":2,"dispatcher_sessions":2,"assigned_handler_sessions":1,"outsider_sessions":0,"reporter_forbidden":true,"inactive_forbidden":true,"restricted_hidden_from_handler":true}
# Subtest: 500 conversations and 10,000 items have duplicate-free keyset pages and bounded read latency
ok 381 - 500 conversations and 10,000 items have duplicate-free keyset pages and bounded read latency
  ---
  duration_ms: 48926.2403
  type: 'test'
  ...
# {"sessions":500,"items":10000,"assignments":500,"tickets":500,"deliveries":500,"list_requests":1000,"detail_requests":1000,"keyset_unique":true,"p95":{"list_ms":54.568,"detail_ms":11.268}}
# Subtest: workbench facade commits human reply, internal note, takeover and idempotent replay through P2-004/P2-005 ports
ok 382 - workbench facade commits human reply, internal note, takeover and idempotent replay through P2-004/P2-005 ports
  ---
  duration_ms: 3816.6861
  type: 'test'
  ...
# {"takeover":true,"replayed":true,"transfer":true,"release":true,"handoff_request_cancel":true,"read_cursor":1,"external_messages":1,"internal_notes":1,"external_outbox":1,"internal_outbox":0,"pending_retry":true,"dead_letter_requeue":true,"reconciliation_required_blocks_retry":true,"admin_reconciliation":true}
# Subtest: 200 real HTTP reply commits and 12-way duplicate submit remain bounded without sender calls or socket residue
ok 383 - 200 real HTTP reply commits and 12-way duplicate submit remain bounded without sender calls or socket residue
  ---
  duration_ms: 6615.3197
  type: 'test'
  ...
# {"reply_http":{"samples":200,"p50_ms":15.374,"p95_ms":22.92,"p99_ms":39.986,"max_ms":54.874},"duplicate_submit_parallel":12,"messages":201,"outboxes":201,"deliveries":201,"sender_calls":0,"heap_samples_bytes":[17678432,25809624,23032784,30566272,19931608,27366720,23157800,30276304],"pool_max":4}
# Subtest: P2-003 SSE route delivers committed messages through authorized refetch within 2 seconds and releases timers
ok 384 - P2-003 SSE route delivers committed messages through authorized refetch within 2 seconds and releases timers
  ---
  duration_ms: 5300.0143
  type: 'test'
  ...
# {"new_message_commit_sse_refetch":{"samples":100,"p50_ms":21.572,"p95_ms":44.149,"p99_ms":63.511,"max_ms":82.474},"authorized_events":100,"unauthorized_events":0}
# Subtest: workbench schemas parse and OpenAPI 3.1 exposes every implemented route
ok 385 - workbench schemas parse and OpenAPI 3.1 exposes every implemented route
  ---
  duration_ms: 7.7684
  type: 'test'
  ...
# Subtest: opaque cursor round-trips normalized timestamp and session id
ok 386 - opaque cursor round-trips normalized timestamp and session id
  ---
  duration_ms: 1.9715
  type: 'test'
  ...
# Subtest: opaque cursor rejects malformed, oversized, and structurally extended values
ok 387 - opaque cursor rejects malformed, oversized, and structurally extended values
  ---
  duration_ms: 0.7518
  type: 'test'
  ...
# Subtest: disabled query service performs zero database and authorization calls
ok 388 - disabled query service performs zero database and authorization calls
  ---
  duration_ms: 0.632
  type: 'test'
  ...
# Subtest: list SQL applies authorization in WHERE before keyset ORDER BY and LIMIT
ok 389 - list SQL applies authorization in WHERE before keyset ORDER BY and LIMIT
  ---
  duration_ms: 1.4782
  type: 'test'
  ...
# Subtest: query page limit and state filters fail closed
ok 390 - query page limit and state filters fail closed
  ---
  duration_ms: 0.3118
  type: 'test'
  ...
# Subtest: HTTP server construction fails when authentication port is absent
ok 391 - HTTP server construction fails when authentication port is absent
  ---
  duration_ms: 0.5214
  type: 'test'
  ...
# Subtest: HTTP API rejects unauthenticated and expired contexts without fallback
ok 392 - HTTP API rejects unauthenticated and expired contexts without fallback
  ---
  duration_ms: 61.3691
  type: 'test'
  ...
# Subtest: Cookie writes require exact origin, same-site context, constant-time CSRF and matching idempotency
ok 393 - Cookie writes require exact origin, same-site context, constant-time CSRF and matching idempotency
  ---
  duration_ms: 46.0287
  type: 'test'
  ...
# Subtest: Bearer mode requires Authorization header and tokens in query are forbidden
ok 394 - Bearer mode requires Authorization header and tokens in query are forbidden
  ---
  duration_ms: 8.3234
  type: 'test'
  ...
# Subtest: HTTP security headers contain strict CSP without inline or eval and no wildcard CORS
ok 395 - HTTP security headers contain strict CSP without inline or eval and no wildcard CORS
  ---
  duration_ms: 8.7801
  type: 'test'
  ...
# Subtest: non-JSON and oversized write bodies are rejected with stable public errors
ok 396 - non-JSON and oversized write bodies are rejected with stable public errors
  ---
  duration_ms: 9.1644
  type: 'test'
  ...
# Subtest: command facade delegates frozen control and communication ports without sender access
ok 397 - command facade delegates frozen control and communication ports without sender access
  ---
  duration_ms: 3.2016
  type: 'test'
  ...
# Subtest: UI source renders untrusted content through text nodes only
ok 398 - UI source renders untrusted content through text nodes only
  ---
  duration_ms: 0.6557
  type: 'test'
  ...
# Subtest: UI reducer bounds conversations and timeline arrays
ok 399 - UI reducer bounds conversations and timeline arrays
  ---
  duration_ms: 0.6461
  type: 'test'
  ...
# Subtest: refresh storage persists only selected id and filter
ok 400 - refresh storage persists only selected id and filter
  ---
  duration_ms: 0.279
  type: 'test'
  ...
# Subtest: P2-006 creates no migration and static preview check succeeds
ok 401 - P2-006 creates no migration and static preview check succeeds
  ---
  duration_ms: 135.3151
  type: 'test'
  ...
# Subtest: P2-012 real command capacity 500 candidates, 200 incidents, 2000 reports, 1000 subscriptions, 5000 events, 500 bindings and 32 SSE
ok 402 - P2-012 real command capacity 500 candidates, 200 incidents, 2000 reports, 1000 subscriptions, 5000 events, 500 bindings and 32 SSE
  ---
  duration_ms: 53120.7268
  type: 'test'
  ...
# {"candidates":500,"incidents":200,"reports":2000,"subscriptions":1000,"events":5200,"bindings":550,"notification_sent":550,"pool_max":4,"sse_max":32,"sse_after_stop":0,"heap_samples_bytes":[15188080,28441248,70790504,45499168,45588992,65993280,85953464,53401560,73803608,40487560,60713400,20355048,16964864],"heap_peak_bytes":85953464,"heap_final_bytes":16964864,"real_sdk_calls":0,"model_calls":0}
# {"cleanup":{"database_count":0,"backend_count":0}}
# Subtest: P2-012 real TypeScript consumers accept nullable cursors and optional owner teams
ok 403 - P2-012 real TypeScript consumers accept nullable cursors and optional owner teams
  ---
  duration_ms: 602.3489
  type: 'test'
  ...
# Subtest: P2-012 parsed OpenAPI incident state filters match all runtime states and queue aliases
ok 404 - P2-012 parsed OpenAPI incident state filters match all runtime states and queue aliases
  ---
  duration_ms: 710.3623
  type: 'test'
  ...
# Subtest: P2-012 closes input shapes, rejects hostile values and preserves deterministic command hashes
ok 405 - P2-012 closes input shapes, rejects hostile values and preserves deterministic command hashes
  ---
  duration_ms: 5.6351
  type: 'test'
  ...
# Subtest: P2-012 stable HTTP matrix is exhaustive, deterministic and rejects hostile results without executing code
ok 406 - P2-012 stable HTTP matrix is exhaustive, deterministic and rejects hostile results without executing code
  ---
  duration_ms: 37.0588
  type: 'test'
  ...
# Subtest: P2-012 maintenance expires a bounded ordered batch through private SYSTEM commands without notifications
ok 407 - P2-012 maintenance expires a bounded ordered batch through private SYSTEM commands without notifications
  ---
  duration_ms: 3242.45
  type: 'test'
  ...
# Subtest: P2-012 maintenance replays concurrent scans, handles human/time races and surfaces a still-due failure
ok 408 - P2-012 maintenance replays concurrent scans, handles human/time races and surfaces a still-due failure
  ---
  duration_ms: 5468.3564
  type: 'test'
  ...
# Subtest: P2-012 maintenance scans after import and expires an imported due candidate in the same iteration
ok 409 - P2-012 maintenance scans after import and expires an imported due candidate in the same iteration
  ---
  duration_ms: 2123.0915
  type: 'test'
  ...
# Subtest: P2-012 real database human confirmation, idempotency, recovery isolation and notification facts
ok 410 - P2-012 real database human confirmation, idempotency, recovery isolation and notification facts
  ---
  duration_ms: 2840.4801
  type: 'test'
  ...
# Subtest: dynamic live configuration requires an approved group but no preconfigured Reporter userid hash
ok 411 - dynamic live configuration requires an approved group but no preconfigured Reporter userid hash
  ---
  duration_ms: 4.6358
  type: 'test'
  ...
# Subtest: dynamic Sender rechecks the persisted approved-group Reporter before each PERSON provider call
ok 412 - dynamic Sender rechecks the persisted approved-group Reporter before each PERSON provider call
  ---
  duration_ms: 1.9414
  type: 'test'
  ...
# Subtest: approved test group discovers an unconfigured Reporter before their direct flow and outbound notice
ok 413 - approved test group discovers an unconfigured Reporter before their direct flow and outbound notice
  ---
  duration_ms: 1.0802
  type: 'test'
  ...
# Subtest: P2-012 migration 032 applies atomically, detects catalog drift and preserves seven-table scope
ok 414 - P2-012 migration 032 applies atomically, detects catalog drift and preserves seven-table scope
  ---
  duration_ms: 3062.8936
  type: 'test'
  ...
# Subtest: P2-012 fresh current baseline reaches 032 and repeated status/check/apply preserve the catalog
ok 415 - P2-012 fresh current baseline reaches 032 and repeated status/check/apply preserve the catalog
  ---
  duration_ms: 3328.9603
  type: 'test'
  ...
# Subtest: P2-012 network-off three-role assembly serves Incident and closes children, sockets and pools
ok 416 - P2-012 network-off three-role assembly serves Incident and closes children, sockets and pools
  ---
  duration_ms: 4813.913
  type: 'test'
  ...
# {"network_enabled":false,"restarted":false,"metrics":{"process_count":3,"gateway_authenticated":0,"gateway_reconnect_total":0,"app_rss_bytes":85348352,"app_heap_used_bytes":20322896,"app_heap_total_bytes":33341440,"app_external_bytes":4564768,"app_cpu_percent":21.908,"app_event_loop_delay_p95_ms":31.784959,"app_active_resources":6,"app_active_timers":1,"app_active_sockets":5,"app_active_file_handles":0,"app_active_handles":5,"app_uptime_seconds":1.6,"app_pool_total":1,"app_pool_idle":1,"app_pool_waiting":0,"app_pool_max":4,"worker_rss_bytes":92688384,"worker_heap_used_bytes":18682528,"worker_heap_total_bytes":33865728,"worker_external_bytes":4473965,"worker_cpu_percent":16.164,"worker_event_loop_delay_p95_ms":31.997951,"worker_active_resources":4,"worker_active_timers":2,"worker_active_sockets":2,"worker_active_file_handles":0,"worker_active_handles":2,"worker_uptime_seconds":1.589,"worker_pool_total":1,"worker_pool_idle":1,"worker_pool_waiting":0,"worker_pool_max":2,"gateway_rss_bytes":79462400,"gateway_heap_used_bytes":12700736,"gateway_heap_total_bytes":31604736,"gateway_external_bytes":4206782,"gateway_cpu_percent":1.249,"gateway_event_loop_delay_p95_ms":31.899647,"gateway_active_resources":2,"gateway_active_timers":1,"gateway_active_sockets":1,"gateway_active_file_handles":0,"gateway_active_handles":1,"gateway_uptime_seconds":1.613,"gateway_pool_total":0,"gateway_pool_idle":0,"gateway_pool_waiting":0,"gateway_pool_max":1,"total_rss_bytes":257499136,"total_heap_used_bytes":51706160,"total_cpu_percent":39.321,"sse_clients":0,"projection_backlog":0,"projection_failures":0,"communication_pending":1,"dead_letter":0,"reconciliation_required":0,"postgres_active_connections":2,"postgres_idle_connections":3,"postgres_other_connections":0,"postgres_max_connections":100,"postgres_connection_utilization_percent":5}}
# {"network_enabled":false,"restarted":true,"metrics":{"process_count":3,"gateway_authenticated":0,"gateway_reconnect_total":0,"app_rss_bytes":82890752,"app_heap_used_bytes":15059128,"app_heap_total_bytes":32555008,"app_external_bytes":4334348,"app_cpu_percent":21.539,"app_event_loop_delay_p95_ms":30.736383,"app_active_resources":6,"app_active_timers":1,"app_active_sockets":5,"app_active_file_handles":0,"app_active_handles":5,"app_uptime_seconds":0.497,"app_pool_total":1,"app_pool_idle":1,"app_pool_waiting":0,"app_pool_max":4,"worker_rss_bytes":90296320,"worker_heap_used_bytes":13367016,"worker_heap_total_bytes":32391168,"worker_external_bytes":4206782,"worker_cpu_percent":31.359,"worker_event_loop_delay_p95_ms":31.571967,"worker_active_resources":2,"worker_active_timers":1,"worker_active_sockets":1,"worker_active_file_handles":0,"worker_active_handles":1,"worker_uptime_seconds":0.492,"worker_pool_total":0,"worker_pool_idle":0,"worker_pool_waiting":0,"worker_pool_max":2,"gateway_rss_bytes":80003072,"gateway_heap_used_bytes":12689104,"gateway_heap_total_bytes":31604736,"gateway_external_bytes":4206782,"gateway_cpu_percent":7.524,"gateway_event_loop_delay_p95_ms":32.342015,"gateway_active_resources":2,"gateway_active_timers":1,"gateway_active_sockets":1,"gateway_active_file_handles":0,"gateway_active_handles":1,"gateway_uptime_seconds":0.501,"gateway_pool_total":0,"gateway_pool_idle":0,"gateway_pool_waiting":0,"gateway_pool_max":1,"total_rss_bytes":253190144,"total_heap_used_bytes":41115248,"total_cpu_percent":60.422,"sse_clients":0,"projection_backlog":0,"projection_failures":0,"communication_pending":1,"dead_letter":0,"reconciliation_required":0,"postgres_active_connections":2,"postgres_idle_connections":2,"postgres_other_connections":0,"postgres_max_connections":100,"postgres_connection_utilization_percent":4}}
# Subtest: P2-012 Reporter HTTP preserves bound grants, refresh ETag, safe milestones and unlink visibility
ok 417 - P2-012 Reporter HTTP preserves bound grants, refresh ETag, safe milestones and unlink visibility
  ---
  duration_ms: 1994.5043
  type: 'test'
  ...
# Subtest: P2-012 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
ok 418 - P2-012 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
  ---
  duration_ms: 3679.1673
  type: 'test'
  ...
# {"server_commit_response_lost":true,"restart_replayed":true,"incident_confirmed_event_count":1,"unknown_recovery_send_calls":0,"authorized_retry_calls":1,"ack_restart_send_calls":0}
# Subtest: P2-012 both parsed OpenAPI documents declare canonical subscription destinations and service failures
ok 419 - P2-012 both parsed OpenAPI documents declare canonical subscription destinations and service failures
  ---
  duration_ms: 573.1134
  type: 'test'
  ...
# Subtest: P2-012 static authorization, frozen predecessors, scope, schemas and synthetic fixture gate
ok 420 - P2-012 static authorization, frozen predecessors, scope, schemas and synthetic fixture gate
  ---
  duration_ms: 6158.0249
  type: 'test'
  ...
# Subtest: P2-012 live runner fails before network/listener unless all five independent fuses and verified evidence exist
ok 421 - P2-012 live runner fails before network/listener unless all five independent fuses and verified evidence exist
  ---
  duration_ms: 0.9798
  type: 'test'
  ...
# Subtest: P2-012 readiness cannot be fabricated from partial regression, skips, changed inputs or live claims
ok 422 - P2-012 readiness cannot be fabricated from partial regression, skips, changed inputs or live claims
  ---
  duration_ms: 0.2621
  type: 'test'
  ...
# Subtest: P2-012 DONE requires the approved live candidate, client confirmation, clean Incident deliveries and complete regressions
ok 423 - P2-012 DONE requires the approved live candidate, client confirmation, clean Incident deliveries and complete regressions
  ---
  duration_ms: 0.2439
  type: 'test'
  ...
# Subtest: P2-012 frozen candidate permits only the explicit closeout governance set
ok 424 - P2-012 frozen candidate permits only the explicit closeout governance set
  ---
  duration_ms: 0.216
  type: 'test'
  ...
# Subtest: P2-012 review hardening preserves exact paths and requires independent current regression evidence
ok 425 - P2-012 review hardening preserves exact paths and requires independent current regression evidence
  ---
  duration_ms: 0.2799
  type: 'test'
  ...
# Subtest: P2-012 v2 HTTP OpenAPI hardening has an independent closed allowlist and complete regression gate
ok 426 - P2-012 v2 HTTP OpenAPI hardening has an independent closed allowlist and complete regression gate
  ---
  duration_ms: 0.2995
  type: 'test'
  ...
# Subtest: P2-012 subscription review preserves its baseline, scope and independent regression
ok 427 - P2-012 subscription review preserves its baseline, scope and independent regression
  ---
  duration_ms: 0.2826
  type: 'test'
  ...
# Subtest: P2-012 incomplete persisted Candidate summary remains explicit and does not invent clustering evidence
ok 428 - P2-012 incomplete persisted Candidate summary remains explicit and does not invent clustering evidence
  ---
  duration_ms: 2.3205
  type: 'test'
  ...
# Subtest: P2-012 four scope permissions, authorization before replay, expiry maintenance and closed schemas
ok 429 - P2-012 four scope permissions, authorization before replay, expiry maintenance and closed schemas
  ---
  duration_ms: 2723.0237
  type: 'test'
  ...
# Subtest: P2-012 approved-group Reporter discovery persists before direct intake, Sender scope and database guard
ok 430 - P2-012 approved-group Reporter discovery persists before direct intake, Sender scope and database guard
  ---
  duration_ms: 2083.1983
  type: 'test'
  ...
# Subtest: P2-012 real direct-leg eligibility suppresses group-only Ticket artifacts and validates persisted destination scope
ok 431 - P2-012 real direct-leg eligibility suppresses group-only Ticket artifacts and validates persisted destination scope
  ---
  duration_ms: 2125.4897
  type: 'test'
  ...
# Subtest: P2-012 cross-channel same reporter, pending activation, pause, unlink and reporter-safe history
ok 432 - P2-012 cross-channel same reporter, pending activation, pause, unlink and reporter-safe history
  ---
  duration_ms: 2364.468
  type: 'test'
  ...
# Subtest: P2-012 fixed notices reuse sender, restart persistence, explicit UNKNOWN reconciliation and no blind resend
ok 433 - P2-012 fixed notices reuse sender, restart persistence, explicit UNKNOWN reconciliation and no blind resend
  ---
  duration_ms: 2280.71
  type: 'test'
  ...
# Subtest: P2-012 expired direct destinations cannot activate subscriptions and pending reopen never claims activation
ok 434 - P2-012 expired direct destinations cannot activate subscriptions and pending reopen never claims activation
  ---
  duration_ms: 2145.5297
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 1440x900 human confirmation, refresh and accessibility
ok 435 - P2-012 database-backed browser 1440x900 human confirmation, refresh and accessibility
  ---
  duration_ms: 5400.7127
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 1366x768 human confirmation, refresh and accessibility
ok 436 - P2-012 database-backed browser 1366x768 human confirmation, refresh and accessibility
  ---
  duration_ms: 5347.4157
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 390x844 human confirmation, refresh and accessibility
ok 437 - P2-012 database-backed browser 390x844 human confirmation, refresh and accessibility
  ---
  duration_ms: 4963.0877
  type: 'test'
  ...
# Subtest: P2-012 actual HTTP inherits authentication, CSRF, command fence and durable realtime
ok 438 - P2-012 actual HTTP inherits authentication, CSRF, command fence and durable realtime
  ---
  duration_ms: 2427.6103
  type: 'test'
  ...
# Subtest: P2-012 actual HTTP preserves notification failure, rollback and durable replay before explicit recovery
ok 439 - P2-012 actual HTTP preserves notification failure, rollback and durable replay before explicit recovery
  ---
  duration_ms: 3051.1054
  type: 'test'
  ...
# Subtest: reporter identity is HMAC-bound and directory failures defer safely
ok 440 - reporter identity is HMAC-bound and directory failures defer safely
  ---
  duration_ms: 3.0065
  type: 'test'
  ...
# Subtest: direct association follows reliable priorities and never uses userid plus time
ok 441 - direct association follows reliable priorities and never uses userid plus time
  ---
  duration_ms: 1.5394
  type: 'test'
  ...
# Subtest: manual review internal query and resolve default deny before storage access
ok 442 - manual review internal query and resolve default deny before storage access
  ---
  duration_ms: 2.3679
  type: 'test'
  ...
# Subtest: migration 030 supports fresh baseline, check rollback, apply, no-op and five drift failures
ok 443 - migration 030 supports fresh baseline, check rollback, apply, no-op and five drift failures
  ---
  duration_ms: 4116.9567
  type: 'test'
  ...
# Subtest: orchestrator persists three entries, keeps threads separate and replays Ticket/Communication safely
ok 444 - orchestrator persists three entries, keeps threads separate and replays Ticket/Communication safely
  ---
  duration_ms: 2601.1968
  type: 'test'
  ...
# Subtest: rule failure reaches review; authorized keyset query and concurrent human resolution append one override
ok 445 - rule failure reaches review; authorized keyset query and concurrent human resolution append one override
  ---
  duration_ms: 2127.9601
  type: 'test'
  ...
# Subtest: continuation refs are hashed, reporter/bot bound, expiring, revocable and single-use
ok 446 - continuation refs are hashed, reporter/bot bound, expiring, revocable and single-use
  ---
  duration_ms: 2155.4574
  type: 'test'
  ...
# Subtest: migration 001 through 022 and P2-007 runtime are unchanged from origin/main
ok 447 - migration 001 through 022 and P2-007 runtime are unchanged from origin/main
  ---
  duration_ms: 41.3021
  type: 'test'
  ...
# Subtest: strict feature flags default false and reject non-canonical values
ok 448 - strict feature flags default false and reject non-canonical values
  ---
  duration_ms: 2.274
  type: 'test'
  ...
# Subtest: ordinary JSON boundary rejects proxy, accessor, symbol, toJSON, cycles and pollution keys
ok 449 - ordinary JSON boundary rejects proxy, accessor, symbol, toJSON, cycles and pollution keys
  ---
  duration_ms: 0.3356
  type: 'test'
  ...
# Subtest: router protects faults from acknowledgement and maps required examples
ok 450 - router protects faults from acknowledgement and maps required examples
  ---
  duration_ms: 48.7207
  type: 'test'
  ...
# Subtest: ten result codes are reachable and deterministic
ok 451 - ten result codes are reachable and deterministic
  ---
  duration_ms: 64.8716
  type: 'test'
  ...
# Subtest: clinical high risk reaches review and unsupported root cause is never confirmed
ok 452 - clinical high risk reaches review and unsupported root cause is never confirmed
  ---
  duration_ms: 28.9962
  type: 'test'
  ...
# Subtest: gold manifest references all 96 + 42 + 64 frozen cases with ten routes
ok 453 - gold manifest references all 96 + 42 + 64 frozen cases with ten routes
  ---
  duration_ms: 2.1894
  type: 'test'
  ...
# Subtest: crash before commit leaves no partial facts; crash after commit restarts as replay
ok 454 - crash before commit leaves no partial facts; crash after commit restarts as replay
  ---
  duration_ms: 3558.3125
  type: 'test'
  ...
# {"crash_before_commit_partial_facts":{"journeys":0,"decisions":0,"tickets":0},"crash_after_commit":{"journeys":1,"decisions":1,"tickets":1},"restart_processed":0,"replay_duplicate_delta":0}
# Subtest: bounded worker processes 500 journeys, 2000 turns, 500 decisions and 100 reviews on one worker
ok 455 - bounded worker processes 500 journeys, 2000 turns, 500 decisions and 100 reviews on one worker
  ---
  duration_ms: 12150.4823
  type: 'test'
  ...
# {"journeys":500,"turns":2000,"decisions":500,"reviews":100,"worker_count":1,"pool_max":4,"batch_max":100,"heap_samples_bytes":[16628152,16608768,19693208,29610984,23057752,17001624],"heap_fall_or_stable":true,"timer_active_after_stop":false,"soak_24h":false}
# Subtest: worker defaults are bounded and disabled flags claim nothing
ok 456 - worker defaults are bounded and disabled flags claim nothing
  ---
  duration_ms: 2.4614
  type: 'test'
  ...
# Subtest: worker rejects batches above maximum without querying storage
ok 457 - worker rejects batches above maximum without querying storage
  ---
  duration_ms: 0.6397
  type: 'test'
  ...
# Subtest: P2-016 bounded capacity: 500 Tickets / 5000 events / 200 review resolutions / 500 cards / 100 sessions / 32 SSE
ok 458 - P2-016 bounded capacity: 500 Tickets / 5000 events / 200 review resolutions / 500 cards / 100 sessions / 32 SSE
  ---
  duration_ms: 57261.6052
  type: 'test'
  ...
# {"tickets":500,"ticket_events":5000,"review_resolutions":200,"cards":500,"group_receipts":400,"reporter_sessions":100,"pool_max":4,"sse_max":32,"sse_after_stop":0,"heap_samples_bytes":[14727984,30296384,38439192,52488936,41873856,29837256,57616880,28408376,51042496,73064056,44258048,65751992,35240744,56963992,18153960,39618936,61112768,37928464,55841080,28512160,45574032,61258232,30384504,47014928,62135248,30633640,46584240,57082096,28282912,19106464],"heap_peak_bytes":73064056,"heap_final_bytes":19106464,"heap_fall_or_stable":true,"real_sdk_calls":0,"soak_24h":false}
# {"cleanup":{"database_count":0,"backend_count":0}}
# Subtest: P2-016 plain JSON excludes active objects without invoking user hooks
ok 459 - P2-016 plain JSON excludes active objects without invoking user hooks
  ---
  duration_ms: 3.5481
  type: 'test'
  ...
# Subtest: P2-016 strict command, versions, closed keys and bounded lists
ok 460 - P2-016 strict command, versions, closed keys and bounded lists
  ---
  duration_ms: 2.2949
  type: 'test'
  ...
# Subtest: notification policy includes created
ok 461 - notification policy includes created
  ---
  duration_ms: 0.3275
  type: 'test'
  ...
# Subtest: notification policy includes accepted
ok 462 - notification policy includes accepted
  ---
  duration_ms: 0.1402
  type: 'test'
  ...
# Subtest: notification policy includes started
ok 463 - notification policy includes started
  ---
  duration_ms: 0.1179
  type: 'test'
  ...
# Subtest: notification policy includes resumed
ok 464 - notification policy includes resumed
  ---
  duration_ms: 0.21
  type: 'test'
  ...
# Subtest: notification policy includes waiting_requester
ok 465 - notification policy includes waiting_requester
  ---
  duration_ms: 0.1079
  type: 'test'
  ...
# Subtest: notification policy includes waiting_vendor
ok 466 - notification policy includes waiting_vendor
  ---
  duration_ms: 0.0818
  type: 'test'
  ...
# Subtest: notification policy includes resolved
ok 467 - notification policy includes resolved
  ---
  duration_ms: 0.1033
  type: 'test'
  ...
# Subtest: notification policy includes closed
ok 468 - notification policy includes closed
  ---
  duration_ms: 0.2688
  type: 'test'
  ...
# Subtest: notification policy includes reopened
ok 469 - notification policy includes reopened
  ---
  duration_ms: 0.179
  type: 'test'
  ...
# Subtest: notification policy includes cancelled
ok 470 - notification policy includes cancelled
  ---
  duration_ms: 0.3062
  type: 'test'
  ...
# Subtest: notes and assignment changes never become external free-text notifications
ok 471 - notes and assignment changes never become external free-text notifications
  ---
  duration_ms: 0.2659
  type: 'test'
  ...
# Subtest: template card exact shape, last-four and safe immutable view
ok 472 - template card exact shape, last-four and safe immutable view
  ---
  duration_ms: 1.3502
  type: 'test'
  ...
# Subtest: card rejects unsafe origin javascript:alert(1)
ok 473 - card rejects unsafe origin javascript:alert(1)
  ---
  duration_ms: 0.1892
  type: 'test'
  ...
# Subtest: card rejects unsafe origin data:text/html,x
ok 474 - card rejects unsafe origin data:text/html,x
  ---
  duration_ms: 0.1086
  type: 'test'
  ...
# Subtest: card rejects unsafe origin file:///x
ok 475 - card rejects unsafe origin file:///x
  ---
  duration_ms: 0.0717
  type: 'test'
  ...
# Subtest: card rejects unsafe origin http://reporter.example.test
ok 476 - card rejects unsafe origin http://reporter.example.test
  ---
  duration_ms: 0.0706
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://attacker.invalid
ok 477 - card rejects unsafe origin https://attacker.invalid
  ---
  duration_ms: 0.0704
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://[userinfo]@reporter.example.test
ok 478 - card rejects unsafe origin https://[userinfo]@reporter.example.test
  ---
  duration_ms: 0.0479
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://reporter.example.test/?grant=abc
ok 479 - card rejects unsafe origin https://reporter.example.test/?grant=abc
  ---
  duration_ms: 0.0495
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://reporter.example.test/\#x
ok 480 - card rejects unsafe origin https://reporter.example.test/\#x
  ---
  duration_ms: 0.0567
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://reporter.example.test/path
ok 481 - card rejects unsafe origin https://reporter.example.test/path
  ---
  duration_ms: 0.0638
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":0}
ok 482 - sender accepts only explicit numeric ACK {"errcode":0}
  ---
  duration_ms: 1.2286
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"body":{"errcode":0}}
ok 483 - sender accepts only explicit numeric ACK {"body":{"errcode":0}}
  ---
  duration_ms: 0.3473
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {}
ok 484 - sender accepts only explicit numeric ACK {}
  ---
  duration_ms: 0.3324
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":"0"}
ok 485 - sender accepts only explicit numeric ACK {"errcode":"0"}
  ---
  duration_ms: 1.0889
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":null}
ok 486 - sender accepts only explicit numeric ACK {"errcode":null}
  ---
  duration_ms: 0.3041
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":40001}
ok 487 - sender accepts only explicit numeric ACK {"errcode":40001}
  ---
  duration_ms: 0.2867
  type: 'test'
  ...
# Subtest: sender fail-closed {"enabled":false}
ok 488 - sender fail-closed {"enabled":false}
  ---
  duration_ms: 0.1313
  type: 'test'
  ...
# Subtest: sender fail-closed {"cardEnabled":false}
ok 489 - sender fail-closed {"cardEnabled":false}
  ---
  duration_ms: 0.0695
  type: 'test'
  ...
# Subtest: sender fail-closed {"target":"not-allowlisted"}
ok 490 - sender fail-closed {"target":"not-allowlisted"}
  ---
  duration_ms: 0.1345
  type: 'test'
  ...
# Subtest: sender fail-closed {"binding":false}
ok 491 - sender fail-closed {"binding":false}
  ---
  duration_ms: 0.2042
  type: 'test'
  ...
# Subtest: gateway unavailable before network is retry-safe, no SDK call
ok 492 - gateway unavailable before network is retry-safe, no SDK call
  ---
  duration_ms: 0.4567
  type: 'test'
  ...
# Subtest: live inbound is clipped before persistence by approved bot, person and group hashes
ok 493 - live inbound is clipped before persistence by approved bot, person and group hashes
  ---
  duration_ms: 0.5102
  type: 'test'
  ...
# Subtest: Ticket delivery operator commands authorize before receipt, persist idempotence and never blindly retry UNKNOWN
ok 494 - Ticket delivery operator commands authorize before receipt, persist idempotence and never blindly retry UNKNOWN
  ---
  duration_ms: 2491.9603
  type: 'test'
  ...
# Subtest: P2-016 real-format group wakeup and direct description remain one Journey through public queries
ok 495 - P2-016 real-format group wakeup and direct description remain one Journey through public queries
  ---
  duration_ms: 2193.2267
  type: 'test'
  ...
# Subtest: P2-016 group-to-direct unique binding preserves Journey; ambiguous, consumed and expired candidates never guess
ok 496 - P2-016 group-to-direct unique binding preserves Journey; ambiguous, consumed and expired candidates never guess
  ---
  duration_ms: 8160.7175
  type: 'test'
  ...
# Subtest: P2-016 later same-group description preserves the recorded entry mode instead of rejecting the Journey
ok 497 - P2-016 later same-group description preserves the recorded entry mode instead of rejecting the Journey
  ---
  duration_ms: 1946.094
  type: 'test'
  ...
# Subtest: P2-016 approved topology uses three real bounded processes, rule-first Worker and zero live SDK calls
ok 498 - P2-016 approved topology uses three real bounded processes, rule-first Worker and zero live SDK calls
  ---
  duration_ms: 3559.6369
  type: 'test'
  ...
# {"process_count":3,"pool_max":7,"live_provider_calls":0,"rule_first_worker":true}
# Subtest: P2-016 live harness requires exact owner fuses and HTTPS bounded configuration, without logging secrets
ok 499 - P2-016 live harness requires exact owner fuses and HTTPS bounded configuration, without logging secrets
  ---
  duration_ms: 2.9838
  type: 'test'
  ...
# Subtest: P2-016 live requires an exact verified candidate and at least 15 minutes; cannot claim final completion
ok 500 - P2-016 live requires an exact verified candidate and at least 15 minutes; cannot claim final completion
  ---
  duration_ms: 0.3467
  type: 'test'
  ...
# Subtest: P2-016 live CLI with no approvals exits before DB, listener, Evidence or SDK work
ok 501 - P2-016 live CLI with no approvals exits before DB, listener, Evidence or SDK work
  ---
  duration_ms: 216.8926
  type: 'test'
  ...
# Subtest: P2-016 review resolution and Safe Action commit or roll back together
ok 502 - P2-016 review resolution and Safe Action commit or roll back together
  ---
  duration_ms: 1684.478
  type: 'test'
  ...
# Subtest: P2-016 migration is atomic, check-only, exact, reentrant and drift-failing
    # Subtest: rejects table drift
    ok 1 - rejects table drift
      ---
      duration_ms: 29.5034
      type: 'test'
      ...
    # Subtest: rejects column drift
    ok 2 - rejects column drift
      ---
      duration_ms: 16.9804
      type: 'test'
      ...
    # Subtest: rejects type drift
    ok 3 - rejects type drift
      ---
      duration_ms: 27.9321
      type: 'test'
      ...
    # Subtest: rejects default drift
    ok 4 - rejects default drift
      ---
      duration_ms: 17.5094
      type: 'test'
      ...
    # Subtest: rejects constraint drift
    ok 5 - rejects constraint drift
      ---
      duration_ms: 16.7425
      type: 'test'
      ...
    # Subtest: rejects index drift
    ok 6 - rejects index drift
      ---
      duration_ms: 16.4031
      type: 'test'
      ...
    # Subtest: rejects foreign_key drift
    ok 7 - rejects foreign_key drift
      ---
      duration_ms: 17.9508
      type: 'test'
      ...
    1..7
ok 503 - P2-016 migration is atomic, check-only, exact, reentrant and drift-failing
  ---
  duration_ms: 2053.5136
  type: 'test'
  ...
# Subtest: P2-016 persisted card delivery, HMAC grants, one-use sessions and reporter-safe timeline
ok 504 - P2-016 persisted card delivery, HMAC grants, one-use sessions and reporter-safe timeline
  ---
  duration_ms: 1584.8421
  type: 'test'
  ...
# Subtest: P2-016 existing rule worker creates Ticket notifications, safe group/direct guidance and SYSTEM-only timeout closure
ok 505 - P2-016 existing rule worker creates Ticket notifications, safe group/direct guidance and SYSTEM-only timeout closure
  ---
  duration_ms: 1945.6639
  type: 'test'
  ...
# Subtest: Reporter browser 1440x900 real DB/session, fragment removal, refresh, timezone, safe data and logout
ok 506 - Reporter browser 1440x900 real DB/session, fragment removal, refresh, timezone, safe data and logout
  ---
  duration_ms: 3599.668
  type: 'test'
  ...
# Subtest: Reporter browser 390x844 real DB/session, fragment removal, refresh, timezone, safe data and logout
ok 507 - Reporter browser 390x844 real DB/session, fragment removal, refresh, timezone, safe data and logout
  ---
  duration_ms: 4381.1486
  type: 'test'
  ...
# Subtest: Reporter grant expiry, HMAC rotation, one-consume concurrency, session expiry/revocation and cross-ticket isolation
ok 508 - Reporter grant expiry, HMAC rotation, one-consume concurrency, session expiry/revocation and cross-ticket isolation
  ---
  duration_ms: 2095.5841
  type: 'test'
  ...
# Subtest: P2-016 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
ok 509 - P2-016 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
  ---
  duration_ms: 3828.8646
  type: 'test'
  ...
# {"server_commit_response_lost":true,"restart_replayed":true,"ticket_event_count":1,"unknown_recovery_send_calls":0,"authorized_retry_calls":1,"ack_restart_send_calls":0}
# Subtest: P2-016 architecture guards preserve authorization, immutable baselines and closed contracts
ok 510 - P2-016 architecture guards preserve authorization, immutable baselines and closed contracts
  ---
  duration_ms: 2157.6654
  type: 'test'
  ...
# Subtest: P2-016 default validator still requires readiness Evidence; deferred source checks cannot authorize live work
ok 511 - P2-016 default validator still requires readiness Evidence; deferred source checks cannot authorize live work
  ---
  duration_ms: 1612.7642
  type: 'test'
  ...
# Subtest: P2-016 schemas and declarations exist; Reporter outputs cannot contain internal identity or credentials
ok 512 - P2-016 schemas and declarations exist; Reporter outputs cannot contain internal identity or credentials
  ---
  duration_ms: 13.2122
  type: 'test'
  ...
# Subtest: JSON contract rejects extra keys, noncanonical types and offset time
ok 513 - JSON contract rejects extra keys, noncanonical types and offset time
  ---
  duration_ms: 4.6682
  type: 'test'
  ...
# Subtest: P2-016 closeout freezes every business input and the exact file set
ok 514 - P2-016 closeout freezes every business input and the exact file set
  ---
  duration_ms: 0.3713
  type: 'test'
  ...
# Subtest: P2-016 completion requires owner approval, precise candidates, live duration and zero-skip final regression
ok 515 - P2-016 completion requires owner approval, precise candidates, live duration and zero-skip final regression
  ---
  duration_ms: 0.5072
  type: 'test'
  ...
# Subtest: Real DB internal browser traverses every user lifecycle action, transfer and atomic takeover/accept
ok 516 - Real DB internal browser traverses every user lifecycle action, transfer and atomic takeover/accept
  ---
  duration_ms: 6453.6164
  type: 'test'
  ...
# Subtest: P2-016 Ticket lifecycle, command persistence, authorization and independent responsibility
ok 517 - P2-016 Ticket lifecycle, command persistence, authorization and independent responsibility
  ---
  duration_ms: 3495.5098
  type: 'test'
  ...
# Subtest: P2-016 native browser 1440x900 command, review, refresh, SSE, polling, XSS and auth-expiry
ok 518 - P2-016 native browser 1440x900 command, review, refresh, SSE, polling, XSS and auth-expiry
  ---
  duration_ms: 7156.4175
  type: 'test'
  ...
# Subtest: P2-016 native browser 390x844 command, review, refresh, SSE, polling, XSS and auth-expiry
ok 519 - P2-016 native browser 390x844 command, review, refresh, SSE, polling, XSS and auth-expiry
  ---
  duration_ms: 7029.6897
  type: 'test'
  ...
# Subtest: confirmation survives realtime refetch and rejects a stale version instead of overwriting the form
ok 520 - confirmation survives realtime refetch and rejects a stale version instead of overwriting the form
  ---
  duration_ms: 1237.9898
  type: 'test'
  ...
# Subtest: P2-016 actual HTTP assembly: fail-closed flags, auth, CSRF, Ticket actions and durable SSE
ok 521 - P2-016 actual HTTP assembly: fail-closed flags, auth, CSRF, Ticket actions and durable SSE
  ---
  duration_ms: 2243.5619
  type: 'test'
  ...
# Subtest: P2-G1 system browser duplicate submit fence sends one human reply and preserves safe rendering
ok 522 - P2-G1 system browser duplicate submit fence sends one human reply and preserves safe rendering
  ---
  duration_ms: 1458.0354
  type: 'test'
  ...
# {"browser":"C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe","viewport":{"width":390,"height":844},"replay_events":100,"realtime_list_calls":3,"duplicate_submit_calls":1,"polling_fallback":true,"xss_executed":false,"horizontal_overflow":false}
# Subtest: P2-G1 system browser preserves native SSE reconnect and sends Last-Event-ID
ok 523 - P2-G1 system browser preserves native SSE reconnect and sends Last-Event-ID
  ---
  duration_ms: 4317.2269
  type: 'test'
  ...
# {"sse_connections":2,"last_event_id_used":true,"polling_stopped_after_reconnect":true}
# Subtest: P2-G1 live browser sessions navigate to the actual Workbench route with isolated cookies
ok 524 - P2-G1 live browser sessions navigate to the actual Workbench route with isolated cookies
  ---
  duration_ms: 3239.6888
  type: 'test'
  ...
# {"browser_sessions":2,"workbench_route_requests":2,"isolated_cookie_headers":true,"root_not_requested":true,"safe_telemetry":true}
# Subtest: P2-G1 P1 commit, durable projection recovery, duplicate idempotency, participant isolation and catalog invariance
ok 525 - P2-G1 P1 commit, durable projection recovery, duplicate idempotency, participant isolation and catalog invariance
  ---
  duration_ms: 2630.0243
  type: 'test'
  ...
# {"tickets":3,"duplicate_ticket_delta":0,"duplicate_item_delta":0,"participant_sessions":3,"first_versions":[1,1],"next_versions":[2,2],"p1_survived_projection_failure":true,"recovery_backlog":0,"catalog_unchanged":true}
# Subtest: P2-G1 different Intake atomically ends the prior participant Session before opening the next
ok 526 - P2-G1 different Intake atomically ends the prior participant Session before opening the next
  ---
  duration_ms: 2310.5066
  type: 'test'
  ...
# {"different_intake_sessions":2,"prior_ended":1,"active_sessions":1,"active_versions":[1,1],"projection_failures":0}
# Subtest: P2-G1 fault paths serialize takeover, isolate internal note, deduplicate reply and recover delivery without blind resend
ok 527 - P2-G1 fault paths serialize takeover, isolate internal note, deduplicate reply and recover delivery without blind resend
  ---
  duration_ms: 2600.4247
  type: 'test'
  ...
# {"concurrent_takeover_winners":1,"internal_note":{"message":1,"outbox":0,"delivery":0},"duplicate_reply_parallel":12,"reply":{"messages":1,"outboxes":1,"deliveries":1},"gateway_unavailable_pending":true,"reconnect_provider_calls":1,"unknown_reconciliation":true,"ai_calls":0,"ocr_calls":0}
# Subtest: P2-G1 local runtime binds one loopback App and reports human-only readiness with strict Test Auth
ok 528 - P2-G1 local runtime binds one loopback App and reports human-only readiness with strict Test Auth
  ---
  duration_ms: 2309.9342
  type: 'test'
  ...
# {"app_processes":1,"loopback_http":true,"readiness":true,"gateway_required":false,"active_gateway_count":0,"projection_batch":20,"communication_batch":20,"communication_sender":"MOCK","sse_client_cap":32,"dynamic_realtime_authorization":true,"test_auth_http_only":true,"human_only":true}
# Subtest: P2-G1 process cluster runs App, Worker and Gateway in three bounded Node processes
ok 529 - P2-G1 process cluster runs App, Worker and Gateway in three bounded Node processes
  ---
  duration_ms: 2871.9657
  type: 'test'
  ...
# {"process_count":3,"app_pool_max":4,"worker_pool_max":2,"gateway_pool_max":1,"combined_runtime":false,"raw_identifiers_recorded":false}
# Subtest: P2-G1 isolated PostgreSQL Replay Gap drives real Edge through Last-Event-ID, 410 and refetch
ok 530 - P2-G1 isolated PostgreSQL Replay Gap drives real Edge through Last-Event-ID, 410 and refetch
  ---
  duration_ms: 15859.8868
  type: 'test'
  ...
# {"http_status":410,"last_event_id":true,"refetch":["LIST","DETAIL","TIMELINE"],"process_count":3,"isolated_database_cleanup":true}
# Subtest: P2-G1 bounded capacity projects 1000 synthetic inbound facts and drains 500 deliveries with no catalog drift
ok 531 - P2-G1 bounded capacity projects 1000 synthetic inbound facts and drains 500 deliveries with no catalog drift
  ---
  duration_ms: 46009.7944
  type: 'test'
  ...
# {"synthetic_inbound":1000,"projected":1000,"delivery_backlog":500,"delivery_sent":500,"sender_calls":500,"projector_batch":20,"delivery_batch":20,"pool_max":4,"catalog_unchanged":true,"oom":0,"soak_24h":false}
# Subtest: live CLI exposes only the six explicit modes and requires three process fuses for sending
ok 532 - live CLI exposes only the six explicit modes and requires three process fuses for sending
  ---
  duration_ms: 1.7309
  type: 'test'
  ...
# Subtest: gateway process can commit inbound before the App process projects it
ok 533 - gateway process can commit inbound before the App process projects it
  ---
  duration_ms: 0.9911
  type: 'test'
  ...
# Subtest: process resource interface exposes bounded role metrics without a PID or environment
ok 534 - process resource interface exposes bounded role metrics without a PID or environment
  ---
  duration_ms: 1.0198
  type: 'test'
  ...
# Subtest: gateway permits one active WSClient, gates readiness on authentication, reconnects and shuts down cleanly
ok 535 - gateway permits one active WSClient, gates readiness on authentication, reconnects and shuts down cleanly
  ---
  duration_ms: 3.187
  type: 'test'
  ...
# Subtest: sender enforces persistent target hash allowlist and maps ACK, explicit rejection, unknown and gateway-unavailable safely
ok 536 - sender enforces persistent target hash allowlist and maps ACK, explicit rejection, unknown and gateway-unavailable safely
  ---
  duration_ms: 1.2751
  type: 'test'
  ...
# Subtest: test authentication is server-configured, active non-reporter only, short-lived and emits strict HttpOnly cookie metadata
ok 537 - test authentication is server-configured, active non-reporter only, short-lived and emits strict HttpOnly cookie metadata
  ---
  duration_ms: 1.0626
  type: 'test'
  ...
# Subtest: test authentication isolates two configured principals with independent short-lived cookies and CSRF values
ok 538 - test authentication isolates two configured principals with independent short-lived cookies and CSRF values
  ---
  duration_ms: 0.7123
  type: 'test'
  ...
# Subtest: live harness requires two distinct configured principals and creates a safe unique run id
ok 539 - live harness requires two distinct configured principals and creates a safe unique run id
  ---
  duration_ms: 0.2705
  type: 'test'
  ...
# Subtest: disabled coordinator performs no database work and batch/stream inventory are bounded
ok 540 - disabled coordinator performs no database work and batch/stream inventory are bounded
  ---
  duration_ms: 0.3354
  type: 'test'
  ...
# Subtest: temporary database failure is isolated behind stable projection errors without raw details or false success
ok 541 - temporary database failure is isolated behind stable projection errors without raw details or false success
  ---
  duration_ms: 0.5445
  type: 'test'
  ...
# Subtest: P2-002 transaction hook is optional and P2-G1 browser source has an in-flight duplicate-submit fence
ok 542 - P2-002 transaction hook is optional and P2-G1 browser source has an in-flight duplicate-submit fence
  ---
  duration_ms: 2.8508
  type: 'test'
  ...
# Subtest: live script has no broad --live mode and no default live-send npm command
ok 543 - live script has no broad --live mode and no default live-send npm command
  ---
  duration_ms: 3.8173
  type: 'test'
  ...
# Subtest: shared pg factory preserves date/time/timestamp/timestamptz/tsrange/BIGINT strings and JSON objects
ok 544 - shared pg factory preserves date/time/timestamp/timestamptz/tsrange/BIGINT strings and JSON objects
  ---
  duration_ms: 43.7942
  type: 'test'
  ...
# Subtest: shared pg factory rejects Date recursively before sending SQL
ok 545 - shared pg factory rejects Date recursively before sending SQL
  ---
  duration_ms: 28.9775
  type: 'test'
  ...
# Subtest: LocalDate, LocalTime, and LocalDateTime accept real Asia/Shanghai calendar values
ok 546 - LocalDate, LocalTime, and LocalDateTime accept real Asia/Shanghai calendar values
  ---
  duration_ms: 0.7655
  type: 'test'
  ...
# Subtest: LocalDateTime rejects invalid dates, T/Z/UTC/offset/IANA, fractions, whitespace, and objects
ok 547 - LocalDateTime rejects invalid dates, T/Z/UTC/offset/IANA, fractions, whitespace, and objects
  ---
  duration_ms: 1.1304
  type: 'test'
  ...
# Subtest: PhysicalEpochMs remains a canonical non-negative decimal string and round-trips Shanghai local seconds
ok 548 - PhysicalEpochMs remains a canonical non-negative decimal string and round-trips Shanghai local seconds
  ---
  duration_ms: 0.3944
  type: 'test'
  ...
# Subtest: explicit Asia/Shanghai formatter is invariant under UTC, Tokyo, and New York process TZ
ok 549 - explicit Asia/Shanghai formatter is invariant under UTC, Tokyo, and New York process TZ
  ---
  duration_ms: 191.1273
  type: 'test'
  ...
# Subtest: V1.3 compatibility command delegates to active V1.4 validation
ok 550 - V1.3 compatibility command delegates to active V1.4 validation
  ---
  duration_ms: 98.5933
  type: 'test'
  ...
# Subtest: V1.4 architecture validator passes
ok 551 - V1.4 architecture validator passes
  ---
  duration_ms: 81.2169
  type: 'test'
  ...
# Subtest: P2/P2-G1 lifecycle state is internally consistent without changing P1
ok 552 - P2/P2-G1 lifecycle state is internally consistent without changing P1
  ---
  duration_ms: 8.1112
  type: 'test'
  ...
# Subtest: P2-004 independent authorization and stop line are preserved
ok 553 - P2-004 independent authorization and stop line are preserved
  ---
  duration_ms: 0.7814
  type: 'test'
  ...
# Subtest: P2-005 independent authorization and stop line are recorded
ok 554 - P2-005 independent authorization and stop line are recorded
  ---
  duration_ms: 0.67
  type: 'test'
  ...
# Subtest: P2-006 independent authorization and stop line are recorded
ok 555 - P2-006 independent authorization and stop line are recorded
  ---
  duration_ms: 0.6515
  type: 'test'
  ...
# Subtest: P2-004 completion artifacts preserve P1 notification and Ticket ownership
ok 556 - P2-004 completion artifacts preserve P1 notification and Ticket ownership
  ---
  duration_ms: 2.6745
  type: 'test'
  ...
# Subtest: P2-005 completion artifacts preserve frozen Session and identity ownership
ok 557 - P2-005 completion artifacts preserve frozen Session and identity ownership
  ---
  duration_ms: 0.7718
  type: 'test'
  ...
# Subtest: P2-006 completion has a runnable workbench and no migration 022
ok 558 - P2-006 completion has a runnable workbench and no migration 022
  ---
  duration_ms: 1.5124
  type: 'test'
  ...
# Subtest: P2-001 and P2-002 frozen artifacts remain present
ok 559 - P2-001 and P2-002 frozen artifacts remain present
  ---
  duration_ms: 0.3494
  type: 'test'
  ...
# Subtest: P3 remains greenfield and contains no historical ticket program
ok 560 - P3 remains greenfield and contains no historical ticket program
  ---
  duration_ms: 1.6808
  type: 'test'
  ...
# Subtest: future flags default off without legacy import flags
ok 561 - future flags default off without legacy import flags
  ---
  duration_ms: 0.8517
  type: 'test'
  ...
# Subtest: conceptual schema has no historical migration fields or second ticket core
ok 562 - conceptual schema has no historical migration fields or second ticket core
  ---
  duration_ms: 0.747
  type: 'test'
  ...
# Subtest: new source example is non-authoritative
ok 563 - new source example is non-authoritative
  ---
  duration_ms: 0.5773
  type: 'test'
  ...
# Subtest: 2C4G limits remain conservative
ok 564 - 2C4G limits remain conservative
  ---
  duration_ms: 1.1516
  type: 'test'
  ...
# Subtest: P2-016 authorization reconciles only the historical P2-015 ledger
ok 565 - P2-016 authorization reconciles only the historical P2-015 ledger
  ---
  duration_ms: 4.9037
  type: 'test'
  ...
# Subtest: architecture validator rejects the historical P2-015 ledger drift
ok 566 - architecture validator rejects the historical P2-015 ledger drift
  ---
  duration_ms: 24.4352
  type: 'test'
  ...
# Subtest: P2-012 authorization rejects premature completion and next-gate authorization
ok 567 - P2-012 authorization rejects premature completion and next-gate authorization
  ---
  duration_ms: 0.7539
  type: 'test'
  ...
1..567
# tests 574
# suites 0
# pass 574
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 663011.632
````

</details>

最终静态门禁：P2-012 252、P2-016 146、ARCH-006 260、V1.4 403 checks 全部通过；V1.4测试17/17，全部exit0。
