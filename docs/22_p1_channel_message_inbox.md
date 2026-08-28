# 22. P1-003 Channel Message Inbox 与数据库幂等

- 状态：DONE（本机 PostgreSQL 集成验收；不构成公网或临床试点验收）
- 范围：只实现标准消息的 Channel Message 持久化、数据库唯一幂等、首次处理结果快照和稳定失败结果；不创建 Service Intake、Pilot Ticket、Event、Outbox、AI/OCR 或任何医院系统集成。
- 架构依据：`docs/04_domain_model.md`、`docs/09_data_model.md`、`docs/11_security_compliance.md` 和 P1-002 Normalized Message 契约。

## 输入与输出

公共接口：

```js
const inbox = createChannelMessageInbox({ pool });
const response = await inbox.accept({
  message,
  traceId,
  privacyClass,
  retentionUntil,
  rawPayloadEncrypted, // 可选，只接受调用方已经加密的字节
}, processFirst);
```

首次成功：

```json
{
  "ok": true,
  "duplicate": false,
  "channelMessageId": "123",
  "result": { "receipt_id": "opaque-result" }
}
```

重复成功时，`duplicate` 变为 `true`，`channelMessageId` 和 `result` 取自首个已提交事务。`req_id`、重放接收时间或当前进程内存均不参与业务幂等。

`processFirst` 只在成功插入新行的事务中执行一次。它接收 `channelMessageId`、标准 `message` 和只提供单语句 `query` 的事务视图；不得执行网络调用或其他不可回滚副作用。事务视图拒绝 `BEGIN`、`COMMIT`、`ROLLBACK`、`SAVEPOINT` 等事务控制语句，提交和回滚只由 Inbox 拥有。

## 数据库边界

可执行迁移只有 `database/migrations/001_p1_003_channel_message_inbox.sql`，创建：

```text
channel.message_inbox
```

它不实施旧的 `database/schema_draft.sql`，也不创建后续任务的表。核心约束包括：

- `BIGINT GENERATED ALWAYS AS IDENTITY` 主键；
- 精确唯一约束 `UNIQUE (provider, msg_id)`；
- `idempotency_key = provider || ':' || msg_id`；
- `create_time` 可空，`received_at` 独立必填；
- `normalized_message JSONB`、正文 `raw_text/clean_text` 与可选 `raw_payload_encrypted BYTEA`；
- `privacy_class`、必填 `retention_until` 和到期索引；
- 仅允许 `PROCESSING → COMPLETED`，完成行必须具有 JSON 对象结果快照和完成时间。

并发算法不使用进程内锁：首事务执行 `INSERT ... ON CONFLICT DO NOTHING`。相同唯一键的竞争事务由 PostgreSQL 等待首事务提交；首事务完成后，竞争者读取 `response_snapshot`。如果首次处理失败，插入和同事务业务写入一起回滚，重试可重新成为首次处理者。

## 隐私与留存

- 输入必须精确符合 P1-002 标准消息字段和 content/quote 形态；额外 SDK `body`、`response_url`、媒体 URL/AES Key 等字段不能混入持久化 JSONB；
- `rawPayload` 明文入口不存在；可选 `rawPayloadEncrypted` 只接受非空字节。Inbox 不负责生成或验证密码学密文，调用方必须在进入接口前使用批准的密钥管理和加密封装；
- `privacyClass` 必须是已定义分类，`retentionUntil` 必须显式提供且晚于消息接收时间；示例策略天数不是自动批准的正式制度；
- P1-003 只保存并索引到期事实，不实现到期删除 Worker、法定保留例外或备份生命周期；这些仍属于后续安全与运维任务；
- 公共成功/失败结果不回显原文、密文字节、数据库 URL、底层数据库错误或凭据。

## 稳定错误

| code | retryable | 条件 |
| --- | --- | --- |
| `CHANNEL_INBOX_INVALID_INPUT` | `false` | 标准消息、隐私级别、留存时间、密文字节或处理器接口不合法。 |
| `CHANNEL_INBOX_UNAVAILABLE` | `true` | 无法取得 PostgreSQL 连接；处理器不会执行。 |
| `CHANNEL_INBOX_STORAGE_FAILED` | `true` | 插入、读取快照、完成更新或提交失败。 |
| `CHANNEL_INBOX_PROCESSING_FAILED` | `true` | 首次处理器失败、返回值不是 JSON 对象，或试图控制 Inbox 事务。 |

错误只包含稳定 code、retryable 和可选的无敏感 reason，不包含底层异常原文。

## 运行与验收

```powershell
npm run p1:003:migrate
npm run test:p1:003:integration
node --env-file=.env.pilot --test tests/*.test.mjs
```

`npm run test:p1:003` 不加载本机 `.env.pilot`：它运行静态/失败契约并明确跳过需要数据库的场景，适合无数据库环境。正式的本机 P1-003 验收必须使用 `test:p1:003:integration`，不能把 skip 当作通过。

本轮本机 PostgreSQL 集成覆盖首次/重放、12 路并发、事务回滚、事务提前提交防护、两个独立 Node 进程重启、不可用端口、隐私/留存/密文字节和迁移范围；结果见 `evidence/p1-003-channel-message-inbox-report.md`。

## 后续边界

P1-003 只保证 Channel Message 和首次处理结果的事务幂等。该任务验收时，回调测试使用不代表工单的 opaque 合成结果，也没有创建 Service Intake 或 Ticket。项目负责人随后已单独授权 P1-004；其实现严格复用本事务接口完成消息聚合，未绕过 Inbox，也未把 Channel Message 合并为业务模型。
