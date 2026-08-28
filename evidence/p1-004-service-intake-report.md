# P1-004 Service Intake 创建与消息聚合验收报告

- 验收日期：2026-08-29
- 环境：Windows 本机、Node.js `24.18.0`、PostgreSQL `18.4`
- 结论：DONE（本机 PostgreSQL 集成验收；非公网、非真实 WSS、非客户端、非临床试点验收）
- 下一任务：P1-005 保持 TODO，未启动

## 1. 授权与边界

项目负责人明确调用 `implement` 并要求执行 `P1-004`。本轮只实现：

- Service Intake 创建与 90 秒同上下文聚合；
- Channel Message 的 `PRIMARY / SUPPLEMENT / CLARIFICATION` 关系；
- `intake.received`、`intake.needs_clarification`、`intake.message_added`、`intake.clarification_added` 审计事件；
- 不依赖 AI/OCR 的确定性请求类型规则。

本轮没有创建 Pilot Ticket、工单号、Incident、Notification Outbox/Delivery、回复通道、AI/OCR、Hospital Ticket Adapter 或医院系统连接。所有返回结果中的 `ticket_id`、`incident_id` 均为空。

## 2. 交付物

- `database/migrations/002_p1_004_service_intake.sql`
- `src/p1-004-service-intake.mjs`
- `scripts/p1-004-migrate.mjs`
- `scripts/p1-004-verify.mjs`
- `tests/p1-004-service-intake.test.mjs`
- `contracts/service_intake.schema.json`
- `contracts/domain_events.md`
- `docs/23_p1_service_intake.md`

## 3. 验收结果

### 3.1 定向真实 PostgreSQL 集成测试

命令：

```powershell
npm run test:p1:004:integration
```

结果：`22/22` 通过，`0` 失败、`0` 跳过。覆盖：

- 单条消息创建一个 Intake、PRIMARY 关系和 received 事件；
- 90 秒内多条补充复用一个 Intake，不创建 Ticket；
- 显式“新报修”和另一工单编号引用开始新 Intake；
- 纯图片创建 `UNKNOWN / WAITING_DESCRIPTION` Intake 并请求澄清；
- 图片后的有效描述追加为 CLARIFICATION，并推进分类/状态；
- 12 条不同 `msg_id` 并发只形成一个 Intake、12 条关系和连续版本；
- 较早事务暂停、较晚时间戳先提交时仍只形成一个 Intake，并保持消息时间高水位和合法更新时间；显式新报修/另一工单边界不被较早逆序消息穿透，边界后的补充也不会回挂旧 Intake；
- 八类请求类型、分句级“没有报错”否定、独立感谢、90 秒含边界/超界、发送人/会话隔离和单聊渠道映射；
- 聚合使用最强隐私级别和最早留存期，可重放 Inbox 结果不复制数据库摘要；隔离旧结构升级按全部关系重算边界、以等价词边界从主消息恢复显式边界，并对旧非空快照摘要失败关闭且保持原值；迁移 CLI 仅在 SQLSTATE 与稳定消息同时匹配时返回不可重试的修复码；
- Channel Message 重放返回原 Intake 快照，不增加关系或事件；
- Intake 后续处理失败时，Channel Message、Intake、关系和事件整笔回滚，可干净重试；
- 五位数编号不截断、严格事件 ordinal、迁移范围、Schema 范围、迁移可重入和非法窗口参数。

### 3.2 全量带库回归

命令：

```powershell
node --env-file=.env.pilot --test
```

结果：`99/99` 通过，`0` 失败、`0` 跳过。该结果同时覆盖既有 Gate 0、P1-001、P1-002、P1-003 和 P1-004 自动化回归。

### 3.3 迁移与数据库收尾

命令：

```powershell
npm run p1:004:migrate
npm run p1:004:verify
```

结果：

- `channel.message_inbox`、`intake.service_intake`、`intake.service_intake_message`、`intake.service_intake_event` 均存在；
- 显式聚合边界列、聚合隐私/留存列、事件 ordinal 唯一索引均存在，关联 Inbox 不存在旧非空摘要；
- `pilot_ticket` Schema 不存在；
- `p1-004-*` 合成 Channel Message、Intake、消息关系、事件残留均为 `0`；
- 核验输出不包含数据库 URL、用户名、密码或业务原文。

### 3.4 结构与依赖检查

- `node --check`：P1-004 实现、迁移/核验脚本和测试均通过；
- JSON 解析：`package*.json`、MANIFEST、状态文件、Service Intake Schema 均通过；
- `git diff --check`：退出码 `0`，无补丁空白错误；Windows 工作区存在既有 LF→CRLF 提示，不影响检查结论；
- `npm audit --omit=dev --registry=https://registry.npmjs.org`：最终结果 `0 vulnerabilities`。首次请求曾在 TLS 建连前瞬时断开，未改变文件；重试成功。

## 4. 验收映射

| 任务要求 | 证据 | 结果 |
| --- | --- | --- |
| 单条 | 单条创建用例；1 Intake、1 PRIMARY、1 received | 通过 |
| 多条补充 | 四条顺序补充与 12 路并发 | 通过 |
| 新报修 | 显式新报修、另一工单引用、90 秒超界 | 通过 |
| 纯图片 | UNKNOWN、WAITING_DESCRIPTION、needs clarification | 通过 |
| 并发聚合 | PostgreSQL advisory lock；12 条不同消息只形成一个 Intake | 通过 |
| 消息与 Intake 分层 | `channel.*` 与 `intake.*` 分表，关系表外键连接 | 通过 |
| 补充不错误新建工单 | 追加结果 `ticket_id=null`；数据库无 `pilot_ticket` Schema | 通过 |

## 5. 结论限制

本报告使用合成的 Normalized Message 和本机 PostgreSQL。没有公网 IP，没有启动真实企业微信长连接，没有客户端回执/可见性观察，也没有临床用户验证。因此它只支持 P1-004 的本机集成验收结论，不能支持“公网已上线”“客户端已收到工单”“临床闭环通过”或 Phase 1 Go/No-Go。P1-005 必须获得单独授权后才能创建 Pilot Ticket Core 模型与编号。
