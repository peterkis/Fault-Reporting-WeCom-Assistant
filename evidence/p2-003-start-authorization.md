# P2-003 独立启动授权 Evidence

- 授权日期：2026-08-30
- 授权角色：项目负责人
- 唯一授权任务：P2-003 / P2-A
- 工作基线：`d59de5d7db39c4a39f82093496a0e42565d67a7e`（短 SHA `d59de5d`）
- 当前状态：`P2 / P2-003 / IN_PROGRESS`
- 目标 Gate：P2-G1；本授权不启动或组装 P2-G1

项目负责人正式、独立授权启动 P2-003。完成 P2-003 后必须停止。
P2-004 及以后任务、P2-G1 组装和所有生产功能仍须另行授权。

## 授权范围

本授权只允许实现持久 Realtime Event Log、SSE durable replay、Last-Event-ID、授权裁剪、
heartbeat、慢客户端治理、polling fallback contract、连续过期前缀留存清理，以及为这些边界
服务的 migration 012、Contract、测试、文档和脱敏 Evidence。

## 明确排除

- P2-004 至 P2-014 继续为 `TODO / REQUIRES_SEPARATE_AUTHORIZATION`；
- P2-G1 继续为 `NOT_STARTED`；
- 所有 P2/P3 Feature Flag 继续为 `false`；
- 不连接真实 Workbench，不实现 P2-006 polling endpoint；
- 不新增真实企业微信发送、回复或客户端路径；
- 不连接模型、OCR、AI Provider、医院 SSO、医院内网或真实 Connector；
- 不改变 P1 路径，不改变 P2-001/P2-002 冻结 Contract、migration 010/011 或事实所有权；
- 本授权不等同于生产上线、临床上线、P2-G1 验收或 AI 自动回复批准。

Realtime Event Log、SSE 与进程内 Wakeup Hub 都不是事实源；Unified Ticket Core 仍是唯一长期
Ticket 事实源。任务完成后必须保持 Feature Flag 关闭并停在等待下一次独立授权的状态。
