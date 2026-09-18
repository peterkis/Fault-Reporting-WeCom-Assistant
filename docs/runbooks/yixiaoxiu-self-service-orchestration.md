# YXX-SS-004 本地规则处理手册

本手册覆盖网页自助报修在本地隔离环境中的 `T_accept` 与 `T_process`。
033 保持不可变；既有数据库的单聊来源修正由后续迁移 034 前向完成。
真实 OAuth、企业微信 SDK、生产数据库、发送和云端发布均不在本手册范围内。

## 受保护命令边界

网页写入必须经过 `src/yxx-self-service-command.mjs` 的
`createYxxMemberCommandContext`。认证适配器返回受保护的 profile、
canonical member binding、corp/app scope、proof 和 CSRF 事实；表单不能提交
这些值。写入只接受 `MEMBER_SELF_SERVICE`（或获准的 FULL profile），并要求
`YIXIAOXIU_SELF_SERVICE_ENABLED=true`、`write_flag=true`、匹配的
`Idempotency-Key`/CSRF 和标记为 `localOnly` 的成员配额依赖。

`MEMBER_TICKET_READONLY`、`OAUTH_ONLY`、缺少开关或认证映射时在进入存储前拒绝。
配额检查由接受事务在幂等回执查重之后调用：已有同 ID 同内容回放不再次消耗配额，
同 ID 异内容仍返回冲突。

## 两个事务

`T_accept` 在一个短事务中完成 scope 锁、回执、`service_intake`、
`web_request_binding`、`web_submission`、`APP_WEB_SELF_SERVICE` Journey、
`WEB_FORM` Leg 和 `intake.web_received`。首次响应只代表已持久受理，不代表已有
Ticket。提交前回滚不会留下回执；提交后处理失败保留
`input_revision > processed_revision`。

认证适配器在事务提交前再次以 `localOnly` 方式复核 profile、写许可、scope 和会话
generation；撤权或换代会回滚本次接收并返回安全错误，避免旧身份提交。

`T_process` 由 `createYxxSelfServiceOrchestrator` 在锁定同一 Web 根后执行。它读取
所有真实 Web Submission，使用共享 P2-007 规则和 P2-015 route，写入带
`source_kind=WEB`/`basis_input_revision` 的 Decision，然后选择：

- 明确故障或服务申请：只经现有 `PilotTicketCore.createForIntakeInTransaction`；
- 信息不足：共享 Intake 状态 `WAITING_DESCRIPTION`，不发消息；
- 需要人工判断：共享 `manual_review_item`，保存当前 basis revision；
- 其他结果：只记录安全 Decision，Web 始终 `APP_ONLY`。

规则异常使用 SAVEPOINT 回退到 `RULE_ENGINE_UNAVAILABLE` 的人工审核；数据库或
Ticket Core 异常回滚整笔处理，并在 binding 上记录稳定错误码和有界退避。

## 泵所有权

`MEMBER_SELF_SERVICE` 使用单一、非重入、batch 默认 10/最大 20 的 App 泵。
`FULL_SERVICE_LOOP` 禁止启动该 App 泵，只能把同一个 Web orchestrator 作为
`webOrchestrator` 交给既有 P2 Worker；Worker 每批为 Web 保留一个槽位（batch=1
时 Bot 槽位为 0），避免 Bot backlog 饿死 Web。`createYxxSelfServiceWorker`
只接受 MEMBER profile。

## 本地验证

```powershell
$env:PILOT_DATABASE_URL='postgresql://postgres@127.0.0.1:55432/yxx_test'
npm.cmd run test:yxx:ss:004
node --test --test-concurrency=1 tests/p2-015-worker.test.mjs tests/p2-015-rule-first-orchestration.integration.test.mjs tests/p2-016-manual-review.integration.test.mjs
```

验证应看到：同一命令并发只一份 receipt/root/Ticket；审核可由原工作台解析并保留
Web provenance；Web 来源的 Message、Outbox、Delivery、Grant、Conversation
Session/Direct Leg 均为 0。AC-037/038 的提交前、提交后故障注入会在新实例重启后恢复，
不会产生部分 Decision/Ticket 或重复 Ticket。测试使用临时 PostgreSQL 数据库，完成后由隔离 harness
回收；不得把该数据库或测试身份当作生产证据。

## 关闭与回退

保持 `YIXIAOXIU_SELF_SERVICE_ENABLED=false` 可停止新的写入和泵；已接受的 Web
事实保留供审计和后续恢复。遇到积压先停止相应 App/Worker owner，记录
`retry_count`、`last_safe_error_code` 和待处理数量，再在隔离环境复跑。禁止删除
生产 Web root、修改历史 001--032 migration、启用真实 OAuth/SDK、发送或执行
`YXX-SS-011`/`P2-G2-LIVE`/`P2-008`。
