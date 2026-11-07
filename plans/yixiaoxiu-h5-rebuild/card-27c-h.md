# 卡 27C-H：H5 已关闭筛选与说明

日期：2026-11-07（Asia/Shanghai）。初始交付本地验证通过。后继 Bot / Grant 接入的范围与结果见本文末尾。未提交、未推送、未创建 PR。

## 基线、归属与范围

- 开工通过 HTTPS fetch 确认 `main` / `origin/main` 均为 `ba469c4013d765566225470ff96c1661a65d5e97`（PR #159 / 27C-A 合并），ahead/behind 为 0/0；依据 [ADR-0056](../../adr/0056_unified_closure_reasons_notify_and_restore.md)。
- 主工作区的 27C-B 正在运行，故本卡使用独立工作树 `D:/worktrees/v219-card27c-h`，分支 `codex/v219-card27c-h`，本会话为唯一写者。开工活动会话清单未发现其它活动 H5 卡；不改 PC 卡所在 checkout。
- 前端范围：报修筛选、共用状态展示、详情关闭说明、中英文、DEV 合成预览和已有前端测试。未改后端、contracts、`app/h5/src/api/*`、依赖、SQL、开关。
- 只消费 A 卡现有 `CLOSED_OUT` 和 `closure_text`。后端已将 COMPLETED 限定为 CLOSED / RESOLVED；本卡不在当前页过滤冒充全量查询。
- Windows / Node 24.18.0 / PostgreSQL 18；本地合成验证，不代表企业微信真机、部署、真实通知或 Gate 批准。

## 编号交付

| 编号 | 结果与证据 |
| --- | --- |
| H1 | 已完成：已完成之后增加“已关闭 / Closed”，提交 CLOSED_OUT；完成标签统一为“已完成 / Completed”。浏览器分别核对完成 1 条、关闭 3 条；既有 V2 集成检查服务端两组状态精确归属。 |
| H2 | 已完成：CANCELLED / DUPLICATE_LINKED → closed / 中性色；详情状态下显示 closure_text，纯文本渲染；通用“已关闭”仅保留本地化状态标签，null / 缺省不推断原因；关闭后不显示补充、催单、评价或未解决操作。 |
| H2-语言与主题 | 已完成：浅色/深色 × 中文/英文，20 张 390×844 截图。服务端固定关闭说明保持原文（当前服务端为中文），前端状态、筛选和界面标签本地化。 |
| API / 统计 | 已确认无需修改：27C-A 已提供筛选枚举、解析字段与完成/关闭计数区分；本卡沿原请求、分页和缓存机制。 |
| H5 体积预算 | 已完成：初始 gzip 109125 B；reports 115791 B；request 120468 B 为最大路由，低于 122880 B，余量 2412 B。 |

## 文件清单

| 文件 | 用途 |
| --- | --- |
| [Reports.tsx](../../app/h5/src/pages/Reports.tsx) | 增加已关闭筛选 |
| [report.ts](../../app/h5/src/lib/report.ts) | 两种关闭终态统一映射，沿现有中性 tone |
| [Detail.tsx](../../app/h5/src/pages/Detail.tsx) | 安全关闭说明与关闭态操作隐藏 |
| [i18n.ts](../../app/h5/src/i18n.ts) | closed 双语及“已完成”名称 |
| [preview.ts](../../app/h5/src/dev/preview.ts) | 既有 DEV fixture / fetch 替身增加 state=closure，三条新报修标题均带“（合成）”；生产构建不包含预览 |
| [yxx-h5-frontend.test.mts](../../tests/yxx-h5-frontend.test.mts) | 扩展原 ETA / 终态测试及精确双语条目计数；测试名、现有选择器保留 |
| 本记录与[截图索引](../../docs/ui/evidence/v219-card27c-h/README.md) | 交付、限制、回退与 20 张截图 |

## 验证策略与实际结果

按 [ADR-0053](../../adr/0053_mvp_delivery_and_test_policy.md) 和 [testing-policy.json](../testing-policy.json)：H5 差异选择既有 `yxx-h5-rebuild` 12 入口，记录/截图选择 docs。未运行 full/certify、独立 PC 浏览器或桌面验收。

用户要求不提交，因此不伪造一个包含改动的提交 SHA。使用现有 `pr-plan` 的 `parseDiff / planChanges` API 输入实际工作树差异及新记录/截图清单，head 标记 `WORKTREE_UNCOMMITTED`；标准 CLI 的 commit-to-commit 参数不能代表本次未提交差异。

- `npm.cmd --prefix app/h5 run typecheck`：PASS。
- `npm.cmd run migration:build`：首次 PASS；因旧翻译计数修正，生成最终候选，PASS（`build-final.log`）。
- `node .build/tools/gate.mjs types`：首次 PASS（包括 PC Stylelint / feature ESLint、design variables、全量 strict、PC/H5 类型与 negative types）；最终候选 PASS（`types-final.log`）。H5 没有独立 ESLint/Stylelint 配置，未套用 PC 专属视觉规则，也未新增配置；本卡未改 CSS。
- `node .build/tools/verify-artifact.mjs`：首次 PASS；最终候选 PASS（`artifact-final.log`），manifest `df7034756600dd162c04f718eb81d1e6452db786f58047b02dabf8d3fee3c043`。
- `runSelection(..., select(loadRoutes(root), 'selection', 'yxx-h5-rebuild'))`：首次 106 tests / 105 PASS / 1 FAIL，后续 7 入口 NOT_RUN；最终 12/12 入口、192/192 tests PASS，fail/skip/cancel/todo 均为 0（`suite-final/summary.json`）。契约校验包含既有 admin-contracts / v2-contract 入口。
- 浏览器：现有 `launchSystemBrowser` helper、Windows Chrome、DPR=1、visualViewport.scale=1、390×844；真实操作两个筛选，四组合分别验证取消/重复/误报说明、无关闭态动作、无横向溢出。首轮 PASS；最终 fixture 文案确认 PASS（`browser-check-final2.log` / `browser-checks-final.json`），20 张最终截图；四组合均做了视觉复核。
- Impeccable detector：`[]` / exit 0；沿原组件与主题，中性色无需新增 CSS。
- 文档链接/预算检查 PASS；`node --test .build/tools/check-agent-docs.test.mjs` 20/20 PASS；`git diff --check` PASS。工作树路径计划为 docs + h5、12 个入口（`worktree-plan.json`），无后端/contracts/api/*/依赖差异。

原件目录：`D:/CodexEvidence/v219-card27c-h-20261107/`。保留首轮 build/types/artifact/suite 日志、`suite/summary.json`、TAP 与 cases；最终日志独立命名，不重绑首轮 manifest。浏览器脚本和明细在该目录，截图在仓库。

### 已发现并处理的失败

1. 官方预编译语言目录测试精确计数 `458 !== 456`：新增 closed 中英两条消息导致。只更新精确计数为 458，逐条字面量、插值、语言不切换断言均保留。测试名称及原诊断文案中的 456/228 是保留的基线标识，实际循环核验 229 key × 2。
2. 内置浏览器连接不可用；Edge 首次启动 DevTools 超时，自有资源检查为 0/0/0/0；改用显式系统 Chrome 成功。失败日志保留。
3. 最终截图重跑过早，统一构建尚未完成，helper 拒绝缺失 `.build/runtime`；属准备阶段失败，未作为页面失败或 PASS。最终构建完成后重跑 PASS，原准备失败单独保留。

## 旧期望 → 新期望 → 规则编号

| 对象 | 旧期望 | 新期望 | 依据 |
| --- | --- | --- | --- |
| 语言目录数量断言 | 456（228 key × 2） | 458（229 key × 2），新增 closed | U5 / H1、H2 |
| 状态展示 | CANCELLED → cancelled / 已取消；DUPLICATE_LINKED → received / 已受理 | 两者 → closed / 已关闭 / Closed，中性 | U5 / H2 |
| 完成中文文案 | 已解决 | 已完成；只有 CLOSED / RESOLVED | U5 / H1 |
| 筛选选择项 | COMPLETED 为最后一项 | 后增 CLOSED_OUT；两组不混入 | U5 / H1 |
| 详情 | 不展示 closure_text；重复单可能显示开放态动作 | 仅展示服务端安全文本；通用已关闭不重复原因；关闭态隐藏动作 | U1、U4、U5 / H2 |

除语言目录数量外，没有修改旧业务断言的期望；终态、隐私、纯文本、无说明和动作断言均为新增。没有删除测试名或旧选择器，新加 `data-h5-closure-text`。

## U1–U8 适用核对

| 规则 | 本卡处理 |
| --- | --- |
| U1 | 使用 A 卡固定安全 closure_text；不展示或推断内部 note。误报/测试仅显示关闭标签。 |
| U2 | 直接显示服务端返回的完整重复报修说明；不要求或自行生成原单关联。 |
| U3 | 恢复命令/权限由 A/B 卡承担，本卡未修改；状态仍以刷新得到的服务端当前事实为准。 |
| U4 | 未发送通知；不从原因推断已通知。关闭说明是获权读取字段，不是发送结果。 |
| U5 | 完成/关闭筛选与状态区分，复用 A 卡服务端统计。 |
| U6 | 可关闭范围由 A 卡负责，本卡不新增员工命令、不改变状态机。 |
| U7 | 无历史映射或兼容读取；新合成资料沿现有 DEV fixture 与既有测试 helper。没有清理他人开发库或历史 Evidence。 |
| U8 | 员工关闭/恢复权限由 A 卡负责，本卡不改 READ 或角色。 |

## 七项自检

| 项目 | 是 / 否 + 证据 |
| --- | --- |
| 仅修改本卡允许路径 | 是：5 个 H5 源文件、1 个既有测试、记录/截图；后端/contracts/api/* 差异为空。 |
| U1–U8 不自行增减规则 | 是（本卡适用范围）：见上表；不把本卡标成关闭/恢复后端的重新验收。 |
| 内部说明不发送/不返回 H5 | 是（本地已覆盖路径）：前端故意注入 INTERNAL_NOTE 不渲染；既有 V2 服务端集成断言 H5_INTERNAL_CLOSURE_CANARY 不进入详情/entry。任意未来代码路径不作无证据保证。 |
| 没有新增依赖或真实通知 | 是：package/lock、发送器、运行配置零差异；只有本地 preview 与 SDK/outbox 替身。 |
| 无历史兼容，合成数据遵守新规则 | 是：无回填/旧文本推断；本卡数据库只允许 helper 新建并清理隔离 UUID 库。 |
| 选择器只增不删，期望逐项登记 | 是：原名称/选择器保留，上表登记唯一旧数量断言变化及产品前后行为。 |
| 合并后 main 上 PC 与 H5 正常运行 | 否 / NOT_RUN：本次禁止提交、推送及 PR，未合并；只证明隔离工作树构建/适用本地检查，不声称已完成未来 main 联验。 |

## 回退与资源

无数据库迁移、依赖升级或开关变更。未提交阶段回退为审阅后撤销上表六个源码/测试文件的本卡差异；执行前仍须检查没有新增用户改动。记录和失败证据保留。未来合并后按普通 revert 回退本卡，不能同时回退 A 卡合同。

本卡自有资源：Vite `127.0.0.1:5296`；PG18 `127.0.0.1:55507`，data dir `D:/CodexRuntime/v219-card27c-h/pgdata`；Chrome helper 每轮结束核验进程/配置/定时器/socket 全部 0。最终库清单只有 postgres / template0 / template1，所有 helper 隔离库已释放；PG 正常停止（pg_ctl status: no server running），Vite 自有 PID 18768 已停止，5296 / 55507 无监听。自有 PG 目录保留，原因见下文。`node_modules` 只读复用主区依赖的 junction，不安装、不升级、不清理共享目标。分支、未提交工作树和截图保留供用户审阅。


### 自动审批拒绝的清理项

组合清理命令（停止自有 Vite 进程并递归删除 `D:/CodexRuntime/v219-card27c-h`）被自动审批以 `blocked by policy` 拒绝，没有提供更具体原因，命令未执行。随后仅停止已核对归属的 Vite PID 18768 成功；未改用其它手段删除 PG 目录。`D:/CodexRuntime/v219-card27c-h/pgdata` 保持存在且 PG 已停止；该未删除项不记为清理成功。保护主区、27C-B、共享 node_modules、原失败与历史证据。

## 独立复审

基线为 ba469c4013d765566225470ff96c1661a65d5e97。规格与仓库规则由两个独立审查者核对。

- 规格与规则共同发现。无工单的关闭事项原显示“非服务事项”。详情现用已有安全 closure_text 区分实际关闭，误报或测试在中英文中只显示关闭标签。普通 NOT_SERVICE 保持原状态。新增断言对应 U1、U4 和 H2。
- 规格发现。未指派的关闭工单原显示“等待工程师接单”。关闭详情现隐藏空团队卡，已有处理人仍可见。对应 U5 和 H2，四种主题和语言已复验并更新详情截图。
- 契约缺口。无工单事项的列表 DTO 没有 closure_text，旧 Bot/Grant 详情的独立 DTO 也只提供 external_status 文案，缺少结构化状态与安全关闭说明。保留现有契约，待该入口具备安全字段后统一展示。
- 两条查询路径的状态集合一致。关闭说明只渲染安全投影，投影仅使用原因码与可选原单引用。未发现内部说明泄漏。
- 审查轮原件位于 D:/CodexEvidence/v219-card27c-h-review。第一次构建检测到构建期间源码变化，第一次浏览器调用的测试根目录参数不匹配，两次失败原件均保留。最终统一构建、严格类型、制品校验和四组合浏览器复验通过。最大路由 gzip 120507 B，预算 122880 B。
- 最终 H5 回归 12 个入口，192/192 通过，无失败、取消、跳过。预览和隔离 PostgreSQL 已停止，库清单恢复为三个默认库。


## 用户授权的 Bot / Grant 详情接入

用户随后要求更新旧 Bot / Grant 详情对应的 H5 接口、页面和文案。本次授权扩大到共享 Reporter 读取投影、Schema、声明及直接相关测试。上文“没有后端/契约改动”与旧计数保留为初始交付记录。

修改 p2-016-reporter-timeline.mts、p2_016_reporter_ticket_view.schema.json、p2_016_contracts.d.ts、ReporterPage.tsx、reporter/controller.ts、report.ts 和 i18n.ts，并同步 Reporter API 文档与 ADR-0056 前向说明。P2-012 Reporter 刷新浏览器测试及 H5 V2 集成测试补充新字段、状态、清屏和公开投影断言。

共享 Reporter 详情现在必需返回 Ticket Core status 与安全 closure_text。前端直接按结构化状态使用 H5 标签和主题，标题与引导使用中英文目录。取消/重复统一为已关闭，真正完成使用已完成，等待报修人和等待厂商分别展示。通用“已关闭”只保留本地化状态标签，其余关闭说明保持服务端原文并通过 textContent 呈现。关闭说明不含内部 note。状态恢复后清除关闭说明及样式。

原 publicRef 链接和成员/Grant 准入继续经过原授权 Port。Grant 读取在数据查询后重新核验绑定会话，再返回详情与 ETag。页面保留单在途轮询、隐藏暂停、退出和迟到结果 fence。无新增依赖、持久开关或数据库迁移。已有 071 提供关闭记录，缺少当前关闭记录时按原模型失败关闭。

### 本轮期望变化

| 对象 | 旧期望 | 新期望 | 依据 |
| --- | --- | --- | --- |
| 语言目录精确数量 | 458 | 468，增加五个中英键 | 本次页面与文案授权、U5/U6 |
| Reporter 状态 | 旧外部展示文案、蓝色标签 | 结构化状态、H5 本地化标签、关闭中性 | U5、H2 |
| Reporter 时间线 | 工单已关闭 / 工单已撤销 | 工单已完成 / 报修已关闭，新增固定恢复里程碑 | U3/U5 |
| 详情响应 | 无结构化状态及安全说明 | status、closure_text 必需，Schema与解析同步 | 本次接口授权 |

测试名和原选择器保留，新增 closure-text。无工单事项列表缺少关闭标识的限制仍属于列表契约，不由本次 Bot / Grant 更新推断关闭状态。

### 本轮验证

原件目录为 D:/CodexEvidence/v219-card27c-h-reporter。H5 类型检查与统一构建通过，制品 manifest 为 ff24da9526b4dc17fb3c1ddcbf9d34619d3bb2eb3e95bfc310ad779acc53837c。最大路由 gzip 为 120737 B，低于 122880 B。成员/Grant × 浅深主题 × 中英文 × 三种关闭场景共 24 张截图和断言通过，截图已加入索引。最终策略回归和资源状态见下文。

### 并发读取修补与验证记录

独立复核发现终态状态与关闭说明分开查询可能混入不同版本。关闭分支现从同一 SELECT 读取 Ticket 字段及 allowlist closure_public，再生成整个响应。恢复与恢复后再次关闭两个交错用例通过既有 HTTP 命令写入，验证状态、版本和说明一致。此检查覆盖了原有静态状态用例的并发缺口，完成所选回归即停止扩验。

第一次并发测试遗漏恢复命令的 RESTORE_CLOSED 原因码，收到 400。已补齐测试输入，保留 suite-consistent 的失败原件，未将该准备失败作为产品缺陷的 RED 证据。此前接口候选的 60 入口运行在复核发现问题后中止，13 个完成入口和第 14 个未完成入口保留于 suite，另有 superseded-run.json。该轮中止后只清理自有集群中确认归属且没有活动连接的一个 UUID 合成库。

上一次复审记录的 Bot / Grant 详情契约缺口在本轮补齐，当前公开协议与页面均消费 status / closure_text。本次无数据库结构变更，复用迁移 071 的关闭记录。代码回退须同步撤销 Reporter 投影、Schema、声明和前端解析；原授权入口及历史证据继续保留。

最终候选原件分别为 build-verified.log、types-verified.log、artifact-verified.log 和 suite-verified。制品 manifest 为 88882971cf85ad46fbb30aa9851909e0cbf274b6fe9a248e3d0e9a99a673f7e4。最终构建、严格类型（含既有 Stylelint、ESLint）、制品校验及契约检查均通过。路径策略 56 入口加直接 Reporter 相关 4 入口，共 60 入口、425/425 tests PASS，失败、跳过、取消均为 0。真实 PostgreSQL 并发检查及成员/Grant 授权回归通过。

最终候选重新生成 24 张 Reporter 截图（capture-verified.log），保留第一次截图原件。浏览器与本地 HTTP 夹具已关闭，隔离 PostgreSQL 已停止，库清单恢复为三个默认库，55507 / 5296 无监听。保留隔离工作树和证据。

## 两轮独立复审

Code Review 分别执行规格轴与仓库规则轴。OCR Delegate v1.13.6 对工作树执行 preview 与逐文件 rule，选中的 10 个文件全部审查。工具排除的 3 个 .mts 代码与测试文件另行人工复核。4 份 Markdown 和 44 张截图属于交付证据，未计入代码覆盖。规则、清单及发现保存在 D:/CodexEvidence/v219-card27c-h-two-reviews。

两轮均未发现新的生产代码缺陷。补强既有测试，向模拟 Reporter 响应实际注入内部备注，核验 DOM 隔离。四组合浏览器检查增加完成态标签、色调及实际主题断言。PostgreSQL 详情测试增加第二次 Grant 认证失败的断言，验证读取终检拒绝返回结果。未删除原测试选择器。
本轮统一构建、严格类型和制品校验通过，两个定向入口 4/4 通过。manifest b84d037d66d3f17fbd55c7da18f906b4b7199d5c0cd70ec85cf3f2c7b77bf739。本轮只修改测试，上一轮 60 入口 425/425 的证据按原候选保留。隔离 PG 已停止，库清单恢复为三个默认库。
