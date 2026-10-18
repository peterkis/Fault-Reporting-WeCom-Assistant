# 新版人工工作台运行入口

本入口显式选择 `WORKBENCH_RUNTIME_PROFILE=human-v1`，沿用 App、Worker、Gateway、PostgreSQL 和 P2-016 Runtime。未选择时 `--check` 返回 `enabled:false`，`--start` 拒绝启动。旧 P2-016/G1/G2/SS011 演练及 `_ENABLED` 限制保持。没有数据库／业务合同变更，没有自动迁移、现场发送、部署或 Gate 批准。

## 能力与实际装配

| 业务能力 | 本入口显式 Runtime 选项 | 必要依赖／角色 |
| --- | --- | --- |
| 接单、开始、分派、等待／恢复、完工、同单重开 | ticketSelfHandlingEnabled、ticketConversationSelfHandlingEnabled、ticketAssignmentEnabled、ticketWaitingActionsEnabled、ticketStaffCompletionEnabled、ticketReopenRoundsEnabled | App；原 Core／039／040／043 |
| 人工复核、明确结论并开始、人工代录 | workbenchManualReviewEnabled、workbenchReviewResolveAndStartEnabled、workbenchManualReportsEnabled | App；原复核／代录合同；手填联系人不自动获得应用发送资格 |
| 接管、转交、释放、私聊文字、内部备注 | workbenchConversationsEnabled、workbenchInternalNotesEnabled | App；真实 Session、原 Control／Communication／CSRF／个人授权 |
| 联系人收件箱、来源标签、个人已读、实时更新 | workbenchConversationInboxEnabled、sourceGroupDirectoryEnabled、workbenchPersonalReadEnabled、workbenchRealtimeEnabled | App；两个 conversation 选项同时为 true；identityHmacKey 映射现有身份密钥；唯一实时控制器 |
| 提交核对、草稿恢复、补充跟进 | workbenchDraftRecoveryEnabled、workbenchSupplementFollowUpEnabled | App；沿各原命令回执与恢复 scope，不另建账本 |
| 节点通知、投递异常、受控恢复 | ticketRoundNotificationsEnabled、notificationExceptionsEnabled | App 生成／消费原轮次通知意图，Worker 执行 Delivery，Gateway Sender；依赖接单、工作人员完工、模板、时间线、MEMBER_REQUIRED |
| 报修人查询、仍未解决 | MEMBER_REQUIRED、成员入口、OAuth；yxxSelfService 的两个原 flags、reporterFeedbackEnabled／reporterFeedbackDraftRecoveryEnabled；botReporterFeedbackEnabled／botReporterFeedbackDraftRecoveryEnabled | App；Web requestRef 与 Bot publicRef 分别原报修人验证，不通过管理员 reopen 代替 |

只启用上述组合。附件、核实目录候选、Incident、AI、提醒、关注、预约、活动、搜索、看板拖动、接管工单、撤派／退回等未列选项保持原默认值。原动作仍按当前授权和状态决定是否可用。

```mermaid
flowchart LR
  CLI[human-workbench.mjs --start] --> Config[唯一配置解析]
  Config --> Cluster[既有 G1 父进程 / 显式角色白名单]
  Cluster --> App[App / 正式 OAuth / P2-016 / React / SSE]
  Cluster --> Worker[Worker / 原编排 / 原规则准入 / Delivery]
  Cluster --> Gateway[Gateway / 唯一 Bot 连接 / 三种 Sender]
  App --> DB[(原 PostgreSQL / Core / Outbox)]
  Worker --> DB
  Worker --> IPC[既有 IPC 请求与回执]
  IPC --> Gateway
  Gateway --> Bot[Bot 私聊 SDK]
  Gateway --> Group[原群消息推送适配器]
  Gateway --> H5[企业应用通知适配器]
```

App 内 `gatewayEnabled/senderEnabled=false`，不是发信角色。原轮次消费者仍位于 App 的现有调度；受理编排和 Delivery Worker 在 Worker，保留 `composeConversationRuleAdmission`。群路由／提及使用 T26 适配器；H5 使用 T25 应用适配器；Bot 私聊使用原 Sender。发送前仍执行每种适配器原绑定、留存和等待后终检。

## 配置与角色

样例：[运行配置](../../config_examples/human-workbench.json)、[环境](../../config_examples/human-workbench.env.example)、[当前通知目标](../../config_examples/human-workbench-notification-bindings.json)。全部为占位符，直接运行会失败。真实文件放 `secrets/` 或其他受控目录，不提交。

| 名称 | 默认／要求 | 角色 |
| --- | --- | --- |
| WORKBENCH_RUNTIME_PROFILE | 未设置即关闭；仅接受 human-v1 | 父进程及三角色 |
| WORKBENCH_RUNTIME_CONFIG | 绝对 JSON 路径，版本1；未知字段／错误类型拒绝 | 仅父进程读取完整文件 |
| PILOT_DATABASE_URL | 必需；沿现有数据库权限 | 三角色 |
| PILOT_LOG_IDENTITY_HASH_KEY | 现有值，至少16字符；不轮换，不替换成 Reporter secret | App Runtime.identityHmacKey／认证、Worker 编排、Gateway 受理 |
| P2_016_REPORTER_HMAC_SECRET | 现有 Reporter 专用值，至少32字节，与身份密钥不同 | 三角色原 Reporter／通知／绑定用途 |
| APP_SECRET | 现有成员应用凭据；memberEntry 中复用已有企业／应用／Bot／namespace 证明 | App OAuth；启用发送时 Gateway 应用 Sender；Worker 不接收 |
| WECOM_BOT_SECRET | transportEnabled=true 时必需 | 仅 Gateway |
| WORKBENCH_EXTERNAL_IO_APPROVED／WORKBENCH_EXTERNAL_IO_APPROVAL_REF | 默认无；发送时需 true 和本次具名授权引用；配置本身不授予批准 | 父进程检查，Gateway 接收；不推进任何 Gate |
| settings.transportEnabled | false；true 同时启用 Gateway 与实际 Sender | 父进程、三角色；App 仍无进程内 Sender |
| settings.publicOrigin／reporterOrigin／listenPort | 必需；精确 HTTPS origin；后端 loopback 端口 1024–65535 | App；Reporter origin 供原卡片 Sender |
| settings.memberEntry | 复用已有 VERIFIED_DELEGATED_MAPPING 及原 reporterUserIds；现有 H5 自助／反馈合同要求委托映射，不能用 SAME_NAMESPACE 代替；OAuth/MEMBER_REQUIRED 同时装配；正式发送只接受 LIVE／DEPLOYMENT | App 认证、各通知目标校验 |
| settings.bot | 原 Bot ID、WSS、原个人／群目标 SHA256；沿既有 scope 每类1–20 | Gateway；原目标白名单 |
| settings.groupRoutes | 原 Bot／原群／官方 HTTPS Webhook，最多20，与群 scope 精确对应 | 仅 Gateway 收到 URL |
| settings.appChannelAccountId | 原应用渠道账号，不能用 Bot 账号替代 | App／Gateway 通知用途 |
| settings.notificationBindingsFile | 有界绝对文件；归属相同 member 配置的当前验证证明与有效期 | App／Gateway 当前资格核对；Worker 不接收 |

通知目标文件是本入口消费的受控配置，不是业务表或身份系统。维护方必须提供当前 ACTIVE／VERIFIED／REACHABLE 的 InternalMemberId 资格及独立 Webhook 提及对应证明；OAuth 转换、旧报修快照、姓名或第三方目录标签不构成该资格。每次资格解析重读文件，删除目标／修改映射／到期立即拒绝新资格；不改投、不盲重发 UNKNOWN。文件整体映射摘要由已有 `yxxIdentityConfigHash(memberEntry)` 计算；既有成员配置原值和 proofRef 必须一致。更换已有身份密钥会改变既有身份，不能作为修复办法。

配置检查不连接数据库或 Provider；实际启动沿 Runtime schema readiness 拒绝缺少迁移。先用仓库已有 `migrate-current-baseline`／各工作包 migrate 的 check/status 核对，再在获得数据库授权时使用其 apply。所需扩展包括 workbench-auth、ticket-self-handling、staff-completion、round-notifications（包含052）、manual-reports、reopen-rounds、bot-feedback、personal-read、follow（既有回执依赖，关注功能仍关闭）、supplement-follow-up、source-groups、conversation-delivery-commands。启动命令不会补写迁移账本。

## 检查、启动、停止

仓库根目录 PowerShell，先完成候选构建；以下入口均执行编译产物：

```powershell
npm.cmd run migration:build
node .build/tools/gate.mjs types
node .build/tools/verify-artifact.mjs
node --env-file=secrets/human-workbench.env .build/runtime/scripts/human-workbench.mjs --check
node --env-file=secrets/human-workbench.env .build/runtime/scripts/human-workbench.mjs --start
```

前台控制台输入 `stop` 再回车，或按 `Ctrl+C`。沿原父进程先停 Worker，再停 App／Gateway，关闭连接池；输出 `event:stopped,process_count:0`。父进程意外断开时角色退出。停止不删除工单、回执、草稿事实、待核对投递或历史证据。`transportEnabled=false` 同时关闭新外部发送入口与 Worker/Sender；已有需核对状态保留。正式 UI 为 `publicOrigin/workbench/app`，原工作台登录入口 `/workbench/login`，成员入口沿原 `/wecom/yixiaoxiu/`。

HTTPS 反向代理须转发到本机指定端口，保留原 Host/Origin、Cookie 和 SSE 长连接。本任务不部署代理。正式认证不返回测试 Cookie；原集群仅在显式 externalAuthentication 模式接受此拓扑，旧测试认证检查保持。

## 验证与交接

活动 selection 为 `v3-p09`；本任务相关集合 `human-workbench-wiring` 注册两个新入口。进程用例经过编译后的配置解析／父进程／三个角色入口，外部 HTTP/SDK 在专用测试子入口替换；无 runtimeFactory 替代，真实业务、数据库、OAuth Session、HTTP、React 和 Sender 保留。SYNTHETIC／ISOLATED_TEST 配置只能配显式外部测试边界和隔离 loopback 库，正式角色默认拒绝。

接线阶段的历史候选与原件见[接线交付记录](../../plans/admin-workbench-integration/execution/runtime-wiring.md)。当前候选已通过实际三进程的 A–F 隔离闭环，完整身份、定向测试原件、已修补的延迟会话绑定窗口、资源清理和真实试单清单见[隔离闭环验收](../../plans/admin-workbench-integration/execution/runtime-closure.md)。真实企业微信闭环仍为 NOT_RUN，本地合成验收不代表部署或正式启用。
