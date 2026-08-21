# 13. 测试与验收计划

阶段边界：G0 只验证企业微信能力；Phase 1 测 Pilot Ticket Core；Phase 2 测异步AI/OCR；Phase 3 单独测试 Ticket Adapter 与 Hospital Tickets。不得用 Mock Hospital Tickets 掩盖 Phase 1 的直接依赖。

## 1. 测试原则

- 关键不变量必须自动化测试；
- 先测试无 AI 链路；
- 外部 SDK 使用 Contract Test 和录制的脱敏 Frame；
- 不使用真实患者数据；
- 故障和降级路径与正常路径同等重要；
- 每个阶段有独立 Go/No-Go。

## 2. 测试层级

### 2.1 单元测试

覆盖：

- 消息标准化；
- mention 清理；
- 幂等键；
- 聚合窗口；
- 请求类型规则；
- 错误码提取；
- 状态机；
- 优先级规则；
- 通知策略；
- 脱敏；
- Incident 指纹。

### 2.2 Contract Test

覆盖：

- SDK Frame → Normalized Message；
- Gateway → Intake；
- Intake → Pilot Ticket Core；
- Phase 3 Ticket Adapter → Hospital Tickets；
- Ticket Event → Outbox；
- AI Schema；
- Card Action；
- Error Code。

### 2.3 集成测试

使用：

- PostgreSQL；
- Redis；
- MinIO；
- Mock WeCom Adapter；
- Pilot Ticket Core 测试实例；
- AI 可开关。

场景：

- 消息落库和建单同链路；
- Pilot Ticket Core 短时失败后补建；
- Outbox 重试；
- 图片下载失败；
- AI 关闭；
- 身份未映射；
- 并发状态转换。

### 2.4 端到端测试

在企业微信测试群：

- 群内 @ 文字；
- 单聊文字；
- 图片/mixed；
- 主动单聊；
- 群公告；
- 卡片按钮；
- 接单→处理→解决→确认；
- 仍未恢复→重开；
- 断网重连。

### 2.5 性能测试

- 30 条/分钟；
- 100 条突发；
- 50 张图片；
- Outbox 积压 1000 条；
- AI 10 并发或本地可承受并发；
- 数据库连接耗尽防护。

### 2.6 安全测试

- 非法 MIME；
- 超大文件；
- 路径穿越；
- 恶意文件；
- 卡片 task_id 猜测；
- 越权查看工单；
- 过期卡片；
- 重放；
- SQL 注入；
- Prompt 注入；
- 日志敏感数据扫描；
- Secret 扫描。

### 2.7 故障演练

- 停止 AI；
- 停止 OCR；
- 停止 Redis；
- MinIO 不可用；
- Pilot Ticket Core 不可用；
- Phase 3 Ticket Adapter/Hospital Tickets 不可用；
- WebSocket 断网；
- PostgreSQL 主库切换；
- Bot Secret 轮换；
- Outbox 发送失败。

## 3. Gate 0 验收

详见 `plans/phase_0_wecom_poc.md`。

必须有：

- 24 小时运行报告；
- 消息能力矩阵；
- Frame 样例（脱敏）；
- 主动推送表现；
- 卡片事件；
- 图片解密；
- 重连记录；
- 单活结论。

## 4. V1 关键验收场景

### A01 明确文字报修

预期：

- ChannelMessage 1 条；
- Intake 1 条；
- Ticket 1 张；
- 10 秒内工单号；
- 状态“等待受理”。

### A02 同一消息重放

预期：

- ChannelMessage 不重复；
- Ticket 不重复；
- 返回原 ticket_no。

### A03 AI 停止

预期：

- 正常建单；
- 人工分诊；
- AI 降级告警；
- 无静默丢弃。

### A04 多条补充

4 条连续消息预期：

- 1 个 Intake；
- 1 张 Ticket；
- 4 条 Message 关联。

### A05 纯图片

预期：

- 创建工单；
- 请求补充描述；
- OCR 失败不丢单。

### A06 状态真实

- 创建后不能显示“处理中”；
- accept 后显示“已受理”；
- start 后显示“处理中”。

### A07 解决重开

- 解决卡片；
- 点击“仍未恢复”；
- Ticket 进入 REOPENED；
- 原处理组收到通知。

### A08 公共故障

三名医生同一错误：

- 3 个 Intake；
- 3 个 Subscription；
- 1 个 Incident 候选；
- 未经确认不自动删除或并单。

### A09 不同 HIS 问题

HIS 登录失败与 HIS 打印失败：

- 不得因同类别和时间接近直接合并。

### A10 敏感截图

预期：

- 原图私有；
- 群文案脱敏；
- 普通日志无患者信息；
- 访问有审计。

## 5. AI 评估

数据集拆分：

- train（如未来微调）；
- validation；
- locked test。

锁定测试集不得用于 Prompt 反复调参。

指标：

- 请求类型 Precision/Recall；
- 系统和症状准确率；
- 错误码 exact match；
- Schema pass rate；
- 处理组建议精确率；
- 关键场景漏判；
- 人工修正率。

## 6. 回归门槛

每次发布必须：

- 核心单元测试通过；
- Contract Test 通过；
- AI 关闭 E2E 通过；
- 幂等测试通过；
- 状态机测试通过；
- Secret 扫描通过；
- 数据库迁移测试通过。

## 7. 验收证据

Agent 完成任务需提供：

- 执行命令；
- 测试结果；
- 关键日志字段；
- 截图或录屏说明（涉及企业微信交互时）；
- 数据库记录；
- 失败路径证据；
- 任务验收清单。
