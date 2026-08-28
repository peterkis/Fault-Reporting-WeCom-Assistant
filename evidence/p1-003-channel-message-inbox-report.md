# P1-003 Channel Message Inbox 与数据库幂等验收报告

- 任务：P1-003
- 日期：2026-08-28
- 状态：DONE（本机 PostgreSQL 集成验收）
- 验收边界：本机 Windows、Node.js 24、PostgreSQL 18、Pilot 专用本地数据库。
- 非验收范围：真实 WSS、公网安全边界、Service Intake、Pilot Ticket、通知、临床试点、留存删除 Worker、备份生命周期、Phase 1 Go/No-Go。

## 1. 授权与范围

项目负责人于 2026-08-28 明确要求“执行P1-003”。执行只覆盖 Channel Message Inbox、数据库唯一幂等和原结果快照；P1-004 保持 TODO。没有创建 Service Intake、Pilot Ticket、Ticket Event、Notification Outbox/Delivery、AI/OCR 或 Hospital Ticket Adapter，也没有访问医院 Tickets、SSO、Hub 或院内 Outbox。

`database/schema_draft.sql` 仍是不可直接实施的旧草案。本轮只应用独立迁移 `001_p1_003_channel_message_inbox.sql`。

## 2. 交付物

- `database/migrations/001_p1_003_channel_message_inbox.sql`：`channel.message_inbox`、精确 `(provider, msg_id)` 唯一约束、状态/结果/隐私/留存约束和留存索引；
- `src/p1-003-channel-message-inbox.mjs`：严格输入校验、事务 Inbox、并发冲突等待、原结果返回和稳定错误；
- `scripts/p1-003-migrate.mjs`：只读取 `PILOT_DATABASE_URL` 的无敏感输出迁移入口；
- `tests/p1-003-channel-message-inbox.test.mjs`：公共 Inbox seam 的静态及真实 PostgreSQL 测试；
- `tests/fixtures/p1-003-inbox-worker.mjs`：真实跨进程重启验证 Worker；
- `docs/22_p1_channel_message_inbox.md`：接口、事务、隐私、留存和后续边界说明；
- `package.json` / `package-lock.json`：锁定 `pg@8.23.0` 和 P1-003 命令入口。

## 3. TDD 记录

先建立首个持久化/重放测试，因 `src/p1-003-channel-message-inbox.mjs` 不存在而红灯；补最小迁移和事务实现后转绿。随后按场景加入并发、回滚、真实进程重启、数据库不可用和输入隐私测试。

事务提前提交测试首次得到错误的成功结果，证明处理器可以直接 `COMMIT`；实现事务视图防护后，该测试转绿且没有残留 Inbox 行。失败证据未被改写成通过结论。

## 4. 定向集成结果

命令：

```text
node --env-file=.env.pilot --test tests/p1-003-channel-message-inbox.test.mjs
```

结果：

```text
tests 9 | pass 9 | fail 0 | skipped 0
```

| 场景 | 结果 | 核心观察 |
| --- | --- | --- |
| 首次与顺序重放 | PASS | 只保存一行；重复回调不执行；原 `channelMessageId/result` 返回。 |
| 12 路并发重复 | PASS | 首次处理 1 次；1 个首次结果、11 个重复结果；数据库 1 行。 |
| 首次处理失败 | PASS | Inbox 插入回滚为 0 行；下一次投递以首次请求成功。 |
| 事务控制防护 | PASS | 回调 `COMMIT` 被拒绝；整个事务回滚，无半完成记录。 |
| 真实进程重启 | PASS | 首进程关闭后，第二个独立 Node 进程返回数据库中的原结果。 |
| 数据库暂时不可用 | PASS | 连接本机不可用端口返回 `CHANNEL_INBOX_UNAVAILABLE`；回调 0 次；无连接信息泄露。 |
| 输入与隐私失败 | PASS | 非契约字段、明文 payload、非法分类/留存/密文均在连接前拒绝。 |
| 隐私/留存持久化 | PASS | 合成密文字节、`PATIENT_SENSITIVE` 和到期时间按原值保存，结果不回显密文。 |
| 迁移范围 | PASS | 只创建 `channel.message_inbox`；无 P1-004+ 表；无 `VARCHAR`。 |

## 5. 数据库与回归核验

迁移命令：

```text
npm run p1:003:migrate
{"ok":true,"task":"P1-003","migration":"001_p1_003_channel_message_inbox","relation":"channel.message_inbox"}
```

数据库目录核验：

```json
{"unique_constraint_count":1,"leftover_test_rows":0}
```

全量本机回归：

```text
node --env-file=.env.pilot --test tests/*.test.mjs
tests 77 | pass 77 | fail 0 | skipped 0
```

补充门禁：新建 JavaScript 文件语法检查、8 个 JSON 文件解析、P1-003 定向敏感值扫描和 `git diff --check` 均通过；`diff --check` 仅报告工作区既有的 LF/CRLF 转换提示。默认 npm 镜像的审计端点先返回 `404 NOT_IMPLEMENTED`，该结果不能解释为安全通过或漏洞；改用 npm 官方 registry 重试后得到 `found 0 vulnerabilities`。

无数据库命令 `npm run test:p1:003` 的结果为 3 个静态/失败契约通过、6 个真实数据库场景明确 skip；该结果不替代上述 9/9 集成验收。

## 6. 隐私与证据限制

- 测试只使用合成 userid、消息、trace、密文字节和结果；
- `.env.pilot` 仅由 Node 进程读取，命令、测试和证据没有输出数据库 URL、用户名或密码；
- Inbox 拒绝额外 SDK 字段和明文 `rawPayload`，但不会判断任意字节是否真的由批准算法加密；调用方加密和密钥管理仍需 P1-011 完成；
- `retention_until` 已持久化并建立索引，但自动删除、删除审计、法定保留例外和备份生命周期未实现，不得宣称留存闭环已验收；
- 本机 PostgreSQL 结果不构成公网、真实企业微信链路、临床使用或 Phase 1 Go/No-Go。

## 7. 结论与下一边界

P1-003 满足“同一消息只保存一次且不产生重复业务处理”的本机数据库验收条件，状态更新为 DONE（本机 PostgreSQL 集成验收）。P1 保持 IN_PROGRESS；下一候选任务为 P1-004，但尚未启动，也没有由本报告授权。
