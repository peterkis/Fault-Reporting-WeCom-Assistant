# 明确关注与我有关（WBINT-T34，实施前合同）

返回 [接口导航](../README.md) · [当前看板](board.md) · [执行记录](../../../plans/admin-workbench-integration/execution/t34.md)

状态：SOURCE_READY／NOT_RUN，基线 `326b7ea455b5cfc7de6e3e980401921fc9cac524`。下列是本票冻结的目标合同，当前生产 handler 尚未挂载，不是可用接口。第一条 HTTP RED 的源码已登记，build、strict、数据库、HTTP和正式制品浏览器均 NOT_RUN；后续须在父任务授予的串行窗口执行原 RED，再逐片最小实现。

SOURCE恢复已合入真实integration `4ffd8c6585eab0e96b202b44b80462b2617aa33f`，保留已完成T17／T38／T14／T05／T11。原public tracer不变，044仍仅预留；下文原ledger合同已按真实042专用人工代录分支明确并集，不沿用旧031资源CHECK覆盖当前实现。此同步不包含任何新的运行结果。

## 主体、事项与责任

内部 W 身份从现有认证取得，再从数据库核对当前活动 Principal、角色、组及对象可见性。客户端不提供 principal、角色、责任人或授权范围。事项为 `{kind:'ticket'|'review'|'intake',id:UUID}`；现有 Ticket、Review、Journey 和源 Intake 事实决定规范事项，同 Ticket 的 Review 不形成第二张卡。Ticket Assignment 和当前非 ENDED Conversation Assignment 继续分别是处理和沟通责任的唯一事实源。

“与我有关”是当前**可见事项**与以下并集的交集：本人实际处理责任、本人实际沟通责任、本人明确关注。多项原因仅返回一张规范卡；沟通必须由真实源 Intake／Journey／Channel Leg 与 Session 的关系证明，Assignment 必须为 ASSIGNED 且 Session 未结束。最新消息、浏览器查看／编辑、历史 Assignment、他人关注和未来未集成派单能力都不产生相关关系。沟通或关注本身不扩大 Ticket／Review／Intake 的既有可见性。

## 目标 HTTP 与闭合 DTO

目标宿主 W，沿用同源认证、no-store、JSON错误和 Cookie 写请求的 Origin／CSRF规则。新增宿主选项 `workbenchFollowEnabled:boolean=false`，bootstrap 目标字段 `follow_enabled:boolean`。开关关闭时不访问本票表、迁移 readiness 或关注 receipt SQL；原 board、mine 和 detail 保持原模式。启用但缺迁移或发现漂移时失败关闭，不能伪装成空关注或成功。

| 方法及路径 | 输入 | 目标结果 |
| --- | --- | --- |
| `GET /api/workbench/board?scope=related` | 新 scope 仅 `team`／`related`，默认 team；原 column／range／cursor／limit 保持 | 原 BoardPage，启用时卡片增加 caller-only `attention` |
| `GET /api/workbench/items/{kind}/{id}` | 原 kind／id／cursor／limit；仅启用时增加关注读投影 | 原 WorkbenchDetail，其 item.attention 与看板同一事实查询 |
| `POST /api/workbench/items/{kind}/{id}/follow` | 空 query；下述精确 JSON、Idempotency-Key、精确双引号 If-Match | 200 已提交的安全命令结果；相同原命令重放返回原结果和 replayed=true |

`attention` 为 `{following:boolean,follow_version:string,related_reasons:('HANDLING'|'COMMUNICATION'|'FOLLOW')[]}`。原因按表中顺序返回，无重复；只表达当前 caller 的关系，不返回关注者名单、其他人关注、隐藏卡片计数或未获权 Session 引用。看板分页先完成每对象授权、规范去重及 scope 过滤，再排序和 LIMIT；游标同时绑定 principal、当前授权范围、scope、column、range及原时间窗口。切换 scope 或当前授权变化须清空旧游标。原 `/api/tickets?state=mine` 继续是旧处理责任查询。

POST 精确字段：`client_command_id:UUID`、`canonical_item:{kind,id}`、`expected_follow_version:64位小写十六进制string`、`following:boolean`。`canonical_item` 是本次 fresh GET 得到的规范引用，不能在恢复旧意图时自动换成新引用；`Idempotency-Key` 等于原 UUID，`If-Match` 精确为 `"<expected_follow_version>"`。没有 Ticket 状态版本、Session版本、reason正文、目标 Principal 或任何业务动作字段。W 原32KiB上限继续有效。

新结果为 `{ok:true,client_command_id,requested_item:{kind,id},canonical_item:{kind,id},following,follow_version,replayed:boolean}`；它证明原关注意图的提交结果，不能代替 fresh GET 的当前状态。异UUID的重复设值可为 no-op，仍检查当前版本和 canonical fence；相同原UUID／payload用原ledger终态重放，不增加版本。相同UUID改payload返回409 COMMAND_CONFLICT。版本或规范映射变化返回409 VERSION_CONFLICT，当前失权返回404，身份失败沿401／403。网络或503保持原意图未知，用户可明确重放同一 UUID／payload；不能自动造新命令。首次 GET、预加载和编辑不写关注、receipt或任何责任事实。

## 最小存储提案与原ledger

父任务已核对当前root与协调器并为T34独占预留前向迁移 **044**，状态 SOURCE_CONTRACT_ONLY／NOT_APPLIED；目前没有 SQL 文件或迁移执行，真实首RED运行后才可写044及产品代码。拟增加一张 `pilot_ticket.workbench_item_follow`：`principal_id UUID`、`source_intake_id UUID`、`following BOOLEAN`、`row_version BIGINT CHECK(row_version>=1)`、`created_at/updated_at TIMESTAMP WITHOUT TIME ZONE`；主键 `(principal_id,source_intake_id)`，两FK分别引用现有 Principal／Intake，ON DELETE RESTRICT。时间沿用 platform.local_now；增加 caller-only 部分索引 `(principal_id,source_intake_id) WHERE following`。不存显示名、角色、处理组、处理人、沟通人、Ticket状态、消息或外部ID。取消保留false tombstone和版本；原ledger保留命令审计。

源 Intake 是稳定关注锚点，不是新的事项事实源。当前关联关系把同一规范事项的锚点折叠为一个 boolean。Review转成Ticket或关联已有Ticket后，所有有效关注锚点仅贡献一次；明确取消规范事项时，在同一事务锁定并置false所有当前对应的本人锚点，避免旧Review关注复活。普通GET只投影，不自动改键／造关注。失权可保留关注行，但授权查询不展示；恢复权限仍依当时真实关系判断。

`follow_version` 是关注自身的 opaque CAS token，按固定规范JSON对 `[schema=1,principal_id,canonical_item,sorted(anchor,following,row_version)]` 求SHA-256；无行也产生确定token。包含规范映射，避免多个Review收敛后仅取max版本造成旧取消覆盖新关注；它不是Ticket版本、材料revision或SSE位置。BIGINT保持十进制string，不转number。单事项最多100个当前源锚点，超过时关注读／写失败关闭，不截断后冒充完整取消；相关SQL用有界验证与EXISTS，不拉全院卡片回浏览器过滤。

复用 `pilot_ticket.ticket_command_receipt` 和现有 `P2_016:<principal>` scope、UUID、hash、SAVEPOINT、COMMITTED／FAILED终态。本票唯一新purpose为服务端指定 `WORKBENCH_ITEM_FOLLOW`。现042资源 CHECK保留Ticket／Review非空的旧分支，并仅允许 `WORKBENCH_MANUAL_REPORT` 在Ticket／Review／Session均null时记录真实工作人员受理。044必须保留这一完整专用分支及原目的／授权／回执语义。为完整支持Intake规范事项，拟增加 `source_intake_id UUID REFERENCES intake.service_intake(id) ON DELETE RESTRICT`，仅新增 `command_type='WORKBENCH_ITEM_FOLLOW' AND source_intake_id IS NOT NULL AND conversation_session_id IS NULL` 的资源分支；新列另约束为null或该follow用途，不把裸sourceIntake非空作为所有命令的资源豁免。旧receipt与旧动作语义不变，不建立第二ledger、泛用命令HTTP或Ticket事件流。

当前规范映射只接受现有源Intake、Review／Journey linked_ticket_id及真实Channel Leg关系；沿当前WEB01／Review retained material的可见性／保留期验证，每个requested alias与最终canonical对象分别授权。只因关注行有某个Intake UUID，不能新增可读alias。纯网页来源没有Session，不为并集造沟通事实。

写事务锁定当前Principal、实际规范对象和关联映射行及本人锚点，统一按资源kind／UUID顺序取锁；在等待对象锁之后再次解析当前Principal／授权／规范映射，再检查canonical fence和完整本人锚点版本。每次receipt查询及重放前独立验对象可见性。取消范围严格为该事务当前已获权规范事项的全部本人关注锚点，不清其他事项、他人关系或未来才关联的事项；与转换／关注并发时遵循实际事实锁与提交顺序，关系变化导致旧fence冲突，提交后fresh GET仍须呈现后继真实变化。既有转换锁协议若不能提供此边界，先补报告父任务，不靠GET改键、忽略版本或放宽授权通过。receipt payload hash包括原requested／canonical引用、版本和following；当前权限永远不能从关注行或旧receipt推得。事务只修改关注行和本票专用原ledger结果，不写Ticket Assignment、Conversation Assignment、Ticket状态／版本、Outbox或Delivery。

044需沿现有明确的forward-aware catalog／资源验证seam增加精确结构，031及全部既有SQL保持原字节；不能改旧hash、增加目录豁免或接受任意漂移。原ledger在开关false时不SELECT新source_intake_id字段、不把旧purpose当关注、不修改既有权限／receipt结果语义。迁移readiness、资源登记和原固定历史catalog的具体适配在真实RED后的实现片独立核验。

## 前端、资源、关闭与剩余验证

正式 React 目标是显式“关注／取消关注”按钮、可返回／刷新的“与我有关” scope，以及提交后 fresh GET／Query失效。同一服务端 attention 投影供看板、列表及详情；不以本地 setState模拟成功。401／403／404清理相应授权缓存，转出且无其他责任／关注时不再留卡，权限撤销即使关注行还在也不展示。并发409保留原意图并提示重读；规范转换不双卡、不用新的UUID偷偷重放。读位置、团队补充处置、跟进时间、presence及声音属于后续票，不在此按钮中实现。

不新增依赖、进程、Worker、Gateway、timer、SSE或数据库pool；复用现单App、单Worker与现池，建议总池≤8，原SSE32不变。板页默认50／最大100，原详情材料上限不变；源锚点上限100，事务和fixture串行。关闭方式为follow选项false并隐藏新操作／scope，保留关注和receipt事实，不改变旧mine、责任、Ticket及原开关；结构修复只用新迁移，不重写历史SQL或证据。

第一条[真实HTTP RED源码](../../../tests/wbint-t34-follow.integration.test.mts)只覆盖实际沟通人的获权并集与已有Review规范去重，尚未运行。后续逐片覆盖显式关注／取消／原命令重放；真实处理、沟通转出与显式关注保留；GET／编辑无写；Review转换／双锚点取消；失权／角色变化、锁等待后重新验权、stale与并发；默认false无新表访问、缺迁移失败关闭；正式生产制品按钮／scope／列表／看板／详情及缓存清理。每片先保留原RED，再最小GREEN；适用unit／contract、隔离PG／HTTP、正式制品浏览器、strict、单build／artifact及工具proof均须实际记录。

## 2026-10-10 当前根接口的 SOURCE 接缝核对

本次只将 integration `4fececa695f8adea54ce599baa6b5f8cf50665d2` 同步到原 T34 源码，不宣称上述目标 HTTP 已挂载。当前 Ticket 查询的 `mine` 仍只代表处理责任；`column=pending` 是现有看板状态桶，不是团队补充待跟进事实，`attention.following` 也不是个人已读。T34 只实现显式关注与获权责任并集，读位置、团队补充处置及共享安排仍由原相邻票承担。

当前沟通并集应沿权威 Session 的 `ASSIGNED` 且非 `ENDED` 当前责任查询，不能从历史责任结果、T22 会话列表的显示姓名或团队可见性推得。T17 的 MANUAL 材料继续沿真实来源、当前能力、保留期与对象授权；手填身份不创建 Session 或沟通关系。原首片继续用既有 related-conversations／takeover 公共 HTTP 建立真实沟通事实，T22 默认关闭的集中会话入口不替代它；原首片 MANUAL 默认 false。当前 board 的闭合 query 守卫尚不接受 `scope=related`，这里只记录待验证的公开缺口，未实际运行，不能记为 RED 或 PASS。

044 继续只是 SOURCE_CONTRACT_ONLY／NOT_APPLIED 提案，无 SQL 文件或执行；042 的 MANUAL 专用 receipt 分支和历史 SQL 保持原字节。原 tracer、角色、fixture flags、STAGED_RUNTIME、数据库／浏览器标记、node_flags=[]、串行与 240 秒预算均不改。
