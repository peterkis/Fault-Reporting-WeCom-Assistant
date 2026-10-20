# 新医小修 H5 接入要求

本目录预留给新版页面设计。本次只交付后端接入要求，不生成页面布局。业务规则见 [ADR-0034](../adr/0034_mvp_notifications_and_application_members.md)。

## 身份与入口

使用既有医小修企业微信 OAuth 及同源 Cookie／CSRF。报修范围为当前应用可见成员，不逐人写报修名单；这不授予 PC 管理权限。开放身份与 Bot userid 不可互换。页面不能传入通知收件人、群 ID 或 Webhook。

后端显式选择 `memberEntry.identityMode=VERIFIED_APP_OPENID`，保持已核对的企业、应用、Bot 作用域和 proofRef。先核验并在授权数据库应用 063 增量迁移；启动不自动迁移。新成员不需要 reporterUserIds 或通知目标文件。可选旧名单和原资格文件仅兼容既有身份与记录；不得更换原 Reporter HMAC 或用开放身份冒充 Bot 原始 userid。配置、检查和关闭命令见[运行说明](../docs/runbooks/human-workbench-runtime.md#mvp-通知切换)。

## 接口

复用 [实际 HTTP 索引](../docs/api/endpoint-index.md)及[成员自助合同](../docs/api/member/self-service.md)：

- GET `/api/yixiaoxiu/bootstrap`：能力与当前会话。
- POST `/api/yixiaoxiu/requests`：创建报修，202 表示已受理，沿原 client_command_id 幂等。
- GET `/api/yixiaoxiu/my-reports`、`/api/yixiaoxiu/requests/{requestRef}`、其 `/timeline`：本人报修与进度。
- POST `/api/yixiaoxiu/requests/{requestRef}/supplements`：补充，沿原输入版本和命令恢复。
- POST `/api/yixiaoxiu/requests/{requestRef}/feedback`：明确仍未解决，重开原工单；按 [反馈合同](../docs/api/member/web-feedback-design.md)核能力与恢复。

路由、DTO、版本及失败以实际合同为准；页面设计完成后再装配其入口与 OAuth return path，不自行新增工单 API。

当前成员核验在业务事务前执行，最多 32 个等待项、一个实际查询，5 秒包含排队。等待后再检查本地会话和作用域。拒绝当前成员资格时返回 403；页面清除受保护内容。通知发送独立核验当前资格，不依赖浏览器继续登录。

资格查询暂不可用时返回既有 503，不把网络或 Provider 故障当作成员已退出。页面提示稍后重试。通知在实际发送前遇到这类故障，沿既有 Worker 有界重试；明确无资格仍拒绝，发送结果不明仍需人工核对。

## 通知与体验

实际接单／开始处理和工作人员完工时，由医小修应用向本人发送模板；后台保存报修时核验的收件绑定，退出登录不取消通知。无渠道来源标题；已受理为“工程师正在处理你的工单”。卡片进入本人进度，其他人不能凭链接读取。

页面展示工单业务编号、中文状态、当前进度和下一步动作，不展示数据库 ID、内部规则或投递术语。草稿恢复本期关闭；保留重复提交、版本和结果核对保护。界面文案采用短句、一句一事。

## 接入验收

新可见成员无需配置即可报修；非可见成员拒绝；本人可读、他人拒绝；补充和重复提交不产生重复工单；完工后反馈仍未解决沿原工单新轮处理；应用通知与会话、重启解耦。模拟接口结果不能代替真实设备收件验收。
