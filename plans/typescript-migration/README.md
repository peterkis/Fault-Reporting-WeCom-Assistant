# TypeScript 增量迁移执行入口

ACTIVE_SELECTION: v3-p09

## P09 合并后业务入口（2026-10-05）

P09 / [PR #48](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/48) 已合并为 `a8e2ec512dee126db8f08b518aeedcebdc5c314d`；已完成 full、审查与 CI 仍绑定发布 head `e5a7e79296d5a4385ddf43489766ae95d9937f6f`，不改称 merge commit 的新运行。业务 TypeScript 主线保持 169/181，PR38 三个增量另列、10 个 G0 与 12 个 D01 工具保留。

R00 决策后恢复局部业务开发。首个增量 [YXX-UI-001](../../tasks/YXX-UI-001_my_reports_source_filter.md) 为原生“我的报修”来源筛选，复用已有成员查询与 source-bound cursor。活动 v3-p09 四项继续作为跨域 smoke，业务 PR 另执行自己的直接测试、strict types、最终候选一次构建、制品与自有资源清理；不新增 selection 或 CI 平台。D01 按需维护，R01 保持 HOLD，full 不等于 strict readiness 或真实运行授权。

来源筛选已由 [PR #49](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/49) 合并；本人网页卡片预览 [YXX-UI-002](../../tasks/YXX-UI-002_my_reports_preview.md) 已由 [PR #50](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/50) 合并。按已授权顺序接续 [YXX-UI-003](../../tasks/YXX-UI-003_service_catalog_picker.md) 中文服务目录选择器，只扩展有界成员目录 GET 与既有 code 输入；新增 schema 登记原制品资源清单，原 169/181、活动 selection、Gate 和认证边界不变。

下文 P09 执行要求及较早交付快照保留各自适用时点，不驱动本轮再次 full、重复探针或认证；本业务 PR 不改数据库迁移、历史 Evidence、业务 Gate、默认开关，不部署、不真实发送。

## v3 当前入口（2026-10-05）

P08 / [PR #47](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/47) 已使用 merge commit `eefd6ee7182c83ca435a0ac02503ed18db3b12c7` 合并；P08 发布、测试、审查和 CI head 保持 `55410a0ec709515db1616fa8c952a38f8b4d0d12` 的原身份。原 27 个 P08 目标已完成，主线累计仍为 169/181；PR38 的 3 个增量模块单列，10 个 G0 JavaScript 保留，D01 的 12 个工具目标继续列外，不宣称 181/181。

P09 从包含 PR #47 合并的最新 main 接续，不新增固定源码迁移项。`scope.json` 保持只读；活动入口与 `test-routing.json` 增加四项 `v3-p09` smoke：SS-008 Assembly、SS-006 Supplement/Review、Process Assembly、Send Guard。原 entry 的 host、flags、数据库、浏览器、subprocess 属性及 current/full/certify 合同不变。复用这些现有合成集成场景演示提交、补充、人工审核、工单处理关闭、本人查询、Realtime、App/Worker/Gateway 和发送守卫。

集中回归发现 Limited Write 守卫直接从 `pg` 导入的纯类型触发既有 ARCH-005 工厂边界检查。仅将 `src/yxx-limited-write-guard.mts` 的查询输入和结果类型改为消费已有 PostgreSQL 平台端口；不修改检查规则、不增加例外，运行表达式、事务和发送权限保持。该直接修补使用原失败架构入口及相关 Limited Write 测试复核，不增加源码迁移计数。

Manual、Delivery、Finalization Evidence 的既有合成夹具自行创建源码根 `tmp` 父目录，避免依赖其他分片先创建目录；原证据断言与清理不变。工具的改名夹具改用没有活动 TypeScript 调用者的既有 G0 Frame Capture 模块，继续证明只执行编译实现及缺失产物拒绝，不再替换活动 Gateway 所依赖的 SDK Logger 模块。上述直接夹具修补不修改生产 G0、D01 工具、历史证据或完整回归集合。

本地开发验证使用一次构建、strict types、四项 smoke、制品与任务自有 loopback PG18 清理；不读取 `.env.pilot`。先完成全部仓库提交、普通适用 PR CI 和一次 Codex review，再冻结本地、远端与 PR 一致的 final head。在该 head 的同一构建上连续运行三次 Process Assembly 有界探针；3/3 通过只记录未复现 P08 的 `COMMUNICATION_SEND_TIMEOUT`，不宣称修复、不扩大 timeout、不自动重试。任意失败先保留日志并修复直接根因，再冻结新候选。

冻结后只运行一次 GitHub `TypeScript migration` 的手动 `mode=full`，检查四个 current shard、Linux/Windows structure-tooling、exact-head 日志完整性、制品、清理与 `full-complete`。只有 workflow dispatch 确实不可用时才采用一次本地 currentSelection fallback，二者不重复执行。真实结果与 workflow URL 只更新 P09 PR 正文 HANDOFF；full 后不再提交动态结果文件。当前入口记录执行要求，不预写尚未发生的 full 成功结论。

业务 TypeScript 主线交付不等于 181/181、strict readiness、READY_FOR_LIMITED_WRITE_LIVE 或生产授权；full 不替代 R01。R01 仅在明确计划发布或有限真实运行时执行，D01 不自动启动。本轮不运行 certify、strict readiness 或 C10/C11，无 SQL、数据库 migration、业务状态、历史 Evidence、默认 Feature Flag 或生产授权变更，不部署、不真实发送、不操作医院数据。制品保持 STAGED_NOT_ACTIVATED；完成后停止在 P09 PR，不自动合并。关闭沿用默认关闭开关，撤销使用后继修补或独立 revert PR，保留历史与用户工作。

## P08 交付快照（2026-10-05）

P07 / [PR #46](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/46) 已使用 merge commit `43c965cc3ccbf5b6f528bfd19251753a3cd73ded` 合并；P07 发布、测试、审查和 CI head 保持 `6e5fb1275a6f525b9aa432ab16ce01390cdc94db` 的原身份，旧结果不改称 merge commit 的新运行。

P08 从该最新 main 接续，以一个 PR、三个内部提交完成原 27 项：配置/Evidence/Candidate/Gate → 发送与 Limited Write → Profile/Service Loop/角色入口。`scope.json` 只登记实际实现，原分母 181 不变，累计 169/181（约 93.4%）只表示主线目标源码覆盖；PR38 新模块和既有 `.mts` 纯类型同步不重复计数。P09 不新增固定源码迁移项，负责集中回归及业务版本交付；D01 的 12 个工具目标继续列外。本轮不自动进入 P09。

`v3-p08` 为接续指令的 10 个现有核心入口，保留各入口的 host、flags、数据库、浏览器和 subprocess 属性。切片只运行直接子集，最终候选一次构建、strict types 和核心并集一次；角色/SDK 直接类型同步通过现有 tooling/hosts 验证。真实结果、最终 head 的适用 CI 和 Codex review 记录在本轮 PR 正文及仓库外 `wecom-v3-p08-20261005` 日志，不生成大型 Evidence。

外部 JSON 与数据库/IPC 输入保持 unknown 边界；Candidate、Approval、Source、Evidence、Database 摘要分型，预算保留态继续使用原 `RESERVED`/`REPLAY`。原 exact-key、候选/审批复核、UNKNOWN、fsync、数据库范围、进程 HTTP allowlist、三角色 Secret 分配、四 Profile 和 Limited Write 权限保持。`scripts/p2-g2-yixiaoxiu-serve.mts` 直接消费 P08 Profile 类型；两个既有 Sender 只要求实际消费的 SDK sendMessage 能力；G1 Cluster 的 Role Environment 接口收窄为原三角色。这四个既有 `.mts` 只同步类型，不新增原目标计数。Reconciliation 与资源 SQL 的字段值保持 unknown，沿用既有消费检查后才能声称数值有效。未批准 Approval、可空 Scope、仅经正则检查的 ID/摘要/回执时间/OID 保留实际原始类型；正则的隐式转换不充当字符串归一化。配置与后续候选/审批核验继续沿用原守卫。

既有 process-assembly 集成测试在全新 checkout 先复现缺少 `tmp` 父目录的 ENOENT；仅在原夹具中补创建该忽略目录，再从父目录不存在的状态复核同一用例。无业务断言或清理条件减弱。完整 tooling/hosts 运行另复现一个过时的 legacy 分类断言；仅更新为验证本轮 Service Loop 已属于编译目标，保留原负向制品检查，直接复跑受影响用例并由最终 PR CI 完整复核。

无 SQL、数据库 migration、OpenAPI、前端、状态机、历史 Evidence、默认 Feature Flag 或生产授权变更。制品为 STAGED_NOT_ACTIVATED；full/certify、严格发布 readiness、真实企业微信、医院数据、部署和生产入口未运行。完成后 HTTPS 推送并创建一个 P08 PR，停在未合并；关闭沿用默认关闭开关，撤销使用后继修补或独立 revert PR，保留历史及用户工作。下文 P07/P06 等内容为各阶段的交付快照，其测试身份和停止线保持原记录。


P00 / PR #39 已于 2026-10-04 使用 merge commit 合并；实际合并与 P01 起始基线为 `614c4a7591ce349269063815bbbf0eca69824664`，保留发布 head `4f6fc5b411ec81c26ea7fcbff9e16e66dcee4009` 的历史。P01 / PR #40 已合并，合并提交为 `f25aeeea31523b7445f0f1e2795767c8c05f1f6d`，保留发布 head `9a1ee62f18a6bf3038930559060ee6c329985f4f`。P02 从该最新 main 接续，按事件日志（A）→时间线（B）→SSE（C）→G1 装配（D）完成 14 个模块的严格类型实现。P02 / PR #41 已合并，合并提交 `841e48493875473b87eaac09afb6e58038d85d49`，发布 head `5de7184c20d4baa78c61af45e5e376c115e0a62f`。P03 从包含此合并的最新 main 接续，按领域合同 → 目录和人员资料 → 规则与旅程迁移原 21 个目标；P03 / PR #42 已合并，合并提交 `e6bdbc991b8c67aa4ee1022b3788aa665254fc43`，发布、审查和 CI head 为 `08267a9501691b6b3851b3de0a6832706e8d2c97`，既有测试不改称 merge commit 的新运行。P04 / PR #43 已合并，merge commit 为 `0975399bad4634f99a9721fa15dc1f492f2a5c97`，发布、审查和 CI head 保持 `cf6ae92a506c35df216455de8d4e065115f42d82` 的原身份。P04 从 P03 合并 main 接续，按查询授权与命令事务 → 通知、投影和 HTTP 两个内部切片完成原 18 个目标。实际检查与当前 head CI 记录在本轮 PR 正文。开发检查不代表发布认证。

P06 / [PR #45](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/45) 已使用 merge commit `09583ec74c3e4e9e0a94a59a95543cbbaeb9833e` 合并；P06 发布、测试、审查和 CI head 保持 `b63d20a213ceda02f2922652a36cd3f6d41cf539` 的原身份，不把旧结果改称 merge commit 的新运行。P06 完成后原目标累计 122/181。

P07 从包含 PR #45 的最新 main 接续，以一个 PR、两个内部提交完成原 20 项：OAuth、成员身份和授权（A），随后 Store、Command、Supplement、Query、Orchestrator、HTTP、Runtime 与两个 Serve 入口（B）。`scope.json` 只登记这些实际 `.mts` 实现；原分母 181 不变，累计 142/181（约 78.5%）仅表示原目标源码覆盖。`src/p2-016-runtime.mts` 只同步 P07 的真实消费类型，不改变运行表达式，也不重复计数。

`v3-p07` 最终 selection 固定为接续指令的 8 个现有入口：Web OAuth、Delegated Identity、SS-004 Orchestration、SS-005 Member Queries、SS-006 Supplement/Review、SS-007 Native HTTP Errors、SS-008 Assembly、Yixiaoxiu OAuth Intent/Profile。保留原 host、flags、PG、browser/subprocess 属性；最终候选一次构建、strict types、核心并集一次、制品与自有资源清理。实际结果和最终 head 的 CI/审查放在 P07 PR 正文及仓库外 `wecom-v3-p07-20261005` 日志，不生成大型 Evidence。

State、Browser Token、Session Token 分型；Provider JSON 从 unknown 经原守卫形成内部成员身份。服务端 scope 与 DB read 后 local-only recheck、成员隔离、精确输入、receipt 重放前 active binding/retention、revision、opaque request_ref、HMAC cursor 均保持。复用 Rule/Review/Ticket/Realtime 链，SQL、锁顺序、默认关闭和业务 Gate 不变。类型正反例覆盖这些当前边界；源码路径检查继续使用既有 `sourceFile`。

Profile、G2 Config、Service Loop Assembly、G2 Process Role 四个 P08 模块保留 `.mjs`，只消费当前所需结构接口；不提前迁移。无数据库、OpenAPI、前端、历史 Evidence 或生产授权变更。制品为 STAGED_NOT_ACTIVATED；full/certify、严格发布 readiness、真实企业微信调用、医院数据、部署和生产入口均未运行。P07 创建 PR 后停止，不自动合并、不进入 P08；关闭使用既有默认关闭开关，撤销使用后继修补或独立 revert PR，保留历史及用户工作。

PR #38 已合并至 `f72e77337aff5d3e5fd053409d5965fbe47deeb6`。P00 将工作台查询/授权迁入严格 MTS，并同步 CI 与逻辑源码路径兼容；下文 T00～T04-05 和 PR37 记录为历史交接，不再驱动日常批次认证。

- 普通 PR：`typescript-merge-check` 一次构建后执行严格类型、活动 selection、直接相关工具回归、制品与自有资源清理。SS009 的独立 Linux job 只执行 published-history preflight 与 PR evidence delta 测试/检查，不安装项目依赖。
- 手动 `full`：原完整 current 集合去重四分片、structure/tooling、`full-complete`，不消费必须最新 READY 的证据。
- 手动 `certify`：当前 workflow 加严格 readiness 与 `certify-complete`；历史 workflow 独立执行固定 SS009 证明。R01 交接分别记录两条 SUCCESS workflow URL，不建立跨 workflow 调用。

selection 从本文件唯一整行读取，必须存在且非空。注册表仍为 218 个入口、72 个旧别名，完整合同为 217 current + 1 historical；selection 不是完整验收。

本地最终检查：`npm.cmd run migration:build` → `node .build/tools/gate.mjs types` → 自有 PG18 的既有基线初始化 → 直接调用 `.build/tools/run-tests.mjs` 的 `runSelection` 与 `routing.mjs` 的 `loadRoutes/select` → 相关工具测试 → `node .build/tools/verify-artifact.mjs`。不要在单构建路径继续调用会 bootstrap/build 的旧测试别名或 batch gate。报告目录位于仓库外，测试库必须是任务自有 loopback 合成库；保留原宿主、flags、失败/漏跑检查与清理约束。

P05 从包含 PR #43 合并的最新 main 接续，以一个 PR、三个内部提交完成 Journey/Decision/Review → Safe Action/Worker/Orchestration → Runtime/Live Cluster/进程入口的 23 个目标。`src/p2-015-incident-correlation.mjs` 保持原样移交 P06，不计入 P05；181 项总分母不变，原目标累计 108/181 仅表示源码覆盖。`v3-p05` 保留接续修订的十个核心入口，增加直接相关 ManualReview/Worker 单元、目录进程装配及两个架构源码检查；宿主、flags、database/browser/subprocess 登记保持。核心并集只在最终候选完整执行一次，容量/真实子进程恢复不在内部切片重复。

P05 直接类型同步补齐了现有 ARCH-006 检查对已迁移 `.mts` 前驱的识别：只接受原锁定编译器输出字节一致的类型修改；表达式、SQL、事务控制及运行时 enum 变化继续拒绝。既有检查入口的同范围正反例先 RED 后 GREEN，不增加新扫描器或认证集合。Continuation issue/consume/revoke、Action mark 和 Decision projection 使用实际 SQL 字段的本地结果类型；ledger replay 的未知性保持。

历史 P04 selection 使用 `v3-p04`，保留原五项核心和补充的 contracts、ManualReview、DeliveryControl 三项；OAuth 公开接口、已校验 Sender 输入的本地类型视图与 Gateway SDK 消息体类型同步及逻辑源码登记分别复用 WeCom auth、Communication core、G1 assembly 和 ARCH-006/V1.4 现有入口。登记不更改宿主、flags 或 subprocess。切片先验证直接子集，整个阶段收口验证核心并集；类型擦除后的执行表达式、SQL 和锁顺序保持基线，未触发浏览器、restart 或额外锁顺序回归。181 项原分母不变，实际原目标累计 85/181，仅表示文件覆盖。

历史 P03 selection 使用 `v3-p03`，保留原六个核心种子，加入既有编排数据库集成入口；目录 adapter/process、源码断言、ARCH-006/V1.4 及受影响 CLI 按直接影响扩展。仅在实际原型/历史相关差异出现时运行目录 workflow 的额外构建/冻结回放。181 项分母不变，current_module_map 只登记实际完成实现。

历史 P02 selection 使用 `v3-p02`，覆盖事件日志、时间线、SSE、G1 装配/浏览器及同秒入站、HTTP recovery、P2-016 锁顺序影响；审查修补源码来源与 Evidence 路径后补入 G2 候选、审批、CLI、分进程，以及 P2-012/P2-016 现场防护和 ARCH-005 契约的七个直接回归，共 20 个入口。内部 A/B/C/D 不另建 selection。SSE 多方法名兼容与 this 绑定保留，普通 PR 不叠加历史 batch 或发布认证。

历史 P00 selection 保留原七个入口。P01 selection 使用阶段六个核心种子，加控制/工作台/G1 适配单元及 ARCH-006、V1.4 baseline，共十一个直接相关入口；呈现和重试顺序保持原运行时表达式，不触发额外浏览器或 P2-016 扩展。ARCH-005 仅在实际触及时间契约时扩展。工具回归由现有工具入口执行，不加入业务注册表。类型正反例使用现有 type gate 与有理由的 expect-error。

P00～P04 已合并，历史 P05 无数据库变更，制品为 STAGED_NOT_ACTIVATED，不更新原 readiness pointer 或大型 Evidence 包。P05 使用已有合成行为与任务自有 loopback PG18；保持决策哈希、事务/锁、失败策略、续接身份边界、默认关闭和停止顺序。P04 ledger replay 消费者字段继续为 unknown；后续 OAuth/YXX/Incident 在组合处使用当前消费的最小结构类型，不提前迁移。fork/roleScriptUrl 继续使用编译后的 .mjs。允许本次 P05 范围内提交、HTTPS 推送并创建 PR、审查和核对该 head CI；原 P05 完成后不自动合并、不进入 P06、不运行 full/certify、不部署或操作真实业务。交接记录写在 PR 正文，包含 head、业务行为、实际命令/结果、日志位置与未运行项。撤销使用后继修补或独立 revert PR，保留历史与用户工作。

## 历史入口（下文）

## 当前交接（2026-10-02）

PR #37 已合并：发布 head `5ea7982bad2dc8d2236f36b25ce5a9c7427199bf`，merge `78fc466af50c6d4c27850998267510fb1592157b`。独立复审与当前 head CI 已用于本次授权合并；各轮回执仍保留原测试身份，不重绑。随后历史研究归档合并为 `562a96ffdd7148d729ab0eed9d215abe894f12c2`。T04-05 合并收口；T05-01 不自动启动。

当前严格 readiness 恢复作为 [独立任务](../yxx-current-readiness-implementation.md) 执行，按 [ADR-0027](../../adr/0027_yxx_current_readiness.md) 区分当前限定 Web 技术准备与历史 SS009 验收。在取得新候选完整证据之前，保持 NOT_READY。下文是合并前各轮实际记录，不表示 PR #37 仍处于 OPEN。

## T04-05 合并前的历史交接记录

T00 至 T04-04 已合并。PR #36 发布 head `8eb71fb14dfda2c885d0edf53408fc38979aea23` 的迁移与 Evidence-history CI 成功，GitHub 确认 merge 为 `87de2bc9e8835882cd390b024a04e2865cd367f9`。原 T04-04 与 HTTP 修补回执保持其被测祖先及历史状态。

当前批次为 [T04-05](T04-05.md)，迁移 Foundation、首确认、加密备份及 P1 E2E 四个模块。上一轮发布源候选 `8f929b73084690c46190d6cf4968b2801894b2ae` 的[当前 CI](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/actions/runs/36851491429) 六批次均通过，T04-05 为 50/50 文件、340/340，两个平台工具检查各 59/59，1,438 份 TAP/stderr 哈希已核验。用户提供的独立远端复审确认三个公开 raw-input 函数属性边界已修复，上一轮 P2 关闭，已核查范围没有新的已确认 P1/P2；见 [复审回执](receipts/T04-05-rereview.json) 和 [终局核验记录](verification/T04-05-rereview.md)。额外本地复跑最终为 FAIL：47/50 个文件记录，46 文件通过、1 个架构子进程 240 秒超时、3 个未运行；300/300 已完成 TAP 测试不代表全批通过。临时 PostgreSQL 已核对正常停止、数据目录删除及无端口监听。机器人仍返回代码审查额度限制，没有 GitHub APPROVE。本文档后继不改变运行候选，既有复审与 CI 仍绑定 8f929b7，后继 head 的已配置 CI 单独记录。[原回执](receipts/T04-05.json) 及完整 213 文件快照仍绑定 `60a0265`（1342/1344、两项已复现基线失败），其他旧回执也不重绑；严格 readiness 仍为 KNOWN_BASELINE_NOT_READY。[PR37](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/37) 未合并，T04-05 保持 IN_PROGRESS，T05-01 未授权。

后继文档 head `f8e209e` 的 CI 36876787453 实际失败于 T04-02 的 SS-009 浏览器清理检查（业务断言已通过，CDP socket 尚未 CLOSED）。测试辅助函数修补 `ef99c7e` 增加有界关闭完成等待，原实现回归 RED，修补后生命周期 5/5、本地 50 文件 / 341 测试及 Windows tooling 59/59 通过；261 个生产输出字节不变。见 [关闭修补记录](verification/T04-05-browser-close.md) 和 [新回执](receipts/T04-05-browser-close.json)。新发布 head 的完整 CI 待运行，既有 CI/复审及原测试执行身份不重绑。

当前发布 f9cd40d 的 CI 36891280424 再次失败于两个浏览器清理入口。完整传输修补 dca2180 使用已有锁定版本的测试专用 ws 连接，关闭握手停滞时终止自有 TCP 并确认 CLOSED；真实 Chrome/CDP 回归 RED 后 GREEN 6/6，本地扩展批次 52/52 文件、391/391 及 tooling 59/59 通过。六个完整批次改为独立 PG18 环境、最多三个并行，原 baseline/strict/historical/cleanup/双平台检查均保留；未削减覆盖。历史健康 CI 为 93m18s，预计并行后约 40 分钟（新 CI 实测待确认）。见 [传输与 CI 记录](verification/T04-05-browser-transport-ci.md) 和 [新回执](receipts/T04-05-browser-transport-ci.json)。

Foundation 的 `p1:preflight` / `p1:serve` 先验证制品，再运行 `.build/runtime` 内同名模块；缺失或过期制品失败，需单独构建。现有运行脚本保持 `.mjs` 导入，在运行树加载唯一实现。

本批完成后停止，T05-01 不自动启动。无数据库变更，制品保持 STAGED_NOT_ACTIVATED。

## 两类根目录与历史对象

生产模块和测试子进程只从 `.build/runtime` 加载；源码检查仍读取真实 Git checkout。
`test-routing.json` 是所有 213 个当前入口的显式宿主注册表（207 个原入口、T01 金丝雀、PG callback 回归、平台边界回归、T04-03 运维兼容回归及 T04-05 CLI/兼容回归），不是“211 个测试全部通过”的宣称。
`SOURCE_HOST` 用于实际源码/治理检查；`STAGED_RUNTIME` 用于编译制品；`MIXED_EXPLICIT_ROOTS` 只通过测试专用 helper 读取真实源码文本，不能回退加载源码实现。
固定历史验证继续由原 P2-016 wrapper 在独立完整 checkout 中运行，不能将当前源码覆盖进历史工作树。

## 常用命令

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run migration:gate
node --test .build/tools/tooling.test.mjs .build/tools/hosts.test.mjs .build/tools/batches.test.mjs
npm run migration:gate -- --batch T04-05 --report-dir <repo-external-report-dir>
node .build/tools/run-tests.mjs --selection t02-time
```

当前 PowerShell 主机使用 `npm.cmd` 传递 `--batch` 等参数；工具编译由 `premigration:gate` 执行。
数据库用例要求独立 PostgreSQL 18，先在专用合成库通过现有 `migrateCurrentBaseline` 初始化当前基线；显式设置 `TS_MIGRATION_TEST_DB_ISOLATED=1` 和 loopback `PILOT_DATABASE_URL`，不读取真实 `.env.pilot`。
浏览器可显式设置测试专用 `TS_MIGRATION_BROWSER_EXECUTABLE`；找不到浏览器必须失败，不能跳过。
CLI 的 `--report-dir` 必须在仓库之外。旧 72 个 npm 测试别名保留原选择和参数，由编译运行路由执行；生产/部署/迁移操作 CLI 不在本批授权范围。

## 原基线的非就绪结果

当前原 `--require-ready` 仍为 `YXX_VERIFICATION_REJECTED` / `YXX_LOCAL_VALIDATION_SCOPE_INVALID`。
ARCH-006 原 validator 在 T02 合并基线返回两个 scope/READY 错误；本批还因原规则不识别已授权 P1 TypeScript 迁移而返回第三个 runtime-delta 错误。CI 保留原 validator 的 exit 1，分别精确核验两份完整诊断；历史九/十路径变体及本批四模块改名的精确八/九/十路径变体可分类为已知非就绪。本批九路径额外支持为 p1-007 的原始 Delivery ID 类型边界，十路径再包含 p1-003 的公开 Inbox 受理类型边界；其他路径或诊断仍失败。原始输出不改写、不计入 readiness PASS。
ARCH-005 对部分冻结 SQL 使用原 CRLF 检出字节。CI 在 checkout 前设置原检出策略，不修改 SQL 或冻结哈希。

## 历史记录与边界

T00 的 baseline.json、baseline-tests.json、verification 和原回执继续描述它们原本绑定的提交。T01 回执亦不重写旧 tested_head。
各批次最终结果以对应 PR 精确 head、实际 CI、自审及外部审查结果为准；T04-03 的历史 [CI 对照修补记录](verification/T04-03-ci-repair-20260930.md) 不替代旧实现回执或新 head 的远端结果。
当前业务状态、Evidence、SQL 和现场批准不变。影子构建不是生产激活；没有调用正式 Provider、生产写库或真实企业微信发送。

批次登记见 [batches.json](batches.json)：T04-05 保留五个直接测试、七个反向影响测试、全部 P1 阶段入口及前批 baseline/supplemental。SOURCE_HOST 读取真实 checkout，运行实现由已验证制品加载。缺失制品不能算已知非就绪；历史与当前结果分开记录。

独立 CI 数据库初始化补齐：首轮并行 head bd08081 在原 P1 通知/运维测试暴露空库缺少 ARCH-005 基线；后继 bb4ad85 在每个空的自有 PG18 服务先运行既有编译产物迁移，再执行原批次。真实空库通知 RED1/4 → GREEN4/4、运维6/6；无 SQL/产品源码/断言变化，747 输出不变。见 [初始化回执](receipts/T04-05-ci-isolation.json) 和 [补齐记录](verification/T04-05-browser-transport-ci.md#independent-database-bootstrap-follow-up)。新完整 CI 待确认。
