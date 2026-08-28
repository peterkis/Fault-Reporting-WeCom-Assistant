# Phase 1 任务明细：企业微信外网试点

固定工单核心：Pilot Ticket Core。所有任务均不得依赖 Hospital Tickets、医院 SSO、医院 Hub 或院内 Outbox。

## P1-001 建立 Pilot 工程骨架与配置校验

- 状态：IN_PROGRESS
- 依赖：G0-008
- 输入：Gate 0 能力结论、锁定 SDK、Pilot 运行环境约束。
- 输出：最小工程骨架、分层配置、启动校验和依赖边界说明。
- 测试：配置缺失、非法值、Secret 日志扫描、启动/退出测试。
- 验收：配置只声明 Pilot 依赖；不存在 Hospital Tickets 运行依赖。

### 启动记录

- 启动日期：2026-08-28
- 启动授权：项目负责人确认 Gate 0 结论并授权开始下一阶段。
- 执行边界：只建立 Pilot 工程骨架和配置/依赖边界校验；不实现 WeCom SDK Adapter、Channel Message 持久化、Ticket、AI 或 Hospital Tickets 集成。

### 当前验收记录

- 已完成：`src/p1-001-pilot-foundation.mjs`、`docs/20_p1_pilot_foundation.md` 和 4 项 P1-001 自动化测试；本机版本控制外的配置模板预检通过，全量本地回归为 58/58 通过。
- 已完成：无 Secret 的模板预检通过；健康端点启动/关闭与非业务路由拒绝通过。
- 未执行：真实 `.env.pilot` 预检。当前工作区没有该本机忽略文件，不能宣称试点环境、安全边界、测试群或负责人已经配置/验收。
- 状态：保持 `IN_PROGRESS`；未通过真实配置预检和负责人确认前，不启动 P1-002。

## P1-002 WeCom SDK Adapter 与标准消息契约

- 状态：TODO
- 依赖：P1-001
- 输入：Gate 0 脱敏 Frame 与 SDK 版本。
- 输出：WeCom SDK Adapter、Normalized Message 契约和稳定错误码。
- 测试：文本、图片、mixed、重复 Frame、非法 Frame Contract Test。
- 验收：业务模块不依赖 SDK 原始类型。

## P1-003 Channel Message Inbox 与数据库幂等

- 状态：TODO
- 依赖：P1-002
- 输入：标准消息契约、隐私与留存规则。
- 输出：Channel Message 持久化、`provider + msg_id` 唯一约束和重复请求原结果返回。
- 测试：并发重复、事务回滚、进程重启和数据库暂时不可用。
- 验收：同一消息只保存一次且不产生重复业务处理。

## P1-004 Service Intake 创建与消息聚合

- 状态：TODO
- 依赖：P1-003
- 输入：Channel Message、90秒聚合规则和请求类型规则。
- 输出：Service Intake、消息关系、补充/澄清关联和审计事件。
- 测试：单条、多条补充、新报修、纯图片和并发聚合。
- 验收：消息与 Intake 分层；补充消息不错误新建工单。

## P1-005 Pilot Ticket Core 模型与编号

- 状态：TODO
- 依赖：P1-004
- 输入：Service Intake、Pilot 服务目录和编号规则。
- 输出：Pilot Ticket、编号、处理组、版本、内外部备注和迁移标识。
- 测试：幂等创建、编号冲突、Intake 一对一主工单约束和回滚。
- 验收：明确报修无需 AI 即可创建 Pilot Ticket；不调用 Hospital Tickets。

## P1-006 Pilot Ticket 状态机、Action 与事件

- 状态：TODO
- 依赖：P1-005
- 输入：状态枚举、合法转换、权限和乐观锁规则。
- 输出：Action API、Ticket Event、真实对外状态和版本冲突处理。
- 测试：全状态路径、非法转换、重复点击、并发接单和重开。
- 验收：每次状态变化都有事件；不能通过通用 PATCH 绕过 Action。

## P1-007 Notification Outbox 与 Delivery

- 状态：TODO
- 依赖：P1-006
- 输入：Ticket Event、通知矩阵、企业微信发送能力。
- 输出：Pilot Outbox、Delivery、重试、限流、去重、死信和送达审计。
- 测试：事务失败、发送超时、重复 Worker、断线积压和部分成功。
- 验收：状态、事件和 Outbox 同事务；发送失败不回滚工单事实。

## P1-008 首次确认与可靠回执

- 状态：TODO
- 依赖：P1-007
- 输入：持久化结果、Pilot Ticket 编号和通知模板。
- 输出：事务提交后的首次回复、临时失败文案和发送时间指标。
- 测试：提交失败、超时、重复消息、Gateway 重连和通知拒绝。
- 验收：不在提交前回复；不虚构工单号或“处理中”状态。

## P1-009 最小处理端与 Pilot 权限

- 状态：TODO
- 依赖：P1-006
- 输入：Pilot 用户/角色配置、处理组和 Action API。
- 输出：最小待办、接单、处理和备注入口及审计。
- 测试：未授权、越权、并发操作、内部备注泄漏和移动端基础可用性。
- 验收：使用 Pilot 身份边界，不要求医院 SSO 或 Hub。

## P1-010 补充、解决确认、关闭与重开

- 状态：TODO
- 依赖：P1-008, P1-009
- 输入：卡片能力、状态机、Outbox 和申报人关联。
- 输出：请求补充、解决卡片、确认关闭、自动关闭标识和重开闭环。
- 测试：过期/重复卡片、错误用户、超时关闭、仍未恢复和通知失败。
- 验收：申报人可完成真实闭环；自动关闭不冒充用户确认。

## P1-011 Pilot 安全、可观测性与运维基线

- 状态：TODO
- 依赖：P1-007
- 输入：公网试点威胁模型、日志规范、留存和备份要求。
- 输出：权限、Secret、日志脱敏、指标、告警、备份、恢复和 Runbook。
- 测试：Secret/患者信息扫描、依赖故障、恢复、限流和审计访问。
- 验收：公网 Pilot 数据受控；Redis/AI等非关键依赖失败不漏单。

## P1-012 Phase 1 E2E、故障演练与试点 Go/No-Go

- 状态：TODO
- 依赖：P1-010, P1-011
- 输入：Phase 1 全部交付物、测试群和试点验收指标。
- 输出：E2E报告、故障演练、性能/安全证据和试点评审结论。
- 测试：文字/图片降级、100条突发、断线、数据库/Outbox故障、AI关闭占位场景。
- 验收：漏单0、重复单0、10秒目标、状态真实、通知可追溯；批准后方可进入 Phase 2。
