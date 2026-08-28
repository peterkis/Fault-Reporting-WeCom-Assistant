# 09. V1.2 数据模型设计

## 1. 阶段边界

- Phase 1/2 数据事实存放在公网 Pilot 数据边界；
- Phase 1 必须具备 Channel Message、Service Intake、Pilot Ticket、Ticket Event、Notification Outbox/Delivery；
- Phase 2 增加 Media Asset、AI Decision、Incident 和 Subscription；
- Phase 3 增加 Ticket External Mapping、迁移批次和对账记录；
- Phase 1 不读取或写入 Hospital Tickets 数据库；
- Phase 3 只能通过 Ticket Adapter/API 融合，禁止共享数据库直写。

`database/schema_draft.sql` 是 V1.0 旧架构草案，缺少 Pilot Ticket Core 和 Phase 3 映射，不得直接实施。P1-003 已用独立迁移只冻结 `channel.message_inbox`；P1-005 仍须基于本文件冻结其余 Pilot Ticket Core 可执行 Schema，不能复用旧草案整库建表。

## 2. 建议 Schema

```text
channel.*
intake.*
pilot_ticket.*
notification.*
media.*          # Phase 2
ai.*             # Phase 2
incident.*       # Phase 2
integration.*    # Phase 3
```

Schema 名可按实现约定调整，但领域边界不得合并成单表。

## 3. Channel Message

保存企业微信原始消息事实，至少包含：

```text
id
provider
msg_id
req_id
bot_id
chat_type / chat_id
sender_user_id
msg_type
create_time
received_at
raw_text / clean_text
raw_payload_encrypted
processing_status
privacy_class
trace_id
retention_until
```

必须唯一：`(provider, msg_id)`。`req_id` 仅用于通道关联，不能参与业务幂等。提供方未给出 `create_time` 时保持空值，使用独立的 `received_at` 记录本地接收事实；不得用接收时间冒充提供方时间。AI/OCR 不得覆盖原始消息。

P1-003 可执行实现为 `database/migrations/001_p1_003_channel_message_inbox.sql`。它额外保存标准消息 JSON 和首次处理结果快照，以便数据库并发重放返回原结果；这不把 Channel Message 升格为 Service Intake 或 Ticket，也不授权创建后续 Schema。

## 4. Service Intake

表示一次完整受理，至少包含：

```text
id / intake_no
primary_message_id
reporter_wecom_userid
request_type
summary
reported_campus_id
reported_department_id
reported_location_text
status
pilot_ticket_id
incident_id
version
created_at / updated_at
```

通过 Intake Message Relation 支持多条消息、补充和澄清。Phase 1 身份字段允许仅有 WeCom userid，不要求医院 person_id。

P1-004 的可执行迁移为 `database/migrations/002_p1_004_service_intake.sql`：

- `intake.service_intake` 保存 Intake 聚合事实、主消息、显式新上下文边界、当前请求类型、状态、消息数、最后消息时间、最强隐私级别、最早留存期限和乐观版本；隐私与留存字段不属于既有外部响应契约；
- `intake.service_intake_message` 保证一条 Channel Message 最多属于一个 Intake，并保存 `PRIMARY / SUPPLEMENT / CLARIFICATION` 关系与顺序；
- `intake.service_intake_event` 保存同事务的 Intake 审计事件，`event_ordinal` 提供严格的每 Intake 顺序，JSONB payload 仅用于无原文的可选审计字段；
- 聚合查询只覆盖当前允许追加的状态，并由同上下文 advisory lock 保护。

该迁移不创建 `pilot_ticket.*`、Incident、Notification Outbox、AI/OCR 或 Hospital 集成表。`pilot_ticket_id` 和 `incident_id` 仍只作为公开契约中的空值；实际关联必须由后续受权任务以外键新增。

## 5. Pilot Ticket Core

Phase 1/2 的工单事实源至少包含：

```text
pilot_ticket.id
pilot_ticket.ticket_no
pilot_ticket.source_intake_id
pilot_ticket.title
pilot_ticket.request_type
pilot_ticket.status
pilot_ticket.priority
pilot_ticket.resolver_team_id
pilot_ticket.assignee_id
pilot_ticket.reported_location fields
pilot_ticket.external_result
pilot_ticket.closure_reason
pilot_ticket.version
pilot_ticket.created_at / updated_at
```

Ticket 编号、状态、版本和外部结果是结构化字段，不能只存 JSONB。

### Ticket Event

每次 Action 追加事件：

```text
event_type
old_status / new_status
operator_type / operator_id
internal_note / external_note
reason_code
attachment_ids
trace_id
created_at
```

Ticket 状态、Ticket Event 和对应 Notification Outbox 必须同事务。

## 6. Notification Outbox / Delivery

Outbox 表示应发送事实，Delivery 表示每个目标的实际发送结果。

建议幂等键：

```text
event_type + aggregate_id + aggregate_version + target_key
```

Phase 1 使用 Pilot Outbox，不依赖医院院内 Outbox。Phase 3 切换时必须迁移通知所有权并处理积压去重。

## 7. Phase 2 增强对象

### Media Asset

保存对象键、SHA256、MIME、大小、安全扫描、敏感级别、外部可见性和留存时间。大文件不进入数据库。

### AI Decision

保存 pipeline/model/prompt/rule/catalog 版本、输入哈希、脱敏 OCR、结构化结果、决策带和人工修正。只追加，不覆盖历史。

### Incident / Incident Report / Subscription

Incident 关联多个独立 Intake；每条申报证据保留。Subscription 独立维护每位申报人的通知关系。

## 8. Phase 3 Integration 对象

### Ticket External Mapping

```text
id
pilot_ticket_id unique
hospital_ticket_id unique
hospital_ticket_no
adapter_version
migration_batch_id
sync_state
cutover_state
last_reconciled_at
created_at / updated_at
```

### Migration Batch

记录批次范围、输入快照、开始/结束时间、成功/失败/跳过数量、校验摘要和回滚标识。

### Reconciliation Result

记录对象、比较版本、字段差异、解释状态、责任人和处置结果。不得以最后写入覆盖无法解释的冲突。

## 9. 身份与组织

- Phase 1 使用 Pilot 用户/角色/处理组和 WeCom userid；
- 申报人所属科室与故障发生科室分离；
- Phase 3 才引入医院 person/SSO/组织映射；
- 映射保留有效期，人员调科不能改写历史事实；
- 映射失败进入人工队列，不丢工单。

## 10. 数据保留与安全

- 原始消息、截图、OCR和AI数据按敏感级别和用途留存；
- 问候和无关消息短期删除；
- 原图私有存储，访问有审计；
- 日志不输出原始患者文本、OCR、Secret、AES Key或完整媒体URL；
- Phase 3 迁移完成后明确 Pilot 数据只读、归档和删除责任。

## 11. 迁移原则

- 使用可重入批次；
- 每个 Pilot Ticket 最多映射一个正式 Hospital Ticket；
- 创建、状态和附件操作幂等；
- 迁移记录行数、版本、耗时和异常；
- 切换前后均执行逐对象对账；
- 不长期双写；
- 回滚不能抹除已发生的业务事实。
