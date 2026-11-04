# 卡 20 · PC 管理端 v2.1.2 精修

日期：2026-11-04。范围：本地合成数据；本次只执行卡20。交付状态：**LOCAL_VALIDATED / UNCOMMITTED / STOP**。

## 来源、范围与资源所有者

- HTTPS `origin/main@9184c5ddff3eb67bdfccded7d9024d3b4b6754cc`；独立分支 `codex/pc-admin-v212-card20`，worktree `D:/worktrees/pc-admin-v212-card20`。本会话为唯一写者，主目录用户未跟踪原件保持。
- 用户走查文件原路径：`D:/Projects/Fault-Reporting-WeCom-Assistant/prompts/医小修 PC 管理端 · v2.1.1 设计走查.md`。问题及编号以用户本次执行要求为准；规范、仓库原型HTML和v211历史图共同核对。附件中的建议不自动扩张执行授权。
- 用户本轮明确确认只执行卡20，并允许 `features/ticket-notes/TicketNotes.tsx` 的S9、`app/DetailPresentation.tsx` 的D6最小JSX调整。卡21不启动；筛选胶囊本身、会话、通知异常源码保持。
- 后端、合同、状态值、权限、命令、数据库迁移、依赖与默认开关无差异。内部备注的原UUID、版本、请求、回执、UNKNOWN/恢复、禁止外发规则保持。
- 本地PG18只监听127.0.0.1:55480，位于本任务Evidence根；所有fixture各建UUID合成库并沿原helper清理。只读复用根node_modules的junction，无依赖安装。

## 先补数据、再观测的结论

- **K3**：opt-in `precisionV212` 场景把当前合成账号分配为2张IN_PROGRESS、1张ACCEPTED；另一个有效同组账号负责0张。开启原caller-only HANDLING只读投影后，在原main bundle已分别显示3、0。原场景未开放该投影，不能按姓名或卡片长度代替本人关系，因此无数字且原tooltip说明“当前没有本人处理关系资料”。三种分支保留，不改计数或权限逻辑。
- **K4**：原fixture已有真实状态事件，不是缺事件。原profile实读4张处理中工单的stage_entered_at均有值，距观测仅约0.022分钟，低于5分钟阈值，故不显示热度。新增3/12/45/120/300分钟状态事件时点及26小时前创建的待受理工单后，原main即显示无芯片、12分钟、45分钟、2小时+attention描边、超时5小时+danger描边、超时1天+danger描边。前端起点选择及热度函数无需修改。原始API证据：外部original-fixture-observation.json。
- **类别图标**：沿既有H5 store.accept写入四个显式service_code，再沿既有core.createForIntake建Ticket：PRINT.PRINTER_DEVICE、NETWORK.ENDPOINT_ACCESS、DIAG.IMAGING_VIEWER、CLINICAL.INPATIENT_WORKSTATION。实际API投影为REPORTER_EXPLICIT，分别显示printer/wifi/scan-line/stethoscope及其类别色，保留多张未分类灰底问号。不修改产品数据路径或目录，不新增SQL文件/迁移。
- **D2**：第一张合成Ticket追加old_status=new_status=QUEUED的内部备注和对外备注；另有其它Ticket的真实NEW→IN_PROGRESS。显式ticket.note_added同状态原本已归note；通用相同状态有正文仍归event，单侧状态字段又会误归status，本次按用户双非空且不相等规则收紧，并让相同状态的正文归note。另确认旧图中一条“待接单→待接单”实际为NEW→QUEUED，两个不同状态使用了同一中文展示名；它是合法状态变化，未伪造为同状态或删除事实。

合成数据只在既有fixture的opt-in分支使用原写入方式；人员、位置、标题带（合成）或明显的虚构说明。普通fixture默认precisionV212=false，其状态、分配及内容保持。

## 问题编号逐条结论

| 编号 | 结论 | 位置 / 修改 / 验收 |
| --- | --- | --- |
| T1 | 已修改 | blue-600/red-600实心徽标；白字5.665251/5.256670，注释5.67/5.26；其它六种solid保持；颜色单测及会话读取截图。实际未读组件仍引用info-solid，故在允许的base.css统一徽标背景为brand-solid；不改会话/Split源码或其它solid。 |
| T2 | 已确认原因并修改 | 当前main实际计算透明，走查所说“未命中”未复现；保留透明回归并删除遗留board背景、两个语义/两个原始Token。唯一其它bg-board引用为抽屉缺失资料底，改复用bg-subtle。 |
| T3 | 已修改 | 四个指定色、neutral深灰及Drawer专用hex归原始色板；语义层无裸hex。 |
| T4 | 已修改 | 页签数字和搜索快捷键secondary；超时保留danger。全局搜索其余tertiary为占位、禁用或装饰，无其它时间/计数违规；规范补必读规则。 |
| T5 | 已修改 | 非等待卡34px半透明白底StageGlyph，正文14/600主灰、标题12/500次灰、补充12次灰；等待暖底/时钟/布局保留；五状态实测。 |
| T6 | 已修改 | 全局Firefox thin及Chromium8px、全圆thumb/2px透明边/hover/无按钮；Chromium标准scrollbar属性复位以免遮蔽精确webkit尺寸。 |
| T7 | 已确认原因并修改 | 原全局键盘reset优先级高，简单tabindex规则在键盘模式仍失效；base.css明确提高程序目标规则优先级，焦点保留、outline/shadow none；顺序Tab按钮仍有环。 |
| S1 | 已确认原因并修改 | 当前main实测16px，并非走查估计42px；定向消除标题底padding，工具栏margin-top12，四宽实测12。 |
| S2 | 已确认无需修改 | 原页签到筛选12px，回归保持。 |
| S3 | 已确认无需修改 | 原筛选到看板16px，回归保持。 |
| S4 | 已修改 | 孤立range-bar改sr-only并保留原钩子/文字；全部页签tooltip“已加载15项；计数基于已加载数据”。 |
| S5 | 已确认无需修改 | 当前main已透明且列自然高度不齐；T2删除遗留定义，截图复核。 |
| S6 | 已修改 | 实测原6px，定向收至8px；空metadata内容不渲染，外层不占行。 |
| S7 | 已修改 | 原实测14px，页签底线到首块收为16px。 |
| S8 | 已修改 | 原实测18px，英雄区到下一步收为16px。 |
| S9 | 已修改 | 获授权的TicketNotes JSX将计数和保存移入框内同一底行，原隔离说明保留，例行草稿说明入标签tooltip；告警/UNKNOWN/恢复控件保留。 |
| K1 | 已修改 | 搜索占位“搜索工单号、标题、报修人”；原请求和字段保持。 |
| K2 | 已确认原因并修改 | 原⌄是组合搜索disclosure；保留控制器/条件/submit，只移入框内右侧，16px sliders-horizontal、可访问名及tooltip“搜索选项”。 |
| K3 | 已确认原因并修改 | 修改合成场景，产品计数已正确；3/0/无法统计三分支浏览器断言。 |
| K4 | 已确认原因并修改 | 修改事件时点合成场景；原fixture事件时间低于阈值，产品热度未改；六张卡片文字/data-ring断言。 |
| 类别合成数据 | 已修改 | 上述四个H5显式服务和未分类，实际只读投影与图标断言。 |
| K5 | 已修改 | 仅Workbench调用处加ghost清除，两个筛选生效时显示；不改BoardFilterPill；只清category/handler，日期及概况选择保持。 |
| D1 | 已修改 | 同T7，五状态及四宽焦点实测。 |
| D2 | 已确认原因并修改 | 同前述数据/原因；新guard与note/event单测；同状态备注无箭头，真实变化保留。 |
| D3 | 已修改 | 同T5；五状态正文均主灰。 |
| D4 | 已确认原因并修改 | request-information只记录内部等待原因，原表单明确“请另行联系报修人…不会自动发送”；当前没有可用对外补问入口，删除灰色占位文字，保留缺失资料。 |
| D5 | 已确认无需修改 | 当前main抽屉、列表分组已用StageGlyph；会话右栏 `features/conversations/ConversationAssociatedItem.tsx` 的 TicketCardBody metadata仍为“当前状态·…”纯文字，属于卡21 C10/G1范围，记录交接且本次不改。 |
| D6 | 已修改 | 获授权的ActivityRecord报修头行改姓名·时间；原action钩子与“提交报修”以sr-only保留，其它记录时间右对齐。 |
| G2 | 已修改 | 侧栏开关ghost/isIconOnly，32×32，与设置一致。 |
| G3 | 已修改 | disabled无点；connecting灰、live绿、reconnecting橙，点6px。useRealtime现有四段文案已符合要求，不改状态、重试或权限逻辑；其它断网/轮询/认证准确提示保持。 |

## 验证策略

按ADR-0053和真实工作区差异生成pc+core+docs计划：fixture归core，因此保留当前核心/读取安全检查。另加抽屉结构、媒体与原UNKNOWN恢复直接风险，共28入口。适用检查通过、四宽及指定场景缺口关闭后停止扩验。没有运行full/certify、Electron原生、真实发送、现场业务写库、部署或Gate。

外部原件根：`D:/CodexEvidence/pc-admin-v212-card20-20261104/`。基线main与未提交候选分别记录；当前HEAD只是基线，不能称为包含本卡改动的tested_head。改前是原main的真实bundle加本卡合成场景，不重绑卡17/18旧图。

## 已保留的中间失败

- 内置预览连接不可用；转用仓库既有系统Chromium辅助。首次Edge启动超时并完成自有清理；明确选择已安装Chrome后采图成功，未修改浏览器辅助或工具。
- 首次构建在新增测试的元组缺少as const处strict拒绝；原日志build-final.log保留。修正类型后build-2/types-2/artifact-2通过。
- direct-2为2 PASS/1 FAIL；失败是测试先选概况、后选日期，后者沿既有范围规则重置概况。仅调整步骤顺序为先日期再概况，原保留日期/概况断言不放宽。
- visual-2揭示初始简单tabindex规则仍被高优先级全局keyboard reset覆盖；真实截图和focus-probe/focus-rules.json保留。提高base程序目标选择器优先级并新增键盘后程序聚焦回归。
- selection-3到达5入口：36 PASS/1 FAIL，其后23入口NOT_RUN。K5把新清除按钮放在原筛选行内，破坏了末胶囊的last-child结构，使旧几何断言目标为null；改为调用处外包一层布局，将按钮放在原筛选行后，保留原DOM选择器、完整断言和胶囊样式。
- selection-7到达6入口：43 PASS/1 FAIL，其后22入口NOT_RUN；旧Card13的“保存按钮在框外且40px高”展示断言与S9相反。只将该展示期望前向更新为暖白框内计数/保存同排且28px高，原UUID、两次请求等价、external_visible=false、状态、权限与回执断言完整保留。
- direct-4为2 PASS/2 FAIL，direct-5为3 PASS/1 FAIL：新增包装在无清除时压缩了类别前缀，已改为无按钮时display:contents；两筛选时沿调用层布局。1280px下再实测发现默认54px清除按钮使类别值收缩为0；仅把新按钮改为13px字体、28px最小宽、无额外水平padding，保持8px间距，诊断实测类别值24px、处理人39px、无页面溢出、日期同排。未改原胶囊或断言。
- 新清除保持概况的测试补等真实URL的custom日期范围和已选概况后再操作，避免旧DOM过早满足；filter-probe.json逐步记录概况与日期始终保持。
- 会话实读还发现原inbox-unread引用info-solid，补上全局base语义规则及实际背景色断言；不扩张会话文件范围。
- 会话采图第一次仅因CSSOM把hex规范为小写而断言失败；按同一色值规范大小写后复核，不改产品色值或业务断言。



## 最终身份与验证

交付为基线HEAD上的未提交工作区差异；基线HEAD不是包含本卡改动的tested_head。

- 基线：`9184c5ddff3eb67bdfccded7d9024d3b4b6754cc`。
- 最终源码输入指纹：`47cc39b22af02f69313fb705ff106483292482b7742327b2b5ebd4399ed7a2c3`。
- 最终manifest SHA-256：`f0207dbe8c70925eb7b309537ead059d07578351ae2d4cfe353d2ee613a1d5fa`。

| 检查 | 最终结果 | 外部原件 |
| --- | --- | --- |
| Stylelint | PASS，0；48个CSS，未定义Token0、原始色泄漏0 | types-8.log |
| ESLint（仓库既定features范围） | PASS，0 | types-8.log |
| migration:build | PASS；918个strict产物语法检查、2757输出；保留既有Vite chunk提醒 | build-8.log |
| gate.mjs types | PASS；前端/工具/后端strict及负向类型通过 | types-8.log |
| verify-artifact.mjs | PASS；STAGED_NOT_ACTIVATED | artifact-8.log |
| 相关注册入口 | **28入口、169/169 PASS**；FAIL/CANCEL/SKIP/TODO/NOT_RUN均0 | selection-8/summary.json |
| 原型与四宽采图 | PASS；真实HTTP/PG、四宽无页面溢出，五种抽屉正文主灰，标题焦点保留且无框 | after/measurements.json、capture-after-8.log |
| 滚动条 / 徽标 / SSE | PASS；列表/消息真实竖滚8px，看板真实横滚8px，品牌蓝白字未读，实际live绿点6px | conversation-metrics.json、realtime-metrics.json |
| 文档 | 本地链接/预算PASS；工具检查20/20 PASS | docs-final.log、docs-tools.log |

最终截图均取自最终build-8 bundle。早期截图和输入指纹仍保留各自目录，不反绑旧结果。

### 逐入口结果

| 路径 | PASS / 总数 |
| --- | --- |
| `tests/p2-003-realtime-event-log.integration.test.mjs` | 11 / 11 |
| `tests/p2-016-ticket-lifecycle.integration.test.mjs` | 1 / 1 |
| `tests/p2-016-workbench-auth.integration.test.mjs` | 6 / 6 |
| `tests/pc-admin-card12-review.browser.test.mts` | 7 / 7 |
| `tests/pc-admin-card12.browser.test.mts` | 12 / 12 |
| `tests/pc-admin-card13.browser.test.mts` | 7 / 7 |
| `tests/pc-admin-card16.browser.test.mts` | 3 / 3 |
| `tests/pc-admin-design-foundation.test.mts` | 59 / 59 |
| `tests/t10-atomic-rollback.integration.test.mts` | 4 / 4 |
| `tests/t10-current-authority-wait.integration.test.mts` | 1 / 1 |
| `tests/t10-unknown-recovery.browser.test.mts` | 1 / 1 |
| `tests/t12-opaque-recovery.browser.test.mts` | 3 / 3 |
| `tests/t35-account-switch.browser.test.mts` | 1 / 1 |
| `tests/t35-current-authority-wait.integration.test.mts` | 1 / 1 |
| `tests/t35-unknown-read.browser.test.mts` | 1 / 1 |
| `tests/wbint-t17-manual-receipts.integration.test.mts` | 1 / 1 |
| `tests/wbint-t19-manual-self-handling-authority.integration.test.mts` | 1 / 1 |
| `tests/wbint-t19-manual-self-handling-contracts.test.mts` | 4 / 4 |
| `tests/wbint-t19-manual-self-handling-risks.integration.test.mts` | 4 / 4 |
| `tests/wbint-t19-manual-self-handling-unknown.browser.test.mts` | 1 / 1 |
| `tests/wbint-t22-realtime-tracer.browser.test.mts` | 1 / 1 |
| `tests/wbint-t30-internal-note-risks.integration.test.mts` | 15 / 15 |
| `tests/wbint-t30-internal-note.browser.test.mts` | 1 / 1 |
| `tests/wbint-t32-exception-authorization.browser.test.mts` | 1 / 1 |
| `tests/web01-workbench.integration.test.mjs` | 13 / 13 |
| `tests/web01-workbench.test.mts` | 6 / 6 |
| `tests/workbench-detail-media.browser.test.mts` | 1 / 1 |
| `tests/workbench-detail-restructure.browser.test.mts` | 2 / 2 |

## 截图与间距

[截图与实测索引](../../docs/ui/evidence/v212-card20/README.md)包含35张PNG：12张四宽对照、改后工作台/抽屉、当前main抽屉补拍、0负责人、双筛选、真实滚动和live状态。改前历史图来自v211-card17/18；两类抽屉对照同时保留，原历史图不改写。

| 几何项 | 1920 | 1440 | 1280 | 900 | 目标 |
| --- | ---: | ---: | ---: | ---: | ---: |
| S1 标题→页签 | 12 | 12 | 12 | 12 | 12 |
| S2 页签→筛选 | 12 | 12 | 12 | 12 | 12 |
| S3 筛选→看板 | 16 | 16 | 16 | 16 | 16 |
| S6 元信息→标签 | 8 | 8 | 8 | 8 | 8 |
| S7 抽屉页签→首块 | 16 | 16 | 16 | 16 | 16 |
| S8 英雄区→下一步 | 16 | 16 | 16 | 16 | 16 |
| T5 图标块宽/高 | 34×34 | 34×34 | 34×34 | 34×34 | 34×34 |

以上均为getBoundingClientRect实测，允许±1px，实际误差0。K2图标16×16，G2两端图标按钮32×32；会话/看板滚动条以rect-client差测得8px。S9计数与保存中心差0，均在框内；计数字号计算值12px，保存高28px。伪元素6px实时点和字号采用计算样式交叉核验，不把文字行高冒充字号的几何值。

五种状态为QUEUED、ACCEPTED、IN_PROGRESS、WAITING_VENDOR、RESOLVED；正文统一rgb(55,53,47)，五图图标均34×34。等待卡原暖色、时钟和既有权限动作保持；只读卡如实显示只读，不为了原型伪造按钮。

## 文件清单

以下为源码/测试与规范差异，未格式化或移动其它业务区块：

- [app/pc-admin/src/app/DetailPresentation.tsx](../../app/pc-admin/src/app/DetailPresentation.tsx)
- [app/pc-admin/src/app/Workbench.tsx](../../app/pc-admin/src/app/Workbench.tsx)
- [app/pc-admin/src/app/WorkbenchDetail.tsx](../../app/pc-admin/src/app/WorkbenchDetail.tsx)
- [app/pc-admin/src/design/base.css](../../app/pc-admin/src/design/base.css)
- [app/pc-admin/src/design/components/BoardColumn/workbench-board.css](../../app/pc-admin/src/design/components/BoardColumn/workbench-board.css)
- [app/pc-admin/src/design/components/BoardSummary/BoardSummary.tsx](../../app/pc-admin/src/design/components/BoardSummary/BoardSummary.tsx)
- [app/pc-admin/src/design/components/BoardSummary/board-summary.css](../../app/pc-admin/src/design/components/BoardSummary/board-summary.css)
- [app/pc-admin/src/design/components/Drawer/NextStep.tsx](../../app/pc-admin/src/design/components/Drawer/NextStep.tsx)
- [app/pc-admin/src/design/components/Drawer/drawer-v21.css](../../app/pc-admin/src/design/components/Drawer/drawer-v21.css)
- [app/pc-admin/src/design/components/Timeline/record-kind.ts](../../app/pc-admin/src/design/components/Timeline/record-kind.ts)
- [app/pc-admin/src/design/components/Toolbar/toolbar.css](../../app/pc-admin/src/design/components/Toolbar/toolbar.css)
- [app/pc-admin/src/design/shell.css](../../app/pc-admin/src/design/shell.css)
- [app/pc-admin/src/design/tokens.css](../../app/pc-admin/src/design/tokens.css)
- [app/pc-admin/src/features/search/WorkbenchSearch.tsx](../../app/pc-admin/src/features/search/WorkbenchSearch.tsx)
- [app/pc-admin/src/features/ticket-notes/TicketNotes.tsx](../../app/pc-admin/src/features/ticket-notes/TicketNotes.tsx)
- [docs/ui/design-system-v2.1.md](../../docs/ui/design-system-v2.1.md)
- [docs/ui/design-system.md](../../docs/ui/design-system.md)
- [tests/helpers/web01-workbench-fixture.mjs](../../tests/helpers/web01-workbench-fixture.mjs)
- [tests/pc-admin-card12.browser.test.mts](../../tests/pc-admin-card12.browser.test.mts)
- [tests/pc-admin-card13.browser.test.mts](../../tests/pc-admin-card13.browser.test.mts)
- [tests/pc-admin-design-foundation.test.mts](../../tests/pc-admin-design-foundation.test.mts)
- [本执行记录](card-20.md)
- [截图与实测索引](../../docs/ui/evidence/v212-card20/README.md)及同目录35张PNG。

## 规范更新

- design-system.md：计数/时间不得tertiary；第5章补8–12/12–16间距总则，更新当前两层工作台及lane底；solid历史决定保留并以前向v2.1.2修订brand/danger；可见范围文字使用secondary。
- design-system-v2.1.md：新增§6.5，记录T1–T7、S1–S9、K1/K2/K5、D2/D6和G2/G3的具体展示合同；缺少真实对外补问入口时不展示占位动作。数据分类和状态的权威来源保持。

## 自检（逐条是/否及证据）

| 项目 | 是 / 否 + 证据 |
| --- | --- |
| 只改前端展示及合成数据，未改后端/合同/命令/状态值/权限 | **是**；保护路径差异0，169项实际业务/授权/恢复断言通过；TicketNotes提交前逻辑保持。 |
| 合成数据只用既有fixture写法，无迁移/新SQL，虚构内容标明合成 | **是**；web01 opt-in使用原H5 accept/core/event及原inline SQL方式；滚动截图只调用既有T22/Inbox helper，新增人员/标题均带（合成）。 |
| 测试选择器只增不删；改过测试只改文字或新增断言 | 选择器保留/增加为**是**；按“只改文字”的字面为**否**：T1 solid、D2记录类型和S9框内底行是本轮显式前向展示合同，必须同步原展示期望；未改或放宽状态、权限、请求、回执、UUID、版本、次数等业务断言，无skip。 |
| 新增样式经Token，Stylelint/ESLint为0 | **是**；types-8的css/design-variables/feature-syntax均PASS。 |
| 只改卡20负责文件 | **是（含用户明确补充的两处JSX范围）**；筛选胶囊及其样式、会话/通知异常/Split源码未改；K5只添加调用层布局/按钮。 |
| 每编号有结论；先确认原因各项写明数据/观察/原因 | **是**；上方30行逐项表及K3/K4/D2/分类数据记录；原profile API观测和改前main采图保留。 |
| 像素项有浏览器真实实测 | **是**；上述表和截图索引；DOM采用rect，滚动条采用rect-client差，字号与伪元素使用计算样式补核。 |

## 范围限制与回退

- 当前main的底板透明、16px标题间距和有状态事件的事实已记录，不把走查估值或猜测写成已复现根因。
- D2按状态值判断；NEW→QUEUED虽两端同为“待接单”，仍是真实不同状态，保留该事件，未以同名中文压掉状态事实。
- D5会话右栏纯文字状态，以及长姓名溢出C1、共享筛选/会话消息/通知异常，交卡21；本次没有启动卡21。
- 未运行CI、full/certify、Electron原生、真实发送、现场业务写库、部署、人工现场接受或Gate；本地结果不代替这些对象。
- 未提交、未推送、未创建PR。回退只需撤回本独立worktree中本卡差异；不对主工作区reset/clean。无数据库迁移、持久开关或现场配置回退。

## 资源收尾

最终cleanup-final.json读回：所有UUID合成库已删除，只剩postgres默认库；其它客户端0。自有PG PID28844已停止，pg_ctl stop=0/status=3，PID不存在，55480监听0。会话采图浏览器processes/profiles/commandTimers/sockets均0；工作台/抽屉采图与各注册fixture沿原helper完成关闭断言。

停止后的PG数据目录、编译运行树、日志、首次失败和截图保留；node_modules junction保留。独立分支/worktree及全部未提交差异留给用户审阅，不清理未合入资源。

末次HTTPS fetch确认origin/main仍为9184c5ddff3eb67bdfccded7d9024d3b4b6754cc。主目录没有tracked差异，原5份未跟踪用户资料仍在；本次没有提交、推送、PR、合并或部署。

## 本地交付后的发布授权（2026-11-04）

用户在本地交付后明确授权：提交、推送、创建PR，调用@codex review；修复P1/P2并复审，达到无major且适用CI通过后合并，再快进main并清理本次分支/worktree。上文“未提交/未推送/未创建PR”是该授权之前的本地交付快照，原失败、NOT_RUN、输入指纹和验证对象保持历史含义。

发布与评审回执另存 `D:/CodexEvidence/pc-admin-v212-card20-publish-20261104/`。当前源码/测试交付以GitHub本次完整head及其CI为准；本地169项结果不冒充该新head的CI，也不改变部署或业务Gate授权。
