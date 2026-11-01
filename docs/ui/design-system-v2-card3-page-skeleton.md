# 设计系统 v2.0 · 卡 3 骨架组件与页面模板

2026-11-01。卡 3 本地验证完成：按设计系统第五章、§6.1–6.3、§6.11 统一一级页面骨架与基础控件。未提交、推送、创建 PR、部署或推进现场 Gate。

## 1. 候选与改动摘要

- 延用分支 `codex/pc-admin-design-v2-card0`，保留卡 0–2 的全部未提交改动。
- 本地 head：`8ad55a19bf5d3ab6d46e534c345cea17eb634e8a`；被测对象为 head 加本地未提交工作。
- 构建输入指纹：`96fcb997ba26d75006232c2d7aa57d88c80e021e9ba08340c5ba731c8f084c24`。
- 最终 manifest SHA-256：`2d05f59c9312f44d3675ff3a3b6585c409cfa9dc3e5bdc01791fb56e6c2c742d`。
- 环境：Windows、Node.js 24.18.0、任务自有 PG18（loopback 58434，最多 8 连接）、现有系统浏览器/CDP、合成夹具。
- 工作台、会话、服务会话、通知异常、新报修（普通与本人处理）、公共故障候选、来源群设置采用相同 PageHeader + Toolbar；内容左对齐，最大 1440，使用 `--page-pad-x`。
- 工作台移除图标瓷砖与 slogan，新报修是页头唯一 primary，刷新为 ghost 图标，日期及组合筛选进入一行工具栏的筛选弹层，加载计数移到列底。
- 会话使用单个内嵌图标搜索框，回车提交；两个筛选使用行内前缀；空列表只保留一个 EmptyState 并隐藏分页。
- 无 API、请求参数、Schema、数据库迁移、Ticket 状态、权限、Query/Zustand 结构、草稿、UNKNOWN 恢复、实时事件或持久 Feature Flag 变更。差异检查确认 114 处控制器/API/查询调用及 69 处既有 data 属性保持不变。断言审计覆盖 247 条原断言；除按 v2 加强的一条窄屏布局断言外，其余 246 条保持原文，另新增三条区域计数检查。

## 2. 文件清单（仅卡 3 增量）

卡 0–2 原有 package、锁文件、AGENTS、Token、业务 CSS 和工具 gate 改动不重复归入本卡。根 package、根锁文件、应用 package 和 Stylelint 配置字节均与本卡起点一致。

| 操作 | 文件 | 说明 |
| --- | --- | --- |
| 新增 | `app/pc-admin/src/design/components/Button/Button.tsx` | 四种 tone、三档尺寸、图标按钮、loading 保宽和可见焦点 |
| 新增 | `app/pc-admin/src/design/components/Button/button.css` | Token 样式及适用的交互、禁用、长文本状态 |
| 新增 | `app/pc-admin/src/design/components/PageHeader/PageHeader.tsx` | 统一标题、说明和右侧操作区 |
| 新增 | `app/pc-admin/src/design/components/PageHeader/page-header.css` | Token 样式及适用的交互、禁用、长文本状态 |
| 新增 | `app/pc-admin/src/design/components/Toolbar/Toolbar.tsx` | 单行工具栏与原生筛选弹层，原控件保持挂载 |
| 新增 | `app/pc-admin/src/design/components/Toolbar/toolbar.css` | Token 样式及适用的交互、禁用、长文本状态 |
| 新增 | `app/pc-admin/src/design/components/SegmentedControl/SegmentedControl.tsx` | 范围和视图切换共用外形，值与处理器仍由原控制器持有 |
| 新增 | `app/pc-admin/src/design/components/SegmentedControl/segmented-control.css` | Token 样式及适用的交互、禁用、长文本状态 |
| 新增 | `app/pc-admin/src/design/components/SearchField/SearchField.tsx` | 内嵌搜索图标、输入和清除动作 |
| 新增 | `app/pc-admin/src/design/components/SearchField/search-field.css` | Token 样式及适用的交互、禁用、长文本状态 |
| 新增 | `app/pc-admin/src/design/components/FilterSelect/FilterSelect.tsx` | 复用现有 Select 的行内前缀显示 |
| 新增 | `app/pc-admin/src/design/components/FilterSelect/filter-select.css` | Token 样式及适用的交互、禁用、长文本状态 |
| 新增 | `app/pc-admin/src/design/components/EmptyState/EmptyState.tsx` | 统一图标、标题、说明和可选操作 |
| 新增 | `app/pc-admin/src/design/components/EmptyState/empty-state.css` | Token 样式及适用的交互、禁用、长文本状态 |
| 新增 | `app/pc-admin/src/design/components/InlineAlert/InlineAlert.tsx` | 统一有文字和图标的语义提示 |
| 新增 | `app/pc-admin/src/design/components/InlineAlert/inline-alert.css` | Token 样式及适用的交互、禁用、长文本状态 |
| 新增 | `app/pc-admin/src/design/base.css` | 页面宽度、留白、Board/Split/Form 的骨架作用域 |
| 修改 | `app/pc-admin/src/design/foundation.css` | 按 Token → base → 组件/功能样式的顺序接入基础样式 |
| 修改 | `app/pc-admin/src/app/Workbench.tsx` | 工作台骨架、按钮、工具栏、分段控件及列底计数；权限提示保留到顶栏 |
| 修改 | `app/pc-admin/src/app/WorkbenchSelect.tsx` | 仅增加可选 inlinePrefix 显示，保留值和选择回调 |
| 修改 | `app/pc-admin/src/features/conversations/ConversationInbox.tsx` | 会话页头、搜索、筛选、空态和分页的视觉模板 |
| 修改 | `app/pc-admin/src/features/conversations/Conversations.tsx` | 服务会话页头、工具栏和空态 |
| 修改 | `app/pc-admin/src/features/notification-exceptions/NotificationExceptions.tsx` | 页头、筛选工具栏、空态与错误提示 |
| 修改 | `app/pc-admin/src/features/incident-candidates/IncidentCandidates.tsx` | 候选页头、工具栏、空态及未启用页面骨架 |
| 修改 | `app/pc-admin/src/features/manual-report/ManualReportForm.tsx` | 新报修入口 primary 与普通代录页骨架 |
| 修改 | `app/pc-admin/src/features/manual-report/ManualSelfHandlingForm.tsx` | 本人处理模式复用相同页面骨架 |
| 修改 | `app/pc-admin/src/features/source-groups/SourceGroupDirectory.tsx` | 来源群页头、搜索工具栏和空态 |
| 修改 | `tests/helpers/heroui-workbench-controls.mts` | 真实展开筛选后再操作；增加每区域 primary ≤ 1 断言 |
| 修改 | `tests/web01-workbench.browser.test.mjs` | 截图调用 primary 断言；900 宽检查三列最小 300 与局部滚动 |
| 修改 | `tests/web01-closed-range.browser.test.mts` | 重载后真实展开筛选；保持日期与条数断言，计数定位到列底 |
| 修改 | `tests/t37-shared-time-card-list.browser.test.mts` | 刷新按钮定位改到页头 |
| 修改 | `tests/t41-search-pending-hint.browser.test.mts` | 刷新按钮定位改到页头 |
| 修改 | `tests/t41-search-refresh-and-long-pages.browser.test.mts` | 50 项计数定位改到列底，保留原查询和分页断言 |
| 新增 | `docs/ui/design-system-v2-card3-page-skeleton.md` | 本交付记录 |

删除文件：无。`main.tsx` 保持本卡起点字节，基础样式在 foundation.css 内导入。

## 3. 前后对照与四宽截图

同一合成夹具依次提供保存的改前生产 bundle 与最终正式 bundle。八类视图（七类页面加会话空列表）× 四宽 × 前后，共 64 张；另有四宽组件状态图。视觉采集和搜索操作共 0 个 POST。所有原件及测量值见 `D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots-result.json`。

| 部位 | 改前 | 改后 |
| --- | --- | --- |
| 页面骨架 | 标题、宽度、居中方式和工具栏各自定义 | 共用 PageHeader + Toolbar，左对齐、最大 1440 |
| 工作台页头 | 64px 图标块、slogan、页头权限徽标 | 20px 行内图标、24/600 标题；权限提示保留到顶栏 |
| 主次动作 | 新报修与刷新同重 | 页头唯一蓝色新报修；刷新是 32×32 ghost |
| 工作台工具栏 | 两行，日期和加载总量占据第二行 | 一行；筛选保留原控件并收进弹层，计数在列底 |
| 会话搜索和筛选 | 外置标签、输入及搜索按钮，筛选上下排列 | 单搜索框回车提交，行内前缀筛选 |
| 会话空态 | 列表、右侧同时提示，空列表有禁用分页 | 空列表只有一个 EmptyState，分页隐藏 |
| 窄屏看板 | 900 宽下堆成单列 | 三列最小 300，滚动留在看板内部 |

四页验收扩展到全部七类页面；同宽下标题坐标误差均为 0px，工具栏 y 坐标也一致。

| 宽度 | 所有页面标题 (x, y) | Toolbar y / 高度 | primary |
| ---: | --- | --- | --- |
| 1920 | (300, 64) | 136 / 40 | 每个区域 ≤ 1；工作台 1，其余页面 0 |
| 1440 | (300, 64) | 136 / 40 | 每个区域 ≤ 1；工作台 1，其余页面 0 |
| 1280 | (292, 64) | 136 / 40 | 每个区域 ≤ 1；工作台 1，其余页面 0 |
| 900 | (44, 64) | 136 / 40 | 每个区域 ≤ 1；工作台 1，其余页面 0 |

| 页面 · 宽度 | 改前 | 改后 |
| --- | --- | --- |
| 工作台 · 1920 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-board-1920.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-board-1920.png) |
| 工作台 · 1440 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-board-1440.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-board-1440.png) |
| 工作台 · 1280 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-board-1280.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-board-1280.png) |
| 工作台 · 900 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-board-900.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-board-900.png) |
| 会话 · 1920 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-inbox-1920.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-inbox-1920.png) |
| 会话 · 1440 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-inbox-1440.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-inbox-1440.png) |
| 会话 · 1280 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-inbox-1280.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-inbox-1280.png) |
| 会话 · 900 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-inbox-900.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-inbox-900.png) |
| 服务会话 · 1920 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-sessions-1920.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-sessions-1920.png) |
| 服务会话 · 1440 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-sessions-1440.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-sessions-1440.png) |
| 服务会话 · 1280 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-sessions-1280.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-sessions-1280.png) |
| 服务会话 · 900 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-sessions-900.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-sessions-900.png) |
| 通知异常 · 1920 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-notifications-1920.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-notifications-1920.png) |
| 通知异常 · 1440 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-notifications-1440.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-notifications-1440.png) |
| 通知异常 · 1280 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-notifications-1280.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-notifications-1280.png) |
| 通知异常 · 900 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-notifications-900.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-notifications-900.png) |
| 新报修 · 1920 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-report-1920.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-report-1920.png) |
| 新报修 · 1440 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-report-1440.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-report-1440.png) |
| 新报修 · 1280 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-report-1280.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-report-1280.png) |
| 新报修 · 900 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-report-900.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-report-900.png) |
| 公共故障候选 · 1920 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-candidates-1920.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-candidates-1920.png) |
| 公共故障候选 · 1440 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-candidates-1440.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-candidates-1440.png) |
| 公共故障候选 · 1280 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-candidates-1280.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-candidates-1280.png) |
| 公共故障候选 · 900 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-candidates-900.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-candidates-900.png) |
| 来源群设置 · 1920 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-source-groups-1920.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-source-groups-1920.png) |
| 来源群设置 · 1440 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-source-groups-1440.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-source-groups-1440.png) |
| 来源群设置 · 1280 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-source-groups-1280.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-source-groups-1280.png) |
| 来源群设置 · 900 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-source-groups-900.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-source-groups-900.png) |
| 会话空列表 · 1920 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-inbox-empty-1920.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-inbox-empty-1920.png) |
| 会话空列表 · 1440 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-inbox-empty-1440.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-inbox-empty-1440.png) |
| 会话空列表 · 1280 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-inbox-empty-1280.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-inbox-empty-1280.png) |
| 会话空列表 · 900 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/before-inbox-empty-900.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card3-20261101/screenshots/after-inbox-empty-900.png) |

## 4. CSS 度量

在 app/pc-admin 下执行 `npx --no-install stylelint "src/**/*.css" --formatter json`。使用既有锁定 CLI，不安装依赖、不修改配置、忽略范围或严重级别。

| 规则 | 卡 2 | 卡 3 | 变化 |
| --- | ---: | ---: | ---: |
| declaration-property-value-allowed-list | 0 | 0 | 0 |
| color-no-hex | 0 | 0 | 0 |
| unit-disallowed-list | 0 | 0 | 0 |
| declaration-no-important | 0 | 0 | 0 |
| function-disallowed-list | 0 | 0 | 0 |
| color-named | 0 | 0 | 0 |
| **总计** | **0** | **0** | **0** |

扫描 21 个 CSS 文件，其中 2 个登录页文件沿用原配置忽略；新增的 9 个 CSS 文件全部纳入检查。原始结果：`D:/CodexEvidence/pc-admin-design-v2-card3-20261101/stylelint-complete.json`。

## 5. 验证、失败记录与完成边界

| 检查 | 最终结果 |
| --- | --- |
| `npm run migration:build` | PASS；911 个严格编译模块，911 个 Node 语法检查 |
| `node .build/tools/gate.mjs types` | PASS；含 CSS、完整 strict 与负向类型检查 |
| `node .build/tools/verify-artifact.mjs` | ARTIFACT_VERIFIED_NOT_ACTIVATED |
| 注册浏览器相关子集 | 17 入口，33 tests / 33 PASS / 0 FAIL / 0 SKIP / 0 TODO |
| 组件状态夹具 | PASS；28/32/36 高度、32×32 图标、loading 保宽、disabled 不降父透明度、Tab 焦点、hover/pressed、下拉选择、减少动效与四宽溢出检查 |
| 配对截图 / 搜索交互 | PASS；标题坐标、工具栏单行、区域主按钮、Split 内部滚动；回车搜索、仅清除输入、无数据隐藏分页与单空态；0 POST |
| 指令文档检查 | PASS；19 个工具用例通过 |
| 差异 / 依赖检查 | PASS；114 处控制器调用与 69 处 data 属性保持不变；包声明、锁文件、lint 配置无变更 |

活动 selection 为 v3-p09；本次仅运行实际相关的 6 个活动入口及 11 个已注册风险补充入口，不称活动全集、full、certify、现场就绪或用户验收。具体入口及数量如下。

| 入口 | tests / PASS |
| --- | --- |
| `tests/workbench-startup.browser.test.mts` | 1 / 1 |
| `tests/workbench-toast-feedback.browser.test.mts` | 1 / 1 |
| `tests/workbench-detail-restructure.browser.test.mts` | 2 / 2 |
| `tests/web01-closed-range.browser.test.mts` | 2 / 2 |
| `tests/t37-shared-time-card-list.browser.test.mts` | 1 / 1 |
| `tests/wbint-t17-manual-form.browser.test.mts` | 1 / 1 |
| `tests/wbint-t22-conversations.browser.test.mts` | 1 / 1 |
| `tests/wbint-t27-candidate-detail.browser.test.mjs` | 1 / 1 |
| `tests/wbint-t27-candidate.browser.test.mjs` | 1 / 1 |
| `tests/web01-workbench.browser.test.mjs` | 9 / 9 |
| `tests/wbint-t32-notification-exceptions.browser.test.mts` | 1 / 1 |
| `tests/wbint-t32-exception-route.browser.test.mts` | 1 / 1 |
| `tests/t41-search-production.browser.test.mts` | 2 / 2 |
| `tests/t41-search-refresh-and-long-pages.browser.test.mts` | 2 / 2 |
| `tests/t41-search-pending-hint.browser.test.mts` | 2 / 2 |
| `tests/wbint-t42-board-legal-action.browser.test.mts` | 1 / 1 |
| `tests/conversation-inbox.browser.test.mts` | 4 / 4 |

首次失败与后续修正均保留，不用最终 PASS 覆盖历史结果：

| 原失败 | 定位与修正 | 原件 |
| --- | --- | --- |
| 构建期间源码继续变化，MIGRATION_SOURCE_CHANGED_DURING_BUILD | 完整冻结后重建；最终绑定新的输入指纹 | `migration-build-failed-source-drift.log` |
| 图标按钮被内边距挤窄，组件夹具测得 31.5 宽 | 明确传递 data-icon-only，尺寸与 padding 按 Token 固定；最终 32×32 | `gallery-test-fixed.log`、`screenshots-first-pass/gallery-failure.png` |
| 注册回归启动缺少隔离环境声明 | 已核任务自有 loopback PG18 后传入 TS_MIGRATION_TEST_DB_ISOLATED=1；未改测试门禁 | `registered-tests.log` |
| 日期重载断言读取收起弹层的 innerText | 独立观测确认两端年份和 URL 未变；先真实展开，再保留原断言 | `registered-tests/summary.json`、`date-diagnostic.json` |
| 900 宽仍断言一列；50 项仍断言列头文本 | 按 v2 检查三列最小 300 与局部横向滚动；计数定位到列底，数字与分页断言保持 | `remaining-results.json`、对应 TAP |
| loading 标签补充的 aria-label 触发 exactOptionalPropertyTypes | 保留原可访问名称，改为仅视觉隐藏标签，避免传入 undefined；未放宽类型 | `migration-build-acceptance.log` |

最终日志与原始 TAP：`D:/CodexEvidence/pc-admin-design-v2-card3-20261101/`。源码只做本地视觉调整；原始失败、未执行记录及用户改动均保留。未运行 Electron 原生进程验收、真实企业微信/SSO、现场发送或部署。

## 6. 规范差异与后续边界

- 会话筛选采用 §6.2 的统一 32px 控件高度；§8.3 对照表仍写 28px。本卡选择统一控件规则，没有引入新值。建议后续将对照表统一到 32px，或明确列为 sm 变体。
- 原生 details 仅承载筛选展开，视觉使用既有 radius-lg、shadow-3、语义色及间距；不接管请求或状态。
- 状态标签、status-map、TicketCard/BoardColumn 信息重组、抽屉/Timeline、会话行和完整 Table/Form 内容的进一步收敛仍按后续卡执行。本卡只迁移骨架，不将后续卡标为完成。

## 7. 自检与下一卡

| 自检 | 是/否与证据 |
| --- | --- |
| 只改视觉，不改业务行为、请求或状态 | 是；差异范围、114 处控制器调用比较与注册回归 |
| 保留测试 class/data 钩子，不削弱业务断言 | 是；保留原 data 属性；变更仅适配页头刷新、筛选展开、计数位置及 v2 窄屏视觉断言 |
| 新 CSS 无裸色、裸字号、裸圆角、important | 是；Stylelint 0，配置无变更 |
| 每个可见区域 primary ≤ 1 | 是；现有 WEB01 截图入口加入区域断言，四宽页面采集也检查 |
| 适用的 hover/focus/disabled/loading/空数据/长文本状态 | 是；共享 CSS 与组件状态夹具；静态容器不添加虚假的交互状态 |
| 四宽截图均核对 | 是；64 张配对页面图与 4 张组件图，坐标及溢出断言通过 |
| 未自行发明规范外视觉值 | 是；只用已定义 Token 或规范已有尺寸；32/28 的既有差异已单列 |

下一张卡的技术前置条件已满足：Token 与 CSS 基线为 0，骨架组件已具备。尚未启动卡 4；GitHub Issues、业务 Gate、发布和生产状态未变更。

回退方式：按本卡逐文件差异撤销骨架导入和组合，保留卡 0–2；原始源码备份在本任务 evidence 的 source-before，原有未提交 WEB01 测试备份已按起点哈希核验。无数据库回滚。自有合成资源关闭结果见 cleanup.json。
