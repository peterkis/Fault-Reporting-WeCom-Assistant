# P2-016 人工复核工作台

本文是 P2-016 实现说明，不是任务完成、现场验收或 P2-G2 通过声明。唯一实施授权为 P2-016；P2-015 的既有 DONE 事实不重新执行。所有已提交 Feature Flag 默认 false。

## 入口与事实源

沿用 P2-006 原生 HTML/CSS/ES module、Node HTTP、既有认证及 CSRF。`/workbench/` 保留会话与人工回复，`/workbench/lifecycle` 是同一工作台的工单/复核视图；不引入另一套后台、前端框架、构建器、CDN 或字体。页面明确标记 Internal Beta、非生产/非临床、AI 和 Incident 未启用及 Asia/Shanghai。

`intake.manual_review_item`、`deterministic_decision`、`safe_action_suggestion` 继续为 P2-015 权威记录。P2-016 facade 使用原 Store/Executor，不在 HTTP 或浏览器中修改这些表。

GET `/api/manual-reviews` 接受 `status=PENDING`、priority、cursor、limit；默认 30、最大 100，priority/created_at/id keyset。权限条件在 LIMIT 前应用。详情与 `/api/contact-journeys/{id}`、`/legs`、`/decisions` 仅暴露既有安全投影，不从 Channel 表旁路读取患者/账号/原始 Provider 内容。UI 通过 textContent 呈现 safe_result、known/unknown fields、Fact Provenance 和原始 Decision；不执行其中 HTML。

## 人工结论与事务

POST `/api/manual-reviews/{reviewId}/resolve` 要求内部坐席、CSRF/Origin、Idempotency-Key、If-Match 和字符串 expected_row_version。只允许固定 resolution code；无任意 SQL、目标账号或自由外发文案。

| 结论 | 同事务执行 |
| --- | --- |
| CONFIRM_TICKET_ELIGIBLE | 分类并经原 Ticket Core 创建最小工单 |
| CLASSIFY_SERVICE_REQUEST | 分类并路由为服务请求工单 |
| REQUEST_DESCRIPTION | 固定单问题；群入口同时产生安全群回执与本人单聊引导 |
| CLASSIFY_BUSINESS_CONSULTATION | 记录人工结论，不猜政策、不创建故障工单 |
| ACKNOWLEDGE / MARK_OUT_OF_SCOPE | 固定确认/范围提示 |
| KEEP_INCIDENT_REVIEW_CANDIDATE | 仅保留审核候选，不创建 Incident 或订阅 |
| CANCEL_REVIEW | 取消审核，不撤销已存在业务事实 |

原 Decision 不被重写。Human Override、Review 终态、允许的 Safe Action、Ticket/Event 和需要的 Communication 三件套处于同一事务；安全动作失败时业务部分回滚，持久 command receipt 留下稳定失败码。12 路相同命令复用一次提交；同 ID 不同 hash 为冲突。重放前重新授权。

`LINK_EXISTING_JOURNEY` 在此界面禁用：既有 Store 不支持任意迁移一个已绑定 Channel Leg，不能伪装成功。群转单聊先保留当前 Intake 的已绑定 Leg，再检查同一未结束 Session 的可靠引导绑定，最后使用唯一未过期、未消费的引导候选。多个候选或已消费但不能证明同一 Session 的候选进入 `MULTIPLE_GUIDED_JOURNEYS` 人工审核；已过期候选不自动关联。不按最近一条猜选，也不把内部 Journey UUID 发给用户。

## 装配扩展与历史兼容

P2-016 对额外 Channel Leg 使用 `decision_v2_` 幂等键，纳入该 Leg ID；原始/首个 Leg 保留 `decision_v1_`，不重写历史记录或 Hash。Worker 可在 claim 前取得统一发布锁，候选查询按实际 Leg 的 Intake 窗口恢复。P2-015 `listEligibleGuided` 的 DISTINCT 排序使用相同的 UUID text 表达式，修复真实调用时的 PostgreSQL 42P10，不构成 P2-015 重新收口。

普通 API、UI 和 SSE 均不包含 Reporter 外部账号、chatid、原始文本、Continuation/Reporter token。真实客户端观察与负责人批准必须另记 Evidence；本说明不能替代它们。

## 现场关联回归修正（2026-09-04）

真实 SDK 归一化文本保留机器人的显示名提及。入口判定先仅为分类去掉开头的 `@显示名`，据余下描述判断是否需要群转单聊引导；原始消息、规则输入和 Provenance 不被清洗改写。已存在 Journey 的 entry_mode 使用持久化值，不随后续描述变化重新分类，避免补充消息产生冲突或改写历史入口。修正没有迁移或历史数据回填；失败现场 Evidence 保留，新的实际客户端重跑仍是独立门禁。
