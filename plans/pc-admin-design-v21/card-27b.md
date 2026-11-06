# 卡27B：第三列分组与展示

日期：2026-11-06（Asia/Shanghai）。本地验证通过（含B5日期组合扩展；S1–S4写入侧边界不变，原停止结论保留历史含义），未提交、推送或创建PR。

## 输入与边界

基线为 `4a279a2a42c8eec84a97c6191f2d18da4836df30`，已通过GitHub核对卡26 PR #153合并点 `fac614923fe16c918587ba5e2c82eaa1e5adbe4f`、27A PR #154合并点为本基线；HTTPS fetch后本地main与origin/main相等。分支 `codex/pc-admin-v217-card27b`。

用户原件 `docs/ui/prototype/医小修 PC 管理端 v2.2 设计原型.html` 初始未跟踪，用户随后明确要求纳入本卡交付；初始 SHA-256 为 `fd6c25ff3fd66dc2ac333b05ef6dd1c439b798d85184770065d01f1532c1df37`，保持原字节。提交仍需用户另行授权。

按AGENTS读取开发、验证、会话运行、领域与API入口、设计规范、ADR-0026/0053/0055及27A执行记录。用户补充允许 `app/WorkbenchDetail.tsx` 与 `features/manual-review/ReviewWorkspace.tsx` 的最小展示改动，提交逻辑、权限与原选择器保持。

用户另行批准 `design/tokens.css` 增加一项Token：`--shadow-dismissed` 为原型01b的1px / 6%描边。其余尺寸、字号、颜色沿现有Token。原型01b已在Windows系统Chrome实际打开、截图核对；其中通用关闭原因、重复原单和恢复只是后续设计，仍受下列停止项约束。

| 27A停止项 | 核对结果与本卡边界 |
| --- | --- |
| S1 | 统一业务关闭原因停止待确认；取消只有自由文本。本卡展示已有原因，取消表单保持，记录等待27C。 |
| S2 | 已有待判断范围外复核和固定原因；通用关闭入口仍停止，不把CANCEL_REVIEW当作关闭。 |
| S3 | DISMISSED没有现成恢复命令，can_restore=false；跳过恢复按钮及其截图，不借用完成工单reopen。 |
| S4 | 来源可由可信事件证明，否则null；部分系统分类缺实际关闭时间，继续未知。无事实补写。 |

Root负责Workbench、BoardColumn、board-presentation、规范、执行记录、单一构建/测试窗口；cancelled_contract仅模式枚举/守卫、client、日期/摘要组件与对应web01/t41测试；dismissed_card仅TicketCard组件；browser_coverage仅既有Card12浏览器入口及fixture。文件不重叠；代理明确STOP后Root整合。无依赖、迁移、业务命令或权限变更。

## 风险与验证计划

风险为关闭类误计完成、服务端分组总量与已加载数量混淆、折叠后分页/偏好丢失、已关闭区域误触发拖放，以及日期/模式与严格客户端合同不一致。沿ADR-0053用实际改动路径选择现有检查，并在原foundation/web01/t41/Card12入口补直接正负断言，不新增平行认证器。Root统一构建一次，随后types、相关选择、契约、制品和文档检查；发现新缺陷才修补重建。只使用自有loopback合成PG与既有fixture/helper，虚构内容带「（合成）」。

截图写入 `docs/ui/evidence/v217-card27b/`，Windows主视口1440/1920、DPR1、缩放1；三种卡片局部按2倍采集。执行完成后逐项填写B1–B6、文件、实际测试数量、限制与六项自检，未运行项不预填PASS。

## 编号清单

- B1 已完成：三列保持；已处理分为COMPLETED / DISMISSED，普通看板列头为完整group_counts之和，搜索或本地筛选明确已加载范围；各组独立显示剩余项，按账号及分组保存会话级折叠偏好，默认完成展开、关闭折叠。两个分组使用同一日期查询；cancelled模式从前端、枚举和输入守卫删除，旧值400，CANCELLED业务状态保持。
- B2 已完成：已关闭卡片采用bg-subtle / 1px6%描边、去色分类、二级标题、原因与来源展示；抽屉只读呈现六项关闭记录。未知来源、时间或原单不猜测；恢复与悬停恢复截图按S3跳过。
- B3 已完成：今日完成只认closure.kind=COMPLETED、上海同日且非未来的completed_at；新增重复、取消、系统不受理同日值的负向断言。RESOLVED仍在完成分组，但没有completed_at时不计今日完成。
- B4 已完成：已关闭不是droppable；完成放置区仅包已完成组。为排除拖卡矩形与完成区交叠时的默认回退，使用现有DND monitor，在指针进入关闭分组时清空本次碰撞集合。真实鼠标覆盖关闭标题区域，核对无新读取、命令或抽屉；原有合法拖放/表单另沿既有入口复验。
- B5.1 已完成：列表增加结束方式FilterChip，调用既有closure_kind，切换保留recent/all与其它条件并清游标；已关闭行二级色、原因列不超过160px，原因全文保留title。第一、二列沿27A合同保持。
- B5.2 停止待确认：搜索合同只支持recent/all；今天、近7天、本月和手填日期都属于custom，无法组合结束方式。当前禁用该Chip并给出说明，不扩大后端合同，不用已加载分页冒充完整查询。后续需单独决定日期参数及游标合同。
- B6 已完成：已有范围外复核的八个原因用单选列表呈现，保留原码、原选择器、草稿和提交控制器；取消工单只有自由文本，已确认无需本卡修改，等待27C统一原因。真实合成提交另核原payload、UUID、If-Match、幂等头、原判定与无新增Ticket。

## 历史失败及候选分账

所有本轮原件集中在 `D:/CodexEvidence/pc-admin-v217-card27b-20261106/`，不修改旧卡26/27A的Evidence或tested_head。

- build-01：FAIL，两处新增表格className显式undefined不满足exactOptionalPropertyTypes；改为空字符串。
- build-02：PASS；只读交叉核对发现抽屉导航未按完成/关闭分组，以及默认列表选结束方式会从recent扩大到all，Root在业务验证前修正并补断言。
- build-03：PASS；types-03在变量检查拒绝不存在的fw-normal，改为现有fw-regular。
- build-04：PASS；types-04进程遇到Windows内存分配错误；串行types-05对同候选PASS。原型Edge启动两次超时且均清理为0；内置浏览器连接不可用。系统Chrome成功渲染原型01b，主视口1440×840、DPR1/zoom1，资源关闭为0。docs-01也保留原内存分配失败。
- tests-01：5/61入口执行，120 PASS / 2 FAIL，56入口NOT_RUN。一项为新增采样字符串两处map(...)()错误；另一项为旧Card20清除筛选后已超时选中断言false。旧Card20原样单场景复跑1/1 PASS，不据此宣称根因或稳定性。源码证明Router可先改URL后提交视图，因此只补当前日期真实响应的就绪前提；原业务断言和时限保持。
- build-05：PASS；新增Card27B综合场景与固定原因场景分别1/1 PASS，前者9张截图均已采集，已目视核对人工卡片、列表和抽屉。诊断子集不冒充全部入口通过。
- build-06：仅补新用例跨reload/导航的新文档等待；PASS，输入 `8844ccf054df413ceb2419f9d392b3d4029d319eeaa71a8c7f88f5a85a79a31b`。types-06 PASS，含Stylelint、ESLint、变量、strict和负向类型。
- tests-02：同build-06候选前4入口108项PASS；随后原隔离PG出现Windows1455、backend异常0xC000012D、共享内存重附着失败和恢复，浏览器入口14项FAIL，56入口NOT_RUN。失败不改名为通过。
- tests-03：同候选继续失败入口，驱动及PG随后退出，没有summary.json；逐例JSONL仅证明实际到达的PASS/FAIL，不推算整批完成。原数据目录 `D:/CodexData/pc-admin-v217-card27b-pg` 保留为停止的故障现场。
- 最终验证在新的自有loopback PG18实例进行，端口55489，shared_buffers=32MB、max_connections=32、maintenance_work_mem=32MB，初始仅postgres/template0/template1；测试驱动父进程用384MB堆上限。原宿主、测试flags、时限与业务断言保持，没有更改项目依赖或生产配置。后续实际结果在收口段填写。

## 规范及兼容边界

设计规范增加第三列分组、已关闭卡片、关闭记录、单选原因呈现、统计和列表限制；ADR-0055追加27B前向说明，保留27A历史核对；API文档同步删除旧范围值。没有新ADR、领域词汇、写命令、状态、权限、迁移、依赖或持久开关。

`shared/workbench-search-contracts.mts`只删除同一range枚举值，属于B1契约解析例外；后端只改web01-workbench-query两处模式移除。workbench-search.mts旧SQL分支按白名单保持，输入守卫移除后不可达。ProcessedDatePicker原清除按钮aria-label作为已有定位保留，用户可见的取消模式入口删除。

## 限制与回退

本卡是Windows Chrome与loopback合成验证，不等于Electron、现场业务、用户接受、生产容量或部署批准。完整原因、重复关联、恢复和B5.2日期组合未实现；H5统计、月报及现有命令语义保持。CI、full/certify、真实发送、现场业务写库、部署及业务Gate均NOT_RUN。

回退本卡文件清单的差异即可恢复原展示；取消范围的后端、契约与客户端需一起回退。没有数据库迁移或持久开关回退。用户原型原件、未提交工作树、全部FAIL/NOT_RUN与异常PG现场保持，最终资源状态另记。

## 最终本地验证与交付

最终输入仍为build-06的未提交源码，manifest为 `e85f8b45580e9226ea5dec4cc68c231424ba611dc457bee9717620920967d830`。停止异常实例后，新PG以32MB共享缓存串行执行，原测试宿主、flags、240秒入口上限、断言和退出清理保持。仅外层测试驱动用384MB堆上限，没有修改业务或测试源码来规避资源失败。

| 检查 | 实际结果与原件 |
| --- | --- |
| migration:build | PASS，build-06.log：922模块、2,944制品，STAGED_NOT_ACTIVATED；保留既有chunk体积提示。 |
| gate.mjs types | PASS，types-06.log：strict、负向类型、PC/H5/Desktop类型；Stylelint 0，既有功能区ESLint按max-warnings=0通过，未定义/原始Token泄漏均0。api/client.ts等不在既有ESLint功能区范围，由strict与解码/正式浏览器验证，不冒称额外lint。 |
| 相关与路径回归 | 同一manifest去重61入口、444/444 PASS，FAIL/CANCEL/SKIP/TODO均0，最终NOT_RUN空。final-tests.json逐文件绑定source/executed SHA；不是一次整批通过。 |
| 直接风险 | 基础76、搜索/解码合同7、web01单元8、真实PG集成17、Card12浏览器14、人工复核浏览器6均PASS；今日完成三类关闭负例、拖放0请求、分组导航和原命令均保留严格断言。 |
| 契约 | t41闭合Schema正负例与实际HTTP通过；contract-syntax.json核JSON Schema / OpenAPI 3.1.0，board recent/all/custom、search recent/all，均不含cancelled。 |
| 制品 | artifact-final.log PASS：ARTIFACT_VERIFIED_NOT_ACTIVATED，manifest与两批回归相同。 |
| 文档 | docs-final.log预算/本地链接PASS，docs-tool-final.log 20/20 PASS；记录收口后另作链接终核。 |
| 视觉与数值 | 当前9图来自tests-04同候选，Windows Chrome，主1440/1920×1060、DPR1/zoom1，局部DPR2/zoom1；尺寸/hash逐图核验。关闭图标另复用同一fixture只读测量为12×12px（extra-metrics.json），该补测解决原采样缺图标几何的具体缺口，测一次即停止。 |
| 设计检测 | impeccable-detect.json为[]，退出0。没有以检测替代真实浏览器。 |
| 范围 | scope-audit.json：45路径、白名单外0；backend精确等于两处模式删除，shared精确等于单个枚举值删除；依赖/迁移差异0，修改UI文件原data属性缺失0。原型SHA保持。 |

最终回归分账：tests-04先完成58入口419项；第59个H5静态入口14项在清理守卫因临时目录的D:/与Windows原生D:\表示不同而FAIL，后两入口NOT_RUN。原失败保留。将TEMP/TMP/TMPDIR改成同一物理目录的原生反斜杠表示，原H5测试不改，tests-05补跑3入口25/25 PASS。两批manifest完全相同；61/444为去重后的成功覆盖，不重复累计失败或诊断子集。

截图及实测见[九图索引](../../docs/ui/evidence/v217-card27b/README.md)。普通看板4完成/5关闭、总9；今天范围4/3、总7，今日完成3。组标题12px/500、关闭标题14px/500、灰度1/透明度.55、1px/.06描边、CircleX 12×12px；原因列最大92px。组内剩余项1/2；关闭区真实拖动请求0、抽屉0，纯展示业务POST0、数据库状态/版本/责任/事件保持；固定原因场景的一次原合法命令另行验证。

### 六项自检

| 自检 | 是 / 否与证据 |
| --- | --- |
| 只改本卡允许文件；27B只在移除cancelled时改后端与契约 | 是。scope-audit.json白名单外0；后端两处精确替换及shared单枚举移除已对HEAD重算比较。WorkbenchDetail/ReviewWorkspace/Token为本次用户明确补充授权；文档、测试、fixture和用户原型为交付范围。 |
| 没有新增/修改业务命令、状态值、权限、迁移或依赖 | 是。写入模块、权限代码、迁移、包文件无差异；真实合成命令只在既有fixture内验证原输入/事件。持久开关默认不变。 |
| 27A默认新响应，解析同批且无新增兼容开关 | 是（核对已合并前置）。当前真实HTTP、严格解码和正式PC无INVALID_RESPONSE；本卡只移除范围值，不新增响应协商或持久开关。 |
| S1–S4触发时停止相应部分，没有自行实现写入侧 | 是。S1统一原因和原单、S3恢复不实现；S2仅改既有复核原因呈现，S4未知来源/时间仍未知。取消自由文本保持，CANCEL_REVIEW不变成关闭。 |
| 测试选择器与有效业务断言只增不减 | 是。旧data属性静态缺失0，所有原命令/权限/UUID断言通过；新增闭合分组、拖放、计数、筛选、原原因提交断言。B3旧审计期望随明确新口径改为关闭负例；旧Card20仅补日期请求就绪，原选中和零写入断言/时限保持。 |
| 带数值的验收项都有实测值 | 是。metrics.json、extra-metrics.json、receipt.json及76/14/6等原始报告对应字号/字重、12px图标、1px/6%、92≤160px、4+5/4+3、1/2剩余项与DPR/zoom。没有把小合成库数据当生产容量。 |

### 资源状态

resource-final.json确认新实例结束前仅postgres/template0/template1、其它客户端0；新旧pg_ctl status均3，55488/55489监听0。150份原关闭回执的cleanup_active_processes均0。tests-03中断的一份作业没有原closed.json，没有伪造：incomplete-job-observation.json按原创建时间复核160个记录成员，存活0，原owner不存在，当前任务进程0。

保留两份已停PG目录、任务临时目录、当前.build、源码及全部FAIL/NOT_RUN、缺失关闭回执原件和含重解析点的测试夹具。没有递归删除、清理其它任务资源或修改用户原型；保留位置在resource-final.json列明。当前无本任务运行中的PG、HTTP或浏览器。未提交、未推送、未创建PR；没有CI、full/certify、Electron、现场、真实发送、部署或Gate结果。

## 文件清单（45路径）

- `adr/0055_workbench_closure_kind_projection.md`
- `app/pc-admin/src/api/client.ts`
- `app/pc-admin/src/app/ProcessedDatePicker.tsx`
- `app/pc-admin/src/app/Workbench.tsx`
- `app/pc-admin/src/app/WorkbenchDetail.tsx`
- `app/pc-admin/src/design/board-presentation.ts`
- `app/pc-admin/src/design/components/BoardColumn/BoardColumn.tsx`
- `app/pc-admin/src/design/components/BoardColumn/board-column.css`
- `app/pc-admin/src/design/components/BoardColumn/workbench-board.css`
- `app/pc-admin/src/design/components/BoardSummary/BoardSummary.tsx`
- `app/pc-admin/src/design/components/TicketCard/TicketCard.tsx`
- `app/pc-admin/src/design/components/TicketCard/ticket-card.css`
- `app/pc-admin/src/design/tokens.css`
- `app/pc-admin/src/features/manual-review/ReviewWorkspace.tsx`
- `app/server/src/web01-workbench-query.mts`
- `contracts/conversation_center.openapi.yaml`
- `contracts/web01_workbench_board.schema.json`
- `contracts/web01_workbench_contracts.d.ts`
- `contracts/workbench_search_criteria.schema.json`
- `contracts/workbench_search_page.schema.json`
- `docs/api/workbench/board.md`
- `docs/api/workbench/search-source-forward.md`
- `docs/ui/design-system.md`
- `docs/ui/evidence/v217-card27b/README.md`
- `docs/ui/evidence/v217-card27b/board-1440-dismissed-expanded.png`
- `docs/ui/evidence/v217-card27b/board-1440-dismissed-folded.png`
- `docs/ui/evidence/v217-card27b/board-1920-dismissed-expanded.png`
- `docs/ui/evidence/v217-card27b/board-1920-dismissed-folded.png`
- `docs/ui/evidence/v217-card27b/dismissed-duplicate-x2.png`
- `docs/ui/evidence/v217-card27b/dismissed-manual-x2.png`
- `docs/ui/evidence/v217-card27b/dismissed-system-x2.png`
- `docs/ui/evidence/v217-card27b/drawer-closure-record.png`
- `docs/ui/evidence/v217-card27b/extra-metrics.json`
- `docs/ui/evidence/v217-card27b/list-dismissed.png`
- `docs/ui/evidence/v217-card27b/metrics.json`
- `docs/ui/evidence/v217-card27b/receipt.json`
- `docs/ui/prototype/医小修 PC 管理端 v2.2 设计原型.html`
- `plans/pc-admin-design-v21/card-27b.md`
- `shared/workbench-search-contracts.mts`
- `tests/helpers/web01-workbench-fixture.mjs`
- `tests/pc-admin-card12.browser.test.mts`
- `tests/pc-admin-design-foundation.test.mts`
- `tests/t41-search-contract.test.mts`
- `tests/wbint-t14-review.browser.test.mts`
- `tests/web01-workbench.integration.test.mjs`

## B5日期组合扩展后继（2026-11-06）

用户在首轮交付后明确授权扩展今天、近7天、本月、自定义与结束方式组合，同时完善后端、合同和接口文档并联合前端测试。这覆盖本记录首轮B5.2的冻结边界，不扩大S1–S4写入侧、发送、部署或Gate范围；仍不提交、推送或创建PR。旧45路径/61入口444项、e85f8b…manifest及旧9张截图保留原候选身份，不补新输入。

合同先行：搜索range支持recent/all/custom；custom必须closed_from/closed_to，非custom拒绝日期字段；真实日历、有序日期、止日<9999-12-31；按上海自然日半开窗口计算。旧recent/all不增加criteria键，custom日期和结束方式参与原criteria哈希及from/until游标绑定。查询只读、当前READ、2000ms SQL预算、限流20/60秒及业务命令保持。

单写者：Root只改workbench-search后端、规范/ADR/API文档、执行记录，并唯一构建/运行；b5_contract_dates只改搜索DTS、两Schema、OpenAPI、shared、client及t41合同测试；b5_front_dates只改Workbench/SearchControls及Card12浏览器；b5_http_tests只追加HTTP-first集成测试。均在原分支明确非重叠路径写入，STOP后Root整合；没有安装依赖。

风险为日期边界及真日历、GET/POST形状、cursor串用、日期筛选在LIMIT之前及READ保持，以及前端切日期/结束方式清游标且保留草稿和其它条件。扩展已有合同/HTTP/分页权限入口及真实浏览器矩阵，采集四种日期在1440/1920下的组合截图；只复用既有fixture写法。相关覆盖通过即停止，不运行full/certify。后继原始报告统一到D:/CodexEvidence/pc-admin-v217-card27b-b5-20261106，截图使用evidence/v217-card27b/b5-extended子目录，不覆盖旧证据。

当前实现：后端在原窗口语句的custom分支使用两个日期参数计算含结束日的窗口，SQL往返数不增加；删除此前不可达cancelled SQL分支。前端日期条在搜索态保持可用，结束方式不再禁用custom；退出搜索保留有效日期对。最终构建、同候选联合测试、查询计划、截图、状态和资源回执待实际完成后追加，不预填PASS。


### B5后继最终结果

B5.2日期组合限制已在本后继解除：今天／近7天／本月／自定义均可与全部／已完成／已关闭组合；近两天／全部日期保持。切日期、结束方式、提交q、reload、切看板/列表、结束搜索及清日期都经真实前后端场景验证。S1–S4写入侧、统一业务原因、原单关联与DISMISSED恢复仍不在本次范围。

最终输入 `fdfc17a5e63a7b4e088cce2728de0258d5d49ac93b26276c97c3e7c4dce9ff63`，manifest `9ddfb37d546a17bf194faee8ce8977abe66a2a09f34671fd7bea988a43988448`。以下仅绑定本后继，不与原444项或先前诊断累计。

| 检查 | 本后继结果与原件（D:/CodexEvidence/pc-admin-v217-card27b-b5-20261106） |
| --- | --- |
| migration:build | build-04.log PASS，922模块、2,944制品、STAGED_NOT_ACTIVATED，保留原chunk体积提示。 |
| gate.mjs types | types-04.log PASS：strict、负向类型及各应用类型；Stylelint 0、既有功能区ESLint 0 errors/warnings，Token未定义/原始值泄漏0。 |
| 同候选联合回归 | tests-02/summary.json：65/65入口、459/459 PASS，FAIL/CANCEL/SKIP/TODO均0，NOT_RUN空，同一批完成。包含合同11、真实HTTP/PG2、Card12浏览器15及搜索分页/当前READ/最终scope等原入口。 |
| 日期矩阵与截图 | 四日期×三结束方式12组精确成员/半开窗通过；8张Windows Chrome整页图（1440/1920、DPR1/zoom1），真实19次搜索≤20，业务POST0，状态/版本/责任/事件保持。草稿、提交、reload与展示切换保留，结束搜索留有效custom日期，清日期不留两键。 |
| 契约 | 新旧请求形状、真日历/闰日/顺序/上界、非custom多余参数、GET/POST等价、错窗客户端拒绝、改from/to/kind/range拒绝旧cursor、READ隐藏项均通过。contract-syntax.json核JSON Schema/OpenAPI 3.1.0及/api服务器前缀，首次观测脚本把完整API路径当OpenAPI路径产生KeyError，校正观测路径后通过，没有改合同规避。 |
| SQL与计划 | query-observation.json：limit1/50实返1/3卡，总SQL19/23（含既有按卡公开投影），其中日期窗口语句均1次；没有新增日期往返。search-custom.sql及search-custom-plan.json保存真实原语句/计划：Limit，3行，planning15.537ms、execution10.279ms，局部2000ms预算不变。仅本地小合成库，无生产容量结论。 |
| 文档与设计 | docs-final.log预算/本地链接PASS，docs-tool-final.log 20/20 PASS，impeccable-detect.json为[]；收口记录另作链接和制品终核。 |
| 范围保护 | scope-audit.json：61项本卡累计文件，白名单外0，最终READ证明、游标编解码/会话绑定及两处2000ms设置与HEAD原文相同；旧9图与用户原型未改。未变更命令、状态、权限、迁移、依赖或持久开关。 |

后继失败分账：build-01因新合同测试二维数组缺一个结束括号FAIL，Root补字符后预检全部改动TS语法；build-02/types-02通过。tests-01先完成合同/HTTP，浏览器入口13 PASS/2 FAIL：新场景Chrome启动超时尚未进页面，旧高级搜索等待隐藏日期条与新要求相冲突。原日志/NOT_RUN保留。

原样新场景诊断进入页面后，今天三种结果已通过；切周时未等日期请求完成就切kind，触发原App同时一次搜索的429。仅给测试加真实响应/成员就绪前提，保留20/60秒、时限和全部业务断言。build-03后12组合/8图通过，草稿提交因合成Enter信号未产生请求而停；改用原真实可点提交按钮。旧高级搜索布局更新为保留日期条后还会在请求未到达前断言reads，因此追加真实成功响应就绪，原查询参数/可点/POST0断言保持。build-04后两个诊断场景2/2通过；再按当前完整输入统一执行65/459，不把诊断结果加总或宣称启动超时已根治。

[本后继8图与实测](../../docs/ui/evidence/v217-card27b/b5-extended/README.md)独立于首轮九图。前端只组合原日期控件和FilterChip，没有新增CSS/Token；API文档与endpoint-index同步，ADR-0055追加后继覆盖原B5停止项，旧固定候选/FAIL/NOT_RUN保留。

六项自检后继结论：

| 自检 | 是 / 否与证据 |
| --- | --- |
| 仅在本卡与追加授权范围修改 | 是。本次用户明确允许B5后端/合同/API扩展；新增workbench-search、搜索DTS、SearchControls、HTTP-first及endpoint-index为必要配套。scope-audit白名单外0。 |
| 命令、业务状态、权限、迁移和依赖保持 | 是。路径审计与最终READ/游标绑定原文比较通过；真实读POST/GET业务事实守恒，未新增Flag或开启生产配置。 |
| 27A默认新响应与解析层同候选可用，无兼容开关 | 是。旧recent/all规范对象不增两日期键，custom三层合同/后端/client同步；正式PC和严格解码通过。 |
| S1–S4写入停止线保持 | 是。只解除本次明确授权的B5日期组合，不实现原因/关联/恢复命令或补写未知事实。 |
| 原选择器和有效业务断言保持 | 是。布局前提随日期条新要求改为存在；原查询/可点/权限/UUID/零写入断言保留，额外等待真实响应，不改时限或skip。 |
| 数值均有实测 | 是。12组合/8图/19请求、两宽度DPR/zoom、1窗口SQL、19/23总SQL、10.279ms本地计划及65/459原始回执均可核对，不作生产容量结论。 |

资源：本轮132份Job关闭回执均cleanup_active_processes=0，缺失0、损坏0。resource-final.json及PG原日志确认结束前仅postgres/template0/template1、其它客户端0，停止后pg_ctl status3、55489监听0、任务进程0。数据、临时目录与失败截图保留，没有递归删除或触碰其它任务资源；前一阶段缺失原关闭回执和故障PG现场继续原样保留。

仍未提交、推送、创建PR；CI/full/certify/Electron/真实发送/现场业务写库/部署/Gate均NOT_RUN。

### 本卡累计文件清单（含B5后继，61路径）

- `adr/0055_workbench_closure_kind_projection.md`
- `app/pc-admin/src/api/client.ts`
- `app/pc-admin/src/app/ProcessedDatePicker.tsx`
- `app/pc-admin/src/app/Workbench.tsx`
- `app/pc-admin/src/app/WorkbenchDetail.tsx`
- `app/pc-admin/src/design/board-presentation.ts`
- `app/pc-admin/src/design/components/BoardColumn/BoardColumn.tsx`
- `app/pc-admin/src/design/components/BoardColumn/board-column.css`
- `app/pc-admin/src/design/components/BoardColumn/workbench-board.css`
- `app/pc-admin/src/design/components/BoardSummary/BoardSummary.tsx`
- `app/pc-admin/src/design/components/TicketCard/TicketCard.tsx`
- `app/pc-admin/src/design/components/TicketCard/ticket-card.css`
- `app/pc-admin/src/design/tokens.css`
- `app/pc-admin/src/features/manual-review/ReviewWorkspace.tsx`
- `app/pc-admin/src/features/search/WorkbenchSearch.tsx`
- `app/server/src/web01-workbench-query.mts`
- `app/server/src/workbench-search.mts`
- `contracts/conversation_center.openapi.yaml`
- `contracts/web01_workbench_board.schema.json`
- `contracts/web01_workbench_contracts.d.ts`
- `contracts/workbench_search_contracts.d.ts`
- `contracts/workbench_search_criteria.schema.json`
- `contracts/workbench_search_page.schema.json`
- `docs/api/endpoint-index.md`
- `docs/api/workbench/board.md`
- `docs/api/workbench/search-source-forward.md`
- `docs/ui/design-system.md`
- `docs/ui/evidence/v217-card27b/README.md`
- `docs/ui/evidence/v217-card27b/b5-extended/README.md`
- `docs/ui/evidence/v217-card27b/b5-extended/list-custom-dismissed-1440.png`
- `docs/ui/evidence/v217-card27b/b5-extended/list-custom-dismissed-1920.png`
- `docs/ui/evidence/v217-card27b/b5-extended/list-month-dismissed-1440.png`
- `docs/ui/evidence/v217-card27b/b5-extended/list-month-dismissed-1920.png`
- `docs/ui/evidence/v217-card27b/b5-extended/list-today-dismissed-1440.png`
- `docs/ui/evidence/v217-card27b/b5-extended/list-today-dismissed-1920.png`
- `docs/ui/evidence/v217-card27b/b5-extended/list-week-dismissed-1440.png`
- `docs/ui/evidence/v217-card27b/b5-extended/list-week-dismissed-1920.png`
- `docs/ui/evidence/v217-card27b/b5-extended/metrics.json`
- `docs/ui/evidence/v217-card27b/b5-extended/receipt.json`
- `docs/ui/evidence/v217-card27b/board-1440-dismissed-expanded.png`
- `docs/ui/evidence/v217-card27b/board-1440-dismissed-folded.png`
- `docs/ui/evidence/v217-card27b/board-1920-dismissed-expanded.png`
- `docs/ui/evidence/v217-card27b/board-1920-dismissed-folded.png`
- `docs/ui/evidence/v217-card27b/dismissed-duplicate-x2.png`
- `docs/ui/evidence/v217-card27b/dismissed-manual-x2.png`
- `docs/ui/evidence/v217-card27b/dismissed-system-x2.png`
- `docs/ui/evidence/v217-card27b/drawer-closure-record.png`
- `docs/ui/evidence/v217-card27b/extra-metrics.json`
- `docs/ui/evidence/v217-card27b/list-dismissed.png`
- `docs/ui/evidence/v217-card27b/metrics.json`
- `docs/ui/evidence/v217-card27b/receipt.json`
- `docs/ui/prototype/医小修 PC 管理端 v2.2 设计原型.html`
- `plans/pc-admin-design-v21/card-27b.md`
- `shared/workbench-search-contracts.mts`
- `tests/helpers/web01-workbench-fixture.mjs`
- `tests/pc-admin-card12.browser.test.mts`
- `tests/pc-admin-design-foundation.test.mts`
- `tests/t41-search-contract.test.mts`
- `tests/wbint-t14-review.browser.test.mts`
- `tests/wbint-t41-search-http-first.integration.test.mts`
- `tests/web01-workbench.integration.test.mjs`

## 2026-11-06 独立审查与修复（Card 27B + B5 全量 WIP）

用户追加要求：使用 code-review 与 open-code-review-delegate，多个独立子代理审查全部改动，修复后重新验证，保留原失败，不提交、推送或创建 PR。本节为后继审查记录，不重绑前两阶段的输入、制品、测试结果或失败。

基点为经 GitHub PR #154 合并身份核实的 `4a279a2a42c8eec84a97c6191f2d18da4836df30`；本地 HEAD 相同，分支 `codex/pc-admin-v217-card27b`，提交列表和三点 diff 为空。实际审查输入为 HEAD 的工作区差异与全部未跟踪文件，61 项均逐路径、状态和 SHA-256 冻结在外部 `D:/CodexEvidence/pc-admin-v217-card27b-review-20261106/review-input.json` 与 `snapshot-initial/`，不是用空 diff 代替审查。

三路初审互不读取对方报告，各自覆盖 61/61，0 skipped。Standards：0 硬违规，1 项 P3 possible Duplicated Code（卡片 metadata JSX 重复）；Spec：0 可行动问题；OCR 委托：1 项 medium `OCR-M01`。OCR CLI v1.13.6 实际执行 delegate preview/rule，原生 28 项应用四组规则，另外 33 项（16 unsupported_ext、17 binary）人工补审；17 张 PNG 逐图查看并核对回执，原型 9 个页面模板也已覆盖。OCR 未调用远端 LLM。

`OCR-M01` 已用原制品的真实 loopback HTTP/PG 复现：在日期查询取得服务端搜索槽后，保持下一条窗口 SQL 等待，再选择结束方式；结束方式未禁用，累计 3 次搜索，已结束响应为 200、429，页面进入错误视图。原始 RED 为 `overlap-before.{json,log,png}`，预期退出 1；门闩不修改真实 SQL、响应或超时，证据不覆盖。

修复采用同步条件提交锁及查询 fetching 态，阻止在途搜索期间再次提交即时条件；日期、结束方式、提交、结束搜索、刷新和概况入口沿原组件禁用态。q 草稿仍可编辑，切换看板/列表沿用已接受的日期与条件。该锁只协调读取工具栏，原权限、写入阻塞、搜索限额、业务命令与后端/合同字节不改。metadata 改为单个卡片局部 JSX 值，无新抽象。设计规范与搜索接口文档补充了这一读取协调行为。

新增一个真实浏览器回归，原 15 个 case 保留；用门闩证明在途期间真实点击禁用入口不产生第二查询，释放后按日期/结束方式继续读取，并保留 q、零业务写入、原状态/版本/事件守恒和资源关闭断言。

### 修复候选的实际验证

本轮输入 `7d6178c805f63b1b72b3be360f9ffa84b6abd1f69d98f7b7038b200064f486df`，manifest `0c16bdb41e3a7c1882de4298f082158cbcea03463df43d19c9e46419084c6c67`。原 65/459 仍只属于前一候选；以下为修复后单独执行的一批，原 FAIL/NOT_RUN、RED、故障 PG 现场与历史关闭回执缺口保持。

| 检查 | 本轮实际结果（原件位于 review-20261106 外部证据目录） |
| --- | --- |
| migration:build | build-fix-01.log PASS；922 模块、2,944 制品，STAGED_NOT_ACTIVATED。 |
| gate.mjs types | types-fix-01.log PASS；strict、负向类型和各应用类型；Stylelint 0、既有功能区 ESLint 0 errors/warnings；51 个 CSS 文件的未定义/原始 Token 泄漏均 0。 |
| 全部路径回归 | tests-fix-01/summary.json：65/65 入口、460/460 PASS；FAIL/CANCEL/SKIP/TODO 均 0，NOT_RUN 空。沿原路由、flags、时限与清理合同，外层驱动 384MB，未运行 full/certify。 |
| 直接风险 | PC 浏览器 16、设计基础 76、搜索契约 11、搜索真实 HTTP/PG 2、web01 单元 8/集成 17、原人工复核及合法命令等选定入口均 PASS。今日完成三类关闭负例和拖入关闭区零业务请求断言保留。 |
| 并发 RED/GREEN | 原 RED 3 次请求、已结束响应 200/429、错误视图；新增门闩回归 3 次请求全部 HTTP 200，禁用入口真实点击无第二搜索、q 可编辑、视图保持、释放后解锁，业务 POST 0，事实守恒。新回执 receipt.json；不是给测试增加等待来代替产品修复。 |
| 契约 | contract-syntax-fix.json PASS：OpenAPI 3.1.0，range=recent/all/custom，closure_kind=completed/dismissed；JSON Schema 解析及 11 项守卫/严格解码、2 项真实 HTTP 日期/游标/READ 场景通过。 |
| 制品 | artifact-fix-01.log：ARTIFACT_VERIFIED_NOT_ACTIVATED，manifest 与整批测试一致。 |
| 文档与设计 | docs-agents-fix-01.log 预算/本地链接 PASS、docs-tools-fix-01.log 20/20；impeccable-detect-fix.json=[]。收口新增记录后再作链接终核。 |
| 来源/断言保护 | manifest-comparison-fix.json：相对 B5 候选仅三个代码输入改变，后端/共享/契约及其编译输出不变。preservation-fix.json：34 个受保护路径无漂移；原 13 个显式 case 正文未改，连同两个既有导入注册项的原 15 个 TAP 名称全部保留，新增 1 个；Workbench 原 22 种唯一 data 属性保持。 |
| 视觉 | 新候选重新采集原 9 图和 B5 8 图，保留于本轮 temp；另新增锁定工具栏图 1152×137，viewport1440×1060、Win32、DPR1/zoom1。原 17 图未覆盖。截图/回执见 review/README.md。 |

资源关闭：110 份实际 Job 回执均 cleanup_active_processes=0，缺失/损坏/未分类均 0；17 份 native helper 编译缓存的 source/executable 身份哈希通过。`owned-resource-audit-01.json` 保留首次观测退出 1：当时按共同目录前缀误把这 17 个编译目录当作 Job，要求不存在的 closed.json；按 owned-process.mts 中 prepare/launchSpec 的实际语义分开核对后，`owned-resource-audit-02.json` PASS。未修改维护器或测试来消除观测错误。

resource-final.json：PG 停止前仅 postgres/template0/template1、其他客户端 0；pg_ctl status3、55488/55489 监听 0、任务进程 0。数据、temp、编译缓存、当前制品及所有失败原件均保留，无递归删除。

### 编号复核（当前累计口径）

- B1 已确认无需新增修改：第三列两组、计数、会话偏好、分组内剩余项及统一日期均由修复候选原断言复验；cancelled 模式仍拒绝，业务状态不变。
- B2 已确认无需新增修改：卡片与关闭记录原展示断言通过；S3 无现成恢复命令，恢复按钮/悬停图继续跳过，未知事实仍未知。
- B3 已确认无需新增修改：今日完成只按 COMPLETED；今天的重复、取消、系统不受理三类负例通过。
- B4 已确认无需新增修改：真实拖入已关闭区域仍不发业务请求，原合法完成交互通过。
- B5 已完成：前一阶段已解除 B5.2 日期组合停止；本轮补齐在途条件串行协调，今天/近7天/本月/自定义 × 三结束方式及原日期范围、q 草稿与视图逻辑均复验。
- B6 已确认无需新增修改：既有八原因展示和原提交逻辑通过；取消自由文本不变，统一业务原因等待 27C；S1/S3 写入侧停止线不变。

### 本轮文件与六项自检

当前累计 64 路径：前一节的 61 路径仍在，本轮重新修改其中 Workbench.tsx、WorkbenchSearch.tsx、pc-admin-card12.browser.test.mts、design-system.md、search-source-forward.md 和本执行记录，新增以下三项，不改其它既有文件：

- `docs/ui/evidence/v217-card27b/review/README.md`
- `docs/ui/evidence/v217-card27b/review/receipt.json`
- `docs/ui/evidence/v217-card27b/review/search-controls-locked-1440.png`

| 自检 | 是 / 否 + 证据 |
| --- | --- |
| 仅在本卡及追加授权范围 | 是。完整 64 项最终清单加哈希、实际差异和前述 61 项原授权核对；本轮仅三处代码输入及说明/证据，修复期间后端/共享/契约保护 0 漂移。 |
| 命令、业务状态、权限、迁移、依赖保持 | 是。输入差异仅前端两文件和一测试；完整回归及零业务写入/状态版本事件守恒断言通过。 |
| 27A 默认新响应及同候选解析、无兼容开关 | 是。原响应默认形状保持，严格解码 11 项和真实 HTTP 2 项通过；无新增 Flag。 |
| S1–S4 停止线保持 | 是。S1/S3 不实现写入，S2 只用原固定选项，S4 缺失来源/时间仍 null；B5 日期组合已由用户明确后继授权解除。 |
| 选择器和业务断言只增不减 | 是。原 15 个 TAP 名称、13 个显式 case 正文、22 种 data 属性均保持；新增门闩用例及实际点击，不放宽时限、预算或业务断言。 |
| 数值均有实测 | 是。65/460、3×200/0业务POST、110 Job/17编译缓存、34保护路径、DPR/zoom/尺寸均有原回执与哈希，不把合成结果作为生产容量结论。 |

三路源码复核均 61/61、0 skipped：Standards 原 P3 已解决且无新增判断项，Spec 无新增问题，OCR-M01 源码修复认可且无新增问题；运行验证独立记于上表。最终独立报告路径约定为外部目录的 standards-final.md、spec-final.md、ocr-final.md 及各自覆盖清单，交付时以各审查者实际报告为准，不合并或重排各轴发现。

回退可按 snapshot-initial 对照撤回本轮两个前端读取协调改动与新增用例；本节仅记方案，未执行回退。未提交、推送或创建 PR；CI、full/certify、Electron、真实发送、现场业务写库、部署及 Gate 均 NOT_RUN。
