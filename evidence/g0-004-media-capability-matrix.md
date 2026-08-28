# G0-004 图片、mixed 与文件下载解密能力矩阵

- 执行环境：当前本机 Windows；不使用 WSL。
- SDK：`@wecom/aibot-node-sdk@1.0.6`。
- 范围：仅验证企业微信媒体 Frame、SDK 下载解密与安全证据形态；不创建 Pilot Ticket、Service Intake 或医院系统连接。
- 留存原则：媒体仅在内存中下载；证据只记录字段名、哈希化标识、文件大小、SHA-256、文件名哈希/扩展名、Magic/MIME 和安全错误码。绝不记录原始文本、URL、AES Key、原始文件名或媒体文件。

## 输入与输出

- 输入：经过本机 G0 配置校验的企业微信媒体 Frame，以及该 Frame 内短时有效的媒体 URL/AES Key。
- 输出：`evidence/g0-004-media-captures.jsonl` 中的一条脱敏记录；控制台只输出事件、类型、计数和稳定错误码。
- 成功：至少一个媒体引用由 SDK 下载并 AES 解密，记录 `byte_size`、`sha256`、文件名哈希/扩展名和 Magic/MIME。
- 失败：只记录 `WECOM_INVALID_FRAME`、`WECOM_MEDIA_DOWNLOAD_FAILED` 或 `WECOM_MEDIA_DECRYPT_FAILED`；不得输出 URL、AES Key 或 SDK 原始错误文本。

## 执行方式

每次只启动一个捕获器。待看到 `capture_ready` 后再发送无敏感测试素材。默认整轮等待 10 分钟、单次下载证据等待 15 秒、大小判定上限 20 MiB；媒体不会落盘。

| 场景 | 捕获命令 | 企业微信操作 | 判定 |
| --- | --- | --- | --- |
| 单聊 PNG/JPG | `npm run g0:004:capture -- --scenario=image_direct` | 第二测试账号在与机器人单聊中发送一张无敏感 PNG 或 JPG | `message.image`、下载解密成功、Magic/MIME、大小和 SHA-256 |
| 群内 @ 图片 | `npm run g0:004:capture -- --scenario=image_group` | 第二测试账号在测试群 @机器人并发送无敏感图片 | 群聊是否投递、`chatid`、下载解密结果 |
| 群内 @ mixed | `npm run g0:004:capture -- --scenario=mixed_group` | 第二测试账号在测试群 @机器人发送图文混排 | `message.mixed`、子项形态、图片引用下载结果 |
| 单聊文件 | `npm run g0:004:capture -- --scenario=file_direct` | 第二测试账号单聊发送无敏感小文件 | `message.file`、下载解密、文件名哈希/扩展名 |
| 大图片传输行为 | `npm run g0:004:capture -- --scenario=image_direct --max-media-bytes=1048576` | 单聊发送大于 1 MiB 的无敏感测试图片 | 记录接收端实际大小、哈希和大小判定；若企业微信压缩导致阈值未命中，明确记录该平台行为 |
| 错误 AES Key | `npm run g0:004:capture -- --scenario=image_direct --aeskey-mode=invalid` | 单聊发送无敏感图片 | `WECOM_MEDIA_DECRYPT_FAILED`，无 URL/AES Key 泄漏 |
| 下载超时 | `npm run g0:004:capture -- --scenario=image_direct --download-timeout-ms=100` | 单聊发送无敏感图片 | `WECOM_MEDIA_DOWNLOAD_FAILED` 且 `failure_stage=timeout`；网络足够快而未超时时记为未触发，不能伪造结果 |

## 当前结论

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| 本机媒体 PoC 与脱敏保护 | 通过（自动化） | `npm run test:g0:004` 覆盖脱敏、参数边界、解密失败和下载超时归类。 |
| 单聊 PNG/JPG 下载解密 | 通过 | `2026-08-27T00:37:27Z` 收到 `message.image`，`chattype=single`、无 `chatid`。SDK 内存下载/AES 解密成功，大小 `730185` 字节，SHA-256 为 `b6a867bcdac7590f51d814e884e7d02f0af814786eb8de6e2ad62dac8c3baa84`，Magic/MIME 为 `jpeg` / `image/jpeg`；文件名仅记录哈希和 `.png` 扩展名。内容 Magic 与扩展名不一致，后续必须以 Magic/MIME 判断类型。 |
| 群内 @ 图片 | 通过（经 `message.mixed`） | PC 端无法产生单独的“@ + `message.image`”；`2026-08-27T00:47:12Z` 首次捕获到该组合实际触发 `message.mixed`。切换专用捕获器后，`2026-08-27T00:52:03Z` 成功取得群聊 `message.mixed`，`chatid` 存在；故当前客户端的群内 @ 图片应按 mixed 路径处理。 |
| 群内 @ mixed | 通过 | `2026-08-27T00:52:03Z` 的 Frame 有 2 个子项（1 文本、1 图片）；图片成功下载解密，大小 `37676` 字节，SHA-256 为 `dd9c95fc0567a4fcdd12286ef889f44e38a3de8544eee33297bcc5ad991984ba`，Magic/MIME 为 `png` / `image/png`，文件名只记录哈希和 `.png` 扩展名。 |
| 文件下载解密 | 通过 | `2026-08-27T01:01:28Z` 收到单聊 `message.file`，无 `chatid`；SDK 内存下载/AES 解密成功，大小 `11` 字节，SHA-256 为 `993e7955aa7fcfbf550f62ead36ba7165100547c28bb00a0b78dda4025e36c7c`，Magic 为 `unknown` / `application/octet-stream`，文件名只记录哈希和 `.txt` 扩展名。 |
| 大图片传输行为 | 通过（平台压缩行为已明确） | `2026-08-27T01:07:47Z` 收到发送端声明大于 1 MiB 的无敏感单聊图片并成功下载解密；接收端实际大小为 `448672` 字节，SHA-256 为 `b6bc021e3df0f7ac95c868bdd9eb68f2b741fe3a4ecf2729425e22922dd7fe50`，小于 1 MiB 判定阈值，`size_within_limit=true`。当前企业微信通道会在交付前压缩该样本；本次仅形成该平台行为结论，未验证 `size_within_limit=false` 分支。 |
| 错误 AES Key | 通过 | `2026-08-27T01:22:17Z` 收到真实单聊图片 Frame，并在本机内存中仅以无效 Key 替换真实 Key；结果为 `WECOM_MEDIA_DECRYPT_FAILED` / `decrypt`。该条证据及对应控制台日志均未出现 URL 或 AES Key 值。 |
| 下载超时 | 通过 | `2026-08-27T01:24:47Z` 在真实单聊图片 Frame 上以 `--download-timeout-ms=100` 触发；`101` ms 后稳定归类为 `WECOM_MEDIA_DOWNLOAD_FAILED` / `timeout`。该条证据未记录 URL 或 AES Key 值。 |

G0-004 已完成。单聊图片、群内 @ 图文混排、文件、发送端大图片的通道压缩行为、错误 AES Key 和真实下载超时均已取得脱敏实测结论。`size_within_limit=false` 是接收端阈值的未覆盖分支，不阻断本任务；如未来需验证该分支，应使用不会被通道压缩的独立媒体载体并新建任务。G0-005 仍须用户确认后才可开始。

## 2026-08-28 语音与视频单聊接收扩展

- 范围：在同一 G0-004 探针中注册 `message.voice` 和 `message.video`；仅验证智能机器人长连接的接收回调，不创建 Pilot Ticket、Service Intake 或医院系统连接。
- 官方依据：[企业微信智能机器人长连接接收消息](https://developer.work.weixin.qq.com/document/path/101834)。`voice` 仅支持单聊，回调提供转写文本；`video` 仅支持单聊，回调提供短时有效的加密 URL 与唯一 AES Key，文档上限为 100M；探针按 `104857600` 字节配置其本地证据阈值。
- 输入：本机 Windows 上已认证的智能机器人长连接，以及测试账号在与机器人单聊中发送的无敏感语音或视频。
- 输出：语音仅记录转写字段是否存在与 UTF-8 字节数；视频复用内存下载/AES 解密、SHA-256、文件名哈希/扩展名与 Magic/MIME 记录。原始转写、URL、AES Key、文件名与媒体内容均不落盘。

| 场景 | 捕获命令 | 现场操作 | 启动前状态 |
| --- | --- | --- | --- |
| 单聊语音 | `node --env-file=.env src/g0-004-media-capture.mjs --scenario=voice_direct` | 测试账号向机器人发送一条无敏感语音故障反馈 | 探针和自动化测试已就绪；实际结果见后续真实租户验收。 |
| 单聊视频 | `node --env-file=.env src/g0-004-media-capture.mjs --scenario=video_direct --max-media-bytes=104857600` | 测试账号向机器人发送一个不超过企业微信文档 100M 限制的无敏感视频故障反馈 | 探针和自动化测试已就绪；实际结果见后续真实租户验收。 |

### 扩展验收状态

- [x] 本地自动化：`npm run test:g0:004` 通过 5 项测试，覆盖事件注册清单、语音转写脱敏、视频加密下载证据、100 MiB 参数边界与既有失败归类。
- [ ] 真实租户：单聊 `message.voice` 到达，`body.voice.content` 字段形态明确，且证据不含原始转写。
- [ ] 真实租户：单聊 `message.video` 到达，`body.video.url/aeskey` 形态、内存下载/AES 解密和安全失败路径明确。

因此，原有图片/mixed/文件范围的完成结论保持不变；G0-004 的语音与视频扩展状态为 `IN_PROGRESS`，不得将上述两项写成已通过。

## 2026-08-28 真实租户单聊验收结果

| 场景 | 状态 | 脱敏实测结论 |
| --- | --- | --- |
| 单聊语音 | 通过 | `2026-08-28T06:05:24.598Z` 收到 `message.voice`，`chattype=single`，转写字段存在、长度为 78 UTF-8 字节；未下载媒体，且原始转写未写入证据。 |
| 单聊视频 | 通过 | `2026-08-28T06:06:30.579Z` 收到 `message.video`，`chattype=single`，`url/aeskey` 字段均存在；SDK 在内存中于 `2635` ms 完成下载/AES 解密，得到 `7504991` 字节的 `mp4` / `video/mp4`，本地阈值内。URL、AES Key 与媒体文件均未写入证据。 |

### 最终扩展结论

- `message.voice` 与 `message.video` 的用户单聊接收能力均已取得真实租户证据；语音按企业微信提供的转写文本处理，视频按加密媒体下载/AES 解密处理。
- 语音原文、视频 URL/AES Key、原始文件名和媒体内容均未记录；视频安全失败归类继续由同一共享下载链路的 G0-004 自动化测试覆盖，未将其伪称为额外的真实租户负向实验。
- 本节以真实租户结果取代上节的待验证状态。G0-004 的扩展范围现为 `DONE`；G0-008 仍需单独授权后才能启动。
