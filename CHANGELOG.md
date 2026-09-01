# Changelog

### P2-G1 Human-only Conversation Center Assembly 就绪

- 项目负责人于 2026-09-01 正式、独立授权 `P2-G1 / ASSEMBLY`；固定基线为 `1c18d5653b17e4368b5fa057d513e1af1a8b4622`。
- P2-001 至 P2-006 保持 `DONE`，`last_completed_task` 保持 P2-006；P2-G1 自动化 Assembly 终态为 `READY_FOR_LIVE_E2E`。
- 授权范围限于 P1/P2 Human-only 组装、真实测试 Gateway/Sender、受控测试认证、隔离 PostgreSQL 自动化和显式进程级批准下的测试范围。
- 新增持久投影协调器、真实测试 Gateway/Sender、受控 Test Authentication、单 App Runtime、Health/资源指标以及 Synthetic/Fault/Resource/Live 工具；无新增 migration，所有 Feature Flag 默认关闭。
- 隔离 PostgreSQL、系统浏览器、故障/容量与 P1/P2 回归通过；真实企业微信、60 分钟现场资源观察与项目负责人 Gate 批准均未执行，因此不是 `PASSED / GO`。P2-007、AI/OCR/Incident、P3、生产启用和远端发布仍未授权。
- 真实现场预检后加固 Live Harness：支持至少两个 active Pilot Principal 的隔离短期认证、Safe Ready/run ID 输出和两个临时浏览器 Profile 的 HttpOnly Cookie 注入；原始标识与认证材料不输出，Inbound Shadow 继续保持真实发送关闭。
- 首次 Inbound Shadow 在真实发送关闭时发现既有 Channel Message 投影 backlog；修复 `DIFFERENT_INTAKE` 边界以原子结束旧活动 Session，并将 backlog=0/failure=0 纳入 Ready。失败现场记录保留，修复后必须使用新 HEAD 重做 Live E2E。
- 第二次 Inbound Shadow 的 20 条真实测试入站均完成 P1/Timeline/Realtime，但两个临时浏览器错误导航到根路径并返回 `WORKBENCH_NOT_FOUND`；修复为冻结 `/workbench` 入口并新增双浏览器真实路由/Cookie 回归。该 run 保持 BLOCKED。

### P2-006 Human-only Workbench 完成

- 新增默认关闭的 Node 原生 REST Server、Pilot 数据面授权、稳定 keyset/timeline query、P2-004/P2-005 command facade、Delivery retry/reconciliation 与 P2-003 SSE route。
- 新增原生 HTML/CSS/ES Module Internal Alpha、系统 Edge 双视口验证、隔离 PostgreSQL catalog/容量/性能验证；P2-006 无数据库迁移。
- P2-006 标为 `DONE`，但 P2 仍为 `IN_PROGRESS`；当前无活动 Lane，P2-G1、P2-007 及以后仍须另行授权，全部 Feature Flag 保持 `false`。

## [Unreleased]

### P2-006 Human-only Workbench 授权启动

- 项目负责人于 2026-09-01 正式、独立授权仅启动 `P2-006 / P2-B`；基线为 `6afe8157bfcae49d391d0f6e2aa5c60388377ea5`。
- 新增授权 Evidence 与任务记录；P2 状态保持 `IN_PROGRESS`，唯一活动任务为 P2-006，P2-001 至 P2-005 保持 `DONE`。
- P2-006 明确无数据库结构变更，不创建 migration 022；Native UI 仅为 Internal Alpha / Reference Client，不冻结最终生产前端。
- P2-G1、P2-007 及以后、真实 Sender/身份/内网、AI/Media/Incident 和远端发布仍未授权；全部 P2/P3 Feature Flag 保持 `false`。

### P2-005 坐席分配、Read Cursor、Handoff 与 Generation Fence

- 项目负责人于 2026-08-31 正式、独立授权仅启动 `P2-005 / P2-B`；基线为 `7e9a41498c471be4deca235439440ea7f157bdd4`。
- P2-005 已于 2026-08-31 完成：新增四张 `conversation.*` 控制表、业务命令幂等、Assignment/Handoff 生命周期、每 Principal Read Cursor、Generation Fence、Pilot 授权兼容、P2-004 Assigned Communication Authorizer 与纯 Projection Mapper。
- Contract/Unit `11/11` 与 PostgreSQL Integration `6/6` 通过；完整回归、并发、资源和残留结果记录在 `evidence/p2-005-assignment-handoff-generation-fence-report.md`。
- 当前无活动任务或 Lane；P2-006 及以后、P2-G1、真实 Workbench/REST、真实 Sender、模型、医院内网和生产功能仍未授权。全部 P2/P3 Feature Flag 保持 `false`；完成后已停止。

### P2-004 统一 Communication Message / Outbox / Delivery

- 项目负责人于 2026-08-31 正式、独立授权仅启动 `P2-004 / P2-B`；基线为 `2b4548888882ce895a85f513d0a5bb57d9920b91`。
- P2-004 已于 2026-08-31 完成：新增四张 `communication.*` 表、业务命令幂等、权威目的地解析、caller-owned transaction/standalone Service、P1 Notification 只读兼容、Mock Sender、Lease/Retry/Unknown/Dead Letter/Reconciliation Worker，以及纯 Projection Mapper。
- Contract/Unit `17/17` 与 PostgreSQL/Worker Integration `9/9` 通过；完整回归、资源和残留结果记录在 `evidence/p2-004-communication-outbox-delivery-report.md`。
- 当前无活动任务或 Lane；全部 P2/P3 Feature Flag 保持 `false`，P2-G1 保持 `NOT_STARTED`。P2-005 及以后、真实 Workbench/REST/权限、真实企业微信新增 Sender、模型、医院内网和生产功能均未授权；完成后已停止。

### P2-003 Realtime Event Log、SSE 补放与慢客户端治理

- 项目负责人于 2026-08-30 正式、独立授权仅启动 `P2-003 / P2-A`；基线为 `d59de5d7db39c4a39f82093496a0e42565d67a7e`。
- P2-003 已于 2026-08-31 完成：新增 migration 012、非权威 durable Realtime Event Log、caller-owned append、SQL-first authorization clipping、PostgreSQL replay、SSE heartbeat/recovery、32-client capacity、slow-client isolation、polling fallback 与连续前缀 retention。
- Contract/Unit `41/41` 与 PostgreSQL/SSE Integration `10/10` 通过；完整回归与资源/残留数字记录在 `evidence/p2-003-realtime-event-log-sse-report.md`。
- P2-003 完成当时无活动任务或 Lane，P2-004 尚未授权；当前授权前沿以上方 P2-004 条目为准。P2-G1 和所有生产功能仍须另行授权，全部 P2/P3 Feature Flag 保持 `false`。

### P2-002 持久化 Timeline Projector 与可重建投影

- 项目负责人于 2026-08-30 正式、独立授权仅启动 `P2-002 / P2-A`；该任务已完成并停止；其终态随后由上方 P2-003 独立授权继续推进。
- 新增唯一 `CONVERSATION_TIMELINE` Projector、规范化 Source Record、Source Binding、Audience Query、当前 P1 事实只读 Mapper、未来来源 fixture Mapper，以及只含 Item/Binding/Checkpoint 三表的 migration 011；Unified Ticket Core 和各上游事实所有权不变。
- 普通增量 `projectBatch` 在同一事务 CAS 推进全局 `(projector_name, source_stream)` Checkpoint；单 Session Rebuild 锁住相关 Checkpoint Key 与 Session，但保留全局 Checkpoint、返回 `checkpoint_updated=false`，并以完整 Binding identity/hash/privacy/retention fence 和持久化 Timeline Hash 拒绝 stale 或不一致重建。
- P2-002 Contract/Unit 39/39、PostgreSQL Integration 13/13 通过，覆盖真实 `SIGKILL` 后重启、stale rebuild race、only-011 CLI 与 2,001 Item 有界批次；全仓回归、资源和残留结果见 `evidence/p2-002-timeline-projector-report.md`。
- 在 P2-002 完成时，P2-003 至 P2-014、P2-G1 及全部 P3 任务尚未授权；当前授权前沿以上方 P2-003 条目为准，全部 P2/P3 Feature Flag 继续为 `false`。

### P2-001 Conversation Thread、Session 与控制模式契约

- 冻结 Thread 四元自然身份、参与人隔离 Session、Conversation Item、`HUMAN/COPILOT/AUTO` 控制模式与 generation/row version 契约；新 Session 默认 `HUMAN`。
- 新增仅含 `conversation.thread` 与 `conversation.session` 的 010 增量迁移，包含创建幂等、单活 Session、可空 Service Intake 引用和失败关闭的漂移检查；Item 持久化明确保留给 P2-002。
- 全部 P2/P3 Feature Flag 继续为 `false`，未实现 Timeline、SSE、真实外发、Handoff、Assignment、模型、OCR、Incident 或 P2-G1 组装。
- P2-001 已完成，当前无活动实施任务；P2-002 仍为 `TODO` 且须项目负责人另行授权。

### ARCH-004 P1 → P2 阶段切换

- 项目负责人于 2026-08-30 独立授权启动 Phase 2；ARCH-004 切换时状态为 `P2 / P2-001 / IN_PROGRESS`，P1-012 的 `DONE / GO`、完成日期与 Evidence 保持不变。
- 本轮仅授权 ARCH-004 和 P2-001；P2-002 至 P2-014、P2-G1 组装及全部 P3 任务仍未授权，所有 P2/P3 Feature Flag 保持 `false`。
- `project_summary.json` 已从 V1.2 残留升级为 V1.4，长期事实源统一为本仓库 Unified Ticket Core，P3 保持无历史 Ticket 兼容的绿地接入。
- 本授权不等同于生产上线、临床上线或 AI 自动回复批准；未授权真实外发、SSE、模型、OCR 或医院内网连接。

### P1-005 至 P1-010 Pilot Ticket Core 闭环（本机 PostgreSQL 集成验收完成）

- 新增独立 Pilot Ticket Core：Service Intake 双向一对一主工单、稳定 `IT-YYYYMMDD-NNNN` 编号、`PILOT_IT` 默认处理组、版本与 Intake 创建审计事件；不调用 Hospital Tickets。
- 新增显式 Ticket Action、乐观锁与追加式 Ticket Event；状态、事件与 Pilot Outbox/Delivery 同事务，Worker 使用可执行目标矩阵、逐目标窗口限流、目标幂等、租约、`SKIP LOCKED`、指数重试和死信审计。
- 新增提交后首次确认编排和真实事实限定的临时失败回复、Pilot-local principal/角色/处理组和最小工作台，以及补充、卡片任务回执、关闭前提醒、确认关闭、`AUTO_TIMEOUT` 自动关闭与 `CLOSED -> REOPENED` 闭环。
- P1-005 至 P1-010 串行真实 PostgreSQL 集成回归 18/18、全仓串行回归 147/147 通过。sender 与卡片均为注入式/合成边界；本次未发送真实企业微信消息、未验证客户端显示/点击、未接入医院 SSO、Hub、Hospital Tickets、Ticket Adapter 或 AI/OCR，因此不构成公网或临床试点验收。

### P1-004 Service Intake 创建与消息聚合（本机 PostgreSQL 集成验收完成）

- 新增独立 `intake.service_intake`、消息关系和 Intake 审计事件迁移，并通过 P1-003 首次处理回调与 Channel Message 同事务提交/回滚。
- 新增含边界的 90 秒同上下文聚合、PostgreSQL advisory lock、显式新报修/另一工单分流、八类确定性请求规则，以及纯图片和等待描述后的澄清路径。
- 定向真实 PostgreSQL 测试 22/22、全量带库回归 99/99 通过，覆盖 12 路不同消息并发、显式边界逆序与边界后回挂、分句否定、隐私/留存聚合、旧快照失败关闭及 CLI 稳定错误映射、重放、整笔回滚、五位数编号、事件顺序和迁移/契约范围；所有结果均未创建 Ticket、Incident、Outbox、AI/OCR 或医院系统依赖，P1-005 未启动。

### P1-003 Channel Message Inbox 与数据库幂等（本机 PostgreSQL 集成验收完成）

- 新增独立 `channel.message_inbox` 可执行迁移、`pg@8.23.0` 驱动和无敏感输出迁移命令；精确唯一键为 `(provider, msg_id)`，`req_id` 只作通道关联。
- 新增事务 Inbox：首个请求在同一事务内保存消息并执行一次处理器、持久化 JSON 结果快照；并发重复等待提交后返回原记录和结果，失败则整笔回滚。
- 定向真实 PostgreSQL 测试 9/9、带数据库全量回归 77/77 通过，覆盖 12 路并发、事务回滚/提前提交防护、两个独立 Node 进程重启、数据库不可用、隐私/留存和迁移范围；P1-004 未启动。

### P1-002 WeCom SDK Adapter 与标准消息契约（本地 Contract 验收完成）

- 新增单一 `adaptWeComSdkFrame` seam，把锁定 SDK `1.0.6` 的文本、图片、mixed、文件、语音、视频和引用 Frame 转换为 SDK 无关的 Normalized Message。
- 新增有序 content、可空提供方时间/独立接收时间、`provider + msg_id` 幂等键、opaque 媒体引用，以及不回显 URL、AES Key 或 `response_url` 的稳定错误结果。
- P1-002 定向 Contract Test 10/10、当时全量本地回归 68/68 通过；该任务验收时未启动真实 WSS、消息持久化、Service Intake、Ticket、AI/OCR 或 Hospital Tickets 集成。P1-003 后续按独立授权实施，不能倒推扩大 P1-002 的验收范围。

### G0-OPEN-003 视频分片容量重新验证（当前环境完成）

- 新增 Gate 0 专用串行 `init → chunk → finish → reply` 视频探针与 6 项自动化 Contract Test；每片原始字节不超过 512 KiB，证据不记录媒体、临时标识、URL、AES Key 或 Base64。
- 当前 Windows、锁定 SDK 与真实租户下，精确 10 MiB 测试载荷完成 20/20 串行分片、`finish` 与回调回复 ACK，测试人员确认视频显示且可播放。
- 旧 3.92 MiB 高层并发上传超时保留为历史观察，不再视为硬容量上限；默认 1 MiB 运营上限、单活和 Phase 1 禁止令均不变。

### G0-004 语音与视频单聊接收扩展（完成）

- 在既有媒体捕获器中注册 `message.voice` 与 `message.video`。语音仅记录转写字段存在性与字节数，视频复用内存下载/AES 解密、哈希和 Magic/MIME 证据路径。
- 新增语音转写、视频媒体引用、100 MiB 参数边界和隐私脱敏自动化测试；不记录原始转写、URL、AES Key、文件名或媒体内容。
- 已完成真实租户单聊验证：`message.voice` 的转写字段真实到达且原文未记录；`message.video` 真实到达并在内存中完成下载/AES 解密为 `video/mp4`。URL、AES Key、原始文件名和媒体内容均未留存。

### G0-007 稳定性与断网重连测试（已完成）

- 新增本机 Windows 稳定性探针和脱敏资源/事件记录；4小时30分钟真实租户浸泡正常结束，未观察到断开、重连、SDK 错误或持续内存增长。
- ADR-0008 已将 V1.2 Gate 0 稳定运行退出条件统一为4小时30分钟；手动 Wi-Fi 断网已验证60秒和10分钟以上恢复，进程 kill/restart 已完成。
- 三轮仅匹配当前 WSS 远端/TCP 443 的网络抖动均恢复认证；标准 DNS UDP/TCP 53 受控失败后恢复成功，且恢复后新 SDK 连接认证无错误。所有临时防火墙规则已清理。

### G0-001 WSS 网络路径验证

- 新增无密钥网络诊断脚本与验证记录，正式企业微信 WSS 目标的 DNS、TCP 443、TLS/SNI 与 WebSocket Upgrade 均通过。
- 验证了端口拒绝和 TLS 主机名不匹配的失败诊断；当前系统代理路径未阻断 Upgrade。
- Gate 0 进入执行中状态；G0-002 尚未开始，未实现 Pilot Ticket Core 或任何 Hospital Tickets 集成。

### G0-002 SDK 认证与连接生命周期 PoC

- 锁定 `@wecom/aibot-node-sdk@1.0.6` 与 npm 完整性哈希，新增最小认证生命周期 PoC、无泄露结构化日志和自动化测试。
- 正确 Secret、错误 Secret、心跳启动和主动断开均已在真实企业微信连接验证；错误凭据归一为 `WECOM_AUTH_FAILED`。
- 以当前本机 Windows 操作系统为部署与验证边界，SIGTERM 通过同一 Node 处理器模拟验证；不使用 WSL。G0-002 已完成。

### G0-003 文本能力矩阵（已完成）

- 新增仅记录字段形态和哈希化标识的文本 Frame 捕获器；不写入原始文本、用户/群/消息 ID、响应 URL 或 Secret。
- 单聊和群内 @ 文本已实测送达；群内未 @ 文本在 5 分钟观察窗口内未投递。不同于既有样例的第二账号已完成群内 @ 交叉测试，群内引用回复已捕获到真实 `quote` 结构；同一测试文本连续发送两次后，收到两条具有不同哈希化 `msgid` 的单聊 Frame。

### G0-004 媒体下载解密 PoC（完成）

- 新增仅在内存下载媒体的脱敏捕获器，支持 `message.image`、`message.mixed` 和 `message.file`，以及 PNG/JPG Magic/MIME、SHA-256、大小和文件名哈希/扩展名记录。
- 新增下载超时、错误 AES Key 和参数/输出目录保护；URL、AES Key、原始媒体、原始文件名和 SDK 原始错误文本均不进入证据或控制台。
- 已完成真实图片、群内 @ 图文混排、文件、错误 AES Key 和下载超时实测；发送端大图片在通道交付后被压缩至 `448672` 字节，形成当前平台的压缩行为结论。

### G0-005 主动推送与提醒效果验证（完成）

- 已验证 `aibot_send_msg` 向 `userid` 和 `chatid` 主动投递、重复发送、离线用户重新登录后的显示与通知、成员退群后的群目标行为，以及无效目标拒绝。
- 当前智能机器人长连接不支持已验证的群 @ 路径：Markdown 标记被作为普通文本显示，`text.mentioned_list` 被平台拒绝；后续业务不得将群 @ 提醒当作可靠通知能力。
- 已完成顺序探针：第一条不带 @ 的 Markdown 获平台确认；第二条只含 `<@from.userid>` 的纯文本被 `provider_errcode=40008` 拒绝，测试人员确认客户端未显示第二条、没有原生 @ 标识或 @ 提醒。三种已测群 @ 路径均不可作为可靠通知能力。

### G0-006 模板卡片按钮与更新时限验证（完成）

- 新增本机 Windows 模板卡片探针：仅在内存中保留 `task_id`，使用 `event.template_card_event` 回调更新同一 `task_id` 的卡片；实测真实事件数据位于 `body.event.template_card_event`。
- 确认/仍未恢复按钮与重复点击均已真实通过；5 秒内更新成功，事件后 `6009` ms 的延迟更新被平台拒绝，形成明确降级结论。
- 初始卡片更新因无有效 `card_action` 返回 `42045`；使用显式 HTTPS `card_action` 后恢复正常。验证 URL 仅为企业微信公开主页，不指向业务系统。
- 补充验证群消息回调绑定的被动回复 @：`aibot_respond_msg` 普通 `text` 被 `provider_errcode=40008` 拒绝；结束 `stream` 获 `provider_errcode=0`，但客户端只显示 `<@userid>` 字面量，没有原生高亮/可点击 @ 或 @ 提醒，只有普通新消息提示。该能力不可作为可靠群提醒机制。

## [1.2.0] - 2026-08-21

### Architecture Baseline Cleanup

- 冻结唯一阶段模型：`G0 → Phase 1 公网试点 → Phase 2 AI增强 → Phase 3 医院融合`。
- Phase 1 工单事实源改为独立 Pilot Ticket Core，不依赖医院内网 Tickets。
- Phase 3 通过 Ticket Adapter 映射、迁移并切换至 Hospital Tickets。
- ADR-0002 原“Phase 1 直接复用现有 Tickets”决策标记为 Superseded。
- 旧 G0–P6 计划和任务编号撤销执行资格，重建 V1.2 路线图与 Backlog。
- 新增 `docs/architecture_baseline_status.md` 作为架构状态入口。

### Constraints

- 本次仅整理架构文档、计划、任务和配置说明；未修改应用实现，未进入 G0-001。

## [1.0.0] - 2026-08-20

### Added

- 将原始方案整理为 Agent 可执行的 PRD 开发规格包。
- 增加 `AGENTS.md`、分阶段路线图、任务明细和机器可读 Backlog。
- 增加 Service Intake、Incident、Reporter Subscription 领域模型。
- 增加企业微信 WebSocket Gate 0 能力验证计划。
- 增加消息识别、字段抽取、工单转换和公共故障关联详细规则。
- 增加 OpenAPI、JSON Schema、数据库草案、配置示例和验收场景。
- 增加安全合规、数据生命周期、可观测性和故障演练要求。

### Changed（已被 V1.2 部分取代）

- WebSocket 长连接作为主接入方案，公网 HTTP 回调仅作为备选。
- AI 从建单前置环节调整为异步增强。
- “5 分钟同类别并单”调整为 Incident 候选关联。
- 群内全量状态广播调整为“群内公共信息 + 单聊个人进度”。
- 原计划在首期复用医院现有 Tickets、Hub、SSO、API 平台和 Outbox；该首期拓扑已被 V1.2 的 Pilot Ticket Core 方案取代。Hospital Tickets 延后至 Phase 3 融合。

### Source Preservation

- 原始文档保留在 `source/企业微信智能机器人方案.docx`。
