# G0-001 WSS 网络路径验证记录

- 执行日期：2026-08-21
- 执行服务器：`DESKTOP-MOSHDQK`
- 测试目标：`wss://openws.work.weixin.qq.com:443`
- 凭据处理：测试脚本未读取 `.env`、未使用 Bot Secret，也不会输出代理配置值。
- 复现命令：`pwsh -NoProfile -File .\scripts\g0-001-test-wss.ps1 -TimeoutSeconds 15`

## 正常网络结果

执行时间（UTC）为 `2026-08-21T14:31:16.1483013Z`。

| 检查项 | 结果 | 证据 |
| --- | --- | --- |
| 公网出口 | 通过 | `50.7.253.170` |
| DNS | 通过 | `openws.work.weixin.qq.com → 28.0.0.176` |
| TCP 443 | 通过 | 连至 `28.0.0.176:443`，15 ms |
| TLS/SNI | 通过 | TLS 1.3；系统默认验证通过；服务端证书 `CN=work.weixin.qq.com`，有效期至 `2026-11-04T23:59:59Z` |
| WebSocket Upgrade | 通过 | `ClientWebSocket.State = Open`，144 ms |
| 系统代理 | 通过 | 检测到系统代理适用于目标；环境变量代理未配置，Upgrade 在该网络配置下成功 |

## 失败诊断验证

| 场景 | 执行方式 | 结果 | 结论 |
| --- | --- | --- | --- |
| TCP 443 被拒绝 | `wss://127.0.0.1:443`，3 秒超时 | TCP、TLS、WebSocket 均记录“连接被积极拒绝” | 脚本可记录端口阻断/拒绝的失败原因。该场景为本机关闭端口模拟，不代表医院网络策略已实测。 |
| TLS 主机名不匹配 | `wss://28.0.0.176:443`，8 秒超时 | TLS 记录 `RemoteCertificateNameMismatch`；WebSocket 无法连接 | 系统默认 TLS 校验会拒绝不匹配证书，可发现代理替换证书或错误 SNI。 |
| 代理路径 | 使用当前系统代理配置访问正式目标 | WebSocket 成功进入 `Open` | 当前代理路径未造成 TLS 拦截失败。 |

## 验收结论

G0-001 通过：正式目标的 DNS、TCP 443、TLS/SNI 与 WebSocket Upgrade 均已在当前测试服务器的实际网络配置下验证成功；记录包含时间、服务器、出口 IP 与失败诊断，未读取或输出任何 Secret。

## 限制与后续动作

- 企业管理端的最终长连接配置和 Bot Secret 认证不属于本任务，将在 G0-002 使用官方 SDK 单独验证；该验证不得在日志中输出 Secret。
- 如医院网络团队修改防火墙、代理或 TLS 解密策略，应重新执行本脚本，并用真实受限网络结果补充此记录。
- 本任务只验证 Gate 0 网络路径；未实现 Pilot Ticket Core，未接入 Hospital Tickets。
