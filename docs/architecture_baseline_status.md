# Architecture Baseline Status

- 基线版本：V1.2
- 生效日期：2026-08-21
- 状态：ACTIVE
- 当前阶段：P1 / IN_PROGRESS
- 当前已完成任务：G0-001（WSS 网络路径验证）、G0-002（SDK 认证与连接生命周期 PoC）、G0-003（群聊与单聊文本能力矩阵）、G0-004（图片、mixed、文件、语音与视频接收 PoC）、G0-005（主动推送与提醒效果验证）、G0-006（模板卡片按钮与更新时限验证）、G0-007（4小时30分钟稳定性、断网、DNS、网络抖动与进程重启验证）、G0-006A（长连接回复消息能力补充验证）、G0-008（能力结论与架构冻结）、P1-001（建立 Pilot 工程骨架与配置校验，本机受控验收）、P1-002（WeCom SDK Adapter 与标准消息契约，本地 Contract 验收）、P1-003（Channel Message Inbox 与数据库幂等，本机 PostgreSQL 集成验收）、P1-004（Service Intake 创建与消息聚合，本机 PostgreSQL 集成验收）、P1-005（Pilot Ticket Core 模型与编号，本机 PostgreSQL 集成验收）、P1-006（Pilot Ticket 状态机、Action 与事件，本机 PostgreSQL 集成验收）、P1-007（Notification Outbox 与 Delivery，本机 PostgreSQL 集成验收）、P1-008（首次确认与可靠回执，本机 PostgreSQL 集成验收）、P1-009（最小处理端与 Pilot 权限，本机 PostgreSQL 集成验收）、P1-010（补充、解决确认、关闭与重开，本机 PostgreSQL 集成验收）
- 当前执行任务：无。Gate 0 已由项目负责人确认关闭，ADR-0009 为 Accepted。P1-001 至 P1-010 已完成各自本机验收；当前没有公网 IP，故均不表述为真实公网或临床试点验收。P1-005 至 P1-010 的外发发送器和卡片回调均为注入式/合成本地契约，未验证真实客户端可见性。当前不创建 Hospital Ticket Adapter、医院系统集成或 AI/OCR；下一任务为 P1-011。
- 已完成前置任务：ARCH-001 Architecture Baseline Cleanup

## 1. 当前唯一有效架构

### Phase 1：企业微信外网试点

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

约束：

- Phase 1 在公网试点环境运行；
- Pilot Ticket Core 是 Phase 1 工单事实源；
- Phase 1 不依赖或直连 Hospital Tickets、医院 SSO、医院 Hub 或院内 Outbox；
- 企业微信 Frame 只属于 Channel 层，不能成为 Ticket 业务模型；
- 企业微信 `upload_id`、`media_id` 只属于 WeCom Adapter 的临时素材租约，不能成为附件、Ticket 或通知的长期事实标识；
- 明确报修先持久化、先受理，AI/OCR 后置；
- Ticket 状态、事件和通知保持事务与审计一致性。

### Phase 2：AI 增强

- 媒体、OCR、规则、AI分类、字段抽取、人工修正和 Incident 候选运行在异步链路；
- AI 失败或关闭时，Phase 1 核心链路继续运行；
- AI 不直接写 Ticket/Incident 状态，不执行生产操作。

### Phase 3：医院融合

```text
Pilot Ticket Core
    ↓
Ticket Adapter
    ↓
Hospital Tickets
```

约束：

- Ticket Adapter 负责契约隔离、幂等、状态/人员/附件映射、迁移和对账；
- 使用 `ticket_external_mapping` 保留 Pilot 与 Hospital Ticket 的可审计关系；
- 切换完成后 Hospital Tickets 成为唯一长期工单事实源；
- Pilot Ticket Core 按批准方案停止正式写入并转为只读或归档；
- 禁止长期双写、双编号、双状态或双通知事实源。

## 2. 已废弃架构

以下内容已废弃，不得作为实现依据：

1. Phase 1 直接调用或复用医院现有 Tickets；
2. Phase 1 依赖医院 SSO、Hub、灵动岛或院内 Outbox；
3. “Hospital Tickets 从项目第一阶段起就是唯一事实源”；
4. 旧路线 `G0 → P1可靠受理 → P2闭环 → P3 OCR → P4 AI → P5 Incident → P6试点`；
5. 旧任务 `P1-007 对接现有Tickets创建接口`；
6. 在 Phase 3 前实现 Ticket Adapter、Hospital Tickets 同步或生产双写；
7. 把 Pilot Ticket Core 建成长期第二套工单系统。

ADR-0002 已标记为 Superseded；当前执行 ADR 为 ADR-0007。

## 3. Gate 0 完成与当前 Phase

Gate 0 已完成；当前为 `P1：企业微信外网试点`。P1-001 已完成本机受控验收，P1-002 已完成本地 Contract 验收，P1-003 至 P1-010 已完成本机 PostgreSQL 集成验收：

- ARCH-001 已完成，但不改变产品阶段；
- G0-001 已完成，正式 WSS 网络路径已验证通过；
- G0-002 已完成，本机 Windows 的认证、心跳、错误 Secret、主动断开和 SIGTERM 处理器均已验证；
- G0-003 已完成；已取得单聊、群内 @ 与群内引用的真实 Frame 样例，确认当前测试群的未 @ 文本不投递，完成两账号交叉测试，并确认连续重复发送会产生两个不同 `msgid` 的单聊 Frame；
- G0-004 已完成；已取得图片、群内 @ 图文混排、文件、错误 AES Key、真实下载超时和大图片通道压缩行为的脱敏结论。`message.voice` 于单聊真实到达，语音只记录转写存在性与长度；`message.video` 于单聊真实到达并在内存中成功下载/AES 解密。原始转写、URL、AES Key 与媒体不落盘，也不实现任何 Phase 1 业务；
- G0-005 已完成；已取得在线/离线单聊、群 `chatid`、成员退群后的群目标、重复推送和错误目标结论。当前智能机器人长连接的三种已测群 @ 路径均不可用；其中 Markdown 后独立纯文本 `<@userid>` 被平台拒绝，客户端也未收到第二条消息；
- G0-006 已完成；确认与仍未恢复按钮均已在 5 秒内真实更新，重复点击可被识别。真实回调使用 `body.event.template_card_event` 嵌套字段；超过 5 秒的更新被平台拒绝，必须按不可依赖卡片更新处理。补充群内被动回复 @ 复测中，普通 `text` 被 `40008` 拒绝；结束 `stream` 虽获平台确认，客户端仍只显示 `<@userid>` 字面量且无 @ 提醒，因此该能力不可作为可靠通知路径；
- G0-007 已完成；4小时30分钟稳定运行、60秒及10分钟以上手动 Wi-Fi 断网恢复、进程 kill/restart、三轮 WSS 定向网络抖动，以及标准 DNS 失败/恢复均已有本机 Windows 脱敏证据。临时防火墙规则全部清理，DNS 配置恢复并核验；
- 官方已确认每个智能机器人同一时间只支持一个有效长连接；新连接完成订阅会踢掉旧连接，旧连接由服务端主动断开。未来高可用只能采用顺序主备切换，禁止并发订阅；
- G0-006A 已完成；官方长连接“回复消息”文档中的欢迎语、流式刷新与反馈、Markdown 和四类媒体被动回复均以独立脱敏场景取得真实租户和客户端结论。`sendMessage` 主动推送不作为回调绑定回复覆盖；已通过的模板卡片发送/更新仍引用 G0-006 证据。反馈事件后空包被拒绝；3.92 MiB 高层并发视频超时保留为历史观察，G0-OPEN-003 已以串行分片真实验证 10 MiB 回传与播放，默认运营上限仍为 1 MiB；
- 出站临时素材路径、时效、限流、格式/大小、恢复、隐私和投递分流统一见 `docs/18_wecom_temporary_media_constraints.md`；项目负责人已确认主动媒体投递的客户端显示可见验收，但未将其扩大为类型逐项播放、容量、超时、重试或限流结论；
- G0-008 已由项目负责人确认完成，ADR-0009 已接受；Gate 0 结论与开放约束仍是 Phase 1 的强制输入；
- P1-001 仅建立 Pilot 工程骨架、配置校验、独立空数据库和依赖边界；本机受控验收已通过，但这不替代公网试点验收。
- P1-002 仅实现锁定 SDK Frame 到 Normalized Message 的纯转换、opaque 媒体引用、确定性幂等键和稳定错误；本地 Contract 验收已通过，但未启动真实长连接。
- P1-003 仅实现 `channel.message_inbox`、数据库唯一幂等、首次处理事务与原结果快照；本机 PostgreSQL 集成验收已通过。
- P1-004 在 P1-003 事务接缝上实现独立 `Service Intake`、消息关系、90 秒聚合与 Intake 审计事件；本机 PostgreSQL 集成验收已通过。
- P1-005 至 P1-010 在其后新增 Pilot Ticket 的 Intake 一对一关系和编号、Action 状态机与事件、同事务 Pilot Outbox/Delivery、提交后的首次确认编排、Pilot-local 角色/处理组与最小工作台、以及补充/卡片回执/关闭/自动关闭/重开闭环。它们不调用 Hospital Tickets、医院 SSO、医院 Hub 或院内 Outbox；注入式 sender 和合成卡片任务不证明真实企业微信客户端显示、点击或临床试点就绪。

## 4. 后续迁移路径

1. G0 验证真实企业微信能力并冻结 SDK/连接策略；
2. Phase 1 在公网构建 Pilot Ticket Core，完成无AI可靠闭环和试点评审；
3. Phase 2 在 Pilot Core 之上异步增加 AI/OCR、Incident 和指标；
4. Phase 3 盘点 Hospital Tickets 真实契约并冻结映射 ADR；
5. 实现 Ticket Adapter 与 `ticket_external_mapping`；
6. 执行幂等迁移、状态/附件/通知对账和回滚演练；
7. 正式切换 Hospital Tickets 为唯一长期事实源；
8. Pilot Ticket Core 停止正式写入并按批准方案只读或归档。

## 5. 文档权威顺序

发生冲突时按以下顺序处理：

1. `AGENTS.md` 的绝对规则；
2. 本文件的架构状态；
3. Accepted 且未被取代的 ADR；
4. `plans/current_phase.json` 与 `plans/roadmap.md`；
5. 其他详细文档、Contract、Schema、示例和历史来源。

发现下层资料冲突时，必须先修正文档或提出 ADR，不得自行选择旧架构实现。

## 6. 历史与废弃文件处理

- `source/` 保留原始来源，只用于追溯，不是执行基线；
- ADR-0002 保留但明确标记 Superseded；
- 旧 P1–P6 计划和任务文件已删除，由 P1/P2/P3 新文件替代；
- V1.0 静态哈希清单已废弃，发布时应基于最终 Git 提交重新生成校验清单；
- `database/schema_draft.sql` 属于旧架构草案，未被实施；P1-005 至 P1-010 使用独立、可重复执行的增量迁移，后续任务不得复用旧草案整库建表。
