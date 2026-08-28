# G0-003 单聊与群聊文本能力矩阵

- 执行环境：当前本机 Windows；不使用 WSL。
- SDK：`@wecom/aibot-node-sdk@1.0.6`。
- 脱敏原则：捕获文件只记录字段名、消息类型、会话类型、文本字节数、引用结构与哈希化 ID；绝不记录原始文本、用户/群/消息 ID 明文、响应 URL、Bot ID 或 Secret。
- 当前连接准备结果：已取得单聊与群内 @ 的两个脱敏 Frame 样例；当前没有运行中的捕获进程。

## 执行方式

每个场景单独运行一次，待日志出现 `capture_ready` 后再从企业微信发送指定的无敏感测试消息。不要并发启动多个捕获进程，以保持单活连接。

| 场景 | 捕获命令 | 企业微信操作 | 所需账号 | 判定 |
| --- | --- | --- | --- | --- |
| 单聊文本 | `npm run g0:003:capture -- --scenario=direct_text` | 账号 A 与机器人单聊发送 `G0TEST-DIRECT` | A | 是否收到；字段、`chattype`、`msgid`、`userid` 形态 |
| 群内 @ 文本 | `npm run g0:003:capture -- --scenario=group_mentioned_text` | 账号 B 在测试群 @机器人并发送 `G0TEST-MENTION` | B | 是否收到；`chatid`、`userid`、`msgid` 形态 |
| 群内未 @ 文本 | `npm run g0:003:capture -- --scenario=group_unmentioned_text` | 账号 B 在同一测试群发送 `G0TEST-NO-MENTION`，不 @机器人 | B | 收到或在超时内未收到，二者都记录为结论 |
| 引用文本 | `npm run g0:003:capture -- --scenario=quoted_text` | 账号 A 或 B 引用一条 `G0TEST-QUOTE-SOURCE` 后发送 `G0TEST-QUOTE-REPLY` | A 或 B | `quote` 是否存在及其字段形态 |
| 重复发送 | `npm run g0:003:capture -- --scenario=direct_text --max-messages=2` | 账号 A 连续两次发送 `G0TEST-REPEAT` | A | 两条回调是否均收到及其哈希化 `msgid` 是否不同 |

默认等待 120 秒；可用 `--timeout-ms=300000` 延长。捕获成功后安全样例写入 `evidence/g0-003-frame-captures.jsonl`，该文件不应手工补写或包含原始文本。

## 当前结论

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| 本机认证与文本捕获器就绪 | 通过 | `capture_ready` 日志；未在本次 10 秒预检窗口收到文本。 |
| 单聊文本 | 通过 | `2026-08-21T15:39:44Z` 收到 `message.text`；`chattype=single`、无 `chatid`、`msgid/aibotid/from.userid/response_url/text` 字段存在、`quote` 不存在。完整脱敏样例见 `g0-003-frame-captures.jsonl`。 |
| 群内 @ 文本 | 通过 | `2026-08-21T15:41:46Z` 收到 `message.text`；`chattype=group`、`chatid` 存在、`msgid/aibotid/from.userid/response_url/text` 字段存在、`quote` 不存在。完整脱敏样例见 `g0-003-frame-captures.jsonl`。 |
| 两账号交叉（群内 @） | 通过 | `2026-08-26T08:15:19Z` 收到第三条脱敏样例：`chattype=group`、`chatid` 存在、`quote` 不存在；发送者哈希为 `998cb37f0a087b07`，不同于此前单聊和群内 @ 样例的 `eed67fb12c02e975`。 |
| 群内未 @ 文本 | 通过（不投递） | 捕获器从 `2026-08-21T15:42:36Z` 认证就绪后等待 5 分钟，未收到 Frame 并以 `CAPTURE_TIMEOUT` 断开。因此当前测试群中，不 @机器人的文本不会投递给机器人。 |
| 引用消息 | 通过 | `2026-08-26T08:31:10Z` 收到群内引用回复；`quote` 存在，脱敏字段名为 `msgtype`、`text`。未记录引用原文或任何 ID 明文。 |
| 重复发送 | 通过 | `2026-08-27T00:17:24Z` 与 `2026-08-27T00:17:27Z` 收到同一发送者的两条单聊 Frame；二者哈希化 `msgid` 分别为 `a89cfbefa3744c89`、`06f247adf416fed6`，不同；两条均无 `chatid`、无 `quote`。 |

单聊与初始群内 @ 样例的发送者哈希相同；`2026-08-26` 的群内 @ 样例来自不同哈希发送者，故“两账号交叉测试”已完成。同日已获得真实引用 Frame；`2026-08-27` 已获得两条不同 `msgid` 的重复发送 Frame。

## 2026-08-26 前置条件记录

已邀请第二账号加入包含机器人的测试群。首次在群内 `@` 机器人时，企业微信提示“不在通讯录范围”，本机捕获器未收到 Frame；该次事件不构成消息投递失败。范围修正后重新测试，已于 `2026-08-26T08:15:19Z` 捕获到该第二账号的群内 @ Frame。

G0-003 的安全样例已齐全，任务状态为 `DONE`。G0-004 仍须等待用户确认后才可进入。
