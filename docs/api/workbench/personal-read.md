# 个人阅读位置（WBINT-T35，计划合同）

**状态：PLANNED / SOURCE_ONLY / NOT_BUILT_NOT_RUN。** 本文冻结首个真实验证片的目标合同；下面的新入口尚未挂载，不列入已实现路径索引。来源是 [T35 #90](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/90)、[WBINT-12](../../../plans/admin-workbench-integration/implementation-plan.md#wbint-12个人已读关注团队待跟进与共享预约)、[ADR-0031](../../../adr/0031_human_workbench_collaboration_policy.md)。整票实施与证据见 [执行记录](../../../plans/admin-workbench-integration/execution/t35.md)。

## 入口与权限

宿主 W，同源正式管理端。原 Cookie/Bearer 认证、当前活动内部主体、获权事项及每个真实来源的保留期和独立 Journey/Session 范围继续适用。读取 Ticket 不能绕过关联 Review/Journey 来源权限。只操作本人位置；不接受主体、Reporter、Bot、群、外部目标或浏览器自报角色。

| 计划 METHOD + PATH | 输入 | 目标结果 |
| --- | --- | --- |
| `GET /api/workbench/items/{ticket\|review\|intake}/{id}/read-position` | UUID；`limit?` 默认50/最大100，`cursor?` 当前主体、请求事项、来源范围绑定的有界 keyset；未知/重复 query 拒绝 | 200，ReadPositionPage；GET 没有写副作用 |
| `POST /api/workbench/items/{ticket\|review\|intake}/{id}/read-position` | 单一确切来源材料命令，JSON最多8KiB，无 query | 200，ReadPositionAcknowledgement；只有确认提交后更新显示 |
| `GET /api/workbench/items/{ticket\|review\|intake}/{id}/read-position/commands/{commandId}` | UUID，无 query；当前主体/来源/固定用途范围 | 200，UNKNOWN 或 COMMITTED 安全收据；只读核对，不包含正文 |

POST 必须带 `Content-Type: application/json`、`Idempotency-Key` 与 body UUID 精确相同；Cookie 模式精确 Origin、非 cross-site 和当前 `X-CSRF-Token`。没有 Ticket/Review If-Match：阅读不改这些业务版本。非 Session 位置按同源最大值原子推进，无需用旧个人行版本拒绝合法的新看到材料；同一命令不同意图409。闭合命令 [schema](../../../contracts/workbench_personal_read_command.schema.json) 的目标形状：

```json
{"client_command_id":"22222222-2222-4222-8222-222222222222","source_ref":"web:11111111-1111-4111-8111-111111111111","revision":"2"}
```

服务端从真实、当前可读、未过期的 `source_ref` 派生来源类型、Intake 和其独立位置。客户端不能提交任意 `source_key`、当前 metadata 高水位或全局版本。`channel:` 后为数据库 Channel Message BIGINT 字符串；`web:` 后为 Web Submission UUID；`manual:` 后为 Intake UUID。引用与 revision 必须精确匹配持久材料；不存在、外域、过期与不可见材料统一404。隐藏权限判断在 LIMIT 前。

## 阅读坐标与规范事项

| 来源 | 权威位置 | 独立范围 |
| --- | --- | --- |
| BOT 原材料及后来渠道接触段 | `service_intake_message.sequence_no` 十进制string | 每个真实 source Intake；不同 Leg 从1开始，不能混为一个序列 |
| WEB 初报/补充 | `web_submission.input_revision` 十进制string | 同一 `web_request_binding.intake_id`，不是 processed_revision |
| PHONE/ON_SITE 代录 | immutable 手工来源 revision `"1"` | 实际 MANUAL Intake，不制造会话 |
| Conversation 时间线 | `conversation.item.sequence_no`；原 Control personal cursor | 每个真实 Session，继续使用现有 `POST /api/conversations/{sessionId}/read-cursor` 和其安全整数/CAS合同 |

新非 Session 行**不保存 Session cursor**。同一个 Bot 材料的 Intake序列和投影到 Session后的Item序列不能互相赋值。当前 Session/Workbench 详情、材料分页见 [会话合同](conversations.md)；Review来源 `source_ref/revision`、有界裁剪与 canonical见 [复核合同](manual-reviews.md)。这两种显示可以描述同一内容，但分别保持真实序列和当前独立权限。

ReadPositionPage 的闭合 [schema](../../../contracts/workbench_personal_read_page.schema.json) 返回 `canonical_item,sources,next_cursor`。每项只含 `source_key`（服务端派生的64hex不透明稳定锚点）、`source_kind:BOT|WEB|MANUAL`、`last_read_position`（十进制string，可0）、`latest_position`（当前获权且保留材料的真实最大位置）、`row_version`（string，可0）和 `has_unread_material:boolean`。`latest_position` 只用于提示，不能自动作为写目标。有界页面不冒充全量未读条数；加载之外的材料不能由页面开关标为已看。

Review→Ticket只改变当前获权导航：个人行绑定 principal+真实来源，不能按 alias复制或两卡计数。旧Review入口先重验其自身权限/保留期，过期不会借可读Ticket恢复。未来 board/list 个人提示从同一个获权来源关系派生，并沿原canonical去重，不复制Ticket/Owner状态。

ACK 的闭合 [schema](../../../contracts/workbench_personal_read_acknowledgement.schema.json) 返回 `ok:true,client_command_id,source_key,source_kind,last_read_position,row_version,replayed`，不返回材料正文、团队跟进、责任或Ticket事件。闭合 [收据schema](../../../contracts/workbench_personal_read_receipt.schema.json) 的 UNKNOWN不能推断未提交；COMMITTED只含此安全ACK。先重新验当前源权限，再读固定用途收据。传输未知不显示已读，不保存正文或无限恢复任务，不自动反复POST；下次真正可见观察先获权GET后按精确坐标核对。

## 前端真正看到的边界

只观察已经完成安全解码、实际渲染且正文在当前视口内的那条材料。当前document必须前台可见并有焦点；读目标、账号、授权epoch和当前已挂载事项/Session必须一致。打开抽屉、GET、预加载、SSE失效、成功刷新时间、presence、最新metadata、同事查看、后台页或视口之外的DOM均不推进。无可显示正文的占位、折叠/未加载材料不冒充已看。恢复可见后重新核验当前对象，再考虑实际显示内容。

复用现有 Query/authorization epoch/AbortSignal 与唯一 realtime controller；新read查询纳入现有主体及对象清理覆盖面。主体401/bootstrap403、退出/账号切换取消旧观察和请求并清全部该主体显示；对象403/404清精确来源/事项，保留其它仍可读对象。迟到成功或旧tab观察不能给新账号写位置。没有新增EventSource、轮询器、每材料timer、草稿或凭据持久化。

个人已读不执行业务命令、不变更Ticket、Conversation Assignment、Generation、Intake判定或团队补充待跟进。团队待跟进须由后续T36的明确处置事实拥有；T36目前未交付，本票不伪造其API或提前关闭它。

## 数据库、幂等与资源提案

**047 RESERVED_NOT_APPLIED；本阶段没有SQL或迁移器。** 若首个真实RED证明需要跨来源持久化，最小前向047只增加个人材料位置关系（principal+source_kind+source_intake唯一，position/row_version BIGINT、更新时间）；Session沿021原表。没有Ticket编号/状态/负责人/团队处置副本。

复用当前 `pilot_ticket.ticket_command_receipt` ledger；031原resource约束只接受Ticket或Review，裸Intake读不能伪造其中任一。047可最小增加 nullable真实 `source_intake_id`外键和扩大该resource约束，使同一ledger支持本用途；不建立第二命令账本，不改031字节。归一化幂等意图包含当前principal、固定用途、真实source Intake/source_ref/revision，不以canonical alias变动产生第二次推进；重新授权在receipt lookup前。同事务锁当前源、验证引用/留存、提交个人行与receipt；旧position通过GREATEST保持单调，旧read不回退。具体列/约束/迁移检查在RED后的最小实现冻结并独立验收，提案不是应用事实。

目标新 option `workbenchPersonalReadEnabled=false`；bootstrap字段 `personal_read_enabled=false`。关闭时新入口503且在本票查询/写库前返回，停止观察/UI提示；原会话Control和受理链路继续可用，已提交位置/receipt保留。默认仍一App/API/SSE、一Worker、Gateway单活、SSE32、应用池总量建议≤8；本票无新worker。当前页面最多100来源、原材料50/20k或现有400会话Item上限；观察只服务当前获权有界DOM并及时disconnect。

计划错误边界：400闭合字段/UUID/ref/revision/重复query；401主体认证；403Origin/CSRF/角色；404当前来源/留存/错误关联；409同UUID改意图；413正文过大；503关闭/不可用。错误不输出SQL、数据库URL、原始Provider内容或外部身份。测试只合成PG、同源HTTP、正式bundle、系统浏览器及受控平台可见性，不调用真实OAuth/WeCom/目录/模型，不外发/部署/full/certify/Gate推进。
