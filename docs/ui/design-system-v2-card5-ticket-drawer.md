# 设计系统 v2 · 卡 5：工单详情抽屉

日期：2026-11-01（Asia/Shanghai）。本地视觉层任务；不提交、推送或创建 PR。

## 1. 改动与边界

按设计系统 §6.8、§6.9、§8.2 收敛详情：720px 浮动抽屉，顶部及右侧 8px，12px 圆角、shadow-4、24px 内边距；标题 16/600。标题下左侧显示原状态与催单，右侧放派单 secondary 和当前合法主操作 primary；取消放入“⋯”。顶栏保留原导航和关注入口。

待接单时沿用原接单按钮作为主操作；处理中沿用登记完工。原权限与 Feature Flag 决定是否显示入口，不为只读、无合法动作、结束状态或特殊看板动作模式伪造完工能力。原看板动作模式继续使用原受保护表单。

报修描述、报修资料、报修人通知、处理记录及可折叠的处理与协作采用同一 Section：14/600，上 24、下 8，不加区块分割线。属性名 112px、13px secondary，值 14px，位置和电话同排、报修时间独占一行；窄阅读列自动单列。缺失位置/电话使用既有 tertiary Token。

处理记录使用 Timeline：按日分组，20px 头像，姓名 13/500 纯文字，正文 13px，内部/报修人可见为 12px tertiary 后缀，时间 12px。保留展开完整记录和 PersonalReadMaterial 的原授权、阅读及媒体遮挡条件。状态变更使用既有 status-map 的圆点状态。

通知采用 §8.2 允许的摘要方案：铃铛 + 通知节点，路由/发送状态/尝试次数/副作用结果/时间在可换行摘要中显示，轮次、节点及所有 Delivery 继续完整保留。通知 tone 只在 status-map 定义。

“⋯”使用原生 disclosure，折叠后不卸载命令持有者；Escape 只收起菜单并返回触发器，点击外部收起。催单展示通过 portal 放入标题下插槽，报修资料区仍是唯一 useWebReport 查询持有者，不增加查询或复制恢复状态。头像继续复用原获权读取、缓存、blob URL 生命周期；仅将外观交给已有 Avatar，缺图使用姓名末字及四组稳定哈希色。

输入/输出为原 Workbench DTO、props 和命令；无数据库、Schema、API、请求参数、权限、Ticket 状态、Query/Zustand、草稿、UNKNOWN、实时事件或默认持久 Flag 变更。50 处查询/命令/授权相关调用表达式逐项比对一致；这项静态比对与实际浏览器回归分别记账。

## 2. 文件清单

| 操作 | 文件 | 说明 |
| --- | --- | --- |
| 新增 | app/pc-admin/src/design/components/Drawer/Drawer.tsx | 抽屉、操作行及保持挂载的更多操作 |
| 新增 | app/pc-admin/src/design/components/Drawer/drawer.css | 浮动尺寸、动效、动作布局、sticky 备注及语音表面 |
| 新增 | app/pc-admin/src/design/components/Section/Section.tsx | 普通及受控可折叠分节 |
| 新增 | app/pc-admin/src/design/components/Section/section.css | 统一标题字重、灰度及上下间距 |
| 新增 | app/pc-admin/src/design/components/PropertyList/PropertyList.tsx | 属性表与缺失值展示 |
| 新增 | app/pc-admin/src/design/components/PropertyList/property-list.css | 112px 属性名、双列/单列与长文本 |
| 新增 | app/pc-admin/src/design/components/Timeline/Timeline.tsx | 分组记录、头像轨道和通知摘要 |
| 新增 | app/pc-admin/src/design/components/Timeline/timeline.css | 纯文字姓名、范围后缀及通知换行 |
| 修改 | app/pc-admin/src/design/components/Avatar/Avatar.tsx | 接受原获权 blob 图像，保留既有姓名哈希 |
| 修改 | app/pc-admin/src/design/components/Avatar/avatar.css | 图像填充头像容器 |
| 修改 | app/pc-admin/src/design/status-map.ts | 集中定义通知状态 tone |
| 修改 | app/pc-admin/src/app/Workbench.tsx | 组合抽屉、属性、分节和动作插槽 |
| 修改 | app/pc-admin/src/app/DetailPresentation.tsx | 完工入口及 Timeline 组合，姓名不再内联着色 |
| 修改 | app/pc-admin/src/app/ActorAvatar.tsx | 保留原图像读取，组合设计 Avatar |
| 修改 | app/pc-admin/src/app/WorkbenchDisclosure.tsx | 详情分节可选择统一 Section 展示 |
| 修改 | app/pc-admin/src/app/heroui-workbench.css | 移除已迁入 Timeline 的旧覆盖 |
| 修改 | app/pc-admin/src/style.css | 移除旧记录、姓名胶囊及失效动作布局规则 |
| 修改 | app/pc-admin/src/features/attachments/ReportMaterialsSection.tsx | 统一 Section；原催单内容投射至标题插槽 |
| 修改 | app/pc-admin/src/features/web-report/WebReportUrgency.tsx | 使用既有 Tag 和集中 tone，保留旧 class |
| 修改 | app/pc-admin/src/features/ticket-round-notifications/TicketRoundNotifications.tsx | 原轮次/路由完整摘要化，查询不变 |
| 修改 | app/pc-admin/src/features/ticket-assignment/TicketAssignment.tsx | 仅切换 Button 视觉适配层与 tone props |
| 修改 | app/pc-admin/src/features/ticket-handling/TicketSelfHandling.tsx | 原接单按钮设为主操作，控制器不变 |
| 修改 | app/pc-admin/src/features/ticket-handling/TicketConversationHandling.tsx | 原接单按钮设为主操作，控制器不变 |
| 修改 | tests/helpers/heroui-workbench-controls.mts | 实际展开更多菜单；区域按钮计数包含独立详情 |
| 修改 | tests/workbench-detail-restructure.browser.test.mts | 检查标题下动作及折叠后持有者身份 |
| 修改 | tests/workbench-detail-media.browser.test.mts | 新属性布局、头像末字；Tab 顺序纳入 summary |
| 修改 | tests/workbench-activity-actors.browser.test.mts | 姓名中性，头像哈希稳定，原 READ 丢失清除保持 |
| 修改 | tests/t24-round-notifications.browser.test.mts | 摘要换行及铃铛；原轮次/路由/发送断言保持 |
| 修改 | tests/workbench-toast-feedback.browser.test.mts | 新动作容器下继续测真实按钮，禁止空集合通过 |
| 修改 | tests/t04-self-handling.browser.test.mjs | 抽屉宽度精确断言更新为 720，原权威拒绝断言保留 |
| 修改 | tests/t05-conversation-handling.browser.test.mjs | 两处宽度精确断言更新为 720，原双责任断言保留 |
| 修改 | tests/t06-assignment.browser.test.mts | 宽度精确断言更新为 720，原派单/转派断言保留 |
| 修改 | tests/t07-atomic-start.browser.test.mts | 宽度及截图名称更新，原原子接管断言保留 |
| 修改 | tests/t11-completion.browser.test.mts | 完工用例的宽度断言更新为 720 |
| 修改 | tests/t12-production-form.browser.test.mts | 宽度及截图名称更新，原接管完工断言保留 |
| 修改 | tests/t35-normal-long-material.browser.test.mts | 真实菜单/弹窗指针交互，保留焦点恢复和可见阅读断言 |
| 新增 | docs/ui/design-system-v2-card5-ticket-drawer.md | 本地交付、失败记录和后继卡条件 |

删除文件：无。未新增依赖，包声明、根锁、Stylelint 配置及 AGENTS 相对本卡起点均未改变。卡 0–4 的未提交成果保留。

## 3. 前后对照

同一个现有 DetailRestructure 合成夹具，先加载本卡起点保留的正式 bundle，再加载最终正式 bundle。1920/1440/1280/900 均采集顶部和处理记录，共 16 张前后配对图；另有四宽组件状态图。采图窗口内 0 POST，准备阶段的动作只发生在隔离合成库，externalSendEnabled=false。

| 部位 | 改前 | 改后 |
| --- | --- | --- |
| 外形 | 780px、贴边、直角 | 720px、浮动 8px、12px 圆角、shadow-4 |
| 顶栏/动作 | 完工挤在顶栏，派单在属性下 | 顶栏保留导航；状态左、派单和完工右 |
| 其他动作 | 取消混在属性下面 | “⋯”收拢，控制器保持挂载 |
| 分节 | 多处分割线，可折叠标题较弱 | 同一 Section，14/600、上24下8 |
| 属性 | 多套宽度及标签样式 | 112px 标签、统一灰度、来源纯中性文字 |
| 人名/范围 | 彩色姓名胶囊、内部描边 | 13/500 姓名、12px tertiary 范围后缀 |
| 通知 | 独立蓝点横向时间线 | 铃铛摘要、发送状态 Tag、可换行 |
| 备注/语音 | 备注随长页滚动，语音透明底 | 底部 sticky 备注，语音 bg-subtle/8px |

| 宽度 | 改前 | 改后 | 最终 x/y/宽/primary |
| ---: | --- | --- | --- |
| 1920 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card5-20261101/screenshots/before-top-1920.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card5-20261101/screenshots/after-top-1920.png) | 1192/8/720/1 |
| 1440 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card5-20261101/screenshots/before-top-1440.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card5-20261101/screenshots/after-top-1440.png) | 712/8/720/1 |
| 1280 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card5-20261101/screenshots/before-top-1280.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card5-20261101/screenshots/after-top-1280.png) | 552/8/720/1 |
| 900 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card5-20261101/screenshots/before-top-900.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card5-20261101/screenshots/after-top-900.png) | 172/8/720/1 |

最终配对图为了直接检查催单搬移，给浏览器的既有 web-report 合成响应注入 active=true/count=2；这只是展示夹具，不是数据库中的真实催单或送达事实。无催单版本另保存在 screenshots-values-no-urge 与 capture-values-no-urge.json。

测量对象为有权处理中场景。各宽抽屉及文档无水平溢出，标题 16/600，记录姓名 13/500、背景透明。第一轮图和测量保存在 screenshots-initial 与 capture-paired-initial-result.json；最终图已人工逐宽核对。

## 4. Stylelint 度量

在 app/pc-admin 实际运行 `npx.cmd --no-install stylelint "src/**/*.css" --formatter json`，复用锁定的 Stylelint 核心 CLI。不安装依赖、不修改规则。31 个 CSS 文件，沿用原配置忽略 2 个登录文件，实际检查 29 个，0 违规。

| 规则 | 卡 4 | 卡 5 |
| --- | ---: | ---: |
| declaration-property-value-allowed-list | 0 | 0 |
| color-no-hex | 0 | 0 |
| unit-disallowed-list | 0 | 0 |
| declaration-no-important | 0 | 0 |
| function-disallowed-list | 0 | 0 |
| color-named | 0 | 0 |
| 总计 | 0 | 0 |

## 5. 验证、失败与未运行

最终构建输入指纹：c6a9ccd3c30f0786a0912bc0c4c3aac9fa8cd0b6f3463032c76aaae2e2dfaaa9。HEAD 仍为 8ad55a19bf5d3ab6d46e534c345cea17eb634e8a；对象是该 HEAD 上的本地脏工作区，前卡变化也在构建中，不把 HEAD 本身称为已含本卡。

已通过 `npm run migration:build`：911 strict 模块、911/911 Node 语法检查；`node .build/tools/gate.mjs types` 通过 CSS、完整 strict、负向类型检查。焦点修正及属性值最终归到 14px 后，重新采集四宽截图、重做组件状态检查和相关注册回归；本次以 build-manifest-values.json 记录的候选收口。四宽另明确断言来源和报修时间均为 14px。最终结果如下；17 个入口均在这一最终候选上实际执行，不拼接早期生产候选的通过结果。

| 最终检查 | 结果 |
| --- | --- |
| npm run migration:build | PASS；911 strict 模块，911/911 语法检查 |
| node .build/tools/gate.mjs types | PASS；CSS、完整 strict、负向类型检查 |
| node .build/tools/verify-artifact.mjs | ARTIFACT_VERIFIED_NOT_ACTIVATED |
| 相关注册浏览器入口 | 17 入口，42 tests，42 PASS，0 FAIL / SKIP / TODO / NOT_RUN |
| 四宽截图 | PASS；16 张前后配对图 + 4 张组件状态图；0 POST |
| 原调用/钩子比对 | PASS；50 处查询/命令/授权表达式一致，旧静态 class/data 名称无缺失 |
| Stylelint | PASS；31 文件，2 个原登录忽略，29 个实际检查，0 违规 |
| 自有资源 | PASS；合成库剩余 0，其他客户端 0；PG18 已停止，浏览器资源均 0 |

汇总：[validation-delivery.json](/D:/CodexEvidence/pc-admin-design-v2-card5-20261101/validation-delivery.json)；资源：[cleanup.json](/D:/CodexEvidence/pc-admin-design-v2-card5-20261101/cleanup.json)。普通日常 v3-p09 的相关已注册子集和风险追加；不是活动全集、full、certify、CI、现场或用户接受状态。

| 实际注册入口 | tests / PASS |
| --- | --- |
| tests/workbench-detail-restructure.browser.test.mts | 2 / 2 |
| tests/workbench-detail-media.browser.test.mts | 1 / 1 |
| tests/workbench-activity-actors.browser.test.mts | 1 / 1 |
| tests/t24-round-notifications.browser.test.mts | 2 / 2 |
| tests/workbench-toast-feedback.browser.test.mts | 1 / 1 |
| tests/t04-self-handling.browser.test.mjs | 6 / 6 |
| tests/t05-conversation-handling.browser.test.mjs | 10 / 10 |
| tests/t06-assignment.browser.test.mts | 1 / 1 |
| tests/t06-assignment-recovery.browser.test.mts | 2 / 2 |
| tests/t10-cancel.browser.test.mts | 1 / 1 |
| tests/t10-unknown-recovery.browser.test.mts | 1 / 1 |
| tests/t11-completion.browser.test.mts | 7 / 7 |
| tests/wbint-t42-board-legal-action.browser.test.mts | 1 / 1 |
| tests/t07-atomic-start.browser.test.mts | 1 / 1 |
| tests/t12-production-form.browser.test.mts | 2 / 2 |
| tests/t35-normal-long-material.browser.test.mts | 2 / 2 |
| tests/t35-normal-web-visible.browser.test.mts | 1 / 1 |

组件状态夹具覆盖 hover/pressed/focus-visible、disabled、loading、空值、超长标题/属性/记录、展开/收起、原控件持续挂载、Escape、通知 success/danger 文字与 reduced-motion。机械设计扫描结果 []，不代替浏览器验证。

失败原件全部保留：

- 构建包装最初误用不存在的仓库内 npm 路径，未进入构建；首次实际构建在测试说明的单引号上 strict emit 失败。修正说明后成功。另一次前端类型检查误用 cwd 下的 tsc 路径，随后从根入口通过，未作为产品失败或 PASS。
- 首轮相关浏览器批次：详情重构 2/2 PASS，媒体 1 FAIL，后续 3 个入口 NOT_RUN。媒体失败在新菜单出现后，原 Tab 前驱枚举漏了原生 summary；悬停路径和图像/布局已通过。将 summary 纳入真实键盘顺序后重跑，原 tooltip、原图下载、身份及读取断言保留。
- 初次视觉检查发现自动聚焦的非交互 dialog 容器有整圈焦点框、附件标题叠加旧内边距、sticky 备注底部裁切。统一修正。仅取消非交互容器的开场外框，按钮、菜单和字段的键盘焦点环继续检查。
- 组件夹具首次在 hover 的 120ms 过渡开始前立即取色，读取到默认蓝。改为等待浏览器实际达到 hover 色；原按下/焦点/disabled/loading 等断言不变，最终通过。夹具失败图、JSON 及日志保留。
- 静态比对脚本曾误用 Windows ESM 路径、编译器包入口以及只解析字面量 class 的方法；修正工具后按实际组合类名比对通过。工具错误不记为产品缺陷。
- 后继批次保留 3 PASS / 1 FAIL / 后续 10 入口 NOT_RUN：新增头像色断言误要求三个人至少两种颜色；当前夹具未启用头像读取，API 不返回 actor_ref，姓名回退哈希允许碰撞。改为核验四组色类、20px、同名稳定和至少三个真实姓名；原同页刷新、CSP、权限丢失清除不变。修正后该入口通过。
- 下一批保留 5 PASS / 1 FAIL / 后续 9 入口 NOT_RUN：通知路由的旧后代选择器 `p span:first-child` 同时读取到新 Tag 的内部 span。改为 `p>span:first-child`，继续精确断言两个路由及各自状态。业务发送次数、事实重读和数据库数量断言未变。
- 余项批次保留 6 PASS / 1 FAIL / 后续 7 入口 NOT_RUN：T04 仍要求原 780px 抽屉。全量扫描测试后，六份文件的明确宽度统一为 720，未改宽度以外的业务预期；T07/T12 因而加入相关注册入口清单。
- 阅读补充批次保留 1 PASS / 1 FAIL / 网页阅读入口 NOT_RUN：完整前台滚动长正文已通过，取消弹窗关闭后焦点未返回原按钮。用例原先虚拟点击了收起菜单中的隐藏按钮；同时检查发现真实点击弹窗也会让外部点击监听提前收起父菜单。改为真实打开菜单、点击取消和弹窗输入框，保留原焦点/遮挡/阅读断言，并修正展示监听：子 dialog 可见时不收起父菜单，子 dialog 的 Escape 由其自身处理。命令与阅读控制器不变。

## 6. 规范适用范围

通知使用规范明示的摘要替代方案，保留轮次而不与处理记录重新混排时间。静态 Section/PropertyList/Timeline 不伪造提交、pressed 或 loading 行为；由调用方的原加载与空态提供相应内容。交互组件的适用状态已检查。

未增加规范外颜色、字号、圆角或阴影，不需要规范补充确认。保留兼容资料中的“未记录”“姓名暂不可用”等原事实文案，避免把历史未记录或暂不可用统一说成用户未提供；缺失位置、电话使用未提供。API 未返回人员 ID 时沿用姓名哈希，不增加身份读取。头像末字使用规范 §6.13；旧 `status-chip`、`orange` 等 class 保留为语义/测试钩子，实际新外观由 Tag 和集中 tone 映射决定。

未运行 Electron 原生、真实企业微信、真实 SSO、现场发送、部署、full/certify 或业务 Gate。本地合成结果不表示这些通过。

## 7. 自检与交接

本地技术完成，保留未提交状态。自检如下：

| 自检项 | 是/否 + 证据 |
| --- | --- |
| 只改视觉，无业务行为/请求/状态变更 | 是；50 处关键调用逐项一致；42 项实际浏览器测试 |
| 保留测试 class/data，不削弱业务断言 | 是；静态钩子无减少；仅适配视觉/真实交互，精确 UUID、版本、权限、路由与次数断言保留 |
| 新 CSS 无裸色/裸字号/裸圆角/important | 是；Stylelint 0，配置不变 |
| 每个可见区域 primary ≤1 | 是；四宽处理中抽屉恰 1；无合法动作/只读/原特殊动作模式不伪造按钮 |
| 适用的 hover/focus/disabled/loading/空值/长文本 | 是；组件状态检查、真实指针/键盘和长正文可见阅读回归 |
| 四宽截图核对 | 是；1920/1440/1280/900，几何及字体断言与人工核图，外层无水平溢出 |
| 没有自行发明规范外视觉值 | 是；沿用 v2 Token，无需补充新值 |

PG18 max_connections=8；停止前只有 postgres/template0/template1，其他客户端 0；pg_ctl status=3，无 postmaster.pid，任务端口和主 PID 均已关闭。保存原失败/NOT_RUN、源码起点、各轮图片、最终 manifest 和停止后的自有 PGdata；未清理用户或其他任务资源。下一张卡 6 的技术前置已满足，本次未启动卡 6，也未提交/推送/建 PR。

回退按逐文件 source-before 原字节撤回本卡，并仅移除本卡新增的四个组件目录和交付文档；保留卡 0–4 及用户其他改动，不使用 reset/clean。无数据库回滚。

本卡不对外修改 GitHub Issues/业务 Backlog；本地卡状态记录在本文。卡 6 不自动启动。
