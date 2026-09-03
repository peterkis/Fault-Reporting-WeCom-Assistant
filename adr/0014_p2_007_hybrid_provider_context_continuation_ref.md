# ADR-0014：Provider Context 与 continuation_ref 混合跨渠道关联

- 状态：`ACCEPTED_FOR_P2_007_DESIGN`
- 日期：2026-09-03
- 策略：`HYBRID`

## 背景

群内 @Bot 后，Bot 需要主动单聊原上报人；用户也可能以后直接单聊 Bot。群消息与单聊消息是两个不同渠道 Thread，不能仅凭“同一用户、时间接近”合并。

“Provider Context”是本项目对企业微信原生回调上下文的架构统称，不是企业微信官方单独对象。它通常包括：

```text
headers.req_id
msgid
chatid
chattype
from.userid
create_time
response_url
quote
```

## 决策

### Provider Context 的职责

- 回调去重；
- 保存传输层证据；
- 同渠道即时回复；
- 识别群/单聊、群会话和发送者；
- 不作为跨渠道长期业务关联的唯一依据。

### continuation_ref 的职责

- 由本系统生成；
- 建立群 Journey 到单聊 Channel Leg 的权威关联；
- opaque、单用途、绑定 reporter 和 bot；
- 原值不进入普通日志，落库只存 Hash；
- 默认 120 分钟有效；
- 用于首次绑定后即消费，后续由 DirectChannelBinding 继续承担关联；
- 不是身份认证凭证，也不能授予工单访问权限。

## 关联优先级

```text
1. Template Card task_id / event_key 精确关联
2. 已建立 DirectChannelBinding
3. 明确 continuation_ref
4. 用户明确提供 Ticket/Intake 引用
5. 同一 reporter 只有一个未完成 Journey
6. 多个未完成 Journey → 要求用户选择
7. 无法关联 → 创建 DIRECT_ORGANIC Journey
```

## 禁止

```text
same userid + nearby time = same fault
```

同一医生可能在两分钟内报告打印机与处方两个完全不同的问题。多个未完成 Journey 时必须让用户选择，不能自动取最近一条。

## 三种入口

- `GROUP_MENTION_INLINE`
- `GROUP_MENTION_TO_DIRECT_GUIDED`
- `DIRECT_ORGANIC`

`origin_channel` 不可变；`current_channel` 随 Journey 的 Channel Leg 改变。
