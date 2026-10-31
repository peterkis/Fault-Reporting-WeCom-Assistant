# 验证与 TypeScript

选择检查、修改迁移工具、生成制品或执行发布认证前读取本页。活动 selection 只从[迁移执行入口](../../plans/typescript-migration/README.md)的唯一 `ACTIVE_SELECTION` 行读取，入口属性来自 `test-routing.json`，源码范围来自 `scope.json`；历史段落的测试数量不充当当前集合。

## 普通 PR

普通 TypeScript PR 使用活动 selection 的严格类型、一次构建、相关业务/工具测试、制品与自有资源清理；历史来源与差异保护只由 SS009 的单一 Linux PR job 执行。完整 current 回归使用手动 full；当前严格 readiness 与固定历史证明分别使用两个独立 workflow 的手动 certify，R01 记录两条 SUCCESS 运行 URL。具体步骤见 [迁移执行入口](../../plans/typescript-migration/README.md)。

下文“预检后执行严格 ready”适用于固定历史复现和发布认证，不是普通迁移 PR 的日常要求。认证器、候选指纹、历史证据、SQL、业务状态、默认 Feature Flag 和生产授权保持原约束。P00 只创建 PR，不运行 full/certify、不自动合并或推进后续阶段；不修改分支保护或 ruleset。

日常本地顺序沿迁移执行入口：`npm.cmd run migration:build` 一次构建；`node .build/tools/gate.mjs types`；在任务自有 loopback PG18 上执行实际相关的已注册入口及工具回归；`node .build/tools/verify-artifact.mjs`；关闭自有资源。参数、host、flags、超时、隔离及清理沿原注册合同。需要已编译工具时直接调用 `.build/tools/`，避免再调用含 bootstrap/build 的旧别名。

本地只选相关子集时记录完整路径和实际数量，不称其为活动全集；新 head 的远端普通 PR selection 独立完成。源码/SQL/共享宿主/依赖变化按实际影响扩大检查；重复评论本身不构成重跑全部检查的理由。长回归开始前在交付清单写明目标、候选、选择、完成条件与停止条件；用户改变目标后先按原批次收口已执行/未执行计数，再绑定新候选的检查范围。具名 full/certify 合同保持，定向 PASS 不补全旧轮次。

## 按风险选择已有验证入口

查询或媒体性能改动，复用相关真实 PG/HTTP 测试，在相同装配下比较不同卡片数或文件大小的实际 SQL 次数与耗时；数量断言、端到端时延及资源采样分别记录。夹具准备后的首次请求、预热请求与云端测量各按实际口径报告；数据和既有入口见[性能复盘](../retrospectives/2026-10-29.md#r29-02)。

工作台控件变更沿[共享真实交互辅助](../../tests/helpers/heroui-workbench-controls.mts)，相关入口覆盖可用性、稳定/遮挡、焦点及折叠区域；[已注册回归](../../tests/workbench-detail-restructure.browser.test.mts)提供移动/遮挡的负向与正向证明。修复共用辅助后搜索全部调用方，包括[完整 H5 流程](../../tests/yxx-h5-flow.integration.test.mts)，保留原业务、权限、原 UUID 和资源清理断言。

Electron 下载、认证跳转或窗口边界改动还运行 `package.json` 的实际桌面验证入口，沿[进程驱动](../../app/pc-admin/desktop/process-driver.mts)核文件字节、导航与原生事件。浏览器/接口结果和实际 Electron 结果分别报告；辅助任务的静态检查不替代整合后的编译与进程运行。两类缺口见[复盘](../retrospectives/2026-10-29.md#r29-03)。

## 指令与复盘文档检查

若尚未准备工具且不需要完整构建，先用 `npm.cmd run migration:tools` 准备既有严格工具。已经构建则直接运行 `npm.cmd run docs:agents:check` 和 `node --test .build/tools/check-agent-docs.test.mjs`，同一批检查不再次 bootstrap。普通 PR 在现有构建与类型步骤后运行这两项，不新增工作流，不改变手动 full/certify。

文档检查只验证根 AGENTS 的本项目 8 KiB 预算、指令/复盘目录中的本地 Markdown 路径与锚点；不探测外部网络，也不能证明合同覆盖或现场就绪。OpenAI 的默认 32 KiB 是合并指令链的上限，8 KiB 是本项目为根文件选择的预算。

## 历史复现与认证

涉及 `tested_head`、merge-base 或审核快照先读[历史审查规范](../../.github/review/README.md)。该页的严格 ready 命令用于固定历史复现或认证；身份预检通过不等于 readiness。普通 PR 不因该示例自动转为 full/certify。原证据、失败、NOT_RUN 与读取权限继续保留。

## 11. TypeScript 增量迁移编码条款（T00）

本迁移分支及本 PR 合并后的新增开发遵循 [ADR-0026](../../adr/0026_typescript_strict_incremental_migration.md)。执行入口为 [plans/typescript-migration/README.md](../../plans/typescript-migration/README.md)，本条不改写上文任何已完成状态、业务 Gate 或现场批准。

- 活动后端目标为 Node.js 24 + TypeScript strict + ESM；源码 `.mts`、产物 `.mjs`，相对运行时导入保留 `.mjs`。新增生产 JS/MJS 禁止；现有文件的独立缺陷修复不构成新增模块豁免。
- T00 只记录政策与基线，不安装编译依赖、不改 src/scripts/tests/SQL/Evidence、不改 package 文件。先完成 T01/T02 的管线和宿主验证，再迁移既有生产后缀。
- 181 个主线目标及具体 legacy 文件以 scope.json 为准；测试入口与 helper 以 test-routing.json 为准。临时工具 JS 只能按具体路径、原因和删除阶段登记，当前例外为空，不开放目录级豁免。
- strict 不得被 any、ts-ignore、ts-nocheck、as unknown as 或空检查范围替代；负向类型测试的 ts-expect-error 须有原因。运行时输入守卫、事务、身份、时间和哈希语义保持不变。
- 源码、编译运行树、固定历史 checkout 分别验证；不得保留同名源码双实现、用源码跳板或回退源码掩盖缺失制品。旧 MJS 复制保持原字节，迁移模块只运行本次编译产物。
- T00 缺必要基线时标 BASELINE_INCOMPLETE，types/build 标 NOT_APPLICABLE_T00；不得将历史结果或 Node 22 试跑当作当前 Node 24/PG18 基线。所有批次待真实验收与合并，不自动推进或部署。
