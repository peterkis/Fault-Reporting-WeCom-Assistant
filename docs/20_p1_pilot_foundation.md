# 20. P1-001 Pilot 工程骨架与配置校验

- 状态：DONE（本机受控验收；非公网试点验收）
- 范围：仅建立 Phase 1 的最小启动骨架、配置校验、独立空的 Pilot PostgreSQL 数据库和 Pilot-only 依赖边界；不实现 WeCom SDK Adapter、Channel Message 持久化、Service Intake、Pilot Ticket、AI 或 Hospital Tickets 集成。
- 架构依据：ADR-0007、ADR-0009、`docs/architecture_baseline_status.md`。

## 输入与输出

| 类别 | 内容 |
| --- | --- |
| 输入 | Gate 0 已接受的能力结论、锁定 SDK `@wecom/aibot-node-sdk@1.0.6`、Phase 1 Pilot 依赖边界。 |
| 输出 | `src/p1-001-pilot-foundation.mjs`、本地健康检查骨架和 `npm run p1:preflight`；运行配置仅由本机、版本控制外的 `.env.pilot` 提供。 |
| 不输出 | WeCom 连接、数据库迁移或业务表、业务 API、消息持久化、工单、AI、Hospital Tickets、Ticket Adapter。 |

## 配置规则

配置校验只读取运行进程的环境变量，不读取或打印 Secret。由项目负责人将允许的 Pilot 运行值提供到本机受 `.gitignore` 保护的 `.env.pilot` 后，运行：

```powershell
node --env-file=.env.pilot src/p1-001-pilot-foundation.mjs --check
```

首次建立本机配置时，可从有注释的模板复制：

```powershell
Copy-Item config/pilot.env.example .env.pilot
notepad .env.pilot
node --env-file=.env.pilot src/p1-001-pilot-foundation.mjs --check
```

`.env.pilot` 不得提交。模板中的 `replace-with-*` 只是格式示例；它能帮助本地校验模板结构，但不是有效的真实数据库或企业微信凭据。`--check` 也不会尝试连接企业微信或 PostgreSQL。

### 配置项对照

| 配置项 | 示例值 | 如何填写 / 校验规则 |
| --- | --- | --- |
| `ARCHITECTURE_BASELINE` | `V1.2` | 固定值，不能修改。 |
| `APP_PHASE` | `P1` | 固定值，不能填写 `G0`、`P2` 或 `P3`。 |
| `PILOT_ENV` | `development` | 允许 `development`、`test`、`pilot`。实际 Pilot 用 `pilot`，并要求安全边界确认。 |
| `PILOT_LISTEN_HOST` | `127.0.0.1` | 开发时推荐回环地址。仅允许 `127.0.0.1`、`::1`、`0.0.0.0`、`::`；后两者要求正式公网边缘批准。 |
| `PILOT_LISTEN_PORT` | `3100` | 选择未占用的 1024–65535 端口；仅用于此最小健康检查骨架。 |
| `PILOT_PUBLIC_EDGE_APPROVED` | `false` | 只有在使用 `0.0.0.0` 或 `::` 且已获批准时才设为 `true`。 |
| `PILOT_SECURITY_BOUNDARY_APPROVED` | `false` | `PILOT_ENV=pilot` 时必须为 `true`；应在安全负责人完成实际确认后填写，不能把它当成自助放行开关。 |
| `PILOT_OWNER_ID` | `replace-with-pilot-owner-id` | 填已获授权的负责人内部标识；预检要求非空，但不会输出该值。 |
| `PILOT_TEST_GROUP_ID` | `replace-with-pilot-test-group-id` | 填已获授权的测试群内部标识，不填群聊名称或业务内容；预检不会输出该值。 |
| `PILOT_DATABASE_URL` | `postgresql://user:password@127.0.0.1:5432/pilot_ticket_core` | 必须是 Pilot 专用 PostgreSQL URL。密码中的保留字符须 URL 编码；预检代码不连接数据库，但本机受控验收已创建并验证独立空库。 |
| `WECOM_BOT_ID` | `replace-with-bot-id` | 填已授权机器人的 ID；不应写入日志或提交。 |
| `WECOM_BOT_SECRET` | `replace-with-bot-secret` | 仅保存在本机 `.env.pilot`；不应提交、打印或提供给测试输出。 |
| `WECOM_WS_URL` | `wss://openws.work.weixin.qq.com` | 默认 Gate 0 已验证的官方网关地址；仅按企业微信官方要求变更。 |
| `AI_TRIAGE_ENABLED`、`OCR_ENABLED`、`HOSPITAL_TICKETS_ENABLED` | `false` | 必须全部保持 `false`；AI/OCR 属于 P2，Hospital Tickets 属于 P3。 |

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
- 真实 `.env.pilot` 预检、独立空数据库创建/连接、本机健康端点和路由边界已完成本机受控验收；公网边界、安全负责人、企业微信连通性和试点环境仍未验收，不能以本机结果替代。

当前本地验收结果见 `evidence/p1-001-pilot-foundation-report.md`：项目负责人已授权将当前主机作为 P1-001 本机受控验收环境，真实 `.env.pilot`、独立空数据库和本机健康端点均已验证，因此 P1-001 为 `DONE`。这不构成公网试点验收，P1-002 仍须另行启动授权。
