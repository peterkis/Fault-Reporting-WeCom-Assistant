# Changelog

## [Unreleased]

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
