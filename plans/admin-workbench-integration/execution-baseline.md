---
document_id: WBINT-EXECUTION-BASELINE
task_id: WBINT-T01
issue: 56
status: LOCAL_VERIFIED
verified_on: 2026-10-07
timezone: Asia/Shanghai
published_main: 3cf707945afac7392806f7d8dca3dfb6be94caad
local_integration_input: 516b4dce808981bdbcc449a850a1fdeaa2960cfb
business_validation_status: NOT_APPLICABLE_DOCUMENTATION
---

# 接入执行基线与共同合同

本文件交付 [WBINT-T01 / #56](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/56) 的共同约束。它与[执行记录](execution.md)承接 2026-10-07 用户对全部 43 票的 implement-spec 授权；[原规划](README.md)与[发布记录](github-ticket-publication.json)保留历史来源。T01 不预造后续行为的完整 HTTP／Schema，不把源码核对记为业务通过。每票先在自己的范围同步详细合同、实现、API 文档和适用验证。

## 实际对象和保护范围

| 对象 | 本次核对结果 | 解释 |
| --- | --- | --- |
| GitHub 已发布 main | `3cf707945afac7392806f7d8dca3dfb6be94caad`；通过 GitHub branches/main 读取 | 已发布只读 React 基础及既有后端的来源，不证明新人工动作可用 |
| 本地集成输入 | `516b4dce808981bdbcc449a850a1fdeaa2960cfb`，分支 `codex/admin-workbench-human-integration` | 包含已批准规划、任务发布记录和来源群增量；尚未 push、部署或启用 |
| T01 工作分支 | `codex/wbint-t01`，从上述输入建立，开始时 index／工作树干净 | 仅修改本票文档；后续集成提交另行记录，不重绑旧 tested_head |
| remote | `https://github.com/peterkis/Fault-Reporting-WeCom-Assistant.git` | Git 操作保持 HTTPS |
| 当前用户规则 | 主源码根 `D:/Projects/Fault-Reporting-WeCom-Assistant/AGENTS.md` 的最新用户规则 | 已读取并遵守；保留其工作区修改，不从隔离分支覆盖回主源码根 |
| 保护范围 | AGENTS、医小修 UI 用户文档、旧 Evidence、冻结回调资料、来源群既有实现 | T01 不修改；不读取 `.env`、真实数据库、原始身份或生产材料 |

GitHub main 与本地输入分别记录，不能把本地提交称为已发布能力。[能力映射](capability-map.md)中 `LOCAL_INCREMENT` 是规划时的分类；该来源群实现现已提交到本地输入，仍不表示部署。旧本地报告是其原被测对象的证据，T01 未重跑它，也不将其结果挪作后续票的验收。

## 当前真实入口和目标差异

W／M／O／P 沿用[公共宿主约定](../../docs/api/conventions.md)，不是新服务。W 为工作人员同源宿主；M 为成员自助；O 的 OAuth-only／只读 profile 不具有 M 的报修写权；P 是历史试点。路径、启用模式和当前认证共同决定接口能力。

| 当前源码中的真实入口 | 本次确认的范围 | 后续差异 |
| --- | --- | --- |
| W `/workbench/app/`、`GET /api/workbench/board`、`GET /api/workbench/items/{kind}/{id}` | 正式 React 读取真实授权事项；handler 只允许 board／精确事项详情，不挂载子路径写动作 | command-context、完整与我有关、搜索、拖动与新命令由对应票实现 |
| W `/api/tickets/{ticketId}` 及现有显式动作 | queue／accept／start／request-information／wait-vendor／resume／resolve／confirm／reopen／cancel／notes／transfer；查询当前责任、可选人员和事件 | 旧 resolve／confirm 不能模拟工作人员原子完工；不存在新 take-and-start／unassign／return-to-dispatch／complete 等挂载 |
| W `/api/conversations/{sessionId}/takeover-and-accept-ticket` | 已有单会话接管并接单，分别携带会话／工单版本 | 不包含开始；多会话、跨团队及接管关闭由对应票扩展，不在浏览器串联旧命令 |
| W Manual Review／Journey、Conversation／Delivery、Incident | 既有人工复核、分主题沟通、独立投递及人工公共故障接口保留 | React 新工作区和新复合动作逐票交付；Incident 的读取和控制沿自身权限 |
| W `GET /api/attachments/*` | 当前宿主明确返回不可用 | 获权真实内容读取由 T16 定稿，元信息或原型图不能当附件下载能力 |
| M Web request／Bot Reporter 读取和现有 Web 命令恢复 | 两种来源绑定、详情／timeline 和 `/api/yixiaoxiu/commands` 的当前合同保留 | 两种 feedback 路径未挂载；原 Reporter 重开由 T20／T21 交付 |
| W 来源群 directory／name 与 board／detail 来源字段 | 本地输入内已有真实 handler、Schema、查询与 037 独立迁移入口，受 `sourceGroupDirectoryEnabled=false` 默认值限制 | T23 复用既有核心，补检索／设置；不重复实现或启用真实库 |
| W `GET /api/realtime/events` | 既有授权 SSE 入口；事件触发失效和重读 | React SSE、presence、事项已读／跟进及声音分别实施；SSE 心跳不是查看／编辑活动 |

源码依据：[WEB01 handler](../../src/web01-workbench-http.mts)、[P2-016 handler](../../src/p2-016-workbench-http.mts)、[运行装配](../../src/p2-016-runtime.mts)、[W 原生宿主](../../src/p2-006-workbench-http.mts)、[Incident handler](../../src/p2-012-workbench-http.mts)、[Web 成员 handler](../../src/yxx-self-service-native-http.mts)、[Bot 本人 handler](../../src/p2-g2-yixiaoxiu-http.mts)。完整现有接口仍由[API 导航](../../docs/api/README.md)维护；[能力映射中的 PROPOSED_PATH](capability-map.md#待冻结的新-http-合同)始终是候选，T01 不将其登记为已挂载。

来源群的独立 [037 迁移](../../database/migrations/037_workbench_source_group_names.sql)、[迁移器](../../scripts/workbench-source-groups-migrate.mts)与[接口合同](../../docs/api/workbench/source-groups-design.md)已存在。默认关闭时不读新表；启用时要求迁移标记。037 不进入[固定历史迁移清单](../../scripts/migrate-current-baseline.mjs)。后续新编号须在当次集成前核对唯一性，不复用 037；T01 无数据库变更或执行。

## 身份、资源引用和版本

| 名称／边界 | 共同规则 |
| --- | --- |
| 操作主体与 Reporter | W principal 从服务端认证取得，并重查活动角色、组及对象权限；M 由来源／应用范围内原本人绑定定位。工作人员代录的 principal 与实际 Reporter 分开 |
| 外部身份 | Provider user_id、查询 UID、WeCom userid、open_userid、Person 不等价；姓名、手机号、字符串外形及跨应用同名均不产生绑定 |
| 事项定位 | `kind + id`；Ticket／Review／Intake UUID 不互换。Review 关联同 Ticket 后规范去重，关注和阅读关系不扩权 |
| Web／Bot 本人引用 | Web `requestRef` 与 Bot `publicRef` 都是 32 字符 opaque ref，沿各自 API 和来源绑定；my-reports 用 `{kind,ref}`。引用本身不授予写权 |
| 续接引用 | `entryRef` 是短期续接令牌，不能替代 Ticket UUID、本人详情 ref、登录或反馈授权 |
| 来源群引用 | `groupRef` 为 provider／Bot／chatid 规范 JSON 数组的 SHA-256，64 位小写十六进制；浏览器不获原始 ID。同名群不合并，名称不改变身份／路由 |
| Ticket 命令版本 | `expected_version` 为安全整数 number，保持当前守卫和 If-Match 匹配；不从展示 DTO 的缺字段猜版本 |
| Conversation 命令版本 | `expected_row_version` 为安全整数 number；复合旧命令用独立 `expected_session_row_version` 和 `expected_ticket_version`，不能互相代用 |
| Review／Incident／来源群版本 | 十进制 string；Incident／来源群要求精确带双引号 If-Match。来源群未登记为 `"0"`；新票不得统一 Number() 强转 |
| Web 材料和实时位置 | input_revision／processed_revision、SSE event_id 为 string，与 Ticket／Session 版本独立。Web 补充的 expected_input_revision 不替代 Ticket 版本 |
| 新多对象命令 | 逐实际变更对象验权、验自身版本与材料 fence，具体 Header／body Schema 在该票定稿；保留沟通时不暗改 Session |

类型／守卫依据：[公共约定](../../docs/api/conventions.md#幂等与并发版本)、[来源群命令 Schema](../../contracts/workbench_source_group_name_command.schema.json)、[Web 补充 Schema](../../contracts/yxx_self_service_supplement.schema.json)。新增解码从 unknown 开始；strict `.mts`／ESM、相对运行导入 `.mjs`，不以 any、忽略检查或源码回退取代合同。

## 共同行为和授权不变量

1. [CONTEXT](../../CONTEXT.md)、Accepted ADR 与现有 P2 合同为唯一语言入口。Ticket Core 是唯一编号／状态／责任／事件事实源；不造第二套 Ticket。三列展示不产生三种数据库状态，旧 RESOLVED 保留“已解决待确认”。
2. Conversation Assignment 与 Ticket Assignment 分别拥有沟通和处理责任。[ADR-0024](../../adr/0024_staff_completion_and_takeover.md)／[ADR-0031](../../adr/0031_human_workbench_collaboration_policy.md)要求复合承接／交接逐会话确认关联和授权，在一个事务内全部成功或失败；无会话走 Ticket-only。获权可见的跨团队操作不扩大读取范围，新人必须属于有效目标组。
3. 明确报修先持久受理、先最小建单；AI／目录失败不能吞单。不确定复核保留澄清路径，不以群主题或时间接近自动并单。原 Reporter 的明确未解决反馈才进入对应重开用例，补充／致谢不自动重开。
4. 显式 Action 和追加事件拥有状态变化；责任交接／退回保留本轮历史，不新增轮次。完工的内部过程与对外摘要分开，工作人员关闭不伪造 Reporter 确认。详细状态矩阵／关闭依据／轮次字段由 T04–T15／T20 等所属票同步定稿。
5. Cookie 写请求每次执行 Origin、CSRF、当前认证和对象／目标授权；UUID client_command_id 与 Idempotency-Key 遵循所属宿主合同。重放也重新验权。响应丢失保留原 UUID／原 payload 核对，不自动换 UUID、版本或身份制造新意图。
6. 责任／状态／追加事件／可靠通知承诺按所属原子用例提交；发送失败或 UNKNOWN 不撤销已发生业务事实。202 入队、持久提交、已确认发送、本人已读各自核对，不互相推导。投影、Redis、SSE、Query 缓存不成为事实源。
7. [ADR-0023](../../adr/0023_origin_based_notification_routing.md)的原始来源不随群转单聊、H5 补充或群改名变化：Bot 单聊走私聊；群来源另有强 @ 与独立私聊；H5／已核实可达代录走应用；未核实代录需人工联系。每轮首次责任和完工的语义去重、每路独立 Delivery 由 T24–T26 完成；真实强 @ 尚需独立现场证明。
8. 内部记录、交接原因、原始身份、凭据和未授权资料不进入 Reporter timeline、群摘要或外发；日志／新证据仅用合成材料和安全摘要。Incident 保留个人 Ticket、自己的权限、责任、订阅和投递边界，不沿 Ticket 接管权外推。
9. 个人实际阅读不清团队补充待跟进；旧处置不清新材料；回复入队／失败／UNKNOWN 不证明已响应。共享跟进由现有责任关系承接，不建第三套负责人。presence 为短暂提示，不领取／锁单；声音初始静音、主动启用、跨标签去重、不补响历史。
10. 每项新行为由所属票同时冻结 METHOD＋PATH＋真实宿主、输入输出 Schema、权限／版本／上限、数据库或无变更、默认关闭配置、负向 seam、证据和关闭方式，再接前端。T01 的共同约束不是后续全部 HTTP／Schema 已冻结的声明。

## 默认关闭、资源和测试 seam

新增持久 Feature Flag／宿主能力默认 false；既有 profile 和授权限制保留。来源群当前是显式宿主选项而非自动新增环境开关。关闭新入口保留已提交 Ticket／事件／Outbox／名称历史，不删除事实或更改历史 Evidence；业务增量、配置启用与真实发送分别记录。

App/API/SSE 1 进程、Worker 1、Gateway 1 个活动连接、PG 1 实例，各 AI／通信／集成 concurrency 1，SSE 默认 32，应用总池建议不超过 8。列表／附件／草稿／presence／搜索需有明确限值；具体新增限值在对应票定稿。复用现有事务与池，不增加 BFF、消息中间件或常驻认证平台。隔离 PG／浏览器运行由父任务协调资源，不能批量停止用户服务。

后续行为沿已批准公共 seam 做 RED → GREEN：当前 W／M HTTP 的认证和对象权限、Ticket／Intake／Conversation／Incident Port，以及真实隔离 PG 事务；浏览器使用正式 `/workbench/app/` bundle。可复用 [WEB01 fixture](../../tests/helpers/web01-workbench-fixture.mjs)、[P2-016 PG helper](../../tests/helpers/p2-016-postgres-harness.mjs)、[P2-015 PG helper](../../tests/helpers/p2-015-postgres-harness.mjs)、[G2 runtime helper](../../tests/helpers/p2-g2-runtime-harness.mjs)。Stub 只替代外部适配，不替代业务服务／PG；每票确认实际风险和已有 seam，不写机械实现镜像测试。

本次读取活动 selection 为 `v3-p09`；后续执行前重读[迁移入口](../typescript-migration/README.md)与[test routing](../typescript-migration/test-routing.json)。普通代码候选遵循严格类型、一次最终构建、相关测试、制品和自有资源清理。T01 的 TDD／types／build／Unit／HTTP／PG／browser 均为 `NOT_APPLICABLE_DOCUMENTATION`，没有运行资源或业务测试。full／current certify／historical certify、真实 Provider／OAuth／WeCom、部署和 Gate 继续独立授权；本轮本地实现不推进 P2-G2-LIVE／P2-008／AI／P3。

## 43 票到工作包及验收组的映射检查

逐票正文和 blocker 的长期入口是[任务清单](tickets.md)与 GitHub；下表仅记录 T01 的完整来源核对，不建立第二份逐票 Backlog。

| 工作包／验收组 | 已核对的票号（GitHub Issue） |
| --- | --- |
| WBINT-00／A00 | T01 (#56)、T23 (#78) |
| WBINT-01／A01 | T02 (#57)、T03 (#58) |
| WBINT-02／A02 | T02 (#57)、T04–T10 (#59–#65) |
| WBINT-03／A03 | T11–T13 (#66–#68) |
| WBINT-04／A04 | T14–T16 (#69–#71) |
| WBINT-05／A05 | T17–T19 (#72–#74) |
| WBINT-06／A06 | T20–T21 (#75–#76) |
| WBINT-07／A07 | T22 (#77) |
| WBINT-08／A08 | T24–T26 (#79–#81) |
| WBINT-09／A09 | T27–T28 (#82–#83) |
| WBINT-10／A10 | T29–T31 (#84–#86) |
| WBINT-11／A11 | T32–T33 (#87–#88) |
| WBINT-12／A12 | T34–T37 (#89–#92) |
| WBINT-13／A13 | T38–T40 (#93–#95) |
| WBINT-14／A14 | T41 (#96) |
| WBINT-15／A15 | T23 (#78)、T40 (#95)、T42 (#97) |
| WBINT-16／A16 | T43 (#98) |

43 个唯一 T／Issue 全覆盖、17 个工作包／A 组全覆盖；T02、T23、T40 各跨两个来源，共 46 条来源关系。2026-10-07 通过 GitHub 当前 blockedBy 查询核对 76 条原生边，与发布记录无差异、无环；43 票均 OPEN、均有 ready-for-agent，T01 由 peterkis 领取且无 blocker。其余票仍受原生前置约束，不因本次全计划授权并行跳过依赖。

本票只完成文档／共同约束。A00 文档结果、保护范围、关闭方式及未运行项见[执行记录](execution.md)；其余验收组仍按[验收矩阵](acceptance-matrix.md)逐票运行，不能由映射完整推导业务 PASS。
