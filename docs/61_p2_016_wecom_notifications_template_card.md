# P2-016 可靠企业微信通知与模板卡片

2026-09-04 最新现场记录：`evidence/p2-016-targeted-live-validation.md` / `.json`。负责人操作的技术场景、46 分 20.329 秒观察、隔离测试库清理和现场后 533/533 回归已完成；负责人已明确批准，P2-016 收口为 DONE。原 automated-readiness 报告保留现场前快照；完成和批准见 `evidence/p2-016-ticket-lifecycle-workbench-report.md` 与 `evidence/p2-016-project-owner-approval.md`。默认关闭保持不变；新的现场运行须另行授权。

P2-016 实现说明；不是真实发送批准。所有默认 Flag 为 false；P2-G1 通过不等于本任务可自行发消息。固定使用仓库已安装的 `@wecom/aibot-node-sdk` 1.0.6；Node 类型/运行时为 SDK 依据，不以其他语言 SDK 推断。

## 通知事实与幂等

版本 `p2-016-ticket-notification/1` 从已提交/同事务的 Ticket Event 决定固定通知：创建、接单、处理中、等待上报人/厂商、解决、关闭、重新打开、取消；既有关闭前提醒复用待确认状态模板。内部备注与 Assignment 不进入外部通知。

同一 Ticket Event、通知类型、Reporter binding、destination 与模板版本只有一个 `ticket_notification_binding`，关联 P2-004 Message/Outbox/Delivery。创建事件锁下先检查既有 P1 outbox 所有权；已有 P1 通知不会再次投递。需要通知的 Ticket 事务同时提交全部事实，任何通知持久化失败撤销业务部分。发送失败则不撤销已提交 Ticket。

群创建回执只含受理提示和尾号；详细内容发给原上报人的单聊。纯唤醒/缺描述时发送固定群提示和固定个人单问题，引导以 P2-015 continuation/Channel Leg 为事实，不显示 token。重复决定/重复事件不重复产生 Communication。群強 @ 继续为待现场确认能力，不假称已支持，也不是成功必需项。

## Card 与 Sender

ViewModel 只含 opaque public_ref、四位尾号、状态、local time、版本、通知类型及 GROUP/DIRECT 安全来源。`text_notice` 包含固定标题、尾号 emphasis、外部状态、时间和“查看处理进度”。不把完整 Ticket UUID、原始 Reporter/群身份、内部备注或自由文本传给模板。

只有 Sender 调用 Gateway 的 authenticated Node SDK `sendMessage`。它重新验证 target hash allowlist、PERSON 类型、Grant/Delivery/Reporter 绑定和批准 HTTPS origin。WECOM_TEMPLATE_CARD_ENABLED=false 时不发送卡片；缺 HMAC/错误 URL/错误绑定失败关闭。原 text/markdown 继续复用 P2-G1 Sender（SDK active push 的 text 使用受支持的 markdown body）。

只有数值 errcode=0 是 ACK；明确非零为拒绝；缺失回执、模糊网络故障和超时为 UNKNOWN。调用 Provider 前断线可安全重试；已调用而结果未知进入 RECONCILIATION_REQUIRED，不能因重启/超时盲重发。ADMIN 核对后选择 CONFIRMED_SENT、CONFIRMED_NOT_SENT_REQUEUE 或 CANCEL；普通重试仅适用于已知 NOT_ATTEMPTED 的失败。控制命令同样有 principal-scoped 持久 receipt。

## 现场门禁

自动化完成后才生成现场 harness/readiness Evidence 并将 P2-016 置为 READY_FOR_TARGETED_LIVE_VALIDATION。真实发送需要负责人显式批准三个 P2_016 进程变量，并配置批准的用户/群 target hash、HTTPS origin、host allowlist 和 HMAC。不得打印原始目标、Secret、Cookie 或 token。

现场必须分别记录：Provider ACK；真实客户端卡片显示；点击与 fragment exchange；代表性状态的单次通知；断线/重认证与 UNKNOWN 核对；至少 15 分钟资源观察；明确负责人批准。现场 Evidence 不得由合成测试填充。第二个实现提交、DONE 与完成报告必须等这些门禁及最终回归全部通过。

## 受控运行手册

仅在自动化报告与当前代码指纹一致、任务处于 READY 后使用。运行入口不会迁移数据库、创建角色、修改默认开关或替负责人设置审批。

由负责人在忽略的 `.env.pilot` 中配置以下值，不把实际内容复制进命令输出或 Evidence：

- `PILOT_DATABASE_URL`：仅含本次批准范围业务记录的测试库；迁移 031 必须已独立核验并提交。
- `PILOT_LOG_IDENTITY_HASH_KEY`、`WECOM_BOT_ID`、`WECOM_BOT_SECRET`、`WECOM_WS_URL`：既有受控测试身份与 Gateway 配置。
- `P2_016_TEST_PRINCIPAL_IDS`：2–4 个现有、有效的试点坐席 UUID，逗号分隔；不新增认证库。
- `P2_016_TEST_USER_TARGET_HASHES`、`P2_016_TEST_GROUP_TARGET_HASHES`：各 1–20 个经批准目标的 SHA-256，逗号分隔。
- `P2_016_REPORTER_ORIGIN`：批准的 HTTPS origin，无 path/query/fragment。
- `P2_016_REPORTER_ALLOWED_HOSTS`：精确 host（含显式端口）allowlist，逗号分隔。
- `P2_016_REPORTER_HMAC_SECRET`：至少 32 bytes；`P2_016_LISTEN_PORT` 可选，默认 43116。

三个 `P2_016_LIVE_TEST_APPROVED`、`P2_016_TEST_SCOPE_CONFIGURED`、`P2_016_REAL_WECOM_SEND_APPROVED` 只能由负责人显式设置为字符串 `true`。所有业务 Feature Flag 的持久默认值仍为 `false`。以下命令供该批准之后执行，不代表已执行现场：

```powershell
npm run p2:016:migrate:status
npm run p2:016:live:check
npm run p2:016:live
```

`live:check` 只读检查门禁、代码指纹、精确 031 catalog 和数据库测试范围，输出布尔值/计数/稳定错误码。它不检查真实客户端是否能访问 HTTPS；该观察仍需现场填写。检测到范围外 Intake/Delivery 或并行 App/Worker/Gateway 时失败关闭，不清空或接管现有记录。

回归先检查实现和 Contract，再根据真实全量结果生成 readiness 报告，最后运行默认 Validator 和 `live:check`。测试内部可显式使用 `includeReadinessEvidence=false` 进行实现校验，结果标记 `readiness_evidence_checked=false`；这不是现场放行结果。CLI/default Validator 仍检查全部 readiness Evidence，`live:check` 额外要求该标记严格为 true，并独立检查报告状态、完整回归和精确指纹，不能用实现校验代替。

`live` 默认观察 900 秒，最大 3600 秒（直接执行 `node --env-file=.env.pilot scripts/p2-016-live-e2e.mjs --observe-seconds=1800` 可取 30 分钟）。沿用既有 App/Worker/Gateway 三进程生命周期和受控浏览器会话；连接池分别 4/2/1，控制器独占锁连接 1，总上限 8。坐席浏览器只访问 loopback `/workbench/lifecycle`，Cookie 通过内存注入而非 URL。Worker 串行执行规则编排、SYSTEM 到期策略与 Communication；只有 Gateway 连接 SDK。新入站先校验 bot/个人/群范围，再持久化；不存在第二条 P1 Ticket 创建通道。

Reporter HTTPS 由已批准边缘代理终止 TLS，并仅转发 `/reporter/*` 与 `/api/reporter/*` 至 loopback 服务；不得将 Workbench、内部 API 或 health/metrics 一并公开。现场必须验证 TLS、可达性、无凭证日志和安全响应头；脚本不创建外网隧道或更改网络边界。

运行中仅接受固定控制词 `gateway-disconnect`、`gateway-reconnect`、`fragment-lost`、`stop`。不要输入目标、Secret 或 token。`fragment-lost` 立即停止并记录 BLOCKED；不得改为 query token。资源每 15 秒记录 RSS/heap/Timer/Socket/backlog。Gateway 故障控制由人选择时机；UNKNOWN 测试应由已批准的故障演练形成，不通过盲目重发模拟成功。

JSONL 只追加安全事件和聚合指标，计时结束也保持 `task_done=false`。真实卡片显示/点击/通知单次出现、ACK 与 UNKNOWN 核对、群 @ 能力、负责人批准须另行形成现场 Evidence。提前停止不满足 15 分钟门禁。结束时关闭三个角色、测试浏览器及控制器连接；测试数据与追加审计保留，清理不是删除业务事实。
