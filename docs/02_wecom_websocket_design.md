
# 企业微信WebSocket设计

> V1.2：本设计用于 Gate 0 与 Phase 1 公网试点。Gateway 下游是 Channel Message、Service Intake 和 Pilot Ticket Core，不连接 Hospital Tickets。

## Gateway职责

- Bot认证
- 长连接维护
- 心跳
- 重连
- 消息接收
- 图片文件处理
- 主动推送

## 不负责

- 工单逻辑
- AI判断
- 数据分析

## 验收

- 24小时稳定连接
- 文本消息正常
- 图片消息正常
- 主动推送正常
- 重连恢复正常
