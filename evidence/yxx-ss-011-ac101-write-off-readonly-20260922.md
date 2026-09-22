# SS-011 AC-101 关写、停止、只读回退证据 — 2026-09-22

现场 run：`SS011-AC101-20260922T021148Z`。被测版本为 `ss011-member-c4cf9c922234`，Node 镜像摘要为 `sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e`。

## 关写与停止

停止前成员服务仍是 `MEMBER_SELF_SERVICE` 写入配置：`SELF_SERVICE_ENABLED=true`、`MY_REPORTS_ENABLED=true`。数据库有 9 个 Web 命令收据、9 个提交、6 个 Web Intake、2 个 Ticket；pending review 为 0，已有在途 Web Intake 为 3，通信和通知 Outbox 均为 0。

已备份原 `member.env`（SHA-256：`03940459573d23119e74d430cc79bf12020b7a0724a9188504603f06eb3a3d62`），停止并移除本轮成员进程容器；数据库、业务事实和 Ticket 未删除或修改。

## 只读回退

使用同一 release、同一数据库、同一镜像和原资源约束启动 `member-readonly.env`：

- `YIXIAOXIU_SELF_SERVICE_ENABLED=false`
- `YIXIAOXIU_MY_REPORTS_ENABLED=true`
- Profile 仍为 `MEMBER_SELF_SERVICE`
- 健康检查返回 `ok=true`；内部 socket bridge 保持不变。

B 重新认证后执行真实 HTTP 验证：

| 请求 | 结果 |
|---|---:|
| Bootstrap | `200`，`read_only=true`、`can_submit=false`、`can_supplement=false` |
| 本人列表 | `200`，返回 4 条本人记录 |
| 新建报修 POST | `403 YXX_FORBIDDEN` |
| 本人补充 POST | `403 YXX_FORBIDDEN` |

## 关写对账与清理

回退后数据库仍为 9 个命令收据、9 个提交、6 个 Web Intake、2 个 Ticket；Web Intake events 为 18、Ticket events 为 9；在途 Web Intake 仍为 3；pending review 仍为 0；所有通信/通知外发队列仍为 0。最新业务事实时间没有前移，新增计数全部为 0。

临时只读探针页面和访问日志已删除；Nginx 配置已恢复原 SHA-256 `e41786c28372ce5d5a6da846e3207bec62798ab26f374998e6800f9b5260816e`。当前成员服务保持只读运行，管理工作台未被本演练改动。原始 Cookie、OAuth 回调和请求体不归档。

本记录完成 AC-101 的关写、停止、只读回退和真实 HTTP 验证；不代表 SS-011 整体关闭或允许推进后续 Gate。
