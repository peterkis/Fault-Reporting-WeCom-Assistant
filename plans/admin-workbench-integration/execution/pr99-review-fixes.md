# PR #99 审查修补本地验证（2026-10-16）

本记录追加 PR #99 发布后修补的本地结果，保留[43 票原验收和审查记录](all43-final-review.md)。原被测提交、MF、历史证据、已完成阶段和现场授权均不重绑。远端审查、CI 和合并状态以 [PR #99](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/99) 的对应完整提交为准。

## 输入和结果

输入为已发布 `64f3c5da06077a6c1b517fdfe5f412df9ab6e94c` 的三项审查意见：[代录命令锁后现权](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/99#discussion_r4289825175)、[附件元信息返回前现权](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/99#discussion_r4289825182)、[Incident 内部记录返回前现权](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/99#discussion_r4289825188)，以及该提交 merge-check 的原浏览器失败。

- 代录的新命令、普通重放及 GET 最小回执，在等待后复核当前创建权和 Session。最终读取同时检查活动主体、原 ADMIN/DISPATCHER 或有效处理组 HANDLER、原有效期及适用的持久 Session；不提前持有 Session 长锁跨受理业务等待。原无持久 Session 认证分支保持可用，不能因可选 Session 表未安装而返回 500。原账本、同 UUID/载荷、savepoint、最小 DTO、原主体和用途保持。
- 附件元信息及内容沿同一事项的 canonical card READ，在最后语句同时核验当前角色、团队、Session 和截止。保留来源关联、留存、完整性、单操作及 lease 上限；失权时不返回元信息或后续保护字节。
- Incident 内部记录、交接候选、公开进展、投递及原命令回执，在数据查询等待后复核原用途、当前 READ、角色、范围和官方 Session。HANDLER 本人恢复回执保留精确 report/Incident/assignee 条件。正式 runtime 向 extension/query 透传原 Session 谓词。负责人身份不产生新权限。
- 浏览器用例读取状态单元格的首个正式 status-chip，保留独立“待复核”徽标语义；接管后补上现有 006 用例已经使用的投影 drain。原 HTTP、UUID、所选两个 Session、原子性、无部分变更、过期请求 409 和超时断言保持。

接口和业务依据继续使用[代录及回执](../../../docs/api/workbench/manual-reports.md)、[附件](../../../docs/api/workbench/attachments.md)、[内部记录](../../../docs/api/workbench/incident-internal-notes.md)原合同。没有新增迁移或 DDL；有授权读取 SQL 和内部装配类型增量，没有新增 REST 字段、事实表、持久开关、Worker 或外发路径。

## 固定候选和验证

| 项目 | 实际结果 |
| --- | --- |
| 被测提交 | `fcd021c729742bbd2fed7450e9e5c3bb28871838` |
| Tree | `30a955c64879800ed0167db735cf1ac414f6665a` |
| Source input hash | `efe35fb48eed9a75a3fdc4f661e9a7d5f06c565ec6ba03bbd1e2455a8f7618d0` |
| Build manifest SHA-256 | `9ae5a4c2540542dc4f1da3c22000891c4a0c741dba41b9408518af607b80b348` |
| 严格类型、正式构建和测试后制品核验 | native 0；802 个编译模块、2368 个产物；未激活 |
| 同一 manifest 的 stock 相关回归 | 15 入口、58/58 PASS；FAIL/CANCEL/SKIP/TODO/NOT_RUN 均 0 |
| 有限独立 Standards / Spec 收口 | 各 0；保留前轮 Spec P1 及后继修补记录 |

运行使用 Node 24、隔离 PostgreSQL 18.4、真实本地 HTTP 和正式前端制品。15 入口包括两个浏览器用例文件、代录风险及回执、核实受理、本人承接、附件和资源、内部记录、负责人、公开进展，以及四个直接合同/政策入口；精确列表见原始 selection。不是 full/current/certify 或现场验收。

本机原始记录根为 `D:/wecom-workbench-evidence/all43-publication-20261016/`。`ci-browser-fix/r4/051-delivery-manifest.json`（SHA-256 `912889abf5a6191b67c1d741e5d4e03e3e9823810ea22eb529de3c4344d05f03`）索引诊断、正式运行及清理原件；`r4/052-handoff.json` 的 SHA-256 为 `8b1478e5bea47195c860cfcbb8378b1fab7671093c7bbb62f6b52058e94e5aa2`。最新双轴报告分别为 `fix-review/standards/closure-fcd0.md`（`0ff6e3d5d18845ec5779bd893d3c8130fffbf0d055d08cdbca3e8d56ebd46c42`）和 `fix-review/spec/closure-fcd0.md`（`e08d52bae1765f82422f1a4a3d8a9febaa28f06b5adcd683857f14c1ead1b2ce`）。

保留原 CI 失败、真实 RED、setup 失败及中间正式运行的 FAIL/NOT_RUN。GET 的不可取得表锁是 setup 反证，其 RED→GREEN 使用真实 HTTP/PG 的受控查询结果等待门；普通 replay 的对应诊断使用实际 PG 表锁。受控跨秒证实旧 Control 晚投影会按原合同触发 `P2_G1_SESSION_REBUILD_REQUIRED`，仅用例增加同步边界。一项 DevTools 启动失败在两次有所有权的对照启动中未复现，不宣称已证明其环境根因。最终正式运行未改 harness、重试或超时。

## 资源、关闭和边界

停止前 fixture DB 和其他 client 均 0；自有 PG PID 20096 已退出，62775 监听为 0，`pg_ctl status` 为 3；keeper 为 STOPPED、pid 为 null、cleanup_passed 为 true。自有 browser/profile 均 0，PG 配置字节不变。清理原件 `r4/050-owned-cleanup.json` SHA-256 为 `49cc79232278c9b7b4e55515998ee96a2bd7e3dc4989ca20b182206a5637e9b9`。

沿原单 App/Worker、有限 PG 池、附件单操作/lease、SSE 32 及既有 deadline。全部持久开关仍默认 false；关闭方式沿各票原独立开关和宿主停止流程。没有真实 Provider/OAuth/WeCom 发送、业务库迁移、部署、现场或 Gate 推进。工作树和分支的合并后清理由本次发布回执另行记录；本记录不预称其已完成。
