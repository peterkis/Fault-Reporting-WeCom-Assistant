# SSE实时事件

返回 [导航](../README.md) · [路径索引](../endpoint-index.md) · [公共约定](../conventions.md)

唯一产品SSE入口：`GET /api/realtime/events`，宿主W；不是REST JSON列表。query只有可选 `scope=workbench`，不得携带token或自造cursor。恢复Header为 `Last-Event-ID: <十进制event_id>`。浏览器EventSource的原生重连可以发送它，既有前端不手动注入Header。

实现：[SSE](../../../src/p2-003-realtime-sse.mts)、[event log](../../../src/p2-003-realtime-event-log.mts)、[G1装配](../../../src/p2-g1-runtime.mts)。`CONVERSATION_REALTIME_SSE_ENABLED` 默认false；实际handler还需要身份、授权、存储。内部W在认证过期时断流，handler重新核对范围，普通角色与RESTRICTED_ADMIN区分。

## 200流格式

Content-Type=`text/event-stream`；每条事件为：

```text
id: 42
event: ticket.status.changed
data: <RealtimePublicEventView的单行JSON>

```

尖括号部分是协议说明占位符。公开数据字段为 `event_id,event_type,aggregate_type,aggregate_id,aggregate_version,visibility_scope,payload,occurred_at,created_at`；event_id为十进制string，aggregate_version为string或null，没有公开event_ordinal字段。定义见 [types](../../../contracts/conversation_realtime_contracts.d.ts)、SSE `encodeRealtimeSseEvent`；[realtime schema](../../../contracts/conversation_realtime_event.schema.json)还包含存储/内部字段，不能全量作为公开DTO。计数不能当不安全JS number或用于直接覆盖Ticket。

事件族含 conversation.session/item/timeline/mode/assigned/handoff/read_cursor，communication.delivery，ticket.updated/command/status/assignment/notification，manual_review.created/resolved，incident.candidate/confirmed/status/scope/primary_ticket/report/subscription/notification，gateway.connection。完整枚举在event-log的 `REALTIME_EVENT_TYPES`，同一事件只发授权安全投影。

## 错误与恢复

流建立前可能返回JSON：`{ok:false,error:{code,retryable},fallback?}`。401/403是身份/权限失败，不能降级伪装成成功轮询。非法/超前Last-Event-ID报cursor错误；已越过保留窗口可410并要求重新读取；禁用、容量、临时不可用可503 fallback。

Fallback完整字段：`fallback_required:true,reason,poll_after_ms,strategy,latest_event_id,retention_floor_event_id`；reason=`SSE_DISABLED|CAPACITY_REACHED|REPLAY_GAP|TEMPORARY_UNAVAILABLE`，strategy=`REFETCH_CONVERSATION_LIST_AND_TIMELINE|POLL_UNTIL_SSE_AVAILABLE`。[fallback schema](../../../contracts/conversation_realtime_fallback.schema.json)。W没有注入sseHandler时还可能先返回 `WORKBENCH_SSE_UNAVAILABLE`。

事件是重读REST的信号。会话UI依据bootstrap的polling_interval_ms，lifecycle/Incident有单个5秒节奏；WEB01、Reporter、成员报修当前不使用SSE。不能新增 `/api/realtime/poll` 等未实现端点，或把测试CDP WebSocket写成产品服务。

默认资源：[SSE defaults](../../../src/p2-003-realtime-sse.mts) 32 clients、20秒heartbeat、5秒恢复poll、每批50、64KiB写缓冲、5秒drain截止；event-log默认保留168小时，实际有效窗口以store为准。SSE可清理、可重建，不是业务事实源。

核对：[event-log unit](../../../tests/p2-003-realtime-event-log.test.mjs)、[integration](../../../tests/p2-003-realtime-event-log.integration.test.mjs)、[说明](../../39_p2_003_realtime_event_log_sse.md)。本轮只记录协议，没有启动监听或扩容。
