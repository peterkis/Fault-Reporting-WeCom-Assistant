# 35. Unified Ticket Core 与医院内网 Connector V1.4

## 1. 目标

让企业微信和未来新建的医院内网入口共享同一 Unified Ticket Core，同时保持网络、身份、事件和故障边界清晰。

当前没有历史业务 Ticket，因此本文不定义历史导入、旧状态映射或系统切换。

## 2. Unified Ticket Facade

新模块只依赖：

```ts
interface UnifiedTicketCommandPort {
  createFromIntake(command: CreateTicketCommand): Promise<TicketResult>;
  performAction(command: TicketActionCommand): Promise<TicketResult>;
}

interface UnifiedTicketQueryPort {
  getById(id: string): Promise<TicketView | null>;
  list(query: TicketQuery): Promise<Page<TicketSummary>>;
}

interface UnifiedTicketEventPort {
  readAfter(ticketId: string, ordinal: number): Promise<TicketEvent[]>;
}
```

现有 P1 服务作为默认 Adapter。禁止新建第二套 Ticket 表。

## 3. Integration Source

新来源示例：

```text
INTRANET_REPORT_PORTAL
HOSPITAL_API_PLATFORM
MONITORING_ALERTS
CAMPUS_SUPPORT_PORTAL
VENDOR_SERVICE
```

每个 Source 必须声明：

- Source Code 和 Type；
- Contract Version；
- Direction；
- Authority Policy；
- 数据分类；
- Connector Mode；
- 身份和附件策略；
- Feature Flag；
- 负责人和运行窗口。

## 4. Intranet Connector

推荐网络方向：

```text
Hospital Intranet Connector
        ── outbound mTLS HTTPS/WSS ──>
Cloud Integration Receiver
```

Connector 负责：

- 调用批准的内网 API；
- 事件标准化；
- 本地 Cursor/Spool；
- 请求签名；
- 断点续传；
- Source-scoped 凭据；
- 健康、版本和日志。

Connector 不允许：

- 任意 SQL；
- 任意 Shell；
- 云端直接进入内网；
- 共享数据库；
- 执行 Ticket 状态逻辑；
- 保存长期明文 Secret。

## 5. 新来源入站路径

```text
Source Event
→ Connector local spool
→ mTLS batch
→ Integration Inbox
→ Schema + Signature + Idempotency
→ Identity/Reference Mapping
→ Service Intake or Authorized Ticket Action
→ Unified Ticket Event
```

重复事件只返回原处理结果，不重复建单或重复 Action。

## 6. 外部投影

外部来源可以接收：

- 本地 Ticket 编号；
- 对外状态；
- 最后更新时间；
- 公开处理结果；
- 允许公开的附件引用；
- 投影 ACK。

外部来源不能：

- 自己决定本地 Ticket 状态；
- 修改内部备注；
- 发送重复用户通知；
- 将投影延迟解释为本地状态失败。

## 7. Binding、Cursor 与 Reconciliation

这些对象仅用于新来源运行：

- Binding：外部请求/告警 ID 与本地 Intake/Ticket 的引用；
- Cursor：断点续传；
- Reconciliation：事件、Binding、ACK 和投影的一致性核验；
- Quarantine：无法映射或验证失败的事件。

它们不承担历史 Ticket 迁移语义。

## 8. 第一条来源推荐

优先选择一条低风险、可模拟、范围清晰的新来源，例如：

```text
内网报修门户 → 新建 Service Intake/Ticket → 返回本地 Ticket 编号和状态
```

不要一开始同时接入 SSO、多个门户、监控告警和复杂附件。先通过 P3-G2，再扩展第二来源。
