# 联系人收件箱与聊天投影

本次增量复用 `/workbench/app/conversations`、原 Session 命令、Communication/Outbox/Delivery、个人 Cursor 和唯一 Realtime controller。宿主 W，认证、CSRF、当前授权和时间约定沿[公共约定](../conventions.md)。本地实现的实际验证见[执行记录](../../../plans/admin-workbench-integration/execution/conversation-inbox-v1.md)。所有示例只使用合成资料。

## 开关与兼容

`createP2016Runtime` 新选项 `workbenchConversationInboxEnabled=false`；与 `workbenchConversationsEnabled` 同时开启才提供新视图。bootstrap 增加 `conversation_inbox_enabled:boolean`，旧客户端缺字段按 false。开启时要求已有 `identityHmacKey` 至少16字符。开关只控制入口与新增读取，不能撤销人工接管历史或恢复已暂停主题的普通规则回复。

关闭新开关，新读取返回503，原 Session 页面、默认详情/Items/Delivery 响应及全部原命令保持原合同。没有新增业务表或数据库迁移；现有受理、Journey、消息、责任和事件仍是唯一事实来源。不存在新增联系人写接口、跨 Journey 关联命令或新 Bot 连接。

## 联系人分页

`GET /api/workbench/conversation-inbox`

| 参数 | 合同 |
| --- | --- |
| state | 默认 open；open/mine/unassigned/waiting_human/waiting_user/failed_delivery/ended。ended 只包含已结束对象，其他队列排除 ENDED；waiting_human 包含待接待或已请求人工的对象 |
| source | all（默认）/group/direct；按原始来源筛选，可靠群转私聊仍为 group |
| q | trim 后最多128 Unicode字符；只搜索姓名、主题和当前获权工单号；SQL 参数化，`%`/`_` 按字面匹配 |
| source_group_ref | 现有64位小写十六进制安全群引用；从获权来源标签取得，不接受原始群ID |
| cursor | 已签名 opaque keyset cursor；不能自行构造或跨认证会话复用 |
| limit | 默认30，1–100 |

响应 `{items,next_cursor}`。每项包含 `contact_ref`、姓名、核实部门或 null、定位 Session、当前筛选内的主题数/本人未读、最新安全文字摘要、活动时间、原始来源标签、责任摘要与投递异常。来源标签最多8个，额外数量单列。只有未过保留期且当前获权的真实 Session 进入筛选和聚合。可靠 Journey 的群/私聊窗口只计一个主题；不能证明关联的 Session 各自计数。

联系人身份为受保护的 provider/account/participant 元组。`contact_ref` 使用已有密钥和专用用途前缀生成 HMAC；`topic_ref` 另有用途前缀。两者不包含可解码身份，不复用内部 reporter hash。响应不输出渠道账号、用户ID、群ID或私有身份元组。列表不继承旧页面200个 Session 的上限。先授权、保留期、筛选与联系人聚合，再 keyset 分页；摘要、本人 Cursor 与投递异常按联系人页批量读取。

游标绑定主体、认证会话、角色/团队范围、全部筛选与安全 Session 锚点。锚点失权、排序时间/定位 Session 变化、筛选或授权范围变化返回400 `WORKBENCH_CURSOR_INVALID`；客户端从最新页重读，保留当前明确 Session 选择。读取事务的最终快照同时核验当前认证、角色/团队、锚点与返回材料。不得把聚合数或聚合责任解释为可写权限。新收件箱启用时，竞争接管导致TAKEOVER失效但仍有当前READ的请求返回409，重读真实负责人；真正失权仍沿原404/403清理。旧默认路径的关闭状态和响应保持原合同。

## 相关主题与窗口

`GET /api/workbench/conversations/{anchorSessionId}/related-sessions`

参数仅 `cursor、limit`，默认50、最大100。先证明锚点当前可读，再返回同一受保护身份的当前获权真实 Session，包含历史。每项为聊天详情及稳定 `topic_ref`。不跨 Bot、不按姓名、不按共同 Ticket 合并；纯 H5/电话事项没有真实 Session 时不制造聊天窗口。

响应 `{items,next_cursor}`，按活动时间与 Session ID 降序。游标同样签名并绑定认证/范围/锚点/limit；锚点不存在或失权404，分页锚点变化400。新关联私聊仅提示“本主题有私聊补充”，由工作人员明确切换，再依据该 Session 当前 capabilities 继续接待。ENDED 只读，不复活旧 Session，也不因会话结束关闭 Ticket。

## 显式聊天投影

默认接口响应和旧 Schema 不变；仅以下 GET 接受 `view=chat`，并要求两个工作区开关同时开启。

| 方法与路径 | 新投影 |
| --- | --- |
| `GET /api/workbench/conversations/{sessionId}?view=chat` | 原详情加联系人/主题引用、核实部门、原始来源、当前窗口和固定本人 Bot 私聊去向；capabilities 仍仅属于明确 Session |
| `GET /api/workbench/conversations/{sessionId}/items?view=chat` | 默认最近50，最大200/页；before_sequence 或 after_sequence 二选一。增加实际发送者安全姓名/类别、精确 communication_message_id、来源标签和媒体可用状态 |
| `GET /api/workbench/conversations/{sessionId}/deliveries?view=chat` | 参数 message_ids（最多50个唯一UUID的逗号串）、cursor、limit（默认/最大100），按 Delivery UUID keyset 返回 `{items,next_cursor}`。只能读取当前 Session、保留期内外部 Message 的精确 Delivery |

发送者由原 Message 的 sender/principal、原安全动作及人工复核主体推导；不用当前接待人替代历史发送者。Items 经原 Item Source/Binding 关联精确 Message。Delivery 时间线记录只更新状态，不另建重复气泡。正式 Item 未到时只显示真实 COMMITTED 回执对应的待同步提示，按 Message ID 替换；没有读取到 Delivery 时显示“投递状态尚未读取”，不通过时间/正文猜测。

媒体没有可用资产时标记 UNAVAILABLE，保留真实消息占位；不返回 Provider URL、密钥、解密资料或伪造预览。已保存附件仍从关联事项的[受控附件](attachments.md)入口下载。本增量不接收保存实时媒体，不新增图片发送或在线预览。

闭合前向合同：[类型](../../../contracts/workbench_conversation_inbox_contracts.d.ts)、[收件箱](../../../contracts/workbench_conversation_inbox_page.schema.json)、[相关窗口](../../../contracts/workbench_conversation_related_page.schema.json)、[聊天详情](../../../contracts/workbench_conversation_chat.schema.json)、[聊天材料](../../../contracts/workbench_conversation_chat_item_page.schema.json)、[聊天投递](../../../contracts/workbench_conversation_chat_delivery_page.schema.json)。前端使用独立运行时守卫，输入异常在后台拒绝。

## 规则回复与发送事实

见 [ADR-0032](../../../adr/0032_conversation_inbox_and_rule_admission.md)。单进程 Runtime 与分进程 Worker 都先执行既有准入，再根据持久 Safe Action/Decision/Journey 和确定性派生命令身份判断普通规则文字。与接管共用现有事务锁，等待后重读控制历史；接管先提交且尚未跨 LEASED→SENDING 的普通规则消息取消为 CANCELLED / NOT_ATTEMPTED。释放不会恢复自动问答；同人其他独立问题、同群其他人保持原行为。无法证明来源、目标或主题时阻止该规则发送。

人工明确复核产生的 HUMAN_OVERRIDDEN 安全动作继续走原权限/发送合同；Incident/工单节点通知保留原独立策略。已通过发送准入的尝试保留实际结果，UNKNOWN / RECONCILIATION_REQUIRED 不自动重发。202 / COMMITTED 只表示受理，SENT 只表示渠道确认，均不表示用户已读。精确恢复继续使用 T33 独立权限，不能由联系人责任推导。

本地合成 Sender 仅验证本地出站边界；真实企微客户端收到、现场配置、部署和 Gate 均另需明确授权。
