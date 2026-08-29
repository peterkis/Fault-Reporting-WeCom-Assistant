# 21. P1-002 WeCom SDK Adapter 与标准消息契约

- 状态：DONE（本地 Contract 验收；不构成公网或真实长连接试点验收）
- 范围：只实现企业微信 SDK Frame 到内部 `NormalizedWeComMessage` 的转换、基础校验、敏感媒体引用隔离和稳定错误码；不启动长连接，不持久化 Channel Message，不创建 Service Intake/Ticket，不实现 Outbox、AI/OCR 或 Hospital Tickets 集成。
- 架构依据：ADR-0009、`docs/architecture_baseline_status.md`、Gate 0 脱敏 Frame 证据，以及锁定的 `@wecom/aibot-node-sdk@1.0.6` 类型声明。

## 输入与输出

| 类别 | 内容 |
| --- | --- |
| 输入 | SDK `1.0.6` 的 `aibot_msg_callback` Frame；字段形态由 `evidence/g0-003-frame-captures.jsonl` 和 `evidence/g0-004-media-captures.jsonl` 的脱敏记录确认。 |
| 输出 | `{ ok: true, message }`，其中 `message` 符合 `contracts/normalized_wecom_message.schema.json`。 |
| 失败 | `{ ok: false, error: { code, retryable: false, reason } }`；不回显 Frame、SDK 原始错误、URL、AES Key 或 `response_url`。 |
| 明确不输出 | SDK `cmd/headers/body`、媒体 URL/AES Key、主动回复 URL、Channel Message 数据库结果、Intake/Ticket 或通知结果。 |

公共接口只有一个：

```js
adaptWeComSdkFrame(frame, { receivedAt })
```

调用方和 Contract Test 只通过该接口观察行为。业务模块只接收成功结果中的 `message`，不导入 SDK Frame 类型。

`receivedAt` 省略时由 Adapter 记录当前时间；调用方显式提供时必须能转换为有效 ISO 时间。非法时间不抛出运行时异常，而是返回 `WECOM_INVALID_FRAME / RECEIVED_AT_INVALID`。

## 支持的冻结输入

| SDK `msgtype` | Normalized Message 表达 |
| --- | --- |
| `text` | 一个有序 `text` content item，同时保留 `raw` 并生成 NFKC、空白折叠和小写化后的 `clean`；原文及规范化结果均不得超过 20,000 字符。 |
| `image` | 一个 `media(type=image)` item，只暴露 opaque `download_ref` 和原 Frame 中的位置。 |
| `mixed` | 在同一条消息中按 SDK `msg_item` 原顺序保存 text/image items，不拆成多条业务消息。 |
| `voice` | 一个带 `source=VOICE_TRANSCRIPT` 的 text item；不得冒充用户键入的原始文字。 |
| `file` | 一个 `media(type=file)` item。 |
| `video` | 一个 `media(type=video)` item。 |

引用消息按独立 `quote` 对象归一化；当前 SDK 已声明的 text/image/mixed/voice/file 引用使用相同 content 契约。模板卡片事件不冒充普通消息，仍按 ADR-0009 的独立交互路径处理。

当前 SDK Frame 没有提供可依赖的结构化 mention 列表。Adapter 不从显示文本猜测 userid，也不凭字符串臆测是否形成原生 @；群内未 @ 文本本身不会由当前真实租户投递。`clean` 因而只做确定性文本规范化，不做无依据的 mention 删除。

所有输出字符串必须是结构完整的 Unicode 且不得包含 PostgreSQL `TEXT/JSONB` 无法存储的 NUL。该约束同时写入 Normalized Message Schema 的文本模式；Adapter 在形成标准消息前失败关闭，不把确定性输入问题推迟成 P1-003 的可重试存储故障。

## 时间、身份与重复边界

- `provider` 固定为 `WECOM_AIBOT`；`idempotency_key` 固定为 `WECOM_AIBOT:{msg_id}`。
- `req_id` 仅用于通道关联，不是业务事实标识，也不得替代 `provider + msg_id`。
- Gate 0 真实 Frame 未提供 `create_time`，因此契约允许它为 `null`；Adapter 自己记录必填的 `received_at`，两者不得混为同一事实。
- 相同 `msg_id` 的重放仍被转换并得到同一个幂等键；Adapter 不在内存中抢先丢弃，也不宣称“平台不会重放”。P1-003 才负责数据库唯一约束、并发重复、进程重启和返回原业务结果。

## 媒体引用与隐私

`download_ref` 是由 provider、`msg_id`、正文/引用位置、媒体类型和位置索引生成的稳定 opaque 引用。它只指向受保护原始回调上下文中的媒体位置，不是 `media_id`、附件事实、下载凭据或长期租约。

- Normalized Message 中没有 URL、AES Key、`response_url`、原始文件名或媒体字节；
- `source_index` 保留 mixed/quote 中的原始顺序，供后续 Channel 层在受控原始上下文中解析；
- P1-002 不下载、不落盘、不持久化媒体；后续任务仍须遵守内存下载、Magic/MIME、加密保存和留存规则。

## 稳定错误

| `code` | `retryable` | 适用情况 |
| --- | --- | --- |
| `WECOM_INVALID_FRAME` | `false` | Frame 包络、身份、会话、时间或对应消息内容不完整/非法。 |
| `WECOM_UNSUPPORTED_MESSAGE_TYPE` | `false` | 输入不是本任务冻结支持的普通消息类型，例如把事件 Frame 当作消息。 |

`reason` 提供稳定、无敏感值的细分原因，例如 `MESSAGE_ID_REQUIRED`、`MEDIA_REFERENCE_INVALID`、`MIXED_ITEM_INVALID`、`QUOTE_INVALID` 和 `RECEIVED_AT_INVALID`。提供方原文不进入结果。非普通消息类型在检查普通消息专属的会话字段前分流为 `WECOM_UNSUPPORTED_MESSAGE_TYPE`。

P1-002 只有确定性幂等键，不拥有可靠重复事实。后续 P1-003 已用数据库唯一约束完成持久化判定，并以成功结果中的 `duplicate` 标志和首个结果快照表达重放；它没有把重复投递误报成 Adapter 错误。

## 本地验收

```powershell
npm run test:p1:002
node --test tests/*.test.mjs
```

Contract Test 覆盖文本、图片、mixed、有序内容、重复 Frame、非法 Frame、非法接收时间、NFKC 扩展上限、数据库不兼容字符、非消息事件分类、唯一公开导出、机器可读 Schema、引用，以及 Gate 0 已验证的文件/语音/视频形态。验收只证明本地纯转换契约和回归，不证明公网边界、真实 WSS 运行、数据库幂等、临床使用或 Phase 1 Go/No-Go。
