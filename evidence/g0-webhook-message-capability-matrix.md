# G0-WEBHOOK-001 群机器人 Webhook 消息能力矩阵

- 任务状态：`DONE（接口接受层）`；客户端显示/交互项只在取得人工观察后标记为已确认。
- 执行环境：本机 Windows；Gate 0 本地能力验证。
- 官方依据：[消息推送配置说明](https://developer.work.weixin.qq.com/document/path/91770)。
- 范围：只验证群机器人 Webhook 的消息投递与媒体上传接口；不创建工单、不接入 Pilot Ticket Core、医院系统或生产业务。
- 通道边界：本矩阵与智能机器人长连接的 G0-005 主动推送矩阵相互独立；一个通道的 @ 结论不可外推至另一个通道。
- 脱敏：Webhook `key`、原始 `userid`、原始正文、`media_id` 与服务端错误原文均不记录。详见 `evidence/g0-webhook-message-capability-captures.jsonl`。

## 输入、输出与可复用探针

| 项目 | 定义 |
| --- | --- |
| 输入 | 运行时环境变量 `WECOM_GROUP_WEBHOOK_URL`、`WECOM_GROUP_MENTION_USERID`；二者均不得写入仓库或证据。 |
| 执行 | `node scripts/g0-webhook-message-capability-probe.mjs --live`。探针要求显式 `--live`，避免误发群消息。 |
| 自动化测试 | `node --test tests/g0-webhook-message-capability.test.mjs`；覆盖 URL 脱敏、负载形态、内存媒体夹具、multipart 字段及结果脱敏。 |
| 输出 | 仅输出 HTTP 状态、稳定的 `errcode`、耗时、夹具字节数和是否收到 `media_id`；不输出任何敏感原值。 |
| 频率保护 | 首轮 9 条消息，图片重试 1 条，共 10 条；均低于文档的 20 条/分钟上限。 |

## 实测结果

| 能力 | 文档负载/前置条件 | API 实测 | 客户端人工结论 | 可复用结论 |
| --- | --- | --- | --- | --- |
| 文本 + 指定成员 @ | `text.content` + `mentioned_list=[userid]` | `HTTP 200` / `errcode=0` | 已确认原生 @ 提醒 | 通过；优先使用 `mentioned_list`，不以昵称代替 `userid`。 |
| Markdown + @ 扩展 | `markdown.content` 中 `<@userid>` | `HTTP 200` / `errcode=0` | 待人工确认 | 接口接受；在未确认客户端原生提醒前，不得将其作为可靠通知承诺。 |
| `markdown_v2` | `markdown_v2.content`；不含 @ | `HTTP 200` / `errcode=0` | 待人工确认 | 通过接口验证；文档明确不支持 @ 语法。 |
| 图片 | PNG/JPG Base64 + 原始字节 MD5，原始文件不超过 2 MiB | 1×1 PNG 被 `40123` 拒绝；64×64 PNG 重试 `HTTP 200` / `errcode=0` | 待人工确认 | 支持有效常规 PNG；不得把 1×1 夹具的拒绝泛化为图片类型不支持。 |
| 图文 | `news.articles`，1 条测试文章 | `HTTP 200` / `errcode=0` | 待人工确认 | 通过接口验证；链接点击与图片加载须在目标客户端另行观察。 |
| 文件 | `upload_media?type=file` 后，用返回的 `media_id` 发送 `file` | 上传与发送均 `HTTP 200` / `errcode=0` | 待人工确认 | 通过；`media_id` 仅在对应 Webhook 下三天有效，且不记录到证据。 |
| 语音 | `upload_media?type=voice` 后，用返回的 `media_id` 发送 `voice` | 1 秒 AMR-NB 结构夹具上传与发送均 `HTTP 200` / `errcode=0` | 待人工确认播放效果 | 通过接口验证；复用时必须使用小于 2 MiB、60 秒内的 AMR 文件。 |
| 文本通知模板卡片 | `template_card.card_type=text_notice`，含 `main_title` 与 `card_action` | `HTTP 200` / `errcode=0` | 待人工确认 | 通过接口验证；卡片跳转行为未测试。 |
| 图文展示模板卡片 | `template_card.card_type=news_notice`，含 `main_title`、`card_image`、`card_action` | `HTTP 200` / `errcode=0` | 待人工确认 | 通过接口验证；卡片跳转行为未测试。 |
| 手机号 @ 备用字段 | `mentioned_mobile_list` | 未测 | 不适用 | 未提供经授权的测试手机号；不得用猜测号码测试。 |

## 未做或不可外推的边界

- 未压力验证 20 条/分钟阈值，也未验证 2048/4096 字节文本边界、2 MiB 图片、20 MiB 文件、2 MiB/60 秒语音的极限值；这些均仅按文档约束执行。
- Webhook 返回 `errcode=0` 只证明平台接受请求，不足以证明最终展示、通知、文件下载、语音播放或卡片点击已成功。
- 不保存或复用本轮临时 `media_id`；它具有三天有效期且只允许被上传它的同一消息推送使用。
- 本补充验证不改变当前 Gate 0 阶段、G0-007 稳定性任务或 Gate 0 退出条件。

## 验收结论

`G0-WEBHOOK-001` 的 Webhook 接口层验证通过：文本 @、Markdown、`markdown_v2`、图片、图文、文件、语音及两种文档列出的模板卡片均取得成功接口回执；图片结论基于有效 64×64 PNG 的重试成功。唯一已取得客户端人工确认的可见性结论是文本 `mentioned_list` 的原生 @ 提醒，其余客户端可见性和交互保持待确认状态。
