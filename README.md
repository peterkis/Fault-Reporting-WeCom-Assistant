# 医院信息故障智能报修助手 Agent 开发包 V1.2

本仓库的唯一有效架构基线为 V1.2。权威状态见 `docs/architecture_baseline_status.md`。

## 当前阶段

- 当前处于 `P1：企业微信外网试点`；`P1-001` 至 `P1-011` 已完成各自的本机受控、Contract 或 PostgreSQL 集成验收。P1-005 至 P1-011 已形成 Pilot Ticket Core、显式状态 Action/事件、Pilot Outbox/Delivery、提交后首次确认、Pilot 本地权限工作台及补充/确认关闭/自动关闭/重开闭环，并建立安全日志、固定指标告警、不可变运维审计和本机加密备份恢复基线。`P1-012` 正在建立真实测试群 E2E、故障演练和 Go/No-Go 接缝：企业微信出站 WSS 只要求 DNS、TCP 443、TLS 与本机 Pilot 运行时，不以公网 IP 为阻塞条件；外发发送器和卡片的既有注入式本地契约仍不是客户端可见或临床试点验收。
- `G0-001` 已完成：正式 WSS 网络路径已验证通过；
- `G0-002` 已完成：本机 Windows 的认证、心跳、错误 Secret、主动断开和 SIGTERM 处理器验证均已通过；
- `G0-003` 已完成：单聊、群内 @、群内未 @、两账号交叉、引用消息与重复发送均已有实测结论；
- `G0-004` 已完成：图片、群内 @ 图文混排、文件、错误 AES Key、真实下载超时和大图片通道压缩行为已取得脱敏实测结论；`message.voice` 与 `message.video` 也均已取得真实单聊 Frame，其中语音仅留存转写元数据，视频已在内存中成功下载/AES 解密；
- `G0-005` 已完成：单聊在线/离线、群 `chatid`、群变更、重复投递和错误目标均已有实测结论；三种已测群 @ 路径均不可用，其中“Markdown 后独立纯文本 `<@userid>`”的第二条被平台拒绝且客户端不可见；
- `G0-006` 已完成：确认/仍未恢复按钮、`task_id`、5 秒内更新和重复点击均已真实通过；超过 5 秒的更新会被平台拒绝。群回调被动纯文本 `<@userid>` 被 `40008` 拒绝，结束流式回复虽获 `provider_errcode=0`，客户端仍只显示字面量文本且无 @ 提醒，因此群内回复 @ 不可作为可靠提醒能力；
- `G0-007` 已完成：ADR-0008 将 Gate 0 稳定运行退出项定为4小时30分钟；本机 Windows 已真实通过稳定浸泡、60秒和10分钟以上断网恢复、进程 kill/restart、三轮 WSS 定向网络抖动与 DNS 失败/恢复。临时网络规则均已清理；
- `G0-006A` 已完成：以企业微信长连接“回复消息”文档为基准补齐欢迎语、流式刷新与反馈、被动 Markdown，以及文件、图片、语音和视频回复验证；真实租户接口回执和客户端显示/打开/播放均已确认。反馈事件后的空包被拒绝；3.92 MiB 高层并发视频超时保留为历史观察，G0-OPEN-003 已以串行分片真实验证 10 MiB 回传与播放，且不改变 1 MiB 运营上限；`G0-005` 主动推送不计入该回复侧覆盖；
- `G0-008` 已完成：项目负责人已确认 Gate 0 验收报告与 ADR-0009，并授权进入 Phase 1；主动媒体显示可见验收和单连接限制均按冻结结论执行；
- 出站语音、视频、图片和文件必须使用企业微信临时素材三步上传并通过 Adapter 的短期媒体租约投递；格式、大小、时效、恢复、隐私、限流及已知容量边界见 `docs/18_wecom_temporary_media_constraints.md`；
- Phase 1 仍不得接入 Hospital Tickets、医院 SSO、医院 Hub 或院内 Outbox。

## Phase 1：企业微信外网试点

```text
Enterprise WeCom
    ↓
WeCom Gateway
    ↓
Channel Message
    ↓
Service Intake
    ↓
Pilot Ticket Core
```

Phase 1 不依赖医院内网系统，不直连医院 Tickets。Pilot Ticket Core 是公网试点期的工单事实源，用于验证临床接受度、可靠受理、处理闭环和通知效果。

## Phase 2：AI 增强

OCR、规则、分类和字段抽取均为异步增强。AI 失败不能影响消息保存、建单或通知，也不得直接操作生产系统。

## Phase 3：医院融合

```text
Pilot Ticket Core
    ↓
Ticket Adapter
    ↓
Hospital Tickets
```

Phase 3 完成映射、迁移、对账和切换后，由 Hospital Tickets 成为唯一长期工单事实源。禁止长期保留 Pilot Ticket 与 Hospital Tickets 两套并行事实源。

## 核心原则

- AI 不是工单入口；
- 消息必须先保存，再确认；
- 明确报修必须可靠受理；
- Channel Message、Service Intake、Ticket、Incident 必须分层；
- 所有消息必须幂等；
- 所有状态变化必须产生事件；
- 所有通知必须经过可靠 Outbox/Delivery 机制；
- 不允许跨阶段提前开发。
