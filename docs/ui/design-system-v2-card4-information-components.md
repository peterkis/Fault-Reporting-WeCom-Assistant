# 设计系统 v2 · 卡 4：信息组件与看板

日期：2026-11-01。范围：本地视觉层；尚未提交、推送或创建 PR。

## 1. 改动与边界

按设计系统 §6.4–6.6、§6.13、第七章统一 Tag、StatusBadge、SourceLabel、Avatar、TicketCard 和 BoardColumn。卡片分为编号、标题、元信息、动作/责任/时间四行；列阶段不再重复放到卡片。来源使用图标与中性文字，彩色标签最多两个，依 danger → attention → review → brand → 其它截断，剩余信息通过 +n 的标题与可访问名称保留。

只在服务器已返回 HANDLING 相关原因时显示“我负责”；单独关注或沟通关系不冒充工单处理责任。等待厂商、等待补充及已解决待确认的原细分含义保留在标签标题中，DTO 状态和列归属未改名。

2026-11-01 用户确认：共享跟进预约在第④行标签区，原日期/时间用中性文字，已到期保留 attention 文字，单行省略并以悬停标题提供完整内容；右侧仍为处理人与更新时间。确认已回写设计系统 §6.5。现有预约读取、到期、取消及北京时间语义保持。

无数据库、Schema、API、权限、Query/Zustand、草稿/UNKNOWN、实时事件或默认 Feature Flag 变更。已处理空列的“查看更早”直接复用原 applyClosedRange('all') 控制器，与原“清除已处理日期”相同，不增加查询能力或业务写入。

## 2. 文件清单

| 操作 | 文件 | 用途 |
| --- | --- | --- |
| 新增 | app/pc-admin/src/design/status-map.ts | 唯一 tone 映射、子状态展示、责任提示与标签截断 |
| 新增 | app/pc-admin/src/design/components/Tag/Tag.tsx | 只提供 tone 外观的标签，转发原生提示和语义钩子 |
| 新增 | app/pc-admin/src/design/components/Tag/tag.css | 八种语义 tone、20 高、长文本与适用状态 |
| 新增 | app/pc-admin/src/design/components/StatusBadge/StatusBadge.tsx | 圆点加文字状态 |
| 新增 | app/pc-admin/src/design/components/StatusBadge/status-badge.css | 6px 圆点、无底色、长文本与焦点 |
| 新增 | app/pc-admin/src/design/components/SourceLabel/SourceLabel.tsx | 渠道图标与原 source_label |
| 新增 | app/pc-admin/src/design/components/SourceLabel/source-label.css | 12px 中性文字、14px 图标、单行省略 |
| 新增 | app/pc-admin/src/design/components/Avatar/Avatar.tsx | 姓名尾字、稳定哈希、系统与未派单占位 |
| 新增 | app/pc-admin/src/design/components/Avatar/avatar.css | 20/24/32 尺寸与虚线头像 |
| 新增 | app/pc-admin/src/design/components/TicketCard/TicketCard.tsx | 保留原 article/Link/DnD 层次的四行信息组合 |
| 新增 | app/pc-admin/src/design/components/TicketCard/ticket-card.css | 卡片、选中指示、四行网格、预约与截断 |
| 新增 | app/pc-admin/src/design/components/BoardColumn/BoardColumn.tsx | 列头状态/计数及服务端日期窗口的空态文案 |
| 新增 | app/pc-admin/src/design/components/BoardColumn/board-column.css | 统一列底、无底色列头、虚线空态 |
| 修改 | app/pc-admin/src/design/tokens.css | 按已有头像尺寸 50% 规则补 fs-avatar-sm |
| 修改 | app/pc-admin/src/app/Workbench.tsx | 组合信息组件，保留原请求、处理器、路由和动作包装 |
| 修改 | tests/t41-search-refresh-and-long-pages.browser.test.mts | 复用真实交互辅助等待展开/分页控件，保留条数、请求和刷新断言 |
| 修改 | tests/web01-closed-range.browser.test.mts | 增加夏令时、闰日与跨年空列显示检查，原 READ/游标/日期断言保留 |
| 修改 | tests/web01-workbench.browser.test.mjs | 增加四行、标签、列底断言；保留待确认含义与空态 READ 断言 |
| 修改 | tests/t36-team-and-recovery.browser.test.mts | 展示文案适配及结果提示定位到原 Toast，恢复/UUID/权限断言保留 |
| 修改 | docs/ui/design-system.md | 回写用户确认的共享跟进位置 |
| 新增 | docs/ui/design-system-v2-card4-information-components.md | 本交付记录与验收清单 |

删除：无。本卡未改 package 声明、根锁文件、Stylelint 配置、主入口或既有功能 CSS。卡 0–3 和其他未提交工作均保留。

## 3. 前后对照与截图

同一现有 WEB01 合成夹具先提供保存的起点 bundle，再提供最终正式 bundle；1920、1440、1280、900 四宽配对截图。组件夹具覆盖空数据、超长文本、未派单、选中、标签溢出、缺失字段、预约与合成 SLA 展示；组件例子的 SLA 不是服务端事实。

| 部位 | 改前 | 改后 |
| --- | --- | --- |
| 列头 | 带底色阶段胶囊 | 6px 状态点 + 主文字 + 灰色计数 |
| 卡片结构 | 状态/来源标签、跟进段落、底部分散 | 编号 → 标题 → 元信息 → 标签/预约/责任/时间 |
| 阶段 | 待接单、处理中、已关闭在卡片重复 | 不重复列阶段，只保留需要行动和阶段内子状态 |
| 来源 | 独立灰色标签 | 元信息行的渠道图标与灰字 |
| 行动标签 | 无统一优先级和数量约束 | 最多两个彩色 Tag，优先级截断并提供 +n |
| 责任 | 待受理未派单时无占位，姓名头像不统一 | 虚线头像 + 未派单；同名不重复处理人姓名 |
| 共享预约 | 单独段落 | 已确认的第④行，完整值在标题中保留 |
| 已处理空列 | 泛化权限措辞 | 服务端日期窗口 + 原日期过滤快捷动作 |

| 宽度 | 改前 | 改后 | 标题 (x,y) / primary |
| ---: | --- | --- | --- |
| 1920 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card4-20261101/screenshots-complete/before-board-1920.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card4-20261101/screenshots-complete/after-board-1920.png) | (300,64) / 1 |
| 1440 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card4-20261101/screenshots-complete/before-board-1440.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card4-20261101/screenshots-complete/after-board-1440.png) | (300,64) / 1 |
| 1280 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card4-20261101/screenshots-complete/before-board-1280.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card4-20261101/screenshots-complete/after-board-1280.png) | (292,64) / 1 |
| 900 | [前图](/D:/CodexEvidence/pc-admin-design-v2-card4-20261101/screenshots-complete/before-board-900.png) | [后图](/D:/CodexEvidence/pc-admin-design-v2-card4-20261101/screenshots-complete/after-board-900.png) | (44,64) / 1 |

页面采集 0 POST；浏览器资源均为 0。组件四宽图位于 D:/CodexEvidence/pc-admin-design-v2-card4-20261101/screenshots-complete/components-*.png。900 宽保留看板内部横向滚动。

## 4. Stylelint 度量

在 app/pc-admin 运行 npx --no-install stylelint "src/**/*.css" --formatter json（复用锁定 CLI，不联网安装）。与卡 3 比较：

| 规则 | 卡 3 | 卡 4 |
| --- | ---: | ---: |
| declaration-property-value-allowed-list | 0 | 0 |
| color-no-hex | 0 | 0 |
| unit-disallowed-list | 0 | 0 |
| declaration-no-important | 0 | 0 |
| function-disallowed-list | 0 | 0 |
| color-named | 0 | 0 |
| **总计** | **0** | **0** |

共 27 个 CSS 文件，2 个登录文件沿用原配置忽略，25 个实际检查；新增 6 个组件 CSS 全部纳入。未放宽配置或门禁。

## 5. 验证与失败记录

| 检查 | 最终结果 |
| --- | --- |
| npm run migration:build | PASS；911 严格编译模块、911 Node 语法检查；最终输入指纹 de4078da9dc0c53522cd8725ebc8da8dc78eb17d5746ad6b3324519315319c95 |
| node .build/tools/gate.mjs types | PASS；CSS、完整 strict、负向类型检查 |
| node .build/tools/verify-artifact.mjs | ARTIFACT_VERIFIED_NOT_ACTIVATED |
| 相关已注册浏览器子集 | 12 入口 / 27 tests / 27 PASS / 0 FAIL / 0 SKIP / 0 TODO |
| 组件及状态检查 | PASS；Tag 优先级/折叠、20/24/32 头像、四行、长文本、空值、focus/hover/pressed、reduced-motion、预约省略与完整标题 |
| 截图与区域按钮 | PASS；8 张前后页面图 + 4 张组件图，四宽无文档溢出，每区域 primary ≤1，截图过程 0 POST |
| 指令检查 | PASS；19 个工具用例，Git diff --check 通过 |
| 差异检查 | PASS；94 个原 API/状态/控制器调用仅规范化 CRLF 后一致；原 data 属性无减少，包/锁/lint/AGENTS 不变 |

27 项为分批证据：最后一轮测试等待方式修正前已有 21 项通过；修正后补跑 6 项。最终重建仅改变 T41 测试及其 source map，1,249 个非测试制品完全一致；复用的每个测试源码 SHA 与执行文件 SHA 也逐一核验为最终字节。不是在不同生产实现之间拼接通过结果。原批次失败和 NOT_RUN 继续保持原状。

汇总：[validation-complete.json](/D:/CodexEvidence/pc-admin-design-v2-card4-20261101/validation-complete.json)；制品比较：[production-byte-equivalence.json](/D:/CodexEvidence/pc-admin-design-v2-card4-20261101/production-byte-equivalence.json)。

| 注册入口 | tests / PASS |
| --- | --- |
| tests/workbench-startup.browser.test.mts | 1 / 1 |
| tests/workbench-toast-feedback.browser.test.mts | 1 / 1 |
| tests/workbench-detail-restructure.browser.test.mts | 2 / 2 |
| tests/web01-closed-range.browser.test.mts | 2 / 2 |
| tests/t36-team-and-recovery.browser.test.mts | 3 / 3 |
| tests/t37-shared-time-card-list.browser.test.mts | 1 / 1 |
| tests/web01-workbench.browser.test.mjs | 9 / 9 |
| tests/t41-search-production.browser.test.mts | 2 / 2 |
| tests/t41-search-refresh-and-long-pages.browser.test.mts | 2 / 2 |
| tests/t41-search-pending-hint.browser.test.mts | 2 / 2 |
| tests/wbint-t40-reminder-locate.browser.test.mts | 1 / 1 |
| tests/wbint-t42-board-legal-action.browser.test.mts | 1 / 1 |

对象为当前脏工作区本地候选，HEAD 仍是 8ad55a19bf5d3ab6d46e534c345cea17eb634e8a；源码输入指纹与最终 manifest 另记 evidence。只运行 v3-p09 的相关已注册入口子集，不称活动全集、full、certify、现场就绪或用户验收。

首次回归在 T36 停止：9 tests / 7 PASS / 2 FAIL，其后 7 个入口 NOT_RUN，原 summary/TAP 保留。两个失败都在“结果未知”的旧表单子节点定位上超时。定向观测确认实际 POST=202、Toast 含结果未知、原 check-messages 按钮可用；原选择器匹配数 0。将三处结果定位适配为带 conversations 来源的原 Toast 后，原 UUID/版本/精确补充目标和加密恢复用例通过。后一轮 9 tests / 8 PASS / 1 FAIL 暴露空材料提示本就在材料区正文，测试却仍查 Toast；只适配空态定位后，原空页、UNKNOWN 挂载、只读回执、拒绝后清正文、不重发与 delivery_attempt=0 断言通过，没有改业务控制器。

剩余入口中的 WEB01 曾为 10 tests / 9 PASS / 1 FAIL：本卡新增的“查看更早”断言处于列表视图，未先切回看板。只补真实视图切换后，原生产 UI 整段用例通过；未改 READ/空数据断言。其后五个入口另跑 8 tests / 8 PASS，前轮各自 NOT_RUN 列表仍保留。

整批回归另保留 23 tests / 21 PASS / 2 FAIL / 后续 3 入口 NOT_RUN：T41 在计数为 50 但展开按钮尚未出现时直接 click(null)。改用现有 clickWorkbenchControl 等待真实控件可见/稳定/可用，保留原 50→51、GET/POST、请求字节和 55 秒刷新断言。最终结果分批列示，并核验测试修正前后生产制品字节一致，不把旧失败改为 PASS。

组件初次检查另保留两项失败：外部展示夹具的 margin+100% 宽导致页面溢出，修正夹具；900 宽超长标题撑宽隐式网格，使用 minmax(0,1fr) 约束卡片。失败日志、初次测量结果和窄屏失败图保留。组件夹具首轮失败图使用固定名，已被后续窄屏失败图覆盖；首图仍见聊天中的原工具输出，未重建冒充原件。

日历边界检查复现空列日期格式化错误：1987-06-02 的半开上界被历史夏令时显示为 06/02，正确末日为 06/01。改为对服务端日历字段直接计算末日，保留原 API 窗口；注册日期浏览器入口增加夏令时、闰日和跨年断言。

确认前候选和用户确认后候选分开构建与记录；不在构建中改写源码。观察脚本启动错误、比较时 CRLF/LF 表示差异均留在任务目录，不冒充产品失败。

## 6. 规范偏差和适用限制

- 当前卡片 DTO 没有 SLA 截止、总时长或剩余比例。本卡不拿 updated_at 或共享跟进预约推算 SLA；编号行的超时显示能力只在合成组件夹具证明，实际页面无相应事实时不显示。
- 卡片 DTO 没有处理人 ID。Avatar 支持人员 ID 稳定哈希，但现有调用回退姓名；没有新增身份读取或头像请求。
- 现有业务合同仍把 RESOLVED 归到已处理列；本卡保留该归属并显示“待确认”，不按第七章位置示例重分组到处理中。
- 列头未新增无来源的排序/更多菜单；现有分页、展开和合法动作保留。
- Tag、StatusBadge、SourceLabel、Avatar 为静态信息组件，不添加点击、pressed 或 loading 行为；提供适用的 disabled、focus-visible、空值与长文本处理。TicketCard 的 hover/active/focus/选中和 reduced-motion 已检查；列加载继续用原 BoardColumnLoading。
- 未运行 Electron 原生、真实企业微信/SSO、现场发送、部署或业务 Gate；本地合成证据不代替这些验收。

## 7. §8.1 与自检

| §8.1 对照项 | 结果与证据 |
| --- | --- |
| 容器 | ✓ 沿用卡 3 左对齐、最大 1440；四宽截图 |
| 标题 | ✓ 沿用 PageHeader；四宽标题位置不变 |
| 主操作 | ✓ 唯一 primary 新报修；截图区域计数断言 |
| 工具栏 | ✓ 沿用单行 Toolbar；≥1280 不换行 |
| 看板列 | ✓ 统一 bg-subtle；圆点状态 + 主文字 + 计数 |
| 卡片标签 | ✓ 不重复列阶段，来源移至元信息，彩色 Tag ≤2 |
| 卡片底部 | ✓ Avatar、相对时间、未派单占位；SLA 受上节数据缺口限制 |
| 已处理空列 | ✓ 使用服务端北京时间日期窗口；查看更早复用原 all 过滤，READ 不扩大 |

| 自检 | 是/否 + 证据 |
| --- | --- |
| 只改视觉，不改业务行为/请求/状态 | 是；94 处控制器/状态/API 调用在仅规范化 CRLF 后完全相同；原业务回归 |
| 保留测试 class/data，不削弱断言 | 是；旧 data 属性无减少，保留 card-open/ticket-card/owner 等钩子；只适配文案、Toast 与新视觉结构 |
| 新 CSS 无裸色、裸字号、裸圆角、important | 是；Stylelint 0，配置不变 |
| 每个可见区域 primary ≤1 | 是；四宽实际页面及现有 WEB01 区域断言 |
| 适用的 hover/focus/disabled/空数据/长文本 | 是；组件状态夹具；静态组件不伪造交互 |
| 四宽截图均检查 | 是；前后页面图与组件图，滚动和溢出断言 |
| 未自行引入规范外视觉值 | 是；沿用 Token，头像 50% 例外及用户确认的共享预约说明 |

资源关闭：PASS；自有 PG18（max_connections=8）已停止，合成库剩余 0，仅 postgres/template0/template1；其他客户端 0。页面及组件夹具浏览器 processes/profiles/commandTimers/sockets 均为 0。原始日志、失败/NOT_RUN、源码起点、前后图片和停止后的自有 PGdata 保留。下一张卡 5 的技术前置条件已满足；本卡在本地验证处停止，未启动卡 5。

回退按本卡文件清单与 source-before 原始字节逐项撤回，保留卡 0–3 和其余用户改动；不使用 reset/clean，不涉及数据库回滚。GitHub Issues/业务 Backlog 未在本次本地卡中对外更新；下一卡仍只在用户给出任务卡后启动。
