# P2-G2 有界跨 Reporter 候选契约

授权来源：`p2-g2-continuing-gap-repair-authorization.md`。此文先于实现冻结输入、边界和输出。

普通 Intake/规则受理先提交；现有 Incident Worker 随后在独立事务读取不可变 Decision 并复用 Candidate Source Adapter。聚合失败可重试，不回滚已受理 Ticket。只受既有 INCIDENT_CORRELATION_ENABLED 及后台执行开关控制，默认关闭，无 DDL。

读取至多 101 条当前有效 Intake 的最新原始 p2-007-adapter Decision；超过 100 条时整批拒绝聚合，显式报告容量超限。选最新后再判定资格，不能从旧有效 Decision 回退。要求有效 Journey/Leg、身份哈希一致、保留期有效、Intake 最新消息已处理、已建立独立 Ticket、明确故障意图及服务/症状/事实来源，无冲突和人工覆盖。

同 Bot、相同 Canonical 服务及兼容症状族才可聚合。UNAVAILABLE、CRASH、BLANK 在同服务内属于 SERVICE_UNAVAILABLE；NETWORK.DISCONNECTED 独立，其他症状只与自身兼容。多症状跨族保守排除。人数来自 Journey/Leg 的可信 Reporter 哈希去重；不得从原文“全院”“多人”、测试预期、群身份推导。无可信目录和地点事实时计数为 0，不启用监控/活动 Incident 捷径。

窗口使用 Inbox 的真实 received_epoch_ms，固定 120000ms。每个 Intake 的锚点为同服务最早原始故障决策结束消息，防止后续“谢谢”刷新旧故障。当前时间由数据库物理时钟提供；测试可显式提供受控时钟用于边界验证，但不修改持久化来源时间。过期、未来消息均排除。

调用原冻结 generateIncidentCandidate，不覆盖阈值。每族每轮最多一个事实快照，最多处理 20 族。候选记录实际 Decision IDs 和事实 IDs，保持人工确认；不自动 confirm/link/通知、不合并 Journey/Ticket。相同成员快照重放/并发只生成一个派生 Decision；新成员形成追加快照，已有快照不修改。事务级 advisory lock 串行化聚合，与普通受理事务独立。

验证须包含真实本地 PostgreSQL 三人入站正例、同人跨渠道/重放、少于阈值、不同服务/症状、窗口过期/未来、旧故障不刷新、Feature Flag、并发与重启重放、独立 Ticket 保留及零自动 Incident/发送。来源语料旧 draft 的 300 秒及其他 scope 术语不修改冻结 120 秒和现行 scope 枚举；裁定明确区分。
# P2-G2 后续授权补充：可信目录部门与源用例裁决

仅从 RESOLVED Journey 的不可变 WECOM_DIRECTORY/version 快照读取目录明确给出的唯一 PRIMARY department_ref；缺失、多 PRIMARY、未知来源/version 不计部门。先按同 Bot 的 Reporter 消歧，同一窗口不同 Journey 的 PRIMARY 冲突记未知，再将部门引用按 Bot 哈希隔离传给冻结引擎。不从报修文本、数组首项、唯一 membership 或姓名推断部门；不改原快照。

部门是 Reporter 所属部门，不是故障发生地点。没有可信地点，distinct_locations 保持 0。D12-043 的源 LOCAL 对应现行 DEPARTMENT（有唯一可信部门）；D12-044 的 CROSS_DEPARTMENT 对应现行 CAMPUS。D12-045 八人三部门、只有一个源 building 不能满足两地点阈值，裁为 CAMPUS，不能把 HOSPITAL_WIDE 原期望标为通过。全部保留原 300s 源文档，实际验证使用冻结 120s，禁止修改阈值。

D12-051 通过实际内部候选工作台列表/详情验证候选可见及幂等；与已有 Ticket 回执分开计算候选阶段外发增量。候选不产生 Incident、Report 链接、Subscription 或群/私人广播。独立 Spec 审查确认上述裁决，仅为本次准备合同，不是最终 Gate 通过。
