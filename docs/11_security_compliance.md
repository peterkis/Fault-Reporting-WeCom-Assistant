# 11. 安全、合规与数据生命周期

阶段边界：Phase 1 的公网 Pilot 数据域必须独立完成安全控制；不得以医院内网系统“以后会接入”为由降低试点安全要求。Phase 3 的跨域连接、迁移和 Hospital Tickets 权限需单独评审。

## 1. 安全目标

- 患者和员工信息不因报修机器人扩大暴露范围；
- 企业微信 Bot Secret 不泄漏；
- 原始截图不进入公开存储或普通日志；
- AI 不获得生产系统操作权限；
- 所有关键操作可审计；
- 数据按必要性保存并到期删除；
- 发生安全事件时可停用机器人而不破坏工单事实。

## 2. 数据分类

| 级别 | 示例 | 处理要求 |
|---|---|---|
| PUBLIC | 无敏感性的服务公告 | 可公开 |
| INTERNAL | 工单号、普通系统名称 | 院内 |
| SENSITIVE_INTERNAL | IP、服务器、账号、拓扑 | 限定信息科 |
| PERSONAL | 员工姓名、userid、手机号 | 按角色访问 |
| PATIENT_SENSITIVE | 姓名、住院号、诊断、医嘱、检验 | 严格受控 |
| SECRET | Bot Secret、Token、密码、密钥 | 密钥系统 |

## 3. 数据最小化

- 默认只处理明确发给机器人的消息；
- 不以“模型优化”为由永久保存全部无关聊天；
- 未建单的问候和无关消息设置短留存；
- 标题、群消息和月报不包含患者身份；
- AI 输入优先使用脱敏文本；
- 只保存完成服务所需的字段。

## 4. Secrets 管理

Bot ID 可视为配置，Bot Secret 必须：

- 使用 Vault、Docker Secret 或受控环境变量；
- 不进入 Git；
- 不进入镜像层；
- 不在异常堆栈中输出；
- 不通过前端或浏览器下发；
- 定期轮换；
- 轮换操作审计；
- 泄漏后立即吊销并更换。

## 5. 网络边界

Phase 1：

```text
企业微信云
    ↑ WSS 443 出站
公网试点受控区：WeCom Gateway
    ↓
Channel Message / Service Intake / Pilot Ticket Core
    ↓
Pilot PostgreSQL / Private Object Storage
```

Phase 3：

```text
Pilot Ticket Core
    ↓ 受控网络与认证
Ticket Adapter
    ↓
Hospital Tickets
```

主方案不需要公网入站回调。Ticket Adapter 的网络、双向认证、最小权限、审计和数据迁移必须独立安全评审和 ADR。

## 6. 附件安全

上传和下载流程：

1. 限制来源域；
2. 限制文件大小；
3. 读取 Magic Number；
4. MIME 白名单；
5. 防病毒或恶意内容扫描；
6. SHA256；
7. 私有桶；
8. 服务端鉴权；
9. 短时签名 URL；
10. 到期删除。

禁止：

- 公开桶；
- 永久 URL；
- 前端直接获得 MinIO 密钥；
- 将附件 Base64 写日志；
- 默认向整个报修群展示处理照片。

## 7. 患者信息脱敏

规则可包括：

- 身份证号；
- 手机号；
- 住院号和门诊号；
- 姓名与病历上下文；
- 地址；
- 检验、影像和诊断文本。

脱敏结果用于：

- 群内文案；
- 普通日志；
- AI 评估集；
- 月报；
- 非临床角色页面。

原始受控版只对授权处理人员开放。

## 8. 权限模型

### 临床申报人

- 查看自己工单；
- 查看自己订阅的 Incident 公共进展；
- 补充信息；
- 确认或重开；
- 不查看内部备注和其他申报人信息。

### 工程师

- 查看所属处理组工单；
- 接单和处理；
- 查看处理所需原始附件；
- 标记外部可见内容；
- 不得无业务理由批量浏览患者截图。

### 值班管理员

- 分诊；
- 身份映射；
- Incident 确认；
- 超时管理；
- 查看审计摘要。

### 系统和安全管理员

- 配置和审计；
- 原始敏感数据访问需更严格授权；
- 管理员权限与业务处理权限分离。

## 9. 审计事件

至少记录：

```text
wecom.connection.authenticated
message.received
message.duplicate
media.downloaded
media.viewed
intake.created
ticket.created
ticket.state_changed
identity.mapped
ai.inferred
ai.corrected
incident.linked
incident.unlinked
notification.sent
notification.failed
secret.rotated
retention.deleted
```

审计日志不可被普通业务用户修改。

## 10. 日志规范

允许：

- 哈希化 userid/chatid；
- msg_id；
- trace_id；
- 处理状态；
- 耗时；
- 错误码；
- 文件大小和哈希。

禁止：

- 原始患者文本；
- 完整 OCR；
- aeskey；
- Bot Secret；
- 密码；
- 完整媒体 URL；
- 未脱敏内部网络信息。

## 11. 数据留存

策略配置化，示例见 `config_examples/retention_policy.example.json`。

必须支持：

- 按数据类型配置；
- 按敏感级别配置；
- 到期自动删除；
- 法定/审计保留例外；
- 删除失败告警；
- 删除审计；
- 备份中的生命周期管理。

## 12. AI 安全

- AI 服务无 Pilot Ticket 或 Hospital Tickets 数据库写权限；
- 不启用任意工具调用；
- 不加载用户提供的可执行代码；
- Prompt 中明确忽略截图内的指令文本；
- 输出通过 JSON Schema；
- 所有枚举查主数据；
- 关键字段冲突进入人工；
- 不向公网模型发送消息；
- 模型文件校验哈希和来源。

## 13. 安全事件处置

可执行的隔离动作：

- 停止 AI；
- 禁止媒体处理；
- 禁止主动群消息；
- 轮换 Bot Secret；
- 断开 WebSocket；
- 保留已入库消息和工单；
- 切换人工报修入口；
- 导出审计记录。

核心原则：安全隔离不能篡改已发生的业务事实。
