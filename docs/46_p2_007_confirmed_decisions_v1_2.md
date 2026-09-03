# P2-007 v1.2 已确认决策清单

## D1 人员身份

```yaml
canonical_person_key: SYSTEM_PERSON_ID
current_profile_authority: WECOM_DIRECTORY
wecom_userid_role: EXTERNAL_IDENTITY_BINDING
directory_failure: ACCEPT_AND_DEFER
future_person_master: ADD_BINDING_NO_DESTRUCTIVE_REKEY
```

## D2 群转单聊

```yaml
strategy: HYBRID
provider_context: TRANSPORT_EVIDENCE_AND_SAME_CHANNEL_REPLY
cross_channel_authority: CONTINUATION_REF
same_user_plus_time_only: FORBIDDEN
multiple_open_journeys: ASK_USER_TO_SELECT
```

## D3 Incident

```yaml
p2_007_output: INCIDENT_CANDIDATE_ONLY
human_confirmation_required: true
auto_create: false
auto_link: false
auto_broadcast: false
actual_incident_task: P2-012
```

## D4 通知

```yaml
group_receipt: ENABLED_BEST_EFFORT
strong_group_mention: UNVERIFIED
direct_guidance: REQUIRED_RELIABLE_PATH
ticket_card: AFTER_TICKET_COMMIT
ticket_suffix: DISPLAY_ONLY_4_DIGITS
timeline: OPAQUE_REF_PLUS_AUTHENTICATION
current_template_card_sender: IMPLEMENTATION_PENDING
```

## D5 P2-007 停止线

P2-007 不接企业微信目录网络接口、不发消息、不调用 SDK、不接 DeepSeek、不创建 Incident、不修改 Ticket、不创建空迁移。它只冻结契约、规则、配置、纯函数和脱敏 fixture。
