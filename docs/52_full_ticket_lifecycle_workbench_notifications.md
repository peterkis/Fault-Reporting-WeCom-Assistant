# 52. 完整 Ticket 生命周期 Workbench、上报人时间线与可靠通知

## 1. 不重写状态机

P2-016 不新增第二套 Ticket 状态机，只复用 P1-006 已冻结的 Action：

```text
queue
accept
start
request-information
resume
wait-vendor
resolve
confirm
reopen
cancel
auto-close
add-note
```

HTTP Route、UI、P2-007、P2-015 或 AI 均不得直接写 Ticket 表。所有写命令必须依次经过：

```text
Authentication
→ Authorization
→ If-Match / expected version
→ Idempotency-Key
→ TicketActionService
→ append-only Ticket Event
→ Communication Outbox（需要通知时）
```

## 2. Workbench API 规划

```http
GET  /api/tickets/{ticketId}
GET  /api/tickets/{ticketId}/events

POST /api/tickets/{ticketId}/queue
POST /api/tickets/{ticketId}/accept
POST /api/tickets/{ticketId}/start
POST /api/tickets/{ticketId}/request-information
POST /api/tickets/{ticketId}/wait-vendor
POST /api/tickets/{ticketId}/resume
POST /api/tickets/{ticketId}/resolve
POST /api/tickets/{ticketId}/confirm
POST /api/tickets/{ticketId}/reopen
POST /api/tickets/{ticketId}/cancel
POST /api/tickets/{ticketId}/notes
```

`auto-close` 只能由已有受控 SYSTEM policy 调用，不作为普通坐席 HTTP Route。`add-note` 由 `/notes` 映射，内部备注必须保持 INTERNAL。P2-016 必须复用现有授权和版本语义，不修改 Unified Ticket Core 转换表。

## 3. 双责任视图

```text
Conversation Assignment = 当前沟通坐席
Ticket Assignment       = 当前处理工程师 / 当前处理组
```

两者独立权威、可同时展示、不可互相覆盖。转派和 Handoff 全留痕。规划的 `TAKEOVER_CONVERSATION_AND_ACCEPT_TICKET` 必须在同一数据库事务内完成两个既有命令：全部成功或全部失败；任何部分状态都不得让 UI 宣称成功。

## 4. 生命周期验收矩阵

| 场景 | 必经状态/动作 | 验收 |
|---|---|---|
| 标准完整链 | `NEW → QUEUED → ACCEPTED → IN_PROGRESS → WAITING_REQUESTER → IN_PROGRESS → WAITING_VENDOR → IN_PROGRESS → RESOLVED → CLOSED` | 每步可由 UI 完成，刷新后状态/版本/Event 一致 |
| 重开闭环 | `CLOSED → REOPENED → IN_PROGRESS → RESOLVED → CLOSED` | 用户拒绝解决可触发合法 reopen；不覆盖旧事件 |
| 取消 | `QUEUED/ACCEPTED → CANCELLED` | 仅合法前态可取消；非法转换稳定拒绝 |
| 并发接单 | 两个坐席同版本 `accept` | 最多一人成功，另一方版本冲突 |
| 版本冲突 | stale `If-Match` | HTTP 409/稳定错误，状态和通知均不变 |
| 转派 | Ticket assignee / resolver team 变化 | Ticket 权威路径更新；Conversation Assignment 不被暗改 |
| 会话 Handoff | request/accept/release/transfer | Control Event 全留痕；Ticket Assignment 不被暗改 |
| 自动关闭 | `RESOLVED → CLOSED` via `auto-close` | SYSTEM-only、政策可审计、用户可重开 |
| 发送失败 | Ticket Action 已提交，Delivery 失败 | 不回滚 Ticket/Event；按 Delivery policy 重试/对账 |
| 内部备注 | `add-note` internal | Outbox/Delivery 为 0，外泄为 0 |

## 5. 通知链

```text
Ticket Event
→ Notification Policy
→ Communication Message
→ Outbox
→ Delivery
→ WeCom Sender
```

外部通知里程碑：`TICKET_CREATED`、`TICKET_ACCEPTED`、`TICKET_IN_PROGRESS`、`WAITING_REQUESTER`、`WAITING_VENDOR`、`TICKET_RESOLVED`、`TICKET_CLOSED`、`TICKET_REOPENED`、`INCIDENT_LINKED`、`INCIDENT_UPDATED`、`INCIDENT_RESOLVED`。

严禁外发：内部备注、内部审核意见、坐席 Read Cursor、内部权限失败、Reconciliation 细节、其他上报人信息。通知幂等键必须基于权威事件 ID/版本、目标 person 和模板版本；ACK 不明进入 `RECONCILIATION_REQUIRED`，不得盲目重发。发送失败不回滚 Ticket；失败可重试且最终状态可审计。

## 6. Reporter-safe Timeline

- 使用 opaque public ref；
- 需要企业微信身份或绑定访问会话和后端 reporter authorization；
- 工单后四位只作醒目展示，不作为主键、全局唯一标识或访问凭证；
- 不显示内部备注、内部审核、其他用户、内部账号/组、Token、Provider 原始错误、receipt、Reconciliation 或患者敏感信息；
- 与内部 Workbench Timeline 使用独立 Audience/Query Policy；
- 所有访问留审计，可配置短期失效。

## 7. 渠道与模板卡片

- 群内只发送安全回执；群强 @ 保持 `UNVERIFIED`，不得作为可靠提醒；
- 可靠提醒路径是主动单聊；
- `template_card` Sender 归 P2-016，`WECOM_TEMPLATE_CARD_ENABLED=false`；
- 真正启用前必须取得真实企业微信 Provider ACK 和客户端显示/交互验证；
- 群回执、单聊与模板卡片均经 Communication/Outbox/Delivery，并满足幂等。

## 8. 持久化与停止线

P2-016 经独立授权采用 migration 031，新增命令收据、Reporter 访问和通知绑定的六张辅助表，不新增 Ticket Core。实现说明见 docs/58–61；自动化报告为 evidence/p2-016-automated-readiness-report.md。P2-016 已经真实定向现场、回归及负责人批准收口为 DONE；完成记录见 evidence/p2-016-ticket-lifecycle-workbench-report.md。无活动任务，P2-012/P2-G2 未授权；全部 Feature Flag 保持 false。
