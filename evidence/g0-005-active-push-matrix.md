# G0-005 主动推送与提醒效果验证矩阵

- 执行环境：当前本机 Windows；不使用 WSL。
- SDK：`@wecom/aibot-node-sdk@1.0.6`。
- 目标：仅验证 `sendMessage(chatid, body)` 的 `aibot_send_msg` 主动投递能力；不创建工单、不接入 Pilot Ticket Core，也不调用医院系统。
- 隐私：原始 `userid`、`chatid`、消息内容、回调 URL 和 SDK 原始错误文本均不写入控制台或证据。仅记录目标哈希、消息内容哈希、字段形态、稳定错误码和可安全公开的 `errcode` 整数。

## 执行方式

| 场景 | 命令 | 人工操作 | 预期证据 |
| --- | --- | --- | --- |
| 在线单聊用户 | `node --env-file=.env src/g0-005-active-push.mjs --scenario=userid_from_message --repeat-count=2` | 测试账号保持在线，向机器人单聊发送任意无敏感文本；观察两条主动 Markdown 推送和通知 | 两条 `acknowledged`，目标类型 `userid`；人工确认显示和通知 |
| 群聊主动推送 | `node --env-file=.env src/g0-005-active-push.mjs --scenario=chatid_from_message` | 在测试群 @机器人并发送任意无敏感文本；观察群内主动 Markdown 推送 | `acknowledged`，目标类型 `chatid`；人工确认显示 |
| Markdown @ 标记实验 | `node --env-file=.env src/g0-005-active-push.mjs --scenario=chatid_from_message --mention-sender` | 触发者在测试群 @机器人后发送任意无敏感文本；观察 `<@userid>` 是否渲染为 @ 并产生提醒 | 仅记录 `mention_mode=markdown_tag`；显示/通知以人工观察为准 |
| Text `mentioned_list` 实验 | `node --env-file=.env src/g0-005-active-push.mjs --scenario=chatid_from_message --mention-mode=text_mentioned_list` | 触发者在测试群 @机器人后发送任意无敏感文本；观察平台是否接受 `text.mentioned_list=[from.userid]` 并产生真实 @ 提醒 | 仅记录 `mention_mode=text_mentioned_list` 和目标数量；显示/通知以人工观察为准 |
| Markdown 后纯文本 @ 序列（补充验证） | `node --env-file=.env src/g0-005-active-push.mjs --scenario=chatid_from_message --mention-mode=markdown_then_text_tag --timeout-ms=600000` | 触发者在测试群 @机器人后发送任意无敏感文本。机器人先发一条不带 @ 的 Markdown；随后独立发送一条只包含 `<@from.userid>` 的纯文本消息。观察第二条是否呈现企业微信原生 @ 标识并触发提醒。 | 两条独立证据，按 `delivery_step=markdown_without_mention`、`plain_text_mention_tag` 排序；第二条被拒绝同样是有效的能力结论，且不得记录正文或真实标识。 |
| 离线用户 | 同“在线单聊用户”命令 | 目标测试账号离线后发送触发文本，之后重新登录观察通知 | SDK 回执与重新登录后的人工观察分开记录 |
| 退群用户/群变更 | 需要可由测试人员提供的非敏感临时目标后另行执行 | 先形成可复现目标，再让测试账号退出相关测试群并重试 | 平台接收或拒绝行为及人工可见性；不得猜测结果 |
| 无效 chatid | `node --env-file=.env src/g0-005-active-push.mjs --scenario=invalid_chatid` | 无需发送消息 | 预期 `WECOM_PUSH_REJECTED` 和 `provider_errcode`；若意外确认则失败 |

`sendMessage` 的 SDK 合约使用一个 `chatid` 参数：单聊传 `userid`，群聊传 `chatid`。群回调只给出 `from.userid`，不提供 username；因此用该值产生的 `@3589` 不是 username/userid 取值混淆，而是 Markdown 标记未被平台解析。公开 Node SDK 的 `SendMarkdownMsgBody` 仅有 `markdown.content`，未声明群 @ 字段。`text.mentioned_list` 是单独的、显式的 G0 协议兼容性实验，不得因其他企业微信 Webhook 文档而预设其必然生效。

## 当前结论

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| 本机主动推送 PoC 与脱敏保护 | 通过（自动化） | `npm run test:g0:005` 覆盖参数边界、重复发送、原始目标/内容不泄漏和错误目标的稳定归类。 |
| 在线单聊用户 | 通过 | `2026-08-27T02:02:43Z` 收到真实单聊触发后，`sendMessage` 向内存中的 `userid` 连续两次投递均获得 `provider_errcode=0` 回执；耗时分别为 `396` ms、`365` ms。测试账号已人工确认两条消息均显示并收到通知。原始目标和消息内容未写入证据。 |
| 群聊主动推送 | 通过 | `2026-08-27T02:08:14Z` 与 `02:10:41Z` 两次真实群内 @机器人触发后，`sendMessage` 向内存中的 `chatid` 投递均获得 `provider_errcode=0` 回执，耗时 `432` ms、`403` ms；测试人员已确认群内显示主动消息。原始群标识和内容未写入证据。 |
| Markdown @ 标记实验 | 不通过（普通文本） | 两次真实群推送的 `markdown_tag` 都获得成功回执，但触发者确认仅显示为 `@3589`，无平台级 @ 标识或提醒。该值来自 `from.userid`；问题不在 username/userid 选择，而在该语法未被智能机器人通道解析。 |
| Text `mentioned_list` 实验 | 不通过（平台拒绝） | `2026-08-27T02:20:11Z` 真实群内触发后，`text.mentioned_list=[from.userid]` 被平台以 `provider_errcode=40008` 拒绝，稳定归类为 `WECOM_PUSH_REJECTED`，耗时 `235` ms。该错误码及证据中均无原始目标、消息内容或 SDK 错误文本。 |
| Markdown 后纯文本 @ 序列 | 不通过（平台拒绝，客户端不可见） | `2026-08-27T02:48:16Z` 的真实群触发中，第一条 Markdown 以 `provider_errcode=0` 确认；第二条只含 `<@from.userid>` 的纯文本以 `provider_errcode=40008` 拒绝。测试人员确认群内只显示第一条 Markdown，未出现第二条纯文本、原生 @ 标识或 @ 提醒。 |
| 离线用户 | 通过 | `2026-08-27T02:28:28Z` 在测试账号单聊触发后等待 `10` 秒投递，账号已退出客户端。`sendMessage` 获得 `provider_errcode=0` 回执，脱敏证据耗时 `406` ms；测试人员重新登录后确认消息可见且收到通知。 |
| 退群用户/群变更 | 通过（群目标独立于触发成员） | `2026-08-27T02:31:58Z` 中，触发同事在投递前退出测试群，仍在群内的观察者确认收到机器人向原 `chatid` 主动推送的消息。SDK 回执为 `provider_errcode=0`，脱敏证据耗时 `442` ms；此结论只说明群目标仍有效，不表示退出成员可继续收到群消息。 |
| 无效 chatid | 通过（预期拒绝） | `2026-08-27T02:20:58Z` 向一次性生成的无效 `chatid` 主动投递被拒绝，稳定归类为 `WECOM_PUSH_REJECTED`，`provider_errcode=93006`，耗时 `197` ms；原始目标和 SDK 错误文本未写入证据。 |

G0-005 已完成。单聊在线/离线显示与通知、群 `chatid` 主动投递、触发成员退群后的群目标行为、重复发送、无效目标错误码，以及三种群 @ 路径均已取得真实结论。主动推送的 SDK 回执只表示通道接受或拒绝；本矩阵中的显示、通知和群 @ 结论均已由测试人员人工观察确认。G0-006 须等待用户明确确认后才可开始。
