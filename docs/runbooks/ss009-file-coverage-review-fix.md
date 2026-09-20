# PR #19：测试文件执行覆盖 P2 修复

## 当前结论

两层代码缺陷均已修复，当前候选的 Windows/隔离 PostgreSQL/真实浏览器全量回归已实际执行。**r6 Binder、严格完成态和远端 CI 尚未完成，不能合并或声称全部 CI 已通过。**

- finding：Require an observed case for every listed test file；并修复 set-preserving file relabeling 可绕过文件来源校验的问题。
- 覆盖修复提交：`9bee25cab09ae10cd1e0d02c52db0364791818d9`、`f8213ba`。
- 产品测试提交：`01e0d79538afb0f4cf4eab1ba9364b344274ed28` 及当前 provenance 回归测试。
- 本轮代码候选指纹：`5c98ba04915c4891f1b4d55c64ab456305708e82ae279121c18d9cb33f466d85`；证据前缀已冻结为 `evidence/yxx-ss-009-r6-`。后续任何候选文件变动均须重新计算，不能照抄本值。
- r5 的 `91a6b21b...`、1182/1182 和原独立审查保留为历史事实，不为当前候选背书。
- 计划状态已设为 `LOCAL_REVALIDATION_REQUIRED / PENDING_CURRENT_CANDIDATE_EVIDENCE`，原 r5 指针显式标注 `HISTORICAL_R5_NOT_CURRENT_CANDIDATE`。

## 缺陷与最小修复

原来只检查每个观察到的 case 属于 `run.files`，以及 run.files 与候选文件清单一致；没有检查清单中的每个文件确实产生了 case。

`verifyYxxCaseTrace` 现在只在事件时间、成功状态、skip/todo、文件来源、名称和 nesting 均验证后记录该文件。最后计算所有未观察到的清单文件；存在缺失即抛出 `SS009_TEST_FILE_EXECUTION_REQUIRED`，并通过 `missing_files` 返回排序后的全部缺失路径。

原名称/nesting/重复次数多重集、未知文件、TAP、摘要、完成态、候选指纹、源 blob、祖先链及历史证据约束均未删除或放宽。Binder 与 strict 原来已共用此 helper，因此两个入口都获得反向覆盖检查。

仅依靠 trace 中可变的 `c.file` 与全局 TAP 名称多重集仍可把一个 case 跨文件重标，同时保持所有文件均被观察。新增 `scripts/p2-g2-file-coverage-reporter.mjs` 从 Node test runner 的文件级事件生成独立 `file_execution` 清单；runner 将每文件 `total/pass/fail/skipped/todo` 绑定到 `run.json`，helper 要求每文件成功计数与 trace 完全一致，失配返回 `SS009_TEST_FILE_PROVENANCE_MISMATCH`。

原正向单元测试夹具列出 183 个文件却把 1155 个模拟 case 都归到一个文件；本轮将模拟 case 分布到这 183 个文件，而不是删除文件覆盖断言。当前 15 项证据测试覆盖共享名称/乱序、整文件省略且计数一致、set-preserving 文件重标、多个缺失文件及 skip/todo 不能充当执行证明。

## 已观察到的本地结果

- 当前 full runner 目录：`tmp/p2-g2-tests-aaa2b731-7288-4fdb-ab70-7fc46b114259`。
- Node `v24.18.0`、Git `2.48.1.windows.1`、本机 PostgreSQL `18.4`；临时 env 从本机 `.env.pilot` 生成并在 runner 退出后删除，未使用生产网络或 WeCom 凭据。
- 全量实际结果：`1187/1187`，191 个测试文件，fail/cancelled/skipped/todo 均为 0，`candidate_unchanged=true`；`file_execution` 清单为 191/191，且已通过 helper 的每文件计数绑定。
- 15/15 SS-009 证据测试、历史 bypass probe、8 个架构/阶段检查器均通过；隔离数据库、浏览器、子进程 cleanup 残留为 0。

这些是本地当前候选结果，不是远端 CI、Codex APPROVED 或完成态证据。

对原 r5 证据的实验证据：

| 输入 | 旧严格入口 | 修复校验器 |
| --- | --- | --- |
| 原始 191 文件、1182 case | 接受 | 接受原始历史夹具 |
| 删去 `tests/p1-012-pilot-e2e-integration.test.mjs` 唯一 case；清单仍为 191、观察文件变为 190、case/TAP 变为 1181 | **错误接受，exit 0** | **拒绝，缺失路径精确匹配该文件** |

实验保留 `run.files`，同步修改 TAP 成功记录、顶层编号/计划、tests/pass 计数、trace、run 摘要、报告汇总与 source audit，并自底向上重算 29 个被引用产物的摘要。旧 CLI 确实接受这一完整变造结果，因此新版拒绝不是陈旧摘要造成的假阳性。

`.github/review/ss009-file-coverage-probe.mjs` 使用测试自有 worktree，不改主工作区、远端旧证据或生产数据。它固定历史原版和修复提交，并额外调用当前 helper；以后当前证据前缀切换到 r6 不会使这个历史复现失效。固定版本严格校验历史夹具，**不等于当前源码通过完整 readiness**。

## 当前为什么仍有红色 strict 检查

`src/yxx-self-service-verification.mjs` 和产品测试属于已定义的候选指纹范围。本轮改动后，r5 报告不再匹配当前候选。原 `--require-ready` 因此应继续拒绝；不应修改原 r5 的指纹、tested_head、测试数字、独立审查，或把新文件加入候选排除项来制造通过。

本轮已重新执行完整 Windows + 隔离 PostgreSQL + 真实浏览器全量回归；当前候选的两轴独立审查、Binder、tamper runner、最终 r6 证据、原 `SS009 published history` workflow 和严格完成态仍待完成。原严格命令没有被跳过、替换或设为 continue-on-error。

本轮的绿色 `SS009 file execution coverage` workflow 仅证明本 P2 修复与专项检查，不是合并许可。SS010、SS011、父 Gate、Feature Flags 和真实发送/部署停止线均不推进。

## 本地复核命令

在 Node 24、完整历史和记录的 CRLF 检出环境中：

```sh
node --test --test-reporter=tap tests/yxx-ss-009-evidence.test.mjs
node .github/review/ss009-file-coverage-probe.mjs
node scripts/validate-yxx-self-service.mjs
```

不要把最后一条结构检查替代为已经完成的严格验收。

## 恢复完成态的执行边界

1. 拉取本分支；保护未提交工作，不 reset/force-push。确认本轮修复及测试已保留。只使用本次测试自有的本地 PostgreSQL、Node 24 和项目支持的系统浏览器。
2. 本轮已将 `SS009_EVIDENCE_PREFIX` 切换为尚不存在的 r6，并在 `f8213ba` 后重新记录 HEAD/tree/指纹；**不要直接运行 Binder 覆盖 r5**。后续候选文件变动仍须重新计算并重跑全量回归。
3. 使用只包含本次隔离测试数据库配置的本地 env 文件执行原全量 runner：`node scripts/p2-g2-synthetic-e2e.mjs --suite=full --env-file=.env.ss009-review`。不得使用生产配置，测试数以实际输出为准，不把预期值写作结果。
4. 核对实际全量 TAP、trace、run.files、file_execution、全部原始故障/容量/catalog/浏览器/cleanup 收据及历史矩阵。保持运行前后候选不变；新 helper 必须确认每个 run.files 文件都有成功 case，且 per-file pass 计数与 trace 一致。
5. 获取绑定新指纹、来源真实的 SPEC/STANDARDS 独立审查文件。不得改名复制 r5 审查或由同一执行者冒签两个独立 reviewer。
6. 对实际成功 run 目录执行原 Binder、新前缀下的原 tamper runner，并保留 pending 完成态拒绝、最终完成态通过的真实结果。测试失败或证据缺失时停止，不手工拼接 PASS。
7. 仅在完整条件满足后更新计划为完成态、切换 evidence 指针，删除本轮临时的 historical-only 标记。将新证据作为被测提交的后继提交发布；保留所有旧证据和失败记录。
8. 在精确发布 head 与 GitHub merge preview 上重新跑原严格 CI。两者真实通过后，才恢复可交付结论。此执行单不授权 merge、deploy、真实外发、P2-G2-LIVE 或任何阶段推进。
