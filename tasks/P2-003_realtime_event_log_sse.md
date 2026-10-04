# P2-003 Realtime Event Log、SSE 补放与慢客户端治理

> 历史范围：下文描述 P2-003 当时独立任务。全仓串行与现场验收要求保留历史身份，不是本轮类型迁移的默认测试清单；业务契约、权限与原验收结论继续保留。

- 状态：DONE
- 完成日期：2026-08-31
- 完成 Evidence：`evidence/p2-003-realtime-event-log-sse-report.md`
- 授权日期：2026-08-30
- 授权 Evidence：`evidence/p2-003-start-authorization.md`
- 基线提交：`d59de5d7db39c4a39f82093496a0e42565d67a7e`
- Lane：P2-A
- 目标 Gate：P2-G1（本任务不启动 Assembly Gate）
- 依赖：P2-001；只读采用 P2-002 安全 Item View

## 输入

- 冻结的 P2-001 Thread、Session、Item Contract；
- P2-002 安全 Item View 与合成 Session/Timeline fixture；
- 版本化、纯 JSON、边界明确的 Realtime Event Command；
- 由未来应用层注入的 authentication 与 authorization descriptor。

## 输出

- 追加式持久 Realtime Event Log 与安全 Public Event View；
- 支持 Last-Event-ID 的授权补放查询；
- 原生 HTTP SSE handler、心跳、慢客户端隔离和恢复轮询；
- 容量、禁用、补放缺口与临时不可用的 polling fallback contract；
- 仅删除连续过期前缀且单调推进 retention floor 的受控清理工具。

Realtime Event Log、SSE 和进程内 Wakeup Hub 均不是业务事实源；它们不得拥有 Ticket、
Conversation、Channel Message、Service Intake 或 Delivery 状态。

## Contract 与 Schema

- 新增 Realtime Event JSON Schema、Fallback JSON Schema 和 TypeScript 声明；
- 命令只接受有界 plain JSON；拒绝 Proxy、accessor、symbol、`toJSON`、非 plain prototype、
  prototype pollution、超深/超宽/超长值；
- `event_id`、aggregate version 和 cursor 通过规范十进制字符串公开，禁止 Number 精度丢失；
- Public Event View 不暴露 publisher 配置、source identity、key/hash、授权 scope id、原始标识、
  provider 响应、凭据、内部备注或安全内容；
- 冻结事件词汇，但 P2-003 只实现 Conversation Item、Session 与 Timeline Rebuild fixture mapper。

## 数据库变更

新增且只新增 migration 012：

- `conversation.realtime_event`：identity `event_id`、唯一 `event_key`、不可变 payload/hash、
  aggregate/scope/visibility/occurred/expires/created 字段及补放/授权/留存索引；
- `conversation.realtime_stream_state`：每 stream 的单调 `retention_floor_event_id`；
- 事务化、可重入、失败关闭的完整漂移检查；无 trigger、持久函数或既有表修改；
- identity 序列缺口是正常并发/回滚结果，不表示 replay gap。

## 运行时规则

- `event_key` 覆盖规范 source identity 与授权 scope；`event_hash` 覆盖不可变事件语义；
- 同 key 同 hash 返回 `REPLAYED`；同 key 异 hash稳定冲突且不覆盖；`expires_at` 只可缩短；
- append 接受 caller-owned transaction，绝不自行 commit/rollback；独立 Store seam 可自管事务；
- Flag 关闭时不得访问数据库、占用客户端或启动 timer；
- replay 先锁定 durable high watermark，再分批读取；自然 identity 缺口不是 retention gap；
- 缺少授权 descriptor 默认拒绝；SQL scope clipping 后再次做 defense-in-depth；
- Wakeup Hub 只减少延迟，5 秒 recovery poll 保证错过 wakeup 或进程重启后仍从 PostgreSQL 补放；
- SSE 最多 32 客户端，heartbeat 20 秒，默认 batch 50/最大 200，buffer 64 KiB，drain timeout 5 秒；
- 单个慢客户端只关闭自身，不能阻塞 append 或其他客户端；无进程级无界事件队列；
- retention 默认 168 小时；apply 需 `P2_003_RETENTION_CLEANUP_APPROVED=true`，删除与 floor 推进同事务。

## 安全与隐私

- 认证失败保持 401/403，不降级成匿名 fallback；
- Restricted Admin 与 SYSTEM 事件均需显式授权；不存在 wildcard；
- 错误、日志、CLI 与返回值只包含稳定错误码、安全 ID、状态和计数；
- 禁止输出 SQL、数据库 URL、payload、scope 列表、凭据、patient/内部内容；
- SSE event name、id 和单行 JSON data 必须拒绝 CR/LF 注入。

## Unit / Contract / Integration 验收

- Unit/Contract 覆盖 Schema、纯 JSON、canonicalization、idempotency、hash/version、mapper 裁剪、
  cursor、authorization、SSE frame/headers、heartbeat、fallback、Flag off、slow-client 与 retention；
- PostgreSQL Integration 覆盖 migration 012 reentry/drift、真实并发 replay/conflict、caller transaction、
  授权 SQL 裁剪、high watermark、cursor ahead/gap/自然洞、32/33 clients、backpressure、restart、
  missed wakeup recovery poll、contiguous-prefix retention、失败回滚与数据库残留；
- 回归 P2-001、P2-002、P1-011、P1-012、V1.4 architecture 与全仓串行测试；
- 不得用 skip 绕过 P2-003 核心验收。

## 2C4G 资源上限

单 App/API/SSE 进程；共享小型 PostgreSQL pool；测试 pool 不超过 4；客户端上限 32；replay 最大
200/批次默认 50；无新增依赖、Redis、消息队列、常驻 Scheduler 或重型服务。记录 32 客户端 heap
分段、趋势与查询批次数，证明无持续增长。

## Feature Flag、回滚与关闭

`CONVERSATION_REALTIME_SSE_ENABLED=false` 和 `CONVERSATION_CENTER_ENABLED=false` 始终保持默认关闭。
关闭 Flag 必须零 DB/零客户端/零 timer 并返回安全 fallback。回滚方式为保持 Flag 关闭、停止调用
append/SSE/cleanup；migration 012 的追加表保留以便审计，不删除或改写既有 P1/P2 数据。

## Evidence 与完成线

完成 Evidence 写入 `evidence/p2-003-realtime-event-log-sse-report.md`，包含命令、通过/失败/取消数、
迁移/事务/授权/补放/容量/资源/残留结论和未验证边界。只有全部验收通过后才能把本任务改为 DONE。

项目负责人正式、独立授权启动 P2-003。完成 P2-003 后必须停止。
P2-004 及以后任务、P2-G1 组装和所有生产功能仍须另行授权。
