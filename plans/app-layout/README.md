# 应用目录整理

2026-10-25 按用户“继续”，完成首批候选中T35/G2两个当前入口收口，更新运行包与可回退增量，见[后继交付](candidate-followup-2026-10-25.md)。旧Source23首批交付及失败保留，最终候选只执行相关选择，不恢复原741完整回归。

2026-10-25 用户将本轮目标调整为“先交付一个通过关键门槛，可回退的小范围上线候选”。旧完整回归按批次正常停止，已完成322/741入口、1517用例通过，419入口未执行；后续仅补齐首批必要验证。该本地交付范围覆盖后文原本轮完整重跑要求，不改写历史结果或正式full/certify合同。当前human-v1候选、G2投递限制及增量回退见[首批候选报告](first-gray-candidate-2026-10-25.md)。

日期：2026-10-22（Asia/Shanghai）。来源：用户确认的整体结构与第一步 PC 管理端迁移计划；本轮仅本地实施和验证，不发布 Issue/PR、不推送、合并或部署。

## 目标与分步状态

整体布局和日常入口见[应用目录](../../app/README.md)。三个应用最终位于 `app/pc-admin`、`app/h5`、`app/server`，继续共享根依赖、锁文件和统一构建；边界稳定后再决定是否使用 npm workspaces。

| 步骤 | 范围 | 本轮状态 |
| --- | --- | --- |
| 1 | 正式 PC 前端迁至 `app/pc-admin`，同步检查、构建和导航 | 已完成本地迁移和验收 |
| 2 | 新 H5 改造收口后迁至 `app/h5` | 2026-10-23 已完成本地迁移和验收 |
| 3 | 后端迁至 `app/server`，明确共享纯函数及运行资源归属 | 2026-10-24 源码迁移及本地验证执行已收口；保留失败，见[详细记录](server-migration-2026-10-23.md) |

此表记录本次本地工作，不代替 GitHub Issue 状态，也不改变既有业务 Backlog 或 Gate。

## 第三步变更合同（2026-10-23）

接续同一隔离工作树、同一 `codex/pc-admin-app-layout` 分支的 PC／H5／Reporter 未提交成果。迁移前 manifest 为 `6592ef7e27e75e16ea6e7fbe44e8e4b9881aad5982b53152a4addc0e861bb49f`，构建输入为 `e6a60fff98eba5c5fcc4f1ffbbcde2f7db7e88d5c82720245276af9d09ac33e4`。完整源码快照、差异、382 项映射、741 个注册入口及完整运行树独立保存在 `D:\worktrees\server-app-layout-validation-20261023`，不覆盖前两步证据。

按 [ADR-0044](../../adr/0044_server_application_layout_and_logical_source_identity.md) 实施：265 个后端源码文件迁入 `app/server/src`，105 个脚本整体迁入 `app/server/scripts`，三个前后端共用纯模块迁入根 `shared`，八个浏览器合同和一个实时客户端归入 PC。继续根依赖与统一构建、TypeScript 原生目录输出、固定历史 legacy 政策和严格检查；79 个 legacy MJS 不转换语言。公共声明仅修正类型导入，SQL、Schema、私有配置、历史 Evidence、固定 checkout 和业务合同保持。

先完成源码、工具、夹具及诊断准备，再生成最终候选，复用同一 manifest 执行全部 741 个注册入口、相关工具、迁移负向检查、进程及浏览器交叉验收。任何构建输入变化均需重新生成候选并重跑完整集合；不同候选数量不合并。保留原宿主属性、flags、超时、资源限制、H5 122880／2048 字节 gzip 预算和 G2 2048 文件上限。

2026-10-24 当前结果：源码迁移及本地验证执行已收口。741 个注册入口共 2841 用例，2802 PASS／39 FAIL，29 个失败入口；全部失败及工具 rename NOT_RUN 保留，不代表无保留验收通过。详细结果、对照与资源回执见[第三步记录](server-migration-2026-10-23.md)。无提交、推送、合并、部署、真实发送、现场业务写库或业务 Gate；不另启大库性能、full 或 certify。回退仅恢复本轮文件映射和接线增量，保留既有 PC／H5／Reporter 成果与所有证据，不重置整个工作树。

## 第二步变更合同（2026-10-23）

接续同一隔离工作树中的已验收 PC／Reporter 候选：构建输入 `b8e07dd1d8133351c162e830ba856773c425186b03ada8cbeb85f12888d0bdf9`、manifest `887196850f3bad97784f488c8086216c6fad6cb054637ec40e3d81b2001de453`。迁移前已冻结完整 2642 文件运行树、10203 文件源码快照、Git 差异和 141 项 H5 文件清单；原件保存在 `D:\worktrees\h5-app-layout-validation-20261023`，不覆盖第一步证据。

本轮只将根 H5 工程迁至 `app/h5` 并调整必要路径。19 个原型文件、22 个固定设计基线文件、字体／图片和哈希清单保持原字节。继续根统一依赖及锁文件，不引入 workspaces、不升级依赖、不拆共享包。跨应用加密恢复仍复用 PC 的同一实现。

运行输出保持 `.build/emit/h5`／`.build/runtime/h5`；页面、资产、原卡片和 Grant 地址保持。HTTP、DTO、OAuth、Cookie／CSRF、权限终检、反馈 UUID／UNKNOWN、默认开关及数据库合同不变。根公共合同和后端目录不移动。

主工作区及其忽略的 `h5/.env.local` 不读取、复制或修改；当前隔离工程不创建该配置。后续整体接入时私有配置目标为 `app/h5/.env.local`，本次仅记录映射，不声明已配置、启动或部署。依赖目录、缓存、原型及 DEV 不进入正式资产。

最终候选一次统一构建后复用制品执行 strict、H5 独立 typecheck、45 个既有注册入口、H5 工具、T01 负向和 Hosts 的 G2 源身份／T02 范围。原 120 KiB gzip／2 KiB 预绘制预算、清单上限及测试宿主属性保持。实际数量、失败和清理回执在完成后追加，不沿用第一步通过数，不运行 full／certify／真实发送／现场写库／部署或业务 Gate。

回退仅撤销本轮 H5 路径及接线增量，按迁移前源码快照恢复对应字节；保留 PC／Reporter 的先前工作，不重置整个工作树。无数据库或依赖回滚。

## 第二步验收结果（2026-10-23）

本轮完成根 H5 至 `app/h5` 的本地迁移，接续第一步 PC／Reporter 工作，无提交、推送、合并、部署或业务 Gate。主工作区仍在原 HEAD，仅有先前的 `.env.example` 未提交改动；其根 H5 和忽略私有配置未迁移。后端目录整理未启动。

141 项文件逐项映射，130 项保持原字节；其余 11 项仅涉及 README、包命令、Vite 接线、根合同及 PC 加密恢复的相对路径。19 项原型、22 项设计基线和字体／图片等合计 56 项固定原件哈希完全一致。旧根源码目录不存在，没有兼容跳板。与迁移前快照比较的 860 项 PC／Reporter、后端非候选清单代码、公共合同、数据库迁移及根依赖等受保护文件无差异。

构建、G2 输入、测试加载器和当前导航按源码位置更新，运行树中的 `h5/` 路径保持。H5 所有生产 TS／TSX 仍受 strict 和源码遗漏检查；私有配置、依赖、设计原件与 DEV 仍排除。G2 候选 2008 项、前端绑定输入 201 项，原 2048 项清单上限及父级链接拒绝保持。详细必要改动见外置 `path-edits.json`、`h5-increment.json` 和 `h5-content-delta.patch`。

| 身份 | 第二步最终值 |
| --- | --- |
| 构建输入 SHA256 | `e6a60fff98eba5c5fcc4f1ffbbcde2f7db7e88d5c82720245276af9d09ac33e4` |
| 编译 manifest SHA256 | `6592ef7e27e75e16ea6e7fbe44e8e4b9881aad5982b53152a4addc0e861bb49f` |
| G2 候选指纹，仅源身份核验 | `6cf53dd18a796b9a42db7496375f62230ae2b778176747ed2be38db0e609fa7f` |

统一构建成功，保留 878 项 typed／351 项 unchecked legacy 输入及 2641 项输出；随后不再 bootstrap。活动 selection strict、`npm --prefix app/h5 run typecheck` 及最终制品校验均退出 0。H5 的 109 项及 PC 的 8 项运行输出与第一步冻结候选逐字节相同；最终 2642 文件完整运行树另行冻结并核验全部文件哈希。

| 注册验收范围 | 入口 | 本候选实际用例 | 原件目录 |
| --- | ---: | ---: | --- |
| PC、原卡片 Reporter、Bot 反馈、权限和候选身份 | 24 | 82/82 | `product-02/` |
| 新 H5 运行、前端、HTTP、V2 与合成数据库流程 | 8 | 193/193 | `h5-02/` |
| 退役客户端夹具及原 API 兼容 | 11 | 85/85 | `legacy-02/` |
| 媒体控制器及性能可观测 | 2 | 80/80 | `extra-02/` |

四组复用上述 manifest，合计 45 个唯一注册入口、440/440 用例，FAIL／SKIP／CANCELLED／NOT_RUN 均为 0；未叠加第一步或中间候选数量。兼容夹具不作为新页面验收。注册入口保留 33 张截图，其中现行 PC／Reporter 27 张、退役夹具 6 张。原卡片、Grant、本人反馈、他人拒绝、UNKNOWN 核对、加密恢复及退出清屏沿用注册宿主、flags、数据库和浏览器隔离合同。

完整 H5 工具为 13/13，T01 构建与负向范围为 27/27，Hosts 的 G2 源预检／T02 路由和清单范围为 19/19，均退出 0、零跳过。负向检查包含新路径输入漂移、遗漏生产 TS／TSX、旧制品、缺失／篡改资产及禁止源码回退；仅修改自有副本。这里的 G2 结果证明源身份合同，不表示业务 readiness 或 Gate 批准。

补充正式 bundle 浏览器验收使用合成身份、真实隔离 PostgreSQL、TLS 和 HTTP。浅／深主题与中／英文四组完成首页、工单列表、详情深链接及刷新，宽度 390／1440，无横向溢出，脚本仍来自既有同源 base。主截图在字体就绪后保存 8 张，见 `browser-acceptance-06/`；结果为 `browser-acceptance-06.json`。这不是企业微信真机验收。开发命令烟测的正确 base HTML、主模块、主题、Reporter、恢复及复用 PC 加密模块六项 GET 均为 200，Vite 文件访问边界未扩大。

启动图 gzip 为 112071 字节；最大路由为 122848，距 122880 上限 32；独立预绘制脚本为 408，低于 2048。所有数值和运行资产与迁移前一致，没有放宽预算或性能／业务改造。文档导航检查、文档工具 19/19 及变更文档本地链接检查通过；外部链接未抓取，具体数量见 `doc-links.json`。

首轮候选的 `legacy-01/` 原始结果为 75 项、74 PASS／1 FAIL，后续 3 个兼容入口 NOT_RUN，未改写为通过。SS-007 容量用例在会话仍显示“正在验证成员会话”时提交；诊断记录显示输入和提交按钮当时均未 disabled。仅加入现有精确会话就绪条件的对照通过，因此只修正该测试的一处等待，原容量、持久化、跨作用域断言和业务实现保持。失败候选已冻结为 `attempt-01-runtime/`，诊断与对照原件均保留。补充浏览器验收的 01／03／04 次尝试分别暴露临时宿主或目录／重开／媒体 Schema 缺项，02 次为外置脚本引号语法错误；修正外置脚本后 05 通过，06 等待字体完成截图。初次文档链接检查器的 Windows 绝对路径解析误判也单独保留，均未混入 440 项业务通过数。

临时开发、浏览器、HTTP／TLS 及隔离库已清理。自有 PostgreSQL 18 恢复 `h5_layout_baseline`、`postgres`、`template0`、`template1` 四库，其他客户端为 0；停止退出 0、状态退出 3、PID 消失、52473 监听为 0。最终任务路径及记录 PID 的进程、自有 5196／52473 监听均为 0，数据和日志保留；详见 `final-postgres-cleanup.json`、`final-resource-audit.json`。

第二步原件目录为 `D:\worktrees\h5-app-layout-validation-20261023`，交付索引 `delivery-results.json`，逐项映射 `file-mapping-final.json`，前后运行树及 manifest 分别冻结。`h5-content-delta.patch` 只供核查本轮内容变化；`final-changes.patch` 为包含先前 PC／Reporter 的整个未提交工作树差异。回退按 `h5-increment.json` 仅恢复 `baseline-source/` 对应字节并逆转 H5 映射，不重置整个工作树，不删除第一步及本轮证据。

未运行：全仓 full、current／historical certify、大库性能认证、真实 OAuth／WeCom 发送、企业微信真机验收、现场业务写库、部署和业务 Gate。持久功能开关和现场配置不变。

## 第一步变更合同

- 基线：`d3b7fda4f2cfb4291f550a9ed0952812dcf9a18f`；独立工作树 `D:\worktrees\pc-admin-app-layout\Fault-Reporting-WeCom-Assistant`，分支 `codex/pc-admin-app-layout`。主工作区 H5、依赖和包声明改动不纳入本候选。
- 输入：原正式端 105 个文件及统一构建接线；输出：唯一正式源码 `app/pc-admin`，旧源码目录移除。原型留在原位，无空 H5／后端占位目录。
- 运行制品仍为 `.build/runtime/web/admin-workbench`，由新源码路径生成并登记来源。保留资产清单、哈希、严格检查与缺失拒绝，不回退源码。
- 2026-10-23 后继范围：原卡片详情及 Bot 本人反馈并入新 H5，旧活动页面按 [ADR-0043](../../adr/0043_h5_notification_entry_and_legacy_ui_retirement.md)退役。统一构建输入和既有 G2 候选指纹同步覆盖移动后的 PC 源码及承接功能的 H5 生产源码／构建控制；本地缓存、私有环境及设计样本不作为运行输入。旧历史根没有新目录时保持原有清单语义，不修改文件上限、认证或 Gate 批准。
- HTTP、DTO、认证授权、内部备注隔离、成员反馈协议、资源预算和功能开关保持；无数据库变更、新依赖、新常驻进程或现场配置变更。
- 当前导航和 API 源码链接随迁移更新；历史 Evidence、原 tested_head、冻结合同及失败记录保持。后端迁移前，共用合同继续留在根目录。
- 回退：整体撤销本次源码路径、构建映射及导航变更；无数据库回滚。仅清理任务自有测试资源，不影响其他会话。

## 验证记录

本轮使用 Node.js 24、锁文件依赖、统一编译制品、任务自有 loopback PostgreSQL 18 与现有浏览器 harness。最终候选执行一次统一构建，再复用该制品进行类型、相关已注册业务入口、工具与制品检查；负向工具测试仅修改自有副本。

2026-10-23 最终候选基于上述 HEAD 加本工作树未提交差异，不能把基线提交本身当作完整被测代码。统一构建 `node .build/tools/build.mjs` 成功，严格编译及原生语法检查覆盖 878 个 typed 输入，保留 351 个 unchecked legacy 输入，生成 2641 项运行输出。之后直接复用已编译工具，不再 bootstrap 清除运行目录。

| 身份 | 最终值 |
| --- | --- |
| 构建输入 SHA256 | `b8e07dd1d8133351c162e830ba856773c425186b03ada8cbeb85f12888d0bdf9` |
| 编译 manifest SHA256 | `887196850f3bad97784f488c8086216c6fad6cb054637ec40e3d81b2001de453` |
| G2 候选指纹，仅身份核验 | `6ca2d228208fd05d6d5456cf8eb2d0bafce5fe16bf0612e7b27eaaecfe0f6550` |

`node .build/tools/gate.mjs types` 与 `npm.cmd --prefix app/pc-admin run typecheck` 均退出 0。业务验收使用既有 `runSelection` 及实际注册的 host、flags、隔离库和浏览器；三组均绑定上述 manifest，合计 43 个注册入口、360/360 用例通过，FAIL／SKIP／CANCELLED／NOT_RUN 文件均为 0。

| 验收对象 | 注册入口 | 用例 | 原件目录 |
| --- | ---: | ---: | --- |
| PC WEB01、原卡片 Reporter、Bot 反馈及权限／候选边界 | 24 | 82/82 | `h5-replacement/final-product-02/` |
| 新 H5 运行、前端、HTTP、V2 入口与合成数据库流程 | 8 | 193/193 | `h5-replacement/final-h5-03/` |
| 显式退役 V1 客户端夹具及原 API 兼容合同 | 11 | 85/85 | `h5-replacement/final-legacy-03/` |

第三组仅证明兼容合同，不能作为新页面验收。现行页面的前两组合计 275 个用例，保留 27 张浏览器截图；历史夹具另有 6 张截图。聚合身份、完整入口及实际数量见外置 `h5-replacement/final-business-summary-06.json`，未叠加第一步 PC 或中间候选的通过数。

构建／输入负向工具测试在自有副本执行，覆盖移动后 TS/TSX 严格检查、遗漏输入、源码改动拒绝旧制品、缺失／篡改制品拒绝及缺失产物禁止回退源码。工具整组 `final-tools-02.tap` 的原始结果为 86 项、75 PASS、11 FAIL、退出 1：启动前再次准备工具清除了原运行目录，导致 Foundation 与六个 Hosts 入口缺少编译运行输入；浏览器缺失反例另受显式 Edge 环境变量影响。最终构建恢复前置，缺失反例隔离该变量后分别补验，不把原退出 1 改写为整组 PASS。Foundation 补验 `final-foundation-03.tap` 为 4/4，受影响七个 Hosts 范围 `final-hosts-03.tap` 为 24/24，完整 H5 工具 `final-h5-tools-03.tap` 为 13/13，均退出 0、零跳过；原整组中已通过的 T01 构建负向、batch CLI 的正常／失败／跳过／SOURCE_HOST／缺失输出控制、案例追踪及截图归档检查保留其原通过记录。

更早的首次迁移工具日志未完整结束，后续替代构建的预算／路径拒绝、旧选择器断言、异步就绪等待和工具副本 180 秒超时也保留原件。副本正常双构建约 193 秒，夹具限时改为 360 秒并增加退出／信号诊断；产品预算、生产超时、认证器及 Gate 条件没有放宽。

`node .build/tools/verify-artifact.mjs` 最终退出 0，状态为 `ARTIFACT_VERIFIED_NOT_ACTIVATED`，manifest 与上述 43 个入口相同。`npm.cmd run docs:agents:check` 与文档工具 19/19 均通过；23 份变更文档的 633 个本地链接通过，24 个外部链接未抓取，不能把本地路径检查当作外部站点可达性验收。

外置原件目录：`D:\worktrees\pc-admin-app-layout-validation-20261022`。最终构建、manifest、proof、严格类型、业务分组、截图及审计保存在其 `h5-replacement/` 下，文件名带 `-06` 的审计对应上述最终候选；总体结果见 `h5-replacement/delivery-results.json`。

## 原通知承接与旧资源清理

| 原入口 | 本轮结果与权限 |
| --- | --- |
| `/workbench/app/` | 正式 PC 源码迁至 `app/pc-admin`，运行制品路径保持 |
| `/wecom/yixiaoxiu/tickets/{publicRef}` | 机器人及经核实代录原卡片直接呈现新 H5 Reporter；保持原本人 READ／归属，Bot 反馈独立判权，代录不获得该反馈资格 |
| `/wecom/yixiaoxiu/reports/{requestRef}` | 保持新 H5 本人 Web 报修详情及其原权限合同 |
| `/reporter/open#grant=...`、`/reporter/` | 新 H5 承接原 Grant／绑定会话链，fragment 立即清除；原兑换、终检、时间线及退出 API 保留 |

独立验证包含原发送器实际生成的卡片路径、成员重新认证、本人反馈、结果未知只核对原操作、加密恢复、代录只读、他人／当前作用域拒绝、失权清屏和退出后迟到／恢复事件。测试使用本地合成发送端与实际 PostgreSQL、TLS 和浏览器，没有真实 WeCom 外发。

- 原 PC 共 105 个文件完整移动后，专用 `src/bot-feedback.ts` 随后由新 H5 承接而退役；当前正式 PC 有 104 个源码文件，102 个与迁移前原字节一致，另两项为 README 与 Vite 入口接线。
- 删除旧活动 `web/p2-reporter` 的六份 HTML／CSS／JS，以及不用的 PC Bot 入口、后端静态桥接，共 8 项。原字节备份及 SHA256 核验在 `retirement-source-backups.json`；原旧目录均不存在。
- 三份旧自助客户端文件仅保留在 `tests/fixtures/retired-self-service`，哈希与原件一致；生产源码不引用这些夹具，正式静态输出没有旧页面。原 V1 API 保持，新 H5 未装配时页面明确返回 503，旧脚本地址不再回退。
- 迁移后的 201 项 PC／H5 前端输入同时进入构建 manifest 和既有 G2 指纹；当前清单 2008 项，原 2048 项上限保持。新增可选根的父级 junction／符号链接也拒绝；私有环境、node_modules、设计原件及 DEV 预览不进入指纹。
- 默认启动图 gzip 为 112071 字节，所有纳入检查的路由图低于既有 122880 字节预算；Reporter 为 117401，带反馈为 121219。可选加密恢复模块仍按需加载。最高现有路由为 122848，后续修改仍须重测预算。
- 根依赖／锁文件、`.env.example`、数据库迁移、公共合同、固定设计原件及 AGENTS 保持原版本；主工作区的其他会话改动未纳入本工作树。

当前工作树与分支保留供查看；无提交、推送、PR、合并或部署。开发命令烟测访问实际 `/workbench/app/` base 的入口及模块均返回 200，临时开发进程已退出，5194 端口已释放；首次误用无 base URL 的 404 烟测原件保留。

所有验收完成后，自有 PostgreSQL 18 恢复为 `pc_layout_baseline`、`postgres`、`template0`、`template1` 四库，其他客户端连接为 0；仅停止本任务实例，`pg_ctl stop` 退出 0、`status` 退出 3、PID 消失、52472 监听为 0。最终任务路径下 Node／浏览器／PostgreSQL 活动进程及自有端口监听均为 0，回执为 `final-postgres-cleanup.json`、`final-resource-audit.json`。数据库原数据、日志、历史失败和诊断副本保留，不清理其他会话资源。

未运行且不在本轮范围：全仓 full、当前／历史 certify、真实 OAuth／WeCom 发送、现场业务写库、部署和业务 Gate。
