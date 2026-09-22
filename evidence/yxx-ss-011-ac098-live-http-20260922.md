# SS-011 AC-098 真实 HTTP 命令与隔离审计证据 — 2026-09-22

本记录绑定现场 run `SS011-AC098-HTTP-20260922T093807+0800`，时间为 `2026-09-22 09:38:07–09:38:33 +08:00`（`1790041087000–1790041113000`）。请求来自 B 的现有企业微信医小修会话；没有保存 Cookie、请求体、OAuth 回调原文或身份原值。

## HTTP 结果

临时启用的 Nginx 私有访问日志只记录方法、路径、状态和响应字节数。三条目标请求的脱敏结果如下：

| 时间 | 请求 | 状态 | 结果 |
|---|---|---:|---|
| 09:38:18 | `GET /api/yixiaoxiu/requests/<A request_ref>` | 404 | B 读取 A 详情被拒绝 |
| 09:38:24 | `GET /api/yixiaoxiu/commands/<A client_command_id>` | 404 | B 查询 A 命令收据被拒绝 |
| 09:38:33 | `GET /api/yixiaoxiu/my-reports?cursor=<A cursor>` | 400 | 返回 `YXX_CURSOR_INVALID`，跨成员游标被拒绝 |

截图与 HTTP 记录一致：B 看到 `YXX_CURSOR_INVALID`，没有获得 A 的详情、描述、Ticket 或 Timeline。

## 前后对账

与现场恢复基线相比，拒绝请求没有业务写入：

- Web command receipts：9 → 9；Web submissions：9 → 9；Web Intake：6 → 6；Web Ticket：2 → 2。
- Web Intake events：18；Web Ticket events：9；本次新增均为 0。
- Communication Outbox、Message、Delivery 及 Notification Outbox 均为 0。
- `operations.audit_event` 当前为 0；本服务成员读授权路径没有追加该表记录。本次 HTTP 安全审计由受保护的临时代理访问日志承担，日志已只保留脱敏摘要，原始日志已删除。

## 清理

原 Nginx 配置先备份（SHA-256：`e41786c28372ce5d5a6da846e3207bec62798ab26f374998e6800f9b5260816e`），测试后恢复；临时访问日志已删除，成员服务仍在运行。证据原件引用见同名 JSON 文件，原始 Cookie、请求体和 OAuth 回调不归档。

## 范围说明

本记录完成 AC-098 的真实 HTTP 详情、命令收据和游标拒绝捕获，并证明没有越权写入。跨成员补充 POST 与伪造身份字段的后续真实请求见 [补充证据](yxx-ss-011-ac098-cross-member-write-20260922.md)；HTTP 隔离范围已完整捕获，最终状态仍由负责人按验收矩阵确认。
