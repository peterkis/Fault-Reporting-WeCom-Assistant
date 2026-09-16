# YXX-SS-006 本人补充与审核竞争手册

本手册只覆盖本地隔离的 Web Supplement。写入必须经过
`createYxxSelfServiceSupplement` 和已有成员命令上下文；该适配器固定
`kind=SUPPLEMENT`，身份、corp/app scope、CSRF、配额、幂等回执和
`expected_input_revision` 仍由现有命令/存储边界校验。

## 本地验证

```powershell
$env:PILOT_DATABASE_URL='postgresql://postgres@127.0.0.1:55432/yxx_test'
npm.cmd run test:yxx:ss:006
```

验证使用隔离临时 PostgreSQL 数据库，覆盖连续补充、相同命令重放、并发旧版本、跨成员拒绝、审核先后竞争、既有 Ticket、终态拒绝、已解决不隐式重开和处理实例重启。Web 不创建 Bot Inbox、Message、Outbox、Delivery、Grant、Conversation Session 或 Direct Leg。

## 故障与关闭

Supplement 接受后处理失败时保留 `input_revision > processed_revision`，由新的本地 Web processor 继续处理；不要修改旧 Submission 或手工改写审核 basis。关闭新的写入只需保持 `YIXIAOXIU_SELF_SERVICE_ENABLED=false`，保留已接受事实供审计和恢复。

禁止真实 OAuth/WeCom SDK、生产数据库、发送、SSH、云端发布、`YXX-SS-011`、`P2-G2-LIVE` 和 `P2-008`。
