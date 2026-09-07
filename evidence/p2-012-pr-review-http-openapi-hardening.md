# P2-012 PR #6 HTTP / OpenAPI Review hardening

日期：2026-09-07，Asia/Shanghai。状态：PASS；570/570 完整串行回归与最终静态门禁全部通过。仅本地合成验证，不是新一轮现场、P2-G2 或生产批准。

基线：`14557b9f6191a08434652550127f42360c97bffe`。Review comments：3948007171、3948007180。独立第四提交标题固定为 `fix(p2): preserve service errors and align destination OpenAPI`；本文件不写自身提交 SHA，以 `git log --oneline origin/main..HEAD` 解析。前三提交不改写，远端仍为第三提交；不 push、merge、tag、release 或 resolve review thread。

## 根因与修复

原 HTTP 层用 `result.ok ? 200 : 409` 覆盖失败收据的服务错误分类。新增封闭 stable-code mapper，复用原 Plain JSON 验证，拒绝 getter、Proxy、toJSON、额外字段和不完整 result；未知失败返回稳定 503。成功仍 200，所有 POST 共享同一 mapper，外层 WorkbenchError 处理与现有安全 Body 不变。FAILED receipt 仍 retryable=false，同 ID 不重新执行。

UI/Query 原本使用单 Subscription 的 nested destination GET；两个 OpenAPI 漏写该路由。本轮只补 Contract，保留 ADMIN Incident-level 管理读取。嵌套 GET 有独立 operationId、两项 UUID 参数、limit/cursor、认证与 ADMIN/Feature Flag 声明。主文档补齐被引用的认证定义。相关 flow-style 响应描述加引号，避免逗号被解析成额外 YAML 字段。没有修改 Query、Direct Leg 或事务语义。

## Stable error → HTTP status

成功结果为 200；未知/恶意/不完整失败结果为 503。下表涵盖全部冻结 stable codes，100 次确定性及首次/重放均经 Unit 验证。

| HTTP | Stable code（统一前缀 P2_012_） |
|---|---|
| 400 | CURSOR_INVALID、INPUT_INVALID、LIMIT_INVALID |
| 403 | FORBIDDEN、LIVE_APPROVAL_REQUIRED |
| 404 | NOT_FOUND、SOURCE_NOT_FOUND |
| 409 | COMMAND_CONFLICT、DIRECT_DESTINATION_REQUIRED、EXPIRY_CONFLICT、OWNER_INVALID、PRIMARY_NOT_LINKED、PRIMARY_STILL_LINKED、REPORT_ALREADY_LINKED、SOURCE_CONFLICT、SOURCE_EVIDENCE_INCOMPLETE、STATE_CONFLICT、TICKET_ALREADY_LINKED、VERSION_CONFLICT |
| 503 | COMMAND_FAILED、DISABLED、FLAG_INVALID、NOTIFICATION_EVENT_INVALID、NOTIFICATION_FAILED |

## 实际 HTTP、数据库与 UI 证据

修复前实际 PostgreSQL + HTTP 定向复现：`node --env-file=.env.pilot --test --test-concurrency=1 --test-name-pattern='preserves notification failure' tests/p2-012-workbench.integration.test.mjs`，1 test / 0 pass / 1 fail / exit=1，断言为 `409 !== 503`。修复后同一测试通过。

第二条 Communication append 在既有 conflict 返回 seam 注入故障，第一条已经写入真实 Message/Outbox/Delivery。真实 Notification Policy 产生 P2_012_NOTIFICATION_FAILED，命令 Savepoint 回滚；Incident/Report/Event/Subscription/Binding/Message/Outbox/Delivery/Realtime 增量全部 0。Candidate 保持 UNDER_REVIEW/version=2，只有该命令的一条 FAILED receipt，retryable=false。首次 HTTP 503，依赖恢复后同 ID 仍 503/replayed=true，不增加 append 调用。新 ID 使用仍有效 version=2 成功 200；首次确认只产生 1 Incident、4 Reports、4 Subscriptions、3 组 Binding/Message/Outbox/Delivery。随后独立验证第二 Incident 的授权裁剪；版本/状态冲突409、权限403、找不到404、非法输入400。

Actual nested route 只返回目标 Subscription 的 id/subscription_id/source_intake_no；两个不同 Reporter 的 Direct Leg 互不泄漏。ADMIN 200，DISPATCHER/HANDLER 403，无权访问的 Incident 404。未知或其他 Incident 的 Subscription 在可访问 Incident 下为空 200。Incident-level 分页读取单独验证，错误 scope cursor、非法 limit/cursor 为400；超出整个 URI 上限时由既有外层返回414，未新增运行时404或调整授权。

三个尺寸（1440×900、1366×768、390×844）使用真实数据库与浏览器，在 UI 网络 seam 注入503：显示“服务暂时不可用，本次业务未提交。请刷新确认状态后稍后重试。”，不显示版本冲突/乐观成功，refetch 后保持权威旧状态，POST=1，无自动重试。PENDING_DESTINATION 操作捕获到 nested GET。网络未知的同 ID reconciliation 提示未改。新截图保存在 ignored tmp；旧截图从未覆盖。

Contract 可发现性：两个文档解析出的 GET path、operationId、参数与认证定义均存在；沿用相邻 read route 的描述式响应，本轮没有运行代码生成器或构建生成客户端。YAML 测试使用本机已安装 Python/PyYAML 6.0.3，未新增 npm 依赖。

## 验证与失败记录

最终 Targeted：15/15，exit=0；最终完整串行：570/570，exit=0，fail/cancelled/skipped/todo=0，672469.4451 ms。命令为附件要求的 `node --env-file=.env.pilot --test --test-concurrency=1 --test-reporter=tap tests/*.test.mjs`。没有提高超时、删除旧断言、skip Browser/PostgreSQL 或减少测试。运行期间只对本次 PowerShell 会话设置防休眠，测试结束已释放。

新增浏览器探针第一次 Targeted 为14/15，因订阅按钮尚未异步加载就点击；只补充对既有按钮的等待，原超时不变。原始失败 TAP 留在 `tmp/p2012-http-openapi/targeted.tap`，SHA-256 `20705777c46acb8744ef293de0c80a2264a1bb797bb5d7ce48f7ec35c927078d`。之后最终 Targeted 与首次完整回归全部通过。

完整原始 TAP：`tmp/p2012-http-openapi/full.tap`，SHA-256 `6554fd3186d43b10b25b20b72263e7c804be6fd558ce8713a7f90bbb7e11a05c`。下方内嵌 TAP 仅统一换行并移除行尾空白，不替代保留的原始文件。

## 冻结与关闭边界

对 baseline 的受保护路径 git diff exit=0：migration 001～032、database catalog 源、P2-007、命令事务、Notification Policy、Query、Direct Leg、Candidate maintenance、现场 JSONL/ACK、Owner Approval、旧截图、v1 Hardening Evidence 均未改。v1 Evidence SHA-256：`46893a985f41615d21010273e84ecdba6d69b703415037f8bbfc5114193ffc1d`。原完成报告除新增 pr_review_http_openapi_hardening 字段外，与第三提交深度相等。v1 路径函数不放宽；v2 独立检查 exact allowlist、第三提交基线、第四提交标题、至少566全量通过与零资源残留。

没有数据库变更、新常驻进程/Worker/Timer/Pool/Socket；测试池上限4，完整回归串行。三个 Incident 默认开关保持false即关闭，无 down migration；若需撤销第四提交，须另行授权。20个持久 Feature Flag 均false。P2-012仍DONE，P2-G2 NOT_STARTED，P2-008被阻断，AI/OCR/RAG真实调用0，自动Incident/自动Ticket Link为0，未真实企业微信发送。

本轮测试 DB/backend/Node child/HTTP listener/browser process/profile 均0。宿主其他 Codex/MCP Node 进程未终止，也不计为测试子进程。既有两个受策略保护目录和356个非profile文件未触碰。保留本轮 raw TAP/核验记录与3张新截图，未声称文件系统全部清空。隐私扫描：19个文件（含TAP），5个本机敏感值，匹配0，未输出原始值。

## OpenAPI SHA-256（LF canonical）

- contracts/openapi.yaml: `63e39f90e376da5a8729f67e5ab7818d8915dabc169ccc870aa1687bb467d164`
- contracts/conversation_center.openapi.yaml: `675ff62443339a56017745b5f584c68f98c267bc428c0e1885dcbaac052d535f`

## 修改文件

- CHANGELOG.md
- FILE_INDEX.md
- MANIFEST.json
- contracts/conversation_center.openapi.yaml
- contracts/openapi.yaml
- evidence/p2-012-human-confirmed-incident-report.json
- evidence/p2-012-pr-review-http-openapi-hardening.json
- evidence/p2-012-pr-review-http-openapi-hardening.md
- scripts/validate-p2-012-human-confirmed-incident.mjs
- src/p2-012-domain-contracts.mjs
- src/p2-012-workbench-http.mjs
- tests/p2-012-domain-contracts.test.mjs
- tests/p2-012-schema-live-guards.test.mjs
- tests/p2-012-workbench-browser.test.mjs
- tests/p2-012-workbench.integration.test.mjs
- web/p2-workbench/incidents.js

<details>
<summary>最终 Targeted TAP（仅换行/行尾空白规范化）</summary>

````text
TAP version 13
# Subtest: P2-012 closes input shapes, rejects hostile values and preserves deterministic command hashes
ok 1 - P2-012 closes input shapes, rejects hostile values and preserves deterministic command hashes
  ---
  duration_ms: 3.2663
  type: 'test'
  ...
# Subtest: P2-012 stable HTTP matrix is exhaustive, deterministic and rejects hostile results without executing code
ok 2 - P2-012 stable HTTP matrix is exhaustive, deterministic and rejects hostile results without executing code
  ---
  duration_ms: 28.2069
  type: 'test'
  ...
# Subtest: P2-012 both parsed OpenAPI documents declare canonical subscription destinations and service failures
ok 3 - P2-012 both parsed OpenAPI documents declare canonical subscription destinations and service failures
  ---
  duration_ms: 705.8915
  type: 'test'
  ...
# Subtest: P2-012 static authorization, frozen predecessors, scope, schemas and synthetic fixture gate
ok 4 - P2-012 static authorization, frozen predecessors, scope, schemas and synthetic fixture gate
  ---
  duration_ms: 2811.997
  type: 'test'
  ...
# Subtest: P2-012 live runner fails before network/listener unless all five independent fuses and verified evidence exist
ok 5 - P2-012 live runner fails before network/listener unless all five independent fuses and verified evidence exist
  ---
  duration_ms: 3.1572
  type: 'test'
  ...
# Subtest: P2-012 readiness cannot be fabricated from partial regression, skips, changed inputs or live claims
ok 6 - P2-012 readiness cannot be fabricated from partial regression, skips, changed inputs or live claims
  ---
  duration_ms: 1.4213
  type: 'test'
  ...
# Subtest: P2-012 DONE requires the approved live candidate, client confirmation, clean Incident deliveries and complete regressions
ok 7 - P2-012 DONE requires the approved live candidate, client confirmation, clean Incident deliveries and complete regressions
  ---
  duration_ms: 0.7621
  type: 'test'
  ...
# Subtest: P2-012 frozen candidate permits only the explicit closeout governance set
ok 8 - P2-012 frozen candidate permits only the explicit closeout governance set
  ---
  duration_ms: 0.7611
  type: 'test'
  ...
# Subtest: P2-012 review hardening preserves exact paths and requires independent current regression evidence
ok 9 - P2-012 review hardening preserves exact paths and requires independent current regression evidence
  ---
  duration_ms: 0.982
  type: 'test'
  ...
# Subtest: P2-012 v2 HTTP OpenAPI hardening has an independent closed allowlist and complete regression gate
ok 10 - P2-012 v2 HTTP OpenAPI hardening has an independent closed allowlist and complete regression gate
  ---
  duration_ms: 1.331
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 1440x900 human confirmation, refresh and accessibility
ok 11 - P2-012 database-backed browser 1440x900 human confirmation, refresh and accessibility
  ---
  duration_ms: 4577.2565
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 1366x768 human confirmation, refresh and accessibility
ok 12 - P2-012 database-backed browser 1366x768 human confirmation, refresh and accessibility
  ---
  duration_ms: 5098.3993
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 390x844 human confirmation, refresh and accessibility
ok 13 - P2-012 database-backed browser 390x844 human confirmation, refresh and accessibility
  ---
  duration_ms: 5800.1139
  type: 'test'
  ...
# Subtest: P2-012 actual HTTP inherits authentication, CSRF, command fence and durable realtime
ok 14 - P2-012 actual HTTP inherits authentication, CSRF, command fence and durable realtime
  ---
  duration_ms: 2883.9168
  type: 'test'
  ...
# Subtest: P2-012 actual HTTP preserves notification failure, rollback and durable replay before explicit recovery
ok 15 - P2-012 actual HTTP preserves notification failure, rollback and durable replay before explicit recovery
  ---
  duration_ms: 4543.7731
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
# duration_ms 28210.1931
````

</details>

<details>
<summary>最终完整串行 TAP（仅换行/行尾空白规范化）</summary>

````text
TAP version 13
# Subtest: ARCH-005 architecture validator freezes migrations and reports all hard static counts at zero
ok 1 - ARCH-005 architecture validator freezes migrations and reports all hard static counts at zero
  ---
  duration_ms: 172.643
  type: 'test'
  ...
# Subtest: P2-007 and its authorized P2-015 successor keep the frozen ARCH-005 contract
ok 2 - P2-007 and its authorized P2-015 successor keep the frozen ARCH-005 contract
  ---
  duration_ms: 2.1449
  type: 'test'
  ...
# Subtest: existing 001-021 database passes 022 check rollback, apply, forbidden-zero, and repeat no-op
ok 3 - existing 001-021 database passes 022 check rollback, apply, forbidden-zero, and repeat no-op
  ---
  duration_ms: 3162.9142
  type: 'test'
  ...
# Subtest: fresh database executes 001-021-022 through the current-baseline entrypoint
ok 4 - fresh database executes 001-021-022 through the current-baseline entrypoint
  ---
  duration_ms: 1977.2267
  type: 'test'
  ...
# Subtest: ARCH-006 validator passes
ok 5 - ARCH-006 validator passes
  ---
  duration_ms: 179.9206
  type: 'test'
  ...
# Subtest: machine state preserves ARCH-006 facts and separately authorized P2-015/P2-016 successor lifecycles
ok 6 - machine state preserves ARCH-006 facts and separately authorized P2-015/P2-016 successor lifecycles
  ---
  duration_ms: 0.9438
  type: 'test'
  ...
# Subtest: ten safe deterministic results are first-class and Manual Review is valid
ok 7 - ten safe deterministic results are first-class and Manual Review is valid
  ---
  duration_ms: 1.1623
  type: 'test'
  ...
# Subtest: Ticket lifecycle reuses authoritative actions and reliable notification boundary
ok 8 - Ticket lifecycle reuses authoritative actions and reliable notification boundary
  ---
  duration_ms: 1.2687
  type: 'test'
  ...
# Subtest: Incident remains human-confirmed and AI-independent
ok 9 - Incident remains human-confirmed and AI-independent
  ---
  duration_ms: 0.3176
  type: 'test'
  ...
# Subtest: AI-off readiness and feature flags are closed by default
ok 10 - AI-off readiness and feature flags are closed by default
  ---
  duration_ms: 1.5602
  type: 'test'
  ...
# Subtest: configuration preserves G0 boundaries and substitutes only the invalid test secret
ok 11 - configuration preserves G0 boundaries and substitutes only the invalid test secret
  ---
  duration_ms: 1.4563
  type: 'test'
  ...
# Subtest: redaction and error mapping do not expose a configured secret
ok 12 - redaction and error mapping do not expose a configured secret
  ---
  duration_ms: 0.4064
  type: 'test'
  ...
# Subtest: the connection stability window is bounded and explicit
ok 13 - the connection stability window is bounded and explicit
  ---
  duration_ms: 1.1652
  type: 'test'
  ...
# Subtest: authenticated probe starts shutdown by SIGTERM and calls disconnect before completion
ok 14 - authenticated probe starts shutdown by SIGTERM and calls disconnect before completion
  ---
  duration_ms: 3.1829
  type: 'test'
  ...
# Subtest: text frame capture records only the permitted, desensitized shape
ok 15 - text frame capture records only the permitted, desensitized shape
  ---
  duration_ms: 2.1976
  type: 'test'
  ...
# Subtest: capture arguments require a named scenario and an evidence jsonl target
ok 16 - capture arguments require a named scenario and an evidence jsonl target
  ---
  duration_ms: 0.8644
  type: 'test'
  ...
# Subtest: media capture records only desensitized frame, download, and filename metadata
ok 17 - media capture records only desensitized frame, download, and filename metadata
  ---
  duration_ms: 2.3951
  type: 'test'
  ...
# Subtest: media capture arguments restrict scenarios, evidence output, and aes key modes
ok 18 - media capture arguments restrict scenarios, evidence output, and aes key modes
  ---
  duration_ms: 1.0628
  type: 'test'
  ...
# Subtest: voice capture retains only safe transcript metadata and does not download media
ok 19 - voice capture retains only safe transcript metadata and does not download media
  ---
  duration_ms: 0.3411
  type: 'test'
  ...
# Subtest: video capture reuses encrypted download evidence without exposing media references
ok 20 - video capture reuses encrypted download evidence without exposing media references
  ---
  duration_ms: 0.3769
  type: 'test'
  ...
# Subtest: download evidence maps decrypt failures and local deadline without leaking error details
ok 21 - download evidence maps decrypt failures and local deadline without leaking error details
  ---
  duration_ms: 3.6721
  type: 'test'
  ...
# Subtest: push arguments restrict scenario, timing, repeat and evidence output
ok 22 - push arguments restrict scenario, timing, repeat and evidence output
  ---
  duration_ms: 1.0525
  type: 'test'
  ...
# Subtest: direct push uses userid in memory but records only desensitized delivery evidence
ok 23 - direct push uses userid in memory but records only desensitized delivery evidence
  ---
  duration_ms: 2.7462
  type: 'test'
  ...
# Subtest: group mention mode is opt-in and invalid chatid rejection keeps SDK error text out of evidence
ok 24 - group mention mode is opt-in and invalid chatid rejection keeps SDK error text out of evidence
  ---
  duration_ms: 0.7479
  type: 'test'
  ...
# Subtest: group markdown-then-text mention probe sends two ordered bodies and treats only the text probe rejection as a valid result
ok 25 - group markdown-then-text mention probe sends two ordered bodies and treats only the text probe rejection as a valid result
  ---
  duration_ms: 0.5539
  type: 'test'
  ...
# Subtest: group mention arguments restrict timeout, trigger token and evidence output
ok 26 - group mention arguments restrict timeout, trigger token and evidence output
  ---
  duration_ms: 1.1543
  type: 'test'
  ...
# Subtest: group mention reply uses passive text syntax with the current callback sender
ok 27 - group mention reply uses passive text syntax with the current callback sender
  ---
  duration_ms: 0.7809
  type: 'test'
  ...
# Subtest: stream reply uses the same passive mention syntax in a finished SDK-supported stream body
ok 28 - stream reply uses the same passive mention syntax in a finished SDK-supported stream body
  ---
  duration_ms: 0.1504
  type: 'test'
  ...
# Subtest: acknowledged group reply reuses the triggering frame and records only hashes and field shape
ok 29 - acknowledged group reply reuses the triggering frame and records only hashes and field shape
  ---
  duration_ms: 1.8804
  type: 'test'
  ...
# Subtest: probe ignores non-group and wrong-token messages before handling the matching group callback
ok 30 - probe ignores non-group and wrong-token messages before handling the matching group callback
  ---
  duration_ms: 0.3398
  type: 'test'
  ...
# Subtest: provider rejection is a completed negative capability result and excludes SDK error text
ok 31 - provider rejection is a completed negative capability result and excludes SDK error text
  ---
  duration_ms: 0.3669
  type: 'test'
  ...
# Subtest: capture builder never serializes raw callback or reply values
ok 32 - capture builder never serializes raw callback or reply values
  ---
  duration_ms: 0.1964
  type: 'test'
  ...
# Subtest: card arguments enforce local evidence, trigger chat type, and the five-second late boundary
ok 33 - card arguments enforce local evidence, trigger chat type, and the five-second late boundary
  ---
  duration_ms: 1.204
  type: 'test'
  ...
# Subtest: card shape has a unique caller-owned task id and both required actions
ok 34 - card shape has a unique caller-owned task id and both required actions
  ---
  duration_ms: 0.6998
  type: 'test'
  ...
# Subtest: fast button event updates the matching task id within five seconds without persisting raw input
ok 35 - fast button event updates the matching task id within five seconds without persisting raw input
  ---
  duration_ms: 4.594
  type: 'test'
  ...
# Subtest: duplicate mode records the second same-user same-action callback and preserves buttons until then
ok 36 - duplicate mode records the second same-user same-action callback and preserves buttons until then
  ---
  duration_ms: 0.977
  type: 'test'
  ...
# Subtest: late mode calls update after the limit and records a platform rejection as an explicit expired-behavior result
ok 37 - late mode calls update after the limit and records a platform rejection as an explicit expired-behavior result
  ---
  duration_ms: 0.7956
  type: 'test'
  ...
# Subtest: a task-id mismatch is safely recorded with field names and hashes but never updates a foreign card
ok 38 - a task-id mismatch is safely recorded with field names and hashes but never updates a foreign card
  ---
  duration_ms: 0.6672
  type: 'test'
  ...
# Subtest: reply arguments only accept registered scenarios and evidence output paths
ok 39 - reply arguments only accept registered scenarios and evidence output paths
  ---
  duration_ms: 1.1764
  type: 'test'
  ...
# Subtest: welcome, Markdown, stream, and media builders use the documented reply forms
ok 40 - welcome, Markdown, stream, and media builders use the documented reply forms
  ---
  duration_ms: 16.3406
  type: 'test'
  ...
# Subtest: welcome replies accept an enter_chat event even when its chattype is omitted
ok 41 - welcome replies accept an enter_chat event even when its chattype is omitted
  ---
  duration_ms: 2.4184
  type: 'test'
  ...
# Subtest: stream refresh reuses one callback and stream id, then omits the body for matching feedback
ok 42 - stream refresh reuses one callback and stream id, then omits the body for matching feedback
  ---
  duration_ms: 4.8078
  type: 'test'
  ...
# Subtest: Markdown reply is callback-bound and never serializes trigger text or identifiers
ok 43 - Markdown reply is callback-bound and never serializes trigger text or identifiers
  ---
  duration_ms: 0.5807
  type: 'test'
  ...
# Subtest: file, image, and voice upload then reply through the callback-bound media interface
ok 44 - file, image, and voice upload then reply through the callback-bound media interface
  ---
  duration_ms: 1.3123
  type: 'test'
  ...
# Subtest: video echo downloads only in memory, reuploads with a safe filename, and replies with title and description
ok 45 - video echo downloads only in memory, reuploads with a safe filename, and replies with title and description
  ---
  duration_ms: 0.8858
  type: 'test'
  ...
# Subtest: provider rejection has a stable classification without recording provider error text
ok 46 - provider rejection has a stable classification without recording provider error text
  ---
  duration_ms: 0.4239
  type: 'test'
  ...
# Subtest: feedback empty-reply rejection is a completed negative capability result
ok 47 - feedback empty-reply rejection is a completed negative capability result
  ---
  duration_ms: 3.0342
  type: 'test'
  ...
# Subtest: G0-007 defaults to a 4 hour 30 minute Windows-native soak and keeps Phase boundaries
ok 48 - G0-007 defaults to a 4 hour 30 minute Windows-native soak and keeps Phase boundaries
  ---
  duration_ms: 1.31
  type: 'test'
  ...
# Subtest: run id is opaque and deterministic under an injected clock
ok 49 - run id is opaque and deterministic under an injected clock
  ---
  duration_ms: 0.183
  type: 'test'
  ...
# Subtest: reconnect recovery, resource samples, and message replay stay content-free
ok 50 - reconnect recovery, resource samples, and message replay stay content-free
  ---
  duration_ms: 1.8878
  type: 'test'
  ...
# Subtest: a completed requested soak does not satisfy the 4 hour 30 minute Gate duration when shortened
ok 51 - a completed requested soak does not satisfy the 4 hour 30 minute Gate duration when shortened
  ---
  duration_ms: 0.3513
  type: 'test'
  ...
# Subtest: G0-008 closure preserves completed Gate 0 and P1 facts independently of the moving P2 frontier
ok 52 - G0-008 closure preserves completed Gate 0 and P1 facts independently of the moving P2 frontier
  ---
  duration_ms: 3.3237
  type: 'test'
  ...
# Subtest: G0-008 report covers every completed Gate 0 evidence source and retains limits
ok 53 - G0-008 report covers every completed Gate 0 evidence source and retains limits
  ---
  duration_ms: 25.2731
  type: 'test'
  ...
# Subtest: the capability-freeze ADR is accepted and does not skip P1-001
ok 54 - the capability-freeze ADR is accepted and does not skip P1-001
  ---
  duration_ms: 3.1568
  type: 'test'
  ...
# Subtest: the documented 512 KiB plan covers 3,920,958 bytes in eight ordered chunks
ok 55 - the documented 512 KiB plan covers 3,920,958 bytes in eight ordered chunks
  ---
  duration_ms: 1.5045
  type: 'test'
  ...
# Subtest: test-only padding creates an exact target-sized MP4 without retaining an original filename
ok 56 - test-only padding creates an exact target-sized MP4 without retaining an original filename
  ---
  duration_ms: 0.6302
  type: 'test'
  ...
# Subtest: layered upload sends init, every serial chunk, and finish with fresh request IDs
ok 57 - layered upload sends init, every serial chunk, and finish with fresh request IDs
  ---
  duration_ms: 38.8748
  type: 'test'
  ...
# Subtest: a rejected chunk prevents finish and returns an explicit stage result
ok 58 - a rejected chunk prevents finish and returns an explicit stage result
  ---
  duration_ms: 2.7105
  type: 'test'
  ...
# Subtest: the probe downloads in memory, completes the layer sequence, then issues one callback-bound reply
ok 59 - the probe downloads in memory, completes the layer sequence, then issues one callback-bound reply
  ---
  duration_ms: 4.1363
  type: 'test'
  ...
# Subtest: arguments remain restricted to the G0 evidence directory and 10 MiB provider limit
ok 60 - arguments remain restricted to the G0 evidence directory and 10 MiB provider limit
  ---
  duration_ms: 0.25
  type: 'test'
  ...
# Subtest: validates and redacts a Webhook URL without exposing its key
ok 61 - validates and redacts a Webhook URL without exposing its key
  ---
  duration_ms: 1.2099
  type: 'test'
  ...
# Subtest: builds the documented text, markdown, media, news, and card payload forms
ok 62 - builds the documented text, markdown, media, news, and card payload forms
  ---
  duration_ms: 1.4081
  type: 'test'
  ...
# Subtest: creates bounded in-memory image, file, and AMR fixtures and documented multipart headers
ok 63 - creates bounded in-memory image, file, and AMR fixtures and documented multipart headers
  ---
  duration_ms: 0.6493
  type: 'test'
  ...
# Subtest: records only safe live-probe evidence when every provider reply is accepted
ok 64 - records only safe live-probe evidence when every provider reply is accepted
  ---
  duration_ms: 25.1177
  type: 'test'
  ...
# Subtest: P1 configuration accepts Pilot-only dependencies and produces a secret-free summary
ok 65 - P1 configuration accepts Pilot-only dependencies and produces a secret-free summary
  ---
  duration_ms: 1.5263
  type: 'test'
  ...
# Subtest: P1 configuration rejects missing, cross-phase, and unapproved public-edge settings
ok 66 - P1 configuration rejects missing, cross-phase, and unapproved public-edge settings
  ---
  duration_ms: 0.7259
  type: 'test'
  ...
# Subtest: preflight output and CLI options do not expose configuration secrets
ok 67 - preflight output and CLI options do not expose configuration secrets
  ---
  duration_ms: 0.6448
  type: 'test'
  ...
# Subtest: the Pilot foundation health endpoint starts and stops without business routes
ok 68 - the Pilot foundation health endpoint starts and stops without business routes
  ---
  duration_ms: 47.7969
  type: 'test'
  ...
# Subtest: text Frame becomes an SDK-independent normalized message
ok 69 - text Frame becomes an SDK-independent normalized message
  ---
  duration_ms: 4.2475
  type: 'test'
  ...
# Subtest: image Frame exposes only an opaque media download reference
ok 70 - image Frame exposes only an opaque media download reference
  ---
  duration_ms: 0.6641
  type: 'test'
  ...
# Subtest: mixed Frame preserves text and image ordering in one normalized message
ok 71 - mixed Frame preserves text and image ordering in one normalized message
  ---
  duration_ms: 0.4076
  type: 'test'
  ...
# Subtest: replayed Frame keeps one durable idempotency key without Adapter-side dropping
ok 72 - replayed Frame keeps one durable idempotency key without Adapter-side dropping
  ---
  duration_ms: 0.2389
  type: 'test'
  ...
# Subtest: illegal Frame returns a stable, non-retryable and secret-free error
ok 73 - illegal Frame returns a stable, non-retryable and secret-free error
  ---
  duration_ms: 0.1638
  type: 'test'
  ...
# Subtest: invalid Adapter receive time returns a stable error instead of throwing
ok 74 - invalid Adapter receive time returns a stable error instead of throwing
  ---
  duration_ms: 0.1732
  type: 'test'
  ...
# Subtest: text that exceeds the contract only after normalization fails closed
ok 75 - text that exceeds the contract only after normalization fails closed
  ---
  duration_ms: 0.6113
  type: 'test'
  ...
# Subtest: text incompatible with the Phase 1 PostgreSQL boundary fails closed
ok 76 - text incompatible with the Phase 1 PostgreSQL boundary fails closed
  ---
  duration_ms: 0.1551
  type: 'test'
  ...
# Subtest: non-message callback bodies are classified as unsupported before message-only fields
ok 77 - non-message callback bodies are classified as unsupported before message-only fields
  ---
  duration_ms: 0.1222
  type: 'test'
  ...
# Subtest: Frame envelope, identity and content validation use stable reasons
ok 78 - Frame envelope, identity and content validation use stable reasons
  ---
  duration_ms: 0.4725
  type: 'test'
  ...
# Subtest: Normalized Message JSON Schema matches the Adapter interface and excludes SDK secrets
ok 79 - Normalized Message JSON Schema matches the Adapter interface and excludes SDK secrets
  ---
  duration_ms: 1.6597
  type: 'test'
  ...
# Subtest: quoted text from the recorded Gate 0 shape is preserved without raw SDK fields
ok 80 - quoted text from the recorded Gate 0 shape is preserved without raw SDK fields
  ---
  duration_ms: 0.2205
  type: 'test'
  ...
# Subtest: Gate 0 verified file, voice and video Frames use the same normalized seam
ok 81 - Gate 0 verified file, voice and video Frames use the same normalized seam
  ---
  duration_ms: 0.3911
  type: 'test'
  ...
# Subtest: quoted media keeps an independent opaque reference
ok 82 - quoted media keeps an independent opaque reference
  ---
  duration_ms: 0.3756
  type: 'test'
  ...
# Subtest: persists one Channel Message and returns the original result on replay
ok 83 - persists one Channel Message and returns the original result on replay
  ---
  duration_ms: 138.8627
  type: 'test'
  ...
# Subtest: snapshots validated input before connection acquisition
ok 84 - snapshots validated input before connection acquisition
  ---
  duration_ms: 5.3124
  type: 'test'
  ...
# Subtest: concurrent duplicates execute first processing exactly once
ok 85 - concurrent duplicates execute first processing exactly once
  ---
  duration_ms: 135.4667
  type: 'test'
  ...
# Subtest: first-processing failure rolls back the Inbox row and permits a clean retry
ok 86 - first-processing failure rolls back the Inbox row and permits a clean retry
  ---
  duration_ms: 11.1546
  type: 'test'
  ...
# Subtest: non-plain processing result roots fail as processing errors
ok 87 - non-plain processing result roots fail as processing errors
  ---
  duration_ms: 13.6943
  type: 'test'
  ...
# Subtest: processing result snapshot rejects nested non-JSON runtime objects
ok 88 - processing result snapshot rejects nested non-JSON runtime objects
  ---
  duration_ms: 4.7084
  type: 'test'
  ...
# Subtest: processing result validation never executes toJSON hooks
ok 89 - processing result validation never executes toJSON hooks
  ---
  duration_ms: 4.5109
  type: 'test'
  ...
# Subtest: processing result validation rejects Proxy toJSON substitution without executing it
ok 90 - processing result validation rejects Proxy toJSON substitution without executing it
  ---
  duration_ms: 5.0409
  type: 'test'
  ...
# Subtest: inherited toJSON pollution cannot transform an otherwise plain result
ok 91 - inherited toJSON pollution cannot transform an otherwise plain result
  ---
  duration_ms: 7.7671
  type: 'test'
  ...
# Subtest: processing result snapshot accepts nested plain JSON arrays
ok 92 - processing result snapshot accepts nested plain JSON arrays
  ---
  duration_ms: 5.4331
  type: 'test'
  ...
# Subtest: first-processing callback cannot commit the Inbox transaction early
ok 93 - first-processing callback cannot commit the Inbox transaction early
  ---
  duration_ms: 4.3445
  type: 'test'
  ...
# Subtest: first-processing callback cannot change Inbox transaction characteristics
ok 94 - first-processing callback cannot change Inbox transaction characteristics
  ---
  duration_ms: 4.0619
  type: 'test'
  ...
# Subtest: comment-obfuscated transaction control remains blocked
ok 95 - comment-obfuscated transaction control remains blocked
  ---
  duration_ms: 4.3588
  type: 'test'
  ...
# Subtest: SET LOCAL cannot change the Inbox-owned transaction
ok 96 - SET LOCAL cannot change the Inbox-owned transaction
  ---
  duration_ms: 4.8204
  type: 'test'
  ...
# Subtest: session defaults cannot poison a pooled connection after Inbox commit
ok 97 - session defaults cannot poison a pooled connection after Inbox commit
  ---
  duration_ms: 159.6075
  type: 'test'
  ...
# Subtest: function-based session configuration is rejected before pooled connection reuse
ok 98 - function-based session configuration is rejected before pooled connection reuse
  ---
  duration_ms: 55.9296
  type: 'test'
  ...
# Subtest: ordinary Inbox use preserves caller-owned pool session baselines
ok 99 - ordinary Inbox use preserves caller-owned pool session baselines
  ---
  duration_ms: 53.5896
  type: 'test'
  ...
# Subtest: callback-style transaction queries are rejected before PostgreSQL execution
ok 100 - callback-style transaction queries are rejected before PostgreSQL execution
  ---
  duration_ms: 5.3801
  type: 'test'
  ...
# Subtest: unawaited transaction query failure remains a processing failure
ok 101 - unawaited transaction query failure remains a processing failure
  ---
  duration_ms: 9.0058
  type: 'test'
  ...
# Subtest: transaction view is revoked when first processing settles
ok 102 - transaction view is revoked when first processing settles
  ---
  duration_ms: 4.8893
  type: 'test'
  ...
# Subtest: a duplicate after a real process restart receives the committed result
ok 103 - a duplicate after a real process restart receives the committed result
  ---
  duration_ms: 477.6333
  type: 'test'
  ...
# Subtest: temporary database unavailability returns a stable retryable error without processing
ok 104 - temporary database unavailability returns a stable retryable error without processing
  ---
  duration_ms: 2.9583
  type: 'test'
  ...
# Subtest: invalid privacy, retention, plaintext payload and non-contract message fields fail before database access
ok 105 - invalid privacy, retention, plaintext payload and non-contract message fields fail before database access
  ---
  duration_ms: 1.5166
  type: 'test'
  ...
# Subtest: privacy, retention and caller-encrypted raw payload are persisted without entering the result
ok 106 - privacy, retention and caller-encrypted raw payload are persisted without entering the result
  ---
  duration_ms: 11.7739
  type: 'test'
  ...
# Subtest: migration fails closed when an existing Inbox lacks required constraints
ok 107 - migration fails closed when an existing Inbox lacks required constraints
  ---
  duration_ms: 515.0827
  type: 'test'
  ...
# Subtest: migration reports the stable drift error before indexing a table with missing columns
ok 108 - migration reports the stable drift error before indexing a table with missing columns
  ---
  duration_ms: 460.4398
  type: 'test'
  ...
# Subtest: migration rejects a weakened check constraint that keeps the expected name
ok 109 - migration rejects a weakened check constraint that keeps the expected name
  ---
  duration_ms: 503.4784
  type: 'test'
  ...
# Subtest: migration rejects a deferrable idempotency constraint unusable by ON CONFLICT
ok 110 - migration rejects a deferrable idempotency constraint unusable by ON CONFLICT
  ---
  duration_ms: 443.0052
  type: 'test'
  ...
# Subtest: migration rejects a deferrable primary key unusable by later foreign keys
ok 111 - migration rejects a deferrable primary key unusable by later foreign keys
  ---
  duration_ms: 766.342
  type: 'test'
  ...
# Subtest: migration rejects a same-name hash index that cannot serve retention range scans
ok 112 - migration rejects a same-name hash index that cannot serve retention range scans
  ---
  duration_ms: 866.1636
  type: 'test'
  ...
# Subtest: migration rejects an extra check constraint outside the frozen set
ok 113 - migration rejects an extra check constraint outside the frozen set
  ---
  duration_ms: 507.2789
  type: 'test'
  ...
# Subtest: migration rejects an extra unique constraint that changes write semantics
ok 114 - migration rejects an extra unique constraint that changes write semantics
  ---
  duration_ms: 550.6503
  type: 'test'
  ...
# Subtest: migration rejects a generated column that breaks explicit Inbox writes
ok 115 - migration rejects a generated column that breaks explicit Inbox writes
  ---
  duration_ms: 483.9708
  type: 'test'
  ...
# Subtest: migration is reentrant when the existing Inbox matches the frozen catalog
ok 116 - migration is reentrant when the existing Inbox matches the frozen catalog
  ---
  duration_ms: 613.6991
  type: 'test'
  ...
# Subtest: migration is limited to the P1-003 Channel Inbox and freezes the database constraints
ok 117 - migration is limited to the P1-003 Channel Inbox and freezes the database constraints
  ---
  duration_ms: 1.9908
  type: 'test'
  ...
# Subtest: creates one Service Intake, primary message relation and received audit event
ok 118 - creates one Service Intake, primary message relation and received audit event
  ---
  duration_ms: 199.9186
  type: 'test'
  ...
# Subtest: aggregates multiple supplements into one Intake without creating a Ticket
ok 119 - aggregates multiple supplements into one Intake without creating a Ticket
  ---
  duration_ms: 36.4904
  type: 'test'
  ...
# Subtest: explicit new-report intent starts a new Intake inside the 90-second window
ok 120 - explicit new-report intent starts a new Intake inside the 90-second window
  ---
  duration_ms: 16.342
  type: 'test'
  ...
# Subtest: an explicit reference to another ticket closes the current aggregation window
ok 121 - an explicit reference to another ticket closes the current aggregation window
  ---
  duration_ms: 38.5737
  type: 'test'
  ...
# Subtest: pure image creates a waiting Intake and emits a clarification audit event
ok 122 - pure image creates a waiting Intake and emits a clarification audit event
  ---
  duration_ms: 10.7644
  type: 'test'
  ...
# Subtest: a description clarifies the waiting image Intake instead of creating another Intake
ok 123 - a description clarifies the waiting image Intake instead of creating another Intake
  ---
  duration_ms: 19.3147
  type: 'test'
  ...
# Subtest: concurrent distinct messages in one context aggregate into exactly one Intake
ok 124 - concurrent distinct messages in one context aggregate into exactly one Intake
  ---
  duration_ms: 215.0077
  type: 'test'
  ...
# Subtest: reversed lock acquisition still aggregates bounded timestamp inversion and preserves valid update time
ok 125 - reversed lock acquisition still aggregates bounded timestamp inversion and preserves valid update time
  ---
  duration_ms: 27.1696
  type: 'test'
  ...
# Subtest: reversed lock acquisition never crosses an explicit new-context boundary
ok 126 - reversed lock acquisition never crosses an explicit new-context boundary
  ---
  duration_ms: 85.4107
  type: 'test'
  ...
# Subtest: classifies the documented request types without AI and honors incident negation
ok 127 - classifies the documented request types without AI and honors incident negation
  ---
  duration_ms: 122.7603
  type: 'test'
  ...
# Subtest: standalone thanks is CHATTER without an unnecessary clarification request
ok 128 - standalone thanks is CHATTER without an unnecessary clarification request
  ---
  duration_ms: 10.4612
  type: 'test'
  ...
# Subtest: aggregate privacy is strongest, retention is earliest, and Inbox snapshots contain no report summary
ok 129 - aggregate privacy is strongest, retention is earliest, and Inbox snapshots contain no report summary
  ---
  duration_ms: 22.622
  type: 'test'
  ...
# Subtest: includes exactly 90 seconds and starts a new Intake after the window
ok 130 - includes exactly 90 seconds and starts a new Intake after the window
  ---
  duration_ms: 37.9358
  type: 'test'
  ...
# Subtest: different senders and conversations stay separate while direct chat maps to WECOM_DIRECT
ok 131 - different senders and conversations stay separate while direct chat maps to WECOM_DIRECT
  ---
  duration_ms: 27.9869
  type: 'test'
  ...
# Subtest: Channel Message replay returns the original Intake result without duplicate relations or events
ok 132 - Channel Message replay returns the original Intake result without duplicate relations or events
  ---
  duration_ms: 13.5355
  type: 'test'
  ...
# Subtest: downstream failure rolls back Channel Message, Intake, relations and events before a clean retry
ok 133 - downstream failure rolls back Channel Message, Intake, relations and events before a clean retry
  ---
  duration_ms: 18.094
  type: 'test'
  ...
# Subtest: migration fails closed on legacy Inbox summaries and upgrades pre-redacted aggregates
ok 134 - migration fails closed on legacy Inbox summaries and upgrades pre-redacted aggregates
  ---
  duration_ms: 234.0523
  type: 'test'
  ...
# Subtest: migration runner exposes only the exact legacy-remediation failure as non-retryable
ok 135 - migration runner exposes only the exact legacy-remediation failure as non-retryable
  ---
  duration_ms: 0.4088
  type: 'test'
  ...
# Subtest: migration is limited to Service Intake, message relations and Intake audit events
ok 136 - migration is limited to Service Intake, message relations and Intake audit events
  ---
  duration_ms: 1.8862
  type: 'test'
  ...
# Subtest: Service Intake JSON Schema freezes the domain boundary and P1-004 version semantics
ok 137 - Service Intake JSON Schema freezes the domain boundary and P1-004 version semantics
  ---
  duration_ms: 1.1652
  type: 'test'
  ...
# Subtest: Service Intake migration is re-entrant
ok 138 - Service Intake migration is re-entrant
  ---
  duration_ms: 4.745
  type: 'test'
  ...
# Subtest: invalid aggregation windows fail before a processor can access a transaction
ok 139 - invalid aggregation windows fail before a processor can access a transaction
  ---
  duration_ms: 0.4281
  type: 'test'
  ...
# Subtest: an explicit report creates one idempotent Pilot Ticket without AI or Hospital Tickets
ok 140 - an explicit report creates one idempotent Pilot Ticket without AI or Hospital Tickets
  ---
  duration_ms: 159.5016
  type: 'test'
  ...
# Subtest: a downstream failure rolls back the Intake-to-Ticket relationship before retry
ok 141 - a downstream failure rolls back the Intake-to-Ticket relationship before retry
  ---
  duration_ms: 27.9857
  type: 'test'
  ...
# Subtest: a Ticket number collision fails explicitly and leaves the second Intake unlinked
ok 142 - a Ticket number collision fails explicitly and leaves the second Intake unlinked
  ---
  duration_ms: 31.5134
  type: 'test'
  ...
# Subtest: the database rejects a Ticket when its source Intake does not point back to it
ok 143 - the database rejects a Ticket when its source Intake does not point back to it
  ---
  duration_ms: 14.3457
  type: 'test'
  ...
# Subtest: explicit Ticket Actions enforce legal transitions, versions, and an ordered audit timeline
ok 144 - explicit Ticket Actions enforce legal transitions, versions, and an ordered audit timeline
  ---
  duration_ms: 200.1131
  type: 'test'
  ...
# Subtest: concurrent handlers cannot both accept the same queued Ticket
ok 145 - concurrent handlers cannot both accept the same queued Ticket
  ---
  duration_ms: 68.2657
  type: 'test'
  ...
# Subtest: Phase 1 rejects an Incident-link action until the Phase 2 Incident fact exists
ok 146 - Phase 1 rejects an Incident-link action until the Phase 2 Incident fact exists
  ---
  duration_ms: 50.6808
  type: 'test'
  ...
# Subtest: state, Ticket Event, Outbox, and target deliveries commit together while delivery failures retry independently
ok 147 - state, Ticket Event, Outbox, and target deliveries commit together while delivery failures retry independently
  ---
  duration_ms: 298.8361
  type: 'test'
  ...
# Subtest: a leased Delivery is not sent twice by concurrent Workers and terminal failures become dead letters
ok 148 - a leased Delivery is not sent twice by concurrent Workers and terminal failures become dead letters
  ---
  duration_ms: 101.7659
  type: 'test'
  ...
# Subtest: an Outbox failure rolls back the Ticket state and its Ticket Event
ok 149 - an Outbox failure rolls back the Ticket state and its Ticket Event
  ---
  duration_ms: 27.7525
  type: 'test'
  ...
# Subtest: the default notification matrix keeps internal notes off reporter delivery and the Worker rate-limits each target
ok 150 - the default notification matrix keeps internal notes off reporter delivery and the Worker rate-limits each target
  ---
  duration_ms: 117.0694
  type: 'test'
  ...
# Subtest: first acknowledgement is sent only after commit and a reconnect replay does not create or send twice
ok 151 - first acknowledgement is sent only after commit and a reconnect replay does not create or send twice
  ---
  duration_ms: 166.4545
  type: 'test'
  ...
# Subtest: temporary delivery failure preserves a real Ticket for retry, while a non-report never fabricates a Ticket number
ok 152 - temporary delivery failure preserves a real Ticket for retry, while a non-report never fabricates a Ticket number
  ---
  duration_ms: 44.1594
  type: 'test'
  ...
# Subtest: Pilot roles isolate teams, enable audited handling, and keep internal notes out of reporter views
ok 153 - Pilot roles isolate teams, enable audited handling, and keep internal notes out of reporter views
  ---
  duration_ms: 222.2048
  type: 'test'
  ...
# Subtest: the minimum local Pilot workbench exposes an injected authenticated mobile-friendly work view
ok 154 - the minimum local Pilot workbench exposes an injected authenticated mobile-friendly work view
  ---
  duration_ms: 83.4893
  type: 'test'
  ...
# Subtest: supplement, card confirmation, duplicate card protection, close, and reopen preserve a real Ticket lifecycle
ok 155 - supplement, card confirmation, duplicate card protection, close, and reopen preserve a real Ticket lifecycle
  ---
  duration_ms: 271.37
  type: 'test'
  ...
# Subtest: the complete lifecycle processor exposes created delivery ids for post-commit acknowledgement
ok 156 - the complete lifecycle processor exposes created delivery ids for post-commit acknowledgement
  ---
  duration_ms: 20.5242
  type: 'test'
  ...
# Subtest: expired cards do not mutate Tickets and resolved Tickets close automatically with an explicit non-user reason
ok 157 - expired cards do not mutate Tickets and resolved Tickets close automatically with an explicit non-user reason
  ---
  duration_ms: 49.2591
  type: 'test'
  ...
# Subtest: P1-011 parses only explicit backup drill modes and keeps credentials out of utility arguments
ok 158 - P1-011 parses only explicit backup drill modes and keeps credentials out of utility arguments
  ---
  duration_ms: 1.7895
  type: 'test'
  ...
# Subtest: P1-011 backup check validates controls without writing credential or encryption-key values
ok 159 - P1-011 backup check validates controls without writing credential or encryption-key values
  ---
  duration_ms: 118.3563
  type: 'test'
  ...
# Subtest: P1-011 emits a fixed restore alert and failure context when a drill cannot start
ok 160 - P1-011 emits a fixed restore alert and failure context when a drill cannot start
  ---
  duration_ms: 39.3527
  type: 'test'
  ...
# Subtest: P1-011 keeps a logical backup encrypted at rest while restoring the exact stream
ok 161 - P1-011 keeps a logical backup encrypted at rest while restoring the exact stream
  ---
  duration_ms: 17.9933
  type: 'test'
  ...
# Subtest: P1-011 authenticates an encrypted artifact before exposing any plaintext to the restore consumer
ok 162 - P1-011 authenticates an encrypted artifact before exposing any plaintext to the restore consumer
  ---
  duration_ms: 10.3701
  type: 'test'
  ...
# Subtest: P1-011 writes only a redacted, structured operational log record
ok 163 - P1-011 writes only a redacted, structured operational log record
  ---
  duration_ms: 157.7128
  type: 'test'
  ...
# Subtest: P1-011 keeps a persisted core intake available when optional dependencies fail
ok 164 - P1-011 keeps a persisted core intake available when optional dependencies fail
  ---
  duration_ms: 2.8358
  type: 'test'
  ...
# Subtest: P1-011 composes the operational boundary around the real Inbox to Pilot Ticket lifecycle
ok 165 - P1-011 composes the operational boundary around the real Inbox to Pilot Ticket lifecycle
  ---
  duration_ms: 87.4066
  type: 'test'
  ...
# Subtest: P1-011 alerts with stable codes without carrying the rejected sensitive values
ok 166 - P1-011 alerts with stable codes without carrying the rejected sensitive values
  ---
  duration_ms: 0.5685
  type: 'test'
  ...
# Subtest: P1-011 serves the Pilot workbench under a same-origin CSP without inline code
ok 167 - P1-011 serves the Pilot workbench under a same-origin CSP without inline code
  ---
  duration_ms: 23.8302
  type: 'test'
  ...
# Subtest: P1-011 preserves safe backup and restore checkpoints in an admin-only immutable audit trail
ok 168 - P1-011 preserves safe backup and restore checkpoints in an admin-only immutable audit trail
  ---
  duration_ms: 41.6912
  type: 'test'
  ...
# Subtest: P1-012 accepts only an explicit check or approved live scenario
ok 169 - P1-012 accepts only an explicit check or approved live scenario
  ---
  duration_ms: 2.1882
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"c9c6da2d1af72b5ebedc45257e0bc419","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING"}}
# Subtest: P1-012 recovers only an explicitly approved, stale, terminated-local reply-probe evidence claim and audits it
ok 170 - P1-012 recovers only an explicitly approved, stale, terminated-local reply-probe evidence claim and audits it
  ---
  duration_ms: 20.6218
  type: 'test'
  ...
# Subtest: P1-012 restores the stale claim and releases the recovery guard if its recovery audit cannot append
ok 171 - P1-012 restores the stale claim and releases the recovery guard if its recovery audit cannot append
  ---
  duration_ms: 10.5178
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
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"270fcaee080b05589f1ad0c5854dcc87","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING","resumed":true}}
# Subtest: P1-012 retains a truthful quarantine audit and blocks replies when quarantine cleanup fails, then resumes safely
ok 172 - P1-012 retains a truthful quarantine audit and blocks replies when quarantine cleanup fails, then resumes safely
  ---
  duration_ms: 66.7091
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
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"3d0d8a4c685a79301dee807ab19e423d","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING"}}
# Subtest: P1-012 atomically takes over a stale recovery guard while a live reply and second recovery remain blocked
ok 173 - P1-012 atomically takes over a stale recovery guard while a live reply and second recovery remain blocked
  ---
  duration_ms: 25.1905
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
  duration_ms: 17.3387
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
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"71d0090a62ef4316126a484eae367be7","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING"}}
# Subtest: P1-012 recovery guard blocks concurrent recovery and live reply acquisition until recovery audit completes
ok 175 - P1-012 recovery guard blocks concurrent recovery and live reply acquisition until recovery audit completes
  ---
  duration_ms: 21.1731
  type: 'test'
  ...
# Subtest: P1-012 validates WSS and Pilot configuration without requiring a public listener
ok 176 - P1-012 validates WSS and Pilot configuration without requiring a public listener
  ---
  duration_ms: 0.5537
  type: 'test'
  ...
# Subtest: P1-012 check emits a redacted readiness record with no public-IP prerequisite
ok 177 - P1-012 check emits a redacted readiness record with no public-IP prerequisite
  ---
  duration_ms: 226.5802
  type: 'test'
  ...
# Subtest: P1-012 marks an active delivery without an explicit provider ACK as retryable
ok 178 - P1-012 marks an active delivery without an explicit provider ACK as retryable
  ---
  duration_ms: 0.3694
  type: 'test'
  ...
# Subtest: P1-012 uses the Gate-0-verified completed stream shape for a group passive reply
ok 179 - P1-012 uses the Gate-0-verified completed stream shape for a group passive reply
  ---
  duration_ms: 0.2716
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
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_REPLY_PROBE","probe":{"exact_token":true,"addressing":"WECOM_MENTION_PREFIX","database_write":false,"run_id":"4debc3fd87a81e1c6e5e13eb53ef913a"},"passive_reply":{"operation":"aibot_respond_msg_stream","attempted":true,"acknowledged":true,"provider_errcode":0,"outcome":"ACKED"}}
# Subtest: P1-012 keeps a short reply probe exact-scoped and out of the Pilot database
ok 180 - P1-012 keeps a short reply probe exact-scoped and out of the Pilot database
  ---
  duration_ms: 37.7433
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
  duration_ms: 41.3855
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_client_display_observed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT","source_result_hash":"a98b043eaf220dfa7f8a6d15a1fdb998","provider_reply_acknowledged":true,"database_write":true,"ticket_created":true,"intake_status":"TICKET_CREATED","observer":"configured_test_account","observation":"VISIBLE"}
# Subtest: P1-012 records one HMAC-linked client observation for a successful Ticket-creating group text
ok 182 - P1-012 records one HMAC-linked client observation for a successful Ticket-creating group text
  ---
  duration_ms: 8.911
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_shared_delivery_reconciled","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"SHARED_DELIVERY_RECONCILIATION","database_mutation":false,"synthetic_signature":"ACK_PREFIX","delivery_count":2,"ticket_count":1,"attempt_count":3,"retry_attempts":1,"synthetic_sent_attempts":2,"channels":{"pilot_team":1,"wecom_direct":1},"audit_history_preserved":true,"excluded_from_real_wecom_delivery_evidence":true,"reconciliation_status":"IDENTIFIED_AND_EXCLUDED"}
# Subtest: P1-012 reconciles the exact synthetic shared Delivery footprint without mutating database facts
ok 183 - P1-012 reconciles the exact synthetic shared Delivery footprint without mutating database facts
  ---
  duration_ms: 4.4873
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_client_display_observed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","source_result_hash":"4820f6a54a47a36001fef143b95d984c","source_addressing":"WECOM_MENTION_PREFIX","provider_reply_acknowledged":true,"database_write":false,"observer":"configured_test_account","observation":"VISIBLE"}
# Subtest: P1-012 serializes concurrent client observations for one reply-probe source
ok 184 - P1-012 serializes concurrent client observations for one reply-probe source
  ---
  duration_ms: 14.8869
  type: 'test'
  ...
# Subtest: P1-012 rejects a client observation whose source becomes stale before it claims the evidence chain
ok 185 - P1-012 rejects a client observation whose source becomes stale before it claims the evidence chain
  ---
  duration_ms: 3.5672
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
  duration_ms: 20.4127
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# Subtest: P1-012 prevents a reply probe from starting after an earlier evidence failure has won
ok 187 - P1-012 prevents a reply probe from starting after an earlier evidence failure has won
  ---
  duration_ms: 33.1829
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_REPLY_PROBE","probe":{"exact_token":true,"addressing":"BARE","database_write":false,"run_id":"24d5ac032d60d7edc22d30e607f29a38"},"passive_reply":{"operation":"aibot_respond_msg_stream","attempted":true,"acknowledged":true,"provider_errcode":0,"outcome":"ACKED"}}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_EVIDENCE_WRITE_FAILED"}
# Subtest: P1-012 records an in-flight reply probe before its deferred terminal failure
ok 188 - P1-012 records an in-flight reply probe before its deferred terminal failure
  ---
  duration_ms: 17.2198
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_LIVE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN"}
# Subtest: P1-012 hard-times-out a permanently pending reply probe with an explicit unknown side-effect state
ok 189 - P1-012 hard-times-out a permanently pending reply probe with an explicit unknown side-effect state
  ---
  duration_ms: 6.8829
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_LIVE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN"}
# Subtest: P1-012 suppresses a late reply-probe success record after its hard timeout
ok 190 - P1-012 suppresses a late reply-probe success record after its hard timeout
  ---
  duration_ms: 39.3414
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_EVIDENCE_WRITE_FAILED"}
# Subtest: P1-012 prevents a failed group-id capture run from updating the local group id
ok 191 - P1-012 prevents a failed group-id capture run from updating the local group id
  ---
  duration_ms: 4.8342
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_applied","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"side_effect_state":"APPLIED","configuration_updated":true,"group_id_hash":"9aa6151c5e05da82086348a14803d96d"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_EVIDENCE_WRITE_FAILED","side_effect_state":"APPLIED","configuration_updated":true,"group_id_hash":"9aa6151c5e05da82086348a14803d96d"}
# Subtest: P1-012 records an in-flight group-id capture before its deferred terminal failure
ok 192 - P1-012 records an in-flight group-id capture before its deferred terminal failure
  ---
  duration_ms: 32.7448
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
  duration_ms: 9.9961
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_GROUP_ID_CAPTURE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN","group_id_hash":"eac76feda981759f44d849e3e50e5a7e","reconciliation_required":true}
# Subtest: P1-012 hard-times-out a pending group-id capture and aborts its local update seam
ok 194 - P1-012 hard-times-out a pending group-id capture and aborts its local update seam
  ---
  duration_ms: 12.983
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_GROUP_ID_CAPTURE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN","group_id_hash":"eac76feda981759f44d849e3e50e5a7e","reconciliation_required":true}
# Subtest: P1-012 leaves a late non-cooperative capture update as reconcilable unknown without a late applied record
ok 195 - P1-012 leaves a late non-cooperative capture update as reconcilable unknown without a late applied record
  ---
  duration_ms: 20.1664
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_error","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT","error_code":"ECONNRESET"}
# {"test_id":"P1-012","event":"p1_012_wss_disconnected","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reconnecting","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reauthenticated","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_TEXT","core":{"accepted":true},"passive_reply":{"acknowledged":true},"run_id":"3deeeb27e8f88c1415ea26a1028de001"}
# Subtest: P1-012 waits through a transient SDK disconnect and records only safe reconnect evidence
ok 196 - P1-012 waits through a transient SDK disconnect and records only safe reconnect evidence
  ---
  duration_ms: 10.2847
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
  duration_ms: 9.2105
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
  duration_ms: 263.8946
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT","timeout_ms":10000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_disconnected","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reconnect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reauthenticated","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_post_reconnect_message_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT","reauthenticated":true}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"RECONNECT_GROUP_TEXT","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"SENT"},"run_id":"90b6e355bf3fb98e9faa6a7c9d447d61","reconnect":{"reauthenticated_before_callback":true}}
# Subtest: P1-012 forces reauthentication before accepting one scoped group-text callback
ok 199 - P1-012 forces reauthentication before accepting one scoped group-text callback
  ---
  duration_ms: 307.0232
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
# {"test_id":"P1-012","event":"p1_012_live_burst_result","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100","run_id":"0b89ac031c03c0d69c37ed1f254ecb72","expected_count":100,"callback_count":100,"unique_message_count":100,"accepted_within_target_count":100,"duplicate_callback_count":0,"database":{"inbox_count":100,"intake_count":100,"ticket_count":100,"outbox_count":100,"delivery_count":200,"tickets_with_invalid_outbox_count":0,"tickets_with_invalid_delivery_count":0},"zero_lost_tickets":true,"zero_duplicate_tickets":true,"notifications_traceable":true,"collection_elapsed_ms":93,"outcome":"PASSED"}
# Subtest: P1-012 completes a strictly sequenced 100-message live burst only after database fact reconciliation
ok 200 - P1-012 completes a strictly sequenced 100-message live burst only after database fact reconciliation
  ---
  duration_ms: 98.5458
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":1,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":2,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":3,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":4,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":5,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":6,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":7,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":8,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":9,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":10,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":11,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":12,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":13,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":14,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":15,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":16,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":17,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":18,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":19,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":20,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":21,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":22,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":23,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":24,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":25,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":26,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":27,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":28,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":29,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":30,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":31,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":32,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":33,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":34,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":35,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":36,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":37,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":38,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":39,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":40,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":41,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":42,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":43,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":44,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":45,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":46,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":47,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":48,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":49,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":50,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":51,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":52,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":53,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":54,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":55,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":56,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":57,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":58,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":59,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":60,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":61,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":62,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":63,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":64,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":65,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":66,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":67,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":68,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":69,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":70,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":71,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":72,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":73,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":74,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":75,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":76,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":77,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":78,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":79,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":80,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":81,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":82,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":83,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":84,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":85,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":86,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":87,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":88,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":89,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":90,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":91,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":92,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":93,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":94,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":95,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":96,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":97,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":98,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":99,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":100,"run_id":"b8fc3f93e9d4a41e6005e283df2541ff"}
# {"test_id":"P1-012","event":"p1_012_live_burst_result","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100","run_id":"b8fc3f93e9d4a41e6005e283df2541ff","expected_count":100,"callback_count":100,"unique_message_count":100,"accepted_within_target_count":100,"duplicate_callback_count":0,"database":{"inbox_count":100,"intake_count":100,"ticket_count":100,"outbox_count":100,"delivery_count":200,"tickets_with_invalid_outbox_count":2,"tickets_with_invalid_delivery_count":2},"zero_lost_tickets":true,"zero_duplicate_tickets":true,"notifications_traceable":false,"collection_elapsed_ms":61,"outcome":"FAILED"}
# Subtest: P1-012 burst fails closed when global notification totals mask per-ticket gaps
ok 201 - P1-012 burst fails closed when global notification totals mask per-ticket gaps
  ---
  duration_ms: 65.5266
  type: 'test'
  ...
# Subtest: P1-012 exercises the real Pilot core under duplicate, image, burst, Outbox failure, and AI-off conditions
ok 202 - P1-012 exercises the real Pilot core under duplicate, image, burst, Outbox failure, and AI-off conditions
  ---
  duration_ms: 1026.9301
  type: 'test'
  ...
# Subtest: P1-012 handles a scoped group text frame through Intake then a safe reply and Delivery
ok 203 - P1-012 handles a scoped group text frame through Intake then a safe reply and Delivery
  ---
  duration_ms: 7.4828
  type: 'test'
  ...
# Subtest: P1-012 records an image-degraded Intake without fabricating a Ticket
ok 204 - P1-012 records an image-degraded Intake without fabricating a Ticket
  ---
  duration_ms: 0.9635
  type: 'test'
  ...
# Subtest: P1-012 accepts an addressed group mixed image only when it contains the run token and an image
ok 205 - P1-012 accepts an addressed group mixed image only when it contains the run token and an image
  ---
  duration_ms: 1.1023
  type: 'test'
  ...
# Subtest: P1-012 ignores an unscoped group frame without calling any operational seam
ok 206 - P1-012 ignores an unscoped group frame without calling any operational seam
  ---
  duration_ms: 0.4434
  type: 'test'
  ...
# Subtest: P1-012 keeps a transient core failure safe and retryable without leaking the failure text
ok 207 - P1-012 keeps a transient core failure safe and retryable without leaking the failure text
  ---
  duration_ms: 0.6507
  type: 'test'
  ...
# Subtest: P1-012 keeps a thrown database fault out of the client reply and safe evidence
ok 208 - P1-012 keeps a thrown database fault out of the client reply and safe evidence
  ---
  duration_ms: 0.6778
  type: 'test'
  ...
# Subtest: P1-012 requires an explicit successful provider receipt for a passive reply
ok 209 - P1-012 requires an explicit successful provider receipt for a passive reply
  ---
  duration_ms: 0.6108
  type: 'test'
  ...
# Subtest: P1-012 preserves a provider reply rejection code without keeping its message text
ok 210 - P1-012 preserves a provider reply rejection code without keeping its message text
  ---
  duration_ms: 0.5477
  type: 'test'
  ...
# Subtest: P1-012 Go/No-Go requires real client observation but never a public IP for outbound WSS
ok 211 - P1-012 Go/No-Go requires real client observation but never a public IP for outbound WSS
  ---
  duration_ms: 0.4484
  type: 'test'
  ...
# Subtest: P1-012 WeCom burst UI plan is side-effect free and preserves the requested sequence range
ok 212 - P1-012 WeCom burst UI plan is side-effect free and preserves the requested sequence range
  ---
  duration_ms: 1846.2972
  type: 'test'
  ...
# Subtest: P1-012 WeCom burst UI driver fails closed on invalid ranges and ambiguous modes
ok 213 - P1-012 WeCom burst UI driver fails closed on invalid ranges and ambiguous modes
  ---
  duration_ms: 2104.9416
  type: 'test'
  ...
# Subtest: P1-012 WeCom burst UI driver retains fail-closed target, clipboard, stop, and reconciliation guards
ok 214 - P1-012 WeCom burst UI driver retains fail-closed target, clipboard, stop, and reconciliation guards
  ---
  duration_ms: 32.757
  type: 'test'
  ...
# Subtest: P2-001 PostgreSQL contract is idempotent, isolated, and fail closed
ok 215 - P2-001 PostgreSQL contract is idempotent, isolated, and fail closed
  ---
  duration_ms: 1143.0344
  type: 'test'
  ...
# Subtest: all P2 conversation feature flags default to false
ok 216 - all P2 conversation feature flags default to false
  ---
  duration_ms: 1.2001
  type: 'test'
  ...
# Subtest: Thread identity separates single, group, and multiple bots without exposing raw ids in its key
ok 217 - Thread identity separates single, group, and multiple bots without exposing raw ids in its key
  ---
  duration_ms: 0.7385
  type: 'test'
  ...
# Subtest: Thread identity rejects malformed channel scope with a stable error
ok 218 - Thread identity rejects malformed channel scope with a stable error
  ---
  duration_ms: 0.3571
  type: 'test'
  ...
# Subtest: group Session scope isolates participants and Intakes
ok 219 - group Session scope isolates participants and Intakes
  ---
  duration_ms: 0.4305
  type: 'test'
  ...
# Subtest: Session boundary rules cover ended, explicit, different Intake, idle equality, and continuation
ok 220 - Session boundary rules cover ended, explicit, different Intake, idle equality, and continuation
  ---
  duration_ms: 0.5827
  type: 'test'
  ...
# Subtest: only auditable boundary reasons are accepted from callers
ok 221 - only auditable boundary reasons are accepted from callers
  ---
  duration_ms: 0.3108
  type: 'test'
  ...
# Subtest: Session lifecycle is OPEN/WAITING_USER with ENDED terminal
ok 222 - Session lifecycle is OPEN/WAITING_USER with ENDED terminal
  ---
  duration_ms: 0.1816
  type: 'test'
  ...
# Subtest: control modes fail closed, default HUMAN, and reserve AUTO for P2-010/P2-G4
ok 223 - control modes fail closed, default HUMAN, and reserve AUTO for P2-010/P2-G4
  ---
  duration_ms: 0.2728
  type: 'test'
  ...
# Subtest: generation and row versions advance only for unique invalidating changes
ok 224 - generation and row versions advance only for unique invalidating changes
  ---
  duration_ms: 0.2217
  type: 'test'
  ...
# Subtest: disabled guard does not invoke storage or external seams and raw failures stay hidden
ok 225 - disabled guard does not invoke storage or external seams and raw failures stay hidden
  ---
  duration_ms: 0.4517
  type: 'test'
  ...
# Subtest: database failures map to stable public errors
ok 226 - database failures map to stable public errors
  ---
  duration_ms: 0.1766
  type: 'test'
  ...
# Subtest: P2-001 migration is limited to Thread and Session and reserves later tasks
ok 227 - P2-001 migration is limited to Thread and Session and reserves later tasks
  ---
  duration_ms: 5.9266
  type: 'test'
  ...
# Subtest: JSON Schemas, public OpenAPI view, and TypeScript declarations freeze safe vocabulary
ok 228 - JSON Schemas, public OpenAPI view, and TypeScript declarations freeze safe vocabulary
  ---
  duration_ms: 2.1571
  type: 'test'
  ...
# Subtest: P2-002 migration 011 first/repeat apply is exact and leaves P1/P2-001 unchanged
ok 229 - P2-002 migration 011 first/repeat apply is exact and leaves P1/P2-001 unchanged
  ---
  duration_ms: 935.8156
  type: 'test'
  ...
# Subtest: P2-002 migration CLI runs only 011, is repeatable, and rolls check mode back
ok 230 - P2-002 migration CLI runs only 011, is repeatable, and rolls check mode back
  ---
  duration_ms: 2064.3653
  type: 'test'
  ...
# {"child_process_runs":4,"child_exit_codes":[0,0,0,0],"preapply_check_created_tables":0,"migration_files_executed":1,"tables_added":3,"p1_p2_001_catalog_unchanged":true,"postapply_check_rolled_back":true,"temp_database_cleanup":true}
# Subtest: P2-002 migration CLI fails closed on incompatible read-only source dependencies
ok 231 - P2-002 migration CLI fails closed on incompatible read-only source dependencies
  ---
  duration_ms: 917.3941
  type: 'test'
  ...
# {"child_exit_code":1,"stable_error":"P2_002_SCHEMA_DRIFT_REMEDIATION_REQUIRED","p2_tables_created":0,"temp_database_cleanup":true}
# Subtest: P2-002 migration 011 fails closed on missing column
ok 232 - P2-002 migration 011 fails closed on missing column
  ---
  duration_ms: 642.6715
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on weakened CHECK constraint
ok 233 - P2-002 migration 011 fails closed on weakened CHECK constraint
  ---
  duration_ms: 576.8751
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on wrong unique constraint columns
ok 234 - P2-002 migration 011 fails closed on wrong unique constraint columns
  ---
  duration_ms: 605.0618
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on wrong index access method
ok 235 - P2-002 migration 011 fails closed on wrong index access method
  ---
  duration_ms: 569.1789
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on wrong partial-index predicate
ok 236 - P2-002 migration 011 fails closed on wrong partial-index predicate
  ---
  duration_ms: 589.4736
  type: 'test'
  ...
# Subtest: P2-002 P1 source adapter reads Channel/Intake/Ticket/Delivery facts without mutating them
ok 237 - P2-002 P1 source adapter reads Channel/Intake/Ticket/Delivery facts without mutating them
  ---
  duration_ms: 2204.1523
  type: 'test'
  ...
# {"source_record_count":4,"channel_message_count":1,"ticket_event_variant_count":2,"delivery_count":1,"source_snapshot_unchanged":true}
# Subtest: P2-002 real worker processes roll back before commit and replay after ACK loss
ok 238 - P2-002 real worker processes roll back before commit and replay after ACK loss
  ---
  duration_ms: 1399.6218
  type: 'test'
  ...
# {"before_commit_kill_exit":{"code":null,"signal":"SIGKILL","killed":true},"before_commit_backend_close_polls":2,"before_commit_restart_exit":{"code":0,"signal":null,"killed":false},"before_commit_restart_inserted":1,"after_commit_kill_exit":{"code":null,"signal":"SIGKILL","killed":true},"after_commit_backend_close_polls":1,"after_commit_restart_exit":{"code":0,"signal":null,"killed":false},"after_commit_restart_replayed":1,"final_item_count":1,"final_binding_count":1,"final_checkpoint_cursor":"1","temp_database_cleanup":true}
# Subtest: P2-002 stale rebuild cannot delete a source committed after snapshot preparation
ok 239 - P2-002 stale rebuild cannot delete a source committed after snapshot preparation
  ---
  duration_ms: 759.1317
  type: 'test'
  ...
# {"connection_wait_polls":1,"stale_rebuild_error":"CONVERSATION_TIMELINE_REBUILD_FAILED","preserved_item_count":3,"preserved_binding_count":3,"preserved_checkpoint_cursor":"3","full_rebuild_item_count":3,"full_rebuild_hash":"a3b1e5e2f41b4014bd720998130c50930cbcce967fd6fb22b136eb5142238879","temp_database_cleanup":true}
# Subtest: P2-002 projector is idempotent, concurrent, transactional, rebuildable, private, and restart safe
ok 240 - P2-002 projector is idempotent, concurrent, transactional, rebuildable, private, and restart safe
  ---
  duration_ms: 8453.9193
  type: 'test'
  ...
# {"same_source_concurrency":12,"different_source_concurrency":12,"bulk_item_count":2001,"bulk_batch_count":101,"bulk_max_batch_size":20,"bulk_peak_heap_delta_bytes":22817064,"bulk_heap_sample_count":101,"bulk_heap_segment_means_bytes":[18527493,21957284,24404140,29245726],"bulk_first_to_last_heap_trend_bytes":10718233,"bulk_max_adjacent_heap_trend_bytes":4841586,"bulk_interrupted_at_cursor":"20","bulk_restart_remaining_items":1981,"rebuild_canonical_hash":"8486a16eae2f3317a4025ee0ad804e9922085221f4e4438f6cc67d3036340c4d","temp_database_cleanup":"verified-by-finally"}
# Subtest: P2-002 suite leaves no random database or worker backend residual
ok 241 - P2-002 suite leaves no random database or worker backend residual
  ---
  duration_ms: 64.9524
  type: 'test'
  ...
# {"temp_database_count":0,"worker_backend_count":0,"isolated_source_data_residual":0,"isolated_projection_schema_residual":0}
# Subtest: P2-002 uses the frozen P2-001 Conversation Item enums
ok 242 - P2-002 uses the frozen P2-001 Conversation Item enums
  ---
  duration_ms: 12.8954
  type: 'test'
  ...
# Subtest: projection source schema parses and freezes the five source types
ok 243 - projection source schema parses and freezes the five source types
  ---
  duration_ms: 1.9404
  type: 'test'
  ...
# Subtest: normalization rejects invalid source type, session UUID, date, ordinal and additions
ok 244 - normalization rejects invalid source type, session UUID, date, ordinal and additions
  ---
  duration_ms: 2.3533
  type: 'test'
  ...
# Subtest: date normalization rejects hostile Date/object paths without invoking or leaking them
ok 245 - date normalization rejects hostile Date/object paths without invoking or leaking them
  ---
  duration_ms: 0.6305
  type: 'test'
  ...
# Subtest: safe_content accepts only bounded plain JSON data properties
ok 246 - safe_content accepts only bounded plain JSON data properties
  ---
  duration_ms: 0.503
  type: 'test'
  ...
# Subtest: toJSON, Proxy and prototype-pollution keys cannot bypass pure JSON checks
ok 247 - toJSON, Proxy and prototype-pollution keys cannot bypass pure JSON checks
  ---
  duration_ms: 0.4554
  type: 'test'
  ...
# Subtest: source_hash is stable across key order and detects semantic mutation
ok 248 - source_hash is stable across key order and detects semantic mutation
  ---
  duration_ms: 0.544
  type: 'test'
  ...
# Subtest: privacy and retention controls can tighten without changing semantic source_hash
ok 249 - privacy and retention controls can tighten without changing semantic source_hash
  ---
  duration_ms: 0.2344
  type: 'test'
  ...
# Subtest: canonical order uses the frozen rank and exact deterministic tie-break tuple
ok 250 - canonical order uses the frozen rank and exact deterministic tie-break tuple
  ---
  duration_ms: 0.658
  type: 'test'
  ...
# Subtest: canonical order compares BIGINT ordinals numerically without Number conversion
ok 251 - canonical order compares BIGINT ordinals numerically without Number conversion
  ---
  duration_ms: 1.228
  type: 'test'
  ...
# Subtest: source id and variant break otherwise identical timestamp/rank/ordinal ties
ok 252 - source id and variant break otherwise identical timestamp/rank/ordinal ties
  ---
  duration_ms: 0.4248
  type: 'test'
  ...
# Subtest: CHANNEL_MESSAGE maps only clean_text and four safe flags
ok 253 - CHANNEL_MESSAGE maps only clean_text and four safe flags
  ---
  duration_ms: 0.5105
  type: 'test'
  ...
# Subtest: TICKET_EVENT splits STATUS, EXTERNAL_NOTE and INTERNAL_NOTE variants
ok 254 - TICKET_EVENT splits STATUS, EXTERNAL_NOTE and INTERNAL_NOTE variants
  ---
  duration_ms: 0.4174
  type: 'test'
  ...
# Subtest: TICKET_EVENT external variant cannot contain internal note or operator identity
ok 255 - TICKET_EVENT external variant cannot contain internal note or operator identity
  ---
  duration_ms: 0.2815
  type: 'test'
  ...
# Subtest: TICKET_EVENT omits absent note variants
ok 256 - TICKET_EVENT omits absent note variants
  ---
  duration_ms: 0.2138
  type: 'test'
  ...
# Subtest: DELIVERY is INTERNAL and excludes target/provider/raw error data
ok 257 - DELIVERY is INTERNAL and excludes target/provider/raw error data
  ---
  duration_ms: 0.38
  type: 'test'
  ...
# Subtest: Communication Message fixture mapper requires an explicit fixture marker
ok 258 - Communication Message fixture mapper requires an explicit fixture marker
  ---
  duration_ms: 0.272
  type: 'test'
  ...
# Subtest: Handoff fixture defaults to INTERNAL and never creates a future table dependency
ok 259 - Handoff fixture defaults to INTERNAL and never creates a future table dependency
  ---
  duration_ms: 0.1686
  type: 'test'
  ...
# Subtest: normalized safe_content deny-list blocks privacy and provider leakage fields
ok 260 - normalized safe_content deny-list blocks privacy and provider leakage fields
  ---
  duration_ms: 0.421
  type: 'test'
  ...
# Subtest: feature flag is fail-closed before any database call
ok 261 - feature flag is fail-closed before any database call
  ---
  duration_ms: 0.4468
  type: 'test'
  ...
# Subtest: batchSize defaults to 20 and is bounded at construction and invocation
ok 262 - batchSize defaults to 20 and is bounded at construction and invocation
  ---
  duration_ms: 0.4211
  type: 'test'
  ...
# Subtest: runtime freezes every source and operation to the single timeline projector name
ok 263 - runtime freezes every source and operation to the single timeline projector name
  ---
  duration_ms: 0.7845
  type: 'test'
  ...
# Subtest: public storage failures contain only the stable code
ok 264 - public storage failures contain only the stable code
  ---
  duration_ms: 0.3235
  type: 'test'
  ...
# Subtest: database sequence uniqueness is deterministically mapped to the frozen sequence error
ok 265 - database sequence uniqueness is deterministically mapped to the frozen sequence error
  ---
  duration_ms: 5.824
  type: 'test'
  ...
# Subtest: rebuild authorization and wrapper accessor validation fail before storage
ok 266 - rebuild authorization and wrapper accessor validation fail before storage
  ---
  duration_ms: 0.9412
  type: 'test'
  ...
# Subtest: rebuild stale-snapshot fence fails before DELETE for extra or foreign bindings
ok 267 - rebuild stale-snapshot fence fails before DELETE for extra or foreign bindings
  ---
  duration_ms: 1.291
  type: 'test'
  ...
# Subtest: Canonical Timeline Hash excludes projected_at and physical input order
ok 268 - Canonical Timeline Hash excludes projected_at and physical input order
  ---
  duration_ms: 0.4328
  type: 'test'
  ...
# Subtest: Canonical Timeline Hash validates arrays and items before any caller property access
ok 269 - Canonical Timeline Hash validates arrays and items before any caller property access
  ---
  duration_ms: 1.9926
  type: 'test'
  ...
# Subtest: EXTERNAL audience uses SQL visibility filtering and defense-in-depth filtering
ok 270 - EXTERNAL audience uses SQL visibility filtering and defense-in-depth filtering
  ---
  duration_ms: 0.5392
  type: 'test'
  ...
# Subtest: WORKBENCH excludes RESTRICTED and RESTRICTED_ADMIN requires explicit authorization
ok 271 - WORKBENCH excludes RESTRICTED and RESTRICTED_ADMIN requires explicit authorization
  ---
  duration_ms: 0.2115
  type: 'test'
  ...
# Subtest: generic TimelineSourceAdapter maps rows outside projector transactions
ok 272 - generic TimelineSourceAdapter maps rows outside projector transactions
  ---
  duration_ms: 0.3829
  type: 'test'
  ...
# Subtest: public wrapper APIs reject Proxy/accessor arguments before invoking dependencies
ok 273 - public wrapper APIs reject Proxy/accessor arguments before invoking dependencies
  ---
  duration_ms: 0.5744
  type: 'test'
  ...
# Subtest: unknown Proxy/accessor error objects are sanitized without a second trap
ok 274 - unknown Proxy/accessor error objects are sanitized without a second trap
  ---
  duration_ms: 0.1802
  type: 'test'
  ...
# Subtest: worker reads a bounded batch before invoking the projector and preserves AbortSignal
ok 275 - worker reads a bounded batch before invoking the projector and preserves AbortSignal
  ---
  duration_ms: 0.3749
  type: 'test'
  ...
# Subtest: worker maps unknown adapter failures to the stable storage error
ok 276 - worker maps unknown adapter failures to the stable storage error
  ---
  duration_ms: 0.1413
  type: 'test'
  ...
# Subtest: checkpoint cursor accepts nullable expected values and enforces the shared 512 bound
ok 277 - checkpoint cursor accepts nullable expected values and enforces the shared 512 bound
  ---
  duration_ms: 2.704
  type: 'test'
  ...
# Subtest: migration runner executes only migration 011 and sanitizes raw failures
ok 278 - migration runner executes only migration 011 and sanitizes raw failures
  ---
  duration_ms: 2.6859
  type: 'test'
  ...
# Subtest: the public error vocabulary contains exactly the eleven frozen stable codes
ok 279 - the public error vocabulary contains exactly the eleven frozen stable codes
  ---
  duration_ms: 0.2375
  type: 'test'
  ...
# Subtest: P1 source adapter reads current sources in one repeatable-read read-only transaction
ok 280 - P1 source adapter reads current sources in one repeatable-read read-only transaction
  ---
  duration_ms: 0.3901
  type: 'test'
  ...
# Subtest: P2-003 migration 012 is exact, reentrant, CLI-scoped, and check-only rolls back
ok 281 - P2-003 migration 012 is exact, reentrant, CLI-scoped, and check-only rolls back
  ---
  duration_ms: 1471.3531
  type: 'test'
  ...
# {"migration_process_runs":4,"migration_files_executed":1,"relations_added":2,"prior_catalog_unchanged":true,"precheck_rolled_back":true,"postcheck_rolled_back":true,"temp_database_cleanup":true}
# Subtest: P2-003 migration fails closed for missing column, weak check, wrong unique and index drift
ok 282 - P2-003 migration fails closed for missing column, weak check, wrong unique and index drift
  ---
  duration_ms: 4235.3977
  type: 'test'
  ...
# {"drift_scenarios":5,"temp_database_cleanup":true}
# Subtest: P2-003 append, concurrency, caller transaction, durable replay and authorization are exact
ok 283 - P2-003 append, concurrency, caller transaction, durable replay and authorization are exact
  ---
  duration_ms: 2535.8109
  type: 'test'
  ...
# {"same_event_concurrency":12,"different_event_concurrency":12,"pool_maximum":4,"natural_identity_hole":true,"ack_loss_replayed":true,"replay_batch_count":3,"replay_batch_maximum":50,"authorization_variants":4,"retained_event_count":124,"temp_database_cleanup":true}
# Subtest: P2-003 retention check/apply preserves prefix and floor semantics with CLI authorization
ok 284 - P2-003 retention check/apply preserves prefix and floor semantics with CLI authorization
  ---
  duration_ms: 5713.3541
  type: 'test'
  ...
# {"check_zero_write":true,"unauthorized_apply_zero_write":true,"deleted_prefix_count":2,"floor_event_id":"2","expired_after_live_retained":true,"retry_idempotent":true,"replay_gap_http_fallback":true,"cursor_ahead_http_409":true,"authorized_cli_apply":true}
# Subtest: P2-003 retention delete/floor is atomic and every cleanup batch is at most 200
ok 285 - P2-003 retention delete/floor is atomic and every cleanup batch is at most 200
  ---
  duration_ms: 4726.8479
  type: 'test'
  ...
# {"first_batch_deleted":200,"second_batch_deleted":1,"floor_delete_atomic_rollback":true}
# Subtest: P2-003 localhost SSE admits 32 clients, rejects 33, heartbeats, delivers and releases resources
ok 286 - P2-003 localhost SSE admits 32 clients, rejects 33, heartbeats, delivers and releases resources
  ---
  duration_ms: 3827.5046
  type: 'test'
  ...
# {"peak_client_count":32,"event_count":100,"each_client_received":100,"capacity_rejections":1,"maximum_writable_length":16695,"slow_client_disconnects":0,"heap_samples_bytes":[9912280,12520664,13537160,11875208,13558624,17542912,19562784],"first_heap_bytes":9912280,"last_heap_bytes":19562784,"heap_sample_mean_bytes":14072805,"first_to_last_heap_trend_bytes":9650504,"peak_heap_delta_bytes":9650504,"database_query_batches":115,"resource_release_polls":2,"temp_database_cleanup":true}
# Subtest: P2-003 child kill/restart replays Last-Event-ID and missed wakeup recovers from PostgreSQL
ok 287 - P2-003 child kill/restart replays Last-Event-ID and missed wakeup recovers from PostgreSQL
  ---
  duration_ms: 3687.9658
  type: 'test'
  ...
# {"killed_server_exit":{"code":null,"signal":"SIGKILL","killed":true},"killed_server_backend_close_polls":1,"first_event_id":"1","post_restart_event_id":"2","recovery_poll_event_id":"3","app_restart_postgresql_replay":true,"missed_wakeup_recovered":true,"server_a_port":52579,"server_b_port":52584,"temp_database_cleanup":true}
# Subtest: P2-003 real paused slow client is isolated while normal delivery and append continue
ok 288 - P2-003 real paused slow client is isolated while normal delivery and append continue
  ---
  duration_ms: 18939.4163
  type: 'test'
  ...
# {"slow_disconnect_count":1,"normal_client_received":5001,"persisted_event_count":5001,"slow_disconnect_polls":84,"active_slow_write_window_polls":9,"normal_joined_during_slow_drain_polls":1,"normal_client_remained_connected":true,"append_during_slow_write_window":true,"business_transaction_during_slow_write_window":true,"temp_database_cleanup":true}
# Subtest: P2-003 streams 5,000 events in bounded batches and bounded heap without retaining frames
ok 289 - P2-003 streams 5,000 events in bounded batches and bounded heap without retaining frames
  ---
  duration_ms: 4074.2355
  type: 'test'
  ...
# {"event_count":5000,"replay_query_batch_count":100,"replay_batch_size":50,"captured_frame_count":0,"maximum_parser_buffer_bytes":370,"maximum_writable_length":16588,"heap_samples_bytes":[9926312,11803632,15395880,15971072,14557488,12553128],"first_to_last_heap_trend_bytes":2626816,"peak_heap_delta_bytes":6044760,"temp_database_cleanup":true}
# Subtest: P2-003 suite leaves no owned database, schema, child, backend, socket, port or timer residual
ok 290 - P2-003 suite leaves no owned database, schema, child, backend, socket, port or timer residual
  ---
  duration_ms: 47.0733
  type: 'test'
  ...
# {"active_test_clients":0,"active_fallback_requests":0,"active_test_http_sockets":0,"active_test_wait_timers":0,"active_cli_children":0,"active_server_children":0,"owned_port_count":6,"closed_port_count":6,"port_close_polls":[1,1,1,1,1,1],"owned_database_count":0,"owned_schema_count":0,"owned_backend_count":0,"active_database_count":0,"emergency_client_cleanup_count":0,"emergency_fallback_cleanup_count":0,"emergency_http_socket_cleanup_count":0}
# Subtest: Realtime Event and Fallback Schemas parse as draft 2020-12 closed contracts
ok 291 - Realtime Event and Fallback Schemas parse as draft 2020-12 closed contracts
  ---
  duration_ms: 7.5768
  type: 'test'
  ...
# Subtest: Realtime vocabularies freeze all event, source, aggregate, scope and visibility values
ok 292 - Realtime vocabularies freeze all event, source, aggregate, scope and visibility values
  ---
  duration_ms: 1.021
  type: 'test'
  ...
# Subtest: TypeScript declarations mirror every frozen Schema and runtime vocabulary
ok 293 - TypeScript declarations mirror every frozen Schema and runtime vocabulary
  ---
  duration_ms: 1.3307
  type: 'test'
  ...
# Subtest: authorized replay SQL clips scope and visibility before LIMIT and payload materialization
ok 294 - authorized replay SQL clips scope and visibility before LIMIT and payload materialization
  ---
  duration_ms: 1.6547
  type: 'test'
  ...
# Subtest: Fallback Schema freezes the six safe fields, four reasons and two strategies
ok 295 - Fallback Schema freezes the six safe fields, four reasons and two strategies
  ---
  duration_ms: 1.9231
  type: 'test'
  ...
# Subtest: normalization rejects invalid event, source, aggregate and scope vocabularies
ok 296 - normalization rejects invalid event, source, aggregate and scope vocabularies
  ---
  duration_ms: 1.3939
  type: 'test'
  ...
# Subtest: SESSION and THREAD require a UUID scope while SYSTEM requires null
ok 297 - SESSION and THREAD require a UUID scope while SYSTEM requires null
  ---
  duration_ms: 1.1966
  type: 'test'
  ...
# Subtest: normalization rejects invalid timestamps and requires expires_at after occurred_at
ok 298 - normalization rejects invalid timestamps and requires expires_at after occurred_at
  ---
  duration_ms: 0.675
  type: 'test'
  ...
# Subtest: aggregate versions use nullable canonical PostgreSQL BIGINT strings
ok 299 - aggregate versions use nullable canonical PostgreSQL BIGINT strings
  ---
  duration_ms: 0.5568
  type: 'test'
  ...
# Subtest: Last-Event-ID accepts zero and the BIGINT maximum without Number conversion
ok 300 - Last-Event-ID accepts zero and the BIGINT maximum without Number conversion
  ---
  duration_ms: 0.19
  type: 'test'
  ...
# Subtest: Last-Event-ID rejects negative, decimal, scientific, signed, spaced and overflow forms
ok 301 - Last-Event-ID rejects negative, decimal, scientific, signed, spaced and overflow forms
  ---
  duration_ms: 0.223
  type: 'test'
  ...
# Subtest: payload accepts only bounded plain finite JSON data
ok 302 - payload accepts only bounded plain finite JSON data
  ---
  duration_ms: 0.5302
  type: 'test'
  ...
# Subtest: payload enforces depth, node, object, array, string and canonical-byte limits
ok 303 - payload enforces depth, node, object, array, string and canonical-byte limits
  ---
  duration_ms: 3.0991
  type: 'test'
  ...
# Subtest: payload rejects Proxy and accessor paths without invoking hostile code
ok 304 - payload rejects Proxy and accessor paths without invoking hostile code
  ---
  duration_ms: 0.3492
  type: 'test'
  ...
# Subtest: payload rejects toJSON, symbols and prototype-pollution keys
ok 305 - payload rejects toJSON, symbols and prototype-pollution keys
  ---
  duration_ms: 0.3687
  type: 'test'
  ...
# Subtest: payload rejects message content and sensitive identifier property names
ok 306 - payload rejects message content and sensitive identifier property names
  ---
  duration_ms: 0.5837
  type: 'test'
  ...
# Subtest: event key is stable, opaque and changes with its frozen identity tuple
ok 307 - event key is stable, opaque and changes with its frozen identity tuple
  ---
  duration_ms: 1.3473
  type: 'test'
  ...
# Subtest: event hash is canonical across payload key order and changes on semantic mutation
ok 308 - event hash is canonical across payload key order and changes on semantic mutation
  ---
  duration_ms: 0.622
  type: 'test'
  ...
# Subtest: event hash excludes expires_at, event_id and created_at
ok 309 - event hash excludes expires_at, event_id and created_at
  ---
  duration_ms: 0.4745
  type: 'test'
  ...
# Subtest: Conversation Item mapper exposes only the seven safe projection fields plus occurred_at
ok 310 - Conversation Item mapper exposes only the seven safe projection fields plus occurred_at
  ---
  duration_ms: 0.4423
  type: 'test'
  ...
# Subtest: Session fixture mapper freezes created and updated event variants with safe payloads
ok 311 - Session fixture mapper freezes created and updated event variants with safe payloads
  ---
  duration_ms: 0.4051
  type: 'test'
  ...
# Subtest: Timeline rebuilt fixture mapper exposes only count and canonical hash metadata
ok 312 - Timeline rebuilt fixture mapper exposes only count and canonical hash metadata
  ---
  duration_ms: 0.8254
  type: 'test'
  ...
# Subtest: public event view contains exactly nine safe fields and no publisher, source, hash or scope IDs
ok 313 - public event view contains exactly nine safe fields and no publisher, source, hash or scope IDs
  ---
  duration_ms: 0.4897
  type: 'test'
  ...
# Subtest: SSE event encoding uses id/type/single-line JSON and supports every frozen event type
ok 314 - SSE event encoding uses id/type/single-line JSON and supports every frozen event type
  ---
  duration_ms: 2.2768
  type: 'test'
  ...
# Subtest: SSE encoding rejects CR/LF event injection and never emits raw payload newlines
ok 315 - SSE encoding rejects CR/LF event injection and never emits raw payload newlines
  ---
  duration_ms: 0.2956
  type: 'test'
  ...
# Subtest: heartbeat is a comment frame and consumes no event id
ok 316 - heartbeat is a comment frame and consumes no event id
  ---
  duration_ms: 0.1052
  type: 'test'
  ...
# Subtest: authorization defaults to deny-all and rejects absent or malformed contexts
ok 317 - authorization defaults to deny-all and rejects absent or malformed contexts
  ---
  duration_ms: 0.3871
  type: 'test'
  ...
# Subtest: authorization normalizes bounded UUID sets without wildcard access
ok 318 - authorization normalizes bounded UUID sets without wildcard access
  ---
  duration_ms: 0.1647
  type: 'test'
  ...
# Subtest: restricted-admin defense-in-depth closes a malicious replay without delivering it
ok 319 - restricted-admin defense-in-depth closes a malicious replay without delivering it
  ---
  duration_ms: 2.6246
  type: 'test'
  ...
# Subtest: controlled principal disconnect closes only the selected SSE client
ok 320 - controlled principal disconnect closes only the selected SSE client
  ---
  duration_ms: 4.92
  type: 'test'
  ...
# Subtest: disabled handler returns safe polling fallback with zero database calls and no timers
ok 321 - disabled handler returns safe polling fallback with zero database calls and no timers
  ---
  duration_ms: 0.6176
  type: 'test'
  ...
# Subtest: disabled event store fails before acquiring a database connection
ok 322 - disabled event store fails before acquiring a database connection
  ---
  duration_ms: 0.4904
  type: 'test'
  ...
# Subtest: disconnect during authentication never acquires replay, Hub, or timer resources
ok 323 - disconnect during authentication never acquires replay, Hub, or timer resources
  ---
  duration_ms: 0.3587
  type: 'test'
  ...
# Subtest: disconnect during authorization never acquires replay, Hub, or timer resources
ok 324 - disconnect during authorization never acquires replay, Hub, or timer resources
  ---
  duration_ms: 0.3272
  type: 'test'
  ...
# Subtest: Wakeup Hub admits 32 clients, rejects the 33rd, and releases capacity
ok 325 - Wakeup Hub admits 32 clients, rejects the 33rd, and releases capacity
  ---
  duration_ms: 0.2272
  type: 'test'
  ...
# Subtest: replay batch configuration accepts 200 and rejects 201
ok 326 - replay batch configuration accepts 200 and rejects 201
  ---
  duration_ms: 0.1524
  type: 'test'
  ...
# Subtest: list replay rejects limits above 200 before querying storage
ok 327 - list replay rejects limits above 200 before querying storage
  ---
  duration_ms: 0.3975
  type: 'test'
  ...
# Subtest: backpressure waits for drain and releases only the affected stream
ok 328 - backpressure waits for drain and releases only the affected stream
  ---
  duration_ms: 1.0072
  type: 'test'
  ...
# Subtest: drain timeout disconnects only the slow client with bounded metrics
ok 329 - drain timeout disconnects only the slow client with bounded metrics
  ---
  duration_ms: 2.4313
  type: 'test'
  ...
# Subtest: retention gap after SSE headers closes the stream and reconnect returns 410 fallback
ok 330 - retention gap after SSE headers closes the stream and reconnect returns 410 fallback
  ---
  duration_ms: 0.8722
  type: 'test'
  ...
# Subtest: polling fallback normalizes canonical IDs and rejects unsafe forms
ok 331 - polling fallback normalizes canonical IDs and rejects unsafe forms
  ---
  duration_ms: 0.1175
  type: 'test'
  ...
# Subtest: public HTTP errors expose only stable codes and never raw authentication failures
ok 332 - public HTTP errors expose only stable codes and never raw authentication failures
  ---
  duration_ms: 0.254
  type: 'test'
  ...
# Subtest: migration 020 is exact, reentrant, CLI-scoped, check-only, and preserves 005/010/011/012 catalogs
ok 333 - migration 020 is exact, reentrant, CLI-scoped, check-only, and preserves 005/010/011/012 catalogs
  ---
  duration_ms: 1430.3157
  type: 'test'
  ...
# {"first_apply":true,"repeated_apply":true,"check_rollback":true,"frozen_catalog_relations":10}
# Subtest: migration 020 fails closed for missing columns, weakened checks, wrong unique, index method and predicate
ok 334 - migration 020 fails closed for missing columns, weakened checks, wrong unique, index method and predicate
  ---
  duration_ms: 3421.8841
  type: 'test'
  ...
# {"drift_mutations":["missingcol","weakcheck","wrongunique","indexmethod","indexpred"],"stable_error":"P2_004_SCHEMA_DRIFT_REMEDIATION_REQUIRED"}
# Subtest: Communication service commits atomically, isolates idempotency scopes, and never mutates Session
ok 335 - Communication service commits atomically, isolates idempotency scopes, and never mutates Session
  ---
  duration_ms: 2203.0468
  type: 'test'
  ...
# {"browser_double_click_concurrency":12,"committed_fact_sets":1,"human_ai_same_body_isolated":true,"internal_note_outbox_count":0}
# Subtest: Delivery Worker enforces claim CAS, ACK, retry, dead letter, timeout unknown and lease recovery
ok 336 - Delivery Worker enforces claim CAS, ACK, retry, dead letter, timeout unknown and lease recovery
  ---
  duration_ms: 2195.6625
  type: 'test'
  ...
# {"concurrent_workers":12,"single_claim":true,"gateway_reconnect":true,"timeout_unknown":true,"leased_recovered":true,"sending_not_resent":true}
# Subtest: multi-target delivery is isolated, target rate limit is durable, and reconciliation is explicit
ok 337 - multi-target delivery is isolated, target rate limit is durable, and reconciliation is explicit
  ---
  duration_ms: 2208.7167
  type: 'test'
  ...
# {"multi_target_count":2,"isolated_outcomes":["SENT","DEAD_LETTER"],"target_rate_limit":true,"reconciliation_resolutions":["CONFIRMED_SENT","CONFIRMED_NOT_SENT_REQUEUE","CANCEL"]}
# Subtest: real Worker kill/restart reclaims LEASED but never blindly resends SENDING
ok 338 - real Worker kill/restart reclaims LEASED but never blindly resends SENDING
  ---
  duration_ms: 2439.242
  type: 'test'
  ...
# {"leased_child_exit":{"code":null,"signal":"SIGKILL"},"leased_restart_sent":true,"sending_child_exit":{"code":null,"signal":"SIGKILL"},"sending_restart_reconciled":true,"blind_resend_count":0}
# Subtest: P1 compatibility is read-only until it delegates to the existing P1 worker
ok 339 - P1 compatibility is read-only until it delegates to the existing P1 worker
  ---
  duration_ms: 2532.2823
  type: 'test'
  ...
# {"p1_read_snapshot_unchanged":true,"p1_delivery_delegated":true,"communication_rows_created":0}
# Subtest: 500 deliveries remain bounded at batch 20 and interruption resumes without resource growth
ok 340 - 500 deliveries remain bounded at batch 20 and interruption resumes without resource growth
  ---
  duration_ms: 10639.2618
  type: 'test'
  ...
# {"deliveries":500,"batch_size":20,"interrupted_after":100,"resumed_to":500,"heap_samples":[17746864,18005152,14640216,14770216,15245992,18035248,14852200,18645024,16941304,19709608],"heap_growth_bytes":1962744,"soak_claimed":false}
# Subtest: P2-004 integration leaves no owned database or backend residual
ok 341 - P2-004 integration leaves no owned database or backend residual
  ---
  duration_ms: 56.8939
  type: 'test'
  ...
# {"database_count":0,"backend_count":0,"active_database_count":0,"worker_child_count":0,"worker_count":0,"timer_count":0,"child_process_count":0}
# Subtest: P2-004 JSON Schemas use draft 2020-12 and close object shapes
ok 342 - P2-004 JSON Schemas use draft 2020-12 and close object shapes
  ---
  duration_ms: 9.6909
  type: 'test'
  ...
# Subtest: Reply Command schema and future OpenAPI bind session and idempotency without exposing a target
ok 343 - Reply Command schema and future OpenAPI bind session and idempotency without exposing a target
  ---
  duration_ms: 2.1699
  type: 'test'
  ...
# Subtest: frozen Communication vocabularies are exact
ok 344 - frozen Communication vocabularies are exact
  ---
  duration_ms: 0.9416
  type: 'test'
  ...
# Subtest: normalization freezes Agent, AI, System, internal note and media contracts
ok 345 - normalization freezes Agent, AI, System, internal note and media contracts
  ---
  duration_ms: 1.5643
  type: 'test'
  ...
# Subtest: invalid UUID, row version, privacy, retention, message type, and browser authority are rejected
ok 346 - invalid UUID, row version, privacy, retention, message type, and browser authority are rejected
  ---
  duration_ms: 0.6335
  type: 'test'
  ...
# Subtest: plain JSON fence rejects Proxy, accessor, symbol, toJSON, prototype and pollution keys
ok 347 - plain JSON fence rejects Proxy, accessor, symbol, toJSON, prototype and pollution keys
  ---
  duration_ms: 0.2886
  type: 'test'
  ...
# Subtest: plain JSON fence enforces depth, node, string and array bounds
ok 348 - plain JSON fence enforces depth, node, string and array bounds
  ---
  duration_ms: 0.1842
  type: 'test'
  ...
# Subtest: content and command hashes are stable, key-order independent and cover row version
ok 349 - content and command hashes are stable, key-order independent and cover row version
  ---
  duration_ms: 0.8716
  type: 'test'
  ...
# Subtest: destination resolution uses authoritative Thread fields for single and group
ok 350 - destination resolution uses authoritative Thread fields for single and group
  ---
  duration_ms: 0.2446
  type: 'test'
  ...
# Subtest: disabled service performs zero database and authorization work
ok 351 - disabled service performs zero database and authorization work
  ---
  duration_ms: 0.3519
  type: 'test'
  ...
# Subtest: disabled Worker performs zero database and Sender calls
ok 352 - disabled Worker performs zero database and Sender calls
  ---
  duration_ms: 0.2908
  type: 'test'
  ...
# Subtest: Sender Port validates ACK, rejected, unknown and rejects malformed results
ok 353 - Sender Port validates ACK, rejected, unknown and rejects malformed results
  ---
  duration_ms: 0.3116
  type: 'test'
  ...
# Subtest: Mock Sender records only safe call metadata
ok 354 - Mock Sender records only safe call metadata
  ---
  duration_ms: 0.2673
  type: 'test'
  ...
# Subtest: message projection maps Agent, AI, Internal and System without changing ownership
ok 355 - message projection maps Agent, AI, Internal and System without changing ownership
  ---
  duration_ms: 0.3094
  type: 'test'
  ...
# Subtest: delivery timeline and realtime mappers expose only safe delivery fields
ok 356 - delivery timeline and realtime mappers expose only safe delivery fields
  ---
  duration_ms: 0.2066
  type: 'test'
  ...
# Subtest: legacy notification mapping is safe and exact
ok 357 - legacy notification mapping is safe and exact
  ---
  duration_ms: 0.1075
  type: 'test'
  ...
# Subtest: public stable error inventory excludes raw provider and storage details
ok 358 - public stable error inventory excludes raw provider and storage details
  ---
  duration_ms: 0.0829
  type: 'test'
  ...
# Subtest: migration 021 is scoped, reentrant, check-rolls-back, and drift fails closed
ok 359 - migration 021 is scoped, reentrant, check-rolls-back, and drift fails closed
  ---
  duration_ms: 4265.7044
  type: 'test'
  ...
# {"first_apply":true,"repeated_apply":true,"check_rollback":true,"new_tables":4}
# Subtest: takeover is serialized/idempotent; handoff request-accept-release and request-cancel are audited atomically
ok 360 - takeover is serialized/idempotent; handoff request-accept-release and request-cancel are audited atomically
  ---
  duration_ms: 2488.0068
  type: 'test'
  ...
# {"concurrent_winners":1,"idempotent_parallel":12,"handoff":["REQUESTED","ACCEPTED","RELEASED"],"cancel":"CANCELLED"}
# Subtest: admin force transfer works; non-admin, inactive target, wrong-team handler, ended and stale commands fail closed
ok 361 - admin force transfer works; non-admin, inactive target, wrong-team handler, ended and stale commands fail closed
  ---
  duration_ms: 2168.1638
  type: 'test'
  ...
# {"admin_force_transfer":true,"handler_force":false,"inactive":false,"wrong_team":false}
# Subtest: generation race blocks stale AI before Communication and realtime failure rolls back control facts
ok 362 - generation race blocks stale AI before Communication and realtime failure rolls back control facts
  ---
  duration_ms: 2331.2099
  type: 'test'
  ...
# {"generation_start":1,"stale":true,"append_communication_calls":0,"message_delta":0,"outbox_delta":0,"delivery_delta":0,"realtime_failure_rollback":true}
# Subtest: 32 principals keep independent monotonic cursors; visibility COUNT is correct and Session versions do not move
ok 363 - 32 principals keep independent monotonic cursors; visibility COUNT is correct and Session versions do not move
  ---
  duration_ms: 2522.3217
  type: 'test'
  ...
# {"principals":32,"monotonic":true,"session_version_unchanged":true,"workbench_unread":1,"restricted_unread":2}
# Subtest: 2C4G bounded capacity covers 500 assignment/handoff facts and 2,000 cursor updates without residual resources
ok 364 - 2C4G bounded capacity covers 500 assignment/handoff facts and 2,000 cursor updates without residual resources
  ---
  duration_ms: 3955.357
  type: 'test'
  ...
# {"assignments":500,"handoffs":500,"cursor_updates":2000,"max_list_limit":200,"heap_samples":5,"heap_monotonic_unbounded":false,"pool_max":4,"soak_24h":false}
# Subtest: all P2-005 JSON Schemas parse and freeze strict objects
ok 365 - all P2-005 JSON Schemas parse and freeze strict objects
  ---
  duration_ms: 4.1472
  type: 'test'
  ...
# Subtest: status, command, event, invalidation, and stable error vocabularies are frozen
ok 366 - status, command, event, invalidation, and stable error vocabularies are frozen
  ---
  duration_ms: 0.7367
  type: 'test'
  ...
# Subtest: normalization is bounded and command hash is stable across key order
ok 367 - normalization is bounded and command hash is stable across key order
  ---
  duration_ms: 1.5747
  type: 'test'
  ...
# Subtest: invalid identifiers, versions, sequences, reason codes, target modes, and extra authority fail closed
ok 368 - invalid identifiers, versions, sequences, reason codes, target modes, and extra authority fail closed
  ---
  duration_ms: 0.664
  type: 'test'
  ...
# Subtest: non-plain JSON, Proxy, accessor, toJSON, symbol, cycle, and prototype pollution are rejected
ok 369 - non-plain JSON, Proxy, accessor, toJSON, symbol, cycle, and prototype pollution are rejected
  ---
  duration_ms: 0.3076
  type: 'test'
  ...
# Subtest: default authorization rejects every operation
ok 370 - default authorization rejects every operation
  ---
  duration_ms: 0.1832
  type: 'test'
  ...
# Subtest: disabled service returns before every database call and hides raw failures
ok 371 - disabled service returns before every database call and hides raw failures
  ---
  duration_ms: 0.3755
  type: 'test'
  ...
# Subtest: generation fence distinguishes current, stale, and HUMAN-forbidden without process state
ok 372 - generation fence distinguishes current, stale, and HUMAN-forbidden without process state
  ---
  duration_ms: 1.2055
  type: 'test'
  ...
# Subtest: assigned Communication authorizer denies AI flags, inactive/unassigned agents, and accepts assigned active actor
ok 373 - assigned Communication authorizer denies AI flags, inactive/unassigned agents, and accepts assigned active actor
  ---
  duration_ms: 1.225
  type: 'test'
  ...
# Subtest: Realtime mappers expose versions/status only and no identity or content
ok 374 - Realtime mappers expose versions/status only and no identity or content
  ---
  duration_ms: 0.6393
  type: 'test'
  ...
# Subtest: Timeline mapper uses internal HANDOFF_EVENT and requires explicit privacy/retention
ok 375 - Timeline mapper uses internal HANDOFF_EVENT and requires explicit privacy/retention
  ---
  duration_ms: 0.2832
  type: 'test'
  ...
# Subtest: system browser desktop workbench flow is responsive, refresh-safe and XSS-safe
ok 376 - system browser desktop workbench flow is responsive, refresh-safe and XSS-safe
  ---
  duration_ms: 1436.036
  type: 'test'
  ...
# {"browser":"C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe","viewport":{"label":"desktop","width":1440,"height":900},"interactions":{"select":1,"takeover":1,"transfer":1,"reply":1,"internal_note":1,"sse_update":true,"polling_fallback":true,"filter":true,"refresh_restore":true},"keyboard_focus_visible":true,"security_headers":true,"xss_executed":false,"horizontal_overflow":false}
# Subtest: system browser mobile workbench flow is responsive, refresh-safe and XSS-safe
ok 377 - system browser mobile workbench flow is responsive, refresh-safe and XSS-safe
  ---
  duration_ms: 1950.9254
  type: 'test'
  ...
# {"browser":"C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe","viewport":{"label":"mobile","width":390,"height":844},"interactions":{"select":1,"takeover":1,"transfer":1,"reply":1,"internal_note":1,"sse_update":true,"polling_fallback":true,"filter":true,"refresh_restore":true},"keyboard_focus_visible":true,"security_headers":true,"xss_executed":false,"horizontal_overflow":false}
# Subtest: system browser renders the same Workbench LocalDateTime under UTC, Tokyo, and New York
ok 378 - system browser renders the same Workbench LocalDateTime under UTC, Tokyo, and New York
  ---
  duration_ms: 1896.2039
  type: 'test'
  ...
# Subtest: P2-006 applies no DDL and leaves no isolated PostgreSQL resources
ok 379 - P2-006 applies no DDL and leaves no isolated PostgreSQL resources
  ---
  duration_ms: 2453.0666
  type: 'test'
  ...
# {"migration_022":true,"catalog_unchanged":true,"feature_enabled_only_in_test":true}
# Subtest: admin/dispatcher/handler authorization is enforced in SQL data access and timeline visibility
ok 380 - admin/dispatcher/handler authorization is enforced in SQL data access and timeline visibility
  ---
  duration_ms: 2245.9917
  type: 'test'
  ...
# {"admin_sessions":2,"dispatcher_sessions":2,"assigned_handler_sessions":1,"outsider_sessions":0,"reporter_forbidden":true,"inactive_forbidden":true,"restricted_hidden_from_handler":true}
# Subtest: 500 conversations and 10,000 items have duplicate-free keyset pages and bounded read latency
ok 381 - 500 conversations and 10,000 items have duplicate-free keyset pages and bounded read latency
  ---
  duration_ms: 42226.9119
  type: 'test'
  ...
# {"sessions":500,"items":10000,"assignments":500,"tickets":500,"deliveries":500,"list_requests":1000,"detail_requests":1000,"keyset_unique":true,"p95":{"list_ms":57.268,"detail_ms":8.275}}
# Subtest: workbench facade commits human reply, internal note, takeover and idempotent replay through P2-004/P2-005 ports
ok 382 - workbench facade commits human reply, internal note, takeover and idempotent replay through P2-004/P2-005 ports
  ---
  duration_ms: 1999.581
  type: 'test'
  ...
# {"takeover":true,"replayed":true,"transfer":true,"release":true,"handoff_request_cancel":true,"read_cursor":1,"external_messages":1,"internal_notes":1,"external_outbox":1,"internal_outbox":0,"pending_retry":true,"dead_letter_requeue":true,"reconciliation_required_blocks_retry":true,"admin_reconciliation":true}
# Subtest: 200 real HTTP reply commits and 12-way duplicate submit remain bounded without sender calls or socket residue
ok 383 - 200 real HTTP reply commits and 12-way duplicate submit remain bounded without sender calls or socket residue
  ---
  duration_ms: 6112.91
  type: 'test'
  ...
# {"reply_http":{"samples":200,"p50_ms":15.429,"p95_ms":22.017,"p99_ms":26.451,"max_ms":66.157},"duplicate_submit_parallel":12,"messages":201,"outboxes":201,"deliveries":201,"sender_calls":0,"heap_samples_bytes":[16551080,24742184,21854032,28929856,18977824,25959096,22206168,29343272],"pool_max":4}
# Subtest: P2-003 SSE route delivers committed messages through authorized refetch within 2 seconds and releases timers
ok 384 - P2-003 SSE route delivers committed messages through authorized refetch within 2 seconds and releases timers
  ---
  duration_ms: 4803.7859
  type: 'test'
  ...
# {"new_message_commit_sse_refetch":{"samples":100,"p50_ms":19.333,"p95_ms":28.213,"p99_ms":39.743,"max_ms":97.616},"authorized_events":100,"unauthorized_events":0}
# Subtest: workbench schemas parse and OpenAPI 3.1 exposes every implemented route
ok 385 - workbench schemas parse and OpenAPI 3.1 exposes every implemented route
  ---
  duration_ms: 5.4679
  type: 'test'
  ...
# Subtest: opaque cursor round-trips normalized timestamp and session id
ok 386 - opaque cursor round-trips normalized timestamp and session id
  ---
  duration_ms: 1.6303
  type: 'test'
  ...
# Subtest: opaque cursor rejects malformed, oversized, and structurally extended values
ok 387 - opaque cursor rejects malformed, oversized, and structurally extended values
  ---
  duration_ms: 0.85
  type: 'test'
  ...
# Subtest: disabled query service performs zero database and authorization calls
ok 388 - disabled query service performs zero database and authorization calls
  ---
  duration_ms: 0.5408
  type: 'test'
  ...
# Subtest: list SQL applies authorization in WHERE before keyset ORDER BY and LIMIT
ok 389 - list SQL applies authorization in WHERE before keyset ORDER BY and LIMIT
  ---
  duration_ms: 0.6104
  type: 'test'
  ...
# Subtest: query page limit and state filters fail closed
ok 390 - query page limit and state filters fail closed
  ---
  duration_ms: 0.3044
  type: 'test'
  ...
# Subtest: HTTP server construction fails when authentication port is absent
ok 391 - HTTP server construction fails when authentication port is absent
  ---
  duration_ms: 0.4778
  type: 'test'
  ...
# Subtest: HTTP API rejects unauthenticated and expired contexts without fallback
ok 392 - HTTP API rejects unauthenticated and expired contexts without fallback
  ---
  duration_ms: 57.4832
  type: 'test'
  ...
# Subtest: Cookie writes require exact origin, same-site context, constant-time CSRF and matching idempotency
ok 393 - Cookie writes require exact origin, same-site context, constant-time CSRF and matching idempotency
  ---
  duration_ms: 33.2403
  type: 'test'
  ...
# Subtest: Bearer mode requires Authorization header and tokens in query are forbidden
ok 394 - Bearer mode requires Authorization header and tokens in query are forbidden
  ---
  duration_ms: 8.089
  type: 'test'
  ...
# Subtest: HTTP security headers contain strict CSP without inline or eval and no wildcard CORS
ok 395 - HTTP security headers contain strict CSP without inline or eval and no wildcard CORS
  ---
  duration_ms: 4.9603
  type: 'test'
  ...
# Subtest: non-JSON and oversized write bodies are rejected with stable public errors
ok 396 - non-JSON and oversized write bodies are rejected with stable public errors
  ---
  duration_ms: 9.516
  type: 'test'
  ...
# Subtest: command facade delegates frozen control and communication ports without sender access
ok 397 - command facade delegates frozen control and communication ports without sender access
  ---
  duration_ms: 1.1606
  type: 'test'
  ...
# Subtest: UI source renders untrusted content through text nodes only
ok 398 - UI source renders untrusted content through text nodes only
  ---
  duration_ms: 0.5296
  type: 'test'
  ...
# Subtest: UI reducer bounds conversations and timeline arrays
ok 399 - UI reducer bounds conversations and timeline arrays
  ---
  duration_ms: 0.5392
  type: 'test'
  ...
# Subtest: refresh storage persists only selected id and filter
ok 400 - refresh storage persists only selected id and filter
  ---
  duration_ms: 0.2543
  type: 'test'
  ...
# Subtest: P2-006 creates no migration and static preview check succeeds
ok 401 - P2-006 creates no migration and static preview check succeeds
  ---
  duration_ms: 111.1673
  type: 'test'
  ...
# Subtest: P2-012 real command capacity 500 candidates, 200 incidents, 2000 reports, 1000 subscriptions, 5000 events, 500 bindings and 32 SSE
ok 402 - P2-012 real command capacity 500 candidates, 200 incidents, 2000 reports, 1000 subscriptions, 5000 events, 500 bindings and 32 SSE
  ---
  duration_ms: 58124.1399
  type: 'test'
  ...
# {"candidates":500,"incidents":200,"reports":2000,"subscriptions":1000,"events":5200,"bindings":550,"notification_sent":550,"pool_max":4,"sse_max":32,"sse_after_stop":0,"heap_samples_bytes":[15171984,33018256,52418576,67361568,23262136,21686632,42433848,42008832,40678456,36588496,33070336,18349848,20655472],"heap_peak_bytes":67361568,"heap_final_bytes":20655472,"real_sdk_calls":0,"model_calls":0}
# {"cleanup":{"database_count":0,"backend_count":0}}
# Subtest: P2-012 closes input shapes, rejects hostile values and preserves deterministic command hashes
ok 403 - P2-012 closes input shapes, rejects hostile values and preserves deterministic command hashes
  ---
  duration_ms: 7.7523
  type: 'test'
  ...
# Subtest: P2-012 stable HTTP matrix is exhaustive, deterministic and rejects hostile results without executing code
ok 404 - P2-012 stable HTTP matrix is exhaustive, deterministic and rejects hostile results without executing code
  ---
  duration_ms: 67.9044
  type: 'test'
  ...
# Subtest: P2-012 maintenance expires a bounded ordered batch through private SYSTEM commands without notifications
ok 405 - P2-012 maintenance expires a bounded ordered batch through private SYSTEM commands without notifications
  ---
  duration_ms: 6079.966
  type: 'test'
  ...
# Subtest: P2-012 maintenance replays concurrent scans, handles human/time races and surfaces a still-due failure
ok 406 - P2-012 maintenance replays concurrent scans, handles human/time races and surfaces a still-due failure
  ---
  duration_ms: 7044.6147
  type: 'test'
  ...
# Subtest: P2-012 maintenance scans after import and expires an imported due candidate in the same iteration
ok 407 - P2-012 maintenance scans after import and expires an imported due candidate in the same iteration
  ---
  duration_ms: 1585.8162
  type: 'test'
  ...
# Subtest: P2-012 real database human confirmation, idempotency, recovery isolation and notification facts
ok 408 - P2-012 real database human confirmation, idempotency, recovery isolation and notification facts
  ---
  duration_ms: 2678.7554
  type: 'test'
  ...
# Subtest: dynamic live configuration requires an approved group but no preconfigured Reporter userid hash
ok 409 - dynamic live configuration requires an approved group but no preconfigured Reporter userid hash
  ---
  duration_ms: 3.0746
  type: 'test'
  ...
# Subtest: dynamic Sender rechecks the persisted approved-group Reporter before each PERSON provider call
ok 410 - dynamic Sender rechecks the persisted approved-group Reporter before each PERSON provider call
  ---
  duration_ms: 1.8199
  type: 'test'
  ...
# Subtest: approved test group discovers an unconfigured Reporter before their direct flow and outbound notice
ok 411 - approved test group discovers an unconfigured Reporter before their direct flow and outbound notice
  ---
  duration_ms: 1.0334
  type: 'test'
  ...
# Subtest: P2-012 migration 032 applies atomically, detects catalog drift and preserves seven-table scope
ok 412 - P2-012 migration 032 applies atomically, detects catalog drift and preserves seven-table scope
  ---
  duration_ms: 2746.9958
  type: 'test'
  ...
# Subtest: P2-012 fresh current baseline reaches 032 and repeated status/check/apply preserve the catalog
ok 413 - P2-012 fresh current baseline reaches 032 and repeated status/check/apply preserve the catalog
  ---
  duration_ms: 4610.3641
  type: 'test'
  ...
# Subtest: P2-012 network-off three-role assembly serves Incident and closes children, sockets and pools
ok 414 - P2-012 network-off three-role assembly serves Incident and closes children, sockets and pools
  ---
  duration_ms: 5497.7382
  type: 'test'
  ...
# {"network_enabled":false,"restarted":false,"metrics":{"process_count":3,"gateway_authenticated":0,"gateway_reconnect_total":0,"app_rss_bytes":85311488,"app_heap_used_bytes":20439528,"app_heap_total_bytes":33603584,"app_external_bytes":4566034,"app_cpu_percent":15.251,"app_event_loop_delay_p95_ms":31.719423,"app_active_resources":8,"app_active_timers":2,"app_active_sockets":6,"app_active_file_handles":0,"app_active_handles":6,"app_uptime_seconds":1.608,"app_pool_total":2,"app_pool_idle":2,"app_pool_waiting":0,"app_pool_max":4,"worker_rss_bytes":92909568,"worker_heap_used_bytes":18684704,"worker_heap_total_bytes":33865728,"worker_external_bytes":4473965,"worker_cpu_percent":17.789,"worker_event_loop_delay_p95_ms":32.063487,"worker_active_resources":4,"worker_active_timers":2,"worker_active_sockets":2,"worker_active_file_handles":0,"worker_active_handles":2,"worker_uptime_seconds":1.602,"worker_pool_total":1,"worker_pool_idle":1,"worker_pool_waiting":0,"worker_pool_max":2,"gateway_rss_bytes":80203776,"gateway_heap_used_bytes":12696864,"gateway_heap_total_bytes":31604736,"gateway_external_bytes":4206782,"gateway_cpu_percent":2.463,"gateway_event_loop_delay_p95_ms":32.161791,"gateway_active_resources":2,"gateway_active_timers":1,"gateway_active_sockets":1,"gateway_active_file_handles":0,"gateway_active_handles":1,"gateway_uptime_seconds":1.635,"gateway_pool_total":0,"gateway_pool_idle":0,"gateway_pool_waiting":0,"gateway_pool_max":1,"total_rss_bytes":258424832,"total_heap_used_bytes":51821096,"total_cpu_percent":35.503,"sse_clients":0,"projection_backlog":0,"projection_failures":0,"communication_pending":1,"dead_letter":0,"reconciliation_required":0,"postgres_active_connections":1,"postgres_idle_connections":4,"postgres_other_connections":0,"postgres_max_connections":100,"postgres_connection_utilization_percent":5}}
# {"network_enabled":false,"restarted":true,"metrics":{"process_count":3,"gateway_authenticated":0,"gateway_reconnect_total":0,"app_rss_bytes":83144704,"app_heap_used_bytes":15031432,"app_heap_total_bytes":33079296,"app_external_bytes":4334348,"app_cpu_percent":48.968,"app_event_loop_delay_p95_ms":32.129023,"app_active_resources":6,"app_active_timers":1,"app_active_sockets":5,"app_active_file_handles":0,"app_active_handles":5,"app_uptime_seconds":0.49,"app_pool_total":1,"app_pool_idle":1,"app_pool_waiting":0,"app_pool_max":4,"worker_rss_bytes":89739264,"worker_heap_used_bytes":13362280,"worker_heap_total_bytes":32129024,"worker_external_bytes":4206782,"worker_cpu_percent":58.199,"worker_event_loop_delay_p95_ms":32.063487,"worker_active_resources":2,"worker_active_timers":1,"worker_active_sockets":1,"worker_active_file_handles":0,"worker_active_handles":1,"worker_uptime_seconds":0.483,"worker_pool_total":0,"worker_pool_idle":0,"worker_pool_waiting":0,"worker_pool_max":2,"gateway_rss_bytes":79601664,"gateway_heap_used_bytes":12717584,"gateway_heap_total_bytes":31604736,"gateway_external_bytes":4206782,"gateway_cpu_percent":6.487,"gateway_event_loop_delay_p95_ms":32.686079,"gateway_active_resources":2,"gateway_active_timers":1,"gateway_active_sockets":1,"gateway_active_file_handles":0,"gateway_active_handles":1,"gateway_uptime_seconds":0.495,"gateway_pool_total":0,"gateway_pool_idle":0,"gateway_pool_waiting":0,"gateway_pool_max":1,"total_rss_bytes":252485632,"total_heap_used_bytes":41111296,"total_cpu_percent":113.654,"sse_clients":0,"projection_backlog":0,"projection_failures":0,"communication_pending":1,"dead_letter":0,"reconciliation_required":0,"postgres_active_connections":1,"postgres_idle_connections":3,"postgres_other_connections":0,"postgres_max_connections":100,"postgres_connection_utilization_percent":4}}
# Subtest: P2-012 Reporter HTTP preserves bound grants, refresh ETag, safe milestones and unlink visibility
ok 415 - P2-012 Reporter HTTP preserves bound grants, refresh ETag, safe milestones and unlink visibility
  ---
  duration_ms: 4343.4918
  type: 'test'
  ...
# Subtest: P2-012 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
ok 416 - P2-012 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
  ---
  duration_ms: 5781.4493
  type: 'test'
  ...
# {"server_commit_response_lost":true,"restart_replayed":true,"incident_confirmed_event_count":1,"unknown_recovery_send_calls":0,"authorized_retry_calls":1,"ack_restart_send_calls":0}
# Subtest: P2-012 both parsed OpenAPI documents declare canonical subscription destinations and service failures
ok 417 - P2-012 both parsed OpenAPI documents declare canonical subscription destinations and service failures
  ---
  duration_ms: 752.2985
  type: 'test'
  ...
# Subtest: P2-012 static authorization, frozen predecessors, scope, schemas and synthetic fixture gate
ok 418 - P2-012 static authorization, frozen predecessors, scope, schemas and synthetic fixture gate
  ---
  duration_ms: 3831.0994
  type: 'test'
  ...
# Subtest: P2-012 live runner fails before network/listener unless all five independent fuses and verified evidence exist
ok 419 - P2-012 live runner fails before network/listener unless all five independent fuses and verified evidence exist
  ---
  duration_ms: 2.4139
  type: 'test'
  ...
# Subtest: P2-012 readiness cannot be fabricated from partial regression, skips, changed inputs or live claims
ok 420 - P2-012 readiness cannot be fabricated from partial regression, skips, changed inputs or live claims
  ---
  duration_ms: 0.6323
  type: 'test'
  ...
# Subtest: P2-012 DONE requires the approved live candidate, client confirmation, clean Incident deliveries and complete regressions
ok 421 - P2-012 DONE requires the approved live candidate, client confirmation, clean Incident deliveries and complete regressions
  ---
  duration_ms: 0.5606
  type: 'test'
  ...
# Subtest: P2-012 frozen candidate permits only the explicit closeout governance set
ok 422 - P2-012 frozen candidate permits only the explicit closeout governance set
  ---
  duration_ms: 0.5719
  type: 'test'
  ...
# Subtest: P2-012 review hardening preserves exact paths and requires independent current regression evidence
ok 423 - P2-012 review hardening preserves exact paths and requires independent current regression evidence
  ---
  duration_ms: 0.7328
  type: 'test'
  ...
# Subtest: P2-012 v2 HTTP OpenAPI hardening has an independent closed allowlist and complete regression gate
ok 424 - P2-012 v2 HTTP OpenAPI hardening has an independent closed allowlist and complete regression gate
  ---
  duration_ms: 0.8423
  type: 'test'
  ...
# Subtest: P2-012 incomplete persisted Candidate summary remains explicit and does not invent clustering evidence
ok 425 - P2-012 incomplete persisted Candidate summary remains explicit and does not invent clustering evidence
  ---
  duration_ms: 1.9066
  type: 'test'
  ...
# Subtest: P2-012 four scope permissions, authorization before replay, expiry maintenance and closed schemas
ok 426 - P2-012 four scope permissions, authorization before replay, expiry maintenance and closed schemas
  ---
  duration_ms: 3849.5114
  type: 'test'
  ...
# Subtest: P2-012 approved-group Reporter discovery persists before direct intake, Sender scope and database guard
ok 427 - P2-012 approved-group Reporter discovery persists before direct intake, Sender scope and database guard
  ---
  duration_ms: 2781.4153
  type: 'test'
  ...
# Subtest: P2-012 real direct-leg eligibility suppresses group-only Ticket artifacts and validates persisted destination scope
ok 428 - P2-012 real direct-leg eligibility suppresses group-only Ticket artifacts and validates persisted destination scope
  ---
  duration_ms: 2244.9622
  type: 'test'
  ...
# Subtest: P2-012 cross-channel same reporter, pending activation, pause, unlink and reporter-safe history
ok 429 - P2-012 cross-channel same reporter, pending activation, pause, unlink and reporter-safe history
  ---
  duration_ms: 2804.3316
  type: 'test'
  ...
# Subtest: P2-012 fixed notices reuse sender, restart persistence, explicit UNKNOWN reconciliation and no blind resend
ok 430 - P2-012 fixed notices reuse sender, restart persistence, explicit UNKNOWN reconciliation and no blind resend
  ---
  duration_ms: 2712.7638
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 1440x900 human confirmation, refresh and accessibility
ok 431 - P2-012 database-backed browser 1440x900 human confirmation, refresh and accessibility
  ---
  duration_ms: 6495.5689
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 1366x768 human confirmation, refresh and accessibility
ok 432 - P2-012 database-backed browser 1366x768 human confirmation, refresh and accessibility
  ---
  duration_ms: 5350.9451
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 390x844 human confirmation, refresh and accessibility
ok 433 - P2-012 database-backed browser 390x844 human confirmation, refresh and accessibility
  ---
  duration_ms: 6313.963
  type: 'test'
  ...
# Subtest: P2-012 actual HTTP inherits authentication, CSRF, command fence and durable realtime
ok 434 - P2-012 actual HTTP inherits authentication, CSRF, command fence and durable realtime
  ---
  duration_ms: 3555.7375
  type: 'test'
  ...
# Subtest: P2-012 actual HTTP preserves notification failure, rollback and durable replay before explicit recovery
ok 435 - P2-012 actual HTTP preserves notification failure, rollback and durable replay before explicit recovery
  ---
  duration_ms: 4175.0584
  type: 'test'
  ...
# Subtest: reporter identity is HMAC-bound and directory failures defer safely
ok 436 - reporter identity is HMAC-bound and directory failures defer safely
  ---
  duration_ms: 2.163
  type: 'test'
  ...
# Subtest: direct association follows reliable priorities and never uses userid plus time
ok 437 - direct association follows reliable priorities and never uses userid plus time
  ---
  duration_ms: 1.1956
  type: 'test'
  ...
# Subtest: manual review internal query and resolve default deny before storage access
ok 438 - manual review internal query and resolve default deny before storage access
  ---
  duration_ms: 1.5062
  type: 'test'
  ...
# Subtest: migration 030 supports fresh baseline, check rollback, apply, no-op and five drift failures
ok 439 - migration 030 supports fresh baseline, check rollback, apply, no-op and five drift failures
  ---
  duration_ms: 4944.5955
  type: 'test'
  ...
# Subtest: orchestrator persists three entries, keeps threads separate and replays Ticket/Communication safely
ok 440 - orchestrator persists three entries, keeps threads separate and replays Ticket/Communication safely
  ---
  duration_ms: 3175.4143
  type: 'test'
  ...
# Subtest: rule failure reaches review; authorized keyset query and concurrent human resolution append one override
ok 441 - rule failure reaches review; authorized keyset query and concurrent human resolution append one override
  ---
  duration_ms: 3408.5422
  type: 'test'
  ...
# Subtest: continuation refs are hashed, reporter/bot bound, expiring, revocable and single-use
ok 442 - continuation refs are hashed, reporter/bot bound, expiring, revocable and single-use
  ---
  duration_ms: 2882.5145
  type: 'test'
  ...
# Subtest: migration 001 through 022 and P2-007 runtime are unchanged from origin/main
ok 443 - migration 001 through 022 and P2-007 runtime are unchanged from origin/main
  ---
  duration_ms: 65.7081
  type: 'test'
  ...
# Subtest: strict feature flags default false and reject non-canonical values
ok 444 - strict feature flags default false and reject non-canonical values
  ---
  duration_ms: 2.2814
  type: 'test'
  ...
# Subtest: ordinary JSON boundary rejects proxy, accessor, symbol, toJSON, cycles and pollution keys
ok 445 - ordinary JSON boundary rejects proxy, accessor, symbol, toJSON, cycles and pollution keys
  ---
  duration_ms: 0.3531
  type: 'test'
  ...
# Subtest: router protects faults from acknowledgement and maps required examples
ok 446 - router protects faults from acknowledgement and maps required examples
  ---
  duration_ms: 48.5236
  type: 'test'
  ...
# Subtest: ten result codes are reachable and deterministic
ok 447 - ten result codes are reachable and deterministic
  ---
  duration_ms: 72.9011
  type: 'test'
  ...
# Subtest: clinical high risk reaches review and unsupported root cause is never confirmed
ok 448 - clinical high risk reaches review and unsupported root cause is never confirmed
  ---
  duration_ms: 28.4029
  type: 'test'
  ...
# Subtest: gold manifest references all 96 + 42 + 64 frozen cases with ten routes
ok 449 - gold manifest references all 96 + 42 + 64 frozen cases with ten routes
  ---
  duration_ms: 1.2147
  type: 'test'
  ...
# Subtest: crash before commit leaves no partial facts; crash after commit restarts as replay
ok 450 - crash before commit leaves no partial facts; crash after commit restarts as replay
  ---
  duration_ms: 3903.7108
  type: 'test'
  ...
# {"crash_before_commit_partial_facts":{"journeys":0,"decisions":0,"tickets":0},"crash_after_commit":{"journeys":1,"decisions":1,"tickets":1},"restart_processed":0,"replay_duplicate_delta":0}
# Subtest: bounded worker processes 500 journeys, 2000 turns, 500 decisions and 100 reviews on one worker
ok 451 - bounded worker processes 500 journeys, 2000 turns, 500 decisions and 100 reviews on one worker
  ---
  duration_ms: 14559.2545
  type: 'test'
  ...
# {"journeys":500,"turns":2000,"decisions":500,"reviews":100,"worker_count":1,"pool_max":4,"batch_max":100,"heap_samples_bytes":[16486064,16314672,20222776,28632368,20609600,48856168],"heap_fall_or_stable":true,"timer_active_after_stop":false,"soak_24h":false}
# Subtest: worker defaults are bounded and disabled flags claim nothing
ok 452 - worker defaults are bounded and disabled flags claim nothing
  ---
  duration_ms: 1.8623
  type: 'test'
  ...
# Subtest: worker rejects batches above maximum without querying storage
ok 453 - worker rejects batches above maximum without querying storage
  ---
  duration_ms: 0.6383
  type: 'test'
  ...
# Subtest: P2-016 bounded capacity: 500 Tickets / 5000 events / 200 review resolutions / 500 cards / 100 sessions / 32 SSE
ok 454 - P2-016 bounded capacity: 500 Tickets / 5000 events / 200 review resolutions / 500 cards / 100 sessions / 32 SSE
  ---
  duration_ms: 74405.3319
  type: 'test'
  ...
# {"tickets":500,"ticket_events":5000,"review_resolutions":200,"cards":500,"group_receipts":400,"reporter_sessions":100,"pool_max":4,"sse_max":32,"sse_after_stop":0,"heap_samples_bytes":[14822464,30518336,48524784,28877320,33537552,52336872,92035096,48595224,27239536,49044504,29370032,50867336,31233432,52727464,32958416,54452248,34763928,56257992,32846112,49283104,64762640,32461248,51192616,19559152,35434032,51352800,68207616,30605856,54161088,27940584],"heap_peak_bytes":92035096,"heap_final_bytes":27940584,"heap_fall_or_stable":true,"real_sdk_calls":0,"soak_24h":false}
# {"cleanup":{"database_count":0,"backend_count":0}}
# Subtest: P2-016 plain JSON excludes active objects without invoking user hooks
ok 455 - P2-016 plain JSON excludes active objects without invoking user hooks
  ---
  duration_ms: 2.3714
  type: 'test'
  ...
# Subtest: P2-016 strict command, versions, closed keys and bounded lists
ok 456 - P2-016 strict command, versions, closed keys and bounded lists
  ---
  duration_ms: 1.6193
  type: 'test'
  ...
# Subtest: notification policy includes created
ok 457 - notification policy includes created
  ---
  duration_ms: 0.1787
  type: 'test'
  ...
# Subtest: notification policy includes accepted
ok 458 - notification policy includes accepted
  ---
  duration_ms: 0.0954
  type: 'test'
  ...
# Subtest: notification policy includes started
ok 459 - notification policy includes started
  ---
  duration_ms: 0.0923
  type: 'test'
  ...
# Subtest: notification policy includes resumed
ok 460 - notification policy includes resumed
  ---
  duration_ms: 0.1021
  type: 'test'
  ...
# Subtest: notification policy includes waiting_requester
ok 461 - notification policy includes waiting_requester
  ---
  duration_ms: 0.0834
  type: 'test'
  ...
# Subtest: notification policy includes waiting_vendor
ok 462 - notification policy includes waiting_vendor
  ---
  duration_ms: 0.0713
  type: 'test'
  ...
# Subtest: notification policy includes resolved
ok 463 - notification policy includes resolved
  ---
  duration_ms: 0.0805
  type: 'test'
  ...
# Subtest: notification policy includes closed
ok 464 - notification policy includes closed
  ---
  duration_ms: 0.1862
  type: 'test'
  ...
# Subtest: notification policy includes reopened
ok 465 - notification policy includes reopened
  ---
  duration_ms: 0.0895
  type: 'test'
  ...
# Subtest: notification policy includes cancelled
ok 466 - notification policy includes cancelled
  ---
  duration_ms: 0.0833
  type: 'test'
  ...
# Subtest: notes and assignment changes never become external free-text notifications
ok 467 - notes and assignment changes never become external free-text notifications
  ---
  duration_ms: 0.0946
  type: 'test'
  ...
# Subtest: template card exact shape, last-four and safe immutable view
ok 468 - template card exact shape, last-four and safe immutable view
  ---
  duration_ms: 1.0841
  type: 'test'
  ...
# Subtest: card rejects unsafe origin javascript:alert(1)
ok 469 - card rejects unsafe origin javascript:alert(1)
  ---
  duration_ms: 0.1785
  type: 'test'
  ...
# Subtest: card rejects unsafe origin data:text/html,x
ok 470 - card rejects unsafe origin data:text/html,x
  ---
  duration_ms: 0.0837
  type: 'test'
  ...
# Subtest: card rejects unsafe origin file:///x
ok 471 - card rejects unsafe origin file:///x
  ---
  duration_ms: 0.0617
  type: 'test'
  ...
# Subtest: card rejects unsafe origin http://reporter.example.test
ok 472 - card rejects unsafe origin http://reporter.example.test
  ---
  duration_ms: 0.056
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://attacker.invalid
ok 473 - card rejects unsafe origin https://attacker.invalid
  ---
  duration_ms: 0.0506
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://[userinfo]@reporter.example.test
ok 474 - card rejects unsafe origin https://[userinfo]@reporter.example.test
  ---
  duration_ms: 0.0451
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://reporter.example.test/?grant=abc
ok 475 - card rejects unsafe origin https://reporter.example.test/?grant=abc
  ---
  duration_ms: 0.0483
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://reporter.example.test/\#x
ok 476 - card rejects unsafe origin https://reporter.example.test/\#x
  ---
  duration_ms: 0.0449
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://reporter.example.test/path
ok 477 - card rejects unsafe origin https://reporter.example.test/path
  ---
  duration_ms: 0.0378
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":0}
ok 478 - sender accepts only explicit numeric ACK {"errcode":0}
  ---
  duration_ms: 0.9457
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"body":{"errcode":0}}
ok 479 - sender accepts only explicit numeric ACK {"body":{"errcode":0}}
  ---
  duration_ms: 0.2966
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {}
ok 480 - sender accepts only explicit numeric ACK {}
  ---
  duration_ms: 0.247
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":"0"}
ok 481 - sender accepts only explicit numeric ACK {"errcode":"0"}
  ---
  duration_ms: 0.2089
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":null}
ok 482 - sender accepts only explicit numeric ACK {"errcode":null}
  ---
  duration_ms: 0.9436
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":40001}
ok 483 - sender accepts only explicit numeric ACK {"errcode":40001}
  ---
  duration_ms: 0.2542
  type: 'test'
  ...
# Subtest: sender fail-closed {"enabled":false}
ok 484 - sender fail-closed {"enabled":false}
  ---
  duration_ms: 0.1189
  type: 'test'
  ...
# Subtest: sender fail-closed {"cardEnabled":false}
ok 485 - sender fail-closed {"cardEnabled":false}
  ---
  duration_ms: 0.0638
  type: 'test'
  ...
# Subtest: sender fail-closed {"target":"not-allowlisted"}
ok 486 - sender fail-closed {"target":"not-allowlisted"}
  ---
  duration_ms: 0.1037
  type: 'test'
  ...
# Subtest: sender fail-closed {"binding":false}
ok 487 - sender fail-closed {"binding":false}
  ---
  duration_ms: 0.1523
  type: 'test'
  ...
# Subtest: gateway unavailable before network is retry-safe, no SDK call
ok 488 - gateway unavailable before network is retry-safe, no SDK call
  ---
  duration_ms: 0.3815
  type: 'test'
  ...
# Subtest: live inbound is clipped before persistence by approved bot, person and group hashes
ok 489 - live inbound is clipped before persistence by approved bot, person and group hashes
  ---
  duration_ms: 0.4562
  type: 'test'
  ...
# Subtest: Ticket delivery operator commands authorize before receipt, persist idempotence and never blindly retry UNKNOWN
ok 490 - Ticket delivery operator commands authorize before receipt, persist idempotence and never blindly retry UNKNOWN
  ---
  duration_ms: 2081.7926
  type: 'test'
  ...
# Subtest: P2-016 real-format group wakeup and direct description remain one Journey through public queries
ok 491 - P2-016 real-format group wakeup and direct description remain one Journey through public queries
  ---
  duration_ms: 2026.0397
  type: 'test'
  ...
# Subtest: P2-016 group-to-direct unique binding preserves Journey; ambiguous, consumed and expired candidates never guess
ok 492 - P2-016 group-to-direct unique binding preserves Journey; ambiguous, consumed and expired candidates never guess
  ---
  duration_ms: 7989.6584
  type: 'test'
  ...
# Subtest: P2-016 later same-group description preserves the recorded entry mode instead of rejecting the Journey
ok 493 - P2-016 later same-group description preserves the recorded entry mode instead of rejecting the Journey
  ---
  duration_ms: 1864.1525
  type: 'test'
  ...
# Subtest: P2-016 approved topology uses three real bounded processes, rule-first Worker and zero live SDK calls
ok 494 - P2-016 approved topology uses three real bounded processes, rule-first Worker and zero live SDK calls
  ---
  duration_ms: 4921.65
  type: 'test'
  ...
# {"process_count":3,"pool_max":7,"live_provider_calls":0,"rule_first_worker":true}
# Subtest: P2-016 live harness requires exact owner fuses and HTTPS bounded configuration, without logging secrets
ok 495 - P2-016 live harness requires exact owner fuses and HTTPS bounded configuration, without logging secrets
  ---
  duration_ms: 3.0131
  type: 'test'
  ...
# Subtest: P2-016 live requires an exact verified candidate and at least 15 minutes; cannot claim final completion
ok 496 - P2-016 live requires an exact verified candidate and at least 15 minutes; cannot claim final completion
  ---
  duration_ms: 0.4762
  type: 'test'
  ...
# Subtest: P2-016 live CLI with no approvals exits before DB, listener, Evidence or SDK work
ok 497 - P2-016 live CLI with no approvals exits before DB, listener, Evidence or SDK work
  ---
  duration_ms: 211.4189
  type: 'test'
  ...
# Subtest: P2-016 review resolution and Safe Action commit or roll back together
ok 498 - P2-016 review resolution and Safe Action commit or roll back together
  ---
  duration_ms: 1849.0131
  type: 'test'
  ...
# Subtest: P2-016 migration is atomic, check-only, exact, reentrant and drift-failing
    # Subtest: rejects table drift
    ok 1 - rejects table drift
      ---
      duration_ms: 36.4158
      type: 'test'
      ...
    # Subtest: rejects column drift
    ok 2 - rejects column drift
      ---
      duration_ms: 21.5292
      type: 'test'
      ...
    # Subtest: rejects type drift
    ok 3 - rejects type drift
      ---
      duration_ms: 32.8557
      type: 'test'
      ...
    # Subtest: rejects default drift
    ok 4 - rejects default drift
      ---
      duration_ms: 22.6751
      type: 'test'
      ...
    # Subtest: rejects constraint drift
    ok 5 - rejects constraint drift
      ---
      duration_ms: 21.8441
      type: 'test'
      ...
    # Subtest: rejects index drift
    ok 6 - rejects index drift
      ---
      duration_ms: 22.7279
      type: 'test'
      ...
    # Subtest: rejects foreign_key drift
    ok 7 - rejects foreign_key drift
      ---
      duration_ms: 23.7054
      type: 'test'
      ...
    1..7
ok 499 - P2-016 migration is atomic, check-only, exact, reentrant and drift-failing
  ---
  duration_ms: 2081.2448
  type: 'test'
  ...
# Subtest: P2-016 persisted card delivery, HMAC grants, one-use sessions and reporter-safe timeline
ok 500 - P2-016 persisted card delivery, HMAC grants, one-use sessions and reporter-safe timeline
  ---
  duration_ms: 2777.0255
  type: 'test'
  ...
# Subtest: P2-016 existing rule worker creates Ticket notifications, safe group/direct guidance and SYSTEM-only timeout closure
ok 501 - P2-016 existing rule worker creates Ticket notifications, safe group/direct guidance and SYSTEM-only timeout closure
  ---
  duration_ms: 2646.9941
  type: 'test'
  ...
# Subtest: Reporter browser 1440x900 real DB/session, fragment removal, refresh, timezone, safe data and logout
ok 502 - Reporter browser 1440x900 real DB/session, fragment removal, refresh, timezone, safe data and logout
  ---
  duration_ms: 5428.2215
  type: 'test'
  ...
# Subtest: Reporter browser 390x844 real DB/session, fragment removal, refresh, timezone, safe data and logout
ok 503 - Reporter browser 390x844 real DB/session, fragment removal, refresh, timezone, safe data and logout
  ---
  duration_ms: 4712.5473
  type: 'test'
  ...
# Subtest: Reporter grant expiry, HMAC rotation, one-consume concurrency, session expiry/revocation and cross-ticket isolation
ok 504 - Reporter grant expiry, HMAC rotation, one-consume concurrency, session expiry/revocation and cross-ticket isolation
  ---
  duration_ms: 2461.0485
  type: 'test'
  ...
# Subtest: P2-016 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
ok 505 - P2-016 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
  ---
  duration_ms: 5594.202
  type: 'test'
  ...
# {"server_commit_response_lost":true,"restart_replayed":true,"ticket_event_count":1,"unknown_recovery_send_calls":0,"authorized_retry_calls":1,"ack_restart_send_calls":0}
# Subtest: P2-016 architecture guards preserve authorization, immutable baselines and closed contracts
ok 506 - P2-016 architecture guards preserve authorization, immutable baselines and closed contracts
  ---
  duration_ms: 1950.8963
  type: 'test'
  ...
# Subtest: P2-016 default validator still requires readiness Evidence; deferred source checks cannot authorize live work
ok 507 - P2-016 default validator still requires readiness Evidence; deferred source checks cannot authorize live work
  ---
  duration_ms: 1844.5408
  type: 'test'
  ...
# Subtest: P2-016 schemas and declarations exist; Reporter outputs cannot contain internal identity or credentials
ok 508 - P2-016 schemas and declarations exist; Reporter outputs cannot contain internal identity or credentials
  ---
  duration_ms: 15.6369
  type: 'test'
  ...
# Subtest: JSON contract rejects extra keys, noncanonical types and offset time
ok 509 - JSON contract rejects extra keys, noncanonical types and offset time
  ---
  duration_ms: 5.1294
  type: 'test'
  ...
# Subtest: P2-016 closeout freezes every business input and the exact file set
ok 510 - P2-016 closeout freezes every business input and the exact file set
  ---
  duration_ms: 0.3373
  type: 'test'
  ...
# Subtest: P2-016 completion requires owner approval, precise candidates, live duration and zero-skip final regression
ok 511 - P2-016 completion requires owner approval, precise candidates, live duration and zero-skip final regression
  ---
  duration_ms: 0.5646
  type: 'test'
  ...
# Subtest: Real DB internal browser traverses every user lifecycle action, transfer and atomic takeover/accept
ok 512 - Real DB internal browser traverses every user lifecycle action, transfer and atomic takeover/accept
  ---
  duration_ms: 9592.7215
  type: 'test'
  ...
# Subtest: P2-016 Ticket lifecycle, command persistence, authorization and independent responsibility
ok 513 - P2-016 Ticket lifecycle, command persistence, authorization and independent responsibility
  ---
  duration_ms: 4494.5056
  type: 'test'
  ...
# Subtest: P2-016 native browser 1440x900 command, review, refresh, SSE, polling, XSS and auth-expiry
ok 514 - P2-016 native browser 1440x900 command, review, refresh, SSE, polling, XSS and auth-expiry
  ---
  duration_ms: 6927.742
  type: 'test'
  ...
# Subtest: P2-016 native browser 390x844 command, review, refresh, SSE, polling, XSS and auth-expiry
ok 515 - P2-016 native browser 390x844 command, review, refresh, SSE, polling, XSS and auth-expiry
  ---
  duration_ms: 6726.2975
  type: 'test'
  ...
# Subtest: confirmation survives realtime refetch and rejects a stale version instead of overwriting the form
ok 516 - confirmation survives realtime refetch and rejects a stale version instead of overwriting the form
  ---
  duration_ms: 1071.5804
  type: 'test'
  ...
# Subtest: P2-016 actual HTTP assembly: fail-closed flags, auth, CSRF, Ticket actions and durable SSE
ok 517 - P2-016 actual HTTP assembly: fail-closed flags, auth, CSRF, Ticket actions and durable SSE
  ---
  duration_ms: 2231.0287
  type: 'test'
  ...
# Subtest: P2-G1 system browser duplicate submit fence sends one human reply and preserves safe rendering
ok 518 - P2-G1 system browser duplicate submit fence sends one human reply and preserves safe rendering
  ---
  duration_ms: 1647.483
  type: 'test'
  ...
# {"browser":"C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe","viewport":{"width":390,"height":844},"replay_events":100,"realtime_list_calls":3,"duplicate_submit_calls":1,"polling_fallback":true,"xss_executed":false,"horizontal_overflow":false}
# Subtest: P2-G1 system browser preserves native SSE reconnect and sends Last-Event-ID
ok 519 - P2-G1 system browser preserves native SSE reconnect and sends Last-Event-ID
  ---
  duration_ms: 4517.6689
  type: 'test'
  ...
# {"sse_connections":2,"last_event_id_used":true,"polling_stopped_after_reconnect":true}
# Subtest: P2-G1 live browser sessions navigate to the actual Workbench route with isolated cookies
ok 520 - P2-G1 live browser sessions navigate to the actual Workbench route with isolated cookies
  ---
  duration_ms: 3752.4147
  type: 'test'
  ...
# {"browser_sessions":2,"workbench_route_requests":2,"isolated_cookie_headers":true,"root_not_requested":true,"safe_telemetry":true}
# Subtest: P2-G1 P1 commit, durable projection recovery, duplicate idempotency, participant isolation and catalog invariance
ok 521 - P2-G1 P1 commit, durable projection recovery, duplicate idempotency, participant isolation and catalog invariance
  ---
  duration_ms: 4817.6005
  type: 'test'
  ...
# {"tickets":3,"duplicate_ticket_delta":0,"duplicate_item_delta":0,"participant_sessions":3,"first_versions":[1,1],"next_versions":[2,2],"p1_survived_projection_failure":true,"recovery_backlog":0,"catalog_unchanged":true}
# Subtest: P2-G1 different Intake atomically ends the prior participant Session before opening the next
ok 522 - P2-G1 different Intake atomically ends the prior participant Session before opening the next
  ---
  duration_ms: 2435.6048
  type: 'test'
  ...
# {"different_intake_sessions":2,"prior_ended":1,"active_sessions":1,"active_versions":[1,1],"projection_failures":0}
# Subtest: P2-G1 fault paths serialize takeover, isolate internal note, deduplicate reply and recover delivery without blind resend
ok 523 - P2-G1 fault paths serialize takeover, isolate internal note, deduplicate reply and recover delivery without blind resend
  ---
  duration_ms: 2772.475
  type: 'test'
  ...
# {"concurrent_takeover_winners":1,"internal_note":{"message":1,"outbox":0,"delivery":0},"duplicate_reply_parallel":12,"reply":{"messages":1,"outboxes":1,"deliveries":1},"gateway_unavailable_pending":true,"reconnect_provider_calls":1,"unknown_reconciliation":true,"ai_calls":0,"ocr_calls":0}
# Subtest: P2-G1 local runtime binds one loopback App and reports human-only readiness with strict Test Auth
ok 524 - P2-G1 local runtime binds one loopback App and reports human-only readiness with strict Test Auth
  ---
  duration_ms: 2575.7725
  type: 'test'
  ...
# {"app_processes":1,"loopback_http":true,"readiness":true,"gateway_required":false,"active_gateway_count":0,"projection_batch":20,"communication_batch":20,"communication_sender":"MOCK","sse_client_cap":32,"dynamic_realtime_authorization":true,"test_auth_http_only":true,"human_only":true}
# Subtest: P2-G1 process cluster runs App, Worker and Gateway in three bounded Node processes
ok 525 - P2-G1 process cluster runs App, Worker and Gateway in three bounded Node processes
  ---
  duration_ms: 4296.1856
  type: 'test'
  ...
# {"process_count":3,"app_pool_max":4,"worker_pool_max":2,"gateway_pool_max":1,"combined_runtime":false,"raw_identifiers_recorded":false}
# Subtest: P2-G1 isolated PostgreSQL Replay Gap drives real Edge through Last-Event-ID, 410 and refetch
ok 526 - P2-G1 isolated PostgreSQL Replay Gap drives real Edge through Last-Event-ID, 410 and refetch
  ---
  duration_ms: 19130.0653
  type: 'test'
  ...
# {"http_status":410,"last_event_id":true,"refetch":["LIST","DETAIL","TIMELINE"],"process_count":3,"isolated_database_cleanup":true}
# Subtest: P2-G1 bounded capacity projects 1000 synthetic inbound facts and drains 500 deliveries with no catalog drift
ok 527 - P2-G1 bounded capacity projects 1000 synthetic inbound facts and drains 500 deliveries with no catalog drift
  ---
  duration_ms: 41955.5539
  type: 'test'
  ...
# {"synthetic_inbound":1000,"projected":1000,"delivery_backlog":500,"delivery_sent":500,"sender_calls":500,"projector_batch":20,"delivery_batch":20,"pool_max":4,"catalog_unchanged":true,"oom":0,"soak_24h":false}
# Subtest: live CLI exposes only the six explicit modes and requires three process fuses for sending
ok 528 - live CLI exposes only the six explicit modes and requires three process fuses for sending
  ---
  duration_ms: 1.3846
  type: 'test'
  ...
# Subtest: gateway process can commit inbound before the App process projects it
ok 529 - gateway process can commit inbound before the App process projects it
  ---
  duration_ms: 0.9895
  type: 'test'
  ...
# Subtest: process resource interface exposes bounded role metrics without a PID or environment
ok 530 - process resource interface exposes bounded role metrics without a PID or environment
  ---
  duration_ms: 0.7441
  type: 'test'
  ...
# Subtest: gateway permits one active WSClient, gates readiness on authentication, reconnects and shuts down cleanly
ok 531 - gateway permits one active WSClient, gates readiness on authentication, reconnects and shuts down cleanly
  ---
  duration_ms: 3.4779
  type: 'test'
  ...
# Subtest: sender enforces persistent target hash allowlist and maps ACK, explicit rejection, unknown and gateway-unavailable safely
ok 532 - sender enforces persistent target hash allowlist and maps ACK, explicit rejection, unknown and gateway-unavailable safely
  ---
  duration_ms: 1.0822
  type: 'test'
  ...
# Subtest: test authentication is server-configured, active non-reporter only, short-lived and emits strict HttpOnly cookie metadata
ok 533 - test authentication is server-configured, active non-reporter only, short-lived and emits strict HttpOnly cookie metadata
  ---
  duration_ms: 0.7186
  type: 'test'
  ...
# Subtest: test authentication isolates two configured principals with independent short-lived cookies and CSRF values
ok 534 - test authentication isolates two configured principals with independent short-lived cookies and CSRF values
  ---
  duration_ms: 0.601
  type: 'test'
  ...
# Subtest: live harness requires two distinct configured principals and creates a safe unique run id
ok 535 - live harness requires two distinct configured principals and creates a safe unique run id
  ---
  duration_ms: 0.278
  type: 'test'
  ...
# Subtest: disabled coordinator performs no database work and batch/stream inventory are bounded
ok 536 - disabled coordinator performs no database work and batch/stream inventory are bounded
  ---
  duration_ms: 0.2817
  type: 'test'
  ...
# Subtest: temporary database failure is isolated behind stable projection errors without raw details or false success
ok 537 - temporary database failure is isolated behind stable projection errors without raw details or false success
  ---
  duration_ms: 0.5493
  type: 'test'
  ...
# Subtest: P2-002 transaction hook is optional and P2-G1 browser source has an in-flight duplicate-submit fence
ok 538 - P2-002 transaction hook is optional and P2-G1 browser source has an in-flight duplicate-submit fence
  ---
  duration_ms: 2.8356
  type: 'test'
  ...
# Subtest: live script has no broad --live mode and no default live-send npm command
ok 539 - live script has no broad --live mode and no default live-send npm command
  ---
  duration_ms: 2.1573
  type: 'test'
  ...
# Subtest: shared pg factory preserves date/time/timestamp/timestamptz/tsrange/BIGINT strings and JSON objects
ok 540 - shared pg factory preserves date/time/timestamp/timestamptz/tsrange/BIGINT strings and JSON objects
  ---
  duration_ms: 41.8211
  type: 'test'
  ...
# Subtest: shared pg factory rejects Date recursively before sending SQL
ok 541 - shared pg factory rejects Date recursively before sending SQL
  ---
  duration_ms: 28.9385
  type: 'test'
  ...
# Subtest: LocalDate, LocalTime, and LocalDateTime accept real Asia/Shanghai calendar values
ok 542 - LocalDate, LocalTime, and LocalDateTime accept real Asia/Shanghai calendar values
  ---
  duration_ms: 0.7634
  type: 'test'
  ...
# Subtest: LocalDateTime rejects invalid dates, T/Z/UTC/offset/IANA, fractions, whitespace, and objects
ok 543 - LocalDateTime rejects invalid dates, T/Z/UTC/offset/IANA, fractions, whitespace, and objects
  ---
  duration_ms: 1.0561
  type: 'test'
  ...
# Subtest: PhysicalEpochMs remains a canonical non-negative decimal string and round-trips Shanghai local seconds
ok 544 - PhysicalEpochMs remains a canonical non-negative decimal string and round-trips Shanghai local seconds
  ---
  duration_ms: 0.5341
  type: 'test'
  ...
# Subtest: explicit Asia/Shanghai formatter is invariant under UTC, Tokyo, and New York process TZ
ok 545 - explicit Asia/Shanghai formatter is invariant under UTC, Tokyo, and New York process TZ
  ---
  duration_ms: 196.0467
  type: 'test'
  ...
# Subtest: V1.3 compatibility command delegates to active V1.4 validation
ok 546 - V1.3 compatibility command delegates to active V1.4 validation
  ---
  duration_ms: 85.6252
  type: 'test'
  ...
# Subtest: V1.4 architecture validator passes
ok 547 - V1.4 architecture validator passes
  ---
  duration_ms: 80.7571
  type: 'test'
  ...
# Subtest: P2/P2-G1 lifecycle state is internally consistent without changing P1
ok 548 - P2/P2-G1 lifecycle state is internally consistent without changing P1
  ---
  duration_ms: 3.9449
  type: 'test'
  ...
# Subtest: P2-004 independent authorization and stop line are preserved
ok 549 - P2-004 independent authorization and stop line are preserved
  ---
  duration_ms: 0.8015
  type: 'test'
  ...
# Subtest: P2-005 independent authorization and stop line are recorded
ok 550 - P2-005 independent authorization and stop line are recorded
  ---
  duration_ms: 0.7098
  type: 'test'
  ...
# Subtest: P2-006 independent authorization and stop line are recorded
ok 551 - P2-006 independent authorization and stop line are recorded
  ---
  duration_ms: 0.5857
  type: 'test'
  ...
# Subtest: P2-004 completion artifacts preserve P1 notification and Ticket ownership
ok 552 - P2-004 completion artifacts preserve P1 notification and Ticket ownership
  ---
  duration_ms: 1.9976
  type: 'test'
  ...
# Subtest: P2-005 completion artifacts preserve frozen Session and identity ownership
ok 553 - P2-005 completion artifacts preserve frozen Session and identity ownership
  ---
  duration_ms: 0.2912
  type: 'test'
  ...
# Subtest: P2-006 completion has a runnable workbench and no migration 022
ok 554 - P2-006 completion has a runnable workbench and no migration 022
  ---
  duration_ms: 0.7658
  type: 'test'
  ...
# Subtest: P2-001 and P2-002 frozen artifacts remain present
ok 555 - P2-001 and P2-002 frozen artifacts remain present
  ---
  duration_ms: 0.3536
  type: 'test'
  ...
# Subtest: P3 remains greenfield and contains no historical ticket program
ok 556 - P3 remains greenfield and contains no historical ticket program
  ---
  duration_ms: 1.3935
  type: 'test'
  ...
# Subtest: future flags default off without legacy import flags
ok 557 - future flags default off without legacy import flags
  ---
  duration_ms: 0.5005
  type: 'test'
  ...
# Subtest: conceptual schema has no historical migration fields or second ticket core
ok 558 - conceptual schema has no historical migration fields or second ticket core
  ---
  duration_ms: 0.354
  type: 'test'
  ...
# Subtest: new source example is non-authoritative
ok 559 - new source example is non-authoritative
  ---
  duration_ms: 0.6993
  type: 'test'
  ...
# Subtest: 2C4G limits remain conservative
ok 560 - 2C4G limits remain conservative
  ---
  duration_ms: 0.7621
  type: 'test'
  ...
# Subtest: P2-016 authorization reconciles only the historical P2-015 ledger
ok 561 - P2-016 authorization reconciles only the historical P2-015 ledger
  ---
  duration_ms: 2.2991
  type: 'test'
  ...
# Subtest: architecture validator rejects the historical P2-015 ledger drift
ok 562 - architecture validator rejects the historical P2-015 ledger drift
  ---
  duration_ms: 20.821
  type: 'test'
  ...
# Subtest: P2-012 authorization rejects premature completion and next-gate authorization
ok 563 - P2-012 authorization rejects premature completion and next-gate authorization
  ---
  duration_ms: 0.3745
  type: 'test'
  ...
1..563
# tests 570
# suites 0
# pass 570
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 672469.4451
````

</details>

<details>
<summary>首次 Targeted 失败 TAP（仅换行/行尾空白规范化）</summary>

````text
TAP version 13
# Subtest: P2-012 closes input shapes, rejects hostile values and preserves deterministic command hashes
ok 1 - P2-012 closes input shapes, rejects hostile values and preserves deterministic command hashes
  ---
  duration_ms: 4.5941
  type: 'test'
  ...
# Subtest: P2-012 stable HTTP matrix is exhaustive, deterministic and rejects hostile results without executing code
ok 2 - P2-012 stable HTTP matrix is exhaustive, deterministic and rejects hostile results without executing code
  ---
  duration_ms: 27.3996
  type: 'test'
  ...
# Subtest: P2-012 both parsed OpenAPI documents declare canonical subscription destinations and service failures
ok 3 - P2-012 both parsed OpenAPI documents declare canonical subscription destinations and service failures
  ---
  duration_ms: 645.226
  type: 'test'
  ...
# Subtest: P2-012 static authorization, frozen predecessors, scope, schemas and synthetic fixture gate
ok 4 - P2-012 static authorization, frozen predecessors, scope, schemas and synthetic fixture gate
  ---
  duration_ms: 2253.5444
  type: 'test'
  ...
# Subtest: P2-012 live runner fails before network/listener unless all five independent fuses and verified evidence exist
ok 5 - P2-012 live runner fails before network/listener unless all five independent fuses and verified evidence exist
  ---
  duration_ms: 0.9434
  type: 'test'
  ...
# Subtest: P2-012 readiness cannot be fabricated from partial regression, skips, changed inputs or live claims
ok 6 - P2-012 readiness cannot be fabricated from partial regression, skips, changed inputs or live claims
  ---
  duration_ms: 0.2455
  type: 'test'
  ...
# Subtest: P2-012 DONE requires the approved live candidate, client confirmation, clean Incident deliveries and complete regressions
ok 7 - P2-012 DONE requires the approved live candidate, client confirmation, clean Incident deliveries and complete regressions
  ---
  duration_ms: 0.2401
  type: 'test'
  ...
# Subtest: P2-012 frozen candidate permits only the explicit closeout governance set
ok 8 - P2-012 frozen candidate permits only the explicit closeout governance set
  ---
  duration_ms: 0.222
  type: 'test'
  ...
# Subtest: P2-012 review hardening preserves exact paths and requires independent current regression evidence
ok 9 - P2-012 review hardening preserves exact paths and requires independent current regression evidence
  ---
  duration_ms: 0.2634
  type: 'test'
  ...
# Subtest: P2-012 v2 HTTP OpenAPI hardening has an independent closed allowlist and complete regression gate
ok 10 - P2-012 v2 HTTP OpenAPI hardening has an independent closed allowlist and complete regression gate
  ---
  duration_ms: 0.3499
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 1440x900 human confirmation, refresh and accessibility
ok 11 - P2-012 database-backed browser 1440x900 human confirmation, refresh and accessibility
  ---
  duration_ms: 4236.2713
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 1366x768 human confirmation, refresh and accessibility
ok 12 - P2-012 database-backed browser 1366x768 human confirmation, refresh and accessibility
  ---
  duration_ms: 4099.3863
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 390x844 human confirmation, refresh and accessibility
not ok 13 - P2-012 database-backed browser 390x844 human confirmation, refresh and accessibility
  ---
  duration_ms: 3340.0213
  type: 'test'
  location: 'D:\\Projects\\Fault-Reporting-WeCom-Assistant\\tests\\p2-012-workbench-browser.test.mjs:9:63'
  failureType: 'testCodeFailure'
  error: 'Uncaught'
  code: 'ERR_TEST_FAILURE'
  stack: |-
    Object.evaluate (file:///D:/Projects/Fault-Reporting-WeCom-Assistant/tests/helpers/p2-006-browser-harness.mjs:77:40)
    async run (file:///D:/Projects/Fault-Reporting-WeCom-Assistant/tests/p2-012-workbench-browser.test.mjs:49:7)
    async withP2015IsolatedDatabase (file:///D:/Projects/Fault-Reporting-WeCom-Assistant/tests/helpers/p2-015-postgres-harness.mjs:33:14)
    async TestContext.<anonymous> (file:///D:/Projects/Fault-Reporting-WeCom-Assistant/tests/p2-012-workbench-browser.test.mjs:10:3)
    async Test.run (node:internal/test_runner/test:1332:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:911:7)
  ...
# Subtest: P2-012 actual HTTP inherits authentication, CSRF, command fence and durable realtime
ok 14 - P2-012 actual HTTP inherits authentication, CSRF, command fence and durable realtime
  ---
  duration_ms: 2316.5965
  type: 'test'
  ...
# Subtest: P2-012 actual HTTP preserves notification failure, rollback and durable replay before explicit recovery
ok 15 - P2-012 actual HTTP preserves notification failure, rollback and durable replay before explicit recovery
  ---
  duration_ms: 2435.2028
  type: 'test'
  ...
1..15
# tests 15
# suites 0
# pass 14
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 21597.8473
````

</details>

## 最终门禁与资源记录

P2-012 247 checks、P2-016 146 checks（历史验证 revision=30a394e85973f5a300b841b23d2c358998796ba6）、ARCH-006 260 checks、V1.4 403 checks，全部 exit=0；V1.4测试17/17。P2-012同时验证旧v1证据与独立v2证据，当前live_validation=NOT_RUN。

本轮保留 23 个非profile临时核验/TAP文件（tmp/p2012-http-openapi）及3张新截图；测试数据目录与浏览器profile已由既有harness清理。宿主其他Node进程保持原样，不属于本轮测试进程。

<details>
<summary>gate-p2-012.log</summary>

````text
{"task":"P2-012","state":"DONE","ok":true,"checks":247,"errors":[],"runtime_input_sha256":"b4019636255f66dc4367013de7b7175f7e9b0746f8af7042987543a13aa2b536","readiness_evidence_checked":false,"completion_evidence_checked":true,"review_evidence_checked":true,"live_validation":"NOT_RUN","historical_live_validation":"PASSED","second_commit_created":true,"review_fix_commit_created":true,"http_openapi_review_fix_commit_created":false}
````

</details>

<details>
<summary>gate-p2-016.log</summary>

````text
{"task":"P2-016","verification_revision":"30a394e85973f5a300b841b23d2c358998796ba6","successor_task":"P2-012","state":"DONE","ok":true,"checks":146,"errors":[],"runtime_input_sha256":"b3592280fd02bb68cd9b63720f6d6b8fae88b86c81597bb730a3f7367e0f3117","readiness_evidence_checked":false,"completion_evidence_checked":true}
````

</details>

<details>
<summary>gate-arch-006.log</summary>

````text
ARCH-006 rule-first service loop validation passed (260 checks).
````

</details>

<details>
<summary>gate-v1-4.log</summary>

````text

> fault-reporting-wecom-assistant@0.0.0-p1 validate:architecture:v1.4
> node scripts/validate-v1-4-architecture.mjs

V1.4 architecture validation passed (403 checks).
````

</details>

<details>
<summary>gate-v1-4-tests.log</summary>

````text

> fault-reporting-wecom-assistant@0.0.0-p1 test:architecture:v1.4
> node --test tests/v1-4-architecture-baseline.test.mjs

✔ V1.4 architecture validator passes (101.5957ms)
✔ P2/P2-G1 lifecycle state is internally consistent without changing P1 (4.9567ms)
✔ P2-004 independent authorization and stop line are preserved (1.7279ms)
✔ P2-005 independent authorization and stop line are recorded (1.4798ms)
✔ P2-006 independent authorization and stop line are recorded (1.0027ms)
✔ P2-004 completion artifacts preserve P1 notification and Ticket ownership (1.8816ms)
✔ P2-005 completion artifacts preserve frozen Session and identity ownership (0.3592ms)
✔ P2-006 completion has a runnable workbench and no migration 022 (0.7641ms)
✔ P2-001 and P2-002 frozen artifacts remain present (0.3774ms)
✔ P3 remains greenfield and contains no historical ticket program (1.7075ms)
✔ future flags default off without legacy import flags (0.5461ms)
✔ conceptual schema has no historical migration fields or second ticket core (0.4387ms)
✔ new source example is non-authoritative (0.7488ms)
✔ 2C4G limits remain conservative (0.687ms)
✔ P2-016 authorization reconciles only the historical P2-015 ledger (2.2437ms)
✔ architecture validator rejects the historical P2-015 ledger drift (24.613ms)
✔ P2-012 authorization rejects premature completion and next-gate authorization (0.4439ms)
ℹ tests 17
ℹ suites 0
ℹ pass 17
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 237.3163
````

</details>
