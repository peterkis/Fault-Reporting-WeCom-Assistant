# P2-016 工单生命周期与双责任

实现边界：Internal Beta / deterministic human-only。P2-016 不授权 Incident、P2-G2、AI Shadow、生产或医院内网接入。关闭三个 P2-016 Flag 后，仍可使用既有 P1/P2 human-only 入口；不删除已持久事实。

## 唯一权威与状态动作

`pilot_ticket.ticket` 是 Unified Ticket Core 的兼容实现。P2-016 Query/Command Facade 封装其读与原 TicketActionService，不新建 Ticket 表，不由外部来源、UI、SSE 或投影拥有状态。

| 当前状态 | Action | 下一状态 |
| --- | --- | --- |
| NEW | queue | QUEUED |
| QUEUED | accept | ACCEPTED |
| ACCEPTED / REOPENED | start | IN_PROGRESS |
| IN_PROGRESS | request-information | WAITING_REQUESTER |
| IN_PROGRESS | wait-vendor | WAITING_VENDOR |
| WAITING_REQUESTER / WAITING_VENDOR | resume | IN_PROGRESS |
| IN_PROGRESS | resolve | RESOLVED |
| RESOLVED | confirm | CLOSED |
| RESOLVED / CLOSED | reopen | REOPENED |
| QUEUED / ACCEPTED | cancel | CANCELLED |
| RESOLVED | auto-close（SYSTEM job） | CLOSED |

备注通过 add-note 追加，默认 internal；自由备注从不进入 P2-016 外部模板或 Reporter 时间线。自动关闭复用 P1-010 Deadline/Reminder/Action，不开放 HTTP、浏览器或 Reporter auto-close。系统 job 需由获批准的 Worker 调用，不默认为任意线上工单启动定时执行。

查询包括列表、详情、事件、责任、候选处理人、通知投递。列表默认 30/max 100、事件 max 200，授权裁剪在 LIMIT 前；UI 分页缓存上限分别为 100/200。事件按业务时间与追加序号呈现，所有 API 时间是无 offset 的 Asia/Shanghai 字符串。

## 命令与失败恢复

HTTP 只接受固定动作路由；Cookie 写入要求 Origin/CSRF/同站，Bearer 只接受 Authorization Header。命令必须携带 UUID client_command_id、Idempotency-Key、expected_version 和 If-Match；版本不适用时 409，不盲重试新命令。

`ticket_command_receipt` 以 principal scope + command ID 唯一，保存 canonical hash、终态、结果引用及稳定错误。命令授权早于 receipt 读取；事务 SAVEPOINT 保证失败业务没有部分提交。网络中断后使用原 ID 核对同一命令。正文/令牌不进入浏览器持久存储，刷新只恢复 filter 和 selected internal ID。

## 双责任与转派

Conversation Assignment 决定谁沟通；Ticket assignee/team 决定谁解决。责任视图直接读两个事实源，包括可靠绑定 Journey 的各会话；不复制第三份所有权。

transfer-assignment 校验当前版本、active 目标、团队和角色，仅更新原 Ticket assignee/team 并追加 `ticket.assignment_transferred` metadata，不改状态，不改 Conversation Assignment，不向外部发送内部身份。

复合接管/接单要求 Session 属于该 Ticket Intake，分别校验两个版本。通过 P2-005 caller-owned transaction seam 与原 Ticket Action 同事务执行：接管或接单任一失败，两部分均不提交。一般转派则保持两个责任独立。

## Realtime 与资源

继续使用 P2-003 durable SSE（最多 32 客户端），新事件只触发授权 refetch。P2-016 将授权 scope SQL LIMIT 设为 256，避免超过旧 Realtime Contract；超出该窗口仍以授权查询/5 秒轮询恢复，不扩大为通配权限。Last-Event-ID、gap fallback、断线、认证过期沿用原服务。

历史业务时间不强行变为当前时间；P2-016 适配器仅给实时 envelope 单调发布时间，不延长已过期来源的保留期。wakeup 不拥有业务状态，失败不回滚已提交 Ticket/Notification。

资源目标：一个 App/API/SSE 与一个 Worker 角色、同一 Gateway 单活；每池 max 4，总预算不超过 8；Communication concurrency 1，默认批次 20。容量和恢复须有真实自动化输出，不能用本文件代替 Evidence。
