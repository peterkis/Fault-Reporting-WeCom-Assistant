# 补充待跟进（WBINT-T36，SOURCE 计划）

来源：[原 #91](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/91)、[WBINT-12](../../../plans/admin-workbench-integration/implementation-plan.md#wbint-12个人已读关注团队待跟进与共享预约)、[A12](../../../plans/admin-workbench-integration/acceptance-matrix.md)、[ADR-0031 §5](../../../adr/0031_human_workbench_collaboration_policy.md)。本文件冻结计划接口，不代表接口已挂载、迁移已应用或任何验收通过。当前输入 59fe755cad7084cf089eecd368fed5ae72b33080 已有 T35 正式 read-position 路由、跨来源材料坐标及独立 Session cursor。

## 唯一事实与材料目标

团队待跟进针对一条正式报修补充，不是 Ticket 状态、个人阅读位置或第三套负责人。目标为 `ticket_id` 路径和 `{source_ref,revision}`；WEB 使用 `web:<submission UUID>`＋该提交的 `input_revision`，BOT 使用 `channel:<message bigint>`＋其实际 Intake relation `sequence_no`。decimal string 不转不安全 number。服务器必须从当前获权、未过期、确实关联该 Ticket 的源记录核对两者，不能接受“截至某修订全部已处置”。WEB 仅真实 `web_submission.kind=SUPPLEMENT`；BOT 沿现有正式材料的补充关系和 canonical Journey/Leg 判定，不把原文、Session 任意消息、备注或只有 sequence 较大当成补充。当前 MANUAL snapshot immutable 1 没有追加补充入口，不虚构 revision 2。

材料身份沿真实 Intake／source fact；Review→Ticket 及同一 Journey 的多个 Leg 只改变规范导航关联，不复制材料或处置。新材料无精确成功依据即 PENDING；旧动作只对原目标产生依据。个人已读、打开、承接、普通内部备注和普通回复均不自动处置。无人领取仍可展示团队待办，不能要求先承接才出现或先改工单状态。

## 计划 HTTP（宿主 W，同一 App）

| METHOD＋PATH | 输入与成功输出 |
| --- | --- |
| `GET /api/tickets/{ticketId}/supplement-follow-up` | 仅 `limit?`（默认50、1..100）、`cursor?`；200 [page schema](../../../contracts/workbench_supplement_follow_up_page.schema.json) |
| `POST /api/tickets/{ticketId}/supplement-follow-up` | [闭合 disposition command](../../../contracts/workbench_supplement_follow_up_command.schema.json)；200 [result](../../../contracts/workbench_supplement_follow_up_result.schema.json)，只处置该目标 |
| `GET /api/tickets/{ticketId}/supplement-follow-up/commands/{commandId}` | 无 query/body；200 [专用只读收据](../../../contracts/workbench_supplement_follow_up_receipt.schema.json)，核对原主体／原用途／原 UUID |
| `POST /api/workbench/conversations/{sessionId}/messages`（现有 T22 路由的计划 opt-in 扩展） | [闭合 bound reply command](../../../contracts/workbench_supplement_follow_up_reply_command.schema.json)；仍是现有202 Message/Outbox/Delivery结果，受理不清待跟进。当前原 handler 尚不接受新字段 |

对应 [typed contract](../../../contracts/workbench_supplement_follow_up_contracts.d.ts)。处置 body 必含 `client_command_id:UUID,action:RECORD_DISPOSITION,source_ref,revision,disposition_note,mark_followed_up:true`，note 为非空白1..2000 Unicode code points，保留原意图字节/规范化规则用于 hash；只写内部处置证据，不进入任何外部 Delivery。Cookie 写入要求当前 CSRF、Origin、JSON、Idempotency-Key 与 UUID 相符。没有 Ticket `If-Match`：本动作不修改其 lifecycle/version；目标修订本身精确且不可变。绑定回复继承 T22 `expected_row_version:number`／`If-Match` 和当前 REPLY 权限、Session/Thread/Intake一致性及既有服务器导出目标，不接受 browser 指定外发接收人或声称已送达。

Page 按源事实时间、source kind、真实 Intake identity、源 ordinal、source fact identity 升序稳定分页；同一 WEB Intake 的修订顺序保持递增。cursor 必须绑定当前 principal、Ticket、授权 scope/epoch 和排序，不可换对象或复用失效权限。权限与留存过滤在 LIMIT 前；`has_pending_supplements` 是完整当前获权留存范围的 EXISTS，不按本页长度推断。items 只含 source coordinates、kind、PENDING/FOLLOWED_UP及最小 resolution；不含正文、处置 note、成员 identity、provider receipt、SDK参数或原始错误。卡片／列表／详情共享该授权字段投影，后台无正文加载不得写 personal read。

## 权限：2026-10-11 人类明确确认

用户明确回复：“允许所有获业务操作授权且可读该材料的同事”。权威原记录为 `D:/wecom-workbench-evidence/notes/t36-explicit-user-role-policy-20261011.json`，并同步到 ADR-0031 §5。T36 `RECORD_DISPOSITION` 谓词为：**当前活动且已获工作台业务操作授权的人员 AND 当前可读、仍留存的精确 source_ref/revision**。本显式处置不要求该人员是当前 Ticket assignee 或 Conversation owner；READ 单独仍不构成写权。最终命令 predicate 与 UI capabilities 应按此已确认规则同源落地，首 tracer 的 ADMIN 只是最小纵切，不代表其它获授权同事的运行验证已完成。

此决定只适用于 T36 确切补充材料的显式处置，不扩大现有 Ticket／材料读取范围。现有 [Ticket add-note](../../../src/p2-016-ticket-query.mts) 和 [Session INTERNAL_NOTE](../../41_p2_005_assignment_handoff_generation_fence.md) 保持原权限；绑定回复仍需原 Session REPLY 权，Delivery恢复／重试／核对仍独立，系统／群名／管理权限不变。新处置 note 是T36内部处置证据，不能借此调用原无权的备注或回复入口。

每次新命令、重放和收据都重查当前主体、目标源留存及当前可读 Ticket/canonical关联；新写／重放另外验证上述已确认显式处置 predicate。收据只核对已发生结果，不能自动重发或代为处置。失权、换账号、body迟到、retention失效时及时取消并清该 scope 的显示/恢复；保留其它仍获权对象。404对未获权/不存在材料不泄漏目标，401无身份、403动作/CSRF不允许、400字段/标记/引用格式错误、409同 UUID 异意图或原目标关系冲突、503缺必要 Schema/服务；均不得返回假成功。失败收据只返回实际已记录的安全 code；无原 receipt 为 UNKNOWN，不推断未执行。

## 原 ledger、原通信与最小前向 DB 必要性

复用 [P2-016 ledger](../../../src/p2-016-ticket-command-ledger.mts) 的 principal＋purpose＋UUID、原 command hash、先授权再 receipt、事务/savepoint和追加审计，不建第二命令账本。计划新增该原 ledger 的 `WORKBENCH_SUPPLEMENT_FOLLOW_UP` receipt用途；当前用途枚举尚不含它。UUID 同 hash 重放原 resolution，异 hash409。处置 note 与 exact-target completion evidence 必须同一事务全部成功或失败，Ticket/事件/双责任/个人read保持原事实。它不是普通 Ticket add-note 后隐式“清空所有补充”。

确实需要最小前向持久化：追加式 exact-target disposition evidence，以及 bound reply 的 target→原 Message/必要 Delivery 绑定与可核验成功依据。只存真实 source identity/revision、原 command/message引用、依据、内部 actor/time；不复制材料正文、Ticket生命周期、负责人或全局已清位置。唯一性保证同一材料的有效解除依据不重复；不丢弃真实的多个内部处置记录。待跟进由真实补充减去该目标成功依据派生，不创建独立可随意覆盖的 clear-all 状态。**迁移编号 UNALLOCATED_NOT_APPLIED**；本 SOURCE 没有 SQL、迁移器或历史迁移修改。

绑定必须在现有 Communication commit 事务内捕获/验证 exact target，并随原 Message/Outbox/Delivery成功提交；当前 seam 尚需最小前向扩展，不能声称已经支持 caller transaction。新字段纳入原消息 UUID 意图 hash，同 UUID 不可换目标。Worker/reconciliation只从实际原 Message目的/Session源绑定和所有必要 Delivery 的可核验成功终态生成该目标 `VERIFIED_REPLY`；部分成功、PENDING、FAILED、UNKNOWN不清，普通未绑定消息不清。Sender ACK或合法 CONFIRMED_SENT核对是既有发送事实，不能声称客户端已阅读或强@已显示。核对权不由T36放大。重复 callback/重放不清后来修订；DB证据写入失败应从原成功事实有界补偿，不能再次外发。

## 资源、关闭与验证状态

计划 option `workbenchSupplementFollowUpEnabled`／bootstrap capability 默认 false；关闭不接受新T36命令，不展示新提醒，保留原证据、个人位置与业务事实。单App/Worker/Gateway单活，SSE32，现有pool总预算≤8；page≤100、query/body采用原W32KiB与2048-byte URL预算，reply text≤20480/UI≤2000。复用原Worker有界批次，不为材料开timer或新增poller/常驻服务；原消息既有完成事实仍可安全恢复，关闭不触发新发送。

本 SOURCE 首测试、strict、build、artifact、Unit/Contract/Integration、真实HTTP／浏览器和全部运行清理均 **NOT_RUN**。新Schema未注册为运行制品，必须在实际实现消费它们时按既有资源登记规则补齐。下一独占窗口先冻结真实测试对象并运行原 first，保留真实 RED，再做一个最小纵切；其余七项矩阵见 [本票执行记录](../../../plans/admin-workbench-integration/execution/t36.md)。不引用静态接口存在作为运行验收，不启真实依赖/发送/部署或Gate。

## 2026-10-14 固定 Rootb580 SOURCE 同步

普通 merge 继承 `b5808ee88ee749df61a6a82708d1d5bd26971743` 的 T13/T29/T30/T31/T32/T34 已集成事实与当前授权／恢复边界；本票仍 SOURCE_PROPOSED_NOT_MOUNTED，原typed、五Schema和首例未改。T36仅精确补充材料显式处置，不是 Ticket/Incident 接管，也不授现有 REPLY/INTERNAL_NOTE/Delivery控制权。当前人类规则仍为 active business-authorized staff AND exact material READ+retained，无assignee/Conversationowner前提。

本有限授权没有数据库迁移编号或DDL，不运行严格类型／构建／制品／测试／PG／HTTP／浏览器；全部原七 PENDING、runtime NOT_RUN。未来连续 WHOLE 先普通合并届时最新Root，冻结实际Source/制品并运行原public first，真实RED后才做最小生产实现；不改旧031/042/047/050/044/055/058或其目的guard，不新建Ticket/通知/命令事实源。
