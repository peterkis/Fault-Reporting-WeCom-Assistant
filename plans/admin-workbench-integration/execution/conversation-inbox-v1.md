# 医小修会话增量 C1→C2→C3 执行记录

日期：2026-10-17，Asia/Shanghai。本地实施阶段授权范围：本地开发、任务自有隔离 PostgreSQL、loopback HTTP、正式生产 bundle、真实 SSE 和合成 Sender。当时未授权真实发送、业务库、部署、GitHub 任务发布及 Git 发布。

## 来源与身份

原件目录 `D:\Agent-Prompts\Yixiaoxiu_Conversation_Design_v1_20261017` 的四份文件保持原件。起点 main、origin/main、GitHub main 在开始时均为 `1dfb43459fb92706db1aef6b469a8462250475b9`，工作树干净。唯一写者在本地 `codex/conversation-inbox-v1` 开发；最终源码由基点 SHA + dirty input hash/逐文件哈希标识，不能将基点提交当成新实现的完整源码。

证据根目录：`D:\wecom-workbench-evidence\conversation-v1-20261017-227355fd-ff9a-4f36-a646-173366b61b92`。任务自有 PG18 位于该目录的 postgres/data，loopback 55600。每次候选的构建 manifest、严格类型、实际 test-routing 入口/宿主/flags、原生 TAP/case reporter、截图、HTTP/SSE 和清理分别归档；失败记录保留。

## 本地批次与 Backlog

| 批次 | 输入/输出 | 本地状态 |
| --- | --- | --- |
| C1 | 原 T22/设计包 → 默认关闭收件箱、按页聚合/签名分页、真实相关主题、显式聊天 Schema/运行时守卫、复用 Composer/个人阅读 | 已完成本地实现与定向验证 |
| C2 | 原续接/控制/通信 → 原事实链上的主题级暂停、等待后准入、单进程/分进程装配、统一实时 family/失权清理 | 已完成本地实现与定向验证 |
| C3 | 最终候选 → A01–A26 本地证据映射、相关回归、执行计划、制品/资源核验 | 已完成本地定向验收；真实体验待独立授权 |

这里是用户授权的本地实施状态；GitHub Issues 仍是已发布任务的权威状态，本轮没有发布、领取或关闭新 Issue。不以本记录改变既有43票与 Gate。

## 合同与资源

实际接口与关闭行为见[接口合同](../../../docs/api/workbench/conversation-inbox.md)，界面见[UI说明](../../../docs/ui/conversation-inbox.md)，长期取舍见[ADR-0032](../../../adr/0032_conversation_inbox_and_rule_admission.md)。术语仅增量写入根 CONTEXT。无新增业务表、无数据库迁移、无旧迁移修改；页内摘要/未读/异常批量读取，实际执行计划另存。

`workbenchConversationInboxEnabled=false`，依赖原 `workbenchConversationsEnabled`；bootstrap `conversation_inbox_enabled`。关新开关恢复旧 Session 页，新读取503，原消息/Outbox/Delivery/责任/控制历史保留。规则暂停根据真实接管事实执行，不受入口回退撤销。保留一套 App/API/SSE、一个 Worker、单活 Gateway；没有新 EventSource、轮询周期、媒体 Worker 或池。原池总量建议≤8、SSE默认32、通信并发1保持。

## 候选与实际检查

唯一活动 selection 为 `v3-p09`；4个新增入口已登记，宿主为 STAGED_RUNTIME。新增独立 selection `conversation-inbox-v1` 仅便于本轮定向执行，不等于活动全集。规则用例的分进程路径也登记在 subprocess_entries。

候选01：严格类型和 production build 通过，810个编译模块的语法检查通过；保留既有大 chunk 提示。新合同通过；聚合/分页等3个新数据库用例通过。双坐席用例因第二坐席未获该主题读取权返回404；规则人工确认用例缺合法复核准备，分进程用例把无关业务通知计入受影响规则的发送数；浏览器历史按钮尚在 fetching 时点击未执行。均保留原失败，修正测试准备/同步条件。查询随后把材料聚合移到页内，新的候选需重新验证。

最终候选07：HEAD仍为原基点（未提交），dirty input hash=`26eb9caa22c9a5c22c385a2fef647e483b9d1f4ac182345baaf38a4d589aef86`，完整manifest SHA-256=`0b49cd1ee4298a2d9ed84054119fb56be34248443c7ac058634cc64a2e81c804`。810个编译模块、Node 24严格类型、前端严格类型、production bundle、制品核验均通过。默认未启用，未激活或部署制品。保留既有Vite大chunk提示。

| 实际检查 | 结果与证据（均位于证据根） |
| --- | --- |
| C1/C2新增注册入口 | 4文件14项全部通过，0 fail/SKIP/NOT_RUN；`final-new-candidate-07/summary.json` |
| 受阅读修复影响的T22/T35/T38 | 候选07重测19文件42项全部通过；`repair-regression-*/summary.json` |
| 通信、可靠续接/空闲边界、来源和附件等 | 候选06的9文件69项全部通过，保留原身份；`regression-20`至`regression-28`。候选06→07只改阅读组件与新增浏览器用例，后台源码/运行产物完全一致，见`candidate-06-to-07-delta.json` |
| 相关业务总计 | 28个既有注册入口111项，加新增14项，共125项通过；这是定向子集，不是714入口活动全集或full。每条原报告的来源候选保持不变，`validation-summary.json`汇总指向原件 |
| 工具与文档 | 路由/宿主/制品绑定/执行覆盖21项、有限语法工具3项、文档检查测试19项通过；9份变更Markdown的456个本地链接有效；impeccable detector无发现 |
| 实际查询计划 | 239个合成Session/35联系人，30+5分页；补充完整计划采样执行9.555ms、规划2.847ms、材料1批。`inbox-explain.json`和原TAP保留，不推断生产容量 |
| 正式页面 | 1920/1440/1280/900/390无横向溢出，5张原始PNG及SHA；`screenshots-candidate-07.json`。宽三栏，窄屏分步。只有一个真实SSE；本次页面可见采样125ms，失败回读恢复5074ms。均为单次本地合成采样，不是SLA |
| 原始HTTP/SSE采样 | 编译运行树、真实loopback HTTP、17次请求/28个SSE块，合成Sender实际调用1次；`http-sse-transcript.json`。真实Store生成的纯H5事项：Session=0、关联沟通=0、Inbox匹配=0 |
| 资源 | 所有自有HTTP/SSE、浏览器、Worker、池、测试库已关闭；最终只剩基础postgres库，其他客户端连接0，55600监听0。`cleanup-final.json`及stop/status日志。空初始化PG簇目录保留于Evidence：自动策略拒绝递归删除，未绕过该拒绝，不标data_removed=true |

候选02/04的浏览器点击条件竞争、旧复核材料准备以及候选06的T35 ACK丢失失败均保留原报告和截图。阅读缺陷原已存在：丢失ACK后永久blocked。候选07用本人当前Cursor确认，并跨材料重读保留未知坐标；确认前只能GET，不生成新UUID重写。原T35失败用例和新增“提交前传输未知、前台/新材料均不重写”用例通过。没有改原Cursor/消息/命令哈希或新增收据路径。

额外运行的既有`tools/ts-migration/acceptance.test`有1项通过、6项失败。只读比较本任务开始前的完整HEAD，确认认证清单声明239项而当时注册710项，已有471项缺口（其旧测试还固定断言220）；本轮新增4项不构成这项旧缺口的起点。`acceptance-baseline-gap.json`与原`tools-acceptance.log`保留；认证器、固定清单与历史身份均未改，也未制造PASS。本轮没有运行full/current certify/historical certify、现场或真实企微体验，均为NOT_RUN。

## A01–A26 映射

以下场景均有本轮实际合同/集成/浏览器或补充HTTP采样对应。只标本地合成范围；原设计包第3节的真实Bot体验全部NOT_RUN。每个注册入口及native case的源/执行哈希、宿主、flags、结果见validation-summary.json及其原报告。

| 编号 | 当前实现/测试入口 |
| --- | --- |
| A01/A02 | conversation-inbox.integration：同群、同名不同账号、跨Bot不误并；旧T22参与者隔离回归 |
| A03/A06 | conversation-inbox.integration：同人205个独立群主题，按人聚合；conversation-rule-admission.integration：独立主题不暂停 |
| A04/A26 | conversation-inbox.integration：真实Journey群/私聊只计1主题、原始群来源保留、当前获权窗口；原guided Journey续接回归 |
| A05/A07 | 原 p2-016-guided-journey 与直接受理/Session边界定向回归；不增加 LINK_EXISTING_JOURNEY |
| A08/A09 | 新无Ticket Session；新浏览器获权HANDLER看到canonical_item=null且可回复、账号草稿不继承；补充HTTP采样由真实Web Store写入纯H5，验证零Session/零关联/零Inbox，不虚构聊天 |
| A10/A11 | 新双坐席冲突/释放；原T22转交及工单责任独立回归 |
| A12/A13 | conversation-rule-admission.integration：排队后接管、关联窗口、释放仍暂停、独立主题、人工确认、已过准入/UNKNOWN及真实分进程；原Incident准入/通信回归 |
| A14/A15/A16 | 新HTTP同UUID/精确投递/备注无Outbox；production browser丢失202正文、只读原UUID核对、目的草稿隔离；原通信UNKNOWN回归 |
| A17/A18 | 新production browser：历史加载、实时滚动锚点/输入选区、IME、真实ShiftEnter/Enter |
| A19/A21 | 新production browser：真实Cursor、隐藏不推进、转交/失权/账号切换；T35账号/失权/迟到响应回归；Cursor未知结果的本人GET确认与跨重读不重复写入 |
| A20 | 新production browser的单一真实SSE、REST完整读取失败/回退；原T38协议/缺口/断线定向回归 |
| A22 | 新数据库239 Sessions/35联系人30+5分页、签名/筛选/主体/排序变化游标与实际EXPLAIN |
| A23 | 新来源标签使用旧安全群引用/登记名称；原来源群改名隔离回归 |
| A24 | 新聊天媒体状态与真实占位；原受控附件权限回归；实时媒体保存、在线预览、图片发送未实施 |
| A25 | 新精确Item/Binding/Message关系、实际历史sender与Delivery去重；原T22历史/状态回归 |

## 剩余真实体验条件

限定既有测试 Bot、两个获授权测试用户、一个测试群与单活 Gateway，按原设计包第3节执行真实收到、连续私聊、群转私聊、人工/规则协调、断网恢复和实际延迟。需独立具名授权与现场运行条件。当前合成 Sender 不能证明企微客户端收到；P2-G2-LIVE、P2-008、后续 Gate、AI/媒体增强、部署、生产/临床启用均未启动。

## 后续 Git 交付授权

本地交付后，用户明确授权提交、推送、创建 PR、请求 `@codex review`，修复 P1/P2 后继续审查，全部问题解决且适用检查通过后使用保留历史的 merge commit 合并，再快进本地 main 并清理本任务分支与工作树。该授权不扩大真实发送、现场业务写库、部署或 Gate 范围。每轮远端完整 SHA、审查结果、CI 与合并/清理事实追加记录在 PR 和仓库外发布证据中；上文各本地候选与历史失败保持原身份。
