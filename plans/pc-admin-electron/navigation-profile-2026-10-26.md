# 标签切换缓存与报修人资料核对

2026-10-27后继：下文诊断出的Bot采集、补全与Ticket资料留存问题已按用户要求修复并部署，资料完结后也持续保存。目标工单IT-20261019-0003已补齐姓名／部门；详见[工单资料修复记录](reporter-lifecycle-2026-10-27.md)。下文保留2026-10-26缓存修复时的对象、失败与当时未完成状态。

日期：2026-10-26。后继于[看板性能修复](board-performance-2026-10-26.md)。本轮目标是修复切回工作台时的资料闪回，并核对处理中工单缺少姓名、部门的原因。服务器发布沿同一会话中对 `cd3120.mobimedical.cn` 的具名授权；不创建真实试单或测试发送。

## 原因与修改

- 工单看板使用 TanStack Query 的既有缓存。真实 HTTP／PG18／编译页面复现中，离开再返回时，即使三列刷新请求尚未完成，9 张卡片仍保留，未复现整个看板缓存被清空。
- 独立的 `reporter-profile` 查询设置了 `gcTime: 0`。组件卸载后资料立即被回收，返回时先显示“报修人姓名未提供／部门未提供”，随后重新请求。合成资料边界的 RED 复现为：6 张卡片保持，姓名从可见变不可见，资料请求从 1 次增加到 2 次。
- 将报修人和当前员工资料 Query 的 `gcTime` 设为 300000，与五分钟 `staleTime` 对齐。只在内存保留，继续按员工、授权版本及相应工单隔离。业务刷新、权限拒绝后的清理及退出清理保持原合同。会话聊天的 `gcTime: 0` 保持不变。
- 首轮 GREEN 复现：6 张卡片及已解析姓名一直可见，未出现缺省文案，报修人资料仍仅请求 1 次。相关缓存语义见 [TanStack Query 官方缓存说明](https://github.com/TanStack/query/blob/main/docs/framework/react/guides/caching.md)。

## 处理中资料核对

对现场来源只执行只读查询，不输出真实姓名、部门、身份标识或凭据，不回写历史资料。当前两条处理中记录为：

| 工单 | 核对结果 | 状态 |
| --- | --- | --- |
| IT-20261019-0001 | 人工代录；保留期内的人工快照已有姓名、部门 | 已有来源资料 |
| IT-20261019-0003 | 历史 Bot 来源；来源与 Journey 已过保留期；没有可用姓名、部门快照，没有 Web 绑定或关联 H5 来源 | 历史资料缺口，尚不能补出姓名、部门 |

用户已确认缺失卡片编号为 `IT-20261019-0003`。继续核对工单详情的 `reporterContact` 路径：历史资料和当前目录回退都要求 Journey 与原始 Intake 尚在保留期内；该记录不满足此条件，不能通过另一读取入口恢复资料。编号疑问已关闭。下文继续调查确认了系统装配与资料生命周期缺口，因此此前“仅为历史资料缺失、需要人工补录”的解释不完整；本次缓存发布没有修复这些后端缺口。

### 用户追问后的根因核对

用户指出“来源和联系人资料应该在和 Bot 建立会话时自动记录”。本次仅做诊断，不修改现场数据、保留策略或运行代码。现场只读结果与当前部署的三个编译文件哈希已核验，原件为 `.local/electron/navigation/profile-lifecycle-01.stdout`。

| 检查项 | 事实 |
| --- | --- |
| 来源与身份 | 原始消息记录存在，源报修人身份已记录，1个Channel Leg关联1个Conversation Session；没有输出身份原值 |
| 工单建立 | 2026-10-19 22:36:47（Asia/Shanghai） |
| 原消息／Intake／Journey保留截止 | 2026-10-20 22:36:46，继承原入站24小时保留期 |
| 当前工单／Journey状态 | `IN_PROGRESS`／`TICKET_LINKED` |
| 人员资料 | `profile_resolution_status=DEFERRED`，`profile_snapshot={}`；不能将其表述为已证明曾成功取得后又被删除 |

确认的当前实现问题：

1. **Bot人员读取没有装配。** `app/server/scripts/human-workbench-role.mts` 的 Worker 创建 `createP2016OrchestrationWorker` 时未传入 `directoryPort`。沿 `p2-016-orchestration-adapters.mts` 进入 `createRuleFirstOrchestrator` 后使用 `DeferredDirectory()`，返回 `DEFERRED`和空快照。对已编译默认适配器的独立探针也得到同样结果，外部调用为0（`default-directory-probe.log`）。当前入口的新Bot报修同样存在这一缺口；当前姓名显示接口和H5展示资料能读取，不代表Bot Worker已接通资料读取。
2. **Bot缺少首次失败后的补全链路。** `createContactJourneyStore.ensureJourney` 遇到已有Journey直接返回，不把后续查询结果写入；这是既有不可变报修时快照合同的行为。当前唯一独立补全器面向H5来源，不能据此声称Bot有自动补全。修复应区分原始报修时快照与后来获取的当前资料，保留来源和取得时间。
3. **工单所需资料与原消息保留期耦合。** `p2-g1-human-only-assembly.mts` 默认入站保留24小时，Intake继承原消息截止，Journey继续继承Intake截止。看板和联系人查询随后按该截止拒绝读取，没有针对仍未完结Ticket的必要联系资料生命周期。该缺口已在这条未完结工单中实际出现；即使首次资料读取成功，也会受同一读取截止影响。

纠正方向：接通具备正确Bot身份命名空间的资料读取Port；首次获取失败不阻断受理，但应有有界补全与可观察状态；工单必要来源／姓名／部门资料应独立于原始聊天消息的保留期，并覆盖未完结阶段。既有快照不可变和留存合同需同步形成明确变更，不能通过直接延长过期行或覆盖历史快照代替。上述为已确认问题与修复边界，**尚未实现或部署**。

## 候选与验证

分支 `codex/pc-admin-electron-mvp`，基线 HEAD `3bd9f037af6933f3717a95e173cacfcd0ea4bd4e` 加本地差异；原有改动保留，未提交或推送。

- manifest SHA-256：`ab88a1316dad2459f5bf34a901e0e23369191a647bfb10194798b9da39595e60`。
- source input SHA-256：`49088c417bbd562dbb5cf8fe0b3b18b0b59e2ea5de96a92df86fbf739b4d905d`。
- 统一构建：880 typed、351 retained legacy、2648 outputs；strict 与负向类型检查通过。
- 新增维护用例：连续两次切换工作台／会话；挂起真实看板 GET，断言卡片、报修人及当前人员资料保留、资料请求不增加；最终模拟 READ 403，检查缓存内容从页面清除。看板数据来自真实 HTTP／PG；资料 Provider、其前端能力及最终拒绝响应为合成边界，此项不冒充现场身份验收。
- 已注册定向入口：`tests/wbint-t38-realtime.browser.test.mts`（2项）、`tests/wbint-t38-offline.browser.test.mts`（2项）、`tests/web01-workbench.browser.test.mjs`（9项）、`tests/yxx-h5-v2.integration.test.mts`（2项）、`tests/p2-016-workbench-wecom-auth.test.mjs`（4项）。合计19／19 PASS，0 FAIL／SKIP／NOT_RUN。制品验证与当前候选 manifest 一致。
- 文档链接与预算检查 PASS，文档工具19／19 PASS。服务器新目录内的隔离组件检查28／28 PASS。

原始证据：`.local/electron/navigation/`；正式定向报告：`D:/CodexEvidence/workbench-navigation-20261026-1793021547218/`；发布收据：`.local/electron/deploy-navigation-20261026/`。

保留原失败：初始复现夹具未启用会话入口，未进入目标路径；随后修正夹具并取得 RED。首次新增测试构建发现浏览器实例可为空的 strict 错误，补充显式存在断言后构建通过。首次发布因新脚本残留旧容器名而被 Docker 拒绝创建，发生在停止旧服务之前；核验旧进程和监督配置未改变后，将失败收据移存 `activation-first-failed`，使用独立新名称完成第二次发布。首轮中间 GREEN 与最终候选分别记录，不改写 RED 或失败。

## 发布、资源与后续

发布状态为 `PASS_ACTIVATED`，活动容器 `human-workbench-20261026-pc-navigation-01`，运行目录 `/opt/fault-reporting-wecom/p2-g2/pc-navigation-20261026-01/runtime`。29项ready通过，桌面入口302到官方扫码地址，匿名API401，H5页面及上一版资源200。42个私有配置文件、8个媒体文件及数据库业务计数均保持；未执行迁移、真实试单或测试发送。旧容器 `human-workbench-20261026-pc-board-01` 已停止并保留，回退脚本及原监督配置均留存。

任务自有PG18（52681）恢复4个初始库、0其他客户端后关闭；原PID消失、监听为0，并完成独立复核。`pg_ctl status=3`表示已停止；外层首次继承该退出码的现象保留，关闭收据与二次进程／端口检查均PASS。测试数据目录和日志保留，不称文件全部删除。

客户端版本仍为0.1.2，本轮页面更新不需要新安装包。用户当前打开的客户端和未保存输入保留；重新打开客户端后才加载新页面，本轮现场用户验收尚未完成。full／certify、远端CI／审查、Gate批准均NOT_RUN，不推进P2-G2-LIVE、P2-008、P2-G3或P3。
