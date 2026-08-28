# ADR-0009：Gate 0 企业微信能力与连接策略冻结

- 状态：Accepted
- 日期：2026-08-28
- 确认：项目负责人于 2026-08-28 明确授权“可以开始进行下一阶段”。
- 关联：ADR-0001、ADR-0006、ADR-0007、ADR-0008；`evidence/g0-008-gate0-acceptance-report.md`

## 背景

G0-001 至 G0-007 和 G0-006A 已完成真实租户/本机 Windows 验证。G0-008 需要把已验证能力、明确负向结论和未验证范围收敛为 Phase 1 的 Adapter 与产品约束，而不是把企业微信 SDK 行为直接当作业务模型或可靠性承诺。

## 决策

1. 继续采用 ADR-0001 的公网出站 WSS 主接入。官方已确认每个智能机器人同一时间只支持一个有效长连接：新连接完成订阅后会踢掉旧连接，旧连接由服务端主动断开。多活 Gateway 明确禁止；未来高可用只能采用顺序主备切换，备用实例不得与主实例同时保持已订阅的有效连接。
2. Gate 0 的基准 SDK 固定为 `@wecom/aibot-node-sdk@1.0.6`，当前 `package.json` 的 Node 约束为 `>=24 <25`。升级 SDK、Node、进程管理方式或网络/TLS 代理策略前，必须先执行关联的 Contract Test 和真实租户复验。
3. Phase 1 的 WeCom Adapter 只把单聊文本、群内 @ 文本及已经验证的媒体/回调类型转换为标准 Channel Message。群内未 @ 文本不作为入口；企业微信 Frame、`req_id`、`upload_id`、`media_id` 均不得成为业务事实标识。
4. 业务受理链路必须自行实现持久化幂等。G0 看到的不同 `msgid` 和未观察到重放都不能被解释为平台保证不会重复投递。
5. 入站媒体继续采用内存下载/AES 解密、Magic/MIME 优先和脱敏审计。出站媒体仅可通过 Adapter 的临时素材三步上传和短期 `WeComMediaLease` 投递；`media_id` 不能写入 Ticket、Channel Message 或普通日志。项目负责人已确认主动媒体投递的客户端显示可见性；该确认不取代类型逐项播放、容量、超时、重试或限流验证。
6. 个人进度的可靠通知优先单聊；群聊只用于低敏感公共信息。当前已验证的群 @ 路径均不可作为提醒机制。后续主动消息必须由 Notification Outbox/Delivery 驱动，而非由业务控制器直接调用 SDK。
7. 模板卡片是可选交互层：其按钮事件须按真实 `body.event.template_card_event` 形态归一化，更新必须在事件后 5 秒内发起；超时或失败时不能阻断业务事实，应有文本或状态查询降级。
8. 回调绑定的欢迎语、流式、Markdown、文件、图片、语音和基础视频回复可作为已验证 Adapter 能力。反馈事件后的空包响应不可依赖。当前环境已有一次 10 MiB 串行分片真实租户回传/播放验收（`evidence/g0-open-003-video-chunk-revalidation.md`），但自动视频回复默认仍不得超过 1 MiB；在项目负责人确认提高容量策略前，不得静默转码、压缩或生成公开链接。
9. G0-007 的恢复结论只覆盖单活 Windows 测试环境。它不构成提供方永久 SLO，也不替代 Phase 1 的持久化、Outbox、幂等、故障演练或业务验收。

## 后果

- Phase 1 在获准启动后可以以受控 WeCom Adapter 为边界实现 Pilot Ticket Core，但仍不得依赖或直连 Hospital Tickets。
- 无法满足上述能力约束的产品设计必须在实现前新增 ADR 或完成独立真实租户验证。
- 超过 1 MiB 的自动视频回复、群 @ 提醒、反馈空包响应和多活均不属于可直接启用的能力；主动媒体仍受 Adapter Contract Test、类型边界和受控投递路径约束。

## 生效条件

项目负责人已确认本 ADR 与 `evidence/g0-008-gate0-acceptance-report.md` 的 Gate 0 结论，并授权进入下一阶段。ADR-0009 自 2026-08-28 起生效：G0-008/G0 可以标记为完成，Phase 1 仅启动其首个任务 P1-001。P1-002 及后续任务仍须遵循各自依赖与验收条件。
