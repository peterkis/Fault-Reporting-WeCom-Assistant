# P2-004 独立启动授权 Evidence

- 授权日期：2026-08-31
- 授权角色：项目负责人
- 唯一授权任务：P2-004 / P2-B
- 基线提交：`2b4548888882ce895a85f513d0a5bb57d9920b91`
- 当前分支：`phase2/realtime-workbench`
- 当前状态：`P2 / P2-004 / IN_PROGRESS`
- 目标 Gate：P2-G1；本授权不启动或组装 P2-G1

项目负责人正式、独立授权启动 P2-004。完成 P2-004 后必须停止。
P2-005 及以后任务、P2-G1 组装和所有生产功能仍须另行授权。

## 授权范围

本授权只允许实现统一 Communication Message、Committed Outbox、Per-target Delivery、Delivery
Attempt、CommunicationPort、P1 Notification Compatibility Adapter、Mock Sender Delivery Worker、
显式 Reconciliation Port、纯函数 Projection Mapper，以及对应的 migration 020、Contract、测试、
文档和脱敏 Evidence。

## 明确排除

- P2-005 至 P2-014 继续为 `TODO / REQUIRES_SEPARATE_AUTHORIZATION`；
- P2-G1 继续为 `NOT_STARTED`；
- 所有 P2/P3 Feature Flag 继续为 `false`；
- 不连接真实 Workbench，不实现真实 REST Route 或真实权限接入；
- 不新增真实企业微信发送路径，只使用 Mock Sender；
- 不连接模型、DeepSeek、OCR、AI Provider、医院 SSO、医院内网或真实 Connector；
- 不实现 Assignment、Read Cursor、Handoff、Generation Fence、Media 或 Incident；
- 不把 P2-002 Timeline 或 P2-003 SSE 正式装配到发送路径；
- 不迁移、复制、删除、重命名或双写现有 `notification.*`；
- 不改变 Unified Ticket Core 的唯一 Ticket 事实所有权；
- 本授权不等同于人工客服工作台、SSE、生产、临床或 P2-G1 验收。

P2-004 完成后必须保持全部 Feature Flag 关闭并停在等待下一次独立授权的状态。
