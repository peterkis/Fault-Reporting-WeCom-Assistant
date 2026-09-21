# PR #19：已发布证据不可变性 P2 修复与 r7 交接

## 当前状态

本记录对应 Codex `discussion_r4056616414`（Detect rewrites of previously published evidence）。代码修复已推送，Windows/Linux 专项真实执行通过；新候选的全量数据库/浏览器回归、独立审查及 r7 严格完成态尚未生成，不能合并或声称全部 CI 通过。

r6 不是无效的测试记录：在真实发布提交 `a1a48f9839315d7683d9973a1d9febfd14aa39a8` 上，原严格入口可复现通过，既有两个 Actions workflow 当时均成功。其 1187/1187、191 文件及候选 `0c5178a938f9461eea1060ed7483965d4b99b48b0bf554f167be4f0d3c56d753` 保留为历史事实。此次发现的是另一项证据保护缺口，不是已修复的文件来源或祖先链问题复发。

## 根因与实现

原检查只执行相对于 `SS009_BASE=375d47b...` 的 `git diff --diff-filter=MDR`。该起点之后新增的 SS009 文件即使后来被改写，相对起点仍显示为 A，因而被过滤掉。r6 不引用的旧 r5 报告可以被改写而不影响旧严格入口结果。

新增 `src/yxx-self-service-evidence-history.mjs`，由 `validateYxxSelfService` 在结构检查提前返回之前调用；默认、严格、内部 preTamper 三种模式均不能跳过：

1. 使用已独立读取的 r6 发布 SHA `a1a48f9839315d7683d9973a1d9febfd14aa39a8` 作为固定保护起点，不从可变报告或 HEAD 自证。要求完整历史、真实祖先关系、无 replace/graft；缺失时返回 `SS009_EVIDENCE_HISTORY_UNAVAILABLE`。
2. 对保护起点之后的提交历史只允许追加证据文件。关闭重命名推断、分别检查 merge parents；不仅比较最终树，还拒绝“改写后再提交恢复”的历史。新增证据首次提交后自动受保护，不需要每轮改保护起点，也不把整个 r7 前缀列入豁免。
3. 将 HEAD 证据树与索引、实际工作区文件分别核对，不依赖 diff 的 stat cache；可识别暂存内容与工作区不同、assume-unchanged、skip-worktree、删除、重命名、类型变化和目录链接。文本仅允许既有 UTF8_LF 的 CRLF 检出差异，BOM 不被静默剥离，二进制不做换行归一化。

变化返回 `SS009_PUBLISHED_EVIDENCE_CHANGED`，包括具体路径和 HISTORY/INDEX/WORKTREE 层。原 base-relative 检查、候选指纹、每文件 identity digest、TAP/trace、完成态、scope 和祖先约束全部保留。核心接线提交 `6262785b11bb9cacc59854166beb1de6ccc26848` 对原验证器仅增加 import 和调用，并将新证据输出前缀切为 r7。

本轮没有更改任何已发布的 `evidence/` 文件，没有修改原 r6 的 tested_head、指纹、测试数字或独立审查。

## 实际验证结果

基于提交 `ff404d93bd22a3b8adec743d5fcfaaadeb38d57a`，候选指纹为 `00388c36beb41ad0c6b1f6f96bc38172f657fa26f80124e8a3385603b2101749`；后续候选源有变动时须重新计算，不能照抄。

- Actions `35502873734`（SS009 evidence immutability）：Windows job `106057649603` 与 Ubuntu job `106057649678` 均成功。Node 24.20.0；18 项新 Git 历史测试加 15 项既有证据测试，各平台均 33/33，fail/cancelled/skipped/todo 为 0。
- 真实 r6 变造实验与八个既有验证器均通过；结构检查为 `STRUCTURE_VALID_NOT_READY`。本次观察到 1051 个已提交证据文件被保护。
- 原文件执行覆盖 workflow `35502873829` 同提交成功，未删除或替代其检查。
- 原严格发布检查 `35502873747` 仍失败。head 诊断明确为缺少新 `evidence/yxx-ss-009-r7-report.json`，不是祖先断链，也不是通过改写 r6 可以解决的问题。原严格 workflow 未跳过、未设为 continue-on-error。

上述 workflow artifacts 保留具体 TAP、前置身份核验、r6 实验及验证器输出。后继提交以各自 run 结果为准。

### 真实 r6 变造对照

`.github/review/ss009-evidence-history-probe.mjs` 在测试自有 detached worktree 使用原 r6 CLI，目标为 r6 未引用的 `evidence/yxx-ss-009-r5-review-fix-report.md`。

| 输入 | 原 r6 严格 CLI | 当前保护检查 |
| --- | --- | --- |
| 原始未改写 r6 | exit 0，SS009_LOCAL_VERIFICATION_COMPLETE | 历史保护正向通过 |
| 未提交的旧 r5 报告改写 | 错误接受，exit 0 | 三种入口均准确拒绝 |
| 改写后提交，工作区干净 | 错误接受，exit 0 | 三种入口均准确拒绝 |
| 改写后再提交恢复，最终树无差异 | 接受，无法检出中途改写 | 三种入口均准确拒绝 |

新入口拒绝码均为 `SS009_PUBLISHED_EVIDENCE_CHANGED`，路径准确匹配；不是靠新候选指纹不同或缺少 r7 造成假阳性。实验工作区已清理，主候选指纹未改变。此处正向历史校验不等于当前新候选完整 readiness。

18 项新测试另覆盖暂存区/工作区分离、隐藏修改、删除、重命名、新证据首次提交后的保护、二进制与 BOM、目录链接、真实 merge 图和错误保护起点等边界。

## 本地后续执行要求

只针对修复后的新候选收口；不再次修正已正确的历史祖先关系。普通 fast-forward 拉取原分支，保护未提交工作，不 reset/force-push。

1. 保持本轮保护模块和原有每文件 identity digest。先运行下面的专项命令，确认没有其他代码缺陷，再冻结候选；读取真实 HEAD/tree/指纹。新增测试文件会进入原 full collector，实际文件数与用例数以运行输出为准，不继续硬编码 191 或 1187。
2. r7 前缀已在源码切换，**无需再改源码中的证据前缀**。检查 r7 未被此前其他执行者占用。使用仅指向本次隔离本地 PostgreSQL 的配置运行原 full runner：`node scripts/p2-g2-synthetic-e2e.mjs --suite=full --env-file=.env.ss009-review`。禁止生产数据库、真实外发、模型调用或阶段推进。
3. 核对原 full TAP、逐文件身份摘要、case trace、故障/容量/catalog/真实浏览器及 cleanup 收据，必须运行前后候选不变。获得绑定真实新指纹的独立 SPEC/STANDARDS 审查；不得复制 r6 reviewer 或结果冒签。
4. 对真正成功 run 执行原 Binder 和原 29 类 tamper runner，保留 pending 拒绝与 finalized 通过输出。**此阶段新的 r7 生成物必须尚未提交**。本模块允许生成中的新文件，不允许更改已经提交的证据。阶段快照使用独立文件名，例如 pending-report.json，不能先提交 r7-report.json 的 PENDING 版再覆盖成 PASS。
5. 所有本地证据、独立审查、反向验证与完成态检查真实完成后，将最终新 r7 产物一次追加提交为被测源码提交的后继。更新计划 evidence 指针与完成态仅依据实际结果。发布后再跑只读严格入口；不要再次运行会覆盖已发布文件的 Binder/tamper 写入流程。新的修正应使用独立新路径并保留失败记录。
6. 在精确发布 head 和 GitHub merge preview 上运行原严格 CI；只有真实通过后才能恢复当前完成结论。此记录不授权合并、部署、现场发送、SS010/SS011 或父 Gate 推进。

专项只读/测试命令：

```sh
node --test --test-reporter=tap tests/yxx-ss-009-evidence.test.mjs tests/yxx-ss-009-evidence-history.test.mjs
node .github/review/ss009-evidence-history-probe.mjs
node scripts/validate-yxx-self-service.mjs
```

当前 `--require-ready` 因 r7 未完成应继续拒绝。正式自然 GC / 2C4G / 60 分钟仍未运行；live_authorized=false，SS010 PLANNED，SS011 NOT_AUTHORIZED，父 Gate 不推进。
