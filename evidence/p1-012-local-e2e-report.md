# P1-012 E2E 与 Go/No-Go 验收记录

- 技术验收起始日期：2026-08-29
- 正式批准日期：2026-08-30
- 环境：Windows 本机、Node.js、Pilot PostgreSQL；不建立公网入站监听。
- 结论：本机受控实现和 P1-012 要求的真实测试群技术场景已完成；项目负责人于 2026-08-30 对完整证据作出正式批准，当前结论为 `GO / DONE`。P2 未启动，仍需另行授权。

## 2026-08-30 全量自动化复核与收口

本轮在 `phase1/p1-012-closeout`、基线提交 `423b9b5` 上执行。技术复核完成后，项目负责人明确批准 Phase 1 Go；
P1-012 与 Phase 1 状态更新为 `DONE / GO`。实时配置预检继续通过：P1、出站 WSS、无公网监听，AI/OCR/Hospital Tickets 均关闭。

自动化结果：

- V1.4 架构静态验证 101/101 通过，V1.4 架构测试 8/8 通过；
- P1-012 单元/脚本回归 44/44 通过；
- P1-012 真实 Pilot PostgreSQL 集成回归 45/45 通过；
- P1-004 Intake 词法与聚合回归 22/22 通过；
- 全仓 30 个测试文件在一次性隔离 PostgreSQL 数据库中串行执行，204/204 通过；隔离库在运行后删除；
- `evidence/p1-012-live-e2e.jsonl` 当前 478/478 行均为有效 JSON，复核时 SHA-256 为
  `37fa28d7682b9d09c84fa70f0a41acee840662b04c4eeaf160044325fc5d6199`。

全仓首次复跑暴露了两个验证夹具问题，已作最小测试代码修正：G0-008 测试仍读取 V1.4 已删除的
`current_phase.first_task`；P1-007 的集成测试使用全局 `runOnce()`，会租用共享 Pilot 库中不属于本次测试的
`PENDING` Delivery。夹具现改为只按本次测试创建的确切 Delivery ID 执行，并已完成定向及隔离全仓回归。

首次共享库复跑期间，现场 P1-012 Ticket 的两条 Delivery 被合成测试发送器写成 `SENT`，提供方标识符合测试
`ack-*` 模式；其中一条保留原先的 `RETRY_SCHEDULED` 后又出现合成 `SENT`。这些记录不是企业微信真实发送成功，
不得用于 P1-012 Outbox 或客户端可见性验收。随后执行只读、脱敏对账：确认为同一 Ticket 的 2 条 Delivery、3 次 Attempt、
1 次重试和 2 次合成 `SENT`，两个通道各 1 条；数据库未变更，审计历史保留，并以 `IDENTIFIED_AND_EXCLUDED`
从真实企业微信证据中排除。

随后在一次性隔离数据库中执行真实 PostgreSQL/Outbox 故障演练：先持久化 Ticket 事实，再禁止该隔离库新连接并
终止其现有连接；故障期 Intake 失败闭合。恢复连接后，同一消息幂等重放只形成一个 Ticket，故障前事实仍存在。
对该 Ticket 的确切 Delivery 注入发送失败后，`delivery_attempt` 记录 `RETRY_SCHEDULED/WECOM_SEND_FAILED`；恢复
发送器后同一 Delivery 变为 `SENT`，共保留两次 Attempt。共享 PostgreSQL 未停止，隔离数据库已删除。该结果满足
本机隔离 PostgreSQL 与实际 Outbox Worker 故障/恢复演练，不证明企业微信提供方投递或客户端显示。

Windows 企业微信客户端只读复核还确认：目标测试群中已有一条明确、非敏感报修，随后显示机器人“验收受理完成”
及 Ticket 编号的客户端回复；不在本报告复述账号、群名、原文 token 或 Ticket 编号。对应 JSONL 源结果已经记录
`TICKET_CREATED`、10 秒目标内、被动回复 `provider_errcode=0/ACKED`，但当前脚本只支持为非写入
`GROUP_REPLY_PROBE` 追加 HMAC 关联的客户端观察，尚没有为完整 `GROUP_TEXT` 追加同等受控关联记录。因此只将本次
屏幕复核记为现场可见事实，不把它提升为结构化 Go/No-Go 字段。

同轮先在目标测试群发送了一张未提及机器人的非敏感图片：客户端可见，但 WSS 监听窗口没有收到 callback，不能作为
机器人图片降级证据。依据该租户群聊的实际触发方式，图片场景随后收敛为两种兼容输入：直接 `image` callback，或同时
包含本次一次性 token 和至少一张图片的 `mixed` callback；错误 token、无 token 或仅文字 `mixed` 均忽略。新增回归后，
由受控 Windows 客户端自动化发送一次带原生机器人提及、一次性 token 和非敏感图片的真实 `mixed` 消息。WSS 源结果记录
`GROUP_IMAGE_DEGRADED`、`WAITING_DESCRIPTION`、未创建 Ticket、核心及回复均在 10 秒目标内，完成流式被动回复为
`provider_errcode=0/ACKED`；客户端随即显示“验收已受理，请补充文字描述后继续处理”的降级提示。报告不保存或复述
账号、群名、原文 token、图片内容或本机路径。该结果满足本次图片降级的真实 callback、数据库事实、提供方回执和客户端
显示观察；客户端观察仍是脱敏现场记录，不等同于负责人 Go 批准。

真实重连后文字回环使用同一 `RECONNECT_GROUP_TEXT` 运行：初次认证后由脚本主动断开，依次记录断开、重连请求、重认证和
`p1_012_post_reconnect_message_ready`，只有此后才允许匹配文字 callback。测试账号在 ready 后发送一条带原生机器人提及、
一次性 token 和非敏感故障描述的文字。该 callback 在 29 ms 内完成 Intake，完成流式回复取得
`provider_errcode=0/ACKED`，客户端也显示机器人回复；源结果带
`reconnect.reauthenticated_before_callback=true`，因而重连与文字回环已经在同一证据链中关联。

该次文字使用常见表述“无法登录”，现场同时暴露原规则只含“登录失败”的词法缺口：本次事实因此为
`WAITING_DESCRIPTION`、未创建 Ticket，不能补写成成功建单。实现已把“无法登录”加入 Phase 1 确定性 Incident 规则，
并将 P1-012 带库夹具改为同一表述；P1-004 22/22、P1-012 带库 39/39 均通过。没有自动补发现场消息，修正后的真实 Ticket
重验随后使用新的受控 token 完成：`GROUP_TEXT` 在目标内受理并进入 `TICKET_CREATED`，只创建一个 Ticket，完成流式回复
为 `provider_errcode=0/ACKED` 且在 10 秒目标内；Windows 客户端观察为 `VISIBLE`。源结果带有效 HMAC `run_id`，
`p1_012_client_display_observed` 以 `database_write=true`、`ticket_created=true` 独立关联记录。该结果关闭完整文字建单和
客户端回执项，不替代突发或负责人批准。

随后首次真实 100 条突发尝试以新的受控 WSS 运行开始。序号 `001` 使用客户端候选菜单形成原生机器人提及，WSS 记录
一个唯一 callback、`TICKET_CREATED`、10 秒目标内以及被动回复 `provider_errcode=0/ACKED`。后续使用复制粘贴、界面外观
仍显示 `@` 的消息没有形成该运行的机器人 callback；运行最终以 `P1_012_LIVE_TIMEOUT` 结束。因此本轮只确认 1/100，
不构成突发通过，也不能把外观看似提及当作原生提及证据。

为消除手工往返和上述假提及风险，新增失败闭合的 Windows UI 驱动：每条消息都重新输入 `@`、粘贴唯一机器人搜索词、
通过客户端候选菜单选择，再粘贴非敏感正文和三位序号；先单条校准，确认 WSS `sequence_index=1` 后才批量发送余下 99 条。
驱动要求唯一企业微信主窗口、空输入框、显式 `-Execute`、前台窗口逐步复核、Esc 急停、剪贴板恢复和中断后对账。
其 `PlanOnly`/失败闭合测试 3/3 通过，纳入 P1-012 回归后为 44/44 通过；正式批准状态写入后，V1.4 架构验证为 101/101、架构测试 8/8。
UI 输入日志明确不证明 callback、Ticket 或 Delivery。

之后一次新 token 重做在序号 `093` 后达到 15 分钟监听上限；客户端随后触发的 7 条输入没有回调，运行按
`P1_012_LIVE_TIMEOUT` 失败关闭，不能与其他运行拼接。最终再次使用全新 token 和同一 15 分钟监听器，从 `001` 完整重做。
每条均通过客户端候选菜单建立原生机器人提及；每 10 条按 WSS 序号核对。序号 `039` 首次因机器人回复抢走正文焦点，只发送
了无 token 的提及，未进入本次统计；自动化在检查点暂停、重新聚焦输入框并补发唯一的 `039`，其余序号随后继续。最终同一运行
`p1_012_live_burst_result` 记录：`expected_count=100`、`callback_count=100`、`unique_message_count=100`、
`accepted_within_target_count=100`、`duplicate_callback_count=0`；数据库为 100 Inbox、100 Intake、100 Ticket、100 Outbox 和
200 Delivery，`zero_lost_tickets=true`、`zero_duplicate_tickets=true`、`notifications_traceable=true`，总收集时间 597122 ms，
结论为 `PASSED`。Windows 客户端末尾可见 `099`、`100` 及各自机器人受理回复；报告不保存账号、群名、token 或 Ticket 编号。
该结果关闭真实 100 条群内突发项。

技术证据完成后，项目负责人已复核完整结论并明确批准 Go。批准原文、证据范围和边界见
`evidence/p1-012-project-owner-go-approval.md`。该批准关闭 P1-012 和 Phase 1，不启动 Phase 2，也不构成生产或临床上线批准。

## 已验证的本机范围

执行：

```text
npm run test:p1:012:integration
```

结果：45/45 通过，0 失败。其中带库用例经过真实的
`Inbox → Intake → Ticket → Outbox → Delivery` 组合，验证了：

最终入口已固定 `--test-concurrency=1`。复核时旧并行入口曾因 UI 子进程、10 秒重连计时器和 100 并发数据库用例争用本机资源而出现 2 个失败；两项隔离串行复跑均通过，入口改为串行后统一复跑 45/45 通过，避免把调度争用误判为产品失败或把偶然复跑写成通过。

- 同一 callback 的并发重复只形成一个 Ticket；
- 图片进入 `WAITING_DESCRIPTION`，不伪造 Ticket；
- 100 个唯一 callback 形成 100 个独立 Ticket，连同重复和 Outbox 场景共有 102 个受控 Ticket，均在 10 秒目标内；
- 受控发送器失败后，`notification.delivery_attempt` 记录 `RETRY_SCHEDULED`，Delivery 保持 `PENDING`，恢复后同一幂等 Delivery 变为 `SENT`；
- `AI_TRIAGE_ENABLED=false`、`OCR_ENABLED=false` 的核心路径保持可用；
- 抛出的数据库接缝错误只产生稳定的 `P1_012_CORE_OPERATION_FAILED`，不向回复或公开结果泄漏错误文本；
- 被动回复和主动投递均必须取得明确 `{ errcode: 0 }` 的提供方回执；缺失回执会保持为可重试失败；
- 普通消息 callback 的被动回复使用完成的 `stream`，而非只适用于欢迎语的普通 `text`；数值 `provider_errcode` 与
  `ACKED`/`REJECTED`/`UNKNOWN` 会被保留，`errmsg` 不会进入证据；
- WSS 瞬时 `error`、断开、重连和重认证均有隔离 fake-client 测试；瞬时 `error` 不抢占自动重连，且证据写入失败只形成一个原子失败终态；
- 无公网监听配置、实时一进程授权、本机群 ID 安全捕获，以及非写入、单次回复的短回执探针均有隔离测试；探针同时校验 callback 的机器人 ID、测试群和测试账号。callback 保留首部 `@机器人` 时只接受其后一个普通 ASCII 空格后的精确标记；仅 callback 适配层已省略该前缀时接受裸标记，额外文字、错误群/账号/机器人均不回复。
- 短回执探针的超时、并发证据写入、晚到回复/认证事件和群 ID 捕获未知副作用均有故障接缝测试；脱敏失配诊断只记录作用域和匹配类别，不记录原文或任何身份值。
- 客户端显示观察只能经一进程授权的受控命令写入：每个新探针结果以随机运行熵导出 HMAC `run_id`，命令只接受最新、带 32 位 `run_id` 的首部提及 `GROUP_REPLY_PROBE`、以该 HMAC 关联值拒绝重复、且仅追加 `VISIBLE`、作用域和无写库事实；成功源结果追加与观察的选源、复核及追加共用临时目录的跨进程证据链独占声明。来源在取得声明前已过期会安全返回 `P1_012_CLIENT_OBSERVATION_SOURCE_STALE`；竞争观察返回 `P1_012_CLIENT_OBSERVATION_CLAIM_IN_PROGRESS`；竞争 live 探针会在调用被动回复前以 `P1_012_REPLY_PROBE_EVIDENCE_CLAIM_IN_PROGRESS` 失败闭合，因此既不产生回执也不追加新的成功源结果。硬超时会释放该声明，即使回复接缝永远未完成；晚到结果不会追加成功源证据。声明保存随机 owner、PID、主机名和创建时间，仅可由双重一次性授权、至少 60 秒、同一主机且 owner PID 已确认不存活的受控恢复命令处理。恢复 guard 与 quarantine 标记均会阻塞 live；恢复先追加脱敏的 `p1_012_reply_probe_evidence_claim_quarantined`，删除 quarantine 成功后才追加 `p1_012_reply_probe_evidence_claim_recovered`。删除失败保留标记并可在阈值后受控续跑；不可解析或多标记状态只能 fail-closed 运维对账。它不重新连接 WSS、不连接数据库，也不接受手工 JSONL 编辑。旧来源不回填；本次当前关联保证已由新真实探针和客户端观察获得。

全量串行回归 `node --env-file=.env.pilot --test --test-concurrency=1 tests/*.test.mjs` 为 195/195 通过，0 失败。中途发现的 P1-005 票号碰撞测试将 PostgreSQL 返回的序列字符串直接与
`1n` 相加，导致其恢复值可能溢出 `BIGINT`；在确认 `pilot_ticket.ticket` 为空后，已将该测试序列复位并改为显式 `BigInt(...)`
转换及原始序列状态恢复断言。其定向真实 PostgreSQL 回归为 4/4 通过。共享 Pilot PostgreSQL schema 的迁移类测试以串行方式执行，避免并行 DDL 相互等待。

这些用例不连接真实企业微信，也不停止 PostgreSQL。它们证明本机数据库、重试和错误边界；不证明真实群消息、真实断线恢复、
客户端显示或隔离数据库维护窗口中的故障恢复。

## 当前现场预检

执行：

```text
npm run p1:012:live-e2e:check
```

当前预检已通过：P1、出站 WSS、无公网监听、AI/OCR/Hospital 集成均保持在允许范围内。输出未包含数据库 URL、机器人
Secret、哈希密钥、群 ID 或用户 ID。

真实现场已记录以下脱敏事实：

- 出站 WSS 认证、主动断开和重认证已完成；这只证明连接恢复，不证明群消息或客户端显示；
- 一次性授权的群 ID 捕获已从测试账号 callback 更新本机 `PILOT_TEST_GROUP_ID`，证据仅含 keyed hash；
- 首次群文字 callback 已进入 Pilot Intake（33 ms），但输入不是明确报修，结果为 `WAITING_DESCRIPTION`、未创建 Ticket；
  同次旧版普通 `text` 被动回复得到 `WECOM_REPLY_REJECTED`，测试账号确认未显示。旧版未保留数值回执，不能事后把
  Gate 0 的 `40008` 误写为本次实测码；
- 已根据企业微信[回复消息（101836）](https://developer.work.weixin.qq.com/document/path/101836)改为完成流式回复并补充数值
  回执记录。修正后的下一窗口未收到匹配 callback，安全以 `P1_012_LIVE_TIMEOUT` 结束，未产生新的业务写入。
- 随后的三字符一次性回执探针进入 Pilot Intake（51 ms），因没有报修描述而保持 `WAITING_DESCRIPTION`、未创建 Ticket；
  完成流式回复记录 `provider_errcode=0`、`ACKED`，测试账号观察为 `VISIBLE`。该结果证明群 callback、回复协议和客户端显示，
  不能替代含明确报修语义的文字建单验收。
- 为避免短标记以子串方式意外进入 Intake，后续实现将它收敛为 `GROUP_REPLY_PROBE`：不建立数据库连接或写入任何 Pilot
  事实，并同时精确绑定 callback 机器人 ID、测试群和测试账号。企业微信[接收消息（101834）](https://developer.work.weixin.qq.com/document/path/101834)
  明确展示群聊 `body.text.content` 保留首部 `@机器人`；因此 callback 保留该前缀时探针只接受一个首部提及、一个普通 ASCII 空格及其后精确的 2–3 字符标记；仅适配层已省略前缀时接受裸标记，额外文字仍拒绝。旧版字面精确匹配窗口曾安全超时；修正版本的本机集成回归 37/37、全量串行回归 195/195 均通过。探针成功源结果追加与客户端观察的选源、复核及追加共用跨进程证据链声明，故不会在最终复核之后插入新的成功源结果；旧源在取得声明前被替换会安全返回 `P1_012_CLIENT_OBSERVATION_SOURCE_STALE`。早期真实测试群回环命中机器人/群/账号作用域和去前缀后的精确标记，完成流式回复记录 `provider_errcode=0`、`ACKED`，测试账号人工观察为 `VISIBLE`；其源记录早于逐次 `run_id`，故受控观察命令当时追加的脱敏记录仅保留历史事实。随后新一轮真实测试群回环产生了由随机运行熵导出的 HMAC `run_id`，完成流式回复再次记录 `provider_errcode=0`、`ACKED`，测试账号再次观察为 `VISIBLE`，且 `p1_012_client_display_observed` 以 HMAC 来源关联值独立记录。全程无数据库连接或业务写入。该结果是当前关联规则下的非写入显示证据，不替代文字建单、图片或试点 Go/No-Go。

完整文字演练已按明确、非敏感报修文本和新 token 完成，并形成 Ticket、提供方回执及 HMAC 关联的客户端观察；真实突发由后续独立运行证明，两项均不替代负责人批准。

## Go/No-Go 状态

`public_ip` 不是 P1-012 字段。企业微信出站 WSS 的网络范围仅为 DNS、TCP 443 和 TLS；公网入口只属于 HTTP/Webhook、
外部 Pilot Workbench 或独立公网 Web/API 网关。

项目负责人已于 2026-08-30 对完整证据明确批准 `GO`，因此 P1-012 与 Phase 1 状态均为 `DONE / GO`。

该结论只完成 Phase 1 退出判定。Phase 2 当前为 `NOT_STARTED`，必须获得新的、独立的项目负责人授权后方可开始；
本批准不等同于生产上线、临床生产使用、安全/运维变更、提交、推送、合并或发布批准。
