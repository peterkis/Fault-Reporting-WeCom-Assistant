> **最新离线补验**：正式来源只用01–05（含04b），列头只用01；06–08排除。共享胶囊已校准，35入口单批178/178通过，见[离线验收索引](offline-reference/README.md)。下文保留前轮截图与原被测身份，不重绑到新候选。

# v2.1.2 卡 21 · 本地合成证据

基点 `f8959042ecf9e596a79cbb249ec7932451805ddb`（已合入卡20 / PR #142），分支 `codex/pc-admin-v212-card21` 的未提交工作区。当前实际源码输入指纹 `0057b764124dcae004312a1a06e2acaec72bee38ebec7d527b2f1cd734bab58e`；manifest SHA-256 `038c2f17ecfa526dc3b8d4f426d367cbed9859d9f8a16a447ff48b95275c3d61`。

本地 Node24 / PG18 / Chrome 正式生产 bundle + 真实 loopback HTTP + 既有隔离合成 fixture，外部 Sender 为合成实现。不是 CI、Electron、full/certify、现场、部署或 Gate 验收。未提交、未推送、未创建 PR。

## 四宽前后对照

改前直接使用已提交的 v211-card17 / v211-card19 图片；不改写其时点、数据、FAIL/NOT_RUN 或被测身份。左右原像素保留，只在上方增加44px说明栏。改后来自本次新合成数据，数据量与历史图不同，不作全页像素一致声明。

基点已包含卡20，因此相对v2.1.1的整体对照也会包含卡20既有改动；不将其归为卡21新增。工作台本卡只变更组件导入和两处胶囊调用，其它顶栏/看板区块保持。

| 宽度 | 工作台（G1） | 会话（C1–C10 / S10） | 通知有数据（S11 / N1–N4） | 通知空态（公共故障筛选为空） |
| --- | --- | --- | --- | --- |
| 1920 | [对照](compare-board-1920.png) | [对照](compare-conversation-1920.png) | [对照](compare-notifications-data-1920.png) | [对照](compare-notifications-empty-1920.png) |
| 1440 | [对照](compare-board-1440.png) | [对照](compare-conversation-1440.png) | [对照](compare-notifications-data-1440.png) | [对照](compare-notifications-empty-1440.png) |
| 1280 | [对照](compare-board-1280.png) | [对照](compare-conversation-1280.png) | [对照](compare-notifications-data-1280.png) | [对照](compare-notifications-empty-1280.png) |
| 900 | [对照](compare-board-900.png) | [对照](compare-conversation-900.png) | [对照](compare-notifications-data-900.png) | [对照](compare-notifications-empty-900.png) |

## 跨日、内部标识与控件状态

消息区有真实溢出，因此分别保留顶部的跨日顺序和底部的内部备注/系统事件截图。日期节点四宽都只有「昨天」「今天」，另有一次「切换到 Bot 私聊」，合计3个分隔项；消息正文和已读序号未重排。

| 宽度 | 顶部跨日与渠道（C2/C4） | 底部备注与系统时间（C3/C5/C8） |
| --- | --- | --- |
| 1920 | [顶部](chronology-1920.png) | [底部](conversation-1920.png) |
| 1440 | [顶部](chronology-1440.png) | [底部](conversation-1440.png) |
| 1280 | [顶部](chronology-1280.png) | [底部](conversation-1280.png) |
| 900 | [顶部](chronology-900.png) | [底部](conversation-900.png) |

- G1：[生效态](filter-active-1440.png)、[展开态](filter-open-1440.png)。实测Tab到独立×，Enter清除并回到原选择按钮；Enter/空格打开、Escape关闭已在注册浏览器入口通过。
- C9：[首页仅下一页](pagination-first-1440.png)、[末页仅返回最新](pagination-last-1440.png)。31个新增分页联系人均为合成资料；确实沿原next_cursor读取并可返回首页，没有浏览器业务POST。
- N4：原11条异常的注册测试仍核验第一页10条、下一页1条、精确详情GET、Sender调用11次与浏览器POST=0；仅将末页按钮断言改为隐藏。

## 尺寸实测（px）

坐标、边缘、控件/图标/表格/行高/内边距来自 `getBoundingClientRect()`。字号/字重/色值来自 `getComputedStyle()`；这两种证据分别记录，不把字体值冒充几何测量。目标允许±1px，固定尺寸均在范围内。

| 项目 | 1920 | 1440 | 1280 | 900 |
| --- | --- | --- | --- | --- |
| 三页h1左上(x,y)（S10） | (300,64) | (300,64) | (292,64) | (44,64) |
| 标题区底→工具栏顶（S10） | 12 | 12 | 12 | 12 |
| FilterChip高度（G1） | 30 | 30 | 30 | 30 |
| 会话搜索框高（C6） | 32 | 32 | 32 | 32 |
| 联系人时间右缘 / 行右缘（C1） | 567 / 579 | 567 / 579 | 559 / 571 | 联系人列按原响应式隐藏 |
| 通知表格宽（S11/N2） | 1376 | 1136 | 992 | 940（容器内横滚） |
| 来源列宽（S11/N2） | 548.406 | 436 | 292 | 240 |
| 来源列占比（S11/N2） | 39.855% | 38.380% | 29.435% | 25.532% |
| 每条通知行高（N2，6条） | 56 | 56 | 56 | 56 |

四宽固定列均为：结果120、通知类型120、接收人120、渠道120、时间140、操作80。来源 `minmax(240px,1.5fr)`；宽屏余量分配给列间距，避免来源超过40%，小屏间距为0。时间/操作右对齐。900宽只在表格内部横滚，没有页面横向溢出。

控件专项在1440实测：姓名/科室容器→时间间距8；胶囊箭头12×12，工作台可选图标14×14，×图标12；胶囊三态高度均30，展开态1px主灰内描边；值字重600。迷你卡水平/垂直内边距10，标题字号13，无处理人行；真实溢出区滚动条几何宽8，箭头display:none。未读徽标背景rgb(37,99,201)、文字白色，继承卡20的Token。

## 结果与限制

- 最终35个入口178/178分段通过（25入口134项+10入口44项），0最终FAIL/取消/SKIP/TODO，未运行并集为空；原Inbox 9个场景完整保留。两批间仅修正新增测试的空占位选择，运行输出只有该测试及map不同，其余2755项逐字节一致，前25个入口源码/执行文件逐一核哈希；不声称一次full或单次同manifest通过。严格类型、ESLint、Stylelint、一次最终候选应用构建、制品检查通过。
- G1、S10、S11、C1–C10、N1、N2、N4均有结论与证据；C7/C8继承已合并卡20，无重复源码调整。
- **N3完整字段呈现仍未完成**：真实父Ticket有编号与长合成标题，但NotificationExceptionItem未投影编号/标题/报修人姓名。本卡只改链接色与安全摘要省略，保持现有跳转；没有逐行读取父对象或从摘要猜字段。
- 本次已补验用户指定离线画布；正式来源只用01–05（含04b），见[离线正式画布索引](offline-reference/README.md)。上轮未解包的判断已纠正；不追认旧结果，也不声称整页像素零差异。
- 35入口、类型/制品原件及全部初始失败集中于 `D:/CodexEvidence/pc-admin-v212-card21-20261104`。结构化度量、源码/截图哈希及验证摘要集中于其 `delivery-json/`；这些JSON已逐字节保存，未混入产品或文档发布路径。

[逐编号执行记录、根因与回退](../../../../plans/pc-admin-design-v21/card-21.md) · [FilterChip规范](../../design-system.md#621-filterchipv212--g1) · [卡21规范修订](../../design-system-v2.1.md#66-v212-卡-21-精度规则2026-11-04)
