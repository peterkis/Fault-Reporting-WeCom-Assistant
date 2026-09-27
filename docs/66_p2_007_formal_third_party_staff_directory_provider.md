# P2-007 正式三方人员目录 Provider

状态：`FORMAL_CAPABILITY_DOCUMENTED`。本文件只描述正式环境能力和后续受控 Provider 设计，不代表生产启用、人员主数据接入批准或 P2 Gate 通过。

## 1. 范围与证据

正式环境基址：

```text
https://rd-api.mobimedical.cn/8024
```

组织范围使用 DOCX 中“成都市第三人民医院”根节点。根节点 ID 通过受控配置注入，本文不记录实际值。

正式脱敏证据：

- [组织树与人员详情正式验证](../../evidence/third-party-staff-info-sync-formal-20260926.json)
- [人员详情字段正式验证](../../evidence/third-party-staff-info-detail-formal-20260926.json)
- [用户 A 正式 ID 对应验证](../../evidence/third-party-id-mapping-formal-direct-user-id-20260927.json)

测试地址和测试环境证据不属于本 Provider 的正式能力结论。原始响应、key、token、姓名、手机号、工号、用户 ID 和头像 URL 不写入本文。

## 2. 正式能力矩阵

| 能力 | 方法 | 正式验证结果 | 约束 |
|---|---|---|---|
| 获取服务商 Token | `POST /token/getToken` | `PASS` | `key` 来自 `THIRD_STAFF_INFO_SYNC_KEY`，Token 只在进程内保存 |
| 获取完整组织树 | `POST /token/getOrganizationTree` | `PASS` | `get_user=get`，省略 `no_child`，使用配置根节点 |
| 部门范围控制 | `POST /token/getOrganizationTree` | `PASS` | `no_child=1` 不展开子部门；不传 `get_user` 不返回人员对象 |
| 获取人员详情 | `POST /token/getUserInfo` | `PASS` | `uid` 由显式 UID Resolver 提供 |
| 用户 A ID 对应 | 多个 UID 输入矩阵 | `PARTIAL` | Bot 原始 ID 路径成功；`open_userid` 和组织树 `user_id` 直接作为 `uid` 被拒绝 |

正式完整组织树结果为 333 个部门、4,290 个成员，最大层级 4；未发现重复部门 ID、循环引用或无效节点。人员详情抽样 20/20 成功，并完成工号、姓名、手机号和第三方 `user_id` 交叉核对。

## 3. 请求参数与返回参数

所有正式请求使用：

```http
Content-Type: application/x-www-form-urlencoded
```

JSON 请求兼容性没有验证，保持 `NOT_RUN`。

### 3.1 Token

请求：

```text
POST /token/getToken
key=${THIRD_STAFF_INFO_SYNC_KEY}
```

成功响应的领域相关字段：

| 字段 | 类型 | 使用说明 |
|---|---|---|
| `result` | String | 必须为 `TRUE` |
| `data.token` | String | 后续两个接口使用；不得落盘或写日志 |

当前响应没有文档化 `expires_in`。Provider 在实例闭包内缓存 Token；服务商鉴权失败时使缓存失效，当前请求失败，不自动扩大重试范围。

### 3.2 组织树

完整树请求：

```text
POST /token/getOrganizationTree
token=<in-memory-token>
parent_id=<configured-root-id>
get_user=get
```

局部诊断请求：

```text
no_child=1
```

不传 `get_user` 时不要求返回人员对象。响应主要字段：

| 字段 | 类型 | 使用说明 |
|---|---|---|
| `result` | String | 必须为 `TRUE` |
| `data[]` | Array | 部门节点集合 |
| `data[].id` | String | 第三方部门标识 |
| `data[].name` | String | 部门显示名称 |
| `data[].gid` | 文档为 String；正式观察为 Number | 只作为 Provider 字段，记录协议警告并规范化为文本 |
| `data[].users[]` | Array | 成员对象；完整同步使用 `get_user=get` |
| `data[].children[]` | Array | 子部门 |
| `users[].user_id` | String | 第三方目录人员标识，作为返回结果的严格交叉核对键 |
| `users[].nickname` | String | 成员显示名称 |
| `users[].phone` | String | 组织树中的手机号字段 |
| `users[].tuishiben_id` | String | 第三方工号字段 |
| `users[].wecom_id` | String | 第三方返回字段；不等同于官方 `open_userid`，不作为主匹配键 |

Provider 在发布本地快照前检查部门 ID、成员 ID、父子关系、重复项、循环引用、数量和响应大小。失败时保留上一版当前目录。

### 3.3 人员详情

请求：

```text
POST /token/getUserInfo
token=<in-memory-token>
uid=<ProviderUidResolver 输出>
```

成功响应的领域相关字段：

| 字段 | 类型 | 归一化字段 | 使用说明 |
|---|---|---|---|
| `result` | String | — | 必须为 `TRUE` |
| `data.employee_id` | String | `employee_id` | 必须与组织树 `tuishiben_id` 严格一致 |
| `data.user_id` | String | `provider_user_id` | 必须与组织树唯一记录严格一致 |
| `data.nickname` | String | `display_name` | 双方有值时交叉核对 |
| `data.phoneno` | String | `phone` | 与组织树 `phone` 双方有值时交叉核对 |
| `data.sex` | String | `sex` | 已验证存在；按字段值透传，不猜测含义 |
| `data.avatar` | String | `avatar_url` | 只接受 HTTPS URL 类型，不下载头像 |

失败响应按 `result=FALSE`、`errorcode` 和 `msg` 分类。原始错误文本不进入普通日志或 Evidence。

## 4. ID 命名空间与用户 A 结果

| 名称 | 命名空间 | 处理规则 |
|---|---|---|
| Bot `from.userid` | 企业微信 Bot 成员标识 | 只能通过显式 Resolver 作为第三方 `uid` 候选 |
| 官方 `open_userid` | 企业微信服务商主体标识 | 按官方接口转换，不自动作为第三方 `uid` |
| `wecom_id` | 第三方返回字段 | 不作为主连接键 |
| 第三方 `user_id` | 第三方目录人员标识 | 与详情返回值严格相等匹配 |
| `tuishiben_id` | 第三方工号 | 与详情 `employee_id` 严格相等匹配 |
| `getUserInfo.uid` | 第三方查询输入 | 必须由 `ProviderUidResolver` 明确生成 |

官方企业微信 ID 规则参考：[userid 转 open_userid](https://developer.work.weixin.qq.com/document/path/97106)、[代开发应用安全升级](https://developer.work.weixin.qq.com/document/path/97104)、[账号 ID 概述](https://developer.work.weixin.qq.com/document/path/96248)。

用户 A 正式验证结果：

- Bot 原始 ID 作为 `uid` 成功；返回的第三方 `user_id` 与组织树唯一成员匹配；`employee_id` 与 `tuishiben_id` 匹配；姓名、手机号、`sex` 和 `avatar` 字段核对成功。
- 官方转换得到的 `open_userid` 作为 `uid` 被拒绝。
- 组织树返回的 `user_id` 直接作为 `uid` 被拒绝。
- 当前医小修 OAuth 现场对应为 `NOT_RUN`，历史证据不能升级为当前现场验证。

因此不能把 Bot ID、`open_userid`、`wecom_id`、第三方 `user_id` 或工号宣称为同一命名空间。用户 A 的 Bot 原始 ID 路径只能作为显式、可插拔 Resolver Profile，不能推导为全员规则。

## 5. 字段留存边界

- 正式详情抽样中 `sex` 为字符串且 20/20 存在；后续当前目录缓存和报修时资料快照均可保留 `sex`。
- 正式详情抽样中 `avatar` 为非空 HTTPS 字符串且 20/20 存在；后续只保留在当前目录缓存，不写入报修历史快照。
- 当前目录变化只影响 `reporter_current`；报修时快照 `reporter_at_report` 不被覆盖。
- Provider 原始 ID、Bot ID、`open_userid`、查询 UID、Token 和 key 不进入公共投影、普通日志或 Evidence。

## 6. Provider 使用边界

领域层只依赖窄 Port：

```text
StaffDirectoryProvider
├─ syncOrganizationTree()
└─ getPersonProfile()

ProviderUidResolver
└─ resolveQueryUid()
```

HTTP、Token 和字段防腐转换由正式出站 Adapter 实现；PostgreSQL 当前目录由独立 Store 实现。报修解析顺序为：

```text
reporter_identity_hash
→ 当前目录绑定
→ 命中则直接返回本地资料
→ 未命中才调用显式 UID Resolver 和 getUserInfo
→ 严格匹配 user_id / employee_id
→ 建立受限绑定并保存报修时快照
```

工单读取只返回本地的 `reporter_current` 和不可变的 `reporter_at_report`，不在读取工单时访问第三方网络。

Provider、同步任务和目录迁移默认关闭；启用前仍需单独完成配置、数据留存和生产运行授权。

装配层通过 `src/p2-007-third-party-staff-directory.mjs` 组合 Provider、Store、报修解析器和同步任务，再显式注入现有 Runtime：

```js
const directory = createThirdPartyStaffDirectory({
  pool,
  enabled: configuration.thirdPartyDirectoryEnabled,
  keyProvider: () => configuration.thirdPartyInfoSyncKey,
  rootRef: configuration.thirdPartyDirectoryRootId,
});

createP2016Runtime({
  directoryPort: directory.reporterDirectory,
  directorySource: 'THIRD_PARTY_STAFF_DIRECTORY',
  directoryStore: directory.store,
  directorySyncJob: directory.syncJob,
});
```

示例中的 key 只表示运行时注入点，不应出现在源代码、日志或文档中。


## 7. 已接入的进程角色与修复验证边界

`scripts/p2-016-process-role.mjs` 和 `scripts/p2-012-process-role.mjs` 通过
`createThirdPartyStaffDirectoryProcessOptions` 读取开关。未设置或严格为 `false` 时，
不构造 Provider、目录 Store 或同步任务；其他非 `true` 值会报配置错误，避免静默误配。

在独立授权且迁移 030 → 031 → 035 → 036 完成后，两个启动器均按以下职责装配：

| 角色 | 开启后的行为 | 不承担的职责 |
|---|---|---|
| App | 使用现有连接池读取 FORMAL 当前目录，向授权查询提供 `reporter_current` | 不创建 HTTP Provider，不执行同步或详情回源 |
| Worker | 校验根节点及密钥配置，注入报修解析 Port、明确的来源和日常同步任务 | 不创建额外进程、连接池或独立定时器 |
| Gateway | 保留原来的入站、发送和批准范围 | 不读取人员目录，不持有第三方密钥 |

Worker 明确选择只接受 `WECOM_AIBOT` 原始 ID 的 Resolver Profile；其他命名空间
仍为 DEFERRED，不回退到姓名、手机号、工号或第三方 `user_id` 猜测。此选择是查询路径，
不是全员身份对应已被证明；每次首次绑定仍须通过当前目录的严格交叉核验。

P2-G2 和医小修受限自助入口使用独立的授权清单、网络策略及装配流程，本开关不绕过这些
边界，也不将这些入口自动切换到第三方 Provider。原来的全部发送授权和停止线不变。

目录刷新只为同一来源、同一第三方人员 ID 且工号未变的成员保留 `sex`、`avatar_url`。
人员移除或人员 ID 被另一工号复用时，原 ACTIVE 绑定转为 STALE；新身份不得继承原资料。
已失效或冲突的绑定不会仅因后续组织同步自动恢复。同步发布和详情保存使用同一来源事务锁，
失败发布回滚整个事务，保留上一版目录；历史报修快照不参与刷新。

HTTP 401/403（包括 HTML 错误页）会使本次被拒绝的缓存 Token 失效；下一次操作重新取 Token，
当前请求不自动重试。旧请求的延迟失败不得清除后来已更新的 Token。响应先检查可用的
Content-Length，再按字节上限读取流；无长度、分块或错误长度也不能绕过实际读取上限，
超限立即取消读取。组织树、详情、Token 分别沿用 4 MiB、256 KiB、64 KiB 上限。
报修快照时间统一使用平台的 Asia/Shanghai 本地时间格式，包含跨日转换。

回归入口为 `npm run test:p2:007`、目录 PostgreSQL 集成测试及 `npm run test:p2:015`。
GitHub Actions 在 PR 事件给定的完整 head SHA 上以 Node 24 / PostgreSQL 18 执行，保存
原始日志和源码 SHA；另行检查架构与原型类型/构建。冻结历史校验输出中的
`historical_only=true` 只证明原历史版本，不代替当前候选的 readiness 或现场批准。


## 8. 目录容量与快照哈希的共同边界

目录采用独立的有界规范化与流式 canonical SHA-256，不提高
`p2-007-domain-utils.mjs` 的通用 JSON/哈希限制，不修改历史快照编码。
小目录的版本哈希与原 canonical 格式一致；输入部门、人员及归属关系的顺序不影响版本，
实际资料或归属变化仍会改变版本。

| 资源 | 硬上限 | 说明 |
|---|---|---|
| 部门 | 5,000 | 全树唯一部门数量 |
| 人员 | 20,000 | 全树唯一第三方人员 ID 数量 |
| 人员出现／归属关系 | 40,000 | 全树 `users` 条目总数，含重复；不是每人最多两个部门 |
| 层级 | 16 | 根深度为 0 |
| HTTP 组织树 | 4 MiB | 仍在读取时按字节限制；数量和字节上限须同时满足 |

测试注入的数量与深度限制只能在这些上限内取非负安全整数；省略项使用默认值。
人员跨部门出现会占用全局归属预算，重复条目不会因为去重而绕过输入预算。
已知输入形状的节点预算为 `2 + 8×部门上限 + 6×人员出现上限`；
规范化哈希预算为 `10 + 7×部门上限 + 6×人员上限 + 3×归属上限`。
这些节点数包含对象、标量字段、数组及数组 length；未知额外字段也消耗输入节点预算。
数组长度另按目录计数上限限制，不再误用通用 5,000 元素上限。

回归使用纯合成夹具，不保存或访问正式人员资料：覆盖 333 部门／4,290 成员／深度 4，
5,000 部门／20,000 完整字段成员，以及 40,000 归属关系；各项上限加一均必须拒绝。
PostgreSQL 集成回归从模拟 HTTP 响应开始，经规范化、哈希、同步任务到事务发布及读取，
并检查无效刷新不替换上一版目录。所有用例沿用现有 CI 入口，不另设验收体系。
上述验证不代表正式同步、生产运行或当前全项目 readiness 获批。
