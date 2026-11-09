# 卡32C 实施计划：「完成 / 关闭」语义拆分（32C-D）与卡13 抽屉测试稳定性（32C-T）

制定：2026-11-08。基线 `main` `7fbcb3df`（#169、#170 已合并）。依据 `pc-admin-v2.2.4_card32C_prompt.md` 与「医小修 PC 管理端 v2.2.1 · 定稿原型」（编辑态在场色 #9A4A0A 已与 `--presence-editing` 一致；已处理分组「已完成 / 已关闭 · 不计入完成数」）。两张子卡各一个分支、一个 PR，文件不重叠。

## 1. 现状分析（检索于 7fbcb3df）

检索式 `'CLOSED'|'CANCELLED'|DUPLICATE_LINKED|'IGNORED'|CLOSED_OUT|ticket\.closed|ticket\.cancelled|intake\.closed`（含双引号形式、`TICKET_CLOSED`、`CANCELLED_BY_STAFF`），排除历史证据目录：

| 区域 | 命中文件 | 说明 |
| --- | --- | --- |
| `app/server` | 63 | Ticket Core 状态集与迁移表（p1-005/p1-006）、命令门面、通知策略 / 投影 / 发送器、搜索、H5 批量 SQL、编排器、Intake 关闭、报修人时间线等 |
| `contracts` | 50 | JSON Schema、d.ts、OpenAPI（H5、会话中心）、`domain_events.md`、当前迁移目录快照 `yxx_current_migration_catalog.v2.json` |
| `database` | 19 | 002/003/004/008/031/046/048/071 的状态与事件类型 CHECK；040 触发函数、041/063 通知触发器里的 `ticket.closed`/`CLOSED`/`TICKET_CLOSED`；其余为其它聚合 |
| `tests` | 137 | 断言字面值、夹具与各隔离库 harness |
| `app/pc-admin` / `app/h5` | 22 / 7 | client 解码、status-map、时间线、搜索、H5 筛选与 i18n |
| 文档 | docs/api 7、adr 2、plans 7、config_examples 2 | |

数据库层的关键事实：
- 状态与事件类型由多份迁移逐次改写同一个 CHECK（031/046/048/071 都重写过 `ticket_event_type_check`；071 用 `pg_get_constraintdef` 动态拼接并保存回退基线）。
- 每个功能有自己的迁移脚本（如 `service-closure-migrate.mts`），各测试 harness 只应用自己需要的一段迁移（p2-002…p2-016、web01、t08/t09/t37/t43、card27c 等）。新状态值一旦写入代码，凡是会创建工单而没有应用 072 的 harness 都会触发 CHECK 失败——072 必须接入每一个这样的 harness 与运行角色。
- 不属于 Ticket / Intake 的同名值（D1-6 及下表「其它聚合」）不改：Review `CANCELLED`/`CANCEL_REVIEW`、通信投递 / 会话转接 / 安全动作 / H5 媒体 `CANCELLED`、渠道腿 `CLOSED`、公共故障（Incident）`CLOSED` 与其投递状态、共享预约「已取消共享时间」、拖拽「已取消拖动」。

## 2. 32C-T（先做，体量小、无依赖）

分支 `codex/v224-card32c-t`，执行记录 `plans/pc-admin-design-v21/card-32c-t.md`。

1. **步骤 1 基线对比**：只跑失败用例（`--test-name-pattern "Card 13 next step"`），`e6fed67d`、合并后 main、合并后 main + `Emulation.setCPUThrottlingRate {rate:4}` 各 10 次；降速与采样通过仅本地的临时补丁注入（不提交）。若只有合并后失败 → 停止并 `git bisect`。
2. **步骤 2 采样**：断言前采样 `right / transform / getAnimations({subtree:true})`；失败样本须为 `running` 且 `transform≠none`，否则停止报告。
3. **步骤 3 修法（只改测试）**：`tests/helpers/browser-animations.mts` 新增 `waitForAnimationsSettled(browser, selector?)`（等子树内有限次数动画 `finished` + 两帧）；`t10-cancel` 与 `pc-admin-card32b` 的内联逻辑改调 helper；卡13 首次打开抽屉后与四个宽度的每次 `setDeviceMetricsOverride` 后先等动画，再做精确几何断言，并新增「动画结束后 `transform` 为 `none` 或单位矩阵」。
4. **步骤 4 对照组**：`prefers-reduced-motion: reduce` 下不调 helper 也精确为 8（新增用例）。
5. **步骤 5 稳定性**：修复后正常速度 20/20、CPU 4 倍降速 10/10；记录机器、系统、浏览器版本（macOS；Windows 无条件则注明未做）。
6. **步骤 6 扫描**：检索打开抽屉 / 弹窗 / popover 后立即读取 `getBoundingClientRect` 的断言，逐条列表；确有竞态的改用 helper。
7. **T3**：全局焦点规则（`app/heroui-workbench.css:60`）对组合框内输入加 `:not(.ds-closure-combobox input)` 排除，`ticket-card.css` 中堆叠特异性的选择器改回普通写法；`close-dialog-reason.png` 重拍，`card32b` 单层框断言不变。`ActivityPeople.tsx` 只加锚点约定注释。
8. 验证：pc-admin typecheck / stylelint / eslint、`migration:build`、types gate、artifact、卡13 / 32B / t10-cancel / 详情重构。

## 3. 32C-D（主体）

分支 `codex/v224-card32c-d`，执行记录 `plans/pc-admin-design-v21/card-32c-d.md`。按「文档 → 数据库 → 服务端 → 契约 → 客户端 → 测试」推进，每层编译通过再进下一层。

### 3.1 文档（D1、D4）
- `CONTEXT.md`：改写「关闭」「取消工单」，新增「完成（Complete）」「已解决待确认」「关闭（Dismiss）」「恢复」「重开」的定义与 Avoid；写明中文「关闭」⇔ 代码 `DISMISSED`。
- 新增 `adr/0058_completion_and_dismissal_language.md`：背景（D0）、决定（D1/D2）、不改的聚合清单与理由、迁移与回退；ADR-0055 / 0056 只追加「已被 0058 前向替代」指针。
- `docs/ui/design-system.md` 状态标签与时间线状态点；`docs/api` 接口导航（`/dismiss`）。

### 3.2 迁移 072（D2）
- `database/migrations/072_ticket_completion_dismissal.sql` + `app/server/scripts/completion-dismissal-migrate.mts`（沿用 071 的 check / apply / rollback、校验和、advisory lock、`platform.schema_migration` 登记）。
- **前置检查**：库内存在 `CLOSED`/`CANCELLED`/`DUPLICATE_LINKED` 工单或事件、`IGNORED` 受理、`ticket.closed`/`ticket.cancelled`/`intake.closed` 事件、`TICKET_CLOSED` 通知时直接失败（`COMPLETION_DISMISSAL_LEGACY_DATA_PRESENT`），提示按 ADR-0056 U7 清理后用夹具重建；不写数据映射，不改写未知数据。
- **正向**：以 `pg_get_constraintdef` 读取当前定义、整词替换后重建：Ticket 状态 / 事件新旧状态 CHECK（`CLOSED→COMPLETED`、`CANCELLED→DISMISSED`、删 `DUPLICATE_LINKED`）、事件类型 CHECK（`ticket.closed→ticket.completed`、`ticket.cancelled→ticket.dismissed`、`intake.closed→intake.dismissed`、删 `ticket.duplicate_linked`/`ticket.unlinked`）、Intake 状态 CHECK（`IGNORED→DISMISSED`）、通知类型 CHECK（`TICKET_CLOSED→TICKET_COMPLETED`）；`CREATE OR REPLACE` 040 完工守卫函数与 041/063 通知触发函数。原定义存入回退基线表。
- **回退**：要求无新值数据，恢复基线定义与函数，删除登记。隔离库实测正向 → 回退 → 正向。
- **接入**：所有会创建工单 / 受理的 harness 与夹具在其迁移序列末尾应用 072；运行角色（`p2-016-process-role`、`human-workbench-role` 等）在启动前 `require` 072；`yxx_current_migration_catalog.v2.json` 按其生成工具重新生成。

### 3.3 服务端（D2）
- Ticket Core：状态集与中文名（`COMPLETED` 已完成、`DISMISSED` 已关闭，删 `DUPLICATE_LINKED`）；动作 `cancel→dismiss`、`auto-close→auto-complete`；`complete/confirm/auto-complete → COMPLETED`、`reopen` from `RESOLVED/COMPLETED`、`restore` from `DISMISSED`；事件 `ticket.completed`/`ticket.dismissed`；删除技术码 `CANCELLED_BY_STAFF` 等，原因只用 6 枚举。
- Intake：`IGNORED→DISMISSED`、`intake.closed→intake.dismissed`（p1-004、群聊佐证、编排器、决策端口、Intake 关闭、投影）。
- HTTP：`POST /api/tickets/{id}/cancel` → `/dismiss`（handler、facade、ledger 资源名、OpenAPI、接口导航）。
- 通知：`TICKET_CLOSED→TICKET_COMPLETED`（策略、投影、群 / 应用发送器、模板卡、证据）；向报修人的完成文案说「已完成」。关闭类通知沿用 ADR-0056 矩阵。
- 查询 / 投影 / 搜索 / 计数 / 提醒 / H5 批量 SQL 中的所有 `IN (…'CLOSED'…)`。

### 3.4 契约与客户端（D2、D3）
- Schema / d.ts / OpenAPI / `domain_events.md` 同步改名。
- H5：筛选 `CLOSED_OUT→DISMISSED`（`COMPLETED` = `COMPLETED + RESOLVED`）、types / decode / i18n（`dismissed: 已关闭`）、`report.ts`/`timeline.ts`/`controller.ts`/`dev/preview.ts` 删 `DUPLICATE_LINKED`。
- PC：`statusLabels`（`COMPLETED` 已完成、`DISMISSED` 已关闭、`RESOLVED` 待确认 / 时间线「已解决待确认」）、`status-map`、client 解码、搜索删除「已关闭（已完成）」分支、时间线状态点（新增 `--stage-dismissed-accent: var(--gray-400)`，写在 `tokens.css` 与 `timeline.css`，不碰 `ticket-card.css`）、`closure/client.ts` 的 `/dismiss`、完工相关文案「完成 / 确认完成」。

### 3.5 测试与验收（D5）
- 断言字面值按新值同步（不放宽）；新增：正常完工「处理中 → 已完成」绿点、确认「待确认 → 已完成」、重复关闭「处理中 → 已关闭」灰点 + 第二行原因与原单；已完成只有「重开」、已关闭只有「恢复」（服务端命令拒绝 + 前端按钮）；H5「已完成 / 已关闭」筛选与计数、报修人看不到内部原因说明。
- 运行：pc-admin / H5 typecheck、stylelint、eslint、vite build；`migration:build`、types gate、artifact；Ticket Core / 命令 / 通知 / 搜索 / H5 的单元与 HTTP 集成；浏览器卡 27C（t10-cancel）、29、30B、32A、32B、H5 详情；072 隔离库正向 / 回退实测。
- 截图 `docs/ui/evidence/v224-card32c/`：`drawer-timeline-completed.png`、`drawer-timeline-dismissed.png`、`list-1440-closed-groups.png`、`h5-report-filter-dismissed.png`、`search-status-labels.png`。
- 交付检索清单：每处命中标「改 / 不改（所属聚合）」。

### 3.6 需在 PR 中提出、等待确认的点（D1 未覆盖，不自行决定）
1. 通知类型 `TICKET_CANCELLED`（人工关闭通知）是否改名为 `TICKET_DISMISSED`——D2 只列了 `TICKET_CLOSED`。
2. 公共故障（Incident）状态 `CLOSED`、渠道腿 `CLOSED`、安全动作 / H5 媒体 `CANCELLED` 未列入 D1-6，按「其它聚合」不改。
3. 事件 `ticket.duplicate_linked` / `ticket.unlinked` 随 `DUPLICATE_LINKED` 一并删除（无写入者）。
4. p2-007 人工生命周期的 `TICKET_CLOSED_OBSERVED` 观察码。
5. 历史证据、历史执行记录与已提交迁移文件（002…071）只读，不改写。

## 4. 风险与停止线
- 072 漏接任一 harness 会表现为大面积 CHECK 失败：以「全仓搜索调用 `withP20xxIsolatedDatabase` / 夹具的测试」为清单逐一确认，并跑一轮分组回归。
- 发现生产路径仍需要 `DUPLICATE_LINKED` 写入者、或 D1 未覆盖的状态 / 文案：停止该项，写入 PR 待确认。
- 不加兼容、映射或开关；不修改历史迁移、历史证据与 tested_head 记录。
