# P2-012 Incident、IncidentReport、ReporterSubscription 与人工确认

- Status: DONE
- Authorized at: 2026-09-04
- Authorization evidence: `evidence/p2-012-start-authorization.md`
- Phase: P2 / IN_PROGRESS
- Lane: P2-D
- Depends on: P2-007, P2-015, P2-016
- Target Gate: P2-G2（未启动）
- Migration: 032，仅本任务的 P2-D 编号例外；001–031 冻结
- Feature Flag: `INCIDENT_CORRELATION_ENABLED=false`

## 输入、输出与 Contract

消费 P2-015 已持久化的 INCIDENT_REVIEW_CANDIDATE Decision、安全结果、Provenance、源引用和冻结的 P2-007 候选输出。Candidate Key 包含源 Decision ID 与 result hash。群组指纹只作证据，不能触发合并、确认或 Link。

输出为独立 Candidate Review、真实 Incident、个人 IncidentReport、按现有稳定 reporter binding/hash 去重的 ReporterSubscription、幂等命令收据、追加式事件、可靠通知绑定、内部 REST/UI 和 Reporter-safe milestone。HTTP/UI 只调命令服务；外发复用 P2-004/P2-016 Communication/Outbox/Delivery/Sender。

Contract 包括闭合 JSON Schema、TypeScript 与 OpenAPI。输入限定 ordinary plain JSON；拒绝 Proxy/accessor/symbol/toJSON/cycle/pollution、额外键和超限结构。版本为明确 expected version，deadline 为 BIGINT/API string；业务时间继承 ARCH-005 的 Asia/Shanghai LocalDateTime。

## 数据库与状态

032 仅创建 incident.candidate_review、incident.incident、incident.incident_report、incident.reporter_subscription、incident.incident_event、incident.command_receipt、communication.incident_notification_binding 七张业务表。需要第八张时停止报告；不新增 Trigger/持久 Function/Extension。

- Candidate：CANDIDATE → UNDER_REVIEW → CONFIRMED；CANDIDATE/UNDER_REVIEW → REJECTED；仅显式 SYSTEM maintenance 可 CANDIDATE → EXPIRED。
- Incident：CONFIRMED_LOCAL/BUILDING/CAMPUS/HOSPITAL_WIDE → INVESTIGATING → RESOLVED → CLOSED；scope 独立保存；无 reopen。
- Report：CANDIDATE/LINKED/UNLINKED/REJECTED；个人 impact 为 UNKNOWN/IMPACTED/RECOVERED。每次 Link/Unlink 留痕，原 Intake/Ticket 保留；同 Ticket 最多一个当前有效 Incident 关联。
- Subscription：PENDING_DESTINATION/ACTIVE/PAUSED/ENDED；同 Incident+reporter 唯一；缺可靠 Direct Leg 不伪造目标，合法目标出现后显式激活。
- Primary Ticket：可空、人工选择、更换留痕、必须已 LINKED，解除前先显式清除/更换。

人工确认原子提交版本校验、Incident、选定 Report、Subscription、Event、Notification facts 和 Receipt；外部网络不在事务中。个人恢复不改变其他 Report/Subscription、共享 Incident 或任何 Ticket。Incident resolve/close 不关闭个人 Ticket。

## 权限与通知

HANDLER 仅查询有权 Ticket 对应的安全 Candidate/Incident、记录负责 Ticket 的个人恢复。DISPATCHER 可审核、拒绝、确认 LOCAL/BUILDING、依明确策略确认 CAMPUS、Link/Unlink、设主 Ticket、处理与解决。ADMIN 负责 HOSPITAL_WIDE、范围修正、关闭、订阅管理与通知核对；默认拒绝，不建新角色/人员表。

所有写命令先认证授权再读取收据，校验 CSRF/Bearer、Idempotency-Key、expected version；同 ID 同 hash 重放，同 ID 异 hash 冲突。Incident Event append-only，同秒用 event_ordinal。固定通知只由人工确认后的真实 Event 触发：confirm 群/个人、investigating 个人、resolved 群/个人、closed 个人。自然键为 Event+audience+binding hash+template+version；UNKNOWN 进入 Reconciliation，不盲重发。

Reporter 只见本人仍 LINKED Ticket/Report 的四种固定公共里程碑，与 Ticket Timeline 并列；不见候选、聚类指纹、内部原因、责任人、其他 reporter、原始身份、Provider 错误或患者/IP。

## 验证与资源

Contract/Unit/PostgreSQL Integration/Browser 必须覆盖：fresh/existing/no-op/check rollback/至少五类 drift/七表精确 catalog；人工与角色范围、并发 12 路 confirm、响应丢失重放、版本与幂等冲突；Link/Unlink/relink/主 Ticket；跨渠道 Subscription 去重、缺目标/激活/暂停恢复；10 人中 1 人恢复其余 9 人和 Incident 不变；生命周期合法/非法转换；通知去重/失败/UNKNOWN；Reporter 权限与隐私；CSRF/XSS/恶意 JSON。

内部复用 durable SSE、Last-Event-ID、Replay Gap、32 客户端与第 33 个 polling fallback；Reporter 用有界 polling。桌面 1440×900/1366×768、移动 390×844，无横向溢出、可键盘操作、focus-visible、认证过期、409 refetch、命令围栏、刷新一致，不伪造乐观成功。

容量：500 Candidates、200 Incidents、2000 Reports、1000 Subscriptions、5000 Events、500 Notification bindings、32 SSE。单池 max≤4，不新增常驻 Incident Worker；复用 Delivery Worker。heap/RSS 分段稳定或回落，验证 kill/restart/replay 和 Timer/Socket/Child/backend/temp DB 清理。不是 24h soak、真实 2C4G 硬件认证或 P2-G2 Gate。

必须保留 P1、P2-003/004/005/006/007/015/016、ARCH-005/006 回归；全仓不少于基线 535 个测试，fail/cancelled/skipped/todo=0，不跳过 Integration/Browser/Sender。自动 Incident、自动 Link、按用户时间关联、并单/删除个人 Ticket、内部备注外泄、模型/OCR/RAG 调用均为 0。

## Evidence 与停止线

第一提交后生成 before 能力盘点（Markdown/JSON），不得把 Ticket 能力当成 Incident 能力；记录 ADR-0015 五分钟与冻结 Runtime 120000ms 漂移，不校准。实现后生成 automated-readiness 双格式报告与失败关闭的 live-check/live-e2e 入口。

自动化完成后停在 READY_FOR_TARGETED_LIVE_VALIDATION；不创建第二提交。真实定向现场另获负责人批准，五项 live/send/public/private 审批全满足，带【P2-012测试】，至少 2 个 Reporter/Report、15 分钟观察、ACK/客户端观察/数据库核验/负责人批准分开记录。现场与最终回归通过后才 DONE 并作唯一第二本地提交；P2-G2 仍未启动。

专用测试群现场采用 `APPROVED_GROUP_PARTICIPANTS`：批准群成员可由真实带标签群 Frame 动态建立 Reporter 范围，不要求预配个人 userid；单聊和私人通知必须回查同一 Reporter 的批准群事实并使用实际 DIRECT leg。群外、无标签、未先进入批准群或未建立 DIRECT leg 的用户仍失败关闭。

关闭方式：所有持久默认 Flag=false，关闭新增 Route/Policy，保留追加事实，不破坏性 down migration。完成后立即停止，不 push、PR、merge、tag 或 release。

## 自动化阶段交接

自动化就绪快照见 `evidence/p2-012-automated-readiness-report.md`。真实定向现场、客户端确认、独立非 Incident 死信接受、现场后回归和负责人批准见 `evidence/p2-012-targeted-live-validation.md`、`evidence/p2-012-post-live-regression-report.md` 与 `evidence/p2-012-project-owner-approval.md`。完成态与唯一第二个本地提交见 `evidence/p2-012-human-confirmed-incident-report.md`。当前无活动任务，下一候选 P2-G2 未授权；所有默认 Flag=false。
