# 36. 2 核 4GB 部署拓扑、容量与降级策略

## 1. 目标

在 2 vCPU、4GB RAM 的云服务器上优先保证：

1. 企业微信连接；
2. Inbox/Intake/Ticket 事务；
3. 人工 Workbench；
4. Outbox Delivery；
5. 数据库恢复；
6. AI 可关闭增强。

## 2. 推荐部署

```text
Nginx (optional)
  ├─ /api      → app
  ├─ /events   → app SSE
  └─ /         → static workbench

app process
  - REST
  - SSE
  - auth
  - query/projection

worker process
  - communication outbox
  - AI jobs
  - integration jobs
  - cleanup/reconciliation

wecom-gateway process
  - one active WSS
  - frame adapter
  - send adapter

PostgreSQL
  - one instance
  - one application database or isolated schemas
```

资源紧张时 app 与 Gateway 可以同进程，但代码模块仍保持独立。

## 3. PostgreSQL 建议

起始参数需结合操作系统实测，建议保守：

```text
shared_buffers = 512MB
effective_cache_size = 2GB
work_mem = 4MB
maintenance_work_mem = 64MB
max_connections = 40
wal_compression = on
log_min_duration_statement = 500ms
```

应用池：

```text
app max 4
worker max 2
gateway max 1
migration/admin reserve
```

不要让每个模块创建默认 10～20 连接池。

## 4. Node 限制

- App RSS soft 512MB，hard 768～1024MB；
- Worker RSS soft 384MB，hard 768MB；
- Gateway RSS soft 256MB，hard 512MB；
- HTTP body 默认 256KB；
- 附件走流式，不全部复制多份 Buffer；
- 日志按大小轮转；
- 不保留 Base64；
- `--max-old-space-size` 按进程设置；
- 避免大型依赖和服务端渲染常驻开销。

## 5. 并发

起始值：

```text
HTTP in-flight commands: 16
SSE clients: 32
outbox workers: 1
AI concurrency: 1
integration concurrency: 1
media download: 1
database migration: exclusive
```

扩大前必须有压测证据。

## 6. 队列优先级

```text
P0: inbound persistence / ticket command
P1: communication delivery
P2: human workbench projection
P3: integration projection
P4: AI
P5: OCR / metrics / cleanup
```

CPU/内存压力时先暂停 P5/P4，不影响 P0/P1。

## 7. 降级开关

```text
AI_CONVERSATION_ENABLED=false
AI_AUTO_REPLY_ENABLED=false
OCR_ENABLED=false
INCIDENT_CORRELATION_ENABLED=false
INTEGRATION_CONNECTOR_ENABLED=false
CONVERSATION_REALTIME_SSE_ENABLED=false
```

SSE 关闭时 Workbench 使用有限轮询；AI 关闭时转人工；Storage 故障时文字受理继续。

## 8. 不同负载情景

### 正常

- 1 个活动 Gateway；
- 5～10 个坐席浏览器；
- 每分钟少量消息；
- AI 串行。

### 突发公共故障

- 大量入站消息优先落库；
- 短回复模板优先；
- AI 暂停；
- Incident 候选延迟；
- SSE 批量/合并更新；
- 群公告由人工确认；
- Worker 优先发送首次回执。

### 外部 API 慢

- 不占用数据库事务等待；
- Abort timeout；
- retry with jitter；
- circuit breaker；
- Workbench 显示降级。

## 9. 容量测试

至少三组：

### A. 核心链路

- 1000 条合成入站；
- 10～20 并发重复；
- 验证幂等、事务、P95 和内存。

### B. Workbench

- 32 SSE；
- 10 活跃会话；
- 事件补放；
- 慢客户端；
- 浏览器断连重连。

### C. Worker

- 500 Outbox 积压；
- 企业微信超时；
- lease recovery；
- AI 30 个积压；
- integration 1000 个增量事件。

## 10. 目标阈值

起始目标：

| 指标 | 目标 |
|---|---|
| 核心 HTTP P95 | < 500ms（不含外部调用） |
| 入站事务 P95 | < 1s |
| Workbench 可见 P95 | < 2s |
| Outbox 领取延迟 P95 | < 2s |
| AI 队列等待 | 告警 > 60s |
| RSS 总和 | 常态 < 3.2GB |
| Swap | 常态 0 或极低 |
| 数据库连接 | < 75% 上限 |
| 未解释死信 | 0 |
| OOM | 0 |

## 11. 监控

不要求完整 Prometheus/Grafana，同机先采用：

- `/health/live`
- `/health/ready`
- 固定标签 JSON 日志；
- PostgreSQL 指标快照；
- Worker queue counts；
- Gateway auth/reconnect；
- RSS/CPU/FD；
- 死信/失败告警；
- 定时生成运营摘要。

后续可把指标转发到医院现有平台。

## 12. 备份

- PostgreSQL 每日加密备份；
- WAL/增量策略按 RPO 决定；
- 附件单独备份；
- 配置和 Secret 分离；
- 每月至少恢复演练；
- P3 来源接入或重大配置变更前额外快照；
- 备份不能只存在同一磁盘。

## 13. 扩容触发

满足任一再拆分：

- 持续 CPU > 70%；
- RSS 常态 > 3.2GB；
- AI 积压影响核心；
- SSE > 100 并需多实例；
- 数据库 I/O 成为瓶颈；
- 多院区 Connector 大量并发；
- RTO/RPO 需要主备。

优先拆 Worker/数据库，再考虑 Redis 或多实例，不直接跳到 Kubernetes。

## 14. 验收

- 24 小时资源浸泡；
- 公共故障突发模拟；
- AI 全停；
- Connector 全停；
- Gateway 重连；
- Worker kill/restart；
- PostgreSQL 短时不可用；
- 磁盘低水位；
- 备份恢复；
- OOM 防护；
- Feature Flag 回滚。
