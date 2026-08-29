# P1-012 本机 E2E 接缝与 Go/No-Go 预验收记录

- 验收日期：2026-08-29
- 环境：Windows 本机、Node.js、Pilot PostgreSQL；不建立公网入站监听。
- 结论：本机受控实现通过；真实测试群 E2E 和客户端观察尚未执行，当前结论为 `NO_GO`。

## 已验证的本机范围

执行：

```text
npm run test:p1:012:integration
```

结果：13/13 通过，0 失败。其中带库用例经过真实的
`Inbox → Intake → Ticket → Outbox → Delivery` 组合，验证了：

- 同一 callback 的并发重复只形成一个 Ticket；
- 图片进入 `WAITING_DESCRIPTION`，不伪造 Ticket；
- 100 个唯一 callback 形成 100 个独立 Ticket，连同重复和 Outbox 场景共有 102 个受控 Ticket，均在 10 秒目标内；
- 受控发送器失败后，`notification.delivery_attempt` 记录 `RETRY_SCHEDULED`，Delivery 保持 `PENDING`，恢复后同一幂等 Delivery 变为 `SENT`；
- `AI_TRIAGE_ENABLED=false`、`OCR_ENABLED=false` 的核心路径保持可用；
- 抛出的数据库接缝错误只产生稳定的 `P1_012_CORE_OPERATION_FAILED`，不向回复或公开结果泄漏错误文本；
- 被动回复和主动投递均必须取得明确 `{ errcode: 0 }` 的提供方回执；缺失回执会保持为可重试失败；
- WSS 重连接缝、无公网监听配置和实时一进程授权均有隔离 fake-client 测试。

带库全量串行回归
`node --env-file=.env.pilot --test --test-concurrency=1 tests/*.test.mjs` 结果为 171/171 通过，0 失败。
共享 Pilot PostgreSQL schema 的迁移类测试以串行方式执行，避免并行 DDL 相互等待。

这些用例不连接真实企业微信，也不停止 PostgreSQL。它们证明本机数据库、重试和错误边界；不证明真实群消息、真实断线恢复、
客户端显示或隔离数据库维护窗口中的故障恢复。

## 当前现场预检

执行：

```text
npm run p1:012:live-e2e:check
```

当前得到稳定配置码 `P1_012_LOG_HASH_KEY_MISSING`。这表明 `.env.pilot` 尚未提供运行时安全日志哈希密钥；输出中没有
数据库 URL、机器人 Secret 或密钥值。该键必须由本机安全注入，不能写入本报告、Git 或聊天。补齐后，预检还要求配置
`PILOT_TEST_ACCOUNT_USER_ID`，以防将非测试成员的群消息纳入演练。

在该键补齐前，不启动真实 WSS/测试群运行。补齐后，仍须用一次性授权执行实际文字、图片降级和重连场景，并由测试账号观察
客户端回执与通知。

## Go/No-Go 状态

`public_ip` 不是 P1-012 字段。企业微信出站 WSS 的网络范围仅为 DNS、TCP 443 和 TLS；公网入口只属于 HTTP/Webhook、
外部 Pilot Workbench 或独立公网 Web/API 网关。

以下真实证据仍缺失，因此不得进入 Phase 2：

- 已配置测试群中的文字消息往返和客户端回执观察；
- 已配置测试群中的图片降级提示和客户端观察；
- 真实 WSS 断开后重认证及其后的文字回环；
- 获批测试账号/工具的实际群内 100 条突发；
- 隔离 Pilot PostgreSQL 的故障/恢复与实际 Outbox 故障演练；
- 试点负责人对完整证据的明确 Go/No-Go 批准。
