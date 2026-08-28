# 20. P1-001 Pilot 工程骨架与配置校验

- 状态：IN_PROGRESS
- 范围：仅建立 Phase 1 的最小启动骨架、配置校验和 Pilot-only 依赖边界；不实现 WeCom SDK Adapter、Channel Message 持久化、Service Intake、Pilot Ticket、AI 或 Hospital Tickets 集成。
- 架构依据：ADR-0007、ADR-0009、`docs/architecture_baseline_status.md`。

## 输入与输出

| 类别 | 内容 |
| --- | --- |
| 输入 | Gate 0 已接受的能力结论、锁定 SDK `@wecom/aibot-node-sdk@1.0.6`、Phase 1 Pilot 依赖边界。 |
| 输出 | `src/p1-001-pilot-foundation.mjs`、本地健康检查骨架和 `npm run p1:preflight`；运行配置仅由本机、版本控制外的 `.env.pilot` 提供。 |
| 不输出 | WeCom 连接、数据库连接或迁移、业务 API、消息持久化、工单、AI、Hospital Tickets、Ticket Adapter。 |

## 配置规则

配置校验只读取运行进程的环境变量，不读取或打印 Secret。由项目负责人将允许的 Pilot 运行值提供到本机受 `.gitignore` 保护的 `.env.pilot` 后，运行：

```powershell
node --env-file=.env.pilot src/p1-001-pilot-foundation.mjs --check
```

必须满足：

- `ARCHITECTURE_BASELINE=V1.2`、`APP_PHASE=P1`、Pilot 负责人和测试群标识必须显式配置，但这些标识不得写入预检输出；
- 声明 Pilot PostgreSQL 和 WeCom Gateway，但不建立连接；
- `AI_TRIAGE_ENABLED=false`、`OCR_ENABLED=false`、`HOSPITAL_TICKETS_ENABLED=false`；
- 拒绝 `HOSPITAL_*`（控制开关除外）、`TICKET_ADAPTER_*`、院内 Outbox/Hub，以及额外的 AI/OCR 运行配置；
- 默认只绑定 `127.0.0.1`；`0.0.0.0`/`::` 必须显式设置 `PILOT_PUBLIC_EDGE_APPROVED=true`。当 `PILOT_ENV=pilot` 时还必须设置 `PILOT_SECURITY_BOUNDARY_APPROVED=true`；这些都是配置审计，不能替代独立的公网安全验收；
- 预检输出只含阶段、监听地址、SDK 版本和允许/禁止依赖，不含 Bot ID、Bot Secret、数据库 URL、密码或负责人标识。

## 最小健康骨架

`npm run p1:serve` 仅在配置通过后启动 Node 内置 HTTP 健康端点。它只提供 `GET /healthz`，并默认监听回环地址；没有消息、工单或 Hospital 路由。收到 `SIGINT`/`SIGTERM` 后会关闭该监听器。

该骨架是 P1-001 的启动/退出验证，不是试点服务上线、也不是 P1-002 的 WeCom Adapter 实现授权。

## 验收与后续

- 配置缺失、非法 Phase、非法公网监听、AI/OCR/Hospital 开关和 Hospital/Ticket Adapter 依赖均由自动化测试覆盖；
- 预检输出通过 Secret/数据库凭据/负责人标识泄露检查；
- 健康端点启动、404 边界和优雅关闭由自动化测试覆盖；
- 真实 `.env.pilot` 预检、公网边界、安全负责人和试点环境仍需在 P1-001 验收时分别确认，不能以本地单元测试替代。

当前本地验收结果见 `evidence/p1-001-pilot-foundation-report.md`：本机版本控制外的配置模板预检和自动化测试通过，但工作区尚未提供 `.env.pilot`，因此真实 Pilot 运行配置预检尚未执行，P1-001 保持 `IN_PROGRESS`。
