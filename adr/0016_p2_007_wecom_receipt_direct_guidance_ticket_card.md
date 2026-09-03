# ADR-0016：群回执、主动单聊与工单模板卡片通知策略

- 状态：`ACCEPTED_FOR_P2_007_DESIGN`
- 日期：2026-09-03
- P2-007 外部副作用：禁止

## 决策概览

```text
群内 @Bot
→ 持久化原始消息与 Contact Journey
→ 群内安全回执（best effort）
→ 主动单聊原上报人（可靠提醒路径）
→ 分段补充故障
→ 明确报修后尽早创建最小 Ticket
→ Ticket 提交后发送 text_notice 模板卡片
→ 点击卡片查看 Reporter-safe Timeline
```

## 群内回执

- 首选对原回调进行即时回复；异步时可使用 WSS 主动群消息。
- 只说明“已收到、请注意单聊”，不包含患者、账号、IP、内部错误或完整工单细节。
- 群内主动消息是否能产生真正的强 @ 提醒尚未完成真实能力验证，因此状态为 `UNVERIFIED`。
- 可靠提醒路径是主动单聊原上报人。

示例：

```text
已收到您的故障上报。系统已向您发送单聊消息，请在与机器人的单聊中继续补充故障地点和影响范围。
```

## 主动单聊引导

```text
您好，我已收到您从“门诊工作联系群”发起的报修。
请先告诉我：哪个系统或设备出现了什么现象？
您可以分几条消息发送，我会自动合并。
```

用户以后直接单聊时，入口为 `DIRECT_ORGANIC`，不伪装成群来源。

## 工单创建时点

- “门诊系统进不去、打印机不出纸、处方提交不了”等明确技术故障：先建最小 Ticket，再补地点、范围等字段。
- “怎么操作、政策是否允许、药品是否拆零”等意图不清：规则或人工确认后再决定是否建故障 Ticket。
- Ticket 未提交成功前不得发送“已建单”卡片。

## 模板卡片

使用 `template_card / text_notice`，以 `emphasis_content` 突出四位工单尾号：

```text
故障已受理
4821  工单尾号
状态：待接单
来源：门诊工作联系群
时间：09-03 08:42
[查看处理进度]
```

四位尾号仅用于识别：

- 不是数据库主键；
- 不是全局唯一编号；
- 不是访问凭证；
- 不能用作 URL 参数授权。

卡片必须使用 opaque public ref，并在用户身份认证后打开 Reporter-safe Timeline。内部备注、其他上报人、内部账号、Provider 原始错误和敏感患者数据不可见。

## 卡片更新策略

不依赖“数小时后任意修改历史卡片”。建议在关键里程碑发送新的幂等卡片：

```text
TICKET_CREATED
ASSIGNED
IN_PROGRESS
WAITING_USER
INCIDENT_LINKED
RESOLVED
REOPENED
```

每张卡片点击都进入最新 Timeline。

## 发送边界

全部外发必须经过：

```text
Communication Message
→ Outbox
→ Delivery
→ Delivery Worker
→ WeCom Sender
```

当前 P2-G1 Sender 只实现 text/markdown；真实 template_card Sender 扩展、Reporter Portal 和强 @ 能力实测均需后续独立授权。
