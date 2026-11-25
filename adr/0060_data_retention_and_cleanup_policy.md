# ADR-0060：业务数据留存到期口径与批量清理策略

Status: Accepted（2026-11-25，产品负责人 Peter 决定）

## 决策（Decision）

**生产工单及其全部关联数据行永久保留。H5 媒体文件是全量保留的例外。** 既有 H5 媒体 Worker 启用时继续清理到期的原件、播放副本和缩略图，包括已绑定到工单的文件。清理后保留媒体上传记录并标记清理时间。工单、受理、消息、事件、报修人档案及其他关联数据行均不删除或匿名化。未建单的业务数据行目前也原样保留。Peter 确认目前没有具体的生产合规要求需要为这些记录设定删除或匿名化期限。

42C 清理器只按留存字段统计到期候选行。

## 1. 背景与问题

截至迁移 `074_system_closure_restore.sql`，仓库中有 **11 张业务与运维表** 存储了 `retention_until` / `retention_until_epoch_ms` 到期字段，另有附件上传表 `intake.web_media_upload` 存储了与父级 `retention_until_epoch_ms` 绑定的 `expires_epoch_ms`。然而在运行时代码中，目前只有以下局部清理逻辑：

- `conversation.realtime_event`：`app/server/src/p2-003-realtime-event-log.mts` / `app/server/scripts/p2-003-retention.mjs`（仅清理 SSE 回放投影，非业务事实）；
- `pilot_ticket.workbench_login_intent` / `workbench_auth_session` / `workbench_auth_event`：`app/server/src/p2-016-workbench-wecom-auth.mts`；
- `workbench.actor_avatar_cache`：`app/server/src/workbench-actor-avatars.mts`（头像缓存）；
- `intake.web_media_upload` 关联的磁盘文件由既有 H5 Worker 按上传到期时间清理（见第 6 节第 5 项）。
- `directory.*_current`：`app/server/src/p2-007-staff-directory-store.mts`（全量目录同步覆盖）。

上述 11 张承载业务或留存承诺的表没有留存到期清理任务。迁移 `077_retention_and_time_contract.sql` 为其中 9 张表补齐了到期扫描索引。`intake.service_intake` 与 `pilot_ticket.ticket` 之间存在双向外键，相关数据还受延迟外键、立即 `CHECK`、不可变触发器及 20 余张子表引用约束。工单及其关联数据共同保留了 Unified Ticket Core 的事实与审计链路。

## 2. 存量 `retention_until` / `retention_until_epoch_ms` 表盘点

### 2.1 持有 `retention_until*` 的 11 张表

| # | 表名 | 引入/双字段迁移 | 列类型与非空性 | 主键 / 游标键 | 到期扫描索引（077 后） | 语义说明 |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `channel.message_inbox` | `001` / `022` | `retention_until` + `retention_until_epoch_ms` (`NOT NULL`) | `id BIGINT` | `channel_message_inbox_retention_epoch_idx (retention_until_epoch_ms, id)` | 企业微信入站原始帧与幂等响应快照 |
| 2 | `intake.service_intake` | `002` / `022` | `retention_until` + `retention_until_epoch_ms` (`NOT NULL`) | `id UUID` | `service_intake_retention_epoch_idx (retention_until_epoch_ms, id)` | 服务受理记录（含来源群/用户/摘要/代录快照） |
| 3 | `operations.backup_checkpoint` | `009` / `022` | `retention_until` + `retention_until_epoch_ms` (`NOT NULL`) | `id UUID` | `operations_backup_retention_epoch_id_idx (retention_until_epoch_ms, id)` | 加密备份校验点元数据（被 `restore_drill` 引用） |
| 4 | `conversation.item` | `011` / `022` | `retention_until` + `retention_until_epoch_ms` (`NOT NULL`) | `id UUID`; `UNIQUE(session_id, sequence_no)` | `conversation_item_retention_epoch_idx (retention_until_epoch_ms, session_id, sequence_no)` | 服务会话时间线投影项（含可见文本与结构化内容） |
| 5 | `communication.message` | `020` / `022` | `retention_until` + `retention_until_epoch_ms` (`NOT NULL`) | `id UUID` | `communication_message_retention_epoch_idx (retention_until_epoch_ms, id)` | 对外沟通消息与内部协作备注实体 |
| 6 | `intake.contact_journey` | `030` | `retention_until` + `retention_until_epoch_ms` (`NOT NULL`) | `id UUID` | `contact_journey_retention_epoch_idx (retention_until_epoch_ms, id)` | 报修接触旅程（含人员资料快照 JSON） |
| 7 | `incident.incident` | `032` | `retention_until` + `retention_until_epoch_ms` (`NOT NULL`) | `id UUID` | `incident_retention_epoch_idx (retention_until_epoch_ms, id)` | 人工确认公共故障主表 |
| 8 | `intake.web_submission` | `033` | `retention_until` + `retention_until_epoch_ms` (`NOT NULL`) | `id UUID` | `web_submission_retention_epoch_idx (retention_until_epoch_ms, id)` | H5 网页初始报修/补充原始内容与位置描述 |
| 9 | `intake.web_request_binding` | `033` | `retention_until` + `retention_until_epoch_ms` (`NOT NULL`) | `intake_id UUID` | `web_request_binding_retention_epoch_idx (retention_until_epoch_ms, intake_id)` | H5 报修人与受理工单的 HMAC 绑定凭据 |
| 10 | `intake.web_report_urge` | `064` | `retention_until_epoch_ms` (`NOT NULL`, 无本地时间列) | `id UUID` | `web_report_urge_retention_epoch_idx (retention_until_epoch_ms, id)` | H5 报修人催单记录 |
| 11 | `intake.web_report_evaluation` | `064` | `retention_until_epoch_ms` (`NOT NULL`, 无本地时间列) | `id UUID` | `web_report_evaluation_retention_epoch_idx (retention_until_epoch_ms, id)` | H5 报修人完工评价记录 |

### 2.2 紧密关联但无独立 `retention_until*` 的表与本地文件

- `intake.channel_leg`（`030`）：无独立留存列，继承父级旅程/受理留存上下文，受 `contact_journey(id) ON DELETE CASCADE` 与 `service_intake(id)` / `web_submission(id, intake_id)` / `channel.message_inbox(id) ON DELETE RESTRICT` 约束。
- `intake.web_media_upload`（`065`/`066`/`069`/`070`）使用 `expires_epoch_ms`。预留上传时，系统将到期时间设为预留时间加 24 小时。绑定时重新取四个截止时间中的最早值：绑定调用传入的 `retentionUntilEpochMs`，以及 `web_request_binding`、`web_submission`、`service_intake` 各自的 `retention_until_epoch_ms`。原件、播放副本和缩略图共用该上传记录的到期时间。
- `intake.ticket_reporter_profile`（`067`）：无 `retention_until*`，设计注释明确指出「Necessary Ticket contact records outlive the source message's retention window」，且持有 `source_intake_id REFERENCES intake.service_intake(id) ON DELETE RESTRICT` 与 `ticket_id REFERENCES pilot_ticket.ticket(id) ON DELETE RESTRICT`。
- `pilot_ticket.ticket`、`pilot_ticket.ticket_event`、`pilot_ticket.ticket_handling_cycle`、`pilot_ticket.closure_record`：Unified Ticket Core 核心表，本身无 `retention_until*` 列。
- 已存在专用清理的任务表：`conversation.realtime_event`（`p2-003-retention.mjs`）、`workbench_login_intent` / `workbench_auth_session` / `workbench_auth_event`（`p2-016-workbench-wecom-auth.mts`）、`workbench.actor_avatar_cache`（`workbench-actor-avatars.mts`）。

## 3. 外键依赖图、立即 `CHECK` 与不可变触发器约束

```text
channel.message_inbox
  ├──[RESTRICT]── intake.service_intake (primary_message_id)  <──────────────────┐
  ├──[RESTRICT]── intake.service_intake_message (channel_message_id)             │
  ├──[RESTRICT]── intake.channel_leg (origin_channel_message_id)                 │
  └──[RESTRICT]── pilot_ticket.ticket_supplement (channel_message_id)            │
                                                                                 │
intake.service_intake  <══[循环边+配对触发器]══>  pilot_ticket.ticket            │
  │ (service_intake.pilot_ticket_id -> ticket.id [RESTRICT]; 003 立即 CHECK)    │
  │ (ticket.source_intake_id -> service_intake.id [RESTRICT]; 003 延迟配对触发器)│
  │                                                                              │
  ├──[循环边/DEFERRED]── intake.web_submission                                   │
  │     (primary_web_submission_id, id -> web_submission [DEFERRABLE DEFERRED];  │
  │      042 service_intake_web_source_check 立即禁止 PORTAL 行置空该列!)         │
  │     └── web_submission.intake_id -> service_intake.id [RESTRICT]             │
  │     └── web_submission.(intake_id, canonical_reporter_binding)               │
  │            -> web_request_binding [RESTRICT]                                 │
  ├──[CASCADE]── intake.service_intake_message / service_intake_event            │
  ├──[CASCADE]── pilot_ticket.closure_record / closure_supplement_termination    │
  └──[RESTRICT/NO ACTION]── conversation.session, intake.contact_journey,        │
       intake.channel_leg, intake.deterministic_decision, intake.manual_review_item,
       intake.web_request_binding, intake.web_report_urge, intake.web_report_evaluation,
       intake.ticket_reporter_profile, intake.web_command_receipt (result_intake_id),
       incident.incident_report, pilot_ticket.ticket_handling_cycle,
       pilot_ticket.ticket_command_receipt, pilot_ticket.workbench_item_follow,
       pilot_ticket.personal_material_read_position,
       pilot_ticket.workbench_supplement_disposition,
       pilot_ticket.workbench_supplement_reply_binding

pilot_ticket.ticket
  ├──[CASCADE]── ticket_event, closure_record, notification.card_action_task
  ├──[不可变触发器 040/043]──
  │    staff_completion_notification_commitment (BEFORE UPDATE OR DELETE 报错!)
  │    ticket_cycle_reopen (BEFORE UPDATE OR DELETE 报错!)
  ├──[RESTRICT + 二级信号]──
  │    follow_up_schedule -> follow_up_schedule_revision -> follow_up_due_signal (053 RESTRICT!)
  └──[RESTRICT/NO ACTION]── ticket_handling_cycle, ticket_handling_cycle_event,
       ticket_public_progress, ticket_supplement, ticket_command_receipt,
       workbench_item_follow, personal_material_read_position, reporter_access_grant,
       reporter_access_session, reporter_public_ref, intake.web_report_urge,
       intake.web_report_evaluation, intake.contact_journey, intake.deterministic_decision,
       intake.manual_review_item, incident.incident (primary_ticket_id), incident.incident_report,
       communication.ticket_notification_binding, notification.outbox, notification.delivery
```

现有 Schema 对删除和改写施加了四类硬阻断（任何清理方案都必须显式面对）：
1. **立即 `CHECK` 与配对触发器**：
   - `003` `service_intake_ticket_link_check`：规定 `(pilot_ticket_id IS NULL AND status <> 'TICKET_CREATED') OR (pilot_ticket_id IS NOT NULL AND status = 'TICKET_CREATED')`，且 `ensure_intake_ticket_pair()` 为 `DEFERRABLE INITIALLY IMMEDIATE`，在同事务内不能单独把 `service_intake.pilot_ticket_id` 置为 `NULL`。
   - `042` `service_intake_web_source_check`：立即 `CHECK` 强制 `PORTAL / YIXIAOXIU_WEB` 行的 `primary_web_submission_id IS NOT NULL`，直接 `SET primary_web_submission_id = NULL` 会立刻报错。
   - `033` `service_intake_primary_web_submission_fk` 为 `DEFERRABLE INITIALLY DEFERRED`，`web_submission` 可在先提交的延迟外键窗口内先删或伴随继任迁移解绑。
2. **不可变触发器（`040` / `043`）**：`pilot_ticket.staff_completion_notification_commitment` 的 `completion_commitment_immutable` 与 `pilot_ticket.ticket_cycle_reopen` 的 `cycle_reopen_immutable` 均配置 `BEFORE UPDATE OR DELETE` 无条件抛异常，**无法直接被清理 SQL 删除**。
3. **`053` 级联子表 `pilot_ticket.follow_up_due_signal`**：以 `NO ACTION` / `RESTRICT` 引用 `pilot_ticket.follow_up_schedule_revision(ticket_id, schedule_version)`，清理 `follow_up_schedule_revision` 前必须先删 `follow_up_due_signal`。
4. **终态可恢复/可重开不变量（ADR-0056 / ADR-0058）**：处于 `DISMISSED`（关闭）但仍允许系统恢复（如 `OUT_OF_SCOPE_CONFIRMED` 补充追问触发恢复）或 `COMPLETED`（完成）仍在报修人反馈可重开窗口内的工单，若在窗口期前硬删会破坏恢复/重开契约。

## 4. 已考虑但未采纳的方案

### 方案 A：连同工单本体全量级联删除（Hard Delete Ticket + Intake + Children）

**否决原因**　物理删除会使工单编号、关联记录和事件链消失，违反永久保留生产工单及全部关联数据行的决定。

当 `service_intake`（及其关联工单在满足终态冷静期、无未恢复关闭、无未超期重开窗口且无关联 `incident` 后）到期时，连同 `pilot_ticket.ticket`、`ticket_event`、通知投递及媒体文件一并物理清除。

- **实施前提（若选用方案 A，必须先通过新的已批准架构与迁移 ADR 改造 Schema）**：
  1. 放宽或重构 `003` `service_intake_ticket_link_check`、`042` `service_intake_web_source_check`（允许清理归档态或支持先删 `ticket` 后连带删 `service_intake`）；
  2. 为 `040` `completion_commitment_immutable` 与 `043` `cycle_reopen_immutable` 触发器引入受控系统清理通行口（例如受角色/迁移授权保护的清理豁免或级联策略），否则任何已完工/已重开工单都无法物理删除；
  3. 明确 `DISMISSED`（关闭）可恢复窗口与 `COMPLETED`（完成）可重开窗口均已届满后才允许纳入候选；
  4. 为 `intake.web_media_upload` 建立持久化的磁盘待清理队列（DB 事务内删除记录并写入待删文件路径列表，**仅在 DB `COMMIT` 成功后**执行物理 unlink 与重试；若事务回滚，原 DB 行恢复时磁盘文件仍然完好）。
- **已知依赖及事务顺序（设计草案）**。完整拓扑仍需在已登记的 PG18 Schema 上逐条核对 FK、CHECK、触发器和跨工单共享行。以下依赖须纳入继任迁移的回滚演练，当前不可作为执行脚本。
  1. 锁定候选 Ticket 和 Intake，核实终态、恢复 / 重开窗口、Legal Hold、活动 Incident 和在途投递。出现共享会话、订阅或多受理关联时，先证明所有引用都在本次授权范围内。
  2. 将媒体删除任务与数据库变更放在同一事务。解除媒体、评价、催单、关闭记录、补充跟进、通知绑定、回执和访问授权对父行的引用。先删 053 到期信号，再处理其修订。共享的通信消息和会话须等待最后一个引用解除。
  3. **处理轮次和事件的双向依赖**。039 的即时复合外键要求先将存活 Ticket 的 `current_handling_cycle_id` 置空。先处理指向轮次及完成事件的通知承诺、重开记录与其他子行。040 的 `handling_cycle_completion_event` 反向引用轮次事件，`staff_completion_event_guard` 又禁止清空已记录的 `staff_completion_event_id`。继任迁移须批准受控解绑或改造该反向边，并处理 040 / 043 的不可变行。随后才可删除轮次事件关联、轮次，最后处理它们引用的 Ticket Event。
  4. **先清理会话的引用方**。依次处理引用判定的人工复核、确定性判定、续接引用与渠道腿，最后处理接触旅程。030 中判定及渠道腿的 `conversation_session_id`、旅程的 `origin_session_id` 和 `current_session_id` 都以 RESTRICT 引用会话。确认这些边及通信投递、消息、时间线、责任交接等引用均已解除后才能删除对应会话。
  5. 完成 003 / 042 的检查约束改造，按 033 延迟外键和实际引用处理网页提交、受理、Ticket 及事件。仅在事务提交后，执行器才能按持久队列删除媒体原件与派生文件并重试。
- **合规与残余**。业务库删除、提交后媒体队列完成、备份到期和解除保全分别记账。未完成的副本清理仍有可恢复材料。
- **审计性与事实源**：**破坏 `ticket_event` 不可变审计历史与 Unified Ticket Core 唯一长期事实源的连续性**；工单号消失，无法事后追溯工单历史或恢复误关工单。
- **报表影响**：工单总量、各处理组 SLA 达标率、关闭原因分布等历史统计会随时间消失（除非另建脱敏聚合快照表）。

### 方案 B：保留工单本体，匿名化 / 假名化 Intake 及含 PII 子表（Keep Ticket + Anonymize PII）

**未采纳原因**　改写关联受理、报修人身份或原文会丢失已建单材料的原貌。Peter 要求原样保留。

保留 Unified Ticket Core（`pilot_ticket.ticket`、`ticket_event`、`ticket_handling_cycle`、`closure_record`）作为长期事实源，对到期记录执行 PII 擦除；需要**明确区分「不可逆匿名化（Anonymization）」与「假名化/审计留痕（Pseudonymization / Retained Audit Identity）」**，不能笼统宣称全表无 PII 残留。

- **字段级擦除与残余事实清单**：
  1. **原始消息与正文文本（须同步擦除或独立到期销毁）**：
     - `channel.message_inbox`：`raw_text`、`normalized_message`、`clean_text`、`raw_payload_encrypted`、`sender_user_id`、`chat_id`、`response_snapshot`（`001`）；
     - `intake.service_intake`：`reporter_wecom_userid`、`summary`、`manual_report_snapshot`（注意 `042` `service_intake_manual_source_check` 禁止直接置 `{}`，须通过继任迁移允许明确脱敏哨兵状态或增加 `anonymized_epoch_ms` 列）；
     - `intake.web_submission`：`safe_content` / 位置描述与 `web_request_binding.canonical_reporter_binding`；
     - `intake.contact_journey`：`profile_snapshot` 与外部身份哈希；
     - `intake.ticket_reporter_profile` 的姓名、科室与身份字段需分别处理。067 要求 `reporter_identity_hash`、`source_label` 非空，且 `ticket_reporter_profile_source_immutable` 拒绝对这两列的任何修改。B/C 若保留档案，须记录仍可关联的身份及其保留期限。若要消除这种关联，须先批准删除整个档案及防止后台重建的规则，或以继任迁移引入可验证的脱敏终态并改造不可变触发器、非空及状态约束。
     - `conversation.item` / `communication.message`：`text`、`safe_content`、`content` 等会话与通信文本。
  2. **工单核心中的潜在含 PII 自由文本（关键审计权衡）**：
     - `pilot_ticket.ticket`（`003`）：`title`、`reported_location_text`、`external_result` 可能在报修人或工作人员手填时带入姓名、工号、手机号或具体诊室号；
     - `pilot_ticket.ticket_event`（`004`）：`internal_note`、`external_note`、`operator_id`（工作人员 UUID/身份）；
     - **可声明的结果**取决于实际保留内容。若选择不可逆匿名化，须同步处理上述工单和事件文本、可关联的身份及副本，并核验剩余数据能否重新识别个人。保留稳定哈希使记录仍可关联。仅清除结构化报修人字段而保留备注，会留下可能直接识别报修人的原文。保留工作人员 UUID 也须记入审计身份范围和保留期限。
- **权限控制、Legal Hold、备份与媒体清理**：
  - 已脱敏行继续遵守既有 `READ` 权限与内部备注/对外摘要隔离，禁止工作台普通搜索继续命中已擦除原文；
  - 支持行级/单级法律保全（Legal Hold）跳过到期脱敏；`operations.backup_checkpoint` 加密备份独立受运维留存周期与加密密钥销毁管控；
  - `intake.web_media_upload` 提交脱敏/清理状态更新与删盘任务记录后，在事务提交后安全删除磁盘原件/预览/缩略图。
- **报表与维度影响**：
  - 工单总量、`COMPLETED`（完成）/ `DISMISSED`（关闭）分布、处理轮次时长、SLA 与超期率、处理组工作量等核心聚合**完整保留**；
  - 按报修人部门（一旦擦除 `ticket_reporter_profile.reporter_department`）、细粒度地理位置文字（一旦擦除 `reported_location_text`）或关键字全文检索的历史下钻维度会失效，仅保留结构化 `service_code` / `request_type` / `resolver_team_id` 汇总。

### 方案 C：混合策略（本 ADR 对比基准：未建单闲聊、派生会话与媒体硬删 + 已建单脱敏并保留核心事实源）

**未采纳原因**　删除未建单消息与会话记录违反当前保留决定，对已建单材料脱敏也违反原样保留的要求。

结合方案 A 与 B 的边界，按业务实体是否绑定 Unified Ticket Core 分层处置（**注：本方案明确定义为「未建单/临时数据硬删 + 已建单核心留存脱敏」混合策略，而非独立离线冷归档库设计**）：

1. **未关联工单与纯粹临时/派生数据（满足前置窗口后物理硬删除）**：
   - 未关联工单且非待复核的 `channel.message_inbox`（如 7 天后过期群聊闲聊 `not_linked_to_ticket`）；
   - 已过期的 `intake.web_media_upload`（DB 提交墓碑状态/删除后，在事务外安全删除本地磁盘加密原图、预览与视频缩略图，保留审计计数）；
   - 已无 `communication.message(reply_to_conversation_item_id)` 等外键阻断的过期 `conversation.item`（会话时间线投影是派生视图）。
2. **已关联工单的受理与接触记录（保留 Unified Ticket Core 骨架 + 分级脱敏 PII）**：
   - 保留 `pilot_ticket.ticket`、`ticket_event`、`ticket_handling_cycle`、`closure_record` 作为唯一长期事实源与不可变审计历史（内部工作人员 `actor_principal_id` 作为操作审计保留，报修人身份残余按方案 B 的字段清单核验）；
   - 对超过留存期且关联工单已进入终态（`COMPLETED` 完成 或 `DISMISSED` 关闭）并超出重开/恢复窗口的 `service_intake`、`web_submission`、`contact_journey`、`ticket_reporter_profile`、`communication.message`、`web_report_urge`/`evaluation` 执行正文与报修人 PII 脱敏；对 `ticket.title`、`reported_location_text`、`external_result`、`ticket_event.internal_note` / `external_note` 须决定保留期限与受控脱敏方式。只有自由文本中的身份、受保护的 067 档案标识及可关联副本均已处理并验证后，才能声明消除了报修人 PII。保留原文的事件继续按含个人信息的审计记录管理。
3. **运维备份与公共故障表（独立审批边界）**：
   - `operations.backup_checkpoint`（受 `operations.restore_drill ON DELETE RESTRICT` 保护）：仅在对应外部存储备份已过期销毁且无近期演练引用后清理；
   - `incident.incident`：涉及全院故障复盘，默认长期保留结构事实，仅脱敏关联报修人个体信息。

### 方案横向对比表

| 维度 | 方案 A（连同工单全量硬删） | 方案 B（保留工单 + PII 匿名化/假名化） | 方案 C（混合：未建单/媒体硬删 + 已建单脱敏留存） |
| --- | --- | --- | --- |
| 隐私消除程度与残余 | 按范围删除业务记录与单号，副本受保全、备份期限与删盘队列约束 | 核验原始消息、自由文本、067 身份关联和副本。保留原文仍可能直接识别报修人 | 按期清理未建单数据和媒体。已建单数据的隐私结果取决于 067 档案、备注原文、身份及副本的实际处置 |
| `ticket_event` 审计性 | 破坏（随工单级联删除） | 保留不可变事件链（需决定是否保留 `actor_principal_id` 与备注原文） | 保留不可变事件链与操作审计 |
| Unified Ticket Core 事实源 | 破坏（删除工单实体） | 完整维持唯一事实源 | 完整维持唯一事实源 |
| 统计/维度报表影响 | 历史总数下降，需另建聚合快照 | 工单量/SLA 完整；若擦除 `reporter_department`/`location` 则按部门/文本下钻失效 | 核心统计与结构分类完整；报修人明细下钻停止 |
| 磁盘媒体与恢复安全 | 事务外持久化删盘队列重试 | 事务外持久化删盘队列重试 + 更新媒体状态 | 事务外持久化删盘队列重试 |
| 约束与触发器改造量 | 极高（须改 003/042 CHECK、040/043 不可变触发器、053 级联与 20+ 表顺序） | 中等（须加已脱敏标记并调整 042/030/001 等非空/结构 CHECK 约束） | 中等（仅无工单路径走硬删，有工单路径走受控脱敏更新） |

## 5. 实施影响（Consequences）

1. **保留 077 扫描索引**，供后续干跑报告按表统计到期候选。077 为缺少索引的 9 张表补齐 `(retention_until_epoch_ms, <cursor>)` B-tree 索引，11 张表均可按键分页扫描。
2. **清理器骨架**（`app/server/src/retention-cleanup-skeleton.mts` 与 CLI `app/server/scripts/retention-cleanup-check.mts`）：
   - **目标目录不可变校验**：所有扫描目标只能从内置冻结的 11 张表目录解析（`resolveCanonicalRetentionTarget`），SQL 中的 Schema、表名、游标列名均来自规范目录常量，拒绝任何非目录表描述符或代理对象；
   - **`READ ONLY` 数据库事务**：当传入具备 `connect()` 的连接池时，`runRetentionCleanupDryRun` 在 PostgreSQL `BEGIN TRANSACTION READ ONLY` 事务边界内执行扫描；
   - **原生列限定分页**：SQL 将目标表别名为 `r`，在 `WHERE`、游标比较元组 `(r.retention_until_epoch_ms, ...)` 与 `ORDER BY r.retention_until_epoch_ms ASC, ...` 中全部显式引用原生列（`::text` 仅在最外层投影输出）；
   - **未注册且默认禁用**：`createRetentionCleanupWorker` 仅作为进程内 `runOnce` / 单飞防重入 / `close()` 接口存在（对齐 `workbench-actor-avatars.mts` 形态），不创建定时器、未在 `human-workbench-role.mts` / `p2-016-process-role.mts` / `p2-016-runtime.mts` 注册，无任何持久化开关或兼容开关，默认 `enabled = false`；
   - **严格干跑（Dry-Run Only）**。每批最多扫描 1,000 行，只统计已扫描的到期候选。`--apply` 和可执行策略插件均以 `RETENTION_CLEANUP_POLICY_UNDECIDED` 拒绝执行。该错误码及干跑报告的默认 `policy_id`（`ADR_0060_UNDECIDED`）沿用既有接口名称，供调用方识别。两者对应本决策下的只读行为。
3. **策略变更。** 今后如需扩大删除范围或引入匿名化，必须另立 ADR 并单独建任务。

## 6. 原决策问题与结论（已关闭）

1. **总路线。** 已建生产工单及其全部关联数据行永久保留，未建单的业务数据行目前也保留。H5 媒体文件按第 5 项到期清理。
2. **工单与事件字段。** 标题、位置、处理结果、内外备注和操作人标识随工单长期保留，其中可能含直接身份信息。读取仍按既有权限区分内部备注与对外摘要。
3. **工单状态与窗口。** 所有状态均适用。受理到期、工单完成（`COMPLETED`）或关闭（`DISMISSED`）、重开或恢复窗口届满，都不会触发工单或关联数据行的删除或匿名化。
4. **报修人档案。** 随工单保留姓名、部门、身份哈希和来源标签。按报修部门统计仍可使用历史快照。
5. **媒体文件到期清理。** 既有 H5 Worker 扫描 `expires_epoch_ms <= platform.physical_epoch_ms()` 且 `purged_epoch_ms IS NULL` 的上传记录，已绑定与未绑定件均在范围内。Worker 删除磁盘上的原件、播放副本和缩略图后，在上传记录写入 `purged_epoch_ms`。工单及全部关联数据行继续保留。[H5 Worker](../app/server/src/yxx-h5-runtime.mts) · [媒体绑定与清理实现](../app/server/src/yxx-h5-media.mts)
6. **未建单消息与会话投影。** 群聊闲聊、被忽略的非 IT 受理及会话正文均先原样保留。示例中的 7 天不触发清理。
7. **保全与备份。** 工单与故障记录均保留，无需为个别记录增设跳过清理的保全标记。备份校验点和恢复演练记录保留，42C 对到期校验点只计数。外部备份的运维生命周期另由运维管理。
8. **工作台检索与展示。** 在既有读取权限和可见范围内使用原文。工作台无需新增脱敏占位文案或检索规则。
