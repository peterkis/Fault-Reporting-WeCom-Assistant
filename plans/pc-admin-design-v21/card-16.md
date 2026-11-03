# 卡 16 · 效率层

状态：实现与本地验证完成；PR、审查、CI 与合并状态以 GitHub 当前记录为准。本次用户已明确授权提交、推送、创建 PR、请求 @codex review、修复 P1/P2 后合并。

- 基线：`origin/main@bb7ebf116f4eb41c83eaf882c6c30fa301f6a3e2`；卡 12 [#134](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/134) 已合并。另核验卡 8 #128、卡 10 #130 合并祖先、heat/category-map 文件及卡 11 service/stage_entered_at 合同均存在。
- 唯一写者：本会话；worktree `D:/worktrees/pc-admin-v21-card16`，分支 `codex/pc-admin-v21-card16`；其它会话资源、用户 stash 与恢复引用保留。
- 用户于 2026-11-03 回复「允许最小接线」：Workbench.tsx 仅接入效率组件、替换侧栏搜索入口及传递新卡呈现参数，不重构卡 13 抽屉。

## 改动摘要与合同

对应 [设计方案 §4.1 / §4.5](../../docs/ui/design-system-v2.1.md) 与原型 01。键盘、命令面板与新卡逻辑位于独立 feature 文件；控件复用设计系统 Button、SearchField、Modal。

- J/K 在可见卡片间上下移动，H/L 切列，Enter 沿原卡片链接打开，E 沿原 BoardActions 领取；N 打开原获权新报修入口，/ 聚焦原高级搜索，? 显示快捷键。
- Ctrl+K、侧栏搜索及 ≤900px 顶栏入口共用一个面板和一个 window keydown 监听器。输入、IME、重复键、组合键、其它弹层及导航栅栏期间暂停全局单键动作；卸载移除监听器。
- 面板沿原获权 search API 搜索工单号、报修人和科室；使用独立且可取消的 query key、首批最多 50 项，输入变化不显示上一条件的结果，非法输入不发请求。新报修读取原 capabilities，通知异常沿原入口开关。
- 详情打开期间沿用原 holdOrder 分组与导航，不进入新卡延后/置顶逻辑。
- 新卡只保留呈现 ID，正文始终取当前 GET；当前筛选不匹配的新卡不计列头提示。滚动或阅读下方时延后插入，列头显示新报修数量，显式查看后在原分组顶部呈现。翻页、排序、筛选和授权上下文变化重置呈现基线。
- 官方状态换列保留 180ms FLIP；新卡滑入及淡黄高亮 2 秒。使用既有阶段 Token，不新增颜色或 Token；系统减少动效时跳过动画，偏好切换时取消正在播放的本卡动画。

输入为键盘/菜单选择及已有获权 DTO，输出为焦点、原路由、只读搜索与原领取入口。无新 API、Schema、数据库、状态机、责任、权限策略、命令体、回执语义、运行时依赖或持久 Feature Flag；真实发送及现场 Gate 均不在本卡范围。

## 文件清单

- `app/pc-admin/src/app/Workbench.tsx`：已批准的最小装配。
- `app/pc-admin/src/features/efficiency/WorkbenchEfficiency.tsx`、`use-board-arrivals.ts`、`efficiency.css`：键盘、面板、ID 呈现。
- `app/pc-admin/src/design/use-board-card-motion.ts`：FLIP、到达动效与偏好清理。
- `app/pc-admin/src/design/components/BoardColumn/BoardColumn.tsx`、`board-column.css`：列头新报修入口，保留行高。
- `tests/pc-admin-card16.browser.test.mts`、`tests/pc-admin-card16-arrivals.browser.test.mts`：7 个新回归。
- `tests/helpers/t42-board-browser-fixture.mts`：合成搜索/新报修选项，显式正常/减少动效测试前提。
- `tests/t41-search-refresh-and-long-pages.browser.test.mts`：通过 / 进入原高级搜索，精确 50 项从既有 title 核对；原状态、权限、分页、GET/POST、回执和次数断言保留。
- `plans/typescript-migration/test-routing.json`：两个新入口加入活动 v3-p09，原注册属性不变。
- `docs/ui/design-system-v2.1.md`、本记录、`docs/ui/evidence/v21-card16/` 四张并排图。

## 四宽视觉证据

每张包含基线、完成后、原型 01 及命令面板。原图与合成 fixture 日志在证据根；基线和完成后 fixture 分别生成，日期/计数/编号有时间差异，不能将其误读为业务变化。原型不含命令面板，数值沿设计规范。四宽常规状态采自 B6；B7 只补折叠状态隐藏规则，常规状态不变，折叠状态另由 B7 真实浏览器回归与 `collapsed-green.log` 核验。

| 宽度 | 对照 |
| --- | --- |
| 1920 | [基线 / 完成后 / 原型 / 面板](../../docs/ui/evidence/v21-card16/compare-1920.jpg) |
| 1440 | [基线 / 完成后 / 原型 / 面板](../../docs/ui/evidence/v21-card16/compare-1440.jpg) |
| 1280 | [基线 / 完成后 / 原型 / 面板](../../docs/ui/evidence/v21-card16/compare-1280.jpg) |
| 900 | [基线 / 完成后 / 原型 / 面板](../../docs/ui/evidence/v21-card16/compare-900.jpg) |

## 验证与资源

- 证据根：`D:/CodexEvidence/pc-admin-v21-card16-20261103`；Node 24.18.0、自有 loopback PG18 55476；每个 fixture 新 UUID 合成库、真实外发关闭。
- 原始基线构建与四宽采图 PASS。最终构建 `build-7.log` PASS：917 个实际编译语法检查，2755 输出；输入指纹 `d1d66cc80200737ae06a8a15144471a408429a11bfcae6def4542330fec7d565`。
- `node .build/tools/gate.mjs types` PASS，strict 与 negative types 均通过；`node .build/tools/verify-artifact.mjs` PASS，manifest `77c9c4966b9ef0593e0156c83bc41b1fdfc4740065172a2cb5d10a28764b7b4a`。
- Stylelint 0、feature ESLint 0；指令文档检查 PASS，工具测试 19/19 PASS。Impeccable 扫描有 1 条既有列头 3px 阶段边线 warning，属已确认方案，本卡不改。
- 功能候选 B6：11 个相关注册入口、65/65 PASS，0 FAIL/CANCEL/SKIP/TODO/NOT_RUN；输入 `1be9d087d2fb2a9909fe353d0d2c7774fef268746a6b973fdb60d8ad1d0d435c`，manifest `18bea0df0c215b579eea8ed66870d56a8d36891ac0b67c7972ef446ff16e778b`，原件 `related-6/summary.json`。
- 收尾 CSS 候选 B7：2 个注册入口、7/7 PASS，0 FAIL/CANCEL/SKIP/TODO/NOT_RUN；仅补折叠侧栏隐藏样式和相应断言，原件 `focused-7/summary.json`。上述运行分别绑定自己的输入，不称为活动全集、full 或 certify。
- 本地结果绑定上述输入与构建对象（基线 head、工作区 dirty=true）；发布 head 的精确 CI 与审查独立记入 PR，不把旧本地运行重绑到后继提交。
- 首屏彩色面积：本卡不设卡 10/12 的重测要求，未借用旧比例作为本轮验收；新增高亮只使用阶段 intake 色。
- 所有浏览器、HTTP/SSE/连接及合成库沿原 fixture 清理。最终合成库为 0、其它客户端连接为 0，自有 PG 已停止、55476 监听为 0；见 cleanup.json。
- full/certify、Electron 原生、现场、部署、真实发送和业务 Gate 为 NOT_RUN。

## 失败保留与修正

- 初次基线构建期间写草稿，触发 `MIGRATION_SOURCE_CHANGED_DURING_BUILD`；草稿保全到 stash 后重建基线通过。首轮采图脚本 Windows ESM 路径错误保留，改为 file URL 后通过。
- 首个候选新增测试缺时间品牌守卫与建单结果判空，strict 拒绝；补原时间守卫与显式 assert，不使用类型逃逸。
- 首轮新用例键盘起点位于列尾，不能假设 J 再 K 回到原位；改为从首张可见卡开始，保留精确 ID 顺序断言。命令面板首次截图发现共享按钮样式覆盖，修正选择器后再核四宽。
- 动效测试显式区分系统偏好；展开列的测试前提保持展开。滚动用例真实捕获列头缩小 2px，改为排序标签保留原行高，精确位置断言不放宽。
- 筛选新卡探针从默认标题改为精确工单 ID；列头计数只计当前筛选匹配的新卡。
- `related-4` 先 8 入口 / 47 项通过；T41 因继承 C 盘 TEMP 失败，后两入口 NOT_RUN。独立 D 盘重跑中，T41 production 2/2 通过；旧刷新用例仍点击已替换的 a.sidebar-search 而失败。沿新 / 入口进入原表单、同步列尾 title 后，在最终候选重新运行全部相关子集。旧 FAIL/NOT_RUN 原件均保留。

- `related-5` 共 65 项，64 PASS / 1 FAIL；唯一失败为既有 SSE 详情导航用例，新卡曾在详情打开时被延后。最终修补仅在原 holdOrder 生效时关闭到达呈现，保留原精确邻接 ID、下一项/上一项断言；后继在最终候选重跑。

- B6 全部 65 项通过后，折叠侧栏探针发现共享 Button 的 display 覆盖旧隐藏规则：`collapsed-red.log` 为 collapsed=true/entryVisible=true。B7 仅在效率层 CSS 补原隐藏规则，并验证折叠后 Ctrl+K 仍可打开面板；不改共享 shell.css 或其它卡文件。

## 自检

| 项目 | 是 / 否与证据 |
| --- | --- |
| 前端未改业务命令、状态值、权限策略 | 是；后端/合同无差异，原领取、UNKNOWN、READ 拒绝回归通过 |
| class/data 选择器只增不删，未放宽业务断言 | 是；旧 class 保留；侧栏入口替换由任务明确要求；T41 只适配进入方式和精确计数呈现位置 |
| 新颜色经 Token，Stylelint/ESLint 0 | 是；新卡背景来自 stage-intake，lint 原件通过 |
| 彩色对应阶段/紧急/类别/人 | 是；本卡新增颜色仅 intake 阶段到达反馈 |
| 卡片没有未提供/未登记 | 是；卡片正文不改，原卡 12 回归与四宽截图核对 |
| 获权业务区域保持唯一 primary | 是；工作台/原业务表单主操作保持；命令面板为菜单，不复制业务 primary |
| 热度沿 heat.ts 常量 | 是；heat.ts、category-map 与既有热度调用不变 |
| 原型并排核对四宽 | 是；上列四张已逐张核对，900px 沿原横向看板和窄屏面板 |

## 偏差、关闭与后继

Workbench.tsx 最小接线例外已获用户确认。按当前卡 16 指令恢复减少动效支持，前向修订 §4.5；卡 12 历史记录仍绑定原交付，不改写旧决定的适用时点。没有新增 Token 或其它未批准视觉值。

关闭方式沿既有能力开关；代码可通过独立 revert 回退。卡 16 为本批最后一张卡，没有自动启动的后继；PR 合并不授予部署、真实发送、现场运行或业务 Gate 批准。

## PR #136 · R1 展示顺序交接修补

- [Codex P2](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/136#discussion_r4449553573) 审查的权威 head 为 `f2f12da9753d5a4bb817ad285e39bd910375e2b9`。问题属实：原 order.current 在到达置顶之前保存排序，打开置顶卡后会回到旧顺序。
- 在到达呈现之后保存当前 ID 序列，由原 holdOrder 接管；禁用到达呈现时立即返回输入序列，不让旧置顶状态参与详情首帧。仍只保存 ID，内容与可读范围始终取当前 GET，不改变业务命令、权限或状态。
- 新增独立展开/折叠两种导航回归：置顶卡打开后原展示顺序不变，下一项准确进入到达前的首张 Ticket，再返回置顶卡；浏览器业务写入保持 0。原 SSE 新到事项进入已冻结分组的断言保留。
- 首轮 R1 测试在折叠列里假设下一张卡必已渲染，实际仅渲染 3 张，属于测试前提失败。`related-8` 的 6 PASS / 1 FAIL 与后续 9 入口 NOT_RUN 原件保留。改为明确展开/折叠前提，并从到达前实际可见 Ticket 取得精确期望 ID；不放宽导航关系断言。
- R1 最终 `build-9.log` PASS（917 语法检查、2755 输出）；输入 `715b6bae9973380c31ff1068c2bb51554f709edf615f85669bdd339e5351d3f2`，manifest `eb741e244ed02b4b135e15d2d12edbb2ad342fac28c3f12f1ab654d1517f9e28`。strict/negative types、Stylelint 0、ESLint 0、artifact PASS。
- 四个直接相关注册入口 28/28 PASS，0 FAIL/CANCEL/SKIP/TODO/NOT_RUN：效率层 8、原领取 6、基础正式 bundle 14。原件 `r1-related-9/summary.json`。这是 R1 的定向集合，不重绑 B6 的 65 项结果，也不称为活动全集或 full/certify。
- 自有合成库、连接、浏览器与 PG 再次按原合同释放，见 `cleanup-r1.json`；本次无视觉参数变更，保留已有四宽常规状态截图。新发布 head 的复审及适用 CI 以 PR 当前记录为准。

## CI 收口与卡 16 新用例就绪修正

- 用户明确要求保留已发现并修好的真实回归，停止继续扩大旧用例适配。此后不再修改旧用例、产品行为、选择集、门禁或超时配置。
- `c610738a` 的第二轮 Codex 审查完成，无发现、无未解决问题。普通 CI 运行 `41558567090` 的第一次尝试：250 入口、822/822 PASS，业务集合无 FAIL/CANCEL/SKIP/TODO/NOT_RUN；工具回归在原 40 分钟 job 总预算处被取消，整体不记 PASS。取消后的 always 数据库清理及制品校验实际均 SUCCESS，制品 manifest 为 `a5f15b49699d946944f8c8950c682e158343eca1bae15068ddf87404d7893c8f`。早先“制品校验未运行”的判断据原件在此更正。
- 对相同 head、相同配置只做一次有界 job 重跑。第二次尝试在卡 16 新增命令面板用例的“切到列表”操作处失败：等待 URL/弹窗容器并不保证新页面及选项已可交互，原直接 `.find(...).click()` 未找到目标。该次 2 PASS / 1 FAIL，后续 249 入口 NOT_RUN；原始日志、截图和两份 ZIP（CRC 已核）均保留于证据根 `ci-attempt1/`、`ci-attempt2/`。
- 仅收紧 `pc-admin-card16.browser.test.mts` 自身的操作前置：等待原新报修表单/列表真正显示、等待目标选项，沿用共享真实点击辅助。原路由、权限、通知开关和 0 写入断言保留；不以扩大旧用例适配或放宽断言解决该失败。
- 本地 `commands-10` 3/3 PASS，strict/negative types、build、artifact PASS；输入 `18f61a7fec32537bbedc4c5f3b9e8136cb278765a8d16da2526a94c20d99a14e`，manifest `3cd9977cde99ae1ebdc5ac10349fbda2bdfdb998d0c1c230fc522fb973b2182c`。生产代码与 `c610738a` 相同，后继发布 head 的审查和原有普通 CI 独立执行。
