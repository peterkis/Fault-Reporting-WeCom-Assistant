# P2-005 独立启动授权 Evidence

- 授权日期：2026-08-31
- 授权人角色：项目负责人
- 唯一授权任务：P2-005 / P2-B
- 基线提交：`7e9a41498c471be4deca235439440ea7f157bdd4`
- 当前分支：`phase2/realtime-workbench`
- 当前状态：`P2 / P2-005 / IN_PROGRESS`
- 目标 Gate：P2-G1；本授权不启动或组装 P2-G1

项目负责人正式、独立授权启动 P2-005。
完成 P2-005 后必须停止。
P2-006、P2-G1 和后续生产功能仍须另行授权。

## 授权范围

本授权只允许实现 Current Assignment、Handoff Lifecycle、每 Principal/Session Read Cursor、
append-only Control Event、Generation Fence、Pilot Principal 授权兼容、P2-004 Communication
Authorization Adapter、P2-003 Realtime Event Mapper/Append，以及对应的 migration 021、Contract、
测试、文档和脱敏 Evidence。

## 明确排除

- P2-006 至 P2-014 继续为 `TODO / REQUIRES_SEPARATE_AUTHORIZATION`；
- P2-G1 继续为 `NOT_STARTED`；
- 所有 P2/P3 Feature Flag 继续为 `false`；
- 不连接真实 Workbench，不实现真实 REST Route、页面或真实登录权限；
- 不连接真实企业微信 Sender，不调用企业微信 SDK；
- 不连接模型、DeepSeek、OCR、AI Provider、医院 SSO、医院内网或真实 Connector；
- 不启动 Media、Incident、P3 或任何生产/临床能力；
- 不改变 Unified Ticket Core 的唯一 Ticket 事实所有权；
- 本授权不等同于人工客服工作台、SSE 生产开放、真实人工回复、AI、生产或临床上线。

P2-005 完成后必须保持全部 Feature Flag 关闭并停在等待下一次独立授权的状态。
