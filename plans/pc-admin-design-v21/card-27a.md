# 卡 27A：关闭核对与结束方式只读投影

## 2026-11-06 发布授权与范围（当前阶段）

用户在本地独立审查和修复复验完成后，明确授权只提交卡 27A 增量、推送、创建 PR、请求 @codex review 并跟进 CI/审查，暂不合并。下文“未提交/推送/PR”是原执行阶段快照，不能用作当前授权限制。

本次提交严格使用独立候选的 22 路径；共享 checkout 的卡 26、其共享测试增量和用户原型均保留在工作区，不暂存。PC 应用仍仅 api/client.ts。提交前比较每个 index blob 与独立候选，确认生产/测试输入仍为本轮 7674cbe8 / manifest 1b21f368 的已验证内容；本节仅补发布记录，不改业务源码或原测试结果。

PR 使用 pr skill 的 Summary / Evidence / Merge Danger 格式；如实说明本轮 23 入口 149/149、原失败与 NOT_RUN、自动关闭时间及 S1–S4 缺口、旧 SQL/EXPLAIN 原字节丢失事故、ESLint 的实际范围和本地验证边界。CI 结果与远端审查意见另以该 PR 的当前完整 head 和 GitHub 回执为准，不把本地 WIP 通过冒充 CI 或上线批准。未经后续明确授权不合并。

### 首轮 PR CI 失败与查询修复候选

已只提交本卡 22 路径为 `84f250ccff47d3a1491310e60edcb6a8a7428ef9`，推送并创建 [PR #154](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/154)；卡 26 与用户原型未暂存，提交后逐字节保护核验通过。已请求 @codex review，远端对该 head 回执为无主要问题，行内线程 0；未合并。

[首轮 TypeScript CI](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/actions/runs/42166822735) FAIL：58 个所选入口仅到达 10 个，47 项中 46 PASS / 1 FAIL，余 48 入口 NOT_RUN。失败为 Card16 命令搜索第 2 项 P2_006_BROWSER_WAIT_TIMEOUT；PG 同时记录新 `WITH cards AS MATERIALIZED` 搜索 SQL 触发原 2000ms statement_timeout。前面的构建、strict/Stylelint 和最终制品/源码/合成库清理均通过；合并汇总因所选测试失败而 FAIL。总运行约 28 分钟中，约 24 分钟是媒体工具准备，不冒称查询运行 28 分钟。原件下载 `ci-first`，zip SHA256 `399aa66e3e4369c1c62286c3a466aa52ae0a5fcc735902ec3af0ab90139ad92b` 与 GitHub 回执一致且 CRC 通过；原 FAIL/NOT_RUN 保留。

Windows 原搜索合成样本 HTTP 约 51ms，prepared / final 计划估算成本 1356492.67 / 1356545.95，执行约 2ms；该 PG 的 pg_jit_available=false，不能用本地通过证明 Linux LLVM 耗时。两个新增关联把 UUID 主键转 text，丢失原生主键 lookup/唯一性估算。保持主键为 UUID、仅把规范小写的 RHS 文本守卫转换后，同参变体成本降为 426067.22 / 426124.78；PG18 的 JIT/优化由估算成本触发，参见 ADR 官方来源。JIT 主导 CI 超时仍是待 CI 复验的假设，不写为已证实根因。

最小修复仅改只读查询：上述两个 JOIN 保留旧非规范文本不匹配的语义，另为 Ticket 终结事件 lateral 显式加四终态守卫。保留物化、安全指纹、2 秒时限和最终 READ/分页/日期/计数终检。既有 web01 集成补断言：旧 decision/operator 非 UUID 文本仍返回 200、来源或显示名未知为 null，恢复原规范标识后 closure 完全一致。没有改命令、迁移、权限、依赖、界面或测试时限。两名子代理只读复核，Root 唯一构建和运行；新候选通过与否以接下来独立回执为准，旧 149/149 不补新候选。

`build-ci-fix.log` / `types-ci-fix.log` 对 input `636ccd1b3c554f8d1abbaa54cce811125e7457b35b6393696262ceccfed9abfe` 通过。本地 `tests-ci-fix` 到达 7/23 入口，115 项中 114 PASS / 1 FAIL，16 入口 NOT_RUN；SQL 新断言与 Card16 均通过，原失败保留。另一个既有别名/真实 HTTP / PC 解析兼容回归 `pc-admin-legacy-retirement.browser.test.mts` 在通知详情容器出现即取链接，截图仍是“正在确认这条通知的最新情况...”。仅在该测试新增一行等待现有详情链接出现，原负向文案、链接安全、无 POST/发送、原等待和原时限全部保留，无组件或通知实现变化；两名独立审查者确认等待缺口真实且未削弱业务断言。该既有回归成为本卡第 23 路径，PC 应用依然只改 api/client.ts。测试源码改变后旧制品校验正确报告 INPUT_DRIFT，保留回执并以 fresh build 重新验证，不冒称旧通过可补新测试。

### 查询与就绪修复的本地复验

最终 `build-ci-fix-ready.log` / `types-ci-fix-ready.log` PASS，input=`0a6c5e45b20737f4eae411922d642a523199811ee7d0472f996667eb4abd1b36`，manifest=`6633b507d155197e60f960db432d2ae9fe49bf8db1b2024bdc537102fc43b8f2`；922 模块 / 2,944 制品。`tests-ci-fix-ready/summary.json` 同一候选单批 23 入口、149/149 PASS，fail/cancel/skip/todo=0、NOT_RUN 为空。Card16、非法旧标识及原别名回归均通过；此前 CI 和本地 FAIL/NOT_RUN 原件不删除。制品与文档链接校验通过，既有 Stylelint/Token 检查通过；本卡无 CSS/ESLint 范围变化。

实际新编译查询的 `search-plan-after-fix-ready-summary.json` 为 Windows 无 LLVM 的本地合成观测：HTTP 207.107ms；prepared / final cost=426067.22 / 426124.78，execution=12.26 / 12.784ms。原 SQL/计划及原变体对比均在独立文件，不覆盖原件。独立 Standards / Spec / closure 审查均新增0，OCR delegate 补审另附原回执；Linux 效果以新提交 CI 为准，不拿该 Windows 结果补已失败 CI。

`ci-fix-observation` 单独保存当前 1440×1060 / DPR=1 / zoom=1 截图，已实际查看，3列正常、已加载15项，PNG SHA256=743a32a2309fa5cc2eb19e5559a600c5d4bf64abc29554399273425498515d62。同一小合成样本 limit=1/50 实返1/5卡，均11条SQL、各1条计数查询，group_counts=4 completed/1 dismissed；EXPLAIN planning=18.537ms、execution=8.73ms。原旧证据目录没有改写，无生产容量结论。

本次追加提交只含上述 5 路径，累计本卡 23 路径，继续逐 blob 与隔离候选比对并保护卡26工作区。远端 CI / Codex 审查的最终 head 和结果以 PR #154 回执为准，暂不合并。

日期：2026-11-06（Asia/Shanghai）。分支：`codex/pc-admin-v217-card27a`。基线：`702f80d653f0c96f6febd7404c58834246427fe7`。原阶段状态：本地实现与适用验证完成，保留 H5 媒体 seek 的两次未归因超时；当时未提交/推送/创建 PR。

## 2026-11-06 后继独立审查（当前修复候选）

用户明确要求 code-review Standards / Spec 和 Open Code Review delegate 多代理独立审查、发现问题修复复验，继续不提交/推送/PR。原交付的 18 路径指纹及 WIP patch 固定在 `D:/CodexEvidence/pc-admin-v217-card27a-review-20261106/review-pin.json` / workspace.diff；base=HEAD=702f80d653f0c96f6febd7404c58834246427fe7、无新增提交，实际审工作区增量，不能把空的三点提交差异当无改动。

三名全新审查者均未参与实现，独立完成并 STOP。Standards：1 项 P3（正式 API 模块文档仍旧）；Spec：1 项 P2（等待中新进入集合导致新计数/旧末页）；OCR delegate：2 项 Medium（合法空白说明拒绝；自动输入时间冒充关闭时间）。OCR v1.13.6 的真实 preview/rule 保存；其支持范围仅 9/9，unsupported_ext 的另 9 个 .mts/.md 全部人工补审，18/18、跳过 0，不冒称 CLI 原生覆盖 MTS。

Root 在原编译候选上用既有 fixture/命令复现：计数 completed=2、items=1、next_cursor=null；旧 cancel 接口成功写入 reason_note=' '；延迟自动分类的 closed_at 错等于三天前 observed_at。原件 reproduction-results.json。修复不改写入路径：

1. 最终同一 SQL 重算分页有序前缀（含排序键及 limit+1 哨兵），与初查快照比较；新增匹配、空页变非空、前后页边界或排序变化返回现有 409。原身份/角色/会话/对象 READ 终检先执行，未增加 SQL 往返。
2. closure 将纯空白说明和人员展示名归一为 null，保留原事件/人员记录和非空白文本原值；严格客户端和 Schema 不放宽。
3. 自动后续分类的 SYSTEM 可证明，但 occurred_at/executed_at 来自输入 observed_at/received_at、不可证明实际关闭，所以 closed_at=null。初始创建即 IGNORED 只在 version=1/ordinal=1/received 状态证据下取创建事实 created_at。未来实际关闭时间写入留后续卡，不新增迁移。
4. 按已授权只读合同及 API 维护规则同步 docs/api/workbench/board.md 与 search-source-forward.md，连同 ADR/OpenAPI 说明新形状、默认 CANCELLED、closure_kind 和冲突处理。

此后继共 22 路径（原 18 + 两个只读 API 模块文档 + T41 旧默认成员期望同步测试 + T34 分页 SQL 等待点适配），PC 应用仍只改 api/client.ts。增加既有 web01 集成/单测：真实关注使新卡进入当前页之前/之后/空集合、随后完整分页；合法旧空白说明不改原事实；延迟自动关闭不伪造时间；初始创建时间独立证明。原交付下文的 d380 / a957 / 59入口419项只属于原候选，不补当前新候选；本轮构建/复验/复审回执将在完成后追加。

本轮首次定向复验 `tests/summary.json` 为 122 项、121 PASS / 1 FAIL，余下 12 入口 NOT_RUN。失败位于原 T41 旧断言“COMPLETED/IGNORED 不在普通看板”，不是搜索造成了写入；该旧范围已由用户明确的新默认取代。同步为先确认 closed/all 默认包含该类，再严格比较搜索前后完整成员顺序/身份/状态和 group_counts 不变；原 logout/physical-expiry/留存断言全部保留且首次已通过。原失败原件保留，不将其改名或删除。

第二次复验 `tests-final` 先完成 11 入口，TLS 终检入口因要求 D temp 而在任何资源/业务断言前拒绝 C temp；配置本任务 D 盘 TEMP/TMP/TMPDIR 后原样续跑。续跑 `tests-resume` 中 T34 真实撤权等待钩子仍只识别旧 `, ordered AS`，新复用分页 SQL 是子查询，故必须发生撤权的前置断言正确失败。仅新增对新初次分页查询的匹配（保留旧匹配），原 SQL 数量上限、真实撤权、最终 404/无 items 断言均保留。不是把未触发的权限测试算通过；所有原 FAIL/NOT_RUN 保存。

### 本轮最终结果

三路最终静态复核均为剩余0/新增0：Standards原1项P3已修，Spec原1项P2已修，OCR delegate原2项Medium已修。最终22路径指纹匹配；CLI选择9/9，人工补审unsupported_ext 13/13，跳过0。报告在本轮证据目录的 standards-verified-supplement.md、spec-verified-supplement.md、ocr-delegate-verified-review.json。

`build-verified.log` / `types-verified.log` 通过：922编译模块/2,944制品，strict/负向类型、PC/H5/Desktop类型、Stylelint/Token/feature-syntax均通过；现有功能区ESLint 0 errors/0 warnings。最终input=`7674cbe8293568fb8315765258e2d1be6eae5a7d1b92ceff12b6f50d67bf7704`，manifest=`1b21f36815b606c30723aa765a4c40b7cec38e08ef7e423946bc6834c9c0fa85`。

`tests-verified/summary.json` 为本轮23入口、149/149 PASS，fail/cancelled/skipped/todo均0，NOT_RUN为空，同一候选单批完成。选择为pr-pc/pr-read-safety并集及8个直接搜索/关注边界入口，完整路径见 verification-plan-tests-verified.json。旧59/419和本轮前置/旧期望/钩子失败分别保留，不补该新候选。`artifact-final.log` 已验证当前制品，未激活。

本候选截图 Windows 1440×1060、DPR=1、zoom=1，3列/已加载15项，已实际查看。1卡与5卡均11次SQL、各1条最终计数语句；EXPLAIN planning=4.458ms、execution=2.324ms，仅小合成库，不作生产容量证明。当前 workbench-1440.png、browser-observation.json、query-observation.json、board-query-plan.json/board-query.sql 位于 `D:/CodexEvidence/pc-admin-v217-card27a-review-20261106`。

收口发现仓库外观测脚本路径重定向未匹配Windows斜杠，当前截图/观测/计划误写到原证据目录同名文件。已隔离当前文件并校正脚本，未影响源码、测试/审查原报告、原日志和manifest。原截图从本聊天固定前缀按原SHA-256 `3d6d5de7638c233799c8549da3fe8a0a1fba56d4de9c42e403732c0bf714213a` 精确恢复；原观测JSON及原生退出回执从原生产工具输出恢复。**原SQL和EXPLAIN原始计划字节无法恢复**，旧路径改为明确缺口说明，未伪造重跑或改旧耗时/hash；事故及恢复证据见 artifact-path-incident.json。当前新候选完整计划正常保存，原缺口不冒称已恢复。

本轮22路径的同步/保护哈希与自有资源停用见 root-delivery-sync.json、resource-cleanup.json；未提交、推送、创建PR，未运行CI/full/certify/真实发送/部署/Gate。PG目录按前次决定保留，结束后仅停本任务实例，不重试被拒绝的递归删除。

## 原交付资源与写入分工

用户原有未跟踪的 `docs/ui/prototype/医小修 PC 管理端 v2.2 设计原型.html` 保留，本卡未写该路径。Root 负责查询、ADR、执行记录及唯一构建/测试运行窗口；contracts_client 仅合同、共享查询参数解析、PC api/client.ts 与其测试；closure_tests 仅 web01 既有测试；audit_closure 只读核对。文件所有权互斥，三代理均已 STOP，随后由 Root 整合。

检测到另一会话在共享 checkout 实施卡 26 后，本卡改在 `D:/Worktrees/pc-admin-v217-card27a-validation` 独立、detached 工作树验证，基点仍为上述完整 SHA，只复制本卡白名单增量。共享目录的卡 26 CSS、组件、fixture 和测试差异保全，不纳入本卡候选。不在共享 `.build` 启动构建；独立工作树 `node_modules` 是本任务创建、指向既有统一依赖的 Junction，没有安装或改变依赖。分支仍为原共享目录的 `codex/pc-admin-v217-card27a`，无新提交；被测对象由独立工作树未提交源码及 manifest 输入哈希绑定，不能冒称已提交 head 的全部内容均已测试。

只使用本任务 loopback 合成数据库和现有 fixture/helper。无生产配置、真实 Provider、发送、现场业务写库、部署或 Gate。新增合成内容标「（合成）」。

## 风险与验证选择

风险为结束来源/原因隐私、日期范围与分组计数、分页/筛选身份、默认新增字段触发现有前端严格解析。扩展既有 web01 单元/HTTP 集成、search 合同/集成和正式前端浏览器入口；覆盖缺口关闭且适用检查通过后停止。

未提交任务没有 PR head 差异，使用现有 `pr-plan.mjs` 的 `planChanges` API 输入真实 `git diff --name-only` 路径，base/head 均显式记录原完整 SHA，额外标记 `local_uncommitted_paths=true`，不制造提交。选出 core / pc / mvp、56 个去重入口（pr-core、pr-identity、pr-notification、pr-pc、pr-read-safety、t03-platform、yxx-h5-rebuild）。为回答 K1 具体缺口，另选 3 个已注册入口：`t10-action-boundaries`（取消前态/角色/通知）、`wbint-t14-review`（八种人工结论与 CANCEL_REVIEW 区别）、`t20-staff-reopen`（已有重开正例）。终验以 `runSelection` 执行 59 个去重入口，保持原 host / flags / timeout / 退出及清理断言。

按 ADR-0053，每个实际候选统一构建一次，检查 strict、Stylelint/ESLint、契约和制品。发现具体问题后才修补并重建，实际历史 build-01–06 与原失败分别保留；不能把此前候选的通过重绑最终候选。H5 路由要求的 ffmpeg/ffprobe 复用 `D:/CodexEvidence/pc-admin-n3-retirement-20261104/tools/ffmpeg-9.0.2-essentials_build/bin` 既有便携工具，仅传入测试环境并记录当前文件 SHA-256；无项目依赖或生产配置变更。不运行 full/certify。

## 编号清单

- K1.1 已完成：人工范围外入口、角色、IGNORED / Review 事件、原因位置、人工/系统区别及旧观察时间均核对，并有真实合成闭环。
- K1.2 已完成：取消接口、QUEUED/ACCEPTED 前态、角色、技术码/内部文本与默认/附加通知口径均核对。
- K1.3 已完成：无原单关系存储/命令，合成 DUPLICATE_LINKED 返回 duplicate_of=null，没有伪造原单编号。
- K1.4 已完成：三类 DISMISSED 无恢复；原完成票 reopen 正例及权限差异保留。
- K1.5 已完成：PC today / H5 COMPLETED 口径已核对，未找到独立月报接口；现有统计实现不在本卡修改。
- K2.1 已完成：六状态 × 人工/系统共 12 组合单测，八个已有原因白名单、缺证据 null、相同 READ 内部原因与当前权限均验证。
- K2.2 已完成：第三列完整范围计数与 6 页查询一致（completed=6 / dismissed=5），空获权页 0/0；等待后离开日期筛选返回 409，避免卡片/计数混合快照。
- K2.3 已完成：默认返回新形状并包括 CANCELLED，没有新兼容开关；原 cancelled 模式暂保留。
- K2.4 已完成：前端只改 api/client.ts 的解析；1440×1060、DPR=1、zoom=1、3 列且已加载 15 项的 Windows 截图证明正常加载。
- K2.5 已完成：closure_kind 两值筛选、只影响第三列、组合条件、分页/游标绑定和权限隔离均通过。
- K2.6 已完成：完成统计混类仅列 ADR 待决，没有越界修改 H5 / PC today / 月报写入或统计。
- S1 停止待确认：统一关闭业务原因、通用命令及迁移只写 27C 方案；当前仅投影已有原因，未知码为 null。
- S2 已确认无需修改：有人工范围外复核入口；更广的误报/测试/重复/撤回通用关闭仍只列 27C 方案。
- S3 停止待确认：DISMISSED 恢复没有现成操作，can_restore=false；未实现新命令或状态转换。
- S4 已确认无需新增存储：仅凭现有可信证据给 MANUAL / SYSTEM，其余为 null；未补写历史。
- K4.1 已完成：工作台卡片/列页/列表 d.ts、JSON Schema、OpenAPI 与解析同批交付；契约正负校验通过。
- K4.2 已完成：ADR-0055 含 K1 代码位置、映射、计数、参数、S 项、统计待决；本记录附合成结果、查询计划与截图。

合同与停止方案先见 [ADR-0055](../../adr/0055_workbench_closure_kind_projection.md)。

## K1 核对与直接合成证据

精确文件/行号及全部子问题见 ADR 的 K1；下表把每项连接到可重跑证据，不将合成数据视为现场或业务批准。

| 项 | 核对结论 | 现有入口中的合成验证 |
| --- | --- | --- |
| K1.1 | 有范围外人工复核；未关联 Ticket 时 ADMIN / DISPATCHER 可操作。Intake→IGNORED、Review→RESOLVED，追加 intake.rule_decision_applied；固定 UI 原因与服务端格式串分开，Human Override/Review 可区分来源。取消复核并不关闭 Intake。 | web01 新场景真实 MARK_OUT_OF_SCOPE 与自动 DecisionPort.OUT_OF_SCOPE 分别得到 MANUAL / SYSTEM；旧观察时间仍投影匹配 Review.resolved_at。另用同一范围外结论选择 HUMAN_CONFIRMED，覆盖非默认已有原因；T14 原八结论测试验证 CANCEL_REVIEW 后仍 WAITING_TRIAGE。 |
| K1.2 | QUEUED / ACCEPTED 可取消；ADMIN / DISPATCHER 获权，HANDLER 无 cancel。技术码入 closure_reason，必填自由文本入事件 internal_note；当前默认不通知，AdditionalEvents 和旧 P1 另记。 | 真实取消保留原 note / actor / closed_at；获权详情原已可见该内部文本，越权为 404；T10 原入口验证两前态、角色、投递数不变及原 UUID 重放。 |
| K1.3 | 无关联原单事实或写入入口，无法取原单编号；不把 Incident 当原单。 | 按既有 fixture SQL 方式设 DUPLICATE_LINKED，沿 appendTicketEvent 追加系统事件；得到 DISMISSED / 重复 / duplicate_of=null。 |
| K1.4 | 三类 DISMISSED 无恢复；既有 reopen 仅 RESOLVED / CLOSED→REOPENED。 | 原取消/重复 allowed_actions 不含 reopen；三类 can_restore=false；权限单测保持同组本人、失组、非本人、inactive 及 ADMIN 差异，T20 保留已有完成工单重开正例。 |
| K1.5 | PC today 只看第三列 completed_at，当天取消/重复可计入；H5 COMPLETED 分类亦含它们，未找到独立月报接口。 | foundation 新核对用同日 CLOSED / CANCELLED / DUPLICATE_LINKED 均得到 today=true，IGNORED 且 completed_at=null 为 false。仅记录现状，没有修改统计实现。 |

## 只读语义与规范更新

- [ADR-0055](../../adr/0055_workbench_closure_kind_projection.md) 记录六状态映射、来源/隐私、时间、分组计数、临时 cancelled、closure_kind、S1–S4 和统计待决。
- Ticket 关闭原因只来自当前真实终结事件的原内部记录；Intake 任意文本不外扩。现有 Review 选择器允许全部八个固定原因，所以按原中文完整白名单展示，不把任意格式 code 认作枚举。源码位置：`workbench-card-projections.mts` 的 `CLOSURE_REASONS`、`projectWorkbenchClosure`；来源 SQL 在 `web01-workbench-query.mts:46` 起。
- 已关闭日期只取真实关闭时间。BOT 人工旧 occurred_at 可为原观察时间，故必须取匹配 Review.resolved_at；Journey 到期/证据缺失时返回 null，不能回退旧时间或 updated_at。缺时仅 all/cancelled 可见；原 RESOLVED 未最终关闭仍展示的语义保留。
- group_counts 在最终主体/角色/团队/会话/对象 READ 同快照、同筛选集合上计算，在 keyset LIMIT 之前；空页也有对应计数。第一、二列不带 group_counts、closure 为 null。
- 默认新形状直接更新 backend + client，无 include_* / closure_groups；cancelled 只暂保留，界面分组与移除属于 27B。列表 closure_kind 仅筛第三列状态，与其它条件相交并绑定游标。
- 实际响应 Schema 校验发现原搜索 Schema 漏掉既有 reporter_department；本次同步其既有 reporter_profile / web_report_urge 展示字段及解析白名单，继续拒绝任意未知字段。没有增加接口写权或任意 payload。
- 无视觉组件、CSS 或 Token 增量，因此不改设计系统规范；截图只证明当前界面能消费此只读新形状。

## 文件清单（本卡 18 个路径）

1. `app/server/src/web01-workbench-query.mts`
2. `app/server/src/workbench-card-projections.mts`
3. `app/server/src/workbench-search.mts`
4. `app/pc-admin/src/api/client.ts`
5. `shared/workbench-search-contracts.mts`（列表查询参数归一化与闭合守卫）
6. `contracts/web01_workbench_contracts.d.ts`
7. `contracts/web01_workbench_card.schema.json`
8. `contracts/web01_workbench_board.schema.json`
9. `contracts/workbench_search_contracts.d.ts`
10. `contracts/workbench_search_criteria.schema.json`
11. `contracts/workbench_search_page.schema.json`
12. `contracts/conversation_center.openapi.yaml`
13. `tests/web01-workbench.test.mts`
14. `tests/web01-workbench.integration.test.mjs`
15. `tests/t41-search-contract.test.mts`
16. `tests/pc-admin-design-foundation.test.mts`（补必填 closure 的测试数据与 K1-5 现状核对）
17. `adr/0055_workbench_closure_kind_projection.md`
18. `plans/pc-admin-design-v21/card-27a.md`

未新增 Schema 文件/模块/依赖，未改资源登记或测试路由；没有本卡 fixture 文件改动。

## 验证历史与失败保全

原件集中在 `D:/CodexEvidence/pc-admin-v217-card27a-20261106`。最终通过结果将在运行结束后追加，以下历史不重写。

- `preflight-types.log`：首次 noEmit 预检有 TS2375（nullable group_counts）及 TS2698（测试 unknown spread）；在首轮应用构建前修正了非空守卫与测试具体对象。
- `direct-01.log`：独立运行脚本用了 Windows 路径而非 ESM file URL，尚未选中/运行测试；修正脚本导入。
- `direct-02.log`：缺显式 `TS_MIGRATION_TEST_DB_ISOLATED=1`，宿主拒绝，全部测试 NOT_RUN；确认自有 loopback PG 后设置，仅用于测试。
- `build-01.log` / `types-01.log`：通过，输入 `66f5530289bcb8d524676da8e42b859037a3919b666f8cb6b91201393e78fac8`。`direct-03/summary.json` 为 28 项、27 PASS / 1 FAIL：新增时间负例误期望 P2_016_INPUT_INVALID，实际既有守卫为 LOCAL_DATETIME_INVALID；只改为准确错误码，没有移除拒绝断言。
- 独立只读审查发现 Journey 到期可能回退 BOT 旧观察时间，按真实 Review 来源修补并补测试。不是已运行的修复前 RED。
- `build-02.log` / `types-02.log`：通过，输入 `1ec4a965a13fc38ac95f752055a4baa2c007328e4e14acab233cb8b8d8919edf`。`direct-04/summary.json` 为 20 项、19 PASS / 1 FAIL：真实 search 响应被原 Schema 的 closed keys 拒绝，因漏既有 reporter_department。同步已存在的具名展示字段后重建；当轮剩余入口 NOT_RUN 保留。
- `build-03.log` / `types-03.log`：通过，输入 `7dd88ef14941b8dc2ce7e5ecfb870b479a70025d51a87179f52bec22ca329885`。`selected-59/summary.json` 为 20 项、19 PASS / 1 FAIL，57 入口 NOT_RUN：新过期场景夹具只写 epoch，违反原 retention_pair_check。修为同一 expiry 同时写 LocalDateTime/epoch；未改数据库约束。随后也补齐全部八个既有 UI 原因的映射和非默认选择证明。
- `build-04.log`：通过，输入 `2468379300f74aedef0f34c7efe577175db05c7f3fef31e4238bfa7cf642efd7`。封版前解析 OpenAPI 发现新增行内描述中的未引用逗号被 YAML 拆为额外键，修正五处引号后静态核对三操作参数/响应、闭合 Schema 及本地引用；初版外部核对脚本未拆分合法引用 fragment 的错误也留在 `contract-static-01.log`，修正后 `contract-static.json` 为 PASS。此轮没有冒称所选业务入口通过。
- `build-05.log` / `types-04.log`：通过，输入 `8b72feacc7e02c2b0a91a0ef238883c2ee9e1e1c00125551f68e0eca2af988b0`。`selected-59-02` 已完成 9 个入口、54 PASS / 0 FAIL；第 10 个入口 P2-003 由 Root 主动停止，用于修补最终筛选一致性缺口，余下 49 入口 NOT_RUN。原 summary 的 STOPPED / FAIL 状态与部分 TAP 保留，不改为通过。使用原生 Owned Job 的 terminate 协议，`selected-59-02-native-stop.json` 证明 cleanup_active_processes=0；精确清理该中断遗留的自有 UUID capacity 合成库，`interrupted-db-cleanup.log` 证明恢复 postgres/template0/template1 三库。
- 只读复核确认：原最终计数使用最新日期/related 条件，但当页仅复核 canonical READ/status，可能把等待前选中的卡与等待后的计数拼在一起。最终同一 SQL 增加 `page_matches`，用相同谓词的 `IS NOT TRUE` 捕获 false/unknown，仍先做原身份/角色/会话终检；不匹配返回现有 VERSION_CONFLICT 409，无额外查询。新场景在实际 source-read 等待边界让 Journey 到期，断言 409 且无 items/group_counts，随后刷新得到 null 来源/时间及正确近期计数。
- `build-06.log` / `types-05.log`：最终应用候选构建、strict 与负向类型检查通过，输入 `d38029a6ea7f09456bd2b82da93c6ee97914a70f7cd6b3a532357317621a8a25`。922 个编译模块全部 Node 语法检查通过，2,944 个制品；Stylelint/Token/feature-syntax 通过。此候选终验分批结果见下表，不冒称一次完整通过。
- `json-schema-structure.json`：现有 Draft202012Validator 对四个本卡 JSON Schema 的结构校验通过；`contract-static.json` 的三个操作及本地引用检查通过。web01/t41 对实际响应和真实浏览器解析执行正负契约校验，未放开未知键。
- 既有功能区 ESLint 为 0 errors / 0 warnings（`eslint-features.log`，原 lint 范围）；额外传入 api/client.ts 会被现有配置忽略并产生 1 warning（原 `eslint.log` 保留），未将其冒充为 client 的 ESLint 检查。client 由 strict 与真实解析契约验证。

## 最终候选校验与量化结果

被测目录：`D:/Worktrees/pc-admin-v217-card27a-validation`；HEAD 为原完整 SHA 加本卡未提交增量。生产/测试源码自 build-06 后没有再修改。最终 source input 为 `d38029a6ea7f09456bd2b82da93c6ee97914a70f7cd6b3a532357317621a8a25`，manifest 为 `a957f05d335035158ea14df085ea7512204ef08c4c13348280a0cec9ad0a2642`。

| 校验 | 实际结果 / 原件 |
| --- | --- |
| migration:build | build-06 PASS，922 个编译模块 / 2,944 个制品；原候选与失败保留在上述历史。 |
| gate.mjs types | types-05 PASS，含全部 strict 程序、负向类型检查、PC/H5/Desktop 类型、Stylelint、Token 与 feature-syntax。 |
| Stylelint / ESLint | Stylelint 0；51 个 CSS 文件，undefined Token=0 / primitive leaks=0。现有功能区 ESLint 0 errors / 0 warnings；api/client.ts 额外参数被配置忽略的历史 warning 不冒充已 lint。 |
| JSON / OpenAPI 契约 | 四个 Schema 的 Draft 2020-12 结构、本地引用、三个 OpenAPI 操作结构/唯一 ID/原认证引用 PASS；真实 API 与实际 client 解码正负断言 PASS。 |
| 59 个所选入口 | 同一 manifest，`selected-59-03` 中 49 入口 / 250 项 PASS，1 项 H5 seek FAIL、9 入口 NOT_RUN；`selected-tail-9-01` 为剩余 9 入口 / 168 项 PASS；原始 H5 文件在 `selected-flow-01` 原样 PASS。去重合计 59 入口 / 419 项均有通过记录，原 FAIL 不删除，非一次全绿/full/certify。汇总：selected-union-summary.json。 |
| 制品 | verify-artifact PASS / ARTIFACT_VERIFIED_NOT_ACTIVATED，artifact-before-delivery.log。 |
| 文档 | doc-links-02 PASS；check-agent-docs 工具测试 20/20 PASS，doc-tool-tests.log。 |
| Windows 界面 | observation-02 PASS：1440×1060，DPR=1，zoom=1，3 列、可见 9 张折叠卡、已加载 15 项；默认第三列含已取消卡，未报 INVALID_RESPONSE。browser-observation.json、workbench-1440.png。 |

H5 的两次正式失败分别为 `selected-59-03` 和 `selected-tail-10-01`，均停在暂停语音的 seek 联合条件（audio.currentTime≈2.5、range.value=2.5、剩余 00:02）。详情和三个媒体 Blob 已加载；previewPresent=false 不能据此归因为图片。原截图/诊断字段保存为 h5-seek-failure-1/2.png / .json，正式失败 TAP/trace 保留。只读仓库外诊断副本在 media-diagnostic-02 自然通过，不计入验收；正式原文件随后也通过，没有修改组件、选择器、业务断言、时限或测试源文件。因此只报告本候选已有通过记录，**不声称修复或稳定性已证明**，根因仍 UNCONFIRMED。

仓库外直接启动诊断/截图曾在 Edge DevToolsActivePort 启动等待超时（media-diagnostic-01 / observation-01）；这些没有跑到对应业务断言。改为沿现有 Win32 Owned Job 与同样的白名单测试环境后完成观测；未改项目启动器。两次直接启动的清理均记录进程/配置/计时器/socket 为 0。

### 查询计划

observation-02 的同一个 15 项合成集合、第三列 4 completed / 1 dismissed：limit=1 实返 1 卡，总 SQL=11；limit=50 实返 5 卡，总 SQL 仍=11；各含 1 条最终带授权证明/分组计数 SQL，没有按卡追加 closure 查询。两请求本机耗时 83.5032 / 72.6487 ms。

对捕获的真实最终 SQL 执行 EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)：planning=9.228 ms、execution=4.055 ms、顶层实际 1 行。完整计划 board-query-plan.json、语句 board-query.sql、样本 query-observation.json。仅为 Windows 本地小合成库观测，未施加云端 2C4G 资源限制，不作为生产容量/SLO 证明；没有索引或迁移。

### 六条自检

| 自检 | 是 / 否 + 证据 |
| --- | --- |
| 只改本卡允许文件 | 是。本卡独立增量 18 路径，PC app 中仅 api/client.ts；shared 为列表查询参数守卫、foundation 为类型夹具及 K1-5 核对。卡 26/27B 不属于本次实施；共享目录外来差异单独保全。 |
| 无业务命令/状态/权限/迁移/依赖变化 | 是。生产差异限三个只读查询模块与解析/合同；Closure.kind 是读分类，不是业务状态。无 package/lock/SQL 迁移/写入 facade/通知文件变化。 |
| 默认新形状、无兼容开关且解析同步 | 是。默认 API、actual client、缺字段/非法形状负例均通过；cancelled 暂留；同一未提交交付包包含后端与前端解析，未创建 PR。 |
| S1–S4 按停止线处理 | 是。S1/S3/通用关闭仅有 ADR 草案；8 个旧复核原因只读，DISMISSED restore=false，缺来源/时间为 null，未新增存储或写入。 |
| 选择器与业务断言只增不减 | 是。未改任何组件/属性/选择器；原取消排除断言按用户新默认改为明确包含该取消项；新增映射、权限、分页、日期、契约及等待后冲突断言。 |
| 带数值验收均实测 | 是。12 组合、8 原因、6/5 分组与 6 页、59/419、1440×1060/1/1、11/11 SQL、9.228/4.055 ms 均有原件；未知数据没有填造。 |

## 资源与交付收口

- `resource-cleanup.json`：所有 UUID 合成库恢复为 postgres/template0/template1，其他客户端为 0；本任务 PG 已停止，pg_ctl status=3，55487 无监听。截图宿主原生 Owned Job 正常退出，cleanup_active_processes=0；fixture 的 HTTP / pool / 浏览器清理断言通过。
- 包含 PG 数据目录递归删除的命令被自动审批拒绝，唯一返回原因为 `blocked by policy`；没有再次尝试删除。`D:/CodexData/pc-admin-v217-card27a-pg` **保留但已停用**，不宣称已删除。日志及 FAIL/NOT_RUN 原件均保留。
- 独立候选工作树、依赖 Junction 和当前 `.build` 保留用于用户审查未提交结果，不清理未合并源码；没有停止、移动或删除其它会话资源。
- 同步回指定分支工作区时仅复制本卡文件；foundation 只合入必填 closure 测试数据与 K1-5 新断言，卡 26 的其它内容不覆盖。原共享文件备份、逐文件哈希与外来差异保全见 root-before-delivery / root-delivery-sync.json。

## 待决与回退

27C 需另行确认统一关闭原因枚举、重复原单关联、通用关闭入口和 DISMISSED 恢复。PC today、H5 COMPLETED / 非活跃统计及未来月报口径只列待决，本卡没有修改。27B 才实现两组折叠和移除 cancelled 界面模式。

回退以本卡 18 路径的未提交增量为单位，保留卡 26 与用户原型；不重置共享目录、不改历史 Evidence。无迁移或写入事实需回滚。当前未运行 CI、full/certify、Electron、真实发送、现场业务写库、部署或业务 Gate。
