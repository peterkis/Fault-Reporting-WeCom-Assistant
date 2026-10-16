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

## 第二轮审查修补（追加）

已发布 `56e47ba1a2eeedad48788c01ddf27a10abc9438e` 的第二轮审查指出[最终 Session 漏空闲期限](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/99#discussion_r4290356398)及[核实重放的后续目录等待](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/99#discussion_r4290356404)。同提交的 Linux merge-check 在启动浏览器前，被三条仅适用于 Windows 的 D 盘断言拒绝。

代录现由正式 runtime 透传同一官方 `currentSessionPredicate`，在认证及最后创建权 SQL 中核对配置的 idle TTL、原绝对截止、活动 Session 和主体；最后语句同时核验原创建角色或有效处理组。末端 Session share-lock 后仍用新语句复验物理时间，不提前跨受理等待持有锁。无持久 Session 路径仍不引用可缺的 Session 表；真实 Session 缺官方谓词时失败关闭，没有硬编码生产 TTL。

核实命令先取得 ADMISSION、随后输给同主体/用途/UUID/正文的原提交时，仍按原保留目标执行 READ_COMMITTED。在第二次目录读取、原目标查询及 hash 核验之后，再检查当前创建权和官方 Session；证明围栏位于最后等待之后。退出后的拒绝不改写原 COMMITTED、目标、证明或 UUID。同一现权 helper 也覆盖候选目录返回和核实新提交后的读取。

活动 selection 中七个浏览器文件的九条 D 盘断言仅增加 Windows 条件；Windows 继续拒 C、允 D，其他宿主使用原临时目录。编译树身份、业务断言、超时、截图和清理保持。没有迁移/DDL、REST 字段、默认开关或外发路径变更。

| 项目 | 本轮实际结果 |
| --- | --- |
| 被测提交 | `16588ca82b9fc6ea879224830a3639763e0402bf` |
| Tree | `3ea756401d309ed6a5b7b8150e3961e80445b443` |
| Source input hash | `5a82603cc652706c181ca8cad13f3e59a94e7c685b088f1ddfd18b03fe8258df` |
| Build manifest SHA-256 | `7de0fe209175ff34b01934ff5d40920106f5b23b943f9ec63239c35bfee03846` |
| strict / 一次 build / 测试后 artifact | native 0；802 个编译模块、2368 个产物；未激活 |
| stock 相关回归 | 13 入口、40/40 PASS；FAIL/CANCEL/SKIP/TODO/NOT_RUN 均 0 |
| 独立 Standards / Spec | 各 0；固定差异为 56e47 至 16588 的 11 文件 |

同一 manifest 的正式运行覆盖七个实际浏览器文件、T17 风险及最小回执、T18 核实边界/候选/受理和 T19 本人承接。沿 Node 24、隔离 PostgreSQL 18.4、真实本地 HTTP 和正式制品；未重复源码未变的附件/Incident 回归，不称 full/certify。完整 Linux 浏览器留待对应发布提交的实际 CI，不把平台谓词诊断称为 Linux 业务通过。

本机原件在 `D:/wecom-workbench-evidence/all43-publication-20261016/ci-r2-fix/`。`final/026-validation-manifest.json` SHA-256 为 `e0e1e835c5eb5051f0399b31d6f6aad660ceb3e995ad5c841ee501444209cca7`，`final/027-handoff.json` 为 `00172dc96d44aa3a665e55c15d55614caa65d5057db9d0340afefb04120bc705`。空闲超时两例使用真实 PG 回执表锁；并发核实两例使用两条真实 HTTP 命令及受控 Directory/查询结果等待，另有候选查询退出一例，均先 RED 后 GREEN。012/013 因首次等待占用目录单并发名额、原提交返回 503，明确属于 setup 反证，不计产品 RED；未放宽产品并发上限或降低原提交 202 断言。

按用户要求，本轮另用 Open Code Review 委派模式，由当前 Codex 主代理承担模型复核。OCR v1.12.12 的预览将全部 `.mts` 列为 `unsupported_ext`，即工具过滤的 reviewable 为 0，不能作为通过依据；本次独立 D 盘规则可为全部 11 路径解析 TypeScript/仓库规则，仍不能覆盖其扩展名过滤。主代理按原固定 Git 差异补审全部 11 文件，跳过 0、覆盖 100%、无新增发现；未配置外部模型端点、密钥或修改全局配置。原预览、规则及逐文件清单保留在 `ocr-r2/`：`report.md` SHA-256 `0fac495428cb44cc89796c1a393fc07ba7eb8747b12880eaa2cde25dab5a2ec7`，`result.json` SHA-256 `5ec3b871682e6f5d9f347ef051e7dc3f0c9e56d0e5ab98a7d0a9b602bfa422a8`。两轴原报告 `fix-review/standards/closure-r2.md` 为 `6e00983a83a212697969ad1956da98278d7941e70129952149e096c234c26491`，`fix-review/spec/closure-r2.md` 为 `f5ae4b72e84cf9ca2c076186089a728a91058d7ca4bd035f33fb7301d2b99df9`。

本轮 PG PID 25420 已退出，62775 监听、fixture DB、其他 client、自有 browser/profile 均 0；keeper 为 STOPPED、pid 为 null、cleanup_passed 为 true，PG 配置字节不变。`final/025-owned-cleanup.json` SHA-256 为 `58b81851f9dc6c7b2dc3118aa61473bb5d7a53449bf3cced21e3210ca8810270`。本节只追加本轮结果，保留上一轮 fcd0 及原43票的被测祖先、manifest、失败原件和停止线；远端复审、CI、合并及最终分支清理仍以对应发布回执为准。
