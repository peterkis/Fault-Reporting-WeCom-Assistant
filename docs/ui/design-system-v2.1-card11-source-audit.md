# v2.1 卡 11：事实来源核查与待确认实施方案

状态：**方案已确认，本地业务、types、制品验证完成；工具回归与 PR 收口单独记录**。日期：2026-11-02，Asia/Shanghai。

核查基线：本地 `main` 与 GitHub `main` 均为 `fff6aaa2c0ae00c727746516923bc34bb5bfd2ac`（PR #130 合并点）。开始时工作区干净、仅有主工作树。准备阶段仅写本文件和 Proposed ADR；用户确认后已进入只读实现和任务专用 loopback PG18 合成验证，不访问现场数据库。

需求依据：[v2.1 §3.2、§3.3、§4.1](design-system-v2.1.md)、用户本轮卡 11；原型为展示参考，后端任务不修改画板或前端。

## 1. 事实来源表

| 需求来源 | 现有存储及读取路径 | 核查结果与拟采用规则 |
| --- | --- | --- |
| 人工复核确认服务 | `intake.manual_review_item` 的 `resolution_decision_id`、`resolution_code`、`resolved_by_principal_id`、`resolved_at`；关联 `intake.deterministic_decision.safe_result`。写入见 [manual-review](../../app/server/src/p2-015-manual-review.mts) 第 185–282 行，装配见 [facade](../../app/server/src/p2-016-manual-review-facade.mts) 的 `runResolution`。 | **存在人工复核结论，尚未找到服务代码被单独确认的生产写入。** `ReviewCommand` 不接受服务代码；`safeResult` 复制原 `safe_result`，只改结果、原因、复核标记并增加 `human_override`。因此 `HUMAN_OVERRIDDEN` 或 `CONFIRM_FAULT` 不能单独证明 `MANUAL_CONFIRMED`。拟仅接受有明确服务字段的人工事实；当前普通复核记录不升级来源。 |
| 报修人显式选择 `service_code` | `intake.web_submission.safe_content.service_code`，取该 Intake 初始 `kind='SUBMIT'`；通过仍有效的 `intake.web_request_binding` 关联。写入见 [self-service-store](../../app/server/src/yxx-self-service-store.mts) 第 49–61、160–161 行；已有读取见 [ticket-query](../../app/server/src/p2-016-ticket-query.mts) 的 `webReportForTicket`、[review-facade](../../app/server/src/p2-016-manual-review-facade.mts) 的 `webReportForIntake`。 | **已有真实存储与读取路径。** 只读当前获权、未撤销且未过期的初始提交；显式代码与当前未解决冲突一并核验。H5 v2 无此字段时不补猜。通过时返回 `REPORTER_EXPLICIT`。 |
| 规则引擎确定性事实 | `intake.deterministic_decision.safe_result.known_fields.selected_service_code` 与 `fact_provenance`；还包括版本、`decision_ordinal`、输入窗口/修订、`source_kind`。纯函数见 [rule-engine](../../app/server/src/p2-007-rule-engine.mts) 第 383–425 行；安全投影见 [decision-router](../../app/server/src/p2-015-decision-router.mts) 的 `safeFacts`、`known_fields`；持久化见 [decision-store](../../app/server/src/p2-015-decision-store.mts) 的 `record`；Bot 调用见 [orchestrator](../../app/server/src/p2-015-rule-first-orchestrator.mts) 第 241–266 行，Web 调用见 [Web orchestrator](../../app/server/src/yxx-self-service-orchestrator.mts) 第 357–378 行。 | **已有持久化结果。** 不重新运行规则或解析标题。只使用当前相关来源的有效判定，代码须与 `ACTIVE / AFFIRMED` 的服务事实一致；冲突、候选、被替代/拒绝事实、单纯上下文继承不作为确定分类。通过时返回 `RULE_DETERMINISTIC`。 |
| 服务名称与大类 | [ServiceCatalog](../../app/server/src/p2-007-service-catalog.mts) 的 `lookupService`、`listServices`、`listCategories`，当前目录由既有装配的 Catalog/RuleEngine 拥有。目录装配已有 [resolveYxxServiceCatalog](../../app/server/src/yxx-self-service-runtime.mts)，运行入口见 [P2-016 runtime](../../app/server/src/p2-016-runtime.mts)。 | 名称、大类只取当前生效 Catalog，不使用判定中的旧名称。注意 `lookupService()` **会返回已禁用项**，投影必须额外核验 `enabled === true`。无法证明目录与当前规则装配一致时，卡片 `service=null`、目录接口 503，不私自另载示例目录。 |
| 当前状态起始时间 | `pilot_ticket.ticket_event` 的 `old_status/new_status/aggregate_version/event_ordinal/created_at`；现有 `CARD_SQL` 已用同表读取完结事件。状态定义见 [state-actions](../../app/server/src/p1-006-ticket-state-actions.mts) 第 76–110 行；当前分列见 [board-query](../../app/server/src/web01-workbench-query.mts) 第 18–26 行。 | 足以只读推导 Ticket 当前状态起点，无需迁移。按事件版本和序号读取最近一次真正进入当前状态的事件；不使用 `updated_at`、备注时间或 Timeline 投影。 |

补充：`HUMAN_OPERATOR_CONFIRMED` 已列在 [FactProvenance](../../app/server/src/p2-007-fact-provenance.mts) 的类型与验证白名单中，但全仓生产源码检索只找到定义，没有找到生成服务确认事实的调用。测试中的合成 Fact 不证明生产已有确认流程。

规则来源还存在命名差异：现有引擎会把确定性文本/别名命中的服务事实标为 `REPORTER_EXPLICIT`；安全投影保留 `source_kind` 和 `rule_id`，未保留 `reason_code`。因此不能仅根据该 `source_kind` 判断报修人曾在表单中选择代码。拟以初始 Web 提交证明显式选择，其余可证明的当前确定性结果归 `RULE_DETERMINISTIC`，不改原事实及规则。

## 2. 待确认的服务取值规则

以下方案已获用户明确确认；最终实现与检查结果另见下方交付记录。

1. 先取得有当前 READ 的规范事项，再沿既有 Intake / Journey / Ticket 精确关联读取来源，遵守来源保留期、Web 撤销条件和原读取边界。不能按同姓名、同 Reporter 或时间接近关联；不能借 Ticket READ 旁路读取其他来源。
2. 只在同一来源的有效判定链中按 `decision_ordinal` 定位当前判定，并核查原输入窗口或 Web 修订是否仍适用。新判定变为未知/冲突时不复活旧确定代码；多个相关来源不能按全局时间简单取最后一条。
3. 可用事实优先级为：明确人工服务确认 > 初始 Web 显式代码 > 当前确定性服务事实 > `null`。优先级用于选择已被证明且无未解决冲突的事实，不用来掩盖仍存在的相反断言。
4. `HUMAN_OVERRIDDEN` 本身不构成服务确认。只有复核决议确实绑定了 `service.selected_service_code` 的 `HUMAN_OPERATOR_CONFIRMED / ACTIVE / AFFIRMED` 事实，且与服务代码和操作主体对应时，才可返回 `MANUAL_CONFIRMED`。现有普通复核没有这类事实时，沿可证明的低优先级来源读取；有未解决冲突则整体返回 `null`。
5. 服务字段相关的冲突、多个互不消歧的有效代码、未确认建议、来源失效或不能证明归属时返回 `null`。不因缺位置等与服务分类无关的字段而一律清空已确定服务。
6. 选中的高优先级代码在当前目录不存在或已禁用时，返回 `null`，不偷换成低优先级的另一个服务。名称与类别由同一有效目录快照解析。
7. 本卡不增加人工服务确认写命令、事实补写或数据库迁移。`MANUAL_CONFIRMED` 的正向测试只能明确标为“既有事实格式的合成查询夹具”，不能称为真实人工确认端到端通过。若要求当前界面实际产出该来源，须另行确定写入合同，再讨论独立任务。

## 3. `stage_entered_at` 拟定语义

这里的“当前状态”是 Ticket 的真实状态，区别于三列 `column`。`IN_PROGRESS → WAITING_VENDOR` 没有跨列，但必须重新起算；恢复回 `IN_PROGRESS` 也必须重新起算。

| 场景 | 只读时间来源 |
| --- | --- |
| 接单后 `ACCEPTED` | `ticket.accepted` 事件的 `created_at` |
| 开始后 `IN_PROGRESS` | 当前这一轮 `ticket.started` 事件的 `created_at` |
| 挂起等待 `WAITING_REQUESTER / WAITING_VENDOR` | 当前 `ticket.waiting_requester / ticket.waiting_vendor` 事件的 `created_at` |
| 恢复后 `IN_PROGRESS` | 最近一次 `ticket.resumed` 事件的 `created_at`，不沿用首次开始时间；包含已有 SYSTEM 恢复事件 |
| 备注、同状态转交等 | 不重置，过滤 `old_status IS NOT DISTINCT FROM new_status` 的事件 |
| 初始、重开、结束状态 | 若有匹配当前状态的真实进入事件，返回其时间；不把上次同名状态的时间当本次起点 |
| 缺事件或无法证明当前状态起点 | `null`，不以 `created_at / updated_at` 补造该字段 |
| 非 Ticket 的 Intake / Review 卡片 | 拟返回 `null`；此类事项不是 Ticket 状态事件的拥有者 |

排序使用 `(aggregate_version DESC, event_ordinal DESC)`，不靠秒级时间排序。输出仍为 `YYYY-MM-DD HH:mm:ss`（北京时间），不改时间合同。

前端后续使用规则保持用户原决定：待受理热度取 `created_at`，处理中取 `stage_entered_at`，已处理不计算热度。字段可返回结束状态的进入时间，但不产生结束事项热度。

## 4. 只读目录接口草案

`GET /api/workbench/service-catalog`，宿主 W，沿既有默认关闭的工作台生命周期启用条件。只允许当前有效的内部工作台 Principal 读取；成员 Cookie/Reporter Grant 不构成工作台身份。只读用户不需要写权限，也不需要 ADMIN 或来源群维护权限。

```json
{
  "schema_version": 1,
  "catalog_version": "synthetic-v1",
  "categories": [
    {
      "category": "DIAGNOSTIC",
      "category_name_zh": "检验与影像结果",
      "services": [{"service_code": "DIAGNOSTIC.PACS", "name_zh": "合成影像服务"}]
    }
  ]
}
```

示例只说明 DTO，示例版本和名称不代表实际目录配置。

- 只输出顶层版本、大类代码/名称及启用服务的代码/名称。禁止直接序列化原 Catalog 对象；不返回别名、责任组、规则、哈希或内部来源信息。
- 成功和错误沿宿主 `Cache-Control: no-store`。匿名/过期会话为 401，非有效内部 Principal 为 403；目录缺失、无法证明一致性或投影失败为 503。鉴权错误不被伪装为目录失败。
- 不新增 query/body 参数；未知或重复 query 按现有封闭输入规则拒绝。写方法不提供命令。
- 规范补充建议：复用现有成员目录的版本/代码最多 64 字符、中文名最多 80 字符、启用服务总数最多 200 的边界；大类数组最多 200 项、只包含至少一个启用服务的大类。理由：复用已有目录输出预算，支持新增大类而不写死当前 11 类。超限返回 503，不截断为不完整目录。
- 目录投影使用当前装配拥有的同一 Catalog；不向 Provider 发请求。目录读取前后保留当前内部身份核验，不新增发送、写入或默认启用能力。
- 本卡不接前端筛选。后续前端卡在 503 时不显示筛选，仍保留原工作台读取；401/403 按原身份处理。

## 5. 合同与旧客户端兼容方案

现有 board/detail 的 `decodeCard` 按已知字段读取，会忽略新字段；**高级搜索的 `decodeSearchPage` 会按白名单拒绝未知卡片字段**（[client](../../app/pc-admin/src/api/client.ts) 第 92–128 行）。服务端 [search](../../app/server/src/workbench-search.mts) 第 205–210 行又调用 `cards.authorizedItem()`，因此不能将“JSON 加字段”直接等同于所有旧客户端兼容。

拟定方案：

- 在 [web01 types](../../contracts/web01_workbench_contracts.d.ts) 增加服务 DTO 与两个只读字段；为兼容旧响应，基础卡片类型允许字段缺席，升级后的 board/detail 总是明确返回对象或 `null`。
- 新增 board/card/detail 的对应 JSON Schema 与目录响应 Schema；当前仓库没有独立 WEB01 board/card JSON Schema，不能把搜索 Schema 当成看板 Schema。
- **搜索响应本卡保持原形状**：在查询组合中限定投影只用于 board/detail，或在搜索边界显式省略这两个字段，不放宽旧搜索解析器白名单，不改变搜索业务条件/游标/权限。
- 搜索的卡片类型据此显式排除新增字段；既有搜索 Schema 不增加这两个字段。未来搜索也需要分类时，再按相应前端卡同步合同与解析。
- 正式更新 [board API](../api/workbench/board.md)、[endpoint index](../api/endpoint-index.md) 与 DTO/Schema 在用户确认后进行；当前文档只是一份提案，不将接口登记为已实现。

## 6. ADR 归属建议

建议新建 [ADR-0052 草案](../../adr/0052_workbench_service_and_stage_read_projections.md)，保持 **Proposed** 等待确认，不修改 ADR-0021 的 Accepted 决定。

理由：ADR-0021 定义成员自助报修与成员目录，本卡新增的是内部工作台读边界，并确立跨 Intake/Decision/Ticket 的来源优先级和状态事件投影。将来消费者会依赖 `source` 的含义；把人工分类误当服务确认、将已有搜索悄悄扩字段都难以发现。独立记录边界与保守取值的取舍，避免把成员身份扩大到工作台。ADR-0021 作为已有显式 `service_code` 事实来源继续引用。

## 7. 确认后的实施与验证范围

本方案只修改只读投影、DTO/Schema、HTTP 读取装配、相关测试和文档。不改规则引擎、责任路由、Ticket 命令/状态机、持久事实、默认 Flag；不新增运行时依赖，不新增迁移。

投影在既有规范 READ 过滤之后按整页读取，避免每张卡追加 SQL；异步等待后重新核验当前 Principal、规范事项 READ 和相关来源有效性。目录与服务字段在同一请求中使用一致目录，来源超限/不完整时不当作确定事实。性能验证复用真实 PG/HTTP，记录不同页大小的 SQL 次数。

| 验证组 | 必须覆盖的行为 |
| --- | --- |
| 查询单测 | 三种来源、优先级、同/跨来源未解决冲突为 null、disabled/unknown code 为 null、无事实为 null、人工分类不升级为服务确认、旧确定结果不覆盖较新未知/冲突、纯上下文继承和未确认候选不输出 |
| 状态时间 | accept、start、两类挂起、人工/SYSTEM resume、同秒事件序号、重入相同状态、备注与同状态转交不重置、缺事件为 null；旧状态/权限/回执/次数断言保持 |
| 真实 HTTP / PG | 匿名/成员/失效内部主体拒绝、有效内部只读用户成功、目录不存在/禁用/超限返回 503、响应闭合字段与 no-store、等待后失权及来源撤销不泄露 |
| 兼容 | 当前旧 board/detail 解析能接收新增字段；旧搜索得到原形状且继续成功；旧响应缺字段仍可解析；不通过放宽所有未知字段来“修复” |
| 日常门禁 | 活动 selection 为 `v3-p09`；一次 `npm.cmd run migration:build`、`node .build/tools/gate.mjs types`、已注册相关测试与适用工具回归、`node .build/tools/verify-artifact.mjs`、自有资源清理；不将定向结果称为 full/certify |
| PR 与交付 | 用户已授权提交、HTTPS 推送、用 pr skill 创建 PR、`@codex review` 并修复 P1/P2 至当前 head 收口、适用 CI 通过后合并、main 快进及仅自有分支/工作树清理；该授权在事实来源表与 ADR 确认后执行 |

## 8. 本轮准备阶段的实际交付与自检

- 新增本核查文档与 Proposed ADR；合同、源码、Schema、测试、前端、依赖和数据库未改。
- build/types/artifact/selection/Stylelint/ESLint：**NOT_RUN**（尚未进入实现，不能声称本卡验证通过或违规数为 0）。文档差异与本地链接另行检查。
- 四宽前后截图、原型并排、彩色面积、每区域 primary、卡片缺失文案、heat 常量：**不适用本轮后端准备工作**，未生成假对照；后续前端实施卡负责其可见行为。
- 业务命令/状态/权限未改：是，以仅两个 Markdown 文件的差异为证；测试选择器和断言未改：是，测试文件差异为空；新增颜色：无。
- 当前没有证明需要数据库迁移。确需新增持久事实或服务确认写入时，按用户要求停止并另报。
- 下一张前端卡的完整服务/热度前置条件：**尚未满足**，须本卡实现、验证、审查与合并完成后再判断。
- GitHub 检索 `repo:peterkis/Fault-Reporting-WeCom-Assistant is:issue "v2.1"` 无匹配；本轮由用户直接卡片请求启动，不冒称已领取或关闭对应 Issue。

用户确认：事实表、保守来源规则、状态时间/非 Ticket null、搜索兼容边界、目录输出预算及新 ADR 均于 2026-11-02 获明确确认。上文“准备阶段”记录保持该时点含义。


## 9. 实施进展与审查修复

已增加两个只读投影、内部只读目录、DTO 与四份 Schema；Schema 进入现有制品资源清单。仅 board/detail 输出新字段，authorizedItem 的搜索形状保持。详情终检继续支持原获权 COMPLETED/IGNORED Intake 及 Review alias。每页来源查询按集合读取；初步测得 1 卡与整页均为5次经过测量包装的查询（Principal 查询由原授权 Port 单独执行）。服务来源每事项最多100个上下文、每上下文最多100个服务事实，超限返回 null，不截断为确定事实；SQL 仅携带服务所需字段与冲突标记。

本地两轴复核发现并修复：同 Journey 跨 Intake 的旧判定复活；已失效显式代码仍参与冲突（包含跨 Intake 组合）；终态 Intake 详情路径退化。保留未解决相反事实为 null，已由当前 Journey 判定明确退役的旧选择不否决新确认。人工确认正向仍只代表合成既有事实格式，不代表已增加生产确认命令。

原 `integration-02` 新测试将认证前停用账号误期望为403，实得401；修正测试前提，分别保留认证前401与认证后失权403，未改认证行为。后继 `integration-03` 10/10、`integration-04` 12/12 通过；这些均只绑定各自构建输入，不补充最终候选结果。原件位于 `D:\CodexEvidence\v21-card11-20261102-116a9f65`，初次失败继续保留。


## 10. 发布前本地验证快照与文件清单

2026-11-02：Node 24.18.0、任务专用 loopback PostgreSQL 18。最终工作区输入 `d5bf8fbd8e1876e5f4882e63ea71f0937c09943d1662c5dbaa901762d2120dd2`，manifest `6f10d78abf1535e3adf6c31e6625f3556f78d8567409c5938dcbee65c0f5e9ae`。原工作区 HEAD 为核查基线加本任务未提交差异（dirty=true）；隔离发布快照复制同一组业务/合同/测试字节并校验 SHA-256，PR 的提交身份及 CI 由 GitHub 独立核验，不把基线 SHA 冒称这些增量的 tested_head。

- `npm.cmd run migration:build`：PASS；913 个编译模块语法通过，2747 个制品输出。
- `node .build/tools/gate.mjs types`：PASS；`node .build/tools/verify-artifact.mjs`：PASS，制品仍为 NOT_ACTIVATED。
- 8 个相关已登记入口：38/38 PASS，fail/cancelled/skipped/todo 均为0。包含 WEB01 单测/HTTP/生产 bundle 浏览器、T41 合同/生产浏览器/当前读取权限、P2-016 HTTP 与 T25 装配。它们是活动 v3-p09 基线 flags 下的相关路由入口，不称245文件活动全集或 full/certify。
- Stylelint 与 PC feature ESLint：各0违规；350个本地文档链接和新增 Schema 引用无缺失。
- 制品资源清单变化对应的 Windows 工具回归仍在独立冻结工作树执行；最终结果随外部原件与 PR 正文收口，未预记 PASS。PR 当前完整 head 的审查/CI、合并与清理以 GitHub 和最终交付说明为准。
- 原 `candidate-05` 选择包装器曾因把“已登记相关入口”误限为活动 selection 子集而在测试前报 UNKNOWN_REGISTERED_TEST；已更正包装器，未改路由注册/宿主/flags。`candidate-05-routed` 保留33 PASS/1 FAIL，失败为 Windows D-temp 前提，另1入口 NOT_RUN；改用自有 D 盘 TEMP 后 `candidate-05-dtemp` 同一业务输入38/38通过。早期 `integration-02` 9 PASS/1 FAIL 继续保留。
- 无数据库迁移、生产依赖、部署、真实发送或 Gate 推进。full/certify 未运行。人工服务确认正向仅为合成事实夹具；当前生产仍没有服务确认写命令。

自检（后端适用范围）：

| 清单项 | 结论与证据 |
| --- | --- |
| 后端仅新增只读投影/接口 | 是；生产差异限查询、HTTP 读取和目录装配，无数据库/写命令/规则/路由变更 |
| 选择器与业务断言保持 | 是；原测试断言、状态/权限/请求/回执/次数保持，新增边界与兼容用例；未改前端选择器 |
| 新颜色经 Token、lint | 是（无新增颜色）；现有 Stylelint/feature ESLint 各0 |
| 颜色四层语义 | 不适用：没有可见界面变化 |
| 卡片缺失文案 | 不适用：本卡不改前端文案 |
| 每区域 primary | 不适用：本卡不改控件 |
| heat 常量 | 不适用：只提供状态起点，热度计算留给前端卡 |
| 四宽并排截图 | 不适用：用户确认本后端范围，未制造视觉前后差异；生产 bundle 浏览器回归不代替四宽设计验收 |

下一前端卡的服务与状态时间接口前置已在本地具备；从 main 接续以本 PR 合并结果为准，本卡不自动启动后续前端实施。

最终差异文件（18）：

- `adr/0052_workbench_service_and_stage_read_projections.md`
- `app/server/src/p2-016-runtime.mts`
- `app/server/src/web01-workbench-http.mts`
- `app/server/src/web01-workbench-query.mts`
- `app/server/src/workbench-card-projections.mts`
- `contracts/web01_workbench_board.schema.json`
- `contracts/web01_workbench_card.schema.json`
- `contracts/web01_workbench_contracts.d.ts`
- `contracts/web01_workbench_detail.schema.json`
- `contracts/workbench_search_contracts.d.ts`
- `contracts/workbench_service_catalog.schema.json`
- `docs/api/endpoint-index.md`
- `docs/api/workbench/board.md`
- `docs/ui/design-system-v2.1-card11-source-audit.md`
- `tests/helpers/web01-workbench-fixture.mjs`
- `tests/web01-workbench.integration.test.mjs`
- `tests/web01-workbench.test.mts`
- `tools/ts-migration/resources.json`
