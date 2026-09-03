# P2-007 时间契约迁移说明

本文记录 P2-007 v1.2 设计资产在 `phase2/p2-007-hospital-it-domain` 上继承 ARCH-005 的方式。本次时间兼容契约版本为 `v1.2.1`。本次工作仅迁移 Design Contract，不实现 Runtime，不创建 `src` 或数据库 migration，不连接 DeepSeek、企业微信或其他真实依赖，也不修改 Ticket。

## 继承的时间类型

P2-007 的业务日期时间统一为 Asia/Shanghai LocalDateTime：

```text
YYYY-MM-DD HH:mm:ss
```

所有非空 LocalDateTime 字段直接引用 `contracts/local_datetime.schema.json`。可空字段使用包含该 `$ref` 与 `null` 的 `anyOf`。禁止 `format: date-time`、`T`、`Z`、`UTC`、offset、IANA timezone 和小数秒。

适用字段包括 `reported_at`、`occurred_at`、`observed_at`、`fetched_at`、`issued_at`、`expires_at`、`consumed_at`、`revoked_at`、`first_seen_at`、`last_seen_at`、`opened_at`、`closed_at`、`started_at`、`ended_at`、`valid_at`、`valid_from`、`valid_to` 和 `complete_through`。

## PhysicalEpochMs expiry

continuation expiry 和 reporter timeline action expiry 使用 `expires_epoch_ms` 作为权威物理期限，并引用 `contracts/epoch_ms_string.schema.json`。`expires_at` 仅是同一秒的本地业务显示/审计值，不单独承担 expiry 判断：

- `p2_007_continuation_ref.schema.json` 要求同时提供 `expires_at` 和 `expires_epoch_ms`；
- `p2_007_reporter_timeline_action.schema.json` 使用成对依赖约束，两个字段同时出现或同时省略；可空时两者必须保持一致的空值语义；
- API/TypeScript 中 epoch ms 始终为 string，禁止转换为 JavaScript Number。

## TypeScript 与 Fixture

`contracts/p2_007_decision_contracts.d.ts` 的所有业务时间字段声明为 `LocalDateTime`，期限锚点声明为 `PhysicalEpochMs`；两者均是 string 品牌类型，禁止 `Date`。P2-007 Fixture 中的本地业务时间统一为 `YYYY-MM-DD HH:mm:ss`；UTC 样例先转换为同一物理时刻的上海本地时间，不保留 `Z` 或 offset。

已导入的 `evidence/p2-007-corpus-metrics.json` 是先前语料分析的历史 Evidence，保留其原始来源时间文本，不作为 Domain、API、Contract 或 Fixture 的 LocalDateTime 输入。

## 同秒顺序

业务时间不承担唯一排序职责。同一业务秒内必须使用 `sequence_no`、`ordinal`、`revision` 或 `event_id` 等显式顺序字段；禁止依赖 timestamp 微秒/毫秒、插入顺序或数据库物理顺序。确定性升序为业务时间后跟显式顺序字段。

## 迁移结果与边界

- P2-007 JSON Schema 中 25 处 `format: date-time` 已迁移为共享 LocalDateTime 引用；
- continuation 和 timeline action 已补充权威 `expires_epoch_ms` Contract；
- Fixture 中的 UTC/offset 时间样例已转换为上海本地秒；
- P2-007 TypeScript declaration 中 `Date` 数量为 0；
- 本轮没有实现或授权 P2-007 Runtime、DeepSeek、企业微信发送、Incident 创建、Ticket 修改或 Feature Flag 启用。
