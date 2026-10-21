# ADR-0033: Bot 报修按应用可见成员自动准入

Status: Accepted for the user's formal-environment test request and scope clarification on 2026-10-19. This is not a business Gate or real-send approval.

## Context

正式报修人员使用企业微信私聊 Bot 或在群内 @Bot，不操作 PC 管理端。逐人维护试点人员名单不能满足这一使用方式。现有 human-v1 将 Bot 入站与外部发送共用 `transportEnabled`，并将试点人员、群哈希作为入站白名单。H5 OAuth 的固定映射名单是另一条入口的约束，不能成为 Bot 接收新报修的前提。

## Decision

- 增加显式 `botInboundEnabled`，省略时为 false。原 `transportEnabled` 的发送和历史试点行为保持不变。新开关可单独启动 Bot 接收；它不启动 Sender，不允许 App 发消息，也不授予 PC 权限。
- 新入站只接受既有认证 SDK 连接交付、经原 Adapter 校验、属于配置 Bot 的单聊或群聊消息。群聊沿企业微信推送的 @Bot 回调，不扫描群历史。
- 从可信回调取得发送者 userid。用同一企业应用的 token 调用官方 `batch/userid_to_openuserid`，再用得到的应用身份调用 `user/get`。要求精确、完整的单人成员映射、返回身份一致和有效账号。企业微信查询失败或无成员查看权限时拒绝，不根据姓名、目录标签或浏览器输入猜身份。
- 每条入站重新查询当前成员权限，不以固定人员或群名单授予报修权限。两次查询在数据库事务外执行，共用 5 秒截止、既有响应大小限制和安全错误边界；不保存 token 或成员原始资料。应用凭据限定为已核对的目标应用。
- 准入后使用既有 Channel Message Inbox、Service Intake 和 Unified Ticket Core，保留原始来源身份、去重、事务和追加式事件。明确故障仍由既有规则受理，不能建立第二套工单。
- 接收入站不等于发送资格。通知目标、应用通知、群 Webhook、人工回复及真实发送批准沿原合同。发送关闭时所有投递 Worker/Sender 保持关闭，投递尝试为 0。
- PC 管理端授权继续由原员工认证和角色事实单独决定。Bot 报修不自动创建工作人员或角色。
- ADR-0019 的 H5 OAuth 映射和历史只读证明不变。本增量不声称已开放所有报修人的 H5，也不以缺少 H5 静态映射阻止 Bot 报修。
- 单独接收且不使用 H5 时，允许 `memberEntry` 保留已核对企业／应用／Bot 作用域而使用 `UNVERIFIED`、无 `reporterUserIds`。App 不执行 H5 名单转换、不装配成员自助／反馈或 App通知；原 MEMBER_REQUIRED 读取继续失败关闭，不回退旧 Grant。发送模式保留原映射要求。
- 成员查询实际并发为 1，最多 32 项，5 秒截止包含排队。超时后未结束的底层操作继续持有串行占用。查询失败、截止或溢出拒绝该次入站；本增量不提供失败消息的持久化重放，恢复后需重新报修。

2026-10-21前向窄例外：[ADR-0036](0036_yixiaoxiu_h5_performance_read_and_media_budgets.md)仅为显式性能H5 entry允许同一APP成员verifier内的专用只读入口最多2实际操作，APP共享2实际／32总项、BASE仍最多1，原5秒含排队与真实settle占槽保持。Bot／Gateway及发送不选专用入口，本ADR入站1／32规则和其他权限制约不变。该本地性能实施不授权外发、部署或Gate。

## Deployment and verification

开启新入站须有本次接收授权引用和 Bot 认证凭据；不借用真实发送批准。先完成合成三进程验证、完整 PR CI、两轴审查和制品核验，再在已授权隔离测试库部署。确认只有一个目标 Bot 长连接后测试实际回调。

验证覆盖默认关闭、单独接收、名单外的可见成员、名单外的群、不可见成员拒绝、错误 Bot 拒绝、映射/身份不一致拒绝、查询失败、重复回调、原核心受理、PC 权限不扩张以及 0 次发送。保留首次失败、历史证据和 NOT_RUN。

本次云端只读探针确认：同一主账号的 Bot 身份经官方转换后，用应用身份调用 `user/get` 成功；原身份直接调用曾失败。该探针不代替本增量的真实入站验收，也不证明任何消息已经发送。

Sources: [official member read](https://developer.work.weixin.qq.com/document/path/90196), [official identity conversion](https://developer.work.weixin.qq.com/document/path/97106), [official SDK](https://github.com/WecomTeam/aibot-node-sdk). Source contracts and observed provider results remain separate evidence.
