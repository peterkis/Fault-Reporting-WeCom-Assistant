# 10. AI、OCR 与 Prompt 设计

## 1. 定位

AI/OCR 的目标是减少人工分类和信息补录，不是决定报修是否被接收。

核心受理链路：

```text
WebSocket → PostgreSQL → Intake → Tickets → 回复
```

AI链路：

```text
Intake → 规则 → OCR → 小模型 → 建议 → 人工/自动路由
```

两者必须解耦。

## 2. 分层流水线

### L0：确定性规则

- 系统别名；
- 错误代码；
- 故障关键词；
- 否定词；
- 临床关键词；
- 院区和位置词典；
- 敏感信息正则。

延迟目标：毫秒级。

### L1：轻量分类

可采用传统分类器或小型文本模型，输出经过验证的类别概率。V1 可先不引入，使用规则 + LLM 影子模式。

### L2：OCR

提取：

- 窗口标题；
- 错误提示；
- 错误代码；
- URL/IP；
- 终端编号；
- 敏感信息。

### L3：本地小模型

负责：

- 请求类型；
- 标准摘要；
- 系统/模块建议；
- 症状建议；
- 缺失字段；
- 证据说明；
- 处理组建议。

### L4：人工确认

处理：

- 低确定性；
- 关键临床；
- 数据错误；
- 权限高风险；
- 公共故障候选；
- 系统冲突；
- 身份和院区冲突。

## 3. 模型选型原则

PRD 不永久绑定某一模型。候选模型必须在医院脱敏评估集上比较：

- 中文短文本分类准确率；
- 严格 JSON 成功率；
- 错误代码保真；
- 幻觉率；
- CPU P95 延迟；
- 并发吞吐；
- 内存；
- 许可；
- 本地部署和供应链可控性。

前期模型范围：

```text
2B—4B 级本地量化模型
```

推理通过内部适配器：

```text
OllamaProvider
LlamaCppProvider
VllmProvider（未来 GPU）
```

业务系统只调用统一 AI API。

## 4. OCR 选型

PaddleOCR 为候选。最终版本通过真实截图测试确定，不在业务代码中硬编码。

评估集至少包括：

- 软件报错弹窗；
- 手机拍摄显示器；
- 反光；
- 倾斜；
- 低清；
- 中文/英文混合；
- HIS/EMR/LIS/PACS；
- Windows 错误；
- 患者敏感信息；
- 内部 IP 和 URL。

## 5. Prompt 原则

Prompt 见 `prompts/triage_system_prompt.md`。

必须：

- 只输出符合 JSON Schema 的结果；
- 不输出推理过程；
- 不捏造系统、科室和错误码；
- 证据来源明确；
- 不判断最终优先级；
- 不输出执行命令；
- 不生成患者信息摘要；
- 无法判断返回 UNKNOWN 和 missing_fields。

## 6. 输出结构

见 `contracts/ai_triage_result.schema.json`。

关键字段：

```text
request_type
system_code
module_code
symptom_code
summary
error_codes
location suggestions
impact_scope_suggestion
clinical_impact_signals
recommended_resolver_team
missing_fields
evidence
decision_band
model_version
prompt_version
```

## 7. 不使用模型自报置信度作为概率

LLM 生成 `0.92` 不代表统计意义上的 92%。

自动化决策应由以下信号组合：

```text
rule_hits
catalog_match
error_code_match
classifier_probability
schema_valid
field_conflict
evaluation_metrics
```

建议输出 `decision_band`，由业务规则计算：

```text
MANUAL_TRIAGE
SUGGEST_ROUTE
AUTO_ROUTE
CRITICAL_REVIEW
```

## 8. 影子模式

初期：

- AI 结果写 AIDecision；
- 不自动修改处理组；
- 管理员查看建议；
- 记录人工最终结果；
- 计算混淆矩阵和字段级指标。

影子模式至少覆盖一个完整试点周期。

## 9. 评估指标

### 请求类型

- Precision；
- Recall；
- Macro-F1；
- Critical Recall。

### 字段

- system_code accuracy；
- symptom_code accuracy；
- error_code exact match；
- location extraction accuracy；
- resolver team suggestion accuracy；
- JSON schema pass rate。

### 运行

- P50/P95 延迟；
- 超时率；
- 内存；
- 每分钟吞吐；
- 降级率。

## 10. 自动路由启用门槛

建议：

- 系统识别精确率 ≥ 98%；
- 处理组推荐精确率 ≥ 98%；
- 高风险类别不自动；
- 支持一键回滚；
- 有持续漂移监控；
- 经过安全和业务负责人审批。

覆盖率不应通过降低精确率换取。

## 11. Prompt 与模型版本化

每次推理记录：

```text
pipeline_version
model_name
model_version
model_hash
prompt_version
catalog_version
rule_version
input_hash
```

任何模型或 Prompt 更新必须：

1. 在固定评估集回归；
2. 输出对比报告；
3. 影子运行；
4. 经审批后切换；
5. 保留回滚版本。

## 12. 微调策略

MVP 不做微调。

只有满足以下条件才评估：

- 已积累足够脱敏、人工校正数据；
- 规则和 Prompt 已达到瓶颈；
- 有明确增益目标；
- 数据使用获得审批；
- 能够管理训练版本和回滚；
- 维护成本可接受。
