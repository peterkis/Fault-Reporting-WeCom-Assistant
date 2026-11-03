# 卡 19 · 全局文案与细节

首轮本地交付记录保持原对象与结果；2026-11-03 后续用户已明确授权提交、推送、PR、Codex 审查修补、条件合并和自有资源清理，见文末发布续记。

本轮仅做本地收尾。分支 `codex/pc-admin-v211-card19`，独立 worktree `D:/worktrees/pc-admin-v211-card19`，基线 `origin/main@c2ab09b518fe97e5b9b6b910455b66a5b746a02d`。未提交、未推送、未创建 PR。根工作区两份未跟踪用户原件、卡 17/18 的 worktree 均未改动。

## 解决的问题

| 问题 | 实施与证据 |
| --- | --- |
| P2-3 顶栏连接文案 | disabled「手动刷新」并保留刷新图标；connecting「正在连接」、live「实时更新中」、reconnecting「连接已断开，正在重试」。只修改标签，不改变连接状态或传输行为。 |
| P2-4 侧栏标语 | 移除「共同协作，清楚交接。」；没有全局在线同事数据，保留空白和原 `sidebar-note` 选择器，不新增请求。 |
| P2-8 会话标题 | 顶栏面包屑、两种会话页面标题与页面级 aria-label 均为「会话」。 |
| P2-9 日期、渠道与输入区 | 每个日期仅在该日第一条消息前显示一次；使用北京时间的「今天 / 昨天 / MM-DD」。渠道仅在实际切换时显示。复用 SegmentedControl，原两个 tab、ID、panel、控制器与草稿隔离保持；备注模式沿用整框浅黄 Token。 |
| P2-10 通知异常 | 红色警示条的「逐条核对」为 danger 前景色 ghost；空状态刷新为 secondary。原精确只读核对、前后导航和关闭回焦点保持。 |
| 文案扫尾 | 已先提交替换清单，用户明确回复「确认，按清单替换」。全 src 扫描命中 212 行，卡 19 会话/通知目录命中 22 行；其它目录、业务表单和其它卡的文字保留。 |

### 日期回跳的根因

原截图脚本 `D:/CodexEvidence/pc-admin-v21-card14-20261102/capture.mjs` 第 10、12、13 行先创建当天消息，再用 `daysAgo=1` 追加前一天消息，随后又追加当天消息。原 `appendT22LiveItem` 使用递增序号；因此出现 11/02 → 11/01 → 11/02，是合成数据的时间戳与插入顺序不一致。本卡不改数据、不重排消息，也不改变分页、序号、滚动和已读坐标；只去除重复日期标题。

本次验证继续复用原三条合成消息，独立记录数据库中的序号和时间戳；证据见下方验证原件。合成日期回跳仍然保留，不能声称本卡修复了数据顺序。

## 文件清单

- `app/pc-admin/src/app/Workbench.tsx`：仅 Shell 内侧栏标语、面包屑、手动刷新图标。
- `app/pc-admin/src/realtime/useRealtime.ts`：仅 realtimeLabels 文案。
- `app/pc-admin/src/features/conversations/ConversationInbox.tsx`：日期/渠道分隔、SegmentedControl、页面标签及已确认文案。
- 同目录 `Conversations.tsx`、`ConversationAssociatedItem.tsx`、`ConversationComposer.tsx`、`ConversationControl.tsx`：页面标题和已确认文案。
- 同目录 `conversations.css`：仅分段控件的既有 Token 样式。
- `app/pc-admin/src/features/notification-exceptions/NotificationExceptions.tsx` 与 `notification-exceptions.css`：按钮层级、danger 前景色、已确认文案。
- `tests/wbint-t22-boundary.browser.test.mts`、`tests/wbint-t32-exception-authorization.browser.test.mts`：各替换一个文案匹配片段；原业务断言与选择器保持。
- 本记录与 `docs/ui/evidence/v211-card19/`：合成渲染截图、对照与本次证据摘要。

## 验证

验证对象为上述基线上的未提交工作区；不把 HEAD 当作包含本卡变更的提交。Node 24.18.0，Windows，本任务自有 PG18 仅监听 `127.0.0.1:53649`；fixture 自建并精确删除 UUID 合成库，外部 Sender 为合成实现。

影响为前端展示、日期标题和分段组件组合；不改后端/Schema/合同/依赖/Feature Flag/权限/命令/请求。按 ADR-0053 采用 pc profile（pr-pc + pr-read-safety），追加原注册 Inbox、旧会话和 T32 的直接受影响入口，去重后 19 个文件。停止条件为所选入口、lint/types/artifact、四宽度直接展示检查通过，不扩展 full/certify。

未获提交授权，因此原 `pr-plan.mjs` base/head 计划如实保存为空差异；通过同一工具导出的 `planChanges` API 对实际 modified/untracked 路径生成本地计划，并通过既有 `runSelection` 执行。没有为制造 commit 差异提交或绕过 clean-head 运行限制。

| 检查 | 结果 |
| --- | --- |
| Stylelint / ESLint | PASS，均 0 |
| `migration:build` | 三个候选均 PASS；重建分别对应 T32 期望同步、分段选中态修补。每个候选只做一次统一应用构建，无单独替代 bundle |
| `gate.mjs types` | 最终候选 PASS，CSS、Token、feature-syntax、strict 与负向类型通过；types-selected-state.log |
| Impeccable detector | PASS，输出 `[]` |
| 差异保全核验 | PASS，275 个原静态选择器保留；控制器只改中文文案，消息查询/分页/排序/投递请求原样 |
| 19 个注册文件 | 首轮 14 文件 52 PASS，T32 旧文案 1 FAIL、4 文件 NOT_RUN；修正期望后 5 文件 22/22 PASS、零 SKIP/NOT_RUN。应用输出在这两次构建间逐字节相同，详见 production-byte-equivalence.json；不称同一候选的一次 full |
| 最终直接风险回归 | 3 文件 12/12 PASS：原 Inbox、旧会话、T22 边界；registered-selected-state/summary.json，最终选中态候选，零 SKIP/NOT_RUN |
| 四宽度真实渲染 | PASS，最终 20 张原图、12 张前后对照；visual-result.json；无页面溢出、每用途恰好 1 个选中项、ghost danger / secondary、关闭回焦点、浏览器业务 POST=0、资源计数归零 |
| `verify-artifact.mjs` | 最终候选 PASS，artifact-final.log；STAGED_NOT_ACTIVATED |
| 文档及本地计划 | PASS，docs:agents:check、原工具测试 20/20；card-19 的本地链接单独检查通过。最终实际差异为 docs + pc，45 个路径；final-plan.log |

原始日志、全 src 扫描、已确认替换映射、计划和保全核验位于 本次证据目录 `D:/CodexEvidence/pc-admin-v211-card19-20261103`。保全辅助脚本初次把 JSX 正文与 CRLF 差异当成代码差异，核验工具修正后通过；原诊断保留 `preservation-initial.log`，没有修改产品以迎合辅助检查。

### 首轮真实失败与修补

首轮 T32 失权用例仍等待旧文案片段「旧异常副本已停止展示」，新页面已按确认清单显示「原有内容已隐藏」，触发原等待超时。仅同步该期望片段；对象 404、清除列表/详情、有效会话、零 POST 和 Sender 次数断言原样。首轮 TAP、cases、summary、失败截图和 4 个 NOT_RUN 均保留于 `registered/`，不回写为 PASS。后继构建与补齐执行单独记录，不宣称首轮全通过。

### 分段选中态的直接修补

初批截图发现切换备注后整框变黄，但按钮没有选中外观；DOM 诊断证实共享 Button 会过滤 `aria-selected`。在本卡会话页两个原按钮的 native ref 补回该属性，不修改共享 Button、权限、控制器或处理函数。首批 20 张截图保留于 `visual-initial/`，诊断为 `segment-probe.json`。最终追加原 Inbox、旧会话、边界三个入口，覆盖接待/输入/未知结果/已读/失权；最终截图额外核对单一选中项和选中样式。这是本卡要求的分段控件呈现修补，不新增业务功能。

## 1920 / 1440 / 1280 / 900 对照

改前以 v21-card14、v21-card15 已提交比较图中的「卡 14 / After」中间面板为准，保留其原日期、数据、尺寸与采集身份。新图为本卡合成数据和本次生产 bundle。两者不冒充同一时刻的服务器数据；对照只用于展示变化。

| 宽度 | 会话前后 | 通知异常有数据前后 | 通知空态前后 | 最终备注模式 | 最终跨日消息 |
| --- | --- | --- | --- | --- | --- |
| 1920 | [对照](../../docs/ui/evidence/v211-card19/compare-conversation-1920.jpg) | [对照](../../docs/ui/evidence/v211-card19/compare-notifications-data-1920.jpg) | [对照](../../docs/ui/evidence/v211-card19/compare-notifications-empty-1920.jpg) | [浅黄整框](../../docs/ui/evidence/v211-card19/note-1920.png) | [日期与渠道](../../docs/ui/evidence/v211-card19/waiting-1920.png) |
| 1440 | [对照](../../docs/ui/evidence/v211-card19/compare-conversation-1440.jpg) | [对照](../../docs/ui/evidence/v211-card19/compare-notifications-data-1440.jpg) | [对照](../../docs/ui/evidence/v211-card19/compare-notifications-empty-1440.jpg) | [浅黄整框](../../docs/ui/evidence/v211-card19/note-1440.png) | [日期与渠道](../../docs/ui/evidence/v211-card19/waiting-1440.png) |
| 1280 | [对照](../../docs/ui/evidence/v211-card19/compare-conversation-1280.jpg) | [对照](../../docs/ui/evidence/v211-card19/compare-notifications-data-1280.jpg) | [对照](../../docs/ui/evidence/v211-card19/compare-notifications-empty-1280.jpg) | [浅黄整框](../../docs/ui/evidence/v211-card19/note-1280.png) | [日期与渠道](../../docs/ui/evidence/v211-card19/waiting-1280.png) |
| 900 | [对照](../../docs/ui/evidence/v211-card19/compare-conversation-900.jpg) | [对照](../../docs/ui/evidence/v211-card19/compare-notifications-data-900.jpg) | [对照](../../docs/ui/evidence/v211-card19/compare-notifications-empty-900.jpg) | [浅黄整框](../../docs/ui/evidence/v211-card19/note-900.png) | [日期与渠道](../../docs/ui/evidence/v211-card19/waiting-900.png) |


## 规范偏差、限制与回退

- 未取得完整 v2.1 验收报告正文，本卡问题编号以本次用户任务卡的明确条目对应；不扩充其它问题编号。
- 用户提供的 v2.1.1 原型文件实际是 JSON 编码的 HTML 字符串，画面通过 `about:blank#…` iframe 引用，未包含各画板可独立渲染的内容。只读检查原件，未修写用户文件；视觉对照以真实历史渲染和现有规范为准。
- 原关联会话与列表的 aria-label 中保留「服务会话」兼容选择器；页面级名称与可见文字统一为「会话」。这是遵守选择器只增不删，未重命名已有查询/路由/业务概念。
- polling、offline、auth-blocked 属于任务卡没有指定新文案的额外状态，保留各自原有真实含义；没有将离线或权限阻断冒充为正在重试。
- 文案中的发送/内部隔离、未知结果恢复要求保留；没有将局部空列表当作全局送达证明。
- full/certify、Electron 原生、真实发送、现场业务写库、部署、Gate 均 NOT_RUN；本地合成结果不代表现场验收或用户接受。
- 回退：在本 worktree 中反向应用本卡差异并删除本卡新增文件即可。无数据库迁移、运行配置或业务数据回退；不重置主工作区。

## 自检

| 自检项 | 是 / 否与证据 |
| --- | --- |
| 只改前端展示，未改业务命令、状态值、权限、合同 | 是：源码 diff 无 server/contracts/依赖；preservation 核对控制器、传输及 Inbox 请求原样 |
| 测试选择器只增不删；改过的测试只改文案期望 | 是：275 个原静态钩子保留；两个测试差异均仅为 `includes` 内的中文片段 |
| 新样式经 Token，Stylelint / ESLint 为 0 | 是：仅复用 bg-muted、bg-canvas、shadow-2、space-0-5、tone-danger-fg；lint/types/detector 通过 |
| 只改本卡范围，无其它区块格式化或移动 | 是：Workbench 的 Shell 前后字节级比较通过；feature/文案测试与记录路径符合授权 |
| 四宽度与 v21 改前截图对照 | 是：上表 12 张对照，改前仅裁取既有比较图的中间已交付面板；来源原图哈希及裁切坐标见 comparison-sources.json |
| 问题编号逐项有证据 | 是：上表问题映射、四宽度截图、visual-result.json、三个阶段注册结果；首轮失败及 NOT_RUN 不回写 |

## 最终对象与资源交接

最终输入指纹 `e32ce4e8be47169653c534b1d71f67fa1ce03e16290f17c403634fcea8f52229`；manifest SHA-256 `04bf8ad1177e6dab912454c66a71472971f7b2bc73d806a8b6aa3cde70d64ec0`。HEAD 仍为基线，dirty=true；本卡变更不在该提交中。最终两个测试仅改文字期望。分段回归与最终截图均绑定最后一次构建；前两批原执行分别绑定其原 manifest，不重绑到最新候选。

结束前再次 fetch，origin/main 仍为同一基线，无其它卡新合并需要同步。未提交、未推送、未建 PR。自有浏览器/HTTP/fixture 已关闭；三次最终截图浏览器资源计数均为 0。自有 PG18 已停止（stop exit=0、随后 status exit=3），53649 无监听，按本任务路径匹配的 node/chrome/edge/postgres 进程为 0；非模板库仅剩 postgres。

自动审批拒绝了删除本任务临时 PG 目录、测试临时目录与 .build/emit 的操作，返回理由仅为 “blocked by policy”，未给出更具体原因。本轮未重试或绕过；三个目录均保留，不能写成已删除。详见 cleanup-rejected.json。worktree、分支、本次唯一运行制品与 tools、node_modules junction 和证据保留；主工作区及卡 17/18 不动。

卡记录链接检查初次因仓库外 D 盘证据链接被 LOCAL_LINK_OUTSIDE_REPOSITORY 拒绝，已改为纯路径文字，最终检查通过；原失败见 final-plan-initial.log。该纯记录修补不重建应用候选。

## 发布续记（2026-11-03）

用户追加授权提交卡 19、创建 PR 并请求 `@codex review`；发现 P1/P2 时修复后继续复审，无 major 且适用 CI 通过后合并，再快进 main 并清理已合并的自有分支/worktree。此授权替代首轮仅本地停止点，不改变真实发送、部署或 Gate 的边界。

GitHub 已核验卡 17 PR #139 合并点 `56ccf94895856b57bd8026d9d56c1e6716557ef4`、卡 18 PR #140 合并点 `8da63bddcd137023ec4161fc8522c6c91b249f34`；开工时最新 origin/main 为后者。先保存首轮改动提交，再将最新 main 合入本分支，保留历史验证对象；发布后的实际候选、CI 与 Codex 结果另记，不重绑首轮截图和 manifest。

本阶段原件目录：`D:/CodexEvidence/pc-admin-v211-card19-publish-20261103`。
