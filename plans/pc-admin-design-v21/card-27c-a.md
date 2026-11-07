# 卡 27C-A：统一关闭原因、通知与恢复

日期：2026-11-06 至 2026-11-07（Asia/Shanghai）。状态：本地最终组合验证通过；发布回执沿实际 PR/CI/Git 对象记录。分支：`codex/v219-card27c-a`。原始基线：`728d9d9fa95edf7e911b8bd51891df5e802296a7`（PR #157）。用户已追加授权多代理独立审查、修复复验、隔离分支提交/推送、创建 PR 和 `@codex review`、通过后合并、main 快进及本卡分支/工作树清理；下文原本地阶段记录作为历史保留。

## 来源、并行与 A0

先读本仓库 AGENTS、README、架构基线及相关开发/验证/会话/领域导航；决策见 [ADR-0056](../../adr/0056_unified_closure_reasons_notify_and_restore.md)。当前 checkout 初始干净，本任务为唯一写者。另一个活动任务位于独立 Electron 工作树。H5 C05–C09 已合并为 PR #156 并结束自有工作树，无正在修改 `app/h5/src/api/*` 的任务；卡 28 若后继启动不得改 client.ts，本卡不改 UI。

A0-1：已完成代码核对并形成 ADR 影响面表；人工 Ticket 关闭统一 CANCELLED，处理中跟进/预约/定时任务终止，会话接待保留，轮次中止留痕，恢复不重建已终止跟进。

A0-2：已确认无需新增状态；Intake 使用 IGNORED。初建即 IGNORED 没有前状态的歧义已由用户确认：同事务先 WAITING_DESCRIPTION 后关闭，恢复回 WAITING_DESCRIPTION。

A0-3：已完成八个原原因码核对，作为 NOT_IT_SCOPE 二级原因保留，详见 ADR；不作为其它一级原因或任意格式串兼容读取。

A0-4：已完成 runtime / policy / P1 关系核对；当前通知由 runtime 的 notifications.project → Communication outbox 承担，旧 P1 取消的 reporter/team 默认均已关闭，空目标取消为显式 no-op；其它事件的默认值和非空目标校验不变。

用户补充：负责人已停用/失去团队权限时恢复为 QUEUED 且负责人为空；其它情况恢复原状态/负责人。

## 实施交付

A1：已完成。071 独立关闭记录表、补充跟进终止关联、同一 ledger 的 Intake 专用关联；不回填、不兼容旧自由文本；fixture 重建六原因 × Ticket/Intake/Review、系统判定、处理中关闭及多次恢复。

A2：已完成。取消接口扩展六原因、全部开放状态与当前组写权；Intake close 与旧 MARK_OUT_OF_SCOPE 复用原 Review Port、版本和材料 fence。PC 旧对话框只在 client 固定 OTHER + 原文本；关闭投影只读新记录。

A3：已完成。服务端固定模板、当前 runtime 唯一关闭管线；Web/代录短路；恢复须有真实 ACK Attempt 证据，未尝试通知取消留痕，UNKNOWN/SENDING 保留等待原核对。

A4：已完成。Ticket/Intake 恢复接口与安全回执；恢复原状态、负责人、团队与轮次，负责人失效回 QUEUED 且为空；终止的跟进/预约不重建，热度沿原规则。

A5：已完成。COMPLETED / CLOSED_OUT、本人与科室列表及批量入口；H5 closure_text 仅固定安全文案；PC/H5 解析层同次更新，无 UI 组件/样式修改。

A5-计数：已确认无需直接修改 yxx-h5-v2-profile.mts；其 department 过滤走已更新的共享 SQL，原 total / active_count 聚合不另设完成归属，active_count 原先已经排除 CANCELLED / DUPLICATE_LINKED。集成测试逐项覆盖普通列表、科室过滤 total/active_count、home 科室摘要和 department 批量入口；进行中和未筛选总数保持原归属。

A6：已完成。ADR-0056、声明、JSON Schema、OpenAPI 和实际 API 文档已同步；独立 YAML 解析发现的新增路径拼接缺换行已修复，openapi-01.log 的失败保留。contracts-03.log 已通过 266 份 Schema、736 个本地引用和两个 OpenAPI 的解析/引用校验；命令样本与读取解码另有相关注册测试覆盖。

迁移前声明的清理范围：只限本卡测试 helper 新建的隔离 UUID 合成库；旧 fixture 的 CANCELLED / DUPLICATE_LINKED / IGNORED、轮次/事件/复核/预约及 outbox 替身事实在新库按新规则重新生成；不对既有本地开发库或任何非本地库执行 DELETE/TRUNCATE，不回填历史，不删除 Evidence。已经通过现有隔离库 helper 多次应用迁移、生成合成事实并在 finally 精确删除自有 UUID 库；最终原库清单与进程/监听读回已完成，见 cleanup-final.json。

原本地阶段业务校验、文件清单、截图和七项自检见末尾。工具检查原 FAIL 保留；当前审查修复阶段已将必要的 H5 合成工具夹具修补纳入本次用户授权，等待正式复验。

用户已补充授权只同步 tools/ts-migration/resources.json，登记本卡新增迁移和契约资源；不修改构建工具实现。


## 2026-11-07 历史实施与失败记录（原件保留）

工作跨越上海午夜，证据目录继续使用最初创建的 `D:/CodexEvidence/card27c-a-20261106-01a1b11c`，不改写旧日期/候选。本卡未提交、推送或创建 PR。

- 首轮构建通过；第二轮构建因本任务在构建期间同步契约触发 `MIGRATION_SOURCE_CHANGED_DURING_BUILD`，保留 FAIL，未当作候选。
- 初次定向批次 `direct-01` 为 22 PASS / 1 FAIL：存储先导入时触发循环绑定初始化错误；尚未进入 PG。模块探针明确为导入顺序问题，临时编译探针按原字节恢复，原始/恢复 SHA 相同；正式修补把关闭前态集放回 Core 转换表，并新增两个入口顺序的子进程回归。
- `direct-02` 保留 7 个新夹具准备 FAIL：旧 P2-012 迁移在后续结构扩展后被重复调用触发严格 catalog 拒绝。修补夹具为按序执行迁移、071 最后执行，不修改旧 SQL，不伪造 marker。
- 收据守卫继续比较原精确 inventory，只注册已校验的 071 扩展；`capture-closure-catalogs.log` 是 8 个纯结构准备，`verify-closure-catalogs.log` 是格式不一致的 FAIL。单变量格式探针证明 `pg_get_constraintdef` 的默认/pretty 表示不同；正式迁移与既有 catalog 统一 pretty 表示。`verify-closure-catalogs-02.log` 的 8 个布局已验证，不是业务验收。
- `types-02/03/04` 的类型失败、`types-05/06` 的 types + negative-types PASS，以及 `build-05` 的测试代码 undefined 守卫失败均保留原记录；最终候选的检查须独立收口。
- `eslint-final-01.log`、`stylelint-final-01.log` 均 exit 0。文档预算/本地链接检查已通过一轮，收口后重查。
- 内置 browser 连接因 native pipe 信任检查不可用；不绕过信任检查，按已授权仓库 Windows 浏览器宿主完成后续验证。截图尚待生成。
- 复用已有 FFmpeg / FFprobe 9.0.2 测试工具，没有安装依赖；数据库只在自有 127.0.0.1:55491 集群及 helper 新建的 UUID 库中运行。
- final-01 的 H5 跨层流程因独立夹具只到 065、缺关闭表而返回 503；已在原流程迁移末尾显式安装 071，后继完整 H5 原生流程通过，未修改其业务断言。
- final-02 共完成 27 个入口、235 PASS / 1 FAIL；失败在 T32 夹具准备时重放旧 032，未进入旧 UI 退役的业务断言。已把该夹具的 032 / 055 / 058 前序迁移移到共享 beforeClosureMigration 回调，最终 final-05 已验证通过；重跑优先执行失败及未到达入口，最终仍覆盖完整并集。
- tools-final-01 的 H5 主题构建隔离夹具未复制当前 Vite 配置依赖的 router-component-purity.ts；该工具文件和生产 Vite/路由辅助文件均无本卡差异。范围外修补方案只写在本地证据目录的 h5-tool-fixture-proposed.patch，保留原断言，尚未写入仓库；追加范围授权待用户回复。
- 工具完整批次已结束：7 个文件、128 项测试，127 PASS / 1 FAIL，0 SKIP / 取消；FAIL 仅为上述 H5 主题夹具。提案 v1 的隔离探针发现其编译选项也需对齐生产 allowImportingTsExtensions，v1 与 FAIL 原件保留；v2 提案的原主题单用例探针已通过，仍不是仓库工具文件的正式复测。
- T13 共享夹具的旧 046/048 会在 071 后覆盖 Ticket Event 约束。t13-fixture-red-01 在 CATALOG 阶段实际拒绝；把原四个迁移移到 beforeClosureMigration 后，t13-fixture-green-01 的关闭 / 恢复通过，业务断言与选项保持。
- 后台自动处置实测：纯感谢控制组自然 PASS，未写成 RED；另一个在首次自动分类前被人工关闭的报修，从 IGNORED / v2 被旧 Worker 改为 TICKET_CREATED / v4（intake-reprocessing-red-02）。修补候选选择、锁内检查、分类 Port 与 Web processOne，只排除当前已关闭终态；恢复提交原状态后继续原受理流程。green-01 实测已关闭状态保持，并新增 Bot / Web 正式回归，两者均通过；未增加恢复时间或材料限制。
- final-03 完成 37 个入口、274 PASS / 1 FAIL；唯一失败为 readiness 测试替身未模拟新增 071 查询。补齐对应 checksum/表就绪替身，保留全部提醒依赖断言，并增加缺少 071 时不可就绪的断言；readiness 同时明确报告 service_closure_schema。
- final-04 的 readiness 已通过；H5 static 的 14 个用例在清理断言处因本卡临时目录混用分隔符失败。只修正证据目录内运行器的 TEMP/TMP/TMPDIR 为 Windows 原生路径，没有改动仓库的清理断言；该轮 FAIL 与含重解析点的临时夹具保留，final-05 的 14 项 static 用例已通过。

## 旧期望 → 新期望 → 用户规则

| 旧期望 | 新期望 | 规则 |
| --- | --- | --- |
| 取消接受格式合法的技术原因码 / 自由文本 wire | 服务端仅接受六个一级枚举；旧 PC 文本在 client 固定 OTHER + note，外部取消 wire 删除 external_visible | U1 |
| OTHER 可无说明、非 IT 原因只验格式 | OTHER 必填非空说明；NOT_IT_SCOPE 必选原八项二级枚举，空白 note 归一为空 | U1 |
| 原八项作为 Intake 关闭一级原因 | 一级 NOT_IT_SCOPE，八项作为 secondary_reason；原其它复核结论不变 | U1 |
| HANDLER 即使同组也不能取消 | ADMIN / DISPATCHER / 当前获权 HANDLER 可关闭；失组 / 只读 / 不可见仍拒绝 | U8、U3 |
| 仅 QUEUED / ACCEPTED 可取消，处理中取消 409 | NEW/QUEUED/ACCEPTED/IN_PROGRESS/WAITING_REQUESTER/WAITING_VENDOR/REOPENED 可关闭；已结束仍拒绝 | U6 |
| DISMISSED.can_restore 恒 false | 当前获权人员对有记录、可见且已关闭事项可恢复，按前状态/负责人/轮次；失效负责人回 QUEUED 且为空 | U3 + 本次补充确认 |
| 首次感谢直接创建 IGNORED，没有前状态 | 同事务先 WAITING_DESCRIPTION，再系统关闭；恢复回 WAITING_DESCRIPTION | U3 + 本次补充确认 |
| 缺关闭证据返回未知原因/来源/时间，继续作为普通卡展示 | DISMISSED 缺关闭记录返回数据错误，正常 fixture 按新规则完整重建 | U7 |
| 自动后续分类 closed_at=null，不能进日期窗口 | 关闭事务保存实际 closed_at，可参与原日期窗口；源事件仍保留自己的 observed_at 语义 | U7、U3 |
| Card 27B 合成 unknown 卡来源/时间为空、今日已关闭 3 项（已处理共 7 项）、默认 recent 4 项 | 按新规则重建为有记录的人工 OTHER；来源/时间可证，今日已关闭 4 项（已处理共 8 项）、默认 recent 5 项；完成数量不变 | U7 |
| 关闭来源/时间/操作人从旧事件或旧 Journey 推断 | 新关闭记录为事实；单独篡改旧事件或 Journey 到期不能改写仍保留的关闭记录 | U7 |
| 日期用例改 Ticket Event.created_at | 日期合成用例改新关闭记录的 closed_at；不以 updated_at 推断 | U7 |
| 旧 P1 cancel 默认 reporter/team 都通知 | 仅该事件的两个默认值均 false；关闭通知归当前 runtime 管线 | U4 |
| 首次自动分类尚未执行的已关闭 Intake 仍可能被 Worker 改回开放状态 / 建单 | IGNORED 候选、锁内和分类 Port 均停止自动处置；Web 同步。恢复命令提交原状态后沿原流程继续 | U3、U6 |
| P1 cancel 没有投递目标时抛错 | 默认静默取消返回 null/no-op，不建 outbox；其它事件的非空目标校验保留 | U4 |
| 范围外复核走单独 SEND_FIXED_SCOPE_NOTICE | 关闭分类与统一原因矩阵经当前 outbox；内部 note 不参与文本，不重复发送 | U4 |
| 所有关闭均不发 / 或自由附带说明 | 按六项固定矩阵，OTHER 默认不发、显式 true 才发；固定文案且无内部说明 | U4、U1 |
| 已写 outbox 即可补恢复通知 | 仅已有 SENT + ACKNOWLEDGED + Attempt 证明的关闭投递可补恢复通知；未尝试则取消留痕，UNKNOWN 保留 | U4 |
| 处理中没有合法关闭终止面 | 关闭中止本轮并终止旧预约、待跟进、卡片与提醒；恢复不自动重建 | U6、U3 |
| H5 COMPLETED 包含 CANCELLED / DUPLICATE_LINKED | COMPLETED 仅 CLOSED / RESOLVED；CLOSED_OUT 为 CANCELLED / DUPLICATE_LINKED；进行中计数归属不变 | U5 |

测试名称和选择器保留原标识（包括名称中的旧业务措辞）；只按上述规则调整断言并新增用例。当前表是实施映射，最终 PASS/FAIL、文件清单和七项自检仍待下方收口。

## 迁移与回退

正向入口为编译制品 `node .build/runtime/app/server/scripts/service-closure-migrate.mjs --check` / `--apply`；目标取显式配置的 PILOT_DATABASE_URL。本次实际目标只有本卡自有 loopback 集群及现有 helper 创建的 UUID 合成库，不把该示例当作非本地库执行授权。

071 在同一事务保存原 Ticket Event、Intake Event 和 receipt 资源约束定义，再建立 closure_record、closure_supplement_termination、ledger 的 closure_intake_id、事件枚举及通知索引；保留原迁移 checksum 和 advisory lock。前序功能迁移先完成，071 最后进入 fixture；没有历史回填、原因映射或旧自由文本读取。

空 fixture 的 `--rollback` 恢复三份原约束，删除本卡表、专用收据列及 071 marker；集成测试已比较回退前后的原 catalog，并证明旧 031 只在结构回退后恢复精确匹配。已有关闭记录、新恢复/中止事件时拒绝结构回退，保留事实；不静默删数据。有本卡合成事实时，通过现有隔离库 helper 重置/删除该 UUID 库，按旧代码/迁移重建，再撤回本卡代码与资源清单差异。实际未撤回本卡工作区，也没有操作其它数据库。

迁移验证覆盖正向、幂等重入、checksum/资源 CHECK 漂移拒绝、空库回退/重上及非空事实拒绝回退；8 个 schema-only 组合只证明已有收据守卫的结构接线，不替代上述业务集成测试。

## 补充验证的风险与停止条件

已有关联用例覆盖 Ticket 即时关闭通知；另用同一编译候选的现有 projector、真实 PG 和合成 Sender 补验系统记录的批次消费与 UNKNOWN 恢复等待。只检查三个缺口：系统记录只生成一次当前 outbox；恢复不篡改 UNKNOWN；通过原核对 Port 确认 SENT 后只生成一次固定恢复通知。三项通过即停止，不运行真实外发。独立入口为本地证据目录中的 verify-system-notifications.mjs，结果在最终校验表收口。

PC/H5 截图通过现有 Windows Chrome 测试宿主加载正式编译资源及真实 PG 查询；H5 仅替换外部成员认证，完整原生 HTTP/OAuth/媒体路径另由 yxx-h5-flow 集成测试覆盖。截图和这些本地测试不代表真实企业微信登录、现场业务写入、部署或 Gate 批准。

## 原本地实施阶段候选与验证收口（历史）

对象为未提交的本地工作区，不是新的 Git commit 或 CI head。HEAD / 基线仍为 728d9d9fa95edf7e911b8bd51891df5e802296a7；分支 codex/v219-card27c-a，未暂存、提交、推送或创建 PR。

- source_input_hash：b71f3146d0fdca74360c07667a08a5908a9ec70b73bca150ba7472ccf6aa4a81
- manifest_sha256：9ebbe065518882cb33b846b260839a849cbd13c871fb675ee66e0eb41907b9a9
- 当前构建：build-19.log；927 typed、341 unchecked legacy、2959 outputs；Node 24.18.0 / PG18 / Windows Chrome。
- 制品保持 STAGED_NOT_ACTIVATED。执行记录和文档的最后收口不改应用候选；已验证的原始 manifest 与 proof 另存 build-manifest-final.json / artifact-proof-final.json。
- 证据根目录：D:/CodexEvidence/card27c-a-20261106-01a1b11c。原始 TAP、逐例 JSONL、stderr、summary 和 FAIL/NOT_RUN 不改写；系统通知的通用 evidence.json 是最终摘要指针，早期原始 system-notifications-01.log 仍保留。

| 编号 | 状态与结果 | 实际入口 / 原件 |
| --- | --- | --- |
| V1 | 已完成：应用构建 PASS，927/927 编译 Node 语法检查 | npm.cmd run migration:build；build-19.log |
| V2 | 已完成：strict / negative-types / CSS / design-variables / feature-syntax PASS | node .build/tools/gate.mjs types；types-final-12.log；另有独立 eslint-final-01.log / stylelint-final-01.log |
| V3 | 已完成：64 个入口、493/493 测试项 PASS，0 FAIL / SKIP / 取消；计数含子用例 | 已编译 runSelection API，61 个路径策略入口 + 3 个直接风险入口的去重并集；final-05/summary.json、final-05.log |
| V4 | 已完成：迁移正向、重入、漂移拒绝、空库回退 / 重上、非空事实拒绝回退 | Card 27C-A migration 集成用例；8 组合 schema-only 另见 verify-closure-catalogs-02.log，不冒充业务验收 |
| V5 | 已完成：266 份 JSON Schema、736 个本地引用、两个 OpenAPI 解析 / 引用检查 PASS；命令与读取解码用例 PASS | contracts-final.log；t10-waiting-contract、web01、t41 及 H5 契约用例 |
| V6 | 已完成：最终候选系统批次一次消费、UNKNOWN 保留、确认 SENT 后一次恢复通知，均 PASS | system-notifications-final.log；system-notification-evidence.json；仅合成 Sender / outbox，无真实外发 |
| V7 | 已完成：共享 T13 夹具迁移不再覆盖 071 事件，真实关闭 / 恢复 PASS | t13-fixture-green-02.log / .json；RED 原件保留 |
| V8 | 已完成：PC / H5 编译界面与真实 PG 查询加载 PASS，Windows / DPR 1 / zoom 1 | client-smoke-02/evidence.json 与三张原始 PNG；H5 仅外部成员认证为合成替身，原生 HTTP/OAuth/媒体另由正式 H5 flow 用例覆盖 |
| V9 | 停止待确认：工具完整批次 7 文件、128 项，127 PASS / 1 FAIL，0 SKIP / 取消；工具源码没有后继改动 | tools-final-01.log；actual theme build 失败；本轮为构建 14 时的工具批次，不冒充构建 19 的完整工具复跑 |
| V10 | 已完成：88 路径范围审计 PASS；20 个既有测试文件的名称与属性选择器无删除 | scope-final.log / scope-audit.json；Git 实质差异清单见下 |
| V11 | 已完成：自有 UUID 库清理，PG 停止，55491 无监听 | cleanup-final.json、final-db-list.txt、pg-stop.log；仅 postgres / template0 / template1 |
| V12 | 已完成：文档链接/预算、git diff --check、verify-artifact 均 PASS | docs-final.log / diff-final.log / artifact-final.log；制品已验证，未激活 |

工具待确认项来自用户允许路径及“tools 仅 resources.json”的追加授权。仓库 tools/ts-migration/h5.test.mts 尚未修改。已准备 h5-tool-fixture-proposed.patch，补齐隔离夹具的现有 Router 文件、现有 HashRouter 依赖装配及与生产一致的 TypeScript 导入选项；全部原断言保留，生产依赖和界面不变。h5-tool-fix-probe-02.log 仅证明原主题单用例的隔离提案可行，不能代替正式整文件工具复测；用户授权到达前不写入此文件。

早期 contracts-02.log 的验证脚本曾把可选 operationId 当必填，后改为检查已提供 ID 的唯一性；保留该脚本 FAIL，未修改生产契约迎合错误前提。build-16.log 的新用例类型失败为既有 JS helper 将 serviceCode 推断成 null；补成其本来就支持的 string|null 参数说明，没有类型逃逸。其余早期类型/构建/定向批次失败见上文与同名原件；最终 final-05 的 not_run 为空。

## 验收与七项自检

| 自检项 | 是 / 否 + 证据 |
| --- | --- |
| 仅本卡允许文件，未改界面组件/样式 | 是；scope-audit.json 的 88 路径；PC 仅 api/client.ts 与 feature client.ts，H5 仅 api；tools 仅已授权资源清单，范围外提案未应用 |
| U1–U8 全落实，未自行增加或放宽规则 | 是；ADR-0056、六原因 × Ticket/Intake/Review、七个开放状态、三工作台角色、恢复原状态/负责人/轮次及失效负责人 QUEUED 回归；恢复后沿原流程处理，无额外恢复时间/材料限制 |
| 内部说明不会外发或返回 H5 | 是；矩阵逐项 outbox / 渲染断言、H5 closure_text / entry 隐私断言、系统/UNKNOWN 补验均通过；H5 SQL 只取原因码和可选原单编号 |
| 无新增依赖，无真实通知 | 是；package / lock 无差异；existing Chrome / FFmpeg 9.0.2；合成 Sender、fake Provider 与 outbox；real_sends=0 |
| 无历史映射/兼容读取，数据按新规则合成 | 是；新建隔离库、071 无回填；缺关闭记录为数据错误；六原因与系统/处理中/重复关闭恢复数据经既有 fixture/Port 重建，finally 删除 UUID 库 |
| 选择器只增不删，业务期望变更有逐条表 | 是；scope-audit.json 的既有测试名称/属性选择器审计无删除；上文“旧期望→新期望→规则”表；无删除用例/注册或跳过替代 |
| 待合并候选的 PC/H5 可正常运行 | 是（本地候选证据）；正式编译包截图、PC 浏览器与 H5 原生 HTTP/媒体流程通过；main 尚未合并，CI/真实企业微信登录/部署/现场 Gate 未执行 |

停止与保全：仅停止本卡自有 PG；保留停机的数据目录、当前一份 staged build、原始 Evidence，以及清理断言失败的临时夹具和重解析点。未删除用户原件、其它任务资源、历史失败或恢复引用。27C-B / 27C-H 的界面实现仍遵循原依赖顺序，不在本卡启动。

## 文件清单

共 88 个 Git 实质差异/新增路径。

- `adr/0056_unified_closure_reasons_notify_and_restore.md`
- `app/h5/src/api/query.ts`
- `app/h5/src/api/read-decode.ts`
- `app/h5/src/api/types.ts`
- `app/pc-admin/src/api/client.ts`
- `app/pc-admin/src/features/closure/client.ts`
- `app/pc-admin/src/features/manual-review/client.ts`
- `app/server/scripts/human-workbench-role.mts`
- `app/server/scripts/p2-016-process-role.mts`
- `app/server/scripts/service-closure-migrate.mts`
- `app/server/scripts/workbench-follow-migrate.mts`
- `app/server/src/p1-004-service-intake.mts`
- `app/server/src/p1-005-pilot-ticket-core.mts`
- `app/server/src/p1-006-ticket-state-actions.mts`
- `app/server/src/p1-007-notification-outbox.mts`
- `app/server/src/p2-004-communication-delivery-worker.mts`
- `app/server/src/p2-006-delivery-command-schema.mts`
- `app/server/src/p2-015-decision-router.mts`
- `app/server/src/p2-015-rule-first-orchestrator.mts`
- `app/server/src/p2-015-service-intake-decision-port.mts`
- `app/server/src/p2-015-worker.mts`
- `app/server/src/p2-016-manual-review-facade.mts`
- `app/server/src/p2-016-runtime.mts`
- `app/server/src/p2-016-ticket-command-facade.mts`
- `app/server/src/p2-016-ticket-command-ledger.mts`
- `app/server/src/p2-016-ticket-notification-policy.mts`
- `app/server/src/p2-016-ticket-notification-projector.mts`
- `app/server/src/p2-016-ticket-query.mts`
- `app/server/src/p2-016-workbench-http.mts`
- `app/server/src/service-closure-notifications.mts`
- `app/server/src/service-closure-records.mts`
- `app/server/src/web01-workbench-query.mts`
- `app/server/src/workbench-card-projections.mts`
- `app/server/src/workbench-intake-closure.mts`
- `app/server/src/workbench-supplement-follow-up.mts`
- `app/server/src/yxx-h5-batch-sql.mts`
- `app/server/src/yxx-h5-entry.mts`
- `app/server/src/yxx-h5-v2-contracts.mts`
- `app/server/src/yxx-h5-v2-lifecycle.mts`
- `app/server/src/yxx-self-service-native-http.mts`
- `app/server/src/yxx-self-service-orchestrator.mts`
- `app/server/src/yxx-self-service-query.mts`
- `contracts/conversation_center.openapi.yaml`
- `contracts/p2_016_contracts.d.ts`
- `contracts/p2_016_manual_review_resolution.schema.json`
- `contracts/p2_016_ticket_detail.schema.json`
- `contracts/ticket_event.schema.json`
- `contracts/unified_closure_command.schema.json`
- `contracts/unified_closure_contracts.d.ts`
- `contracts/unified_intake_closure_command.schema.json`
- `contracts/unified_restore_command.schema.json`
- `contracts/web01_workbench_card.schema.json`
- `contracts/web01_workbench_contracts.d.ts`
- `contracts/workbench_search_page.schema.json`
- `contracts/yxx_h5_v2_contracts.d.ts`
- `contracts/yxx_self_service.openapi.yaml`
- `contracts/yxx_self_service_contracts.d.ts`
- `contracts/yxx_self_service_request_detail.schema.json`
- `database/migrations/071_unified_service_closure.sql`
- `docs/api/README.md`
- `docs/api/endpoint-index.md`
- `docs/api/member/h5-v2.md`
- `docs/api/workbench/closure.md`
- `docs/api/workbench/manual-reviews.md`
- `docs/api/workbench/tickets.md`
- `plans/pc-admin-design-v21/card-27c-a.md`
- `tests/helpers/card27c-closure-cases.mts`
- `tests/helpers/t11-completion-fixture.mts`
- `tests/helpers/t13-profile-fixture.mts`
- `tests/helpers/t24-round-notification-fixture.mts`
- `tests/helpers/t25-app-notification-fixture.mts`
- `tests/helpers/t32-notification-exception-fixture.mts`
- `tests/helpers/t35-read-fixture.mts`
- `tests/helpers/wbint-t22-fixture.mts`
- `tests/helpers/web01-workbench-fixture.mjs`
- `tests/p2-016-ticket-lifecycle.integration.test.mjs`
- `tests/pc-admin-card12.browser.test.mts`
- `tests/pc-admin-design-foundation.test.mts`
- `tests/t10-action-boundaries.integration.test.mts`
- `tests/t10-waiting-contract.test.mts`
- `tests/t10-waiting.integration.test.mts`
- `tests/t41-search-contract.test.mts`
- `tests/web01-workbench.integration.test.mjs`
- `tests/web01-workbench.test.mts`
- `tests/yxx-h5-flow.integration.test.mts`
- `tests/yxx-h5-runtime.test.mts`
- `tests/yxx-h5-v2.integration.test.mts`
- `tools/ts-migration/resources.json`


## 2026-11-07 独立审查与发布阶段

授权：用户明确要求多子代理独立审查，发现问题修复复验，通过后提交到隔离分支、推送、按 pr skill 创建 PR 并请求 `@codex review`，继续处理 CI/审查到合并、main 快进和本卡分支/工作树清理。该授权覆盖本轮必要的 H5 工具合成夹具修复；不新增生产依赖、不改生产 UI、不真实发送或部署。

本轮唯一写者为 Root；四子代理只读源码和差异，提案写入外部证据目录，由 Root 核 SHA 后整合。审查对象为原基线 728d9d9 下全部 88 路径的工作区差异和新文件全文；不是空的 HEAD...HEAD 差异。code-review 两轴分别报告：Standards 2 项、最高 P2；Spec 2 项、最高 P1。OCR delegate v1.13.6 实际 preview/rule 选择 27 文件，27/27 已审；61 个 unsupported_ext 由代理逐份补读，61/61 已审，不称其为工具自动覆盖。另一路聚焦事务与恢复。去重后 7 项，均已修复并经各自源码复审确认；四路不调用真实通知。

| 编号 | 发现与修补 | 对应复验 |
| --- | --- | --- |
| R1 | 新恢复安全回执在 receipt SELECT 等待后重查当前 READ / 绝对认证 TTL，三种安全结果均不泄露旧授权数据 | t10-waiting-ack：TEAM/TTL × COMMITTED/FAILED/UNKNOWN，8/8 含原用例 PASS |
| R2 | 旧 MARK_OUT_OF_SCOPE Schema 收紧为 NOT_IT_SCOPE + 必填二级原因；六原因仍在专用关闭接口 | t10-waiting-contract：8 个正例、10 个反例同时核对 Schema/runtime；入口 4/4 PASS |
| R3 | 所有共享 Ticket facade 命令统一 stream → receipt → Ticket 锁序，避免旧默认配置与新关闭/恢复死锁 | 原配置、真实 PG 门控并发，pg_blocking_pids 观察实际等待；纳入核心入口 74/74 PASS |
| R4 | 固定关闭/恢复文本绑定持久关闭记录、实际 Delivery/Message/source reporter、hash/幂等键；沿当前资格，等待后复核，普通文本不可借用 | 真实 Worker → Sender → 合成 SDK；Ticket/Intake 动态资格通过、拒绝、等待中身份/状态改变、伪造 marker；核心入口 PASS |
| R5 | 投影和发送前检查同主体最新 before_version、当前开放状态和 Intake 权威 Ticket；过时恢复通知停止，UNKNOWN 原核对证据保留 | UNKNOWN A → 恢复A → 关闭B → 核对A SENT、已排队恢复再次关闭、Intake 对应 Ticket 结束；核心入口 PASS |
| R6 | 有效 ADMIN/DISPATCHER 沿既有全局权限恢复原负责人；HANDLER 仍校验团队；真实失效回 QUEUED/null | 无 membership 的两种全局负责人及失效/多次恢复；核心入口 PASS |
| R7 | Human/P2016 Worker/Gateway 就绪前要求071；Gateway 早于受理/SDK/网络，拒绝关闭自有 pool；通用 G1 默认不加前置 | 四角色及实际 runGateway 顺序/拒绝清理；yxx-h5-runtime 19/19 PASS |

原始审查及复审原件在 D:/CodexEvidence/card27c-a-review-20261107-01a1b11c：standards-review、spec-review、ocr-review、transaction-review 及 recheck-*。报告区分源码复审与本段实际运行，不把提案或 parse-only 当业务 PASS。

组合修补的初次执行对象仍是未提交工作区：build-01.log 的 input_hash=516bf041a4bf7759b2601db89e28bd16bf805f5905902e644cabcfdd7426cacd，928 typed / 341 unchecked legacy / 2961 outputs；928/928 Node 语法检查、types-01（strict/negative/CSS/design variables/feature ESLint）PASS。direct-01 的9入口149/149 PASS、0 FAIL/SKIP/取消；工具 h5-tool-01 完整文件13/13、tools-fast-01 四文件47/47 PASS；266 Schema/736本地引用/两OpenAPI PASS；docs-01、制品和差异空白校验 PASS。原 tools-final-01 的127/128 FAIL 作为历史保留，由 h5-tool-01 正式复验闭合。

本轮新增工具修补仅对齐 H5 实际主题构建的合成 fixture：复制已存在 purity helper、沿生产编译选项、声明已有 React Router 并包裹测试入口。没有新增安装依赖，没有改工具生产实现或删旧断言。

| 旧期望 | 新期望 | 规则 |
| --- | --- | --- |
| 关闭 H5 的 Worker 不查任何 schema | 仍不查 H5 可选 schema；当前关闭管线必需的071先验证 | U3、U4，A0/A1 当前 runtime 依赖 |
| H5 Worker 仅要求064/065（或066） | 先要求071，再沿原H5可选依赖；缺071不得 ready | U3、U4，A0/A1 当前 runtime 依赖 |

本轮94路径范围审计 PASS：无生产 UI 组件/样式、依赖差异；21个已有测试文件的名称/属性选择器删除0。原88文件清单继续保留，审查修复新增范围如下（现有文件内修补已在原清单）：
- `app/server/scripts/p2-g1-process-role.mts`
- `app/server/src/p2-012-live-reporter-scope.mts`
- `app/server/src/p2-016-wecom-sender.mts`
- `tests/helpers/card27c-notification-review-cases.mts`
- `tests/t10-waiting-ack.integration.test.mts`
- `tools/ts-migration/h5.test.mts`

后继接入 Card28 main、组合候选路径计划及完整回归、截图、远端 PR/CI/Codex、合并/main快进/清理以随后追加的实际回执为准，本段不预报成功。


### 接入已合并 Card28 的组合候选

本轮定向通过后首次提交为 344aac7a1f2c1612025baae68270580a90c60a93。GitHub/原生 fetch 读回 main 为 caa4d98bbd9afc421e76004743cd741e9350db36（PR #158）；用保留祖先的 merge 接入，组合候选复验前不提交 merge。唯一冲突位于 tests/pc-admin-card12.browser.test.mts；保留 Card28 全部单表布局适配、两条新测试、折叠/热度/sticky/键盘/SSE导航/无业务写入断言，同时保留本卡 U7 已关闭计数。未改上游生产 UI；相对 origin/main 的本卡仍为94路径。

seedCard28Board 新重复关联单通过原 insertClosureRecord helper 写 SYSTEM/DUPLICATE，原单使用本夹具真实可见的已完成 Ticket 编号；删除仅伪造 duplicate_of 的 response seam，保留其它三项合成读取字段。原日期交错目的不变，取消时间改写新关闭记录，完成时间仍沿完成事件。独立整合审查原件 integration-card28-review.md。

| 旧期望 | 新期望 | 规则 |
| --- | --- | --- |
| Card28 原重复原因标签“重复” | 固定一级原因标签“重复报修” | U1 |
| 原单编号由响应替身注入、没有原单事实 | 新关闭记录保存实际可见的已完成原单编号，列表/详情共用同一事实 | U2、U7 |
| 重复关联合成终态只有旧 Event | 同步写 SYSTEM/DUPLICATE 关闭记录，不做旧事实兼容读取 | U7 |
| overlap receipt 的 dismissedToday 仍为3（相邻实际断言已为4） | receipt=4，与新规则重建后的实际断言一致 | U7 |

Card28 已合并的单表数量1、tr.ds-work-row、子组逐一展开等是保留上游布局断言，不是本卡改变界面或业务规则。接下来的构建、路径并集和 Windows PC/H5截图独立绑定组合候选，原候选149项通过不冒充该组合验证。


### 补审 R8：新只读入口的 Cookie 会话终检

R8 已确认并复现：原外层只在进入 authenticatedHandler 前认证，新增回执等到 receipt SELECT 后只重查 Principal/对象READ/TTL，官方 logout 撤销的 stored Cookie session 没有参与最后检查。Intake closure-context 同属新增只读入口。沿 AGENTS 原当前READ/等待后终检合同修补，不扩大到写命令或历史ACK。

修补前组合候选 integrated-01 已完成64入口538/538 PASS、0 FAIL/SKIP/取消；manifest=6573f94843c3eb73ad4dd70b6a21b4c619599da5251e1df2c5c5d49405ee3796、input_hash=408389d336c88ab86e24a9c1b190733b1d0b7c5bef41dad129de0c8612d40b34，原manifest/proof及制品终检已归档。这538项没有覆盖R8，不冒充修补后候选。

真实红例 ack-cookie-red-01.log：已有 fixture/正式HTTP先关闭和恢复；pg_stat_activity 观察到实际 receipt SELECT 被自有锁阻塞后，官方 logout 返回200；session=REVOKED，TTL未过、Principal/角色/团队不变。释放锁后旧GET仍200/COMMITTED，期望401的真实断言FAIL，原件保留；不只依赖源码推导，没有伪造RED。

Root核4文件原SHA后应用外部提案；Runtime只把原 currentSessionPredicate 交给新 Ticket restore ACK、Intake close/restore ACK 与 closure-context；读取等待后核验原会话，已退出返回401且无旧结果。Intake read wrapper也沿既有绝对TTL检查，过期返回403；内部principal-only与静态认证不新增存储会话前置，写命令和历史ACK不变。没有新状态、权限、依赖、锁或迁移。

新增正式回归进入既有 t10-waiting-ack 注册入口：3个Cookie回执GET×COMMITTED/FAILED/UNKNOWN共9、context logout 1，以及Intake非持久认证的 close ACK/restore ACK/context 3个物理TTL等待子例。只用原fixture、官方业务命令/退出登录和现有Client持锁，不写receipt或替换真实authorizer。此为新增覆盖，未改既有断言或选择器。

独立Spec核对最终4文件提案可采纳，确认401沿同一WorkbenchError进入外层HTTP、初始化接线成立且无新增锁序；原始报告 ack-auth-audit.md、r8-spec-review.md。初始四路7项和本次补审1项合计8项；R8运行复验尚待下面实际结果收口。


## 最终本地交付（含独立审查修补 R1–R8）

A0：已完成。四项书面结论、处理中关联对象与定时任务处理、终态复用、二级原因映射及单一通知管线均在 ADR-0056；两项业务歧义已有用户补充确认。

A1：已完成。六原因固定校验、追加关闭记录、系统实际关闭时间、六原因×两主体及恢复/多次关闭合成事实，迁移与回退均有正式集成验证；仅重建现有helper持有的UUID测试库。

A2：已完成。全部开放状态、当前可见范围及ADMIN/DISPATCHER/HANDLER、只读与不可见拒绝、输入校验、幂等/并发/安全回执、原单可选关联及新记录投影；原PC对话框client适配OTHER，不改界面。

A3：已完成。逐原因矩阵、内部说明隔离、真实ACK与UNKNOWN、旧P1取消静默、固定文案及真实Sender到合成SDK回归全部通过，无真实外发。

A4：已完成。原状态/负责人/团队/轮次、负责人失效回QUEUED/null、多次关闭/恢复、挂起任务不重建及原热度规则；新只读Cookie/TTL等待终检完成。

A5：已完成。H5 COMPLETED/CLOSED_OUT及受影响计数、固定安全closure_text、PC/H5解析层同步；Windows编译界面和真实PG查询加载通过。

A6：已完成。声明/Schema/OpenAPI/API文档/ADR与执行记录同步；原件、验证身份、业务断言映射及迁移回退说明保留。没有新增依赖、兼容开关或生产UI改动。

| 编号 | 结果 | 入口 / 原件 |
| --- | --- | --- |
| F1 | 已完成：928/928 Node语法、928 typed /341 legacy /2961 outputs，严格构建PASS | build-r8-01.log，npm.cmd run migration:build |
| F2 | 已完成：strict / negative-types / Stylelint / design variables / feature ESLint / PC-H5 types PASS | types-r8-01.log，gate.mjs types |
| F3 | 已完成：64入口556/556 PASS，0 FAIL/SKIP/取消/未到达，计数含子用例 | integrated-r8-01/summary.json及逐例JSONL/TAP |
| F4 | 已完成：旧200→401红例保留；相同官方logout门控新候选401且只有error；正式ACK26/26 PASS | ack-cookie-red-01.log、ack-cookie-green-01.log及已注册ACK入口 |
| F5 | 已完成：迁移正向/重入/漂移拒绝/空库回退和重上/非空事实拒绝回退；业务矩阵和所有计数PASS | F3中的migration、closure、H5 integration入口 |
| F6 | 已完成：266 Schema、736本地引用和两份OpenAPI PASS；本轮工具13/13+47/47 PASS | contracts-r8-01.log、h5-tool-01.log、tools-fast-01.log；未把其它重工具的旧结果改绑当前候选，完整PR工具结果以原生CI为准 |
| F7 | 已完成：Windows /DPR1 /zoom1，PC及H5正式编译资源+真实PG查询加载，H5 COMPLETED仅一项且取消项未混入 | client-smoke-final-r8-01/evidence.json及三张原始PNG；外部成员认证为合成替身，不是真实企业微信登录 |
| F8 | 已完成：94路径，21个已有测试文件名称/属性选择器删除0；生产UI/样式/包依赖差异0 | scope-r8-01.log、scope-integrated-audit.json |

最终应用验证对象是 HEAD 344aac7a1f2c1612025baae68270580a90c60a93 + MERGE_HEAD caa4d98bbd9afc421e76004743cd741e9350db36 的未提交组合工作区，后续普通merge提交保存真实祖先；不把该工作区回执改绑成未来Git/CI head。

最终 input_hash：`61be66050c4ce78491ca038282602b7dcf8a2f0bb18497db835e0905b4e6b594`；manifest_sha256：`5382836cf38bae966838b1d19a86a9548b44995540dc66c2c4c6f2569ddc6c0c`。raw manifest/proof已另存 manifest-final.json / proof-final.json。制品保持 STAGED_NOT_ACTIVATED，无部署。


### 本轮七项自检

1. 是：相对已合入的main只有94个授权路径；生产UI组件/样式0差异；工具资源清单为原明确授权，H5合成工具夹具为本轮必要审查修复。
2. 是：U1–U8与两项用户补充确认全部落实，未增加状态或放宽权限；对应A0–A6与F3。
3. 是：内部说明不进入H5或通知；固定模板、真实Sender合成SDK及JSON投影有负面断言；F3/F7。
4. 是：包清单/锁文件无差异；测试和截图无真实外发；F3/F8及截图evidence。
5. 是：无历史映射/回填/自由文本原因读取；缺记录为数据错误；现有fixture按新规则重建，精确回收自有UUID库。
6. 是：选择器/测试名删除0；旧业务期望的修改均列在前述U规则映射；R8只新增覆盖，未改既有断言。
7. 是（本地组合源码）：PC/H5已在相同候选加载、完成口径正确；合并阶段另以PR head/merge tree和原生CI核验同树，不预报远端结果。

提交、推送、PR/Codex/CI、合并、main快进与本卡分支清理继续由Root按本次授权完成，最终实际对象与回执见PR及交付回复；本记录不授予真实通知、现场写库、部署或Gate。

### R8发布候选文件清单（94）

- `adr/0056_unified_closure_reasons_notify_and_restore.md`
- `app/h5/src/api/query.ts`
- `app/h5/src/api/read-decode.ts`
- `app/h5/src/api/types.ts`
- `app/pc-admin/src/api/client.ts`
- `app/pc-admin/src/features/closure/client.ts`
- `app/pc-admin/src/features/manual-review/client.ts`
- `app/server/scripts/human-workbench-role.mts`
- `app/server/scripts/p2-016-process-role.mts`
- `app/server/scripts/p2-g1-process-role.mts`
- `app/server/scripts/service-closure-migrate.mts`
- `app/server/scripts/workbench-follow-migrate.mts`
- `app/server/src/p1-004-service-intake.mts`
- `app/server/src/p1-005-pilot-ticket-core.mts`
- `app/server/src/p1-006-ticket-state-actions.mts`
- `app/server/src/p1-007-notification-outbox.mts`
- `app/server/src/p2-004-communication-delivery-worker.mts`
- `app/server/src/p2-006-delivery-command-schema.mts`
- `app/server/src/p2-012-live-reporter-scope.mts`
- `app/server/src/p2-015-decision-router.mts`
- `app/server/src/p2-015-rule-first-orchestrator.mts`
- `app/server/src/p2-015-service-intake-decision-port.mts`
- `app/server/src/p2-015-worker.mts`
- `app/server/src/p2-016-manual-review-facade.mts`
- `app/server/src/p2-016-runtime.mts`
- `app/server/src/p2-016-ticket-command-facade.mts`
- `app/server/src/p2-016-ticket-command-ledger.mts`
- `app/server/src/p2-016-ticket-notification-policy.mts`
- `app/server/src/p2-016-ticket-notification-projector.mts`
- `app/server/src/p2-016-ticket-query.mts`
- `app/server/src/p2-016-wecom-sender.mts`
- `app/server/src/p2-016-workbench-http.mts`
- `app/server/src/service-closure-notifications.mts`
- `app/server/src/service-closure-records.mts`
- `app/server/src/web01-workbench-query.mts`
- `app/server/src/workbench-card-projections.mts`
- `app/server/src/workbench-intake-closure.mts`
- `app/server/src/workbench-supplement-follow-up.mts`
- `app/server/src/yxx-h5-batch-sql.mts`
- `app/server/src/yxx-h5-entry.mts`
- `app/server/src/yxx-h5-v2-contracts.mts`
- `app/server/src/yxx-h5-v2-lifecycle.mts`
- `app/server/src/yxx-self-service-native-http.mts`
- `app/server/src/yxx-self-service-orchestrator.mts`
- `app/server/src/yxx-self-service-query.mts`
- `contracts/conversation_center.openapi.yaml`
- `contracts/p2_016_contracts.d.ts`
- `contracts/p2_016_manual_review_resolution.schema.json`
- `contracts/p2_016_ticket_detail.schema.json`
- `contracts/ticket_event.schema.json`
- `contracts/unified_closure_command.schema.json`
- `contracts/unified_closure_contracts.d.ts`
- `contracts/unified_intake_closure_command.schema.json`
- `contracts/unified_restore_command.schema.json`
- `contracts/web01_workbench_card.schema.json`
- `contracts/web01_workbench_contracts.d.ts`
- `contracts/workbench_search_page.schema.json`
- `contracts/yxx_h5_v2_contracts.d.ts`
- `contracts/yxx_self_service.openapi.yaml`
- `contracts/yxx_self_service_contracts.d.ts`
- `contracts/yxx_self_service_request_detail.schema.json`
- `database/migrations/071_unified_service_closure.sql`
- `docs/api/README.md`
- `docs/api/endpoint-index.md`
- `docs/api/member/h5-v2.md`
- `docs/api/workbench/closure.md`
- `docs/api/workbench/manual-reviews.md`
- `docs/api/workbench/tickets.md`
- `plans/pc-admin-design-v21/card-27c-a.md`
- `tests/helpers/card27c-closure-cases.mts`
- `tests/helpers/card27c-notification-review-cases.mts`
- `tests/helpers/t11-completion-fixture.mts`
- `tests/helpers/t13-profile-fixture.mts`
- `tests/helpers/t24-round-notification-fixture.mts`
- `tests/helpers/t25-app-notification-fixture.mts`
- `tests/helpers/t32-notification-exception-fixture.mts`
- `tests/helpers/t35-read-fixture.mts`
- `tests/helpers/wbint-t22-fixture.mts`
- `tests/helpers/web01-workbench-fixture.mjs`
- `tests/p2-016-ticket-lifecycle.integration.test.mjs`
- `tests/pc-admin-card12.browser.test.mts`
- `tests/pc-admin-design-foundation.test.mts`
- `tests/t10-action-boundaries.integration.test.mts`
- `tests/t10-waiting-ack.integration.test.mts`
- `tests/t10-waiting-contract.test.mts`
- `tests/t10-waiting.integration.test.mts`
- `tests/t41-search-contract.test.mts`
- `tests/web01-workbench.integration.test.mjs`
- `tests/web01-workbench.test.mts`
- `tests/yxx-h5-flow.integration.test.mts`
- `tests/yxx-h5-runtime.test.mts`
- `tests/yxx-h5-v2.integration.test.mts`
- `tools/ts-migration/h5.test.mts`
- `tools/ts-migration/resources.json`


## PR159 原生CI补修 CI01

发布 head 94d463c832390dbf98675ae39c786052b453628e 已推送并创建PR159，显式 @codex review 请求已发出。远端Codex返回 code-review usage limits，未执行审查，无实际代码结论；不计PASS。沿用户指定的code-review/OCR delegate与仓库回退规则，最终 Standards / Spec 已分别对该head/base caa4d98做独立核对，94路径、0剩余finding；原件 final-published-standards.md / final-published-spec.md，两个轴不混排。

人员目录CI run 42291981006 在既有 t02-baseline 的 p2-007-staff-directory-process-role.test.mjs 失败：旧pool替身只有rowCount=1、rows=[]，不包含新增071所要求的真实SQL checksum与两表就绪行，SERVICE_CLOSURE_SCHEMA_REQUIRED在原目录断言前拒绝。原CI FAIL和后续未到达保留于ci-staff-failed-01.log / 原CI制品，不改CI选择器或生产守卫。

CI01只在该已有测试替身模拟071已就绪，checksum从已有制品资源读取；原目录转发断言、两种launcher、enabled/disabled流程和live-fetch拒绝均保留。没有新的业务断言期望或生产代码变化。此前556项/截图保持其原候选身份；本次将构建后跑完整t02-baseline及适用检查，应用产物与原候选逐字节比较，不把测试替身差异伪装为整个旧候选重跑。

| 旧替身期望 | 新替身期望 | 依据 |
| --- | --- | --- |
| current P2016 Worker beforeReady仅需旧目录036替身 | 同时模拟当前必需071 checksum+两表，旧目录036与角色拥有者断言保持 | U3/U4、A0/A1当前runtime依赖；R7，无旧业务断言修改 |

该额外路径属于原允许的后端测试范围，当前PR文件数95。运行结果随后按实际回执收口。


### CI02：保留原 safe-claim 校验与单表锁语义

CI01本地完整t02-baseline到第12入口：80项、79PASS/1FAIL，后5入口NOT_RUN，原summary/TAP保留于ci01-t02-01。失败为 public P2-015 validator 的原 safe-claim 字面检查仅识别 FOR UPDATE SKIP LOCKED；本卡关闭后防重新处理的claim增加了单表别名限定 FOR UPDATE OF current_intake SKIP LOCKED，触发其“worker uses PostgreSQL safe claim”拒绝。

不改校验器、不放宽旧门禁、不删断言。claim仍只FROM同一service_intake表，恢复原FOR UPDATE SKIP LOCKED写法；新IGNORED排除条件完整保留，两种写法在该单表语句锁定同一行。原业务状态、权限、SKIP LOCKED并发合同均不变。下一候选将完整复跑t02-baseline，并补跑关闭/恢复及自动关闭后不重新处置的原注册入口；源码/制品/结果另记，不改绑80项FAIL或之前556项的身份。

这是一处已有安全校验的SQL写法对齐，无业务断言期望变更；对应U3/U6要求关闭后不再被自动工作器改回开放状态，原PostgreSQL安全claim底线保留。


### CI03：补齐剩余两个当前Runtime夹具的071

对t02尚未到达5入口的只读审查确认两处准备不足：p2-016-workbench-http第二场景和p2-016-live-cluster只到031，却启动当前Runtime并要求ready/批次投影或Worker/Gateway启动。各在已有migrateP2016后调用原migrateServiceClosure(mode=apply)，不改任何原断言、测试名、选择器、数据输入、通知或权限。

其余worker-restart、worker单元与schema-contract未发现需要预改的内容，保持原样。独立审查与两文件原/新SHA在t02-tail-audit、patch-t02-tail；Root核原SHA后唯一应用。旧031/036目录和历史SQL校验器不修改；当前Runtime必需071对应U3/U4/U7、A1/A6，不是新业务状态或新Flag。

CI02重建928/928语法与types门禁均PASS，原manifest/proof已另存；接下来单独验证CI03组合，当前PR改动97路径（新增的3份既有后端测试均属原允许范围）。


### CI03最终本地收口

CI03 build-ci03-01与types-ci03-01均PASS：928/928 Node语法、strict/negative/CSS/design变量/feature ESLint/PC-H5类型全部通过。完整t02-baseline为17入口98/98 PASS、0 FAIL/SKIP/取消/未到达；包含旧失败的目录角色与public validator、Worker重启、schema合同、真实HTTP和三进程零live SDK调用。ci03-risk-01另有核心74/74与Cookie ACK26/26，共100/100 PASS、0 FAIL/SKIP，覆盖新单表claim在关闭/恢复与Bot/Web不重新处置路径中的实际行为。

本候选manifest=002ddba2e9990c160f9e77f05273cbc3214246614e879dca3465f88158c26d26，input_hash=7e57b9aa9947ee83746946a979917e105833e569347f86ac37bac40996a0ea75，原件manifest-ci03-final/proof-ci03-final。对R8的556项候选逐字节比较，变化只为Worker的锁写法mjs/map与3份测试文件；其它产物全部相同。旧556项与截图保留原manifest，本次98+100另列，不改绑。

ci-delta-standards与ci-delta-spec分别只读审查5文件增量，0finding：单表锁等价、两处IGNORED防线保留、原validator未改、3份测试原正文/断言/输入/清理保留。旧94d完整审查与后继增量共同覆盖当前97路径；scope-ci03-audit已核24份原测试名称/属性选择器删除0，无依赖/生产UI差异。

本轮仅临时重启自有127.0.0.1:55491隔离PG；早期启动协调器等待子进程，重启期间的辅助探测收到starting-up错误已保留，改为只等待pg_ctl主进程后再次确认原data_directory/port/listener正确，业务测试均在就绪后执行。原始业务/CI FAIL和NOT_RUN继续保留。

最新文件清单为上节R8的94路径，加以下3份原有后端测试，共97；Worker和执行记录已在原清单：

- `tests/p2-007-staff-directory-process-role.test.mjs`
- `tests/p2-016-workbench-http.integration.test.mjs`
- `tests/p2-016-live-cluster.integration.test.mjs`

当前五文件CI修补已经本地复验通过，将追加提交至同一授权分支并更新PR159。远端Codex额度限制仍为未执行；只在新head适用原生CI与独立增量审查完成后合并，main快进、分支清理和最终运行状态以交付原生回执为准，不提前计PASS。


## CI04：关闭关系搜索预算回归

c77ddd280304ad6e186b2cc34722b178ab7a0d10 的主CI run42297546042在PC浏览器入口失败：Card28筛选子组为空、Card27B/B5/overlap及advanced搜索超时，原FAIL/NOT_RUN及下载artifact保留。独立Spec/后端审查先定位同一search HTTP503，而非日期错位；完整PG容器日志在6219/6417/6613/6809/7009等行实际记录 WITH cards AS MATERIALIZED 的 statement timeout。

原2秒预算未放宽。Root受控UTC进程下的相同两类HTTP查询都200；本地PG18 jit=on但pg_jit_available=false，计划估算约135万、jit-off实际执行4–6ms。由此将LLVM规划编译开销列为首要机制，实际Linux JIT数据不预报；诊断原件search-plan-evidence.json / search-plan-02.log / search-plan-N.json。新搜索关系的扩展来自本卡关闭记录/已关闭Intake，属于本卡回归，继续修补，不改名规避旧搜索底线。

最小生产改动仅在workbench-search原prepare/final两个只读事务增加SET LOCAL jit=off；原statement_timeout=2000ms、限流、源/范围过滤、排序/游标与最后同快照READ不动，没有UI、日期helper、状态或权限变化，没有持久Feature Flag或依赖。原来的所有浏览器断言保留。

新增正确PG seam位于已注册的 t41-search-pagination-authority.integration.test.mts：保留原3分页/不可见用例，借用真实Tx连接时启用session JIT并压低阈值，使用原seedCard28Board，两类真实HTTP分别校验dismissed/closed/rangeall精确IDs和pending/unassigned精确IDs、分页终止及安全字段。JIT provider和两轮GUC/2秒预算仅白名单观测；会话设置在COMMIT/ROLLBACK后恢复，无LLVM本机不伪造旧路径RED或假定旧查询必须慢。原CI超时为真实RED，后继运行另记。

辅助探针search-plan-01因Pool.connect观察器未保留callback签名挂起；只终止核验过命令行的自有Node44264。其一个新合成UUID诊断库作为失败取证保留，未手工DROP；修正为Pool acquire观察后的search-plan-02成功，正常fixture库已由原helper回收。当前PG仅自有loopback，结束时停止并如实列出保留取证库，不把旧三库清单改绑为当前清理。

该回归没有修改已有业务断言期望；对应U3/U7关闭数据仍须在原查询预算和当前READ下可用，旧超时与安全底线保留。当前新增2个授权路径（后端搜索、后端测试），总99路径。现有98/100/556原候选回执保留；CI04构建/相关回归及LinuxCI随后按实际结果收口。

CI04增量独立复审确认生产GUC仅限原2个只读Tx，无权限/排序/游标/2000ms/锁序变化。新测试首次读取连接baseline设置失败时补充release分支，避免异常租借泄漏；原3用例和新增两查询业务断言不变。build-ci04-01的928语法PASS保留为小修前候选，后继构建另记，不改绑。

### CI04本地后继：真实失败、U7夹具重建与当前限制

CI04-02构建与types均PASS，manifest为dc1728cbbb58175f3df76b9de10be3667f6742e7ca289c7c6e1641240077c6fa。ci04-jit-01在已注册authority入口4/4 PASS；两类真实HTTP均返回精确ID，四个prepare/final阶段实际为jit=off、READ ONLY、原2000ms，事务结束后的局部设置恢复；四次provider可用性均为false，不代表测得LLVM编译耗时。ci04-scope-01另有末次唯一团队READ撤销与有界只读POST合同2/2 PASS。

ci04-read-01保留3 PASS/1 FAIL：logout、physical-expiry及Journey留存到期拒绝均通过，旧canonical-membership夹具直接种IGNORED而没有071关闭记录，详情正确拒绝503；其后的两个入口原NOT_RUN保留，随后才在ci04-scope-01执行。按U7仅重建这一个合成夹具：从WAITING_DESCRIPTION前状态开始，复用既有appendIntakeClosureEvent与insertClosureRecord产生当前关闭事实；原输入文案、用例名、状态/分页/权限/组计数业务断言全部保留，未放宽currentClosure或投影503。source-preservation比较证明除该准备段和import外旧正文一致。本修补新增一个授权后端测试路径tests/t41-search-current-read.integration.test.mts，当前总100路径；没有生产UI、样式、依赖或超时变更。

build-ci04-03与types-ci04-03均PASS：928/928语法、strict/negative types、CSS/design variables/feature语法及PC/H5类型通过。候选仍为c77ddd280304ad6e186b2cc34722b178ab7a0d10加工作区，manifest=9d963880d8b1372963cc1634aeeb19af714b04c8360169d443c06629944b732b，input_hash=dfafc22c4c8d5caf8ab94baf6f8824638064022c82d8d6aa185305f913aa91d0。与CI04-02逐字节比较仅current-read测试mjs/map变化，生产输出变化0；旧PASS/FAIL不改绑本候选。

最终ci04-final-01在同一编译候选完成current-read 4/4、final-scope 1/1、read POST 1/1及authority/JIT 4/4，共四个完整后端入口10/10 PASS。PC完整入口两次均达到原文件级240000ms截止：ci04-pc-01有15个case完成PASS，最终批次PC有10个case完成PASS，均未观察到截止前业务断言FAIL；两次入口均为真实TIMEOUT/FAIL。当前实际库存是18个case，16只是静态literal名称数，另有pointer/keyboard两例，不能以16为验收分母。最终PC尚有8例未完成或未到达；原CI相关的Card28、Card27B、B5、pending-overlap与advanced-search在最终部分运行中已分别通过，但不等于完整Windows入口PASS。按本次边界仅重跑一次，不加第三轮、不抬预算；最终summary的10/10只统计四个完整后端入口，整体SELECTED_TESTS_FAIL保持。

原始TAP、case trace、截图、阶段耗时与summary继续保存在对应目录；ci04-02-03-comparison及ci04-final-01-jit-observation-audit分别记录制品差异与四阶段GUC实值。当前自有loopback PG仍运行；一个旧诊断库和两个PC超时库作为失败取证保留，没有手工DROP，完整状态在本地交接原件列出。新head Linux/LLVM CI尚未执行，完整Windows18入口仍未通过；远端Codex额度不足仍为NOT_EXECUTED。full/certify、Electron、真实发送、现场写库、部署和Gate未运行或批准；后续Git/CI、合并与清理由Root沿既有授权收口，不提前标完成。

### CI05：原窄屏指针入口的布局前提

CI04已发布为dc0629e9d31e91992e1793a19df931d54a3d1d39，输入哈希与上述候选一致；发布后独立五文件审查0剩余问题。Linux run42316071840仍FAIL，但PC入口已有17/18通过，原关闭分组/B5/overlap/advanced-search均通过。唯一剩余失败为Card28首例compiled第295行：窄宽横向滚动后等待原领取按钮出现超时。目录回归与证据检查均PASS；原日志/制品存于ci04-remote-artifact，不改写为通过。

只读核对排除首个ticket被新关闭夹具替换：seedCard28Board仍创建四个未领取QUEUED工单，pending排在active/closed之前，同例较早的宽屏领取检查已通过。窄宽段在resize/scroll之后立即采坐标并mouseMoved，命中断言却在领取等待之后；退出搜索也只等URL。当前制品没有该例专用metrics，不能确定失败宽度或断言具体时序根因。

本次只补齐原测试交互前提：退出搜索后等待既有settle/ready；指针先真实移出，再等待与clickWorkbenchControl一致的两帧几何稳定及原row-link命中，重读坐标后真实hover/click。新增安全的宽度/坐标/合成ID观测。保留所有原选择器、按钮可见/命中/详情ID/无写入断言与原预算；不改UI、权限或业务期望。当前仍100路径，验证及新head CI结果按后续原件记录。

CI05本地复验：build-ci05-01语法928/928、types-ci05-01、docs-ci05-01、verify-ci05-01均PASS；manifest=a82ebd3f3488b93e853ee75bb1397e93b9abd0f1f9adef666b6b79e2e2f8fda8，input_hash=b3c3ab77f5002a2bf65952f044bcfc216c93ca404235f98371d7745519715467。原PC完整入口ci05-pc-01在Windows原240000ms文件预算内完成18/18 PASS，0 FAIL/SKIP/取消，TAP duration_ms=145808.2547；两个窄宽均通过原领取、命中和详情检查。独立ci05-review对两文件增量0finding。本轮未改变业务期望，旧Linux FAIL与两次Windows TIMEOUT仍保留；本次通过不补写旧候选结论。发布后仍以新完整SHA的适用Linux CI决定合并。
