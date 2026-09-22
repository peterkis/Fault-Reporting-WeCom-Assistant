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
| W12 | 4小时30分钟稳定运行 | 重连次数、心跳、内存 |
| W13 | 多实例同时连接 | 生产单活策略依据 |
| W14 | H5 跳转 | 企业微信移动端网络可达 |

### 补充：代开发应用 HTTP 能力矩阵（不计入 W01-W14）

G0-005 原有矩阵验证的是智能机器人 WebSocket `aibot_send_msg`。代开发应用的应用消息接口走独立 HTTPS 路径，不能把两者的 ACK、目标 ID 或客户端结论互相替代。

| 编号 | 验证项 | 预期输出 |
|---|---|---|
| H01 | 服务商授权企业 Token | `service/get_corp_token` 的 `access_token` 与 `expires_in`；需 `suite_access_token`、`auth_corpid`、`permanent_code` |
| H02 | Bot userid 命名空间转换 | `batch/userid_to_openuserid` 的一对一转换；无效成员必须明确拒绝 |
| H03 | HTTP 模板卡片 Provider ACK | `message/send`、`msgtype=template_card`、`card_type=text_notice`，保留数值 `errcode`、结果类别和脱敏目标摘要 |
| H04 | HTTP 成员读取 | `user/get` 返回 `userid`、`name`、`department`、`gender`、`mobile`、`avatar` 的字段可用性；空字段按授权结果解释 |
| H05 | 客户端展示与通知 | 独立人工观察；Provider `errcode=0` 不得替代客户端证据 |

当前 H03 已取得 Provider ACK；H05 尚未人工确认。H01 的正式服务商永久授权码链路当前未运行；本机 `.env.pilot` 的现有应用令牌路径不能代替 H01。

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
| `message.video` | `wecom.message.received` |
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

媒体被动回复必须先经临时素材上传得到同一机器人、未过期的 `media_id`，再使用当前消息回调的 `req_id` 发送 `aibot_respond_msg`。不得把超出回调窗口的失败直接改造成主动消息。

### 主动推送

用于：

- 接单；
- 开始处理；
- 待补充；
- 解决确认；
- Incident 进展。

所有主动推送来源于 Pilot Outbox，而不是 Ticket 控制器直接调用 SDK。Phase 3 的通知所有权必须通过切换计划明确。

主动媒体投递同样先上传临时素材，再由 Outbox 的 Delivery 调用 `aibot_send_msg`；回调 `req_id` 不参与该路径。

### 7.1 代开发应用 HTTP 模板卡片主动推送

该路径用于服务商代开发应用通过授权企业 access_token 调用企业应用消息接口；它不使用 Bot WebSocket 的 `sendMessage(chatid, body)`、回调 `req_id` 或 `aibot_send_msg`。

官方方法：

```text
POST https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=ACCESS_TOKEN
```

请求的最小固定形状：

```json
{
  "touser": "OPEN_USERID",
  "msgtype": "template_card",
  "agentid": 123,
  "template_card": {
    "card_type": "text_notice",
    "main_title": { "title": "标题", "desc": "辅助说明" },
    "sub_title_text": "通知正文",
    "card_action": { "type": 1, "url": "https://work.weixin.qq.com" },
    "task_id": "unique-task-id"
  },
  "enable_duplicate_check": 1,
  "duplicate_check_interval": 1800
}
```

接口使用规则：

- 正式服务商 Token 由 `service/get_corp_token` 根据 `suite_access_token`、`auth_corpid` 和 `permanent_code` 获取；Token 只在服务端缓存，不进入前端、日志或 Evidence。
- 当前应用凭据路径可使用 `GET /cgi-bin/gettoken?corpid=CORP_ID&corpsecret=APP_SECRET`，但只有在凭据确实属于该企业应用时才成立；它不能替代正式代开发应用的永久授权码链路。
- Bot 明文 userid 先经 `batch/userid_to_openuserid` 转换，再作为 `OPEN_USERID` 使用；禁止直接混用 Bot 与应用命名空间。
- `text_notice` 必须有合法 `card_action`；URL 只允许批准的 HTTPS host，不能携带 Secret、Token、userid、OAuth code 或状态凭据。
- `enable_duplicate_check=1` 只能作为提供方重复消息保护；业务仍必须经过 Communication/Outbox/Delivery 的幂等、UNKNOWN 对账和客户端可见性门禁。
- 官方发送限制需按应用账号上限、单成员 30 次/分钟和 1000 次/小时控制；`errcode=0` 只表示请求被接受，不表示客户端已显示或通知。
- `invaliduser`、`unlicenseduser`、全目标无效和敏感字段未返回均按权限/范围结果处理，不得盲目重试或把空字段解释为真实个人资料缺失。

本次脱敏验证摘要见 [`evidence/g0-005-http-template-card-20260922.md`](../evidence/g0-005-http-template-card-20260922.md)；它只记录当前 Provider ACK 和字段可用性，不构成正式服务商 Token 链、客户端展示或 P2-G2-LIVE 批准。

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

### 9.1 临时素材上传和出站投递

企业微信出站媒体严格遵循 `aibot_upload_media_init → aibot_upload_media_chunk × N → aibot_upload_media_finish → media_id → aibot_respond_msg/aibot_send_msg`。上传会话 30 分钟有效，临时素材 3 天有效，分片上限为 Base64 前 512KB 和 100 个分片。`upload_id`、`media_id` 与上传命令 `req_id` 均属于通道敏感元数据。

类型/大小、同机器人重连恢复、MD5、配额、视频容量边界、重试纪律和安全记录规则由 `docs/18_wecom_temporary_media_constraints.md` 定义；该文档优先于 SDK 的泛化分片能力。业务领域只可传递受控媒体意图，不能直接操作临时标识。

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
WECOM_MEDIA_UPLOAD_INIT_FAILED
WECOM_MEDIA_UPLOAD_CHUNK_FAILED
WECOM_MEDIA_UPLOAD_FINISH_FAILED
WECOM_MEDIA_UPLOAD_SESSION_EXPIRED
WECOM_MEDIA_LEASE_EXPIRED
WECOM_MEDIA_TYPE_INVALID
WECOM_MEDIA_SIZE_EXCEEDED
WECOM_MEDIA_INTEGRITY_FAILED
WECOM_MEDIA_RATE_LIMITED
WECOM_CARD_EXPIRED
WECOM_INVALID_FRAME
WECOM_UNSUPPORTED_MESSAGE_TYPE
WECOM_DUPLICATE_MESSAGE
```

P1-002 的入站转换只返回 `WECOM_INVALID_FRAME` 或 `WECOM_UNSUPPORTED_MESSAGE_TYPE`，并附无敏感值的稳定 `reason`。`WECOM_DUPLICATE_MESSAGE` 由 P1-003 的持久化 Inbox 判定；Adapter 只生成 `WECOM_AIBOT:{msg_id}` 幂等键，不能用进程内记忆替代数据库唯一约束。

`WECOM_*` 是项目稳定分类，不是企业微信 `errcode` 的替代品。调用实际企业微信命令时，必须同时保留数值 `provider_errcode`（如存在）、内部码、操作和 `ACKED`/`REJECTED`/`UNKNOWN` 结果；不得按 `errmsg` 分支或写入 `errmsg`。全局错误码的权威索引、映射与重试规则见 [错误码引用与排障规范](32_wecom_global_error_code_governance.md)。

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
wecom_media_upload_total{type,stage,status}
wecom_media_upload_seconds{type,stage}
wecom_media_delivery_total{route,type,status}
wecom_media_rate_limited_total{scope}
wecom_callback_processing_seconds
```

## 12. 关键日志字段

```text
trace_id
provider
msg_id
req_id_hash
chat_type
chat_id_hash
sender_user_id_hash
msg_type
intake_id
ticket_id
outbox_id
provider_errcode
internal_error_code
delivery_outcome
sdk_version
connection_generation
```

禁止输出：

- Bot Secret；
- 原始患者文本；
- aeskey；
- 完整媒体 URL；
- errmsg、原始 req_id、upload_id 或 media_id；
- 未脱敏截图 OCR。
