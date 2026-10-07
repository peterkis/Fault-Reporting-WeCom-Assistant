# 公共故障候选、关联与订阅

返回 [导航](../README.md) · [路径索引](../endpoint-index.md) · [公共约定](../conventions.md)

宿主 W，P2-012 扩展。调用方 [Incident UI](../../../web/p2-workbench/incidents.js)。`INCIDENT_CORRELATION_ENABLED` 默认 false；对外通知另有发送开关与授权。实现：[HTTP](../../../src/p2-012-workbench-http.mts)、[query](../../../src/p2-012-incident-query.mts)、[commands](../../../src/p2-012-incident-command-service.mts)、[domain guards](../../../src/p2-012-domain-contracts.mts)。Incident 是公共故障聚合，不能替代或删除个人 Intake/Ticket。

## 读取

| METHOD + PATH | Query | 200 响应 / 权限 |
| --- | --- | --- |
| `GET /api/incident-candidates` | state?、cursor?、limit 默认30/最大100 | `{items:[CandidateReview],next_cursor}`，范围授权 |
| `GET /api/incident-candidates/{candidateId}` | 无必需 query | CandidateDetail；ETag=`"<row_version>"` |
| `GET /api/incidents` | state?、cursor?、limit 默认30/最大100 | `{items:[IncidentPublicView],next_cursor}` |
| `GET /api/incidents/{incidentId}` | 无必需 query | IncidentDetail；ETag；按角色裁剪 |
| `GET /api/incidents/{incidentId}/events` | cursor?、limit 默认30/最大200 | `{items,next_cursor}`；窄权限仅公开事件类型 |
| `GET /api/incidents/{incidentId}/reports` | cursor?、limit 默认30/最大100 | `{items,next_cursor}`；按可见工单过滤 |
| `GET /api/incidents/{incidentId}/linkable-reports` | 同上 | ADMIN/DISPATCHER |
| `GET /api/incidents/{incidentId}/subscriptions` | 同上 | ADMIN/DISPATCHER |
| `GET /api/incidents/{incidentId}/notifications` | 同上 | ADMIN/DISPATCHER |
| `GET /api/incidents/{incidentId}/direct-destinations` | 同上 | ADMIN |
| `GET /api/incidents/{incidentId}/subscriptions/{subscriptionId}/direct-destinations` | 同上 | ADMIN；只返回该 subscription 候选 |

state 候选：`CANDIDATE|UNDER_REVIEW|CONFIRMED|REJECTED|EXPIRED`；Incident：`CONFIRMED_LOCAL|CONFIRMED_BUILDING|CONFIRMED_CAMPUS|CONFIRMED_HOSPITAL_WIDE|INVESTIGATING|RESOLVED|CLOSED`；Incident 聚合过滤 `ACTIVE|FINISHED`。游标绑定 kind/state 或 incident/part。ETag 是版本提示，这些内部 detail 不支持 If-None-Match/304。

Candidate 基础字段详见 [candidate schema](../../../contracts/p2_012_candidate_review.schema.json)；Detail 增加 `source_decision,manual_review,report_sources[],eligible_owners[],roles[]`。source_decision 是 code/版本/hash/安全 refs，非原始消息。IncidentPublicView 为 `id,incident_no,status,confirmed_scope,service_family,symptom_family,severity,safe_title,row_version,confirmed_at,investigating_at,resolved_at,closed_at,created_at,updated_at`。Detail 对广域角色再含 `owner_principal_id,owner_team_id,primary_ticket_id,owner_display_name,primary_ticket_no`，所有角色含 roles。

子查询主要字段：

| part | items 中的投影 |
| --- | --- |
| events | id,event_type,event_ordinal,old_status,new_status,old_scope,new_scope,occurred_at |
| reports | id,ticket_id,ticket_no,service_intake_id,link_state,impact_state,row_version,linked_at,unlinked_at,recovered_at |
| linkable-reports | source_decision_id,id,ticket_no |
| subscriptions | id,representative_report_id,status,impact_state,row_version,last_notified_incident_version,created_at,updated_at |
| notifications | id,audience_type,template_code,delivery_id,status,side_effect_state,attempt_count,created_at |
| direct-destinations | id（channel leg）、subscription_id、source_intake_no |

## 人工命令

共同 body：`client_command_id:UUID,reason_code,expected_row_version:string`。确认候选改用 `expected_candidate_version:string`。Header 幂等、CSRF/Origin，If-Match **精确**为 `"<expected_candidate_version ?? expected_row_version>"`，此模块不接受 W/ 前缀或裸版本。

| METHOD + PATH | 额外必需字段 / 可选字段 |
| --- | --- |
| `POST /api/incident-candidates/{candidateId}/start-review` | 无 |
| `POST /api/incident-candidates/{candidateId}/reject` | 无 |
| `POST /api/incident-candidates/{candidateId}/confirm` | expected_candidate_version、confirmed_scope、owner_principal_id、selected_report_refs[]；owner_team_id?、primary_ticket_id? |
| `POST /api/incidents/{incidentId}/start-investigating` | 无 |
| `POST /api/incidents/{incidentId}/correct-scope` | confirmed_scope |
| `POST /api/incidents/{incidentId}/primary-ticket` | primary_ticket_id:UUID或null |
| `POST /api/incidents/{incidentId}/reports/link` | source_decision_id:UUID |
| `POST /api/incidents/{incidentId}/reports/{reportId}/unlink` | expected_report_version:string |
| `POST /api/incidents/{incidentId}/reports/{reportId}/mark-recovered` | expected_report_version:string |
| `POST /api/incidents/{incidentId}/subscriptions/{subscriptionId}/pause` | expected_subscription_version:string |
| `POST /api/incidents/{incidentId}/subscriptions/{subscriptionId}/resume` | expected_subscription_version:string；direct_channel_leg_id?:UUID或null |
| `POST /api/incidents/{incidentId}/resolve` | 无 |
| `POST /api/incidents/{incidentId}/close` | 无 |

ID 从路径注入命令，不允许 body 覆盖 `action,incident_id,candidate_review_id,incident_report_id,subscription_id`。`EXPIRE_CANDIDATE` 是服务内部动作，没有 HTTP `/expire`；不存在自由 publish-update 路由。

confirmed_scope=`LOCAL|BUILDING|CAMPUS|HOSPITAL_WIDE`，更广范围由 ADMIN 权限控制。reason_code=`OPERATOR_REVIEWED|CONFIRMED_SHARED_FAULT|INCORRECT_ASSOCIATION|RECOVERY_CONFIRMED|SUBSCRIPTION_REQUEST|SCOPE_CORRECTION|MAINTENANCE_EXPIRED|WORKBENCH_CONFIRMED`。

```json
{"client_command_id":"22222222-2222-4222-8222-222222222222","expected_row_version":"3","reason_code":"RECOVERY_CONFIRMED"}
```

成功为 200：`{ok:true,result_ref_type,result_ref_id,result_row_version,result_event_id,replayed}`。失败为 `{ok:false,error:{code,retryable:false},replayed}`，状态由 domain mapper 决定；常见 `P2_012_VERSION_CONFLICT/COMMAND_CONFLICT/FORBIDDEN/NOT_FOUND/SOURCE_NOT_FOUND` 及状态/关联/订阅错误。具体动作字段、枚举、长度及条件必需见 [IncidentCommand schema](../../../contracts/p2_012_incident_command.schema.json)，不要用一份宽松 body 模板发送所有动作。

合成Incident命令成功响应：

```json
{"ok":true,"result_ref_type":"INCIDENT","result_ref_id":"11111111-1111-4111-8111-111111111111","result_row_version":"4","result_event_id":"33333333-3333-4333-8333-333333333333","replayed":false}
```

核对测试：[workbench integration](../../../tests/p2-012-workbench.integration.test.mjs)、[process assembly](../../../tests/p2-012-process-assembly.integration.test.mjs)、[subscription HTTP/browser](../../../tests/p2-g2-subscription-http-browser.integration.test.mjs)。[长期背景](../../62_p2_012_human_confirmed_incident_lifecycle.md)。本轮未启用 Incident 或外发。
