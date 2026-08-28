# G0-006A 长连接回复消息能力补充验证矩阵

- 执行环境：本机 Windows；不使用 WSL。
- 锁定 SDK：`@wecom/aibot-node-sdk@1.0.6`。
- 官方依据：[回复消息（101836）](https://developer.work.weixin.qq.com/document/path/101836)，最后核对于 2026-08-28；反馈事件和媒体上传分别交叉核对[接收事件（101835）](https://developer.work.weixin.qq.com/document/path/101835)与[上传临时素材（101838）](https://developer.work.weixin.qq.com/document/path/101838)。
- 边界：只验证企业微信长连接接口与客户端显示；不创建工单、不接入 Pilot Ticket Core 或医院系统。`sendMessage` / `aibot_send_msg` 属于 G0-005 主动推送，不计入本矩阵的回调绑定回复覆盖。
- 隐私：证据只记录哈希、字段名、字节数、媒体类型、安全错误码和客户端布尔结论；不记录消息正文、用户/群/回调/反馈/媒体标识、URL、AES Key、媒体或 SDK 原始错误文本。

## 差异审计与场景登记

| 官方命令/消息类型 | 锁定 SDK 接口 | 本项目审计前状态 | G0-006A 场景 | 当前状态 |
| --- | --- | --- | --- | --- |
| `aibot_respond_welcome_msg` / `text` | `replyWelcome(frame, body)` | 已注册并取得 `enter_chat` 后回执 | `welcome_text`：当天首次进入单聊后 5 秒内回复文本 | 已验证（0 ms；客户端显示已确认） |
| `aibot_respond_welcome_msg` / `template_card` | `replyWelcome(frame, body)` | 已注册并取得 `enter_chat` 后回执 | `welcome_template_card`：另一测试账号或另一自然日首次进入后回复 `text_notice` 卡片 | 已验证（1 ms；客户端显示已确认） |
| `aibot_respond_msg` / `stream` | `replyStream(frame, id, content, finish, msgItem, feedback)` | 已有一条群内结束态 ACK；未验证首段、刷新、终止同一生命周期 | `stream_refresh_feedback`：同一帧/同一流 ID 发首段、刷新、结束，并验证反馈事件只回复空包 | 通过（真实租户） |
| `aibot_respond_msg` / `template_card` | `replyTemplateCard(frame, card, feedback)` | 已由 G0-006 真实验证 | 继承 G0-006 的单聊卡片发送、按钮事件和更新证据 | 已验证（继承） |
| `aibot_respond_msg` / `markdown` | 通用 `reply(frame, body)` | 已注册并取得单聊接口回执；G0-005 Markdown 是主动推送 | `markdown`：单聊文本回调后发送 Markdown | 已验证（客户端格式已确认） |
| `aibot_respond_msg` / `file` | `uploadMedia` + `replyMedia` | 已注册并取得上传/被动回复回执；Webhook 文件验证不能替代 | `file`：内存上传安全文本夹具后回复文件 | 已验证（客户端可见、可打开已确认） |
| `aibot_respond_msg` / `image` | `uploadMedia` + `replyMedia` | 已注册并取得上传/被动回复回执；Webhook 图片验证不能替代 | `image`：内存上传 64×64 PNG 后回复图片 | 已验证（客户端显示已确认） |
| `aibot_respond_msg` / `voice` | `uploadMedia` + `replyMedia` | 已注册并取得上传/被动回复回执；接收端转写和 Webhook 语音验证不能替代 | `voice`：内存上传结构化 1 秒 AMR-NB 后回复语音 | 已验证（客户端可见、播放已确认） |
| `aibot_respond_msg` / `video` | `uploadMedia` + `replyMedia` | 已注册；G0-004 仅验证接收/下载 | `video_echo`：内存下载无敏感 MP4、重新上传并带短标题/描述回复 | 已验证（1,529,765 字节；客户端显示、标题/描述与播放已确认）。3.92 MiB 高层并发路径超时为历史观察；后续 10 MiB 串行分片复验见 G0-OPEN-003 |
| `aibot_respond_update_msg` | `updateTemplateCard(frame, card, userids?)` | 已由 G0-006 真实验证 | 继承 G0-006 的 5 秒内更新、重复点击与超时降级证据 | 已验证（继承） |
| `feedback.id` 与 `feedback_event` | `replyStream(..., feedback)`、通用 `reply(frame, undefined)` | 未注册 | `stream_refresh_feedback`：匹配反馈 ID，采集脱敏反馈形态，省略 `body` 字段发送空包 | 降级：事件已到达，空包被拒绝 |

101836 没有把普通 `text` 列为“回复普通消息”的消息类型；G0-006 的群回调普通 `text` / `40008` 结果只说明该额外实验当前不可用，不能覆盖或否定本表中 Markdown、流式、卡片和媒体类型。

## 逐项执行方式

每次仅运行一个场景；使用直接 Node 命令，以避免 Windows npm shim 吞掉额外参数。`--timeout-ms` 只控制等待测试人员操作的时间，不延长平台的 5 秒欢迎语或流式 10 分钟限制。

| 场景 | 命令 | 测试人员操作 | 通过证据 |
| --- | --- | --- | --- |
| `welcome_text` | `node --env-file=.env src/g0-006a-reply-capability.mjs --scenario=welcome_text` | 当天首次打开与机器人的单聊；不要先发送文本。 | `welcome_reply` 平台 ACK、调用耗时不超过 5 秒、文本可见。 |
| `welcome_template_card` | `node --env-file=.env src/g0-006a-reply-capability.mjs --scenario=welcome_template_card` | 换用当天未进入过该机器人单聊的测试账号，或次日再操作。 | `welcome_reply` 平台 ACK、调用耗时不超过 5 秒、卡片可见。 |
| `stream_refresh_feedback` | `node --env-file=.env src/g0-006a-reply-capability.mjs --scenario=stream_refresh_feedback` | 单聊发送 `G0-006A-STREAM`；确认内容至少发生一次刷新，结束后点击赞或踩。 | 两轮真实运行均有三条同一 `stream_id_hash` 的 ACK，末条 `finish=true`；均匹配 `feedback_event`。`body:{}` 与省略 `body` 的空包都被拒绝，记录安全错误码 `846605`。 |
| `markdown` | `node --env-file=.env src/g0-006a-reply-capability.mjs --scenario=markdown` | 单聊发送 `G0-006A-MARKDOWN`。 | `markdown_reply` ACK，客户端粗体/标题格式可见。 |
| `file` | `node --env-file=.env src/g0-006a-reply-capability.mjs --scenario=file` | 单聊发送 `G0-006A-FILE`。 | `media_upload` 与 `media_reply` ACK，文件可见并可打开。 |
| `image` | `node --env-file=.env src/g0-006a-reply-capability.mjs --scenario=image` | 单聊发送 `G0-006A-IMAGE`。 | `media_upload` 与 `media_reply` ACK，图片可见。 |
| `voice` | `node --env-file=.env src/g0-006a-reply-capability.mjs --scenario=voice` | 单聊发送 `G0-006A-VOICE`。 | `media_upload` 与 `media_reply` ACK，语音可见并可播放。 |
| `video_echo` | `node --env-file=.env src/g0-006a-reply-capability.mjs --scenario=video_echo` | 基础验证先发送显著小于 3.92 MiB、无敏感内容的 MP4；不要同时发送文字。成功后再按文档上限 10 MiB 分层验证。 | 内存下载/重传、`media_upload` 与 `media_reply` ACK，视频可见、标题/描述显示且可播放。 |

## 判定纪律

- 单场景最多发送三条流式帧或一条媒体/Markdown/欢迎语回复，远低于文档规定的单会话 30 条/分钟、1000 条/小时；不以压测触发限流。
- 普通消息的 24 小时回复窗口与流式 10 分钟结束时限作为运行约束，不保存回调标识来人为制造跨日测试。
- `provider_errcode=0` 只表示接口接受。需要客户端显示、播放或反馈时，由测试人员单独确认；未确认即保留“待客户端确认”。
- 视频、图片、文件、语音素材在内存中生成或处理；上传返回的 `media_id` 有效期、下载 URL/AES Key、原始文件名和内容均不落盘。

## 当前结论

### 已完成：流式刷新与反馈事件

- `2026-08-28T06:37:42Z` 至 `06:37:51Z`：同一流 ID 的初始、刷新、结束三帧均获 `provider_errcode=0`；随后收到匹配反馈 ID 的 `feedback_event`。SDK 发送 `body:{}` 的空包被 `846605` 拒绝。
- `2026-08-28T06:42:35Z` 至 `06:42:46Z`：以省略 `body` 字段的空包形式复测；三帧流式回复和匹配反馈事件再次出现，空包仍被 `846605` 拒绝。
- 因而，当前租户已验证流式刷新、结束和反馈事件投递；但不能把“反馈事件后的空包响应”作为可靠能力。官方错误码页面未检索到 `846605` 的公开释义，后续业务不得依赖该响应。

测试人员已确认流式中间内容发生刷新，以及各场景的客户端显示、文件打开和媒体播放体验。

- `2026-08-28T06:45:44Z`：Markdown 被动回复已获接口 ACK；测试人员已确认标题、粗体等格式化显示。
- `2026-08-28T06:46:13Z`：41 字节安全文本文件的上传和被动回复均获 ACK；测试人员已确认客户端可见、可打开。
- `2026-08-28T06:46:35Z`：264 字节 64×64 PNG 的上传和被动回复均获 ACK；测试人员已确认客户端显示。
- `2026-08-28T06:46:53Z`：656 字节结构化 1 秒 AMR-NB 的上传和被动回复均获 ACK；测试人员已确认客户端可见、可播放。
- `2026-08-28T06:47:42Z`：3,920,958 字节入站 MP4 已在内存下载/AES 解密成功；高层 `uploadMedia` 重传在约 30 秒后以 `WECOM_REPLY_TIMEOUT` 失败，未取得平台错误码。
- `2026-08-28T06:54:50Z`：1,529,765 字节入站 MP4 重新上传成功，随后视频被动回复获 ACK。测试人员已确认客户端可见、标题/描述显示和播放。
- `2026-08-28T09:09:25Z`：G0-OPEN-003 以单独 Gate 0 探针执行串行 `init → 20 × 512 KiB chunk → finish → reply`，精确 10 MiB 测试载荷的所有阶段获 ACK；测试人员确认视频显示且可播放。该实测说明 3.92 MiB 高层并发超时不是当前环境硬容量上限；方法与完整限制见 `evidence/g0-open-003-video-chunk-revalidation.md`。

- `2026-08-28T06:56:24Z`：文本欢迎语在 `enter_chat` 后 0 ms 发起并获 ACK；测试人员已确认客户端显示。
- `2026-08-28T06:57:24Z`：模板卡片欢迎语在 `enter_chat` 后 1 ms 发起并获 ACK；测试人员已确认客户端卡片显示。

所有 101836 列出的回复类型和命令现均已注册并获得真实租户、客户端结论。反馈空包被拒绝仍是明确能力边界；3.92 MiB 视频高层并发超时保留为历史观察，容量结论以 G0-OPEN-003 的单环境 10 MiB 串行复验为准。G0-006A 已完成；其完成时 G0-008 尚未启动。G0-008 此后已完成并获项目负责人授权进入 Phase 1，当前仅执行 P1-001。
