# 卡 21 · PC 管理端 v2.1.2 精修

2026-11-04。状态：**LOCAL_VALIDATED_WITH_N3_PROJECTION_GAP / UNCOMMITTED / STOP**。本地展示与直接风险验证通过；N3完整字段呈现仍受既有合同限制，不能宣称全部目标已实现。用户仅授权本地实现与验证，不提交、不推送、不创建 PR。

## 对象与边界

- 唯一写者：本会话。独立 worktree `D:/worktrees/pc-admin-v212-card21`，分支 `codex/pc-admin-v212-card21`，HTTPS 最新 `origin/main@f8959042ecf9e596a79cbb249ec7932451805ddb`。
- GitHub 实时读取确认 [PR #142](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/142) 已合并，merge SHA 与基点一致，卡20的 Token 与细滚动条可直接复用；不重复实施卡20。
- 用户当前执行 Prompt 为任务指令；走查文件 `D:/Projects/Fault-Reporting-WeCom-Assistant/prompts/医小修 PC 管理端 · v2.1.1 设计走查.md` 仅为问题来源。主工作区五份未跟踪用户原件原样保留。未读取旧会话记忆作为当前实现证据。
- 只修改卡21授权的前端展示、合成 fixture、相关测试和本卡规范/证据。后端、contracts、迁移、业务命令、状态、权限、查询/回执、依赖及持久开关不变。
- 自有 PG18：`D:/CodexEvidence/pc-admin-v212-card21-20261104/pg`，loopback `127.0.0.1:53651`。每个原 fixture 自建并精确删除 UUID 合成库。共享根 `node_modules` 只通过 junction 引用，不写依赖。原始日志及脚本集中于 `D:/CodexEvidence/pc-admin-v212-card21-20261104`。

## 验证范围与停止条件

影响：共享筛选组合、会话布局/日期与渠道标题、通知异常列宽/链接呈现。按 ADR-0053 使用实际工作区差异调用既有 `planChanges`，经 `runSelection` 执行去重并集；包括 pc、fixture 命中的 core、read-safety 及 Inbox/T22/T32 直接风险。未提交差异与 HEAD 分开记录，不为制造 base/head 差异提交。

新增浏览器断言针对现有覆盖缺口：胶囊键盘/独立清除、长名字时间边界、跨日与渠道分隔数量、内部标识与系统事件、四宽标题坐标与数值尺寸、通知来源列40%上限/56px行高及隐藏分页。所有相关业务请求、次数、权限、UNKNOWN、原UUID恢复与隐私断言保持。适用入口、严格类型、一次最终候选构建、lint、制品、四宽截图和尺寸检查完成后停止；不运行 full/certify、Electron、真实发送、现场写库、部署或 Gate。

## 原型与数据限制

- [原型链接](https://claude.ai/artifact/PnnLs9Q1ZMBjfrr7iVv5uC) 本次读取返回登录页；此前只检查外层画布容器和about:blank引用，未继续解包。该判断在本次离线补验中纠正：文件内有完整压缩画板；当前正式来源只用01–05（含04b），见文末补验记录。上轮实际使用的要求/规范/历史截图不追认成当时已核原型。
- N3：当前 `NotificationExceptionItem` 仅有 `parent_link` / `safe_summary` 等字段，没有工单号、工单标题、报修人姓名。遵守本次不改后端/合同/数据路径的停止线，不解析摘要猜字段，不逐行请求来源。本卡落实既有来源链接的链接色和单行安全摘要，完整编号/标题/姓名仍为只读投影缺口。

## 数据准备阶段的原始失败

- `observe-before.log`：向已有 Journey 的首条受理再次 attach，触发原守卫 `P2_015_DECISION_CONFLICT`；修正为独立合成联系人。
- `baseline-build-2.log`：自查新增 fixture 的普通字符串不满足品牌时间类型；修正数据准备方案后撤除该创建路径。
- `observe-before-3.log`：普通主题受理不满足直接建 Ticket 前提，返回 null；修正为既有 fixture 中的真实 Ticket，通过现有 Journey 关联写法关联。没有改变产品准入或守卫。

## 问题与最终验收

| 编号 | 现象 → 位置 → 修改 → 验收结论 |
| --- | --- |
| G1 | 已修改：三页共享 FilterChip，保留原 board-filter 钩子；未生效/生效/展开三态、独立清除与原 Select 键盘。四宽、Enter/空格/Escape、Tab到×、单条件清除通过；来源×保留来源群。 |
| S10 | 已修改：两种会话入口去副标题，通知保留副标题；标题区到工具栏12px。三页 h1 坐标在四宽对照，通知用例已通过。 |
| S11 | 已确认原因并修改：旧表格除来源外的列总宽过小，来源吸收余量到732/1376px。固定其它列，宽屏列间距限制来源≤40%，56px行高；四宽通知用例已通过。 |
| C1 | 已确认原因并修改：先补长姓名/科室与长预览；除姓名行flex挤压外，HeroUI Link 的 fit-content 还会撑宽整条链接。链接宽100%、首行grid、科室/预览省略；1920时间右缘567≤579，1280为559≤571；预览单行省略通过。 |
| C2 | 已确认原因并修改：旧截图脚本先写今天，再追加昨天，再写今天；新fixture还须校正投影追加的系统记录时间。只修合成时间，使原序号单调；产品不重排消息/分页/已读坐标。日期和真实渠道分开计数。 |
| C3 | 已确认原因并修改：原「内部：」是旧fixture传给真实 internal-notes 的正文。前端只移除可见范围头标，气泡用锁+内部；原文前缀不剥离，新增原文保留断言。 |
| C4 | 已修改：不再将 source_label 的「内部记录/服务记录/Bot私聊回复」当作全部渠道切换；只识别真实群/私聊，系统/备注不改变最近渠道。 |
| C5 | 已修改：系统事件不渲染姓名与可见性头行，时间放到灰胶囊内；原读取材料节点与序号保留。 |
| C6 | 已修改：队列/来源/具体来源群均用 FilterChip；默认open视为未生效且tooltip为当前：进行中。搜索灰底无描边32px；原筛选参数与阻塞保持。 |
| C7 | 已确认无需修改：PR #142 已在 base.css 的高优先级规则把未读改为 tone-brand-solid；直接继承，实测品牌蓝背景、白字与四宽截图通过。 |
| C8 | 已确认无需修改：PR #142 的8px滚动条与隐藏箭头已合入；真实溢出区几何宽8px、箭头display:none，截图通过，不重复覆盖共享规则。 |
| C9 | 已修改：联系人分页ghost、13px次灰、底部居中；仅游标存在时显示返回，next_cursor存在时显示下一页。分页请求与scope重置原样。 |
| C10 | 已修改：继续复用既有 TicketCard/Body，增加同一 CategoryTile、heatOf、StageGlyph；10px内边距、13px标题、隐藏底部处理人行；沿既有详情查询及当前页摘要抽屉。 |
| N1 | 已修改：业务域/渠道/结果共享胶囊。业务域ALL不显示权限术语；结果ALL仍准确显示失败及待核对，清除返回ALL，不扩大查询到成功通知。 |
| N2 | 已确认原因并修改：六条真实队列记录覆盖Ticket/Session、失败/UNKNOWN、三种route、1–3尝试。实际父Ticket有编号与长合成标题，DTO未投影该字段（见N3）；固定列/56px行高四宽通过。 |
| N3 | 已修改现有字段范围；完整目标未完成：来源链接用text-link，安全摘要单行省略，跳转不变。DTO缺编号/标题/报修人姓名，不能在本次边界内完成完整目标；不得记为已确认无需修改。 |
| N4 | 已修改：ghost下一页+右箭头，靠右；has_more=false隐藏。保留原游标、请求和零发送约束；更新原最后一页展示断言。 |

## 合成数据与原因证据

- C1：`seedCard21Conversation` 先创建独立「欧阳慧敏（合成）」/「心血管内科第二病区护士站（合成）」；最新备注超过60字。改前1920的列表项右缘579px，时间右缘743.53125px；第一轮只改grid后预览把fit-content链接撑到1226.53125px，见 `before-observation.json` / `layout-probe.json`。最终约束链接宽，再验时间右缘。
- C2：本次先观察原序号与时间，修正fixture中用户消息、工程师回复、备注及投影追加记录的时间。四条用户/回复消息为昨天16:40、16:52、今天09:10、09:30；第三条为Bot私聊回复。内部备注09:35、系统记录09:40，同序号时间非降序。服务端source_label同时包含渠道和记录分类，是额外分隔线的原因；前端只提取既有群/私聊标签，不据内部备注推断渠道。
- C3：旧脚本 `D:/CodexEvidence/pc-admin-v211-card19-20261103/capture.mjs` 通过 internal-notes 发送以「内部：」开头的正文。MessageBubble 自带「内部」标签，Inbox 又加「仅内部可见」，合成时成为三重表达。本卡保留正文原样，并追加另一条确有前缀的真实备注检验无剥离。
- S11/N2：`seedCard21Exceptions` 沿既有 appendCommunication / transactionP2016 / ticket_notification_binding fixture 写法，以及实际 worker + 合成 Sender 产生结果；六条记录为4个Ticket + 2个Session，三种route，尝试1–3。没有新迁移/SQL文件/产品数据路径。真实父Ticket标题带（合成），页面只能显示合同中的安全摘要。

## 中间验证与调整（原件不回写）

- `frontend-types-initial.log`：可选 isDisabled 需要显式转 boolean；修正后前端类型通过。
- `stylelint.log` / `stylelint-fixed.log`：新组件表达式及Token命名未满足已有 shadow-/fs-命名门禁；最终改为组件Token，未放宽规则。
- `visual-initial/`：第一轮真实渲染，发现链接fit-content撑宽与默认箭头实际使用 select-default-indicator；在共享/会话作用域修补。
- `direct-initial.log`：独立执行脚本未声明测试库隔离，运行前被拒绝，未执行测试；补齐既有环境标识。
- `direct-initial-2.log` / `direct-initial/`：通知用例把 Select.Trigger 传给需要根节点的 chooseWorkbenchSelect，超时，1 FAIL；会话入口NOT_RUN。仅修正新增用例的选择器层级。
- `direct-confirm/`：通知新用例PASS；会话新用例在第二个宽度尚未完成异步摘要读取时检查阶段，1 FAIL。增加摘要就绪等待，阶段/热度断言保持。
- `selection-preflight-mvp.log` / `impact-plan-mvp-preflight.json`：首次差异计划将新增断言所在、未被路径正则命中的 Inbox 文件归入fallback MVP（53入口），因未配置H5 FFmpeg在执行前拒绝，53入口NOT_RUN。随后将**本轮新增断言**集中至已登记且精确匹配PC的 `wbint-t22-conversations.browser.test.mts`，原Inbox测试内容恢复且作为直接风险额外完整执行；未改测试策略、注册库存、业务断言或生产文件范围。最终实际差异重新生成core/docs/notification/pc计划（35入口）；不声称原53入口通过。
- 第一个最终候选35入口178/178 PASS，绑定输入指纹 `43f0112a31b290d1b9ebefb692c2e212204963d1072f9c20568a24c1ee844d0e` / manifest `fa761ddf4d97ff4176305bfefbf564ea4869691161126044c651c0da06be59bf`，原件 `selection-final/`。
- 收口自检补修G1：来源×原先复用了会同时删除来源群的旧选择处理器。现在×只删除source参数，保留source_group_ref、队列与其它条件；原选择来源时重置来源群的逻辑保持。新增真实Select选择来源群后清来源的精确断言。后继候选重新构建与执行，结果独立记录，不将前一候选通过重绑。
- `supplement-controls.log`：几何补测首次选到隐藏窄屏菜单内的同一迷你卡，BCR为0；仅修正外部度量脚本为当前可见卡片。`supplement-controls-fixed.log` 中BCR水平/垂直内边距10px通过；未修改产品迁就度量。


## 前轮本地交付（离线补验前）

验证对象是此分支的未提交工作区，不是基点提交本身。最终源码输入指纹 `0057b764124dcae004312a1a06e2acaec72bee38ebec7d527b2f1cd734bab58e`，manifest SHA-256 `038c2f17ecfa526dc3b8d4f426d367cbed9859d9f8a16a447ff48b95275c3d61`，Node24.18.0 / PG18 / Windows / Chrome正式生产bundle。三个页面共享同一FilterChip；C7/C8继承已合并卡20，不重复改共享底层。

| 检查 | 实际结果 |
| --- | --- |
| Stylelint / ESLint | PASS，均0；stylelint-delivery.log、eslint-delivery.log；最后仅清除回调/测试选择修补，gate中对应lint再次通过 |
| `migration:build` | 最终候选PASS，build-option-test-fix.log；每个修改后的候选各一次统一应用构建，中间失败/旧候选日志保留 |
| `gate.mjs types` | 最终候选PASS，types-final-candidate.log；strict、前端、Token变量、feature-syntax与负向类型均通过 |
| `verify-artifact.mjs` | PASS，artifact-final-candidate.log / artifact-last.log，STAGED_NOT_ACTIVATED |
| 所选业务/浏览器 | **35入口178/178分段通过**：A批前25入口134项，B批后10入口44项；0最终失败/取消/SKIP/TODO/未运行。不是一次full，不是单次同manifest运行 |
| 对象一致性 | test-only-byte-equivalence.json：2757个运行输出中只变更本次测试及map，其余2755项逐字节相同；A批25份源码及执行文件再次逐一核哈希匹配最终工作区 |
| 新增清除断言 | PASS：真实Select选择来源群，再清来源×，source_group_ref和队列保留，source回到all，浏览器业务POST=0 |
| 四宽与控件补测 | PASS；当前候选重拍16张，另有空态4张及控件4张，生成16张历史对照；C1时间不越界、日期顺序、单内部标签、迷你卡、固定列与行高、三页标题坐标均通过 |
| C9多页与G1 Tab | PASS：额外31位分页联系人，真实30条首页→末页→首页；首页仅下一页、末页仅返回最新，均ghost/13px；Tab确实到×、Enter清除回焦 |
| 文档 | 修改MD链接、agents检查及既有工具测试20/20 PASS；纯记录后继不重建应用 |
| Impeccable detector | 输出[]；最后回调/测试修改不新增样式，未重复运行检测器 |
| CI / full / certify / Electron / 真实发送 / 现场写库 / 部署 / Gate | NOT_RUN，均未启动或授权 |

A批原件 `selection-source-clear/`：该轮实际136项，135 PASS、1 FAIL，后9入口NOT_RUN；失败是新增测试选择了原生空占位选项，未到达目标群项。原FAIL/NOT_RUN不回写。仅将新测试改为等待并跳过空占位；B批 `selection-completion/` 的10入口44/44 PASS。合并摘要 `completed-selection-summary.json` 与 `delivery-json/validation.json` 按唯一入口汇总A批前25+B批10，并保留各自manifest。第一轮较早候选完整178 PASS仍只绑定其原对象。

### 尺寸与截图

完整四宽尺寸表、前后对照、跨日顶部与备注底部分图在[证据索引](../../docs/ui/evidence/v212-card21/README.md)。BCR固定值均在±1px范围：胶囊30、箭头12、可选图标14、姓名行间距8、搜索32、迷你卡padding10、通知行56；字体值另以computed style核验：迷你标题13、值字重600、分页13。

三页h1左上在1920/1440为(300,64)，1280为(292,64)，900为(44,64)，标题区底到下一行均12。通知四种固定120列、时间140、操作80；来源宽548.406/436/292/240，占39.855%/38.380%/29.435%/25.532%。1920联系人时间567≤行579，1280为559≤571。900按原响应式隐藏联系人列，不能把其0坐标冒充C1可见边界证明。

### 文件清单

| 文件 | 范围 |
| --- | --- |
| [FilterChip.tsx](../../app/pc-admin/src/design/components/FilterChip/FilterChip.tsx) | G1，共享Select组合、三态、单条件清除和回焦 |
| [filter-chip.css](../../app/pc-admin/src/design/components/FilterChip/filter-chip.css) | G1，30px/12px/14px及三态Token |
| [Workbench.tsx](../../app/pc-admin/src/app/Workbench.tsx) | G1，仅导入与两个胶囊调用；其它区块未动 |
| [ConversationInbox.tsx](../../app/pc-admin/src/features/conversations/ConversationInbox.tsx) | C1–C6/C9/S10，布局、日期/渠道、标识、筛选与分页 |
| [ConversationAssociatedItem.tsx](../../app/pc-admin/src/features/conversations/ConversationAssociatedItem.tsx) | C10，复用类别/热度/阶段及原抽屉 |
| [Conversations.tsx](../../app/pc-admin/src/features/conversations/Conversations.tsx) | G1/S10，旧入口同样共享胶囊、无副标题 |
| [conversations.css](../../app/pc-admin/src/features/conversations/conversations.css) | C1/C3/C5/C6/C9/C10/S10，限会话作用域 |
| [NotificationExceptions.tsx](../../app/pc-admin/src/features/notification-exceptions/NotificationExceptions.tsx) | N1/N3/N4，胶囊、现有来源链接、按需分页 |
| [notification-exceptions.css](../../app/pc-admin/src/features/notification-exceptions/notification-exceptions.css) | S10/S11/N2/N3，固定列、40%上限、56px与链接样式 |
| [conversation-inbox-fixture.mts](../../tests/helpers/conversation-inbox-fixture.mts) | C1/C2/C3，opt-in长资料、连贯时间及内部正文 |
| [t32-notification-exception-fixture.mts](../../tests/helpers/t32-notification-exception-fixture.mts) | N2，opt-in六条真实队列记录与合成Sender |
| [wbint-t22-conversations.browser.test.mts](../../tests/wbint-t22-conversations.browser.test.mts) | 新增卡21断言；旧业务场景及原断言保留 |
| [wbint-t32-notification-exceptions.browser.test.mts](../../tests/wbint-t32-notification-exceptions.browser.test.mts) | 新增卡21断言；末页按钮只改展示断言 |
| [design-system.md](../../docs/ui/design-system.md) | 共享FilterChip及气泡内部标签规范 |
| [design-system-v2.1.md](../../docs/ui/design-system-v2.1.md) | 卡21尺寸、渠道/日期、分页、迷你卡和投影限制 |
| [README.md](../../docs/ui/evidence/v212-card21/README.md) | 40张PNG（16对照+24场景）、四宽尺寸与来源说明 |

本记录为新增文件；结构化度量、哈希与原始报告保存在 `D:/CodexEvidence/pc-admin-v212-card21-20261104/delivery-json/` 等原件目录，不把JSON工具原件加入产品或文档发布路径。主工作区用户原件、历史v211/v212-card20截图均未改写。原Inbox测试Git blob与断言内容已确认未变，且没有暂存差异。

### 自检（逐条是/否）

| 用户自检项 | 是 / 否 + 证据 |
| --- | --- |
| 仅前端展示/测试合成数据，无后端/合同/命令/状态/权限修改 | 是：差异仅上述路径及文档/PNG；server/contracts/database/package无差异，原业务回归与请求/次数断言通过 |
| 仅沿既有fixture写入，无新迁移/SQL文件，虚构内容带标记 | 是：addInboxSession/Journey、原真实命令、appendCommunication/绑定fixture及worker；新增姓名/科室/标题/分页联系人均合成 |
| 测试选择器只增不删，旧断言未放宽 | 是：旧Inbox blob不变，T22旧场景原样；T32只把末页按钮disabled改为隐藏，10→1条分页、精确GET、11次Sender、POST=0、隐私断言保持；新增断言另加 |
| 样式经Token，Stylelint/ESLint为0，无新依赖 | 是：无tokens.css改动；新组件局部变量组合现有Token，颜色为语义引用，package/lock未动，lint/类型通过 |
| 仅本卡文件范围 | 是：Workbench只有导入与两处筛选调用；未改BoardColumn/BoardSummary/Drawer/tokens/base/shell，无其它区块重排 |
| 每编号有结论，先补数据项有观察/原因 | 是：上表17行及数据原因；N3完整目标未满足，明确保留字段投影缺口 |
| 像素验收有BCR实测 | 是：四宽表与control-metrics原件；字体/色值另外标明computed style，没有将隐藏节点0值作可见证据 |
| 卡21全部目标已实现 | **否：N3缺工单号/标题/报修人姓名；本轮未获后端/合同变更授权。** 原型完整画板在前轮未核验；本次已按用户指定离线文件补验，正式范围见文末，不追认前轮 |

### 规范、限制与回退

规范新增FilterChip规格，并前向明确日期/渠道、锁标记、系统时间、默认队列、局部清除、迷你卡、列宽和分页。来源×只清来源；普通选择来源仍沿原处理器重置来源群。N3后继需先获得独立只读投影字段，不能解析safe_summary或用逐行父请求绕过本卡边界。无新业务功能、依赖、全局Token或持久开关。

回退仅反向应用本worktree所列源码/规范/测试差异并处理本卡自有新增组件，主工作区不受影响；历史截图、失败与本轮证据保留。没有数据库迁移或生产数据回退。

### 资源与停止点

所有fixture的UUID合成库已删除，PG仅剩postgres；自有PG停止exit=0、status=3，53651无监听，按本任务路径匹配的node/postgres/Chrome/Edge为0；浏览器ownedResourceState均已断言归零，见cleanup-final.json及各原TAP。

保留独立worktree/分支、node_modules junction、最终构建、已停空PG目录与全部原始Evidence供复核。未提交、未推送、未建PR；用户要求的本地停止点已执行。逐编号表可直接复用于后续PR说明，但本次没有发布PR。

补充保全：三个中间浏览器失败目录的PNG/JSON已逐字节归档到 `D:/CodexEvidence/pc-admin-v212-card21-20261104/failure-screens/`，来源→归档映射与SHA-256见failure-source-map.json；原临时路径未改写。


## 2026-11-04 离线正式画布补验（已完成）

用户补充指定主工作区的v2.1.1离线原型，并两次明确口径：正式基准只用01–05（含04b）；列头只以01为准；06、07、08全部属于讨论稿，不参与验收。原文件SHA-256为 `cd4d51460e8c9e2e4136892b969f4af40d8369cd0ba419eecbe28d2d62e1ce7c`，只读使用。

本次发现原文件含9个完整gzip/base64子画板，各自又内嵌脚本/字体资源。上一轮将外层about:blank引用解读为画板缺失，判断不完整；该限制已撤回，原始日志/截图/被测身份仍保持历史含义。本次完整解包、渲染正式6页并保存全页截图和原始像素对照。

新增验证风险与停止条件：补齐原型内容未检查的缺口；正式6页能渲染、列头仅与01核对、05色值核对、共享胶囊几何/三态及四宽重验，保留原业务断言。发现G1可选图标/间距与01不一致，仅改FilterChip CSS及新增测量断言；所有业务请求/状态/权限、后端/合同/依赖及BoardColumn/Drawer源码保持。新候选按原35入口计划验证，不扩到full/certify。

首次新增测量表达式把map返回的数组再调用一次，导致本次selection/中1 FAIL、1 PASS，其它34入口NOT_RUN；仅修正新增断言字符串，原结果保留。独立浏览器几何探测已验证11px首图标偏移、6px间距、处理人99×30、列头77×26。后继修正和最终结果见下文，原失败不回写。

原件目录：`D:/CodexEvidence/pc-admin-v212-card21-20261104/offline-canvas-audit/`。正式参考截图及对照位于[离线验收索引](../../docs/ui/evidence/v212-card21/offline-reference/README.md)，不发布06–08作为验收模板。


### 离线补验最终结果

正式基准01–05（含04b）共6页已完整渲染，06–08均排除；列头只对01。原件SHA-256已再次核对不变。新候选输入 `f216f9dcb91ce8dced635997037c551f8c45fa112616296f5ddb9cfda4975ff7`，manifest `2b05fcc44c2eddb41901f570da3456501197bad324f946c9cab5c5bea76a26ed`；本轮35个所选入口**单批178/178 PASS**，0失败/取消/SKIP/TODO，NOT_RUN空。此结果独立于前轮分段通过，不重绑旧manifest。新候选build、gate types、Stylelint/ESLint、制品校验均通过，detector输出[]。

新产品代码只改FilterChip CSS：未生效图标/名称/箭头间距6px；内部描边对齐补偿；生效态隐藏可选图标，从名称起排；名称使用独立flex行框垂直居中。原Select、clear回焦、独立×、URL、所有控制器/请求/权限不变。新增测试断言覆盖11px图标偏移、6px间距、文字中心误差≤1px，以及01三种列头77×26/13px/600；未删除或放宽旧业务断言。

原生Select在异步列表刷新时会重建，新增验收过程曾在等待后第二次读取options时遇到null；改为在同一次waitFor中返回非空群引用，未放宽群引用保留/状态/请求断言。该轮selection-final的1 FAIL/1 PASS及其余34入口NOT_RUN保留；最终selection-calibrated整批35入口通过。

产品实测：[离线验收索引](../../docs/ui/evidence/v212-card21/offline-reference/README.md)。处理人胶囊99×30；「类别 网络与连接 ×」135×30；值600，×距右边9px；6页参考、配对/叠加、4宽最新截图均保留。39项阶段/品牌/已分类色值一致；加未分类2项共41项，40项一致，未分类底色按卡17具名覆盖保留。原始整页像素不相同：文本/业务状态、v2.1.2具名变更、N3字段缺口、字体环境和既有全局规范差异均列明，不能把几何通过写成整页零像素差异。

规范已明确列头01唯一来源，05仅用于色值，06–08排除；03静态导出在给定宽度下的关联栏换行不用于覆盖已授权的信息架构。原“本地画板缺失”限制撤回，前轮实际验证身份/失败/NOT_RUN保持。原件与结构化结果集中在 `D:/CodexEvidence/pc-admin-v212-card21-20261104/offline-canvas-audit/`，不增加依赖、不新增后端/合同/迁移或真实投递。

本轮资源关闭：fixture合成库全部删除，仅剩postgres；PG停止exit=0、status=3，53651无监听，任务范围进程0，见offline-canvas-audit/cleanup.json。两次新增验收脚本失败截图/JSON已按失败事件时间、任务临时目录及loopback工作台URL核对，逐字节归档到offline-canvas-audit/failure-screens，来源映射见failure-source-map.json。原型原件哈希不变，工作树、分支和制品保留，未提交/推送/建PR。


## 发布续记（2026-11-04）

用户追加明确授权提交卡21最终改动、HTTPS推送、按pr技能模板创建PR并请求`@codex review`；发现P1/P2则修补并继续复审，无major且适用CI通过后合并，再快进main并清理本任务已合并的本地/远端分支及worktree。此授权替代前面的本地STOP限制，不改变真实发送、现场、部署或Gate边界。

发布基点经HTTPS fetch仍为 `f8959042ecf9e596a79cbb249ec7932451805ddb`。本地最终校准35入口178/178、原始失败与旧manifest保持原对象；本次提交后的CI和审查以GitHub当前完整head独立核验，不重绑旧tested_head。N3完整字段仍缺只读投影，本PR仅交付已验证的展示范围；原型正式范围为01–05（含04b），列头01，06–08排除。

发布/审查/合并/清理回执集中于 `D:/CodexEvidence/pc-admin-v212-card21-publish-20261104/`。保留主工作区5份用户原件、stash及全部既有recovery/checkpoint引用；只删除本任务已合并的分支/worktree，不扩展清理其它来源。

### 发布CI诊断与测试修正

初始提交 `617998a7b7973c8672b5ab2166d26d522e3bb4d1` 已推送并创建 [PR #143](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/143)，按pr模板逐条引用G1、S10、S11、C1–C10、N1–N4。首轮 `@codex review` 对该完整head已完成，未发现major或其它findings；该结果不替代后继测试修正的重新审查。

同一head的 [CI运行](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/actions/runs/41783997700) 保留两次失败，不改写成通过：attempt 1为111 PASS/1 FAIL、15入口NOT_RUN，T35在真实ACK丢失后的抽屉重挂载阶段等待原COMMITTED回执超时。本地原路径及受控动画观测均未复现；attempt 2的T35自然通过，尚不能据此确认根因，未修改已读控制器、UUID、请求或回执断言。attempt 2继续执行到本卡新增列头断言，124 PASS/1 FAIL、9入口NOT_RUN，固定77px总宽在Linux环境失败；其CI浏览器截图显示中文字形缺失，而产品列头宽度本就由文字、14px图标、6px间距和8/10px内边距组成，并非固定77px。

本次只修正新增的视觉断言：等待字体就绪和两个绘制帧，分别断言实际总宽=实际字宽+38px（±1px）、26px高、14px图标、6px间距、8/10px内边距、13px/600。字体回退不会改变这些设计几何约束；原Windows四宽三种列头均再次实测77×26，文字39px。只改T22新增场景和本执行记录；BoardColumn、Token、产品代码及原业务断言均不变，没有任意sleep或业务断言放宽。首轮失败和未执行范围、两份完整CI制品与日志均已保存到发布回执目录。

修正候选输入 `88f50afe8f519b9ae87bacb28b59382a7f53a8014bfe08cf4d45665b864fd489`，manifest `27bced16209e56608925f895861cf6f751d31660978d1a463c1a4af39b252fb3`；统一构建、gate types（含Stylelint/ESLint）、verify-artifact通过。当前直接风险检查T22两个场景+原T35共3/3 PASS，0失败/取消/跳过；新head完整路径CI独立执行，不用此3例或旧178例替代。四宽测量在发布回执的fix-visual/conversation-metrics.json；合成库已清空，仅剩postgres，PG停止成功。后继审查/CI/合并/清理结果按实际head记录在同一外部回执目录。


## N3后继票（2026-11-04）

用户已授权独立补齐[N3 #144](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/144)，规格及验证见[N3执行记录](n3-source-projection.md)。该票扩展原只读合同及其真实来源；本卡上述“未提供编号/标题/姓名”的结论保留为当时事实，不重绑旧截图/测试对象。另有[绿色旧版退役 #145](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/145)原生依赖#144；退役以新PC现有流程为准，不补回旧业务流。
