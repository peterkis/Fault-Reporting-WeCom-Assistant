# P2-016 自动化就绪报告

- 日期：2026-09-04（Asia/Shanghai）
- 状态：`READY_FOR_TARGETED_LIVE_VALIDATION`，活动任务 P2-016 / Lane P2-B。
- 本文件不是完成报告、真实现场 Evidence、负责人批准或 P2-G2 验收。

本报告保留现场前自动化快照；下文及 JSON 的 `live_validation=NOT_RUN` 描述生成快照时的状态，不代表后续没有现场记录。最新现场技术结果（46 分 20.329 秒观察及隔离库清理）见 `evidence/p2-016-targeted-live-validation.md` / `.json`；现场后最终 533/533 回归见 `evidence/p2-016-post-live-regression-report.md` / `.json`。负责人最终验收仍待确认，任务继续 READY。旧快照、旧失败和中断结果不改写为后来的成功。

## 已验证结果

全量命令：

```powershell
node --expose-gc --env-file=.env.pilot --test --test-concurrency=1 tests/*.test.mjs
```

修复后实际结果：533 tests / 533 pass / fail=0 / cancelled=0 / skipped=0 / todo=0，exit=0，耗时 598,149.0886 ms。覆盖 P1-005/006/010/012、P2-002/003/004/005/006、P2-G1、ARCH-005、P2-007、ARCH-006、P2-015 和本任务。没有跳过 PostgreSQL、Browser 或 Sender 测试。全量先校验实现/Contract，再生成报告并运行默认的完整 readiness 校验，避免要求测试预先拥有自身的未来收据；现场默认门禁没有被跳过。

此前全量尝试为 522/523，通过浏览器切换新工单后的唯一编号就绪检查修复 1 项导航时序失败；另增确认表单编辑期间不被 SSE 刷新覆盖的测试。本次完整绿色结果取代该失败尝试。

此前 530/530 对应旧候选；该候选真实现场发现群转单聊 Journey 关联失败。修复后首轮 531/532 仅失败于旧 readiness 指纹，第二轮才取得上述 533/533。失败记录不改写为通过，详情见 `evidence/p2-016-guided-journey-repair-2026-09-04.md`。新增回归从真实形态入站开始，通过公开 Journey/Channel Leg 查询核对关联及已记录入口模式。

已实现并验证：人工复核查询/决议与安全动作事务；完整 Ticket Action、转派及双责任复合命令；Reporter 单次 Grant/单工单只读 Session；Ticket Event 驱动可靠通知；模板卡片 Sender；实时 refetch/轮询；严格入站/出站范围与受控现场入口。页面是原生 Internal Beta，不引入框架、CDN 或依赖。

真实原生浏览器覆盖 1440×900 / 390×844、完整坐席工单动作、人工复核、刷新、SSE/轮询、XSS/CSRF、认证过期，以及 Reporter fragment 清除、HttpOnly Cookie、刷新/退出和三时区一致性。Codex 内置浏览器桥不可用，采用仓库既有 Native Edge/Chrome 测试机制；未用合成客户端冒充真实企业微信。

## 固定候选与提交边界

- 分支：`phase2/p2-016-ticket-lifecycle-workbench`
- 基线/main/origin-main：`b1b8e4deb14e6290ca45aea12d92baaef4728c11`
- 唯一授权提交/HEAD：`3599fa479c752ed75cd4652e5ffdaee2b212ad24`
- 代码与测试指纹：`3752596720f20524ff989ee9cf913b9e104e32a4c2095c48fc83804e7e75f863`
- 指纹范围和可机读结果见同名 JSON。状态/说明/Evidence 不计入运行输入指纹；改动运行输入后必须重新验证，现场预检会拒绝旧指纹。

首个提交仍仅含 P2-016 授权与 P2-015 历史账本纠偏。其 Evidence 不变；P2-015 的既有完成报告与实现提交不改写。第二个实现提交、push、merge、tag 均未执行；实现文件保持未提交，索引未暂存。

## 存储、资源与恢复

031 仅新增六张辅助表：命令收据、Reporter public ref/grant/session/audit、通知绑定。精确 catalog 为 84 columns / 145 constraints / 38 indexes / 24 FK / 0 user triggers，指纹 `5521c4fc34481ef22e46cab4e0f3e1fdea232c995cef2f823008d0ea9142fb20`。隔离库 apply、check rollback、重复执行和七类 drift 检测均通过；历史 001–030 不变，无第二个 Ticket Core。

容量：500 Tickets、5,000 Events、200 次复核决议、500 张卡片加 400 条群回执、100 个 Reporter Session、32 个内部 SSE；第 33 个连接按契约拒绝。本轮分段 heap 峰值 69,518,216 bytes，GC 后 19,387,808 bytes，完整采样见 JSON；停止后 SSE=0。隔离数据库/连接残留=0。这是短时合成容量测试，不是 24 小时 soak 或真实 2C4G 硬件认证。

真正进程崩溃/重启验证了：提交后响应丢失的原命令重放；Provider 已调用而 ACK 未知进入 Reconciliation；明确未发送后只补发一次；ACK 后再次重启不重发。App/Worker/Gateway 三角色测试通过，池上限 4/2/1；现场控制器独占锁连接另占 1，总上限 8。自动化真实 SDK 调用=0。

## 兼容扩展与发现的修正

P2-016 复用既有事实源，通过以下窄接口扩展；不把它们称为 P2-015 重新实现或再次完成：

- P1-006：验证后的 assignment metadata 与冻结状态转换读取；P1-010：可选事务前锁，SYSTEM 关闭策略不变。
- P2-004：操作/核对支持调用方事务；修复真实拒绝后重试必须成对清空 send-started local/epoch 时间的问题。
- P2-005：调用方事务接管；P2-006：同一 HTTP/Auth 服务的受限 handler/static 扩展与 256 项实时授权窗口。
- P2-003：追加事件词汇；P2-G1：可选装配接口、分角色工厂和严格浏览器清理；旧默认行为保留。
- P2-015：DISTINCT UUID text 排序修正；额外 Leg 的独立决定窗口、人工允许动作、可选 claim 前锁/决策覆盖和优先级过滤。原首 Leg 幂等键与历史记录不变。
- 现场关联修复：入口分类识别开头的机器人显示名提及；后续消息使用已记录的 entry_mode。原始文本、规则输入、Provenance 和历史数据不改写。
- Realtime 发布适配器：按发布时钟保持 envelope 单调，原业务时间不变，不延长过期数据保留。
- OpenAPI：新增契约同时修正已有重复 component 与未闭合 pattern，避免新旧 API 文档无法作为有效 YAML 使用。

## 尚未通过的现场门禁

当前持久默认和实际配置 Feature Flag 均为 false；进程已停止，原配置无三个 P2_016 审批变量。负责人已经授权代理搭建临时本机测试库、创建进程审批、复用指定测试群/用户及本机 Reporter；这些材料只在每次批准的运行中生成，不写入持久配置。

旧候选已真实观察 16 分 58.504 秒，卡片、Reporter 点击和部分状态通知通过，但群到单聊关联失败；完整失败 Evidence 为 `evidence/p2-016-targeted-live-validation-2026-09-04.md` / `.json`。该次临时库已删除。新候选的 `live_validation=NOT_RUN`，不复用旧候选观察来宣称新候选通过。真实 UNKNOWN 核对、完整定向重跑和最终负责人批准仍待完成。

当前 `.env.pilot` 的只读迁移检查返回 `P2_016_REQUIRES_030`：该库没有 030/031 marker。未修改该库；需在批准的测试库准备并核验 030→031。这是目标部署前置条件，不否定 P2-015 的任务 DONE。现场预检还要求库内 Intake/Delivery 全属于本次批准范围，不接管或清空其他测试数据。

按照负责人委托，在新隔离测试库和进程内完成文档 61 的配置及三个审批后，才可执行：

```powershell
npm run p2:016:migrate:status
npm run p2:016:live:check
npm run p2:016:live
```

必须记录真实群回执/个人引导、卡片显示、HTTPS 点击、fragment exchange、代表性状态单次通知、Gateway 断开/重认证、ACK/UNKNOWN 核对、至少 15 分钟资源观察和明确负责人批准。fragment 丢失立即 BLOCKED，禁止 query token 替代。脚本只记录观察，不自动宣告客户端通过或负责人批准。

`LINK_EXISTING_JOURNEY` 保持禁用，因已有 Store 不支持迁移已绑定 Leg；可靠首次引导与同 Session 绑定有独立测试。它不是隐含跨 Journey 迁移许可。

## 关闭与下一边界

关闭三个新增 Feature Flag、停止本次 App/Worker/Gateway/浏览器；不做破坏性 down migration。依据负责人明确要求，临时合成测试库在运行后删除；保留脱敏测试证据。已有真实现场失败记录，但未创建虚假的现场通过、owner-approval 或最终完成报告。

P2-015=DONE；P2-016=READY_FOR_TARGETED_LIVE_VALIDATION；P2-012=TODO_REQUIRES_SEPARATE_AUTHORIZATION；P2-G2=NOT_STARTED；P2-008=BLOCKED_BY_P2_G2；P3 未启动。真实现场、负责人批准、最终完整回归和清理通过前，不标记 DONE，也不创建第二个提交。

状态同步后再次通过 V1.4 395 项检查、16/16 测试、P2-016 142 项检查、ARCH-005 全部禁止计数为 0、ARCH-006 260 项检查，代码指纹未变。live:check 按预期因缺少负责人审批返回 P2_016_LIVE_APPROVAL_REQUIRED，Provider/网络启动/监听均为 0。

最终核验：本次范围内 Runtime/Test 进程=0、隔离数据库=0、连接=0、43116/44316 监听=0、本轮浏览器 profile=0。4 个 2026-09-01 既有目录及两个此前被策略阻止删除的 Edge profile 未触碰。两轮回归的隔离 TEMP 根目录仍保留：首轮根目录删除被策略阻止，未换方式绕过；第二轮仅有非 profile 的测试/浏览器临时文件，未执行额外递归删除。不声称文件系统全部清理；该限制和实际根目录见修复报告。其他应用进程未停止。
