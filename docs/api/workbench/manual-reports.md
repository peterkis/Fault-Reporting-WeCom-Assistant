# 电话／现场代录接口（T17 手填与 T18 核实选择）

返回[API 导航](../README.md) · [入口索引](../endpoint-index.md) · [T17 执行记录](../../../plans/admin-workbench-integration/execution/t17.md) · [T18 执行记录](../../../plans/admin-workbench-integration/execution/t18.md)

本页描述当前实现的 HTTP 合同：工作人员手填报修、受控成员候选与明确选择、原命令回执、MANUAL 复核材料及正式管理端展示。相关功能默认关闭。具体被测提交、通过/失败/未运行项目及整票状态以执行记录为准；实现存在不代表生产启用、真实外部目录验证或 Gate 批准。

## 1. 入口、认证与开关

宿主 **W**，内部工作人员会话；页面为 `/workbench/app/reports/new`。POST 使用 JSON、同源 `Origin`、现有 CSRF 校验，`Idempotency-Key` 必须等于 body 的 `client_command_id`。浏览器不能指定 actor、状态、处理人、应用范围、人员绑定或 WeCom 收件人。

当前 active ADMIN／DISPATCHER，或实际属于至少一个 active 处理组的 HANDLER 可以代录。查询、提交、重放和回执读取均重新验权；目录等待结束后再核验当前创建权。受理回执不会扩大对 Ticket／Journey／Review 的既有读取范围，也不会自动接单或建立沟通责任。代录后立即处理属于 T19。

| 方法与路径 | 用途与返回 |
| --- | --- |
| `GET /api/lifecycle/bootstrap` | 原工作人员引导信息，含下列可选能力字段；字段仅控制入口展示 |
| `GET /api/workbench/reports/capabilities` | 当前创建许可、033/042 readiness 与本用途恢复能力 |
| `GET /api/workbench/reporter-candidates?q={query}&limit={limit}&cursor={opaque}` | 获权候选页；只搜索，不选择、不受理、不写命令账本 |
| `POST /api/workbench/reports` | 手填或明确选择后受理；新成功 202、原意图成功重放 200 |
| `GET /api/workbench/reports/commands/{commandId}` | 只读核对原 UUID 的 UNKNOWN／FAILED／COMMITTED |
| `GET /api/manual-reviews/{reviewId}` | 在原 Review 权限内返回该次 MANUAL 材料与安全资料快照 |
| `GET /api/workbench/board` | 沿既有看板查询返回来源及报修人标签 |
| `GET /api/workbench/items/{kind}/{id}` | kind 为 ticket、review 或 intake；沿既有详情读取权限返回来源及报修人标签 |

| 宿主配置 | 默认值与关系 |
| --- | --- |
| `workbenchManualReportsEnabled` | `false`；关闭代录用途，拒绝其 capabilities／POST／receipt，不读取 042 存储 |
| `workbenchReporterCandidatesEnabled` | `false`；必须同时启用原代录用途，才开放候选查询和 VERIFIED_SELECTION POST |
| `manualReporterDirectory` | `null`；显式装配受控应用、目录 scope 与窄 Directory Port，浏览器不得覆盖 |
| `workbenchDraftRecoveryEnabled` | `false`；与代录用途共同决定本用途草稿与 GET 回执能力 |
| `workbenchManualReviewEnabled` | `false`；MANUAL 复核材料工作区还受原 T14 开关和对象权限约束 |

bootstrap 的 `manual_reports_enabled`、`reporter_candidates_enabled`、`manual_report_draft_recovery_enabled` 缺省视为 false，非法组合拒绝；候选位为原代录与候选 option 的合取。实际创建许可仍取 capabilities 并由服务器每次操作验证。capabilities 闭合返回：

```json
{"can_create":true,"manual_contact_required":true,"external_notification":false,"draft_recovery_enabled":false}
```

这里的 `manual_contact_required:true` 是手填入口基线，不能替代某次核实选择结果的独立通知资格。代码：[宿主装配](../../../src/p2-016-runtime.mts)、[bootstrap](../../../src/p2-016-workbench-http.mts)、[代录 handler](../../../src/workbench-manual-reports.mts)。

## 2. 候选查询 GET

只接受各出现一次的 `q`、`limit`、`cursor`。`q` 去首尾空白后 2–100 个字符，原值拒绝控制字符；`limit` 默认 10、最大 20；`cursor` 省略表示第一页，否则为 1–512 个 `[A-Za-z0-9_-]` 字符的 opaque 引用。PC 当前每页请求 10 项。

返回闭合形状见[候选页 Schema](../../../contracts/workbench_reporter_candidates.schema.json)：

```text
{schema_version:1, candidates:[{
  candidate_ref, candidate_version, display_name, departments,
  profile_source:WECOM_DIRECTORY|THIRD_PARTY_STAFF_DIRECTORY,
  binding_verified:true, message_reachability:REACHABLE|UNREACHABLE|UNKNOWN
}], next_cursor:string|null, manual_fallback_available:true}
```

候选数不超过请求 limit，整页最多 16 KiB；`candidate_ref` 为 32–256 个上述字符，`candidate_version` 为 64 位小写 SHA-256 字符串。姓名及各部门名称为 1–100 字符、非纯空白、无控制字符，每人最多 20 个唯一部门名称。保留目录原资料，不按姓名或部门文本推导身份；不返回电话、工号、头像、原始外部 ID 或完整目录。

`searchAuthorizedCandidates` 必须先裁剪 principal 在配置应用/目录中的获权对象，再分页。Port 负责 cursor 与 principal、corp/app、目录 scope、query、limit、资料版本的绑定及最多 5 分钟有效期；不存在、过期或不匹配的 cursor 用 400 拒绝。宿主对输入、闭合页形状、大小和资源预算再次检查。opaque 引用与 `binding_verified:true` 都不是提交授权凭据。

合法无结果为 200 空页。配置缺失、目录离线/超时或无效/超限页为 503，不能伪装成空页。查询结束后当前人员失权为 403；搜索不会调用提交验证、创建 Intake/Ticket、保存 profile/proof/receipt 或产生外发。

## 3. 代录 POST：两个互斥 reporter 分支

顶层闭合字段和基础限制相同：

| 字段 | 约束 |
| --- | --- |
| `schema_version` | 固定 `1` |
| `client_command_id` | UUID，与 Idempotency-Key 相等；同一意图重试保持不变 |
| `source` | `PHONE` 或 `ON_SITE` |
| `description` | 去首尾空白后 1–4000 字符；允许换行，拒绝非法控制字符 |
| `location` | 闭合 `{text,unknown}`；unknown=true 时 text 必须 null；否则为非空 1–200 字符单行位置 |
| `reporter` | 只能采用下面一个闭合分支 |

Body 最多 16 KiB。字段不得包含患者详情、口令或其它敏感业务记录。

**T17 手填**：[命令 Schema](../../../contracts/workbench_manual_report_command.schema.json)。`reporter` 为 `{"verification":"UNVERIFIED","name":"合成报修人","contact":"人工联系100","department":null}`。姓名和联系方式各 1–100 字符，科室为 null 或 1–100 字符；去首尾空白、拒绝控制字符。服务器保留 `HAND_ENTERED` 快照，不自动匹配目录，不把名字、电话或科室变成身份绑定。手填不依赖目录、映射 proof 或 045/051。

**T18 核实选择**：[命令 Schema](../../../contracts/workbench_verified_manual_report_command.schema.json)。`reporter` 仅为 `{verification:VERIFIED_SELECTION,candidate_ref,candidate_version}`。ref/version 沿候选页约束；禁止添加 name、departments、contact、actor、proof、app、scope 或收件人 ID。服务器重查当前绑定、对象权限、版本及可达性，不能只回显浏览器的 version。拒绝后不自动降为手填或改绑；显式改为手填属于新意图，必须使用新 UUID，并先解决原操作的不确定结果。

成功返回原持久受理结果；不把 Review 称为已建 Ticket：

```text
{ok:true, client_command_id, intake_id, intake_no, source,
 reporter_verification, manual_contact_required, external_notification:false,
 result_code, ticket:{id,number,status}|null, review:{id,status:PENDING}|null,
 replayed, [仅 VERIFIED: notification_eligibility]}
```

| 分支/本次观察 | `reporter_verification` | `notification_eligibility` | `manual_contact_required` |
| --- | --- | --- | --- |
| 手填 | `UNVERIFIED` | 字段不存在 | `true` |
| 明确绑定且目标应用 REACHABLE | `VERIFIED` | `ELIGIBLE` | `false` |
| 明确绑定但 UNREACHABLE／UNKNOWN | `VERIFIED` | `NOT_REACHABLE` | `true` |

见[手填结果 Schema](../../../contracts/workbench_manual_report_result.schema.json)、[核实结果 Schema](../../../contracts/workbench_verified_manual_report_result.schema.json)。回执不含人员姓名/联系方式、完整描述或 private proof。所有分支均 `external_notification:false`；资格不表示已创建 Delivery 或已送达。T18 不调用 SDK/Sender，后续通知由 T26 与原独立外发开关、Outbox/Delivery 合同承担。

## 4. 幂等、确定拒绝与 GET 回执

账本沿原 authenticated principal＋`WORKBENCH_MANUAL_REPORT` 用途＋UUID，保存规范化原命令的 hash。相同 UUID 改变原意图返回 409，不改写旧命令或快照。业务 savepoint 失败回滚 Intake、Journey/Leg、Decision、Core/Review 等受理事实，原账本可保存 FAILED；没有另建 Ticket、Person、owner 或 receipt 事实源。

核实选择的 POST 成功重放必须先重新验证当前创建权，并对原保存的目标执行 `READ_COMMITTED` 对象授权。并发原命令先提交时，返回前仍补原目标 READ 和人员/目标围栏。GET 最小回执则只沿当前工作人员权限、原 principal 和用途读取原账本，不依赖在线 Directory 或新资料，也不回传对象 profile。

启用本用途恢复后，`GET /api/workbench/reports/commands/{commandId}` 返回 200 的三种闭合形状：

```text
{client_command_id,state:UNKNOWN}
{client_command_id,state:FAILED,error:{code,retryable:false}}
{client_command_id,state:COMMITTED,result:{原受理结果,replayed:true}}
```

见[回执 Schema](../../../contracts/workbench_manual_report_receipt.schema.json)。READ ONLY 事务在读取前与返回前核验当前创建权限。UNKNOWN 不写账本，也不证明未提交；同 UUID 的其它 principal 或其它用途返回 UNKNOWN。失去当前创建权后读取/重放拒绝，不能据此创建新意图重试；闭合保存结果无效为 503。恢复开关关闭时 GET 回执拒绝且不查询账本。

**HTTP 拒绝状态本身不等于确定未受理。** 核实选择的 Directory 前置核验失败后，只有当前创建权限仍有效，且原 actor/body/UUID/purpose 在原账本锁下确定为 FAILED，服务器才返回以下闭合失败信号（403 为示例）：

```json
{
  "error":{"code":"P2_016_FORBIDDEN","retryable":false},
  "receipt":{
    "client_command_id":"00000000-0000-4000-8000-000000000018",
    "state":"FAILED",
    "error":{"code":"P2_016_FORBIDDEN","retryable":false}
  }
}
```

顶层只有 error/receipt，receipt 只有原 UUID、FAILED 和 error；两个 code 必须相同，retryable 均 false，不含资料/目标。原 COMMITTED 不得被失败覆盖，也不通过对象拒绝返回其正文。目录等待期间当前创建权失效，先拒绝，不为该失败新建账本记录。定义与解析见[拒绝类型](../../../contracts/workbench_reporter_candidates_contracts.d.ts)、[闭合 decoder](../../../src/workbench-manual-report-browser-contracts.mts)。

浏览器仅在严格解析同 UUID 的 FAILED 信号且重新读取的当前创建能力仍获准时，结算原标识并允许显式手填。额外字段、错 UUID、矛盾 state/code 或普通错误都不证明失败。提交后权限复验拒绝、网络丢响应等保留 UNKNOWN 和原操作；权限恢复也不自动重提，须由用户显式 GET 核对。真正创建失权仍按原用途清理敏感内容。

| 状态 | 主要情形 |
| --- | --- |
| 400 | 闭合输入、UUID/幂等键、cursor 或参数不合法 |
| 401 | 未认证/会话失效 |
| 403 | 当前创建权或对象权拒绝；是否确定 FAILED 取决于上述闭合信号 |
| 404 | 不支持的路径/方法或既有对象不可读取；不是未提交证明 |
| 409 | 原 UUID 变意图，或选择资料/绑定版本变化 |
| 413 | 请求超过 16 KiB |
| 503 | 关闭、缺必要 schema、配置/proof 不合法、目录不可用/超时/资源超限、业务事务失败 |

422 不使用。稳定错误沿 `P2_016_*` 公共约定；可能提交过的选择命令不能仅凭 code 或 HTTP 状态清除原操作。

## 5. 服务端身份验证 Port（不是公开 REST）

[Port 类型](../../../contracts/workbench_reporter_candidates_contracts.d.ts)与[私有 envelope Schema](../../../contracts/workbench_reporter_verification.schema.json)仅用于受控服务端适配。宿主固定 application、directorySourceScope，以及来自现有映射 authority 的 `mappingConfigHash,mappingProofRef,proofKind,validationProfile`；GET 可不配置 verificationAuthority，VERIFIED POST 必须配置并校验。`SYNTHETIC` 只允许 `ISOLATED_TEST`，`LIVE` 标记不构成现场或发送授权。

身份复用既有 `YxxIdentityMapping` 的 `VERIFIED_DELEGATED_MAPPING/configHash`、`YxxMemberScope` 的 corp/app/canonical scope/proofRef、Directory Provider/Store 与显式 ProviderUidResolver。第三方 user_id、wecom_id、官方 open_userid、Bot UID、姓名或手机号没有自动等价关系；directory.identity_binding 本身也不能证明目标应用账户或消息可达性。

`verifyAuthorizedCandidate` 接收当前 principal、受控 application/目录 scope、原 selection、AbortSignal，及以下互斥用途：

| 用途 | 服务器传入 | Port 成功返回 |
| --- | --- | --- |
| `ADMISSION` | `committed_target_scope:null` | 当前完整 `proof` |
| `READ_COMMITTED` | 从原账本关联 Intake 取得的原 `YxxMemberScope` | 与该原目标精确相等的 `target_scope` |

共同返回闭合字段为 `schema_version:1,purpose,selection,application,directory_source_scope,actor_principal_id,object_access:ALLOWED,authorized_at,authorized_at_epoch_ms,valid_until,valid_until_epoch_ms`，再只允许各自的 proof 或 target_scope。目录等待在数据库事务外；返回后、进入受理事务及回复前按实现重验权限和证明。

ADMISSION 同时检查：用途/selection 精确匹配；envelope/proof actor 为当前人员；两层 corp/app、目录 scope 与宿主相同；mapping hash、scope.proofRef、proofKind 匹配受控 pin；账户 ACTIVE、绑定 VERIFIED；reachability.target_scope_hash 与同目标应用的 proof.scope.scopeHash 相同。STALE/CONFLICT、停用、跨对象/应用或重核失败不能降级或换人。REACHABLE 必须有该目标的独立非空可达性 proof；ACTIVE、目录存在或可登录均不能替代。

`candidate_version` 使用既有 `hashP2016` 稳定 canonical JSON，精确输入为：

```text
{candidate_ref,scope,mapping_config_hash,verification_method,profile_source,
 directory_source_scope,directory_snapshot_version,profile_at_report,
 binding_proof_ref,account_status,binding_state,proof_kind,
 reachability:{status,target_scope_hash}}
```

GET producer 与 ADMISSION producer 基于同一现有权威生成/重算，宿主再次重算。profile 包含报修时姓名、部门；scope 不能从姓名/手机号生成。授权/过期时刻、可达性检查时刻与其短期 proof_ref 不参与版本，避免时钟推进制造版本冲突；稳定资料、绑定或可达性观察改变会使原选择提交返回 409。

绝对时刻采用 Asia/Shanghai 无时区后缀秒精度字符串和 epoch 毫秒字符串双值，须由[时间合同](../../../src/platform/time-contract.mts)验证一致，不能用 Date.parse 猜时区。授权/验证不能在未来，返回时授权不超过 5 分钟；`0 < valid_until_epoch_ms-authorized_at_epoch_ms <= 300000` 且当前时刻未过期。proof.verified_at 与授权时刻相同，reachability.checked_at 不晚于它且间隔至多 5 分钟。envelope 最多 16 KiB；畸形、错 pin、错 actor/app/目标或时间不自洽拒绝，不制造成功。

READ_COMMITTED 只证明当前可读原对象：target 必须与原持久目标一致，不要求旧 candidate_version 等于最新目录版本，不重建 profile/reachability 或改写原结果。原 ADMISSION 的过期时钟不被当成新的授权。实现：[候选边界](../../../src/workbench-reporter-candidates.mts)、[proof 解析与原目标](../../../src/workbench-reporter-verification.mts)。

## 6. 受理规则、MANUAL 复核与来源展示

明确症状经现有纯规则/安全动作执行器进入 Unified Ticket Core；Ticket 状态与编号取 Core，Review 取原队列。高风险、规则不可用、咨询或缺少可判现象沿原路由进入必要 Review。MANUAL 入口的 `WBINT_T17_MANUAL_SYMPTOMS/1.0.0` overlay 只将实际症状“无法打印”映射到既有 `PRINT.NO_OUTPUT`，委托原 AliasResolver、FaultTaxonomyResolver 和规则路由，不修改 BOT/WEB 默认 profile、旧词表或历史规则。

局部 `workbench-manual-print-affirmation/1.0.0` 排除明确否定、纯词义/假设提问；电话转述“打印机无法打印”和“打印机无法打印怎么办”仍可生成症状。原描述、Source 引用、source/input hash 保留；safe_result 的 classification_source 记录实际 base/overlay ID、版本、hash、new_alias_applied 与 affirmation_gate_version。engine=`workbench-manual-rule-adapter/1.0.0`，policy=`workbench-manual-safe-route/1.0.0`。缺少可判现象保留 `NEEDS_DESCRIPTION` 并同事务追加既有 `ENQUEUE_MANUAL_REVIEW`，不伪造已建单或发送催问。见[规则适配](../../../src/workbench-manual-report-policy.mts)。

受理同事务保存原 Intake、Journey/Leg、Decision、Core 或必要 Review、公开资料快照及核实分支 private ADMISSION 观察。不会凭空建立 Channel Message、Conversation、Reporter Access、Communication/Notification Outbox/Delivery；AI 和 Sender 不参与。Core 标题/Intake 摘要沿 200/500 UTF-16 单位上限取完整 Unicode 字符前缀，原描述与 hash 保持。

`GET /api/manual-reviews/{reviewId}` 在当前 Review/Journey 权限与保留期内返回 `material_basis.source_kind:MANUAL`、固定来源 revision 1、原描述材料 `manual:{intakeId}`，不套用 Bot 消息窗口改写原 Decision。`manual_report` 是以下闭合联合：

| 字段 | 手填 | 核实选择 |
| --- | --- | --- |
| 公共字段 | 两者均含 `source_kind:MANUAL_REPORT,source,description,location,actor_principal_id,manual_contact_required,external_notification:false` | 同左 |
| `identity_source` | `HAND_ENTERED` | `VERIFIED_DIRECTORY_SELECTION` |
| `reporter` | `{verification:UNVERIFIED,name,contact,department}` | `{verification:VERIFIED,name,departments}` |
| `notification_eligibility` | 不存在，manual_contact_required 固定 true | ELIGIBLE 对应 false；NOT_REACHABLE 对应 true |

见[联合资料 Schema](../../../contracts/workbench_manual_report_projection.schema.json)、[核实资料 Schema](../../../contracts/workbench_verified_manual_report_projection.schema.json)、[原资料读取](../../../src/workbench-manual-report-source.mts)。核实公开资料不含联系方式、raw 成员 ID、candidate ref、scope/hash、配置或 private proof；T17 联系资料仅在原获权 MANUAL 材料范围内展示，仍未核实，不能用来推断 Person/WeCom 身份。后续目录改名/调岗不更新任一报修时快照。

正式复核页独立显示报修主体与代录主体；仅 actor UUID 等于当前 principal 时取当前工作人员名称，其它 actor 保留实际标识，不按姓名猜身份。看板/列表/详情统一显示“电话代录/现场代录”，核实选择附“本次已核实”，手填附“身份未核实”。沿既有读取权限和保留期，不通过回执授予额外权限，也不为展示查询当前 Directory。[聚合](../../../src/web01-workbench-query.mts)、[复核 facade](../../../src/p2-016-manual-review-facade.mts)、[复核 UI](../../../web/admin-workbench/src/features/manual-review/ReviewWorkspace.tsx)。

MANUAL 复核沿原账本、材料 capture hash/provenance 和事务，仅执行适用的 APP_ONLY 数据库动作。`CONFIRM_TICKET_ELIGIBLE`/`CLASSIFY_SERVICE_REQUEST` 将原 Intake request_type 设为 INCIDENT/SERVICE_REQUEST，再创建原生 Core QUEUED、未分配工单；另外六种合法结论不建单。所有结论保留原来源和 Decision，不自动接单或发送通知；BOT/WEB 原权限、材料和通知语义保持。

## 7. 正式表单、草稿与未知结果

表单通过授权候选 combobox/option 明确选择，提交仍由服务器重新核实。SEARCH 对象拒绝只触发当前创建能力重读；仍获权则保留描述、位置、来源和姓名，用户可以明确改为手填。已发 POST 的拒绝按第 4 节确定信号/UNKNOWN 规则处理；不能把“目录不可用”自动转为未核实提交。

草稿复用 T03 当前浏览器 AES-GCM、不可导出 key、最多 20 份/每份 16 KiB、首次保存后固定最长 24 小时。scope 绑定 principal＋intake＋固定槽位 `00000000-0000-4000-8000-000000000072`＋manual-report 用途；该 UUID 只是浏览器槽位，真实 Intake UUID 仅由受理返回。恢复先核对当前账号和创建能力，只保存业务密文，不保存 Cookie/CSRF 等凭据。

- 未提交时已明确选择：加密保存选择意图，不恢复旧核验资格；刷新后重新选择成员或明确手填。候选开关关闭时保留输入并阻止静默变为手填。
- 已提交结果未知：只保存一次原命令 body、selection ref/version 和 UUID；不得修改原意图、重新选择覆盖或自动 POST。正文过期后仅保留 opaque 操作标识，用户显式 GET 核对。
- 成功、主动丢弃、退出、真实失权和过期沿原 T03 清理。清理尚未确认时禁止新提交；新意图仅在原结果确定及清理条件满足后建立。

沿 T38 authorization epoch/transport fence，新提交先核对连接事实；只读原操作核对不产生新命令。实现：[表单](../../../web/admin-workbench/src/features/manual-report/ManualReportForm.tsx)、[本用途草稿](../../../web/admin-workbench/src/features/manual-report/use-manual-report-draft.ts)、[API client](../../../web/admin-workbench/src/api/client.ts)、[闭合 codec](../../../src/workbench-manual-report-browser-contracts.mts)。

## 8. 数据库、迁移、资源与关闭方式

T17 的 [042](../../../database/migrations/042_workbench_manual_reports.sql) 在同一 Intake 保存人工来源、描述/Reporter 未核实快照、authenticated actor 与原命令引用。T18 的 [045](../../../database/migrations/045_workbench_verified_manual_reports.sql) 增加 nullable `manual_reporter_verification`，约束闭合 VERIFIED public snapshot 与 private envelope 一致；[051](../../../database/migrations/051_workbench_verified_manual_report_candidate_ref_check.sql) 前向修正 candidate_ref 检查为独立长度 32–256 与同 ASCII 字符集，不缩窄 HTTP/JS/Schema 合同、不删除 CHECK。两份历史 SQL 原字节不改，不回填旧 UNVERIFIED、不新建长期身份或 Ticket 事实源。

公开入口是 [migrateWorkbenchVerifiedManualReports](../../../scripts/workbench-verified-manual-reports-migrate.mts)（模块 API，非 HTTP）：

```text
migrateWorkbenchVerifiedManualReports({databaseUrl, mode?:'check'|'apply'})
→ {status:PENDING|APPLIED|NOOP_ALREADY_APPLIED,
   migration_id:'045_workbench_verified_manual_reports'}
```

默认 `check` 不写 schema/ledger，缺 045 或 051 返回 PENDING，完整一致返回 NOOP_ALREADY_APPLIED。`apply` 校验原 042 前置及两份 SQL checksum，在原 advisory lock 与单事务内按 045→051 补缺项；齐备为 NOOP，checksum 冲突或缺前置拒绝。root migration_id 保持兼容，status 代表整条所需链；函数的独立 max1 pool 在 finally 关闭。运行时基础代录要求 033/042；VERIFIED POST 在调用 Directory/创建 receipt 前要求 045 与 051 都有迁移记录，缺项为 503。普通宿主 readiness 的手填项不代替核实选择的写入前检查。

资源维持单 App/Worker、Gateway 单活动连接、SSE 默认 32、共享 pool max4/总预算建议不超过 8。T18 搜索与核验共用一个目录在途位，整次等待加解析上限 2000ms；每 principal 每 60 秒最多 10 次，最多 128 个活跃速率主体、惰性清理，无无限队列或后台全量同步。超时会 abort；适配器忽略 abort 时，在原 Promise 真正结束前继续占用唯一在途位。没有新增常驻 worker；仅使用有界请求 deadline timer。

关闭 `workbenchReporterCandidatesEnabled` 停止候选搜索和核实 POST，保留原快照/账本，既有手填与 GET 回执继续按各自开关和权限工作。关闭原代录用途停止其入口；关闭恢复能力停止本用途 GET 回执。恢复/结构修复使用前向迁移，不能 drop 旧事实、修改旧 SQL、重写历史 proof 或撤掉约束。真实目录/映射适配、外部发送、用户库、部署、full/certify 和 Gate 启用沿原独立授权边界。

## 9. 验证与历史导航

本页只记录当前合同。实际 head、case 结果、历史 RED/SETUP_FAILURE/NOT_REACHED、资源清理与整票收口统一查阅 [T17](../../../plans/admin-workbench-integration/execution/t17.md)、[T18](../../../plans/admin-workbench-integration/execution/t18.md) 执行记录；不能因存在测试文件或实现就推导 PASS。

| 风险/入口 | 主要测试源码 |
| --- | --- |
| 手填、规则、复核与原回执 | [T17 HTTP](../../../tests/wbint-t17-manual-report.integration.test.mts)、[规则](../../../tests/wbint-t17-manual-report-policy.test.mts)、[风险](../../../tests/wbint-t17-manual-risks.integration.test.mts)、[回执](../../../tests/wbint-t17-manual-receipts.integration.test.mts) |
| 候选 GET、核实 POST、正式选择资料 | [GET](../../../tests/wbint-t18-reporter-candidates.integration.test.mts)、[POST](../../../tests/wbint-t18-verified-selection-admission.integration.test.mts)、[生产 bundle](../../../tests/wbint-t18-normal-verified-form.browser.test.mts)、[聚合标签](../../../tests/t18-verified-summary.integration.test.mts) |
| Proof/预算、重放/撤权/回滚、迁移 | [proof/resources](../../../tests/t18-candidate-proof-resources.test.mts)、[admission boundaries](../../../tests/t18-verified-admission-boundaries.integration.test.mts)、[迁移入口](../../../tests/t18-required-migrations.integration.test.mts) |
| 拒绝与恢复 | [明确回退](../../../tests/t18-candidate-refusal.browser.test.mts)、[选择与 UNKNOWN 恢复](../../../tests/t18-selection-recovery.browser.test.mts)、[拒绝 codec](../../../tests/t18-rejection-contract.test.mts)、[拒绝账本](../../../tests/t18-rejection-ledger.integration.test.mts)、[提交后拒绝](../../../tests/t18-postcommit-refusal.browser.test.mts) |
