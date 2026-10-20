# 医小修成员自助服务

返回 [导航](../README.md) · [路径索引](../endpoint-index.md) · [公共约定](../conventions.md)

宿主 M：`MEMBER_SELF_SERVICE` 的替代 server，或 W 中 `FULL_SERVICE_LOOP` 的扩展。调用方：[self-service.js](../../../web/p2-reporter/self-service.js)。实现：[native HTTP](../../../src/yxx-self-service-native-http.mts)、[runtime](../../../src/yxx-self-service-runtime.mts)、[command](../../../src/yxx-self-service-command.mts)、[supplement](../../../src/yxx-self-service-supplement.mts)、[query](../../../src/yxx-self-service-query.mts)、[authorization](../../../src/yxx-self-service-authorization.mts)。

## 身份、profile 与开关

OAuth 成员 Cookie `__Host-wecom_session`。既有映射模式保持原 canonical binding；新增 `VERIFIED_APP_OPENID` 模式用当前应用 OAuth 开放身份和官方 `user/get` 核验可见成员，无需逐人名单。外部核验在业务事务前，等待后执行本地会话／作用域终检。新成员拥有独立的应用命名空间；可选旧映射只保持既有 Bot 身份和历史 owner hash。不能由 body/header 指定 reporter 或通知目标，也不授予 PC 权限。

新模式明确无成员资格时返回 403；成员查询暂不可用时返回既有 `503 YXX_ENTRY_UNAVAILABLE`，不将网络／Provider 故障当作撤权。两种情况均不进入业务写事务。应用通知的资格查询暂不可用时，沿既有 Worker 有界重试；实际发送后的 UNKNOWN 仍须人工核对。

063 迁移为原 Web Request 绑定追加应用通知身份、命名空间、签名和核验时间；仅在服务端新报修时写入，后续不可改投。个人通知在实际接单／开始和工作人员完工产生；发送前独立复核当前成员。退出、会话过期和重启不丢失原通知定位。新页面按 [H5 接入说明](../../../h5/README.md)复用下列 API；本轮不生成页面。

读取依赖 `YIXIAOXIU_MY_REPORTS_ENABLED`。写入同时要求 profile 为 MEMBER_SELF_SERVICE/FULL_SERVICE_LOOP、`YIXIAOXIU_SELF_SERVICE_ENABLED`、MY_REPORTS_ENABLED 和当前 `write_flag`。两开关默认 false。SS011 单一批准 Reporter 的 guard 还会限制写入范围；bootstrap 是最终能力提示，不得由 profile 名推定所有成员能写。OAUTH_ONLY/MEMBER_TICKET_READONLY 没有这些自助 API 的业务能力；替代 server 对其 `/api/yixiaoxiu/*` 返回 `403 YXX_MEMBER_WRITE_DISABLED`。

每次写入精确 Origin、非 cross-site、当前 CSRF，写后再验身份、recovery_scope 与 CSRF。不从“页面打开成功”推断写入已完成。

## 完整 REST 清单

| METHOD + PATH | 输入 / 限制 | 成功响应 |
| --- | --- | --- |
| `GET /api/yixiaoxiu/bootstrap` | 无 query | Bootstrap，200 |
| `GET /api/yixiaoxiu/service-catalog` | 无 query/无请求 body；必须读写均开且已授权成员 | Catalog，200；最多200项 |
| `GET /api/yixiaoxiu/my-reports` | source?=`WEB\|BOT`；cursor?；limit 默认20、1..50；重复/未知参数拒绝 | ReportPage，200 |
| `GET /api/yixiaoxiu/requests/{requestRef}` | requestRef=32位 `[A-Za-z0-9_-]`；无 query；If-None-Match? | RequestDetail，200；ETag，匹配304无正文；显式启用T20时追加闭合feedback_context |
| `GET /api/yixiaoxiu/requests/{requestRef}/timeline` | after?/before?/cursor? 互斥；limit 默认50、1..100 | Timeline，200；无需客户端提供 intake UUID |
| `POST /api/yixiaoxiu/requests` | 新报修输入，无 query，JSON≤16KiB | 首次202/重放200，AcceptanceEnvelope |
| `POST /api/yixiaoxiu/requests/{requestRef}/supplements` | 补充输入，无 query，JSON≤8KiB | 首次202/重放200，AcceptanceEnvelope |
| `POST /api/yixiaoxiu/requests/{requestRef}/feedback` | T20默认关闭能力、当前原成员/来源/写profile、合法完工轮次；闭合JSON≤2KiB，无query，Origin/CSRF、Idempotency-Key=UUID、quoted If-Match=Ticket版本 | 200 FeedbackResult：同Ticket明确重开/新轮次；原UUID合法重放200 |
| `GET /api/yixiaoxiu/requests/{requestRef}/feedback/commands/{clientCommandId}` | T20启用；当前M READ/原绑定/FEEDBACK用途/UUID；无query/body，不要求当前新写或raw能力 | 200 FeedbackReceipt：UNKNOWN或COMMITTED；UNKNOWN不表示未提交 |
| `GET /api/yixiaoxiu/commands/{clientCommandId}` | UUID，无query；当前成员/应用范围 | 200 **直接Receipt**；当前范围未查到结果：404 |
| `POST /wecom/yixiaoxiu/logout` | `{}`，无 query，JSON≤1KiB，Origin同源 | 200 `{logged_out:true}`，清理OAuth Cookie/绑定 |

## 输入字段

新报修 **所有字段必需存在**，可空字段传 null；不允许额外键。

| 字段 | 类型与约束 |
| --- | --- |
| schema_version | 常量1 |
| client_command_id | UUID，Header Idempotency-Key 精确相同 |
| description | string 1..4000 |
| location | `{text:string或null,unknown:boolean}`；text最多200，unknown=false时必须非空 |
| service_code | string或null，最多64；大写 code，允许点分段；从目录选择 |
| impact_scope | UNKNOWN / SELF / SINGLE_WORKSTATION / MULTIPLE_USERS / DEPARTMENT |
| reported_department_text | string或null，最多100；自报文本不成为正式组织身份 |
| extension | string或null，数字开头，数字/空格/连字符，最多20 |

补充：`schema_version:1,client_command_id:UUID,expected_input_revision:正十进制string,text:string(1..2000)`，所有必需。两个 POST 均需 `X-CSRF-Token`；**不要求 If-Match**，补充用输入修订控制并发。新建不会直接接管 Ticket 状态。

```http
POST /api/yixiaoxiu/requests
Content-Type: application/json
Idempotency-Key: 22222222-2222-4222-8222-222222222222
X-CSRF-Token: <bootstrap.csrf_token>
Origin: <member-origin>
```

```json
{"schema_version":1,"client_command_id":"22222222-2222-4222-8222-222222222222","description":"合成示例：测试工作站无法连接打印机","location":{"text":"测试区域","unknown":false},"service_code":null,"impact_scope":"SINGLE_WORKSTATION","reported_department_text":null,"extension":null}
```

## 响应字段

| DTO | 字段 |
| --- | --- |
| Bootstrap | authenticated:true,identity_mode:'MEMBER_SELF_SERVICE',read_only,can_submit,can_supplement,csrf_token,recovery_scope（64hex；当前成员/企业/应用范围HMAC）；T20启用时追加feedback_draft_recovery_enabled:boolean，独立raw选项默认false |
| Catalog | schema_version:1,catalog_version,services:[{service_code,name_zh,category,category_name_zh}]；只有启用项，无内部目录配置 |
| AcceptanceEnvelope | ok:true,replayed:boolean,receipt:Receipt,location:`/wecom/yixiaoxiu/reports/{receipt.request_ref}`（JSON字段，不是Location Header） |
| Receipt | client_command_id,status:'ACCEPTED',request_ref,intake_no,accepted_revision:string,accepted_at,accepted_epoch_ms:string |
| RequestDetail | request_ref,intake_no,source_kind:'WEB_REQUEST',input_revision,processed_revision,display_status,needs_action,safe_description,supplements:[{input_revision,text}],safe_location,created_at,created_epoch_ms,updated_at,updated_epoch_ms,ticket,safe_clarification,can_supplement；T20启用时追加闭合feedback_context，不暴露内部Ticket/cycle/actor UUID |
| FeedbackResult / FeedbackReceipt | [T20反馈合同](web-feedback-design.md#http输入和输出)中的闭合同Ticket安全结果与原UUID用途回执；独立Schema/types保持additionalProperties:false |
| ReportPage | items:[{kind:'WEB_REQUEST'或'BOT_TICKET',ref,display_status,created_at,created_epoch_ms,ticket,safe_summary:string或null,safe_location:string或null}],next_cursor；BOT两safe字段为null |
| Timeline | items:[{event_type,occurred_at,occurred_epoch_ms,summary,ticket}],next_cursor |
| SafeTicket | ticket_no,status,updated_at?；不返回 Ticket UUID/内部备注 |

Web请求display_status=`RECEIVED_PROCESSING|WAITING_FOR_DETAILS|UNDER_REVIEW|TICKET_CREATED|NOT_SERVICE`；my-reports的BOT_TICKET则使用中文外部工单状态（如等待受理、已受理、处理中），不能用Web五枚举校验BOT条目。input_revision正十进制string；processed_revision允许 "0"；受理与处理修订不同，不能用202判断处理完成。safe_description/safe_summary是保留的Web输入展示，不代表已由AI脱敏；前端按文本渲染。

合成成功示例（这里只展示受理 envelope，不证明真实业务完成）：

```json
{"ok":true,"replayed":false,"receipt":{"client_command_id":"22222222-2222-4222-8222-222222222222","status":"ACCEPTED","request_ref":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","intake_no":"INT-20261007-0001","accepted_revision":"1","accepted_at":"2026-10-07 09:00:00","accepted_epoch_ms":"1791334800000"},"location":"/wecom/yixiaoxiu/reports/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}
```

时间线的 after/before 是十进制排序边界；cursor 绑定成员/请求/方向，不能和数字边界合用。获取最新页的既有客户端使用 `before=9007199254740991`，后续传回 next_cursor；响应顺序由服务端确定。

## 未知结果恢复与失败

请求中断后保留同一命令 ID，查询 `/commands/{id}`。恢复结果是 Receipt，不是 `{ok,receipt}`。404 表示当前未发现，不证明先前事务永远不会提交。恢复数据必须绑定 bootstrap 的 recovery_scope；切换身份时不得认领旧成员的未知命令。前端只保存有界、可验证的恢复元数据，不存原文、身份、Cookie 或 CSRF。

常见公开错误：`YXX_AUTH_REQUIRED`401、`YXX_FORBIDDEN`403、`YXX_NOT_FOUND`404、`YXX_CONFLICT`409、`YXX_INPUT_INVALID`400、`YXX_BODY_TOO_LARGE`413、`YXX_CONTENT_TYPE_INVALID`415、`YXX_UNAVAILABLE`503；native handler 会映射内部细分错误。退出有独立 `YXX_ENTRY_*` 映射。401/403 清空受保护内容，409刷新修订，不自动重复提交新命令。

完整契约：[OpenAPI](../../../contracts/yxx_self_service.openapi.yaml)、[types](../../../contracts/yxx_self_service_contracts.d.ts)、[request](../../../contracts/yxx_self_service_request.schema.json)、[supplement](../../../contracts/yxx_self_service_supplement.schema.json)、[receipt](../../../contracts/yxx_self_service_receipt.schema.json)、[detail](../../../contracts/yxx_self_service_request_detail.schema.json)、[list](../../../contracts/yxx_self_service_report_page.schema.json)、[timeline](../../../contracts/yxx_self_service_timeline.schema.json)、[bootstrap](../../../contracts/yxx_self_service_bootstrap.schema.json)、[catalog](../../../contracts/yxx_self_service_service_catalog.schema.json)。[契约冻结说明](../../runbooks/yixiaoxiu-self-service-contract-freeze.md)。

WBINT-T20 的[Web明确未解决反馈合同](web-feedback-design.md)现已实现上述详情context、POST及专用GET、043前向事实、正式H5和独立W消费，并完成[原七项本地整票验证](../../../plans/admin-workbench-integration/execution/t20.md)，待父独立审查/集成。反馈原binding、当前READ/WRITE、合法040完工round和Ticket版本独立核验；普通合法补充不隐式重开，CLOSED can_supplement=false继续拒绝。原目的GET不能继承已失去的READ；UNKNOWN仅明确GET，无自动POST/换UUID。独立raw恢复默认false，开启时复用T03 AES-GCM/non-extractable key、原scope/purpose、首次24h不续期、20份/16KiB；过期/损坏清敏感内容并保原opaque。cold rawOFF无旧row不创建IDB，仅当前挂载页内核对，不承诺刷新恢复。旧入口OpenAPI和上述独立[command](../../../contracts/yxx_self_service_feedback_command.schema.json)、[context](../../../contracts/yxx_self_service_feedback_context.schema.json)、[result](../../../contracts/yxx_self_service_feedback_result.schema.json)、[receipt](../../../contracts/yxx_self_service_feedback_receipt.schema.json)/[types](../../../contracts/yxx_self_service_feedback_contracts.d.ts)共同说明范围；不改变readonly/OAuth-only/SS011、默认关闭或现场停止线。原早期SOURCE/NOT_RUN与全部原始失败保留在本票逐候选历史。

核对：[native错误](../../../tests/yxx-ss-007-native-http-errors.test.mjs)、[HTTP恢复](../../../tests/yxx-ss-009-http-recovery.integration.test.mjs)、[目录](../../../tests/yxx-ss-009-catalog.integration.test.mjs)、[runtime](../../../tests/yxx-ss-010-runtime.integration.test.mjs)。成员轮询为有界5秒节奏，无SSE；数据库/外发/现场批准另查原运行契约。本轮未启动这些操作。


WBINT-T11完工后，实际获权的本人Web/Bot安全时间线只读取STAFF_COMPLETED明确关闭事件的已确认外部摘要（≤500字）；内部处理过程与普通备注不进入H5投影。它依赖原Intake/Journey本人授权，不因工作人员BROAD权限变成任意成员可见，不增加客户端完工动作。[完工合同](../workbench/tickets.md#工作人员完工wbint-t11)。

## 原H5 App通知详情（WBINT-T25）

原H5 FIRST/工作人员完工卡片指向 `/wecom/yixiaoxiu/reports/{requestRef}`，数据仍沿本模块当前MEMBER_SELF_SERVICE与原requestRef归属。MY_REPORTS启用、SELF_SERVICE关闭时本人可只读历史，卡片不会授予补充或反馈写权。通知来源/current资格和Sender在后端，独立成员B及退出后的当前浏览器拒绝读取；安全外显结果与内部过程分离。没有新命令或浏览器SDK，见[应用通知](../workbench/app-notifications.md)。
