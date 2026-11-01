# 设计系统 v2 · 卡 6：会话与其余页面

日期：2026-11-01（Asia/Shanghai）。本地视觉层任务，保留 Card 0–5 和用户原有未提交成果；不提交、推送或创建 PR。

## 1. 摘要与边界

按设计系统 §5.2、§6.7、§6.9–6.12 和 §8.3，统一会话 Split、通知异常/来源群 Table、新报修/设置 Form 与 Modal 展示。

联系人收件箱与旧服务会话路径共用 320px + 1fr 的 Split；视口 ≥1360px 显示 320px 关联事项栏，900px 采用列表到详情导航，各栏独立滚动。列表项采用 32px 头像、14/600 姓名、12px 时间、13px 单行预览，选中背景 bg-selected，未读使用品牌色圆点和数字；来源保持中性文字。头像展示字去掉括号内的资料可用性说明，完整姓名及说明保留在标题和可访问内容中。

对方消息使用 bg-muted，我方使用 brand-subtle，内部备注采用 warning 底并加“内部”前缀；气泡宽度上限 72%，圆角 8px、内边距 8/12px。系统记录复用 Timeline 和系统头像。消息阅读标记、滚动根、原锚点和两种编辑器的持有者不变。

来源群保留原分页和名称维护流程，改为原生语义表格，默认 40px 行；完整 ref 保留在 DOM 和 title 中，仅视觉省略。通知异常使用同一 DataTable，状态沿现有 status-map；失败/未知文字保留，未新增发送或处置入口。

普通及本人处理的新报修表单统一为单列、最大 640px、32px 输入、标签上置、字段间距 16px、底部 sticky 操作栏；主提交在 DOM 与视觉顺序最右。设置仍按原开关直接保存当前设备偏好，不添加确认或新的提交行为。

共享 Modal 提供 sm 440 / md 560 / lg 720、16px 圆角、shadow-4、24px 内边距、20/600 标题、滚动内容和浅底页脚。接单选项用 sm，派单/完工/取消/公开进度/设置用 md，附件预览用 lg；原互斥、关闭阻塞、焦点与受众边界保留。

输入输出继续为原 DTO、props、命令及回执；无数据库、Schema、API、请求参数、Ticket 状态、权限判断、Query/Zustand 结构、草稿、UNKNOWN、实时事件或默认持久 Feature Flag 变更。311 处关键调用表达式逐项一致；静态核验与实际浏览器回归分别记账。未新增任何依赖，未改变包文件、根锁、Stylelint 配置或 AGENTS。

## 2. 文件清单

| 操作 | 文件 | 说明 |
| --- | --- | --- |
| 修改 | app/pc-admin/src/app/DetailDialog.tsx | 组合统一 Modal，保留互斥、关闭阻塞和焦点恢复 |
| 新增 | app/pc-admin/src/design/components/ConversationListItem/conversation-list-item.css | 头像、预览省略、选中和中性来源样式 |
| 新增 | app/pc-admin/src/design/components/ConversationListItem/ConversationListItem.tsx | 头像、预览省略、选中和中性来源组件 |
| 新增 | app/pc-admin/src/design/components/DataTable/data-table.css | 32px 表头、40px 默认行和表格长文本样式 |
| 新增 | app/pc-admin/src/design/components/DataTable/DataTable.tsx | 32px 表头、40px 默认行和表格长文本组件 |
| 新增 | app/pc-admin/src/design/components/FormLayout/form-layout.css | 640px 单列、字段节奏与 sticky 操作栏样式 |
| 新增 | app/pc-admin/src/design/components/FormLayout/FormLayout.tsx | 640px 单列、字段节奏与 sticky 操作栏组件 |
| 新增 | app/pc-admin/src/design/components/MessageBubble/message-bubble.css | 三类消息表面和内部前缀样式 |
| 新增 | app/pc-admin/src/design/components/MessageBubble/MessageBubble.tsx | 三类消息表面和内部前缀组件 |
| 新增 | app/pc-admin/src/design/components/Modal/modal.css | sm/md/lg、标题、尺寸、滚动及页脚样式 |
| 新增 | app/pc-admin/src/design/components/Modal/Modal.tsx | sm/md/lg、标题、尺寸、滚动及页脚组件 |
| 新增 | app/pc-admin/src/design/components/Split/split.css | 320 + 1fr + 320、独立滚动及两级导航样式 |
| 新增 | app/pc-admin/src/design/components/Split/Split.tsx | 320 + 1fr + 320、独立滚动及两级导航组件 |
| 修改 | app/pc-admin/src/design/components/Timeline/timeline.css | 会话系统事件的中性轨道和长文本布局 |
| 修改 | app/pc-admin/src/design/components/Timeline/Timeline.tsx | 增加复用既有头像和轨道的会话系统事件展示 |
| 修改 | app/pc-admin/src/features/attachments/AttachmentSection.tsx | 原预览/下载按钮改用设计 Button，媒体读取不变 |
| 修改 | app/pc-admin/src/features/conversations/ConversationComposer.tsx | 原回复按钮主层级、备注次层级和字数展示 |
| 修改 | app/pc-admin/src/features/conversations/ConversationControl.tsx | 原接待/转派控制只组合设计 Button |
| 修改 | app/pc-admin/src/features/conversations/ConversationInbox.tsx | 组合 Split、联系人项、气泡及系统 Timeline |
| 修改 | app/pc-admin/src/features/conversations/ConversationReadTimeline.tsx | 保留原阅读根和标记，组合 Timeline 与默认气泡 |
| 修改 | app/pc-admin/src/features/conversations/Conversations.tsx | 旧服务会话采用 Split、头像列表及关联摘要 |
| 修改 | app/pc-admin/src/features/manual-report/ManualReportForm.tsx | 普通代录采用单列表单和底部操作栏 |
| 修改 | app/pc-admin/src/features/manual-report/ManualSelfHandlingForm.tsx | 本人处理代录复用相同 Form 模板 |
| 修改 | app/pc-admin/src/features/notification-exceptions/NotificationExceptions.tsx | 复用 DataTable 和现有通知状态 tone，移除内联展示样式 |
| 修改 | app/pc-admin/src/features/reminders/WorkbenchReminders.tsx | 设置采用 md Modal 和统一按钮，原偏好保存不变 |
| 修改 | app/pc-admin/src/features/source-groups/GroupNameEditor.tsx | 保留精确版本/UNKNOWN/拒绝处理，保存按钮采用设计层级 |
| 修改 | app/pc-admin/src/features/source-groups/SourceGroupDirectory.tsx | 来源群卡片列表改为 Table，保留完整 ref 和维护流程 |
| 修改 | app/pc-admin/src/features/ticket-assignment/TicketAssignment.tsx | 派单/转派确认作为弹窗主操作 |
| 修改 | app/pc-admin/src/features/ticket-completion/TicketCompletion.tsx | 弹窗提交采用主按钮，内联模式沿原层级 |
| 修改 | app/pc-admin/src/features/ticket-waiting/TicketWaitingActions.tsx | 取消使用 danger 设计变体，原确认语义不变 |
| 修改 | app/pc-admin/src/features/web-report/WebReportSection.tsx | 原公开进度按钮复用设计层，提交设为主操作 |
| 修改 | app/pc-admin/src/style.css | 迁走会话样式，限制设置页脚文字样式作用范围 |
| 修改 | tests/wbint-t14-review.browser.test.mts | 仅将精确抽屉宽度预期 780 改为 720，业务断言不变 |
| 修改 | tests/wbint-t15-review-start-recovery.browser.test.mts | 仅将精确抽屉宽度预期 780 改为 720，业务断言不变 |
| 修改 | tests/wbint-t15-review-start-restoration-boundaries.browser.test.mts | 仅将精确抽屉宽度预期 780 改为 720，业务断言不变 |
| 修改 | tests/wbint-t15-review-start-team-window.browser.test.mts | 仅将精确抽屉宽度预期 780 改为 720，业务断言不变 |
| 修改 | tests/wbint-t15-review-start-wide.browser.test.mts | 仅将精确抽屉宽度预期 780 改为 720，业务断言不变 |
| 修改 | tests/wbint-t15-review-start.browser.test.mts | 仅将精确抽屉宽度预期 780 改为 720，业务断言不变 |
| 修改 | tests/wbint-t42-board-review.browser.test.mts | 仅将精确抽屉宽度预期 780 改为 720，业务断言不变 |
| 修改 | tests/web01-workbench.browser.test.mjs | 仅将精确抽屉宽度预期 780 改为 720，业务断言不变 |
| 新增 | docs/ui/design-system-v2-card6-conversations-and-pages.md | 本卡范围、实际验证、失败原件及交接 |

删除文件：无。8 份旧抽屉尺寸测试仅将精确宽度预期从 780 改为 720；其他测试字节和全部业务断言一致。

## 3. 前后对照与四宽截图

改前使用本卡起点保存的正式 bundle，改后使用最终正式 bundle；均使用既有真实 loopback HTTP / PG18 合成夹具，externalSendEnabled=false。每轮覆盖 9 个界面状态、4 个宽度，前后共 72 张截图；另有 4 张组件状态图。采图窗口 0 POST，准备动作只写隔离合成库。

| 部位 | 改前 | 改后 |
| --- | --- | --- |
| 会话列表 | 无头像、两行预览、分割线、来源描边按钮 | 32px 头像、单行预览、无分割线、中性来源、品牌未读点与数字 |
| 消息 | 我方 info 底、内部缺少气泡前缀、宽度不统一 | 对方 muted / 我方 brand-subtle / 内部 warning + 前缀，72% 上限 |
| 关联事项 | 第三栏受容器断点影响，部分宽度留下空栏 | ≥1360px 明确显示第三栏；1280 两栏；900 两级导航 |
| 来源群 | 每项一个纵向块、完整长引用撑高 | 四列表格、40px 默认行，引用视觉省略且完整事实保留 |
| 通知异常 | 依赖工单列表列宽和行样式、纯文字结果 | 共享表格、集中状态 tone、结果同时保留完整文字 |
| 新报修 | 姓名/联系方式双列、控件高度不一、操作顺序分散 | 640px 单列、32px 控件、sticky 操作，唯一主提交在最右 |
| 设置/弹窗 | 多套容器宽度、标题与页脚样式 | sm/md/lg、24px 内边距、20/600 标题、浅底页脚 |

| 宽度 | 会话改前 | 会话改后 | 其他最终页面 |
| ---: | --- | --- | --- |
| 1920 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/before-chat-1920.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/after-chat-1920.png) | [来源群](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/after-groups-1920.png) · [异常](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/after-exceptions-1920.png) · [新报修](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/after-form-1920.png) · [设置](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/after-settings-1920.png) |
| 1440 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/before-chat-1440.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/after-chat-1440.png) | [来源群](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/after-groups-1440.png) · [异常](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/after-exceptions-1440.png) · [新报修](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/after-form-1440.png) · [设置](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/after-settings-1440.png) |
| 1280 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/before-chat-1280.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/after-chat-1280.png) | [来源群](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/after-groups-1280.png) · [异常](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/after-exceptions-1280.png) · [新报修](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/after-form-1280.png) · [设置](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/after-settings-1280.png) |
| 900 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/before-chat-900.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/after-chat-900.png) | [来源群](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/after-groups-900.png) · [异常](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/after-exceptions-900.png) · [新报修](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/after-form-900.png) · [设置](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots/after-settings-900.png) |


完整截图在 D:/CodexEvidence/pc-admin-design-v2-card6-20261101/screenshots。qa-sheet-1/2/3.png 是原始截图的缩略排版，辅助逐宽核对，原 PNG 均保留。额外界面为联系人列表、列表空态、旧服务会话、来源群维护、新报修、设置和通知异常。各宽文档无水平溢出；可见区域 primary ≤1。

## 4. Stylelint

在 app/pc-admin 运行 npx.cmd --no-install stylelint "src/**/*.css" --formatter json。沿锁定的 Stylelint 核心包和原配置，37 个 CSS 文件，其中 2 个登录文件按原配置忽略，实际检查 35 个，0 违规。上一卡为 0，本卡仍为 0。

| 规则 | 卡 5 | 卡 6 |
| --- | ---: | ---: |
| color-no-hex | 0 | 0 |
| color-named | 0 | 0 |
| function-disallowed-list | 0 | 0 |
| declaration-no-important | 0 | 0 |
| unit-disallowed-list | 0 | 0 |
| declaration-property-value-allowed-list | 0 | 0 |
| 总计 | 0 | 0 |

## 5. 验证及失败原件

HEAD 仍为 8ad55a19bf5d3ab6d46e534c345cea17eb634e8a，被测对象是该 HEAD 上的本地脏工作区。最终构建输入指纹 9f8fde0501a6ed574c01c88bdd6cf5421d9e4f5849aea9026ee77f64ffd8f816；不把 HEAD 本身说成已包含本卡。

| 检查 | 最终结果 |
| --- | --- |
| npm run migration:build | PASS；911 strict 模块、911/911 语法检查 |
| node .build/tools/gate.mjs types | PASS；CSS、完整 strict、负向类型检查 |
| node .build/tools/verify-artifact.mjs | ARTIFACT_VERIFIED_NOT_ACTIVATED |
| 相关注册浏览器回归 | 28 入口、66 tests，全部 PASS；0 FAIL / SKIP / TODO / NOT_RUN |
| Stylelint | 37 文件，原登录忽略 2，实际 35，0 违规 |
| 四宽截图及组件状态 | PASS；72 张前后图 + 4 张状态图；采图 0 POST |
| 静态边界与测试比对 | PASS；311 处调用，钩子无减少，8 处仅尺寸断言变化 |
| 新正文/按钮配色对比度 | PASS；6 组配色均 ≥4.5:1，最低5.35:1，不含禁用文字 |
| 自有资源 | PASS；合成库0、其他客户端0、PG与浏览器关闭 |

截图与组件状态检查绑定视觉候选 44c32f31049f95240ab1ac315556722decbe3c85be7154faf90035afb5db6d46；后继只适配8份测试的尺寸断言。artifact-equivalence.json 已核验最终候选的全部生产输出不变，12个PC bundle文件逐字节一致；不把旧截图说成后继重跑。最终28个注册入口、types及制品检查实际绑定最终候选。

实际入口为活动 v3-p09 的相关注册子集与风险追加；不是活动全集、full、certify、CI、Electron 原生、现场或用户接受状态。数据库最大连接数 8，真实企业微信/SSO/外部发送/部署/Gate 均未运行。

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

组件状态检查覆盖三类消息底色、内部前缀、列表 hover/pressed/focus-visible/disabled、超长文本、空数据、按钮 disabled/loading、字段、reduced-motion，以及三种 Modal 的实际宽度、标题字号、长内容滚动、页脚、唯一主按钮、Escape 和焦点返回。静态布局组件不伪造提交、pressed 或 loading 行为，相应状态由原数据持有者提供。

保留的失败和中间结果：

- 起点截图脚本的 ready 表达式直接返回 DOM 节点，CDP 无法按值序列化，报 Object reference chain is too long；改为布尔检查后通过，浏览器资源已正常关闭。
- 首次前端检查发现误写 notificationTone 导出名，改用已有 notificationTones；未重复定义状态映射。一次检查误用重复的 cwd/prefix，未进入实际类型检查；从正确入口通过。
- 第一次整仓构建期间补改了一条表格 CSS，构建按 MIGRATION_SOURCE_CHANGED_DURING_BUILD 拒绝。这轮不计 PASS；后续固定候选后重建，最终 911/911 语法检查及制品绑定成功。
- 静态核验脚本曾选到不提供 AST 的 typescript-web 包，又有局部变量引用错误；修正为仓库现有 typescript AST 后，311 处调用、钩子及限定视觉尺寸之外的原测试字节核验通过。
- 首轮视觉发现 Modal 容器 flex 扩张、长 ref 撑高行、复选框标签方向和联系人横滚；原截图与 JSON 保留。统一修正尺寸、行内标签、默认行密度及溢出后，以最终正式候选核对。
- Stylelint JSON 格式默认写入 stderr；早期汇总脚本读取空 stdout 的错误是报告工具错误，实际 CLI exit 0，原 JSON 完整保留。最终组合输出单独归档。

- 表格批次首次为 12 tests / 11 PASS / 1 FAIL，失败是 WEB01 综合用例仍要求旧抽屉宽 780px；实际与 v2 及 Card 5 为 720px。全量查明另 7 处相同旧视觉预期，只改精确尺寸、不改变业务断言，并扩展对应复核回归。原 FAIL / TAP / case trace 保留。

## 6. 规范适用与文案

未增加规范外颜色、字号、圆角或阴影，无需补充视觉值。表格默认行 40px；超长安全摘要和原有多行事实按内容自然扩展，避免隐藏结果或删减业务信息。静态/数据组件的空数据由既有 EmptyState 和加载分支呈现。

“获权联系人”等页面文案在初次交付时已通俗化。初次交付暂留的测试依赖共用提示，随后已获得用户明确授权：“本卡同步改为通俗文案，并更新对应文案断言”。本次已完成这部分改写和相关断言适配，权限、失权清除及对象隔离语义保持原样，实际后继结果见第 8 节。

## 7. 自检、资源与后继

| 自检项 | 是/否 + 证据 |
| --- | --- |
| 只改视觉，无业务行为/请求/状态变更 | 是；311 处关键调用逐项一致，原业务浏览器断言通过 |
| 保留 class/data，未削弱业务断言 | 是；缺失钩子均0，仅8处宽度精确预期更新，其他测试字节一致 |
| 新 CSS 无裸色/裸字号/裸圆角/important | 是；原 Stylelint 配置下0违规，无依赖变更 |
| 每可见区域 primary ≤1 | 是；四宽所有目标区域的实际可见计数断言通过 |
| hover/focus/disabled/loading/空数据/长文本 | 是；组件状态检查与正式交互回归，静态组件不伪造命令状态 |
| 四宽截图核对 | 是；1920/1440/1280/900，几何断言及3张缩略检查页，原始PNG保留 |
| 未发明规范外视觉值 | 是；沿用v2 Token和规范尺寸，无需新增值确认 |

输入/输出与合同保持原样，无数据库回滚；回退使用本卡 source-before/src，以及 source-before/tests 中本卡改过的 8 份测试原字节逐文件恢复，并仅移除本卡新增的 6 个设计组件目录和交付文档，保留 Card 0–5 与其他用户成果，不使用 reset/clean。开关继续沿原默认关闭方式。

PG18 max_connections=8；停止前只有 postgres/template0/template1，其他客户端0；pg_ctl status=3、postmaster.pid 已不存在。本任务 PG 主 PID 12780 与58446监听已关闭；截图、组件及注册测试的自有浏览器资源已释放。保留原失败/中间图、起点原件、最终manifest及停止后的PGdata，未清理用户或其他任务资源。

本卡本地技术结果记录于本文；未对外更新 GitHub Issues 或业务 Backlog。下一张卡 7 的本地技术前置已满足，本卡未启动卡 7，也不自动进行兼容层/语义钩子清理。测试依赖文案已按用户本次明确选择完成，见第 8 节。


证据汇总：[validation-delivery.json](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/validation-delivery.json)；[cleanup.json](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/cleanup.json)；[artifact-equivalence.json](/D:/CodexEvidence/pc-admin-design-v2-card6-20261101/artifact-equivalence.json)。


## 8. 用户确认后的共用文案收口（2026-11-01）

状态：本地完成。用户已明确选择同步改写通俗文案和对应文案断言。本后继只涉及 6 个应用文件、8 份测试，共 24 处文字替换，另有 1 处旧版焦点视觉预期适配；逐字节核对证明其余字节一致。无 CSS、依赖、DOM 结构、class/data 选择器、HTTP 状态/错误码、请求、权限判断、草稿、UNKNOWN、实时或数据库变更。服务端及合同制品逐字节一致。搜索结果说明同步改为“当前显示可见事项中符合条件的分页结果；已加载条数不是总数。”，继续保留分页不是总数的事实。

| 原文 | 现文 |
| --- | --- |
| 当前身份没有查看权限。 | 当前账号无法查看工作台。 |
| 当前身份没有操作权限。 | 当前账号无法执行此操作。 |
| 事项不存在，或不在当前授权范围内。 | 找不到这条事项，或您目前无法查看。 |
| 当前授权范围内暂无事项 | 当前没有可见的事项 |
| 当前授权范围内没有匹配这些条件的事项。 | 当前没有符合这些条件的可见事项。 |
| 当前授权范围内没有补充材料。 | 当前没有可见的补充材料。 |
| 会话已失效，请重新进入已授权工作台。 | 会话已失效，请重新进入工作台。 |

“可见”继续限定实际 READ 范围；404 继续同时涵盖对象不存在和当前不可查看，不向无权主体确认对象存在；403 工作台不可查看与单条事项不可查看保持区分。401 保留原“会话已失效”提示和原登录流程。

| 修改文件 | 说明 |
| --- | --- |
| app/pc-admin/src/api/client.ts | 仅替换对应提示文字，保留分支、选择器、请求及状态 |
| app/pc-admin/src/app/App.tsx | 仅替换对应提示文字，保留分支、选择器、请求及状态 |
| app/pc-admin/src/app/Workbench.tsx | 仅替换对应提示文字，保留分支、选择器、请求及状态 |
| app/pc-admin/src/features/search/WorkbenchSearch.tsx | 仅替换对应提示文字，保留分支、选择器、请求及状态 |
| app/pc-admin/src/features/supplement-follow-up/SupplementFollowUp.tsx | 仅替换对应提示文字，保留分支、选择器、请求及状态 |
| app/pc-admin/src/design/components/BoardColumn/BoardColumn.tsx | 仅替换对应提示文字，保留分支、选择器、请求及状态 |
| tests/t04-self-handling.browser.test.mjs | 仅更新对应文案匹配，原失权、清除、范围、登录及资源断言不变 |
| tests/t20-member-origin-hint.browser.test.mts | 仅更新对应文案匹配，原失权、清除、范围、登录及资源断言不变 |
| tests/wbint-t34-follow-recovery.browser.test.mts | 仅更新对应文案匹配，原失权、清除、范围、登录及资源断言不变 |
| tests/wbint-t38-authority.browser.test.mts | 仅更新对应文案匹配，原失权、清除、范围、登录及资源断言不变 |
| tests/web01-workbench.browser.test.mjs | 仅更新对应文案匹配，原失权、清除、范围、登录及资源断言不变 |
| tests/workbench-desktop-session.browser.test.mts | 更新403文案及v2焦点视觉预期，原指针关闭无圈、登录、注销、清除和资源断言保留 |
| tests/t41-search-production.browser.test.mts | 仅更新对应文案匹配，原失权、清除、范围、登录及资源断言不变 |
| tests/t36-team-and-recovery.browser.test.mts | 仅更新对应文案匹配，原失权、清除、范围、登录及资源断言不变 |

被测对象仍是未提交工作区，HEAD 8ad55a19bf5d3ab6d46e534c345cea17eb634e8a；本后继输入指纹 263d8c6d1e24ef2bdfa3354187ec10277951d795eb707c4ccb2e1f6d8a4149ec。前述 66 项与原四宽 UI 证据仍绑定初次交付候选，不改称本次重跑；以下门禁和10个入口实际绑定最终候选。截图绑定文案应用候选594b3f0bb32f06d98253103011614404578783e19868e4dc89a02affa3240064，后继仅适配测试；12个PC bundle文件逐字节一致，未把旧截图称作后继重跑。

| 检查 | 本后继结果 |
| --- | --- |
| npm run migration:build | PASS；911 strict 模块、911/911 语法检查 |
| node .build/tools/gate.mjs types | PASS；CSS、完整 strict、负向类型检查 |
| node .build/tools/verify-artifact.mjs | ARTIFACT_VERIFIED_NOT_ACTIVATED |
| 相关注册浏览器入口 | 10 入口、44 tests / 44 PASS，0 FAIL / SKIP / TODO / NOT_RUN |
| Stylelint | 37 文件，原忽略2，实际35，0违规；相对初次交付0→0，六条规则均0 |
| 文字边界检查 | PASS；14文件24处文案替换及1处焦点视觉预期适配，其余字节一致 |
| 四宽提示对照 | PASS；4状态×4宽×前后，共32张；采图0 POST、页面无水平溢出 |
| 自有资源 | PASS；合成库0、其他客户端0、PG及浏览器资源关闭 |

| 注册入口 | tests / PASS |
| --- | ---: |
| tests/t04-self-handling.browser.test.mjs | 6 / 6 |
| tests/web01-workbench.browser.test.mjs | 9 / 9 |
| tests/wbint-t34-follow-recovery.browser.test.mts | 5 / 5 |
| tests/wbint-t38-authority.browser.test.mts | 4 / 4 |
| tests/workbench-desktop-session.browser.test.mts | 11 / 11 |
| tests/t20-member-origin-hint.browser.test.mts | 1 / 1 |
| tests/t41-search-production.browser.test.mts | 2 / 2 |
| tests/t41-search-refresh-and-long-pages.browser.test.mts | 2 / 2 |
| tests/t36-supplement-production.browser.test.mts | 1 / 1 |
| tests/t36-team-and-recovery.browser.test.mts | 3 / 3 |

截图的工作台403为标注的合成HTTP拒绝；对象404、空可见列表及无匹配搜索使用既有loopback HTTP/PG18夹具。权限与清除行为另由上述真实原回归验证，不将展示夹具当作现场身份验收。

| 宽度 | 工作台不可查看（前/后） | 对象不可查看（前/后） | 可见列表为空（前/后） | 搜索无匹配（前/后） |
| ---: | --- | --- | --- | --- |
| 1920 | [前](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/before-entry-1920.png) / [后](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/after-entry-1920.png) | [前](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/before-item-1920.png) / [后](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/after-item-1920.png) | [前](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/before-empty-1920.png) / [后](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/after-empty-1920.png) | [前](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/before-search-1920.png) / [后](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/after-search-1920.png) |
| 1440 | [前](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/before-entry-1440.png) / [后](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/after-entry-1440.png) | [前](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/before-item-1440.png) / [后](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/after-item-1440.png) | [前](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/before-empty-1440.png) / [后](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/after-empty-1440.png) | [前](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/before-search-1440.png) / [后](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/after-search-1440.png) |
| 1280 | [前](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/before-entry-1280.png) / [后](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/after-entry-1280.png) | [前](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/before-item-1280.png) / [后](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/after-item-1280.png) | [前](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/before-empty-1280.png) / [后](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/after-empty-1280.png) | [前](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/before-search-1280.png) / [后](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/after-search-1280.png) |
| 900 | [前](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/before-entry-900.png) / [后](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/after-entry-900.png) | [前](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/before-item-900.png) / [后](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/after-item-900.png) | [前](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/before-empty-900.png) / [后](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/after-empty-900.png) | [前](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/before-search-900.png) / [后](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/screenshots/after-search-900.png) |

初次截图脚本漏了既有 search=1 参数，进入普通看板后等待搜索空态超时；只修正截图脚本URL。原失败截图/JSON/log保留，正式应用与业务测试未为此修改。最终前后16+16张均通过。

PG18 使用本后继自有58447端口、max_connections=8；关闭前仅postgres/template0/template1，其他客户端0，pg_ctl status=3。主PID 16812、监听及浏览器进程/配置目录/定时器/socket均已释放。旧卡6原件、失败记录和本后继source-before均保留。回退仅从本后继source-before恢复这14份文件及本文，保留原Card0–6成果，不使用reset/clean。

首批相关回归为35 tests / 34 PASS / 1 FAIL，后续4入口NOT_RUN。失败是桌面会话测试沿用旧版--focus:transparent，与v2 tokens.css的--focus:var(--border-focus)冲突。仅将视觉断言适配为与语义焦点一致且非透明，原指针关闭无焦点圈、Escape、注销、清除和403不自动登录断言全部保留；生产CSS未改。另精确更新搜索空态和补充空态的两个短片段匹配，并加入团队补充/恢复入口。原FAIL、TAP及NOT_RUN清单保留。

自检：仅展示文案及视觉预期（是，字节核对）；保留钩子与业务断言（是，原结构不变且相关回归通过）；CSS/primary/控件状态（是，本后继未改CSS/结构，原结果保留且Stylelint0）；四宽（是，32张新图）；规范外视觉值（无）；文案确认缺口（已关闭）。Card7本地技术前置继续满足，未启动Card7。未提交、推送、建PR、部署、真实发送或推进Gate。

证据：[本后继验证汇总](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/validation-delivery.json) · [资源关闭](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/cleanup.json) · [纯文案核验](/D:/CodexEvidence/pc-admin-design-v2-card6-copy-20261101/integrity.json)。
