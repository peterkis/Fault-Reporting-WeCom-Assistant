# 卡26：前端细节收口

**当前状态：三路独立复核完成，剩余问题0；本地复验通过，已获提交/推送/PR及通过后合并清理授权，待远端验证。** 修复输入`e8b5206a949f80b6431716d56d86b84108bfa5fd2ee7c5f901931641aea1c4d8`，manifest `21fd91e2390e16b8f6ee86df683b7a921ea7c30d7e52ab4bb98a184f7faf5b3b`。同候选4入口去重106/106 PASS；原失败保持。下述`78f7ee…`/`ac71b9…`是初审前交付检查点，不覆盖审查发现的中间宽度缺陷；最新结论见文末后继。

前一交付检查点输入SHA-256 `78f7ee27b2c3132ca8e692405f02582d59456e72ed90b15a7acca43b849d46ed`，manifest SHA-256 `ac71b92c984e46de50b6ae6564168102e867cb7cb026c3eb8bdaac5a453ab5e7`。该候选4入口106/106 PASS；更前候选另有54入口325/325 PASS，保留原身份分账。

2026-11-06，分支 `codex/pc-admin-v217-card26`，基线与当前HEAD均为 `702f80d653f0c96f6febd7404c58834246427fe7`。独立工作树 `D:/worktrees/pc-admin-v217-card26`。停在本地交付，没有提交、推送或创建PR。

用户提供的未跟踪v2.2原型是原件，保持原字节。只实施D1–D8；卡27A/27B仅作背景，不扩展后端、契约或写入侧。

## 所有权与直接风险

Root负责会话展示、共享时间、基础单测、规范与本记录，并独占Git、构建和运行资源。并行子代理按互不重叠文件写入：气泡/泳道/Token/看板fixture与相应看板浏览器测试；收件箱fixture与收件箱浏览器测试。子代理不提交、不推送、不启动共享构建或清理他人资源，停止写入后交给Root整合。

首轮在主目录构建时，另一会话将该目录切到 `codex/pc-admin-v217-card27a` 并写入后端/契约，构建发生跨卡类型错误。`build-initial.log`保留原FAIL，不作为卡26候选。Root随后在 `D:/worktrees/pc-admin-v217-card26` 从原基线建立本卡独立工作树，只迁移12个明确自有文件；每份先核目标副本SHA-256相等，再从主目录撤去本卡原差异。`isolation-owned-files.json`与`isolation-relocation.json`保留字节证据；其他会话的后端、契约、测试和用户原型未改。后续构建与验证均使用独立工作树，依赖通过现有锁版node_modules的Junction复用，不安装依赖。

沿[ADR-0053](../../adr/0053_mvp_delivery_and_test_policy.md)和[路径策略](../testing-policy.json)选择既有入口。直接风险为CSS覆盖导致首角失效、零数量文案、横幅关键状态裁切、主题/渠道挤压、链接对齐和合成分类覆盖。新增浏览器断言覆盖实算样式/几何与三档宽度，单测覆盖等待0/59/60秒。保留全部旧选择器、属性和业务断言；选中检查通过且缺口关闭后停止扩验。

## 前一交付编号清单（独立初审前）

- D1：已确认无需修改。当前背景元素incoming首条四角为4/12/12/12px，后条全12px，outgoing首条为12/4/12/12px；背景非透明，未发现普通气泡更高优先级覆盖，保留原MessageBubble实现。2倍局部另有截图。
- D2：已完成。0秒和59秒均为「刚刚」，60秒为「1 分钟」；只改共用`formatWaitingTime`回退文案，`heatOf`与热度阈值未改。基础测试新增3条。
- D3：已完成。私聊显示「1 个主题」，0群项省略；合成多来源保持「9 个主题 · 至少 8 个群」；状态行无独立「0 个」项。
- D4：已完成。三段式横幅、680px聊天容器阈值、姓名上限104px（当前13px字体的8em）。1440/900/1920的核心状态均scrollWidth=clientWidth=158px且位于横幅内；1440补句隐藏、姓名75px/scroll104px；900与1920姓名104px完整、补句98px完整。按钮不收缩。
- D5：已完成。1440下链接文字left=1153px、卡片left=1153px，差0px，左padding=0px；悬停底色以伪元素向两侧扩展，保留原链接与打开行为。
- D6：已完成。三档选择器实测240px；渠道「群来源 · 回复通过私聊」clientWidth=scrollWidth=118px且在父行内，科室先省略。
- D7：已完成。1440首屏可见ENDPOINT_PRINT、CLINICAL_CORE、NETWORK_INFRASTRUCTURE、DIAGNOSTIC共4个域/4种背景色，并有未分类；只扩展precisionV212合成服务数据，不改category映射。
- D8：已完成。三列均outlineStyle=none、outlineWidth=0px，box-shadow=`rgba(55, 53, 47, 0.05) 0px 0px 0px 1px inset`。复用已有5%的`lane-border`，新增完整`shadow-lane` Token。

文件、实测值、自检和限制见下文，最终检查与资源结果见末段。中间FAIL/NOT_RUN按原对象保留；CI、full/certify、Electron、真实发送、现场业务写库、部署及业务Gate均未执行。

## 验证过程与保留的失败

原件集中于 `D:/CodexEvidence/pc-admin-v217-card26-20261106/`，自有临时目录为 `D:/tmp/pc26-1106/`，自有PG18只监听 `127.0.0.1:55486`。

- `build-initial.log`：主目录被卡27A并发写入后的跨卡类型FAIL，已迁移隔离；不改27A后端来通过卡26构建。
- `build-isolated.log`：本卡第一份隔离候选PASS，922个Node语法检查；`types-initial.log`完整PASS，含Stylelint、ESLint、设计变量、strict与负向类型。该候选输入 `7bad178057bf882c51d0da3a25dc9e6b70f3e8610b986c09c96d558048e63b28`，不重绑后续候选。
- `direct-initial/`、`direct-initial.log`：新用例在fixture阶段释放命令返回 `CONVERSATION_CONTROL_STORAGE_FAILED`，尚未到达浏览器断言。`fixture-diagnostic.log` 的原 `onInternalError` 回调进一步观测为 `CONVERSATION_REALTIME_EVENT_INVALID`；实际源码守卫要求实时事件时间不早于流尾，原fixture把已写入当前事件的会话释放回拨5小时，违反此约束。修正仅在现有fixture内：当前时刻执行真实释放命令，再沿既有合成日期写法安排 `released_at`；不改生产代码、事件流或时间守卫。
- 同一初轮中，旧失权用例出现 `P2_006_BROWSER_COMMAND_TIMEOUT`，文件最后由原240秒外层截止终止；其余3入口NOT_RUN，原TAP/逐例trace/所有权回执保留。汇总计数0是TAP不完整，不能理解为未执行任何用例或全部通过。后续保持原权限/恢复断言和超时，不扩大或放宽门槛。
- 超时留下的唯一自有合成库 `p2_015_web01_81f89168_6398_4658_8530_fccc24c7de11` 已在核验本任务data目录、零连接后精确删除；`pg-after-timeout.txt`与`pg-timeout-cleanup.log`保留原件，未触及其他库。

修正后的候选、正式完整入口结果及截图以实际后继记录为准。单独筛选的新用例诊断仅用于关闭新UI断言的覆盖缺口，不冒充完整入口通过。

- `build-fixture-fix.log`与`types-fixture-fix.log`：fixture修正候选PASS，输入 `6c03de6d2bb0fd988f1df651c007a731e685932c485e90afe5bd40059db91e15`。`diagnostic-inbox.tap`仅选新用例，1/1 PASS：首次实测D1圆角、D3数量、D4三尺寸、D5左缘和D6宽度均达到要求。
- `direct-final/`是上述中间候选的第二批原始结果，名称不代表最终交付：完整收件箱13条中12 PASS、1 FAIL（旧B1–B5在清除来源筛选的真实控件等待超时），其余3入口NOT_RUN。原失败快照已无source参数；原筛选组件、公共helper与旧断言保持，不能声称修复了此间歇现象。
- 第一次视觉检查发现两张2倍气泡局部底部裁切，不能作为完整局部图交付。独立截图诊断保留在`screenshot-diagnostic*`；正式新用例后继改为完整区域采集，并使用`--space-8`底部留白，保留2倍尺寸断言。此项只改新截图采集，不改产品样式或旧业务测试。
- 一次`impeccable-detect.json`扫描结果为`[]`。用户原型最终SHA-256与开工一致。后继构建`build-final.log`PASS，922个Node语法检查，输入 `3f9878b90cab886a36031d1549d42629f2d794c3cf2c92941dc81083b161aca9`；最后一批按此候选重新执行，不复用前一候选的类型或业务通过数。

### 生产代码候选的路径回归与定向收口

上述 `3f9878…` 输入的 `types-final.log`完整PASS；`direct-release/` 中基础74、收件箱契约7，共81/81 PASS。Card12入口在前10条通过后触到原240秒截止，收件箱未到达，原FAIL/NOT_RUN保持。其余路径入口 `remaining/` 为54入口325/325 PASS，零SKIP/TODO/取消；包括真实身份、权限、事务/原UUID恢复、通知隔离及H5完整流程。

`board-resume/` 的13条中12 PASS、1 FAIL；这次到达并定位旧布局前提：测试按h1文字底边要求12px，而卡24后图标36px、h1行高32px居中产生2px行内偏移。外部诊断 `board-diagnostic.log` 逐宽度实测1920/1440/1280/900均为文本间距14px、行内偏移2px、标题整行到工具栏12px。后继保留原h1测量/选择器，新增整行偏移观测，继续要求块间距12±1px；其他间距、业务断言和容差保持。

同一外部诊断先通过D7的四域/四色/未分类断言，再在D8发现 `outline-style:none` 仍带浏览器默认 `outline-width:3px`。后继显式 `outline:0`，不修改D8的0px断言。没有调整分类fixture。

`inbox-resume/` 保留另一份240秒外层超时：原最后Cursor GET-only日志已输出，但TAP/资源收口未在截止内完成。后继把本卡独立新case移入既有Split视口用例的末段，复用同一PG、HTTP host和浏览器，减少一次冷启动。旧48样本、导航、原UUID/权限、业务POST及资源0断言都保留，原case120秒、入口240秒均未增加。新增截图段使用原Split的HTTP/PG读取配置，不宣称其含SSE；其他原有真实SSE用例保持。

这些后继由两个子代理按CSS/Card12测试、收件箱测试分开写入，均已STOP；Root整合后的静态保留检查为6文件PASS，旧JSX属性、选择器字面量、assert调用缺失0。`production-candidate-manifest.json`保存前述候选原manifest，后继结果按新输入独立记账，不将325条旧结果重绑。

`f6681f…` 收口候选的`build-closure.log`与`types-closure.log`均PASS；`direct-closure/`中基础74、契约7、Card12浏览器13全部通过。收件箱12条中11 PASS、旧B1–B5在来源清理处1 FAIL；本卡新几何段已通过并生成六张要求图片，原失败不覆盖。

该失败的请求序列没有任何`source=direct`收件箱请求：自动化只等地址栏改变，随即搜索提交仍使用旧React渲染中的`source=all`。`filter-diagnostic.tap`在原生产bundle上只增加“控件active且原生select值已提交”的等待，原B1–B5全部业务断言1/1 PASS。正式后继保留原URL等待、全部旧断言及时限，增加该DOM提交前提，不修改产品筛选逻辑或公共交互helper。

最后后继的`final-test-comparison.json`证明只改变收件箱测试源码及其两个编译产物；全部生产产物（含PC/H5/后端）与`f6681f…`逐字节一致。最终直接风险检查与当前制品核验仍按最后输入独立运行；旧54入口325条保留原`3f9878…`身份，不合成单候选总数。

## 文件清单

- `app/pc-admin/src/features/conversations/ConversationInbox.tsx`：非零数量、横幅三段、科室/渠道分段。
- `app/pc-admin/src/features/conversations/conversations.css`：横幅收缩、链接对齐与悬停、选择器上限和渠道优先。
- `app/pc-admin/src/design/format-time.ts`：共用「刚刚」文案。
- `app/pc-admin/src/design/components/BoardColumn/board-column.css`：outline清零与内描边。
- `app/pc-admin/src/design/tokens.css`：`shadow-lane`。
- `tests/pc-admin-design-foundation.test.mts`：0/59/60秒断言及文案期望。
- `tests/conversation-inbox.browser.test.mts`：复用视口夹具的D1/D3–D6实测、截图及筛选渲染就绪等待。
- `tests/helpers/conversation-inbox-fixture.mts`：合成等待、多来源与私聊场景。
- `tests/helpers/web01-workbench-fixture.mjs`：合成服务分类覆盖。
- `tests/pc-admin-card12.browser.test.mts`：D7/D8实测与原标题整行几何锚点。
- `docs/ui/design-system.md`、本执行记录。
- `docs/ui/evidence/v217-card26/README.md`、`metrics.json`、`receipt.json`及六张PNG：`conversation-1440.png`、`conversation-900.png`、`conversation-1920.png`、`bubble-incoming-x2.png`、`bubble-outgoing-x2.png`、`board-1440.png`。

## 六项自检

| 自检 | 是 / 否与证据 |
| --- | --- |
| 只改本卡允许文件，26不改后端/契约 | 是。五个生产文件均在展示层；Token为D8显式允许，测试、规范及Evidence为本卡交付。后端、contracts、api/client、数据库、shared、依赖差异0；原型原件哈希不变。 |
| 没有新增/修改业务命令、状态、权限、迁移或依赖 | 是。仅展示和合成夹具；验证仅在自有loopback库执行已有迁移/命令。持久开关默认不变。 |
| 27A默认新形状且不新增兼容开关 | 否（本卡不适用）。未执行27A，不对其接口交付作结论；本卡API和契约差异0，也未增加兼容开关。 |
| 27A S1–S4触发时停止写入侧 | 否（本卡不适用）。未进入27A或其写入侧，不作27A停止项的通过声明。 |
| 测试选择器与业务断言只增不减 | 是。`preservation-check.json`六文件缺失0；原用例名称、48视口样本、原业务断言和120/240秒时限保持，仅调整布局/渲染前提并复用夹具。 |
| 数值验收项都有实测值 | 是。编号清单与`metrics.json`记录圆角、0/59/60秒、三宽度、0px对齐差、240px选择器、118px渠道、4域/4色和1px/5%内描边。 |

## 限制与回退

本地Windows系统浏览器与隔离合成PG验证，不能代替现场业务、用户接受、Electron或生产验收。卡27A/27B另行整合，当前候选只绑定基线702f80d6与本卡输入；CI、full/certify、真实发送、现场写库、部署及业务Gate均NOT_RUN。

回退本卡清单内的差异即可恢复原展示，无数据库迁移或持久开关回退。未提交工作树、当前编译候选和所有原FAIL/NOT_RUN/诊断证据保留；自有运行资源结果见最终核验段。

## 前一交付核验与资源（独立初审前）

最终Windows本地对象为上述`78f7ee…`输入/`ac71b9…`manifest。Node.js 24.18.0、PostgreSQL 18.4；无项目依赖安装。最后一次源码变化只增加收件箱测试的控件渲染提交等待：`final-test-comparison.json`确认全部生产产物（PC/H5/后端）逐字节未变。按ADR-0053关闭直接风险后停止扩验，未重新运行无新影响的54入口，也不把先前325条结果改绑至当前候选。

| 最终检查 | 结果与外部原件 |
| --- | --- |
| `migration:build` | PASS，`build-render-ready.log`；strict emit、PC/H5构建及922个Node语法检查完成。保留原大chunk提示。 |
| `gate.mjs types` | PASS，`types-render-ready.log`；strict、负向类型、PC/H5类型、Stylelint 0、ESLint 0、设计变量undefined/primitive leak 0。 |
| 当前直接风险回归 | `direct-render-ready/summary.json` PASS，4入口106/106，零FAIL/SKIP/TODO/取消；基础74、收件箱契约7、Card12浏览器13、收件箱浏览器12。所有原业务断言保持。 |
| 既有更广路径回归 | `remaining/summary.json`为前一`3f9878…`候选的54入口325/325 PASS；最终局部结果与旧结果不相加为单候选计数。 |
| 选择器/属性/断言保留 | `preservation-check.json` PASS，6个改动文件旧项缺失0；静态差异与当前真实浏览器检查分别记账。 |
| 制品核验 | `verify-final.log` PASS，`ARTIFACT_VERIFIED_NOT_ACTIVATED`，manifest与当前回归及截图回执一致。 |
| 文档检查 | `docs-agents-final.log`预算/链接PASS；`docs-tool-final.log`20/20 PASS，零跳过。 |
| 截图 | [六图与实测](../../docs/ui/evidence/v217-card26/README.md)；当前回执SHA-256及尺寸核验通过，Windows主视口scale/DPR均1，气泡局部2倍，目标气泡内容完整。 |

`final-local-summary.json`列明最终4入口路径、数量、21个仓库变更文件、白名单外差异0，以及独立的前一候选54入口结果；`full_path_plan_pass_on_final_manifest=false`明确表示未冒称新候选全路径执行。没有运行或声称full/certify、CI、Electron或业务Gate。

资源：原超时留下的两个UUID合成库在核验本任务data目录与零连接后精确删除，`pg-cleanup-final.log`保留动作；`pg-final-baseline.json`只剩postgres/template0/template1、其他客户端0。自有PG已停止，`pg-stop-receipt.json`为pg_ctl status=3、55486监听0；停止后的data目录保留。

`owned-resource-audit.json`核查210份自有Job记录，活动0、已关闭记录残留进程0。早期总超时中一个嵌套浏览器Job没有写出原`closed.json`，没有伪造该回执：`incomplete-job-observation.json`按创建时间复核21个已记录成员，存活0，owner/supervisor均不存在；其父Job原TIMEOUT回执确认强制清理后活动0。该异常Profile及全部原件保留供复核，其他任务/用户浏览器未清理。

最后保留本卡未提交工作树、锁版依赖Junction（不删除目标）、当前`.build`、六图与全部原始失败/诊断证据；无运行中的本卡PG、HTTP或测试浏览器。

## 2026-11-06 多代理独立审查后继

用户追加授权：使用code-review Standards/Spec及Open Code Review delegate等多个独立子代理审查本地卡26，发现问题修复复验，仍不提交、推送或创建PR。Root固定前述21文件字节及基线702f80d6；本地无新提交，故三点HEAD差异为空，实际审查workspace diff及全部新增文件。

初审原件位于 `D:/CodexEvidence/pc-admin-v217-card26-review-20261106/`：`review-input.json`、`review-input.patch`、`snapshot/`、完整用户需求、规范导航及三个独立报告。OCR CLI v1.13.6执行preview/rule，原生选中8项；因扩展名或二进制排除的13项另行补审，delegate覆盖21/21、跳过0，没有调用OCR远端LLM。三路初审互不读报告；全部收口后Root才修改源码。

各轴原评级分别保留：Standards 2项（P2/P3）、Fowler判断项0；Spec 3项（P2/P2/P3）；OCR 1项medium/P2。对应三个修复点：

- R1/D4：1000/950/901px、展开侧栏时核心句与216.5px动作区实际交叠；原scroll/client均158仍能漏报。Root原制品复现与截图在`d4-width-probe.*`，901px图明确显示遮挡。修复为固有最小宽度布局：姓名/状态两轨grid、段落min-content、横幅可换动作行，原三宽度保持同排行为。
- R2/D6：1366/1360px、产品缺资料回退名「报修人」且无科室时，渠道118px被父行裁切；右界765.90625超过父行750/746。修复取消p的inline-size containment，科室0基础宽度分配剩余空间，让渠道参与身份区的固有宽度预算。
- R3/D1证据：生产圆角数值正确，原incoming图却截掉右角。旧截图未转换页面滚动坐标（实测scrollY=16），且仅按li范围及clip.scale2采集。修复改为实际背景目标的document包围矩形、space-1外距、局部DPR2/visualViewport.scale1/clip.scale1，并断言完整包含性；主三图仍DPR1。

`triage-initial.md`记录Root复现、CSSOM诊断（明确不是正式源码验收）及探针失败。Root唯一写生产CSS/规范，原测试实现子代理仅更新收件箱测试；三路审查代理保持只读。回归增加10档等待横幅二维遮挡/边界与姓名非零宽断言、1360/1366/1440回退姓名渠道场景、实际气泡裁剪包含性，保留旧断言和原超时。修复后输入、构建、测试、重采回执、独立复核和资源收口按实际另记，不预填PASS。

### 修复候选本地复验

- `build-fix.log` PASS，strict emit、统一PC/H5构建、922个Node语法检查完成。`types-fix.log` PASS，含Stylelint 0、ESLint 0、设计变量undefined/primitive leak 0、strict与负向类型。
- `related-fix/`保留首轮93 PASS/1 FAIL及收件箱NOT_RUN：本卡分类、内描边等断言已通过，旧Card20随后在「已超时」筛选的选中等待处超时。没有改产品、断言、时限或公共helper。
- 同一输入/manifest串行补跑：`inbox-fix/`12/12 PASS；`board-fix/`13/13 PASS。与首轮基础74、契约7去重，共4入口106/106 PASS，零SKIP/TODO/取消；不把两次Card12或其他候选重复累计。原筛选等待失败保持，未宣称修复该间歇现象。
- D4的10档宽度全部status/client/scroll=158且二维遮挡false、状态与操作均位于横幅内。901px姓名仍有45px、按钮独立下一行；1000/950亦自动换行；1440/1920维持同排。D6回退名「报修人」在1360/1366/1440均完整渠道118px，父行不再裁切，选择器分别218.09375/224.09375/240px。
- D1仍无需改生产圆角；新局部图为incoming660×284、outgoing660×144，主三图仍DPR1/scale1，局部DPR2/scale1。采集前核目标背景可视、document坐标包围区域完整包含与4px外距，PNG尺寸为CSS裁剪宽高的2倍。初版图和原回执保留在初审`snapshot/`，本目录六图/metrics/receipt按修复候选重采。
- 初审前106及更早325结果继续按原输入记账；本轮没有运行CI/full/certify/Electron/真实发送/部署或业务Gate。独立复核与自有资源收口另按实际追加。

### 独立最终复核与交付

三个只读审查代理分别复核固定输入`review-fixed.json`及`snapshot-fixed/`中的21/21文件、修补增量、六张新图和原始验证记录，均未读取其他代理的报告。Root之后只补写本记录的状态与本节，不修改生产、测试、规范或截图；最终字节差异另记`review-closeout.json`，不声称补记后的记录仍等于审查前快照。

| 独立轴 | 初审原结论 | 最终结论与原件 |
| --- | --- | --- |
| Standards | 2项：P2横幅遮挡、P3气泡证据裁切；Fowler判断项0 | 原2/2闭合；剩余硬违规0，新增0，Fowler判断项0。`standards-final.md`。 |
| Spec | 3项：P2横幅遮挡、P2回退姓名渠道裁切、P3气泡证据裁切 | 原3/3闭合，剩余0，新增0。`spec-final.md`。 |
| Open Code Review delegate | 1项medium：气泡证据裁切 | 原1/1闭合；critical/high/medium/low均0，原生8项+补审13项，跳过0。`ocr-delegate-final.json/.md`。 |

三轴分别保留原评级，不合并或重排审查结论。delegate独立解码两张局部PNG，图外边界像素全白，目标四周至少8个物理像素外距；独立重算十档横幅及三档header矩形，无交叠/裁切。原初审报告、旧裁切图和探针失败均保留在外部证据目录。

当前编号清单：

- D1：已确认生产圆角无需修改；已修复截图采集。incoming首条4/12/12/12px、后条全12px，outgoing对称；660×284/660×144的2倍局部图完整包含背景、文字与四角。
- D2：已完成。共用函数0秒/59秒「刚刚」、60秒「1 分钟」，单测3条通过，热度规则未改。
- D3：已完成。合成私聊省略0群项，多来源保持「至少8个群」语义，状态行无独立「0 个」项。
- D4：已完成。十档宽度核心scrollWidth/clientWidth均158px、二维遮挡false；901px姓名45px，动作下一行与核心间距8px；1440/900/1920保持同排，1920三段可见。
- D5：已完成。链接与关联卡片left均1153px，差0px，padding-left=0px。
- D6：已完成。1360/1366/1440回退姓名下选择器218.09375/224.09375/240px，渠道118px完整位于父行；长科室场景仍通过。
- D7：已完成。1440看板可见4个业务域/4种分类色和未分类，分类映射未改。
- D8：已完成。三泳道outline none/0px，1px inset阴影透明度0.05，全部取Token。

本轮最终检查：`migration:build`、`gate.mjs types`、Stylelint 0、ESLint 0及`verify-artifact.mjs`均PASS，制品为`ARTIFACT_VERIFIED_NOT_ACTIVATED`；当前同候选相关测试74+7+13+12=106/106 PASS。文档预算/本地链接PASS，文档校验工具20/20 PASS，`git diff --check` PASS。原`related-fix/`旧筛选等待失败与收件箱NOT_RUN仍保存，没有宣称间歇失败已修复，也没有将旧候选325条改绑到当前候选。

六项自检复核：

| 自检 | 是 / 否与证据 |
| --- | --- |
| 只改本卡允许文件，26不改后端/契约 | 是。最终仍为原21文件范围；`fix-validation.json`白名单外/后端/契约/依赖差异0。 |
| 没有新增/修改业务命令、状态、权限、迁移或依赖 | 是。修补只涉及会话CSS、新展示断言、截图和规范记录；既有控制器、事件时间守卫与写入命令保持。 |
| 27A默认新形状且不新增兼容开关 | 否（本卡不适用）。没有执行27A或修改接口/解析层。 |
| 27A S1–S4触发时停止写入侧 | 否（本卡不适用）。没有进入27A写入侧或据此作通过声明。 |
| 测试选择器与业务断言只增不减 | 是。6文件旧项静态缺失0，全部原业务入口通过；新增二维遮挡、渠道包含和完整裁剪断言，原时限不变。 |
| 数值验收项都有实测值 | 是。当前`metrics.json`、`receipt.json`、四入口原始报告及三个独立复核报告对应以上D1–D8值。 |

本轮自有52份Job回执均COMPLETED，活动0、残留进程0（`resource-audit.json`）。PG核实data目录及零业务库/其他客户端后停止；`pg-stop-receipt.json`为pg_ctl status=3、55486监听0，停止后的数据目录保留。旧轮210份Job及缺失原关闭回执的异常记录继续按前一交付说明保留，不覆盖旧缺口。

所有报告集中于`D:/CodexEvidence/pc-admin-v217-card26-review-20261106/`。交付为Windows本地合成验证及独立审查；未提交、未推送、未创建PR，未运行CI/full/certify/Electron/现场写库/真实发送/部署/业务Gate。规范补充了横幅固有宽度不足时的动作换行、渠道参与固有宽度预算；无需新增ADR。

### 2026-11-06 发布授权后继

用户明确授权本卡提交、推送、按pr skill创建PR并请求`@codex review`；继续跟进CI及意见，修复复验后以merge commit合并，再快进本地main、清理本卡本地/远端分支和工作树。该授权替代前述本地阶段的“未提交”停止点，不扩大现场发送、业务写库、部署或Gate范围。

发布前远端main核实仍为702f80d6，当前生产/测试/截图字节保持独立复核对象，仅本记录增加状态与授权说明。远端PR、精确head、CI、审查线程、合并及清理结果在`D:/CodexEvidence/pc-admin-v217-card26-pr-20261106/`按实际追加；未执行项不预填完成。主目录仍由卡27A使用，不切换或清理其分支与未提交内容。
