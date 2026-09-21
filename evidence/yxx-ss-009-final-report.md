# SS-009 本地验收报告

当前状态：**IMPLEMENTATION_AND_AUTOMATION_COMPLETE / SS009_LOCAL_VERIFICATION_COMPLETE**。完整回归、八个既有验证器、独立 SPEC/STANDARDS 审查及子任务严格校验均通过。远端交付审查 NOT_RUN。

## 候选与授权

- 分支：`codex/yxx-ss-009-verification`。
- 起点：`375d47b013017edb858206cc5f3475c9aed77dfd`（SS-008 / PR18 合并）。
- 被测源码提交：`e00455ff7982ffe40ddf91a0e764a72071dc88b3`。
- 被测 tree：`5a099ce3600e74881b9a11110590edc7e5a5560b`。
- 来源指纹：`2349482261c74f7ebcc532683b945ca9469b2428464d3da8af73d60d56c836fb`。
- 仅本地实现、隔离测试、独立两轴审查及本地提交。远端交付审查 NOT_RUN。
- SS-010 保持 PLANNED；SS-011 保持 NOT_AUTHORIZED；父 Gate 不推进。

| 子任务 | 状态 |
| --- | --- |
| SS-000 | COMPLETE |
| SS-001 | COMPLETE |
| SS-002 | COMPLETE |
| SS-003 | COMPLETE |
| SS-004 | COMPLETE |
| SS-005 | COMPLETE |
| SS-006 | COMPLETE |
| SS-007 | COMPLETE |
| SS-008 | COMPLETE |
| SS-009 | IMPLEMENTATION_AND_AUTOMATION_COMPLETE；远端交付审查 NOT_RUN |
| SS-010 | PLANNED |
| SS-011 | NOT_AUTHORIZED |

本地实现提交为 `b871157`、`678dfb2`、`88e5120`、`f3e0e09`、`e00455f`，分别收录目录校验、验收基础、审查修复、旧夹具/事件时间修复、通知夹具跨秒修复。最终证据提交的实际 HEAD/tree 由交付消息提供，不在本报告内嵌自身提交 SHA。

## 本阶段实现

新增 SS-009 结构/严格双模式校验器、102 项验收映射、实际 Node 测试事件记录、证据绑定入口及临时副本反向篡改检查。沿用现有候选指纹与完整测试 collector。严格模式核对源码提交、测试文件摘要、原始 TAP、精确测试事件、资源清理、独立审查原文和配对时间，不能仅改摘要为 PASS。

迁移验证的真实 RED 证明原片段匹配可能放过弱化 CHECK。现按实际隔离库的 033 中间态和 034 最终态精确核对完整目录契约，覆盖三张辅助表及六张受影响共享表。没有改写 migrations 001–034，没有新迁移、业务 API 或持久 Feature Flag 变更。032→033→034 实际目录观测保留在 `yxx-ss-009-catalog-diff.json`，包含列、约束、索引、关系、函数、触发器和扩展的变化/不变情况。

真实子进程在五个接受/处理边界强制终止，重启由新进程扫描持久 pending 恢复；另覆盖补充提交后中断、所属 backend 断开、真实 HTTP 响应丢失、同命令重放及跨成员拒绝。锁等待期间重新核验退出、身份替换、写入关闭和请求撤销。无业务调试 API；故障注入仅在测试夹具。

容量按两个独立 profile 串行执行，每个 500 报修、2000 补充、100 原工作台审核、32 并发读、额外十二路同命令竞争。真实规则对高风险明确故障先建最小 Ticket 再保留人工审核，所以初始 Ticket 数为 250；50 个未成单审核批准后再加并发对照受理，最终为 501 root、2501 source/receipt、301 Ticket。对已经存在最小 Ticket 的另 50 项执行 MARK_OUT_OF_SCOPE 审核处理，不删除既有 Ticket。

原生网页通过实际浏览器、TLS、HTTP、PostgreSQL 完成待补充、补充成单、人工审核及原工作台处理，成员 Timeline 观察同一 Ticket。390/1440 截图与实际运行摘要绑定。本人 Bot Ticket、Web 未成单/成单、分页与跨成员拒绝由本次全量重新执行既有及新增场景。

## 失败与修复记录

所有失败原始输出保留，不修改历史报告，不用跳过、删除断言或缩小负载换取通过。

早期部分诊断文件虽使用 `.tap` 扩展名，内容实际为 Node 默认 spec reporter 文本，仅作为原始诊断保留。严格验收引用的 `yxx-ss-009-full.tap` 是原全量入口输出的实际 TAP，不使用这些早期文本冒充 TAP 证据。

1. 首次完整回归 1172/1174：旧浏览器夹具每次读取生成新的 item ID，使 SSE 刷新重复展示；旧候选关联夹具尚未收集完整输入便允许后台关联。新增受控复现后，分别固定夹具项目标识、以现有数据库 advisory lock 隔开输入收集与计算。完整队列与旧断言保留；不把后者宣称为生产渐进输入必定只生成一个候选。
2. 第二次完整回归 1174/1176：旧通知夹具在真实入队前冻结发送时钟，跨秒后 Delivery 尚未到期而返回 null。1100ms 边界探针稳定复现；仅在入队后刷新夹具时钟，原发送、拒绝、过期、重试和未知回执断言均保留，整文件 14/14。Runtime 未变。
3. 早期容量/浏览器/目录夹具修正逐项见 `yxx-ss-009-fixture-corrections.json`；FULL 的排空总限依原 Worker 每 250ms 处理一项的事实修正，保留 500/2000/100/32 负载、整体测试上限及无进展拒绝，独立审查已核对原因。
4. 每条新的测试事件投影增加平台同次采样的 `event_time`、字符串 `event_epoch_ms` 与 REPORTER_OBSERVED_AT 标识；旧失败 trace 保留原样，不回填成新发生的事件。

## 证据解释与停止线

正式全量来自 `tmp/p2-g2-tests-6f72511f-a6a5-4c8a-a8df-7b4b41bf715f`：1176/1176、190 个测试文件，fail/cancelled/skipped/todo 全为 0、exit 0，Node 24、原入口 `--expose-gc`，候选运行中未变化。保留 SS-008 的全部 183 文件与更早 171 文件覆盖。新增 7 个根测试文件已由原 collector 实际执行。

| 当前短时测量 | MEMBER_SELF_SERVICE | FULL_SERVICE_LOOP |
| --- | ---: | ---: |
| 负载耗时（秒） | 40.00 | 194.36 |
| HTTP 写命令 P50 / P95（毫秒） | 9.05 / 23.35 | 6.60 / 13.65 |
| App/控制器同进程 RSS 峰值（MiB） | 252.45 | 251.96 |
| App/控制器同进程 heap 峰值（MiB） | 115.36 | 70.11 |
| App pool / 等待数峰值 | 4 / 28 | 4 / 28 |
| Worker RSS / heap 峰值（MiB） | 未启动 | 143.16 / 47.05 |
| Worker pool 峰值 / 配置上限 | 未启动 | 1 / 2 |
| pending 峰值 / 最老等待（秒） | 341 / 38 | 485 / 191 |

App/控制器 CPU 用户/系统累计为 12.969/2.937 秒及 7.703/2.500 秒；FULL Worker 采样 CPU 峰值为 96.148%。队列最终排空、两种模式均可停止。HTTP 延迟来自实际写命令，不冒充读取端到端 SLA。11 份当前清理收据的已登记资源残留均为 0；额外 catalog 观测自有库亦已清理。

202 个历史来源仍区分 122 个正常执行与 80 个机制覆盖；25 项人工观察、D12-005 未验证、D12-023 后续 P3 和历史裁定差异保持原义。当前测试通过不等于抹除这些历史限制，`original_semantics_all_passed=false` 按原审计含义保留。

App/Worker/Gateway 上限分别为 4/2/1。容量中 Gateway 未启动，实测为 0。控制器对账 pool 最大 1，隔离库管理连接另最大 1，不计入 App/Worker 限额。App CPU/RSS/heap 来自同进程测试 App 和控制器，不能解释为纯生产 App 的独立测量。Windows 主机级 swap/OOM、数据库进程 RSS 等未可靠采集的指标为 UNAVAILABLE；短时显式 GC 测试不是自然 GC、2C4G 或 60 分钟现场认证。

Web 来源的 Message、Outbox、Delivery、Grant 等产物及外部发送必须为零，旧 Bot 通知语义保留。模拟 Provider 调用单独记录；真实外部网络调用为零，不把模拟调用混称为零。

每次运行登记并清理自有数据库/backend、连接池、子进程、浏览器/profile、timer、listener 与 socket；预存资源不触碰。失败 TAP、诊断目录与合成截图保留。当前资源与配对时间证据已绑定；390/1440 截图已人工查看，内容为合成报修及关闭状态 Ticket，未见原始身份、患者资料或密钥。发布敏感信息扫描及历史保护结果见 `yxx-ss-009-publication-audit.json`。

## 最终验证与证据入口

- `yxx-ss-009-report.json`：当前候选和全部核心证据引用。
- `yxx-ss-009-acceptance.json`：102 项执行矩阵；AC-001～090 PASS，AC-091～102 NOT_RUN。后十二项分别属于 SS-010 和未授权 SS-011，不将未执行写成通过。
- `yxx-ss-009-full.tap`、`yxx-ss-009-full-run.json`、`yxx-ss-009-full-cases.jsonl`：原始成功运行与精确文件/名称事件。
- `yxx-ss-009-fault.json`、`yxx-ss-009-capacity.json`、`yxx-ss-009-catalog.json`、`yxx-ss-009-browser.json`、`yxx-ss-009-cleanup.json`：与原始 TAP 一致的实际收据。
- `yxx-ss-009-spec-review.json`、`yxx-ss-009-standards-review.json`：两位独立 Agent 的当前候选审查，均 PASS，未解决 P1/P2 为 0；审查原文明确当时发布门禁仍待执行。
- `yxx-ss-009-strict-negative.json`：自有临时 worktree 的正向对照通过，20 类变造均被实际严格入口拒绝，临时 worktree 已移除。旧提交不包含新矩阵时出现的 git 路径不存在诊断是该负向用例的预期拒绝。
- `yxx-ss-009-strict-validation.txt` 与配对时间收据：最终 `--require-ready` exit 0，返回 SS009_LOCAL_VERIFICATION_COMPLETE，live_authorized=false、parent_gate_advanced=false。
- `yxx-ss-009-validators.json`：V1.4、ARCH-005/006、P2-015/016/012、G2、成员检查八个真实入口均 exit 0；原始输出独立保留。

本阶段没有未解决 P1/P2；保留上述历史语义例外、Windows 不可用指标、短时容量适用范围和未运行的现场/远端审查限制。最后完成任务仍 P2-012、Gate 仍 P2-G1、架构任务仍 ARCH-006；P2-G2 未 PASSED，P2-008 仍 BLOCKED_BY_P2_G2，所有持久开关仍 false。

`.gitignore` 原始 SHA256 为 `0350afa8c952a92ee938901ae5e079c993c87d5ff1bb672a4e7a827f5d52d092`，index blob 为 `942b2b8d94b4f1e9dda5369cbac0cbe31056d950`；保护检查同时核对字节与 index。

未操作厂家/云端，未调用真实 OAuth/SDK，未访问生产或医院业务数据，未真实发送，未启动 P2-G2-LIVE/AI，未 push/PR/merge/tag。SS-011 仍须在 SS-010 后另行明确授权目标环境、人员/写入范围、窗口、回退、监测与负责人验收；本报告不授予该许可。
