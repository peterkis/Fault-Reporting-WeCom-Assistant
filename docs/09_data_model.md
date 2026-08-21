# 09. 数据模型设计

`database/schema_draft.sql` 为增量草案，实施前应与现有 Tickets 表结构对齐。

## 1. Schema 边界

建议：

```text
intake.*
notification.*
incident.*
```

现有 Tickets 表保留在原 Schema，不复制核心数据。

## 2. `intake.channel_message`

目的：保存原始企业微信消息事实。

核心字段：

```text
id uuid
provider varchar
msg_id varchar
req_id varchar
bot_id varchar
chat_type varchar
chat_id varchar
sender_user_id varchar
msg_type varchar
create_time timestamptz
raw_text text
clean_text text
raw_payload_encrypted bytea/jsonb
processing_status varchar
privacy_class varchar
trace_id varchar
retention_until timestamptz
received_at timestamptz
```

索引：

- unique `(provider, msg_id)`；
- `(sender_user_id, received_at desc)`；
- `(chat_id, received_at desc)`；
- `(processing_status, received_at)`。

## 3. `intake.service_intake`

目的：表达一次完整服务受理。

核心字段：

```text
id uuid
intake_no varchar unique
source_channel varchar
primary_message_id uuid
reporter_wecom_userid varchar
reporter_person_id uuid/null
reporter_org_assignment_id uuid/null
request_type varchar
summary varchar
reported_campus_id varchar/null
reported_department_id varchar/null
reported_location_text varchar/null
status varchar
ticket_id uuid/null
incident_id uuid/null
created_at
updated_at
version int
```

## 4. `intake.intake_message_rel`

支持一个 Intake 多条消息：

```text
intake_id
message_id
relation_type PRIMARY/FOLLOW_UP/CLARIFICATION/STATUS_QUERY
sequence_no
created_at
```

唯一 `(intake_id, message_id)`。

## 5. `intake.media_asset`

```text
id uuid
message_id uuid
object_key varchar
original_filename varchar
mime_type varchar
size_bytes bigint
sha256 char(64)
security_scan_status varchar
sensitivity_level varchar
external_visible boolean
retention_until timestamptz
created_at timestamptz
```

SHA256 可用于重复文件识别，但不能仅按文件哈希自动判断同一故障。

## 6. `intake.identity_binding`

```text
wecom_userid varchar
person_id uuid
sso_username varchar
org_assignment_id uuid
department_id varchar
campus_id varchar
valid_from timestamptz
valid_to timestamptz
status varchar
```

支持历史有效期，避免人员调科后历史工单归属变化。

## 7. `intake.ai_decision`

```text
id uuid
intake_id uuid
pipeline_version varchar
model_name varchar
model_version varchar
prompt_version varchar
input_hash char(64)
ocr_text_redacted text
structured_output jsonb
decision_band varchar
human_corrected boolean
corrected_by uuid/null
corrected_fields jsonb/null
latency_ms int
created_at timestamptz
```

AI 结果只追加，不覆盖旧版本。

## 8. `incident.incident_report`

```text
incident_id uuid
intake_id uuid
match_method varchar
match_evidence jsonb
match_score numeric
confirmed_by uuid/null
created_at timestamptz
```

唯一 `(incident_id, intake_id)`。

## 9. `incident.reporter_subscription`

```text
id uuid
ticket_id uuid/null
incident_id uuid/null
wecom_userid varchar
notification_channel varchar
last_notified_version int
notification_preference jsonb
status varchar
created_at
updated_at
```

约束：ticket_id 与 incident_id 至少一个非空。

## 10. `notification.outbox`

如果现有系统已有 Outbox，扩展而不新建。最小字段：

```text
id uuid
event_type varchar
aggregate_type varchar
aggregate_id uuid
aggregate_version int
payload jsonb
status varchar
available_at timestamptz
attempt_count int
created_at
```

唯一幂等建议：

```text
event_type + aggregate_id + aggregate_version + target_key
```

## 11. `notification.delivery`

```text
id uuid
outbox_id uuid
target_type varchar
target_id varchar
channel varchar
template_code varchar
payload_hash char(64)
status varchar
attempt_count int
last_error_code varchar
last_error_message_redacted varchar
sent_at timestamptz
created_at
updated_at
```

## 12. 现有 Ticket 扩展建议

若现有 Tickets 缺少以下字段，可增量扩展：

```text
source_channel
source_intake_id
reported_campus_id
reported_department_id
reported_location_text
external_status
closure_reason
version
```

不要把全部企业微信原始字段堆入 Ticket 表。

## 13. 数据保留

建议由 `config_examples/retention_policy.example.json` 驱动：

- ChannelMessage：
  - 成为工单证据：跟随工单档案策略；
  - 问候/无关消息：短期删除；
- 原始截图：
  - 结案后按配置保留；
  - 长期保留需审批；
- OCR 原文：
  - 敏感版受控；
  - 分析版脱敏；
- Notification Delivery：
  - 保留满足审计需要；
- AI Decision：
  - 保留模型版本和结构化结果；
  - 训练集另行审批。

## 14. 数据迁移原则

- 仅新增表和字段；
- 不直接改写历史 Ticket 事实；
- 数据回填使用可重入任务；
- 映射失败形成报告；
- 所有迁移记录行数、耗时和异常；
- 先测试环境，再试点环境，再生产。
