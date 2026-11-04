# 通知异常与关联来源读取（T32 / N3）

返回 [接口导航](../README.md) · [HTTP索引](../endpoint-index.md)

## 状态与宿主

W内部工作台的既有GET，notificationExceptionsEnabled默认false；关闭时能力false，接口和页面不可用。开启查询不授予额外Ticket、Session、Incident用途权限。N3后端、合同和前端同一版本更新，旧标签页须刷新；不提供旧DTO协商分支。源码实现及本地/CI结果分别以[N3执行记录](../../../plans/pc-admin-design-v21/n3-source-projection.md)为准，不代表已部署或允许发送。

## 列表与精确单项

| 方法及完整路径 | 输入 | 输出 |
| --- | --- | --- |
| GET `/api/notification-exceptions` | domain=ALL/TICKET/SESSION/INCIDENT；route=ALL/GROUP/BOT_DIRECT/YIXIAOXIU_APP；state=ALL/FAILED/UNKNOWN；limit默认30、最大50；不透明cursor | items、has_more、next_cursor；无total/count |
| GET `/api/notification-exceptions/ticket/{parentId}/{deliveryId}` | 获权Ticket与实际Delivery UUID；无query | 同一闭合Item |
| GET `/api/notification-exceptions/session/{parentId}/{deliveryId}` | 获权Session与实际Delivery UUID；无query | 同一闭合Item |
| GET `/api/notification-exceptions/incident/{parentId}/{deliveryId}` | 获权Incident及原生命周期/公开进展用途；无query | 同一闭合Item |

Cookie/Bearer沿W宿主。重复或未知筛选、游标混用400；未认证/当前Session失效401；主体或角色团队变化403；wrong parent、隐藏对象或等待后父对象失权404；原模块关闭404。异常HTTP状态不解释为空列表。响应no-store，无写入、CSRF命令、If-Match或重发副作用。

## 闭合响应与N3字段

Item保留domain、parent_id、delivery_id、source_kind、route_kind、destination_type、status、side_effect_state、attempt_count、last_attempt、safe_summary、error_code、created_at、updated_at、sent_at、allowed_actions、parent_link，增加以下三个必需字段：

| 字段 | Ticket | Session | Incident |
| --- | --- | --- | --- |
| ticket_no | 当前Ticket编号，IT-日期-序号 | null | null |
| ticket_title | 当前Ticket标题，1–200字 | null | null |
| reporter_name | null | 有效主题快照姓名，1–128字；否则null | null |

未知字段、缺失字段或跨域组合被浏览器守卫拒绝。parent_link只允许当前域及parent_id的既有内部路径。safe_summary是原通知说明，不是标题或人员身份的替代数据。时间沿原接口的北京时间本地ISO形式，最多6位小数；sent_at不代表本人已读。

Ticket编号和标题来自唯一Ticket事实源，不依赖原消息留存；完结/消息过期不改写编号和标题。Session姓名沿现有主题资料校验：来源账号/人员/Intake绑定、唯一Journey、仍有效的Journey及原始Intake留存、RESOLVED快照。缺失/过期/歧义或错误绑定返回null，不从关联Ticket借姓名，不读取当前外部目录。

前端Ticket显示等宽编号链接+secondary单行省略标题；Session显示“会话 · 姓名”，null时显示“会话 · 报修人（资料未提供）”。Incident保持原样。详情继续展示safe_summary；允许动作只沿原状态、角色与发送开关投影，本读取不触发任何POST。

## 授权、分页与资源

各域授权先于每分支n+1分页，按(created_at DESC,delivery_id DESC)稳定排序；HMAC cursor绑定主体、角色团队、筛选与Incident用途范围，重启旧cursor从首页重读。最多四分支各51条候选、合并最多204条；一条最近Attempt。

候选取得后，一次有界批量终检SQL在同一READ快照核验当前主体角色团队、装配提供的原Session证明、Ticket/Session父对象READ并提取展示字段；覆盖决定has_more的额外候选。等待后失权整次失败关闭；不在终检后异步补资料。缺姓名不会过滤合法异常行。事务READ ONLY，statement_timeout=2秒；不增加逐行SQL或父详情HTTP请求，不增加迁移、表、Worker、持久开关或外部调用。

内部备注、Message正文、原始目标/身份/hash、原始Provider错误和receipt不输出。Incident仍受原T31用途和旧schema兼容守卫，三项新增字段均null。

## 合成字段示例

下例是三域各一条的完整闭合列表响应，使用合成标识、姓名和标题。Session资料不可用时仅reporter_name为null，其它事实不因此删除。

```json
{
  "items": [
    {
      "domain": "TICKET",
      "parent_id": "00000001-1111-4111-8111-111111111111",
      "delivery_id": "00000004-2222-4222-8222-222222222222",
      "source_kind": "TICKET_NOTIFICATION",
      "route_kind": "BOT_DIRECT",
      "destination_type": "PERSON",
      "status": "DEAD_LETTER",
      "side_effect_state": "NOT_ATTEMPTED",
      "attempt_count": 1,
      "last_attempt": {
        "attempt_no": 1,
        "outcome": "REJECTED_NOT_APPLIED",
        "side_effect_state": "NOT_ATTEMPTED",
        "started_at": "2026-11-04T12:30:00.000000",
        "finished_at": "2026-11-04T12:30:00.000000"
      },
      "safe_summary": "工单通知",
      "ticket_no": "IT-20261104-0001",
      "ticket_title": "护士站打印设备连接异常（合成）",
      "reporter_name": null,
      "error_code": "FAILURE_RECORDED",
      "created_at": "2026-11-04T12:30:00.000000",
      "updated_at": "2026-11-04T12:30:00.000000",
      "sent_at": null,
      "allowed_actions": [
        "RETRY"
      ],
      "parent_link": "/workbench/app/items/ticket/00000001-1111-4111-8111-111111111111"
    },
    {
      "domain": "SESSION",
      "parent_id": "00000002-1111-4111-8111-111111111111",
      "delivery_id": "00000005-2222-4222-8222-222222222222",
      "source_kind": "SESSION_MESSAGE",
      "route_kind": "BOT_DIRECT",
      "destination_type": "PERSON",
      "status": "RECONCILIATION_REQUIRED",
      "side_effect_state": "UNKNOWN",
      "attempt_count": 1,
      "last_attempt": {
        "attempt_no": 1,
        "outcome": "UNKNOWN",
        "side_effect_state": "UNKNOWN",
        "started_at": "2026-11-04T12:20:00.000000",
        "finished_at": "2026-11-04T12:20:00.000000"
      },
      "safe_summary": "会话外部消息",
      "ticket_no": null,
      "ticket_title": null,
      "reporter_name": "欧阳慧敏（合成）",
      "error_code": "RESULT_UNCONFIRMED",
      "created_at": "2026-11-04T12:20:00.000000",
      "updated_at": "2026-11-04T12:20:00.000000",
      "sent_at": null,
      "allowed_actions": [
        "RECONCILE"
      ],
      "parent_link": "/workbench/app/conversations/00000002-1111-4111-8111-111111111111"
    },
    {
      "domain": "INCIDENT",
      "parent_id": "00000003-1111-4111-8111-111111111111",
      "delivery_id": "00000006-2222-4222-8222-222222222222",
      "source_kind": "INCIDENT_LIFECYCLE",
      "route_kind": "BOT_DIRECT",
      "destination_type": "PERSON",
      "status": "DEAD_LETTER",
      "side_effect_state": "NOT_ATTEMPTED",
      "attempt_count": 1,
      "last_attempt": {
        "attempt_no": 1,
        "outcome": "REJECTED_NOT_APPLIED",
        "side_effect_state": "NOT_ATTEMPTED",
        "started_at": "2026-11-04T12:10:00.000000",
        "finished_at": "2026-11-04T12:10:00.000000"
      },
      "safe_summary": "公共故障确认通知",
      "ticket_no": null,
      "ticket_title": null,
      "reporter_name": null,
      "error_code": "FAILURE_RECORDED",
      "created_at": "2026-11-04T12:10:00.000000",
      "updated_at": "2026-11-04T12:10:00.000000",
      "sent_at": null,
      "allowed_actions": [],
      "parent_link": "/workbench/app/incidents/00000003-1111-4111-8111-111111111111"
    }
  ],
  "has_more": false,
  "next_cursor": null
}
```

## 实现与验证入口

- [合同](../../../contracts/workbench_notification_exception_contracts.d.ts)、[列表Schema](../../../contracts/workbench_notification_exception_page.schema.json)、[ItemSchema](../../../contracts/workbench_notification_exception_item.schema.json)。
- [只读查询](../../../app/server/src/workbench-notification-exceptions.mts)、[浏览器守卫](../../../app/pc-admin/src/contracts/workbench-notification-exception-browser-contracts.mts)、[正式页面](../../../app/pc-admin/src/features/notification-exceptions/NotificationExceptions.tsx)。
- [合同测试](../../../tests/wbint-t32-exception-contract.test.mts)、[真实Ticket HTTP](../../../tests/wbint-t32-notification-exceptions.integration.test.mts)、[Session/终检/查询预算](../../../tests/wbint-t32-session-exceptions.integration.test.mts)、[正式浏览器](../../../tests/wbint-t32-notification-exceptions.browser.test.mts)、[失权/迟到响应](../../../tests/wbint-t32-exception-authorization.browser.test.mts)。

回退须同步恢复后端/合同/前端版本，或关闭原notificationExceptionsEnabled；不删除原Delivery/Attempt和历史Evidence。没有数据库down操作。
