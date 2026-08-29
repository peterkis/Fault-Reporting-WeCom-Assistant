# 31. P1-012 Phase 1 E2E、故障演练与试点 Go/No-Go

- 状态：IN_PROGRESS（本机受控 E2E 接缝与 PostgreSQL 集成演练已实现；真实测试群消息往返、客户端观察、隔离数据库故障窗口和试点评审尚未完成）
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

经批准的测试群运行须使用一次性、非敏感 trigger token，并把实时授权只置于当前 PowerShell 进程：

```powershell
$env:P1_012_LIVE_TEST_APPROVED = 'true'
try {
  node --env-file=.env.pilot scripts/p1-012-live-e2e.mjs --live --scenario=group-text --trigger-token=<locally-generated-token> --timeout-ms=120000
} finally {
  Remove-Item Env:P1_012_LIVE_TEST_APPROVED -ErrorAction SilentlyContinue
}
```

在该运行已输出 `p1_012_live_e2e_ready` 后，测试账号在机器人可接收的已配置测试群中发送含 token 的非敏感文字；
观察者记录被动回执是否在客户端显示。图片降级使用 `--scenario=group-image-degraded`，由测试账号发送一张
非敏感图片，并观察“补充文字描述”的客户端提示。`--scenario=reconnect` 只验证 WSS 的主动断开和重认证，不能代替
消息回环或客户端观察。

实时脚本把脱敏事件追加到 `evidence/p1-012-live-e2e.jsonl`。该文件只在实际受控运行产生；不得预先伪造，且其中的
`p1_012_live_message_result` 或 SDK 成功事件都不等价于客户端已显示。

## 故障与性能演练

| 场景 | 最小判定 | 证据边界 |
|---|---|---|
| 文字 | 同一 callback 只生成一个 Ticket，10 秒目标内受理 | 测试群 callback、数据库事实、被动回复与客户端观察分别记录 |
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
100 条突发、Outbox 重试和 AI 关闭受控演练。它们证明本地实现和故障语义，不证明真实测试群回环、客户端显示、
外部 Workbench、HTTP/Webhook、生产公网边缘或临床试点。P1-012 保持 `IN_PROGRESS`，直至上述真实证据和评审结论齐备。
