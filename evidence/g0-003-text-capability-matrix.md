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

## 2026-09-22 用户个人信息字段补充验证

本轮只验证“回调直接提供什么”和“是否需要另行查询个人资料”，不把回调中的身份标识当作个人资料，也不保存用户 A 的原始标识、原文或响应 URL。群聊和单聊均由同一测试用户 A 触发；运行时输出和追加的 JSONL 仍只保留字段名、字节数与哈希。

| 场景 | 实测回调 | 回调直接可得 | 回调直接不可得 | 状态 |
| --- | --- | --- | --- | --- |
| 用户 A 在群内 `@bot` | `2026-09-22T08:52:18Z`，`chattype=group` | `from.userid`、`chatid`、`msgid`、`aibotid`、`msgtype`、消息内容、`response_url` | 姓名、部门名称/部门资料、职务、手机号、性别、邮箱、头像、二维码、地址等个人资料字段 | 身份与会话上下文通过；个人资料字段未提供 |
| 用户 A 与 bot 单聊 | `2026-09-22T08:52:58Z`，`chattype=single` | `from.userid`、`msgid`、`aibotid`、`msgtype`、消息内容、`response_url` | 同上；且本回调没有 `chatid` | 身份通过；个人资料字段未提供 |
| 群聊与单聊身份关联 | 两条样例的 `sender_user_id_hash` 均为 `eed67fb12c02e975` | 在同一 Bot 命名空间内可判断为同一发送者 | 不等于已完成 Bot 命名空间到代开发应用命名空间的授权映射 | 仅限本 Bot、脱敏、当前样例 |

### 需要另行调用的个人资料能力

官方 [智能机器人长连接回调](https://developer.work.weixin.qq.com/document/path/101463) 只定义 `from.userid`，没有姓名、部门、手机号等资料字段。若业务确实需要成员资料，必须走独立的企业应用通讯录接口，而不是从群聊或单聊回调猜测：

1. 先按当前 Bot 与应用的身份命名空间选择官方转换接口：自建应用对接 Bot 可用 [`batch/openuserid_to_userid`](https://developer.work.weixin.qq.com/document/path/101521)；代开发/第三方应用按场景使用 [`userid_to_openuserid` 或对应的服务商转换接口](https://developer.work.weixin.qq.com/document/path/97106)。转换本身只解决 ID 对应关系，不授予资料访问权。
2. 再以有权限的应用 `access_token` 调用 [`user/get`](https://developer.work.weixin.qq.com/document/path/96255)。接口可能返回 `name`、`department`（部门 ID 列表）、`position`、`is_leader_in_dept`、`direct_leader`、`status`、`main_department`、`extattr`、`external_profile` 等；具体字段仍受应用类型、可见范围和管理员授权限制。
3. `mobile`、`gender`、`email`、`biz_mail`、`avatar`、`qr_code`、`address` 等敏感字段，对新建自建/代开发应用需要管理员授权并由成员本人完成 OAuth2 手工授权（`snsapi_privateinfo`）；用户给 Bot 发消息不等于完成该授权。

本仓库 `evidence/g0-005-http-template-card-20260922.md` 的同日定向验证中，`user/get` Provider 返回 `errcode=0`，但仅观察到 `userid`，`name`、`department`、`gender`、`mobile`、`avatar` 未返回。因此当前租户的“进一步读取完整个人资料”只能标为 `部分通过/未证明`；空字段不能解释为用户没有资料，必须先补齐应用可见范围和授权。该 HTTP 结果不改变本 Bot WebSocket 回调的结论，也不构成 P2-G2-LIVE 授权。

上段保留的是前一轮 HTTP 读取运行的原始观察；以下追加的用户 A 复核是新的、同日的独立调用，不能合并为同一次 `user/get` 返回。

### 2026-09-22 用户 A 的 `userid → user/get` 后续复核

本次用上一节群聊/单聊捕获到的发送者哈希核对配置测试用户，哈希一致后才执行只读目录调用；原始 userid、转换后的 open_userid、姓名、手机号和部门名称均未写入终端或 Evidence。

| 步骤 | 脱敏结果 | 状态 |
| --- | --- | --- |
| Bot 用户 ID与配置用户核对 | `sender_user_id_hash` 一致 | 通过 |
| `POST batch/userid_to_openuserid` | `errcode=0`，成功映射 1 个，无效 0 个 | 通过 |
| `GET user/get` | `errcode=0`；返回 userid、姓名、1 个部门 ID、别名、账号状态；职务为空，手机号、性别、邮箱、头像、二维码、地址等未返回 | 部分通过 |
| `GET department/get` | 1 个部门 ID 成功解析出部门名称 | 通过 |

因此，当前应用在已确认可见范围内可以通过 `userid` 取得有限成员资料和部门名称；这不是 Bot 回调直接携带的资料，也不证明敏感字段已获授权。`mobile`、`gender`、`email`、`avatar` 等仍需按官方 OAuth2/管理员授权规则处理。
