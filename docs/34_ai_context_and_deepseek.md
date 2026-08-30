# 34. 多轮 AI 上下文、DeepSeek Provider 与安全放量

## 1. 目标

使用低成本外部模型协助：

- 多轮信息补充；
- 意图和故障分类；
- 字段抽取；
- 简短安抚和引导；
- 工单摘要；
- 人工交接摘要；
- Incident 候选特征；
- 坐席回复草稿。

模型不是事实库、工单入口或生产执行器。

## 2. Provider 边界

```ts
interface ConversationModelProvider {
  generateTurn(input: AIConversationTurnInput, signal: AbortSignal):
    Promise<AIConversationTurnResult>;
}
```

Provider 输入只能是脱敏、最小化且有版本的信息。Provider 无数据库凭据。

## 3. 默认模型策略

首选：

```text
provider = deepseek
model = deepseek-v4-flash
thinking = disabled
max_output_tokens = 500
temperature = 0.3
timeout = 15000ms
concurrency = 1
```

普通客服不启用高强度思考。复杂问题优先转人工；确有评估证据时才对特定任务启用低强度思考。

## 4. 上下文构建

每次请求重新构建：

```text
1. System Policy
2. 医院 IT 服务规则
3. 当前控制模式和权限边界
4. 已确认结构化事实
5. Rolling Summary
6. 最近相关消息
7. Ticket/Incident 最小状态
8. 本次用户消息
9. 允许的输出 Schema
```

不得简单发送 Thread 全部历史。

## 5. 三层记忆

### 完整事实

PostgreSQL 保存全部消息、事件和 AI Run。

### Recent Window

只选当前 Session 最近相关消息，默认不超过 20 条和 5K tokens。

### Summary + Structured Memory

历史摘要与字段：

```json
{
  "facts": [
    {
      "name": "campus",
      "value": "高新院区",
      "source": "USER_CONFIRMED",
      "source_item_id": "uuid",
      "confidence": 1.0
    }
  ],
  "missing_fields": ["device_ip"],
  "attempted_steps": ["重启打印服务"],
  "unresolved_question": "终端编号"
}
```

模型推断与人工确认必须区分，不得都写成“已确认”。

## 6. 摘要触发

满足任一：

- 消息超过 20 条；
- Context 预计超过 8K tokens；
- 话题阶段结束；
- 人工接管/交接；
- Ticket 关键状态变化；
- Session 即将结束。

摘要是追加版本，不能覆盖唯一历史。每个摘要记录 `summary_until_sequence` 和
`input_hash`。

## 7. 敏感信息闸门

模型前处理：

1. 检测患者姓名、证件号、手机号、住院/门诊号、床号；
2. 检测诊断、医嘱、检验检查、病历片段；
3. 检测账号密码、Token、Secret、IP/主机敏感信息；
4. 替换为占位符；
5. 标记 redaction result；
6. 无法安全脱敏时拒绝外发并转人工。

默认不上传原始图片和文件到外部模型。

## 8. Prompt 注入防护

- 用户文本永远放在明确的 `user_content` 区域；
- 不允许用户消息改变系统规则；
- Tool 列表默认为空；
- 不允许模型返回任意 URL/命令即自动执行；
- 结构化输出使用 Schema 校验；
- 枚举未知值拒绝；
- 过长输出截断并失败；
- 记录 Prompt 版本，不记录 Secret。

## 9. 输出协议

建议：

```json
{
  "reply": "收到。请补充出现问题的终端编号。",
  "intent": "INCIDENT",
  "category": "PRINTER",
  "urgency": "MEDIUM",
  "facts": [],
  "missing_fields": ["device_id"],
  "should_handoff": false,
  "handoff_reason": null,
  "should_create_intake": true,
  "confidence": 0.91,
  "safety": {
    "contains_patient_data": false,
    "allow_external_reply": true
  }
}
```

后端必须重新校验业务规则；模型字段不能直接写 Ticket。

## 10. AI Job 生命周期

```text
PENDING
LEASED
COMPLETED
FAILED
CANCELLED
STALE
DEAD_LETTER
```

幂等键：

```text
session_id + trigger_item_id + generation_version + job_type + prompt_version
```

### 生成前

- Session 存在；
- 模式允许；
- Trigger Item 已提交；
- 数据允许外发；
- 当前版本匹配。

### 生成后发送前

再次校验：

- generation version；
- Handoff；
- Session status；
- 发送白名单；
- Safety；
- Schema；
- 最大长度。

不匹配时保存 `STALE`，不得创建外发 Outbox。

## 11. 连续消息聚合

用户连续发送：

```text
“住院医嘱开不了”
“高新院区”
“提示数据库连接超时”
```

采用 1～2 秒去抖/聚合，生成一个 Trigger Batch。数据库事实仍是三条消息，AI 只调用一次。

同一 Session 默认一条 AI 任务执行。新消息可使旧任务失效，但不能删除旧 AI Run 审计。

## 12. 放量阶段

### SHADOW

- 生成结果；
- 不展示给用户；
- 人工最终结果作为评估标签；
- 评估分类、字段、Handoff、安全和延迟。

### COPILOT

- 展示草稿；
- 人工必须确认；
- 记录接受、编辑和拒绝；
- 评估节省时间和风险。

### CONTROLLED_AUTO

仅对批准意图：

- 问候；
- 缺失字段询问；
- 工单状态查询；
- 已批准知识回答；
- 非敏感低风险场景。

任何低置信、高风险、敏感、投诉、患者安全影响或连续失败转人工。

## 13. 评估指标

- Schema valid rate；
- intent/category precision/recall；
- field exact match；
- unsafe-send rate；
- handoff recall；
- stale-send count；
- agent acceptance/edit rate；
- first response latency；
- token/cost per resolved intake；
- duplicate AI response；
- patient-data leak count。

自动回复 Gate 的硬条件包括：

```text
unsafe-send = 0
stale-send = 0
patient-data leak = 0
```

## 14. 2C4G 性能纪律

- 外部 API，不本地推理；
- 并发 1；
- 请求超时 15 秒；
- 队列积压阈值告警；
- 最大输入预算 8K；
- 最大输出 500；
- 不把 Base64 媒体放进 Context；
- AI Worker 独立于核心请求；
- AI 故障不影响 Outbox Delivery。

## 15. 验收

1. 模型不可用时核心链路不变；
2. 非法 JSON 不进入业务；
3. 人工接管使旧结果 STALE；
4. 连续消息只触发一次生成；
5. 群聊用户上下文隔离；
6. 敏感数据拒绝出域；
7. Prompt 注入不能改变无工具边界；
8. Token、成本、模型和 Prompt 可追溯；
9. Shadow、Copilot、Auto 可以独立开关；
10. 一键关闭 AI 后无新自动发送。
