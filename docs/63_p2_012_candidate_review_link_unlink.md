# P2-012 候选审核与个人报告关联

Candidate 唯一键绑定 P2-015 Decision ID + result_hash；cluster_key_hash 仅供证据，不用于幂等或自动合并。Query 从已持久化 result_code=INCIDENT_REVIEW_CANDIDATE 读取，保留来源、版本、源 hash 和安全事实 ID。

已知前置缺口：历史 P2-015 safe_result 只有候选 boolean，没有完整聚类计数。它仍可供人工审核；缺失 cluster hash、人数/科室/地点计数、窗口与 first/last_seen 显式为 null，UI 显示“来源未提供”，scope 建议为 UNKNOWN。绝不从原文、附近时间或单个 reporter 重建这些统计。完整冻结 P2-007 Candidate 可经可信 Source Adapter 追加一个新的 P2-015 Decision；旧 Decision/hash 不改写。这个内部入口没有 HTTP 或浏览器授权。

阈值漂移原样记录：ADR-0015 使用 5 分钟审核观察，冻结 Runtime correlation_window_ms=120000。二者不在本任务校准；人工 scope 可与候选建议不同，必须留下人工命令和追加事件。不同 Decision/窗口允许独立审核，不因相同 cluster 指纹复用历史结果。

确认时人工选定 Report refs 和负责人。每个选择经旧 Ticket 权限核验并且属于该 Candidate 已冻结的来源集合。候选缺失来源摘要时仅提供实际 Decision 本身；之后可显式 Link 已持久化报告。一个 Ticket 不得同时 LINKED 到两个非 CLOSED Incident。一个 Incident 内同一 Ticket 可以有多条不同来源 Report，不删除原 Intake/Ticket。

Primary Ticket 可空，只能明确选择当前 LINKED Ticket；必须先清除或更换，才可解除该 Ticket 的关联。Link/Unlink 留下同一 Report 的版本与审计；最后一份 Report 解除时 Subscription ENDED，否则选择仍关联的代表 Report。显式 relink 可恢复关联，但不会修改 Ticket 状态。UNLINKED 属于 Report，不属于 Incident。

列表默认30、最大100；报告/订阅页最大100，事件页最大200，所有游标绑定资源/列表类型，过滤权限先于 LIMIT。内部工作台通过同一 API/SSE 组装，Reporter 使用现有身份边界和有界轮询。
