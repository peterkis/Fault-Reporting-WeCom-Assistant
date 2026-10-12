# T25 / #80：首个来源通知契约与 SOURCE 准备

状态：`SOURCE_PREPARED_NOT_RUN`。本文件记录最小契约及首个 tracer，**不表示 T25 完成、RED/GREEN、A08 验收、装配支持或真实送达**。起始私树 `codex/wbint-t25`，基线 `d8b02d5b7915370d2edfb5beed1f30b6ac640eb2`。父任务 fresh GitHub readback 已确认 #80 OPEN、ready-for-agent、peterkis 领取，#66/#73 CLOSED；之前探索摘要中 #73 OPEN 属于历史快照。

输入：[原票 #80](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/issues/80)、[WBINT-08](../implementation-plan.md#wbint-08按原始来源生成和执行独立通知)、[A08](../acceptance-matrix.md)、[ADR-0023](../../../adr/0023_origin_based_notification_routing.md)、[ADR-0024](../../../adr/0024_staff_completion_and_takeover.md)、[ADR-0025](../../../adr/0025_third_party_staff_directory_provider.md)。本阶段只准备源码，运行窗口由父任务统一安排。

## 最小闭合接缝

已确认接缝：实际 `createYxxSelfServiceStore.accept` → 同一 `createPilotTicketCore.createForIntake` → 工作人员 HTTP `take-and-start` → 公开 `createTicketRoundNotifications.runOnce` → 已授权 `GET /api/tickets/{id}/deliveries`。现成 [T24 fixture](../../../tests/helpers/t24-round-notification-fixture.mts) 以 `manualRoundConsumption=true` 关闭自动调度，避免竞态；不是修改生产调度或新建第二个 Worker。Core/HTTP 创建真实责任轮次，测试不通过 SQL 伪造业务节点。

新增窄类型合同：[workbench_app_notification_contracts.d.ts](../../../contracts/workbench_app_notification_contracts.d.ts)。它定义原来源 scope、当前目标 Resolver、既有映射/应用配置权威、私有出站目标及安全路由字段；当前生产 factory **尚不识别** `appNotifications`。首例通过有类型的 options 变量传入新增合同，不断言旧接口已支持，不采用 any、忽略类型或双重未知断言。

| 边界 | 约束 |
| --- | --- |
| H5 原来源 | 033 的 `web_request_binding`、原 Journey/WEB_FORM leg、canonical HMAC、corp/app/proof、非撤销及保留期；HMAC 与既有 authenticate 的 member namespace 一致 |
| 已核实代录原来源 | 045/051 的 private ADMISSION scope/proof 和不可变报修快照；来源保持 MANUAL，不伪装 Web；历史 ADMISSION 有效期不作为未来发送权限 |
| 当前目标解析 | 原来源 scope 与现有受控映射/应用权威共同核验；目标为经核验 InternalMemberId，不用 hash、candidate_ref、目录 user_id/wecom_id、OAuth open_userid、姓名或手机号替换发送 ID |
| Resolver | 明确 localOnly 的当前权威边界，closed unknown envelope 在宿主验证；企业/应用、原 scope、mapping/proof、ACTIVE/VERIFIED/REACHABLE 必须一致；不在事务中访问 Provider/SDK |
| 结果 | ELIGIBLE 才可承诺应用通知；NO_MAPPING、错范围、STALE、REVOKED、UNREACHABLE、UNKNOWN 不换人/换应用；手填仍人工联系且零外发，历史报修事实不回写 |
| 路由读取 | proposed additive `route_kind=YIXIAOXIU_APP`；接收人类型仍 PERSON。公共 Delivery 不返回原始成员 ID、绑定摘要、账号、mapping/proof 或 Provider receipt |
| 持久消费 | 继续同一 T24 runOnce、LIMIT 20、single-flight、Ticket→cycle 锁顺序、durable anti-join 与唯一业务身份。Ticket＋cycle＋node＋原来源/Reporter/destination binding；模板升级不另建意图 |
| Sender | 沿同一 Communication Sender Port/Worker、Message/Outbox/Delivery/Attempt；应用不能伪装 WECOM_AIBOT。ACKNOWLEDGED / REJECTED_NOT_APPLIED / UNKNOWN 独立保存；UNKNOWN 不盲重发 |

首个测试：[t25-h5-first-responsibility.integration.test.mts](../../../tests/t25-h5-first-responsibility.integration.test.mts)，注册 selection `wbint-t25-first`，STAGED_RUNTIME、requires_database=true、requires_browser=false。测试生成与 synthetic corp/app/member 一致的 canonical HMAC，通过已有认证 scope 守卫与 Store 写入；唯一 SELECT 仅定位真实 Store-created Intake 供公开 Core command 使用，不作为结果断言。显式 Resolver Stub 是外部身份权威边界，不 mock 自有消费/Core/HTTP/Delivery。

实际 runtime 状态均为 `NOT_RUN`。预期第一项业务缺口：工作人员真实承接建立 FIRST basis 后，旧 `readOriginalSingleBotSource` 排除 H5，因此应用 Delivery 缺失（当前返回零意图），first assertion 应失败。若迁移、fixture、认证、承接、制品、HTTP 或 Resolver 配置先失败，须保留其实际类别；未到该断言不能叫业务 RED。当前没有执行来确认这一预期。

## 整票仍须完成

本首例覆盖单个 H5 首次责任切片。继续按一次真实 RED → 最小实现 → GREEN 推进，不能预写所有风险测试，也不能把首例 GREEN 当整票完成：

- H5 及已核实且当前可达代录的原来源应用通知；Bot 来源不改路、未核实/不可达人工联系和零外发。
- 各轮首次明确责任与 STAFF_COMPLETED 唯一意图、同轮转派/接管/撤派/退回不重复、新轮次新通知、Worker 崩溃/重放恢复；安全完工摘要与内部过程分离。
- 窄目标 Resolver 的当前资格守卫、Communication destination 安全模型、应用 Sender、runtime 单 Worker 装配/default-off/零外发 profiles 与独立 Delivery 控制。
- H5 原 request_ref 沿既有本人详情；已核实代录须补本人归属读取，不能塞成 BOT_TICKET。卡片定位引用、OAuth 成员认证、对象授权分别核验；模板只含批准的编号、外显状态、安全结果与详情入口，无 Cookie/CSRF/Grant。
- Stub 成功/失败/UNKNOWN/恢复、成员变动、越权/撤销/保留期、HTTP 与生产前端 browser evidence、所需官方适配器文档、schema/接口导航同步、准确 tested object、资源清理及独立审查。

数据库：本次**无数据库变更**，旧 033/041/045/051 SQL 未改。后续仅在实际 RED 证明需前向扩展时使用预留 054；不回写迁移账本、不建第二 Ticket/Core/Outbox，不与 052（T26）或 053（T37）冲突。

资源及回退：沿既有单 App/Worker、通信并发 1、SSE 32、池总量建议 ≤8；Resolver 响应有界及 deadline/输入守卫在后续运行实现验证。新增应用能力默认 false；关闭只停止新入口/消费/发送，保留既有业务、待核对与历史意图。撤回本 SOURCE 提交仅移除本类型/测试/文档/注册，不改变业务状态。本阶段 install/build/types/tests/PG/HTTP/browser/Sender/Provider/full/certify/deploy/Gate 均未运行。
