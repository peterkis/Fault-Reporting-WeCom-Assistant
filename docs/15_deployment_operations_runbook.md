# 15. V1.2 部署、运维与故障演练

## 1. 环境划分

```text
local
gate-test
pilot
phase3-integration-test
hospital-production
```

### local

- Mock WeCom Adapter；
- Pilot PostgreSQL和合成数据；
- 不使用真实Secret或患者数据；
- 不连接Hospital Tickets。

### gate-test

- 企业微信测试机器人与测试群；
- 只执行G0能力验证；
- 不部署完整Pilot Ticket Core。

### pilot

- Phase 1公网试点；
- WeCom Gateway、Channel Message、Service Intake、Pilot Ticket Core、Pilot Outbox/Delivery和最小处理端；
- Phase 2 AI/OCR可关闭且默认影子模式；
- 不连接Hospital Tickets。

### phase3-integration-test

- Ticket Adapter；
- Hospital Tickets测试实例；
- 脱敏Pilot快照；
- 映射、迁移、对账和回滚演练。

### hospital-production

- Phase 3正式切换后由Hospital Tickets承载长期工单事实；
- Pilot正式写入停止；
- Pilot历史按批准方案只读或归档。

## 2. Phase 1 部署单元

### WeCom Gateway / SDK Adapter

- 一个活动连接和一个不建连备用实例；
- 自动重启、独立健康检查和优雅退出；
- 不与AI/OCR同进程；
- 不包含Hospital Tickets连接配置。

### Pilot Ticket Core

- Channel Message、Service Intake、Pilot Ticket、Ticket Event和Action API；
- 状态、事件和Outbox同事务；
- 具备最小处理端和Pilot权限；
- 不依赖医院SSO、Hub或工单数据库。

### Pilot Outbox / Delivery

- 异步发送、重试、限流、去重、死信和送达审计；
- 企业微信断线时保留积压；
- 恢复后避免刷屏。

### Phase 2 AI/OCR

- 可独立停止；
- CPU和并发受限；
- 只返回建议；
- 不影响Gateway和Pilot Core readiness。

### Phase 3 Ticket Adapter

- 只在P3进入条件满足后部署；
- 使用独立认证和最小权限；
- 具备幂等、重放、死信、映射和对账；
- 不通过共享数据库直写Hospital Tickets。

## 3. Phase 1 启动顺序

```text
Pilot PostgreSQL
→ Pilot Ticket Core
→ Outbox / Delivery
→ WeCom Gateway
→ Pilot Handler UI
→ AI/OCR（Phase 2，可选）
```

Gateway Ready 前确认：数据库可写、Intake/Pilot Core可用或待补建机制已启用、Outbox可写、Secret已加载、单活锁成功。

## 4. 发布流程

1. 校验当前Phase和任务状态；
2. 变更评审与Secret扫描；
3. 数据迁移/Contract/AI关闭E2E；
4. Gate或Pilot测试环境回归；
5. 备份和回滚点；
6. 小范围发布；
7. 观察连接、消息、Pilot Ticket和Outbox；
8. 输出验收证据并更新任务状态。

Phase 3 还必须增加映射抽样、迁移批次对账、通知去重和回滚演练。

## 5. 回滚原则

- 应用回滚不能删除已保存Channel Message、Pilot Ticket Event或Outbox；
- AI回滚可直接关闭，核心链路继续；
- Gate/Pilot企业微信隔离可停止主动推送或断开机器人，但保留已入库事实；
- Phase 3 回滚必须遵循已批准的写入所有权状态，不允许两边同时恢复无主写入。

## 6. 日常巡检

每日：

- WebSocket认证和重连；
- 待处理Intake/Pilot Ticket；
- Pilot Ticket补建积压；
- Outbox/死信；
- 首次回复P95；
- 敏感日志告警；
- AI/OCR降级（Phase 2）。

Phase 3增加：Adapter积压、映射冲突、未解释对账差异、双重通知和切换后Pilot正式写入数。

## 7. Runbook：WebSocket 未认证

1. 检查DNS/TLS/WSS；
2. 检查Secret轮换和单活锁；
3. 检查锁定SDK错误码；
4. 仅重启Gateway；
5. 核对Outbox积压；
6. 恢复后幂等补发必要通知；
7. 记录事件，禁止打印Secret。

## 8. Runbook：Pilot Ticket Core 不可用

1. Channel Message优先可靠落库；
2. Intake标记 `TICKET_CREATE_PENDING`；
3. 不虚构工单号；
4. 使用已批准的临时回执文案；
5. 内部告警；
6. Worker按幂等键补建Pilot Ticket；
7. 成功后发送正式Pilot工单号；
8. 对账消息、Intake、Ticket和通知。

临时回执文案和最大补建时限必须在P1-D2冻结。

## 9. Runbook：AI/OCR 不可用

1. 标记降级并停止新推理；
2. Pilot Ticket继续建单和通知；
3. 进入人工分诊；
4. 告警并记录影响数量；
5. 恢复后按批准策略补算。

## 10. Runbook：Outbox 堆积

1. 检查企业微信连接、错误码和限流；
2. 暂停低优先级消息；
3. 优先待补充、解决确认和重大故障；
4. 按发送幂等键重试；
5. 恢复后限速并合并公共进展；
6. 不修改已发生的Ticket事实。

## 11. Runbook：Phase 3 Adapter/Hospital Tickets 不可用

1. 确认当前cutover_state和写入所有权；
2. 停止可能形成双写的自动重试；
3. 保留Adapter事件、映射和死信；
4. 未切换时继续Pilot并暂停迁移；
5. 已切换时按批准方案进入医院人工降级或回滚；
6. 恢复后幂等重放并逐对象对账；
7. 未解释差异不得自动覆盖。

## 12. Runbook：疑似敏感数据泄漏

1. 停止相关日志、导出和媒体访问；
2. 保存审计证据；
3. 通知安全和管理责任人；
4. 轮换可能泄漏的Secret；
5. 确认影响范围并删除不必要副本；
6. 修复脱敏/权限规则；
7. 完成事件报告和复测。

## 13. 演练频率

| 演练 | 频率 |
|---|---|
| AI/OCR停止 | 每个Phase 2版本 |
| WebSocket断网恢复 | G0及每季度 |
| Pilot Ticket Core不可用 | Phase 1上线前及每季度 |
| Outbox积压 | Phase 1上线前及每季度 |
| Bot Secret轮换 | 每半年或按制度 |
| Pilot数据库恢复 | 按备份制度 |
| 敏感附件访问审计 | 每季度 |
| Ticket Adapter/Hospital Tickets故障与回滚 | Phase 3切换前必做 |

## 14. P1-011 加密备份恢复演练

执行 `npm run p1:011:backup-restore:check` 只验证受控配置且不会发起备份。演练需要项目授权后由运行环境注入
备份密钥、密钥标识、留存天数和 `PILOT_BACKUP_RESTORE_DRILL_APPROVED=true`。脚本以流式 AES-256-GCM
生成加密工件后立即记录安全检查点，创建随机命名的隔离恢复库，核对 P1 对象，再删除临时库和工件。失败时必须
确认不可变失败审计和 `PILOT_RESTORE_DRILL_FAILED`；巡检任务须以获批的最大备份年龄调用
`assessBackupFreshness`，而非自行假定生产留存策略。

成功后仅审计备份 ID、加密工件哈希、字节数、密钥标识、留存截止、恢复 ID 和稳定结果码。演练临时工件会删除，
不等同于长期保留的生产备份；真实事故恢复必须仍按医院变更、备份和密钥制度执行，本机演练不是生产 RTO/RPO
或公网试点通过证明。
