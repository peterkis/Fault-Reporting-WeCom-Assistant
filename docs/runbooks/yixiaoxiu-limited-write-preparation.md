# SS-010 限定写现场准备

2026-10-06 当前兼容决策见 [ADR-0028](../../adr/0028_single_approved_reporter_limited_write.md)：允许仅 A 或原 A/B 的获批 Reporter，实际 userid 数量与 alias 一致，仍须两个不同的有效获批内部 principal。源码变化后须新候选认证和独立实际批准，单成员 PR 完成后停止；下文为 SS010 原准备轮次记录，历史结果与批准不改写。

本手册准备 SS-011；本轮只在隔离本地验证并提交。不推送、创建 PR、部署、连接真实 OAuth、应用现场迁移或发送消息。当前正式结果以 `evidence/yxx-ss-010-report.json` 为准；文件不存在或严格检查失败时为 NOT_READY。

## 当前候选与历史

实施起点为 PR #19 合并点 `c1af81a86951054f4898f043c43381a5842abbf2`，tree `54969cbcd2785f62b562ac32aa431e16ee300bd8`。1056/171 和 SS-009 r7 的 1205/192 都是历史对照，不证明新增 runner。r7 在上述准确历史 checkout 执行原严格入口；新候选使用 SS010 检查。旧报告、旧迁移及父状态不改写，不生成 r8。

```powershell
node scripts/yxx-self-service-readiness.mjs
node scripts/yxx-self-service-live.mjs
node scripts/yxx-self-service-readiness.mjs --require-ready
```

前两个入口分别返回结构有效、模板未授权，均不访问数据库/Provider、不启动监听或运行角色。readiness 的 Git 子进程只读源码与提交身份。第三个入口检查本轮实际提交、完整回归、原始 TAP/trace、每文件执行、独立审查、截图与 AC-091～094。READY 仅是技术准备，不是现场许可。文档后继提交允许保持被测祖先和相同候选指纹，不把文档 HEAD 重绑为被测源码。

## 唯一 App 与后台职责

| 角色 | 职责与上限 |
|---|---|
| App | 原工作台、OAuth、成员 Web/API；pool≤4；FULL_SERVICE_LOOP 仅为内部组合方式，无 App Web 泵 |
| Worker | 既有 Worker 生命周期只挂接 Web processor；pool≤2；单次批量10、非重入 |
| Controller | 专用库身份、目录、单实例与生命周期检查；pool≤1 |
| Gateway / sender / AI / Incident / Bot intake | 不启动、不处理，无继承完整 G2 许可 |

原 G2 launcher 会启用 Gateway/发送，不适用于这个窗口。先验证 App 监听成功，再启动 Worker，双方就绪后统一放行；App readiness 使用真实 Worker 健康状态。整个窗口持续有时限和停写保护。进程退出、控制连接失效或停止文件触发收口。优雅停止超时只强制结束本次拥有的子进程，并报告失败。

公网成员 Origin 与内部坐席 loopback Origin 分开。现场只替换唯一 App；端口占用时拒绝，绝不自动杀掉既有服务。切换后内存 Cookie 不移植，成员须重新登录。内部坐席沿用专用库中明确批准的两个测试 principal；临时会话只写入私有 `sessions.private.json`，不得粘贴到 PR、聊天或截图。

## 精确代理范围

固定主页保持 `https://chengdu.mobimedical.cn/wecom/yixiaoxiu/`，Runtime 使用批准的 `public_origin`，不硬编码生产域名。

| 方法 | 可公开路径 |
|---|---|
| GET | `/wecom/yixiaoxiu/`、`/wecom/yixiaoxiu/reports`、`/wecom/yixiaoxiu/reports/new`、`/wecom/yixiaoxiu/reports/{request_ref}` |
| GET | `/wecom/yixiaoxiu/self-service.js`、`/wecom/yixiaoxiu/self-service.css` |
| GET | `/wecom/yixiaoxiu/login`、`/wecom/yixiaoxiu/callback`、`/wecom/yixiaoxiu/continue/{ref}`、`/wecom/yixiaoxiu/tickets/{public_ref}` |
| POST | `/wecom/yixiaoxiu/logout` |
| GET | `/api/yixiaoxiu/bootstrap`、`/api/yixiaoxiu/my-reports`、`/api/yixiaoxiu/requests/{request_ref}`、`/api/yixiaoxiu/requests/{request_ref}/timeline`、`/api/yixiaoxiu/commands/{client_command_id}` |
| POST | `/api/yixiaoxiu/requests`、`/api/yixiaoxiu/requests/{request_ref}/supplements` |

保持 public Host/Origin，转发到批准的 loopback App 端口；不能把 API 401 改成 OAuth 重定向，不能把主页永久跳 login。既有 `/api/reporter/` 仅沿用其单独批准的精确规则，不扩大为任意 `/api/`。`/workbench`、`/api/tickets`、`/api/manual-reviews`、`/api/contact-journeys`、SSE、health 和 Incident 路径均不加入公网代理。内部坐席使用内部通道和 loopback Origin。

## 专用库与迁移

仅支持 loopback PostgreSQL 上 `p2_015_ss010_<唯一后缀>` 命名的专用现场测试库，严格绑定名称、OID、连接身份摘要。不支持共享生产库，不自动建库、迁移、备份或清空数据。

首次运行要求业务为空，可预置批准坐席和目录。恢复仅允许同一 run 的批准 Web 事实，不接管旧 Bot 队列或其他运行数据。字段范围、Web来源、Ticket关联、零外部对象和数量均在事务提交时验证。并发新命令统一锁内计数；合法重放不重复扣额。一个新受理永久预留一个潜在 Ticket 名额，本窗口不回收，因此 `max_new_intakes <= max_new_tickets`。

现场前置操作分别批准：数据库连接/备份、033 应用、034 应用、业务写入、内部动作和后台处理。现有迁移脚本一次应用缺失的 033/034，所以在 032 库执行 apply 必须同时覆盖两项许可；不能仅持有 033 许可就执行该命令。`--check` 会在事务内执行 DDL 后回滚，也需要专门的数据库/DDL检查许可，不是离线检查。runner 仅核验 034 最终 catalog 和两个 marker/checksum，不调用 apply/check。

数据库与受保护 state 目录、批准文件应一起保留和备份；存在 Web 事实却丢失 state 时拒绝恢复。不得删 state 重新开始以重置配额。停机重启使用同一 manifest、配置、数据库与 state，配额继续从实际持久收据计算。错误库、配置变化、计数倒退或清理失败均阻断恢复，不手改状态伪造通过。

## 授权文件与受保护配置

模板是 `config_examples/yxx-limited-write-authorization.example.json`。全部 false/null 表示未授权，保留原 A/B 模板。正式申请填写候选发布 commit/tree、源码指纹、相同 App 版本、配置摘要、身份证明、数据库身份、仅 A 或 A/B 的保护映射、两个不同的获批坐席、时间窗、总量/每成员配额、负责人及回退依据。

配额建议由负责人裁定，例如总受理6、补充8、潜在Ticket6；模板不预批准数值。时间窗最大65分钟是本工具上限，不是正式60分钟观察认证。发送与父 G2许可必须始终 false。

独立批准记录为 JSON，包含 `kind=SS011_LIMITED_WRITE_APPROVED`、`run_id`、`scope_sha256`、`candidate_commit`、`owner`、`approver`。`scope_sha256` 由 `approvalScope(manifest)` 计算，排除批准记录路径/自身摘要；其余字段（包括配额、窗口、成员、数据库）全部绑定。记录原文 SHA-256 填入 manifest 的 `approval_record_sha256`。这只是完整性绑定；批准记录必须由负责人经受保护渠道提供，工具不会替负责人签发批准。

单独的私有 env 文件只接受以下五项，不加载通用 `.env.pilot` 的旧 live 开关：

- `PILOT_DATABASE_URL`
- `YIXIAOXIU_MEMBER_TICKET_ENTRY_CONFIG`：既有 config envelope 的绝对路径，仅含批准的 A 或 A/B 的 `VERIFIED_DELEGATED_MAPPING / LIVE / DEPLOYMENT`，userid 数量须与 alias 一致
- `APP_SECRET`
- `P2_G2_REPORTER_HMAC_SECRET`
- `PILOT_LOG_IDENTITY_HASH_KEY`

配置摘要由 `limitedConfigurationDigest({env,member,manifest})` 计算；只输出摘要，不输出配置或密钥。实际账号、窗口、配额、库、端口、备份、负责人和审批记录本轮不填写，保留待 SS-011 明确授权。

```powershell
# 以下路径均为占位符；不是本轮执行指令。
node scripts/yxx-self-service-live.mjs --check --manifest=<私有批准文件> --env-file=<专用私有配置>
node scripts/yxx-self-service-live.mjs --run --manifest=<私有批准文件> --env-file=<专用私有配置> --state-dir=<绝对私有目录>
# 仅在原窗口内、原文件及原库核对通过后，显式恢复：
node scripts/yxx-self-service-live.mjs --run --resume --manifest=<同一文件> --env-file=<同一配置> --state-dir=<同一目录>
```

启动前 runner 要求当前干净发布 checkout 与授权 commit/tree 精确一致，且 SS010 readiness 通过。窗口内 CTRL+C/TERM 或私有目录 `stop.request` 停止新写和新处理；已提交事实不删除，pending 不伪造完成。新窗口或新候选需要新许可，不能借用旧批准文件。

## 回退与现场顺序

回退已经验证的配置是本轮被测版本的 `MEMBER_SELF_SERVICE`，`MY_REPORTS_ENABLED=true`、`SELF_SERVICE_ENABLED=false`：无新受理/补充/处理，保留成员安全查询。该读取服务需要单独批准启动；停止 limited runner 本身不会自动维持读取。原 `MEMBER_TICKET_READONLY` 只支持旧 Ticket 读取，不能称作新的“我的报修”退路。更早二进制未逐版本验证，不列为可安全回退。

033/034 兼容性通过现有升级保护测试及当前回归验证；不删除迁移、不 down migration、不批量删除 Ticket。必要时以合法领域动作关闭测试工单。Git 回退并不回退数据库。

SS-011 未来按批准窗口操作：A/B固定主页认证→明确故障/缺字段/非报修/人工审核→本人补充→原内部坐席审核及生命周期→成员安全反馈→小数量同ID重放/跨成员拒绝→单独许可下恢复演练→对账→关写/停止→按批准恢复读取。真实受理只从网页/API发起，不能用SQL造成功。Web Message/Outbox/Delivery/Grant/Provider外发均须为0；允许的OAuth调用单列。失败、越权、错绑、超额或未经批准发送立即停止并保留事实。

## 本地验证与收口

定向测试包括 CLI 防网络/监听/运行角色钩子、错误批准和作用域、实际 PG 并发/重放/回滚、App/Worker启停、端口冲突且pending不处理、内部/public Origin分离、浏览器/原审核/安全反馈、只读切换与资源关闭。

冻结源码后使用 Node24 的 `node scripts/p2-g2-synthetic-e2e.mjs --suite=full` 串行完整回归。只保留一份本轮 TAP、trace、run 与必要截图；当前报告通过摘要引用，不重嵌全部原始回执。独立 SPEC/STANDARDS 审查和历史 checkout 检查各保存一份结果。失败日志保留在明确失败记录中，不能覆盖旧轮次。

完成条件是严格 SS010 检查 PASS、源码绑定和本地提交完成。远端 CI/审查为 NOT_RUN，SS-011 NOT_AUTHORIZED，P2-G2-LIVE 未启动，P2-008 阻断。发布 PR、合并、部署及真实现场仍待各自授权。
