# 卡32C-D：「完成」与「关闭」统一语言与状态拆分

本地交付：2026-11-08（Asia/Shanghai）。分支 `codex/v224-card32c-d`，基线 `main` `7fbcb3df`（#169、#170 已合并）。依据 `pc-admin-v2.2.4_card32C_prompt.md` 32C-D 节；计划见 `card-32c-plan.md`。开发阶段：不做兼容、映射或开关。

## 决定与文档（D1、D4）

- `CONTEXT.md`：新增「完成（Complete）」「已解决待确认（Resolved）」「关闭（Dismiss）」「恢复（Restore）」，改写「重开」，删除「关闭（Close Ticket）」旧定义与「取消工单」，相关条目的 Avoid 改为「关闭」。
- 新增 [ADR-0058](../../adr/0058_completion_and_dismissal_language.md)；ADR-0055、0056 只追加前向替代指针，原文不改。
- `docs/ui/design-system.md`：状态标签与时间线状态点表（D3）；`docs/api` 的关闭、看板、搜索、跟进、H5、报修人访问、端点索引、工单、平台、群通知文档同步。
- 当前状态机说明 `docs/06_ticket_state_and_notification.md`、`architecture/ticket_state_machine.mmd`、`architecture/full_ticket_lifecycle.mmd` 改为新状态与动作；其它编号分期设计文档（05 / 25 / 28 / 29 / 52 / 61 等）保持原文，`validate-arch-006` 与 ARCH-006 测试继续校验 docs/52 原文。
- 全仓旧值搜索清单：[card-32c-d-search.md](card-32c-d-search.md)（逐组标注已改 / 不改 / 待确认）。

## 状态与事件（D2）

| 旧 | 新 | 落点 |
| --- | --- | --- |
| Ticket `CLOSED` | `COMPLETED` | Core 状态集与中文名「已完成」、`complete` / `confirm` / `auto-complete` 的终态、`reopen` 起点、所有查询 / 计数 / 搜索 / 提醒 / H5 SQL |
| Ticket `CANCELLED` | `DISMISSED` | `dismiss` 命令（原 `cancel`）、`restore` 起点、投影、搜索、计数、通知 |
| Ticket `DUPLICATE_LINKED`、事件 `ticket.duplicate_linked` / `ticket.unlinked` | 删除 | Core、SQL、契约、H5、PC |
| Intake `IGNORED` | `DISMISSED` | 受理、群聊佐证、编排器、决策端口、受理关闭、投影 |
| `ticket.closed` / `ticket.cancelled` / `intake.closed` | `ticket.completed` / `ticket.dismissed` / `intake.dismissed` | Core、通知策略、时间线、事件契约 |
| `POST /api/tickets/{id}/cancel` | `POST /api/tickets/{id}/dismiss` | HTTP 路由、门面、等待回执路由、OpenAPI、PC client |
| 动作 `auto-close` | `auto-complete` | Core、角色脚本、P1 自动完成任务 |
| 通知类型 `TICKET_CLOSED` | `TICKET_COMPLETED` | 策略、投影、群 / 应用发送器、模板卡、G2 证据 |
| 技术码 `CANCELLED_BY_STAFF` | 删除 | PC 已无调用者的旧「取消工单」控制器整段删除 |
| H5 筛选 `CLOSED_OUT` | `DISMISSED` | OpenAPI、query、批量 SQL、H5 types / decode；i18n 键 `cancelled` → `dismissed`（已关闭） |
| 共享跟进 `end_reason` `CLOSED` / `CANCELLED` | `COMPLETED` / `DISMISSED` | 该字段就是结束事件的 Ticket `new_status`，随状态改名 |

## 迁移 072

- `database/migrations/072_ticket_completion_dismissal.sql` + `app/server/scripts/completion-dismissal-migrate.mts`（check / apply / rollback、校验和、advisory lock、`platform.schema_migration` 登记、`requireCompletionDismissalSchema`）。
- 前置检查：库中存在任何旧值即失败（`COMPLETION_DISMISSAL_LEGACY_DATA_PRESENT:<对象>`），不映射、不改写、不删除。
- 正向：读取当前约束定义，整词替换后重建（Ticket 状态、事件新旧状态、事件类型、Intake 状态、Intake 事件类型、通知类型）；改写 040 完工守卫与 041 / 063 轮次通知守卫函数中的完成字面值；原定义写入 `pilot_ticket.completion_dismissal_baseline`。
- 本体可重复执行：测试夹具在 072 之后再应用较早的迁移（如 040 / 041 / 063）时再次执行，已是新词汇的对象跳过，基线保留第一次的原定义。
- 回退：库中存在新值数据时拒绝；否则按基线恢复约束与函数，删除基线表与登记。
- 接入：运行角色（`human-workbench-role`、`p2-016-process-role`）启动前要求 072；运行时就绪把 072 并入 `service_closure_schema` 检查（不新增健康检查键）；构建资源登记 072；web01 夹具在 071 之后应用 072。
- 测试夹具：自建迁移链的夹具在最后一次迁移后调用 `ensureCompletionDismissal`（不登记）。p1-004 / p1-009 / p1-010 直接迁移共享 `PILOT_DATABASE_URL`，开始前和 `after` 中调用 `releaseCompletionDismissal`，按基线恢复未登记的 072，共享库不留改动；已登记的 072 不碰，残留新值行时失败而不改写。
- `yxx_current_migration_catalog.v2.json` 与 `yxx_self_service_catalog.json` 是 ADR-0045 / 历史就绪范围的固定快照（49 个 SQL），不纳入 072，未改。

## 不改的同名值（D1-6 及其它聚合）

Review `CANCELLED` / `CANCEL_REVIEW`；通信投递、会话投递、公共故障投递 `CANCELLED`；会话转接 `CANCELLED`；安全动作、H5 媒体上传 `CANCELLED`；公共故障（Incident）`CLOSED` / `incident.closed`；渠道腿 `CLOSED`；共享预约动作 `CANCEL`；P1 试点 e2e 观察标签 `CLOSED`；关闭原因相关码 `RESTORE_CLOSED`、`STALE_REVIEW_CANCELLED`；DOM / 存储钩子（`data-action="cancel"`、`data-waiting-purpose="cancel"`、草稿用途 `waiting-cancel`、提示来源 `ticket-waiting-cancel`，测试选择器只增不删）。

## 测试夹具与样本

- 退役 V1 自助客户端样本 `tests/fixtures/retired-self-service/self-service.js` 只改 `ticketStatuses` 一行（`COMPLETED:'已完成'`、`DISMISSED:'已关闭'`，删除 `CANCELLED` / `DUPLICATE_LINKED`），README 记录此后不再与原件同哈希。V1 API 已无旧值，不改则该样本把完成单显示为「状态未知」。
- 只换字面值的断言：完成单的「已关闭」→「已完成」（t11 / t12 / t20 / t21 / t25 / p2-g2-yixiaoxiu-member / yxx-ss-009）；看板「已处理」列标题仍是「已关闭」（`boardColumnNames.closed`，D1 未覆盖），wbint-t42 不改。
- web01 集成测试原来用 `statuses=CANCELLED` 从关闭组里单独选出一张单；现在所有关闭事项都是 `DISMISSED`，改为断言筛选结果与全部关闭事项完全相等，并新增 `statuses=COMPLETED` 在关闭组里为空的负例。
- web01 单元测试原来用 `COMPLETED` 代表「不是 Ticket 状态」；现在它是 Ticket 状态，改用已废弃的 `CLOSED` 断言同一含义。
- 批量替换误改的其它聚合值已逐一还原：会话规则动作 / 群回复投递 / 通信投递 `CANCELLED`、公共故障 `CLOSED`、ARCH-006 对 docs/52 原文的动作词。

## 待确认（D1 未覆盖，未自行决定）

1. 人工关闭通知类型 `TICKET_CANCELLED` 是否改为 `TICKET_DISMISSED`。
2. 自动完成提醒 `ticket.auto_close_reminder`、动作 `auto-close-reminder`、列 `auto_close_*` 是否改为 complete 命名（涉及事件类型 CHECK 与列名）。
3. p2-007 人工生命周期观察码 `TICKET_CLOSED_OBSERVED`。
4. 看板「已处理」列标题 `boardColumnNames.closed` 仍为「已关闭」（同时容纳已完成与已关闭，看板移动提示「官方已显示：已关闭」）。

## 验证

本机 macOS、Node 24、PostgreSQL 18，`PILOT_DATABASE_URL` 指向本机库；不是 Windows 验收，也不是现场或生产验收。

- 构建与门禁：`npm run migration:build` 通过（0 个 TS 错误）。`npm run migration:typecheck` 结果 `MIGRATION_GATE_PASS`；`npm run migration:verify-artifact` 结果 `ARTIFACT_VERIFIED_NOT_ACTIVATED`；`npm run docs:agents:check` 通过。PC `typecheck` / `lint:css` / `lint:features` 与 H5 `typecheck` 通过。`ticket-card.css` 无改动。
- 测试范围：按 `pr-plan --base main` 选出 165 个文件，逐个单独运行。基线是 main `7fbcb3df` 在独立工作树的同一份清单。
  - 本分支 143 个通过、22 个失败。其中 19 个在 main 上以相同的通过 / 失败数失败：human-workbench-process、p2-g2-process-assembly、pc-admin-card13（卡32C-T 修）、t08-state-authority、t10-purpose-expiry、t21-bot-feedback-pc-happy、t24-formal-nonpending-delivery-states、t35-normal-long-material、t37-terminal-toggle-reopen、wbint-t14-review、wbint-t21-bot-feedback、wbint-t41-search-http-first、yxx-h5-flow、yxx-h5-media（两个）、yxx-ss-006 / 008 / 010，以及 yxx-ss-009（另在 main 上单跑确认，同在第 34 行超时）。
  - 另外 3 个是本分支自身的问题，修复后重跑结果：arch-006 6 / 2（与 main 相同，误改的 docs/52 动作词已还原）；p1-004 21 / 1（与 main 相同，见下条共享库）；web01-workbench.integration 17 / 0。
  - t25-disabled-historical-read 在 main 上失败，本分支通过。
- 定向重跑：p1-009 4 / 0、p1-010 4 / 0、yxx-h5-runtime 19 / 0（新增 072 缺失与校验和错误的拒绝断言）、completion-dismissal-migration 1 / 0、pc-admin-card32c-d 1 / 0。
- 共享库：中途发现 p1-004 / p1-009 / p1-010 把未登记的 072 留在了共享 `postgres` 库，导致 P2-012 目录校验漂移。该库没有任何工单或受理行，已按 072 基线恢复 5 个约束并删除基线表，恢复后确认无新值。之后三个测试改为开始前和结束后释放 072，重跑后共享库保持干净。
- 截图：见 [证据 README](../../docs/ui/evidence/v224-card32c/README.md)。PC 四张由新增浏览器测试产生，H5 一张来自 Vite DEV 合成预览。

## 回退

还原本卡提交并对已应用 072 的库执行 `completion-dismissal-migrate --rollback`（要求库中无新值数据；开发库按 ADR-0056 U7 清理后用夹具重建）。
