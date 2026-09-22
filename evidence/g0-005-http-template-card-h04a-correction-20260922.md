# G0-005 更正：OAuth2 敏感字段结果归属 H04A

- 更正日期：2026-09-22；对应 PR #21 审查意见 `discussion_r4070292290`。
- 原记录：[`g0-005-http-template-card-20260922.md`](g0-005-http-template-card-20260922.md)，被审提交 `87b12ab6d0929fc069326a58159917cda075a4a4` 第 167 行；原文件 Git blob 为 `01cc72075f7a800acfb7cf26bc7aaac1ea0354ce`。
- 本文件仅更正能力编号归属，不是一次新的企业微信调用、成员授权或字段采集。原记录保持不变，其第 167 行的编号结论由以下更正替代；原始逐接口观察不变。

## 更正后的有效结论

本次 `H04A` 结论为 `PROFILE_PRIVATEINFO_PARTIAL_PASS`：成员本人 OAuth2 经 `snsapi_privateinfo`（携带 `agentid`）、`auth/getuserinfo.user_ticket` 和 `auth/getuserdetail` 取得了性别、手机号和头像字段；邮箱、企业邮箱、地址、个人二维码本次仍未取得。工单系统暂不保存上述用户资料，字段保留范围仍须单独决定。

原第 167 行把此结论归入 H04 是编号错误，不应据此推导 `user/get` 返回了上述敏感字段。各项独立结论如下：

| 编号 | 实际接口/流程 | 保留的结论 |
|---|---|---|
| H04 | `user/get` | `PROFILE_LOOKUP_PARTIAL_PASS`：非敏感资料部分通过。后续复核观察到姓名、部门、别名和激活状态等；职务为空。不能用 H04A 的结果升级 H04 或证明 H04 返回了敏感字段；不同轮次的字段观察仍分别保留。 |
| H04A | `snsapi_privateinfo` → `auth/getuserinfo` → `auth/getuserdetail` | `PROFILE_PRIVATEINFO_PARTIAL_PASS`：性别、手机号、头像字段已返回；`email`、`biz_mail`、`address`、`qr_code` 本次未取得，不推断永久不可获取。 |
| H04B | `department/get` | 部门层级通过：成员部门及父部门可逐级读取；不保存部门名称、ID 或负责人值。 |

编号定义见 [HTTP 能力矩阵](../docs/07_wecom_websocket_integration.md)。原文件中前一次仅返回 userid 的观察、同日后续非敏感资料观察，以及 OAuth2 逐接口观察仍是各自运行的历史事实；本更正不合并这些运行，也不更改原有 G0-003/G0-005 Bot WebSocket 结论。

H01 正式服务商 Token 链及 H05 客户端展示/通知仍为 `NOT_RUN`；本更正不增加个人信息保存、不打开 Feature Flag、不推进 P2-G2-LIVE，也不授权部署或真实发送。
