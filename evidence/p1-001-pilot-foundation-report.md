# P1-001 Pilot 工程骨架与配置校验报告

- 状态：`DONE`（项目负责人授权的本机受控验收；非公网试点验收）
- 日期：2026-08-28
- 阶段边界：仅 P1-001。已创建并验证独立空的本机 `pilot_ticket_core` PostgreSQL 数据库，但未建立 WeCom 长连接、未运行数据库迁移、未创建业务表或 Channel Message/Service Intake/Pilot Ticket，也未接入 Hospital Tickets、医院 SSO、医院 Hub 或院内 Outbox。

## 交付物

| 交付物 | 作用 |
| --- | --- |
| `src/p1-001-pilot-foundation.mjs` | 严格配置预检、Pilot-only 依赖拒绝和最小 `GET /healthz` 骨架。 |
| `config/pilot.env.example` | 带中文字段说明、非敏感示例和安全提示的配置模板；实际运行配置由项目负责人保管在受忽略规则保护的 `.env.pilot` 中。 |
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
| 配置可理解性 | 通过（本地文档检查） | 模板现已说明复制步骤、字段用途、允许值、默认开发示例、Pilot 公网/安全前提及 Secret 禁止事项；详见 `docs/20_p1_pilot_foundation.md`。 |
| 本机 `.env.pilot` 预检 | 通过（实际本机环境） | 2026-08-28 已通过 `node --env-file=.env.pilot src/p1-001-pilot-foundation.mjs --check`。安全摘要显示 `development`、`127.0.0.1`、未批准公网边缘和未确认 Pilot 安全边界；输出未包含任何凭据、负责人或测试群标识。预检不连接企业微信或 PostgreSQL。 |
| 本机 Pilot 数据库创建与验证 | 通过（实际本机执行） | 目标为本机 PostgreSQL 18.4 的 `127.0.0.1:5432/pilot_ticket_core`。确认临时 `trust` 规则已恢复后，具备 `CREATEDB` 的连接角色创建独立数据库；随后成功连接目标库、确认连接角色拥有该库且 `public` schema 中业务表数量为 0。 |
| 数据库连接失败历史 | 已关闭（保留证据） | 曾出现配置端口 `15432` 无监听、以及认证被拒绝；均未执行 `CREATE DATABASE`、未创建表、未读取或输出凭据。项目负责人完成本机交互式改密、恢复 `pg_hba.conf` 并更新 `.env.pilot` 后，最终预检和建库验证通过。 |
| 本机健康端点与路由边界 | 通过（实际本机执行） | 使用真实 `.env.pilot` 在 `127.0.0.1:3100` 启动服务，`GET /healthz` 返回预期 P1 JSON，`/tickets` 返回 404；验证后服务已关闭。 |
| 真实公网 Pilot 运行验收 | 未执行 | 当前 `.env.pilot` 声明的是 `development`，不是 `pilot`。尚未对真实公网边缘、安全负责人确认、企业微信连通性、数据库连通性或临床试点作出任何通过声明。 |

本次回归共通过 58 项本地自动化测试：Gate 0 54 项，P1-001 4 项。它们验证代码和文档约束，不能替代真实公网试点环境、真实凭据、数据库、网络边界或临床试点验收。

## P1-001 完成本机受控验收

项目负责人已明确说明当前没有公网 IP，并授权以当前主机作为 P1-001 验收标注。在此本机受控范围内，配置、独立空数据库、健康端点和路由边界均已通过，故 P1-001 标记为 `DONE`。

该决定不替代 `PILOT_ENV=pilot` 的安全边界确认、真实企业微信连通性、真实公网边缘或临床试点验收。Phase 1 仍为 `IN_PROGRESS`；P1-002 虽已满足依赖，但未获得单独启动授权，保持 `TODO`。
