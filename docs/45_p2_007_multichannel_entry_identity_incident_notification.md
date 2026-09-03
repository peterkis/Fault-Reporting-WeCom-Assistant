# P2-007 多渠道入口、身份、Incident 与通知设计

## 1. Contact Journey

```text
Group Channel Message ─┐
                       ├→ Contact Journey → Service Intake → Unified Ticket
Direct Channel Message ┘        │
                                ├→ Group Channel Leg
                                └→ Direct Channel Leg
```

群 Thread 与单聊 Thread 保持独立，不物理合并原始消息；Journey 负责说明它们为何属于同一次业务接触。

建议 Journey 至少保存：

```text
journey_id
entry_mode
origin_channel
current_channel
origin_trigger
origin_message_ref
reporter_person_id
reported_at
provider_context_snapshot
channel_legs[]
continuation_state
```

## 2. 人员资料解析

当前：

```text
from.userid
→ internal person_id
→ WECOM_DIRECTORY lookup
→ report-time profile snapshot
```

目录失败不漏单：

```text
lookup_status=DEFERRED
name/department=UNKNOWN
intake/ticket continue
```

后期人员主索引接入时增加新的 identity binding，禁止修改历史 `person_id`。

## 3. Provider Context 与 continuation_ref

Provider Context 证明“这条消息从哪里来、如何回复”；continuation_ref 证明“这个单聊继续的是哪次群上报”。二者职责不同，采用 HYBRID。

### 不能只靠时间关联

```text
08:00 群里：打印机坏了
08:02 单聊：处方提交不了
```

同一个人、两分钟内，仍可能是两起问题。

### 多个待处理 Journey

Bot 应列出安全摘要，让用户选择 1/2；不要展示患者、IP 或内部错误。

## 4. Incident Candidate

聚类维度：

```text
normalized service family
module / transaction stage
symptom family
safe error fingerprint
location scope
time window
monitoring corroboration
```

禁止聚类键：患者 ID、姓名、手机号、原始正文、原始 WeCom userid、原始 IP。

候选只进入未来 P2-015/P2-016 人工审核界面。P2-012 经独立授权且人工确认后才能：

```text
create Incident
link/unlink reports and tickets
create ReporterSubscription
publish group notice
publish direct notice
```

## 5. 全流程留痕

P2-007 只建立审计读模型，事实所有权不变：

- P2-005：assignment / handoff / read cursor / control event；
- P2-004：message / delivery / delivery attempt；
- Unified Ticket Core：Ticket 和 Ticket Event；
- Channel Message：原始入站。

同一会话最多一个 authoritative owner，其他坐席作为 collaborators。并发接管只有一个成功，成功、失败和重放均可审计。

## 6. 通知矩阵

|通知|触发|渠道|权限/边界|
|---|---|---|---|
|群内安全回执|Journey 已提交|群聊|系统模板；强 @ 未验证|
|主动单聊引导|群来源已提交|单聊|仅原上报人|
|工单创建卡片|Ticket 已提交|单聊|系统模板|
|自由文本人工回复|坐席获授权|单聊/适用渠道|当前 Handler/Admin|
|Incident Candidate|候选已提交|内部 Workbench|不对外|
|Incident 公共播报|人工确认 Incident|群聊|Incident Owner/Admin|
|Incident 私人通知|人工确认且已订阅|单聊|系统模板|

## 7. 幂等

```text
journey:{journey_id}:group_ack:v1
journey:{journey_id}:direct_guidance:v1
ticket:{ticket_id}:created:{person_id}:v1
ticket:{ticket_id}:status:{ticket_version}:{person_id}
incident:{incident_id}:public:{incident_version}:{group_ref}
incident:{incident_id}:private:{incident_version}:{person_id}
```

Sender 已调用但 ACK 不明确时进入 `RECONCILIATION_REQUIRED`，不得盲重发。

真实模板卡片 Sender、Reporter-safe Timeline 和基于 Ticket Event 的状态通知归 P2-016，默认 Flag 关闭；P2-007 仍只产生 Candidate/Recommendation。
