# P2-012 PR #6 Review hardening

- 日期：2026-09-07，Asia/Shanghai。
- 当前验证状态：PASS；完整串行回归与资源清理核验已完成，第三个提交按文末固定命令解析。
- 唯一范围：PERSON Direct Leg 授权、group-only Ticket 通知抑制、到期 Candidate 私有 SYSTEM maintenance。
- 授权来源：用户要求执行 `P2-012_PR6_P2_Review_Fixes_Codex_Prompt.md`，并在发现装配/门禁范围缺口后明确回复“授权”。补充范围为 `scripts/p2-012-process-role.mjs`、`src/p2-012-live-cluster.mjs`、P2-012 Validator/治理测试与 `tests/p2-012-scope-candidate.integration.test.mjs` 的最小修改。
- 开始门禁：分支 `phase2/p2-012-human-confirmed-incident`，工作树 clean；HEAD 与 fetched origin 分支均为 `044ce68dce5422b377d27cbbb432e78f94797478`，ahead/behind=0/0；origin/main=`30a394e85973f5a300b841b23d2c358998796ba6`；PR #6 OPEN、未合并。
- 历史为授权提交 `f8d29caf50816ab90f3debf14995085158460784`、第二个功能实现提交 `044ce68dce5422b377d27cbbb432e78f94797478`，本轮增加独立第三个提交 `fix(p2): require direct leg and expire due incident candidates`；不 amend/rebase，不写本提交自身 SHA。

## 输入、输出与数据库边界

输入为已持久化批准群消息、Intake/Journey/Channel Leg、Ticket Event 和 Candidate Review。输出为只读目的地资格判定、安全 suppression、群回执以及 SYSTEM expiration 的既有命令收据/追加事件/Realtime。没有数据库变更或新 Migration；001–032、Incident 状态机、P2-007 与 P2-015 规则/阈值保持原样。

`hasMatchingDirectLeg({reporter_user_id,bot_id,transaction})` 是只读 Port；通知 Projector 的可选 `personDestinationAuthorizer` 返回 boolean，默认 null 保留 P2-016 兼容行为。P2-012 App 与 Worker 均显式注入。查询使用当前业务事务，以便看到同事务中新建立的 Direct Leg；Gateway 在每次发送前再次独立查询。原始 target/userid/chatid、来源正文与 Leg 细节不返回给外部。

## 问题 1：Direct Leg 权威

根因：原 PERSON 授权把显式人员 hash 或批准群成员事实直接当作出站通道许可；Ticket Notification Projector 又在 Sender 检查之前创建 PERSON 通知和卡片能力，因而单独收紧 Sender 仍会留下可避免的 dead letter。

新规则为 A AND B：A 是显式人员 hash 或带标签的同 Bot 批准群成员事实；B 是真实 Direct Leg。第一条带标签的 single 入站仍只需 A，不形成“先有通道才能建立通道”的循环。GROUP hash allowlist 语义保持原样。

Direct Leg 查询条件：

```sql
FROM intake.channel_leg leg
JOIN intake.service_intake i ON i.id=leg.source_intake_id
JOIN intake.contact_journey journey ON journey.id=leg.journey_id
JOIN intake.service_intake origin ON origin.id=journey.origin_intake_id
WHERE leg.leg_type IN ('DIRECT_GUIDED','DIRECT_ORGANIC')
  AND i.source_provider='WECOM_AIBOT' AND i.source_bot_id=$1
  AND i.source_chat_type='single' AND i.reporter_wecom_userid=$2
  AND leg.reporter_identity_hash=journey.reporter_identity_hash
  AND origin.source_provider=i.source_provider AND origin.source_bot_id=i.source_bot_id
  AND origin.reporter_wecom_userid=i.reporter_wecom_userid
  AND journey.retention_until_epoch_ms>platform.physical_epoch_ms()
LIMIT 1
```

保留期内 OPEN/CLOSED Direct Leg 均可；没有使用时间接近、群 Leg、Ticket、Delivery 或 public ref 替代通道事实。数据库范围预检用相同条件匹配 Delivery target hash。

无资格时，Ticket Projector 在创建 PERSON Message/Outbox/Delivery/binding/public ref/grant 之前返回 `DIRECT_DESTINATION_NOT_ESTABLISHED`。group-origin TICKET_CREATED 仍创建一次 GROUP 安全回执，提示先在机器人单聊发送消息。已有 group-only 回执完成原事件，建立 Direct Leg 不补发该旧卡片；后续新事件可创建 PERSON 通知。本轮没有历史批量补发。

真实 PostgreSQL 覆盖：group-only 零 PERSON artifacts、一次群回执、显式人员无通道拒绝、DIRECT_ORGANIC 与保留的 CLOSED DIRECT_GUIDED 放行、错误 Bot/Reporter/Leg/Journey 绑定拒绝、同事务 Direct Leg 可见、故意构造越界 PERSON Delivery 预检失败及建立通道后通过。真实三进程网络关闭测试验证 Worker 建单和 App 人工操作均使用 suppression；Provider 替身验证无资格调用 0、有资格可进入 ACK 路径。

## 问题 2：Candidate maintenance

根因：原 `runOnce()` 只有导入与投影，没有到期扫描；对外命令又正确禁止 SYSTEM maintenance，导致到期候选停留在队列。

对外 commands 明确 `maintenanceEnabled=false`，私有 service 为 true 且只调用既有 `expireCandidate()`；不出现在 public return object、不进入 HTTP handler。底层 SYSTEM 仍只允许 EXPIRE_CANDIDATE。每轮顺序为导入、扫描、逐条命令、Realtime Projector：

```sql
SELECT id::text,row_version::text,expires_epoch_ms::text
FROM incident.candidate_review
WHERE status='CANDIDATE' AND expires_epoch_ms<=platform.physical_epoch_ms()
ORDER BY expires_epoch_ms,id LIMIT 20
```

每轮从 PostgreSQL 读取，不依赖内存 Timer；版本和 epoch 保持 string，不转 Number/Date。幂等身份为 SYSTEM scope 中的 Candidate UUID；action=EXPIRE_CANDIDATE、reason_code=MAINTENANCE_EXPIRED、expected_row_version 来自数据库。成功产生 EXPIRED、row_version+1、一个 SYSTEM candidate.expired Event、COMMITTED receipt，以及既有 Realtime 事件。

版本、状态、到期冲突发生后重新读取 Candidate：已离开 CANDIDATE 或尚未到期计为正常竞争；仍到期则抛出稳定 `P2_012_COMMAND_FAILED`。其他错误不吞掉。新增返回安全计数 imported/expired/expiration_replayed/expiration_race_lost/projected；processed 保持既有投影计数语义，不返回业务身份。

真实 PostgreSQL 测试覆盖 25 条按 20+5 分批与严格排序、重复扫描与并发维护重放、人工先提交/维护先提交、时间边界、仍到期冲突失败、导入事务内构造的同轮到期、未到期/UNDER_REVIEW/REJECTED/CONFIRMED 不改写、HTTP 无 expiration 路由、关闭 Feature Flag 零扫描。独立真实三进程重启保持一个过期 Event/Receipt，内部查询可重新获取 EXPIRED。过期操作的 Incident/Report/Subscription/Message/Outbox/Delivery 增量为 0。

## 验证记录

当前候选指纹：`fe83efee6b417f3c4a2add448f67c2826ba12a9ffb3075343beeb078e8c74e3d`。当前结果记录在完成报告 JSON 的独立 `pr_review_hardening` 中；历史 closeout_regression 和 live 字段不改写。

| 验证 | 结果 |
|---|---|
| Direct Leg / process assembly / Incident / subscription / restart 定向 | 15/15 PASS，exit=0 |
| P2-016 当前源码回归（含 text/markdown/template_card） | 71/71 PASS，exit=0 |
| P2-012 核心门禁（全量前） | 237 checks PASS，不据此声称当前完整回归完成 |
| P2-016 历史完成态门禁 | 146 checks PASS，verification_revision=30a394e85973f5a300b841b23d2c358998796ba6 |
| ARCH-006 | 260 checks PASS |
| V1.4 architecture | 403 checks PASS；17/17 tests PASS |
| 首轮完整串行回归 | 566 tests / 565 pass / 1 fail，exit=1 |
| 容量精确诊断复跑 | 1/1 PASS，exit=0；原代码/参数/超时/断言均未改动 |
| 最终完整串行回归 | 566/566 PASS，fail/cancelled/skipped/todo=0，exit=0，745329.1568 ms |

首轮唯一失败为原 `tests/p2-012-capacity.integration.test.mjs` 的堆回落断言，发生在数据规模、送达/SSE与 256 MiB 堆上限断言之后。原失败与诊断日志完整保留在下方。独立复跑实测 500 Candidates、200 Incidents、2000 Reports、1000 Subscriptions、5200 Events、550 bindings/550 模拟送达；堆峰值 68,707,912 bytes、结束 30,562,168 bytes。没有提高超时、删除断言、跳过测试或改用 GC 参数。最后一轮按相同输入重新执行整个串行回归通过，不以单测复跑替代全量结果。

完整命令：`node --env-file=.env.pilot --test --test-concurrency=1 --test-reporter=tap tests/*.test.mjs`。临时目录按进程隔离，防休眠仅在测试 shell 生存期设置并在 finally 恢复。

最终原始 TAP SHA-256：`c947f884790059fdaa9db90a2672ff1f73e2b67c4b408c88556fc49b0b2f8319`；下方只规范化换行和行尾空白后的 TAP SHA-256：`c947f884790059fdaa9db90a2672ff1f73e2b67c4b408c88556fc49b0b2f8319`。

门禁将原实现提交作为不可变历史输入，核对原完成态 canonical 指纹与历史现场/批准/回归。原 inventory 包含混合 CRLF/LF 的工作树字节 hash，因此只核验该历史 inventory 未被改写，不从 Git 的规范化内容伪造原始换行字节。当前改动另由精确路径清单和新指纹约束，迁移、规则、现场 JSONL 及负责人批准不在允许修改清单。

## 资源、回滚与停止线

无新增进程、Pool、Socket、Timer、依赖、Framework 或 Migration；maintenance 固定 batch 20。三业务角色保持 App/Worker/Gateway，连接池上限保持 4/2/1，外发并发与 SSE 限额不变。运行时开关关闭可停止 Incident maintenance；正式持久默认值全部 false。回退方式为独立回退第三个修复提交并保持相关运行开关关闭，不修改历史数据库事实或重放通知；本轮不实际执行回退。

P2-012 仍 DONE；P2-G2 NOT_STARTED，P2-008 TODO_BLOCKED_BY_P2_G2，AI/OCR/RAG calls=0、Incident auto-create=0、Ticket auto-link=0。第三个本地修复提交完成后停止，未 push/force-push/merge/tag/release，未 resolve review thread，未执行真实企业微信发送。新的出站限制需要在未来单独授权的 P2-G2 中验证真实客户端行为，旧 Provider ACK 不能证明本候选的现场表现。

范围限制：本次“零 PERSON artifacts”证据针对 Ticket Notification Projector。源码另显示 P2-016 既有 REQUEST_ONE_DESCRIPTION 通信分支独立生成群/私人引导，并非本轮获准修改的 Ticket 通知 seam；其在无 Direct Leg 时的生成策略属于 P2-G2 再验证项。本次统一 Sender 仍会拒绝无 Direct Leg 的 PERSON 发送；不把 Ticket 通知测试扩写为所有引导路径都不会生成 Delivery，也不擅自改变 P2-015/P2-016 引导行为。

## 最终清理与提交文件

测试数据库=0、backend=0、所属 Node 测试/角色进程=0、浏览器进程=0、监听=0、浏览器 profile=0。Pool 由 harness finally 关闭，角色与测试进程退出；因此没有本轮存活的 Pool/Timer/Socket。两轮全量均已退出。

浏览器测试重写的三张历史截图已逐字节恢复到原 PR HEAD；本轮两组截图另存于忽略的临时目录。历史 live JSONL、Provider ACK、批准和截图不进入修复差异。

自动审批审查拒绝递归删除本轮 `full-temp` 与 `final-temp`，只返回 `blocked by policy`，没有更细说明；未绕过该限制。两目录中的 356 个非 profile 文件仍保留。验证日志、六张本轮截图和小型核验脚本也保留在 `tmp/p2012-pr6-hardening-20260907-31f7/`。不声称临时文件系统全部清空。

仅以下 18 个文件进入修复提交：

```text
CHANGELOG.md
FILE_INDEX.md
MANIFEST.json
evidence/p2-012-human-confirmed-incident-report.json
evidence/p2-012-human-confirmed-incident-report.md
evidence/p2-012-pr-review-hardening.md
scripts/p2-012-process-role.mjs
scripts/validate-p2-012-human-confirmed-incident.mjs
src/p2-012-live-cluster.mjs
src/p2-012-live-reporter-scope.mjs
src/p2-012-workbench-assembly.mjs
src/p2-016-runtime.mjs
src/p2-016-ticket-notification-projector.mjs
tests/p2-012-incident.integration.test.mjs
tests/p2-012-live-dynamic-reporter-scope.test.mjs
tests/p2-012-process-assembly.integration.test.mjs
tests/p2-012-schema-live-guards.test.mjs
tests/p2-012-scope-candidate.integration.test.mjs
```

历史读取命令：`git log --format=fuller 30a394e85973f5a300b841b23d2c358998796ba6..HEAD`。最终工作树/提交数另由提交后 git 检查确认；不在本文件写入当前提交自身 SHA。

<details>
<summary>full-regression.tap — raw SHA-256 d4b1e06ebf921f5f3ee4c1541593894559b758611281812c1590d3a59629dcbf</summary>

````tap
TAP version 13
# Subtest: ARCH-005 architecture validator freezes migrations and reports all hard static counts at zero
ok 1 - ARCH-005 architecture validator freezes migrations and reports all hard static counts at zero
  ---
  duration_ms: 376.8829
  type: 'test'
  ...
# Subtest: P2-007 and its authorized P2-015 successor keep the frozen ARCH-005 contract
ok 2 - P2-007 and its authorized P2-015 successor keep the frozen ARCH-005 contract
  ---
  duration_ms: 5.2425
  type: 'test'
  ...
# Subtest: existing 001-021 database passes 022 check rollback, apply, forbidden-zero, and repeat no-op
ok 3 - existing 001-021 database passes 022 check rollback, apply, forbidden-zero, and repeat no-op
  ---
  duration_ms: 5490.8724
  type: 'test'
  ...
# Subtest: fresh database executes 001-021-022 through the current-baseline entrypoint
ok 4 - fresh database executes 001-021-022 through the current-baseline entrypoint
  ---
  duration_ms: 3300.3509
  type: 'test'
  ...
# Subtest: ARCH-006 validator passes
ok 5 - ARCH-006 validator passes
  ---
  duration_ms: 248.2699
  type: 'test'
  ...
# Subtest: machine state preserves ARCH-006 facts and separately authorized P2-015/P2-016 successor lifecycles
ok 6 - machine state preserves ARCH-006 facts and separately authorized P2-015/P2-016 successor lifecycles
  ---
  duration_ms: 1.4104
  type: 'test'
  ...
# Subtest: ten safe deterministic results are first-class and Manual Review is valid
ok 7 - ten safe deterministic results are first-class and Manual Review is valid
  ---
  duration_ms: 1.3855
  type: 'test'
  ...
# Subtest: Ticket lifecycle reuses authoritative actions and reliable notification boundary
ok 8 - Ticket lifecycle reuses authoritative actions and reliable notification boundary
  ---
  duration_ms: 1.3341
  type: 'test'
  ...
# Subtest: Incident remains human-confirmed and AI-independent
ok 9 - Incident remains human-confirmed and AI-independent
  ---
  duration_ms: 0.439
  type: 'test'
  ...
# Subtest: AI-off readiness and feature flags are closed by default
ok 10 - AI-off readiness and feature flags are closed by default
  ---
  duration_ms: 2.13
  type: 'test'
  ...
# Subtest: configuration preserves G0 boundaries and substitutes only the invalid test secret
ok 11 - configuration preserves G0 boundaries and substitutes only the invalid test secret
  ---
  duration_ms: 2.4326
  type: 'test'
  ...
# Subtest: redaction and error mapping do not expose a configured secret
ok 12 - redaction and error mapping do not expose a configured secret
  ---
  duration_ms: 0.7008
  type: 'test'
  ...
# Subtest: the connection stability window is bounded and explicit
ok 13 - the connection stability window is bounded and explicit
  ---
  duration_ms: 0.3229
  type: 'test'
  ...
# Subtest: authenticated probe starts shutdown by SIGTERM and calls disconnect before completion
ok 14 - authenticated probe starts shutdown by SIGTERM and calls disconnect before completion
  ---
  duration_ms: 4.286
  type: 'test'
  ...
# Subtest: text frame capture records only the permitted, desensitized shape
ok 15 - text frame capture records only the permitted, desensitized shape
  ---
  duration_ms: 3.1721
  type: 'test'
  ...
# Subtest: capture arguments require a named scenario and an evidence jsonl target
ok 16 - capture arguments require a named scenario and an evidence jsonl target
  ---
  duration_ms: 0.9123
  type: 'test'
  ...
# Subtest: media capture records only desensitized frame, download, and filename metadata
ok 17 - media capture records only desensitized frame, download, and filename metadata
  ---
  duration_ms: 5.6217
  type: 'test'
  ...
# Subtest: media capture arguments restrict scenarios, evidence output, and aes key modes
ok 18 - media capture arguments restrict scenarios, evidence output, and aes key modes
  ---
  duration_ms: 1.9354
  type: 'test'
  ...
# Subtest: voice capture retains only safe transcript metadata and does not download media
ok 19 - voice capture retains only safe transcript metadata and does not download media
  ---
  duration_ms: 0.6519
  type: 'test'
  ...
# Subtest: video capture reuses encrypted download evidence without exposing media references
ok 20 - video capture reuses encrypted download evidence without exposing media references
  ---
  duration_ms: 0.7127
  type: 'test'
  ...
# Subtest: download evidence maps decrypt failures and local deadline without leaking error details
ok 21 - download evidence maps decrypt failures and local deadline without leaking error details
  ---
  duration_ms: 5.0806
  type: 'test'
  ...
# Subtest: push arguments restrict scenario, timing, repeat and evidence output
ok 22 - push arguments restrict scenario, timing, repeat and evidence output
  ---
  duration_ms: 3.0686
  type: 'test'
  ...
# Subtest: direct push uses userid in memory but records only desensitized delivery evidence
ok 23 - direct push uses userid in memory but records only desensitized delivery evidence
  ---
  duration_ms: 4.0201
  type: 'test'
  ...
# Subtest: group mention mode is opt-in and invalid chatid rejection keeps SDK error text out of evidence
ok 24 - group mention mode is opt-in and invalid chatid rejection keeps SDK error text out of evidence
  ---
  duration_ms: 1.1743
  type: 'test'
  ...
# Subtest: group markdown-then-text mention probe sends two ordered bodies and treats only the text probe rejection as a valid result
ok 25 - group markdown-then-text mention probe sends two ordered bodies and treats only the text probe rejection as a valid result
  ---
  duration_ms: 0.8657
  type: 'test'
  ...
# Subtest: group mention arguments restrict timeout, trigger token and evidence output
ok 26 - group mention arguments restrict timeout, trigger token and evidence output
  ---
  duration_ms: 1.8454
  type: 'test'
  ...
# Subtest: group mention reply uses passive text syntax with the current callback sender
ok 27 - group mention reply uses passive text syntax with the current callback sender
  ---
  duration_ms: 1.1361
  type: 'test'
  ...
# Subtest: stream reply uses the same passive mention syntax in a finished SDK-supported stream body
ok 28 - stream reply uses the same passive mention syntax in a finished SDK-supported stream body
  ---
  duration_ms: 0.2427
  type: 'test'
  ...
# Subtest: acknowledged group reply reuses the triggering frame and records only hashes and field shape
ok 29 - acknowledged group reply reuses the triggering frame and records only hashes and field shape
  ---
  duration_ms: 2.993
  type: 'test'
  ...
# Subtest: probe ignores non-group and wrong-token messages before handling the matching group callback
ok 30 - probe ignores non-group and wrong-token messages before handling the matching group callback
  ---
  duration_ms: 1.2869
  type: 'test'
  ...
# Subtest: provider rejection is a completed negative capability result and excludes SDK error text
ok 31 - provider rejection is a completed negative capability result and excludes SDK error text
  ---
  duration_ms: 1.715
  type: 'test'
  ...
# Subtest: capture builder never serializes raw callback or reply values
ok 32 - capture builder never serializes raw callback or reply values
  ---
  duration_ms: 0.671
  type: 'test'
  ...
# Subtest: card arguments enforce local evidence, trigger chat type, and the five-second late boundary
ok 33 - card arguments enforce local evidence, trigger chat type, and the five-second late boundary
  ---
  duration_ms: 1.8709
  type: 'test'
  ...
# Subtest: card shape has a unique caller-owned task id and both required actions
ok 34 - card shape has a unique caller-owned task id and both required actions
  ---
  duration_ms: 1.23
  type: 'test'
  ...
# Subtest: fast button event updates the matching task id within five seconds without persisting raw input
ok 35 - fast button event updates the matching task id within five seconds without persisting raw input
  ---
  duration_ms: 7.3572
  type: 'test'
  ...
# Subtest: duplicate mode records the second same-user same-action callback and preserves buttons until then
ok 36 - duplicate mode records the second same-user same-action callback and preserves buttons until then
  ---
  duration_ms: 2.6406
  type: 'test'
  ...
# Subtest: late mode calls update after the limit and records a platform rejection as an explicit expired-behavior result
ok 37 - late mode calls update after the limit and records a platform rejection as an explicit expired-behavior result
  ---
  duration_ms: 1.4535
  type: 'test'
  ...
# Subtest: a task-id mismatch is safely recorded with field names and hashes but never updates a foreign card
ok 38 - a task-id mismatch is safely recorded with field names and hashes but never updates a foreign card
  ---
  duration_ms: 1.151
  type: 'test'
  ...
# Subtest: reply arguments only accept registered scenarios and evidence output paths
ok 39 - reply arguments only accept registered scenarios and evidence output paths
  ---
  duration_ms: 1.8457
  type: 'test'
  ...
# Subtest: welcome, Markdown, stream, and media builders use the documented reply forms
ok 40 - welcome, Markdown, stream, and media builders use the documented reply forms
  ---
  duration_ms: 3.6293
  type: 'test'
  ...
# Subtest: welcome replies accept an enter_chat event even when its chattype is omitted
ok 41 - welcome replies accept an enter_chat event even when its chattype is omitted
  ---
  duration_ms: 3.0259
  type: 'test'
  ...
# Subtest: stream refresh reuses one callback and stream id, then omits the body for matching feedback
ok 42 - stream refresh reuses one callback and stream id, then omits the body for matching feedback
  ---
  duration_ms: 7.3526
  type: 'test'
  ...
# Subtest: Markdown reply is callback-bound and never serializes trigger text or identifiers
ok 43 - Markdown reply is callback-bound and never serializes trigger text or identifiers
  ---
  duration_ms: 0.6987
  type: 'test'
  ...
# Subtest: file, image, and voice upload then reply through the callback-bound media interface
ok 44 - file, image, and voice upload then reply through the callback-bound media interface
  ---
  duration_ms: 1.8666
  type: 'test'
  ...
# Subtest: video echo downloads only in memory, reuploads with a safe filename, and replies with title and description
ok 45 - video echo downloads only in memory, reuploads with a safe filename, and replies with title and description
  ---
  duration_ms: 1.2307
  type: 'test'
  ...
# Subtest: provider rejection has a stable classification without recording provider error text
ok 46 - provider rejection has a stable classification without recording provider error text
  ---
  duration_ms: 0.5962
  type: 'test'
  ...
# Subtest: feedback empty-reply rejection is a completed negative capability result
ok 47 - feedback empty-reply rejection is a completed negative capability result
  ---
  duration_ms: 3.1824
  type: 'test'
  ...
# Subtest: G0-007 defaults to a 4 hour 30 minute Windows-native soak and keeps Phase boundaries
ok 48 - G0-007 defaults to a 4 hour 30 minute Windows-native soak and keeps Phase boundaries
  ---
  duration_ms: 2.1332
  type: 'test'
  ...
# Subtest: run id is opaque and deterministic under an injected clock
ok 49 - run id is opaque and deterministic under an injected clock
  ---
  duration_ms: 0.5191
  type: 'test'
  ...
# Subtest: reconnect recovery, resource samples, and message replay stay content-free
ok 50 - reconnect recovery, resource samples, and message replay stay content-free
  ---
  duration_ms: 3.1418
  type: 'test'
  ...
# Subtest: a completed requested soak does not satisfy the 4 hour 30 minute Gate duration when shortened
ok 51 - a completed requested soak does not satisfy the 4 hour 30 minute Gate duration when shortened
  ---
  duration_ms: 0.5773
  type: 'test'
  ...
# Subtest: G0-008 closure preserves completed Gate 0 and P1 facts independently of the moving P2 frontier
ok 52 - G0-008 closure preserves completed Gate 0 and P1 facts independently of the moving P2 frontier
  ---
  duration_ms: 7.1043
  type: 'test'
  ...
# Subtest: G0-008 report covers every completed Gate 0 evidence source and retains limits
ok 53 - G0-008 report covers every completed Gate 0 evidence source and retains limits
  ---
  duration_ms: 2.5962
  type: 'test'
  ...
# Subtest: the capability-freeze ADR is accepted and does not skip P1-001
ok 54 - the capability-freeze ADR is accepted and does not skip P1-001
  ---
  duration_ms: 3.5417
  type: 'test'
  ...
# Subtest: the documented 512 KiB plan covers 3,920,958 bytes in eight ordered chunks
ok 55 - the documented 512 KiB plan covers 3,920,958 bytes in eight ordered chunks
  ---
  duration_ms: 2.0051
  type: 'test'
  ...
# Subtest: test-only padding creates an exact target-sized MP4 without retaining an original filename
ok 56 - test-only padding creates an exact target-sized MP4 without retaining an original filename
  ---
  duration_ms: 0.9292
  type: 'test'
  ...
# Subtest: layered upload sends init, every serial chunk, and finish with fresh request IDs
ok 57 - layered upload sends init, every serial chunk, and finish with fresh request IDs
  ---
  duration_ms: 62.5264
  type: 'test'
  ...
# Subtest: a rejected chunk prevents finish and returns an explicit stage result
ok 58 - a rejected chunk prevents finish and returns an explicit stage result
  ---
  duration_ms: 5.4984
  type: 'test'
  ...
# Subtest: the probe downloads in memory, completes the layer sequence, then issues one callback-bound reply
ok 59 - the probe downloads in memory, completes the layer sequence, then issues one callback-bound reply
  ---
  duration_ms: 9.7667
  type: 'test'
  ...
# Subtest: arguments remain restricted to the G0 evidence directory and 10 MiB provider limit
ok 60 - arguments remain restricted to the G0 evidence directory and 10 MiB provider limit
  ---
  duration_ms: 0.4819
  type: 'test'
  ...
# Subtest: validates and redacts a Webhook URL without exposing its key
ok 61 - validates and redacts a Webhook URL without exposing its key
  ---
  duration_ms: 1.694
  type: 'test'
  ...
# Subtest: builds the documented text, markdown, media, news, and card payload forms
ok 62 - builds the documented text, markdown, media, news, and card payload forms
  ---
  duration_ms: 3.4617
  type: 'test'
  ...
# Subtest: creates bounded in-memory image, file, and AMR fixtures and documented multipart headers
ok 63 - creates bounded in-memory image, file, and AMR fixtures and documented multipart headers
  ---
  duration_ms: 1.3136
  type: 'test'
  ...
# Subtest: records only safe live-probe evidence when every provider reply is accepted
ok 64 - records only safe live-probe evidence when every provider reply is accepted
  ---
  duration_ms: 36.2008
  type: 'test'
  ...
# Subtest: P1 configuration accepts Pilot-only dependencies and produces a secret-free summary
ok 65 - P1 configuration accepts Pilot-only dependencies and produces a secret-free summary
  ---
  duration_ms: 2.637
  type: 'test'
  ...
# Subtest: P1 configuration rejects missing, cross-phase, and unapproved public-edge settings
ok 66 - P1 configuration rejects missing, cross-phase, and unapproved public-edge settings
  ---
  duration_ms: 1.1383
  type: 'test'
  ...
# Subtest: preflight output and CLI options do not expose configuration secrets
ok 67 - preflight output and CLI options do not expose configuration secrets
  ---
  duration_ms: 0.6769
  type: 'test'
  ...
# Subtest: the Pilot foundation health endpoint starts and stops without business routes
ok 68 - the Pilot foundation health endpoint starts and stops without business routes
  ---
  duration_ms: 69.9146
  type: 'test'
  ...
# Subtest: text Frame becomes an SDK-independent normalized message
ok 69 - text Frame becomes an SDK-independent normalized message
  ---
  duration_ms: 5.2388
  type: 'test'
  ...
# Subtest: image Frame exposes only an opaque media download reference
ok 70 - image Frame exposes only an opaque media download reference
  ---
  duration_ms: 1.8214
  type: 'test'
  ...
# Subtest: mixed Frame preserves text and image ordering in one normalized message
ok 71 - mixed Frame preserves text and image ordering in one normalized message
  ---
  duration_ms: 0.9794
  type: 'test'
  ...
# Subtest: replayed Frame keeps one durable idempotency key without Adapter-side dropping
ok 72 - replayed Frame keeps one durable idempotency key without Adapter-side dropping
  ---
  duration_ms: 0.5672
  type: 'test'
  ...
# Subtest: illegal Frame returns a stable, non-retryable and secret-free error
ok 73 - illegal Frame returns a stable, non-retryable and secret-free error
  ---
  duration_ms: 0.3492
  type: 'test'
  ...
# Subtest: invalid Adapter receive time returns a stable error instead of throwing
ok 74 - invalid Adapter receive time returns a stable error instead of throwing
  ---
  duration_ms: 0.3768
  type: 'test'
  ...
# Subtest: text that exceeds the contract only after normalization fails closed
ok 75 - text that exceeds the contract only after normalization fails closed
  ---
  duration_ms: 1.6334
  type: 'test'
  ...
# Subtest: text incompatible with the Phase 1 PostgreSQL boundary fails closed
ok 76 - text incompatible with the Phase 1 PostgreSQL boundary fails closed
  ---
  duration_ms: 0.5039
  type: 'test'
  ...
# Subtest: non-message callback bodies are classified as unsupported before message-only fields
ok 77 - non-message callback bodies are classified as unsupported before message-only fields
  ---
  duration_ms: 0.3604
  type: 'test'
  ...
# Subtest: Frame envelope, identity and content validation use stable reasons
ok 78 - Frame envelope, identity and content validation use stable reasons
  ---
  duration_ms: 1.2419
  type: 'test'
  ...
# Subtest: Normalized Message JSON Schema matches the Adapter interface and excludes SDK secrets
ok 79 - Normalized Message JSON Schema matches the Adapter interface and excludes SDK secrets
  ---
  duration_ms: 3.3823
  type: 'test'
  ...
# Subtest: quoted text from the recorded Gate 0 shape is preserved without raw SDK fields
ok 80 - quoted text from the recorded Gate 0 shape is preserved without raw SDK fields
  ---
  duration_ms: 0.5888
  type: 'test'
  ...
# Subtest: Gate 0 verified file, voice and video Frames use the same normalized seam
ok 81 - Gate 0 verified file, voice and video Frames use the same normalized seam
  ---
  duration_ms: 0.8433
  type: 'test'
  ...
# Subtest: quoted media keeps an independent opaque reference
ok 82 - quoted media keeps an independent opaque reference
  ---
  duration_ms: 0.4816
  type: 'test'
  ...
# Subtest: persists one Channel Message and returns the original result on replay
ok 83 - persists one Channel Message and returns the original result on replay
  ---
  duration_ms: 379.6967
  type: 'test'
  ...
# Subtest: snapshots validated input before connection acquisition
ok 84 - snapshots validated input before connection acquisition
  ---
  duration_ms: 10.6211
  type: 'test'
  ...
# Subtest: concurrent duplicates execute first processing exactly once
ok 85 - concurrent duplicates execute first processing exactly once
  ---
  duration_ms: 194.8981
  type: 'test'
  ...
# Subtest: first-processing failure rolls back the Inbox row and permits a clean retry
ok 86 - first-processing failure rolls back the Inbox row and permits a clean retry
  ---
  duration_ms: 26.8724
  type: 'test'
  ...
# Subtest: non-plain processing result roots fail as processing errors
ok 87 - non-plain processing result roots fail as processing errors
  ---
  duration_ms: 31.8778
  type: 'test'
  ...
# Subtest: processing result snapshot rejects nested non-JSON runtime objects
ok 88 - processing result snapshot rejects nested non-JSON runtime objects
  ---
  duration_ms: 10.4942
  type: 'test'
  ...
# Subtest: processing result validation never executes toJSON hooks
ok 89 - processing result validation never executes toJSON hooks
  ---
  duration_ms: 9.0705
  type: 'test'
  ...
# Subtest: processing result validation rejects Proxy toJSON substitution without executing it
ok 90 - processing result validation rejects Proxy toJSON substitution without executing it
  ---
  duration_ms: 8.5164
  type: 'test'
  ...
# Subtest: inherited toJSON pollution cannot transform an otherwise plain result
ok 91 - inherited toJSON pollution cannot transform an otherwise plain result
  ---
  duration_ms: 11.0449
  type: 'test'
  ...
# Subtest: processing result snapshot accepts nested plain JSON arrays
ok 92 - processing result snapshot accepts nested plain JSON arrays
  ---
  duration_ms: 12.2432
  type: 'test'
  ...
# Subtest: first-processing callback cannot commit the Inbox transaction early
ok 93 - first-processing callback cannot commit the Inbox transaction early
  ---
  duration_ms: 9.5968
  type: 'test'
  ...
# Subtest: first-processing callback cannot change Inbox transaction characteristics
ok 94 - first-processing callback cannot change Inbox transaction characteristics
  ---
  duration_ms: 10.4225
  type: 'test'
  ...
# Subtest: comment-obfuscated transaction control remains blocked
ok 95 - comment-obfuscated transaction control remains blocked
  ---
  duration_ms: 9.6816
  type: 'test'
  ...
# Subtest: SET LOCAL cannot change the Inbox-owned transaction
ok 96 - SET LOCAL cannot change the Inbox-owned transaction
  ---
  duration_ms: 10.153
  type: 'test'
  ...
# Subtest: session defaults cannot poison a pooled connection after Inbox commit
ok 97 - session defaults cannot poison a pooled connection after Inbox commit
  ---
  duration_ms: 104.5452
  type: 'test'
  ...
# Subtest: function-based session configuration is rejected before pooled connection reuse
ok 98 - function-based session configuration is rejected before pooled connection reuse
  ---
  duration_ms: 114.6665
  type: 'test'
  ...
# Subtest: ordinary Inbox use preserves caller-owned pool session baselines
ok 99 - ordinary Inbox use preserves caller-owned pool session baselines
  ---
  duration_ms: 113.3501
  type: 'test'
  ...
# Subtest: callback-style transaction queries are rejected before PostgreSQL execution
ok 100 - callback-style transaction queries are rejected before PostgreSQL execution
  ---
  duration_ms: 9.9948
  type: 'test'
  ...
# Subtest: unawaited transaction query failure remains a processing failure
ok 101 - unawaited transaction query failure remains a processing failure
  ---
  duration_ms: 11.3272
  type: 'test'
  ...
# Subtest: transaction view is revoked when first processing settles
ok 102 - transaction view is revoked when first processing settles
  ---
  duration_ms: 9.8248
  type: 'test'
  ...
# Subtest: a duplicate after a real process restart receives the committed result
ok 103 - a duplicate after a real process restart receives the committed result
  ---
  duration_ms: 800.2124
  type: 'test'
  ...
# Subtest: temporary database unavailability returns a stable retryable error without processing
ok 104 - temporary database unavailability returns a stable retryable error without processing
  ---
  duration_ms: 3.8955
  type: 'test'
  ...
# Subtest: invalid privacy, retention, plaintext payload and non-contract message fields fail before database access
ok 105 - invalid privacy, retention, plaintext payload and non-contract message fields fail before database access
  ---
  duration_ms: 2.1346
  type: 'test'
  ...
# Subtest: privacy, retention and caller-encrypted raw payload are persisted without entering the result
ok 106 - privacy, retention and caller-encrypted raw payload are persisted without entering the result
  ---
  duration_ms: 12.0446
  type: 'test'
  ...
# Subtest: migration fails closed when an existing Inbox lacks required constraints
ok 107 - migration fails closed when an existing Inbox lacks required constraints
  ---
  duration_ms: 717.7472
  type: 'test'
  ...
# Subtest: migration reports the stable drift error before indexing a table with missing columns
ok 108 - migration reports the stable drift error before indexing a table with missing columns
  ---
  duration_ms: 604.0455
  type: 'test'
  ...
# Subtest: migration rejects a weakened check constraint that keeps the expected name
ok 109 - migration rejects a weakened check constraint that keeps the expected name
  ---
  duration_ms: 895.7003
  type: 'test'
  ...
# Subtest: migration rejects a deferrable idempotency constraint unusable by ON CONFLICT
ok 110 - migration rejects a deferrable idempotency constraint unusable by ON CONFLICT
  ---
  duration_ms: 1007.7161
  type: 'test'
  ...
# Subtest: migration rejects a deferrable primary key unusable by later foreign keys
ok 111 - migration rejects a deferrable primary key unusable by later foreign keys
  ---
  duration_ms: 1009.9349
  type: 'test'
  ...
# Subtest: migration rejects a same-name hash index that cannot serve retention range scans
ok 112 - migration rejects a same-name hash index that cannot serve retention range scans
  ---
  duration_ms: 825.2469
  type: 'test'
  ...
# Subtest: migration rejects an extra check constraint outside the frozen set
ok 113 - migration rejects an extra check constraint outside the frozen set
  ---
  duration_ms: 879.2472
  type: 'test'
  ...
# Subtest: migration rejects an extra unique constraint that changes write semantics
ok 114 - migration rejects an extra unique constraint that changes write semantics
  ---
  duration_ms: 930.2538
  type: 'test'
  ...
# Subtest: migration rejects a generated column that breaks explicit Inbox writes
ok 115 - migration rejects a generated column that breaks explicit Inbox writes
  ---
  duration_ms: 948.1543
  type: 'test'
  ...
# Subtest: migration is reentrant when the existing Inbox matches the frozen catalog
ok 116 - migration is reentrant when the existing Inbox matches the frozen catalog
  ---
  duration_ms: 788.5313
  type: 'test'
  ...
# Subtest: migration is limited to the P1-003 Channel Inbox and freezes the database constraints
ok 117 - migration is limited to the P1-003 Channel Inbox and freezes the database constraints
  ---
  duration_ms: 1.2178
  type: 'test'
  ...
# Subtest: creates one Service Intake, primary message relation and received audit event
ok 118 - creates one Service Intake, primary message relation and received audit event
  ---
  duration_ms: 366.0856
  type: 'test'
  ...
# Subtest: aggregates multiple supplements into one Intake without creating a Ticket
ok 119 - aggregates multiple supplements into one Intake without creating a Ticket
  ---
  duration_ms: 64.9981
  type: 'test'
  ...
# Subtest: explicit new-report intent starts a new Intake inside the 90-second window
ok 120 - explicit new-report intent starts a new Intake inside the 90-second window
  ---
  duration_ms: 28.63
  type: 'test'
  ...
# Subtest: an explicit reference to another ticket closes the current aggregation window
ok 121 - an explicit reference to another ticket closes the current aggregation window
  ---
  duration_ms: 60.1875
  type: 'test'
  ...
# Subtest: pure image creates a waiting Intake and emits a clarification audit event
ok 122 - pure image creates a waiting Intake and emits a clarification audit event
  ---
  duration_ms: 28.9384
  type: 'test'
  ...
# Subtest: a description clarifies the waiting image Intake instead of creating another Intake
ok 123 - a description clarifies the waiting image Intake instead of creating another Intake
  ---
  duration_ms: 53.5531
  type: 'test'
  ...
# Subtest: concurrent distinct messages in one context aggregate into exactly one Intake
ok 124 - concurrent distinct messages in one context aggregate into exactly one Intake
  ---
  duration_ms: 450.8753
  type: 'test'
  ...
# Subtest: reversed lock acquisition still aggregates bounded timestamp inversion and preserves valid update time
ok 125 - reversed lock acquisition still aggregates bounded timestamp inversion and preserves valid update time
  ---
  duration_ms: 47.1213
  type: 'test'
  ...
# Subtest: reversed lock acquisition never crosses an explicit new-context boundary
ok 126 - reversed lock acquisition never crosses an explicit new-context boundary
  ---
  duration_ms: 133.3331
  type: 'test'
  ...
# Subtest: classifies the documented request types without AI and honors incident negation
ok 127 - classifies the documented request types without AI and honors incident negation
  ---
  duration_ms: 186.6934
  type: 'test'
  ...
# Subtest: standalone thanks is CHATTER without an unnecessary clarification request
ok 128 - standalone thanks is CHATTER without an unnecessary clarification request
  ---
  duration_ms: 15.1191
  type: 'test'
  ...
# Subtest: aggregate privacy is strongest, retention is earliest, and Inbox snapshots contain no report summary
ok 129 - aggregate privacy is strongest, retention is earliest, and Inbox snapshots contain no report summary
  ---
  duration_ms: 30.4598
  type: 'test'
  ...
# Subtest: includes exactly 90 seconds and starts a new Intake after the window
ok 130 - includes exactly 90 seconds and starts a new Intake after the window
  ---
  duration_ms: 54.3915
  type: 'test'
  ...
# Subtest: different senders and conversations stay separate while direct chat maps to WECOM_DIRECT
ok 131 - different senders and conversations stay separate while direct chat maps to WECOM_DIRECT
  ---
  duration_ms: 38.0615
  type: 'test'
  ...
# Subtest: Channel Message replay returns the original Intake result without duplicate relations or events
ok 132 - Channel Message replay returns the original Intake result without duplicate relations or events
  ---
  duration_ms: 18.8834
  type: 'test'
  ...
# Subtest: downstream failure rolls back Channel Message, Intake, relations and events before a clean retry
ok 133 - downstream failure rolls back Channel Message, Intake, relations and events before a clean retry
  ---
  duration_ms: 27.3304
  type: 'test'
  ...
# Subtest: migration fails closed on legacy Inbox summaries and upgrades pre-redacted aggregates
ok 134 - migration fails closed on legacy Inbox summaries and upgrades pre-redacted aggregates
  ---
  duration_ms: 384.4724
  type: 'test'
  ...
# Subtest: migration runner exposes only the exact legacy-remediation failure as non-retryable
ok 135 - migration runner exposes only the exact legacy-remediation failure as non-retryable
  ---
  duration_ms: 0.475
  type: 'test'
  ...
# Subtest: migration is limited to Service Intake, message relations and Intake audit events
ok 136 - migration is limited to Service Intake, message relations and Intake audit events
  ---
  duration_ms: 2.1794
  type: 'test'
  ...
# Subtest: Service Intake JSON Schema freezes the domain boundary and P1-004 version semantics
ok 137 - Service Intake JSON Schema freezes the domain boundary and P1-004 version semantics
  ---
  duration_ms: 1.5906
  type: 'test'
  ...
# Subtest: Service Intake migration is re-entrant
ok 138 - Service Intake migration is re-entrant
  ---
  duration_ms: 7.935
  type: 'test'
  ...
# Subtest: invalid aggregation windows fail before a processor can access a transaction
ok 139 - invalid aggregation windows fail before a processor can access a transaction
  ---
  duration_ms: 0.5283
  type: 'test'
  ...
# Subtest: an explicit report creates one idempotent Pilot Ticket without AI or Hospital Tickets
ok 140 - an explicit report creates one idempotent Pilot Ticket without AI or Hospital Tickets
  ---
  duration_ms: 253.371
  type: 'test'
  ...
# Subtest: a downstream failure rolls back the Intake-to-Ticket relationship before retry
ok 141 - a downstream failure rolls back the Intake-to-Ticket relationship before retry
  ---
  duration_ms: 54.3311
  type: 'test'
  ...
# Subtest: a Ticket number collision fails explicitly and leaves the second Intake unlinked
ok 142 - a Ticket number collision fails explicitly and leaves the second Intake unlinked
  ---
  duration_ms: 63.4741
  type: 'test'
  ...
# Subtest: the database rejects a Ticket when its source Intake does not point back to it
ok 143 - the database rejects a Ticket when its source Intake does not point back to it
  ---
  duration_ms: 29.4441
  type: 'test'
  ...
# Subtest: explicit Ticket Actions enforce legal transitions, versions, and an ordered audit timeline
ok 144 - explicit Ticket Actions enforce legal transitions, versions, and an ordered audit timeline
  ---
  duration_ms: 273.3234
  type: 'test'
  ...
# Subtest: concurrent handlers cannot both accept the same queued Ticket
ok 145 - concurrent handlers cannot both accept the same queued Ticket
  ---
  duration_ms: 108.4489
  type: 'test'
  ...
# Subtest: Phase 1 rejects an Incident-link action until the Phase 2 Incident fact exists
ok 146 - Phase 1 rejects an Incident-link action until the Phase 2 Incident fact exists
  ---
  duration_ms: 95.7913
  type: 'test'
  ...
# Subtest: state, Ticket Event, Outbox, and target deliveries commit together while delivery failures retry independently
ok 147 - state, Ticket Event, Outbox, and target deliveries commit together while delivery failures retry independently
  ---
  duration_ms: 516.0504
  type: 'test'
  ...
# Subtest: a leased Delivery is not sent twice by concurrent Workers and terminal failures become dead letters
ok 148 - a leased Delivery is not sent twice by concurrent Workers and terminal failures become dead letters
  ---
  duration_ms: 178.548
  type: 'test'
  ...
# Subtest: an Outbox failure rolls back the Ticket state and its Ticket Event
ok 149 - an Outbox failure rolls back the Ticket state and its Ticket Event
  ---
  duration_ms: 46.4889
  type: 'test'
  ...
# Subtest: the default notification matrix keeps internal notes off reporter delivery and the Worker rate-limits each target
ok 150 - the default notification matrix keeps internal notes off reporter delivery and the Worker rate-limits each target
  ---
  duration_ms: 228.2457
  type: 'test'
  ...
# Subtest: first acknowledgement is sent only after commit and a reconnect replay does not create or send twice
ok 151 - first acknowledgement is sent only after commit and a reconnect replay does not create or send twice
  ---
  duration_ms: 237.7023
  type: 'test'
  ...
# Subtest: temporary delivery failure preserves a real Ticket for retry, while a non-report never fabricates a Ticket number
ok 152 - temporary delivery failure preserves a real Ticket for retry, while a non-report never fabricates a Ticket number
  ---
  duration_ms: 78.4365
  type: 'test'
  ...
# Subtest: Pilot roles isolate teams, enable audited handling, and keep internal notes out of reporter views
ok 153 - Pilot roles isolate teams, enable audited handling, and keep internal notes out of reporter views
  ---
  duration_ms: 388.7263
  type: 'test'
  ...
# Subtest: the minimum local Pilot workbench exposes an injected authenticated mobile-friendly work view
ok 154 - the minimum local Pilot workbench exposes an injected authenticated mobile-friendly work view
  ---
  duration_ms: 114.611
  type: 'test'
  ...
# Subtest: supplement, card confirmation, duplicate card protection, close, and reopen preserve a real Ticket lifecycle
ok 155 - supplement, card confirmation, duplicate card protection, close, and reopen preserve a real Ticket lifecycle
  ---
  duration_ms: 502.6182
  type: 'test'
  ...
# Subtest: the complete lifecycle processor exposes created delivery ids for post-commit acknowledgement
ok 156 - the complete lifecycle processor exposes created delivery ids for post-commit acknowledgement
  ---
  duration_ms: 46.1589
  type: 'test'
  ...
# Subtest: expired cards do not mutate Tickets and resolved Tickets close automatically with an explicit non-user reason
ok 157 - expired cards do not mutate Tickets and resolved Tickets close automatically with an explicit non-user reason
  ---
  duration_ms: 105.1582
  type: 'test'
  ...
# Subtest: P1-011 parses only explicit backup drill modes and keeps credentials out of utility arguments
ok 158 - P1-011 parses only explicit backup drill modes and keeps credentials out of utility arguments
  ---
  duration_ms: 4.2913
  type: 'test'
  ...
# Subtest: P1-011 backup check validates controls without writing credential or encryption-key values
ok 159 - P1-011 backup check validates controls without writing credential or encryption-key values
  ---
  duration_ms: 209.9633
  type: 'test'
  ...
# Subtest: P1-011 emits a fixed restore alert and failure context when a drill cannot start
ok 160 - P1-011 emits a fixed restore alert and failure context when a drill cannot start
  ---
  duration_ms: 22.4317
  type: 'test'
  ...
# Subtest: P1-011 keeps a logical backup encrypted at rest while restoring the exact stream
ok 161 - P1-011 keeps a logical backup encrypted at rest while restoring the exact stream
  ---
  duration_ms: 30.7989
  type: 'test'
  ...
# Subtest: P1-011 authenticates an encrypted artifact before exposing any plaintext to the restore consumer
ok 162 - P1-011 authenticates an encrypted artifact before exposing any plaintext to the restore consumer
  ---
  duration_ms: 15.568
  type: 'test'
  ...
# Subtest: P1-011 writes only a redacted, structured operational log record
ok 163 - P1-011 writes only a redacted, structured operational log record
  ---
  duration_ms: 81.1707
  type: 'test'
  ...
# Subtest: P1-011 keeps a persisted core intake available when optional dependencies fail
ok 164 - P1-011 keeps a persisted core intake available when optional dependencies fail
  ---
  duration_ms: 4.5704
  type: 'test'
  ...
# Subtest: P1-011 composes the operational boundary around the real Inbox to Pilot Ticket lifecycle
ok 165 - P1-011 composes the operational boundary around the real Inbox to Pilot Ticket lifecycle
  ---
  duration_ms: 154.5582
  type: 'test'
  ...
# Subtest: P1-011 alerts with stable codes without carrying the rejected sensitive values
ok 166 - P1-011 alerts with stable codes without carrying the rejected sensitive values
  ---
  duration_ms: 0.9509
  type: 'test'
  ...
# Subtest: P1-011 serves the Pilot workbench under a same-origin CSP without inline code
ok 167 - P1-011 serves the Pilot workbench under a same-origin CSP without inline code
  ---
  duration_ms: 41.5886
  type: 'test'
  ...
# Subtest: P1-011 preserves safe backup and restore checkpoints in an admin-only immutable audit trail
ok 168 - P1-011 preserves safe backup and restore checkpoints in an admin-only immutable audit trail
  ---
  duration_ms: 87.5007
  type: 'test'
  ...
# Subtest: P1-012 accepts only an explicit check or approved live scenario
ok 169 - P1-012 accepts only an explicit check or approved live scenario
  ---
  duration_ms: 4.0388
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"dbd732f5335b972fcdd42bca1f325a9a","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING"}}
# Subtest: P1-012 recovers only an explicitly approved, stale, terminated-local reply-probe evidence claim and audits it
ok 170 - P1-012 recovers only an explicitly approved, stale, terminated-local reply-probe evidence claim and audits it
  ---
  duration_ms: 32.5742
  type: 'test'
  ...
# Subtest: P1-012 restores the stale claim and releases the recovery guard if its recovery audit cannot append
ok 171 - P1-012 restores the stale claim and releases the recovery guard if its recovery audit cannot append
  ---
  duration_ms: 14.2485
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
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"69ef30b271d93fc7cccd0c91fb35550b","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING","resumed":true}}
# Subtest: P1-012 retains a truthful quarantine audit and blocks replies when quarantine cleanup fails, then resumes safely
ok 172 - P1-012 retains a truthful quarantine audit and blocks replies when quarantine cleanup fails, then resumes safely
  ---
  duration_ms: 37.3999
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
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"1a1a6fef912a6bdf09021f3d5dfd2abf","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING"}}
# Subtest: P1-012 atomically takes over a stale recovery guard while a live reply and second recovery remain blocked
ok 173 - P1-012 atomically takes over a stale recovery guard while a live reply and second recovery remain blocked
  ---
  duration_ms: 29.7769
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
  duration_ms: 20.0469
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
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"142c31d3f48477106cbdf2bfc438b744","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING"}}
# Subtest: P1-012 recovery guard blocks concurrent recovery and live reply acquisition until recovery audit completes
ok 175 - P1-012 recovery guard blocks concurrent recovery and live reply acquisition until recovery audit completes
  ---
  duration_ms: 22.0219
  type: 'test'
  ...
# Subtest: P1-012 validates WSS and Pilot configuration without requiring a public listener
ok 176 - P1-012 validates WSS and Pilot configuration without requiring a public listener
  ---
  duration_ms: 1.3503
  type: 'test'
  ...
# Subtest: P1-012 check emits a redacted readiness record with no public-IP prerequisite
ok 177 - P1-012 check emits a redacted readiness record with no public-IP prerequisite
  ---
  duration_ms: 318.1186
  type: 'test'
  ...
# Subtest: P1-012 marks an active delivery without an explicit provider ACK as retryable
ok 178 - P1-012 marks an active delivery without an explicit provider ACK as retryable
  ---
  duration_ms: 0.52
  type: 'test'
  ...
# Subtest: P1-012 uses the Gate-0-verified completed stream shape for a group passive reply
ok 179 - P1-012 uses the Gate-0-verified completed stream shape for a group passive reply
  ---
  duration_ms: 0.3475
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
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_REPLY_PROBE","probe":{"exact_token":true,"addressing":"WECOM_MENTION_PREFIX","database_write":false,"run_id":"3a629225adc61935d9d886fa9effecf1"},"passive_reply":{"operation":"aibot_respond_msg_stream","attempted":true,"acknowledged":true,"provider_errcode":0,"outcome":"ACKED"}}
# Subtest: P1-012 keeps a short reply probe exact-scoped and out of the Pilot database
ok 180 - P1-012 keeps a short reply probe exact-scoped and out of the Pilot database
  ---
  duration_ms: 18.5523
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
  duration_ms: 57.1346
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_client_display_observed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT","source_result_hash":"a98b043eaf220dfa7f8a6d15a1fdb998","provider_reply_acknowledged":true,"database_write":true,"ticket_created":true,"intake_status":"TICKET_CREATED","observer":"configured_test_account","observation":"VISIBLE"}
# Subtest: P1-012 records one HMAC-linked client observation for a successful Ticket-creating group text
ok 182 - P1-012 records one HMAC-linked client observation for a successful Ticket-creating group text
  ---
  duration_ms: 14.7348
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_shared_delivery_reconciled","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"SHARED_DELIVERY_RECONCILIATION","database_mutation":false,"synthetic_signature":"ACK_PREFIX","delivery_count":2,"ticket_count":1,"attempt_count":3,"retry_attempts":1,"synthetic_sent_attempts":2,"channels":{"pilot_team":1,"wecom_direct":1},"audit_history_preserved":true,"excluded_from_real_wecom_delivery_evidence":true,"reconciliation_status":"IDENTIFIED_AND_EXCLUDED"}
# Subtest: P1-012 reconciles the exact synthetic shared Delivery footprint without mutating database facts
ok 183 - P1-012 reconciles the exact synthetic shared Delivery footprint without mutating database facts
  ---
  duration_ms: 7.2825
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_client_display_observed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","source_result_hash":"4820f6a54a47a36001fef143b95d984c","source_addressing":"WECOM_MENTION_PREFIX","provider_reply_acknowledged":true,"database_write":false,"observer":"configured_test_account","observation":"VISIBLE"}
# Subtest: P1-012 serializes concurrent client observations for one reply-probe source
ok 184 - P1-012 serializes concurrent client observations for one reply-probe source
  ---
  duration_ms: 21.5827
  type: 'test'
  ...
# Subtest: P1-012 rejects a client observation whose source becomes stale before it claims the evidence chain
ok 185 - P1-012 rejects a client observation whose source becomes stale before it claims the evidence chain
  ---
  duration_ms: 3.7964
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
  duration_ms: 25.4494
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# Subtest: P1-012 prevents a reply probe from starting after an earlier evidence failure has won
ok 187 - P1-012 prevents a reply probe from starting after an earlier evidence failure has won
  ---
  duration_ms: 25.5024
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_REPLY_PROBE","probe":{"exact_token":true,"addressing":"BARE","database_write":false,"run_id":"fb69f69c366ed7e710076c1d15bd3c58"},"passive_reply":{"operation":"aibot_respond_msg_stream","attempted":true,"acknowledged":true,"provider_errcode":0,"outcome":"ACKED"}}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_EVIDENCE_WRITE_FAILED"}
# Subtest: P1-012 records an in-flight reply probe before its deferred terminal failure
ok 188 - P1-012 records an in-flight reply probe before its deferred terminal failure
  ---
  duration_ms: 31.2357
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_LIVE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN"}
# Subtest: P1-012 hard-times-out a permanently pending reply probe with an explicit unknown side-effect state
ok 189 - P1-012 hard-times-out a permanently pending reply probe with an explicit unknown side-effect state
  ---
  duration_ms: 5.8816
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_LIVE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN"}
# Subtest: P1-012 suppresses a late reply-probe success record after its hard timeout
ok 190 - P1-012 suppresses a late reply-probe success record after its hard timeout
  ---
  duration_ms: 25.8974
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_EVIDENCE_WRITE_FAILED"}
# Subtest: P1-012 prevents a failed group-id capture run from updating the local group id
ok 191 - P1-012 prevents a failed group-id capture run from updating the local group id
  ---
  duration_ms: 5.4986
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_applied","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"side_effect_state":"APPLIED","configuration_updated":true,"group_id_hash":"9aa6151c5e05da82086348a14803d96d"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_EVIDENCE_WRITE_FAILED","side_effect_state":"APPLIED","configuration_updated":true,"group_id_hash":"9aa6151c5e05da82086348a14803d96d"}
# Subtest: P1-012 records an in-flight group-id capture before its deferred terminal failure
ok 192 - P1-012 records an in-flight group-id capture before its deferred terminal failure
  ---
  duration_ms: 28.9281
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
  duration_ms: 9.0026
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_GROUP_ID_CAPTURE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN","group_id_hash":"eac76feda981759f44d849e3e50e5a7e","reconciliation_required":true}
# Subtest: P1-012 hard-times-out a pending group-id capture and aborts its local update seam
ok 194 - P1-012 hard-times-out a pending group-id capture and aborts its local update seam
  ---
  duration_ms: 1.9712
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_GROUP_ID_CAPTURE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN","group_id_hash":"eac76feda981759f44d849e3e50e5a7e","reconciliation_required":true}
# Subtest: P1-012 leaves a late non-cooperative capture update as reconcilable unknown without a late applied record
ok 195 - P1-012 leaves a late non-cooperative capture update as reconcilable unknown without a late applied record
  ---
  duration_ms: 20.5898
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_error","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT","error_code":"ECONNRESET"}
# {"test_id":"P1-012","event":"p1_012_wss_disconnected","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reconnecting","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reauthenticated","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_TEXT","core":{"accepted":true},"passive_reply":{"acknowledged":true},"run_id":"c50084383d77ea58337171c34bdfb873"}
# Subtest: P1-012 waits through a transient SDK disconnect and records only safe reconnect evidence
ok 196 - P1-012 waits through a transient SDK disconnect and records only safe reconnect evidence
  ---
  duration_ms: 12.9028
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
  duration_ms: 11.5293
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
  duration_ms: 272.0085
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT","timeout_ms":10000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_disconnected","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reconnect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reauthenticated","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_post_reconnect_message_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT","reauthenticated":true}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"RECONNECT_GROUP_TEXT","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"SENT"},"run_id":"218deb42ff6b2060e01b9298a90f764a","reconnect":{"reauthenticated_before_callback":true}}
# Subtest: P1-012 forces reauthentication before accepting one scoped group-text callback
ok 199 - P1-012 forces reauthentication before accepting one scoped group-text callback
  ---
  duration_ms: 281.1139
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
# {"test_id":"P1-012","event":"p1_012_live_burst_result","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100","run_id":"0b89ac031c03c0d69c37ed1f254ecb72","expected_count":100,"callback_count":100,"unique_message_count":100,"accepted_within_target_count":100,"duplicate_callback_count":0,"database":{"inbox_count":100,"intake_count":100,"ticket_count":100,"outbox_count":100,"delivery_count":200,"tickets_with_invalid_outbox_count":0,"tickets_with_invalid_delivery_count":0},"zero_lost_tickets":true,"zero_duplicate_tickets":true,"notifications_traceable":true,"collection_elapsed_ms":88,"outcome":"PASSED"}
# Subtest: P1-012 completes a strictly sequenced 100-message live burst only after database fact reconciliation
ok 200 - P1-012 completes a strictly sequenced 100-message live burst only after database fact reconciliation
  ---
  duration_ms: 95.7085
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":1,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":2,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":3,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":4,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":5,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":6,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":7,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":8,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":9,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":10,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":11,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":12,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":13,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":14,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":15,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":16,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":17,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":18,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":19,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":20,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":21,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":22,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":23,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":24,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":25,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":26,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":27,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":28,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":29,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":30,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":31,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":32,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":33,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":34,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":35,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":36,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":37,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":38,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":39,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":40,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":41,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":42,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":43,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":44,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":45,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":46,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":47,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":48,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":49,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":50,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":51,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":52,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":53,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":54,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":55,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":56,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":57,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":58,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":59,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":60,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":61,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":62,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":63,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":64,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":65,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":66,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":67,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":68,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":69,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":70,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":71,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":72,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":73,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":74,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":75,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":76,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":77,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":78,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":79,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":80,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":81,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":82,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":83,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":84,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":85,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":86,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":87,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":88,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":89,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":90,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":91,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":92,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":93,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":94,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":95,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":96,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":97,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":98,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":99,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":100,"run_id":"b3646d582fcab18b48516451e9de6e56"}
# {"test_id":"P1-012","event":"p1_012_live_burst_result","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100","run_id":"b3646d582fcab18b48516451e9de6e56","expected_count":100,"callback_count":100,"unique_message_count":100,"accepted_within_target_count":100,"duplicate_callback_count":0,"database":{"inbox_count":100,"intake_count":100,"ticket_count":100,"outbox_count":100,"delivery_count":200,"tickets_with_invalid_outbox_count":2,"tickets_with_invalid_delivery_count":2},"zero_lost_tickets":true,"zero_duplicate_tickets":true,"notifications_traceable":false,"collection_elapsed_ms":92,"outcome":"FAILED"}
# Subtest: P1-012 burst fails closed when global notification totals mask per-ticket gaps
ok 201 - P1-012 burst fails closed when global notification totals mask per-ticket gaps
  ---
  duration_ms: 101.2039
  type: 'test'
  ...
# Subtest: P1-012 exercises the real Pilot core under duplicate, image, burst, Outbox failure, and AI-off conditions
ok 202 - P1-012 exercises the real Pilot core under duplicate, image, burst, Outbox failure, and AI-off conditions
  ---
  duration_ms: 1416.8935
  type: 'test'
  ...
# Subtest: P1-012 handles a scoped group text frame through Intake then a safe reply and Delivery
ok 203 - P1-012 handles a scoped group text frame through Intake then a safe reply and Delivery
  ---
  duration_ms: 7.1939
  type: 'test'
  ...
# Subtest: P1-012 records an image-degraded Intake without fabricating a Ticket
ok 204 - P1-012 records an image-degraded Intake without fabricating a Ticket
  ---
  duration_ms: 0.8866
  type: 'test'
  ...
# Subtest: P1-012 accepts an addressed group mixed image only when it contains the run token and an image
ok 205 - P1-012 accepts an addressed group mixed image only when it contains the run token and an image
  ---
  duration_ms: 1.1175
  type: 'test'
  ...
# Subtest: P1-012 ignores an unscoped group frame without calling any operational seam
ok 206 - P1-012 ignores an unscoped group frame without calling any operational seam
  ---
  duration_ms: 0.3706
  type: 'test'
  ...
# Subtest: P1-012 keeps a transient core failure safe and retryable without leaking the failure text
ok 207 - P1-012 keeps a transient core failure safe and retryable without leaking the failure text
  ---
  duration_ms: 0.6333
  type: 'test'
  ...
# Subtest: P1-012 keeps a thrown database fault out of the client reply and safe evidence
ok 208 - P1-012 keeps a thrown database fault out of the client reply and safe evidence
  ---
  duration_ms: 0.7174
  type: 'test'
  ...
# Subtest: P1-012 requires an explicit successful provider receipt for a passive reply
ok 209 - P1-012 requires an explicit successful provider receipt for a passive reply
  ---
  duration_ms: 0.5838
  type: 'test'
  ...
# Subtest: P1-012 preserves a provider reply rejection code without keeping its message text
ok 210 - P1-012 preserves a provider reply rejection code without keeping its message text
  ---
  duration_ms: 1.1205
  type: 'test'
  ...
# Subtest: P1-012 Go/No-Go requires real client observation but never a public IP for outbound WSS
ok 211 - P1-012 Go/No-Go requires real client observation but never a public IP for outbound WSS
  ---
  duration_ms: 1.3324
  type: 'test'
  ...
# Subtest: P1-012 WeCom burst UI plan is side-effect free and preserves the requested sequence range
ok 212 - P1-012 WeCom burst UI plan is side-effect free and preserves the requested sequence range
  ---
  duration_ms: 2550.9839
  type: 'test'
  ...
# Subtest: P1-012 WeCom burst UI driver fails closed on invalid ranges and ambiguous modes
ok 213 - P1-012 WeCom burst UI driver fails closed on invalid ranges and ambiguous modes
  ---
  duration_ms: 3073.6914
  type: 'test'
  ...
# Subtest: P1-012 WeCom burst UI driver retains fail-closed target, clipboard, stop, and reconciliation guards
ok 214 - P1-012 WeCom burst UI driver retains fail-closed target, clipboard, stop, and reconciliation guards
  ---
  duration_ms: 11.979
  type: 'test'
  ...
# Subtest: P2-001 PostgreSQL contract is idempotent, isolated, and fail closed
ok 215 - P2-001 PostgreSQL contract is idempotent, isolated, and fail closed
  ---
  duration_ms: 2048.0644
  type: 'test'
  ...
# Subtest: all P2 conversation feature flags default to false
ok 216 - all P2 conversation feature flags default to false
  ---
  duration_ms: 3.1202
  type: 'test'
  ...
# Subtest: Thread identity separates single, group, and multiple bots without exposing raw ids in its key
ok 217 - Thread identity separates single, group, and multiple bots without exposing raw ids in its key
  ---
  duration_ms: 2.2361
  type: 'test'
  ...
# Subtest: Thread identity rejects malformed channel scope with a stable error
ok 218 - Thread identity rejects malformed channel scope with a stable error
  ---
  duration_ms: 0.9424
  type: 'test'
  ...
# Subtest: group Session scope isolates participants and Intakes
ok 219 - group Session scope isolates participants and Intakes
  ---
  duration_ms: 1.2925
  type: 'test'
  ...
# Subtest: Session boundary rules cover ended, explicit, different Intake, idle equality, and continuation
ok 220 - Session boundary rules cover ended, explicit, different Intake, idle equality, and continuation
  ---
  duration_ms: 1.8646
  type: 'test'
  ...
# Subtest: only auditable boundary reasons are accepted from callers
ok 221 - only auditable boundary reasons are accepted from callers
  ---
  duration_ms: 0.6762
  type: 'test'
  ...
# Subtest: Session lifecycle is OPEN/WAITING_USER with ENDED terminal
ok 222 - Session lifecycle is OPEN/WAITING_USER with ENDED terminal
  ---
  duration_ms: 0.636
  type: 'test'
  ...
# Subtest: control modes fail closed, default HUMAN, and reserve AUTO for P2-010/P2-G4
ok 223 - control modes fail closed, default HUMAN, and reserve AUTO for P2-010/P2-G4
  ---
  duration_ms: 0.5611
  type: 'test'
  ...
# Subtest: generation and row versions advance only for unique invalidating changes
ok 224 - generation and row versions advance only for unique invalidating changes
  ---
  duration_ms: 0.6394
  type: 'test'
  ...
# Subtest: disabled guard does not invoke storage or external seams and raw failures stay hidden
ok 225 - disabled guard does not invoke storage or external seams and raw failures stay hidden
  ---
  duration_ms: 0.9499
  type: 'test'
  ...
# Subtest: database failures map to stable public errors
ok 226 - database failures map to stable public errors
  ---
  duration_ms: 0.4563
  type: 'test'
  ...
# Subtest: P2-001 migration is limited to Thread and Session and reserves later tasks
ok 227 - P2-001 migration is limited to Thread and Session and reserves later tasks
  ---
  duration_ms: 13.8152
  type: 'test'
  ...
# Subtest: JSON Schemas, public OpenAPI view, and TypeScript declarations freeze safe vocabulary
ok 228 - JSON Schemas, public OpenAPI view, and TypeScript declarations freeze safe vocabulary
  ---
  duration_ms: 3.3277
  type: 'test'
  ...
# Subtest: P2-002 migration 011 first/repeat apply is exact and leaves P1/P2-001 unchanged
ok 229 - P2-002 migration 011 first/repeat apply is exact and leaves P1/P2-001 unchanged
  ---
  duration_ms: 1291.9021
  type: 'test'
  ...
# Subtest: P2-002 migration CLI runs only 011, is repeatable, and rolls check mode back
ok 230 - P2-002 migration CLI runs only 011, is repeatable, and rolls check mode back
  ---
  duration_ms: 3655.8388
  type: 'test'
  ...
# {"child_process_runs":4,"child_exit_codes":[0,0,0,0],"preapply_check_created_tables":0,"migration_files_executed":1,"tables_added":3,"p1_p2_001_catalog_unchanged":true,"postapply_check_rolled_back":true,"temp_database_cleanup":true}
# Subtest: P2-002 migration CLI fails closed on incompatible read-only source dependencies
ok 231 - P2-002 migration CLI fails closed on incompatible read-only source dependencies
  ---
  duration_ms: 1638.0448
  type: 'test'
  ...
# {"child_exit_code":1,"stable_error":"P2_002_SCHEMA_DRIFT_REMEDIATION_REQUIRED","p2_tables_created":0,"temp_database_cleanup":true}
# Subtest: P2-002 migration 011 fails closed on missing column
ok 232 - P2-002 migration 011 fails closed on missing column
  ---
  duration_ms: 1052.1504
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on weakened CHECK constraint
ok 233 - P2-002 migration 011 fails closed on weakened CHECK constraint
  ---
  duration_ms: 963.897
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on wrong unique constraint columns
ok 234 - P2-002 migration 011 fails closed on wrong unique constraint columns
  ---
  duration_ms: 936.9738
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on wrong index access method
ok 235 - P2-002 migration 011 fails closed on wrong index access method
  ---
  duration_ms: 1104.2771
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on wrong partial-index predicate
ok 236 - P2-002 migration 011 fails closed on wrong partial-index predicate
  ---
  duration_ms: 984.2086
  type: 'test'
  ...
# Subtest: P2-002 P1 source adapter reads Channel/Intake/Ticket/Delivery facts without mutating them
ok 237 - P2-002 P1 source adapter reads Channel/Intake/Ticket/Delivery facts without mutating them
  ---
  duration_ms: 4002.7046
  type: 'test'
  ...
# {"source_record_count":4,"channel_message_count":1,"ticket_event_variant_count":2,"delivery_count":1,"source_snapshot_unchanged":true}
# Subtest: P2-002 real worker processes roll back before commit and replay after ACK loss
ok 238 - P2-002 real worker processes roll back before commit and replay after ACK loss
  ---
  duration_ms: 2430.3987
  type: 'test'
  ...
# {"before_commit_kill_exit":{"code":null,"signal":"SIGKILL","killed":true},"before_commit_backend_close_polls":1,"before_commit_restart_exit":{"code":0,"signal":null,"killed":false},"before_commit_restart_inserted":1,"after_commit_kill_exit":{"code":null,"signal":"SIGKILL","killed":true},"after_commit_backend_close_polls":1,"after_commit_restart_exit":{"code":0,"signal":null,"killed":false},"after_commit_restart_replayed":1,"final_item_count":1,"final_binding_count":1,"final_checkpoint_cursor":"1","temp_database_cleanup":true}
# Subtest: P2-002 stale rebuild cannot delete a source committed after snapshot preparation
ok 239 - P2-002 stale rebuild cannot delete a source committed after snapshot preparation
  ---
  duration_ms: 1162.3625
  type: 'test'
  ...
# {"connection_wait_polls":1,"stale_rebuild_error":"CONVERSATION_TIMELINE_REBUILD_FAILED","preserved_item_count":3,"preserved_binding_count":3,"preserved_checkpoint_cursor":"3","full_rebuild_item_count":3,"full_rebuild_hash":"2d574c6dc435fc45a33dd4b2843e70f01a567baa1c4616b0c4b44c189f05df47","temp_database_cleanup":true}
# Subtest: P2-002 projector is idempotent, concurrent, transactional, rebuildable, private, and restart safe
ok 240 - P2-002 projector is idempotent, concurrent, transactional, rebuildable, private, and restart safe
  ---
  duration_ms: 11139.4738
  type: 'test'
  ...
# {"same_source_concurrency":12,"different_source_concurrency":12,"bulk_item_count":2001,"bulk_batch_count":101,"bulk_max_batch_size":20,"bulk_peak_heap_delta_bytes":20602536,"bulk_heap_sample_count":101,"bulk_heap_segment_means_bytes":[17242308,19897009,22728173,26268264],"bulk_first_to_last_heap_trend_bytes":9025956,"bulk_max_adjacent_heap_trend_bytes":3540091,"bulk_interrupted_at_cursor":"20","bulk_restart_remaining_items":1981,"rebuild_canonical_hash":"147f614e2c633c4ab2de27ca71b1b079de587761da22c558d4f6ead2d6d8f622","temp_database_cleanup":"verified-by-finally"}
# Subtest: P2-002 suite leaves no random database or worker backend residual
ok 241 - P2-002 suite leaves no random database or worker backend residual
  ---
  duration_ms: 93.4858
  type: 'test'
  ...
# {"temp_database_count":0,"worker_backend_count":0,"isolated_source_data_residual":0,"isolated_projection_schema_residual":0}
# Subtest: P2-002 uses the frozen P2-001 Conversation Item enums
ok 242 - P2-002 uses the frozen P2-001 Conversation Item enums
  ---
  duration_ms: 13.559
  type: 'test'
  ...
# Subtest: projection source schema parses and freezes the five source types
ok 243 - projection source schema parses and freezes the five source types
  ---
  duration_ms: 2.8557
  type: 'test'
  ...
# Subtest: normalization rejects invalid source type, session UUID, date, ordinal and additions
ok 244 - normalization rejects invalid source type, session UUID, date, ordinal and additions
  ---
  duration_ms: 4.6638
  type: 'test'
  ...
# Subtest: date normalization rejects hostile Date/object paths without invoking or leaking them
ok 245 - date normalization rejects hostile Date/object paths without invoking or leaking them
  ---
  duration_ms: 1.2685
  type: 'test'
  ...
# Subtest: safe_content accepts only bounded plain JSON data properties
ok 246 - safe_content accepts only bounded plain JSON data properties
  ---
  duration_ms: 0.9865
  type: 'test'
  ...
# Subtest: toJSON, Proxy and prototype-pollution keys cannot bypass pure JSON checks
ok 247 - toJSON, Proxy and prototype-pollution keys cannot bypass pure JSON checks
  ---
  duration_ms: 0.8583
  type: 'test'
  ...
# Subtest: source_hash is stable across key order and detects semantic mutation
ok 248 - source_hash is stable across key order and detects semantic mutation
  ---
  duration_ms: 0.9432
  type: 'test'
  ...
# Subtest: privacy and retention controls can tighten without changing semantic source_hash
ok 249 - privacy and retention controls can tighten without changing semantic source_hash
  ---
  duration_ms: 0.9377
  type: 'test'
  ...
# Subtest: canonical order uses the frozen rank and exact deterministic tie-break tuple
ok 250 - canonical order uses the frozen rank and exact deterministic tie-break tuple
  ---
  duration_ms: 3.6172
  type: 'test'
  ...
# Subtest: canonical order compares BIGINT ordinals numerically without Number conversion
ok 251 - canonical order compares BIGINT ordinals numerically without Number conversion
  ---
  duration_ms: 1.7845
  type: 'test'
  ...
# Subtest: source id and variant break otherwise identical timestamp/rank/ordinal ties
ok 252 - source id and variant break otherwise identical timestamp/rank/ordinal ties
  ---
  duration_ms: 1.01
  type: 'test'
  ...
# Subtest: CHANNEL_MESSAGE maps only clean_text and four safe flags
ok 253 - CHANNEL_MESSAGE maps only clean_text and four safe flags
  ---
  duration_ms: 1.2683
  type: 'test'
  ...
# Subtest: TICKET_EVENT splits STATUS, EXTERNAL_NOTE and INTERNAL_NOTE variants
ok 254 - TICKET_EVENT splits STATUS, EXTERNAL_NOTE and INTERNAL_NOTE variants
  ---
  duration_ms: 0.9637
  type: 'test'
  ...
# Subtest: TICKET_EVENT external variant cannot contain internal note or operator identity
ok 255 - TICKET_EVENT external variant cannot contain internal note or operator identity
  ---
  duration_ms: 0.5686
  type: 'test'
  ...
# Subtest: TICKET_EVENT omits absent note variants
ok 256 - TICKET_EVENT omits absent note variants
  ---
  duration_ms: 0.391
  type: 'test'
  ...
# Subtest: DELIVERY is INTERNAL and excludes target/provider/raw error data
ok 257 - DELIVERY is INTERNAL and excludes target/provider/raw error data
  ---
  duration_ms: 0.6881
  type: 'test'
  ...
# Subtest: Communication Message fixture mapper requires an explicit fixture marker
ok 258 - Communication Message fixture mapper requires an explicit fixture marker
  ---
  duration_ms: 0.5552
  type: 'test'
  ...
# Subtest: Handoff fixture defaults to INTERNAL and never creates a future table dependency
ok 259 - Handoff fixture defaults to INTERNAL and never creates a future table dependency
  ---
  duration_ms: 0.3733
  type: 'test'
  ...
# Subtest: normalized safe_content deny-list blocks privacy and provider leakage fields
ok 260 - normalized safe_content deny-list blocks privacy and provider leakage fields
  ---
  duration_ms: 0.91
  type: 'test'
  ...
# Subtest: feature flag is fail-closed before any database call
ok 261 - feature flag is fail-closed before any database call
  ---
  duration_ms: 0.8761
  type: 'test'
  ...
# Subtest: batchSize defaults to 20 and is bounded at construction and invocation
ok 262 - batchSize defaults to 20 and is bounded at construction and invocation
  ---
  duration_ms: 0.9315
  type: 'test'
  ...
# Subtest: runtime freezes every source and operation to the single timeline projector name
ok 263 - runtime freezes every source and operation to the single timeline projector name
  ---
  duration_ms: 4.3589
  type: 'test'
  ...
# Subtest: public storage failures contain only the stable code
ok 264 - public storage failures contain only the stable code
  ---
  duration_ms: 0.7882
  type: 'test'
  ...
# Subtest: database sequence uniqueness is deterministically mapped to the frozen sequence error
ok 265 - database sequence uniqueness is deterministically mapped to the frozen sequence error
  ---
  duration_ms: 8.4555
  type: 'test'
  ...
# Subtest: rebuild authorization and wrapper accessor validation fail before storage
ok 266 - rebuild authorization and wrapper accessor validation fail before storage
  ---
  duration_ms: 2.8346
  type: 'test'
  ...
# Subtest: rebuild stale-snapshot fence fails before DELETE for extra or foreign bindings
ok 267 - rebuild stale-snapshot fence fails before DELETE for extra or foreign bindings
  ---
  duration_ms: 4.8495
  type: 'test'
  ...
# Subtest: Canonical Timeline Hash excludes projected_at and physical input order
ok 268 - Canonical Timeline Hash excludes projected_at and physical input order
  ---
  duration_ms: 0.9088
  type: 'test'
  ...
# Subtest: Canonical Timeline Hash validates arrays and items before any caller property access
ok 269 - Canonical Timeline Hash validates arrays and items before any caller property access
  ---
  duration_ms: 1.7847
  type: 'test'
  ...
# Subtest: EXTERNAL audience uses SQL visibility filtering and defense-in-depth filtering
ok 270 - EXTERNAL audience uses SQL visibility filtering and defense-in-depth filtering
  ---
  duration_ms: 1.0494
  type: 'test'
  ...
# Subtest: WORKBENCH excludes RESTRICTED and RESTRICTED_ADMIN requires explicit authorization
ok 271 - WORKBENCH excludes RESTRICTED and RESTRICTED_ADMIN requires explicit authorization
  ---
  duration_ms: 0.4567
  type: 'test'
  ...
# Subtest: generic TimelineSourceAdapter maps rows outside projector transactions
ok 272 - generic TimelineSourceAdapter maps rows outside projector transactions
  ---
  duration_ms: 0.7694
  type: 'test'
  ...
# Subtest: public wrapper APIs reject Proxy/accessor arguments before invoking dependencies
ok 273 - public wrapper APIs reject Proxy/accessor arguments before invoking dependencies
  ---
  duration_ms: 1.2309
  type: 'test'
  ...
# Subtest: unknown Proxy/accessor error objects are sanitized without a second trap
ok 274 - unknown Proxy/accessor error objects are sanitized without a second trap
  ---
  duration_ms: 0.3228
  type: 'test'
  ...
# Subtest: worker reads a bounded batch before invoking the projector and preserves AbortSignal
ok 275 - worker reads a bounded batch before invoking the projector and preserves AbortSignal
  ---
  duration_ms: 0.6806
  type: 'test'
  ...
# Subtest: worker maps unknown adapter failures to the stable storage error
ok 276 - worker maps unknown adapter failures to the stable storage error
  ---
  duration_ms: 0.2857
  type: 'test'
  ...
# Subtest: checkpoint cursor accepts nullable expected values and enforces the shared 512 bound
ok 277 - checkpoint cursor accepts nullable expected values and enforces the shared 512 bound
  ---
  duration_ms: 4.4977
  type: 'test'
  ...
# Subtest: migration runner executes only migration 011 and sanitizes raw failures
ok 278 - migration runner executes only migration 011 and sanitizes raw failures
  ---
  duration_ms: 6.0823
  type: 'test'
  ...
# Subtest: the public error vocabulary contains exactly the eleven frozen stable codes
ok 279 - the public error vocabulary contains exactly the eleven frozen stable codes
  ---
  duration_ms: 0.512
  type: 'test'
  ...
# Subtest: P1 source adapter reads current sources in one repeatable-read read-only transaction
ok 280 - P1 source adapter reads current sources in one repeatable-read read-only transaction
  ---
  duration_ms: 0.8188
  type: 'test'
  ...
# Subtest: P2-003 migration 012 is exact, reentrant, CLI-scoped, and check-only rolls back
ok 281 - P2-003 migration 012 is exact, reentrant, CLI-scoped, and check-only rolls back
  ---
  duration_ms: 2787.0221
  type: 'test'
  ...
# {"migration_process_runs":4,"migration_files_executed":1,"relations_added":2,"prior_catalog_unchanged":true,"precheck_rolled_back":true,"postcheck_rolled_back":true,"temp_database_cleanup":true}
# Subtest: P2-003 migration fails closed for missing column, weak check, wrong unique and index drift
ok 282 - P2-003 migration fails closed for missing column, weak check, wrong unique and index drift
  ---
  duration_ms: 8587.2736
  type: 'test'
  ...
# {"drift_scenarios":5,"temp_database_cleanup":true}
# Subtest: P2-003 append, concurrency, caller transaction, durable replay and authorization are exact
ok 283 - P2-003 append, concurrency, caller transaction, durable replay and authorization are exact
  ---
  duration_ms: 5148.4657
  type: 'test'
  ...
# {"same_event_concurrency":12,"different_event_concurrency":12,"pool_maximum":4,"natural_identity_hole":true,"ack_loss_replayed":true,"replay_batch_count":3,"replay_batch_maximum":50,"authorization_variants":4,"retained_event_count":124,"temp_database_cleanup":true}
# Subtest: P2-003 retention check/apply preserves prefix and floor semantics with CLI authorization
ok 284 - P2-003 retention check/apply preserves prefix and floor semantics with CLI authorization
  ---
  duration_ms: 9253.998
  type: 'test'
  ...
# {"check_zero_write":true,"unauthorized_apply_zero_write":true,"deleted_prefix_count":2,"floor_event_id":"2","expired_after_live_retained":true,"retry_idempotent":true,"replay_gap_http_fallback":true,"cursor_ahead_http_409":true,"authorized_cli_apply":true}
# Subtest: P2-003 retention delete/floor is atomic and every cleanup batch is at most 200
ok 285 - P2-003 retention delete/floor is atomic and every cleanup batch is at most 200
  ---
  duration_ms: 9399.0123
  type: 'test'
  ...
# {"first_batch_deleted":200,"second_batch_deleted":1,"floor_delete_atomic_rollback":true}
# Subtest: P2-003 localhost SSE admits 32 clients, rejects 33, heartbeats, delivers and releases resources
ok 286 - P2-003 localhost SSE admits 32 clients, rejects 33, heartbeats, delivers and releases resources
  ---
  duration_ms: 5793.2027
  type: 'test'
  ...
# {"peak_client_count":32,"event_count":100,"each_client_received":100,"capacity_rejections":1,"maximum_writable_length":16695,"slow_client_disconnects":0,"heap_samples_bytes":[9915592,11957720,13533752,11477328,12719368,15355664,16972104],"first_heap_bytes":9915592,"last_heap_bytes":16972104,"heap_sample_mean_bytes":13133075,"first_to_last_heap_trend_bytes":7056512,"peak_heap_delta_bytes":7056512,"database_query_batches":108,"resource_release_polls":2,"temp_database_cleanup":true}
# Subtest: P2-003 child kill/restart replays Last-Event-ID and missed wakeup recovers from PostgreSQL
ok 287 - P2-003 child kill/restart replays Last-Event-ID and missed wakeup recovers from PostgreSQL
  ---
  duration_ms: 5435.1673
  type: 'test'
  ...
# {"killed_server_exit":{"code":null,"signal":"SIGKILL","killed":true},"killed_server_backend_close_polls":1,"first_event_id":"1","post_restart_event_id":"2","recovery_poll_event_id":"3","app_restart_postgresql_replay":true,"missed_wakeup_recovered":true,"server_a_port":60165,"server_b_port":60172,"temp_database_cleanup":true}
# Subtest: P2-003 real paused slow client is isolated while normal delivery and append continue
ok 288 - P2-003 real paused slow client is isolated while normal delivery and append continue
  ---
  duration_ms: 22314.4198
  type: 'test'
  ...
# {"slow_disconnect_count":1,"normal_client_received":5001,"persisted_event_count":5001,"slow_disconnect_polls":84,"active_slow_write_window_polls":16,"normal_joined_during_slow_drain_polls":1,"normal_client_remained_connected":true,"append_during_slow_write_window":true,"business_transaction_during_slow_write_window":true,"temp_database_cleanup":true}
# Subtest: P2-003 streams 5,000 events in bounded batches and bounded heap without retaining frames
ok 289 - P2-003 streams 5,000 events in bounded batches and bounded heap without retaining frames
  ---
  duration_ms: 9570.6477
  type: 'test'
  ...
# {"event_count":5000,"replay_query_batch_count":100,"replay_batch_size":50,"captured_frame_count":0,"maximum_parser_buffer_bytes":370,"maximum_writable_length":16588,"heap_samples_bytes":[9944120,11970184,12586840,16722728,17274888,15810616],"first_to_last_heap_trend_bytes":5866496,"peak_heap_delta_bytes":7330768,"temp_database_cleanup":true}
# Subtest: P2-003 suite leaves no owned database, schema, child, backend, socket, port or timer residual
ok 290 - P2-003 suite leaves no owned database, schema, child, backend, socket, port or timer residual
  ---
  duration_ms: 100.3438
  type: 'test'
  ...
# {"active_test_clients":0,"active_fallback_requests":0,"active_test_http_sockets":0,"active_test_wait_timers":0,"active_cli_children":0,"active_server_children":0,"owned_port_count":6,"closed_port_count":6,"port_close_polls":[1,1,1,1,1,1],"owned_database_count":0,"owned_schema_count":0,"owned_backend_count":0,"active_database_count":0,"emergency_client_cleanup_count":0,"emergency_fallback_cleanup_count":0,"emergency_http_socket_cleanup_count":0}
# Subtest: Realtime Event and Fallback Schemas parse as draft 2020-12 closed contracts
ok 291 - Realtime Event and Fallback Schemas parse as draft 2020-12 closed contracts
  ---
  duration_ms: 17.5835
  type: 'test'
  ...
# Subtest: Realtime vocabularies freeze all event, source, aggregate, scope and visibility values
ok 292 - Realtime vocabularies freeze all event, source, aggregate, scope and visibility values
  ---
  duration_ms: 3.0565
  type: 'test'
  ...
# Subtest: TypeScript declarations mirror every frozen Schema and runtime vocabulary
ok 293 - TypeScript declarations mirror every frozen Schema and runtime vocabulary
  ---
  duration_ms: 4.023
  type: 'test'
  ...
# Subtest: authorized replay SQL clips scope and visibility before LIMIT and payload materialization
ok 294 - authorized replay SQL clips scope and visibility before LIMIT and payload materialization
  ---
  duration_ms: 2.9124
  type: 'test'
  ...
# Subtest: Fallback Schema freezes the six safe fields, four reasons and two strategies
ok 295 - Fallback Schema freezes the six safe fields, four reasons and two strategies
  ---
  duration_ms: 2.6323
  type: 'test'
  ...
# Subtest: normalization rejects invalid event, source, aggregate and scope vocabularies
ok 296 - normalization rejects invalid event, source, aggregate and scope vocabularies
  ---
  duration_ms: 2.367
  type: 'test'
  ...
# Subtest: SESSION and THREAD require a UUID scope while SYSTEM requires null
ok 297 - SESSION and THREAD require a UUID scope while SYSTEM requires null
  ---
  duration_ms: 2.2263
  type: 'test'
  ...
# Subtest: normalization rejects invalid timestamps and requires expires_at after occurred_at
ok 298 - normalization rejects invalid timestamps and requires expires_at after occurred_at
  ---
  duration_ms: 1.1569
  type: 'test'
  ...
# Subtest: aggregate versions use nullable canonical PostgreSQL BIGINT strings
ok 299 - aggregate versions use nullable canonical PostgreSQL BIGINT strings
  ---
  duration_ms: 2.2567
  type: 'test'
  ...
# Subtest: Last-Event-ID accepts zero and the BIGINT maximum without Number conversion
ok 300 - Last-Event-ID accepts zero and the BIGINT maximum without Number conversion
  ---
  duration_ms: 1.8995
  type: 'test'
  ...
# Subtest: Last-Event-ID rejects negative, decimal, scientific, signed, spaced and overflow forms
ok 301 - Last-Event-ID rejects negative, decimal, scientific, signed, spaced and overflow forms
  ---
  duration_ms: 0.5503
  type: 'test'
  ...
# Subtest: payload accepts only bounded plain finite JSON data
ok 302 - payload accepts only bounded plain finite JSON data
  ---
  duration_ms: 1.2044
  type: 'test'
  ...
# Subtest: payload enforces depth, node, object, array, string and canonical-byte limits
ok 303 - payload enforces depth, node, object, array, string and canonical-byte limits
  ---
  duration_ms: 5.6789
  type: 'test'
  ...
# Subtest: payload rejects Proxy and accessor paths without invoking hostile code
ok 304 - payload rejects Proxy and accessor paths without invoking hostile code
  ---
  duration_ms: 0.6667
  type: 'test'
  ...
# Subtest: payload rejects toJSON, symbols and prototype-pollution keys
ok 305 - payload rejects toJSON, symbols and prototype-pollution keys
  ---
  duration_ms: 0.6084
  type: 'test'
  ...
# Subtest: payload rejects message content and sensitive identifier property names
ok 306 - payload rejects message content and sensitive identifier property names
  ---
  duration_ms: 1.1058
  type: 'test'
  ...
# Subtest: event key is stable, opaque and changes with its frozen identity tuple
ok 307 - event key is stable, opaque and changes with its frozen identity tuple
  ---
  duration_ms: 3.3202
  type: 'test'
  ...
# Subtest: event hash is canonical across payload key order and changes on semantic mutation
ok 308 - event hash is canonical across payload key order and changes on semantic mutation
  ---
  duration_ms: 2.4655
  type: 'test'
  ...
# Subtest: event hash excludes expires_at, event_id and created_at
ok 309 - event hash excludes expires_at, event_id and created_at
  ---
  duration_ms: 1.0012
  type: 'test'
  ...
# Subtest: Conversation Item mapper exposes only the seven safe projection fields plus occurred_at
ok 310 - Conversation Item mapper exposes only the seven safe projection fields plus occurred_at
  ---
  duration_ms: 0.9327
  type: 'test'
  ...
# Subtest: Session fixture mapper freezes created and updated event variants with safe payloads
ok 311 - Session fixture mapper freezes created and updated event variants with safe payloads
  ---
  duration_ms: 1.4468
  type: 'test'
  ...
# Subtest: Timeline rebuilt fixture mapper exposes only count and canonical hash metadata
ok 312 - Timeline rebuilt fixture mapper exposes only count and canonical hash metadata
  ---
  duration_ms: 0.6871
  type: 'test'
  ...
# Subtest: public event view contains exactly nine safe fields and no publisher, source, hash or scope IDs
ok 313 - public event view contains exactly nine safe fields and no publisher, source, hash or scope IDs
  ---
  duration_ms: 0.7358
  type: 'test'
  ...
# Subtest: SSE event encoding uses id/type/single-line JSON and supports every frozen event type
ok 314 - SSE event encoding uses id/type/single-line JSON and supports every frozen event type
  ---
  duration_ms: 4.4534
  type: 'test'
  ...
# Subtest: SSE encoding rejects CR/LF event injection and never emits raw payload newlines
ok 315 - SSE encoding rejects CR/LF event injection and never emits raw payload newlines
  ---
  duration_ms: 0.6236
  type: 'test'
  ...
# Subtest: heartbeat is a comment frame and consumes no event id
ok 316 - heartbeat is a comment frame and consumes no event id
  ---
  duration_ms: 0.2325
  type: 'test'
  ...
# Subtest: authorization defaults to deny-all and rejects absent or malformed contexts
ok 317 - authorization defaults to deny-all and rejects absent or malformed contexts
  ---
  duration_ms: 0.8532
  type: 'test'
  ...
# Subtest: authorization normalizes bounded UUID sets without wildcard access
ok 318 - authorization normalizes bounded UUID sets without wildcard access
  ---
  duration_ms: 0.3976
  type: 'test'
  ...
# Subtest: restricted-admin defense-in-depth closes a malicious replay without delivering it
ok 319 - restricted-admin defense-in-depth closes a malicious replay without delivering it
  ---
  duration_ms: 6.5286
  type: 'test'
  ...
# Subtest: controlled principal disconnect closes only the selected SSE client
ok 320 - controlled principal disconnect closes only the selected SSE client
  ---
  duration_ms: 6.8546
  type: 'test'
  ...
# Subtest: disabled handler returns safe polling fallback with zero database calls and no timers
ok 321 - disabled handler returns safe polling fallback with zero database calls and no timers
  ---
  duration_ms: 1.0865
  type: 'test'
  ...
# Subtest: disabled event store fails before acquiring a database connection
ok 322 - disabled event store fails before acquiring a database connection
  ---
  duration_ms: 0.7691
  type: 'test'
  ...
# Subtest: disconnect during authentication never acquires replay, Hub, or timer resources
ok 323 - disconnect during authentication never acquires replay, Hub, or timer resources
  ---
  duration_ms: 0.5585
  type: 'test'
  ...
# Subtest: disconnect during authorization never acquires replay, Hub, or timer resources
ok 324 - disconnect during authorization never acquires replay, Hub, or timer resources
  ---
  duration_ms: 0.527
  type: 'test'
  ...
# Subtest: Wakeup Hub admits 32 clients, rejects the 33rd, and releases capacity
ok 325 - Wakeup Hub admits 32 clients, rejects the 33rd, and releases capacity
  ---
  duration_ms: 1.0517
  type: 'test'
  ...
# Subtest: replay batch configuration accepts 200 and rejects 201
ok 326 - replay batch configuration accepts 200 and rejects 201
  ---
  duration_ms: 1.2437
  type: 'test'
  ...
# Subtest: list replay rejects limits above 200 before querying storage
ok 327 - list replay rejects limits above 200 before querying storage
  ---
  duration_ms: 1.9344
  type: 'test'
  ...
# Subtest: backpressure waits for drain and releases only the affected stream
ok 328 - backpressure waits for drain and releases only the affected stream
  ---
  duration_ms: 3.4215
  type: 'test'
  ...
# Subtest: drain timeout disconnects only the slow client with bounded metrics
ok 329 - drain timeout disconnects only the slow client with bounded metrics
  ---
  duration_ms: 4.7699
  type: 'test'
  ...
# Subtest: retention gap after SSE headers closes the stream and reconnect returns 410 fallback
ok 330 - retention gap after SSE headers closes the stream and reconnect returns 410 fallback
  ---
  duration_ms: 1.5598
  type: 'test'
  ...
# Subtest: polling fallback normalizes canonical IDs and rejects unsafe forms
ok 331 - polling fallback normalizes canonical IDs and rejects unsafe forms
  ---
  duration_ms: 0.2149
  type: 'test'
  ...
# Subtest: public HTTP errors expose only stable codes and never raw authentication failures
ok 332 - public HTTP errors expose only stable codes and never raw authentication failures
  ---
  duration_ms: 0.4879
  type: 'test'
  ...
# Subtest: migration 020 is exact, reentrant, CLI-scoped, check-only, and preserves 005/010/011/012 catalogs
ok 333 - migration 020 is exact, reentrant, CLI-scoped, check-only, and preserves 005/010/011/012 catalogs
  ---
  duration_ms: 2391.2049
  type: 'test'
  ...
# {"first_apply":true,"repeated_apply":true,"check_rollback":true,"frozen_catalog_relations":10}
# Subtest: migration 020 fails closed for missing columns, weakened checks, wrong unique, index method and predicate
ok 334 - migration 020 fails closed for missing columns, weakened checks, wrong unique, index method and predicate
  ---
  duration_ms: 8277.0932
  type: 'test'
  ...
# {"drift_mutations":["missingcol","weakcheck","wrongunique","indexmethod","indexpred"],"stable_error":"P2_004_SCHEMA_DRIFT_REMEDIATION_REQUIRED"}
# Subtest: Communication service commits atomically, isolates idempotency scopes, and never mutates Session
ok 335 - Communication service commits atomically, isolates idempotency scopes, and never mutates Session
  ---
  duration_ms: 4117.9788
  type: 'test'
  ...
# {"browser_double_click_concurrency":12,"committed_fact_sets":1,"human_ai_same_body_isolated":true,"internal_note_outbox_count":0}
# Subtest: Delivery Worker enforces claim CAS, ACK, retry, dead letter, timeout unknown and lease recovery
ok 336 - Delivery Worker enforces claim CAS, ACK, retry, dead letter, timeout unknown and lease recovery
  ---
  duration_ms: 4608.1354
  type: 'test'
  ...
# {"concurrent_workers":12,"single_claim":true,"gateway_reconnect":true,"timeout_unknown":true,"leased_recovered":true,"sending_not_resent":true}
# Subtest: multi-target delivery is isolated, target rate limit is durable, and reconciliation is explicit
ok 337 - multi-target delivery is isolated, target rate limit is durable, and reconciliation is explicit
  ---
  duration_ms: 4121.5524
  type: 'test'
  ...
# {"multi_target_count":2,"isolated_outcomes":["SENT","DEAD_LETTER"],"target_rate_limit":true,"reconciliation_resolutions":["CONFIRMED_SENT","CONFIRMED_NOT_SENT_REQUEUE","CANCEL"]}
# Subtest: real Worker kill/restart reclaims LEASED but never blindly resends SENDING
ok 338 - real Worker kill/restart reclaims LEASED but never blindly resends SENDING
  ---
  duration_ms: 4564.0975
  type: 'test'
  ...
# {"leased_child_exit":{"code":null,"signal":"SIGKILL"},"leased_restart_sent":true,"sending_child_exit":{"code":null,"signal":"SIGKILL"},"sending_restart_reconciled":true,"blind_resend_count":0}
# Subtest: P1 compatibility is read-only until it delegates to the existing P1 worker
ok 339 - P1 compatibility is read-only until it delegates to the existing P1 worker
  ---
  duration_ms: 4995.5191
  type: 'test'
  ...
# {"p1_read_snapshot_unchanged":true,"p1_delivery_delegated":true,"communication_rows_created":0}
# Subtest: 500 deliveries remain bounded at batch 20 and interruption resumes without resource growth
ok 340 - 500 deliveries remain bounded at batch 20 and interruption resumes without resource growth
  ---
  duration_ms: 18467.8134
  type: 'test'
  ...
# {"deliveries":500,"batch_size":20,"interrupted_after":100,"resumed_to":500,"heap_samples":[13993512,14456264,14883800,17662520,17973408,18287008,18278944,22700224,12324016,25873592],"heap_growth_bytes":11880080,"soak_claimed":false}
# Subtest: P2-004 integration leaves no owned database or backend residual
ok 341 - P2-004 integration leaves no owned database or backend residual
  ---
  duration_ms: 107.9194
  type: 'test'
  ...
# {"database_count":0,"backend_count":0,"active_database_count":0,"worker_child_count":0,"worker_count":0,"timer_count":0,"child_process_count":0}
# Subtest: P2-004 JSON Schemas use draft 2020-12 and close object shapes
ok 342 - P2-004 JSON Schemas use draft 2020-12 and close object shapes
  ---
  duration_ms: 17.752
  type: 'test'
  ...
# Subtest: Reply Command schema and future OpenAPI bind session and idempotency without exposing a target
ok 343 - Reply Command schema and future OpenAPI bind session and idempotency without exposing a target
  ---
  duration_ms: 5.243
  type: 'test'
  ...
# Subtest: frozen Communication vocabularies are exact
ok 344 - frozen Communication vocabularies are exact
  ---
  duration_ms: 1.6032
  type: 'test'
  ...
# Subtest: normalization freezes Agent, AI, System, internal note and media contracts
ok 345 - normalization freezes Agent, AI, System, internal note and media contracts
  ---
  duration_ms: 2.8742
  type: 'test'
  ...
# Subtest: invalid UUID, row version, privacy, retention, message type, and browser authority are rejected
ok 346 - invalid UUID, row version, privacy, retention, message type, and browser authority are rejected
  ---
  duration_ms: 1.2226
  type: 'test'
  ...
# Subtest: plain JSON fence rejects Proxy, accessor, symbol, toJSON, prototype and pollution keys
ok 347 - plain JSON fence rejects Proxy, accessor, symbol, toJSON, prototype and pollution keys
  ---
  duration_ms: 0.5347
  type: 'test'
  ...
# Subtest: plain JSON fence enforces depth, node, string and array bounds
ok 348 - plain JSON fence enforces depth, node, string and array bounds
  ---
  duration_ms: 0.3188
  type: 'test'
  ...
# Subtest: content and command hashes are stable, key-order independent and cover row version
ok 349 - content and command hashes are stable, key-order independent and cover row version
  ---
  duration_ms: 1.6949
  type: 'test'
  ...
# Subtest: destination resolution uses authoritative Thread fields for single and group
ok 350 - destination resolution uses authoritative Thread fields for single and group
  ---
  duration_ms: 0.4973
  type: 'test'
  ...
# Subtest: disabled service performs zero database and authorization work
ok 351 - disabled service performs zero database and authorization work
  ---
  duration_ms: 0.702
  type: 'test'
  ...
# Subtest: disabled Worker performs zero database and Sender calls
ok 352 - disabled Worker performs zero database and Sender calls
  ---
  duration_ms: 0.7315
  type: 'test'
  ...
# Subtest: Sender Port validates ACK, rejected, unknown and rejects malformed results
ok 353 - Sender Port validates ACK, rejected, unknown and rejects malformed results
  ---
  duration_ms: 0.6777
  type: 'test'
  ...
# Subtest: Mock Sender records only safe call metadata
ok 354 - Mock Sender records only safe call metadata
  ---
  duration_ms: 0.6092
  type: 'test'
  ...
# Subtest: message projection maps Agent, AI, Internal and System without changing ownership
ok 355 - message projection maps Agent, AI, Internal and System without changing ownership
  ---
  duration_ms: 0.6364
  type: 'test'
  ...
# Subtest: delivery timeline and realtime mappers expose only safe delivery fields
ok 356 - delivery timeline and realtime mappers expose only safe delivery fields
  ---
  duration_ms: 0.4637
  type: 'test'
  ...
# Subtest: legacy notification mapping is safe and exact
ok 357 - legacy notification mapping is safe and exact
  ---
  duration_ms: 0.2314
  type: 'test'
  ...
# Subtest: public stable error inventory excludes raw provider and storage details
ok 358 - public stable error inventory excludes raw provider and storage details
  ---
  duration_ms: 0.1791
  type: 'test'
  ...
# Subtest: migration 021 is scoped, reentrant, check-rolls-back, and drift fails closed
ok 359 - migration 021 is scoped, reentrant, check-rolls-back, and drift fails closed
  ---
  duration_ms: 10129.3708
  type: 'test'
  ...
# {"first_apply":true,"repeated_apply":true,"check_rollback":true,"new_tables":4}
# Subtest: takeover is serialized/idempotent; handoff request-accept-release and request-cancel are audited atomically
ok 360 - takeover is serialized/idempotent; handoff request-accept-release and request-cancel are audited atomically
  ---
  duration_ms: 4814.1571
  type: 'test'
  ...
# {"concurrent_winners":1,"idempotent_parallel":12,"handoff":["REQUESTED","ACCEPTED","RELEASED"],"cancel":"CANCELLED"}
# Subtest: admin force transfer works; non-admin, inactive target, wrong-team handler, ended and stale commands fail closed
ok 361 - admin force transfer works; non-admin, inactive target, wrong-team handler, ended and stale commands fail closed
  ---
  duration_ms: 5081.8919
  type: 'test'
  ...
# {"admin_force_transfer":true,"handler_force":false,"inactive":false,"wrong_team":false}
# Subtest: generation race blocks stale AI before Communication and realtime failure rolls back control facts
ok 362 - generation race blocks stale AI before Communication and realtime failure rolls back control facts
  ---
  duration_ms: 5064.7409
  type: 'test'
  ...
# {"generation_start":1,"stale":true,"append_communication_calls":0,"message_delta":0,"outbox_delta":0,"delivery_delta":0,"realtime_failure_rollback":true}
# Subtest: 32 principals keep independent monotonic cursors; visibility COUNT is correct and Session versions do not move
ok 363 - 32 principals keep independent monotonic cursors; visibility COUNT is correct and Session versions do not move
  ---
  duration_ms: 7187.4407
  type: 'test'
  ...
# {"principals":32,"monotonic":true,"session_version_unchanged":true,"workbench_unread":1,"restricted_unread":2}
# Subtest: 2C4G bounded capacity covers 500 assignment/handoff facts and 2,000 cursor updates without residual resources
ok 364 - 2C4G bounded capacity covers 500 assignment/handoff facts and 2,000 cursor updates without residual resources
  ---
  duration_ms: 10205.8737
  type: 'test'
  ...
# {"assignments":500,"handoffs":500,"cursor_updates":2000,"max_list_limit":200,"heap_samples":5,"heap_monotonic_unbounded":false,"pool_max":4,"soak_24h":false}
# Subtest: all P2-005 JSON Schemas parse and freeze strict objects
ok 365 - all P2-005 JSON Schemas parse and freeze strict objects
  ---
  duration_ms: 11.0331
  type: 'test'
  ...
# Subtest: status, command, event, invalidation, and stable error vocabularies are frozen
ok 366 - status, command, event, invalidation, and stable error vocabularies are frozen
  ---
  duration_ms: 1.5584
  type: 'test'
  ...
# Subtest: normalization is bounded and command hash is stable across key order
ok 367 - normalization is bounded and command hash is stable across key order
  ---
  duration_ms: 4.5305
  type: 'test'
  ...
# Subtest: invalid identifiers, versions, sequences, reason codes, target modes, and extra authority fail closed
ok 368 - invalid identifiers, versions, sequences, reason codes, target modes, and extra authority fail closed
  ---
  duration_ms: 2.0797
  type: 'test'
  ...
# Subtest: non-plain JSON, Proxy, accessor, toJSON, symbol, cycle, and prototype pollution are rejected
ok 369 - non-plain JSON, Proxy, accessor, toJSON, symbol, cycle, and prototype pollution are rejected
  ---
  duration_ms: 0.9371
  type: 'test'
  ...
# Subtest: default authorization rejects every operation
ok 370 - default authorization rejects every operation
  ---
  duration_ms: 0.4116
  type: 'test'
  ...
# Subtest: disabled service returns before every database call and hides raw failures
ok 371 - disabled service returns before every database call and hides raw failures
  ---
  duration_ms: 1.0381
  type: 'test'
  ...
# Subtest: generation fence distinguishes current, stale, and HUMAN-forbidden without process state
ok 372 - generation fence distinguishes current, stale, and HUMAN-forbidden without process state
  ---
  duration_ms: 1.7395
  type: 'test'
  ...
# Subtest: assigned Communication authorizer denies AI flags, inactive/unassigned agents, and accepts assigned active actor
ok 373 - assigned Communication authorizer denies AI flags, inactive/unassigned agents, and accepts assigned active actor
  ---
  duration_ms: 0.9224
  type: 'test'
  ...
# Subtest: Realtime mappers expose versions/status only and no identity or content
ok 374 - Realtime mappers expose versions/status only and no identity or content
  ---
  duration_ms: 1.7185
  type: 'test'
  ...
# Subtest: Timeline mapper uses internal HANDOFF_EVENT and requires explicit privacy/retention
ok 375 - Timeline mapper uses internal HANDOFF_EVENT and requires explicit privacy/retention
  ---
  duration_ms: 0.7197
  type: 'test'
  ...
# Subtest: system browser desktop workbench flow is responsive, refresh-safe and XSS-safe
ok 376 - system browser desktop workbench flow is responsive, refresh-safe and XSS-safe
  ---
  duration_ms: 3590.1321
  type: 'test'
  ...
# {"browser":"C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe","viewport":{"label":"desktop","width":1440,"height":900},"interactions":{"select":1,"takeover":1,"transfer":1,"reply":1,"internal_note":1,"sse_update":true,"polling_fallback":true,"filter":true,"refresh_restore":true},"keyboard_focus_visible":true,"security_headers":true,"xss_executed":false,"horizontal_overflow":false}
# Subtest: system browser mobile workbench flow is responsive, refresh-safe and XSS-safe
ok 377 - system browser mobile workbench flow is responsive, refresh-safe and XSS-safe
  ---
  duration_ms: 3268.2586
  type: 'test'
  ...
# {"browser":"C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe","viewport":{"label":"mobile","width":390,"height":844},"interactions":{"select":1,"takeover":1,"transfer":1,"reply":1,"internal_note":1,"sse_update":true,"polling_fallback":true,"filter":true,"refresh_restore":true},"keyboard_focus_visible":true,"security_headers":true,"xss_executed":false,"horizontal_overflow":false}
# Subtest: system browser renders the same Workbench LocalDateTime under UTC, Tokyo, and New York
ok 378 - system browser renders the same Workbench LocalDateTime under UTC, Tokyo, and New York
  ---
  duration_ms: 3067.9994
  type: 'test'
  ...
# Subtest: P2-006 applies no DDL and leaves no isolated PostgreSQL resources
ok 379 - P2-006 applies no DDL and leaves no isolated PostgreSQL resources
  ---
  duration_ms: 5563.4112
  type: 'test'
  ...
# {"migration_022":true,"catalog_unchanged":true,"feature_enabled_only_in_test":true}
# Subtest: admin/dispatcher/handler authorization is enforced in SQL data access and timeline visibility
ok 380 - admin/dispatcher/handler authorization is enforced in SQL data access and timeline visibility
  ---
  duration_ms: 5693.784
  type: 'test'
  ...
# {"admin_sessions":2,"dispatcher_sessions":2,"assigned_handler_sessions":1,"outsider_sessions":0,"reporter_forbidden":true,"inactive_forbidden":true,"restricted_hidden_from_handler":true}
# Subtest: 500 conversations and 10,000 items have duplicate-free keyset pages and bounded read latency
ok 381 - 500 conversations and 10,000 items have duplicate-free keyset pages and bounded read latency
  ---
  duration_ms: 62656.1495
  type: 'test'
  ...
# {"sessions":500,"items":10000,"assignments":500,"tickets":500,"deliveries":500,"list_requests":1000,"detail_requests":1000,"keyset_unique":true,"p95":{"list_ms":57.592,"detail_ms":14.833}}
# Subtest: workbench facade commits human reply, internal note, takeover and idempotent replay through P2-004/P2-005 ports
ok 382 - workbench facade commits human reply, internal note, takeover and idempotent replay through P2-004/P2-005 ports
  ---
  duration_ms: 4013.0072
  type: 'test'
  ...
# {"takeover":true,"replayed":true,"transfer":true,"release":true,"handoff_request_cancel":true,"read_cursor":1,"external_messages":1,"internal_notes":1,"external_outbox":1,"internal_outbox":0,"pending_retry":true,"dead_letter_requeue":true,"reconciliation_required_blocks_retry":true,"admin_reconciliation":true}
# Subtest: 200 real HTTP reply commits and 12-way duplicate submit remain bounded without sender calls or socket residue
ok 383 - 200 real HTTP reply commits and 12-way duplicate submit remain bounded without sender calls or socket residue
  ---
  duration_ms: 7393.7475
  type: 'test'
  ...
# {"reply_http":{"samples":200,"p50_ms":15.803,"p95_ms":22.675,"p99_ms":28.387,"max_ms":89.893},"duplicate_submit_parallel":12,"messages":201,"outboxes":201,"deliveries":201,"sender_calls":0,"heap_samples_bytes":[14296976,16965000,19513072,15782768,22879256,18979776,25961712,23901712],"pool_max":4}
# Subtest: P2-003 SSE route delivers committed messages through authorized refetch within 2 seconds and releases timers
ok 384 - P2-003 SSE route delivers committed messages through authorized refetch within 2 seconds and releases timers
  ---
  duration_ms: 5823.1801
  type: 'test'
  ...
# {"new_message_commit_sse_refetch":{"samples":100,"p50_ms":21.05,"p95_ms":26.559,"p99_ms":52.548,"max_ms":128.361},"authorized_events":100,"unauthorized_events":0}
# Subtest: workbench schemas parse and OpenAPI 3.1 exposes every implemented route
ok 385 - workbench schemas parse and OpenAPI 3.1 exposes every implemented route
  ---
  duration_ms: 10.6305
  type: 'test'
  ...
# Subtest: opaque cursor round-trips normalized timestamp and session id
ok 386 - opaque cursor round-trips normalized timestamp and session id
  ---
  duration_ms: 1.8284
  type: 'test'
  ...
# Subtest: opaque cursor rejects malformed, oversized, and structurally extended values
ok 387 - opaque cursor rejects malformed, oversized, and structurally extended values
  ---
  duration_ms: 1.7229
  type: 'test'
  ...
# Subtest: disabled query service performs zero database and authorization calls
ok 388 - disabled query service performs zero database and authorization calls
  ---
  duration_ms: 0.8166
  type: 'test'
  ...
# Subtest: list SQL applies authorization in WHERE before keyset ORDER BY and LIMIT
ok 389 - list SQL applies authorization in WHERE before keyset ORDER BY and LIMIT
  ---
  duration_ms: 0.8963
  type: 'test'
  ...
# Subtest: query page limit and state filters fail closed
ok 390 - query page limit and state filters fail closed
  ---
  duration_ms: 0.7514
  type: 'test'
  ...
# Subtest: HTTP server construction fails when authentication port is absent
ok 391 - HTTP server construction fails when authentication port is absent
  ---
  duration_ms: 1.4583
  type: 'test'
  ...
# Subtest: HTTP API rejects unauthenticated and expired contexts without fallback
ok 392 - HTTP API rejects unauthenticated and expired contexts without fallback
  ---
  duration_ms: 98.0213
  type: 'test'
  ...
# Subtest: Cookie writes require exact origin, same-site context, constant-time CSRF and matching idempotency
ok 393 - Cookie writes require exact origin, same-site context, constant-time CSRF and matching idempotency
  ---
  duration_ms: 50.0257
  type: 'test'
  ...
# Subtest: Bearer mode requires Authorization header and tokens in query are forbidden
ok 394 - Bearer mode requires Authorization header and tokens in query are forbidden
  ---
  duration_ms: 14.2653
  type: 'test'
  ...
# Subtest: HTTP security headers contain strict CSP without inline or eval and no wildcard CORS
ok 395 - HTTP security headers contain strict CSP without inline or eval and no wildcard CORS
  ---
  duration_ms: 9.8951
  type: 'test'
  ...
# Subtest: non-JSON and oversized write bodies are rejected with stable public errors
ok 396 - non-JSON and oversized write bodies are rejected with stable public errors
  ---
  duration_ms: 16.9295
  type: 'test'
  ...
# Subtest: command facade delegates frozen control and communication ports without sender access
ok 397 - command facade delegates frozen control and communication ports without sender access
  ---
  duration_ms: 1.8174
  type: 'test'
  ...
# Subtest: UI source renders untrusted content through text nodes only
ok 398 - UI source renders untrusted content through text nodes only
  ---
  duration_ms: 0.8762
  type: 'test'
  ...
# Subtest: UI reducer bounds conversations and timeline arrays
ok 399 - UI reducer bounds conversations and timeline arrays
  ---
  duration_ms: 1.0271
  type: 'test'
  ...
# Subtest: refresh storage persists only selected id and filter
ok 400 - refresh storage persists only selected id and filter
  ---
  duration_ms: 0.4324
  type: 'test'
  ...
# Subtest: P2-006 creates no migration and static preview check succeeds
ok 401 - P2-006 creates no migration and static preview check succeeds
  ---
  duration_ms: 185.8979
  type: 'test'
  ...
# Subtest: P2-012 real command capacity 500 candidates, 200 incidents, 2000 reports, 1000 subscriptions, 5000 events, 500 bindings and 32 SSE
not ok 402 - P2-012 real command capacity 500 candidates, 200 incidents, 2000 reports, 1000 subscriptions, 5000 events, 500 bindings and 32 SSE
  ---
  duration_ms: 69146.9253
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
# Subtest: P2-012 closes input shapes, rejects hostile values and preserves deterministic command hashes
ok 403 - P2-012 closes input shapes, rejects hostile values and preserves deterministic command hashes
  ---
  duration_ms: 5.3043
  type: 'test'
  ...
# Subtest: P2-012 maintenance expires a bounded ordered batch through private SYSTEM commands without notifications
ok 404 - P2-012 maintenance expires a bounded ordered batch through private SYSTEM commands without notifications
  ---
  duration_ms: 6165.5312
  type: 'test'
  ...
# Subtest: P2-012 maintenance replays concurrent scans, handles human/time races and surfaces a still-due failure
ok 405 - P2-012 maintenance replays concurrent scans, handles human/time races and surfaces a still-due failure
  ---
  duration_ms: 6927.8518
  type: 'test'
  ...
# Subtest: P2-012 maintenance scans after import and expires an imported due candidate in the same iteration
ok 406 - P2-012 maintenance scans after import and expires an imported due candidate in the same iteration
  ---
  duration_ms: 3656.8756
  type: 'test'
  ...
# Subtest: P2-012 real database human confirmation, idempotency, recovery isolation and notification facts
ok 407 - P2-012 real database human confirmation, idempotency, recovery isolation and notification facts
  ---
  duration_ms: 6911.1448
  type: 'test'
  ...
# Subtest: dynamic live configuration requires an approved group but no preconfigured Reporter userid hash
ok 408 - dynamic live configuration requires an approved group but no preconfigured Reporter userid hash
  ---
  duration_ms: 7.0679
  type: 'test'
  ...
# Subtest: dynamic Sender rechecks the persisted approved-group Reporter before each PERSON provider call
ok 409 - dynamic Sender rechecks the persisted approved-group Reporter before each PERSON provider call
  ---
  duration_ms: 6.0368
  type: 'test'
  ...
# Subtest: approved test group discovers an unconfigured Reporter before their direct flow and outbound notice
ok 410 - approved test group discovers an unconfigured Reporter before their direct flow and outbound notice
  ---
  duration_ms: 3.0613
  type: 'test'
  ...
# Subtest: P2-012 migration 032 applies atomically, detects catalog drift and preserves seven-table scope
ok 411 - P2-012 migration 032 applies atomically, detects catalog drift and preserves seven-table scope
  ---
  duration_ms: 7460.1577
  type: 'test'
  ...
# Subtest: P2-012 fresh current baseline reaches 032 and repeated status/check/apply preserve the catalog
ok 412 - P2-012 fresh current baseline reaches 032 and repeated status/check/apply preserve the catalog
  ---
  duration_ms: 10655.9472
  type: 'test'
  ...
# Subtest: P2-012 network-off three-role assembly serves Incident and closes children, sockets and pools
ok 413 - P2-012 network-off three-role assembly serves Incident and closes children, sockets and pools
  ---
  duration_ms: 7581.0236
  type: 'test'
  ...
# {"network_enabled":false,"restarted":false,"metrics":{"process_count":3,"gateway_authenticated":0,"gateway_reconnect_total":0,"app_rss_bytes":85487616,"app_heap_used_bytes":20441472,"app_heap_total_bytes":33865728,"app_external_bytes":4566034,"app_cpu_percent":22.329,"app_event_loop_delay_p95_ms":31.817727,"app_active_resources":8,"app_active_timers":2,"app_active_sockets":6,"app_active_file_handles":0,"app_active_handles":6,"app_uptime_seconds":1.819,"app_pool_total":2,"app_pool_idle":2,"app_pool_waiting":0,"app_pool_max":4,"worker_rss_bytes":92278784,"worker_heap_used_bytes":18908416,"worker_heap_total_bytes":33341440,"worker_external_bytes":4475653,"worker_cpu_percent":24.912,"worker_event_loop_delay_p95_ms":32.079871,"worker_active_resources":4,"worker_active_timers":2,"worker_active_sockets":2,"worker_active_file_handles":0,"worker_active_handles":2,"worker_uptime_seconds":1.806,"worker_pool_total":1,"worker_pool_idle":1,"worker_pool_waiting":0,"worker_pool_max":2,"gateway_rss_bytes":80183296,"gateway_heap_used_bytes":12691696,"gateway_heap_total_bytes":31604736,"gateway_external_bytes":4206782,"gateway_cpu_percent":1.127,"gateway_event_loop_delay_p95_ms":32.014335,"gateway_active_resources":2,"gateway_active_timers":1,"gateway_active_sockets":1,"gateway_active_file_handles":0,"gateway_active_handles":1,"gateway_uptime_seconds":1.837,"gateway_pool_total":0,"gateway_pool_idle":0,"gateway_pool_waiting":0,"gateway_pool_max":1,"total_rss_bytes":257949696,"total_heap_used_bytes":52041584,"total_cpu_percent":48.368,"sse_clients":0,"projection_backlog":0,"projection_failures":0,"communication_pending":1,"dead_letter":0,"reconciliation_required":0,"postgres_active_connections":1,"postgres_idle_connections":4,"postgres_other_connections":0,"postgres_max_connections":100,"postgres_connection_utilization_percent":5}}
# {"network_enabled":false,"restarted":true,"metrics":{"process_count":3,"gateway_authenticated":0,"gateway_reconnect_total":0,"app_rss_bytes":83062784,"app_heap_used_bytes":15046104,"app_heap_total_bytes":32555008,"app_external_bytes":4334348,"app_cpu_percent":54.498,"app_event_loop_delay_p95_ms":31.735807,"app_active_resources":6,"app_active_timers":1,"app_active_sockets":5,"app_active_file_handles":0,"app_active_handles":5,"app_uptime_seconds":0.773,"app_pool_total":1,"app_pool_idle":1,"app_pool_waiting":0,"app_pool_max":4,"worker_rss_bytes":90066944,"worker_heap_used_bytes":13345688,"worker_heap_total_bytes":32653312,"worker_external_bytes":4206782,"worker_cpu_percent":30.141,"worker_event_loop_delay_p95_ms":32.358399,"worker_active_resources":2,"worker_active_timers":1,"worker_active_sockets":1,"worker_active_file_handles":0,"worker_active_handles":1,"worker_uptime_seconds":0.763,"worker_pool_total":0,"worker_pool_idle":0,"worker_pool_waiting":0,"worker_pool_max":2,"gateway_rss_bytes":80146432,"gateway_heap_used_bytes":12698776,"gateway_heap_total_bytes":31080448,"gateway_external_bytes":4206782,"gateway_cpu_percent":22.733,"gateway_event_loop_delay_p95_ms":31.703039,"gateway_active_resources":2,"gateway_active_timers":1,"gateway_active_sockets":1,"gateway_active_file_handles":0,"gateway_active_handles":1,"gateway_uptime_seconds":0.777,"gateway_pool_total":0,"gateway_pool_idle":0,"gateway_pool_waiting":0,"gateway_pool_max":1,"total_rss_bytes":253276160,"total_heap_used_bytes":41090568,"total_cpu_percent":107.372,"sse_clients":0,"projection_backlog":0,"projection_failures":0,"communication_pending":1,"dead_letter":0,"reconciliation_required":0,"postgres_active_connections":1,"postgres_idle_connections":3,"postgres_other_connections":0,"postgres_max_connections":100,"postgres_connection_utilization_percent":4}}
# Subtest: P2-012 Reporter HTTP preserves bound grants, refresh ETag, safe milestones and unlink visibility
ok 414 - P2-012 Reporter HTTP preserves bound grants, refresh ETag, safe milestones and unlink visibility
  ---
  duration_ms: 5363.938
  type: 'test'
  ...
# Subtest: P2-012 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
ok 415 - P2-012 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
  ---
  duration_ms: 6245.5045
  type: 'test'
  ...
# {"server_commit_response_lost":true,"restart_replayed":true,"incident_confirmed_event_count":1,"unknown_recovery_send_calls":0,"authorized_retry_calls":1,"ack_restart_send_calls":0}
# Subtest: P2-012 static authorization, frozen predecessors, scope, schemas and synthetic fixture gate
ok 416 - P2-012 static authorization, frozen predecessors, scope, schemas and synthetic fixture gate
  ---
  duration_ms: 4542.741
  type: 'test'
  ...
# Subtest: P2-012 live runner fails before network/listener unless all five independent fuses and verified evidence exist
ok 417 - P2-012 live runner fails before network/listener unless all five independent fuses and verified evidence exist
  ---
  duration_ms: 2.713
  type: 'test'
  ...
# Subtest: P2-012 readiness cannot be fabricated from partial regression, skips, changed inputs or live claims
ok 418 - P2-012 readiness cannot be fabricated from partial regression, skips, changed inputs or live claims
  ---
  duration_ms: 0.9091
  type: 'test'
  ...
# Subtest: P2-012 DONE requires the approved live candidate, client confirmation, clean Incident deliveries and complete regressions
ok 419 - P2-012 DONE requires the approved live candidate, client confirmation, clean Incident deliveries and complete regressions
  ---
  duration_ms: 0.4405
  type: 'test'
  ...
# Subtest: P2-012 frozen candidate permits only the explicit closeout governance set
ok 420 - P2-012 frozen candidate permits only the explicit closeout governance set
  ---
  duration_ms: 0.4107
  type: 'test'
  ...
# Subtest: P2-012 review hardening preserves exact paths and requires independent current regression evidence
ok 421 - P2-012 review hardening preserves exact paths and requires independent current regression evidence
  ---
  duration_ms: 0.3875
  type: 'test'
  ...
# Subtest: P2-012 incomplete persisted Candidate summary remains explicit and does not invent clustering evidence
ok 422 - P2-012 incomplete persisted Candidate summary remains explicit and does not invent clustering evidence
  ---
  duration_ms: 2.3084
  type: 'test'
  ...
# Subtest: P2-012 four scope permissions, authorization before replay, expiry maintenance and closed schemas
ok 423 - P2-012 four scope permissions, authorization before replay, expiry maintenance and closed schemas
  ---
  duration_ms: 3957.7568
  type: 'test'
  ...
# Subtest: P2-012 approved-group Reporter discovery persists before direct intake, Sender scope and database guard
ok 424 - P2-012 approved-group Reporter discovery persists before direct intake, Sender scope and database guard
  ---
  duration_ms: 2551.4958
  type: 'test'
  ...
# Subtest: P2-012 real direct-leg eligibility suppresses group-only Ticket artifacts and validates persisted destination scope
ok 425 - P2-012 real direct-leg eligibility suppresses group-only Ticket artifacts and validates persisted destination scope
  ---
  duration_ms: 2950.693
  type: 'test'
  ...
# Subtest: P2-012 cross-channel same reporter, pending activation, pause, unlink and reporter-safe history
ok 426 - P2-012 cross-channel same reporter, pending activation, pause, unlink and reporter-safe history
  ---
  duration_ms: 4848.8032
  type: 'test'
  ...
# Subtest: P2-012 fixed notices reuse sender, restart persistence, explicit UNKNOWN reconciliation and no blind resend
ok 427 - P2-012 fixed notices reuse sender, restart persistence, explicit UNKNOWN reconciliation and no blind resend
  ---
  duration_ms: 3490.5349
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 1440x900 human confirmation, refresh and accessibility
ok 428 - P2-012 database-backed browser 1440x900 human confirmation, refresh and accessibility
  ---
  duration_ms: 7902.8884
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 1366x768 human confirmation, refresh and accessibility
ok 429 - P2-012 database-backed browser 1366x768 human confirmation, refresh and accessibility
  ---
  duration_ms: 7540.5862
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 390x844 human confirmation, refresh and accessibility
ok 430 - P2-012 database-backed browser 390x844 human confirmation, refresh and accessibility
  ---
  duration_ms: 6917.8498
  type: 'test'
  ...
# Subtest: P2-012 actual HTTP inherits authentication, CSRF, command fence and durable realtime
ok 431 - P2-012 actual HTTP inherits authentication, CSRF, command fence and durable realtime
  ---
  duration_ms: 3600.3795
  type: 'test'
  ...
# Subtest: reporter identity is HMAC-bound and directory failures defer safely
ok 432 - reporter identity is HMAC-bound and directory failures defer safely
  ---
  duration_ms: 3.7176
  type: 'test'
  ...
# Subtest: direct association follows reliable priorities and never uses userid plus time
ok 433 - direct association follows reliable priorities and never uses userid plus time
  ---
  duration_ms: 2.4216
  type: 'test'
  ...
# Subtest: manual review internal query and resolve default deny before storage access
ok 434 - manual review internal query and resolve default deny before storage access
  ---
  duration_ms: 3.7407
  type: 'test'
  ...
# Subtest: migration 030 supports fresh baseline, check rollback, apply, no-op and five drift failures
ok 435 - migration 030 supports fresh baseline, check rollback, apply, no-op and five drift failures
  ---
  duration_ms: 4995.1564
  type: 'test'
  ...
# Subtest: orchestrator persists three entries, keeps threads separate and replays Ticket/Communication safely
ok 436 - orchestrator persists three entries, keeps threads separate and replays Ticket/Communication safely
  ---
  duration_ms: 3721.0237
  type: 'test'
  ...
# Subtest: rule failure reaches review; authorized keyset query and concurrent human resolution append one override
ok 437 - rule failure reaches review; authorized keyset query and concurrent human resolution append one override
  ---
  duration_ms: 3451.3458
  type: 'test'
  ...
# Subtest: continuation refs are hashed, reporter/bot bound, expiring, revocable and single-use
ok 438 - continuation refs are hashed, reporter/bot bound, expiring, revocable and single-use
  ---
  duration_ms: 2854.5738
  type: 'test'
  ...
# Subtest: migration 001 through 022 and P2-007 runtime are unchanged from origin/main
ok 439 - migration 001 through 022 and P2-007 runtime are unchanged from origin/main
  ---
  duration_ms: 64.378
  type: 'test'
  ...
# Subtest: strict feature flags default false and reject non-canonical values
ok 440 - strict feature flags default false and reject non-canonical values
  ---
  duration_ms: 2.5204
  type: 'test'
  ...
# Subtest: ordinary JSON boundary rejects proxy, accessor, symbol, toJSON, cycles and pollution keys
ok 441 - ordinary JSON boundary rejects proxy, accessor, symbol, toJSON, cycles and pollution keys
  ---
  duration_ms: 0.4796
  type: 'test'
  ...
# Subtest: router protects faults from acknowledgement and maps required examples
ok 442 - router protects faults from acknowledgement and maps required examples
  ---
  duration_ms: 65.0731
  type: 'test'
  ...
# Subtest: ten result codes are reachable and deterministic
ok 443 - ten result codes are reachable and deterministic
  ---
  duration_ms: 90.3677
  type: 'test'
  ...
# Subtest: clinical high risk reaches review and unsupported root cause is never confirmed
ok 444 - clinical high risk reaches review and unsupported root cause is never confirmed
  ---
  duration_ms: 35.3523
  type: 'test'
  ...
# Subtest: gold manifest references all 96 + 42 + 64 frozen cases with ten routes
ok 445 - gold manifest references all 96 + 42 + 64 frozen cases with ten routes
  ---
  duration_ms: 2.4698
  type: 'test'
  ...
# Subtest: crash before commit leaves no partial facts; crash after commit restarts as replay
ok 446 - crash before commit leaves no partial facts; crash after commit restarts as replay
  ---
  duration_ms: 3755.9061
  type: 'test'
  ...
# {"crash_before_commit_partial_facts":{"journeys":0,"decisions":0,"tickets":0},"crash_after_commit":{"journeys":1,"decisions":1,"tickets":1},"restart_processed":0,"replay_duplicate_delta":0}
# Subtest: bounded worker processes 500 journeys, 2000 turns, 500 decisions and 100 reviews on one worker
ok 447 - bounded worker processes 500 journeys, 2000 turns, 500 decisions and 100 reviews on one worker
  ---
  duration_ms: 18087.0428
  type: 'test'
  ...
# {"journeys":500,"turns":2000,"decisions":500,"reviews":100,"worker_count":1,"pool_max":4,"batch_max":100,"heap_samples_bytes":[16546416,18100280,15147320,34989384,25765272,11514344],"heap_fall_or_stable":true,"timer_active_after_stop":false,"soak_24h":false}
# Subtest: worker defaults are bounded and disabled flags claim nothing
ok 448 - worker defaults are bounded and disabled flags claim nothing
  ---
  duration_ms: 3.4811
  type: 'test'
  ...
# Subtest: worker rejects batches above maximum without querying storage
ok 449 - worker rejects batches above maximum without querying storage
  ---
  duration_ms: 1.2381
  type: 'test'
  ...
# Subtest: P2-016 bounded capacity: 500 Tickets / 5000 events / 200 review resolutions / 500 cards / 100 sessions / 32 SSE
ok 450 - P2-016 bounded capacity: 500 Tickets / 5000 events / 200 review resolutions / 500 cards / 100 sessions / 32 SSE
  ---
  duration_ms: 115718.1515
  type: 'test'
  ...
# {"tickets":500,"ticket_events":5000,"review_resolutions":200,"cards":500,"group_receipts":400,"reporter_sessions":100,"pool_max":4,"sse_max":32,"sse_after_stop":0,"heap_samples_bytes":[14760920,32318712,43829848,55043392,40382624,76391056,42221168,38381920,23648264,45445944,26297160,48022656,27708136,49430576,29635408,51129576,31266632,52760328,27975672,44869544,15977528,17807184,18835656,20576104,21479840,22733656,17325416,18711016,53617872,35167000],"heap_peak_bytes":76391056,"heap_final_bytes":35167000,"heap_fall_or_stable":true,"real_sdk_calls":0,"soak_24h":false}
# {"cleanup":{"database_count":0,"backend_count":0}}
# Subtest: P2-016 plain JSON excludes active objects without invoking user hooks
ok 451 - P2-016 plain JSON excludes active objects without invoking user hooks
  ---
  duration_ms: 4.1706
  type: 'test'
  ...
# Subtest: P2-016 strict command, versions, closed keys and bounded lists
ok 452 - P2-016 strict command, versions, closed keys and bounded lists
  ---
  duration_ms: 2.9174
  type: 'test'
  ...
# Subtest: notification policy includes created
ok 453 - notification policy includes created
  ---
  duration_ms: 0.3147
  type: 'test'
  ...
# Subtest: notification policy includes accepted
ok 454 - notification policy includes accepted
  ---
  duration_ms: 0.1594
  type: 'test'
  ...
# Subtest: notification policy includes started
ok 455 - notification policy includes started
  ---
  duration_ms: 0.1329
  type: 'test'
  ...
# Subtest: notification policy includes resumed
ok 456 - notification policy includes resumed
  ---
  duration_ms: 0.1542
  type: 'test'
  ...
# Subtest: notification policy includes waiting_requester
ok 457 - notification policy includes waiting_requester
  ---
  duration_ms: 0.1335
  type: 'test'
  ...
# Subtest: notification policy includes waiting_vendor
ok 458 - notification policy includes waiting_vendor
  ---
  duration_ms: 0.1246
  type: 'test'
  ...
# Subtest: notification policy includes resolved
ok 459 - notification policy includes resolved
  ---
  duration_ms: 0.1565
  type: 'test'
  ...
# Subtest: notification policy includes closed
ok 460 - notification policy includes closed
  ---
  duration_ms: 0.3163
  type: 'test'
  ...
# Subtest: notification policy includes reopened
ok 461 - notification policy includes reopened
  ---
  duration_ms: 0.2039
  type: 'test'
  ...
# Subtest: notification policy includes cancelled
ok 462 - notification policy includes cancelled
  ---
  duration_ms: 0.2861
  type: 'test'
  ...
# Subtest: notes and assignment changes never become external free-text notifications
ok 463 - notes and assignment changes never become external free-text notifications
  ---
  duration_ms: 0.573
  type: 'test'
  ...
# Subtest: template card exact shape, last-four and safe immutable view
ok 464 - template card exact shape, last-four and safe immutable view
  ---
  duration_ms: 1.8332
  type: 'test'
  ...
# Subtest: card rejects unsafe origin javascript:alert(1)
ok 465 - card rejects unsafe origin javascript:alert(1)
  ---
  duration_ms: 0.3113
  type: 'test'
  ...
# Subtest: card rejects unsafe origin data:text/html,x
ok 466 - card rejects unsafe origin data:text/html,x
  ---
  duration_ms: 0.1672
  type: 'test'
  ...
# Subtest: card rejects unsafe origin file:///x
ok 467 - card rejects unsafe origin file:///x
  ---
  duration_ms: 0.111
  type: 'test'
  ...
# Subtest: card rejects unsafe origin http://reporter.example.test
ok 468 - card rejects unsafe origin http://reporter.example.test
  ---
  duration_ms: 0.1031
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://attacker.invalid
ok 469 - card rejects unsafe origin https://attacker.invalid
  ---
  duration_ms: 0.448
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://[userinfo]@reporter.example.test
ok 470 - card rejects unsafe origin https://[userinfo]@reporter.example.test
  ---
  duration_ms: 0.1023
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://reporter.example.test/?grant=abc
ok 471 - card rejects unsafe origin https://reporter.example.test/?grant=abc
  ---
  duration_ms: 0.0824
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://reporter.example.test/\#x
ok 472 - card rejects unsafe origin https://reporter.example.test/\#x
  ---
  duration_ms: 0.0824
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://reporter.example.test/path
ok 473 - card rejects unsafe origin https://reporter.example.test/path
  ---
  duration_ms: 0.0689
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":0}
ok 474 - sender accepts only explicit numeric ACK {"errcode":0}
  ---
  duration_ms: 1.6655
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"body":{"errcode":0}}
ok 475 - sender accepts only explicit numeric ACK {"body":{"errcode":0}}
  ---
  duration_ms: 0.5151
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {}
ok 476 - sender accepts only explicit numeric ACK {}
  ---
  duration_ms: 0.4363
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":"0"}
ok 477 - sender accepts only explicit numeric ACK {"errcode":"0"}
  ---
  duration_ms: 1.262
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":null}
ok 478 - sender accepts only explicit numeric ACK {"errcode":null}
  ---
  duration_ms: 0.3993
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":40001}
ok 479 - sender accepts only explicit numeric ACK {"errcode":40001}
  ---
  duration_ms: 0.4265
  type: 'test'
  ...
# Subtest: sender fail-closed {"enabled":false}
ok 480 - sender fail-closed {"enabled":false}
  ---
  duration_ms: 0.1987
  type: 'test'
  ...
# Subtest: sender fail-closed {"cardEnabled":false}
ok 481 - sender fail-closed {"cardEnabled":false}
  ---
  duration_ms: 0.1107
  type: 'test'
  ...
# Subtest: sender fail-closed {"target":"not-allowlisted"}
ok 482 - sender fail-closed {"target":"not-allowlisted"}
  ---
  duration_ms: 0.1884
  type: 'test'
  ...
# Subtest: sender fail-closed {"binding":false}
ok 483 - sender fail-closed {"binding":false}
  ---
  duration_ms: 0.2322
  type: 'test'
  ...
# Subtest: gateway unavailable before network is retry-safe, no SDK call
ok 484 - gateway unavailable before network is retry-safe, no SDK call
  ---
  duration_ms: 0.7271
  type: 'test'
  ...
# Subtest: live inbound is clipped before persistence by approved bot, person and group hashes
ok 485 - live inbound is clipped before persistence by approved bot, person and group hashes
  ---
  duration_ms: 1.0211
  type: 'test'
  ...
# Subtest: Ticket delivery operator commands authorize before receipt, persist idempotence and never blindly retry UNKNOWN
ok 486 - Ticket delivery operator commands authorize before receipt, persist idempotence and never blindly retry UNKNOWN
  ---
  duration_ms: 2522.8091
  type: 'test'
  ...
# Subtest: P2-016 real-format group wakeup and direct description remain one Journey through public queries
ok 487 - P2-016 real-format group wakeup and direct description remain one Journey through public queries
  ---
  duration_ms: 2226.1062
  type: 'test'
  ...
# Subtest: P2-016 group-to-direct unique binding preserves Journey; ambiguous, consumed and expired candidates never guess
ok 488 - P2-016 group-to-direct unique binding preserves Journey; ambiguous, consumed and expired candidates never guess
  ---
  duration_ms: 11713.0169
  type: 'test'
  ...
# Subtest: P2-016 later same-group description preserves the recorded entry mode instead of rejecting the Journey
ok 489 - P2-016 later same-group description preserves the recorded entry mode instead of rejecting the Journey
  ---
  duration_ms: 2081.4214
  type: 'test'
  ...
# Subtest: P2-016 approved topology uses three real bounded processes, rule-first Worker and zero live SDK calls
ok 490 - P2-016 approved topology uses three real bounded processes, rule-first Worker and zero live SDK calls
  ---
  duration_ms: 3841.214
  type: 'test'
  ...
# {"process_count":3,"pool_max":7,"live_provider_calls":0,"rule_first_worker":true}
# Subtest: P2-016 live harness requires exact owner fuses and HTTPS bounded configuration, without logging secrets
ok 491 - P2-016 live harness requires exact owner fuses and HTTPS bounded configuration, without logging secrets
  ---
  duration_ms: 3.4205
  type: 'test'
  ...
# Subtest: P2-016 live requires an exact verified candidate and at least 15 minutes; cannot claim final completion
ok 492 - P2-016 live requires an exact verified candidate and at least 15 minutes; cannot claim final completion
  ---
  duration_ms: 0.6942
  type: 'test'
  ...
# Subtest: P2-016 live CLI with no approvals exits before DB, listener, Evidence or SDK work
ok 493 - P2-016 live CLI with no approvals exits before DB, listener, Evidence or SDK work
  ---
  duration_ms: 214.6633
  type: 'test'
  ...
# Subtest: P2-016 review resolution and Safe Action commit or roll back together
ok 494 - P2-016 review resolution and Safe Action commit or roll back together
  ---
  duration_ms: 1810.4977
  type: 'test'
  ...
# Subtest: P2-016 migration is atomic, check-only, exact, reentrant and drift-failing
    # Subtest: rejects table drift
    ok 1 - rejects table drift
      ---
      duration_ms: 31.7562
      type: 'test'
      ...
    # Subtest: rejects column drift
    ok 2 - rejects column drift
      ---
      duration_ms: 18.4266
      type: 'test'
      ...
    # Subtest: rejects type drift
    ok 3 - rejects type drift
      ---
      duration_ms: 26.1784
      type: 'test'
      ...
    # Subtest: rejects default drift
    ok 4 - rejects default drift
      ---
      duration_ms: 17.5506
      type: 'test'
      ...
    # Subtest: rejects constraint drift
    ok 5 - rejects constraint drift
      ---
      duration_ms: 16.5003
      type: 'test'
      ...
    # Subtest: rejects index drift
    ok 6 - rejects index drift
      ---
      duration_ms: 16.5795
      type: 'test'
      ...
    # Subtest: rejects foreign_key drift
    ok 7 - rejects foreign_key drift
      ---
      duration_ms: 16.8047
      type: 'test'
      ...
    1..7
ok 495 - P2-016 migration is atomic, check-only, exact, reentrant and drift-failing
  ---
  duration_ms: 2291.0263
  type: 'test'
  ...
# Subtest: P2-016 persisted card delivery, HMAC grants, one-use sessions and reporter-safe timeline
ok 496 - P2-016 persisted card delivery, HMAC grants, one-use sessions and reporter-safe timeline
  ---
  duration_ms: 1610.4458
  type: 'test'
  ...
# Subtest: P2-016 existing rule worker creates Ticket notifications, safe group/direct guidance and SYSTEM-only timeout closure
ok 497 - P2-016 existing rule worker creates Ticket notifications, safe group/direct guidance and SYSTEM-only timeout closure
  ---
  duration_ms: 2227.1529
  type: 'test'
  ...
# Subtest: Reporter browser 1440x900 real DB/session, fragment removal, refresh, timezone, safe data and logout
ok 498 - Reporter browser 1440x900 real DB/session, fragment removal, refresh, timezone, safe data and logout
  ---
  duration_ms: 4931.4065
  type: 'test'
  ...
# Subtest: Reporter browser 390x844 real DB/session, fragment removal, refresh, timezone, safe data and logout
ok 499 - Reporter browser 390x844 real DB/session, fragment removal, refresh, timezone, safe data and logout
  ---
  duration_ms: 4170.9269
  type: 'test'
  ...
# Subtest: Reporter grant expiry, HMAC rotation, one-consume concurrency, session expiry/revocation and cross-ticket isolation
ok 500 - Reporter grant expiry, HMAC rotation, one-consume concurrency, session expiry/revocation and cross-ticket isolation
  ---
  duration_ms: 1856.664
  type: 'test'
  ...
# Subtest: P2-016 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
ok 501 - P2-016 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
  ---
  duration_ms: 4689.1625
  type: 'test'
  ...
# {"server_commit_response_lost":true,"restart_replayed":true,"ticket_event_count":1,"unknown_recovery_send_calls":0,"authorized_retry_calls":1,"ack_restart_send_calls":0}
# Subtest: P2-016 architecture guards preserve authorization, immutable baselines and closed contracts
ok 502 - P2-016 architecture guards preserve authorization, immutable baselines and closed contracts
  ---
  duration_ms: 2586.3024
  type: 'test'
  ...
# Subtest: P2-016 default validator still requires readiness Evidence; deferred source checks cannot authorize live work
ok 503 - P2-016 default validator still requires readiness Evidence; deferred source checks cannot authorize live work
  ---
  duration_ms: 2088.589
  type: 'test'
  ...
# Subtest: P2-016 schemas and declarations exist; Reporter outputs cannot contain internal identity or credentials
ok 504 - P2-016 schemas and declarations exist; Reporter outputs cannot contain internal identity or credentials
  ---
  duration_ms: 25.354
  type: 'test'
  ...
# Subtest: JSON contract rejects extra keys, noncanonical types and offset time
ok 505 - JSON contract rejects extra keys, noncanonical types and offset time
  ---
  duration_ms: 5.5546
  type: 'test'
  ...
# Subtest: P2-016 closeout freezes every business input and the exact file set
ok 506 - P2-016 closeout freezes every business input and the exact file set
  ---
  duration_ms: 0.2974
  type: 'test'
  ...
# Subtest: P2-016 completion requires owner approval, precise candidates, live duration and zero-skip final regression
ok 507 - P2-016 completion requires owner approval, precise candidates, live duration and zero-skip final regression
  ---
  duration_ms: 0.5048
  type: 'test'
  ...
# Subtest: Real DB internal browser traverses every user lifecycle action, transfer and atomic takeover/accept
ok 508 - Real DB internal browser traverses every user lifecycle action, transfer and atomic takeover/accept
  ---
  duration_ms: 7291.9705
  type: 'test'
  ...
# Subtest: P2-016 Ticket lifecycle, command persistence, authorization and independent responsibility
ok 509 - P2-016 Ticket lifecycle, command persistence, authorization and independent responsibility
  ---
  duration_ms: 3805.6051
  type: 'test'
  ...
# Subtest: P2-016 native browser 1440x900 command, review, refresh, SSE, polling, XSS and auth-expiry
ok 510 - P2-016 native browser 1440x900 command, review, refresh, SSE, polling, XSS and auth-expiry
  ---
  duration_ms: 6997.0306
  type: 'test'
  ...
# Subtest: P2-016 native browser 390x844 command, review, refresh, SSE, polling, XSS and auth-expiry
ok 511 - P2-016 native browser 390x844 command, review, refresh, SSE, polling, XSS and auth-expiry
  ---
  duration_ms: 7071.1786
  type: 'test'
  ...
# Subtest: confirmation survives realtime refetch and rejects a stale version instead of overwriting the form
ok 512 - confirmation survives realtime refetch and rejects a stale version instead of overwriting the form
  ---
  duration_ms: 1826.6462
  type: 'test'
  ...
# Subtest: P2-016 actual HTTP assembly: fail-closed flags, auth, CSRF, Ticket actions and durable SSE
ok 513 - P2-016 actual HTTP assembly: fail-closed flags, auth, CSRF, Ticket actions and durable SSE
  ---
  duration_ms: 2875.8166
  type: 'test'
  ...
# Subtest: P2-G1 system browser duplicate submit fence sends one human reply and preserves safe rendering
ok 514 - P2-G1 system browser duplicate submit fence sends one human reply and preserves safe rendering
  ---
  duration_ms: 1943.2507
  type: 'test'
  ...
# {"browser":"C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe","viewport":{"width":390,"height":844},"replay_events":100,"realtime_list_calls":3,"duplicate_submit_calls":1,"polling_fallback":true,"xss_executed":false,"horizontal_overflow":false}
# Subtest: P2-G1 system browser preserves native SSE reconnect and sends Last-Event-ID
ok 515 - P2-G1 system browser preserves native SSE reconnect and sends Last-Event-ID
  ---
  duration_ms: 5440.2367
  type: 'test'
  ...
# {"sse_connections":2,"last_event_id_used":true,"polling_stopped_after_reconnect":true}
# Subtest: P2-G1 live browser sessions navigate to the actual Workbench route with isolated cookies
ok 516 - P2-G1 live browser sessions navigate to the actual Workbench route with isolated cookies
  ---
  duration_ms: 5356.4893
  type: 'test'
  ...
# {"browser_sessions":2,"workbench_route_requests":2,"isolated_cookie_headers":true,"root_not_requested":true,"safe_telemetry":true}
# Subtest: P2-G1 P1 commit, durable projection recovery, duplicate idempotency, participant isolation and catalog invariance
ok 517 - P2-G1 P1 commit, durable projection recovery, duplicate idempotency, participant isolation and catalog invariance
  ---
  duration_ms: 9474.5901
  type: 'test'
  ...
# {"tickets":3,"duplicate_ticket_delta":0,"duplicate_item_delta":0,"participant_sessions":3,"first_versions":[1,1],"next_versions":[2,2],"p1_survived_projection_failure":true,"recovery_backlog":0,"catalog_unchanged":true}
# Subtest: P2-G1 different Intake atomically ends the prior participant Session before opening the next
ok 518 - P2-G1 different Intake atomically ends the prior participant Session before opening the next
  ---
  duration_ms: 8840.8096
  type: 'test'
  ...
# {"different_intake_sessions":2,"prior_ended":1,"active_sessions":1,"active_versions":[1,1],"projection_failures":0}
# Subtest: P2-G1 fault paths serialize takeover, isolate internal note, deduplicate reply and recover delivery without blind resend
ok 519 - P2-G1 fault paths serialize takeover, isolate internal note, deduplicate reply and recover delivery without blind resend
  ---
  duration_ms: 3094.9302
  type: 'test'
  ...
# {"concurrent_takeover_winners":1,"internal_note":{"message":1,"outbox":0,"delivery":0},"duplicate_reply_parallel":12,"reply":{"messages":1,"outboxes":1,"deliveries":1},"gateway_unavailable_pending":true,"reconnect_provider_calls":1,"unknown_reconciliation":true,"ai_calls":0,"ocr_calls":0}
# Subtest: P2-G1 local runtime binds one loopback App and reports human-only readiness with strict Test Auth
ok 520 - P2-G1 local runtime binds one loopback App and reports human-only readiness with strict Test Auth
  ---
  duration_ms: 2977.6934
  type: 'test'
  ...
# {"app_processes":1,"loopback_http":true,"readiness":true,"gateway_required":false,"active_gateway_count":0,"projection_batch":20,"communication_batch":20,"communication_sender":"MOCK","sse_client_cap":32,"dynamic_realtime_authorization":true,"test_auth_http_only":true,"human_only":true}
# Subtest: P2-G1 process cluster runs App, Worker and Gateway in three bounded Node processes
ok 521 - P2-G1 process cluster runs App, Worker and Gateway in three bounded Node processes
  ---
  duration_ms: 4233.2438
  type: 'test'
  ...
# {"process_count":3,"app_pool_max":4,"worker_pool_max":2,"gateway_pool_max":1,"combined_runtime":false,"raw_identifiers_recorded":false}
# Subtest: P2-G1 isolated PostgreSQL Replay Gap drives real Edge through Last-Event-ID, 410 and refetch
ok 522 - P2-G1 isolated PostgreSQL Replay Gap drives real Edge through Last-Event-ID, 410 and refetch
  ---
  duration_ms: 18424.6141
  type: 'test'
  ...
# {"http_status":410,"last_event_id":true,"refetch":["LIST","DETAIL","TIMELINE"],"process_count":3,"isolated_database_cleanup":true}
# Subtest: P2-G1 bounded capacity projects 1000 synthetic inbound facts and drains 500 deliveries with no catalog drift
ok 523 - P2-G1 bounded capacity projects 1000 synthetic inbound facts and drains 500 deliveries with no catalog drift
  ---
  duration_ms: 56654.7214
  type: 'test'
  ...
# {"synthetic_inbound":1000,"projected":1000,"delivery_backlog":500,"delivery_sent":500,"sender_calls":500,"projector_batch":20,"delivery_batch":20,"pool_max":4,"catalog_unchanged":true,"oom":0,"soak_24h":false}
# Subtest: live CLI exposes only the six explicit modes and requires three process fuses for sending
ok 524 - live CLI exposes only the six explicit modes and requires three process fuses for sending
  ---
  duration_ms: 2.1934
  type: 'test'
  ...
# Subtest: gateway process can commit inbound before the App process projects it
ok 525 - gateway process can commit inbound before the App process projects it
  ---
  duration_ms: 1.3933
  type: 'test'
  ...
# Subtest: process resource interface exposes bounded role metrics without a PID or environment
ok 526 - process resource interface exposes bounded role metrics without a PID or environment
  ---
  duration_ms: 0.9833
  type: 'test'
  ...
# Subtest: gateway permits one active WSClient, gates readiness on authentication, reconnects and shuts down cleanly
ok 527 - gateway permits one active WSClient, gates readiness on authentication, reconnects and shuts down cleanly
  ---
  duration_ms: 3.4693
  type: 'test'
  ...
# Subtest: sender enforces persistent target hash allowlist and maps ACK, explicit rejection, unknown and gateway-unavailable safely
ok 528 - sender enforces persistent target hash allowlist and maps ACK, explicit rejection, unknown and gateway-unavailable safely
  ---
  duration_ms: 1.5864
  type: 'test'
  ...
# Subtest: test authentication is server-configured, active non-reporter only, short-lived and emits strict HttpOnly cookie metadata
ok 529 - test authentication is server-configured, active non-reporter only, short-lived and emits strict HttpOnly cookie metadata
  ---
  duration_ms: 1.1177
  type: 'test'
  ...
# Subtest: test authentication isolates two configured principals with independent short-lived cookies and CSRF values
ok 530 - test authentication isolates two configured principals with independent short-lived cookies and CSRF values
  ---
  duration_ms: 0.7716
  type: 'test'
  ...
# Subtest: live harness requires two distinct configured principals and creates a safe unique run id
ok 531 - live harness requires two distinct configured principals and creates a safe unique run id
  ---
  duration_ms: 0.3395
  type: 'test'
  ...
# Subtest: disabled coordinator performs no database work and batch/stream inventory are bounded
ok 532 - disabled coordinator performs no database work and batch/stream inventory are bounded
  ---
  duration_ms: 0.3897
  type: 'test'
  ...
# Subtest: temporary database failure is isolated behind stable projection errors without raw details or false success
ok 533 - temporary database failure is isolated behind stable projection errors without raw details or false success
  ---
  duration_ms: 0.6777
  type: 'test'
  ...
# Subtest: P2-002 transaction hook is optional and P2-G1 browser source has an in-flight duplicate-submit fence
ok 534 - P2-002 transaction hook is optional and P2-G1 browser source has an in-flight duplicate-submit fence
  ---
  duration_ms: 2.8444
  type: 'test'
  ...
# Subtest: live script has no broad --live mode and no default live-send npm command
ok 535 - live script has no broad --live mode and no default live-send npm command
  ---
  duration_ms: 2.9949
  type: 'test'
  ...
# Subtest: shared pg factory preserves date/time/timestamp/timestamptz/tsrange/BIGINT strings and JSON objects
ok 536 - shared pg factory preserves date/time/timestamp/timestamptz/tsrange/BIGINT strings and JSON objects
  ---
  duration_ms: 53.1074
  type: 'test'
  ...
# Subtest: shared pg factory rejects Date recursively before sending SQL
ok 537 - shared pg factory rejects Date recursively before sending SQL
  ---
  duration_ms: 35.607
  type: 'test'
  ...
# Subtest: LocalDate, LocalTime, and LocalDateTime accept real Asia/Shanghai calendar values
ok 538 - LocalDate, LocalTime, and LocalDateTime accept real Asia/Shanghai calendar values
  ---
  duration_ms: 1.1109
  type: 'test'
  ...
# Subtest: LocalDateTime rejects invalid dates, T/Z/UTC/offset/IANA, fractions, whitespace, and objects
ok 539 - LocalDateTime rejects invalid dates, T/Z/UTC/offset/IANA, fractions, whitespace, and objects
  ---
  duration_ms: 1.4047
  type: 'test'
  ...
# Subtest: PhysicalEpochMs remains a canonical non-negative decimal string and round-trips Shanghai local seconds
ok 540 - PhysicalEpochMs remains a canonical non-negative decimal string and round-trips Shanghai local seconds
  ---
  duration_ms: 0.5743
  type: 'test'
  ...
# Subtest: explicit Asia/Shanghai formatter is invariant under UTC, Tokyo, and New York process TZ
ok 541 - explicit Asia/Shanghai formatter is invariant under UTC, Tokyo, and New York process TZ
  ---
  duration_ms: 233.6817
  type: 'test'
  ...
# Subtest: V1.3 compatibility command delegates to active V1.4 validation
ok 542 - V1.3 compatibility command delegates to active V1.4 validation
  ---
  duration_ms: 108.0555
  type: 'test'
  ...
# Subtest: V1.4 architecture validator passes
ok 543 - V1.4 architecture validator passes
  ---
  duration_ms: 106.8935
  type: 'test'
  ...
# Subtest: P2/P2-G1 lifecycle state is internally consistent without changing P1
ok 544 - P2/P2-G1 lifecycle state is internally consistent without changing P1
  ---
  duration_ms: 4.5696
  type: 'test'
  ...
# Subtest: P2-004 independent authorization and stop line are preserved
ok 545 - P2-004 independent authorization and stop line are preserved
  ---
  duration_ms: 1.1595
  type: 'test'
  ...
# Subtest: P2-005 independent authorization and stop line are recorded
ok 546 - P2-005 independent authorization and stop line are recorded
  ---
  duration_ms: 0.9809
  type: 'test'
  ...
# Subtest: P2-006 independent authorization and stop line are recorded
ok 547 - P2-006 independent authorization and stop line are recorded
  ---
  duration_ms: 0.7374
  type: 'test'
  ...
# Subtest: P2-004 completion artifacts preserve P1 notification and Ticket ownership
ok 548 - P2-004 completion artifacts preserve P1 notification and Ticket ownership
  ---
  duration_ms: 2.8971
  type: 'test'
  ...
# Subtest: P2-005 completion artifacts preserve frozen Session and identity ownership
ok 549 - P2-005 completion artifacts preserve frozen Session and identity ownership
  ---
  duration_ms: 0.3645
  type: 'test'
  ...
# Subtest: P2-006 completion has a runnable workbench and no migration 022
ok 550 - P2-006 completion has a runnable workbench and no migration 022
  ---
  duration_ms: 0.8559
  type: 'test'
  ...
# Subtest: P2-001 and P2-002 frozen artifacts remain present
ok 551 - P2-001 and P2-002 frozen artifacts remain present
  ---
  duration_ms: 0.6809
  type: 'test'
  ...
# Subtest: P3 remains greenfield and contains no historical ticket program
ok 552 - P3 remains greenfield and contains no historical ticket program
  ---
  duration_ms: 2.8923
  type: 'test'
  ...
# Subtest: future flags default off without legacy import flags
ok 553 - future flags default off without legacy import flags
  ---
  duration_ms: 1.2218
  type: 'test'
  ...
# Subtest: conceptual schema has no historical migration fields or second ticket core
ok 554 - conceptual schema has no historical migration fields or second ticket core
  ---
  duration_ms: 0.5647
  type: 'test'
  ...
# Subtest: new source example is non-authoritative
ok 555 - new source example is non-authoritative
  ---
  duration_ms: 0.9162
  type: 'test'
  ...
# Subtest: 2C4G limits remain conservative
ok 556 - 2C4G limits remain conservative
  ---
  duration_ms: 1.1154
  type: 'test'
  ...
# Subtest: P2-016 authorization reconciles only the historical P2-015 ledger
ok 557 - P2-016 authorization reconciles only the historical P2-015 ledger
  ---
  duration_ms: 2.422
  type: 'test'
  ...
# Subtest: architecture validator rejects the historical P2-015 ledger drift
ok 558 - architecture validator rejects the historical P2-015 ledger drift
  ---
  duration_ms: 22.5439
  type: 'test'
  ...
# Subtest: P2-012 authorization rejects premature completion and next-gate authorization
ok 559 - P2-012 authorization rejects premature completion and next-gate authorization
  ---
  duration_ms: 0.419
  type: 'test'
  ...
1..559
# tests 566
# suites 0
# pass 565
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 926051.2244
````

</details>

<details>
<summary>capacity-diagnostic.tap — raw SHA-256 ee860ca92d52d93e77727bc2c329d8604301e321d684435e8f7648fb91ba1e1d</summary>

````tap
TAP version 13
# Subtest: P2-012 real command capacity 500 candidates, 200 incidents, 2000 reports, 1000 subscriptions, 5000 events, 500 bindings and 32 SSE
ok 1 - P2-012 real command capacity 500 candidates, 200 incidents, 2000 reports, 1000 subscriptions, 5000 events, 500 bindings and 32 SSE
  ---
  duration_ms: 40441.3301
  type: 'test'
  ...
# {"candidates":500,"incidents":200,"reports":2000,"subscriptions":1000,"events":5200,"bindings":550,"notification_sent":550,"pool_max":4,"sse_max":32,"sse_after_stop":0,"heap_samples_bytes":[15137648,27302808,68707912,30590016,39807816,60718680,27940704,48134400,68528784,35721256,55832944,28256936,30562168],"heap_peak_bytes":68707912,"heap_final_bytes":30562168,"real_sdk_calls":0,"model_calls":0}
# {"cleanup":{"database_count":0,"backend_count":0}}
1..1
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 40723.0928
````

</details>

<details>
<summary>full-regression-final.tap — raw SHA-256 c947f884790059fdaa9db90a2672ff1f73e2b67c4b408c88556fc49b0b2f8319</summary>

````tap
TAP version 13
# Subtest: ARCH-005 architecture validator freezes migrations and reports all hard static counts at zero
ok 1 - ARCH-005 architecture validator freezes migrations and reports all hard static counts at zero
  ---
  duration_ms: 124.2232
  type: 'test'
  ...
# Subtest: P2-007 and its authorized P2-015 successor keep the frozen ARCH-005 contract
ok 2 - P2-007 and its authorized P2-015 successor keep the frozen ARCH-005 contract
  ---
  duration_ms: 2.1257
  type: 'test'
  ...
# Subtest: existing 001-021 database passes 022 check rollback, apply, forbidden-zero, and repeat no-op
ok 3 - existing 001-021 database passes 022 check rollback, apply, forbidden-zero, and repeat no-op
  ---
  duration_ms: 2713.9553
  type: 'test'
  ...
# Subtest: fresh database executes 001-021-022 through the current-baseline entrypoint
ok 4 - fresh database executes 001-021-022 through the current-baseline entrypoint
  ---
  duration_ms: 1675.5528
  type: 'test'
  ...
# Subtest: ARCH-006 validator passes
ok 5 - ARCH-006 validator passes
  ---
  duration_ms: 144.8798
  type: 'test'
  ...
# Subtest: machine state preserves ARCH-006 facts and separately authorized P2-015/P2-016 successor lifecycles
ok 6 - machine state preserves ARCH-006 facts and separately authorized P2-015/P2-016 successor lifecycles
  ---
  duration_ms: 1.1367
  type: 'test'
  ...
# Subtest: ten safe deterministic results are first-class and Manual Review is valid
ok 7 - ten safe deterministic results are first-class and Manual Review is valid
  ---
  duration_ms: 1.0331
  type: 'test'
  ...
# Subtest: Ticket lifecycle reuses authoritative actions and reliable notification boundary
ok 8 - Ticket lifecycle reuses authoritative actions and reliable notification boundary
  ---
  duration_ms: 0.9476
  type: 'test'
  ...
# Subtest: Incident remains human-confirmed and AI-independent
ok 9 - Incident remains human-confirmed and AI-independent
  ---
  duration_ms: 0.2915
  type: 'test'
  ...
# Subtest: AI-off readiness and feature flags are closed by default
ok 10 - AI-off readiness and feature flags are closed by default
  ---
  duration_ms: 1.3426
  type: 'test'
  ...
# Subtest: configuration preserves G0 boundaries and substitutes only the invalid test secret
ok 11 - configuration preserves G0 boundaries and substitutes only the invalid test secret
  ---
  duration_ms: 0.9829
  type: 'test'
  ...
# Subtest: redaction and error mapping do not expose a configured secret
ok 12 - redaction and error mapping do not expose a configured secret
  ---
  duration_ms: 0.4573
  type: 'test'
  ...
# Subtest: the connection stability window is bounded and explicit
ok 13 - the connection stability window is bounded and explicit
  ---
  duration_ms: 0.2419
  type: 'test'
  ...
# Subtest: authenticated probe starts shutdown by SIGTERM and calls disconnect before completion
ok 14 - authenticated probe starts shutdown by SIGTERM and calls disconnect before completion
  ---
  duration_ms: 3.0224
  type: 'test'
  ...
# Subtest: text frame capture records only the permitted, desensitized shape
ok 15 - text frame capture records only the permitted, desensitized shape
  ---
  duration_ms: 1.5515
  type: 'test'
  ...
# Subtest: capture arguments require a named scenario and an evidence jsonl target
ok 16 - capture arguments require a named scenario and an evidence jsonl target
  ---
  duration_ms: 0.5406
  type: 'test'
  ...
# Subtest: media capture records only desensitized frame, download, and filename metadata
ok 17 - media capture records only desensitized frame, download, and filename metadata
  ---
  duration_ms: 2.5597
  type: 'test'
  ...
# Subtest: media capture arguments restrict scenarios, evidence output, and aes key modes
ok 18 - media capture arguments restrict scenarios, evidence output, and aes key modes
  ---
  duration_ms: 1.0933
  type: 'test'
  ...
# Subtest: voice capture retains only safe transcript metadata and does not download media
ok 19 - voice capture retains only safe transcript metadata and does not download media
  ---
  duration_ms: 0.2956
  type: 'test'
  ...
# Subtest: video capture reuses encrypted download evidence without exposing media references
ok 20 - video capture reuses encrypted download evidence without exposing media references
  ---
  duration_ms: 0.3699
  type: 'test'
  ...
# Subtest: download evidence maps decrypt failures and local deadline without leaking error details
ok 21 - download evidence maps decrypt failures and local deadline without leaking error details
  ---
  duration_ms: 3.2124
  type: 'test'
  ...
# Subtest: push arguments restrict scenario, timing, repeat and evidence output
ok 22 - push arguments restrict scenario, timing, repeat and evidence output
  ---
  duration_ms: 1.1679
  type: 'test'
  ...
# Subtest: direct push uses userid in memory but records only desensitized delivery evidence
ok 23 - direct push uses userid in memory but records only desensitized delivery evidence
  ---
  duration_ms: 2.4726
  type: 'test'
  ...
# Subtest: group mention mode is opt-in and invalid chatid rejection keeps SDK error text out of evidence
ok 24 - group mention mode is opt-in and invalid chatid rejection keeps SDK error text out of evidence
  ---
  duration_ms: 0.6255
  type: 'test'
  ...
# Subtest: group markdown-then-text mention probe sends two ordered bodies and treats only the text probe rejection as a valid result
ok 25 - group markdown-then-text mention probe sends two ordered bodies and treats only the text probe rejection as a valid result
  ---
  duration_ms: 0.458
  type: 'test'
  ...
# Subtest: group mention arguments restrict timeout, trigger token and evidence output
ok 26 - group mention arguments restrict timeout, trigger token and evidence output
  ---
  duration_ms: 1.536
  type: 'test'
  ...
# Subtest: group mention reply uses passive text syntax with the current callback sender
ok 27 - group mention reply uses passive text syntax with the current callback sender
  ---
  duration_ms: 0.7437
  type: 'test'
  ...
# Subtest: stream reply uses the same passive mention syntax in a finished SDK-supported stream body
ok 28 - stream reply uses the same passive mention syntax in a finished SDK-supported stream body
  ---
  duration_ms: 0.1511
  type: 'test'
  ...
# Subtest: acknowledged group reply reuses the triggering frame and records only hashes and field shape
ok 29 - acknowledged group reply reuses the triggering frame and records only hashes and field shape
  ---
  duration_ms: 1.8093
  type: 'test'
  ...
# Subtest: probe ignores non-group and wrong-token messages before handling the matching group callback
ok 30 - probe ignores non-group and wrong-token messages before handling the matching group callback
  ---
  duration_ms: 0.3276
  type: 'test'
  ...
# Subtest: provider rejection is a completed negative capability result and excludes SDK error text
ok 31 - provider rejection is a completed negative capability result and excludes SDK error text
  ---
  duration_ms: 0.3521
  type: 'test'
  ...
# Subtest: capture builder never serializes raw callback or reply values
ok 32 - capture builder never serializes raw callback or reply values
  ---
  duration_ms: 0.18
  type: 'test'
  ...
# Subtest: card arguments enforce local evidence, trigger chat type, and the five-second late boundary
ok 33 - card arguments enforce local evidence, trigger chat type, and the five-second late boundary
  ---
  duration_ms: 1.1548
  type: 'test'
  ...
# Subtest: card shape has a unique caller-owned task id and both required actions
ok 34 - card shape has a unique caller-owned task id and both required actions
  ---
  duration_ms: 0.706
  type: 'test'
  ...
# Subtest: fast button event updates the matching task id within five seconds without persisting raw input
ok 35 - fast button event updates the matching task id within five seconds without persisting raw input
  ---
  duration_ms: 6.5947
  type: 'test'
  ...
# Subtest: duplicate mode records the second same-user same-action callback and preserves buttons until then
ok 36 - duplicate mode records the second same-user same-action callback and preserves buttons until then
  ---
  duration_ms: 0.9945
  type: 'test'
  ...
# Subtest: late mode calls update after the limit and records a platform rejection as an explicit expired-behavior result
ok 37 - late mode calls update after the limit and records a platform rejection as an explicit expired-behavior result
  ---
  duration_ms: 0.8156
  type: 'test'
  ...
# Subtest: a task-id mismatch is safely recorded with field names and hashes but never updates a foreign card
ok 38 - a task-id mismatch is safely recorded with field names and hashes but never updates a foreign card
  ---
  duration_ms: 0.6902
  type: 'test'
  ...
# Subtest: reply arguments only accept registered scenarios and evidence output paths
ok 39 - reply arguments only accept registered scenarios and evidence output paths
  ---
  duration_ms: 1.2633
  type: 'test'
  ...
# Subtest: welcome, Markdown, stream, and media builders use the documented reply forms
ok 40 - welcome, Markdown, stream, and media builders use the documented reply forms
  ---
  duration_ms: 2.3651
  type: 'test'
  ...
# Subtest: welcome replies accept an enter_chat event even when its chattype is omitted
ok 41 - welcome replies accept an enter_chat event even when its chattype is omitted
  ---
  duration_ms: 1.8696
  type: 'test'
  ...
# Subtest: stream refresh reuses one callback and stream id, then omits the body for matching feedback
ok 42 - stream refresh reuses one callback and stream id, then omits the body for matching feedback
  ---
  duration_ms: 4.662
  type: 'test'
  ...
# Subtest: Markdown reply is callback-bound and never serializes trigger text or identifiers
ok 43 - Markdown reply is callback-bound and never serializes trigger text or identifiers
  ---
  duration_ms: 0.5131
  type: 'test'
  ...
# Subtest: file, image, and voice upload then reply through the callback-bound media interface
ok 44 - file, image, and voice upload then reply through the callback-bound media interface
  ---
  duration_ms: 1.2476
  type: 'test'
  ...
# Subtest: video echo downloads only in memory, reuploads with a safe filename, and replies with title and description
ok 45 - video echo downloads only in memory, reuploads with a safe filename, and replies with title and description
  ---
  duration_ms: 0.8052
  type: 'test'
  ...
# Subtest: provider rejection has a stable classification without recording provider error text
ok 46 - provider rejection has a stable classification without recording provider error text
  ---
  duration_ms: 0.5367
  type: 'test'
  ...
# Subtest: feedback empty-reply rejection is a completed negative capability result
ok 47 - feedback empty-reply rejection is a completed negative capability result
  ---
  duration_ms: 2.4229
  type: 'test'
  ...
# Subtest: G0-007 defaults to a 4 hour 30 minute Windows-native soak and keeps Phase boundaries
ok 48 - G0-007 defaults to a 4 hour 30 minute Windows-native soak and keeps Phase boundaries
  ---
  duration_ms: 1.0838
  type: 'test'
  ...
# Subtest: run id is opaque and deterministic under an injected clock
ok 49 - run id is opaque and deterministic under an injected clock
  ---
  duration_ms: 0.1447
  type: 'test'
  ...
# Subtest: reconnect recovery, resource samples, and message replay stay content-free
ok 50 - reconnect recovery, resource samples, and message replay stay content-free
  ---
  duration_ms: 1.5021
  type: 'test'
  ...
# Subtest: a completed requested soak does not satisfy the 4 hour 30 minute Gate duration when shortened
ok 51 - a completed requested soak does not satisfy the 4 hour 30 minute Gate duration when shortened
  ---
  duration_ms: 0.2931
  type: 'test'
  ...
# Subtest: G0-008 closure preserves completed Gate 0 and P1 facts independently of the moving P2 frontier
ok 52 - G0-008 closure preserves completed Gate 0 and P1 facts independently of the moving P2 frontier
  ---
  duration_ms: 2.1872
  type: 'test'
  ...
# Subtest: G0-008 report covers every completed Gate 0 evidence source and retains limits
ok 53 - G0-008 report covers every completed Gate 0 evidence source and retains limits
  ---
  duration_ms: 1.9976
  type: 'test'
  ...
# Subtest: the capability-freeze ADR is accepted and does not skip P1-001
ok 54 - the capability-freeze ADR is accepted and does not skip P1-001
  ---
  duration_ms: 1.7705
  type: 'test'
  ...
# Subtest: the documented 512 KiB plan covers 3,920,958 bytes in eight ordered chunks
ok 55 - the documented 512 KiB plan covers 3,920,958 bytes in eight ordered chunks
  ---
  duration_ms: 1.6296
  type: 'test'
  ...
# Subtest: test-only padding creates an exact target-sized MP4 without retaining an original filename
ok 56 - test-only padding creates an exact target-sized MP4 without retaining an original filename
  ---
  duration_ms: 0.5054
  type: 'test'
  ...
# Subtest: layered upload sends init, every serial chunk, and finish with fresh request IDs
ok 57 - layered upload sends init, every serial chunk, and finish with fresh request IDs
  ---
  duration_ms: 31.4673
  type: 'test'
  ...
# Subtest: a rejected chunk prevents finish and returns an explicit stage result
ok 58 - a rejected chunk prevents finish and returns an explicit stage result
  ---
  duration_ms: 2.8791
  type: 'test'
  ...
# Subtest: the probe downloads in memory, completes the layer sequence, then issues one callback-bound reply
ok 59 - the probe downloads in memory, completes the layer sequence, then issues one callback-bound reply
  ---
  duration_ms: 3.7422
  type: 'test'
  ...
# Subtest: arguments remain restricted to the G0 evidence directory and 10 MiB provider limit
ok 60 - arguments remain restricted to the G0 evidence directory and 10 MiB provider limit
  ---
  duration_ms: 0.2363
  type: 'test'
  ...
# Subtest: validates and redacts a Webhook URL without exposing its key
ok 61 - validates and redacts a Webhook URL without exposing its key
  ---
  duration_ms: 0.8692
  type: 'test'
  ...
# Subtest: builds the documented text, markdown, media, news, and card payload forms
ok 62 - builds the documented text, markdown, media, news, and card payload forms
  ---
  duration_ms: 1.0086
  type: 'test'
  ...
# Subtest: creates bounded in-memory image, file, and AMR fixtures and documented multipart headers
ok 63 - creates bounded in-memory image, file, and AMR fixtures and documented multipart headers
  ---
  duration_ms: 0.5442
  type: 'test'
  ...
# Subtest: records only safe live-probe evidence when every provider reply is accepted
ok 64 - records only safe live-probe evidence when every provider reply is accepted
  ---
  duration_ms: 18.4382
  type: 'test'
  ...
# Subtest: P1 configuration accepts Pilot-only dependencies and produces a secret-free summary
ok 65 - P1 configuration accepts Pilot-only dependencies and produces a secret-free summary
  ---
  duration_ms: 1.1457
  type: 'test'
  ...
# Subtest: P1 configuration rejects missing, cross-phase, and unapproved public-edge settings
ok 66 - P1 configuration rejects missing, cross-phase, and unapproved public-edge settings
  ---
  duration_ms: 0.641
  type: 'test'
  ...
# Subtest: preflight output and CLI options do not expose configuration secrets
ok 67 - preflight output and CLI options do not expose configuration secrets
  ---
  duration_ms: 0.3298
  type: 'test'
  ...
# Subtest: the Pilot foundation health endpoint starts and stops without business routes
ok 68 - the Pilot foundation health endpoint starts and stops without business routes
  ---
  duration_ms: 34.9672
  type: 'test'
  ...
# Subtest: text Frame becomes an SDK-independent normalized message
ok 69 - text Frame becomes an SDK-independent normalized message
  ---
  duration_ms: 2.2404
  type: 'test'
  ...
# Subtest: image Frame exposes only an opaque media download reference
ok 70 - image Frame exposes only an opaque media download reference
  ---
  duration_ms: 0.606
  type: 'test'
  ...
# Subtest: mixed Frame preserves text and image ordering in one normalized message
ok 71 - mixed Frame preserves text and image ordering in one normalized message
  ---
  duration_ms: 0.3953
  type: 'test'
  ...
# Subtest: replayed Frame keeps one durable idempotency key without Adapter-side dropping
ok 72 - replayed Frame keeps one durable idempotency key without Adapter-side dropping
  ---
  duration_ms: 0.3728
  type: 'test'
  ...
# Subtest: illegal Frame returns a stable, non-retryable and secret-free error
ok 73 - illegal Frame returns a stable, non-retryable and secret-free error
  ---
  duration_ms: 0.1907
  type: 'test'
  ...
# Subtest: invalid Adapter receive time returns a stable error instead of throwing
ok 74 - invalid Adapter receive time returns a stable error instead of throwing
  ---
  duration_ms: 0.1926
  type: 'test'
  ...
# Subtest: text that exceeds the contract only after normalization fails closed
ok 75 - text that exceeds the contract only after normalization fails closed
  ---
  duration_ms: 0.9204
  type: 'test'
  ...
# Subtest: text incompatible with the Phase 1 PostgreSQL boundary fails closed
ok 76 - text incompatible with the Phase 1 PostgreSQL boundary fails closed
  ---
  duration_ms: 0.1677
  type: 'test'
  ...
# Subtest: non-message callback bodies are classified as unsupported before message-only fields
ok 77 - non-message callback bodies are classified as unsupported before message-only fields
  ---
  duration_ms: 0.1333
  type: 'test'
  ...
# Subtest: Frame envelope, identity and content validation use stable reasons
ok 78 - Frame envelope, identity and content validation use stable reasons
  ---
  duration_ms: 0.4887
  type: 'test'
  ...
# Subtest: Normalized Message JSON Schema matches the Adapter interface and excludes SDK secrets
ok 79 - Normalized Message JSON Schema matches the Adapter interface and excludes SDK secrets
  ---
  duration_ms: 1.3469
  type: 'test'
  ...
# Subtest: quoted text from the recorded Gate 0 shape is preserved without raw SDK fields
ok 80 - quoted text from the recorded Gate 0 shape is preserved without raw SDK fields
  ---
  duration_ms: 0.2072
  type: 'test'
  ...
# Subtest: Gate 0 verified file, voice and video Frames use the same normalized seam
ok 81 - Gate 0 verified file, voice and video Frames use the same normalized seam
  ---
  duration_ms: 0.4736
  type: 'test'
  ...
# Subtest: quoted media keeps an independent opaque reference
ok 82 - quoted media keeps an independent opaque reference
  ---
  duration_ms: 0.211
  type: 'test'
  ...
# Subtest: persists one Channel Message and returns the original result on replay
ok 83 - persists one Channel Message and returns the original result on replay
  ---
  duration_ms: 273.8679
  type: 'test'
  ...
# Subtest: snapshots validated input before connection acquisition
ok 84 - snapshots validated input before connection acquisition
  ---
  duration_ms: 5.3613
  type: 'test'
  ...
# Subtest: concurrent duplicates execute first processing exactly once
ok 85 - concurrent duplicates execute first processing exactly once
  ---
  duration_ms: 136.0368
  type: 'test'
  ...
# Subtest: first-processing failure rolls back the Inbox row and permits a clean retry
ok 86 - first-processing failure rolls back the Inbox row and permits a clean retry
  ---
  duration_ms: 9.7383
  type: 'test'
  ...
# Subtest: non-plain processing result roots fail as processing errors
ok 87 - non-plain processing result roots fail as processing errors
  ---
  duration_ms: 10.5174
  type: 'test'
  ...
# Subtest: processing result snapshot rejects nested non-JSON runtime objects
ok 88 - processing result snapshot rejects nested non-JSON runtime objects
  ---
  duration_ms: 4.5503
  type: 'test'
  ...
# Subtest: processing result validation never executes toJSON hooks
ok 89 - processing result validation never executes toJSON hooks
  ---
  duration_ms: 3.4422
  type: 'test'
  ...
# Subtest: processing result validation rejects Proxy toJSON substitution without executing it
ok 90 - processing result validation rejects Proxy toJSON substitution without executing it
  ---
  duration_ms: 3.0538
  type: 'test'
  ...
# Subtest: inherited toJSON pollution cannot transform an otherwise plain result
ok 91 - inherited toJSON pollution cannot transform an otherwise plain result
  ---
  duration_ms: 4.459
  type: 'test'
  ...
# Subtest: processing result snapshot accepts nested plain JSON arrays
ok 92 - processing result snapshot accepts nested plain JSON arrays
  ---
  duration_ms: 4.7103
  type: 'test'
  ...
# Subtest: first-processing callback cannot commit the Inbox transaction early
ok 93 - first-processing callback cannot commit the Inbox transaction early
  ---
  duration_ms: 3.7118
  type: 'test'
  ...
# Subtest: first-processing callback cannot change Inbox transaction characteristics
ok 94 - first-processing callback cannot change Inbox transaction characteristics
  ---
  duration_ms: 3.5544
  type: 'test'
  ...
# Subtest: comment-obfuscated transaction control remains blocked
ok 95 - comment-obfuscated transaction control remains blocked
  ---
  duration_ms: 3.9956
  type: 'test'
  ...
# Subtest: SET LOCAL cannot change the Inbox-owned transaction
ok 96 - SET LOCAL cannot change the Inbox-owned transaction
  ---
  duration_ms: 4.1682
  type: 'test'
  ...
# Subtest: session defaults cannot poison a pooled connection after Inbox commit
ok 97 - session defaults cannot poison a pooled connection after Inbox commit
  ---
  duration_ms: 42.3519
  type: 'test'
  ...
# Subtest: function-based session configuration is rejected before pooled connection reuse
ok 98 - function-based session configuration is rejected before pooled connection reuse
  ---
  duration_ms: 44.6032
  type: 'test'
  ...
# Subtest: ordinary Inbox use preserves caller-owned pool session baselines
ok 99 - ordinary Inbox use preserves caller-owned pool session baselines
  ---
  duration_ms: 51.2641
  type: 'test'
  ...
# Subtest: callback-style transaction queries are rejected before PostgreSQL execution
ok 100 - callback-style transaction queries are rejected before PostgreSQL execution
  ---
  duration_ms: 4.9331
  type: 'test'
  ...
# Subtest: unawaited transaction query failure remains a processing failure
ok 101 - unawaited transaction query failure remains a processing failure
  ---
  duration_ms: 9.21
  type: 'test'
  ...
# Subtest: transaction view is revoked when first processing settles
ok 102 - transaction view is revoked when first processing settles
  ---
  duration_ms: 4.2591
  type: 'test'
  ...
# Subtest: a duplicate after a real process restart receives the committed result
ok 103 - a duplicate after a real process restart receives the committed result
  ---
  duration_ms: 361.3603
  type: 'test'
  ...
# Subtest: temporary database unavailability returns a stable retryable error without processing
ok 104 - temporary database unavailability returns a stable retryable error without processing
  ---
  duration_ms: 2.021
  type: 'test'
  ...
# Subtest: invalid privacy, retention, plaintext payload and non-contract message fields fail before database access
ok 105 - invalid privacy, retention, plaintext payload and non-contract message fields fail before database access
  ---
  duration_ms: 0.9662
  type: 'test'
  ...
# Subtest: privacy, retention and caller-encrypted raw payload are persisted without entering the result
ok 106 - privacy, retention and caller-encrypted raw payload are persisted without entering the result
  ---
  duration_ms: 5.6271
  type: 'test'
  ...
# Subtest: migration fails closed when an existing Inbox lacks required constraints
ok 107 - migration fails closed when an existing Inbox lacks required constraints
  ---
  duration_ms: 294.5638
  type: 'test'
  ...
# Subtest: migration reports the stable drift error before indexing a table with missing columns
ok 108 - migration reports the stable drift error before indexing a table with missing columns
  ---
  duration_ms: 276.9503
  type: 'test'
  ...
# Subtest: migration rejects a weakened check constraint that keeps the expected name
ok 109 - migration rejects a weakened check constraint that keeps the expected name
  ---
  duration_ms: 313.9327
  type: 'test'
  ...
# Subtest: migration rejects a deferrable idempotency constraint unusable by ON CONFLICT
ok 110 - migration rejects a deferrable idempotency constraint unusable by ON CONFLICT
  ---
  duration_ms: 301.0745
  type: 'test'
  ...
# Subtest: migration rejects a deferrable primary key unusable by later foreign keys
ok 111 - migration rejects a deferrable primary key unusable by later foreign keys
  ---
  duration_ms: 355.4832
  type: 'test'
  ...
# Subtest: migration rejects a same-name hash index that cannot serve retention range scans
ok 112 - migration rejects a same-name hash index that cannot serve retention range scans
  ---
  duration_ms: 309.7668
  type: 'test'
  ...
# Subtest: migration rejects an extra check constraint outside the frozen set
ok 113 - migration rejects an extra check constraint outside the frozen set
  ---
  duration_ms: 305.8375
  type: 'test'
  ...
# Subtest: migration rejects an extra unique constraint that changes write semantics
ok 114 - migration rejects an extra unique constraint that changes write semantics
  ---
  duration_ms: 490.255
  type: 'test'
  ...
# Subtest: migration rejects a generated column that breaks explicit Inbox writes
ok 115 - migration rejects a generated column that breaks explicit Inbox writes
  ---
  duration_ms: 444.9888
  type: 'test'
  ...
# Subtest: migration is reentrant when the existing Inbox matches the frozen catalog
ok 116 - migration is reentrant when the existing Inbox matches the frozen catalog
  ---
  duration_ms: 495.6926
  type: 'test'
  ...
# Subtest: migration is limited to the P1-003 Channel Inbox and freezes the database constraints
ok 117 - migration is limited to the P1-003 Channel Inbox and freezes the database constraints
  ---
  duration_ms: 0.8166
  type: 'test'
  ...
# Subtest: creates one Service Intake, primary message relation and received audit event
ok 118 - creates one Service Intake, primary message relation and received audit event
  ---
  duration_ms: 133.446
  type: 'test'
  ...
# Subtest: aggregates multiple supplements into one Intake without creating a Ticket
ok 119 - aggregates multiple supplements into one Intake without creating a Ticket
  ---
  duration_ms: 29.6792
  type: 'test'
  ...
# Subtest: explicit new-report intent starts a new Intake inside the 90-second window
ok 120 - explicit new-report intent starts a new Intake inside the 90-second window
  ---
  duration_ms: 13.3213
  type: 'test'
  ...
# Subtest: an explicit reference to another ticket closes the current aggregation window
ok 121 - an explicit reference to another ticket closes the current aggregation window
  ---
  duration_ms: 33.8131
  type: 'test'
  ...
# Subtest: pure image creates a waiting Intake and emits a clarification audit event
ok 122 - pure image creates a waiting Intake and emits a clarification audit event
  ---
  duration_ms: 13.6259
  type: 'test'
  ...
# Subtest: a description clarifies the waiting image Intake instead of creating another Intake
ok 123 - a description clarifies the waiting image Intake instead of creating another Intake
  ---
  duration_ms: 28.7896
  type: 'test'
  ...
# Subtest: concurrent distinct messages in one context aggregate into exactly one Intake
ok 124 - concurrent distinct messages in one context aggregate into exactly one Intake
  ---
  duration_ms: 145.7323
  type: 'test'
  ...
# Subtest: reversed lock acquisition still aggregates bounded timestamp inversion and preserves valid update time
ok 125 - reversed lock acquisition still aggregates bounded timestamp inversion and preserves valid update time
  ---
  duration_ms: 17.1606
  type: 'test'
  ...
# Subtest: reversed lock acquisition never crosses an explicit new-context boundary
ok 126 - reversed lock acquisition never crosses an explicit new-context boundary
  ---
  duration_ms: 51.7873
  type: 'test'
  ...
# Subtest: classifies the documented request types without AI and honors incident negation
ok 127 - classifies the documented request types without AI and honors incident negation
  ---
  duration_ms: 80.6104
  type: 'test'
  ...
# Subtest: standalone thanks is CHATTER without an unnecessary clarification request
ok 128 - standalone thanks is CHATTER without an unnecessary clarification request
  ---
  duration_ms: 5.8266
  type: 'test'
  ...
# Subtest: aggregate privacy is strongest, retention is earliest, and Inbox snapshots contain no report summary
ok 129 - aggregate privacy is strongest, retention is earliest, and Inbox snapshots contain no report summary
  ---
  duration_ms: 13.4791
  type: 'test'
  ...
# Subtest: includes exactly 90 seconds and starts a new Intake after the window
ok 130 - includes exactly 90 seconds and starts a new Intake after the window
  ---
  duration_ms: 23.0701
  type: 'test'
  ...
# Subtest: different senders and conversations stay separate while direct chat maps to WECOM_DIRECT
ok 131 - different senders and conversations stay separate while direct chat maps to WECOM_DIRECT
  ---
  duration_ms: 18.8047
  type: 'test'
  ...
# Subtest: Channel Message replay returns the original Intake result without duplicate relations or events
ok 132 - Channel Message replay returns the original Intake result without duplicate relations or events
  ---
  duration_ms: 10.0042
  type: 'test'
  ...
# Subtest: downstream failure rolls back Channel Message, Intake, relations and events before a clean retry
ok 133 - downstream failure rolls back Channel Message, Intake, relations and events before a clean retry
  ---
  duration_ms: 13.0216
  type: 'test'
  ...
# Subtest: migration fails closed on legacy Inbox summaries and upgrades pre-redacted aggregates
ok 134 - migration fails closed on legacy Inbox summaries and upgrades pre-redacted aggregates
  ---
  duration_ms: 174.5349
  type: 'test'
  ...
# Subtest: migration runner exposes only the exact legacy-remediation failure as non-retryable
ok 135 - migration runner exposes only the exact legacy-remediation failure as non-retryable
  ---
  duration_ms: 0.2957
  type: 'test'
  ...
# Subtest: migration is limited to Service Intake, message relations and Intake audit events
ok 136 - migration is limited to Service Intake, message relations and Intake audit events
  ---
  duration_ms: 1.3639
  type: 'test'
  ...
# Subtest: Service Intake JSON Schema freezes the domain boundary and P1-004 version semantics
ok 137 - Service Intake JSON Schema freezes the domain boundary and P1-004 version semantics
  ---
  duration_ms: 1.2434
  type: 'test'
  ...
# Subtest: Service Intake migration is re-entrant
ok 138 - Service Intake migration is re-entrant
  ---
  duration_ms: 4.2074
  type: 'test'
  ...
# Subtest: invalid aggregation windows fail before a processor can access a transaction
ok 139 - invalid aggregation windows fail before a processor can access a transaction
  ---
  duration_ms: 0.2938
  type: 'test'
  ...
# Subtest: an explicit report creates one idempotent Pilot Ticket without AI or Hospital Tickets
ok 140 - an explicit report creates one idempotent Pilot Ticket without AI or Hospital Tickets
  ---
  duration_ms: 97.7611
  type: 'test'
  ...
# Subtest: a downstream failure rolls back the Intake-to-Ticket relationship before retry
ok 141 - a downstream failure rolls back the Intake-to-Ticket relationship before retry
  ---
  duration_ms: 19.6885
  type: 'test'
  ...
# Subtest: a Ticket number collision fails explicitly and leaves the second Intake unlinked
ok 142 - a Ticket number collision fails explicitly and leaves the second Intake unlinked
  ---
  duration_ms: 22.8881
  type: 'test'
  ...
# Subtest: the database rejects a Ticket when its source Intake does not point back to it
ok 143 - the database rejects a Ticket when its source Intake does not point back to it
  ---
  duration_ms: 9.7518
  type: 'test'
  ...
# Subtest: explicit Ticket Actions enforce legal transitions, versions, and an ordered audit timeline
ok 144 - explicit Ticket Actions enforce legal transitions, versions, and an ordered audit timeline
  ---
  duration_ms: 112.7344
  type: 'test'
  ...
# Subtest: concurrent handlers cannot both accept the same queued Ticket
ok 145 - concurrent handlers cannot both accept the same queued Ticket
  ---
  duration_ms: 41.0922
  type: 'test'
  ...
# Subtest: Phase 1 rejects an Incident-link action until the Phase 2 Incident fact exists
ok 146 - Phase 1 rejects an Incident-link action until the Phase 2 Incident fact exists
  ---
  duration_ms: 36.044
  type: 'test'
  ...
# Subtest: state, Ticket Event, Outbox, and target deliveries commit together while delivery failures retry independently
ok 147 - state, Ticket Event, Outbox, and target deliveries commit together while delivery failures retry independently
  ---
  duration_ms: 165.9394
  type: 'test'
  ...
# Subtest: a leased Delivery is not sent twice by concurrent Workers and terminal failures become dead letters
ok 148 - a leased Delivery is not sent twice by concurrent Workers and terminal failures become dead letters
  ---
  duration_ms: 64.0717
  type: 'test'
  ...
# Subtest: an Outbox failure rolls back the Ticket state and its Ticket Event
ok 149 - an Outbox failure rolls back the Ticket state and its Ticket Event
  ---
  duration_ms: 14.5542
  type: 'test'
  ...
# Subtest: the default notification matrix keeps internal notes off reporter delivery and the Worker rate-limits each target
ok 150 - the default notification matrix keeps internal notes off reporter delivery and the Worker rate-limits each target
  ---
  duration_ms: 72.7593
  type: 'test'
  ...
# Subtest: first acknowledgement is sent only after commit and a reconnect replay does not create or send twice
ok 151 - first acknowledgement is sent only after commit and a reconnect replay does not create or send twice
  ---
  duration_ms: 102.3082
  type: 'test'
  ...
# Subtest: temporary delivery failure preserves a real Ticket for retry, while a non-report never fabricates a Ticket number
ok 152 - temporary delivery failure preserves a real Ticket for retry, while a non-report never fabricates a Ticket number
  ---
  duration_ms: 29.6472
  type: 'test'
  ...
# Subtest: Pilot roles isolate teams, enable audited handling, and keep internal notes out of reporter views
ok 153 - Pilot roles isolate teams, enable audited handling, and keep internal notes out of reporter views
  ---
  duration_ms: 138.0258
  type: 'test'
  ...
# Subtest: the minimum local Pilot workbench exposes an injected authenticated mobile-friendly work view
ok 154 - the minimum local Pilot workbench exposes an injected authenticated mobile-friendly work view
  ---
  duration_ms: 56.3834
  type: 'test'
  ...
# Subtest: supplement, card confirmation, duplicate card protection, close, and reopen preserve a real Ticket lifecycle
ok 155 - supplement, card confirmation, duplicate card protection, close, and reopen preserve a real Ticket lifecycle
  ---
  duration_ms: 214.6733
  type: 'test'
  ...
# Subtest: the complete lifecycle processor exposes created delivery ids for post-commit acknowledgement
ok 156 - the complete lifecycle processor exposes created delivery ids for post-commit acknowledgement
  ---
  duration_ms: 17.2975
  type: 'test'
  ...
# Subtest: expired cards do not mutate Tickets and resolved Tickets close automatically with an explicit non-user reason
ok 157 - expired cards do not mutate Tickets and resolved Tickets close automatically with an explicit non-user reason
  ---
  duration_ms: 43.111
  type: 'test'
  ...
# Subtest: P1-011 parses only explicit backup drill modes and keeps credentials out of utility arguments
ok 158 - P1-011 parses only explicit backup drill modes and keeps credentials out of utility arguments
  ---
  duration_ms: 1.6146
  type: 'test'
  ...
# Subtest: P1-011 backup check validates controls without writing credential or encryption-key values
ok 159 - P1-011 backup check validates controls without writing credential or encryption-key values
  ---
  duration_ms: 118.8917
  type: 'test'
  ...
# Subtest: P1-011 emits a fixed restore alert and failure context when a drill cannot start
ok 160 - P1-011 emits a fixed restore alert and failure context when a drill cannot start
  ---
  duration_ms: 13.4355
  type: 'test'
  ...
# Subtest: P1-011 keeps a logical backup encrypted at rest while restoring the exact stream
ok 161 - P1-011 keeps a logical backup encrypted at rest while restoring the exact stream
  ---
  duration_ms: 18.094
  type: 'test'
  ...
# Subtest: P1-011 authenticates an encrypted artifact before exposing any plaintext to the restore consumer
ok 162 - P1-011 authenticates an encrypted artifact before exposing any plaintext to the restore consumer
  ---
  duration_ms: 8.7134
  type: 'test'
  ...
# Subtest: P1-011 writes only a redacted, structured operational log record
ok 163 - P1-011 writes only a redacted, structured operational log record
  ---
  duration_ms: 58.2311
  type: 'test'
  ...
# Subtest: P1-011 keeps a persisted core intake available when optional dependencies fail
ok 164 - P1-011 keeps a persisted core intake available when optional dependencies fail
  ---
  duration_ms: 2.9683
  type: 'test'
  ...
# Subtest: P1-011 composes the operational boundary around the real Inbox to Pilot Ticket lifecycle
ok 165 - P1-011 composes the operational boundary around the real Inbox to Pilot Ticket lifecycle
  ---
  duration_ms: 108.4681
  type: 'test'
  ...
# Subtest: P1-011 alerts with stable codes without carrying the rejected sensitive values
ok 166 - P1-011 alerts with stable codes without carrying the rejected sensitive values
  ---
  duration_ms: 0.7135
  type: 'test'
  ...
# Subtest: P1-011 serves the Pilot workbench under a same-origin CSP without inline code
ok 167 - P1-011 serves the Pilot workbench under a same-origin CSP without inline code
  ---
  duration_ms: 29.5341
  type: 'test'
  ...
# Subtest: P1-011 preserves safe backup and restore checkpoints in an admin-only immutable audit trail
ok 168 - P1-011 preserves safe backup and restore checkpoints in an admin-only immutable audit trail
  ---
  duration_ms: 52.5345
  type: 'test'
  ...
# Subtest: P1-012 accepts only an explicit check or approved live scenario
ok 169 - P1-012 accepts only an explicit check or approved live scenario
  ---
  duration_ms: 2.6165
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"a1e53dd9e26a4df35185ec429d3facb9","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING"}}
# Subtest: P1-012 recovers only an explicitly approved, stale, terminated-local reply-probe evidence claim and audits it
ok 170 - P1-012 recovers only an explicitly approved, stale, terminated-local reply-probe evidence claim and audits it
  ---
  duration_ms: 23.5282
  type: 'test'
  ...
# Subtest: P1-012 restores the stale claim and releases the recovery guard if its recovery audit cannot append
ok 171 - P1-012 restores the stale claim and releases the recovery guard if its recovery audit cannot append
  ---
  duration_ms: 9.6344
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
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"473a953aed240c633c3c2a988f9b644c","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING","resumed":true}}
# Subtest: P1-012 retains a truthful quarantine audit and blocks replies when quarantine cleanup fails, then resumes safely
ok 172 - P1-012 retains a truthful quarantine audit and blocks replies when quarantine cleanup fails, then resumes safely
  ---
  duration_ms: 28.3262
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
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"69b9563558ed4e18b999a1ecda128907","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING"}}
# Subtest: P1-012 atomically takes over a stale recovery guard while a live reply and second recovery remain blocked
ok 173 - P1-012 atomically takes over a stale recovery guard while a live reply and second recovery remain blocked
  ---
  duration_ms: 19.1194
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
  duration_ms: 14.1737
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
# {"test_id":"P1-012","event":"p1_012_reply_probe_evidence_claim_recovered","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","recovery":{"action":"STALE_CLAIM_REMOVED","claim_key_hash":"705ca0dc84cbe223f512c15ef28f5a52","stale_age_ms":120000,"owner_state":"LOCAL_PROCESS_NOT_RUNNING"}}
# Subtest: P1-012 recovery guard blocks concurrent recovery and live reply acquisition until recovery audit completes
ok 175 - P1-012 recovery guard blocks concurrent recovery and live reply acquisition until recovery audit completes
  ---
  duration_ms: 16.7919
  type: 'test'
  ...
# Subtest: P1-012 validates WSS and Pilot configuration without requiring a public listener
ok 176 - P1-012 validates WSS and Pilot configuration without requiring a public listener
  ---
  duration_ms: 0.5339
  type: 'test'
  ...
# Subtest: P1-012 check emits a redacted readiness record with no public-IP prerequisite
ok 177 - P1-012 check emits a redacted readiness record with no public-IP prerequisite
  ---
  duration_ms: 228.526
  type: 'test'
  ...
# Subtest: P1-012 marks an active delivery without an explicit provider ACK as retryable
ok 178 - P1-012 marks an active delivery without an explicit provider ACK as retryable
  ---
  duration_ms: 0.3845
  type: 'test'
  ...
# Subtest: P1-012 uses the Gate-0-verified completed stream shape for a group passive reply
ok 179 - P1-012 uses the Gate-0-verified completed stream shape for a group passive reply
  ---
  duration_ms: 0.2834
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
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_REPLY_PROBE","probe":{"exact_token":true,"addressing":"WECOM_MENTION_PREFIX","database_write":false,"run_id":"d757a1fa2dc88b858084433baae64e3c"},"passive_reply":{"operation":"aibot_respond_msg_stream","attempted":true,"acknowledged":true,"provider_errcode":0,"outcome":"ACKED"}}
# Subtest: P1-012 keeps a short reply probe exact-scoped and out of the Pilot database
ok 180 - P1-012 keeps a short reply probe exact-scoped and out of the Pilot database
  ---
  duration_ms: 15.328
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
  duration_ms: 40.2
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_client_display_observed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT","source_result_hash":"a98b043eaf220dfa7f8a6d15a1fdb998","provider_reply_acknowledged":true,"database_write":true,"ticket_created":true,"intake_status":"TICKET_CREATED","observer":"configured_test_account","observation":"VISIBLE"}
# Subtest: P1-012 records one HMAC-linked client observation for a successful Ticket-creating group text
ok 182 - P1-012 records one HMAC-linked client observation for a successful Ticket-creating group text
  ---
  duration_ms: 8.6232
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_shared_delivery_reconciled","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"SHARED_DELIVERY_RECONCILIATION","database_mutation":false,"synthetic_signature":"ACK_PREFIX","delivery_count":2,"ticket_count":1,"attempt_count":3,"retry_attempts":1,"synthetic_sent_attempts":2,"channels":{"pilot_team":1,"wecom_direct":1},"audit_history_preserved":true,"excluded_from_real_wecom_delivery_evidence":true,"reconciliation_status":"IDENTIFIED_AND_EXCLUDED"}
# Subtest: P1-012 reconciles the exact synthetic shared Delivery footprint without mutating database facts
ok 183 - P1-012 reconciles the exact synthetic shared Delivery footprint without mutating database facts
  ---
  duration_ms: 4.6631
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_client_display_observed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","source_result_hash":"4820f6a54a47a36001fef143b95d984c","source_addressing":"WECOM_MENTION_PREFIX","provider_reply_acknowledged":true,"database_write":false,"observer":"configured_test_account","observation":"VISIBLE"}
# Subtest: P1-012 serializes concurrent client observations for one reply-probe source
ok 184 - P1-012 serializes concurrent client observations for one reply-probe source
  ---
  duration_ms: 12.6766
  type: 'test'
  ...
# Subtest: P1-012 rejects a client observation whose source becomes stale before it claims the evidence chain
ok 185 - P1-012 rejects a client observation whose source becomes stale before it claims the evidence chain
  ---
  duration_ms: 3.6021
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
  duration_ms: 16.7152
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# Subtest: P1-012 prevents a reply probe from starting after an earlier evidence failure has won
ok 187 - P1-012 prevents a reply probe from starting after an earlier evidence failure has won
  ---
  duration_ms: 29.527
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_REPLY_PROBE","probe":{"exact_token":true,"addressing":"BARE","database_write":false,"run_id":"a24509999c8cc78ba01943f8c4130ce0"},"passive_reply":{"operation":"aibot_respond_msg_stream","attempted":true,"acknowledged":true,"provider_errcode":0,"outcome":"ACKED"}}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_EVIDENCE_WRITE_FAILED"}
# Subtest: P1-012 records an in-flight reply probe before its deferred terminal failure
ok 188 - P1-012 records an in-flight reply probe before its deferred terminal failure
  ---
  duration_ms: 31.4548
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_LIVE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN"}
# Subtest: P1-012 hard-times-out a permanently pending reply probe with an explicit unknown side-effect state
ok 189 - P1-012 hard-times-out a permanently pending reply probe with an explicit unknown side-effect state
  ---
  duration_ms: 4.7439
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE"}
# {"test_id":"P1-012","event":"p1_012_live_e2e_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_REPLY_PROBE","error_code":"P1_012_LIVE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN"}
# Subtest: P1-012 suppresses a late reply-probe success record after its hard timeout
ok 190 - P1-012 suppresses a late reply-probe success record after its hard timeout
  ---
  duration_ms: 42.0592
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_EVIDENCE_WRITE_FAILED"}
# Subtest: P1-012 prevents a failed group-id capture run from updating the local group id
ok 191 - P1-012 prevents a failed group-id capture run from updating the local group id
  ---
  duration_ms: 4.1797
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_applied","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"side_effect_state":"APPLIED","configuration_updated":true,"group_id_hash":"9aa6151c5e05da82086348a14803d96d"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_EVIDENCE_WRITE_FAILED","side_effect_state":"APPLIED","configuration_updated":true,"group_id_hash":"9aa6151c5e05da82086348a14803d96d"}
# Subtest: P1-012 records an in-flight group-id capture before its deferred terminal failure
ok 192 - P1-012 records an in-flight group-id capture before its deferred terminal failure
  ---
  duration_ms: 28.9008
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
  duration_ms: 4.7695
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_GROUP_ID_CAPTURE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN","group_id_hash":"eac76feda981759f44d849e3e50e5a7e","reconciliation_required":true}
# Subtest: P1-012 hard-times-out a pending group-id capture and aborts its local update seam
ok 194 - P1-012 hard-times-out a pending group-id capture and aborts its local update seam
  ---
  duration_ms: 0.9795
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_group_id_capture_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"mode":"capture_group_id"}
# {"test_id":"P1-012","event":"p1_012_group_id_capture_failed","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"error_code":"P1_012_GROUP_ID_CAPTURE_TIMEOUT","side_effect_state":"IN_FLIGHT_UNKNOWN","group_id_hash":"eac76feda981759f44d849e3e50e5a7e","reconciliation_required":true}
# Subtest: P1-012 leaves a late non-cooperative capture update as reconcilable unknown without a late applied record
ok 195 - P1-012 leaves a late non-cooperative capture update as reconcilable unknown without a late applied record
  ---
  duration_ms: 24.7462
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_error","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT","error_code":"ECONNRESET"}
# {"test_id":"P1-012","event":"p1_012_wss_disconnected","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reconnecting","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reauthenticated","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_TEXT","core":{"accepted":true},"passive_reply":{"acknowledged":true},"run_id":"563086d8e5f116886cb6fffcabce4ccc"}
# Subtest: P1-012 waits through a transient SDK disconnect and records only safe reconnect evidence
ok 196 - P1-012 waits through a transient SDK disconnect and records only safe reconnect evidence
  ---
  duration_ms: 7.0366
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
  duration_ms: 7.4831
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
  duration_ms: 269.4072
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT","timeout_ms":10000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_disconnected","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reconnect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_wss_reauthenticated","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT"}
# {"test_id":"P1-012","event":"p1_012_post_reconnect_message_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"RECONNECT_GROUP_TEXT","reauthenticated":true}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"RECONNECT_GROUP_TEXT","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"SENT"},"run_id":"642d899b795370e776d042d6e65c8d5d","reconnect":{"reauthenticated_before_callback":true}}
# Subtest: P1-012 forces reauthentication before accepting one scoped group-text callback
ok 199 - P1-012 forces reauthentication before accepting one scoped group-text callback
  ---
  duration_ms: 289.6845
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
# {"test_id":"P1-012","event":"p1_012_live_burst_result","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100","run_id":"0b89ac031c03c0d69c37ed1f254ecb72","expected_count":100,"callback_count":100,"unique_message_count":100,"accepted_within_target_count":100,"duplicate_callback_count":0,"database":{"inbox_count":100,"intake_count":100,"ticket_count":100,"outbox_count":100,"delivery_count":200,"tickets_with_invalid_outbox_count":0,"tickets_with_invalid_delivery_count":0},"zero_lost_tickets":true,"zero_duplicate_tickets":true,"notifications_traceable":true,"collection_elapsed_ms":55,"outcome":"PASSED"}
# Subtest: P1-012 completes a strictly sequenced 100-message live burst only after database fact reconciliation
ok 200 - P1-012 completes a strictly sequenced 100-message live burst only after database fact reconciliation
  ---
  duration_ms: 60.1712
  type: 'test'
  ...
# {"test_id":"P1-012","event":"p1_012_wss_connect_requested","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100","timeout_ms":120000}
# {"test_id":"P1-012","event":"p1_012_live_e2e_ready","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":1,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":2,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":3,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":4,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":5,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":6,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":7,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":8,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":9,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":10,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":11,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":12,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":13,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":14,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":15,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":16,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":17,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":18,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":19,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":20,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":21,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":22,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":23,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":24,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":25,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":26,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":27,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":28,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":29,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":30,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":31,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":32,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":33,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":34,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":35,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":36,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":37,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":38,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":39,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":40,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":41,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":42,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":43,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":44,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":45,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":46,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":47,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":48,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":49,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":50,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":51,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":52,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":53,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":54,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":55,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":56,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":57,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":58,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":59,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":60,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":61,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":62,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":63,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":64,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":65,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":66,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":67,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":68,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":69,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":70,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":71,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":72,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":73,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":74,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":75,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":76,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":77,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":78,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":79,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":80,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":81,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":82,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":83,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":84,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":85,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":86,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":87,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":88,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":89,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":90,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":91,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":92,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":93,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":94,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":95,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":96,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":97,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":98,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":99,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_message_result","outcome":"processed","scenario":"GROUP_BURST_100","core":{"accepted":true,"ticket_created":true,"intake_status":"TICKET_CREATED","within_target":true},"passive_reply":{"acknowledged":true,"outcome":"ACKED","within_target":true},"delivery":{"attempted":true,"status":"PENDING"},"sequence_index":100,"run_id":"5d1287fd14eebce665cef56dc36fc45b"}
# {"test_id":"P1-012","event":"p1_012_live_burst_result","phase":"P1","environment":"development","public_listener_required":false,"ai_triage_enabled":false,"ocr_enabled":false,"hospital_tickets_enabled":false,"scenario":"GROUP_BURST_100","run_id":"5d1287fd14eebce665cef56dc36fc45b","expected_count":100,"callback_count":100,"unique_message_count":100,"accepted_within_target_count":100,"duplicate_callback_count":0,"database":{"inbox_count":100,"intake_count":100,"ticket_count":100,"outbox_count":100,"delivery_count":200,"tickets_with_invalid_outbox_count":2,"tickets_with_invalid_delivery_count":2},"zero_lost_tickets":true,"zero_duplicate_tickets":true,"notifications_traceable":false,"collection_elapsed_ms":48,"outcome":"FAILED"}
# Subtest: P1-012 burst fails closed when global notification totals mask per-ticket gaps
ok 201 - P1-012 burst fails closed when global notification totals mask per-ticket gaps
  ---
  duration_ms: 51.2375
  type: 'test'
  ...
# Subtest: P1-012 exercises the real Pilot core under duplicate, image, burst, Outbox failure, and AI-off conditions
ok 202 - P1-012 exercises the real Pilot core under duplicate, image, burst, Outbox failure, and AI-off conditions
  ---
  duration_ms: 919.0615
  type: 'test'
  ...
# Subtest: P1-012 handles a scoped group text frame through Intake then a safe reply and Delivery
ok 203 - P1-012 handles a scoped group text frame through Intake then a safe reply and Delivery
  ---
  duration_ms: 6.0472
  type: 'test'
  ...
# Subtest: P1-012 records an image-degraded Intake without fabricating a Ticket
ok 204 - P1-012 records an image-degraded Intake without fabricating a Ticket
  ---
  duration_ms: 0.8676
  type: 'test'
  ...
# Subtest: P1-012 accepts an addressed group mixed image only when it contains the run token and an image
ok 205 - P1-012 accepts an addressed group mixed image only when it contains the run token and an image
  ---
  duration_ms: 0.9503
  type: 'test'
  ...
# Subtest: P1-012 ignores an unscoped group frame without calling any operational seam
ok 206 - P1-012 ignores an unscoped group frame without calling any operational seam
  ---
  duration_ms: 0.333
  type: 'test'
  ...
# Subtest: P1-012 keeps a transient core failure safe and retryable without leaking the failure text
ok 207 - P1-012 keeps a transient core failure safe and retryable without leaking the failure text
  ---
  duration_ms: 0.5479
  type: 'test'
  ...
# Subtest: P1-012 keeps a thrown database fault out of the client reply and safe evidence
ok 208 - P1-012 keeps a thrown database fault out of the client reply and safe evidence
  ---
  duration_ms: 0.6466
  type: 'test'
  ...
# Subtest: P1-012 requires an explicit successful provider receipt for a passive reply
ok 209 - P1-012 requires an explicit successful provider receipt for a passive reply
  ---
  duration_ms: 0.6601
  type: 'test'
  ...
# Subtest: P1-012 preserves a provider reply rejection code without keeping its message text
ok 210 - P1-012 preserves a provider reply rejection code without keeping its message text
  ---
  duration_ms: 0.8245
  type: 'test'
  ...
# Subtest: P1-012 Go/No-Go requires real client observation but never a public IP for outbound WSS
ok 211 - P1-012 Go/No-Go requires real client observation but never a public IP for outbound WSS
  ---
  duration_ms: 1.9181
  type: 'test'
  ...
# Subtest: P1-012 WeCom burst UI plan is side-effect free and preserves the requested sequence range
ok 212 - P1-012 WeCom burst UI plan is side-effect free and preserves the requested sequence range
  ---
  duration_ms: 927.2615
  type: 'test'
  ...
# Subtest: P1-012 WeCom burst UI driver fails closed on invalid ranges and ambiguous modes
ok 213 - P1-012 WeCom burst UI driver fails closed on invalid ranges and ambiguous modes
  ---
  duration_ms: 1798.3306
  type: 'test'
  ...
# Subtest: P1-012 WeCom burst UI driver retains fail-closed target, clipboard, stop, and reconciliation guards
ok 214 - P1-012 WeCom burst UI driver retains fail-closed target, clipboard, stop, and reconciliation guards
  ---
  duration_ms: 6.8415
  type: 'test'
  ...
# Subtest: P2-001 PostgreSQL contract is idempotent, isolated, and fail closed
ok 215 - P2-001 PostgreSQL contract is idempotent, isolated, and fail closed
  ---
  duration_ms: 1129.5597
  type: 'test'
  ...
# Subtest: all P2 conversation feature flags default to false
ok 216 - all P2 conversation feature flags default to false
  ---
  duration_ms: 1.5007
  type: 'test'
  ...
# Subtest: Thread identity separates single, group, and multiple bots without exposing raw ids in its key
ok 217 - Thread identity separates single, group, and multiple bots without exposing raw ids in its key
  ---
  duration_ms: 0.8931
  type: 'test'
  ...
# Subtest: Thread identity rejects malformed channel scope with a stable error
ok 218 - Thread identity rejects malformed channel scope with a stable error
  ---
  duration_ms: 0.4472
  type: 'test'
  ...
# Subtest: group Session scope isolates participants and Intakes
ok 219 - group Session scope isolates participants and Intakes
  ---
  duration_ms: 0.5121
  type: 'test'
  ...
# Subtest: Session boundary rules cover ended, explicit, different Intake, idle equality, and continuation
ok 220 - Session boundary rules cover ended, explicit, different Intake, idle equality, and continuation
  ---
  duration_ms: 0.6873
  type: 'test'
  ...
# Subtest: only auditable boundary reasons are accepted from callers
ok 221 - only auditable boundary reasons are accepted from callers
  ---
  duration_ms: 0.3615
  type: 'test'
  ...
# Subtest: Session lifecycle is OPEN/WAITING_USER with ENDED terminal
ok 222 - Session lifecycle is OPEN/WAITING_USER with ENDED terminal
  ---
  duration_ms: 0.2184
  type: 'test'
  ...
# Subtest: control modes fail closed, default HUMAN, and reserve AUTO for P2-010/P2-G4
ok 223 - control modes fail closed, default HUMAN, and reserve AUTO for P2-010/P2-G4
  ---
  duration_ms: 0.3078
  type: 'test'
  ...
# Subtest: generation and row versions advance only for unique invalidating changes
ok 224 - generation and row versions advance only for unique invalidating changes
  ---
  duration_ms: 0.2169
  type: 'test'
  ...
# Subtest: disabled guard does not invoke storage or external seams and raw failures stay hidden
ok 225 - disabled guard does not invoke storage or external seams and raw failures stay hidden
  ---
  duration_ms: 0.5375
  type: 'test'
  ...
# Subtest: database failures map to stable public errors
ok 226 - database failures map to stable public errors
  ---
  duration_ms: 0.1297
  type: 'test'
  ...
# Subtest: P2-001 migration is limited to Thread and Session and reserves later tasks
ok 227 - P2-001 migration is limited to Thread and Session and reserves later tasks
  ---
  duration_ms: 7.1292
  type: 'test'
  ...
# Subtest: JSON Schemas, public OpenAPI view, and TypeScript declarations freeze safe vocabulary
ok 228 - JSON Schemas, public OpenAPI view, and TypeScript declarations freeze safe vocabulary
  ---
  duration_ms: 2.4639
  type: 'test'
  ...
# Subtest: P2-002 migration 011 first/repeat apply is exact and leaves P1/P2-001 unchanged
ok 229 - P2-002 migration 011 first/repeat apply is exact and leaves P1/P2-001 unchanged
  ---
  duration_ms: 761.0998
  type: 'test'
  ...
# Subtest: P2-002 migration CLI runs only 011, is repeatable, and rolls check mode back
ok 230 - P2-002 migration CLI runs only 011, is repeatable, and rolls check mode back
  ---
  duration_ms: 1708.8003
  type: 'test'
  ...
# {"child_process_runs":4,"child_exit_codes":[0,0,0,0],"preapply_check_created_tables":0,"migration_files_executed":1,"tables_added":3,"p1_p2_001_catalog_unchanged":true,"postapply_check_rolled_back":true,"temp_database_cleanup":true}
# Subtest: P2-002 migration CLI fails closed on incompatible read-only source dependencies
ok 231 - P2-002 migration CLI fails closed on incompatible read-only source dependencies
  ---
  duration_ms: 953.8249
  type: 'test'
  ...
# {"child_exit_code":1,"stable_error":"P2_002_SCHEMA_DRIFT_REMEDIATION_REQUIRED","p2_tables_created":0,"temp_database_cleanup":true}
# Subtest: P2-002 migration 011 fails closed on missing column
ok 232 - P2-002 migration 011 fails closed on missing column
  ---
  duration_ms: 644.6216
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on weakened CHECK constraint
ok 233 - P2-002 migration 011 fails closed on weakened CHECK constraint
  ---
  duration_ms: 808.1235
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on wrong unique constraint columns
ok 234 - P2-002 migration 011 fails closed on wrong unique constraint columns
  ---
  duration_ms: 1265.1268
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on wrong index access method
ok 235 - P2-002 migration 011 fails closed on wrong index access method
  ---
  duration_ms: 1800.8334
  type: 'test'
  ...
# Subtest: P2-002 migration 011 fails closed on wrong partial-index predicate
ok 236 - P2-002 migration 011 fails closed on wrong partial-index predicate
  ---
  duration_ms: 2356.6108
  type: 'test'
  ...
# Subtest: P2-002 P1 source adapter reads Channel/Intake/Ticket/Delivery facts without mutating them
ok 237 - P2-002 P1 source adapter reads Channel/Intake/Ticket/Delivery facts without mutating them
  ---
  duration_ms: 8361.1484
  type: 'test'
  ...
# {"source_record_count":4,"channel_message_count":1,"ticket_event_variant_count":2,"delivery_count":1,"source_snapshot_unchanged":true}
# Subtest: P2-002 real worker processes roll back before commit and replay after ACK loss
ok 238 - P2-002 real worker processes roll back before commit and replay after ACK loss
  ---
  duration_ms: 4618.3353
  type: 'test'
  ...
# {"before_commit_kill_exit":{"code":null,"signal":"SIGKILL","killed":true},"before_commit_backend_close_polls":1,"before_commit_restart_exit":{"code":0,"signal":null,"killed":false},"before_commit_restart_inserted":1,"after_commit_kill_exit":{"code":null,"signal":"SIGKILL","killed":true},"after_commit_backend_close_polls":1,"after_commit_restart_exit":{"code":0,"signal":null,"killed":false},"after_commit_restart_replayed":1,"final_item_count":1,"final_binding_count":1,"final_checkpoint_cursor":"1","temp_database_cleanup":true}
# Subtest: P2-002 stale rebuild cannot delete a source committed after snapshot preparation
ok 239 - P2-002 stale rebuild cannot delete a source committed after snapshot preparation
  ---
  duration_ms: 2478.2314
  type: 'test'
  ...
# {"connection_wait_polls":1,"stale_rebuild_error":"CONVERSATION_TIMELINE_REBUILD_FAILED","preserved_item_count":3,"preserved_binding_count":3,"preserved_checkpoint_cursor":"3","full_rebuild_item_count":3,"full_rebuild_hash":"1d1df9d0b18ae8cdd003c32921623dc0b1c0194bc31e7b1f3a8619bc8cdd016c","temp_database_cleanup":true}
# Subtest: P2-002 projector is idempotent, concurrent, transactional, rebuildable, private, and restart safe
ok 240 - P2-002 projector is idempotent, concurrent, transactional, rebuildable, private, and restart safe
  ---
  duration_ms: 15625.0153
  type: 'test'
  ...
# {"same_source_concurrency":12,"different_source_concurrency":12,"bulk_item_count":2001,"bulk_batch_count":101,"bulk_max_batch_size":20,"bulk_peak_heap_delta_bytes":17173952,"bulk_heap_sample_count":101,"bulk_heap_segment_means_bytes":[17615840,19521488,22275544,25722629],"bulk_first_to_last_heap_trend_bytes":8106789,"bulk_max_adjacent_heap_trend_bytes":3447085,"bulk_interrupted_at_cursor":"20","bulk_restart_remaining_items":1981,"rebuild_canonical_hash":"bd7bb56d3566a7be26ba6bbd6e6d12f99978cb370a59834bbbb1719596016c72","temp_database_cleanup":"verified-by-finally"}
# Subtest: P2-002 suite leaves no random database or worker backend residual
ok 241 - P2-002 suite leaves no random database or worker backend residual
  ---
  duration_ms: 169.0247
  type: 'test'
  ...
# {"temp_database_count":0,"worker_backend_count":0,"isolated_source_data_residual":0,"isolated_projection_schema_residual":0}
# Subtest: P2-002 uses the frozen P2-001 Conversation Item enums
ok 242 - P2-002 uses the frozen P2-001 Conversation Item enums
  ---
  duration_ms: 14.7514
  type: 'test'
  ...
# Subtest: projection source schema parses and freezes the five source types
ok 243 - projection source schema parses and freezes the five source types
  ---
  duration_ms: 3.2872
  type: 'test'
  ...
# Subtest: normalization rejects invalid source type, session UUID, date, ordinal and additions
ok 244 - normalization rejects invalid source type, session UUID, date, ordinal and additions
  ---
  duration_ms: 4.6331
  type: 'test'
  ...
# Subtest: date normalization rejects hostile Date/object paths without invoking or leaking them
ok 245 - date normalization rejects hostile Date/object paths without invoking or leaking them
  ---
  duration_ms: 1.5074
  type: 'test'
  ...
# Subtest: safe_content accepts only bounded plain JSON data properties
ok 246 - safe_content accepts only bounded plain JSON data properties
  ---
  duration_ms: 0.9374
  type: 'test'
  ...
# Subtest: toJSON, Proxy and prototype-pollution keys cannot bypass pure JSON checks
ok 247 - toJSON, Proxy and prototype-pollution keys cannot bypass pure JSON checks
  ---
  duration_ms: 0.8188
  type: 'test'
  ...
# Subtest: source_hash is stable across key order and detects semantic mutation
ok 248 - source_hash is stable across key order and detects semantic mutation
  ---
  duration_ms: 0.8762
  type: 'test'
  ...
# Subtest: privacy and retention controls can tighten without changing semantic source_hash
ok 249 - privacy and retention controls can tighten without changing semantic source_hash
  ---
  duration_ms: 0.4516
  type: 'test'
  ...
# Subtest: canonical order uses the frozen rank and exact deterministic tie-break tuple
ok 250 - canonical order uses the frozen rank and exact deterministic tie-break tuple
  ---
  duration_ms: 1.2731
  type: 'test'
  ...
# Subtest: canonical order compares BIGINT ordinals numerically without Number conversion
ok 251 - canonical order compares BIGINT ordinals numerically without Number conversion
  ---
  duration_ms: 1.8508
  type: 'test'
  ...
# Subtest: source id and variant break otherwise identical timestamp/rank/ordinal ties
ok 252 - source id and variant break otherwise identical timestamp/rank/ordinal ties
  ---
  duration_ms: 0.7968
  type: 'test'
  ...
# Subtest: CHANNEL_MESSAGE maps only clean_text and four safe flags
ok 253 - CHANNEL_MESSAGE maps only clean_text and four safe flags
  ---
  duration_ms: 0.9334
  type: 'test'
  ...
# Subtest: TICKET_EVENT splits STATUS, EXTERNAL_NOTE and INTERNAL_NOTE variants
ok 254 - TICKET_EVENT splits STATUS, EXTERNAL_NOTE and INTERNAL_NOTE variants
  ---
  duration_ms: 0.7602
  type: 'test'
  ...
# Subtest: TICKET_EVENT external variant cannot contain internal note or operator identity
ok 255 - TICKET_EVENT external variant cannot contain internal note or operator identity
  ---
  duration_ms: 0.5023
  type: 'test'
  ...
# Subtest: TICKET_EVENT omits absent note variants
ok 256 - TICKET_EVENT omits absent note variants
  ---
  duration_ms: 0.3571
  type: 'test'
  ...
# Subtest: DELIVERY is INTERNAL and excludes target/provider/raw error data
ok 257 - DELIVERY is INTERNAL and excludes target/provider/raw error data
  ---
  duration_ms: 0.5517
  type: 'test'
  ...
# Subtest: Communication Message fixture mapper requires an explicit fixture marker
ok 258 - Communication Message fixture mapper requires an explicit fixture marker
  ---
  duration_ms: 0.5036
  type: 'test'
  ...
# Subtest: Handoff fixture defaults to INTERNAL and never creates a future table dependency
ok 259 - Handoff fixture defaults to INTERNAL and never creates a future table dependency
  ---
  duration_ms: 0.3348
  type: 'test'
  ...
# Subtest: normalized safe_content deny-list blocks privacy and provider leakage fields
ok 260 - normalized safe_content deny-list blocks privacy and provider leakage fields
  ---
  duration_ms: 0.9874
  type: 'test'
  ...
# Subtest: feature flag is fail-closed before any database call
ok 261 - feature flag is fail-closed before any database call
  ---
  duration_ms: 0.8371
  type: 'test'
  ...
# Subtest: batchSize defaults to 20 and is bounded at construction and invocation
ok 262 - batchSize defaults to 20 and is bounded at construction and invocation
  ---
  duration_ms: 0.9018
  type: 'test'
  ...
# Subtest: runtime freezes every source and operation to the single timeline projector name
ok 263 - runtime freezes every source and operation to the single timeline projector name
  ---
  duration_ms: 1.6483
  type: 'test'
  ...
# Subtest: public storage failures contain only the stable code
ok 264 - public storage failures contain only the stable code
  ---
  duration_ms: 0.5472
  type: 'test'
  ...
# Subtest: database sequence uniqueness is deterministically mapped to the frozen sequence error
ok 265 - database sequence uniqueness is deterministically mapped to the frozen sequence error
  ---
  duration_ms: 7.442
  type: 'test'
  ...
# Subtest: rebuild authorization and wrapper accessor validation fail before storage
ok 266 - rebuild authorization and wrapper accessor validation fail before storage
  ---
  duration_ms: 2.3783
  type: 'test'
  ...
# Subtest: rebuild stale-snapshot fence fails before DELETE for extra or foreign bindings
ok 267 - rebuild stale-snapshot fence fails before DELETE for extra or foreign bindings
  ---
  duration_ms: 2.8482
  type: 'test'
  ...
# Subtest: Canonical Timeline Hash excludes projected_at and physical input order
ok 268 - Canonical Timeline Hash excludes projected_at and physical input order
  ---
  duration_ms: 0.7081
  type: 'test'
  ...
# Subtest: Canonical Timeline Hash validates arrays and items before any caller property access
ok 269 - Canonical Timeline Hash validates arrays and items before any caller property access
  ---
  duration_ms: 2.3824
  type: 'test'
  ...
# Subtest: EXTERNAL audience uses SQL visibility filtering and defense-in-depth filtering
ok 270 - EXTERNAL audience uses SQL visibility filtering and defense-in-depth filtering
  ---
  duration_ms: 0.9196
  type: 'test'
  ...
# Subtest: WORKBENCH excludes RESTRICTED and RESTRICTED_ADMIN requires explicit authorization
ok 271 - WORKBENCH excludes RESTRICTED and RESTRICTED_ADMIN requires explicit authorization
  ---
  duration_ms: 0.4219
  type: 'test'
  ...
# Subtest: generic TimelineSourceAdapter maps rows outside projector transactions
ok 272 - generic TimelineSourceAdapter maps rows outside projector transactions
  ---
  duration_ms: 0.7261
  type: 'test'
  ...
# Subtest: public wrapper APIs reject Proxy/accessor arguments before invoking dependencies
ok 273 - public wrapper APIs reject Proxy/accessor arguments before invoking dependencies
  ---
  duration_ms: 1.0572
  type: 'test'
  ...
# Subtest: unknown Proxy/accessor error objects are sanitized without a second trap
ok 274 - unknown Proxy/accessor error objects are sanitized without a second trap
  ---
  duration_ms: 0.2876
  type: 'test'
  ...
# Subtest: worker reads a bounded batch before invoking the projector and preserves AbortSignal
ok 275 - worker reads a bounded batch before invoking the projector and preserves AbortSignal
  ---
  duration_ms: 0.5779
  type: 'test'
  ...
# Subtest: worker maps unknown adapter failures to the stable storage error
ok 276 - worker maps unknown adapter failures to the stable storage error
  ---
  duration_ms: 0.2403
  type: 'test'
  ...
# Subtest: checkpoint cursor accepts nullable expected values and enforces the shared 512 bound
ok 277 - checkpoint cursor accepts nullable expected values and enforces the shared 512 bound
  ---
  duration_ms: 3.3335
  type: 'test'
  ...
# Subtest: migration runner executes only migration 011 and sanitizes raw failures
ok 278 - migration runner executes only migration 011 and sanitizes raw failures
  ---
  duration_ms: 3.8537
  type: 'test'
  ...
# Subtest: the public error vocabulary contains exactly the eleven frozen stable codes
ok 279 - the public error vocabulary contains exactly the eleven frozen stable codes
  ---
  duration_ms: 0.4573
  type: 'test'
  ...
# Subtest: P1 source adapter reads current sources in one repeatable-read read-only transaction
ok 280 - P1 source adapter reads current sources in one repeatable-read read-only transaction
  ---
  duration_ms: 0.7759
  type: 'test'
  ...
# Subtest: P2-003 migration 012 is exact, reentrant, CLI-scoped, and check-only rolls back
ok 281 - P2-003 migration 012 is exact, reentrant, CLI-scoped, and check-only rolls back
  ---
  duration_ms: 2561.3155
  type: 'test'
  ...
# {"migration_process_runs":4,"migration_files_executed":1,"relations_added":2,"prior_catalog_unchanged":true,"precheck_rolled_back":true,"postcheck_rolled_back":true,"temp_database_cleanup":true}
# Subtest: P2-003 migration fails closed for missing column, weak check, wrong unique and index drift
ok 282 - P2-003 migration fails closed for missing column, weak check, wrong unique and index drift
  ---
  duration_ms: 8938.2687
  type: 'test'
  ...
# {"drift_scenarios":5,"temp_database_cleanup":true}
# Subtest: P2-003 append, concurrency, caller transaction, durable replay and authorization are exact
ok 283 - P2-003 append, concurrency, caller transaction, durable replay and authorization are exact
  ---
  duration_ms: 4751.3166
  type: 'test'
  ...
# {"same_event_concurrency":12,"different_event_concurrency":12,"pool_maximum":4,"natural_identity_hole":true,"ack_loss_replayed":true,"replay_batch_count":3,"replay_batch_maximum":50,"authorization_variants":4,"retained_event_count":124,"temp_database_cleanup":true}
# Subtest: P2-003 retention check/apply preserves prefix and floor semantics with CLI authorization
ok 284 - P2-003 retention check/apply preserves prefix and floor semantics with CLI authorization
  ---
  duration_ms: 10095.7214
  type: 'test'
  ...
# {"check_zero_write":true,"unauthorized_apply_zero_write":true,"deleted_prefix_count":2,"floor_event_id":"2","expired_after_live_retained":true,"retry_idempotent":true,"replay_gap_http_fallback":true,"cursor_ahead_http_409":true,"authorized_cli_apply":true}
# Subtest: P2-003 retention delete/floor is atomic and every cleanup batch is at most 200
ok 285 - P2-003 retention delete/floor is atomic and every cleanup batch is at most 200
  ---
  duration_ms: 9325.8488
  type: 'test'
  ...
# {"first_batch_deleted":200,"second_batch_deleted":1,"floor_delete_atomic_rollback":true}
# Subtest: P2-003 localhost SSE admits 32 clients, rejects 33, heartbeats, delivers and releases resources
ok 286 - P2-003 localhost SSE admits 32 clients, rejects 33, heartbeats, delivers and releases resources
  ---
  duration_ms: 5246.4372
  type: 'test'
  ...
# {"peak_client_count":32,"event_count":100,"each_client_received":100,"capacity_rejections":1,"maximum_writable_length":16695,"slow_client_disconnects":0,"heap_samples_bytes":[9931816,11928976,13025152,11833584,13130928,18297136,19309016],"first_heap_bytes":9931816,"last_heap_bytes":19309016,"heap_sample_mean_bytes":13922373,"first_to_last_heap_trend_bytes":9377200,"peak_heap_delta_bytes":9377200,"database_query_batches":108,"resource_release_polls":1,"temp_database_cleanup":true}
# Subtest: P2-003 child kill/restart replays Last-Event-ID and missed wakeup recovers from PostgreSQL
ok 287 - P2-003 child kill/restart replays Last-Event-ID and missed wakeup recovers from PostgreSQL
  ---
  duration_ms: 3822.1167
  type: 'test'
  ...
# {"killed_server_exit":{"code":null,"signal":"SIGKILL","killed":true},"killed_server_backend_close_polls":1,"first_event_id":"1","post_restart_event_id":"2","recovery_poll_event_id":"3","app_restart_postgresql_replay":true,"missed_wakeup_recovered":true,"server_a_port":53995,"server_b_port":54000,"temp_database_cleanup":true}
# Subtest: P2-003 real paused slow client is isolated while normal delivery and append continue
ok 288 - P2-003 real paused slow client is isolated while normal delivery and append continue
  ---
  duration_ms: 19429.093
  type: 'test'
  ...
# {"slow_disconnect_count":1,"normal_client_received":5001,"persisted_event_count":5001,"slow_disconnect_polls":84,"active_slow_write_window_polls":14,"normal_joined_during_slow_drain_polls":1,"normal_client_remained_connected":true,"append_during_slow_write_window":true,"business_transaction_during_slow_write_window":true,"temp_database_cleanup":true}
# Subtest: P2-003 streams 5,000 events in bounded batches and bounded heap without retaining frames
ok 289 - P2-003 streams 5,000 events in bounded batches and bounded heap without retaining frames
  ---
  duration_ms: 3635.2672
  type: 'test'
  ...
# {"event_count":5000,"replay_query_batch_count":100,"replay_batch_size":50,"captured_frame_count":0,"maximum_parser_buffer_bytes":370,"maximum_writable_length":16588,"heap_samples_bytes":[9937960,11775824,13372208,12337960,19128056,17156576],"first_to_last_heap_trend_bytes":7218616,"peak_heap_delta_bytes":9190096,"temp_database_cleanup":true}
# Subtest: P2-003 suite leaves no owned database, schema, child, backend, socket, port or timer residual
ok 290 - P2-003 suite leaves no owned database, schema, child, backend, socket, port or timer residual
  ---
  duration_ms: 56.1803
  type: 'test'
  ...
# {"active_test_clients":0,"active_fallback_requests":0,"active_test_http_sockets":0,"active_test_wait_timers":0,"active_cli_children":0,"active_server_children":0,"owned_port_count":6,"closed_port_count":6,"port_close_polls":[1,1,1,1,1,1],"owned_database_count":0,"owned_schema_count":0,"owned_backend_count":0,"active_database_count":0,"emergency_client_cleanup_count":0,"emergency_fallback_cleanup_count":0,"emergency_http_socket_cleanup_count":0}
# Subtest: Realtime Event and Fallback Schemas parse as draft 2020-12 closed contracts
ok 291 - Realtime Event and Fallback Schemas parse as draft 2020-12 closed contracts
  ---
  duration_ms: 8.4008
  type: 'test'
  ...
# Subtest: Realtime vocabularies freeze all event, source, aggregate, scope and visibility values
ok 292 - Realtime vocabularies freeze all event, source, aggregate, scope and visibility values
  ---
  duration_ms: 1.2715
  type: 'test'
  ...
# Subtest: TypeScript declarations mirror every frozen Schema and runtime vocabulary
ok 293 - TypeScript declarations mirror every frozen Schema and runtime vocabulary
  ---
  duration_ms: 1.7474
  type: 'test'
  ...
# Subtest: authorized replay SQL clips scope and visibility before LIMIT and payload materialization
ok 294 - authorized replay SQL clips scope and visibility before LIMIT and payload materialization
  ---
  duration_ms: 1.5611
  type: 'test'
  ...
# Subtest: Fallback Schema freezes the six safe fields, four reasons and two strategies
ok 295 - Fallback Schema freezes the six safe fields, four reasons and two strategies
  ---
  duration_ms: 1.394
  type: 'test'
  ...
# Subtest: normalization rejects invalid event, source, aggregate and scope vocabularies
ok 296 - normalization rejects invalid event, source, aggregate and scope vocabularies
  ---
  duration_ms: 1.4546
  type: 'test'
  ...
# Subtest: SESSION and THREAD require a UUID scope while SYSTEM requires null
ok 297 - SESSION and THREAD require a UUID scope while SYSTEM requires null
  ---
  duration_ms: 1.3806
  type: 'test'
  ...
# Subtest: normalization rejects invalid timestamps and requires expires_at after occurred_at
ok 298 - normalization rejects invalid timestamps and requires expires_at after occurred_at
  ---
  duration_ms: 0.6474
  type: 'test'
  ...
# Subtest: aggregate versions use nullable canonical PostgreSQL BIGINT strings
ok 299 - aggregate versions use nullable canonical PostgreSQL BIGINT strings
  ---
  duration_ms: 0.6358
  type: 'test'
  ...
# Subtest: Last-Event-ID accepts zero and the BIGINT maximum without Number conversion
ok 300 - Last-Event-ID accepts zero and the BIGINT maximum without Number conversion
  ---
  duration_ms: 0.2245
  type: 'test'
  ...
# Subtest: Last-Event-ID rejects negative, decimal, scientific, signed, spaced and overflow forms
ok 301 - Last-Event-ID rejects negative, decimal, scientific, signed, spaced and overflow forms
  ---
  duration_ms: 0.26
  type: 'test'
  ...
# Subtest: payload accepts only bounded plain finite JSON data
ok 302 - payload accepts only bounded plain finite JSON data
  ---
  duration_ms: 0.6493
  type: 'test'
  ...
# Subtest: payload enforces depth, node, object, array, string and canonical-byte limits
ok 303 - payload enforces depth, node, object, array, string and canonical-byte limits
  ---
  duration_ms: 3.4032
  type: 'test'
  ...
# Subtest: payload rejects Proxy and accessor paths without invoking hostile code
ok 304 - payload rejects Proxy and accessor paths without invoking hostile code
  ---
  duration_ms: 0.8945
  type: 'test'
  ...
# Subtest: payload rejects toJSON, symbols and prototype-pollution keys
ok 305 - payload rejects toJSON, symbols and prototype-pollution keys
  ---
  duration_ms: 0.7883
  type: 'test'
  ...
# Subtest: payload rejects message content and sensitive identifier property names
ok 306 - payload rejects message content and sensitive identifier property names
  ---
  duration_ms: 0.7571
  type: 'test'
  ...
# Subtest: event key is stable, opaque and changes with its frozen identity tuple
ok 307 - event key is stable, opaque and changes with its frozen identity tuple
  ---
  duration_ms: 1.7684
  type: 'test'
  ...
# Subtest: event hash is canonical across payload key order and changes on semantic mutation
ok 308 - event hash is canonical across payload key order and changes on semantic mutation
  ---
  duration_ms: 1.0095
  type: 'test'
  ...
# Subtest: event hash excludes expires_at, event_id and created_at
ok 309 - event hash excludes expires_at, event_id and created_at
  ---
  duration_ms: 0.5459
  type: 'test'
  ...
# Subtest: Conversation Item mapper exposes only the seven safe projection fields plus occurred_at
ok 310 - Conversation Item mapper exposes only the seven safe projection fields plus occurred_at
  ---
  duration_ms: 0.5259
  type: 'test'
  ...
# Subtest: Session fixture mapper freezes created and updated event variants with safe payloads
ok 311 - Session fixture mapper freezes created and updated event variants with safe payloads
  ---
  duration_ms: 0.5283
  type: 'test'
  ...
# Subtest: Timeline rebuilt fixture mapper exposes only count and canonical hash metadata
ok 312 - Timeline rebuilt fixture mapper exposes only count and canonical hash metadata
  ---
  duration_ms: 0.8061
  type: 'test'
  ...
# Subtest: public event view contains exactly nine safe fields and no publisher, source, hash or scope IDs
ok 313 - public event view contains exactly nine safe fields and no publisher, source, hash or scope IDs
  ---
  duration_ms: 0.7176
  type: 'test'
  ...
# Subtest: SSE event encoding uses id/type/single-line JSON and supports every frozen event type
ok 314 - SSE event encoding uses id/type/single-line JSON and supports every frozen event type
  ---
  duration_ms: 2.6802
  type: 'test'
  ...
# Subtest: SSE encoding rejects CR/LF event injection and never emits raw payload newlines
ok 315 - SSE encoding rejects CR/LF event injection and never emits raw payload newlines
  ---
  duration_ms: 0.3291
  type: 'test'
  ...
# Subtest: heartbeat is a comment frame and consumes no event id
ok 316 - heartbeat is a comment frame and consumes no event id
  ---
  duration_ms: 0.1244
  type: 'test'
  ...
# Subtest: authorization defaults to deny-all and rejects absent or malformed contexts
ok 317 - authorization defaults to deny-all and rejects absent or malformed contexts
  ---
  duration_ms: 0.5032
  type: 'test'
  ...
# Subtest: authorization normalizes bounded UUID sets without wildcard access
ok 318 - authorization normalizes bounded UUID sets without wildcard access
  ---
  duration_ms: 0.211
  type: 'test'
  ...
# Subtest: restricted-admin defense-in-depth closes a malicious replay without delivering it
ok 319 - restricted-admin defense-in-depth closes a malicious replay without delivering it
  ---
  duration_ms: 2.486
  type: 'test'
  ...
# Subtest: controlled principal disconnect closes only the selected SSE client
ok 320 - controlled principal disconnect closes only the selected SSE client
  ---
  duration_ms: 5.3187
  type: 'test'
  ...
# Subtest: disabled handler returns safe polling fallback with zero database calls and no timers
ok 321 - disabled handler returns safe polling fallback with zero database calls and no timers
  ---
  duration_ms: 0.6496
  type: 'test'
  ...
# Subtest: disabled event store fails before acquiring a database connection
ok 322 - disabled event store fails before acquiring a database connection
  ---
  duration_ms: 0.5173
  type: 'test'
  ...
# Subtest: disconnect during authentication never acquires replay, Hub, or timer resources
ok 323 - disconnect during authentication never acquires replay, Hub, or timer resources
  ---
  duration_ms: 0.3316
  type: 'test'
  ...
# Subtest: disconnect during authorization never acquires replay, Hub, or timer resources
ok 324 - disconnect during authorization never acquires replay, Hub, or timer resources
  ---
  duration_ms: 0.308
  type: 'test'
  ...
# Subtest: Wakeup Hub admits 32 clients, rejects the 33rd, and releases capacity
ok 325 - Wakeup Hub admits 32 clients, rejects the 33rd, and releases capacity
  ---
  duration_ms: 0.2111
  type: 'test'
  ...
# Subtest: replay batch configuration accepts 200 and rejects 201
ok 326 - replay batch configuration accepts 200 and rejects 201
  ---
  duration_ms: 0.16
  type: 'test'
  ...
# Subtest: list replay rejects limits above 200 before querying storage
ok 327 - list replay rejects limits above 200 before querying storage
  ---
  duration_ms: 0.3776
  type: 'test'
  ...
# Subtest: backpressure waits for drain and releases only the affected stream
ok 328 - backpressure waits for drain and releases only the affected stream
  ---
  duration_ms: 1.1001
  type: 'test'
  ...
# Subtest: drain timeout disconnects only the slow client with bounded metrics
ok 329 - drain timeout disconnects only the slow client with bounded metrics
  ---
  duration_ms: 2.3451
  type: 'test'
  ...
# Subtest: retention gap after SSE headers closes the stream and reconnect returns 410 fallback
ok 330 - retention gap after SSE headers closes the stream and reconnect returns 410 fallback
  ---
  duration_ms: 0.9399
  type: 'test'
  ...
# Subtest: polling fallback normalizes canonical IDs and rejects unsafe forms
ok 331 - polling fallback normalizes canonical IDs and rejects unsafe forms
  ---
  duration_ms: 0.1412
  type: 'test'
  ...
# Subtest: public HTTP errors expose only stable codes and never raw authentication failures
ok 332 - public HTTP errors expose only stable codes and never raw authentication failures
  ---
  duration_ms: 0.3072
  type: 'test'
  ...
# Subtest: migration 020 is exact, reentrant, CLI-scoped, check-only, and preserves 005/010/011/012 catalogs
ok 333 - migration 020 is exact, reentrant, CLI-scoped, check-only, and preserves 005/010/011/012 catalogs
  ---
  duration_ms: 1402.0289
  type: 'test'
  ...
# {"first_apply":true,"repeated_apply":true,"check_rollback":true,"frozen_catalog_relations":10}
# Subtest: migration 020 fails closed for missing columns, weakened checks, wrong unique, index method and predicate
ok 334 - migration 020 fails closed for missing columns, weakened checks, wrong unique, index method and predicate
  ---
  duration_ms: 4313.0612
  type: 'test'
  ...
# {"drift_mutations":["missingcol","weakcheck","wrongunique","indexmethod","indexpred"],"stable_error":"P2_004_SCHEMA_DRIFT_REMEDIATION_REQUIRED"}
# Subtest: Communication service commits atomically, isolates idempotency scopes, and never mutates Session
ok 335 - Communication service commits atomically, isolates idempotency scopes, and never mutates Session
  ---
  duration_ms: 2689.0476
  type: 'test'
  ...
# {"browser_double_click_concurrency":12,"committed_fact_sets":1,"human_ai_same_body_isolated":true,"internal_note_outbox_count":0}
# Subtest: Delivery Worker enforces claim CAS, ACK, retry, dead letter, timeout unknown and lease recovery
ok 336 - Delivery Worker enforces claim CAS, ACK, retry, dead letter, timeout unknown and lease recovery
  ---
  duration_ms: 2817.745
  type: 'test'
  ...
# {"concurrent_workers":12,"single_claim":true,"gateway_reconnect":true,"timeout_unknown":true,"leased_recovered":true,"sending_not_resent":true}
# Subtest: multi-target delivery is isolated, target rate limit is durable, and reconciliation is explicit
ok 337 - multi-target delivery is isolated, target rate limit is durable, and reconciliation is explicit
  ---
  duration_ms: 3828.3875
  type: 'test'
  ...
# {"multi_target_count":2,"isolated_outcomes":["SENT","DEAD_LETTER"],"target_rate_limit":true,"reconciliation_resolutions":["CONFIRMED_SENT","CONFIRMED_NOT_SENT_REQUEUE","CANCEL"]}
# Subtest: real Worker kill/restart reclaims LEASED but never blindly resends SENDING
ok 338 - real Worker kill/restart reclaims LEASED but never blindly resends SENDING
  ---
  duration_ms: 3685.0823
  type: 'test'
  ...
# {"leased_child_exit":{"code":null,"signal":"SIGKILL"},"leased_restart_sent":true,"sending_child_exit":{"code":null,"signal":"SIGKILL"},"sending_restart_reconciled":true,"blind_resend_count":0}
# Subtest: P1 compatibility is read-only until it delegates to the existing P1 worker
ok 339 - P1 compatibility is read-only until it delegates to the existing P1 worker
  ---
  duration_ms: 2786.3644
  type: 'test'
  ...
# {"p1_read_snapshot_unchanged":true,"p1_delivery_delegated":true,"communication_rows_created":0}
# Subtest: 500 deliveries remain bounded at batch 20 and interruption resumes without resource growth
ok 340 - 500 deliveries remain bounded at batch 20 and interruption resumes without resource growth
  ---
  duration_ms: 12231.3027
  type: 'test'
  ...
# {"deliveries":500,"batch_size":20,"interrupted_after":100,"resumed_to":500,"heap_samples":[13468248,13956480,16839352,17293760,20244680,17669136,20305040,19115920,22270560,24824824],"heap_growth_bytes":11356576,"soak_claimed":false}
# Subtest: P2-004 integration leaves no owned database or backend residual
ok 341 - P2-004 integration leaves no owned database or backend residual
  ---
  duration_ms: 62.7447
  type: 'test'
  ...
# {"database_count":0,"backend_count":0,"active_database_count":0,"worker_child_count":0,"worker_count":0,"timer_count":0,"child_process_count":0}
# Subtest: P2-004 JSON Schemas use draft 2020-12 and close object shapes
ok 342 - P2-004 JSON Schemas use draft 2020-12 and close object shapes
  ---
  duration_ms: 15.1171
  type: 'test'
  ...
# Subtest: Reply Command schema and future OpenAPI bind session and idempotency without exposing a target
ok 343 - Reply Command schema and future OpenAPI bind session and idempotency without exposing a target
  ---
  duration_ms: 4.2732
  type: 'test'
  ...
# Subtest: frozen Communication vocabularies are exact
ok 344 - frozen Communication vocabularies are exact
  ---
  duration_ms: 1.5663
  type: 'test'
  ...
# Subtest: normalization freezes Agent, AI, System, internal note and media contracts
ok 345 - normalization freezes Agent, AI, System, internal note and media contracts
  ---
  duration_ms: 2.4853
  type: 'test'
  ...
# Subtest: invalid UUID, row version, privacy, retention, message type, and browser authority are rejected
ok 346 - invalid UUID, row version, privacy, retention, message type, and browser authority are rejected
  ---
  duration_ms: 1.0006
  type: 'test'
  ...
# Subtest: plain JSON fence rejects Proxy, accessor, symbol, toJSON, prototype and pollution keys
ok 347 - plain JSON fence rejects Proxy, accessor, symbol, toJSON, prototype and pollution keys
  ---
  duration_ms: 0.5996
  type: 'test'
  ...
# Subtest: plain JSON fence enforces depth, node, string and array bounds
ok 348 - plain JSON fence enforces depth, node, string and array bounds
  ---
  duration_ms: 0.3268
  type: 'test'
  ...
# Subtest: content and command hashes are stable, key-order independent and cover row version
ok 349 - content and command hashes are stable, key-order independent and cover row version
  ---
  duration_ms: 1.4373
  type: 'test'
  ...
# Subtest: destination resolution uses authoritative Thread fields for single and group
ok 350 - destination resolution uses authoritative Thread fields for single and group
  ---
  duration_ms: 0.3988
  type: 'test'
  ...
# Subtest: disabled service performs zero database and authorization work
ok 351 - disabled service performs zero database and authorization work
  ---
  duration_ms: 0.5688
  type: 'test'
  ...
# Subtest: disabled Worker performs zero database and Sender calls
ok 352 - disabled Worker performs zero database and Sender calls
  ---
  duration_ms: 0.4997
  type: 'test'
  ...
# Subtest: Sender Port validates ACK, rejected, unknown and rejects malformed results
ok 353 - Sender Port validates ACK, rejected, unknown and rejects malformed results
  ---
  duration_ms: 0.4936
  type: 'test'
  ...
# Subtest: Mock Sender records only safe call metadata
ok 354 - Mock Sender records only safe call metadata
  ---
  duration_ms: 0.7039
  type: 'test'
  ...
# Subtest: message projection maps Agent, AI, Internal and System without changing ownership
ok 355 - message projection maps Agent, AI, Internal and System without changing ownership
  ---
  duration_ms: 0.5058
  type: 'test'
  ...
# Subtest: delivery timeline and realtime mappers expose only safe delivery fields
ok 356 - delivery timeline and realtime mappers expose only safe delivery fields
  ---
  duration_ms: 0.3679
  type: 'test'
  ...
# Subtest: legacy notification mapping is safe and exact
ok 357 - legacy notification mapping is safe and exact
  ---
  duration_ms: 0.1859
  type: 'test'
  ...
# Subtest: public stable error inventory excludes raw provider and storage details
ok 358 - public stable error inventory excludes raw provider and storage details
  ---
  duration_ms: 0.157
  type: 'test'
  ...
# Subtest: migration 021 is scoped, reentrant, check-rolls-back, and drift fails closed
ok 359 - migration 021 is scoped, reentrant, check-rolls-back, and drift fails closed
  ---
  duration_ms: 8493.5337
  type: 'test'
  ...
# {"first_apply":true,"repeated_apply":true,"check_rollback":true,"new_tables":4}
# Subtest: takeover is serialized/idempotent; handoff request-accept-release and request-cancel are audited atomically
ok 360 - takeover is serialized/idempotent; handoff request-accept-release and request-cancel are audited atomically
  ---
  duration_ms: 3720.8282
  type: 'test'
  ...
# {"concurrent_winners":1,"idempotent_parallel":12,"handoff":["REQUESTED","ACCEPTED","RELEASED"],"cancel":"CANCELLED"}
# Subtest: admin force transfer works; non-admin, inactive target, wrong-team handler, ended and stale commands fail closed
ok 361 - admin force transfer works; non-admin, inactive target, wrong-team handler, ended and stale commands fail closed
  ---
  duration_ms: 2769.7605
  type: 'test'
  ...
# {"admin_force_transfer":true,"handler_force":false,"inactive":false,"wrong_team":false}
# Subtest: generation race blocks stale AI before Communication and realtime failure rolls back control facts
ok 362 - generation race blocks stale AI before Communication and realtime failure rolls back control facts
  ---
  duration_ms: 2506.4929
  type: 'test'
  ...
# {"generation_start":1,"stale":true,"append_communication_calls":0,"message_delta":0,"outbox_delta":0,"delivery_delta":0,"realtime_failure_rollback":true}
# Subtest: 32 principals keep independent monotonic cursors; visibility COUNT is correct and Session versions do not move
ok 363 - 32 principals keep independent monotonic cursors; visibility COUNT is correct and Session versions do not move
  ---
  duration_ms: 3407.8315
  type: 'test'
  ...
# {"principals":32,"monotonic":true,"session_version_unchanged":true,"workbench_unread":1,"restricted_unread":2}
# Subtest: 2C4G bounded capacity covers 500 assignment/handoff facts and 2,000 cursor updates without residual resources
ok 364 - 2C4G bounded capacity covers 500 assignment/handoff facts and 2,000 cursor updates without residual resources
  ---
  duration_ms: 4723.7088
  type: 'test'
  ...
# {"assignments":500,"handoffs":500,"cursor_updates":2000,"max_list_limit":200,"heap_samples":5,"heap_monotonic_unbounded":false,"pool_max":4,"soak_24h":false}
# Subtest: all P2-005 JSON Schemas parse and freeze strict objects
ok 365 - all P2-005 JSON Schemas parse and freeze strict objects
  ---
  duration_ms: 6.2569
  type: 'test'
  ...
# Subtest: status, command, event, invalidation, and stable error vocabularies are frozen
ok 366 - status, command, event, invalidation, and stable error vocabularies are frozen
  ---
  duration_ms: 0.9379
  type: 'test'
  ...
# Subtest: normalization is bounded and command hash is stable across key order
ok 367 - normalization is bounded and command hash is stable across key order
  ---
  duration_ms: 1.7371
  type: 'test'
  ...
# Subtest: invalid identifiers, versions, sequences, reason codes, target modes, and extra authority fail closed
ok 368 - invalid identifiers, versions, sequences, reason codes, target modes, and extra authority fail closed
  ---
  duration_ms: 0.7404
  type: 'test'
  ...
# Subtest: non-plain JSON, Proxy, accessor, toJSON, symbol, cycle, and prototype pollution are rejected
ok 369 - non-plain JSON, Proxy, accessor, toJSON, symbol, cycle, and prototype pollution are rejected
  ---
  duration_ms: 0.3425
  type: 'test'
  ...
# Subtest: default authorization rejects every operation
ok 370 - default authorization rejects every operation
  ---
  duration_ms: 0.1873
  type: 'test'
  ...
# Subtest: disabled service returns before every database call and hides raw failures
ok 371 - disabled service returns before every database call and hides raw failures
  ---
  duration_ms: 0.4245
  type: 'test'
  ...
# Subtest: generation fence distinguishes current, stale, and HUMAN-forbidden without process state
ok 372 - generation fence distinguishes current, stale, and HUMAN-forbidden without process state
  ---
  duration_ms: 0.8081
  type: 'test'
  ...
# Subtest: assigned Communication authorizer denies AI flags, inactive/unassigned agents, and accepts assigned active actor
ok 373 - assigned Communication authorizer denies AI flags, inactive/unassigned agents, and accepts assigned active actor
  ---
  duration_ms: 0.6287
  type: 'test'
  ...
# Subtest: Realtime mappers expose versions/status only and no identity or content
ok 374 - Realtime mappers expose versions/status only and no identity or content
  ---
  duration_ms: 0.9014
  type: 'test'
  ...
# Subtest: Timeline mapper uses internal HANDOFF_EVENT and requires explicit privacy/retention
ok 375 - Timeline mapper uses internal HANDOFF_EVENT and requires explicit privacy/retention
  ---
  duration_ms: 0.3422
  type: 'test'
  ...
# Subtest: system browser desktop workbench flow is responsive, refresh-safe and XSS-safe
ok 376 - system browser desktop workbench flow is responsive, refresh-safe and XSS-safe
  ---
  duration_ms: 2285.0292
  type: 'test'
  ...
# {"browser":"C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe","viewport":{"label":"desktop","width":1440,"height":900},"interactions":{"select":1,"takeover":1,"transfer":1,"reply":1,"internal_note":1,"sse_update":true,"polling_fallback":true,"filter":true,"refresh_restore":true},"keyboard_focus_visible":true,"security_headers":true,"xss_executed":false,"horizontal_overflow":false}
# Subtest: system browser mobile workbench flow is responsive, refresh-safe and XSS-safe
ok 377 - system browser mobile workbench flow is responsive, refresh-safe and XSS-safe
  ---
  duration_ms: 2328.9584
  type: 'test'
  ...
# {"browser":"C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe","viewport":{"label":"mobile","width":390,"height":844},"interactions":{"select":1,"takeover":1,"transfer":1,"reply":1,"internal_note":1,"sse_update":true,"polling_fallback":true,"filter":true,"refresh_restore":true},"keyboard_focus_visible":true,"security_headers":true,"xss_executed":false,"horizontal_overflow":false}
# Subtest: system browser renders the same Workbench LocalDateTime under UTC, Tokyo, and New York
ok 378 - system browser renders the same Workbench LocalDateTime under UTC, Tokyo, and New York
  ---
  duration_ms: 1339.8068
  type: 'test'
  ...
# Subtest: P2-006 applies no DDL and leaves no isolated PostgreSQL resources
ok 379 - P2-006 applies no DDL and leaves no isolated PostgreSQL resources
  ---
  duration_ms: 2498.8481
  type: 'test'
  ...
# {"migration_022":true,"catalog_unchanged":true,"feature_enabled_only_in_test":true}
# Subtest: admin/dispatcher/handler authorization is enforced in SQL data access and timeline visibility
ok 380 - admin/dispatcher/handler authorization is enforced in SQL data access and timeline visibility
  ---
  duration_ms: 3849.1454
  type: 'test'
  ...
# {"admin_sessions":2,"dispatcher_sessions":2,"assigned_handler_sessions":1,"outsider_sessions":0,"reporter_forbidden":true,"inactive_forbidden":true,"restricted_hidden_from_handler":true}
# Subtest: 500 conversations and 10,000 items have duplicate-free keyset pages and bounded read latency
ok 381 - 500 conversations and 10,000 items have duplicate-free keyset pages and bounded read latency
  ---
  duration_ms: 47382.4942
  type: 'test'
  ...
# {"sessions":500,"items":10000,"assignments":500,"tickets":500,"deliveries":500,"list_requests":1000,"detail_requests":1000,"keyset_unique":true,"p95":{"list_ms":40.968,"detail_ms":8.924}}
# Subtest: workbench facade commits human reply, internal note, takeover and idempotent replay through P2-004/P2-005 ports
ok 382 - workbench facade commits human reply, internal note, takeover and idempotent replay through P2-004/P2-005 ports
  ---
  duration_ms: 2609.4181
  type: 'test'
  ...
# {"takeover":true,"replayed":true,"transfer":true,"release":true,"handoff_request_cancel":true,"read_cursor":1,"external_messages":1,"internal_notes":1,"external_outbox":1,"internal_outbox":0,"pending_retry":true,"dead_letter_requeue":true,"reconciliation_required_blocks_retry":true,"admin_reconciliation":true}
# Subtest: 200 real HTTP reply commits and 12-way duplicate submit remain bounded without sender calls or socket residue
ok 383 - 200 real HTTP reply commits and 12-way duplicate submit remain bounded without sender calls or socket residue
  ---
  duration_ms: 6618.6168
  type: 'test'
  ...
# {"reply_http":{"samples":200,"p50_ms":15.508,"p95_ms":20.267,"p99_ms":23.588,"max_ms":54.71},"duplicate_submit_parallel":12,"messages":201,"outboxes":201,"deliveries":201,"sender_calls":0,"heap_samples_bytes":[24824000,20540776,27715416,24839080,32144472,20892608,28070456,23817496],"pool_max":4}
# Subtest: P2-003 SSE route delivers committed messages through authorized refetch within 2 seconds and releases timers
ok 384 - P2-003 SSE route delivers committed messages through authorized refetch within 2 seconds and releases timers
  ---
  duration_ms: 5403.966
  type: 'test'
  ...
# {"new_message_commit_sse_refetch":{"samples":100,"p50_ms":20.995,"p95_ms":28.616,"p99_ms":44.542,"max_ms":104.692},"authorized_events":100,"unauthorized_events":0}
# Subtest: workbench schemas parse and OpenAPI 3.1 exposes every implemented route
ok 385 - workbench schemas parse and OpenAPI 3.1 exposes every implemented route
  ---
  duration_ms: 9.6478
  type: 'test'
  ...
# Subtest: opaque cursor round-trips normalized timestamp and session id
ok 386 - opaque cursor round-trips normalized timestamp and session id
  ---
  duration_ms: 3.6056
  type: 'test'
  ...
# Subtest: opaque cursor rejects malformed, oversized, and structurally extended values
ok 387 - opaque cursor rejects malformed, oversized, and structurally extended values
  ---
  duration_ms: 1.2772
  type: 'test'
  ...
# Subtest: disabled query service performs zero database and authorization calls
ok 388 - disabled query service performs zero database and authorization calls
  ---
  duration_ms: 1.1934
  type: 'test'
  ...
# Subtest: list SQL applies authorization in WHERE before keyset ORDER BY and LIMIT
ok 389 - list SQL applies authorization in WHERE before keyset ORDER BY and LIMIT
  ---
  duration_ms: 0.9366
  type: 'test'
  ...
# Subtest: query page limit and state filters fail closed
ok 390 - query page limit and state filters fail closed
  ---
  duration_ms: 0.4718
  type: 'test'
  ...
# Subtest: HTTP server construction fails when authentication port is absent
ok 391 - HTTP server construction fails when authentication port is absent
  ---
  duration_ms: 0.7338
  type: 'test'
  ...
# Subtest: HTTP API rejects unauthenticated and expired contexts without fallback
ok 392 - HTTP API rejects unauthenticated and expired contexts without fallback
  ---
  duration_ms: 84.5762
  type: 'test'
  ...
# Subtest: Cookie writes require exact origin, same-site context, constant-time CSRF and matching idempotency
ok 393 - Cookie writes require exact origin, same-site context, constant-time CSRF and matching idempotency
  ---
  duration_ms: 47.623
  type: 'test'
  ...
# Subtest: Bearer mode requires Authorization header and tokens in query are forbidden
ok 394 - Bearer mode requires Authorization header and tokens in query are forbidden
  ---
  duration_ms: 11.4114
  type: 'test'
  ...
# Subtest: HTTP security headers contain strict CSP without inline or eval and no wildcard CORS
ok 395 - HTTP security headers contain strict CSP without inline or eval and no wildcard CORS
  ---
  duration_ms: 10.3998
  type: 'test'
  ...
# Subtest: non-JSON and oversized write bodies are rejected with stable public errors
ok 396 - non-JSON and oversized write bodies are rejected with stable public errors
  ---
  duration_ms: 15.9568
  type: 'test'
  ...
# Subtest: command facade delegates frozen control and communication ports without sender access
ok 397 - command facade delegates frozen control and communication ports without sender access
  ---
  duration_ms: 1.4516
  type: 'test'
  ...
# Subtest: UI source renders untrusted content through text nodes only
ok 398 - UI source renders untrusted content through text nodes only
  ---
  duration_ms: 0.7365
  type: 'test'
  ...
# Subtest: UI reducer bounds conversations and timeline arrays
ok 399 - UI reducer bounds conversations and timeline arrays
  ---
  duration_ms: 0.7903
  type: 'test'
  ...
# Subtest: refresh storage persists only selected id and filter
ok 400 - refresh storage persists only selected id and filter
  ---
  duration_ms: 0.3535
  type: 'test'
  ...
# Subtest: P2-006 creates no migration and static preview check succeeds
ok 401 - P2-006 creates no migration and static preview check succeeds
  ---
  duration_ms: 202.0342
  type: 'test'
  ...
# Subtest: P2-012 real command capacity 500 candidates, 200 incidents, 2000 reports, 1000 subscriptions, 5000 events, 500 bindings and 32 SSE
ok 402 - P2-012 real command capacity 500 candidates, 200 incidents, 2000 reports, 1000 subscriptions, 5000 events, 500 bindings and 32 SSE
  ---
  duration_ms: 64227.4434
  type: 'test'
  ...
# {"candidates":500,"incidents":200,"reports":2000,"subscriptions":1000,"events":5200,"bindings":550,"notification_sent":550,"pool_max":4,"sse_max":32,"sse_after_stop":0,"heap_samples_bytes":[15272832,28265872,71410384,45308488,45164656,65574016,85538976,53138752,73563368,40328264,60552096,18615688,21067568],"heap_peak_bytes":85538976,"heap_final_bytes":21067568,"real_sdk_calls":0,"model_calls":0}
# {"cleanup":{"database_count":0,"backend_count":0}}
# Subtest: P2-012 closes input shapes, rejects hostile values and preserves deterministic command hashes
ok 403 - P2-012 closes input shapes, rejects hostile values and preserves deterministic command hashes
  ---
  duration_ms: 4.1799
  type: 'test'
  ...
# Subtest: P2-012 maintenance expires a bounded ordered batch through private SYSTEM commands without notifications
ok 404 - P2-012 maintenance expires a bounded ordered batch through private SYSTEM commands without notifications
  ---
  duration_ms: 5950.3783
  type: 'test'
  ...
# Subtest: P2-012 maintenance replays concurrent scans, handles human/time races and surfaces a still-due failure
ok 405 - P2-012 maintenance replays concurrent scans, handles human/time races and surfaces a still-due failure
  ---
  duration_ms: 6961.5461
  type: 'test'
  ...
# Subtest: P2-012 maintenance scans after import and expires an imported due candidate in the same iteration
ok 406 - P2-012 maintenance scans after import and expires an imported due candidate in the same iteration
  ---
  duration_ms: 3360.3027
  type: 'test'
  ...
# Subtest: P2-012 real database human confirmation, idempotency, recovery isolation and notification facts
ok 407 - P2-012 real database human confirmation, idempotency, recovery isolation and notification facts
  ---
  duration_ms: 5025.3738
  type: 'test'
  ...
# Subtest: dynamic live configuration requires an approved group but no preconfigured Reporter userid hash
ok 408 - dynamic live configuration requires an approved group but no preconfigured Reporter userid hash
  ---
  duration_ms: 3.6387
  type: 'test'
  ...
# Subtest: dynamic Sender rechecks the persisted approved-group Reporter before each PERSON provider call
ok 409 - dynamic Sender rechecks the persisted approved-group Reporter before each PERSON provider call
  ---
  duration_ms: 2.387
  type: 'test'
  ...
# Subtest: approved test group discovers an unconfigured Reporter before their direct flow and outbound notice
ok 410 - approved test group discovers an unconfigured Reporter before their direct flow and outbound notice
  ---
  duration_ms: 1.1987
  type: 'test'
  ...
# Subtest: P2-012 migration 032 applies atomically, detects catalog drift and preserves seven-table scope
ok 411 - P2-012 migration 032 applies atomically, detects catalog drift and preserves seven-table scope
  ---
  duration_ms: 4954.2771
  type: 'test'
  ...
# Subtest: P2-012 fresh current baseline reaches 032 and repeated status/check/apply preserve the catalog
ok 412 - P2-012 fresh current baseline reaches 032 and repeated status/check/apply preserve the catalog
  ---
  duration_ms: 6215.2027
  type: 'test'
  ...
# Subtest: P2-012 network-off three-role assembly serves Incident and closes children, sockets and pools
ok 413 - P2-012 network-off three-role assembly serves Incident and closes children, sockets and pools
  ---
  duration_ms: 8485.6083
  type: 'test'
  ...
# {"network_enabled":false,"restarted":false,"metrics":{"process_count":3,"gateway_authenticated":0,"gateway_reconnect_total":0,"app_rss_bytes":85553152,"app_heap_used_bytes":20453192,"app_heap_total_bytes":33865728,"app_external_bytes":4566034,"app_cpu_percent":19.28,"app_event_loop_delay_p95_ms":31.817727,"app_active_resources":8,"app_active_timers":2,"app_active_sockets":6,"app_active_file_handles":0,"app_active_handles":6,"app_uptime_seconds":2.04,"app_pool_total":2,"app_pool_idle":2,"app_pool_waiting":0,"app_pool_max":4,"worker_rss_bytes":92651520,"worker_heap_used_bytes":18688744,"worker_heap_total_bytes":33341440,"worker_external_bytes":4473965,"worker_cpu_percent":32.185,"worker_event_loop_delay_p95_ms":32.129023,"worker_active_resources":4,"worker_active_timers":2,"worker_active_sockets":2,"worker_active_file_handles":0,"worker_active_handles":2,"worker_uptime_seconds":2.025,"worker_pool_total":1,"worker_pool_idle":1,"worker_pool_waiting":0,"worker_pool_max":2,"gateway_rss_bytes":80244736,"gateway_heap_used_bytes":12700032,"gateway_heap_total_bytes":31866880,"gateway_external_bytes":4206782,"gateway_cpu_percent":3.082,"gateway_event_loop_delay_p95_ms":31.965183,"gateway_active_resources":2,"gateway_active_timers":1,"gateway_active_sockets":1,"gateway_active_file_handles":0,"gateway_active_handles":1,"gateway_uptime_seconds":2.063,"gateway_pool_total":0,"gateway_pool_idle":0,"gateway_pool_waiting":0,"gateway_pool_max":1,"total_rss_bytes":258449408,"total_heap_used_bytes":51841968,"total_cpu_percent":54.547,"sse_clients":0,"projection_backlog":0,"projection_failures":0,"communication_pending":1,"dead_letter":0,"reconciliation_required":0,"postgres_active_connections":1,"postgres_idle_connections":4,"postgres_other_connections":0,"postgres_max_connections":100,"postgres_connection_utilization_percent":5}}
# {"network_enabled":false,"restarted":true,"metrics":{"process_count":3,"gateway_authenticated":0,"gateway_reconnect_total":0,"app_rss_bytes":83193856,"app_heap_used_bytes":15046984,"app_heap_total_bytes":32555008,"app_external_bytes":4334348,"app_cpu_percent":35.312,"app_event_loop_delay_p95_ms":33.112063,"app_active_resources":6,"app_active_timers":1,"app_active_sockets":5,"app_active_file_handles":0,"app_active_handles":5,"app_uptime_seconds":0.986,"app_pool_total":1,"app_pool_idle":1,"app_pool_waiting":0,"app_pool_max":4,"worker_rss_bytes":91791360,"worker_heap_used_bytes":13880112,"worker_heap_total_bytes":32555008,"worker_external_bytes":4206782,"worker_cpu_percent":42.68,"worker_event_loop_delay_p95_ms":33.882111,"worker_active_resources":4,"worker_active_timers":2,"worker_active_sockets":2,"worker_active_file_handles":0,"worker_active_handles":2,"worker_uptime_seconds":0.981,"worker_pool_total":1,"worker_pool_idle":0,"worker_pool_waiting":0,"worker_pool_max":2,"gateway_rss_bytes":79462400,"gateway_heap_used_bytes":12704808,"gateway_heap_total_bytes":31604736,"gateway_external_bytes":4206782,"gateway_cpu_percent":17.522,"gateway_event_loop_delay_p95_ms":31.768575,"gateway_active_resources":2,"gateway_active_timers":1,"gateway_active_sockets":1,"gateway_active_file_handles":0,"gateway_active_handles":1,"gateway_uptime_seconds":0.994,"gateway_pool_total":0,"gateway_pool_idle":0,"gateway_pool_waiting":0,"gateway_pool_max":1,"total_rss_bytes":254447616,"total_heap_used_bytes":41631904,"total_cpu_percent":95.514,"sse_clients":0,"projection_backlog":0,"projection_failures":0,"communication_pending":1,"dead_letter":0,"reconciliation_required":0,"postgres_active_connections":2,"postgres_idle_connections":3,"postgres_other_connections":0,"postgres_max_connections":100,"postgres_connection_utilization_percent":5}}
# Subtest: P2-012 Reporter HTTP preserves bound grants, refresh ETag, safe milestones and unlink visibility
ok 414 - P2-012 Reporter HTTP preserves bound grants, refresh ETag, safe milestones and unlink visibility
  ---
  duration_ms: 4252.5652
  type: 'test'
  ...
# Subtest: P2-012 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
ok 415 - P2-012 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
  ---
  duration_ms: 7182.26
  type: 'test'
  ...
# {"server_commit_response_lost":true,"restart_replayed":true,"incident_confirmed_event_count":1,"unknown_recovery_send_calls":0,"authorized_retry_calls":1,"ack_restart_send_calls":0}
# Subtest: P2-012 static authorization, frozen predecessors, scope, schemas and synthetic fixture gate
ok 416 - P2-012 static authorization, frozen predecessors, scope, schemas and synthetic fixture gate
  ---
  duration_ms: 4368.0454
  type: 'test'
  ...
# Subtest: P2-012 live runner fails before network/listener unless all five independent fuses and verified evidence exist
ok 417 - P2-012 live runner fails before network/listener unless all five independent fuses and verified evidence exist
  ---
  duration_ms: 1.2522
  type: 'test'
  ...
# Subtest: P2-012 readiness cannot be fabricated from partial regression, skips, changed inputs or live claims
ok 418 - P2-012 readiness cannot be fabricated from partial regression, skips, changed inputs or live claims
  ---
  duration_ms: 0.3626
  type: 'test'
  ...
# Subtest: P2-012 DONE requires the approved live candidate, client confirmation, clean Incident deliveries and complete regressions
ok 419 - P2-012 DONE requires the approved live candidate, client confirmation, clean Incident deliveries and complete regressions
  ---
  duration_ms: 0.3392
  type: 'test'
  ...
# Subtest: P2-012 frozen candidate permits only the explicit closeout governance set
ok 420 - P2-012 frozen candidate permits only the explicit closeout governance set
  ---
  duration_ms: 0.3236
  type: 'test'
  ...
# Subtest: P2-012 review hardening preserves exact paths and requires independent current regression evidence
ok 421 - P2-012 review hardening preserves exact paths and requires independent current regression evidence
  ---
  duration_ms: 0.3597
  type: 'test'
  ...
# Subtest: P2-012 incomplete persisted Candidate summary remains explicit and does not invent clustering evidence
ok 422 - P2-012 incomplete persisted Candidate summary remains explicit and does not invent clustering evidence
  ---
  duration_ms: 2.4167
  type: 'test'
  ...
# Subtest: P2-012 four scope permissions, authorization before replay, expiry maintenance and closed schemas
ok 423 - P2-012 four scope permissions, authorization before replay, expiry maintenance and closed schemas
  ---
  duration_ms: 4198.1651
  type: 'test'
  ...
# Subtest: P2-012 approved-group Reporter discovery persists before direct intake, Sender scope and database guard
ok 424 - P2-012 approved-group Reporter discovery persists before direct intake, Sender scope and database guard
  ---
  duration_ms: 3207.5967
  type: 'test'
  ...
# Subtest: P2-012 real direct-leg eligibility suppresses group-only Ticket artifacts and validates persisted destination scope
ok 425 - P2-012 real direct-leg eligibility suppresses group-only Ticket artifacts and validates persisted destination scope
  ---
  duration_ms: 3994.8026
  type: 'test'
  ...
# Subtest: P2-012 cross-channel same reporter, pending activation, pause, unlink and reporter-safe history
ok 426 - P2-012 cross-channel same reporter, pending activation, pause, unlink and reporter-safe history
  ---
  duration_ms: 4047.8235
  type: 'test'
  ...
# Subtest: P2-012 fixed notices reuse sender, restart persistence, explicit UNKNOWN reconciliation and no blind resend
ok 427 - P2-012 fixed notices reuse sender, restart persistence, explicit UNKNOWN reconciliation and no blind resend
  ---
  duration_ms: 4122.0974
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 1440x900 human confirmation, refresh and accessibility
ok 428 - P2-012 database-backed browser 1440x900 human confirmation, refresh and accessibility
  ---
  duration_ms: 10063.1877
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 1366x768 human confirmation, refresh and accessibility
ok 429 - P2-012 database-backed browser 1366x768 human confirmation, refresh and accessibility
  ---
  duration_ms: 15598.7285
  type: 'test'
  ...
# Subtest: P2-012 database-backed browser 390x844 human confirmation, refresh and accessibility
ok 430 - P2-012 database-backed browser 390x844 human confirmation, refresh and accessibility
  ---
  duration_ms: 5981.5826
  type: 'test'
  ...
# Subtest: P2-012 actual HTTP inherits authentication, CSRF, command fence and durable realtime
ok 431 - P2-012 actual HTTP inherits authentication, CSRF, command fence and durable realtime
  ---
  duration_ms: 3997.8847
  type: 'test'
  ...
# Subtest: reporter identity is HMAC-bound and directory failures defer safely
ok 432 - reporter identity is HMAC-bound and directory failures defer safely
  ---
  duration_ms: 6.2556
  type: 'test'
  ...
# Subtest: direct association follows reliable priorities and never uses userid plus time
ok 433 - direct association follows reliable priorities and never uses userid plus time
  ---
  duration_ms: 2.0904
  type: 'test'
  ...
# Subtest: manual review internal query and resolve default deny before storage access
ok 434 - manual review internal query and resolve default deny before storage access
  ---
  duration_ms: 2.5081
  type: 'test'
  ...
# Subtest: migration 030 supports fresh baseline, check rollback, apply, no-op and five drift failures
ok 435 - migration 030 supports fresh baseline, check rollback, apply, no-op and five drift failures
  ---
  duration_ms: 5816.2999
  type: 'test'
  ...
# Subtest: orchestrator persists three entries, keeps threads separate and replays Ticket/Communication safely
ok 436 - orchestrator persists three entries, keeps threads separate and replays Ticket/Communication safely
  ---
  duration_ms: 2701.4952
  type: 'test'
  ...
# Subtest: rule failure reaches review; authorized keyset query and concurrent human resolution append one override
ok 437 - rule failure reaches review; authorized keyset query and concurrent human resolution append one override
  ---
  duration_ms: 2562.9038
  type: 'test'
  ...
# Subtest: continuation refs are hashed, reporter/bot bound, expiring, revocable and single-use
ok 438 - continuation refs are hashed, reporter/bot bound, expiring, revocable and single-use
  ---
  duration_ms: 2353.8229
  type: 'test'
  ...
# Subtest: migration 001 through 022 and P2-007 runtime are unchanged from origin/main
ok 439 - migration 001 through 022 and P2-007 runtime are unchanged from origin/main
  ---
  duration_ms: 44.4463
  type: 'test'
  ...
# Subtest: strict feature flags default false and reject non-canonical values
ok 440 - strict feature flags default false and reject non-canonical values
  ---
  duration_ms: 1.8274
  type: 'test'
  ...
# Subtest: ordinary JSON boundary rejects proxy, accessor, symbol, toJSON, cycles and pollution keys
ok 441 - ordinary JSON boundary rejects proxy, accessor, symbol, toJSON, cycles and pollution keys
  ---
  duration_ms: 0.3571
  type: 'test'
  ...
# Subtest: router protects faults from acknowledgement and maps required examples
ok 442 - router protects faults from acknowledgement and maps required examples
  ---
  duration_ms: 51.0564
  type: 'test'
  ...
# Subtest: ten result codes are reachable and deterministic
ok 443 - ten result codes are reachable and deterministic
  ---
  duration_ms: 72.2548
  type: 'test'
  ...
# Subtest: clinical high risk reaches review and unsupported root cause is never confirmed
ok 444 - clinical high risk reaches review and unsupported root cause is never confirmed
  ---
  duration_ms: 29.2802
  type: 'test'
  ...
# Subtest: gold manifest references all 96 + 42 + 64 frozen cases with ten routes
ok 445 - gold manifest references all 96 + 42 + 64 frozen cases with ten routes
  ---
  duration_ms: 1.3287
  type: 'test'
  ...
# Subtest: crash before commit leaves no partial facts; crash after commit restarts as replay
ok 446 - crash before commit leaves no partial facts; crash after commit restarts as replay
  ---
  duration_ms: 3324.1997
  type: 'test'
  ...
# {"crash_before_commit_partial_facts":{"journeys":0,"decisions":0,"tickets":0},"crash_after_commit":{"journeys":1,"decisions":1,"tickets":1},"restart_processed":0,"replay_duplicate_delta":0}
# Subtest: bounded worker processes 500 journeys, 2000 turns, 500 decisions and 100 reviews on one worker
ok 447 - bounded worker processes 500 journeys, 2000 turns, 500 decisions and 100 reviews on one worker
  ---
  duration_ms: 11003.0034
  type: 'test'
  ...
# {"journeys":500,"turns":2000,"decisions":500,"reviews":100,"worker_count":1,"pool_max":4,"batch_max":100,"heap_samples_bytes":[16730488,16605064,21224792,30450816,24659800,19170424],"heap_fall_or_stable":true,"timer_active_after_stop":false,"soak_24h":false}
# Subtest: worker defaults are bounded and disabled flags claim nothing
ok 448 - worker defaults are bounded and disabled flags claim nothing
  ---
  duration_ms: 1.8039
  type: 'test'
  ...
# Subtest: worker rejects batches above maximum without querying storage
ok 449 - worker rejects batches above maximum without querying storage
  ---
  duration_ms: 0.6079
  type: 'test'
  ...
# Subtest: P2-016 bounded capacity: 500 Tickets / 5000 events / 200 review resolutions / 500 cards / 100 sessions / 32 SSE
ok 450 - P2-016 bounded capacity: 500 Tickets / 5000 events / 200 review resolutions / 500 cards / 100 sessions / 32 SSE
  ---
  duration_ms: 63166.1552
  type: 'test'
  ...
# {"tickets":500,"ticket_events":5000,"review_resolutions":200,"cards":500,"group_receipts":400,"reporter_sessions":100,"pool_max":4,"sse_max":32,"sse_after_stop":0,"heap_samples_bytes":[14677664,30840432,28849088,38066920,67937880,60125088,36212936,81635936,105418456,38079864,24916376,46644848,27410528,49140360,26614568,48335568,29414824,50908312,27225576,44310240,59977224,27342552,46782928,63048576,31652128,47581144,62621312,27667744,50362720,34500120],"heap_peak_bytes":105418456,"heap_final_bytes":34500120,"heap_fall_or_stable":true,"real_sdk_calls":0,"soak_24h":false}
# {"cleanup":{"database_count":0,"backend_count":0}}
# Subtest: P2-016 plain JSON excludes active objects without invoking user hooks
ok 451 - P2-016 plain JSON excludes active objects without invoking user hooks
  ---
  duration_ms: 2.6872
  type: 'test'
  ...
# Subtest: P2-016 strict command, versions, closed keys and bounded lists
ok 452 - P2-016 strict command, versions, closed keys and bounded lists
  ---
  duration_ms: 1.8948
  type: 'test'
  ...
# Subtest: notification policy includes created
ok 453 - notification policy includes created
  ---
  duration_ms: 0.2047
  type: 'test'
  ...
# Subtest: notification policy includes accepted
ok 454 - notification policy includes accepted
  ---
  duration_ms: 0.12
  type: 'test'
  ...
# Subtest: notification policy includes started
ok 455 - notification policy includes started
  ---
  duration_ms: 0.1076
  type: 'test'
  ...
# Subtest: notification policy includes resumed
ok 456 - notification policy includes resumed
  ---
  duration_ms: 0.1194
  type: 'test'
  ...
# Subtest: notification policy includes waiting_requester
ok 457 - notification policy includes waiting_requester
  ---
  duration_ms: 0.0835
  type: 'test'
  ...
# Subtest: notification policy includes waiting_vendor
ok 458 - notification policy includes waiting_vendor
  ---
  duration_ms: 0.0869
  type: 'test'
  ...
# Subtest: notification policy includes resolved
ok 459 - notification policy includes resolved
  ---
  duration_ms: 0.1056
  type: 'test'
  ...
# Subtest: notification policy includes closed
ok 460 - notification policy includes closed
  ---
  duration_ms: 0.3223
  type: 'test'
  ...
# Subtest: notification policy includes reopened
ok 461 - notification policy includes reopened
  ---
  duration_ms: 0.1314
  type: 'test'
  ...
# Subtest: notification policy includes cancelled
ok 462 - notification policy includes cancelled
  ---
  duration_ms: 0.1043
  type: 'test'
  ...
# Subtest: notes and assignment changes never become external free-text notifications
ok 463 - notes and assignment changes never become external free-text notifications
  ---
  duration_ms: 0.1235
  type: 'test'
  ...
# Subtest: template card exact shape, last-four and safe immutable view
ok 464 - template card exact shape, last-four and safe immutable view
  ---
  duration_ms: 1.1992
  type: 'test'
  ...
# Subtest: card rejects unsafe origin javascript:alert(1)
ok 465 - card rejects unsafe origin javascript:alert(1)
  ---
  duration_ms: 0.1855
  type: 'test'
  ...
# Subtest: card rejects unsafe origin data:text/html,x
ok 466 - card rejects unsafe origin data:text/html,x
  ---
  duration_ms: 0.094
  type: 'test'
  ...
# Subtest: card rejects unsafe origin file:///x
ok 467 - card rejects unsafe origin file:///x
  ---
  duration_ms: 0.0775
  type: 'test'
  ...
# Subtest: card rejects unsafe origin http://reporter.example.test
ok 468 - card rejects unsafe origin http://reporter.example.test
  ---
  duration_ms: 0.0688
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://attacker.invalid
ok 469 - card rejects unsafe origin https://attacker.invalid
  ---
  duration_ms: 0.0731
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://[userinfo]@reporter.example.test
ok 470 - card rejects unsafe origin https://[userinfo]@reporter.example.test
  ---
  duration_ms: 0.0607
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://reporter.example.test/?grant=abc
ok 471 - card rejects unsafe origin https://reporter.example.test/?grant=abc
  ---
  duration_ms: 0.0511
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://reporter.example.test/\#x
ok 472 - card rejects unsafe origin https://reporter.example.test/\#x
  ---
  duration_ms: 0.0673
  type: 'test'
  ...
# Subtest: card rejects unsafe origin https://reporter.example.test/path
ok 473 - card rejects unsafe origin https://reporter.example.test/path
  ---
  duration_ms: 0.0536
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":0}
ok 474 - sender accepts only explicit numeric ACK {"errcode":0}
  ---
  duration_ms: 1.0651
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"body":{"errcode":0}}
ok 475 - sender accepts only explicit numeric ACK {"body":{"errcode":0}}
  ---
  duration_ms: 0.3482
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {}
ok 476 - sender accepts only explicit numeric ACK {}
  ---
  duration_ms: 0.2832
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":"0"}
ok 477 - sender accepts only explicit numeric ACK {"errcode":"0"}
  ---
  duration_ms: 0.2428
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":null}
ok 478 - sender accepts only explicit numeric ACK {"errcode":null}
  ---
  duration_ms: 0.4977
  type: 'test'
  ...
# Subtest: sender accepts only explicit numeric ACK {"errcode":40001}
ok 479 - sender accepts only explicit numeric ACK {"errcode":40001}
  ---
  duration_ms: 0.328
  type: 'test'
  ...
# Subtest: sender fail-closed {"enabled":false}
ok 480 - sender fail-closed {"enabled":false}
  ---
  duration_ms: 0.1437
  type: 'test'
  ...
# Subtest: sender fail-closed {"cardEnabled":false}
ok 481 - sender fail-closed {"cardEnabled":false}
  ---
  duration_ms: 0.0757
  type: 'test'
  ...
# Subtest: sender fail-closed {"target":"not-allowlisted"}
ok 482 - sender fail-closed {"target":"not-allowlisted"}
  ---
  duration_ms: 0.2341
  type: 'test'
  ...
# Subtest: sender fail-closed {"binding":false}
ok 483 - sender fail-closed {"binding":false}
  ---
  duration_ms: 0.2175
  type: 'test'
  ...
# Subtest: gateway unavailable before network is retry-safe, no SDK call
ok 484 - gateway unavailable before network is retry-safe, no SDK call
  ---
  duration_ms: 0.5278
  type: 'test'
  ...
# Subtest: live inbound is clipped before persistence by approved bot, person and group hashes
ok 485 - live inbound is clipped before persistence by approved bot, person and group hashes
  ---
  duration_ms: 0.5805
  type: 'test'
  ...
# Subtest: Ticket delivery operator commands authorize before receipt, persist idempotence and never blindly retry UNKNOWN
ok 486 - Ticket delivery operator commands authorize before receipt, persist idempotence and never blindly retry UNKNOWN
  ---
  duration_ms: 2187.6778
  type: 'test'
  ...
# Subtest: P2-016 real-format group wakeup and direct description remain one Journey through public queries
ok 487 - P2-016 real-format group wakeup and direct description remain one Journey through public queries
  ---
  duration_ms: 2271.1555
  type: 'test'
  ...
# Subtest: P2-016 group-to-direct unique binding preserves Journey; ambiguous, consumed and expired candidates never guess
ok 488 - P2-016 group-to-direct unique binding preserves Journey; ambiguous, consumed and expired candidates never guess
  ---
  duration_ms: 8612.2293
  type: 'test'
  ...
# Subtest: P2-016 later same-group description preserves the recorded entry mode instead of rejecting the Journey
ok 489 - P2-016 later same-group description preserves the recorded entry mode instead of rejecting the Journey
  ---
  duration_ms: 2219.8502
  type: 'test'
  ...
# Subtest: P2-016 approved topology uses three real bounded processes, rule-first Worker and zero live SDK calls
ok 490 - P2-016 approved topology uses three real bounded processes, rule-first Worker and zero live SDK calls
  ---
  duration_ms: 3745.405
  type: 'test'
  ...
# {"process_count":3,"pool_max":7,"live_provider_calls":0,"rule_first_worker":true}
# Subtest: P2-016 live harness requires exact owner fuses and HTTPS bounded configuration, without logging secrets
ok 491 - P2-016 live harness requires exact owner fuses and HTTPS bounded configuration, without logging secrets
  ---
  duration_ms: 3.9948
  type: 'test'
  ...
# Subtest: P2-016 live requires an exact verified candidate and at least 15 minutes; cannot claim final completion
ok 492 - P2-016 live requires an exact verified candidate and at least 15 minutes; cannot claim final completion
  ---
  duration_ms: 0.3753
  type: 'test'
  ...
# Subtest: P2-016 live CLI with no approvals exits before DB, listener, Evidence or SDK work
ok 493 - P2-016 live CLI with no approvals exits before DB, listener, Evidence or SDK work
  ---
  duration_ms: 220.5707
  type: 'test'
  ...
# Subtest: P2-016 review resolution and Safe Action commit or roll back together
ok 494 - P2-016 review resolution and Safe Action commit or roll back together
  ---
  duration_ms: 1758.8829
  type: 'test'
  ...
# Subtest: P2-016 migration is atomic, check-only, exact, reentrant and drift-failing
    # Subtest: rejects table drift
    ok 1 - rejects table drift
      ---
      duration_ms: 30.8674
      type: 'test'
      ...
    # Subtest: rejects column drift
    ok 2 - rejects column drift
      ---
      duration_ms: 17.4295
      type: 'test'
      ...
    # Subtest: rejects type drift
    ok 3 - rejects type drift
      ---
      duration_ms: 26.6888
      type: 'test'
      ...
    # Subtest: rejects default drift
    ok 4 - rejects default drift
      ---
      duration_ms: 17.5653
      type: 'test'
      ...
    # Subtest: rejects constraint drift
    ok 5 - rejects constraint drift
      ---
      duration_ms: 16.5425
      type: 'test'
      ...
    # Subtest: rejects index drift
    ok 6 - rejects index drift
      ---
      duration_ms: 16.9768
      type: 'test'
      ...
    # Subtest: rejects foreign_key drift
    ok 7 - rejects foreign_key drift
      ---
      duration_ms: 17.3455
      type: 'test'
      ...
    1..7
ok 495 - P2-016 migration is atomic, check-only, exact, reentrant and drift-failing
  ---
  duration_ms: 2067.5232
  type: 'test'
  ...
# Subtest: P2-016 persisted card delivery, HMAC grants, one-use sessions and reporter-safe timeline
ok 496 - P2-016 persisted card delivery, HMAC grants, one-use sessions and reporter-safe timeline
  ---
  duration_ms: 1595.6535
  type: 'test'
  ...
# Subtest: P2-016 existing rule worker creates Ticket notifications, safe group/direct guidance and SYSTEM-only timeout closure
ok 497 - P2-016 existing rule worker creates Ticket notifications, safe group/direct guidance and SYSTEM-only timeout closure
  ---
  duration_ms: 2188.8446
  type: 'test'
  ...
# Subtest: Reporter browser 1440x900 real DB/session, fragment removal, refresh, timezone, safe data and logout
ok 498 - Reporter browser 1440x900 real DB/session, fragment removal, refresh, timezone, safe data and logout
  ---
  duration_ms: 4130.6979
  type: 'test'
  ...
# Subtest: Reporter browser 390x844 real DB/session, fragment removal, refresh, timezone, safe data and logout
ok 499 - Reporter browser 390x844 real DB/session, fragment removal, refresh, timezone, safe data and logout
  ---
  duration_ms: 4006.4383
  type: 'test'
  ...
# Subtest: Reporter grant expiry, HMAC rotation, one-consume concurrency, session expiry/revocation and cross-ticket isolation
ok 500 - Reporter grant expiry, HMAC rotation, one-consume concurrency, session expiry/revocation and cross-ticket isolation
  ---
  duration_ms: 2111.4636
  type: 'test'
  ...
# Subtest: P2-016 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
ok 501 - P2-016 real process crash/restart: response loss replays receipt; unknown send reconciles and ACK never resends
  ---
  duration_ms: 4220.945
  type: 'test'
  ...
# {"server_commit_response_lost":true,"restart_replayed":true,"ticket_event_count":1,"unknown_recovery_send_calls":0,"authorized_retry_calls":1,"ack_restart_send_calls":0}
# Subtest: P2-016 architecture guards preserve authorization, immutable baselines and closed contracts
ok 502 - P2-016 architecture guards preserve authorization, immutable baselines and closed contracts
  ---
  duration_ms: 1819.8139
  type: 'test'
  ...
# Subtest: P2-016 default validator still requires readiness Evidence; deferred source checks cannot authorize live work
ok 503 - P2-016 default validator still requires readiness Evidence; deferred source checks cannot authorize live work
  ---
  duration_ms: 1650.615
  type: 'test'
  ...
# Subtest: P2-016 schemas and declarations exist; Reporter outputs cannot contain internal identity or credentials
ok 504 - P2-016 schemas and declarations exist; Reporter outputs cannot contain internal identity or credentials
  ---
  duration_ms: 14.7619
  type: 'test'
  ...
# Subtest: JSON contract rejects extra keys, noncanonical types and offset time
ok 505 - JSON contract rejects extra keys, noncanonical types and offset time
  ---
  duration_ms: 7.024
  type: 'test'
  ...
# Subtest: P2-016 closeout freezes every business input and the exact file set
ok 506 - P2-016 closeout freezes every business input and the exact file set
  ---
  duration_ms: 0.3611
  type: 'test'
  ...
# Subtest: P2-016 completion requires owner approval, precise candidates, live duration and zero-skip final regression
ok 507 - P2-016 completion requires owner approval, precise candidates, live duration and zero-skip final regression
  ---
  duration_ms: 0.516
  type: 'test'
  ...
# Subtest: Real DB internal browser traverses every user lifecycle action, transfer and atomic takeover/accept
ok 508 - Real DB internal browser traverses every user lifecycle action, transfer and atomic takeover/accept
  ---
  duration_ms: 6833.3381
  type: 'test'
  ...
# Subtest: P2-016 Ticket lifecycle, command persistence, authorization and independent responsibility
ok 509 - P2-016 Ticket lifecycle, command persistence, authorization and independent responsibility
  ---
  duration_ms: 4048.6205
  type: 'test'
  ...
# Subtest: P2-016 native browser 1440x900 command, review, refresh, SSE, polling, XSS and auth-expiry
ok 510 - P2-016 native browser 1440x900 command, review, refresh, SSE, polling, XSS and auth-expiry
  ---
  duration_ms: 7357.4357
  type: 'test'
  ...
# Subtest: P2-016 native browser 390x844 command, review, refresh, SSE, polling, XSS and auth-expiry
ok 511 - P2-016 native browser 390x844 command, review, refresh, SSE, polling, XSS and auth-expiry
  ---
  duration_ms: 7871.1534
  type: 'test'
  ...
# Subtest: confirmation survives realtime refetch and rejects a stale version instead of overwriting the form
ok 512 - confirmation survives realtime refetch and rejects a stale version instead of overwriting the form
  ---
  duration_ms: 2025.0858
  type: 'test'
  ...
# Subtest: P2-016 actual HTTP assembly: fail-closed flags, auth, CSRF, Ticket actions and durable SSE
ok 513 - P2-016 actual HTTP assembly: fail-closed flags, auth, CSRF, Ticket actions and durable SSE
  ---
  duration_ms: 3353.7204
  type: 'test'
  ...
# Subtest: P2-G1 system browser duplicate submit fence sends one human reply and preserves safe rendering
ok 514 - P2-G1 system browser duplicate submit fence sends one human reply and preserves safe rendering
  ---
  duration_ms: 1920.9339
  type: 'test'
  ...
# {"browser":"C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe","viewport":{"width":390,"height":844},"replay_events":100,"realtime_list_calls":3,"duplicate_submit_calls":1,"polling_fallback":true,"xss_executed":false,"horizontal_overflow":false}
# Subtest: P2-G1 system browser preserves native SSE reconnect and sends Last-Event-ID
ok 515 - P2-G1 system browser preserves native SSE reconnect and sends Last-Event-ID
  ---
  duration_ms: 4959.1879
  type: 'test'
  ...
# {"sse_connections":2,"last_event_id_used":true,"polling_stopped_after_reconnect":true}
# Subtest: P2-G1 live browser sessions navigate to the actual Workbench route with isolated cookies
ok 516 - P2-G1 live browser sessions navigate to the actual Workbench route with isolated cookies
  ---
  duration_ms: 4836.7738
  type: 'test'
  ...
# {"browser_sessions":2,"workbench_route_requests":2,"isolated_cookie_headers":true,"root_not_requested":true,"safe_telemetry":true}
# Subtest: P2-G1 P1 commit, durable projection recovery, duplicate idempotency, participant isolation and catalog invariance
ok 517 - P2-G1 P1 commit, durable projection recovery, duplicate idempotency, participant isolation and catalog invariance
  ---
  duration_ms: 4093.575
  type: 'test'
  ...
# {"tickets":3,"duplicate_ticket_delta":0,"duplicate_item_delta":0,"participant_sessions":3,"first_versions":[1,1],"next_versions":[2,2],"p1_survived_projection_failure":true,"recovery_backlog":0,"catalog_unchanged":true}
# Subtest: P2-G1 different Intake atomically ends the prior participant Session before opening the next
ok 518 - P2-G1 different Intake atomically ends the prior participant Session before opening the next
  ---
  duration_ms: 3960.1262
  type: 'test'
  ...
# {"different_intake_sessions":2,"prior_ended":1,"active_sessions":1,"active_versions":[1,1],"projection_failures":0}
# Subtest: P2-G1 fault paths serialize takeover, isolate internal note, deduplicate reply and recover delivery without blind resend
ok 519 - P2-G1 fault paths serialize takeover, isolate internal note, deduplicate reply and recover delivery without blind resend
  ---
  duration_ms: 4649.1614
  type: 'test'
  ...
# {"concurrent_takeover_winners":1,"internal_note":{"message":1,"outbox":0,"delivery":0},"duplicate_reply_parallel":12,"reply":{"messages":1,"outboxes":1,"deliveries":1},"gateway_unavailable_pending":true,"reconnect_provider_calls":1,"unknown_reconciliation":true,"ai_calls":0,"ocr_calls":0}
# Subtest: P2-G1 local runtime binds one loopback App and reports human-only readiness with strict Test Auth
ok 520 - P2-G1 local runtime binds one loopback App and reports human-only readiness with strict Test Auth
  ---
  duration_ms: 3368.8456
  type: 'test'
  ...
# {"app_processes":1,"loopback_http":true,"readiness":true,"gateway_required":false,"active_gateway_count":0,"projection_batch":20,"communication_batch":20,"communication_sender":"MOCK","sse_client_cap":32,"dynamic_realtime_authorization":true,"test_auth_http_only":true,"human_only":true}
# Subtest: P2-G1 process cluster runs App, Worker and Gateway in three bounded Node processes
ok 521 - P2-G1 process cluster runs App, Worker and Gateway in three bounded Node processes
  ---
  duration_ms: 3289.1355
  type: 'test'
  ...
# {"process_count":3,"app_pool_max":4,"worker_pool_max":2,"gateway_pool_max":1,"combined_runtime":false,"raw_identifiers_recorded":false}
# Subtest: P2-G1 isolated PostgreSQL Replay Gap drives real Edge through Last-Event-ID, 410 and refetch
ok 522 - P2-G1 isolated PostgreSQL Replay Gap drives real Edge through Last-Event-ID, 410 and refetch
  ---
  duration_ms: 16046.3047
  type: 'test'
  ...
# {"http_status":410,"last_event_id":true,"refetch":["LIST","DETAIL","TIMELINE"],"process_count":3,"isolated_database_cleanup":true}
# Subtest: P2-G1 bounded capacity projects 1000 synthetic inbound facts and drains 500 deliveries with no catalog drift
ok 523 - P2-G1 bounded capacity projects 1000 synthetic inbound facts and drains 500 deliveries with no catalog drift
  ---
  duration_ms: 45313.8307
  type: 'test'
  ...
# {"synthetic_inbound":1000,"projected":1000,"delivery_backlog":500,"delivery_sent":500,"sender_calls":500,"projector_batch":20,"delivery_batch":20,"pool_max":4,"catalog_unchanged":true,"oom":0,"soak_24h":false}
# Subtest: live CLI exposes only the six explicit modes and requires three process fuses for sending
ok 524 - live CLI exposes only the six explicit modes and requires three process fuses for sending
  ---
  duration_ms: 1.2727
  type: 'test'
  ...
# Subtest: gateway process can commit inbound before the App process projects it
ok 525 - gateway process can commit inbound before the App process projects it
  ---
  duration_ms: 0.9962
  type: 'test'
  ...
# Subtest: process resource interface exposes bounded role metrics without a PID or environment
ok 526 - process resource interface exposes bounded role metrics without a PID or environment
  ---
  duration_ms: 0.7177
  type: 'test'
  ...
# Subtest: gateway permits one active WSClient, gates readiness on authentication, reconnects and shuts down cleanly
ok 527 - gateway permits one active WSClient, gates readiness on authentication, reconnects and shuts down cleanly
  ---
  duration_ms: 4.5075
  type: 'test'
  ...
# Subtest: sender enforces persistent target hash allowlist and maps ACK, explicit rejection, unknown and gateway-unavailable safely
ok 528 - sender enforces persistent target hash allowlist and maps ACK, explicit rejection, unknown and gateway-unavailable safely
  ---
  duration_ms: 1.4627
  type: 'test'
  ...
# Subtest: test authentication is server-configured, active non-reporter only, short-lived and emits strict HttpOnly cookie metadata
ok 529 - test authentication is server-configured, active non-reporter only, short-lived and emits strict HttpOnly cookie metadata
  ---
  duration_ms: 0.7375
  type: 'test'
  ...
# Subtest: test authentication isolates two configured principals with independent short-lived cookies and CSRF values
ok 530 - test authentication isolates two configured principals with independent short-lived cookies and CSRF values
  ---
  duration_ms: 0.5792
  type: 'test'
  ...
# Subtest: live harness requires two distinct configured principals and creates a safe unique run id
ok 531 - live harness requires two distinct configured principals and creates a safe unique run id
  ---
  duration_ms: 0.2605
  type: 'test'
  ...
# Subtest: disabled coordinator performs no database work and batch/stream inventory are bounded
ok 532 - disabled coordinator performs no database work and batch/stream inventory are bounded
  ---
  duration_ms: 0.2842
  type: 'test'
  ...
# Subtest: temporary database failure is isolated behind stable projection errors without raw details or false success
ok 533 - temporary database failure is isolated behind stable projection errors without raw details or false success
  ---
  duration_ms: 0.5256
  type: 'test'
  ...
# Subtest: P2-002 transaction hook is optional and P2-G1 browser source has an in-flight duplicate-submit fence
ok 534 - P2-002 transaction hook is optional and P2-G1 browser source has an in-flight duplicate-submit fence
  ---
  duration_ms: 1.6979
  type: 'test'
  ...
# Subtest: live script has no broad --live mode and no default live-send npm command
ok 535 - live script has no broad --live mode and no default live-send npm command
  ---
  duration_ms: 0.9709
  type: 'test'
  ...
# Subtest: shared pg factory preserves date/time/timestamp/timestamptz/tsrange/BIGINT strings and JSON objects
ok 536 - shared pg factory preserves date/time/timestamp/timestamptz/tsrange/BIGINT strings and JSON objects
  ---
  duration_ms: 40.7527
  type: 'test'
  ...
# Subtest: shared pg factory rejects Date recursively before sending SQL
ok 537 - shared pg factory rejects Date recursively before sending SQL
  ---
  duration_ms: 27.1586
  type: 'test'
  ...
# Subtest: LocalDate, LocalTime, and LocalDateTime accept real Asia/Shanghai calendar values
ok 538 - LocalDate, LocalTime, and LocalDateTime accept real Asia/Shanghai calendar values
  ---
  duration_ms: 1.8497
  type: 'test'
  ...
# Subtest: LocalDateTime rejects invalid dates, T/Z/UTC/offset/IANA, fractions, whitespace, and objects
ok 539 - LocalDateTime rejects invalid dates, T/Z/UTC/offset/IANA, fractions, whitespace, and objects
  ---
  duration_ms: 1.0551
  type: 'test'
  ...
# Subtest: PhysicalEpochMs remains a canonical non-negative decimal string and round-trips Shanghai local seconds
ok 540 - PhysicalEpochMs remains a canonical non-negative decimal string and round-trips Shanghai local seconds
  ---
  duration_ms: 0.4233
  type: 'test'
  ...
# Subtest: explicit Asia/Shanghai formatter is invariant under UTC, Tokyo, and New York process TZ
ok 541 - explicit Asia/Shanghai formatter is invariant under UTC, Tokyo, and New York process TZ
  ---
  duration_ms: 314.1818
  type: 'test'
  ...
# Subtest: V1.3 compatibility command delegates to active V1.4 validation
ok 542 - V1.3 compatibility command delegates to active V1.4 validation
  ---
  duration_ms: 90.3176
  type: 'test'
  ...
# Subtest: V1.4 architecture validator passes
ok 543 - V1.4 architecture validator passes
  ---
  duration_ms: 74.8922
  type: 'test'
  ...
# Subtest: P2/P2-G1 lifecycle state is internally consistent without changing P1
ok 544 - P2/P2-G1 lifecycle state is internally consistent without changing P1
  ---
  duration_ms: 3.5045
  type: 'test'
  ...
# Subtest: P2-004 independent authorization and stop line are preserved
ok 545 - P2-004 independent authorization and stop line are preserved
  ---
  duration_ms: 0.8857
  type: 'test'
  ...
# Subtest: P2-005 independent authorization and stop line are recorded
ok 546 - P2-005 independent authorization and stop line are recorded
  ---
  duration_ms: 0.7542
  type: 'test'
  ...
# Subtest: P2-006 independent authorization and stop line are recorded
ok 547 - P2-006 independent authorization and stop line are recorded
  ---
  duration_ms: 0.6479
  type: 'test'
  ...
# Subtest: P2-004 completion artifacts preserve P1 notification and Ticket ownership
ok 548 - P2-004 completion artifacts preserve P1 notification and Ticket ownership
  ---
  duration_ms: 3.6845
  type: 'test'
  ...
# Subtest: P2-005 completion artifacts preserve frozen Session and identity ownership
ok 549 - P2-005 completion artifacts preserve frozen Session and identity ownership
  ---
  duration_ms: 0.5524
  type: 'test'
  ...
# Subtest: P2-006 completion has a runnable workbench and no migration 022
ok 550 - P2-006 completion has a runnable workbench and no migration 022
  ---
  duration_ms: 0.8494
  type: 'test'
  ...
# Subtest: P2-001 and P2-002 frozen artifacts remain present
ok 551 - P2-001 and P2-002 frozen artifacts remain present
  ---
  duration_ms: 0.4092
  type: 'test'
  ...
# Subtest: P3 remains greenfield and contains no historical ticket program
ok 552 - P3 remains greenfield and contains no historical ticket program
  ---
  duration_ms: 1.7028
  type: 'test'
  ...
# Subtest: future flags default off without legacy import flags
ok 553 - future flags default off without legacy import flags
  ---
  duration_ms: 0.5556
  type: 'test'
  ...
# Subtest: conceptual schema has no historical migration fields or second ticket core
ok 554 - conceptual schema has no historical migration fields or second ticket core
  ---
  duration_ms: 0.4108
  type: 'test'
  ...
# Subtest: new source example is non-authoritative
ok 555 - new source example is non-authoritative
  ---
  duration_ms: 0.6547
  type: 'test'
  ...
# Subtest: 2C4G limits remain conservative
ok 556 - 2C4G limits remain conservative
  ---
  duration_ms: 0.8301
  type: 'test'
  ...
# Subtest: P2-016 authorization reconciles only the historical P2-015 ledger
ok 557 - P2-016 authorization reconciles only the historical P2-015 ledger
  ---
  duration_ms: 1.9456
  type: 'test'
  ...
# Subtest: architecture validator rejects the historical P2-015 ledger drift
ok 558 - architecture validator rejects the historical P2-015 ledger drift
  ---
  duration_ms: 18.8205
  type: 'test'
  ...
# Subtest: P2-012 authorization rejects premature completion and next-gate authorization
ok 559 - P2-012 authorization rejects premature completion and next-gate authorization
  ---
  duration_ms: 0.3595
  type: 'test'
  ...
1..559
# tests 566
# suites 0
# pass 566
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 745329.1568
````

</details>

隐私核验：对 18 个修改文件（含嵌入日志）精确检查 5 个本机敏感配置值，匹配数 0；未输出值本身。

P2-012 最终完成门禁：238 checks PASS，包含当前全量结果/清理；historical_live_validation=PASSED，当前 live_validation=NOT_RUN。
