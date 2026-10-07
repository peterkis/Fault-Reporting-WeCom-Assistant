# 内部Port、Worker与事件索引

返回 [导航](../README.md) · [HTTP索引](../endpoint-index.md)

下表是进程内调用或持久化事件，**没有独立REST入口**。前端使用对应HTTP facade；后端在既有事务与授权边界内使用Port。领域术语沿用 [CONTEXT.md](../../../CONTEXT.md)，本轮不新建一套领域语言。

| 边界 | 当前接口 / 输入输出 | 已有HTTP映射 | 权威契约/实现 |
| --- | --- | --- | --- |
| UnifiedTicketCommandPort | perform({authContext,command})；Ticket命令→ok/replayed/Ticket与event refs或error | [Ticket动作](../workbench/tickets.md) | [types](../../../contracts/p2_016_contracts.d.ts)、[facade](../../../src/p2-016-ticket-command-facade.mts) |
| UnifiedTicketQueryPort | list/detail/responsibility；authContext和筛选/ID→安全DTO | [Ticket查询](../workbench/tickets.md) | [types](../../../contracts/p2_016_contracts.d.ts)、[query扩展](../../../src/p2-016-ticket-query.mts) |
| Intake→建单adapter | createForIntakeInTransaction/createForIntake；已有Intake→唯一Ticket；safe-action端口createMinimalTicket | 无直接“创建Ticket”REST；成员新建是先受理Intake | [core](../../../src/p1-005-pilot-ticket-core.mts)、[safe executor](../../../src/p2-015-safe-action-executor.mts) |
| ReporterDirectoryPort | resolve(input)→RESOLVED+snapshot，或DEFERRED/NOT_FOUND/NOT_REQUIRED+空snapshot；默认500ms/最大2000ms，单飞失败降级 | 无Provider透传REST；仅内部reporter-contact投影 | [types](../../../contracts/p2_015_contracts.d.ts)、[Journey](../../../src/p2-015-contact-journey.mts) |
| Service Intake Decision | apply({transaction,input})；result_code/intake_id/expected_version/时间/trace/decision refs→applied/replayed/intake；状态与事件同事务 | [人工复核](../workbench/manual-reviews.md)、[成员受理](../member/self-service.md)经编排 | [decision port](../../../src/p2-015-service-intake-decision-port.mts) |
| Conversation Control | Assignment/Handoff/ReadCursor/Generation Fence命令及追加事件；接管使旧AI结果STALE | [会话命令](../workbench/conversations.md) | [types](../../../contracts/conversation_control_contracts.d.ts)、[control](../../../src/p2-005-conversation-control.mts) |
| Communication SenderPort | send(request)：provider/account/target/delivery/idempotency/message/signal→ACKNOWLEDGED/REJECTED_NOT_APPLIED/UNKNOWN | 浏览器只入Outbox，无直接SDK send REST | [types](../../../contracts/communication_contracts.d.ts)、[sender port](../../../src/p2-004-communication-sender-port.mts) |
| Delivery Worker / operator | runOnce/deliver/getDelivery/recoverExpiredSending；持久化队列、重试、UNKNOWN核对 | [通信控制](../workbench/conversations.md)、[Ticket控制](../workbench/tickets.md) | [worker](../../../src/p2-004-communication-delivery-worker.mts) |
| IncidentCommand/QueryPort | perform闭合union、list/detail/实现children；人工确认和范围授权→事件ref/version/replayed | [Incident](../workbench/incidents.md) | [types](../../../contracts/p2_012_contracts.d.ts)、[query](../../../src/p2-012-incident-query.mts) |
| RealtimeEventStore | append/appendInTransaction/getHighWatermark/getReplayWindow/listAuthorizedEvents/checkRetention/cleanupRetention等aliases | [SSE](../platform/realtime.md)；不是Ticket事实源 | [types](../../../contracts/conversation_realtime_contracts.d.ts)、[event log](../../../src/p2-003-realtime-event-log.mts) |
| Web受理/补充/Processor | command.accept、supplement.accept、store+bounded pump/既有Worker；先持久化，再确定性处理 | [成员POST/恢复查询](../member/self-service.md) | [runtime](../../../src/yxx-self-service-runtime.mts)、[store](../../../src/yxx-self-service-store.mts) |

`docs/35` 的createFromIntake/performAction/getById/list/readAfter是长期facade设计示例。当前Command/Query的准确签名以上述types和实现为准；`UnifiedTicketEventPort` 当前没有同名src/contracts接口，不能虚构其可导入模块或REST路径。[长期设计](../../35_unified_ticket_and_intranet_connectors.md)。

## 事件契约

[domain_events.md](../../../contracts/domain_events.md) 描述公共envelope：event_id/event_type、occurred_at/occurred_epoch_ms、aggregate refs/version、ordinal、trace_id、schema_version、payload。消费者按event_id幂等、聚合内按ordinal顺序；不得把每个具体事件都当拥有完全相同字段的HTTP响应。

| 事件域 | Schema / 契约 | 使用方 |
| --- | --- | --- |
| Ticket | [ticket_event](../../../contracts/ticket_event.schema.json) | 生命周期、Outbox通知与投影 |
| Conversation | [projection](../../../contracts/conversation_projection_contracts.d.ts)、[control](../../../contracts/conversation_control_contracts.d.ts) | Timeline、Assignment、Fence与实时 |
| Incident | [incident event](../../../contracts/p2_012_incident_event.schema.json) | 聚合、公开里程碑、订阅通知 |
| Realtime | [realtime schema](../../../contracts/conversation_realtime_event.schema.json) | SSE授权投影、重读REST |
| Integration | [integration_event](../../../contracts/integration_event.schema.json) | P3长期设计，不能据此视为已启动真实Connector |

payload不含秘密/未脱敏患者文本，内部备注保持内部。资源遵循单App/API/SSE、单Worker、单活Gateway与现有有界batch；不能把内部Port索引当批准新的进程、队列系统或生产接口。测试及HTTP验证从各模块文档进入，原证据保持不变。
