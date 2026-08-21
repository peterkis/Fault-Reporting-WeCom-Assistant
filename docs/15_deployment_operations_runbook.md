# 15. 部署、运维与故障演练

## 1. 环境划分

建议至少：

```text
local
test
pilot
production
```

### local

- Mock WeCom Adapter；
- 本地 PostgreSQL/Redis/MinIO；
- 不使用真实 Bot Secret；
- 合成数据。

### test

- 企业微信测试机器人；
- 测试群；
- 测试 Tickets；
- 可执行完整 E2E。

### pilot

- 真实试点科室；
- 生产隔离配置；
- AI 默认影子模式；
- 强监控和人工值守。

### production

- 正式机器人；
- 正式 Tickets；
- 受控对象存储；
- 审计和备份；
- 变更审批。

## 2. 部署单元

### `wecom-gateway`

建议：

- 1 个活动实例；
- 1 个备用实例；
- PM2 fork、systemd 或 Docker 单进程；
- 自动重启；
- 独立健康接口；
- 不与 AI 同进程。

### `tickets-service`

复用现有部署，增加 Intake、Incident、通知通道。

### `ai-triage-service`

- 可独立停止；
- CPU 资源限制；
- 低优先级；
- 限并发；
- 不影响 Gateway readiness。

### `minio`

- 私有桶；
- 服务端加密；
- 备份；
- 生命周期规则；
- 不直接暴露公网。

## 3. 启动顺序

```text
PostgreSQL
→ Tickets/Intake
→ Outbox Relay
→ MinIO/Redis
→ wecom-gateway
→ AI/OCR
```

Gateway 启动前应确认：

- 数据库可写；
- Tickets 创建接口可达或待补建机制启用；
- Secret 已加载；
- 单活锁成功。

## 4. 发布流程

1. 变更评审；
2. 数据库迁移测试；
3. Contract Test；
4. AI 关闭 E2E；
5. 测试环境 Gate 回归；
6. 备份；
7. 小流量发布；
8. 观察连接、消息和 Outbox；
9. 扩大；
10. 发布记录。

## 5. 回滚

### 应用回滚

- 保留上一镜像；
- 数据库迁移向后兼容；
- 切回旧 Gateway；
- 保持 ChannelMessage 和 Outbox 不丢。

### AI 回滚

- 切换模型/Prompt 版本；
- 或设置 `AI_TRIAGE_ENABLED=false`；
- 工单继续人工分诊。

### 企业微信隔离

- 停止主动推送；
- 保持消息落库；
- 必要时断开机器人；
- 启用人工群公告。

## 6. 日常巡检

每日：

- WebSocket 认证；
- 重连次数；
- 待处理 Intake；
- Ticket 补建积压；
- Outbox/死信；
- 身份映射失败；
- MinIO 失败；
- AI 降级；
- 首次回复 P95。

每周：

- 数据库容量；
- 附件容量；
- 留存删除；
- 自动关闭；
- 公共故障候选；
- 人工修正率；
- 权限审计。

每月：

- 服务月报；
- 规则和系统目录；
- SDK/依赖安全更新；
- Secret 轮换计划；
- AI 模型评估；
- 试点反馈。

## 7. Runbook：WebSocket 未认证

1. 查看 DNS/TLS/WSS；
2. 检查 Secret 是否轮换；
3. 检查单活锁；
4. 检查 SDK 错误码；
5. 仅重启 Gateway；
6. 验证 Outbox 积压；
7. 恢复后补发必要通知；
8. 记录事件。

禁止把 Secret 打印到日志。

## 8. Runbook：Tickets 不可用

1. ChannelMessage 正常落库；
2. Intake 标记 `TICKET_CREATE_PENDING`；
3. 回复不得虚构工单号；
4. 可回复“问题已记录，工单正在生成”；
5. 内部告警；
6. Worker 重试；
7. 使用 Idempotency-Key 补建；
8. 成功后发送正式工单号。

是否允许无工单号的临时回执应在 Phase 1 冻结。

## 9. Runbook：AI/OCR 不可用

1. 设置降级状态；
2. 停止新推理；
3. 工单进入人工分诊；
4. 首次回复和状态通知正常；
5. 告警；
6. 恢复后按策略补算；
7. 记录降级时段和影响数量。

## 10. Runbook：Outbox 堆积

1. 查看企业微信连接；
2. 查看平台错误码和限流；
3. 暂停低优先级消息；
4. 优先待补充、重大故障和解决确认；
5. 按 target 幂等重试；
6. 防止恢复后瞬间刷屏；
7. 对公共进展进行合并。

## 11. Runbook：疑似敏感数据泄漏

1. 停止相关日志/导出；
2. 隔离附件访问；
3. 保存审计证据；
4. 通知安全和管理人员；
5. 轮换可能泄漏的 Secret；
6. 确认影响范围；
7. 删除不必要副本；
8. 修复脱敏规则；
9. 完成事件报告。

## 12. 故障演练频率

| 演练 | 频率 |
|---|---|
| AI 停止 | 每个版本 |
| WebSocket 断网恢复 | 每季度 |
| Tickets 短时不可用 | 每季度 |
| Outbox 积压 | 每季度 |
| Bot Secret 轮换 | 每半年或按制度 |
| PostgreSQL 恢复 | 按医院备份制度 |
| 敏感附件访问审计 | 每季度 |
