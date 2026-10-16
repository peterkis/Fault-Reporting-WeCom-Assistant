# 人工复核与 Contact Journey

返回 [导航](../README.md) · [路径索引](../endpoint-index.md) · [公共约定](../conventions.md)

宿主 W；调用方 [lifecycle UI](../../../web/p2-workbench/lifecycle.js)。条件：`TICKET_LIFECYCLE_WORKBENCH_ENABLED` 默认 false。实现：[HTTP](../../../src/p2-016-workbench-http.mts)、[manual review facade](../../../src/p2-016-manual-review-facade.mts)、[P2-015 store/executor](../../../src/p2-015-manual-review.mts)。权限沿用内部坐席、工单/Journey 范围。

| METHOD + PATH | 请求 | 200 响应 |
| --- | --- | --- |
| `GET /api/manual-reviews` | status默认且只接受PENDING；priority?=`LOW\|NORMAL\|HIGH\|URGENT`；cursor?；limit默认30/最大100 | `{items:[ReviewSummary],next_cursor}` |
| `GET /api/manual-reviews/{reviewId}` | UUID，无 query | ReviewDetail |
| `GET /api/contact-journeys/{journeyId}` | UUID，无 query | 安全 ContactJourney 投影 |
| `GET /api/contact-journeys/{journeyId}/legs` | 无 query | **直接数组**，最多100条 ChannelLeg 投影 |
| `GET /api/contact-journeys/{journeyId}/decisions` | 无 query | **直接数组**，最多100条 DeterministicDecision 投影 |
| `POST /api/manual-reviews/{reviewId}/resolve` | 下述命令 | `{ok:true,review_id,status,resolution_decision_id,action_count,replayed}` |
| `GET /api/manual-reviews/{reviewId}/commands/{commandId}` | UUID，无 query；本票及恢复能力启用 | 闭合 ReviewReceipt：`UNKNOWN/FAILED/COMMITTED` |

查询 Summary 包含 `id,review_key,journey_id,decision_id,service_intake_id,linked_ticket_id,review_reason_code,priority,status,row_version:string,created_at`。Detail 加 `safe_result,allowed_resolutions[],unsupported_resolutions[],web_report?`。safe_result 包含判定 code、known/unknown fields、来源引用、事实 provenance、冲突、安全建议、输入/结果摘要和版本。展示安全投影，不解析建议为脚本、SQL 或自由外发内容。

Journey/Leg/Decision 的精确字段分别见 [Journey schema](../../../contracts/p2_015_contact_journey.schema.json)、[Leg schema](../../../contracts/p2_015_channel_leg.schema.json)、[Decision schema](../../../contracts/p2_015_deterministic_decision.schema.json)，HTTP facade 会裁剪字段；这些类型不是“任意表记录都可返回”的承诺。

## 复核命令

共同 Header：`Content-Type: application/json`、`Idempotency-Key: <client_command_id>`、`If-Match: "<expected_row_version>"`、Cookie 的 CSRF/Origin。

| Body 字段 | 类型 / 规则 |
| --- | --- |
| client_command_id | UUID，必需 |
| expected_row_version | 正十进制 string，必需；不是 number |
| resolution_code | 下列固定枚举，必需 |
| resolution_reason_code | 大写 code，必需 |
| expected_material_basis | 本票启用时可选的64位小写hex摘要；正式表单随捕获材料提交。旧四字段命令保留 |

resolution_code：`CONFIRM_TICKET_ELIGIBLE|CLASSIFY_SERVICE_REQUEST|REQUEST_DESCRIPTION|CLASSIFY_BUSINESS_CONSULTATION|ACKNOWLEDGE|MARK_OUT_OF_SCOPE|KEEP_INCIDENT_REVIEW_CANDIDATE|CANCEL_REVIEW`。`LINK_EXISTING_JOURNEY`明确不支持；target_journey_id只要传入（非undefined）即403，不是可用的跨Journey关联参数。

```json
{"client_command_id":"22222222-2222-4222-8222-222222222222","expected_row_version":"2","resolution_code":"REQUEST_DESCRIPTION","resolution_reason_code":"WORKBENCH_CONFIRMED"}
```

执行在同一 ledger 事务内追加人工结论和安全动作；结果可能创建 Ticket、请求补充或保留候选。已解决/版本冲突不得直接重复写入新结论。通知仍走统一 Communication；内部备注不外发。

合成已受理人工结论响应：

```json
{"ok":true,"review_id":"11111111-1111-4111-8111-111111111111","status":"RESOLVED","resolution_decision_id":"33333333-3333-4333-8333-333333333333","action_count":1,"replayed":false}
```

合同：[list](../../../contracts/p2_016_manual_review_list.schema.json)、[detail](../../../contracts/p2_016_manual_review_detail.schema.json)、[resolution](../../../contracts/p2_016_manual_review_resolution.schema.json)。HTTP 失败码常见 `P2_016_REVIEW_ALREADY_RESOLVED/RESOLUTION_NOT_PERMITTED/REVIEW_ACTION_FAILED/GUIDED_ASSOCIATION_CONFLICT/VERSION_CONFLICT/COMMAND_CONFLICT`；ledger 失败映射 403/409/503，通用请求校验见公共约定。

既有入口核对：[HTTP integration](../../../tests/p2-016-workbench-http.integration.test.mjs)、[说明](../../58_p2_016_manual_review_workbench.md)。本票增量见下文，所有默认开关保持关闭。

## 同事项复核与恢复（WBINT-T14）

`workbenchManualReviewEnabled=false` 默认关闭；关闭时不新增材料、canonical或Item复核引用查询。启用时正式工作台通过独立 Review/Journey 当前权限读取原 `safe_result`，另列 `material_basis/materials/materials_truncated/canonical_item`；原 Decision、hash、provenance保持。材料最多50条/20k字符，引用最多100条，权限和保留期过滤先于LIMIT。合同见 [Review types](../../../contracts/workbench_review_contracts.d.ts)、[材料依据](../../../contracts/workbench_review_material_basis.schema.json)、[材料](../../../contracts/workbench_review_material.schema.json)、[canonical](../../../contracts/workbench_canonical_item.schema.json)。Ticket可见不授予其他Journey材料。

Bot原分类依据仍是生产者按 sequence ASC 取得的最多51条前缀、原 message count/window/hash；材料围栏另核对持久全量 count/max sequence 及原 Decision 之后真实新增的同 Journey Leg。人工阅读窗口独立取最新保留文本，最多50条/20k字符，按时间顺序显示；它不替换原分类 hash 或原判断窗口。`original_hash` 是原 Decision source hash，`current_hash` 是当前来源修订与后来 Leg 标识的捕获摘要，两者用途不同。Web继续核对原 binding/input_revision。

这些来源范围在生产者一致的事务锁下核对，材料或版本变化拒绝旧结论；陈旧项仅支持明确取消，终态不支持新结论。咨询、澄清、确认回应、范围外等沿原分类Port及安全动作处理，不强制建故障；固定建议只作证据，不执行脚本、SQL或任意外发。相同UUID/原意图重放复用既有ledger，改意图拒绝；相同Ticket关联继续一张卡片。多个 Pending 版本的canonical沿现有Board实际Ticket/最早Pending规则，选择的Review命令目标仍保持独立；已知结果后重新读取有权canonical事实，旧Review入口按实际关联转换。转换前仍核对原Review自身当前权限及来源保留期；来源过期时旧Review入口返回404，即使关联Ticket仍可独立读取。

恢复能力为 `manual_review_draft_recovery_enabled = workbenchManualReviewEnabled && workbenchDraftRecoveryEnabled`；原Notes `draft_recovery_enabled`语义不变。本票复用T03当前浏览器AES-GCM/不可导出密钥、固定首次保存后24h的草稿，scope为principal+review+ReviewId+manual-review。密文保存明确选择、原因、捕获字符串版本/材料摘要/canonical与原UNKNOWN完整命令，不自动替换选择、版本或UUID，也不自动POST。

专用收据查询复用既有MANUAL_REVIEW ledger的principal/Review/purpose范围，先重新授权当前Review/Journey和保留材料；READ ONLY，无新receipt写入或第二事实源。`UNKNOWN`表示无终态凭据，不能推断未提交；`FAILED`只含code/retryable:false；`COMMITTED`只含原结论结果且replayed:true，精确形状见 [receipt schema](../../../contracts/workbench_review_receipt.schema.json)。到期或丢弃敏感内容后只保留不透明操作标识，显式GET核对；可信失权清相关缓存与该scope副本。无数据库变更；关闭本票option停止新增投影/UI，既有追加事实保留。验证与停止线见 [本票执行记录](../../../plans/admin-workbench-integration/execution/t14.md)。

## 确认明确故障并开始处理（WBINT-T15，默认关闭）

本地合成实现与证据见 [T15 原七执行记录](../../../plans/admin-workbench-integration/execution/t15.md)。本节描述当前挂载的 W 接口；下方 SOURCE 历史仍只表示当时准备状态。实现复用 [T15 Port](../../../src/workbench-review-start.mts)、原 Review facade、Unified Ticket Core、既有责任与 Control 事务，无第二 Ticket 或 receipt 事实源。

| METHOD + PATH | 闭合请求／结果 |
| --- | --- |
| `GET /api/manual-reviews/{reviewId}/resolve-and-start-context` | 唯一可选 query `resolver_team_id`：大写 code，最长64；其他 query 拒绝。返回 [context Schema](../../../contracts/workbench_review_start_context.schema.json) 的 `review_id,expected_ticket,resolver_team_id,resolver_teams,allowed` |
| `GET /api/manual-reviews/{reviewId}/resolve-and-start/related-sessions/{sessionId}` | UUID，无 query；当前 Review、canonical Ticket、真实关联及 Session VIEW 独立重验；返回 [三个 UUID 的闭合关系证明](../../../contracts/workbench_review_start_related_session.schema.json)。合法 ENDED Session 可保持原关系读取，不因此允许新接管 |
| `POST /api/manual-reviews/{reviewId}/resolve-and-start` | UUID Review，无 query；[原九字段命令](../../../contracts/workbench_review_resolve_and_start_command.schema.json)、[原输入／结果类型](../../../contracts/workbench_review_start_contracts.d.ts)；同事务确认、唯一 Ticket 创建或合法复用、本人处理责任／开始及显式沟通变化 |
| `GET /api/manual-reviews/{reviewId}/resolve-and-start/commands/{commandId}` | UUID，无 query；[专用安全收据](../../../contracts/workbench_review_start_receipt.schema.json)：UNKNOWN／FAILED／COMMITTED，READ ONLY，不重执命令 |

Cookie 的 Origin／CSRF、宿主32KiB body 和公共错误包沿原认证入口。POST 的 `Idempotency-Key` 等于 `client_command_id`，`If-Match: "<expected_row_version>"` 等于捕获 Review 版本。九字段为 `client_command_id,expected_row_version,expected_material_basis,resolution_code,resolution_reason_code,expected_ticket,resolver_team_id,communication_choice,sessions`，额外字段拒绝；不接受客户端 actor、角色、owner 或自由状态。Review 版本为精确正十进制 BIGINT string，材料摘要为64位小写hex；所捕获 Ticket／Session 版本为正 safe integer，保持原合同上限。`resolution_code` 只接受 `CONFIRM_TICKET_ELIGIBLE`；原因和组 code 最长64。不明确材料继续原澄清／其他合法 resolve，不强制建故障单。

处理操作要求当前内部 ADMIN／DISPATCHER／HANDLER、当前 Review／Journey／材料和 Ticket 原读权、本人当前有效处理组及合法 take-and-start 条件；读取或展示按钮不授予动作。context 先核当前对象与权限，再取最多100个当前有效组；原 Ticket 组或显式原组 hint 经精确当前官方成员核验后并入这100个选择，必要时替换末项。hint 不授成员资格或读权，无效显式组403；列表截断缺项不表示原组已失权。写端在同一事务内重新核验当前角色、成员／组与对象权限，并在 receipt／Ticket／Session 等待后再核当前状态。

`expected_ticket` 是原已读 Ticket UUID／number 版本，或明确 null。服务器按原 Intake 唯一建单；新建采用已获权的显式处理组，原普通 Review 的默认建单行为不变。已有 Ticket 不通过新建绕过不合法状态或组。`TAKE_SELECTED` 只提交1–8个明确选择的真实关联 Session UUID／版本；`RETAIN_CURRENT` 提交空集合。沟通责任与 Ticket 处理责任独立，逐 Session 重核关系／VIEW／Control／行版本；结束 Session 的可读历史不产生接管权。失败回滚全部结论、Ticket、事件、责任与 Control，不留下部分成功。

原 Decision／safe_result／hash／provenance 保持。新材料或 Review／Ticket／Session 版本冲突拒绝旧确认；WEB 来源在实际行锁等待后按物理 epoch 保留期复查，不能用事务开始时钟越过真实到期。相同 UUID／原完整 body 重放先当前授权再返回原结果；改 body 拒绝，不自动换版本／UUID。成功返回原类型的安全 Ticket／轮次／沟通变化及 canonical／replayed，当前展示再从获权 GET 读取，内部材料／原因不进入外部 Delivery。

收据仅按原 actor＋Review＋`MANUAL_REVIEW_START` 用途读取既有 ledger。UNKNOWN 表示无终态凭据，不能推断未提交；FAILED 只返回 code／retryable:false；COMMITTED 只含原 command／Review UUID、Ticket UUID／版本／事件 UUID，当前 Review／来源与返回 Ticket、原相关 Session 的独立读权仍须成立。receipt 不返回原 body、内部材料、原因或所选 Session 集合，也不授予新意图权限。非法输入400、认证401、当前动作拒绝403、对象不可读404、材料／版本／UUID意图冲突409、关闭／缺039／事务或制品不可用503；技术失败不能伪装成已提交或失权。

正式 `/workbench/app/` 在原 Review workspace 中捕获材料、选择组与真实 Session，最后一次复合 POST。成功沿同 URL／document／面板转入唯一 canonical Ticket，停用旧版本操作。冲突／UNKNOWN 保留原捕获版本、完整 body／UUID，只能明确只读核对或原意图重放；不自动 POST。恢复复用 T03 当前浏览器 AES-GCM／不可导出密钥、首次保存后固定24h，独立 scope 为 principal＋review＋ReviewId＋`review-resolve-start`；普通 T14 已保存副本不能证明复合命令可安全离开。技术故障、终态清理失败保留原 UUID 并允许只读重试；可信401清会话，403／404只清对应敏感 scope，其他用途保留。Abort／账号与对象 epoch／组件 generation 拒绝迟到旧结果；同挂载新显式意图有独立清理周期。

`workbenchReviewResolveAndStartEnabled=false` 默认关闭，装配还要求原 lifecycle／T14，恢复另需 `workbenchDraftRecoveryEnabled`。无环境变量、旧现场批准或前端状态可隐式开启。039 不完整时新能力 fail closed，不使原获权 Ticket／Review GET 失效。**无数据库变更**，46份旧 SQL 不改，复用现有轮次／命令账本／Core／Control。关闭新 option 停止新入口与 UI，既有追加事实保留；无自动通知、真实发送、额外轮询或后台服务。单表单 in-flight1、Session≤8、选择组≤100、原材料50条／20k字符／100引用、24h恢复、App／Worker各1、Gateway单活、SSE32、fixture pool≤4／总池≤8不变。本地隔离结果不构成生产或现场批准。

### 历史：2026-10-14 有限 Source 同步补充（当时 NOT_RUN）

T15 准备树本次普通合入固定 Root b5808ee88ee749df61a6a82708d1d5bd26971743，保留当前 T14 实际 resolve、材料、canonical 与恢复接口，以及当前 Ticket / Conversation 各自权威。上述 T15 九字段命令和复合结果仍为计划合同，原两份首例与两份专属合同保持原字节；本轮未实现或运行 resolve-and-start，没有将它登记为已存在产品 API。

完整 Root registry 与本票原两个入口 / 两个合同资源并集为 614 entries / 144 selections / 350 resources。共享 fixture 保留当前 Root 的全部实现，仅透传原 T15 默认关闭计划选项。该选项仍未被生产消费，不使读取或按钮展示获得处理权限。未来业务仍须当前 actor、Review / Journey / Ticket、有效处理组与每个明确选择 Session 的同事务核验，保持材料 fence、完整原 UUID 意图、唯一 Ticket 和全部失败回滚。

原七项全部 PENDING，Node / dependency / strict / build / artifact / tests / PG / HTTP / production browser / cleanup 全部 NOT_RUN，详情与真实 Source 结果见 T15 执行记录及 D:/wecom-workbench-evidence/t15/prepared/source-sync-rootb5808-20261014/handoff.json。后续独占 WHOLE 从原 HTTP first 开始，原正向预期、角色、预算和 HTTP-before-browser 次序不改。本轮无数据库变更、业务写入、真实发送、部署或 Gate 推进。
