# 设计系统 v2 · 卡 7：清理与固化

日期：2026-11-01（Asia/Shanghai）。本地视觉层任务；保留 Card 0–6 与用户原有未提交成果。未提交、推送、创建 PR、部署或启用任何持久 Feature Flag。

## 1. 改动摘要与边界

完成设计系统 §9.2/§9.3 第 7 步：移除兼容层与已废弃的表现规则，将入口收敛到 7 行，并用真实 ESLint、变量检查和注册浏览器断言固化约束。

删除 82 个兼容变量别名，原 style.css 从 547 行成为 7 行入口。仍在使用的布局按现有设计组件归属分为 6 个文件；不是把旧 CSS 压成短行。原 586 条规则 / 1863 条声明减为保留布局的 526 条规则 / 1678 条声明；移除记录共 86 项（包含废弃选择器和同选择器后继覆盖的声明）。保留全部 DOM 语义钩子，不为没有 DOM 作用的钩子添加空 CSS 规则。

补齐 134 个按钮调用与 1 个候选表格的设计组件组合，迁移 3 处等值的 white-space/overflow-wrap 内联样式。催单历史 class 搬至设计层 UrgencyTag，tone 继续来自 status-map。ESLint 10.14.0 与 parser 8.72.1 按本次用户“安装那 ESLint”授权安装，仅开发依赖；根锁记录 55 个新增包。已有 escape-string-regexp 的 optional 标记因 ESLint 的必要依赖关系移除，版本/来源/完整性不变。直接运行时依赖逐项一致。

实际渲染另收敛 HeroUI 的 12.25px、11.2px、10.4px 字号及 9px 圆角，全部使用已有 Token；保留 20px 头像对应 10px 字形的规范例外。未新增颜色、字号、圆角、阴影或交互模式。

输入输出仍为原 props/DTO/命令/查询/回执；无 Schema、数据库迁移、API、请求参数、Ticket 状态、权限判断、Query/Zustand 结构、草稿、UNKNOWN 或实时逻辑改动。25 个功能文件的非表现 AST 一致，4001 处调用表达式逐项一致；class/data 钩子核验通过。两份原浏览器测试只增加 4 处 primary 断言；另两份退回测试仅适配 Card 5 已移至标题下的状态定位、真实展开协作区，全部原业务断言保留。静态比较排除表现属性和已确认的组件 import，不能代替实际交互回归。

## 2. 本卡文件清单

以下是相对本卡起点的增量；不把先前卡片及用户改动重复归入本卡。删除文件：无。

| 操作 | 文件 | 说明 |
| --- | --- | --- |
| 修改 | .github/workflows/types-migration.yml | 仅在两处现有工具回归列表中加入新的正反例测试。 |
| 新增 | app/pc-admin/eslint.config.mjs | 功能层的 no-restricted-syntax 规则，覆盖别名导入、variant、内联 style 和 status-chip 字面量/模板。 |
| 修改 | app/pc-admin/package.json | 与根依赖版本对齐，提供 lint:features。 |
| 修改 | app/pc-admin/src/app/heroui-workbench.css | 所有既有 WorkbenchSelect 的值继承语义字号，消除 12.25px。 |
| 修改 | app/pc-admin/src/design/base.css | 已有 Token 覆盖 HeroUI 复选框、链接、开关与 small 的默认字号/圆角。 |
| 新增 | app/pc-admin/src/design/components/BoardColumn/workbench-board.css | 保留看板、卡片、分页和分组布局；移除旧颜色类表现。 |
| 新增 | app/pc-admin/src/design/components/DataTable/workbench-table.css | 保留表格列宽、行与来源群布局；原 900px 表格滚动下界保持。 |
| 新增 | app/pc-admin/src/design/components/Drawer/detail-content.css | 保留抽屉资料、媒体、语音与通知布局；reduced-motion 不再重新启用语音动画。 |
| 修改 | app/pc-admin/src/design/components/FilterSelect/filter-select.css | 统一筛选值字号，保留所有交互状态。 |
| 新增 | app/pc-admin/src/design/components/FormLayout/workflow-forms.css | 保留命令表单、版本/回执提示、复核、设置与维护布局。 |
| 新增 | app/pc-admin/src/design/components/InlineAlert/feedback.css | 归属现有 Toast、草稿及反馈样式，不改提示状态或持有者。 |
| 修改 | app/pc-admin/src/design/components/Split/split.css | 会话 small 使用 12px Token。 |
| 修改 | app/pc-admin/src/design/components/Tag/Tag.tsx | 新增 UrgencyTag 组合，保留 status-chip/orange/web-report-urge 三个历史钩子。 |
| 修改 | app/pc-admin/src/design/components/Timeline/timeline.css | 可见范围文字采用 secondary，满足必读信息对比度。 |
| 新增 | app/pc-admin/src/design/shell.css | 保留启动屏、应用壳、导航、账号、提醒与跟进浮层的实际布局。 |
| 修改 | app/pc-admin/src/design/tokens.css | 删除 82 个旧变量别名；保留色板、语义 Token、HeroUI 桥接。 |
| 修改 | app/pc-admin/src/features/assignment-history/TicketAssignmentHistory.tsx | 旧 WorkbenchButton/variant 改为现有设计 Button/tone；原命令、状态、选择器及事件回调不变。 |
| 修改 | app/pc-admin/src/features/board-actions/BoardActions.tsx | 旧 WorkbenchButton/variant 改为现有设计 Button/tone；原命令、状态、选择器及事件回调不变。 |
| 修改 | app/pc-admin/src/features/board-actions/BoardConflictIntent.tsx | 旧 WorkbenchButton/variant 改为现有设计 Button/tone；原命令、状态、选择器及事件回调不变。 |
| 修改 | app/pc-admin/src/features/follow-up/SharedFollowUp.tsx | 旧 WorkbenchButton/variant 改为现有设计 Button/tone；原命令、状态、选择器及事件回调不变。 |
| 修改 | app/pc-admin/src/features/incident-candidates/candidate.css | 为原 3 处内联文本换行样式提供同值 class。 |
| 修改 | app/pc-admin/src/features/incident-candidates/CandidateDecisionForm.tsx | 旧 WorkbenchButton/variant 改为现有设计 Button/tone；原命令、状态、选择器及事件回调不变。 |
| 修改 | app/pc-admin/src/features/incident-candidates/CandidateDetail.tsx | 旧 WorkbenchButton/variant 改为现有设计 Button/tone；原命令、状态、选择器及事件回调不变。 |
| 修改 | app/pc-admin/src/features/incident-candidates/IncidentCandidates.tsx | 使用现有 DataTable 和 Button；筛选、查询及分页不变。 |
| 修改 | app/pc-admin/src/features/incident-candidates/IncidentDeliveryControls.tsx | 旧 WorkbenchButton/variant 改为现有设计 Button/tone；原命令、状态、选择器及事件回调不变。 |
| 修改 | app/pc-admin/src/features/incident-candidates/IncidentFollowup.tsx | 旧 WorkbenchButton/variant 改为现有设计 Button/tone；原命令、状态、选择器及事件回调不变。 |
| 修改 | app/pc-admin/src/features/incident-candidates/IncidentInternalNotes.tsx | 使用设计按钮，并把原内联换行样式迁到 CSS；请求、内部/公开隔离和恢复流程不变。 |
| 修改 | app/pc-admin/src/features/incident-candidates/IncidentOwnerTransfer.tsx | 旧 WorkbenchButton/variant 改为现有设计 Button/tone；原命令、状态、选择器及事件回调不变。 |
| 修改 | app/pc-admin/src/features/incident-candidates/IncidentPublicProgress.tsx | 使用设计按钮，并把原内联换行样式迁到 CSS；请求、内部/公开隔离和恢复流程不变。 |
| 修改 | app/pc-admin/src/features/incident-candidates/IncidentResult.tsx | 旧 WorkbenchButton/variant 改为现有设计 Button/tone；原命令、状态、选择器及事件回调不变。 |
| 修改 | app/pc-admin/src/features/item-follow/ItemFollow.tsx | 旧 WorkbenchButton/variant 改为现有设计 Button/tone；原命令、状态、选择器及事件回调不变。 |
| 修改 | app/pc-admin/src/features/manual-review/ReviewStartControls.tsx | 旧 WorkbenchButton/variant 改为现有设计 Button/tone；原命令、状态、选择器及事件回调不变。 |
| 修改 | app/pc-admin/src/features/manual-review/ReviewWorkspace.tsx | 旧 WorkbenchButton/variant 改为现有设计 Button/tone；原命令、状态、选择器及事件回调不变。 |
| 修改 | app/pc-admin/src/features/search/WorkbenchSearch.tsx | 旧 WorkbenchButton/variant 改为现有设计 Button/tone；原命令、状态、选择器及事件回调不变。 |
| 修改 | app/pc-admin/src/features/supplement-follow-up/SupplementFollowUp.tsx | 旧 WorkbenchButton/variant 改为现有设计 Button/tone；原命令、状态、选择器及事件回调不变。 |
| 修改 | app/pc-admin/src/features/ticket-notes/TicketNotes.tsx | 旧 WorkbenchButton/variant 改为现有设计 Button/tone；原命令、状态、选择器及事件回调不变。 |
| 修改 | app/pc-admin/src/features/ticket-reopen/TicketReopen.tsx | 旧 WorkbenchButton/variant 改为现有设计 Button/tone；原命令、状态、选择器及事件回调不变。 |
| 修改 | app/pc-admin/src/features/ticket-return-to-dispatch/TicketReturnToDispatch.tsx | 旧 WorkbenchButton/variant 改为现有设计 Button/tone；原命令、状态、选择器及事件回调不变。 |
| 修改 | app/pc-admin/src/features/ticket-takeover-completion/TicketTakeoverCompletion.tsx | 旧 WorkbenchButton/variant 改为现有设计 Button/tone；原命令、状态、选择器及事件回调不变。 |
| 修改 | app/pc-admin/src/features/ticket-takeover/TicketTakeover.tsx | 旧 WorkbenchButton/variant 改为现有设计 Button/tone；原命令、状态、选择器及事件回调不变。 |
| 修改 | app/pc-admin/src/features/ticket-unassign/TicketUnassign.tsx | 旧 WorkbenchButton/variant 改为现有设计 Button/tone；原命令、状态、选择器及事件回调不变。 |
| 修改 | app/pc-admin/src/features/web-report/WebReportUrgency.tsx | 组合 UrgencyTag；原 active/count/time/文案判断不变。 |
| 修改 | app/pc-admin/src/style.css | 547 行收敛为 7 行入口，按所属组件加载保留的布局规则。 |
| 新增 | docs/ui/design-system-v2-card7-cleanup-and-enforcement.md | 本卡交付、9.4 清单、证据与回退说明。 |
| 修改 | package-lock.json | 根锁文件记录 55 个新增开发依赖包及必要的依赖元数据变化；运行时直接依赖未变。 |
| 修改 | package.json | 精确锁定 ESLint 与 TypeScript parser，仅开发依赖。 |
| 修改 | tests/t08-unassign.browser.test.mts | 状态定位迁至标题下的 StatusBadge，并真实展开处理与协作；全部退单请求/事件/责任/受众断言保留。 |
| 修改 | tests/t09-return-to-dispatch.browser.test.mts | 适配同一状态展示位置及真实展开，保留 UNKNOWN、原 UUID、显式 ACK 和全部业务断言。 |
| 修改 | tests/workbench-detail-media.browser.test.mts | 在活动 v3-p09 入口内增加详情/媒体弹窗主按钮断言。 |
| 修改 | tests/workbench-detail-restructure.browser.test.mts | 增加页面/弹窗主按钮断言；原断言保持。 |
| 新增 | tools/ts-migration/design-system.mts | 扫描未定义变量与原始色板泄漏，并调用实际 ESLint。 |
| 新增 | tools/ts-migration/design-system.test.mts | 正反例验证 ESLint 与变量检查，覆盖未知变量 fallback、模板 class、别名及内联样式。 |
| 修改 | tools/ts-migration/gate.mts | 现有 types 门禁依次执行 CSS、变量与功能语法检查。 |

## 3. 前后对照与四宽截图

[前后截图浏览页](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/gallery.html)：11 个场景 × 4 宽度 × 前后，共 88 张；另有 4 张 Tab 焦点截图。44 张最终视觉图实际绑定 329aa70271d13a0de84353bd3db944342bc8464b9fa97c880b0bb4abbf0c11a8；后继只改两份测试及 source map，2735 个其它产物（含全部 PC 资源）逐字节一致。未将旧图改称后继重跑。所有采图请求中 POST 为 0；夹具准备阶段使用任务自有 PG 的合成数据及原测试接口。

| 部位 | 改前 | 改后 |
| --- | --- | --- |
| 样式入口 | 547 行，兼容别名与后继覆盖并存 | 7 行入口，按组件归属加载，82 个别名删除 |
| 功能按钮 | 134 处旧 variant 调用经旧封装进入 HeroUI | 使用现有设计 Button / tone，原行为与钩子保留 |
| 下拉及辅助文字 | 库默认 12.25 / 11.2 / 10.4px | 使用已有 12 / 13 / 14px Token |
| 复选框、链接、开关 | 库默认产生 9px 圆角 | 分别使用 4 / 6 / 全圆语义值 |
| 时间线可见范围 | tertiary，白底 3.45:1 | secondary，白底约 5.48:1 |
| 四个一级页面 | 已沿用 Card 3–6 的骨架 | 标题坐标与布局继续一致，没有为清理改动业务结构 |

| 场景 | 1920 | 1440 | 1280 | 900 |
| --- | --- | --- | --- | --- |
| 团队工作台 | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-board-1920.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-board-1920.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-board-1440.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-board-1440.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-board-1280.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-board-1280.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-board-900.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-board-900.png) |
| 工单抽屉 | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-drawer-1920.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-drawer-1920.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-drawer-1440.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-drawer-1440.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-drawer-1280.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-drawer-1280.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-drawer-900.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-drawer-900.png) |
| 联系人列表 | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-contacts-1920.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-contacts-1920.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-contacts-1440.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-contacts-1440.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-contacts-1280.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-contacts-1280.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-contacts-900.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-contacts-900.png) |
| 联系人会话 | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-chat-1920.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-chat-1920.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-chat-1440.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-chat-1440.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-chat-1280.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-chat-1280.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-chat-900.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-chat-900.png) |
| 服务会话 | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-session-1920.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-session-1920.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-session-1440.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-session-1440.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-session-1280.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-session-1280.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-session-900.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-session-900.png) |
| 会话空态 | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-empty-1920.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-empty-1920.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-empty-1440.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-empty-1440.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-empty-1280.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-empty-1280.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-empty-900.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-empty-900.png) |
| 通知异常 | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-exceptions-1920.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-exceptions-1920.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-exceptions-1440.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-exceptions-1440.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-exceptions-1280.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-exceptions-1280.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-exceptions-900.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-exceptions-900.png) |
| 新报修 | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-form-1920.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-form-1920.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-form-1440.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-form-1440.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-form-1280.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-form-1280.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-form-900.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-form-900.png) |
| 来源群 | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-groups-1920.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-groups-1920.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-groups-1440.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-groups-1440.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-groups-1280.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-groups-1280.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-groups-900.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-groups-900.png) |
| 群名称维护 | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-group-edit-1920.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-group-edit-1920.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-group-edit-1440.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-group-edit-1440.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-group-edit-1280.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-group-edit-1280.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-group-edit-900.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-group-edit-900.png) |
| 设置 | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-settings-1920.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-settings-1920.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-settings-1440.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-settings-1440.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-settings-1280.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-settings-1280.png) | [前](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/before-settings-900.png) / [后](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/screenshots/after-settings-900.png) |

工作台、会话、通知异常、新报修四页 h1 左上角测量：

| 视口 | 四页共同坐标 | 四页误差 |
| ---: | --- | ---: |
| 1920 | (300, 64) | 0px |
| 1440 | (300, 64) | 0px |
| 1280 | (292, 64) | 0px |
| 900 | (44, 64) | 0px |

页面根无水平溢出；≥1280px 工具栏不换行且不横向溢出。900px 看板沿规范的三列 minmax(300px,1fr)，在看板容器内横向滚动，不扩大页面根宽度。原表格 900px 内部滚动下界保持。

## 4. 度量

在 app/pc-admin 下实际执行 npx --no-install stylelint "src/**/*.css" --formatter json，exit 0。43 份 CSS，原配置忽略独立登录页 2 份，实际检查 41 份；违规 0，相对 Card 6 为 0→0。CLI JSON 写入 stderr，原件完整保留。

| 规则 | 卡 6 | 卡 7 |
| --- | ---: | ---: |
| color-no-hex | 0 | 0 |
| color-named | 0 | 0 |
| function-disallowed-list | 0 | 0 |
| declaration-no-important | 0 | 0 |
| unit-disallowed-list | 0 | 0 |
| declaration-property-value-allowed-list | 0 | 0 |
| 合计 | 0 | 0 |

ESLint 实际检查 88 份功能 TS/TSX，0 违规；变量检查覆盖业务工作区全部 CSS，未定义变量与原始色板泄漏均为 0。React Aria 的 --trigger-width 是显式验证的运行时几何变量，检查器核对当前锁定 Popover.cjs 提供者，未用通配豁免掩盖未知变量。

## 5. 最终验证与身份

HEAD 8ad55a19bf5d3ab6d46e534c345cea17eb634e8a；被测对象是该 HEAD 上的未提交工作区，不能称 HEAD 本身已包含本卡。最终输入指纹 90da27946cdd80379218f056dae74a064facf6d47d98fb9b34b3a91a16335923，manifest SHA-256 8a480986662c114c5ce55e7c6daf351df456f4841198716da6f82f3b5118f043。

| 检查 | 实际结果 |
| --- | --- |
| npm run migration:build | PASS；911 strict 模块，911/911 原生语法检查 |
| node .build/tools/gate.mjs types | PASS；Stylelint、变量、ESLint、完整 strict、负向类型检查 |
| node .build/tools/verify-artifact.mjs | ARTIFACT_VERIFIED_NOT_ACTIVATED |
| 新增设计约束工具回归 | 2 PASS / 0 FAIL / 0 SKIP |
| 相关注册浏览器入口 | 57 入口，124 tests / 124 PASS；0 FAIL / CANCELLED / SKIP / TODO / NOT_RUN |
| 四宽截图及几何/色彩/字号/圆角断言 | 44 个最终场景 PASS；4 个 Tab 焦点 PASS |
| class/data 与非表现 AST | PASS；4001→4001 调用，原测试断言保留 |
| 指令文档检查及其测试 | PASS |
| 现有 workflow YAML | PASS；两处现有工具任务接入正反例 |
| 自有资源 | PASS；UUID 合成库 0，其他客户端 0，PG 与浏览器关闭 |

42 个未修改入口的 88 项检查绑定视觉候选 329aa70271d13a0de84353bd3db944342bc8464b9fa97c880b0bb4abbf0c11a8；后继 15 个入口在最终候选实际运行。输入清单只变化两份退回测试，2735 个其它产物与所有其它测试内容保持字节一致，详见 artifact-equivalence.json。没有把前继的 42 项入口称为后继重跑。

这是活动 v3-p09 的相关注册子集与按实际按钮/全局 CSS 影响追加的入口，不是活动全集、full、certify、远端 CI、Electron 原生、现场或用户接受状态。无真实企业微信、SSO、外部发送、部署或 Gate 推进。远端 CI 未运行，本次仅完成接线及其本地等价入口验证。

| 实际注册入口 | tests / PASS |
| --- | ---: |
| tests/conversation-inbox.browser.test.mts | 4 / 4 |
| tests/wbint-t22-conversations.browser.test.mts | 1 / 1 |
| tests/t36-bound-reply-production.browser.test.mts | 1 / 1 |
| tests/t36-reply-purpose-isolation.browser.test.mts | 1 / 1 |
| tests/wbint-t32-notification-exceptions.browser.test.mts | 1 / 1 |
| tests/wbint-t32-exception-route.browser.test.mts | 1 / 1 |
| tests/wbint-t32-exception-authorization.browser.test.mts | 1 / 1 |
| tests/web01-workbench.browser.test.mjs | 9 / 9 |
| tests/wbint-t17-manual-form.browser.test.mts | 1 / 1 |
| tests/wbint-t17-manual-unknown.browser.test.mts | 1 / 1 |
| tests/wbint-t17-manual-authority.browser.test.mts | 1 / 1 |
| tests/wbint-t18-normal-verified-form.browser.test.mts | 1 / 1 |
| tests/t12-production-form.browser.test.mts | 2 / 2 |
| tests/wbint-t40-reminder-preferences.browser.test.mts | 2 / 2 |
| tests/t06-assignment.browser.test.mts | 1 / 1 |
| tests/t10-cancel.browser.test.mts | 1 / 1 |
| tests/t11-completion.browser.test.mts | 7 / 7 |
| tests/t05-conversation-handling.browser.test.mjs | 10 / 10 |
| tests/workbench-detail-media.browser.test.mts | 1 / 1 |
| tests/t35-normal-long-material.browser.test.mts | 2 / 2 |
| tests/t35-normal-web-visible.browser.test.mts | 1 / 1 |
| tests/wbint-t14-review.browser.test.mts | 5 / 5 |
| tests/wbint-t15-review-start-recovery.browser.test.mts | 1 / 1 |
| tests/wbint-t15-review-start-team-window.browser.test.mts | 1 / 1 |
| tests/wbint-t15-review-start-wide.browser.test.mts | 1 / 1 |
| tests/wbint-t15-review-start-restoration-boundaries.browser.test.mts | 6 / 6 |
| tests/wbint-t15-review-start.browser.test.mts | 1 / 1 |
| tests/wbint-t42-board-review.browser.test.mts | 1 / 1 |
| tests/wbint-t42-board-legal-action.browser.test.mts | 1 / 1 |
| tests/wbint-t42-board-boundaries.browser.test.mts | 4 / 4 |
| tests/wbint-t42-board-capability-fallback.browser.test.mts | 2 / 2 |
| tests/wbint-t42-board-authority-navigation.browser.test.mts | 3 / 3 |
| tests/wbint-t42-board-complete-reopen.browser.test.mts | 1 / 1 |
| tests/t08-unassign.browser.test.mts | 1 / 1 |
| tests/t09-return-to-dispatch.browser.test.mts | 1 / 1 |
| tests/wbint-t34-follow-production.browser.test.mts | 1 / 1 |
| tests/wbint-t34-follow-recovery.browser.test.mts | 5 / 5 |
| tests/t37-shared-follow-up-drawer.browser.test.mts | 1 / 1 |
| tests/t37-shared-time-card-list.browser.test.mts | 1 / 1 |
| tests/wbint-t30-internal-note.browser.test.mts | 1 / 1 |
| tests/wbint-t30-recovery.browser.test.mts | 4 / 4 |
| tests/t41-search-production.browser.test.mts | 2 / 2 |
| tests/t41-search-refresh-and-long-pages.browser.test.mts | 2 / 2 |
| tests/t41-search-pending-hint.browser.test.mts | 2 / 2 |
| tests/wbint-t27-candidate.browser.test.mjs | 1 / 1 |
| tests/wbint-t27-candidate-detail.browser.test.mjs | 1 / 1 |
| tests/wbint-t33-incident-delivery-production.browser.test.mts | 1 / 1 |
| tests/wbint-t33-incident-delivery-response-loss.browser.test.mts | 1 / 1 |
| tests/wbint-t33-incident-delivery-reload-recovery.browser.test.mts | 1 / 1 |
| tests/wbint-t33-incident-delivery-scoped-rebase.browser.test.mts | 1 / 1 |
| tests/wbint-t33-incident-delivery-state-not-purpose.browser.test.mts | 1 / 1 |
| tests/wbint-t43-incident-delivery.browser.test.mts | 1 / 1 |
| tests/all43-incident-draft-transient.browser.test.mts | 3 / 3 |
| tests/workbench-detail-restructure.browser.test.mts | 2 / 2 |
| tests/workbench-desktop-session.browser.test.mts | 11 / 11 |
| tests/workbench-toast-feedback.browser.test.mts | 1 / 1 |
| tests/workbench-startup.browser.test.mts | 1 / 1 |

保留的初始失败与中间结果：

- 首轮 continuity 的 T08 状态定位超时，后 10 个入口 NOT_RUN。用同一合成 Ticket 分别服务卡 7 改前与改后 bundle：两者旧“属性表状态”定位均不存在，标题状态/处理人正确，真实展开后表单可用。仅适配 T08/T09 的视觉定位和展开，未改预期状态、请求、责任、版本、事件、UNKNOWN 或受众断言；最终两者及其余 continuity 入口通过。
- 首轮 shell 的登录挂绳翻面等待超时，该文件其余 10 项通过，后 2 个入口 NOT_RUN。登录 18 份代码/样式/媒体产物与 Card 6 已通过候选逐字节一致。未改登录实现、测试、超时或断言；原入口重跑通过，仅记录未再次复现，不声称修复了该偶发问题。原 FAIL、TAP、诊断与 NOT_RUN 清单保留。
- 后继 continuity 在 Unicode128 查询的结果更新等待超时，短查询与原 55 秒 T38 观察通过，最后 1 个提示入口 NOT_RUN。保留该 FAIL；同生产代码的聚焦诊断加了失败采图，但未再次复现；原注册文件完整重跑两个场景后通过，补跑提示入口。未改搜索产品代码、原测试、等待上限或断言，不声称已消除该偶发问题。continuity-complete 是同一最终候选上 9 个通过入口加 2 个补跑入口的明确聚合，原失败 summary 不改写。

- 初次前端预检发现批量 variant 替换触及一处 Table 的无效 tone；改用既有 DataTable，未修改筛选、请求、分页或断言。
- 新增变量测试初轮 1 PASS / 1 FAIL：检查器误定位到 Select.cjs；读取实际锁定实现后改为 Popover.cjs，最终 2/2 通过。
- 预览脚本在工具 bootstrap 重新准备构建树后读取了尚不存在的 staged fixture，导入失败；未运行浏览器或业务请求。正式候选完成构建后重跑通过。
- 首轮/确认轮截图暴露库默认字号、圆角及可见范围对比度；旧图与 JSON 保留，最终断言无异常。一次颜色测量脚本把 oklab 当作 rgb 解析，修为浏览器 Canvas 色彩转换后确认群表选中态没有该对比度问题，未因此改产品颜色。
- AST 报告工具初次未规范化空 JSX 属性容器，另有测试起点重建比较问题；只修正证据工具，最终比较通过。详情结构测试起点由已保存的“含本卡新增断言”文件精确移除本卡 import/调用重建，文本比较规范化 EOL；来源说明与原副本保留。
- 一次 build 包装器指向本地不存在的 npm 模块，未进入构建；随后实际 npm run migration:build 完成。所有中间构建各保留原指纹，只有最终候选的检查计入本节。
- Vite 仍报告既有大 chunk 提示；本卡未改分包或业务加载行为。

机械设计扫描 1 条既有 warning：manual-report-audience 的中性左分隔线，本卡未新增；它表达原有受众提示，未因通用检测器改写该流程。扫描不替代截图和实际浏览器断言。

## 6. 设计系统 §9.4 逐条验收

| 清单项 | 是/否 + 当前证据 |
| --- | --- |
| 业务 CSS 裸 hex=0、未定义变量=0、important=0 | 是；Stylelint 41 文件 0 违规，types 的 DESIGN_VARIABLES 未定义/色板泄漏均 0 |
| 字号/字重/圆角属于规定集合 | 是；44 个最终场景逐元素计算样式无越界，头像半尺寸字形按规范例外；0 圆角为无圆角容器/重置 |
| 单一品牌蓝、每可见区域 primary≤1 | 是；实际启用 primary 背景为 rgb(37,99,201)，区域数量断言全部通过；语义 tone 色按原规范保留 |
| 四个一级页标题坐标误差 0px | 是；四宽量测表及 capture-after-result.json |
| 看板不重复列阶段、彩色 Tag≤2、来源/人名不是标签 | 是；四宽卡片/中性来源断言；姓名及 Avatar 组合保持 |
| 抽屉主操作在标题下右侧、记录姓名纯文字 | 是；原 detail-restructure 位置断言通过；四宽记录姓名背景透明/边框 0 的计算样式断言通过 |
| 必读文字对比度≥4.5:1、Tab 焦点可见 | 是；44 场景无不合格必读文字，4 宽实际 Tab 均为 2px border-focus；禁用/装饰及未提供占位不承载必读信息 |
| 四宽无页面溢出、≥1280 工具栏单行 | 是；44 场景根溢出为 false，工具栏 nowrap 且内部未溢出；900 看板内部滚动按模板保留 |
| Stylelint、变量、primary 断言已进 CI | 是（代码接线）；前两项经现有 types job，primary 经活动 selection 的媒体测试；正反例加入现有两处工具任务。未声称远端 CI 已运行 |

## 7. 规范偏差与自检

本卡主动做出的视觉适用差异：§6.9/§7 将“内部/对外”后缀写为 tertiary，而 §3.7 与本次验收要求必读信息≥4.5:1。本卡将该受众提示改用已有 secondary，字号仍 12px、纯文字不加框。理由是受众边界应可读；建议后续将 §6.9/§7 同步为 secondary。没有发明或新增视觉值。未知/缺失字段“未提供”继续按 §6.8 使用占位灰度。

| 本卡自检 | 是/否 + 证据 |
| --- | --- |
| 只改视觉层，无业务行为/请求/状态值变动 | 是；4001 处调用及非表现 AST 一致，57 个原注册入口通过 |
| class/data 保留、业务断言未削弱 | 是；integrity.json；两份测试各仅新增两处 primary 调用，另两份仅视觉定位与展开适配 |
| 新/迁入 CSS 无裸色、裸字号、裸圆角、important | 是；原 Stylelint 配置 0 违规 |
| 每可见区域 primary≤1 | 是；四宽场景及两份注册测试的实际断言 |
| hover/focus/disabled/loading/空数据/长文本有对应状态 | 是；本卡复用既有 Button/Tag/FilterSelect/DataTable 的状态，不新增命令状态；实际恢复、禁用、未知与长数据原回归通过。UrgencyTag 是静态 Tag 组合，pressed/loading 不适用 |
| 四宽均截图核对 | 是；88 张对照图、4 张 Tab 图；几何、色彩、尺度和主按钮断言通过 |
| 未发明规范外视觉值 | 是；只使用既有 Token；受众灰度适用差异已明确记录 |

## 8. 资源、回退与后继

输入/输出合同和默认持久 Feature Flag 不变，无数据库回滚。任务仅使用 loopback 58448、PG18 max_connections=8；按注册入口顺序运行。停止前库清单仅 postgres/template0/template1，其他客户端为 0；pg_ctl status=3，PID 与监听已关闭。采图自有浏览器 process/profile/timer/socket 均为 0。详细删除/保留见 cleanup.json，不操作 Card 0–6 或其它任务资源。

回退以本卡 source-before 按文件恢复已修改内容，仅移除本卡新增的 ESLint 配置、两个工具文件、六个布局样式文件和本文；恢复本卡起点 package/根锁后按原依赖流程恢复安装。两份测试仅撤回已标记的 import 和 4 处新增调用；详情结构测试的保存/重建来源已在失败说明中区分。保留用户原有改动，不使用 reset/clean。回退后重新生成构建，不把当前 staged 产物当作旧源码制品。

本地任务卡 7 已完成；没有定义卡 8。本地设计系统收敛与检查可供人工验收，未对外更新 GitHub Issues/业务 Backlog，未自动发布或推进任何 Gate。

证据入口：[最终验证汇总](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/validation-delivery.json) · [资源关闭](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/cleanup.json) · [静态边界核验](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/integrity.json) · [CSS 清理度量](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/css-cleanup.json) · [前后图库](D:/CodexEvidence/pc-admin-design-v2-card7-20261101/gallery.html)。
