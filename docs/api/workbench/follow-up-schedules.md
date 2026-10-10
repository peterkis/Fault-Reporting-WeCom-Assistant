---
task_id: WBINT-T37
issue: 92
status: PLANNED_SOURCE_READY
runtime_status: NOT_RUN
source_base: 406599744d5676a840c90cb497ff033b4c375aea
timezone: Asia/Shanghai
---

# 工单共享跟进时间（WBINT-T37，待实现）

返回 [API 导航](../README.md) · [HTTP 索引](../endpoint-index.md) · [工单](tickets.md) · [执行记录](../../../plans/admin-workbench-integration/execution/t37.md)

本页冻结 #92 的目标合同。当前只有合同与首条真实 HTTP 用例源码，以下路径尚未挂载；build、类型、数据库、HTTP、Worker、浏览器均 `NOT_RUN`。领域依据为 [ADR-0031](../../../adr/0031_human_workbench_collaboration_policy.md) 第4项及 [WBINT-12/A12](../../../plans/admin-workbench-integration/implementation-plan.md#wbint-12个人已读关注团队待跟进与共享预约)。首次实际 RED 后逐切片实现。

## 宿主和入口

W 同源工作人员宿主，沿用当前活动内部 Principal 认证、Cookie Origin/CSRF 和 `no-store`。成员、Reporter、OAuth-only、公共 ref 和 Conversation 子路由没有本操作权限。

| METHOD + PATH | 目标行为 | 开关 |
| --- | --- | --- |
| `GET /api/tickets/{ticketId}/follow-up-schedule` | 当前获权安排、维护动作与最近20条修订历史 | `workbenchFollowUpSchedulesEnabled=false` 默认关闭 |
| `POST /api/tickets/{ticketId}/follow-up-schedule` | 显式 `SET` 或 `CANCEL` | 同上；还需当前维护权限 |
| `GET /api/tickets/{ticketId}/follow-up-schedule/commands/{commandId}` | 原主体／用途／UUID 的最小安全命令终态 | 只依赖原生命周期与当前 Ticket READ；独立于新写开关和 raw draft recovery |

路径 UUID；无 query。POST JSON ≤32 KiB，拒绝未知字段；必须 `Idempotency-Key` 等于 body UUID、`If-Match: "<expected_version>"` 等于 body Ticket 数字版本。GET ACK 不需 CSRF/Origin、If-Match 或 Idempotency-Key，不返回原时间、payload/hash、人员、责任或私有资料。关闭新 write/view 入口不阻断原主体的已提交结果核对。

## 输入、并发与幂等

[闭合 Schema](../../../contracts/workbench_follow_up_schedule_command.schema.json)／[类型](../../../contracts/workbench_follow_up_schedule_contracts.d.ts)：恰好六字段。

| 字段 | 约束 |
| --- | --- |
| `client_command_id` | 原 UUID；UNKNOWN 时保留，不生成新意图 |
| `expected_version` | 当前 Ticket 安全整数 number，1..2147483647 |
| `expected_schedule_version` | 当前安排修订的十进制 string，初始 `"0"`，最大 PostgreSQL BIGINT；不得 Number 强转 |
| `reason_code` | 固定 `WORKBENCH_FOLLOW_UP_SCHEDULE` |
| `action` | `SET` 或 `CANCEL` |
| `due_at` | SET 必须有效 Gregorian `YYYY-MM-DD HH:mm:ss`；CANCEL 必须 null |

时间使用现有 Asia/Shanghai 秒精度合同，并保存／返回精确配对的非负 physical epoch string；拒绝 offset、UTC 字面值、非法日历或不能表示的 epoch。过去时间可表示当前已到期行动；不伪造 SLA 或用户未确认的截止政策。SET 可明确改期；新 UUID 的合法 SET 创建新安排修订，即使时间与原值相同。CANCEL 只用于当前活动安排；没有活动安排的新 CANCEL 为409，不制造取消历史。

```json
{"client_command_id":"22222222-2222-4222-8222-222222222222","expected_version":1,"expected_schedule_version":"0","reason_code":"WORKBENCH_FOLLOW_UP_SCHEDULE","action":"SET","due_at":"2030-01-02 09:30:00"}
```

命令在原 `P2_016:<principal>` ledger 中以服务器固定用途 `WORKBENCH_FOLLOW_UP_SCHEDULE` 和 UUID 防重，不建立第二 ledger。canonical SHA-256 沿 `hashP2016` 的递归对象 key 排序，覆盖 server ticket_id、固定用途、action、原 UUID、原 Ticket/安排版本、reason_code、精确 due_at；null 不省略，数字与字符串不互换，主体 scope 不由客户端指定。对象可读权限在每次 receipt 读取前重新核验；相同 hash 返回原 COMMITTED/FAILED，改 payload 同 UUID 为409。只有新的写入核对当前维护权、两个版本、状态和日历；重放旧成功不能再次推进版本、事件、信号或投递。

## 当前维护权限

先用现有 `authorizedTicket` 核对当前活动身份与 Ticket READ，再按以下任一当前责任允许 SET/CANCEL：当前 Ticket 处理人；当前真实关联、尚未结束会话的实际 ASSIGNED 沟通人；当前获权 DISPATCHER/ADMIN。普通同组同事只有 READ 不等于维护权。任何 Conversation VIEW/CONTROL、显式关注或旧责任均不自动授予 Ticket READ。

沟通关联沿原 Intake 或已冻结 Journey/Channel Leg 的完整 canonical 关联规则，要求 Session 的实际 service_intake、Thread 与 Reporter 绑定一致，不按最近消息／群名／UUID 相似推断。多个关联会话中，存在一条当前有效且实际分配给该操作者的 canonical 会话即可取得“当前沟通人”的维护资格；本操作不修改任何会话，也不选择或复制一个新沟通负责人。全部权限与责任事实在命令事务重新核对并锁定必要活动身份／组／当前 assignment，阻止候选查询到提交之间失权。

可维护状态为 `NEW/QUEUED/ACCEPTED/IN_PROGRESS/WAITING_REQUESTER/WAITING_VENDOR/REOPENED`；`RESOLVED/CLOSED/CANCELLED/DUPLICATE_LINKED` 不接受新的 SET/CANCEL。保留旧 RESOLVED 的现有语义：仅完成关闭／取消才清活动，RESOLVED 时仍可读取保留安排，但不提供新维护。无个人处理人／沟通人时，由当前处理组作为团队待办承接；不保存第三份 owner，不扩大访问。

## 输出与恢复

[查询 Schema](../../../contracts/workbench_follow_up_schedule_view.schema.json) 闭合输出：`ticket_id,ticket_version,schedule_version,active,allowed_actions,history,history_has_more`。active 为 null 或 `{schedule_version,due_at,due_epoch_ms,is_due}`，其中修订等于顶层、时间和 epoch 精确配对；is_due 按当前权威时间派生，只有活动安排可到期。无安排初始版本为 `"0"`，取消／结束后修订不回零。history 返回最新修订在前、最多20条；`history_has_more` 明示还有持久历史，不能把尾部窗口当全量。每条含 `schedule_version,action:SET|CANCEL|ENDED,due_at,occurred_at,ticket_event_id,end_reason:null|CLOSED|CANCELLED`；CANCEL/ENDED 保留刚结束的时间，SET/CANCEL 的 end_reason 为 null。

POST [安全结果 Schema](../../../contracts/workbench_follow_up_schedule_result.schema.json)：`{ok:true,ticket_id,ticket_version,ticket_event_id,control_event_id:null,schedule_version,replayed}`。不返回责任、时间、正文或凭据；成功后重读实际查询，重读临时失败不推翻原成功。

ACK [Schema](../../../contracts/workbench_follow_up_schedule_receipt.schema.json)：`{client_command_id,ticket_id,state}`，UNKNOWN 无额外字段；COMMITTED 只有上述安全 result，replayed=true；FAILED 只有 `{code,retryable:false}`。无收据／STARTED／其他主体、Ticket 或用途返回 UNKNOWN；不据此推定“没提交”。仍有 READ 而写开关、raw recovery 或当前维护权关闭时可核对旧结果；身份失效或对象 READ 失效拒绝。不得因为另一个人已改期，就把原 SET 成功的 ACK 改成当前安排。未知只显式 GET 原 UUID，不自动重发 POST。

错误沿稳定 W 错误 envelope：坏路径／字段／时间／header为400；未认证401、活动内部身份失效403、对象不可见404；当前维护拒绝403、陈旧版本或 hash 冲突409；write/view关闭503 `P2_016_DISABLED`，明确启用但049未就绪503 `P2_016_FOLLOW_UP_UNAVAILABLE`。不将网络、临时503、畸形成功响应或 ACK 缺结果转为 FAILED。

正式 React 后续复用当前 authorized command／draft 消费：原 UUID、两个版本与六字段冻结；current READ 恢复先验权；24h草稿、opaque未知标识、CAS清理、退出／失权清理沿既有合同。raw恢复默认false，关闭时新输入只在内存；旧未知 ACK 消费不保存新敏感快照。真实 Cookie／CSRF 不持久化。任何可信401／403／404清相应授权缓存，临时读取失败保留原意图。具体消费者须在真实生产 bundle 验证，当前未实现。

## 事实、生命周期与到期 Worker

049 仅保留给本票的前向迁移，当前无 SQL 文件／执行。计划在唯一 Ticket Core 下保存从属的当前安排与修订历史，关联原 Ticket／Event；不复制 status、assignee、resolver team 或 communication owner。SET/CANCEL 的安排、Ticket version+1、追加 `ticket.follow_up_scheduled`／`ticket.follow_up_cancelled`、ledger终态及必要安全实时失效在同一事务；失败全部回滚。它们不改变 Ticket 状态、责任、Intake、轮次或外部 Outbox/Delivery，不写自由正文。

处理／沟通转派、撤派和停止退回保留时间及安排修订；新责任由现有事实读取。实际 CLOSED/CANCELLED 的原 Ticket Action／工作人员完工事务同时清活动并追加 ENDED 修订历史，引用该终态 Ticket Event；不创建额外轮次或独立状态机。重开原 Ticket 后没有活动安排，须新的明确 SET。关闭后旧 due 扫描不得产生有效新活动提示；关闭／改期与扫描竞争须在原 Ticket／安排锁和版本中收敛。

复用单一 Worker extension 的批处理 seam；每次最多20个、串行、稳定 `(due_epoch_ms,ticket_id)` 顺序及索引，不建 per-Ticket timer。到期信号以 `(ticket_id,schedule_version)` 唯一持久防重，与 signal marker 和内部 realtime 同事务；失败可恢复，重复批次／重启不重复发布该修订。信号只触发当前获权查询失效，不包含内部人物或时间正文，不创建外部通知；一次信号不清 is_due，未明确取消／改期前持续待办。默认关闭不扫描新增安排存储、不开新进程／连接池，既有投影和发送行为保持。

资源仍单 App/API/SSE、单 Worker、Gateway 单活、SSE≤32、批次≤20、pool≤4／全机预算≤8及各concurrency1。关闭 write/view 和新增 due batch 保留所有事实历史及旧 ACK；源码采用前向修补／revert，不删除历史 SQL／事实。本地隔离验证不授权真实外部发送、OAuth／Provider、用户数据库、部署、full／certify 或 Gate。
