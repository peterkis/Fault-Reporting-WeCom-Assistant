# MVP 通知与新 H5 后端：实施与验收

本记录封存本地实现和相关合成验收结束时的提交前状态。实现分支为 `codex/mvp-notifications-h5`，当时的基线及 HEAD 为 `df3823e4c045cf7fdc01f66abaf0fe43378a2086`；该 SHA 表示被修改的基线，不能代表候选字节。候选身份按下述构建清单及源码快照核对。后续提交、审查、CI、合并和清理记录另存同一证据根目录的 `publication/`，发布状态以本任务 GitHub PR 为准，不回写原始构建及验收报告。

本次未部署、未操作现场业务库、未修改 `.env.pilot` 或现场发送开关。新版 H5 页面未改。真实客户端收件和原生 @ 验收为 **NOT_RUN**；未执行手动 full、当前 certify、历史 certify 或 Gate 批准。

## 已实现的行为

| 范围 | 实际调整 |
| --- | --- |
| 群回应 | 复用分类器和可靠投递，按[固定行为表](README.md#固定行为)选择受理确认、私聊引导、致谢或静默；关闭旧群回执、追问和范围提示旁路。只有受理成功才确认；补充和原回调重放不重复首报确认。 |
| 人工接管 | 主题规则继续永久暂停。固定致谢例外同时核对当前原消息、纯致谢判定和固定模板；不修改 Ticket，不恢复其他规则。混合故障优先。 |
| 轮次通知 | `FIRST_HANDLING` 取每轮首次实际接单／开始处理；`STAFF_COMPLETED` 取工作人员完工。派单、转派和等待不发个人模板；重开沿原编号进入新轮。首责事件和既有历史保持。 |
| 群通知 | 只为存在准确 `botId + groupId` 路由的原群建立完工投递。发送前再核原来源、路由和留存；用完整业务编号、原报修人的原生提及。无 Webhook 正常跳过；个人投递独立。 |
| 个人模板 | Bot 和应用卡片均移除顶部渠道显示。已受理标题精确为“工程师正在处理你的工单”。内部来源保留用于路由和审计。 |
| H5 身份 | 显式选择 `VERIFIED_APP_OPENID`。使用现有 OAuth 身份和本应用当前成员核验，新 H5 成员无需逐人配置。开放身份与 Bot 原始 userid 分开，PC 权限不随成员准入扩大。 |
| H5 通知 | 服务端随报修保存不可变的应用收件绑定、命名空间与核验依据。通知定位独立于会话、退出和进程重启；发送前再次核当前成员。旧绑定、HMAC 与可选旧映射保持原语义。 |
| 等待和恢复 | 外部成员查询在业务事务外执行；一个实际查询、最多 32 个等待项、5 秒包含排队。等待后保留身份、来源与留存终检。UNKNOWN 继续人工核对，不盲目重发。 |
| 升级兼容 | 旧未尝试且不适用的通知经既有准入／取消机制留审计，不修改不可变正文。旧 SENT 和 UNKNOWN 保持，避免切换时重复投递。 |

前向合同为 [ADR-0034](../../adr/0034_mvp_notifications_and_application_members.md)。新增 [063 增量迁移](../../database/migrations/063_mvp_notifications_app_members.sql)，仅扩展原表的轮次节点与 H5 通知绑定。提供校验和显式应用入口，不随服务启动迁移。通用 Runtime 的持久开关默认 false；human-v1 装配显式选用 MVP 策略。现场切换和关闭方式见[运行说明](../../docs/runbooks/human-workbench-runtime.md#mvp-通知切换)。

H5 继续使用原报修、详情、补充、时间线和反馈 API；公开 DTO 不暴露通知收件目标。新版 UI 的登录、接口和验收约定见 [h5/README.md](../../app/h5/README.md)。本轮未新增队列、目录同步、规则平台或工单核心。

## 候选与验证结果

证据根目录为 `D:/wecom-workbench-evidence/mvp-notifications-h5-20261020`，下表文件均相对此目录。

最终候选为 **09**：

- manifest SHA-256：`cbc4d43e531147345bab48ce8e2b72ce36493aecb3011dea0091808e9846973e`。
- source input hash：`ec756c8758c257ce07a17eb399a2c15ec3a3ecca5ae46dfcbab0cc7c419b2892`。
- Node.js 24.18.0、TypeScript 5.9.3、隔离 PostgreSQL 18.4；合成数据和模拟企业微信边界。
- 沿活动 selection `v3-p09` 增加 4 个注册入口，未更换 selection 或 full／certify 合同。

| 检查 | 结果与证据 |
| --- | --- |
| 严格类型 | PASS，`types-final-09.log`。 |
| 最终构建 | PASS，`build-09.log`；828 个 strict 编译目标、351 个 legacy 目标、2427 个输出。保留原 Vite 大分块警告。 |
| 制品 | PASS，`artifact-final-09.log`；归档字节见 `candidate-09-proof.json` 和 `candidate-09-runtime/`。 |
| 相关业务 | 66 个已注册入口、175 项适用最新结果全部通过。`related-business-summary.json` 逐入口记录来源报告、源码及执行字节哈希，不把历次重跑累加为新增案例。 |
| 最终候选专项 | 6 个入口、22 项通过，含 4 项编译产物浏览器流程及三角色装配；`final-candidate-09/summary.json` 和原始 TAP／case trace。 |
| 文案 | `compiled-copy-contract.json` 核对编译产物的三个固定模板与 Bot／应用共用卡片；零 SDK 调用。该断言不代表实际设备收件。 |
| 文档／host／tooling | 相关 76 项通过，`tooling-scope-summary.json`。初次组合运行和后述独立失败全部保留。 |
| 文档与差异 | `docs-final.log`；收口再次执行文档检查、制品校验和 `git diff --check`，结果记入 `closeout-checks.json`。 |

175 项适用结果来自 `final-related-01/`、`t25-final-01/`、`ss010-mirror-final/` 和 `final-candidate-09/`。候选 08 到 09 只调整浏览器测试对已退役群回执的断言；所有生产输出、其他测试及资源字节相同，依据为 `candidate-08-to-09-delta.json`。这些结果为相关本地回归，不表示 CI、全库或正式 readiness 通过。

## 覆盖与证据对应

| 行为 | 主要已注册测试 |
| --- | --- |
| 群四类回应、混合故障、姓名缺失、补充、重放、接管后致谢例外 | `mvp-group-replies.integration.test.mts`、`mvp-application-member.test.mts`、`conversation-rule-admission.integration.test.mts`。 |
| 派单静默、实际处理、每轮一次、重开、旧未尝试通知取消 | `mvp-notification-policy.integration.test.mts` 及 T24 轮次、恢复和 UNKNOWN 回归。 |
| 两群准确路由、同名隔离、无 Webhook、群与个人分路恢复、发送前留存终检 | MVP 通知策略测试及 T26 群路由、留存、分路恢复、UNKNOWN 系列。 |
| 未列名 H5 成员、OAuth／当前资格、本人隔离、退出与重启后应用通知、数据库绑定不可变 | `mvp-application-members.integration.test.mts`、`mvp-application-member.test.mts`，及 T25、原成员自助回归。 |
| 内部备注隔离、原来源和收件匹配、撤权、外部等待后终检、拒绝跨应用和 UNKNOWN | T25、T26、原 P2-016／G2 发送测试和 MVP 策略测试。 |
| 编译装配、真实 HTTP／OAuth 会话、React 管理端、本人进度、反馈与丢响应恢复 | `human-workbench-process.browser.test.mts` 的 4 项；外部服务仍为本地模拟边界。 |

## 保留的失败与独立缺口

1. 初期 strict／夹具修复、未设置隔离标记、构建未完成即启动、缺少反馈迁移和错误 HTTP 状态预期均保留在 `types-*`、`tests-*`、`regression-*`。最终相关结果另表核对，未覆盖原 FAIL。
2. 旧 G2 测试未装配实际规则准入钩子，消息被正确取消而未进入 SDK。补齐测试装配后通过；未放松生产保护。诊断为 `diagnose-unknown.log`。
3. 浏览器旧断言仍等待已退役的群 continuation reference，发生超时。现按本轮固定回应核验，保留后续原报修人读取和反馈断言，最终 4 项通过；原失败见 `browser-final-01.log`。
4. 原目录含旧原型的忽略依赖，使 SS010 受限源码 inventory 超过既有 2048 上限。使用同一候选 08 manifest／source input 的干净副本，inventory 为 1841，SS010 六项通过；没有提高上限、改超时或删除原目录文件。证据为 `ss010-mirror-proof.json`、`ss010-mirror-final/`。同一 host 预检原有超时／inventory 拒绝，随后在该副本按原 15 秒预算通过，见 `hosts-clean-mirror-final.tap`。
5. 原组合工具回归为 83 项，76 通过、7 失败。相关 host 案例按第 4 项重验通过后，文档／host／tooling 的 76 项相关结果均通过；额外 `acceptance.test.mjs` 的 7 项中仍有 **6 项手动 full 计划检查失败**。基线已注册 716 项而其合同覆盖 239 项，基线本身缺 477 项；本任务只新增 4 项活动注册。`manual-full-baseline-drift.json` 核对 Git 基线，证明 checker 与合同内容仅有工作区换行差异。本轮不修改 full 清单、门禁或 workflow；未执行实际 full／certify。此缺口单独列入后续事项。
6. 候选 03 归档曾在构建完成前开始，缺失原 manifest。已用归档输出和原输入字节重建，两个原 proof 哈希均精确匹配，所有输出重新核验通过；`candidate-03-manifest-recovery.json` 保留恢复原因和身份，未伪装成原始无缺口归档。

## 归档与资源

保留原 `.build` 到 `baseline-build/`；候选 01 至 09 的完整运行时和证明分别在 `candidate-XX-runtime/`、`candidate-XX-proof.json`。`archive-verification-all.json` 核验 9 份归档各 2427 个输出全部匹配。`source-candidate-08/` 与 `source-candidate-09/` 保存改动源码及哈希，补丁和最终索引见 `evidence-index.json`。

自有 PostgreSQL 使用 loopback 55463、最大连接 20、64 MiB shared buffers。验收结束仅剩系统数据库且无其他客户端连接；已正常停止，端口无监听且 postmaster PID 文件消失。数据库目录保留为证据。见 `pg-before-stop.json`、`pg-stop.log`、`pg-cleanup.json`。编译三角色及模拟服务均已退出；没有额外注册 Git worktree，原演示服务未被停止。

自动审批审查先后拒绝了边界检查后的临时副本／缓存递归删除，以及仅删除依赖 junction 的更小操作，均在执行前返回 `blocked by policy`。未继续尝试删除。`ss010-clean-checkout/`、`tool-temp/`、`ss010-unowned-build/` 和副本依赖链接均保留；主工作区依赖保留。自有测试进程已停止。精确状态见 `owned-resource-cleanup.json`，不将其写成目录清理完成。

## 后续与关闭边界

- 新 H5 页面由用户另行设计，按接入说明验收；本次不改布局和内容。
- 当前候选的现场迁移、部署、真实客户端收件和群原生 @ 须单独执行并记录，不能复用旧版本的现场回执作为本候选证据。
- 单独修复手动 full 计划合同的基线清单缺口；本次相关验收不替代该工作。
- 临时副本与缓存待清理策略允许时处理；构建、失败、验收和历史证据保留。
- 关闭仍沿既有写入口及发送开关。已受理记录、本人只读、旧身份与投递历史保留；本次未推进 P2-G2-LIVE、P2-008、P2-G3、P3 或 Gate。
