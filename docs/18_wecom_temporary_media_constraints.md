# 18. 企业微信临时素材上传与出站媒体能力约束

- 状态：ACTIVE（V1.2 设计约束；不是 Phase 1 实现授权）
- 适用范围：企业微信智能机器人长连接的 `file`、`image`、`voice`、`video` 出站素材；同时覆盖回调绑定回复和 Outbox 驱动的主动投递。
- 官方依据：企业微信[上传临时素材（101838）](https://developer.work.weixin.qq.com/document/path/101838)、[回复消息（101836）](https://developer.work.weixin.qq.com/document/path/101836)；最后核对：2026-08-28。
- 相关规范：[WebSocket 接入规范](07_wecom_websocket_integration.md)、[安全与合规](11_security_compliance.md)、[可观测性](12_nfr_slo_observability.md)、[测试与验收](13_test_acceptance_plan.md)。

## 1. 架构边界

企业微信的 `upload_id` 和 `media_id` 是通道临时标识，不是业务附件、Ticket、Service Intake 或 Incident 的事实标识。业务层只表达“需要向某个授权会话投递何种受控媒体”；WeCom Adapter 负责把经过验证的字节转换成临时素材并完成投递。

```text
OutboundMediaIntent（业务/Outbox 或当前回调）
        ↓
受控 MediaAsset（类型、字节数、完整性、权限、来源）
        ↓
WeCom Adapter：临时上传会话 → WeComMediaLease
        ↓
回调回复 / 主动投递
        ↓
Delivery 审计结果
```

- `WeComMediaLease` 仅代表当前机器人可在有效期内使用的临时 `media_id`；它必须带 `type`、`created_at`、`expires_at` 和内容哈希，且原始标识仅在必要时加密保存。
- 不得把 `media_id` 写入 Ticket、Channel Message 或通用日志；需要重试时，从受控源重新上传或使用未过期的受控租约。
- Gate 0 只可使用无敏感夹具或在内存处理的测试素材；本文件不授权建设业务附件、对象存储或任何 Phase 1 链路。

## 2. 企业微信上传协议（强制路径）

所有出站媒体必须经由以下三步完成，禁止自行构造 `media_id`、跳过 `finish`，或把 Base64 直接塞入回复/主动消息体：

| 阶段 | 企业微信命令 | 必填要点 | 成功产物 |
| --- | --- | --- | --- |
| 初始化 | `aibot_upload_media_init` | 新的唯一 `headers.req_id`、`type`、安全文件名、`total_size`、`total_chunks`；项目要求提供 MD5 | `upload_id` |
| 分片 | `aibot_upload_media_chunk` | 新的唯一 `headers.req_id`、同一 `upload_id`、从 0 开始的 `chunk_index`、分片原始字节的 Base64 | 每个分片 ACK |
| 完成 | `aibot_upload_media_finish` | 新的唯一 `headers.req_id`、同一 `upload_id` | `type`、`media_id`、`created_at` |

提供方约束如下：

- 每个 `req_id` 不超过 256 字节，且上传命令的 `req_id` 必须与消息回调的 `req_id` 分离；后者只用于回调绑定回复。
- 单个分片在 Base64 编码前不超过 512KB，全部分片不超过 100 个；实现按原始字节切片，而不是按 Base64 字符数切片。
- 分片允许乱序；重复上传同一 `chunk_index` 会被服务端忽略。项目仍以“确认的唯一索引集合完整”作为调用 `finish` 的前提。
- 上传会话从初始化起仅 30 分钟有效；同一机器人重连后可在会话到期前继续未完成分片。不同机器人不得接管该会话。
- `finish` 由服务端校验分片齐全和可选 MD5；项目将 MD5 设为必填完整性保护，即使官方字段为可选。
- 成功得到的 `media_id` 仅 3 天有效；超期必须重新上传，不能将过期标识作为发送失败重试的输入。

## 3. 类型、格式和大小上限

企业微信上限是通道硬上限，Adapter 在任何网络调用之前执行更严格或相同的本地校验；SDK 泛化的分片上限不能放宽下表。

| `type` | 允许格式 | 企业微信总大小上限 | 项目约束 |
| --- | --- | ---: | --- |
| `image` | PNG、JPG/JPEG、GIF | 10MB | 扩展名、Magic Number 和 MIME 必须一致；不得把截图 Base64 写日志。 |
| `voice` | AMR | 2MB | 只接受经过格式检测的 AMR；不可把入站语音转写误作可回传的原始音频。 |
| `video` | MP4 | 10MB | 检查 MP4 容器/MIME；标题最多 64 字节、描述最多 512 字节。 |
| `file` | 企业微信未在该接口页限定格式 | 20MB | 另行实施最小 MIME/恶意文件策略；不因 `file` 无格式枚举而跳过扫描和权限校验。 |

文件名为服务端生成的安全名称，必须小于等于 256 字节，不使用用户原始文件名、路径片段或可识别信息。对任何类型，`total_chunks` 必须按实际原始字节大小计算并预先验证不超过 100。

## 4. 回复侧与主动侧的投递分流

| 业务意图 | 上传完成后的命令 | 绑定规则 | 禁止的替代 |
| --- | --- | --- | --- |
| 当前消息回调的媒体回复 | `aibot_respond_msg`，`file/image/voice/video.media_id` | 透传当前回调 `req_id`；普通消息回复窗口为 24 小时 | 不能把已过期的回调直接改为主动消息。 |
| 可靠主动通知的媒体投递 | `aibot_send_msg` | 仅由已授权的 Notification Outbox/Delivery 驱动；目标和投递幂等由业务侧控制 | 不能从 Ticket 控制器直接调用 SDK。 |
| 欢迎语或卡片更新 | 不承载媒体 | 欢迎语仅使用文本或模板卡片；更新卡片使用事件回调 | 不把 `media_id` 塞入欢迎语或卡片更新协议。 |

本基线默认一个租约只服务一个明确的投递用途。若未来需要在同一机器人、未过期条件下复用租约，必须先以 Adapter Contract Test 和真实租户证据确认，再完成每次投递的权限、速率和幂等判断。被动回复失败不自动升级为主动推送；是否允许后续主动通知由业务规则、用户可见性和 Outbox 决定。

## 5. 状态、重连、重试与限流

```text
VALIDATED
→ UPLOAD_SESSION_OPEN（expires_at ≤ 30 min）
→ CHUNKING
→ FINISHED
→ MEDIA_LEASED（expires_at ≤ created_at + 3 d）
→ DELIVERY_PENDING
→ DELIVERED | FAILED | EXPIRED
```

- 为恢复长连接重连，受控上传会话可临时保存 `upload_id`、已确认分片索引、机器人哈希和 30 分钟到期时间；这些字段不得进入普通日志，完成或到期即删除。
- 单分片仅在未获 ACK 时按有界次数重试；重复分片的服务端幂等性不等于可无限重试。`finish` 未确认时不得先发送媒体消息；其重试语义必须在同一上传会话内通过 Adapter Contract Test 证明后才可自动化。
- 连接中断后优先用同一机器人、同一未过期会话补齐缺失分片；无法恢复则新建会话，从受控源重新开始。不得跨机器人复用 `upload_id` 或 `media_id`。
- 为保守遵守 101838，限流器将 `init`、每个 `chunk` 和 `finish` 都计为单个机器人上传请求，执行 30 次/分钟、1000 次/小时预算；如后续官方或真实租户明确不同计量单位，须重新验证后再放宽。
- 回复/主动投递另受 101836 的单会话 30 条/分钟、1000 条/小时限制。上传配额与消息投递配额必须分别计量。
- 回执不确定时记录 `UNKNOWN`，不得盲目重发造成重复媒体消息；主动投递由 Outbox 保存有界尝试和人工可见的失败状态。
- 媒体类型/大小、`media_id` 过期、限流和回调上下文错误的 `errcode` 必须按 [错误码引用与排障规范](32_wecom_global_error_code_governance.md)记录和处置；程序不得按 `errmsg` 分支，也不得将其写入日志或证据。

## 6. 当前 SDK 与已验证边界

锁定 SDK 为 `@wecom/aibot-node-sdk@1.0.6`。其 `uploadMedia` 实现三步分片上传，`replyMedia` 用于回调绑定媒体回复，`sendMediaMessage` 用于主动媒体投递；业务代码仍只能依赖内部 Adapter 接口。

- 该版本的 WebSocket 回执超时在实现内部字段 `replyAckTimeout` 中固定为 5,000 ms；`WSClientOptions.requestTimeout` 只传给下载用 HTTP 客户端，不会延长上传或媒体投递的 WebSocket 回执时间。不得以设置 `requestTimeout` 作为大媒体上传超时的修复；任何 SDK 升级、封装替换或受控修复都必须重新执行 Contract Test 和真实租户验证。
- G0-006A 已验证文件、图片、语音和视频的回复路径及客户端体验；1,529,765 字节 MP4 已成功回传并播放。
- 高层 `uploadMedia` 的 3,920,958 字节视频样本曾以 `WECOM_REPLY_TIMEOUT` 结束；该路径对 5 至 10 个分片采用 3 路并发。它是当前 SDK 实现方式的历史观察，不是企业微信视频容量的硬上限，也不能凭它定位失败分片。
- G0-OPEN-003 随后以文档化的串行 `init → 20 × 512 KiB chunk → finish → reply` 路径真实回传精确 10 MiB 视频，并获客户端显示/播放确认。探针仅用于 Gate 0 测量，直接协议调用不构成生产 Adapter 实现授权；详见 `evidence/g0-open-003-video-chunk-revalidation.md`。
- ADR-0009 已冻结自动视频回复的默认运营上限为 1MB。一次当前环境 10 MiB 成功样本不是提供方 SLO，也不自动授权提高上限；超过时不得静默压缩、转码或公开链接，应转入明确的用户提示/受控替代流程。提高上限须另行获得项目负责人确认并更新 ADR。
- 项目负责人已于 2026-08-28 确认主动媒体投递的客户端显示可见验收；确认记录见 `evidence/g0-008-project-owner-confirmations.md`。原始租户捕获未入库，故不得把该确认扩大为逐类型打开/播放、容量、超时、重试或限流结论，也不能把回复侧成功作为主动侧的替代证据。

## 7. 安全、隐私和审计

- 上传前完成来源授权、大小/格式/Magic/MIME 校验；对持久化附件仍执行恶意文件扫描、私有存储、服务端鉴权和留存策略。
- `upload_id`、`media_id`、回调 `req_id`、下载 URL、AES Key、原始文件名、原始媒体和 Base64 均不得写入普通日志、指标标签或 G0 证据。
- 只允许记录：媒体类型、字节数、内容哈希、分片数、阶段、耗时、脱敏错误码、过期时间和投递结果。内容哈希属于受控审计元数据，不得用于公开关联。
- 自动压缩、转码、截图提取或 AI 处理是独立处理目的；涉及诊疗或故障证据时必须有明确授权、审计和降级路径，不能为了满足通道大小上限而静默改变证据。

## 8. 必需的测试和观测

实现或升级 Adapter 前，至少覆盖：

1. 四种类型的格式、字节、文件名和 100 分片边界；
2. `init → chunk × N → finish → media_id → reply/send` 的 Contract Test；
3. 缺分片、重复分片、乱序分片、MD5 不匹配、会话过期、`media_id` 过期和不同机器人接管失败；
4. 断线后 30 分钟内同机器人恢复，及无法恢复时受控重新上传；
5. 单机器人上传配额和单会话投递配额的独立限流；
6. 回复与主动投递各自的真实租户可见性/播放验证；
7. 日志、指标、错误对象和证据中无 `media_id`、`upload_id`、URL、AES Key、Base64 或原始内容。

最低指标包括：

```text
wecom_media_upload_total{type,stage,status}
wecom_media_upload_bytes_total{type}
wecom_media_upload_seconds{type,stage}
wecom_media_chunk_retry_total{type}
wecom_media_session_expired_total{type}
wecom_media_lease_expired_total{type}
wecom_media_delivery_total{route,type,status}
wecom_media_rate_limited_total{scope}
```

这些指标不得带 `media_id`、上传会话、用户、会话或文件名标签。
