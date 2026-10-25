# T41 全部获权事项检索与组合筛选

## 2026-10-15 当前实现与本地验证

状态：LOCAL_VERIFIED_PENDING_PARENT_ACCEPTANCE。搜索已接入 W 宿主和正式 React 管理端，`workbenchSearchEnabled` 默认 `false`；bootstrap 通过 `workbench_search_enabled` 声明当前能力。当前部署未据此启用。原生 #96、来源 WBINT-14／A14、父验收和不同 merger 由父任务收口。

本地分段验证为 11 个 T41 文件／23 项适用用例、8 个相关文件／21 项适用用例通过。它们各自绑定真实被测提交和 MF；最终运行 Source 为 `71399419a777c94e934672203a29568f846f1b72`，tree `93f46d2973a8582390403abaf4bfb5d6ad3741f9`，MF SHA256 `d6fe9b6c8527246012b12be783294a4ed51404355337a8da40b87c1e13366144`。三段 MF 的 495 个生产 src／WEB 完整输出条目相等，但不把旧结果重绑成一次最终提交全量运行。原 first 真 RED、后继 GREEN、所有准备失败和中间失败均保留，详见 [T41 原七执行记录](../../../plans/admin-workbench-integration/execution/t41.md)。

原 [619d 冻结设计](search-design.md)、[DTS](../../../contracts/workbench_search_contracts.d.ts)、[criteria Schema](../../../contracts/workbench_search_criteria.schema.json)、[page Schema](../../../contracts/workbench_search_page.schema.json) 保留原字节。其中 SOURCE_ONLY／not mounted／planned 注释描述原冻结对象；当前挂载和运行状态以本节及执行记录为准，不改写原合同历史。

### GET 与有界只读 POST

| 方法与完整路径 | 输入／用途 | 响应 |
| --- | --- | --- |
| `GET /api/workbench/search` | 同一闭合 criteria 的 query 编码，另加可选 `cursor`／`limit`；单值键不得重复，数组以逗号分隔。 | `200 WorkbenchSearchPage`。 |
| `POST /api/workbench/search` | 同一读取的长条件传输；无 query，`application/json` body 必须恰为 `{criteria,cursor,limit}`。 | 同一 `200 WorkbenchSearchPage`，授权、分页、错误与限流预算相同。 |

调用方为 [正式 api.search](../../../app/pc-admin/src/api/client.ts) 和 [搜索组件](../../../app/pc-admin/src/features/search/WorkbenchSearch.tsx)。完整 GET target 不超过原 2048 字节时用 GET，超出时自动改用同路径 POST，保留全部 criteria、cursor 和 limit。POST 沿用宿主 32 KiB body 上限；不截短 q、不放宽全局 URL 上限，也不执行命令或写入 ledger。

两种方法都经过 W 的当前身份认证和对象 READ。Cookie POST 必须提交当前 `X-CSRF-Token`，Origin 必须精确等于当前认证的 public origin，拒绝 cross-site；Bearer 沿既有认证规则。读取不要求 `Idempotency-Key`、`If-Match` 或命令 UUID。正式客户端的读 POST 使用原读取 signal／epoch 和恢复路径，不经过业务命令的 `transportWritable` 门。

### 输入与组合含义

GET 缺省值见下表；POST 的 criteria 必须包含全部 12 个字段，外层 cursor 为 `null` 或合法字符串、limit 为整数。未知键、重复 GET 键、重复数组成员、非法编码、控制字符和孤立 surrogate 均拒绝。

| criteria 字段 | 类型／约束／GET 缺省 |
| --- | --- |
| `q` | 字符串，trim 后最多 128 个 Unicode 码点，缺省空串。按编号、描述、当前可读且留存的报修时资料／位置作不区分大小写的字面子串匹配，`%`／`_` 不变成通配符。 |
| `column` | `all / pending / active / closed`；缺省 `all`。 |
| `range` | `recent / all / cancelled`；缺省 `all`。 |
| `scope` | `team / related`；缺省 `team`，related 使用当前真实处理／沟通／显式关注关系。 |
| `responsibility` | `any / handling / communication / following / unassigned`；缺省 `any`。 |
| `resolver_team_id` | 原团队代码或 `null`；`[A-Z][A-Z0-9_]{1,63}`，缺省 `null`。 |
| `assignee_id` | UUID 或 `null`，缺省 `null`。 |
| `sources` | 最多 5 个、无重复的原来源枚举：`WECOM_DIRECT / WECOM_GROUP / WEB_REQUEST / MANUAL_PHONE / MANUAL_ON_SITE`；缺省空数组。 |
| `source_group_ref` | 原来源群接口的 64 位十六进制不透明 ref 或 `null`；缺省 `null`。同名群按此 ref 区分，不提交 raw 群标识。 |
| `statuses` | 最多 8 个、无重复的既有状态；完整枚举沿 DTS／Schema，不创建搜索状态；缺省空数组。 |
| `supplement` | `any / pending / followed / none`；缺省 `any`。使用 T36 当前可读精确材料、明确内部处置和已核验回复事实。 |
| `schedule` | `any / active / due / none`；缺省 `any`。使用 T37 原当前活动安排与真实到期判定。 |

外层 `cursor` 缺省 `null`，非空时最多 2048 字符；`limit` 缺省 50，范围 1..100。同一数组内部取并集，不同条件取交集。某条件依赖的原开关／Schema 关闭或不可用时返回错误，不把漏掉的来源冒认为完整结果。

响应恰含 `items / next_cursor / column / range / criteria`。`items` 沿当前安全 WorkbenchCard，kind 为 `ticket / review / intake`，可附原 attention／supplement_follow_up／follow_up_schedule；每页不超过 limit，无匹配时空数组、next_cursor 为 null。range 包含 mode、from、until、`Asia/Shanghai`，from／until 是原近期本地窗口，`all` 不因此缩小获权集合。没有 total、hidden_count、内部匹配片段或未经 READ 的材料。

合成请求：

```http
GET /api/workbench/search?q=printer&column=all&range=all&scope=team&limit=50
```

等价 POST 的闭合 body 示例（Cookie 请求另带当前 CSRF 和 Origin，不在示例填凭据）：

```json
{
  "criteria": {
    "q": "printer", "column": "all", "range": "all", "scope": "team",
    "responsibility": "any", "resolver_team_id": null, "assignee_id": null,
    "sources": [], "source_group_ref": null, "statuses": [],
    "supplement": "any", "schedule": "any"
  },
  "cursor": null,
  "limit": 50
}
```

### 当前权限、留存和稳定分页

SQL 先得到当前获权且规范去重的全集，再执行条件、keyset 排序和 LIMIT。同 Ticket 的 Review 不重复；开启原 manualReview 能力时，原详情仍可 READ、无 Ticket 且留存的 COMPLETED／IGNORED Intake 纳入搜索。原活动看板的成员条件不变。资料来自原事实和报修时快照，不逐卡查询第三方目录；可读 Ticket 不使其已到期 Journey／材料重新可见。

游标由当前 App 临时 HMAC 签名，绑定 principal、真实 session、完整当前角色／团队、规范 criteria、时间窗口及 kind／id／排序锚。更换条件、主体、session、权限、日期窗口，或锚已失权／到期／不再匹配时拒绝游标，须从首页明确重读；App 重启也会令旧签名失效。不允许用客户端传入的搜索页面 cursor／limit 作为导航条件。

搜索连接在安全卡片投影之前释放。最后一个只读 SQL statement 同时重核实际 ACTIVE 会话及其绝对／idle／physical expiry、原 principal_role／team_member 当前完整集合、锚与完整安全投影输入摘要。等待期间 logout、离组或材料到期时拒绝整页，不能返回早先保存的姓名／来源等安全字段。真实 Cookie logout／物理到期、最后 readiness 等待中的唯一团队资格撤销、多卡片等待材料到期及 pool=1 已在隔离 HTTP 用例验证。

### 错误与恢复

| HTTP／稳定码 | 调用方处理 |
| --- | --- |
| `400 P2_016_INPUT_INVALID / P2_016_LIMIT_INVALID / P2_016_CURSOR_INVALID` | 修正输入；游标失效须保留输入并从首页显式重读，不能当无匹配。 |
| `400 WORKBENCH_REQUEST_INVALID`、`413 WORKBENCH_REQUEST_TOO_LARGE`、`415 WORKBENCH_CONTENT_TYPE_INVALID` | 沿 W JSON／body 规则修正请求。 |
| `401 WORKBENCH_UNAUTHENTICATED / WORKBENCH_AUTH_EXPIRED`、`403 WORKBENCH_FORBIDDEN` | 沿原认证／权限清理；不得保留旧搜索敏感卡片。 |
| `403 WORKBENCH_ORIGIN_INVALID / WORKBENCH_CSRF_INVALID` | 重新取得合法同源身份与 CSRF，不能绕过读 POST 校验。 |
| `404 P2_016_NOT_FOUND` | 新能力关闭或路径／方法不受支持；回到原工作台能力。 |
| `429 P2_016_SEARCH_RATE_LIMITED` | `Retry-After: 60`、`retryable:true`；保留输入，等待后明确重读。 |
| `503 P2_016_DISABLED / P2_016_ACTION_FAILED` | 所需能力／Schema 不可用或技术失败；展示失败及重读，不冒认为空结果。 |

### 前端、资源、关闭方式与证据边界

显式提交后的同一个查询供看板／列表使用，输入草稿独立保留；URL、切换展示、详情返回和重载使用相同已提交条件。空白、无匹配、输入非法和读取失败分别显示，失败不保留旧搜索卡片，不改变备注／回复草稿。缓存至多 5 页、每页 50，仅显示已加载条数。

T38 周期刷新不自动重搜已加载搜索页，也不把其错误变成全局 offline。实际实时 hint 取消当前主体所有搜索读，包含 data 尚为 undefined 的首次／重置 pending 请求，并清结果、提示人工重读；当前身份／角色变化和 401／403 仍沿原清理。迟到旧响应不得写回。真实双页 55 秒验证仅发出 2 次搜索，仍可实际点击原合法人工命令；128 emoji 条件的下一页通过 POST，保留原 2048 字节 URL 上限。

全 App 同时最多 1 次搜索；每 principal 每 60 秒 20 次；限流表最多 256 项／TTL60 秒。新主查询及末次核验各在局部只读事务设置 statement_timeout=2000ms；这不是整个 HTTP 延迟上限。原池总预算≤8、fixture≤4、单 App／Worker、Gateway 单活、SSE32 保持。隔离 pool=1／500 Source Intake＋2000 条材料的 PG18 实测计划 Limit2、15.986ms、无 temp spill；仅说明该本地规模，无生产容量推论。无数据库变更、无新增 SQL 迁移或索引、无第二 Ticket／事件／Owner 事实源。

将 `workbenchSearchEnabled=false` 即关闭搜索 HTTP／UI，回到原分页看板／列表，不改业务事实或草稿。未执行真实 WeCom／Provider／OAuth／外发／部署／full／certify／Gate。Node24.18.0 的 strict、各实际一次构建／制品和分段测试见执行记录；原 PG／浏览器已精确释放，此后只进行静态归档和文档。浏览器证据使用正式 bundle、原 PG 与 loopback HTTP；网络延迟／失败为明确受控输入，不证明真实现场或生产／临床可用。

源码入口：[HTTP](../../../app/server/src/workbench-search-http.mts)、[查询与当前核验](../../../app/server/src/workbench-search.mts)、[纯闭合解析](../../../shared/workbench-search-contracts.mts)、[端口](../../../app/server/src/workbench-search-port.mts)、[装配](../../../app/server/src/p2-016-runtime.mts)。本票验证：[原 HTTP first](../../../tests/wbint-t41-search-http-first.integration.test.mts)、[合同](../../../tests/t41-search-contract.test.mts)、[获权分页](../../../tests/t41-search-pagination-authority.integration.test.mts)、[当前读取](../../../tests/t41-search-current-read.integration.test.mts)、[长读](../../../tests/t41-search-long-read.integration.test.mts)、[末次范围](../../../tests/t41-search-final-scope.integration.test.mts)、[T15组合](../../../tests/t41-search-review-start.integration.test.mts)、[全部字段／来源／PG](../../../tests/t41-search-acceptance.integration.test.mts)、[正式 UI](../../../tests/t41-search-production.browser.test.mts)、[pending hint](../../../tests/t41-search-pending-hint.browser.test.mts)、[两页／Unicode／T38](../../../tests/t41-search-refresh-and-long-pages.browser.test.mts)。

---

以下为历史 SOURCE 准备原文，NOT_RUN／PENDING 保留当时对象，不覆盖上述当前分段结果。

# T41 检索 Source 增量，未构建或运行

状态：SOURCE_ONLY / NOT_BUILT_NOT_RUN。基线619d2245402a493e50daddef591527a710c67a3b及其原HTTP first、helper、三份Contract原字节保留。[初始冻结合同](search-design.md)描述619d未实施对象；本页记录其后候选源码，不能当作现有已验证HTTP或T41验收。原七项仍全部PENDING。

## 当前候选源码

P2016 Runtime新增默认false的workbenchSearchEnabled，HTTP/bootstrap候选接线与React可选入口已写入。没有修改部署环境、持久Feature Flag、旧SQL、历史Evidence或Ticket事实源。

GET /api/workbench/search只读。共享纯解析器执行闭合键、重复键、q128码点、枚举/数组、标识、limit1..100和cursor2048上限；HTTP另拒绝非法编码Unicode。原声明和两份闭合Schema保持原字节。错误码P2_016_SEARCH_RATE_LIMITED按已冻结计划加入原闭合码表，429携Retry-After和retryable=true；未引入第二套错误框架。

同一路径补充只读POST：无query参数，body严格为已有WorkbenchSearchRequest的{criteria,cursor,limit}，criteria仍按原闭合DTO解析；沿用宿主32KiB body上限、Content-Type、Origin/跨站与Cookie-CSRF核验；超大body沿原413，JSON/结构非法沿原400，失权保持原401/403。它不要求命令UUID/版本，不写业务或ledger，与GET共用当前READ、完整criteria/HMAC绑定和同一速率预算。正式api.search在完整GET target超过原2048字节时改用此读传输，包含全部原条件、cursor和limit；不截断q或省略条件。GET及宿主URL上限不变。POST沿原READ的signal/epoch、失权与技术失败路径，不经过transportWritable命令门，故仍可用于恢复读取。此接口仅是未构建/未运行的Source候选。

获权规范cards复用原查询CTE。SQL在授权/规范去重之后、ORDER/keyset/LIMIT之前执行编号、描述、留存报修时资料/位置以及责任、来源、原群ref、细分状态、补充、共享时间的AND/OR组合。没有当前页搜索、第三方逐卡目录、总数、隐藏计数、匹配片段或额外全局候选列表。

manualReviewEnabled开启时，搜索将原详情端口可读的COMPLETED/IGNORED无Ticket Intake SELECT并入获权全集；原详情与搜索复用同一SQL文字，保留其授权、留存和Ticket去重条件。原分页看板仍用原活动CTE。该Intake的近期筛选按现有updated_at判断，输出原completed_at仍可为null；没有新增状态、关闭事件或事实源。

T23来源origin关系、T36可读精确材料及已核验响应、T37当前活动安排各从原模板抽成同一个内部SQL常量；原用例与新查询共同引用，未复制第二套事实。T34责任/关注谓词复用原定义。若需要的功能关闭或Schema不可用，拒绝对应条件；网页来源存在而网页绑定Schema缺失时拒绝，不能悄悄漏搜后当完整结果。

游标由当前App临时HMAC秘密签名，绑定principal、原认证session_id（只有既有本地测试profile可由其当前csrf派生不可逆绑定）、角色/组、全部规范criteria和窗口、kind/id/order。不包含rawCookie/csrf。变化或当前anchor已失权/过期/移出匹配条件时400 CURSOR_INVALID；App重启后旧签名失效。

SQL分页完成先释放连接，再复用原公开事项投影。随后新的只读事务在同一末次statement中核验实际认证会话、当前完整角色/团队集合、anchor、选中对象完整投影输入的SHA256摘要和当前continuation。角色和团队从原principal_role、team_member事实读取，集合必须与已绑定principal完全相等；不会在末次readiness等待后继续信任旧团队参数，也不增加授权事实源。认证owner提供原workbench_auth_session、ACTIVE、principal、绝对期限、配置的idle期限及physical clock谓词；入口authContext摘要不能代替当前认证。会话失效401，当前角色或团队变化400。末次输入摘要覆盖当前安全姓名、来源/保留期、匹配条件及排序等，不只比较kind/id/order；等待期间发生变化则400拒绝整页，不返回旧安全字段。next_cursor根据最后当前授权匹配关系重新判断，不沿用早先第limit+1条。没有在持有搜索连接时再等待原投影取得另一条连接。以上均为代码意图；并发、pool=1和实际隐私行为未运行验证。

## 前端与有界读

默认关闭时保留原看板/列表。开启后的显式搜索使用一个查询供三列和列表展示，不为每列并行请求。条件编码与后端复用纯解析器；query key包含完整criteria、当前账号、权限revision/角色和认证到期。初次搜索默认跨全部日期，并包含已取消的当前可读事项；显式近期/取消范围仍被遵守。原分页看板的取消分栏语义不变。列表/看板、详情返回、重载沿同一URL条件。URL中不接受搜索页面自带cursor/limit冒充当前分页。

输入与已提交条件分开；切换展示或外部范围不会覆盖尚未提交的q。提交/改条件传递原AbortSignal，关闭或权限开关回落会取消并清理本票查询；旧回包继续受原读取epoch围栏约束。缓存至多5页、每页50，显示已加载条数而非总数。空条件、无匹配、读取失败分别显示；失败不展示旧搜索卡片，不触碰备注/回复草稿。原事项失权保留board查询族的清理接线，搜索的实时刷新方式见下段。

T38周期刷新不再自动重搜已加载的搜索页，也不把搜索429/技术失败当作全局连接失败。搜索仍保留在原board族，当前身份/角色变化和401/403继续原清理；实际实时hint取消当前principal的全部搜索读，包括data尚为undefined的首次或显式重置请求，并清除结果、提示人工重读。原Query取消和READ AbortSignal约束迟到回包；不在后台重搜、不清搜索输入或业务草稿。20次/分钟和其余资源上限不变。

T15验收后的bfd0331ea060f0830d2d85df9868e60ae73e856c通过普通merge并入本票源码。确认复核并开始处理仍沿用原canonical Ticket查询；装配保留两项独立默认false开关和T15用途清理分支。新增tests/t41-search-review-start.integration.test.mts覆盖真实T15命令后的同Ticket搜索去重、待处理/处理中条件及无权人员隐藏结果，selection为wbint-t41-review-start，并追加到wbint-t41-search。此组合测试只有源码，尚未执行；619d与原HTTP first、helper及三份Contract保持不变。

全App同时最多1次搜索，单principal每60秒20次，限流记录最多256、TTL60秒。新的主查询及末次权限/匹配复核使用局部只读事务和每statement 2000ms超时。原认证及事项安全投影继续走原有受限接口，其实际耗时必须在whole窗口测量；不能把新主查询的statement上限说成整个端到端请求耗时证明。池总<=8、fixture<=4、单App/Worker、Gateway单活、SSE32不变。没有新队列、搜索服务、DDL或索引。

## 待执行与停止线

1. 在619d或未包含本次实现的同步基线，先运行原2883字节HTTP first，区分准备失败与实际HTTP RED；原件不改。
2. 在当前候选真实对象执行适用strict、一次构建、制品绑定和本票测试；当前所有此类结果都是NOT_RUN。
3. 已新增纯合同、分页/当前READ/同名群/关闭/限流HTTP及生产bundle浏览器测试源码，均未运行；不能凭测试文件存在说通过。报修时各字段、所有来源与组合、T36/T37细分状态、同principal不同真实session、实际角色变化、retention、晚到读取和PG EXPLAIN/容量仍需逐项真实验证或补充必要测试。
   本轮另冻结真实Cookie会话logout/physical expiry等待、闭合Intake、跨卡片等待到期、GET/长POST等价/非法与超限拒绝，以及51匹配事项的生产浏览器长Unicode分页和两页T38/人工命令源码。风险测试-only祖先保留五个缺陷，尚无实际RED或PASS。
   dcf6的有限Source审查又指出末次readiness等待中的团队失权、首次/重置pending搜索未被hint取消两项同根残余。82bc0154b4c319226ef3e4ccb8de097ed0febf9b是保留dcf6生产源码的test-only后继，冻结了真实Cookie HTTP等待撤销唯一团队资格，以及真实生产浏览器扣留成功响应、Ticket转派失READ、身份revision不变、真实持久SSE hint先到的两种pending场景。此基线及后来修补均未构建、未运行；应在授权whole窗口先观察真实失败，再验证当前候选，不能把本说明或测试文件当作结果。
4. 根据真实查询计划决定必要索引，当前无DDL。原46SQL和原Contract保持不变，不能为通过测试缩窄范围、增加上限或绕过授权。
5. 全七项/来源WBINT-14/A14执行记录、两轴非作者审查、自有运行资源清理、父验收与独立merger尚未完成。本SOURCE author不自验收，不关闭Issue。
6. 未执行types/build/tests/install/PG/browser、真实外部服务/发送、部署、full/certify或Gate。关闭新flag回到原分页看板/列表；事实和业务草稿不变。
