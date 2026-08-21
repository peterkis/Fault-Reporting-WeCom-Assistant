# 消息到 Intake/Ticket 的转换示例

## 示例 1：明确文字故障

输入：

```text
@信息保障助手 本部3楼护士站HIS登录报错
```

结果：

```json
{
  "channel_message": {
    "msg_type": "text",
    "clean_text": "本部3楼护士站HIS登录报错"
  },
  "service_intake": {
    "request_type": "INCIDENT",
    "reported_campus_id": "HQ",
    "reported_location_text": "3楼护士站"
  },
  "ticket": {
    "title": "本部3楼护士站 HIS 登录失败",
    "status": "QUEUED"
  },
  "reply": "问题已收到并生成工单，当前状态：等待受理"
}
```

## 示例 2：分多条发送

输入：

```text
1. @信息保障助手 医生站打不开
2. 提示权限错误
3. [截图]
4. 我们病区三台都这样
```

90 秒内，结果：

```text
ChannelMessage x 4
ServiceIntake x 1
Ticket x 1
MediaAsset x 1
```

AI/OCR 可把主症状从 `LOGIN_FAILURE` 修正建议为 `AUTHORIZATION_ERROR`，但保留原始文本。

## 示例 3：纯截图

输入：

```text
[截图]
```

结果：

- 建立 Intake；
- 建立待补充工单；
- 私有保存截图；
- 回复工单号；
- 询问“请补充一句故障现象”；
- OCR 异步。

## 示例 4：服务申请

输入：

```text
请开通新员工HIS账号
```

结果：

```text
request_type = SERVICE_REQUEST
ticket_type = ACCOUNT_PROVISION
```

不得归类为登录故障。

## 示例 5：状态查询

输入：

```text
上次那个怎么样了？
```

若用户仅有一张最近未关闭工单：

- 不新建 Ticket；
- 返回当前 Pilot 工单状态；Phase 3 切换后由 Adapter/Hospital Tickets 提供同等业务语义；
- 建立一条 STATUS_QUERY 互动记录。

若存在多张可能工单：

- 返回候选列表；
- 让用户选择；
- 不猜测。

## 示例 6：公共故障候选

三名医生在 5 分钟内报告：

```text
HIS登录提示ORA-12514
```

结果：

- 3 个 Intake；
- 3 个个人订阅；
- 1 个 Incident 候选；
- 管理员确认前保持各自工单关系；
- 不因为“5分钟+HIS”自动合并。

## 示例 7：不同问题不合并

```text
A：HIS登录失败
B：HIS打印失败
```

即使同一时间、同一系统，也不是同一错误特征。不得自动关联。

## 示例 8：敏感截图

截图包含患者姓名和住院号：

- 原图私有；
- OCR 原文受控；
- 群消息只显示“某临床系统异常”；
- 工单标题不包含患者身份；
- 访问原图记录审计。
