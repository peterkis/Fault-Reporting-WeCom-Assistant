# 卡 25A：v2.1.6 会话计数与等待起点

日期：2026-11-05（Asia/Shanghai）。分支：`codex/pc-admin-v216-card25a`。本地基点：`b4ab3f10c5ea1c10593e8eeed7dd26aa9b8aeb10`。本次未提交、未推送、未创建 PR；记录对应工作区差异，不能冒充新提交或 CI 结果。

## 授权与资源

本会话为当前 checkout 唯一写者，无子代理或并行源码写入。原有未跟踪的原型及提示词保留。用户另明确允许：`workbench-conversations.mts` 的 summary 只读 GET 分派、`docs/api/workbench/conversations.md` 和 endpoint-index；实际 chat/related Schema 与新增 summary Schema。其它写入边界按原卡保留。

用户另明确允许 `tools/ts-migration/resources.json` 只登记新增 summary Schema 一行，确保真实构建制品包含该合同；不改构建工具逻辑或测试选择器。

兼容性核对发现当前前端 inbox-client.ts 用 exact 守卫拒绝任何新增键。用户确认“保持不改前端，兼容问题留给 25B”；本卡未改 app/pc-admin。waiting_since 即使在类型中可选，当前服务端响应仍会触发旧解析器的 INVALID_RESPONSE，不能声明现有前端可用，25B 必须先兼容这两个守卫及相关 entry 解码。

只使用本地合成数据库及既有 fixture/Port，不读取生产配置，不连接真实 Provider，不发送、不部署。新增 fixture 内容含“（合成）”。验证结束清理本任务资源；旧失败、NOT_RUN 与原 Evidence 不改写。

## 编号清单

- A1.1 已完成：三问均核对。初次可以没有 assignment，取 started_at（非 created_at）；release 必写且每次覆盖 released_at，领取/转交只在 ASSIGNED 时清空；有 control_event 审计而无独立 assignment 历史表，当前 UNASSIGNED 可直接可靠推导。完整写入与时间来源见 ADR-0054。
- A1.2 已完成：未结束且 UNASSIGNED 取最近 released_at，从未领取取 started_at；ASSIGNED/ENDED 为 null，北京时间精确到秒。
- A1.3 已完成：chat/related 输出 Session 值；收件箱联系人按完整可见范围取所有待接待 Session 的最早值，与筛选无关；与 matching_topic_count 不同口径已写进 ADR。
- A1.4 已确认无需修改：三个生产 assignment SQL 都在现有控制服务，普通/复合接管及强制转交复用它们；可靠推导，无迁移或命令修改需求。
- A1.5 已完成：七种情况以真实 PG 投影与真实控制命令逐案验证；另覆盖消息不重置、筛选无关、不可见旧会话不泄露等待。最终集成入口 16/16 PASS，包含七个逐案子测试。
- A2.1 已完成：新增 GET /api/workbench/conversations/summary，返回两个数字和北京时间 as_of，前缀/宿主与现有工作区一致。
- A2.2 已完成：复用 read/relation/sessionAccessPredicate 与最终权限证明；未知参数拒绝；open 排除 ENDED，覆盖 WAITING_USER，两个计数分别与无筛选完整翻页严格相等。
- A2.3 已完成：单条聚合数据 SQL，固定身份预检，无 N+1；交付候选的 55 Session / 91 Item 合成库 EXPLAIN ANALYZE 执行 3.969 ms、规划 3.774 ms；服务调用 11.9369 ms，前后不同联系人规模均为 1 条数据 SQL。
- A2.4 已完成：workspace/inbox 默认关闭开关、guard、认证、no-store 和只读 2000 ms 超时沿原路径；HTTP 默认关闭、未知参数、无认证、非 GET 及最终角色变化拒绝均通过。
- A2.5 已完成：两个可见范围不同的账号及空范围账号均与完整翻页严格相等，另一账号看不到的 Session 不计入，共同可见会话的个人游标也相互独立。
- A3.1 已完成核对：现有客户端监听 family 与事件如下表。
- A3.2 停止待确认：旧 Session 自动结束后没有针对该旧对象的 session.updated；新增 Session 的 item.created 仅在同一账号也有新对象 READ 时能间接刷新。补齐需改超白名单的 Session 写入 coordinator，本卡不改。其它六类已存在推送，未新增事件。
- A3.3 已确认无需修改：既有 conversation.session.updated 足够，不需要新事件族。
- A4.1 已完成：通知异常 list 只有 items/has_more/next_cursor，精确 item GET 无总数；未找到其它直接返回异常全局总数的接口/字段。
- A4.2 已确认无需修改：没有可交给 25B 复用的直接总数字段，不能以页长代替总数。
- A4.3 已完成：独立契约缺口和后续口径问题已记录，本卡不实现。
- A5.1 已完成：类型、实际 inbox/chat/related Schema、新 summary Schema 与 OpenAPI；契约单测 4/4，四份 JSON Schema 元校验和四条 OpenAPI GET 的引用/认证/闭合参数检查通过。旧 detail Schema 属于未变的旧接口，已确认无需修改。
- A5.2 已完成：ADR-0054 包含背景、三条口径原文、来源/定义、等值关系、权限、性能、实时、A4 与未解决项。
- A5.3 已确认无需修改：未改前端；共享类型检查通过。实际解码兼容问题已发现并经用户确认留 25B，不能据类型通过冒称当前 UI 可用。

## A3 事件核对

| 触发 | 现有服务端来源 | 既有事件 / 结论 |
| --- | --- | --- |
| 领取、接管（含复合接管） | p2-005-conversation-control takeoverSession | conversation.assigned；有 handoff 时另有 handoff.accepted |
| 释放 | 同模块 releaseAssignment | conversation.assigned / ASSIGNMENT_RELEASED，同事务 |
| 普通、强制转交 | 同模块 transferCurrentAssignment | conversation.assigned / ASSIGNMENT_TRANSFERRED，同事务 |
| 新消息 | p2-g1-inbound-projection-coordinator itemTransactionHook | conversation.item.created，持久材料后推送 |
| 已读位置变化 | p2-005-conversation-control advanceReadCursor | conversation.read_cursor.changed，同事务，no-op 不产生变化 |
| 结束 | coordinator resolveSession 把旧 Session 置 ENDED | 无旧对象事件；新 Session item.created 不保证向仅可读旧对象的账号送达，停止待确认 |

前端 `workbench-realtime-client.mts` 已监听上述原事件，`useRealtime.ts` 的 conversation-inbox / conversation-chat / conversation-related / conversations 等 family 失效重读。25B 应复用 conversation-inbox 查询 family，无新增轮询；本卡不实现分钟展示计时器。

A3 后续可审查方案：在旧 Session 结束的原事务内，用现有 mapper/appender 追加 conversation.session.updated，scope 指向旧 Session，payload 仅状态/版本；沿既有提交后 wakeup。须增量授权 coordinator 及其测试，验证只读旧对象而不可读新对象也能收到提示、回滚无事件、无新事件族。不改变结束业务逻辑。

## A4 契约缺口

没有可直接使用的失败+待核对总数。后续需确认按 Delivery 还是来源聚合；跨 TICKET/SESSION/INCIDENT 是否去重；DEAD_LETTER、RECONCILIATION_REQUIRED、CANCELLED+UNKNOWN 的纳入规则；当前 READ 与维护权限、保留期、筛选和 realtime 刷新口径。不能用本页条数替代总数。

## 文件、验证与交付

证据目录：`D:/CodexEvidence/pc-admin-v216-card25a-20261105/`。交付构建为 Node 24.18.0 / PG 18.4，source input hash `7c95c60b29fcf76123748220dd43abd62096fb4d844ffd0851345871b8f55453`，922 份编译实现、2944 个输出；本地基点 SHA 不变，非新提交。候选身份（`D:/CodexEvidence/pc-admin-v216-card25a-20261105/candidate-identity-delivery.json`） 记录 manifest 哈希。原始记录只保留一份并以链接指向；不是线上性能或生产接受证明。

交付候选完整 EXPLAIN ANALYZE（`D:/CodexEvidence/pc-admin-v216-card25a-20261105/card25a-summary-explain-delivery.json`） 使用实际含当前权限终检的 SQL；从定向测试原始 TAP 的 CARD25A_SUMMARY_EXPLAIN 行提取原 JSON，不改写计划。数据聚合前后联系人规模变化仍只发一条数据 SQL；固定认证/表可用性预检不计为 N+1。耗时为本地合成、单次测量，不代表现场 P95。前一候选的 2.360 ms 测量原件也保留，不替换其原对象。

### 文件清单

1. [收件箱查询](../../app/server/src/workbench-conversation-inbox.mts)：waiting_since、联系人全范围聚合、summary 和共享未读谓词。
2. [HTTP 分派](../../app/server/src/workbench-conversations.mts)：一条 summary GET 路由及既有守卫。
3. [类型](../../contracts/workbench_conversation_inbox_contracts.d.ts)：只读 nullable waiting_since、summary。
4. [收件箱 Schema](../../contracts/workbench_conversation_inbox_page.schema.json)。
5. [chat Schema](../../contracts/workbench_conversation_chat.schema.json)。
6. [related Schema](../../contracts/workbench_conversation_related_page.schema.json)。
7. [summary Schema](../../contracts/workbench_conversation_inbox_summary.schema.json)。
8. [OpenAPI](../../contracts/conversation_center.openapi.yaml)：新接口与实际 chat/related/inbox 读投影。
9. [ADR-0054](../../adr/0054_conversation_inbox_counts_and_waiting_since.md)。
10. [契约测试](../../tests/conversation-inbox-contract.test.mts)。
11. [集成测试](../../tests/conversation-inbox.integration.test.mts)。
12. [合成夹具](../../tests/helpers/conversation-inbox-fixture.mts)：受控合成时钟下调用现有控制 Port。
13. [构建资源](../../tools/ts-migration/resources.json)：只新增 summary Schema 资源登记。
14. [接口说明](../../docs/api/workbench/conversations.md)。
15. [HTTP 索引](../../docs/api/endpoint-index.md)。
16. 本执行记录。

### 验证风险、范围和失败原件

直接风险是等待起点误用消息时间、筛选收窄全局范围、多个 Session 重复计人、当前角色/权限变化后的计数泄露、个人游标混用和新 Schema 缺失制品。沿现有路径策略，在未提交工作树上用 planChanges/parseDiff 计算真实自有差异（不假造新 head），排除用户原有未跟踪文件；resources 路径自动选到 core/docs/mvp/policy/toolchain，共 58 个入口、7 个工具测试，去重执行。另补既有会话控制、规则准入与收件箱浏览器入口。适用检查完成即停止；full/certify、Electron、现场、发送、部署和 Gate 均 NOT_RUN。

- 第一次构建失败（`D:/CodexEvidence/pc-admin-v216-card25a-20261105/migration-build.log`）：缺已有的三份 @fontsource-variable 包。只下载锁定版本，并逐包核对 lockfile SHA-512 后恢复 node_modules；package.json/package-lock.json 不变。离线缓存未命中的日志也保留，未新增依赖。
- 首轮契约失败（`D:/CodexEvidence/pc-admin-v216-card25a-20261105/direct-initial.log`）：3 PASS / 1 FAIL，新增 summary Schema 未登记资源而缺于 runtime。经用户确认补资源登记，最终契约 4/4 PASS。
- 首轮集成失败（`D:/CodexEvidence/pc-admin-v216-card25a-20261105/integration-initial.log`）：13 PASS / 3 FAIL（含失败父测试）。无 Team 的 HANDLER 不能直接接管，改为 ADMIN 领取后用原 HTTP 转交；原结束子用例串联实际 HTTP 转交与固定时钟低层 release，后者被原 RealtimeEventLog 拒绝（诊断（`D:/CodexEvidence/pc-admin-v216-card25a-20261105/control-clock-diagnostic.log`）），改用现有 ENDED fixture 独立验证结束投影，未改命令或推送。最终同入口 16/16 PASS；不把这次重排记成业务命令修复。
- 首批路径回归（`D:/CodexEvidence/pc-admin-v216-card25a-20261105/selected-final/summary.json`）：58 入口的 415/415 用例 PASS、零 SKIP/TODO，但批次末尾制品检查 FAIL。本卡新增测试把 EXPLAIN JSON 留在 runtime/tmp，触发 MIGRATION_UNDECLARED_OUTPUT；该批次保持 SELECTED_TESTS_FAIL，不能仅凭用例数改写成整批 PASS。
- 修正测试输出为 TAP 日志中的完整 JSON；显式指定外部证据目录时才写文件。原临时文件核对已归档 SHA-256 后精确删除。为保持唯一输入，停止并记录当时的自有工具测试树，取消回执（`D:/CodexEvidence/pc-admin-v216-card25a-20261105/selected-tools-cancellation.json`） 保留，不冒称工具整批通过。
- 交付构建（`D:/CodexEvidence/pc-admin-v216-card25a-20261105/migration-build-delivery.log`） PASS；交付 gate types（`D:/CodexEvidence/pc-admin-v216-card25a-20261105/gate-types-delivery.log`） PASS；契约与 OpenAPI 校验（`D:/CodexEvidence/pc-admin-v216-card25a-20261105/contracts-validation.log`） PASS。
- 交付候选定向回归（`D:/CodexEvidence/pc-admin-v216-card25a-20261105/direct-delivery/summary.json`）：4 入口 30/30 PASS，批次末制品核验 PASS。分别为契约 4、收件箱 16、规则准入 4、控制/游标/容量 6；其中前 20 项与路径选择重叠，不累加成独立覆盖数。
- 现有前端兼容入口（`D:/CodexEvidence/pc-admin-v216-card25a-20261105/frontend-compatibility-observed.json`）：按原 240000 ms 上限 ETIMEDOUT；实际观察到 6 个 FAIL，第 7 个用例未完成，第 8–9 个 NOT_RUN。入口 summary 因无完整 TAP 收尾而计数为 0，不能把它当成没有失败；原逐例事件、TAP 和 timeout 回执均保留。严格键解析与新字段不兼容已由源码确认，用户明确留 25B。超时遗留的 1 个 UUID 合成库已精确删除并核三库基线恢复，见回执（`D:/CodexEvidence/pc-admin-v216-card25a-20261105/browser-timeout-database-cleanup.json`）。

- 交付候选路径检查分段通过：首批 55 个入口的 390 项 PASS；第 56 个 H5 静态入口的 14 项在 finally 的目录保护断言失败（TEMP 为 `D:/tmp/pc25a-20261105`，path.dirname 为 `D:\tmp\pc25a-20261105`），末 2 入口 NOT_RUN。只把本地 TEMP/TMP 改成原生 Windows 路径，没有改测试或断言；后续 3 入口 25/25 PASS，末尾制品核验 PASS。`selected-delivery-aggregate.json` 核两个批次 manifest 一致、计划 58 路径完整且逐文件 PASS，唯一用例合计 415/415，零 SKIP/TODO。首批 FAIL 回执和 14 个清理失败原件均保留。
- 同样的本地 TEMP 表示问题触发工具 H5 文件的目录清理断言；原始 7 文件批次为 127/128，唯一失败为该 H5 文件的父用例。单独以原生路径重跑 `.build/tools/h5.test.mjs`，13/13 PASS（`tool-h5-native.log`）。其它 6 文件均 PASS，包括 Windows 自有子进程退出/超时回收及独立进程存活、宿主路由、工作流选择、两次构建一致性、来源/制品漂移和覆盖边界。`tools-delivery-aggregate.json` 按唯一文件收口 7 文件、128 项；未改写原始 127/128 的 FAIL 回执。
- 改动文档的首次定向链接检查发现 14 个指向仓库外 Evidence 的 Markdown 链接不符合现有检查器规则，原错误保留在 `changed-docs-check.log`。改为记录明确的原件路径，保留仓库内链接；`changed-docs-check-final.log` PASS。最终交付在聊天中提供可点击的原件路径，不复制证据正文。

- 独立 `verify-artifact.mjs` PASS（`verify-artifact-delivery.log`），manifest SHA-256 为 `7966039b64a36e72511f0a8b8c71e386a54891efeae1f76a1ab3020b1e0d1ee7`；状态为 ARTIFACT_VERIFIED_NOT_ACTIVATED。
- 合成库已恢复 `postgres/template0/template1` 三库基线，其他客户端为 0；仅停止本任务数据目录和 PID 对应的 PG，pg_ctl status=3、55485 端口无监听。`pg-final-baseline.json`、`pg-stop-receipt.json` 记录实际结果。已停用的数据目录保留，未宣称已删除。

本卡授权范围内的本地代码、契约、路径检查、工具、类型与制品核验均已结束。A3 结束推送保持停止待确认；当前前端兼容按用户确认留 25B，浏览器失败与未完成项保持真实。full/certify、Electron、真实发送、现场业务库、部署和业务 Gate 均 NOT_RUN。

### 清理限制

自动审批审查拒绝了删除已取消工具检查临时编译副本的操作，返回理由仅为 `blocked by policy`；该命令未执行，也未改用其它方式重复删除同一对象。只读核对发现 `C:\Users\zqpet\AppData\Local\Temp\t02-host-test-G7bX6A` 仍存在，原任务记录与 node_modules junction 一并保留；另一已记录副本 VSWtNb 在核对时已不存在。详情为证据目录中的 `cleanup-policy-rejection.json`。本卡不把保留副本记成清理成功。

保留本地未提交分支、唯一当前 `.build` 制品供审查、已停用 PG 数据目录和 `D:\tmp\pc25a-20261105` 中的本地过程/回执材料。自有合成数据库已清空，PG 已停用；保留目录不代表仍有运行中的服务。不扩大清理用户原件、共享 node_modules、其他实例或未知归属目录。

### 自检（七项）

| 问题 | 是 / 否与证据 |
| --- | --- |
| 只改本卡允许文件，25A 未改前端 | 是。含用户明确追加允许的只读分派/API 文档、实际 Schema 和资源登记；app/pc-admin 无差异；完整自有清单为上述 16 项。 |
| 无新增/修改业务命令、状态、权限规则或依赖 | 是。查询仅复用 relation/read/原授权谓词，路由只读；命令模块、依赖声明与锁文件无差异。 |
| 未自行新增迁移 | 是。database 无差异；started_at/released_at 已足够，A3 超范围写入路径停止。 |
| 计数仅可见范围且不随筛选变化 | 是。summary 对每个账号均与无筛选完整翻页严格相等；未知筛选 400，访问其它队列后 summary 数值不变，隐藏 Session 不计入。 |
| 等待从变成无人接待开始 | 是。七个真实 PG 子测试覆盖首次、ASSIGNED、释放、再领取、二次释放、ENDED、多会话最早；新消息不重置，started_at 与 created_at 不同也取 started_at。 |
| 刷新复用实时且无新增轮询 | 是。未修改前端 controller、事件族、轮询；summary 由 25B 复用原 family。A3 旧 Session 结束缺口明确停止，并未宣称七类推送均闭合。 |
| 测试选择器和业务断言只增不减 | 是。原路由/selection 不变，现有用例业务断言保留；新断言和七种逐案测试在原已注册入口内增加。 |

### 限制与回退

A3 结束推送补齐和当前前端解码兼容仍待后续处理；用户明确将前端问题留给 25B。本卡只证明后端本地只读投影，不能单独启用现有 inbox UI。无通知异常全局总数；A4 后续口径独立确定。summary 不包含已结束会话的未读；联系人 waiting_since 的全范围口径与 matching_topic_count 的筛选口径并存，25B 应在展示上说明。

保持既有 workspace/inbox 开关关闭可关闭这些读入口。未提交状态按本清单逐文件撤回即可；不回退用户原件、不改写历史、不删除业务数据。没有数据库迁移回退或通知发送回退。
