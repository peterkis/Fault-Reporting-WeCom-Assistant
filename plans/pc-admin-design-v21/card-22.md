# 卡 22：v2.1.3 正确性与细节收尾

2026-11-04启动，2026-11-05本地交付；R1–R6验证通过，未提交、推送或创建 PR。

- 基线：最新 `origin/main`，`6e2553888f0923248827173fa54ef2456d2c0cae`。分支 `codex/pc-admin-v213-card22`；独立 worktree `D:/worktrees/pc-admin-v213-card22`；唯一写者为当前会话。
- 问题来源：用户附件《医小修 PC 端 v2.1.2 验收报告（卡20 / 卡21）》及本次 Prompt。R1、R2 为 P1，R3–R6 为 P2；冲突以 Prompt 为准，active 缺少 `stage_entered_at` 时无热度。
- 影响：共享 Avatar、热度展示/概况过滤、会话分隔线和禁用态、FilterChip、通知表格列宽；只改前端、相关测试/合成 fixture、规范和证据。
- 原始检查与失败保存于 `D:/CodexEvidence/pc-admin-v213-card22-20261104/`；截图归 [卡22证据](../../docs/ui/evidence/v213-card22/README.md)。HEAD 仍是基线，不把未提交 tree 叫作已提交 tested_head。
- 最新 main 已包含 N3 只读来源投影；本卡保留现有字段和来源，不拼凑资料。N3 本卡未处理：报告中的历史契约缺口已由基线后继完成，不能将当前事实写回旧报告。
- 用户确认通知异常页没有搜索框，不新增功能；R5 该页只测 chip 高度/居中，搜索框对齐为不适用。

## 执行与停止条件

先补 R2 a–e 和 R4 两账号的合成场景，在原产品实现上观察；再修复。依据 ADR-0053 按实际差异选择 pc/core/read-safety 既有入口，并补直接受影响的会话/通知/热度/头像断言。所有适用检查通过、用户指定几何和状态场景关闭后停止扩验。不运行 full/certify、Electron、真实投递、现场业务写库、部署或 Gate。

| 编号 | 结论 | 现象 → 原因 | 位置与修改 | 验收 |
| --- | --- | --- | --- | --- |
| R1（P1） | 已修改 | 合成后缀的右括号被当成头像字 | Avatar 新增纯函数 avatarInitial；trim、循环剥离后缀、拉丁首字母、Unicode末字及空值回退；原名 aria-label/title 和颜色哈希保持；会话传原名 | 10组取字输入单测；工作台/抽屉/会话全部 fallback 不含括号；四处实际头像局部及输入区现状见证据 |
| R2（P1） | 已确认原因并修改 | 旧计数限制 ticket/pending，与处理中及 review 红卡不同 | heat.ts 集中 cardHeatStart/cardHeat；三个展示调用方和 summary共用；active 空起点无热度；更正 tooltip | a–e单测、真实投影及浏览器热度；2张红卡=2，额外review红卡后3=3，点击集合完全一致 |
| R3（P2） | 已修改 | 同一index日期、渠道分别渲染li | ConversationInbox合并同一index；日内切换独立保留；Split共用发丝线与间距，点用tertiary | 2条「昨天」「今天 · 切换到 Bot 私聊」；日内回群后3条；8/20px外边距与1px线条相同 |
| R4（P2） | 已确认原因并修改 | 侧栏只读开关独立；真正无回复能力时禁用正确但样式透明 | Composer仅加原因/展示属性；Split Token禁用态、隐藏字数、定向压缩空禁用框，权限与控制器不变 | 双账号真实capabilities；disabled、原因可见、背景=bg-subtle；原未接待半屏与写入/UNKNOWN回归保持 |
| R5（P2） | 已修改 | chip高度30px，文字行框与搜索不一致 | 共享FilterChip使用control-h-md、line-height:1、值上下padding为0；24px清除居中 | 三页1440实测，32px、文字中心0；工作台/会话top/bottom差0；通知页无搜索框，用户确认不适用 |
| R6（P2） | 已修改 | 来源是唯一弹性列 | 通知CSS改0.6/1/0.6三弹性列及928px最小表宽；保持列序；既有图标库14px图标、类型省略及title | 1440/1920来源15.08%/17.20%，类型最宽；900可横滚、nowrap且无重叠；无发送/重试/父级扇出 |

## 先补数据与改前观测

R2 使用 `seedCard22Board` 的 opt-in 场景，默认 fixture 不变；通过原 helper 的 `pool.query` 修改本任务 UUID 合成库中的已有记录，无新增迁移/SQL 文件。a 为26小时前创建的待处理，b 为5小时前进入当前状态的处理中，c 为30分钟前进入当前状态的处理中，d 为2天前创建且无有效当前阶段事件的处理中，e 为3天前创建且今天完成。标题统一 `R2-a`–`R2-e 热度验收（合成）`。d 的原事件在合成场景中改为同状态记录，使真实投影得到 `stage_entered_at=null`，未伪造 HTTP 返回。

- 原产品 bundle：tab **1**，红卡 **2**（a、b）；c 为 warning，d、e 无热度。
- 将同一合成库中待复核项的创建时间设为5小时前后：tab 仍为 **1**，红卡为 **3**（review、a、b）。非 ticket 的 review 实际显示 danger，因此统一计入；不保留 `kind==='ticket'` 限制。
- 原因：旧 `matchesBoardSummary` 同时限制 ticket 和 pending，只读 `created_at`，与卡片渲染不同。修改为唯一的 `cardHeat` 判断；active 空起点不回退。数字、红点、点击过滤仍由既有 BoardSummary/Workbench 调用同一 `matchesBoardSummary`。
- 原件：外部回执根 `before-observation.json`、`observe-before-final.log`、`before/R2-*.png`；R2 单元 RED 在 `R2-unit-red.log`，修复后61个基础单元用例通过，见 `unit-green.log`。

R4 使用 `seedCard22Conversation` 复用卡21跨日真实消息/原接待命令，为已有合成人员设置明确显示名。两账号读取同一会话的真实 `?view=chat` 投影，工作台协作开关均关闭；未伪造 capabilities。

| 合成账号 | 原 capabilities | 改前 textarea | 改前背景 / 字数 | 结论 |
| --- | --- | --- | --- | --- |
| 林舟（合成） | 含 REPLY、INTERNAL_NOTE | enabled | 透明 / 显示 | 侧栏「只读」描述工作台开关，回复实际获权；保持原逻辑 |
| 只读值班（合成） | REQUEST_HANDOFF、TRANSFER、VIEW，不含 REPLY/INTERNAL_NOTE | disabled | 透明、外层白底 / 显示 | 当前 READ 合法，但无回复/备注能力；禁用视觉和原因缺失 |

修改只增加展示属性、对应原因行、Token 禁用样式并隐藏字数；`allowed`、`awaitingReception`、busy、UNKNOWN、提交条件、请求、回执及原 UUID 控制器保持。实际无权限背景已测得 `rgb(247, 247, 245)`，等于解析后的 `--bg-subtle`；原因可见、发送禁用。内部备注分别显示原因。原件为 `before/R4-*-1440.png` 与改后结构化测量。

## 已保留的中间失败

- 内置预览连接拒绝（native pipe bridge 不可用），没有调用其它机制控制该预览；改用仓库原有系统 Chrome helper执行本地测试。
- 最初 R2 d 选中了 ACCEPTED 记录，其实际属于 pending，tab 为2。修正选用 IN_PROGRESS 记录；保留 `observe-before.log`，没有修改状态到列的业务映射。
- R4 首次用普通 handler 读取新增主题时真实 READ 返回拒绝，等待超时；保留 `observe-before-2.log`、`observe-R4-before-3.log` 与失败截图/JSON。最终使用有 READ、但无回复/备注能力的合成 DISPATCHER；不修改产品授权逻辑。
- 前端预检拒绝在 HeroUI TableCell 上传原生 `title`；改在单元格内文本节点提供全文提示。首个最终构建 strict 拒绝截图辅助的 unknown 返回；增加运行时字符串守卫。原件 `frontend-types.log`、`build-final-1.log`。
- 首轮三个新增浏览器场景均被 R5 测量拒绝：选择器同时抓取了隐藏的无障碍标签和实际 trigger 文本，中心差为 -7 / 0px。仅将测量限定到 trigger 内可见 label/value，保留≤0.5px阈值；`direct-1.log` 与该轮原件完整保留。这不是产品文字居中失败的证据。
- 首次29入口批次在会话文件得到8 PASS / 1 FAIL，后28入口 NOT_RUN：900下未接待、恢复提示开启时，新增说明使消息区从551.78px缩为525.78px，低于原半屏540px断言。实测说明继承了4px上下外边距；保留原因行，定向复位外边距，并仅将有原因、禁用且为空的 textarea 收至已有48px Token。有内容或 busy/UNKNOWN 编辑器不受该收紧规则影响；没有放宽半屏断言。原件 `selection-final/`、`waiting-layout.json`、`waiting-before-900.png`。
- 随后两次计划预检选中60入口，但因缺少H5媒体工具绝对路径在执行前拒绝，60入口均NOT_RUN；原件 `selection-complete.log`、`selection-verified.log`、`impact-plan-extra-assertion.json`。新增的接待原因断言原本临时放在策略未覆盖的 `conversation-inbox.browser.test.mts`，触发未知路径的MVP回退；最终把它归入本卡已修改且已注册的 `wbint-t22-conversations.browser.test.mts`。原会话文件恢复原字节语义，并作为直接风险入口完整保留在最终29集，原900半屏断言及9个原用例继续执行。没有修改路由/策略或安装依赖。曾复制入仓库的3份测量JSON也已逐字节核对外部原件后去重，原始测量继续留在回执根，仓库保留截图与Markdown实测表。


## 规范与范围说明

- `docs/ui/design-system.md` 更新 Avatar 取字、热度起点与统一 cardHeat、会话分隔线与禁用态、FilterChip Token规格。`card-21.md` 追加前向分隔线公式；旧3条记录及截图保持历史含义。
- 用户在本次会话追加授权：只更正 `BoardSummary.tsx` 的过时 tooltip；只在 `NotificationExceptions.tsx` 增加来源图标与通知类型全文提示。这两处是原白名单外的具名最小展示修改，未触及请求、字段来源和权限。
- **N3：本卡未处理。** 附件中的「契约缺口」是历史事实；最新基线已包含 PR #146 的只读来源投影，本卡没有再扩展后端或合同，也没有删除/拼凑现有工单号、标题及报修人。原报告与卡21旧证据不回写。
- 会话输入区当前实际没有 Avatar DOM（实测0），所以只交付真实输入区局部及会话头部头像局部，不为截图新增头像功能。

## 文件清单

前端展示层（均位于 `app/pc-admin/src/`）：

- `design/components/Avatar/Avatar.tsx`、新增 `design/components/Avatar/avatarInitial.ts`。
- `design/heat.ts`、`design/board-presentation.ts`、`app/Workbench.tsx`、`app/WorkbenchDetail.tsx`、`features/conversations/ConversationAssociatedItem.tsx`（三调用处仅热度计算）。
- `features/conversations/ConversationInbox.tsx`（仅头像原名与分隔线）、`features/conversations/ConversationComposer.tsx`（仅禁用展示）。
- `design/components/Split/conversation-v21.css`、`design/components/FilterChip/filter-chip.css`、`features/notification-exceptions/notification-exceptions.css`。
- 追加授权的 `design/components/BoardSummary/BoardSummary.tsx`、`features/notification-exceptions/NotificationExceptions.tsx`。

相关测试及合成数据：

- `tests/pc-admin-design-foundation.test.mts`、`tests/pc-admin-card12.browser.test.mts`。
- `tests/wbint-t22-conversations.browser.test.mts`、`tests/wbint-t32-notification-exceptions.browser.test.mts`；原 `tests/conversation-inbox.browser.test.mts` 无差异，作为直接风险额外完整执行。
- `tests/helpers/web01-workbench-fixture.mjs`、`tests/helpers/conversation-inbox-fixture.mts`、新增 `tests/helpers/card22-presentation.mts`。

规范、执行记录和证据：`docs/ui/design-system.md`、`plans/pc-admin-design-v21/card-21.md`、本记录及 `docs/ui/evidence/v213-card22/`。完整逐文件清单、截图hash与路径边界检查随最终本地回执交付。

## 七项自检

| 项目 | 答复与证据 |
| --- | --- |
| 前端展示及合成测试范围，没有后端/合同/业务命令/状态/权限改动 | 是。Git差异的禁止路径集合为空；Composer原allowed/submit/disabled表达式、请求/回执/原UUID保持。 |
| 既有fixture写入方式，无新增迁移或SQL文件，虚构内容标（合成） | 是。seedCard22Board与seedCard22Conversation均复用原helper的query/upsert写入，仅操作本任务UUID合成库。 |
| 测试选择器只增不删，未放宽业务断言 | 是。保持已有DOM钩子；按R2/R3/R5/R6明确规格同步旧热度、分隔线及尺寸期望并新增断言。原状态/权限/请求/回执/次数和900半屏断言保留。视觉期望的同步不伪称为只改文字。 |
| 样式经Token，Stylelint/ESLint为0 | 是。没有修改tokens.css、依赖或新增Token；最终types gate含两项lint。原始独立lint日志均exit0。 |
| 只改允许路径和行 | 是，含本会话具名批准的两处最小扩展；Workbench/Detail/AssociatedItem仅热度计算。未修改列序、Toolbar/看板/抽屉布局。 |
| 各编号有结论，先确认项有数据/观察/原因 | 是。R1–R6表与R2/R4改前观测、原始失败分别记录。 |
| 像素要求有getBoundingClientRect实测 | 是。[证据索引](../../docs/ui/evidence/v213-card22/README.md)列出R5/R6原始数值与JSON，不以截图替代断言。 |

## 限制与回退

仅本地合成 HTTP/PG/Chrome 验证；不等于现场接受或生产就绪。full/certify、Electron原生、真实发送、现场业务写库、部署与Gate均NOT_RUN。没有提交、推送或创建PR。后续可按上述文件清单撤回本卡未提交差异；无迁移或运行配置回滚。保留工作树、分支、原始失败、NOT_RUN和用户原件；只关闭本任务的浏览器、HTTP及PG资源。


## 最终验证与本地交付（2026-11-05）

最终候选仅含本卡未提交差异，HEAD仍是基线。输入SHA-256 `2186a3598a76d54c182e72eee3188e94eb30c9d04e6e56db7fbbb8f853a1270f`，manifest SHA-256 `35670741c5c569143f08d19f31f469e9af20cc32d6b04fef574e8f7858d56397`。路径计划为core+docs+pc；原会话文件与基线内容一致（忽略Git EOL表示），仍完整纳入直接风险集合。

| 检查 | 最终结果 | 外部回执根中的原件 |
| --- | --- | --- |
| migration:build | PASS；920个编译模块语法检查通过 | build-final-5.log |
| gate.mjs types | PASS；strict/负向类型及前端检查 | types-final-5.log |
| Stylelint / ESLint | 0；最终types gate包含两项 | types-final-5.log；独立stylelint.log / eslint.log |
| 最终所选回归 | **29入口178/178 PASS**；0失败/取消/SKIP/TODO，NOT_RUN空 | selection-local-final/summary.json、result.json、逐入口TAP/trace |
| 本卡场景与原未接待场景 | 4/4 PASS，和178不相加 | direct-4.log、direct-4/ |
| 基础单元 | 61/61，含R1十组输入及R2 a–e；已包含在178中 | 最终基础单元入口TAP |
| verify-artifact.mjs | ARTIFACT_VERIFIED_NOT_ACTIVATED | artifact-final.log |
| 文档链接 / 工具 | PASS；工具20/20 | docs-check-final.log、docs-tools-tests.log |

R5/R6完整实测见[像素表](../../docs/ui/evidence/v213-card22/README.md)。R4后继900实测消息区545.78125px（原门槛540px），原因可见，空禁用框48px、说明上下margin0；`waiting-layout-final.json`保留原始矩形。原900失败525.78125px仍在旧回执，未降低或删除断言。外部报告生成脚本曾有Python关键字语法错误，在生成文件前拒绝；修正并通过语法预检后生成，不涉及产品候选变更。

资源关闭：fixture合成库已删除，仅剩postgres，其他客户端连接0；PG停止exit0、status3，54822监听0，自有进程0。保留分支/worktree、静态PG数据目录、全部原始结果与24张截图，用户原件及主工作区保持。来源清单为 `screenshot-inventory.json`，完整差异清单为 `changed-files.json`，关闭回执为 `cleanup.json`。

[本地PR描述草稿](D:/CodexEvidence/pc-admin-v213-card22-20261104/pr-description.md)按pr技能模板逐条列出R1–R6，仅供本地审阅，未创建远端PR。最终STOP于「本地验证通过 + 交付说明」。


## 发布授权续记（2026-11-05）

用户在本次会话明确授权：按pr技能提交并HTTPS推送卡22、创建PR并请求`@codex review`；P1/P2修复后复审，CI通过且无major后以merge commit合并，快进main并仅清理本卡已合并分支/worktree，保留证据及用户原件。该授权替代上文的本地STOP限制，不改变真实发送、现场写库、部署及Gate边界。

发布前HTTPS fetch与GitHub API均确认main为 `6e2553888f0923248827173fa54ef2456d2c0cae`，49项差异与已交付清单逐文件hash一致，原制品再次校验通过。主工作区6份未跟踪原件和151个Git引用已做保护快照；不清理其它任务资源。

原本地29入口178/178、4/4、失败/NOT_RUN及旧manifest保持原候选身份，不重绑tested_head。新提交的CI和审查按GitHub当前完整head独立核验。发布、复审、合并、main同步及清理的实际回执集中于 `D:/CodexEvidence/pc-admin-v213-card22-publish-20261105/`；最终结果见其中 `closeout-final.md`。原本地build-manifest与artifact-proof已按原字节保全，删除可重建worktree时不丢失其来源绑定。
