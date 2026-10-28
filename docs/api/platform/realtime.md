# SSE实时事件

返回 [导航](../README.md) · [路径索引](../endpoint-index.md) · [公共约定](../conventions.md)

唯一产品SSE入口：`GET /api/realtime/events`，宿主W；不是REST JSON列表。query只有可选 `scope=workbench`，不得携带token或自造cursor。恢复Header为 `Last-Event-ID: <十进制event_id>`。浏览器EventSource的原生重连可以发送它，既有前端不手动注入Header。

实现：[SSE](../../../app/server/src/p2-003-realtime-sse.mts)、[event log](../../../app/server/src/p2-003-realtime-event-log.mts)、[G1装配](../../../app/server/src/p2-g1-runtime.mts)。`CONVERSATION_REALTIME_SSE_ENABLED` 默认false；实际handler还需要身份、授权、存储。内部W在认证过期时断流，handler重新核对范围，普通角色与RESTRICTED_ADMIN区分。

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

事件是重读REST的信号。会话UI依据bootstrap的polling_interval_ms，lifecycle/Incident保留既有5秒节奏。正式 `/workbench/app/` 的授权实时接入见下节；Reporter与成员报修不使用此流。不能新增 `/api/realtime/poll` 等未实现端点，或把测试CDP WebSocket写成产品服务。

## 正式管理端接入（WBINT-T38）

Electron 前向适配见 [ADR-0047](../../../adr/0047_electron_pc_admin_mvp.md)：用户主动开启桌面提醒且未锁屏/挂起时，隐藏窗口可保留原唯一 SSE/时钟，只核验 bootstrap 和提醒；恢复前台重新读取业务资料。原生窗口状态独立控制个人阅读与活动，普通浏览器隐藏暂停合同不变。无第二流、轮询器或事实源。

宿主 `workbenchRealtimeEnabled:boolean=false`，只向当前 Cookie 身份开放。`GET /api/lifecycle/bootstrap` 的 [类型](../../../contracts/workbench_realtime_contracts.d.ts) 返回 `realtime_sse_enabled:boolean,realtime_sse_available:boolean,sse_endpoint:string|null,polling_interval_ms:number,expires_epoch_ms:string,authorization_revision:string|null`。endpoint只能是同源 `/api/realtime/events?scope=workbench`；关闭时为null、available为false。期限保留十进制BIGINT string。revision是当前有效主体/角色/组的opaque变化标记，不是授权票据；每个对象仍须通过当前GET授权。原 `csrf_token:string|null` 读取合同保留，缺独立CSRF cookie不禁止已授权GET/SSE；写命令仍需原Origin/CSRF。

新启用路径以既有256总预算完整表示去重的Session+Thread+SYSTEM Ticket授权范围。合法超预算返回bootstrap200/availablefalse以及SSE503 `TEMPORARY_UNAVAILABLE`，仅做有界授权GET回退；不截断范围、提高预算或把权限403变成503。关闭时保留原SSE授权profile。无数据库变更、第二Ticket事实源、新连接池或进程。

[单适配器](../../../app/pc-admin/src/realtime/workbench-realtime-client.mts) 与 [Query接入](../../../app/pc-admin/src/realtime/useRealtime.ts) 每个当前主体只有一个原生EventSource、一个5秒timer、一个当前读AbortController和一个pending位。只失效当前主体静态识别且已挂载的活动GET families，不重读后台inactive对象。公开事件unknown解码保留string BIGINT，验证九字段及64KiB/深度6/节点4096等边界，只取安全event_id/event_type作为重读提示；payload不覆盖业务状态，重复/乱序不执行POST。

CONNECTING保留同一原生源及Last-Event-ID；CLOSED/retention gap后先fresh bootstrap与当前GET，再按有界节奏创建新原生源，清旧cursor。同一timer对长GET提供5秒截止与迟到完成栅栏，不并行轮询。隐藏/离线停止流、读和timer，恢复先完整重验。主体或有效范围变化取消并栅栏旧GET/回调；新主体不能继承旧cursor、事实或草稿。可信401/403/404沿既有范围清理，不能因编辑而保留失权明文。

断线、轮询和最近成功读取时间在正式页可见。短暂REST失败保留最后确认数据与输入/焦点并标明；已接入的备注、处理与群名表单阻止新的prepare/POST，原UNKNOWN显式核对与只读receipt继续沿原合同。无关GET成功不能解除此限制，完整fresh周期成功才恢复。SSE单独断线、容量或授权预算不可用，而REST健康时仍允许人工操作。打开的看板操作对象只固定仍获权的ID显示顺序，最新字段仍取当前GET；对象失权即移除，关闭详情/离开操作对象后恢复服务器排序。没有卡片快照或新的排序事实。

关闭 `workbenchRealtimeEnabled=false` 后正式页不创建新增EventSource/global polling；原已提交事实保留。输入/HTTP/权限/资源与实际分段证据见 [T38执行](../../../plans/admin-workbench-integration/execution/t38.md)。T39 presence、T40音效及真实外部依赖/发送/部署/full/certify/Gate均不在本票。

默认资源：[SSE defaults](../../../app/server/src/p2-003-realtime-sse.mts) 32 clients、20秒heartbeat、5秒恢复poll、每批50、64KiB写缓冲、5秒drain截止；event-log默认保留168小时，实际有效窗口以store为准。SSE可清理、可重建，不是业务事实源。

核对：[event-log unit](../../../tests/p2-003-realtime-event-log.test.mjs)、[integration](../../../tests/p2-003-realtime-event-log.integration.test.mjs)、[说明](../../39_p2_003_realtime_event_log_sse.md)及T38已注册Unit/真实HTTP/正式bundle浏览器入口。实际浏览器流在任务自有合成环境验证，不代表部署或现场授权。
