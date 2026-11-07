# 卡 27C-B：统一关闭与恢复的 PC 界面

日期：2026-11-07（Asia/Shanghai）。本次仅本地交付，不提交、推送、创建 PR、部署或实际发送通知。

## 基线、授权与所有权

- HTTPS fetch 后 main 已同步至 `ba469c4013d765566225470ff96c1661a65d5e97`；GitHub 只读确认卡28 PR #158 与27C-A PR #159均 merged。分支为 `codex/v219-card27c-b`，工作区初始干净，本会话为唯一写者。
- 已读 AGENTS、执行基线、开发/验证/会话规则、设计规范、ADR-0053/0056、27C-A执行记录及当前关闭接口。GitHub搜索没有找到单独27C Issue，未新建或更新票。
- 用户追加授权一：27C-A没有暴露恢复前状态/负责人、实际送达和历次记录，允许补齐最小后端只读合同与解析层。新增两个 GET，不改关闭/恢复写命令、状态机、发送器和权限。
- 用户追加授权二：允许 Workbench.tsx 把已关闭卡片链接、原单按钮和恢复按钮分开接线；允许更新 design-system.md。其它改动限定关闭功能、列表已关闭行、相关测试/fixture和必要契约文档/资源登记。
- 本卡集群只监听 `127.0.0.1:55493`，数据目录 `D:/CodexData/card27c-b-20261107-pg`；测试通过既有 helper 创建/回收 UUID 库。临时目录为 `D:/CodexTemp/card27c-b-20261107`。原始结果统一在 `D:/CodexEvidence/card27c-b-20261107`，不会把历史失败改成通过。

## 编号交付

| 编号 | 状态与说明 |
| --- | --- |
| B0 最小读取补充 | 已完成。只读历史20条/页、版本游标、当前恢复目标、实际投递状态；查询后重查 READ、Cookie、TTL、主体版本；无数据库迁移。 |
| B1 关闭对话框 | 已完成。六固定原因、非 IT 八项二级、选填原单搜索、OTHER必填说明/默认不通知；统一 Ticket/Intake/Review 入口；440/14/20/36px实测。 |
| B2 恢复 | 已完成。卡片、列表负责人格和抽屉入口；服务端恢复目标/送达事实确认；1.2秒高亮；UNKNOWN保留原UUID并只读核对。 |
| B3 原因与记录 | 已完成。普通/二级/重复原单标签，当前可见原单查询后打开抽屉；关闭/恢复倒序分页、操作人/时间/方式/说明/通知事实。 |

## 实现与边界

共享关闭/恢复对话框在工作台保留唯一命令状态，使用已有加密草稿、身份 fence、If-Match、幂等UUID及回执。失败/UNKNOWN不生成新命令，失权清除本卡新增查询与敏感显示。历史区域跟随最新关闭/恢复活动身份刷新，避免同秒多次动作沿用旧记录。

恢复目标沿 ADR-0056：原负责人有效时保持原列/状态/负责人；停用或失去团队资格时回 QUEUED/未领取。已接单和重新打开属于待接单列。关闭终止的预约、跟进和提醒不会被恢复自动重建；会话接待不变。

通知提示只用固定文案，内部说明不参与拼接。记录的 SENT 必须有 Delivery SENT + ACKNOWLEDGED + 最新成功 Attempt；入队不代表已通知，UNKNOWN保留待核实。H5与通知代码未修改；没有真实发送。

新读取使用现有071关闭记录，固定每页20条并多读1条判断下一页，事务只读且statement timeout为2000ms。无历史原因映射、回填或字段缺失回退。原单在点击时通过现有当前授权搜索解析，未找到不猜ID。

## 旧期望 → 新期望 → 规则编号

| 位置/旧期望 | 新期望 | 规则 |
| --- | --- | --- |
| 取消自由文本 + 独立“确认取消”复选框才能提交 | 明确选择六种原因；OTHER必填内部说明；“确认关闭”执行；保留草稿、版本、责任和轮次断言 | U1、U6、U8 |
| 取消按钮/窗口显示“取消工单” | 入口和可访问标题为“关闭事项”；原data-action、对话框/控制器类名和旧aria定位钩子保留，aria-labelledby提供新名称 | U1 |
| 取消沿WaitingCommand携带external_visible:false | 直接使用既有ClosureCommand；取消分支不携带该旧字段；其它等待动作仍精确断言false | U1、U4 |
| 范围外结论在旧复核表单使用八原因单选及resolve命令 | 快捷入口打开统一对话框并预选NOT_IT_SCOPE，二级需明确选择；Intake close携带原review版本与材料hash；仍只生成原分类效果、不建另一故障 | U1、U4 |
| 已关闭无恢复按钮 | can_restore且当前有权时显示；实际恢复仍由原命令终检；历史只读账号的未核对回执不等于可写权限 | U3、U8 |
| 关闭原因只显示一级/原单静态文本 | 二级全文title；重复有原单为“重复 · 编号”，通过可见搜索打开；说明仅内部读取 | U1、U2 |

其它等待、接单、派单、公开进度、鉴权、版本、幂等、UNKNOWN及隐私断言保持。测试名称保留，新增断言覆盖新规则；菜单前提改为等待当前按钮存在/就绪，不增加超时或使用强制点击。

## 原始失败与修复

- build-01：前端重复DISMISSED分支的类型收窄与Toast子元素字符串类型失败；已修复。stylelint-01拒绝直接圆角calc，改为组件局部圆角Token。
- direct-01：缺少隔离库确认环境标记，预检拒绝，业务未运行；运行器补齐本卡loopback标记。
- direct-02：旧取消用例通过，新历史读取SQL把TEXT closed_by和UUID直接比较；改为principal.id::text，不修改表结构。
- direct-03：契约、设计基础、关闭集成和回执共188项通过；再次打开抽屉的测试过早依据缓存寻找折叠菜单而超时。原始探针证明初次无按钮、随后按钮出现但菜单仍关闭；等待当前按钮就绪后使用原真实交互helper。
- probe-restored-control-01：系统默认Edge启动未取得调试端口，清理回执为0；后继显式使用已有Windows Chrome。
- build-04：新增测试误用TicketDetail不存在的title字段；改为实际ticket_no/面包屑证据，未修改接口迎合测试。
- ui-04：列表恢复被整行链接命中层遮挡；修复闭行负责人格的定位、按钮样式优先级和既有list-claim层级。另一个测试误取折叠看板内恢复按钮，改为抽屉范围。
- ui-05：完整B1–B3主流程已通过；UNKNOWN测试在原生离页确认时停住，截图也被该原生弹层阻断。通过既有harness新增受清理管理的事件等待，明确观察beforeunload并确认；不删除应用离页保护。该轮截图归档拒绝自定义文件名；标准归档规则保持，六张专题图另用具名回执、哈希及尺寸校验保存。
- ui-06：六原因/两视图恢复/原单/多次记录、UNKNOWN刷新恢复、范围外快捷与加密草稿过期通过；旧抽屉回归发现detail-cancel-controller钩子缺失，已补回真实持久容器。
- tools-01：H5夹具清理的原断言遇TEMP正斜杠与Windows规范路径不一致；修正运行环境后复测，工具断言不改。

所有 FAIL、NOT_RUN、原截图和原TAP保留在外部证据根；各批绑定自己的manifest，不把早期通过重绑到新候选。

## 验证、截图、文件清单与自检

主体交付候选（追加文案前）未提交，HEAD 为 `ba469c4013d765566225470ff96c1661a65d5e97`；build-14 的 source_input_hash 为 `0b03b981923792e5c9c44f12836851fa7ea8a28818d60fec89371cf9ffae89ba`，manifest SHA-256 为 `2942fd06d1e92892eb8092bd4886795e3b3ac1dce725a22bd4ea9f8adb5ff516`。状态为 STAGED_NOT_ACTIVATED，未部署。

| 检查 | 实际结果与原件 |
| --- | --- |
| 统一应用构建 | build-14 PASS；928/928 Node语法检查、2962 outputs；包含PC/H5/桌面严格类型与正式资源构建。 |
| gate.mjs types | types-final-13 PASS，含strict、negative-types、Stylelint、feature ESLint、design-variables；build-14仅修测试字符串，全部应用制品字节与13相同，比较原件为increment-14-output-comparison.json。 |
| 路径策略与直接风险 | final-01：64/64入口、542/542 PASS，0 FAIL/SKIP/取消/NOT_RUN；对应build-09，原manifest与原日志保留。 |
| 前端收尾增量 | Review→Intake→Review改用稳定Intake身份高亮；保留未保存关闭草稿的导航/卸载保护与重开；快捷入口重新预选非IT而保留说明。ui-final-13的T10关闭4/4，加ui-final-14其余6个入口13/13，去重7入口17/17 PASS。13→14只改变一份测试的引号，全部应用字节相同。 |
| 后端/H5增量证明 | increment-13-output-comparison.json：相对542项回归的build-09，server/shared及H5输出全部字节相同。没有把旧报告的manifest改绑到新候选。 |
| 工具检查 | 7文件首批tools-01为125/128；H5路径表示错误后整文件h5-tools-02为13/13；两例manifest时序错误在固定制品后hosts-recheck-02为2/2。三项原失败均已复测通过；其它原通过项保留各自对象。 |
| 契约校验 | contracts-final：267 Schema、861本地引用、3份OpenAPI解析/引用/operationId检查PASS；新增两个GET的响应绑定已核对；实际前端解码、坏字段、非法日期另有定向用例。 |
| 制品校验 | artifact-final-14：ARTIFACT_VERIFIED_NOT_ACTIVATED；没有激活部署。 |
| 文档、差异与范围 | 文档预算/全部变更本地链接、git diff --check、范围/依赖/原写路径审计通过，最终日志见外部证据根。 |
| 截图 | [六图与回执](../../docs/ui/evidence/v219-card27c-b/README.md)。Windows Chrome / DPR1 / zoom1 /1440×1400，440/14/20/36px精确断言通过；截图绑定build-13，其应用字节与最终14相同。 |

补充过程记录：build-11误读取TicketCommandContext并不存在的status字段，严格类型拒绝；已撤回该读取，未扩展根client.ts接口。ui-final-13中新增测试表达式遗漏引号，导致1例测试脚本SyntaxError；没有业务POST，原失败保留。修正后先解析140段浏览器静态脚本，build-14和ui-final-14复验通过。build-12仅为过程构建，不冒充业务全回归。

未运行新的GitHub CI、full/certify、真实通知、现场业务写库、Electron现场验证、部署或业务Gate。所有运行结果只证明本地合成身份、真实loopback HTTP/PG和对应代码范围。

## 七项自检

| 自检项 | 是 / 否 + 证据 |
| --- | --- |
| 只改最终授权范围；PC不改未授权后端/合同/接口形状 | 是，含用户三次追加授权。后端仅补只读历史；原Intake写入/回执代码尾部与HEAD相同，根api/client.ts未改。scope-audit.json与下方清单可核。 |
| U1–U8按本卡职责落实，未自行放宽 | 是。U1/U2/U3/U4/U6/U7/U8由关闭/恢复、角色、原单、通知和加密恢复用例覆盖；U3沿ADR-0056保留失效负责人回QUEUED的已确认例外。U5统计/解析继承27C-A并通过H5回归；H5新筛选界面属27C-H，不扩入本卡。 |
| 内部说明不发给报修人、不返回H5 | 是。UI固定文案断言、六原因真实outbox/替身Sender断言及H5契约/流程回归；新history接口只供工作台READ。 |
| 没有新增依赖，没有真实通知 | 是。package/lock无差异；已有Chrome、PG18、FFmpeg；real_sends=0。 |
| 无历史映射/兼容读取，开发测试按新规则合成 | 是。新历史查询只读071事实，不从旧自由文本/创建时间回退；既有helper/命令Port重新创建UUID库，最终库清单回到三个系统库。旧Evidence保留。 |
| 测试选择器只增不删，业务期望变化逐条记录 | 是。保留data-action=cancel、原控制器/对话框类、旧aria定位钩子；新可访问名称通过aria-labelledby表达；新增六原因/恢复钩子。旧确认选择器以联合选择器增补OTHER选项；原测试名称无删除。表单/复核预期变更见上表。 |
| 合并后main上PC与H5均正常运行 | 否，本次按要求未提交/推送/创建PR或合并。当前本地候选的PC/H5构建及所选回归通过，不能冒充合并后main验收。 |

## 资源收口与保留

自有测试宿主、浏览器由既有helper关闭；最终PG仅有postgres/template0/template1，55493无监听。最后一次停服和库清单见cleanup-final.json、pg-stop-02.log、final-db-list-02.txt（13:59，晚于最终UI批次13:58结束）。收尾重复尝试连接已停止的PG得到Connection refused；已保留该次核验失败，未为重复核验重启集群，随后pg_ctl再次确认no server running。root的未提交分支和已校验编译候选保留供审查。

自动审批检查拒绝对 `D:/CodexData/card27c-b-20261107-pg` 的递归删除，仅返回 `blocked by policy`。没有改用其它工具绕过；已停止的空集群目录保留。外部原始TAP、FAIL/NOT_RUN、截图和临时工具夹具原件同样保留；没有清理其它任务或用户原件。

## 全局提示文案追加收口

用户后继明确授权将全局Toast标题统一为“关闭事项”。本次只修改app/pc-admin/src/app/ToastFeedback.tsx中ticket-waiting-cancel标签的显示值，保留source键、测试选择器、通知状态与业务逻辑。逐字差异断言确认其余源码相同。旧六张截图及原回归保持各自候选绑定，不重写旧图中的提示标题。追加校验已完成：build-toast-15通过（928/928 Node语法检查、2962输出），types-toast-15通过（strict/negative-types/Stylelint/ESLint/design-variables）。toast-label-change.json确认只改一个标签值；toast-15-output-comparison.json确认仅PC静态资源输出变化，后端、共享、H5、桌面及测试制品均相同。该纯文案增量不重跑数据库/业务全集，不重绑原542项及收尾17项回归。制品与文档校验原件为artifact-toast-15.log、docs-toast-15.log。

最新文案候选source_input_hash为 `6d8ec4373ba4cf6f7e82b0e339f752c683cf8852f164ae128ba84821ce0560fb`，manifest SHA-256为 `a237a47ce62fe8d6849e4822be55fa0f4642575e303879345181efec61b3623f`，保持STAGED_NOT_ACTIVATED。未提交、推送或创建PR。


## 多代理独立审查与修复（2026-11-07）

审查对象为 HEAD `ba469c4013d765566225470ff96c1661a65d5e97` 到当前未提交工作区的实质差异和全部新文件；三名子代理保持只读，分别检查规则、权限/隐私/UNKNOWN和仓库规范。审查/修复没有提交、推送或创建PR。

| 审查轴 | 原发现 | 修复与复核 |
| --- | --- | --- |
| Spec / U1–U8 | 0个可执行问题；逐项核了六原因、关闭/恢复权限、原单、H5隔离与六张原图哈希。 | 修复后只读复核新增恢复确认、分页保留和浏览器路由，没有新偏差。旧图绑定旧候选的当时事实仍保留；当前六张图已重新拍摄并绑定build-review-23。 |
| Safety / U4、U3 | P2：恢复弹层读到NOT_SENT后Worker可完成SENT而Ticket/Intake版本不变，旧确认文案与实际恢复通知不一致。 | 提交前重读首屏history，比较主体版本与整个恢复目标；变化时更新提示并停在原窗口，下一次明确确认才创建恢复POST。NOT_SENT提示改为“如关闭通知最终送达，恢复通知也会按送达核对结果发送”，涵盖恢复后的送达。原UUID的UNKNOWN核对和服务端锁内决定保持。独立复核确认原问题闭合。 |
| Standards / B3 | P3：更早分页读取失败会隐藏已加载的所有关闭记录。 | 普通分页错误保留前20条并显示重试，进行中禁用重复点击；401/403/404立即遮蔽并清授权缓存。独立复核无剩余问题。 |

后端记录的关闭送达可能在提交前重读之后变化；UI对此作条件性说明，真正是否投递恢复通知仍由服务端依据锁内送达事实决定。本卡未改变写命令合同，不把前端预检称为原子保证。

新增两个真实浏览器/PG直接风险场景位于原 `t10-waiting.integration.test.mts` 所导入的helper：合成Sender在弹层打开后ACK关闭通知，第一次恢复点击为0 POST，提示更新后第二次为1 POST；更早页注入一次503后前20条仍可见，重试到21条。原测试入口现在登记 `requires_browser=true`，未新增依赖或改变其它选择器。

- 构建/类型/制品：build-review-23、types-review-23、artifact-review-23均PASS；后者manifest SHA-256为 `a0d90f6187885b59908eeb12d9d56922ab4bb2de42318362d1c5456187b435e5`，source_input_hash为 `2d5df99b543fa118f9d6a236ffd22365eb02f1796c0884e60bb2b39d16396f92`。状态仍STAGED_NOT_ACTIVATED。
- 定向回归：review-db-23为77/77，review-ui-23为4/4，测试策略pr-plan-review-23为13/13，0 FAIL/SKIP/取消/NOT_RUN。151段浏览器静态脚本解析PASS；新截图六张的SHA/尺寸及候选身份见截图回执。原64入口542/542仍是原候选的独立证明，未重绑。
- 相对追加文案后的候选，review-23-output-comparison.json证实后端/shared/H5输出字节不变。PG复验后停止，55493无监听，数据库只剩三个系统库；review-cleanup.json保存实测。自有空集群目录仍按先前自动审批拒绝留存，未绕过拒绝。
- 过程失败保留：build-review-16/17的新浏览器fixture Cookie URL可空类型被strict拒绝，改为验证URL后组装原Cookie；build-review-21因修补文案时源码变动而被身份保护拒绝，源码稳定后build-review-22/23通过。没有将失败轮次标为通过。

回退本审查增量时先保全当前未提交差异，再撤回上述PC恢复确认/历史错误态与测试路由的对应行；不改写旧Evidence、071迁移或既有关闭/恢复写事实。

## 完整文件清单

共 42 个路径；文件内容尚未暂存或提交。

- [plans/typescript-migration/test-routing.json](../../plans/typescript-migration/test-routing.json)

- [app/pc-admin/src/app/ToastFeedback.tsx](../../app/pc-admin/src/app/ToastFeedback.tsx)
- [app/pc-admin/src/app/Workbench.tsx](../../app/pc-admin/src/app/Workbench.tsx)
- [app/pc-admin/src/app/WorkbenchDetail.tsx](../../app/pc-admin/src/app/WorkbenchDetail.tsx)
- [app/pc-admin/src/design/components/TicketCard/ClosureDialog.tsx](../../app/pc-admin/src/design/components/TicketCard/ClosureDialog.tsx)
- [app/pc-admin/src/design/components/TicketCard/TicketCard.tsx](../../app/pc-admin/src/design/components/TicketCard/TicketCard.tsx)
- [app/pc-admin/src/design/components/TicketCard/closure-presentation.ts](../../app/pc-admin/src/design/components/TicketCard/closure-presentation.ts)
- [app/pc-admin/src/design/components/TicketCard/ticket-card.css](../../app/pc-admin/src/design/components/TicketCard/ticket-card.css)
- [app/pc-admin/src/design/components/WorkTable/WorkTable.tsx](../../app/pc-admin/src/design/components/WorkTable/WorkTable.tsx)
- [app/pc-admin/src/features/closure/client.ts](../../app/pc-admin/src/features/closure/client.ts)
- [app/pc-admin/src/features/manual-review/ReviewWorkspace.tsx](../../app/pc-admin/src/features/manual-review/ReviewWorkspace.tsx)
- [app/pc-admin/src/features/ticket-waiting/ClosureActions.tsx](../../app/pc-admin/src/features/ticket-waiting/ClosureActions.tsx)
- [app/pc-admin/src/features/ticket-waiting/ClosureHistory.tsx](../../app/pc-admin/src/features/ticket-waiting/ClosureHistory.tsx)
- [app/pc-admin/src/features/ticket-waiting/ClosureLinks.tsx](../../app/pc-admin/src/features/ticket-waiting/ClosureLinks.tsx)
- [app/server/src/p2-016-workbench-http.mts](../../app/server/src/p2-016-workbench-http.mts)
- [app/server/src/workbench-intake-closure.mts](../../app/server/src/workbench-intake-closure.mts)
- [contracts/conversation_center.openapi.yaml](../../contracts/conversation_center.openapi.yaml)
- [contracts/unified_closure_contracts.d.ts](../../contracts/unified_closure_contracts.d.ts)
- [contracts/unified_closure_history.schema.json](../../contracts/unified_closure_history.schema.json)
- [docs/api/endpoint-index.md](../../docs/api/endpoint-index.md)
- [docs/api/workbench/closure.md](../../docs/api/workbench/closure.md)
- [docs/ui/design-system.md](../../docs/ui/design-system.md)
- [docs/ui/evidence/v219-card27c-b/01-duplicate.png](../../docs/ui/evidence/v219-card27c-b/01-duplicate.png)
- [docs/ui/evidence/v219-card27c-b/02-not-it.png](../../docs/ui/evidence/v219-card27c-b/02-not-it.png)
- [docs/ui/evidence/v219-card27c-b/03-other.png](../../docs/ui/evidence/v219-card27c-b/03-other.png)
- [docs/ui/evidence/v219-card27c-b/04-restore-confirm.png](../../docs/ui/evidence/v219-card27c-b/04-restore-confirm.png)
- [docs/ui/evidence/v219-card27c-b/05-restored-highlight.png](../../docs/ui/evidence/v219-card27c-b/05-restored-highlight.png)
- [docs/ui/evidence/v219-card27c-b/06-history.png](../../docs/ui/evidence/v219-card27c-b/06-history.png)
- [docs/ui/evidence/v219-card27c-b/README.md](../../docs/ui/evidence/v219-card27c-b/README.md)
- [docs/ui/evidence/v219-card27c-b/receipt.json](../../docs/ui/evidence/v219-card27c-b/receipt.json)
- [plans/pc-admin-design-v21/card-27c-b.md](../../plans/pc-admin-design-v21/card-27c-b.md)
- [tests/helpers/card27c-closure-cases.mts](../../tests/helpers/card27c-closure-cases.mts)
- [tests/helpers/p2-006-browser-harness.mjs](../../tests/helpers/p2-006-browser-harness.mjs)
- [tests/helpers/t10-waiting-fixture.mts](../../tests/helpers/t10-waiting-fixture.mts)
- [tests/pc-admin-design-foundation.test.mts](../../tests/pc-admin-design-foundation.test.mts)
- [tests/t10-cancel.browser.test.mts](../../tests/t10-cancel.browser.test.mts)
- [tests/t10-purpose-expiry.browser.test.mts](../../tests/t10-purpose-expiry.browser.test.mts)
- [tests/t10-waiting-ack.integration.test.mts](../../tests/t10-waiting-ack.integration.test.mts)
- [tests/t10-waiting-contract.test.mts](../../tests/t10-waiting-contract.test.mts)
- [tests/wbint-t14-review.browser.test.mts](../../tests/wbint-t14-review.browser.test.mts)
- [tests/workbench-detail-restructure.browser.test.mts](../../tests/workbench-detail-restructure.browser.test.mts)
- [tools/ts-migration/resources.json](../../tools/ts-migration/resources.json)

## 迁移与回退

本卡没有SQL迁移；071及关闭/恢复事实仍由27C-A负责。回退先停止本卡宿主并保全本地diff，再配套撤回列出的PC界面、只读HTTP/DTO/解析、OpenAPI/Schema及资源登记；不回退071、不删除关闭/恢复历史、不改写main。仅本卡helper创建的合成库/临时运行资源可按所有权清单清理。当前未提交候选与证据保留供后续审查，未激活为部署。
