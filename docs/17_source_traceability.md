# 17. V1.2 源资料追溯与决策说明

## 1. 原始资料

原始文件：`source/企业微信智能机器人方案.docx`。

原始资料保留业务目标：企业微信机器人、工单闭环、CPU约束、约800人报修群、10秒确认、状态通知和月报。`source/` 仅用于历史追溯，不是当前执行基线。

## 2. 官方 SDK 资料

参考来源：`https://github.com/WecomTeam/aibot-node-sdk`。

文档中记录的WebSocket、认证、心跳、重连、消息、媒体、主动推送和卡片能力都必须在真实租户G0验证。文档版本或SDK示例不能替代Gate证据。

## 3. 架构演进

### V1.0/V1.1 方向

旧规格假设企业微信接入层可以在首期直接使用医院现有Tickets、SSO、Hub和Outbox，并把相关能力拆为G0–P6执行计划。

### V1.2 变化

外网试点无法把医院内网Tickets作为可用依赖，因此采用：

```text
Phase 1
Enterprise WeCom
→ WeCom Gateway
→ Channel Message
→ Service Intake
→ Pilot Ticket Core
```

```text
Phase 3
Pilot Ticket Core
→ Ticket Adapter
→ Hospital Tickets
```

ADR-0002已被ADR-0007取代。Hospital Tickets仍是最终长期事实源，但不再是Phase 1运行依赖。

## 4. 源资料与当前决策对照

| 原始或旧方向 | V1.2 当前决策 |
|---|---|
| 公网回调网关 | WebSocket出站长连接为主，G0实测 |
| AI判断后建单 | 明确报修先建Pilot Ticket，AI异步 |
| 置信度阈值自动建单 | 不用模型自报置信度决定是否受理 |
| 5分钟同类别并单 | Incident候选，多特征且默认人工确认 |
| 每次状态群内广播 | 群内公共信息，个人进度单聊 |
| Phase 1直接复用医院Tickets | Phase 1独立Pilot Ticket Core |
| 医院SSO/Hub/Outbox作为首期依赖 | Phase 1最小Pilot身份、处理端和Outbox |
| P3=OCR、P4=AI、P5=Incident、P6=试点 | 统一为P1公网试点、P2 AI增强、P3医院融合 |
| 新建长期第二套工单 | Pilot仅用于试点；Phase 3切换后Hospital Tickets唯一 |

## 5. 当前权威来源

1. `AGENTS.md`；
2. `docs/architecture_baseline_status.md`；
3. 未被取代的Accepted ADR；
4. `plans/current_phase.json`、`plans/roadmap.md`和`plans/master_backlog.json`；
5. 详细文档、Contract、Schema和示例。

## 6. 仍需验证的事实

### G0

- 企业微信真实租户的群聊、媒体、主动推送、卡片、重连和单活行为；
- 锁定SDK版本、包哈希和网络条件。

### Phase 1

- 公网Pilot环境、安全审批、处理人员认证、H5路径、备份和留存；
- Pilot Ticket最小状态、编号、通知和试点规则。

### Phase 2

- 私有媒体存储、CPU资源、模型许可、评估集和数据使用审批。

### Phase 3

- Hospital Tickets真实API、状态机、身份、组织、附件、事件和通知契约；
- 迁移范围、切换窗口、回滚授权和Pilot归档期限。

未经验证的建议不得表述为当前系统事实。
