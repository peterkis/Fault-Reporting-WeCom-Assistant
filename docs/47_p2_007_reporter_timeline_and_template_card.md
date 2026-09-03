# 上报人模板卡片与 Reporter-safe Timeline 契约

## 1. 工单卡片样式

建议使用企业微信 `template_card / text_notice`：

```json
{
  "card_type": "text_notice",
  "source": { "desc": "三院 IT 服务" },
  "main_title": {
    "title": "故障已受理",
    "desc": "已进入处理流程"
  },
  "emphasis_content": {
    "title": "4821",
    "desc": "工单尾号"
  },
  "sub_title_text": "门诊工作站无法登录",
  "horizontal_content_list": [
    { "keyname": "状态", "value": "待接单" },
    { "keyname": "来源", "value": "门诊工作联系群" },
    { "keyname": "时间", "value": "09-03 08:42" }
  ],
  "jump_list": [
    { "type": 1, "title": "查看处理进度", "url": "<AUTHENTICATED_OPAQUE_TIMELINE_URL>" }
  ],
  "card_action": {
    "type": 1,
    "url": "<AUTHENTICATED_OPAQUE_TIMELINE_URL>"
  },
  "task_id": "ticket_<OPAQUE_PUBLIC_REF>_v1"
}
```

这是视图模型示例，不包含真实 target、URL、患者信息或工单主键。

## 2. 四位尾号

四位尾号用于视觉识别和电话沟通，建议表达为“9 月 3 日的 4821 工单”。它不是唯一标识、主键或授权凭证。

## 3. Reporter-safe Timeline

临床上报人可见：

- 工单安全摘要；
- 创建、已接单、处理中、待补充、已关联公共故障、已恢复等外部状态；
- 对用户公开的回复；
- 脱敏的关键时间点。

不可见：

- 内部备注；
- 其他上报人身份；
- 坐席内部账号、组和权限细节；
- Provider 原始错误和 receipt；
- 内部 IP、患者敏感数据；
- AI 内部中间结果；
- Reconciliation 内部操作。

## 4. 安全访问

禁止：

```text
/tickets/4821
```

要求：

```text
opaque public ref
+ WeCom identity/session authentication
+ reporter authorization
+ access audit
+ optional short expiry
```

现有 P2-006 Workbench 是内部坐席 UI，不能直接暴露给上报人。

## 5. 实现边界

P2-007 只定义 `TicketCardViewModel`、`NotificationRecommendation` 和 Timeline Action Contract。真实模板卡片 Sender、Reporter-safe Timeline Runtime 与受控现场验证归未授权的 P2-016；`WECOM_TEMPLATE_CARD_ENABLED` 与 `REPORTER_TIMELINE_ENABLED` 默认均为 false。
