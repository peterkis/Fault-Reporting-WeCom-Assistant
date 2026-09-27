# ADR-0025：正式三方人员目录 Provider 与报修时组织快照

- 状态：`ACCEPTED_FOR_IMPLEMENTATION`
- 日期：2026-09-27
- 适用：P2-007 身份与人员资料适配
- 不构成：生产启用、人员主数据接入批准、P2 Gate 或人员信息长期留存批准

## 背景

正式三方服务商接口可以返回成都市第三人民医院组织树和人员详情。正式验证发现，组织树返回的 `user_id`、第三方 `wecom_id`、企业微信官方 `open_userid` 和 `getUserInfo.uid` 并不是可以自动互换的同一命名空间。用户 A 只有显式 Bot 原始 UID 路径现场查询成功。

系统还需要同时满足两个时间维度：每日同步得到当前组织目录；报修事实保留报修发生时的部门关系，不能被人员调岗覆盖。

## 决策

1. 领域层定义窄的 `StaffDirectoryProvider` Port；HTTP、Token 和 PostgreSQL 实现放在出站适配器/Store，领域不依赖 `fetch`、SQL 或服务商响应。
2. Provider 提供两个能力：完整组织树同步、受显式 UID Resolver 控制的人员详情查询。
3. `ProviderUidResolver` 默认 fail-closed。不得自动用 `wecom_id`、官方 `open_userid` 或组织树 `user_id` 作为详情 `uid`。
4. PostgreSQL 保存正式 Provider 的当前目录快照和受限身份绑定；不引入 Redis、不保存每日全量历史、不建立第二套 Person 或 Ticket。
5. 报修解析先查本地当前目录，只有无绑定时才调用一次详情接口；成功后建立受限绑定并生成报修时资料快照。
6. `sex` 可进入当前目录和报修时快照；`avatar` 只进入当前目录，不进入历史报修快照；两者都不写入普通日志或 Evidence。
7. 工单读取分别表达 `reporter_current` 与 `reporter_at_report`，第三方网络调用不发生在工单读取路径。
8. Provider、同步任务和目录迁移默认关闭；现有 `WECOM_DIRECTORY` 仍是默认行为，切换来源必须由装配层显式完成。

## 一致性与失败策略

- 组织树先在内存完成类型、数量、重复 ID、循环引用和交叉结构校验，再以单事务替换当前目录。
- 同步失败、超时、响应超限或协议不明确时保留上一版当前目录。
- 当前目录中的绑定若不再出现于新快照，标记 `STALE`，不静默换绑。
- 详情返回必须与当前目录唯一 `user_id` 匹配，并核对 `employee_id`/`tuishiben_id`；姓名和手机号仅作双方有值时的冲突核对，不能作为主匹配键。
- 目录解析失败返回 `DEFERRED`/`NOT_FOUND`，不得阻断已受理的报修。
- 已成功写入的非空报修时快照不可被后续同步覆盖；空的 `DEFERRED` 快照只能通过受控补齐操作更新，并记录实际解析时间。

## 回滚与边界

关闭 Feature Flag 即停止第三方同步和详情回源，现有 Bot、Ticket、Outbox 和 `WECOM_DIRECTORY` 行为保持不变。Migration 036 只允许前向迁移，不改写历史 Evidence，不进行正式接口调用，不代表生产运行授权。

正式接口矩阵和字段来源见 [P2-007 正式三方人员目录 Provider](../docs/66_p2_007_formal_third_party_staff_directory_provider.md)。
