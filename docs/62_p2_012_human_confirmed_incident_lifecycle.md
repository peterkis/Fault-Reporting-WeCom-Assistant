# P2-012 人工确认公共故障

本实现仅用于合成测试和另行批准的定向现场，时间为 Asia/Shanghai，AI/OCR/RAG 调用为 0。实现代码不代表 P2-G2、Phase 2 Go、生产或临床批准。

CandidateReview 与 Incident 是两种事实。前者 CANDIDATE → UNDER_REVIEW → CONFIRMED，人工也可拒绝；只有显式 SYSTEM 维护可把尚未审核且已过期的 Candidate 标为 EXPIRED。后台不会自动确认、自动 Link 或广播。Incident 人工指定 LOCAL、BUILDING、CAMPUS、HOSPITAL_WIDE，随后只能进入 INVESTIGATING → RESOLVED → CLOSED，无 reopen。confirmed_scope 独立保留。

HANDLER 只能查询本人/所在团队有权 Ticket 的安全摘要，个人恢复还要求当前 Ticket 由本人负责。DISPATCHER 可审核、拒绝、确认 LOCAL/BUILDING、处理和解决；CAMPUS 默认拒绝，必须在命令服务显式配置策略。ADMIN 才能确认全院、修正范围、关闭、管理订阅。负责人必须是现有有效坐席，可选团队必须实际包含该负责人。

命令服务先从原授权表重新读取权限，再查 receipt；同 UUID/规范 hash 重放，异 hash 冲突，资源版本不匹配拒绝。数据库事务一次提交 Incident、Reports、Subscriptions、追加事件、固定通知事实和成功收据。网络不进入事务。状态失败只保留失败收据，不留下部分业务事实。12 路同命令验证只有一次成功新建。

Migration 032 为唯一可执行 DDL，创建严格七表；001–031 不变，无新增 Trigger、持久 Function、Extension 或依赖包。所有业务时间为无时区、秒精度字符串；BIGINT 版本/epoch 以字符串输出，排序依 event_ordinal。migration status/check/apply 校验 catalog、旧 P2-016 表和 realtime 约束；check 回滚，重复 apply 验证后 no-op。关闭时三个默认 false 的 Incident Flag 保持关闭，保留事实，不作破坏性 down migration。
