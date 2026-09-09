# P2-G2 显式续接、群内会话与原始报修时间修复

2026-09-09，准备阶段局部修复；P2-G2 仍 IN_PROGRESS，无真实外发或 Gate 通过结论。

输入采用真实入站 Frame、持久 Inbox/Intake、P2 规则 Worker 和既有 Journey/Channel Leg。用户可复制群受理回执中的 `续接工单 <公开引用>：补充内容` 到单聊；它是应用文本，不是虚构的 Provider Frame 字段。引用大小写保持原样，并绑定原 bot、Reporter、Ticket/Journey 与有效保留期，不代替 Direct Leg 出站资格或私有进度授权。错误 bot/Reporter、失效引用、截断/UUID/大小写变更不能接到其他人的工单；消息本身仍先持久化。

群引导后在 Direct 创建的 Ticket，通过 Ticket 来源 Leg 找回同一 Journey，不能假定 Ticket.source_intake_id 一定等于 Journey.origin_intake_id。原始 Group 与后续 Direct 保留两个不可变 Intake、一个 Journey/Ticket。投影恢复前的新 Intake 边界优先，避免后续消息回落旧 Session。源 X012 中“同一 Intake”的期望据此前置契约裁决为“两个来源 Intake、同一 Journey/Ticket”，原源语料不改写。

三种画像全部保留：全群交互、直接单聊、群转单聊补充或明确新故障。群内唯一活动 Session 在相同 provider/bot/group/Reporter 下允许超过 P1 90 秒碎片窗继续，使用既有 30 分钟空闲边界；结束、过期、其他群/Reporter或明确新故障不复用。没有扩大 P1 的全局聚合窗，也没有新增跨 Reporter 自动合单规则。

源 X020 实际使用 SDK `create_time`，新 Journey.reported_at 保存原消息有效且不晚于接收的 Provider 时间；缺失或未来时间回退原消息 received_at。last_activity_at 独立使用活动时间。后续 Direct 补充不改 reported_at，五种来源/持久化时间仍分别保留，既有数据库行不回写。无数据库迁移。

## 实际测试

`p2-g2-entry-and-origin-tests.tap` / `.json`：47/47，exit 0。TAP SHA-256 `59c01f37d6c40fd7b07aef07fda39b2391f03fa0e1d38b277d8e480340654bc7`。覆盖 21 项 Direct Session 边界、14 项显式续接、10 项来源/目录/时间案例及 2 项群内画像。使用实际隔离 PostgreSQL、正常 Frame、规则 Worker、鉴权 HTTP 与真实 Outbox；外部 Provider 调用为 0。活动时间偏移属于受控合成接收时钟，不是实际等待 30 分钟，也未改变主机或数据库时钟。

独立只读复核另执行 3 项真实 PostgreSQL 测试，确认 X020、群内 120 秒补充边界和全群人工 Reply；局部 PASS，不替代最终冻结树审查或 Webhook 客户端现场验证。

本轮实际 RED：`tmp/p2-g2-tests-3782aa67-6ce8-499f-b7e6-67e9dc15ebf3` 中 X020 与其余来源共 10 项，9 pass/1 fail，报修时间取接收日期；修复后时间及 ARCH-005 定向 12/12。`tmp/p2-g2-tests-6d0645f1-be2e-491f-880e-b1854521babc` 中群内 120 秒后产生第二 Ticket，1 pass/1 fail；修复后进入上述 47/47。

新通知频率与 Webhook 适配的独立证据见 `p2-g2-notification-policy-repair.md`。来源案例总表、37 项 Gate 矩阵、完整回归、最终树审查及第二个本地提交仍待完成。持久 Feature Flag 默认关闭。
