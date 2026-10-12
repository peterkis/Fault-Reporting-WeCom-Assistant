# Incident 内部处置记录（WBINT-T30）

返回 [API 导航](../README.md) · [路径索引](../endpoint-index.md) · [原 Incident](incidents.md) · [执行记录](../../../plans/admin-workbench-integration/execution/t30.md)

状态：`PROPOSED_NOT_MOUNTED`。2026-10-12 仅冻结 SOURCE 合同和首条 tracer 源码；未构建、未挂载、未运行，没有 RED/GREEN 或业务验收。来源 WBINT-10/A10，前置 T28 已由父任务核验、集成并关闭；新票仍须自己的整票证据。

## 权限、受众和输入

沿原 Incident 当前身份、对象读取和动作／范围政策：仅当前有效 ADMIN 或 DISPATCHER。ADMIN 可操作其当前获权的各范围；DISPATCHER 默认只可 LOCAL/BUILDING，CAMPUS 仅沿独立已批准且实际装配的既有策略，不能凭 body、页面角色或 owner 扩权。HOSPITAL_WIDE 只允许 ADMIN。HANDLER 的关联 Ticket 读取、本人 Report 恢复或 Incident owner 身份均不产生内部记录读写权；T36 的人员规则不适用于本票。

`CLOSED` 保持原拒写规则；其他既有非 CLOSED 状态可追加记录。对已有记录的内部获权查询不改状态。记录只追加，不提供编辑、删除、发布或转成外部回复的命令。

| 候选路径（W） | 输入 | 输出 |
| --- | --- | --- |
| `POST /api/incidents/{incidentId}/internal-notes` | 当前 Cookie、同源 Origin、CSRF、Idempotency-Key、精确双引号 If-Match；下述五字段 JSON；禁止 query | 原 Incident 六字段成功回执或既有安全失败结构；仅 `result_ref_type=INCIDENT` |
| `GET /api/incidents/{incidentId}/internal-notes` | cursor?；limit 默认30/最大100；当前内部用途权限 | `[IncidentInternalNotePage](../../../contracts/workbench_incident_internal_note_page.schema.json)`；无总数承诺 |
| `GET /api/incidents/{incidentId}/commands/{commandId}` | 无 query；当前对象及原 ADD_INTERNAL_NOTE 用途权限，原主体绑定 | 沿 T28 [原账本安全回执](../../../contracts/p2_012_incident_followup_receipt.schema.json)：UNKNOWN/FAILED/COMMITTED，不返回正文/hash；此新用途当前尚未挂载 |

POST Body 见 [命令 Schema](../../../contracts/workbench_incident_internal_note_command.schema.json) 和 [独立类型](../../../contracts/workbench_incident_internal_notes_contracts.d.ts)：`client_command_id:UUID, expected_row_version:十进制string, reason_code:WORKBENCH_INTERNAL_DISPOSITION, audience:INTERNAL, text:plain text`。路径注入 `incident_id` 和服务动作 `ADD_INTERNAL_NOTE`，body 不可覆盖动作／对象／actor。版本上限 PostgreSQL BIGINT，不经 Number 转换。正文最长2000 Unicode code points/8192 UTF-8 bytes，拒绝纯空白与控制字符（允许 tab/CR/LF）；不作为 HTML 渲染。HTTP 总 body 仍为32KiB；未知字段、URL/弱或错误 If-Match 拒绝。

## 原子记录与私有投影

沿唯一 `incident.command_receipt` 的当前主体 scope、原 UUID、规范 body hash、父版本及锁序，当前权限先于重放／回执结果读取。获权且版本匹配后，同事务父 `row_version+1`、追加 `incident.internal_note_added`、actor、服务器秒精度 Asia/Shanghai 时间、event_ordinal 和原收据；竞争只一次合法追加，失败不留下部分记录。同 UUID/同 body 返回原结果，异 body 冲突。未知响应保留原 UUID/body/版本，先显式只读核对；UNKNOWN 不证明失败，不自动另建意图或重发。

计划最小 additive DDL 编号055，仅预留，**本轮无 SQL 文件或执行**：原 command/event 枚举的必要增量及原 Incident Event 的专用内部正文存储。正文与原 `safe_payload` 分开，原 `safe_payload`、SSE 和公开事件 DTO 不装入文字。仍是一条 Incident Event 事实，无第二 ledger/owner/Ticket/note 事实源；原032及13份 p2_012 合同不改写。正式 DDL 及 migrate/check/status/回退证明在未来 WHOLE 窗口实施。

私有 GET 只返回该 Incident 已获权内部记录：event UUID、Incident ID、event ordinal、提交时父版本、内部 actor UUID、可空当前显示名、时间、`audience=INTERNAL` 与正文。actor 显示名是当前提示，不反写历史主体。游标绑定 Incident、当前主体／范围及 ordinal/UUID，SQL 先授权再分页。不能以 page.length 声称总数。原 `/events` 窄权限公开类型、Reporter milestones、群／单聊／应用订阅通知均排除该内部正文；不调用 Communication append/通知 policy，不改变订阅、Ticket 状态／责任、公开进展或恢复/关闭事实。若需 SSE，仅沿唯一原流安全失效提示，payload 无内部正文。

## 开关、恢复与限值

候选宿主选项 `incidentInternalNotesEnabled=false`；还须原 correlation 和 candidate workspace 装配。关闭时不访问055字段、不挂载新读写或恢复用途，保留已有事件及原 T28；缺055证明时失败关闭。关闭没有破坏性 down migration，也不撤销任何已提交事实。

正式前端沿已有 encrypted draft seam，绑定当前 principal/浏览器/Incident/独立 `incident-internal-note` purpose，最长24小时，恢复先重验当前 session、对象与原用途。提交已知成功、显式丢弃、退出或失权清理；晚到 GET/ACK 不恢复已撤销内容，权限变化不替代已有服务器提交结论。原意图已知结论、恢复副本清理和开启新意图分别确认；输入保留不能自动外发。

复用单 App/API/SSE 与既有池；SSE默认32，总池建议≤8，无新 Worker/流/进程/每记录 timer。首例只验证真实 HTTP 保存后获权内部查询可追溯；其余隐私、权限、并发/失权、响应丢失、24h输入与正式 bundle 900/1920 等逐行为 RED→最小 GREEN，不预写整套测试。全部运行和清理当前 `NOT_RUN`；无真实外部服务／发送、部署、push、PR、full/certify 或 Gate。
