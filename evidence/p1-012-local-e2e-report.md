# P1-012 本机 E2E 接缝与 Go/No-Go 预验收记录

- 验收日期：2026-08-29
- 环境：Windows 本机、Node.js、Pilot PostgreSQL；不建立公网入站监听。
- 结论：本机受控实现通过；真实测试群已完成 WSS 重认证、群 ID 捕获和一次旧版三字符客户端回执探针。该探针取得完成流式回复的 `errcode=0`，且测试账号确认客户端显示。它不含明确报修描述，未创建 Ticket；按企业微信群聊 `@` 回调格式修正后的非写入探针已完成历史回环，提供方回执为 `errcode=0`，测试账号确认客户端显示。该源回执早于当前逐次 HMAC `run_id`，故仅保留历史事实。随后已完成新的带 `run_id` 的真实回环、`errcode=0`、`ACKED` 与测试账号 `VISIBLE`，并写入独立 HMAC 来源关联观察记录。完整场景尚未验收，当前结论仍为 `NO_GO`。

## 已验证的本机范围

执行：

```text
npm run test:p1:012:integration
```

结果：37/37 通过，0 失败。其中带库用例经过真实的
`Inbox → Intake → Ticket → Outbox → Delivery` 组合，验证了：

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

下一次完整文字演练必须使用明确、非敏感报修文本和 6–128 字符的新 token，并由测试账号观察最终流式回执与 Ticket 创建结果。

## Go/No-Go 状态

`public_ip` 不是 P1-012 字段。企业微信出站 WSS 的网络范围仅为 DNS、TCP 443 和 TLS；公网入口只属于 HTTP/Webhook、
外部 Pilot Workbench 或独立公网 Web/API 网关。

以下真实证据仍缺失，因此不得进入 Phase 2：

- 含明确报修语义的测试群文字消息往返、Ticket 创建和客户端回执观察；
- 已配置测试群中的图片降级提示和客户端观察；
- 真实 WSS 断开后重认证及其后的文字回环；
- 获批测试账号/工具的实际群内 100 条突发；
- 隔离 Pilot PostgreSQL 的故障/恢复与实际 Outbox 故障演练；
- 试点负责人对完整证据的明确 Go/No-Go 批准。
