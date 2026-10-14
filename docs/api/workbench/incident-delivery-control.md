# Incident 分路投递控制（T33，默认关闭）

返回 [公共故障](incidents.md) · [会话投递](conversations.md) · [路径索引](../endpoint-index.md)。

宿主 W。实现复用 Incident、Communication Delivery 和原 incident.command_receipt，不新增 Ticket、状态所有权或第二份事件事实源。冻结的 [v1 设计原件](incident-delivery-control-design.md) 和六份原合同保持；本页记录真实实现及 v2 前向扩展。

## 当前授权

每次读取或执行都先核对当前活动主体、精确 Incident READ、当前范围及真实 Incident/Delivery 绑定。普通 retry 要求 ADMIN 或当前获权 DISPATCHER，以及独立 INCIDENT_DELIVERY_RETRY。UNKNOWN reconcile 要求 ADMIN 和独立 INCIDENT_DELIVERY_RECONCILE。负责人、HANDLER、一般 VIEW 或公开摘要 PUBLISH 均不额外授予控制权。权限 Port 默认 null，安全拒绝；incidentDeliveryControlEnabled 默认 false。

## HTTP 与原操作

| 方法与路径 | 输入与结果 |
| --- | --- |
| GET /api/incidents/{incidentId}/notifications/{deliveryId}/control | 无 query。闭合八字段 incident_id, delivery_id, attempt_count, purpose, retry, reconcile, receipt_read, disabled |
| POST /api/incidents/{incidentId}/notifications/{deliveryId}/retry | 下列共同正文；200 原路安全 ACK。PENDING 可以审计 no-op；DEAD_LETTER 只允许确定未应用 |
| POST /api/incidents/{incidentId}/notifications/{deliveryId}/reconcile | 共同正文再加 resolution；200 原路安全 ACK。只处理 UNKNOWN / RECONCILIATION_REQUIRED |
| GET /api/incidents/{incidentId}/notification-commands/{commandId} | 当前原动作用途获权后，只读同主体、同 Incident 的原 UUID。闭合 UNKNOWN、COMMITTED 或 FAILED，不返回命令正文、hash、供应凭据或外部身份 |

共同正文为 client_command_id:UUID、expected_row_version:十进制 string、expected_status、expected_side_effect_state、reason_code，并在 v2 增加 expected_delivery_attempt_count（安全整数 0..2147483647）。父版本仍指 Incident，不能用它代替 Delivery 尝试快照。Header 为同一 UUID 的 Idempotency-Key、精确双引号 If-Match 和当前 Cookie 的 CSRF/Origin。正文上限沿宿主 32 KiB，未知字段拒绝。

resolution 为 CONFIRMED_SENT、CONFIRMED_NOT_SENT_REQUEUE 或 CANCEL。确认已发只记录结果，不调用 Sender；核实未发只有当前真实发送准入成立才重队列；CANCEL 保留结果 UNKNOWN。核对结果不表示报修人已读。T31 个人进展重队列和原 Worker 再次发送都检查 ACTIVE、未暂停、有效个人绑定及保留期；旧生命周期 GROUP/DIRECT 保持原规则。

ACK 闭合为 ok, incident_id, delivery_id, client_command_id, status, side_effect_state, attempt_count, replayed。原 UUID 当前验权后先读原 ledger，再做新命令 CAS；其后 Delivery 变化不能导致同一 UUID 再执行。新的 UUID 必须带当前真实快照。v1 规范化 hash 保持，原 UUID 可核对/重放；新 v1 UUID 只允许可证明的初次尝试（PENDING 0 或确定失败/UNKNOWN 1），晚于初次必须显式使用 v2。改变同一 UUID 的正文返回冲突。共享 HTTP 拒绝为单字段 {error:{code,retryable:false}}；安全 FAILED 回执是独立只读合同，不能混为 POST 的外层格式。

当前 Actor 的会话、精确 READ、角色、范围或独立动作用途失效仍返回 401/403/404，界面立即停止该用途敏感展示。已获权命令的发送准入变化（例如当前个人订阅已暂停）属于既有 409 / P2_012_STATE_CONFLICT；同事务记录 FAILED，Delivery 与 Sender 不变。界面把它显示为已知拒绝并保留捕获的路、原因和结论，允许显式只读刷新。明确终态已核对且恢复清理成功后，可以释放原 UUID 屏障，不要求永久展示已终结操作。

## 权限与状态分开

同一 GET control 事务返回两个前向 Header：X-Incident-Delivery-Retry-Authorized 和 X-Incident-Delivery-Reconcile-Authorized，值严格为 1 或 0。它们包含当前独立权限、角色、范围、精确 READ 和绑定，不因当前 Delivery 状态改变。八字段 JSON 不增加字段；retry/reconcile 继续表示当前状态是否允许一个新意图。浏览器拒绝缺失、非法或与 receipt_read/状态能力矛盾的 Header。服务器始终独立验权，Header 不能授权业务执行。

正式界面一次明确选择一路并捕获 v2 尝试；后续 GET、SSE、恢复或重放不改写原快照。结果未知时保留原 UUID、完整正文和版本。另一合法操作使通知变成 SENT，仍获原动作用途权的人可以先显式只读核对，再重新确认并显式原字节重放；服务器按原 ledger 或 CAS 返回终态。没有自动 POST 或新 UUID 替代。

恢复开关沿既有 workbenchDraftRecoveryEnabled，默认 false。开启后复用现有当前浏览器 AES-GCM、16 KiB、20 份草稿/20 个未核对操作及初次保存起 24h；不会复制内部记录。open 的前置读取不授予展示权，解码后的所选 Delivery 在展示前再次获权核验。真实 DRAFT_CHANGED 重验/rebase 读取本次排队保存的准确副本所指 Delivery 和动作；失权只清理该 Incident/通知用途。普通自动保存不新增每 500ms 网络核验。

## 迁移、关闭与资源

060_workbench_incident_delivery_control 是原 Incident receipt 的最小前向扩展；已有命令、列、索引、约束和旧迁移保持。现有真实 055、058、054 依赖满足后显式使用已编译 scripts/incident-delivery-control-migrate.mjs 的 --status、--check 或 --apply；check 回滚，目录/校验和漂移拒绝。隔离 fixture 的实际依赖顺序为 055→058→054→060；没有生产 runtime 自动 DDL。

关闭 incidentDeliveryControlEnabled 停止新 POST；仍获原动作用途权的人可只读原 UUID，UNKNOWN/历史回执不删除。新增恢复副本受现有关闭/到期清理策略约束。无需回写 Ticket、删除 Delivery 或倒退旧 SQL。

一 App、一原 Communication Worker、并发 1、无新增 Gateway，SSE 上限 32，总连接池沿 8 以内预算。本票隔离主 pool2、admin1、必要锁验证 blocker1；专用测试的已有 realtime 默认关闭 profile 仅用于区分真实 rebase 与后台刷新因果。真实外部发送、部署、full/certify 和业务 Gate 不在本票授权中。

实际运行对象、失败原件、前向 Source 校准与局部验证见 [T33 / WBINT-11 执行记录](../../../plans/admin-workbench-integration/execution/t33.md)。
