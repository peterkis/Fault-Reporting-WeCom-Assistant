
# 识别转换规则

> V1.2：Phase 1 的明确报修转换为 Pilot Ticket；Phase 2 才增加 AI/OCR；Phase 3 由 Ticket Adapter 迁移到 Hospital Tickets。

## 输入

text
image
mixed
file

## 分类

INCIDENT:
故障

SERVICE_REQUEST:
服务申请

QUESTION:
咨询

CHATTER:
普通交流

## 转换规则

明确@机器人：
立即创建Service Intake。

图片：
保存附件 -> OCR -> AI增强。

AI异常：
进入人工分诊。

## 字段

system_code
module_code
symptom_code
campus
department
location
error_code
impact_scope
priority_suggestion

## 禁止

AI不能决定是否创建明确报修。
AI不能删除原始消息。
