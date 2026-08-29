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

`processFirst` 只在成功插入新行的事务中执行一次。它接收 `channelMessageId`、标准 `message` 和只提供 `query(sql, values?)` 的事务视图；`sql` 必须是字符串，`values` 省略或为数组，并且只支持 Promise 调用形态，不接受 node-postgres callback/Query 重载。处理器不得执行网络调用或其他不可回滚副作用。事务视图拒绝 `BEGIN`、`COMMIT`、`ROLLBACK`、`SAVEPOINT` 等事务控制语句，提交和回滚只由 Inbox 拥有。

Inbox 在第一次异步等待前复制并验证请求，冻结传给处理器的标准消息；调用方随后修改原对象不能改变持久化事实或把 SDK 字段带入 JSONB。事务视图只在 `processFirst` 执行期间有效，处理器 settle 后立即撤销；保存该视图并在事务外调用会以 `TRANSACTION_VIEW_CLOSED` 拒绝。处理器发起的 Promise 查询在撤销前全部等待完成，未 `await` 的失败也按处理失败回滚。

SQL 防护识别语句间注释（含 CR/LF 行结束和嵌套块注释），拒绝 `SET`、`RESET`、`DISCARD`、`SET LOCAL/SESSION` 及直接 `set_config` 等已知事务/会话变更入口；Inbox 不会为了清理处理器行为而重置调用方拥有的池会话基线。`processFirst` 是受审查的一方内部模块，不是运行任意不可信 SQL 的沙箱；不得通过包装函数、会话锁或其他等价方式改变池会话状态。

处理结果必须是纯 JSON 对象数据树，不接受 `Date`、Buffer/TypedArray、Proxy、函数、访问器、循环引用、非有限数或其他依赖 `toJSON()` 转换的运行时对象。Inbox 从已验证的数据属性构造无原型中间快照，只序列化该快照；Proxy 或继承的 `toJSON` 不能替换已检查内容。Inbox 负责结构、可序列化性和 PostgreSQL 字符兼容性；`processFirst` 实现者仍负责语义脱敏，只能返回可公开重放的业务引用与字段。

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

迁移可在关键写入目录指纹匹配的既有结构上重复执行。每次执行在建留存索引前核对普通永久表、列集合、类型/空值/Identity/非生成属性、非延迟主键、非延迟 `(provider,msg_id)` 唯一键、精确的 1 个主键/1 个唯一约束/16 个检查约束、检查表达式和关键默认值；建索引后再确认它是有效、非唯一、无谓词/表达式的单列 btree 留存索引。若这些已列出的写入关键指纹缺失、被同名弱化或出现额外 CHECK/UNIQUE 限制，迁移以 `P1_003_SCHEMA_DRIFT_REMEDIATION_REQUIRED` 失败关闭，不把“`CREATE TABLE IF NOT EXISTS` 未报错”误当作验收成功。该检查不声称枚举 PostgreSQL 目录中的所有性能属性或数据库级权限策略。

## 隐私与留存

- 输入必须精确符合 P1-002 标准消息字段和 content/quote 形态；额外 SDK `body`、`response_url`、媒体 URL/AES Key 等字段不能混入持久化 JSONB；字符串必须是结构完整 Unicode 且不含 NUL；
- `rawPayload` 明文入口不存在；可选 `rawPayloadEncrypted` 只接受非空字节。Inbox 不负责生成或验证密码学密文，调用方必须在进入接口前使用批准的密钥管理和加密封装；
- `privacyClass` 必须是已定义分类，`retentionUntil` 必须显式提供、采用 PostgreSQL `timestamptz` 可接受的 ISO 偏移范围且晚于消息接收时间；确定性非法偏移在连接前拒绝，示例策略天数不是自动批准的正式制度；
- P1-003 只保存并索引到期事实，不实现到期删除 Worker、法定保留例外或备份生命周期；这些仍属于后续安全与运维任务；
- Inbox 自身生成的公共字段与错误不回显原文、密文字节、数据库 URL、底层数据库错误或凭据。`result` 是受信任 `processFirst` 提供的可重放快照；处理器必须先完成语义脱敏，Inbox 会拒绝二进制/运行时对象和不可存储字符，但不声称能从任意字符串推断秘密含义。

## 稳定错误

| code | retryable | 条件 |
| --- | --- | --- |
| `CHANNEL_INBOX_INVALID_INPUT` | `false` | 标准消息、隐私级别、留存时间、密文字节或处理器接口不合法。 |
| `CHANNEL_INBOX_UNAVAILABLE` | `true` | 无法取得 PostgreSQL 连接；处理器不会执行。 |
| `CHANNEL_INBOX_STORAGE_FAILED` | `true` | 插入、读取快照、完成更新或提交失败。 |
| `CHANNEL_INBOX_PROCESSING_FAILED` | `true` | 首次处理器失败、返回值不是纯 JSON 对象数据树，或试图控制 Inbox 事务。 |

错误只包含稳定 code、retryable 和可选的无敏感 reason，不包含底层异常原文。

## 运行与验收

```powershell
npm run p1:003:migrate
npm run test:p1:003:integration
node --env-file=.env.pilot --test tests/*.test.mjs
```

`npm run test:p1:003` 不加载本机 `.env.pilot`：它运行静态/失败契约并明确跳过需要数据库的场景，适合无数据库环境。正式的本机 P1-003 验收必须使用 `test:p1:003:integration`，不能把 skip 当作通过。

本轮本机 PostgreSQL 集成覆盖首次/重放、12 路并发、事务回滚、事务提前提交、注释变体、会话特征与 callback 重载防护、未等待查询 drain、事务视图撤销、调用方池基线保持、两个独立 Node 进程重启、不可用端口、不可变输入快照、Proxy/继承 `toJSON` 纯 JSON 快照、隐私/留存/密文字节、非法时区偏移、弱目录/缺列/生成列/额外约束失败关闭、同名弱化约束、延迟键、hash 留存索引、正确结构可重入和迁移范围；结果见 `evidence/p1-003-channel-message-inbox-report.md` 及后续审查修复记录。

## 后续边界

P1-003 只保证 Channel Message 和首次处理结果的事务幂等。该任务验收时，回调测试使用不代表工单的 opaque 合成结果，也没有创建 Service Intake 或 Ticket。项目负责人随后已单独授权 P1-004；其实现严格复用本事务接口完成消息聚合，未绕过 Inbox，也未把 Channel Message 合并为业务模型。
