# T33 Incident notification controls — frozen SOURCE contract

2026-10-14：#88／WBINT-11／A11，Root `5a42954597d24b52fb09ba41775e7c680fdd8faf`。
本窗口只冻结合同和公共HTTP首例；下列入口未挂载，业务、正式UI、types/build/PG/browser均NOT_RUN。当前人类角色决定见外置 `t33-incident-ordinary-retry-role-user-decision-20261014.json`（1768B／b3f869b7…）。Root计划中“角色待决定”属于早于该答复的快照，原字节保留。

## 独立用途与现有事实

Incident→原 `communication.incident_notification_binding`→Message→Outbox→Delivery必须逐项精确关联；没有虚构Conversation Session或Ticket控制授权。每次控制、回执读取及重放，先核当前活动主体、该Incident既有精确READ和当前scope，再核原控制用途权限与当前父子绑定。普通retry只允许ADMIN或当前获权DISPATCHER，再经独立 `INCIDENT_DELIVERY_RETRY` permission；owner、HANDLER、VIEW和PUBLISH不授此权。UNKNOWN核对保持ADMIN-only，并须独立 `INCIDENT_DELIVERY_RECONCILE` permission。

权限Port是服务端注入、默认拒绝的只读能力，接收当前事务；不得从浏览器角色、请求body、发布权或负责人身份造grant。调用者与权限在获得锁后同事务再验；回执不能绕过当前授权。发送用途分开：旧生命周期通知与T31个人公开进展沿各自当前flags、scope、retention、ACTIVE/未暂停订阅、原身份和精确渠道绑定；不得重定向或用group fallback。Ticket和Conversation保持原入口、原授权及原无UUID低层消费者。

## 拟议HTTP（全部NOT_MOUNTED）

| 方法和路径 | 输入／输出 |
|---|---|
| GET `/api/incidents/{incidentId}/notifications/{deliveryId}/control` | 无query；闭合capability，只列当前可允许动作，无raw target／provider receipt／内部正文 |
| POST `/api/incidents/{incidentId}/notifications/{deliveryId}/retry` | 闭合retry body；200 result或409状态冲突 |
| POST `/api/incidents/{incidentId}/notifications/{deliveryId}/reconcile` | 闭合reconcile body；200 result或409结果竞争 |
| GET `/api/incidents/{incidentId}/notification-commands/{commandId}` | 无query；UNKNOWN／COMMITTED／FAILED闭合receipt，不写、不发送 |

Cookie认证、Origin、CSRF沿现有宿主。POST `Idempotency-Key`必须匹配body UUID，`If-Match`等于带引号的十进制string `expected_incident_version`。body最大32KiB，拒额外键；parent/delivery从path取得，actor只来自当前认证。expected_status和expected_side_effect_state是明确原快照，不从浏览器推断已发送。确认已发与CANCEL不调用Sender；确认未发重队列和retry还须当前发送开关／用途准入，通过原Worker发送guard，不绕过它。CONFIRMED_SENT记录SENT/ACKNOWLEDGED，**不代表报修人已读**。CANCEL保留UNKNOWN副作用事实。

retry仅PENDING/NOT_ATTEMPTED合法noop，或DEAD_LETTER/NOT_ATTEMPTED经原operator重队列；UNKNOWN、SENT/ACKNOWLEDGED、SENDING、其它状态不盲发。reconcile仅RECONCILIATION_REQUIRED/UNKNOWN，以原Communication reconciliation port执行CONFIRMED_SENT／CONFIRMED_NOT_SENT_REQUEUE／CANCEL；理由必填。锁及CAS拒绝竞争结论。wrong parent／隐藏binding为安全404；当前用途权限失效403，登录失效401，UUID改正文和版本／状态竞争409，未知或额外输入400；不泄漏目标或原Provider错误。

原UUID绑定actor/Incident/Delivery/动作/理由/结论/捕获版本和副作用快照。先当前授权再找原回执；同意图保留原ACK和追加操作记录，改正文拒绝。提交UNKNOWN冻结原UUID/body/version/状态，不换UUID、不自动POST；只显式GET核对，UNKNOWN不等于未应用。原COMMITTED ACK不改写后来事实，原FAILED不造成功。flag关闭保留待核对事实：GET原回执仍需原控制用途权限和当前READ/binding；新POST停止。未提交恢复受账号/浏览器/Incident/Delivery/用途及24h约束；用途403/404只清该scope，真正401才沿共享会话清理。迟到响应不能恢复输入。UI及这些风险验证属于未来WHOLE，本窗口不实现。

## 数据库、资源与首次验证

本SOURCE无数据库变更，原SQL不改。032原ledger的command_type/result_event非空约束不能直接表达Delivery-only ACK；未来若真实RED需要，可最小前向扩原ledger/追加审计字段和约束，保存已集成054/055/058的完整约束；不建第二Ticket/Outbox/Delivery或通用控制账本。059已为T32保留；060/061在当前Root及D reservation快照未占，但本票**未预留、未写DDL、未apply**，由未来连续WHOLE按实际需要核验。

单App、既有Worker、零新Gateway、并发1、SSE32、总池建议≤8；首例隔离pool2加admin1，串行HTTP，零真实发送。`incidentDeliveryControlEnabled=false`为声明，未挂载；独立权限Port缺省null且未来拒绝。关闭不删除历史。最小首例只用原032生命周期通知，经真实Cookie HTTP确认Incident／精确READ／通知绑定，原Worker＋合成Sender造成UNKNOWN，然后ADMIN明确CONFIRMED_SENT，观察安全HTTP状态、原UUID重放、另一条route不变和Sender不增加。无T31 profile/055/058/publication前置；新入口404≠冻结200才为业务RED，类型／DB／fixture前置失败为NOT_REACHED。

Conversation已有schema/header UUID但 `src/p2-006-workbench-http.mts:227–228`不传CoreUUID；这里只记录SOURCE风险。未来真实HTTP重放需验证并保持旧noUUID消费者，未修复、未运行、未称FAIL。未来适用原Ticket/Conversation/Core和T31发送准入回归，另验证当前撤权、实际wrong-existing-parent、结果竞争、分路恢复、暂停/绑定/关闭和正式bundle。没有新增平台、全回归或Gate要求。

Schema见 `contracts/workbench_incident_delivery_{retry,reconcile,result,receipt,capability}.schema.json` 与 typed合同。原七全部PENDING，WHOLE_NOT_GRANTED。
