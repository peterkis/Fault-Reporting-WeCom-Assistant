# 验证与 TypeScript

选择检查、修改迁移工具、生成制品或执行发布认证前读取本页。普通 PR 按 [testing-policy.json](../../plans/testing-policy.json) 选择 profile；入口属性唯一来自 `test-routing.json`，源码范围来自 `scope.json`。旧活动 selection 保留兼容/历史用途。前向依据为 [ADR-0053](../../adr/0053_mvp_delivery_and_test_policy.md)。

## 普通 PR

先说明本次影响，用 `pr-plan.mjs --base <base> --head <head>` 读取真实差异，按类别说明所选与 NOT_SELECTED。默认 head 为 HEAD，本地必须显式提供有效 base；PR 使用事件完整 base/head。重命名双方、删除、多模块和未知生产路径均纳入；坏 base/profile/入口、应执行空集失败。新增业务入口仍登记路由，不能只改策略绕开库存保护。

文档路径只准备严格工具和文档检查，不做应用构建、PG、浏览器或媒体准备。代码/策略路径执行 strict、一次统一应用构建、相关工具/业务与制品校验；PG、浏览器、PyYAML、ffmpeg 从选中入口推导，工具/构建特殊依赖显式登记。构建后用 `runSelection` API 执行去重并集，避免 run-tests CLI 再构建；host、flags、超时、隔离和清理合同保持。Windows 原生由桌面边界或入口需求追加。CI 汇总必须确认计划及所选路径成功；意外跳过、取消、未完成、失败均拒绝。

普通 PR 的 Linux 任务保留服务端、数据库与通用浏览器回归。桌面登录的 `workbench-desktop-session.browser.test.mts` 和 `workbench-desktop-session.gpu.browser.test.mts` 保留在计划中，由 Windows 任务执行原有场景及断言，并上传入口、逐例和系统版本回执。Windows 原生启动、登录交接、集成与打包仍由 Windows 任务验证。发布前分别在 Win10、Win11 目标机验收安装、启动和登录。Windows Server runner 的结果单列。

历史来源与差异保护仍由 SS009 单一 Linux PR job 执行。完整 current 回归为手动 full；当前严格 readiness 与固定历史证明分别为独立 workflow 的手动 certify，不自动运行或成为普通 PR 前置。

下文“预检后执行严格 ready”适用于固定历史复现和发布认证，不是普通迁移 PR 的日常要求。认证器、候选指纹、历史证据、SQL、业务状态、默认 Feature Flag 和生产授权保持原约束。P00 只创建 PR，不运行 full/certify、不自动合并或推进后续阶段；不修改分支保护或 ruleset。

代码适用的本地顺序：`npm.cmd run migration:build` 一次；`node .build/tools/gate.mjs types`；执行计划和直接风险入口（仅需要时准备自有 loopback PG18）；相关工具检查；`node .build/tools/verify-artifact.mjs`；关闭自有资源。已编译工具直接调用 `.build/tools/`，避免 bootstrap/build 旧别名。纯文档用 `migration:tools` 后检查链接及指令预算。

本地子集记录完整路径/数量；新 head 的 CI 结果独立报告。SQL、共享核心/宿主、身份、事务、通知和依赖按影响扩大。新增验证先说明具体风险、现有覆盖缺口及停止条件；旧编号、测试名、验收记录或重复评论不能单独扩大。适用检查通过且缺口关闭即停止扩验；用户明确要求可扩大。本次引入的失败本次修，范围外问题另记，不能以历史分类掩盖。目标变化先收口旧批次的实际执行/未执行，再绑定新范围。

## 四类验证与测试生命周期

| 用途 | 范围与完成条件 |
| --- | --- |
| PR 检查 | 本次差异、直接风险与路由合同；计划所选检查完成 |
| 扩展回归 | 明确风险及覆盖缺口的既有入口；缺口关闭即停止 |
| 人工首版候选验收 | [实际开放能力](../../plans/mvp-release-simplification/README.md#首版能力与验收责任)、主体/对象权限、主链、通知异常与恢复；记录候选、设备、环境和未覆盖项，不等于部署授权 |
| 历史复现 | 固定对象/原合同；原 full/certify 或 SS009 证据仅证明其对应范围 |

测试选择器（class、`data-*`、`id`、URL 参数和接口取值）跟随当前业务词汇（[CONTEXT](../../CONTEXT.md)）：业务词汇或接口取值改名时，源码、样式、契约与测试同次改为新名，不为旧选择器保留兼容别名；早期卡片中的「测试选择器只增不删」不再适用。改名不得顺带删除检查对象、放宽业务或几何断言；被改名的选择器在 PR 中列出新旧对照。

测试分当前必需、按需扩展、历史专用、后续可物理移除；少量历史处置理由只记策略文件。策略文件 `history` 每项写明 class（historical / on-demand / out-of-scope）、风险、处置和自身风险区 `triggers`：`applicable:false` 的旧测试只因改文案、选择器或措辞被编辑时不执行，计划以 `EDITED_NOT_SELECTED` 列出理由；其风险区源码变化时才执行（`RISK_AREA_CHANGED_SELECTED`）。`required` 列出 UNKNOWN 核对、原 UUID 恢复、等待后授权终检、身份/失权、SSE 关键事实五类底线，必须留在默认并集且不能被分类移出。允许随产品更新操作步骤/布局前提，保留有效业务断言；权限、幂等、隐私、恢复退出旧测试前要有替代覆盖。禁止 skip、放宽断言、改报告换通过。物理删除逐项处理路由、别名和消费者；本次保留旧文件/注册库存保护。纯记录后继不要求再生成业务候选或全套复审，原 FAIL/NOT_RUN 与历史 tested_head 不改写。

## 按风险选择已有验证入口

查询或媒体性能改动，复用相关真实 PG/HTTP 测试，在相同装配下比较不同卡片数或文件大小的实际 SQL 次数与耗时；数量断言、端到端时延及资源采样分别记录。夹具准备后的首次请求、预热请求与云端测量各按实际口径报告；数据和既有入口见[性能复盘](../retrospectives/2026-10-29.md#r29-02)。

工作台控件变更沿[共享真实交互辅助](../../tests/helpers/heroui-workbench-controls.mts)，相关入口覆盖可用性、稳定/遮挡、焦点及折叠区域；[已注册回归](../../tests/workbench-detail-restructure.browser.test.mts)提供移动/遮挡的负向与正向证明。修复共用辅助后搜索全部调用方，包括[完整 H5 流程](../../tests/yxx-h5-flow.integration.test.mts)，保留原业务、权限、原 UUID 和资源清理断言。

Electron 下载、认证跳转或窗口边界改动还运行 `package.json` 的实际桌面验证入口，沿[进程驱动](../../app/pc-admin/desktop/process-driver.mts)核文件字节、导航与原生事件。浏览器/接口结果和实际 Electron 结果分别报告；辅助任务的静态检查不替代整合后的编译与进程运行。两类缺口见[复盘](../retrospectives/2026-10-29.md#r29-03)。

## 指令与复盘文档检查

若尚未准备工具且不需要完整构建，先用 `npm.cmd run migration:tools` 准备既有严格工具。已经构建则直接运行 `npm.cmd run docs:agents:check` 和 `node --test .build/tools/check-agent-docs.test.mjs`，同一批检查不再次 bootstrap。普通 PR 在现有构建与类型步骤后运行这两项，不新增工作流，不改变手动 full/certify。

文档检查验证根 AGENTS 的本项目 8 KiB 预算与适用本地 Markdown 路径/锚点；不探测外部网络，不能证明合同覆盖或现场就绪。8 KiB 是本项目预算。

## 历史复现与认证

涉及 `tested_head`、merge-base 或审核快照先读[历史审查规范](../../.github/review/README.md)。该页的严格 ready 命令用于固定历史复现或认证；身份预检通过不等于 readiness。普通 PR 不因该示例自动转为 full/certify。原证据、失败、NOT_RUN 与读取权限继续保留。

## 11. TypeScript 增量迁移编码条款（T00）

下文保留 T00 原条款：语言、strict、单实现及运行时守卫等持续编码约束适用于新增开发；T00/P 批次的进入条件、旧计数、命令与 NOT_APPLICABLE 状态只用于对应历史复现，不作为普通 PR 前置。普通任务使用上文当前策略，按需进入旧迁移记录。

本迁移分支及本 PR 合并后的新增开发遵循 [ADR-0026](../../adr/0026_typescript_strict_incremental_migration.md)。执行入口为 [plans/typescript-migration/README.md](../../plans/typescript-migration/README.md)，本条不改写上文任何已完成状态、业务 Gate 或现场批准。

- 活动后端目标为 Node.js 24 + TypeScript strict + ESM；源码 `.mts`、产物 `.mjs`，相对运行时导入保留 `.mjs`。新增生产 JS/MJS 禁止；现有文件的独立缺陷修复不构成新增模块豁免。
- T00 只记录政策与基线，不安装编译依赖、不改 src/scripts/tests/SQL/Evidence、不改 package 文件。先完成 T01/T02 的管线和宿主验证，再迁移既有生产后缀。
- 181 个主线目标及具体 legacy 文件以 scope.json 为准；测试入口与 helper 以 test-routing.json 为准。临时工具 JS 只能按具体路径、原因和删除阶段登记，当前例外为空，不开放目录级豁免。
- strict 不得被 any、ts-ignore、ts-nocheck、as unknown as 或空检查范围替代；负向类型测试的 ts-expect-error 须有原因。运行时输入守卫、事务、身份、时间和哈希语义保持不变。
- 源码、编译运行树、固定历史 checkout 分别验证；不得保留同名源码双实现、用源码跳板或回退源码掩盖缺失制品。旧 MJS 复制保持原字节，迁移模块只运行本次编译产物。
- T00 缺必要基线时标 BASELINE_INCOMPLETE，types/build 标 NOT_APPLICABLE_T00；不得将历史结果或 Node 22 试跑当作当前 Node 24/PG18 基线。所有批次待真实验收与合并，不自动推进或部署。
