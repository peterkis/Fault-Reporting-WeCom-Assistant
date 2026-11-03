# 卡 17 · v2.1.1 看板收尾

> 最新状态见文末「GPT-6 Astra / xhigh 复核增量」。初次交付的候选、84项结果和截图保持各自原时点；本轮修正后的验证为20入口85项。

> 后续发布授权：用户于2026-11-03明确要求提交、推送、按pr模板创建PR、循环请求`@codex review`并修复P1/P2，审查/适用CI完成后保留历史合并，再快进本地main并清理本票自有分支/工作树。下文“未提交/STOP”为此前本地交付阶段事实，不再限制本次已授权的发布收口；发布、审查和合并身份另以PR及本次外部closeout记录为准。

执行日期：2026-11-03（Asia/Shanghai）。工作树 `D:/worktrees/pc-admin-v211-card17`，分支 `codex/pc-admin-v211-card17`；基于本轮 HTTPS fetch 后的 `origin/main` `c2ab09b518fe97e5b9b6b910455b66a5b746a02d`。本轮唯一写者为本会话。只作本地交付，不提交、推送、创建 PR 或推进 Gate。

## 问题与实现

| 验收问题 / 任务段 | 处理与证据 |
| --- | --- |
| 工具栏 §1 | 移除彩色概况卡，原范围和概况筛选合为五项下划线视图；统计基于当前已加载去重资料。加载、部分失败和本人处理关系不可统计时不显示数字，真实零仍显示。类别、处理人沿原 Select 与筛选状态，支持单项清除；搜索复用原 SearchControls。 |
| 列头 §1b | StageGlyph 分别为虚线环、右半填充环、实心勾；共享 StatusBadge 自动接入阶段标签。列头无色带/顶部色条，计数在标签外，泳道使用 lane Token。 |
| P1-2 | 只有未完成且位置、姓名、科室均为空时显示中性「待补位置」，渠道不参与；覆盖位置、姓名、科室各自存在和全部为空的分支，已处理永不显示。 |
| P1-3 | ≥24h 向下取整为天，保留 5/20/60/240 分钟阈值、tone、ring、起点语义；卡片 title 显示北京时间起点。边界覆盖 23:59、24:00、720h。 |
| P2-1 | 已处理默认最新完成，菜单最新完成/最早完成；选择隐藏处理中未生效的排序及说明。既有排序函数、服务端游标和详情冻结顺序不变。 |
| P2-2 | 更多操作右上、热度悬停让位；整卡链接为拖动区域，旧 data-action 钩子迁移，菜单与合法业务表单保留。鼠标需移动 5px 才启动，触屏保留 250ms 延迟；Enter 打开原详情，Space 可拖动，菜单仍支持键盘。 |
| P1-6② | 未分类 muted 底 + 次级灰 circle-help，无虚线边框，title 为未分类。 |
| P2-11 | PHARMACY_MEDICATION 使用已安装 lucide-react 的 PillBottle。 |

独立的「v2.1 验收报告」未在仓库中找到；问题编号按本次任务卡明确给出的对应关系记录，不自行补配其它编号。参考原型为主工作区未跟踪的用户原件 `docs/ui/prototype/医小修 PC 管理端 v2.1.1 设计原型.html`，只读解包到本轮 Evidence；原件未移动或修改。

## 文件清单

- `app/pc-admin/src/app/Workbench.tsx`：Card 展示、看板排序默认与两层工具栏接线；Shell、侧栏、顶栏及命令/权限装配不改。
- `app/pc-admin/src/design/components/BoardSummary/{BoardSummary.tsx,board-summary.css}`：页签、日期预设、筛选胶囊与局部工具栏样式。
- `app/pc-admin/src/design/components/BoardColumn/{BoardColumn.tsx,board-column.css}`：阶段列头、泳道、排序文案与待受理计数钩子。
- `app/pc-admin/src/design/components/StageGlyph/{StageGlyph.tsx,stage-glyph.css}`（新增），`StatusBadge/{StatusBadge.tsx,status-badge.css}`：共享阶段图形与标签。
- `app/pc-admin/src/design/components/TicketCard/TicketCard.tsx`：未分类 title 与热度起点 title。
- `app/pc-admin/src/design/{heat.ts,category-map.ts,tokens.css}`：天数、药瓶、未分类及本卡授权 Token。
- `app/pc-admin/src/features/board-actions/{BoardActions.tsx,board-actions.css}`：获准的拖动最小接线及悬停样式。
- `tests/pc-admin-card12.browser.test.mts`、`tests/pc-admin-design-foundation.test.mts`、`tests/web01-closed-range.browser.test.mts`、`tests/wbint-t42-board-legal-action.browser.test.mts`、`tests/wbint-t42-board-boundaries.browser.test.mts`：新增直接风险覆盖、展示期望、范围页签真实点击与整卡拖动激活步骤适配；业务状态/权限/请求/回执/次数断言保留。
- `docs/ui/design-system-v2.1.md`：实现前追加本卡前向规则；本执行记录与 `docs/ui/evidence/v211-card17/` 为交付材料。

## 验证范围与停止条件

按 ADR-0053 与 `testing-policy.json` 的 pc → pr-pc + pr-read-safety 选择已有入口，加上本轮修改的注册入口、日期、拖动合法动作和搜索的直接风险入口，去重后运行。保持宿主、flags、单例超时、隔离及清理合同；不运行 full/certify，不扩大到无直接风险的历史全集。

本地未提交，因此使用既有 `planChanges` API 对真实 `git diff` 和新增文件清单形成计划；不将相同 HEAD 的空提交差异冒充 PR 计划。实际对象绑定构建 input_hash 和 manifest，不以 HEAD 代替未提交候选身份。

Evidence 根：`D:/CodexEvidence/pc-admin-v211-card17-20261103`。自有 loopback PG18 为 127.0.0.1:55477；每例复用既有 fixture 新建 UUID 合成库，浏览器读取正式构建 bundle，Sender 沿原夹具模拟。原始日志、TAP、失败截图和未运行项保留。校验表、截图与清理结果在最终验证后追加。

## 已发现并修正的首轮问题

- 首轮 Stylelint 拒绝泳道内阴影写法，改为向内 1px outline，与要求的内描边视觉等效；不放宽 lint。严格可选属性检查要求对缺失 heatStart 显式传 null，已修正。
- `direct-1` 的 8 项为 6 PASS / 2 FAIL：新增日期请求测试过早断言；旧卡片详情测试暴露 handleRef 直接绑定链接时鼠标立即激活拖动，普通点击被吃掉。分别改为有界请求事件等待、5px 鼠标激活阈值；原测试业务断言保持。
- 首轮四宽截图暴露 900px 日期隐藏规则优先级不足及搜索辅助按钮文字截断，已集中修正；首轮截图保留在 `visual-1/`，不冒充最终截图。
- `related-2` 计划 20 入口，实际到达前两入口：9 PASS / 1 FAIL，后 18 入口 NOT_RUN。唯一失败为旧日期浏览器用例仍用程序 `.click()` 操作共享按钮；改为已有真实点击辅助，并等待原按钮可用。日期、scope、精确条数及 0 业务写入断言均保留。
- 确认截图中筛选图标被共享 Select 的后加载 padding 规则覆盖，已仅提高本卡局部选择器优先级；日期触发器同样收紧到 28px，不修改共享组件或 lint。第二轮截图仍保留于 `visual-2/`，最终交付改用 `visual-4/`。
- 一次计划准备（`related-4.log`）尚未运行测试即因 H5 媒体工具前置拒绝：新增的两份截图 JSON 被路径策略正确归为未知路径，触发 MVP 回退的 55 入口。将这两份本任务生成的记录移入外部 Evidence，原字节保留；源码内仅保留用户要求的截图和 Markdown，不修改策略、宿主、断言或超时。重新对真实差异生成 pc + docs 的 20 入口计划后执行。
- `related-5` 实际到达 3 入口：10 PASS / 1 FAIL，后 17 入口 NOT_RUN。旧拖动用例在按下后只发送一次目标移动，没有跨过 5px 激活阈值后的连续移动；仅适配测试为先越过阈值、等真实 dragging，再移动并确认原目标列。全部命令、状态、版本、UUID、回执、次数和当前查询断言不变。`related-6` 首入口已通过完整拖动 → 明确确认 → 原命令 → 官方查询链路。
- `related-6` 实际到达 5 入口：17 PASS / 1 FAIL，后 15 入口 NOT_RUN。唯一失败仍要求「独立手柄以外拖动标题必须选择文字」，与本卡明确的整卡拖拽合同冲突。仅将这一展示前提改测整卡 data 钩子、grab 光标与不再出现独立手柄；其后的键盘等效动作、取消保留输入、0 写入、原状态和减少动效断言均保留。该文件 4/4 在后继通过。
- `related-7` 实际到达 3 入口：6 PASS / 1 FAIL，后 17 入口 NOT_RUN。旧日期捕图只等已处理列，待受理列尚在加载即断言其卡片几何；失败原图明确显示待受理骨架。改为先等原几何/点击条件本身满足，再执行完全相同的断言，没有增加超时或固定 sleep；`related-8` 的日期入口 2/2 通过。所有 FAIL/TAP/截图/NOT_RUN 仍保留原轮次。

## 最终候选与截图

采图构建为 `build-4.log`：918 个实际编译语法检查、2757 输出，状态 STAGED_NOT_ACTIVATED；输入 `19638bad750e494503b393ad113531ac94fd2af76014f0ef604d44ccdea1543c`，manifest `f5e8bddde165f356c1706a6094b2626a71946825a71cfa8aa41c79b221f84ed5`。`types-4.log` 的 strict / negative types PASS；`stylelint-4.log` 与 `eslint-4.log` 为 0；`artifact-4.log` PASS。

后续只适配旧测试的交互/就绪前提，没有继续修改生产代码。最终构建为 `build-7.log`：918 个实际编译语法检查、2757 输出；输入 `8b7dc66c2c821bc68c358c74aba83fb983e03b87f65fb788a3f50d5fa7fa8dac`，manifest `799a3877e84d67c0eed44ccc5728d7ca9bc189245c90d970e1bf65fd8447709e`。`types-7.log` strict / negative types、`artifact-7.log` PASS；Stylelint/ESLint 源码与采图构建相同，均 0。最终构建与采图构建的全部 142 个 Web 输出逐路径、逐哈希完全相同，见外部 `delivered-ui-proof.json`；因此保留原始四宽采图，不将旧测试结果重绑到新候选。中间构建与所有失败继续保留各自身份。Vite 的既有大 chunk 提醒保留，不在本卡调整分包策略。

四宽“改前”均来自仓库 `v21-card16/compare-*.jpg` 的右上完成后视口；裁切位置依据其原对照 HTML 的 object-fit 几何，来源 SHA、裁切坐标和新图 SHA 记在外部 `visual-4/screenshots.json`。没有重建、改写历史图或冒充同一夹具。改后是当前正式 bundle + 既有真实 loopback HTTP/PG 合成夹具；首张 Ticket 在夹具中写入药品服务 code 以验证实际只读投影和 PillBottle，非真实业务分类批准，前后编号/日期/计数不同。

| 宽度 | 前后对照 | 改后原图 | 悬停 |
| --- | --- | --- | --- |
| 1920 | [对照](../../docs/ui/evidence/v211-card17/compare-1920.jpg) | [原图](../../docs/ui/evidence/v211-card17/after-1920.png) | [悬停](../../docs/ui/evidence/v211-card17/hover-1920.png) |
| 1440 | [对照](../../docs/ui/evidence/v211-card17/compare-1440.jpg) | [原图](../../docs/ui/evidence/v211-card17/after-1440.png) | [悬停](../../docs/ui/evidence/v211-card17/hover-1440.png) |
| 1280 | [对照](../../docs/ui/evidence/v211-card17/compare-1280.jpg) | [原图](../../docs/ui/evidence/v211-card17/after-1280.png) | [悬停](../../docs/ui/evidence/v211-card17/hover-1280.png) |
| 900 | [对照](../../docs/ui/evidence/v211-card17/compare-900.jpg) | [原图](../../docs/ui/evidence/v211-card17/after-900.png) | [悬停](../../docs/ui/evidence/v211-card17/hover-900.png) |

另附[生效筛选](../../docs/ui/evidence/v211-card17/active-filter-1440.png)和[中文自定义日期控件](../../docs/ui/evidence/v211-card17/custom-1440.png)。四宽页面横向溢出均 false，primary 均 1，阶段图形均 3；筛选胶囊实测均 30px，日期项均 28px，热度 title 格式均正确。900px 保留原看板内部横向滚动，日期独立收拢下拉。采图业务 POST=0。原始度量在外部 `visual-4/metrics.json`。

## 最终验证结果

环境：Windows、Node 24.18.0、PG18、系统浏览器；正式 bundle、loopback HTTP/独立合成 PG，沿原模拟 Sender。最终输入和 manifest 见上节，全部适用检查完成后停止扩验。

| 检查 | 结果与原件 |
| --- | --- |
| Stylelint | PASS，0 违规；`stylelint-4.log`；最终 `types-7.log` 的 css 阶段同样 PASS，CSS 未再修改。 |
| ESLint | PASS，0 违规；`eslint-4.log`；最终 `types-7.log` 的 feature-syntax 阶段同样 PASS，功能源码未再修改。 |
| `migration:build` | PASS；`build-7.log`，918 语法检查 / 2757 输出，保留 Vite chunk 提醒。 |
| `gate.mjs types` | PASS；`types-7.log`，strict、负向类型、变量检查（47 CSS，未定义/原始值泄漏均 0）。 |
| `verify-artifact.mjs` | PASS；`artifact-7.log`，未激活制品。 |
| 相关注册测试 | **20 入口、84/84 PASS**，0 FAIL / CANCEL / SKIP / TODO / NOT_RUN；`related-8/summary.json`。当前 manifest 为 `799a3877e84d67c0eed44ccc5728d7ca9bc189245c90d970e1bf65fd8447709e`。 |
| 补充筛选探针 | PASS；`filter-clear.log`：类别 × 只清类别，处理人 × 只清处理人；不可统计的本人计数不出现数字，业务 POST=0。只补本次新增清除入口的覆盖缺口，不新增生产逻辑或注册框架。 |
| 四宽截图 | PASS；四宽均无页面横向溢出、单主操作、正确阶段图形/热度 title/控件尺寸，原图与对照如上。 |
| 文档检查与工具 | PASS；`docs-check.log`、`docs-tools.log`（20/20）；最终记录后再读回链接检查。 |

`related-8-plan.json` 保存真实工作区差异、所选 pc/docs profiles、20 入口并集及 NOT_SELECTED 理由。没有运行 full/certify、Electron 原生、真实发送、现场业务写库、部署、人工现场接受或 Gate；本地结果不替代这些授权/验收。

## 自检（逐条）

| 项目 | 是 / 否与证据 |
| --- | --- |
| 只改前端展示层，未改命令、状态、权限和合同 | **是**；后端/合同/shared/package/持久配置无差异；84 项原业务/读取安全与恢复检查通过。 |
| 测试选择器只增不删；改过测试只改文案期望 | 选择器保留/迁移为**是**；按“只改文案”的字面为**否**：本卡还明确要求规则覆盖和整卡拖拽，因此新增测试、适配真实点击/拖动/加载就绪，并将旧手柄专属展示前提替换为新合同。原状态、权限、请求、回执、版本、UUID 和次数断言均未放宽；原失败完整保留。 |
| 新样式经 Token，Stylelint/ESLint 为 0 | **是**；最终 gate 与日志 PASS；新增颜色仅授权的品牌浅描边、lane 和未分类 Token。 |
| 只改本卡文件，未格式化/移动其它区块 | **是**；仅上列文件；`BoardActions.tsx` 最小接线为用户本轮显式批准例外，测试/规范/记录/截图按交付要求同步；Shell、抽屉、会话文件未改。 |
| 与既有改前图作 4 宽对照 | **是**；4 张 `compare-*.jpg` 及 10 张最终原图/悬停/状态图，来源哈希与裁切坐标外部留存。 |
| 问题编号逐条有证据 | **是**；上方 P1-2、P1-3、P1-6②、P2-1、P2-2、P2-11 及 §1/1b 映射，对应测试和截图已列明。 |

## 资源与停止状态

`cleanup.json` 已读回：合成库 0、其它客户端连接 0、自有浏览器进程 0，PG `status` 退出 3（已停止），55477 和原型 5197 监听均 0。各测试沿原 lifecycle 释放浏览器/profile/socket/命令计时器和 UUID 合成库。原型临时页已关闭，原用户浏览器页面保留。

工作树、分支、编译运行树、停止的 PG 数据目录与原始报告/失败/截图保留。本轮没有提交、推送、PR、合并、部署或启动卡 18/19。当前交付状态为 **LOCAL_VALIDATED / UNCOMMITTED / STOP**。

## 规范偏差与范围例外

- 用户本轮明确批准 `BoardActions.tsx` 最小接线例外；为避免拖动吞掉详情点击，附带配置同一库的激活阈值和键盘 Enter/Space 分工，不改变任何业务动作或请求。
- Token 范围按任务明确授权补充 `--border-brand-subtle`、`--lane-*` 和未分类 Token；泳道内边用向内 outline，原因是现有 Stylelint 的阴影值白名单不允许该 inset 写法。没有新增依赖或修改 lint 配置。
- 会话右栏迷你卡 `ConversationAssociatedItem.tsx` 的阶段信息目前为普通文字「当前状态 · …」，没有阶段 StatusBadge；按跨卡边界保留，交卡 19 后续处理。其详情区已有 StatusBadge：当现有文字为阶段名（如处理中）时自动换用 StageGlyph；子状态（如待接单、已关闭）仍按原子状态呈现。未直接编辑抽屉或会话文件。
- 原高级搜索的组合条件继续从搜索框旁的原 disclosure 进入；保留已有条件与请求语义。搜索能力关闭时不伪造搜索框，沿原 capability 控制。

## 回退

交付停留在未提交工作树。可逐文件对照本基线撤回本卡差异；分支、worktree 和原始 Evidence 保留供用户复核，不自动删除未合入资源。无后端、合同、数据库迁移、持久开关或现场配置变更。

## GPT-6 Astra / xhigh 复核增量（2026-11-03）

用户本轮明确要求以 GPT-6 Astra、Extra High 强度的子代理复核，并对照 v2.1.1 原型逐像素检查，允许修正本票视觉偏差。已启动两个相互独立的 `gpt-6-astra / xhigh` 子代理：`card17_standards_review`（规范/失败恢复/断言保全）和 `card17_spec_visual_review`（任务/原型还原）。Root 为唯一源码写者。两代理最终确定的未解决问题均为0，报告保存在外部本轮 Evidence。

本轮 Evidence：`D:/CodexEvidence/pc-admin-v211-card17-review-20261103`；`standards-review.md` 和 `spec-visual-review.md` 保留原发现与修复关闭记录。原型原件 SHA256 为 `cd4d51460e8c9e2e4136892b969f4af40d8369cd0ba419eecbe28d2d62e1ce7c`，01/08 解包副本已与原件 manifest 解压结果逐字节相等核验，没有修改用户原件。

### 发现与修正

| 项目 | 修正与关闭证据 |
| --- | --- |
| 自定义已应用后无选中态 | 独立表达日期选中与弹层展开；关闭后保持白底、shadow-2、600、具体日期和 `aria-current`。仅增加界面选择提示状态；映射仍为原 `range/closed_from/closed_to`。 |
| 手选恰好等于预设 | 本次手选仍显示自定义具体范围；原日期控件只按范围键重挂以保留旧输入重置，不增加持久设置或 API 参数。新增浏览器断言覆盖该场景。 |
| 新提示跨午夜风险 | Astra 在后继静态审查发现旧“今天/近7天”可能覆盖昨日固定范围，已增加当前日有效性守卫，过日后退回具体日期；自定义身份及recent保留。不新增自动日期请求。该守卫经子代理静态复读关闭，未进行真实跨日长时间观察。 |
| 1280双筛选外溢/值过窄 | 修前日期越过工具栏右边界20.14px；修后右边界均1256，值区宽28/39px，处理人短值保留，长类别省略。 |
| 1101断点标签碰撞 | 修前类别胶囊仅20.67px，触发器36px、文字越界；修后按剩余空间让日期自然换行，字段不重叠。≤1100固定换行、≤900收拢继续保留；新增1101/1100边界检查，不强压不可读文字。 |
| 日期细节 | 对齐原型13px、左右12px、组内2px；28px项高保持。 |
| 阶段图形与线条 | 外环1.6；处理中半圆半径3.5；完成白勾采用原型几何。仍为14px SVG、aria-hidden，不改阶段和状态值。 |
| 标签/列头与泳道 | 标签左8/右10，26px高；列头44px、左10。父看板透明，各lane独立着色，去掉短列下方连片灰底；原向内1px描边保留。 |
| 空页头预留/工具栏对齐 | 仅本页具名class去掉不存在副标题的高度预留，没有全局改PageHeader；页签上2px、两侧2px、视图图标14px。1440页签y114、泳道y215、标签(282,227,77,26)，与原型同坐标。 |
| 列表无效 `/` 提示 | 列表原快捷键不会聚焦搜索，仅在已有快捷键有效的看板显示提示，未扩展快捷键或请求行为。 |

继续保留用户明确指定的阶段accent、tertiary计数、Token阴影和现有字体。原型的静态Shell、标题图标/班次、示意文案和业务数量没有移植到真实系统；已有组合筛选入口保留。数值字体与示意数据不同的区域不作整体像素相等声明；核心颜色/尺寸/线条/边界均逐项核对。

### 本轮截图审查步骤

1. 默认看板：四宽均检查并通过，页签/日期/阶段标签和泳道语义正确，无页面横向溢出；900看板内部横向滚动沿原合同。
2. 双筛选：1280同排、1101/1100日期换行，值区可读、触发器和文字不越框；[1280](../../docs/ui/evidence/v211-card17/astra-review/complete-combined-1280.png)、[1101](../../docs/ui/evidence/v211-card17/astra-review/complete-combined-1101.png)。
3. 自定义范围已应用且弹层关闭：当前标记、白底、600和阴影正确；[截图](../../docs/ui/evidence/v211-card17/astra-review/complete-custom.png)。
4. 卡片悬停：热度与菜单间隔8px，菜单不进入类别图标列，原领取入口保留；[截图](../../docs/ui/evidence/v211-card17/astra-review/complete-hover-1280.png)。

| 宽度 | 本轮复核前/修后 | 修后原图 |
| --- | --- | --- |
| 1920 | [对照](../../docs/ui/evidence/v211-card17/astra-review/compare-1920.jpg) | [原图](../../docs/ui/evidence/v211-card17/astra-review/after-1920.png) |
| 1440 | [对照](../../docs/ui/evidence/v211-card17/astra-review/compare-1440.jpg) | [原图](../../docs/ui/evidence/v211-card17/astra-review/after-1440.png) |
| 1280 | [对照](../../docs/ui/evidence/v211-card17/astra-review/compare-1280.jpg) | [原图](../../docs/ui/evidence/v211-card17/astra-review/after-1280.png) |
| 900 | [对照](../../docs/ui/evidence/v211-card17/astra-review/compare-900.jpg) | [原图](../../docs/ui/evidence/v211-card17/astra-review/after-900.png) |

[原型01 / 复核前 / 修后同坐标局部](../../docs/ui/evidence/v211-card17/astra-review/prototype-detail-1440.png)。复核前来自保留的原正式制品，在本轮重新渲染；不是用旧缓存截图冒充新截图。各夹具独立生成，时间/编号/计数不同。原始PNG、JSON度量、来源和SHA在外部Evidence保存；本轮没有据截图宣称完整无障碍或现场接受。

### 构建、验证与保全

原工作树 `.build/runtime` 清理遇到EPERM，原始 `build-1.log/build-2.log` 保留。自动审批审查拒绝了针对 `D:/worktrees/pc-admin-v211-card17/.build/runtime` 的手动递归删除，只给出 `blocked by policy`；该删除没有执行，也没有绕过重试删除。

改用新建的原生隔离验证工作树 `D:/worktrees/pc-admin-v211-card17-review-verify`（detached同一c2ab09b5基线），本票变更/新增文件36份逐字节复制核对。`source-equivalence.json` 以完整输入列表哈希、head、tree证明它与交付工作树的运行输入相同。交付源码仍在 `codex/pc-admin-v211-card17`，旧制品保留；没有提交、推送、PR、合并或修改执行策略。

最终输入 `65b02327f00bd2ad4f740b5708d3818024336712eb1df7d3e2d11acdf0c2be98`，manifest `068a41193f2a4cdbe45888e17e756ab59c78e774e9bf7eed4defa184e7ace382`。`build-isolated-6.log` PASS（918语法检查、2757输出）；`types-complete.log` strict/negative types、`artifact-complete.log` PASS；本轮Stylelint/ESLint及最终gate的CSS/feature-syntax均0，机械样式扫描 `design-detector.json` 为 `[]`。

交付收口时在源码工作树再运行Stylelint/ESLint，`stylelint-complete.log/eslint-complete.log` 均0。一次制品检查调用的cwd仍为保留旧制品的源码工作树，按原保护正确拒绝 `MIGRATION_INPUT_DRIFT`（`artifact-canonical-attempt.log`）；未复用或改写旧制品。随即在输入匹配的隔离验证树重新确认 `artifact-confirmed.log` PASS，与85项结果的manifest完全相等。源码工作树旧 `.build` 当前不作为新候选制品使用，最新可用运行树在上述隔离验证目录。

`tests-complete/summary.json`：**20入口、85/85 PASS，0 FAIL/CANCEL/SKIP/TODO/NOT_RUN**。新增测试锁定自定义持续选中/同预设范围、精确图形与日期样式、双筛选可读区及1101/1100边界；原业务断言保持。

中间 `tests-1`、`tests-final` 各有8 PASS / 1 FAIL、后19入口NOT_RUN：新增等待只看URL和旧选中标记，仍可能命中旧caption。已改为等待新范围的实际可见caption，再作同一断言，没有增加超时或固定sleep；原FAIL/TAP/截图与其它中间构建均保留。预览首次不受支持的fixture组合产生 `P2_012_SCHEMA_DRIFT`，改用既有已验证的合成组合完成审查，没有修改后端或迁移。

本轮 `cleanup.json`：合成库0、其它客户端连接0、自有浏览器进程0，PG status退出3，55477/5197监听均0；所有审查预览页和临时HTTP host已关闭，原浏览器页保留。两工作树、旧/新编译产物、停止的PG目录、报告和失败原件保留供复现。full/certify、Electron、真实发送/现场写库/部署/Gate仍NOT_RUN。最新状态为 **LOCAL_REVIEWED_AND_VALIDATED / UNCOMMITTED / STOP**。

## PR #139 · 第一轮 GitHub Codex 修复（2026-11-03）

用户另行明确授权提交、推送、创建PR、循环 `@codex review`、修复P1/P2、保留历史合并及本地main快进后的本票资源清理。初始发布提交为 `6fa605e645bb68890286bfe010c8c205fd1d6225`，[PR #139](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/139) 的第一轮审查绑定该完整提交。

- Codex发现1项P2：本卡CSS把原搜索提交按钮裁切，展开组合筛选后指针用户没有可见提交动作。仅调整本卡 `board-summary.css`：组合筛选展开或原按钮键盘聚焦时，在搜索框右端显示同一个原生提交按钮，并为文字留位；默认原型布局及所有提交/查询代码保持原样。未编辑 `features/search`。
- 新增原浏览器入口中的实际指针回归：四宽检查按钮可见且无遮挡，在900宽点击，核实际GET搜索请求中的阶段/责任条件、URL和零POST；既有业务断言均保留。[900合成截图](../../docs/ui/evidence/v211-card17/astra-review/github-review-search-900.png)。
- 第一轮CI的 `pr-database` 失败于新增布局断言要求处理人值宽度固定≥39px，累计15 PASS / 1 FAIL、后16入口NOT_RUN。失败截图显示Linux无中文字体、字形为方框，固定Windows文字宽度不能证明实际裁切。改为检查该短值 `clientWidth >= scrollWidth`，保留原来所有边界/最小可读区断言；不改变任何业务状态、权限、请求、回执或次数断言。原日志、原截图及summary完整保存于外部 `D:/CodexEvidence/pc-admin-v211-card17-publish-20261103/ci-round1-artifact/`。
- 验证树以不改工作文件的mixed reset前进至已发布6fa605e，旧执行记录先另存；51份文件逐字节复制。最终运行输入 `47bd9f63883eb0226db6f6ba93fda5ab14970331ffc4538d7c2b768e5419e204` 与交付树相同（`source-equivalence-fix.json`）。
- `build-fix-final.log` PASS（918语法检查/2757输出）、`types-fix.log` PASS、Stylelint/ESLint 0、`artifact-fix.log` PASS（manifest `02a272977204a84c359dba00c283aca0287774a0414d2792f7800cfc45936bcc`）。相关2入口 **12/12 PASS**（卡12/17浏览器10项及既有生产搜索2项），无FAIL/CANCEL/SKIP/TODO/NOT_RUN。新发布head的CI独立验证，不把该提交前manifest重绑到后继提交。
- PG启动首次漏传本票端口，启动了同一自有目录的IPv6默认监听；确认PID/目录后立即停止，以127.0.0.1:55477重新启动再测试，未连接其它PG。结束后合成库0、其它客户端0，已停止该PG。首次启动日志及被后继测试源码更新取代的构建日志均保留。原FAIL/NOT_RUN及旧manifest不改写。

本节仅记录本轮修复；审查线程关闭、后继CI、合并和资源清理最终身份以PR及外部发布收口记录为准。没有执行full/certify、Electron、真实发送、现场写库、部署或Gate。
