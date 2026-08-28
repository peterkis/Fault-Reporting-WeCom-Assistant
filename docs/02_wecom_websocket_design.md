
# 企业微信WebSocket设计

> V1.2：本设计用于 Gate 0 与 Phase 1 公网试点。Gateway 下游是 Channel Message、Service Intake 和 Pilot Ticket Core，不连接 Hospital Tickets。

## Gateway职责

- Bot认证
- 长连接维护
- 心跳
- 重连
- 消息接收
- 图片文件处理
- 主动推送
- 受控临时素材上传与回调/主动媒体投递

## 不负责

- 工单逻辑
- AI判断
- 数据分析
- 将企业微信临时 `media_id` 持久化为业务附件事实或静默转码媒体

## 验收

- 4小时30分钟稳定连接（ADR-0008）
- 文本消息正常
- 图片消息正常
- 主动推送正常
- 重连恢复正常

## 出站媒体约束

语音、视频、图片和文件的出站路径统一为 `init → chunk × N → finish → media_id → reply/send`。`upload_id` 仅 30 分钟有效、`media_id` 仅 3 天有效；两者只能作为 Adapter 的受控临时租约，不能进入工单领域模型。

类型、格式、大小、分片、恢复、速率、隐私、当前视频容量边界和主动媒体待验证状态以 `docs/18_wecom_temporary_media_constraints.md` 为准。Gateway 只负责通道转换；业务层只发出经授权的媒体投递意图。
