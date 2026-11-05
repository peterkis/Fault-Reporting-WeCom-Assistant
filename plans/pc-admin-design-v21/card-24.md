# PC 管理端 v2.1.5 卡24：字体与细节收口

**最终状态：LOCAL_VERIFIED / 未提交。** 当前输入SHA-256 `167b10c3c7d74bb9f5cb5541ce6956a6beaf24e5f4d79751b92ff753471c3e4b`，manifest SHA-256 `389e95a0ed090ada7c5b97e4aff346101c6467651cf25a474a7bb65d9dec96da`，HEAD仍为基线f71a1cb8。F1–F4、C1–C9、N1–N3、G1–G3均有实现/检查结论及数值证据；F4保留服务不可达不能离线冷启动的现有限制。下面“执行中/待答复”等段落是原始过程记录，最终结论以本段及末尾总表为准。

2026-11-05；唯一写者为本会话，独立worktree `D:/worktrees/pc-admin-v215-card24`，分支 `codex/pc-admin-v215-card24`。HTTPS fetch 后基线 `origin/main = f71a1cb8e51a2731ca72be78429a281b4fcbbebf`（卡23 PR #149），当前差异未提交。没有提交、推送、PR、生产写入、真实发送、部署或Gate操作。

用户主工作区原型/提示词未跟踪文件原样保留；视觉依据读取用户指定v2.1.4原件，包含01、02、03、03b、04、04b、05七画板，排除06–08。解包只写外部证据目录。历史截图不回写。

## 范围与验证风险

F1–F4为字体资源/Token/同源CSP核验，C1–C9为会话展示，N1–N3为通知表格，G1–G3为公共外壳。业务命令、API客户端、状态值、权限、恢复/原UUID规则不变。2026-11-05用户明确补充允许文件清单外的字体声明替换；这些文件只统一数字排版或快捷键字体，不改结构/颜色。Stylelint配置为F2明确要求，规范/本记录/Evidence为交付范围。

既有浏览器测试缺少字体资源、气泡四角、等待区贴合、kbd和表头连续线数值断言，因此在既有注册入口增加直接验收，复用现有真实HTTP/UUID合成库/Windows系统Chrome helper；数据通过原fixture的命令或pool.query方式写入。首次失败保留，修复直接风险后按ADR-0053真实差异计划执行；适用检查通过即停止扩验。full/certify不执行。

原始构建、lint、types、测试JSON/TAP与失败仅保存一份于 `D:/CodexEvidence/pc-admin-v215-card24-20261105/`。截图索引见[卡24证据](../../docs/ui/evidence/v215-card24/README.md)。

## 执行中

- F1：三个字体精确版本：Inter 5.3.0、Noto Sans SC 5.3.1、JetBrains Mono 5.3.0。按包CSS实际family生成99个face：Inter latin 1、Noto编号分片97、JetBrains Mono latin 1；全部normal/wght/swap，保留unicode-range，不引入其它语言/斜体。
- F2：入口最先引入fonts.css，登录独立入口复用字体，login.css只定义同字体栈/字重Token，不导入会改变基准字号的全套tokens.css。启动页改用font-sans；新增Stylelint字体族规则及明确豁免。
- F3：23处tabular-nums统一引用font-numeric-variant，新增font-num。快捷键去掉mono，等宽只保留编号/代码/错误码。
- F4：服务器正式页面已有font-src self。Electron为远程服务页面外壳，安装白名单不含Web bundle，不能将服务端资产打包误称为Electron安装包字体。尚待产物与断网实测。
- C1/C2：气泡first/rest属性、12/4圆角、10/12内边距；28头像与占位。
- C3/C4/C5：接待横幅贴合、待接待白底计数；ghost草稿按钮回左侧；空输入快捷键保留；姓名不插空格。
- C6/C7：没有可复用前端映射，按真实COMMUNICATION_SEND_TIMEOUT安全码补中文“企微接口超时”；未知原码保留code/title；联系人TriangleAlert。
- C8/C9：白底分隔头与现有assignment事实对应标签；右栏字号13/14/12和来源22行高。
- N1：通知已有行级线，本卡明确共享th底框为0，thead tr单线；待实测确认连续宽度。
- N2/N3：12px结果图标；仅去掉资料未提供后缀。
- G1/G2/G3：36底块；品牌行与原面包屑共用现有信息服务团队标签（原实现为静态团队文案，未新增接口）；统一kbd。

首次Stylelint拒绝font-face规则的null映射与两处圆角写法，保留lint-initial.log；已用fonts.css豁免及局部Token修正，Stylelint/ESLint与前端类型预检通过。最终结果、实测、截图、限制和回退在验证结束后补齐。


## 已保留构建失败与范围冲突

- build-1：WEB01_DEPENDENCY_LOCK_DRIFT。根前端依赖必须登记devDependencies，最初npm默认登记dependencies；已按实际管线约定移动三个字体包，版本不变，无其它依赖变化。
- build-2：Vite成功生成字体，但WEB01_BUILD_OUTPUT_INVALID。PC构建器和两处静态服务只允许JS/CSS，登录资产图还只遍历JS/CSS。已向用户列出三处最小支持修改，当前等待范围确认，尚未修改这三处。
- Vite默认还把3个小分片内联；fonts.css URL明确追加官方no-inline参数，让所有字体成为同源WOFF2文件，维持font-src self、不添加data源。
- F2负向证明：外部font-rule-invalid.css中的Arial声明被现有Stylelint执行器拒绝；原始结果font-rule-negative.log。


## 待范围答复时的交接

前端源码、规范与直接验收断言已准备，尚未达到本地验收通过。最终统一build、gate types、verify-artifact、适用选集、完整截图/实测矩阵仍未完成，不以预检PASS替代。主工作区/后端/contracts/tools均无本卡修改。PG自有54824已停止（stop exit0、status3、监听0），worktree/分支及失败日志保留；没有提交/推送/PR。确认静态资源范围后，从同一worktree继续。


## 范围补充授权与执行

2026-11-05用户明确选择“允许这三处静态资源支持及对应测试”：tools/ts-migration/web.mts、app/server/src/web01-workbench-static.mts、app/server/src/workbench-embedded-login.mts。仅使清单内WOFF2进入构建与静态路由，不修改认证、CSP、业务API/命令/状态/权限。登录沿现有资产图绑定字体，原32个代码/样式上限保留，字体单列128分片上限；原4MiB单资源/16MiB总读取与哈希、编码验证保留。WOFF2只提供原始编码，JS/CSS三编码合同保持。对应既有HTTP/桌面登录入口增加99文件、MIME、字节、认证、未登记路径、HEAD/406与query/sidecar拒绝断言。


## 直接验收过程（保留失败）

- build-3：新加登录字体测试误用变量html，实际名为shell，strict在运行前拒绝；已修正，原日志保留。
- build-4/types-4/artifact-4通过。直接验收direct-1为3 PASS/1 FAIL：会话新增标题选择器过宽把迷你卡标题也计入；通知、登录与静态HTTP通过。后继收紧至三块区段标题，未放宽尺寸/字重断言。
- 第一次实际截图像素行显示N1仍有两线：y291列间白缝、y292连续线。probe-4确认th的HeroUI内阴影仍在；移除th box-shadow，保留唯一行级1px线，并新增shadow===none断言。
- probe-4发现无权限输入仍为白色，原因是旧:has选择器多一个class，压过新无权限样式；补齐同等作用域后灰底恢复。等待白底分支保持。
- build-5/types-5/artifact-5通过。direct-2四种会话状态的气泡、头像、横幅、字号、权限底色与快捷键均通过；C6新增可见文本断言拒绝flex造成的innerText换行。将错误说明包在一个行内文字槽，保留label函数、delivery IDs、原码/title和全部断言。
- remaining-5诊断保留了innerText与textContent差异；工作台字体已加载，但T22夹具默认未启用现有搜索能力，因此没有/快捷键。后继仅为本卡opt-in新增search测试选项，默认false，沿真实宿主开关启用搜索，不伪造bootstrap或capabilities。旧测试默认不变。


## Windows具名入口与历史UI前提

selection-6在第14项pc-admin-electron停止：普通runner按既有环境白名单不传WECOM_DESKTOP_INTEGRATION，原生入口显式SKIP，汇总拒绝通过。此前13入口126项PASS，48入口NOT_RUN；原summary/TAP保留。

沿既有desktop.ps1 -Action Integration实际运行，native-integration-6在旧UI负向断言失败：该断言禁止topbar含“实时更新”，当前基线useRealtime.ts的live文案本来就是“实时更新中”，本卡未改该文件。后继将该段替换成精确live状态/文案和G2团队同源断言；旧管理端/旧brand排除、三人闭环、200/409并发、后台通知、隐藏读/活动写0、原生沙箱、身份/退出/恢复断言全部保留。最终重新构建后执行完整适用集合及具名原生入口，不用旧126项替代最终候选。


## 编号收口：现象 → 位置 → 修改 → 验收

本表为本卡实现结论；测试总表与最终资源状态在末尾单列。

| 编号 | 结论 | 现象与位置 | 修改 | 验收证据 |
| --- | --- | --- | --- | --- |
| F1 | 已修改 | tokens.css系统字体；无字体资源 | 三包精确锁版、99个normal/wght/swap face，保留97个中文unicode-range分片，Inter/Mono仅latin；no-inline | 每入口99文件/4,537,324字节；三页fonts.check=true，三族实际used face loaded；首屏14/16/13文件，无外域。完整清单见Evidence字体报告 |
| F2 | 已修改 | login.css、shell.css与HeroUI继承栈 | 所有src CSS font-family经font Token；登录独立栈不改变基准字号；Stylelint约束与字体face豁免 | Stylelint负例Arial被拒；三页h1/卡片/气泡/单元格/Select和ListBox计算栈以Inter开头；Modal/Tooltip补充实测 |
| F3 | 已修改 | Button快捷键mono；23处数字规则裸写 | kbd用sans；全部数字声明引用font-numeric-variant，数字用font-num；mono只用于编号/代码/错误码 | 三处kbd同样式；工单号以JetBrains Mono开头；错误码12px/mono补充实测 |
| F4 | 已修改并确认宿主限制 | 构建和静态服务原只接受JS/CSS；宿主远程页面 | 按追加授权补清单内WOFF2构建、路由、MIME与登录资产图；CSP不放宽 | 工作台字体保留401；未登记404、登录HEAD/406/query/sidecar拒绝通过。两个Web入口无data字体。Electron安装壳字体0；冷启动断开服务显示暂时无法连接，已加载页面断网字体可用，不冒充离线冷启动成功 |
| C1 | 已修改 | MessageBubble全8圆角、8/12 padding | first/rest数据属性；组首发送侧上角4，其余12，rest全12；10/12 padding | 第一条4/12/12/12，第二条12/12/12/12，outgoing12/4/12/12，padding10/12/10/12；系统胶囊沿原覆盖 |
| C2 | 已修改 | Avatar消息组24 | 新size28、avatar-msg28、fs-xs，占位28；其它头像不变 | 头像28×28、占位28px；颜色哈希/取字/aria/title保留 |
| C3 | 已修改 | 等待横幅分卡、灰输入、计数隐藏 | 共享边界贴合，主句primary/600、补句secondary；等待白底计数，缺权限才灰底 | gap0、高49≤52；等待rgb(255,255,255)、0/2000可见；缺权rgb(247,247,245)；原动作/等待时长缺口保留 |
| C4 | 已修改 | ConversationComposer清理按钮过重、空输入无快捷键 | 原discard移左状态区ghost，24高/12字/无边框；快捷键按权限/接待/提交展示 | 计算字号12px、边框0、高24；空输入有权Ctrl可见；待接待/无权隐藏；原data-action与回调完整保留 |
| C5 | 已修改 | placeholder姓名前插空格 | 姓名直接连接 | 断言不含“给 ”与“ …” |
| C6 | 已修改 | raw code直接拼入状态行 | 未找到前端既有映射；真实COMMUNICATION_SEND_TIMEOUT映射企微接口超时；未知码标“错误码”并mono，原码title；deliveryLabel不变 | 映射/未映射合成投递分别断言完整可见文本、title和原码；错误说明单行文字槽避免flex innerText换行 |
| C7 | 已修改 | 联系人裸! | 12px TriangleAlert，原aria/title不变 | 每项1个SVG/12px，textContent空 |
| C8 | 已修改 | 会话头与消息边界/责任标签 | 白底1px hair线；timeline独立裁切；按真实assignment显示待接待、接待中·我/他人、结束 | timeline.top=header.bottom、overflow auto；warning/brand/neutral和四种标签文本断言；滚动补充截图 |
| C9 | 已修改 | 右栏字号13姓名/12来源 | 标题13/600、姓名14/600、科室12、来源13/22 | getComputedStyle逐项精确值断言，来源标签secondary/值primary |
| N1 | 已修改 | th底线/内阴影造成分段双线 | th border-bottom0、box-shadow none，单独tr hair线 | 7列底边均0、shadow none；tr1px且1136=表格1136；像素复查原分段阴影已去掉 |
| N2 | 已修改 | 结果标签无图标 | Tag内失败TriangleAlert、其它待核对Clock | 每项1个12×12 SVG、gap4px，具体图标按status断言 |
| N3 | 已修改 | 会话来源资料缺失后缀 | 只去末尾（资料未提供），其它后缀保留 | 缺资料显示会话·报修人；既有N3个人资料回归同步精确期望，其它业务断言保留 |
| G1 | 已修改 | PageHeader裸20图标 | 36底块、8圆角、20图标、gap12；通知danger，副标题margin-left48 | 已测标题x320/y66、底块36、通知副标题left320；公共故障补充四页实测 |
| G2 | 已修改 | 搜索上无品牌 | SidebarBrand 48行/28标识/15字、12团队；面包屑与品牌共享原有来源 | 团队同值、行48/图标28/名称15；当前既有来源仍为静态团队标签，未新增或杜撰后端团队字段/请求 |
| G3 | 已修改 | 三处kbd不一致、mono | 共用font.css kbd：18高/最小宽、0/4 padding、1边框、4圆角、canvas、12/500/sans | 侧栏Ctrl K、工作台/、会话Ctrl完整计算样式相同 |

## F · 依赖、资源、请求与CSP

精确版本：`@fontsource-variable/inter@5.3.0`、`@fontsource-variable/noto-sans-sc@5.3.1`、`@fontsource-variable/jetbrains-mono@5.3.0`。根按原构建约定登记devDependencies，PC manifest登记同版本，lockfile只有这三条新增包；既有包内容未漂移。实际face族名来自安装包CSS，不根据展示名称猜测。

[字体产物完整99文件、字节与哈希](../../docs/ui/evidence/v215-card24/font-files.md)、[三页首屏下载逐文件明细](../../docs/ui/evidence/v215-card24/font-downloads.md)。工作台14文件790,516字节、会话16文件861,292字节、通知13文件732,248字节；均同源。Noto实际使用分片为12/14/11，其余保持unloaded，未用“全部face必须loaded”破坏按需加载。

两个Web入口各99文件4,537,324字节；总198份9,074,648字节，二进制去重99份。WOFF2不二次压缩；JS/CSS三编码原合同保留。字体许可证随CSS保留。服务器页面与登录CSP已有font-src 'self'，无data字体，无远程font源变更。

Electron是远程服务页面宿主，安装包白名单没有Web bundle，字体文件为0。冷启动服务器不可达实拍为“暂时无法连接”，没有业务页面/应用字体可用；已加载页面断网仍有本地已载入字体。这是已确认的架构能力限制，本卡没有授权/实现离线业务包或缓存。内网服务器可达时字体全部来自项目本地资源，不依赖外部字体CDN。

原生采图脚本两次前置失败（compiled目录缺配置、D盘路径未使用规范绝对反斜杠）分别保留initial-fail/path-fail；改用自有stage与规范path.resolve后成功实拍，未将脚本前置错误当产品RED。


## 文件清单（生成于最终验证期间）

仅本卡差异（未提交）；追加授权覆盖全局字体声明替换与三处静态资源支持。

### 前端展示与字体

- `app/pc-admin/.stylelintrc.json`
- `app/pc-admin/package.json`
- `app/pc-admin/src/app/SidebarBrand.tsx`
- `app/pc-admin/src/app/Workbench.tsx`
- `app/pc-admin/src/app/sidebar-brand.css`
- `app/pc-admin/src/design/components/Avatar/Avatar.tsx`
- `app/pc-admin/src/design/components/Avatar/avatar.css`
- `app/pc-admin/src/design/components/BoardColumn/board-column.css`
- `app/pc-admin/src/design/components/BoardColumn/workbench-board.css`
- `app/pc-admin/src/design/components/BoardSummary/board-summary.css`
- `app/pc-admin/src/design/components/Button/button.css`
- `app/pc-admin/src/design/components/ConversationListItem/conversation-list-item.css`
- `app/pc-admin/src/design/components/DataTable/data-table.css`
- `app/pc-admin/src/design/components/Drawer/detail-content.css`
- `app/pc-admin/src/design/components/Drawer/drawer-v21.css`
- `app/pc-admin/src/design/components/MessageBubble/MessageBubble.tsx`
- `app/pc-admin/src/design/components/MessageBubble/message-bubble.css`
- `app/pc-admin/src/design/components/PageHeader/page-header.css`
- `app/pc-admin/src/design/components/PropertyList/property-list.css`
- `app/pc-admin/src/design/components/Split/conversation-v21.css`
- `app/pc-admin/src/design/components/Split/split.css`
- `app/pc-admin/src/design/components/Timeline/timeline.css`
- `app/pc-admin/src/design/fonts.css`
- `app/pc-admin/src/design/shell.css`
- `app/pc-admin/src/design/tokens.css`
- `app/pc-admin/src/features/conversations/ConversationComposer.tsx`
- `app/pc-admin/src/features/conversations/ConversationInbox.tsx`
- `app/pc-admin/src/features/conversations/conversations.css`
- `app/pc-admin/src/features/follow-up/follow-up.css`
- `app/pc-admin/src/features/notification-exceptions/NotificationExceptions.tsx`
- `app/pc-admin/src/features/notification-exceptions/notification-exceptions.css`
- `app/pc-admin/src/login/login.css`
- `app/pc-admin/src/login/main.ts`
- `app/pc-admin/src/main.tsx`

### 授权静态资源支持

- `app/server/src/web01-workbench-static.mts`
- `app/server/src/workbench-embedded-login.mts`
- `tools/ts-migration/web.mts`

### 测试与夹具

- `tests/helpers/card23-presentation.mts`
- `tests/helpers/card24-presentation.mts`
- `tests/helpers/wbint-t22-fixture.mts`
- `tests/wbint-t22-conversations.browser.test.mts`
- `tests/wbint-t32-notification-exceptions.browser.test.mts`
- `tests/web01-workbench.integration.test.mjs`
- `tests/workbench-desktop-session.browser.test.mts`

### 规范、记录与证据

- `docs/ui/design-system-v2.1.md`
- `docs/ui/design-system.md`
- `docs/ui/evidence/v215-card24/README.md`
- `docs/ui/evidence/v215-card24/board-1440.png`
- `docs/ui/evidence/v215-card24/board-1920.png`
- `docs/ui/evidence/v215-card24/conversation-allowed-1440.png`
- `docs/ui/evidence/v215-card24/conversation-allowed-1920.png`
- `docs/ui/evidence/v215-card24/conversation-denied-1440.png`
- `docs/ui/evidence/v215-card24/conversation-failed-1440.png`
- `docs/ui/evidence/v215-card24/conversation-waiting-1440.png`
- `docs/ui/evidence/v215-card24/detail-composer-bottom-x2.png`
- `docs/ui/evidence/v215-card24/detail-errors-x2.png`
- `docs/ui/evidence/v215-card24/drawer-1440.png`
- `docs/ui/evidence/v215-card24/font-downloads.md`
- `docs/ui/evidence/v215-card24/font-files.md`
- `docs/ui/evidence/v215-card24/glyph-account-x2.png`
- `docs/ui/evidence/v215-card24/glyph-bubble-meta-x2.png`
- `docs/ui/evidence/v215-card24/glyph-card-x2.png`
- `docs/ui/evidence/v215-card24/glyph-notification-time-x2.png`
- `docs/ui/evidence/v215-card24/notifications-1440.png`
- `docs/ui/evidence/v215-card24/offline-cold-electron.png`
- `docs/ui/evidence/v215-card24/offline-loaded-fonts-1440.png`
- `plans/pc-admin-design-v21/card-24.md`

### 根字体依赖

- `package-lock.json`
- `package.json`



## 规范更新与不变项

- design-system.md前向字体章节F1–F4与原§4.2同步字体栈、用途、本地分片、数字Token、等宽范围、CDN禁令和lint；§9.1入口顺序加入fonts.css；§6.13补28px消息头像及12px字形例外。
- 前向会话章节覆盖C1–C9：气泡/头像、等待组合、底栏、错误说明、头部状态与右栏字号；外壳/通知章节覆盖N1–N3、G1–G3。旧卡23的24px文字保留历史含义，由新前向规则覆盖。
- design-system-v2.1.md加入卡24前向入口。没有修改颜色值、状态、权限、读取/提交客户端、合同或数据库迁移。通知类型/路由/结果口径、UNKNOWN原UUID、草稿加密与丢弃回调保持。
- 工具栏横跨整页、内部备注锁与内部标签位于气泡内、无等待最久新排序、等待时长与全局等待人数缺口均保留。

回退：在本独立worktree撤销本卡未提交差异及三个字体依赖；保持原主工作区和历史证据不动。无数据库或持久开关回退步骤。未提交，不生成revert提交或改写Git历史。


F4打包检查口径：本轮执行原生Build（stage）和实际Electron进程验证，未生成新的NSIS安装包。现有打包白名单与本轮stage均不含Web bundle/WOFF2，因此字体由服务器随Web产物分发；不将源白名单检查冒充新安装包验收。


selection-7在第34入口wbint-t22的既有R4计算值断言失败（实际textarea背景透明，期望bg-subtle）；外层容器灰底已正确，截图不能替代元素计算值。修补仅区分textarea本身的等待bg-canvas与无权bg-subtle，并在Card24新增两项精确断言；原R4的权限、disabled、字数隐藏和发送禁用断言全部保留。原175 PASS/1 FAIL、后续NOT_RUN保留；后继最终制品重新执行适用集合。


统一runtime全量口径：206个WOFF2，共9,368,196字节；其中PC两个入口198份/9,074,648字节，另有H5既有8份/293,548字节（本卡未改）。PC二进制去重99份/4,537,324字节，不将emit复制重复计算。


## F3最终用途复核与增量验证对象

完整MVP差异集合已在build-8通过：61普通入口429项，加具名Windows Electron 1项，共430项；不将此结果回绑为后继样式候选。随后用途复核确认context-line实际承载“人工公共故障候选 · 状态”，不是编号；legacy表格泛首列字体规则也过宽。最终只改shell.css与DataTable/workbench-table.css的font-family：上下文/表头sans，明确WorkList编号列mono，无结构、颜色或其它样式变化。前后源码SHA保存在f3-final-delta.json，build-8原manifest保存在外部原件。

进入最后工具用例时，已确认hosts检查结束，tooling.test只在隔离clone内构建/篡改，其引用的原仓库工具代码未改变，不再读取本checkout运行制品；保持其副本独立。最终CSS用已编译build.mjs执行正式统一构建，不再bootstrap未改变的工具。最终复核按这两份CSS的pc/pr-read-safety增量范围执行，另测真实候选详情上下文字体、列表编号、全部卡24数值项与截图；全部非Web运行产物另做字节一致性核验，原工具/MVP结果保留各自对象与限制。


F3补充计算值在additional-evidence初轮拒绝：列表编号仍是Inter；list-font-debug.json证明实际WorkList沿既有raw HeroUI Table，祖先没有ds-data-table类。最初选择器假设多一层，未命中。仅将编号列font-family选择器收窄到实际list-group/work-table首列；列宽、结构、数据和业务不动。原断言保持，原日志与DOM父链保留；后继重新构建并复测PC、原生及补充实测。


## 最终补充实测

additional-evidence-10全部断言通过：C6错误码为JetBrains Mono/12px；滚动300px时header.bottom=timeline.top=212px，overflow auto；Chrome平台字形接口确认h1使用自定义Noto字体。C3横幅圆角10/10/0/0，输入区0/0/12/12，横幅边框1/0与输入上边1px共享，补句字重400。G2行48/标识28、名称15/600、团队12/400、左右padding8、下间距8，品牌标识left16=导航图标left16。四页标题均x320/y66，底块36×36、圆角8、图标20；候选上下文与Modal/Tooltip精确等于完整sans栈，列表编号均为JetBrains Mono，列表表头为sans。补充JSON保存在外部additional-metrics.json。


## 最终验证总表（对象分开，不相加冒充同一批）

| 检查 | 对象 / 结果 | 原件 |
| --- | --- | --- |
| migration:build | build-8完整MVP候选PASS；922个编译模块实际Node解析、max_active2 | build-8.log |
| 最终正式构建 | build-10直接调用已编译build.mjs，PASS；同一统一构建管线、922实际解析；未再次bootstrap未变工具 | build-10.log |
| types gate | 最终build-10 PASS；strict/负向类型、前端/桌面检查 | types-10.log |
| Stylelint / ESLint | 最终gate内均0错误/0警告；字体族负例按预期拒绝 | types-10.log、font-rule-negative.log |
| 完整MVP差异集合 | build-8：61入口429/429 PASS +具名Electron1/1；0 FAIL/CANCEL/SKIP/TODO，not_run空 | selection-8/summary.json、native-integration-8.log |
| 最终F3增量PC集合 | build-10：pr-pc + pr-read-safety，15入口112/112 PASS，0失败/跳过 | f3-final-pc-scope-10.json、pc-final-10/summary.json |
| 最终Windows Electron | build-10：1/1 PASS；3人真实PG/合成OAuth、200/409、闭环、后台通知、隐藏读/活动写0、失权/退出 | native-integration-10.log |
| 卡24最终直接验收 | build-10：4/4 PASS；会话四态/两宽、通知/登录/字体HTTP；与上面重叠，不累计 | direct-10.log、direct-10/ |
| 补充实测 | build-10 PASS；实际中文字体、Modal/Tooltip、四页标题、scroll、圆角、品牌、列表编号和候选上下文 | additional-evidence-10.log、additional-metrics.json |
| 7项既有工具检查 | 128/128 PASS，0失败/取消/跳过；工具代码在最终CSS修补中未变；各用例保持隔离副本 | tool-checks-8.log |
| 非Web运行产物比较 | build-8→最终build-10：仅两CSS源输入变化；2603个非Web产物逐字节相同，无差异 | f3-runtime-byte-audit-10.json |
| 文档与资源 | 最终链接/预算、制品及关闭读回在本次结束时再次执行；见关闭记录 | docs-final.log、artifact-final.log、cleanup-final.json |
| 机械视觉检测 | []；不是替代实际截图、数值与业务验证 | impeccable-detect.json |

完整MVP回归保留build-8原输入`863464f3323807ac269d27b2c7850823f2006ecd11c4603c88ab98fbff8ed545`，不把它改写为最终样式候选。后继差异仅shell.css/workbench-table.css字体声明，因此按现有CSS路径策略复核15个PC/读取安全入口，另跑原生/卡24及补充实测；最终发布身份以本记录顶部的实际输入/manifest为准。7项工具源码与2603个非Web产物没有变化，原结果保留自己的运行原件。没有为此更改路径策略、测试路由或忽略失败。

## 八项自检（按原问题逐条回答）

| 自检 | 是 / 否与证据 |
| --- | --- |
| 只新增3个字体包且精确锁版，无其它新依赖 | 是；dependency-audit.json只有三条新增package，既有package内容无漂移；根/PC manifest版本一致 |
| 无任何外部字体CDN请求 | 是；三页首屏外域字体0，无data字体，全部本地WOFF2；完整下载表与HTTP断言 |
| 仅前端和测试、没有后端等改动 | 否（原始严格边界已被用户明确扩展）；仅额外两个静态server文件与一个构建文件支持WOFF2。合同、迁移、业务命令/状态/权限均未改 |
| 测试选择器只增不删 | 是；selector-audit.json无缺失data属性名，移动discard保留data-action及回调；原权限/UUID/隐私断言保留 |
| 新样式走Token、lint0、字体规则生效 | 是；types-10内Stylelint/ESLint0，变量0缺失，Arial反例被拒；Token审计只变字体与28头像，无颜色值变化 |
| 只改原第四节文件 | 否（已有两次明确追加授权）；全局字体声明替换、三处静态资源支持及对应测试为具名扩展，其余为原范围规范/记录/Evidence |
| 所有数值验收都有实测 | 是；Evidence数值表、direct-10 JSON与additional-metrics.json；包含四角、28占位、0 gap/49高、12/24/0、字号行高、36/48/18、SVG12等 |
| 有意保留项保持 | 是；全页工具栏、内部锁/内部在气泡内、未增加等待最久排序、未估算等待时长/等待人数；源与原业务回归均保持 |

## 未执行与限制

- full/certify、GitHub CI、部署、真实WeCom发送、现场业务写入、负责人Gate和人工Windows通知中心观察均NOT_RUN；本地验证不替代现场/用户接受。
- 未生成新的NSIS安装包；Electron安装白名单/本轮stage不含Web字体。离线冷启动无法连接服务，字体未加载；已加载页面断网字体仍在。此限制不是新的离线业务能力。
- 品牌团队复用原面包屑单一来源，现有来源是静态团队标签；没有杜撰团队DTO或额外请求。
- 原失败、SKIP、NOT_RUN和脚本前置错误均留在外部原件与上文过程；没有覆写为PASS。

## 最终文件清单

- `app/pc-admin/.stylelintrc.json`
- `app/pc-admin/package.json`
- `app/pc-admin/src/app/SidebarBrand.tsx`
- `app/pc-admin/src/app/Workbench.tsx`
- `app/pc-admin/src/app/sidebar-brand.css`
- `app/pc-admin/src/design/components/Avatar/Avatar.tsx`
- `app/pc-admin/src/design/components/Avatar/avatar.css`
- `app/pc-admin/src/design/components/BoardColumn/board-column.css`
- `app/pc-admin/src/design/components/BoardColumn/workbench-board.css`
- `app/pc-admin/src/design/components/BoardSummary/board-summary.css`
- `app/pc-admin/src/design/components/Button/button.css`
- `app/pc-admin/src/design/components/ConversationListItem/conversation-list-item.css`
- `app/pc-admin/src/design/components/DataTable/data-table.css`
- `app/pc-admin/src/design/components/DataTable/workbench-table.css`
- `app/pc-admin/src/design/components/Drawer/detail-content.css`
- `app/pc-admin/src/design/components/Drawer/drawer-v21.css`
- `app/pc-admin/src/design/components/MessageBubble/MessageBubble.tsx`
- `app/pc-admin/src/design/components/MessageBubble/message-bubble.css`
- `app/pc-admin/src/design/components/PageHeader/page-header.css`
- `app/pc-admin/src/design/components/PropertyList/property-list.css`
- `app/pc-admin/src/design/components/Split/conversation-v21.css`
- `app/pc-admin/src/design/components/Split/split.css`
- `app/pc-admin/src/design/components/Timeline/timeline.css`
- `app/pc-admin/src/design/fonts.css`
- `app/pc-admin/src/design/shell.css`
- `app/pc-admin/src/design/tokens.css`
- `app/pc-admin/src/features/conversations/ConversationComposer.tsx`
- `app/pc-admin/src/features/conversations/ConversationInbox.tsx`
- `app/pc-admin/src/features/conversations/conversations.css`
- `app/pc-admin/src/features/follow-up/follow-up.css`
- `app/pc-admin/src/features/notification-exceptions/NotificationExceptions.tsx`
- `app/pc-admin/src/features/notification-exceptions/notification-exceptions.css`
- `app/pc-admin/src/login/login.css`
- `app/pc-admin/src/login/main.ts`
- `app/pc-admin/src/main.tsx`
- `app/server/src/web01-workbench-static.mts`
- `app/server/src/workbench-embedded-login.mts`
- `docs/ui/design-system-v2.1.md`
- `docs/ui/design-system.md`
- `docs/ui/evidence/v215-card24/README.md`
- `docs/ui/evidence/v215-card24/board-1440.png`
- `docs/ui/evidence/v215-card24/board-1920.png`
- `docs/ui/evidence/v215-card24/conversation-allowed-1440.png`
- `docs/ui/evidence/v215-card24/conversation-allowed-1920.png`
- `docs/ui/evidence/v215-card24/conversation-denied-1440.png`
- `docs/ui/evidence/v215-card24/conversation-failed-1440.png`
- `docs/ui/evidence/v215-card24/conversation-scrolled-1440.png`
- `docs/ui/evidence/v215-card24/conversation-waiting-1440.png`
- `docs/ui/evidence/v215-card24/detail-composer-bottom-x2.png`
- `docs/ui/evidence/v215-card24/detail-errors-x2.png`
- `docs/ui/evidence/v215-card24/drawer-1440.png`
- `docs/ui/evidence/v215-card24/font-downloads.md`
- `docs/ui/evidence/v215-card24/font-files.md`
- `docs/ui/evidence/v215-card24/font-list-1440.png`
- `docs/ui/evidence/v215-card24/glyph-account-x2.png`
- `docs/ui/evidence/v215-card24/glyph-bubble-meta-x2.png`
- `docs/ui/evidence/v215-card24/glyph-card-x2.png`
- `docs/ui/evidence/v215-card24/glyph-error-unmapped-x2.png`
- `docs/ui/evidence/v215-card24/glyph-notification-time-x2.png`
- `docs/ui/evidence/v215-card24/notifications-1440.png`
- `docs/ui/evidence/v215-card24/offline-cold-electron.png`
- `docs/ui/evidence/v215-card24/offline-loaded-fonts-1440.png`
- `package-lock.json`
- `package.json`
- `plans/pc-admin-design-v21/card-24.md`
- `tests/helpers/card23-presentation.mts`
- `tests/helpers/card24-presentation.mts`
- `tests/helpers/wbint-t22-fixture.mts`
- `tests/pc-admin-electron.browser.test.mts`
- `tests/wbint-t22-conversations.browser.test.mts`
- `tests/wbint-t32-notification-exceptions.browser.test.mts`
- `tests/web01-workbench.integration.test.mjs`
- `tests/workbench-desktop-session.browser.test.mts`
- `tools/ts-migration/web.mts`


## 关闭读回与交付位置

最终verify-artifact为ARTIFACT_VERIFIED_NOT_ACTIVATED，manifest与顶部一致。自有54824实例只剩postgres数据库、其它客户端0；pg_ctl stop exit0、status3、监听0、原master进程不存在。所有自有HTTP/浏览器由fixture关闭并核句柄/进程；最终该worktree路径的Chrome/Electron进程0。原始关闭JSON为cleanup-final.json。

只删除了本任务下载缓存中可从原固定版本缓存恢复、且SHA相同的Electron重复ZIP；源缓存、已安装依赖、当前正式build、分支/worktree与静态PG目录保留供复核。失败/NOT_RUN/原件、原主工作区未跟踪文件与历史Evidence未清理。没有提交、推送、PR、部署或Gate操作。

本地PR描述草稿（按pr技能模板，逐条F1–F4/C1–C9/N1–N3/G1–G3）位于 `D:/CodexEvidence/pc-admin-v215-card24-20261105/pr-description.md`；没有创建远端PR。汇总为同目录final-result.json；可移植截图/数值索引见卡24Evidence README。源码和依赖可用Git差异/lockfile恢复，关闭无需数据库迁移或持久开关动作。
