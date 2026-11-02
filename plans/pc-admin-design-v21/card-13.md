# 卡 13 · 工单详情抽屉

基线：`origin/main@bb7ebf116f4eb41c83eaf882c6c30fa301f6a3e2`；前置：卡 9 #129、卡 10 #130、卡 11 #131、卡 12 #134 已合并（2026-11-03 开工核验）。

## 范围与完成条件

按设计方案 §4.2 与原型 02 实施工单详情。唯一写者为本会话；工作树 `D:/worktrees/pc-admin-v21-card13`，分支 `codex/pc-admin-v21-card13`。原 main 与卡 15 工作树保持独立。用户已授权提交、推送、创建 PR、请求 `@codex review`、修复 P1/P2 后合并。

- 详情 JSX 抽出 `WorkbenchDetail.tsx`；看板只引用详情组件。共享事项展示工具独立归属，不建立第二套事实或权限映射。
- 下一步卡只安排原控制器已经允许显示的入口；原命令、版本、UUID、回执、草稿、身份和阻塞控制器保持挂载。原弹窗表单在下一步卡下方就地展开，额外动作收进更多菜单。
- 40px 类别瓷砖、20/600 标题、阶段/子状态/热度、ghost 顶栏和已加载位置；缺失属性汇总。没有现成直接补问发送能力，“向报修人补问”仅为文字。
- 动态/附件/会话页签保持控制器挂载；计数来自现有查询已加载内容，读取未完成/失败不假造 0。描述首条保留原 personal-read 材料所有者，隐藏页签不记已读。
- 底部固定内部备注区及 Ctrl+Enter，保留原提交守卫与外部不可见语义。

无后端/Contract/API/SQL/数据库迁移/新依赖/权限策略/持久 Feature Flag 变化。14px 圆角由现有 `--radius-lg` + `--space-0-5` 在共享 Drawer 内组合，不修改卡 9 的 Token 文件。关闭沿原默认开关；代码可整体 revert。合成夹具、自有 PG18（loopback 55473）与浏览器资源有界，结束后释放。

## 验证与证据

证据根：`D:/CodexEvidence/pc-admin-v21-card13-20261103`。目标：两项 lint、一次最终源码构建、活动 v3-p09 的 strict、相关注册浏览器/业务/工具入口、artifact 和指令检查；四宽前后及原型并排。出现失败保留原件，修补后仅按影响重新验证。未授权范围不进入 full/certify、Electron、现场、发送、部署或 Gate。

- 改造前干净基线构建 `build-before-2.log` PASS；四宽 1920/1440/1280/900，720px 抽屉、8px 外距，全部无页面横向溢出，POST=0；浏览器与 UUID 合成数据库已由原夹具回收。
- 首次基线构建 `build-before.log` FAIL：构建期间新增未接入文件触发 `MIGRATION_SOURCE_CHANGED_DURING_BUILD`；恢复干净基线后重新构建，失败不覆盖。
- 临时前端 strict 逐次诊断、根目录不存在 lint 别名的失败与实际 `app/pc-admin` lint 输出均保留。当前 scoped Stylelint/ESLint 为 0；最终正式结果待补。

## 自检与收口

本地实现和相关验证已完成；远端发布、审查、CI 与合并以本分支在 GitHub 的实际 PR 为准，不将本地结果写成现场批准。GitHub 未检索到独立的 v2.1 卡 13 Issue，执行状态沿本卡与本次 PR，不修改已关闭的旧 WBINT 票。


## 最终本地交付（2026-11-03）

源码被测提交：`9cc1137f6cd1c30003ac22ac1cf9ea9140d84068`，输入指纹 `a3ff73b7aeb13ce7287a9ad4a7561fdc08a1cd053bf7120e590bd3b9f54232a0`。其后 `efb7b3e8` 交付提交只增加本记录及合成截图/索引；远端 R1 的实质修补和新被测身份另列。原验证工作树继续冻结，文档/图片在 `D:/worktrees/pc-admin-v21-card13-delivery` 整理；交付工作树初期不建立构建输出；远端 R1 修补后建立其自己的 `.build`，没有共享或改写原验证输出。

| 检查 | 实际结果与原件 |
| --- | --- |
| `npm.cmd --prefix app/pc-admin run lint:css` | PASS，Stylelint 0；`lint-css-13.log` |
| `npm.cmd --prefix app/pc-admin run lint:features` | PASS，ESLint 0；`lint-features-13.log` |
| `npm.cmd run migration:build` | PASS，916 个 Node 语法检查，2753 输出；`build-13.log` |
| `node .build/tools/gate.mjs types` | PASS，strict/negative types；`types-13.log` |
| 14 个相关已注册入口 | 37/37 PASS，0 FAIL/cancel/SKIP/todo/NOT_RUN；三份 `final-*/summary.json` |
| 指令工具与链接 | `check-agent-docs.test.mjs` 19/19、`docs:agents:check` PASS；`docs-tools-final.log` / `docs-check-final.log` |
| `node .build/tools/verify-artifact.mjs` | PASS，STAGED_NOT_ACTIVATED；`artifact-verified-13.log`，不表示部署 |
| Impeccable 机械检查 | 一次 scoped detect 返回 `[]`，不代替实际截图/交互检查；`impeccable-detect.json` |
| 独立两轴源码审查 | Standards / Spec 在最终源码增量均无未解决 P1/P2；原发现与修补如下 |

相关入口覆盖就地表单、四宽尺寸、延迟权限、同主体能力关闭计数、缓存只读复核重开、非 Ticket 电话、备注 Ctrl+Enter 丢失成功响应后原 UUID 核对；同时覆盖原完工/等待/恢复/重开、共享跟进、撤销派工、退回待安排、责任历史、会话个人游标、媒体原件/头像与既有完整详情。精确路径与计数见 [验证索引](../../docs/ui/evidence/v21-card13/verification.json)。这是注册子集，不是活动全集或 full/certify。

FFmpeg/FFprobe 环境未配置，本地依赖这两项的 employee-media 注册入口为 NOT_RUN；普通 PR CI 的独立执行结果另记，不以其他媒体 PASS 补它。Electron 原生、现场、真实发送、部署与 Gate 仍为 NOT_RUN。附加 `hosts.test/batches.test` 历史 CLI 工具回归随后在原冻结候选 `9cc1137f` 完成：与指令工具合计 61/61 PASS，0 fail/cancel/SKIP/todo；原件 `tools-13.log`，不混入本卡 37/37。

## 四宽与原型并排

截图来自真实正式 bundle / HTTP / 新建 UUID 合成 PG 库；使用相同夹具及显式打印服务代码，created_at 特意设为 95 分钟前展示热度。原型是结构参考，状态和人员示意不改写实际 DTO。截图原件在证据根，仓库交付并排图；哈希见验证索引。最终图绑定 `5a3caa39`，最终源码重验四宽几何；后继保留 hidden hook 与来源 title 不改变可见场景。

| 宽度 | 并排图 | 抽屉 / 外距 | 缺失资料行 | 横向溢出 / primary / 采图 POST |
| --- | --- | --- | --- | --- |
| 1920 | [前 / 后 / 原型 02](../../docs/ui/evidence/v21-card13/compare-1920.png) | 720 / 8 px | 40 px | 无 / 1 / 0 |
| 1440 | [前 / 后 / 原型 02](../../docs/ui/evidence/v21-card13/compare-1440.png) | 720 / 8 px | 40 px | 无 / 1 / 0 |
| 1280 | [前 / 后 / 原型 02](../../docs/ui/evidence/v21-card13/compare-1280.png) | 720 / 8 px | 40 px | 无 / 1 / 0 |
| 900 | [前 / 后 / 原型 02](../../docs/ui/evidence/v21-card13/compare-900.png) | 720 / 8 px | 40 px | 无 / 1 / 0 |

14px 圆角由现有 `--radius-lg + --space-0-5` 组合；未修改卡 9 独占文件。首屏彩色面积的专门估算属于卡 10/12，本卡不重绑或复用其旧百分比作为本次抽屉验收。

## 原失败与修补

- `build-before.log` 的源码变化守卫、构建 1 的新测试类型缺口、构建 3 的测试辅助结构类型错误均保留，后继通过不覆盖它们。
- 两轴发现并修复：inline 表单继承旧 fixed 浮窗样式；权限 pending/error 误称只读；能力关闭后旧会话数量残留；缓存只读 Review 的父 reset 覆盖 ready；非 Ticket 电话把 disabled query 当永久 pending；媒体测试在看板/隐藏页签提前等待。原命令/权限/UUID/回执守卫未改。
- 正式边界另修：完工外壳在原权限未到时过早注册入口。恢复入口仍按原 attention/UNKNOWN 保留。
- `tests-new-1` 的夹具版本增量与 DOM 布尔等待错误、`tests-new-3` 的注入脚本转义及权限入口边界失败、T37 helper 的真实入口挂载等待、T42 卡 12 已加载列折叠假设均保留。T42 曾误改展示文案，诊断确认当前合同仍用“已关闭”后恢复原期望，并仅展开真实列尾再核对官方移动。
- 第二轮坏布局截图保存在 `screenshots-layout-failure/`：PropertyList 的高优先级 grid 把缺失行挤窄，最终局部修正并增加四宽高度断言。
- 媒体诊断保留 `diagnostic-media*.log`：隐藏页签的缩略图等待、1440px 下既有 hover 1.025 影响静态几何。最终先选页签、移开指针并等待原动画结束；原尺寸/cover/原件/权限断言全部保留。外部诊断 PASS 不冒充注册入口；最终注册媒体入口已通过。

## 规范边界与十项完成标准

输入为当前内部主体及既有 WorkbenchDetail / 原权限查询；输出为同一事项的呈现与原操作入口。没有新增业务事实、Contract/API/SQL 或数据库迁移。原权限、幂等、恢复、隐私与资源上限保持；新按钮只安排原当前获权入口。默认 Flag 保持 false。可整体 revert 回退；本地合成库/浏览器沿原 fixture 释放，PG 与验证 checkout 的最终释放在 PR/交付消息如实记录。GitHub 未找到独立卡 13 Issue，Backlog 以本卡执行记录和本次 PR 收口，不改已关闭旧 WBINT 票。

## 自检

| 项 | 是 / 否与证据 |
| --- | --- |
| 前端未改业务命令、状态或权限判断 | 是；无 server/contracts/api/SQL/持久开关/依赖差异；原控制器的提交与回执代码保留 |
| 选择器只增不删、业务断言未放宽 | 是；原 hook 保留（缺失资料行用 hidden 兼容），旧断言只同步授权文案；新 UI 所需的页签/展开准备和新增视觉断言独立补上 |
| 新颜色来自 Token，Stylelint/ESLint 0 | 是；两项实际命令 PASS，Token/heat/category-map 与桥接未修改 |
| 彩色对应四层及明确场景语义 | 是；阶段、热度、类别、人物沿原 Token；内部备注按本卡明确指定的浅黄安全提示 |
| 卡片没有未提供/未登记占位 | 是；原卡 12 卡片呈现保留；抽屉只在统一缺失行说明 |
| 当前有动作时恰好一个 primary | 是；下一步按原允许入口排列，四宽实测 1；只读 0，pending/unknown 不伪称无权限 |
| 热度沿唯一常量 | 是；调用 heatOf，pending 用 created_at、active 用 stage_entered_at、closed 不计；不以 updated_at 补值 |
| 四宽与原型并排核对 | 是；上表四图及真实几何/滚动测试；原坏图与失败单独保留 |

## 后续卡前置

卡 14 已在基线通过 PR #132 合并；卡 16 所需的卡 12 实现前置已由 #134 满足。本次没有启动卡 16、部署或推进业务 Gate。

## 文件清单

```text
app/pc-admin/src/app/DetailDialog.tsx
app/pc-admin/src/app/DetailPresentation.tsx
app/pc-admin/src/app/Workbench.tsx
app/pc-admin/src/app/WorkbenchDetail.tsx
app/pc-admin/src/app/WorkbenchItemPresentation.tsx
app/pc-admin/src/design/components/Drawer/Drawer.tsx
app/pc-admin/src/design/components/Drawer/DrawerTabs.tsx
app/pc-admin/src/design/components/Drawer/NextStep.tsx
app/pc-admin/src/design/components/Drawer/drawer-v21.css
app/pc-admin/src/features/attachments/AttachmentSection.tsx
app/pc-admin/src/features/attachments/ReportMaterialsSection.tsx
app/pc-admin/src/features/conversations/Conversations.tsx
app/pc-admin/src/features/follow-up/SharedFollowUp.tsx
app/pc-admin/src/features/manual-review/ReviewWorkspace.tsx
app/pc-admin/src/features/source-groups/GroupNameEditor.tsx
app/pc-admin/src/features/ticket-assignment/TicketAssignment.tsx
app/pc-admin/src/features/ticket-completion/TicketCompletion.tsx
app/pc-admin/src/features/ticket-handling/TicketConversationHandling.tsx
app/pc-admin/src/features/ticket-handling/TicketSelfHandling.tsx
app/pc-admin/src/features/ticket-notes/TicketNotes.tsx
app/pc-admin/src/features/ticket-reopen/TicketReopen.tsx
app/pc-admin/src/features/ticket-return-to-dispatch/TicketReturnToDispatch.tsx
app/pc-admin/src/features/ticket-takeover-completion/TicketTakeoverCompletion.tsx
app/pc-admin/src/features/ticket-takeover/TicketTakeover.tsx
app/pc-admin/src/features/ticket-unassign/TicketUnassign.tsx
app/pc-admin/src/features/ticket-waiting/TicketWaitingActions.tsx
docs/ui/evidence/v21-card13/compare-1280.png
docs/ui/evidence/v21-card13/compare-1440.png
docs/ui/evidence/v21-card13/compare-1920.png
docs/ui/evidence/v21-card13/compare-900.png
docs/ui/evidence/v21-card13/r1-takeover-1280.png
docs/ui/evidence/v21-card13/r1-takeover-1440.png
docs/ui/evidence/v21-card13/r1-takeover-1920.png
docs/ui/evidence/v21-card13/r1-takeover-900.png
docs/ui/evidence/v21-card13/r2-read-1280.png
docs/ui/evidence/v21-card13/r2-read-1440.png
docs/ui/evidence/v21-card13/r2-read-1920.png
docs/ui/evidence/v21-card13/r2-read-900.png
docs/ui/evidence/v21-card13/verification.json
plans/pc-admin-design-v21/card-13.md
plans/typescript-migration/test-routing.json
tests/conversation-inbox.browser.test.mts
tests/helpers/heroui-workbench-controls.mts
tests/helpers/t10-browser-fixture.mts
tests/pc-admin-card13.browser.test.mts
tests/t04-self-handling.browser.test.mjs
tests/t05-conversation-handling.browser.test.mjs
tests/t07-atomic-start.browser.test.mts
tests/t08-command-recovery.browser.test.mts
tests/t08-selected-recovery.browser.test.mts
tests/t08-unassign.browser.test.mts
tests/t09-return-to-dispatch.browser.test.mts
tests/t09-selected-ui-boundaries.browser.test.mts
tests/t09-selected-ui-status-scope.browser.test.mts
tests/t11-completion.browser.test.mts
tests/t12-production-form.browser.test.mts
tests/t13-history-window.browser.test.mts
tests/t13-production-history.browser.test.mts
tests/t20-member-origin-hint.browser.test.mts
tests/t20-staff-hint-first.browser.test.mts
tests/t37-follow-up-post-refusal.browser.test.mts
tests/t37-follow-up-recovery-boundaries.browser.test.mts
tests/t37-follow-up-recovery-competition.browser.test.mts
tests/t37-follow-up-recovery-first.browser.test.mts
tests/t37-shared-follow-up-drawer.browser.test.mts
tests/t37-shared-time-card-list.browser.test.mts
tests/wbint-t14-review.browser.test.mts
tests/wbint-t42-board-complete-reopen.browser.test.mts
tests/workbench-detail-media.browser.test.mts
tests/workbench-detail-restructure.browser.test.mts
tests/workbench-media-employee-read.browser.test.mts
```text
app/pc-admin/src/app/DetailDialog.tsx
app/pc-admin/src/app/DetailPresentation.tsx
app/pc-admin/src/app/Workbench.tsx
app/pc-admin/src/app/WorkbenchDetail.tsx
app/pc-admin/src/app/WorkbenchItemPresentation.tsx
app/pc-admin/src/design/components/Drawer/Drawer.tsx
app/pc-admin/src/design/components/Drawer/DrawerTabs.tsx
app/pc-admin/src/design/components/Drawer/NextStep.tsx
app/pc-admin/src/design/components/Drawer/drawer-v21.css
app/pc-admin/src/features/attachments/AttachmentSection.tsx
app/pc-admin/src/features/attachments/ReportMaterialsSection.tsx
app/pc-admin/src/features/conversations/Conversations.tsx
app/pc-admin/src/features/follow-up/SharedFollowUp.tsx
app/pc-admin/src/features/manual-review/ReviewWorkspace.tsx
app/pc-admin/src/features/source-groups/GroupNameEditor.tsx
app/pc-admin/src/features/ticket-assignment/TicketAssignment.tsx
app/pc-admin/src/features/ticket-completion/TicketCompletion.tsx
app/pc-admin/src/features/ticket-handling/TicketConversationHandling.tsx
app/pc-admin/src/features/ticket-handling/TicketSelfHandling.tsx
app/pc-admin/src/features/ticket-notes/TicketNotes.tsx
app/pc-admin/src/features/ticket-reopen/TicketReopen.tsx
app/pc-admin/src/features/ticket-return-to-dispatch/TicketReturnToDispatch.tsx
app/pc-admin/src/features/ticket-takeover-completion/TicketTakeoverCompletion.tsx
app/pc-admin/src/features/ticket-takeover/TicketTakeover.tsx
app/pc-admin/src/features/ticket-unassign/TicketUnassign.tsx
app/pc-admin/src/features/ticket-waiting/TicketWaitingActions.tsx
docs/ui/evidence/v21-card13/compare-1280.png
docs/ui/evidence/v21-card13/compare-1440.png
docs/ui/evidence/v21-card13/compare-1920.png
docs/ui/evidence/v21-card13/compare-900.png
docs/ui/evidence/v21-card13/r1-takeover-1280.png
docs/ui/evidence/v21-card13/r1-takeover-1440.png
docs/ui/evidence/v21-card13/r1-takeover-1920.png
docs/ui/evidence/v21-card13/r1-takeover-900.png
docs/ui/evidence/v21-card13/verification.json
plans/pc-admin-design-v21/card-13.md
plans/typescript-migration/test-routing.json
tests/conversation-inbox.browser.test.mts
tests/helpers/heroui-workbench-controls.mts
tests/helpers/t10-browser-fixture.mts
tests/pc-admin-card13.browser.test.mts
tests/t04-self-handling.browser.test.mjs
tests/t05-conversation-handling.browser.test.mjs
tests/t07-atomic-start.browser.test.mts
tests/t08-command-recovery.browser.test.mts
tests/t08-selected-recovery.browser.test.mts
tests/t08-unassign.browser.test.mts
tests/t09-return-to-dispatch.browser.test.mts
tests/t09-selected-ui-boundaries.browser.test.mts
tests/t09-selected-ui-status-scope.browser.test.mts
tests/t11-completion.browser.test.mts
tests/t12-production-form.browser.test.mts
tests/t13-history-window.browser.test.mts
tests/t13-production-history.browser.test.mts
tests/t20-member-origin-hint.browser.test.mts
tests/t20-staff-hint-first.browser.test.mts
tests/t37-follow-up-post-refusal.browser.test.mts
tests/t37-follow-up-recovery-boundaries.browser.test.mts
tests/t37-follow-up-recovery-competition.browser.test.mts
tests/t37-follow-up-recovery-first.browser.test.mts
tests/t37-shared-follow-up-drawer.browser.test.mts
tests/t37-shared-time-card-list.browser.test.mts
tests/wbint-t14-review.browser.test.mts
tests/wbint-t42-board-complete-reopen.browser.test.mts
tests/workbench-detail-media.browser.test.mts
tests/workbench-detail-restructure.browser.test.mts
tests/workbench-media-employee-read.browser.test.mts
```text
app/pc-admin/src/app/DetailDialog.tsx
app/pc-admin/src/app/DetailPresentation.tsx
app/pc-admin/src/app/Workbench.tsx
app/pc-admin/src/app/WorkbenchDetail.tsx
app/pc-admin/src/app/WorkbenchItemPresentation.tsx
app/pc-admin/src/design/components/Drawer/Drawer.tsx
app/pc-admin/src/design/components/Drawer/DrawerTabs.tsx
app/pc-admin/src/design/components/Drawer/NextStep.tsx
app/pc-admin/src/design/components/Drawer/drawer-v21.css
app/pc-admin/src/features/attachments/AttachmentSection.tsx
app/pc-admin/src/features/attachments/ReportMaterialsSection.tsx
app/pc-admin/src/features/conversations/Conversations.tsx
app/pc-admin/src/features/follow-up/SharedFollowUp.tsx
app/pc-admin/src/features/manual-review/ReviewWorkspace.tsx
app/pc-admin/src/features/source-groups/GroupNameEditor.tsx
app/pc-admin/src/features/ticket-assignment/TicketAssignment.tsx
app/pc-admin/src/features/ticket-completion/TicketCompletion.tsx
app/pc-admin/src/features/ticket-handling/TicketConversationHandling.tsx
app/pc-admin/src/features/ticket-handling/TicketSelfHandling.tsx
app/pc-admin/src/features/ticket-notes/TicketNotes.tsx
app/pc-admin/src/features/ticket-reopen/TicketReopen.tsx
app/pc-admin/src/features/ticket-return-to-dispatch/TicketReturnToDispatch.tsx
app/pc-admin/src/features/ticket-takeover-completion/TicketTakeoverCompletion.tsx
app/pc-admin/src/features/ticket-takeover/TicketTakeover.tsx
app/pc-admin/src/features/ticket-unassign/TicketUnassign.tsx
app/pc-admin/src/features/ticket-waiting/TicketWaitingActions.tsx
docs/ui/evidence/v21-card13/compare-1280.png
docs/ui/evidence/v21-card13/compare-1440.png
docs/ui/evidence/v21-card13/compare-1920.png
docs/ui/evidence/v21-card13/compare-900.png
docs/ui/evidence/v21-card13/verification.json
plans/pc-admin-design-v21/card-13.md
plans/typescript-migration/test-routing.json
tests/conversation-inbox.browser.test.mts
tests/helpers/heroui-workbench-controls.mts
tests/helpers/t10-browser-fixture.mts
tests/pc-admin-card13.browser.test.mts
tests/t04-self-handling.browser.test.mjs
tests/t05-conversation-handling.browser.test.mjs
tests/t08-command-recovery.browser.test.mts
tests/t08-selected-recovery.browser.test.mts
tests/t08-unassign.browser.test.mts
tests/t09-return-to-dispatch.browser.test.mts
tests/t09-selected-ui-boundaries.browser.test.mts
tests/t09-selected-ui-status-scope.browser.test.mts
tests/t11-completion.browser.test.mts
tests/t12-production-form.browser.test.mts
tests/t13-history-window.browser.test.mts
tests/t13-production-history.browser.test.mts
tests/t20-member-origin-hint.browser.test.mts
tests/t20-staff-hint-first.browser.test.mts
tests/t37-follow-up-post-refusal.browser.test.mts
tests/t37-follow-up-recovery-boundaries.browser.test.mts
tests/t37-follow-up-recovery-competition.browser.test.mts
tests/t37-follow-up-recovery-first.browser.test.mts
tests/t37-shared-follow-up-drawer.browser.test.mts
tests/t37-shared-time-card-list.browser.test.mts
tests/wbint-t14-review.browser.test.mts
tests/wbint-t42-board-complete-reopen.browser.test.mts
tests/workbench-detail-media.browser.test.mts
tests/workbench-detail-restructure.browser.test.mts
tests/workbench-media-employee-read.browser.test.mts
```


## PR #135 远端审查 R1

[权威发布对象](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/135) `efb7b3e8790c274c54d1889f59188b4d7f4eccba` 收到 [P2](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/135#discussion_r4448235594)：接管表单把默认 `TAKE_SELECTED` 当作真实输入，导致未触碰也展开且不能收起。

修补被测提交为 `624358b1a7e6b4b9975e71063e3bc67e143e036e`。仅将 attention 的沟通输入项改为 `choice==='RETAIN_CURRENT'`，与原草稿检测一致；默认值仍为 TAKE_SELECTED。board 意图、真实输入、UNKNOWN/恢复的自动关注均保留。原 allowed、命令正文、版本、UUID、原子接管、终检、回执与沟通责任断言未改。

- 本候选 Stylelint/ESLint 0、一次 build、strict/negative types、artifact PASS；原件 `remote-r1-*.log`。
- 7 个注册入口 20/20 PASS，0 FAIL/cancel/SKIP/todo/NOT_RUN：原子接管起步、草稿/原 UUID/晚到/失权恢复，加卡13核心和接管完工兄弟表单。新断言证明默认未触碰时折叠、可明确打开/收起、打开/收起 POST=0，随后仍使用原完整业务断言验证唯一原子命令。
- 下列四宽补图来自本候选正式 bundle/真实 HTTP/PG 合成 fixture，默认沟通选择不变，采图 POST=0。初始 37/37 及原四宽图继续绑定原候选，不重绑 R1；原图示的普通待接单场景不受本次接管专属修补影响。

| 宽度 | 未触碰折叠 / 明确展开 |
| --- | --- |
| 1920 | [R1 对照](../../docs/ui/evidence/v21-card13/r1-takeover-1920.png) |
| 1440 | [R1 对照](../../docs/ui/evidence/v21-card13/r1-takeover-1440.png) |
| 1280 | [R1 对照](../../docs/ui/evidence/v21-card13/r1-takeover-1280.png) |
| 900 | [R1 对照](../../docs/ui/evidence/v21-card13/r1-takeover-900.png) |

后继提交只补充本记录与证据；远端线程、复审、普通 PR CI 及最终合并结果以 PR 当前对象为准，不作为现场或 Gate 批准。


## PR #135 远端审查 R2 与 CI 边界

发布 head `300b3e059d1cc8b6498c472126aedd4c0147e1bb` 收到第二条 [P2](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/135#discussion_r4448510261)：未触碰的接管完工初次 targets 读取失败时，原错误和刷新被折叠层隐藏且没有入口。独立复查也覆盖了标准完工、重开、撤销派工及退回的同类错误可达性。

本轮最终被测提交 `d6e18a83ba4a50428dde6536901f195697905cca`：

- `StepWorkflow.readState` 仅表示原查询的呈现状态，与 available/permitted/canSubmit 分离；unknown 显露现存错误区域，不生成获权动作。isLoading 避免 disabled query 假 pending。Provider 按 useId/layout effect 汇总、更新、卸载清理。
- 原读取/刷新控件保留；Takeover 在原错误段旁复用已有 `refresh()` 增加只读重试，未新增 API 或写命令。标准完工初次失败也可查看原错误及 refresh-completion。
- CI 同时在退回成功场景发现 helper 把暂时 attention 可见误作明确打开。新增 data-step-open/read-state 区分，只通过实际入口锁定 open；缺目标继续等，无入口的只读恢复须在该流程自身状态稳定且实际可见时才返回。原可达性、输入、版本、UUID、次数、回执断言均保留。
- 17 个注册入口 49/49 PASS，0 FAIL/cancel/SKIP/todo/NOT_RUN；包含 CI 失败入口、退回/撤销双 Session 与失权/原 UUID、普通完工、接管与接管完工、共享跟进/复核等。新增初次 context/targets 掉响应→原重试恢复的用例均断言 UI POST=0。build、strict/negative types、artifact、两项 lint PASS。原件 `remote-r2-*`，详细路径/计数见验证索引；此前 37/37 与 R1 20/20 不重绑本轮。
- 原 CI [41535839318](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/actions/runs/41535839318) 失败保留：249 项选择中执行21项，99用例为98 PASS/1 FAIL，228入口 NOT_RUN；失败为 `t09-selected-ui-boundaries.browser.test.mts` 的 STEP_ENTRY_REQUIRED。完整原件在 `ci-r1-artifacts/`，不把已执行 PASS 当全批通过。

下列截图来自本轮正式 bundle / HTTP / PG 合成 fixture：首次权限读取失败时错误与原重试可见，原只读重试恢复后界面重新显示允许入口；过程 POST=0。未修改 backend/contracts/API/SQL/默认 Flag/依赖。

| 宽度 | 失败可见 / 原只读重试恢复 |
| --- | --- |
| 1920 | [R2 对照](../../docs/ui/evidence/v21-card13/r2-read-1920.png) |
| 1440 | [R2 对照](../../docs/ui/evidence/v21-card13/r2-read-1440.png) |
| 1280 | [R2 对照](../../docs/ui/evidence/v21-card13/r2-read-1280.png) |
| 900 | [R2 对照](../../docs/ui/evidence/v21-card13/r2-read-900.png) |

源码两轴复查未发现本轮新增确证业务 P1/P2；远端线程、下一轮复审、普通 CI 与合并仍以 PR 当前权威 head 为准。full/certify、现场及 Gate 不因这些结果推进。
