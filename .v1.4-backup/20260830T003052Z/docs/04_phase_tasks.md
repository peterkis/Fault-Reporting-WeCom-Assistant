# V1.2 开发阶段任务

机器可读状态见 `plans/master_backlog.json`，任务明细见 `tickets/`。

## Gate 0：企业微信验证

范围：WSS、认证、消息、媒体、主动推送、卡片、重连和单活。

验收：4小时30分钟稳定运行、能力矩阵和架构结论完成。不得实现 Pilot Ticket Core。

## Phase 1：企业微信外网试点

```text
Enterprise WeCom
→ WeCom Gateway
→ Channel Message
→ Service Intake
→ Pilot Ticket Core
```

范围：Inbox、Intake、Pilot Ticket Core、状态机、事件、Outbox/Delivery、最小处理端、解决确认、运维和试点评审。

验收：10秒目标、漏单0、重复单0、真实状态闭环、可靠通知。不得依赖 Hospital Tickets。

## Phase 2：AI 增强

范围：私有媒体、OCR、规则、字段抽取、AI影子分诊、人工修正、Incident候选和指标。

验收：AI关闭不影响 Phase 1；建议可评估；人工可撤销；敏感数据受控。

## Phase 3：医院融合

```text
Pilot Ticket Core
→ Ticket Adapter
→ Hospital Tickets
```

范围：真实契约盘点、外部映射、身份/状态/附件映射、幂等同步、迁移、对账、回滚和切换。

验收：Hospital Tickets 成为唯一长期事实源，Pilot Ticket Core 停止形成长期正式工单。
