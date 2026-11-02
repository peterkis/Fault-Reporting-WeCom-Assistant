# 卡 14 · 会话

基线：`origin/main@bf5073db934348046155e006873b50075e7a1ac2`；前置卡 8 #128、卡 9 #129 已合并。卡 10 #130、卡 11 #131 也已在基线。对应 [v2.1 方案](../../docs/ui/design-system-v2.1.md) §4.3、原型 03；本次任务卡指定头部 60px，优先于方案正文旧值 56px。

## 范围与实现

- 联系人列表固定三行；科室与最近活动时间同排，单行消息预览，状态点与聚合计数，实心蓝色未读数。原来源群筛选移动到工具栏菜单，保留原筛选请求。
- 会话头部 60px；主题选择保留原数据与分页。原接待控制器保持单一挂载，接待按钮通过 React portal 呈现在输入区上方；其它维护操作收进「更多会话操作」。
- 消息按日与渠道变化插入分隔，报修人左灰、工作人员右蓝、内部备注右黄、系统事件居中。保留原消息与已读选择器、滚动锚点、精确投递及权限重读。
- 输入框分段切换，备注模式整体浅黄，主按钮右下；仅 `Ctrl+Enter` 提交，普通回车和 Shift+Enter 换行，保留 IME 防误发。两种用途仍各自持有原草稿及未知结果，互不复制。
- 右栏复用 TicketCard/TicketCardBody；点击在当前页打开只读摘要抽屉，保留打开完整事项的入口。未复制主工作台的命令或修改卡 13 归属的 Workbench.tsx。

## 已确认的规范补充（2026-11-02）

现有会话合同只提供 last_activity_at，没有开始等待时间；联系人来源徽标最多八项，additional_source_count 没有区分群与私聊。不能把最近活动误称等待起点，也不能把截断来源数冒充完整群数。已向用户提出：先显示待接待与最近活动时间；群数显示已知数并在截断时标「至少」；接待横幅使用「X 尚无人接待 · 接待后即可回复」。精确等待、等待红字后续由只读字段补齐后接入。用户已确认「按可靠数据实现」；不新增后端字段，不推算等待。

## 验证目标与资源

本地目标：四宽 1920 / 1440 / 1280 / 900，已接待与未接待两种状态；1080px 高度消息区不低于 540px；只读截图不产生 POST。相关原注册测试覆盖会话收件箱、草稿、IME、读游标、精确投递、权限撤销及往返导航。普通 PR CI 由最终 head 独立验证，不替代 full/certify 或现场验收。

独立 worktree：`D:/Worktrees/pc-admin-v21-card14`。证据：`D:/CodexEvidence/pc-admin-v21-card14-20261102`。自有 PG18：`D:/CodexData/pc-admin-v21-card14-pg`，仅 loopback 53644；测试继续由现有 fixture 创建和精确删除 UUID 合成库。自有临时目录：`D:/CodexData/pc-admin-v21-card14-temp`。node_modules 为指向主工作区现有依赖的只读使用 junction；不改依赖或清理其目标。

无后端、Schema、业务事实、Ticket 状态机、权限能力、命令字段或请求语义变更；无运行时依赖、Feature Flag、真实 Provider、部署或生产数据访问。回退为还原本卡前端提交；关闭原功能沿既有默认关闭选项。

初次构建失败原件保留为 build.log：编辑仍在进行时启动了构建，门禁以 MIGRATION_SOURCE_CHANGED_DURING_BUILD 正确拒绝；不将其产物用于注册测试。冻结修改后重新构建。

## 文件清单

| 文件 | 责任 |
| --- | --- |
| `app/pc-admin/src/features/conversations/ConversationInbox.tsx` | 三行聚合列表、60px 头部、接待横幅、用途分段、分日/渠道分隔及来源筛选入口迁移 |
| `ConversationControl.tsx`（同目录） | 单一原控制器的接待按钮 portal；act 实现逐字保留 |
| `ConversationComposer.tsx`（同目录） | 占位符、右下主操作、Ctrl+Enter；未接待时的输入展示禁用；原 action capability、草稿、fresh authority、send/check 实现保留 |
| `ConversationReadTimeline.tsx`（同目录） | 在原材料项前插入只展示的分隔；原材料 key/data 及已读观测不变 |
| `ConversationAssociatedItem.tsx`（同目录） | 原摘要 query 移出，复用 TicketCard，当前页只读摘要抽屉与完整事项入口，失权清理 |
| `app/pc-admin/src/design/components/Split/Split.tsx`、`conversation-v21.css` | 已有 Split 的会话布局样式；无新 Token 或裸色 |
| `app/pc-admin/src/design/components/Drawer/Drawer.tsx` | 既有更多菜单增加可选可访问名称，默认保持原工单名称 |
| `tests/conversation-inbox.browser.test.mts` | 新增接待/空间/回车边界；更新真实操作步骤以进入摘要抽屉及使用 Ctrl+Enter；原 70 条 assert 调用全部保留，现 87 条 |
| 本文、`docs/ui/evidence/v21-card14/compare-*.jpg` | 本卡独立交付记录，四宽未接待/已接待对照与原型 03 |

`tokens.css`、`heat.ts`、`category-map.ts`、`design-system.md`、`Workbench.tsx`、后端、contracts、API 文档、根索引与 CHANGELOG 均未修改。此卡重构联系人收件箱；关闭原 inbox flag 后的旧服务主题入口保留，只消费共享输入器的键盘/占位符调整。

## 首候选本地验证

本地构建在上述基线上未提交的工作区执行，不能改称最终提交或 merge commit 的新执行。最终输入指纹：`e6b9d2f93df5e713cb788f34ec608fb2b2989c0e5ac3a88b5be6e2459e549916`；manifest SHA-256：`60c5d0a6f470fa9c0f937ed9c099b092c73f30682f3d05ecf626200e897efce8`。

| 检查 | 实际结果 / 原件 |
| --- | --- |
| `npm run migration:build` | PASS；913 strict 模块、913 实际 Node 语法检查、2747 输出；`build-04.log` / `build-manifest-04.json` |
| `node .build/tools/gate.mjs types` | PASS；strict、负向类型、Stylelint、feature ESLint、Token 变量；`types-04.log` |
| `node .build/tools/verify-artifact.mjs` | ARTIFACT_VERIFIED_NOT_ACTIVATED；`artifact-04.log` |
| Stylelint / ESLint | 0 / 0；未定义 Token / 原始色板泄漏 0 / 0 |
| 相关注册数据测试 | 4 文件 / 33 项 PASS，0 FAIL / SKIP / NOT_RUN；`registered-data-04/summary.json` |
| 相关注册浏览器测试 | 6 文件 / 13 项 PASS，0 FAIL / SKIP / NOT_RUN；`registered-browser-04/summary.json` |
| 指令文档 / 工具 | 指令预算与链接 PASS；设计系统/指令工具 21 项 PASS；`agent-docs.log` / `tool-tests.log` |
| 原业务实现 / 原断言 | act、send/check 实现逐字相同；原 70 条 assert 均保留；`business-preservation.json` |
| 四宽、两状态采图 | 8/8 PASS；头部 60px、1 个可见 primary、页面横向溢出 0、采图 POST=0；`capture-after.json` |

数据测试：`pc-admin-design-foundation`、`conversation-inbox-contract`、`conversation-inbox.integration`、`wbint-t22-conversations.integration`。浏览器：`t36-reply-purpose-isolation`、`t36-bound-reply-production`、`wbint-t22-authority-stage`、`wbint-t22-draft-coexist`、`wbint-t22-conversations`、`conversation-inbox.browser`，均为现有注册入口，使用原宿主与 flags；这是相关子集，不称活动 v3-p09 全集、full 或 certify。

### 失败保留

- `build.log`：MIGRATION_SOURCE_CHANGED_DURING_BUILD，未使用该产物。
- `build-02.log`：新增测试在 assert.deepEqual 后被 TypeScript 收窄为 never[]，已改为断言数组副本；业务断言未放宽。
- `registered-inbox-01.log`：漏设 TS_MIGRATION_TEST_DB_ISOLATED，启动前拒绝；该次没有测试执行。后续使用本任务独立 PG 与原隔离标记。
- `capture-after-03.log`：1440px 未接待消息区 535.78px，低于 540px；定位为容器选择器误写导致回退，已修正。最终原断言通过。
- Vite 保留既有大于 500kB chunk 提示；未通过拆包、提高预算或改依赖掩盖。

Electron 原生集成、手动 full/certify、真实企业微信发送、现场、部署与 Gate 批准均为 NOT_RUN。本卡无桌面进程边界改动，不启动 Electron 原生集成。

## 四宽前后与原型

每张图从左到右为修改前、卡 14、原型 03。全部使用合成数据。原型仍含其它卡与示意资料，不把它们记为本卡完成；图像仅展示视觉，不是现场验收。消息区高度单位 px，视口高 1080。

| 宽度 | 未接待：前 → 后 | 已接待：前 → 后 | 对照 |
| ---: | ---: | ---: | --- |
| 1920 | 265.66 → 583.78 | 363.66 → 647.78 | [未接待](../../docs/ui/evidence/v21-card14/compare-1920.jpg) / [已接待](../../docs/ui/evidence/v21-card14/compare-1920-received.jpg) |
| 1440 | 265.66 → 575.78 | 363.66 → 647.78 | [未接待](../../docs/ui/evidence/v21-card14/compare-1440.jpg) / [已接待](../../docs/ui/evidence/v21-card14/compare-1440-received.jpg) |
| 1280 | 223.66 → 583.78 | 321.66 → 647.78 | [未接待](../../docs/ui/evidence/v21-card14/compare-1280.jpg) / [已接待](../../docs/ui/evidence/v21-card14/compare-1280-received.jpg) |
| 900 | 191.66 → 551.78 | 289.66 → 615.78 | [未接待](../../docs/ui/evidence/v21-card14/compare-900.jpg) / [已接待](../../docs/ui/evidence/v21-card14/compare-900-received.jpg) |

首屏彩色面积估算不适用于卡 14（本任务指定卡 10、12）。新增用色均复用已有阶段/提醒/人物语义；没有为追求比例扩大色块。

## 自检与规范偏差

| 自检 | 是 / 否 + 证据 |
| --- | --- |
| 未改业务命令、状态值、权限判断 | 是。前后原 act、send/check 字节对比相同；原 capabilities 判断保持。未接待展示禁用按任务要求，仅限制新输入入口，原未知操作核对仍保留 |
| 测试选择器只增不删；业务断言未放宽 | 是。原材料/class/data 控件选择器保留，70 条原 assert 调用全部保留。测试除新增断言外，还按新抽屉/快捷键修改操作步骤，因此并非“仅文字期望”改动 |
| 新颜色经 Token，Stylelint / ESLint 为 0 | 是。原 Token 复用，最终 gate 两项均 0 |
| 彩色对应阶段 / 紧急 / 类别 / 人 | 是。接待横幅/状态为阶段，未读为行动提醒，回复为沟通人、备注为内部用途，头像沿原稳定哈希；无装饰性色块 |
| 卡片没有未提供 / 未登记 | 是。迷你 TicketCard 不列缺失字段；列表原默认姓名中的“资料未提供”展示后缀收起，真实来源缺失仍在独立来源节如实展示 |
| 有操作权限时每区域恰好 1 个 primary | 是。未接待 TAKEOVER，接待后回复/备注各一个；两状态四宽均断言 1。只读事项摘要无业务写按钮，完整命令仍从原事项入口操作 |
| 热度阈值使用 heat.ts | 否 / 本卡暂不计算。按用户已确认的可靠数据补充，不把 last_activity_at 当等待起点；未写死阈值，精确等待与红字留待只读字段补齐 |
| 四宽与原型并排核对 | 是。四宽、两状态共八张并排图及浏览器几何断言；原型 03 |

另一个实现边界：当前页抽屉是只读事项摘要，保留“打开完整事项”。完整事项抽屉仍归卡 13；本卡未复制其命令/事实或越界修改 Workbench.tsx。

下一卡前提：卡 15 的卡 8/9 前置已满足；卡 12/13 的卡 10/11 依赖也已合并，但本轮均未启动。卡 16 仍须卡 12 合并；卡 14 的完成不代替该条件。

## 审查修补 R1

发布首候选为 `f699ed9459b83b4ffd475aee225cd68940dd7014`。Codex 对同一完整 head 返回一项 [P2](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/132#discussion_r4440484558)：同主题私聊与历史翻页分别定位可能遮挡。

使用现有 fixture 创建 53 个同联系人相关窗口，其中群/私聊两条属于同一 Journey；真实 related GET 返回首 50 项和 next_cursor，确认私聊窗口也在这一页。实测四宽未出现矩形重叠（私聊按钮被当前样式级联覆盖为 relative），但文字均被裁切。保留 `topic-navigation-red.json` 的未复现重叠结果及 `topic-navigation-red-geometry.json` 的文字裁切 FAIL，不把自然通过冒充 RED。

修补采用同一原 TopicPicker 控制器，通过稳定 portal 将“更多主题 / 返回最新 / 私聊窗口 / 读取错误”收进既有「更多会话操作」，在同一容器纵向排列；默认关闭，消息区不被常驻导航覆盖。原查询、cursor、导航目标、blocked 判断均保持；未引入第二个控制器。

新增现有注册浏览器文件内的真实场景：四宽无重叠、无文字裁切、两个入口 hit-test 均可达；实际翻页、返回最新、切入同主题私聊，路径正确且 POST=0。原 70 条 assert 全保留，当前为 97 条。临时探针与永久回归均通过，未在源码留下调试注入。

R1 本地输入指纹 `cb7296b6b5ff0e168772c2aa1c76c9667fb2c17b9529eb403207729b2e91a1cc`，manifest `fd05ddd56485d97c2a4851d36265c5ca3a3ad185043a08edc197b60719006ef8`，绑定 `f699ed9` 上未提交修补工作区。`build-review-02.log`、`types-review-02.log`、`artifact-review-02.log` 均 PASS；相关 Foundation + Inbox 两个原注册文件 26/26 PASS、0 FAIL/SKIP/NOT_RUN（`registered-review-02/summary.json`）。此前首候选 46/46 保留原身份，不混计为 R1 的新执行。

仅补受影响导航状态的四宽截图：[1920](../../docs/ui/evidence/v21-card14/topic-navigation-1920.jpg) / [1440](../../docs/ui/evidence/v21-card14/topic-navigation-1440.jpg) / [1280](../../docs/ui/evidence/v21-card14/topic-navigation-1280.jpg) / [900](../../docs/ui/evidence/v21-card14/topic-navigation-900.jpg)。正常消息状态的八张对照未改称 R1 新采图。

按用户追加同步规则：先提交保存 R1，再 fetch/rebase origin/main，按归属保留主线改动；同步后的基线、冲突处理、完整门禁/相关测试、force-with-lease 与复审结果记录在 PR。该流程不改写上述各候选执行身份。

## 同步 main 与 CI 记录

R1 保存为 `3421180ca503e3eeb4ec4e5d6edf0c347ad7f370` 后，执行 fetch/rebase。origin/main 仍为 `bf5073db934348046155e006873b50075e7a1ac2`，rebase 返回已是最新，冲突文件为空。未覆盖其它卡归属的文件。使用 force-with-lease 更新分支并在 PR 留下基线、冲突列表与结果。

随后在干净的 `3421180c…` 上重新执行两项 lint、migration:build、gate types、原注册 Foundation/Inbox 两文件 26/26 与 verify-artifact，全部 PASS，0 FAIL/SKIP/NOT_RUN。输入指纹仍为 `cb7296b6b5ff0e168772c2aa1c76c9667fb2c17b9529eb403207729b2e91a1cc`；clean-head manifest 为 `7ca3f043edddf84dceb0eaa2c4e15f1cb2859db3ee3050798d96efeba5c453ed`。原件：`sync-state.json`、`registered-sync/summary.json`、`build-manifest-sync.json`。

Codex 第二轮对完整 `3421180c…` 返回没有 major issues；首轮 P2 已回复并解决。最终文档后继的完整 head 与远端结果以 PR 收口记录为准。

| 远端执行 | 对象 | 实际结果 |
| --- | --- | --- |
| [41416760580](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/actions/runs/41416760580) | 首候选 f699ed9459b83b4ffd475aee225cd68940dd7014 | FAIL；已记录 159/245 文件，442 项中 441 PASS / 1 FAIL，余 86 文件 NOT_RUN |
| [41420809740](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/actions/runs/41420809740) | R1 3421180ca503e3eeb4ec4e5d6edf0c347ad7f370 | FAIL；已记录 2/245 文件，21 项中 20 PASS / 1 FAIL，余 243 文件 NOT_RUN |

第一轮失败为原 `wbint-t38-authority.browser` 的撤权后重新授予恢复等待。日志明确停在 regrant-wait，全局 denied 页且无恢复请求；原日志、失败截图和 CI 原件保存在 `ci-first-failed.log` / `ci-first-artifact`。同一原入口在当前干净 R1 本地追加执行 4/4 PASS（`registered-t38-sync`），仅说明本次未复现；本卡未修改认证/权限判断，不能称已修复该历史失败。

第二轮失败为原 `workbench-media-employee-read.browser` 的原生首帧 p95 比较。每模式十样本：旧路径 frame p95 242.70ms，原生 255.20ms，原断言 FAIL；对应中位数 225.60ms / 171.10ms。图片首张/全部 p95、预览字节和 SQL 的改善不能替代首帧 p95 断言。保留 `ci-second-failed.log` / `ci-second-artifact` 的全部指标、源 SHA 和 NOT_RUN。本卡未修改该媒体测试或媒体实现，也未改变阈值、超时、次数或样本。

后继文档提交追加上述实际结果，运行代码保持 R1。继续执行原 245 项入口选择并等待最终 head 的普通 CI；不以本地通过、文档更新或复审替代 CI，不运行手动 full/certify。

## CI 导航等待修补 R2

文档后继 `073a5cf7b20dccae346c777584b96a8f42ccb188` 的 Codex 审查无 major issues；本地重新 build/types/artifact PASS（manifest `b4c3ec484cbb49496f681c139c8e2ae37a461bb3b2b0722c6a678de86d91bae7`）。其全部 2,747 个运行输出与已测 clean R1 逐字节相同；该相等性不冒充新的测试执行。

该 head 的 [CI 41422028496](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/actions/runs/41422028496) 执行到 228/245 文件，586 项中 585 PASS / 1 FAIL，余 17 文件 NOT_RUN。此前媒体和 T38 失败点本轮通过；本轮实际失败在本卡 `conversation-inbox.browser` 的“事项详情 ↔ 会话摘要”往返用例。原日志和 CI 原件保存在 `ci-third-failed.log` / `ci-third-artifact`。

故障为旧 DOM 提前满足等待：摘要抽屉也含 #detail-title；点击“打开完整事项”后，单独等待该 ID 可在路由/完整页尚未完成时返回，下一步访问 .detail-workflows 得到 null。修补在往返开始和每次进入完整事项后，同时等待目标事项 URL、标题及完整页工作流出现。原业务 assert、ID/class/data 选择器和既有等待预算全部保留；不加入固定 sleep、自动重试、跳过或放宽断言。

R2 只修改该测试的导航准备步骤与本文，产品实现保持 R1。后继完整 head 的构建、types、相关注册测试、制品、复审和远端 CI 继续分别记录于 PR，历史三次失败保持原对象与 NOT_RUN。

R2 保存后 fetch 检测到卡 15 [PR #133](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/133) 已合并。再次 rebase 到 `origin/main@cdf4803a3c2018ea41cf4aec2a70bb8503e9a9ef`，四个本卡提交重放成功，冲突列表为空，卡 15 的通知/EmptyState 内容原样保留。重基前对象保存在本地 `refs/archive/pc-admin-v21-card14-pre-card15-sync`；旧测试和失败不改绑到重基后的 head。此次产品界面没有调整，不重写原截图。新基线的干净完整 head 验证与 force-with-lease 更新见 PR 续记。

## 既有媒体回归的计时修补 R3

R2 重基后的 clean head 为 `9eb175363e3313f552da38066a6b02bb8600cbee`。两项 lint、PC typecheck、build、strict types、原注册 Foundation/Inbox 26/26 和 artifact 全 PASS，Codex 复审无 major issues。远端 [41428046099](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/actions/runs/41428046099) 再次停在既有媒体首帧 p95：2/245 文件、20 PASS / 1 FAIL，余 243 文件 NOT_RUN；旧路径 263.40ms、原生 287.70ms，原件保存在 `ci-fourth-failed.log` / `ci-fourth-artifact`。

原[媒体验收](../pc-admin-electron/media-employee-read-2026-10-28.md)定义“点击到视频首帧”，但脚本在 clickWorkbenchControl 之前启动时钟，混入该辅助的滚动、可见性、两帧位置稳定、遮挡和 CDP 检查。附件产品用 onClick 开始 open；document 捕获阶段可在产品处理之前准确记录真实点击，权限、网络和渲染工作仍全部计入。

先在独立诊断副本中对同一 20 个样本记录两个时钟，正式源码/制品未被注入：旧路径/原生辅助开销 p95 38.1/75.7ms；真实点击到首帧 p95 260.5/212.8ms；原窗口 p95 297.3/287.4ms。20 次均为可信点击，且每样本“原窗口 = 辅助开销 + 点击到首帧”误差为 0。该本地原窗口自然通过，不冒充 CI 失败已在本地 RED；两次 CI 原失败仍保留。诊断记录为 `media-dual-clock-run.log` / `media-dual-clock-summary.json`，不是已注册入口的正式执行。

正式修补仅将测试时钟放到目标卡片真实 click 的捕获阶段，并在首帧观察后断言 isTrusted；原 24 条 assert 调用逐字保留，新增可信点击断言后为 25 条。1 次预热、10 次正式样本、所有 p95 改善断言、素材、7 次预览请求、授权/Range/字节/SQL/回退断言和等待预算保持。没有修改媒体产品实现、接口、权限、样本筛选、阈值或默认开关；复用现有受控 FFmpeg 工具，无新依赖。这是按既有定义纠正计时点，历史媒体报告不回写。

R3 的完整 head 检查将额外包含原媒体浏览器入口，并继续执行会话/Foundation 原入口；最终执行数、完整 head 和 CI 结果见 PR。

## 历史队列与控件准备修补 R4

R3 clean head `5944612e84a450f077c16cb11420646df43bed61` 本地两 lint、PC typecheck、build、types、原注册 Foundation/媒体/Inbox 共 28/28、artifact 均 PASS；媒体正式点击到首帧 p95 为旧 273.0ms / 原生 185.8ms，24 条原断言保留并新增可信点击检查。产品输出相对 R2 逐字相同，只有媒体测试及其 map 改变。

该 head 的 [CI 41434625080](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/actions/runs/41434625080) 已通过修正后的媒体原入口，随后在既有 `t11-completion.browser` 第一例失败：152/245 文件，423 项中 422 PASS / 1 FAIL，余 93 文件 NOT_RUN。错误为补问表单尚未出现时调用 textarea setter 的 Illegal invocation；原件为 `ci-fifth-failed.log` / `ci-fifth-artifact`。该 helper 仅为完工字段等待弹窗，未等待其它 textarea。修补统一等待真实、可见、未禁用的 textarea，补问/恢复的打开和提交使用既有 clickWorkbenchControl。原 110 条 assert 全部保留；版本、6 次命令/UUID、处理轮次、回执、权限、隐私断言及预算不变。

同一 head 的 Codex 另报 [P2](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/132#discussion_r4441676048)：历史队列的服务端接待聚合排除了 ENDED，kind 为 UNASSIGNED，但 label 特意为“历史主题”；前端的统一短标签映射错误显示黄色“待接待”。历史队列现直接保留后端 label 并用 neutral；未选中的说明也只提示查看历史沟通。没有更改状态值、capabilities 或接待判断。

新增原 Inbox 浏览器文件内的历史场景：真实 ENDED 详情 capabilities=[]；历史标签中性、没有“领取后可回复”提示；选中后接待横幅隐藏、两种输入禁用、可见 primary=0，导航 POST=0。原会话 70 条 assert 仍全保留，当前 110 条。

仅重拍受影响历史队列四宽：[1920](../../docs/ui/evidence/v21-card14/ended-1920.jpg) / [1440](../../docs/ui/evidence/v21-card14/ended-1440.jpg) / [1280](../../docs/ui/evidence/v21-card14/ended-1280.jpg) / [900](../../docs/ui/evidence/v21-card14/ended-900.jpg)。原 normal/topic 图片保留旧采集身份。补充文件责任为 `tests/workbench-media-employee-read.browser.test.mts` 的计时纠错、`tests/t11-completion.browser.test.mts` 的控件准备及上述四图；其它卡文件不改。
