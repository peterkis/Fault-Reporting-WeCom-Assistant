# P2-G2 自动化就绪报告

**READY_FOR_LIVE_E2E；正式Gate未通过，现场未运行。** P2仍IN_PROGRESS，最后完成任务P2-012、最后完成Gate P2-G1；P2-008仍阻断。报告随第二个本地准备提交保存，提交身份以仓库Git记录为准，不在报告中制造循环自引用hash。

## 候选和完整回归

- 冻结起点：`8c332710dad9b6cf3f6796f3344c04d1c710ddf3`；授权提交：`d7311cdbfe30c66f37d22a553a3e8f0e04e27cd1`。
- 当前业务候选：`17ebc9bc8862b88c1405663b57d290155086ff6cefa2bbae2ab26ac25f3ee54c`，564文件，SHA256_SORTED_PATH_CONTENT_UTF8_LF。清单为 `p2-g2-validated-candidate-inventory.json`。根目录文档/状态/证据属于治理输出，不是可任意排除的业务源码；`.gitattributes`仅保持G2证据原始字节不被Git换行转换。
- 受检命令：`node scripts/p2-g2-synthetic-e2e.mjs --suite=full`。实际runner参数、文件清单和每文件hash见 `p2-g2-full-regression-run.json`；包括冻结577基线的全部92个根目录测试文件、P2-007子目录测试和新增用例。
- **954/954通过，151个测试文件；fail/cancelled/skipped/todo均0，exit0，运行期间候选未变。** Node24.18.0，Windows10.0.26200/x64，PostgreSQL18.4，Edge152.0.4191.66；回归使用--expose-gc，未作自然GC60分钟结论。
- 完整TAP仅保存一份 `p2-g2-full-regression.tap`，SHA256 `884e95b112b4cb42d7e2e4841256c7f5c149957ea282b2f51dc715eb2e0de3dc`；原目录 `tmp/p2-g2-tests-e7e8038b-3c23-406b-b8a8-ac6b5da55098`。
- SPEC与STANDARDS独立审查均PASS、未解决问题0；记录 `p2-g2-review-spec.json`、`p2-g2-review-standards.json` 和 `p2-g2-review-summary.json` 均绑定同一候选、来源审计和矩阵。这些不是负责人现场批准。

首轮全仓948/935/13失败、定向RED/GREEN和中断保留，不覆盖原日志。全部231份本地runner记录索引为 `p2-g2-validation-run-index.json`，其中120份失败或不完整记录包括故意RED和测试方法错误；它们不作为就绪证明。最终修复与精确原因见 `p2-g2-final-regression-repair.md`。

## 来源语义与覆盖

`p2-g2-source-execution-final.json`对202条冻结来源逐项分账：122条正常输入场景和80条机制/其他引用；原始语料未改写。正常输入的安全断言和所需人工审核路径在当前TAP中均有执行依据。不能将这句话改写为“202条原始标签完全一致”或“100%分类准确”。

`p2-g2-classification-metrics.json`提供逐类混淆、原标签与裁定后指标：106条可比较末次分类中原标签一致59条（55.6604%）；裁定后单标签71/71、集合可接受性34/34分别报告。Ticket/Review完整日志分母为109，审核27/109（24.7706%）、自动建单88/109（80.7339%）；缺失/不可比较项逐条列明，不外推完整122场景比例。多轮、跨Reporter和人类命令场景不能强行压成同一个分类指标。

仍明确保留原语义差异：D12-005缺可靠非@ SDK标志；D12-023医院主身份属P3未实现；D12-016使用已验证URL Grant而非未实现卡片事件关联；D12-053使用Outbox替代回调回复。候选时间窗口仍为冻结120000ms，不能借原文300000ms或未知地点制造全院范围。独立裁决和缺省/UNKNOWN行为有原文、断言与当前结果依据。

`p2-g2-scenario-matrix.json`的37行均链接精确测试名、文件hash和证明层级；自动化VERIFIED与真实现场NOT_RUN分开。三入口、分段与同秒入站、显式新故障、身份/目录降级、ManualReview、Ticket全动作/双责任/幂等、Incident人工确认与独立恢复、订阅、通知、Reporter、SSE和故障恢复均覆盖。O01仅自动化工具/反例验证；正式2C4G自然GC60分钟仍未执行。

`p2-g2-pr6-review-invariants.json`将10条已核实PR评论的ID/URL/正文hash、准确不变量、场景和当前通过的测试逐项绑定；中间四条未凭编号猜配。P2-012历史现场和Owner Approval未改写，也未成为当前Gate现场PASS。

## 必要修复与边界

完整链路及实际模块/调用者/事务/持久表/Flag/权限/幂等/失败结果见 `p2-g2-service-chain-inventory.md/json`；36个旧源码/脚本/契约文件的逐项必要性见 `p2-g2-modified-existing-modules.json`。

- 明确故障先持久化再规则/人工，不走P1 eager-ticket与P2双管线。状态查询/业务咨询有可执行的人类兜底；规则或通知入队失败保留入站并可恢复。
- REQUEST_ONE_DESCRIPTION、App人工审核澄清、人工Reply、Ticket及Incident通知共同使用既有Direct Leg权威。无Leg时不生成不必要PERSON制品，首条允许的单聊仍可受理并建立Leg；SDK边界再次核对。实测RED/GREEN与零PERSON制品见 `p2-g2-assembly-hardening.md` 等修复记录。
- 三入口均能继续；群内可补充与结单，单聊可选。私人默认接单/结单，其余节点明确opt-in；重开后的新生命周期不承诺一生固定两次。群结单经指定Webhook @ 原Reporter，保持原Ticket/Outbox权威。
- 显式新故障和普通补充区分；Session起点采用原消息时间，处理跨秒不分裂Intake。晚到Conversation投影只补同事实链NULL引用，20项游标避免坏行饥饿，12路并发、失败回滚与既存Decision/Ticket不变均验证。
- Incident候选来自真实正常入站的有界可信事实；不跨人合并Journey、不自动confirm/link、不删除个人Ticket。未知目录/科室/位置不杜撰；成员资料失败不阻断受理。
- Provider数字ACK、客户端观察和负责人批准分别建证。UNKNOWN不盲重发；群回执重放不会重复插入。源文件、完整manifest、故障窗口及停止/对账顺序严格绑定。

无应用数据库结构或Migration变更，既有001–032编号范围文件保持不变；隔离自动化只运行既有迁移和受控故障。SDK1.0.6、pg8.23.0及依赖锁未升级。未向配置库或现场业务库迁移。

## 资源、隐私和操作

业务角色App/Worker/Gateway各1，连接池4/2/1，控制器另1；SSE32、batch20、窗口50turn/20000字符、列表100。模型Key不进入测试角色，AI/OCR/RAG调用0；必要数据库/回环HTTP/Mock WSS与模型网络拒绝分开。持久Feature Flag全部false。

现场操作手册为 `../prompts/P2-G2_rule_first_service_loop_runbook.md`：六段PowerShell示例已语法解析，CLI --help、无参拒绝和无批准前SDK/写库/监听拒绝已有测试。涵盖预算、三角色启动、capture/故障、资源观察、只读对账、64独立证据stream、客户端延迟实测、最终回归和负责人独立声明。现有Windows浏览器测试不可假称在Linux跑过；跨主机证据保留原run路径/字节hash/OS信息。

此前授权的云端基础实例和停止态包有独立部署记录；新候选静态发布核验记录另行保存。云端静态检查不等于业务激活、HTTPS可用、空业务库就绪或完整2C4G现场通过。

本run资源按ownership关闭与核对；较早自动审批拒绝删除的 `p2-006-browser-kOkGl8` profile保持原状，未绕过策略。历史Temp与故障日志保留不等于仍有活动业务进程。关闭方式为停止本run角色、撤除临时许可并保持持久Flag false；不down migration、不清历史Delivery、不广域清理。

**停止线：READY_FOR_LIVE_E2E。** 真正的WeCom发送、现场业务写库、60分钟观察、客户端确认和负责人Gate批准仍需独立许可；P2-008、P2整体GO、生产上线及push/PR/merge/tag/release不由本轮授权。

云端更新已完成：`/opt/fault-reporting-wecom/p2-g2/releases/prep-17ebc9bc8862-e12a6d4b`，651文件逐项校验和断网READY证据重算通过；Nodev24.20.0，无参live按预期exit2。新记录 `p2-g2-cloud-ready-deployment-record.json`；临时上传和本次容器为0，业务未激活。
