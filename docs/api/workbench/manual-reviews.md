# 人工复核与 Contact Journey

返回 [导航](../README.md) · [路径索引](../endpoint-index.md) · [公共约定](../conventions.md)

宿主 W；调用方 [lifecycle UI](../../../web/p2-workbench/lifecycle.js)。条件：`TICKET_LIFECYCLE_WORKBENCH_ENABLED` 默认 false。实现：[HTTP](../../../src/p2-016-workbench-http.mts)、[manual review facade](../../../src/p2-016-manual-review-facade.mts)、[P2-015 store/executor](../../../src/p2-015-manual-review.mts)。权限沿用内部坐席、工单/Journey 范围。

| METHOD + PATH | 请求 | 200 响应 |
| --- | --- | --- |
| `GET /api/manual-reviews` | status默认且只接受PENDING；priority?=`LOW\|NORMAL\|HIGH\|URGENT`；cursor?；limit默认30/最大100 | `{items:[ReviewSummary],next_cursor}` |
| `GET /api/manual-reviews/{reviewId}` | UUID，无 query | ReviewDetail |
| `GET /api/contact-journeys/{journeyId}` | UUID，无 query | 安全 ContactJourney 投影 |
| `GET /api/contact-journeys/{journeyId}/legs` | 无 query | **直接数组**，最多100条 ChannelLeg 投影 |
| `GET /api/contact-journeys/{journeyId}/decisions` | 无 query | **直接数组**，最多100条 DeterministicDecision 投影 |
| `POST /api/manual-reviews/{reviewId}/resolve` | 下述命令 | `{ok:true,review_id,status,resolution_decision_id,action_count,replayed}` |

查询 Summary 包含 `id,review_key,journey_id,decision_id,service_intake_id,linked_ticket_id,review_reason_code,priority,status,row_version:string,created_at`。Detail 加 `safe_result,allowed_resolutions[],unsupported_resolutions[],web_report?`。safe_result 包含判定 code、known/unknown fields、来源引用、事实 provenance、冲突、安全建议、输入/结果摘要和版本。展示安全投影，不解析建议为脚本、SQL 或自由外发内容。

Journey/Leg/Decision 的精确字段分别见 [Journey schema](../../../contracts/p2_015_contact_journey.schema.json)、[Leg schema](../../../contracts/p2_015_channel_leg.schema.json)、[Decision schema](../../../contracts/p2_015_deterministic_decision.schema.json)，HTTP facade 会裁剪字段；这些类型不是“任意表记录都可返回”的承诺。

## 复核命令

共同 Header：`Content-Type: application/json`、`Idempotency-Key: <client_command_id>`、`If-Match: "<expected_row_version>"`、Cookie 的 CSRF/Origin。

| Body 字段 | 类型 / 规则 |
| --- | --- |
| client_command_id | UUID，必需 |
| expected_row_version | 正十进制 string，必需；不是 number |
| resolution_code | 下列固定枚举，必需 |
| resolution_reason_code | 大写 code，必需 |

resolution_code：`CONFIRM_TICKET_ELIGIBLE|CLASSIFY_SERVICE_REQUEST|REQUEST_DESCRIPTION|CLASSIFY_BUSINESS_CONSULTATION|ACKNOWLEDGE|MARK_OUT_OF_SCOPE|KEEP_INCIDENT_REVIEW_CANDIDATE|CANCEL_REVIEW`。`LINK_EXISTING_JOURNEY`明确不支持；target_journey_id只要传入（非undefined）即403，不是可用的跨Journey关联参数。

```json
{"client_command_id":"22222222-2222-4222-8222-222222222222","expected_row_version":"2","resolution_code":"REQUEST_DESCRIPTION","resolution_reason_code":"WORKBENCH_CONFIRMED"}
```

执行在同一 ledger 事务内追加人工结论和安全动作；结果可能创建 Ticket、请求补充或保留候选。已解决/版本冲突不得直接重复写入新结论。通知仍走统一 Communication；内部备注不外发。

合成已受理人工结论响应：

```json
{"ok":true,"review_id":"11111111-1111-4111-8111-111111111111","status":"RESOLVED","resolution_decision_id":"33333333-3333-4333-8333-333333333333","action_count":1,"replayed":false}
```

合同：[list](../../../contracts/p2_016_manual_review_list.schema.json)、[detail](../../../contracts/p2_016_manual_review_detail.schema.json)、[resolution](../../../contracts/p2_016_manual_review_resolution.schema.json)。HTTP 失败码常见 `P2_016_REVIEW_ALREADY_RESOLVED/RESOLUTION_NOT_PERMITTED/REVIEW_ACTION_FAILED/GUIDED_ASSOCIATION_CONFLICT/VERSION_CONFLICT/COMMAND_CONFLICT`；ledger 失败映射 403/409/503，通用请求校验见公共约定。

核对：[HTTP integration](../../../tests/p2-016-workbench-http.integration.test.mjs)、[说明](../../58_p2_016_manual_review_workbench.md)。本轮只记录接口，无新数据库变更或开关启用。
