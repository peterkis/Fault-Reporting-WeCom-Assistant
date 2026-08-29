# 31. P1-012 Phase 1 E2E、故障演练与试点 Go/No-Go

- 状态：IN_PROGRESS（本机受控 E2E 接缝与 PostgreSQL 集成演练已实现；测试群已完成一次旧版短客户端回执探针、一次历史非写入显示观察，以及一次带逐次 HMAC `run_id` 的非写入短回执显示闭环；完整文字建单、图片、故障窗口和试点评审尚未完成）
- 运行时接缝：`createPilotE2EHandler(...)`、`createPilotOperationalIntake(...)`、`createNotificationDeliveryWorker(...)`、`scripts/p1-012-live-e2e.mjs`
- 不改变事实源：所有受理仍只写入 `Pilot Ticket Core`；不接入 Hospital Tickets、医院 SSO、医院 Hub、院内 Outbox、AI 或 OCR。

## 真实验证前提与网络边界

P1-012 使用企业微信**出站 WSS 长连接**。其真实验证前提是：

1. 主机可稳定出站访问企业微信 WSS，且 DNS、TCP 443 与 TLS 均可用；
2. 已在本机受控配置机器人、测试群和测试账号；
3. 本机 Pilot PostgreSQL 以及 `Inbox → Intake → Ticket → Outbox` 和发送器均健康；
4. 测试群已获准执行文字、图片降级、突发、断线与故障演练。

长连接接收和回包不需要公网 IP、入站端口或公网反向代理。`PILOT_LISTEN_HOST=127.0.0.1` 与
`PILOT_PUBLIC_EDGE_APPROVED=false` 可以保持不变。

只有下列独立场景才需要公网入口或公网 IP，并且须另行进行边缘与安全审批：

- 企业微信改用回调 HTTP/Webhook 模式；
- 让外部人员访问本机 Pilot Workbench；
- 部署独立的公网 Web/API 网关。

因此，`P1_012` 的真实 Go/No-Go 输入是测试群中的消息往返及客户端观察，而不是公网 IP 是否存在。

## 验收接缝与证据分层

```text
企业微信测试群回调
  → P1-012 scoped handler
  → SDK Adapter
  → Inbox → Intake → Ticket → Outbox
  → 被动回复 / 受控 Delivery
  → 企业微信客户端观察
```

`createPilotE2EHandler(...)` 只接收配置测试群中 allowlist 测试账号的 callback；文字场景还要求每次运行的非敏感 trigger token。
图片降级场景只接收该测试账号的图片 callback。其公开结果只含场景、稳定状态/错误码、耗时判定与投递状态，不能包含
群 ID、用户 ID、原始文字、媒体 URL/AES Key、工单号、数据库 URL 或 Secret。

对消息 callback，企业微信[回复消息（101836）](https://developer.work.weixin.qq.com/document/path/101836)规定使用
`aibot_respond_msg` 的流式消息或模板卡片；普通 `text` 只属于进入会话欢迎语。P1-012 因此使用一次完成的
`stream` 回复：复用当前 callback 的 `req_id`、生成唯一 `stream.id` 并设 `finish=true`。每次结果记录
`operation=aibot_respond_msg_stream`、数值 `provider_errcode` 与 `ACKED`/`REJECTED`/`UNKNOWN`，但绝不记录
`errmsg` 或原始 `req_id`。SDK 的瞬时 `error` 只记录稳定错误码并继续等待自动重连或运行超时，不能抢占为伪失败结论。

企业微信[接收消息（101834）](https://developer.work.weixin.qq.com/document/path/101834)的群聊文本示例显示 `body.text.content`
保留首部 `@机器人`。因此短回执探针将该单一寻址前缀视为协议外壳：仍须 `body.aibotid`、测试群和测试账号全部精确匹配，
并且探针自身只接受一个首部提及、一个普通 ASCII 空格及其后精确的 2–3 字符标记；裸标记也可用于平台已省略该前缀的回调。
任何额外文字、第二个提及、错误机器人、错误群或错误账号都不会触发回复或业务写入。

证据必须按下列层次记录，不能互相替代：

| 层次 | 可证明内容 | 不能证明内容 |
|---|---|---|
| WSS/SDK 事件 | 出站连接、认证、断开和重认证 | 测试群消息或客户端显示 |
| Pilot 数据库与安全日志 | Inbox、Intake、Ticket、Outbox、Delivery 与重试事实 | 企业微信客户端可见性 |
| 提供方回执 | 被动回复/主动投递请求获接受 | 用户实际看到的消息 |
| 测试账号客户端观察 | 回执、降级提示和通知是否显示 | 全量吞吐、长期稳定性或生产就绪 |

## 受控执行

先在本机 `.env.pilot` 安全注入非空 `PILOT_LOG_IDENTITY_HASH_KEY` 与测试账号的
`PILOT_TEST_ACCOUNT_USER_ID`，但绝不粘贴哈希密钥值到终端、证据或工单。
预检只校验 Pilot 配置和无公网入口要求，不建立 WSS 连接：

```powershell
npm run p1:012:live-e2e:check
```

若 `PILOT_TEST_GROUP_ID` 未知或疑似错误，可只在本机使用一次性 token 捕获。该操作要求本进程明确批准，且仅会
替换 `.env.pilot` 中已有的 `PILOT_TEST_GROUP_ID=` 一行；原始群 ID 不打印、不进入证据，证据只保留 keyed hash：

```powershell
$env:P1_012_GROUP_ID_CAPTURE_APPROVED = 'true'
try {
  node --env-file=.env.pilot scripts/p1-012-live-e2e.mjs --capture-test-group-id --apply --trigger-token=<locally-generated-token> --timeout-ms=180000
} finally {
  Remove-Item Env:P1_012_GROUP_ID_CAPTURE_APPROVED -ErrorAction SilentlyContinue
}
```

在 `p1_012_group_id_capture_ready` 后，获批测试账号必须在目标群发送含 token 的非敏感文字。仅
`p1_012_group_id_capture_applied` 才说明本机配置已更新；它不证明回复、工单或客户端显示。
若失败记录含 `side_effect_state=IN_FLIGHT_UNKNOWN` 与 `reconciliation_required=true`，则 callback 对应的脱敏
群哈希已知，但超时或取消时本机配置最终是否已写入不可确定；不得据此启动业务场景。应先核对本机
`PILOT_TEST_GROUP_ID`，再以新 token 重做捕获；只有新的 `p1_012_group_id_capture_applied` 才能结束该对账状态。

文字建单、图片降级和群 ID 捕获须使用 6–128 字符的一次性、非敏感 trigger token，并把实时授权只置于当前 PowerShell 进程：

```powershell
$env:P1_012_LIVE_TEST_APPROVED = 'true'
try {
  node --env-file=.env.pilot scripts/p1-012-live-e2e.mjs --live --scenario=group-text --trigger-token=<locally-generated-token> --timeout-ms=120000
} finally {
  Remove-Item Env:P1_012_LIVE_TEST_APPROVED -ErrorAction SilentlyContinue
}
```

在该运行已输出 `p1_012_live_e2e_ready` 后，测试账号在机器人可接收的已配置测试群中发送含 token 的明确、非敏感
报修文字（例如 `新报修：P1-012 测试终端无法登录，请处理。<token>`）；观察者记录完成流式被动回执是否在客户端显示。
如只需确认 callback、完成流式回复和客户端显示，可使用独立的 **回执探针**。它仅接受配置机器人、测试群和 allowlist
测试账号的 callback；若 callback 保留一个首部 `@机器人`，仅在去除该寻址前缀及一个普通 ASCII 空格后完全等于 2–3 字符标记时匹配；
只有官方 callback 适配层已省略该寻址前缀时才接受裸标记。现场测试群仍发送 `@机器人 <marker>`。它不建立数据库连接，
也不写入 Inbox、Intake、Ticket、Outbox 或 Delivery：

```powershell
$env:P1_012_LIVE_TEST_APPROVED = 'true'
try {
  node --env-file=.env.pilot scripts/p1-012-live-e2e.mjs --live --scenario=group-reply-probe --trigger-token=<2-or-3-character-marker> --timeout-ms=120000
} finally {
  Remove-Item Env:P1_012_LIVE_TEST_APPROVED -ErrorAction SilentlyContinue
}
```

该模式是非写入的显示探针，不得被记作 Ticket 创建、文字场景或 Go/No-Go 通过。每次运行只对首个精确匹配 callback
回复；重放或第二条匹配消息被忽略，避免重复客户端回执。若到达硬超时，终态会记录
`side_effect_state=IN_FLIGHT_UNKNOWN`，且之后的晚到 SDK 结果不会再追加成功证据；该记录不能被解释为客户端显示。
图片降级使用 `--scenario=group-image-degraded`，由测试账号发送一张
非敏感图片，并观察“补充文字描述”的客户端提示。`--scenario=reconnect` 只验证 WSS 的主动断开和重认证，不能代替
消息回环或客户端观察。

实时脚本把脱敏事件追加到 `evidence/p1-012-live-e2e.jsonl`。该文件只在实际受控运行产生；不得预先伪造，且其中的
`p1_012_live_message_result` 或 SDK 成功事件都不等价于客户端已显示。仅在该次成功的、首部提及回执探针后，测试账号已明确
确认显示时，才能由同一受控脚本运行下列命令：每个新探针结果都带有仅由随机运行熵导出的 HMAC `run_id`，因此命令只会读取
最新、带有效 32 位 `run_id` 的成功 `GROUP_REPLY_PROBE`，以其 HMAC 关联值追加一条 `p1_012_client_display_observed`，且不重新
连接 WSS、不连接数据库、不写业务事实。不得手工编辑 JSONL，也不得把旧探针的观察关联到新的成功回执。

```powershell
$env:P1_012_LIVE_TEST_APPROVED = 'true'
try {
  node --env-file=.env.pilot scripts/p1-012-live-e2e.mjs --record-client-observation=VISIBLE --scenario=group-reply-probe
} finally {
  Remove-Item Env:P1_012_LIVE_TEST_APPROVED -ErrorAction SilentlyContinue
}
```

该命令只接受 `VISIBLE`，并拒绝无成功来源、缺少 `run_id` 的旧来源、来源在取得证据链声明前已被新的成功探针替代
（`P1_012_CLIENT_OBSERVATION_SOURCE_STALE`）或同一来源的重复观察。`GROUP_REPLY_PROBE` 的成功源结果追加与观察的
选源、复核及追加共用临时目录中的跨进程证据链独占声明：竞争观察安全返回
`P1_012_CLIENT_OBSERVATION_CLAIM_IN_PROGRESS`；竞争的 live 探针不追加新的成功源结果，并以
`P1_012_REPLY_PROBE_EVIDENCE_CLAIM_IN_PROGRESS` 在调用被动回复前失败闭合，因此不会产生无源回执。声明内仍有按来源的独占检查以拒绝重复观察。
`p1_012_client_display_observed` 才是本项客户端可见性的唯一关联证据，仍不能替代其他 Go/No-Go 场景。已产生但没有 `run_id` 的历史源记录不得回填；其
测试账号显示结论只作为历史观察保留。2026-08-29 已另行完成一次带有效 `run_id` 的真实测试群回环及 `VISIBLE` 观察记录，
满足本探针的当前关联规则。

该跨进程声明文件本身写入随机 owner、PID、主机名和创建时间；这些本机临时元数据不会进入现场证据。正常完成和硬超时都会释放声明。若进程异常退出或
本机删除失败留下声明，live/观察命令会继续以 `*_CLAIM_IN_PROGRESS` 失败闭合，绝不能手工无条件删除。只有确认没有 P1-012 live 或观察命令在运行后，
才可使用下列**显式、受控、审计**恢复：它要求双重一次性环境批准、至少 60 秒的阈值、同一主机、可解析的声明元数据以及原 owner PID 已确认不存活。
恢复 guard 以 `wx` 原子创建；普通 live/观察在取得证据链声明前后均把 static/dynamic recovery guard、遗留 prepare 及 quarantine 标记视为阻塞。
经验证已死亡的 guard 可原子移至带接管 PID、时间和随机 owner 的动态标记，因同一 source 只能被移动一次，第二个恢复命令会失败闭合。恢复先把异常
声明原子移入 quarantine，追加不含路径、主机名、PID 或 owner 的 `p1_012_reply_probe_evidence_claim_quarantined` 审计，再删除 quarantine；**仅删除成功后**
追加 `p1_012_reply_probe_evidence_claim_recovered`。删除失败会保留一个 guard 和该 guard owner 对应的一个 quarantine；在阈值后以同一双重批准重跑可受控续跑。若 guard 元数据不可解析、
存在多个 recovery guard、多个 quarantine，或 quarantine 不属于当前 guard owner，或删除后最终审计无法写入，则以稳定的 `*_GUARD_STATE_INVALID` 或 `*_RECONCILIATION_REQUIRED` 停止并继续阻塞。此时记录
脱敏失败码和目录状态，交由获授权的运维对账；运行时不得猜测 owner、更不能手工删除后继续现场测试。任何 `OWNER_ACTIVE`、`OWNER_HOST_MISMATCH`、
`NOT_STALE` 或审计失败同样必须停止。

```powershell
$env:P1_012_LIVE_TEST_APPROVED = 'true'
$env:P1_012_REPLY_PROBE_CLAIM_RECOVERY_APPROVED = 'true'
try {
  node --env-file=.env.pilot scripts/p1-012-live-e2e.mjs --recover-stale-reply-probe-claim --apply --stale-claim-min-age-ms=300000
} finally {
  Remove-Item Env:P1_012_REPLY_PROBE_CLAIM_RECOVERY_APPROVED -ErrorAction SilentlyContinue
  Remove-Item Env:P1_012_LIVE_TEST_APPROVED -ErrorAction SilentlyContinue
}
```

`p1_012_reply_probe_evidence_claim_quarantined` 只表示活跃声明已隔离，绝不是移除成功或 E2E 证据；仅
`p1_012_reply_probe_evidence_claim_recovered` 才表示声明已被受控移除。两者都是本机恢复审计，不是消息回环、客户端显示、Ticket 创建或 Go/No-Go 证据。

## 故障与性能演练

| 场景 | 最小判定 | 证据边界 |
|---|---|---|
| 文字 | 同一 callback 只生成一个 Ticket，10 秒目标内受理；完成流式回复取得 `errcode=0` | 测试群 callback、数据库事实、被动回复与客户端观察分别记录 |
| 图片降级 | 记录 `WAITING_DESCRIPTION`，不虚构 Ticket | 图片 callback、数据库与客户端提示 |
| 100 条突发 | 100 个唯一消息 ID 无漏单、无重复单，受理均在目标内 | 本机集成演练不替代获批测试账号/测试工具的真实群内突发 |
| 断线 | 认证后断开，重连并再次认证 | WSS 事件；随后另做文字回环验证 |
| PostgreSQL 故障 | 已入库事实不丢失，恢复后按幂等键补建/对账 | 只能在隔离 Pilot 数据库或明确维护窗口演练；不得停止共享数据库 |
| Outbox 故障 | Delivery Attempt 记录 `RETRY_SCHEDULED`，恢复后同一幂等投递可追溯 | `PENDING` 只表示队列待发，不能误写为已完成重试 |
| AI 关闭 | `AI_TRIAGE_ENABLED=false`、`OCR_ENABLED=false` 时核心链路仍可受理 | Phase 1 核心证据；不启动 P2 功能 |

## Go/No-Go 判定

`evaluatePilotGoNoGo(...)` 要求以下全部为真：WSS 已认证、测试群已配置、Pilot 运行时就绪、文字回环、图片降级、
100 条突发、重连、数据库故障、Outbox 故障、AI 关闭、零漏单、零重复单、10 秒目标、状态/事件一致、通知可追溯、
客户端观察和项目负责人批准。任何一项未满足均为 `NO_GO`；其中 `client_observation` 或 `pilot_owner_approved` 缺失始终阻塞试点结论。

`public_ip` 不是判定字段。所有字段齐备后仍须由项目负责人另行批准，才可启动 Phase 2；本文件、自动化测试或一次
测试群运行都不自行授权下一阶段。

## 当前验收边界

当前已覆盖 scoped handler、配置预检、无公网监听的 WSS 重连接缝，以及真实 Pilot PostgreSQL 的重复消息、图片降级、
100 条突发、Outbox 重试和 AI 关闭受控演练。旧版文字场景中的一次短标记曾取得完成流式回复 `errcode=0` 和测试账号的客户端显示观察，
但只形成 `WAITING_DESCRIPTION`。此前独立回执探针按原文逐字精确匹配而在真实群聊 `@机器人` 前缀下安全超时；现已依照 101834
收敛为机器人/群/账号作用域、一个普通 ASCII 空格及去寻址前缀后的精确标记匹配，并通过本机集成与全量串行回归。早期修正后的
真实测试群回环取得完成流式回复 `provider_errcode=0`、`ACKED` 和测试账号人工 `VISIBLE`，但源回执早于逐次 `run_id`
机制，故其脱敏观察记录只保留为历史事实。随后新一轮真实测试群回环取得带有效 `run_id` 的完成流式回复
`provider_errcode=0`、`ACKED`，测试账号再次观察为 `VISIBLE`，并由 `p1_012_client_display_observed` 以 HMAC 来源关联值独立记录；
两次探针均没有数据库连接或业务写入。它们证明本地实现、
短回执协议和故障语义，不证明完整文字建单、图片降级的客户端提示、
外部 Workbench、HTTP/Webhook、生产公网边缘或临床试点。P1-012 保持 `IN_PROGRESS`，直至剩余真实证据和评审结论齐备。
