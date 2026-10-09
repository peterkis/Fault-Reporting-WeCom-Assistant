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
| `GET /api/manual-reviews/{reviewId}/commands/{commandId}` | UUID，无 query；本票及恢复能力启用 | 闭合 ReviewReceipt：`UNKNOWN/FAILED/COMMITTED` |

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
| expected_material_basis | 本票启用时可选的64位小写hex摘要；正式表单随捕获材料提交。旧四字段命令保留 |

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

既有入口核对：[HTTP integration](../../../tests/p2-016-workbench-http.integration.test.mjs)、[说明](../../58_p2_016_manual_review_workbench.md)。本票增量见下文，所有默认开关保持关闭。

## 同事项复核与恢复（WBINT-T14）

`workbenchManualReviewEnabled=false` 默认关闭；关闭时不新增材料、canonical或Item复核引用查询。启用时正式工作台通过独立 Review/Journey 当前权限读取原 `safe_result`，另列 `material_basis/materials/materials_truncated/canonical_item`；原 Decision、hash、provenance保持。材料最多50条/20k字符，引用最多100条，权限和保留期过滤先于LIMIT。合同见 [Review types](../../../contracts/workbench_review_contracts.d.ts)、[材料依据](../../../contracts/workbench_review_material_basis.schema.json)、[材料](../../../contracts/workbench_review_material.schema.json)、[canonical](../../../contracts/workbench_canonical_item.schema.json)。Ticket可见不授予其他Journey材料。

Bot原分类依据仍是生产者按 sequence ASC 取得的最多51条前缀、原 message count/window/hash；材料围栏另核对持久全量 count/max sequence 及原 Decision 之后真实新增的同 Journey Leg。人工阅读窗口独立取最新保留文本，最多50条/20k字符，按时间顺序显示；它不替换原分类 hash 或原判断窗口。`original_hash` 是原 Decision source hash，`current_hash` 是当前来源修订与后来 Leg 标识的捕获摘要，两者用途不同。Web继续核对原 binding/input_revision。

这些来源范围在生产者一致的事务锁下核对，材料或版本变化拒绝旧结论；陈旧项仅支持明确取消，终态不支持新结论。咨询、澄清、确认回应、范围外等沿原分类Port及安全动作处理，不强制建故障；固定建议只作证据，不执行脚本、SQL或任意外发。相同UUID/原意图重放复用既有ledger，改意图拒绝；相同Ticket关联继续一张卡片。多个 Pending 版本的canonical沿现有Board实际Ticket/最早Pending规则，选择的Review命令目标仍保持独立；已知结果后重新读取有权canonical事实，旧Review入口按实际关联转换。转换前仍核对原Review自身当前权限及来源保留期；来源过期时旧Review入口返回404，即使关联Ticket仍可独立读取。

恢复能力为 `manual_review_draft_recovery_enabled = workbenchManualReviewEnabled && workbenchDraftRecoveryEnabled`；原Notes `draft_recovery_enabled`语义不变。本票复用T03当前浏览器AES-GCM/不可导出密钥、固定首次保存后24h的草稿，scope为principal+review+ReviewId+manual-review。密文保存明确选择、原因、捕获字符串版本/材料摘要/canonical与原UNKNOWN完整命令，不自动替换选择、版本或UUID，也不自动POST。

专用收据查询复用既有MANUAL_REVIEW ledger的principal/Review/purpose范围，先重新授权当前Review/Journey和保留材料；READ ONLY，无新receipt写入或第二事实源。`UNKNOWN`表示无终态凭据，不能推断未提交；`FAILED`只含code/retryable:false；`COMMITTED`只含原结论结果且replayed:true，精确形状见 [receipt schema](../../../contracts/workbench_review_receipt.schema.json)。到期或丢弃敏感内容后只保留不透明操作标识，显式GET核对；可信失权清相关缓存与该scope副本。无数据库变更；关闭本票option停止新增投影/UI，既有追加事实保留。验证与停止线见 [本票执行记录](../../../plans/admin-workbench-integration/execution/t14.md)。
