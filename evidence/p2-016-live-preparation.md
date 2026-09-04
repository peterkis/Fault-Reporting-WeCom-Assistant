# P2-016 本机现场准备记录（未完成验收）

- 日期：2026-09-04，Asia/Shanghai。
- 负责人已明确授权本机 PostgreSQL 临时测试库、由代理创建本次审批变量、按现场手册测试并删除测试库；随后指定复用 `.env.pilot` 的测试群/用户，并要求本机搭建 Reporter 地址。
- 该授权是测试执行授权，不是对未发生的客户端结果或最终任务完成的批准。
- 候选仍为 `0ecff720b9f5119895fcfa0a954131d3c43ccfdde191689ea7eb4d3b9c287f6a`；HEAD 仍为唯一授权提交 `3599fa479c752ed75cd4652e5ffdaee2b212ad24`。

## 已验证准备

1. 正确读取既有 `PILOT_TEST_GROUP_ID` 与 `PILOT_TEST_ACCOUNT_USER_ID`，在内存中计算两个目标 hash。没有把原始 ID、Secret、Cookie 或 Token 输出到日志/Evidence。最初按 P2-016 新字段筛选未发现这些旧命名，用户提醒后已纠正。
2. 使用本机 PostgreSQL 18.4 的全新 template0 数据库；基线迁移至 031、精确 catalog 校验通过，创建两个合成 ADMIN 测试坐席；未复制原数据库业务记录或临床数据。
3. 复用一个现有、未过期且系统信任链有效的 localhost 证书；PFX 和密码仅在进程内传递，未写磁盘，未修改信任库。
4. `https://localhost:44316` 仅监听 127.0.0.1，仅转发 `/reporter/*` 和 `/api/reporter/*`。内部 Ticket API 与 health/metrics 在 HTTPS 代理返回 404；没有开放公网。
5. Chrome 实际加载 Reporter HTTPS 页面，无证书警告；无 Grant 时显示访问失效，未获取工单数据。尚未验证企业微信卡片点击的 fragment exchange。
6. 三个 P2_016 审批变量仅在该次进程中设为 true；完整 live preflight 为 PASS，批准个人/群各 1，临时库无范围外业务数据，Gateway 成功认证。仓库及 `.env.pilot` 的业务 Feature Flag 默认值未改变。

## 未完成的运行

运行 `176f6392-74bb-43bb-82f3-97e31ce1be82` 自 12:48:51 开始，留下 31 次资源采样，最后采样跨度 466,164 ms。该次没有 Intake、Delivery 或业务消息发送；Gateway 认证成功不代替真实客户端通知验证。

控制台没有保留标准输入，`gateway-disconnect` 控制词未送达。因此终止该次空载运行；不是 15 分钟完整观察，不是现场 PASS。之后独立验证了带 TTY 的控制输入能接收 `stop` 并正常退出。

发送现场测试消息前，computer-use 技能要求一次具体的发送前确认；已向负责人询问专用测试群/账号的合成报修、引导、卡片与状态通知，等待确认。

## 清理结果与限制

- 准备校验库 `p2_015_p2016live_696926ce_71bc_4c4b_b08f_7c66d0292417`：已删除，数据库/连接残留均 0。
- 空载现场库 `p2_016_live_2ea91b1a_34fc_4d6a_8736_433e123a196f`：在校验精确名称及非 template 身份后删除，数据库/连接残留均 0。
- 本次 Node 角色/控制器和两组测试 Edge 进程已停止；43116/44316 监听均为 0；进程内审批、HMAC 和 TLS 材料随进程结束失效。原数据库和证书未删除或修改。
- 两个本次 Edge 临时 profile 目录的删除被工具策略阻止，未换工具或方式绕过：`C:\Users\zqpet\AppData\Local\Temp\p2-g1-live-browser-xDFBjC`、`C:\Users\zqpet\AppData\Local\Temp\p2-g1-live-browser-sVILRz`。它们仍保留；不声称文件系统全部清理。
- 后续不得通过既有浏览器 helper 的全局 stale-profile 清理间接删除上述被阻止的目录；应先解决清理授权/策略，或使用不触碰它们的独立测试驱动。
- 9 月 1 日的四个既有 p2-006 临时目录保持不变。

状态仍为 READY_FOR_TARGETED_LIVE_VALIDATION。未创建第二提交、未推送、未标记 DONE；P2-012/P2-G2/P2-008 未启动。当前 Reporter 地址已随本次中止关闭，不能视为持续运行的服务。

## 后续真实运行（2026-09-04）

负责人随后确认了专用测试消息并允许 Chrome DevTools。运行 `eaf9e6fe-86bd-49de-b185-321ae4b0e7fb` 已完成 16 分 58.504 秒观察：实际卡片显示、企业微信内置 Reporter fragment exchange、状态通知、内部备注隔离和群/个人引导均有现场观察。群到单聊的 Journey 关联失败，故不是现场 PASS；UNKNOWN 现场故障核对尚未执行。

该轮临时数据库、进程、监听及测试 Reporter 窗口已清理；两个之前被策略阻止删除的 profile 保持不变。完整结果和限制见 `evidence/p2-016-targeted-live-validation-2026-09-04.md` 及同名 JSON。本节追加新事实，不改写前述中止运行记录。
