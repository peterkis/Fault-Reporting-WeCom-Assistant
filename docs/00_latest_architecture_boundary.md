
# 最新架构边界说明

## 为什么允许试点独立工单

企业微信IT助手需要先在纯外网环境验证：
- 临床接受度；
- 消息闭环；
- AI识别效果；
- 信息科处理流程。

因此试点阶段允许建设轻量Ticket Core。

## 长期目标

禁止形成：

IT助手工单 + 医院工单

两个长期事实源。

正式阶段：

Pilot Ticket
        |
        |
Ticket Adapter
        |
        |
Hospital Tickets

## 核心对象

Channel Message:
企业微信原始消息

Service Intake:
一次服务受理上下文

Ticket:
处理任务

Incident:
公共故障

Subscription:
通知关系
