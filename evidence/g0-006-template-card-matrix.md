# G0-006 模板卡片与群内被动回复 @ 验证矩阵

- 执行环境：当前本机 Windows；不使用 WSL。
- SDK：`@wecom/aibot-node-sdk@1.0.6`。
- 范围：仅验证智能机器人长连接的模板卡片、`task_id`、按钮回调、更新时限，以及群消息回调绑定的被动文本/流式回复 @；不创建工单、不接入 Pilot Ticket Core，也不调用医院系统。
- 接口参考：已读取用户提供的 [智谱清言共享说明](https://chatglm.cn/glmsShare?assistant_id=65940acff94777010aa6b796&is_share=1&share_by=66f569d3e8741690a278339c&share_conversation_id=PF0ZzvNw&share_from=app&share_id=JFmxI5hW&lang=zh)。其中关于 `<@userid>` 与 `aibot_respond_msg` 的内容只作为待验证假设；本地锁定 SDK 合约、真实平台回执和客户端观察才构成本项目结论。
- 隐私：触发文本、原始 `userid`、原始 `chatid`、原始 `task_id`、回调 `req_id`、流式回复 ID、URL 和 SDK 原始错误文本均不写入控制台或证据。证据仅保留哈希、字段名、静态动作名称和安全 `errcode` 整数。

## 执行方式

模板卡片场景使用机器人可见范围内的测试账号，在**与机器人单聊**中发送任意无敏感文本触发。群内回复 @ 场景在测试群中 @机器人并发送固定口令 `G0-006-REPLY-AT`；探针只处理包含该口令的首条群文本回调，并严格复用该帧的 `headers.req_id` 与 `from.userid`。命令不经 WSL 执行；为确保参数传递准确，使用直接 Node 命令。

| 场景 | 命令 | 人工操作 | 预期证据 |
| --- | --- | --- | --- |
| 确认按钮与 5 秒更新 | `node --env-file=.env src/g0-006-template-card.mjs --mode=fast` | 收到卡片后点击“确认”一次，观察卡片是否在 5 秒内更新为已确认。 | `card_dispatch`、`card_event`、`card_update`；`within_five_seconds=true`。 |
| 仍未恢复按钮与 5 秒更新 | `node --env-file=.env src/g0-006-template-card.mjs --mode=fast` | 收到新的卡片后点击“仍未恢复”一次，观察卡片是否在 5 秒内更新。 | 同上，动作记录为 `still_unrecovered`。 |
| 重复点击 | `node --env-file=.env src/g0-006-template-card.mjs --mode=duplicate` | 收到卡片后连续两次点击同一按钮；首次更新仍保留按钮，随后再次点击相同按钮。 | 两个相同动作事件；第二个 `action_click_index=2` 且 `duplicate=true`。 |
| 超过时限更新 | `node --env-file=.env src/g0-006-template-card.mjs --mode=late` | 收到卡片后点击任一按钮。探针会等待 6 秒后才调用更新；观察卡片最终是否改变。 | `invoked_after_event_ms > 5000`；平台确认或拒绝均记录为明确过期行为结论。 |
| 群回调被动纯文本 @ | `node --env-file=.env src/g0-006-group-reply-mention.mjs --reply-mode=text` | 在测试群 @机器人并发送固定口令；观察是否收到回复、是否渲染原生 @ 以及是否产生 @ 提醒。 | `command=aibot_respond_msg`、`msgtype=text`、`callback_req_id_reused=true`；平台回执与客户端观察分开判定。 |
| 群回调被动流式 @ | `node --env-file=.env src/g0-006-group-reply-mention.mjs --reply-mode=stream` | 再次在测试群 @机器人并发送固定口令；观察已结束流式回复中的 `<@from.userid>` 是否成为原生 @。 | `command=aibot_respond_msg`、`msgtype=stream`、`stream_finish=true`；平台 ACK 不替代客户端效果确认。 |

## 当前结论

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| 卡片、群回复构造与脱敏保护 | 通过（自动化） | `npm run test:g0:006` 共 `13` 项，覆盖参数范围、两种按钮、同一 `task_id` 更新、重复点击、超过时限归类、被动 `text`/`stream` 回复体、当前帧复用、错误归类和敏感值排除。 |
| 确认按钮事件与 5 秒更新 | 通过 | `2026-08-27T03:46:17Z` 真实单聊卡片的确认按钮回调已关联当前 `task_id` 和触发用户哈希；`1` ms 后调用更新，`provider_errcode=0`。测试人员确认卡片显示“已确认”。 |
| 仍未恢复按钮事件与 5 秒更新 | 通过 | `2026-08-27T03:48:22Z` 真实单聊卡片的 `still_unrecovered` 回调在 `2` ms 后更新，`provider_errcode=0`。测试人员确认卡片显示“仍未恢复已记录”。 |
| 重复点击 | 通过 | `2026-08-27T03:50:22Z` 与 `03:50:24Z`，同一用户、同一 `task_id`、同一确认按钮收到两次事件。第二次为 `action_click_index=2`、`duplicate=true`，两次更新均获 `provider_errcode=0`；测试人员确认最终显示“重复点击已识别”。 |
| 超过 5 秒更新的过期行为 | 不通过（明确降级） | `2026-08-27T03:51:45Z` 收到事件后，探针延迟至 `6009` ms 才调用更新；平台以 `provider_errcode=846604` 拒绝，测试人员确认卡片无变化。结论：超过 5 秒不可依赖卡片更新。 |
| 群回调被动纯文本 `<@from.userid>` | 不通过（协议拒绝） | `2026-08-28T00:47:26Z` 严格复用群回调 `req_id` 调用 `aibot_respond_msg`，`msgtype=text` 在 `283` ms 后被平台以 `provider_errcode=40008` 拒绝。该消息未获投递，用户提供说明中的纯文本示例不适用于当前 SDK/租户。 |
| 群回调被动流式 `<@from.userid>` | 不通过（平台接受但客户端不解析 @） | `2026-08-28T00:51:17Z` 同一路径改用 SDK 支持的结束流式回复，`msgtype=stream` 在 `535` ms 后获得 `provider_errcode=0`；测试人员随后确认客户端把 `<@userid>` 原样显示为普通文本，没有原生高亮、不可点击、没有 @ 提醒，只有普通新消息提示。 |

## 真实协议发现

- 当前租户的按钮回调数据位于 `body.event.template_card_event`，而不是 SDK 类型/示例中的直接 `body.event`；探针兼容两种形态，但以真实帧为准。
- 最初更新缺少有效 `card_action` 时，平台返回 `provider_errcode=42045`。更新卡片改为显式 HTTPS `card_action` 后，5 秒内的真实更新均获确认；该验证 URL 仅使用企业微信官方公开主页，未记录于证据，也不指向任何业务系统。
- 群内主动推送与群消息回调被动回复不是同一协议路径。此次补测确认 `aibot_respond_msg` 确实绑定当前回调 `req_id`；但当前租户拒绝普通 `text` 回复，只接受本 SDK 的 `stream` 回复形态。
- `provider_errcode=0` 不能单独证明 `<@userid>` 已被客户端解析。本次截图观察确认 `stream` 路径只显示字面量文本，没有蓝色可点击 @ 标识或 @ 提醒；截图未复制到仓库，证据仅记录 SHA-256 `b9ce5122903ca1ac27bb5c7568feea8a5acbff1dbde1a84041e045bdb157313c` 与脱敏布尔结论。

G0-006 已完成本次补充复测。原模板卡片四项真实租户验证结论不变；群内被动纯文本 @ 被平台拒绝，群内被动流式 @ 虽获平台 ACK，但客户端仅显示字面量文本且没有 @ 提醒。因此当前 SDK/租户下已测试的群内回复 @ 能力不可用，后续业务不得将其作为可靠提醒机制。该补测不改变当前仍处于 Gate 0 的阶段状态，也不启动任何后续阶段。
