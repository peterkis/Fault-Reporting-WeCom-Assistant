# 05. 消息识别与工单转换详细规则

本文件定义企业微信消息如何转换为 `ChannelMessage`、`ServiceIntake`、`Ticket`、`Incident` 和通知。规则优先于模型自由判断。

---

## 1. 总原则

1. **明确发给机器人即形成 Intake。**
2. **明确故障报修先建单，后识别。**
3. **AI/OCR 失败不得导致漏单。**
4. **原始文本优先于 OCR，OCR 优先于模型推测。**
5. **所有推断字段必须带来源和确定性。**
6. **申报人科室只能作为默认上下文，不能直接视为故障发生科室。**
7. **公共故障只能关联，不能删除个人申报。**
8. **不允许依赖模型自报 confidence 单独决定自动化。**
9. **不明确时优先请求一个最有价值的补充信息。**
10. **涉及抢救、手术、输血、用药、危急值等场景必须触发硬规则。**

---

## 2. 消息接收触发规则

### 2.1 群聊

Gate 0 后按实际租户能力冻结：

- 若群聊必须 `@机器人`：仅处理明确 `@信息保障助手` 的消息；
- 若平台可返回特定范围内的非 @ 消息：V1 仍默认只自动受理明确 @ 的消息，避免采集群内无关内容；
- 未明确发给机器人的普通群消息不进入本系统，除非未来另行启用合规审批后的无感监听。

### 2.2 单聊

用户单聊机器人发送以下内容，均创建 Intake：

- 文本；
- 图片；
- 图文混排；
- 文件；
- 语音转写；
- 卡片按钮事件；
- 对已有工单的补充。

### 2.3 卡片事件

卡片事件不创建新 Intake，优先关联 `task_id` 指向的 Ticket/Incident：

- `confirm_resolved`；
- `still_broken`；
- `add_information`；
- `view_ticket`；
- `subscribe_incident`。

若 `task_id` 无效或过期，返回稳定提示并记录审计，不执行状态变化。

---

## 3. 消息标准化规则

所有 SDK Frame 转换为内部 `NormalizedWeComMessage`。

### 3.1 文本消息

Adapter 在有序 `content` 中保留：

- 原始文本 `text.raw`；
- 确定性规范化文本 `text.clean`；
- 引用消息；
- `raw` 中的标点和换行。

规范化仅用于检索和规则：

- Unicode NFKC；
- 全角半角统一；
- 连续空白折叠；
- 英文字母大小写归一；
- 不修改原始证据。

锁定的 SDK `1.0.6` Frame 没有提供可依赖的结构化 mention 列表，因此 P1-002 不从显示文本猜测 userid，也不做无依据的机器人 mention 删除。别名映射属于后续识别规则，不进入 Adapter 的通道事实转换。

### 3.2 图片消息

Normalized Message 只保存：

- opaque `download_ref`；
- 原 Frame 中的 `source_index`；
- 媒体类型 `image`。

短时 URL、AES Key 和 `response_url` 不进入 Normalized Message。Channel 层后续只能在受保护原始回调上下文中解析该引用；下载、Magic/MIME、哈希、私有存储和留存事实由后续受权任务实现。

图片下载失败时：

- ChannelMessage 仍落库；
- Intake 仍创建；
- 工单可按文字创建；
- `media_status=DOWNLOAD_FAILED`；
- 进入重试和告警。

### 3.3 Mixed 图文消息

将文字和图片按 SDK `msg_item` 原顺序作为同一 Normalized Message 的多个 content item 保存，不拆成多个消息或工单。

### 3.4 文件消息

V1 仅保存允许类型：

- png/jpg/jpeg/webp；
- pdf；
- txt/log；
- 经审批的其他格式。

可执行文件、脚本和未知二进制默认拒绝解析，只保留受控元数据并提示用户。

### 3.5 语音消息

本期不做电话通话报修。企业微信提供的语音转写作为辅助 text item，必须标记 `source=VOICE_TRANSCRIPT`，不能冒充用户键入文字或覆盖原音频事实。

### 3.6 视频消息

视频按媒体 content item 归一化，只暴露 opaque `download_ref` 和 `source_index`；URL、AES Key 和媒体字节不进入标准消息。容量、下载、存储和后续投递仍遵守 Gate 0 冻结约束，不由 P1-002 实现。

---

## 4. Intake 聚合规则

### 4.1 默认聚合条件

后续消息满足以下全部条件时，追加到当前 Intake：

```text
same chat_id
AND same sender_user_id
AND current intake status in {RECEIVED, WAITING_DESCRIPTION, WAITING_TRIAGE, TICKET_CREATED}
AND message interval <= 90 seconds
AND no explicit "新报修/另一个问题/重新报修" intent
```

### 4.2 结束聚合条件

出现任一条件时关闭当前聚合窗口：

- 用户明确说“另一个问题”“新报修”；
- 当前消息引用另一张工单；
- 当前 Intake 已关联公共 Incident 且新消息系统明显不同；
- 超过 90 秒；
- 管理员手工结束；
- 当前工单已关闭且用户不是在执行重开。

### 4.3 补充消息

“这是截图”“错误是 403”“三台电脑都这样”“在高新院区”等短文本不得新建工单，应追加到最近上下文匹配的 Intake。

P1-004 将窗口冻结为含边界的 `90` 秒，并以 `provider + bot_id + chat_type + chat_id + sender_user_id` 作为完整上下文；单聊的 `chat_id` 为空，但仍由 bot、会话类型和发送人隔离。相同上下文通过 PostgreSQL 事务级 advisory lock 串行化，避免不同 `msg_id` 的并发补充各自创建 Intake。明确的新报修短语或形如 `IT-YYYYMMDD-NNNN` 的另一工单引用直接开始新 Intake。

本任务只创建/追加 Intake 和审计事件。表中“创建 Ticket”的默认动作由 P1-005 实现；P1-004 始终返回空 `ticket_id`，不得把规则分类结果冒充已建工单。

### 4.4 “谢谢/好了”

若当前用户存在待确认工单：

- “好了”“恢复了”“可以了”→ 提示确认关闭或执行确认；
- “谢谢”→ 不新建工单，可作为普通互动短期留存；
- 无当前工单时不创建 Ticket。

---

## 5. 请求类型识别

### 5.1 类型枚举

| 类型 | 定义 | 默认动作 |
|---|---|---|
| INCIDENT | 系统、终端、网络或设备异常 | 创建 Ticket |
| SERVICE_REQUEST | 账号、权限、数据修改、安装等申请 | 创建服务请求类 Ticket |
| QUESTION | 使用咨询 | 创建 Intake，可回复人工渠道或转咨询队列 |
| COMPLAINT | 服务意见或投诉 | 创建 Intake，进入管理员队列 |
| STATUS_QUERY | 查询已有工单进度 | 关联最近工单并回复 |
| FOLLOW_UP | 对已有报修的补充 | 追加现有 Intake/Ticket |
| CHATTER | 问候、感谢、无业务含义 | 不建 Ticket，短期留存 |
| UNKNOWN | 无法判断 | 创建 Intake，请求澄清 |

### 5.2 明确故障关键词

命中以下词并结合系统/位置上下文时，倾向 `INCIDENT`：

```text
报错、打不开、进不去、登录失败、卡死、闪退、蓝屏、无响应、
一直转圈、保存失败、提交失败、打印不了、读卡失败、断网、
连不上、数据不对、查不到、接口异常、服务不可用、权限错误
```

规则不能只按单个词，例如“今天没有报错”不应识别为故障。需要否定词检测：

```text
没有问题、已经好了、不报错了、无需处理、测试正常
```

### 5.3 服务申请关键词

```text
开通账号、重置密码、增加权限、安装软件、修改数据、配置打印机、
新增用户、离职停用、科室调整
```

必须区分 `SERVICE_REQUEST` 与 `INCIDENT`。例如“账号突然登录不了”是故障，“请开通账号”是申请。

---

## 6. 字段抽取的来源优先级

同一字段出现冲突时：

1. 用户明确文本；
2. 用户补充的结构化表单；
3. 截图 OCR 的明确文字；
4. 企业微信身份和组织映射；
5. 系统目录/错误代码精确匹配；
6. 历史上下文；
7. AI 推测。

字段必须记录：

```json
{
  "value": "本部",
  "source": "USER_TEXT",
  "certainty": "EXPLICIT"
}
```

AI 推测值不得伪装成用户明确值。

---

## 7. 系统和模块识别

### 7.1 系统目录

通过 `config_examples/system_catalog.example.json` 管理：

- system_code；
- 正式名称；
- 别名；
- URL/域名；
- 窗口标题；
- 程序名；
- Logo/截图指纹；
- 常见错误代码；
- 处理组；
- 服务等级；
- 院区范围。

### 7.2 匹配顺序

```text
明确系统代码/名称
→ 错误代码精确映射
→ URL/窗口标题/程序名
→ 系统别名
→ OCR 关键词
→ AI 建议
```

### 7.3 不得自动识别的情况

以下情况必须保留 `UNKNOWN` 或请求澄清：

- 仅说“系统打不开”，未说明哪个系统；
- 截图模糊且无可靠 OCR；
- 多个系统同时出现在截图中；
- 模型输出系统不在主数据目录；
- 用户文本和 OCR 明确冲突。

---

## 8. 症状和故障类型识别

建议标准枚举：

```text
UNAVAILABLE
LOGIN_FAILURE
AUTHORIZATION_ERROR
PERFORMANCE_SLOW
DATA_ERROR
INTERFACE_ERROR
PRINT_FAILURE
DEVICE_FAILURE
NETWORK_FAILURE
CONFIGURATION_ERROR
CLIENT_CRASH
UNKNOWN
```

一个工单可有一个主症状和多个辅助标签。

例如：

```text
“HIS 登录后提示 403”
system=HIS
symptom=AUTHORIZATION_ERROR
error_code=403
```

不要只按“登录”归类为 `LOGIN_FAILURE`；错误代码和提示可能说明权限问题。

---

## 9. 错误代码提取

### 9.1 规则来源

- 用户文本；
- OCR；
- 日志文件；
- 引用消息。

### 9.2 常见格式

```regex
HTTP\s?[1-5][0-9]{2}
ORA-\d{5}
SQLSTATE\[[A-Z0-9]+\]
0x[0-9A-Fa-f]+
ERR[_-][A-Z0-9_-]+
[A-Z]{2,10}-\d{2,8}
```

### 9.3 保真要求

- 保留原始大小写和符号；
- 不把患者号、住院号误识别为错误码；
- 错误码进入系统指纹库匹配；
- 模型不得“补全”未出现的错误码。

---

## 10. 院区、科室和位置解析

### 10.1 必须区分

```text
reporter_campus_id
reporter_department_id
reported_campus_id
reported_department_id
reported_location_text
affected_campus_scope
affected_department_scope
```

### 10.2 默认规则

- 身份映射可提供申报人默认院区和科室；
- 默认值必须标记 `source=SENDER_PROFILE`；
- 若用户明确说“高新院区”，覆盖默认院区；
- 若“3楼护士站”缺少院区，工单仍创建，但位置标记不完整；
- 只有分派确实依赖院区时，才请求补充最小信息。

### 10.3 位置标准化

输入：

```text
高新三楼护士站
```

输出：

```json
{
  "campus_id": "GX",
  "department_id": null,
  "ward_id": null,
  "location_text": "三楼护士站",
  "resolution_status": "PARTIAL"
}
```

禁止模型捏造科室。

---

## 11. 影响范围识别

枚举：

```text
SINGLE_USER
SINGLE_TERMINAL
SINGLE_LOCATION
SINGLE_WARD
SINGLE_DEPARTMENT
MULTI_DEPARTMENT
SINGLE_CAMPUS
MULTI_CAMPUS
HOSPITAL_WIDE
UNKNOWN
```

证据信号：

- “我这台”→ SINGLE_TERMINAL；
- “我们病区三台电脑”→ SINGLE_WARD 或 SINGLE_LOCATION；
- “全科都不行”→ SINGLE_DEPARTMENT；
- 多个不同科室独立上报→ MULTI_DEPARTMENT 候选；
- 监控告警覆盖院区→ SINGLE_CAMPUS；
- 不能仅凭“很急”判断影响范围。

---

## 12. 临床关键性和优先级

### 12.1 临床关键性信号

硬规则词：

```text
抢救、急诊、手术、麻醉、输血、用药、发药、医嘱、危急值、
急救、卒中、胸痛、生命支持
```

命中后只表示“需要优先人工确认”，不代表自动认定重大故障。

### 12.2 优先级输入

最终优先级由规则服务计算：

```text
service_criticality
+ impact_scope
+ clinical_context
+ time_sensitivity
+ monitoring_signal
+ incident_report_count
```

AI 只能建议，不直接写最终优先级。

### 12.3 建议矩阵

| 条件 | 候选优先级 | 动作 |
|---|---|---|
| 抢救/手术关键流程受阻 | P1 候选 | 立即提醒值班管理员确认 |
| 多科室同系统不可用 | P1/P2 候选 | 创建 Incident 候选 |
| 单科室核心临床流程阻断 | P2 | 优先派单 |
| 单终端普通故障 | P3 | 正常队列 |
| 咨询或低影响申请 | P4 | 服务请求队列 |

不得仅由用户说“非常急”自动提升到最高级别，但应作为证据展示。

---

## 13. Ticket 转换规则

后端边界：Phase 1/2 所有本节中的 `Ticket` 均指 Pilot Ticket Core；Phase 3 由 Ticket Adapter 把相同领域意图映射到 Hospital Tickets。识别逻辑不得直接调用 Hospital Tickets。

### 13.1 立即建单

以下情况不等待 AI：

- 群内明确 `@机器人` 且文本具有报修语义；
- 单聊明确描述故障；
- 纯图片报修；
- 文字不足但用户明确说“报修”；
- AI 服务不可用时规则命中疑似故障。

### 13.2 先 Intake、请求澄清

以下情况创建 Intake，但可暂不创建正式 Ticket 或创建 `WAITING_DESCRIPTION` Ticket，按医院决策冻结：

- 只说“在吗”；
- 只说“帮忙看一下”且无上下文；
- 发送与信息服务无关的图片；
- 无法确认是故障、咨询还是申请。

推荐 V1 采用“明确发起报修即建待分诊工单”，避免人工漏看。

### 13.3 不建新单

- 对现有工单的补充；
- 状态查询；
- 恢复确认；
- “谢谢”；
- 重复投递的同一 msg_id；
- 已识别的卡片重复点击。

### 13.4 标题生成

规则：

```text
[院区/位置] + [系统/服务] + [主症状]
```

示例：

```text
本部3楼护士站 HIS 登录失败
高新院区心内科 打印服务不可用
未知位置 EMR 页面卡死
```

标题不得包含患者姓名、住院号和账号口令。

---

## 14. 自动路由规则

### 14.1 自动路由前提

必须同时满足：

- system_code 命中主数据；
- symptom_code 有确定规则或已校准分类器结果；
- resolver_team 唯一；
- 院区路由无冲突；
- 非重大故障候选；
- 非敏感特殊申请；
- 当前自动路由功能已通过上线门槛。

### 14.2 决策带

```text
MANUAL_TRIAGE
SUGGEST_ROUTE
AUTO_ROUTE
CRITICAL_REVIEW
```

V1 初期全部为 `MANUAL_TRIAGE` 或 `SUGGEST_ROUTE`。

### 14.3 禁止自动路由

- 多系统冲突；
- 关键临床场景；
- 数据修改；
- 账号权限高风险；
- 可能涉及信息安全事件；
- 可能涉及患者数据错误；
- 处理组配置冲突。

---

## 15. 公共故障候选规则

### 15.1 禁止简单规则

禁止：

```text
同类别 + 5分钟 = 自动并单
```

### 15.2 候选指纹

```text
system_code
module_code
normalized_error_code
symptom_code
ocr_signature
campus_scope
time_bucket
monitoring_signal
```

### 15.3 候选判定

满足以下多项才提示候选：

- 同一系统；
- 同一模块或错误码；
- 文本/OCR 高相似；
- 不同申报人或不同科室；
- 时间接近；
- 监控存在一致异常。

### 15.4 自动关联门槛

默认关闭。只有离线评估达到：

- Precision ≥ 99%；
- 错误关联率 ≤ 1%；
- 可人工解除；
- 关键系统分层验证；

才允许在低风险类别启用。

### 15.5 关联后行为

- 每条 Intake 保留；
- 每位申报人建立 Subscription；
- 原 Ticket 可保留为子任务或标记 `DUPLICATE_LINKED`；
- 群内发布统一事件编号；
- 解决确认可按个人位置分别收集。

---

## 16. 敏感信息识别和转换

### 16.1 可能的敏感信息

- 患者姓名；
- 身份证号；
- 门诊号、住院号；
- 手机号；
- 诊断；
- 医嘱；
- 检验/影像结果；
- 医务人员账号；
- 内部 IP、服务器地址；
- Token、密码、密钥。

### 16.2 处理规则

- 原始附件进入私有存储；
- OCR 文本分为原始受控版和脱敏分析版；
- 标题和群内文案使用脱敏版；
- 模型输入默认使用脱敏版，确需原文时走受控策略；
- 日志只记录哈希、长度、类型和处理状态；
- 外部可见附件需工程师显式标记；
- 密码和密钥疑似内容立即遮盖并产生安全告警。

---

## 17. 人工修正规则

人工修正必须记录：

- 修正人；
- 修正时间；
- 原字段；
- 新字段；
- 原因；
- 是否用于评估集；
- 是否影响系统目录或规则。

不得直接覆盖 AI Decision 原记录。

---

## 18. 决策伪代码

```text
on_message(message):
    normalized = normalize(message)

    if duplicate(provider, msg_id):
        return existing_result

    begin transaction
      persist channel_message
      intake = attach_or_create_intake(normalized)

      if is_follow_up(normalized, intake):
          append_to_intake()
          emit intake.updated
      else if is_explicit_incident(normalized):
          ticket = create_pilot_ticket(status=QUEUED)
          link(intake, ticket)
          emit intake.ticket_created
      else:
          mark intake WAITING_TRIAGE
          emit intake.needs_clarification

      write notification_outbox
    commit

    reply_after_commit()

    enqueue_async_enrichment(intake)
```

Phase 3 切换时，`create_pilot_ticket` 的正式入口由已批准的 Ticket Adapter 迁移方案替代，不允许在识别层增加医院工单直连逻辑。

---

## 19. 规则优先级

从高到低：

1. 安全和敏感信息硬规则；
2. 消息幂等和已有上下文；
3. 用户明确选择或文本；
4. 卡片 task_id；
5. 错误代码和系统主数据精确匹配；
6. 组织和位置主数据；
7. 关键词和规则；
8. OCR；
9. 分类器；
10. LLM 建议；
11. 人工判断。

---

## 20. 详细示例

完整测试样例见：

- `examples/recognition_cases.json`
- `examples/message_to_ticket_examples.md`
- `config_examples/recognition_rules.example.json`
