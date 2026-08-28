# P1-001 Pilot 工程骨架与配置校验报告

- 状态：`IN_PROGRESS`（本地实现与自动化验证完成；真实 Pilot 运行配置尚未提供）
- 日期：2026-08-28
- 阶段边界：仅 P1-001。未建立 WeCom 长连接、未连接 PostgreSQL、未运行数据库迁移、未创建 Channel Message/Service Intake/Pilot Ticket，也未接入 Hospital Tickets、医院 SSO、医院 Hub 或院内 Outbox。

## 交付物

| 交付物 | 作用 |
| --- | --- |
| `src/p1-001-pilot-foundation.mjs` | 严格配置预检、Pilot-only 依赖拒绝和最小 `GET /healthz` 骨架。 |
| 本机版本控制外的配置模板 | 仅用于本地预检；实际运行配置由项目负责人保管在受忽略规则保护的 `.env.pilot` 中。 |
| `tests/p1-001-pilot-foundation.test.mjs` | 配置、边界、Secret 输出、健康端点启动/关闭测试。 |
| `docs/20_p1_pilot_foundation.md` | 输入、配置约束、运行方法和不在本任务范围内的功能说明。 |

## 本地验收结果

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| 只声明 Pilot 依赖 | 通过（自动化） | 仅允许 Pilot PostgreSQL 与 WeCom Gateway；拒绝 Hospital Tickets、医院 SSO、医院 Hub、院内 Outbox、Ticket Adapter 和额外 AI/OCR 配置。 |
| 配置完整性和阶段边界 | 通过（自动化） | 强制 `V1.2`、`P1`、禁用 AI/OCR/Hospital Tickets，并拒绝非法 Phase、端口和未批准的公网监听。 |
| Pilot 安全入口 | 通过（自动化） | `PILOT_ENV=pilot` 必须显式确认安全边界；`0.0.0.0`/`::` 必须显式确认公网边缘。两者只是配置门槛，不替代真实安全验收。 |
| Secret 与敏感配置输出 | 通过（自动化） | 预检摘要不输出 Bot ID、Bot Secret、数据库凭据、负责人或测试群标识；失败路径只输出稳定错误码。 |
| 启动/退出和路由边界 | 通过（自动化） | 本地健康端点可启动并关闭；仅 `GET /healthz` 返回 200，`/tickets` 返回 404。 |
| 配置模板预检 | 通过（仅本机，未纳入版本控制） | P1-001 预检成功；输出不含模板凭据占位值。 |
| 真实 Pilot 运行配置预检 | 未执行 | 当前工作区不存在 `.env.pilot`，因此未对真实 Pilot 负责人、测试群、数据库、公开边缘或安全边界作出任何通过声明。 |

本次回归共通过 58 项本地自动化测试：Gate 0 54 项，P1-001 4 项。它们验证代码和文档约束，不能替代真实公网试点环境、真实凭据、数据库、网络边界或临床试点验收。

## P1-001 完成条件

P1-001 保持 `IN_PROGRESS`，直到项目负责人提供并在本机安全运行 `.env.pilot` 的预检，同时确认 Pilot 环境、安全边界、测试群和负责人。通过预检后，仍须按验收范围决定是否标记 P1-001 为 `DONE`；在此之前不得启动 P1-002。
