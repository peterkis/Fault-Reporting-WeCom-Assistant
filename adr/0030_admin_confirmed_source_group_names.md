# ADR-0030：管理员维护来源群名称

状态：Accepted，依据用户 2026-10-07 确认“管理员在管理端维护群名称”。授权本地实现与隔离验证；发布、真实库迁移、开关启用及现场发送各自保留原边界。

企业微信 Bot 群消息提供 chatid，当前验证没有群名称。管理端使用管理员确认的显示名称。名称资料以 `(source_provider, source_bot_id, source_chat_id)` 的规范 JSON 数组 SHA-256 为不透明引用，独立存储，禁止前端读取原始 Bot ID/chatid。不同 Bot、不同群均不合并；同名不意味着同一群。

工单读取依据有效原始 Intake/Journey，群转单聊后仍显示原始来源群。来源冲突、资料过期或未登记分别明确降级，不以最后一条消息猜来源。管理员改名更新当前显示资料，不改 Ticket、Intake、Journey 或通知路由，不补造历史名称快照。

扩展既有看板与详情 DTO，增加统一来源展示字段。管理员从事项详情登记/修改群名称，后端执行当前 ADMIN 授权、CSRF/Origin、幂等、乐观版本检查及追加名称变更记录。名称作为纯文本渲染。普通坐席只读取获权工单的来源名称。

这是 ADR-0029 之后的独立元数据增量；WEB01 的 Ticket 业务内容仍只读。新增 `sourceGroupDirectoryEnabled` 宿主选项默认 false，关闭时不读新表；数据库迁移 037 由独立入口执行，不进入固定历史迁移清单，不更改业务 Gate 或旧 Evidence。合同见 [来源群接口](../docs/api/workbench/source-groups-design.md)。
