# ADR-0058：完成与关闭的统一语言与状态拆分

Status: Accepted for implementation by the user's card 32C request (`pc-admin-v2.2.4_card32C_prompt.md`, 32C-D), 2026-11-08. Development stage: no compatibility, mapping or feature flag. Local checks, live permission and Gate approval remain separate.

前向替代：[ADR-0055](0055_workbench_closure_kind_projection.md) 的「状态 → kind」表；[ADR-0056](0056_unified_closure_reasons_notify_and_restore.md) A0-1 中「`DUPLICATE_LINKED` … 保留既有公共故障关联含义」一句，以及 H5 筛选 `CLOSED_OUT` 的命名。两份 ADR 的原文不改，只追加指针。

## 背景

同一个词指两件相反的事：

| 层 | 原状 | 冲突 |
| --- | --- | --- |
| 统一语言 | 「关闭（Close Ticket）」= 完工、报修人确认恢复、超时规则，即正常结束 | 界面上「关闭事项…」「已关闭」指误报、重复、撤回这类没有完成服务的结束 |
| Ticket 状态 | `CLOSED` = 正常结束；`CANCELLED` = 人工关闭（6 原因）；`DUPLICATE_LINKED` = 旧「已关联公共故障」，无写入路径 | PC 把三者都显示为「已关闭」；正常完工的时间线显示「待确认 → 已关闭」；搜索只能硬写「已关闭（已完成）」区分 |
| 事件 | 正常结束 `ticket.closed`，人工关闭 `ticket.cancelled` | 事件名与界面语义相反 |
| Intake | `IGNORED` = 已关闭（人工或系统） | 与投影 `closure.kind=DISMISSED` 不同名 |
| H5 筛选 | `COMPLETED` / `CLOSED_OUT` | 第三套命名 |
| 时间线状态点 | 人工关闭用「完成」绿色 | 视觉上把关闭当成完成 |

## 决定

1. **完成（Complete）**：动作 `complete` / `confirm` / `auto-complete`，终态 `COMPLETED`，事件 `ticket.completed`。完成后可重开。
2. **已解决待确认（Resolved）**：状态 `RESOLVED` 不改名，归入「已处理 · 已完成」分组。
3. **关闭（Dismiss）**：动作 `dismiss`，终态 `DISMISSED`（Ticket 与 Intake 共用），事件 `ticket.dismissed` / `intake.dismissed`；必须带 6 个关闭原因之一。关闭后可恢复（`ticket.restored` / `intake.restored` 不改名）。
4. 代码中 Ticket / Intake 的 `CLOSED` 彻底退役，中文「关闭」固定对应 `DISMISSED`。若把「关闭」继续映射到 `CLOSED`，它的含义会从「完成」反转为「未完成就结束」，残留代码会被静默读反。
5. 删除 `DUPLICATE_LINKED` 与事件 `ticket.duplicate_linked` / `ticket.unlinked`：生产路径没有写入者；人工重复走关闭 + 原因 DUPLICATE；公共故障关联由「公共故障报修关联」关系表达。
6. 「取消工单」术语删除，并入「关闭」；技术码 `CANCELLED_BY_STAFF` 等删除，原因只用 6 枚举。
7. 投影 `closure.kind = COMPLETED | DISMISSED` 不变，与状态同名同义。
8. H5 筛选 `CLOSED_OUT` → `DISMISSED`；`COMPLETED` = `COMPLETED + RESOLVED`。
9. HTTP `POST /api/tickets/{id}/cancel` → `POST /api/tickets/{id}/dismiss`；通知类型 `TICKET_CLOSED` → `TICKET_COMPLETED`，向报修人说「已完成」。关闭类通知文本沿用 ADR-0056 矩阵。

## 不改的聚合（真实的「取消 / 关闭」）

| 值 | 聚合 | 不改理由 |
| --- | --- | --- |
| Review `CANCELLED`、命令 `CANCEL_REVIEW` | 人工复核 | 复核项被取消，不是工单终态 |
| 通信投递 / 会话投递 `CANCELLED` | 通信 | 投递被取消 |
| 会话转接 `CANCELLED` | 会话控制 | 转接请求被取消 |
| 共享预约「已取消共享时间」、`end_reason` | 共享跟进 | 预约被取消；工单完成 / 关闭引起的结束原因另见 PR 待确认项 |
| 拖拽「已取消拖动」 | 看板交互 | 交互取消 |
| 公共故障（Incident）`CLOSED` 及其投递状态 | 公共故障 | 公共故障的生命周期，不属于 Ticket / Intake |
| 渠道腿 `CLOSED`、安全动作 / H5 媒体 `CANCELLED` | 编排 / 媒体 | 各自聚合的终态 |

## 迁移 072 与回退

- 前置检查：库内存在旧值（Ticket / 事件状态 `CLOSED` / `CANCELLED` / `DUPLICATE_LINKED`、Intake `IGNORED`、事件类型 `ticket.closed` / `ticket.cancelled` / `ticket.duplicate_linked` / `ticket.unlinked` / `intake.closed`、通知类型 `TICKET_CLOSED`）时直接失败，提示按 ADR-0056 U7 清理后用夹具重建；不写数据映射，不改写或删除未知数据。
- 正向：读取当前约束定义，整词替换后重建 Ticket 状态、事件新旧状态、事件类型、Intake 状态、Intake 事件类型与通知类型约束；替换依赖旧值的完工守卫与通知触发函数；原定义存入回退基线表并登记 `platform.schema_migration`。
- 回退：要求库中不存在新值数据，恢复基线中的约束与函数定义，删除登记与基线表。
- 运行角色启动前要求 072 已应用；测试 harness 在各自迁移序列末尾应用 072。
