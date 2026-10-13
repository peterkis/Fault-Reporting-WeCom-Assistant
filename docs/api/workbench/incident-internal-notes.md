# Incident 内部处置记录（WBINT-T30）

返回 [API 导航](../README.md) · [路径索引](../endpoint-index.md) · [原 Incident](incidents.md) · [执行记录](../../../plans/admin-workbench-integration/execution/t30.md)

状态：`LOCAL_SYNTHETIC_IMPLEMENTED_DEFAULT_OFF`。来源 WBINT-10/A10；2026-10-13 在独立 T30 私树完成原七项所需本地实现与合成验证，功能被测提交 `b44cdc978bfbc0a9db6288c4da792dc023cb639f`。宿主默认关闭，未部署、未连接真实外部服务；父验收、Root 集成和 Issue 收口由父任务处理。

历史 SOURCE：2026-10-12 的 `PROPOSED_NOT_MOUNTED`、原三份 Schema/type 标题及 D handoff 保留原字节，不改写成当时已运行。本次新增能力 Schema 独立记录 bootstrap 两个默认 false 字段。

## 权限、受众和输入

沿原 Incident 当前身份、对象读取和动作／范围政策：仅当前有效 ADMIN 或 DISPATCHER。ADMIN 可操作其当前获权的各范围；DISPATCHER 默认只可 LOCAL/BUILDING，CAMPUS 仅沿独立已批准且实际装配的既有策略，不能凭 body、页面角色或 owner 扩权。HOSPITAL_WIDE 只允许 ADMIN。HANDLER 的关联 Ticket 读取、本人 Report 恢复或 Incident owner 身份均不产生内部记录读写权；T36 的人员规则不适用于本票。

`CLOSED` 保持原拒写规则；其他既有非 CLOSED 状态可追加记录。对已有记录的内部获权查询不改状态。记录只追加，不提供编辑、删除、发布或转成外部回复的命令。

| 当前路径（W，独立默认关闭） | 输入 | 输出 |
| --- | --- | --- |
| `POST /api/incidents/{incidentId}/internal-notes` | 当前 Cookie、同源 Origin、CSRF、Idempotency-Key、精确双引号 If-Match；下述五字段 JSON；禁止 query | 原 Incident 六字段成功回执或既有安全失败结构；仅 `result_ref_type=INCIDENT` |
| `GET /api/incidents/{incidentId}/internal-notes` | cursor?；limit 默认30/最大100；当前内部用途权限 | `[IncidentInternalNotePage](../../../contracts/workbench_incident_internal_note_page.schema.json)`；无总数承诺 |
| `GET /api/incidents/{incidentId}/commands/{commandId}` | 无 query；当前对象及原 ADD_INTERNAL_NOTE 用途权限，原主体绑定 | 沿 T28 [原账本安全回执](../../../contracts/p2_012_incident_followup_receipt.schema.json)：UNKNOWN/FAILED/COMMITTED，不返回正文/hash；当前授权仍先于读取原终态 |

POST Body 见 [命令 Schema](../../../contracts/workbench_incident_internal_note_command.schema.json) 和 [独立类型](../../../contracts/workbench_incident_internal_notes_contracts.d.ts)：`client_command_id:UUID, expected_row_version:十进制string, reason_code:WORKBENCH_INTERNAL_DISPOSITION, audience:INTERNAL, text:plain text`。路径注入 `incident_id` 和服务动作 `ADD_INTERNAL_NOTE`，body 不可覆盖动作／对象／actor。版本上限 PostgreSQL BIGINT，不经 Number 转换。正文最长2000 Unicode code points/8192 UTF-8 bytes，拒绝纯空白与控制字符（允许 tab/CR/LF）；不作为 HTML 渲染。HTTP 总 body 仍为32KiB；未知字段、URL/弱或错误 If-Match 拒绝。

## 原子记录与私有投影

沿唯一 `incident.command_receipt` 的当前主体 scope、原 UUID、规范 body hash、父版本及锁序，当前权限先于重放／回执结果读取。获权且版本匹配后，同事务父 `row_version+1`、追加 `incident.internal_note_added`、actor、服务器秒精度 Asia/Shanghai 时间、event_ordinal 和原收据；竞争只一次合法追加，失败不留下部分记录。同 UUID/同 body 返回原结果，异 body 冲突。未知响应保留原 UUID/body/版本，先显式只读核对；UNKNOWN 不证明失败，不自动另建意图或重发。

最小 additive [DDL055](../../../database/migrations/055_workbench_incident_internal_notes.sql) 扩展原 command/event 类型 CHECK，在原 Incident Event 增加 `internal_note_text`、`internal_note_incident_version`、私有 shape CHECK 与部分分页索引。正文与原 `safe_payload` 分开；内部事件的 `safe_payload={}`，公开事件 DTO、SSE 和通知不装入文字。仍是一条 Incident Event 事实，无第二 ledger/owner/Ticket/note 表；原032、旧39份SQL及13份 p2_012 合同不改写。

原032已按原工具完成后，使用本次编译工具 `node .build/runtime/scripts/incident-internal-notes-migrate.mjs --check|--apply|--status`（三选一；`PILOT_DATABASE_URL` 仅指向另行获权数据库）。默认 check 在同事务 savepoint 应用055并验证实际结构后回滚；apply 核原032 checksum、记录055 checksum；重复执行验证实际结构和 marker 后 NOOP。未经标记的部分055、marker/checksum不符或相关 CHECK/index 漂移均失败关闭。只核055两列、相关三 CHECK 与一个 index，不宣称完整数据库认证；本轮只在自有隔离合成 PG18 运行，未应用任何现场数据库。

私有 GET 只返回该 Incident 已获权内部记录：event UUID、Incident ID、event ordinal、提交时父版本、内部 actor UUID、可空当前显示名、时间、`audience=INTERNAL` 与正文。actor 显示名是当前提示，不反写历史主体。游标绑定 Incident、当前主体／范围及 ordinal/UUID，SQL 先授权再分页。不能以 page.length 声称总数。原 `/events` 窄权限公开类型、Reporter milestones、群／单聊／应用订阅通知均排除该内部正文；不调用 Communication append/通知 policy，不改变订阅、Ticket 状态／责任、公开进展或恢复/关闭事实。若需 SSE，仅沿唯一原流安全失效提示，payload 无内部正文。

## 开关、恢复与限值

宿主选项 `incidentInternalNotesEnabled=false`；还须原 correlation 和 candidate workspace 装配。关闭时不访问055字段、不挂载新读写或恢复用途，保留已有事件及原 T28；开启但缺055实际结构证明时失败关闭。bootstrap 通过独立 [能力 Schema](../../../contracts/workbench_incident_internal_note_capability.schema.json) 返回 `incident_internal_notes_enabled` 与 `incident_internal_note_draft_recovery_enabled`；恢复还依赖既有 `workbenchDraftRecoveryEnabled`，两者默认 false。关闭没有破坏性 down migration，也不撤销任何已提交事实。

正式前端沿已有 encrypted draft seam，绑定当前 principal/浏览器/Incident/独立 `incident-internal-note` purpose，最长24小时、16KiB、最多20份；恢复先重验当前 session、对象与原用途。私有历史每页30，最多保留最近三页；当前页和已加载数量不代表全部。提交已知成功、显式丢弃、退出或失权清理；晚到 GET/ACK 不恢复已撤销内容，权限变化不替代已有服务器提交结论。

丢 ACK 后保留原 UUID/body/提交版本，先显式只读核对；仅当前用途仍有效、原正文存在且明确核对 UNKNOWN 后才允许人工重放相同意图。CLOSED 或失权清理敏感正文，原 UUID 的未知状态独立保留，不能因此视为失败或生成新操作。恢复从开始关闭时不建立持久副本；当前页面仍保留原 UUID/提交版本以核对 CLOSED 后的已提交结果，刷新后的恢复仅在恢复开关开启且既有副本有效时提供。已知提交、恢复副本清理和开启新意图分别确认；输入保留不能自动外发。

复用单 App/API/SSE 与既有池；SSE默认32，总池建议≤8，合成 fixture 单池≤4、并发1，没有新 Worker/流/进程/每记录 timer。D 证据根 `D:/wecom-workbench-evidence/t30/whole-after-t13-20261013`：原7976B首例006真实404 RED→008 GREEN；当前039 strict/build/artifact通过，040同制品9文件/14 PASS/0 SKIP，含真正 HTTP、隔离PG、正式900/1920 bundle、24h恢复/失权/丢ACK和恢复关闭审查修补。029相关12 PASS保留其真实61f1身份，精确修补没有改变旧generic draft/T28或共用后端行为，未重标为新提交运行。

044最终清理：本次自有PID29208 pre0/stop0/post3、pidfile缺失、精确62775 LISTEN0、config原SHA、keeper STOPPED/pidnull/cleanuptrue。早先030/031的连接观察 UNKNOWN/native1保留，不能称 CONNECTION_REFUSED；032和044的准确无监听证据单独记录。无真实外部服务／发送、部署、push、PR、full/certify 或 Gate。
