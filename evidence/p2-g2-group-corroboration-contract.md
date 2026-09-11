# 群短回复旁证：持续授权下的契约

原 C030/C031 在唯一兼容锚点下要求“同上/+1”可受理。核查发现 AGG-006 的 INHERIT_FACTS/EMIT_CORROBORATION 只有 Action 日志，普通运行链没有可信锚点输入。依据 continuing-gap-repair-authorization 继续修复，无新表/迁移。

仅对既有 AGG-006 短回复集合严格全匹配。输入必须为实际同 Provider/Bot/group 的普通 Reporter 入站；从群可见已提交原始故障 Decision 选择锚点。禁止从私聊、内部备注、Bot输出、候选、人工覆盖、CONTEXT_INHERITANCE 再继承。最新原始 Decision 先选定再检查资格，最新消息未处理、恢复/关闭/未来/过期时不能回退。

原始明确故障消息与当前短回复的 received_epoch_ms 满足 0≤age≤600000；此为冻结 AGG-006 十分钟窗口，不改 Incident 的120秒窗口。锚点寿命不因补充、谢谢或旁证刷新。数据库物理当前时刻及各来源留存期限同时有效。至多101条，超过100条显式不继承；存在不兼容服务/症状族时不任选。

只复制 Canonical 服务与肯定、有效的故障症状。不得复制患者、人员、部门、地点、设备、根因、责任、Ticket/Incident引用或发送资格，不由人数推断终端数量。敏感来源/数据一致性类症状不用于这一通用继承捷径。新事实标 CONTEXT_INHERITANCE，引用原 Decision/Fact及版本，同时保留当前 Reporter和短回复来源；为新人建立独立 Ticket/Journey，不合并所有权。

首次选定的锚点随 Decision 的 safe_result 固定；相同消息窗口/规则版本重放复用已记录判断，不根据后续群消息重选锚点。没有充分锚点时正常请求描述/人工审核，不能虚构故障。独立 Spec 复核要求的七项边界均纳入上述契约。

实施核对：Inbox默认统一标 PATIENT_SENSITIVE，包括没有患者内容的普通IT故障；Fact默认INTERNAL也不是独立安全证明。因此不按默认Fact标签绕过隐私，而新增持久化 `group_corroboration_safety` 受约束转换资格：目录/症状枚举校验、实际隐私Flags及保守敏感上下文判定、临床风险、策略版本和catalog hash。只允许固定Canonical字段转换，保留源消息分类；并非整条消息降密。旧Decision没有此资格时拒绝。患者/身份/秘密标记、DATA类症状或高风险均拒绝。实际源默认分类纳入内部锚点审计，不进入Reporter输出或通知。
