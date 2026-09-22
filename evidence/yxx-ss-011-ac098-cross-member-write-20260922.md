# SS-011 AC-098 跨成员补充 POST 与伪造身份字段证据 — 2026-09-22

现场 run：`SS011-AC098-CROSS-MEMBER-20260922T095925+0800`。B 在已重新认证的企业微信医小修会话中打开一次性同源探针；探针只发送合成补充文本，不携带或显示 Cookie、CSRF 值或业务原文。

## 有效 HTTP 结果

| 时间 | 请求 | 状态 | 错误/结论 |
|---|---|---:|---|
| 09:59:25 | `GET /api/yixiaoxiu/bootstrap` | 200 | B 会话已认证 |
| 09:59:30 | `POST /api/yixiaoxiu/requests/<A request_ref>/supplements` | 404 | `YXX_NOT_FOUND`，跨成员补充被拒绝 |
| 09:59:30 | `GET /api/yixiaoxiu/my-reports`（带伪造身份字段） | 400 | `YXX_INPUT_INVALID`，伪造字段被输入边界拒绝 |

前两次探针尝试未纳入证据：一次因探针体缺字段返回 400，一次因 B 会话过期返回 401。有效请求使用完整补充契约，已进入服务端成员所有权检查。

## 数据库对账

请求前后保持：9 个 Web 命令收据、9 个 Web 提交、6 个 Web Intake、2 个 Web Ticket；补充请求没有新增 Receipt、Submission、Intake、Ticket 或事件。通信 Outbox、Message、Delivery 与 Notification Outbox 均为 0。

`operations.audit_event` 为 0。当前成员授权路径不会追加该表；本次 HTTP 审计由受保护的临时代理访问日志承担，原始日志已删除，只保留脱敏摘要和哈希。

## 清理与结论

临时探针页面、访问日志均已删除；Nginx 配置已恢复原 SHA-256 `e41786c28372ce5d5a6da846e3207bec62798ab26f374998e6800f9b5260816e`；成员服务继续运行。

本记录完成 AC-098 的跨成员补充 POST 与伪造身份字段真实 HTTP 证据，并证明没有越权写入。结合 [前一份 HTTP 证据](yxx-ss-011-ac098-live-http-20260922.md)，AC-098 的 HTTP 隔离范围已完整捕获；最终验收仍按负责人矩阵确认规则收口。
