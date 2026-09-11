# P2-G2 精确引用续接契约

依据负责人持续授权及独立Spec/Standards裁决，补齐普通Direct文本入口。SDK 1.0.6的quote无原消息ID，不能仅凭引用文字关联。冻结X005/008/012/020/030中的安全引用使用实际群回执生成的32字符public_ref；来源原文不改写，执行记录单独标识该替换。D12-018同样只接受完整opaque引用，尾号不是凭据。

群Ticket受理事务由现有reporterAccess.ensurePublicRefInTransaction生成非凭据public_ref，在既有Communication Outbox群回执中提供“续接工单 <public_ref>：补充内容”。不调用issueInTransaction，不产生private Delivery、Grant或访问Session。引用大小写精确匹配。

Direct入站识别该应用命令时，在P1聚合选择前强制建立新的Direct上下文。Worker在事务中从可信入站Bot/Reporter校验public_ref的ACTIVE状态、绑定hash、Ticket/原Intake/Journey关系、保留期及未终止状态；只把当前新Leg附于明确原Journey，原Intake、原消息与Ticket来源不变。已属于其他Journey的Leg不重挂。已有Ticket经原Ticket Command Port重放复用，不建第二张Ticket。

引用拒绝时保留当前入站并建立Manual Review；其中明确故障仍独立受理。不能回落到最近或唯一候选猜测。后续普通Direct消息沿新Session续接，显式新故障沿现有分界规则另行受理。public_ref不是秘密token，不授予Reporter页面访问或发送资格；真实Direct Leg仍由入站建立。无新迁移、无新Provider字段、无自动Incident操作。

必测正向与重放、跨Bot/Reporter、撤销/保留期、无效引用、已有不同Direct上下文、无private制品、一个Journey两个独立Intake且一个Ticket，以及原始来源时钟。模板卡片事件入口另计，不把URL点击或普通quote当作已完成卡片续接。
# P2-G2 原始报修时间补充契约（2026-09-09）

原始 X020 的 `reported_at` 沿最初用户消息的有效 Provider 时间确定；后续 Direct 补充不得重写。`last_activity_at`、续接超时、评估窗口和保留期限仍以接收/活动物理时间计算。新增 Journey 使用原消息已持久化且不晚于接收时间的 `create_time`；缺失或晚于接收时间时回退该原消息 `received_at`，原 Provider 值仍保留在 Inbox 中，不覆盖五种独立时间。这里只修正新 Journey 创建，禁止重写已有报修时间或迁移历史行。
# 关联理由的持久化补充

D12-014 要求唯一候选关联可审计。实际关联通过后，在首次相应 Decision 的安全结果中保存 `journey_association`（白名单方法、Journey/Leg 安全 UUID 引用），与原始结果 hash 一起追加，不覆盖识别 reason_code。方法区分 UNIQUE_GUIDED_JOURNEY、EXISTING_DIRECT_CHANNEL_BINDING、EXPLICIT_TICKET_REFERENCE；不加入 Reporter 原始标识、token 或目录资料。已有消息窗重放返回已提交 Decision，不重写原理由。无数据库迁移；这不是放宽关联资格。
