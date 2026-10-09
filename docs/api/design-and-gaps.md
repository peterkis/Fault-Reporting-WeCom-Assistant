# 设计接口、兼容路径与已知差异

返回 [导航](README.md) · [完整路径索引](endpoint-index.md)

本页是2026-10-07源码核对结果。本轮整理记录差异，没有实施API重构或修改历史证据。设计路径可以保留为需求参考，不能让前端按其直接调用。

完整人工管理端的后继缺口已拆入[实施计划](../../plans/admin-workbench-integration/README.md)及[页面／接口映射](../../plans/admin-workbench-integration/capability-map.md)。该计划于2026-10-07确认，全部业务实施任务仍为NOT_STARTED；其中新增PATH均为待冻结候选，不是本页真实接口的别名。

## 早期OpenAPI尚未挂载的入口

以下在 [contracts/openapi.yaml](../../contracts/openapi.yaml) 有设计定义，当前src HTTP分发没有相应handler；其鉴权、输入输出和错误只是设计合同。不存在监听这些路径的项目服务。

| METHOD + PATH | 已有能力的真实入口 / 边界 |
| --- | --- |
| `POST /internal/v1/intakes/wecom` | Gateway→Inbox→Intake为内部adapter/事务，见[内部Port](integrations/internal-ports.md) |
| `POST /internal/v1/messages/{messageId}/media` | 媒体注册设计；未开放当前HTTP |
| `POST /internal/v1/ai/triage` | AI建议设计；当前业务无模型HTTP client |
| `POST /internal/v1/wecom/card-actions` | 现有通道回调/Action内部服务，非这个HTTP路径 |
| `POST /api/v1/tickets/{ticketId}/actions/accept` | 当前 `POST /api/tickets/{ticketId}/accept` |
| `POST /api/v1/tickets/{ticketId}/actions/start` | 当前 `POST /api/tickets/{ticketId}/start` |
| `POST /api/v1/tickets/{ticketId}/actions/request-information` | 当前 `POST /api/tickets/{ticketId}/request-information` |
| `POST /api/v1/tickets/{ticketId}/actions/resolve` | 当前 `POST /api/tickets/{ticketId}/resolve` |
| `POST /api/v1/tickets/{ticketId}/actions/confirm` | 当前 `POST /api/tickets/{ticketId}/confirm` |
| `POST /api/v1/tickets/{ticketId}/actions/reopen` | 当前 `POST /api/tickets/{ticketId}/reopen` |

[docs/08](../08_api_contracts.md) 的早期 `/api/v1/incidents/...`、`DELETE .../reports/...`、publish-update、`/metrics` 等示例也不是当前分发清单。Incident当前用 `/api/incidents/...` 与POST unlink；metrics是 `/health/metrics`。该早期文件还保留旧Hospital Tickets迁移描述，当前V1.4明确Unified Ticket Core唯一事实源、P3绿地且无历史Ticket迁移。发生设计冲突时遵循权威文档/Accepted ADR，不根据这些旧段落新增兼容系统。

## 容易导致前后端偏差的事实

| 差异 | 当前使用方式 |
| --- | --- |
| `/api/v1` 是早期原则，实际路径多为 `/api/` | 查当前METHOD+PATH，不能统一自动加v1 |
| 旧“所有响应含trace_id” | 当前handler通常直接DTO或error，不补造字段 |
| Ticket UUID / public_ref / request_ref / entryRef | 四类资源标识；内部UUID、Reporter32位ref、Web32位ref、continue64hex不能互换 |
| 版本类型 | 会话number、Ticketnumber、Review/Incidentstring、Web input_revisionstring、SSEstring；具体Header各有协议 |
| `/wecom/yixiaoxiu/logout` | OAuth-only HTML；member/native JSON；与装配顺序有关 |
| `/api/reporter/bootstrap` | legacy含public_ref；member返回认证状态；不是同一DTO |
| 旧Grant交换 | MEMBER_REQUIRED明确403，不是OAuth失败回退 |
| service-catalog | 当前已实现新增GET；原“七个操作”冻结列表不包含后继增量；读写开关/成员授权均需要 |
| legacyP1 | 独立宿主，camelCase命令；不是当前W/M的路由别名 |
| UnifiedTicketEventPort | 长期名称，目前没有同名可导入接口；不要推定HTTP路径 |
| SSE事件 | 授权投影与重读信号，不能用作工单状态或正式现场证明 |
| 静态页面method | 旧P2 static分发未统一检查method；预期GET不等于现有严格约束 |

## 占位、模拟和未开放能力

基础会话宿主的 `GET /api/attachments/*` 仍显式404不可用。后继 [WBINT-T16](workbench/attachments.md) 在P2016宿主增加精确事项元信息和PNG/JPEG下载，默认关闭；只读取显式受信已保存的加密资产，生产登记／扫描／key装配仍需独立提供。Ticket auto-close和candidate expire只有内部SYSTEM/维护动作，未公开HTTP；没有公开test-auth登录或 `/auth/bootstrap`。当前业务src没有Jev/DeepSeek/其他模型client；research文件和网络阻止probe不构成业务接口。

[WEB01合成原型](../../web/admin-workbench-prototype/README.md) 使用纯synthetic数据、无业务API。synthetic preview可能复用既有HTTP宿主，但模拟认证/SSE/数据只证明原型行为，不能升级为生产可用。正式React客户端通过真实bootstrap/board/items读取Ticket；后继默认关闭的[来源群名称维护](workbench/source-groups-design.md)仅允许ADMIN修改显示资料。

## Contract覆盖的具体限制

`contracts/yxx_self_service.openapi.yaml` 是成员业务的较完整闭合合同；`conversation_center.openapi.yaml` 混合领域与工作台API，须核对真实handler。部分内部查询（事件、联系资料、Incident子查询）返回专门SQL投影，并不直接返回同名持久化Schema的完整row。模块文档列出实际返回字段，链接Schema/类型用于进一步核对，不能把内部数据库字段全量序列化给前端。

后续若确认真实契约缺陷，应先按已有ADR/任务授权修正对应合同和实现、添加针对风险的验证，再同步本目录。本轮没有为这些差异新建候选、改Gate或运行full/certify。

## WBINT-T08 SOURCE合同增量（2026-10-09）

[撤销当前未开始派工](workbench/tickets.md#撤销未开始派工wbint-t08plannednot_run)已冻结独立闭合Schema，`POST /api/tickets/{id}/unassign`及专用只读ACK仍PLANNED/未挂载，所有运行NOT_RUN。当前T06 assignment事件、039及Control caller-Tx只提供复用接缝，不能替代release状态/角色/fence/历史、same-round再承接与正式bundle验收。未知legacy责任边界失败关闭，不将本轮过去曾started永久绑定新承接；当前进行中和两waiting须独立T09，T09仍blocked。本阶段无SQL/产品实现，未来最小前向release event/null metadata CHECK编号由父另行分配，不占046。[原七项执行](../../plans/admin-workbench-integration/execution/t08.md)仍IN_PROGRESS。
