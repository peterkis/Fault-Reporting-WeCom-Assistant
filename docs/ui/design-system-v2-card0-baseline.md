# PC 管理端设计系统 v2.0：卡 0 接入与基线

日期：2026-10-31。任务范围为本地工具接入和基线记录，对应 [设计系统 §9](design-system.md#九工程约束落地路线与验收)。没有实施后续视觉迁移。

后继记录：§9 保留第四项修复前的失败证据；2026-11-01 的“保存内部备注”secondary 视觉修复及最新自检见 §10。首轮卡 0 的结果、指纹和回执保持原适用范围。

## 1. 改动摘要与身份

在保留现有画面的前提下接入 Stylelint 核心包、CSS 检查脚本和 UI 修改导航，建立可重复比较的 600 条违规基线。

- 分支：`codex/pc-admin-design-v2-card0`。
- 源码起点：`8ad55a19bf5d3ab6d46e534c345cea17eb634e8a`，实际验证对象为该提交叠加本地未提交改动；不能把提交本身称为最终被测候选。
- 最终构建输入指纹：`fd2e237744d02508f91901db453e154a818847db2cd47295c59299c0295bd416`。
- 制品 manifest SHA-256：`0f0bf486757432dc4932ea590a9b52153d4852da093c9b9b11c0fb9fe3dc0b23`。
- 环境：Windows、Node.js 24.18.0、npm 11.9.0、Stylelint 17.16.0、任务自有 loopback PostgreSQL 18、仓库现有 Edge/CDP 测试辅助。
- 未提交、推送、创建 PR、部署或调用真实外部服务。

## 2. 文件清单与保全

| 文件 | 本卡处理 |
| --- | --- |
| `AGENTS.md` | 修改：在按任务读取表增加 PC UI → v2.0 规范、共享组件目录和新增模式先修规范的导航 |
| `app/pc-admin/package.json` | 修改：新增精确开发依赖 `stylelint: 17.16.0` 和 `lint:css` 脚本 |
| `package.json` | 修改：根开发依赖声明同一精确版本，符合统一安装与 `WEB01_DEPENDENCY_LOCK_DRIFT` 检查合同 |
| `package-lock.json` | 修改：根锁文件新增 Stylelint 及其依赖树；新增 100 个包条目，既有包条目未变化 |
| `docs/ui/design-system-v2-card0-baseline.md` | 新增：本报告 |
| `app/pc-admin/.stylelintrc.json` | 用户预置并更名，本卡只校验，内容未修改 |
| `app/pc-admin/src/design/tokens.css` | 用户预置，本卡只校验，没有导入入口或其他样式 |
| `docs/ui/design-system.md` | 用户预置，本卡只读取，内容未修改 |
| `prompts/pc-admin-design-system-v2_prompt.md` | 用户原件，保持不变 |

删除文件：无。未新增运行时依赖、Stylelint preset、插件、工作流或业务代码。根安装使用 `npm.cmd ci --ignore-scripts --no-audit --no-fund`；未生成应用级锁文件。安装前后，136 个 PC 源码和入口文件的 SHA-256 均相同；四个用户预置文件的原始字节均保留。没有修改 DOM、class、data 属性或测试断言。

## 3. 四档前后对照

改动前先独立构建并保存 PC 生产 bundle；最终统一构建后，校验生产 HTML、全部 JS/CSS 和 Vite manifest 与改前存档逐文件字节一致。两阶段截图使用同一套合成库和真实 loopback HTTP，固定浏览器时间、禁用缓存并启用减少动效。改前阶段读取改前存档，改后阶段读取正式运行树；两阶段均不是 Vite dev/preview。

| 部位 | 改前 | 改后 |
| --- | --- | --- |
| 看板，1920 × 1080 | `screenshots/before-board-1920.png` | `screenshots/after-board-1920.png`；PNG 字节一致，像素差 0 |
| 看板，1440 × 1080 | `screenshots/before-board-1440.png` | `screenshots/after-board-1440.png`；PNG 字节一致，像素差 0 |
| 看板，1280 × 1080 | `screenshots/before-board-1280.png` | `screenshots/after-board-1280.png`；PNG 字节一致，像素差 0 |
| 看板，900 × 1080 | `screenshots/before-board-900.png` | `screenshots/after-board-900.png`；PNG 字节一致，像素差 0 |

四档均检查页面没有横向溢出，实际呈现 3 列、9 张折叠状态卡片和“已加载 15 项”。900 宽保持原有纵向分栏行为。人工查看了四档截图。此结果证明本卡的合成浏览器画面保持一致，不代表 v2.0 视觉验收，也不代表 Electron 或真实设备验收。截图采集过程中业务 POST 数为 0；采集结束后浏览器进程、profile、计时器和 socket 均为 0。

## 4. CSS 度量

在 `app/pc-admin` 执行：

```powershell
npx.cmd --no-install stylelint "src/**/*.css" --formatter json --output-file D:/CodexEvidence/pc-admin-design-v2-card0-20261031/stylelint-baseline.json
npm.cmd run lint:css
```

两次均为退出码 **2**，报告 **600 errors / 0 warnings**。这是卡 0 记录的真实失败基线，没有 suppress、自动修复、调整规则或降低 severity。配置和解析错误为 0。

| 规则 | 本卡实际数量 | 与上一卡对比 |
| --- | ---: | --- |
| `declaration-property-value-allowed-list` | 352 | 首张卡，建立基线 |
| `color-no-hex` | 197 | 首张卡，建立基线 |
| `unit-disallowed-list`（均为 rem） | 21 | 首张卡，建立基线 |
| `declaration-no-important` | 14 | 首张卡，建立基线 |
| `function-disallowed-list`（均为 rgba） | 11 | 首张卡，建立基线 |
| `color-named` | 5 | 首张卡，建立基线 |
| **总计** | **600** | 与任务给出的预期总量一致 |

| 文件 | 违规数 |
| --- | ---: |
| `src/style.css` | 489 |
| `src/app/heroui-workbench.css` | 35 |
| `src/features/board-actions/board-actions.css` | 19 |
| `src/features/search/search.css` | 19 |
| `src/features/follow-up/follow-up.css` | 13 |
| `src/features/manual-report/manual-report.css` | 11 |
| `src/features/supplement-follow-up/supplement-follow-up.css` | 11 |
| `src/features/incident-candidates/candidate.css` | 3 |

共匹配 11 个 CSS 文件，其中用户配置排除了 `src/login/Lanyard.css` 和 `src/login/login.css`；其余 9 个实际检查，8 个有违规，`src/design/tokens.css` 为 0。Token 文件沿原配置豁免三项规则；计数不包含登录页。规则报告统计的是诊断条数，同一声明可能触发多条规则，不是不同色值或声明的去重计数。

## 5. 验证、原件与资源

| 验证 | 实际结果 |
| --- | --- |
| 根 `npm.cmd ci --ignore-scripts --no-audit --no-fund` | PASS；592 个包完成安装，有既有传递依赖的 deprecation 提示 |
| `npm.cmd run migration:build` | PASS；一次统一构建；911 个严格编译实现、351 个 legacy、2739 个输出，状态 `STAGED_NOT_ACTIVATED` |
| `node .build/tools/gate.mjs types` | PASS；strict 与 negative-types 均通过 |
| `node .build/tools/verify-artifact.mjs` | PASS；`ARTIFACT_VERIFIED_NOT_ACTIVATED` |
| `npm.cmd run docs:agents:check` | PASS；根指令预算和本地链接检查通过 |
| `node --test .build/tools/check-agent-docs.test.mjs` | PASS；19/19，零失败、零跳过 |
| 活动 `v3-p09` 中的两个相关浏览器入口 | PASS；2 文件、10/10（启动 1 + 工作台 9），零失败、零跳过、零未运行 |
| 四档合成截图与原始 PNG 比较 | PASS，4/4；8 张截图，PNG 字节一致 |
| CSS lint | FAIL，600 条既有违规，作为本卡基线保留 |

浏览器 selection 为 `v3-p09-card0-pc-admin-css-tooling-subset`，通过既有 `loadRoutes` / `select` / `runSelection` 路由，保持已注册 host、flags、超时、断言与清理合同。完整路径：

- `tests/web01-workbench.browser.test.mjs`。
- `tests/workbench-startup.browser.test.mts`。

这是相关子集，不是完整 v3-p09/full/certify。没有运行真实发送、现场业务写库、生产 Provider、Gate 批准或 Electron 原生验证；没有修改业务、身份、草稿、UNKNOWN、权限、实时事件或数据库 Schema。截图辅助脚本和 selection 包装只位于仓库外，不属于生产代码或新增测试入口。

原件目录：`D:\CodexEvidence\pc-admin-design-v2-card0-20261031`。主要文件：`stylelint-baseline.json`、`stylelint-summary.json`、`lint-css-script.log`、`migration-build.log`、`types.log`、`verify-artifact.log`、`screenshots.json`、`screenshots/`、`registered-tests/summary.json`、逐入口 TAP/stderr/case trace。

辅助工具的首次失败也保留：`capture.log` 为脚本导入 Sharp 内部路径失败，未执行浏览器；修正为 Node 原生文件比较后由 `capture-02.log` 记录通过。`registered-tests.log` 为外置包装调用 `select` 时漏传 kind 参数，入口未执行；修正外置调用后实际结果写入 `registered-tests-02.log` 与 `registered-tests/`。两次均未改生产代码或测试断言。

资源清理：全部合成测试数据库已由原夹具删除；停止前仅有任务基线库与 PostgreSQL 默认库，其他客户端连接为 0。已删除本任务基线库，停止任务自有 PostgreSQL（PID 2208），确认 58431 无监听。浏览器沿原辅助完成关闭。`cleanup.json` 记录实际结果。

首次包含递归目录删除的组合清理命令被自动审批拒绝（原始原因仅为 `blocked by policy`），整条命令未执行。后继独立核验及基线库删除/PG 停止已成功；`pgdata/` 和改前 `before-bundle/` 两个磁盘目录保留，没有把目录删除记为完成。日志、首次失败、截图和回执全部保留。

关闭/撤销只涉及本卡新增 lint 脚本和直接开发依赖，并按根锁文件规则重新生成锁文件；用户预置规范、配置、Token 和提示词原件应继续保留。

## 6. 规范偏差

本卡没有新增视觉值或视觉模式，不需要规范补充。用户最初提供的 `stylelintrc.json` 已由用户更名为 `.stylelintrc.json`，本卡使用更名后的原件，没有保留第二份配置。

根 `package.json` 的同步声明是现有统一依赖安装和构建检查的要求，非新增运行时依赖。Stylelint 规则暂不接 CI，未定义变量/JSX/主按钮计数门禁也未在卡 0 扩张实现；后续按对应任务卡接入。现有 600 条违规仍待视觉迁移阶段清零，本卡不能标记 lint 全绿。

## 7. 下一张卡的前置条件与完成标准

卡 0 本地接入与基线已完成。工具、规范导航、四档无视觉变化证明及相关回归前置条件满足；后续卡可以使用此基线，但本卡不自动开始卡 1。lint 仍为 600 条失败基线，最终视觉验收未达成。两个已停用的磁盘目录保留情况见上文，不存在活动 PG 或浏览器资源。

输入为已确认 v2.0 文档、Token 和用户配置；输出为可安装的 lint 工具、UI 导航及本报告。没有 API/Schema/数据库变更；没有 Feature Flag 变化。安全与隐私验证只使用合成夹具；PG 为单一任务自有 loopback 实例，最大连接 8，浏览器逐个启动。后续卡片应以本次实测 600 条作为比较起点，继续保留原选择器和业务断言。卡 1 未开始，本地验证不推进业务 Gate，也不授权提交或发布。

## 8. 逐项自检

按用户后补清单补充。下列“是”仅适用于本卡范围；未涉及的条件注明不适用。“否：尚未验证”不表示已确认存在违规，但不能记作通过。

| 自检项 | 是/否 | 证据与适用范围 |
| --- | --- | --- |
| 只改视觉层，没有改业务行为、请求或状态值 | 是 | 卡 0 仅修改工具配置、依赖声明与文档，连视觉也未改。重新核验 136 个 PC 源码/入口文件哈希均未变化；`source-integrity.json` 和 `source-before.json` 保留原件；截图过程业务 POST 为 0 |
| 测试依赖的 class / data 属性全部保留，没有削弱断言 | 是 | PC 源码哈希不变，`git diff --name-only -- tests app/pc-admin/src` 无输出；既有两个浏览器入口 10/10 通过，未改测试 |
| 本卡新增 CSS 没有裸 hex、裸字号、裸圆角、important | 是（不适用） | 未新增或修改功能 CSS。用户预置 `tokens.css` 为原始值定义处，内容未改、未导入，并沿原配置豁免；不能把全仓既有 600 条违规称为已清零 |
| 每个可见区域 primary 按钮不超过 1 个 | 是（原反例已修复，8/8 通过） | §9 保留原来 2 个蓝色实心按钮的失败；后继修复后，四档抽屉/完整详情页均只剩“接单”1 个蓝色实心按钮，保存备注为 secondary。当前结果见 §10；未将未遍历页面宣称通过 |
| 新组件的 hover / focus-visible / disabled / 空数据 / 超长文本都有样式 | 是（不适用） | 本卡未新增组件，`src/design/` 当前只有用户预置的 `tokens.css`；不以此声称既有组件状态覆盖合格 |
| 1920 / 1440 / 1280 / 900 四宽截图均核对 | 是 | `screenshots.json` 记录四档共 8 张截图，前后 PNG 字节完全一致；四档均已人工查看，页面无横向溢出；范围仅为合成浏览器看板 |
| 遇到未覆盖情况先提出补充建议，没有自行发明值 | 是（本卡未触发） | 没有新增视觉模式或视觉值，没有遇到需要补充取值的实现；预置 Token 保持原字节 |

本次补充不重新运行业务测试，不改变原测试对象。原交付时的报告已保存为仓库外 `baseline-report-at-delivery.md`，其哈希与原 `delivery.json` 一致；后补清单另记于 `self-check.json`，原回执不覆盖。

## 9. 第四项专项验证：确认不通过

用户后继要求实际验证“每个可见区域 primary 按钮 ≤ 1”。本次只增加验证与证据，没有修复 CSS、改变按钮、业务状态机或生产开关。结果为 **CRITERION_FAIL_CONFIRMED**，不再属于“尚未验证”。

### 判定口径与复现

按页面、抽屉、弹窗分别计数，一个按钮只归属最内层区域；排除 hidden、inert、aria-hidden 的后台区域。除显式 primary 标记外，还检查实际计算背景色，纳入旧版蓝色实心按钮，避免仅查 `[data-tone=primary]` 得到错误的零计数。禁用按钮如果仍显示为主色也计入；本次反例中的两个按钮均处于启用状态。

复现使用既有编译后的 `withT11Fixture`、真实 loopback HTTP 和隔离 PostgreSQL 合成库。显式开启仅测试夹具内的内部备注与接单能力，草稿恢复关闭；创建一张待接单合成工单，打开详情，填写内部备注但不提交。

| 同一区域内的按钮 | 原选择器 | 计算背景色 | 实际状态 |
| --- | --- | --- | --- |
| 接单 | `.detail-common-actions .take-and-start` / `[data-action=take-and-start]` | `rgb(49, 95, 237)`（`#315fed`） | 可见、启用、完整位于视口 |
| 保存内部备注 | `.detail-note-composer [data-action=save-internal-note]` | `rgb(49, 95, 237)`（`#315fed`） | 可见、启用、完整位于视口 |

来源为 `app/pc-admin/src/style.css:604` 与 `app/pc-admin/src/style.css:526` 的两处独立蓝色实心声明。备注为空时保存按钮采用禁用灰色，1280 抽屉仅计 1 个；填写后保存按钮变为蓝色，计数升为 **2**。因此只检查空表单会漏掉这个问题。

| 宽度 × 高度 | 待接单抽屉 + 已填写备注 | 待接单完整详情页 + 已填写备注 |
| --- | --- | --- |
| 1920 × 1080 | **2，FAIL** | **2，FAIL** |
| 1440 × 1080 | **2，FAIL** | **2，FAIL** |
| 1280 × 1080 | **2，FAIL** | **2，FAIL** |
| 900 × 1080 | **2，FAIL** | **2，FAIL** |

以上 8/8 场景均保存截图与计算样式，两个按钮均完整位于视口。已确认的反例足以否定“每个可见区域均不超过 1 个”的全称条件，本次不需要把所有其他页面都遍历一遍才判失败，也不把未遍历页面计作 PASS。

### 其他观测与限制

初次观测另覆盖备注为空/已填的 1280 抽屉、处理中工单的四档抽屉与四档完整详情、1280 完工弹窗，共 11 个状态。处理中工单的已填备注页面/抽屉实际计 1 个蓝色实心按钮；完工弹窗计 0 个蓝色实心按钮，未把被隐藏的后台抽屉算入弹窗。它们不抵消待接单场景的超量。

静态盘点记录 273 个 Button/button JSX 节点（含包装层与日历内部按钮），显式 variant 为 secondary 261、ghost 5、tertiary 3，其余 4 个为透传包装/日历内部按钮，没有显式 primary。此计数是源码节点数量，不能解释为同时可见按钮数量；动态计算样式才确认了旧版蓝色按钮反例。

专项共保存 19 个状态截图。浏览器没有提交任何备注、接单或完工请求；初次观测的处理中样本由测试 HTTP helper 单独发起 1 次合成接单作为夹具准备，回执将其与浏览器请求计数分开。四档反例复核没有发起接单请求，浏览器 POST 为 0。没有修改测试断言，也未重新构建或运行全量回归；沿用原构建，开始前校验 manifest 与原候选一致。

原件目录：`D:\CodexEvidence\pc-admin-design-v2-card0-20261031\primary-audit`。

- `static-inventory.json`：按钮节点与强调色 CSS 声明盘点。
- `browser-results.json`：首次 11 状态的区域、按钮计算样式与截图哈希。
- `four-widths/results.json`：四宽、两种详情呈现的 8 个反例及截图哈希。
- `four-widths/screenshots/pending-drawer-{1920,1440,1280,900}.png` 与 `pending-page-{1920,1440,1280,900}.png`：四宽截图。
- `baseline-report-before-primary-verification.md`：专项验证前的报告快照；历史 `self-check.json` 中“尚未验证”的结论保持其原记录含义，不覆盖原回执。

本次静态盘点首次尝试使用不提供旧编译器 AST 接口的 `typescript-web` 时失败，尚未生成盘点结果；后继使用仓库现有 `typescript` 编译器 API 完成盘点，没有新增依赖。实际浏览器验证两批均完成，未发生浏览器用例失败；**验收条件本身失败**由回执明确记录。

后续视觉卡建议将“保存内部备注”改用规范既有 secondary 样式，仅保留当前 Ticket 下一步动作为 primary；无需新增视觉值。本次未实施该调整。卡 0 的工具与基线交付保持完成，第四项视觉验收明确不通过，须在相应视觉卡修复后重新验证。

## 10. 第四项修复：保存内部备注回到 secondary

本节为用户明确授权的视觉修复，收口日期 2026-11-01。§9 的“不通过”和首次 600 条 lint 基线作为历史证据保留；本节记录修复后的候选，不覆盖原回执。

### 改动与范围

只修改 `app/pc-admin/src/style.css` 的两条原有规则：保留 `.detail-note-composer [data-action="save-internal-note"]` 及其 `:disabled` 选择器，撤除蓝底/白字和局部边框、圆角、内边距覆盖，让既有 JSX `variant="secondary"` 与共用控件样式重新生效；禁用态改为既有 `--bg-neutral` 与 `--text-2`。保留原字号、换行和控件最小高度规则。

实际正常态为白底 `rgb(255,255,255)`、主文字 `rgb(55,53,47)`、1px 中性细描边。复用已有 secondary，不增加新视觉值、Token、组件或依赖，也没有导入 v2 Token 文件或启动后续全局视觉卡。

本次仓库文件：`app/pc-admin/src/style.css`（修改）和本报告（更新）。没有删除文件。对修复前冻结的 1792 个源码、合同、测试、包和指令文件逐一核验，唯一变化为上述 CSS 文件；767 个 CSS 选择器逐一比较完全一致。TSX、API、业务/权限/草稿/UNKNOWN、状态结构、测试和断言均未变化。

候选为原 head `8ad55a19bf5d3ab6d46e534c345cea17eb634e8a` 加本地未提交改动；新构建输入指纹 `24856f460a7fa310958ab3f3a950b66da9ba51e37fb34ecd422b0b6564102a0c`，新 manifest SHA-256 `5a4273afd5359dea42dba6af495875639ad2dccf72df0b202c580a629a4c5cbd`。制品保持 `STAGED_NOT_ACTIVATED`。

### 四档前后对照与状态

仍使用待接单工单、填写但不提交内部备注的原反例。检查显式 primary 标记及计算后的蓝色实心背景，按最内层区域计数；两个动作均保持启用并完整位于视口，页面无横向溢出。

| 部位 | 修复前 | 修复后 |
| --- | --- | --- |
| 抽屉，1920 × 1080 | 2 个蓝色实心按钮 | **1 个，PASS**；备注为 secondary |
| 抽屉，1440 × 1080 | 2 个蓝色实心按钮 | **1 个，PASS**；备注为 secondary |
| 抽屉，1280 × 1080 | 2 个蓝色实心按钮 | **1 个，PASS**；备注为 secondary |
| 抽屉，900 × 1080 | 2 个蓝色实心按钮 | **1 个，PASS**；备注为 secondary |
| 完整详情页，1920 × 1080 | 2 个蓝色实心按钮 | **1 个，PASS**；备注为 secondary |
| 完整详情页，1440 × 1080 | 2 个蓝色实心按钮 | **1 个，PASS**；备注为 secondary |
| 完整详情页，1280 × 1080 | 2 个蓝色实心按钮 | **1 个，PASS**；备注为 secondary |
| 完整详情页，900 × 1080 | 2 个蓝色实心按钮 | **1 个，PASS**；备注为 secondary |

前图继续使用 `primary-audit/four-widths/screenshots/pending-{drawer,page}-{width}.png`；后图为 `secondary-note-fix/screenshots/` 中的同名文件。两轮使用独立合成夹具，时间和合成编号可能不同，不作为整图逐像素比较；本次比较目标按钮外观、计算样式、区域计数和溢出。

另核验 hover、pressed、keyboard-focus-visible、空备注 disabled 与 2000 字备注五种状态，区域主按钮数始终为 1。键盘状态实际匹配 `:focus-visible`，禁用保存按钮使用中性背景；2000 字备注不影响按钮可用性或产生横向溢出。沿用共用控件原有交互反馈，没有新增组件或动画。

### 度量与检查

| Stylelint 规则 | 修复前 | 修复后 | 差值 |
| --- | ---: | ---: | ---: |
| `declaration-property-value-allowed-list` | 352 | 347 | -5 |
| `color-no-hex` | 197 | 193 | -4 |
| `unit-disallowed-list` | 21 | 21 | 0 |
| `declaration-no-important` | 14 | 14 | 0 |
| `function-disallowed-list` | 11 | 11 | 0 |
| `color-named` | 5 | 5 | 0 |
| **合计** | **600** | **591** | **-9** |

Stylelint 实际退出码仍为 2，591 条既有违规尚未清零；未改规则、severity 或忽略范围。修改后的两条规则没有裸 hex、裸字号、裸圆角或 important。Impeccable 机械检测退出码 0，结果为空数组。

| 验证 | 结果 |
| --- | --- |
| `npm.cmd run migration:build` | PASS，一次统一构建，911 严格编译实现、2739 输出 |
| `node .build/tools/gate.mjs types` | PASS，strict 和 negative-types 均通过 |
| `node .build/tools/verify-artifact.mjs` | PASS，绑定本节新 manifest |
| 四档抽屉和完整详情页 | PASS，8/8；五种附加状态计数均通过；浏览器 POST 为 0 |
| 相关既有浏览器回归 | PASS，3 文件、12/12，零失败、零跳过、零未运行；启动 1、工作台 9、详情重构 2 |

相关入口采用活动 `v3-p09` 的 `tests/workbench-startup.browser.test.mts`、`tests/web01-workbench.browser.test.mjs` 两个直接子集，并按控件风险追加已注册的 `tests/workbench-detail-restructure.browser.test.mts`；保留它们各自原 host、flags、超时、断言及清理合同。不是完整活动 selection 或 full/certify，没有运行 Electron 原生验收。

首个外置包装错误地假设详情重构入口也属于活动子集，预检以 `SECONDARY_NOTE_SELECTION_MISMATCH` 拒绝，尚未运行测试；后继按真实路由将其作为风险追加入口运行。首次失败日志 `registered-tests.log` 保留，后继结果写入 `registered-tests-02.log` 与 `registered-tests/`。没有为此改动仓库路由或测试断言。

原件位于 `D:\CodexEvidence\pc-admin-design-v2-card0-20261031\secondary-note-fix`，含源码冻结哈希、改前 CSS/报告、构建/类型/制品日志、Stylelint JSON、浏览器区域和状态回执、截图与逐入口结果。

资源清理：原夹具已删除全部逐测试合成库，停止前只有本任务基线库和 PostgreSQL 默认库，其他客户端连接为 0；本任务基线库已删除，任务自有 PG 已停止，端口 58431 无监听。浏览器进程/profile/socket/计时器均为 0。保留失败、日志、截图、回执与此前已停用的磁盘目录，没有尝试递归目录删除。不提交、推送或创建 PR；没有新增数据库 Schema、API 或 Feature Flag，真实发送、部署和 Gate 状态不变。

### 本次七项自检与后续前置条件

| 自检项 | 是/否 | 本次证据 |
| --- | --- | --- |
| 只改视觉，没有改业务行为、请求或状态值 | 是 | 1792 文件对照中只有 `src/style.css` 变化，修改为两条纯样式规则 |
| class / data 选择器全部保留，未削弱断言 | 是 | 767 个 CSS 选择器完全一致；TSX、合同及测试文件原始哈希未变 |
| 新增/修改 CSS 无裸 hex、裸字号、裸圆角、important | 是 | 两条修改后规则只使用已有 Token 与原排版声明；全局 lint 从 600 减少为 591 |
| 每个可见区域 primary ≤ 1 | 是（本次覆盖范围） | 四宽 × 抽屉/完整详情页 8/8，均由 2 降至 1；未对其他未遍历页面作全量通过声明 |
| 新组件的各交互/空数据/长文本状态有样式 | 是（无新增组件） | 使用既有 secondary 和共享反馈；另检查 hover、pressed、focus-visible、空值禁用、2000 字五态的计数与呈现 |
| 四个宽度均截图核对 | 是 | 四宽八图及计算样式已保存，八张均已人工查看，无横向溢出 |
| 遇到未覆盖情况先建议，没有自造值 | 是（未触发新模式） | 完全复用现有 secondary 和已定义 Token，无需新增视觉值 |

原反例视觉条件、相关既有回归与自有活动资源清理均已收口，本次修复完成。正常态文字对比度实算 12.26:1。完整 v2.0 迁移、其余 591 条 lint 及卡 1 不因此自动开始。
