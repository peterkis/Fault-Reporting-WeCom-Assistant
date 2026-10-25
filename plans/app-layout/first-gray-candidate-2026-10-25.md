# 首批小范围上线候选交付

日期：2026-10-25（Asia/Shanghai）。用户已明确将本轮目标改为“先交付一个通过关键门槛，可回退的小范围上线候选”。本报告记录该范围的本地候选交付；原完整回归、current/historical certify 与业务 Gate 合同保持。

## 候选结论与适用范围

当前目录迁移及本轮修复已形成可审阅、可校验和可增量回退的本地候选。首批建议限定为既有 human-v1 装配下的信息科小范围内部操作：PC 当前获权读取、人工代录、受理/分派/处理/完工、当前页面结果核对；只启用已经具名批准的原有能力。候选不修改持久 Feature Flag 默认值，首批对外投递保持关闭。H5 本人读取及反馈的正式资产和权限链已有合成验证，是否启用仍沿原独立配置与授权。

建议首个窗口仅安排两名信息科操作人员、一名指定测试报修人和一个明确来源组；这些是发布建议，没有创建账号、修改权限或启动现场服务。实际目标环境、成员/来源、窗口、既有运行基线及开关清单须在发布记录中填实。当前交付不包含真实发送、真实 Bot 接收、现场业务写库、部署或 Gate 批准。

旧 G2 演练本次在首次合成投递 SENT 等待处失败，原因未确定；外置诊断又在浏览器启动处提前停止，没有得到该投递的现场快照。两个失败原件均保留。首批不运行 G2 profile、不宣称通知恢复已验收；如要把对外通知投递纳入首批上线，必须先关闭这一阻塞并完成对应现场投递验收。human-v1 的独立编译父进程、三角色和三类模拟 Sender 全部通过，不能替代真实收件证明。

## 迁移完成度与候选身份

PC、H5、后端三步目录迁移的实现均已完成。后端 265 个源码文件、105 个脚本及 12 个共享/PC 归属映射按原 382 项清单保留。当前严格编译有 879 个 typed 输入，351 个 unchecked legacy 按原政策保留；原 TypeScript 主线的 181 项范围与当前全部 JS 库存是不同分母，不用 879/(879+351) 表示迁移完成率。

| 身份 | 本候选 |
| --- | --- |
| 工作树 | D:/worktrees/pc-admin-app-layout/Fault-Reporting-WeCom-Assistant |
| 分支 / 基线 HEAD | codex/pc-admin-app-layout / d3b7fda4f2cfb4291f550a9ed0952812dcf9a18f |
| 版本状态 | 既有迁移及本轮修复均未提交；HEAD 本身不是完整被测代码 |
| manifest SHA256 | 6355892626cf19768e8e3527f727c4b2a14e1544e1e9cebb96164c3b52d180cb |
| 受控构建输入 SHA256 | b6d698c607887482aca369fe249e446c9ab939f904edf9386ccb26d9492cf313 |
| G2 源身份指纹 | 5f6441d885102b61c636356bd5d961fa8884ba0e8c86bbb276c3344b0fd063e4 |
| 受控输入 / 运行树 | 2008 项 / 2647 个物理文件（含 manifest） |

本候选构建后复用同一 manifest。最终验证期间没有再修改受控源码、SQL、依赖、Schema 或默认开关。本轮新增生产修复集中于共享锁顺序与跟进表单收尾；测试夹具、当前版本合同及工具修补的逐项原因见外置失败台账。H5 全部 109 项输出保持原05字节；PC 只有共享跟进修补对应的哈希 JS 及三项装配元数据变化，其他 PC 输出保持。

## 实际关键门槛

| 对象 | 当前实际结果 | 证据 |
| --- | --- | --- |
| 统一构建、strict/负向类型、制品 | PASS；879 typed、2646 声明输出、2647 物理文件 | build-final-06-result.json；final-types-06.log；final-artifact-06.log |
| 全部12组迁移/宿主/发布工具 | 168/168 PASS | tools-dev23-full/result.json |
| Core/Communication、真实锁等待后权限与回执 | 53/53 PASS，8入口 | communication-related-final-06/result.json |
| 共享跟进、UNKNOWN/回执竞争与原生控件就绪 | 15/15 PASS，6入口 | t37-related-browser23-01/result.json |
| human-v1 编译父进程和三角色、OAuth/React/SSE/四来源闭环 | 4/4 PASS | first-gray-human-process-01/result.json |
| 正式 PC 看板/列表/详情/返回/刷新、表单原子提交、H5 他人拒绝 | 12/12 PASS，3入口 | first-gray-pc-h5-01/result.json |
| 关闭外联的三角色停止/重启、事实与回执不重复 | 1/1 PASS | first-gray-restart-01/result.json |
| T35 UNKNOWN/游标与 T29 用途失权时序 | 前4轮24/24 PASS；第五轮T35为1PASS/1FAIL，后续T29未执行 | first-gray-recovery-01 至05 |
| T35 恰好两条可见的准确边界及原 UNKNOWN 核对 | 外置同生产字节2/2 PASS；注册用例前提修正延期 | first-gray-t35-geometry-origin-01/result.json |
| 正式 H5 首页/列表/详情深链刷新，同源脚本与布局 | 4组主题/语言/390或1440宽度 PASS，8张截图 | first-gray-h5-browser-01.json |
| PC/H5 开发命令最小模块 GET | PASS | first-gray-dev-smoke-01/result.json |
| 运行包解包及全文件 SHA 核验 | 2649 文件通过；2647个运行文件 | first-gray-package-02/result.json |
| 自有副本增量回退及重新应用 | 80 路径通过，后续改动拒绝保护通过 | first-gray-rollback-rehearsal-01/result.json |
| 自有 PG/浏览器/进程/profile/监听关闭 | PASS；所有当前活动计数0 | first-gray-postgres-closure-01；first-gray-resource-closure-01.json |

表中不同测试范围可能重叠，不将重复用例相加冒充全集。页面使用真实 HTTP/TLS/隔离 PostgreSQL 和正式资产，外部 Provider/SDK 为合成边界。11 张最终截图已实际查看；不表示企业微信真机或临床现场验收。已有容量、gzip、超时、2048源清单上限及2C4G规则没有放宽；本机不构成正式2C4G验收。

## 停止的完整回归及保留事项

按新目标在正常批次边界停止旧全量计划：322/741入口、1517/1517用例通过，419入口未执行。322个相应原生作业均已关闭，没有中断在途用例。原 summary 仍保持其实际 RUNNING 原件，另以具名 scope-change 收据解释操作停止，不伪造全集通过。其后定向执行逐项保留独立 selection、指纹、用例和清理证据。

原39个主回归失败、8个工具失败、1项历史rename未执行、3个附加失败，以及7项修复期间新增失败，共58项身份保留。5 个原身份及 1 个新增身份的首次原因仍未确定；后续 PASS 仅为本候选观察。T27首次请求阶段、T37取消按钮首次帧的精确原因等缺口亦保留。已观测的T41客户端代理泄漏有受控RED/GREEN与真实投影器证据；不据此反推首次超时阶段。

本轮新增 REPAIR-T35-02 保留原注册测试失败：900px视口只断言前两条完整可见，未排除真实第三条材料；第五轮合法提交3而与写死的2冲突。两臂都准备真实第三条材料、在前台事件前记录矩形后，900px完整显示三条并重现原断言失败；仅改240px后恰好两条完整可见，原全部UNKNOWN/GET/UUID/跨人隔离断言通过。生产字节相同。本轮冻结注册源码，前提修正延期；外置验证提供关键业务证据，没有把源测试重标为通过。前三次外置观测的宿主/前提失败也保留。恢复测试不再要求原8轮全部通过，也不因此展开全仓修补。

旧 Source03 的一份 native closed 原件缺口仍在；独立 PID/birth/已记录成员退出及数据库收据证明其外部关闭。最终审计仍明确保留该一份缺口，不补写原生回执或虚构其 active=0。本轮新作业有实际原生关闭记录。全部原失败、中间尝试、旧运行树、PG数据/日志和原工作区改动保留。

## 运行包与上线前核对

运行包：D:/fr24/reports/first-gray-package-02/first-gray-candidate.tar.gz。SHA256：d8dc7c0a640703f593a05cb54f84a1509e1f271827fffcb0a530dac38a884281。它包含锁文件、package.json和完整编译运行树，不含私有配置、密钥、node_modules、原型或依赖缓存。解包后全文件字节核验通过；使用现有锁定依赖的临时链接执行编译入口 --check，缺省返回 enabled:false，链接已移除。未在新机器安装依赖或检查真实生产配置。

在目标发布目录使用 Node.js 24 与锁文件准备运行依赖，核对包SHA和逐文件inventory，再以现场已有独立私有配置执行：

```powershell
node --env-file=<本次获准的私有配置绝对路径> .build/runtime/app/server/scripts/human-workbench.mjs --check
node --env-file=<本次获准的私有配置绝对路径> .build/runtime/app/server/scripts/human-workbench.mjs --start
```

--start 只有在独立部署授权和目标检查完成后才执行；当前没有执行。命令路径使用迁移后的 app/server。发布核对包括：目标库已具备所选能力的既有迁移/checksum；正确同源PC/H5资源和SSE代理；当前授权人员/来源；唯一Gateway；对外传输关闭；私有存储、密钥与媒体程序按所选原能力配置。缺项立即停止，不自动 apply SQL 或降低权限终检。详见[运行说明](../../docs/runbooks/human-workbench-runtime.md)。

## 回退与停止条件

上线窗口先保存真实现行版本的包SHA、锁文件及不含凭据的配置摘要，保全当前数据库和未确认回执。现场旧包尚未指定，本地原05仅用于源码回退对照，且保留已知失败，不能称为已验证的生产回滚版本。

出现跨人读取、内部备注外泄、重复工单/重复外发、权限终检失效、原UUID核对不一致、启动/停止异常或待核对积压持续增长时，先停止新增入口/写入并保持传输关闭，保留现场状态。按原父进程顺序停止，确认 process_count:0 及监听/连接关闭，再切回具名现行包和原配置；不删除事实、回执、私有材料、待核对投递或历史Evidence，不回滚数据库。

代码回退按 increment-rollback.json 逐文件执行：先核当前SHA等于after；有任何后续修改即停止并合并。UPDATED/REMOVED恢复before原字节，ADDED只移除明确且哈希相符的自有新增文件。自有副本已完成回退到原05公开源码差异、重新应用到当前候选及错SHA拒绝演练。该演练没有修改源工作树或现场环境。目录迁移回退继续沿[第三步原映射和回退材料](server-migration-2026-10-23.md#7-证据与增量回退)，保留先前PC/H5/Reporter成果，不执行全分支reset/clean。

## 后续待办与交付位置

先在获准的小范围窗口核实真实登录、当前权限、PC主流程及停止/回退，再按结果扩大。对外通知上线前关闭G2首次SENT失败并完成真实收件与恢复验证。后续修正T35注册用例的可见材料上界并重跑原入口；当前已有准确场景下的行为验证，不宣称注册集合全绿。剩余419入口、历史兼容、完整current/historical certify、正式2C4G及企业微信真机验证分别保持未完成，不因本候选交付自动通过。

主交付索引：D:/fr24/reports/first-gray-delivery-01/README.md；机器索引含所有关键原件SHA。逐项台账：first-gray-failure-ledger-01.json/.md；全量停止收据：scope-change-first-gray-01/result.json；中间失败索引：first-gray-intermediate-attempts-01.json/.md。增量和演练材料见 first-gray-repair-increment-01 与 first-gray-rollback-rehearsal-01。GitHub Issue 状态未修改；未暂存、提交、推送、合并、部署或推进 Gate，P2-G2-LIVE、P2-008、P2-G3/P3 停止线保持。
