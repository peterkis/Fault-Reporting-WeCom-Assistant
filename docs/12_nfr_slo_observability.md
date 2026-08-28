# 12. 非功能需求、SLO 与可观测性

Phase 1/2 的核心 SLO 以 Pilot Ticket Core 为工单事实源；Phase 3 另行增加 Ticket Adapter、Hospital Tickets 和迁移/对账 SLI。

## 1. SLO 分层

核心链路与增强链路分开统计。

### 1.1 核心受理链路

```text
企业微信连接
→ 消息持久化
→ Intake
→ Pilot Ticket Core
→ 首次回复
```

目标可用性：≥ 99.9%。

### 1.2 AI 增强链路

```text
OCR
→ 规则/模型分类
→ 路由建议
```

允许独立降级，不计入核心受理可用性。

## 2. 性能指标

| 指标 | 目标 |
|---|---:|
| 首次回复 P95 | ≤ 3 秒 |
| 首次回复 P99 | ≤ 8 秒 |
| 工单创建 P95 | ≤ 5 秒 |
| 状态通知 P95 | ≤ 10 秒 |
| 消息持久化成功率 | ≥ 99.99% |
| 峰值消息 | 30 条/分钟不丢 |
| 持续消息 | ≥ 10 条/分钟 |
| 同一消息重复建单 | 0 |
| AI 关闭降级 | 100% |
| 卡片 Action 处理 | 满足平台时限，内部目标 ≤ 2 秒 |
| OCR P95 | 通过本地基准确定 |
| AI P95 | 不影响首次回复，建议 ≤ 15 秒 |

## 3. 容量假设

初期：

- 一个约 800 人的主报修群；
- 少量机器人单聊；
- 峰值集中在公共故障；
- 文本为主，图片次之；
- 最大压力来自“同一故障多用户同时上报”。

容量测试必须模拟：

- 30 条/分钟持续 10 分钟；
- 100 条消息突发；
- 50 张图片短时到达；
- 企业微信断线恢复后 Outbox 积压发送；
- AI 服务完全停止；
- Pilot Ticket Core 短时不可用；
- Phase 3 另测 Ticket Adapter/Hospital Tickets 短时不可用。

## 4. RTO/RPO

建议：

| 对象 | RPO | RTO |
|---|---:|---:|
| 已持久化消息和工单 | 近 0，依赖数据库备份/复制 | 30—60 分钟 |
| 企业微信实时连接 | 不适用 | 5 分钟内恢复或告警 |
| AI/OCR | 可重算 | 4 小时 |
| Redis 缓存 | 可丢 | 30 分钟 |
| MinIO 附件 | 按备份策略 | 4 小时 |

具体数值由医院基础设施确认。

## 5. 指标

### WebSocket

```text
wecom_connected
wecom_authenticated
wecom_reconnect_total
wecom_connection_uptime_seconds
wecom_last_message_age_seconds
wecom_message_received_total{type}
wecom_message_duplicate_total
```

### 企业微信临时素材

```text
wecom_media_upload_total{type,stage,status}
wecom_media_upload_bytes_total{type}
wecom_media_upload_seconds{type,stage}
wecom_media_chunk_retry_total{type}
wecom_media_session_expired_total{type}
wecom_media_lease_expired_total{type}
wecom_media_delivery_total{route,type,status}
wecom_media_rate_limited_total{scope}
```

不以 `media_id`、`upload_id`、文件名、用户或会话标识作为指标标签。当前没有针对视频上传时延或最大可用大小的生产 SLO；ADR-0009 已冻结自动视频回复遵循 `docs/18_wecom_temporary_media_constraints.md` 的 1MB 保守运营上限。提高上限须另行获得项目负责人确认并更新 ADR。

### Intake

```text
intake_created_total{request_type}
intake_create_seconds
intake_waiting_triage_total
ticket_create_pending_total
identity_unmapped_total
```

### Ticket

```text
ticket_created_total
ticket_state_transition_total{from,to}
ticket_first_response_seconds
ticket_accept_seconds
ticket_resolve_seconds
ticket_reopen_total
ticket_auto_close_total
```

### Notification

```text
notification_outbox_pending
notification_delivery_total{channel,status}
notification_delivery_seconds
notification_dead_letter_total
notification_rate_limited_total
```

### AI/OCR

```text
ai_request_total{status}
ai_latency_seconds
ai_schema_failure_total
ai_degraded_total
ocr_request_total{status}
ocr_latency_seconds
human_correction_total{field}
```

### Incident

```text
incident_candidate_total
incident_confirmed_total
incident_false_link_total
incident_report_count
```

## 6. 日志和链路

每条消息分配 `trace_id`，贯穿：

```text
WeCom frame
→ ChannelMessage
→ ServiceIntake
→ Ticket
→ Outbox
→ Delivery
→ AI/OCR
```

关键 ID 可用于审计，但用户和群标识在普通日志中哈希化。

## 7. 告警

### P1 告警

- WebSocket 未认证超过 1 分钟；
- 消息数据库写入失败；
- 同一 msg_id 生成重复 Ticket；
- PostgreSQL 不可用；
- Outbox 死信快速增长；
- 患者数据疑似进入普通日志；
- Bot Secret 疑似泄漏。

### P2 告警

- 重连连续超过 3 次；
- Pilot Ticket 补建积压；
- 首次回复 P95 超标；
- MinIO 下载/上传失败；
- 企业微信临时素材上传/完成失败、会话过期或配额耗尽；
- 临时素材租约即将过期但仍有待投递 Delivery；
- 身份映射失败率升高；
- 公共故障候选激增。

### P3 告警

- AI 超时率升高；
- OCR 失败率升高；
- 人工修正率漂移；
- 自动关闭率异常。

## 8. Readiness

Gateway readiness 为 true 需满足：

- WebSocket authenticated；
- PostgreSQL 可写；
- Intake/Pilot Ticket Core 可达或有可靠待补建机制；
- Outbox 可写。

AI、OCR、Redis、MinIO 可按功能降级，不应一律使核心服务 Not Ready。

## 9. SLI 口径

首次回复时间：

```text
企业微信消息接收时间
→ 首次成功回复被企业微信接受时间
```

不能使用“应用开始处理”到“调用发送函数”作为替代。

工单创建时间：

```text
消息接收
→ Pilot Ticket Core 事务提交
```

状态通知时间：

```text
Ticket 状态事务提交
→ 企业微信接受通知
```
