# P2-016 定向真实现场验证

- 状态：PASSED；现场后全量回归 533/533 PASS；负责人最终验收已批准，见 `evidence/p2-016-project-owner-approval.md`。
- P2-016 收口为 DONE；不等同于 P2-G2 / Phase 2 Go。完成态复核与提交信息见 `evidence/p2-016-ticket-lifecycle-workbench-report.md`。
- 日期与时区：2026-09-04，Asia/Shanghai。
- 候选指纹：`3752596720f20524ff989ee9cf913b9e104e32a4c2095c48fc83804e7e75f863`。
- Run：`3bdbe965-c4df-414b-bd5a-05d5f010ad53`。
- 逐步人工观察与只读核验：`evidence/p2-016-human-assisted-live-3bdbe965.md` / `.json`。
- 追加资源与控制事件：`evidence/p2-016-live-e2e.jsonl`，按本 Run 过滤。

## 范围与证据来源

仅使用负责人批准的一个测试群、一个测试用户和合成故障描述；使用新建本机 PostgreSQL 隔离库与 `https://localhost:43117` Reporter。三个审批变量与 Secret 仅进程内注入，持久 `.env.pilot` 未编辑。没有临床、生产、AI/OCR、医院 SSO/内网或 Incident 接入。

企业微信卡片、Reporter、内部工作台由负责人亲自操作并逐步回报结果；本报告将这些标记为真实客户端的人工观察，不伪称为代理截图或自动化断言。后台独立核对 Ticket/Event、Journey/Channel Leg、Delivery/Attempt 和 Reporter 会话。没有手工注入 Grant、复制 Token、query-token 替代或跳过 TLS 警告。

## 技术结果

- 群纯唤醒产生群提示与主动单聊引导；补充描述后仍是同一 guided Journey、两个 Channel Leg、唯一 Ticket。
- 用户观察创建、接单、开始处理、等待厂商、恢复、等待上报人、解决、关闭和重新打开的代表性通知；对应卡片均只出现一次。
- 最终 `IT-20260904-0001 / REOPENED / version=11`，11 条追加事件，其中 1 条仅内部备注；Reporter 有 10 条公开进度，备注不可见且没有通知绑定。
- 真实卡片打开 Reporter，一次 Grant exchange 创建绑定会话，刷新继续有效。
- 受控断开 Gateway 后提交等待厂商，Ticket 和 PENDING 通知照常持久化；三次 NOT_ATTEMPTED 失败后恢复认证，第 4 条尝试记录成功，客户端只收到一张卡片。这不是四次 SDK 发送。
- 唯一一次本机 Gateway→Worker IPC ACK 丢失演练：Provider 实际 ACK 已收到，但 Worker 未收到 ACK，进入 UNKNOWN。没有盲重发；跨断开/重认证后仍保持原尝试 1。负责人核对后通过 Workbench ADMIN 标记发送成功，尝试 2 是 `OPERATOR_VERIFIED` 审计而非再次发送。
- 原 HTTP 命令重放返回 `replayed=true`；版本、事件、通知增量均为 0。
- 最终 13 条 Delivery 全为 SENT，pending/dead-letter/UNKNOWN 为 0。群强 @ 保持 UNVERIFIED，不作为成功必要条件。

## 观察与清理

实际观察 `2,780,329 ms`（46 分 20.329 秒），180 个资源采样。三业务角色与一个控制器/TLS 进程，两条内部 SSE。业务角色 RSS 峰值约 236.3 MiB，含控制器总 RSS 峰值约 311.7 MiB；精确数字见逐步报告 JSON。采样连接峰值 7，池等待、投影积压与投影失败峰值均为 0。此结果不是 24 小时 soak 或真实 2C4G 硬件认证。

`17:02:27` 停止完成，控制器 exit=0；隔离测试库已按负责人要求彻底删除，库和 backend 残留=0；业务进程、TLS/监听端口、本轮测试浏览器配置和 SSE 均已清理。合成测试行无法从已删除数据库恢复，脱敏证据保留。未关闭或修改其他应用。

以前被策略阻止删除的临时目录/profile 未触碰；非 profile 临时根目录仍保留，不声称文件系统全部清理。

## 剩余停止线

现场后全量回归已完成，533/533，fail/cancelled/skipped/todo 均为 0，exit=0；详见 `evidence/p2-016-post-live-regression-report.md` / `.json`。负责人随后已明确批准 P2-016 targeted live validation、DONE 收口及第二个本地提交；完成态治理复核与最终提交见完成报告。新的现场与后续任务仍须另行授权。

取消、转派、复合接管接单、Manual Review、并发和 SYSTEM auto-close 的完整自动化原生浏览器/集成覆盖，与本次真实企业微信代表性现场覆盖分别记录，不混为同一种 Evidence。

旧候选失败和本候选早先 201,546 ms 的中断记录保持原样，不能抵扣本轮时长或改写为成功。P2-012、P2-G2、P2-008、P3 均未启动；默认 Feature Flag 全 false；未 push、PR、merge、tag 或 release。
