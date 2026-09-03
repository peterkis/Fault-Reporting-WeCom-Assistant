# P2-015 Contact Journey、Channel Leg 与 continuation_ref

## 事实所有权

`intake.contact_journey` 只表达一次服务接触在多个渠道 Leg 之间的安全关联；它不拥有 Ticket、Conversation Thread、Session 或 Assignment。`intake.channel_leg` 保存现有 Intake/Thread/Session/Channel Message 的 FK 与不可逆 Hash。群聊 Thread 和单聊 Thread 永不物理合并，`origin_channel` 不可变，`current_channel` 只随真实新 Leg 更新。

同一 reporter 可以存在多个 OPEN Journey。唯一建 Journey 的依据是源 Intake 和显式 creation key，禁止 `same userid + nearby time`。直接消息按以下优先级关联：Provider structured context、已有 Direct Binding、有效 continuation_ref、明确 Ticket/Intake opaque ref、唯一等待该 reporter 的 guided Journey；多个候选返回 `ASK_USER_TO_SELECT`，没有可靠候选返回 `DIRECT_ORGANIC`。候选最多 10 个，摘要只含 opaque ID、服务、工单尾号、时间和安全状态。

## 分段消息

每条消息先由 P1 持久化。Journey 按 `service_intake_message.sequence_no` 读取，默认最多 50 turns、总文本最多 20,000 字符；超限进入 Manual Review，不能截断后伪装完整。3 至 15 秒防抖以 `evaluation_due_at + evaluation_due_epoch_ms` 持久化，不使用无界 Timer。P1 90 秒聚合不等于 Journey 生命周期；显式“新报修/另一个问题/重新报修/其他 Ticket”由 P1 边界生成独立 Intake/Journey。

## continuation_ref

原 token 由注入 CSPRNG 生成，只在首次 issue 返回；数据库仅保存 SHA-256 Hash。引用同时绑定 reporter HMAC、bot HMAC 和单一 purpose，默认 TTL 不超过 120 分钟，并使用 Asia/Shanghai LocalDateTime 与权威 BIGINT epoch 配对。wrong reporter、wrong bot、过期、撤销和第二次消费均失败关闭。相同 issue idempotency key 返回同一引用 ID，不创建第二行；重放不会把 token 或 Hash暴露到日志或 public view。

Direct Leg 只有在真实 Direct Context 已持久化后才能绑定。continuation_ref 不是身份认证凭证，不能替代授权或记者归属校验。

## Reporter Directory

`ReporterDirectoryPort` 本轮只允许 Mock/Deferred/NotFound/Faulting Adapter，不进行真实企业微信目录网络调用。canonical reporter key 由注入 HMAC key 产生，不是 raw userid；失败降级为 `DEFERRED`，不阻止 Intake 或明确故障 Ticket。受控 Snapshot 可含多部门、source/version/fetched_at/valid_at，reporter department 与 occurrence department 分离；public view 和错误码不返回姓名、部门原文、userid 或 chatid。
