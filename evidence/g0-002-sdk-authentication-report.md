# G0-002 SDK 认证与连接生命周期 PoC 记录

- 执行日期：2026-08-21
- 执行服务器：`DESKTOP-MOSHDQK`（Windows）
- 范围：仅 Gate 0 企业微信官方 SDK 认证、连接、心跳和断开；未实现 Pilot Ticket Core，未接入 Hospital Tickets。
- 凭据处理：Bot ID 仅在运行内使用并哈希化记录；Bot Secret 只由 Node `--env-file=.env` 载入，未输出到控制台、测试结果或本文件。

## 锁定的 SDK

| 项目 | 记录 |
| --- | --- |
| 包 | `@wecom/aibot-node-sdk` |
| 锁定版本 | `1.0.6`（`package.json` 精确版本，`package-lock.json` 已锁定） |
| npm 完整性 | `sha512-WZJN3Q+s+94Qjc0VW8d5W1cVkA3emYxiqf+mNRO9UEHoF40puHvizreNMtudjFhm7mmkYiK5ue/QzNiCk+xwLA==` |
| Node.js | `v24.18.0` |
| 官方资料 | `https://github.com/WecomTeam/aibot-node-sdk` |

PoC 使用 `WSClient` 的 `connected`、`authenticated`、`reconnecting`、`disconnected` 和 `error` 事件；SDK 负责认证帧、心跳和底层断开。PoC 以结构化 JSON 输出状态、版本、哈希化 Bot ID 和错误码，不记录消息正文、Secret 或 SDK 原始错误参数。

## 实测结果

| 场景 | 时间（UTC） | 结果 | 证据 |
| --- | --- | --- | --- |
| 正确 Secret | `2026-08-21T14:43:22Z` 至 `14:43:25Z` | 通过 | 依次收到 `connected`、`heartbeat_timer_started`、`authenticated`，稳定窗口后主动 `disconnect`，进程以 0 退出。 |
| 错误 Secret | `2026-08-21T14:43:36Z` | 通过 | TCP/WebSocket 已连接但未认证，结构化错误码为 `WECOM_AUTH_FAILED`，随后主动断开，未出现 `authenticated`。 |
| SIGTERM 处理器 | `2026-08-21T14:44:23Z` 至 `14:44:26Z` | 通过 | 已进入 `SIGTERM` 处理器，记录 `disconnect_requested` 与 `disconnected`，进程以 0 退出。当前本机 Windows 部署环境以 `process.emit('SIGTERM')` 验证同一 Node 处理器；不使用 WSL。 |
| 本地自动化 | 当前执行 | 通过 | 3 项 Node 单元测试通过；对三类运行输出做 Secret/Bot ID 值扫描，未发现敏感配置泄露。 |

## 验收状态

| 验收项 | 状态 | 说明 |
| --- | --- | --- |
| 认证成功 | 通过 | 正确 Secret 实测触发 `authenticated`。 |
| 进程退出前主动断开 | 通过 | 正确 Secret 和 SIGTERM 处理器路径均记录主动断开与 `disconnected`。 |
| 错误 Secret 可识别 | 通过 | 错误码为 `WECOM_AUTH_FAILED`。 |
| 不打印 Secret | 通过 | 运行输出与自动化扫描均未发现 Bot ID 或 Bot Secret 明文。 |
| SIGTERM 优雅退出 | 通过 | 当前本机 Windows POC 已验证 Node `SIGTERM` 处理器会主动断开并收到 `disconnected`；Windows 不使用 Unix OS 信号投递，测试以同一事件处理器模拟完成。 |

## 复现命令

```powershell
npm run test:g0:002
npm run g0:002:valid
npm run g0:002:invalid
npm run g0:002:sigterm
```

第三条命令预期以非零状态结束，并输出 `WECOM_AUTH_FAILED`；这是正确 Secret 负向测试的预期行为。

验收日志包含 `shutdown_reason=SIGTERM`、`disconnect_requested`、`disconnected` 和 `ok=true`，且不包含 Bot ID 或 Bot Secret 明文。

## 本机部署边界

本 POC 直接运行在当前本机 Windows 操作系统：不经过 WSL、不引入 Linux 运行时。Windows 的进程信号语义与 Unix 不同，故 `npm run g0:002:sigterm` 通过 `process.emit('SIGTERM')` 验证生产代码注册的同一优雅退出处理器。切换操作系统或进程管理方式时，应在对应环境重新执行 Gate 0 生命周期验证。
