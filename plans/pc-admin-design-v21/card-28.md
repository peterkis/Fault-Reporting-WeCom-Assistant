# 卡28：工作台列表视图与卡26 / 27展示收尾

初次本地交付：2026-11-06（Asia/Shanghai），当时本地验证通过并停止自有测试资源，未提交/推送/PR。后继用户已明确授权独立审查、修复复验、提交推送、PR与Codex审查、合并及本卡分支/worktree清理；下列原交付回执保留原对象，后继过程见文末。

## 输入、所有权与停止线

- 最新HTTPS远端main与GitHub refs/heads/main均为 `728d9d9fa95edf7e911b8bd51891df5e802296a7`；从该点创建 `codex/pc-admin-v218-card28`，唯一写者为本会话，工作树 `D:/worktrees/pc-admin-v218-card28`。原工作树 `D:/Projects/Fault-Reporting-WeCom-Assistant` 保留在原分支，不切换或清理。
- 只修改允许的PC展示路径、相关测试/fixture和本卡规范/交付文档。用户另行明确授权将TicketCard原热度JSX提取为TicketHeat；看板调用位置、热度算法、Token和交互保持。
- 视觉来源为已跟踪的v2.2离线原型画布中的01c（主要）、01、01b及03；原件不改。只读展开副本集中于 `D:/CodexEvidence/pc-admin-card28/`，浏览器实际打开核对01c。
- 27C关闭原因、通用关闭、恢复与原单关联写入不实现；不改app/server、contracts、api/client.ts、状态值、权限或依赖。没有真实外发、现场库写入、部署或Gate授权。
- 复用根node_modules的只读依赖Junction，不递归清理该链接或目标。自有PG18仅监听127.0.0.1:55488，数据目录 `D:/CodexData/pc-admin-v218-card28-pg`，临时根 `D:/CodexTemp/pc-admin-v218-card28`；测试按既有helper创建和回收UUID合成库。

## 实现说明

采用原生table：一个thead、七列colgroup，阶段/子分组使用跨列行，编号使用scope=row，保留各阶段原列表可访问名称和row-link。原生表能直接表达跨列分组及列头/行头关系，避免为分组复制表格或引入新的表格状态。

列表通过现有BoardActionCard接入BoardActions和TicketSelfHandling；没有复制领取、命令权限或UNKNOWN恢复逻辑。路由、筛选、搜索/退出搜索、日期和游标继续调用原处理函数。已关闭偏好共用 `pc-admin:processed-group:{principal}:{completed|dismissed}`；只筛结束方式时列表及其详情导航仅使用已处理的可见集合。

合成fixture沿现有隔离SQL、Store/core以及response.end测试缝添加。`duplicate_of`当前真实服务投影仍为null；有原单的display_no、催单、待复核及缺失资料是本卡显式合成读取字段，receipt逐项列出，不能作为27C实现或真实数据来源证明。其它列表来源和命令终检仍走真实loopback HTTP/PG。

## 验证范围与停止条件

具体风险：跨列对齐/固定列、分组折叠与可见导航、悬停领取的原终检、搜索退出与原查询身份、日期分段单选、关闭元信息删除、会话分隔。沿ADR-0053先以路径策略和注册入口去重，补充原看板动作、搜索、日期及会话直接风险入口。合成测试不放宽业务断言。所选入口与数值验收通过即停止，不运行full/certify，不为纯记录重建候选。

日志、历史失败、计划及资源回执集中于 本卡外部原件（本机路径 `D:/CodexEvidence/pc-admin-card28/`），最终截图与机器实测见 [证据目录](../../docs/ui/evidence/v218-card28/README.md)。

## 过程失败（保留）

- 初次Stylelint检查7项FAIL（直接z-index、复合阴影及font-size:0等既有规则不允许的写法）；改为语义层组件局部Token和真实kbd/标签呈现，最终所有样式检查为0。原始输出保留在本聊天工具记录，未补造原始日志。

- build-01：新增测量用例的元组推断出现TS2538；改用固定只读元组，不降低strict。
- build-02与types-02：第一次完整候选构建/strict通过；其浏览器diagnostic-01在悬停领取等待超时。首次列宽/行高等实际结果保留于attempt-01，不能冒充最终候选。
- claim-diagnostic：命中测试确认HeroUI链接的相对定位使行覆盖停留在问题单元格，hover未进入原领取准备；只对列表row-link恢复静态定位及零padding，重用原控制器。
- build-03：R1移动版日期语义的aria-current显式undefined触发exactOptionalPropertyTypes；改用具名条件属性，不用类型逃逸或放宽配置。

- diagnostic-02：列宽、领取、不可领取行、键盘详情、偏好往返与R1/R2均通过；CDP Enter遗漏原生字符事件，搜索提交前提等待超时。补齐text=CR；并收紧kbd隐藏样式的优先级，防止全局kbd规则显示非领取行的E。
- build-04/05与types-04/05均通过。tests-01前三入口94/95 PASS，唯一FAIL是日期回归原API场景的排序期望：2024年关闭事件与动态当前时间的RESOLVED事件混用，后者按27A/27B的关闭证据排序排在前面。只固定该合成ticket.resolved事件为2024-02-28，原顺序、日期、权限、游标精确断言保持；其余60入口NOT_RUN，未冒称整批通过。
- 首批15图中的局部clip采用viewport坐标，页面有滚动时出现裁切偏移；保留原图于外部attempt-03，补入scrollX/Y并检查2倍PNG尺寸后重拍。全页图与DOM实测不受该导出坐标问题影响。

- tests-02：前28入口184/184 PASS，第29搜索入口1PASS/1FAIL，34入口NOT_RUN。失败仅为搜索视图仍要求移除日期控件的旧展示前提，已按27B B5的既有口径改为日期控件保留，并加range=all/column=pending精确断言；来源多选、已选/手填群标识及业务POST=0保持。历史FAIL与未运行清单保留。
- 收尾复核：按结束方式进入匹配子组时初始展开，随后仍允许用户折叠；此前强制展开覆盖了点击结果，现只在该次挂载初始化使用。沿原偏好键，不改查询或命令；补充折叠/展开及可见行归零断言。

- tests-03：前29入口186/186 PASS，第30长分页入口2FAIL、后33入口NOT_RUN。两个场景都停于点击紧凑工具栏中的隐藏submit；其前置已经由原“/”快捷键真实聚焦输入框。只将此步骤改为带原生字符事件的Enter提交，同一个form/onSubmit；50/51项、GET→POST、55秒刷新、原命令及状态断言均保留。最终后继仅补跑该失败入口及33个NOT_RUN入口；构建前后比较全部应用输出字节，分批回执/manifest不改绑。

- tests-04：34/34入口、270/270 PASS；与tests-03前29入口186项去重后，63/63入口456/456 PASS，0最终未完成。build-08/09的661个emit应用输出（不计测试、工具和SourceMap），其中231个PC输出字节相同，唯一emit变化为长分页测试。两批manifest和原FAIL分别保留。
- 最后标签复核补齐两种既有状态：非Ticket受理COMPLETED沿既有closure.kind=COMPLETED显示success/已完成；FAILED保留cardTags已有danger，不被阶段的neutral覆盖。只改WorkTable标签选择及Card28合成fixture/断言；后端、状态值、命令、权限不变。最后补跑直接UI/基础与严格/制品检查，63项回归继续保留原候选身份，不冒称单批新候选全回归。

## 编号验收与实测

| 编号 | 结论、位置与验收证据 |
| --- | --- |
| L1 | 已完成。Workbench/WorkTable替换三张表；原生单table/thead，七列192/292/108/124/188/124/92px，行左缘在三阶段一致。 |
| L2 | 已完成。阶段54、子组32、标签26、折叠按钮24×24/箭头14px；看板计算样式一致、已关闭偏好往返PASS，剩余按钮12px/左padding4px。 |
| L3 | 已完成。分类/完整mono编号、标题优先省略、Tag状态、共用TicketHeat、合并来源/报修人/位置、完整中文负责人、右对齐活动时间；可见列表未提供=0，缺失用—。 |
| L4 | 已完成。全部可见数据行44px；选中内描边2px、border0；当前可领取行只显示原take-and-start按钮和E，不可领取的活动/关闭/复核行无按钮或E；原生Tab/Enter及AX树补测PASS，打开原详情。 |
| L5 | 已完成。结束方式紧随处理人，gap8px；结束搜索X为16px、aria-label及onLeave保持；工具栏搜索前32/后32px，差0。 |
| L6 | 已完成。三值严格断言分别为三阶段/仅已处理·已完成/仅已处理·已关闭，且只出现对应子组；不改原请求、计数或游标。 |
| L7 | 已完成。900px横滚180px时首列left=16px不变；分组名仍可见；三个空阶段各显示暂无事项，只有一个共享thead。 |
| L8 | 已完成。至少四分类，待受理三种热度/催单/待复核，等待厂商，完成至少2项，人工/系统/重复有无原单、缺资料、长标题均有合成覆盖；真实原单关联仍为27C停止项。 |
| R1 | 已完成。BoardDatePresets全部日期、自定义与预设分别断言恰好1个aria-pressed=true；全部日期沿白底及shadow-2。 |
| R2 | 已完成。DismissedTicketCardBody不渲染元信息；同卡恢复旧行的测量为122→96px，减少26px，已完成仍保留元信息。该对照不冒称另一个HEAD的原截图。 |
| R3 | 已完成。ConversationInbox仅将分隔符标成独立元素，色为tertiary、左右space-1；会话注册入口实测断言文字为“ · ”、margin各4px。 |

1440各列实测总宽1120px；表格在工具栏宽1128px的区域内扣除滚动条，问题列取得292px剩余空间。完整DOM字段、截图尺寸和SHA在证据目录，不能用截图替代断言。

新增的四个shadow-list组件局部Token只组合既有border-hair/brand和间距，分别承载约7%行底线、2px选中内描边、固定列右线与组合选中线；现有全局阴影不覆盖这些用途。所有列宽用已有space Token组合；没有新增或更改tokens.css颜色值。

## 文件与规范

新增WorkTable展示组件与局部CSS；Workbench只替换列表及调整工具栏/列表可见导航；SearchControls仅列表退出搜索呈现；BoardSummary修正全部日期选中；TicketCard移除关闭元信息并按授权提取热度；ConversationInbox只改分隔符。相应测试随单表结构更新布局定位，权限/业务/UUID等有效断言保留。窄屏分组标题随首列保留可见；最终额外量测了阶段按钮和剩余项按钮，修正基类Button优先级导致的尺寸覆盖。

design-system.md新增v2.1.8列表章节，覆盖单表、列定义、分组、单元格、行状态、工具栏、结束方式和窄屏，补充日期选中、关闭卡片与会话分隔规则。tokens.css、分类映射、包文件和业务API无改动。

### 原生键盘与可访问树补测

注册Card28场景验证了焦点后的Enter，但单独程序focus不足以证明Tab顺序；另用同候选的既有fixture/浏览器helper补一个只读场景。实际从待接单组按钮按原生Tab进入ticket行的row-link（A、tabIndex=0），再按Enter打开原抽屉；业务POST=0。Chrome AX树实际给出1个命名table、7个columnheader、待受理/处理中/已处理3个命名rowgroup，以及含工单编号的rowheader。不是NVDA人工验收。原件 `D:/CodexEvidence/pc-admin-card28/keyboard-ax.json`；该缺口一次补测PASS即停止。

## 文件清单

### PC展示（8个文件）

- [app/pc-admin/src/app/Workbench.tsx](../../app/pc-admin/src/app/Workbench.tsx)
- [app/pc-admin/src/app/heroui-workbench.css](../../app/pc-admin/src/app/heroui-workbench.css)
- [app/pc-admin/src/design/components/BoardSummary/BoardSummary.tsx](../../app/pc-admin/src/design/components/BoardSummary/BoardSummary.tsx)
- [app/pc-admin/src/design/components/TicketCard/TicketCard.tsx](../../app/pc-admin/src/design/components/TicketCard/TicketCard.tsx)
- [app/pc-admin/src/design/components/WorkTable/WorkTable.tsx](../../app/pc-admin/src/design/components/WorkTable/WorkTable.tsx)
- [app/pc-admin/src/design/components/WorkTable/work-table.css](../../app/pc-admin/src/design/components/WorkTable/work-table.css)
- [app/pc-admin/src/features/conversations/ConversationInbox.tsx](../../app/pc-admin/src/features/conversations/ConversationInbox.tsx)
- [app/pc-admin/src/features/search/WorkbenchSearch.tsx](../../app/pc-admin/src/features/search/WorkbenchSearch.tsx)

### 测试与合成fixture（6个文件）

- [tests/conversation-inbox.browser.test.mts](../../tests/conversation-inbox.browser.test.mts)
- [tests/helpers/web01-workbench-fixture.mjs](../../tests/helpers/web01-workbench-fixture.mjs)
- [tests/pc-admin-card12.browser.test.mts](../../tests/pc-admin-card12.browser.test.mts)
- [tests/t41-search-production.browser.test.mts](../../tests/t41-search-production.browser.test.mts)
- [tests/t41-search-refresh-and-long-pages.browser.test.mts](../../tests/t41-search-refresh-and-long-pages.browser.test.mts)
- [tests/web01-closed-range.browser.test.mts](../../tests/web01-closed-range.browser.test.mts)

规范与交付：[design-system.md](../../docs/ui/design-system.md)、本执行记录、[证据README](../../docs/ui/evidence/v218-card28/README.md)。证据目录另有15张PNG、metrics.json、receipt.json，逐图清单及哈希见README/回执；总计34个路径。原件清单与源码块保全证明见 `D:/CodexEvidence/pc-admin-card28/scope-audit.json`。

## 六项自检

| 问题 | 是 / 否与证据 |
| --- | --- |
| 只改前端展示与测试合成数据，未改后端/契约/API形状/命令/状态/权限 | 是。scope-audit.json保护路径变化0；所有新读取字段仅存在于显式Card28 fixture，生产api/client.ts不变。 |
| 领取/详情/搜索/结束搜索/筛选复用原处理函数 | 是。原Card、BoardSection/ProcessedGroup、commitConditions至closure handler源码块逐字相同；列表组合BoardActionCard、原Link、onApply/onLeave及原筛选回调，未复制命令逻辑。 |
| 测试选择器只增不删 | 是。原Workbench data属性名称缺失0、row-link与原三个事项列表可访问名称保留；原精确权限、分页、原UUID与零写入断言保持。单表相关测试只更新结构定位；日期只固定合成事件时间。 |
| 样式经Token，Stylelint/ESLint为0，无新增依赖 | 是。types-10含Stylelint/设计变量/功能语法PASS；eslint-final.log按既有功能区max-warnings=0通过；包/lock/Token原值保护0变化。app与design代码另由strict验证，不冒称扩展了既有ESLint覆盖范围。 |
| 只改允许文件 | 是。34路径白名单外0；TicketHeat提取为用户明确追加授权，R3配套样式仅作用分隔符。没有其它卡片/会话/看板结构或业务接口改动。 |
| 数值验收都有实测 | 是。metrics.json含列宽、行高、分组、按钮、图标、工具栏、gap、shadow、900固定列、R2高度对照；R3有真实浏览器4px/颜色断言。15图均记录Win32/DPR1/zoom1及PNG尺寸/hash。 |

## 限制与回退

结果限Windows Chrome、DPR1/zoom1的本地合成环境；2倍局部由截图clip.scale=2生成。不能代替Electron、现场、用户接受或生产容量验证。CI、full/certify、真实发送、部署与业务Gate均NOT_RUN。所有未提交差异保留在本卡独立worktree；回退时按本卡明确文件清单撤销展示差异即可，无数据库迁移/持久开关回退。

## 最终本地验证与资源收口

最终源码为未提交的build-10，输入指纹 `d1a869cc06cecef08dd2569e1552f6c683f539244f084d0e7c51316f74563efa`，制品manifest `7cbe277b607a633ee98d4842836fd517158f865e74c01fe25b55e9c29e3c8f11`。基线HEAD保持728d9d9f；不把未提交差异冒充新提交或远端CI候选。

| 检查 | 实际结果 |
| --- | --- |
| migration:build | build-10.log PASS；922/922编译Node语法检查、2944制品，STAGED_NOT_ACTIVATED。保留原有大chunk提示，不把该提示记为lint失败。 |
| gate.mjs types | types-10.log PASS：完整strict、负向类型、PC/H5/Desktop检查；Stylelint 0、未定义变量0/原始Token泄漏0、既有功能语法检查PASS。 |
| ESLint | eslint-final.log按既有features范围max-warnings=0通过；最后变更未修改features源码，不冒称扩展到app/design全目录。 |
| 路径与直接风险回归 | final-tests.json：63入口去重456/456 PASS、FAIL/CANCEL/SKIP/TODO均0。tests-03前29入口186项，tests-04后34入口270项；两批不是一次全回归，原FAIL与NOT_RUN保留。build-08/09的661个emit应用输出含231个PC输出逐字节相同，SourceMap不在该比较中。 |
| 最终标签修复验证 | tests-final-ui/summary.json：最终build-10的2入口93/93 PASS，其中Card12真实浏览器17项、设计基础76项；含新增COMPLETED受理成功态/FAILED危险态断言，以及完整卡28数值与交互。没有把93重复累计入456。最终后端/shared/H5输出与前批无差异，UI/测试输出差异另记final-output-delta.json。 |
| 制品 | artifact-10.log：ARTIFACT_VERIFIED_NOT_ACTIVATED，与最终UI/strict同候选。 |
| 原生键盘/AX | keyboard-ax-final.log PASS；原生Tab→行链接→Enter抽屉、1个thead/7列头/3命名分组/编号行头，业务POST0；同候选独立补测，不计入456或93。 |
| 文档 | docs-final.log最终本地链接/预算PASS，docs-tool-final.log 20/20 PASS。 |
| 图片 | 当前15图全部来自最终build-10，DPR1/zoom1，2倍clip；receipt逐图尺寸/SHA、metrics完整，早期图另留原件。 |
| 自有资源 | 只剩postgres/template0/template1，无残留UUID合成库；PG状态3、监听0、自有运行进程0。原型工具页归about:blank；工作树、分支、构建、离线PG数据、原始证据与共享依赖目标保留，不递归穿越Junction。 |

CI、Electron、full/certify、真实发送、现场库写入、部署及业务Gate均NOT_RUN。完整历史失败、工具准备问题与证据偏差见上文，不因后继PASS删除或重绑。最终状态是LOCAL_SCOPED_VALIDATION_PASS，不表示现场/用户接受/生产就绪。

## 后继审查、修复与发布授权

用户在初次本地交付后明确授权使用多个独立子代理，通过code-review双轴与Open Code Review delegate审查、修复/复验、提交隔离分支、HTTPS推送、创建PR并触发@codex review；处理发现和CI后合并、快进本地main并清理本卡分支/worktree。此授权不启动27C写入侧、不部署/真实发送或改变业务Gate。

初审固定base `728d9d9fa95edf7e911b8bd51891df5e802296a7`，未提交工作区tree `27f120ee70dd74d8af459c79283501572b8410d5`。临时独立index纳入34路径，未提前提交；原件ZIP、patch、逐文件SHA及三路原始报告在 `D:/CodexEvidence/pc-admin-card28-publish-20261106/`。无Issue引用，不为本卡另造Issue。原工作目录处于27C独立进行中的脏分支，所有源码修补均在本卡worktree；main将通过临时隔离checkout原生快进，不切换或stash他人工作。

## Standards

独立初审34/34路径、0 skipped：硬性标准违例0；判断建议STD-J01/P3仅为合成标题数组重复。已改为一份titles数组，Store与Ticket标题共用。有限修复复核tree `52a8715a019547b2b57ebf1a889281fbff19d34e`：6补丁路径核对、28未变blob继承，总34/34，无新增/剩余标准问题。Fowler味道作为判断而非硬规则，未进行无需求重构。

## Spec

独立初审34/34路径、0 skipped，4项P2分别记录：SPEC-01父阶段折叠后结束筛选不展开；SPEC-02按视口判sticky遗漏1280实际窄容器；SPEC-03冻结编号格盖住整行原Link命中；SPEC-04八汉字负责人仍裁切。已分别修为父/子匹配组挂载初始展开、具名inline-size容器查询、冻结列10/原链接11/原领取12/表头40、保留13px/20头像/44行的两行姓名及完整title。独立有限复核确认4项源码闭合、无新增问题；运行证明单独补记，不用旧图替代。

## OCR delegate

真实OCR v1.13.6执行delegate preview/rule，host子代理实际审查：11 reviewed/0 skipped，另外23个unsupported_ext/binary排除项不计为已审。4项P2为OCR-M01父阶段展开、M02容器sticky、M03编号命中、M04列表子组呈现与详情prev/next次序不一致。前三与Spec重叠仍保留两轴各自报告；M04用orderWorkTableItems同时驱动列表普通/实时冻结序列，组内保留服务端顺序和全部已加载范围，看板原排序表达式不改。有限复核4项源码闭合，原11/23覆盖口径保持；没有宣称覆盖抽屉打开期间实际新增跨子组事项。

父代理另确认ROOT-CI01：新截图场景无条件要求Win32会阻挡Ubuntu PR运行。改为Windows进程仍严格断言Win32、其他平台如实记录平台，DPR/zoom/业务断言不变；Linux实际结果等待本PR CI。全部原状态/版本/责任/事件、READ/游标及零业务写入断言保留。

审查修补首轮构建/strict通过；定向运行已通过长姓名和普通/SSE冻结导航，随后R2对照读取因人工关闭样本按新确定性事件时间落到前三项外而取不到节点。只补真实“显示剩余”操作并等待该卡可见，不改变R2高度或业务断言。首轮FAIL/截图原件保留在review-diagnostic-01-evidence及review-diagnostic-01.log（后者在原本卡外部根）。后继构建review-02与定向复验进行中；最终对象及CI另记。


### 审查修复的本地收口

review-02构建/strict/Stylelint/设计变量及制品检查PASS；注册浏览器与设计基础2入口93/93 PASS（17+76），另两份T41测试2入口4/4 PASS，FAIL/CANCEL/SKIP/TODO均0。前者manifest `e90f4fbd8eac08f5a6d7f41778a2f460e36d756fe3141cc642418d310d691773`；后继仅修T41测试宿主约束，231个PC输出和全部emit应用输出（不含SourceMap/测试/工具）字节不变。93与4不重复加算原63入口456项，原各批次身份保留。

新实测：8字姓名框74×40px、scrollWidth=74/scrollHeight=40，13px字体、20px头像、44px行；1280视口容器client976/scroll1080/实际scrollLeft104仍冻结首列，900为client852/scroll1080/scrollLeft180。父阶段先折叠再筛选后自动展开及说明可见、编号格hover准备原领取并实际pointer打开原事项、真实SSE下已加载位置及双向邻项、完成→关闭边界邻项均PASS，业务POST0及状态/版本/责任/事件守恒。

ROOT-CI01补充：实际PR路径计划为database lane、60个入口，包含两份被本卡同步过的T41测试；它们原有的无条件D盘临时根约束同样不适用Ubuntu。保留Windows的原D盘断言，同时所有平台新增临时根必须绝对路径的约束，沿原helper的owned-temp/进程/连接清理，不放宽任何业务/传输/刷新断言。本地真实Windows4项通过；Ubuntu结果等待当前PR CI。

当前截图/metrics/receipt已替换为审查修复review-02的Windows原图15张，旧图/初审源码ZIP/首轮失败原件外部保留；仅测试宿主修补不更改图的候选绑定。跨平台修补构建/strict及制品检查原件为build-portability-01/types-portability-01/artifact-portability-01。后续提交/推送/PR/Codex与CI/合并/main快进/清理，以GitHub当前完整head与外部发布根的原生回执为准，未提前记录为已通过或已合并。
