# 卡 18 · v2.1.1 抽屉收尾

日期：2026-11-03。范围：本地合成数据验证；未提交、未推送、未创建 PR。

## 来源、工作区与边界

- 从 HTTPS `origin/main@c2ab09b518fe97e5b9b6b910455b66a5b746a02d` 建立 `codex/pc-admin-v211-card18`，工作区 `D:/worktrees/pc-admin-v211-card18`，本会话为唯一写者。
- 主工作区的两份未跟踪用户原稿及卡 17 worktree 均保留。原型仅从用户原路径读取，没有复制到交付或改写。
- 依据本次任务卡、AGENTS.md、ADR-0053、v2.0/v2.1 规范及卡 13 的已提交真实截图。未找到另行存放的 v2.1 验收报告全文，问题编号和修补要求以本次用户粘贴的卡 18 为准。
- 用户在本会话明确补充授权：`DetailPresentation.tsx` 仅限 ActivityRecord / ActivityTimeline 展示；`TicketRoundNotifications.tsx`、`TicketAssignmentHistory.tsx`、`SharedFollowUp.tsx` 仅限只读时间展示。
- 没有修改后端、合同、命令、状态枚举、权限判定、请求语义、依赖、默认开关或信息架构。原 UUID、UNKNOWN 核对、读取权限、通知/备注隔离和阻塞控制保留。

## 问题与实现

| 问题 | 修补 | 对应证据 |
| --- | --- | --- |
| P1-1 | 按用户在本会话确认的修订：ticket.note_added 优先按备注识别；其它记录只有前后状态确有差异才归 status；无状态字段的正文按 audience 归 note，REPORT 归 report，其余 event。status / event 无气泡；status 两端圆点使用阶段 Token。内部 note 才有浅黄底、锁和内部标记；外部 note / report 使用中性浅灰。 | 分类单测（含备注携带当前状态、相同状态的其它事件）、浏览器背景/圆点/备注断言、四宽图 |
| P1-4 | nextSummary 以是否当前处理人为参数；本人用“你”，他人用姓名。NEW/QUEUED 只有存在合法热度时才展示已等待时长。接管提示仅在已有 allowed_actions 明确包含接管时出现。 | 16 状态 × 本人/他人单测、无接管权限与低于五分钟分支 |
| P2-5 | formatBeijingShort / formatBeijingFull 统一北京时间，当前年 MM-DD HH:mm，跨年 YYYY-MM-DD HH:mm，time.title 保留完整日期和秒。通知、责任历史和共享跟进的只读展示复用；原时间输入和提交值不变。 | 年界/显式时区单测、浏览器时间和 tooltip 断言 |
| P2-6 | 选中页签 600 字重、2px text-primary 下划线，行底 border-hair。零计数不显示，原 tab IDs、aria、左右/Home/End 键盘处理保留。 | 浏览器计算样式/零计数断言、既有导航回归 |
| P2-7 | 详情读取失败和接管完工读取失败使用 danger InlineAlert 与 ghost 重试。接管说明改为“由…接管处理责任，并登记本轮完工结果”；工单版本与轮次保留在 sr-only。 | 读取失败→原 GET 重试且 POST=0、接管相关原回执/次数回归 |

“是否本人”复用现有 caller-only `attention.related_reasons` 中的 `HANDLING`。实际查询按当前 principal ID 与 assignee_id 关联，不比较姓名，不增加请求。该投影未下发时，文案降为现有处理人姓名，不推断为本人。主按钮仍由原命令组件按 allowed_actions 生成，NextStep 的按钮顺序与注册逻辑没有改变。

## 验证策略与停止条件

按实际未提交差异调用现有 pr-plan 的 planChanges，选中 pc profile（pr-pc + pr-read-safety）；直接修改的既有测试自动加入。补充详情结构、媒体布局、接管跨页选择和 opaque 原操作核对四个入口，覆盖展示改动可能影响的截断、焦点、读取恢复与原命令保留。去重共 19 个入口。

没有运行 full/certify、Electron、真实发送、现场业务写库、部署或 Gate。所选检查通过、四宽截图完成、直接风险缺口关闭后停止扩验。

原始日志与完整路径/数量：`D:/CodexEvidence/pc-admin-v211-card18-20261103/`。各候选、首次失败和最终结果分别保存，不重绑历史截图或旧 tested_head。

## 四宽对照

改前来自 `docs/ui/evidence/v21-card13/r5-final-compare-<宽度>.png` 的中间“卡13 R5正式bundle ce6e9108”画面，原文件与标题不改写。改后来自本卡正式 bundle / 原 HTTP / UUID 合成 PG fixture。两者是不同日期和合成场景的视觉对照，不是同一数据的像素回归。

## 偏差与回退

- 文件边界仅有上文用户明确授权的四个补充点；记录分类另按用户确认的事件类型/真实变化规则前向修订。测试、执行记录和截图按任务要求交付。共享 Token/status-map/Workbench.tsx 均不改动，避免与卡 17/19 写入重叠。
- 不新增 Token；颜色、字号、间距、字重全部复用现有语义 Token。用户本次指定的页签与记录类型规则作为 v2.1 的收尾要求记在本卡，未跨卡改写共享规范。
- 本轮只做本地未提交展示变更。回退时仅撤销本卡清单中的差异与新文件；不得对整个主工作区 reset/clean。原用户资料与历史 Evidence 保持。


## 中间失败与处置（不作为最终通过）

- 首次 build 因新增单测误用了不存在的 `card()` 夹具失败；修正为已有 `boardCard()`。原日志 `build-initial-failed.log`。
- 差异复核发现错误提示中的 retry 可见条件互斥，已在进入最终候选前修正；中间候选 build/types 通过，但选择未执行，source 改动后的 artifact guard 按预期拒绝 INPUT_DRIFT。各 `before-retry-fix` 日志保留。
- 正式选择第一次因缺少 `TS_MIGRATION_TEST_DB_ISOLATED=1` 在环境预检拒绝，0 用例执行。仍使用本卡新建的 127.0.0.1:55478 PG18，补齐声明后再运行，源码未因预检修改。原日志 `selection-isolation-preflight-failed.log`。
- 原“任一状态字段非空即 status”候选的卡 13 新增 note 样式前提等待失败；其原命令/回执断言已经通过。查明 Ticket 备注也带当前 new_status，用户随后明确选择“按事件类型识别备注，实际状态变化归 status”，因此调整前端分类，不改后端。原 `selection-final/` 和 `selection-presence-rule-failed.log` 保留。
- 同一中间候选的 Card16、54 项 foundation、T12 跨页选择通过；T12 原 UNKNOWN 两例通过，新增只读重试用例因夹具停留 ACCEPTED、等待不适用的接管完工入口而失败。为用例增加原合法 start 前置，并保留/增加状态、版本、处理人与 POST=0 断言；不修改产品主按钮逻辑。原 `remaining17-current4098/` 和 `remaining17.log` 保留。批次在当前测试子进程完成、无活动子进程时停止，未运行项不记为通过。
- 修订分类后的源码纯函数 sanity 为 54/54 PASS；只作为构建前快速检查，最终仍运行已编译的正式 19 入口。

- 新增浏览器等待条件最初返回 DOM 节点，协议序列化时报 `Object reference chain is too long`；只改为 Boolean 条件。正式中间候选的卡13其它五例仍通过，原业务断言没有删除或放宽。对应 `selection-approved-rule/` 和 `selection-before-tab-aria-fix.log` 保留。
- 定向诊断随后发现真实页签 DOM 的 `aria-selected` 全部缺失，选中字重仍为 500。观测原件 `tab-observation.json`。在 DrawerTabs 的 callback ref 中局部同步该属性，保留原 role、ID、键盘处理和共享 Button 文件。最终浏览器断言要求真实选中项为 600 / 2px / text-primary / 透明底。
- 早期独立采图因第一例先失败、输出目录尚未建立而出现 ENOENT，已给错误态采图分支独立创建目录；诊断原件保留。最终采图独立建立目录，正式运行不依赖其它用例顺序。

## 采图口径

正式制品的流程采图执行抽屉两例与接管错误态一例，3/3 PASS。流程图中的成功 Toast 原样保留在原始证据。交付对照图另使用既有 caller-only HANDLING 只读投影开启的合成 profile：在浏览器启动前经原认证 API 领取开始并保存内部备注，随后读取稳定画面；这能同时观察“你正在处理”、唯一登记完工主按钮、黄色内部备注和无气泡的状态变化。该配置只在本卡 UUID 合成库内使用，不修改持久开关、仓库默认值或部署配置。采图期间的实际 POST 数与核心事实前后核对写入 capture.json。


## 最终候选与验证结果

基线 HEAD 为 `c2ab09b518fe97e5b9b6b910455b66a5b746a02d`，交付为该 HEAD 上未提交的工作区差异。源输入指纹 `0bbb3a50d2680d89ca84b5de8cbe0ff91fc02fa869ed14252b8aca96286570cb`；制品 manifest SHA-256 `4381378e52e04c11a439df8a5ab271bc7c315541a59b1f276f0eaaf5f0e6638c`。不把基线提交称为已包含本卡改动的 tested_head。末次 HTTPS fetch 确认 origin/main 仍等于基线，未发生需要同步的其它卡合并。

| 检查 | 最终结果 | 原件 |
| --- | --- | --- |
| Stylelint | 0；gate css PASS | `types-final.log` |
| ESLint | 0；gate feature-syntax PASS | `types-final.log` |
| migration:build | PASS；918 strict emits / 918 Node syntax checks | `build-final.log` |
| gate.mjs types | PASS；strict + negative types + 前端/Token 检查 | `types-final.log` |
| verify-artifact.mjs | PASS；未激活 | `artifact-final.log` |
| PC profile + 直接风险 | 19 入口；108/108 PASS；0 FAIL/cancel/SKIP/todo/NOT_RUN | `selection-verified-candidate/summary.json` |
| 正式流程采图 | 抽屉 2/2 + 接管错误态 1/1 PASS | `capture-exits.json` |
| 稳定读取四宽采图 | PASS；浏览器 POST=0；核心 status/version/assignee 不变 | `clean-screenshots/capture.json` |

原件均位于上述仓库外证据根。仓库内的[验证索引](../../docs/ui/evidence/v211-card18/verification.json)保存最终指纹、18个源码/测试文件哈希、逐入口数量和四宽几何；[截图索引](../../docs/ui/evidence/v211-card18/screenshots.json)保存未改写的历史来源哈希与裁切范围。

| 测试入口 | PASS / 总数 |
| --- | --- |
| `tests/pc-admin-card12-review.browser.test.mts` | 7 / 7 |
| `tests/pc-admin-card13.browser.test.mts` | 6 / 6 |
| `tests/pc-admin-card16.browser.test.mts` | 3 / 3 |
| `tests/pc-admin-design-foundation.test.mts` | 54 / 54 |
| `tests/t12-crosspage-selection.browser.test.mts` | 1 / 1 |
| `tests/t12-opaque-recovery.browser.test.mts` | 3 / 3 |
| `tests/t35-account-switch.browser.test.mts` | 1 / 1 |
| `tests/t35-current-authority-wait.integration.test.mts` | 1 / 1 |
| `tests/t35-unknown-read.browser.test.mts` | 1 / 1 |
| `tests/wbint-t19-manual-self-handling-authority.integration.test.mts` | 1 / 1 |
| `tests/wbint-t19-manual-self-handling-contracts.test.mts` | 4 / 4 |
| `tests/wbint-t19-manual-self-handling-unknown.browser.test.mts` | 1 / 1 |
| `tests/wbint-t22-realtime-tracer.browser.test.mts` | 1 / 1 |
| `tests/wbint-t30-internal-note.browser.test.mts` | 1 / 1 |
| `tests/wbint-t32-exception-authorization.browser.test.mts` | 1 / 1 |
| `tests/web01-workbench.integration.test.mjs` | 13 / 13 |
| `tests/web01-workbench.test.mts` | 6 / 6 |
| `tests/workbench-detail-media.browser.test.mts` | 1 / 1 |
| `tests/workbench-detail-restructure.browser.test.mts` | 2 / 2 |

## 文件清单

共18个应用展示/测试文件；另交付本记录及 v211-card18 截图与验证索引。

- [app/pc-admin/src/app/DetailPresentation.tsx](../../app/pc-admin/src/app/DetailPresentation.tsx)
- [app/pc-admin/src/app/WorkbenchDetail.tsx](../../app/pc-admin/src/app/WorkbenchDetail.tsx)
- [app/pc-admin/src/design/beijing-time.ts](../../app/pc-admin/src/design/beijing-time.ts)
- [app/pc-admin/src/design/components/Drawer/DrawerTabs.tsx](../../app/pc-admin/src/design/components/Drawer/DrawerTabs.tsx)
- [app/pc-admin/src/design/components/Drawer/NextStep.tsx](../../app/pc-admin/src/design/components/Drawer/NextStep.tsx)
- [app/pc-admin/src/design/components/Drawer/drawer-v21.css](../../app/pc-admin/src/design/components/Drawer/drawer-v21.css)
- [app/pc-admin/src/design/components/Drawer/next-summary.ts](../../app/pc-admin/src/design/components/Drawer/next-summary.ts)
- [app/pc-admin/src/design/components/Timeline/BeijingTime.tsx](../../app/pc-admin/src/design/components/Timeline/BeijingTime.tsx)
- [app/pc-admin/src/design/components/Timeline/record-kind.ts](../../app/pc-admin/src/design/components/Timeline/record-kind.ts)
- [app/pc-admin/src/design/components/Timeline/timeline.css](../../app/pc-admin/src/design/components/Timeline/timeline.css)
- [app/pc-admin/src/features/assignment-history/TicketAssignmentHistory.tsx](../../app/pc-admin/src/features/assignment-history/TicketAssignmentHistory.tsx)
- [app/pc-admin/src/features/follow-up/SharedFollowUp.tsx](../../app/pc-admin/src/features/follow-up/SharedFollowUp.tsx)
- [app/pc-admin/src/features/ticket-round-notifications/TicketRoundNotifications.tsx](../../app/pc-admin/src/features/ticket-round-notifications/TicketRoundNotifications.tsx)
- [app/pc-admin/src/features/ticket-takeover-completion/TicketTakeoverCompletion.tsx](../../app/pc-admin/src/features/ticket-takeover-completion/TicketTakeoverCompletion.tsx)
- [tests/pc-admin-card13.browser.test.mts](../../tests/pc-admin-card13.browser.test.mts)
- [tests/pc-admin-design-foundation.test.mts](../../tests/pc-admin-design-foundation.test.mts)
- [tests/t12-opaque-recovery.browser.test.mts](../../tests/t12-opaque-recovery.browser.test.mts)
- [tests/workbench-detail-restructure.browser.test.mts](../../tests/workbench-detail-restructure.browser.test.mts)

## 四宽交付链接

| 宽度 | 前后对照 | 改前 | 改后 |
| --- | --- | --- | --- |
| 1920 | [对照](../../docs/ui/evidence/v211-card18/compare-1920.png) | [历史中间画面](../../docs/ui/evidence/v211-card18/before-1920.png) | [当前稳定读取](../../docs/ui/evidence/v211-card18/after-1920.png) |
| 1440 | [对照](../../docs/ui/evidence/v211-card18/compare-1440.png) | [历史中间画面](../../docs/ui/evidence/v211-card18/before-1440.png) | [当前稳定读取](../../docs/ui/evidence/v211-card18/after-1440.png) |
| 1280 | [对照](../../docs/ui/evidence/v211-card18/compare-1280.png) | [历史中间画面](../../docs/ui/evidence/v211-card18/before-1280.png) | [当前稳定读取](../../docs/ui/evidence/v211-card18/after-1280.png) |
| 900 | [对照](../../docs/ui/evidence/v211-card18/compare-900.png) | [历史中间画面](../../docs/ui/evidence/v211-card18/before-900.png) | [当前稳定读取](../../docs/ui/evidence/v211-card18/after-900.png) |

[详情读取失败](../../docs/ui/evidence/v211-card18/read-error-1440.png)、[接管完工读取失败](../../docs/ui/evidence/v211-card18/takeover-read-error-1440.png)。错误态范围为本卡整体详情读取与接管完工区块；其它独立命令控制器仍按其既有呈现，本卡未跨文件扩展。

目视已核对四宽：抽屉720px、顶/右8px、无横向溢出、唯一primary和唯一选中页签；黄色仅承载内部note，阶段变化为灰色单行与阶段圆点；日期无秒、零计数不展示。稳定采图保留标题的真实键盘焦点环。对照中工单状态、类别投影和加载数量随合成场景不同，不作为像素级差异断言。

## 自检清单

| 清单 | 是/否 | 证据 |
| --- | --- | --- |
| 仅前端展示；无业务命令、状态值、权限、合同变化 | 是 | 18文件清单；接管控制器JSX前字节等价；108/108原风险断言 |
| 测试选择器只增不删；旧测试仅文字期望同步 | 是 | 原ID/class/data-action保留；旧报修时间期望同步短日期，新增状态、权限、UUID、次数等断言未放宽 |
| 新样式经Token；Stylelint/ESLint为0 | 是 | 最终types gate；未定义Token/原始色泄漏均0 |
| 仅本卡路径及用户明确补充的范围 | 是 | 未改Workbench.tsx/Token/status-map或后端；未格式化其它区块 |
| 四宽与v21真实截图对照 | 是 | 四幅compare及来源哈希/裁切索引 |
| 每个问题编号有证据 | 是 | 上述P1-1/P1-4/P2-5/P2-6/P2-7映射、逐入口结果、四宽与错误态图 |

## 资源与本地交付停止线

工作分支与未提交差异保留，供本地审阅；最终构建及本卡仅用于读取既有依赖的 node_modules junction 保留。自有浏览器由各fixture关闭并核进程/profile/timer/socket=0，自有HTTP监听随fixture停止。PG数据库/监听/进程的最终清理读回另见验证索引中的cleanup字段。未提交、未推送、未创建PR；未运行CI/full/certify/Electron/真实发送/现场业务写库/部署/Gate。

最终资源读回：各UUID夹具数据库均已删除，PG只剩postgres默认库；本卡PG 2464已停止，pg_ctl status=3、PID不存在、55478监听=0。自动审批策略拒绝了包含停止与递归删除PG数据目录的整条命令，唯一理由为`blocked by policy`，原命令未执行。随后采用更保守的只停止方式并读回成功，停止后的PG数据目录与日志保留，未再尝试删除。文档检查与工具测试均exit 0。


## GPT-6 Astra Extra High 复核与原型修补（2026-11-03）

用户本轮明确要求 GPT-6 Astra / xhigh 子代理独立复核，并允许修正原型对应场景的颜色、边框、线条和细微样式。代理只读，源码仍由root唯一写入。用户另明确批准在tokens.css末尾追加三个Drawer专用颜色Token：FDF6EC等待底、F2D9B8等待描边、FFFDF6输入底；既有Token值未改。

本段是初次交付后的新候选，不改写上文0bbb3a50候选的108/108、原截图或失败事实。[最新复核验证索引](../../docs/ui/evidence/v211-card18/astra-review-r1/verification.json)、[Astra初审](../../docs/ui/evidence/v211-card18/astra-review-r1/astra-initial-review.md)、[静态复查](../../docs/ui/evidence/v211-card18/astra-review-r1/astra-static-recheck.md)、[最终八图复查](../../docs/ui/evidence/v211-card18/astra-review-r1/astra-final-review.md)集中对应本候选。

### 发现、修补与结果

- A1/P2：EXTERNAL来自external_note，不是Delivery/ACK。标签恢复“报修人可见”；未增加请求。原UNKNOWN两例增加公开记录标签断言，原状态、版本、原UUID、密文保全、次数与回执断言保留。
- A2/P2视觉：note/report改为姓名/动作/可见范围/时间头行和第二行正文气泡。正文14/22、内边距10/12、圆角4/12/12/12、主文字色；仍只有一个PersonalReadMaterial节点，保留原截断、展开和前台阅读观察。
- A3/P3视觉：去掉description上下多余边框及例行Section的额外顶距；页签间距20。顶栏52px、正文20/28内距、细线与轨道通过Drawer局部组件Token组合已有Token；阶段徽标6px圆角、图标与头像尺寸按原型局部对齐。
- 等待下一步卡用精确暖底与1px inset描边、18px时钟和主灰正文；仍是active业务阶段，阶段徽标保持蓝色。等待时长复用已有合法heat投影，无有效时间不推断；跟进时间仍用统一格式。orders、允许操作、主按钮权限与命令逻辑未变。
- 输入框改为暖白底、浅黄内部标记，保存按钮通过CSS grid摆到输入区右侧。原textarea、submit按钮、Ctrl+Enter、草稿/UNKNOWN恢复节点全部保留。

### 验证与范围

最新源输入指纹：`7fa0589725988fbe3ad716e0a00143c03a5763365abe81ba644b9fe31fc26e8e`；manifest SHA-256：`d161aed946a1a3399cf87b8aa808ce56e10f11a273ab3eb0473d59dafae4944b`。构建、gate types、Stylelint/ESLint 0、Token检查0、制品校验均通过；19入口108/108 PASS，0失败/取消/跳过/未运行。正式流程定向3/3 PASS，稳定active/waiting两场景各四宽通过，采图POST=0且核心事实前后不变。Astra逐图核8/8哈希及取色，结论无新的P1/P2阻断。

本轮路径计划以已被Astra核对18/18文件哈希的上次本地交付指纹为复核基线，按实际9个源码/测试增量及设计规范变更复用pc+docs策略，再合并4个直接风险入口。原全脏工作区计划把上轮未提交的证据JSON纳入未知路径，触发54项MVP及ffmpeg环境预检，0用例执行后失败；原计划、错误和54项NOT_RUN均保留于仓库外`selection-whole-dirty-preflight-failed.log`等，不声称该计划通过，不修改路径策略或注册库存。正式PR若另行授权，仍须按其真实base/head重新规划CI。本轮无CI/full/certify/Electron/现场/发送/部署/Gate。

新增浏览器断言覆盖：等待底色/inset描边、第二行气泡几何、14/22/10/12与四角、正文主色、唯一时间节点、无description上下线、tabs20、输入底色和保存按钮位置；新增或同步展示期望没有放宽业务断言。媒体/小屏390px与真实指针/焦点回归也在19入口内通过。

### 对照与精度限制

| 宽度 | 原交付 → Astra复核后 | 当前等待场景 |
| --- | --- | --- |
| 1920 | [前后对照](../../docs/ui/evidence/v211-card18/astra-review-r1/compare-active-1920.png) | [等待场景](../../docs/ui/evidence/v211-card18/astra-review-r1/waiting-1920.png) |
| 1440 | [前后对照](../../docs/ui/evidence/v211-card18/astra-review-r1/compare-active-1440.png) | [等待场景](../../docs/ui/evidence/v211-card18/astra-review-r1/waiting-1440.png) |
| 1280 | [前后对照](../../docs/ui/evidence/v211-card18/astra-review-r1/compare-active-1280.png) | [等待场景](../../docs/ui/evidence/v211-card18/astra-review-r1/waiting-1280.png) |
| 900 | [前后对照](../../docs/ui/evidence/v211-card18/astra-review-r1/compare-active-900.png) | [等待场景](../../docs/ui/evidence/v211-card18/astra-review-r1/waiting-900.png) |

[1440等待场景与历史原型参考](../../docs/ui/evidence/v211-card18/astra-review-r1/compare-waiting-prototype-1440.png)。[当前用户HTML的来源与方法](../../docs/ui/evidence/v211-card18/astra-review-r1/prototype-source.json)记录原件哈希、抽屉资源ID及嵌套模板哈希。原件未改写。

不能宣称整屏像素完全一致：内置浏览器的受信桥不可用，file导航被URL安全策略拒绝，没有用HTTP代理/其它表面绕过；实际核对依据是当前HTML静态DOM/CSS与当前应用真实截图像素，历史原型图只作已标注的辅助参考。文件仅有thumbnail样式选择器，没有找到完整快照元素。原型Inter/Noto字体、1440×1060画布与实际1080高视口，以及人员、工单、类别投影、等待/跟进数据、权限按钮均存在数据或环境差异；时间MM-DD格式、真实焦点环及真实禁用状态按当前合同保留。

保留两项P3：既有等待控制器的例行i状态宽行；现有共享状态圆点与原型环形阶段/暂停图形不同。它们在Astra报告中明确记录，未为图像一致隐藏恢复/UNKNOWN信息，也未扩展卡17负责的共享状态组件。所有A1/A2/A3与本轮颜色/边框/轨道问题已关闭。

### 本轮变更清单与交付停止线

- [app/pc-admin/src/app/DetailPresentation.tsx](../../app/pc-admin/src/app/DetailPresentation.tsx)
- [app/pc-admin/src/app/WorkbenchDetail.tsx](../../app/pc-admin/src/app/WorkbenchDetail.tsx)
- [app/pc-admin/src/design/components/Drawer/NextStep.tsx](../../app/pc-admin/src/design/components/Drawer/NextStep.tsx)
- [app/pc-admin/src/design/components/Drawer/drawer-v21.css](../../app/pc-admin/src/design/components/Drawer/drawer-v21.css)
- [app/pc-admin/src/design/tokens.css](../../app/pc-admin/src/design/tokens.css)
- [tests/pc-admin-card13.browser.test.mts](../../tests/pc-admin-card13.browser.test.mts)
- [tests/pc-admin-design-foundation.test.mts](../../tests/pc-admin-design-foundation.test.mts)
- [tests/t12-opaque-recovery.browser.test.mts](../../tests/t12-opaque-recovery.browser.test.mts)
- [app/pc-admin/src/design/components/Drawer/next-summary.ts](../../app/pc-admin/src/design/components/Drawer/next-summary.ts)
- [设计规范v2.1补充](../../docs/ui/design-system-v2.1.md#63-卡-18-原型复核修订2026-11-03)及本段记录、复核证据。

分支和未提交工作区保留；未提交、未推送、未创建PR。当前origin/main仍为c2ab09b5，没有需要同步的其它卡合并。最终资源读回将在最新验证索引cleanup字段保存，原停止PG数据目录继续保留，不重试此前被拒的递归删除。

本轮最终读回：19入口108/108、制品校验与文档检查均通过。所有夹具UUID库均已清理，只剩postgres；本轮自有PG已停止，PID不存在，55478监听0，数据目录按原停止保留策略保留。原用户HTML与主工作区两份未跟踪原稿保持；本轮没有递归删除尝试。


## 两项 P3 收尾（2026-11-03）

用户明确授权继续压缩例行i提示空白并在抽屉内还原阶段环/等待暂停标签，完整保留恢复与UNKNOWN信息，仍不提交/推送/创建PR。本段为7fa05897复核候选的展示后继，原结果与截图继续保持其历史绑定。

### 改动与安全边界

- TicketWaitingActions仅在原render section增加data-routine-draft：草稿启用且可用、idle、未展开、无原操作/输入/恢复/反馈、读取不在pending/fetching/error、消息精确为例行空白说明时才为true。未改原allowed/canSubmit计算、命令、UUID、恢复回调、查询或ACK。Drawer CSS还有form/button/alert反向保护，只压缩无这些内容的例行容器；原图标、完整title/aria-label/sr-only文字保留。
- 两个例行i图标各20×20，独立区域总高由约93px/47px收紧为21px。非例行区域保持原布局，没有display:none、固定高度或overflow裁切恢复信息。
- 新增DrawerStageGlyph：13px虚线待受理环、半填处理中环、已处理勾选圆。仅抽屉Header隐藏旧装饰点（DOM钩子仍保留），文字与stage数据不改；历史时间线仍用原6px状态点。
- 等待标签通过原Status组件和暂停SVG组合，22px高、12px暂停图形、中性灰底/字、4px圆角。待复核Tag及其它状态仍保留；没有修改共享StatusBadge/status-map或看板图标。颜色仍取既有stage/neutral Token，未新增色值或依赖。

### 验证

源输入指纹 `ae1c281d4a06038a620a1e4e551336fd948140963c0c4f9f725cbd64f916f39e`；制品manifest `2a750581df99af3461f510230d865952189b6d857e6a887035cfeccbe7eff47d`。统一build、types（strict/negative/前端/Token）、Stylelint/ESLint 0及制品校验通过。本轮按前一验证快照的实际复核增量复用PC策略，增加直接涉及的T10 UNKNOWN恢复入口；20入口109/109 PASS，0失败/取消/跳过/未运行。原状态、权限、请求、回执与次数断言没有放宽。

定向流程3/3与T10原UNKNOWN恢复1/1通过。新增断言检查例行容器的高度/无padding边框、提示完整性、三阶段图形、暂停标签、UNKNOWN不例行化且核对动作可见。T10继续证明仅一个原UUID POST、reload不自动核对、明确点击仅一个GET及原处理人/轮次/版本不变。

额外UNKNOWN实图来自编译T10用例的仓库外派生副本，仅在明确ACK前增加截图检查点、相对导入解析到同一runtime，保留原断言；1/1 PASS，不冒充新的注册入口。过期敏感清理、原操作未知、恢复警告及核对按钮均可见。稳定active/waiting各四宽加1440×1060图通过；采图POST=0，工单核心事实不变。Astra同一GPT-6 Astra/xhigh子代理只读复查上述图与源码，确认两项P3关闭且未发现新问题。

[最新验证索引](../../docs/ui/evidence/v211-card18/p3-closeout/verification.json)、[Astra关闭报告](../../docs/ui/evidence/v211-card18/p3-closeout/astra-final-review.md)、[像素/哈希观测](../../docs/ui/evidence/v211-card18/p3-closeout/astra-final-observations.json)、[UNKNOWN保留实图](../../docs/ui/evidence/v211-card18/p3-closeout/unknown-preserved-1920.png)。原件在`D:/CodexEvidence/pc-admin-v211-card18-20261103/p3-closeout/`。

| 宽度 | active前后 | waiting前后 |
| --- | --- | --- |
| 1920 | [对照](../../docs/ui/evidence/v211-card18/p3-closeout/compare-active-1920.png) | [对照](../../docs/ui/evidence/v211-card18/p3-closeout/compare-waiting-1920.png) |
| 1440 | [对照](../../docs/ui/evidence/v211-card18/p3-closeout/compare-active-1440.png) | [对照](../../docs/ui/evidence/v211-card18/p3-closeout/compare-waiting-1440.png) |
| 1280 | [对照](../../docs/ui/evidence/v211-card18/p3-closeout/compare-active-1280.png) | [对照](../../docs/ui/evidence/v211-card18/p3-closeout/compare-waiting-1280.png) |
| 900 | [对照](../../docs/ui/evidence/v211-card18/p3-closeout/compare-active-900.png) | [对照](../../docs/ui/evidence/v211-card18/p3-closeout/compare-waiting-900.png) |

[1440×1060等待场景](../../docs/ui/evidence/v211-card18/p3-closeout/waiting-1440x1060.png)用于与原型画布尺寸对应。仍不宣称原型整屏逐像素完全一致；原型浏览器导航限制、字体、数据和真实权限/禁用态等差异沿前段说明。本次没有尝试绕过原file导航限制。

本轮源码/测试增量：

- [app/pc-admin/src/app/WorkbenchDetail.tsx](../../app/pc-admin/src/app/WorkbenchDetail.tsx)
- [app/pc-admin/src/design/components/Drawer/drawer-v21.css](../../app/pc-admin/src/design/components/Drawer/drawer-v21.css)
- [app/pc-admin/src/features/ticket-waiting/TicketWaitingActions.tsx](../../app/pc-admin/src/features/ticket-waiting/TicketWaitingActions.tsx)
- [tests/pc-admin-card13.browser.test.mts](../../tests/pc-admin-card13.browser.test.mts)
- [tests/t10-unknown-recovery.browser.test.mts](../../tests/t10-unknown-recovery.browser.test.mts)
- [app/pc-admin/src/design/components/Drawer/DrawerStageGlyph.tsx](../../app/pc-admin/src/design/components/Drawer/DrawerStageGlyph.tsx)

另更新设计规范§6.4、本记录和证据。当前应用/测试累计22文件哈希记录于最新索引；本轮无后端/合同/数据库源码/持久开关/依赖变化，所有自检仍满足。停止线仍为本地未提交交付；无CI/full/certify/Electron/现场/真实发送/部署/Gate。资源读回将写入最新索引cleanup，继续保留停止后的自有PG数据目录。

P3本轮最终读回：所有UUID夹具库已清理，仅剩postgres；自有PG已停止，status=3、PID不存在、55478监听0，数据目录保留。制品与文档检查均再次通过；工作区未提交，未推送，未创建PR。


## 发布授权与卡17同步（2026-11-03）

用户追加授权提交、推送、创建PR，发起@codex review，修复P1/P2后继续复核，当前head无major且CI通过后合并；之后本地main快进并清理本任务已合并分支/worktree。此前“仅本地/未提交”段落继续作为对应候选的历史记录，不限制本次新授权。

GitHub PR API确认卡17 #139已合并为`56ccf94895856b57bd8026d9d56c1e6716557ef4`。卡18未发布的本地提交重基到该main；原本地提交由`refs/recovery/pc-admin-v211-card18-pre-main-sync-20261103`保全。基础展示测试冲突保留双方用例，Token与规范自动合并保留卡17字段及卡18三个专用色。

同步后DrawerStageGlyph变为共享StatusBadge/StageGlyph的抽屉适配，不再重复绘制SVG；Header仍13px。StatusBadge新增默认true的showStageGlyph展示选项，仅历史Timeline两端传false，以保留原6px状态点和无气泡语义；看板/列表默认行为不变。布局断言改用卡17既有的data-stage-glyph，并保持原业务/权限/请求/UUID/回执/次数断言。

109项20入口的结果仍绑定合并前ae1c281d候选；新增上游基础用例后将重新验证同步候选，不能把旧109项当作新SHA通过。Astra报告同样保持各自原source指纹。同步/发布原件位于`D:/CodexEvidence/pc-admin-v211-card18-publish-20261103/`。

## PR #140 首轮检查与同步修补（2026-11-03）

PR #140 发布head为`bc0b2dff8ad5950582b114bdf2469001d172cc18`，基线为上文卡17合并点。远端Codex首轮复核已完成，明确“Didn't find any major issues”，没有P1/P2意见；[复核回执](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/140#issuecomment-6604965789)只绑定该head，后继仍须按其实际head核验。

首轮[CI 41643308463](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/actions/runs/41643308463)在pr-plan失败：两份Astra报告的四个截图Markdown目标使用本机绝对路径，业务检查未到达。仅将目标改为仓库内同目录图；四张归档图与原始图哈希4/4一致，报告正文结论、source指纹和原始副本保持。修补后的真实base/head文档路径预检通过。历史不可改写检查独立通过，未更改其规则。

同步候选构建和types（含Stylelint/ESLint/Token/strict/负向类型）通过；直接风险20入口实跑113项，112 PASS、1 FAIL、0取消/跳过。失败为既有`workbench-detail-restructure`的390px页面无横向溢出断言；原断言保留。运行中切换工作区dirty状态（四处文档链接修正）还导致最终制品身份校验`MIGRATION_INPUT_DRIFT`；该失败保留，不将本轮记为制品通过。

仓库外原用例诊断副本重复得到390px视口/415px文档宽度，越界源为背景看板工具栏，而非抽屉；仅临时将工具栏flex-wrap设为nowrap后得到390/390且原流程2/2通过。根因为卡17纵向工具栏继承通用窄屏wrap，列向换行使工具栏内在宽度撑开。最小同步补充只在`BoardSummary/board-summary.css`添加局部选择器的`flex-wrap:nowrap`，不改宽度、业务或选择器；这是本次必要的上游展示兼容修复，超过卡18原文件表的范围在此明列。正式候选将重新构建并运行原注册入口，不以临时探针代替通过结果。

原始失败、探针、修补后正式结果、后继CI和Codex回执均保留在发布证据目录；PR说明追加实际结果，不把旧109项或Astra审图重绑到发布SHA。当前仍未运行full/certify、Electron、真实发送/现场写库、部署或Gate。
