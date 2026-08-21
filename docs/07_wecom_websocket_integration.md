# 07. 企业微信 WebSocket 接入规范

阶段边界：Gate 0 和 Phase 1 运行在公网试点环境，Gateway 的业务下游是 Channel Message、Service Intake 和 Pilot Ticket Core；Phase 1 不连接 Hospital Tickets。

## 1. 前提

用户已在企业微信创建智能机器人并完成 API 配置和权限授权，计划采用 WebSocket 长连接。

官方 Node.js SDK 基线：

```text
@wecom/aibot-node-sdk
https://github.com/WecomTeam/aibot-node-sdk
```

官方 README 描述了 WebSocket、自动认证、心跳、重连、消息事件、主动推送、模板卡片和文件下载解密等能力。实际租户行为必须通过 Gate 0 验证。

## 2. Gate 0 能力矩阵

| 编号 | 验证项 | 预期输出 |
|---|---|---|
| W01 | DNS、TCP443、TLS、WSS Upgrade | 网络报告 |
| W02 | Bot ID/Secret 认证 | authenticated 事件 |
| W03 | 单聊文本 | 完整 frame 样例 |
| W04 | 群内 @ 文本 | 是否收到、chatid/userid/msgid |
| W05 | 群内不 @ 文本 | 明确是否收到 |
| W06 | 单聊图片 | URL、aeskey、下载解密 |
| W07 | 群内 @ 图片/mixed | 实际消息类型 |
| W08 | 主动发给 userid | 显示和通知效果 |
| W09 | 主动发给 chatid | 显示和提醒效果 |
| W10 | 模板卡片按钮 | 事件和 5 秒更新 |
| W11 | 断网、恢复、重连 | 恢复时间和消息行为 |
| W12 | 24小时稳定运行 | 重连次数、心跳、内存 |
| W13 | 多实例同时连接 | 生产单活策略依据 |
| W14 | H5 跳转 | 企业微信移动端网络可达 |

## 3. 连接生命周期

建议内部状态：

```text
DISCONNECTED
CONNECTING
CONNECTED
AUTHENTICATING
AUTHENTICATED
DEGRADED
RECONNECTING
STOPPING
```

### 3.1 启动

1. 校验环境变量；
2. 获取单活租约；
3. 初始化 SDK；
4. 注册所有事件处理器；
5. connect；
6. 等待 authenticated；
7. readiness 变为 true。

### 3.2 断开

- 标记 readiness=false；
- 记录原因；
- SDK 自动或应用层重连；
- 连接超过阈值未恢复则告警；
- Outbox 保留待发。

### 3.3 优雅退出

1. 停止接收新内部发送任务；
2. 等待进行中的数据库事务；
3. 释放单活租约；
4. disconnect；
5. 退出进程。

## 4. 单活策略

Gate 0 前：

- 一个 Bot 一个活动 Gateway；
- 不使用 PM2 cluster；
- 备用实例不建立连接；
- 使用 PostgreSQL advisory lock、Redis lease 或人工主备。

多活必须经过官方能力和实际租户验证后另行 ADR。

## 5. 事件映射

| SDK事件 | 内部事件 |
|---|---|
| `message.text` | `wecom.message.received` |
| `message.image` | `wecom.message.received` |
| `message.mixed` | `wecom.message.received` |
| `message.voice` | `wecom.message.received` |
| `message.file` | `wecom.message.received` |
| `event.enter_chat` | `wecom.chat.entered` |
| `event.template_card_event` | `wecom.card.action` |
| authenticated | `wecom.authenticated` |
| close/error | `wecom.connection.degraded` |

具体事件名以锁定 SDK 版本为准，由 Adapter 隔离。

## 6. 消息回调处理预算

SDK 回调处理器只允许执行：

1. 基础字段校验；
2. 生成 trace_id；
3. 调用 Pilot Intake API；
4. 在事务成功后回复；
5. 将媒体下载或 AI 任务异步化。

不得在回调中同步执行：

- OCR；
- LLM；
- 大文件扫描；
- 复杂相似性检索；
- 月报计算。

## 7. 被动回复与主动推送

### 被动回复

用于：

- 首次工单号；
- 输入校验错误；
- 即时卡片响应。

### 主动推送

用于：

- 接单；
- 开始处理；
- 待补充；
- 解决确认；
- Incident 进展。

所有主动推送来源于 Pilot Outbox，而不是 Ticket 控制器直接调用 SDK。Phase 3 的通知所有权必须通过切换计划明确。

## 8. 卡片按钮

每张卡片包含：

```text
task_id
ticket_id/incident_id 的不可猜测映射
expected_version
action_key
expires_at
```

按钮事件处理：

1. 验证 task_id；
2. 验证点击用户；
3. 验证过期时间；
4. 验证 expected_version；
5. 执行业务 Action；
6. 在平台时限内更新卡片；
7. 记录审计。

## 9. 媒体下载和解密

流程：

```text
接收媒体引用
→ 限制 URL 域和协议
→ 下载到内存或临时受控目录
→ AES 解密
→ Magic/MIME 校验
→ 大小限制
→ 病毒/恶意文件扫描
→ SHA256
→ MinIO 私有桶
→ 删除临时文件
```

下载地址和 AES Key 不得写入普通日志。

## 10. 适配器错误码

建议：

```text
WECOM_CONNECT_FAILED
WECOM_AUTH_FAILED
WECOM_NOT_READY
WECOM_SEND_TIMEOUT
WECOM_SEND_REJECTED
WECOM_MEDIA_DOWNLOAD_FAILED
WECOM_MEDIA_DECRYPT_FAILED
WECOM_CARD_EXPIRED
WECOM_INVALID_FRAME
WECOM_DUPLICATE_MESSAGE
```

## 11. 健康指标

```text
wecom_connected
wecom_authenticated
wecom_last_pong_timestamp
wecom_last_message_timestamp
wecom_reconnect_total
wecom_message_received_total{type}
wecom_message_duplicate_total
wecom_send_total{type,status}
wecom_media_download_seconds
wecom_callback_processing_seconds
```

## 12. 关键日志字段

```text
trace_id
provider
msg_id
req_id
chat_type
chat_id_hash
sender_user_id_hash
msg_type
intake_id
ticket_id
outbox_id
sdk_version
connection_generation
```

禁止输出：

- Bot Secret；
- 原始患者文本；
- aeskey；
- 完整媒体 URL；
- 未脱敏截图 OCR。
