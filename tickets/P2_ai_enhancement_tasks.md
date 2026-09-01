# Phase 2 任务明细：Conversation Center 与 AI 协作

> Phase 2 保持 `IN_PROGRESS`，P2-001 至 P2-006 均已完成；当前无活动任务或 Lane。P2-007 至 P2-014、其他 Lane 实现和 P2-G1 组装仍须另行授权并保持 `TODO / NOT_STARTED`。所有 Feature Flag 默认关闭。

## P2-001 Conversation Thread、Session 与控制模式契约

- 状态：DONE（2026-08-30）
- Evidence：`evidence/p2-001-conversation-contracts-report.md`
- Lane：P2-A
- 目标 Gate：P2-G1
- 依赖：P1-012

### 目标

冻结 Thread、Session、Conversation Item、控制模式、generation version 和群聊参与人隔离契约。建立 Conversation 与 Channel Message、Service Intake、Ticket 的关系，但不复制事实所有权。

### 交付物

- JSON Schema / TypeScript type；
- PostgreSQL 迁移草案；
- Session 创建、结束和话题切换规则；
- `AUTO/COPILOT/HUMAN` 状态转换；
- 群聊 `chatid + userid + intake` 键规则；
- 稳定错误码。

### 测试

- 单聊、群聊、多机器人；
- 同一用户多个 Session；
- 空闲过期和显式新问题；
- 重复创建；
- 群聊两个用户隔离；
- 非法状态转换；
- Feature Flag 关闭回归。

### 验收

- Thread/Session 唯一性无歧义；
- 群聊上下文不会跨用户；
- 关闭 Flag 时 P1 行为完全不变；
- Contract 由所有 P2 Lane 共同采用。

### 并行边界

P2-B/P2-C 当前只能读取冻结 Contract，不得启动 fixture 或实现开发；本任务不得直接引入 UI、SSE、真实外发或模型调用。

## P2-002 持久化 Timeline Projector 与可重建投影

- 状态：DONE（2026-08-30）
- 授权 Evidence：`evidence/p2-002-start-authorization.md`
- 完成 Evidence：`evidence/p2-002-timeline-projector-report.md`
- Task：`tasks/P2-002_persistent_timeline_projector.md`
- Lane：P2-A
- 目标 Gate：P2-G1
- 依赖：P2-001

### 目标

把 Channel Message、人工/AI Communication Message、Ticket Event、Delivery 和 Handoff 投影为稳定时间线。投影可重建、幂等且有 Session 内顺序。

### 交付物

- Conversation Item 表和 source binding；
- 唯一命名为 `CONVERSATION_TIMELINE` 的 Projector Worker；
- rebuild 命令；
- sequence 分配；
- 内外部可见性；
- projection checkpoint。

### 测试

- 相同 source event 重放；
- 乱序事件；
- rebuild 前后哈希一致；
- 内部备注；
- Ticket Event；
- 大批量投影；
- Worker kill/restart。

### 验收

- 重放不重复；
- 顺序稳定；
- 原始 Channel Message/Ticket Event 不被修改；
- 投影可从空表重建；
- 内部数据不进入外部视图。

上述 P2-002 验收已完成：Contract/Unit 39/39、PostgreSQL Integration 13/13；覆盖真实
`SIGKILL` 后重启恢复、锁内 stale rebuild race 拒绝、只执行 migration 011 的受限 CLI，
以及 2,001 Item 的有界批次投影。全仓最终回归数字、资源测量和数据库残留检查以完成
Evidence 为准。

### 并行边界

P2-002 已完成且保持冻结。P2-003 只能读取其安全 Contract/View，不得修改或把 Projector 隐式接入 Realtime Event Log；P2-G1 才允许另行组装。

### 资源约束

批次默认 20；单 Worker；不在事务内等待外部服务。

## P2-003 Realtime Event Log、SSE 补放与慢客户端治理

- 状态：DONE（2026-08-30 独立授权，2026-08-31 完成）
- 授权 Evidence：`evidence/p2-003-start-authorization.md`
- 完成 Evidence：`evidence/p2-003-realtime-event-log-sse-report.md`
- Task：`tasks/P2-003_realtime_event_log_sse.md`
- Lane：P2-A
- 目标 Gate：P2-G1
- 依赖：P2-001

### 目标

建立持久 Realtime Event Log 和 SSE，支持 Last-Event-ID 补放、权限裁剪、心跳和慢客户端治理。

### 交付物

- Event Log Schema；
- SSE endpoint；
- heartbeat；
- replay cursor；
- authorization filter；
- slow-client disconnect；
- polling fallback contract。

### 测试

- 32 个 SSE 客户端；
- 断线补放；
- 越权订阅；
- 慢客户端；
- Event Log 清理边界；
- App restart；
- SSE Flag 关闭时轮询。

### 验收

- 断线无事件丢失；
- 未授权事件不可见；
- SSE 失败不影响写命令；
- 2C4G 下无持续内存增长。

### 并行边界

可独立使用 Event fixture；P2-G1 才与真实 Projector 组装。

### 资源约束

SSE 初始上限 32；每客户端缓冲有硬上限。

## P2-004 统一 Communication Message / Outbox / Delivery

- 状态：DONE（2026-08-31 独立授权并完成）
- 授权 Evidence：`evidence/p2-004-start-authorization.md`
- Task：`tasks/P2-004_unified_communication_outbox_delivery.md`
- Evidence：`evidence/p2-004-communication-outbox-delivery-report.md`
- Lane：P2-B
- 目标 Gate：P2-G1
- 依赖：P2-001

### 目标

把人工回复、AI 回复和系统通知收敛到统一 Communication Message/Outbox/Delivery，并兼容现有 notification 表。

### 交付物

- Reply Command Schema；
- CommunicationPort；
- 现有 P1 Outbox compatibility adapter；
- client command idempotency；
- delivery status projection；
- retry/dead-letter。

### 测试

- 浏览器双击；
- AI 与人工相同 body 不同 idempotency；
- 发送超时；
- lease 过期；
- Gateway 重连；
- internal note 不创建 Outbox；
- 现有 P1 notification 回归。

### 验收

- 所有外部发送均先提交 Outbox；
- 重试不重复发送可控；
- 浏览器/AI 无 SDK 直连；
- P1 既有通知测试继续通过。

### 并行边界

可以使用 mock sender 并行，不依赖真实 WeCom。

### 资源约束

默认单 Delivery Worker，batch 20。

## P2-005 坐席分配、Read Cursor、Handoff 与 Generation Fence

- 状态：DONE（2026-08-31 独立授权并完成）
- Task：`tasks/P2-005_assignment_handoff_read_cursor_generation_fence.md`
- 授权 Evidence：`evidence/p2-005-start-authorization.md`
- 完成 Evidence：`evidence/p2-005-assignment-handoff-generation-fence-report.md`
- Lane：P2-B
- 目标 Gate：P2-G1
- 依赖：P2-001, P2-004

### 目标

实现坐席分配、每人 Read Cursor、Handoff 记录和 AI generation fence，解决多坐席抢占和人工/AI竞态。

### 交付物

- Assignment/Handoff/Read Cursor Schema；
- takeover/release/transfer commands；
- optimistic row version；
- generation version increment rules；
- audit events。

### 测试

- 两坐席并发接管；
- 管理员强制转派；
- 接管时 AI in-flight；
- 新消息与 AI 返回；
- Read Cursor 多用户；
- inactive principal；
- 越权。

### 验收

- 并发接管最多一人成功；
- 接管后旧 AI 发送为 0；
- 每个用户未读独立；
- 所有变更可审计。

### 并行边界

与 UI 并行，先通过 API/fixture 验收。

## P2-006 实时 Web Workbench、REST Command 与权限

- 状态：IN_PROGRESS（2026-09-01 独立授权）
- Task：`tasks/P2-006_realtime_web_workbench_rest_authorization.md`
- 授权 Evidence：`evidence/p2-006-start-authorization.md`
- Lane：P2-B
- 目标 Gate：P2-G1
- 依赖：P2-002, P2-003, P2-005

### 目标

在现有最小 Workbench 上增量形成实时会话工作台，提供列表、时间线、接管、回复、备注、Ticket/Incident 侧栏和失败状态。

### 交付物

- REST API；
- responsive Web UI；
- conversation list/filter；
- timeline pagination；
- takeover/reply/note/transfer；
- Ticket/Incident panel；
- delivery retry；
- accessibility/security headers。

### 测试

- 手机/桌面；
- 列表分页；
- SSE/轮询；
- 认证过期；
- CSRF/越权；
- XSS 内容；
- 附件签名；
- 内部备注；
- 浏览器刷新恢复。

### 验收

- Human-only 可完整处理；
- 新消息 P95 2 秒目标；
- 回复提交 P95 500ms（不含发送）；
- 内部备注外泄 0；
- 无 AI 时可生产运行。

### 并行边界

前端可对 mock API 并行开发；P2-G1 才与真实后端组装。

### 资源约束

首版不做富文本编辑器、营销、呼叫中心或多租户。

## P2-007 服务目录、确定性规则与对话字段模型

- 状态：TODO
- Lane：P2-C
- 目标 Gate：P2-G2
- 依赖：P1-012

### 目标

建立医院 IT 服务目录、别名、错误码、位置和临床关键规则，同时定义对话结构化字段和来源可信度。

### 交付物

- versioned catalog；
- deterministic rules；
- field definitions；
- fact provenance；
- conflict resolution；
- test corpus。

### 测试

- 否定词；
- 多系统冲突；
- 未知位置；
- 科室/发生地点区分；
- 临床高风险规则；
- 版本回归。

### 验收

- 未知值不猜测；
- 规则结果可解释；
- 人工确认优先级清晰；
- 规则不直接修改 Ticket 状态。

### 并行边界

可独立于 Conversation DB 使用纯函数和 fixture 开发。

## P2-008 DeepSeek Provider Adapter、脱敏与安全闸门

- 状态：TODO
- Lane：P2-C
- 目标 Gate：P2-G2
- 依赖：P2-007

### 目标

实现 DeepSeek Provider Adapter、超时/熔断、严格 Schema、Token/成本记录和消息脱敏安全闸门。

### 交付物

- provider interface；
- DeepSeek adapter；
- mock provider；
- redaction result；
- egress policy；
- Schema validation；
- circuit breaker；
- stable errors。

### 测试

- timeout；
- 429/5xx；
- invalid JSON；
- prompt injection；
- unknown enum；
- sensitive patient data；
- API key leak；
- provider disabled。

### 验收

- Provider 无 DB/SDK 权限；
- 敏感数据拒绝出域；
- 非法结果不进入业务；
- AI 关闭后无外部调用；
- 模型/Prompt/成本可追溯。

### 并行边界

P2-C 可先用 mock；真实 API 只在 P2-G2 授权环境。

### 资源约束

并发 1；15 秒 timeout；500 token output。

## P2-009 Context Builder、Rolling Memory、AI Job 与 AI Run

- 状态：TODO
- Lane：P2-C
- 目标 Gate：P2-G2
- 依赖：P2-001, P2-008

### 目标

构建 Context Builder、Rolling Summary、Structured Memory、durable AI Job/AIRun 和连续消息聚合。

### 交付物

- AIJob queue；
- AIRun audit；
- Context Builder；
- token budget；
- message relevance；
- summary versions；
- structured fact provenance；
- debounce batch。

### 测试

- 20+ messages；
- context overflow；
- three rapid messages；
- group user isolation；
- summary rebuild；
- worker crash；
- duplicate job；
- stale version。

### 验收

- 每次请求可解释使用了哪些事实；
- 默认上下文不超过 8K；
- 连续消息只调用一次；
- 过期结果标为 STALE；
- 不保留 Base64 或内部思维链。

### 并行边界

可用固定 Session fixture 开发，不依赖 UI。

### 资源约束

AI worker 并发 1；任务由 PostgreSQL durable queue 管理。

## P2-010 AI Shadow、Copilot、受控自动回复与评估

- 状态：TODO
- Lane：P2-C
- 目标 Gate：P2-G4
- 依赖：P2-006, P2-009

### 目标

依次实现 Shadow、Copilot 和受控 Auto 策略、人工反馈、评估集、版本门禁和一键回滚。

### 交付物

- mode policy；
- shadow result view；
- draft accept/edit/reject；
- allowlist；
- confidence/safety gates；
- evaluation runner；
- rollout config；
- kill switch。

### 测试

- shadow no-send；
- draft edit；
- human takeover race；
- low confidence；
- patient data；
- complaint/high-risk；
- model rollback；
- kill switch。

### 验收

- P2-G2 Shadow 无自动发送；
- Copilot 必须人工确认；
- Auto 只对白名单；
- unsafe/stale/patient leak=0；
- 一键关闭后无新自动回复。

### 并行边界

策略/UI/评估可并行；Auto 不得与前置 Gate 同时首次上线。

## P2-011 私有媒体、StoragePort、OCR 与敏感文本处理

- 状态：TODO
- Lane：P2-D
- 目标 Gate：P2-G3
- 依赖：P1-012

### 目标

建立可替换 StoragePort、受控媒体下载/扫描/留存和可关闭 OCR，默认不把原图发送外部模型。

### 交付物

- StoragePort；
- encrypted local/external S3 adapters；
- MIME/magic/hash；
- scan status；
- signed URL；
- OCR job；
- redacted OCR text；
- cleanup。

### 测试

- fake MIME；
- oversized；
- AES/download failure；
- malware rejection；
- storage down；
- OCR down；
- sensitive screenshot；
- retention delete。

### 验收

- 媒体失败不影响文字受理；
- 原图不进公开日志/模型；
- 附件访问需授权；
- OCR 可完全关闭；
- 2C4G 无常驻重型 OCR。

### 并行边界

可独立使用合成媒体，不依赖真实患者数据。

## P2-012 Incident、Reporter Subscription 与人工确认

- 状态：TODO
- Lane：P2-D
- 目标 Gate：P2-G3
- 依赖：P2-007

### 目标

实现 Incident、IncidentReport 和 ReporterSubscription，候选关联默认人工确认并可解除。

### 交付物

- Incident Schema/state；
- candidate fingerprints；
- confirm/unlink；
- primary ticket；
- subscriptions；
- public notices；
- audit events。

### 测试

- 多申报人；
- 相同系统不同问题；
- duplicate subscription；
- wrong link/unlink；
- notice rate limit；
- resolved/reopened incident。

### 验收

- Intake/Ticket 原始证据不删除；
- 默认无自动并单；
- 每位申报人通知可审计；
- 误关联可解除。

### 并行边界

规则候选可与 AI 独立开发；AI 不是必需。

## P2-013 Conversation、AI、Ticket、Incident 运营指标与月报

- 状态：TODO
- Lane：P2-D
- 目标 Gate：P2-G4
- 依赖：P2-006, P2-010, P2-012

### 目标

建立 Conversation、Handoff、AI、Ticket、Incident、Delivery 的固定指标和月报，排除测试数据并可追溯到事实。

### 交付物

- metric definitions；
- SQL rollups；
- data quality checks；
- monthly report；
- AI cost/acceptance；
- queue/dead-letter；
- test-data filters。

### 测试

- denominator；
- timezone；
- auto-close；
- incident dedupe；
- test exclusion；
- late events；
- rerun consistency。

### 验收

- 指标可重算；
- 不以 AI 覆盖率掩盖漏单；
- 每个指标有事实来源；
- 报表生成不影响核心负载。

### 并行边界

可基于 fixture 先开发，P2-G4 与真实事件组装。

### 资源约束

报表离峰执行，限制查询时间和内存。

## P2-014 P2 组装、2C4G 性能、安全、降级与 Go/No-Go

- 状态：TODO
- Lane：ASSEMBLY
- 目标 Gate：P2-G4
- 依赖：P2-010, P2-011, P2-012, P2-013

### 目标

完成 P2 全部 Lane 的组装、真实企业微信回环、故障注入、24小时资源浸泡、安全扫描、回滚和 Go/No-Go。

### 交付物

- assembly release candidate；
- migrations；
- E2E scripts；
- load/fault tests；
- security report；
- resource report；
- rollback runbook；
- P2 evidence。

### 测试

- AI/OCR全停；
- Gateway restart；
- DB短时不可用；
- worker kill；
- SSE断线；
- 32 clients；
- 500 outbox backlog；
- sensitive input；
- auto kill switch。

### 验收

- Human-only完整可用；
- 所有硬安全指标为0；
- 常态RSS<3.2GB；
- 无OOM；
- 回滚演练通过；
- 项目负责人批准 P2 Go。

### 并行边界

只在各 Lane 验收通过后创建 Assembly 分支。
