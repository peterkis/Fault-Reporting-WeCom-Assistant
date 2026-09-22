# P2-016 管理工作台公网扫码验证（2026-09-22）

## 结论

在负责人明确授权后，已将当前脱敏 release 部署到 `cd3120.mobimedical.cn`，并完成测试用户 A 的企业微信扫码回调验证。登录成功事件已写入 `pilot_ticket.workbench_auth_event`，当前存在 1 个 active、1 个完成身份映射且具备工作台角色的会话。

本记录只证明本次受控公网登录链路，不代表 P2-G2 Live、Phase 2 Go、生产/临床上线或外部通知批准。

## 实际状态

- Release：`/opt/fault-reporting-wecom/p2-g2/releases/workbench-wecom-574442522676`；归档 SHA-256 为 `e9aee883ebd9cc346a586c1beae97a11540ca950b9417e6fb8bebbae0bab3fbc`。
- PostgreSQL 035 已应用；应用启动后 `--status` 返回 `NOOP_ALREADY_APPLIED`。
- App 与 Worker 均在 `ss011-management` 私有容器内运行；`/health/ready` 为 `ok=true`。
- Nginx 精确代理已 reload，配置 SHA-256 为 `002a89066da603bddc7117730cfcb14822269adff60f64656f5754819dec91f8`，容器重启次数为 0。
- `WORKBENCH_EXTERNAL_SEND_ENABLED=false`；Gateway、Sender、AI 保持关闭；`delivery_attempts=0`。

## 公网探针

```text
GET  /workbench                    302 -> official CorpApp login
GET  /workbench/lifecycle          302 -> official CorpApp login
GET  /api/workbench/bootstrap      401 JSON without Cookie
GET  /api/unknown                  404
GET  /health/ready                 404 at public edge
GET  /metrics                      404 at public edge
GET  /static/workbench/workbench.js 200
GET  /wecom/yixiaoxiu/             302 existing member OAuth
```

二维码登录重定向使用 `login_type=CorpApp`、配置企业/应用和精确 `/workbench/callback`；Evidence 不保存 raw userid、OAuth code、state、Cookie 或 token。只保存事件类型、稳定原因码、计数和 hash/指纹。

## 备份与回退

- 数据库备份：`/opt/fault-reporting-wecom/p2-g2/backups/workbench-wecom-20260922T043855Z/source-db.dump`，SHA-256 为 `b2e8bb8d0952ce3e11a5b61371a2d147d688f71fdd29a045853e0939734eea05`。
- Nginx 备份归档 SHA-256：`134b91d7ee891a0ba74e979438c93452121e962dbeb13a02014e7eeccad8ede3`。
- 旧 release 和旧管理容器均保留；未执行 down migration。
- 回退顺序：撤销会话/关闭公网管理路由 → 停止新 App/Worker → 恢复旧管理容器和 Nginx 配置；不删除业务数据、不重发通知。
